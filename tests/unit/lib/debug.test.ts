// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { debugError } from '../../../src/lib/debug';

describe('debugError', () => {
  let writeSpy: jest.SpyInstance;
  const original = process.env.LOOPSCALE_DEBUG;

  beforeEach(() => {
    writeSpy = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    if (original === undefined) {
      delete process.env.LOOPSCALE_DEBUG;
    } else {
      process.env.LOOPSCALE_DEBUG = original;
    }
  });

  it('is silent when LOOPSCALE_DEBUG is unset', () => {
    delete process.env.LOOPSCALE_DEBUG;
    debugError('scope', new Error('boom'));
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('ignores THEO_DEBUG', () => {
    delete process.env.LOOPSCALE_DEBUG;
    process.env.THEO_DEBUG = '1';
    try {
      debugError('scope', new Error('boom'));
    } finally {
      delete process.env.THEO_DEBUG;
    }
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('writes the scope and error message to stderr when LOOPSCALE_DEBUG is set', () => {
    process.env.LOOPSCALE_DEBUG = '1';
    debugError('auth:login', new Error('connection refused'));
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('auth:login');
    expect(output).toContain('connection refused');
  });

  it('surfaces the underlying cause when present', () => {
    process.env.LOOPSCALE_DEBUG = '1';
    const err = new Error('refresh failed', { cause: new Error('ECONNRESET') });
    debugError('auth:refresh', err);
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('ECONNRESET');
  });

  it('handles non-Error values', () => {
    process.env.LOOPSCALE_DEBUG = '1';
    debugError('scope', 'plain string failure');
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('plain string failure');
  });
});
