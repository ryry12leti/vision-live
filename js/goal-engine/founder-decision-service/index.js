/**
 * Founder Decision Service — public entry point.
 * See service.js and contract.js for the full contract.
 */

export {
  FOUNDER_DECISION_RESULT_VERSION,
  DECISION_STATUSES,
  validateFounderDecisionResult,
} from './contract.js';
export { runFounderDecisionService, FounderDecisionServiceError } from './service.js';
export {
  consumeOntologyContextForDecision, FounderOntologyContextError,
} from './ontology-context.js';
export { SKILL_LEVELS, BUSINESS_FUNCTIONS, assessFounderCapabilityLevel } from './skill-level.js';
export { adaptExecutionForSkillLevel } from './adaptation.js';
export {
  deriveFounderTaskHistory, summariseFounderAttempts, deriveFounderCompletionEvent,
  deriveFounderProspectsApprovedEvent, deriveFounderProspectsProgressEvent,
} from './task-history.js';
export { founderDecisionResultToLegacyTask } from './task-persistence-adapter.js';
export {
  evaluateFounderTaskQuality,
  resolveFounderTaskContentFacts,
  validateFounderTaskConcreteness,
  CHANNEL_QUESTION,
} from './task-quality-gate.js';
export {
  deriveCompletedWorkItemRecord,
  completedWorkItemEvent,
  WORK_ITEM_ROUTE_ID,
} from './work-item-completion.js';
