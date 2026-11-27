// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InitCommand } from '../../../src/commands/init';
import { parseLoopScaleYaml } from '../../../src/adapters/loopscale-yaml';
import { validateConfig } from '../../../src/adapters/validate-config';
import { manifestFromDescriptor } from '../../../src/adapters/descriptor-manifest';

function project(files: Record<string, string> = {}, name = 'my-shop'): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'loopscale-init-')), name);
  fs.mkdirSync(dir);
  for (const [file, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

function run(cwd: string, opts: Parameters<InitCommand['execute']>[0] = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const exit = new InitCommand({ cwd, writeTo: (m) => out.push(m), writeError: (m) => err.push(m) }).execute(opts);
  return { exit, out: out.join('\n'), err: err.join('\n') };
}

describe('loopscale init', () => {
  it('writes a loopscale.yaml that deploy accepts for a Node project', () => {
    const dir = project({ 'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }) });

    const { exit, out } = run(dir);

    expect(exit).toBe(0);
    const written = fs.readFileSync(path.join(dir, 'loopscale.yaml'), 'utf-8');
    const config = parseLoopScaleYaml(written);
    expect(config).toEqual({
      project: 'my-shop',
      apps: { web: { path: '.', framework: 'unknown', type: 'server', port: 8080, runtime: 'node', start: 'npm start' } },
    });
    expect(validateConfig(config, dir).errors).toHaveLength(0);
    expect(manifestFromDescriptor(config).services).toHaveLength(1);
    expect(out).toContain('loopscale.yaml');
    expect(out).toContain('loopscale deploy');
  });

  it('starts a Node project with no start script from its main file', () => {
    const dir = project({ 'package.json': JSON.stringify({ main: 'src/app.js' }) });
    expect(run(dir).exit).toBe(0);
    expect(parseLoopScaleYaml(fs.readFileSync(path.join(dir, 'loopscale.yaml'), 'utf-8')).apps.web.start).toBe('node src/app.js');
  });

  it('takes project, app, runtime, start and port from the flags', () => {
    const dir = project({ 'requirements.txt': 'flask\n' });

    const { exit } = run(dir, { project: 'billing', app: 'api', start: 'python app.py', port: '9000' });

    expect(exit).toBe(0);
    const config = parseLoopScaleYaml(fs.readFileSync(path.join(dir, 'loopscale.yaml'), 'utf-8'));
    expect(config.project).toBe('billing');
    expect(config.apps.api).toMatchObject({ runtime: 'python', start: 'python app.py', port: 9000 });
  });

  it('asks for --start when it cannot tell how the app runs', () => {
    const dir = project({ 'requirements.txt': 'flask\n' });

    const { exit, err } = run(dir);

    expect(exit).toBe(1);
    expect(err).toMatch(/--start/);
    expect(fs.existsSync(path.join(dir, 'loopscale.yaml'))).toBe(false);
  });

  it('asks for --runtime in a directory it does not recognise', () => {
    const { exit, err } = run(project());
    expect(exit).toBe(1);
    expect(err).toMatch(/--runtime node or --runtime python/);
  });

  it('refuses a runtime the platform does not build', () => {
    const { exit, err } = run(project(), { runtime: 'ruby', start: 'ruby app.rb' });
    expect(exit).toBe(1);
    expect(err).toMatch(/unknown runtime 'ruby'/);
  });

  it.each(['loopscale.yaml', 'loopzero.yaml', 'loopscale.yaml'])('keeps an existing %s', (existing) => {
    const dir = project({ 'package.json': '{"scripts":{"start":"node s.js"}}', [existing]: 'project: kept\napps: {}\n' });

    const { exit, err } = run(dir);

    expect(exit).toBe(1);
    expect(err).toContain(existing);
    expect(fs.readFileSync(path.join(dir, existing), 'utf-8')).toBe('project: kept\napps: {}\n');
  });

  it('replaces loopscale.yaml with --force', () => {
    const dir = project({ 'package.json': '{"scripts":{"start":"node s.js"}}', 'loopscale.yaml': 'project: old\napps: {}\n' });
    expect(run(dir, { force: true }).exit).toBe(0);
    expect(parseLoopScaleYaml(fs.readFileSync(path.join(dir, 'loopscale.yaml'), 'utf-8')).project).toBe('my-shop');
  });

  it('derives a valid project name from a directory name that is not one', () => {
    const dir = project({ 'package.json': '{"scripts":{"start":"node s.js"}}' }, 'My Shop_2');
    expect(run(dir).exit).toBe(0);
    expect(parseLoopScaleYaml(fs.readFileSync(path.join(dir, 'loopscale.yaml'), 'utf-8')).project).toBe('my-shop-2');
  });

  it('prints one JSON object with --json', () => {
    const dir = project({ 'package.json': '{"scripts":{"start":"node s.js"}}' });
    const { exit, out } = run(dir, { json: true });
    expect(exit).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ file: path.join(dir, 'loopscale.yaml'), project: 'my-shop', app: 'web', runtime: 'node' });
  });
});
