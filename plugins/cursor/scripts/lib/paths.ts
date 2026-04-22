import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function pluginHome(): string {
  const fromEnv = process.env.CURSOR_PLUGIN_CC_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return resolve(fromEnv);
  }
  return join(homedir(), '.cursor-plugin-cc');
}

export function repoHash(repoRoot: string): string {
  const canonical = existsSync(repoRoot) ? realpathSync(repoRoot) : resolve(repoRoot);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function jobsDir(repoRoot: string): string {
  return join(pluginHome(), 'jobs', repoHash(repoRoot));
}

export function logsDir(repoRoot: string): string {
  return join(jobsDir(repoRoot), 'logs');
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
