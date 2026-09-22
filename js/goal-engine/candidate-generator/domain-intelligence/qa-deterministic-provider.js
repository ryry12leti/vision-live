/**
 * QA/TEST-ONLY deterministic domain-intelligence provider.
 *
 * Converts a planned batch of CandidateBriefs directly into full candidate
 * proposals so the whole candidate-generator pipeline (planner ->
 * instruction compiler -> generator.js -> response-validator.js) can be
 * proven end to end without a live model call. This is not a real
 * generation strategy: production candidate authorship (titles, wording,
 * elaboration within the brief's fixed safety envelope) belongs to a real
 * model provider consuming ../domain-intelligence/instruction-compiler.js's
 * provider-neutral instructions. That module has zero knowledge of this
 * one; a real model integration must depend on instruction-compiler.js only
 * and must never import this file.
 *
 * Deliberately does NOT self-check its own output against the instructions
 * before returning. That verification now lives entirely in the trusted
 * caller (generateMissionCandidates -> response-validator.js), which
 * receives the exact same compiled instructions this provider does via
 * `request.providerInstructions` — never a provider-supplied copy. This
 * provider simply echoes `providerInstructions.instructionsHash` back
 * honestly, the way any compliant provider must; it does not police itself,
 * proving by example that the public pipeline alone is what actually
 * enforces "no response for different briefs" and "no acceptance
 * shortcut", not any provider's good behavior.
 */

import { CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION } from '../contract.js';
import { planCandidateBriefs } from './planner.js';

function workUnitDescription(request, workUnitTypeId) {
  return request.canonicalWorkUnits.find((item) => item.id === workUnitTypeId)?.description || workUnitTypeId;
}

function compileMissionSteps(brief) {
  const seenOutputIds = new Set();
  return brief.missionStepPlan.map((step) => {
    let outputId = `${brief.briefId}_${step.id}_output`;
    while (seenOutputIds.has(outputId)) outputId += '_next';
    seenOutputIds.add(outputId);
    return {
      id: step.id,
      actionType: step.actionType,
      outputId,
      outputCategoryId: step.outputCategoryId,
      effortUnits: step.effortUnits,
    };
  });
}

function compileMissionStructure(brief) {
  const shared = {
    methodId: brief.method.id,
    outcomeType: brief.measurableOutcome.type,
    milestoneId: brief.measurableOutcome.targetId,
    professionalPrinciple: brief.strategicReason,
  };
  if (brief.missionStructureKind === 'hard_medium') {
    return {
      kind: 'hard_medium',
      hard: { ...shared, effortUnits: brief.effortBudget.hard },
      medium: { ...shared, effortUnits: brief.effortBudget.medium },
      fixed: null,
    };
  }
  return {
    kind: 'fixed',
    hard: null,
    medium: null,
    fixed: {
      ...shared,
      effortUnits: brief.effortBudget.fixed,
      conditionId: `${brief.workUnitTypeId}_fixed_condition`,
      externalRequirement:
        `The trusted capability/recovery ceiling only allows a single fixed-effort version of ${brief.workUnitTypeId}.`,
    },
  };
}

/**
 * QA-only: compiles one CandidateBrief directly into a full candidate
 * proposal matching candidate-contract.js's PROPOSAL_FIELDS. Never used by
 * a real model integration — see the module-level warning above.
 *
 * @param {object} brief A CandidateBrief already validated against `request`.
 * @param {object} request The exact generation request the brief was planned from.
 * @returns {object}
 */
export function compileCandidateProposal(brief, request) {
  return {
    candidateId: `${brief.briefId}_candidate`,
    title: `Complete ${workUnitDescription(request, brief.workUnitTypeId)}`,
    domainId: request.domainId,
    workUnitTypeId: brief.workUnitTypeId,
    method: {
      id: brief.method.id,
      targetIds: [brief.measurableOutcome.targetId],
      progressionIntent: brief.method.progressionIntent,
    },
    intendedOutcome: {
      type: brief.measurableOutcome.type,
      targetId: brief.measurableOutcome.targetId,
      measurable: true,
    },
    missionSteps: compileMissionSteps(brief),
    targetMilestoneId: request.currentMilestone.id,
    targetRouteNodeId: request.route.routeNodeId,
    targetBottleneckCategory: request.bottleneck.category,
    missionStructure: compileMissionStructure(brief),
    estimatedMinutes: brief.timeBudgetMinutes,
    requiredResourceIds: [...brief.requiredResourceIds],
    proofPlan: {
      evidenceTypeId: brief.evidenceTypeId,
      proofMode: brief.proofMode,
      claims: [{ id: `${brief.briefId}_claim`, categoryId: brief.claimCategoryId }],
    },
    evidenceRefs: [],
    domainDetails: { ...brief.domainDetailConstraints },
    professionalExecutionUnit: brief.professionalExecutionUnit,
  };
}

/**
 * QA-only. Compiles every brief in one planned batch into candidate
 * proposals with stable, unique candidateIds.
 *
 * @param {object[]} briefs
 * @param {object} request
 * @returns {object[]}
 */
export function compileCandidateProposals(briefs, request) {
  return briefs.map((brief) => compileCandidateProposal(brief, request));
}

/**
 * QA-only `CandidateGenerationProvider` (see ../contract.js
 * `isValidProvider`). Plans briefs itself (a pure function of `request`
 * alone, so it always agrees with whatever generateMissionCandidates
 * already planned) and compiles the QA-only candidate proposals from them.
 * Reads `instructionsHash` from `request.providerInstructions` — the exact
 * value the trusted caller computed, not one this provider derives or
 * verifies on its own — and echoes it back honestly, the way any compliant
 * provider must. See the module-level comment: this provider intentionally
 * performs no self-check; generateMissionCandidates -> response-validator.js
 * is the only path that can accept a candidate.
 *
 * @param {{name?: string}} [options]
 * @returns {import('../contract.js').CandidateGenerationProvider}
 */
export function createQaDomainIntelligenceProvider({ name = 'qa_domain_intelligence' } = {}) {
  return {
    name,
    generate(request) {
      const briefs = planCandidateBriefs(request);
      const candidates = compileCandidateProposals(briefs, request);

      return {
        contractVersion: CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION,
        requestId: request.requestId,
        contextId: request.contextId,
        goalId: request.goalId,
        requestHash: request.requestHash,
        instructionsHash: request.providerInstructions.instructionsHash,
        candidates,
      };
    },
  };
}
