// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan v1.1 T2.1 (theo-cli-vercel-like-ux) — resolveTheokitBin tests.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveTheokitBin,
  validateCandidate,
  TheokitBinaryNotFoundError,
} from '../../../src/lib/resolve-theokit-bin';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-bin-test-'));
  delete process.env.THEOKIT_BIN;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.THEOKIT_BIN;
});

function writeExecutable(dir: string, contents = '#!/bin/sh\necho mock'): string {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'theokit');
  fs.writeFileSync(filePath, contents);
  fs.chmodSync(filePath, 0o755);
  return filePath;
}

describe('validateCandidate', () => {
  it('returns false for a directory', () => {
    expect(validateCandidate(tmpRoot)).toBe(false);
  });
  it('returns false for a missing path', () => {
    expect(validateCandidate(path.join(tmpRoot, 'nope'))).toBe(false);
  });
  it('returns false for a non-executable file', () => {
    const filePath = path.join(tmpRoot, 'file');
    fs.writeFileSync(filePath, 'x');
    fs.chmodSync(filePath, 0o644);
    expect(validateCandidate(filePath)).toBe(false);
  });
  it('returns true for an executable file', () => {
    const bin = writeExecutable(tmpRoot);
    expect(validateCandidate(bin)).toBe(true);
  });
});

describe('resolveTheokitBin — happy paths', () => {
  it('finds node_modules/.bin/theokit at cwd', () => {
    const expected = writeExecutable(path.join(tmpRoot, 'node_modules', '.bin'));
    expect(resolveTheokitBin(tmpRoot)).toBe(expected);
  });

  it('finds node_modules/.bin/theokit in ancestor (monorepo workspace)', () => {
    const expected = writeExecutable(path.join(tmpRoot, 'node_modules', '.bin'));
    const deep = path.join(tmpRoot, 'apps', 'api', 'src');
    fs.mkdirSync(deep, { recursive: true });
    expect(resolveTheokitBin(deep)).toBe(expected);
  });

  it('honors THEOKIT_BIN env var with a valid executable', () => {
    const bin = writeExecutable(path.join(tmpRoot, 'custom'));
    process.env.THEOKIT_BIN = bin;
    expect(resolveTheokitBin(tmpRoot)).toBe(bin);
  });
});

describe('resolveTheokitBin — error paths', () => {
  it('throws TheokitBinaryNotFoundError when nothing resolves', () => {
    // PATH cleared so `which theokit` cannot succeed.
    const originalPath = process.env.PATH;
    process.env.PATH = '/this/path/does/not/exist';
    try {
      expect(() => resolveTheokitBin(tmpRoot)).toThrow(TheokitBinaryNotFoundError);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('TheokitBinaryNotFoundError message includes install hint', () => {
    try {
      throw new TheokitBinaryNotFoundError();
    } catch (err) {
      expect((err as TheokitBinaryNotFoundError).message).toContain('npm install theokit');
      expect((err as TheokitBinaryNotFoundError).message).toContain('npm install -g theokit');
    }
  });
});

describe('resolveTheokitBin — EC-1 (THEOKIT_BIN points to directory or missing)', () => {
  it('rejects THEOKIT_BIN pointing at a directory', () => {
    process.env.THEOKIT_BIN = tmpRoot; // tmpRoot is a directory
    expect(() => resolveTheokitBin(tmpRoot)).toThrow(/THEOKIT_BIN/);
  });

  it('rejects THEOKIT_BIN pointing at a missing path', () => {
    process.env.THEOKIT_BIN = path.join(tmpRoot, 'nope');
    expect(() => resolveTheokitBin(tmpRoot)).toThrow(/THEOKIT_BIN/);
  });
});

describe('resolveTheokitBin — EC-6 (local bin not executable)', () => {
  it('throws actionable error when no executable found anywhere (local bin without +x)', () => {
    // Local bin without executable bit set.
    const binDir = path.join(tmpRoot, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'theokit'), 'x');
    fs.chmodSync(path.join(binDir, 'theokit'), 0o644);
    const originalPath = process.env.PATH;
    process.env.PATH = '/this/path/does/not/exist';
    try {
      expect(() => resolveTheokitBin(tmpRoot)).toThrow(TheokitBinaryNotFoundError);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('falls through when local bin is not executable (continues to system PATH)', () => {
    // Non-executable local + executable global (simulate via THEOKIT_BIN as the global).
    const binDir = path.join(tmpRoot, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'theokit'), 'x');
    fs.chmodSync(path.join(binDir, 'theokit'), 0o644);
    const global = writeExecutable(path.join(tmpRoot, 'global'));
    process.env.THEOKIT_BIN = global;
    expect(resolveTheokitBin(tmpRoot)).toBe(global);
  });
});
