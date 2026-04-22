# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
