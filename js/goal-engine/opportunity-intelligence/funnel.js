import { levelLimit, validateSearchRequest } from './contract.js';
import { deduplicateCandidates } from './deduplication.js';
import { researchCandidate } from './research.js';
import { rankOpportunity } from './ranking.js';
import { classifyProviderError } from './providers.js';

function normalizeProviderResult(value, providerId) {
  const normalized = Array.isArray(value) ? { candidates: value, metadata: { provider: providerId, requestCount: 1, resultCount: value.length } } : value;
  if (!normalized || !Array.isArray(normalized.candidates) || !normalized.metadata || typeof normalized.metadata !== 'object') throw new Error('provider_malformed_response');
  const malformed = normalized.candidates.some((candidate) => !candidate || typeof candidate !== 'object'
    || typeof candidate.provider !== 'string'
    || typeof candidate.externalProviderId !== 'string'
    || typeof candidate.name !== 'string' || candidate.name.trim().length === 0 || candidate.name.length > 300
    || typeof candidate.address !== 'string' || candidate.address.trim().length === 0 || candidate.address.length > 500
    || ['category', 'publicPhone', 'publicEmail'].some((field) => candidate[field] != null && (typeof candidate[field] !== 'string' || candidate[field].length > 500))
    || ['officialWebsite', 'mapUrl', 'contactFormUrl', 'publicSocialUrl'].some((field) => candidate[field] && !/^https?:\/\//i.test(candidate[field]))
    || (candidate.sources !== undefined && (!Array.isArray(candidate.sources) || candidate.sources.some((source) => !source || typeof source.type !== 'string' || !/^https?:\/\//i.test(source.url)))));
  if (malformed) throw new Error('provider_malformed_response');
  return normalized;
}

function stableCandidateKey(candidate) {
  return [candidate?.externalProviderId, candidate?.officialWebsite, candidate?.name, candidate?.address]
    .map((value) => String(value || '').toLowerCase()).join('|');
}

function normalizedWords(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map((word) => word.endsWith('s') && word.length > 3 ? word.slice(0, -1) : word);
}

function cheapCandidateScore(candidate, request) {
  const target = new Set(normalizedWords(request?.targetCustomer));
  const typeWords = normalizedWords((candidate?.providerFacts?.types || []).join(' ').replace(/_/g, ' '));
  const categoryMatch = [...normalizedWords(`${candidate?.category || ''} ${candidate?.name || ''}`), ...typeWords]
    .some((word) => target.has(word));
  // An online or nationwide scope has no locality to match against, so it must
  // not penalise every candidate for failing a local address comparison.
  const scopedLocally = !['online', 'nationwide'].includes(request?.location?.mode);
  const requestedLocation = scopedLocally
    ? normalizedWords(request?.location?.label).filter((word) => !['australia', 'online', 'anywhere'].includes(word))
    : [];
  const address = new Set(normalizedWords(candidate?.address));
  const locationMatch = scopedLocally
    ? requestedLocation.length > 0 && requestedLocation.some((word) => address.has(word))
    : true;
  const publicContact = Boolean(candidate?.publicPhone || candidate?.publicEmail || candidate?.contactFormUrl || candidate?.publicSocialUrl);
  return (categoryMatch ? 4 : 0) + (locationMatch ? 2 : 0) + (publicContact ? 1 : 0);
}

/**
 * @param {function} [options.inspectWebsite] async (url) => website-inspection
 *   result. Injected rather than imported so the funnel stays pure and
 *   testable, and so a deployment that cannot make outbound requests simply
 *   omits it -- candidates then carry no conversion-path evidence, which is
 *   honest, rather than fabricated evidence.
 * @param {number} [options.maxWebsiteInspections] deep inspection is the only
 *   expensive step, so it runs for the highest cheap-scored candidates only.
 */
export async function runOpportunityFunnel({
  request, providers, existing = [], now = new Date().toISOString(), partialResearchIds = [],
  inspectWebsite = null, maxWebsiteInspections = 5,
}) {
  const validation = validateSearchRequest(request);
  if (!validation.valid) return { status: request?.userApproved === false ? 'declined' : 'failed', errors: validation.errors, opportunities: [], manualFallback: true };
  const providerList = (providers || []).filter((provider) => provider?.configured);
  if (providerList.length === 0) return { status: 'failed', reason: 'provider_not_configured', opportunities: [], manualFallback: true };
  const selectedProviders = providerList.slice(0, request.maxProviderRequests || 3);
  const settled = await Promise.allSettled(selectedProviders.map(async (provider) => normalizeProviderResult(await provider.discover(request), provider.id)));
  const successful = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const providerFailures = settled.map((result, index) => ({ result, provider: selectedProviders[index]?.id || 'unknown' }))
    .filter(({ result }) => result.status === 'rejected')
    .map(({ result, provider }) => ({ provider, reason: classifyProviderError(result.reason) }));
  const discovered = successful.flatMap((result) => result.candidates);
  if (discovered.length === 0) {
    const reason = successful.length > 0 ? 'provider_empty' : providerFailures[0]?.reason || 'provider_failed';
    return { status: 'failed', reason, counts: { discovered: 0, afterFiltering: 0, cheaplyScored: 0, deeplyResearched: 0, qualified: 0 }, opportunities: [], providerFailures, providerMetadata: successful.map((item) => item.metadata), manualFallback: true };
  }
  const excludedIds = new Set(existing.filter((item) => ['rejected', 'converted', 'lost'].includes(item.state) || item.exhausted).flatMap((item) => [item.externalProviderId, item.officialWebsite]).filter(Boolean));
  const filtered = deduplicateCandidates(discovered).filter((candidate) => !candidate.closed && !candidate.alreadyContacted && !candidate.previouslyRejected && !excludedIds.has(candidate.externalProviderId) && !excludedIds.has(candidate.officialWebsite));
  const cheapPool = filtered.map((candidate) => ({ ...candidate, cheapScore: cheapCandidateScore(candidate, request) }))
    .sort((a, b) => b.cheapScore - a.cheapScore || stableCandidateKey(a).localeCompare(stableCandidateKey(b))).slice(0, 30);
  const deepLimit = Math.min(request.maxDeepResearch || 12, 30);
  const deepPool = cheapPool.slice(0, deepLimit);

  // Deep website inspection: top candidates only, in parallel, and never
  // fatal. A rejected inspection yields no signals rather than a guess.
  const inspectionByCandidate = new Map();
  let websitesInspected = 0;
  if (typeof inspectWebsite === 'function' && maxWebsiteInspections > 0) {
    const targets = deepPool.filter((candidate) => candidate.officialWebsite).slice(0, maxWebsiteInspections);
    const results = await Promise.allSettled(targets.map((candidate) => inspectWebsite(candidate.officialWebsite, { checkedAt: now })));
    results.forEach((result, index) => {
      const key = stableCandidateKey(targets[index]);
      if (result.status === 'fulfilled' && result.value) {
        inspectionByCandidate.set(key, result.value);
        if (result.value.status === 'inspected') websitesInspected += 1;
      }
    });
  }

  const researchFailures = [];
  const researched = deepPool.map((candidate) => {
    try {
      return researchCandidate(candidate, request, {
        checkedAt: now,
        secondaryFailure: partialResearchIds.includes(candidate.externalProviderId),
        websiteInspection: inspectionByCandidate.get(stableCandidateKey(candidate)) || null,
      });
    } catch { researchFailures.push(candidate.externalProviderId); return null; }
  }).filter(Boolean);
  const ranked = researched.map((candidate) => rankOpportunity(candidate, request, { now })).filter((candidate) => candidate.ranking.qualified)
    .sort((a, b) => b.ranking.dimensions.opportunityScore - a.ranking.dimensions.opportunityScore || stableCandidateKey(a).localeCompare(stableCandidateKey(b)))
    .slice(0, levelLimit(request.founderLevel));
  return {
    status: settled.some((result) => result.status === 'rejected') || researchFailures.length > 0 || ranked.some((item) => item.researchStatus === 'partial') ? 'partial' : 'completed',
    counts: {
      discovered: discovered.length, afterFiltering: filtered.length, cheaplyScored: cheapPool.length,
      deeplyResearched: researched.length, websitesInspected, qualified: ranked.length,
    },
    opportunities: ranked,
    // Every researched candidate, qualified or not. persistSearchRun() needs
    // this to record what the search actually saw: previously only the
    // qualified subset was passed on, so a run that discovered 20 businesses
    // and qualified none was stored as `discovered_count: 0`.
    researchedCandidates: researched,
    providerFailures,
    providerMetadata: successful.map((item) => item.metadata),
    researchFailures: researchFailures.length,
    manualFallback: ranked.length === 0,
  };
}

/** Combines a new funnel run's freshly id-assigned opportunities with the
 * previously persisted list. A rerun must never silently discard an already
 * approved/rejected/contacted record: any id also present in this run's
 * discovery keeps its EXISTING state and history (a rediscovered business is
 * not reset back to "researched"), and any previously persisted opportunity
 * not rediscovered this run is carried forward unchanged. */
export function mergeSearchOpportunities(previousOpportunities, freshOpportunities) {
  const previousById = new Map((previousOpportunities || []).map((item) => [item.id, item]));
  const seenIds = new Set();
  const merged = (freshOpportunities || []).map((item) => {
    seenIds.add(item.id);
    return previousById.has(item.id) ? previousById.get(item.id) : item;
  });
  for (const item of previousOpportunities || []) {
    if (!seenIds.has(item.id)) merged.push(item);
  }
  return merged;
}
