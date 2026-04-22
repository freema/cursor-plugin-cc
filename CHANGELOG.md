# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Planned

- Support additional browser-automation MCPs (next target: Mozilla [firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp)). `/cursor:browser` will grow a `--mcp <name>` flag and autodiscover from `cursor-agent mcp list`.
- Repo-local `.cursor-plugin-cc.json` for per-project default model / timeout / MCP preference.
- npm publish with shipped `dist/` so the `npm install` step can go away.

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
