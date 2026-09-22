// Vision · Live Proof Core internal preview wiring (lab only, not linked from
// the product). Compiles a real Live Proof Plan, boots the real shared
// session controller, and wraps the real camera runtime (window.VISION.liveCoach)
// via the real camera observer adapter. No server write path exists on this
// page — it cannot award XP, rank, or completion under any circumstance.
'use strict';

import { compileLiveProofPlan } from '/supabase/functions/_shared/live-proof-core/compiler.mjs';
import { createLiveProofSession } from '/supabase/functions/_shared/live-proof-core/session-controller.mjs';
import { createCameraObserverAdapter } from '/js/proof/live-core/adapters/camera-observer-adapter.mjs';

window.VISION_LIVE_V2 = false;
window.VISION_LIVE_V3 = true;

const statusEl = document.getElementById('lpcStatus');
const outputEl = document.getElementById('lpcOutput');
const startBtn = document.getElementById('lpcStart');
const finishBtn = document.getElementById('lpcFinish');
const cancelBtn = document.getElementById('lpcCancel');
const videoEl = document.getElementById('lpcVideo');
const labelSectionEl = document.getElementById('lpcLabel');
const repListEl = document.getElementById('lpcRepList');
const missedCountEl = document.getElementById('lpcMissedCount');
const finalSummaryEl = document.getElementById('lpcFinalSummary');
const finalNoteEl = document.getElementById('lpcFinalNote');
const saveBtn = document.getElementById('lpcSave');
const saveStatusEl = document.getElementById('lpcSaveStatus');
const diagCameraEl = document.getElementById('diagCamera');
const diagTfEl = document.getElementById('diagTf');
const diagMoveNetEl = document.getElementById('diagMoveNet');
const diagLiveCoachEl = document.getElementById('diagLiveCoach');
const diagRegistryEl = document.getElementById('diagRegistry');
const diagVerifierIdEl = document.getElementById('diagVerifierId');
const diagInitErrorEl = document.getElementById('diagInitError');
const v3StageEl = document.getElementById('v3Stage');
const v3PhaseEl = document.getElementById('v3Phase');
const v3ViewEl = document.getElementById('v3View');
const v3SideEl = document.getElementById('v3Side');
const v3AngleEl = document.getElementById('v3Angle');
const v3CalibEl = document.getElementById('v3Calib');
const v3RepsEl = document.getElementById('v3Reps');
const v3RejectedEl = document.getElementById('v3Rejected');
const v3SetupChecklistEl = document.getElementById('v3SetupChecklist');
const v3SetupStableEl = document.getElementById('v3SetupStable');

function setDiag(el, text, cls) {
  el.textContent = text;
  el.className = cls || '';
}

// window.VISION.liveCoach and window.VISION.liveV3 are plain <script> globals
// (loaded before this module, see live-proof-core-preview.html) — checked
// directly here, independent of the camera adapter, so a missing/broken
// script load is visible even if the adapter itself never gets created.
function diagStaticScripts() {
  const liveCoachOk = !!(window.VISION && window.VISION.liveCoach && typeof window.VISION.liveCoach.create === 'function');
  setDiag(diagLiveCoachEl, liveCoachOk ? 'loaded (create() available)' : 'MISSING — js/vision-live-coach.js did not attach window.VISION.liveCoach.create', liveCoachOk ? 'ok' : 'bad');

  const liveV3 = window.VISION && window.VISION.liveV3;
  if (!liveV3) { setDiag(diagRegistryEl, 'MISSING — js/vision-live-verifiers-v3.js did not attach window.VISION.liveV3', 'bad'); return; }
  const pushupEnabled = typeof liveV3.isProductionEnabled === 'function' && liveV3.isProductionEnabled('pushup');
  setDiag(diagRegistryEl, pushupEnabled ? 'loaded, pushup production-enabled' : 'loaded, but pushup NOT production-enabled', pushupEnabled ? 'ok' : 'bad');
}

// Pulled from the real runtime (via the adapter's read-only getDiagnostics())
// while a session is active — see camera-observer-adapter.mjs getDiagnostics().
function diagFromAdapter(adapter) {
  if (!adapter || typeof adapter.getDiagnostics !== 'function') return;
  const d = adapter.getDiagnostics();
  const state = d.rawState || {};

  setDiag(diagTfEl, window.tf ? `loaded (backend: ${(window.tf.getBackend && window.tf.getBackend()) || 'unknown'})` : 'not loaded', window.tf ? 'ok' : 'pending');

  if (state.poseReady === true) setDiag(diagMoveNetEl, `ready (engineStatus: ${state.engineStatus})`, 'ok');
  else if (state.engineStatus === 'failed') setDiag(diagMoveNetEl, `FAILED (evidenceState: ${state.evidenceState || 'unknown'})`, 'bad');
  else setDiag(diagMoveNetEl, `not ready yet (engineStatus: ${state.engineStatus || 'unknown'})`, 'pending');

  const activeEngine = state.activeEngine || 'unknown';
  if (activeEngine === 'v3' && d.v3Diagnostics) {
    setDiag(diagVerifierIdEl, `${d.v3Diagnostics.contract.exercise_id} / ${d.v3Diagnostics.contract.verifier_id} v${d.v3Diagnostics.contract.verifier_version} (engine: v3)`, 'ok');
    setDiag(diagInitErrorEl, 'none', 'ok');
    renderV3LiveDiag(d.v3Diagnostics, state);
  } else if (activeEngine === 'blocked') {
    setDiag(diagVerifierIdEl, 'none — blocked before a verifier could be selected', 'bad');
    setDiag(diagInitErrorEl, state.evidenceState || 'unknown_block_reason', 'bad');
  } else {
    setDiag(diagVerifierIdEl, `engine=${activeEngine} (not v3)`, activeEngine === 'unknown' ? 'pending' : 'bad');
  }
}

// Live per-frame verifier state — exactly what a "0 reps, no reason" real
// session hides today. Pulled from the runtime's own getV3Diagnostics() (see
// js/vision-live-coach.js) which already computes all of this; this preview
// simply displays it and, on finish/cancel, persists it to the saved fixture.
function renderV3LiveDiag(v3d, state) {
  const s = v3d.session || {};
  const lastLandmark = (v3d.timeline && v3d.timeline.landmarks && v3d.timeline.landmarks.length)
    ? v3d.timeline.landmarks[v3d.timeline.landmarks.length - 1] : null;
  const lastRejection = (v3d.timeline && v3d.timeline.rejections && v3d.timeline.rejections.length)
    ? v3d.timeline.rejections[v3d.timeline.rejections.length - 1] : null;
  v3StageEl.textContent = s.stage || '—';
  v3PhaseEl.textContent = (lastLandmark && lastLandmark.phase) || '—';
  v3ViewEl.textContent = s.camera_view || '—';
  v3SideEl.textContent = s.selected_side || '—';
  v3AngleEl.textContent = lastLandmark && lastLandmark.angle != null ? `${lastLandmark.angle}°` : '—';
  v3CalibEl.textContent = s.calibration ? `${s.calibration.top}° / ${s.calibration.bottom}° (anchor ${s.calibration.anchorAtTop ? 'top' : 'bottom'})` : 'not calibrated yet';
  v3RepsEl.textContent = `${s.counted_reps || 0} / ${state.clientCountedReps || 0}`;
  v3RejectedEl.textContent = `${s.rejected_reps || 0}${lastRejection ? ` (${lastRejection.reason})` : ''}`;
  // While stuck in "setup" this is the precise reason — never a blank 0/none/
  // unknown with nothing explaining it (see js/vision-live-coach.js v3StageTick()
  // and SETUP_NOISE_GRACE_MS).
  if (s.stage === 'setup') {
    const failing = s.setup_failing_items || [];
    v3SetupChecklistEl.textContent = failing.length ? `failing: ${failing.join(', ')}` : 'all items currently ok — waiting for 1200ms unbroken stability';
    v3SetupStableEl.textContent = `${s.setup_stable_ms || 0}ms / 1200ms${s.setup_noise_grace_active ? ' (brief noise grace active)' : ''} · lighting=${s.lighting_confidence}`;
  } else {
    v3SetupChecklistEl.textContent = `left setup at stage=${s.stage}`;
    v3SetupStableEl.textContent = '—';
  }
}

// Captured BEFORE session.finish()/cancel() tears the adapter's controller
// down (session-controller.mjs calls adapter.teardown() as part of finish,
// which nulls the controller reference) — this is the only window in which
// the full per-frame timeline (landmarks/phases/reps/rejections/tracking)
// is still readable.
function captureV3Diagnostics() {
  const adapter = window.__lpcAdapter;
  if (!adapter || typeof adapter.getDiagnostics !== 'function') return null;
  const d = adapter.getDiagnostics();
  return d.v3Diagnostics || null;
}

function setStatus(s) { statusEl.textContent = s; window.__lpcStatus = s; }
function writeOutput(obj) { outputEl.textContent = JSON.stringify(obj, null, 2); }

// The task fixture this lab always previews. Exact task_id, target and
// capability are read out by the automated test harness via window.__lpcTask.
window.__lpcTask = {
  id: window.__lpcTaskId || 'lab-pushup-preview-1',
  title: '5 push-ups',
  task_domain: 'fitness'
};

async function compilePlan() {
  const registry = await (await fetch('/config/proof-capabilities.json')).json();
  const v2 = {
    version: 2, proof_type: 'live', capability_id: 'pushup', verifier_id: 'live-pushup-v1', verifier_version: 1,
    mode: 'reps', target_kind: 'reps', target_value: 5, sets: null, reps_per_set: null, seconds_per_set: null,
    rest_seconds: null, total_target_value: 5, required_camera_view: 'side', accepted_camera_views: ['side'],
    required_landmarks: ['shoulder', 'elbow', 'wrist', 'hip'], setup_instruction: '', must_show: '',
    reject_if: 'Reject if incomplete.', fallback_proof_type: 'photo', finish_rule: 'target_or_insufficient',
    minimum_runtime_version: null
  };
  const v3 = { schema_version: 3, v2, task_domain: 'fitness', proof_mode: 'live' };
  return compileLiveProofPlan(window.__lpcTask, v3, registry);
}

async function start() {
  startBtn.disabled = true;
  diagStaticScripts();
  setStatus('compiling_plan');
  const plan = await compilePlan();
  window.__lpcPlan = plan;
  if (!plan || plan.supported === false) {
    setStatus('unsupported');
    writeOutput({ task: window.__lpcTask, unsupported: plan });
    window.__lpcUnsupportedResult = plan;
    return;
  }

  setStatus('requesting_camera');
  setDiag(diagCameraEl, 'requesting permission...', 'pending');
  const stream = await navigator.mediaDevices.getUserMedia({ video: true }).catch((err) => {
    setDiag(diagCameraEl, `denied/error: ${String((err && err.message) || err)}`, 'bad');
    throw err;
  });
  videoEl.srcObject = stream;
  await videoEl.play().catch(() => {});
  window.__lpcStream = stream;
  const track = stream.getVideoTracks()[0];
  const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
  setDiag(diagCameraEl, `active (${settings.width || '?'}x${settings.height || '?'})`, 'ok');

  const adapter = createCameraObserverAdapter({ video: videoEl });
  window.__lpcAdapter = adapter;
  const session = createLiveProofSession({ plan, adapters: { camera: adapter } });
  window.__lpcSession = session;

  await session.prepare();
  await session.start();
  setStatus('active');
  finishBtn.disabled = false;
  cancelBtn.disabled = false;

  window.__lpcDrainInterval = setInterval(() => {
    session.feed('camera', {}).catch((err) => { console.error('lpc feed error', err); });
    diagFromAdapter(adapter);
  }, 250);
}

async function stopStream() {
  if (window.__lpcStream) { window.__lpcStream.getTracks().forEach((t) => t.stop()); }
  if (window.__lpcDrainInterval) { clearInterval(window.__lpcDrainInterval); window.__lpcDrainInterval = null; }
}

// Derives a per-rep review timeline from the session's own progress_updated
// events (cumulative reps/rejected_reps deltas) — the only per-rep signal
// the shared session controller emits. "Missed" reps (real push-ups that
// never triggered any event at all) can only be known by the human who
// performed them, so that stays a manual count below, not derived here.
function buildRepTimeline(events) {
  const startMs = events.length ? events[0].timestamp_ms : 0;
  const timeline = [];
  let prevReps = 0, prevRejected = 0;
  for (const evt of events) {
    if (evt.type !== 'progress_updated') continue;
    const reps = typeof evt.reps === 'number' ? evt.reps : prevReps;
    const rejected = typeof evt.rejected_reps === 'number' ? evt.rejected_reps : prevRejected;
    for (let i = 0; i < reps - prevReps; i++) timeline.push({ kind: 'detected', at_ms: evt.timestamp_ms, elapsed_s: ((evt.timestamp_ms - startMs) / 1000).toFixed(1) });
    for (let i = 0; i < rejected - prevRejected; i++) timeline.push({ kind: 'rejected', at_ms: evt.timestamp_ms, elapsed_s: ((evt.timestamp_ms - startMs) / 1000).toFixed(1) });
    prevReps = reps; prevRejected = rejected;
  }
  return timeline;
}

function renderLabelUI(result, events) {
  const timeline = buildRepTimeline(events);
  window.__lpcRepTimeline = timeline;
  repListEl.innerHTML = '';
  if (!timeline.length) {
    repListEl.innerHTML = '<div class="lpcRow">No reps were detected or rejected during this session.</div>';
  }
  timeline.forEach((rep, i) => {
    const row = document.createElement('div');
    row.className = 'lpcRow';
    const label = rep.kind === 'detected' ? `Detected rep #${i + 1}` : `Rejected rep #${i + 1}`;
    const question = rep.kind === 'detected' ? 'was this a real, valid rep?' : 'was rejecting this correct?';
    row.innerHTML = `<strong>${label}</strong> at ${rep.elapsed_s}s — ${question}<br>` +
      `<label><input type="radio" name="lpcRep${i}" value="correct" checked> Correct</label>` +
      `<label><input type="radio" name="lpcRep${i}" value="incorrect"> Incorrect</label>`;
    repListEl.appendChild(row);
  });

  finalSummaryEl.textContent = `Engine reported: status=${result.status}, requirement_met=${result.requirement_met}, ` +
    `observed reps=${(result.observer_results[0] && result.observer_results[0].evidence_summary && result.observer_results[0].evidence_summary.reps) || 0}.`;
  missedCountEl.value = '0';
  finalNoteEl.value = '';
  labelSectionEl.style.display = 'block';
}

function collectLabels(result, events) {
  const timeline = window.__lpcRepTimeline || [];
  const corrections = timeline.map((rep, i) => {
    const checked = document.querySelector(`input[name="lpcRep${i}"]:checked`);
    return { rep_index: i, kind: rep.kind, at_ms: rep.at_ms, elapsed_s: rep.elapsed_s, reviewer_verdict: checked ? checked.value : 'correct' };
  });
  const finalMatchEl = document.querySelector('input[name="lpcFinalMatch"]:checked');
  return {
    schema_version: 1,
    reviewer_note: 'Manually reviewed by a human tester through the isolated Live Proof Core preview labelling UI.',
    corrections,
    missed_reps: Math.max(0, parseInt(missedCountEl.value, 10) || 0),
    final_completion_decision: {
      engine_status: result.status,
      engine_requirement_met: result.requirement_met,
      matches_reality: finalMatchEl ? finalMatchEl.value === 'yes' : true,
      note: finalNoteEl.value || ''
    }
  };
}

async function saveLabelledSession() {
  saveBtn.disabled = true;
  saveStatusEl.textContent = 'saving...';
  try {
    const payload = {
      task: window.__lpcTask,
      plan: window.__lpcPlan,
      result: window.__lpcResult,
      events: window.__lpcEvents,
      v3_diagnostics: window.__lpcV3Diagnostics || null,
      labels: collectLabels(window.__lpcResult, window.__lpcEvents)
    };
    const res = await fetch('/api/lpc-save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    if (!res.ok || !body.ok) throw new Error(body.error || `save failed (${res.status})`);
    saveStatusEl.textContent = `saved: ${body.session_file}${body.label_file ? ' + ' + body.label_file : ''}`;
    window.__lpcSaved = body;
  } catch (err) {
    saveStatusEl.textContent = `save error: ${String((err && err.message) || err)}`;
  } finally {
    saveBtn.disabled = false;
  }
}

async function finish() {
  finishBtn.disabled = true; cancelBtn.disabled = true;
  setStatus('finishing');
  const v3Diagnostics = captureV3Diagnostics();
  await stopStream();
  const result = await window.__lpcSession.finish('user_finish');
  const events = window.__lpcSession.getEvents();
  window.__lpcResult = result;
  window.__lpcEvents = events;
  window.__lpcV3Diagnostics = v3Diagnostics;
  setStatus('completed');
  writeOutput({ task: window.__lpcTask, plan: window.__lpcPlan, result, events, v3_diagnostics: v3Diagnostics });
  renderLabelUI(result, events);
}

async function cancel() {
  finishBtn.disabled = true; cancelBtn.disabled = true;
  setStatus('cancelling');
  const v3Diagnostics = captureV3Diagnostics();
  await stopStream();
  const result = await window.__lpcSession.cancel('user_cancel');
  const events = window.__lpcSession.getEvents();
  window.__lpcResult = result;
  window.__lpcEvents = events;
  window.__lpcV3Diagnostics = v3Diagnostics;
  setStatus('cancelled');
  writeOutput({ task: window.__lpcTask, plan: window.__lpcPlan, result, events, v3_diagnostics: v3Diagnostics });
  renderLabelUI(result, events);
}

startBtn.addEventListener('click', () => { start().catch((err) => { setStatus('error'); writeOutput({ error: String((err && err.stack) || err) }); }); });
finishBtn.addEventListener('click', () => { finish().catch((err) => { setStatus('error'); writeOutput({ error: String((err && err.stack) || err) }); }); });
cancelBtn.addEventListener('click', () => { cancel().catch((err) => { setStatus('error'); writeOutput({ error: String((err && err.stack) || err) }); }); });
saveBtn.addEventListener('click', () => { saveLabelledSession().catch((err) => { saveStatusEl.textContent = `save error: ${String((err && err.stack) || err)}`; }); });

diagStaticScripts();
window.__lpcReady = true;
