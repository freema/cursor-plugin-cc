import { spawn } from 'node:child_process';
import { utimesSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cancelJob,
  createJob,
  findRunningJobs,
  jobFilePath,
  listJobs,
  mostRecentFinishedJob,
  pruneOlderThanDays,
  readJob,
  updateJob,
} from '../scripts/lib/jobs.mjs';
import { isAlive, makeTempHome, waitForDeath } from './helpers.mjs';

describe('jobs registry', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const repo = '/tmp/some-repo-path';

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    tmp.cleanup();
  });

  it('creates, reads, and updates a job atomically', () => {
    const job = createJob({ id: 'job1', repoPath: repo, prompt: 'do it', model: 'composer-2.5' });
    expect(job.status).toBe('running');
    const read = readJob(repo, 'job1');
    expect(read?.prompt).toBe('do it');
    const updated = updateJob(repo, 'job1', {
      status: 'done',
      exitCode: 0,
      finishedAt: new Date().toISOString(),
    });
    expect(updated?.status).toBe('done');
  });

  it('lists jobs sorted newest first and filters by status', () => {
    createJob({ id: 'a', repoPath: repo, prompt: 'a', model: 'x' });
    createJob({ id: 'b', repoPath: repo, prompt: 'b', model: 'x' });
    updateJob(repo, 'a', { status: 'done', finishedAt: new Date().toISOString() });
    const all = listJobs(repo);
    expect(all.length).toBe(2);
    const running = listJobs(repo, { status: 'running' });
    expect(running.map((j) => j.id)).toEqual(['b']);
    expect(findRunningJobs(repo).map((j) => j.id)).toEqual(['b']);
    expect(mostRecentFinishedJob(repo)?.id).toBe('a');
  });

  it('prunes stale job files', () => {
    createJob({ id: 'old', repoPath: repo, prompt: 'old', model: 'x' });
    createJob({ id: 'new', repoPath: repo, prompt: 'new', model: 'x' });
    const stalePath = jobFilePath(repo, 'old');
    const past = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    utimesSync(stalePath, past, past);
    const removed = pruneOlderThanDays(repo, 30);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(readJob(repo, 'old')).toBeNull();
    expect(readJob(repo, 'new')).not.toBeNull();
  });

  it('cancelJob SIGTERMs a live pid and marks cancelled', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: false,
    });
    try {
      await new Promise((r) => setTimeout(r, 50));
      createJob({ id: 'live', repoPath: repo, prompt: 'p', model: 'm' });
      updateJob(repo, 'live', { pid: child.pid });
      const cancelled = await cancelJob(repo, 'live', 500);
      expect(cancelled?.status).toBe('cancelled');
    } finally {
      if (!child.killed) child.kill('SIGKILL');
    }
  });

  it.skipIf(process.platform === 'win32')(
    'cancelJob kills a detached worker AND its child (process group)',
    async () => {
      // Reproduce the background-delegate shape: spawnBackground() starts the
      // worker with `detached: true` (own process group) and the worker spawns
      // cursor-agent as a plain child (same group). Cancelling must reach BOTH
      // — killing only the worker orphans the stand-in cursor-agent.
      const workerScript = [
        "const { spawn } = require('node:child_process');",
        "const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        'console.log(c.pid);',
        'setInterval(() => {}, 1000);',
      ].join('\n');
      const worker = spawn(process.execPath, ['-e', workerScript], {
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: true,
      });
      const childPid = await new Promise((resolve, reject) => {
        let buf = '';
        worker.stdout.on('data', (d) => {
          buf += d;
          const m = /^(\d+)\s/.exec(buf);
          if (m) resolve(Number(m[1]));
        });
        worker.on('error', reject);
        setTimeout(() => reject(new Error('worker never reported its child pid')), 5_000);
      });
      try {
        createJob({ id: 'tree', repoPath: repo, prompt: 'p', model: 'm' });
        updateJob(repo, 'tree', { pid: worker.pid });
        const cancelled = await cancelJob(repo, 'tree', 2_000);
        expect(cancelled?.status).toBe('cancelled');
        await waitForDeath(worker.pid);
        await waitForDeath(childPid);
        expect(isAlive(worker.pid)).toBe(false);
        expect(isAlive(childPid)).toBe(false);
      } finally {
        // Belt and braces: never leave the group behind on assertion failure.
        for (const pid of [worker.pid, childPid]) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            // noop
          }
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // noop
          }
        }
      }
    },
  );

  it('cancelJob on unknown id returns null', async () => {
    const res = await cancelJob(repo, 'nope');
    expect(res).toBeNull();
  });

  it('cancelJob on already-finished job returns unchanged record', async () => {
    createJob({ id: 'done1', repoPath: repo, prompt: 'p', model: 'm' });
    updateJob(repo, 'done1', { status: 'done' });
    const res = await cancelJob(repo, 'done1');
    expect(res?.status).toBe('done');
  });
});
