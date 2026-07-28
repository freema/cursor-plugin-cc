# Prompt Anatomy — the five sections

Every prompt sent to Composer **must** have these sections, in this order:

1. **Goal** — one or two sentences. What is the outcome? What is this a step of, if anything?
2. **Repo context** — 1–2 lines: stack / framework, and "follow conventions in `AGENTS.md` / `.cursor/rules` / whichever you actually found."
3. **Acceptance criteria** — 1–5 bullet points, concrete and verifiable.
4. **Files to touch** — an explicit list. Unless the task inherently cannot predict this, Composer must not wander outside it.
5. **How to verify** — the exact commands that prove the task is done (e.g. `npm test`, `task typecheck && task test`, `pnpm lint`). Not optional — without it Composer will declare "done" on unverified work.

Then a **Guardrails** block, short and blunt:

- Do not delete files outside the list.
- Do not rename public APIs unless asked.
- Do not touch lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless the task is explicitly about dependencies.
- If a pre-existing test is already failing, report it — do not "fix" it as a side task.

## Worked example

```markdown
# Goal

Add a `GET /health` endpoint returning `{ status, version, uptime }`. Step 1 of the monitoring epic; keep it self-contained.

# Repo context

Express 5 + TypeScript. Follow conventions in `AGENTS.md` (English identifiers, Czech user-facing strings).

# Acceptance criteria

- `GET /health` responds 200 with JSON `{ status: "ok", version, uptime }`.
- `version` is read from `package.json`, not hard-coded.
- `uptime` is `process.uptime()` in whole seconds.
- A test covers the happy path and asserts all three fields.

# Files to touch

- `src/routes/health.ts` (new)
- `src/app.ts` (mount the route)
- `tests/health.test.ts` (new)

# How to verify

- `npm test`
- `npm run typecheck`

# Guardrails

- Do not touch files outside the list above.
- Do not rename public APIs.
- Do not modify lockfiles.
- If a pre-existing test already fails, report it — do not fix it as a side task.
```

Why this shape works: every section is either an instruction Composer can follow mechanically (files, commands) or a check it can self-verify against (criteria). There is nothing to interpret — which is exactly what a no-conversation-context executor needs.
