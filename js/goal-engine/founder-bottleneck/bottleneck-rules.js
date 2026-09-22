/**
 * Founder Bottleneck Intelligence — deterministic category ranking.
 *
 * Turns 7 RouteAssessments into a category-level ranking, then a single
 * primaryBottleneck (or none, when evidence is too thin/ambiguous) plus up
 * to 2 secondaryConstraints. No LLM is used to make this decision (spec
 * section 6) -- every step here is a fixed, explainable rule over numbers
 * and matched keywords already attached to each RouteAssessment.
 */

import {
  BOTTLENECK_CATEGORY_ROUTES, CATEGORY_LABEL, CATEGORY_PRIORITY_TAG, CATEGORY_TIE_MARGIN,
  FOUNDER_BOTTLENECK_CATEGORIES, MIN_MEANINGFUL_CATEGORY_SCORE, PRIORITY_HIERARCHY,
} from './contract.js';
import { survivalSignalMatches } from './signals.js';
import { resolveCandidateDecision } from '../decision-core/index.js';

// BOTTLENECK_CATEGORY_ROUTES lists candidate-generation ALTERNATES (e.g.
// weak_demand can be addressed via founder_offer_test OR
// founder_customer_interview_set) -- but for SCORING a category, only its
// own most-direct route's dimension evidence counts (the first entry). An
// alternate route's score belongs to the category it was itself computed
// for (customer_interview_set's evidence is about insufficient_customer_
// evidence, never about weak_demand, even though it can also help resolve
// weak_demand later during candidate generation). Using the alternates here
// too would let one strong route inflate every category that lists it.
function primaryRouteFor(category) {
  return BOTTLENECK_CATEGORY_ROUTES[category][0];
}

function rawCategoryScore(category, routeAssessmentsById) {
  return routeAssessmentsById[primaryRouteFor(category)]?.bottleneckRelevance ?? 0;
}

function bestReasonFor(category, routeAssessmentsById) {
  return routeAssessmentsById[primaryRouteFor(category)]?.explanation || 'no supporting evidence on record';
}

function priorityRank(category) {
  return PRIORITY_HIERARCHY.indexOf(CATEGORY_PRIORITY_TAG[category]);
}

/**
 * @param {object[]} routeAssessments From route-assessment.js's assessRoutes().
 * @param {object} snapshot Trusted snapshot (for the survival/money tie-break signal only).
 * @returns {{ranked: {category: string, score: number}[], survivalSignal: boolean}}
 */
function rankCategories(routeAssessments, snapshot) {
  const routeAssessmentsById = Object.fromEntries(routeAssessments.map((route) => [route.routeId, route]));
  const survivalMatches = survivalSignalMatches(snapshot);
  const survivalSignal = survivalMatches.length > 0;

  const scored = FOUNDER_BOTTLENECK_CATEGORIES.map((category) => {
    let score = rawCategoryScore(category, routeAssessmentsById);
    // Survival/cash risk boosts a money-tagged category's rank ONLY when it
    // already has real evidence (score > 0) -- it never manufactures
    // relevance for a category with zero supporting evidence (spec section
    // 7: "the actual evidence may override the default hierarchy", and "do
    // not force money language onto every business").
    if (survivalSignal && score > 0 && CATEGORY_PRIORITY_TAG[category] === 'money') {
      score = Math.min(100, score + 20);
    }
    return { category, score, reason: bestReasonFor(category, routeAssessmentsById) };
  });

  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > CATEGORY_TIE_MARGIN) return b.score - a.score;
    // Within a tie margin, break by the fixed priority hierarchy, then by
    // category name for full determinism.
    const rankDiff = priorityRank(a.category) - priorityRank(b.category);
    if (rankDiff !== 0) return rankDiff;
    if (b.score !== a.score) return b.score - a.score;
    return a.category.localeCompare(b.category);
  });

  return { ranked: scored, survivalSignal };
}

/**
 * @param {object[]} routeAssessments
 * @param {object} snapshot
 * @returns {{
 *   primaryBottleneck: {category: string, label: string, score: number, priorityTag: string, reason: string}|null,
 *   secondaryConstraints: object[],
 *   ambiguity: boolean,
 *   survivalSignal: boolean,
 * }}
 */
export function detectBottleneck(routeAssessments, snapshot, tieBreakChoice = null, addressableCategories = null) {
  const { ranked, survivalSignal } = rankCategories(routeAssessments, snapshot);


  // The ambiguity/tie-break algorithm is the shared Goal Engine invariant
  // (decision-core). Founder supplies its own already-priority-tie-broken
  // ranking, its own candidate ids (categories), and its own margins -- none
  // of which the shared layer knows about (spec QA case 37).
  const decision = resolveCandidateDecision({
    candidates: ranked.map((entry) => ({ id: entry.category, score: entry.score })),
    // Which constraint LEADS is untouched by eligibility -- an unactionable
    // constraint is still honestly the constraint. Eligibility only stops a
    // tie being put to the founder when one of the tied pair is a dead end.
    eligibleCandidateIds: addressableCategories,
    tieMargin: CATEGORY_TIE_MARGIN,
    minMeaningfulScore: MIN_MEANINGFUL_CATEGORY_SCORE,
    tieBreakChoice,
  });

  if (decision.status === 'no_meaningful_candidate') {
    return {
      primaryBottleneck: null, secondaryConstraints: [], ambiguity: true, survivalSignal, tieBreak: null, tieBreakResolvedBy: null,
    };
  }

  // When a valid user tie-break resolved the ambiguity, the winner is the
  // candidate the founder named -- not necessarily the ranking leader.
  const top = ranked.find((entry) => entry.category === decision.winnerId) || ranked[0];

  const primaryBottleneck = {
    category: top.category,
    label: CATEGORY_LABEL[top.category],
    score: Math.round(top.score),
    priorityTag: CATEGORY_PRIORITY_TAG[top.category],
    reason: top.reason,
  };

  const ambiguity = decision.ambiguity;
  const tieBreak = decision.tieBreak
    ? {
      signature: decision.tieBreak.signature,
      candidates: decision.tieBreak.candidates.map((candidate) => ({
        category: candidate.id,
        label: CATEGORY_LABEL[candidate.id],
        score: Math.round(candidate.score),
      })),
      rejectedChoiceReason: decision.rejectedTieBreakReason,
    }
    : null;

  const secondaryConstraints = ranked
    .slice(1)
    .filter((entry) => entry.score >= MIN_MEANINGFUL_CATEGORY_SCORE)
    .slice(0, 2)
    .map((entry) => ({
      category: entry.category,
      label: CATEGORY_LABEL[entry.category],
      score: Math.round(entry.score),
      priorityTag: CATEGORY_PRIORITY_TAG[entry.category],
      reason: entry.reason,
    }));

  return {
    primaryBottleneck, secondaryConstraints, ambiguity, survivalSignal, tieBreak, tieBreakResolvedBy: decision.resolvedBy,
  };
}
