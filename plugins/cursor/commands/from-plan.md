---
description: Convert a Claude Code plan (or any spec file) into a task file and optionally hand it off to Cursor.
argument-hint: '[plan-name-fragment|path] [--delegate] [--out-dir <dir>] [--in-place] [--model <id>] [--background] [--list]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/from-plan.mjs" -- "$ARGUMENTS"`

Render the output verbatim. The command has two modes:

- **Preview + hand back** (default): it writes the task file, then prints the exact `/cursor:delegate @…` command. Run that command yourself after reviewing the task file.
- **Auto-delegate** (`--delegate` or `--yes`): it writes the task file AND immediately calls `/cursor:delegate`, so the output merges into a single flow.

Without arguments it picks the newest plan under `~/.claude/plans/`. Pass a name fragment (e.g. `dark-mode`) or any path (e.g. `PRPs/dark-mode.md`) to pick a specific one. `--list` shows the 15 most recent plan files.

**Where the task file lands** — derived from the spec, most- to least-specific:

1. `--out-dir <dir>` for a single run
2. **the directory the source spec lives in** — pass `PRPs/018.md` and the task file joins it there, in whichever repo that is
3. the `CURSOR_PLUGIN_CC_TASKS_DIR` environment variable
4. the per-repo default: `/cursor:setup --tasks-dir PRPs` (reset with `--no-tasks-dir`)
5. `tasks/`

Rule 2 means spec-driven projects need no configuration, and it keeps working when specs are centralised in one repo while code lives in siblings. Rules 3–5 only come into play for Claude's own plan-mode files, which have no project location to inherit. Relative values resolve against the repo root, so the destination does not move when you run the command from a subdirectory.

The spec may live **outside** the current repo. When it does, Cursor is handed an absolute path instead of `@path` (which cannot leave the repo root), and told to apply its changes in the current repository. Report that note to the user when it appears.

**`--in-place`** skips the conversion entirely and delegates the source document as written — no task file is created. Use it when your spec already _is_ the task (PRP, Spec Kit, OpenSpec). Works across repos.
