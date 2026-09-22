/* ═══════════════════════════════════════════════════════════════════════
   li-practice.js — the Leads → Live Intelligence practice surface.

   MOUNTS ONLY WITH ?practice=<handle>. Live Intelligence is a large existing
   app (live-intelligence-app.js + -page.js, ~2,800 lines) and this is a
   different entry point into the same runtime, so it is additive and gated
   rather than threaded through that app. Without the parameter this file
   does nothing at all.

   It invents no context contract: the payload is exactly what
   practiceHandoff() built in the Prospect Workspace, and the turn goes to the
   universal `live-intelligence` runtime as `practice_turn`.
   ═══════════════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var PREFIX = 'vision_practice_handoff_';
  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  function handleFromUrl() {
    try { return new URLSearchParams(location.search).get('practice'); } catch (e) { return null; }
  }
  function readSession(handle) {
    try {
      var raw = window.sessionStorage.getItem(PREFIX + handle);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeSession(handle, value) {
    try { window.sessionStorage.setItem(PREFIX + handle, JSON.stringify(value)); } catch (e) { /* non-fatal */ }
  }

  var state = {
    handle: null, session: null, busy: false, turns: [],
    /* At most one open proposal at a time. A queue of pending suggestions is
       a to-do list the founder never asked for; the newest turn's offer
       replaces any older one. */
    proposal: null, proposalBusy: false, proposalDone: null,
    /* Notes this session has kept, newest last, and the note the founder has
       just repeated. Founder-facing only — see notesHtml(). */
    notes: [], repeat: null,
    /* Turns used / left, and anything VISION needs to tell the founder that
       the prospect must NOT say. */
    usage: null, notice: null, sessions: [], ended: false, endBusy: false,
  };

  function shell(bodyHtml) {
    var host = document.getElementById('visionPractice');
    if (!host) {
      host = document.createElement('section');
      host.id = 'visionPractice';
      host.className = 'lip';
      document.body.insertBefore(host, document.body.firstChild);
    }
    host.innerHTML = bodyHtml;
    return host;
  }

  /* An honest dead end. A founder who arrives with a broken or expired handle
     is told what happened and given the way back, rather than shown an empty
     chat that looks like the feature is broken. */
  function renderRefusal(message) {
    shell(
      '<div class="lip-wrap lip-refused">' +
        '<p class="lip-eyebrow">Practice</p>' +
        '<p class="lip-msg">' + esc(message) + '</p>' +
        '<a class="lip-back" href="leads.html">Back to Leads</a>' +
      '</div>');
  }

  function contextCard(handoff) {
    var p = handoff.prospect || {};
    var say = handoff.script || {};
    var unknowns = handoff.unknowns || [];
    return '<div class="lip-ctx">' +
      '<p class="lip-eyebrow">Practising against</p>' +
      '<h1 class="lip-name">' + esc(p.name) + '</h1>' +
      (p.sub ? '<p class="lip-sub">' + esc(p.sub) + '</p>' : '') +
      notesHtml() +
      (say.opening ? '<div class="lip-block"><span class="lip-lab">Your opening</span><p>' + esc(say.opening) + '</p></div>' : '') +
      (say.firstQuestion ? '<div class="lip-block"><span class="lip-lab">Your first question</span><p>' + esc(say.firstQuestion) + '</p></div>' : '') +
      (handoff.desiredClose && handoff.desiredClose.note
        ? '<div class="lip-block"><span class="lip-lab">What you are aiming for</span><p>' + esc(handoff.desiredClose.note) + '</p></div>' : '') +
      (unknowns.length
        ? '<div class="lip-block lip-unknowns"><span class="lip-lab">Do not assert — still unknown</span><ul>' +
          unknowns.slice(0, 4).map(function (u) { return '<li>' + esc(u) + '</li>'; }).join('') + '</ul></div>'
        : '') +
      sessionControlsHtml() +
      '<a class="lip-back" href="leads.html">Back to Leads</a>' +
    '</div>';
  }

  /* ── THE PROPOSAL ───────────────────────────────────────────────────
     Shown UNDER the transcript, never inside it: it is VISION talking about
     the rehearsal, not the prospect talking to the founder, and putting it in
     the conversation would break the character the whole panel maintains.

     The exact text that would be saved is displayed, so the founder accepts
     something they have read rather than a description of it. */
  /* WHAT THE FOUNDER HAS KEPT, SHOWN TO THE FOUNDER ONLY.

     This never reaches the persona's prompt. The prospect on the other end of
     a real call does not know which of your habits VISION has flagged, and a
     roleplay partner who suddenly references your coaching record has stopped
     being a prospect. The note works on the founder's side of the glass. */
  /* ON A NON-2xx, supabase-js puts the parsed body on error.context, not on
     data. Reading only `data` throws away every typed refusal the server took
     the trouble to name — which is how a hard limit came out as "Try again". */
  async function readRefusal(result) {
    var err = result && result.error;
    if (!err) return null;
    var ctx = err.context;
    if (!ctx) return null;
    try {
      if (typeof ctx.json === 'function') return await ctx.clone().json();
    } catch (e) { /* not JSON */ }
    return (ctx && typeof ctx === 'object' && ctx.error) ? ctx : null;
  }

  /* WHAT VISION HAS TO SAY IS NOT SAID BY THE PROSPECT. A limit, an outage or
     a closed session is shown as a notice beside the conversation; putting it
     in the transcript would have the roleplay character announce VISION's
     billing state mid-call. */
  function noticeHtml() {
    if (!state.notice) return '';
    return '<div class="lip-notice' + (state.notice.hard ? ' lip-notice-hard' : '') + '">' +
      '<p>' + esc(state.notice.text) + '</p>' +
      (state.notice.action
        ? '<a class="lip-notice-act" href="' + esc(state.notice.action.href) + '">' + esc(state.notice.action.label) + '</a>'
        : '') +
    '</div>';
  }

  /* SHOWN ONLY WHEN IT MATTERS. A counter on every turn is noise; a counter
     that appears once the end is in sight is information. */
  function usageHtml() {
    var u = state.usage;
    if (!u || typeof u.sessionUsed !== 'number' || typeof u.sessionLimit !== 'number') return '';
    var left = u.sessionLimit - u.sessionUsed;
    var dayLeft = (typeof u.usedToday === 'number' && typeof u.dailyLimit === 'number')
      ? u.dailyLimit - u.usedToday : null;
    if (left > 10 && (dayLeft === null || dayLeft > 10)) return '';
    var parts = [];
    if (left <= 10) parts.push(left + ' turn' + (left === 1 ? '' : 's') + ' left in this session');
    if (dayLeft !== null && dayLeft <= 10) parts.push(dayLeft + ' left today');
    return '<p class="lip-usage">' + esc(parts.join(' · ')) + '</p>';
  }

  /* ENDING A SESSION AND GETTING BACK TO ONE.
     Every Practice click used to start a fresh session with no way back, so
     the notes a founder kept last time were unreachable even though they were
     still stored. */
  function sessionControlsHtml() {
    var others = state.sessions.filter(function (x) {
      return x.workspace_id !== state.session.workspaceId;
    }).slice(0, 3);
    var html = '<div class="lip-sess">';
    if (state.ended) {
      html += '<p class="lip-sess-done">This session is closed.</p>';
    } else if (state.session.workspaceId) {
      html += '<button class="lip-sess-end" type="button" id="lipEnd"' +
        (state.endBusy ? ' disabled' : '') + '>' +
        (state.endBusy ? 'Closing…' : 'End this session') + '</button>';
    }
    if (others.length) {
      html += '<div class="lip-sess-past"><span class="lip-lab">Earlier practice</span><ul>' +
        others.map(function (x) {
          var turns = Number(x.turn_count || 0);
          var notes = Number(x.note_count || 0);
          return '<li><button type="button" class="lip-sess-open" data-ws="' + esc(x.workspace_id) + '">' +
            esc(x.title || 'Practice session') + '</button>' +
            '<span class="lip-sess-meta">' + turns + ' turn' + (turns === 1 ? '' : 's') +
            (notes ? ' · ' + notes + ' note' + (notes === 1 ? '' : 's') : '') +
            (x.session_status === 'completed' || x.session_status === 'archived' ? ' · closed' : '') +
            '</span></li>';
        }).join('') + '</ul></div>';
    }
    return html + '</div>';
  }

  function notesHtml() {
    if (!state.notes.length && !state.repeat) return '';
    return '<div class="lip-notes">' +
      '<span class="lip-lab">Noted this session</span>' +
      '<ul>' + state.notes.slice(-4).map(function (n) {
        var isRepeat = state.repeat && n === state.repeat;
        return '<li' + (isRepeat ? ' class="lip-note-rep"' : '') + '>' + esc(n) +
          (isRepeat ? '<span class="lip-rep-tag">again just now</span>' : '') + '</li>';
      }).join('') + '</ul>' +
    '</div>';
  }

  function proposalHtml() {
    if (state.proposalDone) {
      return '<div class="lip-prop lip-prop-done"><p>' + esc(state.proposalDone) + '</p></div>';
    }
    var p = state.proposal;
    if (!p) return '';
    return '<div class="lip-prop">' +
      '<p class="lip-lab">VISION noticed</p>' +
      '<p class="lip-prop-reason">' + esc(p.reason) + '</p>' +
      (p.note ? '<p class="lip-prop-note">' + esc(p.note) + '</p>' : '') +
      '<div class="lip-prop-acts">' +
        '<button class="lip-send lip-prop-yes" type="button" id="lipAccept"' +
          (state.proposalBusy ? ' disabled' : '') + '>' +
          (state.proposalBusy ? 'Keeping…' : 'Keep this note') + '</button>' +
        '<button class="lip-prop-no" type="button" id="lipDismiss"' +
          (state.proposalBusy ? ' disabled' : '') + '>No thanks</button>' +
      '</div>' +
    '</div>';
  }

  function transcriptHtml() {
    if (!state.turns.length) {
      return '<p class="lip-empty">Say your opening line the way you would on the call.</p>';
    }
    return state.turns.map(function (t) {
      return '<div class="lip-turn lip-' + (t.role === 'assistant' ? 'them' : 'you') + '">' +
        '<span class="lip-who">' + (t.role === 'assistant' ? 'Them' : 'You') + '</span>' +
        '<p>' + esc(t.content) + '</p></div>';
    }).join('');
  }

  function render() {
    var h = state.session.handoff;
    shell(
      '<div class="lip-wrap">' +
        contextCard(h) +
        '<div class="lip-chat">' +
          '<div class="lip-transcript" id="lipTranscript">' + transcriptHtml() + '</div>' +
          noticeHtml() +
          proposalHtml() +
          usageHtml() +
          '<form class="lip-composer" id="lipForm">' +
            '<label class="lip-sr" for="lipInput">What you say</label>' +
            '<textarea id="lipInput" rows="3" placeholder="Type what you would say…"' +
              (state.busy ? ' disabled' : '') + '></textarea>' +
            '<button class="lip-send" type="submit"' + (state.busy ? ' disabled' : '') + '>' +
              (state.busy ? 'Sending…' : 'Say it') + '</button>' +
          '</form>' +
        '</div>' +
      '</div>');
    var form = document.getElementById('lipForm');
    if (form) form.addEventListener('submit', onSend);
    var yes = document.getElementById('lipAccept');
    if (yes) yes.addEventListener('click', onAcceptProposal);
    var endBtn = document.getElementById('lipEnd');
    if (endBtn) endBtn.addEventListener('click', onEndSession);
    Array.prototype.forEach.call(document.querySelectorAll('.lip-sess-open'), function (b) {
      b.addEventListener('click', function () { openSession(b.getAttribute('data-ws')); });
    });
    var no = document.getElementById('lipDismiss');
    if (no) no.addEventListener('click', function () {
      /* Dismissing writes nothing. The proposal row already records that
         VISION offered; there is no need to also record a refusal, and
         logging every "no thanks" would make the founder feel watched. */
      state.proposal = null; state.proposalDone = null; render();
    });
    var t = document.getElementById('lipTranscript');
    if (t) t.scrollTop = t.scrollHeight;
  }

  async function onSend(event) {
    event.preventDefault();
    if (state.busy) return;
    var box = document.getElementById('lipInput');
    var text = box ? String(box.value || '').trim() : '';
    if (!text) return;

    state.busy = true;
    state.turns.push({ role: 'user', content: text });
    render();

    var result = null;
    try {
      result = await V.sb.functions.invoke('live-intelligence', {
        body: {
          action: 'practice_turn',
          mode: 'practice',
          workspaceId: state.session.workspaceId || null,
          input: text,
          handoff: state.session.handoff,
        },
      });
    } catch (error) { result = { error: error }; }

    state.busy = false;
    var data = result && result.data;
    if (!data || data.ok !== true) {
      var refusal = await readRefusal(result);
      var code = (refusal && refusal.error) || (data && data.error) || null;
      /* The turn the founder took stays on screen; only the response is
         missing, and the reason is named rather than generalised. */
      if (code === 'daily_limit_reached' || code === 'session_limit_reached'
          || code === 'rate_limit_reached' || code === 'session_ended') {
        state.notice = {
          text: (refusal && refusal.details) || 'Live Intelligence is not available right now.',
          /* A HARD stop is one where trying again cannot help. Saying "try
             again" to a founder who has hit the daily ceiling wastes their
             time and their trust. */
          hard: code !== 'rate_limit_reached',
          action: (code === 'session_limit_reached' || code === 'session_ended')
            ? { label: 'Back to Leads', href: 'leads.html' } : null,
        };
        if (code === 'session_ended') state.ended = true;
        if (refusal && refusal.usage) state.usage = refusal.usage;
      } else {
        state.notice = { text: 'That did not reach VISION. Try again.', hard: false, action: null };
      }
      render();
      return;
    }
    state.notice = null;
    if (data.workspaceId && data.workspaceId !== state.session.workspaceId) {
      state.session.workspaceId = data.workspaceId;
      writeSession(state.handle, state.session);
    }
    state.turns.push({ role: 'assistant', content: data.reply });
    /* A new turn replaces any previous offer, and clears a finished one. */
    state.proposal = data.proposal || null;
    state.proposalDone = null;
    /* The server is the source of truth for what is kept — it reads the same
       memory the dedup ran against, so a note kept in an earlier session on
       this same conversation shows up here too. */
    if (Array.isArray(data.sessionNotes)) state.notes = data.sessionNotes.slice();
    state.repeat = data.noteRepeat || null;
    state.usage = data.usage || state.usage;
    render();
  }

  async function onEndSession() {
    if (!state.session.workspaceId || state.endBusy) return;
    state.endBusy = true; render();
    var result = null;
    try {
      result = await V.sb.functions.invoke('live-intelligence', {
        body: { action: 'end_session', workspaceId: state.session.workspaceId },
      });
    } catch (error) { result = { error: error }; }
    state.endBusy = false;
    var data = result && result.data;
    if (!data || data.ok !== true) {
      state.notice = { text: 'That session could not be closed. It is still open.', hard: false, action: null };
      render();
      return;
    }
    state.ended = true;
    state.notice = {
      text: 'Session closed. What you kept is saved.',
      hard: true, action: { label: 'Back to Leads', href: 'leads.html' },
    };
    render();
    loadSessions();
  }

  /* Reopening a past session hands the SAME workspace back to the runtime,
     which re-reads its history and its notes server-side. The handoff is kept
     as-is: the prospect a session was about does not change. */
  function openSession(workspaceId) {
    if (!workspaceId || workspaceId === state.session.workspaceId) return;
    state.session.workspaceId = workspaceId;
    writeSession(state.handle, state.session);
    state.turns = []; state.notes = []; state.repeat = null;
    state.proposal = null; state.proposalDone = null;
    state.usage = null; state.notice = null; state.ended = false;
    render();
    hydrate();
  }

  async function loadSessions() {
    try {
      var listed = await V.sb.functions.invoke('live-intelligence', {
        body: { action: 'sessions', mode: 'practice' },
      });
      var data = listed && listed.data;
      if (data && data.ok === true && Array.isArray(data.sessions)) {
        state.sessions = data.sessions;
        var mine = state.sessions.filter(function (x) { return x.workspace_id === state.session.workspaceId; })[0];
        if (mine && (mine.session_status === 'completed' || mine.session_status === 'archived')) state.ended = true;
        render();
      }
    } catch (error) { /* the list is an affordance, not a dependency */ }
  }

  async function onAcceptProposal() {
    var p = state.proposal;
    if (!p || state.proposalBusy) return;
    state.proposalBusy = true;
    render();

    var result = null;
    try {
      result = await V.sb.rpc('live_intelligence_action_record_v1', {
        p_intent: 'apply',
        p_action_type: p.actionType,
        p_target: 'live_intelligence_memory_items',
        /* ITS OWN KEY. Re-sending the proposal's key would match the row
           already written for the offer and replay it, so the acceptance
           would be swallowed and nothing would apply. */
        p_idempotency_key: p.acceptKey,
        p_workspace_id: state.session.workspaceId,
        p_venture_id: null,
        p_payload: p.payload || {},
        p_reason: p.reason,
        p_source_context: { accepted_from: p.actionId },
        /* The founder is the one applying this, and they are confirming it. */
        p_origin: 'founder',
        p_confirmed: true,
      });
    } catch (error) { result = { error: error }; }

    state.proposalBusy = false;
    var d = result && result.data;
    if (!d || (d.status !== 'ready' && d.action_status !== 'applied')) {
      state.proposalDone = 'That could not be saved. The note is still in the conversation above.';
    } else {
      state.proposalDone = 'Kept for this session.';
      /* Show it immediately rather than waiting for the next turn's payload —
         the founder pressed the button, the list should reflect that now. */
      if (p.note && state.notes.indexOf(p.note) === -1) state.notes.push(p.note);
    }
    state.proposal = null;
    render();
  }

  /* RELOAD REJOINS THE SAME CONVERSATION. The workspace id is on the session
     record, and the messages come from the existing
     live_intelligence_get_workspace RPC — no new read contract. */
  async function hydrate() {
    if (!state.session.workspaceId || !V.sb) return;
    try {
      var res = await V.sb.rpc('live_intelligence_get_workspace', {
        p_workspace_id: state.session.workspaceId, p_message_limit: 40,
      });
      var msgs = res && res.data && Array.isArray(res.data.messages) ? res.data.messages : [];
      state.turns = msgs
        .filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
        .map(function (m) { return { role: m.role, content: m.content }; });
    } catch (error) { /* an empty transcript is honest; the workspace still exists */ }
  }

  async function boot() {
    state.handle = handleFromUrl();
    if (!state.handle) return;                       // not a practice visit

    state.session = readSession(state.handle);
    if (!state.session || !state.session.handoff) {
      renderRefusal('That practice session has expired. Open the prospect in Leads and start it again.');
      return;
    }
    var h = state.session.handoff;
    if (!h.prospect || !h.prospect.name || !h.script) {
      renderRefusal('That handoff is incomplete, so there is nothing to practise against.');
      return;
    }

    if (V.auth && V.auth.requireAuth) {
      var session = await V.auth.requireAuth();
      if (!session) return;                          // requireAuth redirects
    }
    await hydrate();
    render();
    /* Deliberately NOT awaited: the founder can start talking before the list
       of past sessions arrives, and a slow list must never hold up the panel. */
    loadSessions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  V.liPractice = { boot: boot, state: state };
})(window.VISION);
