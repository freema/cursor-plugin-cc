# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- **`/cursor:from-plan` no longer drops sections that map to no task slot** (#16). 0.5.1's verbatim pass-through only fires when _zero_ intents match, so a spec that partially matches still lost everything else. A PRP is the clearest case: `Why` → context, `Implementation Blueprint` → approach and `Validation Loop` → verification all resolve, so `Goal`, `What` / success criteria and `All Needed Context` — including its `CRITICAL:` gotchas — were discarded with no warning. Unclaimed sections are now carried through under `## Additional specification context`, preserving the author's original heading casing; only reviewer-facing commentary (`Effort / risks`, `Open questions`, `Alternatives considered`) is still dropped. A `## Goal` section now fills the Goal slot instead of the task file echoing its own title.

### Changed

- **The task destination is now derived from the spec instead of imposed by config** (#16). Point `/cursor:from-plan` at a project spec and the task file is written **next to it** — `PRPs/018-wizard.md` produces `PRPs/<stamp>-018-wizard.md`, beside its siblings — so spec-driven projects need no configuration at all. Full resolution order: `--out-dir <dir>` → the spec's own directory → `CURSOR_PLUGIN_CC_TASKS_DIR` → the per-repo `tasksDir` config → `tasks/`. The last three now only apply to Claude's own plan-mode files, which have no project location to inherit. This follows upstream [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), which never writes into the user's project tree at all — `tasks/` was an addition of this fork, not something inherited.

### Added

- **Multi-repo support: the spec and the code no longer have to share a repository** (#16). A central spec directory (one monorepo holding PRPs for several sibling service repos) is now a first-class case. Running `/cursor:from-plan ~/work/mono/PRPs/018.md` from inside `~/work/api` writes the task file beside 001–017 in the monorepo — the API repo gets no stray `PRPs/` or `tasks/` folder — and hands Cursor an **absolute path** to it, since `@path` cannot resolve outside the repo `cursor-agent` runs in. Code changes still land in the invoking repo. Previously `--out-dir PRPs` silently created a second, disconnected `PRPs/` tree in the wrong repo, and `--in-place` refused outright.
- **`/cursor:setup --tasks-dir <dir>`** (and `--no-tasks-dir`) persists a per-repo fallback directory, surfaced in `--doctor`. Rarely needed now that the destination is derived; it applies only to plan-mode files.
- **`/cursor:from-plan --in-place`** delegates the source spec exactly as written and creates no task file, for workflows where the spec already _is_ the task. Works across repos.

Defaults are unchanged for the plan-mode flow: with no spec path, no flag, no env var and no config, output still lands in `tasks/` and plan-mode conversions are byte-identical.

## 0.5.1 — from-plan pass-through for external spec formats

### Fixed

- **`/cursor:from-plan` no longer discards plans it cannot parse** (#16). A plan/spec whose headings don't match the Claude plan-mode shape (e.g. files produced by other spec/plan tooling) was reduced to a four-placeholder skeleton — the entire plan body was silently dropped and Cursor received an empty task. Such documents are now embedded **verbatim** in the task file (with the guardrail block still appended), matching the pass-through behaviour the module docs always promised. `SECTION_HINTS` additionally learned common spec-driven headings (`overview`, `problem statement`, `requirements`, `design`, `spec`, `tasks`, `steps`, `testing`, `validation`, `success criteria`), so those map onto the proper task sections instead of falling back. README now documents that `from-plan` accepts any path, not just `~/.claude/plans/`.

## 0.5.0 — session lifecycle hooks, stop review gate, process-group cancel

Second port wave from upstream [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (session tracking, the stop-time review gate, prompt templates, structured review output), adapted to the Cursor CLI and the zero-deps runtime — plus a real cancellation bug found while comparing the two codebases. (#17, #18, #20, #21)

### Added

- **Stop review gate** (opt-in, per repo) — `/cursor:setup --enable-review-gate`. Before Claude Code ends a turn, the new `Stop` hook (`scripts/stop-review-gate-hook.mjs`) has a Cursor model review that turn's edits against `prompts/stop-review-gate.md`; the run must answer `ALLOW: …` or `BLOCK: …` on its first line, and a `BLOCK` keeps the turn going with the reason surfaced to Claude. Ported from `openai/codex-plugin-cc`'s stop-time review gate, with two hardening additions: `stop_hook_active` short-circuits so a block can never loop forever, and a missing/logged-out Cursor CLI degrades to a stderr note instead of blocking the session. Per-repo toggle persisted by the new `lib/config.mjs` (`<state-root>/config/<repo-hash>.json`).
- **Structured review output** — review prompts now ask the model to append a fenced ```json verdict block (contract: `schemas/review-output.schema.json` — verdict, summary, findings with severity/file/line, next steps). When it parses (hand-rolled validation in `lib/review-output.mjs`, zero-deps), the data is stored on the job record as `review` and the raw JSON fence is stripped from the human-facing summary; `/cursor:result --json` exposes it. Reviews from models that ignore the instruction stay unstructured — parsing never fails a review.
- **Prompt templates externalized** — the review prompt moved from a JS string array in `review.mjs` to `prompts/review.md` (`{{UPPER_SNAKE}}` placeholders, new `lib/prompts.mjs` loader/interpolator, blank-line collapse for empty optional blocks). Prompts are now reviewable as prose in PRs.
- **Session lifecycle hooks** (`hooks/hooks.json` + `scripts/session-hook.mjs`), modelled on `openai/codex-plugin-cc`. **SessionStart** exports the Claude session id (and `CLAUDE_PLUGIN_DATA`) into the session env via `CLAUDE_ENV_FILE`, so every job records which session started it (`sessionId` on the job record, stamped in `createJob`). **SessionEnd** cancels the session's still-running jobs — a closed Claude session no longer leaves detached workers and `cursor-agent` running unattended. Jobs from other sessions or without a session stamp are never touched.
- **`/cursor:status` scopes its default view to the current session.** The no-arg table now shows this session's jobs plus unattributed ones, with a hint line when rows are hidden; `--all` lifts both the session scope and the 10-row cap. New `lib/jobs.mjs#filterJobsForSession`.
- **`--json` on `/cursor:status`, `/cursor:result`, `/cursor:setup`.** Status and result emit the raw job record(s); setup emits the full doctor report (`checks[].ok`, `allOk`). Meant for scripting and future hooks that branch on job state instead of parsing Markdown.
- **`npm run typecheck`** — `tsc --checkJs --noEmit` over the JSDoc annotations in `scripts/lib/` (`tsconfig.check.json`), wired into CI. Dev-time only: `typescript` is a devDependency, nothing is compiled, `.mjs` stays the ship artefact. The first run surfaced (and this change fixes) two real annotation gaps: `collectReviewContext`'s `mode` was inferred as plain `string` against the declared `'working-tree'|'branch'` union, and `walkToolUses` accessed properties on a value narrowed only to `object`.

### Changed

- **State root honours `CLAUDE_PLUGIN_DATA`.** Fresh installs store jobs under Claude Code's plugin data dir (`CLAUDE_PLUGIN_DATA/state/jobs/<repo-hash>/`), which is cleaned up with the plugin. Existing installs keep `~/.cursor-plugin-cc` — an existing legacy dir always wins so job history is never stranded. `CURSOR_PLUGIN_CC_HOME` still overrides everything. The `jobs/<repo-hash>/` layout is unchanged.
- **`composer-prompting` skill split into SKILL.md + `references/`** (progressive disclosure, mirroring codex's `gpt-5-4-prompting` layout). `SKILL.md` keeps the always-relevant spine (when to use, repo grounding, assembly checklist); the detail moved to `references/prompt-anatomy.md` (five sections + guardrails, now with a full worked example), `references/model-selection.md` (escalation ladder, chunking, resume-vs-fresh), and the new `references/composer-antipatterns.md` (six prompt shapes that reliably produce bad Composer runs, adapted from codex's anti-patterns).

### Fixed

- **`/cursor:cancel` no longer orphans the running `cursor-agent`.** Background jobs run as a detached worker (its own process group) that spawns `cursor-agent` as a child. Cancelling signalled only the worker pid, so the worker died but `cursor-agent` kept running — still editing files and consuming Cursor credits — while `/cursor:status` reported the job as `cancelled`. `cancelJob` now signals the worker's whole process group (SIGTERM, then SIGKILL after the grace period) via the new `lib/kill.mjs#killTree`, falling back to a single-pid kill for foreground jobs whose recorded pid is not a group leader. On Windows the tree is terminated with `taskkill /T /F`.

## 0.4.0 — /cursor:adversarial-review + estimate-first reviews + composer-prompting skill

Ported from upstream [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) (whose `/codex:adversarial-review`, estimate-first review flow, and `gpt-5-4-prompting` skill this release mirrors), adapted to the Cursor CLI.

### Added

- **`/cursor:adversarial-review`** — a first-class steerable review command that challenges the chosen implementation and design (assumptions, tradeoffs, failure modes, whether a different approach would be simpler or safer), not just implementation defects. It reuses the existing review runtime (`scripts/review.mjs --adversarial`), so it supports `--base <ref>`, `--scope`, `--model`, `--wait`/`--background`, and free-form focus text, and is tracked as a normal job (`/cursor:status`, `/cursor:result`, `/cursor:cancel` all apply). Promotes what used to be only the `--adversarial` flag on `/cursor:review` into a discoverable command with sharper framing.
- **`composer-prompting` skill** — the Cursor/Composer prompt-shaping guidance (repo grounding, the five-section prompt anatomy + guardrails, chunking heuristics, model selection, resume-vs-fresh) now lives in `plugins/cursor/skills/composer-prompting/SKILL.md`. The `cursor-runner` subagent references it via a new `skills:` frontmatter entry instead of restating the mechanics inline, and the main thread can consult it when hand-crafting `/cursor:delegate` prompts. Mirrors codex's internal `gpt-5-4-prompting` skill.

### Changed

- **`/cursor:review` and `/cursor:adversarial-review` estimate the diff before running.** When neither `--wait` nor `--background` is passed, the command inspects `git status` / `git diff --shortstat` to gauge review size, then asks once (via `AskUserQuestion`) whether to wait or run in the background — recommending background for anything beyond a tiny 1–2 file change. Explicit `--wait` / `--background` skip the question. The commands moved from an auto-executing one-liner wrapper to a model-orchestrated flow; their `allowed-tools` now include `Bash(git:*)` and `AskUserQuestion` for the estimate step. Background runs still use the plugin's own detached worker (the script returns a job id immediately), not a Claude background task.
- **`cursor-runner` subagent slimmed** — the prompt-anatomy, chunking, model, and resume/fresh sections were extracted into the `composer-prompting` skill; the agent now points at the skill and keeps only its operational spine (ground → invoke `/cursor:delegate` → return verbatim) and guardrails.

## 0.3.2 — clearer "job not found" hint

### Fixed

- **`/cursor:status`, `/cursor:result`, `/cursor:cancel` now explain a missing job id** (#7). When `/cursor:delegate` runs as a Claude Code background command, Claude Code surfaces _its own_ wrapper id (`Command running in background with ID: …`), not the Cursor job id — so `/cursor:status <that-id>` always missed with a bare `No job … found`. The three commands now append a hint pointing out that a Claude Code background id is not the Cursor job id and that `/cursor:status` with no arguments lists the tracked jobs so the real id can be copied. New shared `lib/hints.mjs#jobNotFoundMessage`.

## 0.3.1 — model alias refresh (Composer 2.5 + Grok 4.3)

### Fixed

- **Model aliases updated for Composer 2.5.** Cursor retired the Composer 2.x ids — `cursor-agent --list-models` now lists only `composer-2.5` and `composer-2.5-fast` (verified on macOS, 2026-06-10). The `composer`, `composer-fast`, and `fast` shortcuts now resolve to `composer-2.5-fast` (was the dead `composer-2-fast`), and `composer-full` resolves to `composer-2.5` (was `composer-2`). The retired `composer-2` / `composer-2-fast` ids are kept as identity passthroughs so users on older `cursor-agent` builds aren't broken. README, the `cursor-runner` agent guidance, command/package descriptions, and tests updated to match. (#8)
- **`cursor-runner` agent invocation corrected.** Step 6 told the subagent to run `node_modules/.bin/tsx …/plugins/cursor/scripts/delegate.ts` — stale from before the zero-deps `.mjs` rewrite: `tsx` is not a dependency, there is no `.ts` file, and the path double-counted `plugins/cursor`. It now matches the working slash command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/delegate.mjs" -- …`. The `/cursor:delegate` slash command was already correct; only the subagent's documented call was broken. (#10)
- **`grok` alias retargeted to Grok 4.3.** `grok-4-20` and `grok-4-20-thinking` are also retired — `cursor-agent --list-models` now lists `grok-4.3` and `grok-build-0.1` (verified 2026-06-11). The `grok` shortcut resolves to `grok-4.3`, a new `grok-build` shortcut resolves to `grok-build-0.1`, and the `grok-thinking` alias is removed (no live thinking variant; the retired `grok-4-20` id still forwards as-is for older builds). README table and tests updated.

## 0.3.0 — /cursor:review + codebase hardening

### Added

- **`/cursor:review`** — read-only code review of your git diff by a Cursor model, modelled on `openai/codex-plugin-cc`'s `/codex:review`. The plugin collects the diff itself (working tree, or branch vs a `--base <ref>`), embeds it in a strict review-only prompt, runs `cursor-agent` over it, and returns the findings (Blocking / Should-fix / Nits + verdict) verbatim. Supports `--scope auto|working-tree|branch`, `--adversarial` (challenge the design), `--model`, `--background`/`--wait`, `--timeout`, and free-form focus text. Tracked as a normal job, so `/cursor:status`, `/cursor:result`, and `/cursor:cancel` apply. A post-flight check marks the job `failed` if the run touches the working tree, so a review can never silently become an edit. New `collectReviewContext` helpers in `scripts/lib/git.mjs`.

### Fixed

A full multi-agent review of the codebase (dogfooding `/cursor:review`) surfaced a batch of robustness issues, now fixed:

- **`delegate.mjs`** — a numeric `--resume=<id>` no longer crashes with `resume.trim is not a function` (the parser auto-cast it to a number). `--wait` is now a real toggle (forces the foreground even with `--background`). The background worker receives the prompt verbatim via env instead of re-collapsing it (which mangled quotes/backslashes), and its capture logs now land in the correct `jobs/<repo-hash>/` dir. A timed-out/watchdog-killed run is reported as `failed` with a note.
- **`cursor.mjs`** — `runHeadless` no longer crashes the process when the child fails to spawn (missing/non-executable binary) or when the log stream errors (ENOSPC/EACCES); both are handled and the run degrades gracefully. The post-result kill watchdog arms at most once. `CURSOR_AGENT_BIN` is trimmed before use.
- **`git.mjs`** — review of a repo with no commits now diffs against the empty-tree object instead of silently showing nothing; the working-tree status is collected once on the common path.
- **`paths.mjs`** — `repoHash` canonicalises the path the same way whether or not it exists, so a repo maps to a single jobs dir (fixes the macOS `/tmp`→`/private/tmp` split and a possible throw).
- **`parse.mjs`** — text extraction now flattens Anthropic `content[]` arrays, so output is captured even when a run is killed before the final `result` event.
- **`plan.mjs`** — `resolvePlanPath` rejects directories (was crashing with EISDIR); `## ` headings inside fenced code blocks are no longer mistaken for section headings; specific section hints (e.g. "files to touch") now beat generic ones ("files") regardless of document order.
- **`jobs.mjs`** — `atomicWrite` cleans up its temp file on a failed rename; a cancelled job is not resurrected to `done`/`failed` by a finishing background worker.
- **`args.mjs`** — `--no-foo=value` keeps its explicit value; backslashes inside single quotes and a trailing lone backslash are preserved (POSIX); integers beyond `MAX_SAFE_INTEGER` stay strings instead of losing precision. New shared `parseTimeout` (a non-numeric `--timeout` no longer silently disables the watchdog), `collapseCommandArgv`, and `parseCommandArgv` helpers de-duplicate the per-command argv prologue.
- **`browser.mjs`** — drops the never-honored `--background` flag; the MCP-usage gate matches `chrome-devtools` specifically instead of any `mcp_*`; killed runs are flagged.
- **`status.mjs` / `sessions.mjs`** — Markdown table cells escape `|` and tolerate records missing `prompt`/`model` (one bad record no longer aborts the whole listing) via the new `lib/md.mjs` helper.
- **`result.mjs`** — coerces non-string `summary`/`prompt`/`model` from a corrupted record instead of throwing.
- **`setup.mjs`** — `--doctor`'s "all checks passed" no longer masks a real failure whose detail happens to contain "not set".
- **`cancel.mjs`** — distinguishes a real cancellation from a no-op on an already-finished job.
- **`id.mjs`** — keeps the full base64url alphabet (filesystem-safe) instead of stripping then zero-padding, which shortened ids and biased the final character.

## 0.2.2 — resume bug fix + safer default model

### Fixed

- **`/cursor:resume <prompt…>`** no longer eats the first prompt word as a chat-id. `--resume` was missing from the boolean-flag whitelist, so the argv parser greedily consumed the next positional token (`Cursor chat id: řekni — resume with cursor-agent --resume=řekni`). Declared `resume` as boolean in `delegate.mjs`; `--resume=<chat-id>` still works because the `=` form is parsed independently. Regression tests cover both shapes plus a multi-word non-ASCII prompt.

### Changed

- **Default model is now `auto`** (was `composer-2-fast`). Users without a paid Composer 2 seat can run the plugin out of the box; Cursor picks whatever model the account is entitled to. Power users can pin a default globally via the new `CURSOR_PLUGIN_CC_DEFAULT_MODEL` env var (accepts the same aliases as `--model`), or per-invocation via `--model <id>`.
- README install section moved up front; GitHub install marked as preferred, local checkout install moved below it for hacking on the plugin. Requirements list now lives under Install and no longer implies a paid subscription is mandatory.

## 0.2.1 — OSS ergonomics (docs-only)

### Added

- `AGENTS.md` at repo root — hard rules any AI agent (Claude Code, Cursor, Codex) must follow when editing this repo. Dogfoods the same pattern `cursor-runner` tells agents to read in target repos.
- `CONTRIBUTING.md` — dev setup, branch naming, commit-message conventions, step-by-step recipe for adding a new slash command, and the release flow.
- `SECURITY.md` — vulnerability reporting, the `--force`/`--trust` trade-offs the user should understand, and the zero-deps supply-chain stance.
- `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml` — structured forms that capture Node / cursor-agent / plugin version, `/cursor:setup --doctor` output and job id up-front.
- `.github/PULL_REQUEST_TEMPLATE.md` — summary + test plan + zero-deps checklist.
- README: new **Troubleshooting** section covering the six failure modes that tripped us during development (reload-plugins, shell globbing, module-not-found, Bash permission, browser MCP not loaded, from-plan empty).

### Changed

- README "Contributing" shrunk to a pointer toward the new dedicated files so the homepage stays scannable.

## 0.2.0 — plan-mode bridge + zero-deps rewrite

### Added

- **`/cursor:from-plan`** — new command that turns a Claude Code plan file (`~/.claude/plans/<slug>.md`) into a Cursor-shaped task file under `tasks/<YYYYMMDD-HHmm>-<slug>.md` and optionally auto-invokes `/cursor:delegate` with it. Bridges Claude's plan mode directly into the Cursor execution flow. `--list` lists recent plans; `--delegate` / `--yes` skips the preview step.

### Changed

- Rewrote the plugin as **zero-dependency `.mjs`** (no TypeScript, no runtime packages). Sources under `scripts/` are what ships — Claude Code executes them directly after `/plugin install`, no build step, no cache-time `npm install`. Matches the `openai/codex-plugin-cc` shape. `execa`/`zod`/`nanoid`/`yargs-parser` are gone; replaced by `scripts/lib/run.mjs`, `scripts/lib/id.mjs`, `scripts/lib/args.mjs` and plain JSON handling.
- Slash-command bodies now invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/<cmd>.mjs"` (was `dist/<cmd>.js`).
- Robust entry-point detection (`lib/invoked.mjs`) — `realpathSync` on both sides, fixes a silent no-op when the plugin was executed through a symlinked path (e.g. macOS `/tmp → /private/tmp`).

### Planned

- Support additional browser-automation MCPs (next target: Mozilla [firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp)). `/cursor:browser` will grow a `--mcp <name>` flag and autodiscover from `cursor-agent mcp list`.
- Repo-local `.cursor-plugin-cc.json` for per-project default model / timeout / MCP preference.
- `/cursor:task new "<slug>"`, `/cursor:diff [job-id]`, `/cursor:retry [job-id]` — quality-of-life commands.

## 0.1.0 — initial release

### Added

- `/cursor:delegate` — hand a coding task to `cursor-agent`, with background and resume support. Default model is `composer-2-fast` (Cursor's own current default, fastest Composer variant).
- `/cursor:browser <url> <what to verify>` — read-only browser verification via Cursor's `chrome-devtools` MCP. Pre-checks MCP availability, bakes in `--approve-mcps`, scripts the standard `list_pages → navigate → take_snapshot → interact → wait_for → console/network` flow.
- `/cursor:status` — list or inspect tracked jobs for the current repository.
- `/cursor:result` — fetch the final output of a completed job.
- `/cursor:cancel` — cancel an active job (SIGTERM → SIGKILL after 5 s).
- `/cursor:resume` — shortcut for `/cursor:delegate --resume`.
- `/cursor:sessions` — list Cursor's own chat sessions via `cursor-agent ls`.
- `/cursor:setup` — health-check, model listing, configured-MCP listing, and optional installer.
- `cursor-runner` subagent for automated task delegation.
- File-backed job registry under `~/.cursor-plugin-cc/jobs/<repo-hash>/`.
