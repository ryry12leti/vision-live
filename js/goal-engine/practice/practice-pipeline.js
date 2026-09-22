/* ════════════════════════════════════════════════════════════════════════
   THE ONE POST-CALL PATH.

   Before this file there were two ways a claim about the founder could reach
   their score: through the Reconciler, or straight out of the behaviour
   engine's `detected_events` and `founder_action` into the rubric. The second
   route ignored every precedence rule Phase 6 exists to enforce, which meant
   a founder could be marked down for information the prospect never had and
   the Reconciler would never hear about it.

   THE OLD CLASSIFIER IS NOW A PRODUCER, NOT AN AUTHORITY. Its per-turn fault
   claims are converted into candidate evidence and put THROUGH reconciliation
   with everything else. What comes out the other side is projected back onto
   the rows the frozen rubric reads. The rubric is untouched, the weights are
   untouched, and the only thing that changed is which claims survive to be
   weighed.

   SILENCE IS NOT ACQUITTAL. A fault label is downgraded only where the
   Reconciler ACTIVELY decided against it -- suppressed or withheld. Reading
   "the Reconciler said nothing" as "no fault" would hand every founder a free
   pass on every rule that has no producer yet, which is most of them.

   NOTHING HERE SCORES. It decides which evidence is allowed in front of the
   rubric, and the rubric does the rest.
   ══════════════════════════════════════════════════════════════════════ */
import { effectiveComplete } from './evidence-extraction.js';
import { buildJudgeContext } from './nuance-judge-context.js';
import { decideBestMove, BEST_MOVE_VERSION } from './best-move.js';
import { waysToSay, notTheirOwnWords, SAY_IT_VERSION } from './say-it.js';
import { composerInput, composerBatchPrompt, validateAlternatives, callVocabulary,
  COMPOSER_BATCH_SCHEMA, COMPOSER_VERSION } from './wording-composer.js';
import { reconcile, authoritative, AUTHORITY, STATUS, KIND, RECONCILER_VERSION }
  from './judgement-reconciler.js';
import { makeEvent, citation, PRODUCER, AUTHORITY as EVENT_AUTHORITY, NEGATIVE_TYPES }
  from './candidate-events.js';
import { scorePractice, RUBRIC_VERSION, TRACK } from './scoring-rubric.js';
import { buildReview } from './practice-review.js';
/* Re-exported, not redefined: existing importers take it from here. */
export { endingReasonOf } from './practice-evidence.js';
import { endingReasonOf } from './practice-evidence.js';
import { COACHING, COACHING_KEY } from './guided-coaching.js';
import { editorPrompt, readEditorCards, EDITOR_BATCH_SCHEMA, EDITOR_VERSION }
  from './wording-editor.js';
import { applyMoveGate, gateLines } from './move-adherence.js';
import { coercionAdmissible, unspentDisclaimer } from './evidence-gates.js';
import { observeCall } from './mastery-observation.js';
import { NUANCE_JUDGE_PROMPT_VERSION } from './nuance-judge-model.js';

export const PIPELINE_VERSION = 'practice_pipeline_v1';

const attOf = (t) => Number(t && (t.attempt_no ?? t.attemptNo)) || 1;
const key = (seq, att) => `${seq}:${att}`;
const textOf = (t) => String((t && (t.content ?? t.text)) || '');

/* ── THE OLD CLASSIFIER'S CLAIMS, AS CANDIDATE EVIDENCE ───────────────
   Each fault the behaviour engine recorded on a turn becomes an event that
   must survive reconciliation like any other. `coached:` markers are NOT
   claims about the founder -- they are the record of what VISION interrupted
   for -- so they are carried through untouched. */
const LEGACY_FAULTS = Object.freeze({
  /* THE ONE THE ENGINE ITSELF DECIDED. Every other entry here is a regex
     label the rule engine may overrule; this is the behaviour engine's own
     terminal state change, which is why it is deliberately absent from
     RULE_ENGINE_PRODUCES below -- the rule engine has no producer for it,
     so its silence about the turn is not a decline. */
  conversation_ended_by_founder: 'conversation_ended_by_founder',
  /* The behaviour engine's own terminal judgement about HOW the founder
     spoke, carried separately from whether the prospect managed to end
     the call. Deliberately NOT in SCORED_FAULTS and NOT in the
     Reconciler's HARD_BEARS_ON: it must be rankable as the dominant
     leak without adding a second negative weight to any axis. The
     ceiling is the scoring mechanism, and a ceiling is a min(), not a
     subtraction -- earlier valid evidence keeps its full value and
     simply cannot lift the total past the cap. */
  founder_hostility: 'founder_hostility',
  unsupported_assumption: 'unsupported_assumption',
  pitched_without_permission: 'pitched_without_permission',
  question_repeated: 'question_repeated',
  pressure_applied: 'pressure_applied',
  sold_after_do_not_contact: 'sold_after_do_not_contact',
  unearned_close: 'unearned_close',
});
/* A fault-bearing action label, and what it becomes when the Reconciler
   refuses the fault behind it. The replacement is always the same behaviour
   with the accusation removed -- never a better one. */
const FAULT_ACTIONS = Object.freeze({
  unsupported_assumption: { event: 'unsupported_assumption', neutral: 'grounded_observation' },
  premature_pitch: { event: 'pitched_without_permission', neutral: 'pitch' },
  repetition: { event: 'question_repeated', neutral: 'generic_question' },
  pressure: { event: 'pressure_applied', neutral: 'objection_response' },
});

/* Event types the RULE ENGINE has a producer for. Where it examined a turn
   and did not emit one of these, it DECLINED -- it read the same words
   through polarity, attribution, qualification and the answer key, all of
   which the behaviour engine's plain regex has none of. That decline
   outranks the regex.

   This is not theoretical. On the strongest call in the corpus the
   behaviour engine reads "what would you need to see before you'd change
   anything?" -- a good discovery question -- as PRESSURE, because the words
   "you" and "need to" are adjacent. Entered as hard evidence it scored that
   call BELOW a call whose whole problem was pitching something the prospect
   had just said they did not want. */
export const RULE_ENGINE_PRODUCES = Object.freeze(['sold_after_do_not_contact', 'pressure_applied',
  'unearned_close', 'pitched_without_permission', 'question_repeated',
  'weak_discovery', 'objection_not_handled']);

export function legacyCandidates(turns = [], sessionId = 'practice', ruleEvents = []) {
  const out = [];
  const ruleSaw = new Set();
  const ruleRefused = new Set();
  ruleEvents.forEach((e) => {
    if (e.eventType === 'turn_not_interpretable') ruleRefused.add(key(e.subjectSequence, e.subjectAttemptNo));
    if (e.authority === EVENT_AUTHORITY.SUPPORTED) {
      ruleSaw.add(`${key(e.subjectSequence, e.subjectAttemptNo)}|${e.eventType}`);
    }
  });
  turns.filter((t) => t.speaker === 'founder').forEach((turn) => {
    const subject = { sequence: turn.sequence, attemptNo: attOf(turn), text: textOf(turn) };
    const cite = citation(subject, textOf(turn));
    if (!cite) return;
    const claimed = new Set();
    (turn.detected_events || []).forEach((e) => {
      if (LEGACY_FAULTS[e]) claimed.add(LEGACY_FAULTS[e]);
    });
    const fromAction = FAULT_ACTIONS[turn.founder_action];
    if (fromAction) claimed.add(fromAction.event);
    const k = key(turn.sequence, attOf(turn));
    claimed.forEach((eventType) => {
      /* The stronger producer looked at this turn and said no.

         ONE EXCEPTION, and only because the rule engine's silence about
         pressure is not always a judgement. Its only pressure producer is
         `pressure_after_refusal`, which cannot fire before anyone has
         refused -- so on a founder who coerces from a standing start it has
         no rule to apply, and saying nothing is all it can do. Reading that
         silence as "examined and declined" is what buried the strongest
         evidence on the law call.

         Where it genuinely had a rule this changes nothing: after a hard
         refusal it emits its own supported finding and `ruleSaw` already
         spares the claim. So the exception only reaches turns it was never
         able to speak about -- and even there the claim must clear the same
         two gates the rule engine applies to its own pressure rule, which
         is what keeps the good discovery question out. */
      const overruled = RULE_ENGINE_PRODUCES.includes(eventType)
        && !ruleRefused.has(k) && !ruleSaw.has(`${k}|${eventType}`)
        && !(eventType === 'pressure_applied' && coercionAdmissible(subject.text).pass);
      try {
        out.push(makeEvent({
          sessionId, producer: PRODUCER.RULE, producerVersion: 'practice_behaviour_engine',
          ruleId: `behaviour_${eventType}`, ruleVersion: 'v1', eventType, subject,
          citations: [cite],
          authority: overruled ? EVENT_AUTHORITY.WITHHELD : EVENT_AUTHORITY.SUPPORTED,
          authorityBasis: overruled
            ? 'rule_engine_examined_this_turn_and_declined'
            : 'behaviour_engine_detected_event',
        }));
      } catch { /* a claim that cannot cite its own turn is not a claim */ }
    });
  });
  return out;
}

/* ── PROJECTION ───────────────────────────────────────────────────────
   The rows the rubric reads, rebuilt so that every fault claim on them has
   been through reconciliation. Nothing else about the row is touched: the
   transcript, the timings, the delivery measurements and the neutral
   behaviour labels arrive and leave exactly as they were. */
/* The same table, read from the event's side, plus the order to resolve two
   supported faults on one turn: worst first. */
const FAULT_BY_EVENT = Object.freeze({
  /* FIRST, because it is the worst thing on the list. Selling to someone who
     has just told you they cannot buy does not merely cost points on this
     turn -- it spends the offer on a person who could never accept it, and
     the call is over whatever else was done well. */
  pitched_a_non_buyer: { action: 'non_buyer_pitch', neutral: 'pitch' },
  sold_after_do_not_contact: { action: 'pressure', neutral: 'objection_response' },
  pressure_applied: { action: 'pressure', neutral: 'objection_response' },
  unsupported_assumption: { action: 'unsupported_assumption', neutral: 'grounded_observation' },
  pitched_without_permission: { action: 'premature_pitch', neutral: 'pitch' },
  question_repeated: { action: 'repetition', neutral: 'generic_question' },
});
const FAULT_SEVERITY = Object.freeze(Object.keys(FAULT_BY_EVENT));

/* THE FAULTS THE RUBRIC IS ALLOWED TO WEIGH. `NEGATIVE_TYPES` is the RULE
   ENGINE's vocabulary, and `pitched_a_non_buyer` has no rule-engine producer
   -- the Reconciler derives it from the transcript. Gating the projection on
   the producer enum alone would have left the one CRITICAL fault out of the
   score entirely while it sat, supported, in the finding set. */
const SCORED_FAULTS = new Set([...NEGATIVE_TYPES, 'pitched_a_non_buyer',
  'conversation_ended_by_founder']);

/* ── SEAM 1: STORED ROWS -> THE RECONCILED CALL ───────────────────────
   THE ACTION LABEL TRAVELS WITH THE TURN. `pitched_a_non_buyer` is decided
   inside the Reconciler from the transcript, and the one thing the
   transcript alone cannot say is whether a founder turn WAS a pitch. This
   projection dropped `founder_action`, so the gate saw every turn as
   unclassified and could never fire on a real call -- green suites the whole
   way, because every test built its own turns.

   The raw engine label is the right input: projectScoringTurns rewrites it
   AFTER reconciliation, and a fault may not be judged against a label that
   reconciliation produced.

   Exported so the seam regression can check the hand-off itself rather than
   inferring from what came out the far end. */
export function assembleCallTurns(turns = []) {
  return turns.map((t) => ({
    sequence: t.sequence, attemptNo: attOf(t), speaker: t.speaker, text: textOf(t),
    /* THE COLUMN IS `turn_complete`. This read `t.complete` only, which a
       database row never has, so `undefined !== false` made EVERY replayed
       turn look finished -- including the ones the assembler had recorded
       as cut off mid-thought. Measured across 36 real staging calls: it
       cost 10 of 164 events, and the rules it silently disarmed are the
       two that exist for unfinished speech, `turn_not_interpretable` and
       `repair_after_cut`. Its neighbours two lines up already accept both
       spellings; this one was simply missed, and it has been degrading
       live scoring, not just replay. */
    /* P5R-7.1: the same server-side derivation the extractor uses. A call
       that continued past a turn proves that turn ended, so a claimed
       `turn_complete: false` on an accepted, non-final turn is overruled.
       Both assemblies share ONE rule; two spellings of it is how the
       `t.complete` bug below happened in the first place. */
    complete: effectiveComplete(t, turns),
    founderAction: t.founder_action || null,
  }));
}

/* ── P5R-7.3: WHO SAYS A TURN WAS SUPERSEDED? ─────────────────────────
   `branch` is written by the client -- `coalesce(p_branch,'accepted')` goes
   straight into the row and `practice_turn_append_v1` still has EXECUTE for
   `authenticated`. The rubric drops `branch === 'superseded'` from
   `founderTurns()`, so on an identical transcript a founder could mark their
   own turns superseded and take the overall score to NULL. Canonical
   evidence and Mastery survived it, but "was this call scored at all" was
   still the client's to decide.

   THE SERVER ALREADY DERIVES THIS FACT. `supersededAttempts()` has always
   computed supersession from ATTEMPTS -- which attempt at a sequence was
   replaced by a later one -- and `buildJudgeContext` stamps it onto the
   rendered transcript. The bug was that it only ever ADDED the mark; a
   client claim on an unreplaced turn passed straight through to scoring.

   For a RESERVED session the derived answer is now the whole answer: a turn
   is superseded iff a higher attempt exists at its sequence. The claim is
   not consulted.

   WHY THAT CANNOT BE FORGED INTO A DELETION. To suppress a turn you must
   supply a higher attempt at the same sequence -- a replacement turn, with
   content, which is then scored in its place. You cannot erase a turn, only
   substitute one, and substituting is what a retry IS. Verified against
   staging first: the one real reserved superseded row has both a higher
   attempt AND a server-owned guided event, so no legitimate row moves.

   LEGACY (non-reserved) SESSIONS ARE UNTOUCHED. They predate the
   reservation protocol and 5 of their 8 superseded rows are abandoned
   attempts with no replacement; re-admitting those would score speech a
   founder retracted. Narrowing that is a turn-protocol change, not this
   repair. */
export function projectScoringTurns(turns = [], reconciled, { reserved = false } = {}) {
  const latestAttempt = new Map();
  turns.forEach((t) => {
    if (!t || t.speaker !== 'founder') return;
    const sq = Number(t.sequence);
    const at = attOf(t);
    if (!latestAttempt.has(sq) || at > latestAttempt.get(sq)) latestAttempt.set(sq, at);
  });
  const derivedSuperseded = (t) => attOf(t) < (latestAttempt.get(Number(t.sequence)) ?? attOf(t));

  const supported = new Map();
  const decidedAgainst = new Map();
  (reconciled && reconciled.findings || []).forEach((f) => {
    if (f.kind !== KIND.HARD_EVENT && f.kind !== KIND.SEMANTIC_FAULT) return;
    if (f.sequence == null) return;
    const k = key(f.sequence, f.attemptNo == null ? 1 : f.attemptNo);
    const bag = f.status === STATUS.SUPPORTED ? supported : decidedAgainst;
    if (!bag.has(k)) bag.set(k, new Set());
    bag.get(k).add(f.eventType);
  });

  return turns.map((t) => {
    if (t.speaker !== 'founder') return t;
    const k = key(t.sequence, attOf(t));
    const ok = supported.get(k) || new Set();
    const no = decidedAgainst.get(k) || new Set();

    const events = (t.detected_events || []).filter((e) => {
      if (/^coached:/.test(String(e))) return true;          /* retry metadata, not a claim */
      if (!LEGACY_FAULTS[e]) return true;                    /* not a fault claim at all */
      return ok.has(LEGACY_FAULTS[e]);
    });
    /* A supported fault the row never carried -- a semantic assumption the
       judge established, say -- is added, so the rubric weighs everything
       the Reconciler stood behind and nothing it did not. */
    ok.forEach((e) => { if (SCORED_FAULTS.has(e) && !events.includes(e)) events.push(e); });

    const liveAction = t.founder_action;
    let action = liveAction;
    let revisedDirection = null;
    const fault = FAULT_ACTIONS[action];
    /* SILENCE IS NOT ACQUITTAL: downgrade only on an explicit refusal. */
    if (fault && !ok.has(fault.event) && no.has(fault.event)) {
      action = fault.neutral;
      revisedDirection = 'downgraded';
    }
    /* And the reverse, or the mapping only ever works in the founder's
       favour: a fault the Reconciler STOOD BEHIND must reach the rubric even
       when the behaviour engine labelled the turn as the clean version of
       the same move. Only the exact neutral label is upgraded, so nothing
       unrelated is overwritten. */
    for (const eventType of FAULT_SEVERITY) {
      if (!ok.has(eventType)) continue;
      const up = FAULT_BY_EVENT[eventType];
      if (up && action === up.neutral) { action = up.action; revisedDirection = 'upgraded'; break; }
    }

    /* ── THE LIVE READ AND THE FINAL READ CAN DISAGREE ──────────────────
       Live Guided Reaction reports `liveAction` the instant the turn
       happens, off the deterministic engine alone -- it has no transcript to
       hand a judge and no budget to ask one per turn. The Reconciler runs
       afterward with the whole call and a real model call behind it, and it
       is allowed to overrule the deterministic read in EITHER direction: a
       turn the engine cleared can turn out to have been a violation the
       judge caught (upgraded), and a turn the engine flagged can turn out to
       have been fine after all (downgraded).

       Found on a real staging call: the deterministic gate cleared a pitch
       (need and trust both past threshold) and Guided Live Reaction told the
       founder "Interest ↑ — you connected the offer to a problem they
       revealed." The judge read the same transcript afterward and decided
       the need was never actually established, and biggestLeak reversed it
       to "You sold before they gave you a reason to." — with nothing on
       either screen acknowledging VISION had just told the founder the
       opposite. The judge was right to catch it; the silence was the
       defect. `revisedFromLive` carries that fact through the same seam
       `founder_action` already survives, so the review can say so instead
       of presenting the reversal as though the live read never happened. */
    const revisedFromLive = revisedDirection ? { liveAction, direction: revisedDirection } : null;

    /* On a reserved session the branch is the SERVER's answer, not the
       row's. Elsewhere the row's value stands, unchanged. */
    const branch = reserved
      ? (derivedSuperseded(t) ? 'superseded' : 'accepted')
      : t.branch;
    return { ...t, detected_events: events, founder_action: action, revisedFromLive, branch };
  });
}

/* The rubric's own repeat detector re-reads the transcript. The rule engine
   already answered that question, and it answered it with a citation, so the
   answer is taken from the reconciled set instead of computed a second time
   from the same words by a different threshold. */
export function deadQuestionsFrom(reconciled, turns = []) {
  const out = new Map();
  authoritative(reconciled).filter((f) => f.eventType === 'question_repeated')
    .forEach((f) => {
      const prior = (f.citations || []).find((c) => c.speaker === 'founder' && c.sequence !== f.sequence);
      out.set(f.sequence, prior ? prior.sequence : f.sequence);
    });
  /* A repeat the rule engine withheld is not a repeat. Nothing is added. */
  void turns;
  return out;
}

/* ── BIGGEST WIN / BIGGEST LEAK ───────────────────────────────────────
   From the reconciled set, in precedence order, and NEVER from the weakest
   category. A call with nothing defensibly wrong with it gets no leak, which
   is a true answer that the old path could not produce. */
/* Severity order, unchanged for everything that was already in it. An
   objection left standing costs more than an unearned close — the founder
   has been told why they will not buy and carried on anyway. A weak
   question costs the least of anything here: it wastes a turn rather than
   damaging the call. */
/* FIRST, AND NOT ARGUABLY. Every other entry is something that cost the
   founder ground on a call that carried on afterwards. This one is the turn
   after which there was no call: the prospect had left. A review that ranks
   a mid-call framing mistake above the sentence that ended the conversation
   is telling the founder the wrong thing about their own worst moment --
   observed on the first real staging call, where the call screen said the
   last response caused them to disengage and the review then named a weak
   discovery question as the biggest leak and never mentioned the hangup. */
const LEAK_RANK = ['conversation_ended_by_founder', 'founder_hostility',
  'sold_after_do_not_contact', 'pitched_a_non_buyer',
  'pressure_applied', 'unsupported_assumption',
  'objection_not_handled', 'pitched_without_permission', 'unearned_close',
  'question_repeated', 'weak_discovery'];
const LEAK_HEADLINE = Object.freeze({
  conversation_ended_by_founder: 'This is the line they ended the call on.',
  founder_hostility: 'This is how you spoke to them.',
  sold_after_do_not_contact: 'You kept selling after they asked you to stop.',
  pitched_a_non_buyer: 'You sold to someone who had told you it was not their call.',
  pressure_applied: 'You pushed after they had said no.',
  unsupported_assumption: 'You assumed instead of confirming.',
  pitched_without_permission: 'You sold before they gave you a reason to.',
  objection_not_handled: 'You carried on with the objection still standing.',
  weak_discovery: 'That question asked them to do the work.',
  unearned_close: 'You asked for time you had not earned.',
  question_repeated: 'You asked again for something they had already answered.',
});
const WIN_HEADLINE = Object.freeze({
  repair_of: 'You fixed it when VISION stopped you.',
  repair_after_cut: 'You picked it back up cleanly.',
});

const rowFor = (turns, seq, att) => turns.find((t) => t.speaker === 'founder'
  && t.sequence === seq && attOf(t) === (att == null ? 1 : att)) || null;

/* ── HOW IT ENDED, IN THE FOUNDER'S WORDS ─────────────────────────────
   Two causes reach `conversation_ended_by_founder` and they are not the
   same mistake, so they do not get the same sentence. The reason travels on
   the turn as an `ended_because:` tag rather than being re-derived here:
   the behaviour engine decided which of the two it was, and this only reads
   the decision back.

   Where the tag is missing -- a call stored before this existed -- the
   headline stays true to what IS known: the call ended on this turn. It
   never guesses which of the two it was. */
const ENDING_COPY = Object.freeze({
  hostility_from_founder: {
    headline: 'This is the line they ended the call on.',
    why: 'They left after this. Nothing said afterwards could reach them, because there was no longer anyone to say it to.',
  },
  pushed_too_hard: {
    headline: 'You were still pushing when they left.',
    why: 'They had made their position clear and the next move went at them again, so they ended it rather than repeat themselves.',
  },
});

/* ONE SOURCE FOR BOTH SENTENCES. The leak card renders a headline and an
   explanation under it, and they come from two different layers -- the
   selection and the correction plan. The plan's last-resort wording is
   `LEAK_HEADLINE[eventType]`, so a new event type that only declares a
   headline renders that headline TWICE, once as the heading and once as the
   explanation. This file has fixed that exact duplication once before.

   Returns null for every other event type, so nothing else changes. */
export function endingCopy(turns, sequence, attemptNo) {
  return ENDING_COPY[endingReasonOf(rowFor(turns, sequence, attemptNo))] || null;
}

/* ── WHEN THE FINAL READ DISAGREES WITH THE LIVE ONE ───────────────────
   Computed here, once, and carried on `piped.win`/`piped.leak` from the
   moment they exist -- NOT recomputed downstream. `buildReviewPayload`
   (review-projection.js) states its own job as "renames things; decides
   nothing", and a second copy of this table there would be exactly the
   two-producers-disagree defect every seam in this file exists to prevent.
   Two sentences, not a technical one -- `direction` is the only thing that
   picks between them, never the specific fault or event name, so this reads
   the same whether the turn was a pitch, a claim or a close. */
const REVISION_NOTE = Object.freeze({
  upgraded: 'This looked like a good move in the moment. A closer look afterward showed it was not.',
  downgraded: 'This was flagged in the moment. A closer look afterward showed it held up better than that.',
});

const moment = (turns, seq, att) => {
  const t = rowFor(turns, seq, att);
  if (!t) return null;
  const atMs = typeof t.audio_start_ms === 'number' ? t.audio_start_ms : null;
  return {
    sequence: t.sequence, attemptNo: attOf(t), rowId: key(t.sequence, attOf(t)),
    said: textOf(t), atMs, endMs: t.audio_end_ms ?? null,
    seekMs: atMs == null ? null : Math.max(0, atMs - 2000),
    /* Carried from projectScoringTurns, unchanged. null on every turn the
       Reconciler agreed with the deterministic engine about -- which is
       most of them. */
    revisedFromLive: t.revisedFromLive || null,
    revisionNote: t.revisedFromLive ? (REVISION_NOTE[t.revisedFromLive.direction] || null) : null,
  };
};

export function selectWinLeak(reconciled, turns = []) {
  const live = authoritative(reconciled);

  /* LEAK. Hard evidence first, then the judge's own selection, then a
     semantic fault. If none of the three is there, there is no leak. */
  const hard = live.filter((f) => f.kind === KIND.HARD_EVENT && LEAK_RANK.includes(f.eventType))
    .sort((a, b) => LEAK_RANK.indexOf(a.eventType) - LEAK_RANK.indexOf(b.eventType));
  const judgeLeak = live.find((f) => f.dimension === 'biggest_leak' && f.verdict === 'YES');
  const semantic = live.filter((f) => f.kind === KIND.SEMANTIC_FAULT);

  let leak = null;
  if (hard[0]) {
    const copy = hard[0].eventType === 'conversation_ended_by_founder'
      ? endingCopy(turns, hard[0].sequence, hard[0].attemptNo) : null;
    leak = { ...moment(turns, hard[0].sequence, hard[0].attemptNo), eventType: hard[0].eventType,
      authority: AUTHORITY.HARD, findingId: hard[0].findingId, citations: hard[0].citations,
      headline: (copy && copy.headline) || LEAK_HEADLINE[hard[0].eventType] || 'This cost the call.',
      reason: hard[0].reason };
  } else if (judgeLeak && judgeLeak.subject && judgeLeak.subject.sequence != null) {
    leak = { ...moment(turns, judgeLeak.subject.sequence, judgeLeak.subject.attemptNo),
      eventType: 'biggest_leak', authority: AUTHORITY.NUANCE, findingId: judgeLeak.findingId,
      citations: judgeLeak.citations, headline: 'This is what cost the call most.',
      reason: judgeLeak.rationale || judgeLeak.reason };
  } else if (semantic[0]) {
    leak = { ...moment(turns, semantic[0].sequence, semantic[0].attemptNo),
      eventType: semantic[0].eventType, authority: AUTHORITY.NUANCE, findingId: semantic[0].findingId,
      citations: semantic[0].citations, headline: LEAK_HEADLINE[semantic[0].eventType],
      reason: semantic[0].reason };
  }
  if (leak && leak.sequence == null) leak = null;

  /* WIN. A hard repair outranks an opinion; otherwise the judge's own
     selection, which is the question "which turn helped most". */
  const hardWin = live.find((f) => f.kind === KIND.HARD_EVENT && WIN_HEADLINE[f.eventType]);
  const judgeWin = live.find((f) => f.dimension === 'biggest_win' && f.verdict === 'YES');
  let win = null;
  if (hardWin) {
    win = { ...moment(turns, hardWin.sequence, hardWin.attemptNo), eventType: hardWin.eventType,
      authority: AUTHORITY.HARD, findingId: hardWin.findingId, citations: hardWin.citations,
      headline: WIN_HEADLINE[hardWin.eventType], reason: hardWin.reason };
  } else if (judgeWin && judgeWin.subject && judgeWin.subject.sequence != null) {
    win = { ...moment(turns, judgeWin.subject.sequence, judgeWin.subject.attemptNo),
      eventType: 'biggest_win', authority: AUTHORITY.NUANCE, findingId: judgeWin.findingId,
      citations: judgeWin.citations, headline: 'This is what helped the call most.',
      reason: judgeWin.rationale || judgeWin.reason };
  }
  if (win && win.sequence == null) win = null;

  /* ── ONE TURN CANNOT BE THE WIN AND THE CONVICTION ───────────────────
     P5R-4. Measured on Call D: sequence 9 was shown as BOTH "This is what
     helped the call most" and "You asked for time you had not earned" -- the
     same sentence, on the same screen, praised and convicted. A seller
     reading that learns nothing except that the product is not paying
     attention.

     The tie is broken by AUTHORITY, not by preference. A hard deterministic
     fault is cited evidence about a specific turn; a `biggest_win` is the
     judge's opinion about which turn helped most, and the judge is off by
     default. So when they collide, the conviction stands and the WIN is
     withdrawn -- never the other way round, because dropping the fault would
     hide evidence, while dropping the win only withholds praise.

     A win the judge asserted at hard-fault authority would be a genuine
     contradiction rather than a precedence question; there is no such
     shape today, and if one appears it must be reconciled explicitly rather
     than silently resolved here. */
  if (win && leak && win.sequence === leak.sequence
    && (win.attemptNo || 1) === (leak.attemptNo || 1)) {
    if (leak.authority === AUTHORITY.HARD && win.authority !== AUTHORITY.HARD) {
      win = null;
    } else if (win.authority === AUTHORITY.HARD && leak.authority !== AUTHORITY.HARD) {
      /* Symmetric only in shape: a hard WIN outranks a soft leak on the same
         turn for the same reason -- cited evidence beats an opinion. */
      leak = null;
    } else {
      /* Same authority, same turn. Neither outranks the other, so neither is
         presented as the headline: showing both would be the original defect
         and picking one arbitrarily would be worse. */
      win = null; leak = null;
    }
  }
  return { win, leak };
}

/* ── THE CORRECTION PLAN ──────────────────────────────────────────────
   Two or three moments, decided here and phrased later. What was wrong and
   what supports it are LOCKED before any wording layer sees them, and
   `whatYouSaid` is copied from the transcript rather than regenerated -- the
   founder must be able to recognise their own sentence.

   The CORRECTION_ACTION map that used to sit here fed the retired
   client-library author (`correctionFor`, Phase 5 WP-1) and nothing else;
   with one author the wording is decided by the locked move + waysToSay
   below, so the fault→library-key translation had nothing left to
   translate for. */
/* Turn classifications that are RELIABLY a question. From the behaviour
   engine's own vocabulary, so this stays a lookup rather than a second
   reading of the transcript.

   `generic_question` is deliberately absent. It is the classifier's
   catch-all for a non-question statement as well as for a short question —
   "Right, so the close is slipping every month and your team is completely
   overloaded with it." came back as `generic_question` on canonical staging
   — so trusting it here would describe an assertion as a question, which is
   the same error in the opposite direction. That classifier default is a
   real defect, but `generic_question` also feeds scoreDiscovery(), so
   correcting it is a rubric change and not this one. Until then this set
   errs toward the wording that is safe when the label is ambiguous. */
const QUESTION_ACTIONS = new Set(['discovery_question', 'high_value_follow_up',
  'objection_exploration']);

/* The same fault, described as what it actually was. */
const ASKED_COPY = Object.freeze({
  unsupported_assumption: {
    why: 'You asked a question that already took something for granted they had not told you.',
    better: 'Ask it without the assumption built in.',
  },
});

/* Making the same mistake three times is a different problem from making it
   once, and needs a different instruction. */
/* A SHORT COUNT, NOT A SECOND INSTRUCTION. These used to carry their own
   advice and were then prefixed to the move's goal, so the card read "That
   is 2 assumptions now. Stop filling in the gaps and ask them what is
   actually true. Ask the thing you assumed." — the same instruction twice.
   The move says what to do; this only says how often it has come up. */
const REPEAT_MOVE = Object.freeze({
  unsupported_assumption: (n) => `${n} assumptions now.`,
  question_repeated: (n) => `Asked ${n} times now.`,
  pitched_without_permission: (n) => `${n} attempts to sell before they asked.`,
  unearned_close: (n) => `${n} asks for their time with nothing qualified.`,
  pressure_applied: (n) => `${n} pushes after a no.`,
});

export const MAX_CORRECTIONS = 3;
/* How many cards one fault type may ever occupy. */
export const REPEAT_CARD_LIMIT = 2;

/* WHAT ACTUALLY HAPPENED, or nothing. The only thing allowed in this field
   is an enumerated reaction the prospect gave on their next turn. Where there
   is none, the field says what the call state RISKED, and says that it is a
   risk -- inventing a consequence is the single most damaging thing a review
   can do, because the founder cannot check it. */
function observedConsequence(reconciled, sequence) {
  const next = authoritative(reconciled)
    .filter((f) => f.kind === KIND.REACTION && f.sequence > sequence)
    .sort((a, b) => a.sequence - b.sequence)[0];
  if (!next || next.sequence > sequence + 2) return null;
  return { kind: 'observed', reactionType: next.eventType, sequence: next.sequence,
    citations: next.citations || [], findingId: next.findingId };
}

/* ── WHICH THREE MISTAKES ARE WORTH A CARD ────────────────────────────
   Selection used to be: sort every fault by LEAK_RANK, take the first three.
   LEAK_RANK is a global severity order, so a call containing three
   assumptions and one premature pitch gave the founder three assumption
   cards and never mentioned the pitch — measured across all four behaviour
   modes on canonical staging, 2026-08-22: 12 of 12 cards were
   `unsupported_assumption`, while `pitched_without_permission` was
   correctly detected every time and shown zero times.

   Three things decide a card now, and they are kept apart on purpose:

     IMPACT     what the mistake cost the call. Read from LEAK_RANK, which
                is NOT changed here — it is the existing severity order and
                selectWinLeak() shares it.
     EVIDENCE   how firmly it is established. A hard rule event outranks the
                judge, and a fault the prospect visibly reacted to outranks
                one that passed without a trace.
     TEACHING   the first time a founder makes a mistake is when it can be
                taught. The third identical instance carries the same lesson
                and costs a slot that another mistake could have used.

   And one hard rule above all three: EVERY DISTINCT FAULT TYPE GETS A SLOT
   BEFORE ANY TYPE GETS A SECOND. A founder who made four different mistakes
   is owed four different lessons, not the same one three times. */
const impactOf = (f) => LEAK_RANK.length - LEAK_RANK.indexOf(f.eventType);
const evidenceOf = (f, reconciled) => {
  const authority = f.authority === AUTHORITY.HARD ? 3
    : f.authority === AUTHORITY.REACTION ? 2 : 1;
  /* The prospect reacting to it is the strongest corroboration there is. */
  return authority + (observedConsequence(reconciled, f.sequence) ? 2 : 0);
};
const rankOf = (f, reconciled, firstOfType) => (impactOf(f) * 10)
  + (evidenceOf(f, reconciled) * 3) + (firstOfType ? 2 : 0);

/* Hard evidence outranks the judge. The reconciler already holds this rule
   between findings that CONTRADICT each other; this is the same rule applied
   where two findings merely COMPETE for one card. */
const AUTHORITY_RANK = { hard: 3, reaction: 2, nuance: 1 };
const authorityOf = (f) => AUTHORITY_RANK[f.authority] || 0;

/* ── ONE CAUSAL EXCEPTION, AND ONLY ONE ───────────────────────────────
   An assumption made WHILE arguing past an open objection is not an
   independent mistake — it is what the founder reached for in order to keep
   going. Global severity ranks assumptions above objections, so the card
   named the symptom and the founder was coached to verify his claim when
   what actually lost the call was that he never dealt with the objection.

   This does NOT reorder LEAK_RANK. Everywhere else — a different turn, no
   objection open, a stronger safety finding on the same turn — precedence is
   untouched. The exception fires only when one turn carries both faults,
   both supported, at the same authority, and only in that direction.

   "Already active BEFORE the turn" is read from the finding's own citations
   rather than recomputed from call state. The rule engine only ever emits
   this fault against an objection that was open beforehand, and it cites
   that earlier turn; asking the selector to re-derive the state would give
   the pipeline a second opinion about when an objection was open, which is
   how the close predicate ended up split in two. */
const CONTROLLING = 'objection_not_handled';
const CAUSED = 'unsupported_assumption';
const objectionPredatesTurn = (f) => (f.citations || [])
  .some((c) => typeof c.sequence === 'number' && c.sequence < f.sequence);

function controllingFault(a, b) {
  const obj = [a, b].find((x) => x.f.eventType === CONTROLLING);
  const asm = [a, b].find((x) => x.f.eventType === CAUSED);
  if (!obj || !asm) return null;
  if (obj.f.status !== STATUS.SUPPORTED || asm.f.status !== STATUS.SUPPORTED) return null;
  if (authorityOf(obj.f) !== authorityOf(asm.f)) return null;
  if (!objectionPredatesTurn(obj.f)) return null;
  return obj;
}

export function selectCorrections(faults, reconciled, max = MAX_CORRECTIONS, moveOf = null) {
  const scored = faults.map((f) => {
    const firstOfType = !faults.some((x) => x.eventType === f.eventType
      && (x.sequence < f.sequence
        || (x.sequence === f.sequence && (x.attemptNo || 1) < (f.attemptNo || 1))));
    return { f, rank: rankOf(f, reconciled, firstOfType) };
  }).sort((a, b) => b.rank - a.rank || a.f.sequence - b.f.sequence);

  /* ── ONE CARD PER MOMENT, AND THE HARD FINDING WINS IT ────────────────
     A founder said ONE thing at a given turn, so it gets one card. Which
     finding that card is about used to be decided by rank alone — and rank
     leads with impact, where `unsupported_assumption` outranks
     `unearned_close`. So a judge finding on the same turn as a supported
     hard event took the card and the hard event vanished from the review
     entirely.

     Reproduced exactly: judge OFF gave `unsupported_assumption,
     unearned_close`; judge ON gave `unsupported_assumption` twice, with the
     reconciler reporting ZERO suppressions. The reconciler was right all
     along — it never touches a hard row. The displacement was here.

     Authority decides a contested moment, and only then rank. This is the
     reconciler's own precedence (hard > reaction > nuance) applied where two
     findings compete for a card rather than contradict each other. */
  const byMoment = new Map();
  for (const c of scored) {
    const k = key(c.f.sequence, c.f.attemptNo);
    const held = byMoment.get(k);
    if (!held) { byMoment.set(k, c); continue; }
    const causal = controllingFault(c, held);
    if (causal) { byMoment.set(k, causal); continue; }
    const stronger = authorityOf(c.f) - authorityOf(held.f) || c.rank - held.rank;
    if (stronger > 0) byMoment.set(k, c);
  }
  const pool = [...byMoment.values()]
    .sort((a, b) => b.rank - a.rank || a.f.sequence - b.f.sequence);

  const chosen = []; const perType = new Map();
  const take = (c) => {
    chosen.push(c);
    perType.set(c.f.eventType, (perType.get(c.f.eventType) || 0) + 1);
  };
  /* Round one: the strongest surviving instance of each distinct fault type,
     types offered in the order of their best instance. */
  for (const type of [...new Set(pool.map((c) => c.f.eventType))]) {
    if (chosen.length >= max) break;
    const pick = pool.find((c) => c.f.eventType === type && !chosen.includes(c));
    if (pick) take(pick);
  }
  /* Round one-and-a-half: A SECOND CARD SHOULD TEACH A SECOND LESSON.
     Two faults of DIFFERENT types can still land on the same Best Move — a
     premature pitch and an unearned close in the same state are both "find
     the problem" — and the founder is then told the same thing twice.

     BUT DIVERSITY NEVER OUTRANKS IMPACT. A swap is allowed only for a
     candidate whose impact is at least that of the card it replaces:
     dropping a premature pitch to avoid repeating a lesson would quietly
     deprioritise the worse mistake, which is the opposite of the job.
     Where no such candidate exists the duplicate move stands, and the
     wording layer is told two moments share a move so it does not phrase
     them the same way. */
  if (moveOf && chosen.length > 1) {
    const movesTaken = new Set(chosen.map((c) => moveOf(c.f)));
    if (movesTaken.size < chosen.length) {
      const distinct = []; const spare = [];
      const used = new Set();
      for (const c of chosen) {
        const mv = moveOf(c.f);
        if (used.has(mv)) { spare.push(c); continue; }
        used.add(mv); distinct.push(c);
      }
      for (const c of pool) {
        if (distinct.length >= chosen.length) break;
        if (chosen.includes(c)) continue;
        const mv = moveOf(c.f);
        if (used.has(mv)) continue;
        if ((perType.get(c.f.eventType) || 0) >= REPEAT_CARD_LIMIT) continue;
        /* Only if it costs the founder nothing in severity. */
        const replacing = spare[distinct.length - (chosen.length - spare.length)] || spare[0];
        if (replacing && impactOf(c.f) < impactOf(replacing.f)) continue;
        used.add(mv); distinct.push(c);
      }
      while (distinct.length < chosen.length && spare.length) distinct.push(spare.shift());
      chosen.length = 0;
      distinct.forEach((c) => chosen.push(c));
    }
  }
  /* Round two: only once every type has had a turn may one repeat — and a
     type may repeat ONCE. Two instances establish a pattern; a third card
     carries the same lesson again and is padding, so fewer cards are shown
     instead. */
  for (const c of pool) {
    if (chosen.length >= max) break;
    if (chosen.includes(c)) continue;
    if ((perType.get(c.f.eventType) || 0) >= REPEAT_CARD_LIMIT) continue;
    take(c);
  }
  return chosen.sort((a, b) => b.rank - a.rank || a.f.sequence - b.f.sequence).map((c) => c.f);
}

export function correctionPlan(reconciled, turns = [], { profile = null, callState = null,
  handoff = null, composed = null } = {}) {
  const live = authoritative(reconciled);
  const faults = live.filter((f) => (f.kind === KIND.HARD_EVENT || f.kind === KIND.SEMANTIC_FAULT)
    && LEAK_RANK.includes(f.eventType) && f.sequence != null)
    .sort((a, b) => a.sequence - b.sequence || (a.attemptNo || 1) - (b.attemptNo || 1));

  const usedLines = new Set();
  /* Move diversity needs to know each fault's move, which needs the state
     at that fault's moment — so the selector is handed a resolver rather
     than the policy itself. Best Move policy is untouched. */
  const moveOf = (f) => decideBestMove({ state: stateAsAt(callState, f.sequence),
    fault: f.eventType }).moveId;
  return selectCorrections(faults, reconciled, MAX_CORRECTIONS, moveOf).map((f, index) => {
    const m = moment(turns, f.sequence, f.attemptNo);
    const coach = COACHING[COACHING_KEY[f.eventType]] || null;
    /* STATE FIRST, THEN THE MOVE, THEN THE WORDS. The move is decided from
       the call as it stood at this exact moment and from the fault being
       corrected; the wording layer is handed the result and has no say in
       it. `index` no longer picks alternatives — different moves produce
       different lines on their own. */
    const at = stateAsAt(callState, f.sequence);
    const move = decideBestMove({ state: at, fault: f.eventType });
    const said = m ? m.said : null;
    /* ACROSS THE WHOLE REVIEW, not just within one card. Two cards of the
       same move take different windows already, but a single line could
       still appear on both — and a founder reading the same sentence twice
       has been given one idea, not two. Reuse is allowed only if refusing
       it would leave a card with fewer than two ways to say the move,
       because one alternative is worse than a repeated one. */
    const offered = notTheirOwnWords(waysToSay({ move, profile, offset: index, max: 6 }), said);
    const fresh = offered.filter((l) => !usedLines.has(l.toLowerCase()));
    const deterministic = (fresh.length >= 2 ? fresh : offered).slice(0, 3);
    /* ── COMPOSED WORDING, IF IT SURVIVED VALIDATION ───────────────────
       The composer runs BEFORE this (it is async and the pipeline is not),
       and hands in a map keyed by moment. Its output has already been
       through validateAlternatives(); anything that reached here executes
       the same locked move. Two lines are the floor — a single composed
       line is worse than three honest deterministic ones. */
    const key2 = key(f.sequence, f.attemptNo);
    const fromModel = composed && composed[key2] && Array.isArray(composed[key2].kept)
      ? composed[key2].kept.filter((l) => !usedLines.has(l.toLowerCase())) : [];
    /* ── NOTHING REACHES THE FOUNDER UNGATED ───────────────────────────
       The deterministic lines used to skip the move gate entirely, so a
       card could fall back from rejected model wording onto a sentence that
       was off-move in exactly the same way. Observed live: a
       find_the_problem card fell back to "Who feels it most when that
       happens?", which asks who, not what it costs.

       If nothing survives, the card says so. An off-move sentence shown to
       fill the space teaches the wrong move with VISION's authority behind
       it, which is worse than showing none. */
    const gatedDeterministic = gateLines({ moveId: move.moveId, lines: deterministic, want: 3 }).lines;
    const alternatives = fromModel.length >= 2 ? fromModel.slice(0, 3) : gatedDeterministic;
    const wordingSource = fromModel.length >= 2 ? 'composed'
      : (gatedDeterministic.length ? 'deterministic' : 'none');
    alternatives.forEach((l) => usedLines.add(l.toLowerCase()));
    /* ── ASKED, OR TOLD? ────────────────────────────────────────────────
       The nuance judge can raise an assumption against a turn that was
       phrased as a QUESTION — "When it does spill over, who picks that up?"
       takes the spill-over for granted, and the prospect had just denied it.
       That is a real fault. But the coaching copy is written for an
       assertion, so the card headlined a question with "You told them
       something about their business that they never told you", which
       misdescribes what the founder actually did and reads as a mistake in
       the review rather than in the call.

       Decided from the turn's OWN recorded classification, never by looking
       at the text again: that is the reconciler's job and re-reading it here
       would make this a second classifier. */
    const row = rowFor(turns, f.sequence, f.attemptNo);
    const asked = QUESTION_ACTIONS.has((row && row.founder_action) || '');
    const worded = (asked && ASKED_COPY[f.eventType]) || null;
    /* How many times this same fault has already been shown. The second and
       third instance of one mistake do not need the same instruction as the
       first — they need to be told it is a pattern. */
    const repeat = faults.filter((x) => x.eventType === f.eventType
      && x.sequence < f.sequence).length;
    return {
      momentId: `pc_${f.findingId.replace(/^rf_/, '')}`,
      findingId: f.findingId,
      sequence: f.sequence,
      attemptNo: f.attemptNo,
      authority: f.authority,
      /* EXACTLY what they said. Never adapted, never tidied. */
      whatYouSaid: m ? m.said : null,
      atMs: m ? m.atMs : null,
      seekMs: m ? m.seekMs : null,
      /* Same composite moment() already computed. Without it a correction
         card's play button can seek the audio but cannot select the
         transcript row -- the highlight machinery keys on rowId, same as
         every other playable moment on the review screen. */
      rowId: m ? m.rowId : null,
      /* SAME FACT, SAME CARD IT WAS ALWAYS GOING TO REACH. moment() already
         computed this the moment revisedFromLive was produced -- a
         correction card teaching "you sold before they gave you a reason
         to" is the single most prominent place a founder reads the verdict
         this fault produced, more prominent than the leak card it usually
         sits beside, so it cannot be the one place that stays silent about
         where that verdict came from. */
      revisedFromLive: m ? m.revisedFromLive : null,
      revisionNote: m ? m.revisionNote : null,
      whatWasWrong: worded ? worded.why
        : (coach ? coach.why
          : ((endingCopy(turns, f.sequence, f.attemptNo) || {}).why
            || LEAK_HEADLINE[f.eventType] || 'This worked against the sale.')),
      eventType: f.eventType,
      citations: f.citations || [],
      whatHappened: observedConsequence(reconciled, f.sequence),
      /* ONLY WHEN THERE IS NO OBSERVED REACTION. This used to repeat
         whatWasWrong verbatim, so the card stated the same sentence twice
         under two different headings — and stated a RISK even where the
         prospect's actual reaction was already quoted directly above it. */
      riskIfUnobserved: observedConsequence(reconciled, f.sequence)
        ? null : (coach ? coach.why : null),
      betterDirection: worded ? worded.better : (coach ? coach.better : null),
      couldSayInstead: alternatives.slice(0, 3),
      /* False when every candidate failed the locked move. The card still
         carries the diagnosis and the Best Move; only the sentences are
         absent, and absent honestly. */
      wtsiAvailable: alternatives.length > 0,
      wordingSource,
      /* The goal, in the founder's language. A repeated fault says so as
         well, because the third instance needs naming as a pattern — but it
         never changes what the right move actually is. */
      bestMoveHere: repeat > 0 && REPEAT_MOVE[f.eventType]
        ? `${move.goal} ${REPEAT_MOVE[f.eventType](repeat + 1)}`
        : move.goal,
      bestMove: { id: move.moveId, goal: move.goal, why: move.why,
        because: move.because || [], subject: move.subject || null,
        version: move.version },
      repeatOf: repeat > 0 ? repeat + 1 : null,
      /* DELETED (Phase 5 WP-1): `personalised`. It was computed from a
         client-library line (`correctionFor`) that never reached the card,
         so the wire claimed personalisation for wording the founder never
         saw. The real register-awareness lives where the shown wording is
         made — waysToSay({ profile }) above — and needs no flag. */
    };
  });
}

/* The prepared-script alternatives are gone. They were the best available
   wording when nothing decided a strategic move first, and they were still
   whichever questions VISION happened to write down — offered whether or
   not they executed the right move. say-it.js replaces them: the move is
   chosen from state, then phrased. */

/* ── THE STATE AS IT STOOD, NOT AS IT ENDED ────────────────────────────
   Every fact in the call state records the sequence it became true at, and
   a correction is about a moment, so only the facts that were already true
   at that moment may inform it.

   Observed on canonical staging, 2026-08-22: a seven-turn call ended on a
   hard no at turn 11, and ALL THREE corrections — including the one about
   the opening line, turn 0 — were told "Accept the no and ask whether it is
   worth revisiting later." There was no no to accept when the founder said
   hello. Reading the final state for a moment three minutes earlier is the
   same class of mistake as scoring a close on qualification it only
   acquired afterwards. */
function stateAsAt(callState, sequence) {
  if (!callState) return null;
  const seq = typeof sequence === 'number' ? sequence : Infinity;
  const before = (x) => x && typeof x.atSeq === 'number' && x.atSeq <= seq;
  const basis = ((callState.qualification && callState.qualification.basis) || [])
    .filter((b) => before(b));
  const facts = callState.facts || {};
  return {
    refusal: before(callState.refusal) ? callState.refusal : { state: 'none', atSeq: null },
    pitchPermission: before(callState.pitchPermission)
      ? callState.pitchPermission : { granted: false, atSeq: null },
    qualification: { level: basis.length ? Math.max(...basis.map((b) => b.level || 0)) : 0, basis },
    /* An objection raised AFTER the moment cannot have been open during it. */
    activeObjection: before(callState.activeObjection) ? callState.activeObjection : null,
    facts: {
      disclosed: (facts.disclosed || []).filter((d) => before(d)),
      /* An unknown resolved later was still open then. */
      unknowns: (facts.unknowns || []).map((u) => (before(u) ? u : { ...u, status: 'open', atSeq: null })),
    },
    answeredQuestions: (callState.answeredQuestions || [])
      .filter((q) => typeof q.answeredAtSeq === 'number' && q.answeredAtSeq <= seq),
  };
}

/* ── THE COMPOSER PASS ────────────────────────────────────────────────
   Run BEFORE the pipeline, because the pipeline is synchronous and the
   model is not. It is handed the moves that were already decided and
   returns only wording, already validated. A caller that does not run it
   gets the deterministic lines and loses nothing it had.

   THE MOVE IS AUTHORITATIVE THROUGHOUT. This never sees a fault, a score or
   an authority — see COMPOSER_INPUT_FORBIDDEN — and its output is discarded
   wholesale if fewer than two lines survive. */
export async function composeWording({ plan = [], turns = [], callState = null,
  profile = null, callModel = null, editModel = null } = {}) {
  const out = {}; const audit = [];
  if (!callModel || !plan.length) return { composed: out, audit };

  const inputs = plan.map((card) => {
    const at = stateAsAt(callState, card.sequence);
    const prospectLines = turns.filter((t) => t.speaker === 'prospect'
      && t.sequence < card.sequence).slice(-2).map((t) => textOf(t));
    const openUnknown = ((at && at.facts && at.facts.unknowns) || [])
      .filter((u) => u.status !== 'resolved')[0];
    const input = composerInput({
      founderSaid: card.whatYouSaid,
      prospectLines,
      move: { moveId: card.bestMove.id, goal: card.bestMove.goal, because: card.bestMove.because },
      disclosedFacts: ((at && at.facts && at.facts.disclosed) || []).map((d) => d.text),
      openUnknown: openUnknown ? openUnknown.text : null,
      activeObjection: at && at.activeObjection ? at.activeObjection.said : null,
      refusalState: at && at.refusal ? at.refusal.state : 'none',
      style: profile && profile.traits ? profile.traits : null,
    });
    return input ? { ...input, moment: key(card.sequence, card.attemptNo), card } : null;
  }).filter(Boolean);
  if (!inputs.length) return { composed: out, audit };

  /* ONE REQUEST FOR THE WHOLE REVIEW. Three cards are about one
     conversation; three prompts carried the same transcript three times and
     left the model unable to see that two moments shared a move. */
  let res = null;
  try {
    res = await callModel({ prompt: composerBatchPrompt(inputs), schema: COMPOSER_BATCH_SCHEMA });
  } catch { res = null; }
  if (!res || res.ok !== true) {
    return { composed: out, version: COMPOSER_VERSION,
      audit: [{ ok: false, reason: (res && res.reason) || 'call_failed' }] };
  }

  /* Grounding is judged against what THIS call actually contains. */
  const vocabulary = callVocabulary(inputs);
  const byMoment = new Map(inputs.map((i) => [i.moment, i]));
  const seen = new Set();
  for (const produced of (res.parsed.cards || [])) {
    const input = byMoment.get(String(produced.moment || ''));
    if (!input) { audit.push({ moment: produced.moment, ok: false, reason: 'unknown_moment' }); continue; }
    const checked = validateAlternatives({ alternatives: produced.alternatives || [],
      move: { moveId: input.card.bestMove.id }, input, vocabulary });
    /* A line already used on another card is one idea, not two. */
    const fresh = checked.kept.filter((l) => !seen.has(l.toLowerCase()));
    fresh.forEach((l) => seen.add(l.toLowerCase()));
    audit.push({ moment: input.moment, sequence: input.card.sequence, ok: true,
      model: res.model, ms: res.ms, usage: res.usage,
      kept: fresh.length, rejected: checked.rejected,
      crossCardDropped: checked.kept.length - fresh.length });
    out[input.moment] = { kept: fresh, rejected: checked.rejected };
  }

  /* ── THE EDITOR, AND THE GATES ────────────────────────────────────
     The gates run whether or not an editor was configured. Wording that
     executes the wrong move is wrong wording, and until now the only thing
     between the composer and the founder was a grounding test -- so a line
     that searched for the problem when the move was to establish the
     situation reached him unchallenged, reading better than the right one. */
  const candidates = new Map(Object.entries(out).map(([m, v]) => [m, v.kept]));
  let edited = new Map();
  let editAudit = null;
  if (editModel && candidates.size) {
    try {
      const res = await editModel({ prompt: editorPrompt(inputs, candidates), schema: EDITOR_BATCH_SCHEMA });
      if (res && res.ok === true) {
        edited = readEditorCards(res.parsed);
        editAudit = { ok: true, model: res.model, ms: res.ms, usage: res.usage, version: EDITOR_VERSION };
      } else {
        editAudit = { ok: false, reason: (res && res.reason) || 'edit_call_failed', version: EDITOR_VERSION };
      }
    } catch { editAudit = { ok: false, reason: 'editor_threw', version: EDITOR_VERSION }; }
  }

  for (const [moment, entry] of Object.entries(out)) {
    const input = byMoment.get(moment);
    const moveId = input && input.card && input.card.bestMove && input.card.bestMove.id;
    const solLines = edited.get(moment) || [];
    /* ONE bounded rewrite, and only when the gate cannot fill two slots
       from everything already written. A second generation pass is how a
       validation step turns into a third opinion about the move. */
    const rewrite = (editModel && solLines.length)
      ? async ({ avoid }) => {
        try {
          const again = await editModel({
            prompt: `${editorPrompt([input], new Map([[moment, entry.kept]]))}\n\n`
              + 'These were rejected for not making the required move: '
              + `${(avoid || []).map((a) => `"${a}"`).join(' ')}\n`
              + 'Return two different lines that make it.',
            schema: EDITOR_BATCH_SCHEMA,
          });
          return again && again.ok === true ? (readEditorCards(again.parsed).get(moment) || []) : [];
        } catch { return []; }
      } : null;

    const gated = await applyMoveGate({ moveId, solLines, terraCandidates: entry.kept, rewrite, want: 2 });
    out[moment] = { kept: gated.lines, rejected: entry.rejected, gate: gated.audit,
      rewriteUsed: gated.rewriteUsed, wordingFrom: solLines.length ? 'editor' : 'composer' };
  }

  return { composed: out, audit, editAudit, version: COMPOSER_VERSION, editorVersion: EDITOR_VERSION };
}

/* ══ THE PIPELINE ════════════════════════════════════════════════════ */
export function runPracticePipeline({
  turns = [], session = {}, judgements = [], handoff = {},
  profile = null, audio = null, now = null, judgeModel = null, composed = null,
  wordingModel = null, wordingEditorModel = null,
  /* Phase 2 canonical evidence for this call, when the caller has it.
     Null means "derive it here", which is what a pre-Phase-2 session and
     every offline test still needs. */
  canonicalEvents = null,
} = {}) {
  const sessionId = session.id || 'practice';

  /* 1-5. The frozen deterministic layers, from the assembled call. */
  /* `branch` is deliberately NOT carried into the deterministic layers.
     interpretable() refuses a turn marked superseded, so passing the stored
     marker through erases the very fault the retry was coached on -- and
     then "did this retry repair the named mistake?" has no named mistake.
     buildJudgeContext derives supersession itself for the transcript it
     renders; the rules see the turns as they were spoken. */
  const assembled = assembleCallTurns(turns);
  const built = buildJudgeContext({ sessionId, callId: sessionId, turns: assembled,
    objective: session.objective || '', facts: (handoff && handoff.evidence && handoff.evidence.observed) || [],
    handoff, canonicalEvents });

  /* 6-7. Everything that claims anything, through ONE reconciliation. */
  const reconciled = reconcile({
    call: built.call,
    candidateEvents: built.context.candidateEvents
      .concat(legacyCandidates(turns, sessionId, built.context.candidateEvents)),
    reactions: built.context.reactions,
    judgements,
    answerKey: built.answerKey,
    retryContext: built.context.retryContext,
  });

  /* 8-9. Only what survived reaches the rubric. Weights untouched. */
  const scoringTurns = projectScoringTurns(turns, reconciled,
    { reserved: String(session?.sequencing_mode ?? session?.sequencingMode ?? '') === 'reserved' });
  /* ── WHICH DENOMINATOR ─────────────────────────────────────────────
     From the transcript, never from the simulator. A founder scored against
     a denominator chosen by something they cannot see is being judged on
     evidence they cannot check -- and the hidden role decides who ANSWERS,
     never who was wrong. An unspent disclaimer at the end of the call is a
     non-buyer call; a transfer hands the rest of it back to the buyer set. */
  const standing = unspentDisclaimer(scoringTurns.map((t) => ({
    speaker: t.speaker, text: textOf(t), sequence: t.sequence,
  })));
  const track = standing.present ? TRACK.NON_BUYER : TRACK.BUYER;
  /* ── ONE AUTHORITY FOR "DID THIS EVEN COME UP" ────────────────────────
     The opportunity outcomes the rubric consumes are derived by the SAME
     function mastery uses, from the SAME canonical events, rather than by a
     second reading of the transcript. Two readers of one question is how the
     rubric came to score `pitchTiming 10/10` on a call whose canonical
     evidence says `pitched_without_permission`.

     Null when there is no canonical evidence -- a legacy call, or a run that
     never completed -- and every axis then keeps its previous eligibility, so
     an unscored session cannot appear because evidence was missing. */
  /* ── THE RUBRIC AND THE RECONCILER MUST SEE THE SAME EVIDENCE ───────
     `buildJudgeContext` already derives the events itself when the caller
     supplies none, and the reconciler above judges the call on those. The
     rubric, though, was handed only the caller's `canonicalEvents` -- so on
     every path that does not pass them the reconciler used server-derived
     truth while the rubric fell back to the browser's `detected_events`.
     One call, two evidence sets, and the forgeable one did the grading.

     Using what the pipeline already computed is also what keeps a LEGACY
     session scorable: a call with no completed evidence run would otherwise
     reach the rubric blind, and every canonically-sourced axis would go
     `not_tested` -- fail-closed, but it would empty the score of a real
     call for a reason the founder had no part in. */
  const scoringEvents = (Array.isArray(canonicalEvents) && canonicalEvents.length)
    ? canonicalEvents
    : (built.context.candidateEvents || []).concat(built.context.reactions || []);
  let opportunityOutcomes = null;
  if (scoringEvents.length) {
    try {
      const observed = observeCall({
        sessionId: session?.id || 'scoring', sourceFingerprint: 'scoring',
        events: scoringEvents, track,
        /* The quality sources stay withdrawn here exactly as they are for
           mastery (P5R-0): they read client-authored columns. */
        quality: { followUps: null, grounding: null, objectionHandling: null, routing: null },
      });
      opportunityOutcomes = Object.fromEntries(observed.map((o) => [o.skill, o.opportunity]));
    } catch (_e) { opportunityOutcomes = null; }
  }

  const score = scorePractice({ turns: scoringTurns, session, now, track,
    dead: deadQuestionsFrom(reconciled, scoringTurns), opportunityOutcomes,
    /* Passed even when EMPTY: "the extractors ran and found nothing" is a
       different statement from "there was nothing to run", and only the
       second may fall back to the client's own columns. */
    canonicalEvents: scoringEvents });

  /* 10. The review, fed authoritative selections it may not second-guess. */
  const { win, leak } = selectWinLeak(reconciled, scoringTurns);
  const corrections = correctionPlan(reconciled, scoringTurns,
    { profile, callState: built.context.callState, handoff, composed });
  const contract = reviewContract(score);
  const review = buildReview({ review: contract, turns: scoringTurns, profile, audio,
    authoritative: { win, leak, corrections } });

  /* ── THE LABELS THE SCREEN HAS TO USE ─────────────────────────────
     The review timeline is rebuilt in the BROWSER, because only the browser
     has the audio and the founder's profile. It was rebuilt from the raw
     `practice_turns` rows, which carry the behaviour engine's original
     labels -- so every label reconciliation changed existed only on the
     server. A pitch convicted of `pitched_a_non_buyer` rendered on the real
     screen as "Offer made", not a leak: the exact opposite of what happened.

     The server owns the decision, so the server sends the decision. Nothing
     is recomputed client-side from this; it is the authoritative label and
     the events behind it, and the browser applies them before it builds
     anything. */
  const scoredTurns = scoringTurns.filter((t) => t.speaker === 'founder').map((t) => ({
    sequence: t.sequence, attempt_no: attOf(t),
    founder_action: t.founder_action || null,
    detected_events: t.detected_events || [],
  }));

  return {
    pipelineVersion: PIPELINE_VERSION,
    score,
    review,
    scoredTurns,
    reconciled,
    /* Exposed so a caller can run the composer over the moves this produced
       without rebuilding the state. Read-only: nothing downstream writes it. */
    callState: built.context.callState,
    /* THE EXACT EVIDENCE THE RUBRIC SCORED ON. The point of P5R is that a
       number is traceable to cited facts, and until now a caller could see
       the findings but not the evidence set the axes actually read -- so
       "score it again the same way" was not expressible. Read-only. */
    scoringEvents,
    opportunityOutcomes,
    win,
    leak,
    corrections,
    namedFaults: reconciled.namedFaults,
    /* WHICH DENOMINATOR PRODUCED THE NUMBER, and why. Carried so the
       progress layer can keep the two tracks apart without re-deriving it,
       and so an owner can see the evidence that chose it. */
    track,
    trackBecause: standing.reason,
    /* ── PROVENANCE. Enough to reproduce the number, and no model
       reasoning: the rationale a judgement carries is its evidence, and its
       chain of thought is not persisted anywhere. */
    provenance: {
      pipelineVersion: PIPELINE_VERSION,
      reconcilerVersion: RECONCILER_VERSION,
      judgePromptVersion: NUANCE_JUDGE_PROMPT_VERSION,
      judgeModel: judgeModel || null,
      rubricVersion: RUBRIC_VERSION,
      bestMoveVersion: BEST_MOVE_VERSION,
      sayItVersion: SAY_IT_VERSION,
      composerVersion: composed ? COMPOSER_VERSION : null,
      /* WHICH MOUTH SPOKE. The judge model was recorded and the wording
         models were not, so a review could not say afterwards whether a
         line came from a model or from the deterministic fallback -- and a
         model comparison run on this composer was unverifiable once the
         run was over. Both are named here, or null when nothing ran. */
      wordingModel: composed ? wordingModel : null,
      wordingEditorModel: composed ? wordingEditorModel : null,
      editorVersion: composed && wordingEditorModel ? EDITOR_VERSION : null,
      replayHash: reconciled.replayHash,
      overall: score.overallScore, sales: score.sales.score, delivery: score.delivery.score,
      authoritativeFindingIds: authoritative(reconciled).map((f) => f.findingId),
      suppressedFindingIds: reconciled.findings
        .filter((f) => f.status === STATUS.SUPPRESSED).map((f) => f.findingId),
      withheldFindingIds: reconciled.findings
        .filter((f) => f.status === STATUS.WITHHELD).map((f) => f.findingId),
      biggestWinId: win ? win.findingId : null,
      biggestLeakId: leak ? leak.findingId : null,
      correctionMomentIds: corrections.map((c) => c.momentId),
    },
  };
}

/* The review contract the frozen builder expects, from the frozen score. */
function reviewContract(result) {
  const pick = (c) => ({ score: c.score, max: c.max, status: c.evidenceStatus,
    confidence: c.confidence, why: c.why, refs: c.evidenceRefs });
  const salesKeys = Object.keys(result.sales).filter((k) => result.sales[k] && result.sales[k].max);
  const deliveryKeys = ['clarity', 'approachability', 'pacing', 'concision', 'composure', 'rhythm'];
  return {
    outcome: result.outcome,
    overall: result.overallScore, sales: result.sales.score, delivery: result.delivery.score,
    categories: {
      sales: Object.fromEntries(salesKeys.map((k) => [k, pick(result.sales[k])])),
      delivery: Object.fromEntries(deliveryKeys.map((k) => [k, {
        score: result.delivery[k].score, max: result.delivery[k].max, why: result.delivery[k].why }])),
    },
    majorPatterns: result.majorPatterns,
    guided: result.guided,
    scriptReliance: result.scriptReliance,
    achievement: result.achievement,
    evidenceSufficiency: result.evidenceSufficiency,
    assessmentConfidence: result.assessmentConfidence,
    /* So the review can tell the founder WHICH parts never came up rather
       than only that its own evidence was thin. */
    testedWeight: result.sales.testedWeight,
    unscored: result.unscored,
  };
}
