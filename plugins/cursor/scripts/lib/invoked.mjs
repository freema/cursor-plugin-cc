// `process.argv[1] === fileURLToPath(import.meta.url)` is the usual "am I
// the entry point?" check, but it breaks under symlinks (macOS resolves
// /tmp → /private/tmp so the two sides end up lexically different). Compare
// real paths instead.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} moduleUrl    Pass `import.meta.url` from the calling script.
 * @returns {boolean}
 */
export function invokedAsScript(moduleUrl) {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const entryReal = realpathSync(entry);
    const selfReal = realpathSync(fileURLToPath(moduleUrl));
    return entryReal === selfReal;
  } catch {
    return false;
  }
}
