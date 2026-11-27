// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigStore } from '../../../src/config/store';

describe('ConfigStore.default() — XDG_CONFIG_HOME support', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should use $XDG_CONFIG_HOME/loopscale/ when XDG_CONFIG_HOME is set', () => {
    const xdgDir = '/tmp/test-xdg-config';
    process.env.XDG_CONFIG_HOME = xdgDir;

    const store = ConfigStore.default();

    // Verify the config path uses XDG directory without dot prefix
    expect(store.configDir).toBe(path.join(xdgDir, 'loopscale'));
  });

  it('should use $HOME/.loopscale/ when XDG_CONFIG_HOME is NOT set', () => {
    delete process.env.XDG_CONFIG_HOME;
    const home = os.homedir();

    const store = ConfigStore.default();

    expect(store.configDir).toBe(path.join(home, '.loopscale'));
  });

  it('should use $HOME/.loopscale/ when XDG_CONFIG_HOME is empty string', () => {
    process.env.XDG_CONFIG_HOME = '';
    const home = os.homedir();

    const store = ConfigStore.default();

    expect(store.configDir).toBe(path.join(home, '.loopscale'));
  });

  describe('XDG mode stores and retrieves config correctly', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loopscale-xdg-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should use loopscale/ (no dot) under XDG_CONFIG_HOME', () => {
      process.env.XDG_CONFIG_HOME = tmpDir;

      const store = ConfigStore.default();
      store.saveToken('ghp_xdg', 'xdg@test.com', 'xdg-team');

      // Config should be at $XDG_CONFIG_HOME/loopscale/config.json (no dot prefix)
      const configPath = path.join(tmpDir, 'loopscale', 'config.json');
      expect(fs.existsSync(configPath)).toBe(true);

      expect(store.getToken()).toBe('ghp_xdg');
      expect(store.getEmail()).toBe('xdg@test.com');
      expect(store.getTeam()).toBe('xdg-team');
    });

    it('should use .loopscale/ under HOME (fallback)', () => {
      delete process.env.XDG_CONFIG_HOME;
      // We can't test with real homedir, so test the constructor directly
      const store = new ConfigStore(tmpDir);
      store.saveToken('ghp_home', 'home@test.com', 'home-team');

      const configPath = path.join(tmpDir, '.loopscale', 'config.json');
      expect(fs.existsSync(configPath)).toBe(true);
    });
  });
});
