#!/usr/bin/env node
// Claude Code session lifecycle hook (SessionStart / SessionEnd).
//
// SessionStart: exports the session id (and CLAUDE_PLUGIN_DATA, which slash
// command invocations do not receive automatically) into CLAUDE_ENV_FILE so
// every subsequent script run in the session can stamp jobs with the owning
// session and resolve the harness-managed state dir.
//
// SessionEnd: cancels THIS session's still-running jobs. Background workers
// are detached, so without this a closed Claude session leaves cursor-agent
// running unattended. Jobs from other sessions — or with no session stamp —
// are deliberately left alone.

import { appendFileSync, readFileSync } from 'node:fs';
import { repoRoot } from './lib/git.mjs';
import { SESSION_ID_ENV, cancelJob, listJobs } from './lib/jobs.mjs';
import { invokedAsScript as __isScript } from './lib/invoked.mjs';

const PLUGIN_DATA_ENV = 'CLAUDE_PLUGIN_DATA';

/** @param {string} value */
function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

/**
 * @param {string} name
 * @param {string|undefined} value
 */
function appendEnvVar(name, value) {
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (!envFile || !value) return;
  appendFileSync(envFile, `export ${name}=${shellQuote(value)}\n`, 'utf8');
}

/** @returns {Record<string, unknown>} */
function readHookInput() {
  try {
    const raw = readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * @param {Record<string, unknown>} input
 */
export function handleSessionStart(input) {
  const sessionId = typeof input.session_id === 'string' ? input.session_id : undefined;
  appendEnvVar(SESSION_ID_ENV, sessionId);
  appendEnvVar(PLUGIN_DATA_ENV, process.env[PLUGIN_DATA_ENV]);
}

/**
 * @param {Record<string, unknown>} input
 * @returns {Promise<number>} number of jobs cancelled
 */
export async function handleSessionEnd(input) {
  const sessionId =
    (typeof input.session_id === 'string' && input.session_id) || process.env[SESSION_ID_ENV];
  if (!sessionId) return 0;
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const root = await repoRoot(cwd);
  const mine = listJobs(root).filter((j) => j.status === 'running' && j.sessionId === sessionId);
  await Promise.all(mine.map((j) => cancelJob(root, j.id, 3_000)));
  return mine.length;
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const input = readHookInput();
  const eventName = rawArgv[0] ?? input.hook_event_name ?? '';
  if (eventName === 'SessionStart') {
    handleSessionStart(input);
    return 0;
  }
  if (eventName === 'SessionEnd') {
    const cancelled = await handleSessionEnd(input);
    if (cancelled > 0) {
      process.stderr.write(
        `cursor-plugin-cc: cancelled ${cancelled} running job(s) on session end.\n`,
      );
    }
    return 0;
  }
  return 0;
}

const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `session-hook failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      // Never block the session over hook housekeeping.
      process.exit(0);
    });
}
