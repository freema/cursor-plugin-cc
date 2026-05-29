import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as reviewMain } from '../scripts/review.mjs';
import { listJobs } from '../scripts/lib/jobs.mjs';
import {
  REVIEW_HAPPY_FIXTURE,
  REVIEW_VIOLATION_FIXTURE,
  STUB_BIN,
  makeTempHome,
} from './helpers.mjs';

function git(dir, args) {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

function gitOut(dir, args) {
  return execFileSync('git', args, { cwd: dir }).toString().trim();
}

function initRepo(dir) {
  git(dir, ['init', '--quiet']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'foo.ts'), 'export const foo = 1;\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '--quiet', '-m', 'init']);
}

describe('review', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFix = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevCwd = process.cwd();

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = REVIEW_HAPPY_FIXTURE;
    process.chdir(tmp.dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFix === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFix;
    tmp.cleanup();
  });

  it('refuses outside a git repository', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await reviewMain([]);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('reports nothing to review on a clean tree', async () => {
    initRepo(tmp.dir);
    let out = '';
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
      out += s;
      return true;
    });
    try {
      const code = await reviewMain(['--wait']);
      expect(code).toBe(0);
    } finally {
      outSpy.mockRestore();
    }
    expect(out).toMatch(/nothing to review/i);
    expect(listJobs(tmp.dir).length).toBe(0);
  });

  it('happy path: working-tree diff → status done with the review verbatim', async () => {
    initRepo(tmp.dir);
    writeFileSync(join(tmp.dir, 'foo.ts'), 'export const foo = 42;\n');
    writeFileSync(join(tmp.dir, 'bar.ts'), 'export const bar = true;\n');
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await reviewMain(['--wait']);
      expect(code).toBe(0);
    } finally {
      outSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    const job = jobs[0];
    expect(job.status).toBe('done');
    expect(job.prompt).toContain('REVIEW');
    expect(job.cursorChatId).toBe('chat_review_001');
    expect(job.summary).toMatch(/APPROVE WITH NITS/);
  });

  it('post-flight: a review that writes files is flagged and marked failed', async () => {
    process.env.CURSOR_AGENT_STUB_FIXTURE = REVIEW_VIOLATION_FIXTURE;
    initRepo(tmp.dir);
    writeFileSync(join(tmp.dir, 'foo.ts'), 'export const foo = 42;\n');
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await reviewMain(['--wait']);
    } finally {
      outSpy.mockRestore();
    }
    const job = listJobs(tmp.dir)[0];
    expect(job.status).toBe('failed');
    expect(job.summary).toMatch(/post-flight/i);
    expect(job.summary).toMatch(/read-only/i);
  });

  it('supports --base for a branch diff', async () => {
    initRepo(tmp.dir);
    const baseBranch = gitOut(tmp.dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    git(tmp.dir, ['checkout', '--quiet', '-b', 'feature']);
    writeFileSync(join(tmp.dir, 'foo.ts'), 'export const foo = 99;\n');
    git(tmp.dir, ['commit', '--quiet', '-am', 'change foo']);
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await reviewMain(['--wait', '--base', baseBranch]);
      expect(code).toBe(0);
    } finally {
      outSpy.mockRestore();
    }
    const job = listJobs(tmp.dir)[0];
    expect(job.status).toBe('done');
    expect(job.prompt).toContain(`vs ${baseBranch}`);
  });
});
