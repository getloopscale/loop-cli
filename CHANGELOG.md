# Changelog

All notable changes to `@usetheo/cli` are documented here.
Format: Keep a Changelog + Semantic Versioning.

## [Unreleased]

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
