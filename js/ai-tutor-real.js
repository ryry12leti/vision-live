/* Real Analyst adapter for the restored co-founder Vision Chamber.
   It owns only the data/chat layer and leaves the Chamber visuals in ai-tutor.html intact.
   This flag is read by the legacy inline script in ai-tutor.html — it causes the old
   fake Strategist greeting to be skipped so no legacy content ever appears. */
window.__visionRealTutor = true;
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var state = {
    tasks: [], task: null, mode: 'custom', loading: false,
    profile: null, xp: null, scores: null, standing: null, quota: null
  };
  var thread = $('#thread');
  var chips = $('#chips');
  var input = $('#ask');
  var send = $('#send');
  var orb = $('#orb');
  var MEMORY_LABELS = {
    main_blocker: 'Main blocker',
    main_skill_gap: 'Main skill gap',
    current_level: 'Current level',
    preferred_task_minutes: 'Preferred task time'
  };

  function escapeHtml(value) {
    var node = document.createElement('div');
    node.textContent = String(value == null ? '' : value);
    return node.innerHTML;
  }

  function renderText(value) {
    var html = escapeHtml(value || '');
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/^[•\-] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, '<ul>$&</ul>');
    return html.replace(/\n/g, '<br>');
  }

  function scrollBottom() { if (thread) thread.scrollTop = thread.scrollHeight; }

  function analystLine(html) {
    var wrap = document.createElement('div');
    wrap.className = 'vc-msg ai';
    wrap.innerHTML = '<span class="dot"></span><div class="body">' + html + '</div>';
    thread.appendChild(wrap); scrollBottom(); return wrap;
  }

  function userLine(text) {
    var wrap = document.createElement('div');
    wrap.className = 'vc-msg you'; wrap.textContent = text;
    thread.appendChild(wrap); scrollBottom();
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
    var result = await memoryRpc('list_profile_memory_proposals_v1', { p_limit: 20 });
    if (!result || result.ok !== true || !Array.isArray(result.proposals)) return null;
    return result.proposals.find(function (item) { return item && item.status === 'pending'; }) || null;
  }

  function memoryValue(key, value) {
    if (value == null || value === '') return 'Not set';
    return key === 'preferred_task_minutes' ? String(value) + ' minutes' : String(value);
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

  function renderMemoryProposal(proposal) {
    if (!proposal || !proposal.id || proposal.status !== 'pending' || !thread) return;
    var currentPending = thread.querySelector('[data-vc-memory-pending]');
    if (currentPending) currentPending.remove();
    var changes = proposal.proposed_changes || {};
    var previous = proposal.previous_values || {};
    var keys = Object.keys(changes).filter(function (key) { return Object.prototype.hasOwnProperty.call(MEMORY_LABELS, key); });
    if (!keys.length) return;

    var rows = '<div class="vc-memory-grid">';
    keys.forEach(function (key) {
      rows += '<div class="vc-memory-row"><div class="k">' + escapeHtml(MEMORY_LABELS[key]) + '</div>' +
        '<div class="v">' + escapeHtml(memoryValue(key, changes[key])) + '</div>' +
        '<div class="old">Current: ' + escapeHtml(memoryValue(key, previous[key])) + '</div></div>';
    });
    rows += '</div>';
    var wrap = analystLine('<span class="lead">Save this to your profile?</span>' +
      '<div class="vc-memory-note">The Analyst suggested this from your message. Nothing changes unless you approve it.</div>' + rows +
      '<div class="vc-memory-actions"><button type="button" class="vc-memory-btn primary" data-memory-action="accept">Save to profile</button>' +
      '<button type="button" class="vc-memory-btn" data-memory-action="reject">Don’t save</button></div>' +
      '<div class="vc-memory-status" aria-live="polite"></div>');
    wrap.setAttribute('data-vc-memory-pending', proposal.id);
    var body = wrap.querySelector('.body');
    var status = body.querySelector('.vc-memory-status');
    var buttons = body.querySelectorAll('[data-memory-action]');
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
        wrap.removeAttribute('data-vc-memory-pending');
        if (result.status === 'rejected') {
          status.textContent = 'Not saved. Your profile was unchanged.';
          return;
        }
        status.textContent = 'Saved to your profile. You can undo this for 30 days.';
        var actions = body.querySelector('.vc-memory-actions');
        actions.innerHTML = '<button type="button" class="vc-memory-btn" data-memory-undo>Undo profile change</button>';
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
          await refreshCanonicalState();
        });
        await refreshCanonicalState();
      });
    });
    scrollBottom();
  }

  async function showLatestMemoryProposal() {
    var proposal = await latestPendingMemoryProposal();
    if (proposal) renderMemoryProposal(proposal);
  }

  function addShellStyles() {
    if ($('#chamber-shared-nav-style')) return;
    var style = document.createElement('style');
    style.id = 'chamber-shared-nav-style';
    style.textContent = [
      '.vnav{z-index:120!important}',
      '.chamber-live-status{position:fixed;right:clamp(18px,3vw,38px);top:86px;z-index:121;font-size:.48rem;letter-spacing:.24em;text-transform:uppercase;color:var(--dim);pointer-events:none}',
      '.chamber-live-status b{font-weight:500;color:var(--gold)}',
      '.chamber-live-status i{display:inline-block;width:5px;height:5px;border-radius:50%;margin-right:7px;background:var(--gold);box-shadow:0 0 8px var(--gold-g)}',
      '.chamber-with-shared-nav .vc-stage{padding-top:108px}',
      '.vc-quota{font-size:.46rem;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin-top:8px}',
      '.vc-quota.warn{color:var(--rose,#e9a0a0)}',
      '.vc-quota.exhausted{color:var(--rose,#e9a0a0);opacity:.9}',
      '.vc-quota.unavailable{color:var(--dim);font-style:italic}',
      '.vc-retry{display:inline-block;margin-top:11px;padding:6px 15px;font-size:.58rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);background:transparent;border:1px solid rgba(230,196,106,.4);border-radius:100px;cursor:pointer;text-decoration:none;transition:background .2s,border-color .2s}',
      '.vc-retry:hover{background:rgba(230,196,106,.1);border-color:rgba(230,196,106,.7)}',
      '.vc-retry:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(230,196,106,.55)}',
      '.vc-retry:disabled{opacity:.45;cursor:default}',
      '.vc-read.score .vc-score-meta{gap:14px}',
      '.vc-analyst-brand{padding:14px 0 10px;border-bottom:1px solid rgba(230,196,106,.1);margin-bottom:2px}',
      '.vc-analyst-brand .abt{font-family:"Cormorant Garamond",Cormorant,Georgia,serif;font-size:.88rem;font-weight:400;color:var(--gold);letter-spacing:.04em;line-height:1.3}',
      '.vc-analyst-brand .abs{font-size:.52rem;letter-spacing:.09em;color:var(--dim);line-height:1.5;margin-top:5px}',
      '.vc-memory-note{font-size:.72rem;color:var(--dim);line-height:1.5;margin-top:5px}',
      '.vc-memory-grid{margin-top:12px;border-top:1px solid rgba(230,196,106,.16)}',
      '.vc-memory-row{padding:9px 0;border-bottom:1px solid rgba(230,196,106,.1)}',
      '.vc-memory-row .k{font-size:.52rem;letter-spacing:.12em;text-transform:uppercase;color:var(--dim)}',
      '.vc-memory-row .v{font-size:.76rem;margin-top:3px}.vc-memory-row .old{font-size:.62rem;color:var(--dim);margin-top:3px}',
      '.vc-memory-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}',
      '.vc-memory-btn{padding:7px 13px;border-radius:999px;border:1px solid rgba(230,196,106,.42);background:transparent;color:var(--gold);font-size:.56rem;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}',
      '.vc-memory-btn.primary{background:rgba(230,196,106,.14)}.vc-memory-btn:disabled{opacity:.45;cursor:default}',
      '.vc-memory-status{font-size:.65rem;color:var(--dim);line-height:1.45;margin-top:9px}',
      '.nav-avatar-wrap{position:relative;width:36px;height:36px;flex-shrink:0;cursor:pointer;transition:transform .25s}',
      '.nav-avatar-wrap:hover{transform:scale(1.08)}',
      '.nav-avatar-halo{position:absolute;inset:-3px;border-radius:50%;border:1.5px solid transparent;background:linear-gradient(135deg,var(--gold),var(--gold2)) border-box;-webkit-mask:linear-gradient(#fff 0 0) padding-box,linear-gradient(#fff 0 0);-webkit-mask-composite:destination-out;mask-composite:exclude;opacity:.6}',
      '.nav-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,rgba(230,196,106,.18),rgba(230,196,106,.06));display:grid;place-items:center;overflow:hidden;border:1px solid rgba(230,196,106,.2)}',
      '.nav-av-init{font-size:.72rem;font-weight:300;color:var(--champagne);letter-spacing:.04em}',
      '.nav-badge{position:absolute;bottom:-1px;right:-1px;width:14px;height:14px;border-radius:50%;background:var(--gold);display:grid;place-items:center}',
      '.nav-badge svg{width:7px;height:7px;color:#1a140a}',
      '@media(max-width:880px){.chamber-with-shared-nav .vc-stage{padding-top:92px}.chamber-live-status{top:66px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function installSharedNavigation() {
    if ($('.vnav')) return;
    var legacyHeader = $('header.vc-top');
    if (!legacyHeader) return;
    addShellStyles();
    var nav = document.createElement('nav');
    nav.className = 'vnav';
    nav.innerHTML = '<div class="vnav-in">' +
      '<a href="dashboard.html" class="vlogo">VISION</a>' +
      '<div class="vlinks">' +
        '<a href="percentile.html"><svg class="ico" viewBox="0 0 24 24"><path d="M12 2l10 10-10 10L2 12z"/></svg>Ranking</a>' +
        '<a href="dashboard.html" class="home"><svg class="ico" viewBox="0 0 24 24"><path d="M4 11l8-7 8 7M6 10v10h12V10"/></svg>Home</a>' +
        '<a href="ai-tutor.html" class="active"><svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>Analyst</a>' +
        '<a href="tasks.html" id="navTask"><svg class="ico" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>Tasks</a>' +
        '<a href="profile.html"><svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>Profile</a>' +
      '</div><div class="nav-spacer"></div>' +
      '<a href="profile.html" class="nav-avatar-wrap" title="Your VISION Profile">' +
        '<div class="nav-avatar-halo"></div><div class="nav-avatar"><span class="nav-av-init" id="navAvInit">?</span></div>' +
        '<div class="nav-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.7 9l2.3-5h14l2.3 5L12 22 2.7 9z"/></svg></div>' +
      '</a></div>';
    legacyHeader.replaceWith(nav);
    document.body.classList.add('chamber-with-shared-nav');
    var status = document.createElement('div');
    status.className = 'chamber-live-status';
    status.innerHTML = '<i></i><b id="vcMode">Initializing</b>';
    document.body.appendChild(status);
    var rail = document.getElementById('rail');
    if (rail && !document.getElementById('analystBrand')) {
      var brand = document.createElement('div');
      brand.id = 'analystBrand';
      brand.className = 'vc-analyst-brand';
      brand.innerHTML = '<div class="abt">Clear insight. Better next moves.</div>' +
        '<div class="abs">Your Analyst sees your goal, tasks, proof and progress — then tells you what matters most next.</div>';
      rail.insertBefore(brand, rail.firstChild);
    }
  }

  function renderNavIdentity() {
    var name = (state.profile && state.profile.name) || 'You';
    var initial = name.trim().charAt(0).toUpperCase() || '?';
    var el = $('#navAvInit'); if (el) el.textContent = initial;
  }

  function setMode(mode) {
    state.mode = mode || 'custom';
    Array.prototype.forEach.call(chips.querySelectorAll('button[data-mode]'), function (button) {
      button.classList.toggle('active', button.dataset.mode === state.mode);
    });
  }

  function makeChip(label, mode, handler) {
    var button = document.createElement('button');
    button.className = 'vc-chip'; button.type = 'button';
    if (mode) button.dataset.mode = mode;
    button.textContent = label;
    button.addEventListener('click', function () {
      if (handler) handler(); else setMode(mode);
    });
    return button;
  }

  function renderChips() {
    chips.innerHTML = '';
    chips.appendChild(makeChip('Explain this', 'explain'));
    chips.appendChild(makeChip('Give an example', 'example'));
    chips.appendChild(makeChip('Make it easier', 'easier'));
    chips.appendChild(makeChip('Make it harder', 'harder'));
    chips.appendChild(makeChip('Proof to upload', 'proof'));
    chips.appendChild(makeChip("I'm stuck", 'stuck'));
    chips.appendChild(makeChip('Change Task', '', nextTask));
    setMode(state.mode);
  }

  function updateRail(quota) {
    if (quota && typeof quota === 'object' && typeof quota.remaining === 'number') state.quota = quota;
    var task = state.task || {};
    var profile = state.profile || {};
    var xp = state.xp || {};
    var q = state.quota;
    var goal = $('#rGoal'), rank = $('#rRank'), focus = $('#rFocus'), score = $('#rScore'), proven = $('#rProven');
    if (goal) goal.textContent = profile.primaryGoal || task.goalType || 'Your current path';
    if (rank) {
      var standingName = (state.standing && state.standing.name) || null;
      if (!standingName) {
        try { var pct = window.VISION && VISION.core && VISION.core.getPercentile && VISION.core.getPercentile(); standingName = pct && pct.tier && pct.tier.title; } catch (e2) {}
      }
      rank.textContent = standingName || profile.path || 'Analyst active';
    }
    if (focus) focus.textContent = task.title || 'Choose a task';
    var canon = state.canonical || {};
    var pointsToday = (canon.verifiedPointsToday != null) ? canon.verifiedPointsToday : Number(xp.todayXp || 0);
    var proofsToday = (canon.acceptedProofsToday != null) ? canon.acceptedProofsToday : Number(xp.completedToday || 0);
    if (score) score.textContent = pointsToday;
    if (proven) proven.textContent = proofsToday + ' proof' + (proofsToday === 1 ? '' : 's') + ' today';
    if (canon && typeof canon.verifiedPointsToday === 'number' && canon.verifiedPointsToday > 0 && canon.acceptedProofsToday === 0) {
      console.warn('[Analyst] invariant violation: verifiedPointsToday >0 but acceptedProofsToday==0');
    }
    var quotaEl = $('#rAnalystQuota');
    if (!quotaEl && score && score.parentNode) {
      quotaEl = document.createElement('div'); quotaEl.id = 'rAnalystQuota'; quotaEl.className = 'vc-quota'; score.parentNode.appendChild(quotaEl);
    }
    if (quotaEl) {
      if (!q || typeof q.remaining !== 'number') { quotaEl.textContent = 'Question limit unavailable'; quotaEl.className = 'vc-quota unavailable'; }
      else if (q.remaining === 0) { quotaEl.textContent = 'Monthly Analyst limit reached'; quotaEl.className = 'vc-quota exhausted'; }
      else { var limit = Number(q.limit || 50); quotaEl.textContent = q.remaining + ' of ' + limit + ' Analyst questions remaining this month'; quotaEl.className = 'vc-quota' + (q.remaining <= 10 ? ' warn' : ''); }
    }
    if (send && !state.loading) send.disabled = (q && typeof q.remaining === 'number' && q.remaining === 0);
  }

  function populateTaskContext(task) {
    var ctx = $('#vcTaskContext');
    if (!ctx || !task) return;
    ctx.style.display = '';
    var titleEl = $('#vcTaskTitle'); if (titleEl) titleEl.textContent = task.title || '—';
    var whyEl = $('#vcTaskWhy'); if (whyEl) whyEl.textContent = task.whyPersonalised || task.why_personalised || '—';
    var proofEl = $('#vcTaskProof'); if (proofEl) proofEl.textContent = task.proofMustShow || task.proof_must_show || task.proofPrompt || task.proof_prompt || '—';
  }

  function announceTask(cycled) {
    var task = state.task; if (!task) return;
    input.placeholder = 'Ask your Analyst about: ' + task.title;
    populateTaskContext(task);
    updateRail();
    var why = task.whyPersonalised || task.why_personalised || '';
    var proof = task.proofMustShow || task.proof_must_show || task.proofPrompt || task.proof_prompt || '';
    var body = '<span class="lead">Current task</span><b>' + escapeHtml(task.title) + '</b>';
    if (why) body += '<br><em>' + escapeHtml(why) + '</em>';
    if (proof) body += '<br><small style="color:var(--dim);font-size:.72rem">Proof must show: ' + escapeHtml(proof) + '</small>';
    if (!why && !cycled) body += '<br><em>Ask for an explanation, example, easier version, proof idea, or help when stuck.</em>';
    if (cycled) body += '<br><em>Switched to your next task.</em>';
    analystLine(body);
  }

  function nextTask() {
    if (!state.tasks.length) return;
    var index = state.tasks.findIndex(function (task) { return task.id === state.task.id; });
    state.task = state.tasks[(index + 1) % state.tasks.length]; state.mode = 'custom';
    announceTask(true); renderChips();
  }

  function done() {
    var stage = document.querySelector('.vc-stage');
    if (stage) stage.classList.remove('is-loading');
  }

  function setLoading(value) {
    state.loading = value;
    var q = state.quota;
    send.disabled = value || (q && typeof q.remaining === 'number' && q.remaining === 0);
    if (orb) orb.classList.toggle('think', value);
    var mode = $('#vcMode'); if (mode) mode.textContent = value ? 'Thinking' : 'ANALYST ACTIVE';
  }

  function typing() {
    var wrap = document.createElement('div'); wrap.className = 'vc-typing'; wrap.id = 'realTutorTyping';
    wrap.innerHTML = '<span></span><span></span><span></span>'; thread.appendChild(wrap); scrollBottom();
  }

  function untyping() { var el = $('#realTutorTyping'); if (el) el.remove(); }

  function renderAnswer(data) {
    if (!data || typeof data.answer !== 'string' || !data.answer.trim()) {
      analystLine('<span class="lead">Analyst temporarily unavailable</span>The Analyst returned no answer. Try again in a moment.');
      return;
    }
    var label = data.cached ? '<span class="lead">Cached answer</span>' : '<span class="lead">Analyst</span>';
    analystLine(label + renderText(data.answer));
    var s = data.sections || {};
    var rows = [['Do now', s.do_now], ['Proof to show', s.proof], ['Example', s.example], ['Common mistake', s.mistake]].filter(function (row) { return row[1]; });
    if (rows.length) {
      var html = '<div class="vc-dna"><div class="dnah">◆ Task guidance</div><div class="vc-dna-grid">';
      rows.forEach(function (row) { html += '<div class="vc-dna-row full"><div class="k">' + escapeHtml(row[0]) + '</div><div class="v">' + escapeHtml(row[1]) + '</div></div>'; });
      html += '</div></div>'; thread.insertAdjacentHTML('beforeend', html); scrollBottom();
    }
    if (data.quota && typeof data.quota.remaining === 'number') updateRail(data.quota);
    showLatestMemoryProposal();
  }

  async function refreshCanonicalState() {
    var results = await Promise.all([
      window.VISION.api.getProfile(),
      window.VISION.api.getStanding ? window.VISION.api.getStanding().catch(function(){return null;}) : Promise.resolve(null),
      (window.VISION.data && typeof window.VISION.data.getCanonicalFacts === 'function') ? window.VISION.data.getCanonicalFacts().catch(function(){return null;}) : Promise.resolve(null)
    ]);
    state.profile = results[0] || {};
    if (results[1]) state.standing = results[1];
    if (results[2]) state.canonical = results[2];
    renderNavIdentity(); updateRail();
  }

  async function submit() {
    var question = (input.value || '').trim();
    if (!question || !state.task || state.loading) return;
    if (state.quota && typeof state.quota.remaining === 'number' && state.quota.remaining === 0) {
      analystLine('<span class="lead">Monthly Analyst limit reached</span>You\'ve used all 50 Analyst questions this month.');
      return;
    }
    var savedQuestion = question;
    userLine(question); input.value = ''; setLoading(true); typing();
    try {
      var data = await window.VISION.api.askVision(state.task.id, question, state.mode);
      untyping(); renderAnswer(data || {}); await refreshCanonicalState();
    } catch (error) {
      untyping(); showAnalystError(error || {}, savedQuestion);
    } finally {
      setLoading(false); state.mode = 'custom'; renderChips();
    }
  }

  function showAnalystError(error, savedQuestion) {
    if (savedQuestion) input.value = savedQuestion;
    var code = error && error.error;
    if (error && error.quota && typeof error.quota.remaining === 'number') updateRail(error.quota);
    var nav = {
      no_profile: { t: 'Finish onboarding first', b: 'Complete onboarding so your Analyst knows your goal and current task.', href: 'onboarding.html', label: 'Finish onboarding' },
      no_active_task: { t: 'Task unavailable', b: 'There is no active task to analyse yet. Open Tasks, then come back.', href: 'tasks.html', label: 'Go to Tasks' },
      task_not_found: { t: 'Task unavailable', b: 'That task is no longer available. Pick a current task and try again.', href: 'tasks.html', label: 'Go to Tasks' },
      unauthorized: { t: 'Sign in required', b: 'Your session expired. Sign in again to continue.', href: 'login.html', label: 'Sign in' },
      invalid_token: { t: 'Sign in required', b: 'Your session expired. Sign in again to continue.', href: 'login.html', label: 'Sign in' }
    };
    var temporary = ['ai_unavailable','ai_error','ai_timeout','timeout','empty_response','invalid_response','service_unavailable'];
    var s, kind;
    if (code === 'quota_exceeded') { s = { t: 'Monthly Analyst limit reached', b: "You've used all 50 Analyst questions this month." }; kind = 'quota'; }
    else if (nav[code]) { s = nav[code]; kind = 'link'; }
    else if (temporary.indexOf(code) > -1) { s = { t: 'Analyst temporarily unavailable', b: 'The Analyst could not answer right now.' }; kind = 'retry'; }
    else { s = { t: 'Connection failed', b: 'Could not reach the Analyst. Check your connection and try again.' }; kind = 'retry'; }
    var bubble = analystLine('<span class="lead">' + escapeHtml(s.t) + '</span>' + escapeHtml(s.b));
    var body = bubble && bubble.querySelector('.body');
    if (!body) return;
    if (kind === 'retry' && savedQuestion) {
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'vc-retry'; btn.textContent = 'Retry';
      btn.addEventListener('click', function () { if (state.loading) return; btn.disabled = true; if (savedQuestion) input.value = savedQuestion; submit(); });
      body.appendChild(btn);
    } else if (kind === 'link') {
      var a = document.createElement('a'); a.className = 'vc-retry'; a.href = s.href; a.textContent = s.label; body.appendChild(a);
    }
  }

  function blockLegacyEvents() {
    send.addEventListener('click', function (event) { event.stopImmediatePropagation(); event.preventDefault(); submit(); }, true);
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.stopImmediatePropagation(); event.preventDefault(); submit();
    }, true);
  }

  async function boot() {
    await new Promise(function (resolve) { setTimeout(resolve, 80); });
    installSharedNavigation();
    var session = await window.VISION.auth.requireAuth('login.html');
    if (window.VISION.backend && !session) return;
    try { window.VISION.analytics.track('analyst_view'); } catch (e) {}
    if (window.VISION.api.hydrateLocal) { try { await window.VISION.api.hydrateLocal(); } catch (e) {} }
    try {
      var quotaData = await window.VISION.api.getAskVisionQuota();
      if (quotaData && typeof quotaData.remaining === 'number') state.quota = quotaData;
    } catch (e) {}
    await refreshCanonicalState();
    var planState = null;
    if (window.VISION.dailyPlan) {
      try { planState = await window.VISION.dailyPlan.load(); } catch (e) { planState = null; }
      state.tasks = (planState && planState.status === 'ready' && Array.isArray(planState.tasks))
        ? planState.tasks.filter(function (task) { return task && task.id; }) : [];
    } else {
      var tasks = await window.VISION.api.getTasks();
      state.tasks = (tasks || []).filter(function (task) { return task && task.id; });
    }
    thread.innerHTML = '';
    if (!state.tasks.length) {
      var mode = $('#vcMode'); if (mode) mode.textContent = 'ANALYST ACTIVE';
      var lead = 'No task ready';
      var body = 'Your daily task is not ready yet. Return to Tasks, then come back when you have one to work through.';
      if (planState && planState.status === 'clarification_required' && planState.question) {
        lead = 'One answer needed first';
        body = planState.question.text + ' Answer it on your dashboard and today’s move will be built.';
      } else if (planState && planState.status === 'generating') {
        lead = 'Building today’s move'; body = 'Your task is being written against your goal. This takes a few seconds.';
      } else if (planState && planState.status === 'error' && planState.error) {
        lead = 'Plan unavailable'; body = planState.error.message;
      }
      analystLine('<span class="lead">' + escapeHtml(lead) + '</span>' + escapeHtml(body));
      input.disabled = true; send.disabled = true; done(); return;
    }
    var wanted = new URLSearchParams(window.location.search).get('task_id');
    state.task = state.tasks.find(function (task) { return task.id === wanted; }) ||
      state.tasks.find(function (task) { return task.activationStatus === 'active'; }) ||
      state.tasks.find(function (task) { return task.activationStatus === 'queued'; }) || state.tasks[0];
    var scoreRow = document.querySelector('.vc-read.score'); if (scoreRow) scoreRow.style.display = 'none';
    blockLegacyEvents(); announceTask(false); renderChips();
    var status = $('#vcMode'); if (status) status.textContent = 'ANALYST ACTIVE';
    await showLatestMemoryProposal();
    done();
  }

  window.addEventListener('error', function () {});
  boot().catch(function () {
    done();
    var mode = $('#vcMode'); if (mode) mode.textContent = 'Offline';
    if (thread) { thread.innerHTML = ''; analystLine('<span class="lead">Analyst unavailable</span>Refresh the page and try again.'); }
  });
})();
