/**
 * Founder Mission Comparison — multiple candidate brief generation.
 *
 * Restricted, deterministic candidate generation grounded directly in
 * founder-execution-context's already-computed routeEvaluations -- never
 * the generic candidate-generator/trusted-context pipeline (see
 * founder-bottleneck/contract.js's header for why). Only ELIGIBLE routes
 * relevant to the assessed bottleneck ever become a candidate; a candidate
 * is never generated for a route the founder cannot execute today.
 *
 * Target: at least one candidate for the primary bottleneck's most-direct
 * route, a credible alternate route for the same bottleneck when one is
 * also eligible, and up to one candidate per meaningfully-scored secondary
 * constraint -- never padded with routes that have no real relevance or are
 * not currently eligible (spec section 11).
 *
 * When the leading constraint is one the founder cannot act on today, the
 * pool also extends to the remaining categories that DO have an eligible
 * route, so genuinely executable work still reaches the comparator instead
 * of being silently discarded -- see addressableCategoriesOutsideAssessment.
 */

import {
  FOUNDER_WORK_UNIT_BUSINESS_FUNCTION, BOTTLENECK_CATEGORY_ROUTES, CATEGORY_LABEL,
  FOUNDER_BOTTLENECK_CATEGORIES, CATEGORY_PRIORITY_TAG, PRIORITY_HIERARCHY,
} from '../founder-bottleneck/index.js';
import {
  buildSteps, composeMissionNarrative, requiredEvidenceFor, professionalStandardFor, learningSupportFor,
} from './mission-compiler.js';
import { reachableCustomerEntities } from '../founder-bottleneck/signals.js';

const MAX_CANDIDATES = 5;
const MINUTES_PER_STEP = 20;
const MIN_MINUTES = 30;
const MAX_MINUTES = 120;

function effortLevelFor(minutes) {
  if (minutes <= 30) return 'light';
  if (minutes <= 75) return 'moderate';
  return 'heavy';
}

// Named "relevantEntitiesForRoute" (not "customerEntitiesForRoute") because
// operating_process/strategy_decision resolve a process/decision entity, not
// a customer -- both cases are a pure identity lookup by the id
// route-eligibility.js already selected (routeEvaluation.identifierFields),
// never a new selection decision made here.
function relevantEntitiesForRoute(routeId, entityBundle, identifierFields) {
  if (routeId === 'founder_sales_outreach_block') {
    const reachable = reachableCustomerEntities(entityBundle);
    // A prospect who already responded and named a specific next step
    // (proof/pricing/proposal/meeting) IS the outreach work now -- closing
    // that named, warm conversation takes priority over generic cold
    // contacts, so the candidate is built exclusively from them when any
    // exist (never a fabricated mix of "close this one" and "also cold-call
    // three more" in the same mission).
    const withPendingRequest = reachable.filter((entity) => Boolean(entity.value.pendingRequest));
    return withPendingRequest.length > 0 ? withPendingRequest : reachable;
  }
  if (['founder_customer_interview_set', 'founder_offer_test'].includes(routeId)) {
    return reachableCustomerEntities(entityBundle);
  }
  if (routeId === 'founder_operating_process') {
    const match = (entityBundle.operatingProcessEntities || []).find((entity) => entity.entityId === identifierFields.processId);
    return match ? [match] : [];
  }
  if (routeId === 'founder_strategy_decision') {
    const match = (entityBundle.strategyDecisionEntities || []).find((entity) => entity.entityId === identifierFields.decisionId);
    return match ? [match] : [];
  }
  return [];
}

function buildOneCandidate(routeId, alignment, bottleneckCategory, { snapshot, entityBundle, executionContext, routeEvaluationsById, missionContext }) {
  const routeEvaluation = routeEvaluationsById[routeId];
  if (!routeEvaluation || routeEvaluation.eligibility !== 'eligible') return null;

  const relevantEntities = relevantEntitiesForRoute(routeId, entityBundle, routeEvaluation.identifierFields);
  const steps = buildSteps(routeId, routeEvaluation.identifierFields, relevantEntities, missionContext, snapshot);
  if (steps.length === 0) return null;

  const narrative = composeMissionNarrative(routeId, routeEvaluation.identifierFields, snapshot, relevantEntities, CATEGORY_LABEL[bottleneckCategory], missionContext);
  const timeEstimateMinutes = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, steps.length * MINUTES_PER_STEP));

  return {
    candidateId: `${routeId}_candidate`,
    routeId,
    businessFunction: FOUNDER_WORK_UNIT_BUSINESS_FUNCTION[routeId],
    bottleneckCategory,
    bottleneckAlignment: alignment,
    identifierFields: routeEvaluation.identifierFields,
    resourceBindings: routeEvaluation.resourceBindings,
    // routeEvaluation.resourceBindings values are one-element arrays (see
    // resource-bindings.js's own contract) -- flatten to the flat list of
    // real resource ids this candidate actually depends on.
    requiredResourceIds: Object.values(routeEvaluation.resourceBindings).flat(),
    missingResourceIds: routeEvaluation.missingPrerequisites,
    steps,
    timeEstimateMinutes,
    effortLevel: effortLevelFor(timeEstimateMinutes),
    requiredEvidence: requiredEvidenceFor(routeId, relevantEntities),
    professionalStandard: professionalStandardFor(routeId, relevantEntities),
    learningSupport: learningSupportFor(routeId, relevantEntities),
    ...narrative,
  };
}

/**
 * Categories the founder can genuinely act on RIGHT NOW that the assessment
 * did not already name as the primary bottleneck or a secondary constraint.
 *
 * WHY THIS EXISTS. detectBottleneck deliberately lets an UNACTIONABLE
 * category lead -- "an unactionable constraint is still honestly the
 * constraint" (founder-bottleneck/bottleneck-rules.js). Correct on its own.
 * And this generator draws only from primary + up to 2 secondaries. Also
 * correct on its own. But when the leading category has no eligible route,
 * those two rules together silently discarded every eligible route sitting
 * outside the top three categories, and the comparator was handed one
 * candidate -- or none -- while the engine held three executable ones. A
 * copywriter with 6 confirmed reachable prospects, whose stated problem was
 * "I cannot get enough qualified conversations", had founder_sales_outreach_
 * block and founder_offer_test both ELIGIBLE and both thrown away, because
 * sales_conversion ranked below delivery_throughput.
 *
 * This widens the POOL only. It does not touch eligibility, and it does not
 * change which constraint leads -- the primary bottleneck is still reported
 * exactly as assessed. Everything added here is an already-eligible route
 * that still has to build real steps in buildOneCandidate, and it enters as
 * 'secondary' alignment, which candidate-evaluation.js scores 60 against the
 * primary's 100 -- so a widened candidate can only ever be selected by
 * genuinely outscoring the bottleneck-aligned one on the other dimensions.
 * No route is padded in, and nothing blocked becomes eligible.
 *
 * Order is fixed and explainable: VISION's default priority hierarchy
 * (PRIORITY_HIERARCHY via CATEGORY_PRIORITY_TAG), then declaration order as
 * a stable tie-break. No new scoring, and no LLM.
 */
function addressableCategoriesOutsideAssessment(bottleneckAssessment, executionContext) {
  const alreadyCovered = new Set([
    bottleneckAssessment.primaryBottleneck.category,
    ...bottleneckAssessment.secondaryConstraints.map((entry) => entry.category),
  ]);
  const eligibleRouteIds = new Set((executionContext.routeEvaluations || [])
    .filter((route) => route.eligibility === 'eligible')
    .map((route) => route.routeId));
  if (eligibleRouteIds.size === 0) return [];

  return FOUNDER_BOTTLENECK_CATEGORIES
    .filter((category) => !alreadyCovered.has(category))
    .filter((category) => (BOTTLENECK_CATEGORY_ROUTES[category] || []).some((routeId) => eligibleRouteIds.has(routeId)))
    .sort((a, b) => {
      const rank = (category) => {
        const position = PRIORITY_HIERARCHY.indexOf(CATEGORY_PRIORITY_TAG[category]);
        return position === -1 ? PRIORITY_HIERARCHY.length : position;
      };
      return rank(a) - rank(b)
        || FOUNDER_BOTTLENECK_CATEGORIES.indexOf(a) - FOUNDER_BOTTLENECK_CATEGORIES.indexOf(b);
    });
}

/**
 * @param {object} params
 * @param {object} params.snapshot Trusted Founder Venture Snapshot.
 * @param {object} params.entityBundle Trusted Founder Execution Entities bundle.
 * @param {object} params.executionContext Trusted Founder Execution Context.
 * @param {object} params.bottleneckAssessment A validated FounderBottleneckAssessment.
 * @returns {object[]} 0-5 genuinely distinct, executable-today candidate briefs.
 */
export function generateFounderCandidateBriefs({
  snapshot, entityBundle, executionContext, bottleneckAssessment, missionContext = null,
}) {
  if (!bottleneckAssessment.primaryBottleneck) return [];

  const routeEvaluationsById = Object.fromEntries(executionContext.routeEvaluations.map((route) => [route.routeId, route]));
  const seen = new Set();
  const candidates = [];

  const categoriesInPriorityOrder = [
    bottleneckAssessment.primaryBottleneck.category,
    ...bottleneckAssessment.secondaryConstraints.map((entry) => entry.category),
    ...addressableCategoriesOutsideAssessment(bottleneckAssessment, executionContext),
  ];

  categoriesInPriorityOrder.forEach((category, categoryIndex) => {
    const alignment = categoryIndex === 0 ? 'primary' : 'secondary';
    for (const routeId of BOTTLENECK_CATEGORY_ROUTES[category]) {
      if (seen.has(routeId) || candidates.length >= MAX_CANDIDATES) continue;
      const candidate = buildOneCandidate(routeId, alignment, category, {
        snapshot, entityBundle, executionContext, routeEvaluationsById, missionContext,
      });
      if (!candidate) continue;
      seen.add(routeId);
      candidates.push(candidate);
    }
  });

  return candidates;
}
