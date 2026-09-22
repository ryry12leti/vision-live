/* ════════════════════════════════════════════════════════════════════════
   WHEN TO STOP THE CALL

   Interrupting a founder mid-sentence is a claim that they got something
   wrong. Make it on a guess and the feature teaches nothing and costs
   trust, so the bar is the referee's own: a HARD finding the reconciler
   SUPPORTED. Not a behaviour-classifier hunch, not a judge opinion, not a
   finding that was withheld or suppressed by better evidence.

   Four faults are eligible, and all four change where the call goes. Weak
   discovery is deliberately excluded -- it is too frequent to interrupt on,
   and reading it back afterwards teaches the same lesson without breaking
   the call.

   THE FIRST SERIOUS MISTAKE IS THE ONE WORTH STOPPING, not the worst one.
   Everything after it happened in a call that had already gone wrong, so
   correcting turn nine while turn three stands is coaching a symptom.

   A terminal refusal is never coached. Rewinding a do-not-contact to give
   someone another go at selling is the one lesson this must never teach.
   ══════════════════════════════════════════════════════════════════════ */
import { AUTHORITY, STATUS } from './judgement-reconciler.js';
import { COACHING, COACHING_KEY } from './guided-coaching.js';
import { decideBestMove } from './best-move.js';
import { REFUSAL } from './call-state.js';

export const PAUSE_ELIGIBLE = Object.freeze([
  'pitched_without_permission',
  'unearned_close',
  'objection_not_handled',
  'unsupported_assumption',
  /* LEANING ON SOMEONE IS THE MOST EXPENSIVE THING A REP DOES and it was
     the one fault that could never interrupt the call. The rubric already
     zeroes the close for it and the coaching copy already exists
     (`pressure_after_no`); only this list was missing it, so a founder
     could push a prospect all the way to a hangup without VISION once
     stopping to say why. */
  'pressure_applied',
]);

/* V1 budget. One interruption is a lesson; three is an interrogation. */
export const MAX_PAUSES_PER_CALL = 1;

/* A refusal at or above this rank ends the call rather than pausing it. */
const TERMINAL = Object.freeze([REFUSAL.HARD, REFUSAL.DO_NOT_CONTACT]);

const NOT = (reason) => ({ pause: false, reason });

export function isPauseEligible(finding) {
  if (!finding) return NOT('no_finding');
  if (!PAUSE_ELIGIBLE.includes(finding.eventType)) return NOT('fault_not_eligible');
  if (finding.authority !== AUTHORITY.HARD) return NOT('not_hard_evidence');
  if (finding.status !== STATUS.SUPPORTED) return NOT('not_supported');
  if (typeof finding.sequence !== 'number') return NOT('no_sequence_to_rewind_to');
  return { pause: true, reason: 'hard_supported_eligible_fault' };
}

/* Decide whether this call should stop, and if so, what the founder reads.
   Pure: the clock and the pause count come in, nothing is stored here. */
export function decidePause({ findings = [], state = null, pausesSoFar = 0, now = null } = {}) {
  if (pausesSoFar >= MAX_PAUSES_PER_CALL) return NOT('pause_budget_spent');

  /* A call that has ended in a refusal is over. It is not a teaching
     moment, and rewinding past it would un-hear the refusal. */
  const refusal = (state && state.refusal && state.refusal.state) || REFUSAL.NONE;
  if (TERMINAL.includes(refusal)) return NOT('call_ended_in_refusal');

  const eligible = findings
    .filter((f) => isPauseEligible(f).pause)
    .sort((a, b) => a.sequence - b.sequence);
  if (!eligible.length) return NOT('nothing_eligible');

  const fault = eligible[0];
  const lesson = COACHING[COACHING_KEY[fault.eventType]];
  if (!lesson || !lesson.hurt) return NOT('no_founder_facing_copy');

  /* The move is the deterministic one for the state the founder was in
     BEFORE the mistake -- the same state the retry will be spoken into. */
  const bestMove = decideBestMove({ state, fault: fault.eventType });

  return {
    pause: true,
    reason: 'hard_supported_eligible_fault',
    fault: fault.eventType,
    sequence: fault.sequence,
    findingId: fault.findingId || null,
    /* What the founder reads. Three lines, no example sentence. */
    whatHappened: lesson.why,
    whyItHurt: lesson.hurt,
    /* `because` rides along so a later rescue can ground its wording in the
       same evidence the move was chosen on, rather than re-deriving it. */
    bestMove: { id: bestMove.moveId, goal: bestMove.goal, because: bestMove.because || [] },
    prompt: 'Try again',
    pausedAt: now,
  };
}

/* The deterministic record later steps read. Written once when the pause is
   raised, completed when the founder retries -- never judged here, because
   whether the retry worked is Step 3's question, not this one. */
export function pauseRecord(decision, { failedAttemptNo = 1 } = {}) {
  if (!decision || !decision.pause) throw new Error('pause_record_requires_a_pause');
  return {
    fault: decision.fault,
    sequence: decision.sequence,
    findingId: decision.findingId,
    failedAttemptNo,
    retryAttemptNo: null,
    bestMoveId: decision.bestMove.id,
    retried: false,
    pausedAt: decision.pausedAt,
    resumedAt: null,
  };
}

export function recordRetry(record, { retryAttemptNo, now = null } = {}) {
  if (!record) throw new Error('no_pause_record');
  if (typeof retryAttemptNo !== 'number') throw new Error('retry_needs_an_attempt_number');
  return { ...record, retried: true, retryAttemptNo, resumedAt: now };
}
