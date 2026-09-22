/* Package 6 — Task store: backend fetch + render skeletons (extracted byte-exact from tasks-page.js).
   Owns the signed-in data-fetch/hydrate path (hydrateBackendTasks: parallel hydrateLocal/getTasks/
   getDailyProgression, stale-task recovery, render-cache write) and its UI states
   (renderTasksLoading skeleton, renderTasksError retry) plus the debug panel (updateDebugPanel).
   Loaded before tasks-page.js; BACKEND_TASKS / D / SIGNED_IN and the render helpers resolve at
   call time from the shared global scope. No XP logic here. */
/* loading skeleton */
function renderTasksLoading() {
  // Premium skeleton of the real active-task card (replaces the old text state).
  // is-loading lives on the zone (a data-sk ancestor) so it persists through the
  // async hydrate and clears in renderTasks(); sk-appear avoids warm-cache flash.
  const zone    = $('activeTaskZone');  const wrap = $('taskList');
  const allDone = $('allTasksDone');    const ctr  = $('taskCounter');
  if (allDone) allDone.style.display = 'none';
  if (ctr)     ctr.style.display     = 'none';
  if (wrap)    { wrap.innerHTML = ''; wrap.style.display = 'none'; }
  if (zone) {
    zone.style.display = '';
    zone.classList.add('is-loading');
    // show only the skeletoned open block while seeding; locked blocks return once tasks exist.
    ['lockedTaskSecond','lockedTaskThird'].forEach(id => { const e = $(id); if (e) e.style.display = 'none'; });
    ['atcProofSection','atcRejectSection'].forEach(id => { const e = $(id); if (e) e.style.display = 'none'; });
    const st = $('atcStatus'); if (st) st.textContent = '';
  }
}
/* The plan engine answered, but it needs something before it will generate.
   This is a distinct state from a failure: there is nothing to retry, there is
   something to DO, so it links to where that can be done instead of offering a
   Retry button that would just reproduce the same block. */
function renderPlanBlocked(title, detail, href) {
  const zone    = $('activeTaskZone');  const wrap = $('taskList');
  const allDone = $('allTasksDone');
  if (zone)    zone.style.display    = 'none';
  if (allDone) allDone.style.display = 'none';
  if (!wrap) return;
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  wrap.style.display = '';
  wrap.innerHTML =
    '<div class="tasks-empty"><div class="te-icon">?</div>'+
    '<div class="te-t">' + esc(title) + '</div>'+
    '<div class="te-s">' + esc(detail) + '</div>'+
    (href ? '<a class="btn-ghost" style="margin-top:14px;display:inline-block" href="' + esc(href) + '">Answer it</a>' : '');
}

/* backend failed for a signed-in user — offer retry */
function renderTasksError(detail) {
  const zone    = $('activeTaskZone');  const wrap = $('taskList');
  const allDone = $('allTasksDone');
  if (zone)    zone.style.display    = 'none';
  if (allDone) allDone.style.display = 'none';
  // Show the reason the server actually gave when there is one, rather than
  // always blaming the connection.
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const sub = detail ? esc(detail) : 'Check your connection and try again.';
  if (wrap) { wrap.style.display = ''; wrap.innerHTML =
    '<div class="tasks-empty"><div class="te-icon">⚠</div>'+
    '<div class="te-t">Couldn\'t load your task.</div>'+
    '<div class="te-s">' + sub + '</div>'+
    '<button id="tasksRetryBtn" class="btn-ghost" style="margin-top:14px">Retry</button></div>'; }
  try { const b = $('tasksRetryBtn'); if (b) b.addEventListener('click', () => {
    try { if (VISION.api && VISION.api.clearGenerationCooldown) VISION.api.clearGenerationCooldown(); } catch(e) {}
    setPersonalisingBanner('pending');
    hydrateBackendTasks(true);
  }); } catch(e) {}
}

/* fetch + render backend tasks for a signed-in user (with retry hook) */
async function hydrateBackendTasks(isRetry) {
  try {
    if (isRetry) renderTasksLoading();
    // hydrateLocal / getTasks / getDailyProgression don't consume each other's
    // results — fan them out (Promise.all) instead of serial awaits so we pay
    // one round-trip of latency, not three. Mirrors getCanonicalAppState().
    const [ , tasks, progression ] = await Promise.all([
      VISION.api.hydrateLocal().catch(() => false),
      VISION.api.getTasks(),
      (VISION.api.getDailyProgression ? VISION.api.getDailyProgression().catch(() => null) : Promise.resolve(null))
    ]);
    BACKEND_TASKS = tasks;
    if (progression) D.progression = progression;
    try { renderScoreStrip(); } catch(e) {}

    // Stale-task recovery: if backend tasks exist but ALL active/queued tasks had a
    // goal-snapshot mismatch, ensureDailyPlan() deferred them and no active task remains.
    // Detect this by checking for deferred-only tasks when no proof was submitted today
    // and no accepted tasks exist (which would mean legitimate day-close, not stale state).
    const missions = getMissions(BACKEND_TASKS);
    const hasDeferred  = BACKEND_TASKS && BACKEND_TASKS.some(t => t.activationStatus === 'deferred');
    const hasAccepted  = BACKEND_TASKS && BACKEND_TASKS.some(t => t.activationStatus === 'accepted' || t.done);
    const hasActiveQ   = missions.some(m => m.activationStatus === 'active' || m.activationStatus === 'queued');
    if (hasDeferred && !hasActiveQ && !hasAccepted && SIGNED_IN) {
      // Goal changed — tasks were deferred for old goal, new tasks not generated yet.
      // Auto-trigger regeneration (bypasses manual quota — same as auto_daily).
      renderTasksLoading();
      try {
        await VISION.api.refreshTasks();
        BACKEND_TASKS = await VISION.api.getTasks();
      } catch(e) {}
    }

    renderTasks(getMissions(BACKEND_TASKS));
    try { setRefreshUI(); } catch(e) {}
    // old-profile rebuild banner — show if profile lacks path_type (pre-path-graph)
    try {
      if (VISION.api.hasMissingPathFields) {
        // goal_category/domain_type are selected because hasMissingPathFields
        // mirrors generate-tasks' own `goal_category || domain_type ||
        // path_type` precedence; without them every Founder profile looks
        // old-format.
        const prof = (await VISION.sb.from('profiles').select('onboarding_complete,path_type,goal_category,domain_type').eq('id',(await VISION.auth.getUser()).id).maybeSingle()).data || {};
        const banner = document.getElementById('rebuildBanner');
        if (banner) banner.classList.toggle('show', VISION.api.hasMissingPathFields(prof));
      }
    } catch(e) {}
    // debug panel
    try { updateDebugPanel(BACKEND_TASKS); } catch(e) {}
    // Cache the authoritative task list so a warm same-day reload can paint real
    // tasks instantly (optimistic first paint) instead of the shimmer skeleton.
    try {
      const dk = (VISION.core && VISION.core.today) ? VISION.core.today() : new Date().toISOString().slice(0,10);
      if (BACKEND_TASKS && BACKEND_TASKS.length) {
        localStorage.setItem('vision_tasks_render_cache', JSON.stringify({ date: dk, tasks: BACKEND_TASKS }));
      }
    } catch(e) {}
    return true;
  } catch(e) {
    renderTasksError();
    return false;
  }
}

/* debug panel — only visible when localStorage.vision_debug === '1' */
function updateDebugPanel(tasks) {
  const panel = document.getElementById('debugPanel');
  if (!panel) return;
  const isDebug = (function(){ try { return localStorage.getItem('vision_debug') === '1'; } catch(e){ return false; } })();
  if (!isDebug || !tasks || !tasks.length) { panel.classList.remove('show'); return; }
  panel.classList.add('show');
  const t = tasks[0] || {};
  const set = function(id,v){ const el=document.getElementById(id); if(el) el.innerHTML=v; };
  set('dbgSource',  '<b>source:</b> ' + escHtml(String(t.taskSource||t.task_source||'—')) + '  ');
  set('dbgReason',  '<b>reason:</b> ' + escHtml(String(t.generatedReason||t.generated_reason||'—')) + '  ');
  set('dbgGoal',    '<b>goal_snapshot:</b> ' + escHtml(String(t.profileGoalSnapshot||t.profile_goal_snapshot||'—')) + '  ');
  set('dbgPath',    '<b>path_snapshot:</b> ' + escHtml(String(t.profilePathTypeSnapshot||t.profile_path_type_snapshot||'—')) + '  ');
  set('dbgGenAt',   '<b>generated_at:</b> ' + escHtml(String(tasks[0].generatedAt||'—')));
}

/* Load the isolated planner, privacy-safe interaction hooks, then the v3
   decision controller. Every layer is fail-open and proof/XP authority stays server-side. */
(function loadTaskLearningLayer() {
  if (window.__VISION_TASK_LEARNING_SCRIPT__) return;
  window.__VISION_TASK_LEARNING_SCRIPT__ = true;
  try {
    const anchor = document.currentScript;
    const parent = anchor && anchor.parentNode ? anchor.parentNode : document.head;
    const learning = document.createElement('script');
    learning.src = 'js/tasks/task-learning-v2.js';
    learning.async = false;
    learning.defer = false;
    learning.onerror = function() { console.warn('[VISION tasks] task-learning v2 layer unavailable'); };
    learning.onload = function() {
      try {
        const events = document.createElement('script');
        events.src = 'js/tasks/task-personalisation-events.js';
        events.async = false;
        events.defer = false;
        events.onerror = function() { console.warn('[VISION tasks] personalisation event hooks unavailable'); };
        events.onload = function() {
          try {
            const planner = document.createElement('script');
            planner.src = 'js/tasks/task-personalisation-v3.js';
            planner.async = false;
            planner.defer = false;
            planner.onerror = function() { console.warn('[VISION tasks] planner v3 controller unavailable'); };
            parent.insertBefore(planner, events.nextSibling);
          } catch(e) {}
        };
        parent.insertBefore(events, learning.nextSibling);
      } catch(e) {}
    };
    if (anchor && anchor.parentNode) parent.insertBefore(learning, anchor.nextSibling);
    else parent.appendChild(learning);
  } catch(e) {}
})();
