/* ════════════════════════════════════════════════════════════════════════
   PRACTICE CALL — the founder's screen, both halves of it.

   SETUP, then the call. The founder arrives from Leads knowing who they are
   about to ring and nothing else, so before anything is spoken this screen
   answers three questions in order: who am I calling, how will they behave,
   and what do I actually say. Only then does it offer to start.

   THE SCRIPT IS NEVER FOLDED AWAY. A founder about to speak out loud cannot
   go hunting through a disclosure for the words. Every line VISION suggests
   is on the page, in full, before they press start — and it is labelled as
   wording to aim at rather than a line to read, because a founder reciting
   a script is not practising a conversation.

   THEN ONE QUESTION, ALL CALL: WHOSE TURN IS IT? A founder mid-rehearsal is
   speaking to their laptop and cannot read. Exactly one state is on screen
   at a time and it is the largest thing on it.

   No scores. Scoring is not built, and hinting at a grade the engine cannot
   produce teaches the founder to distrust the whole rehearsal.
   ══════════════════════════════════════════════════════════════════════ */
(function (V) {
  'use strict';

  var esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var txt = function (v) { return (typeof v === 'string' && v.trim()) ? v.trim() : null; };

  function handleFromUrl() {
    try { return new URLSearchParams(location.search).get('practice-call'); } catch (e) { return null; }
  }
  /* PHOENIX A/B #2, QA-only: an explicit AssemblyAI turn-detection mode
     override, scoped to Practice's own setup screen. Absent, or any value
     but 'min_latency', means unchanged, current behaviour. */
  function assemblyTurnModeFromUrl() {
    try { return new URLSearchParams(location.search).get('asm-mode') === 'min_latency' ? 'min_latency' : null; } catch (e) { return null; }
  }

  function readSession(handle) {
    if (!handle) return null;
    try { return JSON.parse(sessionStorage.getItem('vision_li_call_' + handle) || 'null'); } catch (e) { return null; }
  }
  function kit() { return window.VISION_PRACTICE_KIT || null; }

  var state = {
    handle: null, session: null, live: null,
    stage: 'setup',              /* setup → live */
    starting: false, arming: false,
    railScriptOpen: false,   /* the rail's own Full Script, collapsed */
    /* PINNED. The temperament picker is gone: VISION Realistic is the only
       mode Practice runs, because it is the only one derived from what VISION
       actually knows about this prospect. Difficulty and Pressure are layered
       on top of it, so "which archetype" is no longer a question anyone --
       founder or client code -- gets to answer. */
    mode: 'vision_realistic',
    /* PINNED to adaptive. The situation picker is gone; what kind of moment
       the prospect is having is now part of the hidden scenario, derived from
       the seed, and is never shown before or during the call. */
    situation: 'vision_adaptive',
    /* THE TWO DIALS. VISION-recommended defaults: Medium is the tuned
       baseline every existing rehearsal was measured against. */
    difficulty: 'medium',
    pressure: 'medium',
    /* Generated once per setup session, the first time it is needed, so
       switching modes or re-rendering the setup screen does not silently
       redraw a different adaptive situation underneath the founder. */
    situationSeed: null,
    format: 'guided',            /* how VISION coaches — NOT how hard they are */
    recording: null,             /* 'not_asked' | 'allowed' | 'declined' */
    focus: null,                 /* set only by "Practise this weakness" */
    recordingWhy: false,
    profile: null,               /* only ever set from the stored profile */
    adapted: null, showingAdapted: false, adaptNote: null,
    started: false, startedAt: 0, ended: false, notice: null, pinned: true,
    reviewState: null, reviewSessionId: null, reviewStartedAt: 0,
    /* Visual only — no capture/output is actually toggled by these. Matches
       the approved concept: a founder can silence the idea of a mute button
       without this build changing what the microphone or speaker do. */
    muted: false, speakerOn: true,
  };
  var timer = null;
  var scoreTick = null;
  var orbRaf = null;
  var orbDisplay = 0;

  function shell(html) {
    var host = document.getElementById('visionPracticeCall');
    if (!host) {
      host = document.createElement('section');
      host.id = 'visionPracticeCall';
      host.className = 'lpc';
      document.body.insertBefore(host, document.body.firstChild);
      /* The screen is a fixed overlay covering everything. Leave the page
         behind it scrollable and a swipe that starts outside the transcript
         moves a page nobody can see — the founder feels a dead gesture. */
      document.documentElement.classList.add('lpc-open');
    }
    host.innerHTML = html;
    return host;
  }

  /* ── WHOSE TURN IS IT ─────────────────────────────────────────────────
     Founder-facing words only. The engine's phases are internal names. */
  var TURN = {
    /* who:'ring' is its own case (not 'none') purely so the orb can carry a
       ringing-phone cadence here and nowhere else — see .lpc-turn-ring. */
    connecting: { label: 'CONNECTING', sub: 'One moment.', who: 'ring' },
    your_turn: { label: 'YOUR TURN', sub: 'Speak — say it however you would say it.', who: 'you' },
    listening: { label: 'LISTENING', sub: 'VISION is hearing you.', who: 'you' },
    thinking: { label: 'VISION THINKING', sub: 'Working out how they would answer.', who: 'wait' },
    prospect: { label: 'PROSPECT SPEAKING', sub: 'Listen — your microphone is off.', who: 'them' },
    ended: { label: 'PRACTICE ENDED', sub: 'The conversation is below.', who: 'none' },
    /* NOT A TURN STATE — the opposite of one. Nothing the founder says is
       reaching a transcriber, so they are told to stop rather than to
       speak. `sub` is filled in from the runner's own reason. */
    audio_failed: { label: 'VISION IS NOT HEARING YOU', sub: '', who: 'none' },
    /* The detail — what/why/best-move/WTSI — is in the rail now, not here;
       this caption just says the call is paused and where to look. */
    coaching: { label: 'TRY THAT AGAIN', sub: 'VISION is coaching you — see the panel.', who: 'coach' },
    retry_listening: { label: 'RETRY LISTENING', sub: 'Go again — say it your way.', who: 'you' },
    corrected: { label: 'BETTER', sub: '', who: 'good' },
  };

  /* Is the founder mid-sentence right now? A finalised turn is history; an
     unfinished one is someone talking. That is the whole difference between
     "your turn" (say something) and "listening" (keep going). */
  function founderMidUtterance() {
    if (state.live && typeof state.live.listening === 'boolean') return state.live.listening;
    try {
      var s = window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.snapshot();
      return !!(s && (s.turns || []).some(function (t) {
        return !t.endOfTurn && (t.transcript || '').trim();
      }));
    } catch (e) { return false; }
  }

  /* EXACTLY ONE STATE. Every phase resolves here and nowhere else. */
  function liveState() {
    if (state.ended) return 'ended';
    var phase = state.live ? state.live.phase : 'idle';
    if (phase === 'ended') return 'ended';
    /* CHECKED BEFORE EVERY TURN STATE. A dead microphone outranks whose turn
       it is: there are no turns. */
    if (phase === 'audio_failed') return 'audio_failed';
    if (phase === 'connecting' || phase === 'idle') return 'connecting';
    if (phase === 'coaching') return 'coaching';
    if (phase === 'retry_listening') return 'retry_listening';
    if (phase === 'corrected') return 'corrected';
    if (phase === 'thinking') return 'thinking';
    if (phase === 'prospect_speaking') return 'prospect';
    return founderMidUtterance() ? 'listening' : 'your_turn';
  }

  function prospect() {
    return (state.session && state.session.handoff && state.session.handoff.prospect) || {};
  }
  function scriptOf() {
    var h = (state.session && state.session.handoff) || {};
    return h.script || {};
  }
  /* The two dials, echoed back. Deliberately NOT the resolved temperament or
     situation -- those are hidden now, and the header was the one place the
     old build named them on screen. */
  function modeLabel() {
    var K = kit();
    if (!K || !K.DIFFICULTY_LABELS) return 'Practice';
    var d = K.DIFFICULTY_LABELS[state.difficulty] || '';
    var p = K.PRESSURE_LABELS[state.pressure] || '';
    return (d && p) ? (d + ' difficulty \u00b7 ' + p + ' pressure') : 'Practice';
  }

  function clock() {
    if (!state.startedAt || state.ended) return '0:00';
    var s = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
    return String(Math.floor(s / 60)) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ══ SETUP ═════════════════════════════════════════════════════════ */

  function identityHtml() {
    var p = prospect();
    /* sub already reads "Dental Clinic · Ultimo NSW" on real Leads data, so
       appending industry and location repeated the whole line back at the
       founder. Keep whichever parts are genuinely new. */
    var bits = [];
    [txt(p.sub), txt(p.industry), txt(p.location)].forEach(function (v) {
      if (!v) return;
      var already = bits.some(function (b) {
        return b.toLowerCase().indexOf(v.toLowerCase()) > -1 || v.toLowerCase().indexOf(b.toLowerCase()) > -1;
      });
      if (!already) bits.push(v);
    });
    return '<section class="lpc-card lpc-who-card">'
      + '<p class="lpc-lab">Who you are calling</p>'
      + '<h2 class="lpc-who">' + esc(txt(p.name) || 'This prospect') + '</h2>'
      + (bits.length ? '<p class="lpc-sub">' + esc(bits.join(' · ')) + '</p>' : '')
      + '</section>';
  }

  /* ── COACHING FORMAT ─────────────────────────────────────────────────
     Deliberately a SEPARATE choice from the prospect's temperament. A
     founder can rehearse a brutal prospect with coaching on, or an easy one
     with none; folding the two together would have made "harder" and
     "less help" the same dial, which they are not. */
  var FORMATS = [
    { id: 'guided', label: 'Guided Practice', rec: true,
      desc: 'VISION stops you on a serious mistake, explains it, and has you say it again.' },
    { id: 'full_simulation', label: 'Full Simulation', rec: false,
      desc: 'No interruptions. You run the whole call yourself.' },
  ];
  function formatsHtml() {
    var cards = FORMATS.map(function (f) {
      var on = state.format === f.id;
      return '<button type="button" class="lpc-mode' + (on ? ' is-on' : '') + '"'
        + ' data-format="' + esc(f.id) + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
        + '<span class="lpc-mode-top"><span class="lpc-mode-name">' + esc(f.label) + '</span>'
        + (f.rec ? '<span class="lpc-rec">Recommended</span>' : '') + '</span>'
        + '<span class="lpc-mode-desc">' + esc(f.desc) + '</span></button>';
    }).join('');
    return '<section class="lpc-card">'
      + '<p class="lpc-lab">How VISION coaches you</p>'
      + '<div class="lpc-modes">' + cards + '</div>'
      + '</section>';
  }

  /* ── THE ONLY TWO THINGS THE FOUNDER CHOOSES ─────────────────────────
     Replaces the Receptive/Skeptical/Resistant temperament picker and the
     Normal/Busy/Guarded/Curious situation picker outright. Those asked the
     founder to select the person they were about to be tested by, which is
     both the wrong question and a leak: whatever they picked was also the
     answer to what the call would be. Difficulty and Pressure ask about the
     TEST instead, and everything that implements them -- role, situation,
     pain, authority, objection path, hidden facts -- stays hidden.

     Rendered as a four-stop track rather than a range input on purpose: a
     native slider needs a visible numeric value to be usable, and a number
     here would be read as the prospect's stats. */
  function dialHtml(key, current, labels, describes) {
    var stops = K_LEVELS().map(function (id, i) {
      var on = current === id;
      return '<button type="button" class="lpc-stop' + (on ? ' is-on' : '') + '"'
        + ' data-dial="' + esc(key) + '" data-level="' + esc(id) + '"'
        + ' style="--lpc-stop-i:' + i + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '">'
        + '<span class="lpc-stop-dot" aria-hidden="true"></span>'
        + '<span class="lpc-stop-name">' + esc(labels[id] || id) + '</span>'
        + '</button>';
    }).join('');
    return '<div class="lpc-dial" data-dial-for="' + esc(key) + '">'
      + '<div class="lpc-dial-track" role="group">' + stops + '</div>'
      + '<p class="lpc-dial-desc">' + esc(describes[current] || '') + '</p>'
      + '</div>';
  }

  function K_LEVELS() {
    var K = kit();
    return (K && K.INTENSITY_LEVELS) || ['easy', 'medium', 'hard', 'brutal'];
  }

  function dialsHtml() {
    var K = kit();
    if (!K || !K.INTENSITY_LEVELS) return '';
    return '<section class="lpc-card lpc-dials">'
      + '<p class="lpc-lab">Difficulty</p>'
      + '<p class="lpc-dial-what">How hard the sales problem is.</p>'
      + dialHtml('difficulty', state.difficulty, K.DIFFICULTY_LABELS, K.DIFFICULTY_DESCRIBES)
      + '<p class="lpc-lab lpc-lab-2">Pressure</p>'
      + '<p class="lpc-dial-what">How forgiving the person is.</p>'
      + dialHtml('pressure', state.pressure, K.PRESSURE_LABELS, K.PRESSURE_DESCRIBES)
      + '<p class="lpc-dial-hidden">Who answers, what kind of day they are having and what they are '
        + 'holding back are decided by VISION and stay hidden until the call is over.</p>'
      + '</section>';
  }

  function seed() {
    if (!state.situationSeed) {
      /* Real per-session variation. Not a workflow script, not required to
         be reproducible at the call site -- the module it feeds IS
         reproducible given this seed, which is the property that actually
         matters (tests pin the seed, not the clock). */
      state.situationSeed = 'lpc-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
    }
    return state.situationSeed;
  }


  /* ── DELETED: THE CALL CONTEXT CARD ──────────────────────────────────
     It resolved the situation on the SETUP screen and printed its label and
     reasoning before the founder had said a word -- "Curious / Engaged", and
     why. Under the old design that was defensible, because the founder had
     just picked it. Now that the situation is hidden, showing it here would
     be the single largest leak in the product: the whole scenario, answered
     before the phone rings. The prospect identity card above it is
     unchanged; only the hidden weather is withheld. */

  function block(label, value) {
    var v = txt(value);
    if (!v) return '';
    return '<div class="lpc-say"><span class="lpc-say-lab">' + esc(label) + '</span>'
      + '<p class="lpc-say-t">' + esc(v) + '</p></div>';
  }
  function listBlock(label, values) {
    var list = (values || []).map(txt).filter(Boolean);
    if (!list.length) return '';
    return '<div class="lpc-say"><span class="lpc-say-lab">' + esc(label) + '</span>'
      + '<ol class="lpc-say-list">' + list.map(function (v) {
        return '<li>' + esc(v) + '</li>';
      }).join('') + '</ol></div>';
  }

  function scriptHtml() {
    var s = scriptOf();
    var src = (state.showingAdapted && state.adapted) ? state.adapted : s;
    /* THE CORE ONLY: the two lines a founder actually opens with. Everything
       else in the approach is one click away in the prep rail — visible when
       wanted, not shouting on arrival. Nothing is removed and nothing is
       summarised; a founder who wants the whole thing gets the whole thing. */
    var body = block('Opening', src.opening) + block('First question', src.firstQuestion);
    return '<section class="lpc-card">'
      + '<p class="lpc-lab">What to say</p>'
      + (body || '<p class="lpc-empty">VISION does not have an approach for this prospect yet. '
        + 'You can still practise — open with whatever you would really open with.</p>')
      + (body ? '<p class="lpc-note">Use the meaning, not the words. '
        + 'Say it however you would naturally say it — they answer what you mean.</p>' : '')
      + adaptHtml()
      + '</section>';
  }

  /* ── THE PREP RAIL ────────────────────────────────────────────────────
     Everything a founder might want before dialling, and nothing they must
     read. Two facts are always visible because they change how the whole
     call is played — what you are aiming for, and what they will most likely
     push back with. The rest opens on request.

     EVERY SECTION IS OMITTED WHEN EMPTY. An "Avoid saying" heading over
     nothing teaches a founder that VISION's prep is decoration. */
  function prepSection(title, inner) {
    if (!inner) return '';
    return '<details class="lpc-prep-x"><summary>' + esc(title) + '</summary>'
      + '<div class="lpc-prep-body">' + inner + '</div></details>';
  }
  function bullets(list) {
    var items = (list || []).map(txt).filter(Boolean);
    if (!items.length) return '';
    return '<ul class="lpc-prep-list">' + items.map(function (v) {
      return '<li>' + esc(v) + '</li>';
    }).join('') + '</ul>';
  }

  function prepHtml() {
    var h = (state.session && state.session.handoff) || {};
    var sc = scriptOf();
    var aim = txt(h.desiredClose && h.desiredClose.note) || txt(h.desiredClose && h.desiredClose.action);
    var objections = (h.objections || []).map(function (o) { return txt(o && o.q); }).filter(Boolean);
    var out = '';

    if (aim) {
      out += '<div class="lpc-prep-fact"><span class="lpc-prep-lab">Your aim</span>'
        + '<p>' + esc(aim) + '</p></div>';
    }
    if (objections.length) {
      out += '<div class="lpc-prep-fact"><span class="lpc-prep-lab">Likely objection</span>'
        + '<p>&ldquo;' + esc(objections[0]) + '&rdquo;</p></div>';
    }

    var approach = block('Bridge to what you do', sc.pitchBridge) + block('Aim to close on', sc.close);
    out += prepSection('Approach', approach);
    out += prepSection('Discovery points', bullets(sc.discovery));
    if (objections.length > 1) {
      out += prepSection('Other objections', bullets(objections.slice(1)));
    }
    out += prepSection('Avoid saying', bullets(sc.dontSay));
    out += prepSection('What we still don\u2019t know', bullets(h.unknowns));
    if (txt(sc.edited)) {
      out += prepSection('Your own version', '<p class="lpc-say-t">' + esc(txt(sc.edited)) + '</p>');
    }
    if (!out) return '';
    return '<aside class="lpc-prep"><p class="lpc-lab">Prep</p>' + out + '</aside>';
  }

  /* ONLY WHEN THERE IS A PROFILE TO BACK IT. VISION has a Communication
     Profile flow; if the founder has not been through it there is nothing to
     sound like, so the control is absent rather than present and inert. */
  function adaptHtml() {
    if (!state.profile || !kit()) return '';
    var out = '<div class="lpc-adapt">'
      + '<button type="button" class="lpc-btn lpc-btn-quiet" id="lpcAdapt">'
        + (state.showingAdapted ? 'Show VISION’s wording' : 'Make this sound more like me')
      + '</button>';
    if (state.adaptNote) out += '<p class="lpc-adapt-note">' + esc(state.adaptNote) + '</p>';
    return out + '</div>';
  }

  /* ── SAVING RECORDINGS ────────────────────────────────────────────────
     Asked HERE, on the last screen before a microphone is ever opened,
     because consent has to precede the recording rather than follow it.
     Inline and quiet rather than a modal: a wall of privacy text in front of
     a founder who came here to rehearse is a tax, not a choice.

     Asked ONCE. A founder who says no is never asked again by this screen,
     and loses nothing but replay. */
  function consentHtml() {
    if (state.recording === 'error_fallback') {
      return '<section class="lpc-card lpc-consent"><p class="lpc-lab">Recording</p>'
        + '<p class="lpc-consent-p">Recording won’t be saved this session. '
        + 'Everything else about your practice works as normal.</p></section>';
    }
    if (state.recording !== 'not_asked') return '';
    return '<section class="lpc-card lpc-consent">'
      + '<p class="lpc-lab">Save practice recordings?</p>'
      + '<p class="lpc-consent-p">VISION can keep your practice recordings so you can replay a moment '
        + 'and hear how your delivery changes over time.</p>'
      + '<div class="lpc-consent-act">'
        + '<button type="button" class="lpc-btn lpc-btn-go" id="lpcAllow">Allow</button>'
        + '<button type="button" class="lpc-btn lpc-btn-quiet" id="lpcDecline">Not now</button>'
        + '<button type="button" class="lpc-linkbtn" id="lpcWhy">Why save recordings?</button>'
      + '</div>'
      + (state.recordingWhy
        ? '<div class="lpc-consent-why">'
          + '<p>They are yours, and they are only used to help you practise — replaying a moment you '
            + 'want to hear again, and comparing your delivery across sessions.</p>'
          + '<p>You can say no and practise exactly as normal. VISION still keeps the transcript and '
            + 'what it noticed about the call; it just will not keep the audio.</p>'
          + '<p>Only your own voice is kept. The practice prospect is generated speech, so there is '
            + 'nothing of theirs to save. You can delete saved recordings later.</p>'
          + '</div>'
        : '')
      + '</section>';
  }

  /* Arrives from a review. Whitelisted by the coaching engine, never
     rendered as its internal name. */
  function focusFromUrl() {
    var K = kit();
    if (!K || !K.resolveFocus) return null;
    try { return K.resolveFocus(new URLSearchParams(location.search).get('focus')); } catch (e) { return null; }
  }
  function focusHtml() {
    if (!state.focus) return '';
    return '<section class="lpc-card lpc-focus">'
      + '<p class="lpc-lab">Practice focus</p>'
      + '<p class="lpc-focus-line">' + esc(state.focus.label) + '</p>'
      + '<p class="lpc-focus-sub">VISION will prioritise this if it comes up. The call still plays out '
        + 'normally.</p></section>';
  }

  function renderSetup() {
    shell('<header class="lpc-bar">'
        + '<div class="lpc-id"><h1 class="lpc-title">Practice call</h1>'
        + '<p class="lpc-mode-line">' + esc(modeLabel()) + '</p></div>'
        + '<div class="lpc-mid"></div>'
        + '<div class="lpc-act"><button type="button" class="lpc-btn lpc-btn-go" id="lpcStart">Start practice</button></div>'
      + '</header>'
      + '<div class="lpc-body lpc-setup">'
        + '<div class="lpc-main">'
          + focusHtml()
          + identityHtml()
          + dialsHtml()
          + formatsHtml()
          + scriptHtml()
          + consentHtml()
          + (state.notice ? '<p class="lpc-notice">' + esc(state.notice) + '</p>' : '')
          + '<div class="lpc-go-row">'
            + '<button type="button" class="lpc-btn lpc-btn-go lpc-btn-big" id="lpcStartB"'
              + (state.arming ? ' disabled' : '') + '>'
              + (state.arming ? 'Starting…' : 'Start practice') + '</button>'
            + '<span class="lpc-go-hint">VISION will play ' + esc(txt(prospect().name) || 'this prospect')
            + ' and answer you out loud.</span>'
          + '</div>'
        + '</div>'
        + prepHtml()
      + '</div>'
      + '<a class="lpc-back" href="leads.html">Back to Leads</a>');

    Array.prototype.forEach.call(document.querySelectorAll('[data-dial]'), function (b) {
      b.addEventListener('click', function () {
        var dial = b.getAttribute('data-dial');
        var lvl = b.getAttribute('data-level');
        if (dial === 'difficulty') state.difficulty = lvl;
        else if (dial === 'pressure') state.pressure = lvl;
        render();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-format]'), function (b) {
      b.addEventListener('click', function () {
        state.format = b.getAttribute('data-format');
        render();
      });
    });
    var a = document.getElementById('lpcAdapt');
    if (a) a.addEventListener('click', toggleAdapted);
    var allow = document.getElementById('lpcAllow');
    if (allow) allow.addEventListener('click', function () { setRecording('allowed'); });
    var decline = document.getElementById('lpcDecline');
    if (decline) decline.addEventListener('click', function () { setRecording('declined'); });
    var why = document.getElementById('lpcWhy');
    if (why) why.addEventListener('click', function () { state.recordingWhy = !state.recordingWhy; render(); });
    [document.getElementById('lpcStart'), document.getElementById('lpcStartB')].forEach(function (b) {
      if (b) b.addEventListener('click', start);
    });
  }

  /* ══ LIVE ══════════════════════════════════════════════════════════ */

  function liveBarHtml(now) {
    var p = prospect();
    var running = now !== 'ended';
    /* Script access lives only in the right rail now (one Full Script
       surface, not two) and End practice is the physical control at the
       foot of the call — the header carries identity and the clock, and
       (only once the call is over) the way back into another attempt. */
    return '<header class="lpc-bar">'
      + '<div class="lpc-id">'
        + '<h1 class="lpc-who">' + esc(txt(p.name) || 'Practice call') + '</h1>'
        + '<p class="lpc-mode-line">' + esc(modeLabel()) + ' &middot; '
          + esc(state.format === 'guided' ? 'Guided' : 'Full simulation') + '</p>'
      + '</div>'
      + '<div class="lpc-mid"><span class="lpc-clock" id="lpcClock">' + clock() + '</span></div>'
      + '<div class="lpc-act">'
        + (running ? '' : '<button type="button" class="lpc-btn lpc-btn-go" id="lpcAgain">Practise again</button>')
      + '</div>'
      + '</header>';
  }

  /* ── CALL CONTROLS ────────────────────────────────────────────────────
     Mute/Speaker are UI state only — the approved concept's phone-call
     controls, not a new capture toggle. End practice is the one real
     action here, wired to the same stop() the header button used to call.
     Absent once the call has ended; just End practice while connecting,
     since there is nothing yet to mute or route to a speaker. */
  var MIC_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">'
    + '<path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"/><path d="M19 11a7 7 0 0 1-14 0"/>'
    + '<path d="M12 18v3"/></svg>';
  var SPEAKER_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">'
    + '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/></svg>';
  var END_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">'
    + '<path d="M12 3C7 3 2.7 4.7 1.4 6c-.5.5-.6 1.3-.1 2l2.3 3.1c.5.6 1.3.8 2 .5l2.6-1.1c.6-.2.9-.9.8-1.5l-.4-1.7c1-.2 '
    + '2.2-.4 3.4-.4s2.4.1 3.4.4l-.4 1.7c-.1.6.2 1.3.8 1.5l2.6 1.1c.7.3 1.5.1 2-.5L22.7 8c.5-.7.4-1.5-.1-2C21.3 4.7 '
    + '17 3 12 3Z"/></svg>';

  function controlsHtml(now, railed) {
    if (now === 'ended') return '';
    var full = now !== 'connecting';
    return '<div class="lpc-controls' + (railed ? ' lpc-controls-railed' : '') + '">'
      + (full
        ? '<button type="button" class="lpc-ctl' + (state.muted ? ' is-on' : '') + '" id="lpcMute">'
          + '<span class="lpc-ctl-face">' + MIC_ICON + '</span><span class="lpc-ctl-lab">Mute</span></button>'
          + '<button type="button" class="lpc-ctl' + (state.speakerOn ? ' is-on' : '') + '" id="lpcSpeaker">'
          + '<span class="lpc-ctl-face">' + SPEAKER_ICON + '</span><span class="lpc-ctl-lab">Speaker</span></button>'
        : '')
      + '<button type="button" class="lpc-ctl lpc-ctl-end" id="lpcEnd">'
        + '<span class="lpc-ctl-face">' + END_ICON + '</span><span class="lpc-ctl-lab">End practice</span></button>'
      + '</div>';
  }

  /* ONE STATE AT A TIME, still — but the pause now takes over the RAIL
     rather than the turn indicator: the orb keeps answering "whose turn is
     it" (paused, per TURN.coaching), and this is the detail beside it, not
     instead of it. Called from railHtml(), never from turnHtml(). */
  function coachingHtml() {
    var c = state.live && state.live.coaching;
    if (!c) return '';
    var w = c.wtsi;
    /* Before the unaided go there is no example, on purpose: the founder is
       being asked to make the move himself, and showing him the sentence
       first turns a rehearsal into a reading exercise. */
    var head = w ? 'NEED A HAND?' : 'TRY THAT AGAIN';
    var body = ''
      + '<p class="lpc-rail-k">' + esc(head) + '</p>'
      + (c.whatHappened
        ? '<p class="lpc-coach-what"><span class="lpc-coach-k">What happened</span>'
          + esc(c.whatHappened) + '</p>' : '')
      + (c.whyItHurt
        ? '<p class="lpc-coach-why"><span class="lpc-coach-k">Why it hurt</span>'
          + esc(c.whyItHurt) + '</p>' : '')
      + (c.bestMove
        ? '<p class="lpc-coach-better"><span class="lpc-coach-k">Best move</span>'
          + esc(c.bestMove) + '</p>' : '')
      + (c.note ? '<p class="lpc-coach-note">' + esc(c.note) + '</p>' : '');

    if (w && w.available && w.lines && w.lines.length) {
      body += '<div class="lpc-wtsi"><p class="lpc-wtsi-k">What to say instead</p>'
        + w.lines.map(function (l) {
          return '<p class="lpc-coach-eg">&ldquo;' + esc(l) + '&rdquo;</p>';
        }).join('')
        + '</div>';
    } else if (w) {
      /* NEVER AN EMPTY CARD. Nothing survived the move gate, and inventing
         a sentence to fill the space would teach the wrong move with
         VISION behind it. */
      body += '<div class="lpc-wtsi"><p class="lpc-wtsi-k">What to say instead</p>'
        + '<p class="lpc-coach-none">No safe example available. '
        + 'Follow the Best Move and try once more.</p></div>';
    }

    return '<section class="lpc-rail-coach" aria-live="assertive">'
      + body
      + '<div class="lpc-coach-act">'
        + '<button type="button" class="lpc-btn lpc-btn-go" id="lpcRetry">'
        + (w ? 'Go again' : 'Try again') + '</button>'
      + '</div>'
      + '</section>';
  }

  function correctedHtml() {
    var n = state.live && state.live.correctedNote;
    if (!n) return '';
    return '<section class="lpc-turn lpc-turn-good" aria-live="assertive">'
      + '<p class="lpc-turn-label">' + esc(n.headline.toUpperCase()) + '</p>'
      + '<p class="lpc-turn-sub">' + esc(n.note) + '</p>'
      + '</section>';
  }

  /* ── THE CALL ENDED, AND WHO ENDED IT ─────────────────────────────────
     Terminal, and it says so. No Continue: there is nothing to continue,
     and offering it would suggest the founder can talk his way back into a
     call that is over.

     WHO ENDED IT IS NOT ALWAYS THE PROSPECT. This screen used to say "The
     prospect ended the conversation" for every ending the engine produces
     -- including the two that are the FOUNDER closing the call himself.
     A founder who correctly established there was no need and stopped was
     told the prospect walked out on him, which is both false and the exact
     opposite lesson.

     The set is closed: prospect-behaviour.js produces exactly six reasons,
     and only the professional_exit branch is the founder's own. Anything
     unrecognised states the fact and claims nothing about who caused it --
     a screen that guesses ownership is worse than one that stays quiet. */
  var ENDING_COPY = {
    hostility_from_founder: { sub: 'The prospect ended the conversation.',
      why: 'Your last response caused them to disengage.' },
    pushed_too_hard: { sub: 'The prospect ended the conversation.',
      why: 'They ended it after being pushed too hard.' },
    lost_patience: { sub: 'The prospect ended the conversation.',
      why: 'They ran out of patience before you got there.' },
    refusal_accepted: { sub: 'The call ended after they said no.',
      why: 'You accepted it rather than pushing.' },
    founder_closed_politely: { sub: 'You ended the call.',
      why: 'You closed it yourself.' },
    no_fit_identified: { sub: 'You ended the call.',
      why: 'There was no need here, and you stopped without forcing it.' },
  };
  function hungUpHtml() {
    var e = state.live && state.live.endedByProspect;
    if (!e) return '';
    var copy = ENDING_COPY[e.reason] || { sub: 'The call ended.', why: '' };
    return '<section class="lpc-turn lpc-turn-over" aria-live="assertive">'
      + '<p class="lpc-turn-label">CALL ENDED</p>'
      + '<p class="lpc-turn-sub">' + esc(copy.sub) + '</p>'
      + (copy.why ? '<p class="lpc-over-why">' + esc(copy.why) + '</p>' : '')
      + '</section>';
  }

  function turnHtml(now) {
    /* Coaching no longer replaces the turn indicator — TURN.coaching (below,
       in the generic branch) supplies its label/sub, and the detail is in
       the rail via coachingHtml(). */
    if (now === 'corrected') return correctedHtml() || '';
    if (now === 'audio_failed') return audioFailedHtml();
    /* Precedence: a hangup is the truth about the call, and the scoring
       notice is only the truth about the review. */
    if (now === 'ended' && state.live && state.live.endedByProspect) {
      return hungUpHtml() + (state.reviewState ? endedHtml() : '');
    }
    if (now === 'ended' && state.reviewState) return endedHtml();
    var t = TURN[now] || TURN.connecting;
    return '<section class="lpc-turn lpc-turn-' + esc(t.who) + '" aria-live="assertive">'
      + '<div class="lpc-turn-mark" aria-hidden="true"></div>'
      + '<p class="lpc-turn-label">' + esc(t.label) + '</p>'
      + '<p class="lpc-turn-sub">' + esc(t.sub) + '</p>'
      + '</section>';
  }

  /* WHAT IS HAPPENING TO THEIR CALL, while it happens. Scoring reads the
     persisted evidence and the recording has to finish uploading first, so
     there is a real wait here — and a founder who is not told there is one
     reads the ended screen as the end of the product. */
  function endedHtml() {
    if (state.reviewState === 'preparing') {
      /* A STATIC LABEL FOR A MINUTE READS AS A HANG. Scoring is one model
         pass over the whole call. The only hard dataset in the repo (seven
         real paid staging calls, 2026-08-25, scoreMs in
         artifacts/practice-torture-2026-08-25-evidence) measured
         43.7-80.4 s, median ~47 s — the earlier "23-52 s" comment and the
         "about 30 seconds" promise this copy used to make sat BELOW the
         whole measured range, so the reassurance itself taught founders the
         screen was stuck (Phase 5 WP-0). The promise now covers what was
         actually measured, and the "longer than usual" line waits until the
         wait genuinely is: past the slowest observed run.

         Nothing here is invented progress: the stages are the real order of
         the work, the clock is real elapsed time, and the last line appears
         only once the wait exceeds everything measured. A fake percentage
         bar would be worse than the static label it replaced. */
      var waited = state.reviewStartedAt
        ? Math.round((Date.now() - state.reviewStartedAt) / 1000) : 0;
      var stage = waited < 4 ? 'Saving the last of the conversation.'
        : waited < 12 ? 'Reading back what you actually said.'
          : waited < 45 ? 'Weighing each moment against the standard.'
            : 'Putting the review together.';
      return '<section class="lpc-turn lpc-turn-none" aria-live="polite">'
        + '<p class="lpc-turn-label">SCORING YOUR CALL</p>'
        + '<p class="lpc-turn-sub">' + esc(stage) + '</p>'
        + '<p class="lpc-scoring-clock">' + esc(clockOf(waited))
          + '<i> · usually about a minute</i></p>'
        + (waited > 90
          ? '<p class="lpc-scoring-slow">This is taking longer than usual. '
            + 'The call is saved — nothing is lost while you wait.</p>' : '')
        + '</section>';
    }
    var stalled = state.reviewState === 'stalled';
    /* Primary/secondary/tertiary, in that order: review it (when there is
       one to open), go again, or leave. A founder who lands here has just
       finished a rehearsal — the next move should read as a choice, not a
       dead end with one quiet link out. */
    return '<section class="lpc-turn lpc-turn-dead" aria-live="assertive">'
      + '<p class="lpc-turn-label">' + (stalled ? 'YOUR REVIEW IS TAKING LONGER THAN USUAL'
        : 'THIS REHEARSAL WAS NOT SAVED') + '</p>'
      + '<p class="lpc-turn-sub">' + (stalled
        ? 'The call is recorded and nothing has been lost. Open the review directly.'
        : 'VISION never opened a session for this call, so there is nothing to score. '
          + 'The conversation is still below.') + '</p>'
      + '<div class="lpc-coach-act">'
        + (stalled ? '<a class="lpc-btn lpc-btn-go" href="live-intelligence.html?review='
          + encodeURIComponent(state.reviewSessionId) + '">Review the call</a>' : '')
        + '<button type="button" class="lpc-btn lpc-btn-quiet" id="lpcAgainInline">Practise again</button>'
        + '<a class="lpc-btn lpc-btn-quiet" href="leads.html">Back to Leads</a>'
      + '</div></section>';
  }

  /* The one screen that must not look like a turn indicator. It says what
     broke, in the founder's terms, and gives them the two things they can
     actually do about it. */
  function audioFailedHtml() {
    var why = (state.live && state.live.audioError)
      || 'VISION could not start listening, so nothing you say would be heard.';
    return '<section class="lpc-turn lpc-turn-dead" aria-live="assertive">'
      + '<p class="lpc-turn-label">' + esc(TURN.audio_failed.label) + '</p>'
      + '<p class="lpc-turn-sub">' + esc(why) + '</p>'
      + '<div class="lpc-coach-act">'
        + '<button type="button" class="lpc-btn lpc-btn-go" id="lpcRestart">Try starting again</button>'
        + '<a class="lpc-btn lpc-btn-quiet" href="leads.html">Back to Leads</a>'
      + '</div></section>';
  }

  function transcriptHtml() {
    var h = (state.live && state.live.history) || [];
    if (!h.length) return '<p class="lpc-empty">Your rehearsal will appear here as you talk.</p>';
    var last = h.length - 1;
    return h.map(function (row, i) {
      var them = row.speaker === 'prospect';
      return '<div class="lpc-line lpc-' + (them ? 'them' : 'you') + (i === last ? ' is-now' : '') + '">'
        + '<span class="lpc-speaker">' + (them ? 'Prospect' : 'Founder') + '</span>'
        + '<p>' + esc(row.text) + '</p></div>';
    }).join('');
  }

  /* WP-4: "Why this practice?" -- built by the server from the ONE
     persisted training objective for this session, already whitelisted
     (explainObjective() never receives the scenario, role, mood, or any
     hidden axis). Rendered exactly as the server sent it: no client-side
     regeneration, no reformatting that could drift from what was
     persisted. Absent on any call the server could not build one for
     (draw failed, legacy session) -- the call still works with nothing
     shown here, same fail-open contract as the rest of this screen. */
  function trainingFocusHtml() {
    var tf = state.live && state.live.trainingFocus;
    if (!tf || !tf.headline) return '';
    return '<div class="lpc-sig lpc-sig-training">'
      + '<span class="lpc-sig-lab">Why this practice?</span>'
      + '<p class="lpc-sig-training-headline">' + esc(tf.headline) + '</p>'
      + (tf.why ? '<p>' + esc(tf.why) + '</p>' : '')
      + (tf.evidenceLine ? '<p class="lpc-sig-training-meta">' + esc(tf.evidenceLine) + '</p>' : '')
      + (tf.businessLine ? '<p class="lpc-sig-training-meta">' + esc(tf.businessLine) + '</p>' : '')
      + '</div>';
  }

  /* Only when there is something real to say. */
  function signalHtml() {
    var out = trainingFocusHtml();
    /* THE RUNNER'S OWN NOTICE. A turn that failed or timed out has to say so
       here, in the conversation, because the founder is mid-rehearsal and
       will otherwise assume the prospect simply had nothing to say. */
    var live = (state.live && state.live.notice) || null;
    if (live) {
      out += '<div class="lpc-sig lpc-sig-warn"><span class="lpc-sig-lab">That did not send</span>'
        + '<p>' + esc(live) + '</p></div>';
    }
    if (state.notice) {
      out += '<div class="lpc-sig lpc-sig-quiet"><span class="lpc-sig-lab">Practice</span>'
        + '<p>' + esc(state.notice) + '</p></div>';
    }
    var turns = (state.live && state.live.turns) || [];
    var latest = turns.length ? turns[turns.length - 1] : null;
    if (latest && latest.objection) {
      out += '<div class="lpc-sig"><span class="lpc-sig-lab">They are holding back</span>'
        + '<p>' + esc(latest.objection) + '</p></div>';
    }
    /* WHOSE VOICE THEY ARE HEARING. The prospect's own voice failing is not
       the same as no sound at all, and telling a founder "no sound on this
       device" while their laptop is talking to them is simply wrong. */
    var errs = (state.live && state.live.errors) || [];
    var noVoice = errs.some(function (e) { return /^speech:prospect_voice_/.test(e); });
    var silent = errs.some(function (e) {
      return e === 'speech_unsupported' || /^speech:(no_audio_available|speech_timeout|speech_error)/.test(e);
    });
    if (silent) {
      out += '<div class="lpc-sig lpc-sig-quiet"><span class="lpc-sig-lab">No sound on this device</span>'
        + '<p>Their replies are written below — the rehearsal still works.</p></div>';
    } else if (noVoice) {
      /* WHY IT HAS NO VOICE, not just that it has none. "Unavailable right
         now" invites a founder to try again in five minutes, which is right
         for a timeout and wrong for a provider that has refused on billing —
         that one does not fix itself and they should stop waiting for it.
         The provider is never named and no status code reaches the screen. */
      var reason = errs.map(function (e) {
        var m = /^speech:prospect_voice_(.+)$/.exec(e); return m ? m[1] : null;
      }).filter(Boolean)[0] || '';
      var settled = /unconfigured|unavailable|too_long_for_speech/.test(reason);
      out += '<div class="lpc-sig lpc-sig-quiet"><span class="lpc-sig-lab">Not their real voice</span>'
        + '<p>' + (settled
          ? 'The prospect voice is switched off in this environment, so this is your device '
            + 'reading their replies. Waiting will not change it, and nothing else about the '
            + 'rehearsal is affected.'
          : 'The prospect voice did not answer in time, so this is your device reading their '
            + 'replies. It may work on your next call. Everything else is unchanged.')
        + '</p></div>';
    }
    return out;
  }

  /* ── DELETED: THE SITUATION CHIP ──────────────────────────────────────
     It rendered the resolved situation's label -- "Curious / Engaged",
     "Guarded" -- in the live rail for the whole call. That is precisely the
     hidden variable Controlled Uncertainty exists to withhold, and it was on
     screen from the first ring. Nothing replaces it during the call; the
     reveal belongs in the post-call review, where it can teach. */

  /* ── THE LIVE RAIL ───────────────────────────────────────────────────
     ONE Live Intelligence surface for the whole call, not two: Say This
     Next and Full Script when things are normal; the
     guided-pause detail when they are not. It sits beside the conversation
     and never over it, and — unlike before — it never disappears, so Full
     Script stays reachable in exactly this one place at all times. Absent
     only while connecting (nothing to coach yet) and once the call ends. */
  function railHtml(now) {
    if (now === 'connecting') return '';
    /* ── ONE GATE FOR EVERY LIVE ASSISTANCE SURFACE ────────────────────
       MOVE, Say This Next, Full Script and the reaction chip all live in
       here, and all of them are assistance. Guided Practice is assisted
       execution; FULL SIMULATION IS UNASSISTED, so none of it may appear
       there -- the rail builder being shared between the formats is why
       this gate exists rather than a reason it does not need to.

       Read from the snapshot rather than re-derived from state.format and
       the phase, because the runner already answers this question for
       `coachingRenderedAt`. Two independent readings of one rule is exactly
       how a surface ends up showing what provenance says was never shown.

       `ended` is inside the same predicate now: a finished call has no live
       surface to put anything on, whichever format it was. */
    if (!(state.live && state.live.liveAssistance)) return '';
    var coaching = coachingHtml();
    if (coaching) {
      /* The pause IS the rail's content then — Say This Next and the
         situation chip would tell him to do two things at the same moment. */
      return '<aside class="lpc-rail" aria-label="Guided practice">' + coaching + '</aside>';
    }
    var r = state.live && state.live.rail;
    var sayBlock = '';
    var stages = '';
    /* EXHAUSTED IS NOT EMPTY. When every phrasing of this move has been used
       and declined, the rail stops offering words -- but hiding the whole
       panel would take the goal and the script away at the exact moment the
       founder is stuck, which is when he needs them most. The line goes
       quiet; nothing else does. */
    var goal = r && r.bestMove && r.bestMove.goal ? r.bestMove.goal : '';
    if (r && (goal || r.sayNext || r.exhausted)) {
      stages = (r.stages || []).map(function (st) {
        return '<li class="lpc-stage lpc-stage-' + esc(st.state) + '">' + esc(st.label) + '</li>';
      }).join('');
      /* ── THE MOVE, THEN THE WORDS ─────────────────────────────────
         The decision has always produced a goal -- "Find out how it works
         today." -- and no surface has ever shown it, so the founder read a
         sentence with no statement of what it was for. He could not tell a
         line that had changed because the call moved from one that had
         changed because the rail ran out of phrasings.

         It leads now, and the sentence is offered underneath it. Several
         moves carry no sentence at all -- pausing, answering what they
         just asked -- and for those the goal IS the advice, which only
         works because it is on screen. */
      var behaviour = !!(r.bestMove && r.bestMove.behaviourOnly);
      /* "SAY THIS NEXT" OVER "PAUSE AND LET THEM FINISH" IS A CONTRADICTION.
         Some of the best moves in a call are not things to say, and heading
         them with an instruction to speak is the surface arguing with the
         decision in the one place the founder is looking. */
      sayBlock = '<section class="lpc-rail-b">'
        + '<p class="lpc-rail-k">' + (behaviour ? 'Do this next' : 'Say this next') + '</p>'
        + (goal ? '<p class="lpc-move">' + esc(goal) + '</p>' : '')
        + (r.sayNext
          ? '<p class="lpc-say">' + esc(r.sayNext) + '</p>'
          /* NOT A STRATEGIC VERDICT ANY MORE. This used to read "Change the
             subject, or close it politely" -- a decision about the call,
             asserted by the surface, from the purely lexical fact that a
             wording pool had emptied. The decision layer now owns that: it
             escalates the move itself when one is spent. All this has to
             do is stop pretending there is a line. */
          : (behaviour ? ''
            : '<p class="lpc-say lpc-say-spent">You have put this every way it can be put.</p>'))
        + '</section>';
    }
    /* Full Script is ALWAYS here, whether or not the runner has produced
       rail guidance yet — adaptiveScriptHtml(null) falls back cleanly to
       the same scriptHtml()+prepHtml() the header's old drawer showed. */
    return '<aside class="lpc-rail" aria-label="Live coaching">'
      + liveReactionHtml()
      + sayBlock
      + '<details class="lpc-rail-script"' + (state.railScriptOpen ? ' open' : '') + '>'
        + '<summary>Full script</summary>'
        + (stages ? '<ol class="lpc-stages">' + stages + '</ol>' : '')
        + '<div class="lpc-rail-full">' + adaptiveScriptHtml(r) + '</div>'
      + '</details>'
      + '</aside>';
  }

  /* ── GUIDED LIVE REACTION INTELLIGENCE ────────────────────────────────
     Patience, Trust, Interest, Engagement -- exactly one at a time, exactly
     when the runner decided one crossed the line worth mentioning. Nothing
     is computed here: state.live.guidedReaction is already the founder-safe
     shape (a signal name, an arrow, a plain-English reason), built by
     guided-reaction.js from state this same call already produced.

     GUIDED-ONLY, checked here as well as inside the module that built it.
     state.format is the founder's own setup-screen choice and the runner
     re-derives the same gate from run.format on every snapshot -- so a
     Full Simulation call sees this render nothing even though railHtml()
     itself is shared between both formats. Two independent checks refusing
     the same thing is the belt-and-suspenders this codebase already uses
     everywhere state crosses from server to screen.

     RESTRAINED ON PURPOSE. One line, one arrow, one reason -- not four
     permanent meters running the whole call. It replaces itself on the
     next meaningful turn and otherwise just sits there holding the last
     thing that actually happened, which is what "keeps the most relevant
     recent signal visible" means for a founder mid-sentence. */
  function liveReactionHtml() {
    if (state.format !== 'guided') return '';
    var r = state.live && state.live.guidedReaction;
    if (!r) return '';
    /* BELT AND SUSPENDERS. The runner already clears/re-stamps this on
       every turn (li-practice-runner.js) -- this is the independent check
       that catches it if that ever stops being true. A reaction is only
       current if it names the sequence of the most recent founder turn
       actually processed; anything else is a turn or more old and must not
       render, no matter what its wording says or how positive it reads. */
    var reactTurns = (state.live && state.live.turns) || [];
    var latestSeq = reactTurns.length ? reactTurns[reactTurns.length - 1].sequence : null;
    if (typeof r.atSequence !== 'number' || r.atSequence !== latestSeq) return '';
    /* ── THE CALL IS NEARLY LOST ────────────────────────────────────
       One extra class, nothing else. `critical` is a boolean the engine
       set from the same comparison that ends the call, so this is the
       same fact the prospect is about to act on -- not a second opinion
       and not a meter. Deliberately no countdown, percentage or bar:
       there is no number here to render, by design. */
    return '<section class="lpc-rail-b lpc-react lpc-react-' + esc(r.signal) + '-' + esc(r.direction)
      + (r.critical ? ' is-critical' : '') + '">'
      + '<p class="lpc-react-line">'
        + '<span class="lpc-react-sig">' + esc(r.headline) + '</span> '
        + '<span class="lpc-react-arrow" aria-hidden="true">' + esc(r.arrow) + '</span>'
      + '</p>'
      + '<p class="lpc-react-why">' + esc(r.reason) + '</p>'
      + '</section>';
  }

  /* ── THE SCRIPT, AS THE CALL HAS LEFT IT ──────────────────────────────
     The same script the setup screen shows, with what has already happened
     taken out of the way: a question he has asked and had answered is not
     something to ask again, and a stage he is past should not compete with
     the one he is in. Nothing is deleted -- a founder who wants the whole
     approach still has it -- it recedes. */
  function adaptiveScriptHtml(rail) {
    var answered = (rail && rail.answered) || [];
    var html = scriptHtml() + prepHtml();
    if (!answered.length) return html;
    /* Mark, never remove: the founder should be able to see he covered it. */
    answered.forEach(function (q) {
      var needle = esc(String(q).trim());
      if (!needle) return;
      html = html.split(needle).join('<span class="lpc-done">' + needle + '</span>');
    });
    return html;
  }

  /* ── AUDIO-REACTIVE ORB ───────────────────────────────────────────────
     Real founder microphone level, not a canned loop: window.VISION_ASSEMBLY
     already tracks RMS off the capture worklet for every practice call
     (li-assembly.js), so this reads the same array rather than inventing a
     second signal. Runs its own rAF loop OUTSIDE render() — shell() replaces
     the whole DOM subtree on every runner update, so a value written inside
     render() would be erased the instant the next transcript line arrives.
     Written as a CSS custom property; --lpc-level defaults to 0 in the
     stylesheet, so a muted mic or an untouched .lpc-turn-mark (setup, dead,
     good, over states) just never moves. There is no equivalent signal for
     the prospect's synthesised voice today (see li-practice-runner.js's
     private audioEl) — that side uses the plain organic loop in CSS. */
  function stopOrbReactivity() {
    if (orbRaf) { cancelAnimationFrame(orbRaf); orbRaf = null; }
    orbDisplay = 0;
  }
  function startOrbReactivity(now) {
    stopOrbReactivity();
    if (now === 'connecting' || now === 'ended') return;
    var tick = function () {
      var el = document.querySelector('.lpc-turn-mark');
      if (!el) { orbRaf = null; return; }        /* re-rendered away; stop quietly */
      var target = 0;
      try {
        var levels = window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.levels
          && window.VISION_ASSEMBLY.levels();
        var last = levels && levels.length ? levels[levels.length - 1] : null;
        /* A sample older than ~800ms is stale (mic muted, capture stopped) —
           trusting it would freeze the orb mid-peak instead of settling. */
        if (last && (Date.now() - last.at) < 800) target = Math.max(0, Math.min(1, last.rms * 14));
      } catch (e) { target = 0; }
      /* Light smoothing so real 128ms-apart samples read as motion, not a
         step function. */
      orbDisplay += (target - orbDisplay) * 0.18;
      if (orbDisplay < 0.01) orbDisplay = 0;
      el.style.setProperty('--lpc-level', orbDisplay.toFixed(3));
      orbRaf = requestAnimationFrame(tick);
    };
    orbRaf = requestAnimationFrame(tick);
  }

  function renderLive() {
    var now = liveState();
    if (now === 'ended' && timer) { clearInterval(timer); timer = null; }
    var rail = railHtml(now);
    /* Nothing has been said yet and nobody is coaching anything: showing an
       empty transcript or an idle rail here would be furniture, not
       information, and the brief is explicit that ringing shows neither. */
    var connecting = (now === 'connecting');

    shell(liveBarHtml(now)
      + '<div class="lpc-body' + (rail ? ' lpc-body-railed' : '') + '">'
        + turnHtml(now)
        + (connecting ? '' : signalHtml())
        + (connecting ? '' : '<section class="lpc-convo">'
          + '<p class="lpc-lab">Conversation</p>'
          + '<div class="lpc-scroll" id="lpcTranscript">' + transcriptHtml() + '</div>'
        + '</section>')
      + '</div>'
      + controlsHtml(now, !!rail)
      + rail
      + '<a class="lpc-back" href="leads.html">Back to Leads</a>');

    /* Toggling touches only this screen. The run keeps its phase, its
       transcript and any open pause -- opening the script is not an event
       in the rehearsal. */
    var rs = document.querySelector('.lpc-rail-script');
    if (rs) rs.addEventListener('toggle', function () { state.railScriptOpen = rs.open; });

    var end = document.getElementById('lpcEnd');
    if (end) end.addEventListener('click', stop);
    var mute = document.getElementById('lpcMute');
    if (mute) {
      mute.addEventListener('click', function () {
        state.muted = !state.muted;
        /* The track, not the UI, is the real mute — this just tells the
           founder's own hardware to stop sending. See li-assembly.js's
           applyCapture(): a manual mute holds even through the turn engine's
           own automatic unmute at the next founder turn. */
        if (window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.setUserMute) {
          window.VISION_ASSEMBLY.setUserMute(state.muted);
        }
        render();
      });
    }
    var spk = document.getElementById('lpcSpeaker');
    if (spk) {
      spk.addEventListener('click', function () {
        state.speakerOn = !state.speakerOn;
        if (window.VISION_PRACTICE && window.VISION_PRACTICE.setSpeakerMuted) {
          window.VISION_PRACTICE.setSpeakerMuted(!state.speakerOn);
        }
        render();
      });
    }
    var rt = document.getElementById('lpcRetry');
    if (rt) rt.addEventListener('click', function () { window.VISION_PRACTICE.retry(); });
    var again = document.getElementById('lpcRestart');
    if (again) {
      again.addEventListener('click', function () {
        /* Back to setup rather than a silent re-arm: whatever stopped the
           audio may need the founder to change something first. */
        if (window.VISION_PRACTICE) window.VISION_PRACTICE.stop();
        state.stage = 'setup'; state.started = false; state.ended = false;
        state.live = null; state.notice = null;
        if (timer) { clearInterval(timer); timer = null; }
        render();
      });
    }
    var again = document.getElementById('lpcAgain');
    if (again) again.addEventListener('click', function () { state.stage = 'setup'; state.ended = false; render(); });
    /* Same action as #lpcAgain (the header link) — the call is already
       stopped by the time either button can show, so neither needs to call
       stop() again. Two buttons, one behaviour: a quiet header link and a
       real CTA where the founder is actually looking, on the ended screen
       itself. */
    var againInline = document.getElementById('lpcAgainInline');
    if (againInline) {
      againInline.addEventListener('click', function () { state.stage = 'setup'; state.ended = false; render(); });
    }
    var t = document.getElementById('lpcTranscript');
    if (t && state.pinned) t.scrollTop = t.scrollHeight;
    if (t) {
      t.addEventListener('scroll', function () {
        state.pinned = t.scrollHeight - t.scrollTop - t.clientHeight < 24;
      });
    }
    startOrbReactivity(now);
  }

  function render() {
    if (state.stage === 'setup') renderSetup(); else renderLive();
  }

  /* ══ ACTIONS ═══════════════════════════════════════════════════════ */

  function toggleAdapted() {
    var K = kit();
    if (!K || !state.profile) return;
    if (state.showingAdapted) { state.showingAdapted = false; state.adaptNote = null; render(); return; }
    var s = scriptOf();
    var strategy = {
      opening: s.opening, firstQuestion: s.firstQuestion,
      discovery: s.discovery || [], close: s.close,
    };
    var out = K.adaptScript(strategy, state.profile);
    /* THE GATE, NOT A FORMALITY. If the reword cannot be proved to have
       changed only wording, the founder keeps VISION's version. */
    var check = K.verifyAdaptation({ strategy: strategy, neutral: out.neutral, adapted: out.adapted, facts: [] });
    if (check && check.valid === false) {
      state.adapted = null; state.showingAdapted = false;
      state.adaptNote = 'VISION could not reword that without changing what it means, so it kept its own version.';
    } else if (!changedAnything(out.neutral, out.adapted)) {
      /* A BUTTON THAT APPEARS TO DO NOTHING IS WORSE THAN NO BUTTON.
         The adapter only rewrites what needs rewriting, so a script that is
         already plain and already sounds like this founder comes back
         identical. Saying so is the honest outcome; silently flipping into
         an identical "adapted" view makes VISION look broken. */
      state.adapted = null; state.showingAdapted = false;
      state.adaptNote = 'This already reads the way you talk — VISION found nothing worth changing.';
    } else {
      state.adapted = out.adapted;
      state.showingAdapted = true;
      state.adaptNote = 'Same approach, your phrasing.';
    }
    render();
  }

  function changedAnything(neutral, adapted) {
    var keys = ['opening', 'firstQuestion', 'close'];
    for (var i = 0; i < keys.length; i += 1) {
      if ((neutral[keys[i]] || '') !== (adapted[keys[i]] || '')) return true;
    }
    var a = neutral.discovery || [], b = adapted.discovery || [];
    for (var j = 0; j < a.length; j += 1) if (a[j] !== b[j]) return true;
    return false;
  }

  /* Recorded immediately, so the answer survives a reload and the founder is
     never asked twice. */
  function setRecording(next) {
    state.recording = next;
    state.recordingWhy = false;
    render();
    if (V && V.sb) {
      /* .then() IS NOT OPTIONAL. A supabase-js builder is lazy: without it
         the request is never sent, the answer is never stored, and the
         founder is asked again next time — which is exactly what happened. */
      try {
        V.sb.rpc('practice_recording_preference_set_v1', { p_state: next, p_consent_version: 1 })
          .then(function () {}, function () {});
      } catch (e) { /* the choice still holds for this session */ }
    }
  }

  async function start() {
    /* ONE SESSION PER PRESS. The consent read below is awaited, which opens a
       window in which a second click would start a second call. */
    if (state.starting) return;
    state.starting = true;
    try { await beginPractice(); } finally { state.starting = false; }
  }

  async function beginPractice() {
    /* THE ANSWER MUST BE KNOWN BEFORE THE MICROPHONE OPENS. The consent read
       is asynchronous and Start is live as soon as the screen paints, so a
       founder who pressed it quickly began a call with recording still
       unknown -- and silently got no recording despite having allowed it.
       Resolved here means resolved: allowed, declined, not_asked, or the
       fail-closed fallback. Never null. */
    if (state.recording === null) {
      state.arming = true;
      render();
      state.recording = await readRecordingPreference();
      state.arming = false;
      render();
    }
    if (!window.VISION_PRACTICE) {
      state.notice = 'Practice is not available in this build.';
      render();
      return;
    }
    state.stage = 'live';
    state.started = true;
    state.ended = false;
    state.notice = null;
    state.pinned = true;
    state.startedAt = Date.now();
    /* Every call starts unmuted with the speaker on, matching the fresh
       session li-assembly.js/li-practice-runner.js are about to create —
       a mute from a previous rehearsal (Practise again) must never carry
       into this one. */
    state.muted = false;
    state.speakerOn = true;
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      var c = document.getElementById('lpcClock');
      if (c) c.textContent = clock();
    }, 1000);
    /* SITUATION RIDES ON THE HANDOFF, not as a sibling param -- every
       server action (practice_prospect, the guided actions, the rail) already
       reads the raw handoff untouched, so folding it in here is what makes
       the whole call, including recovery/retry paths, see the same
       situation without six separate call sites each needing their own
       wiring. Set once, before the call starts; never rewritten mid-call. */
    if (state.session && state.session.handoff) {
      /* The literal string, unchanged -- 'vision_adaptive' is what tells
         createProspectState to actually DERIVE a situation. Converting it
         to null here would silently disable the feature for the default,
         recommended choice: null means "no situation was ever requested"
         to the backward-compatibility gate, not "resolve one adaptively". */
      state.session.handoff = Object.assign({}, state.session.handoff,
        { situation: state.situation, situationSeed: seed(),
          /* The dials ride the handoff for the same reason the situation
             does: every server action already reads the raw handoff, so one
             assignment here reaches the behaviour engine, the scenario draw,
             the reaction policy and the disclosure ledger without six
             separate call sites. Set once, before the call starts. */
          difficulty: state.difficulty, pressure: state.pressure });
    }
    render();
    window.VISION_PRACTICE.start({
      handoff: state.session.handoff,
      mode: state.mode,
      format: state.format,
      assemblyTurnMode: assemblyTurnModeFromUrl(),
      focus: state.focus,
      /* Which prospect this rehearsal was against, and which profile shaped
         the wording — both references, never copies. */
      prospectRef: state.session.opportunityId || state.handle || null,
      /* Only ever true when the founder said so. */
      recordAudio: state.recording === 'allowed',
      profileVersion: (state.profile && state.profile.version) || null,
      isTest: isTestRun(),
      onChange: function (snap) {
        state.live = snap;
        /* THE PROSPECT ENDING THE CALL NEVER OPENED A REVIEW. `stop()`
           below -- the founder clicking End Practice -- is the only thing
           that ever calls openReviewWhenReady(). A hangup ends the call
           through the RUNNER's own api.stop() (a same-named but separate
           function, called from inside li-practice-runner.js the moment it
           reads state.ended), which finishes and scores the session
           server-side correctly -- but nothing on this side ever learns to
           go look for that score. The founder was left on CALL ENDED
           permanently, for the single most common way a real rehearsal
           actually ends. Found live, on staging: scoring reached `ready` at
           51.7s and the screen never moved.

           Started exactly once, on the transition into ended -- not on
           every snapshot, and not when the founder's own stop() has
           already started it. */
        if (snap && snap.phase === 'ended' && !state.reviewState) openReviewWhenReady();
        render();
      },
    });
  }

  /* An automated acceptance run marks its own rows so it can delete them.
     A founder can never set this: it comes from the URL the harness opens. */
  function isTestRun() {
    try { return new URLSearchParams(location.search).get('qa-practice') === '1'; } catch (e) { return false; }
  }

  /* SCORE READY -> REVIEW. The founder does not go back to setup and does
     not have to find their own result; the call hands them straight to it,
     at a URL that survives a reload. */
  /* Long enough for a real recording to finish uploading on a normal
     connection, rather than long enough for a fast one. */
  var AUDIO_GRACE_MS = 45000;
  var MAX_TRIES = 300;               /* 300 x 300 ms = 90 s */
  var clockOf = function (secs) {
    var t = Math.max(0, secs | 0);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  };

  function openReviewWhenReady() {
    var tries = 0;
    var scoreReadyAt = 0;
    state.reviewState = 'preparing';
    state.reviewStartedAt = Date.now();
    /* The clock has to move on its own: the poll below only re-renders when
       something changes, and for most of this wait nothing does. */
    if (scoreTick) clearInterval(scoreTick);
    scoreTick = setInterval(function () {
      if (state.reviewState !== 'preparing') { clearInterval(scoreTick); scoreTick = null; return; }
      render();
    }, 1000);
    render();
    var poll = setInterval(function () {
      tries += 1;
      var s = window.VISION_PRACTICE && window.VISION_PRACTICE.scoring
        ? window.VISION_PRACTICE.scoring() : null;
      var id = window.VISION_PRACTICE && window.VISION_PRACTICE.sessionId
        ? window.VISION_PRACTICE.sessionId() : null;
      /* THE UPLOAD MUST LAND FIRST. Navigating the moment scoring finished
         killed the recording mid-flight, and the founder arrived at a review
         with no audio they had explicitly agreed to save. */
      var a = window.VISION_PRACTICE && window.VISION_PRACTICE.audioState
        ? window.VISION_PRACTICE.audioState() : 'not_recorded';
      var audioSettled = ['stored', 'failed', 'not_recorded', 'declined'].indexOf(a) > -1;
      /* ── THE UPLOAD MUST NOT COST THEM THE REVIEW ──────────────────────
         Waiting for the recording is right — navigating early killed it
         mid-flight. Waiting FOREVER for it is not: on two real 150 s
         rehearsals the score was ready and the upload was still going at the
         27 s ceiling, so the poll gave up and the founder got no review at
         all. A review whose audio is still arriving is a review; the screen
         already says honestly when a recording is not there. So the audio
         gets a generous window of its own, and then the score wins. */
      if (s && s.state === 'ready' && id && !scoreReadyAt) scoreReadyAt = Date.now();
      var audioOvertime = scoreReadyAt && (Date.now() - scoreReadyAt) > AUDIO_GRACE_MS;
      if (s && s.state === 'ready' && id && (audioSettled || audioOvertime)) {
        clearInterval(poll);
        if (scoreTick) { clearInterval(scoreTick); scoreTick = null; }
        location.href = 'live-intelligence.html?review=' + encodeURIComponent(id);
      } else if (tries > MAX_TRIES || (s && s.state === 'failed')) {
        /* NOT A SILENT DEAD END. This branch used to clear the timer and
           nothing else, so a founder whose scoring failed — or whose audio
           upload simply outlasted the 27 s poll — sat on "PRACTICE ENDED,
           the conversation is below" forever, with no score, no review, and
           no way to reach one. Observed on canonical staging after a full
           215 s rehearsal. The session exists and the review screen requests
           its own score, so the link is real work, not a consolation. */
        clearInterval(poll);
        if (scoreTick) { clearInterval(scoreTick); scoreTick = null; }
        state.reviewState = id ? 'stalled' : 'no_session';
        state.reviewSessionId = id || null;
        render();
      }
    }, 300);
  }

  function stop() {
    if (window.VISION_PRACTICE) window.VISION_PRACTICE.stop();
    if (timer) { clearInterval(timer); timer = null; }
    state.ended = true;
    render();
    /* So "Practise this weakness" can come back to the same prospect. */
    try { if (state.handle) sessionStorage.setItem('vision_practice_last_handle', state.handle); } catch (e) {}
    openReviewWhenReady();
  }

  /* ══ BOOT ══════════════════════════════════════════════════════════ */

  function gate(message) {
    shell('<div class="lpc-gate"><p class="lpc-lab">Practice</p>'
      + '<p class="lpc-gate-msg">' + esc(message) + '</p>'
      + '<a class="lpc-back" href="leads.html">Back to Leads</a></div>');
  }

  async function readRecordingPreference() {
    if (!V || !V.sb) return 'error_fallback';
    try {
      var res = await V.sb.rpc('practice_recording_preference_read_v1');
      if (res && res.error) return 'error_fallback';
      var d = res && res.data;
      return (d && d.state) || 'not_asked';
    } catch (e) {
      /* FAIL CLOSED FOR AUDIO, OPEN FOR PRACTICE. The rehearsal is the
         product; the recording is a bonus. Never imply it was saved. */
      return 'error_fallback';
    }
  }

  async function loadProfile() {
    if (!V || !V.sb) return null;
    try {
      var res = await V.sb.rpc('founder_communication_profile_read_v1');
      var d = res && res.data;
      if (!d || d.status !== 'ready') return null;
      return d.current || d.baseline || null;
    } catch (e) { return null; }
  }

  async function boot() {
    state.handle = handleFromUrl();
    if (!state.handle) return;
    state.session = readSession(state.handle);
    if (!state.session || !state.session.handoff) {
      gate('That practice session has expired. Open the prospect in Leads and start it again.');
      return;
    }
    if (!V.backend) {
      gate('Practice needs the backend, and it is not reachable.');
      return;
    }
    if (V.auth && V.auth.requireAuth) {
      var s = await V.auth.requireAuth();
      if (!s) return;
    }
    var K = kit();
    if (K) state.mode = K.DEFAULT_MODE;
    state.focus = focusFromUrl();
    /* Arriving to practise a weakness means Guided, by definition. */
    if (state.focus) state.format = 'guided';
    render();                       /* paint immediately; the rest is extra */
    var pref = await readRecordingPreference();
    state.recording = pref;
    state.profile = await loadProfile();
    if (state.stage === 'setup') render();
  }

  /* For the state harness: render a real snapshot without audio. */
  window.VISION_PRACTICE_UI = {
    render: function (snapshot, session, opts) {
      /* A NEW SESSION MEANS A NEW SCRIPT, so any rewording of the previous
         prospect's approach is meaningless and must not survive into it. */
      if (session && session !== state.session) {
        state.session = session;
        state.adapted = null; state.showingAdapted = false; state.adaptNote = null;
      }
      /* DELIBERATELY NOT HONOURED. A caller could once hand Practice a
         temperament ('resistant', 'receptive') through this option and the
         setup screen would run it. The picker is gone, so accepting the
         parameter would leave the removed control alive as a back door --
         a stale link or a cached bundle could still choose the prospect.
         Practice is VISION Realistic, always; difficulty and pressure are
         the only things a caller may vary, and they arrive on the handoff. */
      if (opts && opts.format) state.format = opts.format;
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'profile')) state.profile = opts.profile;
      if (opts && opts.recording) state.recording = opts.recording;
      if (opts && opts.stage) { state.stage = opts.stage; }
      else { state.stage = 'live'; }
      state.live = snapshot;
      state.started = true;
      state.ended = !!(snapshot && snapshot.phase === 'ended');
      /* The post-call wait is driven by the poll, not by a snapshot phase, so
         the harness sets it explicitly. Cleared unless asked for, so one
         render can never leak the previous one's state. */
      state.reviewState = (opts && opts.reviewState) || null;
      state.reviewSessionId = (opts && opts.reviewSessionId) || null;
      /* So the harness can render the scoring wait at a chosen elapsed time
         without sitting through it. */
      state.reviewStartedAt = (opts && typeof opts.waitedMs === 'number')
        ? Date.now() - opts.waitedMs : 0;
      if (!state.startedAt) state.startedAt = Date.now();
      render();
    },
    state: state,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})(window.VISION);
