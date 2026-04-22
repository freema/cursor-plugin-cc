#!/usr/bin/env node
// /cursor:from-plan — convert a Claude Code plan file into a task file under
// `tasks/` in the current repo, and optionally hand it off to Cursor via
// `/cursor:delegate @tasks/<file>`.
//
// Typical flow:
//   1. User runs /plan mode in Claude Code, Claude writes a plan to
//      ~/.claude/plans/<slug>.md.
//   2. User runs /cursor:from-plan.
//   3. We read the latest plan, extract its sections (Context, Approach,
//      Files, Verification), re-emit them as a Cursor-shaped task file at
//      tasks/<YYYYMMDD-HHmm>-<slug>.md, and print the recommended delegate
//      command.
//   4. With --delegate (or --yes), we invoke delegate directly in-process
//      and stream its output.

import { existsSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { collapseArguments, parseArgv } from './lib/args.mjs';
import { main as delegateMain } from './delegate.mjs';
import { repoRoot } from './lib/git.mjs';
import { buildTaskContent, listPlans, parsePlanFile, resolvePlanPath } from './lib/plan.mjs';
import { invokedAsScript as __isScript } from './lib/invoked.mjs';

const BOOLEAN_FLAGS = [
  'delegate',
  'yes',
  'background',
  'fresh',
  'force',
  'git-check',
  'list',
  'help',
];

function parseFlags(argv) {
  const { positional, flags } = parseArgv(argv, BOOLEAN_FLAGS);
  const shouldDelegate = flags['delegate'] === true || flags['yes'] === true || flags['y'] === true;
  const background = Boolean(flags['background']);
  const fresh = Boolean(flags['fresh']);
  const force = 'force' in flags ? Boolean(flags['force']) : true;
  const noGitCheck =
    flags['gitCheck'] === false || flags['git-check'] === false || flags['no-git-check'] === true;
  const list = Boolean(flags['list']);
  const model = typeof flags['model'] === 'string' ? flags['model'] : undefined;
  const timeoutRaw = flags['timeout'];
  const timeout =
    typeof timeoutRaw === 'number' ? timeoutRaw : timeoutRaw ? Number(timeoutRaw) : undefined;
  const planRef = positional[0];
  return {
    planRef,
    shouldDelegate,
    background,
    fresh,
    force,
    noGitCheck,
    list,
    model,
    timeout,
  };
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function renderPlansList() {
  const plans = listPlans();
  if (plans.length === 0) {
    return '_No plan files found at `~/.claude/plans/`._\n';
  }
  const lines = [
    '### Available Claude Code plans (newest first)\n',
    '| Name | Modified |',
    '| --- | --- |',
  ];
  for (const p of plans.slice(0, 15)) {
    const age = Math.round((Date.now() - p.mtimeMs) / 60_000);
    const when =
      age < 60
        ? `${age}m ago`
        : age < 1440
          ? `${Math.round(age / 60)}h ago`
          : `${Math.round(age / 1440)}d ago`;
    lines.push(`| \`${p.name}\` | ${when} |`);
  }
  lines.push('');
  lines.push(
    'Use `/cursor:from-plan <name-fragment>` to pick one. With no argument, the newest plan is used.',
  );
  return lines.join('\n') + '\n';
}

function writeTaskFile(root, slug, content) {
  const tasksDir = join(root, 'tasks');
  if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });
  const fullPath = join(tasksDir, `${timestamp()}-${slug}.md`);
  writeFileSync(fullPath, content, 'utf8');
  return { fullPath };
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const delimiterIdx = rawArgv.indexOf('--');
  const firstHalf = delimiterIdx === -1 ? [] : rawArgv.slice(0, delimiterIdx);
  const userRaw =
    delimiterIdx === -1 ? rawArgv.join(' ') : rawArgv.slice(delimiterIdx + 1).join(' ');
  const combined = [...firstHalf, ...collapseArguments(userRaw)];
  const flags = parseFlags(combined);

  if (flags.list) {
    process.stdout.write(renderPlansList());
    return 0;
  }

  const planPath = resolvePlanPath(flags.planRef);
  if (!planPath) {
    if (flags.planRef) {
      process.stderr.write(
        `Error: no plan file matches \`${flags.planRef}\`. Run \`/cursor:from-plan --list\` to see available plans.\n`,
      );
    } else {
      process.stderr.write(
        'Error: no plan files found. Write one by using plan mode in Claude Code (they are saved under `~/.claude/plans/`).\n',
      );
    }
    return 2;
  }

  const plan = parsePlanFile(planPath);
  const root = await repoRoot(process.cwd());
  const taskContent = buildTaskContent(plan);
  const { fullPath } = writeTaskFile(root, plan.slug, taskContent);
  const relPath = fullPath.startsWith(root + '/') ? fullPath.slice(root.length + 1) : fullPath;

  process.stdout.write(`### Task file created\n\n`);
  process.stdout.write(`- **Source plan:** \`${planPath}\`\n`);
  process.stdout.write(`- **Task file:** \`${relPath}\`\n`);
  process.stdout.write(`- **Title:** ${plan.title || '(untitled)'}\n\n`);

  if (!flags.shouldDelegate) {
    process.stdout.write('---\n\n');
    process.stdout.write('Review the task file, then delegate it to Cursor:\n\n');
    process.stdout.write('```\n');
    const modelFlag = flags.model ? ` --model ${flags.model}` : '';
    const bgFlag = flags.background ? ' --background' : '';
    const freshFlag = flags.fresh ? ' --fresh' : '';
    process.stdout.write(`/cursor:delegate${modelFlag}${bgFlag}${freshFlag} @${relPath}\n`);
    process.stdout.write('```\n\n');
    process.stdout.write(
      'Re-run with `--delegate` (or `--yes`) to skip the review and hand it off right away.\n',
    );
    return 0;
  }

  // Auto-delegate: call delegate.mjs in-process. We pass the task file as
  // part of the prompt using the same `@path` convention Claude Code uses.
  const delegateArgs = [];
  if (flags.noGitCheck) delegateArgs.push('--no-git-check');
  if (flags.model) delegateArgs.push('--model', flags.model);
  if (flags.background) delegateArgs.push('--background');
  if (flags.fresh) delegateArgs.push('--fresh');
  if (!flags.force) delegateArgs.push('--no-force');
  if (typeof flags.timeout === 'number') delegateArgs.push('--timeout', String(flags.timeout));
  delegateArgs.push('--', `Implement the task described in @${relPath}. Follow every section.`);

  process.stdout.write('---\n\nHanding off to Cursor…\n\n');
  return delegateMain(delegateArgs);
}

const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `from-plan failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    });
}
