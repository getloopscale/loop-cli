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

import { hashBytes, THEO_CONTROL_DIR } from '../lib/sync-manifest';

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
