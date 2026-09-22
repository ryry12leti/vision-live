/* ═══════════════════════════════════════════════════════════════
   Live Intelligence page controller
   ---------------------------------------------------------------
   Renders the approved workspace UI from window.VISION.liApp state.
   No workspace, document, issue, analysis, or reply is created locally.
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var app = V.liApp || null;
  var api = V.liApi || null;
  var state = app && app.state ? app.state : {
    phase: 'error',
    connection: 'unavailable',
    reason: 'Live Intelligence is not connected in this build.',
    workspaces: [],
    issues: []
  };
  var renderedDocumentEpoch = -1;
  var renderedWorkspaceId = null;
  var editorModel = null;
  var currentSectionId = null;
  var saveTimer = null;
  var analysisTimer = null;
  var pendingDraft = null;
  var pendingSavePromise = null;
  var createTaskId = null;
  var createSubmitting = false;
  var createdWorkspaceAwaitingLoad = null;
  var renameSubmitting = false;
  var archiveSubmitting = false;
  var deepOpen = false;
  var lastFocusedElement = null;
  var lastAppliedProposalId = null;
  var pendingAction = null;
  var askHistory = Object.create(null);

  function $(selector) { return document.querySelector(selector); }
  function $$(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function text(selector, value) {
    var element = typeof selector === 'string' ? $(selector) : selector;
    if (element) element.textContent = value == null ? '' : String(value);
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }
  function callQuietly(promise) {
    if (promise && typeof promise.catch === 'function') promise.catch(function () {});
    return promise;
  }
  function hasMethod(target, name) { return !!(target && typeof target[name] === 'function'); }
  function supportsApp(name) {
    if (!app) return false;
    if (hasMethod(app, 'supports')) return hasMethod(app, name) && app.supports(name);
    return hasMethod(app, name);
  }
  function hasWorkspace() { return !!(state.workspace && state.document && state.activeWorkspaceId); }
  function phaseBusy() {
    return ['booting', 'loading-list', 'creating', 'loading-workspace', 'saving',
      'analysing', 'applying', 'asking'].indexOf(state.phase) > -1;
  }
  function wordCount(value) {
    return (String(value || '').trim().match(/\b[\w’'-]+\b/g) || []).length;
  }
  function humanLabel(value) {
    return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }
  function firstText(value) {
    if (typeof value === 'string') return value.trim();
    if (value == null) return '';
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        var item = firstText(value[i]);
        if (item) return item;
      }
      return '';
    }
    if (typeof value === 'object') {
      return firstText(value.text || value.title || value.label || value.summary || value.description);
    }
    return String(value);
  }
  function listValues(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(firstText).filter(Boolean);
    if (typeof value === 'object') {
      return Object.keys(value).map(function (key) {
        var item = firstText(value[key]);
        return item ? humanLabel(key) + ': ' + item : '';
      }).filter(Boolean);
    }
    var single = firstText(value);
    return single ? [single] : [];
  }
  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(undefined, {
        day: 'numeric', month: 'short', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
      }).format(date);
    } catch (e) {
      return date.toLocaleDateString();
    }
  }

  function showModal(element) {
    if (!element) return;
    lastFocusedElement = document.activeElement;
    Array.prototype.forEach.call(document.body.children, function (child) {
      if (child === element || child.hasAttribute('inert')) return;
      child.setAttribute('data-li-modal-inert', '');
      child.setAttribute('inert', '');
    });
    element.classList.add('show');
    element.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function hideModal(element) {
    if (!element) return;
    element.classList.remove('show');
    element.setAttribute('aria-hidden', 'true');
    Array.prototype.forEach.call(document.querySelectorAll('[data-li-modal-inert]'), function (child) {
      child.removeAttribute('data-li-modal-inert');
      child.removeAttribute('inert');
    });
    if (!document.querySelector('.modal.show')) document.body.style.overflow = '';
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      try { lastFocusedElement.focus(); } catch (e) {}
    }
  }

  function setFormError(selector, message) {
    var element = $(selector);
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('show', !!message);
  }

  function toast(message) {
    var element = $('#toast');
    if (!element) return;
    element.textContent = message || '';
    element.classList.add('show');
    clearTimeout(element._hideTimer);
    element._hideTimer = setTimeout(function () { element.classList.remove('show'); }, 2600);
  }

  function reconnectFrontend() {
    if (!app || !hasMethod(app, 'reconnect')) return Promise.resolve();
    var preserveDraft = !!(pendingDraft || pendingSavePromise || (state.save && state.save.status === 'error'));
    return Promise.resolve(app.reconnect({ preserveWorkspace: preserveDraft })).then(function () {
      return pendingDraft && state.connection === 'online' ? flushPendingDraft() : null;
    }).catch(function () {});
  }

  function openDrawer() {
    var drawer = $('#drawer');
    if (!drawer) return;
    drawer.removeAttribute('inert');
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    $('#drawerBackdrop').classList.add('show');
    $('#drawerToggle').setAttribute('aria-expanded', 'true');
    setTimeout(function () {
      var close = $('#drawerClose');
      if (close) close.focus();
    }, 20);
  }

  function closeDrawer(restoreFocus) {
    var drawer = $('#drawer');
    if (!drawer) return;
    var wasOpen = drawer.classList.contains('open');
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    $('#drawerBackdrop').classList.remove('show');
    $('#drawerToggle').setAttribute('aria-expanded', 'false');
    if (wasOpen && restoreFocus !== false) {
      try { $('#drawerToggle').focus(); } catch (e) {}
    }
  }

  function openNewWorkspace() {
    var defaults = app && hasMethod(app, 'creationDefaults') ? app.creationDefaults() : {};
    createTaskId = (defaults && (defaults.taskId || defaults.linkedTaskId)) || currentUrlTaskId();
    $('#workspaceTitle').value = defaults && defaults.title ? defaults.title : '';
    $('#workspaceDescription').value = defaults && defaults.taskDescription ? defaults.taskDescription : '';
    $('#workspaceOutcome').value = defaults && defaults.desiredOutcome ? defaults.desiredOutcome : '';
    $('#workspaceIntensity').value = 'balanced';
    setFormError('#workspaceFormError', '');
    showModal($('#workspaceModal'));
    setTimeout(function () {
      var target = $('#workspaceDescription').value ? $('#workspaceTitle') : $('#workspaceDescription');
      if (target) target.focus();
    }, 20);
  }

  function currentUrlTaskId() {
    try {
      var params = new URLSearchParams(location.search);
      var value = params.get('task_id') || params.get('taskId');
      if (V.nav && hasMethod(V.nav, 'safeTaskId')) return V.nav.safeTaskId(value);
      return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null;
    } catch (e) {
      return null;
    }
  }

  function createThroughAdapter(payload) {
    if (supportsApp('createWorkspace')) return app.createWorkspace(payload);
    if (api && hasMethod(api, 'createWorkspace') && app && hasMethod(app, 'loadWorkspaces')) {
      return Promise.resolve(api.createWorkspace(payload)).then(function (created) {
        var workspaceId = created && (created.workspace_id || created.id);
        if (!workspaceId) {
          throw new Error('workspace_loader_unavailable');
        }
        createdWorkspaceAwaitingLoad = workspaceId;
        return app.loadWorkspaces({ openId: workspaceId, operation: 'creating' }).then(function (result) {
          createdWorkspaceAwaitingLoad = null;
          return result;
        });
      });
    }
    return Promise.reject(new Error('adapter_unavailable'));
  }

  function flushPendingDraft() {
    clearTimeout(saveTimer);
    clearTimeout(analysisTimer);
    if (state.phase === 'conflict') return Promise.reject(new Error('revision_conflict'));
    var pending = pendingDraft ? saveCurrentDocument() : pendingSavePromise;
    if (!pending) return Promise.resolve();
    return Promise.resolve(pending).then(function () {
      if (state.phase === 'conflict' || (state.save && state.save.status === 'error')) {
        throw new Error(state.phase === 'conflict' ? 'revision_conflict' : 'save_failed');
      }
      return pendingDraft || pendingSavePromise ? flushPendingDraft() : null;
    });
  }

  function afterCurrentDocumentSaved(action, failureMessage, options) {
    if (pendingAction) return Promise.reject(new Error('action_in_progress'));
    var token = { keepEditorActive: !!(options && options.keepEditorActive) };
    var saveComplete = false;
    pendingAction = token;
    render();
    return flushPendingDraft().then(function () {
      if (state.phase === 'conflict') throw new Error('revision_conflict');
      saveComplete = true;
      return action();
    }).catch(function (error) {
      if (!saveComplete && failureMessage) toast(failureMessage);
      throw error;
    }).finally(function () {
      if (pendingAction === token) {
        pendingAction = null;
        render();
      }
    });
  }

  function submitWorkspace(event) {
    event.preventDefault();
    var description = $('#workspaceDescription').value.trim();
    if (!description) {
      setFormError('#workspaceFormError', 'Tell Live Intelligence what you are working on.');
      $('#workspaceDescription').focus();
      return;
    }
    if (!supportsApp('createWorkspace') &&
        !(api && hasMethod(api, 'createWorkspace') && app && hasMethod(app, 'loadWorkspaces'))) {
      setFormError('#workspaceFormError', 'Live Intelligence is not connected in this build.');
      return;
    }
    var payload = {
      title: $('#workspaceTitle').value.trim() || null,
      taskDescription: description,
      desiredOutcome: $('#workspaceOutcome').value.trim() || null,
      feedbackIntensity: $('#workspaceIntensity').value,
      taskId: createTaskId || null
    };
    createSubmitting = true;
    setFormError('#workspaceFormError', '');
    renderOperationControls();
    Promise.resolve(flushPendingDraft()).then(function () {
      return createThroughAdapter(payload);
    }).then(function () {
      createSubmitting = false;
      hideModal($('#workspaceModal'));
      closeDrawer();
      renderOperationControls();
      setTimeout(focusEditorAtEnd, 70);
    }).catch(function (error) {
      createSubmitting = false;
      var message = error && error.message === 'adapter_unavailable'
        ? 'Live Intelligence is not connected in this build.'
        : (error && (error.message === 'revision_conflict' || error.message === 'save_failed')
          ? 'Resolve the current document save state before creating another workspace.'
        : (createdWorkspaceAwaitingLoad
          ? 'The workspace was created, but it could not be loaded. Reconnect to open it.'
          : (state.operationError || 'The workspace could not be created. Your form values are still here.')));
      setFormError('#workspaceFormError', message);
      renderOperationControls();
    });
  }

  function openRenameModal() {
    if (!hasWorkspace()) return;
    if (!supportsApp('renameWorkspace')) {
      toast('Rename is not supported by the connected adapter.');
      return;
    }
    $('#renameTitle').value = state.workspace.title || '';
    setFormError('#renameFormError', '');
    showModal($('#renameModal'));
    setTimeout(function () { $('#renameTitle').focus(); $('#renameTitle').select(); }, 20);
  }

  function submitRename(event) {
    event.preventDefault();
    var value = $('#renameTitle').value.trim();
    if (!value) {
      setFormError('#renameFormError', 'Enter a workspace name.');
      return;
    }
    renameSubmitting = true;
    renderOperationControls();
    Promise.resolve(afterCurrentDocumentSaved(function () {
      return app.renameWorkspace(value);
    })).then(function () {
      renameSubmitting = false;
      hideModal($('#renameModal'));
      renderOperationControls();
    }).catch(function () {
      renameSubmitting = false;
      setFormError('#renameFormError', state.operationError || 'The workspace could not be renamed.');
      renderOperationControls();
    });
  }

  function openArchiveModal() {
    if (!hasWorkspace()) return;
    if (!supportsApp('archiveWorkspace')) {
      toast('Archive is not supported by the connected adapter.');
      return;
    }
    text('#archiveWorkspaceName', state.workspace.title || '');
    setFormError('#archiveFormError', '');
    showModal($('#archiveModal'));
    setTimeout(function () { $('#archiveCancel').focus(); }, 20);
  }

  function confirmArchive() {
    archiveSubmitting = true;
    renderOperationControls();
    Promise.resolve(afterCurrentDocumentSaved(function () {
      return app.archiveWorkspace();
    })).then(function () {
      archiveSubmitting = false;
      hideModal($('#archiveModal'));
      renderOperationControls();
    }).catch(function () {
      archiveSubmitting = false;
      setFormError('#archiveFormError', state.operationError || 'The workspace could not be archived.');
      renderOperationControls();
    });
  }

  function renderOperationControls() {
    var createBusy = createSubmitting || state.phase === 'creating';
    var createdPending = !!(state.pendingWorkspaceId || createdWorkspaceAwaitingLoad);
    var renameBusy = renameSubmitting || state.operation === 'renaming';
    var archiveBusy = archiveSubmitting || state.operation === 'archiving';
    var workspaceMutationLocked = !!pendingAction || !!state.syncRequired ||
      (hasWorkspace() && state.connection !== 'online') ||
      ['booting', 'loading-list', 'loading-workspace', 'saving',
      'analysing', 'applying', 'asking', 'conflict'].indexOf(state.phase) > -1;
    $('#newWorkspace').disabled = createBusy || workspaceMutationLocked;
    $('#workspaceSubmit').disabled = createBusy || createdPending;
    text('#workspaceSubmit', createBusy ? 'Creating workspace…' : (createdPending ? 'Workspace created — reconnect' : 'Create workspace'));
    $('#workspaceModalClose').disabled = createBusy;
    $('#workspaceCancel').disabled = createBusy;
    $('#renameSubmit').disabled = renameBusy;
    text('#renameSubmit', renameBusy ? 'Saving name…' : 'Save name');
    $('#renameModalClose').disabled = renameBusy;
    $('#renameCancel').disabled = renameBusy;
    $('#archiveConfirm').disabled = archiveBusy;
    text('#archiveConfirm', archiveBusy ? 'Archiving…' : 'Archive workspace');
    $('#archiveModalClose').disabled = archiveBusy;
    $('#archiveCancel').disabled = archiveBusy;
  }

  function renderWorkspaceList() {
    var list = $('#workspaceList');
    if (!list) return;
    var query = String($('#workspaceSearch').value || '').trim().toLowerCase();
    var items = Array.isArray(state.workspaces) ? state.workspaces.slice() : [];
    var loading = state.phase === 'booting' || state.phase === 'loading-list';
    list.innerHTML = '';
    var hasListState = false;
    if (loading) {
      list.insertAdjacentHTML('beforeend', '<div class="workspace-list-state" role="status"><span class="mini-spinner" aria-hidden="true"></span><span>Loading workspaces…</span></div>');
      hasListState = true;
    } else if (state.phase === 'error') {
      list.insertAdjacentHTML('beforeend', '<div class="workspace-list-state" role="alert">' +
        escapeHtml(state.reason || 'Workspaces could not be loaded. Reconnect to try again.') + '</div>');
      hasListState = true;
    }
    var filtered = items.filter(function (workspace) {
      return !query || String(workspace.title || '').toLowerCase().indexOf(query) > -1;
    });
    if (!filtered.length) {
      if (!hasListState || query) {
        list.insertAdjacentHTML('beforeend', '<div class="workspace-list-state">' +
          escapeHtml(query ? 'No matching workspaces.' : 'No workspaces yet.') + '</div>');
      }
      return;
    }
    filtered.forEach(function (workspace) {
      var button = document.createElement('button');
      button.type = 'button';
      var isLoading = workspace.id === state.loadingWorkspaceId;
      button.className = 'workspace-item' +
        (workspace.id === state.activeWorkspaceId ? ' active' : '') +
        (isLoading ? ' loading' : '');
      button.setAttribute('aria-current', workspace.id === state.activeWorkspaceId ? 'true' : 'false');
      if (isLoading) button.setAttribute('aria-busy', 'true');
      var title = document.createElement('span');
      title.className = 'wi-title';
      title.textContent = workspace.title || '';
      button.appendChild(title);
      var date = formatDate(workspace.last_opened_at || workspace.updated_at);
      if (date) {
        var meta = document.createElement('span');
        meta.className = 'wi-meta';
        meta.textContent = date;
        button.appendChild(meta);
      }
      var statusValue = isLoading ? 'Loading workspace…'
        : (workspace.current_stage || workspace.status || workspace.setup_status);
      if (statusValue) {
        var status = document.createElement('span');
        status.className = 'wi-state';
        status.innerHTML = '<i aria-hidden="true"></i>';
        status.appendChild(document.createTextNode(humanLabel(statusValue)));
        button.appendChild(status);
      }
      button.addEventListener('click', function () {
        if (!app || !hasMethod(app, 'openWorkspace')) {
          toast('Live Intelligence is not connected in this build.');
          return;
        }
        closeDrawer(false);
        selectWorkspace(workspace.id);
      });
      list.appendChild(button);
    });
  }

  function renderWorkspaceTools() {
    var tools = $('#workspaceTools');
    if (!tools) return;
    tools.classList.toggle('show', hasWorkspace());
    var renameSupported = supportsApp('renameWorkspace');
    var archiveSupported = supportsApp('archiveWorkspace');
    var mutationLocked = !!pendingAction || !!state.syncRequired || state.connection !== 'online' ||
      ['booting', 'loading-list', 'creating', 'loading-workspace', 'saving',
      'analysing', 'applying', 'asking', 'conflict'].indexOf(state.phase) > -1;
    $('#renameWorkspace').disabled = !renameSupported || mutationLocked;
    $('#renameWorkspace').title = renameSupported ? '' : 'Rename is not supported by the connected adapter.';
    $('#renameWorkspace').setAttribute('aria-label', renameSupported ? 'Rename workspace' : 'Rename workspace unavailable: adapter does not support rename');
    $('#archiveWorkspace').disabled = !archiveSupported || mutationLocked;
    $('#archiveWorkspace').title = archiveSupported ? '' : 'Archive is not supported by the connected adapter.';
    $('#archiveWorkspace').setAttribute('aria-label', archiveSupported ? 'Archive workspace' : 'Archive workspace unavailable: adapter does not support archive');
    var note = $('#workspaceCapabilityNote');
    var messages = [];
    if (!renameSupported) messages.push('Rename is unavailable.');
    if (!archiveSupported) messages.push('Archive is unavailable.');
    note.textContent = messages.length ? messages.join(' ') + ' The connected adapter does not support this action.' : '';
    note.classList.toggle('show', messages.length > 0 && hasWorkspace());
  }

  function clearContext() {
    text('#memoryText', '');
    text('#detectedChips', '');
    text('#focusPills', '');
    text('#approachSummary', '');
    text('#approachSteps', '');
    text('#contextSummary', 'No workspace');
    $('#contextCard').style.display = 'none';
  }

  function renderContext() {
    if (!hasWorkspace()) {
      clearContext();
      return;
    }
    var workspace = state.workspace || {};
    var workspaceState = state.workspaceState || {};
    var compressed = workspaceState.compressed_context || {};
    var memory = firstText(workspace.memory || compressed.memory || workspaceState.recurring_patterns);
    var detected = listValues(workspace.detected || workspaceState.detected_context);
    var strengths = listValues(workspace.focus || workspaceState.known_strengths);
    var strategy = workspaceState.active_strategy || workspace.active_strategy || null;
    var strategySummary = firstText(workspace.approach_summary || (strategy && strategy.summary));
    var steps = listValues(workspace.approach || (strategy && (strategy.steps || strategy.actions)));
    text('#memoryText', memory);
    var detectedRoot = $('#detectedChips');
    detectedRoot.innerHTML = '';
    detected.forEach(function (value) {
      var chip = document.createElement('span');
      chip.className = 'context-chip';
      chip.textContent = value;
      detectedRoot.appendChild(chip);
    });
    var strengthsRoot = $('#focusPills');
    strengthsRoot.innerHTML = '';
    strengths.forEach(function (value) {
      var chip = document.createElement('span');
      chip.className = 'context-chip';
      chip.textContent = value;
      strengthsRoot.appendChild(chip);
    });
    text('#approachSummary', strategySummary);
    var stepsRoot = $('#approachSteps');
    stepsRoot.innerHTML = '';
    steps.forEach(function (value, index) {
      var row = document.createElement('div');
      row.className = 'context-step';
      row.innerHTML = '<i>' + (index + 1) + '</i><span></span>';
      row.querySelector('span').textContent = value;
      stepsRoot.appendChild(row);
    });
    var hasContext = !!(memory || detected.length || strengths.length || strategySummary || steps.length);
    $('#contextCard').style.display = hasContext ? '' : 'none';
    var issueCount = openIssues().length;
    text('#contextSummary', issueCount ? issueCount + ' open issue' + (issueCount === 1 ? '' : 's') : (hasContext ? 'Context loaded' : 'No context yet'));
  }

  function activeDocumentParts(documentRecord) {
    var source = null;
    var structureKey = null;
    var parsed = null;
    if (Array.isArray(documentRecord.sections)) {
      source = documentRecord.sections;
      structureKey = 'sections';
    } else if (Array.isArray(documentRecord.blocks)) {
      source = documentRecord.blocks;
      structureKey = 'blocks';
    } else if (Array.isArray(documentRecord.content)) {
      source = documentRecord.content;
      parsed = documentRecord.content;
      structureKey = 'array';
    } else if (documentRecord.content && typeof documentRecord.content === 'object') {
      parsed = documentRecord.content;
      if (Array.isArray(parsed.sections)) {
        source = parsed.sections;
        structureKey = 'sections';
      } else if (Array.isArray(parsed.blocks)) {
        source = parsed.blocks;
        structureKey = 'blocks';
      }
    }
    if (!source && documentRecord.content_format === 'json' && typeof documentRecord.content === 'string') {
      try {
        parsed = JSON.parse(documentRecord.content);
        if (Array.isArray(parsed)) {
          source = parsed;
          structureKey = 'array';
        } else if (parsed && Array.isArray(parsed.sections)) {
          source = parsed.sections;
          structureKey = 'sections';
        } else if (parsed && Array.isArray(parsed.blocks)) {
          source = parsed.blocks;
          structureKey = 'blocks';
        }
      } catch (e) { parsed = null; }
    }
    if (!source || !source.length) {
      return {
        structured: false,
        parsed: null,
        structureKey: null,
        structureSource: null,
        parts: [{
          id: documentRecord.id,
          title: '',
          content: documentRecord.content != null ? String(documentRecord.content)
            : (documentRecord.plain_text != null ? String(documentRecord.plain_text) : ''),
          format: documentRecord.content_format || 'plain_text',
          source: documentRecord
        }]
      };
    }
    return {
      structured: true,
      parsed: parsed,
      structureKey: structureKey,
      structureSource: source,
      parts: source.map(function (part, index) {
        var content = part && part.content != null ? part.content
          : (part && part.plain_text != null ? part.plain_text
            : (part && part.text != null ? part.text : (part && part.html != null ? part.html : '')));
        return {
          id: (part && (part.id || part.section_id || part.block_id)) || (documentRecord.id + ':' + index),
          backendId: part && (part.id || part.section_id || part.block_id) || null,
          title: part && (part.title || part.label || part.name) || '',
          content: String(content == null ? '' : content),
          format: part && part.html != null ? 'html' : ((part && part.content_format) || documentRecord.content_format || 'plain_text'),
          source: part || {}
        };
      })
    };
  }

  function sanitiseHtml(value) {
    var template = document.createElement('template');
    template.innerHTML = String(value || '');
    var blocked = template.content.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,meta,link,base');
    Array.prototype.forEach.call(blocked, function (element) { element.remove(); });
    var allowed = ['A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DIV', 'EM', 'H1', 'H2', 'H3',
      'H4', 'H5', 'H6', 'HR', 'I', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'U', 'UL'];
    Array.prototype.forEach.call(template.content.querySelectorAll('*'), function (element) {
      if (allowed.indexOf(element.tagName) < 0) {
        var parent = element.parentNode;
        if (!parent) return;
        while (element.firstChild) parent.insertBefore(element.firstChild, element);
        parent.removeChild(element);
        return;
      }
      Array.prototype.slice.call(element.attributes).forEach(function (attribute) {
        var name = attribute.name.toLowerCase();
        if (element.tagName !== 'A' || (name !== 'href' && name !== 'title')) {
          element.removeAttribute(attribute.name);
          return;
        }
        if (name === 'href') {
          var href = String(attribute.value || '').trim();
          if (!/^(https?:|mailto:|#)/i.test(href)) element.removeAttribute(attribute.name);
        }
      });
      if (element.tagName === 'A' && element.hasAttribute('href')) element.setAttribute('rel', 'noopener noreferrer');
    });
    return template.innerHTML;
  }

  function renderPartContent(element, part) {
    if (part.format === 'html') element.innerHTML = sanitiseHtml(part.content);
    else element.textContent = part.content;
  }

  function renderDocument() {
    if (!hasWorkspace()) return;
    if (renderedDocumentEpoch === state.documentEpoch && renderedWorkspaceId === state.activeWorkspaceId) {
      setEditorEditable();
      renderMetrics();
      return;
    }
    renderedDocumentEpoch = state.documentEpoch;
    renderedWorkspaceId = state.activeWorkspaceId;
    editorModel = activeDocumentParts(state.document);
    currentSectionId = editorModel.structured && editorModel.parts[0] ? editorModel.parts[0].id : null;
    var root = $('#documentRoot');
    root.innerHTML = '';
    if (state.document.title) {
      var title = document.createElement('h1');
      title.className = 'doc-title';
      title.textContent = state.document.title;
      root.appendChild(title);
    }
    if (state.document.document_type) {
      var subtitle = document.createElement('p');
      subtitle.className = 'doc-subtitle';
      subtitle.textContent = humanLabel(state.document.document_type);
      root.appendChild(subtitle);
    }
    editorModel.parts.forEach(function (part, index) {
      var section = document.createElement('section');
      section.className = 'document-section';
      section.dataset.sectionId = part.id;
      section.dataset.partIndex = String(index);
      if (editorModel.structured && part.title) {
        var label = document.createElement('div');
        label.className = 'section-label';
        label.textContent = part.title;
        section.appendChild(label);
      }
      var writing = document.createElement('div');
      writing.className = 'writing-block';
      writing.contentEditable = 'true';
      writing.spellcheck = true;
      writing.dataset.partIndex = String(index);
      writing.setAttribute('role', 'textbox');
      writing.setAttribute('aria-multiline', 'true');
      writing.setAttribute('aria-label', part.title ? 'Edit ' + part.title : 'Edit document');
      renderPartContent(writing, part);
      writing.addEventListener('focus', function () {
        currentSectionId = editorModel.structured ? part.id : null;
        renderSectionState();
      });
      writing.addEventListener('input', handleEditorInput);
      section.appendChild(writing);
      if (!part.content) {
        var empty = document.createElement('p');
        empty.className = 'empty-writing';
        empty.textContent = 'Begin writing here.';
        section.appendChild(empty);
      }
      root.appendChild(section);
    });
    setEditorEditable();
    renderMetrics();
    renderSectionState();
  }

  function setEditorEditable() {
    var lockedPhases = ['booting', 'loading-list', 'creating', 'loading-workspace', 'applying', 'conflict'];
    var editorLockedByAction = pendingAction && !pendingAction.keepEditorActive;
    var editable = hasWorkspace() && state.connection === 'online' &&
      !state.syncRequired && supportsApp('saveDocument') && !editorLockedByAction &&
      lockedPhases.indexOf(state.phase) === -1;
    $$('#documentRoot .writing-block').forEach(function (element) {
      element.contentEditable = editable ? 'true' : 'false';
      element.setAttribute('aria-readonly', editable ? 'false' : 'true');
    });
  }

  function serialisedPart(element, part) {
    return part.format === 'html' ? sanitiseHtml(element.innerHTML) : element.innerText;
  }

  function serialiseEditor() {
    if (!editorModel) return { content: '', format: state.document && state.document.content_format || 'plain_text' };
    var elements = $$('#documentRoot .writing-block');
    var values = elements.map(function (element, index) {
      return serialisedPart(element, editorModel.parts[index]);
    });
    var format = state.document.content_format || 'plain_text';
    if (editorModel.structured) {
      var clone;
      try {
        if (editorModel.parsed) {
          clone = JSON.parse(JSON.stringify(editorModel.parsed));
        } else {
          var structure = JSON.parse(JSON.stringify(editorModel.structureSource || []));
          clone = editorModel.structureKey === 'array' ? structure : {};
          if (editorModel.structureKey !== 'array') clone[editorModel.structureKey || 'sections'] = structure;
        }
      } catch (e) { clone = null; }
      if (clone) {
        var collection = Array.isArray(clone) ? clone : (clone.sections || clone.blocks);
        if (Array.isArray(collection)) {
          collection.forEach(function (part, index) {
            if (!part || index >= values.length) return;
            if (Object.prototype.hasOwnProperty.call(part, 'content')) part.content = values[index];
            else if (Object.prototype.hasOwnProperty.call(part, 'plain_text')) part.plain_text = values[index];
            else if (Object.prototype.hasOwnProperty.call(part, 'text')) part.text = values[index];
            else if (Object.prototype.hasOwnProperty.call(part, 'html')) part.html = values[index];
            else part.content = values[index];
          });
          return { content: JSON.stringify(clone), format: 'json' };
        }
      }
    }
    if (editorModel.structured) {
      return { content: values.join('\n\n'), format: format === 'html' ? 'html' : 'plain_text' };
    }
    return { content: values[0] || '', format: format };
  }

  function handleEditorInput(event) {
    var empty = event.currentTarget.parentElement.querySelector('.empty-writing');
    if (empty) empty.remove();
    var partIndex = Number(event.currentTarget.dataset.partIndex || 0);
    if (editorModel && editorModel.structured && editorModel.parts[partIndex]) currentSectionId = editorModel.parts[partIndex].id;
    var serialised = serialiseEditor();
    pendingDraft = {
      content: serialised.content,
      format: serialised.format,
      workspaceId: state.activeWorkspaceId,
      documentId: state.document && state.document.id
    };
    renderMetrics();
    text('#autosave span', 'Not saved');
    $('#autosave').classList.add('saving');
    clearTimeout(saveTimer);
    clearTimeout(analysisTimer);
    saveTimer = setTimeout(function () { callQuietly(saveCurrentDocument()); }, 750);
    analysisTimer = setTimeout(function () {
      /* An empty document has nothing for the backend to analyse — never
         spend a real analysis call, and never a model call, on nothing. */
      if (!serialised.content || !serialised.content.trim()) return;
      if (supportsApp('analyse') && state.phase !== 'conflict') {
        callQuietly(afterCurrentDocumentSaved(function () { return app.analyse('fast'); }, '', {
          keepEditorActive: true
        }));
      }
    }, 1250);
  }

  function saveCurrentDocument() {
    if (!pendingDraft) return Promise.resolve();
    if (!supportsApp('saveDocument')) {
      text('#autosave span', 'Not saved');
      $('#autosave').classList.add('error');
      return Promise.reject(new Error('autosave_unsupported'));
    }
    var draft = pendingDraft;
    if (draft.workspaceId !== state.activeWorkspaceId || !state.document || draft.documentId !== state.document.id) {
      return Promise.reject(new Error('draft_workspace_changed'));
    }
    pendingSavePromise = Promise.resolve(app.saveDocument(draft.content, draft.format)).then(function () {
      if (state.save && state.save.status === 'saved' && pendingDraft === draft) {
        pendingDraft = null;
        renderAutosave();
      }
    }).finally(function () {
      pendingSavePromise = null;
      renderAutosave();
    });
    return pendingSavePromise;
  }

  function selectWorkspace(workspaceId) {
    Promise.resolve(flushPendingDraft()).then(function () {
      if (state.phase === 'conflict') return;
      return app.openWorkspace(workspaceId);
    }).catch(function () {
      toast('Changes are not saved. Resolve the save state before switching workspaces.');
    });
  }

  function leaveWorkspace(navigate) {
    Promise.resolve(flushPendingDraft()).then(function () {
      if (state.phase === 'conflict') {
        toast('Resolve the version conflict before leaving this workspace.');
        return;
      }
      navigate();
    }).catch(function () {
      toast('Changes are not saved. Resolve the save state before leaving.');
    });
  }

  function canReturnWithinVision() {
    if (!document.referrer) return false;
    try {
      return new URL(document.referrer, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function focusEditorAtEnd() {
    var editor = $('#documentRoot .writing-block');
    if (!editor || editor.contentEditable !== 'true') return;
    editor.focus();
    var selection = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function renderMetrics() {
    var visibleWriting = hasWorkspace() ? $$('#documentRoot .writing-block').map(function (element) {
      return element.innerText;
    }).join('\n') : '';
    text('#wordCount', wordCount(visibleWriting));
    if (!hasWorkspace()) {
      text('#sectionMetric', '');
      return;
    }
    var issues = openIssues();
    var status = state.analysis && state.analysis.status;
    var label = status === 'analysing' || status === 'buffering' ? 'Analysing'
      : (issues.length ? issues.length + ' issue' + (issues.length === 1 ? '' : 's')
        : (state.analysis && state.analysis.hasResult ? 'Quiet' : 'Not analysed'));
    text('#sectionMetric', label);
  }

  function renderSectionState() {
    var progress = $('#sectionProgress');
    if (!hasWorkspace() || !editorModel || !editorModel.structured) {
      progress.style.display = 'none';
      return;
    }
    progress.style.display = '';
    text('#sectionProgressLabel', 'Sections');
    text('#sectionCount', editorModel.parts.length + ' section' + (editorModel.parts.length === 1 ? '' : 's'));
    var list = $('#sectionList');
    list.innerHTML = '';
    editorModel.parts.forEach(function (part) {
      var row = document.createElement('div');
      row.className = 'section-row ' + (part.id === currentSectionId ? 'current' : '');
      row.innerHTML = '<span class="section-dot">·</span><span><span class="section-name"></span><span class="section-status"></span></span><button class="section-edit" type="button">Focus</button>';
      row.querySelector('.section-name').textContent = part.title || '';
      row.querySelector('.section-status').textContent = part.id === currentSectionId ? 'Current section' : '';
      row.querySelector('button').addEventListener('click', function () {
        currentSectionId = part.id;
        var target = document.querySelector('[data-section-id="' + CSS.escape(part.id) + '"] .writing-block');
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.focus();
        }
        renderSectionState();
      });
      list.appendChild(row);
    });
  }

  function renderMission() {
    if (!hasWorkspace()) return;
    var workspace = state.workspace;
    var task = state.task || {};
    var taskMeta = task.meta && typeof task.meta === 'object' ? task.meta : {};
    var proofContract = task.proofContract && typeof task.proofContract === 'object'
      ? task.proofContract : (task.proof_contract && typeof task.proof_contract === 'object'
        ? task.proof_contract : {});
    text('#missionKicker', workspace.detected_task_type || workspace.analyst_type ||
      workspace.intelligence_mode || task.task_type || taskMeta.task_type || '');
    text('#missionTitle', workspace.title || '');
    var missionDetails = [];
    var taskDescription = workspace.task_description || task.task_description || task.description ||
      taskMeta.task_description || taskMeta.description || '';
    var desiredOutcome = workspace.desired_outcome || task.desired_outcome || task.outcome ||
      taskMeta.desired_outcome || taskMeta.outcome || proofContract.desired_outcome || proofContract.outcome || '';
    if (taskDescription) missionDetails.push(taskDescription);
    if (desiredOutcome && desiredOutcome !== taskDescription) {
      missionDetails.push('Desired outcome: ' + desiredOutcome);
    }
    var standard = workspace.professional_standard || workspace.task_standard || workspace.standard ||
      task.professional_standard || task.task_standard || task.standard ||
      taskMeta.professional_standard || taskMeta.standard ||
      proofContract.professional_standard || proofContract.standard;
    if (standard) missionDetails.push('Professional Standard: ' + firstText(standard));
    text('#missionSub', missionDetails.join(' · '));
    text('#editorSectionTitle', state.document.title || '');
    text('#editorSectionSub', (state.workspaceState && state.workspaceState.current_stage) ? humanLabel(state.workspaceState.current_stage) : '');
    text('#topStatus', workspace.title || 'Workspace loaded');
  }

  function openIssues() {
    var issues = Array.isArray(state.issues) ? state.issues.slice() : [];
    return issues.filter(function (issue) {
      if (!issue) return false;
      var status = issue.status || issue.state || 'open';
      if (['open', 'being_addressed'].indexOf(status) < 0) return false;
      var delivery = issue.delivery_decision;
      return !delivery || ['show', 'soft_show', 'warning'].indexOf(delivery) > -1;
    }).sort(function (a, b) {
      return Number(b.priority_score || b.priority || 0) - Number(a.priority_score || a.priority || 0);
    });
  }

  function issueView(issue) {
    var anchor = issue && issue.anchor && typeof issue.anchor === 'object' ? issue.anchor : {};
    return {
      id: issue && issue.id,
      category: issue && issue.category || '',
      title: issue && issue.title || '',
      why: issue && (issue.explanation || issue.why) || '',
      suggestion: issue && issue.suggestion || '',
      replacement: issue && (issue.replacement_text || issue.suggested_text || issue.apply) || '',
      current: anchor.quote || issue.current_text || '',
      sectionId: issue && (issue.section_id || issue.sectionId) || null
    };
  }

  function readingPanel() {
    return '<section class="change-hero reading-hero"><div class="analysis-status"><span class="analysis-spinner" aria-hidden="true"></span><div class="analysis-copy"><div class="change-kicker">Reading the current work</div><h2 class="insight-title">Checking structure, meaning and requirements</h2><p class="insight-why">Live Intelligence is waiting for the backend analysis before showing a result.</p></div></div><div class="analysis-track" aria-hidden="true"><span></span></div></section>';
  }

  function renderNotice() {
    var notice = $('#notice');
    if (state.phase === 'conflict') {
      notice.innerHTML = (state.conflictDraft
        ? 'Version conflict. Your unsaved text is still held in this tab. '
        : 'Version conflict. The loaded workspace remains visible. ') +
        '<button class="action" data-action="reload-version" type="button">Reload Current Version</button>';
      notice.classList.add('show');
      var reload = notice.querySelector('[data-action="reload-version"]');
      reload.disabled = !(app && hasMethod(app, 'reloadCurrentVersion'));
      reload.addEventListener('click', function () {
        if (!app || !hasMethod(app, 'reloadCurrentVersion')) return;
        Promise.resolve(app.reloadCurrentVersion()).then(function () {
          pendingDraft = null;
          renderedDocumentEpoch = -1;
          render();
        }).catch(function () {});
      });
      return;
    }
    if (state.save && state.save.status === 'error') {
      notice.textContent = state.save.reason || 'Changes could not be saved.';
      var retrySave = document.createElement('button');
      retrySave.className = 'action';
      retrySave.type = 'button';
      retrySave.textContent = 'Retry Save';
      retrySave.disabled = !pendingDraft || !supportsApp('saveDocument') || !!pendingAction;
      retrySave.addEventListener('click', function () { callQuietly(flushPendingDraft()); });
      notice.appendChild(retrySave);
      notice.classList.add('show');
      return;
    }
    var message = '';
    if (state.analysis && state.analysis.status === 'error') message = state.analysis.reason;
    else if (state.change && state.change.reason) message = state.change.reason;
    else if (state.ask && state.ask.status === 'error') message = state.ask.reason;
    else if (state.operationError) message = state.operationError;
    else if (hasWorkspace() && !supportsApp('saveDocument')) {
      message = 'Autosave is not supported by the connected adapter. This document is read-only.';
    }
    notice.textContent = message || '';
    notice.classList.toggle('show', !!message);
  }

  function renderRightPanel() {
    var panel = $('#rightPanel');
    var insight = $('#insightPanel');
    panel.classList.remove('reading', 'has-issue', 'applied-state');
    panel.classList.toggle('no-workspace', !hasWorkspace());
    if (!hasWorkspace()) {
      panel.setAttribute('data-live-state', state.phase === 'error' ? 'error' : 'empty');
      text('#liveChip', state.phase === 'empty' ? 'No workspace' : (state.phase === 'error' ? 'Disconnected' : 'Connecting'));
      insight.innerHTML = '<div class="backend-state"><h3>' +
        escapeHtml(state.phase === 'empty' ? 'No workspace' : (state.phase === 'error' ? 'Connection unavailable' : 'Connecting')) +
        '</h3><p>' +
        escapeHtml(state.phase === 'empty' ? 'Create or open a workspace to activate Live Intelligence.' : (state.reason || 'Connecting to Live Intelligence…')) +
        '</p>' + (state.phase === 'error' ? '<button class="action" data-action="reconnect" type="button">Reconnect</button>' : '') + '</div>';
      var reconnect = insight.querySelector('[data-action="reconnect"]');
      if (reconnect) reconnect.addEventListener('click', function () {
        callQuietly(reconnectFrontend());
      });
      $('#askShell').style.display = 'none';
      $('#sectionProgress').style.display = 'none';
      $('#applyReceipt').classList.remove('show');
      renderNotice();
      return;
    }

    $('#askShell').style.display = '';
    renderSectionState();
    var analysisStatus = state.analysis && state.analysis.status;
    if (state.connection === 'offline') {
      panel.setAttribute('data-live-state', 'error');
      text('#liveChip', 'Offline');
      insight.innerHTML = '<div class="backend-state"><h3>Connection unavailable</h3><p>Your real workspace remains visible. Reconnect before saving or requesting intelligence.</p><button class="action" data-action="reconnect" type="button">Reconnect</button></div>';
      insight.querySelector('[data-action="reconnect"]').addEventListener('click', function () {
        callQuietly(reconnectFrontend());
      });
    } else if (['booting', 'loading-list', 'creating', 'loading-workspace'].indexOf(state.phase) > -1) {
      panel.classList.add('reading');
      panel.setAttribute('data-live-state', 'buffering');
      text('#liveChip', state.phase === 'creating' ? 'Creating' : 'Loading');
      insight.innerHTML = '<div class="backend-state" role="status"><span class="analysis-spinner" aria-hidden="true"></span><h3>' +
        escapeHtml(state.reason || (state.phase === 'loading-workspace' ? 'Loading workspace…' : 'Connecting to Live Intelligence…')) +
        '</h3><p>The loaded work remains visible while the backend request completes.</p></div>';
    } else if (state.phase === 'error') {
      panel.setAttribute('data-live-state', 'error');
      text('#liveChip', 'Unavailable');
      insight.innerHTML = '<div class="backend-state"><h3>Workspace request failed</h3><p>' +
        escapeHtml(state.reason || 'The backend request did not complete. The loaded workspace has been preserved.') +
        '</p>' + (app && hasMethod(app, 'reconnect') ? '<button class="action" data-action="reconnect" type="button">Reconnect</button>' : '') + '</div>';
      var activeReconnect = insight.querySelector('[data-action="reconnect"]');
      if (activeReconnect) activeReconnect.addEventListener('click', function () { callQuietly(reconnectFrontend()); });
    } else if (state.phase === 'conflict') {
      panel.setAttribute('data-live-state', 'error');
      text('#liveChip', 'Conflict');
      insight.innerHTML = '<div class="backend-state"><h3>Version conflict</h3><p>Your current workspace remains visible. Reload the current version when you are ready to replace the protected local draft.</p></div>';
    } else if (state.phase === 'applying') {
      panel.setAttribute('data-live-state', 'buffering');
      text('#liveChip', 'Applying');
      insight.innerHTML = '<div class="backend-state"><h3>Applying the approved change</h3><p>Waiting for the backend revision before updating the document.</p></div>';
    } else if (state.phase === 'asking') {
      panel.setAttribute('data-live-state', 'buffering');
      text('#liveChip', 'Asking');
      insight.innerHTML = '<div class="backend-state"><h3>Waiting for Live Intelligence</h3><p>Your existing replies remain below while the backend prepares this response.</p></div>';
    } else if (analysisStatus === 'analysing' || analysisStatus === 'buffering' || state.phase === 'analysing') {
      panel.classList.add('reading');
      panel.setAttribute('data-live-state', 'buffering');
      text('#liveChip', 'Reading');
      insight.innerHTML = readingPanel();
    } else {
      var issues = openIssues();
      var issue = issues.length ? issueView(issues[0]) : null;
      if (issue) {
        var issueActionsLocked = !!pendingAction || state.phase === 'saving';
        var applySupported = supportsApp('applyIssue');
        var quietSupported = supportsApp('quietIssue');
        var capabilityMessages = [];
        if (issue.replacement && !applySupported) capabilityMessages.push('Apply Change is unavailable because the connected adapter does not support preview and apply.');
        if (!quietSupported) capabilityMessages.push('Quiet This is unavailable because the connected adapter does not support issue state changes.');
        var applyControl = issue.replacement
          ? '<button class="action primary" data-action="apply" type="button" ' +
            ((!applySupported || issueActionsLocked) ? 'disabled ' : '') +
            'title="' + (applySupported ? '' : 'Apply Change is not supported by the connected adapter.') + '">Apply Change</button>'
          : '';
        var quietControl = '<button class="action" data-action="quiet" type="button" ' +
          ((!quietSupported || issueActionsLocked) ? 'disabled ' : '') +
          'title="' + (quietSupported ? '' : 'Quiet This is not supported by the connected adapter.') + '">Quiet This</button>';
        panel.classList.add('has-issue');
        panel.setAttribute('data-live-state', 'issue');
        text('#liveChip', 'Issue found');
        var compare = '';
        if (issue.current) compare += '<div class="version-box current"><div class="label">Current text</div><p>' + escapeHtml(issue.current) + '</p></div>';
        if (issue.replacement) compare += '<div class="improvement-box"><div class="label">Improved version</div><p>' + escapeHtml(issue.replacement) + '</p></div>';
        insight.innerHTML = '<section class="change-hero" data-issue-id="' + escapeHtml(issue.id) + '">' +
          '<div class="change-kicker"><i></i>' + escapeHtml(issue.category || 'Issue') + '</div>' +
          '<h2 class="insight-title">' + escapeHtml(issue.title) + '</h2>' +
          (issue.why ? '<p class="insight-why">' + escapeHtml(issue.why) + '</p>' : '') +
          (compare ? '<div class="change-compare">' + compare + '</div>' : '') +
          '<div class="intel-actions">' +
          applyControl +
          '<button class="action" data-action="edit" type="button" ' + (issueActionsLocked ? 'disabled' : '') + '>Edit Myself</button>' +
          quietControl +
          '</div>' +
          (capabilityMessages.length ? '<p class="capability-explanation">' + escapeHtml(capabilityMessages.join(' ')) + '</p>' : '') +
          '</section>';
        var apply = insight.querySelector('[data-action="apply"]');
        if (apply && applySupported) apply.addEventListener('click', function () {
          callQuietly(afterCurrentDocumentSaved(function () {
            return app.applyIssue(issue.id);
          }, 'Save the current writing before applying this change.'));
        });
        insight.querySelector('[data-action="edit"]').addEventListener('click', function () {
          focusIssueInEditor(issue);
        });
        var quiet = insight.querySelector('[data-action="quiet"]');
        if (quiet && quietSupported) quiet.addEventListener('click', function () {
          callQuietly(afterCurrentDocumentSaved(function () {
            return app.quietIssue(issue.id);
          }, 'Save the current writing before quieting this issue.'));
        });
      } else if (analysisStatus === 'error') {
        var analyseSupported = supportsApp('analyse');
        panel.setAttribute('data-live-state', 'error');
        text('#liveChip', 'Unavailable');
        insight.innerHTML = '<div class="backend-state"><h3>Analysis unavailable</h3><p>' +
          escapeHtml(state.analysis.reason || 'The backend analysis did not complete.') +
          '</p><button class="action" data-action="retry-analysis" type="button" ' +
          ((!analyseSupported || pendingAction) ? 'disabled ' : '') +
          'title="' + (analyseSupported ? '' : 'Analysis is not supported by the connected adapter.') + '">Retry analysis</button>' +
          (!analyseSupported ? '<p class="capability-explanation">Analysis is unavailable because the connected adapter does not support it.</p>' : '') +
          '</div>';
        var retry = insight.querySelector('[data-action="retry-analysis"]');
        if (retry && analyseSupported) retry.addEventListener('click', function () {
          callQuietly(afterCurrentDocumentSaved(function () {
            return app.analyse('fast');
          }, 'Save the current writing before retrying analysis.', { keepEditorActive: true }));
        });
      } else {
        var quietAnalyseSupported = supportsApp('analyse');
        panel.setAttribute('data-live-state', 'quiet');
        text('#liveChip', 'Quiet');
        var hasResult = state.analysis && state.analysis.hasResult;
        insight.innerHTML = '<div class="quiet-panel"><div class="issue-meta"><span class="priority-label">Quiet</span></div><h2 class="insight-title">' +
          escapeHtml(hasResult ? 'No high-value issue is open.' : 'Ready when you are.') +
          '</h2><p class="insight-why">' +
          escapeHtml(hasResult ? 'The latest backend state returned no open issue for this work.' : 'Live Intelligence has not analysed this document yet.') +
          '</p><button class="action" data-action="analyse" type="button" ' +
          ((!quietAnalyseSupported || pendingAction) ? 'disabled ' : '') +
          'title="' + (quietAnalyseSupported ? '' : 'Analysis is not supported by the connected adapter.') + '">Analyse current work</button>' +
          (!quietAnalyseSupported ? '<p class="capability-explanation">Analysis is unavailable because the connected adapter does not support it.</p>' : '') +
          '</div>';
        var analyse = insight.querySelector('[data-action="analyse"]');
        if (analyse && quietAnalyseSupported) analyse.addEventListener('click', function () {
          callQuietly(afterCurrentDocumentSaved(function () {
            return app.analyse('fast');
          }, 'Save the current writing before running analysis.', { keepEditorActive: true }));
        });
      }
    }
    renderApplyReceipt();
    renderAsk();
    renderNotice();
  }

  function focusIssueInEditor(issue) {
    if (issue.sectionId) {
      var section = document.querySelector('[data-section-id="' + CSS.escape(issue.sectionId) + '"]');
      if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        var sectionEditor = section.querySelector('.writing-block');
        if (sectionEditor) sectionEditor.focus();
        return;
      }
    }
    focusEditorAtEnd();
  }

  function renderApplyReceipt() {
    var receipt = $('#applyReceipt');
    var applied = state.change && state.change.status === 'applied';
    receipt.classList.toggle('show', applied);
    $('#rightPanel').classList.toggle('applied-state', applied);
    if (applied) {
      var undoSupported = supportsApp('undoLastChange');
      text('#applyReceiptText', undoSupported ? 'Change applied' : 'Change applied · Undo is not supported by the connected adapter');
      $('#undoApply').disabled = !undoSupported || !!pendingAction ||
        state.phase === 'applying' || state.phase === 'saving';
      $('#undoApply').title = undoSupported ? '' : 'Undo is not supported by the connected adapter.';
      highlightAppliedText();
    }
  }

  function highlightAppliedText() {
    var change = state.change || {};
    var proposal = change.proposal || {};
    var proposalId = change.lastProposalId;
    var value = proposal.replacement_text;
    if (!proposalId || !value || proposalId === lastAppliedProposalId) return;
    lastAppliedProposalId = proposalId;
    var blocks = $$('#documentRoot .writing-block');
    for (var i = 0; i < blocks.length; i++) {
      var walker = document.createTreeWalker(blocks[i], NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var index = node.nodeValue.indexOf(value);
        if (index < 0) continue;
        var range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + value.length);
        var span = document.createElement('span');
        span.className = 'sentence ai-applied';
        range.surroundContents(span);
        (function (appliedSpan) {
          setTimeout(function () {
            if (!appliedSpan.parentNode) return;
            while (appliedSpan.firstChild) appliedSpan.parentNode.insertBefore(appliedSpan.firstChild, appliedSpan);
            appliedSpan.parentNode.removeChild(appliedSpan);
          }, 2700);
        })(span);
        return;
      }
    }
  }

  function historyForWorkspace(workspaceId) {
    var id = workspaceId || state.activeWorkspaceId;
    if (!id) return [];
    if (!askHistory[id]) askHistory[id] = [];
    return askHistory[id];
  }

  function renderAsk() {
    var shell = $('#askShell');
    if (!hasWorkspace()) {
      shell.style.display = 'none';
      return;
    }
    shell.style.display = '';
    var existing = shell.querySelector('.ask-thread');
    if (existing) existing.remove();
    var history = historyForWorkspace();
    if (history.length) {
      var thread = document.createElement('div');
      thread.className = 'ask-thread';
      thread.setAttribute('role', 'log');
      thread.setAttribute('aria-live', 'polite');
      thread.setAttribute('aria-label', 'Live Intelligence replies');
      history.forEach(function (item) {
        var card = document.createElement('div');
        card.className = 'ask-response';
        var question = document.createElement('div');
        question.className = 'ask-question';
        question.textContent = item.question;
        var answer = document.createElement('p');
        answer.textContent = item.answer;
        card.appendChild(question);
        card.appendChild(answer);
        thread.appendChild(card);
      });
      shell.insertBefore(thread, shell.querySelector('.ask-toggle'));
    }
    var supported = supportsApp('ask');
    var sending = state.phase === 'asking' || (state.ask && state.ask.status === 'asking');
    var locked = !!pendingAction || !!state.syncRequired || state.connection !== 'online' ||
      ['booting', 'loading-list', 'creating', 'loading-workspace',
      'saving', 'analysing', 'applying', 'conflict'].indexOf(state.phase) > -1;
    $('#askInput').disabled = !supported || sending || locked;
    $('#askSend').disabled = !supported || sending || locked;
    $('#askSend').setAttribute('aria-busy', sending ? 'true' : 'false');
    if (!supported) $('#askInput').placeholder = 'Ask is not supported by the connected adapter.';
    else $('#askInput').placeholder = 'Ask about this workspace…';
  }

  function sendAsk() {
    var input = $('#askInput');
    var question = input.value.trim();
    if (!question || !supportsApp('ask') || pendingAction) return;
    var workspaceId = state.activeWorkspaceId;
    var currentPart = editorModel && editorModel.parts.find(function (part) {
      return part.id === currentSectionId;
    });
    var sectionId = currentPart ? currentPart.backendId : null;
    Promise.resolve(afterCurrentDocumentSaved(function () {
      if (state.activeWorkspaceId !== workspaceId) return null;
      if (input.value.trim() === question) input.value = '';
      return app.ask(question, { sectionId: sectionId });
    }, 'Save the current writing before asking Live Intelligence.', {
      keepEditorActive: true
    })).then(function (answer) {
      if (!answer) return;
      historyForWorkspace(workspaceId).push({ question: question, answer: String(answer) });
      if (state.activeWorkspaceId === workspaceId) renderAsk();
      var thread = $('#askShell .ask-thread');
      if (thread) thread.scrollTop = thread.scrollHeight;
    }).catch(function () {
      if (state.activeWorkspaceId === workspaceId && !input.value.trim()) input.value = question;
    });
  }

  function renderAutosave() {
    var bar = $('#autosave');
    bar.classList.remove('saving', 'error');
    if (!hasWorkspace()) {
      text('#autosave span', 'Waiting for workspace');
      return;
    }
    var save = state.save || {};
    if (state.phase === 'conflict' || save.status === 'conflict') {
      text('#autosave span', 'Version conflict');
      bar.classList.add('error');
    } else if (state.syncRequired || state.connection !== 'online') {
      text('#autosave span', 'Not saved');
      bar.classList.add('error');
    } else if (!supportsApp('saveDocument')) {
      text('#autosave span', 'Autosave unavailable');
      bar.classList.add('error');
    } else if (pendingSavePromise || save.status === 'saving' || state.phase === 'saving') {
      text('#autosave span', 'Saving…');
      bar.classList.add('saving');
    } else if (pendingDraft) {
      text('#autosave span', 'Not saved');
      bar.classList.add('error');
    } else if (save.status === 'error') {
      text('#autosave span', 'Not saved');
      bar.classList.add('error');
    } else if (save.status === 'saved') {
      text('#autosave span', 'Saved');
    } else {
      text('#autosave span', 'Autosave ready');
    }
  }

  function setActiveChrome(active) {
    $('.mission-bar').style.display = active ? '' : 'none';
    $('.editor-top').style.display = active ? '' : 'none';
    $('.editor-footer').style.display = active ? '' : 'none';
    $('.mission-actions').style.display = active ? '' : 'none';
    $('#focusIssueBtn').disabled = !active;
    $('#deepAnalysisBtn').disabled = !active;
  }

  function renderInactiveEditor() {
    renderedDocumentEpoch = -1;
    renderedWorkspaceId = null;
    editorModel = null;
    currentSectionId = null;
    setActiveChrome(false);
    clearContext();
    var root = $('#documentRoot');
    var loading = ['booting', 'loading-list', 'loading-workspace', 'creating'].indexOf(state.phase) > -1;
    if (state.phase === 'empty') {
      var primary = state.taskWorkspaceMissing ? 'Start workspace for this task' : 'Create Workspace';
      root.innerHTML = '<div class="state-card"><div class="state-card-inner"><div class="eyebrow">LIVE INTELLIGENCE</div><h2>Build beside the work.</h2><p>Create a workspace or begin from Today’s Move. Live Intelligence will use the task, files, requirements and current progress already available to VISION.</p><div class="intel-actions" style="justify-content:center"><button class="action primary" data-empty-action="create" type="button">' +
        escapeHtml(primary) + '</button><button class="action" data-empty-action="tasks" type="button">Open Today’s Move</button></div></div></div>';
      root.querySelector('[data-empty-action="create"]').addEventListener('click', openNewWorkspace);
      root.querySelector('[data-empty-action="tasks"]').addEventListener('click', function () { location.href = 'tasks.html'; });
      text('#topStatus', 'No workspace');
    } else if (loading) {
      root.innerHTML = '<div class="state-card" role="status"><div class="state-card-inner"><div class="state-orbit" aria-hidden="true"></div><div class="eyebrow">LIVE INTELLIGENCE</div><h2>' +
        escapeHtml(state.phase === 'creating' ? 'Creating workspace…' : (state.reason || 'Connecting…')) +
        '</h2><p>The interface will activate when the backend workspace is ready.</p></div></div>';
      text('#topStatus', state.reason || 'Connecting');
    } else {
      var reason = state.reason || 'Live Intelligence is not connected in this build.';
      root.innerHTML = '<div class="state-card"><div class="state-card-inner"><div class="state-orbit still" aria-hidden="true"></div><div class="eyebrow">LIVE INTELLIGENCE</div><h2>Connection unavailable</h2><p>' +
        escapeHtml(reason) + '</p>' +
        (app && hasMethod(app, 'reconnect') ? '<button class="action" data-empty-action="reconnect" type="button">Reconnect</button>' : '') +
        '</div></div>';
      var reconnect = root.querySelector('[data-empty-action="reconnect"]');
      if (reconnect) reconnect.addEventListener('click', function () { callQuietly(reconnectFrontend()); });
      text('#topStatus', state.phase === 'signed-out' ? 'Sign in required' : 'Disconnected');
    }
  }

  function renderActiveEditor() {
    setActiveChrome(true);
    var intelligenceLocked = !!pendingAction || !!state.syncRequired || state.connection !== 'online' ||
      ['booting', 'loading-list', 'creating', 'loading-workspace',
      'saving', 'analysing', 'applying', 'asking', 'conflict'].indexOf(state.phase) > -1;
    $('#focusIssueBtn').disabled = intelligenceLocked;
    $('#deepAnalysisBtn').disabled = intelligenceLocked || !supportsApp('analyse');
    $('#deepAnalysisBtn').title = supportsApp('analyse') ? '' : 'Final review is not supported by the connected adapter.';
    renderMission();
    renderContext();
    renderDocument();
    setEditorEditable();
    if (state.phase === 'conflict') {
      text('#quietState', state.conflictDraft
        ? 'Version conflict. Your unsaved text remains in this tab.'
        : 'Version conflict. The loaded workspace remains visible.');
    } else if (state.phase === 'loading-workspace') {
      text('#quietState', 'Loading the selected workspace…');
    } else if (state.phase === 'loading-list' || state.phase === 'booting') {
      text('#quietState', 'Reconnecting to the workspace service…');
    } else if (state.phase === 'creating') {
      text('#quietState', 'Creating the new workspace through the connected backend…');
    } else if (state.phase === 'saving') {
      text('#quietState', 'Saving the current revision…');
    } else if (state.phase === 'analysing') {
      text('#quietState', 'Reading the current work through Live Intelligence.');
    } else {
      text('#quietState', 'Monitoring is driven by the latest backend state.');
    }
  }

  function openDeepAnalysis() {
    if (!hasWorkspace()) return;
    deepOpen = true;
    showModal($('#deepModal'));
    renderDeepAnalysis();
    if (supportsApp('analyse')) {
      callQuietly(afterCurrentDocumentSaved(function () {
        return app.analyse('deep');
      }, 'Save the current writing before final review.', { keepEditorActive: true }));
    }
  }

  function analysisResult() {
    if (state.analysis && state.analysis.result) return state.analysis.result;
    if (state.latestAnalysis && state.latestAnalysis.response_snapshot) return state.latestAnalysis.response_snapshot;
    return null;
  }

  function renderDeepAnalysis() {
    if (!deepOpen) return;
    var status = state.analysis && state.analysis.status;
    var result = analysisResult();
    var issues = openIssues().map(issueView);
    var loading = status === 'analysing' || status === 'buffering' || state.phase === 'analysing';
    text('#deepPosition', loading ? 'Reading…' : (firstText(result && (result.overall_position || result.position || result.status)) || (status === 'ready' ? 'Analysis complete' : 'Not analysed')));
    text('#deepPositionText', loading
      ? 'Checking structure, meaning and requirements through the backend.'
      : (firstText(result && (result.summary || result.work_summary)) ||
        firstText(state.workspaceState && state.workspaceState.current_work_summary) ||
        (status === 'error' ? state.analysis.reason : 'No backend summary was returned.')));
    text('#deepCoverage', String(issues.length));
    text('#deepCoverageText', issues.length ? 'Open issues returned by the latest backend state.' : (status === 'ready' ? 'No open issues returned by the latest backend state.' : 'Waiting for backend analysis.'));
    var checks = $('#deepChecks');
    checks.innerHTML = '';
    var dimensions = result && Array.isArray(result.dimensions) ? result.dimensions : [];
    var rows = dimensions.length ? dimensions : issues;
    rows.forEach(function (row) {
      var name = Array.isArray(row) ? row[0] : (row.name || row.dimension || row.category || row.title || '');
      var value = Array.isArray(row) ? row[1] : (row.status || row.rating || row.severity || '');
      var detail = Array.isArray(row) ? row[2] : (row.detail || row.explanation || row.why || row.suggestion || '');
      var card = document.createElement('div');
      card.className = 'check';
      card.innerHTML = '<div class="icon">·</div><div><h4></h4><p></p></div>';
      card.querySelector('h4').textContent = [name, value].filter(Boolean).join(' · ');
      card.querySelector('p').textContent = detail;
      checks.appendChild(card);
    });
    var topIssue = issues[0];
    text('#deepActionText', topIssue
      ? (topIssue.suggestion || topIssue.why || topIssue.title)
      : (status === 'ready' ? 'No improvement was returned by the backend.' : 'Waiting for backend analysis.'));
    $('#deepAction').style.display = loading || topIssue || status === 'ready' ? '' : 'none';
  }

  function focusCurrentIssue() {
    var issues = openIssues();
    if (!issues.length) {
      toast(state.analysis && state.analysis.hasResult ? 'No high-value issue is open.' : 'Run analysis to check the current work.');
      return;
    }
    var card = $('#insightPanel [data-issue-id]');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      var button = card.querySelector('[data-action="edit"]');
      if (button) button.focus();
    }
  }

  function render() {
    if (app && app.state) state = app.state;
    renderWorkspaceList();
    renderWorkspaceTools();
    renderOperationControls();
    if (hasWorkspace()) renderActiveEditor();
    else renderInactiveEditor();
    renderAutosave();
    renderRightPanel();
    renderDeepAnalysis();
  }

  function bindEvents() {
    $('#drawerToggle').addEventListener('click', openDrawer);
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);
    $('#newWorkspace').addEventListener('click', openNewWorkspace);
    $('#workspaceSearch').addEventListener('input', renderWorkspaceList);
    $('#renameWorkspace').addEventListener('click', openRenameModal);
    $('#archiveWorkspace').addEventListener('click', openArchiveModal);
    $('#contextToggle').addEventListener('click', function () {
      var card = $('#contextCard');
      var open = card.classList.toggle('open');
      $('#contextToggle').setAttribute('aria-expanded', String(open));
    });
    $('#focusIssueBtn').addEventListener('click', focusCurrentIssue);
    $('#deepAnalysisBtn').addEventListener('click', openDeepAnalysis);
    $('#sectionProgressToggle').addEventListener('click', function () {
      var progress = $('#sectionProgress');
      if (!progress.classList.contains('compact')) return;
      var expanded = progress.classList.toggle('expanded');
      this.setAttribute('aria-expanded', String(expanded));
    });
    $('#askToggle').addEventListener('click', function () {
      var shell = $('#askShell');
      var open = shell.classList.toggle('open');
      this.setAttribute('aria-expanded', String(open));
      if (open) setTimeout(function () { $('#askInput').focus(); }, 20);
    });
    $('#askSend').addEventListener('click', sendAsk);
    $('#askInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendAsk();
      }
    });
    $('#undoApply').addEventListener('click', function () {
      if (supportsApp('undoLastChange')) {
        callQuietly(afterCurrentDocumentSaved(function () {
          return app.undoLastChange();
        }, 'Save the current writing before undoing this change.'));
      }
    });

    $('#workspaceForm').addEventListener('submit', submitWorkspace);
    $('#workspaceModalClose').addEventListener('click', function () { if (!createSubmitting) hideModal($('#workspaceModal')); });
    $('#workspaceCancel').addEventListener('click', function () { if (!createSubmitting) hideModal($('#workspaceModal')); });
    $('#renameForm').addEventListener('submit', submitRename);
    $('#renameModalClose').addEventListener('click', function () { if (!renameSubmitting) hideModal($('#renameModal')); });
    $('#renameCancel').addEventListener('click', function () { if (!renameSubmitting) hideModal($('#renameModal')); });
    $('#archiveConfirm').addEventListener('click', confirmArchive);
    $('#archiveModalClose').addEventListener('click', function () { if (!archiveSubmitting) hideModal($('#archiveModal')); });
    $('#archiveCancel').addEventListener('click', function () { if (!archiveSubmitting) hideModal($('#archiveModal')); });
    $('#modalClose').addEventListener('click', function () {
      deepOpen = false;
      hideModal($('#deepModal'));
    });
    $$('.modal').forEach(function (modal) {
      modal.addEventListener('click', function (event) {
        if (event.target !== modal) return;
        if ((modal === $('#workspaceModal') && createSubmitting) ||
            (modal === $('#renameModal') && renameSubmitting) ||
            (modal === $('#archiveModal') && archiveSubmitting)) return;
        if (modal === $('#deepModal')) deepOpen = false;
        hideModal(modal);
      });
    });
    $('#navBack').addEventListener('click', function () {
      leaveWorkspace(function () {
        if (history.length > 1 && canReturnWithinVision()) history.back();
        else location.href = 'dashboard.html';
      });
    });
    $('#navClose').addEventListener('click', function () {
      leaveWorkspace(function () { location.href = 'dashboard.html'; });
    });
    window.addEventListener('beforeunload', function (event) {
      if (!pendingDraft && !pendingSavePromise && state.phase !== 'conflict') return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('online', function () {
      if (pendingDraft && state.phase !== 'conflict') callQuietly(flushPendingDraft());
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Tab') {
        var container = document.querySelector('.modal.show') || document.querySelector('.drawer.open');
        if (!container) return;
        var focusable = Array.prototype.slice.call(container.querySelectorAll(
          'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )).filter(function (element) { return element.offsetParent !== null; });
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      var modal = document.querySelector('.modal.show');
      if (modal) {
        if ((modal === $('#workspaceModal') && createSubmitting) ||
            (modal === $('#renameModal') && renameSubmitting) ||
            (modal === $('#archiveModal') && archiveSubmitting)) return;
        if (modal === $('#deepModal')) deepOpen = false;
        hideModal(modal);
      } else {
        closeDrawer();
      }
    });
  }

  /* ── THE CALL SURFACES OWN THE PAGE ───────────────────────────────────
     live-intelligence.html hosts three surfaces. The workspace APP already
     refuses to boot behind a call -- but this file, the workspace CHROME,
     did not, so it rendered over the Practice Call and the founder was
     handed a document editor instead of a rehearsal. The same condition,
     applied to the thing that actually paints. */
  function callSurfaceOpen() {
    try {
      var q = new URLSearchParams(location.search);
      return !!(q.get('call') || q.get('practice-call') || q.get('practice') || q.get('review'));
    } catch (e) { return false; }
  }

  if (!callSurfaceOpen()) {
    bindEvents();
    if (app && hasMethod(app, 'onChange')) app.onChange(render);
    render();
  }
})(window.VISION);
