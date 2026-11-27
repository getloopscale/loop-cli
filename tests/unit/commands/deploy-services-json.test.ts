// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// Plan v1.1 T1.2 (loopscale-cli-vercel-like-ux) — deploy command consumes
// findServicesJson for the upload payload (NOT findLoopScaleYaml).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DeployCommand } from '../../../src/commands/deploy';
import type { DeployDeps } from '../../../src/commands/deploy-types';

interface SSEEvent {
  type: string;
  data: Record<string, unknown>;
}

function createMockDeps(overrides: Partial<DeployDeps> = {}): DeployDeps {
  return {
    getToken: jest.fn().mockReturnValue('test-token'),
    findLoopScaleYaml: jest.fn().mockReturnValue({
      path: '/project/loopscale.yaml',
      content: {
        project: 'my-saas',
        apps: {
          api: { path: 'apps/api', framework: 'express', type: 'server', port: 3000 },
        },
      },
    }),
    findServicesJson: jest.fn().mockReturnValue({ path: '/project/.loopscale/services.json' }),
    hasGitRepo: jest.fn().mockReturnValue(false),
    hasUncommittedChanges: jest.fn().mockReturnValue(false),
    hasLockfile: jest.fn().mockReturnValue(true),
    getSourceIdentifier: jest.fn().mockReturnValue('abc1234'),
    createSourceBundle: jest.fn().mockResolvedValue('/tmp/bundle.bundle'),
    uploadSource: jest.fn().mockResolvedValue({ commit_sha: 'abc1234', apps: ['api'] }),
    submitBuild: jest.fn().mockResolvedValue({ build_id: 'b1', deploy_id: 'd1', status: 'queued' }),
    connectSSE: jest.fn().mockImplementation((_buildId: string, onEvent: (e: SSEEvent) => void) => {
      onEvent({
        type: 'deploy.completed',
        data: {
          deploy_id: 'd1', status: 'success', duration_seconds: 1,
          apps: [{ name: 'api', status: 'deployed', url: 'https://api.test', build_duration_seconds: 1 }],
        },
      });
      return { close: jest.fn() };
    }),
    getSecrets: jest.fn().mockResolvedValue([]),
    cleanupFile: jest.fn(),
    generateIdempotencyKey: jest.fn().mockReturnValue('k1'),
    writeTo: jest.fn(),
    writeError: jest.fn(),
    isCI: false,
    ...overrides,
  };
}

describe('Plan v1.1 T1.2 — deploy uses findServicesJson for upload payload', () => {
  it('passes the .loopscale/services.json path (NOT loopscale.yaml path) to uploadSource', async () => {
    const uploadSource = jest.fn().mockResolvedValue({ commit_sha: 'sha', apps: ['api'] });
    const deps = createMockDeps({ uploadSource });
    const cmd = new DeployCommand(deps);
    await cmd.execute({ env: 'production', json: true });

    expect(uploadSource).toHaveBeenCalled();
    const args = uploadSource.mock.calls[0];
    expect(args[1]).toBe('/project/.loopscale/services.json');
    expect(args[1]).not.toContain('loopscale.yaml');
  });

  it('builds the manifest from the descriptor when the project has no services.json', async () => {
    let uploaded: Record<string, unknown> | null = null;
    const uploadSource = jest.fn().mockImplementation(async (_bundle: string, manifestPath: string) => {
      uploaded = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      return { commit_sha: 'sha', apps: ['web'] };
    });
    const submitBuild = jest.fn().mockResolvedValue({ build_id: 'b1', deploy_id: 'd1', status: 'queued' });
    const deps = createMockDeps({
      findLoopScaleYaml: jest.fn().mockReturnValue({
        path: '/project/loopscale.yaml',
        content: { project: 'hello', apps: { web: { path: '.', port: 8080, runtime: 'node', start: 'node server.js' } } },
      }),
      findServicesJson: jest.fn().mockReturnValue(null),
      uploadSource,
      submitBuild,
    });

    const exit = await new DeployCommand(deps).execute({ env: 'production', json: true });

    expect(exit).toBe(0);
    expect(uploaded).toMatchObject({
      version: 2,
      project: 'hello',
      services: [{ name: 'web', runtime: 'node', port: 8080, start: 'node server.js' }],
    });
    const apps = submitBuild.mock.calls[0][0].apps;
    expect(apps[0]).toMatchObject({ name: 'web', runtime: 'node', start: 'node server.js' });
    // The generated file does not outlive the deploy.
    const manifestPath = uploadSource.mock.calls[0][1] as string;
    expect(fs.existsSync(manifestPath)).toBe(false);
  });

  it('says what the descriptor lacks when no manifest can be built from it', async () => {
    const writeErrorMessages: string[] = [];
    const uploadSource = jest.fn();
    const deps = createMockDeps({
      findServicesJson: jest.fn().mockReturnValue(null),
      uploadSource,
      writeError: jest.fn((msg: string) => { writeErrorMessages.push(msg); }),
    });

    const exit = await new DeployCommand(deps).execute({ env: 'production', json: false });

    expect(exit).toBe(1);
    expect(uploadSource).not.toHaveBeenCalled();
    const said = writeErrorMessages.join('\n');
    expect(said).toContain("App 'api' declares no runtime");
    expect(said).not.toMatch(/loopzero/i);
  });

  it('still reads loopscale.yaml for app-shape (regression — both deps coexist)', async () => {
    const findLoopScaleYaml = jest.fn().mockReturnValue({
      path: '/project/loopscale.yaml',
      content: { project: 'my-saas', apps: { api: { path: 'apps/api', framework: 'express', type: 'server', port: 3000 } } },
    });
    const deps = createMockDeps({ findLoopScaleYaml });
    const cmd = new DeployCommand(deps);
    await cmd.execute({ env: 'production', json: true });
    expect(findLoopScaleYaml).toHaveBeenCalled();
  });

  it('forwards --services-json override to findServicesJson (EC-4)', async () => {
    const findServicesJson = jest.fn().mockReturnValue({ path: '/custom/out/services.json' });
    const deps = createMockDeps({ findServicesJson });
    const cmd = new DeployCommand(deps);
    await cmd.execute({ env: 'production', json: true, servicesJson: '/custom/out/services.json' });
    expect(findServicesJson).toHaveBeenCalledWith('/custom/out/services.json');
  });

  it('exits with SERVICES_JSON_OVERRIDE_INVALID when override target absent', async () => {
    const findServicesJson = jest.fn(() => {
      const err = new Error('--services-json /nope: file not found.');
      (err as Error & { code?: string }).code = 'SERVICES_JSON_OVERRIDE_INVALID';
      throw err;
    });
    const deps = createMockDeps({ findServicesJson });
    const cmd = new DeployCommand(deps);
    const exit = await cmd.execute({ env: 'production', json: true, servicesJson: '/nope' });
    expect(exit).toBe(1);
  });
});

// EC-9 typecheck-safety. promote / rollback / validate registrations build
// DeployDeps without findServicesJson because they don't upload bundles. The
// interface marks findServicesJson optional — if anyone makes it required,
// the next assignment won't compile and this file fails tsc.
describe('Plan v1.1 EC-9 — findServicesJson is optional in DeployDeps', () => {
  it('compiles a DeployDeps shape without findServicesJson (promote/rollback/validate parity)', () => {
    const depsWithoutFindServicesJson: DeployDeps = {
      getToken: () => null,
      findLoopScaleYaml: () => null,
      hasGitRepo: () => false,
      hasUncommittedChanges: () => false,
      hasLockfile: () => false,
      getSourceIdentifier: () => 'x',
      createSourceBundle: async () => '/tmp/bundle',
      uploadSource: async () => ({ commit_sha: '', apps: [] as string[] }),
      submitBuild: async () => ({ build_id: '', stream_url: '' }),
      connectSSE: () => ({ close: () => undefined }),
      getSecrets: async () => [],
      cleanupFile: () => undefined,
      generateIdempotencyKey: () => '',
      writeTo: () => undefined,
      writeError: () => undefined,
      isCI: false,
    };
    expect(depsWithoutFindServicesJson.findServicesJson).toBeUndefined();
  });
});

// simplify-deploy-loopzero-runtime-wiring T3.1a (F-dom-2) — the deploy build
// payload MUST carry each app's services.json `runtime` (the API now dispatches
// the build strategy on it). These tests use a REAL services.json on disk so the
// enrichment block actually runs (the mocks above point at a non-existent path,
// so the fs.readFileSync is swallowed — exactly the gap /review flagged).
describe('T3.1a — deploy carries services.json runtime into the build payload', () => {
  let tmpRoot: string;
  let servicesJsonPath: string;

  function writeServices(services: Array<{ name: string; runtime?: string }>): void {
    fs.mkdirSync(path.join(tmpRoot, '.loopscale'), { recursive: true });
    servicesJsonPath = path.join(tmpRoot, '.loopscale', 'services.json');
    fs.writeFileSync(servicesJsonPath, JSON.stringify({ version: 2, project: 'my-saas', services }));
  }

  function depsWithLoopScaleApps(
    apps: Record<string, { path: string; framework: string; type: string; port: number }>,
    overrides: Partial<DeployDeps> = {},
  ): DeployDeps {
    return createMockDeps({
      // projectRoot '/project' does NOT exist on disk → skipFs=true → validateConfig
      // path-existence checks are skipped (same as the existing tests). Only the
      // services.json path below is real, so the runtime-enrichment readFileSync runs.
      findLoopScaleYaml: jest.fn().mockReturnValue({
        path: '/project/loopscale.yaml',
        content: { project: 'my-saas', apps },
      }),
      findServicesJson: jest.fn().mockReturnValue({ path: servicesJsonPath }),
      uploadSource: jest.fn().mockResolvedValue({ commit_sha: 'sha', apps: Object.keys(apps) }),
      hasGitRepo: jest.fn().mockReturnValue(true),
      ...overrides,
    });
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscale-rw-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('enriches every app from services.json (all matched → no unmatched warning, human mode)', async () => {
    // Both apps are present in services.json → the enrichment matches both and
    // sets unit.runtime, so NO "no services.json runtime" warning fires. This is
    // the inverse of the unmatched-warning test: it proves the match-and-enrich
    // path runs against a REAL services.json (the gap /review flagged — the other
    // mocks point at a non-existent path so the enrichment is silently caught).
    writeServices([
      { name: 'api', runtime: 'python' },
      { name: 'web', runtime: 'node' },
    ]);
    const writeError = jest.fn();
    const deps = depsWithLoopScaleApps(
      {
        api: { path: 'apps/api', framework: 'fastapi', type: 'server', port: 8000 },
        web: { path: 'apps/web', framework: 'express', type: 'server', port: 3000 },
      },
      { writeError },
    );
    await new DeployCommand(deps).execute({ env: 'production' }); // human mode

    const warned = writeError.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).not.toMatch(/no services\.json runtime/i);
  });

  it('warns (human mode) when a loopscale.yaml app has no matching services.json runtime', async () => {
    writeServices([{ name: 'api', runtime: 'python' }]); // 'worker' is absent
    const writeError = jest.fn();
    const deps = depsWithLoopScaleApps(
      {
        api: { path: 'apps/api', framework: 'fastapi', type: 'server', port: 8000 },
        worker: { path: 'apps/worker', framework: 'custom', type: 'worker', port: 0 },
      },
      { writeError },
    );
    await new DeployCommand(deps).execute({ env: 'production' }); // human mode (no json)

    const warned = writeError.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toMatch(/worker/);
    expect(warned).toMatch(/services\.json runtime/i);
  });

  it('suppresses the unmatched-app warning under --json', async () => {
    writeServices([{ name: 'api', runtime: 'python' }]);
    const writeError = jest.fn();
    const deps = depsWithLoopScaleApps(
      {
        api: { path: 'apps/api', framework: 'fastapi', type: 'server', port: 8000 },
        worker: { path: 'apps/worker', framework: 'custom', type: 'worker', port: 0 },
      },
      { writeError },
    );
    await new DeployCommand(deps).execute({ env: 'production', json: true });

    const warned = writeError.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).not.toMatch(/no services\.json runtime/i);
  });
});
