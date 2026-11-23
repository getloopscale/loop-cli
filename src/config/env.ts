// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

/**
 * Environment variable lookup with a deprecation path for the names the CLI
 * used before the LoopScale rename (`THEO_*`).
 *
 * The current name always wins. A legacy name is still honoured so existing
 * CI pipelines and shells keep working, but the first read of each legacy
 * name prints a one-line notice on stderr (never stdout, so `--json` output
 * stays parseable).
 */

const warnedLegacyNames = new Set<string>();

/**
 * Returns the first non-empty value among `name` and then `legacyNames`, in
 * order. Empty strings count as unset, matching the `||` chains this replaced.
 */
export function readEnv(name: string, ...legacyNames: string[]): string | undefined {
  const current = process.env[name];
  if (current) {
    return current;
  }
  for (const legacyName of legacyNames) {
    const legacy = process.env[legacyName];
    if (legacy) {
      warnLegacyOnce(legacyName, name);
      return legacy;
    }
  }
  return undefined;
}

function warnLegacyOnce(legacyName: string, name: string): void {
  if (warnedLegacyNames.has(legacyName)) {
    return;
  }
  warnedLegacyNames.add(legacyName);
  process.stderr.write(`Warning: ${legacyName} is deprecated; use ${name} instead.\n`);
}

/** Test hook: forget which deprecation notices were already printed. */
export function resetLegacyEnvWarnings(): void {
  warnedLegacyNames.clear();
}
