// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan v1.1 T2.1 (theo-cli-vercel-like-ux) — resolve the `theokit` binary
// from local `node_modules/.bin` → system PATH → `THEOKIT_BIN` env var.
//
// v1.1 ADR D1 amendment (covers EC-1 + EC-6):
//   validateCandidate(path) = fs.statSync(path).isFile() && (mode & 0o111) !== 0.
//   Every candidate (walk-up hit, which/where fallback, env-var path) is
//   validated. Env-var path that fails validation throws immediately.

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const WIN32 = process.platform === 'win32';
const BIN_NAME = WIN32 ? 'theokit.cmd' : 'theokit';

/**
 * Thrown when no usable `theokit` binary can be resolved. Carries an install
 * hint covering both local and global flavors.
 */
export class TheokitBinaryNotFoundError extends Error {
  public readonly code = 'THEOKIT_BINARY_NOT_FOUND';
  constructor(message?: string) {
    super(
      message ??
        'theokit binary not found.\n\n' +
          'Install with:\n' +
          '  - In your project: npm install theokit\n' +
          '  - Globally:        npm install -g theokit\n\n' +
          'If installed but not detected, set THEOKIT_BIN to the absolute path.',
    );
    this.name = 'TheokitBinaryNotFoundError';
  }
}

/**
 * Returns true when `candidate` is an existing regular file with at least one
 * executable bit set. False for missing paths, directories, and files without
 * any executable bit. EC-1 + EC-6 absorbed.
 */
export function validateCandidate(candidate: string): boolean {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function walkUpForBin(cwd: string): string | null {
  let dir = cwd;
  while (true) {
    const candidate = path.join(dir, 'node_modules', '.bin', BIN_NAME);
    if (validateCandidate(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function fallbackToWhich(): string | null {
  try {
    const cmd = WIN32 ? `where ${BIN_NAME}` : `which ${BIN_NAME}`;
    const output = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' });
    const firstLine = output.split(/\r?\n/)[0]?.trim() ?? '';
    if (firstLine === '') return null;
    return validateCandidate(firstLine) ? firstLine : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the path to the `theokit` binary. Order (per ADR D1):
 *
 *   1. `THEOKIT_BIN` env-var override (validated, throws if invalid).
 *   2. Walk up from `cwd` looking for `node_modules/.bin/theokit`.
 *   3. `which theokit` (Unix) / `where theokit` (Windows).
 *   4. Throw `TheokitBinaryNotFoundError` with install hint.
 */
export function resolveTheokitBin(cwd: string): string {
  const envOverride = process.env.THEOKIT_BIN;
  if (envOverride !== undefined && envOverride !== '') {
    if (!validateCandidate(envOverride)) {
      throw new TheokitBinaryNotFoundError(
        `THEOKIT_BIN=${envOverride} is not an executable file; unset it or fix the path.`,
      );
    }
    return envOverride;
  }
  const walkUpHit = walkUpForBin(cwd);
  if (walkUpHit !== null) return walkUpHit;
  const whichHit = fallbackToWhich();
  if (whichHit !== null) return whichHit;
  throw new TheokitBinaryNotFoundError();
}
