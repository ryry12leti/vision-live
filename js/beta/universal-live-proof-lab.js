// Vision · Universal Live Proof internal lab (dev only, not linked from the
// product). Drives the real universal-live-proof-* Edge Function boundary
// against staging with the signed-in user's own JWT, and runs the real
// camera/focus observer adapters + universal-session.mjs locally to produce
// the events/results it persists. No path exists here to XP/rank/reward.
'use strict';

import { createUniversalLiveProofSession } from '/js/proof/live-core/universal/universal-session.mjs';
import { confidenceLabelFor, recommendationFor, computeExecutionScore } from '/js/proof/live-core/universal/universal-result.mjs';
import { createServerBoundCameraObserverAdapter } from '/js/proof/live-core/adapters/camera-observer-adapter-server-bound.mjs';
import { createFocusObserverAdapter } from '/js/proof/live-core/adapters/focus-observer-adapter.mjs';

// Staging target is supplied by the operator AT RUNTIME, never committed.
//
// This previously hardcoded a staging project URL and its anon key. Even
// though an anon key is public by design (RLS, not secrecy, is the
// authorisation boundary), committing it violated two of this repo's own
// standing rules: the hosted secret-scan gate rejects any `eyJ...eyJ...`
// JWT in client-shipped files outright, and CLAUDE.md forbids committing
// generated Supabase client config or test credentials. The gate never
// caught it because that CI step sits behind an earlier failing step and
// had been skipped on every run.
//
// Set these once in the browser console before using the lab:
//   localStorage.setItem('vision.ulpLab.url', 'https://<ref>.supabase.co')
//   localStorage.setItem('vision.ulpLab.anonKey', '<anon key>')
const STAGING_URL = (() => {
  try { return localStorage.getItem('vision.ulpLab.url') || ''; } catch { return ''; }
})();
const STAGING_ANON_KEY = (() => {
  try { return localStorage.getItem('vision.ulpLab.anonKey') || ''; } catch { return ''; }
})();
const LAB_TARGET_CONFIGURED = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(STAGING_URL) && STAGING_ANON_KEY.length > 20;

const $ = (id) => document.getElementById(id);
const authStatusEl = $('ulAuthStatus'), taskTitleEl = $('ulTaskTitle'), methodEl = $('ulMethod'), sourcesEl = $('ulSources');
const stateEl = $('ulState'), coachingEl = $('ulCoaching'), uncertaintyEl = $('ulUncertainty');
const incompleteWarningEl = $('ulIncompleteWarning'), resultIdEl = $('ulResultId'), outputEl = $('ulOutput');
const videoEl = $('ulVideo');

function log(obj) { outputEl.textContent = JSON.stringify(obj, null, 2); }
function setState(s) { stateEl.textContent = s; }
function setSources(list) { sourcesEl.innerHTML = (list.length ? list : ['none']).map((s) => `<span>${s}</span>`).join(''); }

let sb = null, accessToken = null;
let lab = { task: null, plan: null, uls: null, currentAdapter: null, currentAdapterId: null, currentRunId: null, seq: 0, feedTimer: null };

async function edgeCall(fn, body) {
  const res = await fetch(`${STAGING_URL}/functions/v1/${fn}`, {
    method: 'POST', headers: { apikey: STAGING_ANON_KEY, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${fn} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function signIn() {
  if (!LAB_TARGET_CONFIGURED) {
    authStatusEl.textContent = "lab target not configured — set localStorage 'vision.ulpLab.url' and 'vision.ulpLab.anonKey' (see the comment at the top of this file), then reload";
    authStatusEl.className = 'bad';
    return;
  }
  const email = $('ulEmail').value.trim(), password = $('ulPassword').value;
  sb = window.supabase.createClient(STAGING_URL, STAGING_ANON_KEY);
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { authStatusEl.textContent = `error: ${error.message}`; authStatusEl.className = 'bad'; return; }
  accessToken = data.session.access_token;
  window.VISION = window.VISION || {};
  window.VISION.sb = sb; // required by js/proof/live/focus-hybrid-client.js's default client lookup
  authStatusEl.textContent = `signed in as ${data.user.email}`;
  authStatusEl.className = 'ok';
  $('ulLoadTask').disabled = false;
}

async function loadTaskAndCompilePlan() {
  const taskId = $('ulTaskId').value.trim();
  if (!taskId) return;
  const { data: task, error } = await sb.from('daily_tasks').select('*').eq('id', taskId).single();
  if (error || !task) { taskTitleEl.textContent = `load failed: ${error ? error.message : 'not found'}`; return; }
  lab.task = task;
  taskTitleEl.textContent = `${task.title} (${task.id})`;

  const planRes = await edgeCall('universal-live-proof-plan', { task_id: taskId });
  if (planRes.supported !== true) {
    methodEl.textContent = 'unsupported for Live Proof — see output';
    log(planRes);
    return;
  }
  lab.plan = planRes.plan;
  lab.planId = planRes.plan_id;
  lab.planVersion = planRes.plan_version;
  methodEl.textContent = `${planRes.plan.observers[0].adapter_id} (${planRes.plan.requirement.target_kind})`;
  setSources([]);
  log(planRes);
  $('ulSessionCreate').disabled = false;
}

async function createSession() {
  const res = await edgeCall('universal-live-proof-session-create', { plan_id: lab.planId });
  lab.sessionId = res.session_id;
  lab.uls = createUniversalLiveProofSession({ sessionId: res.session_id, taskId: lab.task.id });
  await edgeCall('universal-live-proof-transition', { session_id: lab.sessionId, to_state: 'prepared', reason: 'lab_prepare' });
  setState(lab.uls.getState());
  $('ulStartCamera').disabled = lab.plan.observers[0].adapter_id !== 'camera';
  $('ulStartFocus').disabled = lab.plan.observers[0].adapter_id !== 'focus';
  log(res);
}

function nextEventId(kind) { lab.seq += 1; return `lab-${lab.sessionId}-${kind}-${lab.seq}`; }

async function persistEvent(type, payload) {
  await edgeCall('universal-live-proof-event-append', {
    session_id: lab.sessionId, observer_run_id: lab.currentRunId, event_type: type, payload: payload || {},
    client_event_id: nextEventId(type)
  }).catch((err) => console.error('event append failed', err));
}

async function startRun(adapterId) {
  await edgeCall('universal-live-proof-transition', { session_id: lab.sessionId, to_state: 'active', reason: `${adapterId}_run_start` });

  let adapter;
  if (adapterId === 'camera') {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoEl.srcObject = stream; await videoEl.play().catch(() => {});
    lab.stream = stream;
    // Server-bound: also drives the real live-session-start/event/finish
    // Edge Functions in parallel, so Universal's server-authority derivation
    // has a real, server-corroborated live_sessions row to read from —
    // never just this adapter's own self-reported events.
    adapter = createServerBoundCameraObserverAdapter({ video: videoEl, callEdgeFunction: edgeCall });
  } else {
    adapter = createFocusObserverAdapter({});
  }

  await lab.uls.startRun(lab.plan, { [adapterId]: adapter }, 'primary');
  lab.currentAdapter = adapter;
  lab.currentAdapterId = adapterId;

  // Universal Live Proof's server authority now REQUIRES a real modality
  // binding for camera/focus runs — pulled from the adapter itself, never
  // invented client-side.
  const modalitySessionRef = typeof adapter.getModalitySessionRef === 'function' ? adapter.getModalitySessionRef() : null;
  if (!modalitySessionRef) throw new Error(`${adapterId}_adapter_produced_no_modality_session_ref`);
  const runRes = await edgeCall('universal-live-proof-run-start', { session_id: lab.sessionId, adapter_id: adapterId, role: 'primary', modality_session_ref: modalitySessionRef });
  lab.currentRunId = runRes.run_id;

  setState(lab.uls.getState());
  setSources(lab.uls.getSnapshot().active_sources);
  $('ulFinish').disabled = false;
  $('ulSubmitIncomplete').disabled = false;
  $('ulChangeMethod').disabled = false;

  lab.feedTimer = setInterval(async () => {
    try {
      const before = lab.uls.getState();
      const snapshot = await lab.uls.feed({});
      if (before !== lab.uls.getState()) {
        setState(lab.uls.getState());
        if (lab.uls.getState() === 'tracking_paused') {
          coachingEl.textContent = 'Coaching: tracking lost — pausing verification, waiting for recovery.';
        } else if (lab.uls.getState() === 'active' && before === 'tracking_paused') {
          coachingEl.textContent = 'Coaching: tracking recovered — resuming from last verified point.';
        }
      }
      const events = lab.currentAdapter && typeof lab.currentAdapter.getDiagnostics === 'function' ? null : null;
      log({ universal_state: lab.uls.getState(), controller_snapshot: snapshot });
    } catch (err) {
      console.error('feed error', err);
    }
  }, 500);
}

async function changeMethod() {
  const otherAdapterId = lab.currentAdapterId === 'camera' ? 'focus' : 'camera';
  const reason = window.prompt('Reason for switching proof method?', `switching from ${lab.currentAdapterId} to ${otherAdapterId}`);
  if (!reason) return;

  clearInterval(lab.feedTimer);
  await edgeCall('universal-live-proof-transition', { session_id: lab.sessionId, to_state: 'method_switching', reason });

  const { suspendedRun, switchRecord } = await lab.uls.switchMethod({
    newPlan: lab.plan, // same task; in a real multi-plan flow the lab would re-compile a plan for the other adapter
    reason,
    evidenceBoundary: { note: `evidence from run ${suspendedRunIndexNote()} preserved but not combined into the new run's claim` }
  });

  // observer_result actually PERSISTED is derived server-side from the real
  // modality session; what this adapter's own finish() returned is sent
  // only as a non-authoritative client_reported_result for audit.
  await edgeCall('universal-live-proof-run-finish', {
    run_id: lab.currentRunId, status: 'suspended', client_reported_result: suspendedRun.result
  });
  await edgeCall('universal-live-proof-method-switch', {
    session_id: lab.sessionId, from_run_id: lab.currentRunId, to_run_id: null, reason,
    evidence_boundary: switchRecord.evidenceBoundary, confidence_before: switchRecord.confidenceBefore
  });

  if (lab.stream) { lab.stream.getTracks().forEach((t) => t.stop()); lab.stream = null; }
  await startRun(otherAdapterId);

  const confidenceAfter = lab.uls.recalculateConfidence();
  await edgeCall('universal-live-proof-method-switch', {
    session_id: lab.sessionId, from_run_id: switchRecord.fromRunIndex, to_run_id: lab.currentRunId, reason: 'confidence_recalculated',
    confidence_before: switchRecord.confidenceBefore, confidence_after: confidenceAfter
  });
}
function suspendedRunIndexNote() { return lab.uls.getRuns().length - 1; }

async function finishOrSubmitIncomplete(kind) {
  clearInterval(lab.feedTimer);
  if (lab.stream) { lab.stream.getTracks().forEach((t) => t.stop()); lab.stream = null; }

  await edgeCall('universal-live-proof-transition', { session_id: lab.sessionId, to_state: 'finishing', reason: kind });
  const snapshot = kind === 'submit_incomplete' ? await lab.uls.submitIncomplete('user_submit_incomplete') : await lab.uls.finishSession('user_finish');
  await edgeCall('universal-live-proof-transition', { session_id: lab.sessionId, to_state: snapshot.state, reason: kind });

  const runs = lab.uls.getRuns();
  await edgeCall('universal-live-proof-run-finish', { run_id: lab.currentRunId, status: 'finished', client_reported_result: runs[runs.length - 1].result });

  const requirementMet = runs.every((r) => r.result && r.result.requirement_met);
  const confidence = lab.uls.recalculateConfidence();
  const label = confidenceLabelFor(confidence);
  const rec = recommendationFor({ status: snapshot.state, requirementMet, confidence });
  const executionScore = computeExecutionScore({
    requirementMet, issuesCount: runs.reduce((n, r) => n + (r.result ? r.result.issues.length : 0), 0),
    incompleteRequirementsCount: snapshot.state === 'incomplete' ? 1 : 0, trackingInterruptions: 0
  });

  const resultPayload = {
    schema_version: 2, universal_session_id: lab.sessionId, task_id: lab.task.id, plan_id: lab.planId, plan_version: lab.planVersion,
    status: snapshot.state, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    observer_runs: runs.map((r) => ({ run_index: r.runIndex, adapter_id: r.adapterId, role: r.role, result: r.result })),
    method_switches: lab.uls.getSwitches(), execution_score: executionScore, verification_confidence: confidence,
    observed: [], verified: requirementMet ? lab.plan.claim_boundary.verified_claims : [], failed: [], uncertain: [],
    objective_measurements: {}, quality_findings: [], professional_standard: { passed: [], missed: [] },
    incomplete_requirements: snapshot.state === 'incomplete' ? ['requirement_not_met_before_finish'] : [],
    coaching_events: [], safety_events: [], tracking_losses: [], pauses: [], connectivity_interruptions: [],
    evidence_references: [], deadline_context: null, trajectory_evidence: {}, versions: {},
    original_result_id: null, revision_index: 0
  };

  // execution_score/confidence/label/recommendation sent here are this lab's
  // own OPTIMISTIC PREVIEW (computed client-side from its own view of the
  // runs) — the server independently recomputes all four from the session's
  // stored, server-derived observer_result rows and `saved` below reflects
  // ONLY that server truth, never this preview.
  const saved = await edgeCall('universal-live-proof-result-save', {
    session_id: lab.sessionId, result: resultPayload, execution_score: executionScore, verification_confidence: confidence,
    confidence_label: label, recommendation: rec.recommendation, recommendation_reason: rec.reason
  });

  lab.resultId = saved.result_id;
  setState(snapshot.state);
  incompleteWarningEl.style.display = snapshot.state === 'incomplete' ? 'block' : 'none';
  $('ulFetchResult').disabled = false;
  log({ snapshot, client_preview: { execution_score: executionScore, verification_confidence: confidence, confidence_label: label, recommendation: rec.recommendation }, server_computed: saved });
}

async function fetchResult() {
  const res = await edgeCall('universal-live-proof-result-get', { result_id: lab.resultId });
  resultIdEl.textContent = `${res.id} (fetched from staging — proves persistence)`;
  log(res);
}

$('ulSignIn').addEventListener('click', () => signIn().catch((e) => { authStatusEl.textContent = String(e); }));
$('ulLoadTask').addEventListener('click', () => loadTaskAndCompilePlan().catch((e) => log({ error: String(e.stack || e) })));
$('ulSessionCreate').addEventListener('click', () => createSession().catch((e) => log({ error: String(e.stack || e) })));
$('ulStartCamera').addEventListener('click', () => startRun('camera').catch((e) => log({ error: String(e.stack || e) })));
$('ulStartFocus').addEventListener('click', () => startRun('focus').catch((e) => log({ error: String(e.stack || e) })));
$('ulChangeMethod').addEventListener('click', () => changeMethod().catch((e) => log({ error: String(e.stack || e) })));
$('ulFinish').addEventListener('click', () => finishOrSubmitIncomplete('finish').catch((e) => log({ error: String(e.stack || e) })));
$('ulSubmitIncomplete').addEventListener('click', () => finishOrSubmitIncomplete('submit_incomplete').catch((e) => log({ error: String(e.stack || e) })));
$('ulFetchResult').addEventListener('click', () => fetchResult().catch((e) => log({ error: String(e.stack || e) })));

window.__ulLab = lab;
