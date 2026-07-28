# Composer Prompt Anti-Patterns

Prompt shapes that reliably produce bad Composer runs, each with the fix. Adapted for Composer from `openai/codex-plugin-cc`'s prompt anti-patterns; the failure modes are the same, the fixes use the five-section anatomy.

## Vague goal

Bad:

```text
Improve the error handling in the API layer.
```

"Improve" has no end state — Composer will pick one for you, everywhere it can reach. Better: name the concrete outcome and the boundary.

```text
# Goal
Wrap the three fetch calls in src/api/client.ts in try/catch and surface failures as ApiError with the upstream status code. Nothing outside client.ts.
```

## Missing verify commands

Bad: a prompt that ends at acceptance criteria. Composer declares "done" on unverified work — the run reports success and the tests were never executed. Always end with **How to verify** listing exact commands (`npm test`, `task typecheck`). If you don't know the commands, that's a grounding failure — go read `package.json` first.

## Kitchen-sink run

Bad:

```text
Fix the failing login test, and while you're there update the README and clean up the unused imports.
```

Three unrelated jobs → one muddy diff you can't review or revert independently. One `/cursor:delegate` per coherent slice; queue the rest.

## Prose instead of a file list

Bad:

```text
You'll probably need to touch the router and maybe the middleware.
```

"Probably/maybe" reads as permission to wander. Either name the files (**Files to touch** section) or state explicitly that discovery is part of the task and bound it: "locate the middleware that sets the session cookie; modify only that file."

## Re-explaining instead of re-scoping

When a run goes wrong, the instinct is to resume with a longer explanation of what you meant. If the prompt was structurally bad (vague goal, no verify, no file list), a longer version of it is still bad. Rewrite the prompt with the five sections and start `--fresh` — carrying a confused session forward compounds the confusion.

## Asking Composer to make design decisions

Bad:

```text
Add caching to the product endpoint — whatever approach you think is best.
```

Design decisions belong to the Claude thread (or the user), not the executor. Decide the approach first ("in-memory LRU, max 500 entries, 60 s TTL"), then delegate the implementation. If you can't specify the approach, the task isn't ready to delegate.
