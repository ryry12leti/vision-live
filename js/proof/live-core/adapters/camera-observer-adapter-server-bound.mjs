// VISION Live Proof Core — SERVER-BOUND camera observer adapter.
//
// Composes the existing, unmodified camera-observer-adapter.mjs (pose
// detection, rep/hold verification, and anti-cheat logic stay byte-for-byte
// what they already are) and, IN PARALLEL, drives the real, already-shipped
// live-session-start / live-session-event / live-session-checkpoint /
// live-session-finish Edge Functions — the SAME server-corroborated
// pipeline (hash-chained events, rep-cadence bounding, phase reconstruction)
// the existing production capture flow already uses.
//
// Why this file exists: the plain camera-observer-adapter.mjs only drives
// the local browser ML engine and self-reports events — nothing server-side
// ever corroborates them. Universal Live Proof's server authority layer
// (universal_live_proof_derive_observer_result_v1) requires a real
// live_sessions row to derive requirement_met/confidence from; this adapter
// is what produces that row, by calling the EXISTING RPC pipeline, not by
// reimplementing any part of it.
//
// `getModalitySessionRef()` returns the real live_sessions.id once prepare()
// has run — this is what the caller passes to
// universal_live_proof_observer_run_start_v1's p_modality_session_ref.

'use strict';

import { createCameraObserverAdapter } from './camera-observer-adapter.mjs';
import { buildPhaseObservation, canonicalPhase } from '../phase-evidence.mjs';

function nowMs() { return Date.now(); }

export function createServerBoundCameraObserverAdapter(options) {
  options = options || {};
  const inner = createCameraObserverAdapter(options);
  const callEdgeFunction = options.callEdgeFunction; // (name, body) => Promise<json>, required
  if (typeof callEdgeFunction !== 'function') throw new Error('server_bound_camera_adapter_requires_callEdgeFunction');
  // (sessionId, checkpointId, dataUrl) => Promise<{accepted_checkpoint_receipt, path, ...}>
  // Optional — checkpoints are simply never satisfied without it (honest
  // 'insufficient'/'client_claim_complete_unverified' evidence_state, never
  // a fabricated pass). Delegates to the SAME storage-upload + checkpoint-RPC
  // helper the existing production capture flow already uses
  // (window.VISION.api.liveSessionUploadCheckpoint in js/vision-api.js) —
  // this adapter never reimplements storage upload or fingerprinting.
  const uploadCheckpoint = typeof options.uploadCheckpoint === 'function' ? options.uploadCheckpoint : null;
  // (checkpoint|null) => void — fired whenever the pending checkpoint
  // changes, so the caller can render real instructions ("Hold the top
  // position") instead of the session just failing closed with
  // final_checkpoint_not_captured with no warning shown to the user.
  const onPendingCheckpoint = typeof options.onPendingCheckpoint === 'function' ? options.onPendingCheckpoint : null;
  // (checkpoint) => void — fired immediately before a checkpoint frame is
  // captured, so the caller can show a short "capturing now" countdown.
  const onCapturingCheckpoint = typeof options.onCapturingCheckpoint === 'function' ? options.onCapturingCheckpoint : null;

  let liveSessionId = null;
  let sessionStartMs = 0;
  let sequenceNumber = 0;
  let lastProgress = { reps: 0, hold_ms: 0, duration_ms: 0 };
  let setupSent = false;
  let lastPhase = '';
  let pendingCheckpoint = null;
  let checkpointUploadInFlight = false;
  let lastStatusPollMs = 0;

  function nextSequence() { sequenceNumber += 1; return sequenceNumber; }
  function elapsedMs() { return Math.max(0, nowMs() - sessionStartMs); }

  function setPendingCheckpoint(checkpoint) {
    pendingCheckpoint = checkpoint || null;
    if (onPendingCheckpoint) { try { onPendingCheckpoint(pendingCheckpoint); } catch (_e) { /* caller's rendering must not break the session */ } }
  }

  // A real photo from the real <video> element — the only source of truth
  // for checkpoint/final evidence. null if no video is wired up (headless
  // tests, or a caller that intentionally runs without checkpoints).
  function captureFrameDataUrl() {
    const video = options.video;
    if (!video || !video.videoWidth) return null;
    try {
      const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
      if (!canvas) return null;
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 540;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (_err) {
      return null;
    }
  }

  // Mirrors js/proof/live/live-ui.js's liveCheckpointMatches() — the server
  // issues a checkpoint naming an expected_phase; we only attempt an upload
  // once the locally-observed phase actually matches it.
  function checkpointMatches(checkpoint, rawState) {
    if (!checkpoint || !rawState || !rawState.poseTracking) return false;
    const expected = String(checkpoint.expected_phase || '');
    const phase = canonicalPhase(rawState) || String(rawState.phase || '');
    if (expected === 'hold') return phase === 'hold' || (rawState.holdMs || 0) > 0;
    if (expected === 'active') return phase === 'active';
    if (expected === 'drive') return /_drive$/.test(phase);
    return phase === expected;
  }

  // Mirrors js/proof/live/live-ui.js's liveChallengeCountdownComplete().
  function challengeCountdownComplete(checkpoint) {
    if (!checkpoint || checkpoint.checkpoint_type !== 'challenge') return true;
    const payload = checkpoint.challenge_payload || {};
    const issued = Date.parse(checkpoint.issued_at || '');
    return !Number.isFinite(issued) || nowMs() >= issued + Math.max(0, Number(payload.countdown_seconds) || 0) * 1000;
  }

  async function maybeProcessPendingCheckpoint(rawState) {
    if (!pendingCheckpoint || checkpointUploadInFlight || pendingCheckpoint.checkpoint_type === 'final') return;
    if (!uploadCheckpoint) return;
    if (!challengeCountdownComplete(pendingCheckpoint) || !checkpointMatches(pendingCheckpoint, rawState)) return;
    if (onCapturingCheckpoint) { try { onCapturingCheckpoint(pendingCheckpoint); } catch (_e) { /* ignore */ } }
    const frame = captureFrameDataUrl();
    if (!frame) return;
    checkpointUploadInFlight = true;
    try {
      const receipt = await uploadCheckpoint(liveSessionId, pendingCheckpoint.checkpoint_id, frame);
      if (receipt && receipt.accepted_checkpoint_receipt) setPendingCheckpoint(null);
    } catch (err) {
      console.warn('server_bound_camera_adapter: checkpoint upload failed', err);
    } finally {
      checkpointUploadInFlight = false;
    }
  }

  // setup/mid/challenge checkpoints surface via live-session-status polling
  // (mid/challenge become due partway through the session; setup is already
  // returned by live-session-start). Throttled — this is a corroboration
  // signal, not a tight loop.
  async function maybePollStatus() {
    if (!liveSessionId || nowMs() - lastStatusPollMs < 4000) return;
    lastStatusPollMs = nowMs();
    try {
      const res = await callEdgeFunction('live-session-status', { session_id: liveSessionId });
      if (res && Object.prototype.hasOwnProperty.call(res, 'pending_checkpoint')) {
        setPendingCheckpoint(res.pending_checkpoint);
      }
    } catch (err) {
      console.warn('server_bound_camera_adapter: status poll failed', err);
    }
  }

  async function postEvent(eventType, payload) {
    try {
      await callEdgeFunction('live-session-event', {
        session_id: liveSessionId, sequence_number: nextSequence(), client_monotonic_ms: elapsedMs(),
        event_type: eventType, event_payload: payload || {}
      });
    } catch (err) {
      // Server-side corroboration is best-effort here — if a single event
      // post fails (network blip), the session's own finish-time aggregation
      // simply sees less evidence, never fabricated evidence. Never throw
      // out of the sample loop for this.
      console.warn('server_bound_camera_adapter: live-session-event failed', err);
    }
  }

  return {
    adapterId: 'camera',

    getModalitySessionRef() { return liveSessionId; },

    supports(plan) { return inner.supports(plan); },

    async prepare(context) {
      await inner.prepare(context);
      const observerConfig = context.observerConfig || {};
      const started = await callEdgeFunction('live-session-start', {
        task_id: context.taskId,
        device: options.device || {}
      });
      liveSessionId = started && (started.session_id || started.id);
      if (!liveSessionId) throw new Error('server_bound_camera_adapter_no_live_session_id');
      sessionStartMs = nowMs();
      sequenceNumber = 0;
      setupSent = false;
      lastPhase = '';
      lastProgress = { reps: 0, hold_ms: 0, duration_ms: 0 };
      setPendingCheckpoint((started && started.pending_checkpoint) || null);
      lastStatusPollMs = sessionStartMs;
      // stash target_kind for translating progress_updated deltas below
      this._targetKind = (context.requirement || {}).target_kind;
    },

    async start(context) { await inner.start(context); },

    async sample(input) {
      const events = await inner.sample(input);
      for (const evt of events) {
        if (evt.type === 'observation_valid' && !setupSent) {
          setupSent = true;
          await postEvent('client_setup_candidate', {});
        }
        if (evt.type === 'progress_updated') {
          const targetKind = this._targetKind;
          if (targetKind === 'reps' && evt.reps > lastProgress.reps) {
            for (let i = lastProgress.reps; i < evt.reps; i++) await postEvent('client_rep_candidate', { index: i + 1 });
            lastProgress.reps = evt.reps;
          } else if (targetKind === 'hold_seconds' && evt.hold_ms > lastProgress.hold_ms) {
            const deltaMs = Math.min(250, evt.hold_ms - lastProgress.hold_ms);
            await postEvent('client_hold_sample', { active_ms: deltaMs });
            lastProgress.hold_ms = evt.hold_ms;
          } else if (targetKind === 'duration_seconds' && evt.duration_ms > lastProgress.duration_ms) {
            const deltaMs = Math.min(1000, evt.duration_ms - lastProgress.duration_ms);
            await postEvent('client_activity_sample', { active_ms: deltaMs });
            lastProgress.duration_ms = evt.duration_ms;
          }
        }
      }
      // Server-side rep reconstruction (live_reconstruct_reps_v2) is driven
      // entirely by client_phase_observation events, not by client_rep_
      // candidate — without this, every rep-based session ends
      // missing_phase_evidence regardless of how many reps were counted
      // locally. Sampled at this adapter's own tick cadence (the caller's
      // feed() interval), not every internal engine frame — coarser than
      // the legacy js/proof/live/phase-evidence-bridge.js bridge, but real
      // server-verifiable evidence instead of none.
      const diag = typeof inner.getDiagnostics === 'function' ? inner.getDiagnostics() : null;
      const rawState = diag && diag.rawState;
      if (rawState) {
        const observation = buildPhaseObservation(rawState, lastPhase);
        lastPhase = observation.phase;
        if (observation.payload) await postEvent('client_phase_observation', observation.payload);
        await maybePollStatus();
        await maybeProcessPendingCheckpoint(rawState);
      }
      return events;
    },

    getDiagnostics() { return inner.getDiagnostics(); },

    // Mirrors js/proof/live/live-ui.js's ensureFinalLiveCheckpoint(): the
    // server names a final checkpoint, we capture+upload a real frame that
    // matches it, and only THEN call live-session-finish. Without
    // uploadCheckpoint (no storage capability supplied), this honestly
    // fails closed rather than pretending a final checkpoint happened.
    //
    // Ordering matters: this loop runs BEFORE inner.finish(context) — the
    // previous version called inner.finish() first, which stops the
    // underlying pose engine (camera-observer-adapter.mjs's finish() calls
    // controller.stop()), so by the time this loop read rawState via
    // inner.getDiagnostics() it was already frozen at whatever the engine
    // last saw before stopping. The match check also used to be a single
    // instant read with no wait — the caller could show "hold the top
    // position" and fail before the user had any real chance to move.
    // Both are fixed here: the pose engine is still live while this loop
    // polls (up to ~5s per attempt) for the requested phase to actually
    // appear.
    async finish(context) {
      if (liveSessionId && uploadCheckpoint) {
        let finalCaptured = false;
        for (let attempt = 0; attempt < 4 && !finalCaptured; attempt++) {
          let response;
          try {
            response = await callEdgeFunction('live-session-checkpoint', { session_id: liveSessionId, action: 'request_final', checkpoint_id: '', path: '', fingerprint: '' });
          } catch (err) {
            console.warn('server_bound_camera_adapter: request_final failed', err);
            break;
          }
          const checkpoint = response && response.pending_checkpoint;
          if (!checkpoint) break;
          setPendingCheckpoint(checkpoint);

          // Real capture window: poll every 400ms for up to ~5s for the
          // requested phase/challenge condition to actually be met, instead
          // of one instant check-and-fail. The pose engine is still running
          // (inner.finish() has not been called yet), so rawState here is
          // live, not stale.
          let matched = false;
          for (let waited = 0; waited < 5000; waited += 400) {
            const rawState = (typeof inner.getDiagnostics === 'function' && inner.getDiagnostics().rawState) || null;
            if (challengeCountdownComplete(checkpoint) && checkpointMatches(checkpoint, rawState)) { matched = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 400));
          }
          if (!matched) break;

          if (onCapturingCheckpoint) { try { onCapturingCheckpoint(checkpoint); } catch (_e) { /* ignore */ } }
          const frame = captureFrameDataUrl();
          if (!frame) break;
          try {
            const receipt = await uploadCheckpoint(liveSessionId, checkpoint.checkpoint_id, frame);
            if (receipt && receipt.accepted_checkpoint_receipt) {
              setPendingCheckpoint(null);
              if (checkpoint.checkpoint_type === 'final') finalCaptured = true;
            } else break;
          } catch (err) {
            console.warn('server_bound_camera_adapter: final checkpoint upload failed', err);
            break;
          }
        }
        if (!finalCaptured) {
          throw new Error('server_bound_camera_adapter_final_checkpoint_not_captured');
        }
      }

      // Only now does the pose engine stop and the local result compute —
      // after the final checkpoint (which depends on it still running) is
      // already captured.
      const result = await inner.finish(context);

      // live-session-finish is NOT best-effort: it is what turns the posted
      // events into a server-derived evidence_state/integrity_state. If it
      // fails, this session has no server corroboration at all and must not
      // be reported as a success — throw so the shared session controller
      // (session-controller.mjs finish()) records an honest observer_error/
      // requirement_met:false result instead of a silently-downgraded local
      // "success". The caller decides whether that's retryable.
      const v3Evidence = typeof inner.getV3Evidence === 'function' ? inner.getV3Evidence() : null;
      await callEdgeFunction('live-session-finish', {
        session_id: liveSessionId, sequence_number: nextSequence(), client_monotonic_ms: elapsedMs(),
        summary: v3Evidence ? { telemetry: { v3_evidence: v3Evidence } } : {}
      });

      return result;
    },

    async teardown(reason) { await inner.teardown(reason); }
  };
}

export default { createServerBoundCameraObserverAdapter };
