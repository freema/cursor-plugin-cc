import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { execa } from 'execa';
import { parseLine, type CursorEvent } from './parse.js';

// Aliases map convenience names to concrete Cursor model ids as returned by
// `cursor-agent --list-models`. Cursor rotates these over time — run
// `/cursor:setup --print-models` to see the live list for your account.
export const MODEL_ALIASES: Record<string, string> = {
  // Composer (Cursor's own fast executor — default)
  composer: 'composer-2-fast',
  'composer-fast': 'composer-2-fast',
  fast: 'composer-2-fast',
  'composer-2-fast': 'composer-2-fast',
  'composer-2': 'composer-2',
  'composer-full': 'composer-2',
  'composer-1.5': 'composer-1.5',
  // Auto-routing
  auto: 'auto',
  // Claude Sonnet
  sonnet: 'claude-4.6-sonnet-medium',
  'sonnet-4.6': 'claude-4.6-sonnet-medium',
  'sonnet-4.6-thinking': 'claude-4.6-sonnet-medium-thinking',
  'sonnet-4.5': 'claude-4.5-sonnet',
  'sonnet-4.5-thinking': 'claude-4.5-sonnet-thinking',
  'sonnet-4': 'claude-4-sonnet',
  // Claude Opus
  opus: 'claude-opus-4-7-high',
  'opus-4.7': 'claude-opus-4-7-high',
  'opus-4.7-max': 'claude-opus-4-7-max',
  'opus-4.7-thinking': 'claude-opus-4-7-thinking-high',
  'opus-4.6': 'claude-4.6-opus-high',
  // OpenAI Codex / GPT
  gpt: 'gpt-5.3-codex',
  codex: 'gpt-5.3-codex',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'gpt-5.3-codex-fast': 'gpt-5.3-codex-fast',
  'gpt-5.3-codex-high': 'gpt-5.3-codex-high',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.2': 'gpt-5.2',
  // Others
  grok: 'grok-4-20',
  'grok-thinking': 'grok-4-20-thinking',
  gemini: 'gemini-3.1-pro',
  'gemini-pro': 'gemini-3.1-pro',
  'gemini-flash': 'gemini-3-flash',
};

// Cursor's own default is `composer-2-fast` (marked "(current, default)" by
// `cursor-agent --list-models`). It is the fastest Composer variant — the
// right choice for the delegate-and-move-on flow this plugin optimises for.
export const DEFAULT_MODEL = 'composer-2-fast';

export function resolveModel(input: string | undefined): string {
  if (!input || input.trim() === '') return DEFAULT_MODEL;
  const key = input.trim().toLowerCase();
  return MODEL_ALIASES[key] ?? input.trim();
}

let cachedBin: string | null = null;

export async function resolveBin(): Promise<string> {
  if (cachedBin) return cachedBin;
  const override = process.env.CURSOR_AGENT_BIN;
  if (override && override.trim().length > 0) {
    cachedBin = override;
    return cachedBin;
  }
  for (const candidate of ['cursor-agent', 'agent']) {
    try {
      const res = await execa('which', [candidate], { reject: false });
      if (res.exitCode === 0 && typeof res.stdout === 'string' && res.stdout.trim()) {
        cachedBin = res.stdout.trim();
        return cachedBin;
      }
    } catch {
      continue;
    }
  }
  throw new Error(
    'cursor-agent not found on PATH. Install from https://cursor.com/install or run /cursor:setup.',
  );
}

export interface DelegateOpts {
  prompt: string;
  model: string;
  resumeChatId?: string | undefined;
  resumeLatest?: boolean;
  cloud?: boolean;
  force?: boolean;
  approveMcps?: boolean;
  cwd?: string;
  timeoutSec?: number;
  logPath: string;
  onEvent?: (ev: CursorEvent) => void;
  onRaw?: (line: string) => void;
}

export interface DelegateResult {
  exitCode: number;
  events: CursorEvent[];
  child: ChildProcess;
  killed: boolean;
}

export function buildArgs(opts: {
  prompt: string;
  model: string;
  resumeChatId?: string | undefined;
  resumeLatest?: boolean;
  cloud?: boolean;
  force?: boolean;
  approveMcps?: boolean;
}): string[] {
  const args: string[] = ['-p', '--output-format', 'stream-json', '--trust', '--model', opts.model];
  if (opts.force !== false) {
    args.push('--force');
  }
  if (opts.approveMcps) {
    args.push('--approve-mcps');
  }
  if (opts.cloud) {
    args.push('--cloud');
  }
  if (opts.resumeChatId) {
    args.push(`--resume=${opts.resumeChatId}`);
  } else if (opts.resumeLatest) {
    args.push('--resume');
  }
  args.push(opts.prompt);
  return args;
}

export async function runHeadless(opts: DelegateOpts): Promise<DelegateResult> {
  const bin = await resolveBin();
  const args = buildArgs(opts);
  const child = spawn(bin, args, {
    cwd: opts.cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const logStream = createWriteStream(opts.logPath, { flags: 'a' });
  const events: CursorEvent[] = [];
  let sawResult = false;
  let killed = false;

  if (!child.stdout || !child.stderr) {
    throw new Error('cursor-agent spawn failed: stdout/stderr not attached');
  }
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  const stdoutLines = createInterface({ input: childStdout, crlfDelay: Infinity });
  stdoutLines.on('line', (line) => {
    logStream.write(line + '\n');
    if (opts.onRaw) opts.onRaw(line);
    const ev = parseLine(line);
    if (!ev) return;
    events.push(ev);
    if (opts.onEvent) opts.onEvent(ev);
    if (ev['type'] === 'result') {
      sawResult = true;
      setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
          killed = true;
          try {
            child.kill('SIGTERM');
          } catch {
            /* noop */
          }
          setTimeout(() => {
            if (!child.killed && child.exitCode === null) {
              try {
                child.kill('SIGKILL');
              } catch {
                /* noop */
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

  let timeoutHandle: NodeJS.Timeout | undefined;
  if (typeof opts.timeoutSec === 'number' && opts.timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      killed = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* noop */
      }
      setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* noop */
          }
        }
      }, 5_000);
    }, opts.timeoutSec * 1_000);
  }

  const exitCode: number = await new Promise((resolve) => {
    child.on('close', (code) => {
      resolve(typeof code === 'number' ? code : sawResult ? 0 : 1);
    });
  });

  if (timeoutHandle) clearTimeout(timeoutHandle);
  await new Promise<void>((resolve) => logStream.end(() => resolve()));

  return { exitCode, events, child, killed };
}

export async function authStatus(): Promise<{ loggedIn: boolean; detail: string }> {
  try {
    const bin = await resolveBin();
    const res = await execa(bin, ['status'], { reject: false, timeout: 5_000 });
    const text = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.toLowerCase();
    const loggedIn =
      res.exitCode === 0 &&
      (text.includes('logged in') || text.includes('authenticated') || text.includes('signed in'));
    return { loggedIn, detail: `${res.stdout ?? ''}${res.stderr ? `\n${res.stderr}` : ''}`.trim() };
  } catch (err) {
    return { loggedIn: false, detail: String(err) };
  }
}

export interface McpEntry {
  name: string;
  status: string;
  loaded: boolean;
}

export async function listConfiguredMcps(): Promise<McpEntry[]> {
  try {
    const bin = await resolveBin();
    const res = await execa(bin, ['mcp', 'list'], { reject: false, timeout: 5_000 });
    if (res.exitCode !== 0) return [];
    const out: McpEntry[] = [];
    // Strip ANSI color/cursor control codes — cursor-agent writes them even in pipe mode.
    // eslint-disable-next-line no-control-regex
    const text = String(res.stdout ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('Loading')) continue;
      const match = line.match(/^([^:\s]+):\s*(.+)$/);
      if (!match) continue;
      const name = match[1]!;
      const status = match[2]!.trim();
      const lower = status.toLowerCase();
      const loaded = lower.startsWith('loaded') || lower === 'ok' || lower.includes('approved');
      out.push({ name, status, loaded });
    }
    return out;
  } catch {
    return [];
  }
}

export async function listModels(): Promise<string[]> {
  try {
    const bin = await resolveBin();
    const res = await execa(bin, ['--list-models'], { reject: false, timeout: 10_000 });
    if (res.exitCode !== 0) {
      const fallback = await execa(bin, ['models'], { reject: false, timeout: 10_000 });
      return (fallback.stdout ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }
    return (res.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export interface SessionSummary {
  id: string;
  summary?: string;
  updatedAt?: string;
}

export async function listSessions(cwd: string = process.cwd()): Promise<SessionSummary[]> {
  try {
    const bin = await resolveBin();
    const res = await execa(bin, ['ls', '--output-format', 'json'], {
      cwd,
      reject: false,
      timeout: 5_000,
    });
    if (res.exitCode !== 0 || !res.stdout) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.stdout);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const out: SessionSummary[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const id =
        (typeof rec['id'] === 'string' && rec['id']) ||
        (typeof rec['chat_id'] === 'string' && rec['chat_id']) ||
        (typeof rec['chatId'] === 'string' && rec['chatId']);
      if (!id) continue;
      const summary =
        typeof rec['summary'] === 'string'
          ? (rec['summary'] as string)
          : typeof rec['title'] === 'string'
            ? (rec['title'] as string)
            : undefined;
      const updatedAt =
        typeof rec['updated_at'] === 'string'
          ? (rec['updated_at'] as string)
          : typeof rec['updatedAt'] === 'string'
            ? (rec['updatedAt'] as string)
            : undefined;
      const entry: SessionSummary = { id: id as string };
      if (summary !== undefined) entry.summary = summary;
      if (updatedAt !== undefined) entry.updatedAt = updatedAt;
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

export function maskSecrets(input: string): string {
  let out = input;
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 4) continue;
    if (/KEY|TOKEN|SECRET|PASSWORD/.test(name)) {
      out = out.split(value).join('***');
    }
  }
  return out;
}
