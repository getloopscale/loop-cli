// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

describe('CLI config/constants', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear all URL env vars for clean test state
    for (const name of Object.keys(process.env)) {
      if (name.startsWith('LOOPSCALE_') || name.startsWith('LOOPSCALE_')) {
        delete process.env[name];
      }
    }
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  function loadConstants() {
    // Re-import to pick up changed env vars
    return jest.requireActual('../../../src/config/constants');
  }

  describe('envInt (via API_REQUEST_TIMEOUT_MS)', () => {
    it('should return default when env var is missing', () => {
      delete process.env.LOOPSCALE_API_TIMEOUT;
      const constants = loadConstants();
      expect(constants.API_REQUEST_TIMEOUT_MS).toBe(30000);
    });

    it('should return default when env var is NaN', () => {
      process.env.LOOPSCALE_API_TIMEOUT = 'not-a-number';
      const constants = loadConstants();
      expect(constants.API_REQUEST_TIMEOUT_MS).toBe(30000);
    });

    it('should return parsed value for valid env var', () => {
      process.env.LOOPSCALE_API_TIMEOUT = '5000';
      const constants = loadConstants();
      expect(constants.API_REQUEST_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('getDefaultApiUrl (MEET-040: unified LOOPSCALE_URL)', () => {
    it('should return LOOPSCALE_URL when set', () => {
      process.env.LOOPSCALE_URL = 'https://api.example.com';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('https://api.example.com');
    });

    it('should return THEO_API_URL as legacy fallback', () => {
      process.env.THEO_API_URL = 'https://api.example.com';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('https://api.example.com');
    });

    it('should still accept the legacy THEO_URL', () => {
      process.env.THEO_URL = 'https://legacy.example.com';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('https://legacy.example.com');
    });

    it('should prefer LOOPSCALE_URL over THEO_URL', () => {
      process.env.LOOPSCALE_URL = 'https://new.example.com';
      process.env.THEO_URL = 'https://legacy.example.com';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('https://new.example.com');
    });

    it('should prefer LOOPSCALE_URL over THEO_API_URL', () => {
      process.env.LOOPSCALE_URL = 'https://new.example.com';
      process.env.THEO_API_URL = 'https://old.example.com';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('https://new.example.com');
    });

    it('should return fallback when no URL env vars set', () => {
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('http://localhost:8080');
    });

    it('should return fallback when LOOPSCALE_URL is empty string', () => {
      process.env.LOOPSCALE_URL = '';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('http://localhost:8080');
    });
  });

  describe('getCloudUrl (MEET-040: defaults to same as API URL)', () => {
    it('should still accept the legacy THEO_CLOUD_URL', () => {
      process.env.THEO_CLOUD_URL = 'https://cloud.example.com';
      const constants = loadConstants();
      expect(constants.getCloudUrl()).toBe('https://cloud.example.com');
    });

    it('should return LOOPSCALE_CLOUD_URL when set', () => {
      process.env.LOOPSCALE_CLOUD_URL = 'https://cloud.example.com';
      const constants = loadConstants();
      expect(constants.getCloudUrl()).toBe('https://cloud.example.com');
    });

    it('should return same as getDefaultApiUrl when LOOPSCALE_CLOUD_URL not set', () => {
      process.env.LOOPSCALE_URL = 'https://api.example.com';
      const constants = loadConstants();
      expect(constants.getCloudUrl()).toBe('https://api.example.com');
    });

    it('should return fallback when no URL env vars set', () => {
      const constants = loadConstants();
      expect(constants.getCloudUrl()).toBe('http://localhost:8080');
    });
  });

  describe('DEFAULT_API_URL_FALLBACK', () => {
    it('should be localhost:8080', () => {
      const constants = loadConstants();
      expect(constants.DEFAULT_API_URL_FALLBACK).toBe('http://localhost:8080');
    });
  });

  describe('legacy timeout overrides', () => {
    it('should still accept the legacy THEO_DEPLOY_TIMEOUT', () => {
      process.env.THEO_DEPLOY_TIMEOUT = '90000';
      const constants = loadConstants();
      expect(constants.DEPLOY_TIMEOUT_MS).toBe(90000);
    });
  });

  describe('envInt edge cases (via DEPLOY_TIMEOUT_MS)', () => {
    it('should return default for empty env var', () => {
      delete process.env.LOOPSCALE_DEPLOY_TIMEOUT;
      const constants = loadConstants();
      // Sprint 8 plan qa-sprint8-cleanup-2026-06-25 T3.1 (closes
      // theo-cloud#38): bumped default 10min → 30min so canonical builds
      // (theokit-example took 615s) don't false-report DEPLOY_TIMEOUT.
      expect(constants.DEPLOY_TIMEOUT_MS).toBe(30 * 60 * 1000);
    });

    it('Sprint 8 T3.1 #38 — default MUST cover canonical 615s build', () => {
      delete process.env.LOOPSCALE_DEPLOY_TIMEOUT;
      const constants = loadConstants();
      // Red Team #38 evidence: build took 615s; default 600s caused
      // false DEPLOY_TIMEOUT. Sprint 8 default MUST cover that case
      // with margin for cold-start cosign + ArgoCD sync.
      expect(constants.DEPLOY_TIMEOUT_MS).toBeGreaterThanOrEqual(615 * 1000);
    });

    it('should parse valid integer override', () => {
      process.env.LOOPSCALE_DEPLOY_TIMEOUT = '120000';
      const constants = loadConstants();
      expect(constants.DEPLOY_TIMEOUT_MS).toBe(120000);
    });
  });

  describe('getDashboardUrl (T2.1 of plan 2026-06-11-code-review-remediation)', () => {
    it('should default to the LoopScale production dashboard', () => {
      const constants = loadConstants();
      expect(constants.getDashboardUrl()).toBe('https://app.getloopscale.com');
    });

    it('should return LOOPSCALE_DASHBOARD_URL override when set', () => {
      process.env.LOOPSCALE_DASHBOARD_URL = 'https://my-dashboard.example.com';
      const constants = loadConstants();
      expect(constants.getDashboardUrl()).toBe('https://my-dashboard.example.com');
    });

    it('should still accept the legacy THEO_DASHBOARD_URL', () => {
      process.env.THEO_DASHBOARD_URL = 'https://legacy-dashboard.example.com';
      const constants = loadConstants();
      expect(constants.getDashboardUrl()).toBe('https://legacy-dashboard.example.com');
    });

    it('should accept http:// URLs (local dev override)', () => {
      process.env.LOOPSCALE_DASHBOARD_URL = 'http://localhost:5173';
      const constants = loadConstants();
      expect(constants.getDashboardUrl()).toBe('http://localhost:5173');
    });

    it('should throw when override is missing protocol', () => {
      process.env.LOOPSCALE_DASHBOARD_URL = 'app-dev.example.com';
      const constants = loadConstants();
      expect(() => constants.getDashboardUrl()).toThrow(/must start with http/);
    });
  });
});
