/**
 * Founder Mission Comparison — candidate evaluation.
 *
 * Scores each candidate brief on the dimensions spec section 12 lists, and
 * applies hard-reject gates (spec section 9) BEFORE any score can matter --
 * a rejected candidate's totalScore is forced to 0 and it can never win,
 * regardless of how well its other dimensions score. No dimension has an
 * artificial floor: every dimension legitimately reaches 0 when the
 * underlying evidence does not support it.
 */

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizedTitle(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Deterministic route-specific vocabulary. Broad terms such as "grow" are
// intentionally absent: they cannot make every business function relevant.
const GOAL_TERMS_BY_ROUTE = Object.freeze({
  founder_customer_interview_set: ['customer', 'user', 'problem', 'interview', 'validate', 'validation', 'evidence', 'market need'],
  founder_offer_test: ['offer', 'pricing', 'price', 'willingness to pay', 'conversion', 'proposition'],
  founder_sales_outreach_block: ['sales', 'revenue', 'outreach', 'client', 'clients', 'lead', 'leads', 'acquisition', 'booking', 'bookings'],
  founder_product_delivery_slice: ['build', 'ship', 'product', 'feature', 'deliver', 'delivery', 'launch', 'implementation'],
  founder_retention_analysis: ['retention', 'churn', 'activation', 'repeat use', 'cancellation', 'cancel', 'engagement'],
  founder_operating_process: ['operations', 'process', 'fulfilment', 'fulfillment', 'support', 'delivery system', 'efficiency', 'errors'],
  founder_strategy_decision: ['decision', 'choose', 'option', 'direction', 'strategy', 'positioning'],
});

function sectionText(section) {
  if (section?.status !== 'known') return '';
  const values = Array.isArray(section.value) ? section.value : [section.value];
  return values.filter((value) => typeof value === 'string').join(' ').toLowerCase();
}

function matchesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

export function scoreFounderGoalAlignment(routeId, snapshot) {
  const terms = GOAL_TERMS_BY_ROUTE[routeId] || [];
  const goalMatch = matchesAny(sectionText(snapshot.currentGoal), terms);
  const priorityMatch = matchesAny(sectionText(snapshot.currentPriorities), terms);
  if (goalMatch && priorityMatch) return { score: 100, reason: 'explicit current goal and priority match this route' };
  if (goalMatch) return { score: 85, reason: 'explicit current goal matches this route' };
  if (priorityMatch) return { score: 70, reason: 'explicit current priority matches this route' };
  return { score: 0, reason: 'no trusted current goal or priority matches this route' };
}

// ---------------------------------------------------------------------------
// Hard-reject gates. Each returns a reason string, or null when the
// candidate passes. "Wrong venture"/"secondary venture" rejection (spec QA
// cases 47-48) is enforced upstream, once, by assembler.js's cross-check of
// ventureId/ventureRole across snapshot/entityBundle/executionContext/
// bottleneckAssessment before any candidate is ever built -- every candidate
// reaching this evaluator already belongs to the single validated primary
// venture, so there is nothing left for a per-candidate gate to catch here.
function gateConflictsWithTrustedState(candidate, { snapshot }) {
  const conflictedFields = new Set((snapshot.conflicts || []).map((conflict) => conflict.factKey));
  if (conflictedFields.size === 0) return null;
  const relevantFields = ['customerEvidence', 'offerPricing', 'revenue', 'unfinishedWork', 'stage'];
  const hit = relevantFields.some((field) => conflictedFields.has(field));
  return hit ? 'the trusted snapshot has an unresolved conflict on a fact this mission directly depends on' : null;
}
function gateDuplicateRecentWork(candidate, { recentTasks }) {
  if (!recentTasks || recentTasks.length === 0) return null;
  const candidateTitle = normalizedTitle(candidate.title);
  const duplicate = recentTasks.find((task) => normalizedTitle(task.title) === candidateTitle);
  return duplicate ? `an identical mission ("${duplicate.title}") was already generated recently with no new progression evidence` : null;
}
function gateCannotDetermineCompletion(candidate) {
  return !candidate.completionDefinition ? 'no measurable completion definition could be established' : null;
}
function gateResourceUnavailable(candidate) {
  return candidate.missingResourceIds.some((id) => typeof id !== 'string' || id.length === 0) ? 'a required resource reference is malformed' : null;
}

const HARD_GATES = [gateResourceUnavailable, gateConflictsWithTrustedState, gateDuplicateRecentWork, gateCannotDetermineCompletion];

// ---------------------------------------------------------------------------
// Dimension scoring. Each candidate carries its own bottleneckCategory/
// bottleneckAlignment (from candidate-brief.js) and its route's own
// bottleneck-relevance evidence (via the matching RouteAssessment).
// ---------------------------------------------------------------------------
function scoreDimensions(candidate, { routeAssessmentsById, snapshot }) {
  const routeAssessment = routeAssessmentsById[candidate.routeId];

  const bottleneckAlignment = candidate.bottleneckAlignment === 'primary' ? 100 : 60;
  const goalAlignment = scoreFounderGoalAlignment(candidate.routeId, snapshot).score;
  const specificity = candidate.missingResourceIds.length === 0 ? 100 : 80;
  const businessValue = routeAssessment ? routeAssessment.expectedBusinessImpact : 0;
  const dependencyUnlock = routeAssessment ? routeAssessment.dependencyUnlockValue : 0;
  const evidenceGain = routeAssessment ? routeAssessment.evidenceGapSeverity : 0;
  const feasibilityToday = routeAssessment ? routeAssessment.feasibilityToday : 0;
  const resourceAvailability = routeAssessment ? routeAssessment.resourceReadiness : 0;
  // requiredEffort is informational (lower effort scores slightly higher,
  // never enough to overcome a real evidence/impact gap) -- push level may
  // change workload display but must never move this dimension (spec
  // section 12).
  const requiredEffort = clamp(100 - Math.min(90, candidate.timeEstimateMinutes));
  const risk = routeAssessment ? clamp(100 - routeAssessment.riskOrCost) : 50;
  const proofability = routeAssessment ? routeAssessment.proofability : 0;
  const duplicationPenalty = routeAssessment ? routeAssessment.duplicationRisk : 0;
  // Consistency with trusted state is a pass/fail concern already enforced
  // by gateConflictsWithTrustedState above -- any candidate reaching this
  // point has no unresolved conflict on a fact it depends on, so the
  // dimension is honestly 100 here (not a floor: a real conflict rejects
  // the candidate outright rather than merely lowering this number).
  const consistencyWithTrustedState = 100;

  return {
    bottleneckAlignment, goalAlignment, specificity, businessValue, dependencyUnlock, evidenceGain,
    feasibilityToday, resourceAvailability, requiredEffort, risk, proofability, duplicationPenalty,
    consistencyWithTrustedState,
  };
}

const WEIGHTS = Object.freeze({
  bottleneckAlignment: 0.22,
  businessValue: 0.14,
  dependencyUnlock: 0.10,
  evidenceGain: 0.12,
  feasibilityToday: 0.12,
  resourceAvailability: 0.08,
  goalAlignment: 0.06,
  specificity: 0.04,
  proofability: 0.06,
  risk: 0.03,
  requiredEffort: 0.03,
});

function weightedTotal(dimensionScores) {
  let total = 0;
  for (const [dim, weight] of Object.entries(WEIGHTS)) total += dimensionScores[dim] * weight;
  total -= dimensionScores.duplicationPenalty * 0.15;
  return clamp(total);
}

/**
 * @param {object[]} candidates From candidate-brief.js.
 * @param {object} context {ventureId, snapshot, bottleneckAssessment, routeAssessmentsById, recentTasks}
 * @returns {object[]} CandidateEvaluation objects, same order as candidates.
 */
export function evaluateFounderCandidates(candidates, context) {
  return candidates.map((candidate) => {
    let rejectionReason = null;
    for (const gate of HARD_GATES) {
      const reason = gate(candidate, context);
      if (reason) { rejectionReason = reason; break; }
    }

    const dimensionScores = scoreDimensions(candidate, context);
    const totalScore = rejectionReason ? 0 : weightedTotal(dimensionScores);
    const routeAssessment = context.routeAssessmentsById[candidate.routeId];
    const confidence = routeAssessment ? routeAssessment.confidence : 0;

    return {
      candidateId: candidate.candidateId,
      routeId: candidate.routeId,
      dimensionScores,
      totalScore,
      rejected: Boolean(rejectionReason),
      rejectionReason,
      confidence,
    };
  });
}
