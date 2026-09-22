/* Candidate research: turns one raw provider candidate into a researched
 * candidate carrying STRUCTURED signals (signals.js) plus the legacy
 * `observations` array the persistence layer and UI already read.
 *
 * The observations are now DERIVED FROM the signals -- `observation.observation`
 * is a signal's generated `detail`, not an input anyone writes by hand. That
 * inverts the old dependency: previously the prose was the evidence and the
 * scorer regex-matched it, which meant only prose written to contain the right
 * words could ever qualify. Now the structure is the evidence and the prose is
 * a rendering of it.
 */

import { validateObservation } from './contract.js';
import {
  buildSignal, tokens, typeTokens, tokenOverlap,
} from './signals.js';

export function observation(fields) {
  const value = { ...fields };
  const checked = validateObservation(value);
  if (!checked.valid) throw new Error(`invalid_observation:${checked.errors.join('|')}`);
  return value;
}

function listingUrl(candidate) {
  return candidate.officialWebsite || candidate.mapUrl || candidate.sources?.[0]?.url || null;
}

/** Every signal derivable from provider data alone -- no network access. */
export function providerSignals(candidate, request, checkedAt) {
  const facts = candidate.providerFacts || {};
  const signals = [];
  const listing = listingUrl(candidate);

  if (listing) {
    signals.push(buildSignal({
      signalId: 'listing.public_record',
      kind: 'listing',
      evidenceStatus: 'OBSERVED',
      confidence: 0.95,
      sourceUrl: listing,
      sourceType: candidate.officialWebsite ? 'official_website' : 'official_provider',
      researchMethod: 'public_source_review',
      checkedAt,
      value: {
        provider: candidate.provider || facts.provider || null,
        externalProviderId: candidate.externalProviderId || facts.placeId || null,
        name: candidate.name || null,
        address: candidate.address || null,
        hasOfficialWebsite: Boolean(candidate.officialWebsite),
      },
      detail: candidate.officialWebsite
        ? `${candidate.name} is a public listing with an official website.`
        : `${candidate.name} is a public business listing.`,
    }));
  }

  if (facts.businessStatus && listing) {
    const operational = facts.businessStatus === 'OPERATIONAL';
    signals.push(buildSignal({
      signalId: operational ? 'operating_status.operational' : 'operating_status.not_operational',
      kind: 'operating_status',
      evidenceStatus: 'OBSERVED',
      confidence: 0.9,
      sourceUrl: listing,
      sourceType: 'official_provider',
      researchMethod: 'provider_field_review',
      checkedAt,
      value: { businessStatus: facts.businessStatus, operational },
      detail: operational
        ? `${candidate.name} is listed as currently operating.`
        : `${candidate.name} is listed as ${String(facts.businessStatus).toLowerCase().replace(/_/g, ' ')}.`,
    }));
  }

  // Category fit: structured comparison of the provider's own type enums and
  // display name against the founder's target-customer text. INFERRED, because
  // a type match is a derivation about suitability, not a sighting.
  const categoryTokens = [...new Set([
    ...typeTokens(facts.types),
    ...tokens(facts.primaryTypeDisplayName || facts.primaryType || candidate.category || ''),
    ...tokens(candidate.name || ''),
  ])];
  const targetMatches = tokenOverlap(request?.targetCustomer, categoryTokens);
  if (targetMatches.length > 0 && listing) {
    signals.push(buildSignal({
      signalId: 'category_fit.target_customer_match',
      kind: 'category_fit',
      evidenceStatus: 'INFERRED',
      confidence: Math.min(1, 0.5 + (targetMatches.length * 0.2)),
      sourceUrl: listing,
      sourceType: 'official_provider',
      researchMethod: 'provider_category_comparison',
      checkedAt,
      value: {
        matchedTokens: targetMatches.slice(0, 8),
        providerTypes: (facts.types || []).slice(0, 8),
        primaryType: facts.primaryType || null,
      },
      detail: `Provider category matches the target customer on: ${targetMatches.slice(0, 4).join(', ')}.`,
    }));
  }

  // Location fit: structured comparison against the resolved scope.
  const scopeLabel = request?.location?.label || '';
  const scopeTokens = tokens(scopeLabel).filter((word) => word !== 'australia');
  const addressTokens = tokens(facts.formattedAddress || candidate.address || '');
  const locationMatches = tokenOverlap(scopeTokens, addressTokens);
  if (request?.location?.mode !== 'online' && locationMatches.length > 0 && listing) {
    signals.push(buildSignal({
      signalId: 'location_fit.address_in_scope',
      kind: 'location_fit',
      evidenceStatus: 'OBSERVED',
      confidence: Math.min(1, locationMatches.length / Math.max(1, scopeTokens.length)),
      sourceUrl: listing,
      sourceType: 'official_provider',
      researchMethod: 'provider_address_comparison',
      checkedAt,
      value: { matchedTokens: locationMatches, scopeTokenCount: scopeTokens.length, address: facts.formattedAddress || candidate.address || null },
      detail: `The listed address matches ${locationMatches.length} of ${scopeTokens.length} requested location terms.`,
    }));
  }

  // Reputation: rating and review volume, verbatim.
  if (Number.isFinite(facts.rating) && listing) {
    signals.push(buildSignal({
      signalId: 'reputation.public_rating',
      kind: 'reputation',
      evidenceStatus: 'OBSERVED',
      confidence: 0.85,
      sourceUrl: listing,
      sourceType: 'official_provider',
      researchMethod: 'provider_field_review',
      checkedAt,
      value: { rating: facts.rating, userRatingCount: facts.userRatingCount ?? null },
      detail: Number.isInteger(facts.userRatingCount)
        ? `Publicly rated ${facts.rating} from ${facts.userRatingCount} reviews.`
        : `Publicly rated ${facts.rating}.`,
    }));
  }

  // Contactability, one signal per real public channel.
  const channelSources = [
    candidate.publicPhone && { channel: 'call', value: candidate.publicPhone, url: listing },
    candidate.publicEmail && { channel: 'email', value: candidate.publicEmail, url: listing },
    candidate.contactFormUrl && { channel: 'website_form', value: candidate.contactFormUrl, url: candidate.contactFormUrl },
    candidate.publicSocialUrl && { channel: 'public_social', value: candidate.publicSocialUrl, url: candidate.publicSocialUrl },
  ].filter(Boolean);
  // A published contact channel is BOTH reachability and an established
  // conversion route -- it is a real, named way this business can be
  // approached today. Emitting both kinds is deliberate: contactability asks
  // "can we reach them", conversion_path asks "do we know how a customer
  // transacts with them", and a listed phone number answers both. Website
  // inspection later adds the stronger routes (booking, ordering, quote).
  const CHANNEL_ROUTE = { call: 'phone', email: 'email', website_form: 'contact_form', public_social: 'enquiry' };
  for (const entry of channelSources) {
    if (!entry.url) continue;
    const sourceType = entry.channel === 'website_form' ? 'official_website' : 'official_provider';
    signals.push(buildSignal({
      signalId: `contactability.${entry.channel}`,
      kind: 'contactability',
      evidenceStatus: 'OBSERVED',
      confidence: 0.9,
      sourceUrl: entry.url,
      sourceType,
      researchMethod: 'provider_field_review',
      checkedAt,
      value: { channel: entry.channel, present: true },
      detail: `A public ${entry.channel.replace(/_/g, ' ')} contact route is listed.`,
    }));
    signals.push(buildSignal({
      signalId: `conversion_path.${CHANNEL_ROUTE[entry.channel]}`,
      kind: 'conversion_path',
      evidenceStatus: 'OBSERVED',
      // Below the 0.9 of an inspected website route: a listed channel proves
      // the route exists, inspection proves how it is actually presented.
      confidence: 0.8,
      sourceUrl: entry.url,
      sourceType,
      researchMethod: 'provider_field_review',
      checkedAt,
      value: { inspected: false, route: CHANNEL_ROUTE[entry.channel], fromListedChannel: entry.channel },
      detail: `The published ${entry.channel.replace(/_/g, ' ')} route is an established way to open a conversation.`,
    }));
  }

  if (!candidate.officialWebsite && candidate.publicPhone && listing) {
    signals.push(buildSignal({
      signalId: 'conversion_path.no_website_listed',
      kind: 'conversion_path',
      evidenceStatus: 'OBSERVED',
      confidence: 0.8,
      sourceUrl: listing,
      sourceType: 'official_provider',
      researchMethod: 'provider_field_review',
      checkedAt,
      value: { inspected: false, noWebsiteListed: true },
      detail: 'No website is listed, so the published phone number is the only route on record.',
    }));
  }

  return signals;
}

/**
 * Researches ONE candidate.
 * @param {object} [options.websiteInspection] result from
 *   website-inspection.js for THIS candidate, when it was one of the top
 *   candidates selected for deep inspection. Omitted for the rest -- their
 *   conversion path simply stays unknown, which is honest.
 */
export function researchCandidate(candidate, request, {
  checkedAt = new Date().toISOString(), secondaryFailure = false, websiteInspection = null,
} = {}) {
  const signals = [
    ...providerSignals(candidate, request, checkedAt),
    ...(websiteInspection?.signals || []),
  ];

  // Legacy prose observations, generated FROM the signals. Only signals that
  // name a public source can become an observation (the contract requires a
  // public sourceUrl), so an UNKNOWN never becomes a sentence asserting
  // anything.
  const observations = signals
    .filter((signal) => signal.sourceUrl && signal.evidenceStatus !== 'UNKNOWN')
    .map((signal) => observation({
      sourceUrl: signal.sourceUrl,
      sourceType: signal.sourceType,
      observation: signal.detail,
      checkedAt: signal.checkedAt,
      confidence: signal.confidence,
      evidenceStatus: signal.evidenceStatus,
      researchMethod: signal.researchMethod,
    }));

  // Fixture and hand-authored candidates may still carry publicObservations.
  // They are additive context only -- they can no longer decide qualification,
  // because scoring reads `signals`.
  for (const item of candidate.publicObservations || []) {
    observations.push(observation({ ...item, checkedAt: item.checkedAt || checkedAt }));
  }

  const channels = [
    candidate.publicPhone && 'call',
    candidate.publicEmail && 'email',
    candidate.contactFormUrl && 'website_form',
    candidate.publicSocialUrl && 'public_social',
  ].filter(Boolean);

  const conversionRoutes = signals
    .filter((signal) => signal.kind === 'conversion_path' && signal.evidenceStatus === 'OBSERVED' && signal.value.route)
    .map((signal) => signal.value.route);

  return {
    ...candidate,
    researchStatus: secondaryFailure ? 'partial' : 'completed',
    signals,
    observations,
    contactChannels: channels,
    conversionRoutes,
    websiteInspectionStatus: websiteInspection?.status || 'not_attempted',
    opportunityAngle: signals.find((signal) => signal.kind === 'conversion_path' && signal.evidenceStatus === 'OBSERVED')?.detail || null,
    matchReasons: [
      `Matches ${request.targetCustomer}`,
      request?.location?.mode === 'online' ? 'Online or anywhere' : `Located in ${request.location.label}`,
    ],
  };
}
