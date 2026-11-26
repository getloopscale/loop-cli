import { ApiError } from '../api/client';
import { classifyNetworkError } from '../output/error-message';
import type { LoopScaleYamlResult } from '../adapters/loopscale-yaml';

interface PromoteApiResponse {
  promotion_id: string;
  status: string;
  source_release: string;
  new_release: string;
  from: string;
  to: string;
  url?: string;
}

export interface PromoteDeps {
  getToken: () => string | null;
  findLoopScaleYaml: () => LoopScaleYamlResult | null;
  promote: (project: string, from: string, to: string) => Promise<PromoteApiResponse>;
  confirm?: (message: string) => Promise<boolean>;
  writeTo: (msg: string) => void;
  writeError: (msg: string) => void;
  isCI?: boolean;
  /**
   * Red Team loop-console#161: true when stdin has no TTY (e.g., pipes /
   * redirects / harnesses). Without this, `loopscale promote --from X --to Y`
   * without `--yes` hung on the [y/N] prompt reading a stdin that would
   * never produce input, and the outer withTimeout wrapper eventually
   * mis-blamed "Promotion timed out. Check your connection." Fail-fast
   * with the same CONFIRMATION_REQUIRED contract used in CI mode.
   */
  isNonInteractive?: boolean;
}

export interface PromoteOptions {
  from?: string;
  to?: string;
  json?: boolean;
  yes?: boolean;
}

export class PromoteCommand {
  private readonly deps: PromoteDeps;

  constructor(deps: PromoteDeps) {
    this.deps = deps;
  }

  async execute(opts: PromoteOptions = {}): Promise<number> {
    const from = opts.from ?? 'staging';
    const to = opts.to ?? 'production';

    // 1. Auth check
    if (!this.deps.getToken()) {
      return this.exitWithError(opts, 'Not authenticated. Run: loopscale login', 4, 'AUTH_REQUIRED');
    }

    // 2. Find loopscale.yaml
    const yamlResult = this.deps.findLoopScaleYaml();
    if (!yamlResult) {
      return this.exitWithError(opts, 'No loopscale.yaml found. Run: loopscale init', 1, 'MISSING_CONFIG');
    }

    if (yamlResult.parseError) {
      return this.exitWithError(opts, `Invalid ${yamlResult.fileName}: ${yamlResult.parseError}`, 1, 'INVALID_CONFIG');
    }

    const project = yamlResult.content.project;

    // 3. Validate from != to
    if (from === to) {
      return this.exitWithError(opts, 'Source and target environments must be different.', 1, 'SAME_ENVIRONMENT');
    }

    // 4. Confirmation required (unless --yes)
    if (!opts.yes) {
      // Red Team #161: fail-fast in ANY non-interactive context (CI env OR
      // stdin without a TTY — pipes, redirects, harnesses). Pre-fix the
      // prompt hung on stdin EOF and the outer 40s withTimeout wrapper
      // eventually surfaced "Promotion timed out. Check your connection"
      // — misleading the operator into blaming the network.
      if (this.deps.isCI || this.deps.isNonInteractive) {
        return this.exitWithError(
          opts,
          'Confirmation required. Pass --yes in non-interactive contexts (CI, pipes, redirected stdin).',
          1,
          'CONFIRMATION_REQUIRED',
        );
      }
      if (this.deps.confirm) {
        const confirmed = await this.deps.confirm(
          `Promote ${from} to ${to}? [y/N] `
        );
        if (!confirmed) {
          if (opts.json) {
            this.deps.writeTo(JSON.stringify({ status: 'cancelled' }));
          } else {
            this.deps.writeTo('Promotion cancelled.');
          }
          return 0;
        }
      }
    }

    // 5. Call API
    const startTime = Date.now();
    let response: PromoteApiResponse;
    try {
      response = await this.deps.promote(project, from, to);
    } catch (err) {
      return this.handleError(opts, err);
    }
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    // 6. Display result
    if (opts.json) {
      this.deps.writeTo(JSON.stringify({
        promotion_id: response.promotion_id,
        status: response.status,
        source_release: response.source_release,
        new_release: response.new_release,
        from: response.from,
        to: response.to,
        duration_seconds: durationSeconds,
        url: response.url,
      }));
      return 0;
    }

    this.deps.writeTo(`Promoting ${from} to ${to}...`);
    this.deps.writeTo('');
    this.deps.writeTo(`  Source: ${response.source_release} (${from})`);
    this.deps.writeTo(`  Target: ${response.new_release} (${to})`);
    this.deps.writeTo('');
    this.deps.writeTo(`Promotion started in ${durationSeconds}s.`);
    if (response.url) {
      this.deps.writeTo(`URL: ${response.url}`);
    }

    return 0;
  }

  private exitWithError(opts: PromoteOptions, message: string, exitCode: number, code?: string): number {
    if (opts.json) {
      const payload: Record<string, unknown> = { error: message, exit_code: exitCode };
      if (code) {
        payload.code = code;
      }
      this.deps.writeTo(JSON.stringify(payload));
    } else {
      this.deps.writeError(message);
    }
    return exitCode;
  }

  private handleError(opts: PromoteOptions, err: unknown): number {
    if (err instanceof ApiError) {
      if (err.exitCode === 4) {
        return this.exitWithError(opts, 'Authentication failed. Run: loopscale login', 4, 'AUTH_REQUIRED');
      }
      if (err.statusCode === 409 && err.code === 'CONCURRENT_ACTIVATION') {
        // T5.1 CV-M-1 of plan 2026-06-01-p3-infra-observability-test-debt:
        // partial unique index `idx_releases_active_unique` (migration
        // 000022) rejected concurrent release activation. Distinct from
        // DEPLOY_IN_PROGRESS (environment-lock race at the API boundary)
        // because this fires at the DB-layer convergence-loop activation
        // step. Operator interpretation: race between two convergence
        // ticks; the convergence loop is idempotent — retry succeeds.
        return this.exitWithError(opts, 'A previous release activation is still in progress. The platform will converge automatically — retry in a moment.', 3, 'CONCURRENT_ACTIVATION');
      }
      if (err.statusCode === 409) {
        return this.exitWithError(opts, 'Another operation is in progress. Try again in a moment.', 3, 'DEPLOY_IN_PROGRESS');
      }
      if (err.statusCode === 404) {
        return this.exitWithError(opts, err.message, 3, err.code);
      }
      if (err.statusCode === 400) {
        return this.exitWithError(opts, err.message, 1, err.code);
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
