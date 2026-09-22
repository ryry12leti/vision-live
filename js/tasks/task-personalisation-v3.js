/* Task personalisation v3 controller.
   Materialises the server decision, presents reviewed capacity/progression changes,
   and applies them through the proof-locked server transaction. Fail-open by design. */
(function () {
  if (window.__VISION_TASK_PERSONALISATION_V3__) return;
  window.__VISION_TASK_PERSONALISATION_V3__ = true;

  let planPromise = null;
  let currentPlan = null;
  let applyPromise = null;
  let rankPromise = null;
  const originalRender = window.renderTasks;
  if (typeof originalRender !== 'function') return;

  function today() {
    try { return VISION.core && VISION.core.today ? VISION.core.today() : new Date().toISOString().slice(0, 10); }
    catch (_) { return new Date().toISOString().slice(0, 10); }
  }
  function valid(plan) {
    return !!(plan && plan.ok === true && Number(plan.planner_version) === 3 && plan.goal_scoped === true);
  }
  function openTasks(tasks) {
    return (tasks || []).filter(t => t && t.id && ['active', 'queued'].includes(t.activationStatus));
  }
  function exactSet(ids, tasks) {
    if (!Array.isArray(ids) || !Array.isArray(tasks) || ids.length !== tasks.length || ids.length < 1 || ids.length > 7) return false;
    const a = ids.map(String).sort();
    const b = tasks.map(t => String(t.id)).sort();
    return a.every((id, i) => id === b[i]);
  }
  function esc(value) {
    try { return typeof escHtml === 'function' ? escHtml(String(value == null ? '' : value)) : String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    catch (_) { return ''; }
  }
  function humanReason(reason) {
    return ({
      capacity: 'Too much for today’s available time',
      quality: 'One or more tasks failed the quality gate',
      progression: 'One or more tasks are ahead of the next eligible step'
    })[String(reason || '')] || 'Plan adjustment';
  }

  function ensureStyles() {
    if (document.getElementById('taskPersonalisationV3Styles')) return;
    const style = document.createElement('style');
    style.id = 'taskPersonalisationV3Styles';
    style.textContent =
      '.tpv3-card{margin:14px 0;padding:15px;border-radius:17px;border:1px solid rgba(231,205,139,.22);background:linear-gradient(145deg,rgba(231,205,139,.09),rgba(255,255,255,.025));box-shadow:0 14px 38px rgba(0,0,0,.18)}' +
      '.tpv3-card[hidden]{display:none!important}.tpv3-kicker{font-size:.5rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(239,215,155,.72);font-weight:700}' +
      '.tpv3-title{font-size:.92rem;color:#f4ead1;font-weight:650;margin-top:6px}.tpv3-copy{font-size:.65rem;line-height:1.55;color:rgba(245,241,230,.64);margin-top:6px}' +
      '.tpv3-reasons{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.tpv3-reason{font-size:.56rem;padding:5px 8px;border-radius:999px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);color:rgba(245,241,230,.72)}' +
      '.tpv3-actions{display:flex;gap:8px;margin-top:13px;flex-wrap:wrap}.tpv3-primary,.tpv3-secondary{min-height:39px;padding:9px 13px;border-radius:12px;font-size:.65rem;font-weight:650;cursor:pointer}' +
      '.tpv3-primary{border:1px solid rgba(231,205,139,.38);background:linear-gradient(135deg,#e7cd8b,#b89243);color:#17130b}.tpv3-secondary{border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:rgba(245,241,230,.72)}' +
      '.tpv3-primary:disabled,.tpv3-secondary:disabled{opacity:.55;cursor:default}.tpv3-error{font-size:.58rem;color:#ffb4ad;margin-top:8px}.tpv3-progress{font-size:.56rem;color:rgba(231,205,139,.75);margin-top:8px}' +
      '@media(max-width:640px){.tpv3-actions{display:grid;grid-template-columns:1fr}.tpv3-primary,.tpv3-secondary{width:100%}}';
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureStyles();
    let panel = document.getElementById('taskPlanV3Review');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'taskPlanV3Review';
    panel.className = 'tpv3-card';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="tpv3-kicker">Planner v3 review</div>' +
      '<div class="tpv3-title" id="tpv3Title">Make today realistic</div>' +
      '<div class="tpv3-copy" id="tpv3Copy"></div>' +
      '<div class="tpv3-reasons" id="tpv3Reasons"></div>' +
      '<div class="tpv3-progress" id="tpv3Progress"></div>' +
      '<div class="tpv3-error" id="tpv3Error" hidden></div>' +
      '<div class="tpv3-actions">' +
        '<button type="button" class="tpv3-primary" id="tpv3Apply">Use realistic plan</button>' +
        '<button type="button" class="tpv3-secondary" id="tpv3Keep">Keep full plan</button>' +
      '</div>';
    const fit = document.getElementById('atcFitSignals');
    const card = document.getElementById('activeTaskCard');
    if (fit && fit.parentNode) fit.parentNode.insertBefore(panel, fit);
    else if (card) card.appendChild(panel);
    else document.body.appendChild(panel);

    panel.querySelector('#tpv3Apply').addEventListener('click', applyCurrentPlan);
    panel.querySelector('#tpv3Keep').addEventListener('click', function () {
      if (currentPlan && currentPlan.decision_key) {
        try { sessionStorage.setItem('vision_task_plan_v3_dismissed_' + currentPlan.decision_key, '1'); } catch (_) {}
      }
      panel.hidden = true;
    });
    return panel;
  }

  async function fetchPlan(force) {
    if (force) planPromise = null;
    if (planPromise) return planPromise;
    const pending = (async function () {
      try {
        const result = await VISION.sb.rpc('materialise_personalised_daily_plan_v3', { p_date: today() });
        if (result.error || !valid(result.data)) return null;
        currentPlan = result.data;
        return currentPlan;
      } catch (_) { return null; }
    })();
    planPromise = pending;
    const value = await pending;
    if (!value && planPromise === pending) planPromise = null;
    return value;
  }

  function paintFit(plan, task) {
    if (!valid(plan) || !task || !Array.isArray(plan.tasks)) return;
    const item = plan.tasks.find(x => String(x && x.task_id) === String(task.id));
    if (!item) return;
    const chips = document.getElementById('atcFitChips');
    if (chips) {
      const additions = [];
      if (item.reason) additions.push(item.reason);
      if (item.progression_stage && item.next_difficulty) additions.push('Stage ' + item.progression_stage + ' · next ' + item.next_difficulty);
      if (Number(item.quality_score) >= 75) additions.push('Quality ' + item.quality_score + '/100');
      const existing = Array.from(chips.querySelectorAll('.atc-fit-chip')).map(x => x.textContent || '');
      additions.reverse().forEach(text => {
        if (!existing.includes(text)) chips.insertAdjacentHTML('afterbegin', '<span class="atc-fit-chip">' + esc(text) + '</span>');
      });
      while (chips.children.length > 4) chips.removeChild(chips.lastElementChild);
    }
    const note = document.getElementById('atcFitNote');
    if (note) {
      const c = plan.capacity || {};
      note.textContent = plan.proof_locked
        ? 'This order is locked because proof activity already exists today.'
        : 'Planner v3 used current-goal outcomes, the next eligible progression step, Judge v3 quality and today’s capacity. Raw proof content was not used.' +
          (c.adjusted_status === 'within' && c.status === 'over' ? ' A reviewed realistic plan is available below.' : '');
    }
  }

  function renderReview(plan) {
    const panel = ensurePanel();
    if (!valid(plan) || plan.proof_locked || !plan.adjustment || plan.adjustment.required !== true) {
      panel.hidden = true;
      return;
    }
    try {
      if (sessionStorage.getItem('vision_task_plan_v3_dismissed_' + plan.decision_key) === '1') {
        panel.hidden = true;
        return;
      }
    } catch (_) {}

    const adjustment = plan.adjustment || {};
    const keepCount = Array.isArray(adjustment.keep_task_ids) ? adjustment.keep_task_ids.length : 0;
    const deferCount = Array.isArray(adjustment.defer_task_ids) ? adjustment.defer_task_ids.length : 0;
    const originalMinutes = Number(adjustment.original_estimated_minutes || 0);
    const adjustedMinutes = Number(adjustment.adjusted_estimated_minutes || 0);
    const available = Number(adjustment.available_minutes || 0);
    const reasons = Array.isArray(adjustment.reasons) ? adjustment.reasons : [];
    const regeneration = adjustment.regeneration_required === true || keepCount < 1;

    panel.querySelector('#tpv3Title').textContent = regeneration ? 'This plan needs rebuilding' : 'Make today realistic';
    panel.querySelector('#tpv3Copy').textContent = regeneration
      ? 'Every current task is either below the quality standard or ahead of the next eligible progression step. Nothing will be silently accepted or weakened.'
      : 'Your plan is about ' + originalMinutes + ' minutes' + (available ? ' with ' + available + ' available' : '') + '. Keep the best ' + keepCount + ' task' + (keepCount === 1 ? '' : 's') + ' today and defer ' + deferCount + ' without losing them.';
    panel.querySelector('#tpv3Reasons').innerHTML = reasons.map(r => '<span class="tpv3-reason">' + esc(humanReason(r)) + '</span>').join('');
    panel.querySelector('#tpv3Progress').textContent = regeneration ? 'A fresh server-generated plan is required.' : 'Adjusted load: ' + adjustedMinutes + (available ? ' / ' + available + ' minutes' : ' minutes') + ' · proof requirements stay unchanged.';
    const apply = panel.querySelector('#tpv3Apply');
    apply.textContent = regeneration ? 'Regenerate plan' : 'Use realistic plan';
    apply.dataset.mode = regeneration ? 'regenerate' : 'apply';
    panel.querySelector('#tpv3Error').hidden = true;
    panel.hidden = false;
  }

  async function applyCurrentPlan() {
    if (applyPromise || !currentPlan) return;
    const panel = ensurePanel();
    const button = panel.querySelector('#tpv3Apply');
    const keep = panel.querySelector('#tpv3Keep');
    const error = panel.querySelector('#tpv3Error');
    const regeneration = button.dataset.mode === 'regenerate';

    applyPromise = (async function () {
      button.disabled = true;
      keep.disabled = true;
      error.hidden = true;
      button.textContent = regeneration ? 'Regenerating…' : 'Applying…';
      try {
        if (regeneration) {
          if (!(VISION.api && VISION.api.refreshTasks)) throw new Error('refresh_unavailable');
          await VISION.api.refreshTasks();
        } else {
          const result = await VISION.sb.rpc('apply_personalised_daily_plan_v3', { p_decision_id: currentPlan.decision_id });
          if (result.error || !result.data || result.data.ok !== true) throw new Error((result.data && result.data.reason) || 'apply_failed');
        }

        planPromise = null;
        currentPlan = null;
        try { sessionStorage.removeItem('vision_task_plan_v3_dismissed_' + (currentPlan && currentPlan.decision_key)); } catch (_) {}
        if (VISION.taskPersonalisation && VISION.taskPersonalisation.invalidate) {
          await VISION.taskPersonalisation.invalidate({ render: false, rank: false });
        }
        if (VISION.api && VISION.api.getTasks) {
          BACKEND_TASKS = await VISION.api.getTasks();
          try { D.progression = await VISION.api.getDailyProgression(); } catch (_) {}
          renderTasks(getMissions(BACKEND_TASKS));
        }
        panel.hidden = true;
        try { VISION.ui.toast(regeneration ? '<b>Fresh plan ready</b>' : '<b>Plan adjusted</b> · deferred work stays saved'); } catch (_) {}
      } catch (cause) {
        error.textContent = cause && cause.message === 'proof_locked'
          ? 'Proof activity already started, so today’s plan is locked.'
          : 'Could not apply the reviewed plan. Your current tasks were not changed.';
        error.hidden = false;
      } finally {
        button.disabled = false;
        keep.disabled = false;
        button.textContent = regeneration ? 'Regenerate plan' : 'Use realistic plan';
      }
    })();
    try { await applyPromise; } finally { applyPromise = null; }
  }

  async function reorderFromV3(plan, tasks) {
    if (rankPromise || !valid(plan) || plan.proof_locked) return;
    const rows = openTasks(tasks);
    if (!exactSet(plan.ordered_task_ids, rows)) return;
    const key = 'vision_task_ranked_v3_' + today() + '_' + plan.decision_key;
    try { if (sessionStorage.getItem(key) === '1') return; } catch (_) {}
    rankPromise = (async function () {
      try {
        const result = await VISION.sb.rpc('reorder_daily_tasks_v1', { p_task_ids: plan.ordered_task_ids.map(String), p_date: today() });
        if (!result.error && result.data && result.data.ok === true) {
          try { sessionStorage.setItem(key, '1'); } catch (_) {}
        }
      } catch (_) {}
    })();
    try { await rankPromise; } finally { rankPromise = null; }
  }

  async function finalise(tasks, force) {
    if (!SIGNED_IN) return;
    const plan = await fetchPlan(!!force);
    if (!valid(plan)) return;
    const active = openTasks(tasks).find(t => t.activationStatus === 'active') || openTasks(tasks)[0];
    paintFit(plan, active);
    renderReview(plan);
    await reorderFromV3(plan, tasks);
  }

  function invalidate() {
    planPromise = null;
    currentPlan = null;
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i) || '';
        if (key.indexOf('vision_task_ranked_v3_') === 0) sessionStorage.removeItem(key);
      }
    } catch (_) {}
  }

  window.renderTasks = function personalisedRenderTasksV3(tasks) {
    const result = originalRender.apply(this, arguments);
    setTimeout(function () { finalise(tasks, false).catch(function () {}); }, 120);
    return result;
  };

  window.VISION = window.VISION || {};
  VISION.taskPersonalisationV3 = { fetchPlan, finalise, applyCurrentPlan, invalidate };

  addEventListener('vision:proof-logged', invalidate);
  addEventListener('vision:tasks-upgraded', invalidate);
  addEventListener('vision:task-personalisation-invalidated', invalidate);

  setTimeout(async function () {
    try {
      if (!SIGNED_IN || !(VISION.api && VISION.api.getTasks)) return;
      const raw = await VISION.api.getTasks();
      await finalise(typeof getMissions === 'function' ? getMissions(raw) : raw, false);
    } catch (_) {}
  }, 0);
})();
