# Changelog

All notable changes to `@usetheo/cli` are documented here.
Format: Keep a Changelog + Semantic Versioning.

## [Unreleased]

### Added
- Extracted from the `theo` monorepo (`theo/cli/`) into this standalone repository
  via `git filter-repo` (history preserved) — M2 of the decomposition roadmap.
- Consumer-driven contract test (`tests/contract/engine-contract.test.ts`): asserts
  every `/api/v1` path the CLI calls exists in the vendored engine OpenAPI snapshot.
- Own CI (`.github/workflows/ci.yml`) + npm publish on tag (`publish.yml`).

### Changed
- Renamed the npm package from `@theo/cli` to `@usetheo/cli` (the `@theo` scope is
  unavailable on the public registry; `@usetheo` matches the `usetheodev` org).
