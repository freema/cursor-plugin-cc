#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collapseCommandArgv, parseArgv, parseTimeout } from './lib/args.mjs';
import { resolveModel, runHeadless } from './lib/cursor.mjs';
import { isGitRepo, repoRoot } from './lib/git.mjs';
import { id as newId } from './lib/id.mjs';
import {
  createJob,
  pruneOlderThanDays,
  rawLogPath as rawLogPathFor,
  updateJob,
} from './lib/jobs.mjs';
import { ensureDir, jobsDir, logsDir } from './lib/paths.mjs';
import { extractChatId, summariseEvents } from './lib/parse.mjs';

const BOOLEAN_FLAGS = [
  'background',
  'wait',
  'fresh',
  'force',
  'cloud',
  'git-check',
  'help',
  'resume',
];

function parseFlags(argv) {
  const { positional, flags } = parseArgv(argv, BOOLEAN_FLAGS);
  const fresh = Boolean(flags['fresh']);
  const cloud = Boolean(flags['cloud']);
  const noGitCheck =
    flags['gitCheck'] === false ||
    flags['git-check'] === false ||
    flags['no-git-check'] === true ||
    flags['noGitCheck'] === true;
  const explicitForceFlag = 'force' in flags ? Boolean(flags['force']) : undefined;
  const force = explicitForceFlag === undefined ? true : explicitForceFlag;
  // `--wait` forces the foreground even if `--background` is also present,
  // so it is a real toggle rather than a no-op.
  const explicitWait = flags['wait'] === true;
  const background = Boolean(flags['background']) && !explicitWait;
  const wait = !background;
  const timeout = parseTimeout(flags['timeout']);
  const resume = flags['resume'];
  const model = typeof flags['model'] === 'string' ? flags['model'] : undefined;
  const worker = typeof flags['worker'] === 'string' ? flags['worker'] : undefined;
  return {
    positional,
    model,
    background,
    wait,
    fresh,
    resume,
    force,
    cloud,
    timeout,
    noGitCheck,
    worker,
  };
}

function isResumeRequested(resume, fresh) {
  if (fresh) return false;
  if (resume === undefined) return false;
  if (typeof resume === 'boolean') return resume;
  // Any non-boolean value (string id, or a numeric id auto-cast by the parser)
  // means "resume" — with an explicit chat id when one was supplied.
  return true;
}

function resumeChatId(resume) {
  if (resume == null || typeof resume === 'boolean') return undefined;
  const s = String(resume).trim();
  if (s.length > 0 && s.toLowerCase() !== 'true') return s;
  return undefined;
}

async function foreground(flags, prompt, jobId, root) {
  const model = resolveModel(flags.model);
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(jobsDir(root));
  ensureDir(logsDir(root));
  createJob({
    id: jobId,
    repoPath: root,
    prompt,
    model,
    cloud: flags.cloud,
  });
  updateJob(root, jobId, { pid: process.pid });

  const resume = isResumeRequested(flags.resume, flags.fresh);
  const resumeId = resume ? resumeChatId(flags.resume) : undefined;

  process.stdout.write(`Job \`${jobId}\` started on model \`${model}\` (foreground).\n\n`);

  let toolCalls = 0;
  const result = await runHeadless({
    prompt,
    model,
    resumeChatId: resumeId,
    resumeLatest: resume && !resumeId,
    cloud: flags.cloud,
    force: flags.force,
    timeoutSec: flags.timeout,
    logPath,
    onEvent: (ev) => {
      const type = ev.type;
      if (type === 'tool_use' || type === 'tool_call' || type === 'tool') {
        toolCalls += 1;
        if (toolCalls <= 20) {
          const name =
            (typeof ev.name === 'string' && ev.name) ||
            (typeof ev.tool_name === 'string' && ev.tool_name) ||
            'tool';
          process.stdout.write(`• ${String(name)}\n`);
        } else if (toolCalls === 21) {
          process.stdout.write('• … (further tool calls omitted)\n');
        }
      }
    },
  });

  const summary = summariseEvents(result.events);
  const chatId = extractChatId(result.events);
  const status = result.exitCode === 0 && summary.success && !result.killed ? 'done' : 'failed';
  const killedNote = result.killed
    ? '\n\n[plugin post-flight]\nThe run was killed (timeout or watchdog) before finishing — output may be incomplete. Re-run with a larger `--timeout` if needed.'
    : '';

  updateJob(root, jobId, {
    status,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary: summary.summary + killedNote,
    filesTouched: summary.filesTouched,
    ...(chatId ? { cursorChatId: chatId } : {}),
  });

  process.stdout.write('\n---\n');
  process.stdout.write(`**Status:** ${status}\n`);
  if (result.killed)
    process.stdout.write('**⚠ Run was killed before finishing** (timeout/watchdog).\n');
  if (summary.filesTouched.length > 0) {
    process.stdout.write('**Files touched:**\n');
    for (const f of summary.filesTouched) process.stdout.write(`- ${f}\n`);
  }
  if (summary.summary) {
    process.stdout.write('\n**Summary:**\n\n');
    process.stdout.write(summary.summary.trim() + '\n');
  }
  if (chatId) {
    process.stdout.write(
      `\n**Cursor chat id:** \`${chatId}\` — resume with \`cursor-agent --resume=${chatId}\`.\n`,
    );
  }
  process.stdout.write(`\nRun \`/cursor:status ${jobId}\` for the full record.\n`);
  return result.exitCode;
}

function spawnBackground(jobId, argv, root, extraEnv = {}) {
  const selfPath = fileURLToPath(import.meta.url);
  // Base the capture logs on the resolved repo root (not process.cwd()) so they
  // land in the same jobs/<repo-hash>/ dir as the job record and NDJSON.
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(logsDir(root));
  const out = openSync(`${logPath}.stdout`, 'a');
  const err = openSync(`${logPath}.stderr`, 'a');
  const child = spawn(process.execPath, [selfPath, '--worker', jobId, ...argv], {
    detached: true,
    stdio: ['ignore', out, err],
    env: {
      ...process.env,
      CURSOR_PLUGIN_CC_WORKER: '1',
      CURSOR_PLUGIN_CC_REPO_ROOT: root,
      ...extraEnv,
    },
  });
  child.unref();
  return child.pid ?? -1;
}

async function runWorker(jobId, flags, prompt, root) {
  const model = resolveModel(flags.model);
  const logPath = rawLogPathFor(root, jobId);
  updateJob(root, jobId, { pid: process.pid, model });
  const resume = isResumeRequested(flags.resume, flags.fresh);
  const resumeId = resume ? resumeChatId(flags.resume) : undefined;
  const result = await runHeadless({
    prompt,
    model,
    resumeChatId: resumeId,
    resumeLatest: resume && !resumeId,
    cloud: flags.cloud,
    force: flags.force,
    timeoutSec: flags.timeout,
    logPath,
    onEvent: (ev) => {
      const chatId = ev.chat_id ?? ev.chatId ?? ev.session_id ?? ev.sessionId;
      if (typeof chatId === 'string' && chatId.length > 0) {
        try {
          updateJob(root, jobId, { cursorChatId: chatId });
        } catch {
          // noop
        }
      }
    },
  });
  const summary = summariseEvents(result.events);
  const chatId = extractChatId(result.events);
  const status = result.exitCode === 0 && summary.success && !result.killed ? 'done' : 'failed';
  const killedNote = result.killed
    ? '\n\n[plugin post-flight]\nThe run was killed (timeout or watchdog) before finishing — output may be incomplete.'
    : '';
  updateJob(root, jobId, {
    status,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary: summary.summary + killedNote,
    filesTouched: summary.filesTouched,
    ...(chatId ? { cursorChatId: chatId } : {}),
  });
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const flags = parseFlags(collapseCommandArgv(rawArgv));

  if (flags.worker) {
    // The prompt is handed over verbatim via env to avoid a second collapse
    // pass mangling quotes/backslashes; fall back to positional for safety.
    const prompt = process.env.CURSOR_PLUGIN_CC_PROMPT ?? flags.positional.join(' ').trim();
    const root = process.env.CURSOR_PLUGIN_CC_REPO_ROOT ?? (await repoRoot(process.cwd()));
    await runWorker(flags.worker, flags, prompt, root);
    return 0;
  }

  const prompt = flags.positional.join(' ').trim();
  if (!prompt && !isResumeRequested(flags.resume, flags.fresh)) {
    process.stderr.write('Error: no task description provided.\n');
    process.stderr.write('Usage: /cursor:delegate [flags] <task>\n');
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

  pruneOlderThanDays(root, 30);

  const jobId = newId(10);

  if (flags.background) {
    const model = resolveModel(flags.model);
    createJob({
      id: jobId,
      repoPath: root,
      prompt: prompt || '(resume)',
      model,
      background: true,
      cloud: flags.cloud,
    });
    const forwardedArgs = [];
    if (flags.model) forwardedArgs.push('--model', flags.model);
    if (flags.fresh) forwardedArgs.push('--fresh');
    if (flags.cloud) forwardedArgs.push('--cloud');
    if (flags.resume !== undefined) {
      if (typeof flags.resume === 'boolean') {
        if (flags.resume) forwardedArgs.push('--resume');
      } else {
        // String or numeric id — String() keeps a numeric id from being dropped.
        forwardedArgs.push(`--resume=${flags.resume}`);
      }
    }
    if (!flags.force) forwardedArgs.push('--no-force');
    forwardedArgs.push('--timeout', String(flags.timeout));
    const extraEnv = prompt ? { CURSOR_PLUGIN_CC_PROMPT: prompt } : {};
    const pid = spawnBackground(jobId, forwardedArgs, root, extraEnv);
    updateJob(root, jobId, { pid });
    process.stdout.write(
      `Job \`${jobId}\` started in background (model \`${model}\`, pid ${pid}).\n`,
    );
    process.stdout.write(`Check progress with \`/cursor:status ${jobId}\`.\n`);
    return 0;
  }

  return foreground(flags, prompt || '(resume)', jobId, root);
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `delegate failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
