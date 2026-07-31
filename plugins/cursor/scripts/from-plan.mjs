#!/usr/bin/env node
// /cursor:from-plan — convert a Claude Code plan file into a task file inside
// the repo, and optionally hand it off to Cursor via `/cursor:delegate @<file>`.
//
// The output directory defaults to `tasks/` but is not hardcoded: spec-driven
// workflows that already keep their documents in `PRPs/`, `specs/` or
// `openspec/` can point it there (`--out-dir`, `CURSOR_PLUGIN_CC_TASKS_DIR`, or
// the per-repo `tasksDir` config) instead of growing a second parallel tree —
// or skip the generated file altogether with `--in-place`.
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
import { isAbsolute, join, relative, resolve } from 'node:path';
import { collapseCommandArgv, parseArgv, parseTimeout } from './lib/args.mjs';
import { main as delegateMain } from './delegate.mjs';
import { getConfig } from './lib/config.mjs';
import { isGitRepo, repoRoot } from './lib/git.mjs';
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
  'in-place',
];

export const DEFAULT_TASKS_DIR = 'tasks';

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
  const timeout = 'timeout' in flags ? parseTimeout(flags['timeout']) : undefined;
  const outDir =
    typeof flags['outDir'] === 'string'
      ? flags['outDir']
      : typeof flags['out-dir'] === 'string'
        ? flags['out-dir']
        : undefined;
  const inPlace = Boolean(flags['inPlace'] || flags['in-place']);
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
    outDir,
    inPlace,
  };
}

/**
 * Resolve where the generated task file lands, most- to least-explicit:
 *   1. `--out-dir <dir>`
 *   2. `CURSOR_PLUGIN_CC_TASKS_DIR`
 *   3. the per-repo `tasksDir` config key (`/cursor:setup --tasks-dir <dir>`)
 *   4. `tasks/`
 *
 * A relative value is resolved against the repo root, not the CWD, so the
 * destination does not move when the command runs from a subdirectory.
 *
 * @param {string} root
 * @param {string|undefined} flagValue
 * @returns {{ dir: string, source: 'flag'|'env'|'config'|'default' }}
 */
export function resolveTasksDir(root, flagValue) {
  const env = process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
  /** @type {Array<['flag'|'env'|'config'|'default', string|null|undefined]>} */
  const candidates = [
    ['flag', flagValue],
    ['env', env && env.trim() ? env.trim() : undefined],
    ['config', getConfig(root).tasksDir],
    ['default', DEFAULT_TASKS_DIR],
  ];
  for (const [source, value] of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const raw = value.trim();
    return { dir: isAbsolute(raw) ? raw : resolve(root, raw), source };
  }
  return { dir: resolve(root, DEFAULT_TASKS_DIR), source: 'default' };
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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

function writeTaskFile(tasksDir, slug, content) {
  if (!existsSync(tasksDir)) mkdirSync(tasksDir, { recursive: true });
  const stamp = timestamp();
  // Avoid clobbering a task generated for the same plan in the same second.
  let fullPath = join(tasksDir, `${stamp}-${slug}.md`);
  for (let i = 2; existsSync(fullPath); i += 1) {
    fullPath = join(tasksDir, `${stamp}-${slug}-${i}.md`);
  }
  writeFileSync(fullPath, content, 'utf8');
  return { fullPath };
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const flags = parseFlags(collapseCommandArgv(rawArgv));

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

  // If we're going to hand off to Cursor (which refuses outside a git repo),
  // fail BEFORE writing the task file so we don't leave an orphan task file and
  // a success banner behind an aborted delegate.
  if (flags.shouldDelegate && !flags.noGitCheck && !(await isGitRepo(process.cwd()))) {
    process.stderr.write(
      'Error: current directory is not a git repository, so --delegate cannot run. Re-run without --delegate to just write the task file, or pass --no-git-check.\n',
    );
    return 2;
  }

  // `--in-place`: the spec IS the task. Write nothing, delegate the source
  // document as-is. This is the lossless path for PRP / Spec Kit / OpenSpec
  // workflows, where a converted copy would only drift from the original.
  let relPath;
  if (flags.inPlace) {
    const rel = relative(root, planPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      process.stderr.write(
        `Error: --in-place needs the plan to live inside the repo (\`${root}\`), because Cursor resolves \`@path\` from the repo root.\n` +
          `\`${planPath}\` is outside it. Drop --in-place to write a task file instead, or move the spec into the repo.\n`,
      );
      return 2;
    }
    relPath = rel;
    process.stdout.write(`### Delegating the spec in place\n\n`);
    process.stdout.write(`- **Spec:** \`${relPath}\` (no task file written)\n`);
    process.stdout.write(`- **Title:** ${plan.title || '(untitled)'}\n\n`);
  } else {
    const { dir: tasksDir, source } = resolveTasksDir(root, flags.outDir);
    const taskContent = buildTaskContent(plan);
    const { fullPath } = writeTaskFile(tasksDir, plan.slug, taskContent);
    const rel = relative(root, fullPath);
    relPath = rel.startsWith('..') || isAbsolute(rel) ? fullPath : rel;

    process.stdout.write(`### Task file created\n\n`);
    process.stdout.write(`- **Source plan:** \`${planPath}\`\n`);
    process.stdout.write(`- **Task file:** \`${relPath}\`\n`);
    if (source !== 'default') {
      const label = { flag: '--out-dir', env: 'CURSOR_PLUGIN_CC_TASKS_DIR', config: 'repo config' };
      process.stdout.write(`- **Output directory:** from ${label[source]}\n`);
    }
    process.stdout.write(`- **Title:** ${plan.title || '(untitled)'}\n\n`);
  }

  if (!flags.shouldDelegate) {
    process.stdout.write('---\n\n');
    process.stdout.write(
      flags.inPlace
        ? 'Review the spec, then delegate it to Cursor:\n\n'
        : 'Review the task file, then delegate it to Cursor:\n\n',
    );
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
