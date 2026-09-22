/* ════════════════════════════════════════════════════════════════════════
   WHAT THE PROSPECT ACTUALLY MADE DISCOVERABLE.

   The customer test produced a review that told a founder "the prospect's
   need was established to 0% by the end of the call" on a call where the
   prospect refused four consecutive attempts to establish it. That 0% was
   the simulator's script, not the founder's failure, and nothing in the
   system could tell the difference.

   This file records the difference and nothing else. It does not score, and
   it does not decide whether the founder should have tried harder.

     not_asked          nobody raised it
     asked              raised, no answer yet
     answered           the prospect stated it
     partially_answered directional but not the thing asked for
     explicitly_unknown "I don't know" -- they would tell you if they could
     refused            "we don't discuss that" -- they could and would not
     not_applicable     ruled out by something they said
     superseded         a later correction replaced an earlier answer

   "explicitly_unknown" and "refused" are kept apart on purpose. One is a
   prospect who cannot help; the other is a prospect who will not. A founder
   who meets either has not failed at discovery -- but only one of them is a
   door that stays shut.
   ══════════════════════════════════════════════════════════════════════ */

import { normalise, contentWords, contentOverlap, isExplicitDenial } from './evidence-gates.js';

export const ANSWER_KEY_VERSION = 'practice_answer_key_v1';

export const ANSWER_STATE = Object.freeze({
  NOT_ASKED: 'not_asked', ASKED: 'asked', ANSWERED: 'answered',
  PARTIAL: 'partially_answered', UNKNOWN_TO_PROSPECT: 'explicitly_unknown',
  REFUSED: 'refused', NOT_APPLICABLE: 'not_applicable', SUPERSEDED: 'superseded',
});

/* They would tell you if they could. */
const CANNOT = /\b(i (don't|do not) know|i'm not sure|not sure|i couldn't say|i can't say|i couldn't give|i can't give|i couldn't tell you|i wouldn't be able to|i'm not aware of|i am not aware of|i (don't|do not) have (that|those|the figures|a breakdown|it)|not in front of me|off the top of my head|we (don't|do not) track|not currently tracking|(couldn't|could not|can't) quote|in a way i could quote|i'd have to check|i would have to check|no breakdown)\b/i;
/* A reply that hedges, or answers a question with a question, has not
   answered it. "Possibly, but I'd need to understand what you mean by the
   gap" was being recorded as a disclosure. */
const HEDGED = /\b(possibly|perhaps|maybe|i suppose|it depends|depends on|i'd need to|i would need to|hard to say|it varies)\b/i;
/* They could, and will not. */
const WILL_NOT = /\b(we (don't|do not) (normally )?discuss|not something we discuss|i'd rather not|i would rather not|that's not something|we don't share|i'm not going to (say|discuss|share)|on an unsolicited call)\b/i;
/* Rules the topic out entirely. */
const NOT_RELEVANT = /\b(that (doesn't|does not) apply|not applicable|we don't (do|offer|have) (that|any)|there (isn't|is not) any)\b/i;
/* A correction that replaces what was said before. */
/* P1: a bare "actually" is an intensifier -- "what data would you actually
   need" was superseding the one fact call D disclosed. A correction has to
   name the thing being corrected. */
const CORRECTION = /\b(actually,? (i|we) (said|meant|should have)|sorry,? i said|to correct that|i misspoke|that's not what i said|what i meant was|let me correct)\b/i;

/* P0: turn assembly joins "…the wait for an appointment?" with the cut tail
   "appointment.", and the question mark stops being final -- so the question
   was never tracked and the prospect's refusal had nothing to attach to.
   A turn that contains a question mark asked a question. */
const isQuestion = (t) => /\?/.test(normalise(t));
const SUBSTANTIVE = 6;   /* content words before a reply counts as an answer */

/* One unknown, tracked across the call. `topic` is the founder's question or
   a seeded unknown; everything else is evidence. */
function entry(topic, source) {
  return { topic: String(topic || '').slice(0, 300), source,
    state: ANSWER_STATE.NOT_ASKED, askedAtSeq: null, answeredAtSeq: null,
    answer: null, evidence: [], supersededBy: null,
    /* GROUND TRUTH, not a reading of the words. Every other state on this
       entry is inferred by regex from what the prospect happened to say; this
       one is what the reaction policy DECIDED before the prospect said
       anything, carried through on the turn. A simulator that chose not to
       disclose is not a founder who failed to ask. */
    prospectWithheld: false };
}

/* Build the key from assembled turns plus whatever unknowns the prospect
   brief seeded. Pure: same turns in, same key out. */
export function buildAnswerKey(turns = [], handoff = {}) {
  const seeded = (Array.isArray(handoff.unknowns) ? handoff.unknowns : [])
    .map((u) => entry(u, 'brief'));
  const asked = [];
  const rows = (turns || []).filter((t) => t && normalise(t.text));

  rows.forEach((turn, i) => {
    const said = normalise(turn.text);
    const seq = typeof turn.sequence === 'number' ? turn.sequence : i;

    if (turn.speaker === 'founder') {
      /* A half-heard sentence did not ask anything. */
      if (turn.complete !== true) return;
      if (!isQuestion(said)) return;
      asked.push({ ...entry(said, 'founder_question'),
        state: ANSWER_STATE.ASKED, askedAtSeq: seq,
        evidence: [{ sequence: seq, attemptNo: turn.attemptNo || 1, speaker: 'founder', quote: said.slice(0, 300) }] });
      /* A seeded unknown the question clearly targets moves to asked. */
      seeded.forEach((u) => {
        if (u.state !== ANSWER_STATE.NOT_ASKED) return;
        /* A brief phrases an unknown differently from the question that asks
           it -- "whether the practice has appointment capacity" against "do
           you have capacity for more patients?" shares one content word. The
           bar is topical relevance, not paraphrase. */
        if (contentOverlap(u.topic, said) >= 0.2) {
          u.state = ANSWER_STATE.ASKED; u.askedAtSeq = seq;
          u.evidence.push({ sequence: seq, attemptNo: turn.attemptNo || 1, speaker: 'founder', quote: said.slice(0, 300) });
        }
      });
      return;
    }

    /* ── the prospect answers whatever is still open ───────────────── */
    const open = asked.filter((q) => q.state === ANSWER_STATE.ASKED);
    const target = open.length ? open[open.length - 1] : null;
    const cite = { sequence: seq, attemptNo: turn.attemptNo || 1, speaker: 'prospect', quote: said.slice(0, 300) };

    let state = null;
    if (WILL_NOT.test(said)) state = ANSWER_STATE.REFUSED;
    else if (CANNOT.test(said)) state = ANSWER_STATE.UNKNOWN_TO_PROSPECT;
    else if (NOT_RELEVANT.test(said)) state = ANSWER_STATE.NOT_APPLICABLE;
    else if (HEDGED.test(said) || isQuestion(said)) state = ANSWER_STATE.PARTIAL;
    else if (contentWords(said).length >= SUBSTANTIVE) state = ANSWER_STATE.ANSWERED;
    else state = ANSWER_STATE.PARTIAL;

    /* Decided upstream by the reaction policy, and true only when a prospect
       who COULD have answered chose not to -- never when the question itself
       could not be answered as asked. */
    const withheld = turn.prospectCausedWithholding === true
      || turn.prospect_caused_withholding === true;

    if (target) {
      target.state = state; target.answeredAtSeq = seq;
      target.answer = said.slice(0, 300); target.evidence.push(cite);
      if (withheld) target.prospectWithheld = true;
    }
    /* A correction supersedes the most recent ANSWERED entry on the same
       topic -- the latest grounded statement wins. */
    if (CORRECTION.test(said) || isExplicitDenial(said)) {
      for (let k = asked.length - 1; k >= 0; k -= 1) {
        const prior = asked[k];
        if (prior === target) continue;
        if (prior.state === ANSWER_STATE.ANSWERED && contentOverlap(prior.answer || '', said) >= 0.25) {
          prior.state = ANSWER_STATE.SUPERSEDED;
          prior.supersededBy = seq;
          prior.evidence.push(cite);
          break;
        }
      }
    }
    /* Seeded unknowns share the prospect's answer when it is on topic. */
    seeded.forEach((u) => {
      if (u.state === ANSWER_STATE.NOT_ASKED) return;
      if (u.answeredAtSeq != null) return;
      /* P1: refusals were being attributed to whichever unknown happened to be
         first in the list. An answer belongs to the unknown the question was
         actually about. */
      if (target && contentOverlap(u.topic, target.topic) >= 0.2) {
        u.state = state; u.answeredAtSeq = seq; u.answer = said.slice(0, 300); u.evidence.push(cite);
        if (withheld) u.prospectWithheld = true;
      }
    });
  });

  const entries = seeded.concat(asked);
  return {
    version: ANSWER_KEY_VERSION,
    entries,
    counts: entries.reduce((acc, e) => { acc[e.state] = (acc[e.state] || 0) + 1; return acc; }, {}),
  };
}

/* What later layers will ask: was this actually discoverable? */
export function wasDiscoverable(key, topic) {
  const e = (key && key.entries || []).find((x) => contentOverlap(x.topic, topic) >= 0.5);
  if (!e) return { discoverable: null, reason: 'not_tracked' };
  /* BEFORE the state, because a partial answer given deliberately reads as
     `partially_answered` and would otherwise protect nobody -- and half an
     answer withheld on purpose is still the simulator's choice, not the
     founder's failure. */
  if (e.prospectWithheld === true) return { discoverable: false, reason: 'prospect_withheld' };
  if (e.state === ANSWER_STATE.ANSWERED) return { discoverable: true, reason: 'answered' };
  if (e.state === ANSWER_STATE.REFUSED) return { discoverable: false, reason: 'prospect_refused' };
  if (e.state === ANSWER_STATE.UNKNOWN_TO_PROSPECT) return { discoverable: false, reason: 'prospect_did_not_know' };
  return { discoverable: null, reason: e.state };
}
export const unavailableCount = (key) => (key && key.entries || [])
  .filter((e) => e.prospectWithheld === true
    || e.state === ANSWER_STATE.REFUSED || e.state === ANSWER_STATE.UNKNOWN_TO_PROSPECT).length;
