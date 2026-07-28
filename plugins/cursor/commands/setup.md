---
description: Health-check Cursor CLI, list models, guide installation, or toggle the stop-time review gate.
argument-hint: '[--doctor] [--print-models] [--install] [--json] [--enable-review-gate|--disable-review-gate]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- "$ARGUMENTS"`

Present the check results as-is. If any check failed, tell the user concretely what to do (install cursor-agent, run `cursor-agent login`, run `npm install` inside the plugin). Never attempt to run the installer yourself.

`--enable-review-gate` / `--disable-review-gate` toggle the per-repo stop-time review gate: when enabled, a Cursor model reviews each turn's edits before Claude Code is allowed to stop, and a `BLOCK` verdict keeps the turn going. Relay the confirmation message verbatim.
