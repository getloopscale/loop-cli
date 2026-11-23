// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigStore } from '../../../src/config/store';
import { resetLegacyEnvWarnings } from '../../../src/config/env';

/**
 * Users who logged in with the CLI before the LoopScale rename have their
 * login at `~/.theo/config.json` (or `$XDG_CONFIG_HOME/theo/config.json`).
 * The renamed CLI must keep that login working until it is rewritten under
 * the new name.
 */
describe('ConfigStore legacy config fallback', () => {
  let tmpDir: string;
  let stderrSpy: jest.SpyInstance;
  const originalEnv = { ...process.env };

  function writeLegacyConfig(dir: string, token: string): string {
    fs.mkdirSync(dir, { recursive: true });
    const legacyPath = path.join(dir, 'config.json');
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ token, email: 'old@example.com', team: 'old-team', refresh_token: 'rt-old' }),
    );
    return legacyPath;
  }

  function stderrOutput(): string {
    return stderrSpy.mock.calls.map((call) => String(call[0])).join('');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscale-legacy-test-'));
    delete process.env.LOOPSCALE_TOKEN;
    delete process.env.THEO_TOKEN;
    resetLegacyEnvWarnings();
    stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads the login from ~/.theo/config.json when ~/.loopscale/config.json is missing', () => {
    writeLegacyConfig(path.join(tmpDir, '.theo'), 'tok-legacy');
    const store = new ConfigStore(tmpDir);

    expect(store.getToken()).toBe('tok-legacy');
    expect(store.getEmail()).toBe('old@example.com');
    expect(store.getTeam()).toBe('old-team');
    expect(store.getRefreshToken()).toBe('rt-old');
  });

  it('reads the login from $XDG_CONFIG_HOME/theo/config.json in XDG mode', () => {
    writeLegacyConfig(path.join(tmpDir, 'theo'), 'tok-legacy-xdg');
    const store = new ConfigStore(tmpDir, true);

    expect(store.getToken()).toBe('tok-legacy-xdg');
  });

  it('prints a single one-line deprecation notice naming both paths', () => {
    const legacyPath = writeLegacyConfig(path.join(tmpDir, '.theo'), 'tok-legacy');
    const store = new ConfigStore(tmpDir);

    store.getToken();
    store.getEmail();
    store.getTeam();

    const output = stderrOutput();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(output.trim().split('\n')).toHaveLength(1);
    expect(output).toContain(legacyPath);
    expect(output).toContain(path.join(tmpDir, '.loopscale', 'config.json'));
    expect(output).toContain('loopscale login');
  });

  it('does not print the notice when no legacy config exists', () => {
    const store = new ConfigStore(tmpDir);

    expect(store.getToken()).toBeNull();
    expect(stderrOutput()).toBe('');
  });

  it('prefers the new config over the legacy one', () => {
    writeLegacyConfig(path.join(tmpDir, '.theo'), 'tok-legacy');
    const store = new ConfigStore(tmpDir);
    store.saveToken('tok-new', 'new@example.com', 'new-team');

    expect(store.getToken()).toBe('tok-new');
    expect(stderrOutput()).toBe('');
  });

  it('writes a new login to ~/.loopscale/config.json and leaves the legacy file untouched', () => {
    const legacyPath = writeLegacyConfig(path.join(tmpDir, '.theo'), 'tok-legacy');
    const store = new ConfigStore(tmpDir);

    store.saveToken('tok-new', 'new@example.com', 'new-team');

    const newConfig = JSON.parse(fs.readFileSync(path.join(tmpDir, '.loopscale', 'config.json'), 'utf-8'));
    expect(newConfig.token).toBe('tok-new');
    expect(JSON.parse(fs.readFileSync(legacyPath, 'utf-8')).token).toBe('tok-legacy');
  });

  it('logout removes both the new and the legacy config so the user is really logged out', () => {
    const legacyPath = writeLegacyConfig(path.join(tmpDir, '.theo'), 'tok-legacy');
    const store = new ConfigStore(tmpDir);
    store.saveToken('tok-new', 'new@example.com', 'new-team');

    store.clearToken();

    expect(fs.existsSync(path.join(tmpDir, '.loopscale', 'config.json'))).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(store.getToken()).toBeNull();
  });

  it('accepts LOOPSCALE_TOKEN over THEO_TOKEN and both over the config file', () => {
    writeLegacyConfig(path.join(tmpDir, '.theo'), 'tok-legacy');
    const store = new ConfigStore(tmpDir);

    process.env.THEO_TOKEN = 'tok-env-legacy';
    expect(store.getToken()).toBe('tok-env-legacy');
    expect(stderrOutput()).toContain('THEO_TOKEN is deprecated; use LOOPSCALE_TOKEN instead.');

    process.env.LOOPSCALE_TOKEN = 'tok-env-new';
    expect(store.getToken()).toBe('tok-env-new');
  });
});
