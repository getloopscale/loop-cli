// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { readEnv, resetLegacyEnvWarnings } from '../../../src/config/env';

describe('readEnv', () => {
  const originalEnv = { ...process.env };
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    resetLegacyEnvWarnings();
    delete process.env.LOOPSCALE_URL;
    delete process.env.THEO_URL;
    delete process.env.THEO_API_URL;
    stderrSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    process.env = { ...originalEnv };
  });

  function stderrOutput(): string {
    return stderrSpy.mock.calls.map((call) => String(call[0])).join('');
  }

  it('returns the LOOPSCALE_ variable without any notice', () => {
    process.env.LOOPSCALE_URL = 'https://api.example.com';

    expect(readEnv('LOOPSCALE_URL', 'THEO_URL')).toBe('https://api.example.com');
    expect(stderrOutput()).toBe('');
  });

  it('prefers the LOOPSCALE_ variable over the legacy THEO_ variable', () => {
    process.env.LOOPSCALE_URL = 'https://new.example.com';
    process.env.THEO_URL = 'https://old.example.com';

    expect(readEnv('LOOPSCALE_URL', 'THEO_URL')).toBe('https://new.example.com');
    expect(stderrOutput()).toBe('');
  });

  it('falls back to the legacy THEO_ variable and prints a one-line deprecation notice on stderr', () => {
    process.env.THEO_URL = 'https://old.example.com';

    expect(readEnv('LOOPSCALE_URL', 'THEO_URL')).toBe('https://old.example.com');
    expect(stderrOutput()).toBe('Warning: THEO_URL is deprecated; use LOOPSCALE_URL instead.\n');
  });

  it('prints the deprecation notice once per variable per process', () => {
    process.env.THEO_URL = 'https://old.example.com';

    readEnv('LOOPSCALE_URL', 'THEO_URL');
    readEnv('LOOPSCALE_URL', 'THEO_URL');

    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('checks several legacy names in order', () => {
    process.env.THEO_API_URL = 'https://older.example.com';

    expect(readEnv('LOOPSCALE_URL', 'THEO_URL', 'THEO_API_URL')).toBe('https://older.example.com');
    expect(stderrOutput()).toContain('THEO_API_URL is deprecated; use LOOPSCALE_URL instead.');
  });

  it('treats an empty string as unset', () => {
    process.env.LOOPSCALE_URL = '';
    process.env.THEO_URL = '';

    expect(readEnv('LOOPSCALE_URL', 'THEO_URL')).toBeUndefined();
    expect(stderrOutput()).toBe('');
  });
});
