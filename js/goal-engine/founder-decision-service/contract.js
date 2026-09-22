/**
 * Founder Decision Service — the ONE canonical output contract used by both
 * the live real-user path and the owner shadow preview (spec Phase 2). No
 * separate shadow-only or live-only result shape exists; the owner preview
 * may display additional diagnostics on top of this exact object, never a
 * different one.
 */

export const FOUNDER_DECISION_RESULT_VERSION = 1;
export const DECISION_STATUSES = Object.freeze(['selected', 'clarification_required']);

const RESULT_FIELDS = Object.freeze([
  'contractVersion', 'status', 'ventureId', 'ventureRole', 'activeOutcome', 'currentBottleneck',
  'decisionType', 'todaysMove', 'completionDefinition', 'expectedOutcome', 'professionalStandard',
  'standardGuidance', 'requiredEvidence', 'learningSupport', 'guidanceLevel', 'relatedEntities',
  'taskVersion', 'stateUpdates', 'reasonForDecision', 'confidence', 'clarificationQuestions',
  /* The identity of each question in `clarificationQuestions`, in the same
     order. Present so no consumer has to recover a question's meaning from its
     English text -- see FOUNDER_QUESTION_CATALOG. */
  'clarificationQuestionsDetailed',
  'userSafeExplanation',
  /* Domain-neutral pointer to a stored evidence batch (decision-core/
     evidence-batch.js), or null when this mission references none -- which is
     most of them. Always PRESENT so `exactFields` stays exact; a mission that
     references no batch says so explicitly rather than by omission. */
  'evidenceBatchReference',
]);

const BOTTLENECK_FIELDS = Object.freeze(['category', 'label', 'score', 'reason']);
const TODAYS_MOVE_FIELDS = Object.freeze(['title', 'missionStatement', 'steps', 'timeEstimateMinutes', 'effortLevel']);
const STATE_UPDATES_FIELDS = Object.freeze(['activeOutcomeThread', 'entityFactUpdates']);

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

/**
 * @param {unknown} result
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateFounderDecisionResult(result) {
  const errors = [];
  if (!exactFields(result, RESULT_FIELDS, 'result', errors)) return { valid: false, errors };

  if (result.contractVersion !== FOUNDER_DECISION_RESULT_VERSION) errors.push(`result.contractVersion must be ${FOUNDER_DECISION_RESULT_VERSION}`);
  if (!DECISION_STATUSES.includes(result.status)) errors.push('result.status must be selected or clarification_required');
  if (!isNonEmptyString(result.ventureId)) errors.push('result.ventureId must be a non-empty string');
  if (!['primary', 'secondary'].includes(result.ventureRole)) errors.push('result.ventureRole must be primary or secondary');
  if (!Array.isArray(result.clarificationQuestions) || result.clarificationQuestions.length > 3) errors.push('result.clarificationQuestions must be an array of at most 3 questions');
  if (!Array.isArray(result.clarificationQuestionsDetailed)
    || result.clarificationQuestionsDetailed.length !== (result.clarificationQuestions || []).length
    || !result.clarificationQuestionsDetailed.every((entry, index) => isPlainObject(entry)
      && isNonEmptyString(entry.id) && Array.isArray(entry.factKeys)
      && entry.question === result.clarificationQuestions[index])) {
    errors.push('result.clarificationQuestionsDetailed must carry {id, factKeys, question} for every clarificationQuestions entry, in the same order');
  }
  if (!['high', 'medium', 'low'].includes(result.confidence)) errors.push('result.confidence must be high, medium, or low');
  if (!isPlainObject(result.stateUpdates) || !exactFields(result.stateUpdates, STATE_UPDATES_FIELDS, 'result.stateUpdates', errors)) {
    if (isPlainObject(result.stateUpdates)) exactFields(result.stateUpdates, STATE_UPDATES_FIELDS, 'result.stateUpdates', errors);
  }
  if (isPlainObject(result.stateUpdates)) {
    if (result.stateUpdates.activeOutcomeThread !== null && !isPlainObject(result.stateUpdates.activeOutcomeThread)) errors.push('result.stateUpdates.activeOutcomeThread must be null or a plain object');
    if (!Array.isArray(result.stateUpdates.entityFactUpdates)) errors.push('result.stateUpdates.entityFactUpdates must be an array');
  }
  if (!isNonEmptyString(result.reasonForDecision)) errors.push('result.reasonForDecision must be a non-empty string');

  if (result.status === 'clarification_required') {
    for (const field of ['activeOutcome', 'currentBottleneck', 'todaysMove', 'completionDefinition', 'expectedOutcome', 'professionalStandard', 'standardGuidance', 'requiredEvidence', 'learningSupport', 'guidanceLevel', 'relatedEntities', 'taskVersion', 'userSafeExplanation']) {
      if (result[field] !== null) errors.push(`result.${field} must be null when status is clarification_required`);
    }
    if (result.clarificationQuestions.length === 0) errors.push('result.clarificationQuestions must contain at least one question when status is clarification_required');
    return { valid: errors.length === 0, errors };
  }

  if (result.clarificationQuestions.length !== 0) errors.push('result.clarificationQuestions must be empty when status is selected');
  if (!isNonEmptyString(result.activeOutcome)) errors.push('result.activeOutcome must be a non-empty string when status is selected');
  if (!isNonEmptyString(result.decisionType) || !['start', 'keep', 'refine', 'replace'].includes(result.decisionType)) errors.push('result.decisionType must be start, keep, refine, or replace');
  if (!exactFields(result.currentBottleneck, BOTTLENECK_FIELDS, 'result.currentBottleneck', errors)) { /* errors already recorded */ }
  if (!exactFields(result.todaysMove, TODAYS_MOVE_FIELDS, 'result.todaysMove', errors)) { /* errors already recorded */ }
  if (isPlainObject(result.todaysMove)) {
    if (!isNonEmptyString(result.todaysMove.title)) errors.push('result.todaysMove.title must be a non-empty string');
    if (!isNonEmptyString(result.todaysMove.missionStatement)) errors.push('result.todaysMove.missionStatement must be a non-empty string');
    if (!Array.isArray(result.todaysMove.steps) || result.todaysMove.steps.length === 0) errors.push('result.todaysMove.steps must be a non-empty array');
    if (!Number.isFinite(result.todaysMove.timeEstimateMinutes) || result.todaysMove.timeEstimateMinutes <= 0) errors.push('result.todaysMove.timeEstimateMinutes must be a positive number');
    if (!['light', 'moderate', 'heavy'].includes(result.todaysMove.effortLevel)) errors.push('result.todaysMove.effortLevel is invalid');
  }
  if (!isNonEmptyString(result.completionDefinition)) errors.push('result.completionDefinition must be a non-empty string');
  if (!isNonEmptyString(result.expectedOutcome)) errors.push('result.expectedOutcome must be a non-empty string');
  if (!Array.isArray(result.professionalStandard) || result.professionalStandard.length === 0) errors.push('result.professionalStandard must be a non-empty array');
  if (result.standardGuidance !== null && !isNonEmptyString(result.standardGuidance)) errors.push('result.standardGuidance must be null or a non-empty string');
  if (!Array.isArray(result.requiredEvidence) || result.requiredEvidence.length === 0) errors.push('result.requiredEvidence must be a non-empty array');
  if (result.learningSupport !== null && !isNonEmptyString(result.learningSupport)) errors.push('result.learningSupport must be null or a non-empty string');
  if (!['beginner', 'developing', 'advanced'].includes(result.guidanceLevel)) errors.push('result.guidanceLevel must be beginner, developing, or advanced');
  if (!Array.isArray(result.relatedEntities)) errors.push('result.relatedEntities must be an array');
  if (!Number.isInteger(result.taskVersion) || result.taskVersion < 1) errors.push('result.taskVersion must be a positive integer');
  if (!isNonEmptyString(result.userSafeExplanation)) errors.push('result.userSafeExplanation must be a non-empty string');

  return { valid: errors.length === 0, errors };
}
