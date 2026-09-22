import { getDomainPack } from '../domain-packs/registry.js';
import { validateMissionEvaluationInput } from './candidate-contract.js';
import { calculateMissionConfidence } from './confidence.js';
import { evaluateDomainRules } from './domain-evaluators.js';
import { createEvidenceResolver } from './evidence.js';
import { evaluateHardGates } from './hard-gates.js';
import { emptyDimensionScores, scoreMissionCandidate } from './rubric.js';

export const MISSION_ACCEPTANCE_SCORE = 75;
export const MISSION_ACCEPTANCE_CONFIDENCE = 0.70;
export const STRATEGIC_TIE_MARGIN = 2;

export const MISSION_EVALUATION_STATES = Object.freeze([
  'accepted',
  'rejected',
  'clarification_required',
  'domain_not_ready',
  'missing_prerequisite',
  'blocked',
  'recovery_required',
]);

const FAILURE_STATE_PRIORITY = Object.freeze([
  'blocked',
  'domain_not_ready',
  'clarification_required',
  'missing_prerequisite',
  'recovery_required',
  'rejected',
]);

function unique(values) {
  return [...new Set(values)];
}

function contractQuestions(errors) {
  return errors.slice(0, 5).map((error) => `Can you provide valid ${error.replace(/^missing required field:\s*/, '')}?`);
}

function derivedClarificationQuestions(pack, domainRuleResults, unresolvedEvidenceIds) {
  const questions = [];
  if (unresolvedEvidenceIds.length > 0) {
    questions.push(`Can you provide verified evidence for: ${unresolvedEvidenceIds.join(', ')}?`);
  }
  for (const rule of domainRuleResults) {
    if (rule.clarificationRequired && rule.reasons.length > 0) {
      questions.push(`Can you clarify ${rule.reasons[0].replace(/\.$/, '').toLowerCase()}?`);
    }
  }
  if (questions.length === 0 && pack) {
    questions.push(...pack.clarificationTriggers.map((trigger) => trigger.description));
  }
  return unique(questions).slice(0, 5);
}

function invalidEvaluation(trustedContext, proposal, errors) {
  return Object.freeze({
    candidateId: typeof proposal?.candidateId === 'string' ? proposal.candidateId : null,
    rawScore: 0,
    totalScore: 0,
    scoreStatus: 'invalid_contract',
    gatedBy: Object.freeze(['evaluation_contract']),
    dimensionScores: emptyDimensionScores(),
    confidence: 0,
    confidenceFactors: Object.freeze({}),
    domainRuleResults: Object.freeze([]),
    hardGateResults: Object.freeze([Object.freeze({
      id: 'evaluation_contract',
      label: 'Trusted-context and candidate-proposal contract',
      essential: true,
      applicable: true,
      passed: false,
      reason: errors.join('; '),
      failureState: 'clarification_required',
    })]),
    unresolvedEvidenceIds: Object.freeze([]),
    rejectionReasons: Object.freeze([...errors]),
    clarificationQuestions: Object.freeze(contractQuestions(errors)),
    finalState: 'clarification_required',
  });
}

function freezeEvaluation(value) {
  Object.freeze(value.rejectionReasons);
  Object.freeze(value.clarificationQuestions);
  Object.freeze(value.unresolvedEvidenceIds);
  return Object.freeze(value);
}

function evaluateCore(trustedContext, proposal, { preferenceEligible = false } = {}) {
  const contract = validateMissionEvaluationInput(trustedContext, proposal);
  if (!contract.valid) return invalidEvaluation(trustedContext, proposal, contract.errors);

  const pack = getDomainPack(proposal.domainId);
  const evidence = createEvidenceResolver(trustedContext, proposal);
  const domainRuleResults = evaluateDomainRules(trustedContext, proposal, pack, evidence);
  const scoring = scoreMissionCandidate(
    trustedContext,
    proposal,
    pack,
    domainRuleResults,
    evidence,
    { preferenceEligible },
  );
  const confidenceResult = calculateMissionConfidence(
    trustedContext,
    proposal,
    pack,
    domainRuleResults,
    evidence,
  );
  const hardGateResults = evaluateHardGates(
    trustedContext,
    proposal,
    pack,
    domainRuleResults,
    scoring,
    evidence,
  );
  const failedGates = hardGateResults.filter((gate) => gate.essential && !gate.passed);
  const failedDomainRules = domainRuleResults.filter((rule) => !rule.passed);
  const gatedBy = unique([
    ...failedGates.map((gate) => gate.id),
    ...failedDomainRules.map((rule) => rule.ruleId),
  ]);
  const rawScore = scoring.totalScore;
  const scoreStatus = gatedBy.length > 0 ? 'gated' : 'eligible';
  const totalScore = scoreStatus === 'gated' ? Math.min(rawScore, 74.99) : rawScore;
  const failedDomainReasons = domainRuleResults
    .filter((rule) => !rule.passed)
    .flatMap((rule) => rule.reasons.map((reason) => `${rule.ruleId}: ${reason}`));
  const rejectionReasons = unique([
    ...failedGates.map((gate) => gate.reason),
    ...failedDomainReasons,
  ]);
  let finalState = 'accepted';

  for (const state of FAILURE_STATE_PRIORITY) {
    if (failedGates.some((gate) => gate.failureState === state)) {
      finalState = state;
      break;
    }
  }
  if (failedGates.length === 0 && totalScore < MISSION_ACCEPTANCE_SCORE) {
    finalState = 'rejected';
    rejectionReasons.push(`Total score ${totalScore} is below ${MISSION_ACCEPTANCE_SCORE}`);
  }
  if (failedGates.length === 0 && confidenceResult.confidence < MISSION_ACCEPTANCE_CONFIDENCE) {
    finalState = 'rejected';
    rejectionReasons.push(
      `Confidence ${confidenceResult.confidence.toFixed(2)} is below ${MISSION_ACCEPTANCE_CONFIDENCE.toFixed(2)}`,
    );
  }

  const unresolvedEvidenceIds = evidence.unresolvedProposalIds();
  const clarificationQuestions = finalState === 'clarification_required'
    ? derivedClarificationQuestions(pack, domainRuleResults, unresolvedEvidenceIds)
    : [];

  return freezeEvaluation({
    candidateId: proposal.candidateId,
    rawScore,
    totalScore,
    scoreStatus,
    gatedBy: Object.freeze(gatedBy),
    dimensionScores: scoring.dimensionScores,
    confidence: confidenceResult.confidence,
    confidenceFactors: confidenceResult.factors,
    domainRuleResults,
    hardGateResults,
    unresolvedEvidenceIds,
    rejectionReasons: unique(rejectionReasons),
    clarificationQuestions,
    finalState,
  });
}

/**
 * Evaluate one proposal against separately supplied trusted context.
 */
export function evaluateMissionCandidate(trustedContext, candidateProposal) {
  return evaluateCore(trustedContext, candidateProposal);
}

function failureStateForEvaluations(evaluations) {
  for (const state of FAILURE_STATE_PRIORITY) {
    if (evaluations.some((evaluation) => evaluation.finalState === state)) return state;
  }
  return 'rejected';
}

/**
 * Evaluate a proposal set, applying verified preferences only to candidates
 * within the deterministic strategic tie margin.
 */
export function evaluateMissionCandidates(trustedContext, candidateProposals) {
  if (!Array.isArray(candidateProposals) || candidateProposals.length === 0) {
    return Object.freeze({
      selectedCandidateId: null,
      evaluations: Object.freeze([]),
      finalState: 'clarification_required',
      rejectionReasons: Object.freeze(['No mission candidates were provided']),
    });
  }

  const baseEvaluations = candidateProposals.map((proposal) => evaluateCore(trustedContext, proposal));
  const eligibleBase = baseEvaluations.filter(
    (evaluation) => evaluation.finalState === 'accepted',
  );
  const highestStrategicScore = eligibleBase.length
    ? Math.max(...eligibleBase.map((evaluation) => evaluation.totalScore))
    : 0;
  const tieIndexes = baseEvaluations
    .map((evaluation, index) => ({ evaluation, index }))
    .filter(({ evaluation }) => (
      evaluation.finalState === 'accepted'
      && Math.abs(highestStrategicScore - evaluation.totalScore) <= STRATEGIC_TIE_MARGIN
    ))
    .map(({ index }) => index);
  const hasStrategicTie = tieIndexes.length >= 2;
  const evaluations = candidateProposals.map((proposal, index) => (
    hasStrategicTie && tieIndexes.includes(index)
      ? evaluateCore(trustedContext, proposal, { preferenceEligible: true })
      : baseEvaluations[index]
  ));

  const accepted = evaluations
    .filter((evaluation) => evaluation.finalState === 'accepted')
    .sort((left, right) => (
      right.totalScore - left.totalScore
      || right.confidence - left.confidence
      || left.candidateId.localeCompare(right.candidateId)
    ));

  if (accepted.length === 0) {
    return Object.freeze({
      selectedCandidateId: null,
      evaluations: Object.freeze(evaluations),
      finalState: failureStateForEvaluations(evaluations),
      rejectionReasons: Object.freeze(['No candidate passed the full Visibility Gate']),
    });
  }

  return Object.freeze({
    selectedCandidateId: accepted[0].candidateId,
    evaluations: Object.freeze(evaluations),
    finalState: 'accepted',
    rejectionReasons: Object.freeze([]),
  });
}
