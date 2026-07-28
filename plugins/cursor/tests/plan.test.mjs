import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTaskContent,
  listPlans,
  parsePlanFile,
  resolvePlanPath,
  slugify,
  splitSections,
} from '../scripts/lib/plan.mjs';
import { makeTempHome } from './helpers.mjs';

const SAMPLE = `# Refactor: zero-deps + .mjs (match codex-plugin-cc pattern)

## Context

Plugin works but has four runtime deps and a build step. User wants the
codex shape.

## Approach

Drop TypeScript. Replace deps. No build.

## File-by-file change list

- plugins/cursor/scripts/delegate.ts → delegate.mjs
- plugins/cursor/scripts/lib/jobs.ts → jobs.mjs

## Verification

1. \`npm test\` → 43/43 green.
2. \`/cursor:setup --doctor\` prints OK.

## Effort / risks

~90 minutes. Risk: hand-rolled arg parser edge cases.
`;

describe('splitSections', () => {
  it('pulls the title and each ## block', () => {
    const { title, sections } = splitSections(SAMPLE);
    expect(title).toBe('Refactor: zero-deps + .mjs (match codex-plugin-cc pattern)');
    expect(Object.keys(sections)).toEqual(
      expect.arrayContaining([
        'context',
        'approach',
        'file-by-file change list',
        'verification',
        'effort / risks',
      ]),
    );
    expect(sections['context']).toContain('build step');
    expect(sections['verification']).toContain('npm test');
  });
});

describe('slugify', () => {
  it('kebabs lowercase, drops punctuation', () => {
    expect(slugify('Refactor: zero-deps + .mjs')).toBe('refactor-zero-deps-mjs');
    expect(slugify('')).toBe('plan');
    expect(slugify('ahoj prosím projdi @tasks/30-i18n.md je to ok?')).toMatch(/^[a-z0-9-]+$/);
  });

  it('truncates to 50 chars', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(50);
  });
});

describe('buildTaskContent', () => {
  it('includes all five task sections, dropping dev commentary', () => {
    const plan = {
      path: '/tmp/plan.md',
      title: 'Refactor X',
      slug: 'refactor-x',
      sections: splitSections(SAMPLE).sections,
      raw: SAMPLE,
    };
    const out = buildTaskContent(plan);
    expect(out).toContain('# Refactor X');
    expect(out).toContain('## Goal');
    expect(out).toContain('## Repo context');
    expect(out).toContain('## Acceptance criteria');
    expect(out).toContain('## Files to touch');
    expect(out).toContain('## How to verify');
    expect(out).toContain('## Constraints');
    expect(out).toContain('> Generated from Claude Code plan: `/tmp/plan.md`');
    // Dev-only sections should NOT be copied across.
    expect(out).not.toContain('Effort / risks');
  });

  it('degrades gracefully when sections are missing', () => {
    const plan = {
      path: '/tmp/bare.md',
      title: 'Bare plan',
      slug: 'bare-plan',
      sections: { context: 'just this.' },
      raw: '# Bare plan\n\n## Context\n\njust this.\n',
    };
    const out = buildTaskContent(plan);
    expect(out).toContain('Bare plan');
    expect(out).toContain('just this.');
    expect(out).toContain('(no Approach');
  });

  it('passes an unrecognised plan shape through verbatim instead of placeholders', () => {
    const raw = [
      '# Externí spec',
      '',
      '## Etapa 1',
      '',
      'Přidat endpoint /health.',
      '',
      '## Poznámky',
      '',
      'Držet se stylu okolního kódu.',
      '',
    ].join('\n');
    const plan = {
      path: '/tmp/external-spec.md',
      title: 'Externí spec',
      slug: 'externi-spec',
      sections: splitSections(raw).sections,
      raw,
    };
    const out = buildTaskContent(plan);
    // The whole body survives…
    expect(out).toContain('Přidat endpoint /health.');
    expect(out).toContain('Držet se stylu okolního kódu.');
    expect(out).toContain('follow it as written');
    // …and no placeholder skeleton is emitted.
    expect(out).not.toContain('(no Context section');
    expect(out).not.toContain('(no Approach');
    // Guardrails still apply.
    expect(out).toContain('## Constraints');
    // The leading H1 is not duplicated.
    expect(out.match(/# Externí spec/g)).toHaveLength(1);
  });

  it('maps common spec-driven headings onto the task sections', () => {
    const raw = [
      '# Spec-shaped plan',
      '',
      '## Overview',
      '',
      'Why we do this.',
      '',
      '## Requirements',
      '',
      '- must do X',
      '',
      '## Testing',
      '',
      '- run `npm test`',
      '',
    ].join('\n');
    const plan = {
      path: '/tmp/spec.md',
      title: 'Spec-shaped plan',
      slug: 'spec-shaped-plan',
      sections: splitSections(raw).sections,
      raw,
    };
    const out = buildTaskContent(plan);
    expect(out).toContain('Why we do this.');
    expect(out).toContain('- must do X');
    expect(out).toContain('- run `npm test`');
    expect(out).not.toContain('(no Context section');
    expect(out).not.toContain('(no Approach');
  });
});

describe('resolvePlanPath + parsePlanFile against a temp plans dir', () => {
  let tmp;
  let plansDir;
  const prevHome = process.env.HOME;

  beforeEach(() => {
    tmp = makeTempHome();
    plansDir = join(tmp.dir, '.claude', 'plans');
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, 'old-one.md'), '# Old\n\n## Context\n\nolder.', 'utf8');
    // Bump mtime apart so ordering is deterministic.
    const newPath = join(plansDir, 'brand-new-plan.md');
    writeFileSync(newPath, SAMPLE, 'utf8');
    const future = new Date(Date.now() + 5_000);
    utimesSync(newPath, future, future);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    tmp.cleanup();
  });

  it('listPlans orders newest first', () => {
    const plans = listPlans(plansDir);
    expect(plans[0].name).toBe('brand-new-plan.md');
  });

  it('resolvePlanPath matches by name fragment', () => {
    expect(resolvePlanPath('old', plansDir)).toContain('old-one.md');
    expect(resolvePlanPath('brand', plansDir)).toContain('brand-new-plan.md');
    expect(resolvePlanPath('does-not-exist', plansDir)).toBeUndefined();
  });

  it('resolvePlanPath picks the newest when ref is undefined', () => {
    expect(resolvePlanPath(undefined, plansDir)).toContain('brand-new-plan.md');
  });

  it('parsePlanFile returns title + sections', () => {
    const parsed = parsePlanFile(join(plansDir, 'brand-new-plan.md'));
    expect(parsed.title).toContain('Refactor');
    expect(parsed.slug).toMatch(/^refactor-/);
    expect(parsed.sections['context']).toContain('build step');
  });
});
