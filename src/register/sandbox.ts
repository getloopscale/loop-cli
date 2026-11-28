// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { ApiClient } from '../api/client';
import { SandboxKillCommand } from '../commands/sandbox-kill';
import { SandboxItem, SandboxListCommand } from '../commands/sandbox-list';
import { API_REQUEST_TIMEOUT_MS, stripEngineSuffix } from '../config/constants';
import { CommandDeps } from './types';

/** How many sandboxes one `sandbox list` asks for: the largest page the API serves. */
const SANDBOX_LIST_LIMIT = 200;

export function registerSandboxCommands(deps: CommandDeps): void {
  const { program, configStore, writeTo, writeError, getGlobalOpts, cloudUrl, handleUnauthorized, withTimeout } = deps;

  // The console serves /v1/sandboxes at its root, beside /v1/auth, and not under the
  // /engine proxy that LOOPSCALE_URL usually ends with.
  const sandboxClient = (): ApiClient =>
    new ApiClient({
      baseURL: stripEngineSuffix(cloudUrl),
      token: configStore.getToken() ?? undefined,
      onUnauthorized: handleUnauthorized,
    });

  const sandboxCmd = program.command('sandbox').description('See and terminate code sandboxes');

  sandboxCmd
    .command('list')
    .description('List the sandboxes that are running or paused')
    .action(async () => {
      const globalOpts = getGlobalOpts();
      const cmd = new SandboxListCommand({
        getToken: () => configStore.getToken(),
        listSandboxes: () => sandboxClient().get<{ sandboxes: SandboxItem[] }>(`/v1/sandboxes?limit=${SANDBOX_LIST_LIMIT}`),
        writeTo,
        writeError,
      });

      process.exitCode = await withTimeout(
        cmd.execute({ json: globalOpts.json }),
        API_REQUEST_TIMEOUT_MS + 10_000,
        'Sandbox list timed out. Check your connection and try again.',
      ).catch((err: Error) => {
        if (globalOpts.json) {
          writeTo(JSON.stringify({ code: 'SANDBOX_LIST_TIMEOUT', error: err.message, exit_code: 1 }));
        } else {
          writeError(err.message);
        }
        return 1;
      });
    });

  sandboxCmd
    .command('kill <id>')
    .description('Terminate a sandbox: its processes stop and its files are deleted')
    .action(async (id: string) => {
      const globalOpts = getGlobalOpts();
      const cmd = new SandboxKillCommand({
        getToken: () => configStore.getToken(),
        killSandbox: async (sandboxId: string) => {
          await sandboxClient().del<void>(`/v1/sandboxes/${encodeURIComponent(sandboxId)}`);
        },
        writeTo,
        writeError,
      });

      process.exitCode = await withTimeout(
        cmd.execute(id, { json: globalOpts.json }),
        API_REQUEST_TIMEOUT_MS + 10_000,
        'Sandbox kill timed out. Check your connection and try again.',
      ).catch((err: Error) => {
        if (globalOpts.json) {
          writeTo(JSON.stringify({ code: 'SANDBOX_KILL_TIMEOUT', error: err.message, exit_code: 3 }));
        } else {
          writeError(err.message);
        }
        return 3;
      });
    });
}
