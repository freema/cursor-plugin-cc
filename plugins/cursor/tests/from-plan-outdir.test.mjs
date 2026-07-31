import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TASKS_DIR, main, resolveTasksDir } from '../scripts/from-plan.mjs';
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

  it('defaults to tasks/ under the repo root', () => {
    const { dir, source } = resolveTasksDir(tmp.dir, undefined);
    expect(dir).toBe(join(tmp.dir, DEFAULT_TASKS_DIR));
    expect(source).toBe('default');
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

  it('--in-place refuses a spec that lives outside the repo', async () => {
    const outside = join(tmp.dir, 'outside.md');
    writeFileSync(outside, PRP, 'utf8');
    let err = '';
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    const code = await main(['--in-place', outside]);
    expect(code).toBe(2);
    expect(err).toContain('--in-place needs the plan to live inside the repo');
  });

  it('falls back to tasks/ when nothing is configured', async () => {
    const code = await main(['PRPs/dark-mode.md']);
    expect(code).toBe(0);
    expect(readdirSync(join(repo, 'tasks'))).toHaveLength(1);
  });
});
