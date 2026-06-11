import { describe, expect, it } from 'vitest';
import { jobNotFoundMessage } from '../scripts/lib/hints.mjs';

describe('jobNotFoundMessage', () => {
  it('names the missing id and ends with a newline', () => {
    const msg = jobNotFoundMessage('bo2565uts');
    expect(msg).toContain('No job `bo2565uts` found for this repository.');
    expect(msg.endsWith('\n')).toBe(true);
  });

  it('hints that a Claude Code background ID is not the Cursor job ID', () => {
    const msg = jobNotFoundMessage('bo2565uts');
    expect(msg).toContain('Claude Code background notification');
    expect(msg).toContain("Claude Code's own ID");
    // Points the user at the recovery path.
    expect(msg).toContain('`/cursor:status` with no arguments');
  });

  it('escapes the id verbatim into a code span', () => {
    expect(jobNotFoundMessage('7FfFUyUK5w')).toContain('`7FfFUyUK5w`');
  });
});
