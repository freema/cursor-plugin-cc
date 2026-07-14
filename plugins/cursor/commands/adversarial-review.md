---
description: Steerable code review that challenges the design and approach, not just implementation defects. Read-only; never edits files.
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [--model <id>] [focus...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an **adversarial** Cursor review through the shared review runtime (`scripts/review.mjs --adversarial`).
Position it as a challenge review that questions the chosen implementation, design choices, tradeoffs, and assumptions — it is not just a stricter pass over implementation defects.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:

- This command is **review-only**.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return Cursor's output verbatim to the user.
- Keep the framing focused on whether the current approach is the right one, what assumptions it depends on, and where the design could fail under real-world load, concurrency, or edge cases.

Execution mode rules:

- If the raw arguments include `--wait`, do not ask. Run in the foreground.
- If the raw arguments include `--background`, do not ask. Run in the background.
- Otherwise, estimate the review size before asking:
  - For working-tree review, start with `git status --short --untracked-files=all`.
  - For working-tree review, also inspect both `git diff --shortstat --cached` and `git diff --shortstat`.
  - For base-branch review, use `git diff --shortstat <base>...HEAD`.
  - Treat untracked files or directories as reviewable work for auto or working-tree review even when `git diff --shortstat` is empty.
  - Only conclude there is nothing to review when the relevant scope is actually empty.
  - Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total and no sign of a broader directory-sized change.
  - In every other case, including unclear size, recommend background.
  - When in doubt, run the review instead of declaring that there is nothing to review.
- Then use `AskUserQuestion` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Argument handling:

- Preserve the user's arguments exactly.
- Do not strip `--wait` or `--background` yourself — pass them through untouched; the script reads them.
- Do not weaken the adversarial framing or rewrite the user's focus text.
- Uses the same review-target selection as `/cursor:review`: working-tree review, branch review, and `--base <ref>`.
- Unlike `/cursor:review`, it takes extra free-form focus text after the flags (e.g. "question the retry/backoff design").

Foreground flow:

- Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" --adversarial --wait -- "$ARGUMENTS"
```

- Return the command stdout verbatim, exactly as-is — it is a code review. Do not paraphrase, summarize, or add commentary before or after it.
- Do not fix any issues mentioned in the review output.

Background flow:

- Run the SAME command with `--background` instead of `--wait`, as a normal (foreground) `Bash` call — `review.mjs` detaches the worker itself and returns a job id immediately, so do **not** set `run_in_background`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/review.mjs" --adversarial --background -- "$ARGUMENTS"
```

- Present the returned job id and the `/cursor:status` / `/cursor:result` hints exactly as printed. Do not poll or wait for completion in this turn.
