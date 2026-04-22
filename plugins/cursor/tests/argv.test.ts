import { describe, expect, it } from 'vitest';
import { collapseArguments, parseArgv, splitArgString } from '../scripts/lib/argv.js';

describe('splitArgString', () => {
  it('splits on whitespace', () => {
    expect(splitArgString('--model composer hello world')).toEqual([
      '--model',
      'composer',
      'hello',
      'world',
    ]);
  });

  it('preserves double-quoted spans', () => {
    expect(splitArgString('--model opus "write a haiku about git"')).toEqual([
      '--model',
      'opus',
      'write a haiku about git',
    ]);
  });

  it('preserves single-quoted spans', () => {
    expect(splitArgString("--flag 'value with spaces'")).toEqual(['--flag', 'value with spaces']);
  });
});

describe('parseArgv', () => {
  it('splits positional vs flags', () => {
    const r = parseArgv(['--model', 'opus', '--background', 'do', 'thing'], ['background']);
    expect(r.flags['model']).toBe('opus');
    expect(r.flags['background']).toBe(true);
    expect(r.positional).toEqual(['do', 'thing']);
  });

  it('handles --no-* negation', () => {
    const r = parseArgv(['--no-force'], ['force']);
    expect(r.flags['force']).toBe(false);
  });
});

describe('collapseArguments', () => {
  it('returns empty for empty input', () => {
    expect(collapseArguments('')).toEqual([]);
    expect(collapseArguments(undefined)).toEqual([]);
  });

  it('tokenises with quoting', () => {
    expect(collapseArguments('--model composer "hello world"')).toEqual([
      '--model',
      'composer',
      'hello world',
    ]);
  });
});
