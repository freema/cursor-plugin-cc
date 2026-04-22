---
description: Convert a Claude Code plan file into a tasks/<file>.md and optionally hand it off to Cursor.
argument-hint: '[plan-name-fragment] [--delegate] [--model <id>] [--background] [--list]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/from-plan.mjs" -- "$ARGUMENTS"`

Render the output verbatim. The command has two modes:

- **Preview + hand back** (default): it writes `tasks/<file>.md`, then prints the exact `/cursor:delegate @tasks/…` command. Run that command yourself after reviewing the task file.
- **Auto-delegate** (`--delegate` or `--yes`): it writes the task file AND immediately calls `/cursor:delegate`, so the output merges into a single flow.

Without arguments it picks the newest plan under `~/.claude/plans/`. Pass a name fragment (e.g. `dark-mode`) to pick a specific one. `--list` shows the 15 most recent plan files.
