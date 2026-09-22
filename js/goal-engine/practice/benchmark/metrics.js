/* ════════════════════════════════════════════════════════════════════════
   HOW A FUTURE JUDGE WILL BE SCORED AGAINST THE EXPERTS.

   The one design decision that matters here: A FALSE CONFIDENT ACCUSATION IS
   NOT THE SAME KIND OF ERROR AS A MISS, and this file refuses to let the two
   average into one number. A judge that calls a good turn a leak damages a
   founder's trust in a way that a judge which says UNCERTAIN does not.

   So `falseAccusations` is reported on its own, always, and a judge that
   raises it while improving its headline agreement has got worse.
   ══════════════════════════════════════════════════════════════════════ */

import { VERDICTS, TURN_DIMENSIONS, CALL_DIMENSIONS,
  SELECTION_ABSTAINED, SELECTION_UNLOCATED } from './schema.js';

/* A selection key is `${callId}|${dimension}` by construction everywhere it is
   built. The dimension is the part after the LAST separator, so a call id
   containing one cannot shift it. */
const dimensionOfKey = (key) => String(key).slice(String(key).lastIndexOf('|') + 1);

/* ── WHAT A VERDICT MEANS, PER DIMENSION ──────────────────────────────
   The first version assumed one polarity for the whole benchmark: gold NO
   plus predicted YES was "a false accusation" everywhere. That is only true
   for biggest_leak, where YES means "this turn is the leak". For
   summary_faithful and objection_handling YES is EXCULPATORY -- it says the
   founder did the right thing -- so the old rule counted the judge letting a
   fault go as an accusation, and counted nothing when it accused every turn
   in the call.

   Measured on the real runner before this fix: a judge predicting YES on
   everything (accusing nobody) scored 4 false accusations; a judge predicting
   NO on everything (accusing every single turn) scored 0.

   So each dimension declares which verdict is the accusation. Nothing is
   inferred from the verdict string. */
export const DIMENSION_SEMANTICS = Object.freeze({
  follow_up_quality: Object.freeze({
    yes: 'built on what the prospect just said', partial: 'on topic but generic',
    no: 'ignored the answer', accusatory: 'NO' }),
  uncertainty_reduced: Object.freeze({
    yes: 'reduced an important unknown', partial: 'narrowed it slightly',
    no: 'could not change anything', accusatory: 'NO' }),
  summary_faithful: Object.freeze({
    yes: 'stated only what was said', partial: 'firmed up something vague',
    no: 'asserted something they never said', accusatory: 'NO' }),
  pitch_relevance: Object.freeze({
    yes: 'tied to a disclosed need', partial: 'pitched wider than established',
    no: 'a rate card in a vacuum', accusatory: 'NO' }),
  objection_handling: Object.freeze({
    yes: 'explored before answering', partial: 'acknowledged then moved on',
    no: 'argued with or ignored it', accusatory: 'NO' }),
  next_move_fit: Object.freeze({
    yes: 'matched the state of the call', partial: 'right direction, wrong moment',
    no: 'asked for time nothing earned', accusatory: 'NO' }),
  retry_repaired: Object.freeze({
    yes: 'the named fault is gone', partial: 'gone but introduced a smaller one',
    no: 'the fault remains or was traded for a worse one', accusatory: 'NO' }),
  /* A selection, not a charge: nominating the wrong winning turn accuses
     nobody, so no verdict here is accusatory. */
  biggest_win: Object.freeze({ yes: 'this turn helped most', accusatory: null }),
  /* The one dimension where YES IS the charge. */
  biggest_leak: Object.freeze({ yes: 'this turn cost the call most', accusatory: 'YES' }),
});

export const accusatoryVerdictFor = (dimension) => {
  const d = DIMENSION_SEMANTICS[dimension];
  return d ? d.accusatory : null;
};

/* gold/pred: Map(unitId -> verdict). */
export function confusion(gold, pred) {
  const m = {};
  VERDICTS.forEach((g) => { m[g] = {}; VERDICTS.forEach((p) => { m[g][p] = 0; }); });
  let scored = 0; let missingPrediction = 0; let malformedPrediction = 0;
  gold.forEach((g, unitId) => {
    const p = pred.get(unitId);
    if (p == null) { missingPrediction += 1; return; }
    /* A verdict outside the vocabulary used to be dropped WITHOUT counting as
       scored or as missing, so a judge answering 5% of a dimension printed
       agree=1.0 with missing=0. It is answered-but-unusable: counted. */
    if (!m[g] || m[g][p] == null) { malformedPrediction += 1; return; }
    m[g][p] += 1; scored += 1;
  });
  return { matrix: m, scored, missingPrediction, malformedPrediction };
}

export function prf(gold, pred, positive = 'YES') {
  let tp = 0; let fp = 0; let fn = 0;
  gold.forEach((g, unitId) => {
    const p = pred.get(unitId);
    if (p == null) { if (g === positive) fn += 1; return; }
    if (p === positive && g === positive) tp += 1;
    else if (p === positive && g !== positive) fp += 1;
    else if (p !== positive && g === positive) fn += 1;
  });
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && (precision + recall)
    ? (2 * precision * recall) / (precision + recall) : null;
  const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
  return { positive, tp, fp, fn, precision: r3(precision), recall: r3(recall), f1: r3(f1) };
}

/* A judge said something went wrong where the experts say it did not. This is
   the number that must be looked at before any headline. */
/* THE JUDGE INVENTED A FAULT: the experts did not call it, the judge did. */
export function falseAccusations(units, gold, pred) {
  const out = [];
  units.forEach((u) => {
    const charge = accusatoryVerdictFor(u.dimension);
    if (!charge) return;
    const g = gold.get(u.unitId); const p = pred.get(u.unitId);
    if (g == null || p == null) return;
    if (g !== charge && p === charge) {
      out.push({ unitId: u.unitId, dimension: u.dimension, gold: g, pred: p, charge });
    }
  });
  return out;
}

/* THE JUDGE LET A REAL FAULT GO. The opposite error, and a different kind:
   it costs the founder a lesson rather than their trust. Counted separately
   so neither can hide inside the other. */
export function falseExonerations(units, gold, pred) {
  const out = [];
  units.forEach((u) => {
    const charge = accusatoryVerdictFor(u.dimension);
    if (!charge) return;
    const g = gold.get(u.unitId); const p = pred.get(u.unitId);
    if (g == null || p == null) return;
    /* PARTIAL is not a clean exoneration -- it is a half charge, and counting
       it as full let a judge that says PARTIAL everywhere both accuse every
       founder of clumsiness and report zero false accusations. It is reported
       on its own instead. */
    if (g === charge && p !== charge && p !== 'UNCERTAIN' && p !== 'PARTIAL') {
      out.push({ unitId: u.unitId, dimension: u.dimension, gold: g, pred: p, charge });
    }
  });
  return out;
}

/* Per dimension, because one aggregate hides which dimension is misbehaving. */
/* A half charge in either direction: the judge softened a real fault, or
   invented a soft one. Neither belongs inside the two clean counts. */
export function partialCharges(units, gold, pred) {
  const out = [];
  units.forEach((u) => {
    const charge = accusatoryVerdictFor(u.dimension);
    if (!charge) return;
    const g = gold.get(u.unitId); const p = pred.get(u.unitId);
    if (g == null || p == null || p !== 'PARTIAL' || g === 'PARTIAL') return;
    out.push({ unitId: u.unitId, dimension: u.dimension, gold: g, pred: p,
      kind: g === charge ? 'softened_a_real_fault' : 'invented_a_soft_fault' });
  });
  return out;
}

/* ── P0: FOR A SELECTION DIMENSION, THE CHARGE IS THE TURN ────────────
   biggest_leak is the one dimension where YES is the accusation, and the
   verdict alone says only THAT a leak exists -- the accusation is WHICH turn
   is named. Comparing verdicts let a judge agree "yes there was a leak",
   blame the opener in every call, and score zero false accusations with a
   perfect headline. The turn is compared now. */
export function misplacedCharges(units, goldSel, predSel, pred = new Map()) {
  const out = [];
  units.forEach((u) => {
    const charge = accusatoryVerdictFor(u.dimension);
    if (charge == null) return;
    /* Only a turn named BY A CHARGE is an accusation. A prediction that
       exonerates and happens to carry a selection was being logged as one. */
    const v = pred.get(u.unitId);
    if (v != null && v !== charge) return;
    const key = `${u.callId}|${u.dimension}`;
    const g = goldSel.get(key); const p = predSel.get(key);
    /* An abstention is genuine. It costs nothing, and must not -- but it is
       recognised by IDENTITY, so a judge cannot claim one by writing the
       word into the field its answer travels in. */
    if (p === undefined || p === null || p === SELECTION_ABSTAINED) return;
    /* ── NOTHING IS SCORED WHERE THE EXPERTS HAVE NOT SETTLED A LABEL ──
       A selection the adjudicator left PENDING, withdrew as ambiguous, or
       never labelled at all is missing data. It was possible to be charged
       on one: the unlocatable-charge branch below sat AHEAD of this line, so
       on a pending unit the judge saying "there is a leak but I cannot
       locate it" took a false accusation while the judge naming a definite
       unverifiable turn took none. The more honest answer cost more. */
    if (g === undefined) return;
    /* ── P0: AN UNLOCATABLE CHARGE IS STILL A CHARGE ──────────────────
       This returned early, so a judge that alleged a leak in every call and
       located none scored a perfect safety sheet. Measured on the shipped
       runner: naming the right turn cost 0, naming the WRONG turn cost 1,
       naming NO turn cost 0 -- the cheapest way to accuse every founder was
       to refuse to say where. An allegation nobody can check is not a
       lesser error; it is the one the founder cannot argue with. It is its
       own kind: there is no address to compare, only a label that exists. */
    if (p === SELECTION_UNLOCATED) {
      out.push({ unitId: u.unitId, dimension: u.dimension,
        kind: 'charged_without_naming_a_turn' }); return;
    }
    /* The experts abstained and the judge charged a turn anyway. */
    if (g === null || g === SELECTION_ABSTAINED) {
      out.push({ unitId: u.unitId, dimension: u.dimension, kind: 'charged_where_experts_abstained',
        named: p }); return;
    }
    if (g.sequence !== p.sequence || (g.attemptNo || 1) !== (p.attemptNo || 1)) {
      out.push({ unitId: u.unitId, dimension: u.dimension, kind: 'blamed_a_turn_the_experts_cleared',
        named: p, expected: g });
    }
  });
  return out;
}

export function safetyByDimension(units, gold, pred, goldSel = new Map(), predSel = new Map()) {
  const out = {};
  /* ── ONE WRONG JUDGEMENT IS ONE WRONG JUDGEMENT ──────────────────────
     The verdict pass and the selection pass both used to charge the same
     unit: gold NO, judge YES, judge names a turn -- one mistake, two false
     accusations, and a safety sheet that could not be reconciled against
     the units it was computed from. A selection dimension's charge IS the
     turn, so the selection finding is the specific one and it wins; the
     verdict rules only run for units it did not claim. */
  const misplaced = new Map();
  misplacedCharges(units, goldSel, predSel, pred).forEach((m) => misplaced.set(m.unitId, m));
  units.forEach((u) => {
    const charge = accusatoryVerdictFor(u.dimension);
    if (!charge) return;
    if (!out[u.dimension]) out[u.dimension] = { charge, falseAccusations: 0, falseExonerations: 0,
      partial: 0, misplaced: 0, chargedWithoutNamingATurn: 0, chargedNamingTheWrongTurn: 0, scored: 0 };
    const o = out[u.dimension];
    const g = gold.get(u.unitId); const p = pred.get(u.unitId);
    if (g != null && p != null) o.scored += 1;
    const m = misplaced.get(u.unitId);
    if (m) {
      o.misplaced += 1;
      o.falseAccusations += 1;
      if (m.kind === 'charged_without_naming_a_turn') o.chargedWithoutNamingATurn += 1;
      else o.chargedNamingTheWrongTurn += 1;
      return;
    }
    if (g == null || p == null) return;
    if (g !== charge && p === charge) o.falseAccusations += 1;
    else if (p === 'PARTIAL' && g !== 'PARTIAL') o.partial += 1;
    else if (g === charge && p !== charge && p !== 'UNCERTAIN') o.falseExonerations += 1;
  });
  return out;
}

/* THE HEADLINE, WITHOUT COUNTING ONE MISTAKE TWICE. The runner printed
   `falseAccusations.length + misplacedCharges.length`, and a single
   biggest_leak error appears in both lists. Union by unit, and the kind is
   reported so an unlocatable charge cannot hide inside the total. */
export function totalFalseAccusations(fromVerdicts, fromSelections) {
  const byUnit = new Map();
  (fromVerdicts || []).forEach((f) => byUnit.set(f.unitId, 'wrong_verdict'));
  (fromSelections || []).forEach((m) => byUnit.set(m.unitId, m.kind));
  let wrongTurn = 0; let noTurn = 0;
  byUnit.forEach((kind) => {
    if (kind === 'charged_without_naming_a_turn') noTurn += 1;
    else if (kind !== 'wrong_verdict') wrongTurn += 1;
  });
  return { total: byUnit.size, byNamingTheWrongTurn: wrongTurn, withoutNamingATurn: noTurn };
}

/* Biggest win / biggest leak are a choice among turns, not a verdict. */
/* Biggest win / biggest leak are a CHOICE among turns, not a verdict.
   Missing data is reported as missing -- never silently folded into either
   agreement or disagreement, which is how a metric quietly starts measuring
   coverage instead of accuracy. */
/* ── THIS FUNCTION NEVER RECEIVED THE VERDICTS ────────────────────────
   `chargedWithoutNamingATurn` is a SAFETY word, and it was reached by the
   shape of the selection alone. So it labelled every absent selection an
   unlocatable charge -- including a judge that EXONERATES (verdict NO), one
   that half-charges (PARTIAL), and every biggest_win answer, a dimension
   DIMENSION_SEMANTICS declares carries no charge at all (`accusatory: null`).
   Naming no turn is only an accusation when the verdict accuses. This is the
   same guard misplacedCharges already applies (`v != null && v !== charge`),
   and it needs the same input to apply it. */
export function topOneAgreement(goldSel, predSel, predVerdict = new Map()) {
  let hit = 0; let n = 0; let missing = 0; let bothNone = 0; let uncertain = 0; let malformed = 0;
  let namedNoTurn = 0;
  goldSel.forEach((g, key) => {
    const p = predSel.get(key);
    if (p === undefined) { missing += 1; return; }
    /* A judge that asserts a leak but names no turn has not agreed with an
       abstention -- it has made an unlocatable charge. Counted as malformed,
       but ONLY when the verdict is the accusation for this dimension. */
    if (p === SELECTION_UNLOCATED) {
      const charge = accusatoryVerdictFor(dimensionOfKey(key));
      const v = predVerdict.get(key);
      if (charge != null && (v == null || v === charge)) { malformed += 1; n += 1; return; }
      namedNoTurn += 1;
    }
    const none = p === null || p === SELECTION_ABSTAINED || p === SELECTION_UNLOCATED;
    /* The experts said no turn qualifies. A judge that agrees is right. */
    if (g === null || g === SELECTION_ABSTAINED) {
      if (none) { bothNone += 1; n += 1; hit += 1; }
      else { uncertain += 1; n += 1; }
      return;
    }
    if (none) { n += 1; return; }
    n += 1;
    if (g.sequence === p.sequence && (g.attemptNo || 1) === (p.attemptNo || 1)) hit += 1;
  });
  return { compared: n, agreed: hit, missing, agreedNoCandidate: bothNone,
    judgeGuessedWhereExpertsAbstained: uncertain, chargedWithoutNamingATurn: malformed,
    namedNoTurnWithoutCharging: namedNoTurn,
    rate: n ? Math.round((hit / n) * 1000) / 1000 : null };
}

/* Every event a judge emits must cite a turn that exists and quote it. */
export function citationValidity(predictions, validate) {
  let ok = 0; let bad = 0; let uncited = 0; const failures = [];
  (predictions || []).forEach((p) => {
    const cites = (p.citations || []).filter(Boolean);
    /* P1: iterating `(p.citations || [])` meant a judge that cited NOTHING
       was neither ok nor bad -- zero events, so the rate came back `null`
       and the least evidenced judge possible read as "no invalid
       citations". An unevidenced judgement IS an invalid one here: the
       whole point of a citation is that the founder can check the claim. */
    if (!cites.length) {
      uncited += 1; bad += 1;
      failures.push(`${p.unitId}: prediction_without_citation`);
      return;
    }
    /* The WHOLE ROW, not `p.callId`. Which call a citation must resolve
       against is decided by the unit under judgement, and `callId` is a field
       the judge wrote: pointing it at another call let a judge quote a real
       sentence from a different transcript and be marked valid. The caller
       resolves the call; nothing judge-supplied selects the evidence. */
    cites.forEach((c) => {
      const problem = validate(c, p);
      if (problem) { bad += 1; failures.push(`${p.unitId}: ${problem}`); } else ok += 1;
    });
  });
  return { ok, bad, uncited,
    rate: ok + bad ? Math.round((ok / (ok + bad)) * 1000) / 1000 : null, failures };
}

/* Where a judge is strong and where it is not -- averages hide exactly the
   slice that matters (a stonewalling prospect, a no-fit exit). */
export function slice(units, gold, pred, keyOf) {
  const buckets = new Map();
  units.forEach((u) => {
    const g = gold.get(u.unitId); const p = pred.get(u.unitId);
    if (g == null || p == null) return;
    const k = keyOf(u) || 'unknown';
    if (!buckets.has(k)) buckets.set(k, { n: 0, agreed: 0 });
    const b = buckets.get(k);
    b.n += 1; if (g === p) b.agreed += 1;
  });
  const out = {};
  buckets.forEach((v, k) => { out[k] = { n: v.n, agreed: v.agreed,
    rate: Math.round((v.agreed / v.n) * 1000) / 1000 }; });
  return out;
}

export function summarise({ units, gold, pred, predictions = [], validate = () => null,
  goldSel = new Map(), predSel = new Map(), discoverabilityOf = null }) {
  const byDim = {};
  [...TURN_DIMENSIONS, ...CALL_DIMENSIONS].forEach((d) => {
    const dUnits = units.filter((u) => u.dimension === d);
    const g = new Map(); const p = new Map();
    dUnits.forEach((u) => {
      if (gold.has(u.unitId)) g.set(u.unitId, gold.get(u.unitId));
      if (pred.has(u.unitId)) p.set(u.unitId, pred.get(u.unitId));
    });
    if (!g.size) return;
    const c = confusion(g, p);
    byDim[d] = { units: dUnits.length, scored: c.scored, missing: c.missingPrediction,
      malformed: c.malformedPrediction, answered: c.scored + c.malformedPrediction,
      agreement: c.scored ? Math.round((VERDICTS.reduce((s, v) => s + c.matrix[v][v], 0) / c.scored) * 1000) / 1000 : null,
      yes: prf(g, p, 'YES'), no: prf(g, p, 'NO'), confusion: c.matrix };
  });
  const misplaced = misplacedCharges(units, goldSel, predSel, pred);
  const wrongVerdicts = falseAccusations(units, gold, pred);
  /* topOne is keyed by call+dimension and the verdicts are keyed by unit, so
     the bridge is built here rather than guessed inside the metric. */
  const predVerdict = new Map();
  units.forEach((u) => {
    if (!CALL_DIMENSIONS.includes(u.dimension) || !pred.has(u.unitId)) return;
    predVerdict.set(`${u.callId}|${u.dimension}`, pred.get(u.unitId));
  });
  return {
    byDimension: byDim,
    safety: safetyByDimension(units, gold, pred, goldSel, predSel),
    misplacedCharges: misplaced,
    falseAccusations: wrongVerdicts,
    /* The number a reader looks at first, computed once, here, so the
       runner cannot get the arithmetic wrong on its own. */
    totalFalseAccusations: totalFalseAccusations(wrongVerdicts, misplaced),
    falseExonerations: falseExonerations(units, gold, pred),
    partialCharges: partialCharges(units, gold, pred),
    topOne: topOneAgreement(goldSel, predSel, predVerdict),
    citations: citationValidity(predictions, validate),
    byProspectMode: slice(units, gold, pred, (u) => u.context && u.context.prospect_mode),
    /* ONLY uncertainty_reduced, and only units that actually carry the flag.
       Bucketing "not false" as discoverable mixed in 178 units from other
       dimensions that never carried it, so the gap measured dimension
       composition rather than fairness. */
    byDiscoverability: slice(units.filter((u) => u.dimension === 'uncertainty_reduced'
      && discoverabilityOf && discoverabilityOf(u.unitId) != null),
    gold, pred, (u) => (discoverabilityOf(u.unitId) === false ? 'not_discoverable' : 'discoverable')),
  };
}
