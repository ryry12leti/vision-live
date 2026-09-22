/* Package 6 — Proof submit + detail-sheet event wiring (extracted byte-exact from tasks-page.js).
   The single client-side proof submission authority: reassigns the doSubmitProof global (stubbed
   in proof-orchestrator.js) and wires the detail sheet (close/backdrop/Escape, file-picker,
   proof-type segmented control, voice/live recorders, tdSubmit + live Finish + alt-picker).
   doSubmitProof uploads via VISION.api.submitProof and reads back the server decision
   (duplicate/error/checking/rejected/pending_review/accepted) — the SERVER is the sole XP
   awarder; no XP is computed here. Loaded after proof-orchestrator.js and before tasks-page.js;
   D / CAP / SIGNED_IN and the modality UIs resolve at call time from the shared global scope. */
try {
  // close
  if ($('tdClose')) $('tdClose').addEventListener('click', closeTaskDetail);
  // close when clicking the backdrop (outside the sheet)
  if ($('taskDetail')) $('taskDetail').addEventListener('click', function(e) {
    const sheet = $('tdSheet');
    if (sheet && !sheet.contains(e.target)) closeTaskDetail();
  });
  // keyboard escape
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const rep = document.getElementById('reportTaskModal');
    if (rep && rep.classList.contains('show')) { closeReportModal(); return; }
    closeTaskDetail();
  });

  // file picker
  if ($('tdFile')) $('tdFile').addEventListener('change', function() {
    const f = this.files && this.files[0]; if (!f) return;
    const st = $('tdStatus');
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type || '')) {
      this.value=''; D.fileObj=null; D.file=false;
      proofQaUpdate('photo',{source:'file-picker',mime:f.type||'unknown',size:f.size||0,final_result:'invalid_mime'});
      proofTelemetry('capture_failed',{reason_code:'invalid_mime'});
      if(st){st.textContent='Choose a JPEG, PNG, WebP, or HEIC image.';st.className='td-submit-status err';}
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      this.value=''; D.fileObj=null; D.file=false;
      proofQaUpdate('photo',{source:'file-picker',mime:f.type||'unknown',size:f.size||0,final_result:'too_large'});
      proofTelemetry('capture_failed',{reason_code:'too_large'});
      if(st){st.textContent='That image is over 10 MB. Choose a smaller photo and retry.';st.className='td-submit-status err';}
      return;
    }
    D.fileObj = f; D.file = true;
    proofQaUpdate('photo',{source:'file-picker (camera/gallery)',mime:f.type||'unknown',size:f.size||0,final_result:'capture_ready'});
    proofTelemetry('capture_ready');
    const prev = $('tdPreview');
    if (/^image\//.test(f.type || '')) {
      try { if (prev.dataset.objectUrl) URL.revokeObjectURL(prev.dataset.objectUrl); } catch(e) {}
      prev.onload=function(){ proofQaUpdate('photo',{dimensions:String(prev.naturalWidth||0)+'x'+String(prev.naturalHeight||0)}); };
      prev.src = URL.createObjectURL(f); prev.style.display = 'block';
      prev.dataset.objectUrl = prev.src;
    } else { prev.style.display = 'none'; }
    setFileLabel('✓ ' + (f.name || 'Proof attached') + ' — tap to replace');
    if (st) { st.textContent = ''; st.className = 'td-submit-status'; }
  });

  // proof-type segmented control
  if ($('tdProofSeg')) $('tdProofSeg').addEventListener('click', function(e) {
    const pill = e.target.closest('.lg-pill'); if (!pill) return;
    const ty = pill.getAttribute('data-ptype'); if (!ty) return;
    selectProofType(ty, D.task);
  });
  // recorders
  if ($('tdVoiceRec')) $('tdVoiceRec').addEventListener('click', function(){ Promise.resolve(toggleVoiceRec()).catch(function(){}); });
  if ($('tdLiveRec'))  $('tdLiveRec').addEventListener('click', function(){ Promise.resolve(toggleLiveRec()).catch(function(){}); });
  if ($('lcFlip'))     $('lcFlip').addEventListener('click', function(){ flipCamera(); });
  if ($('lcClose'))    $('lcClose').addEventListener('click', function(){ closeLive(); });

  // submit proof from detail sheet — shared by photo/voice Submit + live "Finish & verify"
  doSubmitProof = async function (btn) {
    if (D.submitting) return;
    const mission = D.task;
    if (!mission) return;

    // demo / not signed-in path — demo NEVER simulates genuine verification.
    // Live proof requires a real authenticated server decision, always. Other
    // proof types may demo-accept only in the offline file:// walkthrough.
    if (!SIGNED_IN || !(VISION && VISION.api && VISION.api.submitProof)) {
      const isLocalFileDemo = TASK_DEMO && location.protocol === 'file:';
      if (D.proofType === 'live' || !isLocalFileDemo) {
        const demoStatus = $('tdStatus');
        if (demoStatus) { demoStatus.textContent = 'Sign in to submit verified proof.'; demoStatus.className = 'td-submit-status err'; }
        try { VISION.ui.toast('<b>Sign in</b> to submit verified proof — nothing was accepted'); } catch(e){}
        return;
      }
      D.submitting = false; demoAcceptProof(mission); return;
    }

    // must have captured media
    if (!D.fileObj) {
      const st = $('tdStatus');
      const msg = D.proofType === 'voice' ? 'Record your proof first — no proof, no verified points.'
                : D.proofType === 'live'  ? 'Film your live clip first — no proof, no verified points.'
                : 'Add a proof photo first — no photo, no verified points.';
      if (st) { st.textContent = msg; st.className = 'td-submit-status err'; }
      return;
    }
    if (D.proofType !== 'live' && !(D.proofChallenge && D.proofChallenge.challenge_id)) {
      const st = $('tdStatus');
      if (st) { st.textContent = 'Freshness check unavailable — reload before submitting.'; st.className = 'td-submit-status err'; }
      proofTelemetry('challenge_failed',{reason_code:'challenge_missing'});
      return;
    }

    const submitBtn = btn || $('tdSubmit');
    const origLabel = submitBtn ? submitBtn.innerHTML : 'Submit Proof <span class="arr">→</span>';
    const st = $('tdStatus');
    D.submitting = true;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Uploading…'; }
    if (st) { st.textContent = 'Uploading proof…'; st.className = 'td-submit-status'; }

    if (submitBtn) submitBtn.textContent = 'Checking proof…';
    if (st) { st.textContent = 'Proof uploaded — checking task evidence…'; st.className = 'td-submit-status'; }

    const note = (($('tdNote') || {}).value || '').trim();
    const resetBtn = () => { if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = origLabel; } };
    try {
      proofTelemetry('proof_submitted');
      proofQaUpdate('common',{final_server_result:'checking',rejection_reason:'—'});
      if(D.proofType==='voice')proofQaUpdate('voice',{transcription_status:'server_checking',final_result:'checking'});
      if(D.proofType==='photo')proofQaUpdate('photo',{final_result:'checking'});
      const r = await VISION.api.submitProof(mission.id, D.fileObj, note, { proofType: D.proofType, poster: D.poster, coachSummary: D.coachSummary, liveSessionId:D.liveSessionId, existingMediaPath:D.proofType==='live'?CAP.finalCheckpointPath:null, challengeId:D.proofChallenge&&D.proofChallenge.challenge_id });
      D.submitting = false;

      // already accepted earlier today
      if (r && r.duplicate) {
        D.telemetryFinal=true; proofTelemetry('duplicate_rejected',{reason_code:'already_verified'});
        proofQaUpdate('common',{final_server_result:'duplicate_rejected',rejection_reason:'already_verified'});
        if(D.proofType==='voice')proofQaUpdate('voice',{replay_dedup_status:'duplicate',final_result:'rejected'});
        if(D.proofType==='photo')proofQaUpdate('photo',{exact_hash_duplicate_result:'duplicate',final_result:'rejected'});
        resetBtn();
        if (st) { st.textContent = 'Already verified — one proof per task per day.'; st.className = 'td-submit-status err'; }
        return;
      }
      // upload / RPC failure (no proof record created)
      if (r && r.error && !r.status) {
        proofQaUpdate('common',{final_server_result:'error',rejection_reason:String(r.error||'submit_error').slice(0,64)});
        resetBtn();
        if (st) { st.textContent = 'Could not submit — ' + (r.error || 'try again'); st.className = 'td-submit-status err'; }
        return;
      }
      // validator could not finish (timeout / network / unconfigured) — stays incomplete, retryable
      if (r && r.status === 'checking') {
        resetBtn();
        const chkReason = String((r && (r.reason || r.error)) || '');
        proofQaUpdate('common',{final_server_result:'checking',rejection_reason:chkReason.slice(0,64)||'retry'});
        if(D.proofType==='voice'){
          proofQaUpdate('voice',{transcription_status:/transcript|speech|audio/i.test(chkReason)?'retry':'server_retry',final_result:'retry'});
          if(/transcript/i.test(chkReason))proofTelemetry('transcription_failed',{reason_code:chkReason.slice(0,64)});
        }
        if(D.proofType==='photo'){proofQaUpdate('photo',{final_result:'retry'});proofTelemetry('uncertain_retry',{reason_code:chkReason.slice(0,64)||'validator_retry'});}
        const chkMsg = /unconfigured/.test(chkReason)
          ? 'Proof saved. Verification is temporarily offline — it will be re-checked, no points lost.'
          : 'Proof uploaded — verification didn’t finish. Tap Submit again to retry.';
        if (st) { st.textContent = chkMsg; st.className = 'td-submit-status err'; }
        return;
      }
      // clear rejection — task stays incomplete
      if (r && r.status === 'rejected') {
        D.telemetryFinal=true;
        const rejectReason=String(r.reason||'rejected').slice(0,64);
        proofQaUpdate('common',{final_server_result:'rejected',rejection_reason:rejectReason});
        if(D.proofType==='voice'){proofQaUpdate('voice',{transcription_status:'completed',semantic_rubric_score:r.confidence!=null?r.confidence:'—',final_result:'rejected'});proofTelemetry('semantic_rejected',{reason_code:rejectReason});}
        if(D.proofType==='photo'){proofQaUpdate('photo',{model_confidence:r.confidence!=null?r.confidence:'—',final_result:'rejected'});proofTelemetry('unrelated_rejected',{reason_code:rejectReason});}
        resetBtn();
        if (st) { st.textContent = 'Needs clearer proof — ' + (r.reason ? String(r.reason).slice(0,90) : 'upload evidence that shows this task done.'); st.className = 'td-submit-status err'; }
        try { VISION.analytics.track('proof_submit_rejected'); } catch(e) {}
        return;
      }
      // ambiguous — held for review, ZERO points, task stays incomplete
      if (r && r.status === 'pending_review') {
        D.telemetryFinal=true; proofQaUpdate('common',{final_server_result:'pending_review',rejection_reason:String(r.reason||'uncertain').slice(0,64)});
        if(D.proofType==='voice')proofQaUpdate('voice',{transcription_status:'completed',semantic_rubric_score:r.confidence!=null?r.confidence:'—',final_result:'pending_review'});
        if(D.proofType==='photo'){proofQaUpdate('photo',{model_confidence:r.confidence!=null?r.confidence:'—',final_result:'retry'});proofTelemetry('uncertain_retry',{reason_code:'pending_review'});}
        try { VISION.analytics.track('proof_submit_pending_review'); } catch(e) {}
        closeTaskDetail();
        setText('doneScore', '0');
        setText('doneCap', 'Under review.');
        setText('doneRecalc', 'No points until your proof passes review.');
        const ovr = $('proofDone');
        if (ovr) ovr.classList.add('show');
        try { BACKEND_TASKS = await VISION.api.getTasks(); } catch(e) {}
        try { await VISION.api.hydrateLocal(); } catch(e) {}
        setTimeout(() => { if (ovr) ovr.classList.remove('show'); try { renderScoreStrip(); } catch(e) {} renderTasks(getMissions(BACKEND_TASKS)); }, 2300);
        dispatchEvent(new Event('vision:proof-logged'));
        return;
      }
      // accepted — points awarded server-side; trigger advances to next task
      if (r && r.status === 'accepted') {
        D.telemetryFinal=true; proofQaUpdate('common',{final_server_result:'accepted',rejection_reason:'—'});
        if(D.proofType==='voice'){proofQaUpdate('voice',{transcription_status:'completed',semantic_rubric_score:r.confidence!=null?r.confidence:'—',replay_dedup_status:'unique',final_result:'accepted'});proofTelemetry('voice_completed');}
        if(D.proofType==='photo'){proofQaUpdate('photo',{model_confidence:r.confidence!=null?r.confidence:'—',exact_hash_duplicate_result:'unique',final_result:'accepted'});proofTelemetry('photo_completed');}
        if(D.proofType==='live')proofTelemetry('session_completed',{count_total:(CAP.lastCoachState&&CAP.lastCoachState.reps)||0});
        const awarded = (r && r.awarded) || 0;
        try { VISION.analytics.track('proof_submit_success', { points_gained: awarded }); } catch(e) {}
        closeTaskDetail();
        // refresh backend state in the background while the unlock sequence plays
        const dataReady = (async () => {
          try { BACKEND_TASKS = await VISION.api.getTasks(); } catch(e) {}
          try { await VISION.api.hydrateLocal(); } catch(e) {}
          // reload progression so reflection panel + task counter update correctly
          try { if (VISION.api.getDailyProgression) D.progression = await VISION.api.getDailyProgression(); } catch(e) {}
        })();
        // premium task-chain unlock: verify seal → card folds away → next lock
        // cracks open → promotes into the hero slot. Counters update after.
        try { playVerifiedUnlock(awarded, dataReady, mission, r); } catch(e) {
          dataReady.then(() => { try { renderScoreStrip(); } catch(_){} renderTasks(getMissions(BACKEND_TASKS)); });
        }
        dispatchEvent(new Event('vision:proof-logged'));
        return;
      }
      // unknown shape — fail closed, do not claim completion
      resetBtn();
      if (st) { st.textContent = 'Could not verify — try again.'; st.className = 'td-submit-status err'; }
    } catch(e) {
      D.submitting = false;
      resetBtn();
      if (st) { st.textContent = 'Something went wrong — try again.'; st.className = 'td-submit-status err'; }
    }
  };
  if ($('tdSubmit'))     $('tdSubmit').addEventListener('click', function(){ doSubmitProof($('tdSubmit')); });
  if ($('tdLiveFinish')) $('tdLiveFinish').addEventListener('click', function(){ Promise.resolve(finishLive()).catch(function(){}); });
  if ($('tdProofAlt'))   $('tdProofAlt').addEventListener('click', function(){ revealProofPicker(); });
} catch(e) {}
