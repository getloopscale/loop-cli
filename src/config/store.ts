// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface TheoConfig {
  token: string;
  email: string;
  team: string;
}

export class ConfigStore {
  readonly configDir: string;
  private readonly configPath: string;

  constructor(baseDir: string, xdgMode = false) {
    this.configDir = xdgMode
      ? path.join(baseDir, 'theo')
      : path.join(baseDir, '.theo');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  static default(): ConfigStore {
    const xdg = process.env.XDG_CONFIG_HOME;
    if (xdg) {
      return new ConfigStore(xdg, true);
    }
    return new ConfigStore(os.homedir());
  }

  saveToken(token: string, email: string, team: string): void {
    fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });

    const config: TheoConfig = { token, email, team };
    // Atomic write: write to temp file with correct permissions, then rename.
    // This avoids a window where the file exists with stale permissions
    // and token content is world-readable.
    const tmpPath = this.configPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this.configPath);
  }

  getConfig(): TheoConfig | null {
    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(raw) as TheoConfig;
    } catch {
      return null;
    }
  }

  getToken(): string | null {
    // THEO_TOKEN env var takes precedence over config file (CI/CD support)
    const envToken = process.env.THEO_TOKEN;
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

  clearToken(): void {
    try {
      fs.unlinkSync(this.configPath);
    } catch {
      // File may not exist — that's fine
    }
  }
}
