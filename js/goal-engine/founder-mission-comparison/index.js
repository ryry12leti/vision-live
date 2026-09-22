/**
 * Founder Mission Comparison / Today's Move — public entry point.
 * See assembler.js and contract.js for the full contract.
 */

export {
  FOUNDER_MISSION_COMPARISON_VERSION,
  EFFORT_LEVELS,
  SELECTION_TIE_MARGIN,
  validateCandidateBrief,
  validateCandidateEvaluation,
  validateMissionComparisonResult,
  validateTodaysMove,
} from './contract.js';
export { generateFounderCandidateBriefs } from './candidate-brief.js';
export { evaluateFounderCandidates, scoreFounderGoalAlignment } from './candidate-evaluation.js';
export { compareFounderCandidates } from './comparison.js';
export { selectFounderTodaysMove, minimumConfidence, humanReadableResourceLabels } from './todays-move.js';
export { planFounderMissionComparison, FounderMissionComparisonInputError } from './assembler.js';
export {
  RIGHT_NEXT_MOVE_VERSION,
  DECISIONS,
  CHANGE_SCOPES,
  RightNextMoveInputError,
  decideRightNextMove,
  recordCompletedStepOutcomeOpen,
  closeActiveOutcomeThread,
  supersedeActiveOutcome,
} from './right-next-move.js';

export {
  OUTCOME_RESOLUTION_VERSION,
  CRITERION_VERDICTS,
  PROPOSABLE_STATES,
  OutcomeResolutionError,
  verifyOutcomeResolutionProposal,
  resolveOutcomeFromProposal,
} from './outcome-resolution.js';

export {
  OUTCOME_CLOSURE_REQUESTS,
  OutcomeClosureError,
  resolveOutcomeClosure,
} from './outcome-closure.js';
