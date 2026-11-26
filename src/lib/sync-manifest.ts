// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// Plan loopstore-sync T0.1 (ADR D1) — the persisted "third state" of sync.
//
// `.loopscale/.sync-manifest.json` maps each synced path -> its ContentsSHA256 at the
// last successful sync. Comparing (local-now, remote-now, manifest=last-synced)
// is what lets sync distinguish "the user edited this locally" from "the remote
// changed" (blueprint D1; mirrors chezmoi's per-entry ContentsSHA256).

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

/** The reserved control directory inside a synced local dir. Never synced (EC-2). */
export const LOOPSCALE_CONTROL_DIR = '.loopscale';
const MANIFEST_FILE = '.sync-manifest.json';

/** Last-synced fingerprint map: path (relative to prefix) -> ContentsSHA256 (hex). */
export interface Manifest {
  version: 1;
  prefix: string;
  paths: Record<string, string>;
}

/** Raised when the on-disk manifest exists but cannot be parsed (fail-clear). */
export class SyncManifestError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'SyncManifestError';
  }
}

/** SHA-256 of the bytes, hex-encoded. The per-path fingerprint sync persists. */
export function hashBytes(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function manifestPath(dir: string): string {
  return path.join(dir, LOOPSCALE_CONTROL_DIR, MANIFEST_FILE);
}

/**
 * Read the manifest for `dir`. An absent manifest means "first sync" and returns
 * an empty manifest. A malformed manifest throws — never silently empty, because
 * a silent-empty would misclassify every same-content path as a fresh conflict.
 */
export async function readManifest(dir: string): Promise<Manifest> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath(dir), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, prefix: '', paths: {} };
    }
    throw new SyncManifestError(`cannot read sync manifest in ${dir}`, err);
  }
  try {
    const parsed = JSON.parse(raw) as Manifest;
    return { version: 1, prefix: parsed.prefix ?? '', paths: parsed.paths ?? {} };
  } catch (err) {
    throw new SyncManifestError(`sync manifest in ${dir} is corrupt`, err);
  }
}

/**
 * Persist the manifest atomically: write a sibling temp file then rename over the
 * target, so a crash mid-write never leaves a truncated manifest (Drawback #4).
 */
export async function writeManifest(dir: string, m: Manifest): Promise<void> {
  const controlDir = path.join(dir, LOOPSCALE_CONTROL_DIR);
  await fs.mkdir(controlDir, { recursive: true });
  const target = path.join(controlDir, MANIFEST_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(m, null, 2));
  await fs.rename(tmp, target);
}
