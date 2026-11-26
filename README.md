<div align="center">

# LoopScale CLI

**From monorepo to running service in one command.**

The CLI-first deploy client for **LoopScale** — authenticate, build, upload, and
stream a deploy from your terminal or CI. A thin HTTP client over the engine's
REST API: scriptable exit codes, stable `--json` output, zero-config deploys.
Apache-2.0.

[![License](https://img.shields.io/badge/license-Apache--2.0-7C3AED?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/tests-1%2C300%2B%20passing-brightgreen?style=flat-square)](#testing)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Commander](https://img.shields.io/badge/Commander.js-12-555?style=flat-square)](https://github.com/tj/commander.js)
[![npm](https://img.shields.io/badge/npm-%40getloopscale%2Fcli-CB3837?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@getloopscale/cli)
[![Status](https://img.shields.io/badge/status-pre--release-orange?style=flat-square)](#status)

[Quickstart](#quickstart) · [Why](#why-loopscale-cli) · [Commands](#commands) · [CI/CD](#cicd) · [Contracts](#contracts) · [Architecture](#architecture) · [Comparison](#comparison) · [Roadmap](#roadmap) · [Contributing](#contributing)

**Part of [LoopScale](https://getloopscale.com).**

</div>

---

## Why LoopScale CLI?

Shipping an app shouldn't mean hand-rolling a tarball, a multipart upload, an
auth refresh dance, an SSE log stream, and a pile of exit-code handling in every
CI script. Managed PaaS CLIs give you that ergonomics — but they bind you to
their control plane.

**LoopScale CLI gives you the deploy ergonomics of a managed PaaS over a control
plane you can self-host.** Point it at a LoopScale API, run `loopscale`, and your
monorepo's apps build and deploy in one step — with the build/deploy events
streaming back to your terminal and a clean exit code your CI can branch on.

```bash
loopscale login            # device-flow OAuth, once per machine
loopscale                  # zero-config: builds + uploads + streams the deploy
```

It shares **zero** engine code: the only coupling is the `/api/v1` HTTP
contract, pinned by a consumer-driven contract test. That keeps the CLI small,
fast to install, and decoupled from the platform's internals.

## Features

- **Zero-config deploy** — `loopscale` with no subcommand routes to `loopscale deploy`; a
  missing `.loopscale/services.json` triggers a `loopzero build` automatically.
- **Monorepo-native** — deploys multiple apps from one repo in a single command,
  with per-app runtime, scaling, secrets, and domains.
- **Scriptable by contract** — a permanent exit-code table (`0` success · `1`
  usage · `2` build · `3` deploy · `4` auth · `5` partial) and a stable `--json`
  output on every command, so CI can branch on results without scraping prose.
- **Live build/deploy stream** — Server-Sent Events with automatic reconnection,
  `Last-Event-ID` replay, dedup, and a polling fallback when the journal expires.
- **Resilient HTTP** — retry with exponential backoff + jitter on `429/502/503/504`
  and network errors; `MAINTENANCE_MODE` surfaces immediately instead of silently
  retrying.
- **Device-flow auth (RFC 8628)** — browser login for humans, `LOOPSCALE_TOKEN` for
  CI; tokens persisted with `0o600` perms and refreshed transparently on `401`.
- **CI/prebuilt mode** — `--prebuilt` / `--skip-build` for pipelines that split
  build and deploy across stages (Vercel-style).
- **Progressive delivery aware** — renders canary rollout progress and surfaces
  aborts with the right exit code.
- **OpenTelemetry tracing** — opt-in via `LOOPSCALE_TRACING_ENABLED`; W3C trace
  context is propagated into the engine so a CLI command and its API spans share
  one trace.
- **Pure TypeScript, HTTP-only** — production deps are Commander + HTTP/telemetry
  libraries; no engine packages, no native add-ons.

## Quickstart

LoopScale CLI runs on **Node ≥ 20**. It is **pre-release**; until it is published to
npm you can run it from source.

```bash
# From source
git clone https://github.com/getloopscale/cli.git
cd cli
npm ci
npm run build
node bin/loopscale --help
```

```bash
# Once published (pinned in your project — recommended)
npm install --save-dev @getloopscale/cli

# Or globally
npm install -g @getloopscale/cli
```

You also need [LoopZero](https://github.com/getloopscale/loopzero) so `loopscale deploy` can
build the `.loopscale/services.json` artifact automatically. In typical LoopZero
projects it is already a dev dependency (`npm install loopzero`).

Then drive it end to end:

```bash
loopscale login                    # authenticate once per machine
loopscale                          # zero-config deploy — build + upload + stream
loopscale status                   # current release state
loopscale logs --build <id>        # tail build/runtime logs
loopscale rollback                 # restore the previous release
```

The legacy two-step flow still works:

```bash
loopzero build --target loopscale-console   # explicit build
loopscale deploy --prebuilt              # upload only — skip auto-build
```

## Configuration

`loopscale login` stores the login in `~/.loopscale/config.json`, or in
`$XDG_CONFIG_HOME/loopscale/config.json` when `XDG_CONFIG_HOME` is set.
`loopscale logout` deletes that file.

| Variable | Effect | Default |
|---|---|---|
| `LOOPSCALE_TOKEN` | Token used instead of the stored login (CI) | unset |
| `LOOPSCALE_URL` | API base URL | `http://localhost:8080` |
| `LOOPSCALE_CLOUD_URL` | Auth service base URL | value of `LOOPSCALE_URL` |
| `LOOPSCALE_DASHBOARD_URL` | Dashboard URL shown in sign-in hints | `https://app.getloopscale.com` |
| `LOOPSCALE_API_TIMEOUT` | API request timeout (ms) | `30000` |
| `LOOPSCALE_UPLOAD_TIMEOUT` | Source upload timeout (ms) | `120000` |
| `LOOPSCALE_DEPLOY_TIMEOUT` | Total deploy timeout (ms) | `1800000` |
| `LOOPSCALE_DEBUG` | Print diagnostic errors on stderr | unset |
| `LOOPSCALE_TRACING_ENABLED` | Export OpenTelemetry traces (`true` or `1`) | unset |
| `LOOPSCALE_OTEL_ENDPOINT` | OTLP/HTTP traces endpoint | `http://localhost:4318/v1/traces` |
| `LOOPSCALE_ENV` | `deployment.environment` trace attribute | `development` |

The project descriptor is `loopscale.yaml`. A project that still has `loopzero.yaml` keeps
working: the CLI reads the first of the two it finds, in that order, and a push deploy does the
same. The LoopZero framework's manifest is read from `.loopzero/services.json`, and files listed
in `.loopscaleignore` are left out of the upload.

## Commands

24 end-user commands. Every command accepts `--json` for machine-readable
output. Run `loopscale <command> --help` for the full flag set. (Platform
installation and operator tooling are intentionally **not** part of the
end-user CLI.)

<details open>
<summary><b>Auth</b> — identity & credentials</summary>

| Command | Description |
|---|---|
| `loopscale login` | Authenticate with your account (device-flow OAuth, or `--token` for CI) |
| `loopscale logout` | Remove stored credentials |
| `loopscale whoami` | Show the current authenticated user |
| `loopscale auth` | Authentication maintenance (refresh tokens) |

</details>

<details open>
<summary><b>Deploy & releases</b> — the core flow</summary>

| Command | Description |
|---|---|
| `loopscale deploy` | Build + upload + stream the deploy (`loopscale` with no subcommand routes here) |
| `loopscale status` | Show environment status for the current project |
| `loopscale logs` | Show build / runtime logs (tail or fetch) |
| `loopscale rollback` | Roll back to a previous release |
| `loopscale promote` | Promote a release from one environment to another |
| `loopscale cancel <build-id>` | Cancel a running or queued build |
| `loopscale validate` | Validate `loopscale.yaml` configuration |

</details>

<details>
<summary><b>Resources</b> — projects, teams, environments, domains, builds, secrets</summary>

| Command | Description |
|---|---|
| `loopscale project` | Manage projects |
| `loopscale team` | Manage team members |
| `loopscale env` | Manage environments |
| `loopscale domain` | Manage custom domains |
| `loopscale build` | Manage builds |
| `loopscale secret` | Manage application secrets |
| `loopscale scale` | Scale a service (fixed replicas or autoscaling) |
| `loopscale preview` | Manage preview environments |
| `loopscale storage` | Store files (`upload`/`download`/`list`/`share`) + `loopscale storage sync` a folder ↔ local dir |

</details>

<details>
<summary><b>Claude Code integration</b> — keep a shared <code>.claude/</code> in sync</summary>

`loopscale storage sync <dir> --prefix <p>` bidirectionally syncs a stored folder to a
local directory (conflict-safe, `--dry-run`, `--exclude` globs). Wire it to Claude
Code's `SessionStart`/`SessionEnd` hooks to pull your shared `.claude/` on session
start and push edits on end — see
[`integrations/claude-code/`](https://github.com/getloopscale/cli/tree/develop/integrations/claude-code)
for the example `settings.json` and the safety notes (executable config is fenced
out of the sync by default).

</details>

<details>
<summary><b>Git integration</b> — auto-deploy on push</summary>

| Command | Description |
|---|---|
| `loopscale connect` | Connect a GitHub repository for auto-deploy on push |
| `loopscale disconnect` | Disconnect the repository (stop auto-deploy) |

</details>

<details>
<summary><b>Account & operations</b></summary>

| Command | Description |
|---|---|
| `loopscale billing` | View plan and usage, or open the billing portal |
| `loopscale audit` | View the audit log (requires `admin` or `owner`) |
| `loopscale doctor` | Run a health check on the CLI environment |

</details>

## CI/CD

CI pipelines that split build and deploy across stages use `--prebuilt` (an
alias of `--skip-build`) and authenticate with `LOOPSCALE_TOKEN`:

```yaml
jobs:
  build:
    steps:
      - run: npm ci
      - run: npx loopzero build --target loopscale-console
      - uses: actions/upload-artifact@v4
        with: { path: .loopscale/services.json }
  deploy:
    needs: build
    steps:
      - run: npm ci
      - uses: actions/download-artifact@v4
      - run: npx @getloopscale/cli deploy --prebuilt
        env:
          LOOPSCALE_TOKEN: ${{ secrets.LOOPSCALE_TOKEN }}
```

Tune the `loopzero build` subprocess with `LOOPZERO_BUILD_TIMEOUT_MS` (default
`600000`) and `LOOPZERO_BIN` (override the auto-resolved binary). For a custom
`distDir`, point at the artifact explicitly: `loopscale deploy --services-json ./out/services.json`.

## Contracts

These are **stable contracts** — changing them requires a major version bump.

**Exit codes** (`src/lib/exit-codes.ts`):

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Usage error (bad arguments, missing flags) |
| `2` | Build failure |
| `3` | Deploy failure |
| `4` | Auth error (token expired / missing / invalid) |
| `5` | Partial failure (multi-app: some apps OK, some failed) |

`130` / `143` appear only from `SIGINT` / `SIGTERM` signal handlers.

**`--json`** — every command emits a machine-readable object whose field names
are part of the public contract. Scripts can rely on them across minor versions.

**No internal terms** — user-facing output uses product language
(`deploy` / `service` / `build`), never the platform's internal infrastructure
names.

## Architecture

A layered Commander app. The composition root in `src/index.ts` wires shared
dependencies (`CommandDeps`) and registers every command group; commands
orchestrate use cases over the HTTP boundary.

```
bin/loopscale                  node launcher (+ 15-min watchdog)
  └─ dist/index.js
src/
├── index.ts              createProgram() — composition root, signals, exit-code wiring
├── register/             Commander wiring: subcommands → command actions
├── commands/             use-case orchestration (deploy, domain, env, scale, …)
├── api/                  HTTP client + SSE stream (the only cross-repo seam)
├── auth/                 device-flow OAuth, token refresh, browser opener
├── adapters/             loopscale.yaml · services.json · source bundle + multipart upload · git
├── config/              ConfigStore (XDG, 0o600 tokens) + constants
├── output/               renderers, formatter (CI/json detection), prompts
├── lib/                  exit-code contract, loopzero bin/build helpers
└── tracing/              OpenTelemetry init + W3C context propagation
```

**Design principles** — Dependency Inversion at the boundaries (commands take a
`CommandDeps` of injected functions, so unit tests run with zero I/O), a single
composition root, and one stable contract per surface (exit codes, `--json`).

**The seam** — `cli ↔ engine` is HTTP over `/api/v1`. The engine OpenAPI is
vendored at `tests/contract/engine.yaml`; `tests/contract/engine-contract.test.ts`
asserts every path the CLI calls exists in that snapshot (consumer-driven), and
`tests/contract/pact-engine.test.ts` adds a Pact consumer contract. The CLI
imports **nothing** from the engine repo.

**Stack** — TypeScript (strict) · [Commander](https://github.com/tj/commander.js) ·
[js-yaml](https://github.com/nodeca/js-yaml) · [tar](https://github.com/isaacs/node-tar) ·
[OpenTelemetry](https://opentelemetry.io) · [Jest](https://jestjs.io).

## Comparison

Where LoopScale CLI fits among deploy CLIs:

| | **LoopScale CLI** | Vercel CLI | Railway CLI | Fly.io `flyctl` | Heroku CLI |
|---|---|---|---|---|---|
| Open source | ✅ Apache-2.0 | ❌ | ✅ MIT | ✅ Apache-2.0 | ✅ (deprecated OSS) |
| Self-hostable control plane | ✅ (operator-provisioned) | ❌ (managed) | ❌ (managed) | ❌ (managed) | ❌ (managed) |
| Primary language | **TypeScript** | TypeScript | Rust | Go | TypeScript |
| Zero-config deploy | ✅ `loopscale` | ✅ `vercel` | ✅ `railway up` | partial (`fly launch`) | ❌ (git push) |
| Monorepo multi-app in one deploy | ✅ | partial | partial | ❌ (per-app) | ❌ |
| Documented exit-code contract | ✅ `0–5` | partial | partial | partial | partial |
| Stable `--json` on every command | ✅ | partial | partial | ✅ | partial |
| Streamed build/deploy events | ✅ SSE | ✅ | ✅ | ✅ | ✅ |

<sub>Best-effort comparison from public documentation as of June 2026. LoopScale CLI
is the TypeScript-native, self-hostable choice: it tracks the deploy ergonomics
of managed PaaS CLIs while running against a control plane you can host
yourself. "partial" means the capability exists but is narrower or
undocumented relative to LoopScale's. Spot an error? Open a PR.</sub>

## Testing

```bash
npm test          # jest — unit + integration + contract (no live engine needed)
npm run typecheck # strict TypeScript, zero errors
npm run lint      # ESLint, zero warnings
```

| Metric | Value |
|---|---|
| Tests | **1,300+** passing across 97 test files |
| Layers | unit · integration (spawns the built CLI vs an in-process mock API) · contract |
| Contract | consumer-driven: every `/api/v1` path is pinned to the vendored engine OpenAPI |
| Type safety | TypeScript `strict`, end-to-end |

Integration tests spawn the real built CLI against an in-process mock HTTP
server over loopback — because passing unit tests prove logic, not a working
command.

## Roadmap

The CLI was extracted from the `loopscale` monorepo (history preserved) at M2 of
the platform decomposition and now ships as a standalone repo.

| Area | Status |
|---|---|
| Standalone extraction (HTTP-only, zero engine code) | **Shipped** |
| Zero-config deploy + LoopZero auto-build | **Shipped** |
| SSE build/deploy stream (reconnect, replay, polling fallback) | **Shipped** |
| Exit-code + `--json` contracts | **Shipped** |
| Device-flow auth + transparent token refresh | **Shipped** |
| Consumer-driven engine contract test (+ Pact) | **Shipped** |
| OpenTelemetry tracing | **Shipped** |
| Scope CLI to end-user experience (platform/operator tooling removed) | **Shipped** |
| Publish `@getloopscale/cli` to npm | Planned |
| TS import-boundary lint (enforce HTTP-only mechanically) | Planned |

## Status

> **Pre-release** (`v0.2.0`). The CLI is feature-complete for the core
> deploy → stream → rollback flow, with the exit-code and `--json` contracts in
> place and a consumer-driven contract test against the engine API. It is **not
> yet published to npm** — run from source for now. We don't claim it ready for
> production yet: that bar stays unchecked until backed by sustained real-world
> usage evidence.

## Contributing

```bash
git clone https://github.com/getloopscale/cli.git
cd cli
npm ci
npm test
```

Issues, PRs, and feedback are all welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md)
for the development workflow and the dependency-direction invariant (the CLI must
never import engine code).

## License

[Apache-2.0](./LICENSE) — Copyright 2025-2026 [getloopscale.com](https://getloopscale.com). See [NOTICE](./NOTICE) for third-party attributions.

<div align="center">

**If LoopScale CLI is useful to you, [give it a ⭐](https://github.com/getloopscale/cli) — it's the signal that keeps the project moving.**


**Part of [LoopScale](https://getloopscale.com).**

</div>
