/* Package 6 — Task-clear cinematic + verified-seal UI (extracted from tasks-page.js).
   PURE presentation: sequence labels, the task-clear cinematic and the verified seal.
   No XP/reward logic lives here (server is authoritative). Loaded before tasks-page.js;
   these globals are invoked at runtime by the render + proof-accept paths. */
function getMissionSequenceNumber(mission, missions) {
  if (!mission) return null;
  const raw = mission.sequencePosition || mission.sequence || mission.position || mission.order || mission.taskNumber || mission.dayTaskNumber;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  const list = Array.isArray(missions) ? missions : [];
  const idx = list.findIndex(function(t){ return t && mission && String(t.id) === String(mission.id); });
  if (idx >= 0) return idx + 1;
  const acceptedBefore = list.filter(function(t){ return t && missionIsAccepted(t); }).length;
  return acceptedBefore + 1;
}

function getNextLockedMissionAfter(mission, missions) {
  const list = Array.isArray(missions) ? missions : [];
  const currentNo = getMissionSequenceNumber(mission, list) || 0;
  return list.find(function(t){
    if (!t || (mission && String(t.id) === String(mission.id)) || missionIsAccepted(t)) return false;
    const n = getMissionSequenceNumber(t, list) || 999;
    return n > currentNo;
  }) || list.find(function(t){
    return t && (!mission || String(t.id) !== String(mission.id)) && !missionIsAccepted(t);
  }) || null;
}

function buildTaskClearCinematicCopy(mission, missions) {
  const list = Array.isArray(missions) ? missions : [];
  const clearedNo = getMissionSequenceNumber(mission, list) || 1;
  const next = getNextLockedMissionAfter(mission, list);
  const nextNo = next ? (getMissionSequenceNumber(next, list) || (clearedNo + 1)) : (clearedNo + 1);
  const total = list.length || 3;
  const cleared = 'Task ' + clearedNo + ' Cleared';
  let unlocked = '';
  if (next) unlocked = 'Task ' + nextNo + ' Unlocked';
  else if (clearedNo >= total || clearedNo >= 3) unlocked = 'Daily Chain Complete';
  else unlocked = 'Task ' + nextNo + ' Unlocked';
  return { cleared: cleared, unlocked: unlocked, clearedNo: clearedNo, nextNo: nextNo, next: next };
}

function showTaskClearCinematic(copy){
  if (prefersReducedMotion()) return Promise.resolve();
  if (typeof copy === 'string') copy = { unlocked: copy };
  copy = copy || {};
  const clearedText = copy.cleared || 'Task Cleared';
  const unlockedText = copy.unlocked || 'Next Task Unlocked';
  return new Promise(resolve => {
    let el = document.getElementById('taskCinematic');
    if (!el) {
      el = document.createElement('div');
      el.id = 'taskCinematic';
      document.body.appendChild(el);
    }
    el.className = '';
    el.innerHTML = '<div class="tc-cinema-inner"><div class="tc-cleared">' + escHtml(clearedText) + '</div><div class="tc-good">Good Job</div><div class="tc-unlocked">' + escHtml(unlockedText) + '</div></div>';
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => {
        el.classList.remove('show','leaving');
        resolve();
      }, 250);
    }, 980);
  });
}

// stamp a one-shot "Verified" seal into the hero card (removed after the sequence)
function injectVerifiedSeal(card){
  if (!card) return null;
  clearVerifiedSeal(card);
  const seal = document.createElement('div');
  seal.className = 'task-verified-seal';
  seal.innerHTML =
    '<div class="tvs-badge"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 6.7"/></svg></div>' +
    '<div class="tvs-label">Verified</div>';
  card.appendChild(seal);
  return seal;
}
function clearVerifiedSeal(card){
  if (!card) return;
  const old = card.querySelector('.task-verified-seal');
  if (old) old.remove();
}

async function playVerifiedUnlock(awarded, dataReady, completedMission, serverResult){
  // Server has already accepted the proof and awarded the points. Show the
  // verified result screen (points + rank, both server-derived) and wait for
  // "Move On" before running the task-chain unlock. If the screen cannot be
  // shown truthfully — no standing RPC, no award — fall through silently.
  try {
    if (window.VisionTasks && VisionTasks.presentVerifiedResult) {
      const shown = await VisionTasks.presentVerifiedResult({
        awarded: awarded,
        mission: completedMission || (typeof D !== 'undefined' && D && D.task) || null,
        confidence: serverResult && serverResult.confidence
      });
      if (shown) { try { await dataReady; } catch(e) {} }
    }
  } catch(e) { console.error('[VISION] verified result screen skipped', e); }

  const zone   = $('activeTaskZone');
  const card   = $('activeTaskCard');
  const second = $('lockedTaskSecond');
  const third  = $('lockedTaskThird');
  const missionsBefore = getMissions(BACKEND_TASKS);
  const cinematicCopy = buildTaskClearCinematicCopy(completedMission || (D && D.task), missionsBefore);

  if (!card || prefersReducedMotion()) {
    if (card) { injectVerifiedSeal(card); await wait(prefersReducedMotion() ? 650 : 0); }
    try { await dataReady; } catch(e) {}
    clearVerifiedSeal(card);
    try { renderScoreStrip(); } catch(e) {}
    renderTasks(getMissions(BACKEND_TASKS));
    return;
  }

  // 1) active proof accepted: stamp + profile/pinning glow.
  injectVerifiedSeal(card);
  card.classList.add('task-verifying');
  try {
    setTimeout(function(){
      if (VISION.fx && VISION.fx.surgeToProfile) VISION.fx.surgeToProfile({ originEl: card });
    }, 240);
  } catch(e) {}
  await wait(640);

  // 2) proof energy travels upward, then a quick black cinematic rewards the exact task cleared.
  card.classList.add('profile-glow-send');
  await wait(260);
  await showTaskClearCinematic(cinematicCopy);

  // 3) cinematic drops focus into the actual next task: lock breaks, gold leaks through, then it rises.
  if (second) {
    try { second.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(e) {}
    second.classList.add('cinematic-target','lock-breaking');
  }
  await wait(560);

  // 4) verified task exits left. The next task rises; the following locked task shifts up behind it.
  card.classList.add('exit-left');
  if (second) second.classList.add('promoting');
  if (third) third.classList.add('promoting');
  await wait(700);

  // 4) rebuild with fresh state after the choreography, then let the new stack settle.
  try { await dataReady; } catch(e) {}
  [card, second, third].forEach(function(el){
    if (!el) return;
    el.classList.remove('task-verifying','profile-glow-send','exit-left','lock-breaking','cinematic-target','promoting','entering','new-task-emerging','locked-new-slot');
    clearVerifiedSeal(el);
  });

  try { renderScoreStrip(); } catch(e) {}
  renderTasks(getMissions(BACKEND_TASKS));

  const freshActive = $('activeTaskCard');
  const freshSecond = $('lockedTaskSecond');
  const freshThird = $('lockedTaskThird');
  if (freshActive && zone && zone.style.display !== 'none') freshActive.classList.add('new-task-emerging');
  if (freshSecond && freshSecond.style.display !== 'none') freshSecond.classList.add('locked-new-slot');
  if (freshThird && freshThird.style.display !== 'none') freshThird.classList.add('locked-new-slot');
  setTimeout(function(){
    [freshActive, freshSecond, freshThird].forEach(function(el){ if (el) el.classList.remove('entering','new-task-emerging','locked-new-slot'); });
  }, 940);
}
