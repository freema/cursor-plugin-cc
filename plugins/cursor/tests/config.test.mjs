import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configPath, getConfig, setConfigValue } from '../scripts/lib/config.mjs';
import { makeTempHome } from './helpers.mjs';

describe('config', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const repoA = '/tmp/repo-a';
  const repoB = '/tmp/repo-b';

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    tmp.cleanup();
  });

  it('defaults to stopReviewGate: false and no custom tasks dir', () => {
    expect(getConfig(repoA)).toEqual({ stopReviewGate: false, tasksDir: null });
  });

  it('persists a per-repo tasks dir independently of the review gate', () => {
    setConfigValue(repoA, 'tasksDir', 'PRPs');
    expect(getConfig(repoA).tasksDir).toBe('PRPs');
    expect(getConfig(repoA).stopReviewGate).toBe(false);
    expect(getConfig(repoB).tasksDir).toBeNull();
    setConfigValue(repoA, 'tasksDir', null);
    expect(getConfig(repoA).tasksDir).toBeNull();
  });

  it('persists a toggled value per repo', () => {
    setConfigValue(repoA, 'stopReviewGate', true);
    expect(getConfig(repoA).stopReviewGate).toBe(true);
    expect(getConfig(repoB).stopReviewGate).toBe(false);
    setConfigValue(repoA, 'stopReviewGate', false);
    expect(getConfig(repoA).stopReviewGate).toBe(false);
  });

  it('keeps config outside the jobs dir', () => {
    expect(configPath(repoA)).toContain('/config/');
    expect(configPath(repoA)).not.toContain('/jobs/');
  });
});
