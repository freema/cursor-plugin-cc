import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function pluginHome() {
  const fromEnv = process.env.CURSOR_PLUGIN_CC_HOME;
  if (fromEnv && fromEnv.trim().length > 0) return resolve(fromEnv);
  return join(homedir(), '.cursor-plugin-cc');
}

/**
 * Stable 12-hex-char SHA-256 prefix of the repo's canonical absolute path.
 * @param {string} repoRoot
 * @returns {string}
 */
export function repoHash(repoRoot) {
  // Always canonicalise the same way so a repo maps to ONE hash regardless of
  // whether the path currently exists or contains a symlinked component
  // (e.g. macOS `/tmp` → `/private/tmp`). `realpathSync` throws when the path
  // is gone, so fall back to a plain resolve.
  let canonical;
  try {
    canonical = realpathSync(repoRoot);
  } catch {
    canonical = resolve(repoRoot);
  }
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function jobsDir(repoRoot) {
  return join(pluginHome(), 'jobs', repoHash(repoRoot));
}

export function logsDir(repoRoot) {
  return join(jobsDir(repoRoot), 'logs');
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}
