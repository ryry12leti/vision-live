/* ════════════════════════════════════════════════════════════════════════
   HOW MUCH THE EXPERTS ACTUALLY AGREE.

   Krippendorff's alpha, nominal, tolerant of missing values -- which matters
   because two reviewers will not always both answer every unit, and dropping
   the units where one abstained would quietly inflate agreement.

   alpha = 1 - Do/De. 1.0 is perfect agreement; 0 is what chance would give
   you; below 0 means the reviewers disagree more than random labelling would.

   THE POINT OF MEASURING IT: a dimension where two experienced sellers cannot
   agree is not a dimension a model can be graded on. Weak alpha is evidence
   about the RUBRIC, not about the reviewers, and the honest response is to
   fix the wording and relabel -- never to average two people into a number
   neither of them would defend.
   ══════════════════════════════════════════════════════════════════════ */

export const TRUST_THRESHOLD = 0.80;

/* units: [{ unitId, bySource: { expert_a: 'YES', expert_b: 'PARTIAL' } }] */
export function krippendorffAlpha(units, { categories } = {}) {
  const rows = (units || [])
    .map((u) => Object.values(u.bySource || {}).filter((v) => v != null && v !== ''))
    .filter((vals) => vals.length >= 2);
  if (!rows.length) return { alpha: null, units: 0, reason: 'no_unit_had_two_ratings' };

  const cats = categories && categories.length
    ? categories.slice()
    : Array.from(new Set(rows.flat()));
  if (cats.length < 2) return { alpha: 1, units: rows.length, reason: 'single_category_total_agreement' };

  /* Coincidence matrix: each unit contributes every ordered pair of its own
     ratings, weighted by 1/(m-1) so a unit rated by many people does not
     dominate one rated by two. */
  const idx = new Map(cats.map((c, i) => [c, i]));
  const n = cats.length;
  const O = Array.from({ length: n }, () => new Array(n).fill(0));
  let total = 0;
  rows.forEach((vals) => {
    const m = vals.length;
    for (let i = 0; i < m; i += 1) {
      for (let j = 0; j < m; j += 1) {
        if (i === j) continue;
        const a = idx.get(vals[i]); const b = idx.get(vals[j]);
        if (a == null || b == null) continue;
        O[a][b] += 1 / (m - 1);
        total += 1 / (m - 1);
      }
    }
  });
  if (!total) return { alpha: null, units: rows.length, reason: 'no_comparable_pairs' };

  const marg = O.map((r) => r.reduce((x, y) => x + y, 0));
  /* Nominal metric: disagreement is 1 for any mismatch, 0 for a match. */
  let Do = 0;
  for (let a = 0; a < n; a += 1) for (let b = 0; b < n; b += 1) if (a !== b) Do += O[a][b];
  Do /= total;
  let De = 0;
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
      if (a === b) continue;
      De += (marg[a] * marg[b]);
    }
  }
  De /= (total * (total - 1));
  if (!De) return { alpha: null, units: rows.length, reason: 'no_expected_disagreement' };
  const alpha = 1 - (Do / De);
  return {
    alpha: Math.round(alpha * 1000) / 1000,
    units: rows.length,
    trusted: alpha >= TRUST_THRESHOLD,
    reason: alpha >= TRUST_THRESHOLD ? 'meets_threshold' : 'below_threshold_rubric_needs_work',
  };
}

/* Where two reviewers actually parted company, so the rubric can be fixed
   rather than the number massaged. */
export function disagreements(units) {
  return (units || []).filter((u) => {
    const v = Object.values(u.bySource || {}).filter(Boolean);
    return v.length >= 2 && new Set(v).size > 1;
  }).map((u) => ({ unitId: u.unitId, dimension: u.dimension, bySource: u.bySource }));
}

/* Plain pairwise agreement, reported alongside alpha because alpha alone is
   hard to sanity-check when a class dominates. */
export function rawAgreement(units) {
  const rows = (units || []).map((u) => Object.values(u.bySource || {}).filter(Boolean))
    .filter((v) => v.length >= 2);
  if (!rows.length) return null;
  const same = rows.filter((v) => new Set(v).size === 1).length;
  return Math.round((same / rows.length) * 1000) / 1000;
}
