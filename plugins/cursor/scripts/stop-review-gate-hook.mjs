#!/usr/bin/env node
// Claude Code Stop hook: optional review gate, off by default.
//
// When enabled (`/cursor:setup --enable-review-gate`), a Cursor model reviews
// the previous Claude turn before the session is allowed to stop. The run
// must answer `ALLOW: …` or `BLOCK: …` on its first line
// (prompts/stop-review-gate.md); a BLOCK is surfaced to Claude Code as
// `{"decision": "block", "reason": …}` so the turn continues with fixes.
//
// The gate never runs when Cursor is missing/unauthenticated (it degrades to
// a stderr note), and `stop_hook_active` short-circuits to ALLOW so a block
// can never loop forever.

import { readFileSync } from 'node:fs';
import { getConfig } from './lib/config.mjs';
import { authStatus, resolveBin, resolveModel, runHeadless } from './lib/cursor.mjs';
import { repoRoot } from './lib/git.mjs';
import { id as newId } from './lib/id.mjs';
import { SESSION_ID_ENV, listJobs, rawLogPath } from './lib/jobs.mjs';
import { ensureDir, logsDir } from './lib/paths.mjs';
import { summariseEvents } from './lib/parse.mjs';
import { interpolateTemplate, loadPromptTemplate } from './lib/prompts.mjs';
import { invokedAsScript as __isScript } from './lib/invoked.mjs';

const GATE_TIMEOUT_SEC = 600;

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
 * First-line ALLOW/BLOCK contract, tolerant of markdown wrapping
 * (`**ALLOW: fine**` etc.).
 *
 * @param {string} text
 * @returns {{ok: boolean, reason: string|null}}
 */
export function parseGateOutput(text) {
  const firstLine = (
    String(text ?? '')
      .trim()
      .split(/\r?\n/, 1)[0] ?? ''
  )
    .replace(/^[#>*_`\s-]+/, '')
    .trim();
  if (/^ALLOW\b/i.test(firstLine)) return { ok: true, reason: null };
  if (/^BLOCK\b/i.test(firstLine)) {
    const reason = firstLine.replace(/^BLOCK[:\s]*/i, '').trim() || String(text).trim();
    return {
      ok: false,
      reason: `Cursor stop-gate review found issues that still need fixes before stopping: ${reason}`,
    };
  }
  return {
    ok: false,
    reason:
      'The stop-gate Cursor review returned an unexpected answer. Run `/cursor:review --wait` manually or disable the gate with `/cursor:setup --disable-review-gate`.',
  };
}

/**
 * @param {Record<string, unknown>} input
 * @param {string} root
 * @returns {Promise<{ok: boolean, reason: string|null}>}
 */
async function runGateReview(input, root) {
  const template = loadPromptTemplate('stop-review-gate');
  const last = String(input.last_assistant_message ?? '').trim();
  const prompt = interpolateTemplate(template, {
    CLAUDE_RESPONSE_BLOCK: last ? `Previous Claude response:\n${last}` : '',
  });
  ensureDir(logsDir(root));
  const result = await runHeadless({
    prompt,
    model: resolveModel(undefined),
    cloud: false,
    force: true,
    timeoutSec: GATE_TIMEOUT_SEC,
    logPath: rawLogPath(root, `gate-${newId(8)}`),
    cwd: root,
  });
  if (result.killed) {
    return {
      ok: false,
      reason: `The stop-gate Cursor review timed out after ${GATE_TIMEOUT_SEC / 60} minutes. Run \`/cursor:review --wait\` manually or disable the gate with \`/cursor:setup --disable-review-gate\`.`,
    };
  }
  const summary = summariseEvents(result.events);
  if (result.exitCode !== 0 || !summary.success) {
    return {
      ok: false,
      reason: `The stop-gate Cursor review failed (exit ${result.exitCode}). Run \`/cursor:review --wait\` manually or disable the gate with \`/cursor:setup --disable-review-gate\`.`,
    };
  }
  return parseGateOutput(summary.summary ?? '');
}

/**
 * @param {Record<string, unknown>} input
 * @param {{out?: (s: string) => void, err?: (s: string) => void}} [io]
 * @returns {Promise<number>}
 */
export async function handleStop(input, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s));
  const err = io.err ?? ((s) => process.stderr.write(s));

  // Claude Code sets stop_hook_active when the turn is already continuing
  // because a stop hook blocked — never block again, or the gate would loop.
  if (input.stop_hook_active) return 0;

  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const root = await repoRoot(cwd);

  const sessionId =
    (typeof input.session_id === 'string' && input.session_id) || process.env[SESSION_ID_ENV];
  const running = listJobs(root).filter(
    (j) => j.status === 'running' && (!sessionId || !j.sessionId || j.sessionId === sessionId),
  );
  const runningNote =
    running.length > 0
      ? `Cursor job(s) still running: ${running.map((j) => `\`${j.id}\``).join(', ')} — check \`/cursor:status\`, cancel with \`/cursor:cancel <id>\` if unwanted.`
      : null;

  if (!getConfig(root).stopReviewGate) {
    if (runningNote) err(runningNote + '\n');
    return 0;
  }

  // Preflight: a misconfigured Cursor must degrade to a note, not a block.
  try {
    await resolveBin();
  } catch {
    err('Stop review gate is enabled but cursor-agent is not installed. Run /cursor:setup.\n');
    if (runningNote) err(runningNote + '\n');
    return 0;
  }
  const auth = await authStatus();
  if (!auth.loggedIn) {
    err('Stop review gate is enabled but Cursor CLI is not logged in. Run `cursor-agent login`.\n');
    if (runningNote) err(runningNote + '\n');
    return 0;
  }

  const review = await runGateReview(input, root);
  if (!review.ok) {
    out(
      JSON.stringify({
        decision: 'block',
        reason: runningNote ? `${runningNote} ${review.reason}` : review.reason,
      }) + '\n',
    );
    return 0;
  }
  if (runningNote) err(runningNote + '\n');
  return 0;
}

const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  handleStop(readHookInput())
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `stop-review-gate failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      // Hook infrastructure failures must never trap the user in a session.
      process.exit(0);
    });
}
