/* VISION Live Intelligence: server-decided continuous analysis + private sources. */
window.VISION = window.VISION || {};
(function (V) {
  'use strict';
  var app = V.liApp, api = V.liApi;
  if (!app || !api || !app.state) return;

  var S = app.state;
  var SAVE_IDLE_MS = 750, EDIT_SIGNAL_IDLE_MS = 700, DEFAULT_ANALYSIS_IDLE_MS = 3200, SENTENCE_ANALYSIS_IDLE_MS = 2600, PARAGRAPH_ANALYSIS_IDLE_MS = 2500;
  var POLL_MS = 1200, POLL_LIMIT = 30, FILE_POLL_LIMIT = 45;
  var saveTimer, editTimer, pauseTimer, saving, draft, editMetrics, lastEditMetrics;
  var generation = 0, analysisGeneration = 0, composing = false, lastInputAt = 0;
  var analysisPending = false, lastAnalysedRevision = null;
  var snapshots = new WeakMap(), sessionId = uid(), staged = [], uploads = [], uploading = false;
  var previousWorkspaceId = null, stagedForCreation = false, sourceStrip, sourceList;
  var metrics = [];

  function $(q) { return document.querySelector(q); }
  function $$(q) { return Array.prototype.slice.call(document.querySelectorAll(q)); }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : 'li-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function workspaceReady() { return !!(S.workspace && S.document && S.activeWorkspaceId); }
  function blocks() { return $$('#documentRoot .writing-block'); }
  function blockText(el) { return S.document && S.document.content_format === 'html' ? el.innerHTML : el.innerText; }
  function revision() { return Number.isFinite(Number(S.revision)) ? Number(S.revision) : 0; }
  function docKey() { return workspaceReady() ? S.activeWorkspaceId + ':' + S.document.id : ''; }
  function notify() { return app.reconnect ? Promise.resolve(app.reconnect({ preserveWorkspace: true })).catch(function () {}) : Promise.resolve(); }
  function errorText(e, fallback) { return e && (e.message || e.code) || fallback; }
  function recordMetric(type, startedAt, detail) {
    metrics.push(Object.assign({ type: type, duration_ms: Date.now() - startedAt, at: new Date().toISOString() }, detail || {}));
    if (metrics.length > 100) metrics.shift();
  }

  function serialise() {
    var values = blocks().map(blockText), format = S.document && S.document.content_format || 'plain_text';
    if (values.length <= 1) return { content: values[0] || '', format: format };
    if (format === 'json' && typeof S.document.content === 'string') {
      try {
        var parsed = JSON.parse(S.document.content), parts = Array.isArray(parsed) ? parsed : parsed.sections || parsed.blocks;
        if (Array.isArray(parts)) {
          parts.forEach(function (part, i) {
            if (!part || i >= values.length) return;
            if ('content' in part) part.content = values[i];
            else if ('plain_text' in part) part.plain_text = values[i];
            else if ('text' in part) part.text = values[i];
            else if ('html' in part) part.html = values[i];
            else part.content = values[i];
          });
          return { content: JSON.stringify(parsed), format: 'json' };
        }
      } catch (_) {}
    }
    return { content: values.join('\n\n'), format: format === 'html' ? 'html' : 'plain_text' };
  }

  function diff(a, b) {
    var start = 0, ae = a.length, be = b.length;
    while (start < ae && start < be && a[start] === b[start]) start++;
    while (ae > start && be > start && a[ae - 1] === b[be - 1]) { ae--; be--; }
    return { start: start, end: be, inserted: be - start, deleted: ae - start };
  }

  function offsetOf(el) {
    var list = blocks(), n = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] === el) return n;
      n += (snapshots.has(list[i]) ? snapshots.get(list[i]) : blockText(list[i])).length + 2;
    }
    return 0;
  }

  function selectionInfo(el) {
    var selection = window.getSelection && window.getSelection(), cursor = null, meta = {};
    if (selection && selection.rangeCount && el.contains(selection.anchorNode)) {
      try {
        var range = selection.getRangeAt(0), prefix = range.cloneRange();
        prefix.selectNodeContents(el); prefix.setEnd(range.endContainer, range.endOffset);
        cursor = prefix.toString().length;
        meta = { collapsed: selection.isCollapsed, section_id: el.closest('[data-section-id]') && el.closest('[data-section-id]').dataset.sectionId || null };
      } catch (_) {}
    }
    return { cursor: cursor, meta: meta };
  }

  function mergeEdit(el, change, text) {
    var structured = blocks().length > 1 || S.document && S.document.content_format === 'json';
    var base = structured ? null : offsetOf(el), selection = selectionInfo(el);
    var next = {
      changeStart: base == null ? null : base + change.start,
      changeEnd: base == null ? null : base + change.end,
      inserted: Math.max(0, change.inserted), deleted: Math.max(0, change.deleted),
      cursor: base == null || selection.cursor == null ? null : base + selection.cursor,
      selection: selection.meta,
      sectionId: selection.meta.section_id || null,
      focusText: text.slice(Math.max(0, change.start - 1200), Math.min(text.length, change.end + 1200))
    };
    if (!editMetrics) editMetrics = next;
    else {
      editMetrics.inserted += next.inserted; editMetrics.deleted += next.deleted;
      if (next.changeStart != null) editMetrics.changeStart = editMetrics.changeStart == null ? next.changeStart : Math.min(editMetrics.changeStart, next.changeStart);
      if (next.changeEnd != null) editMetrics.changeEnd = editMetrics.changeEnd == null ? next.changeEnd : Math.max(editMetrics.changeEnd, next.changeEnd);
      editMetrics.cursor = next.cursor; editMetrics.selection = next.selection;
      editMetrics.sectionId = editMetrics.sectionId || next.sectionId; editMetrics.focusText = next.focusText;
    }
    lastEditMetrics = Object.assign({}, editMetrics);
  }

  function updateWordCount() {
    if (updateWordCount.pending) return;
    updateWordCount.pending = true;
    var run = function () {
      updateWordCount.pending = false;
      var el = $('#wordCount'); if (!el) return;
      var text = blocks().map(function (b) { return b.innerText; }).join('\n');
      el.textContent = String((text.trim().match(/\b[\w’'-]+\b/g) || []).length);
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 300 }); else setTimeout(run, 180);
  }

  function signal(type, m, idle) {
    if (!workspaceReady() || typeof api.editSignal !== 'function') return Promise.resolve(null);
    m = m || {};
    var startedAt = Date.now();
    return api.editSignal({
      workspace_id: S.activeWorkspaceId, document_id: S.document.id,
      client_session_id: sessionId, signal_type: type, document_revision: revision(),
      change_start: m.changeStart == null ? null : m.changeStart,
      change_end: m.changeEnd == null ? null : m.changeEnd,
      inserted_chars: Number(m.inserted || 0), deleted_chars: Number(m.deleted || 0),
      cursor_position: m.cursor == null ? null : m.cursor,
      selection: Object.assign({}, m.selection || {}, { section_id: m.sectionId || null, focus_text: m.focusText || null }),
      idle_ms: Math.max(0, Math.round(idle || 0)), is_composing: composing,
      tab_visible: document.visibilityState !== 'hidden', client_event_id: uid()
    }).then(function (response) {
      var decision = response && (response.signal || response.data && response.data.signal) || {};
      recordMetric('edit_signal', startedAt, { signal_type: type, decision: decision.decision || 'silent', depth: decision.depth || null });
      return response;
    });
  }

  function sendEdit() {
    if (!editMetrics || composing) return Promise.resolve(null);
    var m = editMetrics; editMetrics = null;
    return signal('edit', m, 0).catch(function (e) { if (!editMetrics) editMetrics = m; throw e; });
  }

  function flush() {
    clearTimeout(saveTimer);
    if (!draft) return saving || Promise.resolve(null);
    if (!workspaceReady() || draft.key !== docKey()) return Promise.reject(new Error('draft_workspace_changed'));
    if (saving) return saving.then(function () { return draft ? flush() : null; });
    var current = draft, body = serialise(); current.content = body.content; current.format = body.format; draft = current;
    var saveStartedAt = Date.now();
    saving = Promise.resolve(app.saveDocument(current.content, current.format)).then(function (result) {
      recordMetric('autosave', saveStartedAt, { revision: revision(), character_count: current.content.length });
      if (draft === current) draft = null;
      return result;
    }).finally(function () { saving = null; });
    return saving.then(function (result) { return draft ? flush() : result; });
  }

  function staleAnalysis() {
    analysisGeneration++;
    if (S.analysis && ['analysing', 'buffering'].indexOf(S.analysis.status) > -1) {
      S.analysis = { status: 'idle', depth: null, reason: '', result: S.analysis.result || null, hasResult: !!S.analysis.hasResult };
      S.phase = 'ready'; notify();
    }
  }

  function refreshAnalysis(token, depth) {
    if (token !== analysisGeneration || !workspaceReady()) return Promise.resolve(false);
    var id = S.activeWorkspaceId;
    return api.getWorkspace(id).then(function (payload) {
      if (token !== analysisGeneration || S.activeWorkspaceId !== id) return false;
      if (payload.state) S.workspaceState = payload.state;
      if (Array.isArray(payload.issues)) S.issues = payload.issues;
      if (Array.isArray(payload.attachments)) S.attachments = payload.attachments;
      if (payload.latest_analysis) S.latestAnalysis = payload.latest_analysis;
      S.analysis = { status: 'ready', depth: depth, reason: '', result: payload.latest_analysis && payload.latest_analysis.response_snapshot || null, hasResult: true };
      S.phase = 'ready'; notify(); renderSources(); return true;
    });
  }

  function realtimeStatus(value) {
    var data = value && (value.state || value.realtime_state || value);
    return data && data.analysis_state;
  }

  async function pollAnalysis(token, depth) {
    var wid = S.activeWorkspaceId, did = S.document.id;
    for (var i = 0; i < POLL_LIMIT; i++) {
      await wait(POLL_MS);
      if (token !== analysisGeneration || S.activeWorkspaceId !== wid || !S.document || S.document.id !== did) return false;
      var status = realtimeStatus(await api.realtimeState(wid, did));
      if (['ready', 'quiet', 'idle'].indexOf(status) > -1) return refreshAnalysis(token, depth);
      if (status === 'error') throw new Error('analysis_failed');
      S.analysis = { status: 'buffering', depth: depth, reason: 'Analysis is running on the backend.', result: S.analysis && S.analysis.result || null, hasResult: !!(S.analysis && S.analysis.hasResult) };
      S.phase = 'ready'; notify();
    }
    throw new Error('analysis_timeout');
  }

  function handleDecision(response, token) {
    if (!response || token !== analysisGeneration) return Promise.resolve(false);
    var s = response.signal || response.data && response.data.signal || {};
    if (s.decision !== 'analyse') return Promise.resolve(false);
    var depth = s.depth || 'fast', result = response.analysis || {}, status = Number(result.http_status || 0);
    lastAnalysedRevision = revision();
    S.analysis = { status: 'analysing', depth: depth, reason: '', result: S.analysis && S.analysis.result || null, hasResult: !!(S.analysis && S.analysis.hasResult) };
    S.phase = 'ready'; notify();
    if (status >= 400) throw new Error('analysis_failed');
    if (status === 202 || result.pending || ['queued', 'processing', 'accepted', 'already_processing'].indexOf(result.status) > -1) return pollAnalysis(token, depth);
    return refreshAnalysis(token, depth);
  }

  function pauseCycle() {
    clearTimeout(pauseTimer);
    if (!analysisPending || composing || !workspaceReady()) return Promise.resolve(false);
    var token = analysisGeneration, idle = Date.now() - lastInputAt, context = lastEditMetrics || {};
    return sendEdit().catch(function () {}).then(flush).then(function () {
      if (token !== analysisGeneration || lastAnalysedRevision === revision()) return false;
      return signal('pause', context, idle).then(function (response) {
        if (token === analysisGeneration) analysisPending = false;
        return handleDecision(response, token);
      });
    }).catch(function (e) {
      if (token === analysisGeneration) {
        S.analysis = { status: 'error', depth: 'fast', reason: e.message === 'analysis_timeout' ? 'Analysis is taking longer than expected.' : 'Continuous analysis could not complete. Your writing remains saved.', result: null, hasResult: false };
        S.phase = 'ready'; notify();
      }
      return false;
    });
  }

  function schedule(text) {
    clearTimeout(saveTimer); clearTimeout(editTimer); clearTimeout(pauseTimer);
    saveTimer = setTimeout(function () { flush().catch(function () {}); }, SAVE_IDLE_MS);
    editTimer = setTimeout(function () { sendEdit().catch(function () {}); }, EDIT_SIGNAL_IDLE_MS);
    var delay = /\n\s*$/.test(text) ? PARAGRAPH_ANALYSIS_IDLE_MS : /[.!?][\]})"'’”]*\s*$/.test(text) ? SENTENCE_ANALYSIS_IDLE_MS : DEFAULT_ANALYSIS_IDLE_MS;
    pauseTimer = setTimeout(function () { pauseCycle(); }, delay);
  }

  function onInput(event) {
    var el = event.target;
    if (!el.classList || !el.classList.contains('writing-block') || !workspaceReady()) return;
    event.stopImmediatePropagation();
    var empty = el.parentElement && el.parentElement.querySelector('.empty-writing'); if (empty) empty.remove();
    var before = snapshots.has(el) ? snapshots.get(el) : '', after = blockText(el), change = diff(before, after);
    snapshots.set(el, after); if (!change.inserted && !change.deleted) return;
    generation++; analysisPending = true; lastInputAt = Date.now(); staleAnalysis(); mergeEdit(el, change, after);
    draft = { key: docKey(), generation: generation, content: null, format: null };
    var autosave = $('#autosave'); if (autosave) { autosave.classList.add('saving'); var label = autosave.querySelector('span'); if (label) label.textContent = 'Not saved'; }
    updateWordCount(); schedule(after);
  }

  function boundary(type) {
    var token = analysisGeneration;
    flush().then(function () { return token === analysisGeneration ? signal(type, lastEditMetrics || {}, Date.now() - lastInputAt) : null; })
      .then(function (response) { if (response) return handleDecision(response, token); }).catch(function () {});
  }

  function syncSnapshots() { if (workspaceReady()) blocks().forEach(function (b) { if (!snapshots.has(b)) snapshots.set(b, blockText(b)); }); }
  function resetEditing() {
    clearTimeout(saveTimer); clearTimeout(editTimer); clearTimeout(pauseTimer);
    draft = editMetrics = lastEditMetrics = saving = null; analysisPending = false;
    generation++; analysisGeneration++; lastAnalysedRevision = null; snapshots = new WeakMap();
  }

  function wrapActions() {
    ['createWorkspace', 'renameWorkspace', 'archiveWorkspace', 'analyse', 'ask', 'applyIssue', 'quietIssue', 'undoLastChange'].forEach(function (name) {
      if (typeof app[name] !== 'function') return;
      var original = app[name].bind(app);
      app[name] = function () {
        var args = arguments, token = analysisGeneration, startedAt = Date.now();
        var priorIssues = name === 'analyse' ? (S.issues || []).slice() : null;
        return flush().then(function () { return original.apply(app, args); }).then(function (result) {
          recordMetric(name, startedAt, { stale: token !== analysisGeneration });
          if (name === 'analyse' && token !== analysisGeneration) {
            S.issues = priorIssues;
            S.analysis = { status: 'idle', depth: null, reason: '', result: null, hasResult: false };
            S.phase = 'ready'; notify();
          }
          return result;
        });
      };
    });
    if (typeof app.openWorkspace === 'function') {
      var open = app.openWorkspace.bind(app);
      app.openWorkspace = function () { var args = arguments; return flush().then(function () { resetEditing(); return open.apply(app, args); }); };
    }
  }

  function styles() {
    if ($('#liContinuousStyles')) return;
    var style = document.createElement('style'); style.id = 'liContinuousStyles';
    style.textContent = '.li-sources{display:none;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 15px;border:1px solid var(--line2);border-radius:14px;background:rgba(255,255,255,.012)}.li-sources.show{display:flex}.li-source-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.li-source{display:flex;gap:6px;align-items:center;padding:6px 8px;border:1px solid var(--line2);border-radius:9px;font-size:.53rem;color:var(--mute)}.li-source b{max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--silver);font-weight:500}.li-source.error{color:#d79b90}.li-files{padding:12px;border:1px solid var(--line2);border-radius:11px}.li-files-head{display:flex;justify-content:space-between;gap:10px}.li-file-row{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:7px;align-items:center;margin-top:7px;padding:7px;border:1px solid var(--line2);border-radius:8px}.li-file-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.57rem}.li-file-row select{padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:7px;font-size:.54rem}.li-source button,.li-file-row button{color:var(--dim)}@media(max-width:760px){.li-sources{flex-direction:column}.li-file-row{grid-template-columns:1fr}}@media(prefers-reduced-motion:reduce){.analysis-spinner,.analysis-track span,.state-orbit{animation:none!important}}';
    document.head.appendChild(style);
  }

  var roles = { assessment_brief: 'Assessment brief', rubric: 'Rubric', user_draft: 'Draft', notes: 'Notes', teacher_feedback: 'Teacher feedback', reference_material: 'Reference material' };
  function roleLabel(r) { return roles[r] || 'Source'; }
  function guessRole(file) { var n = file.name.toLowerCase(); return /rubric|criteria/.test(n) ? 'rubric' : /feedback|teacher/.test(n) ? 'teacher_feedback' : /draft/.test(n) ? 'user_draft' : /brief|assessment|task/.test(n) ? 'assessment_brief' : /note/.test(n) ? 'notes' : 'reference_material'; }
  function mime(file) {
    if (file.type) return file.type; var n = file.name.toLowerCase();
    if (/\.pdf$/.test(n)) return 'application/pdf'; if (/\.docx$/.test(n)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (/\.doc$/.test(n)) return 'application/msword'; if (/\.md$/.test(n)) return 'text/markdown'; if (/\.txt$/.test(n)) return 'text/plain'; if (/\.rtf$/.test(n)) return 'application/rtf';
    if (/\.png$/.test(n)) return 'image/png'; if (/\.webp$/.test(n)) return 'image/webp'; if (/\.heic$/.test(n)) return 'image/heic'; if (/\.heif$/.test(n)) return 'image/heif'; if (/\.jpe?g$/.test(n)) return 'image/jpeg';
    return 'application/octet-stream';
  }
  function validate(file) {
    var allowed = (api.ATTACHMENT_LIMITS.file || []).concat(api.ATTACHMENT_LIMITS.image || []), max = api.ATTACHMENT_LIMITS.maxBytes || 52428800;
    return !file.size ? 'File is empty' : file.size > max ? 'File is larger than 50 MB' : allowed.indexOf(mime(file)) < 0 ? 'File type is not supported by the backend' : '';
  }
  function roleOptions(selected) { return Object.keys(roles).map(function (r) { return '<option value="' + r + '"' + (r === selected ? ' selected' : '') + '>' + roles[r] + '</option>'; }).join(''); }

  function renderStaged() {
    var root = $('#liStaged'); if (!root) return; root.innerHTML = '';
    staged.forEach(function (item) {
      var row = document.createElement('div'); row.className = 'li-file-row';
      row.innerHTML = '<span></span><select aria-label="Source type">' + roleOptions(item.role) + '</select><button type="button" aria-label="Remove">×</button>';
      row.querySelector('span').textContent = item.file.name + (item.error ? ' · ' + item.error : '');
      row.querySelector('select').onchange = function () { item.role = this.value; };
      row.querySelector('button').onclick = function () { staged = staged.filter(function (x) { return x !== item; }); renderStaged(); };
      root.appendChild(row);
    });
  }

  function addStaged(files) { Array.prototype.forEach.call(files || [], function (file) { staged.push({ file: file, role: guessRole(file), error: validate(file) }); }); renderStaged(); }

  function injectWorkspaceFiles() {
    var form = $('#workspaceForm'); if (!form || $('#liWorkspaceFiles')) return;
    var target = $('#workspaceIntensity').closest('.field'), box = document.createElement('div'); box.className = 'li-files';
    box.innerHTML = '<div class="li-files-head"><div><div class="context-label">Sources <span style="color:var(--dim)">optional</span></div><p>Brief, rubric, draft, notes, feedback or references. Files stay private.</p></div><button class="action" type="button">Add files</button></div><input id="liWorkspaceFiles" type="file" multiple hidden accept=".pdf,.doc,.docx,.txt,.md,.rtf,.png,.jpg,.jpeg,.webp,.heic,.heif"><div id="liStaged"></div>';
    form.insertBefore(box, target); var input = box.querySelector('input'); box.querySelector('button').onclick = function () { input.click(); };
    input.onchange = function () { addStaged(this.files); this.value = ''; };
    form.addEventListener('submit', function () { stagedForCreation = staged.some(function (x) { return !x.error; }); previousWorkspaceId = S.activeWorkspaceId; }, true);
  }

  function sourceName(x) { return x.filename || x.original_filename || x.name || 'Source'; }
  function sourceStatus(x) { return x.ui_status || x.processing_status || x.status || 'uploaded'; }
  function renderSources() {
    if (!sourceStrip || !sourceList) return; sourceStrip.classList.toggle('show', workspaceReady()); if (!workspaceReady()) return;
    var all = (S.attachments || []).concat(uploads); sourceStrip.querySelector('p').textContent = all.length ? all.length + ' source' + (all.length === 1 ? '' : 's') + ' available to Workspace State.' : 'Add briefs, rubrics, drafts, feedback or reference material.';
    sourceList.innerHTML = '';
    all.forEach(function (x) {
      var status = String(sourceStatus(x)), chip = document.createElement('div'); chip.className = 'li-source' + (/error|failed|unsupported/.test(status) ? ' error' : '');
      chip.innerHTML = '<b></b><span></span>' + (x.id && api.removeAttachment ? '<button type="button" aria-label="Remove source">×</button>' : '');
      chip.querySelector('b').textContent = sourceName(x); chip.querySelector('span').textContent = roleLabel(x.ui_role || x.detected_document_type || x.source_role) + ' · ' + status.replace(/_/g, ' ');
      var remove = chip.querySelector('button'); if (remove) remove.onclick = function () { remove.disabled = true; api.removeAttachment(x.id).then(refreshContext).catch(function () { x.ui_status = 'error'; renderSources(); }); };
      sourceList.appendChild(chip);
    });
  }

  function injectSources() {
    if (sourceStrip || !$('.mission-bar')) return;
    sourceStrip = document.createElement('section'); sourceStrip.className = 'li-sources';
    sourceStrip.innerHTML = '<div><div class="context-label">Workspace sources</div><p class="context-copy"></p><div class="li-source-list"></div></div><button class="small-btn" type="button">Add files</button>';
    $('.mission-bar').insertAdjacentElement('afterend', sourceStrip); sourceList = sourceStrip.querySelector('.li-source-list');
    var input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.hidden = true; input.accept = '.pdf,.doc,.docx,.txt,.md,.rtf,.png,.jpg,.jpeg,.webp,.heic,.heif'; document.body.appendChild(input);
    sourceStrip.querySelector('button').onclick = function () { input.click(); };
    input.onchange = function () { var list = Array.prototype.slice.call(this.files || []).map(function (file) { return { file: file, role: guessRole(file) }; }); this.value = ''; queueFiles(list); };
    renderSources();
  }

  function attachment(payload) { var data = payload && payload.data || payload; return data && data.attachment || data || {}; }
  async function pollFile(id) { for (var i = 0; i < FILE_POLL_LIMIT; i++) { var a = attachment(await api.attachmentStatus(id)), status = a.processing_status || a.status; if (['ready', 'partial', 'failed', 'unsupported'].indexOf(status) > -1) return a; await wait(POLL_MS); } throw new Error('attachment_processing_timeout'); }
  function refreshContext() {
    if (!workspaceReady()) return Promise.resolve(false); var id = S.activeWorkspaceId;
    return api.getWorkspace(id).then(function (p) { if (S.activeWorkspaceId !== id) return false; if (p.state) S.workspaceState = p.state; if (Array.isArray(p.attachments)) S.attachments = p.attachments; if (Array.isArray(p.issues)) S.issues = p.issues; notify(); renderSources(); return true; });
  }

  function processFile(item) {
    var file = item.file, problem = validate(file); item.name = file.name; item.ui_role = item.role;
    if (problem) { item.ui_status = 'error'; item.error = problem; renderSources(); return Promise.resolve(); }
    var path, id, fileStartedAt = Date.now(); item.ui_status = 'uploading'; renderSources();
    return api.currentUserId().then(function (user) { if (!user) throw new Error('auth_expired'); path = api.buildObjectPath(user, S.activeWorkspaceId, file.name.replace(/[<>:"/\\|?*]/g, '_')); return api.uploadAttachmentObject(path, file); })
      .then(function () { item.ui_status = 'registering'; renderSources(); return api.registerAttachment({ workspaceId: S.activeWorkspaceId, objectPath: path, filename: file.name, mimeType: mime(file), sizeBytes: file.size, kind: mime(file).indexOf('image/') === 0 ? 'image' : 'document', metadata: { source_role_hint: item.role, detected_document_type_hint: item.role, uploaded_from: 'live_intelligence_workspace' } }); })
      .then(function (r) { id = r && (r.attachment_id || r.id); if (!id) throw new Error('missing_attachment_id'); item.id = id; item.ui_status = 'queued'; renderSources(); return api.queueAttachmentProcessing(id, false); })
      .then(function () { item.ui_status = 'processing'; renderSources(); return api.processAttachment(id, false); })
      .then(function (r) { var status = r && (r.status || r.data && r.data.attachment && r.data.attachment.processing_status); return r && r.pending || ['already_processing', 'queued', 'processing'].indexOf(status) > -1 ? pollFile(id) : attachment(r); })
      .then(function (a) { item.ui_status = a.processing_status || a.status || 'ready'; recordMetric('file_processing', fileStartedAt, { filename: file.name, status: item.ui_status }); return refreshContext(); })
      .catch(function (e) { item.ui_status = 'error'; item.error = errorText(e, 'upload_failed'); renderSources(); });
  }

  function drainFiles() {
    if (uploading || !workspaceReady()) return; var next = uploads.find(function (x) { return !x.done; });
    if (!next) { uploads = []; renderSources(); return; }
    uploading = true; next.done = true; processFile(next).finally(function () { uploading = false; drainFiles(); });
  }
  function queueFiles(items) { if (!workspaceReady()) return; items.forEach(function (x) { x.ui_status = validate(x.file) ? 'error' : 'waiting'; x.error = validate(x.file); uploads.push(x); }); renderSources(); drainFiles(); }
  function uploadStaged() {
    if (!stagedForCreation || !workspaceReady() || S.phase !== 'ready') return;
    if (previousWorkspaceId && S.activeWorkspaceId === previousWorkspaceId) return;
    var list = staged.filter(function (x) { return !x.error; }).map(function (x) { return { file: x.file, role: x.role }; });
    stagedForCreation = false; previousWorkspaceId = null; staged = []; renderStaged(); queueFiles(list);
  }

  function enhance() { setTimeout(function () { styles(); injectWorkspaceFiles(); injectSources(); syncSnapshots(); renderSources(); uploadStaged(); }, 0); }
  function bind() {
    var root = $('#documentRoot'); if (!root || root.dataset.continuousBound) return; root.dataset.continuousBound = '1';
    root.addEventListener('input', onInput, true);
    root.addEventListener('compositionstart', function (e) { if (e.target.classList.contains('writing-block')) { composing = true; clearTimeout(pauseTimer); } }, true);
    root.addEventListener('compositionend', function (e) { if (e.target.classList.contains('writing-block')) { composing = false; onInput(e); } }, true);
    root.addEventListener('focusin', function (e) { if (e.target.classList.contains('writing-block')) signal('focus', {}, 0).catch(function () {}); }, true);
    root.addEventListener('focusout', function (e) { if (e.target.classList.contains('writing-block')) setTimeout(function () { boundary('blur'); }, 100); }, true);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') boundary('visibility_hidden'); });
    window.addEventListener('beforeunload', function (e) { if (draft || saving) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('online', function () { if (draft) flush().catch(function () {}); });
  }

  wrapActions(); styles(); bind(); injectWorkspaceFiles(); injectSources(); syncSnapshots();
  if (app.onChange) app.onChange(function () { S = app.state; enhance(); });
  enhance();
  V.liContinuous = { endpoints: ['live-intelligence-realtime', 'live-intelligence-workspace', 'live-intelligence-runtime', 'live-intelligence-changes', 'live-intelligence-files'], metrics: metrics, getMetrics: function () { return metrics.slice(); }, constants: { saveIdleMs: SAVE_IDLE_MS, editSignalIdleMs: EDIT_SIGNAL_IDLE_MS, defaultAnalysisIdleMs: DEFAULT_ANALYSIS_IDLE_MS, sentenceAnalysisIdleMs: SENTENCE_ANALYSIS_IDLE_MS, paragraphAnalysisIdleMs: PARAGRAPH_ANALYSIS_IDLE_MS }, flush: flush, runNow: function () { lastInputAt = Date.now() - DEFAULT_ANALYSIS_IDLE_MS; return pauseCycle(); }, addFiles: function (files, role) { queueFiles(Array.prototype.slice.call(files || []).map(function (file) { return { file: file, role: role || guessRole(file) }; })); } };
})(window.VISION);
