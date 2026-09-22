/**
 * Founder Mission Comparison — selection with deterministic tie-break.
 *
 * Mirrors the shape of mission-evaluator/evaluator.js's own
 * evaluateMissionCandidates() selection logic (score desc, then a fixed
 * tie-break, never a coin flip) at this layer's own dimension set, since
 * that evaluator operates on fully-resolved provider proposals rather than
 * on Founder candidate briefs and cannot be reused directly here (see
 * founder-bottleneck/contract.js's module header for why this whole path
 * stays independent of the generic trusted-context/provider pipeline).
 */

import { FOUNDER_MISSION_COMPARISON_VERSION, SELECTION_TIE_MARGIN } from './contract.js';

function rejectedSummary(candidate, evaluation) {
  return {
    candidateId: candidate.candidateId,
    routeId: candidate.routeId,
    title: candidate.title,
    reason: evaluation.rejectionReason,
  };
}

/**
 * @param {object[]} candidates From candidate-brief.js.
 * @param {object[]} evaluations From candidate-evaluation.js, same order/length as candidates.
 * @param {object} params {ventureId, sourceStateVersion, bottleneckAssessmentVersion}
 * @returns {object} A validated-shape MissionComparisonResult.
 */
export function compareFounderCandidates(candidates, evaluations, { ventureId, sourceStateVersion, bottleneckAssessmentVersion }) {
  const byId = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const comparedCandidateIds = candidates.map((candidate) => candidate.candidateId);
  const rejectedCandidates = evaluations
    .filter((evaluation) => evaluation.rejected)
    .map((evaluation) => rejectedSummary(byId.get(evaluation.candidateId), evaluation));

  const eligible = evaluations.filter((evaluation) => !evaluation.rejected);
  if (eligible.length === 0) {
    return {
      contractVersion: FOUNDER_MISSION_COMPARISON_VERSION,
      ventureId,
      sourceStateVersion,
      bottleneckAssessmentVersion,
      comparedCandidateIds,
      candidateEvaluations: evaluations,
      rejectedCandidates,
      selectedCandidateId: null,
      selectionConfidence: 'low',
      selectionMargin: null,
      tieBreakReason: 'not_applicable',
      explanation: candidates.length === 0
        ? 'No candidate could be generated: no eligible route addresses the assessed bottleneck.'
        : 'Every generated candidate was rejected by a hard gate; none can safely become Today\'s Move.',
    };
  }

  const sorted = [...eligible].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    const bottleneckDiff = b.dimensionScores.bottleneckAlignment - a.dimensionScores.bottleneckAlignment;
    if (bottleneckDiff !== 0) return bottleneckDiff;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.candidateId.localeCompare(b.candidateId);
  });

  const winner = sorted[0];
  const runnerUp = sorted[1] || null;
  const selectionMargin = runnerUp ? Math.round(winner.totalScore - runnerUp.totalScore) : Math.round(winner.totalScore);
  const isTie = Boolean(runnerUp) && Math.abs(winner.totalScore - runnerUp.totalScore) <= SELECTION_TIE_MARGIN;

  let tieBreakReason = 'not_applicable';
  if (isTie) {
    if (winner.dimensionScores.bottleneckAlignment !== runnerUp.dimensionScores.bottleneckAlignment) {
      tieBreakReason = 'higher bottleneck alignment';
    } else if (winner.confidence !== runnerUp.confidence) {
      tieBreakReason = 'higher confidence';
    } else {
      tieBreakReason = 'deterministic candidateId ordering (scores and confidence were equal)';
    }
  }

  const selectionConfidence = isTie
    ? 'low'
    : (runnerUp && selectionMargin <= 15 ? 'medium' : (winner.totalScore >= 60 ? 'high' : 'medium'));
  const userFacingTieReason = tieBreakReason === 'deterministic candidateId ordering (scores and confidence were equal)'
    ? 'a deterministic stable ordering because scores and confidence were equal'
    : tieBreakReason;

  return {
    contractVersion: FOUNDER_MISSION_COMPARISON_VERSION,
    ventureId,
    sourceStateVersion,
    bottleneckAssessmentVersion,
    comparedCandidateIds,
    candidateEvaluations: evaluations,
    rejectedCandidates,
    selectedCandidateId: winner.candidateId,
    selectionConfidence,
    selectionMargin,
    tieBreakReason,
    explanation: isTie
      ? `${byId.get(winner.candidateId).title} was selected over a close alternative via ${userFacingTieReason}.`
      : `${byId.get(winner.candidateId).title} was the best-supported available candidate across the comparison dimensions.`,
  };
}
