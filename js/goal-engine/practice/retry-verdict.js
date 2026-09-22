/* ════════════════════════════════════════════════════════════════════════
   DID THE FOUNDER FIX IT HIMSELF?

   After a guided pause he gets ONE unaided go. Judging it needs two
   questions, and only asking both gets the right answer:

     1. Did he do the move he was told to do?
     2. Did he stop doing the thing that was wrong?

   Neither alone is enough, and the brief's own example proves it. Locked
   move `verify_the_assumption`, retry "So you are definitely missing calls
   then?" -- that is a polar question testing a claim, so adherence passes
   it. It is also the original mistake with a question mark stapled on. The
   founder is still telling the prospect what their business is like; he has
   just made it harder to disagree.

   So adherence is reused exactly as WTSI uses it -- there is one definition
   of every Best Move and this is not a second one -- and a fault re-check
   is asked alongside it, from the same predicates the diagnosis layer uses.

   The verdict is deterministic. No model is asked, because nothing here
   needs an opinion: either the sentence does the move and drops the fault,
   or it does not.
   ══════════════════════════════════════════════════════════════════════ */
import { adheres } from './move-adherence.js';
import { assertsSomething, isWeakDiscovery, objectionMishandled, isCloseAttempt,
  OFFER_CONTENT, normalise } from './evidence-gates.js';

export const RETRY_VERDICT_VERSION = 'practice_retry_verdict_v1';
/* THREE OUTCOMES, BECAUSE THERE ARE THREE THINGS THAT HAPPEN.

   Making the move after being shown a sentence is not the same skill as
   making it yourself, and it is not the same as failing either. Recording
   it as `corrected_unaided` -- which is what happened before this -- would
   have the memory layer counting help as independence, inflating the exact
   number it exists to measure. */
export const OUTCOME = Object.freeze({
  CORRECTED: 'corrected_unaided',
  CORRECTED_WITH_HELP: 'corrected_with_help',
  NEEDS_HELP: 'needs_help',
});
export const CORRECTED_OUTCOMES = Object.freeze([OUTCOME.CORRECTED, OUTCOME.CORRECTED_WITH_HELP]);

/* A QUESTION CAN STILL BE AN ASSERTION.

   "So you're losing enquiries, right?" and "You are definitely missing
   calls?" do not ask anything -- they hand the prospect a claim and invite
   agreement. `assertsSomething` deliberately skips questions, because a
   genuine question is not a claim, so the leading kind has to be named
   here. Certainty adverb or agreement tag, aimed at the second person. */
const CERTAINTY = /\b(definitely|obviously|clearly|surely|no doubt|must be|bound to be|i take it|presumably)\b/i;
const AGREEMENT_TAG = /,\s*(right|no|yes|yeah|isn'?t it|aren'?t you|don'?t you|haven'?t you|correct)\s*\??\s*$/i;
const SECOND_PERSON = /\b(you|your|you'?re)\b/i;

export function leadsTheWitness(text) {
  const t = normalise(text);
  if (!t || !SECOND_PERSON.test(t)) return false;
  return CERTAINTY.test(t) || AGREEMENT_TAG.test(t);
}

/* Does the retry commit the SAME fault again? Each branch defers to the
   predicate the diagnosis layer already owns for that fault. */
export function stillCommitsFault(text, faultType, ctx = {}) {
  const t = normalise(text);
  switch (faultType) {
    case 'unsupported_assumption': {
      if (leadsTheWitness(t)) return { repeated: true, reason: 'led_them_to_the_answer' };
      /* A QUESTION IS NOT A CLAIM unless it leads, and leading is tested
         above. `assertsSomething` carries a factive branch that fires on
         ordinary subordinate clauses -- it reads "do many slip through when
         it is like that?" as presupposed -- which is tolerable where it
         feeds a judge that can disagree, and intolerable here, where it
         would tell a founder his clean question was the same mistake
         again. Statements still go through it untouched. */
      if (/\?\s*$/.test(t)) return { repeated: false, reason: null };
      return assertsSomething(t).pass
        ? { repeated: true, reason: 'stated_it_again' } : { repeated: false, reason: null };
    }
    case 'weak_discovery': {
      const w = isWeakDiscovery(t, { vocabulary: ctx.vocabulary || null, refused: ctx.refused === true });
      return w.pass ? { repeated: true, reason: 'still_establishes_nothing' } : { repeated: false, reason: null };
    }
    case 'objection_not_handled': {
      const o = objectionMishandled(t, { objection: ctx.objection || null,
        isPitch: OFFER_CONTENT.test(t), isClose: isCloseAttempt(t).pass });
      return o.pass ? { repeated: true, reason: `still_${o.reason}` } : { repeated: false, reason: null };
    }
    case 'unearned_close':
      return isCloseAttempt(t).pass
        ? { repeated: true, reason: 'asked_for_time_again' } : { repeated: false, reason: null };
    case 'pitched_without_permission':
      /* "Does that ever cost you a registration?" is not an offer. The
         offer predicate carries a bare `costs?` for founders pricing their
         own service, and asking what a PROBLEM costs the prospect is the
         opposite move -- it is the discovery he was sent back to do. Their
         cost is theirs; only the founder's own price is a pitch. */
      return OFFER_CONTENT.test(t.replace(/\bcosts?\s+(you|your|them|their)\b/gi, ' '))
        ? { repeated: true, reason: 'offered_again_without_permission' } : { repeated: false, reason: null };
    default:
      return { repeated: false, reason: 'no_recheck_for_this_fault' };
  }
}

/* ONE unaided retry. There is no loop here on purpose: a founder talked at
   twice about the same turn has stopped rehearsing and started being
   marked. */
export function judgeRetry({ pause, retryText, retryAttemptNo = 2, context = {},
  helped = false, now = null } = {}) {
  if (!pause || !pause.pause) throw new Error('judgeRetry requires the pause it is answering');
  const moveId = pause.bestMove && pause.bestMove.id;
  const move = adheres(retryText, moveId);
  const fault = stillCommitsFault(retryText, pause.fault, context);

  const corrected = move.pass && !fault.repeated;
  /* A claim that help was used can only ever DOWNGRADE the record, so it is
     safe to take from the caller. Nothing can talk its way up to unaided. */
  const outcome = !corrected ? OUTCOME.NEEDS_HELP
    : (helped === true ? OUTCOME.CORRECTED_WITH_HELP : OUTCOME.CORRECTED);
  const reason = fault.repeated ? fault.reason
    : (move.pass
      ? (helped === true ? 'executed_the_locked_move_after_help' : 'executed_the_locked_move')
      : `off_move:${move.reason}`);

  return {
    outcome,
    reason,
    onMove: move.pass,
    repeatedFault: fault.repeated,
    retryAttemptNo,
    helped: helped === true,
    event: trainingEvent({ pause, retryText, retryAttemptNo, outcome, reason, now, context,
      helped: helped === true }),
  };
}

/* THE RECORD A LATER MEMORY LAYER READS.

   Deliberately flat and self-describing: whoever aggregates this will not
   have the call in front of them, so every field it needs to say
   "unsupported assumptions corrected unaided 4 times out of 5" is here,
   and nothing that would need the transcript to interpret. */
export function trainingEvent({ pause, retryText, retryAttemptNo, outcome, reason,
  now = null, context = {}, helped = false } = {}) {
  return Object.freeze({
    kind: 'guided_retry',
    version: RETRY_VERDICT_VERSION,
    sessionId: context.sessionId || null,
    prospectRef: context.prospectRef || null,
    faultType: pause.fault,
    findingId: pause.findingId || null,
    sequence: pause.sequence,
    failedAttemptNo: pause.attemptNo || 1,
    retryAttemptNo,
    bestMoveId: pause.bestMove && pause.bestMove.id,
    retryText: String(retryText == null ? '' : retryText).slice(0, 400),
    outcome,
    reason,
    helpUsed: helped === true,
    pausedAt: pause.pausedAt || null,
    judgedAt: now,
  });
}
