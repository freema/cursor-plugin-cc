// Signal a job's whole process tree, not just the pid we recorded.
//
// Background workers are spawned with `detached: true` (delegate.mjs /
// review.mjs), which makes the worker the leader of a fresh process group;
// the `cursor-agent` child it spawns inherits that group. Signalling only the
// worker pid therefore orphans cursor-agent — it keeps editing files and
// burning credits while /cursor:status claims the job is cancelled. Signalling
// the group (`kill(-pid)`) reaches both.
//
// Foreground jobs record the delegate script's own pid, which is usually NOT
// a group leader — for those the group kill fails with ESRCH and we fall back
// to the single pid, which matches the old behaviour.

import { spawnSync } from 'node:child_process';

/**
 * @param {number} pid
 * @param {NodeJS.Signals} signal
 * @returns {boolean} true if a signal was delivered to at least one process
 */
export function killTree(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === 'win32') {
    // Windows has no POSIX signals or process groups; `taskkill /T` walks the
    // tree. `/F` because the graceful variant sends WM_CLOSE, which console
    // apps ignore — there is no meaningful SIGTERM/SIGKILL distinction here.
    const res = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return res.status === 0;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // No group with that pgid (ESRCH: pid is not a group leader) or the group
    // could not be signalled — try the pid alone before giving up.
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}
