/**
 * Provider instruction compiler: Candidate Generation Checkpoint 2's
 * provider-neutral deliverable.
 *
 * Turns one planned batch of validated, deterministic `CandidateBrief`s into
 * a strict, injection-safe structured instruction payload for a future
 * model provider to elaborate on. This module knows nothing about any
 * specific provider (a real hosted model, or the QA-only deterministic
 * stand-in) and never itself produces a candidate proposal — see
 * qa-deterministic-provider.js for the QA-only module that does that,
 * deliberately kept separate so a real model integration can depend on this
 * file alone and never import test-only code.
 *
 * Injection-safety: the payload is a fixed-shape plain object, never a
 * template string, so nothing here concatenates untrusted content into
 * anything a consumer could parse as a command. Every `structural` field is
 * copied straight from a brief that domain-intelligence/contract.js already
 * validated as a snake_case identifier, a canonical enum value, or a number
 * — none of it can carry attacker-controlled free text, and none of it is
 * ever used here to construct a dynamic key, a template string, or code.
 * The one genuinely free-text field a brief carries (`strategicReason`, plus
 * the identifier-shaped but still narrative `strategyLens`) is isolated
 * under `narrativeContext`, clearly separate from `structural`, so a future
 * prompt template can quote it as untrusted context and must never treat it
 * as an executable instruction.
 *
 * Hash correlation: `instructionsHash` is a SHA-256 fingerprint (the same
 * canonical, key-order-independent Web Crypto hashing request-builder.js
 * uses for `requestHash`) over the exact requestId/contextId/goalId/
 * requestHash/domainId/instructions this batch compiled. `requestHash` ties
 * a response to one exact request; `instructionsHash` additionally ties it
 * to the exact briefs planned from that request.
 * `verifyCandidatesAnswerInstructions` checks every candidate a provider
 * returns against this exact batch's instructions field by field — not
 * merely which route it claims — so a response built from a different
 * request's briefs, or one that merely relabels a genuine route while
 * quietly changing its content (a different effort/time budget, a
 * different resource list, different domain details, a reordered mission-
 * step sequence), is rejected instead of silently accepted alongside
 * genuine candidates.
 */

import { sha256Hex, stableStringify } from '../canonical.js';
import { planCandidateBriefs } from './planner.js';

export const PROVIDER_INSTRUCTION_CONTRACT_VERSION = 1;

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

/**
 * One brief's compiled instruction. Everything under `structural` is a
 * validated identifier, enum value, or number the brief already carried;
 * `narrativeContext` is the only free-text content and must never be
 * treated as authoritative by a future consumer.
 */
function compileOneInstruction(brief) {
  return {
    instructionId: brief.briefId,
    structural: {
      workUnitTypeId: brief.workUnitTypeId,
      evidenceTypeId: brief.evidenceTypeId,
      proofMode: brief.proofMode,
      claimCategoryId: brief.claimCategoryId,
      outputCategoryId: brief.outputCategoryId,
      method: { id: brief.method.id, progressionIntent: brief.method.progressionIntent },
      measurableOutcome: { type: brief.measurableOutcome.type, targetId: brief.measurableOutcome.targetId },
      missionStepPlan: brief.missionStepPlan.map((step) => ({
        id: step.id,
        actionType: step.actionType,
        outputCategoryId: step.outputCategoryId,
        effortUnits: step.effortUnits,
      })),
      missionStructureKind: brief.missionStructureKind,
      timeBudgetMinutes: brief.timeBudgetMinutes,
      effortBudget: { ...brief.effortBudget },
      requiredResourceIds: [...brief.requiredResourceIds],
      domainDetailConstraints: { ...brief.domainDetailConstraints },
      professionalExecutionUnit: brief.professionalExecutionUnit,
    },
    narrativeContext: {
      strategyLens: brief.strategyLens,
      strategicReason: brief.strategicReason,
    },
  };
}

/**
 * @param {object[]} briefs Briefs already validated against `request` (e.g. by planCandidateBriefs).
 * @param {object} request The exact generation request the briefs were planned from.
 * @returns {Promise<Readonly<object>>} A deep-frozen instruction batch, deterministic in every field.
 */
export async function compileProviderInstructions(briefs, request) {
  const hashable = {
    contractVersion: PROVIDER_INSTRUCTION_CONTRACT_VERSION,
    requestId: request.requestId,
    contextId: request.contextId,
    goalId: request.goalId,
    requestHash: request.requestHash,
    domainId: request.domainId,
    instructions: briefs.map(compileOneInstruction),
  };
  const instructionsHash = await sha256Hex(hashable);
  return deepFreeze({ ...hashable, instructionsHash });
}

/**
 * Convenience: plans briefs fresh from `request` and compiles instructions
 * for them in one call. Lets a caller ask "what should the instructions for
 * this exact request be right now?" independent of whatever a provider
 * actually returned, so a stale or mismatched batch can be detected by
 * comparison rather than trusted implicitly.
 *
 * @param {object} request
 * @returns {Promise<Readonly<object>>}
 */
export async function deriveExpectedProviderInstructions(request) {
  return compileProviderInstructions(planCandidateBriefs(request), request);
}

/**
 * Two string arrays are the same *set* (order-independent, duplicates
 * collapsed) — used where the contract only constrains which categories
 * appear, not how many times or in what order.
 */
function sameArraySet(a, b) {
  return stableStringify([...new Set(a || [])].sort()) === stableStringify([...new Set(b || [])].sort());
}

/**
 * Every active mission-structure version a candidate carries, paired with
 * the effort budget instruction.structural.effortBudget expects for that
 * exact version: hard+medium for a Hard/Medium mission, or fixed for a
 * Fixed mission. Mirrors response-validator.js's own allMethodLocations for
 * *which locations exist*, kept separate since that one exists for a
 * different purpose (forbidden-method / top-level self-consistency checks,
 * not instruction correlation) and only inspects methodId.
 *
 * `professionalPrinciple` (and, for Fixed, `conditionId`/
 * `externalRequirement`) are deliberately excluded from every version
 * object this returns: none of them appear in the brief, so none of them
 * are authoritative, and free-text provider wording must never gate
 * acceptance.
 */
function missionStructureVersions(candidate, effortBudget) {
  const structure = candidate.missionStructure;
  if (!structure) return [];
  if (structure.kind === 'fixed') {
    return structure.fixed ? [{ version: structure.fixed, expectedEffortUnits: effortBudget?.fixed }] : [];
  }
  const versions = [];
  if (structure.hard) versions.push({ version: structure.hard, expectedEffortUnits: effortBudget?.hard });
  if (structure.medium) versions.push({ version: structure.medium, expectedEffortUnits: effortBudget?.medium });
  return versions;
}

/**
 * Every field the instruction compiler declared structural (see
 * compileOneInstruction) that a candidate must match exactly to be
 * accepted as answering that instruction — not merely the work unit it
 * claims, but its full content: evidence/proof mode, the exact claim
 * multiplicity (not merely which categories appear — see below), the
 * output-category set, the trusted method (the top-level id, progression
 * intent, and every active mission-structure version's methodId), the
 * measurable outcome (both the top-level intendedOutcome and every active
 * mission-structure version's outcomeType/milestoneId), the mission-
 * structure kind, the exact ordered mission-step id/actionType/
 * outputCategoryId/effortUnits sequence, the effort budget (per active
 * mission-structure version), the time budget, the required-resource set,
 * and domainDetails/domainDetailConstraints (which is where Fitness target
 * muscles, Athlete sport/phase, Money amount/risk, Learning rubric/output,
 * and Creator platform/project/rights all actually live), plus the
 * complete professionalExecutionUnit — every exercise in a workout, every
 * outreach action, every assessment item, in order, with its own sets/
 * reps/effort/rest/resources — compared as one exact structure, so a
 * provider cannot silently drop, add, reorder, or reweight a single item.
 * Deliberately
 * never inspects `title`, `candidateId`, `evidenceRefs`, `method.
 * targetIds`, per-step `outputId`, `missionStructure.*.
 * professionalPrinciple`, or a Fixed mission's `conditionId`/
 * `externalRequirement` — none of these appear in the brief the provider
 * was instructed from, so none of them are authoritative, and free-text
 * provider wording must never gate acceptance or distinguish one candidate
 * from another.
 *
 * Claim multiplicity is checked exactly, not as a set: the brief names one
 * claim category, so a compliant candidate has exactly one claim in that
 * category — a provider cannot pad the claim list with duplicate-category
 * claims (claim ids may still be freely provider-authored).
 *
 * @returns {string[]} Field names that differ; empty means a full match.
 */
function structuralMismatches(candidate, instruction) {
  const s = instruction.structural;
  const mismatches = [];

  if (candidate.workUnitTypeId !== s.workUnitTypeId) mismatches.push('workUnitTypeId');
  if (candidate.proofPlan?.evidenceTypeId !== s.evidenceTypeId) mismatches.push('proofPlan.evidenceTypeId');
  if (candidate.proofPlan?.proofMode !== s.proofMode) mismatches.push('proofPlan.proofMode');

  const claims = candidate.proofPlan?.claims || [];
  if (claims.length !== 1 || claims[0]?.categoryId !== s.claimCategoryId) {
    mismatches.push('proofPlan.claims exact category multiplicity');
  }
  if (!sameArraySet((candidate.missionSteps || []).map((step) => step.outputCategoryId), [s.outputCategoryId])) {
    mismatches.push('missionSteps output-category set');
  }

  if (candidate.method?.id !== s.method.id) mismatches.push('method.id');
  if (candidate.method?.progressionIntent !== s.method.progressionIntent) mismatches.push('method.progressionIntent');

  if (candidate.intendedOutcome?.type !== s.measurableOutcome.type) mismatches.push('intendedOutcome.type');
  if (candidate.intendedOutcome?.targetId !== s.measurableOutcome.targetId) mismatches.push('intendedOutcome.targetId');

  if (candidate.missionStructure?.kind !== s.missionStructureKind) mismatches.push('missionStructure.kind');

  const versions = missionStructureVersions(candidate, s.effortBudget);
  const expectedVersionCount = candidate.missionStructure?.kind === 'fixed' ? 1 : 2;
  if (versions.length !== expectedVersionCount) {
    mismatches.push('missionStructure version count');
  } else {
    if (!versions.every(({ version }) => version.methodId === s.method.id)) mismatches.push('missionStructure methodId');
    if (!versions.every(({ version }) => version.outcomeType === s.measurableOutcome.type)) mismatches.push('missionStructure outcomeType');
    if (!versions.every(({ version }) => version.milestoneId === s.measurableOutcome.targetId)) mismatches.push('missionStructure milestoneId');
    if (!versions.every(({ version, expectedEffortUnits }) => version.effortUnits === expectedEffortUnits)) mismatches.push('missionStructure effortUnits');
  }

  const steps = candidate.missionSteps || [];
  const stepPlan = s.missionStepPlan;
  if (steps.length !== stepPlan.length) {
    mismatches.push('missionSteps count');
  } else {
    if (!steps.every((step, index) => step.id === stepPlan[index].id)) mismatches.push('missionSteps id sequence');
    if (!steps.every((step, index) => step.actionType === stepPlan[index].actionType)) mismatches.push('missionSteps actionType sequence');
    if (!steps.every((step, index) => step.outputCategoryId === stepPlan[index].outputCategoryId)) mismatches.push('missionSteps outputCategoryId sequence');
    if (!steps.every((step, index) => step.effortUnits === stepPlan[index].effortUnits)) mismatches.push('missionSteps effortUnits sequence');
  }

  if (candidate.estimatedMinutes !== s.timeBudgetMinutes) mismatches.push('estimatedMinutes/timeBudgetMinutes');
  if (!sameArraySet(candidate.requiredResourceIds, s.requiredResourceIds)) mismatches.push('requiredResourceIds');
  if (stableStringify(candidate.domainDetails || {}) !== stableStringify(s.domainDetailConstraints || {})) mismatches.push('domainDetails/domainDetailConstraints');
  if (stableStringify(candidate.professionalExecutionUnit || null) !== stableStringify(s.professionalExecutionUnit || null)) {
    mismatches.push('professionalExecutionUnit');
  }

  return mismatches;
}

/**
 * Checks that every candidate a provider returned fully and unambiguously
 * answers exactly one instruction in this exact batch, and reports which
 * one — the caller (response-validator.js) uses this to additionally
 * reject a second candidate that answers an instruction an earlier
 * candidate in the same response already claimed. A candidate that omits,
 * substitutes, weakens, or expands any structural requirement from its
 * brief — even while still claiming the right work unit — does not count
 * as a match: it is rejected the same as a candidate for a completely
 * different route. Never repairs a mismatch; only reports it.
 *
 * - Zero fully-matching instructions: rejected as unanswered (stale,
 *   cross-request, tampered, or fabricated).
 * - Exactly one fully-matching instruction: accepted; `instructionId` names
 *   which one, so a later duplicate claim can be detected by the caller.
 * - More than one fully-matching instruction: rejected as ambiguous — the
 *   candidate does not identify which brief it actually answers. This is
 *   normally structurally impossible (planCandidateBriefs already
 *   deduplicates briefs that share even the narrower legacy route
 *   signature, a strict subset of what is compared here), but is checked
 *   explicitly rather than assumed.
 *
 * @param {object[]} candidates
 * @param {object} instructions A compiled instruction batch (see compileProviderInstructions).
 * @returns {{valid: boolean, errors: string[], matches: {candidateId: (string|null), instructionId: (string|null), errors: string[]}[]}}
 */
export function verifyCandidatesAnswerInstructions(candidates, instructions) {
  const matches = candidates.map((candidate) => {
    const candidateId = candidate?.candidateId ?? null;

    if (candidate?.domainId !== instructions.domainId) {
      return {
        candidateId,
        instructionId: null,
        errors: [
          `candidate ${candidateId ?? '(unknown)'} domainId ${candidate?.domainId} does not match `
          + `instruction batch domainId ${instructions.domainId}`,
        ],
      };
    }

    const evaluated = instructions.instructions.map((instruction) => ({
      instruction,
      mismatches: structuralMismatches(candidate, instruction),
    }));
    const fullMatches = evaluated.filter((entry) => entry.mismatches.length === 0);

    if (fullMatches.length === 1) {
      return { candidateId, instructionId: fullMatches[0].instruction.instructionId, errors: [] };
    }

    if (fullMatches.length > 1) {
      return {
        candidateId,
        instructionId: null,
        errors: [
          `candidate ${candidateId} ambiguously fully matches ${fullMatches.length} instructions in batch `
          + `requestId=${instructions.requestId} instructionsHash=${instructions.instructionsHash} `
          + `(${fullMatches.map((entry) => entry.instruction.instructionId).join(', ')})`,
        ],
      };
    }

    const [closest] = [...evaluated].sort((a, b) => a.mismatches.length - b.mismatches.length);
    return {
      candidateId,
      instructionId: null,
      errors: [
        closest
          ? `candidate ${candidateId} does not fully match any instruction in batch requestId=${instructions.requestId} `
            + `instructionsHash=${instructions.instructionsHash}; closest instruction ${closest.instruction.instructionId} `
            + `differs in: ${closest.mismatches.join(', ')} (stale, cross-request, tampered, or fabricated candidate)`
          : `candidate ${candidateId} matches no instruction — instruction batch requestId=${instructions.requestId} `
            + `instructionsHash=${instructions.instructionsHash} contains zero instructions`,
      ],
    };
  });

  const errors = matches.flatMap((match) => match.errors);
  return { valid: errors.length === 0, errors, matches };
}
