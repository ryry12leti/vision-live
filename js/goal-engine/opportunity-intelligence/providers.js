import { validateSearchRequest } from './contract.js';
import { providerQueryScope } from './location.js';

export const DISCOVERY_PROVIDER_MODES = Object.freeze(['google_places', 'fixture', 'manual']);
export const PROVIDER_FAILURE_REASONS = Object.freeze([
  'provider_not_configured', 'provider_timeout', 'provider_rate_limited', 'provider_auth_rejected',
  'provider_request_rejected', 'provider_unavailable', 'provider_network_error',
  'provider_malformed_response', 'provider_empty', 'provider_failed',
  /* HTTP 451. A provider refusing on legal grounds — a GDPR erasure or a
     removal request against a named person — is NOT a transient fault and
     NOT an empty result. It must never be retried (retrying is the thing the
     person asked us to stop doing) and must never be routed around by asking
     a different endpoint for the same identity. Distinct from
     provider_request_rejected so no caller can confuse "we were told no by
     law" with "our query was malformed". */
  'provider_legally_restricted',
  /* HTTP 402. The plan is spent. Distinct from provider_rate_limited because
     waiting does not fix it — a throttle clears in seconds, an exhausted
     balance clears when somebody pays — and treating the two alike turns a
     billing state into an infinite retry loop. Never retryable. */
  'provider_quota_exhausted',
]);

const RETRYABLE_FAILURES = new Set(['provider_timeout', 'provider_rate_limited', 'provider_unavailable', 'provider_network_error']);

export class DiscoveryProviderError extends Error {
  constructor(code, { providerId = 'unknown', retryable = false, status = null } = {}) {
    super(code);
    this.name = 'DiscoveryProviderError';
    this.code = PROVIDER_FAILURE_REASONS.includes(code) ? code : 'provider_failed';
    this.providerId = providerId;
    this.retryable = retryable;
    this.status = status;
  }
}

function providerError(code, providerId, status = null) {
  return new DiscoveryProviderError(code, { providerId, status, retryable: RETRYABLE_FAILURES.has(code) });
}

export function classifyProviderError(error) {
  if (error instanceof DiscoveryProviderError) return error.code;
  if (PROVIDER_FAILURE_REASONS.includes(error?.code)) return error.code;
  if (PROVIDER_FAILURE_REASONS.includes(error?.message)) return error.message;
  if (error?.name === 'AbortError') return 'provider_timeout';
  return 'provider_failed';
}

function requireProviderShape(provider) {
  if (!provider || typeof provider.id !== 'string' || typeof provider.discover !== 'function') throw new Error('invalid_provider_adapter');
  return provider;
}

function boundedInteger(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** Composes the provider's text query from the target customer plus the
 * SCOPE-appropriate qualifier. An `online` scope contributes no place
 * qualifier at all, so an online search stays an online search. */
export function buildTextQuery(request) {
  const scope = providerQueryScope(request?.location);
  const target = String(request?.targetCustomer || '').trim();
  const qualifier = scope?.queryQualifier ? ` ${scope.queryQualifier}` : '';
  return `${target}${qualifier}`.trim().slice(0, 400);
}

export function providerCredentialState(env = process.env) {
  const hasGoogleKey = typeof env.GOOGLE_PLACES_API_KEY === 'string' && env.GOOGLE_PLACES_API_KEY.trim().length > 0;
  return {
    googlePlaces: hasGoogleKey ? 'configured' : 'missing',
    configuredMode: DISCOVERY_PROVIDER_MODES.includes(env.LEAD_INTELLIGENCE_PROVIDER_MODE)
      ? env.LEAD_INTELLIGENCE_PROVIDER_MODE
      : 'manual',
    requiredEnvironmentVariable: 'GOOGLE_PLACES_API_KEY',
  };
}

export function selectDiscoveryProvider({ mode, env = process.env, fixtureCandidates = [], fetchImpl } = {}) {
  const selectedMode = mode || providerCredentialState(env).configuredMode;
  if (!DISCOVERY_PROVIDER_MODES.includes(selectedMode)) {
    return { ok: false, mode: 'manual', reason: 'provider_request_rejected', provider: null };
  }
  if (selectedMode === 'fixture') {
    if (env.FOUNDER_OWNER_PREVIEW_FIXTURES_ENABLED !== 'true') {
      return { ok: false, mode: 'manual', reason: 'provider_not_configured', provider: null };
    }
    return { ok: true, mode: 'fixture_only', provider: createFixtureProvider(fixtureCandidates) };
  }
  if (selectedMode === 'manual') return { ok: false, mode: 'manual', reason: 'provider_not_configured', provider: null };
  if (providerCredentialState(env).googlePlaces !== 'configured') return { ok: false, mode: 'manual', reason: 'provider_not_configured', provider: null };
  return { ok: true, mode: 'google_places', provider: createGooglePlacesProvider({ apiKey: env.GOOGLE_PLACES_API_KEY, fetchImpl }) };
}

export function createGooglePlacesProvider({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  maxAttempts = 2,
  resultLimit = 20,
  retryDelayMs = 75,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const providerId = 'google_places';
  if (!apiKey) {
    return {
      id: providerId,
      configured: false,
      credentialRequirement: 'GOOGLE_PLACES_API_KEY',
      discover: async () => { throw providerError('provider_not_configured', providerId); },
      getUsage: () => ({ requests: 0, successes: 0, failures: 0, lastFailureReason: 'provider_not_configured' }),
    };
  }
  if (typeof fetchImpl !== 'function') throw new Error('invalid_fetch_implementation');

  const attemptsLimit = boundedInteger(maxAttempts, 2, 1, 3);
  const maxResults = boundedInteger(resultLimit, 20, 1, 20);
  const requestTimeoutMs = boundedInteger(timeoutMs, 8000, 100, 20000);
  const usage = { requests: 0, successes: 0, failures: 0, lastFailureReason: null };

  return requireProviderShape({
    id: providerId,
    configured: true,
    credentialRequirement: 'GOOGLE_PLACES_API_KEY',
    getUsage: () => ({ ...usage }),
    async discover(request) {
      const validation = validateSearchRequest(request);
      if (!validation.valid) throw providerError('provider_request_rejected', providerId);

      let lastError = null;
      for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
        usage.requests += 1;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
        try {
          const response = await fetchImpl('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              // Every field below is preserved verbatim onto the candidate.
              // rating/userRatingCount/primaryType were previously not even
              // requested, so the scorer had nothing factual to work with and
              // fell back to matching words in prose.
              'X-Goog-FieldMask': [
                'places.id', 'places.displayName', 'places.formattedAddress', 'places.shortFormattedAddress',
                'places.businessStatus', 'places.websiteUri', 'places.nationalPhoneNumber',
                'places.googleMapsUri', 'places.types', 'places.primaryType', 'places.primaryTypeDisplayName',
                'places.rating', 'places.userRatingCount', 'places.location',
                /* BUSINESS-LOCAL TIME. situation-state.js reads the SERVER's
                   clock, so a Sydney practice at 11am local was simulated at
                   `hour: 0, bucket: 'early'` — measured in the Practice
                   corpus, not theorised. These three fields are what let
                   BusinessActivityState use the business's own wall clock.
                   They are REQUESTED here; whether this configured key
                   actually returns them is unproven until a real call is
                   approved, and the consumer treats each as absent-unless-
                   present rather than assuming it arrived. */
                'places.regularOpeningHours', 'places.utcOffsetMinutes',
                'places.currentOpeningHours',
              ].join(','),
            },
            // The scope decides the query text. An `online` or `nationwide`
            // search must never be silently narrowed to a locality string.
            body: JSON.stringify({ textQuery: buildTextQuery(request), maxResultCount: maxResults }),
          });
          if (!response || typeof response.ok !== 'boolean') throw providerError('provider_malformed_response', providerId);
          if (!response.ok) {
            const code = response.status === 429
              ? 'provider_rate_limited'
              : [401, 403].includes(response.status)
                ? 'provider_auth_rejected'
                : response.status >= 500
                  ? 'provider_unavailable'
                  : 'provider_request_rejected';
            throw providerError(code, providerId, response.status);
          }
          const payload = await response.json().catch(() => { throw providerError('provider_malformed_response', providerId); });
          if (!payload || typeof payload !== 'object' || !Array.isArray(payload.places)) throw providerError('provider_malformed_response', providerId);
          const places = payload.places.slice(0, maxResults);
          if (places.some((place) => !place
            || typeof place.id !== 'string' || place.id.length === 0 || place.id.length > 300
            || typeof place.displayName?.text !== 'string' || place.displayName.text.length === 0 || place.displayName.text.length > 300
            || typeof place.formattedAddress !== 'string' || place.formattedAddress.length === 0 || place.formattedAddress.length > 500
            || (place.websiteUri && !/^https?:\/\//i.test(place.websiteUri))
            || (place.googleMapsUri && !/^https?:\/\//i.test(place.googleMapsUri))
            || (place.types && !Array.isArray(place.types)))) {
            throw providerError('provider_malformed_response', providerId);
          }
          const fetchedAt = new Date().toISOString();
          const candidates = places.map((place) => ({
            provider: providerId,
            externalProviderId: place.id,
            name: place.displayName.text,
            address: place.formattedAddress,
            closed: place.businessStatus === 'CLOSED_PERMANENTLY',
            officialWebsite: place.websiteUri || null,
            publicPhone: place.nationalPhoneNumber || null,
            mapUrl: place.googleMapsUri || null,
            category: place.primaryTypeDisplayName?.text || place.primaryType || (place.types || [])[0] || null,
            // BOTH public sources we actually used, not just the map listing.
            // opportunity_search_persist_v1 only persists an observation whose
            // sourceUrl matches a registered source URL, so omitting the
            // official website here silently discarded every website-anchored
            // observation -- which then made approval fail closed with
            // `observed_evidence_required` even for a fully qualified lead.
            sources: [
              place.googleMapsUri ? { type: 'official_provider', url: place.googleMapsUri } : null,
              place.websiteUri ? { type: 'official_website', url: place.websiteUri } : null,
            ].filter(Boolean),
            // `providerFacts` is the structured, verbatim record of what the
            // provider actually returned. research.js turns it into typed
            // signals; nothing downstream re-parses prose. Absent fields stay
            // absent -- they are never defaulted into a claim.
            providerFacts: {
              provider: providerId,
              placeId: place.id,
              displayName: place.displayName.text,
              formattedAddress: place.formattedAddress,
              shortAddress: place.shortFormattedAddress || null,
              businessStatus: place.businessStatus || null,
              primaryType: place.primaryType || null,
              primaryTypeDisplayName: place.primaryTypeDisplayName?.text || null,
              types: Array.isArray(place.types) ? place.types.slice(0, 20) : [],
              rating: Number.isFinite(place.rating) ? place.rating : null,
              userRatingCount: Number.isInteger(place.userRatingCount) ? place.userRatingCount : null,
              websiteUri: place.websiteUri || null,
              nationalPhoneNumber: place.nationalPhoneNumber || null,
              googleMapsUri: place.googleMapsUri || null,
              latitude: Number.isFinite(place.location?.latitude) ? place.location.latitude : null,
              longitude: Number.isFinite(place.location?.longitude) ? place.location.longitude : null,
              /* ABSENT UNLESS ACTUALLY RETURNED. Requesting a field in the
                 mask is not the same as receiving it, and a defaulted zero
                 offset would silently place every business in UTC -- which
                 is the exact bug BusinessActivityState exists to remove. So
                 each stays null unless the payload really carried it, and
                 the consumer treats null as "unknown", never as "UTC". */
              utcOffsetMinutes: Number.isFinite(place.utcOffsetMinutes) ? place.utcOffsetMinutes : null,
              regularOpeningHours: place.regularOpeningHours && typeof place.regularOpeningHours === 'object'
                ? place.regularOpeningHours : null,
              openNow: typeof place.currentOpeningHours?.openNow === 'boolean'
                ? place.currentOpeningHours.openNow : null,
              fetchedAt,
            },
            providerMetadata: { provider: providerId, externalProviderId: place.id, fetchedAt },
          }));
          usage.successes += 1;
          usage.lastFailureReason = null;
          return { candidates, metadata: { provider: providerId, requestCount: attempt, resultCount: candidates.length, fixtureOnly: false } };
        } catch (error) {
          const normalized = error instanceof DiscoveryProviderError
            ? error
            : providerError(error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error', providerId);
          lastError = normalized;
          usage.failures += 1;
          usage.lastFailureReason = normalized.code;
          if (!normalized.retryable || attempt === attemptsLimit) throw normalized;
          await sleepImpl(retryDelayMs * attempt);
        } finally {
          clearTimeout(timer);
        }
      }
      throw lastError || providerError('provider_failed', providerId);
    },
  });
}

export function createFixtureProvider(candidates, { id = 'fixture_local_businesses', fail = false } = {}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  let requests = 0;
  return requireProviderShape({
    id,
    configured: true,
    fixtureOnly: true,
    getUsage: () => ({ requests, successes: fail ? 0 : requests, failures: fail ? requests : 0, lastFailureReason: fail ? 'provider_failed' : null }),
    async discover() {
      requests += 1;
      if (fail) throw providerError('provider_failed', id);
      const mapped = safeCandidates.map((candidate) => ({ ...candidate, provider: candidate.provider || id }));
      return { candidates: mapped, metadata: { provider: id, requestCount: 1, resultCount: mapped.length, fixtureOnly: true } };
    },
  });
}
