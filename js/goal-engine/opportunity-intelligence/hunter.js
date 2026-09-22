/* ════════════════════════════════════════════════════════════════════════
   HUNTER — an ENRICHMENT provider, deliberately not a discovery one
   ────────────────────────────────────────────────────────────────────────
   Hunter answers "who works here and how do I email them" for a business
   VISION ALREADY DECIDED IS WORTH APPROACHING. It never chooses which
   businesses exist, never scores them, and never sees the offer.

   RAW HUNTER OBJECTS NEVER LEAVE THIS FILE. normalizeHunterDomainSearch()
   is the only exit, and it returns canonical VISION contact records. That
   boundary is the whole design: a provider payload that reached ranking or
   Priority Intelligence would become a second evidence authority, and the
   first time it disagreed with the first one no rule would say which wins.

   ENDPOINT STRATEGY — DOMAIN SEARCH FIRST, ON PURPOSE.
   VISION already holds an official website from Google Places, so Domain
   Search asks "who is at this domain" using something we OBSERVED. Email
   Finder is deliberately not used here: it takes a first and last name, and
   the only way to call it without a grounded person is to invent one. A
   guessed name that happens to resolve is indistinguishable from a real
   finding, so this module cannot make that call at all.

   VERIFICATION IS LAZY. Domain Search already returns a per-email
   confidence and, for many, a verification state. Re-verifying every
   returned address would spend a credit per contact to re-learn what we
   were just told. Verification belongs at the moment an address is actually
   about to be used.
   ════════════════════════════════════════════════════════════════════════ */

import { DiscoveryProviderError, PROVIDER_FAILURE_REASONS } from './providers.js';

export const HUNTER_DOMAIN_SEARCH_ENDPOINT = 'https://api.hunter.io/v2/domain-search';
export const HUNTER_ACCOUNT_ENDPOINT = 'https://api.hunter.io/v2/account';

/* Hunter's own vocabulary, preserved rather than flattened. `accept_all`
   means the mail server accepts everything so nothing was proven, and
   `unknown` means the check did not complete — neither is "valid" and
   neither is "invalid". */
export const HUNTER_VERIFICATION_STATES = Object.freeze([
  'valid', 'invalid', 'accept_all', 'webmail', 'disposable', 'unknown',
]);

/* Local mailboxes that are a function, not a person. Kept as contacts —
   for a small practice reception@ is often the only real way in — but never
   presented as a named individual. */
const GENERIC_LOCAL_PARTS = new Set([
  'info', 'hello', 'contact', 'enquiries', 'enquiry', 'inquiries', 'admin',
  'office', 'reception', 'mail', 'team', 'support', 'help', 'bookings',
  'booking', 'appointments', 'sales', 'accounts', 'hi', 'ask', 'front',
]);

const MAX_CONTACTS_PER_DOMAIN = 20;
const DEFAULT_MAX_LOOKUPS = 1;

function providerError(code, status = null) {
  const known = PROVIDER_FAILURE_REASONS.includes(code) ? code : 'provider_failed';
  const retryable = ['provider_timeout', 'provider_rate_limited', 'provider_unavailable', 'provider_network_error'].includes(known);
  return new DiscoveryProviderError(known, { providerId: 'hunter', status, retryable });
}

/* ── DOMAIN EXTRACTION ─────────────────────────────────────────────────
   Only ever from the canonical official website. Never from a source URL,
   a maps link or a tracking redirect: those describe where we READ about a
   business, not where the business lives. */
const NON_BUSINESS_HOSTS = [
  'google.com', 'google.com.au', 'goo.gl', 'maps.app.goo.gl', 'facebook.com',
  'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'tiktok.com',
  'youtube.com', 'yelp.com', 'bit.ly', 't.co', 'linktr.ee',
];
/* Free mailbox hosts. A business whose "website" is a webmail host has no
   domain of its own to search, and searching gmail.com would return
   strangers. */
const WEBMAIL_HOSTS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'aol.com'];

export function domainFromWebsite(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return { ok: false, reason: 'no_official_website' };
  }
  let url;
  try { url = new URL(rawUrl.trim()); } catch { return { ok: false, reason: 'invalid_url' }; }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: 'unsupported_scheme' };
  if (url.username || url.password) return { ok: false, reason: 'credentialed_url' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'invalid_host' };
  /* Never send an internal or numeric host to a third party. Same class of
     guard as website-inspection.js's SSRF gate, for the same reason.
     THESE RUN BEFORE THE DOT CHECK: bare `localhost` contains no dot, so
     testing shape first would report it as merely malformed and hide that
     it is an internal host — the more important fact about it. */
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) return { ok: false, reason: 'ip_literal' };
  if (host === 'localhost' || /\.(local|internal|localdomain|test|invalid|example)$/.test(host)) {
    return { ok: false, reason: 'internal_host' };
  }
  if (!host.includes('.')) return { ok: false, reason: 'invalid_host' };
  const bare = host.replace(/^www\./, '');
  if (NON_BUSINESS_HOSTS.some((blocked) => bare === blocked || bare.endsWith(`.${blocked}`))) {
    return { ok: false, reason: 'not_a_business_domain' };
  }
  if (WEBMAIL_HOSTS.includes(bare)) return { ok: false, reason: 'webmail_host' };
  if (bare.length > 253) return { ok: false, reason: 'invalid_host' };
  return { ok: true, domain: bare };
}

/* ── NORMALISATION ─────────────────────────────────────────────────────
   Hunter's payload in, canonical VISION contacts out. Pure — no network,
   no clock beyond the injected `checkedAt`. */
export function normalizeHunterDomainSearch(payload, { domain, checkedAt = new Date().toISOString() } = {}) {
  const data = payload && typeof payload === 'object' ? payload.data : null;
  if (!data || typeof data !== 'object') {
    throw providerError('provider_malformed_response');
  }
  const emails = Array.isArray(data.emails) ? data.emails : [];
  const organization = typeof data.organization === 'string' ? data.organization.slice(0, 200) : null;

  const contacts = [];
  const seen = new Set();
  for (const entry of emails) {
    const value = typeof entry?.value === 'string' ? entry.value.trim() : '';
    if (!value || !value.includes('@') || value.length > 320) continue;
    const normalizedValue = value.toLowerCase();
    /* Hunter can return the same address twice across pages; one business,
       one contact. */
    if (seen.has(normalizedValue)) continue;
    seen.add(normalizedValue);

    const localPart = normalizedValue.split('@')[0].replace(/[._-].*$/, '');
    const first = typeof entry?.first_name === 'string' ? entry.first_name.trim() : '';
    const last = typeof entry?.last_name === 'string' ? entry.last_name.trim() : '';
    const personName = [first, last].filter(Boolean).join(' ').slice(0, 200) || null;
    /* A name is what makes a contact personal. `type: 'personal'` from
       Hunter alone is not enough — a personal-TYPE address with no name is
       still nobody we can ask for. */
    const generic = entry?.type === 'generic' || GENERIC_LOCAL_PARTS.has(localPart) || !personName;

    contacts.push({
      channel: 'email',
      value: value.slice(0, 320),
      normalizedValue,
      personName: generic ? null : personName,
      personRole: typeof entry?.position === 'string' && entry.position.trim()
        ? entry.position.trim().slice(0, 200) : null,
      contactKind: generic ? 'generic' : 'personal',
      provider: 'hunter',
      verificationStatus: HUNTER_VERIFICATION_STATES.includes(entry?.verification?.status)
        ? entry.verification.status
        : (HUNTER_VERIFICATION_STATES.includes(entry?.status) ? entry.status : 'unknown'),
      /* Hunter's 0-100 confidence, carried as 0-1. It is the provider's
         confidence in the ADDRESS, never VISION's confidence in the
         prospect. */
      confidence: Number.isFinite(entry?.confidence)
        ? Math.max(0, Math.min(1, entry.confidence / 100)) : null,
      sources: (Array.isArray(entry?.sources) ? entry.sources : [])
        .map((source) => (typeof source?.uri === 'string' ? source.uri.slice(0, 500) : null))
        .filter(Boolean).slice(0, 5),
      organization,
      checkedAt,
    });
    if (contacts.length >= MAX_CONTACTS_PER_DOMAIN) break;
  }
  return { domain: domain || (typeof data.domain === 'string' ? data.domain : null), organization, contacts };
}

/* ── THE PROVIDER ──────────────────────────────────────────────────────
   Named domainSearch(), NOT discover(): requireProviderShape/
   selectDiscoveryProvider treat anything with a discover() as a DISCOVERY
   provider, and Hunter must never be selectable as one. */
export function createHunterProvider({
  apiKey, fetchImpl = globalThis.fetch, maxLookups = DEFAULT_MAX_LOOKUPS,
  timeoutMs = 15_000, usage = null,
} = {}) {
  const configured = typeof apiKey === 'string' && apiKey.trim().length > 0;
  const counters = usage || { lookups: 0, successes: 0, failures: 0, lastFailureReason: null };

  if (!configured) {
    /* A degraded provider, not a throw — the same shape
       createGooglePlacesProvider uses, so a deployment with no key refuses
       honestly instead of crashing a request. */
    return {
      id: 'hunter', configured: false, credentialRequirement: 'HUNTER_API_KEY',
      getUsage: () => ({ ...counters, lastFailureReason: 'provider_not_configured' }),
      async domainSearch() { throw providerError('provider_not_configured'); },
    };
  }
  if (typeof fetchImpl !== 'function') throw new Error('invalid_fetch_implementation');

  return {
    id: 'hunter',
    configured: true,
    credentialRequirement: 'HUNTER_API_KEY',
    getUsage: () => ({ ...counters }),

    /** ONE Domain Search. No retry: every Hunter failure mode here is
     *  either terminal (auth, legal, quota) or costs another credit to
     *  re-ask, and a silent second charge is not a resilience feature. */
    async domainSearch(domain, { limit = 10 } = {}) {
      if (typeof domain !== 'string' || !domain.includes('.')) throw providerError('provider_request_rejected');
      if (counters.lookups >= maxLookups) throw providerError('provider_rate_limited');
      counters.lookups += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = `${HUNTER_DOMAIN_SEARCH_ENDPOINT}?domain=${encodeURIComponent(domain)}`
          + `&limit=${Math.max(1, Math.min(25, limit))}&api_key=${encodeURIComponent(apiKey)}`;
        const response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
        if (!response || typeof response.status !== 'number') {
          counters.failures += 1; counters.lastFailureReason = 'provider_malformed_response';
          throw providerError('provider_malformed_response');
        }
        if (!response.ok) {
          const code = response.status === 429 ? 'provider_rate_limited'
            : response.status === 451 ? 'provider_legally_restricted'
            : [401, 403].includes(response.status) ? 'provider_auth_rejected'
            : response.status >= 500 ? 'provider_unavailable'
            : 'provider_request_rejected';
          counters.failures += 1; counters.lastFailureReason = code;
          throw providerError(code, response.status);
        }
        let payload;
        try { payload = await response.json(); } catch {
          counters.failures += 1; counters.lastFailureReason = 'provider_malformed_response';
          throw providerError('provider_malformed_response');
        }
        const normalized = normalizeHunterDomainSearch(payload, { domain });
        counters.successes += 1;
        return normalized;
      } catch (error) {
        if (error instanceof DiscoveryProviderError) throw error;
        const code = error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error';
        counters.failures += 1; counters.lastFailureReason = code;
        throw providerError(code);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Account state. Free, consumes no search credit — used to price a run
 *  BEFORE it happens rather than discovering the cost afterwards. */
export async function readHunterAccount({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) return { ok: false, status: null, requests: null };
  try {
    const response = await fetchImpl(`${HUNTER_ACCOUNT_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}`);
    if (!response?.ok) return { ok: false, status: response?.status ?? null, requests: null };
    const payload = await response.json().catch(() => null);
    return { ok: true, status: 200, requests: payload?.data?.requests ?? null };
  } catch {
    return { ok: false, status: null, requests: null };
  }
}
