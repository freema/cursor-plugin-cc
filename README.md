# cursor-plugin-cc

> Use Cursor CLI from Claude Code to delegate coding tasks to Composer 2 and other Cursor models.

[![CI](https://github.com/freema/cursor-plugin-cc/actions/workflows/ci.yml/badge.svg)](https://github.com/freema/cursor-plugin-cc/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%E2%89%A5%2018.18-43853d.svg)](https://nodejs.org)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-7c3aed.svg)](https://claude.com/claude-code)
[![Cursor CLI](https://img.shields.io/badge/Cursor-cursor--agent-000000.svg)](https://cursor.com)

A [Claude Code](https://claude.com/claude-code) plugin that hands off coding tasks from Claude to the Cursor CLI (`cursor-agent`). Claude stays the planner and reviewer; Cursor is the fast executor — `composer-2-fast` by default (Cursor's own current default, and the fastest Composer variant), in force/yolo mode, optionally in the background.

## What you get

Eight slash commands under the `cursor:` namespace:

- **`/cursor:delegate`** — hand a coding task to Cursor, foreground or background.
- **`/cursor:browser`** — verify a URL / flow in a real browser via Cursor's `chrome-devtools` MCP.
- **`/cursor:status`** — list recent jobs or inspect a specific one.
- **`/cursor:result`** — print the final output of a finished job.
- **`/cursor:cancel`** — terminate a running job (SIGTERM, then SIGKILL after 5 s).
- **`/cursor:resume`** — continue the previous Cursor chat with a follow-up.
- **`/cursor:sessions`** — list Cursor's own chat sessions for this repo.
- **`/cursor:setup`** — health-check the CLI, list models + configured MCPs, or guide installation.

Plus a `cursor-runner` subagent you can invoke from inside Claude to delegate well-scoped tasks automatically.

## Why this plugin

Short answer: **Composer 2 is genuinely good at most day-to-day coding work** — and I don't want a pile of terminal windows to drive it. I want Claude Code to be the orchestrator for everything. The flow that keeps working for me is simple: **Claude makes the plan, Composer executes it, Claude reviews the diff.** Two tools, each doing what it is best at.

"Why not do the whole thing inside Cursor, then?" Claude Code has a certain magic, particularly around planning. It is not purely about the underlying model — it is the whole rig (long-context sessions, subagents, the TUI, the way tools compose) that, in my experience, only really clicks inside Claude Code.

Cursor CLI has its own plan mode and it is fine, but execution is where Cursor really shines: file edits, applying diffs, crunching through a well-scoped task list in force mode. Cursor 2 and the Composer models are heavily tuned for exactly that CLI use-case. (The same is true of Codex and GPT on OpenAI's side, which is why [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) exists — and which is what I borrowed from heavily when building this plugin. Credit where due.)

So: Claude plans, Cursor writes, Claude reviews, repeat. Glued together by seven slash commands and one subagent.

## Why not just `/codex:review`-style?

This plugin is built around delegating _execution_ — writing code — to Cursor's Composer 2 for speed. Claude Code stays the orchestrator, planner, and reviewer. There is intentionally **no** `/cursor:review` or `/cursor:adversarial-review` command: Cursor is the "doer" here, not the critic. If you want review, ask Claude to review Cursor's diff in the usual way.

## Requirements

- Node.js **≥ 18.18**
- A Cursor subscription (Composer 2 is included in paid tiers)
- `cursor-agent` on your `PATH` — install via `curl https://cursor.com/install -fsS | bash`
- `cursor-agent login` completed at least once

## Install

Local, for immediate testing from this repository:

```
/plugin marketplace add /Users/you/path/to/cursor-plugin-cc
/plugin install cursor@tomas-cursor
/reload-plugins
/cursor:setup
```

From GitHub once published:

```
/plugin marketplace add freema/cursor-plugin-cc
/plugin install cursor@tomas-cursor
/reload-plugins
/cursor:setup
```

> ⚠️ **Do not skip `/reload-plugins`.** Right after `/plugin install` the `/cursor:*` commands are NOT yet available — Claude Code only picks them up after a plugin reload. If you see `Unknown command: /cursor:setup`, you forgot this step — run `/reload-plugins` and try again.

> ⚠️ **One-time `npm install`.** The plugin ships as TypeScript and runs via `tsx` — the Claude Code plugin loader does not run `npm install` for you. Inside the plugin directory run it once:
>
> ```bash
> cd plugins/cursor && npm install
> ```
>
> (When you installed from a local path as above, the path is simply your clone's `plugins/cursor`. When installed via `/plugin marketplace add freema/cursor-plugin-cc` from GitHub, Claude Code unpacks the repo under `~/.claude/plugins/cache/<id>/` — run `npm install` inside that cache's `plugins/cursor/`.)

The first `/cursor:setup` run tells you if `cursor-agent` is missing, unauthenticated, or if `node_modules` are not yet installed.

## Usage

### `/cursor:delegate <task...>`

Hand a coding task to `cursor-agent -p …`.

| Flag                   | Default                    | Effect                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--model <id>`         | `composer-2-fast`          | Aliases → real Cursor ids: `composer`/`fast` → `composer-2-fast`, `composer-2` → `composer-2`, `sonnet` → `claude-4.6-sonnet-medium`, `opus` → `claude-opus-4-7-high`, `gpt`/`codex` → `gpt-5.3-codex`, `grok` → `grok-4-20`, `gemini` → `gemini-3.1-pro`, `auto` → `auto`. Unknown ids forwarded as-is. Run `/cursor:setup --print-models` for the live list. |
| `--background`         | off                        | Detach; the command returns a job id immediately.                                                                                                                                                                                                                                                                                                              |
| `--wait`               | on (if not `--background`) | Block until finished.                                                                                                                                                                                                                                                                                                                                          |
| `--fresh`              | off                        | Start a brand-new Cursor session (no resume).                                                                                                                                                                                                                                                                                                                  |
| `--resume[=<chat-id>]` | off                        | Resume a prior chat. With no id, resume the latest for this repo.                                                                                                                                                                                                                                                                                              |
| `--no-force`           | `--force` is ON            | Disable auto-approve (paranoid mode).                                                                                                                                                                                                                                                                                                                          |
| `--cloud`              | off                        | Pass `-c` to cursor-agent.                                                                                                                                                                                                                                                                                                                                     |
| `--timeout <sec>`      | `1800`                     | Kill the job if it exceeds this.                                                                                                                                                                                                                                                                                                                               |
| `--no-git-check`       | off                        | Allow running outside a git repo.                                                                                                                                                                                                                                                                                                                              |

Examples:

```
/cursor:delegate add a dark-mode toggle to the settings page
/cursor:delegate --model composer "write jest tests for utils/date.ts"
/cursor:delegate --background --model auto "migrate user repository to Doctrine 3"
/cursor:delegate --resume "continue with the failing edge case"
```

### `/cursor:browser <url> <what to verify...>`

Verify a page or a flow in a **real browser** via Cursor's `chrome-devtools` MCP. This is read-only by design — Cursor navigates, interacts, checks console/network and reports back; it will not modify your source files.

```
/cursor:browser http://localhost:3000 "login flow works for valid and invalid credentials"
/cursor:browser http://localhost:5173 "dark-mode toggle persists across reloads"
/cursor:browser localhost:8080 "no console errors on the home page; no 4xx/5xx requests"
```

Under the hood: the command pre-checks that `chrome-devtools` is configured in `cursor-agent mcp list`, then invokes `cursor-agent -p --approve-mcps …` with a prompt that scripts the standard flow (`list_pages → navigate → take_snapshot → interact → wait_for → console/network checks → screenshot`). No flags to remember.

**Setup for this command** (one-time): add the MCP server to your Cursor MCP config, usually `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--isolated"]
    }
  }
}
```

Restart Cursor so `cursor-agent` picks up the new MCP. `--isolated` makes each run use a fresh Chrome profile, which sidesteps the common "profile already in use" lockout.

Verify with `/cursor:setup --doctor` — it now lists every MCP `cursor-agent` can see and whether each is loaded.

### `/cursor:status [job-id] [--all]`

Without args, shows the last 10 jobs for this repository as a table. With an id, shows the full job record including the Cursor chat id (so you can resume manually with `cursor-agent --resume=<id>`). Pass `--all` to drop the 10-row limit.

```
/cursor:status
/cursor:status V1StGXR8_Z
```

### `/cursor:result [job-id]`

Prints the final summary of a finished job. Defaults to the most recent one for this repo.

```
/cursor:result
/cursor:result V1StGXR8_Z
```

### `/cursor:cancel [job-id]`

Cancels a running job. With no id, cancels the single running job (errors if there are several).

```
/cursor:cancel
/cursor:cancel V1StGXR8_Z
```

### `/cursor:resume [task...]`

Shortcut for `/cursor:delegate --resume <task...>`. Without a task, sends an empty follow-up ("continue").

```
/cursor:resume "now wire it into the App shell"
/cursor:resume --resume=chat_abc123 "fix the failing test"
```

### `/cursor:sessions`

Shells out to `cursor-agent ls` and lists Cursor's own chat sessions for this repo. If that call times out or returns empty, the plugin falls back to its local job registry.

### `/cursor:setup [--doctor] [--print-models] [--install]`

Runs a quick health-check. `--doctor` produces extended diagnostics (Node version, PATH, `CURSOR_API_KEY` presence masked, jobs dir writability, cursor-agent version). `--print-models` shells out to `cursor-agent --list-models`. `--install` prints the install command but **does not run it** — you must copy-paste it yourself.

## The two-phase loop

This plugin is built around one pattern: **Claude plans and reviews, Cursor writes code.** Treat them as two separate roles, not one pipeline:

1. **Plan / spec** — Claude Code scopes the change, picks the slice to delegate, and drafts acceptance criteria. This is where architectural judgment happens.
2. **Execute** — `/cursor:delegate` (or the `cursor-runner` subagent) hands that spec to Cursor. Cursor writes files under `--force`, fast.
3. **Review** — Claude reads the diff Cursor produced. This is where correctness and style are checked.
4. **Iterate** — `/cursor:resume "fix X"` for the same thread, or `/cursor:delegate --fresh` for a new slice.

The plugin intentionally does not try to collapse these phases into one. Cursor is fast but context-starved; Claude has the whole session context but is slower per edit. Keeping them in separate phases is the whole point.

### Writing good prompts for Cursor

A good `/cursor:delegate` prompt has five sections:

1. **Goal** — one sentence.
2. **Repo context** — stack, and a pointer to whatever conventions file applies (`AGENTS.md`, `.cursor/rules`, `CLAUDE.md`).
3. **Acceptance criteria** — 1–5 verifiable bullets.
4. **Files to touch** — explicit list when you can predict it.
5. **How to verify** — the exact commands (`npm test`, `task typecheck`, …) that prove the task is done.

The `cursor-runner` subagent applies this template automatically. When you write `/cursor:delegate` by hand, aim for the same structure in the task string — it is the single biggest lever on Cursor's output quality.

### Chunking

`cursor-agent --force` will YOLO through whatever you give it. Keep slices small: **≤ 5 steps, ≤ 10 files, ≤ 2 architectural layers per `/cursor:delegate` call.** If the plan is bigger, split it — one slice per call — and let Claude review between slices.

### Language and target-repo conventions

The plugin codebase is English, but it does not impose a language policy on **your** repo. When the `cursor-runner` subagent prepares a prompt, it reads the target repo's `AGENTS.md` / `.cursor/rules` / existing code and tells Cursor to match that style — whether that means Czech commits, German UI strings, or anything else. Do not put "write everything in English" in your own prompts unless that is actually your repo's convention.

## Typical flows

**Fast parallel task.** You're in Claude Code. You want Cursor to handle something small while you keep working.

```
/cursor:delegate --background "write jest tests for src/utils/date.ts"
# keep talking to Claude
/cursor:result
```

**Tight loop.** Delegate in the foreground, let Claude review, then iterate.

```
/cursor:delegate "extract the retry logic from apiClient.ts into a hook"
# Claude reads the diff, suggests a fix
/cursor:resume "also add a unit test for the 429 path"
```

**Escalation.** Start small, upgrade if Cursor stalls.

```
/cursor:delegate --model composer "<task>"
# composer gave up — retry with opus from scratch
/cursor:delegate --model opus --fresh "<same task>"
```

**Resume vs fresh.** Use `--resume` (default) when the new task is the same thread of work. Use `--fresh` when the topic changed, or when the previous run went off the rails and resuming would just carry the confusion forward.

## Configuration

| Env var                 | Purpose                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `CURSOR_API_KEY`        | Forwarded to `cursor-agent`. Optional — `cursor-agent login` is usually enough. |
| `CURSOR_AGENT_BIN`      | Override binary path (used by the test suite).                                  |
| `CURSOR_PLUGIN_CC_HOME` | Override the jobs-registry root (default `~/.cursor-plugin-cc`).                |

A repo-local `.cursor-plugin-cc.json` is on the roadmap for overriding the default model per repo; until then, set `--model` per invocation.

## Moving work back to Cursor

Every finished job stores the Cursor `chat_id`. Read it from `/cursor:status <job-id>` or `/cursor:result`. Then, in any terminal:

```
cursor-agent --resume=<chat_id>
```

This re-opens the same Cursor session without going through Claude Code — handy when you want to finish something in Cursor's interactive UI.

## FAQ

**Does it need a special Node version?** Yes — ≥ 18.18. The CI matrix tests 18.18, 20, and 22 on Linux and macOS.

**Does it use my existing Cursor auth?** Yes. The plugin shells out to your already-installed `cursor-agent`, which uses whatever session `cursor-agent login` set up (or `CURSOR_API_KEY` if you prefer).

**Does it upload my code anywhere?** No — the plugin itself runs locally. `cursor-agent` of course sends your prompts to Cursor's backend; that is Cursor's normal behaviour, not something this plugin changes.

**What does `--force` do?** It is Cursor's auto-approve (aka `--yolo`). With it on, Cursor writes files without asking each time. This is necessary for non-interactive use but means Cursor can touch your working tree freely. Use `--no-force` if you want to test against an interactive flow — but note that most headless invocations will hang waiting for approval, so `--no-force` is really only useful for debugging.

**The model list doesn't match what I see in Cursor.** Run `/cursor:setup --print-models` — that shells out to `cursor-agent --list-models` and shows exactly what your account supports. The alias table in the plugin is a convenience; Cursor's actual model IDs drift over time.

**`cursor-agent` hangs after finishing a task.** Known quirk of the print-mode CLI. The plugin has a 5-second watchdog that SIGTERMs the process after a `result` event if it hasn't self-exited, then SIGKILLs 5 seconds later.

## Roadmap

Things that are **not** in 0.1.0 but on the list:

- **Additional browser MCPs** — right now `/cursor:browser` hard-codes `chrome-devtools` as the MCP name. Planned: a `--mcp <name>` flag plus autodiscovery so any DevTools-style MCP works. First follow-up target: Mozilla's [firefox-devtools-mcp](https://github.com/mozilla/firefox-devtools-mcp).
- **Per-repo defaults** — a `.cursor-plugin-cc.json` at repo root to override default model, timeout and MCP preference without re-typing flags.
- **npm publish** — once the API stabilises, ship a tarball so users can `/plugin install cursor@tomas-cursor` without a `cd plugins/cursor && npm install` step.

Contributions and ideas welcome.

## License

MIT — see [LICENSE](./LICENSE). See also [NOTICE](./NOTICE).
