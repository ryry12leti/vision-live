/**
 * Founder Intake — "Why This Is Personalised" explanations.
 *
 * Deterministic, traceable correlations between the founder's own
 * confirmed facts and the generated output -- never an LLM-written
 * summary, never a generic "this is personalised" claim (task rule: "show
 * the actual causal inputs"). Every string here is built directly from a
 * live fact's own value, so it can always be traced back to something the
 * founder actually said.
 */

const BUSINESS_MODEL_LABEL = Object.freeze({
  software_app: 'a software/app business',
  agency_service_freelance: 'an agency/service business',
  ecommerce_product: 'an ecommerce/product business',
  creator_led_business: 'a creator-led business',
  local_physical_business: 'a local/physical business',
  coaching_consulting: 'a coaching/consulting business',
  other_founder_venture: 'a founder venture',
});

// Plain-English translation for a prerequisite mission's internal
// missingPrerequisite key -- this text is user-visible (the default "Why
// this is personalised" list, never Technical Details), so a raw camelCase
// fact/entity key must never leak into it (same rule
// founder-intake-shared.mjs's FACT_KEY_LABELS enforces for the API layer).
const MISSING_PREREQUISITE_LABEL = Object.freeze({
  customerEntities: 'a confirmed customer or prospect',
  cohortData: 'customer cohort data',
  offerPricing: 'a stated offer price',
  supplierRecord: 'a supplier record',
});

/**
 * @param {Record<string, object>} perKey
 * @param {{customerEntities: object[]}} entityCollections
 * @param {{decision: string, mission: object|null}|null} missionPolicy resolveFounderMissionPolicy(...)'s result.
 * @returns {string[]}
 */
export function buildPersonalizationExplanations(perKey, entityCollections, missionPolicy) {
  const notes = [];

  if (perKey.idea) {
    notes.push(`"${perKey.idea.value}" is what you told VISION you're building -- it shaped how the venture was classified.`);
  }
  if (perKey.businessModelFamily) {
    const label = BUSINESS_MODEL_LABEL[perKey.businessModelFamily.value] || perKey.businessModelFamily.value;
    notes.push(`VISION classified this as ${label} based on your own description, not a guess.`);
  }
  if (perKey.targetCustomer) {
    notes.push(`"${perKey.targetCustomer.value}" set the target customer and market VISION evaluated against.`);
  }
  if (perKey.completedWork) {
    notes.push(`Work you said is already done ("${perKey.completedWork.value.join('; ')}") reduced what still needs building.`);
  }
  if (perKey.unfinishedWork) {
    notes.push(`Work you said is still unfinished ("${perKey.unfinishedWork.value.join('; ')}") was treated as real, open work.`);
  }
  if (perKey.offerPricing) {
    const { price, currency } = perKey.offerPricing.value || {};
    if (typeof price === 'number') {
      notes.push(`Your stated offer price (${currency || ''} ${price}) enabled the sales-outreach and offer-related route evaluations.`);
    }
  }
  const evidence = perKey.customerEvidence?.value;
  if (evidence && evidence.hasPayingCustomers === false) {
    notes.push('You said you have no paying customers yet -- that is exactly why customer/problem validation was flagged as the bottleneck.');
  } else if (evidence && evidence.hasPayingCustomers === true) {
    notes.push('You confirmed you already have paying customers -- that ruled out customer/problem validation as the bottleneck.');
  }
  const prospects = (entityCollections.customerEntities || []).filter((p) => p.verificationStatus !== 'provisional');
  if (prospects.length > 0) {
    notes.push(`${prospects.length} reachable prospect(s) you confirmed enabled the customer-interview and outreach routes to be evaluated at all.`);
  }
  if (perKey.currentBottleneck) {
    notes.push(`You directly named your current problem as "${perKey.currentBottleneck.value}".`);
  }

  const decision = missionPolicy?.decision;
  const mission = missionPolicy?.mission;
  if (decision === 'direct' && mission) {
    notes.push(`"${mission.title}" was selected because it directly addresses the bottleneck above using only the context you confirmed -- nothing invented.`);
  } else if (decision === 'prerequisite' && mission) {
    const missingLabel = MISSING_PREREQUISITE_LABEL[mission.missingPrerequisite] || mission.missingPrerequisite;
    notes.push(`"${mission.title}" was generated because the right route is known, but ${missingLabel} is still missing -- this mission creates it safely, without inventing any business, price, or evidence.`);
  } else if (decision === 'clarification') {
    notes.push('VISION could not safely choose or prepare a mission yet with what you confirmed -- that is why it is asking for more before picking one for you.');
  } else if (decision === 'no_mission') {
    notes.push('VISION found a genuine conflict or gap in what you confirmed, so it is asking you to resolve that before setting a mission.');
  }

  return notes;
}
