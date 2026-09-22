/* ════════════════════════════════════════════════════════════════════════
   THE GROUNDED VIEW THE JUDGE IS ALLOWED TO SEE.

   Assembles the Judge's context from the FROZEN deterministic layers and
   nothing else: Pass-2 call state, the answer key, the rule engine, the
   reaction reader. Every field the model reads is therefore something VISION
   already computed and can defend, not something this file decided.

   IT ADDS NO OPINION. There is no sales judgement anywhere below — no "this
   was weak", no severity, no ordering by importance. The one thing it does
   decide is DISCOVERABILITY, and it decides it by calling wasDiscoverable(),
   the frozen function, because that answer is the founder's protection
   against being blamed for a refusal and must not be a second opinion.

   THE RULE ENGINE RUNS ON UNMARKED TURNS ON PURPOSE. `interpretable()`
   refuses a turn marked superseded, so marking retries before running the
   rules would erase the very fault the retry was coached on — and then
   "did this retry repair the named mistake?" has no named mistake. The
   marking is applied to the RENDERED transcript instead, where it belongs.
   ══════════════════════════════════════════════════════════════════════ */
import { initialCallState, advanceCallState } from './call-state.js';
import { buildAnswerKey, wasDiscoverable } from './answer-key.js';
import { runRules } from './rule-engine.js';
import { readReactions } from './reaction-reader.js';
import { NEGATIVE_TYPES, AUTHORITY } from './candidate-events.js';

const att = (t) => (t == null || t.attemptNo == null ? 1 : t.attemptNo);

/* Which attempts at a sequence were replaced by a later one. */
export function supersededAttempts(turns = []) {
  const latest = new Map();
  turns.filter((t) => t.speaker === 'founder').forEach((t) => {
    const cur = latest.get(t.sequence);
    if (cur == null || att(t) > cur) latest.set(t.sequence, att(t));
  });
  const out = new Set();
  turns.filter((t) => t.speaker === 'founder').forEach((t) => {
    if (att(t) < latest.get(t.sequence)) out.add(`${t.sequence}|${att(t)}`);
  });
  return out;
}

export function buildJudgeContext({ sessionId = 'judge', callId, turns = [], objective = '',
  facts = [], handoff = {}, canonicalEvents = null } = {}) {
  const answerKey = buildAnswerKey(turns, handoff);

  /* Pass-2 state as it stood BEFORE each turn, which is what runRules asks
     for. Keyed on sequence, so an interrupted turn and its retry share the
     state they were both spoken into -- which is the truth. */
  const before = new Map();
  let state = initialCallState(handoff);
  turns.forEach((t) => {
    if (!before.has(String(t.sequence))) before.set(String(t.sequence), state);
    state = advanceCallState(state, t);
  });
  const stateAt = (seq) => before.get(String(seq)) || null;

  /* ── PHASE 2: READ THE EVIDENCE, DO NOT RE-DERIVE IT ────────────────
     These two producers already ran once, on the server, at the settlement
     boundary, over turns neutralised for delivery -- and their output was
     persisted. Re-running them here made this a SECOND authority on the
     same conversational facts, deriving from raw text that had not been
     through the same neutralisation. When canonical evidence exists it is
     used; the derivation below stays as the path for sessions that predate
     Phase 2 and for callers with no store behind them. */
  const canonical = Array.isArray(canonicalEvents) ? canonicalEvents : null;
  const candidateEvents = canonical
    ? canonical.filter((e) => e.producer !== 'reaction_reader')
    : runRules({ sessionId, turns, stateAt, answerKey });
  const reactions = canonical
    ? canonical.filter((e) => e.producer === 'reaction_reader')
    : readReactions({ sessionId, turns });

  /* ── the retry context ───────────────────────────────────────────────
     A retry is judged against the fault it was coached on, so the fault has
     to be NAMED. It is named from the deterministic negative findings on the
     attempt that was replaced -- never from a guess, and never silently
     invented when there is nothing there. */
  const superseded = supersededAttempts(turns);
  const bySeq = new Map();
  turns.filter((t) => t.speaker === 'founder').forEach((t) => {
    if (!bySeq.has(t.sequence)) bySeq.set(t.sequence, []);
    bySeq.get(t.sequence).push(att(t));
  });
  const coached = [];
  bySeq.forEach((attempts, sequence) => {
    if (attempts.length < 2) return;
    const ordered = attempts.slice().sort((a, b) => a - b);
    const toAttempt = ordered[ordered.length - 1];
    const fromAttempt = ordered[ordered.length - 2];
    const faults = candidateEvents.filter((e) => e.subjectSequence === sequence
      && e.subjectAttemptNo === fromAttempt
      && e.authority === AUTHORITY.SUPPORTED
      && NEGATIVE_TYPES.includes(e.eventType));
    coached.push({ sequence, fromAttempt, toAttempt,
      reason: faults.length ? faults.map((f) => f.eventType).join(' and ')
        : 'VISION stopped the founder on this turn; the specific fault was not recorded' });
  });
  const retryContext = coached.length
    ? { coachedSequences: coached.map((c) => c.sequence), coached }
    : null;

  /* The transcript the judge reads says which attempts were replaced. The
     rules above deliberately did not. */
  const rendered = turns.map((t) => (superseded.has(`${t.sequence}|${att(t)}`)
    ? { ...t, branch: 'superseded' } : t));

  return {
    call: { callId, turns: rendered },
    context: {
      objective,
      callState: state,
      candidateEvents,
      reactions,
      answerKey,
      verifiedFacts: facts,
      retryContext,
    },
    answerKey,
  };
}

/* ── DISCOVERABILITY IS CODE'S ANSWER ─────────────────────────────────
   Returned as a list of unit addresses the contract must treat as
   undiscoverable, so it can cross a network without becoming a function. A
   unit is on this list only where the FROZEN answer key says the prospect
   refused or did not know. `null` -- untracked -- is not "undiscoverable",
   and must never be flattened into one, or every unasked question becomes a
   shield. */
export function undiscoverableUnits(units = [], { turns = [], answerKey } = {}) {
  const textOf = (u) => {
    const t = turns.find((x) => x.sequence === u.sequence && att(x) === att(u)
      && x.speaker === 'founder');
    return t ? t.text : null;
  };
  return units.filter((u) => {
    if (u.sequence == null) return false;
    const topic = textOf(u);
    if (!topic) return false;
    return wasDiscoverable(answerKey, topic).discoverable === false;
  }).map((u) => ({ dimension: u.dimension, sequence: u.sequence, attemptNo: att(u) }));
}

/* ── THE SAME FACT, FOR A UNIT THAT HAS NO TURN ───────────────────────
   biggest_leak is the one dimension where YES IS THE CHARGE, and it names
   its own turn -- so its fairness cannot be decided per-unit, only per
   SELECTED turn. The live proof found this the expensive way: a leak
   convicting a founder for pressing a question the prospect had honestly
   said they did not record, admitted because a call-level unit had no
   sequence for the guard to look at. This returns the turns themselves, so
   the guard can be asked about whichever one the judge picks. */
export function undiscoverableTurns(turns = [], { answerKey } = {}) {
  return turns.filter((t) => t.speaker === 'founder'
    && wasDiscoverable(answerKey, t.text).discoverable === false)
    .map((t) => ({ sequence: t.sequence, attemptNo: att(t) }));
}
