/**
 * Capability: discover_and_review_entities
 *
 * Build a checked list of real, individually-identified entities the founder
 * can then act on, and record what was observed about each.
 *
 * NAMED BY SHAPE, NOT INDUSTRY. The same capability serves an agency listing
 * trades businesses, a B2B product listing operations teams, and a nonprofit
 * listing schools and trusts. It is "find real things, check them, record what
 * you saw" -- the entity type is an input, not a new capability.
 *
 * DESCRIBES WHAT ALREADY SHIPS. This module does not reimplement anything:
 * missionBuilder delegates to prospectDiscoveryMission, so the mission output
 * is byte-identical to today's by construction. The value of the contract at
 * this milestone is that the capability's rules are written down in one place
 * and validated, not that the engine has started calling through it.
 */

import { prospectDiscoveryMission } from '../../founder-mission-policy/prerequisite-missions.js';
import { notImplemented } from '../contract.js';

export const discoverAndReviewEntities = Object.freeze({
  capabilityId: 'discover_and_review_entities',
  version: 1,

  /* The two constraints a checked entity list actually addresses: nobody
     identified to talk to, and no repeatable way to reach more of them. */
  supportedBottlenecks: Object.freeze(['insufficient_customer_evidence', 'sales_conversion']),

  /* Blocked where a list is not the constraint: mid-build, mid-verification,
     or mid-fulfilment of an accepted commitment. Mirrors the believability caps
     already applied in founder-bottleneck/route-assessment.js -- declared here
     so a capability author can read the rule without reading the ranker. */
  stageConstraints: Object.freeze({
    blockedStages: Object.freeze(['building', 'testing', 'delivering']),
  }),

  /* Reflects the live gate in founder-mission-policy/index.js. Reads only; it
     decides nothing the engine has not already decided. */
  eligibilityRules({ perKey, entityBundle, batchProgress, route }) {
    const targetCustomerLabel = perKey?.targetCustomer?.value;
    if (!targetCustomerLabel) {
      return { eligible: false, reason: 'no target customer is recorded, so there is nothing to go and find', missing: ['targetCustomer'] };
    }
    /* The venture router's refusal is authoritative: an audience of individual
       people is not enumerable, and handing over a business-prospect list for
       it is the exact confident falsehood the router exists to stop. */
    if (route && route.missionPattern !== 'enumerable_business_prospects') {
      return { eligible: false, reason: route.reason || 'the target is not a set of entities this capability can enumerate', missing: ['enumerable_target'] };
    }
    if (batchProgress && batchProgress.state === 'met') {
      return { eligible: false, reason: 'the required list is already complete', missing: [] };
    }
    return { eligible: true, reason: 'a target customer is recorded and the list is not yet complete', missing: [] };
  },

  requiredFacts: Object.freeze(['targetCustomer', 'offer']),
  requiredResources: Object.freeze(['crm_directory_access', 'crm_contact_access']),

  workItemType: 'customer_prospect_batch',

  /* Delegates. Byte-identical output is the point of this milestone. */
  missionBuilder(context) {
    return prospectDiscoveryMission(context);
  },

  workspaceType: 'entity_review',
  workspaceConfigSchema: Object.freeze({
    entityKind: 'string — what is being listed, taken from the venture, never hardcoded',
    requiredCount: 'integer — from mission quantities, never a constant',
    screenCount: 'integer — how many to look at to reach requiredCount',
    contactCount: 'integer — how many to prioritise',
    observedFieldIds: 'string[] — what must be recorded per entity',
  }),

  requiredActions: Object.freeze([
    'identify_prospects', 'record_prospect_source', 'prioritise_prospects', 'record_prospect_list',
  ]),

  evidenceSchema: Object.freeze({
    proofType: 'photo',
    requiredEvidenceKinds: Object.freeze([
      'named_entities_with_source', 'per_entity_observation', 'contact_route', 'prioritised_subset',
    ]),
    /* The engine already enforces the byte caps; named here so a capability
       author knows the evidence list is not free-form. */
    boundedBy: 'validate_founder_generated_task_v1 (proof_must_show <= 320 bytes)',
  }),

  /* Real and shipping: approved entities become customerEntity facts, which is
     what moves the batch from partial to met. */
  completionHandler({ approvedEntityFacts = [] }) {
    return {
      factsWritten: approvedEntityFacts.map((fact) => fact.factKey),
      batchAdvanced: approvedEntityFacts.length > 0,
    };
  },

  stateUpdateRules: Object.freeze({
    factsWritten: Object.freeze(['customerEntity:<id>']),
    advancesWhen: 'the approved entity count reaches the mission requiredCount',
    neverWrites: Object.freeze(['customerEvidence', 'offerPricing']),
  }),

  nextMovePolicy: Object.freeze({
    loopBackTo: 'work_item',
    reason: 'a partly-built list continues as the same outcome; only a completed list re-opens the bottleneck',
  }),

  clarificationPolicy({ missing }) {
    if (missing?.includes('targetCustomer')) {
      return { question: 'Who is your target customer?', factKeys: ['targetCustomer'] };
    }
    /* Deliberately no question for a non-enumerable target: that is a statement
       about what VISION supports, not a gap in what the founder has told it,
       and asking would be the dead end fixed in the clarification milestone. */
    return null;
  },

  unsupportedFallback({ route }) {
    return {
      surface: 'statement',
      message: route?.reason
        ? `This venture's customers are not a set VISION can enumerate: ${route.reason}`
        : 'VISION cannot enumerate this venture\'s customers yet.',
      generatesTask: false,
    };
  },
});

/* Declared here rather than inside the frozen object so the contract stays a
   pure data shape: these are the parts of the capability that are described
   accurately but not yet routed through by the engine. */
export const DISCOVER_AND_REVIEW_ENTITIES_GAPS = Object.freeze({
  workspace: notImplemented('no Execution Workspace exists yet; workspaceType and workspaceConfigSchema describe the intended shape only'),
});
