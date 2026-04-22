# Security policy

## Reporting a vulnerability

If you find a security issue — credential leak, command injection, path traversal, anything that lets a malicious input do something the user did not intend — please **do not open a public issue**.

Report privately via [GitHub Security Advisories](https://github.com/freema/cursor-plugin-cc/security/advisories/new) or by email to `tomas.grasl@metrifyr.cloud`. Expect a response within a week. Once a fix is merged we will publish an advisory with credit (unless you prefer anonymity).

## Supported versions

Only the latest tagged release on `main` is supported. Run `/cursor:setup --doctor` to see what you have; upgrade via `/plugin marketplace remove tomas-cursor && /plugin marketplace add freema/cursor-plugin-cc && /plugin install cursor@tomas-cursor && /reload-plugins`.

## Known trade-offs the user should understand

- **`--force` is on by default.** Every `/cursor:delegate` invocation passes `--force` (alias `--yolo`) to `cursor-agent`. That means Cursor will auto-apply file writes and run commands without prompting for each one. This is necessary for non-interactive use but it also means a poorly-scoped task can touch files outside what you intended. Use `--no-force` when running against code you do not fully control.
- **`--trust` is always on.** Required by `cursor-agent` in headless mode to bypass the workspace-trust prompt. Do not point the plugin at repositories you do not already trust.
- **`--approve-mcps` is set on `/cursor:browser`.** MCP servers configured in your `~/.cursor/mcp.json` get loaded automatically for that command. Only configure MCPs you trust.
- **Cursor's backend receives your prompts and repo context.** The plugin is a thin wrapper around `cursor-agent`. All data-handling commitments are Cursor's, not this plugin's.
- **Job logs under `~/.cursor-plugin-cc/jobs/<repo-hash>/` contain the full `cursor-agent` stream-json output.** That may include snippets of your source code or environment metadata. Treat the directory as sensitive; we do not upload it anywhere, but local access controls are your responsibility.

## Non-goals

This plugin is not a sandbox. If you need stronger isolation, use `cursor-agent --sandbox enabled` manually (we expose it via a flag in a future release — see Roadmap) or run the whole thing in a container.

## Supply-chain stance

- **Zero runtime dependencies.** `/plugin install` unpacks only what git ships — no `npm install` runs in the user's plugin cache. This is a deliberate choice to keep the supply-chain surface at zero (see `AGENTS.md`).
- Dev dependencies (`vitest`, `eslint`, `prettier`, `@eslint/js`) run only on the maintainer's machine and in CI. They are pinned in `plugins/cursor/package-lock.json` and upgraded manually, not by Dependabot.
- No `postinstall` scripts, no `prepare` hook, no `preinstall` — nothing runs when the plugin is installed into a user's Claude Code cache.
