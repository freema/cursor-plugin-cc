---
description: Health-check Cursor CLI, list models, or guide installation.
argument-hint: '[--doctor] [--print-models] [--install]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" -- "$ARGUMENTS"`

Present the check results as-is. If any check failed, tell the user concretely what to do (install cursor-agent, run `cursor-agent login`, run `npm install` inside the plugin). Never attempt to run the installer yourself.
