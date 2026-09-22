// VISION Live Proof Core — canonical Live Proof Result schema.
//
// One versioned result shape regardless of which observer adapter(s) ran.
// Never carries points/rank/badges/milestones/Goal Engine progression — Live
// Proof Core returns evidence and evaluation only; the existing authoritative
// Goal Engine decides what product-state changes happen after reading this.

'use strict';

import { assertSerialisable, cloneSerialisable, deepFreeze } from './plan.mjs';

export const LIVE_PROOF_RESULT_SCHEMA = 1;

export const RESULT_STATUSES = Object.freeze(['completed', 'not_completed', 'unsupported', 'cancelled', 'error']);

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }

export function validateLiveProofResult(result) {
  if (!isPlainObject(result)) return { ok: false, error: 'result_must_be_object' };
  if (result.schema_version !== LIVE_PROOF_RESULT_SCHEMA) return { ok: false, error: 'unsupported_schema_version' };
  if (typeof result.session_id !== 'string' || !result.session_id) return { ok: false, error: 'missing_session_id' };
  if (typeof result.task_id !== 'string' || !result.task_id) return { ok: false, error: 'missing_task_id' };
  if (typeof result.plan_id !== 'string' || !result.plan_id) return { ok: false, error: 'missing_plan_id' };
  if (RESULT_STATUSES.indexOf(result.status) < 0) return { ok: false, error: 'invalid_status' };
  if (typeof result.requirement_met !== 'boolean') return { ok: false, error: 'invalid_requirement_met' };
  if (typeof result.evidence_sufficient !== 'boolean') return { ok: false, error: 'invalid_evidence_sufficient' };
  if (result.task_score !== undefined && result.task_score !== null && typeof result.task_score !== 'number') return { ok: false, error: 'invalid_task_score' };
  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) return { ok: false, error: 'invalid_confidence' };
  if (!Array.isArray(result.observer_results)) return { ok: false, error: 'invalid_observer_results' };
  if (!isStringArray(result.verified_claims)) return { ok: false, error: 'invalid_verified_claims' };
  if (!isStringArray(result.forbidden_claims)) return { ok: false, error: 'invalid_forbidden_claims' };
  if (!isStringArray(result.strengths)) return { ok: false, error: 'invalid_strengths' };
  if (!isStringArray(result.issues)) return { ok: false, error: 'invalid_issues' };
  if (!isStringArray(result.improvements)) return { ok: false, error: 'invalid_improvements' };
  if (!Array.isArray(result.coaching_events)) return { ok: false, error: 'invalid_coaching_events' };
  const tracking = result.tracking;
  if (!isPlainObject(tracking)) return { ok: false, error: 'missing_tracking' };
  if (typeof tracking.interruptions !== 'number' || tracking.interruptions < 0) return { ok: false, error: 'invalid_tracking_interruptions' };
  if (typeof tracking.total_lost_ms !== 'number' || tracking.total_lost_ms < 0) return { ok: false, error: 'invalid_tracking_total_lost_ms' };
  if (typeof tracking.recovered !== 'boolean') return { ok: false, error: 'invalid_tracking_recovered' };
  if (typeof result.completion_reason !== 'string' || !result.completion_reason) return { ok: false, error: 'missing_completion_reason' };

  // Never a reward/product-state authority: assert the forbidden fields do
  // not exist on the result at all, not merely that they are falsy.
  for (const forbidden of ['xp', 'points', 'rank', 'badges', 'milestones', 'reward', 'awarded']) {
    if (Object.prototype.hasOwnProperty.call(result, forbidden)) return { ok: false, error: `result_must_not_carry_reward_field:${forbidden}` };
  }

  try { assertSerialisable(result, 'result'); } catch (e) { return { ok: false, error: `not_serialisable:${e.message}` }; }
  return { ok: true };
}

export function createLiveProofResult(fields) {
  const result = cloneSerialisable(Object.assign({
    schema_version: LIVE_PROOF_RESULT_SCHEMA,
    observer_results: [],
    verified_claims: [],
    forbidden_claims: [],
    strengths: [],
    issues: [],
    improvements: [],
    coaching_events: [],
    tracking: { interruptions: 0, total_lost_ms: 0, recovered: false }
  }, fields || {}));
  const validated = validateLiveProofResult(result);
  if (!validated.ok) throw new Error(`invalid_live_proof_result:${validated.error}`);
  return deepFreeze(result);
}

export default { LIVE_PROOF_RESULT_SCHEMA, RESULT_STATUSES, validateLiveProofResult, createLiveProofResult };
