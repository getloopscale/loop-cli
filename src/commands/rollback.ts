import { ApiError } from '../api/client';
import type { TheoYamlResult } from '../adapters/theo-yaml';
import { classifyNetworkError } from '../output/error-message';

interface RollbackApiResponse {
  status: string;
  /** The id of the rollback's record in the project history. Absent from an older API. */
  rollback_id?: string;
  rolled_back_release: string;
  reactivated_release: string;
  environment: string;
  url?: string;
}

export interface RollbackDeps {
  getToken: () => string | null;
  findTheoYaml: () => TheoYamlResult | null;
  rollback: (project: string, environment: string, toReleaseId?: string) => Promise<RollbackApiResponse>;
  /**
   * The id of the environment's ACTIVE release, or null when it has none, which
   * is the state while a rollback runs. Read from `GET /projects/{name}/status`.
   */
  getActiveReleaseId?: (project: string, environment: string) => Promise<string | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  confirm?: (message: string) => Promise<boolean>;
  writeTo: (msg: string) => void;
  writeError: (msg: string) => void;
  isCI?: boolean;
  /**
   * stdin sem TTY — pipe, redirect, harness. Mesma fresta do #164/#161: um pipe local nao
   * define `CI`, entao a guarda de `isCI` sozinha deixava o prompt travar ate o timeout.
   */
  isNonInteractive?: boolean;
}

export interface RollbackOptions {
  env?: string;
  to?: string;
  json?: boolean;
  yes?: boolean;
  /** False returns right after the API accepted the rollback. Defaults to true. */
  wait?: boolean;
}

/**
 * The API gives a rollback's background work 15 minutes and then up to 30
 * seconds for each state change that settles the release
 * (getloopscale/loopzero#118). One extra minute covers those.
 */
export const ROLLBACK_DEADLINE_MS = 16 * 60 * 1000;
const ROLLBACK_POLL_INTERVAL_MS = 5000;

type RollbackEnd =
  | { state: 'completed' }
  | { state: 'failed' | 'superseded'; activeReleaseId: string }
  | { state: 'not_confirmed'; lastReadError?: Error };

export class RollbackCommand {
  private readonly deps: RollbackDeps;

  constructor(deps: RollbackDeps) {
    this.deps = deps;
  }

  async execute(opts: RollbackOptions = {}): Promise<number> {
    const environment = opts.env ?? 'production';

    // 1. Auth check
    if (!this.deps.getToken()) {
      return this.exitWithError(opts, 'Not authenticated. Run: loopscale login', 4, 'AUTH_REQUIRED');
    }

    // 2. Find theo.yaml
    const yamlResult = this.deps.findTheoYaml();
    if (!yamlResult) {
      return this.exitWithError(opts, 'No theo.yaml found. Run: loopscale init', 1, 'MISSING_CONFIG');
    }

    if (yamlResult.parseError) {
      return this.exitWithError(opts, `Invalid theo.yaml: ${yamlResult.parseError}`, 1, 'INVALID_CONFIG');
    }

    const project = yamlResult.content.project;

    // 3. Display migration warning (always, even with --yes)
    if (!opts.json) {
      this.deps.writeTo('Warning: Rollback does not revert database migrations.');
      this.deps.writeTo('  If the deployment you\'re reverting from included schema changes,');
      this.deps.writeTo('  the previous version may not be compatible with the current database.');
      this.deps.writeTo('');
    }

    // 3b. Confirmation required (unless --yes)
    if (!opts.yes) {
      // #164 (mesma classe do #161): fail-fast em QUALQUER contexto nao-interativo, nao so `CI`.
      if (this.deps.isCI || this.deps.isNonInteractive) {
        return this.exitWithError(opts, 'Confirmation required. Pass --yes in non-interactive contexts (CI, pipes, redirected stdin).', 1, 'CONFIRMATION_REQUIRED');
      }
      if (this.deps.confirm) {
        const confirmed = await this.deps.confirm(
          `Rollback ${environment}${opts.to ? ` to release ${opts.to}` : ' to previous release'}? [y/N] `
        );
        if (!confirmed) {
          if (opts.json) {
            this.deps.writeTo(JSON.stringify({ status: 'cancelled' }));
          } else {
            this.deps.writeTo('Rollback cancelled.');
          }
          return 0;
        }
      }
    }

    // 4. Call API
    const startTime = this.now();
    let response: RollbackApiResponse;
    try {
      response = await this.deps.rollback(project, environment, opts.to);
    } catch (err) {
      return this.handleError(opts, err);
    }
    // 5. The API answers 202 `in_progress` and finishes in the background
    // (getloopscale/loopzero#118): the rollback is accepted, not done.
    const inProgress = response.status === 'in_progress';
    if (inProgress && opts.wait === false) {
      if (opts.json) {
        this.deps.writeTo(JSON.stringify({
          status: 'in_progress',
          ...(response.rollback_id ? { rollback_id: response.rollback_id } : {}),
          rolled_back_release: response.rolled_back_release,
          target_release: response.reactivated_release,
          environment: response.environment,
          url: response.url,
        }));
      } else {
        this.deps.writeTo(`Rollback started for ${environment}: ${response.rolled_back_release} -> ${response.reactivated_release}.`);
        this.writeRollbackId(response);
        this.deps.writeTo('It runs in the background. Check it with: loopscale status');
      }
      return 0;
    }

    if (inProgress) {
      if (!opts.json) {
        this.deps.writeTo(`Rollback started for ${environment}: ${response.rolled_back_release} -> ${response.reactivated_release}.`);
        this.writeRollbackId(response);
        this.deps.writeTo('Waiting for the target release to become active...');
      }
      const end = await this.followRollback(project, environment, response);
      if (end.state !== 'completed') {
        return this.reportUnfinished(opts, environment, response, end);
      }
    }
    const durationSeconds = Math.round((this.now() - startTime) / 1000);

    // 6. Display result
    if (opts.json) {
      this.deps.writeTo(JSON.stringify({
        status: inProgress ? 'completed' : response.status,
        ...(response.rollback_id ? { rollback_id: response.rollback_id } : {}),
        rolled_back_release: response.rolled_back_release,
        active_release: response.reactivated_release,
        environment: response.environment,
        duration_seconds: durationSeconds,
        url: response.url,
      }));
      return 0;
    }

    if (!inProgress) {
      this.deps.writeTo(`Rolling back ${environment}...`);
    }
    this.deps.writeTo('');
    this.deps.writeTo(`  Rolled back: ${response.rolled_back_release}`);
    this.deps.writeTo(`  Reactivated: ${response.reactivated_release}`);
    this.deps.writeTo('');
    this.deps.writeTo(`Rollback completed in ${durationSeconds}s.`);
    this.deps.writeTo(`Active release: ${response.reactivated_release}`);
    if (response.url) {
      this.deps.writeTo(`URL: ${response.url}`);
    }

    return 0;
  }

  /** Names the rollback's record, which the console lists under Deployments. */
  private writeRollbackId(accepted: RollbackApiResponse): void {
    if (accepted.rollback_id) {
      this.deps.writeTo(`Rollback id: ${accepted.rollback_id}`);
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  /**
   * Polls the environment's active release until it shows how the rollback
   * ended, or the deadline passes. A status read that fails says nothing about
   * the rollback, which runs on the server; the loop keeps the error and tries
   * again, and the deadline carries it.
   */
  private async followRollback(project: string, environment: string, accepted: RollbackApiResponse): Promise<RollbackEnd> {
    const read = this.deps.getActiveReleaseId;
    if (!read) {
      return { state: 'not_confirmed', lastReadError: new Error('this build of the CLI cannot read the project status') };
    }
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const startedAt = this.now();
    let lastReadError: Error | undefined;
    for (;;) {
      try {
        const activeReleaseId = await read(project, environment);
        lastReadError = undefined;
        if (activeReleaseId === accepted.reactivated_release) return { state: 'completed' };
        if (activeReleaseId === accepted.rolled_back_release) return { state: 'failed', activeReleaseId };
        if (activeReleaseId) return { state: 'superseded', activeReleaseId };
      } catch (err) {
        lastReadError = err instanceof Error ? err : new Error(String(err));
      }
      if (this.now() - startedAt >= ROLLBACK_DEADLINE_MS) {
        return { state: 'not_confirmed', lastReadError };
      }
      await sleep(ROLLBACK_POLL_INTERVAL_MS);
    }
  }

  private reportUnfinished(opts: RollbackOptions, environment: string, accepted: RollbackApiResponse, end: Exclude<RollbackEnd, { state: 'completed' }>): number {
    const target = accepted.reactivated_release;
    const extra = accepted.rollback_id ? { rollback_id: accepted.rollback_id } : undefined;
    switch (end.state) {
      case 'failed':
        return this.exitWithError(opts, `Rollback to ${target} did not complete. Release ${end.activeReleaseId} stays active in ${environment}.`, 3, 'ROLLBACK_FAILED', extra);
      case 'superseded':
        return this.exitWithError(opts, `Rollback to ${target} did not complete: release ${end.activeReleaseId} became active in ${environment} while it ran.`, 3, 'ROLLBACK_SUPERSEDED', extra);
      case 'not_confirmed': {
        const why = end.lastReadError ? ` (${end.lastReadError.message})` : '';
        return this.exitWithError(opts, `Rollback to ${target} was accepted, but ${environment} showed no active release after ${ROLLBACK_DEADLINE_MS / 60_000} minutes${why}. Check it with: loopscale status`, 3, 'ROLLBACK_NOT_CONFIRMED', extra);
      }
    }
  }

  private exitWithError(opts: RollbackOptions, message: string, exitCode: number, code?: string, extra?: Record<string, unknown>): number {
    if (opts.json) {
      const payload: Record<string, unknown> = { error: message, exit_code: exitCode, ...extra };
      if (code) {
        payload.code = code;
      }
      this.deps.writeTo(JSON.stringify(payload));
    } else {
      this.deps.writeError(message);
    }
    return exitCode;
  }

  private handleError(opts: RollbackOptions, err: unknown): number {
    if (err instanceof ApiError) {
      if (err.exitCode === 4) {
        return this.exitWithError(opts, 'Authentication failed. Run: loopscale login', 4, 'AUTH_REQUIRED');
      }
      if (err.statusCode === 409 && err.code === 'CONCURRENT_ACTIVATION') {
        // T5.1 CV-M-1 of plan 2026-06-01-p3-infra-observability-test-debt:
        // partial unique index `idx_releases_active_unique` (migration
        // 000022) rejected concurrent release activation. See
        // promote.ts for the design rationale (same mapping pattern).
        return this.exitWithError(opts, 'A previous release activation is still in progress. The platform will converge automatically — retry in a moment.', 3, 'CONCURRENT_ACTIVATION');
      }
      if (err.statusCode === 409) {
        return this.exitWithError(opts, 'Another operation is in progress. Try again in a moment.', 3, 'DEPLOY_IN_PROGRESS');
      }
      if (err.statusCode === 404) {
        return this.exitWithError(opts, err.message, 3, err.code);
      }
      return this.exitWithError(opts, err.message, err.exitCode, err.code);
    }
    // CHG-2026-04-23-AUDIT-25: surface API_UNREACHABLE for network errors.
    const net = classifyNetworkError(err);
    if (net.isNetwork) {
      return this.exitWithError(opts, net.message, 3, 'API_UNREACHABLE');
    }
    if (err instanceof Error) {
      return this.exitWithError(opts, `Unexpected error: ${err.message}`, 3, 'UNEXPECTED_ERROR');
    }
    return this.exitWithError(opts, 'Unexpected error. Try again later.', 3, 'UNEXPECTED_ERROR');
  }
}
