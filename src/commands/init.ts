// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { DESCRIPTOR_FILE_NAME, DESCRIPTOR_FILE_NAMES } from '../adapters/theo-yaml';
import { SUPPORTED_RUNTIMES } from '../adapters/descriptor-manifest';

export interface InitDeps {
  cwd: string;
  writeTo: (message: string) => void;
  writeError: (message: string) => void;
}

export interface InitOptions {
  project?: string;
  app?: string;
  runtime?: string;
  start?: string;
  port?: string;
  force?: boolean;
  json?: boolean;
}

const DEFAULT_APP_NAME = 'web';
const DEFAULT_PORT = 8080;

/** Writes a loopscale.yaml for the project in the current directory. */
export class InitCommand {
  constructor(private readonly deps: InitDeps) {}

  execute(opts: InitOptions = {}): number {
    const { cwd } = this.deps;
    const target = path.join(cwd, DESCRIPTOR_FILE_NAME);

    for (const name of DESCRIPTOR_FILE_NAMES) {
      const replaceable = name === DESCRIPTOR_FILE_NAME && opts.force === true;
      if (fs.existsSync(path.join(cwd, name)) && !replaceable) {
        const hint = name === DESCRIPTOR_FILE_NAME
          ? 'Pass --force to replace it.'
          : `Rename it to ${DESCRIPTOR_FILE_NAME}, or remove it first.`;
        return this.fail(opts, 'DESCRIPTOR_EXISTS', `${name} already exists in this directory. ${hint}`);
      }
    }

    const detected = detectProject(cwd);
    const runtime = opts.runtime ?? detected.runtime;
    if (!runtime) {
      return this.fail(opts, 'RUNTIME_UNKNOWN',
        'Could not tell what this project runs on: no package.json, requirements.txt or pyproject.toml here. Pass --runtime node or --runtime python, and --start with the command that runs the app.');
    }
    if (!SUPPORTED_RUNTIMES.includes(runtime)) {
      return this.fail(opts, 'RUNTIME_UNSUPPORTED', `unknown runtime '${runtime}'. Supported: ${SUPPORTED_RUNTIMES.join(', ')}.`);
    }
    const start = opts.start ?? (runtime === detected.runtime ? detected.start : undefined);
    if (!start) {
      return this.fail(opts, 'START_UNKNOWN',
        `Could not tell how this ${runtime} app starts. Pass --start with the command that runs it, for example --start "${runtime === 'node' ? 'node server.js' : 'python app.py'}".`);
    }
    const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return this.fail(opts, 'PORT_INVALID', `--port ${opts.port} is not a port the platform accepts. Use a whole number from 1024 to 65535.`);
    }
    const project = opts.project ?? resourceName(path.basename(cwd));
    if (!isResourceName(project)) {
      return this.fail(opts, 'PROJECT_NAME_INVALID',
        `'${project}' is not a valid project name. Pass --project with lowercase letters, digits and hyphens, starting with a letter.`);
    }
    const app = opts.app ?? DEFAULT_APP_NAME;
    if (!isResourceName(app)) {
      return this.fail(opts, 'APP_NAME_INVALID',
        `'${app}' is not a valid app name. Pass --app with lowercase letters, digits and hyphens, starting with a letter.`);
    }

    const descriptor = { project, apps: { [app]: { path: '.', type: 'server', port, runtime, start } } };
    fs.writeFileSync(target, yaml.dump(descriptor, { lineWidth: -1 }));

    if (opts.json) {
      this.deps.writeTo(JSON.stringify({ file: target, project, app, runtime, start, port }));
    } else {
      this.deps.writeTo(`Wrote ${DESCRIPTOR_FILE_NAME}: project ${project}, app ${app} (${runtime}, port ${port}, start: ${start}).`);
      this.deps.writeTo('The app must listen on that port. Next: loopscale deploy');
    }
    return 0;
  }

  private fail(opts: InitOptions, code: string, message: string): number {
    if (opts.json) {
      this.deps.writeTo(JSON.stringify({ code, error: message, exit_code: 1 }));
    } else {
      this.deps.writeError(message);
    }
    return 1;
  }
}

/** What the files in a directory say about the runtime and the start command. */
function detectProject(cwd: string): { runtime?: string; start?: string } {
  const packageJson = path.join(cwd, 'package.json');
  if (fs.existsSync(packageJson)) {
    return { runtime: 'node', start: nodeStart(cwd, packageJson) };
  }
  if (fs.existsSync(path.join(cwd, 'requirements.txt')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
    return { runtime: 'python' };
  }
  return {};
}

function nodeStart(cwd: string, packageJson: string): string | undefined {
  let manifest: { scripts?: Record<string, unknown>; main?: unknown };
  try {
    manifest = JSON.parse(fs.readFileSync(packageJson, 'utf-8'));
  } catch {
    return undefined; // an unreadable package.json says nothing; the caller asks for --start
  }
  if (typeof manifest.scripts?.start === 'string' && manifest.scripts.start !== '') {
    return 'npm start';
  }
  if (typeof manifest.main === 'string' && manifest.main !== '') {
    return `node ${manifest.main}`;
  }
  const entry = ['server.js', 'index.js'].find((file) => fs.existsSync(path.join(cwd, file)));
  return entry ? `node ${entry}` : undefined;
}

function isResourceName(name: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(name) && name.length <= 63 && !name.endsWith('-');
}

/** The closest valid name to a directory name: "My Shop_2" becomes "my-shop-2". */
function resourceName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 63);
}
