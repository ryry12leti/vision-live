/* ════════════════════════════════════════════════════════════════════════
   GEMINI OFFICIAL-WEBSITE READER — A SENSOR, NOT A SOURCE

   Gemini reads first-party pages and reports what is visibly stated. It is
   never the provider of record: a claim is attributed to the SITE it was
   read from (`official_website`), with the model recorded only in
   `research_method: 'gemini_url_context'`. That is why `gemini` is not, and
   must not become, a TRUSTED_PROVIDERS entry — the locked BusinessTruth
   compiler would then be trusting a model's say-so instead of a page.

   ── THE MODEL CANNOT CERTIFY ITS OWN GROUNDING ──────────────────────────
   Every claim must carry a quote, and `verifyClaims` checks that quote is a
   LITERAL SUBSTRING of text actually retrieved from that URL. A model
   confirming its own citation is not a check. This is the same rule the
   Trends sensor already enforces, and it is the only thing standing between
   "the page says this" and "the model said the page says this".

   ── FAILS CLOSED, AND NEVER REPAIRS ─────────────────────────────────────
   Truncated JSON is discarded whole. `gemini-3.6-flash` is a thinking model
   that spends output budget internally — the capability probe hit
   MAX_TOKENS after 27 visible tokens at an 800 ceiling — so truncation is
   an expected failure mode here, not an exotic one. Silently repairing a
   half-written object would invent evidence at exactly the moment the model
   ran out of room to finish it.

   PURE except for `readWebsitePages`, which takes fetch by injection.
   ══════════════════════════════════════════════════════════════════════ */

import { redactSecrets, assertNoSecretInUrl } from '../shared/secret-redaction.js';

export const RESEARCH_METHOD = 'gemini_url_context';
export const WEBSITE_PROVIDER = 'official_website';
export const GEMINI_MODEL = 'gemini-3.6-flash';
export const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';
export const CREDENTIAL_ENV = 'GEMINI_API_KEY';
export const RESEARCH_FLAG = 'PRACTICE_WEBSITE_RESEARCH_ENABLED';

/* THINKING-MODEL BUDGET. The probe proved 800 is far too small: the model
   consumed it on reasoning and returned a truncated object. 8000 leaves
   real headroom for a schema-pinned answer while still bounding cost. */
export const MAX_OUTPUT_TOKENS = 8000;
/* Deterministic crawl bounds. A business site is not crawled; a fixed,
   named set of candidate pages is attempted and the rest is ignored. */
export const MAX_PAGES = 6;
export const REQUEST_TIMEOUT_MS = 60000;

/* The page shapes worth asking for, in priority order. Deterministic:
   the same site always yields the same attempt list, so a research run is
   reproducible and its cost is knowable before it starts. */
export const PAGE_INTENTS = Object.freeze([
  { intent: 'home', paths: [''] },
  { intent: 'services', paths: ['services', 'treatments', 'what-we-do'] },
  { intent: 'contact', paths: ['contact', 'contact-us'] },
  { intent: 'about', paths: ['about', 'about-us'] },
  { intent: 'team', paths: ['team', 'our-team', 'staff'] },
  { intent: 'booking', paths: ['book', 'booking', 'appointments'] },
]);

/* The claim vocabulary. Enum-pinned so an unknown kind is impossible rather
   than merely discouraged — the lesson from the Founder plan work, where
   enum pinning is what stopped hallucination, not prompt wording. */
export const CLAIM_KINDS = Object.freeze([
  'service_offered', 'contact_route', 'booking_route',
  'location_stated', 'team_member', 'business_category', 'operating_detail',
]);

export const WEBSITE_CLAIM_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...CLAIM_KINDS] },
          value: { type: 'string' },
          quote: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['kind', 'value', 'quote', 'confidence'],
      },
    },
  },
  required: ['claims'],
});

/** Deterministic candidate URLs for one verified official website. */
export function candidatePages(officialWebsite, limit = MAX_PAGES) {
  const raw = String(officialWebsite ?? '').trim();
  if (!raw) return [];
  let origin = '';
  try { origin = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin; } catch { return []; }
  const out = [];
  for (const { intent, paths } of PAGE_INTENTS) {
    if (out.length >= limit) break;
    out.push({ intent, url: paths[0] ? `${origin}/${paths[0]}` : `${origin}/` });
  }
  return out.slice(0, limit);
}

/** Pure request body. No key, no network — so the prompt is assertable. */
export function buildResearchRequest({ url, intent }) {
  if (!url) return null;
  return {
    contents: [{
      role: 'user',
      parts: [{
        text: [
          'Read the page at the URL below and report ONLY what is visibly',
          'stated on it. You are a sensor, not an advisor.',
          '',
          'For each piece of evidence, report:',
          '  kind       — service_offered, contact_route, booking_route,',
          '               location_stated, team_member, business_category,',
          '               operating_detail',
          '  value      — the fact itself, in a few plain words',
          '  quote      — an EXACT quote copied character-for-character from',
          '               the page. Do not paraphrase, translate, correct or',
          '               shorten it. A quote not present on the page is',
          '               discarded and the claim with it.',
          '  confidence — high, medium or low',
          '',
          'Do not infer. Do not describe what is missing. Do not say anything',
          'about the business that the page does not state. If the page states',
          'nothing of these kinds, return an empty list.',
          '',
          `PAGE INTENT: ${intent ?? 'unknown'}`,
          `URL: ${url}`,
        ].join('\n'),
      }],
    }],
    tools: [{ urlContext: {} }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      responseSchema: WEBSITE_CLAIM_SCHEMA,
    },
  };
}

/* Normalise for substring comparison: collapse whitespace and unify the
   quote characters a model habitually "corrects". Case is preserved —
   a quote that differs in case is still a quote from the page. */
const norm = (s) => String(s ?? '')
  .replace(/[‘’‛]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * THE LOAD-BEARING CHECK. A claim survives only if its quote occurs
 * literally in text retrieved from that page.
 *
 * @param {object[]} claims      model output
 * @param {string}   pageText    text actually retrieved from the URL
 * @returns {{kept: object[], rejected: object[]}}
 */
export function verifyClaims(claims, pageText) {
  const hay = norm(pageText);
  const kept = []; const rejected = [];
  for (const c of Array.isArray(claims) ? claims : []) {
    const quote = norm(c?.quote);
    if (!c || !CLAIM_KINDS.includes(c.kind)) { rejected.push({ claim: c, reason: 'unknown_kind' }); continue; }
    if (!String(c.value ?? '').trim()) { rejected.push({ claim: c, reason: 'empty_value' }); continue; }
    if (quote.length < 8) { rejected.push({ claim: c, reason: 'quote_too_short' }); continue; }
    if (!hay) { rejected.push({ claim: c, reason: 'no_retrieved_text_to_verify_against' }); continue; }
    if (!hay.includes(quote)) { rejected.push({ claim: c, reason: 'quote_not_in_page' }); continue; }
    kept.push(c);
  }
  return { kept, rejected };
}

/**
 * Project verified claims onto opportunity_signals rows.
 * The provider recorded is the SITE, never the model.
 */
export function claimsToSignals({ claims, url, entityId, observedAt }) {
  const stamp = observedAt || null;
  return (claims || []).map((c, i) => ({
    signal_id: `web:${c.kind}:${i}`,
    opportunity_id: entityId,
    kind: kindToSignalKind(c.kind),
    evidence_status: 'OBSERVED',
    confidence: c.confidence === 'high' ? 0.85 : (c.confidence === 'medium' ? 0.65 : 0.45),
    source_url: url,
    research_method: RESEARCH_METHOD,
    checked_at: stamp,
    value: {
      /* THE SITE IS THE PROVIDER. `gemini` appears nowhere in this object,
         so the locked compiler's TRUSTED_PROVIDERS allowlist needs no edit
         and the fixture gate cannot mistake this for seeded data. */
      provider: WEBSITE_PROVIDER,
      claim: c.value,
      quote: c.quote,
      readBy: RESEARCH_METHOD,
      /* The shape each KIND_SPEC.read() actually expects. Getting this wrong
         is silent: read() returns null and the row is dropped as an
         unhandled shape, visible only in `excluded`, which nothing reads. */
      ...valueShapeFor(c),
    },
  }));
}

/* Map the reader's vocabulary onto kinds the locked compiler already
   projects. A claim with no home is NOT invented into one — it is dropped,
   because adding a KIND_SPEC entry is a change to a locked file and must be
   a deliberate decision, not a side effect of a new provider. */
/* Project a claim onto the exact value shape its target kind reads. */
export function valueShapeFor(claim) {
  const v = String(claim?.value ?? '').trim();
  switch (claim?.kind) {
    case 'service_offered': return { services: [v] };
    case 'contact_route': return { channel: /email/i.test(v) ? 'email' : 'call' };
    case 'booking_route': return { routes: [/book/i.test(v) ? 'booking' : 'enquiry'] };
    case 'location_stated': return { matched: v };
    case 'operating_detail': return { status: v };
    case 'business_category': return { category: v };
    default: return {};
  }
}

export function kindToSignalKind(claimKind) {
  switch (claimKind) {
    case 'contact_route': return 'contactability';
    case 'booking_route': return 'conversion_path';
    case 'location_stated': return 'location_fit';
    case 'business_category': return 'listing';
    case 'operating_detail': return 'operating_status';
    case 'service_offered': return 'service_offering';
    /* team_member is deliberately NOT mapped. Gemini can extract it, but no
       Practice use case has proved it is needed, and a kind with no consumer
       is scope taken on because it was available rather than because it was
       wanted. It stays dropped until a real call shows it missing. */
    default: return null;
  }
}

/**
 * Read one page. Returns a typed refusal rather than throwing.
 * The key travels in a header and every error body is redacted with the
 * actual key value, so a provider echoing the credential back cannot log it.
 */
export async function readPage({
  url, intent, apiKey, model = GEMINI_MODEL,
  fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const body = buildResearchRequest({ url, intent });
  if (!body) return { ok: false, reason: 'no_input' };
  if (!apiKey || !String(apiKey).trim()) return { ok: false, reason: 'unconfigured' };

  const endpoint = `${GEMINI_API_ROOT}/${model}:generateContent`;
  assertNoSecretInUrl(endpoint, [apiKey]);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': String(apiKey) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        reason: res.status === 429 ? 'rate_limited'
          : ([401, 403].includes(res.status) ? 'unauthorized' : 'http_error'),
        status: res.status,
        detail: redactSecrets(text, [apiKey]).slice(0, 400),
      };
    }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'malformed_response' }; }
    const cand = parsed?.candidates?.[0];
    const finish = cand?.finishReason || null;
    /* TRUNCATION IS A REFUSAL. Never repaired, never partially accepted. */
    if (finish === 'MAX_TOKENS') return { ok: false, reason: 'truncated_output', finishReason: finish };

    const meta = (cand?.urlContextMetadata?.urlMetadata || [])
      .map((m) => ({ url: m.retrievedUrl, status: m.urlRetrievalStatus }));
    const retrieved = meta.some((m) => m.status === 'URL_RETRIEVAL_STATUS_SUCCESS');
    if (!retrieved) return { ok: false, reason: 'url_not_retrieved', urlMeta: meta };

    const out = (cand?.content?.parts || []).map((p) => p.text).filter(Boolean).join('');
    let claims = null;
    try { claims = JSON.parse(out)?.claims; } catch { return { ok: false, reason: 'unparseable_claims' }; }
    if (!Array.isArray(claims)) return { ok: false, reason: 'no_claims_array' };

    return {
      ok: true, claims, urlMeta: meta, finishReason: finish,
      usage: parsed?.usageMetadata || null,
    };
  } catch (e) {
    return { ok: false, reason: 'transport_error', detail: redactSecrets(e?.message, [apiKey]) };
  } finally {
    clearTimeout(timer);
  }
}
