/* Package 6 — Live proof capture UI + session control (extracted byte-exact from tasks-page.js).
   Owns the camera/coaching flow: one owned camera stream, one coach/inference loop, the
   server-authoritative live session (start/checkpoint/finish), the V3 HUD, and finishLive.
   Media stops on close/terminal (closeLive); CAP.requestGen invalidates stale session
   callbacks; finishLive never submits without server-verified session evidence. Loaded
   before tasks-page.js; invoked at runtime by the detail-sheet Live controls. */
// ── LIVE — real-time coaching session ──
// step 1: Start camera · step 2: Start coaching (record + live cues) · step 3: Stop
async function toggleLiveRec() {
  const lbl = $('tdLiveRecLbl');
  const vid = $('tdLiveVideo'), play = $('tdLivePlay'), overlay = $('tdLiveOverlay');
  // step 1 — start the camera → go fullscreen + show the live HUD
  if (!CAP.stream) {
    let stream;
    try { stream = await requestOwnedCamera(CAP.facing); }
    catch(e) {
      proofQaUpdate('live',{setup_state:'camera_failed'}); proofTelemetry('capture_failed',{reason_code:'camera_permission_or_device'});
      const st = $('tdStatus'); if (st) { st.textContent = 'Camera blocked — allow camera access to film.'; st.className = 'td-submit-status err'; } return;
    }
    CAP.stream = stream;
    const idle = $('tdLiveIdle'); if (idle) idle.style.display = 'none';
    if (vid) { vid.srcObject = stream; vid.style.display = 'block'; if (play) play.style.display = 'none'; if (overlay) overlay.style.display = ''; try { await bounded(vid.play(),5000,'video_play_timeout'); } catch(e){ stream.getTracks().forEach(t=>t.stop()); CAP.stream=null; proofQaUpdate('live',{setup_state:'video_play_failed'}); proofTelemetry('capture_failed',{reason_code:'video_play_failed'}); return; } }
    const track=stream.getVideoTracks&&stream.getVideoTracks()[0],settings=track&&track.getSettings?track.getSettings():{};
    proofQaUpdate('live',{setup_state:'camera_ready',camera_resolution:String(settings.width||vid.videoWidth||0)+'x'+String(settings.height||vid.videoHeight||0),orientation:(innerHeight>innerWidth?'portrait':'landscape')});
    proofTelemetry('capture_ready');
    applyMirror();
    try { if(VISION.liveCoach&&VISION.liveCoach.preload) VISION.liveCoach.preload(); } catch(e) {}
    enterLiveFullscreen();
    const hud = $('lcHud'); if (hud) hud.style.display = '';   // show the overlay (flip/close + ready state)
    if (lbl) lbl.textContent = 'Start coaching';
    return;
  }
  // step 2 — begin coaching (real-time motion + cloud cues)
  if (!CAP.coaching && !CAP.countdownRunning) { await startLiveCoaching(); return; }
  // step 3 — manual stop: a verified session ends into Finish; anything else is
  // abandoned outright (nothing captured, nothing accepted)
  await endLiveSessionSafely('Session ended without verification — nothing was accepted.');
}

// end the session if it verified; otherwise abandon it cleanly (fail closed)
async function endLiveSessionSafely(abandonMsg) {
  const sState = CAP.coach && CAP.coach.getState ? CAP.coach.getState() : null;
  if (sState && sState.canFinish === true && sState.evidenceSufficient === true) { await stopLiveSession(); return; }
  closeLive();
  const st = $('tdStatus');
  if (st && abandonMsg) { st.textContent = abandonMsg; st.className = 'td-submit-status err'; }
}

// fullscreen + mirror helpers
function applyMirror() {
  const core = document.querySelector('.td-live-core');
  if (core) core.classList.toggle('is-front', CAP.facing === 'user');
}
function enterLiveFullscreen() {
  const cap = $('tdCapLive'); if (cap) cap.classList.add('is-fullscreen');
  // lift the sheet's stacking context above the nav (z 300) so fullscreen truly covers it
  const sheet = $('taskDetail'); if (sheet) sheet.style.zIndex = '399';
}
function exitLiveFullscreen() {
  const cap = $('tdCapLive'); if (cap) cap.classList.remove('is-fullscreen');
  const sheet = $('taskDetail'); if (sheet) sheet.style.zIndex = '';
  const core = document.querySelector('.td-live-core'); if (core) core.classList.remove('is-front');
}

// flip front ⇄ back camera — just swaps the stream; the coach reads the <video>, so
// coaching continues seamlessly (no recorder to juggle).
async function flipCamera() {
  if (!CAP.stream || CAP.swapping) return;
  CAP.swapping = true;
  const newFacing = CAP.facing === 'user' ? 'environment' : 'user';
  let stream;
  try { stream = await requestOwnedCamera(newFacing); }
  catch(e) { CAP.swapping = false; try { VISION.ui.toast('Only one camera available'); } catch(_) {} return; }
  CAP.facing = newFacing;
  try { if (CAP.stream) CAP.stream.getTracks().forEach(t => t.stop()); } catch(e) {}
  CAP.stream = stream;
  const vid = $('tdLiveVideo');
  if (vid) { vid.srcObject = stream; try { await bounded(vid.play(),5000,'video_play_timeout'); } catch(e){stream.getTracks().forEach(t=>t.stop());CAP.swapping=false;return;} }
  applyMirror();
  CAP.swapping = false;
}

function bounded(promise, ms, code) { return new Promise(function(resolve,reject){ const t=setTimeout(function(){reject(new Error(code||'timeout'));},ms); Promise.resolve(promise).then(function(v){clearTimeout(t);resolve(v);},function(e){clearTimeout(t);reject(e);}); }); }
async function requestOwnedCamera(facing) {
  const owner = ++CAP.requestGen;
  const stream = await bounded(navigator.mediaDevices.getUserMedia({video:{facingMode:facing,width:{ideal:960},height:{ideal:720}},audio:false}),12000,'camera_timeout');
  if (owner !== CAP.requestGen) { stream.getTracks().forEach(function(t){t.stop();}); throw new Error('stale_camera_request'); }
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') { stream.getTracks().forEach(function(t){t.stop();}); throw new Error('camera_not_live'); }
  function onMute(){ if(CAP.stream===stream){ queueLiveClaimEvent('client_camera_interrupted',{reason:'track_muted'}); const s=$('tdStatus');if(s)s.textContent='Camera interrupted — tracking paused.'; } }
  function onUnmute(){ if(CAP.stream===stream){ queueLiveClaimEvent('client_tracking_restored',{source:'track_unmuted'}); const s=$('tdStatus');if(s)s.textContent='Camera restored — return to the starting position.'; } }
  function onEnded(){ if(CAP.stream===stream) Promise.resolve(endLiveSessionSafely('Camera ended before verification — nothing was accepted.')).catch(function(){}); }
  track.addEventListener('mute',onMute);track.addEventListener('unmute',onUnmute);track.addEventListener('ended',onEnded);
  function onVisibility(){if(document.hidden&&CAP.stream===stream){queueLiveClaimEvent('client_backgrounded',{});const s=$('tdStatus');if(s)s.textContent='Session paused while VISION is in the background.';}}
  function onOrientation(){if(CAP.stream===stream){queueLiveClaimEvent('client_setup_lost',{reason:'orientation_changed'});const s=$('tdStatus');if(s)s.textContent='Orientation changed — return to the starting position.';}}
  document.addEventListener('visibilitychange',onVisibility);window.addEventListener('orientationchange',onOrientation);
  CAP.cleanup.push(function(){track.removeEventListener('mute',onMute);track.removeEventListener('unmute',onUnmute);track.removeEventListener('ended',onEnded);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('orientationchange',onOrientation);});
  return stream;
}

// close the fullscreen live view, abandon capture, return to inline idle
function closeLive() {
  CAP.requestGen=(CAP.requestGen||0)+1;
  if(CAP.liveSessionId&&VISION.api&&VISION.api.liveSessionFinish){
    const sid=CAP.liveSessionId,seq=++CAP.liveSequence;
    Promise.resolve(CAP.eventQueue||Promise.resolve()).then(function(){return VISION.api.liveSessionFinish(sid,seq,performance.now(),{active_ms:0,selected_side:'none',tracking_quality:0,telemetry:{cancelled:true}});}).catch(function(){});
  }
  try { if (CAP.coach && CAP.coach.stop) CAP.coach.stop(); } catch(e) {}
  try { teardownV3Ui(); } catch(e) {}
  if (CAP.rec) { try { CAP.rec.onstop = null; } catch(e){} }
  try { if (CAP.rec && CAP.recording) CAP.rec.stop(); } catch(e) {}
  try { if (CAP.timer) clearInterval(CAP.timer); } catch(e) {}
  try { if (CAP.stream) CAP.stream.getTracks().forEach(t => t.stop()); } catch(e) {}
  (CAP.cleanup||[]).forEach(function(fn){try{fn();}catch(e){}});
  exitLiveFullscreen();
  CAP.stream = null; CAP.rec = null; CAP.recording = false; CAP.coaching = false; CAP.facing = 'environment';
  D.fileObj = null; D.file = false; D.poster = null; D.coachSummary = null;
  const hud = $('lcHud'); if (hud) hud.style.display = 'none';
  const vid = $('tdLiveVideo'); if (vid) { try { vid.srcObject = null; } catch(e){} vid.style.display = 'block'; }
  const play = $('tdLivePlay'); if (play) { play.style.display = 'none'; play.src = ''; }
  const overlay = $('tdLiveOverlay'); if (overlay) overlay.style.display = '';
  const idle = $('tdLiveIdle'); if (idle) idle.style.display = '';
  const fin = $('tdLiveFinish'); if (fin) { fin.style.display = ''; fin.disabled = true; }
  const lbl = $('tdLiveRecLbl'); if (lbl) lbl.textContent = 'Start camera';
  const rb = $('tdLiveRec'); if (rb) rb.classList.remove('is-recording');
  setText('tdLiveTime', '0:00');
}

async function startLiveCoaching() {
  const btn = $('tdLiveRec'), lbl = $('tdLiveRecLbl'), vid = $('tdLiveVideo');
  if (!CAP.stream) return;
  CAP.countdownRunning=true;
  if(btn)btn.disabled=true;
  const countdown=$('liveCountdown'),value=$('liveCountdownValue'),owner=CAP.requestGen;
  if(countdown)countdown.style.display='flex';
  for(const n of [3,2,1]){
    if(owner!==CAP.requestGen||!CAP.stream){CAP.countdownRunning=false;if(countdown)countdown.style.display='none';if(btn)btn.disabled=false;return;}
    if(value)value.textContent=String(n);
    await wait(900);
  }
  if(value)value.textContent='GO';
  await wait(350);
  if(countdown)countdown.style.display='none';
  CAP.countdownRunning=false;if(btn)btn.disabled=false;
  if(owner!==CAP.requestGen||!CAP.stream)return;
  // NO MediaRecorder — live proof is a live STILL captured during the coached session,
  // so we skip the heavy/flaky video upload entirely. Session = motion engine + cloud cues.
  CAP.coach = null;
  try {
    if ((window.VISION_LIVE_V2 === true || window.VISION_LIVE_V3 === true) && VISION.api && VISION.api.liveSessionStart) {
      const sr = await VISION.api.liveSessionStart(D.task.id,{device_tier:/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?'mobile':'desktop',engine_name:'movenet-lightning',engine_version:'4.22.0'});
      if (!sr || sr.error || !sr.session_id) throw new Error('live_session_start_failed');
      CAP.liveSessionId=sr.session_id; CAP.liveSequence=1;
      proofQaUpdate('common',{session_ref:VISION.proofQa?VISION.proofQa.shortId(sr.session_id):String(sr.session_id).slice(0,8)});
      CAP.pendingCheckpoint=sr.pending_checkpoint||null;if(CAP.pendingCheckpoint)CAP.serverInstruction=String(CAP.pendingCheckpoint.instruction||'Hold the setup position for a server checkpoint.');
      await VISION.api.liveSessionEvent(CAP.liveSessionId,CAP.liveSequence,performance.now(),'client_session_started',{});
      await queueLiveClaimEvent('client_camera_ready',{});
    }
    if (VISION.liveCoach && VISION.liveCoach.create) {
      CAP.coach = VISION.liveCoach.create({ video: vid, overlay: $('tdLiveOverlay'), task: D.task, onUpdate: updateLiveHud });
      const r = await CAP.coach.start();
      if (!r || r.ok === false) {
        proofQaUpdate('live',{pose_model_state:'failed',setup_state:String((r&&r.error)||'verifier_start_failed')});
        proofTelemetry('pose_model_failed',{reason_code:String((r&&r.error)||'verifier_start_failed').slice(0,64)});
        const st = $('tdStatus');
        const message = r && r.message ? r.message :
          (r && r.error === 'rate_limited' ? 'Daily live-coaching limit reached — try again tomorrow.' :
           r && r.error === 'equipment_verification_unavailable' ? 'A real dumbbell detector is not available, so this weighted task cannot be verified live. Use photo proof instead.' :
           'Live tracking could not start safely. Nothing was accepted — retry or use another proof type.');
        if (st) { st.textContent = message; st.className = 'td-submit-status err'; }
        try { CAP.coach.stop && CAP.coach.stop(); } catch(e) {}
        CAP.coach = null;
        closeLive();
        return;
      }
      if (CAP.coach.isV3 && CAP.coach.isV3()) setupV3Ui();
    }
  } catch(e) { proofQaUpdate('live',{setup_state:'failed'}); proofTelemetry('setup_failed',{reason_code:String((e&&e.message)||'start_failed').slice(0,64)}); CAP.coach = null; const st=$('tdStatus');if(st){st.textContent='Secure Live session could not start. Nothing was accepted — check your connection and retry.';st.className='td-submit-status err';} closeLive(); return; }
  CAP.coaching = true; CAP.recording = true;   // "recording" here = session active (drives label/timer)
  const hud = $('lcHud'); if (hud) hud.style.display = '';
  const fin = $('tdLiveFinish'); if (fin) { fin.style.display = ''; fin.disabled = true; }
  if (btn) btn.classList.add('is-recording'); if (lbl) lbl.textContent = 'Stop';
  startRecTimer('tdLiveTime');
  // No coach means no Live Proof. Never unlock Finish from elapsed time alone.
  if (!CAP.coach) { const st=$('tdStatus'); if(st){st.textContent='Live tracking is unavailable. Nothing was accepted.';st.className='td-submit-status err';} closeLive(); return; }
}

function grabCurrentLiveFrame() {
  let still = null;
  try { if (CAP.coach && CAP.coach.grabStill) still = CAP.coach.grabStill(); } catch(e) {}
  if (!still) { try { if (CAP.coach && CAP.coach.getBestFrame) still = CAP.coach.getBestFrame(); } catch(e) {} }
  if (!still) {
    try {
      const vid = $('tdLiveVideo'), cv = document.createElement('canvas');
      cv.width = vid.videoWidth || 720; cv.height = vid.videoHeight || 540;
      cv.getContext('2d').drawImage(vid, 0, 0, cv.width, cv.height);
      still = cv.toDataURL('image/jpeg', 0.85);
    } catch(e) { still = null; }
  }
  return still;
}

// capture the live still (THE proof for live) + coach summary, while the camera is still on
function captureLiveStill() {
  const still=grabCurrentLiveFrame();
  if (still) { D.fileObj = still; D.file = true; D.poster = null; }
  try { if (CAP.coach && CAP.coach.getCoachSummary) D.coachSummary = CAP.coach.getCoachSummary(); } catch(e) {}
  return still;
}

function liveCheckpointMatches(checkpoint,state) {
  if(!checkpoint||!state||!state.poseTracking)return false;
  const expected=String(checkpoint.expected_phase||'');const phase=String(state.phase||'');
  if(expected==='hold')return phase==='holding'||phase==='hold'||(state.holdMs||0)>0;
  if(expected==='active')return phase==='moving';
  if(expected==='drive')return /_drive$/.test(phase);
  return phase===expected;
}
function liveChallengeCountdownComplete(checkpoint) {
  if(!checkpoint||checkpoint.checkpoint_type!=='challenge')return true;
  const payload=(CAP.pendingChallenge&&CAP.pendingChallenge.challenge_payload)||{};
  const issued=Date.parse(checkpoint.issued_at||((CAP.pendingChallenge||{}).issued_at)||'');
  return !Number.isFinite(issued)||Date.now()>=issued+Math.max(0,Number(payload.countdown_seconds)||0)*1000;
}
function processPendingLiveCheckpoint(state) {
  const checkpoint=CAP.pendingCheckpoint;
  if(!checkpoint||CAP.checkpointUpload||checkpoint.checkpoint_type==='final'||!liveChallengeCountdownComplete(checkpoint)||!liveCheckpointMatches(checkpoint,state))return;
  const still=grabCurrentLiveFrame();if(!still)return;
  CAP.checkpointUpload=Promise.resolve(VISION.api.liveSessionUploadCheckpoint(CAP.liveSessionId,checkpoint.checkpoint_id,still)).then(function(receipt){
    if(receipt&&receipt.accepted_checkpoint_receipt){CAP.pendingCheckpoint=null;CAP.serverInstruction=checkpoint.checkpoint_type==='challenge'?'Challenge response received — server review pending.':'';}
  }).catch(function(){}).finally(function(){CAP.checkpointUpload=null;CAP.lastStatusPollAt=0;});
}
async function ensureFinalLiveCheckpoint(still,state) {
  if(!CAP.liveSessionId||!VISION.api||!VISION.api.liveSessionCheckpointRequestFinal||!VISION.api.liveSessionUploadCheckpoint)return false;
  if(CAP.checkpointUpload)await CAP.checkpointUpload;
  for(let attempt=0;attempt<4;attempt++){
    const response=await VISION.api.liveSessionCheckpointRequestFinal(CAP.liveSessionId);
    const checkpoint=response&&response.pending_checkpoint;
    if(!checkpoint){const st=$('tdStatus');if(st){st.textContent='Server checkpoint plan is not ready. Keep the camera open and retry.';st.className='td-submit-status err';}return false;}
    CAP.pendingCheckpoint=checkpoint;CAP.serverInstruction=String(checkpoint.instruction||'Hold the requested position for the server checkpoint.');
    if(!liveChallengeCountdownComplete(checkpoint)||!liveCheckpointMatches(checkpoint,state)){
      const st=$('tdStatus');if(st){st.textContent=CAP.serverInstruction;st.className='td-submit-status';}return false;
    }
    const image=checkpoint.checkpoint_type==='final'?still:grabCurrentLiveFrame();if(!image)return false;
    CAP.checkpointUpload=VISION.api.liveSessionUploadCheckpoint(CAP.liveSessionId,checkpoint.checkpoint_id,image);
    const receipt=await CAP.checkpointUpload;CAP.checkpointUpload=null;
    if(!receipt||!receipt.accepted_checkpoint_receipt){const st=$('tdStatus');if(st){st.textContent='Checkpoint upload failed. Keep the camera open and retry.';st.className='td-submit-status err';}return false;}
    CAP.pendingCheckpoint=null;CAP.serverInstruction='';
    if(checkpoint.checkpoint_type==='final'){CAP.finalCheckpointPath=receipt.path||null;return !!CAP.finalCheckpointPath;}
  }
  return false;
}

// end the live session (keeps the captured still); Finish then submits it
async function stopLiveSession() {
  if (CAP.stream) {
    const finalState = CAP.coach && CAP.coach.getState ? CAP.coach.getState() : null; CAP.lastCoachState=finalState;
    if (!finalState || finalState.canFinish !== true || finalState.evidenceSufficient !== true) {
      const status = $('tdStatus');
      if (status) { status.textContent = 'Session not verified yet. Complete the exact task with valid tracking before finishing.'; status.className = 'td-submit-status err'; }
      return false;
    }
    const still=captureLiveStill();
    if(CAP.liveSessionId){const checkpointReady=await ensureFinalLiveCheckpoint(still,finalState);if(!checkpointReady)return false;}
    try { D.v3Evidence = (CAP.coach && CAP.coach.getV3Evidence) ? CAP.coach.getV3Evidence() : null; } catch(e) { D.v3Evidence = null; }
    try { if (CAP.coach && CAP.coach.stop) CAP.coach.stop(); } catch(e) {}
    try { teardownV3Ui(); } catch(e) {}
    if (CAP.liveSessionId && VISION.api && VISION.api.liveSessionFinish) {
      CAP.sessionFinishPromise=(CAP.eventQueue||Promise.resolve()).then(function(){return VISION.api.liveSessionFinish(CAP.liveSessionId,++CAP.liveSequence,performance.now(),{active_ms:(finalState&&(finalState.durationTargetMs?finalState.clientClaimedDurationMs:finalState.activeMs))||0,selected_side:(finalState&&finalState.selectedSide)||'none',tracking_quality:(finalState&&finalState.trackingConfidence)||0,telemetry:{engine_status:finalState&&finalState.engineStatus,evidence_state:finalState&&finalState.evidenceState,visibility_state:finalState&&finalState.visibilityState,lighting_confidence:finalState&&finalState.lightingConfidence,v3_evidence:D.v3Evidence||undefined}});});
    }
    if (CAP.timer) clearInterval(CAP.timer);
    try { CAP.stream.getTracks().forEach(t => t.stop()); } catch(e) {}
    CAP.stream = null; CAP.recording = false; CAP.coaching = false;
  }
  exitLiveFullscreen();
  const btn = $('tdLiveRec'), lbl = $('tdLiveRecLbl');
  if (btn) btn.classList.remove('is-recording'); if (lbl) lbl.textContent = 'Re-film';
  const st = $('tdStatus'); if (st && D.fileObj) { st.textContent = 'Captured — tap Finish & verify.'; st.className = 'td-submit-status ok'; }
  return true;
}

/* ── LIVE PROOF V3 session UI (staging flag) ─────────────────────────────── */
function setupV3Ui() {
  teardownV3Ui();
  const host = document.querySelector('.td-live-core');
  const v3 = CAP.coach && CAP.coach.getV3 ? CAP.coach.getV3() : null;
  if (host && VISION.liveDiagnosticsV3) {
    CAP.v3Chip = VISION.liveDiagnosticsV3.mountVersionChip(host, 'Live Proof V3 · ' + ((v3 && v3.displayName) || 'Session'));
    CAP.v3Diag = VISION.liveDiagnosticsV3.create(host);   // renders only when diag gate allows
  }
  const panel = $('lcV3'); if (panel) panel.style.display = '';
  const recal = $('lcV3Recal');
  if (recal) { recal.style.display = ''; recal.onclick = function(){ try { CAP.coach && CAP.coach.v3Recalibrate && CAP.coach.v3Recalibrate(); } catch(e) {} }; }
  const exp = $('lcV3Export');
  if (exp) { exp.style.display = (CAP.v3Diag && CAP.v3Diag.enabled) ? '' : 'none'; exp.onclick = exportV3Diagnostics; }
  CAP.v3WasLost = false; CAP.v3RestoreUntil = 0; CAP.v3RejectUntil = 0;
}
function teardownV3Ui() {
  try { if (CAP.v3Diag && CAP.v3Diag.destroy) CAP.v3Diag.destroy(); } catch(e) {}
  try { document.querySelectorAll('[data-vision-diag]').forEach(function(el){ el.remove(); }); } catch(e) {}
  CAP.v3Diag = null; CAP.v3Chip = null;
  const panel = $('lcV3'); if (panel) panel.style.display = 'none';
  const chk = $('lcV3Check'); if (chk) chk.textContent = '';
  const line = $('lcV3Line'); if (line) line.textContent = '';
}
// staging-only diagnostics bundle download — no tokens, no account data, no video
function exportV3Diagnostics() {
  if (!(CAP.coach && CAP.coach.getV3Diagnostics)) return;
  const bundle = CAP.coach.getV3Diagnostics(); if (!bundle) return;
  bundle.app = { page: 'tasks', host: location.hostname, flag_live_v3: window.VISION_LIVE_V3 === true };
  bundle.identity = VISION.envIdentity || null; // backend ref + env + commit — no keys
  bundle.task = { id: (D.task && D.task.id) || null, title: (D.task && D.task.title) || '' };
  try {
    const blob = new Blob([JSON.stringify(bundle, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'vision-live-v3-diagnostics-' + Date.now() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 5000);
    try { VISION.ui.toast('Diagnostics exported'); } catch(e) {}
  } catch(e) {}
}
// renders the V3 stage/checklist/coaching state over the default HUD values.
// The ordinary user only ever sees plain-language messages — reason codes and
// raw angles stay inside the (staging-gated) diagnostics panel.
function renderV3Hud(state) {
  const v3 = state.v3; if (!v3) return;
  const pill = $('lcPill'), pillTxt = $('lcPillText'), cue = $('lcCue');
  const line = $('lcV3Line'), chk = $('lcV3Check'), reps = $('lcReps'), recal = $('lcV3Recal');
  const r = v3.result || {};
  const now = Date.now();
  const frameNow=performance.now();
  if(CAP.qaLastFrameAt){const dt=frameNow-CAP.qaLastFrameAt;if(dt>0)CAP.qaFps=CAP.qaFps*.8+(1000/dt)*.2;}CAP.qaLastFrameAt=frameNow;
  const lost = v3.stage === 'counting' && (!r.state || r.state === 'need_setup' || r.state === 'tracking_unstable');
  proofQaUpdate('live',{
    pose_model_state:state.engineStatus||'loading',pose_model_version:'TFJS 4.22.0 · pose-detection 2.1.3 · MoveNet singlepose-lightning-v4',
    fps:CAP.qaFps?Math.round(CAP.qaFps):'—',inference_latency_ms:state.poseMs!=null?Math.round(state.poseMs):'—',
    selected_body_side:r.selectedSide||state.selectedSide||'—',view_classification:r.cameraView||'—',
    landmark_visibility_summary:r.requiredLandmarksVisible!=null?Math.round(r.requiredLandmarksVisible*100)+'%':'—',
    setup_state:v3.stage||r.state||'—',calibration_state:r.calibrated?'calibrated':(v3.calibrationStuck?'failed':'calibrating'),
    phase:r.phase||state.phase||'—',accepted_count:r.reps||state.reps||0,rejected_count:r.rejectedReps||state.clientRejectedReps||0,
    last_rejection_reason:r.rejectionReason||'—',tracking_state:lost?'lost':'tracking',coaching_reason:state.lastCue||r.cue||'—',
    integrity_status:state.integrityState||state.evidenceState||'—',
    equipment_verification_status:v3.equipmentRequired?'unavailable — fail closed':'not required'
  });
  if(v3.calibrationStuck&&!CAP.qaCalibrationFailed){CAP.qaCalibrationFailed=true;proofTelemetry('calibration_failed',{reason_code:'calibration_stuck'});}

  // persistent identity line: exercise, engine, side/view + honest equipment label
  if (line) {
    let t = v3.displayName + ' · V3';
    if (r.selectedSide && r.selectedSide !== 'none') t += ' · ' + r.selectedSide + ' side';
    // weighted sessions are blocked before startup; if one is ever visible it
    // must read as NOT verifiable — movement alone is never weighted proof
    if (v3.equipmentRequired) t += ' · equipment not verified — use photo proof';
    line.textContent = t;
  }

  // stage pill + message (required wording)
  let pillText = '', msg = '';
  if (v3.stage === 'setup') {
    pillText = 'Setting up';
    msg = 'Get into position — completing the checks below.';
    if (chk) chk.innerHTML = (v3.checklist || []).map(function(i){
      return '<span class="' + (i.ok ? 'ok' : '') + '">' + (i.ok ? '✓' : '○') + ' ' + i.label + '</span>';
    }).join(' · ');
  } else if (chk && chk.textContent) chk.textContent = '';
  if (v3.stage === 'practice') {
    pillText = 'Practice';
    msg = 'Perform one slow practice rep, then return to the starting position.';
  } else if (v3.stage === 'countdown') {
    pillText = 'Get ready';
    msg = 'Counting starts in ' + (v3.countdownRemaining || 0) + '…';
  } else if (v3.stage === 'counting') {
    pillText = lost ? 'Paused' : v3.displayName;
    if (lost) { msg = 'Counting paused — return to the frame.'; CAP.v3WasLost = true; }
    else if (CAP.v3WasLost) { CAP.v3WasLost = false; CAP.v3RestoreUntil = now + 2200; }
    if (!msg && CAP.v3RestoreUntil > now) msg = 'Tracking restored — return to the starting position.';
    if (r.rejectionReason) CAP.v3RejectUntil = now + 1800;
    if (!msg && CAP.v3RejectUntil > now) msg = 'Almost — complete the full movement.';
    if (!msg) msg = state.lastCue || '';
  }
  if (v3.calibrationStuck) {
    msg = 'Calibration didn’t lock. Step back so your full movement is visible, face the camera at a slight angle, then tap Restart calibration — or close this session and use standard photo proof.';
  }
  if (recal) recal.style.display = (v3.stage === 'practice' || v3.stage === 'counting') && v3.mode === 'reps' ? '' : 'none';
  if (pillTxt && pillText) pillTxt.textContent = pillText;
  if (pill) pill.className = 'lc-pill' + (lost ? ' is-adjust' : (v3.stage === 'counting' ? ' is-good' : ''));
  if (cue && msg && cue.textContent !== msg) cue.textContent = msg;

  // reps/hold/duration line augmentation for equipment sessions
  if (reps && v3.equipmentRequired && reps.style.display !== 'none' && reps.textContent.indexOf('unverified weight') < 0) {
    reps.textContent += ' · unverified weight';
  }
  // staging diagnostics panel — full technical detail lives here, not in the HUD
  if (CAP.v3Diag && CAP.v3Diag.enabled) {
    CAP.v3Diag.update(r, { flag: 'V3 on · stage ' + v3.stage, target: state.targetReps || 0,
      poseMs: state.poseMs || 0, objMs: v3.objMs || 0, cue: state.lastCue || '' });
  }
}

function updateLiveHud(state) {
  try { window.__liveState = state; } catch(e) {}   // read-only test/diagnostics hook
  pollLiveSessionStatus();
  processPendingLiveCheckpoint(state);
  if (CAP.liveSessionId && VISION.api && VISION.api.liveSessionEvent) {
    const repDelta=Math.max(0,(state.clientCountedReps||0)-CAP.lastSentRep),rejectDelta=Math.max(0,(state.clientRejectedReps||0)-CAP.lastSentReject),holdDelta=Math.max(0,(state.clientClaimedHoldMs||state.holdMs||0)-CAP.lastSentHoldMs);
    for(let i=0;i<repDelta;i++)proofTelemetry('rep_accepted',{count_total:state.clientCountedReps||0});
    for(let i=0;i<rejectDelta;i++)proofTelemetry('rep_rejected',{count_total:state.clientRejectedReps||0,reason_code:'on_device_verifier_rejected'});
    if(CAP.qaTracking!==null&&!!state.poseTracking!==CAP.qaTracking)proofTelemetry(state.poseTracking?'tracking_recovered':'tracking_lost');
    CAP.qaTracking=!!state.poseTracking;
    if(state.engineStatus&&state.engineStatus!==CAP.qaModelState){
      if(state.engineStatus==='pose')proofTelemetry('pose_model_loaded',{latency_ms:state.poseMs||null});
      else if(state.engineStatus==='failed'||state.engineStatus==='motion')proofTelemetry('pose_model_failed',{reason_code:'fail_closed_'+state.engineStatus});
      CAP.qaModelState=state.engineStatus;
    }
    CAP.lastSentRep=state.clientCountedReps||0;CAP.lastSentReject=state.clientRejectedReps||0;
    const setupReady=!!state.poseTracking&&state.visibilityState==='ready'&&state.phase!=='setup'&&state.phase!=='tracking_unstable';
    if(setupReady&&!CAP.lastSetupReady)queueLiveClaimEvent('client_setup_candidate',{phase:state.phase,selected_side:state.selectedSide});
    if(!setupReady&&CAP.lastSetupReady)queueLiveClaimEvent('client_setup_lost',{reason:'on_device_setup_lost'});
    if(!!state.poseTracking!==CAP.lastPoseTracking)queueLiveClaimEvent(state.poseTracking?'client_tracking_restored':'client_tracking_unstable',{});
    if(state.selectedSide&&state.selectedSide!==CAP.lastSelectedSide){CAP.lastSelectedSide=state.selectedSide;queueLiveClaimEvent('client_side_selected',{selected_side:state.selectedSide});}
    if(state.engineStatus&&state.engineStatus!==CAP.lastEngineStatus){CAP.lastEngineStatus=state.engineStatus;if(state.engineStatus==='degraded'||state.engineStatus==='motion')queueLiveClaimEvent('client_engine_degraded',{engine_status:state.engineStatus});}
    CAP.lastSetupReady=setupReady;CAP.lastPoseTracking=!!state.poseTracking;
    for(let i=0;i<repDelta;i++)queueLiveClaimEvent('client_rep_candidate',{verifier_id:state.exercise,selected_side:state.selectedSide,phase:state.phase});
    for(let i=0;i<rejectDelta;i++)queueLiveClaimEvent('client_rep_rejected',{reason:'on_device_verifier_rejected'});
    if(holdDelta>=250){const chunks=Math.floor(holdDelta/250);CAP.lastSentHoldMs+=chunks*250;for(let i=0;i<chunks;i++)queueLiveClaimEvent('client_hold_sample',{claimed_delta_ms:250});}
    const now=performance.now();if(now-CAP.lastActivitySentAt>=1000){CAP.lastActivitySentAt=now;queueLiveClaimEvent('client_activity_sample',{active_ms:Math.max(0,state.durationTargetMs?state.clientClaimedDurationMs:(state.activeMs||0)),tracking_quality:state.trackingConfidence||0,visibility_state:state.visibilityState||'unknown'});}
  }
  const pill = $('lcPill'), pillTxt = $('lcPillText'), cue = $('lcCue'), reps = $('lcReps'), fin = $('tdLiveFinish'), energy = $('lcEnergy');
  if (!pill) return;
  const m = state.motion || 0;
  // instant status from on-device pose/motion; cloud adjust/offtask cues override.
  // engineStatus tells the user we're warming up (never a frozen screen) or that
  // pose is unavailable and we're running the motion engine.
  let cls = 'lc-pill', txt;
  if (state.visibilityState && state.visibilityState !== 'ready') { cls += ' is-adjust'; txt = String(state.visibilityState).replace(/_/g, ' '); }
  else if (state.recoveredAt && Date.now() - state.recoveredAt < 1600) { cls += ' is-good'; txt = 'Tracking recovered'; }
  else if (state.lastStatus === 'offtask') { cls += ' is-off'; txt = 'Can’t see you'; }
  else if (state.lastStatus === 'adjust') { cls += ' is-adjust'; txt = 'Adjust'; }
  else if (state.poseTracking) { cls += ' is-good'; txt = 'Locked on' + (state.exercise && state.exercise !== 'generic' ? ' · ' + state.exercise.replace(/_/g, ' ') : ''); }
  else if (state.engineStatus === 'loading' && m <= 0.12) { txt = 'Calibrating…'; }
  else if (m > 0.12) { cls += ' is-good'; txt = state.engineStatus === 'motion' ? 'Motion mode' : 'Tracking you'; }
  else { txt = 'Get in frame…'; }
  pill.className = cls; if (pillTxt) pillTxt.textContent = txt;
  // live motion meter — fills instantly with movement (the real-time signal)
  if (energy) { energy.style.transform = 'scaleX(' + Math.min(1, m * 1.2).toFixed(3) + ')'; energy.classList.toggle('is-hot', m > 0.5); }
  // cloud cue line with a subtle swap when the text changes
  if (cue) {
    const newCue = CAP.serverInstruction || (state.visibilityState && state.visibilityState !== 'ready' ? state.visibilityCue : '') || state.lastCue || '';
    if (cue.textContent !== newCue) {
      cue.classList.add('is-swap');
      setTimeout(() => { cue.textContent = newCue; cue.classList.remove('is-swap'); }, 180);
    }
  }
  // progress is a plain text readout of the verified target — no ring, no orb
  if (reps) {
    if (state.holdTargetMs || state.holdMs > 0) {
      const cur = Math.round((state.holdMs || 0) / 1000);
      const tgt = state.holdTargetMs ? Math.round(state.holdTargetMs / 1000) : 0;
      reps.style.display = ''; reps.textContent = tgt ? (cur + ' / ' + tgt + 's valid hold') : (cur + 's valid hold');
    } else if (state.durationTargetMs) {
      const cur = Math.round((state.clientClaimedDurationMs || 0) / 1000);
      const tgt = Math.round(state.durationTargetMs / 1000);
      reps.style.display = ''; reps.textContent = cur + ' / ' + tgt + 's valid movement';
    } else if (state.targetReps) {
      reps.style.display = ''; reps.textContent = state.reps + ' / ' + state.targetReps + ' verified reps';
    } else if (state.reps > 0) {
      reps.style.display = ''; reps.textContent = state.reps + ' on-device rep candidates';
    } else reps.style.display = 'none';
    reps.classList.toggle('is-complete', !!state.canFinish);
  }
  if (fin) fin.disabled = !state.canFinish;
  try { renderV3Hud(state); } catch(e) {}
}

async function finishLive() {
  if (CAP.stream) { const stopped=await stopLiveSession();if(!stopped)return; }
  exitLiveFullscreen();
  if (CAP.sessionFinishPromise) {
    let sf;
    try { sf = await CAP.sessionFinishPromise; }
    catch (e) {
      // Browser offline / connection lost mid-finalisation: the finish request never
      // reached the server (or its response never came back), so there is no server
      // verdict to trust. Fail closed exactly like an error-shaped response — never
      // fall through to doSubmitProof on a rejected promise, and never leave the user
      // with a silently hung UI (an unhandled rejection here previously showed nothing).
      const st=$('tdStatus');
      if(st){st.textContent='Connection lost while finishing your session. Reconnect and retry — nothing was accepted.';st.className='td-submit-status err';}
      return;
    }
    if(!sf||sf.error||sf.can_submit_for_review!==true){
      const st=$('tdStatus');
      if(st){st.textContent='The server could not verify enough session evidence yet. Keep the camera open and retry.';st.className='td-submit-status err';}
      return;
    }
  }
  if (!D.fileObj) { const st = $('tdStatus'); if (st) { st.textContent = 'Could not capture your session — try again.'; st.className = 'td-submit-status err'; } return; }
  D.proofType = 'live';
  D.liveSessionId = CAP.liveSessionId;
  await Promise.resolve(doSubmitProof($('tdLiveFinish'))).catch(function(){});
}
