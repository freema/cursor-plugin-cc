#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { collapseArguments, parseArgv } from './lib/argv.js';
import { listConfiguredMcps, resolveModel, runHeadless } from './lib/cursor.js';
import { isGitRepo, repoRoot } from './lib/git.js';
import { createJob, rawLogPath as rawLogPathFor, updateJob } from './lib/jobs.js';
import { ensureDir, jobsDir, logsDir } from './lib/paths.js';
import { extractChatId, summariseEvents } from './lib/parse.js';

const BOOLEAN_FLAGS = ['background', 'fresh', 'force', 'git-check', 'skip-mcp-check', 'help'];
const MCP_NAME = 'chrome-devtools';

function buildBrowserPrompt(url: string | undefined, what: string): string {
  const urlLine = url
    ? `**Target URL:** ${url}`
    : `**Target URL:** not supplied — you MUST discover it before testing. In order:\n  1. Call \`list_pages\` and if a \`localhost\` / \`127.0.0.1\` tab is already open, use that.\n  2. Otherwise read the repo for a dev-server URL: \`package.json\` scripts (look for \`dev\`, \`start\`, \`serve\`), \`vite.config.*\`, \`next.config.*\`, \`docker-compose.yml\`, \`.env*\`. Pick the most likely \`http://localhost:<port>\`.\n  3. If you still cannot determine a URL, try \`http://localhost:3000\`, \`:5173\`, \`:4173\`, \`:8080\`, \`:8000\` in that order — \`new_page\` each, \`wait_for\` a non-empty body, stop on the first that loads without a hard network error.\n  4. If NONE respond, stop and report "no dev server reachable" — do not invent a URL.`;
  return [
    `Verify the following in a real browser using the \`${MCP_NAME}\` MCP server.`,
    '',
    urlLine,
    `**What to verify:** ${what}`,
    '',
    '**Follow this flow (do not skip steps):**',
    '1. Call `list_pages` to see existing tabs.',
    `2. If no suitable tab exists, call \`new_page\` with the target URL. Otherwise call \`select_page\` on the right tab and \`navigate_page\` to the target URL (type: "url"). If the target URL was not supplied above, use your discovery result from step 1/2 of the URL-discovery block.`,
    '3. Call `take_snapshot` to get the accessibility tree with uids. Use those uids for every subsequent `click`, `fill`, `hover`, `press_key` — NEVER blind-click by coordinates or text.',
    '4. For each interaction that triggers async loading (navigation, form submit, language switch, reload), call `wait_for` with an expected text fragment before continuing.',
    '5. After the interaction is done, check for problems: call `list_console_messages` filtered to `error` and `list_network_requests` and scan for 4xx/5xx responses. Use `get_network_request` for details on anything suspicious.',
    '6. If you need runtime state (current locale, auth cookies, feature flags), use `evaluate_script` with a pure function `() => ({...})` returning a JSON-serialisable object. Do not mutate application state via `evaluate_script` unless the test explicitly requires it.',
    '7. Take a final `take_screenshot` as evidence.',
    '',
    '**Report back with:**',
    '- Overall PASS or FAIL.',
    '- For each failing assertion: what was expected, what was observed, the relevant console errors (if any), and any failing network responses.',
    '- The final screenshot filename (if one was captured).',
    '- Any notable findings that were not part of the explicit verification but look worth flagging.',
    '',
    '**Constraints:**',
    '- This is a **read-only test run.** Do NOT modify any source files, do NOT run `git` commands, do NOT install packages. If you find a bug, report it — do not attempt to fix it.',
    `- You MUST use the \`${MCP_NAME}\` MCP for every browser interaction. Do NOT fall back to \`curl\`, \`wget\`, \`fetch\`, \`http.get\`, or any shell-based HTTP client — a raw HTTP request is NOT a valid substitute for a browser check (it misses JS execution, DOM rendering, console/network signals). If the MCP is unavailable or a specific tool fails, STOP and report the MCP failure verbatim; do not improvise with anything else.`,
    '- Canvas-rendered text (e.g. inside `<canvas>` elements from Phaser/WebGL) is not readable via the DOM. For those, either use `evaluate_script` to query whatever the app exposes on `window`, or note the limitation in the report.',
    '- If the target URL is unreachable or returns a hard error on load, stop immediately and report the network/console evidence instead of pressing on.',
  ].join('\n');
}

interface ToolUse {
  name: string;
  input: unknown;
}

// Walks an event tree and yields every `tool_use` block it finds. Cursor's
// stream-json usually nests tool calls inside `assistant.message.content[]`
// (matching the Anthropic Messages API), but different models / versions may
// emit them at the top level, inside `tool`, or inside `tool_use`. We recurse
// so we don't care about the exact path.
function* extractToolUses(node: unknown): Iterable<ToolUse> {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* extractToolUses(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['type'];
  const name = typeof obj['name'] === 'string' ? (obj['name'] as string) : undefined;
  if ((type === 'tool_use' || type === 'tool_call') && name) {
    yield {
      name,
      input: obj['input'] ?? obj['arguments'] ?? obj['params'] ?? obj['tool_input'],
    };
  }
  for (const v of Object.values(obj)) yield* extractToolUses(v);
}

function usedBrowserMcp(events: Array<Record<string, unknown>>): boolean {
  for (const ev of events) {
    for (const tu of extractToolUses(ev)) {
      const name = tu.name.toLowerCase();
      if (
        name.includes('chrome') ||
        name.includes('devtools') ||
        name.startsWith('mcp_') ||
        name.includes('take_snapshot') ||
        name.includes('navigate_page') ||
        name.includes('list_pages') ||
        name.includes('new_page') ||
        name.includes('take_screenshot') ||
        name.includes('list_console_messages') ||
        name.includes('list_network_requests') ||
        name.includes('evaluate_script')
      ) {
        return true;
      }
    }
  }
  return false;
}

function usedBannedHttpClient(events: Array<Record<string, unknown>>): string[] {
  const hits = new Set<string>();
  for (const ev of events) {
    for (const tu of extractToolUses(ev)) {
      const name = tu.name.toLowerCase();
      if (name === 'bash' || name === 'shell' || name.includes('terminal') || name === 'exec') {
        const cmd =
          tu.input && typeof tu.input === 'object'
            ? String((tu.input as Record<string, unknown>)['command'] ?? '')
            : '';
        if (/\b(curl|wget|httpie|http\b)/i.test(cmd)) {
          hits.add(`${name}: ${cmd.slice(0, 100)}`);
        }
      }
    }
  }
  return [...hits];
}

interface BrowserFlags {
  url?: string | undefined;
  description: string;
  model?: string | undefined;
  background: boolean;
  fresh: boolean;
  force: boolean;
  noGitCheck: boolean;
  skipMcpCheck: boolean;
  timeout: number;
}

function looksLikeUrl(token: string): boolean {
  return (
    /^https?:\/\//i.test(token) || /^localhost(:\d+)?(\/|$)/i.test(token) || /^\/\//.test(token)
  );
}

function normaliseUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `http:${raw}`;
  if (/^localhost(:\d+)?/i.test(raw)) return `http://${raw}`;
  return raw;
}

function parseFlags(argv: string[]): BrowserFlags {
  const { positional, flags } = parseArgv(argv, BOOLEAN_FLAGS);
  const background = Boolean(flags['background']);
  const fresh = Boolean(flags['fresh']);
  const explicitForce = 'force' in flags ? Boolean(flags['force']) : undefined;
  const force = explicitForce === undefined ? true : explicitForce;
  const noGitCheck =
    flags['gitCheck'] === false ||
    flags['git-check'] === false ||
    flags['no-git-check'] === true ||
    flags['noGitCheck'] === true;
  const skipMcpCheck =
    flags['skip-mcp-check'] === true ||
    flags['skipMcpCheck'] === true ||
    flags['mcpCheck'] === false;
  const timeoutRaw = flags['timeout'];
  const timeout =
    typeof timeoutRaw === 'number' ? timeoutRaw : timeoutRaw ? Number(timeoutRaw) : 1800;
  const model = typeof flags['model'] === 'string' ? (flags['model'] as string) : undefined;

  let url: string | undefined;
  let descTokens: string[] = [];
  if (positional.length > 0 && positional[0] && looksLikeUrl(positional[0])) {
    url = normaliseUrl(positional[0]);
    descTokens = positional.slice(1);
  } else {
    descTokens = positional.slice();
  }
  const description = descTokens.join(' ').trim();

  return {
    url,
    description,
    model,
    background,
    fresh,
    force,
    noGitCheck,
    skipMcpCheck,
    timeout,
  };
}

async function preflightMcp(): Promise<{ ok: boolean; detail: string }> {
  const mcps = await listConfiguredMcps();
  if (mcps.length === 0) {
    return {
      ok: false,
      detail: `No MCP servers configured in \`cursor-agent\`. Configure \`${MCP_NAME}\` in your Cursor MCP config (usually \`~/.cursor/mcp.json\`), for example: {"mcpServers":{"${MCP_NAME}":{"command":"npx","args":["-y","chrome-devtools-mcp@latest","--isolated"]}}} — then restart Cursor to pick up the change.`,
    };
  }
  const match = mcps.find((m) => m.name === MCP_NAME);
  if (!match) {
    return {
      ok: false,
      detail: `\`${MCP_NAME}\` MCP is not configured. Configured MCPs: ${mcps
        .map((m) => m.name)
        .join(
          ', ',
        )}. Add \`${MCP_NAME}\` to your Cursor MCP config (usually \`~/.cursor/mcp.json\`) and restart Cursor.`,
    };
  }
  return { ok: true, detail: match.status };
}

export async function main(rawArgv: string[]): Promise<number> {
  const delimiterIdx = rawArgv.indexOf('--');
  const firstHalf = delimiterIdx === -1 ? [] : rawArgv.slice(0, delimiterIdx);
  const userRaw =
    delimiterIdx === -1 ? rawArgv.join(' ') : rawArgv.slice(delimiterIdx + 1).join(' ');
  const combined = [...firstHalf, ...collapseArguments(userRaw)];
  const flags = parseFlags(combined);

  if (flags.description.length === 0) {
    process.stderr.write(
      'Error: no test description. Usage: `/cursor:browser [<url>] <what to verify...>`. URL is optional — if omitted, Cursor discovers it from `list_pages` / package.json / common ports. Examples: `/cursor:browser http://localhost:3000 "login flow works"` or `/cursor:browser "check the home page loads without console errors"`.\n',
    );
    return 2;
  }

  const inGit = await isGitRepo(process.cwd());
  if (!inGit && !flags.noGitCheck) {
    process.stderr.write(
      'Error: current directory is not a git repository. Pass --no-git-check to override.\n',
    );
    return 2;
  }
  const root = await repoRoot(process.cwd());

  if (!flags.skipMcpCheck) {
    const preflight = await preflightMcp();
    if (!preflight.ok) {
      process.stderr.write(`Error: ${preflight.detail}\n`);
      process.stderr.write(
        'Pass --skip-mcp-check to run anyway (e.g. if `cursor-agent mcp list` cannot reach its config).\n',
      );
      return 2;
    }
  }

  const model = resolveModel(flags.model);
  const prompt = buildBrowserPrompt(flags.url, flags.description);
  const jobId = nanoid(10);
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(jobsDir(root));
  ensureDir(logsDir(root));
  const urlLabel = flags.url ?? '(discover)';
  createJob({
    id: jobId,
    repoPath: root,
    prompt: `BROWSER: ${urlLabel} — ${flags.description}`,
    model,
  });
  updateJob(root, jobId, { pid: process.pid });

  process.stdout.write(
    `Browser job \`${jobId}\` started against \`${urlLabel}\` (model \`${model}\`, MCP \`${MCP_NAME}\`).\n\n`,
  );

  let toolCalls = 0;
  const result = await runHeadless({
    prompt,
    model,
    cloud: false,
    force: flags.force,
    approveMcps: true,
    timeoutSec: flags.timeout,
    logPath,
    onEvent: (ev) => {
      for (const tu of extractToolUses(ev as unknown)) {
        toolCalls += 1;
        if (toolCalls <= 30) {
          const short = tu.name.replace(/^mcp_chrome-devtools_/, 'cdt:');
          process.stdout.write(`• ${short}\n`);
        } else if (toolCalls === 31) {
          process.stdout.write('• … (further tool calls omitted)\n');
        }
      }
    },
  });

  const summary = summariseEvents(result.events);
  const chatId = extractChatId(result.events);
  const eventsAsRec = result.events as unknown as Array<Record<string, unknown>>;
  const mcpUsed = usedBrowserMcp(eventsAsRec);
  const httpFallbacks = usedBannedHttpClient(eventsAsRec);
  const hadBrowserTools = toolCalls > 0;

  let status: 'done' | 'failed' = result.exitCode === 0 && summary.success ? 'done' : 'failed';
  const warnings: string[] = [];

  if (!mcpUsed && hadBrowserTools) {
    status = 'failed';
    warnings.push(
      `The run never called the \`${MCP_NAME}\` MCP. Browser verification requires real-browser tools — this result is NOT valid. Approve the \`${MCP_NAME}\` MCP in Cursor (usually needs a Cursor restart after editing \`~/.cursor/mcp.json\`) and re-run.`,
    );
  }
  if (httpFallbacks.length > 0) {
    status = 'failed';
    warnings.push(
      `The run fell back to a raw HTTP client instead of using the MCP. Banned calls detected:\n  - ${httpFallbacks.join('\n  - ')}\nA curl/wget/fetch check is not a browser test. Re-run after fixing the MCP.`,
    );
  }
  if (!hadBrowserTools && result.exitCode === 0) {
    warnings.push(
      'The run completed but issued no tool calls at all — likely the prompt was interpreted as a question rather than a test. Re-run with a more concrete verification instruction.',
    );
  }

  updateJob(root, jobId, {
    status,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary:
      warnings.length > 0
        ? `${summary.summary}\n\n[plugin post-flight]\n${warnings.join('\n\n')}`
        : summary.summary,
    filesTouched: summary.filesTouched,
    ...(chatId ? { cursorChatId: chatId } : {}),
  });

  process.stdout.write('\n---\n');
  process.stdout.write(`**Status:** ${status}\n`);
  if (summary.summary) {
    process.stdout.write('\n**Report:**\n\n');
    process.stdout.write(summary.summary.trim() + '\n');
  }
  if (warnings.length > 0) {
    process.stdout.write('\n**⚠ Post-flight warnings:**\n\n');
    for (const w of warnings) process.stdout.write(`- ${w}\n`);
  }
  if (chatId) {
    process.stdout.write(
      `\n**Cursor chat id:** \`${chatId}\` — follow up with \`/cursor:resume\` or \`cursor-agent --resume=${chatId}\`.\n`,
    );
  }
  process.stdout.write(`\nRun \`/cursor:status ${jobId}\` for the full record.\n`);
  // Always return Cursor's own exit code. A post-flight warning is metadata —
  // the report itself is what the user wants to see, so we never flip a
  // successful shell exit into a failure just because the check is advisory.
  return result.exitCode;
}

const invokedAsScript = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `browser failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
