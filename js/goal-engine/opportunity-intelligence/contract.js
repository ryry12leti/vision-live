export const OPPORTUNITY_INTELLIGENCE_CONTRACT_VERSION = 2;

export const OPPORTUNITY_TYPES = Object.freeze([
  'customer_prospect', 'beta_user', 'supplier', 'retail_partner', 'referral_partner',
  'creator', 'collaborator', 'investor', 'manufacturer', 'other',
]);

export const EVIDENCE_STATUSES = Object.freeze(['OBSERVED', 'INFERRED', 'UNKNOWN']);
export const SEARCH_STATUSES = Object.freeze([
  'awaiting_approval', 'discovering', 'filtering', 'researching', 'partial', 'completed', 'failed', 'declined',
]);
export const OPPORTUNITY_STATES = Object.freeze([
  'discovered', 'researched', 'approved', 'rejected', 'replaced', 'contacted', 'no_response',
  'interested', 'not_interested', 'follow_up_needed', 'meeting_booked', 'lost', 'converted',
]);

export const RANKING_DIMENSIONS = Object.freeze([
  'targetCustomerFit', 'locationFit', 'opportunityRelevance', 'evidenceStrength', 'contactability',
  'founderOfferFit', 'founderCapabilityFit', 'freshness', 'priorContactRisk', 'opportunityScore',
]);

const SEARCH_MODES = new Set(['locality', 'radius', 'regional', 'multiple', 'nationwide', 'online']);

function string(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateSearchRequest(request) {
  const errors = [];
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { valid: false, errors: ['request must be an object'] };
  if (!string(request.searchId)) errors.push('searchId is required');
  if (!string(request.purpose)) errors.push('purpose is required');
  if (!string(request.offer)) errors.push('offer is required');
  if (!string(request.targetCustomer)) errors.push('targetCustomer is required');
  if (!request.location || !SEARCH_MODES.has(request.location.mode)) errors.push('a supported interpreted location is required');
  if (request.location?.requiresClarification === true) errors.push('ambiguous location must be clarified before search');
  if (request.userApproved !== true) errors.push('explicit user approval is required before discovery');
  if (request.maxProviderRequests !== undefined && (!Number.isInteger(request.maxProviderRequests) || request.maxProviderRequests < 1 || request.maxProviderRequests > 10)) errors.push('maxProviderRequests must be 1-10');
  if (request.maxDeepResearch !== undefined && (!Number.isInteger(request.maxDeepResearch) || request.maxDeepResearch < 1 || request.maxDeepResearch > 30)) errors.push('maxDeepResearch must be 1-30');
  return { valid: errors.length === 0, errors };
}

export function validateObservation(observation) {
  const errors = [];
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) return { valid: false, errors: ['observation must be an object'] };
  if (!string(observation.sourceUrl) || !/^https?:\/\//i.test(observation.sourceUrl)) errors.push('sourceUrl must be public http(s)');
  if (!string(observation.sourceType)) errors.push('sourceType is required');
  if (!string(observation.observation)) errors.push('exact observation is required');
  if (!string(observation.checkedAt) || !Number.isFinite(Date.parse(observation.checkedAt))) errors.push('checkedAt must be an ISO date');
  if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) errors.push('confidence must be 0-1');
  if (!EVIDENCE_STATUSES.includes(observation.evidenceStatus)) errors.push('evidenceStatus is invalid');
  if (!string(observation.researchMethod)) errors.push('researchMethod is required');
  return { valid: errors.length === 0, errors };
}

export function levelLimit(level) {
  if (level === 'experienced') return 20;
  if (level === 'developing') return 15;
  return 10;
}
