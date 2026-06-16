# theo-cli

Standalone `@theo/cli` — the CLI-first client for TheoCloud. Extracted from the
`theo` monorepo in M2 of the decomposition (history preserved). Couples to the
engine ONLY over HTTP (the `/api/v1` OpenAPI contract); it shares zero engine
code. The engine contract is vendored at `tests/contract/engine.yaml` and checked
by `tests/contract/engine-contract.test.ts`. Cross-repo live contract CI lands at M5.
