// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { ApiError } from '../../src/api/client';

describe('Plan Limit (402) Handling', () => {
  it('should create ApiError with exit code 3 for 402', () => {
    const error = ApiError.fromHttpStatus(
      402,
      'Plan limit reached: Starter allows 2 projects (current: 2). Upgrade your plan to continue.',
      'PLAN_LIMIT_EXCEEDED'
    );

    expect(error.exitCode).toBe(3);
    expect(error.statusCode).toBe(402);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(error.message).toContain('Plan limit');
    expect(error.message).toContain('Upgrade');
  });

  // The refusal has to say where the plan is changed: a person at a terminal has no
  // "Upgrade plan" button to press.
  describe('where to upgrade', () => {
    const previous = process.env.LOOPSCALE_DASHBOARD_URL;
    afterEach(() => {
      if (previous === undefined) delete process.env.LOOPSCALE_DASHBOARD_URL;
      else process.env.LOOPSCALE_DASHBOARD_URL = previous;
    });

    it('names the billing page of the dashboard after the server message', () => {
      process.env.LOOPSCALE_DASHBOARD_URL = 'https://app.staging.getloopscale.com';
      const error = ApiError.fromHttpStatus(
        402,
        'Plan limit reached: Starter allows 50 builds per month (current: 50). Upgrade your plan to continue.',
        'PLAN_LIMIT_EXCEEDED',
        '/billing',
      );

      expect(error.message).toBe(
        'Plan limit reached: Starter allows 50 builds per month (current: 50). Upgrade your plan to continue. ' +
          'See https://app.staging.getloopscale.com/billing to change your plan.',
      );
    });

    it('falls back to the billing page when the server names no upgrade URL', () => {
      process.env.LOOPSCALE_DASHBOARD_URL = 'https://app.staging.getloopscale.com';
      const error = ApiError.fromHttpStatus(402);

      expect(error.message).toBe(
        'Plan limit reached. Upgrade your plan to continue. See https://app.staging.getloopscale.com/billing to change your plan.',
      );
    });

    it('keeps an absolute upgrade URL as the server sent it', () => {
      const error = ApiError.fromHttpStatus(402, 'Cost cap reached.', 'COST_CAP_EXCEEDED', 'https://getloopscale.com/pricing');

      expect(error.message).toBe('Cost cap reached. See https://getloopscale.com/pricing to change your plan.');
    });

    it('ignores an upgrade URL that is neither a path nor http(s)', () => {
      process.env.LOOPSCALE_DASHBOARD_URL = 'https://app.staging.getloopscale.com';
      const error = ApiError.fromHttpStatus(402, 'Plan limit reached.', 'PLAN_LIMIT_EXCEEDED', 'javascript:alert(1)');

      expect(error.message).toBe('Plan limit reached. See https://app.staging.getloopscale.com/billing to change your plan.');
    });
  });

  it('should use default message when server message is null', () => {
    const error = ApiError.fromHttpStatus(402);

    expect(error.exitCode).toBe(3);
    expect(error.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(error.message).toContain('Plan limit');
  });

  it('should not contain internal terms in default 402 message', () => {
    const error = ApiError.fromHttpStatus(402);
    const internalTerms = ['Stripe', 'stripe', 'subscription', 'invoice', 'webhook', 'tenant_id'];

    for (const term of internalTerms) {
      expect(error.message).not.toContain(term);
    }
  });

  it('should serialize correctly for --json output', () => {
    const error = ApiError.fromHttpStatus(
      402,
      'Plan limit reached: Starter allows 100 builds per month.',
      'PLAN_LIMIT_EXCEEDED'
    );

    const json = {
      error: error.message,
      exit_code: error.exitCode,
      code: error.code,
    };

    expect(json.exit_code).toBe(3);
    expect(json.code).toBe('PLAN_LIMIT_EXCEEDED');
    expect(json.error).toContain('builds');
  });
});
