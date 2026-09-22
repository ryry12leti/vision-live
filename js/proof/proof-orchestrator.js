/* Package 6 — Proof orchestration (extracted byte-exact from tasks-page.js).
   Owns the shared proof lifecycle that photo/voice/live all route through: QA/telemetry
   emit, freshness-challenge issue, live-claim event queue + status poll, the doSubmitProof
   global (stubbed here, reassigned by the detail-sheet init), proof-type detection/routing
   (proofTypesFor/proofRequirementCopy), the banner/label UI, setup/select/teardown of the
   capture surface, and the media-teardown authority (teardownCapture/teardownStreamsOnly).
   Single source of the CAP capture-state operations. Loaded before tasks-page.js; references
   to CAP/D/SIGNED_IN and the modality UIs (toggleVoiceRec/toggleLiveRec/closeLive/finishLive)
   resolve at call time from the shared global scope. No XP is computed here — the server is
   the sole awarder; doSubmitProof only reads back the servers decision. */

/* Capture-state authority: canonical proof-type folding, the fresh CAP factory, the
   single CAP capture-state binding, and the pagehide hard-stop. Moved here from tasks-page.js
   so all proof-capture state + operations live in one module. */
/* ================================================================
   ADAPTIVE PROOF CAPTURE — exactly THREE proof types: photo · voice · live
   A screenshot is a MODE of photo proof (an uploaded image), never a fourth
   type. canonPT() folds any legacy 'screenshot'/'knowledge' value into 'photo'.
   ================================================================ */
// fold any stored value to one of the three capture surfaces (defensive: legacy
// DB rows may still carry 'screenshot'). Prefers the library's shared canonicaliser.
function canonPT(ty) {
  try { if (VISION.tasks && VISION.tasks.canonicalProofType) return VISION.tasks.canonicalProofType(ty); } catch(e) {}
  const v = String(ty || '').toLowerCase();
  return v === 'live' ? 'live' : v === 'voice' ? 'voice' : 'photo';
}
function freshCaptureState() { return { stream:null,rec:null,chunks:[],timer:null,t0:0,recording:false,coach:null,coaching:false,countdownRunning:false,finishOnStop:false,facing:'environment',swapping:false,requestGen:0,cleanup:[],liveSessionId:null,liveSequence:0,sessionFinishPromise:null,lastCoachState:null,lastSentRep:0,lastSentReject:0,lastSentHoldMs:0,lastSetupReady:false,lastPoseTracking:false,lastSelectedSide:'none',lastEngineStatus:null,lastActivitySentAt:0,lastStatusPollAt:0,statusPoll:null,pendingChallenge:null,pendingCheckpoint:null,checkpointUpload:null,finalCheckpointPath:null,serverInstruction:'',eventQueue:Promise.resolve(),qaModelState:null,qaTracking:null,qaLastRep:0,qaLastReject:0,qaLastFrameAt:0,qaFps:0,qaCalibrationFailed:false }; }
let CAP = freshCaptureState();

// hard stop on navigation / back / page hide: never leave the camera or the
// inference loop running when the page goes away
window.addEventListener('pagehide', function(){ try { if (CAP.stream) closeLive(); } catch(e) {} });
function proofQaUpdate(section, values) {
  try { if (VISION.proofQa) VISION.proofQa.update(section, values || {}); } catch(e) {}
}
function proofBrowserCategory() {
  const ua = String((navigator && navigator.userAgent) || '').toLowerCase();
  if (/edg\//.test(ua)) return 'edge';
  if (/firefox\//.test(ua)) return 'firefox';
  if (/crios|chrome\//.test(ua)) return 'chrome';
  if (/safari\//.test(ua)) return 'safari';
  return 'other';
}
function proofDeviceClass() {
  const ua = String((navigator && navigator.userAgent) || '').toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/iphone|android|mobile/.test(ua)) return 'mobile';
  return 'desktop';
}
function proofTelemetry(eventType, extra) {
  if (!(SIGNED_IN && VISION.api && VISION.api.recordProofTelemetry)) return;
  const task = D.task || {}, contract = task.proofContract || task.proof_contract || {};
  const payload = Object.assign({
    event_type:eventType, modality:canonPT(D.proofType),
    verifier_id:contract.verifier_id || contract.verifierId || null,
    verifier_version:contract.verifier_version || contract.verifierVersion || contract.version || null,
    contract_version:task.proofContractVersion || task.proof_contract_version || contract.contract_version || null,
    device_class:proofDeviceClass(), browser_category:proofBrowserCategory(),
    live_session_id:CAP.liveSessionId || D.liveSessionId || null
  }, extra || {});
  Promise.resolve(VISION.api.recordProofTelemetry(payload)).catch(function(){});
}
function setFreshnessControls(enabled) {
  const file=$('tdFile'), voice=$('tdVoiceRec'), submit=$('tdSubmit');
  if(file)file.disabled=!enabled;if(voice)voice.disabled=!enabled;if(submit&&D.proofType!=='live')submit.disabled=!enabled;
}
async function requestProofChallenge(mission,ty) {
  const box=$('tdFreshnessChallenge');
  D.proofChallenge=null;
  if(ty==='live'){if(box)box.style.display='none';return;}
  if(box){box.style.display='';box.textContent='Preparing a secure freshness check…';}
  setFreshnessControls(false);
  if(!(SIGNED_IN&&VISION.api&&VISION.api.issueProofChallenge)){
    if(box)box.textContent='Freshness verification is unavailable. Reload before capturing proof.';
    proofTelemetry('verifier_unavailable',{reason_code:'freshness_rpc_unavailable'});return;
  }
  const taskId=mission&&mission.id;
  try {
    const result=await VISION.api.issueProofChallenge(taskId,canonPT(ty));
    if(!D.task||D.task.id!==taskId||D.proofType!==ty)return;
    if(!result||result.error||!result.challenge_id){
      if(box)box.textContent='Could not prepare the freshness check. Reload and try again.';
      proofTelemetry('challenge_failed',{reason_code:'challenge_issue_failed'});return;
    }
    D.proofChallenge=result;
    if(box)box.textContent=result.instruction;
    proofQaUpdate(ty,{freshness_challenge:'issued'});
    setFreshnessControls(true);
  } catch(e) {
    if(box)box.textContent='Could not prepare the freshness check. Reload and try again.';
    proofTelemetry('challenge_failed',{reason_code:'challenge_issue_failed'});
  }
}
function queueLiveClaimEvent(type,payload) {
  if (!CAP.liveSessionId || !VISION.api || !VISION.api.liveSessionEvent) return Promise.resolve(null);
  CAP.eventQueue=(CAP.eventQueue||Promise.resolve()).then(function(){return VISION.api.liveSessionEvent(CAP.liveSessionId,++CAP.liveSequence,performance.now(),type,payload||{});});
  return CAP.eventQueue;
}
function pollLiveSessionStatus() {
  if (!CAP.liveSessionId || !VISION.api || !VISION.api.liveSessionStatus || CAP.statusPoll) return;
  const now=performance.now();if(now-CAP.lastStatusPollAt<1000)return;CAP.lastStatusPollAt=now;
  CAP.statusPoll=Promise.resolve(VISION.api.liveSessionStatus(CAP.liveSessionId)).then(function(status){
    if(status&&status.pending_checkpoint&&!CAP.checkpointUpload){CAP.pendingCheckpoint=status.pending_checkpoint;CAP.serverInstruction=String(status.pending_checkpoint.instruction||'Hold the requested position for a server checkpoint.');}
    if(status&&status.challenge&&status.challenge.state==='issued'){
      CAP.pendingChallenge=status.challenge;
      if(!status.pending_checkpoint)CAP.serverInstruction=String((status.challenge.challenge_payload||{}).instruction||'Complete the on-screen check safely.');
    }else if(status&&['passed','failed','expired','uncertain'].indexOf(status.challenge_state)>-1){CAP.pendingChallenge=null;CAP.serverInstruction='';}
  }).catch(function(){}).finally(function(){CAP.statusPoll=null;});
}
// assigned by the detail-sheet init block; called by the live "Finish & verify" flow
var doSubmitProof = function(){};
const PTYPE_LABELS = { photo: 'Add your proof photo or screenshot', screenshot: 'Add your screenshot', voice: 'Record your proof', live: 'Film a live clip' };
// non-interactive banner copy — the app commits to ONE proof type, no choice.
// Statement HTML uses a serif accent (.ser) on the method word for a luxury feel.
const PTYPE_BANNER = {
  photo:      'Proved by a <i class="ser">photo</i> of your work.',
  screenshot: 'Proved by a <i class="ser">screenshot</i>.',
  voice:      'Proved by your <i class="ser">voice</i> — just talk it through.',
  live:       'Proved <i class="ser">live</i> — VISION coaches you in real time.'
};
// crafted ultra-light line icons (currentColor) — replace the placeholder glyphs
const PROOF_ICONS = {
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.5" cy="10" r="1.6"/><path d="M3.5 17l4.5-4.2 3.7 3.2L16 11l4.5 4.5"/></svg>',
  mic:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/></svg>',
  live:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none"/><path d="M7.5 7.5a6.4 6.4 0 0 0 0 9"/><path d="M16.5 7.5a6.4 6.4 0 0 1 0 9"/><path d="M4.8 4.8a10.2 10.2 0 0 0 0 14.4"/><path d="M19.2 4.8a10.2 10.2 0 0 1 0 14.4"/></svg>'
};
function proofIcon(ty) {
  const map = { photo: 'image', screenshot: 'image', voice: 'mic', live: 'live' };
  return PROOF_ICONS[map[ty] || 'image'];
}
function setProofBanner(ty) {
  ty = canonPT(ty);
  const banner = $('tdProofBanner'); if (banner) banner.style.display = '';
  const ico = $('tpbIco'); if (ico) ico.innerHTML = proofIcon(ty);
  const txt = $('tpbText'); if (txt) txt.innerHTML = PTYPE_BANNER[ty] || PTYPE_BANNER.photo;
}
// the photo dropzone label holds an icon + a text span — only swap the text
function setFileLabel(t) { const el = $('tflTxt'); if (el) el.textContent = t; }

function teardownCapture() {
  CAP.requestGen = (CAP.requestGen || 0) + 1;
  exitLiveFullscreen();
  try { if (CAP.coach && CAP.coach.stop) CAP.coach.stop(); } catch(e) {}
  try { teardownV3Ui(); } catch(e) {}
  if (CAP.rec) { try { CAP.rec.onstop = null; } catch(e){} }
  try { if (CAP.rec && CAP.recording) CAP.rec.stop(); } catch(e) {}
  try { if (CAP.timer) clearInterval(CAP.timer); } catch(e) {}
  try { if (CAP.stream) CAP.stream.getTracks().forEach(t => t.stop()); } catch(e) {}
  (CAP.cleanup || []).forEach(function(fn){try{fn();}catch(_){}});
  CAP = freshCaptureState();
  const lv = $('tdLiveVideo'), lp = $('tdLivePlay'), vp = $('tdVoicePlay'), hud = $('lcHud');
  if (lv) { try { lv.srcObject = null; } catch(e){} }
  if (lp) { lp.style.display = 'none'; lp.src = ''; }
  if (vp) { vp.style.display = 'none'; vp.src = ''; }
  if (hud) hud.style.display = 'none';
}

function fmtTime(s) { s = Math.floor(s); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); }

// decide which proof type a task wants + which to offer
function proofTypesFor(mission) {
  let rec = '';
  let normalizedContract = { ok: false };
  if (VISION.proofContract && VISION.proofContract.proofTypeForTask) {
    normalizedContract = VISION.proofContract.normalize(mission.proofContract || mission.proof_contract);
    rec = VISION.proofContract.proofTypeForTask(mission, function(task) {
      if (!VISION.tasks || !VISION.tasks.recommendProofType) return null;
      const goal = (VISION.proof && VISION.proof.state && VISION.proof.state().profile && VISION.proof.state().profile.goal) || '';
      return VISION.tasks.recommendProofType({ task_title: task.title, proof_required: task.proofMustShow || task.proofPrompt || '', arena: task.arena || task.goalType }, goal);
    });
  } else rec = mission.recommended_proof_type || mission.recommendedProofType || '';
  // Live capture is server-backed, so prose classification alone is never
  // enough. A legacy/malformed row without a valid persisted contract routes
  // to Photo instead of opening a camera flow that the server cannot review.
  if (rec === 'live' && !(normalizedContract.ok && normalizedContract.contract.proof_type === 'live')) rec = 'photo';
  let allowed = mission.allowed_proof_types || mission.allowedProofTypes || null;
  if ((!rec || !allowed) && VISION.tasks && VISION.tasks.recommendProofType) {
    try {
      const goal = (VISION.proof && VISION.proof.state && VISION.proof.state().profile && VISION.proof.state().profile.goal) || '';
      // NOTE: mission.proof is a BOOLEAN — the classifier needs the proof TEXT
      if (!rec) rec = VISION.tasks.recommendProofType({ task_title: mission.title, proof_required: mission.proofMustShow || mission.proofPrompt || '', arena: mission.arena || mission.goalType }, goal);
    } catch(e) {}
  }
  // canonicalise to one of the three capture surfaces — the task decides, no fourth type
  rec = canonPT(rec || 'photo');
  allowed = (allowed && allowed.length ? allowed : [rec, 'photo'])
    .map(canonPT).filter((v, i, a) => a.indexOf(v) === i);
  if (allowed.indexOf(rec) === -1) allowed.unshift(rec);
  return { rec, allowed };
}

// Modality-consistent proof copy — the UI must NEVER say "photo of…" while the
// proof method is live/voice. Returns { rec, lead, sub }: for live/voice a lead line
// that matches the method plus the task's substance as a sub-line (with any
// photo/screenshot phrasing stripped); for photo/screenshot the task text verbatim.
function proofRequirementCopy(mission) {
  const { rec } = proofTypesFor(mission);
  const raw = String(mission.proofMustShow || mission.proofPrompt || '').trim();
  if (rec === 'live' || rec === 'voice') {
    const detail = raw
      .replace(/^(a\s+|one\s+)?(photo|picture|screenshot|image|photo\s*\/\s*screenshot)\s*(of|must\s+show|showing|:)?\s*/i, '')
      .replace(/^(show|upload|take)\s+(a\s+)?(photo|picture|screenshot|image)\s*(of|showing)?\s*/i, '')
      .trim();
    if (rec === 'live') {
      // a written-artifact detail (notebook/log/page) makes no sense on camera — drop it
      const writtenArtifact = /\b(notebook|page|written|log|journal|paper|handwrit)/i.test(detail);
      return { rec, lead: 'Do it live on camera — VISION coaches you in real time and verifies the session.',
               sub: (detail && !writtenArtifact) ? ('On camera: ' + detail) : '' };
    }
    return { rec, lead: 'Prove it by voice — talk it through out loud; VISION listens and verifies.',
             sub: detail ? ('Cover: ' + detail) : '' };
  }
  return { rec, lead: '', sub: raw };
}

function setupProofCapture(mission) {
  teardownCapture();
  const { rec, allowed } = proofTypesFor(mission);
  D.proofType = rec;
  try {
    if (VISION.proofQa) {
      VISION.proofQa.setTask(mission, rec);
      VISION.proofQa.setActions({
        restartVerifier:function(){ teardownStreamsOnly(); selectProofType(D.proofType, D.task); },
        restartCalibration:function(){ try { CAP.coach && CAP.coach.v3Recalibrate && CAP.coach.v3Recalibrate(); } catch(e) {} }
      });
      VISION.proofQa.mount();
    }
  } catch(e) {}
  if (!D.telemetryStarted) { D.telemetryStarted = true; proofTelemetry('proof_started'); }
  // Commit to ONE proof type — no picker on the happy path. The segmented control
  // is pre-populated (for the rare fallback) but stays hidden.
  const seg = $('tdProofSeg');
  if (seg) {
    seg.querySelectorAll('.lg-pill').forEach(p => {
      const ty = p.getAttribute('data-ptype');
      const on = allowed.indexOf(ty) > -1 || (ty === 'photo' && allowed.indexOf('screenshot') > -1);
      p.style.display = on ? '' : 'none';
    });
    seg.style.display = 'none';
  }
  // premium banner: tell the user how this task is proved (no choice to make)
  setProofBanner(rec);
  // hidden recovery affordance — only offer it when there's a real alternative
  const altBtn = $('tdProofAlt');
  if (altBtn) {
    const visible = seg ? Array.from(seg.querySelectorAll('.lg-pill')).filter(p => p.style.display !== 'none') : [];
    altBtn.style.display = visible.length > 1 ? '' : 'none';
    altBtn.textContent = 'Wrong way to prove this?';
  }
  // show the right capture surface; keep the precise modality (screenshot stays screenshot)
  selectProofType(rec === 'screenshot' ? 'photo' : rec, mission);
  D.proofType = rec;
  if(rec==='live'){
    const contract=(mission.proofContract||mission.proof_contract||{});
    setText('livePrepInstruction',contract.setup_instruction||'Stand far enough back for the required joints to stay visible.');
    setText('livePrepView',contract.required_camera_view||'Show your full body');
  }
}

// reveal the picker only when the user says the auto-choice is wrong (anti-trap)
function revealProofPicker() {
  const seg = $('tdProofSeg');
  if (seg) seg.style.display = 'flex';
  const altBtn = $('tdProofAlt'); if (altBtn) altBtn.textContent = 'Pick how you prove it ↑';
  const banner = $('tdProofBanner'); if (banner) banner.classList.add('is-overridden');
}

function selectProofType(ty, mission) {
  D.proofType = ty;
  proofQaUpdate('common', { modality:canonPT(ty) });
  D.fileObj = null; D.poster = null; D.file = false; D.coachSummary = null;
  teardownStreamsOnly();
  // pills active state
  const seg = $('tdProofSeg');
  if (seg) seg.querySelectorAll('.lg-pill').forEach(p => p.classList.toggle('is-active', p.getAttribute('data-ptype') === ty));
  // show the matching capture area
  const map = { photo: 'tdCapPhoto', voice: 'tdCapVoice', live: 'tdCapLive' };
  Object.keys(map).forEach(k => { const el = $(map[k]); if (el) el.style.display = (k === ty) ? '' : 'none'; });
  // live uses its own "Finish & verify" button; photo/voice use the generic Submit
  const submitBtn = $('tdSubmit'); if (submitBtn) submitBtn.style.display = (ty === 'live') ? 'none' : '';
  const finishBtn = $('tdLiveFinish'); if (finishBtn) { finishBtn.style.display = (ty === 'live') ? '' : 'none'; finishBtn.disabled = true; }
  const hud = $('lcHud'); if (hud) hud.style.display = 'none';
  // live: show the idle empty-state (corners + prompt) until the camera starts
  const idle = $('tdLiveIdle'); if (idle) idle.style.display = (ty === 'live') ? '' : 'none';
  const repsEl = $('lcReps'); if (repsEl) repsEl.classList.remove('is-complete');
  // reset photo label/preview (label holds an icon + text span — swap text only)
  setFileLabel(PTYPE_LABELS[ty] || PTYPE_LABELS.photo);
  const prev = $('tdPreview'); if (prev) { prev.style.display = 'none'; prev.src = ''; }
  const st = $('tdStatus'); if (st) { st.textContent = ''; st.className = 'td-submit-status'; }
  // reset recorder labels
  setText('tdVoiceTime', '0:00'); setText('tdLiveTime', '0:00');
  const vlbl = $('tdVoiceRecLbl'); if (vlbl) vlbl.textContent = 'Record';
  requestProofChallenge(mission,ty);
  const llbl = $('tdLiveRecLbl'); if (llbl) llbl.textContent = 'Start camera';
  const countdown=$('liveCountdown');if(countdown)countdown.style.display='none';
  const voiceCountdown=$('voiceCountdown');if(voiceCountdown)voiceCountdown.style.display='none';
  const vrb = $('tdVoiceRec'); if (vrb) vrb.classList.remove('is-recording');
  const lrb = $('tdLiveRec'); if (lrb) lrb.classList.remove('is-recording');
}

// stop active media streams/recorders but keep D.proofType
function teardownStreamsOnly() {
  exitLiveFullscreen();
  try { if (CAP.coach && CAP.coach.stop) CAP.coach.stop(); } catch(e) {}
  if (CAP.rec) { try { CAP.rec.onstop = null; } catch(e){} }
  try { if (CAP.rec && CAP.recording) CAP.rec.stop(); } catch(e) {}
  try { if (CAP.timer) clearInterval(CAP.timer); } catch(e) {}
  try { if (CAP.stream) CAP.stream.getTracks().forEach(t => t.stop()); } catch(e) {}
  CAP = freshCaptureState();
}

function startRecTimer(elId) {
  CAP.t0 = Date.now();
  CAP.timer = setInterval(() => { setText(elId, fmtTime((Date.now() - CAP.t0)/1000)); }, 250);
}

function pickMime(kinds) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  for (const m of kinds) { if (MediaRecorder.isTypeSupported(m)) return m; }
  return '';
}
