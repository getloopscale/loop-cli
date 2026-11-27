// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// Plan loopstore-sync T1.1 — the 3-state delta classifier (rclone truth
// table, references/rclone/cmd/bisync/deltas.go). Pure + total: every
// (local, remote, manifest) combination maps to exactly one Kind.

import { classify } from '../../../src/lib/sync-delta';

const A = 'aaa';
const B = 'bbb';
const C = 'ccc';

describe('sync-delta classify', () => {
  it('all three equal → unchanged (noop)', () => {
    expect(classify(A, A, A).kind).toBe('unchanged');
  });

  it('local changed, remote == manifest → push', () => {
    expect(classify(B, A, A).kind).toBe('push');
  });

  it('remote changed, local == manifest → pull', () => {
    expect(classify(A, B, A).kind).toBe('pull');
  });

  it('both changed to DIFFERENT content → conflict', () => {
    expect(classify(B, C, A).kind).toBe('conflict');
  });

  it('both changed to the SAME content → unchanged (converged independently)', () => {
    expect(classify(B, B, A).kind).toBe('unchanged');
  });

  it('local deleted (absent), remote == manifest → pushDelete', () => {
    expect(classify(undefined, A, A).kind).toBe('pushDelete');
  });

  it('remote deleted (absent), local == manifest → pullDelete', () => {
    expect(classify(A, undefined, A).kind).toBe('pullDelete');
  });

  it('new on both sides, same content → unchanged', () => {
    expect(classify(A, A, undefined).kind).toBe('unchanged');
  });

  it('new on both sides, different content → conflict', () => {
    expect(classify(A, B, undefined).kind).toBe('conflict');
  });

  it('new local only (no manifest, no remote) → push', () => {
    expect(classify(A, undefined, undefined).kind).toBe('push');
  });

  it('new remote only (no manifest, no local) → pull', () => {
    expect(classify(undefined, A, undefined).kind).toBe('pull');
  });

  it('deleted on both sides (all absent) → unchanged', () => {
    expect(classify(undefined, undefined, A).kind).toBe('unchanged');
  });
});
