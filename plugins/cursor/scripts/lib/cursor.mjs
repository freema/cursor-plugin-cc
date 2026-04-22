import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseLine } from './parse.mjs';
import { run } from './run.mjs';

// Convenience aliases that map shortcuts to real Cursor model ids. Cursor
// rotates these over time — `/cursor:setup --print-models` shows the live
// list for the current account. Unknown ids are passed through verbatim.
export const MODEL_ALIASES = {
  composer: 'composer-2-fast',
  'composer-fast': 'composer-2-fast',
  fast: 'composer-2-fast',
  'composer-2-fast': 'composer-2-fast',
  'composer-2': 'composer-2',
  'composer-full': 'composer-2',
  'composer-1.5': 'composer-1.5',
  auto: 'auto',
  sonnet: 'claude-4.6-sonnet-medium',
  'sonnet-4.6': 'claude-4.6-sonnet-medium',
  'sonnet-4.6-thinking': 'claude-4.6-sonnet-medium-thinking',
  'sonnet-4.5': 'claude-4.5-sonnet',
  'sonnet-4.5-thinking': 'claude-4.5-sonnet-thinking',
  'sonnet-4': 'claude-4-sonnet',
  opus: 'claude-opus-4-7-high',
  'opus-4.7': 'claude-opus-4-7-high',
  'opus-4.7-max': 'claude-opus-4-7-max',
  'opus-4.7-thinking': 'claude-opus-4-7-thinking-high',
  'opus-4.6': 'claude-4.6-opus-high',
  gpt: 'gpt-5.3-codex',
  codex: 'gpt-5.3-codex',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'gpt-5.3-codex-fast': 'gpt-5.3-codex-fast',
  'gpt-5.3-codex-high': 'gpt-5.3-codex-high',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.2': 'gpt-5.2',
  grok: 'grok-4-20',
  'grok-thinking': 'grok-4-20-thinking',
  gemini: 'gemini-3.1-pro',
  'gemini-pro': 'gemini-3.1-pro',
  'gemini-flash': 'gemini-3-flash',
};

export const DEFAULT_MODEL = 'composer-2-fast';

/**
 * @param {string|undefined} input
 * @returns {string}
 */
export function resolveModel(input) {
  if (!input || input.trim() === '') return DEFAULT_MODEL;
  const key = input.trim().toLowerCase();
  return MODEL_ALIASES[key] ?? input.trim();
}

/** @type {string|null} */
let cachedBin = null;

/**
 * @returns {Promise<string>}
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.CURSOR_AGENT_BIN;
  if (override && override.trim().length > 0) {
    cachedBin = override;
    return cachedBin;
  }
  for (const candidate of ['cursor-agent', 'agent']) {
    const res = await run('which', [candidate]);
    if (res.exitCode === 0 && res.stdout.trim()) {
      cachedBin = res.stdout.trim();
      return cachedBin;
    }
  }
  throw new Error(
    'cursor-agent not found on PATH. Install from https://cursor.com/install or run /cursor:setup.',
  );
}

/**
 * @typedef {Object} BuildArgsInput
 * @property {string} prompt
 * @property {string} model
 * @property {string=} resumeChatId
 * @property {boolean=} resumeLatest
 * @property {boolean=} cloud
 * @property {boolean=} force              Default: true.
 * @property {boolean=} approveMcps
 */

/**
 * @param {BuildArgsInput} opts
 * @returns {string[]}
 */
export function buildArgs(opts) {
  const args = ['-p', '--output-format', 'stream-json', '--trust', '--model', opts.model];
  if (opts.force !== false) args.push('--force');
  if (opts.approveMcps) args.push('--approve-mcps');
  if (opts.cloud) args.push('--cloud');
  if (opts.resumeChatId) args.push(`--resume=${opts.resumeChatId}`);
  else if (opts.resumeLatest) args.push('--resume');
  args.push(opts.prompt);
  return args;
}

/**
 * @typedef {Object} DelegateOpts
 * @property {string} prompt
 * @property {string} model
 * @property {string=} resumeChatId
 * @property {boolean=} resumeLatest
 * @property {boolean=} cloud
 * @property {boolean=} force
 * @property {boolean=} approveMcps
 * @property {string=} cwd
 * @property {number=} timeoutSec
 * @property {string} logPath
 * @property {(ev: Record<string, unknown>) => void=} onEvent
 * @property {(line: string) => void=} onRaw
 */

/**
 * @typedef {Object} DelegateResult
 * @property {number} exitCode
 * @property {Record<string, unknown>[]} events
 * @property {boolean} killed
 */

/**
 * @param {DelegateOpts} opts
 * @returns {Promise<DelegateResult>}
 */
export async function runHeadless(opts) {
  const bin = await resolveBin();
  const args = buildArgs(opts);
  const child = spawn(bin, args, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  if (!child.stdout || !child.stderr) {
    throw new Error('cursor-agent spawn failed: stdout/stderr not attached');
  }
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  const logStream = createWriteStream(opts.logPath, { flags: 'a' });
  /** @type {Record<string, unknown>[]} */
  const events = [];
  let sawResult = false;
  let killed = false;

  const stdoutLines = createInterface({ input: childStdout, crlfDelay: Infinity });
  stdoutLines.on('line', (line) => {
    logStream.write(line + '\n');
    if (opts.onRaw) opts.onRaw(line);
    const ev = parseLine(line);
    if (!ev) return;
    events.push(ev);
    if (opts.onEvent) opts.onEvent(ev);
    if (ev.type === 'result') {
      sawResult = true;
      setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
          killed = true;
          try {
            child.kill('SIGTERM');
          } catch {
            // noop
          }
          setTimeout(() => {
            if (!child.killed && child.exitCode === null) {
              try {
                child.kill('SIGKILL');
              } catch {
                // noop
              }
            }
          }, 5_000);
        }
      }, 5_000);
    }
  });

  const stderrLines = createInterface({ input: childStderr, crlfDelay: Infinity });
  stderrLines.on('line', (line) => {
    logStream.write(`# stderr: ${line}\n`);
  });

  let timeoutHandle;
  if (typeof opts.timeoutSec === 'number' && opts.timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // noop
      }
      setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // noop
          }
        }
      }, 5_000);
    }, opts.timeoutSec * 1_000);
  }

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => {
      resolve(typeof code === 'number' ? code : sawResult ? 0 : 1);
    });
  });
  if (timeoutHandle) clearTimeout(timeoutHandle);
  await new Promise((resolve) => logStream.end(() => resolve()));
  return { exitCode, events, killed };
}

/**
 * @returns {Promise<{loggedIn: boolean, detail: string}>}
 */
export async function authStatus() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['status'], { timeoutMs: 5_000 });
    const text = `${res.stdout}\n${res.stderr}`.toLowerCase();
    const loggedIn =
      res.exitCode === 0 &&
      (text.includes('logged in') || text.includes('authenticated') || text.includes('signed in'));
    return {
      loggedIn,
      detail: `${res.stdout}${res.stderr ? `\n${res.stderr}` : ''}`.trim(),
    };
  } catch (err) {
    return { loggedIn: false, detail: String(err) };
  }
}

/**
 * @returns {Promise<string[]>}
 */
export async function listModels() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['--list-models'], { timeoutMs: 10_000 });
    if (res.exitCode !== 0) {
      const fallback = await run(bin, ['models'], { timeoutMs: 10_000 });
      return fallback.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }
    return res.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @typedef {Object} McpEntry
 * @property {string} name
 * @property {string} status
 * @property {boolean} loaded
 */

/**
 * @returns {Promise<McpEntry[]>}
 */
export async function listConfiguredMcps() {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['mcp', 'list'], { timeoutMs: 5_000 });
    if (res.exitCode !== 0) return [];
    // Strip ANSI control sequences — cursor-agent writes them even under `run`.
    // eslint-disable-next-line no-control-regex
    const text = res.stdout.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    /** @type {McpEntry[]} */
    const out = [];
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('Loading')) continue;
      const match = line.match(/^([^:\s]+):\s*(.+)$/);
      if (!match) continue;
      const name = match[1];
      const status = match[2].trim();
      const lower = status.toLowerCase();
      const loaded = lower.startsWith('loaded') || lower === 'ok' || lower.includes('approved');
      out.push({ name, status, loaded });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * @typedef {Object} SessionSummary
 * @property {string} id
 * @property {string=} summary
 * @property {string=} updatedAt
 */

/**
 * @param {string} [cwd]
 * @returns {Promise<SessionSummary[]>}
 */
export async function listSessions(cwd = process.cwd()) {
  try {
    const bin = await resolveBin();
    const res = await run(bin, ['ls', '--output-format', 'json'], {
      cwd,
      timeoutMs: 5_000,
    });
    if (res.exitCode !== 0 || !res.stdout) return [];
    let parsed;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    /** @type {SessionSummary[]} */
    const out = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const id =
        (typeof row.id === 'string' && row.id) ||
        (typeof row.chat_id === 'string' && row.chat_id) ||
        (typeof row.chatId === 'string' && row.chatId);
      if (!id) continue;
      const summary =
        typeof row.summary === 'string'
          ? row.summary
          : typeof row.title === 'string'
            ? row.title
            : undefined;
      const updatedAt =
        typeof row.updated_at === 'string'
          ? row.updated_at
          : typeof row.updatedAt === 'string'
            ? row.updatedAt
            : undefined;
      /** @type {SessionSummary} */
      const entry = { id };
      if (summary !== undefined) entry.summary = summary;
      if (updatedAt !== undefined) entry.updatedAt = updatedAt;
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * @param {string} input
 * @returns {string}
 */
export function maskSecrets(input) {
  let out = input;
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 4) continue;
    if (/KEY|TOKEN|SECRET|PASSWORD/.test(name)) {
      out = out.split(value).join('***');
    }
  }
  return out;
}
