#!/usr/bin/env node
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collapseArguments, parseArgv } from './lib/args.mjs';
import { authStatus, listConfiguredMcps, listModels, resolveBin } from './lib/cursor.mjs';
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

async function doctor() {
  const lines = ['### /cursor:setup --doctor\n'];
  const checks = [];
  lines.push(`- Node: ${process.version}`);
  lines.push(`- Platform: ${process.platform} (${process.arch})`);
  lines.push(`- Plugin home: \`${pluginHome()}\``);

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

  lines.push('');
  for (const [name, r] of checks) {
    const icon = r.ok ? '✓' : '✗';
    lines.push(`- ${icon} **${name}** — ${r.detail}`);
  }

  if (bin) {
    const mcps = await listConfiguredMcps();
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

  const allOk = checks.every(([, r]) => r.ok || r.detail.includes('not set'));
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
  const delimiterIdx = rawArgv.indexOf('--');
  const firstHalf = delimiterIdx === -1 ? [] : rawArgv.slice(0, delimiterIdx);
  const userRaw =
    delimiterIdx === -1 ? rawArgv.join(' ') : rawArgv.slice(delimiterIdx + 1).join(' ');
  const combined = [...firstHalf, ...collapseArguments(userRaw)];
  const { flags } = parseArgv(combined, ['doctor', 'print-models', 'install']);
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
