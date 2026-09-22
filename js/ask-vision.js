window.VISION = window.VISION || {};
(function () {
  var state = {
    taskId: null,
    loading: false,
    initialized: false,
  };

  var _submitHandler = null;
  var _keyHandler = null;
  var _chipHandler = null;
  var MEMORY_LABELS = {
    main_blocker: 'Main blocker',
    main_skill_gap: 'Main skill gap',
    current_level: 'Current level',
    preferred_task_minutes: 'Preferred task time'
  };

  function q(id) { return document.getElementById(id); }

  function installMemoryStyles() {
    if (q('avMemoryStyles')) return;
    var style = document.createElement('style');
    style.id = 'avMemoryStyles';
    style.textContent =
      '.av-memory{margin-top:16px;padding:14px;border:1px solid rgba(214,177,78,.28);border-radius:14px;background:rgba(214,177,78,.06)}' +
      '.av-memory-title{font-weight:650;margin-bottom:5px}.av-memory-note{font-size:.84rem;opacity:.76;line-height:1.45}' +
      '.av-memory-row{margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)}' +
      '.av-memory-key{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;opacity:.64}' +
      '.av-memory-value{margin-top:3px;line-height:1.45}.av-memory-old{font-size:.76rem;opacity:.6;margin-top:3px}' +
      '.av-memory-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:13px}.av-memory-btn{border:1px solid rgba(214,177,78,.42);border-radius:999px;padding:8px 13px;background:transparent;color:inherit;cursor:pointer}' +
      '.av-memory-btn.primary{background:rgba(214,177,78,.17)}.av-memory-btn:disabled{opacity:.45;cursor:default}.av-memory-state{margin-top:10px;font-size:.82rem;line-height:1.45}';
    document.head.appendChild(style);
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    installMemoryStyles();

    var submitBtn = q('avSubmit');
    var input = q('avInput');
    var chips = q('avChips');

    if (!q('avWrap')) return;

    if (submitBtn) {
      _submitHandler = function () { onSubmit(); };
      submitBtn.addEventListener('click', _submitHandler);
    }
    if (input) {
      _keyHandler = function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(); }
      };
      input.addEventListener('keydown', _keyHandler);
    }
    if (chips) {
      _chipHandler = function (e) {
        var btn = e.target.closest('.av-chip[data-mode]');
        if (btn) onChip(btn.dataset.mode, btn.dataset.label || btn.textContent.trim());
      };
      chips.addEventListener('click', _chipHandler);
    }
  }

  function setLoading(v) {
    state.loading = v;
    var btn = q('avSubmit');
    var st = q('avStatus');
    if (btn) {
      btn.disabled = v;
      btn.innerHTML = v ? 'Thinking…' : 'Ask <span class="arr">→</span>';
    }
    if (st) {
      st.style.display = v ? '' : 'none';
      st.className = 'av-status';
      st.textContent = v ? 'Analyst is thinking…' : '';
    }
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }

  function renderMarkdown(text) {
    if (!text) return '';
    var html = escHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^[•\-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(\s*<li>)/g, '$1$2');
    html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, '<ul>$&</ul>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function showError(msg) {
    var st = q('avStatus');
    var resp = q('avResponse');
    if (st) {
      st.style.display = '';
      st.className = 'av-status av-status-error';
      st.textContent = msg;
    }
    if (resp) resp.innerHTML = '';
    setLoading(false);
  }

  async function memoryRpc(name, args) {
    if (!window.VISION || !window.VISION.sb || typeof window.VISION.sb.rpc !== 'function') {
      return { ok: false, error: 'memory_unavailable' };
    }
    try {
      var result = await window.VISION.sb.rpc(name, args || {});
      if (result.error) return { ok: false, error: result.error.message || 'rpc_error' };
      return result.data || { ok: false, error: 'empty_response' };
    } catch (e) {
      return { ok: false, error: 'connection_failed' };
    }
  }

  async function latestPendingMemoryProposal() {
    var data = await memoryRpc('list_profile_memory_proposals_v1', { p_limit: 20 });
    if (!data || data.ok !== true || !Array.isArray(data.proposals)) return null;
    return data.proposals.find(function (item) { return item && item.status === 'pending'; }) || null;
  }

  function valueText(key, value) {
    if (value == null || value === '') return 'Not set';
    if (key === 'preferred_task_minutes') return String(value) + ' minutes';
    return String(value);
  }

  function memoryErrorText(code) {
    var map = {
      rate_limited: 'Too many profile changes were attempted. Try again later.',
      proposal_expired: 'This suggestion expired and was not saved.',
      profile_changed: 'Your profile changed after this suggestion was created, so it was not overwritten.',
      profile_changed_since_acceptance: 'Your profile changed again, so this older change cannot be undone safely.',
      proposal_not_found: 'This suggestion is no longer available.',
      proposal_not_pending: 'This suggestion has already been decided.',
      revert_window_expired: 'The 30-day undo window has ended.'
    };
    return map[code] || 'The profile change could not be completed safely.';
  }

  function renderMemoryProposal(host, proposal) {
    if (!host || !proposal || !proposal.id || proposal.status !== 'pending') return;
    var oldValues = proposal.previous_values || {};
    var changes = proposal.proposed_changes || {};
    var keys = Object.keys(changes).filter(function (key) { return Object.prototype.hasOwnProperty.call(MEMORY_LABELS, key); });
    if (!keys.length) return;

    var card = document.createElement('div');
    card.className = 'av-memory';
    card.dataset.proposalId = proposal.id;
    var rows = '';
    keys.forEach(function (key) {
      rows += '<div class="av-memory-row"><div class="av-memory-key">' + escHtml(MEMORY_LABELS[key]) + '</div>' +
        '<div class="av-memory-value">' + escHtml(valueText(key, changes[key])) + '</div>' +
        '<div class="av-memory-old">Current: ' + escHtml(valueText(key, oldValues[key])) + '</div></div>';
    });
    card.innerHTML = '<div class="av-memory-title">Save this to your profile?</div>' +
      '<div class="av-memory-note">The Analyst suggested this based on your message. Nothing changes unless you approve it.</div>' + rows +
      '<div class="av-memory-actions"><button type="button" class="av-memory-btn primary" data-memory-action="accept">Save to profile</button>' +
      '<button type="button" class="av-memory-btn" data-memory-action="reject">Don’t save</button></div>' +
      '<div class="av-memory-state" aria-live="polite"></div>';
    host.appendChild(card);

    var buttons = card.querySelectorAll('[data-memory-action]');
    var status = card.querySelector('.av-memory-state');
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', async function () {
        Array.prototype.forEach.call(buttons, function (b) { b.disabled = true; });
        status.textContent = button.dataset.memoryAction === 'accept' ? 'Saving…' : 'Discarding…';
        var result = await memoryRpc('decide_profile_memory_proposal_v1', {
          p_proposal_id: proposal.id,
          p_decision: button.dataset.memoryAction
        });
        if (!result || result.ok !== true) {
          status.textContent = memoryErrorText(result && result.error);
          Array.prototype.forEach.call(buttons, function (b) { b.disabled = false; });
          return;
        }
        if (result.status === 'rejected') {
          status.textContent = 'Not saved. Your profile was unchanged.';
          return;
        }
        status.textContent = 'Saved to your profile. You can undo this for 30 days.';
        var actions = card.querySelector('.av-memory-actions');
        actions.innerHTML = '<button type="button" class="av-memory-btn" data-memory-undo>Undo profile change</button>';
        var undo = actions.querySelector('[data-memory-undo]');
        undo.addEventListener('click', async function () {
          undo.disabled = true;
          status.textContent = 'Undoing…';
          var reverted = await memoryRpc('revert_profile_memory_proposal_v1', { p_proposal_id: proposal.id });
          if (!reverted || reverted.ok !== true) {
            status.textContent = memoryErrorText(reverted && reverted.error);
            undo.disabled = false;
            return;
          }
          status.textContent = 'Profile change undone.';
        });
      });
    });
  }

  async function showLatestMemoryProposal(host) {
    if (!host) return;
    var existing = host.querySelector('.av-memory');
    if (existing) existing.remove();
    var proposal = await latestPendingMemoryProposal();
    if (proposal) renderMemoryProposal(host, proposal);
  }

  function showResponse(data) {
    setLoading(false);
    var resp = q('avResponse');
    var cb = q('avCacheBadge');
    var quota = q('avQuota');
    var st = q('avStatus');

    if (!data || !data.answer) {
      showError('Analyst did not return an answer. Try rephrasing your question.');
      return;
    }

    var html = '<div class="av-answer">' + renderMarkdown(data.answer) + '</div>';

    if (data.sections) {
      var s = data.sections;
      html += '<div class="av-sections">';
      if (s.do_now)  html += '<div class="av-section"><div class="av-sec-label">Do now</div><div class="av-sec-body">' + escHtml(s.do_now) + '</div></div>';
      if (s.proof)   html += '<div class="av-section"><div class="av-sec-label">Proof to show</div><div class="av-sec-body">' + escHtml(s.proof) + '</div></div>';
      if (s.mistake) html += '<div class="av-section av-sec-warn"><div class="av-sec-label">Common mistake</div><div class="av-sec-body">' + escHtml(s.mistake) + '</div></div>';
      html += '</div>';
    }

    if (resp) {
      resp.innerHTML = html;
      showLatestMemoryProposal(resp);
    }
    if (st) st.style.display = 'none';

    if (cb) {
      cb.style.display = data.cached ? '' : 'none';
      cb.textContent = 'Cached answer';
    }
    if (quota && data.quota) showQuota(data.quota);
  }

  function showQuota(q_data) {
    var el = q('avQuota');
    if (!el) return;
    var used = q_data.used || 0;
    var limit = q_data.limit || 50;
    var remaining = typeof q_data.remaining === 'number' ? q_data.remaining : (limit - used);
    var pct = Math.max(0, Math.min(100, (remaining / limit) * 100));
    el.innerHTML =
      '<div class="av-quota-bar"><div class="av-quota-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="av-quota-text">' + remaining + ' of ' + limit + ' Analyst questions remaining this month</div>';
    el.style.display = '';
  }

  function onChip(mode, label) {
    if (state.loading) return;
    var inp = q('avInput');
    if (inp) inp.value = label || mode;
    onSubmit(mode);
  }

  function onSubmit(forcedMode) {
    if (state.loading) return;
    var inp = q('avInput');
    if (!inp) return;
    var text = inp.value.trim();
    if (!text) return;
    ask(text, forcedMode || 'custom');
  }

  function ask(question, mode) {
    if (!state.taskId) {
      showError('No task selected. Open a task first.');
      return;
    }
    if (!window.VISION || !window.VISION.api || !window.VISION.api.askVision) {
      showError('Analyst is not available right now.');
      return;
    }
    setLoading(true);
    var resp = q('avResponse');
    if (resp) resp.innerHTML = '';
    var cb = q('avCacheBadge');
    if (cb) cb.style.display = 'none';

    window.VISION.api.askVision(state.taskId, question, mode)
      .then(function (result) { showResponse(result); })
      .catch(function (err) {
        var code = (err && err.error) || '';
        var temporary = 'Analyst is temporarily unavailable. Try again in a moment.';
        var map = {
          quota_exceeded: "You've used all 50 Analyst questions this month.",
          no_profile: 'Finish onboarding to unlock your Analyst.',
          no_active_task: 'No active task to analyse. Open a task first.',
          task_not_found: 'That task is no longer available. Pick another task.',
          clarification_required: (err && err.message) ||
            'Answer the question on your dashboard to unlock today’s task.',
          unauthorized: 'Please sign in again to continue.',
          invalid_token: 'Please sign in again to continue.',
          upgrade_required: 'Analyst requires Vision Pro.',
          ai_unavailable: temporary, ai_error: temporary, ai_timeout: temporary,
          timeout: temporary, empty_response: temporary, invalid_response: temporary,
          service_unavailable: temporary,
          connection_failed: 'Could not reach the Analyst. Check your connection and try again.'
        };
        var msg = map[code] || (err && err.message) || 'Could not reach the Analyst. Try again.';
        showError(msg);
      });
  }

  function initAskVision(taskId) {
    state.taskId = taskId;
    var inp = q('avInput');
    var resp = q('avResponse');
    var st = q('avStatus');
    var quota = q('avQuota');
    var cb = q('avCacheBadge');
    var wrap = q('avWrap');

    if (inp) inp.value = '';
    if (resp) {
      resp.innerHTML = '';
      showLatestMemoryProposal(resp);
    }
    if (st) { st.style.display = 'none'; st.className = 'av-status'; }
    if (quota) quota.style.display = 'none';
    if (cb) cb.style.display = 'none';
    if (wrap) wrap.style.display = '';
    setLoading(false);
  }

  document.addEventListener('appReady', init);

  window.VISION.askVisionUI = { initAskVision: initAskVision };
})();
