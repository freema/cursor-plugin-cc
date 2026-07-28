import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function pluginHome() {
  const fromEnv = process.env.CURSOR_PLUGIN_CC_HOME;
  if (fromEnv && fromEnv.trim().length > 0) return resolve(fromEnv);
  // Existing installs keep their state where it already lives — the harness
  // starting to provide a data dir must never strand previous job history.
  const legacy = join(homedir(), '.cursor-plugin-cc');
  if (existsSync(legacy)) return legacy;
  // Fresh installs prefer the Claude-Code-managed plugin data dir: it is
  // cleaned up with the plugin instead of leaving state behind in $HOME.
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (pluginData && pluginData.trim().length > 0) return join(resolve(pluginData), 'state');
  return legacy;
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
