// VISION Live Proof Core — Universal Live Proof Result (schema v2).
//
// ADDITIVE ONLY. This module does not reimplement verification or scoring —
// it composes the existing, already-validated per-run LiveProofResult objects
// (result.mjs, schema v1, unchanged) into the richer observer-independent
// Universal Result contract the product spec requires: multi-run history,
// method switches, an execution score, a verification-confidence label, and
// a Continue/Redo recommendation. It still forbids every reward field
// (delegated to result.mjs's own guard, run per contributing result) and adds
// its own guard against writing anything that looks like reward/progression
// state directly on the universal envelope.
//
// Keep separate, on purpose (per product spec):
//   execution_score        — how well the task was performed (0-100)
//   verification_confidence — how certain VISION is about the evidence (0-1)
//   progression points/XP/rank/goal trajectory — owned by other systems, never here

'use strict';

import { assertSerialisable, cloneSerialisable, deepFreeze } from './plan.mjs';
import { validateLiveProofResult } from './result.mjs';

export const UNIVERSAL_RESULT_SCHEMA = 2;
export const RECOMMENDATIONS = Object.freeze(['Continue', 'Redo Task']);
export const CONFIDENCE_LABELS = Object.freeze(['Low', 'Medium', 'High']);
export const UNIVERSAL_RESULT_STATUSES = Object.freeze(['completed', 'incomplete', 'not_completed', 'unsupported', 'cancelled', 'error']);

const FORBIDDEN_FIELDS = ['xp', 'points', 'rank', 'badges', 'milestones', 'reward', 'awarded', 'task_status', 'activation_status'];

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// Deterministic 0-1 -> label mapping. Kept as one pure function so every
// call site (session finish, revision save, QA) agrees byte-for-byte.
export function confidenceLabelFor(confidence) {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) throw new Error('confidence_label_requires_number');
  if (confidence >= 0.75) return 'High';
  if (confidence >= 0.4) return 'Medium';
  return 'Low';
}

// Deterministic recommendation: Redo only when the task was not honestly
// completed with sufficient evidence, OR confidence is too low to trust a
// completed claim. Continue/Redo is advisory only — it never mutates task
// state itself (the caller/session layer must not treat this as an award).
export function recommendationFor({ status, requirementMet, confidence }) {
  if (status === 'completed' && requirementMet && confidence >= 0.4) {
    return { recommendation: 'Continue', reason: 'requirement_met_with_sufficient_confidence' };
  }
  if (status === 'incomplete') {
    return { recommendation: 'Redo Task', reason: 'execution_finished_incomplete' };
  }
  if (!requirementMet) {
    return { recommendation: 'Redo Task', reason: 'requirement_not_met' };
  }
  return { recommendation: 'Redo Task', reason: 'insufficient_verification_confidence' };
}

// Execution score is a bounded, deterministic function of what was actually
// verified — never an estimate presented as ground truth. It rewards
// requirement completion and penalises tracked issues/incomplete
// requirements; it is not a proxy for verification_confidence (kept
// separate per product spec).
export function computeExecutionScore({ requirementMet, issuesCount, incompleteRequirementsCount, trackingInterruptions }) {
  let score = requirementMet ? 100 : 40;
  score -= Math.min(30, (issuesCount || 0) * 5);
  score -= Math.min(40, (incompleteRequirementsCount || 0) * 15);
  score -= Math.min(15, (trackingInterruptions || 0) * 3);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function validateUniversalLiveProofResult(result) {
  if (!isPlainObject(result)) return { ok: false, error: 'result_must_be_object' };
  if (result.schema_version !== UNIVERSAL_RESULT_SCHEMA) return { ok: false, error: 'unsupported_schema_version' };
  if (typeof result.universal_session_id !== 'string' || !result.universal_session_id) return { ok: false, error: 'missing_universal_session_id' };
  if (typeof result.task_id !== 'string' || !result.task_id) return { ok: false, error: 'missing_task_id' };
  if (typeof result.plan_id !== 'string' || !result.plan_id) return { ok: false, error: 'missing_plan_id' };
  if (typeof result.plan_version !== 'number') return { ok: false, error: 'missing_plan_version' };
  if (UNIVERSAL_RESULT_STATUSES.indexOf(result.status) < 0) return { ok: false, error: 'invalid_status' };
  if (typeof result.started_at !== 'string') return { ok: false, error: 'missing_started_at' };
  if (typeof result.finished_at !== 'string') return { ok: false, error: 'missing_finished_at' };
  if (!Array.isArray(result.observer_runs) || result.observer_runs.length === 0) return { ok: false, error: 'missing_observer_runs' };
  if (!Array.isArray(result.method_switches)) return { ok: false, error: 'invalid_method_switches' };

  if (result.execution_score !== null && (typeof result.execution_score !== 'number' || result.execution_score < 0 || result.execution_score > 100)) {
    return { ok: false, error: 'invalid_execution_score' };
  }
  if (typeof result.verification_confidence !== 'number' || result.verification_confidence < 0 || result.verification_confidence > 1) {
    return { ok: false, error: 'invalid_verification_confidence' };
  }
  if (CONFIDENCE_LABELS.indexOf(result.confidence_label) < 0) return { ok: false, error: 'invalid_confidence_label' };
  if (confidenceLabelFor(result.verification_confidence) !== result.confidence_label) return { ok: false, error: 'confidence_label_does_not_match_confidence' };
  if (RECOMMENDATIONS.indexOf(result.recommendation) < 0) return { ok: false, error: 'invalid_recommendation' };
  if (typeof result.recommendation_reason !== 'string' || !result.recommendation_reason) return { ok: false, error: 'missing_recommendation_reason' };

  if (!Array.isArray(result.observed)) return { ok: false, error: 'invalid_observed' };
  if (!Array.isArray(result.verified)) return { ok: false, error: 'invalid_verified' };
  if (!Array.isArray(result.failed)) return { ok: false, error: 'invalid_failed' };
  if (!Array.isArray(result.uncertain)) return { ok: false, error: 'invalid_uncertain' };
  if (!isPlainObject(result.objective_measurements)) return { ok: false, error: 'invalid_objective_measurements' };
  if (!Array.isArray(result.quality_findings)) return { ok: false, error: 'invalid_quality_findings' };
  if (!isPlainObject(result.professional_standard)) return { ok: false, error: 'invalid_professional_standard' };
  if (!Array.isArray(result.incomplete_requirements)) return { ok: false, error: 'invalid_incomplete_requirements' };
  if (!Array.isArray(result.coaching_events)) return { ok: false, error: 'invalid_coaching_events' };
  if (!Array.isArray(result.safety_events)) return { ok: false, error: 'invalid_safety_events' };
  if (!Array.isArray(result.tracking_losses)) return { ok: false, error: 'invalid_tracking_losses' };
  if (!Array.isArray(result.pauses)) return { ok: false, error: 'invalid_pauses' };
  if (!Array.isArray(result.connectivity_interruptions)) return { ok: false, error: 'invalid_connectivity_interruptions' };
  if (!Array.isArray(result.evidence_references)) return { ok: false, error: 'invalid_evidence_references' };

  if (result.deadline_context !== null && !isPlainObject(result.deadline_context)) return { ok: false, error: 'invalid_deadline_context' };
  if (result.deadline_context && Object.prototype.hasOwnProperty.call(result.deadline_context, 'estimated_completion_date')) {
    return { ok: false, error: 'deadline_context_must_not_invent_completion_date' };
  }
  if (!isPlainObject(result.trajectory_evidence)) return { ok: false, error: 'invalid_trajectory_evidence' };
  if (!isPlainObject(result.versions)) return { ok: false, error: 'invalid_versions' };
  if (result.original_result_id !== null && typeof result.original_result_id !== 'string') return { ok: false, error: 'invalid_original_result_id' };
  if (typeof result.revision_index !== 'number' || result.revision_index < 0) return { ok: false, error: 'invalid_revision_index' };

  for (const field of FORBIDDEN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(result, field)) return { ok: false, error: `result_must_not_carry_forbidden_field:${field}` };
  }

  // Every observer_run must itself carry an already-validated per-run result.
  for (const run of result.observer_runs) {
    if (!isPlainObject(run) || !isPlainObject(run.result)) return { ok: false, error: 'observer_run_missing_result' };
    const check = validateLiveProofResult(run.result);
    if (!check.ok) return { ok: false, error: `observer_run_result_invalid:${check.error}` };
  }

  try { assertSerialisable(result, 'universal_result'); } catch (e) { return { ok: false, error: `not_serialisable:${e.message}` }; }
  return { ok: true };
}

// Builds a Universal Live Proof Result from a set of already-finished
// per-observer LiveProofResults plus universal-session bookkeeping. Never
// invents ground truth: execution_score/confidence are pure functions of the
// inputs, deadline_context is passed through read-only, and no estimated
// completion date is ever added (validated above).
export function createUniversalLiveProofResult(fields) {
  fields = fields || {};
  const confidence = typeof fields.verification_confidence === 'number' ? fields.verification_confidence : 0;
  const label = confidenceLabelFor(confidence);
  const rec = fields.recommendation && fields.recommendation_reason
    ? { recommendation: fields.recommendation, reason: fields.recommendation_reason }
    : recommendationFor({ status: fields.status, requirementMet: !!fields.requirement_met, confidence });

  const result = cloneSerialisable(Object.assign({
    schema_version: UNIVERSAL_RESULT_SCHEMA,
    method_switches: [],
    observed: [],
    verified: [],
    failed: [],
    uncertain: [],
    objective_measurements: {},
    quality_findings: [],
    professional_standard: { passed: [], missed: [] },
    incomplete_requirements: [],
    coaching_events: [],
    safety_events: [],
    tracking_losses: [],
    pauses: [],
    connectivity_interruptions: [],
    evidence_references: [],
    deadline_context: fields.deadline_context !== undefined ? fields.deadline_context : null,
    trajectory_evidence: {},
    versions: {},
    original_result_id: null,
    revision_index: 0
  }, fields, {
    confidence_label: label,
    recommendation: rec.recommendation,
    recommendation_reason: rec.reason
  }));
  delete result.requirement_met; // internal-only input, not part of the persisted envelope

  const validated = validateUniversalLiveProofResult(result);
  if (!validated.ok) throw new Error(`invalid_universal_live_proof_result:${validated.error}`);
  return deepFreeze(result);
}

export default {
  UNIVERSAL_RESULT_SCHEMA, RECOMMENDATIONS, CONFIDENCE_LABELS, UNIVERSAL_RESULT_STATUSES,
  confidenceLabelFor, recommendationFor, computeExecutionScore,
  validateUniversalLiveProofResult, createUniversalLiveProofResult
};
