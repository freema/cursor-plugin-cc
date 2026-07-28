#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { collapseCommandArgv, parseArgv, parseTimeout } from './lib/args.mjs';
import { resolveModel, runHeadless } from './lib/cursor.mjs';
import { collectReviewContext, isGitRepo, repoRoot } from './lib/git.mjs';
import { id as newId } from './lib/id.mjs';
import {
  createJob,
  pruneOlderThanDays,
  rawLogPath as rawLogPathFor,
  updateJob,
} from './lib/jobs.mjs';
import { ensureDir, jobsDir, logsDir } from './lib/paths.mjs';
import { extractChatId, summariseEvents } from './lib/parse.mjs';
import { interpolateTemplate, loadPromptTemplate } from './lib/prompts.mjs';
import { parseReviewOutput, stripJsonBlock } from './lib/review-output.mjs';

const BOOLEAN_FLAGS = ['background', 'wait', 'adversarial', 'git-check', 'help'];

function parseFlags(argv) {
  const { positional, flags } = parseArgv(argv, BOOLEAN_FLAGS);
  const background = Boolean(flags['background']);
  const wait = 'wait' in flags ? Boolean(flags['wait']) : !background;
  const adversarial = Boolean(flags['adversarial']);
  const noGitCheck =
    flags['gitCheck'] === false ||
    flags['git-check'] === false ||
    flags['no-git-check'] === true ||
    flags['noGitCheck'] === true;
  const base =
    typeof flags['base'] === 'string' && flags['base'].trim() ? flags['base'].trim() : undefined;
  const scopeRaw =
    typeof flags['scope'] === 'string' ? flags['scope'].trim().toLowerCase() : 'auto';
  const scope = ['auto', 'working-tree', 'branch'].includes(scopeRaw) ? scopeRaw : 'auto';
  const model = typeof flags['model'] === 'string' ? flags['model'] : undefined;
  const timeout = parseTimeout(flags['timeout']);
  const worker = typeof flags['worker'] === 'string' ? flags['worker'] : undefined;
  const focus = positional.join(' ').trim();
  return { focus, model, background, wait, adversarial, base, scope, timeout, noGitCheck, worker };
}

export function buildReviewPrompt({ label, body, focus, adversarial }) {
  const template = loadPromptTemplate('review');
  return interpolateTemplate(template, {
    ROLE: adversarial
      ? 'You are a skeptical senior engineer running an ADVERSARIAL review. Challenge whether the chosen implementation and design are the right approach — question assumptions, tradeoffs, and failure modes, not only the implementation defects.'
      : 'You are a senior code reviewer.',
    REVIEW_TARGET: label,
    FOCUS_BLOCK: focus ? `**Reviewer focus (prioritise this):** ${focus}` : '',
    BODY: body,
    ADVERSARIAL_GUIDANCE: adversarial
      ? '- Challenge the design: is this the right approach? What assumptions does it rest on? Where does it break under real-world load, concurrency, or edge cases?\n- Would a different approach be simpler, safer, or cheaper to maintain? If so, say what and why — but stay grounded in the diff, do not invent requirements.'
      : '',
  });
}

function renderResult(out, { jobId, status, summary, chatId, warnings }) {
  out('\n---\n');
  out(`**Status:** ${status}\n`);
  if (summary.summary) {
    out('\n**Review:**\n\n');
    out(summary.summary.trim() + '\n');
  }
  if (warnings.length > 0) {
    out('\n**⚠ Post-flight warnings:**\n\n');
    for (const w of warnings) out(`- ${w}\n`);
  }
  if (chatId) {
    out(
      `\n**Cursor chat id:** \`${chatId}\` — follow up with \`/cursor:resume\` or \`cursor-agent --resume=${chatId}\`.\n`,
    );
  }
  out(`\nRun \`/cursor:status ${jobId}\` for the full record.\n`);
}

function postFlightWarnings(summary) {
  const warnings = [];
  if (summary.filesTouched.length > 0) {
    warnings.push(
      `This was a read-only review, but the run touched ${summary.filesTouched.length} file(s): ${summary.filesTouched.join(
        ', ',
      )}. Inspect your working tree — the reviewer should not have written anything.`,
    );
  }
  return warnings;
}

async function runReview({ flags, context, jobId, root, onEvent }) {
  const model = resolveModel(flags.model);
  const logPath = rawLogPathFor(root, jobId);
  const prompt = buildReviewPrompt({
    label: context.label,
    body: context.body,
    focus: flags.focus,
    adversarial: flags.adversarial,
  });
  const result = await runHeadless({
    prompt,
    model,
    cloud: false,
    force: flags.force,
    timeoutSec: flags.timeout,
    logPath,
    onEvent,
  });
  const summary = summariseEvents(result.events);
  const chatId = extractChatId(result.events);
  const warnings = postFlightWarnings(summary);
  const status =
    result.exitCode === 0 && summary.success && warnings.length === 0 ? 'done' : 'failed';
  // The prompt asks the reviewer to append a fenced ```json verdict block
  // (schemas/review-output.schema.json). When it parses, store the data on
  // the record and hide the raw fence from the human-facing summary.
  const structured = parseReviewOutput(summary.summary ?? '');
  const displaySummary = structured.ok ? stripJsonBlock(summary.summary ?? '') : summary.summary;
  updateJob(root, jobId, {
    status,
    exitCode: result.exitCode,
    finishedAt: new Date().toISOString(),
    summary:
      warnings.length > 0
        ? `${displaySummary}\n\n[plugin post-flight]\n${warnings.join('\n\n')}`
        : displaySummary,
    filesTouched: summary.filesTouched,
    ...(structured.ok ? { review: structured.data } : {}),
    ...(chatId ? { cursorChatId: chatId } : {}),
  });
  return { result, summary: { ...summary, summary: displaySummary }, chatId, warnings, status };
}

async function foreground(flags, context, jobId, root) {
  const model = resolveModel(flags.model);
  ensureDir(jobsDir(root));
  ensureDir(logsDir(root));
  createJob({ id: jobId, repoPath: root, prompt: `REVIEW: ${context.label}`, model });
  updateJob(root, jobId, { pid: process.pid });

  process.stdout.write(
    `Review job \`${jobId}\` started — ${context.label} (model \`${model}\`${
      flags.adversarial ? ', adversarial' : ''
    }).\n\n`,
  );

  let toolCalls = 0;
  const { status, summary, chatId, warnings, result } = await runReview({
    flags,
    context,
    jobId,
    root,
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

  renderResult((s) => process.stdout.write(s), { jobId, status, summary, chatId, warnings });
  return result.exitCode;
}

function spawnBackground(jobId, argv, root) {
  const selfPath = fileURLToPath(import.meta.url);
  // Base capture logs on the resolved repo root so they share the job's
  // jobs/<repo-hash>/ dir, and forward that root to the worker.
  const logPath = rawLogPathFor(root, jobId);
  ensureDir(logsDir(root));
  const out = openSync(`${logPath}.stdout`, 'a');
  const err = openSync(`${logPath}.stderr`, 'a');
  const child = spawn(process.execPath, [selfPath, '--worker', jobId, ...argv], {
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env, CURSOR_PLUGIN_CC_WORKER: '1', CURSOR_PLUGIN_CC_REPO_ROOT: root },
  });
  child.unref();
  return child.pid ?? -1;
}

async function runWorker(jobId, flags, root) {
  const context = await collectReviewContext(root, { scope: flags.scope, base: flags.base });
  if (context.error || context.isEmpty) {
    updateJob(root, jobId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      summary: context.error ?? 'Nothing to review.',
    });
    return;
  }
  updateJob(root, jobId, { pid: process.pid });
  await runReview({
    flags,
    context,
    jobId,
    root,
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
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const flags = parseFlags(collapseCommandArgv(rawArgv));
  // `cursor-agent --force` auto-approves any read tool the reviewer wants to
  // run for extra context; the prompt forbids writes and a post-flight check
  // flags any file the run touched anyway.
  flags.force = true;

  if (flags.worker) {
    const root = process.env.CURSOR_PLUGIN_CC_REPO_ROOT ?? (await repoRoot(process.cwd()));
    await runWorker(flags.worker, flags, root);
    return 0;
  }

  const inGit = await isGitRepo(process.cwd());
  if (!inGit && !flags.noGitCheck) {
    process.stderr.write(
      'Error: current directory is not a git repository. /cursor:review needs git to find the diff.\n',
    );
    return 2;
  }
  const root = await repoRoot(process.cwd());

  const context = await collectReviewContext(root, { scope: flags.scope, base: flags.base });
  if (context.error) {
    process.stderr.write(`Error: ${context.error}\n`);
    return 2;
  }
  if (context.isEmpty) {
    process.stdout.write(
      `Nothing to review — ${context.label} has no changes. Try \`--base <ref>\` or \`--scope branch\` to compare against another ref.\n`,
    );
    return 0;
  }

  pruneOlderThanDays(root, 30);
  const jobId = newId(10);

  if (flags.background) {
    const model = resolveModel(flags.model);
    createJob({
      id: jobId,
      repoPath: root,
      prompt: `REVIEW: ${context.label}`,
      model,
      background: true,
    });
    const forwarded = [];
    if (flags.model) forwarded.push('--model', flags.model);
    if (flags.adversarial) forwarded.push('--adversarial');
    if (flags.base) forwarded.push('--base', flags.base);
    forwarded.push('--scope', flags.scope);
    forwarded.push('--timeout', String(flags.timeout));
    if (flags.focus) forwarded.push('--', flags.focus);
    const pid = spawnBackground(jobId, forwarded, root);
    updateJob(root, jobId, { pid });
    process.stdout.write(
      `Review job \`${jobId}\` started in background (model \`${model}\`, pid ${pid}) — ${context.label}.\n`,
    );
    process.stdout.write(
      `Check progress with \`/cursor:status ${jobId}\` or read it with \`/cursor:result ${jobId}\`.\n`,
    );
    return 0;
  }

  return foreground(flags, context, jobId, root);
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `review failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
