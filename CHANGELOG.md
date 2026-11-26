# Changelog

All notable changes to `@getloopscale/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `loopscale init` writes a `loopscale.yaml` for the project in the current directory. It detects a Node project from `package.json` and a Python project from `requirements.txt` or `pyproject.toml`, and takes `--project`, `--app`, `--runtime`, `--start`, `--port` and `--force`. Nineteen messages already told people to run it (#33).
- An app in `loopscale.yaml` may declare `runtime` (`node` or `python`) and `start`. The platform builds its image from the two, so the app needs no `framework` and no Dockerfile (#34).
- `loopscale deploy` reads a manifest from `.loopzero/services.json` before `.theo/` and `.theokit/`.

### Changed
- `loopscale deploy` no longer runs `theokit build`. A project with no `services.json` has its manifest built from `loopscale.yaml`, as a push to a connected repository does. An app with no `runtime` is refused with the lines to add (#34).

### Removed
- `loopscale deploy --skip-build` and `--prebuilt`. They skipped the local build, which is gone.

### Fixed
- `loopscale deploy` accepts the descriptor a push deploys. An app with `runtime` and `start` was refused with "framework 'custom' requires a Dockerfile" (#34).

## [0.2.0] - 2026-11-26

### Added
- `loopscale rollback --no-wait` returns right after the API accepts the rollback (#26)
- `loopscale rollback` prints the id of the rollback and returns it as `rollback_id` in `--json`, on success and on failure. The id names the rollback's record, which the console lists under Deployments (getloopscale/loopzero#128)

### Changed
- A command refused for a plan limit (HTTP 402) says where the plan is changed: `Plan limit reached: Starter allows 50 builds per month (current: 50). Upgrade your plan to continue. See https://app.getloopscale.com/billing to change your plan.` The address is the `upgrade_url` of the API, resolved against `LOOPSCALE_DASHBOARD_URL` when it is a path.
- The project descriptor is `loopscale.yaml`. The CLI reads `loopscale.yaml`, then `loopzero.yaml`, then `theo.yaml`, and uses the first one it finds in the nearest directory, so existing projects keep working. Messages name `loopscale.yaml`, or the file that was read when one was found. `loopscale validate --json` reports that file name in `errors[].field` (getloopscale/loopzero#89)

### Fixed
- `loopscale deploy --json` prints one outcome for a deploy whose service never becomes healthy. It printed a `CANARY_ABORTED` document and then a `DEPLOY_FAILED` one, because the two events the API sends for that failure were handled at the same time (#29)
- `loopscale rollback` waits for the rollback to end. The API answers the request with 202 and finishes in the background, and the command printed "Rollback completed" and exited 0 on that answer. It now follows the project status and exits 0 only when the target release is active; it exits 3 with `ROLLBACK_FAILED` when the previous release stays active, `ROLLBACK_SUPERSEDED` when another release took over, and `ROLLBACK_NOT_CONFIRMED` after 16 minutes without an answer. With `--json` the final line carries that state (#26)

## [0.1.1] - 2026-11-23

### Changed
- Releases are published from GitHub Actions through npm trusted publishing, so each version carries a signed provenance statement linking it to the commit and workflow that built it (#22)

## [0.1.0] - 2026-11-23

### Added
- The `loopscale` command, installed with `npm install -g @getloopscale/cli` (#20)
- `loopscale login`, `logout` and `whoami` sign in through the browser (device flow) and keep the login in `~/.loopscale/config.json`, or in `$XDG_CONFIG_HOME/loopscale/config.json` when `XDG_CONFIG_HOME` is set (#20)
- `loopscale deploy` deploys the current project; running `loopscale` with no subcommand does the same (#20)
- `loopscale status`, `logs`, `rollback`, `promote`, `cancel` and `validate` inspect and manage releases and builds (#20)
- Command groups `project`, `env`, `preview`, `build`, `domain`, `secret`, `team`, `storage`, `billing` and `auth`, plus `connect`, `disconnect`, `scale`, `audit` and `doctor` (#20)
- `--json` output on every command and a fixed exit-code table: 0 success, 1 usage, 2 build, 3 deploy, 4 auth, 5 partial (#20)
- `LOOPSCALE_*` environment variables: `LOOPSCALE_TOKEN`, `LOOPSCALE_URL`, `LOOPSCALE_CLOUD_URL`, `LOOPSCALE_DASHBOARD_URL`, `LOOPSCALE_API_TIMEOUT`, `LOOPSCALE_UPLOAD_TIMEOUT`, `LOOPSCALE_DEPLOY_TIMEOUT`, `LOOPSCALE_DEBUG`, `LOOPSCALE_TRACING_ENABLED`, `LOOPSCALE_OTEL_ENDPOINT` and `LOOPSCALE_ENV` (#20)
- Sign-in and sign-up hints point at the dashboard `https://app.getloopscale.com` unless `LOOPSCALE_DASHBOARD_URL` is set (#20)
