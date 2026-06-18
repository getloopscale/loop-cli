# Changelog

All notable changes to `@usetheo/cli` are documented here.
Format: Keep a Changelog + Semantic Versioning.

## [Unreleased]

### Fixed
- Install instructions in the README now reference the published `@usetheo/cli`
  package instead of the unavailable `@theo/cli` scope, so `npm install` works
  from a clean copy of the docs (code-review HIGH).
- `theo deploy` no longer hangs when the server sends a malformed terminal
  event: a throw in the SSE event handler is caught and surfaced as a deploy
  failure (exit 3) instead of an unhandled rejection (code-review MED).
- `theo login` and token refresh failures are now diagnosable with
  `THEO_DEBUG=1`: the underlying network/parse cause is written to stderr
  instead of being silently swallowed (code-review MED).
- Build-status polling fallback now gives up after the configured retry count
  with a clear "check theo status" message, instead of polling forever on a
  persistently unreachable endpoint (code-review MED).

### Changed
- `theo platform status` now invokes `kubectl` without a shell, removing a
  latent command-injection surface and the dependency on `grep`/`wc`
  (code-review LOW).
- Internal: refactored `platformInstall` into focused per-step helpers
  (validate / preflight / infrastructure / restore / bootstrap / wire /
  validate) — no behavior change (code-review MED, SRP).
- `SSEClient.close()` is now idempotent — `onClose` fires exactly once even
  when called from both an internal terminal path and an external `finally`
  (code-review LOW).

### Removed
- Dead exit-code mappers `mapTerminalStateToExitCode` and
  `releaseStateToExitCode` (tested but never called in production; the deploy
  path uses `buildStateToExitCode` directly) (code-review MED).
- Dead `runFullHealthCheck` export (tested but never wired; the installer uses
  `runHealthCheck`) (code-review MED).
- Stale tests for the removed `theo init` command and the deleted
  `src/detection/monorepo` module (these were failing the suite at load time).
- Dangling `docs/architecture/` reference and pre-extraction monorepo source
  path from the README (code-review MED).

### Added
- `Taskfile.yml` — T2.1 of plan canonical-tests-rewrite-v2 v1.0 per ADR-2026-06-17-T3.
  Closes F-001 BLOCKER from the engine audit 2026-06-17-canonical-tests-deep-review.
  Targets: `task build` / `task test` (Jest 1,260 cases) / `task test:smoke` (T2.3:
  build + version + help in < 30s) / `task test:contract` (stub for Phase 2 Pact-go
  consumer-side contract) / `task lint` / `task ci`. Aligns with engine task surface.
- Extracted from the `theo` monorepo (`theo/cli/`) into this standalone repository
  via `git filter-repo` (history preserved) — M2 of the decomposition roadmap.
- Consumer-driven contract test (`tests/contract/engine-contract.test.ts`): asserts
  every `/api/v1` path the CLI calls exists in the vendored engine OpenAPI snapshot.
- Own CI (`.github/workflows/ci.yml`) + npm publish on tag (`publish.yml`).

### Changed
- Renamed the npm package from `@theo/cli` to `@usetheo/cli` (the `@theo` scope is
  unavailable on the public registry; `@usetheo` matches the `usetheodev` org).
- Expanded `CLAUDE.md` into a self-governing repo contract (build/test, the cli↔engine
  seam, exit-code + `--json` invariants, and the dependency-direction invariant — upheld
  by HTTP-only design + the vendored OpenAPI contract test; a TS import-boundary check is
  a noted follow-up) — M5 of the decomposition roadmap.
