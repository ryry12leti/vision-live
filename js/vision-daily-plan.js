/* ═══════════════════════════════════════════════════════════════
   vision-daily-plan.js — the single client for the DEPLOYED daily-plan contract
   ---------------------------------------------------------------
   The browser does not own the daily plan. Supabase does. This module is the
   only place that speaks to the deployed generate-tasks Edge Function and the
   deployed goal-engine-diagnostic Edge Function, and it exposes ONE honest
   state object that every page renders from.

   Why this module exists
   ----------------------
   The previous client spoke a contract that no longer exists on the server:

     • it sent reason:'auto_daily' / 'manual_retry'. generate-tasks validates
       reason against {auto, manual_refresh, onboarding_complete,
       onboarding_redo, rolling_topup, owner_test} and answers
       400 invalid_generation_reason before doing any work.
     • it sent {mode:'topup'} from the browser, which the function answers
       403 internal_generation_required (topup is service-role only).
     • it then re-persisted the returned tasks itself via set_daily_plan_*,
       even though the function already wrote them server-side and returned
       the real rows.
     • it treated a 409 as failure. A 409 from the generation gate is not a
       failure: it is the server saying "answer one diagnostic question first"
       and handing back the exact question to ask.

   Contract notes verified against the deployed function
   -----------------------------------------------------
   Request  : { reason, date? , force?, idempotency_key? }
   Success  : { ok:true, persisted, idempotent?, tasks[], active_task_id,
                generation_id, target_date, mode, source, generation_policy }
   Blocked  : 409 { ok:false, blocked:true, error:'clarification_required',
                    generation_gate, diagnostic:{ question, answer_endpoint } }
   Busy     : 409 { ok:false, error:'generation_in_flight', retry_after_ms }
   Resolved : 409 { ok:false, error:'outcome_resolved_regenerate_required',
                    regenerate_required:true, regenerate_reason,
                    outcome_resolution:{ committed:true, state, outcome_id } }
   Rejected : 400 { ok:false, error:'invalid_generation_reason' | ... }

   The server persists. This module never writes a task row.

   Public API: window.VISION.dailyPlan
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  /* Mirrors the deployed allowlist exactly. Anything not in here is a client
     bug and must fail loudly here rather than as an opaque 400 from the edge. */
  var SERVER_REASONS = [
    'auto', 'manual_refresh', 'onboarding_complete', 'onboarding_redo',
    'rolling_topup', 'owner_test'
  ];
  /* rolling_topup and owner_test are service-role only — the browser may not
     send them, so the browser-callable subset is smaller than the allowlist. */
  var BROWSER_REASONS = ['auto', 'manual_refresh', 'onboarding_complete', 'onboarding_redo'];

  var listeners = [];
  var inflight = null;

  /* The one state every page renders. No page may invent a task, a Professional
     Standard, an expert or a proof requirement that is not in `tasks` here. */
  var state = {
    status: 'idle',      /* idle | loading | generating | ready | empty | clarification_required | error */
    date: null,          /* the server's target_date once known */
    tasks: [],           /* real daily_tasks rows, mapped */
    activeTaskId: null,
    primaryTask: null,
    secondaryTask: null,
    question: null,      /* { id, text, reason } when status==='clarification_required' */
    error: null,         /* { code, message, retryable, requestId } */
    source: null         /* server-reported provenance of the current plan */
  };

  function emit() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { /* one bad listener must not stall the page */ }
    }
  }
  function set(patch) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) state[k] = patch[k];
    try { document.documentElement.setAttribute('data-plan-state', state.status); } catch (e) {}
    emit();
  }

  function sb() { return V.sb || null; }

  /* ───────── honest error model ───────── */

  /* Every failure the user can see carries a code, a readable message, whether
     retrying could help, and the correlation id the server gave us. Nothing is
     summarised into "Backend not connected". */
  var MESSAGES = {
    not_authenticated:            'Sign in to load your plan.',
    profile_required:             'Finish onboarding before your plan can be built.',
    goal_required:                'Set your goal before your plan can be built.',
    generation_in_flight:         'Your plan is already being built. This will finish shortly.',
    rate_limited:                 'You have used today’s plan refreshes.',
    invalid_generation_reason:    'This build sent a request the server no longer accepts.',
    invalid_generation_mode:      'This build sent a request the server no longer accepts.',
    invalid_generation_request:   'This build sent a request the server no longer accepts.',
    internal_generation_required: 'That kind of generation can only be started by the server.',
    invalid_date:                 'The date sent with this request was not valid.',
    generation_failed:            'The plan engine could not finish. Try again.',
    origin_not_allowed:           'This site is not allowed to reach the plan engine.',
    service_unavailable:          'The plan engine is not available right now.',
    unauthorized:                 'Your session expired. Sign in again.',
    network_failed:               'Could not reach the plan engine.',
    /* Real gate states from goal_engine_generation_gate_v1 that are not the
       clarification_required question flow. These are normal "still setting
       up your goal engine" states, not failures — retryable is what lets the
       dashboard keep offering Retry instead of dead-ending on a raw code. */
    lifecycle_not_active:         'Your goal plan is still being set up. Try again in a moment.',
    milestone_plan_required:      'Your first milestones are still being created. Try again in a moment.',
    active_milestone_required:    'Your plan engine is finishing your current milestone. Try again in a moment.'
  };
  var RETRYABLE = [
    'generation_in_flight', 'generation_failed', 'network_failed',
    'service_unavailable', 'generation_context_stale', 'generation_gate_changed',
    'lifecycle_not_active', 'milestone_plan_required', 'active_milestone_required'
  ];

  function planError(code, status, payload) {
    var c = String(code || 'generation_failed');
    return {
      code: c,
      message: MESSAGES[c] || ('The plan engine returned: ' + c),
      retryable: RETRYABLE.indexOf(c) > -1 || status === 429 || status === 503 || status === 504 || status === 0,
      requestId: (payload && (payload.generation_id || payload.run_id)) || null,
      status: status || 0
    };
  }

  /* ───────── dates ───────── */

  /* The server derives "today" from profiles.timezone with
     Intl.DateTimeFormat('en-CA', { timeZone }). Mirroring that exactly is what
     stops the client reading a different day than the server just wrote. */
  function dateIn(timezone) {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone || undefined, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      var get = function (t) { var p = null; for (var i = 0; i < parts.length; i++) if (parts[i].type === t) p = parts[i].value; return p; };
      var y = get('year'), m = get('month'), d = get('day');
      if (y && m && d) return y + '-' + m + '-' + d;
    } catch (e) { /* invalid tz — fall through to device local */ }
    var n = new Date();
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate());
  }

  /* ───────── goal integrity ─────────
     A task is only as good as the goal it was generated from. A corrupted goal
     ("bodybuilding;ding" — a truncated word re-joined to its own tail) reads as
     valid text to the server, so the engine happily builds a real-looking task
     around nonsense. Catch it before generating and say what is wrong, rather
     than spending a generation and showing the user a confident wrong task.

     These detect CORRUPTION, not informality: "i need to gain muscle" is a fine
     goal. Only structural damage is rejected. */
  function goalProblem(goal) {
    var g = String(goal == null ? '' : goal).trim();
    if (!g) return 'missing';
    if (g.length < 3) return 'too_short';
    /* Semicolon/pipe/null joins: a delimiter that survived a bad concat or split. */
    if (/[;|\u0000]/.test(g)) return 'delimiter';
    /* A word immediately followed by its own trailing fragment, e.g.
       "bodybuilding;ding" once the delimiter is stripped, or "runningning". */
    if (/\b(\w{4,})\1?(\w{2,})\2\b/i.test(g.replace(/[;|]/g, ''))) return 'duplicated_fragment';
    /* Mojibake / replacement characters from a bad encoding round-trip. */
    if (/[�]/.test(g)) return 'encoding';
    /* Raw JSON or object stringification leaking into the goal field. */
    if (/^[\[{]|\[object |undefined|^null$/i.test(g)) return 'not_text';
    return null;
  }
  var GOAL_PROBLEM_MESSAGE = {
    missing: 'Your goal is empty, so there is nothing to build a task from. Set it in your profile.',
    too_short: 'Your goal is too short to build a task from. Set it in your profile.',
    delimiter: 'Your saved goal looks corrupted (it contains a stray separator). Re-enter it in your profile before generating a task.',
    duplicated_fragment: 'Your saved goal looks corrupted (part of a word is repeated). Re-enter it in your profile before generating a task.',
    encoding: 'Your saved goal contains unreadable characters. Re-enter it in your profile before generating a task.',
    not_text: 'Your saved goal was not stored as readable text. Re-enter it in your profile before generating a task.'
  };

  /* Read the goal the SERVER holds — the same row generate-tasks reads. */
  async function serverGoal() {
    try {
      var r = await sb().from('profiles').select('main_goal,goal_domain').limit(1).maybeSingle();
      if (r && r.data) return r.data.main_goal || r.data.goal_domain || '';
    } catch (e) {}
    return '';
  }

  var cachedTimezone;
  async function planDate() {
    if (cachedTimezone === undefined) {
      cachedTimezone = null;
      try {
        var r = await sb().from('profiles').select('timezone').limit(1).maybeSingle();
        if (r && r.data && r.data.timezone) cachedTimezone = r.data.timezone;
      } catch (e) { /* keep null → device local date */ }
    }
    return dateIn(cachedTimezone);
  }

  /* ───────── reading the real rows ───────── */

  function mapRow(t) {
    return {
      id: t.id,
      title: t.title,
      description: t.description || '',
      difficulty: t.difficulty || 'medium',
      basePoints: t.task_value != null ? t.task_value : (t.base_xp != null ? t.base_xp : null),
      goalRole: t.goal_role || null,
      status: t.status || null,
      activationStatus: t.activation_status || null,
      why: t.why || '',
      whyPersonalised: t.why_personalised || '',
      helps: t.helps || '',
      steps: Array.isArray(t.steps) ? t.steps : [],
      estMinutes: t.normalized_est_minutes != null ? t.normalized_est_minutes : t.est_minutes,
      proofPrompt: t.proof_prompt || '',
      proofMustShow: t.proof_must_show || '',
      proofRejectIf: t.proof_reject_if || '',
      mistakeToAvoid: t.mistake_to_avoid || '',
      recommendedProofType: t.recommended_proof_type || null,
      proofContract: t.proof_contract_v3 || t.proof_contract || null,
      taskSource: t.task_source || null,
      recordOrigin: t.record_origin || null,
      sequencePosition: t.sequence_position,
      milestoneId: t.milestone_id || null,
      /* Carried so the Professional Standard and the evidence-batch reference
         survive a reload. The columns exist and are written
         (20260806090000_founder_mission_intent_persistence_v1), and readRows
         already selects '*', but this mapper dropped both -- so the dashboard,
         which reads `missionIntent`, only ever saw them on the in-memory
         generate-tasks response. They appeared on the day a task was generated
         and vanished on refresh, which reads as a rendering bug rather than the
         mapping gap it is. */
      missionIntent: t.mission_intent || null,
      contextAnchors: t.context_anchors || null,
      date: t.date
    };
  }

  /* Server rows only. There is deliberately no localStorage read anywhere in
     this module — a task that is not in daily_tasks does not exist. */
  async function readRows(date) {
    var r = await sb().from('daily_tasks').select('*').eq('date', date)
      .order('sequence_position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (r.error) throw planError('read_failed', 0, null);
    return (r.data || []).map(mapRow);
  }

  /* The plan the user is allowed to act on today. Archived rows are history. */
  function actionable(tasks) {
    return tasks.filter(function (t) {
      return t.activationStatus !== 'archived' && t.status !== 'archived';
    });
  }

  function applyTasks(tasks, date, extra) {
    var live = actionable(tasks);
    var primary = null, secondary = null;
    for (var i = 0; i < live.length; i++) {
      if (live[i].goalRole === 'secondary' && !secondary) secondary = live[i];
      else if (!primary) primary = live[i];
    }
    /* goal_role is only set by newer generations. With one visible move the
       first actionable row IS the primary move — but never guess a secondary. */
    var activeId = (extra && extra.activeTaskId) || null;
    if (!activeId) {
      for (var j = 0; j < live.length; j++) {
        if (live[j].activationStatus === 'active') { activeId = live[j].id; break; }
      }
    }
    if (!activeId && primary) activeId = primary.id;

    set({
      status: live.length ? 'ready' : 'empty',
      date: date,
      tasks: live,
      activeTaskId: activeId,
      primaryTask: primary,
      secondaryTask: secondary,
      question: null,
      error: null,
      source: (extra && extra.source) || state.source
    });
    return state;
  }

  /* ───────── the deployed edge functions ───────── */

  async function invoke(slug, body) {
    var client = sb();
    if (!client) return { status: 0, payload: null, error: planError('service_unavailable', 0, null) };
    var res;
    try {
      res = await client.functions.invoke(slug, { body: body });
    } catch (e) {
      return { status: 0, payload: null, error: planError('network_failed', 0, null) };
    }
    /* supabase-js puts a non-2xx body on res.error.context, not res.data, so a
       structured 409 would otherwise be thrown away as a bare "non-2xx" string. */
    if (res && res.error) {
      var ctx = res.error.context, status = (ctx && ctx.status) || 0, payload = null;
      if (ctx && typeof ctx.json === 'function') {
        try { payload = await ctx.json(); } catch (e2) { payload = null; }
      }
      return { status: status, payload: payload, error: null };
    }
    return { status: 200, payload: (res && res.data) || null, error: null };
  }

  /* A 409 carrying a diagnostic is the server's recovery path, not a failure. */
  function readDiagnostic(payload) {
    var d = (payload && (payload.diagnostic ||
            (payload.generation_gate && payload.generation_gate.diagnostic))) || null;
    var q = d && d.question;
    if (!q || !q.question_id) return null;
    return {
      id: q.question_id,
      text: q.question_text || '',
      reason: q.question_reason || '',
      informationKey: q.information_key || null
    };
  }

  /* ───────── Founder engine clarification ─────────
     generate-tasks' Founder route answers a 409 in a completely different
     shape from the legacy goal_engine_generation_gate_v1 diagnostic above:
       { ok:false, needs_clarification:true, error:'more_information_required',
         clarification_questions:[ "..." ] }
     — a plain array of question TEXT, no question_id, no generation_gate.
     readDiagnostic() above can never match it (payload.diagnostic and
     payload.generation_gate are both undefined here), so every Founder
     clarification fell through to the generic "Your plan could not be built"
     message instead of the question form that already existed for the
     legacy gate.

     The question text is not arbitrary: founder-execution-context/
     clarification.js draws it from a fixed, small vocabulary
     (CLARIFICATION_QUESTION_BY_MISSING_FACT in
     js/goal-engine/founder-execution-context/contract.js) tied 1:1 to a real
     ALLOWED_CORRECTION_FIELDS fact key on the venture. Map exactly those
     known strings to the fact key that answers them — never a guess, never a
     new fact key invented client-side. A question this table does not
     recognise (e.g. the resource/route-coverage fallback in
     founder-mission-comparison/todays-move.js, which no fact can resolve)
     intentionally falls through to the existing generic message rather than
     offering an answer box that could not actually fix anything. */
  var FOUNDER_QUESTION_FACT_KEY = {
    /* TWO facts, one question. founder-execution-context/clarification.js:23
       returns this exact text for a missing `offerPricing` AND it is the text
       for `offer` in CLARIFICATION_QUESTION_BY_MISSING_FACT, so the engine
       emits it in both cases and the string alone cannot say which is missing.
       Mapping it to either single key loops forever on the other, and BOTH
       loops have now been hit on staging: it was 'offer' (offerPricing stayed
       unknown), was changed to 'offerPricing', and a founder whose snapshot was
       missing `offer` -- a CRITICAL_SECTION -- then answered it three times
       against missing_critical_context ["completedWork","offer","targetCustomer",
       "unfinishedWork"] with nothing changing.
       The question genuinely asks for both ("what is your core offer, what do
       you charge for"), so its answer legitimately satisfies both, and the
       founder's own words are stored under each -- nothing is invented. The
       real repair is for the engine to send the fact key rather than have the
       client infer it from a string; until the contract carries that, a
       question may name every fact it asks about. */
    'What is your core offer (what do you charge for, or plan to)?': ['offer', 'offerPricing'],
    'Who are your current or target customers, and what evidence do you have of demand?': 'customerEvidence',
    'What work is still unfinished on your product or service right now?': 'unfinishedWork',
    'What is the single most important thing you are trying to achieve right now?': 'immediateGoal',
    /* Critical context the bottleneck assessment needs before it can trust any
       constraint, and the conflict question. All three are real
       ALLOWED_CORRECTION_FIELDS keys, so they answer through intake_confirm's
       `corrections` -- which records a user_manual_update (user_confirmed)
       fact. That trust level is the point, not an accident: only a STRICTLY
       higher-trust fact retires the two disagreeing provisional `idea` facts
       (see decision-core retireConflictsResolvedBy), and only user_confirmed
       facts lift the venture past the confidence gate. Routing any of these
       through intake_clarify instead would write a provisional fact, leave the
       conflict standing, and re-ask the same question forever. */
    'We have two different descriptions of your business on record. Which one is right?': 'idea',
    'We have two different descriptions of your offer on record. Which one is right?': 'offer',
    'We have two different target customers on record. Which one is right?': 'targetCustomer',
    'Who is your target customer?': 'targetCustomer',
    'What have you completed so far?': 'completedWork',
    /* Answered by CONFIRMING one already-recorded prospect, not by writing a
       correction -- see confirmOneReachableProspect(). */
    'Which of your prospects can you actually reach today? Name one you know is real and reachable.': 'customerEntities',
    /* NOT from founder-execution-context/clarification.js's vocabulary --
       this one comes from the separate, post-selection
       js/goal-engine/founder-decision-service/task-quality-gate.js (see its
       CHANNEL_QUESTION). It never affects which task the engine selects;
       it only fills in HOW the founder carries out the task already chosen,
       via the same intake_confirm correction path (outreachChannel is in
       ALLOWED_CORRECTION_FIELDS). */
    'How will you reach them: call, text, email, or in person?': 'outreachChannel'
  };

  /* The engine's LAST-RESORT questions interpolate the bottleneck's own label
     ("...on product/delivery right now?"), so they can never appear in an
     exact-text map. They were therefore unmapped, and an unmapped text renders
     as a STATEMENT with no answer box -- leaving the founder with nothing to do
     at exactly the moment the engine had nothing to give them.
     Every one of these asks the same thing: what is in your way. That is
     unfinishedWork, which the bottleneck assessment, the delivery mission and
     the work-item flow all read -- so answering genuinely re-drives the next
     generation rather than being filed somewhere nothing looks. */
  var FOUNDER_QUESTION_PREFIX_FACT_KEY = [
    { prefix: 'What is blocking progress on ', factKey: 'unfinishedWork' },
    { prefix: 'What is the single most important thing blocking progress', factKey: 'unfinishedWork' }
  ];

  function resolveFounderQuestionFactKeys(text) {
    var exact = FOUNDER_QUESTION_FACT_KEY[text];
    if (exact) return Array.isArray(exact) ? exact : [exact];
    for (var i = 0; i < FOUNDER_QUESTION_PREFIX_FACT_KEY.length; i += 1) {
      if (text.indexOf(FOUNDER_QUESTION_PREFIX_FACT_KEY[i].prefix) === 0) {
        return [FOUNDER_QUESTION_PREFIX_FACT_KEY[i].factKey];
      }
    }
    return null;
  }

  /* ONE RELEASE of overlap. The server now sends clarification_questions_v2:
     [{ id, factKeys, question }] -- the question's stable id and the fact keys
     its answer writes, decided by the engine that asked it. Everything below
     this function is unchanged: routing still keys on factKeys, so a v2 payload
     produces byte-identical behaviour to the text tables it replaces (asserted
     case by case in scripts/qa-founder-daily-plan-clarification.mjs).

     The text tables stay for this release only, for the window where a browser
     holding this file talks to a generate-tasks deployment that predates the v2
     field. When the deployment is confirmed everywhere, FOUNDER_QUESTION_FACT_KEY,
     FOUNDER_QUESTION_PREFIX_FACT_KEY and resolveFounderQuestionFactKeys are
     deleted -- they are the last place a question's meaning is recovered from
     its English wording. */
  function readFounderQuestionV2(payload) {
    var v2 = payload.clarification_questions_v2;
    if (!Array.isArray(v2) || !v2.length) return null;
    var entry = v2[0];
    if (!entry || typeof entry.question !== 'string' || !entry.question) return null;
    if (typeof entry.id !== 'string' || !entry.id) return null;
    if (!Array.isArray(entry.factKeys)) return null;
    return entry;
  }

  function readFounderDiagnostic(payload) {
    if (!payload || payload.needs_clarification !== true) return null;
    var questions = payload.clarification_questions;
    if (!Array.isArray(questions) || !questions.length) return null;

    var v2 = readFounderQuestionV2(payload);
    if (v2) {
      /* factKeys: [] is the server STATING that nothing can be answered here
         (bottleneck_tie_break, unsupported_target) -- the same outcome the
         unmapped-text branch below produces, but declared rather than inferred
         from a lookup miss. */
      return {
        id: v2.factKeys[0] || null,
        /* The stable question id, carried for diagnostics and for the future
           answer-by-id path. `id` deliberately stays the first FACT key: it is
           what answerQuestion()'s caller-supplied-id guard compares against,
           and changing its meaning would reject every answer submitted with an
           id the dashboard already holds. */
        questionId: v2.id,
        factKeys: v2.factKeys,
        text: v2.question,
        reason: v2.factKeys.length ? 'Your Founder venture needs this before a task can be generated.' : null,
        answerable: v2.factKeys.length > 0,
        founder: true
      };
    }

    var text = String(questions[0] || '');
    var mapped = resolveFounderQuestionFactKeys(text);
    /* An unmapped text is not a broken question -- it is VISION STATING
       something rather than asking. The venture router emits exactly that: a
       founder selling to individual people is told the business-prospect route
       does not fit their venture, which names no fact and has no answer.
       Returning null here dropped it, and the dashboard fell back to the
       generic "Your plan could not be built / more_information_required" -- so
       the one honest, specific explanation the engine produced was replaced by
       a dead error. Surfaced instead, with answerable:false so the UI shows it
       as a message and renders no answer box for a question that was never
       asked. */
    if (!mapped) {
      return {
        id: null,
        questionId: null,
        factKeys: [],
        text: text,
        reason: null,
        answerable: false,
        founder: true
      };
    }
    /* A question may name more than one fact (see the offer entry above). `id`
       stays the first key so existing identity comparisons keep working; the
       full set travels alongside it. */
    var factKeys = Array.isArray(mapped) ? mapped : [mapped];
    return {
      id: factKeys[0],
      questionId: null,
      factKeys: factKeys,
      answerable: true,
      text: text,
      reason: 'Your Founder venture needs this before a task can be generated.',
      founder: true
    };
  }

  async function callGenerate(reason, opts) {
    if (BROWSER_REASONS.indexOf(reason) === -1) {
      /* Fail here, with the real cause, instead of shipping a request the
         server will answer 400/403 to. */
      set({ status: 'error', error: planError('invalid_generation_reason', 400, null) });
      return state;
    }
    var body = { reason: reason };
    if (opts && opts.date) body.date = opts.date;
    if (opts && opts.force) body.force = true;

    set({ status: 'generating', error: null });
    var out = await invoke('generate-tasks', body);
    if (out.error) { set({ status: 'error', error: out.error }); return state; }

    var p = out.payload;

    if (out.status === 200 && p && p.ok) {
      var date = p.target_date || (opts && opts.date) || state.date;
      /* Re-read the rows rather than trusting the response shape: the DB is the
         authority and this also picks up anything the RPC set that the function
         did not echo back. */
      var rows;
      try { rows = await readRows(date); }
      catch (e) { rows = Array.isArray(p.tasks) ? p.tasks.map(mapRow) : []; }
      return applyTasks(rows, date, { activeTaskId: p.active_task_id || null, source: p.source || null });
    }

    var code = (p && p.error) || 'generation_failed';

    if (out.status === 409) {
      var founderQuestion = readFounderDiagnostic(p);
      if (founderQuestion) {
        set({
          status: 'clarification_required',
          question: founderQuestion,
          error: null,
          date: (opts && opts.date) || state.date
        });
        return state;
      }
    }

    if (out.status === 409 && (p && p.blocked)) {
      var question = readDiagnostic(p);
      if (question) {
        set({
          status: 'clarification_required',
          question: question,
          error: null,
          date: (opts && opts.date) || state.date
        });
        return state;
      }
      /* Blocked with no question to ask — say so honestly rather than pretending. */
      set({ status: 'error', error: planError(code, 409, p) });
      return state;
    }

    set({ status: 'error', error: planError(code, out.status, p) });
    return state;
  }

  /* Resolve the Active Outcome. A committed closure invalidates the run that
     served it -- the venture's state_version has moved and the thread that run
     loaded is now history -- so the server answers regenerate_required and we
     re-request ONCE.

     The retry deliberately does NOT resend the proposal: the outcome is
     already closed, so resending would only be refused, and a client that
     kept resending could not tell a refusal from a failure. It also goes
     through callGenerate, which issues a fresh request -- fresh Founder State
     and fresh state_version -- rather than reusing anything cached here.

     The closure is committed regardless of what the retry does. So a failed
     retry reports the failure WITHOUT implying the resolution was lost: the
     founder is told their outcome was recorded and only the next move is
     missing. */
  async function resolveOutcome(proposal, reason, options) {
    var opts = options || {};
    set({ status: 'generating', error: null });
    var out = await invoke('generate-tasks', {
      reason: 'auto',
      founder_outcome_resolution: { proposal: proposal, reason: reason }
    });
    var p = out.payload;

    if (out.status === 409 && p && p.regenerate_required === true) {
      var closure = p.outcome_resolution || null;
      /* Exactly one automatic regeneration. callGenerate never re-enters this
         function, so there is no path back here and no retry loop. */
      var next = await callGenerate(p.regenerate_reason, { date: opts.date });
      if (next && next.status === 'error' && closure) {
        set({
          status: 'error',
          error: 'Outcome recorded as ' + closure.state +
                 '. Building your next move failed \u2014 pull to refresh.'
        });
      }
      return state;
    }

    if (out.error) { set({ status: 'error', error: out.error }); return state; }
    /* Refused: nothing was closed and the server generated as normal. */
    if (out.status === 200 && p && p.ok) return state;
    set({ status: 'error', error: planError((p && p.error) || 'generation_failed', out.status, p) });
    return state;
  }

  /* ───────── public operations ───────── */

  /* Load today's plan. Reads the real rows first; only generates when the user
     genuinely has no plan for the day. Repeated calls therefore do not create
     duplicates and do not burn quota — and concurrent callers share one run. */
  async function load(options) {
    var opts = options || {};
    if (inflight && !opts.force) return inflight;

    inflight = (async function () {
      try {
        if (!sb()) { set({ status: 'error', error: planError('service_unavailable', 0, null) }); return state; }
        var user = null;
        try { user = V.auth && V.auth.getUser ? await V.auth.getUser() : null; } catch (e) { user = null; }
        if (!user) { set({ status: 'error', error: planError('not_authenticated', 401, null) }); return state; }

        set({ status: 'loading', error: null });
        var date = await planDate();

        if (!opts.force) {
          var rows = await readRows(date);
          if (actionable(rows).length) return applyTasks(rows, date, null);
        }

        /* Never spend a generation on a corrupted goal — the engine would return
           a confident, real-looking task built from nonsense. */
        var goal = await serverGoal();
        var problem = goalProblem(goal);
        if (problem) {
          set({
            status: 'error',
            tasks: [],
            activeTaskId: null,
            primaryTask: null,
            secondaryTask: null,
            question: null,
            error: {
              code: 'invalid_goal',
              message: GOAL_PROBLEM_MESSAGE[problem],
              retryable: false,
              requestId: null,
              status: 0,
              goalProblem: problem,
              goal: goal
            }
          });
          return state;
        }

        return await callGenerate(opts.reason || (opts.force ? 'manual_refresh' : 'auto'), {
          date: date, force: !!opts.force
        });
      } catch (e) {
        set({ status: 'error', error: (e && e.code) ? e : planError('generation_failed', 0, null) });
        return state;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  /* Answer a Founder execution-context clarification. Unlike the legacy gate,
     there is no dedicated "answer + auto-generate" endpoint for this: the real
     Founder intake API is lead-intelligence's intake_confirm action, whose
     `corrections` parameter writes exactly one ALLOWED_CORRECTION_FIELDS fact
     as a real user_manual_update ledger entry (the same mechanism the
     /founder page's own "fix it" control uses). Saving the fact does not
     generate a task by itself, so this then calls the normal load({force:true})
     path to retry generation -- which will either produce the plan or, if the
     venture still has another fact missing, surface the NEXT clarification
     question through the exact same readFounderDiagnostic() path, so a
     multi-round clarification just repeats this once per question. */
  /* Prefer intake_clarify where the fact has a real intake question id
     (QUESTION_TEXT_TO_ID in api/_lib/founder-intake-shared.mjs). That action
     runs the SAME extractor the /founder page uses, so an answer like "I have
     6 paying customers" yields a structured customerEvidence
     ({customerCount, hasPayingCustomers, evidenceType}) — which is what
     route-eligibility actually reads — and falls back to storing the raw
     answer when the extractor finds nothing.

     intake_confirm's `corrections` is the fallback for facts with no intake
     question (currently only `offer`). It is deliberately NOT the default:
     corrections shape customerEvidence/offerPricing as {notes:"..."} only
     (NOTES_SHAPED_FIELDS), which records the sentence but carries none of the
     structured fields the engine needs, so those questions would persist an
     answer and then be asked again. */
  var FOUNDER_FACT_INTAKE_QUESTION_ID = {
    unfinishedWork: 'unfinished',
    customerEvidence: 'evidence',
    immediateGoal: 'next_outcome'
  };

  /* Confirm exactly ONE already-recorded prospect.

     `confirm: ['customerEntities']` is deliberately NOT used: applyConfirmation
     in api/_lib/founder-intake-shared.mjs expands that aggregate to EVERY
     still-provisional customerEntity, which would mass-confirm leads the
     founder never vouched for. A concrete `customerEntity:<id>` passes through
     untouched, so exactly one entity is promoted to user_confirmed.

     The ids come from the intake's own understood view (intake_start), never
     from a client-side guess at the id pattern. When the founder's answer
     names one of the real prospect labels we confirm that one; otherwise we
     confirm the first still-confirmable reachable prospect, which is the only
     deterministic choice available when the labels are indistinguishable. */
  async function confirmOneReachableProspect(text) {
    /* intake_start BEGINS a new draft and requires goalText -- calling it to
       read the venture returns 400 goal_text_required. intake_confirm with an
       empty payload is the read: applyConfirmation returns the draft
       unchanged, newFactsOnly() yields nothing, and appendFacts() is a no-op.
       Verified live on staging: state_version 9 -> 9, fact rows 15 -> 15,
       venture updated_at unchanged. */
    var started = await invoke('lead-intelligence', {
      action: 'intake_confirm', confirm: [], corrections: {}, reject: []
    });
    var startPayload = started.payload;
    if (started.error || started.status !== 200 || !startPayload || startPayload.ok !== true) {
      return { ok: false, error: planError('founder_prospects_unavailable', started.status, startPayload) };
    }

    var rows = Array.isArray(startPayload.understood) ? startPayload.understood : [];
    var row = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].key === 'customerEntities') { row = rows[i]; break; }
    }
    var entities = (row && Array.isArray(row.entities)) ? row.entities : [];
    var confirmable = entities.filter(function (entity) { return entity && entity.confirmable; });
    if (!confirmable.length) {
      return { ok: false, error: planError('no_confirmable_prospect', 409, null) };
    }

    var answer = String(text || '').trim().toLowerCase();
    var chosen = null;
    for (var j = 0; j < confirmable.length; j++) {
      var label = String(confirmable[j].label || '').trim().toLowerCase();
      if (label && answer.indexOf(label) !== -1) { chosen = confirmable[j]; break; }
    }
    if (!chosen) chosen = confirmable[0];

    return {
      ok: true,
      body: {
        action: 'intake_confirm', confirm: [chosen.factKey], corrections: {}, reject: []
      }
    };
  }

  async function answerFounderQuestion(factKeyOrKeys, text) {
    var factKeys = Array.isArray(factKeyOrKeys) ? factKeyOrKeys : [factKeyOrKeys];
    var factKey = factKeys[0];
    if (factKey === 'customerEntities') {
      var prepared = await confirmOneReachableProspect(text);
      if (!prepared.ok) { set({ status: 'error', error: prepared.error }); return state; }
      var confirmOut = await invoke('lead-intelligence', prepared.body);
      if (confirmOut.error) { set({ status: 'error', error: confirmOut.error }); return state; }
      var confirmPayload = confirmOut.payload;
      if (confirmOut.status !== 200 || !confirmPayload || confirmPayload.ok !== true) {
        set({ status: 'error', error: planError((confirmPayload && confirmPayload.error) || 'founder_correction_failed', confirmOut.status, confirmPayload) });
        return state;
      }
      /* Same single regeneration contract as every other answer below. */
      return await load({ force: true, reason: 'auto' });
    }

    /* The intake_clarify shortcut only exists for questions that map to exactly
       one fact -- an intake question id answers one field. A multi-fact
       question always goes through corrections, which can name them all. */
    var questionId = factKeys.length === 1 ? FOUNDER_FACT_INTAKE_QUESTION_ID[factKey] : null;
    var body = questionId
      ? { action: 'intake_clarify', answers: [{ questionId: questionId, answerText: text }] }
      : (function () {
          var corrections = {};
          for (var i = 0; i < factKeys.length; i += 1) corrections[factKeys[i]] = text;
          return { action: 'intake_confirm', confirm: [], corrections: corrections, reject: [] };
        })();

    var out = await invoke('lead-intelligence', body);
    if (out.error) { set({ status: 'error', error: out.error }); return state; }

    var p = out.payload;
    if (out.status !== 200 || !p || p.ok !== true) {
      set({ status: 'error', error: planError((p && p.error) || 'founder_correction_failed', out.status, p) });
      return state;
    }

    return await load({ force: true, reason: 'auto' });
  }

  /* Answer the server's diagnostic question. goal-engine-diagnostic assesses the
     answer, records it, and — when the gate opens — generates the first plan
     itself and returns the generation result, so there is no second round trip
     and no window where the UI has to guess. */
  async function answerQuestion(questionId, answer) {
    var text0 = String(answer == null ? '' : answer).trim();
    if (text0.length < 2) { set({ status: 'error', error: planError('answer_required', 400, null) }); return state; }

    if (state.question && state.question.founder) {
      if (questionId && questionId !== state.question.id) {
        set({ status: 'error', error: planError('invalid_question_id', 400, null) });
        return state;
      }
      set({ status: 'generating', error: null });
      return await answerFounderQuestion(state.question.factKeys || state.question.id, text0);
    }

    var id = questionId || (state.question && state.question.id);
    if (!id) { set({ status: 'error', error: planError('invalid_question_id', 400, null) }); return state; }
    var text = text0;

    set({ status: 'generating', error: null });
    var date = state.date || await planDate();
    var out = await invoke('goal-engine-diagnostic', {
      action: 'answer', question_id: id, answer: text, date: date, auto_generate: true
    });
    if (out.error) { set({ status: 'error', error: out.error }); return state; }

    var p = out.payload;
    if (out.status !== 200 || !p || !p.ok) {
      set({ status: 'error', error: planError((p && p.error) || 'diagnostic_failed', out.status, p) });
      return state;
    }

    var gen = p.generation;
    if (gen && gen.ok) {
      var genDate = gen.target_date || p.target_date || date;
      var rows;
      try { rows = await readRows(genDate); }
      catch (e) { rows = Array.isArray(gen.tasks) ? gen.tasks.map(mapRow) : []; }
      return applyTasks(rows, genDate, { activeTaskId: gen.active_task_id || null, source: gen.source || null });
    }

    /* Answered, but the gate wants more before it will generate. Re-run the
       normal path so the next question (or the plan) comes from the server. */
    return await load({ force: true, reason: 'auto' });
  }

  /* Manual "give me a different task". Uses the reason the server actually
     accepts for a regenerate, so the 429 the user may get is the real daily
     refresh limit rather than a 400 from a dead reason string. */
  async function refresh() {
    return load({ force: true, reason: 'manual_refresh' });
  }

  /* Read-only recheck for callers polling after a generation was started
     elsewhere (own request, another tab, a server-side async run). This never
     calls generate-tasks, so repeated polling cannot spawn duplicate
     generation requests — it only notices rows that already exist. */
  async function checkForTask() {
    if (!sb()) return state;
    var user = null;
    try { user = V.auth && V.auth.getUser ? await V.auth.getUser() : null; } catch (e) { user = null; }
    if (!user) return state;

    var date = state.date || await planDate();
    var rows;
    try { rows = await readRows(date); } catch (e) { return state; }
    if (actionable(rows).length) return applyTasks(rows, date, null);
    return state;
  }

  /* Called after onboarding writes the profile. */
  async function generateFirstPlan(wasOnboarded) {
    return load({ force: true, reason: wasOnboarded ? 'onboarding_redo' : 'onboarding_complete' });
  }

  /* The real id every other surface must navigate with. Never a local id. */
  function activeTaskId() { return state.activeTaskId; }
  function activeTask() {
    if (!state.activeTaskId) return null;
    for (var i = 0; i < state.tasks.length; i++) if (state.tasks[i].id === state.activeTaskId) return state.tasks[i];
    return null;
  }

  V.dailyPlan = {
    SERVER_REASONS: SERVER_REASONS,
    BROWSER_REASONS: BROWSER_REASONS,
    state: function () { return state; },
    onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
    load: load,
    refresh: refresh,
    reload: function () { return load({ force: false }); },
    checkForTask: checkForTask,
    answerQuestion: answerQuestion,
    resolveOutcome: resolveOutcome,
    generateFirstPlan: generateFirstPlan,
    activeTaskId: activeTaskId,
    activeTask: activeTask,
    /* exposed for tests */
    goalProblem: goalProblem,
    _dateIn: dateIn,
    _mapRow: mapRow,
    _planError: planError,
    _readDiagnostic: readDiagnostic,
    _applyTasks: applyTasks
  };
})(window.VISION);