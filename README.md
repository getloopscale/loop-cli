# `@theo/cli` — deploy CLI for TheoCloud

The `theo` CLI is the deploy companion to the [TheoKit OSS framework](https://github.com/usetheo/theokit). It authenticates with TheoCloud, uploads your application bundle + `.theo/services.json` artifact, streams the build/deploy events, and surfaces logs and rollback controls.

## Install

```bash
# In your project (recommended — version-pinned in package.json):
npm install --save-dev @theo/cli

# Or globally:
npm install -g @theo/cli
```

You also need TheoKit installed so `theo deploy` can build the `.theo/services.json` artifact automatically. In typical TheoKit projects it is already a dev dependency:

```bash
npm install theokit
```

## Quickstart (Plan v1.1 zero-config)

```bash
theo login                    # authenticate once per machine
theo                          # zero-config deploy — builds + uploads in one step
```

`theo` without a positional subcommand routes to `theo deploy`. When `.theo/services.json` is missing the CLI invokes `theokit build --target theo-cloud` automatically as a subprocess (see `runTheokitBuild` source for the exact spawn defaults).

The legacy two-step sequence still works unchanged:

```bash
theokit build --target theo-cloud   # explicit build
theo deploy --prebuilt              # upload only — skip auto-build
```

## CI/CD with prebuilt artifacts

CI pipelines that split build and deploy across stages (Vercel-style) use the `--prebuilt` or `--skip-build` flag:

```yaml
jobs:
  build:
    steps:
      - run: npm ci
      - run: npx theokit build --target theo-cloud
      - uses: actions/upload-artifact@v4
        with:
          path: .theo/services.json
  deploy:
    needs: build
    steps:
      - run: npm ci
      - uses: actions/download-artifact@v4
      - run: npx @theo/cli deploy --prebuilt
        env:
          THEO_TOKEN: ${{ secrets.THEO_TOKEN }}
```

`--prebuilt` is an alias of `--skip-build` (Vercel parity). Both forms are accepted; choose whichever your team's CI templates use.

## Tuning subprocess defaults

Three environment variables tune the `theokit build` subprocess that `theo deploy` runs:

| Variable | Default | Purpose |
|----------|---------|---------|
| `THEOKIT_BUILD_TIMEOUT_MS` | `600000` (10 min) | Maximum build duration. Long-running monorepo builds often need to extend this. |
| `THEOKIT_BIN` | (auto-resolved) | Absolute path to the `theokit` binary. Useful when `node_modules/.bin/theokit` cannot be auto-located (Docker volumes, non-standard installs). |
| `THEOKIT_NON_INTERACTIVE` | `1` (forced) | Always `1` in the subprocess — prevents transitive npm tools from blocking on prompts. Set by the CLI; do not override. |

## Custom `distDir`

When `theo.config.ts` declares a non-default `distDir`, the auto-discovery for `.theo/services.json` will not find the artifact. Use `--services-json <path>` to point at the explicit emit location:

```bash
# theo.config.ts → distDir: 'out'
theo deploy --services-json ./out/services.json
```

## Rebuilding after `theo.config.ts` edits

The auto-build trigger only runs when `.theo/services.json` is absent. If you edit `theo.config.ts` and want the new shape on TheoCloud, delete the cached artifact first:

```bash
rm -rf .theo && theo deploy
# OR
theokit build --target theo-cloud && theo deploy --prebuilt
```

This matches Vercel's "trust the artifact" semantics — staleness detection across `package.json`, source files, and service definitions is intentionally not in scope (per Plan v1.1 ADR D2).

## All commands

```
theo                       # zero-config deploy (Plan v1.1 T4.1)
theo deploy [opts]         # build + upload + stream events
theo login                 # OAuth flow
theo logout                # clear local credentials
theo whoami                # current identity + tenant
theo logs [opts]           # tail or fetch build/runtime logs
theo rollback [opts]       # restore a previous release
theo promote [opts]        # staging → production
theo status [opts]         # show current release state
# ... and more — `theo --help` for the full list
```

## Breaking change disclosure (Plan v1.1 — intentional)

`theo` without a positional subcommand previously emitted `Unknown command: undefined. Run: theo --help` and exited 1. From v1.1 onward it delegates to `theo deploy` per Vercel-parity zero-config. Scripts that relied on the previous behavior for usage discovery should migrate to `theo --help`.

To detect the version boundary in a shell script:

```bash
theo --version | awk -F. '{ if ($1 == 0 && $2 < 2) print "old"; else print "new"; }'
```

## Source

This package lives in [theo-cloud/theo/cli](https://github.com/usetheo/theo-cloud). See the `docs/architecture/` folder for the integration flow with the TheoKit framework.
