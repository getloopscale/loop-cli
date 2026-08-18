# Changelog

All notable changes to `@usetheo/cli` are documented here.
Format: Keep a Changelog + Semantic Versioning.

## [Unreleased]

### Added
- **Este projeto passou a ter a sua própria lista de pendências.** Um achado sobre o CLI vivia na lista de outro repositório — órfão por construção: quem mantém aquele repositório nunca o selecionaria, e quem trabalha aqui não sabia que existia. Foi trazido com a evidência original e ganhou número local. (B-145 do repo theo)
- **`theo storage sync` respects a `.theoignore` file (gitignore-style).** A `.theoignore` (or `.gitignore`) at the local dir declares which paths to keep out of the sync — the same familiar model as `.dockerignore`/`.npmignore`, with full git semantics (directory `foo/`, glob `*.local.json`, anchored `/foo`, negation `!keep`). Excluded paths are never walked, hashed, pushed, downloaded, nor pulled (the fence protects both directions). Reuses the `ignore` package (no new dependency). This makes it practical to sync a real `.claude/` whose audit trail (`knowledge-base/`) dwarfs the config: `echo "knowledge-base/" > .claude/.theoignore` and the 1.7 GB audit tree is skipped. The matcher is loaded at the composition root and injected as a predicate, so the sync engine stays pure over its ports (ADR D3). 4 loader tests + 2 engine tests.
- `theo storage sync --exclude <glob>` (repeatable) — skip paths matching a glob (`**` crosses directories, `*` stays within a segment). Both directions: excluded paths are never pulled nor pushed. (For a persistent, declarative ignore set, prefer `.theoignore`.)
- Claude Code integration (`integrations/claude-code/`): example `settings.json` wiring `theo storage sync` to `SessionStart` (pull) + `SessionEnd` (push) so a shared `.claude/` stays in sync effortlessly. Ships with a safety fence — `hooks/**` and `settings*.json` are excluded by default so a pull can never overwrite the executable config the agent runs (executing synced config is gated on a future trust model).

### Changed

- Abrir um PR não dispara mais esteira: o gatilho `pull_request` foi removido do 1 workflow que o declarava (`ci.yml`). CI passa a rodar **somente no merge** — push em `develop`/`main` — por decisão do dono (2026-08-12). A cobertura no merge não se perde: os mesmos workflows já disparavam em `push`, que foi mantido intacto. Se este repositório tiver *required status checks* configurados no GitHub para PRs, eles precisam ser removidos lá, senão o PR fica travado esperando um check que nunca reporta.
- Hook de validação de comandos ficou mais rápido: ~6 processos por chamada de ferramenta em vez de ~50, sem mudança de comportamento


## [0.4.0] - 2026-07-15

### Added
- `theo storage` command group (M7 tenant blob storage): `upload`, `download`, `list`, `stat`, `delete`, `share` against the `/v1/storage/*` API. Authenticated via the existing token/config; product-language output only (no infra terms); permanent exit-code contract (0 success, 1 usage/limit, 4 auth, 5 partial). 9 unit tests.
- `theo storage sync <local-dir> --prefix <p>` — bidirectional, conflict-safe sync of a stored prefix to a local directory. Persists a `.theo/.sync-manifest.json` of the last-synced content hash per path; classifies per-path changes and applies non-conflicting ones both directions; refuses to overwrite a file changed on both sides (surfaces a conflict + `--strategy=pull|push|backup`). Pull-twice is a no-op. `--dry-run` previews without writing. Hardened against pulling through a symlink out of the sync folder; a single failed file does not abort the whole sync (others still sync); exit codes mirror the other storage commands (0 success / 1 usage-or-limit / 4 auth / 5 partial). Product-language output only. LIVE-validated end-to-end against dev-public storage.

## [0.3.5] - 2026-06-26

### Fixed
- **`theo secret` (set/list/delete) funciona em projeto que só tem `.theo/services.json` v2.** Antes resolvia o projeto apenas pelo `theo.yaml` legado e reprovava com *"No theo.yaml found. Run: theo init"* — num projeto gerado pelo theokit, que `deploy`/`status`/`logs` já deployavam sem problema. `theo connect`/`disconnect` tinham a mesma lacuna e foram corrigidos junto. A escolha da fonte fica na raiz de composição; os comandos seguem consumindo um único manifesto (#165)
- **Teste F-04 de duração de deploy sai do vermelho.** `should use server duration when server reports nonzero duration_seconds` assertava o formato anterior a `41fbae1` (fecho de theo-cloud#84), que passou a exibir pós-build + build (`2m 22s (build 45s)`) em vez de só o pós-build. O intento do teste — o número vem do servidor, não do relógio de parede — foi preservado e reforçado; só a forma foi atualizada
- **`theo secret delete` e `theo rollback` não travam mais em stdin não-interativo.** Sem `--yes`, num pipe ou redirect, os dois caíam no prompt `[y/N]`, ficavam presos até o timeout de 40 s e a mensagem culpava a rede — *"timed out. Check your connection"* — quando o que faltava era um `y`. Agora reprovam de imediato com `Confirmation required. Pass --yes in non-interactive contexts`. O fix de #161 tinha coberto só `theo promote`; os três prompts foram unificados no helper `promptConfirm`, para que a próxima correção não precise ser aplicada em três lugares (#164)

- **theo-cloud#62 J-00.Deploy: `theo status` sem `--env` mostra `production` vazio mesmo com deploy ativo em `preview` (sem pista para usar `--env`)** — Plan `release-blockers-2026-06-25-set` v1.1 (closes #62 MINOR). Root cause: `src/commands/status.ts:74` defaultava a `production` sem distinguir "usuário não passou `--env`" de "usuário passou `--env <X>` e o env está vazio". Mensagem genérica "No deploys yet. Run `theo deploy` to get started." escondia a possibilidade de existir deploy em outro env (preview). User com deploy ativo em preview rodando `theo status --json` (sem flag) via vazio e achava que o deploy "sumiu". Fix m37 honest-signal pattern: tracking `envExplicit = opts.env !== undefined` permite ramificar a mensagem. Default env vazio (`envExplicit=false`): hint canonical `"No deploy in 'production'. Try \`theo status --env preview\` or run \`theo env list\` to see all environments."` — distingue verbatim o caso #62. Explicit `--env <X>` vazio: terse `"No deploy in '<env>'. Run \`theo deploy --env <env>\` to get started."` (preserva escolha do usuário). Test footprint (36/36 PASS): atualizado `displays no-deploys message when no builds exist` para assertar `"No deploy in 'production'"` + `--env preview` + `theo env list`; novo `#62: explicit --env without deploy does NOT spam the alternate-env hint` (anti-regression: explicit env scope NÃO ecoa hint cross-env). Plan: `theo/.claude/knowledge-base/plans/release-blockers-2026-06-25-set-plan.md` v1.1.

## [0.3.3] - 2026-06-25

### Changed
- **`publish.yml` workflow runs only hermetic suites (unit + contract)** — `npm test` blocks publish on integration tests that require a live theo backend (real auth + real `/api/v1` surface), failing CI with exit-code 4 even though 1294/1303 tests pass. v0.3.1 + v0.3.2 publish steps were SKIPPED because of this; both releases were published manually by sponsor. Sprint 4 `READY_TO_READ_TEAM` mandate (sponsor 2026-06-25) requires automated publish to unblock QA. Split: new `test:unit` (1230 tests) + `test:contract` (14 tests) scripts; publish workflow runs `test:unit` + `test:contract` only. Integration tests run locally + canonical on operator side (1303/1303 PASS local). Closes the recurring sponsor-manual-publish friction documented in feedback `cto_issue_fix_publish_chain_2026_06_24`.

## [0.3.2] - 2026-06-25 [SKIPPED — publish gated on integration tests; superseded by 0.3.3]

### Fixed
- `src/adapters/services-json.ts` — **`theo deploy` fails with `services.json not found` even when `theokit build` succeeded** (closes usetheodev/theo-cloud#29.B2). theokit v0.5.0+ writes manifests to `.theokit/services.json` by default; theo-cli previously only searched `.theo/services.json`. The walk-up loop now cascades through both at each dir level, preferring `.theo/` for backward compat with users who built via `theokit build --target theo-cloud` (still emits `.theo/`). The `--services-json <path>` override flag continues to short-circuit the cascade. 5 NEW hermetic regression tests at `tests/unit/adapters/services-json.test.ts § cascade .theo/ → .theokit/ (Sprint 4 #29.B2)`. Full suite 1303 PASS / 0 FAIL (was 1298 pre-Sprint-4 + 5 new). Plan reference: `theo/.claude/knowledge-base/plans/qa-sprint4-cleanup-2026-06-25-plan.md` Phase 1 (T1.0..T1.3). EC-1 absorption: T1.0 pre-flight probe caught that `jest.config.js roots: ['<rootDir>/tests']` would have silently skipped tests at `src/adapters/*.test.ts`; placed under canonical `tests/unit/adapters/`.

- `src/auth/device-flow.ts` — **`theo login --device-flow` 401 on dev-public**
  (root cause: CLI prepended canonical
  `THEO_URL=https://app-dev.usetheo.dev/engine` to `/v1/auth/device/*` and the
  resulting `/engine/v1/auth/device/*` falls through Caddy `/v1/*` route → 401
  catchall). Per MEET-040 design (`src/config/constants.ts:22`) Caddy routes
  `/v1/auth/*` → cloud service; device-flow + token-refresh endpoints live at
  the cloud ROOT, not the engine proxy. New `stripEngineSuffix` helper drops
  the trailing `/engine` (also covers `/engine/`) before the 3 endpoint URLs
  (`/v1/auth/device/{authorize,token}`, `/v1/auth/token/refresh`).
  LIVE-validated post-strip: `POST app-dev.usetheo.dev/v1/auth/device/authorize`
  returns 200 with real Hydra `device_code` + canonical
  `verification_uri=https://auth-dev.usetheo.dev/oauth2/device/verify`. 2 NEW
  hermetic anti-regression tests at
  `tests/unit/device-flow.test.ts § strips /engine suffix`. Full suite 1298
  PASS / 0 FAIL.

- `src/config/constants.ts` — canonical `THEO_URL` comment rewritten per the
  QA dogfooding 2026-06-21 close (#130). The legacy comment said `set
  THEO_URL=https://api-dev.usetheo.dev` but that hostname does NOT resolve in
  the dev-public DNS. New canonical: `set
  THEO_URL=https://app-dev.usetheo.dev/engine` (the engine REST is proxied
  under `/engine/*` on the dashboard host). Standalone-multi local
  alternative + reference to the stale value preserved for archaeology.
  NEW hermetic regression-lock at
  `tests/unit/constants-comment-canonical.test.ts` (3 specs PASS) with
  anchored regex so the audit only fires on the directive shape
  (`set THEO_URL=...`) and NOT on prose references that document the
  history.

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.3.0] - 2026-06-18

### Changed
- Scoped the CLI to the end-user experience only. Updated the README command
  reference, comparison, architecture, and roadmap accordingly.


### Removed
- BREAKING: removed the `theo platform` command group (`install` / `upgrade` /
  `uninstall` / `status` / `secrets`) and the entire `src/installer/` module.
  Platform installation is operator tooling — end users never install the
  platform themselves, so shipping an installer in the user CLI was needless
  attack surface.
- BREAKING: removed the operator-only `theo admin` command group (`tenants`,
  `release`), gated by `THEO_SERVICE_AUTH`. Not part of the end-user experience.

## [0.2.1] - 2026-06-18

### Added
- `LICENSE` (Apache-2.0) + `NOTICE` (third-party attributions), materializing the
  per-file SPDX headers the source already declared.
- `CONTRIBUTING.md` documenting setup, the HTTP-only dependency-direction
  invariant, and the permanent exit-code / `--json` contracts.
- npm package metadata for OSS publishing: `repository`, `homepage`, `bugs`,
  `keywords`, `files` allowlist, and a `typecheck` script.


### Changed
- Rewrote `README.md` into an OSS-grade landing page (outcome-shaped hero,
  command reference, contracts, architecture, comparison, roadmap, honest
  pre-release status).
- Corrected the `package.json` `license` field from `UNLICENSED` to `Apache-2.0`
  to match the source SPDX headers and the rest of the Theo platform.

## [0.2.0] - 2026-06-18

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
- `theo platform status` now invokes `kubectl` without a shell, removing a
  latent command-injection surface and the dependency on `grep`/`wc`
  (code-review LOW).
- Internal: refactored `platformInstall` into focused per-step helpers
  (validate / preflight / infrastructure / restore / bootstrap / wire /
  validate) — no behavior change (code-review MED, SRP).
- `SSEClient.close()` is now idempotent — `onClose` fires exactly once even
  when called from both an internal terminal path and an external `finally`
  (code-review LOW).

- Renamed the npm package from `@theo/cli` to `@usetheo/cli` (the `@theo` scope is
  unavailable on the public registry; `@usetheo` matches the `usetheodev` org).
- Expanded `CLAUDE.md` into a self-governing repo contract (build/test, the cli↔engine
  seam, exit-code + `--json` invariants, and the dependency-direction invariant — upheld
  by HTTP-only design + the vendored OpenAPI contract test; a TS import-boundary check is
  a noted follow-up) — M5 of the decomposition roadmap.

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

