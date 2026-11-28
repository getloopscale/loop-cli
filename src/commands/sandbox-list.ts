// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { ApiError } from '../api/client';
import { classifyNetworkError, formatErrorMessage } from '../output/error-message';

/** A row of `GET /v1/sandboxes`. */
export interface SandboxItem {
  id: string;
  image?: string;
  state: string;
  created_at: string;
  expires_at?: string;
  /** Present only when the sandbox has outbound rules. */
  network?: { allow_out?: string[]; deny_out?: string[] };
}

export interface SandboxListDeps {
  getToken: () => string | null;
  listSandboxes: () => Promise<{ sandboxes: SandboxItem[] }>;
  writeTo: (msg: string) => void;
  writeError: (msg: string) => void;
}

export interface SandboxListOptions {
  json?: boolean;
}

/**
 * SandboxListCommand lists the organization's sandboxes that have not been destroyed.
 *
 * Does NOT require loopscale.yaml.
 *
 * Exit codes:
 *   0 — success (including an empty list)
 *   1 — the API refused or could not be reached
 *   4 — auth error
 */
export class SandboxListCommand {
  private readonly deps: SandboxListDeps;

  constructor(deps: SandboxListDeps) {
    this.deps = deps;
  }

  async execute(opts: SandboxListOptions = {}): Promise<number> {
    if (!this.deps.getToken()) {
      return this.exitWithError(opts, 'Not authenticated. Run: loopscale login', 4, 'AUTH_REQUIRED');
    }

    let sandboxes: SandboxItem[];
    try {
      sandboxes = (await this.deps.listSandboxes()).sandboxes ?? [];
    } catch (err) {
      return this.handleError(opts, err);
    }

    if (opts.json) {
      this.deps.writeTo(JSON.stringify({ sandboxes, total: sandboxes.length }));
      return 0;
    }

    if (sandboxes.length === 0) {
      this.deps.writeTo('No sandboxes running.');
      return 0;
    }

    const idWidth = Math.max('ID'.length, ...sandboxes.map((s) => s.id.length)) + 2;
    const imageWidth = Math.max('IMAGE'.length, ...sandboxes.map((s) => (s.image ?? '-').length)) + 2;
    this.deps.writeTo(`${pad('ID', idWidth)}${pad('STATE', 10)}${pad('IMAGE', imageWidth)}${pad('NETWORK', 12)}CREATED`);
    for (const s of sandboxes) {
      this.deps.writeTo(
        `${pad(s.id, idWidth)}${pad(s.state, 10)}${pad(s.image ?? '-', imageWidth)}${pad(outboundNetwork(s), 12)}${s.created_at}`,
      );
    }
    this.deps.writeTo('');
    this.deps.writeTo(`${sandboxes.length} sandbox${sandboxes.length !== 1 ? 'es' : ''}`);
    return 0;
  }

  private exitWithError(opts: SandboxListOptions, message: string, exitCode: number, code?: string): number {
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

  private handleError(opts: SandboxListOptions, err: unknown): number {
    if (err instanceof ApiError) {
      if (err.exitCode === 4 || err.statusCode === 401) {
        return this.exitWithError(opts, 'Authentication failed. Run: loopscale login', 4, 'AUTH_REQUIRED');
      }
      return this.exitWithError(opts, formatErrorMessage('Failed to list sandboxes', err.message, 'Try again'), 1, err.code);
    }
    const net = classifyNetworkError(err);
    if (net.isNetwork) {
      return this.exitWithError(opts, net.message, 1, 'API_UNREACHABLE');
    }
    const detail = err instanceof Error ? err.message : 'unknown error';
    return this.exitWithError(opts, formatErrorMessage('Failed to list sandboxes', detail, 'Try again'), 1, 'UNEXPECTED_ERROR');
  }
}

/** A sandbox reaches the public internet unless it was created with outbound rules. */
function outboundNetwork(sandbox: SandboxItem): string {
  const rules = sandbox.network;
  const restricted = (rules?.allow_out?.length ?? 0) > 0 || (rules?.deny_out?.length ?? 0) > 0;
  return restricted ? 'restricted' : 'open';
}

function pad(str: string, len: number): string {
  return str.length >= len ? str + ' ' : str + ' '.repeat(len - str.length);
}
