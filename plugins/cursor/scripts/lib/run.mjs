// Thin Promise wrapper around child_process.spawn with:
//   - no throw on non-zero exit (resolve with exitCode)
//   - optional timeout (SIGTERM, then SIGKILL after 5 s grace)
//   - stdout/stderr captured as strings
//
// Replaces the subset of `execa` that this plugin actually uses.

import { spawn } from 'node:child_process';

/**
 * @typedef {Object} RunOpts
 * @property {string=} cwd
 * @property {number=} timeoutMs          Kill the child after this many ms.
 * @property {NodeJS.ProcessEnv=} env
 */

/**
 * @typedef {Object} RunResult
 * @property {string} stdout
 * @property {string} stderr
 * @property {number} exitCode            -1 if we killed on timeout.
 * @property {boolean} timedOut
 */

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {RunOpts} [opts]
 * @returns {Promise<RunResult>}
 */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env ?? process.env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => {
        stdout += d;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => {
        stderr += d;
      });
    }
    let timeout;
    let killTimeout;
    if (typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGTERM');
        } catch {
          // noop
        }
        killTimeout = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // noop
          }
        }, 5_000);
      }, opts.timeoutMs);
    }
    child.on('error', (err) => {
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
      resolve({
        stdout,
        stderr: stderr || String(err?.message ?? err ?? 'spawn error'),
        exitCode: -1,
        timedOut,
      });
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (killTimeout) clearTimeout(killTimeout);
      resolve({
        stdout,
        stderr,
        exitCode: typeof code === 'number' ? code : timedOut ? -1 : 1,
        timedOut,
      });
    });
  });
}
