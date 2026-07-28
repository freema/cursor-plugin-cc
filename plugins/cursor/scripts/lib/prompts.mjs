// Prompt templates live in `<plugin-root>/prompts/*.md` so they can be
// reviewed and diffed as prose instead of JS string arrays. Placeholders use
// `{{UPPER_SNAKE}}`; unknown keys interpolate to the empty string.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// lib/ → scripts/ → plugin root
const PLUGIN_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * @param {string} name  Template basename without extension (e.g. "review").
 * @returns {string}
 */
export function loadPromptTemplate(name) {
  return readFileSync(join(PLUGIN_ROOT, 'prompts', `${name}.md`), 'utf8');
}

/**
 * @param {string} template
 * @param {Record<string, string|undefined>} variables
 * @returns {string}
 */
export function interpolateTemplate(template, variables) {
  const filled = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? '') : '',
  );
  // Optional blocks interpolate to '' and would leave runs of blank lines.
  return filled.replace(/\n{3,}/g, '\n\n');
}
