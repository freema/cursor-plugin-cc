import { describe, expect, it } from 'vitest';
import {
  extractJsonBlock,
  parseReviewOutput,
  stripJsonBlock,
} from '../scripts/lib/review-output.mjs';

const GOOD = {
  verdict: 'approve-with-nits',
  summary: 'Solid change, one naming nit.',
  findings: [
    {
      severity: 'nit',
      title: 'Magic number',
      file: 'src/foo.ts',
      line: 12,
      body: '42 should be a named constant.',
      recommendation: 'Extract MAX_RETRIES.',
    },
  ],
  next_steps: ['Rename the constant.'],
};

function withBlock(obj) {
  return `## Findings\n\nsome markdown\n\nAPPROVE WITH NITS\n\n\`\`\`json\n${JSON.stringify(obj, null, 2)}\n\`\`\`\n`;
}

describe('review-output', () => {
  it('parses a valid trailing json block', () => {
    const res = parseReviewOutput(withBlock(GOOD));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.verdict).toBe('approve-with-nits');
      expect(res.data.findings).toHaveLength(1);
      expect(res.data.next_steps).toEqual(['Rename the constant.']);
    }
  });

  it('uses the LAST json block when several are present', () => {
    const text = '```json\n{"quoted": "diff content"}\n```\n' + withBlock(GOOD);
    const res = parseReviewOutput(text);
    expect(res.ok).toBe(true);
    expect(extractJsonBlock(text)).toContain('approve-with-nits');
  });

  it('rejects an unknown verdict', () => {
    const res = parseReviewOutput(withBlock({ ...GOOD, verdict: 'ship-it' }));
    expect(res.ok).toBe(false);
  });

  it('rejects malformed findings', () => {
    const res = parseReviewOutput(
      withBlock({ ...GOOD, findings: [{ severity: 'blocking', title: 'x' }] }),
    );
    expect(res.ok).toBe(false);
  });

  it('accepts null/absent line and missing next_steps', () => {
    const res = parseReviewOutput(
      withBlock({
        verdict: 'approve',
        summary: 'ok',
        findings: [{ severity: 'nit', title: 't', file: 'f', body: 'b', line: null }],
      }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.next_steps).toEqual([]);
  });

  it('reports missing block and broken JSON distinctly', () => {
    expect(parseReviewOutput('plain markdown only').ok).toBe(false);
    const broken = 'text\n```json\n{not json\n```\n';
    const res = parseReviewOutput(broken);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('invalid JSON');
  });

  it('stripJsonBlock removes only the trailing block', () => {
    const text = withBlock(GOOD);
    const stripped = stripJsonBlock(text);
    expect(stripped).toContain('APPROVE WITH NITS');
    expect(stripped).not.toContain('```json');
    // No block → unchanged.
    expect(stripJsonBlock('no block here')).toBe('no block here');
  });
});
