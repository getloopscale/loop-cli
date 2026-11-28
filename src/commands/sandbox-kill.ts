// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { ApiError } from '../api/client';
import { classifyNetworkError } from '../output/error-message';

export interface SandboxKillDeps {
  getToken: () => string | null;
  killSandbox: (id: string) => Promise<void>;
  writeTo: (msg: string) => void;
  writeError: (msg: string) => void;
}

export interface SandboxKillOptions {
  json?: boolean;
}

/**
 * SandboxKillCommand terminates one sandbox: its processes stop and its files are deleted.
 *
 * Does NOT require loopscale.yaml.
 *
 * Exit codes:
 *   0 — sandbox terminated
 *   1 — usage error (no id, or no sandbox with that id)
 *   3 — operation failed
 *   4 — auth error
 */
export class SandboxKillCommand {
  private readonly deps: SandboxKillDeps;

  constructor(deps: SandboxKillDeps) {
    this.deps = deps;
  }

  async execute(id: string, opts: SandboxKillOptions = {}): Promise<number> {
    if (!this.deps.getToken()) {
      return this.exitWithError(opts, 'Not authenticated. Run: loopscale login', 4, 'AUTH_REQUIRED');
    }

    if (!id || id.trim() === '') {
      return this.exitWithError(opts, 'Sandbox id is required. Usage: loopscale sandbox kill <id>', 1, 'MISSING_ARGUMENT');
    }

    try {
      await this.deps.killSandbox(id);
    } catch (err) {
      return this.handleError(opts, err, id);
    }

    if (opts.json) {
      this.deps.writeTo(JSON.stringify({ ok: true, id, status: 'terminated' }));
    } else {
      this.deps.writeTo(`Terminated sandbox ${id}.`);
    }
    return 0;
  }

  private exitWithError(opts: SandboxKillOptions, message: string, exitCode: number, code?: string): number {
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

  private handleError(opts: SandboxKillOptions, err: unknown, id: string): number {
    if (err instanceof ApiError) {
      if (err.exitCode === 4 || err.statusCode === 401) {
        return this.exitWithError(opts, 'Authentication failed. Run: loopscale login', 4, 'AUTH_REQUIRED');
      }
      if (err.statusCode === 404) {
        return this.exitWithError(opts, `No sandbox with id ${id}. Run: loopscale sandbox list`, 1, 'SANDBOX_NOT_FOUND');
      }
      return this.exitWithError(opts, `Failed to terminate sandbox: ${err.message}. Try again.`, 3, err.code);
    }
    const net = classifyNetworkError(err);
    if (net.isNetwork) {
      return this.exitWithError(opts, net.message, 3, 'API_UNREACHABLE');
    }
    const detail = err instanceof Error ? err.message : 'unknown error';
    return this.exitWithError(opts, `Failed to terminate sandbox: ${detail}. Try again.`, 3, 'UNEXPECTED_ERROR');
  }
}
