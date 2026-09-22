/* ════════════════════════════════════════════════════════════════════════
   THE RECONCILER — ONE AUTHORITATIVE JUDGEMENT SET.

   Three producers now say things about the same call. Step 3's rules say
   what happened. The reaction reader says what the prospect explicitly did.
   The Nuance Judge says what it meant. They will contradict each other, and
   the failure this file exists to prevent is BOTH CONTRADICTORY CLAIMS
   REACHING THE FOUNDER -- "you closed too early" next to "well judged
   close" is not thoroughness, it is the system admitting it does not know.

   PRECEDENCE, NOT AVERAGING. Hard evidence outranks an explicit reaction,
   which outranks the judge. Where they disagree the loser is SUPPRESSED and
   the suppression is recorded with its reason; nothing is blended, and no
   compromise verdict is ever manufactured to produce an answer. Where the
   conflict cannot be resolved on evidence, both sides are WITHHELD. When
   uncertain, SHOW LESS.

   A REACTION IS A FACT, NOT AN OPINION. The prospect correcting a claim is
   evidence about THAT claim. It is never evidence about rapport, trust,
   enthusiasm or intent, and it can never originate a finding about sales
   quality -- it can only corroborate or contradict one that already exists.

   NUANCE STAYS LABELLED NUANCE. A semantic finding may be authoritative
   enough to pass downstream and still never be allowed to look deterministic.
   `authority` is on every row for exactly that reason.

   IT OWNS NO SCORE. No points, no weights, no state. It decides which
   evidence is authoritative enough to leave the room, and nothing else.
   ══════════════════════════════════════════════════════════════════════ */
import { contentHash, CALL_DIMENSIONS, DIMENSIONS } from './benchmark/schema.js';
import { accusatoryVerdictFor } from './benchmark/metrics.js';
import { REACTION_TYPES, AUTHORITY as EVENT_AUTHORITY } from './candidate-events.js';
import { assertsSomething, pitchedDisclaimedNonBuyerAdmissible, PITCH_ACTIONS } from './evidence-gates.js';
import { ANSWER_STATE, wasDiscoverable } from './answer-key.js';

export const RECONCILER_VERSION = 'practice_judgement_reconciler_v1';

export const AUTHORITY = Object.freeze({ HARD: 'hard', REACTION: 'reaction', NUANCE: 'nuance' });
export const STATUS = Object.freeze({ SUPPORTED: 'supported', SUPPRESSED: 'suppressed', WITHHELD: 'withheld' });
export const KIND = Object.freeze({
  HARD_EVENT: 'hard_event', REACTION: 'reaction',
  NUANCE_JUDGEMENT: 'nuance_judgement', SEMANTIC_FAULT: 'semantic_fault',
});

/* ── WHAT A HARD FINDING SPEAKS TO ────────────────────────────────────
   A rule event is not a verdict on a dimension, but it bears on one, and
   the direction it bears in is the whole of the precedence rule. Anything
   not listed here bears on NOTHING: `close_attempted` records that a close
   happened, which is not a criticism, and reading it as one would convict
   every founder who ever asked for a meeting. */
export const HARD_BEARS_ON = Object.freeze({
  unearned_close: Object.freeze({ polarity: 'negative', dimensions: ['next_move_fit', 'pitch_relevance'] }),
  pressure_applied: Object.freeze({ polarity: 'negative', dimensions: ['next_move_fit', 'objection_handling'] }),
  sold_after_do_not_contact: Object.freeze({ polarity: 'negative', dimensions: ['next_move_fit', 'objection_handling'] }),
  pitched_without_permission: Object.freeze({ polarity: 'negative', dimensions: ['pitch_relevance', 'next_move_fit'] }),
  question_repeated: Object.freeze({ polarity: 'negative', dimensions: ['follow_up_quality', 'uncertainty_reduced'] }),
  unsupported_assumption: Object.freeze({ polarity: 'negative', dimensions: ['summary_faithful', 'follow_up_quality'] }),
  weak_discovery: Object.freeze({ polarity: 'negative', dimensions: ['uncertainty_reduced', 'follow_up_quality'] }),
  objection_not_handled: Object.freeze({ polarity: 'negative', dimensions: ['objection_handling', 'next_move_fit'] }),
  /* THE CALL ENDED HERE. Decided by the behaviour engine in code -- never by
     a model and never by a threshold a mode can tune -- so it arrives as
     hard evidence like any other terminal fact. It bears negatively on the
     two dimensions a turn that ended the call cannot have done well: there
     is no defensible next move on it, and nothing was handled. */
  conversation_ended_by_founder: Object.freeze({ polarity: 'negative', dimensions: ['next_move_fit', 'objection_handling'] }),
  repair_of: Object.freeze({ polarity: 'positive', dimensions: ['retry_repaired'] }),
  repair_after_cut: Object.freeze({ polarity: 'positive', dimensions: ['retry_repaired'] }),
  close_attempted: Object.freeze({ polarity: 'neutral', dimensions: [] }),
  repair_candidate_unresolved: Object.freeze({ polarity: 'neutral', dimensions: [] }),
  turn_not_interpretable: Object.freeze({ polarity: 'neutral', dimensions: [] }),
  /* The only fault whose ground truth this system privately holds, which is
     exactly why it is decided on the transcript. See section 1b. */
  pitched_a_non_buyer: Object.freeze({ polarity: 'negative', dimensions: ['pitch_relevance', 'next_move_fit'] }),
});

/* ── WHAT COUNTS AS "THE SAME BEHAVIOUR" ──────────────────────────────
   Praise and a fault may stand together on one turn when they are about
   different things -- "you asked a good question" and "you overstated their
   answer" are both true of the same sentence. They may NOT stand together
   when they are about the same thing, which is what this grouping decides.
   It is deliberately coarse: two dimensions in one group is a claim that a
   founder cannot have done both well and badly at once. */
export const BEHAVIOUR_OF = Object.freeze({
  follow_up_quality: 'handling_what_was_said',
  summary_faithful: 'handling_what_was_said',
  uncertainty_reduced: 'asking',
  pitch_relevance: 'what_was_offered',
  objection_handling: 'answering_an_objection',
  next_move_fit: 'where_the_call_went_next',
  retry_repaired: 'the_retry',
});

/* ── REACTIONS THAT MAY BOUND A JUDGEMENT ─────────────────────────────
   Explicit, factual, and about something the prospect actually said. There
   is no sentiment in this list and there must never be one: warmth is not
   evidence, and a founder who was liked did not thereby sell well. */
export const REACTION_AUTHORITY = Object.freeze({
  /* The prospect denied a claim the founder made. Beats any praise for
     having handled what they said. */
  explicit_correction: Object.freeze({ contradicts: ['handling_what_was_said'], establishes: null }),
  /* The information was not available. An accusation about not getting it
     is an accusation about the prospect. */
  explicit_refusal_to_answer: Object.freeze({ contradicts: [], establishes: 'information_unavailable' }),
  /* The call is over, or it is not a priority. "You should have pushed on"
     is not a finding after this. */
  explicit_refusal_to_proceed: Object.freeze({ contradicts: [], establishes: 'declined' }),
  explicit_do_not_contact: Object.freeze({ contradicts: [], establishes: 'declined' }),
  explicit_lack_of_priority: Object.freeze({ contradicts: [], establishes: 'declined' }),
  explicit_current_provider_satisfaction: Object.freeze({ contradicts: [], establishes: 'declined' }),
  /* Recorded, bounded, and deliberately given no power over any dimension:
     they are context, and reading quality into them is the sentiment door. */
  explicit_objection: Object.freeze({ contradicts: [], establishes: null }),
  explicit_clarification_request: Object.freeze({ contradicts: [], establishes: null }),
  explicit_prospect_question: Object.freeze({ contradicts: [], establishes: null }),
  explicit_permission_to_continue: Object.freeze({ contradicts: [], establishes: null }),
  explicit_answer: Object.freeze({ contradicts: [], establishes: null }),
});

const att = (x) => (x == null || x.attemptNo == null ? 1 : x.attemptNo);
const addr = (seq, a) => `${seq == null ? 'call' : seq}:${seq == null ? 0 : a}`;
const isPraise = (j) => j.verdict === 'YES' && accusatoryVerdictFor(j.dimension) !== 'YES';
const isAccusation = (j) => accusatoryVerdictFor(j.dimension) != null
  && j.verdict === accusatoryVerdictFor(j.dimension);

/* An identity derived from WHAT IS CLAIMED, never from a counter, so the
   same run twice produces the same ids and a replay can be compared. */
function findingId({ callId, kind, type, sequence, attemptNo, extra = '' }) {
  return `rf_${contentHash(`${callId}|${kind}|${type}|${addr(sequence, attemptNo)}|${extra}`)}`;
}

/* Which founder turn a prospect turn was answering: the last one actually
   delivered. A superseded attempt was replaced before the prospect heard
   the end of it, so binding their reply to it would credit or convict a
   sentence they never responded to. */
function deliveredFounderTurnBefore(turns, sequence) {
  const before = turns.filter((t) => t.speaker === 'founder' && t.sequence < sequence);
  if (!before.length) return null;
  const maxSeq = Math.max(...before.map((t) => t.sequence));
  const atSeq = before.filter((t) => t.sequence === maxSeq);
  return atSeq.reduce((a, b) => (att(b) > att(a) ? b : a));
}

/* ════════════════════════════════════════════════════════════════════
   THE RECONCILIATION. Pure: same inputs in, same rows out, every time.
   Inputs are read and never written -- the events, the reactions and the
   judgements leave exactly as they arrived.
   ══════════════════════════════════════════════════════════════════ */
export function reconcile({
  call, candidateEvents = [], reactions = [], judgements = [],
  answerKey = null, retryContext = null,
} = {}) {
  const callId = (call && call.callId) || 'unknown';
  const turns = (call && call.turns) || [];
  const rows = [];
  const emit = (row) => { rows.push(row); return row; };

  /* ── 1. HARD EVIDENCE. Nothing below may overrule it. ─────────────── */
  const hardByTurn = new Map();
  const notInterpretable = new Set();
  candidateEvents.forEach((e) => {
    if (!e) return;
    const bears = HARD_BEARS_ON[e.eventType] || { polarity: 'neutral', dimensions: [] };
    const supported = e.authority === EVENT_AUTHORITY.SUPPORTED;
    const key = addr(e.subjectSequence, e.subjectAttemptNo);
    if (e.eventType === 'turn_not_interpretable') notInterpretable.add(key);
    if (supported) {
      if (!hardByTurn.has(key)) hardByTurn.set(key, []);
      hardByTurn.get(key).push({ ...e, bears });
    }
    emit({
      findingId: findingId({ callId, kind: KIND.HARD_EVENT, type: e.eventType,
        sequence: e.subjectSequence, attemptNo: e.subjectAttemptNo, extra: e.eventId }),
      kind: KIND.HARD_EVENT,
      eventType: e.eventType,
      dimension: null,
      sequence: e.subjectSequence,
      attemptNo: e.subjectAttemptNo,
      verdict: null,
      polarity: bears.polarity,
      authority: AUTHORITY.HARD,
      deterministic: true,
      citations: e.citations || [],
      sourceEvidenceIds: [e.eventId],
      status: supported ? STATUS.SUPPORTED : STATUS.WITHHELD,
      reason: supported ? e.authorityBasis : `producer_withheld:${e.authorityBasis}`,
      conflictsSuppressed: [],
    });
  });

  /* ── 1b. THE ONE FAULT DECIDED HERE ───────────────────────────────
     Every other hard row arrives from a producer. This one is derived in
     place, for the same reason the answer key is read here: the evidence is
     the transcript, and the transcript is already in the room.

     "Pitched a non-buyer" is the only CRITICAL fault Practice issues and
     the only one whose ground truth the product privately holds --
     Controlled Uncertainty chooses the hidden role before the call starts.
     Judged against that hidden role it would convict founders who read an
     ambiguous prospect exactly as a competent rep would, on evidence no one
     listening to the recording could point at. So the hidden role decides
     who ANSWERS and never who was WRONG, and the gate takes only what was
     said: an affirmed, self-asserted disclaimer of authority, followed by a
     pitch. Ambiguity acquits.

     THE ACQUITTAL IS RECORDED TOO. A line that looked like a disclaimer and
     failed the bar emits a WITHHELD row naming the refusal, so "we declined
     to convict, because it was a question" is auditable. A call where
     nothing of the kind was said emits nothing -- there was no fault to
     consider. */
  /* ── AND IT DEFERS TO THE CANONICAL EVENT ─────────────────────────
     The extractor now emits `pitched_a_non_buyer` itself, from its own
     transcript proof that the sentence asserts an offer. This producer keys
     on `founderAction`, which the BROWSER writes -- so where both speak, the
     server-derived one is the authority and this one stands down, or one
     fault would be convicted twice by two authorities.

     It is not deleted, because it is still the only thing that records the
     ACQUITTAL -- "this looked like a disclaimer and failed the bar" -- on
     the turns the canonical producer says nothing about. */
  const canonicalNonBuyerPitch = new Set(candidateEvents
    .filter((e) => e && e.eventType === 'pitched_a_non_buyer'
      && e.authority === EVENT_AUTHORITY.SUPPORTED)
    .map((e) => Number(e.subjectSequence)));
  turns.filter((t) => t && t.speaker === 'founder'
    && !canonicalNonBuyerPitch.has(Number(t.sequence))
    && PITCH_ACTIONS.has(String(t.founderAction || ''))).forEach((t) => {
    const g = pitchedDisclaimedNonBuyerAdmissible({
      turns, pitch: { sequence: t.sequence, action: t.founderAction },
    });
    if (!g.pass && !g.refusedBecause) return;
    const source = g.pass ? g.disclaimedAt : g.consideredAt;
    const disclaimer = turns.find((x) => x.sequence === source && x.speaker === 'prospect');
    const pnbId = findingId({ callId, kind: KIND.HARD_EVENT, type: 'pitched_a_non_buyer',
      sequence: t.sequence, attemptNo: att(t), extra: String(source) });
    const row = {
      findingId: pnbId,
      kind: KIND.HARD_EVENT,
      eventType: 'pitched_a_non_buyer',
      dimension: null,
      sequence: t.sequence,
      attemptNo: att(t),
      verdict: null,
      polarity: HARD_BEARS_ON.pitched_a_non_buyer.polarity,
      authority: AUTHORITY.HARD,
      deterministic: true,
      /* Both halves of the fault, quoted: what they said, and what was said
         back. A critical fault the founder cannot check is not proof. */
      citations: [
        ...(disclaimer ? [{ sequence: disclaimer.sequence, attemptNo: att(disclaimer),
          speaker: 'prospect', quote: String(disclaimer.text || '') }] : []),
        { sequence: t.sequence, attemptNo: att(t), speaker: 'founder', quote: String(t.text || '') },
      ],
      /* ITS OWN SOURCE, because it has no producer. Section 3b finds the
         winning hard row by `sourceEvidenceIds[0] === eventId`; leaving this
         empty still suppressed contradicted praise but recorded no
         `suppressedBy`, so the founder would be shown a finding removed by
         something the set could not name. */
      sourceEvidenceIds: [pnbId],
      status: g.pass ? STATUS.SUPPORTED : STATUS.WITHHELD,
      reason: g.reason,
      conflictsSuppressed: [],
    };
    if (g.pass) {
      const key = addr(t.sequence, att(t));
      if (!hardByTurn.has(key)) hardByTurn.set(key, []);
      hardByTurn.get(key).push({ ...row, eventId: pnbId, bears: HARD_BEARS_ON.pitched_a_non_buyer });
    }
    emit(row);
  });

  /* ── 2. EXPLICIT REACTIONS. Facts about what the prospect said, and
     nothing more. An unenumerated or withheld reading carries no
     authority: it is recorded and it bounds nothing. ────────────────── */
  const contradictedBehaviours = new Map();   /* founder turn key -> Set(behaviour) */
  const establishedAt = [];                   /* { sequence, establishes, id }      */
  const unavailableAt = new Set();            /* founder turn keys                  */
  reactions.forEach((r) => {
    if (!r) return;
    const rule = REACTION_AUTHORITY[r.eventType];
    const enumerated = REACTION_TYPES.includes(r.eventType) && !!rule;
    const supported = r.authority === EVENT_AUTHORITY.SUPPORTED && enumerated;
    const answering = deliveredFounderTurnBefore(turns, r.subjectSequence);
    const answeringKey = answering ? addr(answering.sequence, att(answering)) : null;

    const id = findingId({ callId, kind: KIND.REACTION, type: r.eventType,
      sequence: r.subjectSequence, attemptNo: r.subjectAttemptNo, extra: r.eventId });

    if (supported) {
      if (rule.contradicts.length && answeringKey) {
        if (!contradictedBehaviours.has(answeringKey)) contradictedBehaviours.set(answeringKey, new Map());
        rule.contradicts.forEach((b) => contradictedBehaviours.get(answeringKey).set(b, id));
      }
      if (rule.establishes === 'information_unavailable' && answeringKey) unavailableAt.add(answeringKey);
      if (rule.establishes === 'declined') establishedAt.push({ sequence: r.subjectSequence, id });
    }

    emit({
      findingId: id,
      kind: KIND.REACTION,
      eventType: r.eventType,
      dimension: null,
      sequence: r.subjectSequence,
      attemptNo: r.subjectAttemptNo,
      verdict: null,
      polarity: 'neutral',
      authority: AUTHORITY.REACTION,
      deterministic: true,
      citations: r.citations || [],
      sourceEvidenceIds: [r.eventId],
      answersFounderTurn: answeringKey,
      corroboratesEventId: r.corroboratesEventId || null,
      status: supported ? STATUS.SUPPORTED : STATUS.WITHHELD,
      reason: supported ? r.authorityBasis
        : (enumerated ? `producer_withheld:${r.authorityBasis}` : 'reaction_not_enumerated'),
      conflictsSuppressed: [],
    });
  });

  /* The answer key is the same fact from the other side: a question the
     prospect refused or could not answer was not information the founder
     failed to get. Both sources feed ONE set, so a call that records it in
     only one of them is still protected. */
  turns.filter((t) => t.speaker === 'founder').forEach((t) => {
    if (!answerKey) return;
    const d = wasDiscoverable(answerKey, t.text);
    if (d.discoverable === false) unavailableAt.add(addr(t.sequence, att(t)));
  });
  (answerKey && answerKey.entries || []).forEach((e) => {
    if (e.prospectWithheld !== true
      && e.state !== ANSWER_STATE.REFUSED && e.state !== ANSWER_STATE.UNKNOWN_TO_PROSPECT) return;
    (e.evidence || []).filter((c) => c.speaker === 'founder')
      .forEach((c) => unavailableAt.add(addr(c.sequence, att(c))));
  });

  const declinedFrom = establishedAt.length ? Math.min(...establishedAt.map((x) => x.sequence)) : null;
  const declinedBy = establishedAt.length
    ? establishedAt.slice().sort((a, b) => a.sequence - b.sequence)[0].id : null;

  /* ── 3. THE JUDGE. Everything here can be overruled. ──────────────── */
  const nuanceRows = [];
  /* An id derived from WHAT WAS CLAIMED, never from where it sat in the
     array. Using the arrival index made the whole reconciled set depend on
     the order the judge happened to emit its answers in, which is a replay
     failure disguised as a working one. Two byte-identical claims are
     indistinguishable and are numbered within their own content group, so
     reordering them cannot change the set. */
  const contentKey = (j, subject) => `${j.verdict}|${addr(subject.sequence, subject.attemptNo)}`
    + `|${contentHash(j.citations || [])}|${contentHash(String(j.rationale == null ? '' : j.rationale))}`;
  const contentSeen = new Map();
  judgements.forEach((j) => {
    if (!j || !DIMENSIONS[j.dimension]) return;
    const isCall = CALL_DIMENSIONS.includes(j.dimension);
    const subject = isCall
      ? { sequence: j.selection ? j.selection.sequence : null, attemptNo: j.selection ? att(j.selection) : null }
      : { sequence: j.sequence, attemptNo: att(j) };
    const ck = `${j.dimension}|${addr(j.sequence, j.attemptNo)}|${contentKey(j, subject)}`;
    const nth = contentSeen.get(ck) || 0;
    contentSeen.set(ck, nth + 1);
    nuanceRows.push(emit({
      findingId: findingId({ callId, kind: KIND.NUANCE_JUDGEMENT, type: j.dimension,
        sequence: j.sequence, attemptNo: j.attemptNo,
        extra: `${contentKey(j, subject)}|${nth}` }),
      kind: KIND.NUANCE_JUDGEMENT,
      eventType: null,
      dimension: j.dimension,
      sequence: j.sequence,
      attemptNo: j.attemptNo,
      subject,
      behaviour: BEHAVIOUR_OF[j.dimension] || null,
      verdict: j.verdict,
      polarity: isAccusation(j) ? 'negative' : (isPraise(j) ? 'positive' : 'neutral'),
      authority: AUTHORITY.NUANCE,
      deterministic: false,
      citations: j.citations || [],
      sourceEvidenceIds: [],
      status: STATUS.SUPPORTED,
      reason: 'admitted_by_judge_contract',
      codeNote: j.codeNote || null,
      conflictsSuppressed: [],
    }));
  });

  const suppress = (row, reason, byId) => {
    if (row.status !== STATUS.SUPPORTED) return;
    row.status = STATUS.SUPPRESSED;
    row.reason = reason;
    row.suppressedBy = byId || null;
    if (byId) {
      const winner = rows.find((r) => r.findingId === byId);
      if (winner && !winner.conflictsSuppressed.includes(row.findingId)) {
        winner.conflictsSuppressed.push(row.findingId);
      }
    }
  };
  const withhold = (row, reason) => {
    if (row.status !== STATUS.SUPPORTED) return;
    row.status = STATUS.WITHHELD;
    row.reason = reason;
  };

  /* 3a. A TURN VISION DID NOT HEAR CANNOT BE JUDGED. Not badly, not well. */
  nuanceRows.forEach((row) => {
    const key = addr(row.subject.sequence, row.subject.attemptNo);
    if (row.subject.sequence != null && notInterpretable.has(key)) {
      withhold(row, 'turn_not_interpretable');
    }
  });

  /* 3b. HARD BEATS NUANCE on the same move, in whichever direction.

     No status check here on purpose. ONE GUARD, ONE PLACE: suppress() and
     withhold() are the only things allowed to change a row's status, and
     they refuse to touch one that is already decided. A second copy of that
     check here would make the real one unreachable, and an unreachable
     guard is one nothing can prove still works. */
  nuanceRows.forEach((row) => {
    const key = addr(row.subject.sequence, row.subject.attemptNo);
    (hardByTurn.get(key) || []).forEach((e) => {
      if (!e.bears.dimensions.includes(row.dimension)) return;
      const winner = rows.find((r) => r.kind === KIND.HARD_EVENT
        && r.sourceEvidenceIds[0] === e.eventId);
      if (e.bears.polarity === 'negative' && row.polarity === 'positive') {
        suppress(row, `praise_contradicted_by_hard_finding:${e.eventType}`, winner && winner.findingId);
      }
      if (e.bears.polarity === 'positive' && row.polarity === 'negative') {
        suppress(row, `accusation_contradicted_by_hard_finding:${e.eventType}`, winner && winner.findingId);
      }
    });
  });

  /* 3c. AN EXPLICIT REACTION BEATS NUANCE where it addresses the same
     factual claim -- and only there. */
  nuanceRows.forEach((row) => {
    if (row.status !== STATUS.SUPPORTED) return;
    const key = addr(row.subject.sequence, row.subject.attemptNo);

    /* The prospect said the claim was wrong. Praise for handling what they
       said cannot survive them saying it was not what they said. */
    const contradicted = contradictedBehaviours.get(key);
    if (contradicted && row.polarity === 'positive' && contradicted.has(row.behaviour)) {
      suppress(row, 'praise_contradicted_by_prospect_correction', contradicted.get(row.behaviour));
      return;
    }

    /* The information was never available. An accusation here is an
       accusation about the prospect, wearing the founder's name. */
    if (row.polarity === 'negative' && unavailableAt.has(key)) {
      withhold(row, 'accusation_on_information_the_prospect_did_not_have');
      return;
    }

    /* After an explicit decline, "you should have pressed on" is not a
       fault. "You pressed on anyway" still is -- and that has a hard
       producer, which is why this only fires where no hard finding does. */
    if (row.polarity === 'negative' && declinedFrom != null
      && row.subject.sequence != null && row.subject.sequence > declinedFrom
      && ['next_move_fit', 'pitch_relevance'].includes(row.dimension)
      && !(hardByTurn.get(key) || []).some((e) => e.bears.polarity === 'negative')) {
      suppress(row, 'accusation_against_an_established_decline', declinedBy);
    }
  });

  /* 3d. NUANCE AGAINST NUANCE. Two answers to one question, or praise and
     a fault about one behaviour. Resolve on evidence, or withhold both --
     never split the difference. */
  const byQuestion = new Map();
  nuanceRows.filter((r) => r.status === STATUS.SUPPORTED).forEach((r) => {
    const k = `${r.dimension}|${addr(r.sequence, r.attemptNo)}`;
    if (!byQuestion.has(k)) byQuestion.set(k, []);
    byQuestion.get(k).push(r);
  });
  byQuestion.forEach((group) => {
    if (group.length < 2) return;
    const verdicts = new Set(group.map((r) => r.verdict));
    if (verdicts.size === 1) {
      /* The same answer twice is one answer. Which copy survives is decided
         by the id, never by arrival order -- otherwise the same call
         reconciles two ways depending on how the judge ordered its batch. */
      const keep = group.slice().sort((x, y) => x.findingId.localeCompare(y.findingId))[0];
      group.filter((r) => r !== keep).forEach((r) => suppress(r, 'duplicate_judgement', keep.findingId));
      return;
    }
    const strength = (r) => (r.citations || []).length;
    const best = Math.max(...group.map(strength));
    const leaders = group.filter((r) => strength(r) === best)
      .sort((x, y) => x.findingId.localeCompare(y.findingId));
    if (leaders.length === 1) {
      group.filter((r) => r !== leaders[0])
        .forEach((r) => suppress(r, 'contradicted_by_better_evidenced_judgement', leaders[0].findingId));
    } else {
      group.forEach((r) => withhold(r, 'unresolved_nuance_contradiction'));
    }
  });

  /* Praise and a fault about the SAME behaviour on the SAME move. The
     fault is the one that survives: a founder reading "well handled" beside
     "you overstated them" learns nothing, and the fault is the load-bearing
     half. */
  const byBehaviour = new Map();
  nuanceRows.filter((r) => r.status === STATUS.SUPPORTED && r.behaviour
    && r.subject.sequence != null).forEach((r) => {
    const k = `${addr(r.subject.sequence, r.subject.attemptNo)}|${r.behaviour}`;
    if (!byBehaviour.has(k)) byBehaviour.set(k, []);
    byBehaviour.get(k).push(r);
  });
  byBehaviour.forEach((group) => {
    const negative = group.filter((r) => r.polarity === 'negative')
      .sort((x, y) => x.findingId.localeCompare(y.findingId))[0];
    if (!negative) return;
    group.filter((r) => r.polarity === 'positive')
      .forEach((r) => suppress(r, 'praise_contradicted_by_a_supported_fault_on_the_same_behaviour',
        negative.findingId));
  });

  /* ── 4. THE SEMANTIC NAMED FAULT ──────────────────────────────────────
     `unsupported_assumption` is in Step 3's vocabulary and has no producer,
     so a retry coached on one has no fault to be judged against. A judge
     finding may stand in for it -- and ONLY on the terms below, because the
     alternative is a model's opinion entering the record wearing a
     deterministic event's clothes.

       the exact founder claim is quoted, AND
       something the prospect actually said, or a fact VISION verified,
         is quoted against it, AND
       the judge contract already admitted the finding.

     Authority is `nuance`, `deterministic` is false, and it says which
     judgement it came from. It is never a hard event and must never be
     counted as one. */
  const verifiedText = (arr) => (arr || []).map((f) => String(typeof f === 'string' ? f : (f && f.value) || ''))
    .join(' ').toLowerCase();
  const semanticFaults = [];
  nuanceRows.filter((r) => r.status === STATUS.SUPPORTED && r.polarity === 'negative'
    && HARD_BEARS_ON.unsupported_assumption.dimensions.includes(r.dimension)
    && r.subject.sequence != null).forEach((r) => {
    const key = addr(r.subject.sequence, r.subject.attemptNo);
    const own = (r.citations || []).filter((c) => c.sequence === r.subject.sequence
      && att(c) === r.subject.attemptNo);
    const against = (r.citations || []).filter((c) => !(c.sequence === r.subject.sequence
      && att(c) === r.subject.attemptNo));
    const claimQuoted = own.some((c) => String(c.quote || '').trim().length > 0);
    /* ── AND THE QUOTE HAS TO SAY SOMETHING ────────────────────────────
       The two rules above are kept exactly as they were: the founder's own
       words quoted, and a prospect line quoted against them. What was
       missing is the one in between — that the quoted turn CLAIMS anything
       at all. "So how is business?" asserts no business fact and was
       admissible as an unsupported assumption on three of four behaviour
       modes, because a non-empty quote was the whole test.

       Read from the TURN, not the citation: a judge may quote three words
       out of a sentence, and whether the founder made a claim is a property
       of what they said, not of what was excerpted. */
    const judged = turns.find((x) => x.sequence === r.subject.sequence
      && att(x) === r.subject.attemptNo);
    const claimText = (judged && judged.text) || own.map((c) => c.quote).join(' ');
    const asserted = assertsSomething(claimText);
    const contradicting = against.filter((c) => {
      const t = turns.find((x) => x.sequence === c.sequence && att(x) === att(c));
      return t && t.speaker === 'prospect';
    });
    const row = {
      findingId: findingId({ callId, kind: KIND.SEMANTIC_FAULT, type: 'unsupported_assumption',
        sequence: r.subject.sequence, attemptNo: r.subject.attemptNo, extra: r.findingId }),
      kind: KIND.SEMANTIC_FAULT,
      eventType: 'unsupported_assumption',
      dimension: r.dimension,
      sequence: r.subject.sequence,
      attemptNo: r.subject.attemptNo,
      verdict: null,
      polarity: 'negative',
      /* NEVER `hard`. This is the whole point of the row existing. */
      authority: AUTHORITY.NUANCE,
      deterministic: false,
      derivedFrom: r.findingId,
      citations: r.citations || [],
      sourceEvidenceIds: [],
      status: STATUS.SUPPORTED,
      reason: 'semantic_fault_from_admitted_nuance_finding',
      conflictsSuppressed: [],
    };
    if (!claimQuoted) withhold(row, 'semantic_fault_without_the_founder_claim_quoted');
    else if (!asserted.pass) withhold(row, `semantic_fault_on_a_turn_that_claims_nothing:${asserted.reason}`);
    else if (!contradicting.length) withhold(row, 'semantic_fault_without_contradicting_evidence');
    /* A real producer would outrank this. If Step 3 ever grows one, the
       hard event is already in the room and this becomes redundant. */
    else if ((hardByTurn.get(key) || []).some((e) => e.eventType === 'unsupported_assumption')) {
      suppress(row, 'semantic_fault_superseded_by_a_deterministic_producer');
    }
    if (row.status === STATUS.SUPPORTED) semanticFaults.push(row);
    emit(row);
    void verifiedText;
  });

  /* ── 5. THE RETRY'S NAMED FAULT ───────────────────────────────────────
     What the retry is judged against. A deterministic fault on the replaced
     attempt is the answer where one exists; a supported semantic fault is
     the answer where one does not. Where there is neither, the fault has no
     name and the retry stays UNCERTAIN -- which is the honest result, not a
     gap to be filled with a guess. */
  const namedFaults = ((retryContext && retryContext.coached) || []).map((c) => {
    const key = addr(c.sequence, c.fromAttempt);
    const hard = (hardByTurn.get(key) || []).filter((e) => e.bears.polarity === 'negative');
    if (hard.length) {
      return { sequence: c.sequence, fromAttempt: c.fromAttempt, toAttempt: c.toAttempt,
        fault: hard.map((e) => e.eventType).join(' and '), authority: AUTHORITY.HARD,
        sourceEvidenceIds: hard.map((e) => e.eventId), evaluable: true };
    }
    const semantic = semanticFaults.filter((s) => s.sequence === c.sequence && s.attemptNo === c.fromAttempt);
    if (semantic.length) {
      return { sequence: c.sequence, fromAttempt: c.fromAttempt, toAttempt: c.toAttempt,
        fault: semantic.map((s) => s.eventType).join(' and '), authority: AUTHORITY.NUANCE,
        sourceEvidenceIds: semantic.map((s) => s.findingId), evaluable: true };
    }
    return { sequence: c.sequence, fromAttempt: c.fromAttempt, toAttempt: c.toAttempt,
      fault: null, authority: null, sourceEvidenceIds: [], evaluable: false,
      reason: 'no_named_fault_on_the_replaced_attempt' };
  });

  /* A retry judgement with no fault to be judged against is not a verdict.
     And a retry that repaired what it was told to repair while doing
     something else supported and wrong is not a clean YES -- the hard
     finding on the retry attempt says so, and it outranks the judge. */
  const faultBySeq = new Map(namedFaults.map((f) => [f.sequence, f]));
  nuanceRows.filter((r) => r.dimension === 'retry_repaired'
    && r.status === STATUS.SUPPORTED).forEach((r) => {
    const named = faultBySeq.get(r.sequence);
    if (!named || !named.evaluable) {
      if (r.verdict !== 'UNCERTAIN') withhold(r, 'retry_judged_without_a_named_fault');
      return;
    }
    r.namedFault = { fault: named.fault, authority: named.authority,
      sourceEvidenceIds: named.sourceEvidenceIds };
    if (r.verdict !== 'YES') return;
    const key = addr(r.sequence, r.attemptNo);
    const fresh = (hardByTurn.get(key) || []).filter((e) => e.bears.polarity === 'negative');
    if (!fresh.length) return;
    const persisted = fresh.filter((e) => String(named.fault).includes(e.eventType));
    const winner = rows.find((x) => x.kind === KIND.HARD_EVENT
      && x.sourceEvidenceIds[0] === fresh[0].eventId);
    suppress(r, persisted.length
      ? `repair_claimed_but_the_named_fault_persists:${persisted.map((e) => e.eventType).join(',')}`
      : `clean_repair_contradicted_by_a_new_supported_fault:${fresh.map((e) => e.eventType).join(',')}`,
    winner && winner.findingId);
  });

  /* ── 6. THE SET, IN A STABLE ORDER ────────────────────────────────── */
  const KIND_RANK = { hard_event: 0, reaction: 1, semantic_fault: 2, nuance_judgement: 3 };
  const findings = rows.slice().sort((a, b) => (
    (a.sequence == null ? -1 : a.sequence) - (b.sequence == null ? -1 : b.sequence)
    || (a.attemptNo == null ? 0 : a.attemptNo) - (b.attemptNo == null ? 0 : b.attemptNo)
    || KIND_RANK[a.kind] - KIND_RANK[b.kind]
    || String(a.eventType || a.dimension).localeCompare(String(b.eventType || b.dimension))
    || a.findingId.localeCompare(b.findingId)));

  const tally = (pick) => findings.reduce((acc, f) => {
    const k = pick(f); if (k == null) return acc; acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});

  return Object.freeze({
    version: RECONCILER_VERSION,
    callId,
    findings,
    namedFaults,
    ledger: Object.freeze({
      total: findings.length,
      byStatus: tally((f) => f.status),
      byAuthority: tally((f) => f.authority),
      byKind: tally((f) => f.kind),
      suppressionReasons: tally((f) => (f.status === STATUS.SUPPRESSED ? f.reason : null)),
      withheldReasons: tally((f) => (f.status === STATUS.WITHHELD ? f.reason : null)),
    }),
    /* One hash over the decided set. Two runs that disagree disagree here. */
    replayHash: contentHash(findings.map((f) => [f.findingId, f.status, f.reason,
      f.authority, f.verdict, (f.conflictsSuppressed || []).slice().sort()])),
  });
}

/* What downstream is allowed to read. Nothing suppressed, nothing withheld,
   and every row still carrying the authority it earned -- so a consumer that
   wants only deterministic findings can have them, and one that takes the
   semantic rows knows exactly what it took. */
export function authoritative(result) {
  return (result && result.findings || []).filter((f) => f.status === STATUS.SUPPORTED);
}
