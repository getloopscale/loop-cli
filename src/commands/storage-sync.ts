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
  return isWithinRoot(rootResolved, candidate) ? candidate : null;
}

/** True if an already-resolved absolute path is the root or strictly under it. */
function isWithinRoot(root: string, absPath: string): boolean {
  const rootResolved = path.resolve(root);
  if (absPath === rootResolved) return true;
  const withSep = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
  return absPath.startsWith(withSep);
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

  /**
   * EC-3 write-side hardening (F-sec-1). `resolveWithinRoot` validates the path
   * STRING, but `fs.writeFile` would still follow a pre-existing symlink at the
   * target — or through a symlinked directory component — escaping the root. Before
   * writing, resolve the real parent dir and refuse if it escaped, and refuse if the
   * final component is an existing symlink. Never follow a link out of the sync root.
   */
  async function assertSafeWriteTarget(target: string): Promise<void> {
    const parent = path.dirname(target);
    await fs.mkdir(parent, { recursive: true });
    const realParent = await fs.realpath(parent); // resolves any symlinked ancestor
    if (!isWithinRoot(root, realParent)) {
      throw new Error(`unsafe local path: symlinked directory escapes the sync root`);
    }
    const existing = await fs.lstat(target).catch(() => null);
    if (existing && existing.isSymbolicLink()) {
      throw new Error(`unsafe local path: refusing to write through a symlink`);
    }
  }

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
      if (e.name.includes(BACKUP_MARKER)) continue; // F-sec-6 — never push conflict backups to remote
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
      await assertSafeWriteTarget(target); // F-sec-1: never follow a symlink out of root
      await fs.writeFile(target, buf);
    },
    del: async (rel) => {
      // fs.rm removes the link itself, not its target — safe against symlink escape.
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
/** Marker embedded in conflict-backup filenames; excluded from sync (F-sec-6). */
const BACKUP_MARKER = '.theo-backup-';

/** Stable skip reason for an op that failed mid-apply (F-test-1). */
function opFailureReason(err: unknown): string {
  const status = (err as { status?: number })?.status;
  return status ? `SYNC_OP_FAILED_${status}` : 'SYNC_OP_FAILED';
}

/**
 * Map a sync outcome to the permanent CLI exit-code contract (Rule 4):
 * 0 success · 1 usage · 4 auth · 5 partial (conflicts left unresolved or paths
 * skipped). Pure so every branch is unit-testable without a live backend.
 */
export function syncExitCode(opts: { result?: SyncResult; errorStatus?: number; usageError?: boolean }): number {
  if (opts.usageError) return 1;
  // Mirror the sibling storage command's status→code mapping (storage.ts mapError)
  // so the SAME backend condition yields the SAME exit code across subcommands (F-cli-1).
  const s = opts.errorStatus;
  if (s === 401 || s === 403) return 4; // auth / missing scope
  if (s === 400 || s === 402 || s === 404 || s === 413) return 1; // usage / plan-limit / not-found / too-large
  if (s) return 5; // any other backend failure → partial
  if (!opts.result) return 5;
  return opts.result.conflicts.length > 0 || opts.result.skipped.length > 0 ? 5 : 0;
}

/**
 * Actionable, product-language error message for a failed sync (Rule 3 + Rule 5 —
 * error messages suggest a next action). Never echoes the raw HTTP message (F-cli-2).
 */
export function syncErrorMessage(status?: number): string {
  switch (status) {
    case 401:
    case 403:
      return 'Access denied. Run `theo login` and make sure your access has storage read/write.';
    case 402:
      return "You've reached your plan's storage limit. Delete files or upgrade, then try again.";
    case 413:
      return 'A file is larger than your plan allows. Remove it and try again.';
    case 404:
      return 'That storage folder was not found. Check the --prefix and try again.';
    default:
      return 'Sync failed. Check your connection and try again.';
  }
}

/**
 * Render a sync result into a product-language human summary + a stable JSON
 * shape (Rule 3 + Rule 5). Never mentions the underlying storage internals.
 */
export function summarizeSync(result: SyncResult): { text: string; json: SyncResult } {
  const pulled = result.applied.filter((o) => o.kind === 'pull' || o.kind === 'pullDelete').length;
  const pushed = result.applied.filter((o) => o.kind === 'push' || o.kind === 'pushDelete').length;
  const lines = [`Synced: ${pulled} pulled, ${pushed} pushed, ${result.conflicts.length} conflicts, ${result.skipped.length} skipped.`];
  for (const c of result.conflicts) {
    lines.push(`Conflict: ${c.path} — changed in both places. Resolve with --strategy=pull|push|backup.`);
  }
  for (const s of result.skipped) {
    lines.push(`Skipped: ${s.path} — unsafe path, not written.`);
  }
  return { text: lines.join('\n'), json: result };
}

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
    const skipped: SyncSkip[] = [...plan.skipped];
    const conflictPaths = new Set(plan.conflicts.map((c) => c.path));

    for (const op of plan.applied) {
      if (op.kind === 'push' && (await this.remoteDriftedSinceSync(op.path, manifest))) {
        conflictPaths.add(op.path); // TOCTOU — do not clobber the drifted remote
        continue;
      }
      // F-test-1: one op failing (e.g. 413/402/ENOSPC) must not abort the whole
      // sync — record it as skipped, keep applying the rest; the manifest is only
      // updated for ops that actually succeeded (applyOp mutates it inline).
      try {
        await this.applyOp(op, manifest);
        applied.push(op);
      } catch (err) {
        skipped.push({ path: op.path, reason: opFailureReason(err) });
      }
    }

    for (const path of conflictPaths) {
      if (!strategy) {
        conflicts.push({ path });
        continue;
      }
      try {
        applied.push(await this.resolveConflict(path, strategy, manifest));
      } catch (err) {
        skipped.push({ path, reason: opFailureReason(err) });
      }
    }

    await writeManifest(this.dir, { version: 1, prefix: this.prefix, paths: manifest.paths });
    return { applied, conflicts, skipped };
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
    // The backup name carries a random suffix so two backups of the same path (even
    // within the same millisecond) never collide and destroy the earlier copy (F-sec-6).
    if (strategy === 'backup') {
      const local = await this.safeRead(rel);
      if (local) {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await this.local.write(`${rel}${BACKUP_MARKER}${suffix}`, local);
      }
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
