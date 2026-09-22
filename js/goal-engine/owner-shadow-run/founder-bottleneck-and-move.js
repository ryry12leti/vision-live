/**
 * Owner-shadow-run — Founder Bottleneck Intelligence + Today's Move wiring.
 *
 * The read-only step this module adds to the owner-shadow response, per
 * spec section 18:
 *   ... -> derive Execution Context -> assess bottleneck -> plan multiple
 *   candidate briefs -> evaluate candidates -> compare candidates ->
 *   select one Today's Move -> return diagnostics.
 *
 * Live-cutover parity update: `decisionResult` is now ALSO computed here by
 * calling the exact same canonical js/goal-engine/founder-decision-service
 * the real live generate-tasks path calls (see
 * supabase/functions/_shared/founder-engine-bridge.mjs) -- same pure
 * functions, same inputs, so `decisionResult` is guaranteed identical to
 * what a real user with this exact trusted context would receive. Every
 * pre-existing field (bottleneckAssessment/candidateSummaries/
 * missionComparison/todaysMove) is preserved byte-for-byte so no existing
 * caller or QA assertion changes; decisionResult is purely additive.
 *
 * Deliberately independent of runOwnerShadowGoalEngine's own
 * trusted-context/generation-request pipeline (js/goal-engine/trusted-context,
 * candidate-generator) -- it only ever needs the same trusted Founder
 * Venture Snapshot, Founder Execution Entities bundle, and Founder
 * Execution Context the edge function already computes via
 * founder-venture-bridge.js. Pure and read-only: never calls a database,
 * never persists anything, never calls a model provider.
 */

import { assessFounderBottleneck, FounderBottleneckInputError } from '../founder-bottleneck/index.js';
import { planFounderMissionComparison, FounderMissionComparisonInputError } from '../founder-mission-comparison/index.js';
import { runFounderDecisionService, FounderDecisionServiceError } from '../founder-decision-service/index.js';

/**
 * @param {object} params
 * @param {object|null} params.snapshot A validated buildFounderGoalEngineSnapshot(...) output, or null when unavailable.
 * @param {object|null} params.entityBundle A validated buildFounderExecutionEntities(...) output, or null when unavailable.
 * @param {object|null} params.executionContext A validated buildFounderExecutionContext(...) output, or null when unavailable.
 * @param {string} params.evaluationTime ISO timestamp for "now".
 * @param {{title: string}[]} [params.recentTasks] Recent live task titles, read-only, for duplication detection only.
 * @param {object|null} [params.activeThread] The venture's current activeOutcomeThread value, for Right-Next-Move parity with the live path.
 * @param {object|null} [params.meaningfulEvent] A structured event to preview Right-Next-Move against.
 * @returns {{
 *   status: 'evaluated'|'not_available',
 *   reason: string|null,
 *   bottleneckAssessment: object|null,
 *   candidateCount: number,
 *   candidateSummaries: object[],
 *   missionComparison: object|null,
 *   todaysMove: object|null,
 *   decisionResult: object|null,
 * }}
 */
export function runFounderBottleneckAndTodaysMove({
  snapshot, entityBundle, executionContext, evaluationTime, recentTasks = [], activeThread = null, meaningfulEvent = null,
}) {
  if (!snapshot || !entityBundle || !executionContext) {
    return {
      status: 'not_available',
      reason: 'founder_context_not_available',
      bottleneckAssessment: null,
      candidateCount: 0,
      candidateSummaries: [],
      missionComparison: null,
      todaysMove: null,
      decisionResult: null,
    };
  }

  let bottleneckAssessment;
  try {
    bottleneckAssessment = assessFounderBottleneck({
      snapshot, entityBundle, executionContext, evaluationTime,
    });
  } catch (error) {
    const reason = error instanceof FounderBottleneckInputError ? error.code : 'decision_integrity_error';
    return {
      status: 'not_available', reason, bottleneckAssessment: null, candidateCount: 0, candidateSummaries: [], missionComparison: null, todaysMove: null, decisionResult: null,
    };
  }

  let candidates = [];
  let missionComparison = null;
  let todaysMove = null;
  try {
    const planned = planFounderMissionComparison({
      snapshot, entityBundle, executionContext, bottleneckAssessment, recentTasks,
    });
    candidates = planned.candidates;
    missionComparison = planned.comparisonResult;
    todaysMove = planned.todaysMove;
  } catch (error) {
    const reason = error instanceof FounderMissionComparisonInputError ? error.code : 'decision_integrity_error';
    return {
      status: 'not_available', reason, bottleneckAssessment: null, candidateCount: 0, candidateSummaries: [], missionComparison: null, todaysMove: null, decisionResult: null,
    };
  }

  // Same canonical engine as the live path (spec Phase 8: no separate
  // business logic). A failure here never hides the diagnostics already
  // computed above -- it only means decisionResult stays null and reports
  // why, exactly like every other optional field in this response.
  let decisionResult = null;
  try {
    decisionResult = runFounderDecisionService({
      snapshot, entityBundle, executionContext, evaluationTime, recentTasks, activeThread, meaningfulEvent,
    });
  } catch (error) {
    decisionResult = { error: error instanceof FounderDecisionServiceError ? error.code : 'decision_service_error' };
  }

  return {
    status: 'evaluated',
    reason: null,
    bottleneckAssessment,
    candidateCount: candidates.length,
    candidateSummaries: candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      routeId: candidate.routeId,
      bottleneckAlignment: candidate.bottleneckAlignment,
      title: candidate.title,
      timeEstimateMinutes: candidate.timeEstimateMinutes,
      effortLevel: candidate.effortLevel,
    })),
    missionComparison,
    todaysMove,
    decisionResult,
  };
}
