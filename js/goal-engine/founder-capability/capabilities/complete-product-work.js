/**
 * Capability: complete_product_work
 *
 * Finish one bounded, named piece of outstanding product or delivery work, and
 * verify it against its own acceptance criteria before calling it done.
 *
 * NAMED BY SHAPE, NOT INDUSTRY. The same capability serves a SaaS founder
 * fixing a failing webhook, an agency finishing a client's homepage, and a
 * studio completing a build step. "Complete a bounded thing and verify it" is
 * one shape of work; the artefact is an input, not a new capability.
 *
 * DESCRIBES WHAT ALREADY SHIPS. missionBuilder delegates to
 * deliveryCommitmentMission, so mission output is byte-identical to today's by
 * construction. Nothing here is wired into route selection at this milestone.
 */

import { deliveryCommitmentMission } from '../../founder-mission-policy/prerequisite-missions.js';
import { WORK_ITEM_ROUTE_ID } from '../../founder-decision-service/work-item-completion.js';
import { notImplemented } from '../contract.js';

export const completeProductWork = Object.freeze({
  capabilityId: 'complete_product_work',
  version: 1,

  supportedBottlenecks: Object.freeze(['delivery_throughput', 'operational_constraint']),

  /* Blocked where nothing exists to finish. `idea` and `validation` are reached
     by the ABSENCE of product evidence -- and note the engine deliberately does
     NOT cap delivery there for that same reason (inferring from absence). This
     constraint is the capability declining to claim it can act, which is a
     different and safer statement than the ranker suppressing a constraint. */
  stageConstraints: Object.freeze({
    blockedStages: Object.freeze(['idea', 'validation']),
  }),

  eligibilityRules({ perKey, deliveryShapedWork = [] }) {
    if (deliveryShapedWork.length === 0) {
      return { eligible: false, reason: 'no outstanding product or delivery work is recorded', missing: ['unfinishedWork'] };
    }
    /* Mirrors founder-execution-context/route-eligibility.js: the route needs a
       named target as well as the work itself. */
    const hasArticulatedTarget = Boolean(perKey?.offerPricing || perKey?.immediateGoal);
    if (!hasArticulatedTarget) {
      return { eligible: false, reason: 'no offer or current goal is recorded, so the work has no acceptance target', missing: ['offerPricing_or_currentGoal'] };
    }
    return { eligible: true, reason: `${deliveryShapedWork.length} bounded piece(s) of work are outstanding against a stated target`, missing: [] };
  },

  requiredFacts: Object.freeze(['unfinishedWork']),

  /* Genuinely external. VISION has no repository, build or deployment access
     and must never assume one -- these are only ever satisfied by a founder
     declaring them (founder-intake/pipeline.js EXTERNAL_RESOURCE_IDS). */
  requiredResources: Object.freeze([
    'repository_access', 'build_environment', 'test_environment', 'delivery_access',
  ]),

  workItemType: 'product_work_item',

  missionBuilder(context) {
    return deliveryCommitmentMission(context);
  },

  workspaceType: 'build_review',
  workspaceConfigSchema: Object.freeze({
    workItemLabel: 'string — the founder\'s own words for the outstanding item, never paraphrased',
    acceptanceCriteriaIds: 'string[] — what must be true before it counts as done',
    deliverySurface: 'string — where the result becomes visible (link, screenshot)',
  }),

  requiredActions: Object.freeze([
    'identify_product_slice', 'complete_delivery_implementation',
    'verify_acceptance_criteria', 'record_delivery_result', 'handle_incomplete_verification',
  ]),

  evidenceSchema: Object.freeze({
    proofType: 'photo',
    requiredEvidenceKinds: Object.freeze([
      'finished_artifact_reference', 'acceptance_verification', 'scope_note',
    ]),
    boundedBy: 'validate_founder_generated_task_v1 (proof_must_show <= 320 bytes)',
  }),

  /* Real and shipping: a completed item is matched against the thread's own
     task title and moved out of unfinishedWork, which is what lets the founder
     advance through their backlog instead of being handed the same item daily.
     See founder-decision-service/work-item-completion.js. */
  completionHandler({ activeThread, completedTaskTitles = [], snapshot }) {
    return {
      routeId: WORK_ITEM_ROUTE_ID,
      resolves: 'the single unfinishedWork item the completed task corroborates',
      inputs: { activeThread: Boolean(activeThread), completedTaskTitles: completedTaskTitles.length, snapshot: Boolean(snapshot) },
    };
  },

  stateUpdateRules: Object.freeze({
    factsWritten: Object.freeze(['completedWork']),
    advancesWhen: 'the completed task title corroborates a recorded unfinishedWork item',
    neverWrites: Object.freeze(['customerEvidence', 'targetCustomer']),
  }),

  nextMovePolicy: Object.freeze({
    loopBackTo: 'work_item',
    reason: 'a backlog with items left continues as the same outcome; an empty one re-opens the bottleneck',
  }),

  clarificationPolicy({ missing }) {
    if (missing?.includes('unfinishedWork')) {
      return { question: 'What work is still unfinished on your product or service right now?', factKeys: ['unfinishedWork'] };
    }
    if (missing?.includes('offerPricing_or_currentGoal')) {
      return { question: 'What is the single most important thing you are trying to achieve right now?', factKeys: ['immediateGoal'] };
    }
    return null;
  },

  unsupportedFallback({ missingResources = [] }) {
    return {
      surface: 'statement',
      message: missingResources.length > 0
        ? `This needs tooling VISION does not have and will not assume: ${missingResources.join(', ')}. Tell VISION what you actually use and it becomes available.`
        : 'VISION cannot run this work yet.',
      generatesTask: false,
    };
  },
});

export const COMPLETE_PRODUCT_WORK_GAPS = Object.freeze({
  workspace: notImplemented('no Execution Workspace exists yet; workspaceType and workspaceConfigSchema describe the intended shape only'),
  machineVerifiedEvidence: notImplemented('founder proof is locked to photo by validate_founder_generated_task_v1; a commit SHA or deploy URL would need a database change'),
});
