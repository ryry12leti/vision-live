/**
 * Founder Bottleneck Intelligence — confidence classification (spec section 8).
 *
 * Deterministic downgrade ladder: start at the best case the evidence could
 * possibly support, then downgrade one step for each honest reason not to
 * trust it fully. Never upgraded past what the underlying route assessment
 * and snapshot/entity freshness actually support.
 */

const LEVELS = ['high', 'medium', 'low'];

function downgrade(level, steps = 1) {
  const index = Math.min(LEVELS.length - 1, LEVELS.indexOf(level) + steps);
  return LEVELS[index];
}

/**
 * @param {object} params
 * @param {{category: string, score: number}|null} params.primaryBottleneck
 * @param {boolean} params.ambiguity
 * @param {object} params.snapshot
 * @param {object} params.entityBundle
 * @param {object[]} params.routeAssessments
 * @returns {'high'|'medium'|'low'}
 */
export function computeBottleneckConfidence({
  primaryBottleneck, ambiguity, snapshot, entityBundle, routeAssessments,
}) {
  if (!primaryBottleneck) return 'low';
  if (ambiguity) return 'low';

  /* Only contradictions on facts the engine actually depends on may pin
     confidence low. Contradiction checking is NOT weakened: every
     high-impact conflict blocks exactly as it always did, and every
     conflict of any kind is still recorded in snapshot.conflicts. What
     changes is that a disagreement between two engine-internal bookkeeping
     records (activeOutcomeThread, written by generation itself) no longer
     blocks the next mission -- observed on staging pinning a venture whose
     founder had answered everything to 'low' permanently, because the
     cached state kept a conflict the fact ledger had already resolved.
     Falls back to the full list for any caller still passing a
     pre-blockingConflicts snapshot. */
  const relevantConflicts = (snapshot.blockingConflicts ?? snapshot.conflicts ?? []).length;
  if (relevantConflicts > 0) return 'low';
  if (snapshot.missingCriticalContext.length > 1) return 'low';

  // "Multiple trusted facts support one constraint" (spec section 8, HIGH) --
  // count supportingEvidence across every route close to the winning score,
  // not just the single best route, since a category can draw strength from
  // more than one route (e.g. weak_demand's own route plus the interview
  // route both showing the same gap).
  const supportingCount = routeAssessments
    .filter((route) => route.bottleneckRelevance >= primaryBottleneck.score - 5)
    .reduce((sum, route) => sum + route.supportingEvidence.length, 0);

  let level = supportingCount >= 2 && snapshot.confidence >= 0.7 ? 'high' : 'medium';

  const stale = snapshot.freshness === 'stale' || entityBundle.freshness === 'stale';
  if (stale) level = downgrade(level);

  if (snapshot.missingCriticalContext.length === 1) level = downgrade(level);
  if (snapshot.confidence < 0.5) level = downgrade(level);

  return level;
}
