// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// Plan v1.1 T1.1 (loopscale-cli-vercel-like-ux) — services.json discovery tests.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findServicesJson,
  parseServicesRuntimes,
  loopscaleYamlFromServicesJson,
  ServicesJsonOverrideError,
} from '../../../src/adapters/services-json';

// simplify-deploy-loopzero-runtime-wiring T3.1a (F-dom-2): the deploy payload
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
  const loopscaleDir = path.join(dir, '.loopzero');
  fs.mkdirSync(loopscaleDir, { recursive: true });
  const filePath = path.join(loopscaleDir, 'services.json');
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('findServicesJson — walk-up discovery', () => {
  it('finds .loopzero/services.json in cwd', () => {
    const expected = writeServicesJson(tmpRoot);
    const result = findServicesJson(tmpRoot, tmpRoot);
    expect(result).not.toBeNull();
    expect(result?.path).toBe(expected);
  });

  it('finds .loopzero/services.json in ancestor before gitRoot', () => {
    const expected = writeServicesJson(tmpRoot);
    const deep = path.join(tmpRoot, 'apps', 'api', 'src');
    fs.mkdirSync(deep, { recursive: true });
    const result = findServicesJson(deep, tmpRoot);
    expect(result?.path).toBe(expected);
  });

  it('stops at gitRoot — returns null when .loopzero/services.json sits above gitRoot', () => {
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
    expect(result === null || result?.path === '/.loopzero/services.json').toBe(true);
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

// The LoopZero framework writes its manifest to .loopzero/services.json, and the walk-up
// finds it without a `--services-json` override (console#29).
//
// EC-1 absorbed: test placed at tests/unit/adapters/ to match jest.config.js roots: ['<rootDir>/tests'].
function writeLoopZeroServicesJson(dir: string, content = '{}'): string {
  const loopzeroDir = path.join(dir, '.loopzero');
  fs.mkdirSync(loopzeroDir, { recursive: true });
  const filePath = path.join(loopzeroDir, 'services.json');
  fs.writeFileSync(filePath, content);
  return filePath;
}

describe('findServicesJson — cascade .loopscale/ → .loopzero/ (Sprint 4 #29.B2)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'svcjson-cascade-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('finds .loopzero/services.json when only .loopzero/ exists (closes #29.B2)', () => {
    const expected = writeLoopZeroServicesJson(tmpRoot, '{"version":2,"project":"probe","services":[]}');
    const result = findServicesJson(tmpRoot, tmpRoot);
    expect(result).not.toBeNull();
    expect(result?.path).toBe(expected);
  });

  it('finds .loopzero/services.json in ancestor before gitRoot (walk-up applies to cascade too)', () => {
    const expected = writeLoopZeroServicesJson(tmpRoot);
    const deep = path.join(tmpRoot, 'apps', 'api', 'src');
    fs.mkdirSync(deep, { recursive: true });
    const result = findServicesJson(deep, tmpRoot);
    expect(result?.path).toBe(expected);
  });

  it('stops at gitRoot — returns null when neither .loopscale/ nor .loopzero/ exists within scope', () => {
    const cwd = path.join(tmpRoot, 'src');
    fs.mkdirSync(cwd);
    const result = findServicesJson(cwd, tmpRoot);
    expect(result).toBeNull();
  });

  it('--services-json override still short-circuits the cascade (EC-10 from edge-case-plan)', () => {
    // Override pointing at a custom path bypasses both .loopscale/ and .loopzero/ checks entirely.
    writeServicesJson(tmpRoot, '{"version":2,"project":"loopscale-pref","services":[]}');
    writeLoopZeroServicesJson(tmpRoot, '{"version":2,"project":"loopzero-pref","services":[]}');
    const outDir = path.join(tmpRoot, 'out');
    fs.mkdirSync(outDir);
    const customPath = path.join(outDir, 'services.json');
    fs.writeFileSync(customPath, '{"version":2,"project":"override","services":[]}');
    const result = findServicesJson(tmpRoot, tmpRoot, customPath);
    expect(result?.path).toBe(customPath);
  });
});

// loopscale#165 — `loopscale secret` resolvia o projeto SO pelo `loopscale.yaml` legado e reprovava com
// "No loopscale.yaml found. Run: loopscale init" num projeto que so tem `.loopzero/services.json` v2 — o
// formato que o proprio loopzero gera. `deploy`/`status`/`logs` ja liam o v2, entao o projeto
// deployava e nao conseguia gerenciar secrets, sem `--project` para contornar.
//
// A conversao vive no ADAPTADOR, nao no comando: os comandos continuam consumindo um unico
// `LoopScaleYamlResult` (DIP), e a raiz de composicao escolhe a fonte.
describe('loopscaleYamlFromServicesJson (loopscale#165)', () => {
  const tmp = path.join(os.tmpdir(), `loopscale-165-${String(process.pid)}`);

  beforeEach(() => { fs.mkdirSync(tmp, { recursive: true }); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('converte um services.json v2 real em LoopScaleYamlResult', () => {
    const file = path.join(tmp, 'services.json');
    fs.writeFileSync(file, JSON.stringify({
      version: 2,
      project: 'loopzero-app',
      services: [
        { name: 'web', runtime: 'node', type: 'server', port: 8080, start: 'node server.js' },
        { name: 'worker', runtime: 'node', type: 'worker', port: null },
      ],
    }));

    const result = loopscaleYamlFromServicesJson(file);

    expect(result).not.toBeNull();
    expect(result?.content.project).toBe('loopzero-app');
    expect(Object.keys(result?.content.apps ?? {})).toEqual(['web', 'worker']);
    expect(result?.content.apps.web.port).toBe(8080);
    expect(result?.content.apps.web.framework).toBe('node');
    // `port` e `number | null` no contrato — um worker sem porta nao pode virar 0, que
    // significaria "porta zero" para quem le.
    expect(result?.content.apps.worker.port).toBeNull();
    expect(result?.path).toBe(file);
  });

  it('devolve null quando o manifesto nao tem `project` — nao inventa nome', () => {
    const file = path.join(tmp, 'services.json');
    fs.writeFileSync(file, JSON.stringify({ version: 2, services: [{ name: 'web' }] }));

    // Sem `project` nao ha o que resolver. Devolver um resultado com string vazia faria o
    // comando chamar a API com `project=`, e o erro apareceria uma camada adiante, como 404.
    expect(loopscaleYamlFromServicesJson(file)).toBeNull();
  });

  it('devolve null em JSON invalido em vez de lancar', () => {
    const file = path.join(tmp, 'services.json');
    fs.writeFileSync(file, '{ nao e json');

    expect(loopscaleYamlFromServicesJson(file)).toBeNull();
  });

  it('devolve null quando o arquivo nao existe', () => {
    expect(loopscaleYamlFromServicesJson(path.join(tmp, 'ausente.json'))).toBeNull();
  });
});

describe('findServicesJson reads the LoopZero framework manifest first', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscale-manifest-lookup-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function write(dir: string): string {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    const file = path.join(root, dir, 'services.json');
    fs.writeFileSync(file, '{"version":2,"project":"p","services":[]}');
    return file;
  }

  it('finds .loopzero/services.json', () => {
    const file = write('.loopzero');
    expect(findServicesJson(root, root)).toEqual({ path: file });
  });

  it('names no retired tool when the --services-json path does not exist', () => {
    expect(() => findServicesJson(root, root, 'missing.json')).toThrow(/--services-json missing\.json: file not found\. Fix the path/);
  });
});
