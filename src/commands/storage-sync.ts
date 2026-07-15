// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan theo-storage-sync — the sync engine. Pure over two injected ports
// (RemotePort / LocalPort, DIP per ADR D3) so it is testable with in-memory
// fakes and never imports `fs`/HTTP directly in its classification logic.
//
// Grows across: T0.2 (ports + path safety + fs LocalPort), T1.1 (delta),
// T2.1 (plan), T2.2 (apply/idempotency/conflict).

import { promises as fs, Dirent } from 'fs';
import path from 'path';

import { hashBytes, readManifest, writeManifest, THEO_CONTROL_DIR, Manifest } from '../lib/sync-manifest';
import { classify, Kind } from '../lib/sync-delta';
import { guessContentType } from '../lib/content-type';

/** Conflict resolution strategy for `run()`. */
export type SyncStrategy = 'pull' | 'push' | 'backup';

/** A remote object as seen by `listAll`. `fingerprint` is optional (Q2). */
export interface RemoteEntry {
  path: string;
  size: number;
  contentType: string;
  fingerprint?: string;
}

/** Remote boundary — backed at the composition root by the M7 ApiClient (D3/D5). */
export interface RemotePort {
  listAll(prefix: string): Promise<RemoteEntry[]>;
  download(path: string): Promise<Buffer>;
  upload(path: string, buf: Buffer, contentType: string): Promise<void>;
  del(path: string): Promise<void>;
}

/** Local filesystem boundary — I/O only, no classification logic. */
export interface LocalPort {
  walk(): Promise<string[]>;
  read(path: string): Promise<Buffer>;
  write(path: string, buf: Buffer): Promise<void>;
  del(path: string): Promise<void>;
  hash(path: string): Promise<string>;
}

/**
 * Path-safety guard (EC-1). Returns the absolute path for `key` ONLY if it stays
 * under `root`; returns null for any key that escapes (`../`, absolute). Every
 * pull-write / pull-delete resolves through this so a pathological remote key can
 * never write outside the sync root.
 */
export function resolveWithinRoot(root: string, key: string): string | null {
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, key);
  if (candidate === rootResolved) return null; // the root itself is not a file target
  const withSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  return candidate.startsWith(withSep) ? candidate : null;
}

/**
 * A real filesystem-backed LocalPort rooted at `root`. `walk` returns relative
 * POSIX-style paths, excludes the reserved `.theo/` control dir (EC-2), and does
 * NOT follow symlinks (EC-3). Writes go through `resolveWithinRoot`.
 */
export function createFsLocalPort(root: string): LocalPort {
  const abs = (rel: string): string => {
    const resolved = resolveWithinRoot(root, rel);
    if (!resolved) throw new Error(`unsafe local path: ${rel}`);
    return resolved;
  };

  async function walkDir(relDir: string): Promise<string[]> {
    const full = relDir === '' ? path.resolve(root) : path.join(path.resolve(root), relDir);
    let entries: Dirent[];
    try {
      entries = await fs.readdir(full, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      const rel = relDir === '' ? e.name : `${relDir}/${e.name}`;
      if (rel === THEO_CONTROL_DIR || rel.startsWith(`${THEO_CONTROL_DIR}/`)) continue; // EC-2
      if (e.isSymbolicLink()) continue; // EC-3 — never traverse or push through a symlink
      if (e.isDirectory()) {
        out.push(...(await walkDir(rel)));
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
    return out;
  }

  return {
    walk: () => walkDir(''),
    read: (rel) => fs.readFile(abs(rel)),
    write: async (rel, buf) => {
      const target = abs(rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buf);
    },
    del: async (rel) => {
      await fs.rm(abs(rel), { force: true });
    },
    hash: async (rel) => hashBytes(await fs.readFile(abs(rel))),
  };
}

/** A single applicable operation in a sync plan. */
export interface SyncOp {
  kind: Extract<Kind, 'pull' | 'push' | 'pullDelete' | 'pushDelete'>;
  path: string;
}

export interface SyncConflict {
  path: string;
}

export interface SyncSkip {
  path: string;
  reason: string;
}

/** The classified plan (plan()) or the applied result (run()). */
export interface SyncResult {
  applied: SyncOp[];
  conflicts: SyncConflict[];
  skipped: SyncSkip[];
}

const UNSAFE_PATH = 'SYNC_UNSAFE_PATH';

/**
 * The sync engine. Composes a RemotePort + LocalPort + the local manifest into a
 * plan of ops (plan()), then applies the non-conflicting ones (run(), T2.2).
 * Pure over the ports — no direct fs/HTTP in its classification logic (ADR D3).
 */
export class SyncEngine {
  // Buffers downloaded during plan() are cached so run() does not re-download.
  private readonly remoteCache = new Map<string, { buf: Buffer; contentType: string }>();

  constructor(
    private readonly remote: RemotePort,
    private readonly local: LocalPort,
    private readonly dir: string,
    private readonly prefix: string,
  ) {}

  /** Map a remote object key to its path relative to the synced prefix. */
  private toRelative(key: string): string {
    return this.prefix && key.startsWith(this.prefix) ? key.slice(this.prefix.length) : key;
  }

  /** Map a prefix-relative path back to its remote object key. */
  private toRemoteKey(rel: string): string {
    return this.prefix ? `${this.prefix}${rel}` : rel;
  }

  /**
   * Classify the whole prefix into applicable ops / conflicts / skips WITHOUT
   * mutating either side. Remote content is downloaded to hash (D5 / Drawback #3);
   * the buffer is cached for the apply phase.
   */
  async plan(): Promise<SyncResult> {
    const manifest = await readManifest(this.dir);

    const localHashes = new Map<string, string>();
    for (const rel of await this.local.walk()) {
      localHashes.set(rel, await this.local.hash(rel));
    }

    const remoteHashes = new Map<string, string>();
    const skipped: SyncSkip[] = [];
    for (const entry of await this.remote.listAll(this.prefix)) {
      const rel = this.toRelative(entry.path);
      if (resolveWithinRoot(this.dir, rel) === null) {
        skipped.push({ path: entry.path, reason: UNSAFE_PATH }); // EC-1
        continue;
      }
      const buf = await this.remote.download(entry.path);
      this.remoteCache.set(rel, { buf, contentType: entry.contentType });
      remoteHashes.set(rel, hashBytes(buf));
    }

    const paths = new Set<string>([...localHashes.keys(), ...remoteHashes.keys(), ...Object.keys(manifest.paths)]);
    const applied: SyncOp[] = [];
    const conflicts: SyncConflict[] = [];
    for (const rel of [...paths].sort()) {
      if (rel === '' || rel === THEO_CONTROL_DIR || rel.startsWith(`${THEO_CONTROL_DIR}/`)) continue; // EC-2
      const { kind } = classify(localHashes.get(rel), remoteHashes.get(rel), manifest.paths[rel]);
      if (kind === 'unchanged') continue;
      if (kind === 'conflict') conflicts.push({ path: rel });
      else applied.push({ kind, path: rel });
    }

    return { applied, conflicts, skipped };
  }

  /**
   * Apply the plan: perform non-conflicting ops both directions, resolve conflicts
   * per `strategy` (or leave them untouched and report them), persist the manifest.
   * A push that finds the remote drifted since the plan (TOCTOU, Drawback #2) is
   * downgraded to a conflict rather than clobbering the drifted remote.
   */
  async run(strategy?: SyncStrategy): Promise<SyncResult> {
    const plan = await this.plan();
    const manifest = await readManifest(this.dir);
    const applied: SyncOp[] = [];
    const conflicts: SyncConflict[] = [];
    const conflictPaths = new Set(plan.conflicts.map((c) => c.path));

    for (const op of plan.applied) {
      if (op.kind === 'push' && (await this.remoteDriftedSinceSync(op.path, manifest))) {
        conflictPaths.add(op.path); // TOCTOU — do not clobber the drifted remote
        continue;
      }
      await this.applyOp(op, manifest);
      applied.push(op);
    }

    for (const path of conflictPaths) {
      if (!strategy) {
        conflicts.push({ path });
        continue;
      }
      applied.push(await this.resolveConflict(path, strategy, manifest));
    }

    await writeManifest(this.dir, { version: 1, prefix: this.prefix, paths: manifest.paths });
    return { applied, conflicts, skipped: plan.skipped };
  }

  /** True if the remote object for `rel` no longer matches the last-synced hash. */
  private async remoteDriftedSinceSync(rel: string, manifest: Manifest): Promise<boolean> {
    const expected = manifest.paths[rel];
    if (expected === undefined) return false; // never synced → nothing to drift from
    let buf: Buffer;
    try {
      buf = await this.remote.download(this.toRemoteKey(rel));
    } catch {
      return false; // remote absent now — a delete, handled by classification, not a drift-clobber
    }
    return hashBytes(buf) !== expected;
  }

  private async applyOp(op: SyncOp, manifest: Manifest): Promise<void> {
    switch (op.kind) {
      case 'pull': {
        const buf = await this.remoteBytes(op.path);
        await this.local.write(op.path, buf);
        manifest.paths[op.path] = hashBytes(buf);
        break;
      }
      case 'push': {
        const buf = await this.local.read(op.path);
        await this.remote.upload(this.toRemoteKey(op.path), buf, guessContentType(op.path));
        manifest.paths[op.path] = hashBytes(buf);
        break;
      }
      case 'pullDelete':
        await this.local.del(op.path);
        delete manifest.paths[op.path];
        break;
      case 'pushDelete':
        await this.remote.del(this.toRemoteKey(op.path));
        delete manifest.paths[op.path];
        break;
    }
  }

  private async resolveConflict(rel: string, strategy: SyncStrategy, manifest: Manifest): Promise<SyncOp> {
    if (strategy === 'push') {
      const op: SyncOp = { kind: 'push', path: rel };
      await this.applyOp(op, manifest);
      return op;
    }
    // 'backup' saves the local (losing) side, then falls through to a remote-wins pull.
    if (strategy === 'backup') {
      const local = await this.safeRead(rel);
      if (local) await this.local.write(`${rel}.theo-backup-${Date.now()}`, local);
    }
    const op: SyncOp = { kind: 'pull', path: rel };
    await this.applyOp(op, manifest);
    return op;
  }

  private async safeRead(rel: string): Promise<Buffer | null> {
    try {
      return await this.local.read(rel);
    } catch {
      return null;
    }
  }

  /** Remote bytes for `rel`, from the plan-time cache or a fresh download. */
  private async remoteBytes(rel: string): Promise<Buffer> {
    const cached = this.remoteCache.get(rel);
    if (cached) return cached.buf;
    return this.remote.download(this.toRemoteKey(rel));
  }
}
