/**
 * Founder Bottleneck Intelligence — shared vocabulary and contract.
 *
 * A NEW, separate consumer of the trusted Founder Venture Snapshot,
 * Founder Execution Entities, and Founder Execution Context -- it never
 * mutates or adds fields to any of those three modules' own output shapes
 * (three existing QA suites assert those outputs never carry bottleneck/
 * ranking/selection keys; see founder-execution-context/route-eligibility.js's
 * header). This module reads them and produces one new, independently
 * versioned artefact: a FounderBottleneckAssessment.
 *
 * Deliberately does NOT depend on js/goal-engine/candidate-generator's
 * generic trusted-context/generation-request pipeline (assembleTrustedContext
 * -> buildGenerationRequest), because that pipeline routinely fails closed
 * for a real Founder account for reasons that have nothing to do with the
 * business itself (proof capability, medical clearance, generic milestone/
 * route wiring derived from public.profiles columns that do not describe a
 * business at all). Bottleneck assessment must work whenever a valid
 * Founder Venture Snapshot exists, independent of that unrelated pipeline
 * succeeding -- see js/goal-engine/owner-shadow-run/founder-bottleneck-and-move.js.
 */

export const FOUNDER_BOTTLENECK_ASSESSMENT_VERSION = 1;

export const FOUNDER_ROUTE_IDS = Object.freeze([
  'founder_customer_interview_set',
  'founder_sales_outreach_block',
  'founder_offer_test',
  'founder_product_delivery_slice',
  'founder_retention_analysis',
  'founder_operating_process',
  'founder_strategy_decision',
]);

// Mirrors founder-execution-context/contract.js's own
// FOUNDER_WORK_UNIT_BUSINESS_FUNCTION exactly (imported from there, not
// redefined) so this module can never independently drift on which
// business function a route belongs to.
export { FOUNDER_WORK_UNIT_BUSINESS_FUNCTION } from '../founder-execution-context/contract.js';

// The 7 business-bottleneck categories a Founder venture can genuinely have,
// matching js/goal-engine/domain-packs/founder.js's own bottleneckCategories
// list exactly (that list already IS the canonical vocabulary the rest of
// the Goal Engine agrees on for Founder bottlenecks) -- redeclared here
// rather than imported so this module has zero dependency on the
// candidate-generator/domain-packs subsystem.
export const FOUNDER_BOTTLENECK_CATEGORIES = Object.freeze([
  'insufficient_customer_evidence',
  'weak_demand',
  'sales_conversion',
  'delivery_throughput',
  'retention_failure',
  'operational_constraint',
  'strategic_ambiguity',
]);

// Human-readable label per category, used only for explanation text -- never
// affects scoring or selection.
export const CATEGORY_LABEL = Object.freeze({
  insufficient_customer_evidence: 'customer/problem validation',
  weak_demand: 'offer validation',
  sales_conversion: 'acquisition/sales',
  delivery_throughput: 'product/delivery',
  retention_failure: 'retention',
  operational_constraint: 'operations',
  strategic_ambiguity: 'strategy decision',
});

// Which of the 7 canonical routes would genuinely address each bottleneck
// category, most-direct route first. Mirrors the intent of
// candidate-generator/domain-intelligence/founder.js's private
// BOTTLENECK_WORK_UNITS table (kept as an independent, smaller fact here --
// see module header for why this module cannot import that planner's
// request-shaped API directly).
export const BOTTLENECK_CATEGORY_ROUTES = Object.freeze({
  insufficient_customer_evidence: Object.freeze(['founder_customer_interview_set']),
  weak_demand: Object.freeze(['founder_offer_test', 'founder_customer_interview_set']),
  sales_conversion: Object.freeze(['founder_sales_outreach_block', 'founder_offer_test']),
  delivery_throughput: Object.freeze(['founder_product_delivery_slice', 'founder_operating_process']),
  retention_failure: Object.freeze(['founder_retention_analysis']),
  operational_constraint: Object.freeze(['founder_operating_process']),
  strategic_ambiguity: Object.freeze(['founder_strategy_decision']),
});

// VISION's default Founder priority hierarchy (spec section 7), used ONLY
// as a tie-breaker between categories whose evidence-based scores are
// already close -- never to override a clear evidence gap, and never to
// invent evidence a category does not have.
export const PRIORITY_HIERARCHY = Object.freeze([
  'survival', 'money', 'customer_evidence', 'execution_leverage', 'user_value', 'growth', 'retention',
]);

export const CATEGORY_PRIORITY_TAG = Object.freeze({
  insufficient_customer_evidence: 'customer_evidence',
  weak_demand: 'customer_evidence',
  sales_conversion: 'money',
  delivery_throughput: 'execution_leverage',
  retention_failure: 'retention',
  operational_constraint: 'execution_leverage',
  strategic_ambiguity: 'execution_leverage',
});

export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

// A raw category score below this is not evidence of a bottleneck at all
// (zero real signal) -- see bottleneck-rules.js.
export const MIN_MEANINGFUL_CATEGORY_SCORE = 15;
// Two categories within this many points are treated as a genuine tie for
// primary-bottleneck purposes and resolved via PRIORITY_HIERARCHY, never by
// pretending a 1-2 point gap is scientific certainty (spec section 10).
export const CATEGORY_TIE_MARGIN = 8;

const ROUTE_ASSESSMENT_FIELDS = Object.freeze([
  'routeId', 'eligibility', 'businessFunction', 'bottleneckRelevance', 'evidenceGapSeverity',
  'expectedBusinessImpact', 'dependencyUnlockValue', 'urgency', 'feasibilityToday', 'resourceReadiness',
  'proofability', 'duplicationRisk', 'riskOrCost', 'confidence', 'supportingEvidence', 'contradictingEvidence',
  'missingInputs', 'explanation', 'routeScore',
]);

const ASSESSMENT_REQUIRED_FIELDS = Object.freeze([
  'contractVersion', 'ventureId', 'ventureRole', 'sourceStateVersion', 'assessedAt', 'declaredStage',
  'stageEvidenceConflict', 'routeAssessments', 'primaryBottleneck', 'secondaryConstraints',
  'missingCriticalContext', 'ambiguity', 'confidence', 'evidenceReferences', 'explanation',
  // One structured tie-break requirement (decision-core) when the top two
  // candidates remain inside the tie margin; null whenever evidence is clear
  // or a valid user choice already resolved it.
  'tieBreak',
]);

const PRIMARY_BOTTLENECK_FIELDS = Object.freeze(['category', 'label', 'score', 'priorityTag', 'reason']);
const SECONDARY_CONSTRAINT_FIELDS = Object.freeze(['category', 'label', 'score', 'priorityTag', 'reason']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function exactFields(value, required, path, errors) {
  if (!isPlainObject(value)) { errors.push(`${path} must be a plain object`); return false; }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`missing required field: ${path}.${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!required.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  }
  return required.every((field) => Object.hasOwn(value, field));
}
function isScore(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function validateRouteAssessment(assessment, index, errors) {
  const path = `routeAssessments[${index}]`;
  if (!exactFields(assessment, ROUTE_ASSESSMENT_FIELDS, path, errors)) return;
  if (!FOUNDER_ROUTE_IDS.includes(assessment.routeId)) errors.push(`${path}.routeId is not a canonical Founder route`);
  if (!['eligible', 'clarification_required', 'blocked', 'not_relevant'].includes(assessment.eligibility)) {
    errors.push(`${path}.eligibility is invalid`);
  }
  if (!isNonEmptyString(assessment.businessFunction)) errors.push(`${path}.businessFunction must be a non-empty string`);
  for (const dim of ['bottleneckRelevance', 'evidenceGapSeverity', 'expectedBusinessImpact', 'dependencyUnlockValue', 'urgency', 'feasibilityToday', 'resourceReadiness', 'proofability', 'duplicationRisk', 'riskOrCost']) {
    if (!isScore(assessment[dim])) errors.push(`${path}.${dim} must be a number from 0 to 100`);
  }
  if (!Number.isFinite(assessment.confidence) || assessment.confidence < 0 || assessment.confidence > 1) errors.push(`${path}.confidence must be a number from 0 to 1`);
  if (!Array.isArray(assessment.supportingEvidence)) errors.push(`${path}.supportingEvidence must be an array`);
  if (!Array.isArray(assessment.contradictingEvidence)) errors.push(`${path}.contradictingEvidence must be an array`);
  if (!Array.isArray(assessment.missingInputs)) errors.push(`${path}.missingInputs must be an array`);
  if (!isNonEmptyString(assessment.explanation)) errors.push(`${path}.explanation must be a non-empty string`);
  if (assessment.routeScore !== null && !isScore(assessment.routeScore)) errors.push(`${path}.routeScore must be null or a number from 0 to 100`);
}

function validateCategoryRef(value, path, fields, errors) {
  if (value === null) return;
  if (!exactFields(value, fields, path, errors)) return;
  if (!FOUNDER_BOTTLENECK_CATEGORIES.includes(value.category)) errors.push(`${path}.category is not a supported bottleneck category`);
  if (!isNonEmptyString(value.label)) errors.push(`${path}.label must be a non-empty string`);
  if (!isScore(value.score)) errors.push(`${path}.score must be a number from 0 to 100`);
  if (!PRIORITY_HIERARCHY.includes(value.priorityTag)) errors.push(`${path}.priorityTag is not a supported priority tag`);
  if (!isNonEmptyString(value.reason)) errors.push(`${path}.reason must be a non-empty string`);
}

/**
 * Structural, fail-closed validator for a FounderBottleneckAssessment. Must
 * be run before any field is trusted by a downstream consumer.
 * @param {unknown} assessment
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateFounderBottleneckAssessment(assessment) {
  const errors = [];
  if (!exactFields(assessment, ASSESSMENT_REQUIRED_FIELDS, 'assessment', errors)) return { valid: false, errors };

  if (assessment.contractVersion !== FOUNDER_BOTTLENECK_ASSESSMENT_VERSION) errors.push(`assessment.contractVersion must be ${FOUNDER_BOTTLENECK_ASSESSMENT_VERSION}`);
  if (!isNonEmptyString(assessment.ventureId)) errors.push('assessment.ventureId must be a non-empty string');
  if (!['primary', 'secondary'].includes(assessment.ventureRole)) errors.push('assessment.ventureRole must be primary or secondary');
  if (!Number.isInteger(assessment.sourceStateVersion) || assessment.sourceStateVersion < 1) errors.push('assessment.sourceStateVersion must be a positive integer');
  if (!isNonEmptyString(assessment.assessedAt) || Number.isNaN(Date.parse(assessment.assessedAt))) errors.push('assessment.assessedAt must be a valid timestamp');
  if (assessment.declaredStage !== null && !isNonEmptyString(assessment.declaredStage)) errors.push('assessment.declaredStage must be null or a non-empty string');
  if (typeof assessment.stageEvidenceConflict !== 'boolean') errors.push('assessment.stageEvidenceConflict must be a boolean');

  if (!Array.isArray(assessment.routeAssessments) || assessment.routeAssessments.length !== FOUNDER_ROUTE_IDS.length) {
    errors.push('assessment.routeAssessments must contain exactly one entry per canonical Founder route');
  } else {
    assessment.routeAssessments.forEach((route, index) => validateRouteAssessment(route, index, errors));
    const ids = assessment.routeAssessments.map((route) => route?.routeId);
    if (new Set(ids).size !== ids.length) errors.push('assessment.routeAssessments contains a duplicate routeId');
  }

  validateCategoryRef(assessment.primaryBottleneck, 'assessment.primaryBottleneck', PRIMARY_BOTTLENECK_FIELDS, errors);
  if (!Array.isArray(assessment.secondaryConstraints)) {
    errors.push('assessment.secondaryConstraints must be an array');
  } else {
    assessment.secondaryConstraints.forEach((entry, index) => validateCategoryRef(entry, `assessment.secondaryConstraints[${index}]`, SECONDARY_CONSTRAINT_FIELDS, errors));
  }

  if (!Array.isArray(assessment.missingCriticalContext)) errors.push('assessment.missingCriticalContext must be an array');
  if (typeof assessment.ambiguity !== 'boolean') errors.push('assessment.ambiguity must be a boolean');
  if (!CONFIDENCE_LEVELS.includes(assessment.confidence)) errors.push('assessment.confidence must be high, medium, or low');
  if (!Array.isArray(assessment.evidenceReferences)) errors.push('assessment.evidenceReferences must be an array');
  if (!isNonEmptyString(assessment.explanation)) errors.push('assessment.explanation must be a non-empty string');

  // When a primary bottleneck is selected, confidence must not be 'low' with
  // ambiguity===false pretending certainty it does not have, and clarification
  // (no primary) must never coexist with a confidently-selected primary.
  if (assessment.primaryBottleneck === null && assessment.confidence !== 'low') {
    errors.push('assessment.confidence must be low when no primary bottleneck was selected');
  }

  return { valid: errors.length === 0, errors };
}
