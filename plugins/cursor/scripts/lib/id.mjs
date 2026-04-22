// Tiny replacement for `nanoid` — URL-safe random id of the requested length.
import { randomBytes } from 'node:crypto';

/**
 * Generate a URL-safe random id (base64url alphabet) of `length` characters.
 * Defaults to 10, matching the previous nanoid(10) usage.
 *
 * @param {number} [length]
 * @returns {string}
 */
export function id(length = 10) {
  // 8 bytes of entropy → ~11 base64url chars; slice to caller-requested length.
  return randomBytes(Math.max(8, Math.ceil(length * 0.75)))
    .toString('base64url')
    .replace(/[-_]/g, '')
    .slice(0, length)
    .padEnd(length, '0');
}
