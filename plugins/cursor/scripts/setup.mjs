#!/usr/bin/env node
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommandArgv } from './lib/args.mjs';
import { getConfig, setConfigValue } from './lib/config.mjs';
import { authStatus, listConfiguredMcps, listModels, resolveBin } from './lib/cursor.mjs';
import { repoRoot } from './lib/git.mjs';
import { ensureDir, jobsDir, pluginHome } from './lib/paths.mjs';
import { run } from './lib/run.mjs';

function pluginRoot() {
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (envRoot && envRoot.trim()) return envRoot;
  // scripts/setup.mjs → ../ is the plugin root
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function checkScripts() {
  const scripts = join(pluginRoot(), 'scripts');
  const entry = join(scripts, 'setup.mjs');
  if (!existsSync(entry)) {
    return { ok: false, detail: `scripts/ missing or incomplete at ${scripts}` };
  }
  return { ok: true, detail: `scripts at ${scripts}` };
}

function checkJobsDir() {
  try {
    const home = pluginHome();
    ensureDir(home);
    const repoDir = jobsDir(process.cwd());
    ensureDir(repoDir);
    accessSync(repoDir, fsConstants.W_OK);
    return { ok: true, detail: repoDir };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

function maskKey(value) {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

async function gatherDoctor() {
  /** @type {Array<[string, {ok: boolean, detail: string}]>} */
  const checks = [];

  let bin = '';
  try {
    bin = await resolveBin();
    checks.push(['cursor-agent binary', { ok: true, detail: bin }]);
  } catch (err) {
    checks.push([
      'cursor-agent binary',
      { ok: false, detail: err instanceof Error ? err.message : String(err) },
    ]);
  }
  if (bin) {
    const ver = await run(bin, ['--version'], { timeoutMs: 5_000 });
    checks.push([
      'cursor-agent version',
      { ok: ver.exitCode === 0, detail: (ver.stdout || ver.stderr).trim() },
    ]);
    const auth = await authStatus();
    checks.push([
      'cursor-agent auth',
      {
        ok: auth.loggedIn,
        detail: auth.loggedIn ? 'logged in' : 'not logged in — run `cursor-agent login`',
      },
    ]);
  }

  checks.push(['scripts', checkScripts()]);
  checks.push(['jobs directory writable', checkJobsDir()]);

  const apiKey = process.env.CURSOR_API_KEY;
  checks.push([
    'CURSOR_API_KEY',
    { ok: true, detail: apiKey ? `set (${maskKey(apiKey)})` : 'not set (using local session)' },
  ]);

  const root = await repoRoot(process.cwd());
  checks.push([
    'stop review gate',
    {
      ok: true,
      detail: getConfig(root).stopReviewGate
        ? 'enabled for this repo (disable with `--disable-review-gate`)'
        : 'disabled (enable with `--enable-review-gate`)',
    },
  ]);

  const envTasksDir = process.env.CURSOR_PLUGIN_CC_TASKS_DIR;
  const cfgTasksDir = getConfig(root).tasksDir;
  checks.push([
    'from-plan output directory',
    {
      ok: true,
      detail: envTasksDir?.trim()
        ? `${envTasksDir.trim()} (from CURSOR_PLUGIN_CC_TASKS_DIR)`
        : cfgTasksDir
          ? `${cfgTasksDir} (repo config)`
          : 'tasks/ (default — change with `--tasks-dir <dir>`)',
    },
  ]);

  const mcps = bin ? await listConfiguredMcps() : [];

  // The CURSOR_API_KEY check is already `ok:true` whether or not the key is
  // set, so a literal `r.ok` is correct here — a stray "not set" substring in
  // some other check's stderr must not mask a real failure.
  const allOk = checks.every(([, r]) => r.ok);
  return { bin, checks, mcps, allOk };
}

/**
 * @param {boolean} enable
 * @returns {Promise<number>}
 */
async function toggleReviewGate(enable) {
  const root = await repoRoot(process.cwd());
  setConfigValue(root, 'stopReviewGate', enable);
  if (enable) {
    process.stdout.write(
      'Stop review gate **enabled** for this repository.\n\n' +
        'Before Claude Code ends a turn, a Cursor model reviews the work from that turn; ' +
        'a `BLOCK: …` verdict keeps the session going until the issue is fixed. ' +
        'Disable anytime with `/cursor:setup --disable-review-gate`.\n',
    );
  } else {
    process.stdout.write('Stop review gate **disabled** for this repository.\n');
  }
  return 0;
}

/**
 * Persist (or clear) the directory `/cursor:from-plan` writes task files into.
 * `--tasks-dir` with no value, or an explicit `--no-tasks-dir`, resets it to
 * the built-in `tasks/`.
 *
 * @param {unknown} raw
 * @returns {Promise<number>}
 */
async function setTasksDir(raw) {
  const root = await repoRoot(process.cwd());
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || raw === false || raw === true) {
    setConfigValue(root, 'tasksDir', null);
    process.stdout.write(
      'Task output directory **reset** to the default `tasks/` for this repository.\n',
    );
    return 0;
  }
  setConfigValue(root, 'tasksDir', value);
  process.stdout.write(
    `Task output directory set to \`${value}\` for this repository.\n\n` +
      '`/cursor:from-plan` will write generated task files there instead of `tasks/`. ' +
      'Override per run with `--out-dir <dir>`, or skip the task file entirely with `--in-place`. ' +
      'Reset with `/cursor:setup --no-tasks-dir`.\n',
  );
  return 0;
}

async function doctor(asJson = false) {
  const { bin, checks, mcps, allOk } = await gatherDoctor();

  if (asJson) {
    const payload = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pluginHome: pluginHome(),
      checks: checks.map(([name, r]) => ({ name, ok: r.ok, detail: r.detail })),
      mcps,
      allOk,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return allOk ? 0 : 1;
  }

  const lines = ['### /cursor:setup --doctor\n'];
  lines.push(`- Node: ${process.version}`);
  lines.push(`- Platform: ${process.platform} (${process.arch})`);
  lines.push(`- Plugin home: \`${pluginHome()}\``);

  lines.push('');
  for (const [name, r] of checks) {
    const icon = r.ok ? '✓' : '✗';
    lines.push(`- ${icon} **${name}** — ${r.detail}`);
  }

  if (bin) {
    lines.push('');
    lines.push('**Configured Cursor MCPs:**');
    if (mcps.length === 0) {
      lines.push('- (none configured — browser testing via `/cursor:browser` will refuse to run)');
    } else {
      for (const m of mcps) {
        const icon = m.loaded ? '✓' : '•';
        lines.push(`- ${icon} \`${m.name}\` — ${m.status}`);
      }
    }
  }

  lines.push('');
  lines.push(allOk ? 'All checks passed.' : 'Some checks failed — see above.');
  process.stdout.write(lines.join('\n') + '\n');
  return allOk ? 0 : 1;
}

async function printModels() {
  process.stdout.write('### Cursor models (from your account)\n\n');
  const models = await listModels();
  if (models.length === 0) {
    process.stdout.write(
      'Could not fetch model list. Try `cursor-agent --list-models` directly or `cursor-agent models`.\n',
    );
    return 1;
  }
  for (const m of models) process.stdout.write(`- ${m}\n`);
  return 0;
}

async function maybeInstall() {
  process.stdout.write(
    'This will run: `curl https://cursor.com/install -fsS | bash`\n' +
      'Aborting automatic execution — re-run the command above manually to install.\n',
  );
  return 0;
}

async function baseCheck() {
  const lines = ['### /cursor:setup\n'];
  try {
    const bin = await resolveBin();
    lines.push(`- ✓ \`cursor-agent\` at \`${bin}\``);
    const auth = await authStatus();
    lines.push(
      auth.loggedIn
        ? '- ✓ Cursor CLI is logged in.'
        : '- ✗ Cursor CLI is not logged in. Run `cursor-agent login` in a terminal.',
    );
    const scripts = checkScripts();
    lines.push(scripts.ok ? `- ✓ ${scripts.detail}` : `- ✗ ${scripts.detail}`);
    const jobs = checkJobsDir();
    lines.push(jobs.ok ? `- ✓ jobs dir writable: \`${jobs.detail}\`` : `- ✗ ${jobs.detail}`);
    lines.push('');
    lines.push('Ready. Try `/cursor:delegate "write a short haiku about git"` to smoke-test.');
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  } catch (err) {
    lines.push(`- ✗ ${err instanceof Error ? err.message : String(err)}`);
    lines.push('');
    lines.push(
      'Install Cursor CLI with: `curl https://cursor.com/install -fsS | bash`\n' +
        'Then run `cursor-agent login` and re-run `/cursor:setup`.',
    );
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { flags } = parseCommandArgv(rawArgv, [
    'doctor',
    'print-models',
    'install',
    'json',
    'enable-review-gate',
    'disable-review-gate',
  ]);
  const tasksDirFlag = flags['tasks-dir'] ?? flags['tasksDir'];
  if (tasksDirFlag !== undefined) return setTasksDir(tasksDirFlag);
  if (flags['enable-review-gate'] || flags['enableReviewGate']) return toggleReviewGate(true);
  if (flags['disable-review-gate'] || flags['disableReviewGate']) return toggleReviewGate(false);
  // --json always emits the full structured doctor report — hooks and scripts
  // branch on `checks[].ok` / `allOk` instead of parsing Markdown.
  if (flags['json']) return doctor(true);
  if (flags['doctor']) return doctor();
  if (flags['print-models'] || flags['printModels']) return printModels();
  if (flags['install']) return maybeInstall();
  return baseCheck();
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`setup failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
