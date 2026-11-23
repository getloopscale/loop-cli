// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan theo-storage-sync T0.1 — manifest read/write + ContentsSHA256.
// The manifest (`.theo/.sync-manifest.json`) is the persisted "third state"
// (last-synced hash per path) that lets sync tell "local edit" from "remote
// change" (blueprint D1 / chezmoi entrystate.go:12-27).

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { hashBytes, readManifest, writeManifest, SyncManifestError, Manifest } from '../../../src/lib/sync-manifest';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'loopscale-sync-manifest-'));
}

describe('sync-manifest', () => {
  it('hashBytes is a stable 64-char hex digest', () => {
    const a = hashBytes(Buffer.from('hello'));
    const b = hashBytes(Buffer.from('hello'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashBytes(Buffer.from('world'))).not.toBe(a);
  });

  it('readManifest returns an empty manifest when the file is absent', async () => {
    const dir = await tmp();
    const m = await readManifest(dir);
    expect(m).toEqual({ version: 1, prefix: '', paths: {} });
  });

  it('readManifest throws a typed SyncManifestError on malformed JSON', async () => {
    const dir = await tmp();
    await fs.mkdir(path.join(dir, '.theo'), { recursive: true });
    await fs.writeFile(path.join(dir, '.theo', '.sync-manifest.json'), '{ this is not json');
    await expect(readManifest(dir)).rejects.toBeInstanceOf(SyncManifestError);
  });

  it('writeManifest then readManifest round-trips the paths map', async () => {
    const dir = await tmp();
    const m: Manifest = { version: 1, prefix: '.claude/', paths: { 'a.txt': hashBytes(Buffer.from('A')) } };
    await writeManifest(dir, m);
    const back = await readManifest(dir);
    expect(back).toEqual(m);
  });

  it('writeManifest writes valid JSON at .theo/.sync-manifest.json (atomic, no leftover temp)', async () => {
    const dir = await tmp();
    await writeManifest(dir, { version: 1, prefix: '', paths: { 'x': 'deadbeef' } });
    const raw = await fs.readFile(path.join(dir, '.theo', '.sync-manifest.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const entries = await fs.readdir(path.join(dir, '.theo'));
    expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0);
  });
});
