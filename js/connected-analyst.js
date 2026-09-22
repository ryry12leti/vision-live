/* ═══════════════════════════════════════════════════════════════
   connected-analyst.js — real Analyst backend for analyst.html
   ---------------------------------------------------------------
   Keeps Analyst chat, Today's Move and the canonical daily-plan
   client on the same verified Supabase task record.

   Public API: window.VISION.connectedAnalyst
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var LEGACY_TASK_KEY = 'vision_tasks_current';
  var state = {
    phase: 'loading',
    reason: '',
    userId: null,
    profile: null,
    taskId: null,
    task: null,
    taskResolution: 'unresolved',
    planStatus: null,
    planQuestion: null,
    planError: null
  };

  var listeners = [];
  var apiRepairPromise = null;
  var taskResolvePromise = null;

  /* Polling for the real task after generation started (own boot, another
     tab, or a server-side async run) so the Analyst stops being stuck on
     "generating" once Supabase actually finishes writing daily_tasks. A
     single boolean flag is the whole duplicate-loop guard: startPolling()
     is a no-op while a loop is already running. */
  var POLL_INTERVAL_MS = 2500;
  var POLL_TIMEOUT_MS = 60000;
  var polling = false;
  var pollTimer = null;
  var pollDeadline = 0;

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) {}
    }
  }

  function set(phase, reason) {
    state.phase = phase;
    state.reason = reason || '';
    try { document.documentElement.setAttribute('data-analyst-phase', phase); } catch (e) {}
    emit();
  }

  function apiReady() {
    return !!(V.api && typeof V.api.askVision === 'function');
  }

  function ensureApi() {
    if (apiReady()) return Promise.resolve(V.api);
    if (apiRepairPromise) return apiRepairPromise;

    apiRepairPromise = new Promise(function (resolve, reject) {
      if (!V.sb || !V.core || !V.auth) {
        apiRepairPromise = null;
        reject(new Error('Analyst dependencies are still loading. Reload once and try again.'));
        return;
      }

      var script = document.createElement('script');
      script.src = 'js/vision-api.js?analyst_repair=3';
      script.async = false;
      script.setAttribute('data-analyst-api-repair', 'true');
      script.onload = function () {
        if (apiReady()) resolve(V.api);
        else {
          apiRepairPromise = null;
          reject(new Error('Analyst API failed to initialise after its dependencies loaded.'));
        }
      };
      script.onerror = function () {
        apiRepairPromise = null;
        reject(new Error('Could not load the Analyst API module.'));
      };
      document.head.appendChild(script);
    });

    return apiRepairPromise;
  }

  function taskStatus(task) {
    return String((task && (task.activationStatus || task.activation_status || task.status)) || '').toLowerCase();
  }

  function isUsableTask(task) {
    if (!task || !task.id || task.done === true) return false;
    var status = taskStatus(task);
    return status !== 'archived' && status !== 'deferred' && status !== 'accepted' && status !== 'done';
  }

  function chooseTask(tasks) {
    var list = Array.isArray(tasks) ? tasks.filter(isUsableTask) : [];
    if (!list.length) return null;

    var priorities = ['active', 'queued', 'pending'];
    for (var p = 0; p < priorities.length; p++) {
      for (var i = 0; i < list.length; i++) {
        if (taskStatus(list[i]) === priorities[p]) return list[i];
      }
    }
    return list[0];
  }

  function todayLocal() {
    var date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function syncVisibleTask(task) {
    try {
      var previous = {};
      try { previous = JSON.parse(localStorage.getItem(LEGACY_TASK_KEY) || '{}') || {}; } catch (e) {}

      var record;
      if (task && task.id) {
        record = Object.assign({}, previous, {
          id: task.id,
          taskId: task.id,
          directive: task.title || task.directive || 'Today’s Move',
          title: task.title || task.directive || 'Today’s Move',
          task: task.title || task.directive || 'Today’s Move',
          why: task.whyPersonalised || task.why || task.helps || '',
          proofPrompt: task.proofPrompt || task.proof_prompt || '',
          proofMustShow: task.proofMustShow || task.proof_must_show || '',
          steps: Array.isArray(task.steps) ? task.steps : [],
          status: task.activationStatus || task.status || 'active',
          backendAuthoritative: true,
          visionAnalystShared: true,
          unavailable: false,
          ready: true,
          diagnosticQuestion: null,
          date: todayLocal(),
          updatedAt: Date.now()
        });
      } else if (state.planStatus === 'clarification_required' && state.planQuestion) {
        /* A pending diagnostic is not "still generating" — nothing will be
           generated until the user answers. Keep this record distinct from
           the generic placeholder below so any surface reading it (Today's
           Move hero, Professional Standard, quick actions) can tell "wait a
           few seconds" apart from "answer this question first" instead of
           collapsing both into one misleading string. */
        record = {
          id: null,
          taskId: null,
          directive: null,
          title: null,
          task: null,
          why: '',
          status: 'clarification_required',
          backendAuthoritative: true,
          visionAnalystShared: true,
          unavailable: true,
          ready: false,
          diagnosticQuestion: {
            id: state.planQuestion.id,
            text: state.planQuestion.text || '',
            reason: state.planQuestion.reason || ''
          },
          date: todayLocal(),
          updatedAt: Date.now()
        };
      } else if (state.planStatus === 'error' && state.planError) {
        /* A genuine backend failure (generation failed, timed out, or was
           rejected) is not "still generating" either — that copy told the
           user to keep waiting for something that had already given up, with
           no path forward. Surface the plan engine's own honest message. */
        record = {
          id: null,
          taskId: null,
          directive: 'Your Today’s Move could not be generated.',
          title: 'Your Today’s Move could not be generated.',
          task: 'Your Today’s Move could not be generated.',
          why: state.planError.message || 'The plan engine could not finish.',
          status: 'error',
          backendAuthoritative: true,
          visionAnalystShared: true,
          unavailable: true,
          ready: false,
          diagnosticQuestion: null,
          retryable: state.planError.retryable !== false,
          date: todayLocal(),
          updatedAt: Date.now()
        };
      } else {
        record = {
          id: null,
          taskId: null,
          directive: 'Your real Today’s Move is still being generated.',
          title: 'Your real Today’s Move is still being generated.',
          task: 'Your real Today’s Move is still being generated.',
          why: 'VISION is waiting for the backend task plan. No demo task is being used.',
          status: 'generating',
          backendAuthoritative: true,
          visionAnalystShared: true,
          unavailable: true,
          ready: false,
          diagnosticQuestion: null,
          date: todayLocal(),
          updatedAt: Date.now()
        };
      }

      var value = JSON.stringify(record);
      localStorage.setItem(LEGACY_TASK_KEY, value);

      var frame = document.getElementById('visionNetworkFrame');
      if (frame && frame.contentWindow) {
        try {
          frame.contentWindow.dispatchEvent(new StorageEvent('storage', {
            key: LEGACY_TASK_KEY,
            newValue: value,
            storageArea: localStorage,
            url: location.href
          }));
        } catch (e2) {}
      }
    } catch (e3) {}
  }

  function applyPlan(plan) {
    var tasks = [];
    var selected = null;

    if (plan) {
      state.planStatus = plan.status || null;
      state.planQuestion = plan.question || null;
      state.planError = plan.error || null;
      if (plan.status === 'ready' && Array.isArray(plan.tasks)) {
        tasks = plan.tasks;
        selected = chooseTask(tasks);
      }
    }

    state.task = selected || null;
    state.taskId = selected && selected.id ? selected.id : null;
    state.taskResolution = state.taskId ? 'backend-task' : 'no-backend-task';
    syncVisibleTask(state.task);
    if (state.taskId) stopPolling();
    emit();
    return state.task;
  }

  function stopPolling() {
    polling = false;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  /* No point polling once the situation needs the user, not the server: a
     diagnostic question is a dashboard action, and a non-retryable plan
     error (bad goal, expired session, quota) will not resolve itself. */
  function shouldKeepPolling() {
    if (state.taskId) return false;
    if (state.planStatus === 'clarification_required') return false;
    if (state.planStatus === 'error' && state.planError && state.planError.retryable === false) return false;
    return true;
  }

  function pollTick() {
    pollTimer = null;
    if (!polling) return;
    if (Date.now() >= pollDeadline) {
      stopPolling();
      /* Giving up silently here left the UI frozen on "still being
         generated" forever with no indication anything had stopped and no
         way forward. Only step in when nothing more specific is already
         showing (no task, no pending diagnostic, no existing error). */
      if (!state.taskId && state.planStatus !== 'clarification_required' && !state.planError) {
        state.planStatus = 'error';
        state.planError = {
          code: 'generation_timeout_client',
          message: 'Your plan is taking longer than expected. Try again.',
          retryable: true
        };
        syncVisibleTask(null);
        emit();
      }
      return;
    }

    var run = (V.dailyPlan && typeof V.dailyPlan.checkForTask === 'function')
      ? V.dailyPlan.checkForTask()
      : Promise.resolve(null);

    run.then(function (plan) {
      if (!polling) return;
      if (plan) applyPlan(plan);
      if (!polling) return; // applyPlan() already stopped the loop
      if (!shouldKeepPolling()) { stopPolling(); return; }
      pollTimer = setTimeout(pollTick, POLL_INTERVAL_MS);
    }).catch(function () {
      if (!polling) return;
      if (!shouldKeepPolling()) { stopPolling(); return; }
      pollTimer = setTimeout(pollTick, POLL_INTERVAL_MS);
    });
  }

  function startPolling() {
    if (polling) return; // a loop is already running — never start a second one
    if (!shouldKeepPolling()) return;
    polling = true;
    pollDeadline = Date.now() + POLL_TIMEOUT_MS;
    pollTimer = setTimeout(pollTick, POLL_INTERVAL_MS);
  }

  function resolveRealTask(force) {
    if (taskResolvePromise && !force) return taskResolvePromise;

    taskResolvePromise = (async function () {
      await ensureApi();

      if (V.dailyPlan && typeof V.dailyPlan.load === 'function') {
        var plan = null;
        try { plan = await V.dailyPlan.load(); } catch (e0) { plan = null; }
        applyPlan(plan);
      } else {
        var tasks = [];
        try {
          if (typeof V.api.getTasks === 'function') tasks = await V.api.getTasks();
        } catch (e1) { tasks = []; }

        var selected = chooseTask(tasks);
        if (!selected && typeof V.api.getActiveTask === 'function') {
          try { selected = await V.api.getActiveTask(); } catch (e2) { selected = null; }
        }

        state.planStatus = selected ? 'ready' : 'empty';
        state.planQuestion = null;
        state.planError = null;
        state.task = selected || null;
        state.taskId = selected && selected.id ? selected.id : null;
        state.taskResolution = state.taskId ? 'backend-task' : 'no-backend-task';
        syncVisibleTask(state.task);
        if (state.taskId) stopPolling();
        emit();
      }

      return state.task;
    })().finally(function () {
      taskResolvePromise = null;
    });

    return taskResolvePromise;
  }

  /* Same local-origin test used by js/tasks/demo-harness.js — kept in sync
     rather than imported since this module must not depend on task code. */
  function isDevOrigin() {
    try {
      if (location.protocol === 'file:') return true;
      var h = String(location.hostname || '').toLowerCase();
      return h === 'localhost' || h === '::1' || /^127\./.test(h) || /\.localhost$/.test(h);
    } catch (e) { return false; }
  }

  function structuredError(error, fallback) {
    if (error instanceof Error) return error;
    var code = error && (error.error || error.code);
    var detail = error && error.message;
    var message = detail || fallback || 'Analyst request failed.';
    /* A real backend rejection (invalid_mode, invalid_task_id, unknown_fields,
       …) carries a code but often no .message, so it used to collapse into
       the same generic fallback as an actual network failure — indistinguishable
       to whoever is debugging it. In dev, put the real code back in the message
       so it is not lost the moment this becomes a plain Error. */
    if (isDevOrigin() && code) {
      message = 'Analyst request failed [' + code + (error.status ? ' ' + error.status : '') + ']' + (detail ? ': ' + detail : '');
      try { console.warn('[connected-analyst] ask-vision rejected', { code: code, status: error.status || null, message: detail || null }); } catch (e2) {}
    }
    var wrapped = new Error(message);
    if (code) wrapped.code = code;
    if (error && error.status) wrapped.status = error.status;
    return wrapped;
  }

  function planFailure() {
    var failure;
    if (state.planStatus === 'clarification_required' && state.planQuestion) {
      failure = new Error('Your Analyst needs one answer before it can plan today: ' + state.planQuestion.text);
      failure.code = 'clarification_required';
      failure.question = state.planQuestion;
      return failure;
    }
    if (state.planError) {
      failure = new Error(state.planError.message || 'The plan engine could not finish.');
      failure.code = state.planError.code;
      failure.retryable = state.planError.retryable;
      return failure;
    }
    failure = new Error('Today’s task has not generated yet, so there is nothing to analyse.');
    failure.code = 'no_active_task';
    return failure;
  }

  /* Only ever call this from a caller that is itself visibly in
     diagnostic-answer mode (a UI that is showing state.planQuestion and
     explicitly asking the user to answer it) — never from ordinary chat.
     Ordinary Analyst messages ("hi", or any question) must never be
     silently consumed as evidence for a pending diagnostic question. */
  async function answerDiagnostic(answer) {
    if (!state.planQuestion || state.planStatus !== 'clarification_required') {
      throw new Error('There is no pending diagnostic question to answer.');
    }
    if (!V.dailyPlan || typeof V.dailyPlan.answerQuestion !== 'function') {
      throw planFailure();
    }

    var question = state.planQuestion;
    var plan = await V.dailyPlan.answerQuestion(question.id, answer);
    applyPlan(plan);

    if (state.taskId && state.task) {
      return {
        answer: 'That gives me enough context. Your Today’s Move is ready: ' +
          (state.task.title || state.task.directive || 'open Today’s Move to begin.'),
        task_id: state.taskId,
        task: state.task,
        diagnostic_answered: true
      };
    }

    if (state.planStatus === 'clarification_required' && state.planQuestion) {
      return {
        answer: 'Thanks. I need one more answer before I can build today’s move: ' + state.planQuestion.text,
        diagnostic_answered: true,
        question: state.planQuestion
      };
    }

    /* A non-retryable error (e.g. a corrupted goal) really is terminal — say
       so. A retryable one (generation_in_flight, a transient network/service
       failure) means the real task may still be on its way server-side, same
       as the ordinary "generating" case, so fall through to polling instead
       of dead-ending the very next line after a successful answer. */
    if (state.planError && state.planError.retryable === false) throw planFailure();

    /* Answered and no more questions, but generation has not landed a task
       in this same response (e.g. it is still running server-side). Without
       this, nothing ever re-checks daily_tasks and the UI is stuck showing
       "being generated" forever instead of actually catching the real task. */
    startPolling();

    return {
      answer: 'Thanks. Your answer was saved and your Today’s Move is being generated.',
      diagnostic_answered: true
    };
  }

  /* Every ordinary Analyst message lands here and must call ask-vision with
     the real task_id — it must never be reinterpreted as a diagnostic
     answer. If a task has not resolved yet, take one read-only look (no
     generation call, so this cannot spawn a duplicate generate-tasks
     request) before giving an honest failure; the background poll loop
     (see startPolling) is what actually catches a task that finishes
     generating after boot. */
  async function ask(question, mode) {
    var text = String(question == null ? '' : question).trim();
    if (!text) throw new Error('Ask a question first.');
    if (state.phase === 'signed-out') throw new Error('Sign in to ask the Analyst.');

    await ensureApi();

    if (!state.taskId && V.dailyPlan && typeof V.dailyPlan.checkForTask === 'function') {
      try { applyPlan(await V.dailyPlan.checkForTask()); } catch (e0) { /* keep the prior state */ }
    }

    if (!state.taskId) {
      throw planFailure();
    }

    try {
      return await V.api.askVision(state.taskId, text, mode || 'custom');
    } catch (raw) {
      var code = raw && (raw.error || raw.code);
      if (code === 'task_not_found' || code === 'no_active_task') {
        state.task = null;
        state.taskId = null;
        state.taskResolution = 'retrying';
        syncVisibleTask(null);

        await resolveRealTask(true);
        if (state.taskId) {
          try {
            return await V.api.askVision(state.taskId, text, mode || 'custom');
          } catch (retryError) {
            throw structuredError(retryError, 'The Analyst could not use today’s task.');
          }
        }

        startPolling();
        throw planFailure();
      }
      throw structuredError(raw, 'Could not reach the Analyst.');
    }
  }

  async function boot() {
    set('loading', 'Connecting to your Analyst…');

    try {
      await ensureApi();
    } catch (apiError) {
      set('error', apiError && apiError.message ? apiError.message : String(apiError));
      return state;
    }

    var session = null;
    try { session = V.auth && V.auth.getSession ? await V.auth.getSession() : null; } catch (e) {}

    if (!session) {
      if (V.backend) {
        location.replace('login.html');
        return state;
      }
      set('signed-out', 'Signed-out preview — not connected to a backend.');
      return state;
    }

    state.userId = session.user && session.user.id ? session.user.id : null;

    try {
      if (V.auth && V.auth.isOnboarded && !(await V.auth.isOnboarded())) {
        location.replace('onboarding.html');
        return state;
      }
    } catch (e2) {}

    try {
      if (typeof V.api.getProfile === 'function') state.profile = await V.api.getProfile();
      set('loading', 'Preparing today’s real task…');
      await resolveRealTask(true);
      set('ready', state.taskId ? '' : 'Today’s task is still generating.');
      if (!state.taskId) startPolling();
    } catch (e3) {
      syncVisibleTask(null);
      set('error', 'Could not load your Analyst context: ' + (e3 && e3.message ? e3.message : String(e3)));
    }

    return state;
  }

  V.connectedAnalyst = {
    state: state,
    onChange: onChange,
    boot: boot,
    ask: ask,
    /* Explicit diagnostic-answer path — only for a caller that is itself
       showing state.planQuestion and visibly in diagnostic-answer mode.
       Ordinary chat must keep calling ask(), never this. */
    answerDiagnostic: answerDiagnostic,
    ensureApi: ensureApi,
    resolveRealTask: resolveRealTask,
    isLive: function () { return state.phase === 'ready' && apiReady(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(); });
  } else {
    boot();
  }
})(window.VISION);
