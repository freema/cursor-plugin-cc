import { describe, expect, it } from 'vitest';
import {
  collapseArguments,
  collapsePromptArgv,
  parseArgv,
  splitArgString,
  splitLeadingFlags,
} from '../scripts/lib/args.mjs';

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

  // Regression: resume.mjs unshifts `--resume` onto argv. Before declaring
  // `resume` as boolean this consumed the first prompt word as chat-id,
  // producing bogus `--resume=<word>` calls to cursor-agent.
  it('--resume followed by a prompt does not eat the prompt token', () => {
    const r = parseArgv(['--resume', 'řekni', 'mi', 'něco', 'o', 'teto', 'službě'], ['resume']);
    expect(r.flags['resume']).toBe(true);
    expect(r.positional).toEqual(['řekni', 'mi', 'něco', 'o', 'teto', 'službě']);
  });

  it('--resume=<id> still extracts the chat id even when boolean-declared', () => {
    const r = parseArgv(['--resume=chat_abc', 'follow', 'up'], ['resume']);
    expect(r.flags['resume']).toBe('chat_abc');
    expect(r.positional).toEqual(['follow', 'up']);
  });
});

// The delegate prompt path: flags lead, the first non-flag span starts the
// verbatim body. Regression for flag-like words (`--config`, `--no-index`,
// `%~dp0\…`) being silently consumed out of long briefs (2026-08-19).
const DELEGATE_BOOLEANS = [
  'background',
  'wait',
  'fresh',
  'force',
  'cloud',
  'git-check',
  'help',
  'resume',
];

describe('splitLeadingFlags', () => {
  it('stops at the first non-flag span and returns the raw remainder', () => {
    const brief =
      'Run installer --config custom.yaml --duration 30 --platform win --no-index then expand %~dp0\\bin and report.';
    const r = splitLeadingFlags(brief, DELEGATE_BOOLEANS);
    expect(r.tokens).toEqual([]);
    expect(r.rest).toBe(brief);
  });

  it('folds a consumed value into a single --name=value token', () => {
    const r = splitLeadingFlags('--model opus --timeout 60 fix the bug', DELEGATE_BOOLEANS);
    expect(r.tokens).toEqual(['--model=opus', '--timeout=60']);
    expect(r.rest).toBe('fix the bug');
  });

  it('boolean flags never consume the first body word', () => {
    const r = splitLeadingFlags('--background fix the bug', DELEGATE_BOOLEANS);
    expect(r.tokens).toEqual(['--background']);
    expect(r.rest).toBe('fix the bug');
  });

  it('keeps quotes and backslashes in the body untouched', () => {
    const body = 'say "hello world" and expand %~dp0\\bin';
    const r = splitLeadingFlags(`--fresh ${body}`, DELEGATE_BOOLEANS);
    expect(r.tokens).toEqual(['--fresh']);
    expect(r.rest).toBe(body);
  });

  it('an explicit -- span forces the rest verbatim even when it starts with a flag', () => {
    const r = splitLeadingFlags('--model opus -- --weird leading body', DELEGATE_BOOLEANS);
    expect(r.tokens).toEqual(['--model=opus']);
    expect(r.rest).toBe('--weird leading body');
  });

  it('inline =value and --no-* forms take no extra span', () => {
    const r = splitLeadingFlags('--resume=chat_abc --no-force follow up', DELEGATE_BOOLEANS);
    expect(r.tokens).toEqual(['--resume=chat_abc', '--no-force']);
    expect(r.rest).toBe('follow up');
  });
});

describe('collapsePromptArgv', () => {
  const brief =
    'Goal: build the tool. Run installer --config custom.yaml --duration 30 --platform win --no-index then expand %~dp0\\bin and report.';

  it('direct CLI shape: quoted brief after -- survives verbatim', () => {
    const argv = ['--model', 'grok', '--timeout', '3600', '--background', '--', brief];
    const r = parseArgv(collapsePromptArgv(argv, DELEGATE_BOOLEANS), DELEGATE_BOOLEANS);
    expect(r.flags['model']).toBe('grok');
    expect(r.flags['timeout']).toBe(3600);
    expect(r.flags['background']).toBe(true);
    expect(r.positional.join(' ').trim()).toBe(brief);
    expect(r.flags['config']).toBeUndefined();
    expect(r.flags['no-index']).toBeUndefined();
  });

  it('slash shape: leading flags inside the packed $ARGUMENTS string are parsed, body kept raw', () => {
    const argv = ['--', `--background --model grok ${brief}`];
    const r = parseArgv(collapsePromptArgv(argv, DELEGATE_BOOLEANS), DELEGATE_BOOLEANS);
    expect(r.flags['background']).toBe(true);
    expect(r.flags['model']).toBe('grok');
    expect(r.positional.join(' ').trim()).toBe(brief);
  });

  it('resume shape: unshifted --resume does not eat the follow-up text', () => {
    const argv = ['--resume', '--', 'řekni mi něco o teto službě'];
    const r = parseArgv(collapsePromptArgv(argv, DELEGATE_BOOLEANS), DELEGATE_BOOLEANS);
    expect(r.flags['resume']).toBe(true);
    expect(r.positional.join(' ').trim()).toBe('řekni mi něco o teto službě');
  });

  it('resume shape: --resume=<id> packed with follow-up extracts the id', () => {
    const argv = ['--', '--resume=chat_abc follow up'];
    const r = parseArgv(collapsePromptArgv(argv, DELEGATE_BOOLEANS), DELEGATE_BOOLEANS);
    expect(r.flags['resume']).toBe('chat_abc');
    expect(r.positional.join(' ').trim()).toBe('follow up');
  });

  it('empty body yields flags only', () => {
    const r = parseArgv(
      collapsePromptArgv(['--resume', '--', ''], DELEGATE_BOOLEANS),
      DELEGATE_BOOLEANS,
    );
    expect(r.flags['resume']).toBe(true);
    expect(r.positional).toEqual([]);
  });
});

// The review prompt path: same contract as delegate — flags lead, the focus
// text is one verbatim trailing operand. Regression for flag-like words in a
// focus brief being consumed as flags (2026-08-19).
const REVIEW_BOOLEANS = ['background', 'wait', 'adversarial', 'git-check', 'help'];

describe('collapsePromptArgv (review shape)', () => {
  it('slash shape: leading flags parsed, focus with flag-like words kept raw', () => {
    const focus = 'focus on the --config flag handling and --no-index paths';
    const argv = ['--wait', '--', `--scope branch ${focus}`];
    const r = parseArgv(collapsePromptArgv(argv, REVIEW_BOOLEANS), REVIEW_BOOLEANS);
    expect(r.flags['wait']).toBe(true);
    expect(r.flags['scope']).toBe('branch');
    expect(r.positional.join(' ').trim()).toBe(focus);
    expect(r.flags['config']).toBeUndefined();
    expect(r.flags['no-index']).toBeUndefined();
  });

  it('worker re-spawn shape without a body parses flags only', () => {
    const argv = ['--worker', 'abc123', '--scope', 'auto', '--timeout', '1800'];
    const r = parseArgv(collapsePromptArgv(argv, REVIEW_BOOLEANS), REVIEW_BOOLEANS);
    expect(r.flags['worker']).toBe('abc123');
    expect(r.flags['scope']).toBe('auto');
    expect(r.flags['timeout']).toBe(1800);
    expect(r.positional).toEqual([]);
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
