/* VISION Tasks approved layout port.
   Re-composes the existing modular Tasks DOM into the approved execution hierarchy.
   No task, proof, score, rank, or verification authority lives here. */
(function () {
  'use strict';

  var INSTALLED = false;
  var ORIGINAL_RENDER = null;
  var CURRENT_MISSION = null;
  var CURRENT_HAS_STANDARD = false;

  function byId(id) { return document.getElementById(id); }
  function text(value) { return value == null ? '' : String(value); }
  function firstString() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }
  function firstObject() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    }
    return null;
  }
  function arrayOf(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string' && value.trim()) {
      return value.split(/\n|•|\|/).map(function (part) { return part.trim(); }).filter(Boolean);
    }
    return [];
  }
  function setText(id, value) {
    var el = byId(id);
    if (el) el.textContent = text(value);
  }
  function setVisible(el, visible) {
    if (!el) return;
    el.hidden = !visible;
    el.style.display = visible ? '' : 'none';
  }

  function createCard(id, className, html) {
    var card = document.createElement('section');
    card.id = id;
    card.className = 'exec-card ' + className;
    card.innerHTML = html;
    return card;
  }

  function ensureLayout() {
    if (byId('taskExecutionGrid')) return true;
    var page = document.querySelector('main.page');
    var activeZone = byId('activeTaskZone');
    if (!page || !activeZone) return false;

    document.body.classList.add('tasks-approved-port');

    var grid = document.createElement('div');
    grid.id = 'taskExecutionGrid';
    grid.className = 'tasks-grid reveal in';
    grid.setAttribute('aria-label', 'Today\'s task execution plan');

    var main = document.createElement('div');
    main.className = 'tg-main';
    main.id = 'taskExecutionMain';

    var rail = document.createElement('aside');
    rail.className = 'tg-rail';
    rail.id = 'taskExecutionRail';
    rail.setAttribute('aria-label', 'Task support and proof');

    var standard = createCard('standardCard', 'standard-card',
      '<div class="std-top"><div><div class="c-k" id="stdKicker">Recommended Approach</div>' +
      '<h2 class="std-name" id="stdExpertName">Professional Standard</h2></div>' +
      '<span class="std-lock" id="stdLockState">Prepared</span></div>' +
      '<p class="std-why" id="stdWhy">The execution map will appear when your task is ready.</p>' +
      '<div class="std-detail" id="stdDetail">' +
      '<div class="std-row"><span class="sk2">Principle</span><span class="sv2" id="stdPrinciple">—</span></div>' +
      '<div class="std-row"><span class="sk2">At your level</span><span class="sv2" id="stdLevel">—</span></div>' +
      '<div class="std-row"><span class="sk2">Required proof</span><span class="sv2" id="stdEvidence">—</span></div>' +
      '</div>' +
      '<div class="std-actions"><button class="btn btn-metal std-open" id="stdOpen" type="button">View execution map <span class="arr">→</span></button></div>' +
      '<div class="std-howto"><div class="std-howto-k">How to execute</div><div id="howtoMount"></div></div>');

    var analyst = createCard('analystCard', 'analyst-card',
      '<div class="c-k">Talk to Analyst</div>' +
      '<h2 class="rail-title">Get help without leaving the task.</h2>' +
      '<p class="rail-copy" id="analystCardCopy">Your Analyst already has this task context.</p>' +
      '<button class="rail-action" id="approvedOpenAnalyst" type="button">Open Analyst <span aria-hidden="true">→</span></button>');

    var evidence = createCard('evidenceCard', 'evidence-card',
      '<div class="ev-top"><div class="c-k">Required Evidence</div><span class="ev-note" id="evidenceState">Capture this while you work</span></div>' +
      '<p class="rail-copy">Collect the proof below during execution so submission is not a surprise.</p>' +
      '<div id="evidenceMount"></div>');

    var submit = createCard('submitCard', 'submit-card is-secondary',
      '<div class="c-k">Submit Proof</div>' +
      '<h2 class="rail-title" id="submitCardTitle">Proof comes after execution.</h2>' +
      '<p class="rail-copy" id="submitCardCopy">Review the standard first, complete the task, then submit evidence.</p>' +
      '<button class="btn btn-metal submit-card-btn" id="approvedSubmitProof" type="button">Open proof workspace <span class="arr">→</span></button>' +
      '<div class="submit-card-status" id="approvedSubmitStatus" aria-live="polite"></div>');

    var marker = byId('personalisingBanner') || byId('rebuildBanner') || activeZone;
    marker.parentNode.insertBefore(grid, marker.nextSibling);
    grid.appendChild(main);
    grid.appendChild(rail);

    main.appendChild(activeZone);
    var taskList = byId('taskList');
    var allDone = byId('allTasksDone');
    if (taskList) main.appendChild(taskList);
    if (allDone) main.appendChild(allDone);
    main.appendChild(standard);

    rail.appendChild(analyst);
    rail.appendChild(evidence);
    rail.appendChild(submit);

    moveAuthoritativeNodes();
    wireStaticActions();
    return true;
  }

  function moveAuthoritativeNodes() {
    var evidenceMount = byId('evidenceMount');
    var proofSection = byId('atcProofSection');
    var rejectSection = byId('atcRejectSection');
    if (evidenceMount && proofSection && proofSection.parentNode !== evidenceMount) evidenceMount.appendChild(proofSection);
    if (evidenceMount && rejectSection && rejectSection.parentNode !== evidenceMount) evidenceMount.appendChild(rejectSection);

    var howtoMount = byId('howtoMount');
    var why = byId('tdWhySection');
    var steps = byId('tdSteps');
    var stepsSection = steps && steps.closest ? steps.closest('.td-section') : null;
    var alt = byId('tdAltBox');
    var mistake = byId('tdMistakeWrap');
    [why, stepsSection, alt, mistake].forEach(function (node) {
      if (howtoMount && node && node.parentNode !== howtoMount) howtoMount.appendChild(node);
    });
  }

  function wireStaticActions() {
    var standardButton = byId('stdOpen');
    if (standardButton) standardButton.onclick = function () {
      var detail = byId('stdDetail');
      if (!detail) return;
      var open = detail.classList.toggle('show');
      standardButton.innerHTML = (open ? 'Hide execution map' : 'View execution map') + ' <span class="arr">→</span>';
    };

    var analystButton = byId('approvedOpenAnalyst');
    if (analystButton) analystButton.onclick = function () {
      var taskId = CURRENT_MISSION && CURRENT_MISSION.id ? String(CURRENT_MISSION.id) : '';
      location.href = 'analyst.html' + (taskId ? '?task_id=' + encodeURIComponent(taskId) : '');
    };

    var submitButton = byId('approvedSubmitProof');
    if (submitButton) submitButton.onclick = function () {
      if (!CURRENT_MISSION || typeof window.openTaskDetail !== 'function') return;
      window.openTaskDetail(CURRENT_MISSION);
    };
  }

  function missionFromList(missions) {
    if (!Array.isArray(missions) || !missions.length) return null;
    try {
      if (typeof window.getTaskChain === 'function') return window.getTaskChain(missions)[0] || null;
    } catch (e) {}
    return missions.find(function (mission) {
      return mission && !mission.done && mission.activationStatus === 'active';
    }) || missions.find(function (mission) { return mission && !mission.done; }) || null;
  }

  function standardSnapshot(mission) {
    var standard = firstObject(
      mission && mission.professionalStandard,
      mission && mission.professional_standard,
      mission && mission.standard,
      mission && mission.standardSnapshot,
      mission && mission.standard_snapshot
    ) || {};
    var expert = firstObject(standard.expert, mission && mission.expert) || {};
    var expertName = firstString(
      expert.name,
      standard.expertName,
      standard.expert_name,
      mission && mission.expertName,
      mission && mission.expert_name,
      mission && mission.selectedExpert,
      mission && mission.selected_expert,
      mission && mission.recommendedExpert,
      mission && mission.recommended_expert
    );
    var principle = firstString(
      standard.professionalPrinciple,
      standard.professional_principle,
      standard.principle,
      mission && mission.professionalPrinciple,
      mission && mission.professional_principle,
      mission && mission.whyPersonalised,
      mission && mission.why
    );
    var level = firstString(
      standard.currentLevelMeaning,
      standard.current_level_meaning,
      standard.atYourLevel,
      standard.at_your_level,
      mission && mission.currentLevelMeaning,
      mission && mission.current_level_meaning
    );
    var evidence = firstString(
      standard.requiredEvidence,
      standard.required_evidence,
      mission && mission.proofMustShow,
      mission && mission.proof_must_show,
      mission && mission.proofPrompt
    );
    var steps = arrayOf(standard.steps || standard.executionSteps || standard.execution_steps || (mission && mission.steps));
    var locked = standard.locked === true || standard.isLocked === true || standard.is_locked === true || mission && mission.standardLocked === true;
    return {
      expertName: expertName,
      principle: principle,
      level: level,
      evidence: evidence,
      steps: steps,
      locked: locked,
      hasBackendStandard: !!Object.keys(standard).length
    };
  }

  function hydrateHowTo(mission) {
    if (!mission) return;
    var detail = null;
    try { if (typeof window.buildTaskDetail === 'function') detail = window.buildTaskDetail(mission); } catch (e) {}
    detail = detail || {
      why: mission.whyPersonalised || mission.why || '',
      steps: arrayOf(mission.steps),
      fallback: firstString(mission.fallback && mission.fallback.title, mission.fallback),
      upgrade: firstString(mission.upgrade && mission.upgrade.title, mission.upgrade),
      mistake: mission.mistakeToAvoid || ''
    };

    var whySection = byId('tdWhySection');
    setText('tdWhy', detail.why || 'Complete the move against the standard, then prove the result.');
    setVisible(whySection, true);

    var stepsEl = byId('tdSteps');
    var steps = Array.isArray(detail.steps) && detail.steps.length ? detail.steps : ['Complete the task exactly as written.', 'Capture the required evidence while you work.'];
    if (stepsEl) {
      stepsEl.innerHTML = '';
      steps.forEach(function (step) {
        var li = document.createElement('li');
        li.textContent = text(step);
        stepsEl.appendChild(li);
      });
    }

    var altBox = byId('tdAltBox');
    var fallback = firstString(detail.fallback);
    var upgrade = firstString(detail.upgrade);
    setText('tdFallbackText', fallback);
    setText('tdUpgradeText', upgrade);
    setVisible(byId('tdFallbackRow'), !!fallback);
    setVisible(byId('tdUpgradeRow'), !!upgrade);
    setVisible(altBox, !!(fallback || upgrade));

    var mistake = firstString(detail.mistake);
    setText('tdMistake', mistake);
    setVisible(byId('tdMistakeWrap'), !!mistake);
  }

  function hydrateStandard(mission) {
    var snapshot = standardSnapshot(mission || {});
    CURRENT_HAS_STANDARD = snapshot.hasBackendStandard;
    setText('stdKicker', snapshot.expertName ? 'Recommended Expert Approach' : 'Recommended Approach');
    setText('stdExpertName', snapshot.expertName || (snapshot.hasBackendStandard ? 'Professional Standard' : 'Recommended execution approach'));
    setText('stdWhy', firstString(mission && mission.whyPersonalised, mission && mission.why, 'A task-specific execution map based on the current mission.'));
    setText('stdPrinciple', snapshot.principle || 'Execute the task completely, at the required quality, without moving the goalposts.');
    setText('stdLevel', snapshot.level || (snapshot.steps.length ? snapshot.steps.slice(0, 2).join(' ') : 'Follow the execution steps below at your current level.'));
    setText('stdEvidence', snapshot.evidence || 'Use the Required Evidence checklist shown beside this card.');
    var lock = byId('stdLockState');
    if (lock) {
      lock.textContent = snapshot.locked ? 'Locked benchmark' : (snapshot.hasBackendStandard ? 'Recommended' : 'Task-specific');
      lock.classList.toggle('is-open', snapshot.locked || snapshot.hasBackendStandard);
    }
  }

  function submitState(mission) {
    var decision = firstString(mission && mission.proofDecision, mission && mission.proof_decision).toLowerCase();
    var state = firstString(mission && mission.executionState, mission && mission.execution_state, mission && mission.taskState, mission && mission.task_state, mission && mission.activationStatus).toLowerCase();
    if (mission && (mission.done || decision === 'accepted')) return 'verified';
    if (decision === 'checking' || decision === 'uploaded' || decision === 'pending_review' || state === 'verifying') return 'verifying';
    if (decision === 'rejected') return 'recoverable';
    if (state === 'ready_for_proof' || state === 'ready_for_evidence' || state === 'in_progress' || mission && (mission.startedAt || mission.started_at)) return 'ready';
    return 'secondary';
  }

  function hydrateSubmit(mission) {
    var card = byId('submitCard');
    var button = byId('approvedSubmitProof');
    if (!card || !button) return;
    ['is-secondary', 'is-ready', 'is-verifying', 'is-verified', 'is-recoverable'].forEach(function (name) { card.classList.remove(name); });
    var state = mission ? submitState(mission) : 'secondary';
    card.classList.add('is-' + state);
    button.disabled = !mission || state === 'verifying' || state === 'verified';

    if (!mission) {
      setText('submitCardTitle', 'Waiting for today\'s task.');
      setText('submitCardCopy', 'Proof submission appears only after an authoritative task loads.');
      button.innerHTML = 'Proof unavailable';
      setText('approvedSubmitStatus', '');
    } else if (state === 'verified') {
      setText('submitCardTitle', 'Proof verified.');
      setText('submitCardCopy', 'The server accepted this proof and progression will update from that result.');
      button.innerHTML = 'Verified';
      setText('approvedSubmitStatus', 'Accepted');
    } else if (state === 'verifying') {
      setText('submitCardTitle', 'Verification in progress.');
      setText('submitCardCopy', 'VISION is checking the submitted evidence against the locked standard.');
      button.innerHTML = 'Checking proof…';
      setText('approvedSubmitStatus', 'Do not resubmit while verification is running.');
    } else if (state === 'recoverable') {
      setText('submitCardTitle', 'Improve the evidence.');
      setText('submitCardCopy', 'The prior proof was not accepted. Review the evidence checklist and submit a clearer attempt.');
      button.innerHTML = 'Improve this proof <span class="arr">→</span>';
      setText('approvedSubmitStatus', 'Move On remains available in the verified result flow.');
    } else if (state === 'ready') {
      setText('submitCardTitle', 'Ready for evidence.');
      setText('submitCardCopy', 'The task is in execution. Submit only when the required evidence is ready.');
      button.innerHTML = 'Submit Proof <span class="arr">→</span>';
      setText('approvedSubmitStatus', '');
    } else {
      setText('submitCardTitle', 'Proof comes after execution.');
      setText('submitCardCopy', 'Review the standard, complete the task, and capture the required evidence first.');
      button.innerHTML = 'Review proof workspace <span class="arr">→</span>';
      setText('approvedSubmitStatus', 'Secondary until the task is ready for evidence.');
    }
  }

  function hydrateEvidence(mission) {
    var state = byId('evidenceState');
    var hasEvidence = byId('atcProofSection') && byId('atcProofSection').style.display !== 'none';
    if (state) state.textContent = mission ? (hasEvidence ? 'Capture this while you work' : 'Requirements preparing') : 'Waiting for task';
    var card = byId('evidenceCard');
    if (card) card.classList.toggle('is-ready', !!mission && submitState(mission) === 'ready');
  }

  function authoritativeMission(mission) {
    if (!mission) return null;
    try {
      var rawList = typeof window.BACKEND_TASKS !== 'undefined' && Array.isArray(window.BACKEND_TASKS) ? window.BACKEND_TASKS : [];
      var raw = rawList.find(function (task) { return task && String(task.id) === String(mission.id); });
      if (raw) return Object.assign({}, raw, mission);
    } catch (e) {}
    return mission;
  }

  function sync(missions) {
    if (!ensureLayout()) return;
    moveAuthoritativeNodes();
    CURRENT_MISSION = missionFromList(missions);
    var sourceMission = authoritativeMission(CURRENT_MISSION);
    hydrateStandard(sourceMission);
    hydrateHowTo(CURRENT_MISSION);
    hydrateEvidence(CURRENT_MISSION);
    hydrateSubmit(sourceMission);

    var heroButton = byId('atcBtn');
    if (heroButton && CURRENT_MISSION && !(CURRENT_MISSION.done || CURRENT_MISSION.proofDecision === 'accepted')) {
      heroButton.disabled = false;
      heroButton.innerHTML = (CURRENT_HAS_STANDARD ? 'Review Professional Standard' : 'Review execution approach') + ' <span class="arr">→</span>';
      heroButton.onclick = function () {
        var standard = byId('standardCard');
        if (standard) standard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }

    var grid = byId('taskExecutionGrid');
    if (grid) grid.classList.toggle('has-task', !!CURRENT_MISSION);
    document.documentElement.setAttribute('data-approved-task-layout', 'true');
  }

  function currentMissions() {
    try {
      if (typeof window.getMissions === 'function') {
        if (typeof window.BACKEND_TASKS !== 'undefined' && window.BACKEND_TASKS) return window.getMissions(window.BACKEND_TASKS);
        if (window.__demoTasks) return window.getMissions(window.__demoTasks);
        if (window.VISION && window.VISION.backend) return [];
        return window.getMissions(null);
      }
    } catch (e) {}
    return [];
  }

  function install() {
    if (INSTALLED) return;
    if (typeof window.renderTasks !== 'function') {
      setTimeout(install, 30);
      return;
    }
    INSTALLED = true;
    ensureLayout();
    ORIGINAL_RENDER = window.renderTasks;
    window.renderTasks = function (missions) {
      var result = ORIGINAL_RENDER.apply(this, arguments);
      try { sync(missions); } catch (error) { console.error('[VISION] approved Tasks layout sync failed', error); }
      return result;
    };
    try { sync(currentMissions()); } catch (error) { console.error('[VISION] approved Tasks layout boot failed', error); }
    document.addEventListener('vision:proof-logged', function () { setTimeout(function () { sync(currentMissions()); }, 0); });
  }

  window.VISIONApprovedTasksLayout = { install: install, sync: sync };
  install();
})();
