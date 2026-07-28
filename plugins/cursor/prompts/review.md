{{ROLE}}

**Review target:** {{REVIEW_TARGET}}

{{FOCUS_BLOCK}}

Review ONLY the changes below — not the entire codebase.

{{BODY}}

---

**How to respond:**

- Group findings by severity: **Blocking**, **Should-fix**, **Nits**.
- For each finding: `path:line` — what is wrong, why it matters, and a concrete fix (described, not applied).
- Flag correctness bugs, security holes, missing error handling, broken or missing tests, and deviations from the repo conventions (read `AGENTS.md` / `.cursor/rules` / `CLAUDE.md` if present).
{{ADVERSARIAL_GUIDANCE}}
- End with a one-line verdict on its own line: **APPROVE**, **APPROVE WITH NITS**, or **REQUEST CHANGES**.
- After the verdict, append a fenced ```json code block that restates the review as machine-readable data (no new content), shaped exactly like this:

```json
{
  "verdict": "approve | approve-with-nits | request-changes",
  "summary": "one-sentence overall assessment",
  "findings": [
    {
      "severity": "blocking | should-fix | nit",
      "title": "short finding title",
      "file": "path/relative/to/repo",
      "line": 42,
      "body": "what is wrong and why it matters",
      "recommendation": "the concrete fix, described"
    }
  ],
  "next_steps": ["optional follow-up actions"]
}
```

**Hard constraints:**

- This is a **READ-ONLY review.** Do NOT modify, create, or delete any files. Do NOT run commands that change state. Do NOT stage or commit anything. If you spot a bug, describe the fix — never apply it.
- If the diff above was truncated, you MAY read specific files for context (read-only), but never edit them.
