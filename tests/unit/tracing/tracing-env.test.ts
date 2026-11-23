// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { initTracing, shutdownTracing } from '../../../src/tracing';
import { trace } from '@opentelemetry/api';

// Kept apart from tracing.test.ts: once a provider registers globally it
// stays registered for the rest of the file, which would hide this case.
describe('tracing env', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    await shutdownTracing();
    process.env = { ...originalEnv };
  });

  it('ignores THEO_TRACING_ENABLED', () => {
    delete process.env.LOOPSCALE_TRACING_ENABLED;
    process.env.THEO_TRACING_ENABLED = 'true';

    initTracing();

    const span = trace.getTracer('test-check').startSpan('verify-no-provider');
    expect(span.spanContext().traceId).toBe('00000000000000000000000000000000');
    span.end();
  });
});
