/* Package 6 — Task rendering (extracted byte-exact from tasks-page.js).
   Owns the daily-chain render pipeline and its state: getMissions (backend->VISION.proof->
   fallback), chain selection (getTaskChain/getActive/getNext), the active-task card + locked
   blocks + daily overview + completed list (renderTasks/renderDailyOverview/renderCompleted),
   the generation pill (setPersonalisingBanner), the deep-link proof auto-open (maybeAutoOpenProof),
   and the render-owned state ACTIVE_MISSION / SEED_IN_FLIGHT / PROOF_DEEPLINK_DONE. Loaded before
   tasks-page.js; D / SIGNED_IN / BACKEND_TASKS and the sheet/orchestrator helpers (openTaskDetail,
   proofTypesFor, proofRequirementCopy, renderTasksLoading/Error, updateReflectionPanel) resolve at
   call time from the shared global scope. Presentational only - no XP is computed here. */
/* ================================================================
   FALLBACK MISSIONS — always available even before VISION.proof loads
   ================================================================ */
const FALLBACK_MISSIONS = [
  { id:'f1', title:'Complete your main work session',           proof:'Describe or screenshot your session',   points:20, done:false },
  { id:'f2', title:'Review your goal and adjust your plan',     proof:'Write what you adjusted',               points:20, done:false },
  { id:'f3', title:'One focused improvement today',             proof:'Tell VISION what you improved',          points:20, done:false },
];

/* ================================================================
   GET MISSIONS — backend → VISION.proof → fallback
   ================================================================ */
function getMissions(backendTasks) {
  // 1. backend tasks — pass through all Task Engine V2 fields
  if (backendTasks && backendTasks.length) {
    // Defence-in-depth: never render a generic fallback row as a task (getTasks already
    // filters, but rerenderTasksLive/other callers may pass raw sets). Keep a proven
    // fallback row so a proof-locked legacy day still shows its earned task.
    const usable = backendTasks.filter(t =>
      String(t.taskSource || '') !== 'fallback_path_specific' || t.done || t.proofDecision === 'accepted');
    return usable.map(t => ({
      id:              t.id,
      title:           t.title || 'Task',
      proof:           t.proofPrompt || t.proofHint || t.description || 'Complete this task',
      points:          t.baseXp || t.points || 20,
      baseXp:          t.baseXp || t.points || 20,
      done:            !!t.done,
      proofDecision:   t.proofDecision || null,
      backend:         true,
      // Task Engine V2 detail fields
      proofPrompt:     t.proofPrompt || '',
      proofMustShow:   t.proofMustShow || t.proof_must_show || '',
      proofRejectIf:   t.proofRejectIf || t.proof_reject_if || '',
      goodProofExamples: Array.isArray(t.goodProofExamples) ? t.goodProofExamples : (Array.isArray(t.good_proof_examples) ? t.good_proof_examples : []),
      recommendedProofType: t.recommendedProofType || t.recommended_proof_type || null,
      allowedProofTypes: Array.isArray(t.allowedProofTypes) ? t.allowedProofTypes : (Array.isArray(t.allowed_proof_types) ? t.allowed_proof_types : null),
      proofContract:   t.proofContract || t.proof_contract || null,
      proofContractVersion: t.proofContractVersion || t.proof_contract_version || null,
      videoReviewEligible: t.videoReviewEligible === true || t.video_review_eligible === true,
      videoReviewRetentionDays: t.videoReviewRetentionDays || t.video_review_retention_days || null,
      whyPersonalised: t.whyPersonalised || '',
      mistakeToAvoid:  t.mistakeToAvoid || '',
      fallback:        t.fallback || null,
      upgrade:         t.upgrade || null,
      difficulty:      t.difficulty || 'core',
      tags:            t.tags || [],
      steps:           t.steps || [],
      role:            t.role || '',
      category:        t.category || '',
      source:          t.source || '',
      estMinutes:      t.estMinutes || t.est_minutes || null,
      date:            t.date || null,
      activationStatus: t.activationStatus || 'active',
      sequencePosition: t.sequencePosition || null,
      taskSource:      t.taskSource || null,
      /* Third and last mapper in the chain. This one rebuilds a fixed field
         set, so anything not named here is dropped before render -- fixing
         getTasks() alone would have carried mission_intent as far as the Tasks
         page and no further. Both snake_case and camelCase are accepted because
         this normaliser is fed from two sources: the getTasks() mapper
         (camelCase) and, on the generation path, task rows closer to their raw
         column shape. */
      missionIntent:   t.missionIntent || t.mission_intent || null,
      contextAnchors:  t.contextAnchors || t.context_anchors || null,
    }));
  }
  // Signed-in users must NEVER see demo/local missions. An empty backend result
  // returns [] so renderTasks shows the honest empty state (not generic demo tasks).
  if (typeof SIGNED_IN !== 'undefined' && SIGNED_IN) return [];
  // 2. VISION.proof local missions (demo / logged-out only)
  try {
    const list = VISION.proof.getMissions();
    if (list && list.length) return list;
  } catch(e) {}
  // 3. hard fallback (demo / logged-out only)
  return FALLBACK_MISSIONS;
}

/* ================================================================
   HELPERS — get the active and next mission from the array
   ================================================================ */
function getActiveMission(missions) {
  if (!missions || !missions.length) return null;
  return missions.find(m => m.activationStatus === 'active') ||
         missions.find(m => m.activationStatus === 'queued') ||
         null;
}
function getNextMission(missions) {
  if (!missions || !missions.length) return null;
  return missions.find(m => m.activationStatus === 'queued') || null;
}
function allMissionsAccepted(missions) {
  if (!missions || !missions.length) return false;
  return missions.every(m => m.done || m.activationStatus === 'accepted');
}

function openBonusTaskBuilder(source){
  const payload = {
    type: 'optional_task_chain',
    source: source || 'daily_chain_complete',
    title: 'New optional task chain',
    message: 'I finished my 3 daily tasks. Form a fresh optional task chain that matches my current goal and proof standard.',
    createdAt: Date.now()
  };
  try { localStorage.setItem('visionAnalystIntent', JSON.stringify(payload)); } catch(e) {}
  try { localStorage.setItem('visionBonusTaskRequest', JSON.stringify(payload)); } catch(e) {}
  location.href = 'ai-tutor.html?intent=new-task-chain&from=tasks';
}

function wireAllDoneActions(){
  const analyst = $('analystNewTasksBtn');
  if (analyst) analyst.onclick = function(){ openBonusTaskBuilder('analyst_new_tasks'); };
}


/* ================================================================
   RENDER TASKS — adaptive single-task engine view
   ================================================================ */

function currentGoalLabel() {
  let goal = '';
  try { const p=(VISION.proof&&VISION.proof.state&&VISION.proof.state()&&VISION.proof.state().profile)||{}; goal=p.main_goal||p.primaryGoal||p.goal||''; } catch(e) {}
  if (!goal) { try { const ob=(VISION.core&&VISION.core.getOnboarding&&VISION.core.getOnboarding())||{}; goal=ob.goalText||ob.primaryGoal||ob.goal||''; } catch(e) {} }
  return goal || 'Your goal path';
}
function missionIsAccepted(m) {
  return !!(m && (m.done || m.activationStatus === 'accepted' || m.proofDecision === 'accepted'));
}
function getTaskChain(missions) {
  if (!missions || !missions.length) return [null,null,null];
  const open = missions.find(m => !missionIsAccepted(m) && m.activationStatus === 'active') ||
               missions.find(m => !missionIsAccepted(m) && m.activationStatus === 'queued') ||
               missions.find(m => !missionIsAccepted(m));
  if (!open) return [null,null,null];
  const rest = missions.filter(m => m && m.id !== open.id && !missionIsAccepted(m) && (m.activationStatus === 'queued' || m.activationStatus === 'active' || !m.activationStatus));
  return [open, rest[0] || null, rest[1] || null];
}
function renderLockedBlock(cardId, titleId, metaId, mission, fallbackTitle, fallbackMeta) {
  const card = $(cardId);
  if (!card) return;
  if (!mission) {
    card.style.display = 'none';
    card.classList.add('locked-placeholder');
    setText(titleId, fallbackTitle || '');
    setText(metaId, fallbackMeta || '');
    return;
  }
  card.style.display = '';
  card.classList.remove('locked-placeholder');
  setText(titleId, mission.title || fallbackTitle);
  const method = proofTypeLabel(proofTypesFor(mission).rec);
  const duration = mission.estMinutes ? (mission.estMinutes + ' min · ') : '';
  setText(metaId, 'Queued · ' + duration + method + ' proof · unlocks after approval');
}

function proofTypeLabel(type) {
  return ({ photo:'Photo', voice:'Voice', live:'Live' })[canonPT(type)] || 'Photo';
}

function renderCompletedTasks(missions) {
  const section=$('completedTasks'),list=$('completedList'),count=$('completedCount');
  if(!section||!list)return;
  const completed=(missions||[]).filter(missionIsAccepted);
  section.style.display=completed.length?'':'none';
  if(count)count.textContent=String(completed.length);
  list.innerHTML=completed.map(function(m){return '<div class="completed-item"><span class="completed-item-title">'+escHtml(m.title||'Task')+'</span><span class="completed-item-result">Accepted · +'+basePts(m.difficulty,m.points)+' points</span></div>';}).join('');
}

function renderDailyOverview(missions) {
  const list=(missions||[]).filter(function(m){return m.activationStatus!=='adapted'&&m.activationStatus!=='deferred';});
  const complete=list.filter(missionIsAccepted).length,total=list.length,remaining=Math.max(0,total-complete);
  const pct=total?Math.round(complete/total*100):0;
  const now=new Date();
  setText('todayLabel',now.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'long'}));
  setText('dailyProgressText',complete+' complete · '+remaining+' remaining');
  const points=list.filter(missionIsAccepted).reduce(function(sum,m){return sum+basePts(m.difficulty,m.points);},0);
  setText('dailyXpText',points+' verified points');
  const fill=$('dailyProgressFill');if(fill)fill.style.width=pct+'%';
  const active=getActiveMission(list);setText('dailyContext',active?('Current: '+(active.title||'Your active task')):'Your daily chain is clear.');
}

/* the currently-active mission, kept in sync by renderTasks so a deep-link
   (Dashboard "Submit Proof" → tasks.html?proof=1) can open its proof flow. */
let ACTIVE_MISSION = null;
let PROOF_DEEPLINK_DONE = false;
// true while the blocking LLM generation is running (first daily seed / retry). Drives
// the loading pill and prevents duplicate seeds from re-render / secondary events.
let SEED_IN_FLIGHT = false;

/* Dashboard "Submit Proof" routes here as tasks.html?proof=1. Once the real
   active task has painted, open its proof flow exactly once, then strip the
   param so a refresh/back doesn't reopen it. Never opens for a demo/empty
   state — ACTIVE_MISSION is only set from real rendered missions. */
function maybeAutoOpenProof() {
  try {
    if (PROOF_DEEPLINK_DONE) return;
    if (!/[?&]proof=1\b/.test(location.search)) return;
    if (!ACTIVE_MISSION) return;
    if (typeof openTaskDetail !== 'function') return;
    PROOF_DEEPLINK_DONE = true;
    try {
      const url = location.pathname + location.search.replace(/([?&])proof=1\b&?/, '$1').replace(/[?&]$/, '') + location.hash;
      history.replaceState(null, '', url);
    } catch(e) {}
    openTaskDetail(ACTIVE_MISSION);
  } catch(e) {}
}

// Generation pill. state: 'pending' (LLM generating) | 'failed' | 'hide'.
function setPersonalisingBanner(state) {
  const b = $('personalisingBanner'); if (!b) return;
  const title = $('pbTitle'), sub = $('pbSub'), retry = $('pbRetry');
  if (state === 'pending') {
    b.classList.remove('is-failed'); b.classList.add('show');
    if (title) title.textContent = 'Building your personalised plan…';
    if (sub) sub.textContent = "Generating today's tasks for your exact goal — this takes a few seconds.";
    if (retry) retry.disabled = true;
  } else if (state === 'failed') {
    b.classList.add('show', 'is-failed');
    if (title) title.textContent = "Couldn't reach the engine";
    if (sub) sub.textContent = 'We couldn\'t build your tasks just now. Retry to try again.';
    if (retry) retry.disabled = false;
  } else {
    b.classList.remove('show', 'is-failed');
  }
}
// A signed-in user has no actionable personalised task on screen (empty set → still
// generating). Generic rows are filtered upstream, so they never reach here.
function noActionableMission(missions) {
  return SIGNED_IN && (!Array.isArray(missions) || missions.length === 0);
}

function renderTasks(missions) {
  const wrap    = $('taskList');
  const zone    = $('activeTaskZone');
  const allDone = $('allTasksDone');
  const counter = $('taskCounter');
  // Pill: real tasks on screen → hide; otherwise show pending while a generation is
  // in flight (the empty-state block below drives the failed state).
  try { setPersonalisingBanner((missions && missions.length) ? 'hide' : (SEED_IN_FLIGHT ? 'pending' : null)); } catch(e) {}

  if (zone) zone.classList.remove('is-loading');
  try { updateReflectionPanel(missions); } catch(e) {}
  try { renderDailyOverview(missions); renderCompletedTasks(missions); } catch(e) {}
  if (wrap && missions && missions.length >= 0) { wrap.innerHTML = ''; wrap.style.display = 'none'; }

  if (!missions || missions.length === 0) {
    if (zone)    zone.style.display = 'none';
    if (allDone) allDone.style.display = 'none';
    if (counter) counter.style.display = 'none';
    if (wrap) { wrap.style.display = '';
      if(VISION.backend && VISION.auth && VISION.api) {
        VISION.auth.isOnboarded().then(onboarded => {
          if(onboarded) {
            VISION.api.getProfile().then(profile => {
              if(profile && profile.primaryGoal) {
                // Already generating (this render raced the in-flight seed) → just keep
                // the skeleton + pill; don't fire a second generation.
                if (SEED_IN_FLIGHT) { try { renderTasksLoading(); } catch(e) {} setPersonalisingBanner('pending'); return; }
                SEED_IN_FLIGHT = true;
                try { renderTasksLoading(); } catch(e) {}
                setPersonalisingBanner('pending');
                VISION.api.seedTaskStreamIfEmpty().then(function(result) {
                  SEED_IN_FLIGHT = false;
                  if (result && result.ok && result.tasks && result.tasks.length > 0) {
                    setPersonalisingBanner('hide');
                    renderTasks(result.tasks);
                  } else if (result && result.error === 'clarification_required') {
                    /* NOT a failure. The generation gate is asking one diagnostic
                       question it genuinely needs answered, and the answer form
                       lives on the dashboard. Calling this "Couldn't reach the
                       engine" sent people to Retry, which asked the same question
                       again and failed the same way -- the one state that looked
                       like a broken backend was the one where the backend was
                       working correctly. The manual-retry path below already got
                       this right; only this first-load path did not. */
                    try {
                      renderPlanBlocked(
                        'Your Analyst needs one answer first',
                        (result.question && result.question.text)
                          || 'Answer the question on your dashboard to unlock today’s move.',
                        'dashboard.html'
                      );
                    } catch(e) { renderTasksError(); }
                    setPersonalisingBanner('hide');
                  } else {
                    // engine unavailable — show the error state + Retry pill. NEVER a
                    // generic task (result carries no tasks on failure by design).
                    renderTasksError();
                    setPersonalisingBanner('failed');
                    console.warn('[VISION] seed failed:', result && result.error);
                  }
                }).catch(function(e){
                  SEED_IN_FLIGHT = false;
                  renderTasksError(); setPersonalisingBanner('failed');
                  console.warn('[VISION] seed threw:', e);
                });
              } else {
                wrap.innerHTML =
                  '<div class="tasks-empty">'+
                    '<div class="te-icon">◈</div>'+
                    '<div class="te-t">No tasks assigned yet.</div>'+
                    '<div class="te-s">Complete onboarding to unlock your daily tasks.</div>'+
                  '</div>';
              }
            });
          } else {
            wrap.innerHTML =
              '<div class="tasks-empty">'+
                '<div class="te-icon">◈</div>'+
                '<div class="te-t">No tasks assigned yet.</div>'+
                '<div class="te-s">Complete onboarding to unlock your daily tasks.</div>'+
              '</div>';
          }
        });
      } else {
        wrap.innerHTML =
          '<div class="tasks-empty">'+
            '<div class="te-icon">◈</div>'+
            '<div class="te-t">No tasks assigned yet.</div>'+
            '<div class="te-s">Complete onboarding to unlock your daily tasks.</div>'+
          '</div>';
      }
    }
    return;
  }

  const accepted = missions.filter(m => missionIsAccepted(m)).length;
  const total    = missions.filter(m => m.activationStatus !== 'adapted').length;
  if (counter && total > 0) {
    counter.style.display = '';
    setText('tcCurrent', accepted);
    const acceptedEl = $('tcAccepted');
    if (acceptedEl) acceptedEl.textContent = '';
  }

  const chain = getTaskChain(missions);
  const active = chain[0];
  const next   = chain[1];
  const third  = chain[2];
  ACTIVE_MISSION = active || null;

  const hasActiveOrQueued = !!active;
  if (!hasActiveOrQueued && (allMissionsAccepted(missions) || (D.progression && D.progression.status === 'ready_for_reflection'))) {
    if (zone)    zone.style.display = 'none';
    ['lockedTaskSecond','lockedTaskThird'].forEach(function(id){ const el=$(id); if(el) el.style.display='none'; });
    if (allDone) allDone.style.display = '';
    wireAllDoneActions();
    return;
  }
  if (!active) {
    if (zone)    zone.style.display = 'none';
    ['lockedTaskSecond','lockedTaskThird'].forEach(function(id){ const el=$(id); if(el) el.style.display='none'; });
    if (allDone) allDone.style.display = 'none';
    return;
  }

  if (zone) zone.style.display = '';
  if (allDone) allDone.style.display = 'none';

  const goal = currentGoalLabel();
  setText('atcGoal', goal);
  if (goal) setText('pathLabel', goal.split(/\s+/).slice(0,4).join(' '));

  const diffBadge = $('atcDiff');
  if (diffBadge) { diffBadge.textContent = diffLabel(active.difficulty); diffBadge.className = 'atc-diff-badge ' + diffKey(active.difficulty); }
  setText('atcTitle', active.title || 'Task');
  setText('atcWhy', active.whyPersonalised || active.proofPrompt || active.proof || 'Complete the move, then prove it. Revolutionary concept, apparently.');
  const ptsEl = $('atcPts');
  if (ptsEl) ptsEl.textContent = '+' + basePts(active.difficulty, active.points) + ' VERIFIED POINTS';
  setText('atcDuration', active.estMinutes ? (active.estMinutes + ' min') : 'Focused session');
  try { setText('atcProofType', proofTypeLabel(proofTypesFor(active).rec) + ' proof'); } catch(e) { setText('atcProofType','Photo proof'); }

  const proofSection = $('atcProofSection'), mustList = $('atcMustList');
  let pcItems = [];
  try {
    const pc = proofRequirementCopy(active);
    if (pc.lead) { pcItems = [pc.lead]; if (pc.sub) pcItems.push(pc.sub); }
    else pcItems = String(pc.sub || '').split(/[·•\n,;]+/).map(s => s.trim()).filter(Boolean);
  } catch(e) {
    const ms = active.proofMustShow || active.proof_must_show || active.proofHint || active.proofPrompt || '';
    pcItems = String(ms).split(/[·•\n,;]+/).map(s => s.trim()).filter(Boolean);
  }
  if (proofSection) proofSection.style.display = 'none';
  if (pcItems.length && mustList) {
    mustList.innerHTML = pcItems.map(i => '<div class="atc-bullet">• ' + escHtml(i) + '</div>').join('');
    if (proofSection) proofSection.style.display = '';
  }

  const rejectSection = $('atcRejectSection'), rejectList = $('atcRejectList');
  if (rejectSection) rejectSection.style.display = 'none';
  const rejectIf = active.proofRejectIf || active.proof_reject_if || '';
  if (rejectIf && rejectList) {
    const rejects = rejectIf.split(/[·•\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (rejects.length) {
      rejectList.innerHTML = rejects.map(r => '<div class="atc-reject-item">• ' + escHtml(r) + '</div>').join('');
      if (rejectSection) rejectSection.style.display = '';
    }
  }

  const statusEl = $('atcStatus');
  if (statusEl) {
    statusEl.className = 'atc-status';
    if (active.done || active.proofDecision === 'accepted') {
      statusEl.textContent = 'Proof accepted — unlocking next directive';
      statusEl.className = 'atc-status ok';
    } else if (active.proofDecision === 'checking' || active.proofDecision === 'uploaded') {
      statusEl.textContent = 'Checking proof…';
      statusEl.className = 'atc-status checking';
    } else if (active.proofDecision === 'pending_review') {
      statusEl.textContent = 'Under review';
      statusEl.className = 'atc-status review';
    } else if (active.proofDecision === 'rejected') {
      statusEl.textContent = 'Proof rejected — upload clearer evidence.';
      statusEl.className = 'atc-status err';
    } else {
      statusEl.textContent = '';
    }
  }

  const btn = $('atcBtn');
  if (btn) {
    btn.onclick = () => openTaskDetail(active);
    btn.textContent = '';
    btn.innerHTML = (active.done ? 'Proof accepted' : 'View Proof Steps') + ' <span class="arr">→</span>';
    btn.disabled = !!(active.done || active.proofDecision === 'accepted');
  }

  // Owner-only, separate preview entry point — never shown to normal users.
  // See js/tasks/universal-live-proof-panel.js; does not touch the flow above.
  const ulpBtn = $('atcUniversalBtn');
  if (ulpBtn && window.VISION && window.VISION.universalLiveProof) {
    const ulp = window.VISION.universalLiveProof;
    ulp.checkOwnerGate().then(() => {
      const show = ulp.isOwnerReady() && !active.done && active.proofDecision !== 'accepted';
      ulpBtn.style.display = show ? '' : 'none';
    }).catch(() => { ulpBtn.style.display = 'none'; });
    ulpBtn.onclick = () => ulp.open(active);
  }

  renderLockedBlock('lockedTaskSecond', 'lockedSecondTitle', 'lockedSecondMeta', next, 'Next task locked', 'Unlocks after proof.');
  renderLockedBlock('lockedTaskThird', 'lockedThirdTitle', 'lockedThirdMeta', third, 'Third task locked', 'Stays sealed until the next proof clears.');

  /* deep-link from Dashboard "Submit Proof" — open the active task's proof flow */
  try { maybeAutoOpenProof(); } catch(e) {}
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* canonical difficulty → label / css-key / base verified points (never shows "Core") */
function diffKey(d){ var k=String(d||'medium').toLowerCase(); return k==='core'?'medium':k; }
function diffLabel(d){
  try { if (window.VISION&&VISION.core&&VISION.core.difficultyLabel) return VISION.core.difficultyLabel(d); } catch(e){}
  return ({easy:'EASY',medium:'MEDIUM',hard:'HARD'})[diffKey(d)] || 'MEDIUM';
}
function basePts(d, fallback){
  try { if (window.VISION&&VISION.core&&VISION.core.taskBasePoints) return VISION.core.taskBasePoints(d); } catch(e){}
  return ({easy:20,medium:45,hard:80})[diffKey(d)] || fallback || 45;
}

/* Score strip - verified-points/standing counters (moved from tasks-page.js). */
/* ================================================================
   RENDER SCORE STRIP
   ================================================================ */
function renderScoreStrip() {
  try {
    if (SIGNED_IN) {
      // Signed-in must use canonical facts only
      if (VISION && VISION.data && typeof VISION.data.getCanonicalFacts === 'function') {
        VISION.data.getCanonicalFacts().then(function(f) {
          if (f) {
            const st = (f.standing && (f.standing.streak || f.standing.score)) || 0;
            setText('ssStreak', st);
            setText('ssScore', f.acceptedProofsToday || 0);
            setText('ssRank', f.verifiedPointsToday || 0);
            setText('pcaScore', f.verifiedPointsToday || 0);
          }
        }).catch(function(){});
      } else if (VISION && VISION.api && VISION.api.getVerifiedPointsToday) {
        // fallback to verified points only
        VISION.api.getVerifiedPointsToday().then(function(pts) {
          if (pts != null) { setText('ssRank', pts); setText('pcaScore', pts); }
        }).catch(function(){});
      }
    } else if (TASK_DEMO) {
      // local demo — reflect the demo chain so counters update after each unlock
      setText('ssStreak', 1);
      setText('ssScore',  window.__demoDone || 0);
      setText('ssRank',   window.__demoPoints || 0);
      setText('pcaScore', window.__demoPoints || 0);
    } else {
      // Demo only
      const xp = (VISION.core && VISION.core.getXp) ? VISION.core.getXp() : {};
      setText('ssStreak', xp.streak || 0);
      setText('ssScore',  xp.completedToday || 0);
      setText('ssRank',   xp.todayXp || 0);
    }

    // identity line — use canonical goal from same source as task card
    let goal = '';
    try{ const p=(VISION.proof&&VISION.proof.state&&VISION.proof.state()&&VISION.proof.state().profile)||{}; goal=p.main_goal||p.primaryGoal||p.goal||''; }catch(e){}
    if(!goal){ try{ const ob=(VISION.core&&VISION.core.getOnboarding&&VISION.core.getOnboarding())||{}; goal=ob.goalText||ob.primaryGoal||ob.goal||''; }catch(e){} }
    if(goal) setText('pathLabel', goal.split(/\s+/).slice(0,4).join(' '));
  } catch(e) {}
}
