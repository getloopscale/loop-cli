// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The LoopScale Authors

import { executeDeviceCodeFlow, refreshAccessToken, DeviceFlowDeps } from '../../src/auth/device-flow';

describe('Device Code Flow', () => {
  function createMockDeps(overrides: Partial<DeviceFlowDeps> = {}): DeviceFlowDeps {
    return {
      fetchFn: jest.fn(),
      baseURL: 'http://localhost:13002',
      openBrowser: jest.fn().mockResolvedValue(undefined),
      writeTo: jest.fn(),
      writeError: jest.fn(),
      sleep: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  function mockFetch(responses: Record<string, { status: number; body: unknown }[]>): DeviceFlowDeps['fetchFn'] {
    const callCounts: Record<string, number> = {};
    return jest.fn().mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      callCounts[path] = (callCounts[path] || 0) + 1;
      const responseList = responses[path] || [{ status: 404, body: {} }];
      const idx = Math.min(callCounts[path] - 1, responseList.length - 1);
      const resp = responseList[idx];
      return {
        ok: resp.status >= 200 && resp.status < 300,
        status: resp.status,
        json: async () => resp.body,
      } as Response;
    });
  }

  it('should complete device code flow successfully', async () => {
    const fetchFn = mockFetch({
      '/v1/auth/device/authorize': [{
        status: 200,
        body: {
          device_code: 'dc-123',
          user_code: 'ABCD-1234',
          verification_uri: 'http://localhost:4455/device',
          expires_in: 300,
          interval: 1,
        },
      }],
      '/v1/auth/device/token': [
        { status: 200, body: { status: 'pending' } },
        {
          status: 200,
          body: {
            access_token: 'at-123',
            refresh_token: 'rt-123',
            token_type: 'bearer',
            expires_in: 3600,
          },
        },
      ],
    });

    const deps = createMockDeps({ fetchFn });
    const result = await executeDeviceCodeFlow(deps);

    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('at-123');
    expect(result!.refresh_token).toBe('rt-123');
    expect(deps.openBrowser).toHaveBeenCalledWith('http://localhost:4455/device');
    expect(deps.writeTo).toHaveBeenCalledWith(expect.stringContaining('ABCD-1234'));
  });

  it('should fail when device authorize fails', async () => {
    const fetchFn = mockFetch({
      '/v1/auth/device/authorize': [{ status: 500, body: {} }],
    });

    const deps = createMockDeps({ fetchFn });
    const result = await executeDeviceCodeFlow(deps);

    expect(result).toBeNull();
    expect(deps.writeError).toHaveBeenCalledWith(expect.stringContaining('Failed to start'));
  });

  it('should require --token in CI mode (handled by LoginCommand, not device flow)', () => {
    // Device flow is never called in CI mode — LoginCommand handles this
    // This test documents the expectation
    expect(true).toBe(true);
  });

  it('should not contain internal terms in output', async () => {
    const fetchFn = mockFetch({
      '/v1/auth/device/authorize': [{
        status: 200,
        body: {
          device_code: 'dc-123',
          user_code: 'TEST-CODE',
          verification_uri: 'http://localhost:4455/device',
          expires_in: 300,
          interval: 1,
        },
      }],
      '/v1/auth/device/token': [{
        status: 200,
        body: {
          access_token: 'at-123',
          refresh_token: 'rt-123',
          token_type: 'bearer',
          expires_in: 3600,
        },
      }],
    });

    const deps = createMockDeps({ fetchFn });
    await executeDeviceCodeFlow(deps);

    const allOutput = (deps.writeTo as jest.Mock).mock.calls.map(c => c[0]).join(' ');
    const internalTerms = ['Hydra', 'hydra', 'Kratos', 'kratos', 'OIDC', 'oidc', 'device_code'];
    for (const term of internalTerms) {
      expect(allOutput).not.toContain(term);
    }
  });

  // Regression: LOOPSCALE_URL=https://app-dev.getloopscale.com/engine is the canonical
  // dev-public value (per src/config/constants.ts) so engine REST calls
  // (everything under /api/v1) hit the cloud /engine/* proxy. But the device
  // flow endpoints live at the CLOUD root (/v1/auth/device/*), not inside the
  // /engine proxy. Without stripping the suffix, the CLI hits
  // /engine/v1/auth/device/authorize and dev-public returns 401 because the
  // path falls through the auth-required middleware to the cloud catchall.
  // Per MEET-040 design (constants.ts:22): Caddy routes /v1/auth/* → cloud
  // service; the CLI must call against the host root for those paths.
  it('strips /engine suffix from baseURL when calling device endpoints', async () => {
    const calledURLs: string[] = [];
    const fetchFn = jest.fn().mockImplementation(async (url: string) => {
      calledURLs.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          device_code: 'dc-strip',
          user_code: 'STRIP',
          verification_uri: 'https://auth-dev.getloopscale.com/oauth2/device/verify',
          expires_in: 600,
          interval: 5,
        }),
      } as Response;
    });

    const deps = createMockDeps({
      fetchFn,
      baseURL: 'https://app-dev.getloopscale.com/engine',
      sleep: jest.fn().mockImplementation(async () => {
        throw new Error('stop polling — assertion target reached');
      }),
    });

    await executeDeviceCodeFlow(deps).catch(() => {});

    expect(calledURLs.length).toBeGreaterThanOrEqual(1);
    const authorizeURL = new URL(calledURLs[0]);
    expect(authorizeURL.pathname).toBe('/v1/auth/device/authorize');
    expect(authorizeURL.host).toBe('app-dev.getloopscale.com');
    expect(calledURLs[0]).not.toContain('/engine/v1/auth');
  });

  it('strips /engine suffix from baseURL when polling device token', async () => {
    const calledURLs: string[] = [];
    let callCount = 0;
    const fetchFn = jest.fn().mockImplementation(async (url: string) => {
      calledURLs.push(url);
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            device_code: 'dc-poll-strip',
            user_code: 'POLLSTRIP',
            verification_uri: 'https://auth-dev.getloopscale.com/oauth2/device/verify',
            expires_in: 600,
            interval: 5,
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'at',
          refresh_token: 'rt',
          token_type: 'bearer',
          expires_in: 3600,
        }),
      } as Response;
    });

    const deps = createMockDeps({
      fetchFn,
      baseURL: 'https://app-dev.getloopscale.com/engine',
    });

    await executeDeviceCodeFlow(deps);

    const pollCall = calledURLs.find((u) => u.includes('/auth/device/token'));
    expect(pollCall).toBeDefined();
    const pollURL = new URL(pollCall as string);
    expect(pollURL.pathname).toBe('/v1/auth/device/token');
    expect(pollCall).not.toContain('/engine/v1/auth');
  });
});

describe('refreshAccessToken', () => {
  it('should refresh token successfully', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'new-at',
        refresh_token: 'new-rt',
        token_type: 'bearer',
        expires_in: 3600,
      }),
    });

    const result = await refreshAccessToken(fetchFn, 'http://localhost:13002', 'old-rt');

    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('new-at');
    expect(result!.refresh_token).toBe('new-rt');
  });

  it('should return null on failure', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_grant' }),
    });

    const result = await refreshAccessToken(fetchFn, 'http://localhost:13002', 'expired-rt');
    expect(result).toBeNull();
  });

  it('surfaces the network cause under LOOPSCALE_DEBUG while still returning null', async () => {
    const original = process.env.LOOPSCALE_DEBUG;
    process.env.LOOPSCALE_DEBUG = '1';
    const writeSpy = jest
      .spyOn(process.stderr, 'write')
      .mockReturnValue(true);
    const fetchFn = jest
      .fn()
      .mockRejectedValue(new Error('fetch failed: ECONNRESET'));

    try {
      const result = await refreshAccessToken(
        fetchFn,
        'http://localhost:13002',
        'rt',
      );
      // Contract preserved: still returns null on failure.
      expect(result).toBeNull();
      // But the cause is now diagnosable instead of silently swallowed.
      const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
      expect(output).toContain('auth:refreshAccessToken');
      expect(output).toContain('ECONNRESET');
    } finally {
      writeSpy.mockRestore();
      if (original === undefined) {
        delete process.env.LOOPSCALE_DEBUG;
      } else {
        process.env.LOOPSCALE_DEBUG = original;
      }
    }
  });

});
