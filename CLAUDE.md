# LoopScale CLI

Standalone `@getloopscale/cli`, the CLI-first client for LoopScale (TypeScript + Commander).
Extracted from the `theo` monorepo at M2 of the decomposition (history preserved).

## What it is

A thin HTTP client over the engine API. `loopscale login`, `loopscale deploy`,
`loopscale status`, `loopscale logs`, etc. It shares **zero Go/engine code** — the only
coupling to the engine is the `/api/v1` HTTP/OpenAPI contract.

## Build / test

```bash
npm ci
npm run build       # tsc
npm test            # jest (unit + contract)
npm run lint        # eslint
```

## Seam (the only cross-repo dependency)

- **cli↔engine** — HTTP over `/api/v1`. The engine OpenAPI is vendored at
  `tests/contract/engine.yaml` (a snapshot); `tests/contract/engine-contract.test.ts`
  asserts every `/api/v1` path the CLI calls exists in the snapshot (consumer-driven).
  The engine side mirrors this in `theo/api/internal/contract/cli_consumer_test.go`.
  Run with the rest of the matrix via `cd theo && task quality:contract:cross-repo`
  (see `theo/docs/cross-repo-contract-matrix.md`).

## Invariants

- **Dependency direction:** theo-cli imports nothing from the engine repo (HTTP only).
  Upheld today by the HTTP-only design (production deps are commander + HTTP/telemetry,
  zero `theo-*` packages) + the vendored OpenAPI contract test. The engine's Go
  `theo-ops quality acyclic-graph` gate prevents the *reverse* edge (engine → cli) but
  does NOT scan TypeScript, so it does not mechanically guard cli's own imports. A TS
  import-boundary check (dependency-cruiser / eslint import rule) is a follow-up — until
  it lands, a reviewer must reject any `theo-*` dependency added to `package.json`.
- **Exit codes are a permanent contract:** `0` success, `1` usage, `2` build, `3` deploy,
  `4` auth, `5` partial. No others (130/143 only in signal handlers).
- **`--json` is a stability contract** — field names need a major bump to change.
- **No internal terms in user-facing output** (deploy/team/service/build, never
  ArgoCD/CRD/tenant/etc.).

## Publishing

`@getloopscale/cli`. `publish.yml` publishes on a
`v*` tag once `NPM_TOKEN` is set (owner-gated).

## Provenance

Extracted at M2 (`theo-cloud/.claude/knowledge-base/plans/m2-extract-theo-cli-plan.md`),
history preserved via `git filter-repo`. Part of the decomposition:
`theo-contracts ◄── theo (engine) + theo-cloud + theo-cli`.
