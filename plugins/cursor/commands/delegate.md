---
description: Delegate a coding task to the Cursor CLI agent (Composer 2 by default).
argument-hint: '[--background] [--wait] [--fresh] [--resume[=chat-id]] [--model <id>] [--cloud] [--no-force] [--timeout <sec>] <task...>'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- "$ARGUMENTS"`

Render the tool output to the user verbatim. If the job ran in the foreground, present the status, files touched, and summary sections as a compact Markdown block. If the job was started in the background, show the returned job id and the `/cursor:status` hint. Do not paraphrase Cursor's summary.
