# Contributing to cursor-plugin-cc

Thanks for looking. This is a small plugin; contributions are welcome.

## Before you start

Read [`AGENTS.md`](./AGENTS.md) at the repo root — it spells out the hard rules (zero runtime deps, no build step, etc.). If your change would break one of them, open an issue first.

## Dev setup

```bash
git clone https://github.com/freema/cursor-plugin-cc
cd cursor-plugin-cc/plugins/cursor
npm install    # installs only dev deps: vitest, eslint, prettier, @eslint/js
npm test
npm run lint
```

No build, no bundler. `scripts/*.mjs` runs directly via `node`. If `node_modules/` needed in the install step surprised you, that is only for running tests and the formatter; the shipped plugin itself needs zero dependencies.

## Branch naming

- `feat/<slug>` — new user-visible feature or command.
- `fix/<slug>` — bug fix.
- `refactor/<slug>` — internal reshape, no user impact.
- `docs/<slug>` — docs only.
- `ci/<slug>` — CI or tooling.

Keep branches focused. One feature or fix per PR.

## Commit messages

Conventional-commits style:

```
feat(browser): auto-discover localhost port from vite.config
fix(delegate): quote $ARGUMENTS so zsh doesn't glob ?
refactor: drop esbuild, ship .mjs directly
docs(readme): add troubleshooting section
```

One short subject line, imperative mood, optional body explaining the **why**.

## PR process

1. Push your branch.
2. Open a PR against `main`. The PR template asks for a summary and a test plan — fill both.
3. CI runs the test matrix (Node 18.18 / 20 / 22 × Ubuntu / macOS). All six must pass.
4. The maintainer reviews, suggests changes, or merges. **Squash merge** is the default.
5. No direct pushes to `main` — branch protection enforces PR review.

## How to add a new slash command

The plugin has a consistent recipe. Follow it exactly for any new command — reviewers will bounce anything that deviates without explanation.

### Checklist

1. **Pick a name.** Keep it short and under the `cursor:` namespace (e.g. `/cursor:diff`, `/cursor:retry`). Verbs preferred.
2. **Write `plugins/cursor/scripts/<cmd>.mjs`.**
   - Starts with `#!/usr/bin/env node`.
   - Imports `parseArgv`, `collapseArguments` from `./lib/args.mjs`.
   - Exports `async function main(rawArgv): Promise<number>` returning the exit code.
   - Uses `invokedAsScript(import.meta.url)` from `./lib/invoked.mjs` for the "am I the entry point?" guard.
   - Writes **structured Markdown** to stdout so Claude Code renders it. Stick to bullet lists, tables, and fenced code blocks — nothing Claude has to paraphrase.
   - Writes errors to stderr; return code 2 for bad input, 1 for runtime failure, 0 for success.
3. **Write `plugins/cursor/commands/<cmd>.md`.**
   - Frontmatter: `description`, `argument-hint`, `allowed-tools: Bash(node:*)`.
   - Body: `!` + a single line `` `node "${CLAUDE_PLUGIN_ROOT}/scripts/<cmd>.mjs" -- "$ARGUMENTS"` `` (quotes around `$ARGUMENTS` are mandatory — zsh will glob otherwise).
   - Add a one-paragraph note telling Claude Code how to render the output (usually "verbatim, do not paraphrase").
4. **Write `plugins/cursor/tests/<cmd>.test.mjs`.**
   - Import `main` from `../scripts/<cmd>.mjs`.
   - Use the stub `cursor-agent` binary (`tests/fixtures/cursor-agent-stub.mjs`) via `CURSOR_AGENT_BIN` env and a fixture NDJSON.
   - Spy on `process.stdout.write` and `process.stderr.write` to assert output without polluting the test runner.
   - Cover: happy path, bad input (exit 2), empty env (graceful degradation).
5. **Update `plugins/cursor/package.json`'s `scripts`** with a `"<cmd>": "node scripts/<cmd>.mjs"` alias so maintainers can run it via `npm run <cmd>`.
6. **Update the README:**
   - Add it to the "What you get" bullet list at the top.
   - Add a `### /cursor:<cmd>` subsection under **Usage** explaining flags + 2 example invocations.
7. **Update `CHANGELOG.md`** under the `## Unreleased` → `### Added` section.

### Don'ts

- **Don't add runtime deps.** If the command needs behaviour you would normally pull a library for, write 30 lines in `lib/` instead. See `lib/run.mjs` (execa replacement) and `lib/args.mjs` (yargs-parser replacement) for the shape.
- **Don't introduce `dist/`, `build.mjs`, or any TypeScript file.** The source IS the ship artefact.
- **Don't bypass `lib/run.mjs`.** Every external command invocation goes through it so timeouts and exit-code handling stay consistent.
- **Don't hardcode `~` or `os.homedir()` directly.** Use `lib/paths.mjs` — it honours the `CURSOR_PLUGIN_CC_HOME` env override (test suites rely on this).

## Running against real cursor-agent

Tests use a stub binary that replays NDJSON fixtures. To smoke-test against the real CLI:

```bash
CURSOR_AGENT_BIN=/path/to/cursor-agent node plugins/cursor/scripts/setup.mjs --doctor
node plugins/cursor/scripts/delegate.mjs --no-git-check -- "write a short haiku about git"
```

This spends real Cursor tokens, so keep it to trivial tasks during development.

## Reporting bugs

Use the GitHub issue template. Include:

- `node --version`, `cursor-agent --version`
- Output of `/cursor:setup --doctor`
- For `/cursor:delegate` or `/cursor:browser` failures: the job id from `/cursor:status` and the path of the raw log under `~/.cursor-plugin-cc/jobs/<hash>/logs/<id>.ndjson`.

## Release flow

Maintainer-only, reference:

1. Ensure `CHANGELOG.md` has a `## x.y.z — …` section with Added/Changed/Fixed bullets moved out of `## Unreleased`.
2. Bump `version` in `plugins/cursor/package.json` and `plugins/cursor/plugin.json` to match.
3. Merge a `release/x.y.z` branch to `main` via PR.
4. `git tag -a vX.Y.Z -m "vX.Y.Z — headline"` + `git push origin vX.Y.Z`.
5. `gh release create vX.Y.Z --title "vX.Y.Z — headline" --notes-file <release-notes.md>`.

No automated publish pipeline yet — by design, see roadmap.
