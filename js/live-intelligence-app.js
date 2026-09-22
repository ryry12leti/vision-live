/* ═══════════════════════════════════════════════════════════════
   live-intelligence-app.js — canonical Live Intelligence state
   ---------------------------------------------------------------
   This module is the only owner of Live Intelligence workspace data and
   async lifecycle state. The view renders only backend records held here;
   it never substitutes bundled workspaces, local verdicts, or canned
   responses when the backend is unavailable.

   Public API: window.VISION.liApp
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var state = {
    phase: 'booting', /* booting | signed-out | loading-list | empty | creating |
                        loading-workspace | ready | saving | analysing | applying |
                        asking | conflict | error */
    connection: 'connecting', /* connecting | online | offline | unavailable */
    operation: 'booting',
    reason: 'Connecting to Live Intelligence…',
    operationError: '',
    userId: null,
    taskId: null,
    task: null,
    taskWorkspaceMissing: false,
    pendingWorkspaceId: null,
    workspaces: [],
    activeWorkspaceId: null,
    workspace: null,
    workspaceState: null,
    document: null,
    documentEpoch: 0,
    revision: null,
    syncRequired: false,
    conflictDraft: null,
    loadingWorkspaceId: null,
    issues: [],
    messages: [],
    versions: [],
    attachments: [],
    latestAnalysis: null,
    analysis: { status: 'idle', depth: null, reason: '', result: null, hasResult: false },
    save: { status: 'idle', reason: '' },
    ask: { status: 'idle', answer: '', reason: '' },
    change: { status: 'idle', proposal: null, lastProposalId: null, reason: '' }
  };

  var listeners = [];
  var workspaceRequest = 0;
  var saveRequest = 0;
  var analysisRequest = 0;
  var askRequest = 0;
  var changeRequest = 0;
  var analysisController = null;
  var latestSavePromise = null;
  var queuedSave = null;

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      var index = listeners.indexOf(fn);
      if (index > -1) listeners.splice(index, 1);
    };
  }

  function emit() {
    document.documentElement.setAttribute('data-li-phase', state.phase);
    document.documentElement.setAttribute('data-li-connection', state.connection);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { /* one view cannot stall state */ }
    }
  }

  function api() {
    if (!V.liApi) throw new Error('backend_not_configured');
    return V.liApi;
  }

  function hasActiveWorkspace() {
    return !!(state.workspace && state.document && state.activeWorkspaceId);
  }

  function supports(capability) {
    var transport = V.liApi || {};
    var requirements = {
      createWorkspace: ['createWorkspace'],
      renameWorkspace: ['renameWorkspace', 'updateWorkspace'],
      archiveWorkspace: ['archiveWorkspace'],
      saveDocument: ['autosave'],
      analyse: ['analyse'],
      ask: ['ask'],
      quietIssue: ['quietIssue'],
      applyIssue: ['previewChange', 'applyChange'],
      undoLastChange: ['undoChange']
    };
    var names = requirements[capability];
    if (!names) return false;
    if (capability === 'renameWorkspace') {
      for (var i = 0; i < names.length; i++) if (typeof transport[names[i]] === 'function') return true;
      return false;
    }
    for (var j = 0; j < names.length; j++) if (typeof transport[names[j]] !== 'function') return false;
    return true;
  }

  function setPhase(phase, reason, operation) {
    state.phase = phase;
    state.reason = reason || '';
    state.operation = operation || 'idle';
    emit();
  }

  function setOperation(operation, error) {
    state.operation = operation || 'idle';
    state.operationError = error || '';
    emit();
  }

  function safeMessage(error, fallback) {
    var code = error && (error.code || error.message);
    var messages = {
      auth_expired: 'Your session has expired. Sign in again to reconnect.',
      backend_not_configured: 'Live Intelligence is waiting for a backend connection.',
      network_offline: 'You are offline. Reconnect to continue.',
      network_failed: 'The connection was interrupted. Try reconnecting.',
      function_not_deployed: 'Live Intelligence workspaces are not available on this deployment.',
      route_unavailable: 'Live Intelligence is temporarily unavailable.',
      provider_unavailable: 'Live Intelligence is temporarily unavailable.',
      reasoning_unreachable: 'Live Intelligence could not reach the analysis service.',
      analysis_timeout: 'Analysis is taking longer than expected.',
      rate_limited: 'Live Intelligence is busy. Wait a moment and try again.',
      quota_reached: 'Live Intelligence cannot start another analysis right now.',
      revision_conflict: 'This document changed elsewhere. Reload the current version before editing again.',
      conflict: 'This workspace changed elsewhere. Reload the current version before editing again.',
      forbidden: 'This workspace is not available to the current account.',
      not_found: 'This workspace is no longer available.',
      malformed_response: 'The backend returned an incomplete response.',
      invalid_request: 'The backend could not accept that request.'
    };
    return messages[code] || fallback || 'Live Intelligence is unavailable.';
  }

  function isConflictError(error) {
    return !!(error && (error.status === 409 || error.code === 'revision_conflict' ||
      error.code === 'conflict' || error.message === 'revision_conflict' || error.message === 'conflict'));
  }

  function resetActiveWorkspace() {
    state.activeWorkspaceId = null;
    state.workspace = null;
    state.workspaceState = null;
    state.document = null;
    state.revision = null;
    state.syncRequired = false;
    state.issues = [];
    state.messages = [];
    state.versions = [];
    state.attachments = [];
    state.latestAnalysis = null;
    state.loadingWorkspaceId = null;
    state.analysis = { status: 'idle', depth: null, reason: '', result: null, hasResult: false };
    state.save = { status: 'idle', reason: '' };
    state.ask = { status: 'idle', answer: '', reason: '' };
    state.change = { status: 'idle', proposal: null, lastProposalId: null, reason: '' };
  }

  function primaryDocument(payload) {
    if (payload && payload.document && payload.document.id) return payload.document;
    var documents = payload && Array.isArray(payload.documents) ? payload.documents : [];
    if (!documents.length) return null;
    for (var i = 0; i < documents.length; i++) {
      if (documents[i] && documents[i].is_primary) return documents[i];
    }
    return documents[0] || null;
  }

  function normaliseWorkspaceList(payload) {
    var items = Array.isArray(payload) ? payload
      : (payload && Array.isArray(payload.workspaces) ? payload.workspaces : []);
    return items.filter(function (item) {
      return item && typeof item.id === 'string' && item.id;
    });
  }

  function workspaceForTask(items, taskId) {
    if (!taskId) return null;
    for (var i = 0; i < items.length; i++) {
      var item = items[i] || {};
      var linkedTaskId = item.linked_task_id || item.task_id || item.taskId || item.linkedTaskId;
      if (linkedTaskId === taskId) return item.id;
    }
    return null;
  }

  function resolveAnalysisFromPayload(payload) {
    var workspaceState = payload && payload.state;
    var latest = payload && payload.latest_analysis;
    var analysisState = workspaceState && workspaceState.analysis_state;
    var result = latest && latest.response_snapshot ? latest.response_snapshot : null;
    var hasResult = !!(result || (workspaceState && workspaceState.last_analysis_at) || latest);
    if (analysisState === 'queued' || analysisState === 'processing') {
      return { status: 'buffering', depth: null, reason: 'Analysis is running on the backend.', result: result, hasResult: hasResult };
    }
    if (analysisState === 'error') {
      return { status: 'error', depth: null, reason: 'The latest backend analysis did not complete.', result: result, hasResult: hasResult };
    }
    return { status: hasResult ? 'ready' : 'idle', depth: null, reason: '', result: result, hasResult: hasResult };
  }

  function acceptWorkspacePayload(payload) {
    var workspace = payload && payload.workspace;
    var documentRecord = primaryDocument(payload);
    if (!workspace || !workspace.id) throw new Error('malformed_response');
    if (!documentRecord || !documentRecord.id) throw new Error('malformed_response');

    var previousDocument = state.document;
    var workspaceChanged = !state.workspace || state.workspace.id !== workspace.id;
    var documentChanged = !previousDocument ||
      previousDocument.id !== documentRecord.id ||
      previousDocument.revision !== documentRecord.revision ||
      previousDocument.content !== documentRecord.content ||
      previousDocument.plain_text !== documentRecord.plain_text ||
      previousDocument.sections !== documentRecord.sections ||
      previousDocument.blocks !== documentRecord.blocks;

    state.workspace = workspace;
    state.pendingWorkspaceId = null;
    state.activeWorkspaceId = workspace.id;
    state.loadingWorkspaceId = null;
    var listedWorkspaceIndex = state.workspaces.findIndex(function (item) {
      return item && item.id === workspace.id;
    });
    if (listedWorkspaceIndex > -1) {
      state.workspaces[listedWorkspaceIndex] = Object.assign({}, state.workspaces[listedWorkspaceIndex], workspace);
    } else {
      state.workspaces.unshift(workspace);
    }
    state.workspaceState = payload.state || null;
    state.document = documentRecord;
    state.revision = documentRecord.revision != null ? documentRecord.revision : null;
    state.syncRequired = false;
    state.issues = Array.isArray(payload.issues) ? payload.issues : [];
    state.messages = Array.isArray(payload.messages) ? payload.messages : [];
    state.versions = Array.isArray(payload.versions) ? payload.versions : [];
    state.attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    state.latestAnalysis = payload.latest_analysis || null;
    state.analysis = resolveAnalysisFromPayload(payload);
    if (workspaceChanged) {
      state.conflictDraft = null;
      state.save = { status: 'idle', reason: '' };
      state.ask = { status: 'idle', answer: '', reason: '' };
      state.change = { status: 'idle', proposal: null, lastProposalId: null, reason: '' };
    }
    state.connection = 'online';
    state.operationError = '';
    if (documentChanged) state.documentEpoch += 1;
  }

  function requestedTaskId() {
    var requested = V.nav && V.nav.activeTaskId ? V.nav.activeTaskId() : null;
    if (requested) return requested;
    try {
      var params = new URLSearchParams(location.search);
      var candidate = params.get('task_id') || params.get('taskId');
      if (V.nav && typeof V.nav.safeTaskId === 'function') return V.nav.safeTaskId(candidate);
      return typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(candidate) ? candidate : null;
    } catch (e) {
      return null;
    }
  }

  async function resolveRealTask() {
    var requested = requestedTaskId();
    state.taskId = requested;
    state.task = null;
    if (!requested || !V.api || typeof V.api.getTasks !== 'function') return null;
    try {
      var tasks = await V.api.getTasks();
      if (!Array.isArray(tasks)) return null;
      for (var i = 0; i < tasks.length; i++) {
        if (tasks[i] && tasks[i].id === requested) {
          state.task = tasks[i];
          return tasks[i];
        }
      }
    } catch (e) { /* workspace listing can still proceed */ }
    return null;
  }

  async function openWorkspace(workspaceId, options) {
    if (!workspaceId) throw new Error('invalid_request');
    var request = ++workspaceRequest;
    var opts = options || {};
    var previousWorkspaceId = state.activeWorkspaceId;
    ++analysisRequest;
    ++askRequest;
    ++changeRequest;
    if (analysisController) analysisController.abort();
    state.loadingWorkspaceId = workspaceId;
    state.taskWorkspaceMissing = false;
    setPhase('loading-workspace', opts.reason || 'Loading workspace…', opts.operation || 'opening');
    try {
      var payload = await api().getWorkspace(workspaceId);
      if (request !== workspaceRequest) return state;
      acceptWorkspacePayload(payload);
      if (state.change && state.change.status === 'sync-error') {
        state.change = { status: 'idle', proposal: null, lastProposalId: null, reason: '' };
      }
      setPhase('ready', '', 'idle');
      resumePendingAnalysis();
      return state;
    } catch (error) {
      if (request !== workspaceRequest) return state;
      state.loadingWorkspaceId = null;
      state.activeWorkspaceId = previousWorkspaceId;
      if (!hasActiveWorkspace() || state.syncRequired) {
        state.connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'unavailable';
      }
      setPhase('error', safeMessage(error, 'The workspace could not be opened.'), 'idle');
      throw error;
    }
  }

  async function loadWorkspaces(options) {
    var opts = options || {};
    var operation = opts.operation || 'listing';
    if (!opts.keepPhase) setPhase('loading-list', opts.reason || 'Loading workspaces…', operation);
    else setOperation(operation, '');
    try {
      var transport = api();
      var linkedLookup = !opts.openId && state.taskId &&
        typeof transport.findWorkspaceForTask === 'function'
        ? transport.findWorkspaceForTask(state.taskId)
        : Promise.resolve(null);
      var results = await Promise.all([
        transport.listWorkspaces(),
        linkedLookup
      ]);
      state.workspaces = normaliseWorkspaceList(results[0]);
      state.connection = 'online';
      var linkedWorkspaceId = results[1] || workspaceForTask(state.workspaces, state.taskId);
      var workspaceId = linkedWorkspaceId || opts.openId || state.pendingWorkspaceId || state.activeWorkspaceId ||
        (!state.taskId && state.workspaces[0] && state.workspaces[0].id);
      if (!workspaceId) {
        resetActiveWorkspace();
        state.taskWorkspaceMissing = !!state.taskId;
        setPhase('empty', state.taskId ? 'Start workspace for this task' : 'No workspaces yet.', 'idle');
        return state;
      }
      return await openWorkspace(workspaceId, {
        operation: operation,
        reason: opts.openReason || 'Loading workspace…'
      });
    } catch (error) {
      if (state.phase === 'error') throw error;
      if (!hasActiveWorkspace()) {
        resetActiveWorkspace();
        state.connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'unavailable';
      }
      setPhase('error', safeMessage(error, 'Workspaces could not be loaded.'), 'idle');
      throw error;
    }
  }

  async function boot() {
    ++workspaceRequest;
    state.connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'connecting';
    state.operationError = '';
    setPhase('booting', 'Connecting to Live Intelligence…', 'booting');

    var session = null;
    try {
      session = V.auth && V.auth.getSession ? await V.auth.getSession() : null;
    } catch (e) {
      session = null;
    }

    if (!session) {
      setPhase('signed-out', 'Sign in to use Live Intelligence.', 'idle');
      if (V.backend) {
        location.replace('login.html?next=' + encodeURIComponent('/live-intelligence.html' + location.search));
        return state;
      }
      resetActiveWorkspace();
      state.connection = 'unavailable';
      setPhase('error', 'Live Intelligence is waiting for an authenticated backend connection.', 'idle');
      return state;
    }

    state.userId = session.user && session.user.id ? session.user.id : null;

    /* NO CONSUMER-ONBOARDING GATE ON A FOUNDER TOOL. This redirected to
       onboarding.html whenever profiles.onboarding_complete was false — a flag
       set by the consumer proof flow, which a founder arriving from the
       Prospect Workspace has no reason to have completed. The effect was that
       Live Intelligence was unreachable for exactly the user it was built for,
       and the redirect looked like a routing bug rather than a policy.

       It was never a security boundary either, as the original comment on this
       block already said: every workspace request is guarded by RLS and by
       SECURITY DEFINER ownership checks in the database. Removing it changes
       who can OPEN the page, not what they can read or write. */

    await resolveRealTask();
    try {
      return await loadWorkspaces({ operation: 'booting' });
    } catch (e) {
      return state;
    }
  }

  function validatedWorkspaceInput(input) {
    var source = input || {};
    var taskDescription = String(source.taskDescription || '').trim();
    var title = String(source.title || '').trim();
    var desiredOutcome = String(source.desiredOutcome || '').trim();
    var feedbackIntensity = String(source.feedbackIntensity || 'balanced');
    if (!taskDescription || taskDescription.length > 20000) throw new Error('invalid_task_description');
    if (title.length > 160) throw new Error('invalid_title');
    if (desiredOutcome.length > 10000) throw new Error('invalid_desired_outcome');
    if (['light', 'balanced', 'direct', 'ruthless'].indexOf(feedbackIntensity) < 0) {
      throw new Error('invalid_feedback_intensity');
    }
    return {
      taskDescription: taskDescription,
      title: title || null,
      desiredOutcome: desiredOutcome || null,
      feedbackIntensity: feedbackIntensity,
      taskId: source.taskId || source.linkedTaskId || null
    };
  }

  async function createWorkspace(input) {
    var previousPhase = state.phase;
    var createdWorkspaceId = null;
    var values;
    try {
      values = validatedWorkspaceInput(input);
    } catch (error) {
      state.operationError = 'Describe the work this workspace should understand.';
      emit();
      throw error;
    }

    state.phase = 'creating';
    setOperation('creating', '');
    try {
      var created = await api().createWorkspace(values);
      var workspaceId = created && (
        created.workspace_id || created.id ||
        (created.workspace && (created.workspace.id || created.workspace.workspace_id))
      );
      if (!workspaceId) throw new Error('malformed_response');
      createdWorkspaceId = workspaceId;
      state.pendingWorkspaceId = workspaceId;
      return await loadWorkspaces({
        operation: 'creating',
        openId: workspaceId,
        openReason: 'Preparing your workspace…'
      });
    } catch (error) {
      state.phase = createdWorkspaceId ? 'error' : previousPhase;
      state.operation = 'idle';
      state.operationError = createdWorkspaceId
        ? 'The workspace was created, but it could not be loaded. Reconnect to open it.'
        : safeMessage(error, 'The workspace could not be created.');
      emit();
      throw error;
    }
  }

  async function renameWorkspace(title) {
    var value = String(title || '').trim();
    if (!state.activeWorkspaceId || !value || value.length > 160) {
      state.operationError = 'Enter a workspace name between 1 and 160 characters.';
      emit();
      throw new Error('invalid_title');
    }
    setOperation('renaming', '');
    var renamed = false;
    try {
      if (typeof api().renameWorkspace === 'function') await api().renameWorkspace(state.activeWorkspaceId, value);
      else if (typeof api().updateWorkspace === 'function') await api().updateWorkspace(state.activeWorkspaceId, { title: value });
      else throw new Error('unsupported_action');
      renamed = true;
      return await loadWorkspaces({
        operation: 'renaming',
        openId: state.activeWorkspaceId,
        openReason: 'Refreshing workspace…'
      });
    } catch (error) {
      state.operation = 'idle';
      state.operationError = renamed
        ? 'The workspace name was saved, but the refreshed workspace could not be loaded. Reconnect to continue.'
        : safeMessage(error, 'The workspace could not be renamed.');
      emit();
      throw error;
    }
  }

  async function archiveWorkspace() {
    if (!state.activeWorkspaceId) return state;
    var workspaceId = state.activeWorkspaceId;
    setOperation('archiving', '');
    var archived = false;
    try {
      await api().archiveWorkspace(workspaceId, true);
      archived = true;
      resetActiveWorkspace();
      state.workspaces = state.workspaces.filter(function (item) { return item.id !== workspaceId; });
      return await loadWorkspaces({ operation: 'archiving' });
    } catch (error) {
      state.operation = 'idle';
      state.operationError = archived
        ? 'The workspace was archived, but the active list could not be refreshed. Reconnect to continue.'
        : safeMessage(error, 'The workspace could not be archived.');
      emit();
      throw error;
    }
  }

  async function reconnect(options) {
    var opts = options || {};
    state.connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'connecting';
    if (state.connection === 'offline') {
      if (!hasActiveWorkspace()) setPhase('error', 'You are offline. Reconnect to continue.', 'idle');
      else emit();
      return state;
    }
    if (opts.preserveWorkspace && hasActiveWorkspace() && !state.syncRequired) {
      state.connection = 'online';
      if (state.phase !== 'conflict') state.phase = 'ready';
      state.reason = '';
      emit();
      return state;
    }
    setPhase('booting', 'Reconnecting to Live Intelligence…', 'reconnecting');
    return boot();
  }

  async function saveDocument(content, contentFormat) {
    if (!hasActiveWorkspace() || state.phase === 'conflict') return null;
    if (state.analysis.status === 'analysing' || state.analysis.status === 'buffering') {
      ++analysisRequest;
      if (analysisController) analysisController.abort();
      state.analysis = { status: 'idle', depth: null, reason: '', result: null, hasResult: false };
    }
    queuedSave = {
      request: ++saveRequest,
      workspaceId: state.workspace.id,
      documentId: state.document.id,
      content: String(content == null ? '' : content),
      format: contentFormat || state.document.content_format || 'plain_text'
    };
    state.save = { status: 'saving', reason: '' };
    state.phase = 'saving';
    emit();

    if (latestSavePromise) return latestSavePromise;
    latestSavePromise = (async function drainSaveQueue() {
      while (queuedSave) {
        var draft = queuedSave;
        queuedSave = null;
        if (state.activeWorkspaceId !== draft.workspaceId || !state.document || state.document.id !== draft.documentId) {
          continue;
        }
        var expectedRevision = state.revision;
        try {
          var result = await api().autosave({
            workspaceId: draft.workspaceId,
            documentId: draft.documentId,
            content: draft.content,
            contentFormat: draft.format,
            expectedRevision: expectedRevision
          });
          if (state.activeWorkspaceId !== draft.workspaceId || !state.document || state.document.id !== draft.documentId) {
            continue;
          }
          if (result && (result.conflict || result.status === 'conflict')) {
            state.conflictDraft = draft;
            queuedSave = null;
            state.save = { status: 'conflict', reason: 'This document changed elsewhere. Reload the current version before editing again.' };
            state.phase = 'conflict';
            emit();
            return result;
          }
          var revision = result && result.revision != null ? result.revision
            : (result && result.current_revision != null ? result.current_revision : expectedRevision);
          state.revision = revision;
          state.document.content = draft.content;
          state.document.content_format = draft.format;
          state.document.revision = revision;
          state.conflictDraft = null;
          state.save = queuedSave ? { status: 'saving', reason: '' } : { status: 'saved', reason: '' };
          state.phase = queuedSave ? 'saving' : 'ready';
          emit();
        } catch (error) {
          if (state.activeWorkspaceId !== draft.workspaceId) continue;
          if (isConflictError(error)) {
            state.conflictDraft = draft;
            queuedSave = null;
            state.save = { status: 'conflict', reason: 'This document changed elsewhere. Reload the current version before editing again.' };
            state.phase = 'conflict';
            emit();
            return null;
          }
          state.conflictDraft = queuedSave || draft;
          queuedSave = null;
          state.save = { status: 'error', reason: safeMessage(error, 'Changes could not be saved.') };
          state.phase = 'ready';
          state.connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : state.connection;
          emit();
          throw error;
        }
      }
      return null;
    })().finally(function () {
      latestSavePromise = null;
    });
    return latestSavePromise;
  }

  function analysisIsPending(result) {
    var status = result && (result.status || result.job_status);
    return !!(result && result.pending) ||
      ['accepted', 'queued', 'processing', 'already_processing', 'deferred'].indexOf(status) > -1;
  }

  function wait(milliseconds, signal) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(resolve, milliseconds);
      if (signal) {
        signal.addEventListener('abort', function () {
          clearTimeout(timer);
          var error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      }
    });
  }

  async function refreshActiveWorkspace(request, preserveAnalysis, expectedWorkspaceId, expectedChangeRequest) {
    var workspaceId = expectedWorkspaceId || state.activeWorkspaceId;
    if (!workspaceId) return state;
    var payload = await api().getWorkspace(workspaceId);
    if (request != null && request !== analysisRequest) return state;
    if (expectedWorkspaceId && state.activeWorkspaceId !== expectedWorkspaceId) return state;
    if (expectedChangeRequest != null && expectedChangeRequest !== changeRequest) return state;
    var analysisBefore = state.analysis;
    acceptWorkspacePayload(payload);
    if (preserveAnalysis && state.analysis.status === 'idle') state.analysis = analysisBefore;
    state.phase = 'ready';
    state.operation = 'idle';
    emit();
    return state;
  }

  async function pollAnalysis(request, signal, workspaceId, documentId) {
    for (var attempt = 0; attempt < 30; attempt++) {
      await wait(Math.min(3000, 1100 + attempt * 120), signal);
      if (request !== analysisRequest || state.activeWorkspaceId !== workspaceId ||
          !state.document || state.document.id !== documentId) return state;
      var realtime = await api().realtimeState(workspaceId, documentId);
      if (request !== analysisRequest || state.activeWorkspaceId !== workspaceId ||
          !state.document || state.document.id !== documentId) return state;
      var backendState = realtime && realtime.state;
      var status = backendState && backendState.analysis_state;
      if (status === 'ready') {
        await refreshActiveWorkspace(request, false, workspaceId);
        if (request !== analysisRequest || state.activeWorkspaceId !== workspaceId ||
            !state.document || state.document.id !== documentId) return state;
        state.analysis.status = 'ready';
        state.analysis.hasResult = true;
        state.analysis.reason = '';
        emit();
        return state;
      }
      if (status === 'error') throw new Error('analysis_failed');
      state.analysis = {
        status: 'buffering',
        depth: state.analysis.depth,
        reason: 'Analysis is still running on the backend.',
        result: state.analysis.result,
        hasResult: state.analysis.hasResult
      };
      emit();
    }
    await refreshActiveWorkspace(request, false, workspaceId);
    if (request !== analysisRequest || state.activeWorkspaceId !== workspaceId ||
        !state.document || state.document.id !== documentId) return state;
    if (state.analysis.status !== 'buffering') return state;
    state.analysis.status = 'error';
    state.analysis.reason = 'Analysis is taking longer than expected. Retry to check the backend again.';
    state.phase = 'ready';
    emit();
    return state;
  }

  function resumePendingAnalysis() {
    if (!hasActiveWorkspace() || state.analysis.status !== 'buffering') return;
    if (typeof api().realtimeState !== 'function') {
      state.analysis.status = 'error';
      state.analysis.reason = 'Live analysis status is unavailable in the connected adapter.';
      emit();
      return;
    }
    if (analysisController) analysisController.abort();
    analysisController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var request = analysisRequest;
    var workspaceId = state.activeWorkspaceId;
    var documentId = state.document.id;
    var signal = analysisController && analysisController.signal;
    pollAnalysis(request, signal, workspaceId, documentId).catch(function (error) {
      if ((error && error.name === 'AbortError') || request !== analysisRequest ||
          state.activeWorkspaceId !== workspaceId) return;
      state.analysis = {
        status: 'error',
        depth: state.analysis.depth,
        reason: safeMessage(error, 'Live analysis status could not be refreshed.'),
        result: state.analysis.result,
        hasResult: state.analysis.hasResult
      };
      state.phase = 'ready';
      emit();
    });
  }

  async function analyse(depth) {
    if (!hasActiveWorkspace() || state.phase === 'conflict') return state;
    if (latestSavePromise && state.save.status === 'saving') {
      try { await latestSavePromise; } catch (e) { return state; }
    }
    if (state.save.status === 'conflict' || state.save.status === 'error') return state;

    if (analysisController) analysisController.abort();
    analysisController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var signal = analysisController && analysisController.signal;
    var request = ++analysisRequest;
    var workspaceId = state.workspace.id;
    var documentId = state.document.id;
    state.analysis = {
      status: 'analysing',
      depth: depth || 'fast',
      reason: '',
      result: null,
      hasResult: state.analysis.hasResult
    };
    state.phase = 'analysing';
    emit();

    try {
      var response = await api().analyse({
        workspaceId: workspaceId,
        documentId: documentId,
        depth: depth || 'fast'
      }, signal);
      if (request !== analysisRequest || state.activeWorkspaceId !== workspaceId ||
          !state.document || state.document.id !== documentId) return state;
      if (analysisIsPending(response)) {
        state.analysis.status = 'buffering';
        state.analysis.reason = 'Analysis is running on the backend.';
        emit();
        if (typeof api().realtimeState !== 'function') {
          state.analysis.status = 'error';
          state.analysis.reason = 'Live analysis status is unavailable in the connected adapter.';
          state.phase = 'ready';
          emit();
          return state;
        }
        return await pollAnalysis(request, signal, workspaceId, documentId);
      }

      var result = response && response.result ? response.result : response;
      /* The model response identifies issues by `fingerprint`, which is not
         an addressable id — live_intelligence_issues rows carry a real
         `id` (uuid) that Apply/Quiet require. Never render or act on the
         raw response's issue objects; always re-read the persisted rows. */
      state.analysis = {
        status: 'ready',
        depth: depth || 'fast',
        reason: '',
        result: result || null,
        hasResult: true
      };
      state.phase = 'ready';
      emit();
      await refreshActiveWorkspace(request, true, workspaceId);
      return state;
    } catch (error) {
      if ((error && (error.name === 'AbortError' || error.code === 'aborted')) || request !== analysisRequest) return state;
      state.analysis = {
        status: 'error',
        depth: depth || 'fast',
        reason: safeMessage(error, 'Analysis is unavailable.'),
        result: null,
        hasResult: state.analysis.hasResult
      };
      state.phase = 'ready';
      emit();
      throw error;
    }
  }

  async function ask(question, context) {
    var value = String(question || '').trim();
    if (!value || !hasActiveWorkspace() || state.phase === 'conflict') return null;
    if (latestSavePromise && state.save.status === 'saving') {
      try { await latestSavePromise; } catch (e) { return null; }
    }
    if (!hasActiveWorkspace() || state.save.status === 'conflict' || state.save.status === 'error') return null;
    var request = ++askRequest;
    var workspaceId = state.workspace.id;
    var documentId = state.document.id;
    state.ask = { status: 'asking', answer: '', reason: '' };
    state.phase = 'asking';
    emit();
    try {
      var response = await api().ask({
        workspaceId: workspaceId,
        documentId: documentId,
        sectionId: context && context.sectionId ? context.sectionId : null,
        question: value
      });
      if (request !== askRequest || state.activeWorkspaceId !== workspaceId) return null;
      /* api().ask() resolves through li-api's reasoning() wrapper:
         {pending, status, result, jobId}. The answer text lives at
         result.answer, never at the top level — reading response.answer
         directly always reads undefined against the deployed contract. */
      if (response && response.pending === true) throw new Error('analysis_timeout');
      var payload = response && response.result ? response.result : response;
      var answer = payload && (payload.answer || payload.message || payload.reply || payload.text);
      answer = String(answer == null ? '' : answer).trim();
      if (!answer) throw new Error('empty_response');
      state.ask = { status: 'ready', answer: answer, reason: '' };
      state.phase = 'ready';
      emit();
      return answer;
    } catch (error) {
      if (request !== askRequest || state.activeWorkspaceId !== workspaceId) return null;
      state.ask = { status: 'error', answer: '', reason: safeMessage(error, 'No response was returned. Try again.') };
      state.phase = 'ready';
      emit();
      throw error;
    }
  }

  async function quietIssue(issueId) {
    if (!issueId || !hasActiveWorkspace() || state.phase === 'conflict') return state;
    var request = ++changeRequest;
    var workspaceId = state.activeWorkspaceId;
    var quietConfirmed = false;
    setOperation('updating-issue', '');
    try {
      await api().quietIssue(issueId);
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      quietConfirmed = true;
      await refreshActiveWorkspace(null, false, workspaceId, request);
      return state;
    } catch (error) {
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      if (quietConfirmed) {
        state.syncRequired = true;
        state.connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'unavailable';
        state.operation = 'idle';
        state.operationError = 'The issue was quieted, but the current workspace could not be reloaded.';
        setPhase('error', 'The issue was quieted, but the current workspace could not be reloaded. Reconnect before continuing.', 'idle');
        throw error;
      }
      state.operation = 'idle';
      state.operationError = safeMessage(error, 'The issue state could not be updated.');
      emit();
      throw error;
    }
  }

  async function applyIssue(issueId) {
    if (!issueId || !hasActiveWorkspace() || state.phase === 'conflict' || state.revision == null) return state;
    if (latestSavePromise && state.save.status === 'saving') {
      try { await latestSavePromise; } catch (e) { return state; }
    }
    if (!hasActiveWorkspace() || state.save.status === 'conflict' || state.save.status === 'error') return state;
    var request = ++changeRequest;
    var workspaceId = state.activeWorkspaceId;
    var applyConfirmed = false;
    state.change = { status: 'preparing', proposal: null, lastProposalId: state.change.lastProposalId, reason: '' };
    state.phase = 'applying';
    emit();
    try {
      var requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null;
      var preview = await api().previewChange({
        issueId: issueId,
        expectedRevision: state.revision,
        clientRequestId: requestId
      });
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      if (preview && preview.status === 'conflict') {
        state.change = { status: 'conflict', proposal: null, lastProposalId: state.change.lastProposalId, reason: 'This document changed elsewhere. Reload the current version before applying a change.' };
        state.phase = 'conflict';
        emit();
        return state;
      }
      var proposal = preview && preview.proposal ? preview.proposal : null;
      var proposalId = proposal && proposal.id ? proposal.id : (preview && preview.proposal_id);
      var applyAllowed = proposal ? proposal.apply_allowed === true : preview && preview.apply_allowed === true;
      if (!proposalId || !applyAllowed) {
        state.change = {
          status: 'manual',
          proposal: proposal,
          lastProposalId: state.change.lastProposalId,
          reason: 'This suggestion requires a manual edit. The backend did not authorise automatic application.'
        };
        state.phase = 'ready';
        emit();
        return state;
      }

      state.change = { status: 'applying', proposal: proposal, lastProposalId: state.change.lastProposalId, reason: '' };
      emit();
      var result = await api().applyChange(proposalId, state.revision);
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      if (result && result.status === 'conflict') {
        state.change = { status: 'conflict', proposal: proposal, lastProposalId: state.change.lastProposalId, reason: 'This document changed elsewhere. Reload the current version before applying a change.' };
        state.phase = 'conflict';
        emit();
        return state;
      }
      if (!result || result.status !== 'applied') {
        var applyStatus = result && result.status;
        state.change = {
          status: applyStatus === 'manual_only' ? 'manual' : 'error',
          proposal: proposal,
          lastProposalId: state.change.lastProposalId,
          reason: applyStatus === 'manual_only'
            ? 'The backend requires this suggestion to be edited manually.'
            : (applyStatus === 'stale'
              ? 'This suggestion is no longer current. Analyse the latest writing again.'
              : (applyStatus === 'unavailable'
                ? 'This change is no longer available.'
                : 'The backend did not confirm that the change was applied.'))
        };
        state.phase = 'ready';
        emit();
        return state;
      }
      applyConfirmed = true;
      await refreshActiveWorkspace(null, false, workspaceId, request);
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      state.change = { status: 'applied', proposal: proposal, lastProposalId: proposalId, reason: '' };
      emit();
      return state;
    } catch (error) {
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      if (applyConfirmed) {
        state.syncRequired = true;
        state.connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'unavailable';
        state.change = {
          status: 'sync-error',
          proposal: proposal,
          lastProposalId: proposalId,
          reason: 'The change was applied, but the current version could not be loaded. Reconnect before continuing.'
        };
        setPhase('error', state.change.reason, 'idle');
        throw error;
      }
      if (isConflictError(error)) {
        state.change = {
          status: 'conflict',
          proposal: state.change.proposal,
          lastProposalId: state.change.lastProposalId,
          reason: 'This document changed elsewhere. Reload the current version before applying a change.'
        };
        state.phase = 'conflict';
        emit();
        return state;
      }
      state.change = {
        status: 'error',
        proposal: state.change.proposal,
        lastProposalId: state.change.lastProposalId,
        reason: safeMessage(error, 'That change could not be applied.')
      };
      state.phase = 'ready';
      emit();
      throw error;
    }
  }

  async function undoLastChange() {
    var proposalId = state.change.lastProposalId;
    if (!proposalId || !hasActiveWorkspace() || state.phase === 'conflict') return state;
    if (latestSavePromise && state.save.status === 'saving') {
      try { await latestSavePromise; } catch (e) { return state; }
    }
    if (!hasActiveWorkspace() || state.save.status === 'conflict' || state.save.status === 'error') return state;
    var request = ++changeRequest;
    var workspaceId = state.activeWorkspaceId;
    var undoConfirmed = false;
    state.change.status = 'undoing';
    state.change.reason = '';
    state.phase = 'applying';
    emit();
    try {
      var result = await api().undoChange(proposalId, state.revision);
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      if (result && result.status === 'conflict') {
        state.change.status = 'conflict';
        state.change.reason = 'The document changed after this suggestion was applied. Reload the current version before undoing.';
        state.phase = 'conflict';
        emit();
        return state;
      }
      if (!result || result.status !== 'undone') {
        var undoStatus = result && result.status;
        state.change.status = 'error';
        state.change.reason = undoStatus === 'unavailable'
          ? 'Undo is no longer available for this change.'
          : (undoStatus === 'stale'
            ? 'This document changed after the suggestion was applied. Reload the current version before undoing.'
            : 'The backend did not confirm that the change was undone.');
        state.phase = 'ready';
        emit();
        return state;
      }
      undoConfirmed = true;
      await refreshActiveWorkspace(null, false, workspaceId, request);
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      state.change = { status: 'undone', proposal: null, lastProposalId: null, reason: '' };
      emit();
      return state;
    } catch (error) {
      if (request !== changeRequest || state.activeWorkspaceId !== workspaceId) return state;
      if (undoConfirmed) {
        state.syncRequired = true;
        state.connection = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'unavailable';
        state.change = {
          status: 'sync-error',
          proposal: state.change.proposal,
          lastProposalId: proposalId,
          reason: 'The change was undone, but the current version could not be loaded. Reconnect before continuing.'
        };
        setPhase('error', state.change.reason, 'idle');
        throw error;
      }
      if (isConflictError(error)) {
        state.change.status = 'conflict';
        state.change.reason = 'The document changed after this suggestion was applied. Reload the current version before undoing.';
        state.phase = 'conflict';
        emit();
        return state;
      }
      state.change.status = 'error';
      state.change.reason = safeMessage(error, 'That change could not be undone.');
      state.phase = 'ready';
      emit();
      throw error;
    }
  }

  V.liApp = {
    state: state,
    onChange: onChange,
    supports: supports,
    boot: boot,
    reconnect: reconnect,
    loadWorkspaces: loadWorkspaces,
    openWorkspace: openWorkspace,
    createWorkspace: createWorkspace,
    renameWorkspace: renameWorkspace,
    archiveWorkspace: archiveWorkspace,
    saveDocument: saveDocument,
    analyse: analyse,
    ask: ask,
    quietIssue: quietIssue,
    applyIssue: applyIssue,
    undoLastChange: undoLastChange,
    reloadCurrentVersion: async function () {
      if (!state.activeWorkspaceId) return state;
      var draft = state.conflictDraft;
      try {
        var result = await openWorkspace(state.activeWorkspaceId, {
          operation: 'reloading',
          reason: 'Loading the current server version…'
        });
        queuedSave = null;
        state.conflictDraft = null;
        state.documentEpoch += 1;
        state.save = { status: 'idle', reason: '' };
        if (state.change.status === 'conflict') {
          state.change = { status: 'idle', proposal: null, lastProposalId: null, reason: '' };
        }
        state.operationError = '';
        emit();
        return result;
      } catch (error) {
        state.conflictDraft = draft;
        state.phase = 'conflict';
        state.save = {
          status: 'conflict',
          reason: draft
            ? 'This document changed elsewhere. Your unsaved text remains in this tab.'
            : 'This workspace changed elsewhere. Reload the current version to continue.'
        };
        emit();
        throw error;
      }
    },
    isLive: function () { return hasActiveWorkspace() && state.connection === 'online'; },
    creationDefaults: function () {
      var task = state.task || {};
      var meta = task.meta && typeof task.meta === 'object' ? task.meta : {};
      var proofContract = task.proofContract && typeof task.proofContract === 'object'
        ? task.proofContract : (task.proof_contract && typeof task.proof_contract === 'object'
          ? task.proof_contract : {});
      return {
        taskId: state.taskId,
        linkedTaskId: state.taskId,
        title: task.task_title || task.title || '',
        taskDescription: task.task_description || task.description || meta.task_description ||
          meta.description || task.task_title || task.title || '',
        desiredOutcome: task.desired_outcome || task.outcome || meta.desired_outcome ||
          meta.outcome || proofContract.desired_outcome || proofContract.outcome || ''
      };
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('offline', function () {
      state.connection = 'offline';
      if (!hasActiveWorkspace() && state.phase !== 'conflict' && state.phase !== 'empty' &&
          state.phase !== 'signed-out') {
        state.phase = 'error';
        state.reason = 'You are offline. Reconnect to continue.';
      }
      emit();
    });
    window.addEventListener('online', function () {
      if (state.connection !== 'offline') return;
      if (state.phase === 'conflict') {
        state.connection = 'online';
        emit();
        return;
      }
      if (state.syncRequired) {
        state.connection = 'unavailable';
        emit();
        return;
      }
      if (hasActiveWorkspace()) {
        state.connection = 'online';
        emit();
        return;
      }
      reconnect();
    });
  }

  /* ── DO NOT LOAD A WORKSPACE NOBODY IS LOOKING AT ──────────────────────
     live-intelligence.html hosts three different surfaces: the workspace app,
     the Live Call and the Practice Call. The call surfaces are full-screen
     overlays, so when one is open the workspace behind it is invisible -- yet
     it still booted, still fetched, and on a deployment without that backend
     still failed, putting a network error in the console of every single
     call. A screen the founder cannot see should not be making requests. */
  function callSurfaceOpen() {
    try {
      var q = new URLSearchParams(location.search);
      return !!(q.get('call') || q.get('practice-call') || q.get('practice'));
    } catch (e) { return false; }
  }

  if (callSurfaceOpen()) {
    /* 'unavailable' is one of the four states this app already defines and
       every consumer already handles: it locks mutations and renders nothing
       live. Inventing a fifth state for "we deliberately did not load" would
       have been a silent no-op in every one of those checks. */
    state.connection = 'unavailable';
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(); });
  } else {
    boot();
  }
})(window.VISION);
