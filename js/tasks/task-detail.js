/* Package 6 — Task detail view (extracted byte-exact from tasks-page.js).
   Owns the detail sheet: step derivation, detail copy assembly (target/steps/why/proof
   requirements/rejection examples/easier+harder), and open/close of the sheet. Shared state
   (let D) and proof orchestration stay in tasks-page.js; these are invoked at runtime. */
function deriveSteps(task) {
  const t  = (task.title || '').toLowerCase();
  const pr = (task.proofPrompt || task.proof || '').toLowerCase();
  const steps = [];

  // extract duration if mentioned in title
  const minsM = t.match(/(\d+)[- ]?min/);
  const mins  = minsM ? minsM[1] : null;
  const repsM = t.match(/(\d+)\s*(rep|set|push.?up|pull.?up|squat)/);
  const reps  = repsM ? repsM[0] : null;

  // opening step — timer or space
  if (mins) {
    steps.push('Set a ' + mins + '-minute timer before you begin.');
  } else {
    steps.push('Find a focused space and remove distractions.');
  }

  // core action steps based on title keywords
  if (/\b(read|study|revis|review|flashcard|past paper|memoris|recall)\b/.test(t)) {
    steps.push('Read or review your material actively — take brief notes as you go.');
    steps.push('Pause and write down the key points from memory (active recall).');
    steps.push('Check your notes against the source and mark any gaps.');
  } else if (/\b(drill|footwork|batting|bowling|cricket|soccer|football|basketball|tennis|swing|stroke|kick|cross|shoot|dribbl)\b/.test(t)) {
    if (mins) steps.push('Warm up with 3–5 minutes of light movement before the main drill.');
    steps.push('Go through the specific technique at a controlled pace first — focus on form.');
    steps.push('Gradually increase intensity and run the drill under light pressure.');
    steps.push('Write down one specific thing that felt weak — that is tomorrow\'s focus.');
  } else if (/\b(workout|exercise|gym|lift|weight|strength|cardio|run|sprint|push.?up|pull.?up|squat|plank|burpee)\b/.test(t)) {
    if (mins) steps.push('Warm up for 5 minutes before starting.');
    steps.push('Complete the main movement with full attention on form over speed.');
    if (reps) steps.push('Track your ' + reps + ' — write them down or note in a photo.');
    steps.push('Finish with a 2-minute cool-down or stretch.');
  } else if (/\b(write|draft|script|blog|post|essay|chapter|lyric|bar|verse|scene|outline)\b/.test(t)) {
    steps.push('Open a blank document or notes app — no editing yet.');
    steps.push('Write continuously for the full session — get ideas down first, fix later.');
    steps.push('Review once and improve the two or three strongest sections.');
  } else if (/\b(message|outreach|client|email|dm|contact|reach out|pitch|proposal|call|apply|application)\b/.test(t)) {
    steps.push('Prepare your message or application in a draft first.');
    steps.push('Send it — keep it clear, direct, and specific to this person or role.');
    steps.push('Take a screenshot of the sent message or confirmation page for proof.');
  } else if (/\b(record|film|video|stream|podcast|take|shoot)\b/.test(t)) {
    steps.push('Set up your recording space with decent light and minimal background noise.');
    steps.push('Do one warmup take before the real recording.');
    steps.push('Record the full session — finish the clip before reviewing.');
  } else if (/\b(budget|track|spend|sav|invest|income|finance|debt|money)\b/.test(t)) {
    steps.push('Open your bank statement, budget spreadsheet, or finance app.');
    steps.push('Log or review the most recent entries or transactions.');
    steps.push('Note your current balance, savings total, or progress figure — that is your proof number.');
  } else if (/\b(sleep|wind.?down|screen.?free|bedtime|wake up|morning routine)\b/.test(t)) {
    steps.push('Set the environment: dim lights, phone on do-not-disturb or off the bed.');
    steps.push('Complete the specific routine action described in the task title.');
    steps.push('Log the time you started and finished so you can prove the streak.');
  } else if (/\b(habit|routine|practice|focus|deep.?work|block|pomodoro|timer)\b/.test(t)) {
    if (mins && !steps.length) steps.push('Set a ' + mins + '-minute focused timer — no interruptions.');
    steps.push('Begin the task immediately when the timer starts.');
    steps.push('If you get distracted, note it and return — do not restart the timer.');
  } else if (/\b(vocabular|grammar|speak|listen|translat|language|conversation|fluent)\b/.test(t)) {
    steps.push('Open your language app, deck, or conversation partner.');
    steps.push('Complete the session — prioritise speaking or active production over passive reading.');
    steps.push('Write down three new words or phrases you want to keep.');
  } else {
    steps.push('Read the task title carefully and commit to completing it fully — not partially.');
    steps.push('Execute the main effort without switching to other tasks.');
    steps.push('Note exactly what you did so you can describe it in your proof.');
  }

  // final proof capture step based on proof prompt
  if (/timer/.test(pr)) {
    steps.push('Capture evidence the work was actually completed — a finished log or output, not just a timer.');
  } else if (/screenshot/.test(pr)) {
    steps.push('Take a screenshot showing what you completed and submit it.');
  } else if (/photo|picture|image/.test(pr)) {
    steps.push('Take a clear photo showing your completed work and submit it.');
  } else if (/video/.test(pr)) {
    steps.push('Record a short clip or take a screenshot of the session and submit it.');
  } else {
    steps.push('Take a photo or screenshot that proves you completed this today and submit it.');
  }

  return steps;
}

function buildTaskDetail(task) {
  const title   = task.title || 'Task';
  // WHAT TO SHOW box — must match the proof METHOD (task.proof is a boolean, never text)
  let proofTx = (typeof task.proofPrompt === 'string' && task.proofPrompt) ? task.proofPrompt : 'Take a photo showing your completed work.';
  try { const pc = proofRequirementCopy(task); if (pc.lead) proofTx = pc.lead; } catch(e) {}
  const why     = task.whyPersonalised || task.why || '';
  const steps   = (task.steps && task.steps.length) ? task.steps : deriveSteps(task);
  const fallbackT = task.fallback
    ? (typeof task.fallback === 'string' ? task.fallback : (task.fallback.title || ''))
    : '';
  const upgradeT  = task.upgrade
    ? (typeof task.upgrade === 'string' ? task.upgrade : (task.upgrade.title || ''))
    : '';
  const mistake = task.mistakeToAvoid || '';
  const diff    = diffKey(task.difficulty);
  const points  = basePts(task.difficulty, task.points);
  const tags    = task.tags || [];
  return { title, why, steps, proof: proofTx, fallback: fallbackT, upgrade: upgradeT, mistake, diff, points, tags };
}

function openTaskDetail(mission) {
  D = { task: mission, fileObj: null, file: false, submitting: false, progression: D.progression, adaptation: null, proofType: 'photo', poster: null, coachSummary:null, liveSessionId:null, telemetryStarted:false, telemetryFinal:false };
  const detail = buildTaskDetail(mission);

  // header
  const diffEl = document.getElementById('tdDiff');
  if (diffEl) { diffEl.textContent = diffLabel(detail.diff); diffEl.className = 'td-diff ' + diffKey(detail.diff); }
  setText('tdPts', '+' + detail.points + ' verified points');
  setText('tdTitle', detail.title);
  setText('tdQuickPts', '+' + detail.points + ' verified points');
  setText('tdQuickTitle', detail.title);
  setText('tdQuickDiff', diffLabel(detail.diff));
  const qDiff = document.getElementById('tdQuickDiff');
  if (qDiff) qDiff.className = 'td-q-pill ' + diffKey(detail.diff);

  // why / mission
  const whySec = document.getElementById('tdWhySection');
  const whyEl  = document.getElementById('tdWhy');
  /* Founder tasks put the SELECTION REASON here -- why this task, and why
     these exact businesses -- so "Why this matters" undersells it and reads
     like generic motivation. Other engines still explain significance, so the
     label is switched per task rather than renamed globally. */
  const whyLabel = whySec && whySec.querySelector('.td-label');
  if (whyLabel) {
    whyLabel.textContent = (mission && mission.taskSource === 'founder_engine_v1')
      ? 'Why you got this'
      : 'Why this matters';
  }
  if (detail.why && whyEl) {
    whyEl.textContent = detail.why;
    if (whySec) whySec.style.display = '';
  } else if (whySec) {
    whySec.style.display = 'none';
  }

  // steps
  const stepsEl = document.getElementById('tdSteps');
  if (stepsEl) {
    stepsEl.innerHTML = '';
    detail.steps.forEach(s => {
      const li = document.createElement('li');
      li.textContent = s;
      stepsEl.appendChild(li);
    });
  }

  // proof requirement + details
  setText('tdProofReq', detail.proof);
  setText('tdQuickProofReq', detail.proof ? ('Proof needed: ' + detail.proof) : 'Upload proof that clearly shows the task was completed.');

  // proofMustShow, proofRejectIf, goodProofExamples — copy matches the proof METHOD.
  // For live/voice the WHAT TO SHOW box already carries the lead line, so this row
  // shows only the task-specific sub-detail (or hides when there is none).
  let mustShow = mission.proofMustShow || '';
  try {
    const pc = proofRequirementCopy(mission);
    mustShow = pc.lead ? (pc.sub || '') : (pc.sub || mustShow);
  } catch(e) {}
  const rejectIf   = mission.proofRejectIf || '';
  const goodEx     = Array.isArray(mission.goodProofExamples) ? mission.goodProofExamples : [];
  const detailsBox = document.getElementById('tdProofDetails');
  const mustRow    = document.getElementById('tdMustShowRow');
  const rejectRow  = document.getElementById('tdRejectRow');
  if (detailsBox) detailsBox.style.display = (mustShow || rejectIf) ? '' : 'none';
  if (mustRow) { mustRow.style.display = mustShow ? '' : 'none'; setText('tdMustShow', mustShow); }
  if (rejectRow) { rejectRow.style.display = rejectIf ? '' : 'none'; setText('tdRejectIf', rejectIf); }
  const goodSec  = document.getElementById('tdGoodProofSection');
  const goodList = document.getElementById('tdGoodProofList');
  if (goodSec) goodSec.style.display = goodEx.length ? '' : 'none';
  if (goodList) { goodList.innerHTML = ''; goodEx.slice(0,3).forEach(ex => { const d = document.createElement('div'); d.className='td-good-proof-item'; d.textContent=ex; goodList.appendChild(d); }); }

  // wire the "report bad task" link
  const repLink = document.getElementById('tdReportLink');
  if (repLink) {
    repLink.onclick = () => openReportModal(mission);
    repLink.style.display = (SIGNED_IN && VISION && VISION.api && VISION.api.reportBadTask) ? '' : 'none';
  }

  // fallback + upgrade
  const altBox    = document.getElementById('tdAltBox');
  const fbRow     = document.getElementById('tdFallbackRow');
  const upRow     = document.getElementById('tdUpgradeRow');
  const hasFb = !!(detail.fallback);
  const hasUp = !!(detail.upgrade);
  if (fbRow) { fbRow.style.display = hasFb ? '' : 'none'; setText('tdFallbackText', detail.fallback); }
  if (upRow) { upRow.style.display = hasUp ? '' : 'none'; setText('tdUpgradeText', detail.upgrade); }
  if (altBox) altBox.style.display = (hasFb || hasUp) ? '' : 'none';

  // mistake
  const mistakeWrap = document.getElementById('tdMistakeWrap');
  if (mistakeWrap) {
    if (detail.mistake) {
      mistakeWrap.style.display = '';
      setText('tdMistake', detail.mistake);
    } else {
      mistakeWrap.style.display = 'none';
    }
  }

  // proof upload area — show real upload if signed in, hint if demo
  const signedIn = document.getElementById('tdSignedInProof');
  const demoHint = document.getElementById('tdDemoHint');
  const isSignedIn = !!(SIGNED_IN && VISION && VISION.api && VISION.api.submitProof) || TASK_DEMO;
  // only show real upload for backend tasks with real ids (not f1/f2/f3 fallback ids)
  const hasRealId = (mission.backend && mission.id && String(mission.id).length > 5) || TASK_DEMO;
  if (signedIn) signedIn.style.display = (isSignedIn && hasRealId) ? '' : 'none';
  if (demoHint) demoHint.style.display = (isSignedIn && hasRealId) ? 'none' : '';

  // reset upload state
  const fileLabel = document.getElementById('tdFileLabel');
  const preview   = document.getElementById('tdPreview');
  const note      = document.getElementById('tdNote');
  const status    = document.getElementById('tdStatus');
  const submitBtn = document.getElementById('tdSubmit');
  setFileLabel('Add your proof photo or screenshot');
  if (preview)   { preview.style.display = 'none'; preview.src = ''; }
  if (note)      note.value = '';
  if (status)    { status.textContent = ''; status.className = 'td-submit-status'; }
  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Submit Proof <span class="arr">→</span>'; }

  // Uploaded Video Review Proof is a separate, server-opted-in path. It never
  // appears as a fourth proof picker and is hidden unless the task row permits it.
  const videoReviewLink = document.getElementById('tdVideoReviewLink');
  if (videoReviewLink) {
    const available = mission.videoReviewEligible === true && mission.backend && mission.id && !mission.done;
    videoReviewLink.style.display = available ? 'block' : 'none';
    videoReviewLink.href = available ? ('/video-review?task=' + encodeURIComponent(mission.id)) : '#';
  }

  // adaptive proof capture — choose the best modality for this task
  try { setupProofCapture(mission); } catch(e) {}

  // Tutor — only pass task_id; task content loaded server-side
  try {
    if (window.VISION.askVisionUI) {
      window.VISION.askVisionUI.initAskVision(mission.id);
      var avLink = document.getElementById('avTutorLink');
      var avHref = document.getElementById('avTutorHref');
      if (avLink) avLink.style.display = '';
      if (avHref) avHref.href = 'ai-tutor.html?task_id=' + encodeURIComponent(mission.id);
    }
  } catch(e) {}

  // adaptation section — show only for active, unproven tasks
  try {
    var adaptSec  = $('tdAdaptSection');
    var adaptProp = $('adaptProposal');
    var adaptStat = $('adaptStatus');
    var isActive  = mission.activationStatus === 'active' || !mission.done;
    var isProven  = mission.done || mission.proofDecision === 'accepted';
    if (adaptSec)  adaptSec.style.display  = (isActive && !isProven && mission.backend && mission.id) ? '' : 'none';
    if (adaptProp) adaptProp.style.display = 'none';
    if (adaptStat) { adaptStat.textContent = ''; adaptStat.className = 'adapt-status'; }
    D.adaptation = null;
    // reset chip selection
    $$('.adapt-chip').forEach(c => { c.classList.remove('selected'); c.disabled = false; });
  } catch(e) {}

  // open sheet
  const sheet = document.getElementById('taskDetail');
  if (sheet) {
    sheet.classList.add('show');
    // scroll sheet to top
    const inner = document.getElementById('tdSheet');
    if (inner) inner.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }
}

function closeTaskDetail() {
  const sheet = document.getElementById('taskDetail');
  if (sheet) sheet.classList.remove('show');
  document.body.style.overflow = '';
  try { teardownCapture(); } catch(e) {}
  try { const p=$('tdPreview');if(p&&p.dataset.objectUrl){URL.revokeObjectURL(p.dataset.objectUrl);delete p.dataset.objectUrl;} } catch(e) {}
  D = { task: null, fileObj: null, file: false, submitting: false, progression: D.progression, adaptation: null, proofType: 'photo', poster: null, coachSummary: null, liveSessionId:null, telemetryStarted:false, telemetryFinal:false };
}
