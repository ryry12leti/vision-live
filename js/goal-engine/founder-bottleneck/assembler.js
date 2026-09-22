/**
 * Founder Bottleneck Intelligence — top-level assembler.
 *
 * assessFounderBottleneck() is the single entry point: given a trusted
 * Founder Venture Snapshot, Founder Execution Entities bundle, and Founder
 * Execution Context (all already independently validated by their own
 * modules), it cross-checks their identity/version fields fail closed, then
 * produces one versioned FounderBottleneckAssessment. Read-only: never
 * mutates its inputs, never calls a database, never persists anything.
 */

import {
  BOTTLENECK_CATEGORY_ROUTES, FOUNDER_BOTTLENECK_ASSESSMENT_VERSION, FOUNDER_BOTTLENECK_CATEGORIES,
  validateFounderBottleneckAssessment,
} from './contract.js';
import { validateFounderGoalEngineSnapshot, validateFounderExecutionEntities } from '../founder-venture-state/index.js';
import { validateFounderExecutionContext } from '../founder-execution-context/index.js';
import { assessRoutes } from './route-assessment.js';
import { detectBottleneck } from './bottleneck-rules.js';
import { computeBottleneckConfidence } from './confidence.js';
import { declaredStage } from './signals.js';

export class FounderBottleneckInputError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'FounderBottleneckInputError';
    this.code = code;
  }
}

function stageEvidenceConflict(snapshot, primaryBottleneck) {
  if (!primaryBottleneck) return false;
  const stage = declaredStage(snapshot);
  if (!stage) return false;
  // A declared stage that implies validation is already behind the founder
  // (product_building or later) while the primary bottleneck is still
  // insufficient_customer_evidence/weak_demand is a genuine conflict between
  // the declared stage and the trusted evidence (spec section 4).
  const LATER_STAGES = new Set(['product_building', 'launch_preparation', 'customer_acquisition', 'delivery', 'retention', 'operations', 'team_and_hiring', 'scaling', 'strategy_and_capital']);
  return LATER_STAGES.has(stage) && ['insufficient_customer_evidence', 'weak_demand'].includes(primaryBottleneck.category);
}

function collectEvidenceReferences(routeAssessments) {
  const refs = [];
  for (const route of routeAssessments) {
    for (const evidence of route.supportingEvidence) refs.push(`${route.routeId}: ${evidence}`);
  }
  return refs.slice(0, 12);
}

// A venture missing most of its foundational context (offer, target
// customer, completed/unfinished work, current goal) is not yet describable
// at all -- "customer evidence is missing" would technically be true of
// almost every field in that state, but declaring it the bottleneck with
// high confidence would fabricate certainty about a venture the system does
// not yet understand (spec section 9's "unclear venture produces
// clarification", QA case 9). Distinct from insufficient_customer_evidence,
// which requires the venture itself to already be known.
const UNCLEAR_VENTURE_MISSING_CONTEXT_THRESHOLD = 4;

function isUnclearVenture(snapshot) {
  return snapshot.missingCriticalContext.length >= UNCLEAR_VENTURE_MISSING_CONTEXT_THRESHOLD;
}

function explanationFor(primaryBottleneck, secondaryConstraints, ambiguity, survivalSignal, unclearVenture) {
  if (unclearVenture) {
    return 'No single bottleneck could be responsibly identified: the venture itself is not yet sufficiently described (most foundational context is missing).';
  }
  if (!primaryBottleneck) {
    return 'No single bottleneck could be responsibly identified: available evidence is too thin, stale, or too closely contested between constraints.';
  }
  const parts = [`Primary bottleneck: ${primaryBottleneck.label} (${primaryBottleneck.reason})`];
  if (survivalSignal) parts.push('immediate survival/cash risk raised the priority of money-generating routes');
  if (secondaryConstraints.length > 0) parts.push(`secondary constraints: ${secondaryConstraints.map((entry) => entry.label).join(', ')}`);
  if (ambiguity) parts.push('the runner-up constraint is close enough to remain genuinely ambiguous');
  return `${parts.join('. ')}.`;
}

/**
 * @param {object} params
 * @param {object} params.snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @param {object} params.entityBundle Trusted buildFounderExecutionEntities(...) output.
 * @param {object} params.executionContext Trusted buildFounderExecutionContext(...) output.
 * @param {string} params.evaluationTime ISO timestamp for "now".
 * @returns {object} A validated FounderBottleneckAssessment.
 */
/**
 * The bottleneck categories that at least one currently-ELIGIBLE route can
 * actually address. Domain knowledge (which routes serve which category)
 * stays here; the shared decision core never sees a route id.
 */
function addressableCategoriesFrom(executionContext) {
  const eligible = new Set((executionContext?.routeEvaluations || [])
    .filter((route) => route.eligibility === 'eligible')
    .map((route) => route.routeId));
  if (eligible.size === 0) return null;
  return FOUNDER_BOTTLENECK_CATEGORIES.filter(
    (category) => (BOTTLENECK_CATEGORY_ROUTES[category] || []).some((routeId) => eligible.has(routeId)),
  );
}

export function assessFounderBottleneck({
  snapshot, entityBundle, executionContext, evaluationTime, tieBreakChoice = null,
}) {
  const snapshotCheck = validateFounderGoalEngineSnapshot(snapshot);
  if (!snapshotCheck.valid) throw new FounderBottleneckInputError('invalid_founder_snapshot');
  const entityCheck = validateFounderExecutionEntities(entityBundle, snapshot.ventureId, snapshot.ventureRole, snapshot.stateVersion);
  if (!entityCheck.valid) throw new FounderBottleneckInputError('invalid_execution_entities');
  const executionCheck = validateFounderExecutionContext(executionContext, {
    ventureId: snapshot.ventureId, ventureRole: snapshot.ventureRole, stateVersion: snapshot.stateVersion,
  });
  if (!executionCheck.valid) throw new FounderBottleneckInputError('invalid_execution_context');
  if (snapshot.ventureId !== entityBundle.ventureId || snapshot.ventureId !== executionContext.ventureId) {
    throw new FounderBottleneckInputError('invalid_execution_entities');
  }
  if (snapshot.ventureRole !== entityBundle.ventureRole || snapshot.ventureRole !== executionContext.ventureRole) {
    throw new FounderBottleneckInputError('invalid_founder_snapshot');
  }
  if (snapshot.ventureRole !== 'primary') {
    throw new FounderBottleneckInputError('invalid_founder_snapshot');
  }
  if (snapshot.stateVersion !== entityBundle.sourceStateVersion || snapshot.stateVersion !== executionContext.snapshotStateVersion) {
    throw new FounderBottleneckInputError('invalid_execution_context');
  }

  const routeAssessments = assessRoutes({ snapshot, entityBundle, executionContext });
  const unclearVenture = isUnclearVenture(snapshot);
  const detected = unclearVenture
    ? {
      primaryBottleneck: null, secondaryConstraints: [], ambiguity: true, survivalSignal: false, tieBreak: null,
    }
    : detectBottleneck(routeAssessments, snapshot, tieBreakChoice, addressableCategoriesFrom(executionContext));
  const {
    primaryBottleneck, secondaryConstraints, ambiguity, survivalSignal, tieBreak,
  } = detected;
  const confidence = computeBottleneckConfidence({
    primaryBottleneck, ambiguity, snapshot, entityBundle, routeAssessments,
  });

  const assessment = {
    contractVersion: FOUNDER_BOTTLENECK_ASSESSMENT_VERSION,
    ventureId: snapshot.ventureId,
    ventureRole: snapshot.ventureRole,
    sourceStateVersion: snapshot.stateVersion,
    assessedAt: evaluationTime,
    declaredStage: declaredStage(snapshot),
    stageEvidenceConflict: stageEvidenceConflict(snapshot, primaryBottleneck),
    routeAssessments,
    primaryBottleneck,
    secondaryConstraints,
    missingCriticalContext: snapshot.missingCriticalContext,
    ambiguity,
    confidence,
    evidenceReferences: collectEvidenceReferences(routeAssessments),
    explanation: explanationFor(primaryBottleneck, secondaryConstraints, ambiguity, survivalSignal, unclearVenture),
    tieBreak: tieBreak || null,
  };
  if (!validateFounderBottleneckAssessment(assessment).valid) {
    throw new FounderBottleneckInputError('invalid_bottleneck_assessment');
  }
  return assessment;
}
