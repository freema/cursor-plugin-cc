---
description: Resume the latest Cursor chat (or a specific one) with an optional follow-up prompt.
argument-hint: '[--resume=chat-id] [--model <id>] [--background] [follow-up task...]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" -- "$ARGUMENTS"`

Treat the output identically to `/cursor:delegate` — it is the same pipeline, just with `--resume` injected.
