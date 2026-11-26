// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// Plan loopstore-sync T1.1 (ADR D1/D2) — the 3-state delta classifier.
//
// Ports rclone's bisync delta model (references/rclone/cmd/bisync/deltas.go):
// compare each side's current content hash against the manifest (last-synced)
// to decide what changed, and flag a conflict when BOTH sides changed and
// disagree. Pure + total: every (local, remote, manifest) triple maps to one
// Kind. Hashes are `undefined` when the path is absent on that side.

export type Kind = 'unchanged' | 'pull' | 'push' | 'pullDelete' | 'pushDelete' | 'conflict';

export interface Delta {
  kind: Kind;
}

/**
 * Classify a single path from its three content states.
 * @param local    hash on disk now, or undefined if absent locally
 * @param remote   hash in storage now, or undefined if absent remotely
 * @param manifest hash at last sync, or undefined if never synced
 */
export function classify(local?: string, remote?: string, manifest?: string): Delta {
  // Both sides identical (same content, or both absent) → nothing to do. This
  // also absorbs "both changed to the same content" (independent convergence).
  if (local === remote) return { kind: 'unchanged' };

  const localChanged = local !== manifest;
  const remoteChanged = remote !== manifest;

  if (localChanged && remoteChanged) return { kind: 'conflict' };
  if (localChanged) return { kind: local !== undefined ? 'push' : 'pushDelete' };
  // remoteChanged (the only remaining case, since local === remote is excluded)
  return { kind: remote !== undefined ? 'pull' : 'pullDelete' };
}
