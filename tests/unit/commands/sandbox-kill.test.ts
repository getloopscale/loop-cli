// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { ApiError } from '../../../src/api/client';
import { SandboxKillCommand, SandboxKillDeps } from '../../../src/commands/sandbox-kill';

describe('SandboxKillCommand', () => {
  let output: string[];
  let errors: string[];
  let killed: string[];

  function makeDeps(overrides: Partial<SandboxKillDeps> = {}): SandboxKillDeps {
    return {
      getToken: () => 'test-token',
      killSandbox: async (id: string) => {
        killed.push(id);
      },
      writeTo: (msg: string) => output.push(msg),
      writeError: (msg: string) => errors.push(msg),
      ...overrides,
    };
  }

  beforeEach(() => {
    output = [];
    errors = [];
    killed = [];
  });

  it('terminates the sandbox and says so', async () => {
    const code = await new SandboxKillCommand(makeDeps()).execute('sbx_open01');

    expect(code).toBe(0);
    expect(killed).toEqual(['sbx_open01']);
    expect(output).toEqual(['Terminated sandbox sbx_open01.']);
  });

  it('reports the result as JSON with --json', async () => {
    const code = await new SandboxKillCommand(makeDeps()).execute('sbx_open01', { json: true });

    expect(code).toBe(0);
    expect(JSON.parse(output[0])).toEqual({ ok: true, id: 'sbx_open01', status: 'terminated' });
  });

  it('exits 1 when no sandbox has that id', async () => {
    const code = await new SandboxKillCommand(
      makeDeps({
        killSandbox: async () => {
          throw new ApiError('not found', 1, 404, 'not_found');
        },
      }),
    ).execute('sbx_gone');

    expect(code).toBe(1);
    expect(errors[0]).toBe('No sandbox with id sbx_gone. Run: loopscale sandbox list');
  });

  it('exits 1 on an empty id without calling the API', async () => {
    const code = await new SandboxKillCommand(makeDeps()).execute('  ');

    expect(code).toBe(1);
    expect(killed).toEqual([]);
  });

  it('exits 4 without a token', async () => {
    const code = await new SandboxKillCommand(makeDeps({ getToken: () => null })).execute('sbx_open01');

    expect(code).toBe(4);
    expect(killed).toEqual([]);
  });
});
