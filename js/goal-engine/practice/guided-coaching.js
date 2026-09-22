/* ════════════════════════════════════════════════════════════════════════
   GUIDED PRACTICE — when to stop the call, and what to say about it.

   A rehearsal that corrects everything teaches nothing: the founder stops
   listening to the interruptions and starts resenting them. So this fires
   rarely, only on mistakes that are SERIOUS, IMMEDIATELY CORRECTABLE and
   supported by evidence the behaviour engine already produced.

   IT DECIDES NOTHING ABOUT THE PROSPECT. The frozen engine still owns
   resistance, permission, objections and outcome. This reads that verdict
   and answers one question: is this worth stopping for?

   ONE EVENT IS DELIBERATELY ABSENT. "Ignored an important answer" is in the
   product brief and is not implemented here, because the engine's
   `ignoredAnswer` counter is declared and never incremented — there is no
   evidence behind it. Firing on a guess would interrupt a founder who did
   nothing wrong, which is the one failure this feature cannot survive.
   ══════════════════════════════════════════════════════════════════════ */

export const COACHING_FORMATS = Object.freeze(['guided', 'full_simulation']);
export const DEFAULT_FORMAT = 'guided';

/* Founder-facing wording. No engine vocabulary, no debug labels: a founder
   reads these mid-call with their mouth open, so they are short. */
export const COACHING = Object.freeze({
  unsupported_assumption: {
    headline: 'Try that again',
    hurt: 'People resist a problem they feel was put in their mouth. They defend the version of themselves you got wrong.',
    why: 'You told them something about their business that they never told you.',
    better: 'Ask instead of assuming.',
    example: 'Where are most of your new enquiries coming from at the moment?',
  },
  weak_discovery: {
    headline: 'Try that again',
    why: 'That question left them to decide what the call was about.',
    better: 'Ask about something specific you already know.',
    example: 'How is that being handled at the moment?',
  },
  objection_not_handled: {
    headline: 'Try that again',
    hurt: 'Being talked past makes people repeat themselves harder, not change their mind.',
    why: 'They told you why they would not buy, and you carried on regardless.',
    better: 'Understand the objection before you answer it.',
    example: 'What made you go that way?',
  },
  premature_pitch: {
    headline: 'Try that again',
    hurt: 'Until they have said what they want, an offer sounds like something being done to them.',
    why: 'You started selling before they gave you a reason to.',
    better: 'Find out what they actually need first.',
    example: 'Before I explain what we do — what would you want more of, if anything?',
  },
  /* THE LESSON IS ROUTING, NOT RESTRAINT. A founder who pitches the person
     who just said it is not their call has not been too pushy -- they have
     spent the offer on someone who could never accept it, and the person who
     could is now hearing about it second-hand from someone with no reason to
     sell it well. */
  non_buyer_pitch: {
    headline: 'Try that again',
    hurt: 'An offer explained to someone who cannot accept it gets repeated badly, or not at all.',
    why: 'They told you the decision was not theirs, and you made the case to them anyway.',
    better: 'Stop selling and get to the person who can say yes.',
    example: 'That makes sense — who would be the best person for me to talk to about it?',
  },
  unearned_close: {
    headline: 'Try that again',
    hurt: 'Asking for their time before they see a reason makes saying no the easy answer.',
    why: 'You asked for their time before establishing they have a problem worth solving.',
    better: 'Earn it. Find the need, then ask.',
    example: 'What would have to be true for something like this to be worth a look?',
  },
  /* ONE LESSON, TWO SHAPES. `pressure_applied` is emitted both by
     `pressure_after_refusal` and by `coercive_pressure`, which needs no
     refusal to fire -- so copy that opened "They have said no" was simply
     false on the coercion case, and the missing `hurt` line meant the pause
     bailed with `no_founder_facing_copy` and never showed at all. Written
     to be true whether or not they have refused yet. */
  pressure_after_no: {
    headline: 'Try that again',
    why: 'You pushed them to move rather than giving them a reason to.',
    hurt: 'Pressure makes no the safe answer. People push back on being pushed, '
      + 'even when the thing being offered would have suited them.',
    better: 'Drop the push and let them tell you where they actually stand.',
    example: 'Understood — what would actually have to change for this to be worth your time?',
  },
  objection_mishandled: {
    headline: 'Try that again',
    why: 'They raised a real objection and you talked past it.',
    better: 'Understand it before you answer it.',
    example: 'That is fair — what made you go that way originally?',
  },
});

export const COACHABLE_EVENTS = Object.freeze(Object.keys(COACHING));

/* Findings are addressed by eventType; this table is keyed by the founder-
   facing lesson. One mapping, kept beside the copy it selects, so a caller
   cannot quietly invent a second opinion about which lesson a fault teaches. */
export const COACHING_KEY = Object.freeze({
  weak_discovery: 'weak_discovery',
  objection_not_handled: 'objection_not_handled',
  unsupported_assumption: 'unsupported_assumption',
  pitched_without_permission: 'premature_pitch',
  unearned_close: 'unearned_close',
  pressure_applied: 'pressure_after_no',
  sold_after_do_not_contact: 'pressure_after_no',
  pitched_a_non_buyer: 'non_buyer_pitch',
});

/* ── PRACTICE FOCUS ───────────────────────────────────────────────────
   Arrives from a review's "Practise this weakness" and is a TRAINING
   PREFERENCE, nothing more. It cannot change the rubric, the prospect's
   facts, their resistance or the outcome, and it cannot buy extra
   interventions. All it does is decide which lesson gets priority when
   more than one could fire, and stop the last slot in the budget being
   spent on something the founder did not come here to work on.

   Whitelisted, because it arrives in a URL. Anything else is ignored. */
export const FOCUS_VALUES = Object.freeze({
  unsupported_assumption: { reason: 'unsupported_assumption', label: 'Stop assuming. Start confirming.' },
  premature_pitch: { reason: 'premature_pitch', label: 'Earn the pitch before you make it.' },
  objection_handling: { reason: 'objection_mishandled', label: 'Understand the objection before answering it.' },
  dead_question: { reason: null, label: 'Use what they already told you.' },
  unearned_close: { reason: 'unearned_close', label: 'Qualify before you ask for time.' },
  pressure_after_no: { reason: 'pressure_after_no', label: 'Take the no, and leave the door open.' },
});
export function resolveFocus(raw) {
  const key = String(raw || '').trim();
  return Object.prototype.hasOwnProperty.call(FOCUS_VALUES, key)
    ? { key, ...FOCUS_VALUES[key] } : null;
}

/* ── BUDGET ────────────────────────────────────────────────────────────
   A ten-minute rehearsal must not become forty corrections. */
export const MAX_INTERVENTIONS = 5;          /* per session */
export const MAX_PER_REASON = 2;             /* the same lesson, twice, at most */
export const MAX_RETRIES = 2;                /* then hint harder and move on */

export function createCoachState() {
  return { interventions: 0, byReason: {}, active: null, history: [] };
}

/* Has the prospect made a refusal the founder should have accepted? Read
   from the ENGINE's state, never from the words. */
function prospectHasDeclined(state = {}, mode = {}) {
  if (state.ended) return true;
  const threshold = typeof mode.exitThreshold === 'number' ? mode.exitThreshold : 0.75;
  return state.exitIntent >= threshold * 0.9;
}

/* WHICH MISTAKE, IF ANY. Reads the turn the frozen engine just produced. */
export function classifyMistake(turn = {}, mode = {}) {
  const action = turn.founderAction;
  const before = turn.prospectStateBefore || {};
  const after = turn.prospectStateAfter || {};

  /* Talking over a live objection outranks everything else, because the
     objection is the conversation at that moment. */
  if (before.activeObjection
    && ['pitch', 'premature_pitch', 'close_request', 'pressure'].includes(action)) {
    return 'objection_mishandled';
  }
  if (action === 'pressure' && prospectHasDeclined(before, mode)) return 'pressure_after_no';
  if (action === 'unsupported_assumption') return 'unsupported_assumption';
  /* The engine already separates an EARNED pitch from a premature one, so
     this never fires on a founder who did the work. The extra condition
     keeps it off a passing mention before any need exists. */
  if (action === 'premature_pitch' && before.pitchPermission !== true) return 'premature_pitch';
  if (action === 'close_request' && turn.closePermission !== true
    && (before.needDiscovered || 0) < 0.6) return 'unearned_close';
  return null;
}

/* Should the call actually stop? Format, budget and repetition all get a
   veto — a detected mistake is necessary, not sufficient. */
export function evaluateTurn({ turn, coach, format = DEFAULT_FORMAT, mode = {}, focus = null } = {}) {
  const reason = classifyMistake(turn || {}, mode);
  if (!reason) return { interrupt: false, reason: null };
  /* Full Simulation still DETECTS everything — it simply never stops. The
     record is identical; only the interruption is absent. */
  if (format !== 'guided') return { interrupt: false, reason, detectedOnly: true };
  if (!coach) return { interrupt: false, reason, detectedOnly: true };
  if (coach.active) return { interrupt: false, reason, suppressed: 'already_coaching' };
  if (coach.interventions >= MAX_INTERVENTIONS) return { interrupt: false, reason, suppressed: 'session_budget' };
  if ((coach.byReason[reason] || 0) >= MAX_PER_REASON) {
    return { interrupt: false, reason, suppressed: 'lesson_already_given' };
  }
  /* KEEP THE LAST SLOT FOR WHAT THEY CAME TO PRACTISE. This spends less of
     the budget, never more, so a focused session cannot be coached harder
     than an unfocused one. */
  const wanted = focus && focus.reason;
  if (wanted && reason !== wanted
    && coach.interventions >= MAX_INTERVENTIONS - 1
    && (coach.byReason[wanted] || 0) < MAX_PER_REASON) {
    return { interrupt: false, reason, suppressed: 'reserved_for_focus' };
  }
  return { interrupt: true, reason, coaching: COACHING[reason], focused: reason === wanted };
}

/* ── THE RETRY ─────────────────────────────────────────────────────────
   Judged on the CORRECTION, never on the wording. Any line that stops
   committing the original mistake is accepted — VISION teaches the move,
   not a sentence. */
export function evaluateRetry({ retryTurn, reason, attempt = 1, mode = {} } = {}) {
  const stillWrong = classifyMistake(retryTurn || {}, mode);
  const action = retryTurn && retryTurn.founderAction;

  if (stillWrong === reason) {
    const exhausted = attempt >= MAX_RETRIES;
    return {
      accepted: false, exhausted,
      /* Never trap the founder. After the last attempt VISION shows what it
         would have said and the call goes on. */
      note: exhausted ? 'Here is one way to put it.' : 'That still does it. Try once more.',
      showExample: exhausted,
    };
  }
  /* A different mistake is still not a fix — but say which, so the second
     attempt is not a guessing game. */
  if (stillWrong) {
    const exhausted = attempt >= MAX_RETRIES;
    return { accepted: false, exhausted, changedInto: stillWrong,
      note: exhausted ? 'Here is one way to put it.' : 'Closer, but that has the same problem in a different place.',
      showExample: exhausted };
  }
  return {
    accepted: true, action,
    /* Restrained, and specific about what improved. No confetti. */
    headline: 'Better',
    note: acknowledgementFor(reason, action),
  };
}

function acknowledgementFor(reason, action) {
  if (action === 'high_value_follow_up') return 'You used what they actually said.';
  if (action === 'discovery_question') {
    return reason === 'unsupported_assumption' ? 'You asked instead of assuming.' : 'That earns the right to pitch.';
  }
  if (action === 'objection_exploration') return 'You went at the objection instead of around it.';
  if (action === 'professional_exit') return 'Leaving well is worth more than one more push.';
  return 'That keeps it grounded.';
}

/* Records the intervention against the budget. */
export function noteIntervention(coach, reason) {
  if (!coach) return coach;
  coach.interventions += 1;
  coach.byReason[reason] = (coach.byReason[reason] || 0) + 1;
  return coach;
}
