// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigStore } from '../../../src/config/store';

/**
 * The CLI keeps its login only under the `loopscale` name. A file left at
 * `~/.theo/config.json` or `$XDG_CONFIG_HOME/theo/config.json` by another
 * tool, and the `THEO_TOKEN` variable, must have no effect.
 */
describe('ConfigStore ignores theo config and env', () => {
  let tmpDir: string;
  let stderrSpy: jest.SpyInstance;
  const originalEnv = { ...process.env };

  function writeTheoConfig(dir: string): string {
    fs.mkdirSync(dir, { recursive: true });
    const theoConfigPath = path.join(dir, 'config.json');
    fs.writeFileSync(
      theoConfigPath,
      JSON.stringify({ token: 'tok-theo', email: 'theo@example.com', team: 'theo-team', refresh_token: 'rt-theo' }),
    );
    return theoConfigPath;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscale-theo-config-test-'));
    delete process.env.LOOPSCALE_TOKEN;
    delete process.env.THEO_TOKEN;
    stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.env = { ...originalEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not read a login from ~/.theo/config.json', () => {
    writeTheoConfig(path.join(tmpDir, '.theo'));
    const store = new ConfigStore(tmpDir);

    expect(store.getToken()).toBeNull();
    expect(store.getEmail()).toBeNull();
    expect(store.getTeam()).toBeNull();
    expect(store.getRefreshToken()).toBeNull();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('does not read a login from $XDG_CONFIG_HOME/theo/config.json in XDG mode', () => {
    writeTheoConfig(path.join(tmpDir, 'theo'));
    const store = new ConfigStore(tmpDir, true);

    expect(store.getToken()).toBeNull();
  });

  it('ignores THEO_TOKEN', () => {
    process.env.THEO_TOKEN = 'tok-env-theo';
    const store = new ConfigStore(tmpDir);

    expect(store.getToken()).toBeNull();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('logout leaves ~/.theo/config.json untouched', () => {
    const theoConfigPath = writeTheoConfig(path.join(tmpDir, '.theo'));
    const store = new ConfigStore(tmpDir);
    store.saveToken('tok-new', 'new@example.com', 'new-team');

    store.clearToken();

    expect(fs.existsSync(path.join(tmpDir, '.loopscale', 'config.json'))).toBe(false);
    expect(fs.existsSync(theoConfigPath)).toBe(true);
  });
});
