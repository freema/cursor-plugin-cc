import { describe, expect, it } from 'vitest';
import { interpolateTemplate, loadPromptTemplate } from '../scripts/lib/prompts.mjs';

describe('prompts', () => {
  it('interpolates known keys and blanks unknown ones', () => {
    const out = interpolateTemplate('a {{FOO}} b {{MISSING}} c', { FOO: 'x' });
    expect(out).toBe('a x b  c');
  });

  it('collapses blank-line runs left by empty optional blocks', () => {
    const out = interpolateTemplate('line1\n\n{{OPT}}\n\nline2', { OPT: '' });
    expect(out).toBe('line1\n\nline2');
  });

  it('loads the shipped templates', () => {
    const review = loadPromptTemplate('review');
    expect(review).toContain('{{REVIEW_TARGET}}');
    expect(review).toContain('READ-ONLY review');
    const gate = loadPromptTemplate('stop-review-gate');
    expect(gate).toContain('{{CLAUDE_RESPONSE_BLOCK}}');
    expect(gate).toContain('ALLOW:');
    expect(gate).toContain('BLOCK:');
  });
});
