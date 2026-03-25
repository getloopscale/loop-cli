// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import * as path from 'path';
import * as fs from 'fs';
import YAML from 'js-yaml';

export interface TheoYamlApp {
  path: string;
  framework: string;
  type?: string;
  port: number | null;
  secrets?: string[];
}

export interface TheoYaml {
  project: string;
  apps: Record<string, TheoYamlApp>;
}

export interface TheoYamlResult {
  path: string;
  content: TheoYaml;
  parseError?: string;
}

/**
 * Parse theo.yaml content using js-yaml.
 * Validates that the required structure (project + apps) is present.
 */
export function parseTheoYaml(raw: string): TheoYaml {
  const doc = YAML.load(raw) as Record<string, unknown> | null;

  if (!doc || typeof doc !== 'object') {
    throw new Error('could not parse theo.yaml — check YAML syntax');
  }

  const project = String(doc.project ?? doc.name ?? '');
  const rawApps = doc.apps;

  if (!project && (!rawApps || typeof rawApps !== 'object')) {
    throw new Error('could not parse theo.yaml — check YAML syntax');
  }

  const apps: Record<string, TheoYamlApp> = {};

  if (rawApps && typeof rawApps === 'object' && !Array.isArray(rawApps)) {
    for (const [appName, appConfig] of Object.entries(rawApps as Record<string, unknown>)) {
      const cfg = appConfig as Record<string, unknown> | null;
      if (!cfg || typeof cfg !== 'object') {
        apps[appName] = { path: '.', framework: 'unknown', port: null };
        continue;
      }

      const port = cfg.port != null ? Number(cfg.port) : null;
      const secrets = Array.isArray(cfg.secrets)
        ? cfg.secrets.map((s: unknown) => String(s))
        : undefined;

      apps[appName] = {
        path: String(cfg.path ?? '.'),
        framework: String(cfg.framework ?? 'unknown'),
        type: cfg.type != null ? String(cfg.type) : undefined,
        port: port !== null && !isNaN(port) ? port : null,
        ...(secrets ? { secrets } : {}),
      };
    }
  }

  return { project, apps };
}

/**
 * Walk up from cwd to gitRoot looking for theo.yaml, parse it, and return the result.
 */
export function findTheoYaml(cwd: string, gitRoot: string): TheoYamlResult | null {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, 'theo.yaml');
    if (fs.existsSync(candidate)) {
      const raw = fs.readFileSync(candidate, 'utf-8');
      try {
        const content = parseTheoYaml(raw);
        return { path: candidate, content };
      } catch (e) {
        return { path: candidate, content: { project: '', apps: {} }, parseError: (e as Error).message };
      }
    }
    if (dir === gitRoot || dir === path.dirname(dir)) {
      return null;
    }
    dir = path.dirname(dir);
  }
}
