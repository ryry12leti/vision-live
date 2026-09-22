/* Task personalisation + learning v2.
   Server-planned, current-goal aggregates only; never reads proof media, notes or reflections. */
(function () {
  if (window.__VISION_TASK_LEARNING_V2__) return;
  window.__VISION_TASK_LEARNING_V2__ = true;

  const originalRender = window.renderTasks;
  if (typeof originalRender !== 'function') return;

  let profilePromise = null;
  let signalsPromise = null;
  let plannerPromise = null;
  let rankPromise = null;
  let rankTimer = null;
  let activeId = null;
  let currentPlan = null;
  const metaCache = Object.create(null);

  const day = () => {
    try { return VISION.core && VISION.core.today ? VISION.core.today() : new Date().toISOString().slice(0, 10); }
    catch (_) { return new Date().toISOString().slice(0, 10); }
  };
  const accepted = t => !!(t && (t.done || t.activationStatus === 'accepted' || t.proofDecision === 'accepted'));
  const rate = (v, d = 0) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d;
  const mins = v => {
    const m = String(v == null ? '' : v).match(/(\d+(?:\.\d+)?)/);
    return m ? Math.max(1, Math.min(180, Number(m[1]))) : 0;
  };
  const title = v => String(v || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
  const short = (v, n) => {
    const s = String(v || '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
  };
  const unique = (a, v) => {
    const s = String(v || '').replace(/\s+/g, ' ').trim();
    if (s && !a.includes(s)) a.push(s);
  };
  const hash = v => {
    let h = 2166136261;
    const s = String(v || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36);
  };
  const scoped = sig => !!(sig && Number(sig.version) >= 2 && sig.goal_scoped === true);
  const rankingSignals = sig => scoped(sig) ? sig : {};
  const validPlanner = plan => !!(plan && plan.ok === true && Number(plan.planner_version) === 2 && plan.goal_scoped === true);

  function styles() {
    if (document.getElementById('taskLearningStyles')) return;
    const s = document.createElement('style');
    s.id = 'taskLearningStyles';
    s.textContent =
      '.atc-fit-signals{margin:15px 0 10px;padding:12px 13px;border:1px solid rgba(231,205,139,.16);border-radius:15px;background:linear-gradient(135deg,rgba(231,205,139,.055),rgba(255,255,255,.025))}' +
      '.atc-fit-label{font-size:.48rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(238,218,164,.68);margin-bottom:8px;font-weight:600}' +
      '.atc-fit-chips{display:flex;flex-wrap:wrap;gap:7px}.atc-fit-chip{padding:5px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.035);color:rgba(246,244,237,.76);font-size:.62rem}' +
      '.atc-fit-chip:first-child{border-color:rgba(231,205,139,.24);color:rgba(245,224,169,.9)}.atc-fit-note{margin-top:8px;color:rgba(235,231,219,.48);font-size:.57rem;line-height:1.45}' +
      '.adapt-chips[data-learning-controls="2"]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.adapt-chips[data-learning-controls="2"] .adapt-chip{width:100%;min-height:38px;text-align:left}' +
      '@media(max-width:640px){.adapt-chips[data-learning-controls="2"]{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  function controls() {
    const w = document.getElementById('adaptChips');
    if (!w || w.dataset.learningControls === '2') return;
    w.dataset.learningControls = '2';
    w.innerHTML =
      '<button class="adapt-chip" data-reason="time_constraint">Not enough time</button>' +
      '<button class="adapt-chip" data-reason="tired">Low energy today</button>' +
      '<button class="adapt-chip" data-reason="too_hard">Make it easier</button>' +
      '<button class="adapt-chip" data-reason="too_easy">Make it harder</button>' +
      '<button class="adapt-chip" data-reason="generic">Different approach</button>' +
      '<button class="adapt-chip" data-reason="wrong_goal">Wrong priority</button>' +
      '<button class="adapt-chip" data-reason="no_equipment">No equipment</button>' +
      '<button class="adapt-chip" data-reason="injury">Health concern</button>' +
      '<button class="adapt-chip" data-reason="unexpected_responsibility">Not possible today</button>';
  }

  function panel() {
    let p = document.getElementById('atcFitSignals');
    if (p) return p;
    const why = document.getElementById('atcWhy');
    if (!why || !why.parentNode) return null;
    p = document.createElement('div');
    p.id = 'atcFitSignals';
    p.className = 'atc-fit-signals';
    p.innerHTML = '<div class="atc-fit-label">Why this fits you</div><div class="atc-fit-chips" id="atcFitChips"></div><div class="atc-fit-note" id="atcFitNote"></div>';
    why.parentNode.insertBefore(p, why);
    return p;
  }

  function positions(tasks) {
    const list = (tasks || []).filter(t => t && !['adapted', 'deferred'].includes(t.activationStatus));
    const done = list.filter(accepted).length, total = list.length, pos = Math.min(total, done + 1);
    const set = (q, text) => { const e = document.querySelector(q); if (e) e.textContent = text; };
    if (total) {
      set('#activeTaskCard .tb-slot', pos + ' / ' + total + ' · Open directive');
      set('#lockedTaskSecond .tb-slot', Math.min(total, pos + 1) + ' / ' + total + ' · Locked next');
      set('#lockedTaskThird .tb-slot', Math.min(total, pos + 2) + ' / ' + total + ' · Locked after');
      set('#allTasksDone .atd-kicker', done + ' / ' + total + ' directives cleared');
      set('#allTasksDone .atd-title', 'Today\'s Plan Complete');
      set('#allTasksDone .atd-sub', 'You cleared all ' + total + ' personalised directives. Ask Analyst for an optional extra chain only when you genuinely have capacity.');
    }
  }

  async function getProfile(force) {
    if (force) profilePromise = null;
    if (!profilePromise) {
      const pending = VISION.api && VISION.api.getProfile
        ? VISION.api.getProfile().catch(() => null) : Promise.resolve(null);
      profilePromise = pending;
      const result = await pending;
      if (!result && profilePromise === pending) profilePromise = null;
      return result;
    }
    return profilePromise;
  }

  async function userId() {
    try { const u = await VISION.auth.getUser(); return u && u.id ? u.id : 'session'; }
    catch (_) { return 'session'; }
  }

  function profileCohort(prof) {
    return hash([
      prof && prof.primaryGoal,
      prof && prof.pathType,
      prof && prof.goalCategory,
      prof && prof.goalRole,
      prof && prof.mainSkillGap
    ].join('|').toLowerCase());
  }

  async function cacheKey(prof) {
    return 'vision_task_learning_v2_' + await userId() + '_' + day() + '_' + profileCohort(prof || {});
  }

  async function getSignals(force) {
    if (signalsPromise && !force) return signalsPromise;
    const pending = (async () => {
      const prof = await getProfile(false);
      const key = await cacheKey(prof);
      if (!force) {
        try {
          const c = JSON.parse(sessionStorage.getItem(key) || 'null');
          if (c && Number(c.version) >= 2 && c.goal_scoped === true) return c;
        } catch (_) {}
      }
      try {
        let r = await VISION.sb.rpc('get_task_personalisation_signals_v2', { p_days: 60, p_date: day() });
        if (r.error || !r.data) {
          // Compatibility only. V1 is never used to rank because it is not goal-scoped.
          r = await VISION.sb.rpc('get_task_personalisation_signals_v1', { p_days: 60 });
        }
        if (r.error || !r.data) return null;
        if (scoped(r.data)) {
          try { sessionStorage.setItem(key, JSON.stringify(r.data)); } catch (_) {}
        }
        debug(r.data, currentPlan);
        return r.data;
      } catch (_) { return null; }
    })();
    signalsPromise = pending;
    const result = await pending;
    if (!result && signalsPromise === pending) signalsPromise = null;
    return result;
  }

  async function getPlan(force) {
    if (plannerPromise && !force) return plannerPromise;
    const pending = (async () => {
      try {
        const r = await VISION.sb.rpc('get_personalised_daily_plan_v2', { p_date: day() });
        if (r.error || !validPlanner(r.data)) return null;
        currentPlan = r.data;
        debug(null, currentPlan);
        return currentPlan;
      } catch (_) { return null; }
    })();
    plannerPromise = pending;
    const result = await pending;
    if (!result && plannerPromise === pending) plannerPromise = null;
    return result;
  }

  function getMeta(id) {
    if (!id || metaCache[id]) return Promise.resolve(metaCache[id] || null);
    return VISION.sb.from('daily_tasks')
      .select('task_type,effort_level,personalisation_tags,est_minutes,role,task_value,recommended_proof_type')
      .eq('id', id).maybeSingle()
      .then(r => (metaCache[id] = r.data || null)).catch(() => null);
  }

  function planningRows() {
    return VISION.sb.from('daily_tasks')
      .select('id,difficulty,task_type,effort_level,est_minutes,recommended_proof_type,activation_status,sequence_position,task_value')
      .eq('date', day()).in('activation_status', ['active', 'queued'])
      .order('sequence_position', { ascending: true, nullsFirst: false })
      .then(r => r.data || []).catch(() => []);
  }

  function proofExistsToday() {
    return VISION.sb.from('proofs').select('id', { count: 'exact', head: true })
      .eq('date', day()).then(r => Number(r.count || 0) > 0).catch(() => true);
  }

  function mapRate(map, key) {
    const x = map && map[String(key || '').toLowerCase()];
    if (!x) return .5;
    if (Number(x.recent_issued) >= 2) return rate(x.recent_rate, .5);
    return Number(x.issued) >= 2 ? rate(x.rate, .5) : .5;
  }

  function score(row, sig, prof) {
    const type = String(row.task_type || 'other').toLowerCase();
    const diff = String(row.difficulty || 'medium').toLowerCase() === 'core' ? 'medium' : String(row.difficulty || 'medium').toLowerCase();
    const effort = String(row.effort_level || 'medium').toLowerCase();
    const m = mins(row.est_minutes);
    const target = Number(sig.preferred_minutes) || Number(prof.preferredTaskMinutes) || 0;
    const value = Math.max(0, Math.min(100, Number(row.task_value || 40)));
    let s = 50 + Math.max(-4, Math.min(4, (value - 40) / 10));
    if (target && m) {
      s += 14 - Math.min(18, Math.abs(m - target) / target * 18);
      if (m > target * 1.6) s -= 8;
    }
    if (sig.top_completed_task_type === type) s += 10;
    if (sig.top_reported_task_type === type) s -= 12;
    s += (mapRate(sig.task_type_rates, type) - .5) * 22;
    s += (mapRate(sig.difficulty_rates, diff) - .5) * 18;
    if (sig.difficulty_direction === 'increase') s += diff === 'hard' ? 9 : diff === 'easy' ? -7 : 0;
    if (sig.difficulty_direction === 'reduce') s += diff === 'easy' ? 8 : diff === 'hard' ? -10 : 0;
    if (sig.difficulty_direction === 'reduce' && effort === 'high') s -= 7;
    if (String(prof.preferredProofType || '').toLowerCase() === String(row.recommended_proof_type || '').toLowerCase()) s += 4;
    return s;
  }

  // Compatibility-only scorer. The server planner is authoritative whenever its
  // migration is available; this deterministic path only preserves fail-open UX.
  function rankRows(rows, sig, prof) {
    const safeSignals = rankingSignals(sig);
    const left = rows.map((row, i) => ({ row, i, base: score(row, safeSignals, prof || {}) }));
    const out = [], types = Object.create(null), diffs = Object.create(null);
    let lastEffort = '';
    while (left.length) {
      let bi = 0, bs = -Infinity;
      left.forEach((x, i) => {
        const t = String(x.row.task_type || 'other').toLowerCase();
        const d = String(x.row.difficulty || 'medium').toLowerCase();
        const e = String(x.row.effort_level || 'medium').toLowerCase();
        let s = x.base - (types[t] || 0) * 11 - Math.max(0, (diffs[d] || 0) - 1) * 4 - x.i * .001;
        if (lastEffort === 'high' && e === 'high') s -= 8;
        if (s > bs) { bs = s; bi = i; }
      });
      const r = left.splice(bi, 1)[0].row;
      const t = String(r.task_type || 'other').toLowerCase(), d = String(r.difficulty || 'medium').toLowerCase();
      types[t] = (types[t] || 0) + 1; diffs[d] = (diffs[d] || 0) + 1;
      lastEffort = String(r.effort_level || 'medium').toLowerCase();
      out.push(r);
    }
    return out;
  }

  function exactTaskSet(ids, rows) {
    if (!Array.isArray(ids) || ids.length !== rows.length || ids.length < 1 || ids.length > 7) return false;
    const a = ids.map(String).sort();
    const b = rows.map(r => String(r.id)).sort();
    return a.every((id, i) => id === b[i]);
  }

  async function rankToday(tasks, force) {
    if (!SIGNED_IN || rankPromise) return rankPromise || { reordered: false };
    const open = (tasks || []).filter(t => t && !accepted(t) && ['active', 'queued'].includes(t.activationStatus));
    if (open.length < 2) return { reordered: false, reason: 'small_plan' };

    rankPromise = (async () => {
      const [rows, plan, sig, prof, proofLocked] = await Promise.all([
        planningRows(), getPlan(force), getSignals(force), getProfile(false), proofExistsToday()
      ]);
      if (proofLocked || (plan && plan.proof_locked === true)) return { reordered: false, reason: 'proof_locked' };
      if (rows.length !== open.length) return { reordered: false, reason: 'row_mismatch' };

      let ids;
      let plannerVersion = 1;
      let revision;
      if (validPlanner(plan) && exactTaskSet(plan.ordered_task_ids, rows)) {
        ids = plan.ordered_task_ids.map(String);
        plannerVersion = 2;
        revision = String(plan.decision_key || ids.join('|'));
        currentPlan = plan;
      } else {
        const safeSignals = rankingSignals(sig);
        ids = rankRows(rows, safeSignals, prof || {}).map(r => String(r.id));
        revision = scoped(sig) ? [sig.cohort_key, sig.evidence_tasks, sig.quality_score].join('-') : 'profile-only';
      }

      const key = 'vision_task_ranked_v2_' + day() + '_p' + plannerVersion + '_' + revision + '_' + open.map(t => t.id).sort().join('|');
      if (!force) { try { if (sessionStorage.getItem(key) === '1') return { reordered: false, reason: 'already_ranked', plannerVersion }; } catch (_) {} }
      const changed = ids.some((id, i) => id !== String(rows[i].id));
      if (!changed) {
        try { sessionStorage.setItem(key, '1'); } catch (_) {}
        return { reordered: false, reason: 'already_optimal', plannerVersion };
      }
      try {
        const r = await VISION.sb.rpc('reorder_daily_tasks_v1', { p_task_ids: ids, p_date: day() });
        if (r.error || !r.data || r.data.ok !== true) return { reordered: false, reason: (r.data && r.data.reason) || 'rpc_failed', plannerVersion };
        try { sessionStorage.setItem(key, '1'); } catch (_) {}
        return { reordered: true, plannerVersion };
      } catch (_) { return { reordered: false, reason: 'rpc_unavailable', plannerVersion }; }
    })();
    try { return await rankPromise; } finally { rankPromise = null; }
  }

  async function recordEvent(taskId, eventType, options) {
    if (!SIGNED_IN || !taskId || !(VISION.sb && VISION.sb.rpc)) return { ok: false, reason: 'unavailable' };
    options = options || {};
    const allowed = ['opened','started','proof_started','proof_submitted','adaptation_requested','adaptation_accepted','adaptation_rejected','deferred','abandoned'];
    if (!allowed.includes(String(eventType || ''))) return { ok: false, reason: 'invalid_event_type' };
    const proofType = options.proofType && ['photo','voice','live'].includes(String(options.proofType)) ? String(options.proofType) : null;
    const elapsedBucket = options.elapsedBucket && ['lt_5m','5_15m','15_30m','30_60m','60_120m','gt_120m'].includes(String(options.elapsedBucket)) ? String(options.elapsedBucket) : null;
    const key = 'vision_task_event_v1_' + day() + '_' + String(taskId) + '_' + String(eventType);
    try { if (sessionStorage.getItem(key) === '1') return { ok: true, idempotent: true }; } catch (_) {}
    try {
      const r = await VISION.sb.rpc('record_task_personalisation_event_v1', {
        p_task_id: taskId,
        p_event_type: eventType,
        p_date: day(),
        p_elapsed_bucket: elapsedBucket,
        p_proof_type: proofType,
        p_planner_version: 2
      });
      if (r.error || !r.data || r.data.ok !== true) return { ok: false, reason: (r.data && r.data.reason) || 'rpc_failed' };
      try { sessionStorage.setItem(key, '1'); } catch (_) {}
      return r.data;
    } catch (_) { return { ok: false, reason: 'rpc_unavailable' }; }
  }

  async function recordSurfacedBatch(tasks) {
    if (!SIGNED_IN || !(VISION.sb && VISION.sb.rpc)) return;
    const ids = [...new Set((tasks || [])
      .filter(t => t && t.id && ['active','queued','accepted'].includes(t.activationStatus))
      .map(t => String(t.id)))].slice(0, 7);
    if (!ids.length) return;
    const key = 'vision_task_surfaced_v1_' + day() + '_' + ids.slice().sort().join('|');
    try { if (sessionStorage.getItem(key) === '1') return; } catch (_) {}
    try {
      const r = await VISION.sb.rpc('record_task_surfaced_batch_v1', { p_task_ids: ids, p_date: day(), p_planner_version: 2 });
      if (!r.error && r.data && r.data.ok === true) {
        try { sessionStorage.setItem(key, '1'); } catch (_) {}
      }
    } catch (_) {}
  }

  function planItem(plan, taskId) {
    if (!validPlanner(plan) || !Array.isArray(plan.tasks)) return null;
    return plan.tasks.find(x => String(x && x.task_id) === String(taskId)) || null;
  }

  function debug(sig, plan) {
    try {
      if (localStorage.getItem('vision_debug') !== '1') return;
      const p = document.getElementById('debugPanel'); if (!p) return;
      let e = document.getElementById('dbgLearning');
      if (!e) { e = document.createElement('span'); e.id = 'dbgLearning'; p.appendChild(e); }
      const s = sig || {};
      const pl = plan || currentPlan || {};
      const capacity = pl.capacity || {};
      e.innerHTML = '<b>planner v' + escHtml(String(pl.planner_version || 1)) + ':</b> ' +
        escHtml(String(pl.confidence || s.sample_confidence || 'low')) + ' confidence · ' +
        escHtml(String(pl.evidence_tasks || s.evidence_tasks || 0)) + ' outcomes · ' +
        (capacity.status ? 'capacity ' + escHtml(String(capacity.status)) + ' · ' : '') +
        'quality ' + escHtml(String(s.quality_score || 0)) + '/100  ';
    } catch (_) {}
  }

  function paint(task, prof, meta, sig, plan) {
    if (!task || String(task.id || '') !== String(activeId || '')) return;
    const chips = [], safeSignals = scoped(sig) ? sig : null;
    const safePlan = validPlanner(plan) ? plan : (validPlanner(currentPlan) ? currentPlan : null);
    const item = planItem(safePlan, task.id);
    const target = Number(safeSignals && safeSignals.preferred_minutes) || Number(prof && prof.preferredTaskMinutes) || 0;

    if (item && item.reason) unique(chips, item.reason);
    if (safeSignals && Number(safeSignals.evidence_tasks) >= 3) unique(chips, 'Learnt from ' + safeSignals.evidence_tasks + ' current-goal outcomes');
    if (target) unique(chips, target + '-minute fit');
    if (safeSignals && safeSignals.top_completed_task_type) unique(chips, title(safeSignals.top_completed_task_type) + ' works well');
    if (safeSignals && safeSignals.sample_confidence !== 'low' && safeSignals.difficulty_direction === 'increase') unique(chips, 'Challenge tuned up');
    if (safeSignals && safeSignals.sample_confidence !== 'low' && safeSignals.difficulty_direction === 'reduce') unique(chips, 'Load tuned down');
    if (prof && prof.mainSkillGap) unique(chips, 'Targets ' + short(prof.mainSkillGap, 25));
    if (prof && prof.currentLevel) unique(chips, title(short(prof.currentLevel, 20)) + ' level');
    const role = task.role || (meta && meta.role) || (prof && prof.goalRole);
    if (role && !/^(core|task|general)$/i.test(String(role))) unique(chips, title(role) + ' path');
    const type = task.taskType || (meta && meta.task_type); if (type) unique(chips, title(type));
    const effort = task.effortLevel || (meta && meta.effort_level); if (effort) unique(chips, title(effort) + ' effort');
    try { unique(chips, title(proofTypesFor(task).rec) + ' verified'); } catch (_) {}
    if (!chips.length) chips.push('Matched to your current goal');

    const w = document.getElementById('atcFitChips');
    if (w) w.innerHTML = chips.slice(0, 4).map(c => '<span class="atc-fit-chip">' + escHtml(c) + '</span>').join('');
    const n = document.getElementById('atcFitNote');
    if (n) {
      const capacity = safePlan && safePlan.capacity;
      if (capacity && capacity.status === 'over' && Number(capacity.available_minutes) > 0) {
        n.textContent = 'Today\'s plan is estimated at ' + Number(capacity.estimated_minutes || 0) + ' minutes for ' + Number(capacity.available_minutes) + ' available, so the server planner is putting the highest-fit work first.';
      } else if (safePlan) {
        n.textContent = 'Ordered by server planner v2 from bounded current-goal outcomes. Raw proof content is never used.';
      } else if (safeSignals && safeSignals.sample_confidence !== 'low') {
        n.textContent = 'Ordered from distinct outcomes on your current goal only. Raw proof content is never used.';
      } else {
        n.textContent = 'Matched to your saved current goal, level, time and proof requirements.';
      }
    }
    debug(sig, safePlan);
  }

  function renderFit(tasks) {
    styles(); controls(); positions(tasks);
    const list = (tasks || []).filter(t => t && !accepted(t) && !['adapted', 'deferred'].includes(t.activationStatus));
    const task = list.find(t => t.activationStatus === 'active') || list.find(t => t.activationStatus === 'queued') || list[0];
    const p = panel(); if (!p) return;
    if (!task) { activeId = null; p.style.display = 'none'; return; }
    activeId = task.id || task.title || 'active';
    p.style.display = '';
    paint(task, null, null, null, currentPlan);
    Promise.all([getProfile(false), getMeta(task.id), getSignals(false), getPlan(false)])
      .then(v => paint(task, v[0], v[1], v[2], v[3])).catch(() => {});
    recordSurfacedBatch((tasks || []).filter(t => t && !['adapted','deferred'].includes(t.activationStatus)));
  }

  function schedule(tasks) {
    if (!SIGNED_IN) return;
    clearTimeout(rankTimer);
    rankTimer = setTimeout(() => rankToday(tasks).then(async r => {
      if (!r || !r.reordered || !(VISION.api && VISION.api.getTasks)) return;
      try {
        BACKEND_TASKS = await VISION.api.getTasks();
        const missions = getMissions(BACKEND_TASKS);
        originalRender(missions); renderFit(missions);
      } catch (_) {}
    }).catch(() => {}), 80);
  }

  async function invalidate(options) {
    options = options || {};
    signalsPromise = null;
    plannerPromise = null;
    currentPlan = null;
    rankPromise = null;
    clearTimeout(rankTimer);
    if (options.profile === true) profilePromise = null;
    Object.keys(metaCache).forEach(k => delete metaCache[k]);
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i) || '';
        if (k.indexOf('vision_task_learning_v2_') === 0 || k.indexOf('vision_task_ranked_v2_') === 0) sessionStorage.removeItem(k);
      }
    } catch (_) {}
    if (options.render === false || !(VISION.api && VISION.api.getTasks)) return;
    try {
      const raw = await VISION.api.getTasks();
      const missions = typeof getMissions === 'function' ? getMissions(raw) : raw;
      renderFit(missions);
      if (options.rank === true) schedule(missions);
    } catch (_) {}
  }

  window.renderTasks = function personalisedRenderTasksV2(tasks) {
    const result = originalRender.apply(this, arguments);
    try { renderFit(tasks); schedule(tasks); } catch (e) { console.warn('[VISION tasks] learning v2 failed', e); }
    return result;
  };

  window.VISION = window.VISION || {};
  VISION.taskPersonalisation = Object.assign(VISION.taskPersonalisation || {}, {
    getSignals,
    getPlan,
    rankToday,
    rankRows,
    recordEvent,
    renderFitSignals: renderFit,
    invalidate
  });

  addEventListener('vision:proof-logged', () => invalidate({ render: true, rank: false }));
  addEventListener('vision:tasks-upgraded', () => invalidate({ render: true, rank: true }));
  addEventListener('vision:task-personalisation-invalidated', e => invalidate({
    profile: !!(e && e.detail && e.detail.profileChanged), render: true, rank: !!(e && e.detail && e.detail.rank)
  }));
  addEventListener('vision:task-opened', e => recordEvent(e && e.detail && e.detail.taskId, 'opened'));
  addEventListener('vision:task-started', e => recordEvent(e && e.detail && e.detail.taskId, 'started'));
  addEventListener('vision:task-proof-started', e => recordEvent(e && e.detail && e.detail.taskId, 'proof_started', { proofType: e && e.detail && e.detail.proofType }));
  addEventListener('vision:task-proof-submitted', e => recordEvent(e && e.detail && e.detail.taskId, 'proof_submitted', { proofType: e && e.detail && e.detail.proofType }));
  addEventListener('vision:task-adaptation-requested', e => recordEvent(e && e.detail && e.detail.taskId, 'adaptation_requested'));
  addEventListener('vision:task-adaptation-accepted', e => recordEvent(e && e.detail && e.detail.taskId, 'adaptation_accepted'));
  addEventListener('vision:task-adaptation-rejected', e => recordEvent(e && e.detail && e.detail.taskId, 'adaptation_rejected'));

  async function bootstrapLearning() {
    if (!SIGNED_IN || !(VISION.api && VISION.api.getTasks)) return;
    try {
      const raw = await VISION.api.getTasks();
      const missions = typeof getMissions === 'function' ? getMissions(raw) : raw;
      renderFit(missions);
      schedule(missions);
    } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(bootstrapLearning, 0), { once: true });
  } else {
    setTimeout(bootstrapLearning, 0);
  }
})();
