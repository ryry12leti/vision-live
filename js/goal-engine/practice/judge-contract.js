/* ════════════════════════════════════════════════════════════════════════
   THE NUANCE JUDGE CONTRACT — the half of the Judge that is not a model.

   A model can establish SEMANTIC evidence: whether a summary overstated,
   whether an objection was explored before it was answered. It cannot be
   trusted with eligibility, authority or arithmetic, so it holds none of
   them. This module decides which units may be judged at all, and admits or
   discards each judgement the model returns. Nothing here calls a provider;
   nothing here can be reached by a prompt.

   Two rules do the real work.

   ACCUSATION COSTS MORE THAN PRAISE. A judgement that criticises the founder
   must cite the turn under judgement AND a second, distinct turn establishing
   the context that makes it a fault. Praise needs the judged turn alone, and
   UNCERTAIN needs nothing. This is non-compensatory: a fluent rationale can
   never substitute for the missing second citation, because the rationale is
   never counted.

   THE PROSPECT'S SILENCE IS NOT THE FOUNDER'S FAULT. Where the answer key
   records that the information was not available -- refused, unknown, withheld
   -- an accusation is admissible only if the judge points at a founder turn
   showing an avenue that existed and went untaken. Absence of information is
   equally not a reason to award credit: praise still has to cite the move.
   ══════════════════════════════════════════════════════════════════════ */
import {
  DIMENSIONS, TURN_DIMENSIONS, CALL_DIMENSIONS, VERDICTS,
  validateCitation, validateSelection,
} from './benchmark/schema.js';
import { DIMENSION_SEMANTICS } from './benchmark/metrics.js';

export const JUDGE_CONTRACT_VERSION = 'practice_nuance_judge_v1';

/* The model sees the call, never the verdict it is being measured against. */
export const JUDGE_INPUT_ALLOWED = Object.freeze([
  'callId', 'objective', 'turns', 'callState', 'candidateEvents',
  'reactions', 'answerKey', 'verifiedFacts', 'retryContext',
]);
export const JUDGE_INPUT_FORBIDDEN = Object.freeze([
  'score', 'points', 'rubric', 'weights', 'vision_score', 'review', 'reviewText',
  'previousReview', 'expected_verdict', 'expectedVerdict', 'gold', 'verdict',
  'fixture', 'fixture_intent', 'fixtureIntent', 'split', 'family', 'source',
  'discoverable', 'judge_output', 'unitId',
]);

export const accusatoryVerdictFor = (dimension) => {
  const d = DIMENSION_SEMANTICS[dimension];
  return d ? d.accusatory : null;
};

const isInt = (n) => Number.isInteger(n);
const attemptOf = (x) => (x == null || x.attemptNo == null ? 1 : x.attemptNo);
const sameTurn = (a, seq, att) => a && a.sequence === seq && attemptOf(a) === att;

/* ── ELIGIBILITY IS CODE'S ────────────────────────────────────────────
   The model is told which units to answer. It cannot nominate a tenth
   dimension, judge a prospect's turn as if the prospect were the founder,
   or invent a turn that was never spoken. */
export function judgeableUnits(call, { retryContext = null } = {}) {
  const turns = (call && call.turns) || [];
  const founder = turns.filter((t) => t.speaker === 'founder');
  const units = [];
  founder.forEach((t) => {
    const att = attemptOf(t);
    TURN_DIMENSIONS.forEach((dimension) => {
      /* retry_repaired only exists where a retry actually happened. */
      if (dimension === 'retry_repaired') {
        const coached = retryContext && retryContext.coachedSequences;
        if (att <= 1) return;
        if (coached && !coached.includes(t.sequence)) return;
      }
      units.push({ callId: call.callId, dimension, sequence: t.sequence, attemptNo: att });
    });
  });
  CALL_DIMENSIONS.forEach((dimension) => {
    if (founder.length) units.push({ callId: call.callId, dimension, sequence: null, attemptNo: null });
  });
  return units;
}

/* Build the model's view. Forbidden keys are removed here, not asked about. */
export function buildJudgeInput(raw = {}) {
  const out = {};
  JUDGE_INPUT_ALLOWED.forEach((k) => { if (raw[k] !== undefined) out[k] = raw[k]; });
  const leaked = Object.keys(out).filter((k) => JUDGE_INPUT_FORBIDDEN.includes(k));
  if (leaked.length) throw new Error(`judge_input_leaks:${leaked.join(',')}`);
  return out;
}

/* ── ADMISSION ────────────────────────────────────────────────────────
   Returns the judgement code is willing to stand behind, or the reason it
   refused. A refusal is never a silent downgrade: it is counted.

   `discoverable` may be a value OR A FUNCTION OF THE SUBJECT. It had to
   become the second: a call-level unit has no sequence, so its
   discoverability cannot be known until the judge names the turn it is
   charging, and the live proof caught exactly that hole -- a biggest_leak
   convicting a founder for pressing a question the prospect had honestly
   said they could not answer, admitted because the guard had no turn to
   evaluate. A plain value still behaves exactly as it always did. */
const discoverabilityFor = (discoverable, subject) => (typeof discoverable === 'function'
  ? discoverable(subject) : discoverable);

export function admitJudgement(raw, { unit, call, discoverable = null } = {}) {
  const deny = (reason) => ({ admitted: false, reason, unit });
  if (!raw || typeof raw !== 'object') return deny('judgement_not_an_object');
  if (!unit || !call) return deny('judgement_without_unit');
  if (raw.dimension !== unit.dimension) return deny('judgement_wrong_dimension');
  if (!DIMENSIONS[raw.dimension]) return deny(`judgement_unknown_dimension:${raw.dimension}`);
  if (!VERDICTS.includes(raw.verdict)) return deny(`judgement_unknown_verdict:${JSON.stringify(raw.verdict)}`);

  const isCallDim = CALL_DIMENSIONS.includes(unit.dimension);
  if (!isCallDim) {
    if (raw.sequence !== unit.sequence) return deny('judgement_wrong_sequence');
    if (attemptOf(raw) !== attemptOf(unit)) return deny('judgement_wrong_attempt');
  }

  /* An abstention is cheap, and carries no evidence burden at all. */
  if (raw.verdict === 'UNCERTAIN') {
    return { admitted: true, judgement: shape(raw, unit, 'UNCERTAIN', []) };
  }

  /* Every citation must survive the transcript, not the rationale. */
  const cites = Array.isArray(raw.citations) ? raw.citations : [];
  if (!cites.length) return deny('judgement_without_citation');
  for (const c of cites) {
    const bad = validateCitation(c, call);
    if (bad) return deny(bad);
  }

  /* Which turn is under judgement: the unit's, or the one it selected. */
  let subject = { sequence: unit.sequence, attemptNo: attemptOf(unit) };
  if (isCallDim) {
    /* validateSelection owns the forgery check -- one guard, one place. */
    const badSel = validateSelection(raw.selection, call);
    if (badSel) return deny(badSel);
    if (raw.selection == null) return deny('call_dimension_named_no_turn');
    subject = { sequence: raw.selection.sequence, attemptNo: attemptOf(raw.selection) };
  }

  /* The judged turn must itself be quoted. You cannot praise or convict a
     turn you never read back. */
  const citesSubject = cites.some((c) => sameTurn(c, subject.sequence, subject.attemptNo));
  if (!citesSubject) return deny('judgement_does_not_cite_the_turn_it_judges');

  const accusatory = accusatoryVerdictFor(unit.dimension);
  const isAccusation = accusatory != null && raw.verdict === accusatory;

  if (isAccusation) {
    /* A second, DISTINCT turn must establish the context that makes it a
       fault. One quote is an opinion; two are a case. */
    const corroborating = cites.filter((c) => !sameTurn(c, subject.sequence, subject.attemptNo));
    if (!corroborating.length) return deny('accusation_on_a_single_citation');

    /* The prospect's silence is not the founder's fault. */
    if (discoverabilityFor(discoverable, subject) === false) {
      const founderAvenue = corroborating.some((c) => {
        const t = (call.turns || []).find((x) => sameTurn(x, c.sequence, attemptOf(c)));
        return t && t.speaker === 'founder';
      });
      if (!founderAvenue) return deny('accusation_on_undiscoverable_evidence');
    }
  }

  /* A retry that repairs one fault and opens another is not a clean YES.
     Code decides the mapping; the model only reports the new fault. */
  let verdict = raw.verdict;
  let repaired = null;
  if (unit.dimension === 'retry_repaired') {
    if (subject.attemptNo <= 1) return deny('retry_judged_on_a_first_attempt');
    if (verdict === 'YES' && raw.newFault) {
      const bad = validateCitation(raw.newFault, call);
      if (!bad) { verdict = 'PARTIAL'; repaired = 'downgraded_new_supported_fault'; }
    }
  }
  return { admitted: true, judgement: shape(raw, unit, verdict, cites, subject, repaired) };
}

function shape(raw, unit, verdict, citations, subject = null, note = null) {
  return {
    contractVersion: JUDGE_CONTRACT_VERSION,
    dimension: unit.dimension,
    sequence: unit.sequence,
    attemptNo: unit.attemptNo,
    verdict,
    citations,
    rationale: String(raw.rationale == null ? '' : raw.rationale).trim(),
    ...(subject && CALL_DIMENSIONS.includes(unit.dimension) ? { selection: subject } : {}),
    ...(note ? { codeNote: note } : {}),
  };
}

/* One call's worth. Returns what survived, and an honest ledger of what did
   not -- a discarded judgement must never look like a judgement never made. */
export function admitBatch(rawJudgements, { units, call, discoverabilityOf = null } = {}) {
  const byKey = new Map((units || []).map((u) => [`${u.dimension}|${u.sequence}|${u.attemptNo}`, u]));
  const admitted = []; const discarded = []; const counts = {};
  (rawJudgements || []).forEach((raw) => {
    const key = raw && CALL_DIMENSIONS.includes(raw.dimension)
      ? `${raw.dimension}|null|null`
      : `${raw && raw.dimension}|${raw && raw.sequence}|${raw ? attemptOf(raw) : 1}`;
    const unit = byKey.get(key);
    if (!unit) { discarded.push({ reason: 'judgement_for_no_eligible_unit', raw }); return; }
    const d = discoverabilityOf ? discoverabilityOf(unit) : null;
    const r = admitJudgement(raw, { unit, call, discoverable: d });
    if (r.admitted) admitted.push(r.judgement);
    else discarded.push({ reason: r.reason, raw });
  });
  discarded.forEach((d) => { counts[d.reason] = (counts[d.reason] || 0) + 1; });
  return {
    admitted,
    discarded,
    discardedBy: counts,
    eligible: (units || []).length,
    answered: admitted.length,
    coverage: (units || []).length ? admitted.length / units.length : 0,
  };
}
