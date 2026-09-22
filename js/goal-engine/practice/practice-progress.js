/* ════════════════════════════════════════════════════════════════════════
   IS THE FOUNDER ACTUALLY GETTING BETTER?

   Every number here already exists. `practice_scores` has stored an overall,
   a sales score and the full per-dimension breakdown for every call since
   the rubric shipped; nothing has ever read more than one row of it at a
   time. This is the read across them, and it computes nothing the rubric
   did not already decide.

   THE HARD PART IS NOT THE ARITHMETIC, IT IS REFUSING TO FLATTER.

   Two calls do not make a trend. A founder who scores 40 then 55 has not
   necessarily improved -- they may have drawn an easier prospect, or the
   same prospect on a better day. Telling them they improved on that
   evidence is the same failure this codebase has spent its whole life
   avoiding elsewhere: a confident claim the data does not carry.

   So every statement this module makes is gated on how much evidence
   stands behind it, and when there is not enough it says so plainly rather
   than drawing a line through two points. `confidence` is not decoration;
   consumers are expected to render 'insufficient' differently from 'firm'.
   ══════════════════════════════════════════════════════════════════════ */

export const PRACTICE_PROGRESS_VERSION = 'practice_progress_v1';

/* scoring-rubric.js's STATUS.NOT_TESTED, restated rather than imported:
   this module deliberately has no imports so a surface can load progress
   without pulling the whole rubric in behind it. qa-practice-progress.mjs
   asserts the two are identical, so the copy cannot drift silently. */
export const STATUS_NOT_TESTED = 'not_tested';

/* The eight things the rubric scores, in the order a call happens. Labels
   live here so one rename changes every surface at once. */
export const DIMENSIONS = Object.freeze([
  { key: 'opening', label: 'Opening' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'listening', label: 'Listening' },
  { key: 'grounding', label: 'Grounding' },
  { key: 'pitchTiming', label: 'Pitch timing' },
  { key: 'objectionHandling', label: 'Objections' },
  { key: 'qualification', label: 'Qualification' },
  { key: 'close', label: 'Close' },
]);

/* ── HOW MUCH MAY BE CLAIMED ──────────────────────────────────────────
   Deliberately conservative. A founder who is told they improved and then
   has a bad call learns that the number is noise and stops believing any
   of it -- which costs more than saying nothing would have. */
export const CONFIDENCE = Object.freeze({
  NONE: 'insufficient',   /* < 3 scored calls: report, never interpret */
  EMERGING: 'emerging',   /* 3-4 calls: a direction, hedged */
  FIRM: 'firm',           /* 5+ calls: a trend worth acting on */
});

const MIN_FOR_DIRECTION = 3;
const MIN_FOR_TREND = 5;
/* Under this, a change is inside normal call-to-call variation and is
   reported as "about the same" rather than as movement. Set from the
   observed spread between comparable calls, not chosen for looking good. */
const NOISE_BAND = 6;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/* ── ONE CALL, NORMALISED ─────────────────────────────────────────────
   Accepts the shape practice_scores actually stores. `result.review`
   carries the categories map; the flat columns carry the headline. Both
   are read defensively because an older rubric version may be missing
   either, and a founder's history spans rubric versions by definition. */
export function normaliseCall(row) {
  if (!row) return null;
  const review = (row.result && row.result.review) || row.review || {};
  const cats = (review.categories && review.categories.sales) || {};
  const dims = {};
  for (const d of DIMENSIONS) {
    const c = cats[d.key];
    if (!c) continue;
    /* ── A SKILL THAT NEVER CAME UP IS NOT A SKILL SCORED ZERO ────────
       The rubric leaves an untested category at score 0 and drops it from
       the denominator instead -- `evidenceStatus: 'not_tested'` is what
       carries that, and the review screen already honours it ("Not scored
       on this call. Your score is out of what actually came up, not out of
       everything VISION can grade."). This normaliser read only score and
       max, so the same category arrived here as a flat 0% and was rendered
       as a real result on the same screen that had just said it was not
       graded -- observed on a real staging call, where Objections and
       Pitch timing showed "0" with a trend arrow while also being listed
       as not scored, and "Work on this next" then named Objections as
       "averaging 0/100 and not moving" on a call where no objection was
       ever raised.

       Dropped rather than zeroed, so it also stops poisoning the trend: a
       founder who handled objections well once and then had two calls
       where none came up was being shown a collapse they never caused.

       ONLY on an explicit not_tested. A row from an older rubric version
       carries no status at all, and absence of the flag is not evidence
       the category was untested -- those keep the old behaviour. */
    if (c.status === STATUS_NOT_TESTED) continue;
    const score = num(c.score);
    const max = num(c.max);
    /* Normalised to a percentage so dimensions with different maxima
       (discovery is out of 15, opening out of 10) can be compared and
       averaged without one silently dominating. */
    if (score != null && max) dims[d.key] = round1((score / max) * 100);
  }
  return {
    sessionId: row.session_id || row.sessionId || null,
    scoredAt: row.scored_at || row.scoredAt || null,
    /* WHICH DENOMINATOR PRODUCED THIS NUMBER. A non-buyer `overall` is
       computed over different categories against a different total, so it is
       not comparable with a buyer one. Defaults to buyer, because every row
       written before Controlled Uncertainty was a buyer call. */
    track: row.track || (row.result && row.result.track) || review.track || 'buyer',
    mode: row.mode || null,
    prospectName: row.prospect_name || row.prospectName || null,
    overall: num(row.overall_score) ?? num(row.overall) ?? num(review.overall),
    sales: num(row.sales_score) ?? num(row.sales) ?? num(review.sales),
    rubricVersion: row.rubric_version || row.rubricVersion || null,
    dimensions: dims,
    /* The rubric's own honesty flag. A call it could not evidence should
       not be allowed to move a trend line. */
    sufficiency: row.evidence_sufficiency || review.evidenceSufficiency || null,
    biggestLeak: (review.biggestLeak && (review.biggestLeak.fault || review.biggestLeak.label)) || null,
  };
}

const confidenceFor = (n) => (n >= MIN_FOR_TREND ? CONFIDENCE.FIRM
  : n >= MIN_FOR_DIRECTION ? CONFIDENCE.EMERGING : CONFIDENCE.NONE);

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* Compares the EARLIER HALF against the LATER HALF rather than first
   against last, because one outlier call at either end otherwise decides
   the whole verdict -- which is exactly how a progress chart starts lying.

   MEDIAN, NOT MEAN, and the difference is not cosmetic. The mean version
   of this failed its own test: a founder scoring 40, 41, 39, 40, 41 who
   then had one exceptional call at 85 was reported as IMPROVING (+15.3),
   because a single outlier moves a three-call mean by a third of its own
   distance. The median of that same later half is 41, so the verdict is
   flat -- which is the truth. One brilliant call is not a trend, and one
   catastrophe does not erase a good history either. */
function halvesDelta(values) {
  if (values.length < 2) return null;
  const mid = Math.floor(values.length / 2);
  const early = median(values.slice(0, mid));
  const late = median(values.slice(values.length - mid));
  if (early == null || late == null) return null;
  return round1(late - early);
}

const directionOf = (delta) => {
  if (delta == null) return 'unknown';
  if (delta > NOISE_BAND) return 'improving';
  if (delta < -NOISE_BAND) return 'slipping';
  return 'flat';
};

/* ── THE READ ─────────────────────────────────────────────────────────
   `rows` newest-last. Test sessions must already be excluded by the
   caller -- a fixture is not a rehearsal and must never move a founder's
   line. */
export function buildProgress({ rows = [] } = {}) {
  const all = rows.map(normaliseCall).filter(Boolean);
  const calls = all.filter((c) => c.overall != null)
    .sort((a, b) => String(a.scoredAt || '').localeCompare(String(b.scoredAt || '')));

  /* ── A CALL THAT COULD NOT BE SCORED STILL HAPPENED ───────────────────
     These rows are dropped from every calculation -- they carry no overall,
     so they cannot move an average, a trend, or the evidence threshold, and
     turning one into a zero would invent a crash the founder never had.

     But dropping them SILENTLY is its own lie. Observed live: three calls
     were completed, two were too short for the rubric to evidence, and the
     screen said "1 scored rehearsal" with no account of the other two. The
     founder is left to conclude the product lost their work. Counted here
     so a surface can say what happened without ever scoring them. */
  const unscored = all.length - calls.length;

  const n = calls.length;
  const confidence = confidenceFor(n);
  const overalls = calls.map((c) => c.overall);

  const dimensions = DIMENSIONS.map((d) => {
    const series = calls.map((c) => c.dimensions[d.key]).filter((v) => v != null);
    const delta = series.length >= 2 ? halvesDelta(series) : null;
    return {
      key: d.key,
      label: d.label,
      latest: series.length ? series[series.length - 1] : null,
      best: series.length ? Math.max(...series) : null,
      average: series.length ? round1(mean(series)) : null,
      delta,
      direction: series.length >= MIN_FOR_DIRECTION ? directionOf(delta) : 'unknown',
      samples: series.length,
      series,
    };
  });

  /* WHAT IS ACTUALLY WORTH SAYING. Only dimensions with enough samples to
     have a direction may be called improved or stuck -- the rest are
     simply not discussed, rather than being shown with a misleading arrow. */
  const rated = dimensions.filter((d) => d.direction !== 'unknown');
  const improved = rated.filter((d) => d.direction === 'improving')
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  const slipping = rated.filter((d) => d.direction === 'slipping')
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));
  /* The weakest thing that is NOT improving -- the one worth working on
     next. A low score that is climbing does not need attention; a mediocre
     one that has not moved in five calls does. */
  const stuck = rated.filter((d) => d.direction !== 'improving' && d.average != null)
    .sort((a, b) => (a.average ?? 0) - (b.average ?? 0))[0] || null;

  /* A leak that keeps recurring is a pattern; one that happened once is an
     event. Only the former is worth naming. */
  const leakCounts = {};
  calls.forEach((c) => { if (c.biggestLeak) leakCounts[c.biggestLeak] = (leakCounts[c.biggestLeak] || 0) + 1; });
  const recurring = Object.entries(leakCounts).filter(([, k]) => k >= 2)
    .sort((a, b) => b[1] - a[1])[0] || null;

  return {
    version: PRACTICE_PROGRESS_VERSION,
    calls: n,
    /* Completed vs scored, kept as separate numbers so no surface has to
       infer one from the other. */
    completed: all.length,
    unscored,
    /* Said once, here, so every surface uses the same words and none has to
       invent a caveat. Null when nothing was dropped -- a founder whose
       calls all scored must never see a warning about calls that do not
       exist. */
    unscoredNote: unscored > 0
      ? `${unscored} ${unscored === 1 ? 'call was' : 'calls were'} too short to score.`
      : null,
    confidence,
    /* Said in plain words so a surface never has to invent the caveat. */
    headline: n === 0
      ? (unscored > 0
        ? `No scored rehearsals yet — ${unscored} ${unscored === 1 ? 'call was' : 'calls were'} too short to score.`
        : 'No scored rehearsals yet.')
      : confidence === CONFIDENCE.NONE
        ? `${n} scored ${n === 1 ? 'rehearsal' : 'rehearsals'} — too few to call a trend yet.`
        : confidence === CONFIDENCE.EMERGING
          ? `${n} scored rehearsals — an early direction, not yet a trend.`
          : `${n} scored rehearsals — enough to see a real trend.`,
    latest: n ? overalls[overalls.length - 1] : null,
    best: n ? Math.max(...overalls) : null,
    average: n ? round1(mean(overalls)) : null,
    overallDelta: n >= 2 ? halvesDelta(overalls) : null,
    /* Direction is withheld entirely below MIN_FOR_DIRECTION rather than
       shown as flat, because "flat" is itself a claim. */
    direction: n >= MIN_FOR_DIRECTION ? directionOf(halvesDelta(overalls)) : 'unknown',
    series: overalls,
    dimensions,
    improved,
    slipping,
    focus: stuck,
    recurringLeak: recurring ? { fault: recurring[0], calls: recurring[1] } : null,
    noiseBand: NOISE_BAND,
    thresholds: { direction: MIN_FOR_DIRECTION, trend: MIN_FOR_TREND },
  };
}

/* ── TWO TRACKS, NEVER AVERAGED ───────────────────────────────────────
   `buildProgress` is the per-track calculation and is unchanged: hand it one
   track's rows and it answers about that track.

   What it must never be handed is both. The trend is a median halves-vs-
   halves over `overall`, and a non-buyer overall is a different denominator
   over different categories -- mix them and a founder's "improvement" is
   partly a record of WHICH ROLE THEY DREW, which is noise presented as
   progress. Worse, it would be noise the founder cannot see or control.

   MINIMUMS APPLY PER TRACK. A track with two calls in it says "not enough
   yet" rather than borrowing the other track's calls to reach a number.

   THERE IS NO COMBINED HEADLINE, and `combined: null` is deliberate rather
   than absent: a consumer reaching for one finds an explicit refusal instead
   of undefined, which is the difference between a rule and an omission. */
export function buildProgressByTrack({ rows = [] } = {}) {
  const of = (track) => (rows || []).filter((r) => {
    const t = (r && (r.track || (r.result && r.result.track)
      || (r.result && r.result.review && r.result.review.track))) || 'buyer';
    return t === track;
  });
  return {
    buyer: buildProgress({ rows: of('buyer') }),
    non_buyer: buildProgress({ rows: of('non_buyer') }),
    /* REAL CALLS ARE A THIRD DENOMINATOR, not a rehearsal with better audio.
       Delivery is never scored on a phone line, pitch timing is only
       testable when the prospect said in words that they wanted the offer,
       and some of the turns could not be attributed at all. Kept apart for
       exactly the reason the first two are. */
    live: buildProgress({ rows: of('live') }),
    /* Untested stays untested: a gatekeeper-only history may never read as
       evidence of discovery, objection handling or closing ability, and a
       history of real calls may never read as evidence of rehearsal. */
    combined: null,
    combinedForbiddenBecause: 'different_denominators_are_not_comparable',
  };
}
