// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import * as path from 'path';
import * as fs from 'fs';
import YAML from 'js-yaml';

// BuildStrategy defines how an app's container image is built.
//   - "dockerfile": User-provided Dockerfile (field `dockerfile` specifies path, default "Dockerfile")
//   - "buildpack": Auto-generated Dockerfile based on detected framework
//   - "custom": User-provided build script (framework must be "custom")
export type BuildStrategy = 'dockerfile' | 'buildpack' | 'custom';

export interface TheoYamlAutoscaling {
  min?: number;           // minimum replicas (default: 1, 0 = scale-to-zero via KEDA)
  max?: number;           // maximum replicas (default: 3)
  targetCPU?: number;     // target CPU utilization % (default: 80)
  cooldown?: number;      // seconds before scale-to-zero (default: 300, only when min = 0)
}

export interface TheoYamlApp {
  path: string;
  framework?: string;                // optional when `runtime` and `start` are declared
  runtime?: string;                  // "node" | "python": the API builds the image from it and `start`
  start?: string;                    // the command that runs the app
  type?: string;                     // "server" | "worker" | "frontend"
  port: number | null;
  build?: BuildStrategy;             // v2: how to build this app (default: "buildpack" if framework known)
  dockerfile?: string;               // v2: Dockerfile path relative to app path (default: "Dockerfile")
  render?: 'static' | 'server';     // v2: delivery mode (MEET-009). "static" = S3/CDN, "server" = container.
  env?: Record<string, string>;      // v2: build-time environment variables (not runtime)
  secrets?: string[];
  replicas?: number;                 // desired replica count (default: 1)
  autoscaling?: TheoYamlAutoscaling; // HPA configuration
}

export interface TheoYaml {
  version?: number;                  // v2: schema version (current: 1). Missing = legacy format.
  project: string;
  apps: Record<string, TheoYamlApp>;
  ignore?: string[];                 // v2: glob patterns of dirs that are NOT deployable apps
}

/** The descriptor's name. `loopscale init`-style hints and error messages use it. */
export const DESCRIPTOR_FILE_NAME = 'loopscale.yaml';

/**
 * Every name the descriptor has had, in lookup order. The push deploy reads the same list in the
 * same order (loopzero `api/internal/github/deploy_descriptor.go`); the two must change together.
 */
export const DESCRIPTOR_FILE_NAMES: readonly string[] = [DESCRIPTOR_FILE_NAME, 'loopzero.yaml', 'theo.yaml'];

export interface TheoYamlResult {
  path: string;
  /** Base name of `path`: which of DESCRIPTOR_FILE_NAMES was read. */
  fileName: string;
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
    throw new Error('could not parse loopscale.yaml — check YAML syntax');
  }

  const project = String(doc.project ?? doc.name ?? '');
  const rawApps = doc.apps;

  if (!project && (!rawApps || typeof rawApps !== 'object')) {
    throw new Error('could not parse loopscale.yaml — check YAML syntax');
  }

  // v2 fields
  const version = typeof doc.version === 'number' ? doc.version : undefined;
  const ignore = Array.isArray(doc.ignore)
    ? (doc.ignore as unknown[]).map((s) => String(s))
    : undefined;

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

      // v2 fields
      const build = typeof cfg.build === 'string' && ['dockerfile', 'buildpack', 'custom'].includes(cfg.build)
        ? (cfg.build as BuildStrategy)
        : undefined;
      const dockerfile = typeof cfg.dockerfile === 'string' ? cfg.dockerfile : undefined;
      const env = cfg.env && typeof cfg.env === 'object' && !Array.isArray(cfg.env)
        ? Object.fromEntries(
            Object.entries(cfg.env as Record<string, unknown>).map(([k, v]) => [k, String(v)])
          )
        : undefined;

      // v2: render mode (MEET-009)
      const render = typeof cfg.render === 'string' && ['static', 'server'].includes(cfg.render)
        ? (cfg.render as 'static' | 'server')
        : undefined;

      // B15 (MEET-2026-04-23-059): parser PRESERVES invalid values so the
      // validator can reject them explicitly. Previously the parser silently
      // dropped invalid ints, making errors invisible to users.
      // Range validation (replicas >= 1, max >= min, targetCPU 1-100) lives
      // in validate-config.ts — the single authoritative gate.
      let replicas: number | undefined;
      if (cfg.replicas != null) {
        const n = Number(cfg.replicas);
        replicas = isNaN(n) ? undefined : n;
      }

      // Autoscaling (HPA configuration) — preserve invalid values for validator.
      let autoscaling: TheoYamlAutoscaling | undefined;
      if (cfg.autoscaling && typeof cfg.autoscaling === 'object' && !Array.isArray(cfg.autoscaling)) {
        const asCfg = cfg.autoscaling as Record<string, unknown>;
        const coerce = (v: unknown): number | undefined => {
          if (v == null) return undefined;
          const n = Number(v);
          return isNaN(n) ? undefined : n;
        };
        const min = coerce(asCfg.min);
        const max = coerce(asCfg.max);
        const targetCPU = coerce(asCfg.targetCPU);
        const cooldown = coerce(asCfg.cooldown);

        autoscaling = {
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {}),
          ...(targetCPU !== undefined ? { targetCPU } : {}),
          ...(cooldown !== undefined ? { cooldown } : {}),
        };
      }

      apps[appName] = {
        path: String(cfg.path ?? '.'),
        framework: String(cfg.framework ?? 'unknown'),
        type: cfg.type != null ? String(cfg.type) : undefined,
        ...(cfg.runtime != null ? { runtime: String(cfg.runtime) } : {}),
        ...(cfg.start != null ? { start: String(cfg.start) } : {}),
        port: port !== null && !isNaN(port) ? port : null,
        ...(build ? { build } : {}),
        ...(dockerfile ? { dockerfile } : {}),
        ...(render ? { render } : {}),
        ...(env ? { env } : {}),
        ...(secrets ? { secrets } : {}),
        ...(replicas !== undefined ? { replicas } : {}),
        ...(autoscaling ? { autoscaling } : {}),
      };
    }
  }

  return {
    project,
    apps,
    ...(version !== undefined ? { version } : {}),
    ...(ignore ? { ignore } : {}),
  };
}

/**
 * Walk up from cwd to gitRoot looking for the descriptor, parse it, and return the result.
 * In each directory the names are tried in the order of DESCRIPTOR_FILE_NAMES.
 */
export function findTheoYaml(cwd: string, gitRoot: string): TheoYamlResult | null {
  let dir = cwd;
  while (true) {
    const fileName = DESCRIPTOR_FILE_NAMES.find((name) => fs.existsSync(path.join(dir, name)));
    if (fileName) {
      const candidate = path.join(dir, fileName);
      const raw = fs.readFileSync(candidate, 'utf-8');
      try {
        const content = parseTheoYaml(raw);
        return { path: candidate, fileName, content };
      } catch (e) {
        const parseError = (e as Error).message.replace(DESCRIPTOR_FILE_NAME, fileName);
        return { path: candidate, fileName, content: { project: '', apps: {} }, parseError };
      }
    }
    if (dir === gitRoot || dir === path.dirname(dir)) {
      return null;
    }
    dir = path.dirname(dir);
  }
}
