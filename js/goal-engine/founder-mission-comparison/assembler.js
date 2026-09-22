/**
 * Founder Mission Comparison — top-level assembler.
 *
 * planFounderMissionComparison() is the single entry point: given the same
 * trusted Founder Venture Snapshot/Execution Entities/Execution Context
 * used to build a FounderBottleneckAssessment, plus that assessment itself,
 * it generates candidates, evaluates and compares them, and selects Today's
 * Move (or clarification_required). Cross-checks every input's identity/
 * version fields fail closed -- a wrong-venture or stale-version input can
 * never reach candidate generation or selection (spec QA cases 2-8, 47-48).
 * Read-only; never persists.
 */

import { FOUNDER_BOTTLENECK_ASSESSMENT_VERSION, validateFounderBottleneckAssessment } from '../founder-bottleneck/contract.js';
import { validateFounderGoalEngineSnapshot, validateFounderExecutionEntities } from '../founder-venture-state/index.js';
import { validateFounderExecutionContext } from '../founder-execution-context/index.js';
import {
  validateCandidateBrief, validateCandidateEvaluation, validateMissionComparisonResult, validateTodaysMove,
} from './contract.js';
import { generateFounderCandidateBriefs } from './candidate-brief.js';
import { evaluateFounderCandidates } from './candidate-evaluation.js';
import { compareFounderCandidates } from './comparison.js';
import { selectFounderTodaysMove } from './todays-move.js';

export class FounderMissionComparisonInputError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'FounderMissionComparisonInputError';
    this.code = code;
  }
}

function buildRouteAssessmentsById(bottleneckAssessment) {
  return Object.fromEntries(bottleneckAssessment.routeAssessments.map((route) => [route.routeId, route]));
}

/**
 * @param {object} params
 * @param {object} params.snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @param {object} params.entityBundle Trusted buildFounderExecutionEntities(...) output.
 * @param {object} params.executionContext Trusted buildFounderExecutionContext(...) output.
 * @param {object} params.bottleneckAssessment A validated FounderBottleneckAssessment (see js/goal-engine/founder-bottleneck).
 * @param {{title: string}[]} [params.recentTasks] Recent live task titles, read-only, used only for duplication detection.
 * @returns {{candidates: object[], comparisonResult: object, todaysMove: object}}
 */
export function planFounderMissionComparison({
  snapshot, entityBundle, executionContext, bottleneckAssessment, recentTasks = [], missionContext = null,
}) {
  if (!validateFounderGoalEngineSnapshot(snapshot).valid) throw new FounderMissionComparisonInputError('invalid_founder_snapshot');
  if (!validateFounderExecutionEntities(entityBundle, snapshot.ventureId, snapshot.ventureRole, snapshot.stateVersion).valid) {
    throw new FounderMissionComparisonInputError('invalid_execution_entities');
  }
  if (!validateFounderExecutionContext(executionContext, {
    ventureId: snapshot.ventureId, ventureRole: snapshot.ventureRole, stateVersion: snapshot.stateVersion,
  }).valid) throw new FounderMissionComparisonInputError('invalid_execution_context');
  if (!validateFounderBottleneckAssessment(bottleneckAssessment).valid) throw new FounderMissionComparisonInputError('invalid_bottleneck_assessment');
  if (snapshot.ventureId !== entityBundle.ventureId || snapshot.ventureId !== executionContext.ventureId || snapshot.ventureId !== bottleneckAssessment.ventureId) {
    throw new FounderMissionComparisonInputError('invalid_bottleneck_assessment');
  }
  if (snapshot.ventureRole !== 'primary' || entityBundle.ventureRole !== 'primary'
    || executionContext.ventureRole !== 'primary' || bottleneckAssessment.ventureRole !== 'primary') {
    throw new FounderMissionComparisonInputError('invalid_founder_snapshot');
  }
  if (snapshot.stateVersion !== entityBundle.sourceStateVersion
    || snapshot.stateVersion !== executionContext.snapshotStateVersion
    || snapshot.stateVersion !== bottleneckAssessment.sourceStateVersion) {
    throw new FounderMissionComparisonInputError('invalid_bottleneck_assessment');
  }
  if (bottleneckAssessment.contractVersion !== FOUNDER_BOTTLENECK_ASSESSMENT_VERSION) {
    throw new FounderMissionComparisonInputError('invalid_bottleneck_assessment');
  }
  const executionRoutes = new Map(executionContext.routeEvaluations.map((route) => [route.routeId, route]));
  if (bottleneckAssessment.routeAssessments.some((route) => {
    const source = executionRoutes.get(route.routeId);
    return !source || source.eligibility !== route.eligibility;
  })) throw new FounderMissionComparisonInputError('invalid_bottleneck_assessment');

  const candidates = generateFounderCandidateBriefs({
    snapshot, entityBundle, executionContext, bottleneckAssessment, missionContext,
  });
  const briefErrors = [];
  candidates.forEach((candidate, index) => validateCandidateBrief(candidate, index, briefErrors));
  if (briefErrors.length > 0) throw new FounderMissionComparisonInputError('invalid_candidate_brief');

  const routeAssessmentsById = buildRouteAssessmentsById(bottleneckAssessment);
  const evaluations = evaluateFounderCandidates(candidates, {
    ventureId: snapshot.ventureId, snapshot, bottleneckAssessment, routeAssessmentsById, recentTasks,
  });
  const evaluationErrors = [];
  evaluations.forEach((evaluation, index) => validateCandidateEvaluation(evaluation, index, evaluationErrors));
  if (evaluationErrors.length > 0) throw new FounderMissionComparisonInputError('invalid_candidate_evaluation');

  const comparisonResult = compareFounderCandidates(candidates, evaluations, {
    ventureId: snapshot.ventureId,
    sourceStateVersion: snapshot.stateVersion,
    bottleneckAssessmentVersion: bottleneckAssessment.contractVersion,
  });
  if (!validateMissionComparisonResult(comparisonResult).valid) throw new FounderMissionComparisonInputError('invalid_mission_comparison');

  const todaysMove = selectFounderTodaysMove({
    snapshot, executionContext, bottleneckAssessment, candidates, comparisonResult,
  });
  if (!validateTodaysMove(todaysMove).valid) throw new FounderMissionComparisonInputError('invalid_todays_move');

  return { candidates, comparisonResult, todaysMove };
}
