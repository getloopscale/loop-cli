// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan theo-storage-sync T3.1 — the CLI output contract (exit codes Rule 4,
// --json stability Rule 5, product language Rule 3). These are pure functions so
// the whole contract is unit-testable without a live backend.

import { syncExitCode, summarizeSync, SyncResult } from '../../../src/commands/storage-sync';

const EMPTY: SyncResult = { applied: [], conflicts: [], skipped: [] };

describe('storage-sync T3.1 — CLI output contract', () => {
  it('a clean sync exits 0', () => {
    expect(syncExitCode({ result: { ...EMPTY, applied: [{ kind: 'pull', path: 'a' }] } })).toBe(0);
  });

  it('an unresolved conflict exits 5 (partial)', () => {
    expect(syncExitCode({ result: { ...EMPTY, conflicts: [{ path: 'a' }] } })).toBe(5);
  });

  it('a skipped unsafe path exits 5 (partial)', () => {
    expect(syncExitCode({ result: { ...EMPTY, skipped: [{ path: '../x', reason: 'SYNC_UNSAFE_PATH' }] } })).toBe(5);
  });

  it('a missing prefix is a usage error (exit 1)', () => {
    expect(syncExitCode({ usageError: true })).toBe(1);
  });

  it('a 401 from the backend is an auth error (exit 4)', () => {
    expect(syncExitCode({ errorStatus: 401 })).toBe(4);
  });

  it('--json emits a stable { applied, conflicts, skipped } shape', () => {
    const out = summarizeSync({
      applied: [{ kind: 'pull', path: 'a' }],
      conflicts: [{ path: 'b' }],
      skipped: [{ path: '../c', reason: 'SYNC_UNSAFE_PATH' }],
    });
    expect(Object.keys(out.json).sort()).toEqual(['applied', 'conflicts', 'skipped']);
    expect(out.json.applied).toEqual([{ kind: 'pull', path: 'a' }]);
    expect(out.json.conflicts).toEqual([{ path: 'b' }]);
  });

  it('the human summary lists conflicts and points to --strategy', () => {
    const out = summarizeSync({ ...EMPTY, conflicts: [{ path: 'notes.md' }] });
    expect(out.text).toMatch(/notes\.md/);
    expect(out.text).toMatch(/--strategy/);
  });

  it('output uses product language only (no infra terms — Rule 3)', () => {
    const out = summarizeSync({
      applied: [{ kind: 'push', path: 'a' }],
      conflicts: [{ path: 'b' }],
      skipped: [{ path: '../c', reason: 'SYNC_UNSAFE_PATH' }],
    });
    expect(out.text).not.toMatch(/\bS3\b|bucket|MinIO/i);
    expect(JSON.stringify(out.json)).not.toMatch(/\bS3\b|bucket|MinIO/i);
  });
});
