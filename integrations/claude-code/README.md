# Theo storage sync ↔ Claude Code

Keep a shared `.claude/` config directory in sync across your machines with **zero
manual effort** — pull the latest on session start, push your edits on session end.

This is the ergonomic wrapper around `theo storage sync`. The command itself is
bidirectional and conflict-safe; these hooks just run it at the right lifecycle
moments so you never think about it.

## Why session-boundary hooks (not a background daemon)

Every config-sync tool that tried mid-session interval/watch sync reports friction —
the [Obsidian Git](https://ahmorris.org/posts/obsidian-git/) community found that
**"syncing before starting and after quitting was the most reliable approach"**, and
the golden rule everywhere is **"pull before you write."** Claude Code's
[`SessionStart` / `SessionEnd` hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)
map to exactly that:

- **`SessionStart`** runs when a session opens/resumes and its stdout is shown to
  Claude — so your shared `.claude/` is fresh before the first prompt.
- **`SessionEnd`** runs when the session ends — so this session's edits are pushed.

Because `theo storage sync` is idempotent (a manifest of last-synced hashes), a sync
with no changes applies **zero operations** — silent when nothing moved.

## Install

1. `npm i -g @usetheo/cli` and `theo login` (your key needs `storage:read/write`).
2. Merge the hooks from [`settings.example.json`](./settings.example.json) into your
   project's `.claude/settings.json` (or `~/.claude/settings.json` for all projects).
3. First run: preview before it writes anything —
   `theo storage sync "$PWD/.claude" --prefix .claude/ --exclude "hooks/**" --exclude "settings*.json" --dry-run`

That's it. Open a session → your `.claude/` pulls; close it → your edits push.

## Safety — the `--exclude` fence (read this)

The example **excludes `hooks/**` and `settings*.json` from the sync on purpose.**

Your `.claude/` contains **executable config**: `hooks/` are scripts and
`settings.json` wires them. A pull that overwrote those from a compromised or shared
remote would run attacker code on your next session — the exact risk GitHub Codespaces
warns about for dotfiles: *"dotfiles have the ability to run arbitrary scripts, which
may contain unexpected or malicious code."*
([Codespaces docs](https://docs.github.com/en/codespaces/setting-your-user-preferences/personalizing-github-codespaces-for-your-account))

So this integration syncs **inert config** — skills-as-data, `memory/`,
`knowledge-base/`, `CLAUDE.md`, docs, images — and keeps the code-execution surfaces
(`hooks/`, `settings*.json`) **local by construction**. Executing config that was
*synced from elsewhere* (running a shared hook/skill) is a distinct capability gated
on a **trust model** (signed provenance / read-only-on-pull) that is **not yet
shipped**. Until then: sync the data, run only your own local hooks.

`CLAUDE.md` and skills are still instructions (a prompt-injection surface) — only sync
a prefix you control.

## What each flag does

| Flag | Effect |
|---|---|
| `--prefix .claude/` | The stored folder this local dir mirrors |
| `--exclude "<glob>"` | Skip paths (repeatable). `**` crosses directories, `*` stays within a segment |
| `--strategy pull\|push\|backup` | Resolve a both-sides change (default: report the conflict, never clobber). `backup` saves the losing side to `<path>.theo-backup-<ts>` |
| `--dry-run` | Preview; write nothing |
| `--json` | Stable `{ applied, conflicts, skipped }` (used in the SessionStart hook so Claude sees what synced) |

## Notes & limits

- **Non-blocking:** a `SessionStart` hook that fails (e.g. offline) renders a notice
  and the session proceeds — it never blocks Claude from opening.
- **Conflicts never clobber:** a file changed on both sides is reported (exit 5); run
  `--strategy=pull|push|backup` to resolve. Single-machine-at-a-time use rarely conflicts.
- **Keep the prefix small:** `.claude/` config is KBs; sync is fast. Don't point it at
  large binary trees.
- **Manual + preview** any time: run the command yourself with `--dry-run` first.
