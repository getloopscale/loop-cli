// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { StorageCommand, StorageDeps } from '../../src/commands/storage';

describe('StorageCommand', () => {
  function createDeps(overrides: Partial<StorageDeps> = {}): StorageDeps {
    return {
      upload: jest.fn().mockResolvedValue({ path: 'docs/a.txt', size: 5 }),
      download: jest.fn().mockResolvedValue(Buffer.from('hello')),
      list: jest.fn().mockResolvedValue({ files: [{ path: 'a.txt', size: 1, content_type: 'text/plain' }], next_cursor: '' }),
      stat: jest.fn().mockResolvedValue({ path: 'a.txt', size: 1, content_type: 'text/plain' }),
      del: jest.fn().mockResolvedValue(undefined),
      share: jest.fn().mockResolvedValue({ url: '/v1/storage/shared/tok', expires_at: '2026-07-14T00:00:00Z' }),
      readFile: jest.fn().mockResolvedValue(Buffer.from('hello')),
      writeFile: jest.fn().mockResolvedValue(undefined),
      writeTo: jest.fn(),
      writeError: jest.fn(),
      isCI: true,
      ...overrides,
    };
  }

  it('upload sends file bytes and prints json', async () => {
    const deps = createDeps();
    const code = await new StorageCommand(deps).execute('upload', { file: './a.txt', path: 'docs/a.txt', json: true });
    expect(code).toBe(0);
    expect(deps.readFile).toHaveBeenCalledWith('./a.txt');
    expect(deps.upload).toHaveBeenCalledWith('docs/a.txt', expect.any(Buffer), 'text/plain');
    expect(deps.writeTo).toHaveBeenCalledWith(expect.stringContaining('docs/a.txt'));
  });

  it('download writes bytes to dest', async () => {
    const deps = createDeps();
    const code = await new StorageCommand(deps).execute('download', { path: 'a.txt', dest: './out.txt' });
    expect(code).toBe(0);
    expect(deps.download).toHaveBeenCalledWith('a.txt');
    expect(deps.writeFile).toHaveBeenCalledWith('./out.txt', expect.any(Buffer));
  });

  it('list prints files', async () => {
    const deps = createDeps();
    const code = await new StorageCommand(deps).execute('list', { prefix: 'docs/', json: true });
    expect(code).toBe(0);
    expect(deps.list).toHaveBeenCalledWith('docs/');
    expect(deps.writeTo).toHaveBeenCalledWith(expect.stringContaining('a.txt'));
  });

  it('delete removes the object', async () => {
    const deps = createDeps();
    const code = await new StorageCommand(deps).execute('delete', { path: 'a.txt' });
    expect(code).toBe(0);
    expect(deps.del).toHaveBeenCalledWith('a.txt');
  });

  it('share prints a link', async () => {
    const deps = createDeps();
    const code = await new StorageCommand(deps).execute('share', { path: 'a.txt', expires: '3600', json: true });
    expect(code).toBe(0);
    expect(deps.share).toHaveBeenCalledWith('a.txt', 3600);
    expect(deps.writeTo).toHaveBeenCalledWith(expect.stringContaining('/v1/storage/shared/tok'));
  });

  // Exit-code contract mapping (house Rule 4): auth→4, quota/usage→1, network→5.
  it('maps 403 to auth exit code 4', async () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    const deps = createDeps({ list: jest.fn().mockRejectedValue(err) });
    const code = await new StorageCommand(deps).execute('list', {});
    expect(code).toBe(4);
    expect(deps.writeError).toHaveBeenCalledWith(expect.stringContaining('scope'));
  });

  it('maps 402 quota to usage exit code 1', async () => {
    const err = Object.assign(new Error('quota'), { status: 402 });
    const deps = createDeps({ readFile: jest.fn().mockResolvedValue(Buffer.from('x')), upload: jest.fn().mockRejectedValue(err) });
    const code = await new StorageCommand(deps).execute('upload', { file: './a', path: 'p' });
    expect(code).toBe(1);
  });

  it('maps 413 too-large to usage exit code 1', async () => {
    const err = Object.assign(new Error('too large'), { status: 413 });
    const deps = createDeps({ readFile: jest.fn().mockResolvedValue(Buffer.from('x')), upload: jest.fn().mockRejectedValue(err) });
    const code = await new StorageCommand(deps).execute('upload', { file: './a', path: 'p' });
    expect(code).toBe(1);
  });

  it('maps network/5xx to partial exit code 5', async () => {
    const err = Object.assign(new Error('unavailable'), { status: 503 });
    const deps = createDeps({ list: jest.fn().mockRejectedValue(err) });
    const code = await new StorageCommand(deps).execute('list', {});
    expect(code).toBe(5);
  });
});
