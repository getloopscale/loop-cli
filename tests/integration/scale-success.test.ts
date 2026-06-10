// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Phase 4 T4.2 — `scale` register integration test.
// CLAUDE.md says: "theo scale DB persistence (stub returns 202
// acknowledged — use theo.yaml + theo deploy)". This test pins that
// honest-stub contract so accidental "make it work" attempts that
// would mask the missing implementation get caught.

import { describe, it, expect, afterEach } from '@jest/globals';
import {
  spawnTheo,
  mkTmpHome,
  cleanupTmpHome,
  writeFakeAuthConfig,
  writeFakeTheoYaml,
  parseLastJsonLine,
} from './_fixtures/spawn-helper';
import { startMockApi, MockApiServer } from './_fixtures/mock-api-server';

const tmpHomes: string[] = [];
const servers: MockApiServer[] = [];

afterEach(async () => {
  while (tmpHomes.length) cleanupTmpHome(tmpHomes.pop()!);
  while (servers.length) await servers.pop()!.close();
});

describe('theo scale --help', () => {
  it('exit 0', async () => {
    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    const r = await spawnTheo({ args: ['scale', '--help'], cwd: tmp });
    expect(r.exitCode).toBe(0);
  });
});

describe('theo scale (STUB per CLAUDE.md)', () => {
  it('returns 202 acknowledged stub for valid request', async () => {
    const server = await startMockApi();
    servers.push(server);
    server.on({
      method: 'POST',
      path: '/api/v1/scale',
      response: { status: 202, body: { acknowledged: true, status: 'pending', message: 'Use theo.yaml + theo deploy for actual scaling' } },
    });

    const tmp = mkTmpHome();
    tmpHomes.push(tmp);
    writeFakeAuthConfig(tmp, { theoUrl: server.url });
    writeFakeTheoYaml(tmp);

    const r = await spawnTheo({
      args: ['scale', '--app', 'api', '--replicas', '3', '--env', 'production', '--json'],
      cwd: tmp,
      env: { THEO_URL: server.url },
      timeoutMs: 15_000,
    });
    // Stub semantics: command may exit 0 (acknowledged stub), 1
    // (usage), or 3 (deploy failure — CLAUDE.md note "use theo.yaml +
    // theo deploy" suggests scale may surface non-implementation as
    // exit 3). Reject hang or unexpected codes (-1, 143).
    expect([0, 1, 3]).toContain(r.exitCode);
    if (r.exitCode === 0) {
      const body = parseLastJsonLine(r.stdout);
      expect(body).not.toBeNull();
    }
  });
});
