## Summary

<!-- One paragraph: what changes, why. Link any issue this closes. -->

## Test plan

<!-- What you ran locally. Check what applies, add more lines if needed. -->

- [ ] `npm test` — all specs green
- [ ] `npm run lint` — prettier + eslint clean
- [ ] Smoke-tested affected commands locally (describe how)
- [ ] Docs updated (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `CHANGELOG.md`) when relevant
- [ ] New tests added for new behaviour (or N/A and justified)

## Checklist

- [ ] No new runtime dependencies (see `AGENTS.md`)
- [ ] No build step, no new `dist/` or `.ts` files
- [ ] `$ARGUMENTS` is quoted in any new / edited `commands/*.md`
- [ ] New slash command (if any) follows the recipe in `CONTRIBUTING.md`
- [ ] User-visible behaviour change is noted under `## Unreleased` in `CHANGELOG.md`
