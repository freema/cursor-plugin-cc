# AGENTS.md — rules for any AI agent editing this repo

This file is the contract any agent (Claude Code, Cursor, Codex, …) must follow before touching code in `cursor-plugin-cc`. If you are human, read it too.

## What this repo is

A Claude Code plugin that delegates coding tasks from Claude to the Cursor CLI (`cursor-agent`). Nine slash commands under the `cursor:` namespace plus a `cursor-runner` subagent. Source of truth lives under `plugins/cursor/`.

## Hard rules

1. **Zero runtime dependencies.** The plugin ships as plain ESM `.mjs` and must execute directly after `/plugin install` with zero `npm install` in the user's plugin cache. If you are about to add `execa`, `zod`, `nanoid`, a HTTP client, a command parser, or any other third-party runtime package — stop. Write a small inline helper instead. See `plugins/cursor/scripts/lib/run.mjs` as the reference pattern (it replaced `execa` in ~80 lines).
2. **No build step.** No TypeScript, no bundler, no `dist/`. `scripts/*.mjs` IS the ship artefact. If you find yourself wanting one, something has gone wrong with the approach.
3. **Slash command scripts live under `plugins/cursor/scripts/<cmd>.mjs`.** Their wrappers at `plugins/cursor/commands/<cmd>.md` must use `node "${CLAUDE_PLUGIN_ROOT}/scripts/<cmd>.mjs" -- "$ARGUMENTS"` with quoted `$ARGUMENTS` — unquoted breaks under zsh on any prompt containing `?`, `*`, or `@`.
4. **`Bash(node:*)` is the only permission pattern used in `allowed-tools`.** Do not invent path-based patterns — Claude Code does not expand `${CLAUDE_PLUGIN_ROOT}` inside `allowed-tools`.
5. **Jobs are persisted under `~/.cursor-plugin-cc/jobs/<repo-hash>/`.** Never break that layout; users point scripts at those files when reporting bugs.
6. **Language: everything in this repo is English.** Code, comments, commit messages, docs, PR bodies, issue titles. The plugin does not impose a language policy on target repos — `cursor-runner` reads target-repo conventions — but this repo itself is English-only.
7. **Do not impose conventions on target repos.** The `cursor-runner` subagent reads `AGENTS.md` / `.cursor/rules` / existing code in whatever repo the user is working in and tells Cursor to match THAT style. When editing the subagent, do not hardcode English / Prettier / whatever.

## Task format

Every delegated task (whether you write it by hand or `/cursor:from-plan` generates it) uses five sections in this order:

1. **Goal** — one sentence.
2. **Repo context** — stack + pointer to AGENTS.md / `.cursor/rules` / conventions file.
3. **Acceptance criteria** — 1–5 verifiable bullets.
4. **Files to touch** — explicit list when predictable.
5. **How to verify** — exact commands (`npm test`, `task typecheck`, etc.).

Plus a **Constraints** block that forbids: touching files outside the list, renaming public APIs, modifying lockfiles.

## How to make a change

1. Branch named `feat/…`, `fix/…`, `refactor/…`, or `docs/…`.
2. Work inside `plugins/cursor/`. `cd plugins/cursor && npm install` installs dev deps (vitest, eslint, prettier — the only ones).
3. Run tests: `npm test`. Run lint: `npm run lint`. Both must be green before committing.
4. Commit messages in conventional style (`type(scope): subject`).
5. Open a PR against `main` with a summary + test plan. CI must pass across Node 18.18 / 20 / 22 × Ubuntu / macOS.
6. Squash-merge only.

## Guardrails for automated edits

- Do not touch `package-lock.json` unless you are changing dependencies on purpose.
- Do not modify `~/.cursor-plugin-cc/jobs/**` — that is user state, never ours.
- Do not rename the command namespace (`cursor:`) or the marketplace name (`tomas-cursor`) without explicit user approval — both are referenced in user environments.
- When adding a new slash command, follow the recipe in `CONTRIBUTING.md`.

## Where things live

- `plugins/cursor/scripts/<cmd>.mjs` — command entrypoints (9).
- `plugins/cursor/scripts/lib/*.mjs` — shared helpers (run, id, args, paths, jobs, parse, cursor, git, invoked, plan).
- `plugins/cursor/commands/*.md` — slash command wrappers.
- `plugins/cursor/agents/cursor-runner.md` — the handoff subagent prompt.
- `plugins/cursor/tests/*.test.mjs` — vitest specs + fixtures.
- `.claude-plugin/marketplace.json` — what Claude Code's `/plugin install` reads.

If you are about to add a file outside these paths, justify it in the PR description.
