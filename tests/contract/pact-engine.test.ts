// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

// T2.2 of plan canonical-tests-rewrite-v2 v1.0 per ADR-2026-06-17-T3 D7.
// Consumer-side Pact contract test. Asserts the pact-engine.json shape +
// pins the 6 interactions the CLI currently expects from the engine.
//
// When Pact-go library integration ships (ADR-V2-D2 broker decision
// pending), this test will swap to use @pact-foundation/pact-node.
// Until then: hermetic shape-grep over the JSON.

import * as fs from 'fs';
import * as path from 'path';

interface PactDoc {
  consumer: { name: string };
  provider: { name: string };
  interactions: Array<{
    description: string;
    providerState: string;
    request: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
    response: { status: number; headers?: Record<string, string>; body?: unknown };
  }>;
  metadata: { pactSpecification: { version: string } };
}

describe('Pact engine contract (T2.2)', () => {
  const pactPath = path.join(__dirname, 'pact-engine.json');
  let pact: PactDoc;

  beforeAll(() => {
    const raw = fs.readFileSync(pactPath, 'utf8');
    pact = JSON.parse(raw);
  });

  it('declares loopscale-cli as consumer and loop-runtime as provider', () => {
    expect(pact.consumer.name).toBe('loopscale-cli');
    expect(pact.provider.name).toBe('loop-runtime');
  });

  it('uses Pact specification 2.0.0', () => {
    expect(pact.metadata.pactSpecification.version).toBe('2.0.0');
  });

  it('declares >= 6 interactions covering the CLI surface', () => {
    expect(pact.interactions.length).toBeGreaterThanOrEqual(6);
  });

  it('every interaction has request + response shape', () => {
    for (const interaction of pact.interactions) {
      expect(interaction.description).toBeTruthy();
      expect(interaction.providerState).toBeTruthy();
      expect(interaction.request.method).toMatch(/^(GET|POST|PUT|DELETE|PATCH)$/);
      expect(interaction.request.path).toMatch(/^\/api\/v1\//);
      expect(interaction.response.status).toBeGreaterThanOrEqual(100);
      expect(interaction.response.status).toBeLessThan(600);
    }
  });

  it('mutating endpoints declare Idempotency-Key in request headers', () => {
    for (const interaction of pact.interactions) {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(interaction.request.method)) {
        // POST /api/v1/login is exempt (no auth yet)
        if (interaction.request.path === '/api/v1/login') continue;
        const headers = interaction.request.headers ?? {};
        expect(headers['Idempotency-Key']).toBeTruthy();
      }
    }
  });

  it('authenticated endpoints declare Authorization Bearer header', () => {
    for (const interaction of pact.interactions) {
      // /api/v1/login and /api/v1/health are unauthenticated by design
      if (['/api/v1/login', '/api/v1/health'].includes(interaction.request.path)) continue;
      const headers = interaction.request.headers ?? {};
      expect(headers['Authorization']).toMatch(/^Bearer /);
    }
  });

  it('build status enum is exhaustive per pkg/statemachine Build', () => {
    const buildGet = pact.interactions.find((i) => i.request.path === '/api/v1/builds/{id}');
    expect(buildGet).toBeDefined();
    const enumDoc = JSON.stringify(buildGet!.response.body);
    for (const state of ['QUEUED', 'RUNNING', 'RELEASING', 'SUCCEEDED', 'FAILED', 'CANCELLING', 'CANCELLED']) {
      expect(enumDoc).toContain(state);
    }
  });
});
