/**
 * Runtime-portable canonicalization primitives shared by envelope.js,
 * request-builder.js, and response-validator.js. Deliberately avoids
 * `node:crypto` and `Buffer`: everything here is standard Web platform API
 * (Web Crypto SubtleCrypto, TextEncoder), available unchanged in Node,
 * browsers, and Deno/Supabase Edge Functions, so this module's contracts do
 * not need to be rewritten to run outside Node later.
 */

/**
 * Deterministic, key-order-independent JSON serialization: object keys are
 * sorted recursively, arrays keep their order (order is meaningful for
 * arrays). Two deeply-equal values always serialize identically regardless
 * of how their keys were originally inserted.
 */
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * UTF-8 byte length of a value's canonical JSON form (or of a raw string),
 * using TextEncoder rather than Node's Buffer so the same code runs
 * unchanged outside Node.
 */
export function byteLength(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return new TextEncoder().encode(text).length;
}

/**
 * SHA-256 hex digest of a value's canonical stable-stringified form, via
 * the standard Web Crypto SubtleCrypto API (globalThis.crypto.subtle),
 * never Node's `node:crypto`.
 *
 * @param {unknown} value
 * @returns {Promise<string>} lowercase hex digest
 */
export async function sha256Hex(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
