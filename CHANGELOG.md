# Changelog

All notable changes to `@getloopscale/cli` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
