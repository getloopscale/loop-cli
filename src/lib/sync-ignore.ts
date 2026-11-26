// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// Plan loopstore-sync — .loopscaleignore support. A gitignore-style ignore file at
// the sync root scopes what `loopscale storage sync` walks/pushes/pulls. This keeps a
// large or sensitive subtree (e.g. `knowledge-base/`, `*.local.*`) out of the sync
// declaratively — the same familiar model as .dockerignore / .npmignore — instead
// of repeated `--exclude` globs.
//
// Rule 9 (don't reinvent): the matcher is the `ignore` package (v7 — the same
// engine eslint/prettier use), so negation (`!`), directory (`foo/`), and anchored
// (`/foo`) patterns behave EXACTLY like git. The loader is pure I/O + returns a
// predicate, so the engine (ADR D3) receives a function and stays fs-free.

import { promises as fs } from 'fs';
import path from 'path';

import ignore from 'ignore';

/** Ignore files read at the sync root, in precedence order (both optional). */
export const SYNC_IGNORE_FILES = ['.loopscaleignore', '.gitignore'] as const;

/**
 * Build a gitignore-style predicate for the sync root by reading `.loopscaleignore`
 * then `.gitignore` (both optional). Returns `(rel) => boolean` over
 * prefix-relative POSIX paths. When no ignore file exists, the predicate matches
 * nothing (identity — the sync behaves exactly as before this feature).
 */
export async function loadSyncIgnore(root: string): Promise<(rel: string) => boolean> {
  const ig = ignore();
  let any = false;
  for (const name of SYNC_IGNORE_FILES) {
    const content = await fs.readFile(path.join(root, name), 'utf-8').catch(() => null);
    if (content !== null) {
      ig.add(content);
      any = true;
    }
  }
  if (!any) return () => false;
  // `ignore` throws on '' — the engine never asks about the root, but guard anyway.
  return (rel: string): boolean => rel !== '' && ig.ignores(rel);
}
