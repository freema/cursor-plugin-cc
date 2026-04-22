---
description: List Cursor chat sessions for this repository via `cursor-agent ls`.
argument-hint: ''
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/dist/sessions.js"`

Render the table verbatim. If `cursor-agent ls` was unavailable and the fallback registry listing was shown, surface that note too so the user knows why the columns differ.
