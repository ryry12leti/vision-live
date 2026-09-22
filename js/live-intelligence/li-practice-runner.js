/* ════════════════════════════════════════════════════════════════════════
   PRACTICE CALL — the turn loop.

   The founder speaks, VISION answers out loud, the founder speaks again.
   Everything that decides what the prospect says happened before this file
   ran; this only sequences the conversation and keeps the two voices from
   colliding.

   ONE FOUNDER TURN PRODUCES AT MOST ONE OF EVERYTHING. The transcript is
   read by item id and each id is consumed once, so a repeated event, a
   re-render or a reconnect cannot buy a second Terra call, a second TTS
   charge, or a second playback.
   ══════════════════════════════════════════════════════════════════════ */
(function (V) {
  'use strict';

  /* ── WHAT THE REHEARSAL LEAVES BEHIND ────────────────────────────────
     Every write here is FIRE AND FORGET. Persistence must never sit between
     the founder finishing a sentence and the prospect answering it, so
     nothing in the conversation path awaits a row. A dropped write costs one
     record; an awaited one would cost the rehearsal its pace. */
  var EV = null, BRAIN = null, COACH = null;
  /* Guided Live Reaction Intelligence, loaded the same lazy way as the rest
     of the frozen engine. Declared with the block above so the fetch starts
     at the same time as everything else this runner needs. */
  import('../goal-engine/practice/practice-evidence.js').then(function (m) { EV = m; });
  /* The SAME frozen engine the server runs, used here only to decide whether
     to stop the call before the prospect reacts. It changes nothing: the
     authoritative turn still goes through practice_prospect, from the same
     state, so the two can never disagree. */
  import('../goal-engine/practice/prospect-behaviour.js').then(function (m) { BRAIN = m; });
  import('../goal-engine/practice/guided-coaching.js').then(function (m) { COACH = m; });
  var REACT = null;
  import('../goal-engine/practice/guided-reaction.js').then(function (m) { REACT = m; });
  /* WP4 BOUNDARY B. Same lazy-load pattern, same reason: the transcript
     reader coaching-rail.js already uses, loaded here too so Guided's
     authority/routing copy can be the SAME validated evidence rather than
     a second read of the same words. */
  var EG = null;
  import('../goal-engine/practice/evidence-gates.js').then(function (m) { EG = m; });
  /* Where one founder thought is put back together out of the fragments
     the transcriber finalises on its own clock. */
  var TA = null;
  var TIMING = null;
  var RAIL = null;
  import('../goal-engine/practice/turn-assembly.js').then(function (m) { TA = m; });
  /* Observation only -- see fragment-arrivals.js. Loaded the same way TA is,
     and every read of it is null-guarded, so a slow import costs a
     measurement and never a turn. */
  var FA = null;
  import('../goal-engine/practice/fragment-arrivals.js').then(function (m) { FA = m; });
  import('../goal-engine/practice/response-timing.js').then(function (m) { TIMING = m; });
  import('../goal-engine/practice/coaching-rail.js').then(function (m) { RAIL = m; });
  /* Six facts about what is actually happening. Records; never scores. */
  var CS = null;
  import('../goal-engine/practice/call-state.js').then(function (m) { CS = m; });
  /* The deterministic interpretation layer: what objectively happened,
     with citations, and nothing about points. */
  var RE = null, RR = null, AK = null, CE = null;
  import('../goal-engine/practice/rule-engine.js').then(function (m) { RE = m; });
  import('../goal-engine/practice/reaction-reader.js').then(function (m) { RR = m; });
  import('../goal-engine/practice/answer-key.js').then(function (m) { AK = m; });
  import('../goal-engine/practice/candidate-events.js').then(function (m) { CE = m; });

  function rpc(name, args) {
    try {
      if (!V || !V.sb) return Promise.resolve(null);
      return V.sb.rpc(name, args).then(function (r) { return r && r.data; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  var api = {};
  window.VISION_PRACTICE = api;

  /* ── WP3 ────────────────────────────────────────────────────────────────
     The version of the sequencing contract THIS bundle speaks. Sent
     explicitly, because the server cannot tell an old tab from a new one any
     other way: `turnId` has always been on the wire, so inferring support
     from it would pin every stale tab as `reserved` and then reject that
     tab's own legitimate writes. A bundle that predates WP3 sends nothing,
     its session pins `legacy`, and it behaves exactly as it always did. */
  var SEQUENCING_PROTOCOL = 2;

  var run = null;

  function fresh(opts) {
    return {
      handoff: opts.handoff, mode: opts.mode || 'vision_realistic',
      startedAt: Date.now(), sessionId: null, seq: 0, isTest: !!opts.isTest,
      /* Decided by the SERVER at the first interaction, never assumed here.
         P5R-7.4: the fallback is `reserved`, not `legacy`. The server can no
         longer CREATE anything else -- practice_session_start_v1 pins
         reserved and lock_and_mode ignores the protocol argument -- so a
         missing field means "the response did not say", and guessing legacy
         would make this bundle stop sending `p_turn_id` on a session the
         server considers reserved, failing every append with
         `turn_id_required_in_reserved_session`. A session genuinely pinned
         legacy still reports it and is still honoured; only the guess moved. */
      sequencingMode: 'reserved',
      prospectRef: opts.prospectRef || null, profileVersion: opts.profileVersion || null,
      prevEvidence: { pitchPermission: false, activeObjection: null, state: null },
      format: opts.format === 'full_simulation' ? 'full_simulation' : 'guided',
      focus: opts.focus || null,
      recordAudio: opts.recordAudio === true, streamStartedAt: null, audioState: 'not_recorded',
      /* PHOENIX A/B #2, opt-in only. Fails closed to null (-> condition A,
         AssemblyAI's own default) on anything but the one tested value. */
      assemblyTurnMode: (opts.assemblyTurnMode === 'min_latency') ? 'min_latency' : null,
      coach: null, detected: [], disclosed: [],
      state: null, history: [], simulated: [],
      handled: {},            /* founder item ids already turned into a turn */
      seenAtById: {},         /* when each fragment first reached us */
      /* ── THE LOST WAKEUP ────────────────────────────────────────────
         pump() returns immediately while a turn is in flight. A fragment
         that finalises during that window used to depend on some LATER
         event to bring pump() back -- and when the founder had finished
         speaking there was no later event, so the turn sat until something
         unrelated happened. Measured on Ryan's first real call: 9.9 s
         between the provider delivering a finalised turn and the runner
         first seeing it, three times, on exactly the long questions.
         `pumpPending` makes the wakeup owed rather than hoped for: every
         non-terminal exit from busy consults it, so no finalised fragment
         can be stranded by arriving at the wrong moment. */
      pumpPending: false,
      pumpObs: {},            /* per-fragment: when we tried, when we were blocked */
      decisions: [],          /* chronological release decisions for THIS turn */
      carryReason: null,      /* why a turn was carried, or why it was not */
      settleTimer: null,      /* the wait for the rest of a sentence */
      pendingAssembly: null,  /* evidence quality of the turn being taken */
      carried: null,          /* an unfinished thought, waiting for its end */
      carriedPartIds: null,   /* the fragment ids that text came from */
      carriedTimer: null, carriedFlush: false,
      callState: null,        /* the six facts, advanced only by grounded turns */
      groundedTurns: [],      /* what Pass 3 interprets: assembled turns only */
      stateBySeq: {},         /* the state as it stood BEFORE each turn */
      candidateEvents: [],    /* everything observed so far, deduped */
      writtenEventIds: {},    /* so a re-read never writes a row twice */
      heldForSettle: 0,       /* observability: how often we waited */
      busy: false, phase: 'idle', audioError: null, notice: null,
      audioStarted: false,     /* has the transcriber ever come up? */
      speechText: null,        /* newest open utterance, as last seen */
      speechChangedAt: 0,      /* when that text last actually grew   */
      heldForSpeech: 0,        /* observability: holds for live speech */
      heldForCut: 0,           /* observability: holds for a ceiling cut */
      turns: [], errors: [], spoken: {},   /* turn ids already voiced */
      lastGuidedReaction: null,  /* most recent Guided-only live signal, or none yet */
      /* WHAT THE RAIL HAS ALREADY SAID, AND FOR HOW LONG. Declared here with
         everything else that lives for exactly one call, so its lifetime is
         visible rather than implied by the first assignment. A memory that
         survived into the NEXT call would open with a move it had already
         abandoned against a different prospect. */
      railMemory: null,
      lastFounderAction: null,   /* the classifier's label for his last turn */
      relevance: null,           /* what his last reply meant against the offer */
      voice: null, speechLog: [],
      onChange: opts.onChange || function () {},
      audioEl: null,
      speakerMuted: false,   /* the founder's Speaker toggle, fresh per call */
    };
  }

  var emit = function () { try { run.onChange(api.snapshot()); } catch (e) {} };

  /* ── THE LAST LINE OF DEFENSE ─────────────────────────────────────────
     Every risky step inside takeTurn() already guards itself individually
     -- refreshRail, advanceState, interpret and persistTurn each have
     their own try/catch -- but the turn pipeline is not wrapped end to
     end, and one unguarded line elsewhere in it (a server response
     shaped slightly differently than expected, say) can still throw
     between the microphone being muted for VISION's turn and the point
     that would normally re-enable it. Demonstrated directly during the
     Practice torture audit: a malformed simulatedFacts value did exactly
     this and left capture off with nothing watching -- fixed at its own
     call site, but that fix only closes the one instance found today.
     This is the backstop for the next one: it recovers the microphone
     and lets the founder keep going, the same recovery takeTurn() already
     gives an ordinary failed network call, never more than that -- it
     does not end the call, does not hide anything, and does nothing at
     all when no call is running. */
  function recoverFromUncaughtError() {
    if (!run || run.phase === 'idle' || run.phase === 'ended') return;
    /* ── WP5: A HANGUP IS NOT SOMETHING TO RECOVER FROM ───────────────
       `phase` alone was not enough. Between the moment the engine's ended
       state arrives and the moment api.stop() runs, the phase is
       'prospect_speaking' for the whole of the final line -- and any page
       error in that window used to re-arm the microphone and tell the
       founder it was their turn, on a call that was already over. The
       terminal state is the honest test; the phase is just where we are in
       delivering it. */
    if (run.state && run.state.ended) return;
    run.errors.push('uncaught_error');
    run.notice = 'That last line did not reach them — VISION is listening again, keep going.';
    run.phase = 'founder_speaking';
    if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.setCapture(true);
    emit();
  }
  window.addEventListener('error', recoverFromUncaughtError);
  window.addEventListener('unhandledrejection', recoverFromUncaughtError);

  api.snapshot = function () {
    if (!run) return { phase: 'idle', turns: [] };
    return {
      phase: run.phase, mode: run.mode, format: run.format,
      /* GUARDED AGAIN, AT THE EXIT. run.lastGuidedReaction is only ever
         written when format was 'guided' at the time of that turn (the
         module itself refuses any other value), but format can change
         between turns if a caller reused a runner across formats -- so the
         snapshot re-checks rather than trusting the stored value's
         provenance. A strict mode reading this field sees null even if an
         earlier guided turn in the same run object left one behind. */
      guidedReaction: run.format === 'guided' ? (run.lastGuidedReaction || null) : null,
      coaching: (run.coach && run.coach.active) ? {
        reason: run.coach.active.reason, attempt: run.coach.active.attempt,
        note: run.coach.active.note,
        /* Deterministic copy and the locked move, straight from the server.
           Nothing here is composed by a model. */
        whatHappened: run.coach.active.whatHappened,
        whyItHurt: run.coach.active.whyItHurt,
        bestMove: run.coach.active.bestMove
          ? run.coach.active.bestMove.goal : null,
        /* Absent until the founder has had an unaided go. */
        wtsi: run.coach.active.wtsi || null,
      } : null,
      correctedNote: run.correctedNote || null,
      endedByProspect: run.endedByProspect || null,
      trainingFocus: run.trainingFocus || null,
      /* THE ONE FACT THE SURFACE READS. Computed by liveAssistanceAllowed()
         and carried here so the renderer never re-derives it from format and
         phase on its own -- two readings of one rule is the drift this
         replaces. */
      liveAssistance: liveAssistanceAllowed(),
      /* Absent while a pause is open: the rail becomes the pause. */
      rail: (run.coach && run.coach.active) ? null : (run.rail || null),
      interventions: run.coach ? run.coach.history.slice() : [],
      detected: run.detected.slice(),
      turns: run.turns.slice(),
      history: run.history.slice(),
      state: run.state,
      errors: run.errors.slice(),
      audioError: run.audioError || null,
      notice: run.notice || null,
      heldForSettle: run.heldForSettle, heldForSpeech: run.heldForSpeech,
      heldForCut: run.heldForCut,
      capturing: window.VISION_ASSEMBLY ? window.VISION_ASSEMBLY.capturing() : false,
      voice: run.voice ? { name: run.voice.name, lang: run.voice.lang, local: run.voice.localService } : null,
      speechLog: run.speechLog.slice(),
      speechSupported: typeof window !== 'undefined' && !!window.speechSynthesis,
    };
  };

  /* Is the transcriber actually up? `listening` is the only state in which
     audio is reaching a provider; `connecting` still might. Anything else —
     idle, failed, stopped — means nothing the founder says is being heard. */
  function audioLive() {
    try {
      var s = window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.snapshot();
      return !!s && (s.state === 'listening' || s.state === 'connecting');
    } catch (e) { return false; }
  }
  /* Founder-facing words. The provider's own message is never shown: it can
     quote the request, and "assemblyai_disabled" means nothing to a founder
     about to make a sales call. */
  function audioFailure() {
    var s = null;
    try { s = window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.snapshot(); } catch (e) { s = null; }
    var raw = (s && s.error) || '';
    if (/microphone/i.test(raw)) {
      return 'VISION could not open your microphone. Check the browser\u2019s microphone permission for this site, then start the call again.';
    }
    return 'VISION could not start listening, so nothing you say would be heard. Practice needs live transcription, and it is not available right now.';
  }
  /* ── IS THE FOUNDER STILL TALKING RIGHT NOW ──────────────────────────
     NOT `end_of_turn === false`. Measured on canonical staging: AssemblyAI
     leaves its last utterance open indefinitely, so that flag reads "still
     speaking" through fourteen seconds of silence and is worth nothing.

     What IS reliable is that the open utterance's PARTIAL TEXT GROWS while
     the founder speaks and stops growing the moment they stop — observed
     going "I" → "I noticed you advertised 2 reconciliations assistant roles
     …" over nine seconds, then frozen. So this tracks growth, not the flag. */
  var SPEECH_IDLE_MS = 1500;
  /* How long a carried fragment waits for the rest of the sentence before it
     is sent anyway. Long enough to finish a thought, short enough that
     trailing off does not stall the call. */
  var CARRY_FLUSH_MS = 2500;
  /* Terra answers in ~2.3 s and the server's own budget is far inside this.
     Generous on purpose: this is the dead-line detector, not a latency SLA. */
  var TURN_TIMEOUT_MS = 25000;
  /* WP8: the semantic read is enrichment running beside the prospect's own
     voice, so its ceiling is the useful window rather than the turn's. Set
     above the adapter's own 6s abort so the server's answer -- including a
     cheap refusal like `shed` or a cached hit -- normally arrives first,
     and comfortably inside typical playback (speech p50 ~3.5s). Missing it
     costs one turn's enrichment and nothing else. */
  var SEMANTIC_TIMEOUT_MS = 8000;
  /* ── DOES THE PROVIDER STILL OWE US SPEECH? ────────────────────────────
     The explicit continuation signal a cut classifier needs. AssemblyAI only
     turns a message into a segment once `end_of_turn === true`, so anything
     still open is transcript the provider has NOT yet committed. A genuine
     mid-sentence cut leaves its second half sitting there open; a founder who
     simply finished leaves nothing.

     Compared BY TURN ORDER, not by presence. Every Turn message is pushed, so
     an utterance appears in the array twice -- once open, once finalised --
     and its stale open copy never disappears. Reading presence alone would
     report a continuation forever and hold every long turn for the full cut
     window, which is the defect this exists to remove. An open order at or
     below the newest finalised one has already been superseded. */
  function continuationPending() {
    try {
      var s = window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.snapshot();
      /* NOT `|| []`. An absent turn list means we cannot see the provider,
         and an empty list means the provider owes nothing -- opposite
         answers. Collapsing them would fail OPEN exactly where the catch
         below fails closed, and a genuine cut would release early. */
      if (!s || !Array.isArray(s.turns)) return undefined;
      var turns = s.turns;
      var newestFinal = -1;
      var i, t;
      for (i = 0; i < turns.length; i++) {
        t = turns[i];
        if (t && t.endOfTurn === true && typeof t.order === 'number' && t.order > newestFinal) {
          newestFinal = t.order;
        }
      }
      for (i = 0; i < turns.length; i++) {
        t = turns[i];
        if (t && t.endOfTurn !== true && typeof t.order === 'number'
          && t.order > newestFinal && String(t.transcript || '').trim()) return true;
      }
      return false;
    } catch (e) {
      /* Cannot see the provider: say nothing rather than assert "finished".
         decideRelease() falls back to the old duration-only behaviour. */
      return undefined;
    }
  }

  /* Bounded: a turn held at 250 ms could otherwise accumulate 120 records
     across MAX_HOLD_MS. The first and last decisions are what identify a
     hold, so the middle is what gets dropped when the cap is reached. */
  var MAX_DECISIONS = 24;
  function recordDecision(d) {
    if (!run) return;
    if (!run.decisions) run.decisions = [];
    if (run.decisions.length >= MAX_DECISIONS) {
      run.decisions.splice(1, 1);
      run.decisionsDropped = (run.decisionsDropped || 0) + 1;
    }
    run.decisions.push(d);
  }

  function trackSpeech() {
    if (!run) return;
    var open = null;
    try {
      var s = window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.snapshot();
      var rows = (s && s.turns) || [];
      for (var i = rows.length - 1; i >= 0; i--) {
        if (rows[i] && rows[i].endOfTurn !== true && String(rows[i].transcript || '').trim()) {
          open = String(rows[i].transcript).trim();
          break;
        }
      }
    } catch (e) { open = null; }
    if (open !== null && open !== run.speechText) {
      run.speechText = open;
      run.speechChangedAt = Date.now();
    }
  }
  function stillSpeaking() {
    if (!run || !run.speechChangedAt) return false;
    return (Date.now() - run.speechChangedAt) < SPEECH_IDLE_MS;
  }
  /* WHEN THEY STOPPED. The wait for a cut fragment's second half is a
     delivery wait, and delivery only starts once the words exist. Timing it
     from the first fragment's arrival charges the wait for however long the
     founder kept talking, which is exactly backwards. */
  function quietSince() {
    if (!run || !run.speechChangedAt) return null;
    if (stillSpeaking()) return null;
    return run.speechChangedAt + SPEECH_IDLE_MS;
  }

  /* THE SOCKET CAN ALSO DIE MID-CALL. Same rule, same words: the moment the
     transcriber stops listening the founder stops being told it is their
     turn. Latched, so a normal stop() at the end of the call cannot reopen
     the notice.

     NOT DURING THE HANDSHAKE. `requesting_mic` and the moment before the
     socket opens are both legitimately not-listening, and latching there
     reported a dead microphone on every healthy call. */
  function watchAudio() {
    if (!run || !run.audioStarted) return;
    if (run.phase === 'ended' || run.phase === 'audio_failed') return;
    if (audioLive()) return;
    run.phase = 'audio_failed';
    run.audioError = audioFailure();
    run.errors.push('audio_lost');
  }

  api.start = async function (opts) {
    run = fresh(opts || {});
    run.phase = 'connecting';
    if (COACH) run.coach = COACH.createCoachState();
    if (CS) run.callState = CS.initialCallState(run.handoff || {});
    emit();
    /* Opened alongside the microphone, not before it: a rehearsal the founder
       never actually started should not leave a record. */
    var h = run.handoff || {};
    rpc('practice_session_start_v1', {
      p_prospect_name: (h.prospect && h.prospect.name) || 'Practice prospect',
      p_mode: run.mode, p_prospect_ref: run.prospectRef,
      p_script_ref: h.script ? { opening: !!h.script.opening, firstQuestion: !!h.script.firstQuestion,
        discovery: (h.script.discovery || []).length, pitchBridge: !!h.script.pitchBridge,
        close: !!h.script.close } : null,
      p_profile_version: run.profileVersion, p_is_test: run.isTest,
      /* WHICH FORMAT THIS ACTUALLY WAS. The column has always been NOT NULL
         with a 'full_simulation' default and nothing ever sent it, so every
         Guided session on record claims to have been unassisted -- durable
         provenance that was not missing but false. run.format is already
         pinned above from the founder's own choice; this is the one place
         that knows it at the moment the row is created. */
      p_format: run.format,
    }).then(function (d) { if (d && d.session_id) run.sessionId = d.session_id; });
    await window.VISION_ASSEMBLY.start({
      handoff: null,     /* practice never feeds call_assist */
      /* emit() as well as pump(): the surface distinguishes YOUR TURN from
         LISTENING by whether an utterance is still open, and that only
         changes on partial transcript events which pump() ignores. Without
         this the founder never sees VISION react to them speaking. */
      onChange: function () { trackSpeech(); watchAudio(); emit(); run && (run.onChangeAt = Date.now()); requestPump(); },
      /* SHIPPED, NOT AN EXPERIMENT ANYMORE. The PHOENIX A/B on 10 real
         spoken calls: provider-finalisation p50 1761ms -> 551ms, total
         release p50 2371ms -> 1155ms, zero transcript-quality regression,
         zero premature releases, and diarisation's speaker/role output
         confirmed unread downstream -- Practice mutes the founder's own
         mic while the synthesised prospect "speaks", so AssemblyAI never
         receives a second voice to separate on this call type at all.
         Unconditional: no flag, no URL param, nothing left to opt into.
         li-assembly.js's own gate is what keeps Live Call Intelligence
         provably untouched -- it never passes this and never will. */
      diarizationDisabled: true,
      assemblyTurnMode: run.assemblyTurnMode,
    });
    /* ── SOMEBODY ANSWERS THE PHONE ────────────────────────────────────
       Ahead of the microphone gate below, deliberately: the prospect
       picking up is not conditional on the FOUNDER's microphone working.
       On a real call you hear them say hello whether or not your own mic
       is live, and a founder whose audio failed otherwise learns nothing
       about whether the call connected at all -- they get a dead screen.
       This way the transcript shows someone answered and the gate below
       still says, separately and truthfully, that VISION cannot hear them.

       Awaited, unlike the writes in the conversation path: this is the
       first thing the founder hears, and letting them start talking over
       it would recreate the problem it exists to fix. */
    await greetFirst();

    /* ── THE MICROPHONE HAS TO ACTUALLY BE OPEN ────────────────────────
       VISION_ASSEMBLY.start() reports a refused microphone, a refused token
       and a dead socket the same way it reports success: by returning. This
       line used to run regardless, so a founder whose audio never started
       was shown YOUR TURN — SPEAK and talked into a call that was not
       listening, with nothing on screen ever saying so. Observed live with
       transcription switched off: 25 s of "YOUR TURN", zero errors, empty
       transcript. An audio session that did not come up is a degraded state
       and is named as one. */
    if (!audioLive()) {
      run.phase = 'audio_failed';
      run.audioError = audioFailure();
      run.errors.push('audio_failed');
      emit();
      return;
    }
    run.audioStarted = true;
    run.phase = 'founder_speaking';
    /* The stream's origin. Word timings and audio offsets share it, which is
       what makes "seek to 02:13" a lookup rather than an estimate. */
    try {
      var asnap = window.VISION_ASSEMBLY.snapshot();
      run.streamStartedAt = asnap.startedAt || Date.now();
    } catch (e) { run.streamStartedAt = Date.now(); }
    /* ONLY IF THE FOUNDER SAID YES. The caller reads the stored preference;
       this obeys it and decides nothing. */
    if (run.recordAudio) {
      run.audioState = window.VISION_ASSEMBLY.startRecording() ? 'recording' : 'failed';
    } else {
      run.audioState = 'not_recorded';
    }
    emit();
  };

  /* FAILS OPEN. If the greeting cannot be fetched the call proceeds exactly
     as it did before this existed -- the founder opens into silence, which
     is worse but is not broken. A rehearsal is never refused over it. */
  async function greetFirst() {
    if (!run) return;
    try {
      var res = await V.sb.functions.invoke('live-intelligence', {
        body: {
          action: 'practice_prospect', opening: true,
          mode: run.mode, handoff: run.handoff, sessionId: run.sessionId,
          /* WP3: the explicit opt-in, and this is the request that PINS the
             session. An old bundle never sends it, so its session pins
             `legacy` and behaves exactly as it did before WP3. */
          sequencingProtocol: SEQUENCING_PROTOCOL,
        },
      });
      var d = res && res.data;
      if (!d || d.ok !== true || !d.reply) return;
      /* What the server decided this session IS. Every later write reads it
         rather than assuming: a new tab that joins a legacy-pinned session
         has to degrade, not impose its own semantics. */
      run.sequencingMode = d.sequencingMode || 'reserved';
      run.greetingName = d.prospectName || null;
      /* WP-4: whatever the server built from the ONE persisted training
         objective for this session -- already whitelisted, already leak-
         proof (explainObjective() never receives the scenario at all).
         Nothing here re-derives or re-shapes it; a missing value just
         means the call has no trainingFocus to show. */
      run.trainingFocus = (d.trainingFocus && typeof d.trainingFocus === 'object')
        ? d.trainingFocus : null;
      /* The state the SERVER started from, so the first founder turn is
         judged against the same situation that decided the greeting. */
      if (d.state && typeof d.state === 'object') run.state = d.state;
      run.history.push({ speaker: 'prospect', text: d.reply, source: 'greeting' });
      /* ONE PERSON FOR THE WHOLE CALL. The greeting leaves history after
         eight turns, and a prospect who introduced themselves as Danny and
         later answers to something else is exactly the incoherence the
         humanity standard forbids. simulatedSoFar is the list the prompt
         already renders as "THINGS YOU HAVE ALREADY SAID IN THIS CALL --
         stay consistent with them", so the name rides the machinery that
         exists rather than a second one beside it. */
      if (d.prospectName) run.simulated.push('You gave your name as ' + d.prospectName + '.');
      /* Persisted like any other prospect line so the transcript, the
         review and the replay all show the call starting where it really
         started. Fire and forget, as every write in this path is. */
      var greetingSeq = null;
      if (run.sessionId && EV) {
        /* ── AWAITED, UNLIKE EVERY OTHER WRITE IN THIS PATH ─────────────
           WP3: the greeting owns sequence 0 on a one-slot reservation, and
           the founder's first turn allocates against it. Fire-and-forget
           left a real window where a fast founder could be released and
           allocate before this row existed -- the session lock makes that
           safe rather than corrupt, but "safe" is not the same as "the
           greeting is first". Ordering the conversation is worth one
           awaited write before the microphone opens. */
        var wrote = await rpc('practice_turn_append_v1', {
          p_session_id: run.sessionId, p_sequence: run.seq, p_speaker: 'prospect',
          /* 'deterministic', not 'greeting': practice_turns has a CHECK
             constraint on reply_source, and an unlisted value fails the
             insert -- silently, because this write is fire and forget like
             every other in the conversation path. The greeting IS
             deterministically generated, so this is accurate as well as
             the only value that survives, and it needs no migration. */
          p_content: d.reply, p_reply_source: 'deterministic',
          /* Reserved sessions ignore p_sequence entirely and derive it from
             the reservation's span; legacy sessions keep trusting it. */
          p_turn_id: run.sequencingMode === 'reserved' ? 'greeting' : null,
        });
        /* The server's number is the truth in reserved mode. Falling back to
           the local counter keeps legacy sessions byte-identical. */
        greetingSeq = (wrote && typeof wrote.sequence === 'number')
          ? wrote.sequence : run.seq;
        run.seq = (wrote && typeof wrote.sequence === 'number')
          ? wrote.sequence + 1 : run.seq + 1;
      }
      /* ── THE GREETING IS EVIDENCE, NOT JUST SCENERY ───────────────────
         It was displayed, it was persisted, and the deterministic readers
         could not see it -- so VISION printed "Priya speaking" and then
         told the founder, several turns later, "Sorry, I did not catch
         your name." The rail reads run.stateTurns; the greeting was only
         ever in run.history, which is the prompt's record and must never
         become a second authority.

         Its identity is the one the server already assigned: the sequence
         the append landed on, or the one the greeting response reserved.
         No fabricated number, no second row -- the same logical turn, made
         visible to the layer that was reasoning without it.

         FLAGGED, because a greeting is evidence of what was SAID and never
         of what the founder EARNED. Nobody asked for it. Measured on the
         real readers before this went in: unflagged it moves turnsSeen on
         every call, and a "You're through to Calder Grove Opticians" shape
         reads as `disclosed` and inflates the substantive count that
         decides whether the call has progressed. The rail honours the flag
         so identity gains the greeting and progress does not. */
      var seqForRail = (typeof greetingSeq === 'number') ? greetingSeq
        : (typeof d.sequence === 'number' ? d.sequence : run.seq);
      run.stateTurns = (run.stateTurns || []).concat([{
        sequence: seqForRail, attemptNo: 1, speaker: 'prospect',
        text: d.reply, complete: true, greeting: true,
        prospect_caused_withholding: false,
      }]);
      emit();
      /* The same shape every other spoken turn has -- browserSpeak writes
         timings onto it, so a bare {reply} would throw inside the one path
         that is meant to fail open. Not awaited: the microphone is already
         live and blocking start() on synthesis would stall the call. */
      /* THE REAL VOICE, IF THE SERVER SENT ONE. Both of these were pinned
         to null, so even once the server started returning greeting audio
         the client would have thrown it away and spoken the line through
         the browser anyway -- the defect had two halves and fixing either
         one alone changes nothing the founder hears. */
      speak({ reply: d.reply, itemId: 'greeting', tone: 'neutral',
        ttsError: d.ttsError || null, timing: {} }, d.audio || null);
    } catch (e) { /* the founder opens into silence, as before */ }
  }

  /* What the frozen engine makes of this line, from the state the prospect
     is actually in. Nothing here advances that state. */
  function judge(text) {
    if (!BRAIN || !COACH || !run) return null;
    try {
      var turn = BRAIN.takeFounderTurn({
        mode: run.mode, state: run.state, text: text,
        context: { ...(run.handoff || {}), prospectSaid: lastProspect() },
      });
      var mode = BRAIN.BEHAVIOUR_MODES[run.mode] || {};
      /* ── GUIDED PRACTICE HAS TO ACTUALLY BE ARMED ────────────────────
         run.coach was created once, in start(), behind `if (COACH)`. COACH
         arrives through a lazy dynamic import, so a founder who pressed
         Start before that promise resolved got run.coach === null for the
         WHOLE call -- and evaluateTurn treats a missing coach as
         `detectedOnly`, which is Full Simulation. The mode marked
         RECOMMENDED silently became the other one, with nothing on screen
         saying so. Seen on a blind call: four assumptions, two Patience
         drops and a Trust drop, and it never once stopped him.

         Created here instead, at the point of use, by which time the
         import has certainly resolved -- this function already returns
         early unless COACH is loaded. */
      if (!run.coach) run.coach = COACH.createCoachState();
      var v = COACH.evaluateTurn({ turn: turn, coach: run.coach, format: run.format,
        mode: mode, focus: run.focus });
      v.turn = turn;
      return v;
    } catch (e) { return null; }
  }

  /* ── THE RECORD SURVIVES THE TAB, AND THE BROWSER NO LONGER WRITES IT ──
     The verdict used to exist only in the reply to the request that
     produced it, so a reload lost the one fact a later Sales Skill Memory
     needs: whether this founder fixed it himself. It is persisted still --
     but by the server that decided it, inside practice_guided_retry.

     Relaying it through here was an authority seam. `outcome` is the whole
     assistance ladder: `corrected_unaided` is the only value that can lift
     a seller, the writer's ON CONFLICT overwrites it, and the RPC was
     granted to `authenticated` -- so a founder could replace their own
     `needs_help` with `corrected_unaided` by calling it directly. Nothing
     about how the verdict is DECIDED changed; only who may write it.

     What the client still contributes are the two assistance flags, sent
     with the retry request. Both are ORed monotonically in the writer, so
     the client can only ever admit MORE assistance than the server knew
     about, never less. */

  /* One round trip, before the prospect is allowed to hear the line. A
     failure here is not a pause: the call carries on rather than stopping a
     founder on a network error. */
  async function askServerAboutPause(text) {
    if (!run || !run.sessionId) return null;
    try {
      var res = await Promise.race([
        V.sb.functions.invoke('live-intelligence', {
          body: { action: 'practice_guided_turn', sessionId: run.sessionId,
            handoff: run.handoff, input: text, sequence: run.seq },
        }),
        new Promise(function (r) { setTimeout(function () { r({ timedOut: true }); }, 8000); }),
      ]);
      var d = res && !res.timedOut && res.data;
      return d && d.ok === true ? d : null;
    } catch (e) { return null; }
  }

  /* THE CALL STOPS HERE. The prospect is not told, not asked and not
     advanced: the failed line simply never reaches them. */
  async function openCoaching(verdict, text, itemId) {
    if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.setCapture(false);
    var originalId = await persistAttempt({
      text: text, turn: verdict.turn, attempt: 1, branch: 'superseded',
      events: ['coached:' + verdict.fault], supersedes: null,
      words: run.pendingWords || [], levels: run.pendingLevels || [],
      startSec: run.audioStartSec, endSec: run.audioEndSec,
      /* No request left for this text: the original, uncorrected line never
         reached the Prospect Brain -- it was intercepted before that. */
      releaseAt: run.seenAt, requestSentAt: null,
      /* WP3: the same logical turn the accepted retry will reuse. */
      turnId: itemId,
    });
    run.coach.active = {
      reason: verdict.fault, attempt: 1,
      /* The founder-facing copy, exactly as the server composed it. */
      whatHappened: verdict.whatHappened, whyItHurt: verdict.whyItHurt,
      bestMove: verdict.bestMove, sequence: verdict.sequence,
      /* ── ONE LOGICAL TURN, TWO ATTEMPTS ──────────────────────────────
         The retry arrives as a DIFFERENT utterance with its own fragment
         id, but it is the same moment in the conversation: the founder
         saying the same thing again, better. Carried here so the retry
         reuses this turn's reservation instead of claiming a second one.
         Proven necessary by a real staging call -- without it the
         superseded attempt and the accepted retry landed under two
         separate reservations, and the retry then collided with the
         ordinary turn that followed it. */
      turnId: itemId,
      originalText: text, originalId: originalId, openedAt: Date.now(),
      wtsi: null, wtsiRequested: false, note: null, accepted: null,
    };
    COACH.noteIntervention(run.coach, verdict.fault);
    run.phase = 'coaching';
    emit();
  }

  /* The founder says it again. Judged against the SAME state the mistake was
     made in, so the retry is a genuine second attempt at that moment. */
  async function handleRetry(text, itemId) {
    var a = run.coach.active;

    /* ── ONE UNAIDED GO, JUDGED BY THE SERVER ─────────────────────────
       Against the move the server locked, re-derived from the transcript
       rather than taken from anything this client sends back. */
    /* WP1: the one real request this retry attempt makes -- captured so the
       eventual accepted-attempt row (if this is the one that lands) has an
       honest requestSentAt instead of leaving it null out of convenience. */
    var tRetryRequest0 = Date.now();
    var res = null;
    try {
      res = await Promise.race([
        V.sb.functions.invoke('live-intelligence', {
          body: { action: 'practice_guided_retry', sessionId: run.sessionId,
            handoff: run.handoff, input: text, sequence: a.sequence,
            /* True once a sentence has been shown. The founder may still
               make the move himself from here, but not unaided. */
            helped: a.wtsiRequested === true,
            /* Sent so the server can record them on the row it writes.
               Downgrade-only: the writer ORs both, so this can only ever
               make the founder's own record show more help, not less. */
            wtsiShown: !!(a.wtsi && a.wtsi.available) },
        }),
        new Promise(function (r) { setTimeout(function () { r({ timedOut: true }); }, 12000); }),
      ]);
    } catch (e) { res = null; }
    var v = res && !res.timedOut && res.data;

    /* A verdict that never arrived must not trap the founder in a pause. */
    if (!v || v.ok !== true) {
      run.notice = 'VISION could not judge that one — carrying on.';
      v = { outcome: 'needs_help', reason: 'verdict_unavailable', event: null };
    }

    a.accepted = v.outcome === 'corrected_unaided' || v.outcome === 'corrected_with_help';

    /* ── NEEDS A HAND ────────────────────────────────────────────────
       The founder had his own go and it did not land, so now — and only
       now — the wording layers are asked. */
    if (!a.accepted && !a.wtsiRequested) {
      a.wtsiRequested = true;
      a.retryText = text;
      a.verdictReason = v.reason;
      a.event = v.event || null;
      run.phase = 'coaching';
      emit();
      try {
        var w = await V.sb.functions.invoke('live-intelligence', {
          body: { action: 'practice_guided_wtsi', sessionId: run.sessionId,
            handoff: run.handoff, sequence: a.sequence },
        });
        var wd = w && w.data;
        a.wtsi = wd && wd.ok === true
          ? { available: wd.wtsiAvailable === true, lines: wd.lines || [] }
          : { available: false, lines: [] };
      } catch (e) { a.wtsi = { available: false, lines: [] }; }
      emit();
      return;
    }


    await persistAttempt({
      text: text, turn: BRAIN.takeFounderTurn({
        mode: run.mode, state: run.state, text: text,
        context: { ...(run.handoff || {}), prospectSaid: lastProspect() },
      }), attempt: a.attempt + 1, branch: 'accepted',
      events: [(a.accepted ? 'retry_accepted:' : 'retry_helped:') + a.reason],
      supersedes: a.originalId,
      words: run.pendingWords || [], levels: run.pendingLevels || [],
      startSec: run.audioStartSec, endSec: run.audioEndSec,
      releaseAt: run.seenAt, requestSentAt: tRetryRequest0,
      /* WP3: SAME logical turn as the superseded attempt above. One base
         sequence, two founder rows, distinguished only by attempt_no. */
      turnId: a.turnId || itemId,
    });
    /* KEYED ON THE LOGICAL TURN, not on a counter. It used to compare
       `run.seq` against itself later, which worked only while the client
       owned the numbering -- WP3 replaces run.seq with the server's
       authoritative value between these two points, so the old comparison
       silently stopped matching and persistTurn wrote a SECOND founder row
       for a turn that already had one. Found on a real staging call. */
    run.retryAt = a.turnId || itemId;
    run.coach.history.push({ reason: a.reason, attempts: a.attempt,
      accepted: !!a.accepted, ms: Date.now() - a.openedAt });
    run.correctedNote = a.accepted
      ? (a.wtsiRequested
        ? { headline: 'Better', note: 'That made the move.' }
        : { headline: 'Corrected yourself', note: '' })
      : { headline: 'Moving on', note: 'Keep the Best Move in mind for the next one.' };
    run.coach.active = null;
    run.phase = 'corrected';
    emit();
    /* Long enough to actually read, short enough not to stall the call. The
       acknowledgement is the only moment the founder learns the correction
       landed, and flashing it past them wastes the whole intervention. */
    await new Promise(function (r) { setTimeout(r, 1400); });
    /* ── WP5: THE CALL MAY HAVE ENDED WHILE WE WERE COACHING ──────────
       This function has been awaiting for a while by now -- a retry verdict,
       possibly a wording call, then the acknowledgement pause above -- and
       the pump()-level hangup guard was passed before any of it. takeTurn()
       refuses a terminal call on its own, but the microphone is re-armed on
       the very next line, so bailing there would still leave the founder
       talking into a dead call. Checked here, before capture comes back. */
    if (run.phase === 'ended' || (run.state && run.state.ended)) {
      run.correctedNote = null;
      emit();
      return;
    }
    /* The accepted line becomes the real turn, from the pre-mistake state.
       Under the ORIGINAL turn's identity: this is the same moment, said
       again, so it belongs to the reservation the coached attempt already
       claimed rather than to the fragment id the retry happened to arrive
       under. `a` is still held locally after coach.active is cleared. */
    if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.setCapture(true);
    await takeTurn(text, a.turnId || itemId);
    run.correctedNote = null;
  }

  /* One coached attempt, stored so the lesson survives the call. */
  async function persistAttempt(o) {
    if (!run || !run.sessionId || !EV) return null;
    /* ── WP3: ADDRESS FIRST, GENERATION LATER (OR NEVER) ────────────────
       This is the earliest touch of the logical turn on the coached path.
       openCoaching() writes the superseded attempt BEFORE anything reaches
       the Prospect Brain -- that text is intercepted and never generated
       against -- so the address has to exist without claiming generation
       ownership. Both attempts then share one base sequence and differ only
       by attempt_no, which is exactly what the reservation is for.
       Idempotent: whichever call gets here first creates it, the rest reuse. */
    if (run.sequencingMode === 'reserved' && o.turnId) {
      await rpc('practice_turn_reserve_v1', {
        p_session_id: run.sessionId, p_turn_id: o.turnId, p_span: 2,
        p_protocol: SEQUENCING_PROTOCOL,
      });
    }
    var sim = EV.scriptSimilarity(o.text, (run.handoff && run.handoff.script) || {});
    /* A COACHED LINE IS STILL A LINE THAT WAS SPOKEN. It needs its word
       timings and its place on the clock, or the review cannot play it back
       and the founder cannot hear the mistake they were stopped for. */
    var words = EV.wordRows(o.words || []);
    var startMs = words.length ? words[0].s
      : (o.startSec != null ? Math.round(o.startSec * 1000) : null);
    var endMs = words.length ? words[words.length - 1].e
      : (o.endSec != null ? Math.round(o.endSec * 1000) : null);
    /* WP1: A COACHED ATTEMPT IS A GENUINE FOUNDER TURN, released by the same
       real decideRelease() as any other -- openCoaching() and handleRetry()
       are both dispatched from inside pump(), after release, not instead of
       it. The values are just sitting in `run` unread by this function until
       now. Same source, same formula takeTurn() already uses for the plain
       path (li-practice-runner.js, turn.timing construction) -- not a new
       measurement, only a missed read.
       requestSentAt has no honest value for a superseded attempt: nothing
       about the founder's original, uncorrected line was ever sent to the
       Prospect Brain, so there is nothing to date-stamp. Fabricating one
       would be worse than leaving it null. o.requestSentAt is supplied by
       the one call site where a real request did happen (the accepted retry,
       judged via practice_guided_retry) and left null by the other. */
    var founderAudioEndAt = (run.streamStartedAt && o.endSec != null)
      ? run.streamStartedAt + o.endSec * 1000 : null;
    /* THE GROUND TRUTH DOCUMENTATION CANNOT GIVE. VISION's connection
       string sends speech_model=u3-rt-pro, which is absent from AssemblyAI's
       current docs -- the March 2026 blog post that introduced it now
       carries AssemblyAI's own banner that newer models have superseded it.
       Its likely successor's own documentation disagrees with itself 2-3
       ways on the exact turn-silence numbers a change here would set. Rather
       than guess, this reads back what the server ITSELF said it resolved
       to (session.resolvedConfig, captured from the "Begin" message every
       connection already receives) and persists it, so the next real call
       settles the question with a fact instead of a table AssemblyAI's own
       pages contradict. Read-only: no turn-taking decision depends on it. */
    var resolvedConfig = null;
    try {
      var pSnap = window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.snapshot
        && window.VISION_ASSEMBLY.snapshot();
      resolvedConfig = (pSnap && pSnap.resolvedConfig) || null;
    } catch (e) { resolvedConfig = null; }
    var timingDetail = {
      /* v3 adds `resolvedConfig` only. Every v1/v2 field keeps its name and
         meaning, so a reader that predates this sees exactly what it saw
         before. */
      version: 'practice_turn_timing_v3',
      founderAudioEndAt: founderAudioEndAt,
      releaseAt: o.releaseAt || null,
      requestSentAt: o.requestSentAt || null,
      arrivals: run.pendingArrivals || null,
      resolvedConfig: resolvedConfig,
    };
    return rpc('practice_turn_append_v1', {
      p_session_id: run.sessionId, p_sequence: run.seq, p_speaker: 'founder',
      p_content: o.text, p_founder_action: o.turn && o.turn.founderAction,
      p_state_before: (o.turn && o.turn.prospectStateBefore) || null,
      p_state_after: (o.turn && o.turn.prospectStateAfter) || null,
      p_pitch_before: run.prevEvidence.pitchPermission === true,
      p_pitch_after: !!(o.turn && o.turn.closePermission),
      p_active_objection: (o.turn && o.turn.activeObjection) || null,
      p_events: o.events, p_script_similarity: sim.value || null,
      p_attempt_no: o.attempt, p_branch: o.branch, p_supersedes: o.supersedes,
      p_words: words.length ? words : null, p_audio_start_ms: startMs, p_audio_end_ms: endMs,
      p_delivery: words.length ? EV.deliveryFacts(o.words || [], { levels: o.levels || [] }) : null,
      p_timing_detail: timingDetail,
      p_turn_id: o.turnId || null,
    }).then(function (d) { return (d && d.turn_id) || null; });
  }

  /* The founder asks to try again — this is where retry recording begins. */
  api.retry = function () {
    if (!run || !run.coach || !run.coach.active) return;
    run.coach.active.note = null;
    run.phase = 'retry_listening';
    if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.setCapture(true);
    emit();
  };
  /* `showExample` is gone with the button that called it. An example is no
     longer something a founder can reveal early: it arrives only after an
     unaided go, and only if it survives the move gate. */

  /* The founder's Speaker toggle. Applies immediately to whatever prospect
     line is playing right now, and is remembered for every line after —
     playProspectAudio() reads run.speakerMuted when it creates the next
     element, so a founder who mutes mid-call stays muted for the rest of it
     without this function being called again. */
  api.setSpeakerMuted = function (muted) {
    if (!run) return false;
    run.speakerMuted = !!muted;
    if (run.audioEl) { try { run.audioEl.muted = !!muted; } catch (e) {} }
    return true;
  };
  api.speakerMuted = function () { return !!(run && run.speakerMuted); };

  /* Reads any newly settled founder utterance and takes exactly one turn. */
  /* ── ONE DOOR IN, ONE DOOR OUT ──────────────────────────────────────
     Everything that wants the runner to look at the transcript calls
     requestPump(). Everything that finishes a turn calls clearBusy(). The
     invariant they enforce together: NO finalised provider fragment stays
     pending merely because it arrived while `run.busy` was true. */
  function requestPump() {
    if (!run || run.phase === 'ended') return;
    run.pumpPending = true;
    if (run.busy) {
      /* Observation only -- proves the gate was hit rather than inferring it. */
      run.pumpBlockedAt = Date.now();
      run.pumpBlockedCount = (run.pumpBlockedCount || 0) + 1;
      return;
    }
    pump();
  }

  /* The ONLY way busy is lowered. A branch cannot forget the wakeup because
     it no longer owns the decision -- which is what the coaching-pause path
     did: it cleared busy and returned, and the fragment waiting behind it
     had nothing left to wake it. `terminal` is the one case that must not
     resurrect a run that has genuinely ended. */
  function clearBusy(reason, terminal) {
    if (!run) return;
    run.busy = false;
    run.lastBusyExit = { reason: reason || 'unknown', at: Date.now() };
    if (terminal === true || run.phase === 'ended') return;
    if (run.pumpPending || hasPendingFragments()) {
      run.repumpScheduledAt = Date.now();
      pump();
    }
  }

  /* Is there anything the runner has NOT yet turned into a turn? Read from
     the transcriber rather than from a flag, so a wakeup lost before the
     flag was ever set is still recoverable. */
  function hasPendingFragments() {
    try {
      var snap = window.VISION_ASSEMBLY.snapshot();
      var rows = (snap.transcript || []);
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (r && r.text && String(r.text).trim() && !run.handled[r.itemId]) return true;
      }
      return !!(run.carried && run.carriedFlush);
    } catch (e) { return false; }
  }

  async function pump() {
    if (!run) return;
    run.pumpAttemptAt = Date.now();
    if (run.busy) {
      run.pumpPending = true;
      run.pumpBlockedAt = run.pumpAttemptAt;
      run.pumpBlockedCount = (run.pumpBlockedCount || 0) + 1;
      return;
    }
    run.pumpPending = false;
    var snap = window.VISION_ASSEMBLY.snapshot();
    var rows = (snap.transcript || []).filter(function (r) {
      return r.text && r.text.trim() && !run.handled[r.itemId];
    });
    /* THE FLUSH TIMER'S OWN PASS. Every row tied to the carried text was
       marked handled the moment it was first carried, so with nothing new to
       assemble the early return below would fire every time -- the timer
       sets `carriedFlush` and calls pump(), and pump() leaves without ever
       looking at it. That was the whole defect: the carried text was never
       actually unreachable, the code path that sends it was. */
    var forcedFlush = !rows.length && run.carriedFlush && !!run.carried;
    if (!rows.length && !forcedFlush) return;

    var now = Date.now();
    rows.forEach(function (r) {
      if (!run.seenAtById[r.itemId]) {
        run.seenAtById[r.itemId] = now;
        /* The interval that was invisible on call #1: the provider stamped
           arrival, and this is when the runner actually looked. Nothing
           between them was recorded, so a 9.9 s stall could only be
           inferred. Content is never stored here -- ids and clocks only. */
        run.pumpObs[r.itemId] = {
          runnerSeenAt: now,
          providerArrivedAt: (typeof r.arrivedAt === 'number') ? r.arrivedAt : null,
          busyAtProviderArrival: !!run.pumpBlockedAt && !!run.pumpBlockedCount,
          pumpBlockedCount: run.pumpBlockedCount || 0,
          lastBusyExit: run.lastBusyExit ? run.lastBusyExit.reason : null,
          repumpScheduledAt: (typeof run.repumpScheduledAt === 'number') ? run.repumpScheduledAt : null,
          onChangeAt: (typeof run.onChangeAt === 'number') ? run.onChangeAt : null,
          pendingFragmentCount: rows.length,
        };
      }
    });

    /* ── ONE THOUGHT, ONE TURN ─────────────────────────────────────────
       The transcriber finalises on a fixed clock, so a long sentence comes
       back as two or three fragments a few hundred milliseconds apart. They
       are reassembled here BEFORE anything looks at them, and the prospect
       is not allowed to answer until the sentence has stopped arriving. */
    var turn;
    if (forcedFlush) {
      /* The turn IS the carried text, unchanged since it was carried.
         decideRelease() below still judges it fresh rather than being told
         the answer -- shape and stillSpeaking can outrun this timer, so a
         founder who resumed talking right as the clock ran out is held, not
         cut off. This only forces through a thought genuinely still sitting
         there with nothing more coming. */
      turn = { text: run.carried, partIds: (run.carriedPartIds || []).slice(),
        parts: (run.carriedPartIds || []).length || 1, complete: false,
        confidence: TA.confidenceOf({ text: run.carried, danglingAtRelease: true,
          parts: (run.carriedPartIds || []).length || 1 }),
        creditEligible: false, assemblyVersion: TA.ASSEMBLY_VERSION, start: null, end: null };
    } else {
      var logical = TA ? TA.assembleTurns(rows.map(function (r) {
        return { itemId: r.itemId, role: 'founder', text: String(r.text).trim(),
          start: typeof r.start === 'number' ? r.start : null,
          end: typeof r.end === 'number' ? r.end : null };
      })) : null;
      turn = logical && logical.length ? logical[0] : null;
    }
    if (!turn) {
      /* The assembler has not loaded yet. Waiting is correct: taking the
         fragment now is exactly the behaviour being removed. */
      clearTimeout(run.settleTimer);
      run.settleTimer = setTimeout(function () { if (run && run.phase !== 'ended') pump(); }, 120);
      return;
    }
    var lastPart = turn.partIds[turn.partIds.length - 1];
    /* Read fresh rather than from the last onChange: pump() is also reached
       from its own timer, and a stale answer here is the whole bug. */
    trackSpeech();
    /* How long the NEWEST fragment of this thought ran for. A fragment at the
       provider's duration ceiling was cut, and its second half is still on
       the wire. */
    var lastRow = null;
    for (var ri = 0; ri < rows.length; ri++) { if (rows[ri].itemId === lastPart) lastRow = rows[ri]; }
    var lastPartMs = (lastRow && typeof lastRow.start === 'number' && typeof lastRow.end === 'number')
      ? Math.round((lastRow.end - lastRow.start) * 1000) : null;
    var finalisedAt = run.seenAtById[lastPart] || now;
    var speaking = stillSpeaking();
    var quiet = quietSince();
    var openPending = continuationPending();
    var release = TA.decideRelease({
      pending: { text: turn.text, finalisedAt: finalisedAt,
        lastPartMs: lastPartMs, quietSince: quiet,
        continuationPending: openPending },
      nowMs: now, stillSpeaking: speaking });
    /* ── THE DECISION TRACE ────────────────────────────────────────────
       Last-value snapshots could not tell a 600 ms settle apart from a
       10.5 s stall that ENDED in a 600 ms settle -- both persisted
       `releasedBy: "settled"`. Every evaluation is recorded instead, in
       order, so the next human call proves which authority held the turn
       rather than leaving it to be inferred. Bounded per turn; timings,
       flags and reasons only, never transcript text. */
    recordDecision({
      decisionAt: now, pendingItemId: lastPart, pendingAgeMs: now - finalisedAt,
      finalisedAt: finalisedAt, quietSince: quiet, stillSpeaking: speaking,
      lastPartMs: lastPartMs, fragmentCount: turn.partIds.length,
      turnComplete: turn.complete !== false, isDangling: !!release.dangling,
      cut: !!release.cut, cutEvidence: release.cutEvidence || null,
      providerEndOfTurn: true,   /* a segment exists only at end_of_turn */
      decision: release.action, reason: release.reason,
      waitMs: release.waitMs == null ? null : release.waitMs,
      complete: release.complete == null ? null : release.complete,
      nextPumpAt: release.action === 'release'
        ? null : now + Math.max(60, release.waitMs || 120),
    });
    if (release.action !== 'release') {
      run.heldForSettle += 1;
      if (release.reason === 'founder_still_speaking') run.heldForSpeech += 1;
      if (release.reason === 'cut_at_provider_ceiling') run.heldForCut += 1;
      clearTimeout(run.settleTimer);
      run.settleTimer = setTimeout(function () { if (run && run.phase !== 'ended') pump(); },
        Math.max(60, release.waitMs || 120));
      return;
    }

    /* ── AN UNFINISHED THOUGHT IS NOT A TURN ───────────────────────────
       The assembler releases dangling text once the founder has been quiet
       for DANGLE_SETTLE_MS, flagged `complete: false`. It was then spoken to
       the prospect anyway, so a founder who paused mid-sentence got answered
       on half of it -- observed live: "Um, I'm trying to" drew "Could you
       get to the point, please?", which reads as VISION inventing a line and
       replying to it. The words were real; the thought was not finished.

       So it is carried instead, and joined to whatever he says next. The
       flush timer is the bound: a founder who trails off and genuinely stops
       still gets a reply rather than silence. */
    /* An exhausted cut has ALREADY paid CUT_SETTLE_MS waiting for the
       continuation the carry timer would wait for again. One bounded
       recovery window per uncertainty, never two stacked. */
    if (release.recoveryExhausted === true) run.carryReason = 'cut_recovery_exhausted';
    else if (release.complete === false) run.carryReason = 'carried_unfinished';
    if (release.complete === false && !run.carriedFlush && release.recoveryExhausted !== true) {
      turn.partIds.forEach(function (id) { run.handled[id] = true; });
      run.carried = (run.carried ? run.carried + ' ' : '') + turn.text;
      run.carriedPartIds = (run.carriedPartIds || []).concat(turn.partIds);
      clearTimeout(run.carriedTimer);
      run.carriedTimer = setTimeout(function () {
        if (!run || run.phase === 'ended') return;
        run.carriedFlush = true;   /* next pass sends it, finished or not */
        pump();
      }, CARRY_FLUSH_MS);
      emit();
      return;
    }

    /* Every fragment of this thought is consumed together. On a forced flush
       `turn.text` already IS the carried text, so it is not glued on twice. */
    var carriedText = (run.carried && !forcedFlush) ? run.carried + ' ' : '';
    run.carried = null; run.carriedFlush = false; run.carriedPartIds = null;
    clearTimeout(run.carriedTimer); run.carriedTimer = null;
    var row = { itemId: turn.partIds[0], text: carriedText + turn.text };
    turn.partIds.forEach(function (id) { run.handled[id] = true; });
    run.busy = true;

    /* Observation only: when the final transcript reached us, and where the
       founder's audio actually ended inside the stream. */
    run.seenAt = Date.now();
    /* ── WALL-CLOCK FRAGMENT ARRIVAL, MEASURED NOT INFERRED ────────────
       `decideRelease` waits a WALL-CLOCK window for a continuation, and the
       only continuation figures on record are AUDIO-clock gaps (146 ms,
       33 ms) whose fragments did not actually ARRIVE for ~3.2 s. Nothing has
       ever recorded the wall-clock delta, so SETTLE_MS cannot be re-sized
       from evidence. This records it.

       Joined by `itemId` -- never by transcript text, which is neither
       unique nor stable across a formatted revision. `arrivedAt` is stamped
       in li-assembly.js the instant the Turn message parses, so it is the
       provider's delivery time and not this poller's.

       OBSERVATION ONLY. Nothing reads it back; no release decision consumes
       it. `previousReleaseAt` is the cross-turn half: a fragment arriving
       just after the previous turn was released is a continuation the settle
       window would have merged, and is how a premature release is detected
       offline. */
    (function recordArrivals() {
      try {
        if (!FA) { run.pendingArrivals = null; return; }
        var byId = {};
        var all = (snap && snap.transcript) || [];
        for (var ai = 0; ai < all.length; ai++) {
          if (all[ai] && all[ai].itemId) byId[all[ai].itemId] = all[ai].arrivedAt;
        }
        run.pendingArrivals = FA.fragmentArrivals({
          partIds: turn.partIds, arrivalById: byId,
          releaseAt: run.seenAt, releasedBy: release.reason,
          previousReleaseAt: (typeof run.lastReleaseAt === 'number') ? run.lastReleaseAt : null,
          settleMs: TA.SETTLE_MS, dangleSettleMs: TA.DANGLE_SETTLE_MS,
        });
        /* Attached to the same record so provider -> runner -> release is
           readable off one row without inference. */
        if (run.pendingArrivals) {
          run.pendingArrivals = Object.assign({}, run.pendingArrivals, {
            pumpObs: turn.partIds.map(function (id) {
              var o = run.pumpObs[id] || null;
              return o ? Object.assign({ itemId: id }, o) : { itemId: id };
            }),
            pumpAttemptAt: (typeof run.pumpAttemptAt === 'number') ? run.pumpAttemptAt : null,
            pumpReleaseAt: run.seenAt,
            decisions: (run.decisions || []).slice(),
            decisionsDropped: run.decisionsDropped || 0,
            carryReason: run.carryReason || null,
          });
        }
        run.lastReleaseAt = run.seenAt;
        /* The trace belongs to the turn that just released. A carried turn
           deliberately keeps accumulating across its carry -- the decisions
           BEFORE the carry are exactly what identifies a stacked wait -- so
           the reset happens here, at release, and nowhere earlier. */
        run.decisions = [];
        run.decisionsDropped = 0;
        run.carryReason = null;
      } catch (e) { run.pendingArrivals = null; }
    }());
    run.audioEndSec = (typeof turn.end === 'number') ? turn.end : null;
    run.audioStartSec = (typeof turn.start === 'number') ? turn.start : null;
    if (!run.streamStartedAt) run.streamStartedAt = snap.startedAt || null;
    /* The word timings AssemblyAI produced for exactly this utterance,
       looked up by id rather than reverse-engineered from it -- and for a
       reassembled thought, every fragment's words in order. */
    run.pendingWords = turn.partIds.reduce(function (acc, id) {
      return acc.concat((window.VISION_ASSEMBLY.wordsFor
        ? window.VISION_ASSEMBLY.wordsFor(id) : []) || []);
    }, []);
    run.pendingLevels = window.VISION_ASSEMBLY.levels
      ? window.VISION_ASSEMBLY.levels().slice(-40) : [];
    /* HOW WELL VISION ACTUALLY HEARD THIS. Carried to the row so a turn the
       microphone barely caught can never be read as confident evidence. */
    run.pendingAssembly = {
      complete: release.complete !== false && turn.complete !== false,
      confidence: turn.confidence,
      creditEligible: turn.creditEligible === true && release.complete !== false,
      parts: turn.parts, partIds: turn.partIds.slice(),
      releasedBy: release.reason, version: turn.assemblyVersion,
    };

    /* ── GUIDED PRACTICE ───────────────────────────────────────────────
       A retry in progress consumes this utterance; otherwise the line is
       judged before the prospect is allowed to react to it. */
    /* Nothing the founder says after a hangup reaches the prospect -- no
       turn, no pause, no retry. The call is over. */
    if (run.phase === 'ended' || (run.state && run.state.ended)) {
      run.handled[row.itemId] = true;
      clearBusy('ended', true);
      return;
    }
    if (run.coach && run.coach.active) {
      await handleRetry(row.text.trim(), row.itemId);
      clearBusy('retry', false);

      return;
    }
    /* ── WHO DECIDES A PAUSE ───────────────────────────────────────────
       The server, from findings it stands behind and a budget it derives
       from the transcript. The behaviour engine's own read is still taken
       below for the detected list, but it no longer stops anyone: it fires
       on phrase shape, and being interrupted mid-call is a claim about the
       founder that needs better evidence than that. */
    /* GUIDED PRACTICE ONLY. Full Simulation has no coaching contract to
       enforce -- there is nothing for the server to pause on behalf of --
       so the round trip is skipped rather than paid and ignored. Measured
       on staging: ~220-250ms of pure auth+network tax on every single
       founder turn, for a verdict Full Simulation was never going to act
       on (openCoaching() itself has no format check, so a stray `paused`
       here would wrongly interrupt an unassisted run -- skipping the call
       is what keeps that from ever being possible, not a promise the
       server would agree to stay quiet). */
    var pause = run.format === 'guided' ? await askServerAboutPause(row.text.trim()) : null;
    if (pause && pause.paused) {
      await openCoaching(pause.pause, row.text.trim(), row.itemId);
      clearBusy('coaching_pause', false);
      return;
    }
    var verdict = judge(row.text.trim());
    if (verdict && verdict.reason) run.detected.push({ itemId: row.itemId, reason: verdict.reason });
    await takeTurn(row.text.trim(), row.itemId);
    /* Anything that settled while we were speaking is handled next --
       and now that is guaranteed rather than remembered. */
    clearBusy('turn_taken', false);
  }

  async function takeTurn(founderText, itemId) {
    /* ── WP5: NOT ONE MORE TURN ───────────────────────────────────────
       pump() already refuses to start a turn after a hangup, but it is not
       the only way in: handleRetry() reaches here after a coaching round
       trip that can outlast the ending, and the test seam calls it
       directly. The authority is unchanged -- this reads the terminal state
       the server decided, it does not decide one -- and it costs a single
       comparison on a path that is about to spend a model call. */
    if (run.phase === 'ended' || (run.state && run.state.ended)) return;
    var t0 = Date.now();
    /* CAPTURED BEFORE ANYTHING BELOW OVERWRITES run.state. This is the one
       chance to see the prospect state as it stood before this turn --
       computeGuidedReaction needs both ends of the transition, and
       run.state is reassigned to the server's answer a few lines into this
       same function. */
    var stateBeforeTurn = run.state;
    run.phase = 'thinking';
    /* THE MICROPHONE STOPS BEFORE VISION SPEAKS, not after. */
    if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.setCapture(false);
    run.history.push({ speaker: 'founder', text: founderText });
    emit();

    /* ── A TURN THAT NEVER COMES BACK ──────────────────────────────────
       There was no ceiling on this request. Observed on canonical staging:
       the fourth turn of a rehearsal hit ERR_TIMED_OUT, the promise stayed
       pending, and the call sat on VISION THINKING with the microphone off
       until the founder gave up — no error, no recovery, no way back into
       the conversation. The server's own budget is well inside this, so a
       request still running at TURN_TIMEOUT_MS is not slow, it is gone. */
    var res = null;
    try {
      res = await Promise.race([
        V.sb.functions.invoke('live-intelligence', {
          body: {
            action: 'practice_prospect', mode: run.mode, handoff: run.handoff,
            /* P1-1: was `run.history.slice(-8)`. The server re-caps and then
               buildProspectInput picks its own window (first 2 + last 6, still
               exactly 8 messages), so truncating here removed the opening
               before anything downstream could choose to keep it. Sending the
               full run history costs a few KB on the request and NOTHING in
               prompt tokens -- the model still receives 8 messages either way.
               The server applies the payload bound. */
            input: founderText, state: run.state, history: run.history,
            simulatedSoFar: run.simulated.slice(-8),
            /* Facts the prospect has already said out loud. Without it the
               server offers the same one every turn and the prospect
               repeats itself. Same shape and same lifetime as
               `simulatedSoFar` directly above. */
            disclosedSoFar: run.disclosed.slice(-12),
            prospectSaid: lastProspect(),
            turnId: itemId,
            /* WP3: this turn's logical identity is (sessionId, turnId), and
               the server owns what sequence that becomes. */
            sequencingProtocol: SEQUENCING_PROTOCOL,
            /* WHICH CALL THIS IS. Controlled Uncertainty picks who answered
               once per session and reads it back on every later turn, and it
               keys on this id -- so without it the server has no session to
               look up, no scenario is ever chosen, and the hidden role
               silently does nothing on every real call. The state round-trip
               above cannot carry it: the role must never be in a payload the
               browser can read. Found by driving the actual runner; the
               offline smokes all sent the id themselves. */
            sessionId: run.sessionId,
          },
        }),
        new Promise(function (r) { setTimeout(function () { r({ timedOut: true }); }, TURN_TIMEOUT_MS); }),
      ]);
    } catch (e) { res = null; }

    var d = res && !res.timedOut && res.data;
    if (!d || d.ok !== true) {
      /* ── WP3: A REFUSAL IS NOT A FAILURE ─────────────────────────────
         The server declined to generate a SECOND authoritative reply for a
         turn that is already owned, already answered, or no longer current.
         That is the guarantee working, not the call breaking: the founder
         keeps talking and nothing invents a competing prospect line. It is
         recorded distinctly so a refusal is never read as a dropped turn. */
      var refusal = d && d.error;
      /* ── WP5: THE CALL IS OVER, AND THIS IS HOW WE FIND OUT ───────────
         Checked BEFORE the recoverable-refusal handling below, because that
         path ends by re-arming the microphone -- correct for a turn that was
         merely not authoritative, catastrophic for a call that has already
         ended.

         This is the branch that closes the defect WP5 exists for. When the
         terminal turn's own response is lost -- a timeout, a dropped
         connection -- this client still believes the call is live and keeps
         talking. The server remembers, refuses the next turn, and says why;
         the founder stops talking to somebody who hung up a minute ago.

         The reason comes from the SERVER and is never invented here: no
         guessing from the last turn, no default. Absent, terminal is still
         adopted and hungUpHtml's unknown case speaks for it rather than
         asserting an ending nobody decided. */
      if (refusal === 'call_terminated') {
        /* ADOPT ONCE. api.stop() scores the session and finishes the row,
           and neither is guarded against being run twice -- so a repeated
           call_terminated (a second stale turn, a retry) must be inert. */
        if (run.phase !== 'ended') {
          run.state = Object.assign({}, run.state, {
            ended: true, endedReason: d.terminalReason || null,
          });
          run.endedByProspect = { reason: d.terminalReason || null };
          run.errors.push('turn_refused_call_terminated');
          run.notice = null;
          /* Cancels the settle and carry timers, kills capture and the
             tracks, and sets phase 'ended' -- which is the condition every
             other re-entry guard in this file already tests, so no stale
             callback can re-arm the microphone after this. */
          api.stop();
        }
        emit();
        return;
      }
      var owned = refusal === 'turn_in_progress' || refusal === 'session_busy_different_turn'
        || refusal === 'turn_superseded' || refusal === 'fingerprint_mismatch';
      /* THE MICROPHONE COMES BACK ON. Whatever failed, the founder is in a
         rehearsal and must be able to keep talking. */
      run.errors.push(owned ? ('turn_not_authoritative:' + refusal)
        : (res && res.timedOut ? 'turn_timeout' : 'turn_failed'));
      run.notice = owned ? null
        : 'That last line did not reach them — VISION is listening again, keep going.';
      run.phase = 'founder_speaking';
      if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.setCapture(true);
      emit();
      return;
    }
    run.notice = null;
    /* Pinned by the server on the opening turn; carried on every reply so a
       mode that was decided before this tab existed still governs it. */
    if (d.sequencingMode) run.sequencingMode = d.sequencingMode;
    /* THE AUTHORITATIVE ADDRESS FOR THIS EXCHANGE. In reserved mode the
       local counter stops being the truth and becomes a fallback. */
    if (run.sequencingMode === 'reserved' && typeof d.sequence === 'number') run.seq = d.sequence;

    run.state = d.state;
    /* ── GUIDED LIVE REACTION INTELLIGENCE ─────────────────────────────
       Computed here, not on the server: the same "frozen engine, second
       opinion never reaches state" relationship BRAIN already has to the
       pause decision above. Nothing about the call outcome depends on this
       -- it is read-only commentary on a transition the server already
       decided, and format is checked FIRST so Full Simulation and any
       future strict mode see exactly nothing, even though they call this
       same function. */
    /* Stashed for the rail, which reads the same classification to tell a
       founder who explored an objection from one who talked over it. */
    run.lastFounderAction = d.founderAction || null;
    /* ── WHAT THAT MEANT, GIVEN WHAT HE SELLS ──────────────────────
       Semantic evidence, read on the server on the turn that produced the
       reply. Carried, never derived here: the rail must stay synchronous.
       Null whenever the read did not run, and the rail then behaves
       exactly as it did before the layer existed. */
    /* WP8: the prospect response no longer carries relevance -- the read
       runs concurrently with playback and is applied at the founder-ready
       boundary below. Cleared here so a previous turn's reading can never
       be shown against this one. */
    run.relevance = null;
    /* WP4 BOUNDARY B, AS OF THIS EXCHANGE. run.stateTurns is not updated
       with THIS founder/prospect pair until advanceState() below runs --
       so the two entries are appended here, locally, never mutating
       run.stateTurns itself. Same sequences advanceState assigns moments
       later (run.seq / run.seq + 1), so the two views can never diverge. */
    var authorityEvidence = EG
      ? EG.readAuthorityEvidence(
          (run.stateTurns || []).concat([
            { sequence: run.seq, speaker: 'founder', text: founderText },
            { sequence: run.seq + 1, speaker: 'prospect', text: d.reply },
          ]), { asOfSequence: run.seq + 1 })
      : null;
    var guidedReaction = (REACT && stateBeforeTurn && d.state)
      ? REACT.computeGuidedReaction({ before: stateBeforeTurn, after: d.state,
          classification: { action: d.founderAction }, format: run.format, authorityEvidence: authorityEvidence })
      : null;
    /* SEQUENCE-STAMPED, AND CLEARED ON EVERY TURN THAT PRODUCES NONE.
       Every reaction describes what THIS founder turn did. The old code
       only ever overwrote this on a fresh positive/negative result, never
       cleared it on a silent, hostile, or terminal one -- so a real
       Engagement-up reaction from an early discovery question was still on
       screen turns later when the founder said "Shut up." and the call
       ended, read as feedback on the turn that just happened. Demonstrated
       on a real staging call: turn 2 legitimately raised Engagement
       ("You gave them room to keep talking"); turn 4 was hostile and
       terminal and correctly produced no reaction at all, but the UI kept
       showing turn 2's. run.seq (this turn's own founder sequence, not yet
       incremented -- persistTurn() below bumps it by 2 per exchange) is
       the ground truth every later render checks against
       (li-practice-call.js's own independent guard), so a reaction can
       never outlive the turn it was actually about. */
    run.lastGuidedReaction = guidedReaction
      ? Object.freeze(Object.assign({}, guidedReaction, { atSequence: run.seq }))
      : null;
    /* Array.isArray, not `|| []`: a truthy non-array simulatedFacts (the
       server sending one object instead of a list, say) would otherwise
       reach .map() directly and throw -- past every try/catch downstream
       in this function, with the microphone already muted for this turn
       and nothing left to re-enable it. Demonstrated directly during the
       Practice torture audit, which is also how the second, identical
       `(d.simulatedFacts || []).map(...)` below (building `turn.simulatedFacts`
       for persistence) was found -- a plain source read had missed it;
       only the executable regression test in qa-practice-turn-gate.mjs
       caught that this fix originally covered one of the two. Computed
       once, reused at both sites, so a third copy cannot reappear here. */
    var simulatedFacts = Array.isArray(d.simulatedFacts) ? d.simulatedFacts : [];
    run.simulated = run.simulated.concat(simulatedFacts.map(function (f) { return f.text; }));
    run.disclosed = run.disclosed.concat(d.disclosedIds || []);
    /* The transcript entry is the VALIDATED TEXT, never a retranscription. */
    run.history.push({ speaker: 'prospect', text: d.reply, source: 'simulation' });

    var turn = {
      itemId: itemId, founder: founderText, reply: d.reply, tone: d.tone,
      /* THE SAME GROUND TRUTH run.lastGuidedReaction WAS JUST STAMPED
         WITH. Carried on the turn itself so the render side can check
         freshness against the real turn record, not just trust a second
         copy of the same in-memory counter. */
      sequence: run.seq,
      source: d.source, modelCalled: d.modelCalled, modelReason: d.modelReason,
      posture: d.posture, founderAction: d.founderAction, outcome: d.outcomeState,
      objection: d.activeObjection, closePermission: d.closePermission,
      reaction: d.reaction || null,
      guidedReaction: guidedReaction,
      prospectCausedWithholding: d.prospectCausedWithholding === true,
      /* THE STATE THIS TURN PRODUCED, so it reaches the founder's own
         stored row. `turnRecords` in practice-evidence.js has always read
         `turn.stateAfter` for `state_after` -- nothing here ever set it, so
         every real session persisted `state_after: null` on every founder
         turn. scoreQualification reads `state_after.needDiscovered` off
         exactly that row: with it always null, every real call scored
         qualification as 0% regardless of what was actually established.
         The test fixture hand-populates `state_after`, which is why the
         suite never caught a gap that only exists in the live wiring. */
      stateAfter: d.state || null,
      simulatedFacts: simulatedFacts.map(function (f) { return f.text; }),
      ttsError: d.ttsError || null,
      usage: d.usage || null,
      serverTimings: d.timings || null,
      timing: {
        transcriptSeenAt: run.seenAt || null,
        founderAudioEndAt: (run.streamStartedAt && run.audioEndSec != null)
          ? run.streamStartedAt + run.audioEndSec * 1000 : null,
        turnStart: t0,
        replyReady: Date.now(),
        terraMs: d.modelLatencyMs || null,
        ttsMs: d.ttsLatencyMs || null,
      },
      audioBytes: d.audio ? d.audio.bytes : 0,
      ttsCostMicrousd: d.audio ? d.audio.costMicrousd : 0,
      spoke: false,
    };
    run.turns.push(turn);
    /* Advanced from the turn that just completed, and from the prospect's
       validated reply -- never from a fragment the microphone cut. */
    advanceState({ speaker: 'founder', text: founderText, sequence: run.seq, attemptNo: 1,
      branch: 'accepted', detectedEvents: [],
      complete: !run.pendingAssembly || run.pendingAssembly.complete === true,
      creditEligible: !run.pendingAssembly || run.pendingAssembly.creditEligible === true });
    advanceState({ speaker: 'prospect', text: d.reply, sequence: run.seq + 1,
      attemptNo: 1, complete: true, creditEligible: true,
      /* Carried, never inferred. The answer key reads this instead of guessing
         from the words whether a founder was stonewalled or simply not
         answered because he asked something unanswerable. */
      prospectCausedWithholding: d.prospectCausedWithholding === true,
      reaction: d.reaction || null });
    refreshRail();
    /* WP1 observability only: refreshRail() is synchronous and pure, so this
       is the real moment current-turn coaching became available -- recorded,
       never read by the rail or the render path itself.

       WP10: STAMPED ONLY IF THERE IS ACTUALLY COACHING. This used to fire
       unconditionally, which made it a claim the runtime could not always
       honour. refreshRail() returns early when the lazily-imported rail
       module has not resolved yet -- reachable on a fast first turn -- and
       sets run.rail to null if liveGuidance throws. In both cases the
       founder had no coaching while the field said coaching was rendered.
       Absence now means absence, which is the only reading a later system
       can safely trust. */
    if (run.rail && liveAssistanceAllowed()) turn.timing.coachingRenderedAt = Date.now();
    emit();

    /* ── WP8: INTERPRET WHILE THEY TALK ────────────────────────────────
       Fired here and deliberately NOT awaited: the prospect's audio is
       already on its way and must never wait on an enrichment that changes
       at most one coaching branch.

       `semanticBuffer` is a LOCAL, and that is the whole cross-turn safety
       argument. It lives and dies with this invocation of takeTurn, so a
       result that arrives after this turn is over writes into a closure
       nobody reads -- it cannot reach the next turn, because there is no
       shared place for it to land. No turn-id comparison is needed to make
       that true; it is structural.

       The single in-flight flag IS shared, because shedding is a property
       of the session rather than of one turn. The server enforces the same
       rule under its session lock, so a second tab cannot bypass it. */
    var semanticBuffer = null;
    var semanticApplied = false;
    if (!run.semanticInFlight && !(run.state && run.state.ended)) {
      run.semanticInFlight = true;
      /* WP10 provenance: a read was ASKED FOR on this turn. Stamped at
         dispatch rather than on return, so it stays true even when the
         answer never arrives -- "attempted" and "arrived" are different
         facts and a later system must be able to tell them apart. */
      turn.timing.semanticDispatchedAt = Date.now();
      askSemantics(itemId).then(function (r) {
        semanticBuffer = r;
      }).catch(function () {
        /* A failed reading is indistinguishable from no reading, by design. */
      }).then(function () {
        run.semanticInFlight = false;
      });
    }

    /* ── HOW LONG A PERSON WOULD HAVE TAKEN ────────────────────────────
       A FLOOR, never an addition. The machine already answers in about
       1.6s at the median, so most turns wait for nothing at all -- and a
       prospect brushing the founder off has a floor BELOW that, so
       dismissals stay as fast as the pipeline can make them.

       Recorded separately from the technical time, because a rehearsal
       that feels slow needs to say which of the two it was. */
    var human = TIMING ? TIMING.responseDelay({ mode: run.mode, turn: turn, founderText: founderText })
      : { targetMs: 0, because: [] };
    var technicalMs = Date.now() - t0;
    var intentionalMs = Math.max(0, human.targetMs - technicalMs);
    turn.timing.technicalMs = technicalMs;
    turn.timing.intentionalMs = intentionalMs;
    turn.timing.perceivedMs = technicalMs + intentionalMs;
    turn.timing.hesitationBecause = human.because;
    if (intentionalMs > 0) await new Promise(function (r) { setTimeout(r, intentionalMs); });

    /* ── THEY HUNG UP ──────────────────────────────────────────────────
       The engine decides this, never the model and never this file. Until
       now nothing read it, so a prospect who had ended the call was still
       answering: the founder kept talking to someone who had gone. */
    if (run.state && run.state.ended) {
      run.endedByProspect = { reason: run.state.endedReason || null };
      /* No marker in the history: it is not something anyone said, and the
         transcript renders every entry as a spoken line -- it appeared on
         screen as a founder turn reading "call_ended". The flag above is
         what the screen reads. */
      if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.setCapture(false);
      /* They still get to say the last line. Same path as any other reply,
         so it is spoken and transcribed exactly like one. */
      run.phase = 'prospect_speaking';
      emit();
      await speak(turn, d.audio || null);
      /* WRITTEN BEFORE THE CALL IS CLOSED. The normal path persists at the
         end of the turn, which this branch returns past -- so the exchange
         that actually ended the call was missing from the review, which is
         the one turn it most needs. */
      persistTurn(turn);
      api.stop();
      return;
    }

    /* THE VALIDATED TEXT IS SPOKEN, unchanged. Nothing between the validator
       and the speaker may edit a word. */
    run.phase = 'prospect_speaking';
    emit();
    await speak(turn, d.audio || null);

    /* ── WP8: THE LIVE DEADLINE ────────────────────────────────────────
       Playback has finished and the founder is about to be able to speak.
       This is the one moment a reading may reach the rail, and the reason
       it is here rather than in the .then() above: a rail that rewrites
       itself mid-sentence is worse than one that never changes, and the
       founder cannot act on it before this line anyway.

       `semanticApplied` is set BEFORE the work, so a result resolving in
       the same tick as this check cannot be applied twice.

       Not ready, failed, shed, or arriving after this point: the rail stays
       exactly as refreshRail() left it -- the deterministic-only reading
       the engine already produces when no model runs at all. */
    if (!semanticApplied && semanticBuffer && semanticBuffer.relevance
      && !(run.state && run.state.ended) && run.phase !== 'ended') {
      semanticApplied = true;
      run.relevance = semanticBuffer.relevance;
      /* `run.semanticItems` used to be assigned here and was read by
         nothing, repo-wide. WP9 is closed by evidence-based deferral rather
         than pending, so the field was not waiting for a consumer -- it was
         implying one that does not exist. The items are still returned by
         the server and still stored in the WP8 sidecar; only the dead
         client copy is gone. */
      turn.timing.semanticAppliedAt = Date.now();
      refreshRail();
    }

    /* ── THE FINAL LIVE RENDER BOUNDARY FOR THIS TURN ───────────────────
       await speak() can sit open far longer than TTS playback: a real
       prospect <audio> element that is PAUSED rather than ended (exactly
       what api.stop() does) never fires 'ended', so playProspectAudio's
       finish() only resolves via its own 3s-stall / 30s-hard-timeout
       ceiling. A founder who clicked End Practice mid-playback has already
       been shown the ended screen -- api.stop() sets run.phase = 'ended'
       and emits synchronously -- up to 30s before this line runs.

       Resuming here must never un-end that call. The WP8 apply-once guard
       three lines above already defends the same race for semanticApplied;
       this is the same check, extended to the two things after it that
       were missing it: the phase reassignment, and coachingRenderedAt,
       which may have been stamped earlier in this same function while the
       rail really was live. A call that ended before reaching this
       boundary never delivered that rail to a founder who could act on
       it -- absence now means absence here too. */
    if (run.phase !== 'ended') {
      run.phase = 'founder_speaking';
      turn.timing.founderReady = Date.now();
      if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.setCapture(true);
      emit();
    } else {
      turn.timing.coachingRenderedAt = null;
    }
    persistTurn(turn);
  }

  /* ── WP8: THE SEMANTIC REQUEST ─────────────────────────────────────────
     Carries the turn's NAME and nothing else. The server resolves the words
     and the offer context from the fenced turn itself, so no text or
     context this browser holds can influence what gets interpreted.

     Fails to null on every path -- refusal, shed, timeout, transport error
     -- because a missing reading and a failed one are the same thing to
     everything downstream. */
  async function askSemantics(turnId) {
    if (!run || !run.sessionId || !turnId) return null;
    try {
      var res = await Promise.race([
        V.sb.functions.invoke('live-intelligence', {
          body: { action: 'practice_semantic', sessionId: run.sessionId, turnId: turnId },
        }),
        new Promise(function (r) { setTimeout(function () { r({ timedOut: true }); }, SEMANTIC_TIMEOUT_MS); }),
      ]);
      var d = res && !res.timedOut && res.data;
      if (!d || d.ok !== true || !d.relevance) return null;
      return { relevance: d.relevance, semanticItems: d.semanticItems || null };
    } catch (e) { return null; }
  }

  /* ── THE RAIL ────────────────────────────────────────────────────────
     Derived from the same call state the review will read, so it costs
     nothing and cannot disagree with the Best Move. Recomputed after every
     turn rather than cached: what to say next changes the moment they say
     something. */
  /* ── THE RAIL REMEMBERS WHAT IT ALREADY SAID ────────────────────────
     One copy, for the length of one call. The rail itself stays pure — it
     is handed the memory and hands back the next one — so replaying the
     same turns always produces the same advice, and a call that ends takes
     its memory with it.

     Without this the rail recomputed from nothing every turn and could only
     suppress lines the founder had actually SPOKEN, so advice he read and
     chose not to take came straight back, word for word. */
  /* ── MAY LIVE ASSISTANCE BE EXPOSED AT ALL ────────────────────────────
     ONE predicate, because this question was previously answered in three
     places that could drift: the renderer checked `ended`, the reaction chip
     checked format, and the coachingRenderedAt stamp checked neither. Three
     independent readings of one fact is how a surface ends up showing what
     provenance says was never shown.

     GUIDED IS ASSISTED EXECUTION; FULL SIMULATION IS UNASSISTED. That is a
     product decision, not an inference from the rail builder being shared --
     which it is, and which is exactly why the gate has to live here rather
     than in the markup.

     Terminality belongs in the same predicate rather than beside it: a call
     that has ended has no live surface to expose anything on, whatever the
     format.

     DELIBERATELY NOT A COMPUTATION GATE. decideBestMove, the semantic read,
     state and evidence all keep running in Full Simulation -- hiding a
     surface is not a reason to stop knowing things, and the post-call review
     is built from exactly that intelligence. This governs what reaches the
     founder's screen mid-call, and what may therefore be claimed about it. */
  function liveAssistanceAllowed() {
    if (!run) return false;
    if (run.format !== 'guided') return false;
    if (run.phase === 'ended') return false;
    if (run.state && run.state.ended) return false;
    return true;
  }

  function refreshRail() {
    if (!RAIL || !run) return;
    try {
      var next = RAIL.liveGuidance({ turns: run.stateTurns || [], handoff: run.handoff || {},
        profile: run.profile || null,
        memory: run.railMemory || null,
        classification: run.lastFounderAction ? { action: run.lastFounderAction } : null,
        relevance: run.relevance || null });
      run.rail = next;
      if (next && next.memory) run.railMemory = next.memory;
    } catch (e) { run.rail = null; }
  }

  /* SIX FACTS, WRITTEN AS THEY BECOME TRUE. Fire and forget, like every other
     write in the conversation path: a dropped state row costs one record, an
     awaited one would cost the rehearsal its pace. */
  function advanceState(t) {
    if (!run) return;
    /* One list, in the shape every deterministic layer already reads. */
    run.stateTurns = (run.stateTurns || []).concat([{ sequence: t.sequence, attemptNo: t.attemptNo || 1,
      speaker: t.speaker, text: t.text, complete: t.complete !== false,
      /* CARRIED, or the rail has to guess from the words -- and a refusal
         that ends with a question back reads as a partial answer. */
      prospect_caused_withholding: t.prospectCausedWithholding === true }]);
    if (!CS) return;
    try {
      /* The state BEFORE this turn is what any rule about this turn must
         read -- a close is unearned on the qualification that existed when
         it was asked, not the one it produced. */
      run.stateBySeq[t.sequence] = JSON.parse(JSON.stringify(
        run.callState || CS.initialCallState(run.handoff || {})));
      run.groundedTurns.push(t);
      run.callState = CS.advanceCallState(run.callState || CS.initialCallState(run.handoff || {}), t);
    } catch (e) { return; }
    interpret();
    if (!run.sessionId) return;
    var s = run.callState;
    rpc('practice_call_state_set_v1', {
      p_session_id: run.sessionId,
      p_pitch_permission: s.pitchPermission.granted,
      p_pitch_permission_at_seq: s.pitchPermission.atSeq,
      p_active_objection: s.activeObjection ? s.activeObjection.kind : null,
      p_refusal_state: s.refusal.state,
      p_refusal_at_seq: s.refusal.atSeq,
      p_refusal_evidence: s.refusal.evidence,
      p_answered_questions: s.answeredQuestions,
      p_disclosed_facts: s.facts.disclosed,
      p_open_unknowns: s.facts.unknowns,
      p_qualification_level: s.qualification.level,
      p_qualification_basis: s.qualification.basis,
      p_state_version: s.version,
      p_turns_seen: s.turnsSeen,
      p_turns_ignored: s.turnsIgnored,
    });
  }

  /* ── PASS 3 ────────────────────────────────────────────────────────
     Two deterministic producers read the same grounded turns and emit
     candidate events with citations. No model, no score. Rerunning over the
     whole call is deliberate: the event id is derived from the evidence, so
     re-reading is free and only genuinely new observations are written. */
  function interpret() {
    if (!run || !RE || !RR || !CE || !AK) return;
    try {
      var stateAt = function (seq) {
        return run.stateBySeq[seq] || (CS ? CS.initialCallState(run.handoff || {}) : null);
      };
      var key = AK.buildAnswerKey(run.groundedTurns, run.handoff || {});
      var events = CE.dedupe(
        RE.runRules({ sessionId: run.sessionId, turns: run.groundedTurns, stateAt: stateAt, answerKey: key })
          .concat(RR.readReactions({ sessionId: run.sessionId, turns: run.groundedTurns })));
      run.candidateEvents = events;
      run.answerKey = key;
      /* ── PHASE 2: THIS COMPUTATION IS FOR THE RAIL, NOT FOR THE RECORD ──
         These same two producers used to write straight to
         practice_candidate_events from here, twice per exchange. Nothing
         ever read those rows, and the browser could not be a truthful
         durable authority anyway: it runs BEFORE playback finishes, so it
         cannot know whether the prospect was actually heard; it cannot be
         re-run over an old call, so an extractor upgrade could never
         reprocess anything; and it is the founder's own machine.

         Durable evidence is now derived once on the server at the
         settlement boundary, from the same producers, over turns already
         neutralised for delivery. What stays here is exactly what the rail
         needs and nothing more -- an instant, no-network read that dies
         with the page. */
    } catch (e) { /* interpretation must never cost the founder their call */ }
  }

  /* One exchange becomes two rows: what the founder said and what it cost
     them, then what the prospect said back. */
  function persistTurn(turn) {
    if (!run || !run.sessionId || !EV) return;
    var speechMs = (turn.timing && turn.timing.firstAudio && turn.timing.audioEnd)
      ? turn.timing.audioEnd - turn.timing.firstAudio : null;
    var rows;
    try {
      rows = EV.turnRecords({ turn: turn, sequence: run.seq,
        script: (run.handoff && run.handoff.script) || {},
        previous: run.prevEvidence, speechMs: speechMs });
      /* Word-level evidence belongs to the FOUNDER's row only: the prospect's
         line was synthesised from text, so it has no microphone timings and
         inventing some would be fabricating a recording. */
      var words = EV.wordRows(run.pendingWords || []);
      if (words.length) {
        rows[0].words = words;
        rows[0].audio_start_ms = words[0].s;
        rows[0].audio_end_ms = words[words.length - 1].e;
        rows[0].delivery = EV.deliveryFacts(run.pendingWords || [], { levels: run.pendingLevels || [] });
      } else if (run.audioStartSec != null && run.audioEndSec != null) {
        /* SOME TURNS ARRIVE WITHOUT A WORD ARRAY — observed on the last
           utterance before the stream closes. The utterance still has a
           start and an end, so the turn still lands on the timeline and a
           founder can still seek to it; only the per-word detail is absent.
           Losing the whole turn from the timeline would be far worse than
           losing its word breakdown. */
        rows[0].audio_start_ms = Math.round(run.audioStartSec * 1000);
        rows[0].audio_end_ms = Math.round(run.audioEndSec * 1000);
      }
      /* Evidence quality travels with the turn it describes. */
      if (run.pendingAssembly && rows[0] && rows[0].speaker === 'founder') {
        rows[0].turn_complete = run.pendingAssembly.complete === true;
        rows[0].turn_confidence = run.pendingAssembly.confidence;
        rows[0].credit_eligible = run.pendingAssembly.creditEligible === true;
        rows[0].assembly = {
          parts: run.pendingAssembly.parts, partIds: run.pendingAssembly.partIds,
          releasedBy: run.pendingAssembly.releasedBy, version: run.pendingAssembly.version,
        };
      }
      /* ── PHOENIX SPIKE 2: THE SAME DATA persistAttempt ALREADY READS ────
         `run.pendingArrivals` and the connection's `resolvedConfig` are
         computed unconditionally on every release, inside pump()'s
         recordArrivals -- but only persistAttempt (the Guided-retry-only
         path) ever read them into timing_detail. Every one of 8 real,
         ordinary calls carried none of it. Mirrored here exactly, onto the
         founder row timingDetailFor() already built -- no new computation,
         only a missed read closed on the path that actually runs on a
         normal call.

         speechChangedAt is new: the moment trackSpeech() last saw the
         interim (non-final) transcript grow. stillSpeaking() derives
         entirely from it (`(now - speechChangedAt) < SPEECH_IDLE_MS`), so
         persisting it -- with the unchanged constant beside it -- is enough
         to derive, OFFLINE, exactly how much of the release gap was the
         founder_still_speaking hold versus the settle wait that follows it.
         Read-only: decideRelease() takes none of this as an argument. */
      if (rows[0] && rows[0].speaker === 'founder' && rows[0].timing_detail) {
        var pResolvedConfig = null;
        try {
          var pSnap = window.VISION_ASSEMBLY && window.VISION_ASSEMBLY.snapshot
            && window.VISION_ASSEMBLY.snapshot();
          pResolvedConfig = (pSnap && pSnap.resolvedConfig) || null;
        } catch (e) { pResolvedConfig = null; }
        rows[0].timing_detail = Object.assign({}, rows[0].timing_detail, {
          /* v4: adds arrivals, resolvedConfig, speechChangedAt, speechIdleMs.
             Every v1 field (founderAudioEndAt, releaseAt, requestSentAt)
             keeps its name and meaning. */
          version: 'practice_turn_timing_v4',
          arrivals: run.pendingArrivals || null,
          resolvedConfig: pResolvedConfig,
          speechChangedAt: (typeof run.speechChangedAt === 'number') ? run.speechChangedAt : null,
          speechIdleMs: SPEECH_IDLE_MS,
        });
      }
      /* THE PROSPECT'S ROW OWNS IT, because that is the row the answer key
         is looking at when it decides whether the founder's question was
         ever answerable. */
      rows.forEach(function (r) {
        if (r && r.speaker === 'prospect') {
          r.prospect_caused_withholding = turn.prospectCausedWithholding === true;
        }
      });
      run.pendingWords = []; run.pendingLevels = []; run.pendingAssembly = null;
    } catch (e) { return; }
    /* When a retry already recorded this position, only the prospect's
       reply is still missing. */
    /* The coached attempt already recorded this founder line; only the
       prospect's reply is still missing. Compared on the LOGICAL TURN, not
       on a sequence number the server may since have reassigned. */
    if (run.retryAt && run.retryAt === turn.itemId) { rows = rows.slice(1); run.retryAt = null; }
    run.seq += 2;
    run.prevEvidence = { pitchPermission: turn.closePermission === true,
      activeObjection: turn.objection || null, state: turn.stateAfter || null };
    rows.forEach(function (row) {
      rpc('practice_turn_append_v1', {
        p_session_id: run.sessionId, p_sequence: row.sequence, p_speaker: row.speaker,
        p_content: row.content || '(silence)', p_founder_action: row.founder_action,
        p_state_before: row.state_before, p_state_after: row.state_after,
        p_pitch_before: row.pitch_permission_before, p_pitch_after: row.pitch_permission_after,
        p_active_objection: row.active_objection, p_events: row.detected_events,
        p_script_similarity: row.script_similarity, p_simulated_facts: row.simulated_facts,
        p_reply_source: row.reply_source, p_model_latency_ms: row.model_latency_ms,
        p_speech_ms: row.speech_ms,
        p_words: row.words || null, p_audio_start_ms: row.audio_start_ms || null,
        p_audio_end_ms: row.audio_end_ms || null, p_delivery: row.delivery || null,
        p_turn_complete: row.turn_complete == null ? null : row.turn_complete,
        p_turn_confidence: row.turn_confidence == null ? null : row.turn_confidence,
        p_credit_eligible: row.credit_eligible == null ? null : row.credit_eligible,
        p_assembly: row.assembly || null,
        /* The review pipeline scores from STORED rows, so a decision that
           never survives the write protects nobody where it counts. */
        p_prospect_caused_withholding: row.prospect_caused_withholding === true,
        /* WP1 observability only -- see practice_turn_timing_v1 in
           practice-evidence.js. Never read back by any rule or score. */
        p_timing_detail: row.timing_detail || null,
        /* WP2 observability only -- why this reply fell back, when it did.
           Never read back by any rule or score. */
        p_model_reason: row.model_reason || null,
        /* WP3: the logical turn both of these rows belong to. In a reserved
           session the server derives `sequence` from this and ignores the
           value computed above; in a legacy session it is stored as
           correlation data and changes nothing. */
        p_turn_id: turn.itemId || null,
      });
    });
  }

  function lastProspect() {
    for (var i = run.history.length - 1; i >= 0; i -= 1) {
      if (run.history[i].speaker === 'prospect') return run.history[i].text;
    }
    return null;
  }

  function chooseVoice() {
    if (run.voice) return run.voice;
    if (!window.speechSynthesis || !window.VISION_VOICE) return null;
    run.voice = window.VISION_VOICE.pickBrowserVoice(window.speechSynthesis.getVoices() || []);
    return run.voice;
  }

  /* ONE VALIDATED REPLY, ONE UTTERANCE. Keyed on the founder turn id, so a
     repeated event, a re-render or a reconnect cannot make the prospect say
     the same thing twice. */
  /* ── THE PROSPECT'S ACTUAL VOICE ──────────────────────────────────────
     The server generates the reply as speech and returns the bytes on the
     same response — one TTS call per turn, already paid for. This used to
     read `d.audio` only to record its size and price, and then spoke the
     line through window.speechSynthesis instead. So VISION bought a chosen,
     consistent professional voice on every single turn, threw the audio
     away, and gave the founder whatever voice their operating system
     happened to have — or, on a machine with no speech service, silence.

     The browser voice remains, as the FALLBACK it always should have been:
     a TTS failure is a presentation failure and the rehearsal continues. */
  function playProspectAudio(turn, audio, entry, done) {
    if (!audio || !audio.base64 || typeof window.Audio !== 'function') return false;
    var el;
    try {
      el = new window.Audio('data:' + (audio.mime || 'audio/mpeg') + ';base64,' + audio.base64);
    } catch (e) { return false; }
    /* Muted, not paused: the element still plays start to finish on its own
       clock, so `ended` still fires at the real time and the turn still
       advances normally. Pausing would freeze the conversation instead of
       silencing it. */
    el.muted = !!run.speakerMuted;
    run.audioEl = el;
    var settled = false;
    var finish = function (why) {
      if (settled) return;
      settled = true;
      try { el.pause(); } catch (e) { /* already stopped */ }
      if (run.audioEl === el) run.audioEl = null;
      done(why);
    };
    el.addEventListener('playing', function () {
      entry.startedAt = Date.now();
      entry.source = 'prospect_voice';
      turn.timing.firstAudio = entry.startedAt;
    });
    el.addEventListener('ended', function () { finish(null); });
    el.addEventListener('error', function () { finish('prospect_audio_error'); });
    var p;
    try { p = el.play(); } catch (e) { return false; }
    /* AUTOPLAY CAN BE REFUSED. The founder pressed Start, so this is a
       gesture-initiated session and it normally is not — but if it is, the
       browser voice still has to say the line. */
    if (p && typeof p.catch === 'function') {
      p.catch(function () { finish('prospect_audio_blocked'); });
    }
    /* A stalled element must never hold the conversation open. */
    setTimeout(function () { if (!entry.startedAt) finish('prospect_audio_stalled'); }, 3000);
    setTimeout(function () { finish('prospect_audio_timeout'); }, 30000);
    return true;
  }

  function speak(turn, audio) {
    return new Promise(function (resolve) {
      if (run.spoken[turn.itemId]) { resolve(); return; }
      run.spoken[turn.itemId] = true;

      var synth = window.speechSynthesis;
      var entry = { turnId: turn.itemId, requestedAt: Date.now(), startedAt: null, endedAt: null,
        error: null, source: null };
      run.speechLog.push(entry);

      /* THE REAL VOICE FIRST. Only if it cannot start at all does the browser
         say the line, and the founder is told which one they heard. */
      var settledOnce = false;
      var finishOuter = function (why) {
        if (settledOnce) return;
        settledOnce = true;
        entry.endedAt = Date.now();
        turn.spoke = !!entry.startedAt;
        turn.timing.audioEnd = entry.endedAt;
        /* PHASE 1 FINALIZATION: audioEnd gets a timestamp whether playback
           finished naturally or was cut off (a cancel, a stall, the 30s
           hard-timeout after api.stop() pauses a real <audio> element
           without ever firing 'ended') -- indistinguishably, until now. why
           is the one fact that tells them apart: null only on a genuine
           'ended'/onend event. Scoring must never present a cut_short or
           never_started prospect line as founder-heard content merely
           because its row exists. */
        turn.timing.audioDeliveryOutcome = why
          ? (entry.startedAt ? 'cut_short' : 'never_started') : 'completed';
        if (why) { entry.error = why; run.errors.push('speech:' + why); }
        resolve();
      };
      if (playProspectAudio(turn, audio, entry, function (why) {
        /* Started and finished on the real voice: done. Never started: fall
           through to the browser so the line is still heard. */
        if (entry.startedAt) { finishOuter(why); return; }
        entry.error = why || 'prospect_audio_unavailable';
        run.errors.push('speech:' + entry.error);
        browserSpeak(turn, entry, finishOuter);
      })) return;

      if (turn.ttsError) {
        /* Recorded so the surface can say the prospect has no voice today
           rather than letting the founder assume this is how it sounds. */
        run.errors.push('speech:prospect_voice_' + turn.ttsError);
      }
      browserSpeak(turn, entry, finishOuter);
    });
  }

  function browserSpeak(turn, entry, finishOuter) {
    return (function (resolve) {
      var synth = window.speechSynthesis;

      if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') {
        run.errors.push('speech_unsupported');
        resolve('speech_unsupported');
        return;
      }

      var u = new window.SpeechSynthesisUtterance(turn.reply);
      var v = chooseVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      var settings = window.VISION_VOICE
        ? window.VISION_VOICE.utteranceSettingsFor(turn.tone) : { rate: 1, pitch: 1, volume: 1 };
      u.rate = settings.rate; u.pitch = settings.pitch; u.volume = settings.volume;

      var finished = false;
      var done = function (why) {
        if (finished) return;
        finished = true;
        resolve(why || null);
      };
      u.onstart = function () {
        entry.startedAt = Date.now();
        entry.source = entry.source || 'browser_voice';
        turn.timing.firstAudio = entry.startedAt;
      };
      u.onend = function () { done(null); };
      u.onerror = function (e) { done((e && e.error) || 'speech_error'); };

      turn.timing.speakCalledAt = Date.now();
      try { synth.speak(u); } catch (e) { done('speak_threw'); return; }

      /* A headless browser has no speech service, and a stuck utterance must
         never hold the conversation open. Presentation failure, nothing more:
         the reply and the state are already decided. */
      setTimeout(function () { if (!entry.startedAt) done('no_audio_available'); }, 2500);
      setTimeout(function () { done('speech_timeout'); }, 25000);
    }(finishOuter));
  }

  api.stop = function () {
    if (run && run.settleTimer) { clearTimeout(run.settleTimer); run.settleTimer = null; }
    if (run && run.carriedTimer) { clearTimeout(run.carriedTimer); run.carriedTimer = null; }
    if (!run) return;
    run.phase = 'ended';
    /* Nothing keeps talking after the call ends — including the prospect's
       own voice, which is an <audio> element and ignores speechSynthesis. */
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
    try { if (run.audioEl) { run.audioEl.pause(); run.audioEl = null; } } catch (e) {}
    if (window.VISION_ASSEMBLY) window.VISION_ASSEMBLY.stop({ status: 'completed' });
    /* The outcome the ENGINE reached, not a verdict this file invented. */
    var last = run.turns.length ? run.turns[run.turns.length - 1] : null;
    if (run.recordAudio) finaliseAudio(run.sessionId, run.startedAt);
    if (run.sessionId) scoreSession(run.sessionId);
    if (run.sessionId) {
      rpc('practice_session_finish_v1', {
        p_session_id: run.sessionId,
        p_outcome: (last && last.outcome) || null,
        p_duration_ms: run.startedAt ? Date.now() - run.startedAt : null,
      });
    }
    emit();
  };

  /* One seam for the voice-playback suite: take a single prospect turn with
     the transport stubbed, so which voice actually plays can be asserted
     against the shipping file rather than a copy of it. */
  /* TEST SEAM ONLY — no production caller (pump() and handleRetry() both
     pass their own item id and never route through here). `itemId` became
     an explicit parameter because it flows straight to the server as the
     WP3 reservation turn id: hardcoding it made every turn after the first
     reuse one already-completed reservation and get a REPLAY instead of a
     generation, so a multi-turn test conversation was impossible. Omitting
     the argument keeps the previous constant, so a one-argument call is
     byte-identical to what it always did. */
  api.__takeTurnForTest = function (text, itemId) { return takeTurn(text, itemId || 'test-item'); };

  /* The session id, so a harness can read back exactly what was written and
     then delete it. Nothing in the conversation reads this. */
  api.sessionId = function () { return run ? run.sessionId : null; };
  api.audioState = function () { return run ? run.audioState : null; };
  api.scoring = function () { return run ? run.scoring : null; };
  api.callState = function () { return run ? run.callState : null; };
  api.candidateEvents = function () { return run ? run.candidateEvents.slice() : []; };
  api.answerKey = function () { return run ? run.answerKey || null : null; };

  /* ── SCORING HAPPENS AFTER THE CALL, FROM THE PERSISTED EVIDENCE ─────
     Not from memory: the score is computed from exactly the rows a reviewer
     would later read, so what the founder is told and what the evidence says
     can never drift apart. Nothing here runs during the conversation, so it
     cannot cost the rehearsal a millisecond. */
  async function scoreSession(sessionId) {
    if (!V || !V.sb) return;
    var t0 = Date.now();
    if (run) run.scoring = { state: 'reviewing', startedAt: t0 };
    emit();
    try {
      /* The turn appends are fire-and-forget; give the last ones a moment. */
      await new Promise(function (r) { setTimeout(r, 900); });
      /* ASK, DO NOT DECIDE. The browser no longer computes the score: it
         requests one, and the server reads the founder's own persisted
         evidence and applies the rubric. There is no client-callable write,
         so a browser cannot submit a number of its own. */
      /* THE PROSPECT GOES WITH THE REQUEST. Without it the server scored the
         call against an empty handoff, and the only alternatives it could
         offer a founder were the fixed ones in the correction table — which
         is how a chartered-accountancy call about month-end reconciliation
         came back advising "Are you actually looking to bring in more of
         that right now?" on all three cards.

         PHRASING ONLY, and the server treats it that way: the handoff shapes
         which question to suggest, never whether a mistake happened, never
         a score, never evidence. Same rule the communication profile
         already follows. */
      var res = await V.sb.functions.invoke('live-intelligence', {
        body: { action: 'practice_score', sessionId: sessionId,
          handoff: run ? (run.handoff || null) : null },
      });
      var d = res && res.data;
      if (run) {
        run.scoring = (d && d.ok)
          ? { state: 'ready', ms: Date.now() - t0, rubricVersion: d.rubricVersion }
          : { state: 'failed', ms: Date.now() - t0 };
      }
    } catch (e) {
      if (run) run.scoring = { state: 'failed', ms: Date.now() - t0 };
    }
    emit();
  }

  /* Upload, then register. Registration re-checks consent server-side, so an
     object that was never permitted stays unreferenced rather than becoming
     a recording nobody agreed to. */
  async function finaliseAudio(sessionId, startedAt) {
    var blob = null;
    try { blob = await window.VISION_ASSEMBLY.stopRecording(); } catch (e) { blob = null; }
    if (!blob || !sessionId || !V || !V.sb) { if (run) run.audioState = 'failed'; return; }
    try {
      var uid = (await V.sb.auth.getUser()).data.user.id;
      var ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
      var path = uid + '/' + sessionId + '.' + ext;
      var up = await V.sb.storage.from('practice-audio')
        .upload(path, blob, { contentType: blob.type, upsert: true });
      if (up.error) { if (run) run.audioState = 'failed'; return; }
      var reg = await V.sb.rpc('practice_recording_register_v1', {
        p_session_id: sessionId, p_storage_path: path,
        p_duration_ms: startedAt ? Date.now() - startedAt : null,
        p_bytes: blob.size, p_mime: blob.type,
      });
      var d = reg && reg.data;
      if (run) run.audioState = (d && d.ok) ? 'stored' : 'failed';
      /* Registration refused means nobody consented — remove the bytes. */
      if (!(d && d.ok)) { try { await V.sb.storage.from('practice-audio').remove([path]); } catch (e) {} }
    } catch (e) { if (run) run.audioState = 'failed'; }
  }
})(window.VISION);
