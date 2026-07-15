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
  SyncEngine,
} from '../../../src/commands/storage-sync';
import { hashBytes, writeManifest } from '../../../src/lib/sync-manifest';

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'theo-sync-engine-'));
}

async function writeManifestFor(dir: string, paths: Record<string, string>): Promise<void> {
  await writeManifest(dir, { version: 1, prefix: '', paths });
}

// In-memory fakes used by later phases (T2.x). Declared here (T0.2) to prove the
// port interfaces are satisfiable without any real backend (DIP).
class FakeRemote implements RemotePort {
  // Simulate a remote mutation that lands AFTER a path is first downloaded
  // (TOCTOU / Drawback #2): { path -> new content, applied on 2nd download }.
  drift = new Map<string, string>();
  private downloaded = new Set<string>();
  constructor(public store: Map<string, { buf: Buffer; contentType: string }> = new Map()) {}
  async listAll(): Promise<RemoteEntry[]> {
    return [...this.store.entries()].map(([p, v]) => ({ path: p, size: v.buf.length, contentType: v.contentType }));
  }
  async download(p: string): Promise<Buffer> {
    if (this.downloaded.has(p) && this.drift.has(p)) {
      this.store.set(p, { buf: Buffer.from(this.drift.get(p)!), contentType: 'text/plain' });
      this.drift.delete(p);
    }
    const v = this.store.get(p);
    if (!v) throw Object.assign(new Error('not found'), { status: 404 });
    this.downloaded.add(p);
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

  it('createFsLocalPort.write refuses to follow a pre-existing FILE symlink out of root (F-sec-1)', async () => {
    const dir = await tmp();
    const outside = await tmp();
    const victim = path.join(outside, 'victim.txt');
    await fs.writeFile(victim, 'ORIGINAL');
    await fs.symlink(victim, path.join(dir, 'evil-link')); // attacker plants an in-root symlink
    const local = createFsLocalPort(dir);
    await expect(local.write('evil-link', Buffer.from('PWNED'))).rejects.toThrow(/unsafe/i);
    expect((await fs.readFile(victim)).toString()).toBe('ORIGINAL'); // untouched
  });

  it('createFsLocalPort.write refuses to write through a symlinked DIRECTORY component (F-sec-1)', async () => {
    const dir = await tmp();
    const outside = await tmp();
    await fs.symlink(outside, path.join(dir, 'linkdir')); // in-root dir symlink → outside
    const local = createFsLocalPort(dir);
    await expect(local.write('linkdir/x.txt', Buffer.from('PWNED'))).rejects.toThrow(/unsafe/i);
    await expect(fs.readFile(path.join(outside, 'x.txt'))).rejects.toBeDefined(); // nothing written outside
  });
});

// Scenario runner: a real local tmpdir <-> an in-memory FakeRemote (the plan's
// default backend). Exercises plan() classification with no side effects.
async function engineFor(
  remoteFiles: Record<string, string> = {},
  localFiles: Record<string, string> = {},
): Promise<{ engine: SyncEngine; dir: string; remote: FakeRemote }> {
  const dir = await tmp();
  const local = createFsLocalPort(dir);
  for (const [p, c] of Object.entries(localFiles)) await local.write(p, Buffer.from(c));
  const remote = new FakeRemote(
    new Map(Object.entries(remoteFiles).map(([p, c]) => [p, { buf: Buffer.from(c), contentType: 'text/plain' }])),
  );
  return { engine: new SyncEngine(remote, local, dir, ''), dir, remote };
}

describe('storage-sync T2.1 — plan (no side effects)', () => {
  it('plan pulls when a file is new on the remote', async () => {
    const { engine } = await engineFor({ 'x.txt': 'X' }, {});
    const p = await engine.plan();
    expect(p.applied).toEqual([{ kind: 'pull', path: 'x.txt' }]);
    expect(p.conflicts).toEqual([]);
  });

  it('plan pushes when a file is new locally', async () => {
    const { engine } = await engineFor({}, { 'y.txt': 'Y' });
    const p = await engine.plan();
    expect(p.applied).toEqual([{ kind: 'push', path: 'y.txt' }]);
  });

  it('plan is a no-op when everything matches the manifest', async () => {
    const { engine, dir } = await engineFor({ 'x.txt': 'X' }, { 'x.txt': 'X' });
    // Prime the manifest so both sides == last-synced.
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('X')) });
    const p = await engine.plan();
    expect(p.applied).toEqual([]);
    expect(p.conflicts).toEqual([]);
  });

  it('plan reports a conflict when both sides changed differently', async () => {
    const { engine, dir } = await engineFor({ 'x.txt': 'C' }, { 'x.txt': 'B' });
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('A')) }); // last-synced = A
    const p = await engine.plan();
    expect(p.conflicts.map((c) => c.path)).toEqual(['x.txt']);
    expect(p.applied).toEqual([]);
  });

  it('plan skips a remote key that escapes the local root (EC-1)', async () => {
    const { engine } = await engineFor({ '../../evil.txt': 'E' }, {});
    const p = await engine.plan();
    expect(p.applied).toEqual([]);
    expect(p.skipped.map((s) => s.path)).toContain('../../evil.txt');
  });
});

describe('storage-sync T2.2 — apply / idempotency / conflict', () => {
  it('pull-twice is a no-op (idempotency GOAL metric)', async () => {
    const { engine, dir } = await engineFor({ 'x.txt': 'X' }, {});
    const first = await engine.run();
    expect(first.applied).toEqual([{ kind: 'pull', path: 'x.txt' }]);
    expect((await fs.readFile(path.join(dir, 'x.txt'))).toString()).toBe('X');
    // Second engine over the same dir + same remote — the manifest now records
    // the synced state, so nothing is applied.
    const local2 = createFsLocalPort(dir);
    const remote2 = new FakeRemote(new Map([['x.txt', { buf: Buffer.from('X'), contentType: 'text/plain' }]]));
    const second = await new SyncEngine(remote2, local2, dir, '').run();
    expect(second.applied).toEqual([]);
    expect(second.conflicts).toEqual([]);
  });

  it('a both-changed path is a typed conflict, never clobbered (GOAL metric)', async () => {
    const { engine, dir, remote } = await engineFor({ 'x.txt': 'C' }, { 'x.txt': 'B' });
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('A')) });
    const res = await engine.run(); // no strategy
    expect(res.conflicts.map((c) => c.path)).toEqual(['x.txt']);
    expect(res.applied).toEqual([]);
    // Neither side was overwritten.
    expect((await fs.readFile(path.join(dir, 'x.txt'))).toString()).toBe('B');
    expect(remote.store.get('x.txt')!.buf.toString()).toBe('C');
  });

  it('--strategy=pull takes the remote side', async () => {
    const { engine, dir } = await engineFor({ 'x.txt': 'C' }, { 'x.txt': 'B' });
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('A')) });
    const res = await engine.run('pull');
    expect(res.conflicts).toEqual([]);
    expect((await fs.readFile(path.join(dir, 'x.txt'))).toString()).toBe('C');
  });

  it('--strategy=push takes the local side', async () => {
    const { engine, dir, remote } = await engineFor({ 'x.txt': 'C' }, { 'x.txt': 'B' });
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('A')) });
    const res = await engine.run('push');
    expect(res.conflicts).toEqual([]);
    expect(remote.store.get('x.txt')!.buf.toString()).toBe('B');
  });

  it('--strategy=backup saves the loser then applies the winner (remote)', async () => {
    const { engine, dir } = await engineFor({ 'x.txt': 'C' }, { 'x.txt': 'B' });
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('A')) });
    await engine.run('backup');
    // Winner (remote 'C') is on disk; the local loser 'B' is backed up.
    expect((await fs.readFile(path.join(dir, 'x.txt'))).toString()).toBe('C');
    const entries = await fs.readdir(dir);
    const backup = entries.find((e) => e.startsWith('x.txt.theo-backup-'));
    expect(backup).toBeDefined();
    expect((await fs.readFile(path.join(dir, backup!))).toString()).toBe('B');
  });

  it('--exclude keeps matching paths out of the sync BOTH directions (safety fence)', async () => {
    const dir = await tmp();
    const local = createFsLocalPort(dir);
    // Local has an executable-config file that must NOT be pushed.
    await local.write('settings.local.json', Buffer.from('{"secret":1}'));
    await local.write('memory/note.md', Buffer.from('keep me'));
    // Remote has a hooks/ script (RCE surface) + an inert file.
    const remote = new FakeRemote(
      new Map([
        ['hooks/evil.sh', { buf: Buffer.from('rm -rf ~'), contentType: 'text/x-sh' }],
        ['CLAUDE.md', { buf: Buffer.from('# shared'), contentType: 'text/markdown' }],
      ]),
    );
    const engine = new SyncEngine(remote, local, dir, '', ['settings*.json', 'hooks/**']);
    const res = await engine.run();
    // Excluded on pull: hooks/evil.sh is NEVER written locally (RCE fence).
    await expect(fs.readFile(path.join(dir, 'hooks/evil.sh'))).rejects.toBeDefined();
    // Excluded on push: settings.local.json is NEVER uploaded.
    expect(remote.store.has('settings.local.json')).toBe(false);
    // Inert files DO sync both ways.
    expect((await fs.readFile(path.join(dir, 'CLAUDE.md'))).toString()).toBe('# shared');
    expect(remote.store.has('memory/note.md')).toBe(true);
    expect(res.applied.map((o) => o.path).sort()).toEqual(['CLAUDE.md', 'memory/note.md']);
  });

  it('a conflict backup is never pushed to remote on the next sync (F-sec-6)', async () => {
    const { engine, dir, remote } = await engineFor({ 'x.txt': 'C' }, { 'x.txt': 'B' });
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('A')) });
    await engine.run('backup'); // creates x.txt.theo-backup-<...> locally
    const local2 = createFsLocalPort(dir);
    const walked = await local2.walk();
    expect(walked.some((p) => p.includes('.theo-backup-'))).toBe(false); // excluded from walk
    // A subsequent sync must not upload the backup to the remote prefix.
    const remote2 = new FakeRemote(new Map([['x.txt', { buf: Buffer.from('C'), contentType: 'text/plain' }]]));
    await new SyncEngine(remote2, local2, dir, '').run();
    expect([...remote2.store.keys()].some((k) => k.includes('.theo-backup-'))).toBe(false);
  });

  it('a remote deletion removes the local file and the manifest key', async () => {
    const { engine, dir } = await engineFor({}, { 'x.txt': 'X' });
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('X')) });
    const res = await engine.run();
    expect(res.applied).toEqual([{ kind: 'pullDelete', path: 'x.txt' }]);
    await expect(fs.readFile(path.join(dir, 'x.txt'))).rejects.toBeDefined();
  });

  it('remote drift between plan and push reclassifies as a conflict (TOCTOU, Drawback #2)', async () => {
    const { engine, dir, remote } = await engineFor({ 'x.txt': 'A' }, { 'x.txt': 'B' });
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('A')) }); // push scenario (local changed, remote==manifest)
    remote.drift.set('x.txt', 'C'); // remote mutates to C after plan downloads A
    const res = await engine.run();
    expect(res.conflicts.map((c) => c.path)).toEqual(['x.txt']);
    // Push did NOT overwrite the drifted remote.
    expect(remote.store.get('x.txt')!.buf.toString()).toBe('C');
  });

  it('.theo control dir never syncs and stays idempotent (EC-2)', async () => {
    const { engine, dir } = await engineFor({ 'k.txt': 'K' }, {});
    await engine.run();
    // The manifest itself must not have been pushed to the remote.
    const local2 = createFsLocalPort(dir);
    const walked = await local2.walk();
    expect(walked.some((p) => p.startsWith('.theo/'))).toBe(false);
    const remote2 = new FakeRemote(new Map([['k.txt', { buf: Buffer.from('K'), contentType: 'text/plain' }]]));
    const second = await new SyncEngine(remote2, local2, dir, '').run();
    expect(second.applied).toEqual([]);
  });

  it('maps a --prefix: remote ".claude/settings.json" pulls to local "settings.json"', async () => {
    const dir = await tmp();
    const local = createFsLocalPort(dir);
    const remote = new FakeRemote(
      new Map([['.claude/settings.json', { buf: Buffer.from('{}'), contentType: 'application/json' }]]),
    );
    const engine = new SyncEngine(remote, local, dir, '.claude/');
    const res = await engine.run();
    expect(res.applied).toEqual([{ kind: 'pull', path: 'settings.json' }]);
    expect((await fs.readFile(path.join(dir, 'settings.json'))).toString()).toBe('{}');
    // A new local file pushes back under the prefix as ".claude/notes.md".
    await local.write('notes.md', Buffer.from('hi'));
    await new SyncEngine(remote, createFsLocalPort(dir), dir, '.claude/').run();
    expect(remote.store.has('.claude/notes.md')).toBe(true);
  });

  it('a failing op is skipped, other ops still apply, manifest records only applied (F-test-1)', async () => {
    const dir = await tmp();
    const local = createFsLocalPort(dir);
    await local.write('good.txt', Buffer.from('G'));
    await local.write('bad.txt', Buffer.from('B'));
    const remote = new FakeRemote();
    // Make the upload of bad.txt fail (e.g. 413 too-large); good.txt must still push.
    const origUpload = remote.upload.bind(remote);
    remote.upload = async (p, buf, ct) => {
      if (p === 'bad.txt') throw Object.assign(new Error('too large'), { status: 413 });
      return origUpload(p, buf, ct);
    };
    const res = await new SyncEngine(remote, local, dir, '').run();
    expect(res.applied.map((o) => o.path)).toEqual(['good.txt']);
    expect(res.skipped.map((s) => s.path)).toContain('bad.txt');
    expect(remote.store.has('good.txt')).toBe(true);
    expect(remote.store.has('bad.txt')).toBe(false);
    // Manifest records only the applied path — a re-run does not re-push good.txt.
    const second = await new SyncEngine(new FakeRemote(new Map([['good.txt', { buf: Buffer.from('G'), contentType: 'text/plain' }]])), createFsLocalPort(dir), dir, '').run();
    expect(second.applied.some((o) => o.path === 'good.txt')).toBe(false);
  });

  it('an empty file round-trips as content (not mistaken for a delete) and binary is byte-identical (edge cases)', async () => {
    const dir = await tmp();
    const local = createFsLocalPort(dir);
    await local.write('empty.txt', Buffer.alloc(0));
    const h = await local.hash('empty.txt');
    expect(h).toMatch(/^[0-9a-f]{64}$/); // empty content has a well-defined hash, not "absent"
    const bin = Buffer.from([0, 1, 2, 255, 0, 128]);
    await local.write('deep/nested/b.bin', bin);
    expect((await local.read('deep/nested/b.bin')).equals(bin)).toBe(true); // binary + nested path intact
  });

  it('a local deletion pushes a remote delete', async () => {
    const { engine, dir, remote } = await engineFor({ 'x.txt': 'X' }, {});
    await writeManifestFor(dir, { 'x.txt': hashBytes(Buffer.from('X')) }); // last-synced; local now absent
    const res = await engine.run();
    expect(res.applied).toEqual([{ kind: 'pushDelete', path: 'x.txt' }]);
    expect(remote.store.has('x.txt')).toBe(false);
  });
});

describe('storage-sync — .theoignore predicate (injected, gitignore-style)', () => {
  // The engine is pure over the ports (ADR D3): the ignore matcher is injected as
  // a predicate, so the fs read of .theoignore happens at the composition root and
  // the engine stays testable with an in-memory function.
  it('never pushes a locally ignored path (knowledge-base/)', async () => {
    const dir = await tmp();
    const local = createFsLocalPort(dir);
    await local.write('rules/keep.md', Buffer.from('K'));
    await local.write('knowledge-base/plans/huge.md', Buffer.from('H'));
    const remote = new FakeRemote();
    const ignoreMatch = (rel: string): boolean => rel === 'knowledge-base' || rel.startsWith('knowledge-base/');
    const engine = new SyncEngine(remote, local, dir, '', [], ignoreMatch);
    const plan = await engine.plan();
    expect(plan.applied).toEqual([{ kind: 'push', path: 'rules/keep.md' }]);
    expect(plan.applied.some((o) => o.path.startsWith('knowledge-base/'))).toBe(false);
  });

  it('never pulls (nor downloads) a remotely ignored path — RCE/quota fence', async () => {
    const dir = await tmp();
    const local = createFsLocalPort(dir);
    const remote = new FakeRemote(
      new Map([
        ['rules/y.md', { buf: Buffer.from('Y'), contentType: 'text/plain' }],
        ['knowledge-base/audit.md', { buf: Buffer.from('A'), contentType: 'text/plain' }],
      ]),
    );
    const ignoreMatch = (rel: string): boolean => rel.startsWith('knowledge-base/');
    const engine = new SyncEngine(remote, local, dir, '', [], ignoreMatch);
    const plan = await engine.plan();
    expect(plan.applied).toEqual([{ kind: 'pull', path: 'rules/y.md' }]);
    expect(plan.applied.some((o) => o.path.startsWith('knowledge-base/'))).toBe(false);
  });
});
