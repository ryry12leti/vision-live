/* ════════════════════════════════════════════════════════════════════════
   PROSPECT INTELLIGENCE — the canonical contract
   ────────────────────────────────────────────────────────────────────────
   ONE record describing what VISION knows about a prospect and what the
   founder should do about it. It sits BETWEEN qualification and the locked
   Leads frontend: qualification and ranking are inputs to it, never outputs
   of it.

   WHAT THIS MODULE DOES NOT OWN, deliberately:
     - qualification            ranking.js (LEAD_QUALIFICATION_THRESHOLD = 30)
     - sales-practice readiness sales-practice.js (threshold 40, separate)
     - eligibility / gating     eligibility.js
     - evidence status          signals.js (buildSignal is the only constructor)
     - Founder State writes     founder-bridge.js
   Every one of those already exists and is already tested. This contract
   COPIES their results and records where each came from; it never recomputes
   one, because a second implementation of a threshold is how two thresholds
   end up disagreeing.

   THE PRESENTATION GRADE IS NOT SET HERE. The locked frontend shows A+/A/B
   from its fixtures. There is no canonical backend mapping onto those letters
   yet and inventing one now would manufacture precision we have no data for —
   real calibration needs a real lead distribution, which needs providers.
   `presentationGrade` is therefore always null out of this layer and the view
   model leaves the field alone.
   ════════════════════════════════════════════════════════════════════════ */

import { EVIDENCE_STATUSES } from './contract.js';

export const PROSPECT_INTELLIGENCE_CONTRACT_VERSION = 1;

/* The B2C lifecycle, weakest to strongest. The line is not decoration: a click
   is activity, not a person who asked to be contacted. Anything below `lead`
   has no identity and no permission, so no personal outreach may be proposed
   for it no matter how much activity it generated. */
export const LEAD_LIFECYCLE_STAGES = Object.freeze([
  'anonymous', 'engaged', 'lead', 'qualified_lead', 'hot_lead', 'customer',
]);
export const FIRST_LEAD_STAGE_INDEX = LEAD_LIFECYCLE_STAGES.indexOf('lead');

export function isLeadStage(stage) {
  const index = LEAD_LIFECYCLE_STAGES.indexOf(stage);
  return index >= 0 && index >= FIRST_LEAD_STAGE_INDEX;
}

export const LEAD_TYPES = Object.freeze(['b2b', 'b2c']);

/* Consent is a B2C concept but the field is present for both so one code path
   reads it. A public business phone number is `not_required`: it is published
   for the purpose of being called. */
export const CONSENT_STATUSES = Object.freeze(['granted', 'declined', 'withdrawn', 'unknown', 'not_required']);

/* Reuses signals.js CONTACT_CHANNELS vocabulary plus the two inbound-only
   routes a consented B2C lead can carry. */
export const PROSPECT_CONTACT_CHANNELS = Object.freeze([
  'call', 'email', 'sms', 'dm', 'website_form', 'public_social', 'in_person',
]);

/* Actions the engine may choose. Code picks exactly one; the model never
   does. Ordered by how much the founder is being asked to commit. */
export const NEXT_ACTIONS = Object.freeze([
  'do_not_contact',        // below the lead line, or consent forbids it
  'observe_only',          // real signal, no permission and no identity
  'refresh_evidence',      // what we know is too old to act on
  'research_contact_route',// no way in is established
  'research_prospect',     // evidence too thin to justify contact
  'clarify_offer',         // the founder's own offer is not confirmed
  'email',
  'call_this_week',
  'call_now',
]);

/* THE REFUSALS — actions that mean "do not write a script for this yet".
   Canonical here, beside the vocabulary they are drawn from, because two
   independent copies already existed (leads-board.js and
   workspace-view-model.js) and a third would guarantee they drift.

   Load-bearing beyond presentation: a refused prospect gets NO workspace,
   so language written for it is discarded — and generating it anyway costs
   a real model call for prose nobody will ever read. */
export const REFUSAL_ACTIONS = Object.freeze([
  'observe_only', 'do_not_contact', 'refresh_evidence',
  'research_contact_route', 'research_prospect', 'clarify_offer',
]);

export function isRefusalAction(action) {
  return REFUSAL_ACTIONS.includes(action);
}

/* Bounds exist so a bad generation cannot destroy the locked frontend. They
   are generous enough for the content density leads-mock.js demonstrates and
   hard enough that nothing can paste an essay into a card. */
export const BOUNDS = Object.freeze({
  whyChosen: 700,
  whyNow: 400,
  reason: 260,
  relativePriorityReason: 400,
  whyThisProspect: 1200,
  strength: 220,
  weakness: 220,
  offerFit: 1000,
  timelineLabel: 120,
  timelineDetail: 260,
  actionWhy: 600,
  opening: 900,
  angle: 700,
  firstQuestion: 260,
  discoveryQuestion: 260,
  dontSay: 400,
  objection: 200,
  likelyMeaning: 400,
  objectionResponse: 900,
  callPhase: 80,
  callNote: 300,
  outreach: 2600,
  maxReasons: 8,
  maxStrengths: 6,
  maxWeaknesses: 6,
  maxTimeline: 12,
  maxDiscovery: 5,
  minDiscovery: 3,
  maxDontSay: 5,
  maxObjections: 5,
  maxCallStructure: 6,
  maxUnknowns: 8,
  maxEvidenceRefs: 12,
});

function isString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function isArrayOf(value, min, max, check) {
  return Array.isArray(value) && value.length >= min && value.length <= max && value.every(check);
}

/* ── The model's output schema ──────────────────────────────────────────
   ONLY language. There is no field here for a score, a grade, a
   qualification verdict, a channel that exists, or a ranking position —
   the model is structurally unable to return one, which is a stronger
   guarantee than instructing it not to.

   `additionalProperties:false` and `required` on every object are what
   OpenAI strict mode demands; they also mean an invented field is a parse
   failure rather than a silent extra. */
export function prospectLanguageSchema() {
  const str = (maxLength) => ({ type: 'string', maxLength });
  return {
    name: 'prospect_language',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['whyChosen', 'whyNow', 'whyThisProspect', 'strengths', 'weaknesses', 'offerFit',
        'whatToSay', 'objections', 'callStructure', 'outreach'],
      properties: {
        whyChosen: str(BOUNDS.whyChosen),
        whyNow: str(BOUNDS.whyNow),
        whyThisProspect: str(BOUNDS.whyThisProspect),
        strengths: { type: 'array', maxItems: BOUNDS.maxStrengths, items: str(BOUNDS.strength) },
        weaknesses: { type: 'array', maxItems: BOUNDS.maxWeaknesses, items: str(BOUNDS.weakness) },
        offerFit: str(BOUNDS.offerFit),
        whatToSay: {
          type: 'object',
          additionalProperties: false,
          required: ['opening', 'angle', 'firstQuestion', 'discoveryQuestions', 'dontSay'],
          properties: {
            opening: str(BOUNDS.opening),
            angle: str(BOUNDS.angle),
            firstQuestion: str(BOUNDS.firstQuestion),
            discoveryQuestions: { type: 'array', maxItems: BOUNDS.maxDiscovery, items: str(BOUNDS.discoveryQuestion) },
            dontSay: { type: 'array', maxItems: BOUNDS.maxDontSay, items: str(BOUNDS.dontSay) },
          },
        },
        objections: {
          type: 'array',
          maxItems: BOUNDS.maxObjections,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['objection', 'likelyMeaning', 'response'],
            properties: {
              objection: str(BOUNDS.objection),
              likelyMeaning: str(BOUNDS.likelyMeaning),
              response: str(BOUNDS.objectionResponse),
            },
          },
        },
        callStructure: {
          type: 'array',
          maxItems: BOUNDS.maxCallStructure,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['phase', 'note'],
            properties: { phase: str(BOUNDS.callPhase), note: str(BOUNDS.callNote) },
          },
        },
        outreach: {
          type: 'object',
          additionalProperties: false,
          required: ['call', 'email', 'sms', 'dm'],
          /* Every channel is required by strict mode, so an empty string is
             how the model says "not applicable". The validator then refuses
             any NON-empty script for a channel that does not exist. */
          properties: {
            call: str(BOUNDS.outreach),
            email: str(BOUNDS.outreach),
            sms: str(BOUNDS.outreach),
            dm: str(BOUNDS.outreach),
          },
        },
      },
    },
  };
}

/** Shape check for what the model returned, before any grounding work. */
export function validateProspectLanguage(language) {
  const errors = [];
  if (!language || typeof language !== 'object' || Array.isArray(language)) {
    return { valid: false, errors: ['language must be an object'] };
  }
  if (!isString(language.whyChosen, BOUNDS.whyChosen)) errors.push('whyChosen is missing or oversized');
  if (!isString(language.whyNow, BOUNDS.whyNow)) errors.push('whyNow is missing or oversized');
  if (!isString(language.whyThisProspect, BOUNDS.whyThisProspect)) errors.push('whyThisProspect is missing or oversized');
  if (!isString(language.offerFit, BOUNDS.offerFit)) errors.push('offerFit is missing or oversized');
  if (!isArrayOf(language.strengths, 0, BOUNDS.maxStrengths, (item) => isString(item, BOUNDS.strength))) errors.push('strengths malformed');
  if (!isArrayOf(language.weaknesses, 0, BOUNDS.maxWeaknesses, (item) => isString(item, BOUNDS.weakness))) errors.push('weaknesses malformed');

  const say = language.whatToSay;
  if (!say || typeof say !== 'object') errors.push('whatToSay missing');
  else {
    if (!isString(say.opening, BOUNDS.opening)) errors.push('whatToSay.opening missing or oversized');
    if (!isString(say.angle, BOUNDS.angle)) errors.push('whatToSay.angle missing or oversized');
    if (!isString(say.firstQuestion, BOUNDS.firstQuestion)) errors.push('whatToSay.firstQuestion missing or oversized');
    if (!isArrayOf(say.discoveryQuestions, BOUNDS.minDiscovery, BOUNDS.maxDiscovery, (item) => isString(item, BOUNDS.discoveryQuestion))) {
      errors.push(`whatToSay.discoveryQuestions must be ${BOUNDS.minDiscovery}-${BOUNDS.maxDiscovery} bounded strings`);
    }
    if (!isArrayOf(say.dontSay, 0, BOUNDS.maxDontSay, (item) => isString(item, BOUNDS.dontSay))) errors.push('whatToSay.dontSay malformed');
  }

  if (!isArrayOf(language.objections, 0, BOUNDS.maxObjections, (item) => item && typeof item === 'object'
    && isString(item.objection, BOUNDS.objection)
    && isString(item.likelyMeaning, BOUNDS.likelyMeaning)
    && isString(item.response, BOUNDS.objectionResponse))) errors.push('objections malformed');

  if (!isArrayOf(language.callStructure, 0, BOUNDS.maxCallStructure, (item) => item && typeof item === 'object'
    && isString(item.phase, BOUNDS.callPhase)
    && isString(item.note, BOUNDS.callNote))) errors.push('callStructure malformed');

  const outreach = language.outreach;
  if (!outreach || typeof outreach !== 'object') errors.push('outreach missing');
  else {
    for (const channel of ['call', 'email', 'sms', 'dm']) {
      const value = outreach[channel];
      if (typeof value !== 'string' || value.length > BOUNDS.outreach) errors.push(`outreach.${channel} malformed or oversized`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Shape check for the assembled canonical record. */
export function validateProspectIntelligence(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: ['record must be an object'] };
  }
  if (record.contractVersion !== PROSPECT_INTELLIGENCE_CONTRACT_VERSION) errors.push('contractVersion mismatch');
  if (!isString(record.leadId, 200)) errors.push('leadId is required');
  if (!isString(record.ventureId, 200)) errors.push('ventureId is required');
  if (!isString(record.generatedAt, 40) || !Number.isFinite(Date.parse(record.generatedAt))) errors.push('generatedAt must be an ISO date');
  if (!LEAD_TYPES.includes(record.leadType)) errors.push('leadType must be b2b or b2c');
  if (!LEAD_LIFECYCLE_STAGES.includes(record.lifecycleStage)) errors.push('lifecycleStage is invalid');
  if (typeof record.isLead !== 'boolean') errors.push('isLead must be boolean');
  if (!Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) errors.push('confidence must be 0-1');

  /* The presentation grade must stay unset until real calibration data
     exists. A non-null value here means somebody invented a grade policy. */
  if (record.presentationGrade !== null) errors.push('presentationGrade must remain null until real calibration data exists');

  const q = record.qualification;
  if (!q || typeof q !== 'object') errors.push('qualification block is required');
  else {
    if (typeof q.qualified !== 'boolean') errors.push('qualification.qualified must be boolean');
    if (q.threshold !== 30) errors.push('qualification.threshold must remain 30');
    if (q.source !== 'ranking') errors.push('qualification.source must be ranking');
  }

  const selection = record.selection;
  if (!selection || typeof selection !== 'object') errors.push('selection block is required');
  else {
    if (!isString(selection.whyChosen, BOUNDS.whyChosen)) errors.push('selection.whyChosen is required');
    if (!isArrayOf(selection.reasons, 0, BOUNDS.maxReasons, (item) => item && typeof item === 'object'
      && isString(item.statement, BOUNDS.reason)
      && EVIDENCE_STATUSES.includes(item.evidenceStatus))) errors.push('selection.reasons malformed');
    if (!Array.isArray(selection.strongestEvidenceRefs) || selection.strongestEvidenceRefs.length > BOUNDS.maxEvidenceRefs) errors.push('selection.strongestEvidenceRefs malformed');
    if (!Array.isArray(selection.importantUnknowns) || selection.importantUnknowns.length > BOUNDS.maxUnknowns) errors.push('selection.importantUnknowns malformed');
  }

  const workspace = record.workspace;
  if (!workspace || typeof workspace !== 'object') errors.push('workspace block is required');
  else {
    const action = workspace.nextBestAction;
    if (!action || typeof action !== 'object') errors.push('workspace.nextBestAction is required');
    else {
      if (!NEXT_ACTIONS.includes(action.action)) errors.push('nextBestAction.action is not a known action');
      if (action.channel !== null && !PROSPECT_CONTACT_CHANNELS.includes(action.channel)) errors.push('nextBestAction.channel is invalid');
      if (!isString(action.why, BOUNDS.actionWhy)) errors.push('nextBestAction.why is required');
    }
  }
  return { valid: errors.length === 0, errors };
}

export const PROSPECT_CONTRACT_INTERNALS = Object.freeze({ isString, isArrayOf });
