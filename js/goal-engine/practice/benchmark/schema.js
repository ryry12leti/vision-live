/* ════════════════════════════════════════════════════════════════════════
   THE MEASURING INSTRUMENT, NOT THE THING BEING MEASURED.

   This file defines what a judgement unit IS. It contains no sales opinion
   and no judge: it is the ruler a future Nuance Judge will be held against,
   and a ruler that can be bent by the thing it measures is worthless.

   Three rules are structural here:

     1. A UNIT IS ADDRESSED, NEVER DESCRIBED. (call_id, sequence, attempt_no)
        is the only address. attempt_no is not dense -- a real coached retry
        in this corpus jumps 1 to 3 -- so nothing may assume contiguity.

     2. NO CONFIDENCE NUMBERS. A verdict is one of four words. A percentage
        invites a threshold and a threshold is a score, and this benchmark
        does not score anything yet.

     3. GOLD IS NOT WRITABLE BY DEVELOPMENT CODE. Holdout labels live behind
        an explicit mode. The default runner cannot read them, and no code
        path here can rewrite a label that already exists.
   ══════════════════════════════════════════════════════════════════════ */

export const BENCHMARK_VERSION = 'practice_judgement_benchmark_v1';

/* ── WHAT IS BENCHMARKED ───────────────────────────────────────────────
   Only decisions that genuinely need contextual sales reasoning. Anything
   Step 3 already decides deterministically stays in the regression layer;
   re-asking a model for an opinion it does not need is how a benchmark
   starts rewarding fluency instead of judgement. */
export const DIMENSIONS = Object.freeze({
  follow_up_quality: 'Did this turn build on what the prospect actually just said?',
  uncertainty_reduced: 'Did this question meaningfully reduce an important unknown?',
  summary_faithful: 'Does this summary state only what the prospect actually said?',
  pitch_relevance: 'Is what was offered tied to a need the prospect actually disclosed?',
  objection_handling: 'Was the objection explored before it was answered?',
  next_move_fit: 'Given where the call actually is, was closing / discovering further / exiting the right move?',
  retry_repaired: 'Did the retry repair the mistake it was coached on?',
  biggest_win: 'Which single turn helped this call most?',
  biggest_leak: 'Which single turn cost this call most?',
});
export const TURN_DIMENSIONS = Object.freeze(Object.keys(DIMENSIONS)
  .filter((d) => d !== 'biggest_win' && d !== 'biggest_leak'));
export const CALL_DIMENSIONS = Object.freeze(['biggest_win', 'biggest_leak']);

export const VERDICTS = Object.freeze(['YES', 'PARTIAL', 'NO', 'UNCERTAIN']);
export const SOURCES = Object.freeze(['expert_a', 'expert_b', 'adjudicator']);
export const ADJUDICATION = Object.freeze(['not_required', 'pending', 'resolved', 'removed_ambiguous']);
export const SPLITS = Object.freeze(['dev', 'holdout']);

/* Fairness context an annotator may see, because the dimension needs it. */
export const CONTEXT_FIELDS = Object.freeze([
  'prospect_mode', 'call_objective', 'verified_prospect_facts',
  'call_state_before', 'answer_key_state', 'discoverable',
]);

/* Things an annotator must NEVER see. Leakage is the failure mode that makes
   a benchmark agree with the system it is supposed to audit. */
export const BLINDED_FIELDS = Object.freeze([
  'vision_score', 'founder_action', 'detected_events', 'candidate_events',
  'review_output', 'fixture_intent', 'judge_output', 'expected_verdict',
]);

export class BenchmarkError extends Error {}

const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const txt = (v) => String(v == null ? '' : v).trim();

/* Stable, dependency-free content hash. An identity, not a security
   primitive -- but it must be identical across machines and runs, which is
   why nothing here uses object key order or a timestamp. */
export function contentHash(value) {
  const canon = (v) => {
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v === undefined ? null : v);
  };
  const s = canon(value);
  let h1 = 0x811c9dc5; let h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    h1 ^= s.charCodeAt(i); h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/* A judgement unit's identity comes from WHAT IT ASKS ABOUT, never from a
   counter -- so the same question about the same turn cannot enter the
   benchmark twice under two ids. */
export function unitId({ callId, dimension, sequence, attemptNo }) {
  const anchor = CALL_DIMENSIONS.includes(dimension)
    ? 'call' : `${sequence}:${attemptNo == null ? 1 : attemptNo}`;
  return `bu_${contentHash(`${callId}|${dimension}|${anchor}`)}`;
}

/* A citation must resolve to a turn that exists and must quote it. */
export function validateCitation(cite, call) {
  if (!cite || !isInt(cite.sequence)) return 'citation_without_sequence';
  const attempt = cite.attemptNo == null ? 1 : cite.attemptNo;
  const turn = (call.turns || []).find((t) => t.sequence === cite.sequence
    && (t.attemptNo == null ? 1 : t.attemptNo) === attempt);
  if (!turn) return `citation_turn_not_found:${cite.sequence}:${attempt}`;
  const quote = txt(cite.quote);
  if (!quote) return 'citation_without_quote';
  const flat = (v) => String(v).replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
  if (!flat(turn.text).includes(flat(quote))) {
    return `citation_quote_not_in_turn:${cite.sequence}:${attempt}`;
  }
  if (cite.speaker && cite.speaker !== turn.speaker) {
    return `citation_wrong_speaker:${cite.sequence}`;
  }
  return null;
}

/* ── P0: THE SENTINEL SHARED A VALUE SPACE WITH THE JUDGE'S OWN DATA ───
   A call-level answer is carried in one field, `selection`, and two control
   states were carried in the SAME field as the strings 'UNCERTAIN' and
   'MALFORMED'. So a judge that charged YES on every call-level unit and wrote
   the literal string "UNCERTAIN" into `selection` was read as ABSTAINING, and
   escaped the entire safety arithmetic: measured on the shipped runner,
   TOTAL FALSE ACCUSATIONS 0 and chargedWithoutNamingATurn 0, where the same
   judge naming a definite wrong turn took 4. Declining to say where was
   cheaper than saying it wrongly, which is the incentive this file exists to
   destroy.

   These are IDENTITIES, not values. `JSON.parse` cannot produce them, so no
   amount of judge-supplied text can ever be `=== ` one of them. They are the
   only two states a selection may hold besides a real turn address. */
export const SELECTION_ABSTAINED = Object.freeze({ __selectionState: 'abstained' });
export const SELECTION_UNLOCATED = Object.freeze({ __selectionState: 'unlocated' });
export const SELECTION_STATES = Object.freeze([SELECTION_ABSTAINED, SELECTION_UNLOCATED]);
export const isSelectionState = (v) => SELECTION_STATES.includes(v);
export const describeSelection = (v) => (v === SELECTION_ABSTAINED ? 'ABSTAINED'
  : v === SELECTION_UNLOCATED ? 'UNLOCATED' : JSON.stringify(v));

/* A SELECTION IS AN ADDRESS, and an address either resolves to a turn that
   was actually said or it is not an address. One definition, used by the gold
   path and the prediction path, so neither can be validated by a copy that
   has drifted from the other. */
export function validateSelection(sel, call) {
  if (sel == null) return null;                 /* absence is the caller's to interpret */
  if (isSelectionState(sel)) return 'selection_is_an_internal_state';
  if (typeof sel !== 'object' || Array.isArray(sel)) {
    return `selection_not_an_address:${JSON.stringify(sel)}`;
  }
  if (!isInt(sel.sequence)) return 'selection_without_sequence';
  const attempt = sel.attemptNo == null ? 1 : sel.attemptNo;
  if (!isInt(attempt)) return `selection_without_attempt:${sel.sequence}`;
  const turn = ((call || {}).turns || []).find((t) => t.sequence === sel.sequence
    && (t.attemptNo == null ? 1 : t.attemptNo) === attempt);
  if (!turn) return `selection_turn_not_found:${sel.sequence}:${attempt}`;
  return null;
}

/* One annotator's answer about one unit. Refuses rather than repairs. */
export function makeAnnotation({
  unit, source, verdict, citations, rationale, adjudication = 'not_required',
  selection = null,
}) {
  if (!unit) throw new BenchmarkError('annotation_without_unit');
  if (!SOURCES.includes(source)) throw new BenchmarkError(`unknown_source:${source}`);
  if (!VERDICTS.includes(verdict)) throw new BenchmarkError(`unknown_verdict:${verdict}`);
  const cites = (citations || []).filter(Boolean);
  if (!cites.length) throw new BenchmarkError(`annotation_without_citation:${unit.unitId}`);
  if (!txt(rationale)) throw new BenchmarkError(`annotation_without_rationale:${unit.unitId}`);
  if (!ADJUDICATION.includes(adjudication)) throw new BenchmarkError(`unknown_adjudication:${adjudication}`);
  if (CALL_DIMENSIONS.includes(unit.dimension) && !selection) {
    throw new BenchmarkError(`call_level_annotation_without_selection:${unit.unitId}`);
  }
  return Object.freeze({
    unitId: unit.unitId, source, verdict, citations: cites,
    rationale: txt(rationale).slice(0, 600), adjudication, selection,
  });
}

/* The question itself, with the context the annotator is allowed to see. */
export function makeUnit({ callId, dimension, sequence = null, attemptNo = null, context = {} }) {
  if (!txt(callId)) throw new BenchmarkError('unit_without_call');
  if (!DIMENSIONS[dimension]) throw new BenchmarkError(`unknown_dimension:${dimension}`);
  if (TURN_DIMENSIONS.includes(dimension) && !isInt(sequence)) {
    throw new BenchmarkError(`turn_dimension_without_sequence:${dimension}`);
  }
  const leaked = Object.keys(context).filter((k) => BLINDED_FIELDS.includes(k));
  if (leaked.length) throw new BenchmarkError(`context_leaks_blinded_field:${leaked.join(',')}`);
  const unknown = Object.keys(context).filter((k) => !CONTEXT_FIELDS.includes(k));
  if (unknown.length) throw new BenchmarkError(`context_field_not_permitted:${unknown.join(',')}`);
  return Object.freeze({
    unitId: unitId({ callId, dimension, sequence, attemptNo }),
    callId, dimension, question: DIMENSIONS[dimension],
    sequence, attemptNo: attemptNo == null ? 1 : attemptNo,
    context: Object.freeze({ ...context }),
  });
}

/* Whole-benchmark validation. Every failure the integrity suite asserts is
   raised here, in one place, so the runner and the tests cannot disagree. */
export function validateBenchmark({ calls = [], units = [], annotations = [] } = {}) {
  const problems = [];
  const byCall = new Map(calls.map((c) => [c.callId, c]));
  const seen = new Set();

  /* ── P1: THE LEAK GUARD ONLY EVER SCREENED A UNIT'S `context` ──────────
     `split` is in BLINDED_FIELDS. makeUnit refuses it inside a unit's
     context, and the build strips it from every unit -- and it was printed
     on all 31 calls of the annotator-facing corpus.json, which is the same
     file and the same annotator. A blinded field is blinded wherever it is
     written, so the whole corpus is screened, not one nested object. */
  const blinded = (obj) => Object.keys(obj || {}).filter((k) => BLINDED_FIELDS.includes(k));
  calls.forEach((c) => {
    const leaked = blinded(c);
    if (leaked.length) problems.push(`call_carries_blinded_field:${c.callId}:${leaked.join(',')}`);
    (c.turns || []).forEach((t) => {
      const l = blinded(t);
      if (l.length) problems.push(`turn_carries_blinded_field:${c.callId}:${t.sequence}:${l.join(',')}`);
    });
  });

  units.forEach((u) => {
    const leaked = blinded(u).concat(blinded(u.context));
    if (leaked.length) problems.push(`unit_carries_blinded_field:${u.unitId}:${leaked.join(',')}`);
    if (seen.has(u.unitId)) problems.push(`duplicate_unit:${u.unitId}`);
    seen.add(u.unitId);
    const call = byCall.get(u.callId);
    if (!call) { problems.push(`unit_call_missing:${u.callId}`); return; }
    if (TURN_DIMENSIONS.includes(u.dimension)) {
      const t = (call.turns || []).find((x) => x.sequence === u.sequence
        && (x.attemptNo == null ? 1 : x.attemptNo) === u.attemptNo);
      if (!t) problems.push(`unit_turn_missing:${u.unitId}`);
      else if (t.speaker !== 'founder') problems.push(`unit_not_about_a_founder_turn:${u.unitId}`);
    }
    if (u.unitId !== unitId(u)) problems.push(`unit_id_not_derived:${u.unitId}`);
  });

  const unitById = new Map(units.map((u) => [u.unitId, u]));
  const perUnitSource = new Set();
  annotations.forEach((a) => {
    const u = unitById.get(a.unitId);
    if (!u) { problems.push(`annotation_orphaned:${a.unitId}`); return; }
    const k = `${a.unitId}|${a.source}`;
    if (perUnitSource.has(k)) problems.push(`duplicate_annotation:${k}`);
    perUnitSource.add(k);
    const call = byCall.get(u.callId);
    a.citations.forEach((c) => {
      const bad = validateCitation(c, call);
      if (bad) problems.push(`${bad}@${a.unitId}/${a.source}`);
    });
  });
  return { valid: problems.length === 0, problems };
}
