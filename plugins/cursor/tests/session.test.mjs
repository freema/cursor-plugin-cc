import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SESSION_ID_ENV,
  createJob,
  filterJobsForSession,
  listJobs,
  readJob,
  updateJob,
} from '../scripts/lib/jobs.mjs';
import { handleSessionEnd, handleSessionStart } from '../scripts/session-hook.mjs';
import { isAlive, makeTempHome, waitForDeath } from './helpers.mjs';

describe('session lifecycle', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const prevSession = process.env[SESSION_ID_ENV];
  const prevEnvFile = process.env.CLAUDE_ENV_FILE;
  const repo = '/tmp/some-repo-path';

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
    delete process.env[SESSION_ID_ENV];
    delete process.env.CLAUDE_ENV_FILE;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    if (prevSession === undefined) delete process.env[SESSION_ID_ENV];
    else process.env[SESSION_ID_ENV] = prevSession;
    if (prevEnvFile === undefined) delete process.env.CLAUDE_ENV_FILE;
    else process.env.CLAUDE_ENV_FILE = prevEnvFile;
    tmp.cleanup();
  });

  it('createJob stamps the session id from the env', () => {
    process.env[SESSION_ID_ENV] = 'sess-abc';
    const job = createJob({ id: 'j1', repoPath: repo, prompt: 'p', model: 'm' });
    expect(job.sessionId).toBe('sess-abc');
    expect(readJob(repo, 'j1')?.sessionId).toBe('sess-abc');
  });

  it('createJob leaves sessionId unset without the env', () => {
    const job = createJob({ id: 'j2', repoPath: repo, prompt: 'p', model: 'm' });
    expect(job.sessionId).toBeUndefined();
  });

  it('filterJobsForSession keeps own and unattributed jobs', () => {
    const jobs = [
      { id: 'mine', sessionId: 's1' },
      { id: 'theirs', sessionId: 's2' },
      { id: 'legacy' },
    ];
    expect(filterJobsForSession(jobs, 's1').map((j) => j.id)).toEqual(['mine', 'legacy']);
    expect(filterJobsForSession(jobs, undefined).map((j) => j.id)).toEqual([
      'mine',
      'theirs',
      'legacy',
    ]);
  });

  it('SessionStart exports the session id into CLAUDE_ENV_FILE', () => {
    const envFile = join(tmp.dir, 'env.sh');
    writeFileSync(envFile, '', 'utf8');
    process.env.CLAUDE_ENV_FILE = envFile;
    handleSessionStart({ session_id: "se'ss-1" });
    const content = readFileSync(envFile, 'utf8');
    // Quoting must survive an embedded single quote.
    expect(content).toContain(`export ${SESSION_ID_ENV}='se'"'"'ss-1'`);
  });

  it('SessionStart without CLAUDE_ENV_FILE is a no-op', () => {
    expect(() => handleSessionStart({ session_id: 's1' })).not.toThrow();
  });

  it.skipIf(process.platform === 'win32')(
    'SessionEnd cancels only this session running jobs',
    async () => {
      const mine = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
      });
      const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        stdio: 'ignore',
      });
      try {
        createJob({ id: 'mine', repoPath: repo, prompt: 'p', model: 'm', sessionId: 's1' });
        updateJob(repo, 'mine', { pid: mine.pid });
        createJob({ id: 'other', repoPath: repo, prompt: 'p', model: 'm', sessionId: 's2' });
        updateJob(repo, 'other', { pid: other.pid });
        createJob({ id: 'finished', repoPath: repo, prompt: 'p', model: 'm', sessionId: 's1' });
        updateJob(repo, 'finished', { status: 'done' });

        // repo is not a git repo, so repoRoot(cwd) falls back to cwd — pass
        // the jobs key path directly.
        const cancelled = await handleSessionEnd({ session_id: 's1', cwd: repo });
        expect(cancelled).toBe(1);
        expect(readJob(repo, 'mine')?.status).toBe('cancelled');
        expect(readJob(repo, 'other')?.status).toBe('running');
        expect(readJob(repo, 'finished')?.status).toBe('done');
        await waitForDeath(mine.pid);
        expect(isAlive(mine.pid)).toBe(false);
        expect(isAlive(other.pid)).toBe(true);
        expect(listJobs(repo).length).toBe(3);
      } finally {
        for (const child of [mine, other]) {
          if (!child.killed) child.kill('SIGKILL');
        }
      }
    },
  );

  it('SessionEnd without a session id does nothing', async () => {
    const cancelled = await handleSessionEnd({ cwd: repo });
    expect(cancelled).toBe(0);
  });
});
