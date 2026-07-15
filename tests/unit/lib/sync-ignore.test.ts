// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan theo-storage-sync — .theoignore support. A gitignore-style ignore file at
// the sync root scopes what `theo storage sync` walks/pushes/pulls, so a large
// or sensitive dir (e.g. knowledge-base/, *.local.*) is excluded declaratively
// instead of via repeated --exclude globs. Reuses the `ignore` package (Rule 9).

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { loadSyncIgnore } from '../../../src/lib/sync-ignore';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'theo-sync-ignore-'));
}

describe('loadSyncIgnore — gitignore-style matcher for the sync root', () => {
  it('returns a match-nothing predicate when no ignore file exists', async () => {
    const dir = await tmp();
    const ig = await loadSyncIgnore(dir);
    expect(ig('anything/at/all.md')).toBe(false);
    expect(ig('')).toBe(false);
  });

  it('excludes a directory pattern (knowledge-base/) and everything under it', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, '.theoignore'), 'knowledge-base/\n');
    const ig = await loadSyncIgnore(dir);
    // The engine only ever queries FILE paths (walkDir pushes e.isFile() only),
    // so matching every path UNDER the dir is exactly what's needed. `ignore`
    // follows git: `foo/` matches foo's contents, not the bare "foo" string.
    expect(ig('knowledge-base/plans/x.md')).toBe(true);
    expect(ig('knowledge-base/deeply/nested/audit.md')).toBe(true);
    expect(ig('rules/testing.md')).toBe(false); // sibling not ignored
    expect(ig('knowledge-base-notes.md')).toBe(false); // similarly-named sibling not swept
  });

  it('supports glob + anchored + negation like git', async () => {
    const dir = await tmp();
    await fs.writeFile(
      path.join(dir, '.theoignore'),
      ['*.local.json', 'agents/**', '!agents/keep.md', '/only-root.txt'].join('\n'),
    );
    const ig = await loadSyncIgnore(dir);
    expect(ig('settings.local.json')).toBe(true); // *.local.json
    expect(ig('agents/foo.md')).toBe(true); // agents/**
    expect(ig('agents/keep.md')).toBe(false); // negation re-includes
    expect(ig('only-root.txt')).toBe(true); // anchored to root
    expect(ig('sub/only-root.txt')).toBe(false); // anchored — not nested
    expect(ig('settings.json')).toBe(false);
  });

  it('merges .theoignore and .gitignore (both honored)', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, '.theoignore'), 'from-theoignore/\n');
    await fs.writeFile(path.join(dir, '.gitignore'), 'from-gitignore/\n');
    const ig = await loadSyncIgnore(dir);
    expect(ig('from-theoignore/a')).toBe(true);
    expect(ig('from-gitignore/b')).toBe(true);
  });
});
