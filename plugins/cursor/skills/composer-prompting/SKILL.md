---
name: composer-prompting
description: Internal guidance for shaping a well-specified coding task into a tight Cursor/Composer prompt before delegating it via /cursor:delegate
user-invocable: false
---

# Composer Prompting

Use this skill when the `cursor-runner` subagent (or the main Claude thread) needs to turn a well-specified coding task into a prompt for the Cursor CLI (`cursor-agent`, Composer by default).

Cursor has **no conversation context** — whatever the target repo expects, you must bake into the prompt you send. Prompt Composer like a fast executor with a precise contract, not a collaborator you can clarify with mid-run. State the goal, the exact end state, the files it may touch, and how "done" is verified.

## Ground the prompt in the target repo first

Before writing the prompt, use `Read` (only) to check the target repo for:

- `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`, `.github/copilot-instructions.md`, `CONTRIBUTING.md` — convention files.
- `package.json` / `Taskfile.yml` / `Makefile` / `justfile` — to learn which commands build and test the project.
- `README.md` — for the overall project goal (one sentence is enough).

**Language and style follow the target repo, not this plugin.** If the repo's commits, comments, or UI strings are in Czech / German / any other language, Composer must match — do not force English. If the repo is mixed (code in English, user copy in Czech), say so explicitly. When in doubt, tell Cursor: "match the existing style of surrounding files."

## References — read the one you need

- **[references/prompt-anatomy.md](references/prompt-anatomy.md)** — the five mandatory prompt sections + guardrails block, with a full worked example. Read before composing any delegate prompt.
- **[references/model-selection.md](references/model-selection.md)** — the model escalation ladder, chunking heuristics for oversized plans, and resume-vs-fresh routing.
- **[references/composer-antipatterns.md](references/composer-antipatterns.md)** — prompt shapes that reliably produce bad Composer runs, each with the fix. Skim when a previous run went sideways.

## Assembly checklist

1. Ground the prompt in the target repo's conventions and verify commands.
2. Write the five sections plus the guardrails block, in order (see prompt-anatomy).
3. Chunk anything bigger than one reviewable slice (see model-selection).
4. Pick the smallest model that fits; default to `composer-2.5-fast`.
5. Decide resume vs fresh.
6. Remove redundant instructions before sending.
