// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

import { readEnv } from '../config/env';

/**
 * Opt-in diagnostic logging gated by the LOOPSCALE_DEBUG env var
 * (the deprecated THEO_DEBUG is still read).
 *
 * Several boundary helpers (auth device flow, token refresh) intentionally
 * collapse network/parse failures into a null/typed result so the caller can
 * present a clean user-facing message. That collapse used to discard the
 * underlying cause entirely, making `loopscale login` failures impossible to
 * diagnose. debugError preserves the diagnostic signal WITHOUT polluting
 * stdout: it writes to stderr only when LOOPSCALE_DEBUG is set, so `--json`
 * consumers (who never set LOOPSCALE_DEBUG) are unaffected.
 */
export function debugError(scope: string, err: unknown): void {
  if (!readEnv('LOOPSCALE_DEBUG', 'THEO_DEBUG')) {
    return;
  }
  const detail =
    err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[loopscale:debug] ${scope}: ${detail}\n`);

  if (err instanceof Error && err.cause !== undefined) {
    process.stderr.write(
      `[loopscale:debug] ${scope}: caused by: ${String(err.cause)}\n`,
    );
  }
}
