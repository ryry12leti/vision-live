// VISION Live Proof Core — focus/screen observer adapter.
//
// Wraps the existing server-authoritative FocusSessionController. It verifies
// a focused work PROCESS: presence, active duration, checkpoint compliance
// and required-material state. It never claims the work is correct or that an
// external outcome occurred.

'use strict';

import { createObserverEvent, createObserverResult } from '../universal/observer-adapter.mjs';

function defaultControllerFactory(opts) {
  const client = typeof globalThis !== 'undefined' && globalThis.VISION && globalThis.VISION.focusHybridClient;
  if (!client || typeof client.createFocus !== 'function') {
    throw new Error('focus_runtime_unavailable: window.VISION.focusHybridClient is not loaded');
  }
  return client.createFocus(opts);
}

export function createFocusObserverAdapter(options) {
  options = options || {};
  const controllerFactory = typeof options.controllerFactory === 'function'
    ? options.controllerFactory
    : defaultControllerFactory;
  const now = typeof options.now === 'function' ? options.now : Date.now;

  let focus = null;
  let requirementMetEmitted = false;

  function isVisible() {
    const doc = options.document || (typeof document !== 'undefined' ? document : null);
    return !(doc && doc.hidden);
  }

  function snapshot() {
    return focus ? focus.snapshot() : {
      state: 'idle', sessionId: null, targetSeconds: 0,
      activeMs: 0, inactiveMs: 0, checkpointsMet: 0,
      checkpointCount: 0, materialPresent: false, requireMaterial: false,
      screenSharing: false
    };
  }

  return {
    adapterId: 'focus',

    getModalitySessionRef() {
      return focus && focus.sessionId ? focus.sessionId : null;
    },

    getCheckpointSnapshot() {
      const snap = snapshot();
      return {
        checkpointsMet: snap.checkpointsMet,
        checkpointCount: snap.checkpointCount,
        nextSequence: snap.checkpointsMet < snap.checkpointCount
          ? snap.checkpointsMet + 1
          : null
      };
    },

    getProgressSnapshot() {
      return Object.assign({}, snapshot());
    },

    supports(plan) {
      const observer = plan.observers.find((o) => o.adapter_id === 'focus');
      if (!observer) return { supported: false, reason: 'plan_has_no_focus_observer' };
      if (typeof observer.target_duration_seconds !== 'number' || observer.target_duration_seconds <= 0) {
        return { supported: false, reason: 'focus_observer_missing_target' };
      }
      return { supported: true };
    },

    async prepare(context) {
      focus = controllerFactory({
        client: options.client,
        document: options.document,
        window: options.window,
        mediaDevices: options.mediaDevices,
        inactivityThresholdMs: options.inactivityThresholdMs
      });
      if (!focus) throw new Error('focus_runtime_unavailable');
      await focus.start({
        taskId: context.taskId,
        materialPresent: !!options.initialMaterialPresent,
        device: options.device || {}
      });
    },

    async start() {
      // focus_session_start_v2 has already created the active server session.
    },

    async sample(input) {
      input = input || {};
      if (!focus) throw new Error('focus_adapter_not_prepared');

      const atMs = typeof input.at_ms === 'number' ? input.at_ms : now();
      const events = [];

      if (input.activityKind) focus.markActivity(input.activityKind);
      if (typeof input.materialPresent === 'boolean') {
        focus.setMaterialPresent(input.materialPresent);
      }

      if (input.screenShare) {
        try {
          await focus.requestScreenShare(input.screenShare.consent === true);
          events.push(createObserverEvent('focus', 'coaching_cue', {
            timestamp_ms: atMs,
            source: 'focus',
            code: 'screen_share_started',
            message: 'Screen sharing started.',
            severity: 'guidance'
          }));
        } catch (err) {
          events.push(createObserverEvent('focus', 'observer_error', {
            timestamp_ms: atMs,
            code: err && err.code ? String(err.code) : 'screen_share_failed',
            message: String((err && err.message) || err)
          }));
        }
      }

      let snap = focus.sample(atMs);
      if (isVisible()) {
        events.push(createObserverEvent('focus', 'observation_valid', {
          timestamp_ms: atMs
        }));
      }

      events.push(createObserverEvent('focus', 'progress_updated', {
        timestamp_ms: atMs,
        active_ms: snap.activeMs,
        inactive_ms: snap.inactiveMs,
        target_seconds: snap.targetSeconds,
        checkpoints_met: snap.checkpointsMet,
        checkpoint_count: snap.checkpointCount,
        material_present: snap.materialPresent,
        material_required: snap.requireMaterial
      }));

      const explicitSequence = typeof input.checkpointSequence === 'number'
        ? input.checkpointSequence
        : null;

      if (explicitSequence != null) {
        try {
          const acknowledged = await focus.respondCheckpoint(explicitSequence);
          snap = focus.snapshot();
          events.push(createObserverEvent('focus', 'coaching_cue', {
            timestamp_ms: atMs,
            source: 'focus',
            code: 'checkpoint_acknowledged',
            sequence: explicitSequence,
            elapsed_seconds: acknowledged && acknowledged.elapsed_seconds,
            message: `Checkpoint ${explicitSequence} verified.`,
            severity: 'guidance'
          }));
        } catch (err) {
          events.push(createObserverEvent('focus', 'observer_error', {
            timestamp_ms: atMs,
            code: err && err.code ? String(err.code) : 'checkpoint_not_verified',
            available_in_seconds: Number(err && err.availableInSeconds) || 0,
            sequence: explicitSequence,
            message: String((err && err.message) || err)
          }));
        }
      }

      const targetMs = snap.targetSeconds * 1000;
      if (!requirementMetEmitted
          && snap.activeMs >= Math.floor(targetMs * 0.85)
          && snap.checkpointsMet >= snap.checkpointCount
          && (!snap.requireMaterial || snap.materialPresent)) {
        requirementMetEmitted = true;
        events.push(createObserverEvent('focus', 'requirement_met', {
          timestamp_ms: atMs
        }));
      }

      return events;
    },

    async finish() {
      if (!focus) throw new Error('focus_adapter_not_prepared');

      const data = await focus.finish();
      const snap = focus.snapshot();
      const requirementMet = !!(data && data.can_submit_for_review);
      const confidence = snap.targetSeconds > 0
        ? Math.max(0, Math.min(1, snap.activeMs / (snap.targetSeconds * 1000)))
        : 0;
      const issues = [];
      const strengths = [];

      if (snap.checkpointsMet < snap.checkpointCount) issues.push('missing_checkpoints');
      if (snap.requireMaterial && !snap.materialPresent) issues.push('required_material_absent');
      if (data && Array.isArray(data.flags)) issues.push(...data.flags);
      if (requirementMet) strengths.push('active_duration_and_checkpoints_met');

      return createObserverResult({
        adapter_id: 'focus',
        requirement_met: requirementMet,
        confidence,
        evidence_summary: {
          focus_session_id: snap.sessionId,
          server_elapsed_ms: Number(data && data.server_elapsed_ms) || 0,
          active_ms: Number(data && data.active_ms) || snap.activeMs,
          inactive_ms: snap.inactiveMs,
          active_ratio: Number(data && data.active_ratio) || 0,
          checkpoints_met: Number(data && data.checkpoints_met) || snap.checkpointsMet,
          checkpoint_count: Number(data && data.checkpoints_required) || snap.checkpointCount,
          material_present: snap.materialPresent,
          material_required: snap.requireMaterial,
          screen_sharing_used: snap.screenSharing
        },
        issues: Array.from(new Set(issues)),
        strengths
      });
    },

    async teardown(reason) {
      try {
        if (focus) focus.stop(reason || 'teardown');
      } catch (_) {
        // teardown must remain fail-safe
      }
      focus = null;
      requirementMetEmitted = false;
    }
  };
}

export default { createFocusObserverAdapter };
