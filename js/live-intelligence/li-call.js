/* ════════════════════════════════════════════════════════════════════════
   VISION LIVE CALL — the command surface.

   The founder is mid-sentence on a real call. They will look at this screen
   for about a second at a time, and what they need in that second is one
   instruction and one question. Everything else on the page exists to make
   those two trustworthy: the transcript proves VISION heard correctly, the
   right rail proves it is talking about the right business.

   So there is exactly ONE current instruction. It updates in place. Nothing
   accumulates — a stack of what VISION thought forty seconds ago is an
   archaeological record, and the transcript already is one.

   Nothing about the intelligence changes here. The provider, diarization,
   calibration, feed rules, cognition and grounding are all untouched; this
   file only decides what the founder sees.
   ══════════════════════════════════════════════════════════════════════ */
(function (V) {
  'use strict';
  /* READ AT CALL TIME, NOT AT LOAD TIME. The resolver arrives on a
     type="module" bridge, and modules are deferred — they execute after
     classic scripts. Capturing window.VISION_ENTRY up here bound the
     fallback stub permanently, and every prospect opened as the generic
     screen. */
  function resolveEntry(args) {
    var api = window.VISION_ENTRY;
    if (api && typeof api.resolveEntry === 'function') return api.resolveEntry(args);
    return { context: 'generic', title: 'Live Intelligence',
      subtitle: 'Open a prospect from Leads to work a live call with VISION beside you.',
      recommended: null, secondary: [], review: null, objections: [] };
  }

  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  function handleFromUrl() {
    try { return new URLSearchParams(location.search).get('call'); } catch (e) { return null; }
  }
  function readSession(handle) {
    if (!handle) return null;
    try { return JSON.parse(sessionStorage.getItem('vision_li_call_' + handle) || 'null'); } catch (e) { return null; }
  }

  var state = { handle: null, session: null, live: null, ended: false, startedAt: 0,
    /* null until the founder hangs up, then reviewing -> ready | unscored |
       failed. `ready` navigates away, so it is never rendered. */
    callId: null, scoring: null, scoringReason: null,
    /* 'entry' until the founder chooses to call. The command surface is
       unchanged; this only decides when they arrive at it. */
    screen: 'entry', entry: null, open: null };
  var timer = null;

  function shell(bodyHtml) {
    var host = document.getElementById('visionCall');
    if (!host) {
      host = document.createElement('section');
      host.id = 'visionCall';
      host.className = 'lic';
      document.body.insertBefore(host, document.body.firstChild);
    }
    host.innerHTML = bodyHtml;
    return host;
  }

  function renderRefusal(message) {
    shell('<div class="lic-gate"><p class="lic-eyebrow">Live call</p>'
      + '<p class="lic-gate-msg">' + esc(message) + '</p>'
      + '<a class="lic-back" href="leads.html">Back to Leads</a></div>');
  }

  /* ── founder-facing state names ───────────────────────────────────────
     The founder is told what is happening to THEM, never what the system is
     doing internally. A refused calibration attempt is still "identifying
     your voice", because from where they sit that is exactly what it is. */
  function phaseOf(live) {
    if (!live || live.state === 'idle') return 'ready';
    if (live.state === 'requesting_mic') return 'mic';
    if (live.state === 'connecting') return 'connecting';
    if (live.state === 'failed') return 'failed';
    if (live.state === 'stopped') return 'ended';
    if (!live.calibrated) return 'calibrating';
    if (!live.analysis) return 'listening';
    return 'live';
  }
  var STATUS = {
    ready: 'Ready when you are', mic: 'Waiting for your microphone',
    connecting: 'Connecting', calibrating: 'Identifying your voice',
    listening: 'Listening for the conversation', live: 'Live', ended: 'Call ended',
    failed: 'Connection lost',
  };

  function clock() {
    if (!state.startedAt || state.ended) return '';
    var s = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    return String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ── top bar ──────────────────────────────────────────────────────────── */
  function barHtml(phase) {
    var p = (state.session && state.session.handoff && state.session.handoff.prospect) || {};
    var live = phase === 'live' || phase === 'listening' || phase === 'calibrating';
    return '<header class="lic-bar">'
      + '<div class="lic-bar-id">'
        + '<span class="lic-dot' + (live ? ' is-live' : '') + '" aria-hidden="true"></span>'
        + '<div><h1 class="lic-who">' + esc(p.name || 'This call') + '</h1>'
        + (p.sub ? '<p class="lic-sub">' + esc(p.sub) + '</p>' : '') + '</div>'
      + '</div>'
      + '<div class="lic-bar-mid">'
        + '<span class="lic-status">' + esc(STATUS[phase] || '') + '</span>'
        + (state.startedAt && !state.ended ? '<span class="lic-clock" id="licClock">' + clock() + '</span>' : '')
      + '</div>'
      + '<div class="lic-bar-act">'
        + (phase === 'ready' || phase === 'ended' || phase === 'failed'
          ? '<button type="button" class="lic-btn lic-btn-go" id="licStart">Start call</button>'
          : '<button type="button" class="lic-btn lic-btn-end" id="licStop">End call</button>')
      + '</div>'
      + '</header>';
  }

  /* ── AFTER THE FOUNDER HANGS UP ───────────────────────────────────────
     The call screen is three columns built around one question: whose turn
     is it. Once the call is over that question is answered and the columns
     are furniture, so this replaces them entirely.

     Every branch below is a state the founder can actually reach, and each
     one says what happened, whether their call was kept, and what they can
     do next. Leaving any of them on the live call screen means a founder who
     just hung up sits looking at a dead transcript wondering whether VISION
     is still working. */
  function postCallHtml() {
    var back = '<a class="lic-pc-alt" href="leads.html">Back to Leads</a>';
    var review = state.callId
      ? 'live-intelligence.html?livereview=' + encodeURIComponent(state.callId) : null;

    if (state.scoring === 'reviewing') {
      return '<section class="lic-pc"><span class="lic-pc-spin" aria-hidden="true"></span>'
        + '<h2>Working out what happened</h2>'
        + '<p>VISION is going back over the call. This takes a few seconds.</p></section>';
    }

    if (state.scoring === 'unscored') {
      /* NOT A FAILURE, AND IT MUST NOT READ AS ONE. The call happened and is
         saved; there was not enough attributed speech to score it fairly,
         which is a statement about the audio and not about the founder. */
      return '<section class="lic-pc"><h2>Not enough of this call was heard</h2>'
        + '<p>Too much of the conversation could not be matched to a speaker, so VISION '
        + 'will not put a score on it. The call itself is saved and you can read what it did hear.</p>'
        + '<p class="lic-pc-why">Usually this is the other side being on speakerphone, a bad line, '
        + 'or both of you talking at once.</p>'
        + '<div class="lic-pc-act">'
        + (review ? '<a class="lic-btn lic-btn-go" href="' + review + '">See what was heard</a>' : '')
        + back + '</div></section>';
    }

    if (state.scoring === 'failed') {
      return '<section class="lic-pc"><h2>The review did not come back</h2>'
        + '<p>Your call was recorded and saved. VISION could not reach the server to review it '
        + 'just now, so nothing has been lost and nothing has been scored.</p>'
        + '<div class="lic-pc-act">'
        + (review ? '<a class="lic-btn lic-btn-go" href="' + review + '">Try the review again</a>' : '')
        + back + '</div></section>';
    }

    /* Ended with no call on the server -- the open failed before a word was
       said. Say so plainly rather than implying a review is coming. */
    return '<section class="lic-pc"><h2>Call ended</h2>'
      + '<p>This call was not opened on the server, so there is no review for it. '
      + 'Nothing you said was stored.</p>'
      + '<div class="lic-pc-act">' + back + '</div></section>';
  }

  /* ── centre: the product ──────────────────────────────────────────────── */
  function intelligenceHtml(phase) {
    var live = state.live || {};
    var a = live.analysis;

    if (phase !== 'live') {
      var lines = {
        ready: ['Start when you are ready', 'VISION will listen quietly and tell you what to do next.'],
        mic: ['Waiting for your microphone', 'Allow access so VISION can hear the call.'],
        connecting: ['Connecting', 'One moment.'],
        calibrating: ['Identifying your voice', 'Say your calibration line so VISION can tell you apart from them.'],
        listening: ['Listening for the conversation', 'Guidance appears as soon as there is something worth saying.'],
        ended: ['Call ended', 'The record of the conversation is on the left.'],
        failed: ['The connection dropped', 'Start again when you are ready — nothing was saved from this attempt.'],
      }[phase] || ['', ''];
      return '<div class="lic-wait"><p class="lic-wait-h">' + esc(lines[0]) + '</p>'
        + '<p class="lic-wait-p">' + esc(lines[1]) + '</p></div>';
    }

    var html = '';
    /* A. THE ONE INSTRUCTION. */
    html += '<section class="lic-move" aria-live="polite">'
      + '<p class="lic-lab">Next move</p>'
      + '<p class="lic-move-text">' + esc(a.nextMove) + '</p>'
      + '</section>';

    /* B. THE ONE QUESTION. */
    if (a.nextQuestion) {
      html += '<section class="lic-ask" aria-live="polite">'
        + '<p class="lic-lab">Ask this</p>'
        + '<p class="lic-ask-text">&ldquo;' + esc(a.nextQuestion) + '&rdquo;</p>'
        + '</section>';
    }

    /* C. Signals, and only when there is one. No reserved empty cards. */
    var signals = '';
    if (a.warning) {
      signals += '<div class="lic-sig lic-sig-warn"><span class="lic-sig-lab">Careful</span>'
        + '<p>' + esc(a.warning) + '</p></div>';
    }
    if (a.objection) {
      signals += '<div class="lic-sig lic-sig-obj"><span class="lic-sig-lab">Objection</span>'
        + '<p>' + esc(a.objection.reads || a.objection.kind) + '</p></div>';
    }
    /* An objection IS the phase. Showing both put the word "Objection" on
       screen twice, side by side, which costs a card and says nothing. */
    if (a.phase && !a.objection) {
      signals += '<div class="lic-sig lic-sig-phase"><span class="lic-sig-lab">Phase</span>'
        + '<p>' + esc(a.phase) + '</p></div>';
    }
    if (signals) html += '<div class="lic-signals">' + signals + '</div>';

    /* D + E. Supporting, deliberately quieter than the instruction. */
    var revealed = (a.whatTheyRevealed || []).slice(-4);
    var unknown = (a.stillUnknown || []).slice(0, 3);
    if (revealed.length || unknown.length) {
      html += '<div class="lic-know">';
      if (revealed.length) {
        html += '<section class="lic-col"><p class="lic-lab">What they revealed</p><ul>'
          + revealed.map(function (r) {
            return '<li>' + esc(r.what || r.key || '') + '</li>';
          }).join('') + '</ul></section>';
      }
      if (unknown.length) {
        html += '<section class="lic-col lic-col-q"><p class="lic-lab">Still unknown</p><ul>'
          + unknown.map(function (u) { return '<li>' + esc(shortUnknown(u)) + '</li>'; }).join('')
          + '</ul></section>';
      }
      html += '</div>';
    }
    return html;
  }

  /* The stored unknowns are written as full sentences — "It is not yet known
     whether the clinic is currently seeking more new patients" — which reads
     correctly in a report and badly under a heading that already says STILL
     UNKNOWN. Display only: the underlying text is untouched. */
  function shortUnknown(text) {
    var t = String(text || '').replace(/^it is not yet known (whether|which|who|what|if)\s+/i, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* ── left: the record ─────────────────────────────────────────────────── */
  function transcriptHtml() {
    var live = state.live || {};
    var rows = (live.transcript || []).filter(function (r) {
      /* Calibration is VISION's setup, not the sales conversation. */
      return (live.calibrationItemIds || []).indexOf(r.itemId) === -1;
    });
    if (!rows.length) {
      return '<p class="lic-empty">The conversation will appear here.</p>';
    }
    var last = rows.length - 1;
    return rows.map(function (r, i) {
      var role = r.role === 'founder' ? 'You' : (r.role === 'prospect' ? 'Them' : 'Unclear');
      var cls = 'lic-line lic-' + esc(r.role) + (i === last ? ' is-now' : '')
        + (i < last - 4 ? ' is-old' : '');
      return '<div class="' + cls + '"><span class="lic-speaker">' + esc(role) + '</span>'
        + '<p>' + esc(r.text) + '</p></div>';
    }).join('');
  }

  /* ── right: why this prospect ─────────────────────────────────────────── */
  function contextHtml() {
    var h = (state.session && state.session.handoff) || {};
    var p = h.prospect || {};
    var out = '';
    var block = function (label, body) {
      return '<section class="lic-ctx-b"><p class="lic-lab">' + esc(label) + '</p>' + body + '</section>';
    };
    if (h.desiredClose && h.desiredClose.note) {
      out += block('Aiming for', '<p>' + esc(h.desiredClose.note) + '</p>');
    }
    if (h.script && h.script.firstQuestion) {
      out += block('Your opener', '<p>' + esc(h.script.firstQuestion) + '</p>');
    }
    var observed = (h.evidence && h.evidence.observed) || [];
    if (observed.length) {
      out += block('What VISION knows', '<ul>' + observed.slice(0, 3).map(function (e) {
        return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>');
    }
    if (h.contactRole && h.contactRole.role) {
      out += block('Speaking to', '<p>' + esc(h.contactRole.role) + '</p>');
    }
    if (!out) out = '<p class="lic-empty">No prospect context was carried across.</p>';
    return '<p class="lic-ctx-name">' + esc(p.name || '') + '</p>'
      + (p.sub ? '<p class="lic-ctx-sub">' + esc(p.sub) + '</p>' : '') + out;
  }

  /* ── the prospect-aware opening ───────────────────────────────────────
     They came here from a specific business with a specific approach. The
     screen says so and recommends one thing, rather than asking them to
     restate what VISION already has. */
  function entryHtml() {
    var e = state.entry || {};
    if (e.context !== 'leads') {
      return '<div class="lic-entry"><div class="lic-entry-in">'
        + '<h1 class="lic-entry-h">' + esc(e.title || 'Live Intelligence') + '</h1>'
        + '<p class="lic-entry-sub">' + esc(e.subtitle || '') + '</p>'
        + '<a class="lic-btn lic-btn-go lic-entry-go" href="leads.html">Open Leads</a>'
        + '</div></div>';
    }
    var det = function (id, label, body) {
      return '<details class="lic-det"' + (state.open === id ? ' open' : '') + ' data-det="' + id + '">'
        + '<summary>' + esc(label) + '</summary><div class="lic-det-b">' + body + '</div></details>';
    };
    var html = '<div class="lic-entry"><div class="lic-entry-in">'
      + '<p class="lic-eyebrow">Live Intelligence</p>'
      + '<h1 class="lic-entry-h">' + esc(e.title) + '</h1>'
      + (e.subtitle ? '<p class="lic-entry-sub">' + esc(e.subtitle) + '</p>' : '')
      + '<section class="lic-rec">'
        + '<p class="lic-lab">Recommended</p>'
        + '<p class="lic-rec-why">' + esc(e.recommended.why) + '</p>'
        + '<button type="button" class="lic-btn lic-btn-go lic-entry-go" data-act="'
          + esc(e.recommended.id) + '">' + esc(e.recommended.label) + '</button>'
      + '</section>';

    if (e.secondary.length) {
      html += '<section class="lic-alts"><p class="lic-lab">Or</p><ul>'
        + e.secondary.map(function (a) {
          return '<li><button type="button" class="lic-alt" data-act="' + esc(a.id) + '">'
            + '<span class="lic-alt-l">' + esc(a.label) + '</span>'
            + '<span class="lic-alt-w">' + esc(a.why) + '</span></button></li>';
        }).join('') + '</ul></section>';
    }

    var r = e.review || {};
    var reviewBody = ''
      + (r.opening ? '<p class="lic-lab">Your opening</p><p>' + esc(r.opening) + '</p>' : '')
      + (r.firstQuestion ? '<p class="lic-lab">Your first question</p><p>' + esc(r.firstQuestion) + '</p>' : '')
      + (r.aimingFor ? '<p class="lic-lab">Aiming for</p><p>' + esc(r.aimingFor) + '</p>' : '')
      + (r.observed && r.observed.length ? '<p class="lic-lab">What VISION verified</p><ul>'
        + r.observed.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('') + '</ul>' : '')
      + (r.unknowns && r.unknowns.length ? '<p class="lic-lab">Do not assert</p><ul>'
        + r.unknowns.map(function (u) { return '<li>' + esc(shortUnknown(u)) + '</li>'; }).join('') + '</ul>' : '');
    if (reviewBody) html += det('review', 'The approach', reviewBody);

    if (e.objections.length) {
      html += det('objections', 'Likely objections', '<ul class="lic-objs">'
        + e.objections.map(function (o) {
          return '<li><p class="lic-obj-q">&ldquo;' + esc(o.q) + '&rdquo;</p>'
            + (o.response ? '<p class="lic-obj-a">' + esc(o.response) + '</p>' : '') + '</li>';
        }).join('') + '</ul>');
    }
    return html + '<a class="lic-back lic-back-in" href="leads.html">Back to Leads</a></div></div>';
  }

  function renderEntry() {
    shell(entryHtml());
    Array.prototype.forEach.call(document.querySelectorAll('[data-act]'), function (b) {
      b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-det]'), function (d) {
      d.addEventListener('toggle', function () {
        state.open = d.open ? d.getAttribute('data-det') : null;
      });
    });
  }

  function act(id) {
    if (id === 'live_call') { state.screen = 'call'; render(); return; }
    if (id === 'practice') {
      /* THE SPOKEN REHEARSAL, not the older typed panel. The label said
         "practice the call" and led somewhere you typed at a text box, which
         is a different product wearing the same word. Same handle transport,
         no second prospect-context system. */
      location.href = 'live-intelligence.html?practice-call=' + encodeURIComponent(state.handle);
      return;
    }
    /* review and objections are disclosures on this screen, not destinations. */
    state.open = id === 'objections' ? 'objections' : 'review';
    renderEntry();
    var el = document.querySelector('[data-det="' + state.open + '"]');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function render() {
    if (state.screen === 'entry') { renderEntry(); return; }
    /* The call is over: the three columns answered "whose turn is it", and
       that question is closed. */
    if (state.ended) { shell(postCallHtml()); return; }
    var phase = phaseOf(state.live);
    var live = state.live || {};
    var degraded = live.coverage && live.coverage.complete === false;
    var lone = live.coverage && live.coverage.loneFounder === true;

    shell(barHtml(phase)
      + '<div class="lic-grid">'
        + '<aside class="lic-left"><p class="lic-lab lic-lab-col">Conversation</p>'
          + '<div class="lic-scroll" id="licTranscript">' + transcriptHtml() + '</div>'
          + (degraded
            ? '<p class="lic-degrade">Some speech could not be attributed. VISION is only using what it can place.</p>'
            : '')
          + (lone
            ? '<p class="lic-degrade">VISION has not picked up the other side of this call yet.</p>'
            : '')
        + '</aside>'
        + '<main class="lic-mid">' + intelligenceHtml(phase) + '</main>'
        + '<aside class="lic-right"><p class="lic-lab lic-lab-col">This prospect</p>'
          + '<div class="lic-scroll">' + contextHtml() + '</div></aside>'
      + '</div>'
      + '<a class="lic-back" href="leads.html">Back to Leads</a>');

    var go = document.getElementById('licStart');
    if (go) go.addEventListener('click', startCall);
    var end = document.getElementById('licStop');
    if (end) end.addEventListener('click', endCall);
    var t = document.getElementById('licTranscript');
    if (t) t.scrollTop = t.scrollHeight;
  }

  function startCall() {
    if (!window.VISION_ASSEMBLY) {
      state.live = { state: 'failed', error: 'Live call is not available in this build.' };
      render();
      return;
    }
    state.ended = false;
    state.scoring = null;
    state.scoringReason = null;
    state.startedAt = Date.now();
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      var c = document.getElementById('licClock');
      if (c) c.textContent = clock();
    }, 1000);
    window.VISION_ASSEMBLY.start({
      handoff: state.session.handoff,
      workspaceId: state.session.workspaceId || null,
      onChange: function (snap) { state.live = snap; render(); },
    });
  }

  function endCall() {
    if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.stop({ status: 'completed' });
    state.ended = true;
    if (timer) { clearInterval(timer); timer = null; }
    render();
  }

  async function boot() {
    state.handle = handleFromUrl();
    if (!state.handle) return;   /* another surface owns this page */
    state.session = readSession(state.handle);
    if (!state.session || !state.session.handoff) {
      renderRefusal('That call session has expired. Open the prospect in Leads and start it again.');
      return;
    }
    if (!V.backend) { renderRefusal('Live call needs the backend, and it is not reachable.'); return; }
    if (V.auth && V.auth.requireAuth) {
      var s = await V.auth.requireAuth();
      if (!s) return;
    }
    state.entry = resolveEntry({ origin: 'leads', handoff: state.session.handoff });
    render();
  }

  /* Exposed so the state harness can render real snapshot shapes without audio. */
  window.VISION_CALL_UI = {
    /* The call surface, given a real snapshot. */
    render: function (snapshot, session) {
      if (session) state.session = session;
      state.live = snapshot;
      state.screen = 'call';
      if (snapshot && snapshot.state === 'listening' && !state.startedAt) state.startedAt = Date.now();
      render();
    },
    /* The opening, given a real handoff. */
    renderEntry: function (session, origin) {
      state.session = session;
      state.screen = 'entry';
      state.entry = resolveEntry({ origin: origin || 'leads', handoff: session && session.handoff });
      render();
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})(window.VISION);
