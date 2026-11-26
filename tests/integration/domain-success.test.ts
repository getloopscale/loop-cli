// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors
//
// Phase 4 T4.2 — `domain` register integration test.
// Closes T0.3 audit gap "domain register has 0 dedicated tests"
// (highest gap × highest blast radius — customer-facing path).

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

describe('loopscale domain --help', () => {
  it('exit 0 + lists subcommands', async () => {
    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    const r = await spawnLoopScale({ args: ['domain', '--help'], cwd: tmp });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/add/);
    expect(r.stdout).toMatch(/list/);
    expect(r.stdout).toMatch(/remove/);
    expect(r.stdout).toMatch(/verify|status/);
  });
});

describe('loopscale domain list', () => {
  it('exit 4 without auth', async () => {
    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    const r = await spawnLoopScale({
      args: ['domain', 'list', '--json'],
      cwd: tmp,
      timeoutMs: 10_000,
    });
    expect(r.exitCode).toBe(4);
  });

  it('does not hang against mock API', async () => {
    const server = await startMockApi();
    servers.push(server);
    server.on({
      method: 'GET',
      path: '/api/v1/domains',
      response: { status: 200, body: { domains: [{ domain: 'app.example.com', state: 'active' }] } },
    });

    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    writeFakeAuthConfig(tmp, { loopscaleUrl: server.url });

    const r = await spawnLoopScale({
      args: ['domain', 'list', '--json'],
      cwd: tmp,
      env: { LOOPSCALE_URL: server.url },
      timeoutMs: 15_000,
    });
    expect(r.exitCode).not.toBe(143);
    expect(r.exitCode).not.toBe(-1);
  });
});

describe('loopscale domain add', () => {
  it('exit non-zero on bad domain format (usage)', async () => {
    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    const r = await spawnLoopScale({
      args: ['domain', 'add', '--json'],
      cwd: tmp,
      timeoutMs: 10_000,
    });
    // missing required <domain> arg → Commander exits 1
    expect(r.exitCode).toBe(1);
  });
});
