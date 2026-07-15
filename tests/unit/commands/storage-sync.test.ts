// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan theo-storage-sync — engine tests. This file grows across T0.2 (ports +
// path-safety + fs LocalPort), T2.1 (plan), T2.2 (apply/idempotency/conflict).

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  resolveWithinRoot,
  createFsLocalPort,
  RemotePort,
  LocalPort,
  RemoteEntry,
} from '../../../src/commands/storage-sync';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'theo-sync-engine-'));
}

// In-memory fakes used by later phases (T2.x). Declared here (T0.2) to prove the
// port interfaces are satisfiable without any real backend (DIP).
class FakeRemote implements RemotePort {
  constructor(private store: Map<string, { buf: Buffer; contentType: string }> = new Map()) {}
  async listAll(): Promise<RemoteEntry[]> {
    return [...this.store.entries()].map(([p, v]) => ({ path: p, size: v.buf.length, contentType: v.contentType }));
  }
  async download(p: string): Promise<Buffer> {
    const v = this.store.get(p);
    if (!v) throw Object.assign(new Error('not found'), { status: 404 });
    return v.buf;
  }
  async upload(p: string, buf: Buffer, contentType: string): Promise<void> {
    this.store.set(p, { buf, contentType });
  }
  async del(p: string): Promise<void> {
    this.store.delete(p);
  }
}

describe('storage-sync T0.2 — ports + path safety', () => {
  it('fakes satisfy the RemotePort interface (round-trip)', async () => {
    const r: RemotePort = new FakeRemote();
    await r.upload('a.txt', Buffer.from('A'), 'text/plain');
    expect((await r.listAll('')).map((e) => e.path)).toEqual(['a.txt']);
    expect((await r.download('a.txt')).toString()).toBe('A');
    await r.del('a.txt');
    expect(await r.listAll('')).toEqual([]);
  });

  it('resolveWithinRoot rejects traversal and absolute keys, accepts safe keys (EC-1)', () => {
    const root = '/home/u/ws';
    expect(resolveWithinRoot(root, 'a/b.txt')).toBe(path.join(root, 'a/b.txt'));
    expect(resolveWithinRoot(root, '../../etc/passwd')).toBeNull();
    expect(resolveWithinRoot(root, '/etc/passwd')).toBeNull();
    expect(resolveWithinRoot(root, 'a/../../x')).toBeNull();
  });

  it('createFsLocalPort.walk excludes the .theo control dir (EC-2)', async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, 'keep.txt'), 'k');
    await fs.mkdir(path.join(dir, '.theo'), { recursive: true });
    await fs.writeFile(path.join(dir, '.theo', '.sync-manifest.json'), '{}');
    const local: LocalPort = createFsLocalPort(dir);
    const walked = await local.walk();
    expect(walked).toContain('keep.txt');
    expect(walked.some((p) => p.startsWith('.theo/'))).toBe(false);
  });

  it('createFsLocalPort.walk does not follow symlinks (EC-3)', async () => {
    const dir = await tmp();
    const outside = await tmp();
    await fs.writeFile(path.join(outside, 'secret.txt'), 's');
    await fs.symlink(outside, path.join(dir, 'link'));
    const local = createFsLocalPort(dir);
    const walked = await local.walk();
    expect(walked.some((p) => p.includes('secret.txt'))).toBe(false);
  });

  it('createFsLocalPort read/write/hash round-trips a file under root', async () => {
    const dir = await tmp();
    const local = createFsLocalPort(dir);
    await local.write('sub/x.txt', Buffer.from('hello'));
    expect((await local.read('sub/x.txt')).toString()).toBe('hello');
    expect(await local.hash('sub/x.txt')).toMatch(/^[0-9a-f]{64}$/);
  });
});
