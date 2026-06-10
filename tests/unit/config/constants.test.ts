// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

describe('CLI config/constants', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Clear all URL env vars for clean test state
    delete process.env.THEO_URL;
    delete process.env.THEO_API_URL;
    delete process.env.THEO_CLOUD_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function loadConstants() {
    // Re-import to pick up changed env vars
    return jest.requireActual('../../../src/config/constants');
  }

  describe('envInt (via API_REQUEST_TIMEOUT_MS)', () => {
    it('should return default when env var is missing', () => {
      delete process.env.THEO_API_TIMEOUT;
      const constants = loadConstants();
      expect(constants.API_REQUEST_TIMEOUT_MS).toBe(30000);
    });

    it('should return default when env var is NaN', () => {
      process.env.THEO_API_TIMEOUT = 'not-a-number';
      const constants = loadConstants();
      expect(constants.API_REQUEST_TIMEOUT_MS).toBe(30000);
    });

    it('should return parsed value for valid env var', () => {
      process.env.THEO_API_TIMEOUT = '5000';
      const constants = loadConstants();
      expect(constants.API_REQUEST_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('getDefaultApiUrl (MEET-040: unified THEO_URL)', () => {
    it('should return THEO_URL when set', () => {
      process.env.THEO_URL = 'https://api.usetheo.dev';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('https://api.usetheo.dev');
    });

    it('should return THEO_API_URL as legacy fallback', () => {
      process.env.THEO_API_URL = 'https://api.usetheo.dev';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('https://api.usetheo.dev');
    });

    it('should prefer THEO_URL over THEO_API_URL', () => {
      process.env.THEO_URL = 'https://new.usetheo.dev';
      process.env.THEO_API_URL = 'https://old.usetheo.dev';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('https://new.usetheo.dev');
    });

    it('should return fallback when no URL env vars set', () => {
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('http://localhost:8080');
    });

    it('should return fallback when THEO_URL is empty string', () => {
      process.env.THEO_URL = '';
      const constants = loadConstants();
      expect(constants.getDefaultApiUrl()).toBe('http://localhost:8080');
    });
  });

  describe('getCloudUrl (MEET-040: defaults to same as API URL)', () => {
    it('should return THEO_CLOUD_URL when set (legacy)', () => {
      process.env.THEO_CLOUD_URL = 'https://cloud.usetheo.dev';
      const constants = loadConstants();
      expect(constants.getCloudUrl()).toBe('https://cloud.usetheo.dev');
    });

    it('should return same as getDefaultApiUrl when THEO_CLOUD_URL not set', () => {
      process.env.THEO_URL = 'https://api.usetheo.dev';
      const constants = loadConstants();
      expect(constants.getCloudUrl()).toBe('https://api.usetheo.dev');
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

  describe('envInt edge cases (via DEPLOY_TIMEOUT_MS)', () => {
    it('should return default for empty env var', () => {
      delete process.env.THEO_DEPLOY_TIMEOUT;
      const constants = loadConstants();
      expect(constants.DEPLOY_TIMEOUT_MS).toBe(10 * 60 * 1000);
    });

    it('should parse valid integer override', () => {
      process.env.THEO_DEPLOY_TIMEOUT = '120000';
      const constants = loadConstants();
      expect(constants.DEPLOY_TIMEOUT_MS).toBe(120000);
    });
  });
});
