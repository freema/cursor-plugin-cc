// Tiny Markdown helpers shared by the table-rendering commands.

/**
 * Make a value safe to drop into a single Markdown table cell: coerce to a
 * string, collapse whitespace to single spaces, and escape `|` so it does not
 * split the cell. Returns '' for null/undefined.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function mdCell(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}
