// Per-repo plugin config, persisted at `<state-root>/config/<repo-hash>.json`
// (deliberately outside jobs/<repo-hash>/ so config never mixes with job
// records). Currently the only key is the stop-review-gate toggle.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, pluginHome, repoHash } from './paths.mjs';

// `tasksDir` is null until the user opts in, which keeps `tasks/` as the
// default for existing repos while letting spec-driven workflows (PRPs/,
// specs/, openspec/) point the generated task file at the folder they already
// use, instead of growing a second parallel tree.
const DEFAULTS = Object.freeze({ stopReviewGate: false, tasksDir: null });

/**
 * @param {string} repoPath
 * @returns {string}
 */
export function configPath(repoPath) {
  return join(pluginHome(), 'config', `${repoHash(repoPath)}.json`);
}

/**
 * @param {string} repoPath
 * @returns {{stopReviewGate: boolean, tasksDir: string|null}}
 */
export function getConfig(repoPath) {
  try {
    return { ...DEFAULTS, ...JSON.parse(readFileSync(configPath(repoPath), 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * @param {string} repoPath
 * @param {string} key
 * @param {unknown} value
 * @returns {{stopReviewGate: boolean, tasksDir: string|null}}
 */
export function setConfigValue(repoPath, key, value) {
  ensureDir(join(pluginHome(), 'config'));
  const next = { ...getConfig(repoPath), [key]: value };
  writeFileSync(configPath(repoPath), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}
