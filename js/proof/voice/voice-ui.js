/* Package 6 — Voice proof capture UI (extracted byte-exact from tasks-page.js).
   Owns the voice record/countdown/stop flow only: getUserMedia(audio) → 3-2-1 → one
   MediaRecorder → blob on D.fileObj. One mic stream; every track stops on stop/cancel;
   the async ownership token (CAP.requestGen) invalidates stale countdowns. Loaded before
   tasks-page.js; toggleVoiceRec is invoked at runtime by the detail-sheet button wiring. */
// ── VOICE ──
async function toggleVoiceRec() {
  const btn = $('tdVoiceRec'), lbl = $('tdVoiceRecLbl');
  if (CAP.countdownRunning) {
    CAP.requestGen=(CAP.requestGen||0)+1;CAP.countdownRunning=false;
    try { if(CAP.stream) CAP.stream.getTracks().forEach(t=>t.stop()); } catch(e) {}
    CAP.stream=null;const cd=$('voiceCountdown');if(cd)cd.style.display='none';
    if(btn)btn.disabled=false;if(lbl)lbl.textContent='Record';
    return;
  }
  if (CAP.recording) {
    try { CAP.rec.stop(); } catch(e) {}
    return;
  }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(e) {
    proofQaUpdate('voice',{microphone_state:'failed'}); proofTelemetry('microphone_failed',{reason_code:'permission_or_device'});
    const st = $('tdStatus'); if (st) { st.textContent = 'Microphone blocked — allow mic access to record.'; st.className = 'td-submit-status err'; } return;
  }
  CAP.stream = stream; CAP.chunks = [];
  proofQaUpdate('voice',{microphone_state:'ready'});
  const owner=++CAP.requestGen,cd=$('voiceCountdown'),cdValue=$('voiceCountdownValue');
  CAP.countdownRunning=true;if(cd)cd.style.display='flex';if(lbl)lbl.textContent='Cancel';
  for(const n of [3,2,1]){
    if(owner!==CAP.requestGen||!CAP.stream)return;
    if(cdValue)cdValue.textContent=String(n);
    await wait(800);
  }
  if(owner!==CAP.requestGen||!CAP.stream)return;
  CAP.countdownRunning=false;if(cd)cd.style.display='none';
  const mime = pickMime(['audio/webm','audio/mp4','audio/ogg']);
  try { CAP.rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
  catch(e) { stream.getTracks().forEach(t=>t.stop());CAP.stream=null;if(btn)btn.disabled=false;if(lbl)lbl.textContent='Record';const st=$('tdStatus');if(st){st.textContent='Voice recording is not supported in this browser. Try a current Safari or Chrome.';st.className='td-submit-status err';}return; }
  CAP.rec.ondataavailable = e => { if (e.data && e.data.size) CAP.chunks.push(e.data); };
  CAP.rec.onstop = () => {
    if (CAP.timer) clearInterval(CAP.timer);
    const blob = new Blob(CAP.chunks, { type: CAP.rec.mimeType || 'audio/webm' });
    const durationMs=Math.max(0,Date.now()-CAP.t0);
    D.fileObj = blob; D.file = true;
    proofQaUpdate('voice',{microphone_state:'captured',recorded_duration_ms:durationMs,audio_size:blob.size,audio_type:blob.type||'audio/webm'});
    proofTelemetry('capture_ready',{duration_ms:durationMs});
    const play = $('tdVoicePlay'); if (play) { if(/^blob:/.test(play.src||''))try{URL.revokeObjectURL(play.src);}catch(e){} play.src = URL.createObjectURL(blob); play.style.display = 'block'; }
    if (btn) btn.classList.remove('is-recording'); if (lbl) lbl.textContent = 'Re-record';
    try { CAP.stream.getTracks().forEach(t => t.stop()); } catch(e) {}
    CAP.recording = false;
  };
  CAP.rec.start(); CAP.recording = true;
  proofQaUpdate('voice',{microphone_state:'recording'});
  if (btn) btn.classList.add('is-recording'); if (lbl) lbl.textContent = 'Stop';
  startRecTimer('tdVoiceTime');
}
