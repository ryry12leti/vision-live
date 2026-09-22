// VISION · Universal Live Proof — real Tasks page entry point.
//
// OWNER-GATED ONLY (same real server RPC every other owner-only feature in
// this app uses, see js/tasks/demo-harness.js — no client-side flag, no URL
// param, a real is_owner() check against whatever Supabase project this
// deployment is actually pointed at). Normal users never see any of this.
//
// Universal Live Proof's backend (universal_live_proof_* tables/RPCs/Edge
// Functions) exists today ONLY on the staging project
// (apodoacfdcxlmxturmhp) — it has not been deployed to production. This
// panel always calls whatever Supabase project the page's own VISION.sb
// client is already configured for (never hardcodes an environment), so:
//   - on a staging/preview deployment, this works for real, end to end;
//   - on production, the owner-gate still resolves correctly (it's a real
//     RPC against production's own owner_allowlist), but the Universal
//     Live Proof calls themselves will fail — this is caught and shown as
//     an honest "not available in this environment yet" message, never a
//     crash, never a fake success.
//
// It does not replace, modify, or render anything from the existing proof
// capture flow (proof-orchestrator.js / task-detail.js are untouched) — it
// is a separate, additive panel with its own DOM container.
'use strict';

import { createUniversalLiveProofSession } from '/js/proof/live-core/universal/universal-session.mjs';
import { confidenceLabelFor, recommendationFor, computeExecutionScore } from '/js/proof/live-core/universal/universal-result.mjs';
import { createServerBoundCameraObserverAdapter } from '/js/proof/live-core/adapters/camera-observer-adapter-server-bound.mjs';
import { createFocusObserverAdapter } from '/js/proof/live-core/adapters/focus-observer-adapter.mjs';

const state = {
  ownerReady: false, ownerChecked: false, task: null, plan: null, uls: null, adapter: null, adapterId: null,
  runId: null, sessionId: null, planId: null, planVersion: null, stream: null, feedTimer: null,
  startedAtIso: null, lastSavedResult: null, materialPresent: false, lastPersistedLocalState: null,
  lastAppendedEventCount: 0, reconnecting: false, connectivityInterruptions: [], feedActive: false
};

function $(id) { return document.getElementById(id); }

function newClientToken() {
  try { if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID(); } catch (_e) { /* fall through */ }
  return `ulp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function edgeCall(fn, body) {
  const sb = window.VISION && window.VISION.sb;
  if (!sb) throw new Error('supabase_client_unavailable');
  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) throw new Error('supabase_config_unavailable');
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData && sessionData.session && sessionData.session.access_token;
  if (!token) throw new Error('not_signed_in');
  const res = await fetch(`${cfg.url}/functions/v1/${fn}`, {
    method: 'POST', headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* non-JSON error body */ }
  if (!res.ok) {
    const err = new Error((json && json.error) || `${fn} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// Resolved once, cached — checked against the REAL server-authoritative
// is_owner() RPC, exactly like js/tasks/demo-harness.js already does.
async function checkOwnerGate() {
  if (state.ownerChecked) return state.ownerReady;
  state.ownerChecked = true;
  try {
    const sb = window.VISION && window.VISION.sb;
    if (!sb) return false;
    const { data, error } = await sb.rpc('is_owner');
    state.ownerReady = !error && data === true;
  } catch (_e) {
    state.ownerReady = false;
  }
  return state.ownerReady;
}

function panelEl() { return $('universalLiveProofPanel'); }
function setStatus(text) { const el = $('ulpStatus'); if (el) el.textContent = text; }
function setOutput(obj) { const el = $('ulpOutput'); if (el) el.textContent = JSON.stringify(obj, null, 2); }

// Best-effort, never blocks closing: tears down whatever this session
// actually reached (adapter observer + underlying camera/focus runtime,
// then the Universal session itself) instead of only stopping the video
// stream. A half-open server session left 'active' after the panel is
// simply closed is exactly what this is trying to prevent.
async function teardownActiveSession(reason) {
  try { if (state.adapter && typeof state.adapter.teardown === 'function') await state.adapter.teardown(reason); } catch (_e) { /* never block teardown */ }
  try {
    if (state.uls && typeof state.uls.getState === 'function') {
      const terminal = ['completed', 'incomplete', 'cancelled', 'error'];
      if (!terminal.includes(state.uls.getState())) await state.uls.cancelSession(reason);
    }
  } catch (_e) { /* never block teardown */ }
  if (state.sessionId) {
    try { await edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: 'cancelled', reason }); } catch (_e) { /* server may already consider it terminal */ }
  }
}

// Async on purpose (item #12 fix): teardownActiveSession() awaits the
// adapter teardown and reads state.sessionId to send the server cancel —
// the caller MUST await this before clearing state.sessionId/state.adapter,
// or the cancel transition silently sends null and a stale 'active' server
// session is left behind. The previous fire-and-forget version had exactly
// that race.
async function closePanel(reason) {
  stopFeedLoop();
  window.removeEventListener('offline', handleOffline);
  window.removeEventListener('online', handleOnline);
  await teardownActiveSession(reason || 'panel_closed');
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  const p = panelEl(); if (p) p.style.display = 'none';
  document.body.style.overflow = '';
  const card = $('ulpResultCard'); if (card) card.style.display = 'none';
  const hint = $('ulpCheckpointHint'); if (hint) hint.style.display = 'none';
  const offlineBanner = $('ulpOfflineBanner'); if (offlineBanner) offlineBanner.style.display = 'none';
  const focusControls = $('ulpFocusControls'); if (focusControls) focusControls.style.display = 'none';
  state.adapter = null; state.adapterId = null; state.runId = null; state.sessionId = null;
  state.uls = null; state.startedAtIso = null; state.lastSavedResult = null;
  state.materialPresent = false; state.lastPersistedLocalState = null; state.lastAppendedEventCount = 0; state.reconnecting = false; state.connectivityInterruptions = [];
}

async function openPanel(task) {
  const p = panelEl();
  if (!p) return;
  state.task = task; state.uls = null; state.plan = null; state.runId = null; state.startedAtIso = null; state.lastSavedResult = null;
  state.materialPresent = false; state.lastPersistedLocalState = null; state.lastAppendedEventCount = 0; state.reconnecting = false; state.connectivityInterruptions = [];
  p.style.display = 'flex'; document.body.style.overflow = 'hidden';
  setStatus('compiling plan…'); setOutput({});
  const card = $('ulpResultCard'); if (card) card.style.display = 'none';
  const hint = $('ulpCheckpointHint'); if (hint) hint.style.display = 'none';
  const offlineBanner = $('ulpOfflineBanner'); if (offlineBanner) offlineBanner.style.display = 'none';
  const focusControls = $('ulpFocusControls'); if (focusControls) focusControls.style.display = 'none';
  if ($('ulpMaterialPresent')) $('ulpMaterialPresent').checked = false;
  $('ulpTitle').textContent = task.title || 'Universal Live Proof';
  $('ulpStartCamera').disabled = true; $('ulpStartFocus').disabled = true;
  $('ulpFinish').disabled = true; $('ulpSubmitIncomplete').disabled = true;
  window.addEventListener('offline', handleOffline);
  window.addEventListener('online', handleOnline);

  let planRes;
  try {
    planRes = await edgeCall('universal-live-proof-plan', { task_id: task.id });
  } catch (err) {
    setStatus('Universal Live Proof is not available in this environment yet.');
    setOutput({ error: String(err && err.message || err) });
    return;
  }
  if (!planRes || planRes.supported !== true) {
    setStatus('This task does not have a Universal Live Proof method yet — use the normal proof flow.');
    setOutput(planRes || {});
    return;
  }
  state.plan = planRes.plan; state.planId = planRes.plan_id; state.planVersion = planRes.plan_version;

  const sessionRes = await edgeCall('universal-live-proof-session-create', { plan_id: state.planId, client_session_token: newClientToken() });
  state.sessionId = sessionRes.session_id;
  state.uls = createUniversalLiveProofSession({ sessionId: state.sessionId, taskId: task.id });
  await edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: 'prepared', reason: 'panel_prepare' });

  const adapterId = state.plan.observers[0].adapter_id;
  setStatus(`ready — method: ${adapterId}`);
  $('ulpStartCamera').disabled = adapterId !== 'camera';
  $('ulpStartFocus').disabled = adapterId !== 'focus';
}

function setCheckpointHint(checkpoint) {
  const hint = $('ulpCheckpointHint');
  if (!hint) return;
  if (!checkpoint) { hint.style.display = 'none'; return; }
  const phraseByPhase = { top: 'Hold the top position', bottom: 'Hold the bottom position', hold: 'Hold your current position', active: 'Keep moving — stay visible to the camera' };
  const instruction = checkpoint.instruction || phraseByPhase[checkpoint.expected_phase] || 'Hold your current position';
  const label = checkpoint.checkpoint_type === 'challenge' ? 'Anti-cheat check' : checkpoint.checkpoint_type === 'final' ? 'Final verification' : 'Checkpoint';
  hint.textContent = `${label}: ${instruction} — keep your full body visible.`;
  hint.style.display = 'block';
}

async function startRun(adapterId) {
  // Buttons disable immediately on click (item #13) — a double click or a
  // retried request must not start two runs before the first RPC returns.
  $('ulpStartCamera').disabled = true; $('ulpStartFocus').disabled = true;
  try {
    // Camera permission + adapter setup happen BEFORE the session is told
    // it's 'active' — a denied permission or a setup failure must leave the
    // server session at 'prepared' (retryable / cleanly cancellable), never
    // stranded 'active' with no observer actually running.
    let adapter;
    if (adapterId === 'camera') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      state.stream = stream;
      const video = $('ulpVideo'); if (video) { video.srcObject = stream; await video.play().catch(() => {}); }
      const api = window.VISION && window.VISION.api;
      const uploadCheckpoint = api && typeof api.liveSessionUploadCheckpoint === 'function'
        ? (sessionId, checkpointId, photo) => api.liveSessionUploadCheckpoint(sessionId, checkpointId, photo)
        : undefined;
      adapter = createServerBoundCameraObserverAdapter({
        video, callEdgeFunction: edgeCall, uploadCheckpoint,
        onPendingCheckpoint: setCheckpointHint,
        onCapturingCheckpoint: (checkpoint) => { const hint = $('ulpCheckpointHint'); if (hint) hint.textContent = 'Capturing verification photo now — hold still…'; }
      });
    } else {
      adapter = createFocusObserverAdapter({ initialMaterialPresent: state.materialPresent, document: window.document, window });
      const controls = $('ulpFocusControls'); if (controls) controls.style.display = 'block';
      if ($('ulpConfirmWorking')) $('ulpConfirmWorking').disabled = false;
    }

    await state.uls.startRun(state.plan, { [adapterId]: adapter }, 'primary');
    state.adapter = adapter; state.adapterId = adapterId;

    const modalityRef = typeof adapter.getModalitySessionRef === 'function' ? adapter.getModalitySessionRef() : null;
    if (!modalityRef) throw new Error(`${adapterId}_produced_no_modality_session_ref`);
    const runRes = await edgeCall('universal-live-proof-run-start', {
      session_id: state.sessionId, adapter_id: adapterId, role: 'primary', modality_session_ref: modalityRef,
      client_run_token: newClientToken()
    });
    state.runId = runRes.run_id;
  } catch (err) {
    $('ulpStartCamera').disabled = state.plan.observers[0].adapter_id !== 'camera';
    $('ulpStartFocus').disabled = state.plan.observers[0].adapter_id !== 'focus';
    throw err;
  }

  // Setup fully succeeded — now, and only now, tell the server this session
  // is active. Real start time, not the moment the user eventually finishes.
  await edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: 'active', reason: `${adapterId}_start` });
  state.startedAtIso = new Date().toISOString();
  state.lastPersistedLocalState = 'active';

  setStatus(`active — ${adapterId}`);
  $('ulpFinish').disabled = false; $('ulpSubmitIncomplete').disabled = false;
  startFeedLoop();
}

// setInterval(feedTick, 500) let a slow tick (network round-trips for
// sampling/event posts/transitions can exceed 500ms) overlap with the next
// one — a real race on lastAppendedEventCount and event/transition
// ordering. This self-rescheduling loop only ever queues the next tick
// after the current one fully resolves (success or failure), so ticks can
// never run concurrently. state.feedTimer now holds a setTimeout id, not
// an interval id — stop with stopFeedLoop(), not clearInterval.
function startFeedLoop() {
  state.feedActive = true;
  const tick = async () => {
    if (!state.feedActive) return;
    try { await feedTick(); } catch (err) { console.error('ulp feed error', err); }
    if (state.feedActive) state.feedTimer = setTimeout(tick, 500);
  };
  state.feedTimer = setTimeout(tick, 500);
}
function stopFeedLoop() {
  state.feedActive = false;
  if (state.feedTimer) { clearTimeout(state.feedTimer); state.feedTimer = null; }
}

const COACHING_LABEL = {
  coaching_cue: (e) => e.message || 'Coaching cue',
  tracking_lost: () => 'Tracking lost — hold position, camera lost your body',
  tracking_recovered: () => 'Tracking recovered',
  observer_error: (e) => `Issue: ${e.message || 'observer error'}`
};

// Every 500ms tick: sample the observer, persist any local pause/uncertainty
// state change the server doesn't yet know about (item #14), and surface +
// persist coaching/tracking events that were previously generated but
// silently discarded (item #11).
async function feedTick() {
  const input = state.adapterId === 'focus' ? { materialPresent: state.materialPresent } : {};
  await state.uls.feed(input);

  const localState = state.uls.getState();
  if (localState !== state.lastPersistedLocalState) {
    state.lastPersistedLocalState = localState;
    // Only forward states the server's own transition table accepts from
    // 'active' mid-session — terminal states are persisted by finish().
    if (['tracking_paused', 'uncertainty_paused', 'active'].includes(localState)) {
      try { await edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: localState, reason: 'local_state_change' }); }
      catch (err) { console.warn('ulp: failed to persist local state change', err); }
    }
  }

  if (typeof state.uls.getCurrentRunEvents !== 'function') return;
  const events = state.uls.getCurrentRunEvents();
  if (events.length > state.lastAppendedEventCount) {
    const fresh = events.slice(state.lastAppendedEventCount);
    state.lastAppendedEventCount = events.length;
    let latestLabel = null;
    for (const evt of fresh) {
      const labelFn = COACHING_LABEL[evt.type];
      if (labelFn) latestLabel = labelFn(evt);
      if (labelFn) {
        try { await edgeCall('universal-live-proof-event-append', { session_id: state.sessionId, observer_run_id: state.runId, event_type: evt.type, payload: evt }); }
        catch (err) { console.warn('ulp: failed to append event', err); }
      }
    }
    if (latestLabel) setStatus(`active — ${state.adapterId} — ${latestLabel}`);
  }
}

function renderResultCard(saved, requirements) {
  const card = $('ulpResultCard'); if (!card) return;
  card.style.display = 'block';
  $('ulpResultScore').textContent = typeof saved.execution_score === 'number' ? `${saved.execution_score}/100` : '--';
  $('ulpResultConfidence').textContent = `${saved.confidence_label || ''} confidence`;
  $('ulpResultRecommendation').textContent = `${saved.recommendation || ''} — ${saved.recommendation_reason || ''}`;
  const reqEl = $('ulpResultRequirements');
  if (reqEl) {
    reqEl.textContent = requirements.length
      ? requirements.map((r) => `${r.met ? '✓' : '✗'} ${r.label}`).join('  ')
      : '';
  }
}

// Produces and saves the Universal Result, then STOPS — this is the honest
// "show the result" checkpoint. It does not submit into the reward pipeline
// on its own; the user reviews the score/confidence/requirements and
// explicitly chooses Continue (submit) or Redo Task (start over), never an
// automatic submit the moment a session ends.
//
// Ordering (item #1 fix): the camera track must still be LIVE when
// finishSession()/submitIncomplete() runs, because that call chain reaches
// the camera adapter's finish() -> final-checkpoint capture, which reads a
// still-live <video> element. The previous version stopped tracks first,
// so the final frame was captured from an already-dead stream (browser-
// dependent, unreliable). Tracks are only stopped AFTER finishSession
// resolves.
async function finish(kind) {
  // Click-locked: neither button was disabled on click, so a rapid double
  // press could fire two finishSession()/submitIncomplete() calls, two
  // run-finish calls, and two result-save attempts concurrently.
  $('ulpFinish').disabled = true; $('ulpSubmitIncomplete').disabled = true;
  stopFeedLoop();

  await edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: 'finishing', reason: kind });
  const snapshot = kind === 'submit_incomplete' ? await state.uls.submitIncomplete('user_submit_incomplete') : await state.uls.finishSession('user_finish');
  if (state.stream) { state.stream.getTracks().forEach((t) => t.stop()); state.stream = null; }
  const hint = $('ulpCheckpointHint'); if (hint) hint.style.display = 'none';
  await edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: snapshot.state, reason: kind });

  const runs = state.uls.getRuns();
  await edgeCall('universal-live-proof-run-finish', { run_id: state.runId, status: 'finished', client_reported_result: runs[runs.length - 1].result });

  const requirementMet = runs.every((r) => r.result && r.result.requirement_met);
  const confidence = state.uls.recalculateConfidence();
  const label = confidenceLabelFor(confidence);
  const rec = recommendationFor({ status: snapshot.state, requirementMet, confidence });
  const runEvents = typeof state.uls.getCurrentRunEvents === 'function' ? state.uls.getCurrentRunEvents() : [];
  const trackingInterruptions = runEvents.filter((e) => e.type === 'tracking_lost').length;
  const executionScore = computeExecutionScore({
    requirementMet, issuesCount: runs.reduce((n, r) => n + (r.result ? r.result.issues.length : 0), 0),
    incompleteRequirementsCount: snapshot.state === 'incomplete' ? 1 : 0, trackingInterruptions
  });

  const resultPayload = {
    schema_version: 2, universal_session_id: state.sessionId, task_id: state.task.id, plan_id: state.planId, plan_version: state.planVersion,
    status: snapshot.state, started_at: state.startedAtIso || new Date().toISOString(), finished_at: new Date().toISOString(),
    observer_runs: runs.map((r) => ({ run_index: r.runIndex, adapter_id: r.adapterId, role: r.role, result: r.result })),
    method_switches: state.uls.getSwitches(), execution_score: executionScore, verification_confidence: confidence,
    observed: [], verified: requirementMet ? state.plan.claim_boundary.verified_claims : [], failed: [], uncertain: [],
    objective_measurements: {}, quality_findings: [], professional_standard: { passed: [], missed: [] },
    incomplete_requirements: snapshot.state === 'incomplete' ? ['requirement_not_met_before_finish'] : [],
    // Populated from the real per-tick ObserverEvents this session actually
    // produced (item #11/#10 partial fix) — no longer hardcoded empty.
    // Professional Standard criterion-level scoring stays out of scope
    // (needs a real evaluation engine this session does not build).
    coaching_events: runEvents.filter((e) => e.type === 'coaching_cue'),
    safety_events: [],
    tracking_losses: runEvents.filter((e) => e.type === 'tracking_lost' || e.type === 'tracking_recovered'),
    pauses: [],
    connectivity_interruptions: state.connectivityInterruptions ? state.connectivityInterruptions.slice() : [],
    evidence_references: [], deadline_context: null, trajectory_evidence: {}, versions: {},
    original_result_id: null, revision_index: 0
  };

  const saved = await edgeCall('universal-live-proof-result-save', {
    session_id: state.sessionId, result: resultPayload, execution_score: executionScore, verification_confidence: confidence,
    confidence_label: label, recommendation: rec.recommendation, recommendation_reason: rec.reason
  });

  state.lastSavedResult = saved;
  let statusLine = `${saved.status || snapshot.state} — score ${saved.execution_score}, confidence ${saved.confidence_label}`;
  // Tier B: honest messaging, not a new requirement — a photo-mode task's
  // primary evidence is (and stays) the photo; focus is additional
  // richness. Say so up front instead of implying a focus-only finish
  // fully completes the task.
  if (state.adapterId === 'focus') statusLine += ' — this task also requires a photo to fully complete.';
  setStatus(statusLine);
  setOutput(saved);
  $('ulpFinish').disabled = true; $('ulpSubmitIncomplete').disabled = true;
  if ($('ulpConfirmWorking')) $('ulpConfirmWorking').disabled = true;
  renderResultCard(saved, runs.map((r) => ({ met: !!(r.result && r.result.requirement_met), label: `${r.adapterId} run ${r.runIndex + 1}` })));
}

const SUBMIT_REASON_MESSAGE = {
  camera_final_checkpoint_required: 'A final verification photo has not been accepted yet — you can retry Continue once uploaded.',
  focus_hybrid_component_unavailable: 'This task has no focus component configured — retry later or use the normal proof flow.',
  focus_hybrid_reward_not_granted: 'Focus session recorded, but this task also needs its required photo before it can complete — the photo is still missing.',
  // The evidence graph now names exactly which required claims are missing,
  // rather than refusing every multi-observer submission outright.
  required_claims_not_satisfied: 'Some required evidence for this task has not been provided yet — see the missing items below.',
  claims_not_compiled: 'This task\'s requirements could not be compiled — the proof contract may have changed.',
  no_required_claims: 'This task declares nothing that can be verified, so it cannot be completed through proof.',
  // Without a configured semantic reviewer the server falls back to a
  // deterministic verdict; a proof should never silently sit in "checking".
  validator_unconfigured: 'The activity reviewer is not configured in this environment, so your proof was judged from server evidence alone (geometry, timing and checkpoints).',
  file_artifact_requires_standard_evaluation: 'The file was received. Awarding for uploaded work is not enabled yet — its content is evaluated, but it does not yet earn points on its own.'
};

// What a decision was actually based on. A deterministic accept must never
// read the same as a semantically-reviewed one, or the weaker becomes the
// stronger by presentation alone.
const VERIFICATION_LEVEL_MESSAGE = {
  server_deterministic_no_semantic_review:
    'Verified from server evidence: valid movement geometry, plausible timing and independent checkpoint images. No reviewer confirmed which activity was performed.',
  server_vision_reviewed:
    'Verified by server review of your checkpoint images, plus geometry, timing and checkpoint independence.',
  server_consistency_only:
    'Only checkpoint consistency was verified — no review of the images themselves was recorded.'
};

// Hand off to the EXISTING reward pipeline (submit_proof/finalize_proof_
// decision for camera, hybrid_attach_evidence_v2/hybrid_claim_reward_v2 for
// focus) — never a new reward path. Honestly surfaces whatever that real
// pipeline reports, including "not submittable yet" reasons. Only runs on
// an explicit Continue click, never automatically.
//
// The card used to hide unconditionally on click, so a retryable outcome
// (camera_final_checkpoint_required, focus_hybrid_reward_not_granted, ...)
// left the user with no visible way to retry even though the backend
// explicitly said retryable:true. It now only hides on a definitive
// outcome — Continue stays available otherwise.
async function onContinue() {
  if (!state.lastSavedResult) return;
  const btn = $('ulpContinue'); if (btn) btn.disabled = true;
  try {
    const submitRes = await edgeCall('universal-live-proof-submit', { result_id: state.lastSavedResult.result_id });
    setOutput({ result: state.lastSavedResult, submit: submitRes });
    const reasonMessage = submitRes && submitRes.reason && SUBMIT_REASON_MESSAGE[submitRes.reason];

    // The server may have reached a decision through the deterministic
    // fallback when the semantic reviewer was unavailable. That is a real
    // outcome and must be reported as one — previously it surfaced as a raw
    // enum, or as nothing at all while the proof sat in "checking".
    const fallback = submitRes && submitRes.deterministic_fallback;
    const decided = fallback && fallback.finalized === true;
    const levelNote = decided && VERIFICATION_LEVEL_MESSAGE[fallback.verification_level];

    const definitive = !!(submitRes && (submitRes.submitted || submitRes.retryable === false || decided));
    if (definitive) { const card = $('ulpResultCard'); if (card) card.style.display = 'none'; }

    let status;
    if (decided) {
      status = fallback.decision === 'accepted'
        ? `accepted — ${levelNote || 'verified from server evidence'}`
        : `not accepted — ${(fallback.failures && fallback.failures[0]) || 'server evidence was incomplete'}`;
    } else if (submitRes && submitRes.submitted) {
      status = 'submitted';
    } else {
      status = reasonMessage || (submitRes && submitRes.reason) || 'submitted (see output)';
    }
    setStatus(status);
  } catch (err) {
    setOutput({ result: state.lastSavedResult, submit_error: String(err && err.message || err) });
    setStatus('submit failed — see output — you can retry Continue');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Never resubmits or reuses an exhausted session (finishSession/
// submitIncomplete are terminal) — starts a genuinely fresh plan+session for
// the same task instead.
function onRedo() {
  const task = state.task;
  const card = $('ulpResultCard'); if (card) card.style.display = 'none';
  if (task) openPanel(task).catch((err) => setOutput({ error: String(err && err.stack || err) }));
}

// Locked product decision: "No offline execution. If internet disappears,
// end or interrupt the live session, preserve valid evidence where
// appropriate, then offer Resume or Restart after reconnecting." Previously
// the panel had no listeners at all — a network outage let the local
// session keep running while the server received nothing, exactly the
// illusion this decision was meant to prevent.
function handleOffline() {
  if (!state.uls || state.reconnecting) return;
  const local = state.uls.getState();
  if (['completed', 'incomplete', 'cancelled', 'error'].includes(local)) return;
  state.reconnecting = true;
  stopFeedLoop();
  state.connectivityInterruptions = state.connectivityInterruptions || [];
  state.connectivityInterruptions.push({ went_offline_at: new Date().toISOString(), back_online_at: null });
  try { state.uls.requestReconnect('connectivity_lost'); } catch (_e) { /* local state machine may already be mid-transition */ }
  if (state.sessionId) edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: 'reconnect_required', reason: 'connectivity_lost' }).catch(() => {});
  $('ulpFinish').disabled = true; $('ulpSubmitIncomplete').disabled = true;
  const banner = $('ulpOfflineBanner'); if (banner) banner.style.display = 'block';
  setStatus('connection lost — evidence preserved, waiting to reconnect');
}
function handleOnline() {
  // Deliberately does NOT auto-resume — the user must explicitly choose
  // Resume or Restart per the locked decision. Just marks reconnection as
  // possible; the banner's own buttons drive the actual transition.
  if (state.connectivityInterruptions && state.connectivityInterruptions.length) {
    const last = state.connectivityInterruptions[state.connectivityInterruptions.length - 1];
    if (last && !last.back_online_at) last.back_online_at = new Date().toISOString();
  }
  if (state.reconnecting) setStatus('connection restored — choose Resume or Restart');
}
// There is no session-status/get RPC to fetch authoritative server state,
// so this cannot do full reconciliation (re-verify identity/task/setup,
// replay only uncertain evidence) — that needs a new server endpoint,
// out of scope here. What this DOES fix: the offline transition to
// reconnect_required was fire-and-forget (edgeCall(...).catch(()=>{}) in
// handleOffline) — if it never reached the server because we were
// genuinely offline, jumping straight to transition('active') on Resume
// hits an invalid_transition (server thinks it's still 'active', which
// has no active->active self-transition). Retrying reconnect_required
// first (tolerating failure if it already landed) closes that gap using
// only the endpoints that already exist.
async function onResume() {
  if (!state.reconnecting) return;
  if (!navigator.onLine) { setStatus('still offline — wait for your connection to return'); return; }
  if (state.adapterId === 'camera' && state.stream) {
    const tracksLive = state.stream.getTracks().length > 0 && state.stream.getTracks().every((t) => t.readyState === 'live');
    if (!tracksLive) { setStatus('camera stream was lost while offline — use Restart instead of Resume'); return; }
  }
  try {
    try { await edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: 'reconnect_required', reason: 'reconnect_retry' }); }
    catch (_e) { /* already there, or server never left active while offline — either is fine, proceed */ }
    state.uls.resumeFromReconnect();
    await edgeCall('universal-live-proof-transition', { session_id: state.sessionId, to_state: 'active', reason: 'reconnected' });
    state.lastPersistedLocalState = 'active';
    state.reconnecting = false;
    const banner = $('ulpOfflineBanner'); if (banner) banner.style.display = 'none';
    $('ulpFinish').disabled = false; $('ulpSubmitIncomplete').disabled = false;
    startFeedLoop();
    setStatus(`active — ${state.adapterId} — resumed after reconnect`);
  } catch (err) {
    setOutput({ error: String(err && err.stack || err) });
  }
}
function onRestart() {
  const task = state.task;
  const banner = $('ulpOfflineBanner'); if (banner) banner.style.display = 'none';
  closePanel('reconnect_restart').then(() => { if (task) return openPanel(task); }).catch((err) => setOutput({ error: String(err && err.stack || err) }));
}

async function onConfirmWorking() {
  if (!state.adapter || state.adapterId !== 'focus' || typeof state.adapter.getCheckpointSnapshot !== 'function') return;
  const snap = state.adapter.getCheckpointSnapshot();
  if (snap.nextSequence == null) { setStatus('all checkpoints already confirmed'); return; }
  await state.uls.feed({ checkpointSequence: snap.nextSequence, materialPresent: state.materialPresent });
}

function wireButtons() {
  $('ulpClose').addEventListener('click', () => closePanel('user_close').catch((err) => console.error('ulp close error', err)));
  $('ulpStartCamera').addEventListener('click', () => startRun('camera').catch((err) => setOutput({ error: String(err && err.stack || err) })));
  $('ulpStartFocus').addEventListener('click', () => startRun('focus').catch((err) => setOutput({ error: String(err && err.stack || err) })));
  $('ulpFinish').addEventListener('click', () => finish('finish').catch((err) => setOutput({ error: String(err && err.stack || err) })));
  $('ulpSubmitIncomplete').addEventListener('click', () => finish('submit_incomplete').catch((err) => setOutput({ error: String(err && err.stack || err) })));
  $('ulpContinue').addEventListener('click', () => onContinue().catch((err) => setOutput({ error: String(err && err.stack || err) })));
  $('ulpRedo').addEventListener('click', onRedo);
  if ($('ulpResume')) $('ulpResume').addEventListener('click', () => onResume().catch((err) => setOutput({ error: String(err && err.stack || err) })));
  if ($('ulpRestart')) $('ulpRestart').addEventListener('click', onRestart);
  if ($('ulpConfirmWorking')) $('ulpConfirmWorking').addEventListener('click', () => onConfirmWorking().catch((err) => setOutput({ error: String(err && err.stack || err) })));
  if ($('ulpMaterialPresent')) $('ulpMaterialPresent').addEventListener('change', (e) => { state.materialPresent = !!e.target.checked; });
}

if (panelEl()) wireButtons();

// Owner-only quick test task — inserts a deterministic camera/focus task via
// owner_quick_test_task_v1, bypassing create-custom-task's AI classification
// step entirely (real gap: an environment with no AI provider key configured
// has no working path to a Live-Proof-eligible task otherwise). Reveals
// only when is_owner() resolves true, same gate as the main panel trigger.
function wireQuickTestButtons() {
  const section = $('ulpQuickTestSection');
  const statusEl = $('ulpQuickStatus');
  async function runQuickTest(kind) {
    const sb = window.VISION && window.VISION.sb;
    if (!sb) return;
    // Click-locked: neither button was disabled while its request was in
    // flight, so a fast double click could send two concurrent
    // delete-then-insert requests and race the unique constraint the RPC
    // is otherwise idempotent against.
    if ($('ulpQuickCamera')) $('ulpQuickCamera').disabled = true;
    if ($('ulpQuickFocus')) $('ulpQuickFocus').disabled = true;
    if (statusEl) { statusEl.textContent = 'Creating…'; statusEl.style.color = ''; }
    const { data, error } = await sb.rpc('owner_quick_test_task_v1', { p_kind: kind });
    if (error) {
      if (statusEl) { statusEl.textContent = `Failed: ${error.message}`; statusEl.style.color = '#e08080'; }
      if ($('ulpQuickCamera')) $('ulpQuickCamera').disabled = false;
      if ($('ulpQuickFocus')) $('ulpQuickFocus').disabled = false;
      return;
    }
    if (statusEl) { statusEl.textContent = `Created "${data.title}" — reloading…`; statusEl.style.color = '#9fd39f'; }
    setTimeout(() => window.location.reload(), 600);
  }
  if ($('ulpQuickCamera')) $('ulpQuickCamera').addEventListener('click', () => runQuickTest('camera').catch((err) => { if (statusEl) statusEl.textContent = String(err && err.message || err); }));
  if ($('ulpQuickFocus')) $('ulpQuickFocus').addEventListener('click', () => runQuickTest('focus').catch((err) => { if (statusEl) statusEl.textContent = String(err && err.message || err); }));
  checkOwnerGate().then((ready) => { if (ready && section) section.style.display = ''; });
}
if ($('ulpQuickTestSection')) wireQuickTestButtons();

window.VISION = window.VISION || {};
window.VISION.universalLiveProof = {
  checkOwnerGate,
  isOwnerReady() { return state.ownerReady; },
  open(task) { openPanel(task).catch((err) => { setStatus('error'); setOutput({ error: String(err && err.stack || err) }); }); }
};

checkOwnerGate();
