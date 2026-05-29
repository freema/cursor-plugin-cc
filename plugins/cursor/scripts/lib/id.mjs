// Tiny replacement for `nanoid` — URL-safe random id of the requested length.
import { randomBytes } from 'node:crypto';

/**
 * Generate a URL-safe random id (base64url alphabet) of exactly `length`
 * characters. Defaults to 10, matching the previous nanoid(10) usage.
 *
 * base64url chars (`A-Za-z0-9-_`) are all filesystem-safe, so we keep them
 * verbatim — no stripping or zero-padding, which previously shortened ids and
 * biased the final character toward `0`. We over-provision the byte count so
 * the unpadded encoding always yields at least `length` chars before slicing.
 *
 * @param {number} [length]
 * @returns {string}
 */
export function id(length = 10) {
  const n = Math.max(1, length);
  const bytes = Math.ceil((n * 3) / 4) + 1;
  return randomBytes(bytes).toString('base64url').slice(0, n);
}
