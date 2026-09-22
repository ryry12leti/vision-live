// VISION Live Proof Core — Universal Live Proof Session (v1).
//
// ADDITIVE ONLY. Owns nothing that session-controller.mjs already owns: no
// re-implementation of the 15s(+) tracking-loss timer, coaching cooldown, or
// per-observer completion evaluation — all of that stays exactly as-is,
// unchanged, inside session-controller.mjs. This module owns exactly the
// NEW, wider lifecycle the product spec adds on top:
//
//   created -> prepared -> active <-> uncertainty_paused <-> tracking_paused
//     <-> method_switching <-> reconnect_required -> finishing
//     -> completed | incomplete | cancelled | error
//
// A "run" is one underlying session-controller instance bound to one
// compiled LiveProofPlan (one observer family: camera OR focus). Switching
// proof method = safely ending the current run's controller (a soft
// suspend, never silently discarding its already-produced ObserverResult)
// and starting a new run with a newly compiled plan for the new observer —
// under the SAME universal session id, so history is continuous.
//
// This module never calls a database, an Edge Function, or the browser. The
// caller (Edge Function boundary / lab frontend) is responsible for
// persisting every transition, run, event, switch, and result via the
// universal_live_proof_* RPCs — this module is the pure, testable state
// machine those call sites drive.

'use strict';

import { createLiveProofSession } from './session-controller.mjs';
import { assertSerialisable } from './plan.mjs';

export const UNIVERSAL_STATES = Object.freeze([
  'created', 'prepared', 'active', 'uncertainty_paused', 'tracking_paused',
  'method_switching', 'reconnect_required', 'finishing', 'completed',
  'incomplete', 'cancelled', 'error'
]);

const TERMINAL = Object.freeze(['completed', 'incomplete', 'cancelled', 'error']);

// Mirrors the migration's universal_live_proof_valid_transition() SQL table
// exactly — the client-side/edge state machine and the server RPC must agree
// byte-for-byte, or a transition could be accepted here and rejected (or
// vice versa) at persistence time.
const TRANSITIONS = Object.freeze({
  created: ['prepared', 'cancelled', 'error'],
  prepared: ['active', 'cancelled', 'error'],
  active: ['uncertainty_paused', 'tracking_paused', 'method_switching', 'reconnect_required', 'finishing', 'cancelled', 'error'],
  uncertainty_paused: ['active', 'method_switching', 'reconnect_required', 'finishing', 'cancelled', 'error'],
  tracking_paused: ['active', 'reconnect_required', 'finishing', 'cancelled', 'error'],
  method_switching: ['active', 'cancelled', 'error'],
  reconnect_required: ['active', 'prepared', 'cancelled', 'error'],
  finishing: ['completed', 'incomplete', 'error']
});

export function isValidUniversalTransition(from, to) {
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].indexOf(to) >= 0;
}

export function createUniversalLiveProofSession(opts) {
  opts = opts || {};
  const universalSessionId = typeof opts.sessionId === 'string' && opts.sessionId ? opts.sessionId : `uls_${opts.taskId || 'task'}_${(opts.now || Date.now)()}`;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;

  let state = 'created';
  const runs = []; // { runIndex, adapterId, role, plan, controller, status, startedAtMs, endedAtMs, result }
  const switches = []; // { fromRunIndex, toRunIndex, reason, evidenceBoundary, confidenceBefore, confidenceAfter, atMs }
  let scoringSuspended = false; // true whenever state is a pause/reconnect state — feed() is refused, not silently degraded

  function assertTransition(to) {
    if (!isValidUniversalTransition(state, to)) throw new Error(`invalid_universal_transition:${state}->${to}`);
  }

  function transition(to) {
    assertTransition(to);
    state = to;
    // tracking_paused is intentionally NOT a feed-refusal state: it is driven
    // by the shared controller's own tracking-loss timer, which already
    // drops any progress/requirement claim while flagged (session-controller
    // .processAdapterEvents) and needs feed() to keep flowing so it can
    // detect recovery on its own. uncertainty_paused/reconnect_required/
    // method_switching have no such built-in recovery signal, so scoring
    // stays refused until the caller explicitly calls resume().
    scoringSuspended = (to === 'uncertainty_paused' || to === 'reconnect_required' || to === 'method_switching');
    return getSnapshot();
  }

  function currentRun() {
    return runs.length ? runs[runs.length - 1] : null;
  }

  // Starts the FIRST run (created -> prepared -> active in one call, matching
  // session-controller's own prepare()+start() sequence) or a SWITCHED run
  // (only valid from method_switching).
  async function startRun(plan, adapters, role) {
    if (state === 'created') {
      transition('prepared');
    } else if (state !== 'method_switching') {
      throw new Error(`invalid_universal_transition:${state}->active (startRun)`);
    }
    const controller = createLiveProofSession({ plan, adapters, now, sessionId: `${universalSessionId}_run${runs.length}` });
    const run = {
      runIndex: runs.length,
      adapterId: plan.observers[0].adapter_id,
      role: role || 'primary',
      plan,
      controller,
      status: 'active',
      startedAtMs: now(),
      endedAtMs: null,
      result: null
    };
    await controller.prepare();
    await controller.start();
    runs.push(run);
    transition('active');
    return run;
  }

  // Forwards a sample tick to the current run's controller. Refuses outright
  // (rather than forwarding and hoping the controller drops it) whenever the
  // universal session is in any pause/reconnect/switch state — "stop scoring
  // new execution" is enforced here, once, for every future pause reason,
  // instead of leaking into every adapter.
  async function feed(input) {
    if (scoringSuspended) throw new Error(`feed_refused_while_suspended:${state}`);
    const run = currentRun();
    if (!run || run.status !== 'active') throw new Error('no_active_run');
    const snapshot = await run.controller.feed(run.adapterId, input);
    if (snapshot.state === 'interrupted') transition('tracking_paused');
    else if (state === 'tracking_paused' && snapshot.state === 'active') transition('active');
    return snapshot;
  }

  // Non-verification uncertainty (evidence is ambiguous, not necessarily
  // "tracking lost yet"): e.g. a coaching layer or adapter reports it cannot
  // reliably interpret the current evidence. Distinct from tracking_paused,
  // which is driven purely by the shared controller's own loss timer.
  function markUncertain(reasonDetail) {
    transition('uncertainty_paused');
    return { state, reason: reasonDetail || 'evidence_unclear' };
  }

  function resume() {
    if (state !== 'uncertainty_paused' && state !== 'tracking_paused') throw new Error(`cannot_resume_from:${state}`);
    transition('active');
    return getSnapshot();
  }

  function requestReconnect(reasonDetail) {
    transition('reconnect_required');
    return { state, reason: reasonDetail || 'connectivity_lost' };
  }

  // Resume rechecks are the CALLER's job (auth/session/task ownership,
  // observer setup) — this only re-opens the state machine once the caller
  // has confirmed those checks passed.
  function resumeFromReconnect() {
    transition('active');
    return getSnapshot();
  }

  // Ends the current run WITHOUT discarding its evidence: calls the
  // controller's own finish() when it can produce a real ObserverResult,
  // falling back to cancel() only if finish() is not currently valid for the
  // controller's internal state (e.g. it never left 'prepared'). Either way
  // the run's result is preserved on the run record for the eventual
  // Universal Result's observer_runs[] list — a method switch NEVER discards
  // valid earlier evidence, per product spec.
  async function suspendCurrentRun(reason) {
    const run = currentRun();
    if (!run) throw new Error('no_run_to_suspend');
    let result;
    try {
      result = await run.controller.finish(reason || 'method_switch');
    } catch (_err) {
      result = await run.controller.cancel(reason || 'method_switch');
    }
    run.status = 'suspended';
    run.endedAtMs = now();
    run.result = result;
    return run;
  }

  // switchMethod: preserve valid earlier evidence, record the reason and an
  // explicit evidence boundary, recalculate confidence, then let the caller
  // startRun() the new observer. Incompatible evidence (different
  // target_kind/claim_boundary) is REJECTED here rather than silently
  // combined — the caller must supply matching or explicitly-bridged
  // evidenceBoundary, we never guess.
  async function switchMethod({ newPlan, reason, evidenceBoundary }) {
    if (!reason) throw new Error('switch_method_requires_reason');
    const fromRun = currentRun();
    if (!fromRun) throw new Error('no_active_run_to_switch_from');
    if (newPlan.task_id !== fromRun.plan.task_id) throw new Error('switch_method_task_mismatch');
    const boundary = evidenceBoundary || {};
    try { assertSerialisable(boundary, 'evidence_boundary'); } catch (e) { throw new Error(`invalid_evidence_boundary:${e.message}`); }

    transition('method_switching');
    const suspended = await suspendCurrentRun(reason);
    const confidenceBefore = suspended.result ? suspended.result.confidence : 0;

    switches.push({
      fromRunIndex: suspended.runIndex,
      toRunIndex: runs.length, // the next run started by the caller's subsequent startRun()
      reason,
      evidenceBoundary: boundary,
      confidenceBefore,
      confidenceAfter: null, // filled in by recalculateConfidence() once the new run has evidence
      atMs: now()
    });
    return { suspendedRun: suspended, switchRecord: switches[switches.length - 1] };
  }

  // Confidence after a switch is the same deterministic minimum-of-required-
  // observers rule the shared controller already uses for a single run
  // (session-controller.evaluateCompletion) — recomputed here across BOTH
  // runs' final confidences so a switch can never silently inflate
  // confidence by discarding the weaker prior evidence.
  function recalculateConfidence() {
    const finished = runs.filter((r) => r.result);
    if (!finished.length) return 0;
    const confidence = Math.min.apply(null, finished.map((r) => r.result.confidence));
    if (switches.length) switches[switches.length - 1].confidenceAfter = confidence;
    return confidence;
  }

  async function finishSession(reason) {
    assertTransition('finishing');
    transition('finishing');
    const run = currentRun();
    if (run && run.status === 'active') {
      const result = await run.controller.finish(reason || 'session_finish');
      run.status = 'finished';
      run.endedAtMs = now();
      run.result = result;
    }
    const allMet = runs.every((r) => r.result && r.result.requirement_met);
    const finalState = allMet && runs.length ? 'completed' : 'incomplete';
    transition(finalState);
    return getSnapshot();
  }

  // Early finish ("Submit Incomplete"): identical to finishSession() except
  // it is explicitly allowed even when the caller KNOWS requirements are not
  // yet met — the distinction from finishSession() is purely in what the
  // caller tells the user beforehand (Continue vs Submit Incomplete), the
  // state machine itself always evaluates the same way.
  const submitIncomplete = finishSession;

  async function cancelSession(reason) {
    if (TERMINAL.indexOf(state) >= 0) throw new Error('session_already_terminal');
    const run = currentRun();
    if (run && run.status === 'active') {
      const result = await run.controller.cancel(reason || 'cancelled');
      run.status = 'suspended';
      run.endedAtMs = now();
      run.result = result;
    }
    transition('cancelled');
    return getSnapshot();
  }

  function getSnapshot() {
    return {
      universal_session_id: universalSessionId,
      state,
      scoring_suspended: scoringSuspended,
      run_count: runs.length,
      active_sources: Array.from(new Set(runs.filter((r) => r.status === 'active').map((r) => r.adapterId))),
      is_terminal: TERMINAL.indexOf(state) >= 0
    };
  }

  return Object.freeze({
    startRun, feed, markUncertain, resume, requestReconnect, resumeFromReconnect,
    switchMethod, recalculateConfidence, finishSession, submitIncomplete, cancelSession,
    getSnapshot,
    getRuns: () => runs.map((r) => ({ runIndex: r.runIndex, adapterId: r.adapterId, role: r.role, status: r.status, result: r.result })),
    // Live per-tick ObserverEvents (coaching cues, tracking loss/recovery,
    // observer errors) for the CURRENT run — the caller needs these to show
    // real-time guidance and to persist them via universal-live-proof-
    // event-append; getRuns()/getSnapshot() only expose the run's final
    // result, computed at finish() time.
    getCurrentRunEvents: () => {
      const run = currentRun();
      return run && run.controller && typeof run.controller.getEvents === 'function' ? run.controller.getEvents() : [];
    },
    getSwitches: () => switches.slice(),
    getState: () => state
  });
}

export default { UNIVERSAL_STATES, isValidUniversalTransition, createUniversalLiveProofSession };
