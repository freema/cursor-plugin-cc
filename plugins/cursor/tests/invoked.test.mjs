import { symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invokedAsScript } from '../scripts/lib/invoked.mjs';
import { makeTempHome } from './helpers.mjs';

describe('invokedAsScript', () => {
  const originalArgv = process.argv;
  let tmp;
  let script;

  beforeEach(() => {
    tmp = makeTempHome();
    script = join(tmp.dir, 'cmd.mjs');
    writeFileSync(script, '');
  });

  afterEach(() => {
    process.argv = originalArgv;
    tmp.cleanup();
  });

  it('is true when argv[1] is the module itself', () => {
    process.argv = [process.execPath, script];
    expect(invokedAsScript(pathToFileURL(script).href)).toBe(true);
  });

  it('is true when argv[1] reaches the module through a symlink', () => {
    const link = join(tmp.dir, 'link.mjs');
    symlinkSync(script, link);
    process.argv = [process.execPath, link];
    expect(invokedAsScript(pathToFileURL(script).href)).toBe(true);
  });

  it('is false when another script is the entry point', () => {
    const other = join(tmp.dir, 'other.mjs');
    writeFileSync(other, '');
    process.argv = [process.execPath, other];
    expect(invokedAsScript(pathToFileURL(script).href)).toBe(false);
  });

  it('is false when there is no entry point (node -e, REPL)', () => {
    process.argv = [process.execPath];
    expect(invokedAsScript(pathToFileURL(script).href)).toBe(false);
  });

  it('is false when the entry point no longer exists', () => {
    process.argv = [process.execPath, join(tmp.dir, 'gone.mjs')];
    expect(invokedAsScript(pathToFileURL(script).href)).toBe(false);
  });
});
