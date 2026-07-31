---
description: Health-check Cursor CLI, list models, guide installation, or toggle the stop-time review gate.
argument-hint: '[--doctor] [--print-models] [--install] [--json] [--enable-review-gate|--disable-review-gate] [--tasks-dir <dir>]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- "$ARGUMENTS"`

Present the check results as-is. If any check failed, tell the user concretely what to do (install cursor-agent, run `cursor-agent login`, run `npm install` inside the plugin). Never attempt to run the installer yourself.

`--enable-review-gate` / `--disable-review-gate` toggle the per-repo stop-time review gate: when enabled, a Cursor model reviews each turn's edits before Claude Code is allowed to stop, and a `BLOCK` verdict keeps the turn going. Relay the confirmation message verbatim.

`--tasks-dir <dir>` sets, per repository, a fallback directory for `/cursor:from-plan` task files. Most projects do not need it: when you pass a spec path, the task file is written next to that spec automatically, in whichever repo it lives. This key only applies to Claude's own plan-mode files, which have no project location to inherit. `--no-tasks-dir` resets it. Relay the confirmation message verbatim.
