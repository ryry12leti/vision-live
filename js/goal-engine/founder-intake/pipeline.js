/**
 * Founder Intake — synthetic-state pipeline.
 *
 * Wires intake-derived facts through the EXACT SAME reducer/snapshot/
 * bottleneck/mission-comparison chain goal-engine-shadow-run already uses
 * for a real user (see js/goal-engine/owner-shadow-run/), substituting a
 * synthetic in-memory `{venture_id, venture_role, state}` for the real
 * DB-row-shaped one. None of founder-bottleneck/, founder-mission-
 * comparison/, founder-execution-context/, or the fact-ledger/snapshot
 * modules are modified -- this file only assembles their existing inputs.
 *
 * Fully pure and in-memory: no database call, no network call, no model
 * provider call. Safe to run inside a Vercel Node serverless function.
 */

import { rebuildStateFromFacts } from '../founder-venture-state/fact-ledger.js';
import { buildMaterialisedVentureState } from '../founder-venture-state/snapshot.js';
import { computeClarificationQuestions, MAX_CLARIFICATION_QUESTIONS } from '../founder-venture-state/clarification.js';
import { evaluateFounderVentureRow } from '../owner-shadow-run/founder-venture-probe.js';
import { buildFounderBottleneckDiagnosticContext } from '../owner-shadow-run/founder-bottleneck-diagnostic-context.js';
import { runFounderBottleneckAndTodaysMove } from '../owner-shadow-run/founder-bottleneck-and-move.js';
import { resolveFounderMissionPolicy } from '../founder-mission-policy/index.js';
import { resolveFounderTaskContentFacts } from '../founder-decision-service/task-quality-gate.js';

/**
 * Resources VISION ITSELF provides to every founder, so a route is never
 * gated behind something the platform already does.
 *
 * The distinction that matters is capability-vs-content. A "result workspace"
 * is somewhere to record what happened -- VISION's task evidence capture IS
 * that, for every route equally. A "record" is somewhere to hold a fact the
 * venture state already stores. A "channel" is a way to reach someone, which
 * the founder states in outreachChannel. None of these assert anything about
 * a specific founder: whether the underlying FACT exists is a separate gate
 * that route-eligibility.js checks independently, and still refuses.
 *
 * The previous list granted exactly these same three kinds -- but only the
 * instances the interview and outreach routes happened to name. So
 * `interview_result_workspace` was available and `offer_result_workspace` was
 * not, though they are the same thing; `interview_channel` was available and
 * `offer_presentation_channel` was not, though both come from the same
 * outreachChannel answer. Five of the seven routes could therefore never
 * reach 'eligible' for ANY founder, no matter how complete their venture was
 * -- verified across 18 founder families, where all 7 routes were
 * clarification_required or blocked in 126 of 126 evaluations. That was an
 * inconsistency in the list, not a real capability boundary.
 */
export const PLATFORM_PROVIDED_RESOURCE_IDS = Object.freeze([
  // Somewhere to record an outcome = task evidence capture.
  'interview_result_workspace', 'interview_notes_workspace', 'outreach_result_workspace',
  'offer_result_workspace', 'offer_response_capture_record', 'retention_decision_workspace',
  'operating_outcome_workspace', 'operational_record', 'strategy_decision_workspace',
  'delivery_result_workspace',
  // Records over facts the venture state already holds.
  'offer_record', 'segment_record', 'strategy_option_records', 'strategy_decision_criteria',
  'strategy_decision_evidence', 'retention_metric_definitions', 'product_spec',
  'product_acceptance_criteria', 'process_documentation', 'interview_question_set',
  // Finding and reaching people: VISION's own prospect search and the
  // founder's declared outreach channel.
  'crm_contact_access', 'crm_directory_access', 'interview_channel',
  'outreach_call_channel', 'offer_presentation_channel',
]);

/**
 * Resources VISION genuinely does NOT have and must never assume: real
 * external tooling and real external data. A route needing any of these stays
 * blocked until the founder declares they actually have it (see
 * extractAvailableResourceIds in founder-intake/extract.js, which reads the
 * resources/constraints answer).
 *
 * This is the honest half of the split. Granting these by default would tell
 * a founder with no repository to "open your build environment", which is the
 * same class of confident falsehood the venture router exists to prevent.
 */
export const EXTERNAL_RESOURCE_IDS = Object.freeze([
  'repository_access', 'build_environment', 'test_environment', 'delivery_access',
  'customer_delivery_channel', 'product_analytics_dashboard', 'retention_cohort_data',
  'retention_intervention_evidence', 'operating_tool_access', 'process_verification_environment',
  'offer_test_audience_access',
]);

/**
 * Retained under its original name because generate-tasks and
 * qa-founder-resource-parity both import it as the one source of truth for
 * "what every founder starts with".
 */
export const INTAKE_BASELINE_RESOURCE_IDS = PLATFORM_PROVIDED_RESOURCE_IDS;

const VENTURE_TYPE_LABEL = Object.freeze({
  software_app: 'Software / app',
  agency_service_freelance: 'Agency / service',
  ecommerce_product: 'Ecommerce / product',
  creator_led_business: 'Creator-led business',
  local_physical_business: 'Local / physical business',
  coaching_consulting: 'Coaching / consulting',
  other_founder_venture: 'Founder venture',
});

/* Exported so Founder Chat's question selector can build the SAME engine view
   this pipeline builds, rather than a second approximation of it. */
export function buildSyntheticVentureRow(perKey) {
  const businessModelFamily = perKey.businessModelFamily?.value ?? null;
  const idea = perKey.idea?.value ?? null;
  return {
    ventureName: null,
    ventureType: businessModelFamily ? VENTURE_TYPE_LABEL[businessModelFamily] ?? null : null,
    ventureDomain: null,
    businessModel: businessModelFamily,
    description: idea,
    status: 'active',
  };
}

/**
 * Runs the complete intake -> Today's Move pipeline for one draft's
 * accumulated fact set. Never persists, never calls a database.
 *
 * @param {object} params
 * @param {object[]} params.facts Every accumulated founder_venture_facts-shaped row for this draft (provisional + confirmed).
 * @param {string} params.ventureId Synthetic, session-scoped identifier -- never a real venture id.
 * @param {string} params.userId Synthetic, session-scoped identifier -- never a real user id.
 * @param {string} params.evaluationTime ISO timestamp "now".
 * @param {string[]} [params.rawTexts] Every raw piece of text the founder typed this session (for conflict detection only -- never stored as a fact).
 * @returns {{
 *   perKey: object,
 *   conflicts: object[],
 *   clarificationQuestions: string[],
 *   evaluationStatus: 'valid'|'invalid_stored_state',
 *   evaluationErrors: string[],
 *   diagnostic: {available: boolean, reason: string|null, snapshot: object|null, entityBundle: object|null, executionContext: object|null},
 *   generation: object|null,
 *   missionPolicy: object|null,
 * }}
 */
export function runFounderIntakePipeline({
  facts, ventureId, userId, evaluationTime, rawTexts = [],
}) {
  const rebuilt = rebuildStateFromFacts(facts);
  const clarificationQuestions = computeClarificationQuestions(rebuilt.perKey, rebuilt.conflicts).slice(0, MAX_CLARIFICATION_QUESTIONS);

  const ventureRow = buildSyntheticVentureRow(rebuilt.perKey);
  const state = buildMaterialisedVentureState({
    ventureId, ventureRole: 'primary', userId, stateVersion: 1, ventureRow, rebuilt, evaluationTime,
  });

  const evaluation = evaluateFounderVentureRow({ venture_id: ventureId, venture_role: 'primary', state }, evaluationTime);
  if (evaluation.status !== 'valid') {
    return {
      perKey: rebuilt.perKey,
      conflicts: rebuilt.conflicts,
      clarificationQuestions,
      evaluationStatus: evaluation.status,
      evaluationErrors: evaluation.errors,
      diagnostic: { available: false, reason: 'invalid_stored_state', snapshot: null, entityBundle: null, executionContext: null },
      generation: null,
      missionPolicy: null,
    };
  }

  const userDeclaredResourceIds = rebuilt.perKey.availableResourceIds?.value ?? [];
  const availableResourceIds = [...new Set([...userDeclaredResourceIds, ...INTAKE_BASELINE_RESOURCE_IDS])];
  const diagnostic = buildFounderBottleneckDiagnosticContext({
    evaluation, ventureLifecycleStatus: 'active', availableResourceIds,
  });

  let generation = null;
  let missionPolicy = null;
  // The venture's own offer, outreach channel and target customer, reshaped
  // into the domain-neutral MissionContext the compiler already knows how to
  // word a mission with. Built from the SAME trusted snapshot the rest of the
  // pipeline uses plus the active fact ledger -- resolveFounderTaskContentFacts
  // reads nothing else and filters inactive facts itself, so a rejected or
  // superseded answer can never reach the task text. Wording only: it is not
  // an input to bottleneck assessment, route eligibility or candidate ranking.
  let missionContext = null;
  if (diagnostic.available) {
    missionContext = resolveFounderTaskContentFacts({ snapshot: diagnostic.snapshot, factLedger: facts }).missionContext;
    generation = runFounderBottleneckAndTodaysMove({
      snapshot: diagnostic.snapshot,
      entityBundle: diagnostic.entityBundle,
      executionContext: diagnostic.executionContext,
      evaluationTime,
      recentTasks: [],
    });
    missionPolicy = resolveFounderMissionPolicy({
      snapshot: diagnostic.snapshot,
      entityBundle: diagnostic.entityBundle,
      executionContext: diagnostic.executionContext,
      perKey: rebuilt.perKey,
      rawTexts,
      evaluationTime,
      recentTasks: [],
      missionContext,
    });
  }

  return {
    missionContext,
    perKey: rebuilt.perKey,
    conflicts: rebuilt.conflicts,
    clarificationQuestions,
    evaluationStatus: 'valid',
    evaluationErrors: [],
    diagnostic,
    generation,
    missionPolicy,
  };
}
