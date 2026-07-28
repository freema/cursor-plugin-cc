import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pluginHome, repoHash, jobsDir } from '../scripts/lib/paths.mjs';
import { makeTempHome } from './helpers.mjs';

describe('paths', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    tmp.cleanup();
  });

  it('pluginHome honours the env override', () => {
    expect(pluginHome()).toBe(tmp.dir);
  });

  it('repoHash is stable and 12 hex chars', () => {
    const a = repoHash(tmp.dir);
    const b = repoHash(tmp.dir);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it('jobsDir nests under pluginHome', () => {
    const dir = jobsDir(tmp.dir);
    expect(dir.startsWith(tmp.dir)).toBe(true);
    expect(dir).toContain('jobs');
  });

  describe('state-root resolution without the env override', () => {
    // os.homedir() reads $HOME on POSIX, so point it at a temp dir to control
    // whether the legacy ~/.cursor-plugin-cc exists.
    let fakeHome;
    const prevHOME = process.env.HOME;
    const prevPluginData = process.env.CLAUDE_PLUGIN_DATA;

    beforeEach(() => {
      fakeHome = makeTempHome();
      process.env.HOME = fakeHome.dir;
      delete process.env.CURSOR_PLUGIN_CC_HOME;
      delete process.env.CLAUDE_PLUGIN_DATA;
    });

    afterEach(() => {
      if (prevHOME === undefined) delete process.env.HOME;
      else process.env.HOME = prevHOME;
      if (prevPluginData === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
      else process.env.CLAUDE_PLUGIN_DATA = prevPluginData;
      fakeHome.cleanup();
    });

    it.skipIf(process.platform === 'win32')('defaults to ~/.cursor-plugin-cc', () => {
      expect(pluginHome()).toBe(join(fakeHome.dir, '.cursor-plugin-cc'));
    });

    it.skipIf(process.platform === 'win32')(
      'prefers CLAUDE_PLUGIN_DATA/state on a fresh install',
      () => {
        process.env.CLAUDE_PLUGIN_DATA = join(fakeHome.dir, 'plugin-data');
        expect(pluginHome()).toBe(join(fakeHome.dir, 'plugin-data', 'state'));
      },
    );

    it.skipIf(process.platform === 'win32')(
      'keeps an existing legacy dir even when CLAUDE_PLUGIN_DATA is set',
      () => {
        const legacy = join(fakeHome.dir, '.cursor-plugin-cc');
        mkdirSync(legacy, { recursive: true });
        process.env.CLAUDE_PLUGIN_DATA = join(fakeHome.dir, 'plugin-data');
        expect(pluginHome()).toBe(legacy);
      },
    );
  });
});
