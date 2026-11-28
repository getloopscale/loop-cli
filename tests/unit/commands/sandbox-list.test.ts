// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { ApiError } from '../../../src/api/client';
import { SandboxListCommand, SandboxListDeps } from '../../../src/commands/sandbox-list';

describe('SandboxListCommand', () => {
  let output: string[];
  let errors: string[];

  function makeDeps(overrides: Partial<SandboxListDeps> = {}): SandboxListDeps {
    return {
      getToken: () => 'test-token',
      listSandboxes: async () => ({
        sandboxes: [
          { id: 'sbx_open01', image: 'python:3.12-slim', state: 'running', created_at: '2026-11-27T10:00:00Z' },
          {
            id: 'sbx_locked02',
            image: 'node:22-slim',
            state: 'paused',
            created_at: '2026-11-27T10:05:00Z',
            network: { allow_out: ['pypi.org'], deny_out: ['0.0.0.0/0'] },
          },
        ],
      }),
      writeTo: (msg: string) => output.push(msg),
      writeError: (msg: string) => errors.push(msg),
      ...overrides,
    };
  }

  beforeEach(() => {
    output = [];
    errors = [];
  });

  it('prints one row per sandbox with state, image and outbound network', async () => {
    const code = await new SandboxListCommand(makeDeps()).execute();

    expect(code).toBe(0);
    const open = output.find((line) => line.includes('sbx_open01'));
    const locked = output.find((line) => line.includes('sbx_locked02'));
    expect(open).toMatch(/running\s+python:3\.12-slim\s+open/);
    expect(locked).toMatch(/paused\s+node:22-slim\s+restricted/);
    expect(output[output.length - 1]).toBe('2 sandboxes');
  });

  it('says there are none and exits 0', async () => {
    const code = await new SandboxListCommand(makeDeps({ listSandboxes: async () => ({ sandboxes: [] }) })).execute();

    expect(code).toBe(0);
    expect(output).toEqual(['No sandboxes running.']);
  });

  it('prints the sandboxes as JSON with --json', async () => {
    const code = await new SandboxListCommand(makeDeps()).execute({ json: true });

    expect(code).toBe(0);
    const parsed = JSON.parse(output[0]);
    expect(parsed.total).toBe(2);
    expect(parsed.sandboxes[1].network.allow_out).toEqual(['pypi.org']);
  });

  it('exits 4 without a token and does not call the API', async () => {
    const listSandboxes = jest.fn();
    const code = await new SandboxListCommand(makeDeps({ getToken: () => null, listSandboxes })).execute();

    expect(code).toBe(4);
    expect(listSandboxes).not.toHaveBeenCalled();
    expect(errors[0]).toContain('loopscale login');
  });

  it('exits 1 and names the failure when the API refuses', async () => {
    const code = await new SandboxListCommand(
      makeDeps({
        listSandboxes: async () => {
          throw new ApiError('sandboxes are not enabled', 1, 503, 'SANDBOX_UNAVAILABLE');
        },
      }),
    ).execute({ json: true });

    expect(code).toBe(1);
    expect(JSON.parse(output[0])).toMatchObject({ code: 'SANDBOX_UNAVAILABLE', exit_code: 1 });
  });
});
