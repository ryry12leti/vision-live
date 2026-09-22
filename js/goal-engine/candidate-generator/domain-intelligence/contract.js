/**
 * Candidate Generation Checkpoint 2: the domain-intelligence brief contract.
 *
 * A `CandidateBrief` is the planner's strategic output — it names a route
 * (which canonical work unit, which trusted proof pairing, which method,
 * which measurable outcome) without ever assigning a score, confidence,
 * acceptance, or authority. The instruction compiler later turns each brief
 * into a complete candidate proposal matching the existing evaluator
 * contract (candidate-contract.js); the brief itself is never sent to the
 * evaluator and never bypasses response-validator.js.
 */

import { CandidateGenerationConfigError, isNonEmptyString, isPlainObject } from '../contract.js';
import { unionOfItemRequiredResources, validateProfessionalExecutionUnit } from '../../mission-evaluator/candidate-contract.js';

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const STRUCTURE_KINDS = new Set(['hard_medium', 'fixed']);

export const CANDIDATE_BRIEF_FIELDS = Object.freeze([
  'briefId',
  'strategyLens',
  'workUnitTypeId',
  'evidenceTypeId',
  'proofMode',
  'claimCategoryId',
  'outputCategoryId',
  'strategicReason',
  'method',
  'measurableOutcome',
  'missionStepPlan',
  'missionStructureKind',
  'timeBudgetMinutes',
  'effortBudget',
  'requiredResourceIds',
  'domainDetailConstraints',
  'professionalExecutionUnit',
]);

function validateIdentifier(value, path, errors) {
  if (!isNonEmptyString(value) || !IDENTIFIER_PATTERN.test(value)) {
    errors.push(`${path} must be a snake_case identifier`);
  }
}

function exactFields(value, required, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be a plain object`);
    return false;
  }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`missing required field: ${path}.${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!required.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  }
  return true;
}

/**
 * @param {unknown} brief
 * @param {object} request The exact generation request the brief was planned from.
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateCandidateBrief(brief, request) {
  const errors = [];
  if (!exactFields(brief, CANDIDATE_BRIEF_FIELDS, 'candidateBrief', errors)) {
    return { valid: false, errors };
  }

  validateIdentifier(brief.briefId, 'candidateBrief.briefId', errors);
  validateIdentifier(brief.strategyLens, 'candidateBrief.strategyLens', errors);
  validateIdentifier(brief.workUnitTypeId, 'candidateBrief.workUnitTypeId', errors);
  validateIdentifier(brief.evidenceTypeId, 'candidateBrief.evidenceTypeId', errors);
  validateIdentifier(brief.claimCategoryId, 'candidateBrief.claimCategoryId', errors);
  validateIdentifier(brief.outputCategoryId, 'candidateBrief.outputCategoryId', errors);
  if (!isNonEmptyString(brief.strategicReason)) errors.push('candidateBrief.strategicReason must be a non-empty string');

  const pairing = request?.validProofPairings?.find((item) => (
    item.workUnitTypeId === brief.workUnitTypeId && item.evidenceTypeId === brief.evidenceTypeId
  ));
  if (!pairing) {
    errors.push(`candidateBrief (${brief.workUnitTypeId}, ${brief.evidenceTypeId}) is not one of request.validProofPairings`);
  } else {
    if (brief.proofMode !== pairing.proofMode) errors.push('candidateBrief.proofMode must match the paired evidence type');
    if (!pairing.sharedClaimCategoryIds.includes(brief.claimCategoryId)) {
      errors.push('candidateBrief.claimCategoryId must be one of the pairing\'s sharedClaimCategoryIds');
    }
    if (!pairing.sharedOutputCategoryIds.includes(brief.outputCategoryId)) {
      errors.push('candidateBrief.outputCategoryId must be one of the pairing\'s sharedOutputCategoryIds');
    }
  }

  if (isPlainObject(brief.method)) {
    validateIdentifier(brief.method.id, 'candidateBrief.method.id', errors);
    if (!isNonEmptyString(brief.method.progressionIntent)) errors.push('candidateBrief.method.progressionIntent must be a non-empty string');
  } else {
    errors.push('candidateBrief.method must be a plain object');
  }

  if (isPlainObject(brief.measurableOutcome)) {
    validateIdentifier(brief.measurableOutcome.type, 'candidateBrief.measurableOutcome.type', errors);
    if (!isNonEmptyString(brief.measurableOutcome.targetId)) errors.push('candidateBrief.measurableOutcome.targetId must be a non-empty string');
    if (request && brief.measurableOutcome.targetId !== request.currentMilestone?.id) {
      errors.push('candidateBrief.measurableOutcome.targetId must equal request.currentMilestone.id');
    }
  } else {
    errors.push('candidateBrief.measurableOutcome must be a plain object');
  }

  if (!Array.isArray(brief.missionStepPlan) || brief.missionStepPlan.length < 2) {
    errors.push('candidateBrief.missionStepPlan must contain at least two steps');
  } else {
    for (const [index, step] of brief.missionStepPlan.entries()) {
      const path = `candidateBrief.missionStepPlan[${index}]`;
      if (!isPlainObject(step)) { errors.push(`${path} must be a plain object`); continue; }
      validateIdentifier(step.id, `${path}.id`, errors);
      validateIdentifier(step.actionType, `${path}.actionType`, errors);
      if (step.outputCategoryId !== brief.outputCategoryId) errors.push(`${path}.outputCategoryId must equal candidateBrief.outputCategoryId`);
      if (!Number.isFinite(step.effortUnits) || step.effortUnits < 1) errors.push(`${path}.effortUnits must be a number >= 1`);
    }
  }

  if (!STRUCTURE_KINDS.has(brief.missionStructureKind)) {
    errors.push('candidateBrief.missionStructureKind must be hard_medium or fixed');
  }

  if (!Number.isFinite(brief.timeBudgetMinutes) || brief.timeBudgetMinutes < 1) {
    errors.push('candidateBrief.timeBudgetMinutes must be a number >= 1');
  }
  if (request && brief.timeBudgetMinutes > request.availability.availableMinutes) {
    errors.push('candidateBrief.timeBudgetMinutes must not exceed request.availability.availableMinutes');
  }

  if (isPlainObject(brief.effortBudget)) {
    if (brief.missionStructureKind === 'hard_medium') {
      if (!Number.isFinite(brief.effortBudget.hard) || brief.effortBudget.hard < 1) errors.push('candidateBrief.effortBudget.hard must be a number >= 1');
      if (!Number.isFinite(brief.effortBudget.medium) || brief.effortBudget.medium < 1) errors.push('candidateBrief.effortBudget.medium must be a number >= 1');
      if (Number.isFinite(brief.effortBudget.hard) && Number.isFinite(brief.effortBudget.medium) && brief.effortBudget.medium >= brief.effortBudget.hard) {
        errors.push('candidateBrief.effortBudget.medium must be less than effortBudget.hard');
      }
    } else if (!Number.isFinite(brief.effortBudget.fixed) || brief.effortBudget.fixed < 1) {
      errors.push('candidateBrief.effortBudget.fixed must be a number >= 1');
    }
  } else {
    errors.push('candidateBrief.effortBudget must be a plain object');
  }
  if (request) {
    const ceiling = Math.min(request.effortLimits.capabilityMaxEffortUnits, request.effortLimits.recoveryMaxEffortUnits);
    const effort = brief.missionStructureKind === 'fixed' ? brief.effortBudget?.fixed : brief.effortBudget?.hard;
    if (Number.isFinite(effort) && effort > ceiling) {
      errors.push(`candidateBrief effort ${effort} exceeds the trusted capability/recovery ceiling ${ceiling}`);
    }
  }

  if (!Array.isArray(brief.requiredResourceIds)) {
    errors.push('candidateBrief.requiredResourceIds must be an array');
  } else if (request) {
    const unavailable = brief.requiredResourceIds.filter((id) => !request.availability.resourceIds.includes(id));
    if (unavailable.length > 0) errors.push(`candidateBrief.requiredResourceIds unavailable: ${unavailable.join(', ')}`);
  }

  if (!isPlainObject(brief.domainDetailConstraints)) errors.push('candidateBrief.domainDetailConstraints must be a plain object');

  const executionUnitResult = validateProfessionalExecutionUnit(brief.professionalExecutionUnit, request?.domainId);
  errors.push(...executionUnitResult.errors.map((error) => error.replace('candidateProposal.', 'candidateBrief.')));
  if (executionUnitResult.valid) {
    const unit = brief.professionalExecutionUnit;
    if (unit.estimatedMinutes !== brief.timeBudgetMinutes) {
      errors.push('candidateBrief.professionalExecutionUnit.estimatedMinutes must equal candidateBrief.timeBudgetMinutes');
    }
    if (unit.proofRequirement.evidenceTypeId !== brief.evidenceTypeId) {
      errors.push('candidateBrief.professionalExecutionUnit.proofRequirement.evidenceTypeId must equal candidateBrief.evidenceTypeId');
    }
    if (unit.proofRequirement.proofMode !== brief.proofMode) {
      errors.push('candidateBrief.professionalExecutionUnit.proofRequirement.proofMode must equal candidateBrief.proofMode');
    }
    if (Array.isArray(brief.requiredResourceIds)) {
      const itemUnion = unionOfItemRequiredResources(unit.items);
      const normalizedTopLevel = [...new Set(brief.requiredResourceIds)].sort();
      if (itemUnion === null || JSON.stringify(itemUnion) !== JSON.stringify(normalizedTopLevel)) {
        errors.push('candidateBrief.requiredResourceIds must equal the exact union of every professionalExecutionUnit item\'s requiredResourceIds');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function assertValidCandidateBrief(brief, request) {
  const result = validateCandidateBrief(brief, request);
  if (!result.valid) {
    throw new CandidateGenerationConfigError(`Invalid candidate brief produced by domain intelligence: ${result.errors.join('; ')}`);
  }
}

/**
 * Two briefs are meaningfully the same route when they share the same work
 * unit, evidence pairing, method, and mission-structure kind. Title/id/
 * wording differences do not make a route distinct.
 */
export function briefRouteSignature(brief) {
  return [
    brief.workUnitTypeId,
    brief.evidenceTypeId,
    brief.claimCategoryId,
    brief.outputCategoryId,
    brief.method.id,
    brief.missionStructureKind,
  ].join('|');
}
