// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

/**
 * Opt-in diagnostic logging gated by the THEO_DEBUG env var.
 *
 * Several boundary helpers (auth device flow, token refresh) intentionally
 * collapse network/parse failures into a null/typed result so the caller can
 * present a clean user-facing message. That collapse used to discard the
 * underlying cause entirely, making `theo login` failures impossible to
 * diagnose. debugError preserves the diagnostic signal WITHOUT polluting
 * stdout: it writes to stderr only when THEO_DEBUG is set, so `--json`
 * consumers (who never set THEO_DEBUG) are unaffected.
 */
export function debugError(scope: string, err: unknown): void {
  if (!process.env.THEO_DEBUG) {
    return;
  }
  const detail =
    err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[theo:debug] ${scope}: ${detail}\n`);

  if (err instanceof Error && err.cause !== undefined) {
    process.stderr.write(
      `[theo:debug] ${scope}: caused by: ${String(err.cause)}\n`,
    );
  }
}
