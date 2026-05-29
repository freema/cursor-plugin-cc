---
description: Read-only code review of your git diff by a Cursor model. Reports findings; never edits files.
argument-hint: '[--background] [--wait] [--adversarial] [--base <ref>] [--scope auto|working-tree|branch] [--model <id>] [--timeout <sec>] [focus...]'
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" -- "$ARGUMENTS"`

Render the tool output to the user verbatim — it is a code review, do not paraphrase or summarise it, and do not act on the findings yourself. If the job ran in the foreground, present the **Review** section as-is. If it was started in the background, show the returned job id and the `/cursor:status` / `/cursor:result` hints. This command is review-only: never apply the fixes it suggests unless the user explicitly asks in a follow-up.
