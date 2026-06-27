// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

export interface DeployEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface AppResult {
  name: string;
  status: string;
  url?: string;
  custom_domain_urls?: string[]; // MEET-2026-04-05-033: Active custom domain URLs
  build_duration_seconds?: number;
  error?: string;
}

export interface DeployResult {
  deploy_id: string;
  status: string;
  duration_seconds: number;
  apps: AppResult[];
}

export interface DeployRendererOptions {
  isCI: boolean;
  isJSON: boolean;
  isTTY: boolean;
}

export class DeployRenderer {
  constructor(private options: DeployRendererOptions) {}

  /**
   * Process an SSE event and return a formatted string for display.
   * Returns null in JSON mode (no intermediate output).
   */
  onEvent(event: DeployEvent): string | null {
    if (this.options.isJSON) {
      return null;
    }

    if (this.options.isCI) {
      return this.renderCIEvent(event);
    }

    return this.renderTTYEvent(event);
  }

  /**
   * Render the final deploy result for human-readable output (TTY or CI).
   */
  renderResult(result: DeployResult): string {
    if (this.options.isCI) {
      return this.renderCIResult(result);
    }

    return this.renderTTYResult(result);
  }

  private renderTTYEvent(event: DeployEvent): string | null {
    const app = String(event.data.app ?? '');

    switch (event.type) {
      case 'build.started': {
        // F-01: build.started includes apps[] array with all app names being built
        const apps = event.data.apps as string[] | undefined;
        if (apps && apps.length > 0) {
          return apps.map((a) => `\x1b[36m⠋\x1b[0m Building ${a}...`).join('\n');
        }
        return `\x1b[36m⠋\x1b[0m Building${app ? ` ${app}` : ''}...`;
      }

      case 'build.completed': {
        const duration = Number(event.data.duration_seconds ?? 0);
        return `\x1b[32m✓\x1b[0m Building ${app} [${duration}s]`;
      }

      case 'build.failed': {
        const error = String(event.data.error ?? 'unknown error');
        return `\x1b[31m✗\x1b[0m Building ${app} [${error}]`;
      }

      case 'deploy.delivering':
        return `\x1b[36m⠋\x1b[0m Deploying to environment...`;

      case 'deploy.verifying':
        return `\x1b[36m⠋\x1b[0m Verifying service health${app ? ` (${app})` : ''}...`;

      case 'deploy.live': {
        const url = String(event.data.url ?? '');
        return `\x1b[32m✓\x1b[0m ${app} live${url ? ` ${url}` : ''}`;
      }

      case 'deploy.app_live': {
        const url = String(event.data.url ?? '');
        return `\x1b[32m✓\x1b[0m ${app} deployed ${url}`;
      }

      case 'health.checking':
        return `\x1b[36m⠋\x1b[0m Checking service health...`;

      case 'health.passed': {
        const duration = Number(event.data.duration_seconds ?? 0);
        return `\x1b[32m✓\x1b[0m Service healthy [${duration}s]`;
      }

      default:
        return null;
    }
  }

  private renderCIEvent(event: DeployEvent): string | null {
    const app = String(event.data.app ?? '');

    switch (event.type) {
      case 'build.started': {
        // F-01: build.started includes apps[] array with all app names being built
        const apps = event.data.apps as string[] | undefined;
        if (apps && apps.length > 0) {
          return apps.map((a) => `[build] ${a}: building...`).join('\n');
        }
        return `[build] ${app || 'all'}: building...`;
      }

      case 'build.completed': {
        const duration = Number(event.data.duration_seconds ?? 0);
        return `[build] ${app}: complete [${duration}s]`;
      }

      case 'build.failed': {
        const error = String(event.data.error ?? 'unknown error');
        return `[build] ${app}: failed [${error}]`;
      }

      case 'deploy.delivering':
        return `[deploy] delivering to environment...`;

      case 'deploy.verifying':
        return `[deploy] verifying service health${app ? ` (${app})` : ''}...`;

      case 'deploy.live': {
        const url = String(event.data.url ?? '');
        return `[deploy] ${app}: live${url ? ` ${url}` : ''}`;
      }

      case 'deploy.app_live': {
        const url = String(event.data.url ?? '');
        return `[deploy] ${app}: deployed ${url}`;
      }

      case 'health.checking':
        return `[health] ${app}: checking...`;

      case 'health.passed': {
        const duration = Number(event.data.duration_seconds ?? 0);
        return `[health] ${app}: healthy [${duration}s]`;
      }

      default:
        return null;
    }
  }

  private renderTTYResult(result: DeployResult): string {
    const lines: string[] = [];

    // Red Team theo-cloud#84 closure: result.duration_seconds measures
    // only the post-build phase (deliver + verify), NOT the build itself.
    // For a deploy whose build took 718s and post-build verify took 104s,
    // "Deploy completed in 104s" undercounts by ~7x and misleads the user
    // about what `theo deploy` actually cost. Surface the build duration
    // (when known) + the total wall-clock so the number matches lived
    // experience.
    const total = formatDeployTotal(result);
    if (result.status === 'success') {
      lines.push(`\x1b[32m✓\x1b[0m Deploy completed in ${total}`);
    } else {
      lines.push(`\x1b[31m✗\x1b[0m Deploy ${result.status} (${total})`);
    }

    lines.push('');
    lines.push('Live:');

    for (const app of result.apps) {
      if (app.status === 'failed') {
        lines.push(`  \x1b[31m✗\x1b[0m ${app.name}: ${app.error ?? 'failed'}`);
      } else if (app.url) {
        lines.push(`  ${app.name} → ${app.url}`);
        // MEET-2026-04-05-033: Show custom domain URLs alongside auto-generated URL
        if (app.custom_domain_urls?.length) {
          for (const cdUrl of app.custom_domain_urls) {
            lines.push(`  ${app.name} → ${cdUrl} \x1b[2m(custom domain)\x1b[0m`);
          }
        }
      } else {
        lines.push(`  ${app.name} (no URL — background worker)`);
      }
    }

    return lines.join('\n');
  }

  private renderCIResult(result: DeployResult): string {
    const lines: string[] = [];

    // Red Team theo-cloud#84 closure (see renderTTYResult for context).
    const total = formatDeployTotal(result);
    if (result.status === 'success') {
      lines.push(`Deploy completed in ${total}`);
    } else {
      lines.push(`Deploy ${result.status} (${total})`);
    }

    for (const app of result.apps) {
      if (app.status === 'failed') {
        lines.push(`  ${app.name}: ${app.error ?? 'failed'}`);
      } else if (app.url) {
        lines.push(`  ${app.name}: ${app.url}`);
        // MEET-2026-04-05-033: Show custom domain URLs in CI output
        if (app.custom_domain_urls?.length) {
          for (const cdUrl of app.custom_domain_urls) {
            lines.push(`  ${app.name}: ${cdUrl} (custom domain)`);
          }
        }
      } else {
        lines.push(`  ${app.name}: (no URL — background worker)`);
      }
    }

    return lines.join('\n');
  }
}

// Red Team theo-cloud#84 closure — format the deploy total so the
// number matches lived experience. Sums the max build duration across
// apps (builds run in parallel — sum would double-count) with the
// post-build phase. When no app reports build_duration_seconds, falls
// back to the post-build phase alone (legacy behavior).
//
// Output shape examples:
//   "104s"                      — no build duration available
//   "13m 42s (build 11m 58s)"   — build dominates total
//   "1m 44s (build 0s)"         — cached / no rebuild
export function formatDeployTotal(result: DeployResult): string {
  const postBuild = Math.max(0, result.duration_seconds || 0);
  let maxBuild = 0;
  for (const app of result.apps) {
    const bd = app.build_duration_seconds ?? 0;
    if (bd > maxBuild) {
      maxBuild = bd;
    }
  }
  if (maxBuild <= 0) {
    return `${postBuild}s`;
  }
  const total = postBuild + maxBuild;
  return `${humanizeSeconds(total)} (build ${humanizeSeconds(maxBuild)})`;
}

function humanizeSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) {
    return '0s';
  }
  if (s < 60) {
    return `${Math.round(s)}s`;
  }
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  return `${m}m ${sec}s`;
}
