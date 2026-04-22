import { describe, expect, it } from 'vitest';
import { collapseArguments, parseArgv, splitArgString } from '../scripts/lib/args.mjs';

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

  it('handles --no-* negation, populating both kebab and camel', () => {
    const r = parseArgv(['--no-git-check'], ['git-check']);
    expect(r.flags['git-check']).toBe(false);
    expect(r.flags['gitCheck']).toBe(false);
  });

  it('auto-casts numeric flag values', () => {
    const r = parseArgv(['--timeout', '60'], []);
    expect(r.flags['timeout']).toBe(60);
  });

  it('handles --foo=value form', () => {
    const r = parseArgv(['--resume=chat_abc', '--model=opus'], []);
    expect(r.flags['resume']).toBe('chat_abc');
    expect(r.flags['model']).toBe('opus');
  });

  it('treats everything after -- as positional', () => {
    const r = parseArgv(['--model', 'opus', '--', '--weird', 'arg'], []);
    expect(r.flags['model']).toBe('opus');
    expect(r.positional).toEqual(['--weird', 'arg']);
  });

  it('boolean flag does not consume next token', () => {
    const r = parseArgv(['--background', 'task-text'], ['background']);
    expect(r.flags['background']).toBe(true);
    expect(r.positional).toEqual(['task-text']);
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
