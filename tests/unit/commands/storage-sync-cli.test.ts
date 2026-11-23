// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan theo-storage-sync T3.1 — the CLI output contract (exit codes Rule 4,
// --json stability Rule 5, product language Rule 3). These are pure functions so
// the whole contract is unit-testable without a live backend.

import { syncExitCode, summarizeSync, syncErrorMessage, httpStatusOf, SyncResult } from '../../../src/commands/storage-sync';
import { normalizePrefix } from '../../../src/register/storage';

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

  it('httpStatusOf reads BOTH error shapes — plain .status AND ApiError .statusCode (LIVE P1)', () => {
    // LIVE regression: listAll runs first via ApiClient, which throws ApiError with
    // .statusCode (not .status). The action read only .status → a 401 mapped to exit 5.
    expect(httpStatusOf({ status: 401 })).toBe(401); // httpBinary shape (download/upload)
    expect(httpStatusOf({ statusCode: 401 })).toBe(401); // ApiError shape (listAll)
    expect(httpStatusOf(new Error('boom'))).toBeUndefined();
    // End-to-end: an ApiError-shaped 401 must map to exit 4, not 5.
    expect(syncExitCode({ errorStatus: httpStatusOf({ statusCode: 401 }) })).toBe(4);
    expect(syncExitCode({ errorStatus: httpStatusOf({ statusCode: 402 }) })).toBe(1);
  });

  it('exit-code mapping mirrors the sibling storage command (F-cli-1)', () => {
    expect(syncExitCode({ errorStatus: 403 })).toBe(4); // missing scope → auth
    expect(syncExitCode({ errorStatus: 402 })).toBe(1); // plan limit → usage
    expect(syncExitCode({ errorStatus: 413 })).toBe(1); // too large → usage
    expect(syncExitCode({ errorStatus: 404 })).toBe(1); // not found → usage
    expect(syncExitCode({ errorStatus: 500 })).toBe(5); // server error → partial
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

  it('normalizePrefix collapses to a single trailing slash; empty stays empty (EC-4)', () => {
    expect(normalizePrefix('.claude')).toBe('.claude/');
    expect(normalizePrefix('.claude/')).toBe('.claude/');
    expect(normalizePrefix('.claude///')).toBe('.claude/');
    expect(normalizePrefix('./config')).toBe('config/');
    expect(normalizePrefix('  a/b  ')).toBe('a/b/');
    expect(normalizePrefix('')).toBe('');
    expect(normalizePrefix('/')).toBe('');
  });

  it('syncErrorMessage is actionable per status and uses product language (F-cli-2)', () => {
    expect(syncErrorMessage(403)).toMatch(/loopscale login|access/i);
    expect(syncErrorMessage(402)).toMatch(/plan|upgrade|limit/i);
    expect(syncErrorMessage(413)).toMatch(/larger|too large|remove/i);
    expect(syncErrorMessage(404)).toMatch(/--prefix|not found/i);
    expect(syncErrorMessage(500)).toMatch(/try again/i);
    for (const s of [401, 402, 403, 404, 413, 500, undefined]) {
      expect(syncErrorMessage(s)).not.toMatch(/\bS3\b|bucket|MinIO|\bPUT\b|\bGET\b/i);
    }
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
