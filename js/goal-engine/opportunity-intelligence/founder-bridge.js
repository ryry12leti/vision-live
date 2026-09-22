import { buildCustomerEntityFact } from '../founder-venture-state/collectors/entities.js';
import { buildFact } from '../founder-venture-state/fact-ledger.js';
import { runFounderIntakePipeline } from '../founder-intake/pipeline.js';
import { evaluateOpportunityEligibility } from './eligibility.js';
import { missionPhrase } from '../decision-core/mission-context.js';

function slug(value) {
  const cleaned = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56);
  return /^[a-z]/.test(cleaned) ? cleaned : `opportunity_${cleaned || 'entity'}`;
}

export function founderNeedsOpportunities(pipelineResult) {
  const mission = pipelineResult?.missionPolicy?.mission;
  return pipelineResult?.missionPolicy?.decision === 'prerequisite' && mission?.missingPrerequisite === 'customerEntities';
}

function observedEvidenceConfidence(item) {
  const values = (item.observations || []).filter((observation) => observation.evidenceStatus === 'OBSERVED')
    .map((observation) => observation.confidence).filter((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  return values.length ? Math.max(...values) : 0;
}

export function approvedOpportunityFacts({ opportunities, ventureId, userId, occurredAt }) {
  return opportunities.filter((item) => evaluateOpportunityEligibility(item, { ventureId, userId, now: occurredAt }).founderEligible).map((item) => {
    const channelIds = item.contactChannels || [];
    return buildCustomerEntityFact({
      ventureId, userId, customerEntityId: slug(`lead_${item.id || item.name}`), relationshipType: 'prospect',
      segmentId: slug(item.category || 'local_service_customer'), safeDisplayLabel: item.name,
      contactability: channelIds.length > 0 ? 'reachable' : 'not_reachable', availableChannelIds: channelIds,
      customerStatus: 'active', sourceType: 'user_manual_update', sourceReference: `opportunity_intelligence:${item.id}`,
      occurredAt, recordedAt: occurredAt, verificationStatus: 'user_confirmed', confidence: observedEvidenceConfidence(item),
    });
  });
}

/* The recorded public contact route per lead, in the founder's terms. Only
   channels the funnel actually OBSERVED are listed; a lead with none is
   simply omitted rather than described as unreachable. */
const CONTACT_ROUTE_LABEL = Object.freeze({
  call: 'phone', email: 'email', website_form: 'website form', public_social: 'public social',
});

function recordedContactRoutes(approved) {
  const parts = approved
    .map((item) => {
      const routes = (item.contactChannels || []).map((channel) => CONTACT_ROUTE_LABEL[channel]).filter(Boolean);
      return routes.length ? `${item.name} (${routes.join(', ')})` : null;
    })
    .filter(Boolean);
  return parts.length ? parts.join('; ') : null;
}

/**
 * Rewrites an outreach/interview mission to name the actual approved
 * businesses, and — when the venture has recorded them — the founder's own
 * offer and outreach channel.
 *
 * Exported because the authenticated edge function regenerates the move from
 * durably-appended facts rather than through
 * rerunFounderWithApprovedOpportunities(), and without this its task said
 * "1 reachable prospect" instead of the prospect's real name.
 *
 * EVERY value woven in here is already trusted and already in scope: the
 * approved leads come from evaluateOpportunityEligibility, and `missionContext`
 * is built by resolveFounderTaskContentFacts from the same snapshot plus the
 * ACTIVE fact ledger. Nothing is re-derived, re-worded or inferred. The offer
 * is quoted verbatim inside quotation marks precisely so its terms cannot be
 * paraphrased into something the founder never agreed to; when it is absent
 * the clause is dropped rather than replaced with a generic stand-in. Wording
 * only — this runs after selection and cannot change which mission was chosen,
 * which leads were picked, or their order.
 *
 * @param {object|null} missionContext MissionContext (decision-core/mission-context.js) or null.
 */
export function namedMission(mission, opportunities, missionContext = null) {
  if (!mission || !['founder_sales_outreach_block', 'founder_customer_interview_set'].includes(mission.routeId)) return mission;
  const approved = opportunities.filter((item) => item.state === 'approved').slice(0, 5);
  if (approved.length === 0) return mission;

  const joinedNames = approved.map((item) => item.name).join(', ');
  const interviewRoute = mission.routeId === 'founder_customer_interview_set';
  const verb = missionContext?.actionVerb || (interviewRoute ? 'Interview' : 'Contact');
  const channelLabel = missionContext?.actionLabel || null;
  // Capped only so one very long recorded offer cannot swamp the statement;
  // missionPhrase truncates on a boundary and marks it, never rewrites.
  const offer = missionPhrase(missionContext?.subjectText, 140);
  const routes = recordedContactRoutes(approved);

  const offerClause = offer
    ? interviewRoute
      ? ` Bring your recorded offer — "${offer}" — and use it only to test whether it matches what they describe; do not change its terms.`
      : ` Present your recorded offer exactly as it stands — "${offer}".`
    : '';
  const routeClause = routes ? ` Recorded contact routes: ${routes}.` : '';
  const honestyClause = ' Make no claim about either business beyond the public evidence already on record.';

  const evidence = [...(mission.requiredEvidence || [])];
  evidence.push(channelLabel
    ? `Which of ${joinedNames} you reached and the outcome for each, using your recorded channel (${channelLabel.toLowerCase()})`
    : `Which of ${joinedNames} you reached and the outcome for each`);

  return {
    ...mission,
    title: missionPhrase(`${verb} ${joinedNames}`, 116) || `${verb} ${joinedNames}`,
    missionStatement: interviewRoute
      ? `${verb} ${joinedNames} and ask about the problem they face, then record repeated pain points, current alternatives and urgency.${offerClause}${routeClause}${honestyClause}`
      : `${verb} ${joinedNames} and record whether each booked, declined or did not respond.${offerClause}${routeClause}${honestyClause}`,
    completionDefinition: interviewRoute
      ? `An outcome is recorded for every business in the batch (${joinedNames}), including repeated pain points, current alternatives and urgency.`
      : `An outcome is recorded for every business in the batch (${joinedNames}).`,
    requiredEvidence: evidence,
    namedOpportunityIds: approved.map((item) => item.id),
  };
}

export function rerunFounderWithApprovedOpportunities({ draft, opportunities, ventureId, userId, evaluationTime }) {
  const facts = approvedOpportunityFacts({ opportunities, ventureId, userId, occurredAt: evaluationTime });
  if (facts.length === 0) throw new Error('eligible_approved_opportunity_required');
  const eligibleIds = new Set(facts.map((fact) => fact.sourceReference.replace('opportunity_intelligence:', '')));
  const eligibleOpportunities = opportunities.filter((item) => eligibleIds.has(String(item.id)));
  const pipelineResult = runFounderIntakePipeline({ facts: [...draft.facts, ...facts], ventureId, userId, evaluationTime, rawTexts: draft.rawTexts || [] });
  if (pipelineResult.missionPolicy?.mission) pipelineResult.missionPolicy = { ...pipelineResult.missionPolicy, mission: namedMission(pipelineResult.missionPolicy.mission, eligibleOpportunities, pipelineResult.missionContext) };
  return { pipelineResult, addedFacts: facts };
}

// ---------------------------------------------------------------------------
// Structured outcome reporting (spec Phase 3): turns a founder's plain-
// language report about ONE already-identified prospect into a structured
// customerEntity update. Deterministic keyword matching only -- never an LLM
// call -- mirroring founder-venture-state/collectors/entities.js's own chat-
// extraction philosophy. Never resolves WHICH entity the report is about;
// the caller (conversation/active-task context) supplies customerEntityId,
// so this can never invent a business relationship that was not actually
// reported (spec: do not invent an entity when it cannot be resolved).
// ---------------------------------------------------------------------------

// Product-facing options a founder picks after taking an action -- never
// exposed internal event codes (spec Phase 3).
export const OUTCOME_REPORT_OPTIONS = Object.freeze([
  'completed', 'got_response', 'blocked', 'situation_changed', 'need_help', 'no_result',
]);

const REQUEST_KEYWORDS = Object.freeze([
  { requestType: 'proof', pattern: /\b(proof|portfolio|sample|see (some(thing)?|your work)|show (me|us))\b/i },
  { requestType: 'pricing', pattern: /\b(price|pricing|cost|how much|quote|rates?)\b/i },
  { requestType: 'proposal', pattern: /\b(proposal|written (proposal|agreement)|contract)\b/i },
  { requestType: 'meeting', pattern: /\b(meet(ing)?|call (again|next week)|schedule|book (a|the) (call|meeting)|talk (again|more))\b/i },
]);

const ENGAGEMENT_KEYWORDS = Object.freeze([
  { engagementState: 'meeting_booked', pattern: /\b(booked|scheduled|set up (a|the) (call|meeting))\b/i },
  { engagementState: 'not_interested', pattern: /\b(not interested|no thanks|not right now|pass(ed)? on (it|this))\b/i },
  { engagementState: 'lost', pattern: /\b(rejected|said no|went with (someone|another)|not moving forward|chose (someone|another) else)\b/i },
  { engagementState: 'interested', pattern: /\b(interested|keen|likes? it|sounds good|excited|wants? to (move forward|proceed))\b/i },
  { engagementState: 'no_response', pattern: /\b(no response|didn'?t (answer|respond|reply)|voicemail|no answer|went silent)\b/i },
]);

/**
 * @param {object} params
 * @param {string} params.responseOption One of OUTCOME_REPORT_OPTIONS.
 * @param {string} [params.freeText] Optional supporting free text, e.g. "he's interested but wants to see proof before booking".
 * @returns {{engagementState: string|null, pendingRequest: (string|null|undefined), interpretation: string}}
 *   pendingRequest is `undefined` when this report gives no reason to change
 *   whatever request is already on record (e.g. "I'm blocked" on a prospect
 *   who already asked for proof does not clear that pending proof request);
 *   `null` explicitly clears it (the founder reported completing the
 *   requested follow-up with no new request replacing it); a string sets a
 *   newly-detected request.
 */
export function interpretFounderOutcomeReport({ responseOption, freeText = '' }) {
  if (!OUTCOME_REPORT_OPTIONS.includes(responseOption)) {
    throw new Error(`unsupported responseOption: ${responseOption}`);
  }
  const text = String(freeText || '');
  const matchedRequest = REQUEST_KEYWORDS.find((entry) => entry.pattern.test(text)) || null;
  const matchedEngagement = ENGAGEMENT_KEYWORDS.find((entry) => entry.pattern.test(text)) || null;

  let engagementState = matchedEngagement?.engagementState ?? null;
  if (!engagementState) {
    if (responseOption === 'got_response' && matchedRequest) engagementState = 'interested';
    else if (responseOption === 'completed') engagementState = 'contacted';
    else if (responseOption === 'no_result') engagementState = 'no_response';
    else if (responseOption === 'blocked' || responseOption === 'need_help' || responseOption === 'situation_changed') engagementState = 'follow_up_needed';
  }

  let pendingRequest;
  if (matchedRequest) pendingRequest = matchedRequest.requestType;
  else if (responseOption === 'completed') pendingRequest = null;
  else pendingRequest = undefined;

  const parts = [];
  if (engagementState) parts.push(`prospect is now ${engagementState.replace(/_/g, ' ')}`);
  if (pendingRequest) parts.push(`waiting on ${pendingRequest} before proceeding`);
  else if (pendingRequest === null) parts.push('the previously requested follow-up is resolved');
  const interpretation = parts.length > 0
    ? parts.join('; ')
    : 'no specific engagement change could be determined from this report';

  return { engagementState, pendingRequest, interpretation };
}

/**
 * Builds the superseding customerEntity fact that applies an interpreted
 * outcome report onto an already-persisted entity. Every other field on the
 * existing fact (relationshipType, contactability, etc.) is preserved
 * unchanged -- a conversational report can only ever update engagementState/
 * pendingRequest, never silently rewrite unrelated entity facts.
 *
 * @param {object} params
 * @param {object} params.existingFact A validated, active customerEntity fact (fact-ledger.js shape) for this exact entity.
 * @param {string|null} params.engagementState
 * @param {string|null|undefined} params.pendingRequest `undefined` preserves the existing value; `null` clears it; a string sets it (see interpretFounderOutcomeReport).
 * @param {string} params.sourceReference
 * @param {string} params.occurredAt ISO timestamp.
 * @returns {object} A new fact (buildFact shape) with supersedesFactId set to the existing fact's factId.
 */
export function buildEngagementUpdateFact({
  existingFact, engagementState, pendingRequest, sourceReference, occurredAt,
}) {
  return buildFact({
    factId: `${sourceReference}:${existingFact.factKey}`,
    ventureId: existingFact.ventureId,
    userId: existingFact.userId,
    factKey: existingFact.factKey,
    value: {
      ...existingFact.value,
      ...(engagementState !== null ? { engagementState } : {}),
      ...(pendingRequest !== undefined ? { pendingRequest } : {}),
    },
    sourceType: 'user_manual_update',
    sourceReference,
    occurredAt,
    recordedAt: occurredAt,
    supersedesFactId: existingFact.factId,
  });
}
