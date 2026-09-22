/* ════════════════════════════════════════════════════════════════════════
   WHO DECIDES A PAUSE — AND ON WHAT EVIDENCE

   Interrupting a founder, and later recording that he did or did not fix it
   himself, is a judgement about him. So none of it may be asserted by the
   browser. The client says what was SAID; everything else -- whether that
   earns a pause, which Best Move is locked, whether a retry corrected it,
   and whether he has any pauses left -- is derived here from turns that are
   already persisted.

   That matters most for the budget. "One guided pause per call" enforced in
   the client is a suggestion. Derived from the transcript it is a fact: a
   retry is a second attempt at a sequence, and a second attempt is visible
   in the rows whatever the caller claims.

   This module holds no I/O. It takes rows, returns decisions, and leaves
   reading and writing to the caller -- which is what lets the whole flow be
   proved without a database.
   ══════════════════════════════════════════════════════════════════════ */
import { activeTurns, nextAttemptAt } from './call-rewind.js';
import { buildJudgeContext } from './nuance-judge-context.js';
import { reconcile } from './judgement-reconciler.js';
import { buildCallState } from './call-state.js';
import { classifyFounderTurn } from './prospect-behaviour.js';
import { decidePause, MAX_PAUSES_PER_CALL } from './guided-pause.js';
import { judgeRetry, CORRECTED_OUTCOMES } from './retry-verdict.js';
import { COACHING, COACHING_KEY } from './guided-coaching.js';

export const GUIDED_ORCHESTRATOR_VERSION = 'practice_guided_orchestrator_v1';

const att = (t) => Number(t && (t.attemptNo ?? t.attempt_no)) || 1;

/* Database rows are not turns. One conversion, here, so no caller invents
   a second reading of the same table. */
export function toTurns(rows = []) {
  return (rows || []).map((r) => ({
    sequence: Number(r.sequence),
    attemptNo: att(r),
    speaker: r.speaker,
    text: String(r.content ?? r.text ?? ''),
    saidAt: r.said_at || r.created_at || null,
    complete: r.turn_complete !== false && r.complete !== false,
    /* CARRIED, unlike `branch` below. A prospect that chose not to answer
       is the simulator's doing; dropping it here would let the retry judge
       a founder for information the call never made available. */
    prospectCausedWithholding: r.prospect_caused_withholding === true
      || r.prospectCausedWithholding === true,
    /* `branch` is deliberately NOT carried. interpretable() refuses a turn
       marked superseded, so passing the stored marker through erases the
       very fault the retry is being judged against -- the pause re-derives
       to nothing and the founder is told VISION could not judge it. The
       pipeline learned this already; the orchestrator had to learn it from
       a real browser run. Supersession is derived from attempt numbers
       here, which is what `activeTurns` is for. */
  })).filter((t) => Number.isFinite(t.sequence) && t.text);
}

/* WHAT THE TRANSCRIPT ALREADY PROVES. A superseded attempt is a retry that
   happened, whether or not anyone reported it. */
export function guidedBudget(rows = []) {
  const turns = toTurns(rows);
  const retried = [...new Set(turns.filter((t) => att(t) > 1).map((t) => t.sequence))].sort((a, b) => a - b);
  return Object.freeze({
    pausesUsed: retried.length,
    retriedSequences: retried,
    pausesLeft: Math.max(0, MAX_PAUSES_PER_CALL - retried.length),
  });
}

/* ── A CLAIM THEY NEVER MADE ───────────────────────────────────────────
   `unsupported_assumption` sat on the pause-eligible list where nothing
   could ever emit it: the rule engine does not produce that type -- it has
   no `handoff`, so it cannot know which claims about the business were
   actually verified -- and the behaviour engine, which does, only reaches
   Guided Practice through `detected_events`, which the guided path does not
   read. So the list promised a lesson the product could not deliver, and a
   founder inventing a fact about the prospect was never stopped.

   Derived here, guided-only, from the SAME gate the behaviour engine uses.
   Not a second opinion: one definition, called from the one place that has
   both the founder's words and the evidence to judge them against. */
function assumptionEvent(turns, handoff, state) {
  const last = [...turns].reverse().find((t) => t.speaker === 'founder' && String(t.text || '').trim());
  if (!last) return null;

  /* THROUGH THE CLASSIFIER, NOT THE BARE GATE. Calling
     `assertsUnsupportedClaim` directly skipped the precedence the classifier
     applies before it, and a courteous sign-off -- "That is useful, thank
     you. I will let you get back to it." -- reads as a claim about their
     business when nothing checks first whether the founder was simply
     leaving. That produced eight false pauses across the 32 clean calls,
     every one of them on a founder ending the call politely: the exact
     behaviour the rubric gives full marks for.

     The classifier already resolves this ordering, so it decides. */
  const prospectSaid = [...turns].reverse().find((t) => t.speaker === 'prospect');
  const bare = {
    turns: turns.filter((t) => t.speaker === 'founder').length,
    said: [], lastProspectLine: (prospectSaid && prospectSaid.text) || '',
    activeObjection: (state && state.activeObjection) || null,
    facts: { disclosed: (state && state.facts && state.facts.disclosed) || [] },
  };
  const classified = classifyFounderTurn(last.text, bare, handoff);
  if (!classified || classified.action !== 'unsupported_assumption') return null;
  const claim = { reason: classified.detail || 'claim_about_them_not_in_evidence' };
  return {
    eventId: `ce_guided_assumption_${last.sequence}_${last.attemptNo || 1}`,
    sessionId: 'guided', producer: 'rule_engine', producerVersion: 'practice_guided_assumption_v1',
    ruleId: 'unsupported_assumption', ruleVersion: 'v1', eventType: 'unsupported_assumption',
    subjectSequence: last.sequence, subjectAttemptNo: last.attemptNo || 1,
    subjectTurnComplete: last.complete !== false, subjectCreditEligible: null,
    citations: [{ sequence: last.sequence, attemptNo: last.attemptNo || 1, speaker: 'founder',
      quote: String(last.text).slice(0, 300) }],
    authority: 'supported',
    authorityBasis: `claim_about_them_not_in_evidence:${claim.reason || claim.detail || 'unverified'}`,
    corroboratesEventId: null, observedSequence: last.sequence,
    contractVersion: 'practice_candidate_events_v1',
  };
}

function findingsFor(turns, handoff, state) {
  const ctx = buildJudgeContext({ callId: 'guided', turns, objective: '', facts: [], handoff });
  const extra = assumptionEvent(turns, handoff, state);
  const candidateEvents = extra ? ctx.context.candidateEvents.concat([extra]) : ctx.context.candidateEvents;
  return reconcile({ callId: 'guided', candidateEvents, judgements: [] }).findings;
}

/* ── THE TURN THE FOUNDER JUST TOOK ────────────────────────────────────
   Called with the founder's words BEFORE the prospect answers, because a
   pause has to stop the call, not review it afterwards. */
export function guidedTurn({ rows = [], founderText, sequence, handoff = {} } = {}) {
  if (typeof sequence !== 'number') throw new Error('guided_turn_requires_a_sequence');
  const said = String(founderText == null ? '' : founderText).trim();
  if (!said) throw new Error('guided_turn_requires_founder_text');

  const prior = activeTurns(toTurns(rows)).filter((t) => t.sequence < sequence);
  const attemptNo = nextAttemptAt(toTurns(rows), sequence);
  const turns = prior.concat([{ sequence, attemptNo, speaker: 'founder', complete: true, text: said }]);

  const budget = guidedBudget(rows);
  const stateBefore = buildCallState(prior, handoff);
  const decision = decidePause({
    findings: findingsFor(turns, handoff, stateBefore),
    state: stateBefore,
    pausesSoFar: budget.pausesUsed,
  });
  return Object.freeze({ ...decision, attemptNo, budget, orchestrator: GUIDED_ORCHESTRATOR_VERSION });
}

/* ── THE ONE UNAIDED RETRY ─────────────────────────────────────────────
   The pause is RE-DERIVED from the transcript rather than accepted from the
   caller. A client that sends back a different fault, an easier Best Move
   or someone else's sequence gets the server's answer, not its own. */
export function guidedRetry({ rows = [], sequence, retryText, handoff = {}, context = {},
  helped = false, now = null } = {}) {
  if (typeof sequence !== 'number') throw new Error('guided_retry_requires_a_sequence');
  const said = String(retryText == null ? '' : retryText).trim();
  if (!said) throw new Error('guided_retry_requires_text');

  const all = toTurns(rows);
  const failed = all.filter((t) => t.sequence === sequence && t.speaker === 'founder');
  if (!failed.length) return Object.freeze({ ok: false, error: 'no_turn_at_that_sequence' });
  if (failed.some((t) => att(t) > 1)) return Object.freeze({ ok: false, error: 'retry_already_used' });

  /* Re-derive the pause exactly as it was decided, from the same rows. */
  const prior = activeTurns(all).filter((t) => t.sequence < sequence);
  const original = failed.reduce((a, b) => (att(a) >= att(b) ? a : b));
  const turns = prior.concat([{ ...original, speaker: 'founder', complete: true }]);
  /* WHEN the call stopped is the moment the failed turn was taken, which
     the database already knows. Re-deriving the pause cannot recover it
     from thin air, and asking the client for it would let a caller stamp
     its own training record. */
  const pause = decidePause({
    findings: findingsFor(turns, handoff),
    state: buildCallState(prior, handoff),
    pausesSoFar: 0,
    now: original.saidAt || null,
  });
  if (!pause.pause) return Object.freeze({ ok: false, error: 'no_pause_at_that_sequence', reason: pause.reason });

  const verdict = judgeRetry({
    pause, retryText: said, retryAttemptNo: nextAttemptAt(all, sequence),
    context: { ...context, objection: pause.objection || null }, helped, now,
  });
  return Object.freeze({ ok: true, ...verdict, pause,
    /* Corrected with help still resumes the call: he made the move. What
       changes is what the record claims he did unaided. */
    resume: CORRECTED_OUTCOMES.includes(verdict.outcome),
    orchestrator: GUIDED_ORCHESTRATOR_VERSION });
}

/* ── RESCUE, ONLY AFTER AN UNAIDED GO ──────────────────────────────────
   Builds the single card the wording layers need for the moment the call
   stopped at. The pause is re-derived here too, so the sentences a founder
   is handed are written for the move the SERVER locked -- not one a client
   asked for after the fact.

   The caller supplies the models. This stays free of I/O so the shape can
   be proved without spending anything. */
export function guidedRescuePlan({ rows = [], sequence, handoff = {} } = {}) {
  if (typeof sequence !== 'number') throw new Error('rescue_requires_a_sequence');
  const all = toTurns(rows);
  const attempts = all.filter((t) => t.sequence === sequence && t.speaker === 'founder');
  if (!attempts.length) return { ok: false, error: 'no_turn_at_that_sequence' };

  const prior = activeTurns(all).filter((t) => t.sequence < sequence);
  /* The FAILED line is the one being coached, so the earliest attempt --
     not whatever the founder has said since. */
  const failed = attempts.reduce((a, b) => (att(a) <= att(b) ? a : b));
  const turns = prior.concat([{ ...failed, speaker: 'founder', complete: true }]);
  const pause = decidePause({
    findings: findingsFor(turns, handoff),
    state: buildCallState(prior, handoff),
    pausesSoFar: 0, now: failed.saidAt || null,
  });
  if (!pause.pause) return { ok: false, error: 'no_pause_at_that_sequence', reason: pause.reason };

  return {
    ok: true,
    pause,
    turns: prior,
    callState: buildCallState(prior, handoff),
    plan: [{
      sequence, attemptNo: failed.attemptNo || 1,
      whatYouSaid: failed.text,
      bestMove: pause.bestMove && pause.bestMove.id
        ? { id: pause.bestMove.id, goal: pause.bestMove.goal, because: pause.bestMove.because || [] }
        : null,
      eventType: pause.fault,
      coaching: COACHING[COACHING_KEY[pause.fault]] || null,
    }],
  };
}
