/* Task personalisation + learning v1.
   Learns from aggregate counts/rates only; never reads proof media or free-text notes. */
(function () {
  if (window.__VISION_TASK_LEARNING_V1__) return;
  window.__VISION_TASK_LEARNING_V1__ = true;
  const originalRender = window.renderTasks;
  if (typeof originalRender !== 'function') return;

  let profilePromise = null, signalsPromise = null, rankPromise = null, rankTimer = null;
  const metaCache = Object.create(null);
  let activeId = null;

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

  function styles() {
    if (document.getElementById('taskLearningStyles')) return;
    const s = document.createElement('style');
    s.id = 'taskLearningStyles';
    s.textContent =
      '.atc-fit-signals{margin:15px 0 10px;padding:12px 13px;border:1px solid rgba(231,205,139,.16);border-radius:15px;background:linear-gradient(135deg,rgba(231,205,139,.055),rgba(255,255,255,.025))}' +
      '.atc-fit-label{font-size:.48rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(238,218,164,.68);margin-bottom:8px;font-weight:600}' +
      '.atc-fit-chips{display:flex;flex-wrap:wrap;gap:7px}.atc-fit-chip{padding:5px 9px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.035);color:rgba(246,244,237,.76);font-size:.62rem}' +
      '.atc-fit-chip:first-child{border-color:rgba(231,205,139,.24);color:rgba(245,224,169,.9)}.atc-fit-note{margin-top:8px;color:rgba(235,231,219,.48);font-size:.57rem;line-height:1.45}' +
      '.adapt-chips[data-learning-controls="1"]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.adapt-chips[data-learning-controls="1"] .adapt-chip{width:100%;min-height:38px;text-align:left}' +
      '@media(max-width:640px){.adapt-chips[data-learning-controls="1"]{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  function controls() {
    const w = document.getElementById('adaptChips');
    if (!w || w.dataset.learningControls === '1') return;
    w.dataset.learningControls = '1';
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

  function getProfile() {
    if (!profilePromise) profilePromise = VISION.api && VISION.api.getProfile
      ? VISION.api.getProfile().catch(() => null) : Promise.resolve(null);
    return profilePromise;
  }

  async function cacheKey() {
    let uid = 'session';
    try { const u = await VISION.auth.getUser(); if (u && u.id) uid = u.id; } catch (_) {}
    return 'vision_task_learning_v1_' + uid + '_' + day();
  }

  async function getSignals(force) {
    if (signalsPromise && !force) return signalsPromise;
    const pending = (async () => {
      const key = await cacheKey();
      if (!force) {
        try { const c = JSON.parse(sessionStorage.getItem(key) || 'null'); if (c && c.version === 1) return c; } catch (_) {}
      }
      try {
        const r = await VISION.sb.rpc('get_task_personalisation_signals_v1', { p_days: 60 });
        if (r.error || !r.data) return null;
        try { sessionStorage.setItem(key, JSON.stringify(r.data)); } catch (_) {}
        debug(r.data);
        return r.data;
      } catch (_) { return null; }
    })();
    signalsPromise = pending;
    const result = await pending;
    // A temporary network/RPC failure must not disable learning for the entire tab.
    if (!result && signalsPromise === pending) signalsPromise = null;
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

  function mapRate(map, key) {
    const x = map && map[String(key || '').toLowerCase()];
    return x && Number(x.issued) >= 2 ? rate(x.rate, .5) : .5;
  }

  function score(row, sig, prof) {
    const type = String(row.task_type || 'other').toLowerCase();
    const diff = String(row.difficulty || 'medium').toLowerCase() === 'core' ? 'medium' : String(row.difficulty || 'medium').toLowerCase();
    const effort = String(row.effort_level || 'medium').toLowerCase();
    const m = mins(row.est_minutes);
    const target = Number(sig.preferred_minutes) || Number(prof.preferredTaskMinutes) || 0;
    let s = 50 + Math.max(0, Math.min(12, Number(row.task_value || 0) / 8));
    if (target && m) {
      s += 14 - Math.min(18, Math.abs(m - target) / target * 18);
      if (m > target * 1.6) s -= 8;
    }
    if (sig.top_completed_task_type === type) s += 10;
    if (sig.top_reported_task_type === type) s -= 12;
    s += (mapRate(sig.task_type_rates, type) - .5) * 20;
    s += (mapRate(sig.difficulty_rates, diff) - .5) * 16;
    if (sig.difficulty_direction === 'increase') s += diff === 'hard' ? 9 : diff === 'easy' ? -7 : 0;
    if (sig.difficulty_direction === 'reduce') s += diff === 'easy' ? 8 : diff === 'hard' ? -10 : 0;
    if (sig.difficulty_direction === 'reduce' && effort === 'high') s -= 7;
    if (String(prof.preferredProofType || '').toLowerCase() === String(row.recommended_proof_type || '').toLowerCase()) s += 4;
    return s;
  }

  function rankRows(rows, sig, prof) {
    const left = rows.map((row, i) => ({ row, i, base: score(row, sig || {}, prof || {}) }));
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

  async function rankToday(tasks, force) {
    if (!SIGNED_IN || rankPromise) return rankPromise || { reordered: false };
    const open = (tasks || []).filter(t => t && !accepted(t) && ['active', 'queued'].includes(t.activationStatus));
    if (open.length < 2 || (tasks || []).some(t => t && t.proofDecision)) return { reordered: false, reason: 'locked_or_small' };
    const key = 'vision_task_ranked_v1_' + day() + '_' + open.map(t => t.id).sort().join('|');
    if (!force) { try { if (sessionStorage.getItem(key) === '1') return { reordered: false, reason: 'already_ranked' }; } catch (_) {} }

    rankPromise = (async () => {
      const [rows, sig, prof] = await Promise.all([planningRows(), getSignals(force), getProfile()]);
      if (rows.length !== open.length) return { reordered: false, reason: 'row_mismatch' };
      const ids = rankRows(rows, sig || {}, prof || {}).map(r => String(r.id));
      const changed = ids.some((id, i) => id !== String(rows[i].id));
      if (!changed) {
        try { sessionStorage.setItem(key, '1'); } catch (_) {}
        return { reordered: false, reason: 'already_optimal' };
      }
      try {
        const r = await VISION.sb.rpc('reorder_daily_tasks_v1', { p_task_ids: ids, p_date: day() });
        if (r.error || !r.data || r.data.ok !== true) {
          return { reordered: false, reason: (r.data && r.data.reason) || 'rpc_failed' };
        }
        try { sessionStorage.setItem(key, '1'); } catch (_) {}
        return { reordered: true };
      } catch (_) { return { reordered: false, reason: 'rpc_unavailable' }; }
    })();
    try { return await rankPromise; } finally { rankPromise = null; }
  }

  function debug(sig) {
    try {
      if (localStorage.getItem('vision_debug') !== '1' || !sig) return;
      const p = document.getElementById('debugPanel'); if (!p) return;
      let e = document.getElementById('dbgLearning');
      if (!e) { e = document.createElement('span'); e.id = 'dbgLearning'; p.appendChild(e); }
      e.innerHTML = '<b>learning:</b> quality ' + escHtml(String(sig.quality_score || 0)) + '/100 · completion ' +
        Math.round(rate(sig.completion_rate) * 100) + '% · fit failures ' + Math.round(rate(sig.fit_failure_rate) * 100) + '%  ';
    } catch (_) {}
  }

  function paint(task, prof, meta, sig) {
    if (!task || String(task.id || '') !== String(activeId || '')) return;
    const chips = [], target = Number(sig && sig.preferred_minutes) || Number(prof && prof.preferredTaskMinutes) || 0;
    if (sig && Number(sig.accepted) >= 3) unique(chips, 'Learnt from ' + sig.accepted + ' verified tasks');
    if (target) unique(chips, target + '-minute fit');
    if (sig && sig.top_completed_task_type) unique(chips, title(sig.top_completed_task_type) + ' works well');
    if (sig && sig.sample_confidence !== 'low' && sig.difficulty_direction === 'increase') unique(chips, 'Challenge tuned up');
    if (sig && sig.sample_confidence !== 'low' && sig.difficulty_direction === 'reduce') unique(chips, 'Load tuned down');
    if (prof && prof.mainSkillGap) unique(chips, 'Targets ' + short(prof.mainSkillGap, 25));
    if (prof && prof.currentLevel) unique(chips, title(short(prof.currentLevel, 20)) + ' level');
    const role = task.role || (meta && meta.role) || (prof && prof.goalRole);
    if (role && !/^(core|task|general)$/i.test(String(role))) unique(chips, title(role) + ' path');
    const type = task.taskType || (meta && meta.task_type); if (type) unique(chips, title(type));
    const effort = task.effortLevel || (meta && meta.effort_level); if (effort) unique(chips, title(effort) + ' effort');
    try { unique(chips, title(proofTypesFor(task).rec) + ' verified'); } catch (_) {}
    if (!chips.length) chips.push('Matched to your goal');
    const w = document.getElementById('atcFitChips');
    if (w) w.innerHTML = chips.slice(0, 4).map(c => '<span class="atc-fit-chip">' + escHtml(c) + '</span>').join('');
    const n = document.getElementById('atcFitNote');
    if (n) n.textContent = sig && sig.sample_confidence !== 'low'
      ? 'Ordered from recent completion, proof and task-fit patterns. Raw proof content is never used.'
      : 'Matched to your saved goal, level, time and proof requirements.';
    debug(sig);
  }

  function renderFit(tasks) {
    styles(); controls(); positions(tasks);
    const list = (tasks || []).filter(t => t && !accepted(t) && !['adapted', 'deferred'].includes(t.activationStatus));
    const task = list.find(t => t.activationStatus === 'active') || list.find(t => t.activationStatus === 'queued') || list[0];
    const p = panel(); if (!p) return;
    if (!task) { activeId = null; p.style.display = 'none'; return; }
    activeId = task.id || task.title || 'active'; p.style.display = ''; paint(task, null, null, null);
    Promise.all([getProfile(), getMeta(task.id), getSignals(false)]).then(v => paint(task, v[0], v[1], v[2])).catch(() => {});
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

  window.renderTasks = function (tasks) {
    const result = originalRender.apply(this, arguments);
    try { renderFit(tasks); schedule(tasks); } catch (e) { console.warn('[VISION tasks] learning layer failed', e); }
    return result;
  };
  window.VISION = window.VISION || {};
  VISION.taskPersonalisation = Object.assign(VISION.taskPersonalisation || {}, { getSignals, rankToday, rankRows, renderFitSignals: renderFit });

  // The module is loaded dynamically after task-store.js. Initialise from the
  // authoritative backend even when the page's first render already happened.
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
