// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan v1.1 T1.1 (theo-cli-vercel-like-ux) — services.json discovery tests.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findServicesJson,
  parseServicesRuntimes,
  ServicesJsonOverrideError,
} from '../../../src/adapters/services-json';

// simplify-deploy-theokit-runtime-wiring T3.1a (F-dom-2): the deploy payload
// must carry the per-app runtime parsed from services.json, since the API now
// dispatches the build strategy on `runtime` (not framework).
describe('parseServicesRuntimes', () => {
  it('maps each service name to its declared runtime', () => {
    const json = JSON.stringify({
      version: 2,
      project: 'shop',
      services: [
        { name: 'api', runtime: 'python', type: 'server' },
        { name: 'web', runtime: 'node', type: 'server' },
        { name: 'queue', runtime: 'node', type: 'worker' },
      ],
    });
    expect(parseServicesRuntimes(json)).toEqual({ api: 'python', web: 'node', queue: 'node' });
  });

  it('skips services missing name or runtime, and tolerates malformed JSON', () => {
    expect(
      parseServicesRuntimes(JSON.stringify({ services: [{ name: 'api' }, { runtime: 'node' }] })),
    ).toEqual({});
    expect(parseServicesRuntimes('not json {')).toEqual({});
    expect(parseServicesRuntimes('{}')).toEqual({});
  });
});

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'services-json-test-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeServicesJson(dir: string, content = '{}'): string {
  const theoDir = path.join(dir, '.theo');
  fs.mkdirSync(theoDir, { recursive: true });
  const filePath = path.join(theoDir, 'services.json');
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('findServicesJson — walk-up discovery', () => {
  it('finds .theo/services.json in cwd', () => {
    const expected = writeServicesJson(tmpRoot);
    const result = findServicesJson(tmpRoot, tmpRoot);
    expect(result).not.toBeNull();
    expect(result?.path).toBe(expected);
  });

  it('finds .theo/services.json in ancestor before gitRoot', () => {
    const expected = writeServicesJson(tmpRoot);
    const deep = path.join(tmpRoot, 'apps', 'api', 'src');
    fs.mkdirSync(deep, { recursive: true });
    const result = findServicesJson(deep, tmpRoot);
    expect(result?.path).toBe(expected);
  });

  it('stops at gitRoot — returns null when .theo/services.json sits above gitRoot', () => {
    const repo = path.join(tmpRoot, 'repo');
    const above = tmpRoot; // ancestor of repo
    fs.mkdirSync(repo);
    writeServicesJson(above);
    const result = findServicesJson(repo, repo);
    expect(result).toBeNull();
  });

  it('returns null when no services.json exists anywhere in scope', () => {
    const cwd = path.join(tmpRoot, 'src');
    fs.mkdirSync(cwd);
    const result = findServicesJson(cwd, tmpRoot);
    expect(result).toBeNull();
  });

  it('stops at filesystem root (no infinite loop)', () => {
    // Use the actual filesystem root as both cwd and gitRoot equivalent.
    const result = findServicesJson('/', '/');
    expect(result === null || result?.path === '/.theo/services.json').toBe(true);
  });
});

describe('findServicesJson — --services-json override (EC-4)', () => {
  it('respects --services-json override pointing at custom distDir', () => {
    const outDir = path.join(tmpRoot, 'out');
    fs.mkdirSync(outDir);
    const customPath = path.join(outDir, 'services.json');
    fs.writeFileSync(customPath, '{"version":2}');
    const result = findServicesJson(tmpRoot, tmpRoot, customPath);
    expect(result?.path).toBe(customPath);
  });

  it('throws ServicesJsonOverrideError when override target is absent', () => {
    const missing = path.join(tmpRoot, 'out', 'services.json');
    expect(() => findServicesJson(tmpRoot, tmpRoot, missing)).toThrow(
      ServicesJsonOverrideError,
    );
  });
});

// Sprint 4 plan qa-sprint4-cleanup-2026-06-25 T1.1 — cascade .theo/ → .theokit/
// closes theo-cloud#29.B2: theokit v0.5.0+ writes manifests to .theokit/services.json by default
// while theo-cli previously only searched .theo/services.json. The walk-up loop now also checks
// .theokit/services.json at the same dir level as a fallback (after .theo/services.json), so users
// with only a theokit-default build can deploy without `--services-json` override.
//
// EC-1 absorbed: test placed at tests/unit/adapters/ to match jest.config.js roots: ['<rootDir>/tests'].
function writeTheokitServicesJson(dir: string, content = '{}'): string {
  const theokitDir = path.join(dir, '.theokit');
  fs.mkdirSync(theokitDir, { recursive: true });
  const filePath = path.join(theokitDir, 'services.json');
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('findServicesJson — cascade .theo/ → .theokit/ (Sprint 4 #29.B2)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'svcjson-cascade-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('finds .theokit/services.json when only .theokit/ exists (closes #29.B2)', () => {
    const expected = writeTheokitServicesJson(tmpRoot, '{"version":2,"project":"probe","services":[]}');
    const result = findServicesJson(tmpRoot, tmpRoot);
    expect(result).not.toBeNull();
    expect(result?.path).toBe(expected);
  });

  it('prefers .theo/services.json over .theokit/services.json when both exist (backward compat)', () => {
    const preferred = writeServicesJson(tmpRoot, '{"version":2,"project":"theo-pref","services":[]}');
    writeTheokitServicesJson(tmpRoot, '{"version":2,"project":"theokit-pref","services":[]}');
    const result = findServicesJson(tmpRoot, tmpRoot);
    expect(result?.path).toBe(preferred);
  });

  it('finds .theokit/services.json in ancestor before gitRoot (walk-up applies to cascade too)', () => {
    const expected = writeTheokitServicesJson(tmpRoot);
    const deep = path.join(tmpRoot, 'apps', 'api', 'src');
    fs.mkdirSync(deep, { recursive: true });
    const result = findServicesJson(deep, tmpRoot);
    expect(result?.path).toBe(expected);
  });

  it('stops at gitRoot — returns null when neither .theo/ nor .theokit/ exists within scope', () => {
    const cwd = path.join(tmpRoot, 'src');
    fs.mkdirSync(cwd);
    const result = findServicesJson(cwd, tmpRoot);
    expect(result).toBeNull();
  });

  it('--services-json override still short-circuits the cascade (EC-10 from edge-case-plan)', () => {
    // Override pointing at a custom path bypasses both .theo/ and .theokit/ checks entirely.
    writeServicesJson(tmpRoot, '{"version":2,"project":"theo-pref","services":[]}');
    writeTheokitServicesJson(tmpRoot, '{"version":2,"project":"theokit-pref","services":[]}');
    const outDir = path.join(tmpRoot, 'out');
    fs.mkdirSync(outDir);
    const customPath = path.join(outDir, 'services.json');
    fs.writeFileSync(customPath, '{"version":2,"project":"override","services":[]}');
    const result = findServicesJson(tmpRoot, tmpRoot, customPath);
    expect(result?.path).toBe(customPath);
  });
});
