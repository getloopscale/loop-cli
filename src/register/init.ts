// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { InitCommand } from '../commands/init';
import type { CommandDeps } from './types';

export function registerInitCommand(deps: CommandDeps): void {
  const { program, writeTo, writeError, getGlobalOpts } = deps;

  program
    .command('init')
    .description('Write a loopscale.yaml for the project in this directory')
    .option('--project <name>', 'Project name (default: the directory name)')
    .option('--app <name>', 'App name (default: web)')
    .option('--runtime <runtime>', 'node or python (default: detected from the project files)')
    .option('--start <command>', 'Command that runs the app (default: detected for Node projects)')
    .option('--port <port>', 'Port the app listens on (default: 8080)')
    .option('--force', 'Replace an existing loopscale.yaml')
    .option('--json', 'Output in JSON format')
    .action((cmdOpts) => {
      const json = Boolean(cmdOpts.json || getGlobalOpts().json);
      process.exitCode = new InitCommand({ cwd: process.cwd(), writeTo, writeError }).execute({ ...cmdOpts, json });
    });
}
