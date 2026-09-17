import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readdirSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { createInterface } from 'node:readline';
import { parseLine } from './parse.mjs';
import { run } from './run.mjs';

// Convenience aliases that map shortcuts to real Cursor model ids. Cursor
// rotates these over time — `/cursor:setup --print-models` shows the live
// list for the current account. Unknown ids are passed through verbatim.
export const MODEL_ALIASES = {
  // Short shortcuts point at Cursor's current Composer line (2.5).
  composer: 'composer-2.5-fast',
  'composer-fast': 'composer-2.5-fast',
  fast: 'composer-2.5-fast',
  'composer-full': 'composer-2.5',
  // Current Composer ids (identity — also documents the live names).
  'composer-2.5-fast': 'composer-2.5-fast',
  'composer-2.5': 'composer-2.5',
  // Retired Composer ids kept as passthrough for older cursor-agent builds.
  'composer-2-fast': 'composer-2-fast',
  'composer-2': 'composer-2',
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
  grok: 'grok-4.3',
  'grok-4.3': 'grok-4.3',
  'grok-build': 'grok-build-0.1',
  gemini: 'gemini-3.1-pro',
  'gemini-pro': 'gemini-3.1-pro',
  'gemini-flash': 'gemini-3-flash',
};

// `auto` lets Cursor pick whatever model the account is entitled to —
// safe default for users without a paid Composer seat. Power users
// can override per-invocation via `--model <id>` or globally via the env var
// CURSOR_PLUGIN_CC_DEFAULT_MODEL.
export const DEFAULT_MODEL = 'auto';

/**
 * @returns {string}
 */
export function defaultModel() {
  const fromEnv = process.env.CURSOR_PLUGIN_CC_DEFAULT_MODEL;
  if (fromEnv && fromEnv.trim().length > 0) {
    const key = fromEnv.trim().toLowerCase();
    return MODEL_ALIASES[key] ?? fromEnv.trim();
  }
  return DEFAULT_MODEL;
}

/**
 * @param {string|undefined} input
 * @returns {string}
 */
export function resolveModel(input) {
  if (!input || input.trim() === '') return defaultModel();
  const key = input.trim().toLowerCase();
  return MODEL_ALIASES[key] ?? input.trim();
}

/**
 * How to launch cursor-agent: an executable plus the arguments that precede
 * cursor-agent's own. `args` is empty except on Windows, where the CLI is
 * `node.exe index.js` (see resolveWindowsInstall).
 *
 * @typedef {Object} CursorAgentBin
 * @property {string} command
 * @property {string[]} args
 */

/** @type {CursorAgentBin|null} */
let cachedBin = null;

/**
 * @returns {Promise<CursorAgentBin>}
 */
export async function resolveBin() {
  if (cachedBin) return cachedBin;
  const override = process.env.CURSOR_AGENT_BIN?.trim();
  if (override && override.length > 0) {
    cachedBin = (process.platform === 'win32' && resolveWindowsPath(override)) || {
      command: override,
      args: [],
    };
    return cachedBin;
  }
  const found = process.platform === 'win32' ? await findOnWindows() : await findOnPath();
  if (found) {
    cachedBin = found;
    return cachedBin;
  }
  throw new Error(
    'cursor-agent not found on PATH. Install from https://cursor.com/install or run /cursor:setup.',
  );
}

/**
 * @param {CursorAgentBin} bin
 * @returns {string}
 */
export function describeBin(bin) {
  return [bin.command, ...bin.args].join(' ');
}

/**
 * Run cursor-agent with `args` through the resolved launcher.
 *
 * @param {string[]} args
 * @param {import('./run.mjs').RunOpts} [opts]
 * @returns {Promise<import('./run.mjs').RunResult>}
 */
export async function runAgent(args, opts) {
  const bin = await resolveBin();
  return run(bin.command, [...bin.args, ...args], opts);
}

/**
 * @returns {Promise<CursorAgentBin|null>}
 */
async function findOnPath() {
  for (const candidate of ['cursor-agent', 'agent']) {
    const res = await run('which', [candidate]);
    if (res.exitCode === 0 && res.stdout.trim()) {
      return { command: res.stdout.trim(), args: [] };
    }
  }
  return null;
}

/**
 * Windows has no `which`, and the official installer puts only `.cmd`/`.ps1`
 * shims on PATH. `where` finds a shim and the runnable CLI is resolved from
 * the install beside it. The default install location is the fallback for a
 * PATH inherited from before the install — the installer only updates PATH
 * for shells started afterwards.
 *
 * Both `where` and spawn() look in the current directory before PATH, so a
 * repository could plant its own `where.exe` or `cursor-agent.exe`. Hence the
 * absolute `where.exe` and the `$PATH:` pattern, which searches PATH only.
 *
 * @returns {Promise<CursorAgentBin|null>}
 */
async function findOnWindows() {
  const where = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');
  for (const candidate of ['cursor-agent', 'agent']) {
    const res = await run(where, [`$PATH:${candidate}`]);
    if (res.exitCode !== 0) continue;
    for (const line of res.stdout.split(/\r?\n/)) {
      const found = resolveWindowsPath(line.trim());
      if (found) return found;
    }
  }
  const localAppData = process.env.LOCALAPPDATA;
  return localAppData ? resolveWindowsInstall(join(localAppData, 'cursor-agent')) : null;
}

/**
 * Since Node's CVE-2024-27980 fix, spawn() rejects `.cmd`/`.bat` files unless
 * it goes through a shell (EINVAL), so a shim path is translated into the
 * install it launches. An `.exe` is spawnable as is; anything else is not a
 * Windows launcher.
 *
 * @param {string} path
 * @returns {CursorAgentBin|null}
 */
export function resolveWindowsPath(path) {
  const ext = win32.extname(path).toLowerCase();
  if (ext === '.exe') return { command: path, args: [] };
  if (ext === '.cmd' || ext === '.bat' || ext === '.ps1') {
    return resolveWindowsInstall(win32.dirname(path));
  }
  return null;
}

// Version directory names the official cursor-agent.ps1 accepts: the legacy
// YYYY.MM.DD-commit form and YYYY.MM.DD-HH-MM-SS-commit with a build time.
const VERSION_DIR_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/;

/**
 * Newest first, non-version names dropped. cursor-agent.ps1 ranks by date
 * only; same-day builds are additionally ordered by build time here, with the
 * legacy form counting as midnight.
 *
 * @param {string[]} names
 * @returns {string[]}
 */
export function sortVersionDirs(names) {
  /** @type {{name: string, key: number[]}[]} */
  const versions = [];
  for (const name of names) {
    const match = VERSION_DIR_RE.exec(name);
    if (match) versions.push({ name, key: match.slice(1, 7).map((part) => Number(part ?? 0)) });
  }
  versions.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i];
    }
    return 0;
  });
  return versions.map((v) => v.name);
}

/**
 * Mirror of what the official cursor-agent.ps1 shim runs: a `node.exe` next
 * to the shim if there is one, otherwise the newest `versions\<version>\`.
 * Unlike the shim, a version directory without `node.exe` and `index.js`
 * (an interrupted update) is skipped instead of being fatal.
 *
 * @param {string} root  Directory holding the shims, e.g. %LOCALAPPDATA%\cursor-agent.
 * @returns {CursorAgentBin|null}
 */
export function resolveWindowsInstall(root) {
  const dirs = [root];
  try {
    const entries = readdirSync(join(root, 'versions'), { withFileTypes: true });
    const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    for (const name of sortVersionDirs(names)) dirs.push(join(root, 'versions', name));
  } catch {
    // No versions directory — only a node.exe beside the shim can work.
  }
  for (const dir of dirs) {
    const node = join(dir, 'node.exe');
    const entry = join(dir, 'index.js');
    if (existsSync(node) && existsSync(entry)) return { command: node, args: [entry] };
  }
  return null;
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
 * Flags only — the prompt itself travels over stdin (see runHeadless).
 * Windows caps the entire command line at 32,767 characters, which a
 * review diff blows straight past; stdin has no such limit.
 *
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
  const child = spawn(bin.command, [...bin.args, ...buildArgs(opts)], {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error('cursor-agent spawn failed: stdio not attached');
  }
  // EPIPE fires when the child dies before draining stdin (bad model id,
  // auth failure) — the close handler already reports that exit.
  child.stdin.on('error', () => {});
  child.stdin.end(opts.prompt);
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  const logStream = createWriteStream(opts.logPath, { flags: 'a' });
  // A failed log write (ENOSPC/EACCES/missing dir) must not crash the process
  // and orphan the running cursor-agent — degrade to in-memory only.
  let logBroken = false;
  logStream.on('error', () => {
    logBroken = true;
  });
  const logSafe = (s) => {
    if (logBroken) return;
    try {
      logStream.write(s);
    } catch {
      logBroken = true;
    }
  };
  /** @type {Record<string, unknown>[]} */
  const events = [];
  let sawResult = false;
  let killed = false;

  const stdoutLines = createInterface({ input: childStdout, crlfDelay: Infinity });
  stdoutLines.on('line', (line) => {
    logSafe(line + '\n');
    if (opts.onRaw) opts.onRaw(line);
    const ev = parseLine(line);
    if (!ev) return;
    events.push(ev);
    if (opts.onEvent) opts.onEvent(ev);
    // Arm the post-result watchdog at most once — cursor-agent can emit
    // several `result` events, and re-arming would stack redundant timers.
    if (ev.type === 'result' && !sawResult) {
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
    logSafe(`# stderr: ${line}\n`);
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
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    // Without an 'error' handler a spawn failure (missing/non-executable
    // binary) emits an uncaught exception that kills the process.
    child.on('error', (err) => {
      logSafe(`# spawn error: ${err instanceof Error ? err.message : String(err)}\n`);
      done(sawResult ? 0 : 1);
    });
    child.on('close', (code) => {
      done(typeof code === 'number' ? code : sawResult ? 0 : 1);
    });
  });
  if (timeoutHandle) clearTimeout(timeoutHandle);
  await new Promise((resolve) => {
    try {
      logStream.end(() => resolve());
    } catch {
      resolve();
    }
  });
  return { exitCode, events, killed };
}

/**
 * @returns {Promise<{loggedIn: boolean, detail: string}>}
 */
export async function authStatus() {
  try {
    const res = await runAgent(['status'], { timeoutMs: 5_000 });
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
    const res = await runAgent(['--list-models'], { timeoutMs: 10_000 });
    if (res.exitCode !== 0) {
      const fallback = await runAgent(['models'], { timeoutMs: 10_000 });
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
    const res = await runAgent(['mcp', 'list'], { timeoutMs: 5_000 });
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
    const res = await runAgent(['ls', '--output-format', 'json'], {
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
