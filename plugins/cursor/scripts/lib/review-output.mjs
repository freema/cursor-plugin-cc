// Parse the structured ```json block a review run appends after its Markdown
// findings (contract: schemas/review-output.schema.json). Hand-rolled
// structural validation — no schema-validator dependency (zero-deps rule).
// Reviews from models that ignore the instruction simply stay unstructured;
// nothing here is allowed to fail a review.

export const VERDICTS = ['approve', 'approve-with-nits', 'request-changes'];
export const SEVERITIES = ['blocking', 'should-fix', 'nit'];

const FENCE_RE = /```json\s*\n([\s\S]*?)```/g;

/**
 * Last fenced ```json block in the text (the verdict block is instructed to
 * come last; earlier blocks may be quoted diff content).
 *
 * @param {string} text
 * @returns {string|null}
 */
export function extractJsonBlock(text) {
  let last = null;
  for (const m of String(text ?? '').matchAll(FENCE_RE)) last = m[1];
  return last;
}

/**
 * Strip the trailing structured block from a review summary for display —
 * the data lives on the job record; the JSON fence is noise for a human.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripJsonBlock(text) {
  const s = String(text ?? '');
  const matches = [...s.matchAll(FENCE_RE)];
  const last = matches[matches.length - 1];
  if (!last) return s;
  return (s.slice(0, last.index) + s.slice(last.index + last[0].length)).trim();
}

/**
 * @param {unknown} f
 * @returns {boolean}
 */
function isValidFinding(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  const o = /** @type {Record<string, unknown>} */ (f);
  if (!SEVERITIES.includes(String(o.severity))) return false;
  if (typeof o.title !== 'string' || !o.title.trim()) return false;
  if (typeof o.file !== 'string' || !o.file.trim()) return false;
  if (typeof o.body !== 'string' || !o.body.trim()) return false;
  if (o.line != null && (!Number.isInteger(o.line) || Number(o.line) < 1)) return false;
  if (o.recommendation != null && typeof o.recommendation !== 'string') return false;
  return true;
}

/**
 * @typedef {Object} ReviewOutput
 * @property {'approve'|'approve-with-nits'|'request-changes'} verdict
 * @property {string} summary
 * @property {Array<{severity: string, title: string, file: string, line?: number|null, body: string, recommendation?: string}>} findings
 * @property {string[]} next_steps
 */

/**
 * @param {string} text  Full review summary text.
 * @returns {{ok: true, data: ReviewOutput} | {ok: false, error: string}}
 */
export function parseReviewOutput(text) {
  const block = extractJsonBlock(text);
  if (!block) return { ok: false, error: 'no fenced json block found' };
  let parsed;
  try {
    parsed = JSON.parse(block);
  } catch (err) {
    return {
      ok: false,
      error: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'top level is not an object' };
  }
  if (!VERDICTS.includes(String(parsed.verdict))) {
    return { ok: false, error: `unknown verdict: ${String(parsed.verdict)}` };
  }
  if (typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
    return { ok: false, error: 'missing summary' };
  }
  if (!Array.isArray(parsed.findings) || !parsed.findings.every(isValidFinding)) {
    return { ok: false, error: 'findings missing or malformed' };
  }
  const nextSteps = Array.isArray(parsed.next_steps)
    ? parsed.next_steps.filter((s) => typeof s === 'string' && s.trim())
    : [];
  return {
    ok: true,
    data: {
      verdict: parsed.verdict,
      summary: parsed.summary,
      findings: parsed.findings,
      next_steps: nextSteps,
    },
  };
}
