// VISION Live Proof Core — shared observer-adapter contract.
//
// Every observer (camera, focus, and any future observer) implements the
// same five-method lifecycle and emits only the standard event categories
// below. Adapters translate an EXISTING proof engine's own observations into
// these events — they never reimplement verification logic, never award
// points/rank/completion, and never write arbitrary product state. The
// shared session controller (session-controller.mjs) is the only thing that
// calls these methods; adapters never call each other or the Goal Engine
// directly.

'use strict';

export const OBSERVER_EVENT_TYPES = Object.freeze([
  'observation_valid',
  'progress_updated',
  'coaching_cue',
  'tracking_lost',
  'tracking_recovered',
  'requirement_met',
  'requirement_failed',
  'observer_error'
]);

const REQUIRED_METHODS = Object.freeze(['supports', 'prepare', 'start', 'sample', 'finish', 'teardown']);

// Fields an ObserverEvent may carry. adapterId/type/timestampMs are required;
// everything else is optional and adapter-specific but must be
// JSON-serialisable (enforced by the controller before it appends an event to
// a result).
export function createObserverEvent(adapterId, type, fields) {
  if (OBSERVER_EVENT_TYPES.indexOf(type) < 0) throw new Error(`invalid_observer_event_type:${type}`);
  if (typeof adapterId !== 'string' || !adapterId) throw new Error('observer_event_requires_adapter_id');
  const timestampMs = fields && typeof fields.timestamp_ms === 'number' ? fields.timestamp_ms : undefined;
  if (typeof timestampMs !== 'number') throw new Error('observer_event_requires_timestamp_ms');
  const event = Object.assign({}, fields, { adapter_id: adapterId, type, timestamp_ms: timestampMs });
  return Object.freeze(event);
}

// Throws a specific, actionable error naming exactly which method is
// missing/malformed — this is what lets the shared controller "reject
// missing adapters" instead of failing with a generic TypeError deep inside a
// session run.
export function assertObserverAdapterShape(adapter, adapterId) {
  if (!adapter || typeof adapter !== 'object') throw new Error(`observer_adapter_missing:${adapterId}`);
  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') throw new Error(`observer_adapter_missing_method:${adapterId}.${method}`);
  }
}

// A result an adapter hands back from finish(). Deliberately narrow — no
// reward/xp/rank fields exist on this shape, and the controller does not
// forward arbitrary adapter output into the final LiveProofResult beyond
// these fields.
export function createObserverResult(fields) {
  fields = fields || {};
  if (typeof fields.adapter_id !== 'string' || !fields.adapter_id) throw new Error('observer_result_requires_adapter_id');
  if (typeof fields.requirement_met !== 'boolean') throw new Error('observer_result_requires_requirement_met');
  if (typeof fields.confidence !== 'number' || fields.confidence < 0 || fields.confidence > 1) throw new Error('observer_result_requires_confidence_0_1');
  return Object.freeze({
    adapter_id: fields.adapter_id,
    requirement_met: fields.requirement_met,
    confidence: fields.confidence,
    evidence_summary: fields.evidence_summary && typeof fields.evidence_summary === 'object' ? Object.freeze(Object.assign({}, fields.evidence_summary)) : {},
    issues: Array.isArray(fields.issues) ? fields.issues.slice() : [],
    strengths: Array.isArray(fields.strengths) ? fields.strengths.slice() : [],
    tracking: {
      interruptions: Number(fields.tracking && fields.tracking.interruptions) || 0,
      total_lost_ms: Number(fields.tracking && fields.tracking.total_lost_ms) || 0,
      recovered: !!(fields.tracking && fields.tracking.recovered)
    }
  });
}

export default { OBSERVER_EVENT_TYPES, createObserverEvent, assertObserverAdapterShape, createObserverResult };
