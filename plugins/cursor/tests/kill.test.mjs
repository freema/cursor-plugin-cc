import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { killTree } from '../scripts/lib/kill.mjs';
import { isAlive, waitForDeath } from './helpers.mjs';

describe('killTree', () => {
  it('rejects non-positive and non-integer pids', () => {
    expect(killTree(0, 'SIGTERM')).toBe(false);
    expect(killTree(-42, 'SIGTERM')).toBe(false);
    expect(killTree(1.5, 'SIGTERM')).toBe(false);
    expect(killTree(NaN, 'SIGTERM')).toBe(false);
  });

  it('falls back to a single-pid kill for a non-group-leader', async () => {
    // Spawned without `detached`, the child shares OUR process group, so the
    // group kill inside killTree must fail with ESRCH and fall back — if it
    // signalled the group, it would kill this test runner.
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      expect(killTree(child.pid, 'SIGTERM')).toBe(true);
      await waitForDeath(child.pid);
      expect(isAlive(child.pid)).toBe(false);
    } finally {
      if (!child.killed) child.kill('SIGKILL');
    }
  });

  it('returns false when nothing answers to the pid', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
    await new Promise((r) => child.on('exit', r));
    expect(killTree(child.pid, 'SIGTERM')).toBe(false);
  });
});
