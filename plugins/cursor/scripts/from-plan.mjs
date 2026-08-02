#!/usr/bin/env node
// /cursor:from-plan — convert a Claude Code plan file into a task file inside
// the repo, and optionally hand it off to Cursor via `/cursor:delegate @<file>`.
//
// The destination is derived, not imposed. When the plan is a spec from the
// user's project, the task file is written beside it — a spec already knows
// where it belongs, and that answer stays correct no matter which repository
// the command runs from. `tasks/` is only the fallback for Claude's own
// plan-mode files, which have no project location to inherit; `--out-dir`,
// `CURSOR_PLUGIN_CC_TASKS_DIR` and the per-repo `tasksDir` config override.
// `--in-place` skips the generated file altogether.
//
// None of this assumes the spec and the code share a repository. A central
// spec directory (a monorepo holding PRPs for several sibling service repos)
// is a first-class case: the task file lands next to its siblings, and Cursor
// receives an absolute path to it rather than an unreachable `@path`.
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
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { collapseCommandArgv, parseArgv, parseTimeout } from './lib/args.mjs';
import { main as delegateMain } from './delegate.mjs';
import { getConfig } from './lib/config.mjs';
import { isGitRepo, repoRoot } from './lib/git.mjs';
import {
  buildTaskContent,
  isPlanModeFile,
  listPlans,
  parsePlanFile,
  resolvePlanPath,
} from './lib/plan.mjs';
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
 *   2. the directory the source spec itself lives in
 *   3. `CURSOR_PLUGIN_CC_TASKS_DIR`
 *   4. the per-repo `tasksDir` config key (`/cursor:setup --tasks-dir <dir>`)
 *   5. `tasks/`
 *
 * Rule 2 is what makes this work across repositories. A project spec already
 * says where it belongs, so the task file is written next to it — `PRPs/018.md`
 * produces `PRPs/<stamp>-018.md`, beside its siblings, whichever repo the
 * command runs from. Configuration is only consulted for Claude's own
 * plan-mode files, which have no project location to inherit.
 *
 * A relative value is resolved against the repo root, not the CWD, so the
 * destination does not move when the command runs from a subdirectory.
 *
 * @param {string} root
 * @param {string|undefined} flagValue
 * @param {string} [planPath]   Resolved source plan; supplies rule 2.
 * @returns {{ dir: string, source: 'flag'|'spec'|'env'|'config'|'default' }}
 */
export function resolveTasksDir(root, flagValue, planPath) {
  const env = process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
  const specDir = planPath && !isPlanModeFile(planPath) ? dirname(resolve(planPath)) : undefined;
  /** @type {Array<['flag'|'spec'|'env'|'config'|'default', string|null|undefined]>} */
  const candidates = [
    ['flag', flagValue],
    ['spec', specDir],
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

/**
 * Build the reference Cursor should follow to reach a file.
 *
 * Inside the repo we use the `@path` shorthand Cursor resolves from the repo
 * root. Outside it — a spec kept in a sibling monorepo while the code lives
 * here — `@path` cannot reach, so we hand over the absolute path instead;
 * `cursor-agent` reads those fine. This is what lets one central spec
 * directory drive work in many repositories.
 *
 * @param {string} root
 * @param {string} fullPath
 * @returns {{ mention: string, display: string, inside: boolean }}
 */
export function referenceFor(root, fullPath) {
  const rel = relative(root, fullPath);
  const inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  return inside
    ? { mention: `@${rel}`, display: rel, inside: true }
    : { mention: fullPath, display: fullPath, inside: false };
}

/**
 * @param {{ mention: string, inside: boolean }} ref
 * @returns {string}
 */
function delegatePrompt(ref) {
  return ref.inside
    ? `Implement the task described in ${ref.mention}. Follow every section.`
    : `Read the specification file at ${ref.mention} (it lives outside this repository) and implement it here. Follow every section. Apply all code changes in the current repository.`;
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
  // The spec may live outside this repo (a central spec directory driving many
  // repos) — `referenceFor` hands Cursor an absolute path in that case.
  let ref;
  if (flags.inPlace) {
    ref = referenceFor(root, planPath);
    process.stdout.write(`### Delegating the spec in place\n\n`);
    process.stdout.write(`- **Spec:** \`${ref.display}\` (no task file written)\n`);
    if (!ref.inside) {
      process.stdout.write(
        `- **Note:** the spec lives outside this repo; Cursor reads it by absolute path and applies changes here.\n`,
      );
    }
    process.stdout.write(`- **Title:** ${plan.title || '(untitled)'}\n\n`);
  } else {
    const { dir: tasksDir, source } = resolveTasksDir(root, flags.outDir, planPath);
    const taskContent = buildTaskContent(plan);
    const { fullPath } = writeTaskFile(tasksDir, plan.slug, taskContent);
    ref = referenceFor(root, fullPath);

    process.stdout.write(`### Task file created\n\n`);
    process.stdout.write(`- **Source plan:** \`${planPath}\`\n`);
    process.stdout.write(`- **Task file:** \`${ref.display}\`\n`);
    if (source !== 'default') {
      const label = {
        flag: '--out-dir',
        spec: "the source spec's own directory",
        env: 'CURSOR_PLUGIN_CC_TASKS_DIR',
        config: 'repo config',
      };
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
    process.stdout.write(
      `/cursor:delegate${modelFlag}${bgFlag}${freshFlag} ${delegatePrompt(ref)}\n`,
    );
    process.stdout.write('```\n\n');
    process.stdout.write(
      'Re-run with `--delegate` (or `--yes`) to skip the review and hand it off right away.\n',
    );
    return 0;
  }

  // Auto-delegate: call delegate.mjs in-process. Inside the repo we use the
  // `@path` convention Claude Code uses; outside it, an absolute path.
  const delegateArgs = [];
  if (flags.noGitCheck) delegateArgs.push('--no-git-check');
  if (flags.model) delegateArgs.push('--model', flags.model);
  if (flags.background) delegateArgs.push('--background');
  if (flags.fresh) delegateArgs.push('--fresh');
  if (!flags.force) delegateArgs.push('--no-force');
  if (typeof flags.timeout === 'number') delegateArgs.push('--timeout', String(flags.timeout));
  delegateArgs.push('--', delegatePrompt(ref));

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
