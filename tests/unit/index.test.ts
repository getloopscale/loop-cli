// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { execSync } from 'child_process';
import * as path from 'path';
import { program, createProgram } from '../../src/index';

describe('bin/loopscale entrypoint', () => {
  const binPath = path.resolve(__dirname, '../../bin/loopscale');

  it('should produce help output when invoked with --help', () => {
    const output = execSync(`node ${binPath} --help`, { encoding: 'utf-8' });
    expect(output).toContain('loopscale');
    expect(output).toContain('Commands:');
    expect(output).toContain('login');
    expect(output).toContain('deploy');
  });

  it('should produce version output when invoked with --version', () => {
    const output = execSync(`node ${binPath} --version`, { encoding: 'utf-8' });
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('CLI entrypoint', () => {
  it('should export a Commander program named "loopscale"', () => {
    expect(program.name()).toBe('loopscale');
  });

  it('should have a semver version string', () => {
    const version = program.version();
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should have --json global option', () => {
    const jsonOption = program.options.find(
      (opt) => opt.long === '--json'
    );
    expect(jsonOption).toBeDefined();
  });

  it('should export createProgram factory function', () => {
    expect(typeof createProgram).toBe('function');
  });

  describe('registered commands', () => {
    const commandNames = program.commands.map((cmd) => cmd.name());

    it('should register login command', () => {
      expect(commandNames).toContain('login');
    });

    it('should register logout command', () => {
      expect(commandNames).toContain('logout');
    });

    it('should register whoami command', () => {
      expect(commandNames).toContain('whoami');
    });

    it('should register project command', () => {
      expect(commandNames).toContain('project');
    });

    it('should register project delete subcommand', () => {
      const projectCmd = program.commands.find((cmd) => cmd.name() === 'project');
      expect(projectCmd).toBeDefined();
      const subcommandNames = projectCmd!.commands.map((cmd) => cmd.name());
      expect(subcommandNames).toContain('delete');
    });
  });

  describe('login command options', () => {
    const loginCmd = program.commands.find((cmd) => cmd.name() === 'login');

    it('should have --token option', () => {
      const tokenOpt = loginCmd?.options.find(
        (opt) => opt.long === '--token'
      );
      expect(tokenOpt).toBeDefined();
    });

    it('should have --team option', () => {
      const teamOpt = loginCmd?.options.find(
        (opt) => opt.long === '--team'
      );
      expect(teamOpt).toBeDefined();
    });
  });

  describe('createProgram isolation', () => {
    it('should create independent program instances', () => {
      const p1 = createProgram();
      const p2 = createProgram();
      expect(p1).not.toBe(p2);
      expect(p1.name()).toBe('loopscale');
      expect(p2.name()).toBe('loopscale');
    });
  });
});

describe('loopscale --json with no command', () => {
  const binPath = path.resolve(__dirname, '../../bin/loopscale');

  // Plan v1.1 T4.1 + EC-12 — BREAKING change (intentional): `loopscale --json`
  // (without a positional subcommand) now delegates to `loopscale deploy --json`
  // per Vercel-parity zero-config. The pre-v1.1 "No command specified"
  // envelope was replaced. New behavior is exercised by tests in
  // cli-zero-config.test.ts; here we just confirm the legacy "No command
  // specified" envelope is GONE.
  it('should NOT emit pre-v1.1 "No command specified" envelope (EC-12 breaking change)', () => {
    let output: string;
    let exitCode: number;
    try {
      output = execSync(`node ${binPath} --json`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err: unknown) {
      const e = err as { stdout?: string; status: number };
      output = e.stdout || '';
      exitCode = e.status;
    }

    expect(exitCode).not.toBe(0);
    // The new envelope MAY differ (deploy's error shape) — only invariant
    // is the OLD "No command specified" copy is no longer present.
    expect(output).not.toContain('No command specified');
  });

  it('should return exit code 1 and error message for unknown command', () => {
    let output: string;
    let exitCode: number;
    try {
      output = execSync(`node ${binPath} nonexistent-command`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status: number };
      output = (e.stderr || '') + (e.stdout || '');
      exitCode = e.status;
    }

    expect(exitCode).toBe(1);
    expect(output).toContain('Unknown command: nonexistent-command');
    expect(output).toContain('loopscale --help');
  });

  it('should return exit code 1 and structured JSON for unknown command with --json', () => {
    let output: string;
    let exitCode: number;
    try {
      output = execSync(`node ${binPath} --json nonexistent-command`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      exitCode = 0;
    } catch (err: unknown) {
      const e = err as { stdout?: string; status: number };
      output = e.stdout || '';
      exitCode = e.status;
    }

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(output.trim());
    expect(parsed).toHaveProperty('error');
    expect(parsed.error).toContain('Unknown command: nonexistent-command');
    expect(parsed).toHaveProperty('exit_code', 1);
  });

  it('should return structured JSON for missing required argument with --json (F-05)', () => {
    let output: string;
    let exitCode: number;
    try {
      output = execSync(`node ${binPath} project delete --yes --json`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      exitCode = 0;
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status: number };
      output = (e.stdout || '') + (e.stderr || '');
      exitCode = e.status;
    }

    expect(exitCode).toBe(1);
    const parsed = JSON.parse(output.trim());
    expect(parsed).toHaveProperty('error');
    expect(parsed.error).toMatch(/missing|required|name/i);
    expect(parsed).toHaveProperty('exit_code', 1);
  });

  // Plan v1.1 T4.1 + EC-12 — BREAKING change (intentional): `loopscale` (no args)
  // now delegates to `loopscale deploy` per Vercel-parity zero-config. Operators
  // discover commands via `loopscale --help` (still works, see EC-8 tests in
  // cli-zero-config.test.ts). Here we just confirm the legacy auto-help is
  // GONE — `loopscale` without args attempts deploy, which exits non-zero in CI.
  it('`loopscale` (no args) no longer auto-shows help — delegates to deploy (EC-12)', () => {
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
      stdout = execSync(`node ${binPath}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status: number };
      stdout = e.stdout || '';
      stderr = e.stderr || '';
      exitCode = e.status;
    }
    expect(exitCode).not.toBe(0);
    // Should NOT have printed the full `Usage:` block — deploy ran instead.
    const combined = stdout + stderr;
    expect(combined).not.toContain('Usage: loopscale');
  });
});
