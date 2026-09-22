/* ════════════════════════════════════════════════════════════════════════
   SECRET REDACTION — STRUCTURAL FIRST, PATTERN SECOND

   The Trends Gemini adapter scrubbed provider error bodies with a single
   regex for `AIza...` keys. The credential this project actually holds is
   53 characters beginning `AQ.` — so the one protection that existed would
   have passed the real key straight through into a log the moment Google
   echoed it back in a 400.

   That is the whole argument for not trusting a pattern list. A regex only
   redacts credential shapes somebody already thought of, and a provider is
   free to invent a new one. So the primary mechanism here is STRUCTURAL:
   the caller hands over the secret values it actually used, and any exact
   occurrence of one is removed regardless of shape. The patterns below are
   a backstop for secrets this process never saw — a key belonging to a
   different service echoed inside someone else's error body.

   PURE. No I/O, no env reads, no imports. It never learns a secret on its
   own, because a module that goes looking for credentials is a module that
   can be made to find one and print it.
   ══════════════════════════════════════════════════════════════════════ */

export const REDACTED = '[redacted]';

/* Known Google credential shapes. Deliberately NOT the only defence.
   - AIza...  classic Google API key
   - AQ....   the newer format this project's Gemini key actually uses
   - ya29...  OAuth access token, in case one is ever in play
   Ordered longest-prefix-first so a nested match cannot leave a fragment. */
export const CREDENTIAL_PATTERNS = Object.freeze([
  /AIza[0-9A-Za-z_\-]{10,}/g,
  /\bAQ\.[0-9A-Za-z_\-.]{10,}/g,
  /\bya29\.[0-9A-Za-z_\-.]{10,}/g,
  /\bsk-[0-9A-Za-z_\-]{16,}/g,
  /\beyJ[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}\.[0-9A-Za-z_\-]{10,}/g,
]);

/* Query parameters that carry credentials by convention. The value is
   removed even when it matches no known shape, because "it was sent as
   ?key=" is itself the evidence that it is one. */
const SECRET_PARAM = /([?&](?:key|api_?key|access_?token|token|auth|password|secret)=)[^&\s"'\\]+/gi;

/* Escape a literal for use inside a RegExp. */
const escapeLiteral = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Redact secrets from arbitrary text.
 *
 * @param {unknown} input      the text (an error body, a URL, a message)
 * @param {string[]} secrets   the ACTUAL secret values this caller used.
 *                             These are removed by exact match, which is what
 *                             makes the function safe against credential
 *                             shapes nobody has enumerated.
 * @returns {string}
 */
export function redactSecrets(input, secrets = []) {
  let out = String(input ?? '');
  if (!out) return out;

  /* ── STRUCTURAL PASS. Exact values first, longest first so that a secret
        which contains another secret as a prefix cannot leave a tail behind.
        A short or empty value is skipped: redacting every occurrence of a
        2-character "secret" would destroy the message and teach nothing. */
  const known = (Array.isArray(secrets) ? secrets : [secrets])
    .map((s) => String(s ?? ''))
    .filter((s) => s.trim().length >= 8)
    .sort((a, b) => b.length - a.length);
  for (const secret of known) {
    out = out.replace(new RegExp(escapeLiteral(secret), 'g'), REDACTED);
  }

  /* ── PATTERN PASS. Only for credentials this process never held. */
  for (const re of CREDENTIAL_PATTERNS) out = out.replace(re, REDACTED);

  /* ── CONVENTION PASS. Anything sent as a secret-named query parameter. */
  out = out.replace(SECRET_PARAM, `$1${REDACTED}`);

  return out;
}

/**
 * True when the text still contains any recognisable credential.
 * Used by gates to assert a redaction actually happened rather than
 * asserting that a particular regex fired.
 */
export function containsCredential(input, secrets = []) {
  const s = String(input ?? '');
  if (!s) return false;
  const known = (Array.isArray(secrets) ? secrets : [secrets])
    .map((x) => String(x ?? '')).filter((x) => x.trim().length >= 8);
  if (known.some((k) => s.includes(k))) return true;
  return CREDENTIAL_PATTERNS.some((re) => { re.lastIndex = 0; return re.test(s); });
}

/**
 * A credential must never travel in a URL: query strings reach proxies,
 * browser history, referrer headers and every log line in between. Callers
 * put the key in a header instead. This asserts that rule rather than
 * trusting the caller to remember it.
 */
export function assertNoSecretInUrl(url, secrets = []) {
  const s = String(url ?? '');
  if (containsCredential(s, secrets) || SECRET_PARAM.test(s)) {
    SECRET_PARAM.lastIndex = 0;
    throw new Error('secret_in_url_refused');
  }
  SECRET_PARAM.lastIndex = 0;
  return s;
}
