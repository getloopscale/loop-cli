// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// T1.11 — `loopscale doctor` end-user health check.
// Per MEET-2026-05-12 plan: validates the operator's local env before they
// try `loopscale deploy` and fail with an opaque error. Suggests next action per
// failed check. Rule 3 clean — uses product language only.

export interface DoctorCheck {
  name: string;
  description: string;
  status: 'ok' | 'warn' | 'fail';
  detail?: string;
  suggested_action?: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  overall: 'ok' | 'warn' | 'fail';
}

export interface DoctorDeps {
  // Auth: is there a valid token?
  getToken: () => string | null;
  validateToken: (token: string) => Promise<{ valid: boolean; email?: string | null }>;

  // Network: can we reach API?
  pingAPI: () => Promise<{ ok: boolean; latencyMs?: number; error?: string }>;

  // Project config: does loopscale.yaml exist + parse?
  readProjectConfig: () => { exists: boolean; valid: boolean; error?: string };

  // CLI version + update channel
  getCliVersion: () => string;

  // Output
  writeTo: (msg: string) => void;
  writeError: (msg: string) => void;
  isCI: boolean;
}

export interface DoctorOptions {
  json?: boolean;
}

export class DoctorCommand {
  private readonly deps: DoctorDeps;

  constructor(deps: DoctorDeps) {
    this.deps = deps;
  }

  async execute(opts: DoctorOptions): Promise<number> {
    const result: DoctorResult = {
      checks: [],
      overall: 'ok',
    };

    // 1. CLI version
    const version = this.deps.getCliVersion();
    result.checks.push({
      name: 'cli_version',
      description: 'CLI version',
      status: 'ok',
      detail: version,
    });

    // 2. Authentication
    const token = this.deps.getToken();
    if (!token) {
      result.checks.push({
        name: 'auth',
        description: 'Authentication',
        status: 'fail',
        detail: 'Not logged in',
        suggested_action: 'Run `loopscale login` to authenticate',
      });
    } else {
      try {
        const validation = await this.deps.validateToken(token);
        if (validation.valid) {
          result.checks.push({
            name: 'auth',
            description: 'Authentication',
            status: 'ok',
            detail: validation.email ? `Logged in as ${validation.email}` : 'Token valid',
          });
        } else {
          result.checks.push({
            name: 'auth',
            description: 'Authentication',
            status: 'fail',
            detail: 'Token expired or invalid',
            suggested_action: 'Run `loopscale login` to refresh authentication',
          });
        }
      } catch {
        result.checks.push({
          name: 'auth',
          description: 'Authentication',
          status: 'warn',
          detail: 'Could not validate token (network unavailable)',
          suggested_action: 'Check internet connection; retry `loopscale doctor` when online',
        });
      }
    }

    // 3. Network reachability
    try {
      const ping = await this.deps.pingAPI();
      if (ping.ok) {
        result.checks.push({
          name: 'network',
          description: 'API reachability',
          status: 'ok',
          detail: ping.latencyMs !== undefined ? `${ping.latencyMs}ms` : 'reachable',
        });
      } else {
        result.checks.push({
          name: 'network',
          description: 'API reachability',
          status: 'fail',
          detail: ping.error || 'API not reachable',
          suggested_action: 'Check internet connection and firewall; verify the API URL (LOOPSCALE_URL) is reachable',
        });
      }
    } catch (err) {
      result.checks.push({
        name: 'network',
        description: 'API reachability',
        status: 'fail',
        detail: err instanceof Error ? err.message : 'unknown error',
        suggested_action: 'Check internet connection and firewall',
      });
    }

    // 4. Project config (loopscale.yaml)
    const projectConfig = this.deps.readProjectConfig();
    if (!projectConfig.exists) {
      result.checks.push({
        name: 'project_config',
        description: 'Project configuration (loopscale.yaml)',
        status: 'warn',
        detail: 'Not in a LoopScale project directory',
        suggested_action: 'cd into a project, or run `loopscale init` to create a new project',
      });
    } else if (!projectConfig.valid) {
      result.checks.push({
        name: 'project_config',
        description: 'Project configuration (loopscale.yaml)',
        status: 'fail',
        detail: projectConfig.error || 'loopscale.yaml has invalid syntax or fields',
        suggested_action: 'Fix loopscale.yaml syntax; run `loopscale deploy --dry-run` to validate',
      });
    } else {
      result.checks.push({
        name: 'project_config',
        description: 'Project configuration (loopscale.yaml)',
        status: 'ok',
        detail: 'loopscale.yaml present and valid',
      });
    }

    // Compute overall
    const hasFailure = result.checks.some(c => c.status === 'fail');
    const hasWarning = result.checks.some(c => c.status === 'warn');
    result.overall = hasFailure ? 'fail' : hasWarning ? 'warn' : 'ok';

    // Output
    if (opts.json) {
      this.deps.writeTo(JSON.stringify(result, null, 2));
    } else {
      this.renderHuman(result);
    }

    // Exit code: 0 ok, 1 usage (but we use 1 for any failure here per Rule 4)
    return result.overall === 'fail' ? 1 : 0;
  }

  private renderHuman(result: DoctorResult): void {
    const { writeTo } = this.deps;
    writeTo('LoopScale CLI health check');
    writeTo('');

    for (const check of result.checks) {
      const icon = check.status === 'ok' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
      writeTo(`  ${icon} ${check.description}`);
      if (check.detail) {
        writeTo(`      ${check.detail}`);
      }
      if (check.suggested_action) {
        writeTo(`      → ${check.suggested_action}`);
      }
    }
    writeTo('');

    if (result.overall === 'ok') {
      writeTo('All checks pass. Ready to deploy with `loopscale deploy`.');
    } else if (result.overall === 'warn') {
      writeTo('Warnings detected. CLI is usable but some features may be limited.');
    } else {
      writeTo('Failures detected. Fix the issues above and re-run `loopscale doctor`.');
    }
  }
}
