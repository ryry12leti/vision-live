/**
 * Founder Execution Context — builder.
 *
 * Deterministic, read-only execution map derived ONLY from a validated V2
 * Founder Venture Snapshot plus a trusted available-resource-id list --
 * never persisted as a second source of truth, never a new table, never a
 * duplicate of Venture State facts. Given identical trusted inputs it
 * always produces identical output.
 *
 * Returns both:
 *   - `wireContext`: the exact `founderExecutionContext` shape
 *     domain-intelligence/founder.js validates (only eligible routes,
 *     projected down to their declared identifier fields + resourceBindings).
 *   - the full rich diagnostic (all 7 routes, reasons, missing
 *     prerequisites, clarification questions) for the owner-shadow
 *     response -- never sent to the planner itself.
 *   - `domainFacts`: the structural (never priority/bottleneck) facts
 *     domain-intelligence/founder.js's domainDetailsFor() independently
 *     requires, derived the same way -- from which business functions
 *     genuinely have real supporting evidence, not from any ranking.
 */

import { FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION, FOUNDER_ROUTE_CONTEXT_FIELDS } from './contract.js';
import {
  FOUNDER_WORK_UNIT_BUSINESS_FUNCTION,
  OUTCOME_TYPE_PRIORITY,
  OUTCOME_TYPE_BY_BUSINESS_FUNCTION,
} from './contract.js';
import { evaluateRouteEligibility, EMPTY_ENTITY_BUNDLE } from './route-eligibility.js';
import { computeExecutionContextClarificationQuestions } from './clarification.js';
import { isUsableEntity } from '../founder-venture-state/index.js';

const CONTEXT_FIELDS = Object.freeze([
  'contractVersion', 'ventureId', 'ventureRole', 'snapshotStateVersion', 'declaredStage', 'stageConflict',
  'wireContext', 'domainFacts', 'routeEvaluations', 'clarificationQuestions', 'clarificationQuestionsDetailed',
]);
const ROUTE_EVALUATION_FIELDS = Object.freeze([
  'routeId', 'eligibility', 'reason', 'supportingFacts', 'missingPrerequisites', 'identifierFields',
  'resourceBindings', 'confidence', 'provenanceReferences',
]);
const DOMAIN_FACT_FIELDS = Object.freeze(['businessStage', 'targetCustomerIds', 'activeBusinessFunctions', 'requiredOutcomeTypes']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value, fields, path, errors) {
  if (!isPlainObject(value)) { errors.push(`${path} must be a plain object`); return false; }
  for (const field of fields) if (!Object.hasOwn(value, field)) errors.push(`missing required field: ${path}.${field}`);
  for (const field of Object.keys(value)) if (!fields.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  return fields.every((field) => Object.hasOwn(value, field));
}

/** Full structural validator for the rich diagnostic execution context. */
export function validateFounderExecutionContext(context, expected = {}) {
  const errors = [];
  if (!exactFields(context, CONTEXT_FIELDS, 'executionContext', errors)) return { valid: false, errors };
  if (context.contractVersion !== FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION) errors.push(`executionContext.contractVersion must be ${FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION}`);
  if (typeof context.ventureId !== 'string' || context.ventureId.length === 0) errors.push('executionContext.ventureId is required');
  if (context.ventureRole !== 'primary') errors.push('executionContext.ventureRole must be primary');
  if (!Number.isInteger(context.snapshotStateVersion) || context.snapshotStateVersion < 1) errors.push('executionContext.snapshotStateVersion must be a positive integer');
  if (context.declaredStage !== null && (typeof context.declaredStage !== 'string' || context.declaredStage.length === 0)) errors.push('executionContext.declaredStage must be null or a non-empty string');
  if (typeof context.stageConflict !== 'boolean') errors.push('executionContext.stageConflict must be a boolean');
  if (expected.ventureId && context.ventureId !== expected.ventureId) errors.push('executionContext.ventureId does not match the expected ventureId');
  if (expected.ventureRole && context.ventureRole !== expected.ventureRole) errors.push('executionContext.ventureRole does not match the expected ventureRole');
  if (expected.stateVersion && context.snapshotStateVersion !== expected.stateVersion) errors.push('executionContext.snapshotStateVersion does not match the expected stateVersion');
  if (!isPlainObject(context.wireContext) || context.wireContext.contractVersion !== FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION || !isPlainObject(context.wireContext.routes)) {
    errors.push('executionContext.wireContext must contain the supported contractVersion and a routes object');
  }
  if (!exactFields(context.domainFacts, DOMAIN_FACT_FIELDS, 'executionContext.domainFacts', errors)
    || typeof context.domainFacts.businessStage !== 'string' || context.domainFacts.businessStage.length === 0
    || !Array.isArray(context.domainFacts.activeBusinessFunctions)
    || !Array.isArray(context.domainFacts.targetCustomerIds) || !Array.isArray(context.domainFacts.requiredOutcomeTypes)) {
    errors.push('executionContext.domainFacts is malformed');
  }
  const routeIds = Object.keys(FOUNDER_ROUTE_CONTEXT_FIELDS);
  if (!Array.isArray(context.routeEvaluations) || context.routeEvaluations.length !== routeIds.length) {
    errors.push('executionContext.routeEvaluations must contain exactly one entry per canonical Founder route');
  } else {
    const seen = new Set();
    context.routeEvaluations.forEach((route, index) => {
      if (!exactFields(route, ROUTE_EVALUATION_FIELDS, `executionContext.routeEvaluations[${index}]`, errors)) return;
      if (!routeIds.includes(route.routeId)) errors.push(`executionContext.routeEvaluations[${index}].routeId is not canonical`);
      if (seen.has(route.routeId)) errors.push('executionContext.routeEvaluations contains a duplicate routeId');
      seen.add(route.routeId);
      if (!['eligible', 'clarification_required', 'blocked', 'not_relevant'].includes(route.eligibility)) errors.push(`executionContext.routeEvaluations[${index}].eligibility is invalid`);
      if (typeof route.reason !== 'string' || route.reason.length === 0) errors.push(`executionContext.routeEvaluations[${index}].reason is required`);
      for (const field of ['supportingFacts', 'missingPrerequisites', 'provenanceReferences']) if (!Array.isArray(route[field])) errors.push(`executionContext.routeEvaluations[${index}].${field} must be an array`);
      if (!isPlainObject(route.identifierFields) || !isPlainObject(route.resourceBindings)) errors.push(`executionContext.routeEvaluations[${index}] identifiers/resources must be objects`);
      if (!Number.isFinite(route.confidence) || route.confidence < 0 || route.confidence > 1) errors.push(`executionContext.routeEvaluations[${index}].confidence must be 0..1`);
    });
    for (const routeId of routeIds) if (!seen.has(routeId)) errors.push(`executionContext.routeEvaluations is missing ${routeId}`);
    if (isPlainObject(context.wireContext?.routes)) {
      const eligibleIds = context.routeEvaluations.filter((route) => route.eligibility === 'eligible').map((route) => route.routeId);
      const wireIds = Object.keys(context.wireContext.routes);
      if (wireIds.length !== eligibleIds.length || wireIds.some((routeId) => !eligibleIds.includes(routeId))) errors.push('executionContext.wireContext.routes must correspond exactly to eligible routeEvaluations');
      wireIds.forEach((routeId) => {
        const routeSpec = FOUNDER_ROUTE_CONTEXT_FIELDS[routeId];
        const required = routeSpec ? [...routeSpec.required.filter((field) => field !== 'resourceBindings'), 'resourceBindings'] : [];
        if (!routeSpec || !exactFields(context.wireContext.routes[routeId], required, `executionContext.wireContext.routes.${routeId}`, errors)) return;
        if (!isPlainObject(context.wireContext.routes[routeId].resourceBindings)) errors.push(`executionContext.wireContext.routes.${routeId}.resourceBindings must be a plain object`);
      });
    }
  }
  if (!Array.isArray(context.clarificationQuestions) || context.clarificationQuestions.length > 3
    || !context.clarificationQuestions.every((question) => typeof question === 'string' && question.length > 0)) errors.push('executionContext.clarificationQuestions must contain at most three non-empty questions');
  /* The two lists are projections of ONE computation, so a mismatch means a
     caller assembled a context by hand and got only half of it -- which is
     precisely how a question would reach the client with no identity again. */
  if (!Array.isArray(context.clarificationQuestionsDetailed)
    || context.clarificationQuestionsDetailed.length !== (context.clarificationQuestions || []).length
    || !context.clarificationQuestionsDetailed.every((entry, index) => isPlainObject(entry)
      && typeof entry.id === 'string' && entry.id.length > 0
      && Array.isArray(entry.factKeys)
      && entry.question === context.clarificationQuestions[index])) {
    errors.push('executionContext.clarificationQuestionsDetailed must carry {id, factKeys, question} for every clarificationQuestions entry, in the same order');
  }
  return { valid: errors.length === 0, errors };
}

function hasConflictOn(snapshot, factKey) {
  return Array.isArray(snapshot.conflicts) && snapshot.conflicts.some((conflict) => conflict.factKey === factKey);
}

function buildWireRoute(routeId, routeEvaluation) {
  const spec = FOUNDER_ROUTE_CONTEXT_FIELDS[routeId];
  const route = {};
  for (const field of spec.required) {
    if (field === 'resourceBindings') continue;
    route[field] = routeEvaluation.identifierFields[field];
  }
  route.resourceBindings = routeEvaluation.resourceBindings;
  return route;
}

/**
 * @param {object} params
 * @param {object} params.snapshot A validated buildFounderGoalEngineSnapshot(...) output.
 * @param {string[]} params.availableResourceIds Trusted resource ids (see resource-bindings.js).
 * @param {object} [params.entityBundle] A validated buildFounderExecutionEntities(...) output. Defaults to an empty bundle -- callers that never supply one (every pre-Founder-Execution-Entities caller) get exactly the prior behaviour: the 4 entity-dependent routes stay clarification_required, targetCustomerIds stays empty.
 * @returns {{
 *   contractVersion: number,
 *   ventureId: string,
 *   ventureRole: string,
 *   snapshotStateVersion: number,
 *   declaredStage: string|null,
 *   stageConflict: boolean,
 *   wireContext: {contractVersion: number, routes: object},
 *   domainFacts: {businessStage: string|null, targetCustomerIds: string[], activeBusinessFunctions: string[], requiredOutcomeTypes: string[]},
 *   routeEvaluations: import('./route-eligibility.js').RouteEligibility[],
 *   clarificationQuestions: string[],
 *   clarificationQuestionsDetailed: {id: string, factKeys: string[], question: string}[],
 * }}
 */
export function buildFounderExecutionContext({ snapshot, availableResourceIds, entityBundle = EMPTY_ENTITY_BUNDLE }) {
  const routeEvaluations = evaluateRouteEligibility(snapshot, availableResourceIds, entityBundle);

  const wireRoutes = {};
  for (const route of routeEvaluations) {
    if (route.eligibility === 'eligible') {
      wireRoutes[route.routeId] = buildWireRoute(route.routeId, route);
    }
  }

  // A business function is genuinely "active" when its route's underlying
  // snapshot facts were derivable -- independent of whether resources
  // happen to be available (resourceBindings gate a route's own
  // eligibility, not the domain's structural classification). This is
  // never a ranking: every function with real supporting evidence is
  // listed, not just the "best" one.
  const activeBusinessFunctions = [...new Set(
    routeEvaluations
      .filter((route) => route.eligibility === 'eligible' || route.eligibility === 'blocked')
      .map((route) => FOUNDER_WORK_UNIT_BUSINESS_FUNCTION[route.routeId]),
  )];
  const requiredOutcomeTypes = [];
  for (const businessFunction of OUTCOME_TYPE_PRIORITY) {
    if (activeBusinessFunctions.includes(businessFunction)) {
      requiredOutcomeTypes.push(OUTCOME_TYPE_BY_BUSINESS_FUNCTION[businessFunction]);
      break;
    }
  }

  /* ONE computation, TWO projections. `clarificationQuestions` stays the
     string[] every existing consumer and wire payload already reads;
     `clarificationQuestionsDetailed` carries the identity those consumers had
     been re-deriving from the text. Deriving the strings from the detailed list
     (rather than computing them twice) is what keeps them impossible to
     disagree. */
  const clarificationQuestionsDetailed = computeExecutionContextClarificationQuestions(routeEvaluations, snapshot);
  const clarificationQuestions = clarificationQuestionsDetailed.map((entry) => entry.question);

  return {
    contractVersion: FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION,
    ventureId: snapshot.ventureId,
    ventureRole: snapshot.ventureRole,
    snapshotStateVersion: snapshot.stateVersion,
    declaredStage: snapshot.stage?.status === 'known' ? snapshot.stage.value : null,
    stageConflict: hasConflictOn(snapshot, 'currentStage'),
    wireContext: { contractVersion: FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION, routes: wireRoutes },
    domainFacts: {
      // trustedContext.domainFacts requires businessStage as a non-empty
      // string (never null/absent) -- 'unspecified' is the same honest
      // fallback sentinel founder-venture-bridge.js already uses for
      // programmeStage when the snapshot's own stage is unknown.
      businessStage: snapshot.stage?.status === 'known' ? snapshot.stage.value : 'unspecified',
      // Only individually-identified, genuinely usable (active,
      // non-disputed, user_confirmed-or-better) customer/prospect entities
      // ever populate this -- never an aggregate count, never a
      // venture-derived placeholder. Deterministically ordered (the
      // entities were already sorted by entityId when the bundle was
      // built) so this list is stable across identical inputs.
      targetCustomerIds: (entityBundle.customerEntities || [])
        .filter(isUsableEntity)
        .map((entity) => entity.entityId),
      activeBusinessFunctions,
      requiredOutcomeTypes,
    },
    routeEvaluations,
    clarificationQuestions,
    clarificationQuestionsDetailed,
  };
}
