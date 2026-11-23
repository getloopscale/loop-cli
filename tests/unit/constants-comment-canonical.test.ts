// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 The Theo Authors

/**
 * Hermetic regression-lock for the canonical `LOOPSCALE_URL` comment in
 * `src/config/constants.ts` (issue #130 — QA dogfooding 2026-06-21).
 *
 * Symptom (filed by external QA agent 2026-06-21):
 *
 *     Development cluster: set LOOPSCALE_URL=https://api-dev.usetheo.dev
 *                                       ^^^^^^^^^^^^^^^^^^^^^^^^^^
 *     curl: (6) Could not resolve host: api-dev.usetheo.dev
 *
 * Root cause: the source-code comment referenced a stale hostname that
 * never resolved in the canonical dev-public DNS. The canonical engine
 * URL for dev-public is `https://app-dev.usetheo.dev/engine` (the engine
 * REST is proxied under `/engine/*` on the dashboard host).
 *
 * The bug is comment-only — zero runtime impact — but the comment is the
 * first place a new operator reads when setting up `LOOPSCALE_URL`, so the
 * stale literal is a recurring onboarding trap.
 *
 * The audit is encoded as a pure string check so we can prove the guard
 * catches the regression without spawning a subprocess.
 *
 * Cross-references:
 *   - QA report: https://github.com/usetheodev/theo/issues/130
 *   - Plan: .claude/knowledge-base/plans/qa-dogfood-cleanup-2026-06-21-plan.md § T1.2
 *   - ADR: .claude/knowledge-base/plans/qa-dogfood-cleanup-2026-06-21-plan.md § ADR-Q1
 *   - Canonical doc: docs/qa/test-scenarios-canonical.md § 0.2
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const constantsPath = resolve(__dirname, '..', '..', 'src', 'config', 'constants.ts');
const body = readFileSync(constantsPath, 'utf8');

/**
 * Pure audit function — returns failure messages (empty array → guard
 * passes). Extracted so the negative-control test can mutate an
 * in-memory fixture and prove the guard catches the regression.
 */
// Anchored pattern: catches the bug shape `set LOOPSCALE_URL=https://api-dev.usetheo.dev`
// (the operator-facing directive), NOT a history reference like `\`https://api-dev.usetheo.dev\``
// in prose. False-positive elimination per EC-1 / EC-10 of the plan.
const STALE_DIRECTIVE_RE = /set\s+LOOPSCALE_URL\s*=\s*https:\/\/api-dev\.usetheo\.dev/;
const CANONICAL_DIRECTIVE_RE = /set\s+LOOPSCALE_URL\s*=\s*https:\/\/app-dev\.usetheo\.dev\/engine/;

export function auditConstantsCanonicalThemoUrlComment(text: string): string[] {
  const errs: string[] = [];

  if (STALE_DIRECTIVE_RE.test(text)) {
    errs.push(
      "(a) constants.ts contains the stale directive `set LOOPSCALE_URL=https://api-dev.usetheo.dev` — this hostname does NOT resolve in the canonical dev-public DNS. Replace with `set LOOPSCALE_URL=https://app-dev.usetheo.dev/engine` per the QA test-scenarios doc (2026-06-21 LIVE close, #130).",
    );
  }

  if (!CANONICAL_DIRECTIVE_RE.test(text)) {
    errs.push(
      "(b) constants.ts does NOT contain the canonical directive `set LOOPSCALE_URL=https://app-dev.usetheo.dev/engine` — the comment must document the canonical engine URL for dev-public (the engine REST is proxied under `/engine/*` on the dashboard host).",
    );
  }

  return errs;
}

describe('CLI constants.ts canonical LOOPSCALE_URL comment (#130)', () => {
  it('does not reference the stale api-dev.usetheo.dev hostname', () => {
    const errs = auditConstantsCanonicalThemoUrlComment(body);
    if (errs.length > 0) {
      throw new Error('Audit failed:\n' + errs.map((e) => '  - ' + e).join('\n'));
    }
  });

  it('mentions the canonical app-dev.usetheo.dev/engine URL', () => {
    expect(body).toContain('app-dev.usetheo.dev/engine');
  });

  // Negative-control: mutate the in-memory body to revert the canonical
  // directive back to the buggy `set LOOPSCALE_URL=https://api-dev.usetheo.dev`
  // shape, then assert the audit fires. A guard that passes the negative
  // control is theatre.
  it('negative-control: audit catches the regression shape', () => {
    const mutated = body.replace(
      /set LOOPSCALE_URL=https:\/\/app-dev\.usetheo\.dev\/engine/g,
      'set LOOPSCALE_URL=https://api-dev.usetheo.dev',
    );
    if (mutated === body) {
      throw new Error(
        'negative-control setup failed: could not find canonical directive to mutate — the GREEN test is vacuous.',
      );
    }
    const errs = auditConstantsCanonicalThemoUrlComment(mutated);
    expect(errs.length).toBeGreaterThan(0);
  });
});
