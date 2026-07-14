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

## Prompt anatomy — the five sections

Every prompt you send **must** have these sections, in this order:

1. **Goal** — one or two sentences. What is the outcome? What is this a step of, if anything?
2. **Repo context** — 1–2 lines: stack / framework, and "follow conventions in `AGENTS.md` / `.cursor/rules` / whichever you actually found."
3. **Acceptance criteria** — 1–5 bullet points, concrete and verifiable.
4. **Files to touch** — an explicit list. Unless the task inherently cannot predict this, Composer must not wander outside it.
5. **How to verify** — the exact commands that prove the task is done (e.g. `npm test`, `task typecheck && task test`, `pnpm lint`). Not optional — without it Composer will declare "done" on unverified work.

Then a **Guardrails** block, short and blunt:

- Do not delete files outside the list.
- Do not rename public APIs unless asked.
- Do not touch lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless the task is explicitly about dependencies.
- If a pre-existing test is already failing, report it — do not "fix" it as a side task.

## Chunk oversized plans before delegating

`cursor-agent --force` will YOLO through anything you hand it. That is the point — and also the risk. **Refuse to delegate a single monolithic blob of work.** Heuristics:

- More than **~5 discrete steps** → split into one `/cursor:delegate` call per step (or per coherent slice).
- More than **~10 files** or crossing **more than 2 architectural layers** → ask the main Claude to narrow the slice first.
- If you cannot name the acceptance criteria in ≤ 5 bullets, the slice is still too big.

Small slices give Composer a tight scope, make the diff reviewable, and make failures cheap to retry.

## Pick a model

Default is `composer-2.5-fast` — Cursor's own current default and the fastest Composer variant. Escalate only when the task warrants it:

- `composer-2.5` (non-fast) — quality matters slightly more than latency, but the task is still well-scoped.
- `sonnet` (`claude-4.6-sonnet-medium`) — more than ~5 files touched, or moderate architecture changes.
- `opus` (`claude-opus-4-7-high`) — cross-cutting refactor, subtle correctness, or a prior `composer` run failed.
- `gpt` / `codex` (`gpt-5.3-codex`) — only when the user explicitly asks for it.

Unknown aliases are forwarded as-is, so `--model <whatever>` always works. Do not escalate without a reason — `composer-2.5-fast` is the default for speed and cost.

## Resume or fresh

- **`--resume`** (default when not specified): continue the latest Cursor chat for this repo. Use it when **iterating on the same task** — "also cover the 429 path", "rename the helper you just added". Cheap, preserves Composer's mental model.
- **`--resume=<chat-id>`**: same, but target a specific prior chat — when `/cursor:status` or the user pointed you at one explicitly.
- **`--fresh`**: start a brand-new Cursor session. Use it when **the new task has nothing to do with the previous one**, or when the previous run went off the rails and resuming would just carry the confusion forward.

When in doubt: fresh if the task topic changed, resume if it's the same thread of work.

## Assembly checklist

1. Ground the prompt in the target repo's conventions and verify commands.
2. Write the five sections plus the guardrails block, in order.
3. Chunk anything bigger than one reviewable slice.
4. Pick the smallest model that fits; default to `composer-2.5-fast`.
5. Decide resume vs fresh.
6. Remove redundant instructions before sending.
