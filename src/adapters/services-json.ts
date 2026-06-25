// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan v1.1 T1.1 (theo-cli-vercel-like-ux): discovery of `.theo/services.json`
// for the deploy upload payload. Replaces the misdirected `findTheoYaml`
// usage at the upload boundary (which was silently shipping YAML bytes inside
// the `services_json` form field per Plan B v3.1 cutover gap).
//
// EC-4 absorbed: --services-json <path> override for users with custom
// `distDir` in `theo.config.ts` (e.g. distDir: 'out' → out/services.json).

import * as fs from 'fs';
import * as path from 'path';

const SERVICES_JSON_RELATIVE = path.join('.theo', 'services.json');

// Sprint 4 plan qa-sprint4-cleanup-2026-06-25 T1.2 — cascade .theo/ → .theokit/
// closes theo-cloud#29.B2. theokit v0.5.0+ writes manifests to .theokit/services.json
// by default (was .theo/services.json pre-0.5.0). Walk-up checks BOTH at each dir level,
// preferring .theo/ for backward compatibility with users who built via `theokit build --target theo-cloud`
// (which still emits .theo/) or hand-crafted the manifest.
const SERVICES_JSON_RELATIVE_FALLBACK = path.join('.theokit', 'services.json');

/**
 * Thrown when `--services-json <path>` was supplied but the target file does
 * not exist. Distinct from "no services.json discovered" because the user
 * explicitly pointed at a path that must resolve.
 */
export class ServicesJsonOverrideError extends Error {
  public readonly code = 'SERVICES_JSON_OVERRIDE_INVALID';
  constructor(suppliedPath: string) {
    super(
      `--services-json ${suppliedPath}: file not found. ` +
        'Re-run `theokit build --target theo-cloud` or fix the path.',
    );
    this.name = 'ServicesJsonOverrideError';
  }
}

/**
 * Walk up from `cwd` to `gitRoot` looking for `.theo/services.json`. Returns
 * the path to the first match or `null` when none found before the boundary.
 *
 * EC-4 absorbed: when `overridePath` is supplied, the walk-up is bypassed and
 * the supplied path is validated via `existsSync`. Missing target throws
 * `ServicesJsonOverrideError` (callers convert to exit code 1).
 */
export function findServicesJson(
  cwd: string,
  gitRoot: string,
  overridePath?: string,
): { path: string } | null {
  if (overridePath !== undefined && overridePath !== '') {
    const resolved = path.isAbsolute(overridePath)
      ? overridePath
      : path.join(cwd, overridePath);
    if (!fs.existsSync(resolved)) {
      throw new ServicesJsonOverrideError(overridePath);
    }
    return { path: resolved };
  }

  let dir = cwd;
  while (true) {
    // Sprint 4 T1.2 cascade: check .theo/ first (backward-compat), then .theokit/ fallback
    // at the SAME dir level before walking up. The first match wins.
    const candidate = path.join(dir, SERVICES_JSON_RELATIVE);
    if (fs.existsSync(candidate)) {
      return { path: candidate };
    }
    const fallbackCandidate = path.join(dir, SERVICES_JSON_RELATIVE_FALLBACK);
    if (fs.existsSync(fallbackCandidate)) {
      return { path: fallbackCandidate };
    }
    if (dir === gitRoot || dir === path.dirname(dir)) {
      return null;
    }
    dir = path.dirname(dir);
  }
}

/**
 * parseServicesRuntimes maps each services.json service `name` → its declared
 * `runtime` (python|node). simplify-deploy-theokit-runtime-wiring T3.1a (F-dom-2):
 * the build pipeline dispatches the build strategy on `runtime`, so the deploy
 * payload must carry it. A malformed services.json yields an empty map (callers
 * treat enrichment as best-effort; the API re-validates on upload and an empty
 * runtime fails closed at build time per D4).
 */
export function parseServicesRuntimes(jsonContent: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const parsed = JSON.parse(jsonContent) as {
      services?: Array<{ name?: string; runtime?: string }>;
    };
    for (const s of parsed.services ?? []) {
      if (s.name && s.runtime) {
        out[s.name] = s.runtime;
      }
    }
  } catch {
    // malformed JSON → empty map (best-effort; see doc comment)
  }
  return out;
}

/**
 * parseServicesStarts mirrors parseServicesRuntimes but extracts the `start`
 * command per service. The canonical Dockerfile generator on the API side
 * requires it (no heuristic CMD fallback per simplify-deploy-theokit-only v2.0).
 * Without this the build step `generate-dockerfile` fails with
 * `app "X" has no declared start command`.
 */
export function parseServicesStarts(jsonContent: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const parsed = JSON.parse(jsonContent) as {
      services?: Array<{ name?: string; start?: string }>;
    };
    for (const s of parsed.services ?? []) {
      if (s.name && s.start) {
        out[s.name] = s.start;
      }
    }
  } catch {
    // malformed JSON → empty map
  }
  return out;
}
