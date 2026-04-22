---
description: Verify a page or flow in a real browser via Cursor's `chrome-devtools` MCP. Read-only — Cursor reports; does not modify source files.
argument-hint: '<url> <what to verify...>'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/browser.mjs" -- "$ARGUMENTS"`

Present the browser report verbatim. If the preflight fails because the `chrome-devtools` MCP is not configured, relay the setup instructions from the error to the user — do not try to install or configure the MCP yourself.
