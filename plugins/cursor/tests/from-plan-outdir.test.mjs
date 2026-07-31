import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TASKS_DIR, main, referenceFor, resolveTasksDir } from '../scripts/from-plan.mjs';
import { makeTempHome } from './helpers.mjs';

const PRP = `# PRP: Dark Mode Toggle

## Why

- Night-shift users report eye strain.

## All Needed Context

- CRITICAL: SSR flashes light theme unless set in the inline head script

## Implementation Blueprint

Create \`src/theme/ThemeProvider.tsx\`.

## Validation Loop

\`npm run lint && npm test\`
`;

describe('resolveTasksDir', () => {
  let tmp;
  const prevEnv = process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;

  beforeEach(() => {
    tmp = makeTempHome();
    delete process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
    // Isolate the per-repo config store so a developer's real config cannot
    // leak into these assertions.
    process.env.CURSOR_PLUGIN_CC_HOME = join(tmp.dir, 'state');
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
    else process.env.CURSOR_PLUGIN_CC_TASKS_DIR = prevEnv;
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    tmp.cleanup();
  });

  it('defaults to tasks/ under the repo root when there is nothing to derive from', () => {
    const { dir, source } = resolveTasksDir(tmp.dir, undefined);
    expect(dir).toBe(join(tmp.dir, DEFAULT_TASKS_DIR));
    expect(source).toBe('default');
  });

  it("derives the destination from the source spec's own directory", () => {
    const spec = join(tmp.dir, 'PRPs', '018-wizard.md');
    const { dir, source } = resolveTasksDir(tmp.dir, undefined, spec);
    expect(dir).toBe(join(tmp.dir, 'PRPs'));
    expect(source).toBe('spec');
  });

  it('derives it even when the spec lives outside the repo entirely', () => {
    // The multi-repo case: PRPs centralised in a sibling monorepo while the
    // code being changed lives here. The task file must land beside its
    // siblings, not in a new folder inside this repo.
    const spec = join(tmp.dir, 'elsewhere', 'mono', 'PRPs', '018-wizard.md');
    const { dir, source } = resolveTasksDir(join(tmp.dir, 'api'), undefined, spec);
    expect(dir).toBe(join(tmp.dir, 'elsewhere', 'mono', 'PRPs'));
    expect(source).toBe('spec');
  });

  it('lets an explicit --out-dir override the spec directory', () => {
    const spec = join(tmp.dir, 'PRPs', '018-wizard.md');
    const { dir, source } = resolveTasksDir(tmp.dir, 'tasks', spec);
    expect(dir).toBe(join(tmp.dir, 'tasks'));
    expect(source).toBe('flag');
  });

  it('prefers the spec directory over env and config', () => {
    process.env.CURSOR_PLUGIN_CC_TASKS_DIR = 'specs';
    const spec = join(tmp.dir, 'PRPs', '018-wizard.md');
    expect(resolveTasksDir(tmp.dir, undefined, spec).source).toBe('spec');
  });

  it('honours the --out-dir flag, resolved against the repo root', () => {
    const { dir, source } = resolveTasksDir(tmp.dir, 'PRPs');
    expect(dir).toBe(join(tmp.dir, 'PRPs'));
    expect(source).toBe('flag');
  });

  it('accepts an absolute --out-dir verbatim', () => {
    const abs = join(tmp.dir, 'elsewhere', 'specs');
    expect(resolveTasksDir(tmp.dir, abs).dir).toBe(abs);
  });

  it('falls back to the env var when no flag is given', () => {
    process.env.CURSOR_PLUGIN_CC_TASKS_DIR = 'specs';
    const { dir, source } = resolveTasksDir(tmp.dir, undefined);
    expect(dir).toBe(join(tmp.dir, 'specs'));
    expect(source).toBe('env');
  });

  it('lets the flag win over the env var', () => {
    process.env.CURSOR_PLUGIN_CC_TASKS_DIR = 'specs';
    expect(resolveTasksDir(tmp.dir, 'PRPs').dir).toBe(join(tmp.dir, 'PRPs'));
  });

  it('ignores a blank env var instead of writing to the repo root', () => {
    process.env.CURSOR_PLUGIN_CC_TASKS_DIR = '   ';
    expect(resolveTasksDir(tmp.dir, undefined).source).toBe('default');
  });
});

describe('from-plan writes into the configured directory', () => {
  let tmp;
  let repo;
  const prevCwd = process.cwd();
  const prevEnv = process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  let out;

  beforeEach(() => {
    tmp = makeTempHome();
    repo = join(tmp.dir, 'repo');
    mkdirSync(join(repo, 'PRPs'), { recursive: true });
    writeFileSync(join(repo, 'PRPs', 'dark-mode.md'), PRP, 'utf8');
    delete process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
    process.env.CURSOR_PLUGIN_CC_HOME = join(tmp.dir, 'state');
    process.chdir(repo);
    out = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.chdir(prevCwd);
    if (prevEnv === undefined) delete process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
    else process.env.CURSOR_PLUGIN_CC_TASKS_DIR = prevEnv;
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    tmp.cleanup();
  });

  it('--out-dir PRPs keeps the task file beside the spec and creates no tasks/', async () => {
    const code = await main(['--out-dir', 'PRPs', 'PRPs/dark-mode.md']);
    expect(code).toBe(0);
    expect(existsSync(join(repo, 'tasks'))).toBe(false);
    const written = readdirSync(join(repo, 'PRPs')).filter((f) => f !== 'dark-mode.md');
    expect(written).toHaveLength(1);
    // The gotcha that used to be dropped now reaches the task file.
    const body = readFileSync(join(repo, 'PRPs', written[0]), 'utf8');
    expect(body).toContain('CRITICAL: SSR flashes light theme');
    expect(out).toContain('from --out-dir');
  });

  it('--in-place writes nothing and delegates the spec path itself', async () => {
    const code = await main(['--in-place', 'PRPs/dark-mode.md']);
    expect(code).toBe(0);
    expect(existsSync(join(repo, 'tasks'))).toBe(false);
    expect(readdirSync(join(repo, 'PRPs'))).toEqual(['dark-mode.md']);
    expect(out).toContain('no task file written');
    expect(out).toContain('@PRPs/dark-mode.md');
  });

  it('writes beside the source spec by default, with no configuration at all', async () => {
    const code = await main(['PRPs/dark-mode.md']);
    expect(code).toBe(0);
    expect(existsSync(join(repo, 'tasks'))).toBe(false);
    expect(readdirSync(join(repo, 'PRPs'))).toHaveLength(2);
    expect(out).toContain("from the source spec's own directory");
  });

  describe('spec in a sibling repo (central spec directory)', () => {
    let mono;
    let spec;

    beforeEach(() => {
      mono = join(tmp.dir, 'mono');
      mkdirSync(join(mono, 'PRPs'), { recursive: true });
      spec = join(mono, 'PRPs', '018-wizard.md');
      writeFileSync(spec, PRP, 'utf8');
    });

    it('lands the task file beside its siblings, not inside the code repo', async () => {
      const code = await main([spec]);
      expect(code).toBe(0);
      // Nothing new in the code repo…
      expect(existsSync(join(repo, 'tasks'))).toBe(false);
      expect(readdirSync(join(repo, 'PRPs'))).toEqual(['dark-mode.md']);
      // …and the task file joined the spec it came from.
      expect(readdirSync(join(mono, 'PRPs'))).toHaveLength(2);
    });

    it('hands Cursor an absolute path, since @path cannot leave the repo', async () => {
      await main([spec]);
      expect(out).toContain(join(mono, 'PRPs'));
      expect(out).toContain('lives outside this repository');
      expect(out).not.toMatch(/@\.\./);
    });

    it('--in-place no longer refuses a spec outside the repo', async () => {
      const code = await main(['--in-place', spec]);
      expect(code).toBe(0);
      expect(out).toContain('no task file written');
      expect(out).toContain(spec);
      expect(out).toContain('applies changes here');
      // Still wrote nothing anywhere.
      expect(readdirSync(join(mono, 'PRPs'))).toEqual(['018-wizard.md']);
      expect(existsSync(join(repo, 'tasks'))).toBe(false);
    });
  });
});

describe('referenceFor', () => {
  it('uses the @path shorthand inside the repo', () => {
    const r = referenceFor('/repo', '/repo/PRPs/018.md');
    expect(r).toEqual({ mention: '@PRPs/018.md', display: 'PRPs/018.md', inside: true });
  });

  it('falls back to the absolute path outside the repo', () => {
    const r = referenceFor('/repo', '/mono/PRPs/018.md');
    expect(r).toEqual({
      mention: '/mono/PRPs/018.md',
      display: '/mono/PRPs/018.md',
      inside: false,
    });
  });

  it('treats a sibling directory sharing a name prefix as outside', () => {
    // `/repo-api` must not be mistaken for a child of `/repo`.
    expect(referenceFor('/repo', '/repo-api/PRPs/018.md').inside).toBe(false);
  });
});
