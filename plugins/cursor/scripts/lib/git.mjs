import { run } from './run.mjs';

/**
 * @param {string} [cwd]
 * @returns {Promise<boolean>}
 */
export async function isGitRepo(cwd = process.cwd()) {
  const res = await run('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd,
    timeoutMs: 3_000,
  });
  return res.exitCode === 0 && res.stdout.trim() === 'true';
}

/**
 * @param {string} [cwd]
 * @returns {Promise<string>}
 */
export async function repoRoot(cwd = process.cwd()) {
  const res = await run('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    timeoutMs: 3_000,
  });
  if (res.exitCode === 0) return res.stdout.trim() || cwd;
  return cwd;
}
