import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as delegateMain } from '../scripts/delegate.js';
import { listJobs } from '../scripts/lib/jobs.js';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.js';

describe('delegate.ts foreground', () => {
  let tmp: ReturnType<typeof makeTempHome>;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFix = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevCwd = process.cwd();

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = HAPPY_FIXTURE;
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

  it('runs to completion and records a finished job', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain([
        '--no-git-check',
        '--model',
        'composer',
        '--',
        'hello world task',
      ]);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    const job = jobs[0]!;
    expect(job.status).toBe('done');
    expect(job.model).toBe('composer-2-fast');
    expect(job.cursorChatId).toBe('chat_abc123');
    expect(job.filesTouched?.length ?? 0).toBeGreaterThan(0);
  });

  it('refuses outside a git repo without --no-git-check', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--', 'nope']);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('errors with exit 2 when no prompt is given', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--no-git-check']);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });
});
