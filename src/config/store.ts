// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readEnv } from './env';

/** Directory names used before the LoopScale rename; still read as a fallback. */
const LEGACY_XDG_DIR_NAME = 'theo';
const LEGACY_HOME_DIR_NAME = '.theo';

interface CliConfig {
  token: string;
  email: string;
  team: string;
  refresh_token?: string;
  token_expires_at?: number; // Unix timestamp (seconds)
}

export class ConfigStore {
  readonly configDir: string;
  private readonly configPath: string;
  private readonly legacyConfigPath: string;
  private legacyNoticePrinted = false;

  constructor(baseDir: string, xdgMode = false) {
    this.configDir = xdgMode
      ? path.join(baseDir, 'loopscale')
      : path.join(baseDir, '.loopscale');
    this.configPath = path.join(this.configDir, 'config.json');
    this.legacyConfigPath = path.join(
      baseDir,
      xdgMode ? LEGACY_XDG_DIR_NAME : LEGACY_HOME_DIR_NAME,
      'config.json',
    );
  }

  static default(): ConfigStore {
    const xdg = process.env.XDG_CONFIG_HOME;
    if (xdg) {
      return new ConfigStore(xdg, true);
    }
    return new ConfigStore(os.homedir());
  }

  saveToken(token: string, email: string, team: string, refreshToken?: string, expiresIn?: number): void {
    fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });

    const config: CliConfig = { token, email, team };
    if (refreshToken) {
      config.refresh_token = refreshToken;
    }
    if (expiresIn) {
      config.token_expires_at = Math.floor(Date.now() / 1000) + expiresIn;
    }
    // Atomic write: write to temp file with correct permissions, then rename.
    // This avoids a window where the file exists with stale permissions
    // and token content is world-readable.
    const tmpPath = this.configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this.configPath);
  }

  /**
   * Reads the config written by this CLI. When it does not exist yet, falls
   * back to the file a pre-rename CLI wrote (`~/.theo/config.json` or
   * `$XDG_CONFIG_HOME/theo/config.json`) so an existing login keeps working.
   * The next `saveToken` (login or token refresh) writes the new location.
   */
  getConfig(): CliConfig | null {
    const current = readConfigFile(this.configPath);
    if (current !== undefined) {
      return current;
    }
    const legacy = readConfigFile(this.legacyConfigPath);
    if (legacy === undefined) {
      return null;
    }
    if (!this.legacyNoticePrinted) {
      this.legacyNoticePrinted = true;
      process.stderr.write(
        `Warning: reading login from deprecated ${this.legacyConfigPath}; run \`loopscale login\` to store it at ${this.configPath}.\n`,
      );
    }
    return legacy;
  }

  getToken(): string | null {
    // LOOPSCALE_TOKEN (or the deprecated THEO_TOKEN) takes precedence over
    // the config file (CI/CD support).
    const envToken = readEnv('LOOPSCALE_TOKEN', 'THEO_TOKEN');
    if (envToken) {
      return envToken;
    }
    return this.getConfig()?.token ?? null;
  }

  getEmail(): string | null {
    return this.getConfig()?.email ?? null;
  }

  getTeam(): string | null {
    return this.getConfig()?.team ?? null;
  }

  getRefreshToken(): string | null {
    return this.getConfig()?.refresh_token ?? null;
  }

  isTokenExpired(): boolean {
    const config = this.getConfig();
    if (!config?.token_expires_at) return false; // PAT tokens don't expire
    // Consider expired 60 seconds before actual expiration (buffer for clock skew)
    return Math.floor(Date.now() / 1000) >= config.token_expires_at - 60;
  }

  /**
   * Removes the login from both the current and the legacy location;
   * otherwise logging out would fall back to the pre-rename login.
   */
  clearToken(): void {
    for (const file of [this.configPath, this.legacyConfigPath]) {
      try {
        fs.unlinkSync(file);
      } catch {
        // File may not exist — that's fine
      }
    }
  }
}

/**
 * Returns the parsed config, `null` when the file exists but cannot be read
 * or parsed (the pre-existing behaviour), or `undefined` when there is no
 * file, which is the only case that triggers the legacy fallback.
 */
function readConfigFile(file: string): CliConfig | null | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? undefined : null;
  }
  try {
    return JSON.parse(raw) as CliConfig;
  } catch {
    return null;
  }
}
