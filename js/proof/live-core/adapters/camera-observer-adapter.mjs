// VISION Live Proof Core — camera observer adapter.
//
// Wraps the EXISTING camera/movement Live Proof runtime (js/vision-live-coach.js,
// window.VISION.liveCoach.create) — it does not reimplement pose detection,
// rep/hold/duration verification, or anti-cheat. That runtime is push-based
// (it drives its own setInterval loop against a <video> element and calls
// onUpdate(state) on its own schedule); this adapter's job is purely
// translation: Live Proof Plan -> runtime configuration -> the runtime's own
// onUpdate(state) snapshots -> common ObserverEvents -> a common
// ObserverResult. No verification logic lives here.
//
// Wiring this adapter into a real browser session (supplying `video` and
// letting the default controllerFactory resolve window.VISION.liveCoach.create)
// is explicitly OUT OF SCOPE for Live Proof Core V1 — no production frontend
// changes are made in this task. This file is exercised headlessly today
// against a fake controller that reproduces the real runtime's documented
// state shape (see scripts/qa-live-proof-core-camera.mjs).

'use strict';

import { createObserverEvent, createObserverResult } from '../universal/observer-adapter.mjs';

function defaultControllerFactory(opts) {
  const liveCoach = typeof globalThis !== 'undefined' && globalThis.VISION && globalThis.VISION.liveCoach;
  if (!liveCoach || typeof liveCoach.create !== 'function') {
    throw new Error('camera_runtime_unavailable: window.VISION.liveCoach is not loaded — import js/vision-live-coach.js before using the real camera adapter');
  }
  return liveCoach.create(opts);
}

// Best-effort reconstruction of the legacy `task` shape vision-live-coach.js
// reads (a proofContract-bearing task object). The exact shape the runtime
// wants is owned by that file, not by this adapter; wiring this into a real
// browser session may need adjustment there — tracked as a V1 limitation.
//
// live proofContract v2 requires a non-blank reject_if (VISION.proofContract.
// normalize() fails closed with 'live_missing_reject_rules' otherwise — see
// js/vision-proof-contract.js). The Live Proof Plan carries no reject-rule
// text of its own (compiler.mjs's requirement is only description/target_kind/
// target_value/sets), so this is a generic, capability-agnostic rejection
// rule, not a fabricated per-capability claim.
const GENERIC_LIVE_REJECT_IF = 'Reject if a repetition is incomplete, assisted, or the required body landmarks are not visible to the camera.';

function buildLegacyTaskShape(context, observerConfig) {
  const req = context.requirement || {};
  return {
    id: context.taskId,
    title: req.description || '',
    proofContract: {
      version: 2, proof_type: 'live',
      capability_id: observerConfig.capability_id,
      verifier_id: observerConfig.verifier_id,
      verifier_version: observerConfig.verifier_version || 1,
      target_kind: req.target_kind, target_value: req.target_value,
      sets: req.sets || null,
      reject_if: GENERIC_LIVE_REJECT_IF,
      required_camera_view: observerConfig.camera_view || null,
      accepted_camera_views: observerConfig.accepted_camera_views || [],
      required_landmarks: observerConfig.required_landmarks || []
    }
  };
}

function isMeaningfullyDifferent(a, b) {
  return a.reps !== b.reps || a.rejected_reps !== b.rejected_reps || a.hold_ms !== b.hold_ms || a.duration_ms !== b.duration_ms;
}

export function createCameraObserverAdapter(options) {
  options = options || {};
  const controllerFactory = typeof options.controllerFactory === 'function' ? options.controllerFactory : defaultControllerFactory;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  let controller = null;
  let queue = [];
  let lastState = null;
  let lastEmittedCue = null;
  let lastProgress = { reps: 0, rejected_reps: 0, hold_ms: 0, duration_ms: 0 };
  let requirementMetEmitted = false;

  function onUpdate(state) { queue.push(state); lastState = state; }

  function progressFromState(state) {
    return {
      reps: state.clientCountedReps || 0,
      rejected_reps: state.clientRejectedReps || 0,
      hold_ms: state.holdMs || 0,
      duration_ms: state.clientClaimedDurationMs || 0
    };
  }

  function translateState(state) {
    const events = [];
    const atMs = typeof state._at_ms === 'number' ? state._at_ms : now();
    const tracked = !!state.poseTracking;

    if (tracked) events.push(createObserverEvent('camera', 'observation_valid', { timestamp_ms: atMs, tracking_confidence: state.trackingConfidence || 0 }));

    if (state.lastCue && state.lastCue !== lastEmittedCue) {
      lastEmittedCue = state.lastCue;
      events.push(createObserverEvent('camera', 'coaching_cue', { timestamp_ms: atMs, source: 'camera', code: 'runtime_cue', message: state.lastCue, severity: 'guidance' }));
    }

    if (tracked) {
      const progress = progressFromState(state);
      if (isMeaningfullyDifferent(progress, lastProgress)) {
        lastProgress = progress;
        events.push(createObserverEvent('camera', 'progress_updated', Object.assign({ timestamp_ms: atMs }, progress)));
      }
    }

    if (state.engineStatus === 'failed') {
      events.push(createObserverEvent('camera', 'observer_error', { timestamp_ms: atMs, message: state.lastCue || state.evidenceState || 'camera_engine_failed' }));
    }

    if (!requirementMetEmitted && state.targetReached) {
      requirementMetEmitted = true;
      events.push(createObserverEvent('camera', 'requirement_met', { timestamp_ms: atMs }));
    }

    return events;
  }

  return {
    adapterId: 'camera',

    supports(plan) {
      const observer = plan.observers.find((o) => o.adapter_id === 'camera');
      if (!observer) return { supported: false, reason: 'plan_has_no_camera_observer' };
      if (!observer.verifier_id || !observer.capability_id) return { supported: false, reason: 'camera_observer_missing_capability' };
      return { supported: true };
    },

    async prepare(context) {
      const observerConfig = context.observerConfig;
      if (!observerConfig) throw new Error('camera_adapter_missing_observer_config');
      controller = controllerFactory({
        video: options.video || null,
        task: buildLegacyTaskShape(context, observerConfig),
        onUpdate
      });
      if (!controller) throw new Error('camera_runtime_unavailable');
    },

    async start() {
      if (!controller) throw new Error('camera_adapter_not_prepared');
      await controller.start();
    },

    async sample() {
      const batch = queue.splice(0, queue.length);
      const events = [];
      for (const state of batch) events.push(...translateState(state));
      return events;
    },

    // Read-only introspection for lab diagnostics only — never used by the
    // event/verification path above. Surfaces the real runtime's own status
    // (js/vision-live-coach.js already tracks engineStatus/poseReady/isV3()/
    // getV3Diagnostics() for its own HUD; this just exposes it to a caller).
    getDiagnostics() {
      const hasController = !!controller;
      const isV3 = hasController && typeof controller.isV3 === 'function' ? controller.isV3() : null;
      const rawState = hasController && typeof controller.getState === 'function' ? controller.getState() : lastState;
      const v3Diagnostics = hasController && isV3 && typeof controller.getV3Diagnostics === 'function' ? controller.getV3Diagnostics() : null;
      return { hasController, isV3, rawState, v3Diagnostics };
    },

    // Structured V3 evidence (engine id, verifier id/version, mode, reps/
    // hold/duration, rejection tally, calibration, camera view) straight
    // from the real runtime's own getV3Evidence() — never reconstructed or
    // estimated here. null when the session never reached a V3 verifier.
    getV3Evidence() {
      return controller && typeof controller.getV3Evidence === 'function' ? controller.getV3Evidence() : null;
    },

    async finish() {
      try { if (controller && typeof controller.stop === 'function') controller.stop(); } catch (_) { /* teardown must not throw */ }
      const state = lastState || {};
      const confidence = typeof state.trackingConfidence === 'number' ? state.trackingConfidence : (state.poseTracking ? 1 : 0);
      const issues = [];
      const strengths = [];
      if ((state.clientRejectedReps || 0) > 0) issues.push('rejected_reps_detected');
      if (state.targetReached) strengths.push('target_reached');
      else if ((state.clientCountedReps || 0) > 0 || (state.holdMs || 0) > 0) issues.push('target_not_reached');
      return createObserverResult({
        adapter_id: 'camera',
        requirement_met: !!state.targetReached,
        confidence,
        evidence_summary: {
          reps: state.clientCountedReps || 0,
          rejected_reps: state.clientRejectedReps || 0,
          hold_ms: state.holdMs || 0,
          duration_ms: state.clientClaimedDurationMs || 0,
          evidence_state: state.evidenceState || null
        },
        issues, strengths
      });
    },

    async teardown() {
      try { if (controller && typeof controller.stop === 'function') controller.stop(); } catch (_) { /* never throw during teardown */ }
      controller = null; queue = []; lastState = null; lastEmittedCue = null; lastProgress = { reps: 0, rejected_reps: 0, hold_ms: 0, duration_ms: 0 }; requirementMetEmitted = false;
    }
  };
}

export default { createCameraObserverAdapter };
