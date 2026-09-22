// VISION Live Proof Core — shared headless session controller.
//
// Owns the ONE canonical lifecycle, the ONE canonical 15-second tracking-loss
// rule, coaching cooldown enforcement, and result assembly for every observer
// adapter. Adapters differ only in HOW they decide "valid tracking this
// tick" (camera: pose visibility; focus: presence+activity+page visibility)
// — the threshold, event semantics, and result shape are owned here, once,
// so camera and focus (and any future observer) can never drift apart.
//
// Lifecycle: created -> prepared -> active <-> interrupted -> finishing ->
// completed | not_completed | cancelled | error -> torn_down.
//
// This controller never awards XP/rank/completion — see result.mjs's
// validateLiveProofResult, which rejects a result carrying any reward field.

'use strict';

import { validateLiveProofPlan } from './plan.mjs';
import { assertObserverAdapterShape, createObserverEvent, createObserverResult } from './observer-adapter.mjs';
import { createLiveProofResult } from './result.mjs';

const TERMINAL_STATES = Object.freeze(['completed', 'not_completed', 'cancelled', 'error', 'torn_down']);

function freshTrackingState() {
  return { lostSinceMs: null, flaggedLost: false, interruptions: 0, totalLostMs: 0, recovered: false, terminallyFailed: false };
}

export function createLiveProofSession(opts) {
  opts = opts || {};
  const plan = opts.plan;
  const planCheck = validateLiveProofPlan(plan);
  if (!planCheck.ok) throw new Error(`cannot_start_session_invalid_plan:${planCheck.error}`);

  const adapters = opts.adapters || {};
  const requiredAdapterIds = Array.from(new Set(plan.observers.map((o) => o.adapter_id)));
  for (const id of requiredAdapterIds) assertObserverAdapterShape(adapters[id], id);

  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const sessionId = typeof opts.sessionId === 'string' && opts.sessionId ? opts.sessionId : `lps_${plan.task_id}_${now()}`;

  let state = 'created';
  let finished = false;
  let torndown = false;
  const events = [];
  const coachingEvents = [];
  let lastCoachingAtMs = -Infinity;
  const observerResultsFinal = {};
  const trackingState = {};
  requiredAdapterIds.forEach((id) => { trackingState[id] = freshTrackingState(); });

  function assertState(allowed, action) {
    if (allowed.indexOf(state) < 0) throw new Error(`invalid_session_transition:${action} from ${state}`);
  }

  function sessionContext(adapterId) {
    return Object.freeze({
      sessionId,
      planId: plan.plan_id,
      taskId: plan.task_id,
      requirement: plan.requirement,
      observerConfig: plan.observers.find((o) => o.adapter_id === adapterId) || null,
      now
    });
  }

  function recordControllerEvent(adapterId, type, atMs, extra) {
    const evt = createObserverEvent(adapterId, type, Object.assign({ timestamp_ms: atMs }, extra));
    events.push(evt);
    return evt;
  }

  function recordCoachingEvent(evt) {
    if (!plan.coaching_policy.enabled) return;
    if (plan.coaching_policy.allowed_event_types.indexOf('coaching_cue') < 0) return;
    const t = evt.timestamp_ms;
    if (t - lastCoachingAtMs < plan.coaching_policy.cooldown_ms) return;
    lastCoachingAtMs = t;
    events.push(evt);
    coachingEvents.push(evt);
  }

  // The one canonical tracking-loss timer + event emitter. Adapters only
  // report, per tick, whether they got a valid observation (an
  // 'observation_valid' event) — this function owns the 15s threshold,
  // 'tracking_lost' / 'tracking_recovered' emission, interruption counting,
  // and dropping of any progress claimed while a loss is in effect.
  function processAdapterEvents(adapterId, rawEvents, atMsHint) {
    const ts = trackingState[adapterId];
    const atMs = typeof atMsHint === 'number' ? atMsHint : now();
    const list = Array.isArray(rawEvents) ? rawEvents.filter(Boolean) : [];
    const hasValidObservation = list.some((e) => e.type === 'observation_valid');

    if (hasValidObservation) {
      if (ts.lostSinceMs != null) {
        const lossDurationMs = atMs - ts.lostSinceMs;
        if (ts.flaggedLost) {
          ts.totalLostMs += lossDurationMs;
          ts.recovered = true;
          if (plan.tracking_policy.recovery_allowed) recordControllerEvent(adapterId, 'tracking_recovered', atMs, { loss_duration_ms: lossDurationMs });
        }
        ts.lostSinceMs = null;
        ts.flaggedLost = false;
      }
    } else {
      if (ts.lostSinceMs == null) ts.lostSinceMs = atMs;
      const elapsedMs = atMs - ts.lostSinceMs;
      if (!ts.flaggedLost && elapsedMs >= plan.tracking_policy.loss_threshold_seconds * 1000) {
        ts.flaggedLost = true;
        ts.interruptions += 1;
        recordControllerEvent(adapterId, 'tracking_lost', atMs, { elapsed_ms: elapsedMs });
        if (!plan.tracking_policy.recovery_allowed) ts.terminallyFailed = true;
        if (typeof plan.tracking_policy.maximum_interruptions === 'number' && ts.interruptions > plan.tracking_policy.maximum_interruptions) ts.terminallyFailed = true;
      }
    }

    for (const evt of list) {
      if (evt.type === 'coaching_cue') { recordCoachingEvent(evt); continue; }
      // Do not count unobserved progress: while a loss is flagged, drop any
      // progress/requirement claim an adapter still emits that tick.
      if (ts.flaggedLost && (evt.type === 'progress_updated' || evt.type === 'requirement_met')) continue;
      events.push(evt);
    }
  }

  // A session may end (finish/cancel) while an observer is still mid-loss —
  // it never got a chance to recover, so totalLostMs (only credited on
  // recovery) would otherwise silently read 0 despite a real, ongoing loss.
  // Credit the still-open loss window up to "now" so the reported total is
  // never an undercount just because the session ended before recovery.
  function trackingSummary(adapterId) {
    const ts = trackingState[adapterId];
    let totalLostMs = ts.totalLostMs;
    if (ts.flaggedLost && ts.lostSinceMs != null) totalLostMs += Math.max(0, now() - ts.lostSinceMs);
    return { interruptions: ts.interruptions, total_lost_ms: totalLostMs, recovered: ts.recovered };
  }

  async function teardownAll(reason) {
    if (torndown) return;
    for (const id of requiredAdapterIds) {
      try { await adapters[id].teardown(reason || 'session_end'); } catch (_) { /* teardown must never throw the session out of torn_down */ }
    }
    torndown = true;
    state = 'torn_down';
  }

  async function prepare() {
    assertState(['created'], 'prepare');
    try {
      for (const id of requiredAdapterIds) {
        const support = adapters[id].supports(plan);
        if (!support || support.supported !== true) throw new Error(`adapter_does_not_support_plan:${id}`);
        await adapters[id].prepare(sessionContext(id));
      }
      state = 'prepared';
    } catch (err) {
      await teardownAll('prepare_failed');
      finished = true;
      throw err;
    }
    return getSnapshot();
  }

  async function start() {
    assertState(['prepared'], 'start');
    try {
      for (const id of requiredAdapterIds) await adapters[id].start(sessionContext(id));
      state = 'active';
    } catch (err) {
      await teardownAll('start_failed');
      finished = true;
      throw err;
    }
    return getSnapshot();
  }

  async function feed(adapterId, input) {
    assertState(['active', 'interrupted'], 'feed');
    if (requiredAdapterIds.indexOf(adapterId) < 0) throw new Error(`unknown_adapter_for_session:${adapterId}`);
    if (trackingState[adapterId].terminallyFailed) return getSnapshot();
    const atMs = input && typeof input.at_ms === 'number' ? input.at_ms : now();
    const rawEvents = await adapters[adapterId].sample(input);
    processAdapterEvents(adapterId, rawEvents, atMs);
    state = requiredAdapterIds.some((id) => trackingState[id].flaggedLost) ? 'interrupted' : 'active';
    return getSnapshot();
  }

  function evaluateCompletion(results) {
    const rule = plan.completion_rule;
    const perObserverMet = rule.required_observers.map((id) => !!(results[id] && results[id].requirement_met && !trackingState[id].terminallyFailed));
    const requirementMet = perObserverMet.every(Boolean);
    const confidences = rule.required_observers.map((id) => (results[id] ? results[id].confidence : 0));
    const minConfidence = rule.minimum_confidence;
    const confidenceOk = minConfidence === undefined || confidences.every((c) => c >= minConfidence);
    return { requirementMet: requirementMet && confidenceOk, confidence: confidences.length ? Math.min.apply(null, confidences) : 0 };
  }

  function buildResult(status, evaluated, reason) {
    const totals = requiredAdapterIds.reduce((acc, id) => {
      const t = trackingSummary(id);
      acc.interruptions += t.interruptions;
      acc.total_lost_ms += t.total_lost_ms;
      acc.recovered = acc.recovered || t.recovered;
      return acc;
    }, { interruptions: 0, total_lost_ms: 0, recovered: false });

    const observerResultsArr = requiredAdapterIds.map((id) => observerResultsFinal[id]).filter(Boolean);
    const evidenceSufficient = requiredAdapterIds.every((id) => observerResultsFinal[id] && observerResultsFinal[id].confidence > 0);

    return createLiveProofResult({
      session_id: sessionId,
      task_id: plan.task_id,
      plan_id: plan.plan_id,
      status,
      requirement_met: !!(evaluated && evaluated.requirementMet),
      evidence_sufficient: evidenceSufficient,
      confidence: evaluated ? evaluated.confidence : 0,
      observer_results: observerResultsArr,
      verified_claims: (evaluated && evaluated.requirementMet) ? plan.claim_boundary.verified_claims.slice() : [],
      forbidden_claims: plan.claim_boundary.forbidden_claims.slice(),
      strengths: observerResultsArr.reduce((acc, r) => acc.concat(r.strengths), []),
      issues: observerResultsArr.reduce((acc, r) => acc.concat(r.issues), []),
      improvements: [],
      coaching_events: coachingEvents.slice(),
      tracking: totals,
      completion_reason: reason
    });
  }

  async function finish(reason) {
    if (finished) throw new Error('session_already_finished');
    assertState(['active', 'interrupted'], 'finish');
    state = 'finishing';
    for (const id of requiredAdapterIds) {
      try {
        const raw = await adapters[id].finish(sessionContext(id));
        observerResultsFinal[id] = createObserverResult(Object.assign({}, raw, { adapter_id: id, tracking: trackingSummary(id) }));
      } catch (err) {
        recordControllerEvent(id, 'observer_error', now(), { message: String((err && err.message) || err) });
        observerResultsFinal[id] = createObserverResult({ adapter_id: id, requirement_met: false, confidence: 0, issues: ['observer_error'], tracking: trackingSummary(id) });
      }
    }
    const evaluated = evaluateCompletion(observerResultsFinal);
    const status = evaluated.requirementMet ? 'completed' : 'not_completed';
    const result = buildResult(status, evaluated, reason || (evaluated.requirementMet ? 'requirement_met' : 'requirement_not_met'));
    await teardownAll('finish');
    finished = true;
    state = 'torn_down';
    return result;
  }

  async function cancel(reason) {
    if (finished) throw new Error('session_already_finished');
    for (const id of requiredAdapterIds) {
      observerResultsFinal[id] = createObserverResult({ adapter_id: id, requirement_met: false, confidence: 0, tracking: trackingSummary(id) });
    }
    const result = buildResult('cancelled', { requirementMet: false, confidence: 0 }, reason || 'cancelled');
    await teardownAll('cancel');
    finished = true;
    state = 'torn_down';
    return result;
  }

  function getSnapshot() {
    return {
      session_id: sessionId,
      plan_id: plan.plan_id,
      state,
      finished,
      torn_down: torndown,
      event_count: events.length,
      tracking: requiredAdapterIds.reduce((acc, id) => { acc[id] = trackingSummary(id); return acc; }, {})
    };
  }

  return Object.freeze({
    prepare, start, feed, finish, cancel,
    getSnapshot,
    getEvents: () => events.slice(),
    getState: () => state,
    isTerminal: () => TERMINAL_STATES.indexOf(state) >= 0
  });
}

export default { createLiveProofSession };
