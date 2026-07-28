# Model Selection, Chunking, and Resume Routing

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
