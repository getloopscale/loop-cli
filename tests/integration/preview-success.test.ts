// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// Phase 4 T4.2 — `preview` register integration test.

import { describe, it, expect, afterEach } from '@jest/globals';
import {
  spawnLoopScale,
  mkTmpHome,
  cleanupTmpHome,
  writeFakeAuthConfig,
} from './_fixtures/spawn-helper';
import { startMockApi, MockApiServer } from './_fixtures/mock-api-server';

const tmpHomes: string[] = [];
const servers: MockApiServer[] = [];

afterEach(async () => {
  while (tmpHomes.length) cleanupTmpHome(tmpHomes.pop()!);
  while (servers.length) await servers.pop()!.close();
});

describe('loopscale preview --help', () => {
  it('exit 0 + lists subcommands', async () => {
    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    const r = await spawnLoopScale({ args: ['preview', '--help'], cwd: tmp });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/list/);
    expect(r.stdout).toMatch(/inspect/);
    expect(r.stdout).toMatch(/delete/);
  });
});

describe('loopscale preview list', () => {
  it('exit 4 without auth', async () => {
    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    const r = await spawnLoopScale({
      args: ['preview', 'list', '--json'],
      cwd: tmp,
      timeoutMs: 10_000,
    });
    expect(r.exitCode).toBe(4);
  });

  it('handles mock response without hanging', async () => {
    const server = await startMockApi();
    servers.push(server);
    server.on({
      method: 'GET',
      path: '/api/v1/previews',
      response: { status: 200, body: { previews: [] } },
    });

    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    writeFakeAuthConfig(tmp, { loopscaleUrl: server.url });

    const r = await spawnLoopScale({
      args: ['preview', 'list', '--json'],
      cwd: tmp,
      env: { LOOPSCALE_URL: server.url },
      timeoutMs: 15_000,
    });
    expect(r.exitCode).not.toBe(143);
    expect(r.exitCode).not.toBe(-1);
  });
});
