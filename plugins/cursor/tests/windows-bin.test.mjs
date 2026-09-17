import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveWindowsInstall,
  resolveWindowsPath,
  sortVersionDirs,
} from '../scripts/lib/cursor.mjs';
import { run } from '../scripts/lib/run.mjs';
import { makeTempHome } from './helpers.mjs';

// Layout written by the official Windows installer (cursor.com/install?win32=true):
//   %LOCALAPPDATA%\cursor-agent\cursor-agent.{cmd,ps1}   <- on PATH
//   %LOCALAPPDATA%\cursor-agent\versions\<version>\node.exe, index.js, ...
// There is no cursor-agent.exe; the shims run the newest version's node.exe.

const SHIM_CMD = [
  '@echo off',
  'set "SCRIPT_DIR=%~dp0"',
  '%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%cursor-agent.ps1" %*',
  '',
].join('\r\n');

// Stand-in for cursor-agent's index.js: echoes the arguments it received.
const ECHO_ENTRY = 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n';

/**
 * @param {string} root
 * @param {Record<string, {node?: boolean, entry?: boolean}>} versions
 * @param {{nodeSource?: string}} [opts]  Copy this file as node.exe; empty file otherwise.
 */
function makeInstall(root, versions, opts = {}) {
  mkdirSync(join(root, 'versions'), { recursive: true });
  writeFileSync(join(root, 'cursor-agent.cmd'), SHIM_CMD);
  writeFileSync(join(root, 'cursor-agent.ps1'), '# shim\n');
  for (const [name, files] of Object.entries(versions)) {
    const dir = join(root, 'versions', name);
    mkdirSync(dir, { recursive: true });
    if (files.node !== false) {
      if (opts.nodeSource) copyFileSync(opts.nodeSource, join(dir, 'node.exe'));
      else writeFileSync(join(dir, 'node.exe'), '');
    }
    if (files.entry !== false) writeFileSync(join(dir, 'index.js'), ECHO_ENTRY);
  }
}

describe('sortVersionDirs', () => {
  it('orders version directories newest first by date', () => {
    expect(
      sortVersionDirs(['2026.05.28-418efe5', '2026.09.15-d2fe57e', '2026.08.11-e8db854']),
    ).toEqual(['2026.09.15-d2fe57e', '2026.08.11-e8db854', '2026.05.28-418efe5']);
  });

  it('compares date parts numerically, not as strings', () => {
    expect(sortVersionDirs(['2026.9.2-aaaaaaa', '2026.10.1-bbbbbbb'])).toEqual([
      '2026.10.1-bbbbbbb',
      '2026.9.2-aaaaaaa',
    ]);
  });

  it('orders same-day builds by build time, legacy names counting as midnight', () => {
    expect(
      sortVersionDirs([
        '2026.09.15-08-00-00-aaaaaaa',
        '2026.09.15-bbbbbbb',
        '2026.09.15-17-30-05-ccccccc',
      ]),
    ).toEqual(['2026.09.15-17-30-05-ccccccc', '2026.09.15-08-00-00-aaaaaaa', '2026.09.15-bbbbbbb']);
  });

  it('drops names the official shim would not treat as versions', () => {
    expect(
      sortVersionDirs(['latest', '2026.09.15', 'tmp-2026.09.15-abc', '2026.09.15-d2fe57e']),
    ).toEqual(['2026.09.15-d2fe57e']);
  });
});

describe('resolveWindowsInstall', () => {
  let tmp;
  beforeEach(() => {
    tmp = makeTempHome();
  });
  afterEach(() => tmp.cleanup());

  it('runs the newest version through its bundled node.exe', () => {
    const root = join(tmp.dir, 'cursor-agent');
    makeInstall(root, { '2026.08.11-e8db854': {}, '2026.09.15-d2fe57e': {} });
    const dir = join(root, 'versions', '2026.09.15-d2fe57e');
    expect(resolveWindowsInstall(root)).toEqual({
      command: join(dir, 'node.exe'),
      args: [join(dir, 'index.js')],
    });
  });

  it('skips a newest version left incomplete by an interrupted update', () => {
    const root = join(tmp.dir, 'cursor-agent');
    makeInstall(root, { '2026.08.11-e8db854': {}, '2026.09.15-d2fe57e': { node: false } });
    expect(resolveWindowsInstall(root)?.command).toBe(
      join(root, 'versions', '2026.08.11-e8db854', 'node.exe'),
    );
  });

  it('prefers a node.exe sitting next to the shim, as the shim does', () => {
    const root = join(tmp.dir, 'versions', '2026.09.15-d2fe57e');
    makeInstall(root, {});
    writeFileSync(join(root, 'node.exe'), '');
    writeFileSync(join(root, 'index.js'), ECHO_ENTRY);
    expect(resolveWindowsInstall(root)).toEqual({
      command: join(root, 'node.exe'),
      args: [join(root, 'index.js')],
    });
  });

  it('returns null when nothing runnable is installed', () => {
    expect(resolveWindowsInstall(join(tmp.dir, 'missing'))).toBeNull();
    const root = join(tmp.dir, 'cursor-agent');
    makeInstall(root, { '2026.09.15-d2fe57e': { entry: false } });
    expect(resolveWindowsInstall(root)).toBeNull();
  });
});

describe('resolveWindowsPath', () => {
  let tmp;
  beforeEach(() => {
    tmp = makeTempHome();
  });
  afterEach(() => tmp.cleanup());

  it('translates .cmd, .bat and .ps1 shims into the install beside them', () => {
    const root = join(tmp.dir, 'cursor-agent');
    makeInstall(root, { '2026.09.15-d2fe57e': {} });
    const expected = join(root, 'versions', '2026.09.15-d2fe57e', 'node.exe');
    for (const shim of ['cursor-agent.cmd', 'agent.CMD', 'cursor-agent.bat', 'cursor-agent.ps1']) {
      expect(resolveWindowsPath(join(root, shim))?.command).toBe(expected);
    }
  });

  it('spawns an .exe as is', () => {
    expect(resolveWindowsPath('C:\\Tools\\cursor-agent.exe')).toEqual({
      command: 'C:\\Tools\\cursor-agent.exe',
      args: [],
    });
  });

  it('rejects paths that are not Windows launchers', () => {
    expect(resolveWindowsPath('C:\\Tools\\cursor-agent')).toBeNull();
    expect(resolveWindowsPath('')).toBeNull();
  });

  it('returns null for a shim with no install beside it', () => {
    expect(resolveWindowsPath(join(tmp.dir, 'cursor-agent.cmd'))).toBeNull();
  });
});

// End to end against a real node.exe. Runs only on Windows (CI: windows-bin job).
describe.runIf(process.platform === 'win32')('Windows cursor-agent launch (#27)', () => {
  let tmp;
  let root;
  const version = '2026.09.15-d2fe57e';
  const saved = {
    PATH: process.env.PATH,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    CURSOR_AGENT_BIN: process.env.CURSOR_AGENT_BIN,
  };

  beforeAll(() => {
    tmp = makeTempHome();
    root = join(tmp.dir, 'LocalAppData', 'cursor-agent');
    makeInstall(
      root,
      { '2026.08.11-e8db854': {}, [version]: {} },
      { nodeSource: process.execPath },
    );
  }, 120_000);

  afterAll(() => tmp.cleanup());

  beforeEach(() => {
    vi.resetModules();
    delete process.env.CURSOR_AGENT_BIN;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function freshCursorModule() {
    return import('../scripts/lib/cursor.mjs');
  }

  it('cannot spawn the .cmd shim without a shell — the original failure', async () => {
    let failure = '';
    try {
      const res = await run(join(root, 'cursor-agent.cmd'), ['--version']);
      failure = res.exitCode === -1 ? res.stderr : '';
    } catch (err) {
      failure = String(err);
    }
    expect(failure).toMatch(/EINVAL/);
  });

  it('finds the shim on PATH via where.exe and launches node.exe index.js', async () => {
    process.env.PATH = `${root};${saved.PATH}`;
    process.env.LOCALAPPDATA = join(tmp.dir, 'elsewhere');
    const { resolveBin, runAgent } = await freshCursorModule();
    const bin = await resolveBin();
    expect(basename(dirname(bin.command))).toBe(version);
    const res = await runAgent(['--version']);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual(['--version']);
  });

  it('falls back to %LOCALAPPDATA%\\cursor-agent when PATH predates the install', async () => {
    process.env.LOCALAPPDATA = dirname(root);
    const { resolveBin, runAgent } = await freshCursorModule();
    const bin = await resolveBin();
    expect(basename(dirname(bin.command))).toBe(version);
    const res = await runAgent(['status']);
    expect(JSON.parse(res.stdout)).toEqual(['status']);
  });

  it('accepts CURSOR_AGENT_BIN pointing at the shim', async () => {
    process.env.CURSOR_AGENT_BIN = join(root, 'cursor-agent.cmd');
    const { runAgent } = await freshCursorModule();
    const res = await runAgent(['models']);
    expect(JSON.parse(res.stdout)).toEqual(['models']);
  });
});
