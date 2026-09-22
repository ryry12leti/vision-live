/**
 * Founder Mission Comparison / Today's Move — shared vocabulary and
 * contract.
 *
 * Consumes (never mutates) a trusted Founder Venture Snapshot, Founder
 * Execution Entities bundle, Founder Execution Context, and a
 * FounderBottleneckAssessment (js/goal-engine/founder-bottleneck). Produces
 * candidate briefs, a MissionComparisonResult, and (when justified) exactly
 * one Today's Move -- read-only, never persisted (persistedTaskId is always
 * null; see assembler.js/todays-move.js).
 */

export const FOUNDER_MISSION_COMPARISON_VERSION = 1;

export const EFFORT_LEVELS = Object.freeze(['light', 'moderate', 'heavy']);

// Candidates within this many total-score points of the leader are a
// genuine tie for Today's Move selection (mirrors
// mission-evaluator/rubric.js's own STRATEGIC_TIE_MARGIN=2 concept at this
// layer's own 0-100 scale).
export const SELECTION_TIE_MARGIN = 5;

const CANDIDATE_BRIEF_FIELDS = Object.freeze([
  'candidateId', 'routeId', 'businessFunction', 'bottleneckCategory', 'bottleneckAlignment',
  'identifierFields', 'resourceBindings', 'requiredResourceIds', 'missingResourceIds', 'steps',
  'timeEstimateMinutes', 'effortLevel', 'requiredEvidence', 'title', 'missionStatement', 'whyNow',
  'expectedBusinessOutcome', 'completionDefinition', 'professionalStandard', 'learningSupport',
]);

const CANDIDATE_EVALUATION_FIELDS = Object.freeze([
  'candidateId', 'routeId', 'dimensionScores', 'totalScore', 'rejected', 'rejectionReason', 'confidence',
]);

const DIMENSION_SCORE_FIELDS = Object.freeze([
  'bottleneckAlignment', 'goalAlignment', 'specificity', 'businessValue', 'dependencyUnlock', 'evidenceGain',
  'feasibilityToday', 'resourceAvailability', 'requiredEffort', 'risk', 'proofability', 'duplicationPenalty',
  'consistencyWithTrustedState',
]);

const COMPARISON_RESULT_FIELDS = Object.freeze([
  'contractVersion', 'ventureId', 'sourceStateVersion', 'bottleneckAssessmentVersion', 'comparedCandidateIds',
  'candidateEvaluations', 'rejectedCandidates', 'selectedCandidateId', 'selectionConfidence', 'selectionMargin',
  'tieBreakReason', 'explanation',
]);

const TODAYS_MOVE_FIELDS = Object.freeze([
  'status', 'selectedCandidateId', 'ventureId', 'ventureRole', 'routeId', 'businessFunction', 'bottleneckId',
  'title', 'missionStatement', 'whyNow', 'expectedBusinessOutcome', 'completionDefinition', 'requiredResources',
  'missingResources', 'timeEstimate', 'effortLevel', 'requiredEvidence', 'deadline', 'confidence',
  'selectionExplanation', 'rejectedAlternativeSummaries', 'clarificationQuestions', 'clarificationQuestionsDetailed', 'persistedTaskId',
  'overrideReadiness', 'professionalStandard', 'learningSupport',
]);

const OVERRIDE_READINESS_FIELDS = Object.freeze([
  'systemSelectedCandidateId', 'userSelectedCandidateId', 'overrideReason', 'timestamp',
  'bottleneckAssessmentChanged', 'executionOrderOnlyChanged',
]);
const STEP_FIELDS = Object.freeze(['order', 'label', 'actionType', 'referenceId']);
const REJECTED_CANDIDATE_FIELDS = Object.freeze(['candidateId', 'routeId', 'title', 'reason']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function exactFields(value, required, path, errors) {
  if (!isPlainObject(value)) { errors.push(`${path} must be a plain object`); return false; }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`missing required field: ${path}.${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!required.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  }
  return required.every((field) => Object.hasOwn(value, field));
}
function isScore(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

export function validateCandidateBrief(brief, index, errors) {
  const path = `candidates[${index}]`;
  if (!exactFields(brief, CANDIDATE_BRIEF_FIELDS, path, errors)) return;
  if (!isNonEmptyString(brief.candidateId)) errors.push(`${path}.candidateId must be a non-empty string`);
  if (!isNonEmptyString(brief.routeId)) errors.push(`${path}.routeId must be a non-empty string`);
  if (!isNonEmptyString(brief.businessFunction)) errors.push(`${path}.businessFunction must be a non-empty string`);
  if (!isNonEmptyString(brief.bottleneckCategory)) errors.push(`${path}.bottleneckCategory must be a non-empty string`);
  if (!['primary', 'secondary'].includes(brief.bottleneckAlignment)) errors.push(`${path}.bottleneckAlignment must be primary or secondary`);
  if (!isPlainObject(brief.identifierFields)) errors.push(`${path}.identifierFields must be a plain object`);
  if (!isPlainObject(brief.resourceBindings)) errors.push(`${path}.resourceBindings must be a plain object`);
  if (!Array.isArray(brief.steps) || brief.steps.length === 0) errors.push(`${path}.steps must be a non-empty array`);
  else brief.steps.forEach((step, stepIndex) => {
    const stepPath = `${path}.steps[${stepIndex}]`;
    if (!exactFields(step, STEP_FIELDS, stepPath, errors)) return;
    if (!Number.isInteger(step.order) || step.order !== stepIndex + 1) errors.push(`${stepPath}.order must be sequential`);
    for (const field of ['label', 'actionType', 'referenceId']) if (!isNonEmptyString(step[field])) errors.push(`${stepPath}.${field} must be a non-empty string`);
  });
  if (!Number.isFinite(brief.timeEstimateMinutes) || brief.timeEstimateMinutes <= 0) errors.push(`${path}.timeEstimateMinutes must be a positive number`);
  if (!EFFORT_LEVELS.includes(brief.effortLevel)) errors.push(`${path}.effortLevel is invalid`);
  if (!Array.isArray(brief.requiredEvidence) || brief.requiredEvidence.length === 0) errors.push(`${path}.requiredEvidence must be a non-empty array`);
  for (const field of ['title', 'missionStatement', 'whyNow', 'expectedBusinessOutcome', 'completionDefinition']) {
    if (!isNonEmptyString(brief[field])) errors.push(`${path}.${field} must be a non-empty string`);
  }
  if (!Array.isArray(brief.requiredResourceIds) || !brief.requiredResourceIds.every(isNonEmptyString)) errors.push(`${path}.requiredResourceIds must be an array of non-empty strings`);
  if (!Array.isArray(brief.missingResourceIds) || !brief.missingResourceIds.every(isNonEmptyString)) errors.push(`${path}.missingResourceIds must be an array of non-empty strings`);
  if (!Array.isArray(brief.professionalStandard) || brief.professionalStandard.length === 0 || !brief.professionalStandard.every(isNonEmptyString)) errors.push(`${path}.professionalStandard must be a non-empty array of non-empty strings`);
  if (brief.learningSupport !== null && !isNonEmptyString(brief.learningSupport)) errors.push(`${path}.learningSupport must be null or a non-empty string`);
}

export function validateCandidateEvaluation(evaluation, index, errors) {
  const path = `candidateEvaluations[${index}]`;
  if (!exactFields(evaluation, CANDIDATE_EVALUATION_FIELDS, path, errors)) return;
  if (!isNonEmptyString(evaluation.candidateId)) errors.push(`${path}.candidateId must be a non-empty string`);
  if (!isNonEmptyString(evaluation.routeId)) errors.push(`${path}.routeId must be a non-empty string`);
  if (!exactFields(evaluation.dimensionScores, DIMENSION_SCORE_FIELDS, `${path}.dimensionScores`, errors)) return;
  for (const dim of DIMENSION_SCORE_FIELDS) {
    if (!isScore(evaluation.dimensionScores[dim])) errors.push(`${path}.dimensionScores.${dim} must be a number from 0 to 100`);
  }
  if (!isScore(evaluation.totalScore)) errors.push(`${path}.totalScore must be a number from 0 to 100`);
  if (typeof evaluation.rejected !== 'boolean') errors.push(`${path}.rejected must be a boolean`);
  if (evaluation.rejected && !isNonEmptyString(evaluation.rejectionReason)) errors.push(`${path}.rejectionReason must be a non-empty string when rejected`);
  if (!evaluation.rejected && evaluation.rejectionReason !== null) errors.push(`${path}.rejectionReason must be null when not rejected`);
  if (!Number.isFinite(evaluation.confidence) || evaluation.confidence < 0 || evaluation.confidence > 1) errors.push(`${path}.confidence must be a number from 0 to 1`);
}

export function validateMissionComparisonResult(result) {
  const errors = [];
  if (!exactFields(result, COMPARISON_RESULT_FIELDS, 'result', errors)) return { valid: false, errors };
  if (result.contractVersion !== FOUNDER_MISSION_COMPARISON_VERSION) errors.push(`result.contractVersion must be ${FOUNDER_MISSION_COMPARISON_VERSION}`);
  if (!isNonEmptyString(result.ventureId)) errors.push('result.ventureId must be a non-empty string');
  if (!Number.isInteger(result.sourceStateVersion) || result.sourceStateVersion < 1) errors.push('result.sourceStateVersion must be a positive integer');
  if (!Number.isInteger(result.bottleneckAssessmentVersion) || result.bottleneckAssessmentVersion < 1) errors.push('result.bottleneckAssessmentVersion must be a positive integer');
  if (!Array.isArray(result.comparedCandidateIds) || !result.comparedCandidateIds.every(isNonEmptyString)) errors.push('result.comparedCandidateIds must be an array of non-empty strings');
  else if (new Set(result.comparedCandidateIds).size !== result.comparedCandidateIds.length) errors.push('result.comparedCandidateIds contains duplicates');
  if (!Array.isArray(result.candidateEvaluations)) {
    errors.push('result.candidateEvaluations must be an array');
  } else {
    result.candidateEvaluations.forEach((evaluation, index) => validateCandidateEvaluation(evaluation, index, errors));
    const evaluationIds = result.candidateEvaluations.map((evaluation) => evaluation?.candidateId);
    if (new Set(evaluationIds).size !== evaluationIds.length) errors.push('result.candidateEvaluations contains duplicate candidateId values');
    if (Array.isArray(result.comparedCandidateIds)
      && (evaluationIds.length !== result.comparedCandidateIds.length
        || evaluationIds.some((id) => !result.comparedCandidateIds.includes(id)))) {
      errors.push('result.candidateEvaluations must correspond exactly to comparedCandidateIds');
    }
  }
  if (!Array.isArray(result.rejectedCandidates)) errors.push('result.rejectedCandidates must be an array');
  else result.rejectedCandidates.forEach((candidate, index) => {
    const path = `result.rejectedCandidates[${index}]`;
    if (!exactFields(candidate, REJECTED_CANDIDATE_FIELDS, path, errors)) return;
    for (const field of REJECTED_CANDIDATE_FIELDS) if (!isNonEmptyString(candidate[field])) errors.push(`${path}.${field} must be a non-empty string`);
  });
  if (result.selectedCandidateId !== null && !isNonEmptyString(result.selectedCandidateId)) errors.push('result.selectedCandidateId must be null or a non-empty string');
  if (!['high', 'medium', 'low'].includes(result.selectionConfidence)) errors.push('result.selectionConfidence must be high, medium, or low');
  if (result.selectionMargin !== null && !Number.isFinite(result.selectionMargin)) errors.push('result.selectionMargin must be null or a number');
  if (!isNonEmptyString(result.tieBreakReason)) errors.push('result.tieBreakReason must be a non-empty string');
  if (!isNonEmptyString(result.explanation)) errors.push('result.explanation must be a non-empty string');
  if (result.selectedCandidateId === null && result.selectionMargin !== null) errors.push('result.selectionMargin must be null when no candidate was selected');
  if (result.selectedCandidateId !== null && (!Array.isArray(result.comparedCandidateIds) || !result.comparedCandidateIds.includes(result.selectedCandidateId))) errors.push('result.selectedCandidateId must be one of comparedCandidateIds');
  const selectedEvaluation = Array.isArray(result.candidateEvaluations)
    ? result.candidateEvaluations.find((evaluation) => evaluation.candidateId === result.selectedCandidateId) : null;
  if (selectedEvaluation?.rejected) errors.push('result.selectedCandidateId cannot identify a rejected candidate');
  return { valid: errors.length === 0, errors };
}

export function validateOverrideReadiness(value, path, errors) {
  if (!exactFields(value, OVERRIDE_READINESS_FIELDS, path, errors)) return;
  if (value.systemSelectedCandidateId !== null && !isNonEmptyString(value.systemSelectedCandidateId)) errors.push(`${path}.systemSelectedCandidateId must be null or a non-empty string`);
  if (value.userSelectedCandidateId !== null) errors.push(`${path}.userSelectedCandidateId must be null (no override has occurred)`);
  if (value.overrideReason !== null) errors.push(`${path}.overrideReason must be null (no override has occurred)`);
  if (value.timestamp !== null) errors.push(`${path}.timestamp must be null (no override has occurred)`);
  if (typeof value.bottleneckAssessmentChanged !== 'boolean') errors.push(`${path}.bottleneckAssessmentChanged must be a boolean`);
  if (typeof value.executionOrderOnlyChanged !== 'boolean') errors.push(`${path}.executionOrderOnlyChanged must be a boolean`);
}

export function validateTodaysMove(move) {
  const errors = [];
  if (!exactFields(move, TODAYS_MOVE_FIELDS, 'move', errors)) return { valid: false, errors };
  if (!['selected', 'clarification_required'].includes(move.status)) errors.push('move.status must be selected or clarification_required');
  if (!isNonEmptyString(move.ventureId)) errors.push('move.ventureId must be a non-empty string');
  if (!['primary', 'secondary'].includes(move.ventureRole)) errors.push('move.ventureRole must be primary or secondary');
  if (move.persistedTaskId !== null) errors.push('move.persistedTaskId must always be null (this path never persists)');
  if (!Array.isArray(move.clarificationQuestions) || move.clarificationQuestions.length > 3) errors.push('move.clarificationQuestions must be an array of at most 3 questions');
  /* Identity, in lockstep with the text. A question that reaches a client
     without its id is the exact defect FOUNDER_QUESTION_CATALOG exists to
     prevent, so the contract refuses the half-populated shape outright. */
  if (!Array.isArray(move.clarificationQuestionsDetailed)
    || move.clarificationQuestionsDetailed.length !== (move.clarificationQuestions || []).length
    || !move.clarificationQuestionsDetailed.every((entry, index) => isPlainObject(entry)
      && isNonEmptyString(entry.id) && Array.isArray(entry.factKeys)
      && entry.question === move.clarificationQuestions[index])) {
    errors.push('move.clarificationQuestionsDetailed must carry {id, factKeys, question} for every clarificationQuestions entry, in the same order');
  }
  if (!Array.isArray(move.rejectedAlternativeSummaries)) errors.push('move.rejectedAlternativeSummaries must be an array');
  if (move.overrideReadiness !== null) validateOverrideReadiness(move.overrideReadiness, 'move.overrideReadiness', errors);

  if (move.status === 'clarification_required') {
    for (const field of ['selectedCandidateId', 'routeId', 'businessFunction', 'bottleneckId', 'title', 'missionStatement', 'whyNow', 'expectedBusinessOutcome', 'completionDefinition', 'deadline', 'requiredResources', 'missingResources', 'timeEstimate', 'effortLevel', 'requiredEvidence', 'confidence', 'professionalStandard', 'learningSupport']) {
      if (move[field] !== null) errors.push(`move.${field} must be null when status is clarification_required`);
    }
    if (move.clarificationQuestions.length === 0) errors.push('move.clarificationQuestions must contain at least one question when status is clarification_required');
    if (!isNonEmptyString(move.selectionExplanation)) errors.push('move.selectionExplanation must explain why no move was selected');
    if (move.overrideReadiness !== null) errors.push('move.overrideReadiness must be null when status is clarification_required');
  } else {
    if (!isNonEmptyString(move.selectedCandidateId)) errors.push('move.selectedCandidateId must be a non-empty string when status is selected');
    if (!isNonEmptyString(move.routeId)) errors.push('move.routeId must be a non-empty string when status is selected');
    if (!isNonEmptyString(move.businessFunction)) errors.push('move.businessFunction must be a non-empty string when status is selected');
    if (!isNonEmptyString(move.bottleneckId)) errors.push('move.bottleneckId must be a non-empty string when status is selected');
    for (const field of ['title', 'missionStatement', 'whyNow', 'expectedBusinessOutcome', 'completionDefinition', 'selectionExplanation']) {
      if (!isNonEmptyString(move[field])) errors.push(`move.${field} must be a non-empty string when status is selected`);
    }
    if (!Array.isArray(move.requiredResources)) errors.push('move.requiredResources must be an array');
    if (!Array.isArray(move.missingResources)) errors.push('move.missingResources must be an array');
    if (move.deadline !== null) errors.push('move.deadline must be null unless trusted deadline evidence is supported');
    if (!Number.isFinite(move.timeEstimate) || move.timeEstimate <= 0) errors.push('move.timeEstimate must be a positive number when status is selected');
    if (!EFFORT_LEVELS.includes(move.effortLevel)) errors.push('move.effortLevel is invalid');
    if (!Array.isArray(move.requiredEvidence) || move.requiredEvidence.length === 0) errors.push('move.requiredEvidence must be a non-empty array when status is selected');
    if (!['high', 'medium', 'low'].includes(move.confidence)) errors.push('move.confidence must be high, medium, or low when status is selected');
    if (move.clarificationQuestions.length !== 0) errors.push('move.clarificationQuestions must be empty when status is selected');
    if (!Array.isArray(move.professionalStandard) || move.professionalStandard.length === 0 || !move.professionalStandard.every(isNonEmptyString)) errors.push('move.professionalStandard must be a non-empty array of non-empty strings when status is selected');
    if (move.learningSupport !== null && !isNonEmptyString(move.learningSupport)) errors.push('move.learningSupport must be null or a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}
