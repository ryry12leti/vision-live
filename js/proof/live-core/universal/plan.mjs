// VISION Live Proof Core — canonical Live Proof Plan schema.
//
// PURE + DETERMINISTIC. No I/O, no browser objects, media streams or
// executable functions may ever appear on a plan or its result — a plan must
// be JSON-serialisable. Shared verbatim by Node QA today; the eventual
// server/edge and browser call sites import this same file (matches the
// convention of focus-session.mjs and live-contract-compiler.mjs in this
// same directory).
//
// A plan is produced only by live-proof-core/compiler.mjs (compileLiveProofPlan)
// from a stored task + its existing proof_contract_v3 envelope + the canonical
// config/proof-capabilities.json registry. It carries no reward/award
// authority — it only describes how a task may be honestly observed.

'use strict';

export const LIVE_PROOF_PLAN_SCHEMA = 1;

export const TARGET_KINDS = Object.freeze(['reps', 'hold_seconds', 'duration_seconds', 'evidence', 'composite']);
export const OBSERVER_ADAPTER_IDS = Object.freeze(['camera', 'focus']);
export const FALLBACK_PROOF_TYPES = Object.freeze(['photo', 'voice']);

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every((x) => typeof x === 'string'); }
function isPositiveNumber(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }

// Throws on the first non-serialisable value found (function, DOM node,
// MediaStream, symbol, ...). This is what keeps a plan honestly "data, not
// code" — an adapter or controller must never be able to smuggle a live
// object onto the plan that a QA snapshot or an Edge Function couldn't
// round-trip through JSON.
export function assertSerialisable(value, path) {
  path = path || 'value';
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return;
  if (t === 'function' || t === 'symbol' || t === 'bigint') throw new Error(`live_proof_plan_not_serialisable:${path} (${t})`);
  if (Array.isArray(value)) { value.forEach((v, i) => assertSerialisable(v, `${path}[${i}]`)); return; }
  if (t === 'object') {
    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    if (g && g.MediaStream && value instanceof g.MediaStream) throw new Error(`live_proof_plan_not_serialisable:${path} (MediaStream)`);
    if (g && g.Node && value instanceof g.Node) throw new Error(`live_proof_plan_not_serialisable:${path} (DOM Node)`);
    if (typeof value.then === 'function') throw new Error(`live_proof_plan_not_serialisable:${path} (Promise)`);
    Object.keys(value).forEach((key) => assertSerialisable(value[key], `${path}.${key}`));
    return;
  }
  throw new Error(`live_proof_plan_not_serialisable:${path}`);
}

export function cloneSerialisable(value) {
  assertSerialisable(value, 'value');
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

// Recursively freezes a plain data structure. Used so a compiled plan can
// never be mutated later by an adapter or the session controller — the
// stored target and every other compiled field stay exactly what the
// compiler decided, for the lifetime of the session.
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.keys(value).forEach((key) => deepFreeze(value[key]));
  return value;
}

// Never throws — returns { ok, error } like js/vision-proof-contract.js's
// normalize(). Validates shape only; the compiler is responsible for every
// value being honestly derived.
export function validateLiveProofPlan(plan) {
  if (!isPlainObject(plan)) return { ok: false, error: 'plan_must_be_object' };
  if (plan.schema_version !== LIVE_PROOF_PLAN_SCHEMA) return { ok: false, error: 'unsupported_schema_version' };
  if (!isNonEmptyString(plan.plan_id)) return { ok: false, error: 'missing_plan_id' };
  if (!isNonEmptyString(plan.task_id)) return { ok: false, error: 'missing_task_id' };
  if (!isNonEmptyString(plan.task_domain)) return { ok: false, error: 'missing_task_domain' };
  if (typeof plan.task_title !== 'string') return { ok: false, error: 'missing_task_title' };

  const req = plan.requirement;
  if (!isPlainObject(req)) return { ok: false, error: 'missing_requirement' };
  if (typeof req.description !== 'string') return { ok: false, error: 'missing_requirement_description' };
  if (TARGET_KINDS.indexOf(req.target_kind) < 0) return { ok: false, error: 'invalid_target_kind' };
  if (req.target_kind !== 'evidence' && req.target_kind !== 'composite') {
    if (!isPositiveNumber(req.target_value)) return { ok: false, error: 'missing_target_value' };
  }
  if (req.target_kind === 'composite') {
    if (!Array.isArray(req.required_components) || req.required_components.length === 0) return { ok: false, error: 'composite_requires_components' };
  }

  if (!Array.isArray(plan.observers) || plan.observers.length === 0) return { ok: false, error: 'missing_observers' };
  for (const obs of plan.observers) {
    if (!isPlainObject(obs)) return { ok: false, error: 'invalid_observer' };
    if (OBSERVER_ADAPTER_IDS.indexOf(obs.adapter_id) < 0) return { ok: false, error: 'unknown_observer_adapter' };
    if (!isNonEmptyString(obs.role)) return { ok: false, error: 'missing_observer_role' };
  }

  const rule = plan.completion_rule;
  if (!isPlainObject(rule)) return { ok: false, error: 'missing_completion_rule' };
  if (!isNonEmptyString(rule.type)) return { ok: false, error: 'missing_completion_rule_type' };
  if (!isStringArray(rule.required_observers) || rule.required_observers.length === 0) return { ok: false, error: 'missing_required_observers' };
  if (rule.minimum_confidence !== undefined && (typeof rule.minimum_confidence !== 'number' || rule.minimum_confidence < 0 || rule.minimum_confidence > 1)) return { ok: false, error: 'invalid_minimum_confidence' };
  for (const id of rule.required_observers) {
    if (!plan.observers.some((o) => o.adapter_id === id)) return { ok: false, error: 'required_observer_not_in_plan' };
  }

  const coaching = plan.coaching_policy;
  if (!isPlainObject(coaching)) return { ok: false, error: 'missing_coaching_policy' };
  if (typeof coaching.enabled !== 'boolean') return { ok: false, error: 'invalid_coaching_enabled' };
  if (!isStringArray(coaching.allowed_event_types)) return { ok: false, error: 'invalid_allowed_event_types' };
  if (typeof coaching.cooldown_ms !== 'number' || coaching.cooldown_ms < 0) return { ok: false, error: 'invalid_cooldown_ms' };

  const tracking = plan.tracking_policy;
  if (!isPlainObject(tracking)) return { ok: false, error: 'missing_tracking_policy' };
  // Task/capability-specific grace period, not one global constant: camera and
  // focus both still compile to 15s today (compiler.mjs's
  // TRACKING_LOSS_THRESHOLD_SECONDS, unchanged), but a future observer may
  // compile a different, still-bounded, honest threshold.
  if (!isPositiveNumber(tracking.loss_threshold_seconds) || tracking.loss_threshold_seconds < 3 || tracking.loss_threshold_seconds > 120) {
    return { ok: false, error: 'invalid_tracking_loss_threshold' };
  }
  if (typeof tracking.recovery_allowed !== 'boolean') return { ok: false, error: 'invalid_recovery_allowed' };
  if (tracking.maximum_interruptions !== undefined && !(typeof tracking.maximum_interruptions === 'number' && tracking.maximum_interruptions >= 0)) return { ok: false, error: 'invalid_maximum_interruptions' };

  const claim = plan.claim_boundary;
  if (!isPlainObject(claim)) return { ok: false, error: 'missing_claim_boundary' };
  if (!isStringArray(claim.verified_claims) || claim.verified_claims.length === 0) return { ok: false, error: 'missing_verified_claims' };
  if (!isStringArray(claim.forbidden_claims)) return { ok: false, error: 'invalid_forbidden_claims' };

  const fallback = plan.fallback;
  if (!isPlainObject(fallback)) return { ok: false, error: 'missing_fallback' };
  if (typeof fallback.allowed !== 'boolean') return { ok: false, error: 'invalid_fallback_allowed' };
  if (fallback.allowed && FALLBACK_PROOF_TYPES.indexOf(fallback.proof_type) < 0) return { ok: false, error: 'invalid_fallback_proof_type' };

  try { assertSerialisable(plan, 'plan'); } catch (e) { return { ok: false, error: `not_serialisable:${e.message}` }; }

  return { ok: true };
}

// Builds + validates a plan from a fully-decided fields object. Throws on
// invalid input: by the time fields reach here every value must already be
// deliberate (the compiler's job), so a shape failure here is a compiler bug,
// not a routing decision.
export function createLiveProofPlan(fields) {
  const plan = cloneSerialisable(Object.assign({ schema_version: LIVE_PROOF_PLAN_SCHEMA }, fields || {}));
  const result = validateLiveProofPlan(plan);
  if (!result.ok) throw new Error(`invalid_live_proof_plan:${result.error}`);
  return deepFreeze(plan);
}

// Typed non-plan result returned by the compiler when no qualified observer
// exists. Never confused with a plan; the session controller must refuse to
// start a session from this shape.
export function createUnsupportedPlanResult(fields) {
  fields = fields || {};
  if (typeof fields.reason !== 'string' || !fields.reason) throw new Error('unsupported_result_requires_reason');
  const out = { supported: false, reason: fields.reason };
  if (fields.required_capability !== undefined) out.required_capability = String(fields.required_capability);
  if (fields.detail !== undefined) out.detail = String(fields.detail);
  if (fields.fallback !== undefined) out.fallback = cloneSerialisable(fields.fallback);
  return Object.freeze(out);
}

export default {
  LIVE_PROOF_PLAN_SCHEMA, TARGET_KINDS, OBSERVER_ADAPTER_IDS, FALLBACK_PROOF_TYPES,
  assertSerialisable, cloneSerialisable, validateLiveProofPlan, createLiveProofPlan, createUnsupportedPlanResult
};
