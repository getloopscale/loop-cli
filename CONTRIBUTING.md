# Contributing to LoopScale CLI (`@getloopscale/cli`)

Notes for human contributors and downstream maintainers. The full cycle-based
engineering contract lives in [`CLAUDE.md`](./CLAUDE.md). This file documents
only what a contributor needs hands-on.

## Setup

```bash
git clone https://github.com/getloopscale/cli.git
cd cli
npm ci          # Node >= 20
npm run build   # tsc
npm test        # jest (unit + integration + contract)
npm run lint    # eslint
```

## The one rule that matters: the dependency direction

The CLI is a **thin HTTP client** over the engine's `/api/v1`. It shares
**zero** Go/engine code — the only coupling is the HTTP/OpenAPI contract.

- **Never** add a `theo-*` package to `package.json`. Production dependencies
  are `commander` + HTTP/telemetry libraries only. A reviewer will reject any
  PR that introduces an engine dependency.
- The engine OpenAPI is vendored at `tests/contract/engine.yaml` (a snapshot).
  `tests/contract/engine-contract.test.ts` asserts every `/api/v1` path the CLI
  calls exists in that snapshot (consumer-driven contract). If you call a new
  endpoint, refresh the snapshot and the test will keep both sides honest.

## Permanent contracts (need a major version bump to change)

- **Exit codes:** `0` success · `1` usage · `2` build · `3` deploy · `4` auth ·
  `5` partial. (`130`/`143` only in signal handlers.) See `src/lib/exit-codes.ts`.
- **`--json` output** — field names are a stability contract.
- **No internal terms in user-facing output** — say `deploy`/`service`/`build`,
  never the internal infrastructure names.

## Tests first

Every behavior change starts with a failing test (TDD). Bug fixes start with a
regression test that fails before the fix. The suite must stay green
(`npm test`) and `npm run lint` / `npx tsc --noEmit` must be clean before a PR.

## Branching

Work lands on `develop`. `main` is release-only and receives merges via a
release PR (semver tag cut from `develop`). Never commit directly to `main`.

Issues, PRs, and feedback are all welcome.
