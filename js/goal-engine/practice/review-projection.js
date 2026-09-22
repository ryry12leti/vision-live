/* ════════════════════════════════════════════════════════════════════════
   THE PRACTICE_SCORE RESPONSE, IN ONE PLACE.

   This was assembled by hand inside the Edge Function, which is how
   `scoredTurns` came to be missing from it: there was nothing to test, only
   an object literal in a request handler that no offline suite could reach.
   A projection nobody can import is a projection nobody can check.

   Pure. It reads the rubric result and the pipeline output and renames
   things; it decides nothing and must never start to. The Edge Function
   imports this and so does the seam regression, so the two cannot drift --
   which was the entire failure mode.
   ══════════════════════════════════════════════════════════════════════ */

export const REVIEW_PROJECTION_VERSION = 'practice_review_projection_v1';

const DELIVERY_KEYS = Object.freeze(['clarity', 'approachability', 'pacing',
  'concision', 'composure', 'rhythm']);

/**
 * @param {object} result the rubric's score object (piped.score)
 * @param {object} piped  the pipeline output
 */
export function buildReviewPayload(result, piped) {
  return {
    outcome: result.outcome,
    /* WHICH DENOMINATOR PRODUCED THIS NUMBER. Without it the progress layer
       cannot keep the two tracks apart, and a founder's improvement becomes
       partly a record of which role they drew. */
    track: piped.track || result.track || 'buyer',
    trackBecause: piped.trackBecause || null,
    overall: result.overallScore, sales: result.sales.score, delivery: result.delivery.score,
    categories: {
      sales: Object.fromEntries(Object.keys(result.sales)
        .filter((k) => result.sales[k] && result.sales[k].max)
        .map((k) => [k, {
          score: result.sales[k].score, max: result.sales[k].max,
          status: result.sales[k].evidenceStatus,
          confidence: result.sales[k].confidence,
          why: result.sales[k].why, refs: result.sales[k].evidenceRefs,
        }])),
      delivery: Object.fromEntries(DELIVERY_KEYS
        .map((k) => [k, {
          score: result.delivery[k].score, max: result.delivery[k].max,
          why: result.delivery[k].why,
        }])),
    },
    majorPatterns: result.majorPatterns,
    guided: result.guided,
    scriptReliance: result.scriptReliance,
    achievement: result.achievement,
    evidenceSufficiency: result.evidenceSufficiency,
    assessmentConfidence: result.assessmentConfidence,
    /* So the review can name WHICH parts of the call never came up. */
    testedWeight: result.sales.testedWeight,
    unscored: result.unscored,
    /* AUTHORITATIVE, AND NOWHERE ELSE TO COME FROM. Every one of these is a
       reconciled finding id away from its evidence. A leak of null is a real
       answer: this call had nothing defensibly wrong with it. */
    biggestWin: piped.win,
    biggestLeak: piped.leak,
    /* The reconciled per-turn labels. The timeline is assembled in the
       browser from practice_turns, whose labels are the behaviour engine's
       originals, so without these every reconciliation stops at the server. */
    scoredTurns: piped.scoredTurns,
    corrections: piped.corrections,
    namedFaults: piped.namedFaults,
    provenance: piped.provenance,
  };
}
