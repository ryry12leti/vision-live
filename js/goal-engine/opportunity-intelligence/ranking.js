/* Opportunity scoring.
 *
 * WHAT CHANGED. Every dimension is now computed from the STRUCTURED signals
 * research.js produced (signals.js), not from regex-matching the prose of an
 * observation. The dimension names, the component weights, the 30-point
 * LEAD_QUALIFICATION_THRESHOLD and the 30-point per-component minimum are
 * unchanged, so a score means exactly what it meant before -- it is only the
 * evidence it reads that is now real.
 *
 * The old `OPPORTUNITY_TERMS` regex is deleted. It required an observation
 * whose SENTENCE contained one of a dozen words. Only the fixture provider
 * ever wrote such sentences, so `qualified` was structurally always 0 for
 * every real Google Places result. There is deliberately no text matching of
 * any kind left in this file.
 */

import { RANKING_DIMENSIONS } from './contract.js';
import { signalsOfKind, signalWeight, strongestWeight } from './signals.js';

export const LEAD_QUALIFICATION_THRESHOLD = 30;
export const QUALIFICATION_COMPONENT_MINIMUM = 30;

const COMPONENT_WEIGHTS = Object.freeze({
  targetCustomerFit: .20,
  locationFit: .08,
  opportunityRelevance: .20,
  evidenceStrength: .18,
  contactability: .12,
  founderOfferFit: .12,
  founderCapabilityFit: .04,
  freshness: .04,
  priorContactRisk: .02,
});

/* A conversion route we KNOW about is what makes a lead actionable. Both
   directions are genuinely useful and both are facts:
     - a route exists  -> there is a concrete way in, and we can name it
     - no route exists -> the gap itself is the opening
   An unknown route scores nothing. These weights are significance, not
   preference. */
const CONVERSION_ROUTE_VALUE = Object.freeze({
  booking: 100, ordering: 100, quote: 100, enquiry: 95,
  contact_form: 85, email: 80, phone: 75,
});
const OBSERVED_ABSENCE_VALUE = 90;

function bounded(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function claimFrom(signal, contribution, rationale) {
  return {
    sourceReference: signal?.sourceUrl || null,
    evidenceStatus: signal?.evidenceStatus || 'UNKNOWN',
    contribution: bounded(contribution),
    rationale,
  };
}

function unknown(rationale) {
  return [{ sourceReference: null, evidenceStatus: 'UNKNOWN', contribution: 0, rationale }];
}

/** Conversion-path signals that carry real information -- an OBSERVED route,
 * or an OBSERVED established absence. UNKNOWN (site unreachable, never
 * inspected) is excluded here and therefore contributes nothing anywhere. */
export function informativeConversionSignals(candidate) {
  return signalsOfKind(candidate?.signals, 'conversion_path')
    .filter((signal) => signal.evidenceStatus !== 'UNKNOWN' && signalWeight(signal) > 0);
}

function targetCustomerFit(candidate) {
  const matches = signalsOfKind(candidate?.signals, 'category_fit');
  if (matches.length === 0) return { score: 0, provenance: unknown('No provider category, type or business-name token supports the requested target customer.') };
  const best = matches.reduce((left, right) => (signalWeight(right) > signalWeight(left) ? right : left));
  // A category match is INFERRED, so signalWeight caps it at .35. Scale it
  // back onto 0-100 against that ceiling so a clean, multi-token category
  // match reaches full marks rather than being permanently capped at 35.
  const score = bounded((signalWeight(best) / 0.35) * 100);
  return {
    score,
    provenance: matches.map((signal) => claimFrom(signal, (signalWeight(signal) / 0.35) * 100,
      `Provider category matches target tokens: ${(signal.value.matchedTokens || []).slice(0, 3).join(', ')}.`)),
  };
}

function locationFit(candidate, request) {
  if (request?.location?.mode === 'online') {
    // An online scope is satisfied by a reachable online presence, not by an
    // address. Never force a local search to succeed.
    const listing = signalsOfKind(candidate?.signals, 'listing')
      .find((signal) => signal.value.hasOfficialWebsite === true);
    return listing
      ? { score: 100, provenance: [claimFrom(listing, 100, 'An official public website supports online reach.')] }
      : { score: 0, provenance: unknown('No public online-location evidence is available.') };
  }
  if (request?.location?.mode === 'nationwide') {
    // Any in-country listing satisfies a nationwide scope.
    const listing = signalsOfKind(candidate?.signals, 'listing')[0];
    return listing
      ? { score: 100, provenance: [claimFrom(listing, 100, 'A public listing inside the requested nationwide scope.')] }
      : { score: 0, provenance: unknown('Location evidence is missing.') };
  }
  const matches = signalsOfKind(candidate?.signals, 'location_fit');
  if (matches.length === 0) return { score: 0, provenance: unknown('The provider address does not match the requested location scope.') };
  const best = matches.reduce((left, right) => (signalWeight(right) > signalWeight(left) ? right : left));
  const score = bounded(signalWeight(best) * 100);
  return { score, provenance: matches.map((signal) => claimFrom(signal, signalWeight(signal) * 100, signal.detail)) };
}

function opportunityRelevance(candidate) {
  const informative = informativeConversionSignals(candidate);
  if (informative.length === 0) {
    return { score: 0, provenance: unknown('No conversion or contact route is established for this business, so no actionable opening can be claimed.') };
  }
  const scored = informative.map((signal) => {
    const base = signal.value.route
      ? (CONVERSION_ROUTE_VALUE[signal.value.route] ?? 70)
      : OBSERVED_ABSENCE_VALUE;
    return { signal, value: signalWeight(signal) * base };
  });
  const score = bounded(Math.max(...scored.map((entry) => entry.value)));
  return { score, provenance: scored.map(({ signal, value }) => claimFrom(signal, value, signal.detail)) };
}

function evidenceStrength(candidate) {
  const all = (candidate?.signals || []).filter((signal) => signalWeight(signal) > 0);
  if (all.length === 0) return { score: 0, provenance: unknown('No OBSERVED or INFERRED structured signal contributes to evidence strength.') };
  // Each real signal contributes up to 25; four solid OBSERVED signals reach
  // 100. Deliberately additive so a candidate corroborated from several
  // independent fields outranks one with a single strong field.
  const contributions = all.map((signal) => ({ signal, value: signalWeight(signal) * 25 }));
  const score = bounded(contributions.reduce((total, entry) => total + entry.value, 0));
  return { score, provenance: contributions.map(({ signal, value }) => claimFrom(signal, value, signal.detail)) };
}

function contactability(candidate) {
  const channels = signalsOfKind(candidate?.signals, 'contactability');
  if (channels.length === 0) return { score: 0, provenance: unknown('No public contact channel was observed.') };
  const score = bounded(strongestWeight(channels) * 100);
  return { score, provenance: channels.map((signal) => claimFrom(signal, signalWeight(signal) * 100, signal.detail)) };
}

function founderOfferFit(candidate, request) {
  // The offer connects to the prospect through the route by which the founder
  // could actually approach them. Both halves must be real: a category match
  // (this is the kind of business the offer is for) AND a known route.
  const category = signalsOfKind(candidate?.signals, 'category_fit');
  const routes = informativeConversionSignals(candidate);
  if (category.length === 0 || routes.length === 0) {
    return { score: 0, provenance: unknown('No structured evidence connects an established contact route to the Founder offer.') };
  }
  const categoryWeight = strongestWeight(category) / 0.35;
  const routeWeight = strongestWeight(routes);
  const score = bounded(categoryWeight * routeWeight * 100);
  return {
    score,
    provenance: [
      claimFrom(category[0], categoryWeight * 100, `This business type matches who the offer is for: ${(category[0].value.matchedTokens || []).slice(0, 3).join(', ')}.`),
      /* AN OBSERVED ABSENCE IS NOT A ROUTE. informativeConversionSignals
         deliberately keeps signals that establish NO route exists — that is
         worth OBSERVED_ABSENCE_VALUE, because a business with demand and
         nowhere to send it is exactly who an agency offer is for. But the
         sentence was appended unconditionally, so the provenance a founder
         reads said, in one breath, "no contact route is published anywhere"
         and "the offer can be presented through this route".

         Only reachable on a prospect with no route at all — which, until the
         research_contact_route dead end was fixed, was a prospect nobody
         could open. */
      claimFrom(routes[0], routeWeight * 100, routes[0].value?.route
        ? `${routes[0].detail} The offer can be presented through this route.`
        : `${routes[0].detail} There is no route to present the offer through — which is the opening, not an obstacle.`),
    ],
  };
}

function freshness(candidate, now) {
  const nowMs = Date.parse(now);
  const dated = (candidate?.signals || [])
    .filter((signal) => signal.evidenceStatus !== 'UNKNOWN')
    .map((signal) => ({ signal, time: Date.parse(signal.checkedAt) }))
    .filter(({ time }) => Number.isFinite(time));
  if (!Number.isFinite(nowMs) || !dated.length) return { score: 0, provenance: unknown('No valid dated evidence supports freshness.') };
  const latest = dated.sort((a, b) => b.time - a.time)[0];
  const age = nowMs - latest.time;
  const score = age < 0 ? 0 : age <= 7 * 24 * 60 * 60 * 1000 ? 100 : age <= 30 * 24 * 60 * 60 * 1000 ? 60 : 0;
  return score > 0
    ? { score, provenance: [claimFrom(latest.signal, score, age <= 7 * 24 * 60 * 60 * 1000 ? 'Latest evidence was checked within seven days.' : 'Latest evidence was checked within thirty days.')] }
    : { score: 0, provenance: unknown('Evidence is missing, future-dated, or older than thirty days.') };
}

function priorContactRisk(candidate) {
  if (candidate?.priorContactChecked !== true) return { score: 0, provenance: unknown('No explicit prior-contact check was recorded; absence is not positive credit.') };
  const clear = candidate.alreadyContacted === false && candidate.previouslyRejected === false;
  return clear
    ? { score: 100, provenance: [{ sourceReference: 'founder_venture_state:prior_contact_check', evidenceStatus: 'OBSERVED', contribution: 100, rationale: 'Founder history explicitly confirms no prior contact or rejection.' }] }
    : { score: 0, provenance: [{ sourceReference: 'founder_venture_state:prior_contact_check', evidenceStatus: 'OBSERVED', contribution: 0, rationale: 'Prior contact or rejection prevents positive credit.' }] };
}

export function calculateOpportunityScore(dimensions) {
  return bounded(Object.entries(COMPONENT_WEIGHTS).reduce((total, [dimension, weight]) => total + bounded(dimensions?.[dimension]) * weight, 0));
}

export function qualifiesOpportunityScore(opportunityScore, dimensions) {
  return Number.isFinite(opportunityScore)
    && opportunityScore >= LEAD_QUALIFICATION_THRESHOLD
    && opportunityScore <= 100
    && bounded(dimensions?.targetCustomerFit) >= QUALIFICATION_COMPONENT_MINIMUM
    && bounded(dimensions?.opportunityRelevance) >= QUALIFICATION_COMPONENT_MINIMUM
    && bounded(dimensions?.evidenceStrength) >= QUALIFICATION_COMPONENT_MINIMUM;
}

export function rankOpportunity(candidate, request, { now = new Date().toISOString() } = {}) {
  const calculated = {
    targetCustomerFit: targetCustomerFit(candidate),
    locationFit: locationFit(candidate, request),
    opportunityRelevance: opportunityRelevance(candidate),
    evidenceStrength: evidenceStrength(candidate),
    contactability: contactability(candidate),
    founderOfferFit: founderOfferFit(candidate, request),
    founderCapabilityFit: { score: 0, provenance: unknown('Founder capability is not evidenced by provider data and receives no V1 credit.') },
    freshness: freshness(candidate, now),
    priorContactRisk: priorContactRisk(candidate),
  };
  const dimensions = Object.fromEntries(Object.entries(calculated).map(([key, value]) => [key, bounded(value.score)]));
  dimensions.opportunityScore = calculateOpportunityScore(dimensions);

  // The hard floor: a lead is only real if at least one OBSERVED structured
  // signal establishes how this business can actually be approached. An
  // INFERRED category match alone can never qualify a lead.
  const observedOpportunityEvidenceCount = informativeConversionSignals(candidate)
    .filter((signal) => signal.evidenceStatus === 'OBSERVED').length;

  const qualified = qualifiesOpportunityScore(dimensions.opportunityScore, dimensions) && observedOpportunityEvidenceCount > 0;
  const disqualifiers = [
    dimensions.opportunityScore < LEAD_QUALIFICATION_THRESHOLD && 'opportunity_score_below_30',
    dimensions.targetCustomerFit < QUALIFICATION_COMPONENT_MINIMUM && 'target_customer_fit_below_30',
    dimensions.opportunityRelevance < QUALIFICATION_COMPONENT_MINIMUM && 'opportunity_relevance_below_30',
    dimensions.evidenceStrength < QUALIFICATION_COMPONENT_MINIMUM && 'evidence_strength_below_30',
    observedOpportunityEvidenceCount === 0 && 'observed_opportunity_evidence_required',
  ].filter(Boolean);
  const provenance = Object.fromEntries(Object.entries(calculated).map(([key, value]) => [key, value.provenance]));
  provenance.opportunityScore = Object.entries(COMPONENT_WEIGHTS).map(([dimension, weight]) => {
    const dimensionClaims = provenance[dimension] || [];
    const evidenceStatus = dimensionClaims.some((item) => item.evidenceStatus === 'OBSERVED' && item.contribution > 0)
      ? 'OBSERVED'
      : dimensionClaims.some((item) => item.evidenceStatus === 'INFERRED' && item.contribution > 0)
        ? 'INFERRED'
        : 'UNKNOWN';
    return {
      sourceReference: `dimension:${dimension}`,
      evidenceStatus,
      contribution: bounded(dimensions[dimension] * weight),
      rationale: `${dimension} contributes ${Math.round(weight * 100)}% of the canonical Opportunity Score.`,
    };
  });
  const explanation = qualified
    ? `Qualified Lead: Opportunity Score ${dimensions.opportunityScore}/100 meets the 30-point threshold with supported target fit, opportunity relevance and evidence strength.`
    : `Not qualified: Opportunity Score ${dimensions.opportunityScore}/100; blocking checks: ${disqualifiers.join(', ').replace(/_/g, ' ')}.`;
  return {
    ...candidate,
    ranking: {
      dimensions,
      provenance,
      explanation,
      qualified,
      qualification: { threshold: LEAD_QUALIFICATION_THRESHOLD, passedScoreThreshold: dimensions.opportunityScore >= LEAD_QUALIFICATION_THRESHOLD, observedOpportunityEvidenceCount, disqualifiers },
    },
  };
}

export function assertRankingShape(ranking) {
  if (!RANKING_DIMENSIONS.every((dimension) => Number.isFinite(ranking?.dimensions?.[dimension]) && ranking.dimensions[dimension] >= 0 && ranking.dimensions[dimension] <= 100)) return false;
  if (ranking.dimensions.opportunityScore !== calculateOpportunityScore(ranking.dimensions)) return false;
  if (!Number.isInteger(ranking?.qualification?.observedOpportunityEvidenceCount) || ranking.qualification.observedOpportunityEvidenceCount < 0) return false;
  if (ranking.qualified !== (qualifiesOpportunityScore(ranking.dimensions.opportunityScore, ranking.dimensions) && ranking.qualification.observedOpportunityEvidenceCount > 0)) return false;
  return RANKING_DIMENSIONS.every((dimension) => Array.isArray(ranking?.provenance?.[dimension]) && ranking.provenance[dimension].length > 0);
}
