import { writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  collapseCommandArgv,
  parseArgv,
  parseTimeout,
  splitArgString,
} from '../scripts/lib/args.mjs';
import { id } from '../scripts/lib/id.mjs';
import { createJob, jobFilePath, listJobs, readJob, updateJob } from '../scripts/lib/jobs.mjs';
import { mdCell } from '../scripts/lib/md.mjs';
import { repoHash } from '../scripts/lib/paths.mjs';
import { pickText, summariseEvents } from '../scripts/lib/parse.mjs';
import { pickSection, resolvePlanPath, splitSections } from '../scripts/lib/plan.mjs';
import { makeTempHome } from './helpers.mjs';

describe('args hardening', () => {
  it('keeps the inline value of --no-foo=value instead of discarding it', () => {
    const { flags } = parseArgv(['--no-cache=5']);
    expect(flags['no-cache']).toBe(5);
    expect(flags['cache']).toBeUndefined();
  });

  it('still negates the bare --no-foo form', () => {
    const { flags } = parseArgv(['--no-color']);
    expect(flags['color']).toBe(false);
  });

  it('treats backslashes inside single quotes as literal', () => {
    expect(splitArgString("'a\\b'")).toEqual(['a\\b']);
  });

  it('keeps a double-quote escape working', () => {
    expect(splitArgString('"a\\"b"')).toEqual(['a"b']);
  });

  it('keeps a trailing lone backslash', () => {
    expect(splitArgString('a\\')).toEqual(['a\\']);
  });

  it('does not cast an integer that would lose precision', () => {
    const { flags } = parseArgv(['--id=12345678901234567890']);
    expect(flags['id']).toBe('12345678901234567890');
  });

  it('casts a safe integer', () => {
    const { flags } = parseArgv(['--n=123']);
    expect(flags['n']).toBe(123);
  });

  it('parseTimeout falls back for junk and zero, keeps valid values', () => {
    expect(parseTimeout('abc')).toBe(1800);
    expect(parseTimeout('0')).toBe(1800);
    expect(parseTimeout(undefined)).toBe(1800);
    expect(parseTimeout('60')).toBe(60);
    expect(parseTimeout(45)).toBe(45);
    expect(parseTimeout('x', 5)).toBe(5);
  });

  it('collapseCommandArgv splits the post -- string with quote handling', () => {
    expect(collapseCommandArgv(['--model', 'gpt', '--', 'do "a thing"'])).toEqual([
      '--model',
      'gpt',
      'do',
      'a thing',
    ]);
  });
});

describe('id hardening', () => {
  it('produces exactly the requested length with no padding bias', () => {
    for (const len of [10, 16, 24]) {
      const ids = Array.from({ length: 200 }, () => id(len));
      for (const x of ids) {
        expect(x.length).toBe(len);
        expect(/^[A-Za-z0-9_-]+$/.test(x)).toBe(true);
      }
      // Last char should not be overwhelmingly a single value (old zero-pad bug).
      const lastChars = new Set(ids.map((x) => x[len - 1]));
      expect(lastChars.size).toBeGreaterThan(1);
    }
  });
});

describe('parse hardening', () => {
  it('pickText flattens an Anthropic content[] array', () => {
    expect(
      pickText([
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
      ]),
    ).toBe('Hello world');
    expect(pickText('plain')).toBe('plain');
    expect(pickText({ result: 'r' })).toBe('r');
  });

  it('summariseEvents recovers text from content[] when no result event arrives', () => {
    const events = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'partial answer' }] } },
    ];
    const s = summariseEvents(events);
    expect(s.summary).toBe('partial answer');
  });
});

describe('plan hardening', () => {
  it('ignores ## headings inside fenced code blocks', () => {
    const md = [
      '# Title',
      '',
      '## Approach',
      '',
      'text',
      '```',
      '## not a heading',
      '```',
      'more',
      '',
      '## Files',
      '',
      'f.js',
    ].join('\n');
    const { sections } = splitSections(md);
    expect(sections['not a heading']).toBeUndefined();
    expect(sections['approach']).toContain('## not a heading');
    expect(sections['approach']).toContain('more');
    expect(sections['files']).toBe('f.js');
  });

  it('prefers a specific section hint over a generic one regardless of order', () => {
    const sections = { 'files we read for context': 'narrative', 'files to touch': 'a.js' };
    expect(pickSection(sections, 'files')).toBe('a.js');
  });

  it('resolvePlanPath rejects a directory', () => {
    const tmp = makeTempHome();
    try {
      expect(resolvePlanPath(tmp.dir)).toBeUndefined();
    } finally {
      tmp.cleanup();
    }
  });
});

describe('paths hardening', () => {
  it('repoHash is stable and does not throw for a non-existent path', () => {
    const p = '/definitely/not/a/real/path/xyz';
    const a = repoHash(p);
    const b = repoHash(p);
    expect(a).toBe(b);
    expect(/^[0-9a-f]{12}$/.test(a)).toBe(true);
  });
});

describe('md hardening', () => {
  it('escapes pipes and collapses whitespace', () => {
    expect(mdCell('a|b')).toBe('a\\|b');
    expect(mdCell('x\n  y')).toBe('x y');
    expect(mdCell(undefined)).toBe('');
    expect(mdCell(42)).toBe('42');
  });
});

describe('jobs hardening', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    tmp.cleanup();
  });

  it('does not resurrect a cancelled job to done', () => {
    createJob({ id: 'job1', repoPath: tmp.dir, prompt: 'x', model: 'auto' });
    updateJob(tmp.dir, 'job1', { status: 'cancelled' });
    updateJob(tmp.dir, 'job1', { status: 'done', exitCode: 0 });
    const job = readJob(tmp.dir, 'job1');
    expect(job.status).toBe('cancelled');
    expect(job.exitCode).toBe(0); // other fields still merge
  });

  it('listJobs tolerates a job record missing prompt', () => {
    createJob({ id: 'job2', repoPath: tmp.dir, prompt: 'ok', model: 'auto' });
    // Hand-write a corrupted record with no prompt field.
    writeFileSync(
      jobFilePath(tmp.dir, 'job3'),
      JSON.stringify({ id: 'job3', status: 'done', startedAt: new Date(0).toISOString() }),
      'utf8',
    );
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(2);
  });
});

describe('status renders a prompt-less job without crashing', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const prevCwd = process.cwd();

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
    process.chdir(tmp.dir);
  });
  afterEach(() => {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    tmp.cleanup();
  });

  it('exits 0 with a corrupted record in the list', async () => {
    const { main: statusMain } = await import('../scripts/status.mjs');
    createJob({ id: 'good', repoPath: tmp.dir, prompt: 'fine', model: 'auto' });
    writeFileSync(
      jobFilePath(tmp.dir, 'bad'),
      JSON.stringify({ id: 'bad', status: 'failed', startedAt: new Date(0).toISOString() }),
      'utf8',
    );
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await statusMain([]);
      expect(code).toBe(0);
    } finally {
      out.mockRestore();
    }
  });
});
