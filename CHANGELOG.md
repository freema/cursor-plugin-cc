# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Fixed

- **Model aliases updated for Composer 2.5.** Cursor retired the Composer 2.x ids — `cursor-agent --list-models` now lists only `composer-2.5` and `composer-2.5-fast` (verified on macOS, 2026-06-10). The `composer`, `composer-fast`, and `fast` shortcuts now resolve to `composer-2.5-fast` (was the dead `composer-2-fast`), and `composer-full` resolves to `composer-2.5` (was `composer-2`). The retired `composer-2` / `composer-2-fast` ids are kept as identity passthroughs so users on older `cursor-agent` builds aren't broken. README, the `cursor-runner` agent guidance, command/package descriptions, and tests updated to match. (#8)

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
