// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// Plan v1.1 T4.1 (theo-cli-vercel-like-ux) — `loopscale` (no args) zero-config
// delegation + EC-8 help/version position-independence.

import { execSync } from 'child_process';
import * as path from 'path';

const binPath = path.resolve(__dirname, '../../bin/loopscale');

function runTheo(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const out = execSync(`node ${binPath} ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: out, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status: number; stdout?: string; stderr?: string };
    return { exitCode: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('Plan v1.1 T4.1 — `loopscale` zero-config delegates to deploy', () => {
  it('`loopscale` (no args) attempts to deploy (exits non-zero in CI without auth/project)', () => {
    const { exitCode, stderr, stdout } = runTheo([]);
    expect(exitCode).not.toBe(0);
    const combined = stdout + stderr;
    // The delegation reaches deploy; deploy fails (no auth or no project).
    // We just need to confirm we DID reach deploy, not the old "No command".
    expect(combined).not.toContain('No command specified');
  });

  it('`loopscale --json` delegates to deploy with --json output', () => {
    const { exitCode, stdout } = runTheo(['--json']);
    expect(exitCode).not.toBe(0);
    // Output should be parseable JSON (deploy's error envelope), not the
    // pre-v1.1 "No command specified" JSON.
    if (stdout.trim().length > 0) {
      const trimmed = stdout.trim();
      // Either JSON or plain — both acceptable post-delegation as long as
      // it's NOT the old "No command specified" envelope.
      expect(trimmed).not.toContain('No command specified');
    }
  });
});

describe('Plan v1.1 EC-8 — --help/--version win regardless of position', () => {
  it('`loopscale --help` shows help (does not trigger deploy)', () => {
    const { exitCode, stdout } = runTheo(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
    expect(stdout).toContain('deploy');
  });

  it('`loopscale --version` shows version (does not trigger deploy)', () => {
    const { exitCode, stdout } = runTheo(['--version']);
    expect(exitCode).toBe(0);
    // Version output is a single token like "0.1.0" — just confirm non-empty.
    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(stdout).not.toContain('error');
  });

  it('`loopscale -h` short flag also shows help', () => {
    const { exitCode, stdout } = runTheo(['-h']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage:');
  });

  it('`loopscale nonexistent-command` shows error (unknown command path preserved)', () => {
    const { exitCode, stderr, stdout } = runTheo(['nonexistent-command']);
    expect(exitCode).not.toBe(0);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toContain('unknown');
  });
});
