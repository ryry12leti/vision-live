/**
 * Goal Engine decision core — the shared, domain-agnostic decision primitive.
 *
 * This layer holds the parts of "pick one thing to do next" that are true for
 * EVERY Goal Engine domain, and nothing that is true for only one:
 *
 *   - confidence is computed only from the facts the CURRENT decision depends
 *     on, so unrelated provisional context is neutral rather than corrosive;
 *   - a strictly higher-trust fact retires the conflict it genuinely resolves,
 *     and only that one, with the superseded value and the retired conflict
 *     preserved for audit;
 *   - a clear evidence winner is simply selected;
 *   - two candidates inside the domain's own tie margin are a genuine
 *     ambiguity, answered by ONE structured tie-break requirement naming only
 *     those two candidates;
 *   - a user's tie-break choice is a bounded ambiguity resolver: it must name
 *     one of the CURRENT top two, it never overrides a clear evidence winner,
 *     and it is ignored the moment the tied pair changes.
 *
 * Every domain-specific thing -- candidate names, labels, question wording,
 * scoring, ranking order, tie margin, which facts are relevant -- is supplied
 * by the caller. This file deliberately names no domain, candidate, or fact
 * key belonging to any single Goal Engine: another engine adopts it by
 * passing its own candidates and configuration, never by editing this
 * algorithm. `scripts/qa-goal-engine-decision-core.mjs` asserts that purity.
 */

/**
 * Trust ladder shared by every domain. A domain may pass its own `weights`,
 * but these are the canonical Goal Engine verification tiers.
 */
export const DEFAULT_TRUST_WEIGHTS = Object.freeze({
  proof_verified: 1,
  system_verified: 0.85,
  user_confirmed: 0.6,
  provisional: 0.3,
  disputed: 0.05,
});

/** Higher wins. Used to decide when one fact strictly outranks another. */
export const DEFAULT_TRUST_RANK = Object.freeze({
  disputed: 0,
  provisional: 1,
  user_confirmed: 2,
  system_verified: 3,
  proof_verified: 4,
});

export function trustRank(verificationStatus, ranks = DEFAULT_TRUST_RANK) {
  return ranks[verificationStatus] ?? 0;
}

/**
 * Confidence for the CURRENT decision only.
 *
 * `relevantFactKeys` is the decision's own dependency set (its critical facts
 * plus its route/prerequisite facts). Anything outside that set is ignored
 * entirely -- recording more optional context can never lower a decision's
 * confidence. A relevant fact that is present but low-trust DOES lower it,
 * which is the honest signal.
 *
 * `aggregateGroups` covers prerequisites satisfied by ANY ONE of a collection
 * (e.g. "one reachable prospect"): each group contributes a single best-trust
 * member, so holding five of something never dilutes the mean.
 *
 * @param {object} params
 * @param {Record<string, {verificationStatus: string}>} params.facts Per-key winning facts.
 * @param {string[]} params.relevantFactKeys
 * @param {{prefix: string}[]} [params.aggregateGroups]
 * @param {Record<string, number>} [params.weights]
 * @returns {number} 0..1, rounded to 2dp. 0 when nothing relevant is present.
 */
export function computeRelevantConfidence({
  facts, relevantFactKeys, aggregateGroups = [], weights = DEFAULT_TRUST_WEIGHTS,
}) {
  const weightOf = (fact) => weights[fact?.verificationStatus] ?? 0;
  const considered = (relevantFactKeys || [])
    .map((factKey) => facts[factKey])
    .filter(Boolean);

  for (const group of aggregateGroups) {
    let best = null;
    for (const [factKey, fact] of Object.entries(facts)) {
      if (!factKey.startsWith(group.prefix)) continue;
      if (!best || weightOf(fact) > weightOf(best)) best = fact;
    }
    if (best) considered.push(best);
  }

  if (considered.length === 0) return 0;
  const total = considered.reduce((sum, fact) => sum + weightOf(fact), 0);
  return Math.round((total / considered.length) * 100) / 100;
}

/**
 * Retire the conflicts that an incoming fact genuinely resolves.
 *
 * Only a STRICTLY higher-trust fact resolves anything, and only for its own
 * key. Equal-trust disagreement is left standing -- the system must never
 * silently choose between two facts the user holds with the same
 * authority. Nothing is deleted: the retired conflict is returned so the
 * caller can keep it in audit history alongside the superseded value.
 *
 * @returns {{conflicts: object[], retired: object[]}}
 */
export function retireConflictsResolvedBy({
  conflicts, factKey, factId, incomingRank, currentRank,
}) {
  if (!(incomingRank > currentRank) || !conflicts || conflicts.length === 0) {
    return { conflicts: conflicts || [], retired: [] };
  }
  const retired = [];
  const remaining = [];
  for (const conflict of conflicts) {
    if (conflict.factKey === factKey) retired.push({ ...conflict, resolvedByFactId: factId });
    else remaining.push(conflict);
  }
  return { conflicts: remaining, retired };
}

/**
 * A stable identity for "which two candidates are currently tied".
 * A stored tie-break choice is only meaningful while this is unchanged.
 */
export function candidateSetSignature(candidates) {
  return (candidates || []).map((candidate) => candidate.id).slice().sort().join('|');
}

/**
 * Resolve a ranked candidate list into a winner, or one bounded tie-break.
 *
 * `candidates` arrives in the DOMAIN's own ranking order (a domain may apply
 * its own priority hierarchy before score), and this layer respects that
 * order for choosing the leader. Ambiguity is measured on score distance.
 *
 * @param {object} params
 * @param {{id: string, score: number}[]} params.candidates Domain-ranked, best first.
 * @param {number} params.tieMargin Domain's existing tie margin.
 * @param {number} params.minMeaningfulScore Domain's existing floor.
 * @param {{candidateId: string, candidateSetSignature: string}|null} [params.tieBreakChoice]
 * @param {string[]|null} [params.eligibleCandidateIds] Candidates the caller can actually act on now. Never changes which candidate LEADS -- an unactionable constraint is still honestly the leading constraint -- but a tie is not put to the user when only one of the tied pair is actionable, because that would be a fake choice ending in another dead end.
 * @returns {{
 *   status: 'selected'|'tie_break_required'|'no_meaningful_candidate',
 *   winnerId: string|null,
 *   ambiguity: boolean,
 *   resolvedBy: 'evidence'|'user_tie_break'|null,
 *   tieBreak: {candidates: {id: string, score: number}[], signature: string}|null,
 *   rejectedTieBreakReason: string|null,
 * }}
 */
export function resolveCandidateDecision({
  candidates, tieMargin, minMeaningfulScore, tieBreakChoice = null, eligibleCandidateIds = null,
}) {
  const ranked = (candidates || []).filter((candidate) => Number.isFinite(candidate?.score));
  const leader = ranked[0];

  if (!leader || leader.score < minMeaningfulScore) {
    return {
      status: 'no_meaningful_candidate', winnerId: null, ambiguity: true, resolvedBy: null, tieBreak: null, rejectedTieBreakReason: null,
    };
  }

  const runnerUp = ranked[1];
  const tied = Boolean(runnerUp)
    && Math.abs(leader.score - runnerUp.score) <= tieMargin
    && runnerUp.score >= minMeaningfulScore;

  // A clear evidence winner is decided by evidence, full stop. A stored
  // choice is not even consulted here -- that is what "never override a
  // clear evidence-based winner" means, and it is also how stronger later
  // evidence automatically retires an earlier choice.
  if (!tied) {
    return {
      status: 'selected',
      winnerId: leader.id,
      ambiguity: false,
      resolvedBy: 'evidence',
      tieBreak: null,
      rejectedTieBreakReason: tieBreakChoice ? 'evidence_no_longer_ambiguous' : null,
    };
  }

  const topTwo = [leader, runnerUp];
  const signature = candidateSetSignature(topTwo);

  // A tie is only a real question when the user could act on either answer.
  // When exactly one of the tied pair is actionable right now, asking would
  // offer a dead end as if it were a choice.
  if (Array.isArray(eligibleCandidateIds)) {
    const actionable = topTwo.filter((candidate) => eligibleCandidateIds.includes(candidate.id));
    if (actionable.length === 1) {
      return {
        status: 'selected',
        winnerId: actionable[0].id,
        ambiguity: false,
        resolvedBy: 'only_actionable_candidate',
        tieBreak: null,
        rejectedTieBreakReason: null,
      };
    }
  }

  if (tieBreakChoice) {
    const namesCurrentCandidate = topTwo.some((candidate) => candidate.id === tieBreakChoice.candidateId);
    const signatureMatches = tieBreakChoice.candidateSetSignature === signature;
    if (namesCurrentCandidate && signatureMatches) {
      return {
        status: 'selected',
        winnerId: tieBreakChoice.candidateId,
        ambiguity: false,
        resolvedBy: 'user_tie_break',
        tieBreak: null,
        rejectedTieBreakReason: null,
      };
    }
    return {
      status: 'tie_break_required',
      winnerId: null,
      ambiguity: true,
      resolvedBy: null,
      tieBreak: { candidates: topTwo, signature },
      rejectedTieBreakReason: namesCurrentCandidate ? 'stale_candidate_set' : 'choice_not_in_current_top_two',
    };
  }

  return {
    status: 'tie_break_required',
    winnerId: null,
    ambiguity: true,
    resolvedBy: null,
    tieBreak: { candidates: topTwo, signature },
    rejectedTieBreakReason: null,
  };
}
