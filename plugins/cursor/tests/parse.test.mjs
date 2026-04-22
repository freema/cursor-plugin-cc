import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractChatId, parseLine, summariseEvents } from '../scripts/lib/parse.mjs';
import { FAILURE_FIXTURE, HAPPY_FIXTURE } from './helpers.mjs';

function loadFixture(path) {
  const raw = readFileSync(path, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const ev = parseLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

describe('parse', () => {
  it('drops empty and malformed lines', () => {
    expect(parseLine('')).toBeNull();
    expect(parseLine('   ')).toBeNull();
    expect(parseLine('not json')).toBeNull();
    expect(parseLine('null')).toBeNull();
    expect(parseLine('{"type":"x"}')?.type).toBe('x');
  });

  it('extracts chat id from the happy-path stream', () => {
    const events = loadFixture(HAPPY_FIXTURE);
    expect(extractChatId(events)).toBe('chat_abc123');
  });

  it('extracts chat id from the failure stream', () => {
    const events = loadFixture(FAILURE_FIXTURE);
    expect(extractChatId(events)).toBe('chat_fail_999');
  });

  it('returns undefined when no chat id present', () => {
    expect(extractChatId([{ type: 'assistant' }])).toBeUndefined();
  });

  it('summarises happy-path: files touched + success text', () => {
    const events = loadFixture(HAPPY_FIXTURE);
    const s = summariseEvents(events);
    expect(s.success).toBe(true);
    expect(s.filesTouched).toEqual(expect.arrayContaining(['src/foo.ts', 'README.md']));
    expect(s.summary).toContain('Added src/foo.ts');
  });

  it('summarises failure stream: success=false and error reason', () => {
    const events = loadFixture(FAILURE_FIXTURE);
    const s = summariseEvents(events);
    expect(s.success).toBe(false);
    expect(s.exitReason).toBe('error');
    expect(s.summary).toContain('Aborted');
  });
});
