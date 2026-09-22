import { assertRankingShape } from './ranking.js';

const REJECTION_REASONS = new Set(['incorrect_information', 'business_closed', 'poor_match', 'already_contacted', 'other']);
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function hasFreshEvidence(opportunity, at) {
  const decidedAt = Date.parse(at);
  const checkedTimes = [opportunity?.lastCheckedAt, ...(opportunity?.observations || []).map((item) => item.checkedAt)]
    .map((value) => Date.parse(value)).filter(Number.isFinite);
  if (!Number.isFinite(decidedAt) || checkedTimes.length === 0) return false;
  const latest = Math.max(...checkedTimes);
  return decidedAt >= latest && decidedAt - latest <= STALE_AFTER_MS;
}

export function applyOpportunityDecision(opportunity, { action, reason = null, correction = null, at = new Date().toISOString() }) {
  if (!['approve', 'reject', 'replace', 'flag'].includes(action)) throw new Error('unsupported_opportunity_decision');
  if (['reject', 'flag'].includes(action) && !REJECTION_REASONS.has(reason)) throw new Error('rejection_reason_required');
  if (action === 'approve' && !assertRankingShape(opportunity?.ranking)) throw new Error('invalid_opportunity_ranking');
  if (action === 'approve' && opportunity?.ranking?.qualified !== true) throw new Error('unqualified_opportunity_cannot_be_approved');
  if (action === 'approve' && !(opportunity?.observations || []).some((item) => item.evidenceStatus === 'OBSERVED')) throw new Error('observed_evidence_required');
  if (action === 'approve' && (!hasFreshEvidence(opportunity, at) || opportunity?.closed || opportunity?.duplicateOf || opportunity?.stale)) throw new Error('ineligible_opportunity_cannot_be_approved');
  const state = action === 'approve' ? 'approved' : action === 'replace' ? 'replaced' : 'rejected';
  return {
    ...opportunity, state, rejectionReason: state === 'rejected' ? reason : null,
    correction: correction ? String(correction).slice(0, 500) : null,
    history: [...(opportunity.history || []), { from: opportunity.state || 'researched', to: state, reason, correction: correction || null, at }],
  };
}

function boundedFreeText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

export function recordContactEvent(opportunity, event) {
  const allowed = new Set(['no_reply', 'interested', 'not_interested', 'too_expensive', 'bad_timing', 'already_has_provider', 'needs_more_information', 'wrong_contact', 'other']);
  const channels = new Set(['call', 'email', 'website_form', 'public_social', 'booking_page', 'in_person', 'other']);
  if (!['approved', 'contacted', 'no_response', 'interested', 'follow_up_needed'].includes(opportunity?.state)) throw new Error('approved_opportunity_required');
  if (!allowed.has(event.outcome)) throw new Error('unsupported_contact_outcome');
  if (!channels.has(event.channel)) throw new Error('unsupported_contact_channel');
  if (typeof event.exactSource !== 'string' || event.exactSource.trim().length === 0 || event.exactSource.length > 2000) throw new Error('exact_contact_source_required');
  if (event.confidence !== undefined && (!Number.isFinite(event.confidence) || event.confidence < 0 || event.confidence > 1)) throw new Error('contact_confidence_must_be_0_to_1');
  const stateMap = { no_reply: 'no_response', interested: 'interested', not_interested: 'not_interested' };
  const at = typeof event.at === 'string' && Number.isFinite(Date.parse(event.at)) ? event.at : new Date().toISOString();
  return {
    ...opportunity, state: stateMap[event.outcome] || 'contacted',
    contactHistory: [...(opportunity.contactHistory || []), {
      channel: event.channel, outcome: event.outcome, exactSource: event.exactSource,
      originalWording: boundedFreeText(event.originalWording, 2000), confidence: event.confidence ?? 1,
      responseUsed: boundedFreeText(event.responseUsed, 2000), nextFollowUp: boundedFreeText(event.nextFollowUp, 200), at,
    }],
  };
}

export function nextBatchGuidance(opportunities) {
  const events = opportunities.flatMap((item) => item.contactHistory || []);
  const expensive = events.filter((item) => item.outcome === 'too_expensive').length;
  return expensive > 0
    ? 'Some prospects said the offer felt too expensive. Explain the smallest deliverable and its value before naming the price in the next batch.'
    : 'Keep the approved approach and personalise it using each opportunity’s observed evidence.';
}
