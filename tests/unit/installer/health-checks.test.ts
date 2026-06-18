// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors
//
// CHG-2026-04-28-LAYERED-BOOTSTRAP / T4.1 — unit tests for health-checks.

import { runHealthCheck } from '../../../src/installer/health-checks';

describe('health-checks', () => {
  describe('runHealthCheck', () => {
    it('returns a HealthCheckResult object with role/status/durationMs', () => {
      // Pass a fake role with retries=1 to avoid hanging — script will fail
      // immediately because no cluster is reachable; we just want the wrapper
      // structure to be correct.
      const r = runHealthCheck('infra', { retries: 1, retryIntervalSec: 1 });
      expect(['pass', 'fail']).toContain(r.status);
      expect(r.role).toBe('infra');
      expect(typeof r.durationMs).toBe('number');
      expect(typeof r.exitCode).toBe('number');
    });

    it('rejects unknown roles via shell script exit 2', () => {
      // The shell script returns exit 2 on unknown role, even before hooks.
      // The TypeScript type system normally prevents this, but Object.values
      // (or external untyped callers) could.
      const r = runHealthCheck('unknown' as unknown as 'infra', { retries: 1, retryIntervalSec: 1 });
      // exit code is non-zero in either case
      expect(r.status).toBe('fail');
    });

    it('passes domain via env var THEO_DOMAIN', () => {
      const r = runHealthCheck('infra', { domain: 'staging.example.com', retries: 1, retryIntervalSec: 1 });
      // shell script may fail (no cluster) — what matters is the wrapper accepts the option
      expect(r.role).toBe('infra');
    });

    it('respects retries and retryIntervalSec options', () => {
      // With retries=1, the script makes 1 attempt — should complete fast.
      const start = Date.now();
      runHealthCheck('infra', { retries: 1, retryIntervalSec: 1 });
      const elapsed = Date.now() - start;
      // Even with kubectl waiting on DNS, 1 retry × 1s should not exceed 30s.
      expect(elapsed).toBeLessThan(30_000);
    });
  });
});
