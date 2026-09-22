/**
 * Checkpoint 2.6 evaluator contracts.
 *
 * The trusted context owns facts and evidence. The proposal describes work but
 * cannot supply ratings, rule decisions, safety conclusions, or confidence.
 */

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const PROOF_MODES = new Set(['photo', 'voice', 'live', 'hybrid']);
const RECOVERY_STATES = new Set(['ready', 'limited', 'recovery_required']);
const PREREQUISITE_STATES = new Set(['satisfied', 'missing']);
const VERIFICATION_STATES = new Set(['verified', 'unverified', 'rejected']);
const EVIDENCE_RELEVANCE = new Set([
  'goal',
  'milestone',
  'route',
  'bottleneck',
  'programme',
  'capability',
  'progress',
  'constraints',
  'availability',
  'recovery',
  'preference',
  'proof_capability',
  'domain',
]);
const PROGRESSION_ACTIONS = new Set([
  'none',
  'maintain',
  'increase_load',
  'increase_reps',
  'increase_difficulty',
  'increase_duration',
]);
const STRUCTURE_KINDS = new Set(['hard_medium', 'fixed']);
const FINANCIAL_RISK_LEVELS = new Set(['low', 'moderate', 'high', 'extreme']);

export const MISSION_EVALUATION_CONTRACT_VERSION = 5;
export const EVIDENCE_METADATA_CONTRACT_VERSION = 2;
export const MISSION_CANDIDATE_CONTRACT_VERSION = MISSION_EVALUATION_CONTRACT_VERSION;
export const PROFESSIONAL_EXECUTION_UNIT_CONTRACT_VERSION = 1;
// Versioned, discriminated trusted-context extensions read from
// request.programme.requiredAttributes.{founder,learning}ExecutionContext
// (see domain-intelligence/shared.js validateExecutionContextRoute) — the
// authoritative source for route-specific facts (an offer id, a retention
// cohort id, a diagnostic task id, ...) that the canonical domainFacts
// schema has no field for.
export const FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION = 1;
export const LEARNING_EXECUTION_CONTEXT_CONTRACT_VERSION = 1;
export const MONEY_EXECUTION_CONTEXT_CONTRACT_VERSION = 1;
export const CREATOR_EXECUTION_CONTEXT_CONTRACT_VERSION = 1;
const EXECUTION_UNIT_TYPES = new Set(['multi_item_session', 'single_item_session']);

const TRUSTED_CONTEXT_FIELDS = Object.freeze([
  'contextId',
  'currentSequence',
  'evaluationTime',
  'goal',
  'activeMilestone',
  'routeNode',
  'activeBottleneck',
  'prerequisites',
  'programme',
  'capability',
  'progress',
  'proofCapability',
  'constraints',
  'availability',
  'recovery',
  'verifiedPreferences',
  'domainFacts',
  'evidenceRegistry',
]);

const PROPOSAL_FIELDS = Object.freeze([
  'candidateId',
  'title',
  'domainId',
  'workUnitTypeId',
  'method',
  'intendedOutcome',
  'missionSteps',
  'targetMilestoneId',
  'targetRouteNodeId',
  'targetBottleneckCategory',
  'missionStructure',
  'estimatedMinutes',
  'requiredResourceIds',
  'proofPlan',
  'evidenceRefs',
  'domainDetails',
  'professionalExecutionUnit',
]);

// These legacy proposal booleans remain contract-compatible but descriptive
// only: intendedOutcome.measurable, Money privacySafe, Creator rightsCleared,
// and Athlete sportSpecific are never used as evaluator conclusions.
const DOMAIN_DETAIL_FIELDS = Object.freeze({
  fitness: Object.freeze([
    'programmeId',
    'trainingPhase',
    'targetMuscleIds',
    'movementIds',
    'energySystemIds',
    'workingSets',
    'effortTarget',
    'progressionAction',
    'equipmentIds',
  ]),
  // Founder domainDetails is discriminated per work unit instead (see
  // FOUNDER_DOMAIN_DETAIL_FIELDS_BY_WORK_UNIT below): retention/operating-
  // process/strategy work genuinely has no customer, so a single fixed
  // Founder shape requiring targetCustomerId for every route would force
  // internal work to either fabricate a customer or be unplannable.
  learning: Object.freeze([
    'assessmentId',
    'rubricCriterionIds',
    'knowledgeGapIds',
    'requiredOutputId',
    'learningStage',
    'learningMethod',
    'completionEvidenceId',
  ]),
  money: Object.freeze([
    'financialCategory',
    'amount',
    'riskLevel',
    'actionType',
    'measurableOutcomeId',
    'privacySafe',
  ]),
  creator: Object.freeze([
    'medium',
    'platform',
    'projectId',
    'productionStage',
    'audienceId',
    'distributionAction',
    'publishableOutputId',
    'rightsCleared',
  ]),
  athlete: Object.freeze([
    'sport',
    'positionOrEvent',
    'trainingPhase',
    'coachProgrammeId',
    'performanceFocus',
    'competitionSequence',
    'sportSpecific',
  ]),
});

// Founder's discriminated domainDetails shape, keyed by workUnitTypeId
// instead of a single fixed field list: `outcomeTypeId`/`routeOutputId` are
// domain-neutral renames of the old customerOutcomeType/evidenceOutputId
// (every route has a bounded outcome and evidence output; only customer-
// facing routes have a customer), and each work unit adds only the trusted
// reference fields its own execution genuinely uses.
export const FOUNDER_DOMAIN_DETAIL_FIELDS_BY_WORK_UNIT = Object.freeze({
  founder_customer_interview_set: Object.freeze([
    'businessStage', 'businessFunction', 'targetCustomerId', 'outcomeTypeId', 'routeOutputId',
  ]),
  founder_sales_outreach_block: Object.freeze([
    'businessStage', 'businessFunction', 'targetCustomerId', 'outcomeTypeId', 'routeOutputId',
  ]),
  founder_offer_test: Object.freeze([
    'businessStage', 'businessFunction', 'offerId', 'targetSegmentId', 'outcomeTypeId', 'routeOutputId',
  ]),
  founder_product_delivery_slice: Object.freeze([
    'businessStage', 'businessFunction', 'productSliceId', 'acceptanceCriteriaIds', 'outcomeTypeId', 'routeOutputId',
  ]),
  founder_retention_analysis: Object.freeze([
    'businessStage', 'businessFunction', 'cohortId', 'dataSourceId', 'outcomeTypeId', 'routeOutputId',
  ]),
  founder_operating_process: Object.freeze([
    'businessStage', 'businessFunction', 'processId', 'outcomeTypeId', 'routeOutputId',
  ]),
  founder_strategy_decision: Object.freeze([
    'businessStage', 'businessFunction', 'decisionId', 'optionIds', 'outcomeTypeId', 'routeOutputId',
  ]),
});

// Route field contracts for founderExecutionContext.routes[workUnitTypeId]
// (see domain-intelligence/shared.js's validateExecutionContextRoute).
// `routeOutputField` names which of these fields is this route's trusted
// evidence/decision output. `resourceBindings` is required on every route:
// the exact trusted resource ids each of this route's items genuinely need.
// Moved here (from domain-intelligence/founder.js, its sole prior caller) so
// any other module building a real founderExecutionContext (e.g.
// founder-execution-context/) imports the exact same frozen contract the
// planner itself validates against, instead of risking a second,
// independently-drifting copy.
export const FOUNDER_ROUTE_CONTEXT_FIELDS = Object.freeze({
  founder_customer_interview_set: Object.freeze({
    required: ['resultOutputId', 'resourceBindings'],
    optional: ['interviewHypothesisId'],
    routeOutputField: 'resultOutputId',
    resourceBindingKeys: Object.freeze({ required: ['contactAccess', 'questionSet', 'channel', 'resultWorkspace'], optional: ['notesWorkspace'] }),
  }),
  founder_sales_outreach_block: Object.freeze({
    required: ['resultOutputId', 'resourceBindings'],
    optional: ['offerId'],
    routeOutputField: 'resultOutputId',
    resourceBindingKeys: Object.freeze({ required: ['crmAccess', 'channel', 'resultWorkspace'], optional: ['offerRecord'] }),
  }),
  founder_offer_test: Object.freeze({
    required: ['offerId', 'targetSegmentId', 'resultOutputId', 'resourceBindings'],
    optional: ['targetCustomerId'],
    routeOutputField: 'resultOutputId',
    resourceBindingKeys: Object.freeze({ required: ['offerRecord', 'segmentRecord', 'presentationChannel', 'responseCaptureRecord', 'resultWorkspace'], optional: ['testAudienceAccess'] }),
  }),
  founder_product_delivery_slice: Object.freeze({
    required: ['productSliceId', 'acceptanceCriteriaIds', 'deliveryOutputId', 'resourceBindings'],
    optional: ['targetCustomerId'],
    routeOutputField: 'deliveryOutputId',
    resourceBindingKeys: Object.freeze({ required: ['productSpec', 'acceptanceCriteria', 'repositoryAccess', 'buildEnvironment', 'testEnvironment', 'deliveryAccess', 'resultWorkspace'], optional: ['customerDeliveryChannel'] }),
  }),
  founder_retention_analysis: Object.freeze({
    required: ['cohortId', 'dataSourceId', 'decisionOutputId', 'resourceBindings'],
    optional: ['interventionOptionIds'],
    routeOutputField: 'decisionOutputId',
    resourceBindingKeys: Object.freeze({ required: ['cohortData', 'analyticsAccess', 'metricDefinitions', 'decisionWorkspace'], optional: ['interventionEvidence'] }),
  }),
  founder_operating_process: Object.freeze({
    required: ['processId', 'verificationOutputId', 'resourceBindings'],
    optional: ['failurePointId'],
    routeOutputField: 'verificationOutputId',
    resourceBindingKeys: Object.freeze({ required: ['processDocumentation', 'toolAccess', 'operationalRecord', 'verificationEnvironment', 'outcomeWorkspace'] }),
  }),
  founder_strategy_decision: Object.freeze({
    required: ['decisionId', 'optionIds', 'decisionOutputId', 'resourceBindings'],
    optional: ['criteriaIds'],
    routeOutputField: 'decisionOutputId',
    resourceBindingKeys: Object.freeze({ required: ['decisionEvidence', 'optionRecords', 'decisionCriteria', 'decisionWorkspace'] }),
  }),
});

/**
 * Checkpoint 2 completion: the ProfessionalExecutionUnit contract. Every
 * "normal session" work unit must represent the complete execution the
 * user will actually perform — every exercise in a workout, every action
 * in an outreach batch, every question in an assessment block — as ordered
 * structured items, never a single vague action standing in for the whole
 * unit and never a free-text blob. Per-item domain content lives in
 * `domainItemDetails`, the item-level analogue of `domainDetails` above:
 * the same exact-fields-per-domain, primitives-only shape, one level
 * deeper.
 */
export const EXECUTION_ITEM_DOMAIN_DETAIL_FIELDS = Object.freeze({
  fitness: Object.freeze([
    'movementId',
    'targetMuscleIds',
    'sets',
    'repRangeLow',
    'repRangeHigh',
    'loadOrIntensity',
    'effortTarget',
    'restSeconds',
    'substitutionApproved',
  ]),
  // referenceId/referenceType generalize across all seven canonical Founder
  // work-unit families (a target customer for interview/outreach/offer-test
  // items, an offer/product-slice/retention-cohort/process/decision id for
  // the checklist-style ones) — never a fabricated evidence id; the unit-
  // level proofRequirement already carries what evidence the whole unit
  // needs.
  founder: Object.freeze([
    'referenceId',
    'referenceType',
    'supportingReferenceId',
  ]),
  // referenceId is a genuine trusted task/prompt id (learningExecutionContext)
  // for diagnostic/retrieval/application/mock routes, or the rubric
  // criterion itself for drafting/revision/submission-check routes — never a
  // rubric criterion standing in for an invented question. supportingReferenceId
  // preserves the underlying knowledgeGapId/rubricCriterionId a context-
  // sourced task was tied to (or the trusted assessmentId, for routes with
  // no separate task). requiredOutputId ties every item to the one trusted
  // required submission output; stageType names which of the seven
  // canonical Learning work-unit families this item belongs to.
  learning: Object.freeze([
    'referenceId',
    'referenceType',
    'supportingReferenceId',
    'requiredOutputId',
    'stageType',
  ]),
  money: Object.freeze([
    'financialCategory',
    'amount',
    'riskLevel',
  ]),
  creator: Object.freeze([
    'platform',
    'projectId',
    'requiredPublishableOutputId',
    'rightsCleared',
  ]),
  athlete: Object.freeze([
    'drillId',
    'sets',
    'repsOrDurationSeconds',
    'intensity',
    'recoverySeconds',
    'competitionRelevant',
  ]),
});

// The universal execution-item fields every item carries regardless of
// domain — itemId/order/label/actionType/effortUnits/domainItemDetails plus
// requiredResourceIds, the single authoritative resource field for every
// domain (see unionOfItemRequiredResources below). Equipment/venue/access
// requirements live here, never duplicated inside domainItemDetails (which
// is why fitness no longer carries requiredEquipmentIds and athlete no
// longer carries requiredResourceIds there).
const EXECUTION_ITEM_FIELDS = Object.freeze([
  'itemId', 'order', 'label', 'actionType', 'effortUnits', 'requiredResourceIds', 'domainItemDetails',
]);

/**
 * The deterministic, deduplicated union of every execution item's
 * requiredResourceIds — the single source of truth for what a candidate's
 * top-level requiredResourceIds must equal, across all six domains. Never
 * read top-level resource requirements from anywhere else once items exist;
 * deriving it from the items is what keeps the two from silently diverging.
 * Returns null when any item's requiredResourceIds is not a genuinely valid
 * array of unique, non-empty strings — callers must treat null as "cannot
 * be trusted", never coerce or repair it.
 *
 * @param {object[]} items
 * @returns {string[]|null}
 */
export function unionOfItemRequiredResources(items) {
  const union = new Set();
  for (const item of items) {
    const ids = item?.requiredResourceIds;
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id.trim().length === 0)) return null;
    for (const id of ids) union.add(id);
  }
  return [...union].sort();
}

const TRUSTED_DOMAIN_FACT_FIELDS = Object.freeze({
  fitness: Object.freeze([
    'targetMuscleIds',
    'movementIds',
    'energySystemIds',
    'minWorkingSets',
    'maxWorkingSets',
    'effortTarget',
    'requiredProgressionActions',
    'equipmentIds',
  ]),
  founder: Object.freeze([
    'businessStage',
    'targetCustomerIds',
    'activeBusinessFunctions',
    'requiredOutcomeTypes',
  ]),
  learning: Object.freeze([
    'assessmentId',
    'rubricCriterionIds',
    'knowledgeGapIds',
    'requiredOutputIds',
    'learningStage',
    'allowedLearningMethods',
  ]),
  money: Object.freeze([
    'financialCategory',
    'affordableAmount',
    'maximumRiskLevel',
    'legalActionTypes',
    'requiredOutcomeIds',
    'privacySafeProofRequired',
    'redactionConfirmed',
  ]),
  creator: Object.freeze([
    'medium',
    'platform',
    'projectId',
    'productionStage',
    'audienceIds',
    'allowedDistributionActions',
    'requiredPublishableOutputs',
    'rightsCleared',
  ]),
  athlete: Object.freeze([
    'sport',
    'positionOrEvent',
    'trainingPhase',
    'coachProgrammeId',
    'performanceFocuses',
    'competitionSequence',
    'allowedSessionTypes',
  ]),
});

export class MissionEvaluationValidationError extends Error {
  constructor(errors) {
    super(`Invalid mission evaluation input: ${errors.join('; ')}`);
    this.name = 'MissionEvaluationValidationError';
    this.errors = Object.freeze([...errors]);
  }
}

export const MissionCandidateValidationError = MissionEvaluationValidationError;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactFields(value, required, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be a plain object`);
    return false;
  }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`missing required field: ${path}.${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!required.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  }
  return true;
}

function validateIdentifier(value, path, errors) {
  if (!isNonEmptyString(value) || !IDENTIFIER_PATTERN.test(value)) {
    errors.push(`${path} must be a snake_case identifier`);
  }
}

function validateString(value, path, errors) {
  if (!isNonEmptyString(value)) errors.push(`${path} must be a non-empty string`);
}

function validateBoolean(value, path, errors) {
  if (typeof value !== 'boolean') errors.push(`${path} must be a boolean`);
}

function validateNumber(value, path, errors, { integer = false, minimum = 0 } = {}) {
  if (!Number.isFinite(value) || value < minimum || (integer && !Number.isInteger(value))) {
    errors.push(`${path} must be a ${integer ? 'whole ' : ''}number >= ${minimum}`);
  }
}

function validateStringArray(value, path, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.some((item) => !isNonEmptyString(item))) errors.push(`${path} must contain only non-empty strings`);
  if (new Set(value).size !== value.length) errors.push(`${path} must not contain duplicates`);
}

function validateTimestamp(value, path, errors, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!isNonEmptyString(value) || !Number.isFinite(Date.parse(value))) {
    errors.push(`${path} must be ${nullable ? 'null or ' : ''}a valid timestamp`);
  }
}

function validateEvidenceMetadata(value, path, errors) {
  if (!exactFields(value, ['version', 'sources'], path, errors)) return;
  if (value.version !== EVIDENCE_METADATA_CONTRACT_VERSION) {
    errors.push(`${path}.version must be ${EVIDENCE_METADATA_CONTRACT_VERSION}`);
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    errors.push(`${path}.sources must be a non-empty array`);
    return;
  }
  const independentKeys = [];
  for (const [index, source] of value.sources.entries()) {
    const sourcePath = `${path}.sources[${index}]`;
    if (!exactFields(source, [
      'eventId',
      'eventVersion',
      'sourceRecordId',
      'sourceType',
      'occurredAt',
      'ingestedAt',
      'provenanceAuthority',
      'provenanceReference',
      'independentSourceKey',
      'supportedFactPaths',
    ], sourcePath, errors)) continue;
    for (const field of [
      'eventId',
      'sourceRecordId',
      'sourceType',
      'provenanceAuthority',
      'provenanceReference',
      'independentSourceKey',
    ]) validateString(source[field], `${sourcePath}.${field}`, errors);
    validateNumber(source.eventVersion, `${sourcePath}.eventVersion`, errors, { integer: true, minimum: 1 });
    validateTimestamp(source.occurredAt, `${sourcePath}.occurredAt`, errors, { nullable: true });
    validateTimestamp(source.ingestedAt, `${sourcePath}.ingestedAt`, errors, { nullable: true });
    validateStringArray(source.supportedFactPaths, `${sourcePath}.supportedFactPaths`, errors);
    if (Array.isArray(source.supportedFactPaths)
      && source.supportedFactPaths.some((factPath) => !factPath.startsWith('capturedFacts.'))) {
      errors.push(`${sourcePath}.supportedFactPaths must contain capturedFacts paths`);
    }
    if (source.occurredAt === null && source.ingestedAt === null) {
      errors.push(`${sourcePath} requires occurredAt or ingestedAt`);
    }
    independentKeys.push(source.independentSourceKey);
  }
  if (new Set(independentKeys).size !== independentKeys.length) {
    errors.push(`${path}.sources independentSourceKeys must be unique`);
  }
}

function validateEvidenceReferences(value, path, errors) {
  validateStringArray(value, path, errors);
}

function validateEvidenceBackedObject(value, fields, path, errors) {
  if (!exactFields(value, fields, path, errors)) return;
  validateEvidenceReferences(value.evidenceIds, `${path}.evidenceIds`, errors);
}

function validateVersionShape(value, path, errors, { fixed = false } = {}) {
  const fields = [
    'methodId',
    'outcomeType',
    'milestoneId',
    'professionalPrinciple',
    'effortUnits',
    ...(fixed ? ['conditionId', 'externalRequirement'] : []),
  ];
  if (!exactFields(value, fields, path, errors)) return;
  validateIdentifier(value.methodId, `${path}.methodId`, errors);
  validateIdentifier(value.outcomeType, `${path}.outcomeType`, errors);
  validateString(value.milestoneId, `${path}.milestoneId`, errors);
  validateString(value.professionalPrinciple, `${path}.professionalPrinciple`, errors);
  validateNumber(value.effortUnits, `${path}.effortUnits`, errors, { minimum: 1 });
  if (fixed) {
    validateIdentifier(value.conditionId, `${path}.conditionId`, errors);
    validateString(value.externalRequirement, `${path}.externalRequirement`, errors);
  }
}

function validateDomainFacts(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('trustedContext.domainFacts must be a plain object');
    return;
  }
  validateIdentifier(value.domainId, 'trustedContext.domainFacts.domainId', errors);
  const expectedFacts = TRUSTED_DOMAIN_FACT_FIELDS[value.domainId];
  if (!expectedFacts) {
    if (!isPlainObject(value.facts)) errors.push('trustedContext.domainFacts.facts must be a plain object');
  } else if (exactFields(value.facts, expectedFacts, 'trustedContext.domainFacts.facts', errors)) {
    for (const [key, fact] of Object.entries(value.facts)) {
      const path = `trustedContext.domainFacts.facts.${key}`;
      if (Array.isArray(fact)) validateStringArray(fact, path, errors);
      else if (typeof fact === 'boolean') validateBoolean(fact, path, errors);
      else if (typeof fact === 'number') validateNumber(fact, path, errors);
      else validateString(fact, path, errors);
    }
    if (value.domainId === 'fitness') {
      if (value.facts.minWorkingSets > value.facts.maxWorkingSets) {
        errors.push('trustedContext.domainFacts.facts.minWorkingSets cannot exceed maxWorkingSets');
      }
      if (Array.isArray(value.facts.requiredProgressionActions)
        && value.facts.requiredProgressionActions.some((action) => !PROGRESSION_ACTIONS.has(action))) {
        errors.push('trustedContext.domainFacts.facts.requiredProgressionActions contains an invalid action');
      }
    }
    if (value.domainId === 'money' && !FINANCIAL_RISK_LEVELS.has(value.facts.maximumRiskLevel)) {
      errors.push('trustedContext.domainFacts.facts.maximumRiskLevel is invalid');
    }
  }
  validateEvidenceReferences(value.evidenceIds, 'trustedContext.domainFacts.evidenceIds', errors);
  for (const field of Object.keys(value)) {
    if (!['domainId', 'facts', 'evidenceIds'].includes(field)) {
      errors.push(`unknown trustedContext.domainFacts field: ${field}`);
    }
  }
}

/**
 * @param {unknown} trustedContext
 * @returns {{valid:boolean,errors:string[]}}
 */
export function validateTrustedEvaluationContext(trustedContext) {
  const errors = [];
  if (!exactFields(trustedContext, TRUSTED_CONTEXT_FIELDS, 'trustedContext', errors)) {
    return { valid: false, errors };
  }

  validateIdentifier(trustedContext.contextId, 'trustedContext.contextId', errors);
  validateNumber(trustedContext.currentSequence, 'trustedContext.currentSequence', errors, { integer: true });
  validateTimestamp(trustedContext.evaluationTime, 'trustedContext.evaluationTime', errors);

  validateEvidenceBackedObject(
    trustedContext.goal,
    ['description', 'category', 'evidenceIds'],
    'trustedContext.goal',
    errors,
  );
  validateString(trustedContext.goal?.description, 'trustedContext.goal.description', errors);
  validateIdentifier(trustedContext.goal?.category, 'trustedContext.goal.category', errors);

  validateEvidenceBackedObject(
    trustedContext.activeMilestone,
    ['id', 'description', 'category', 'evidenceIds'],
    'trustedContext.activeMilestone',
    errors,
  );
  validateString(trustedContext.activeMilestone?.id, 'trustedContext.activeMilestone.id', errors);
  validateString(trustedContext.activeMilestone?.description, 'trustedContext.activeMilestone.description', errors);
  validateIdentifier(trustedContext.activeMilestone?.category, 'trustedContext.activeMilestone.category', errors);

  validateEvidenceBackedObject(
    trustedContext.routeNode,
    ['id', 'allowedWorkUnitTypeIds', 'evidenceIds'],
    'trustedContext.routeNode',
    errors,
  );
  validateString(trustedContext.routeNode?.id, 'trustedContext.routeNode.id', errors);
  validateStringArray(
    trustedContext.routeNode?.allowedWorkUnitTypeIds,
    'trustedContext.routeNode.allowedWorkUnitTypeIds',
    errors,
  );

  validateEvidenceBackedObject(
    trustedContext.activeBottleneck,
    ['description', 'category', 'evidenceIds'],
    'trustedContext.activeBottleneck',
    errors,
  );
  validateString(trustedContext.activeBottleneck?.description, 'trustedContext.activeBottleneck.description', errors);
  validateIdentifier(trustedContext.activeBottleneck?.category, 'trustedContext.activeBottleneck.category', errors);

  validateEvidenceBackedObject(
    trustedContext.prerequisites,
    ['status', 'missingIds', 'evidenceIds'],
    'trustedContext.prerequisites',
    errors,
  );
  if (!PREREQUISITE_STATES.has(trustedContext.prerequisites?.status)) {
    errors.push('trustedContext.prerequisites.status must be satisfied or missing');
  }
  validateStringArray(trustedContext.prerequisites?.missingIds, 'trustedContext.prerequisites.missingIds', errors);
  if (trustedContext.prerequisites?.status === 'satisfied' && trustedContext.prerequisites.missingIds?.length) {
    errors.push('satisfied prerequisites cannot contain missingIds');
  }
  if (trustedContext.prerequisites?.status === 'missing' && !trustedContext.prerequisites.missingIds?.length) {
    errors.push('missing prerequisites must identify at least one missing id');
  }

  validateEvidenceBackedObject(
    trustedContext.programme,
    ['id', 'stage', 'external', 'requiredAttributes', 'evidenceIds'],
    'trustedContext.programme',
    errors,
  );
  validateString(trustedContext.programme?.id, 'trustedContext.programme.id', errors);
  validateString(trustedContext.programme?.stage, 'trustedContext.programme.stage', errors);
  validateBoolean(trustedContext.programme?.external, 'trustedContext.programme.external', errors);
  if (!isPlainObject(trustedContext.programme?.requiredAttributes)) {
    errors.push('trustedContext.programme.requiredAttributes must be a plain object');
  }

  validateEvidenceBackedObject(
    trustedContext.capability,
    ['maxEffortUnits', 'supportedMethodIds', 'evidenceIds'],
    'trustedContext.capability',
    errors,
  );
  validateNumber(trustedContext.capability?.maxEffortUnits, 'trustedContext.capability.maxEffortUnits', errors);
  validateStringArray(trustedContext.capability?.supportedMethodIds, 'trustedContext.capability.supportedMethodIds', errors);

  validateEvidenceBackedObject(
    trustedContext.progress,
    ['signalIds', 'evidenceIds'],
    'trustedContext.progress',
    errors,
  );
  validateStringArray(trustedContext.progress?.signalIds, 'trustedContext.progress.signalIds', errors);

  validateEvidenceBackedObject(
    trustedContext.proofCapability,
    [
      'supportedEvidenceTypeIds',
      'supportedProofModes',
      'supportedClaimCategories',
      'supportedOutputCategories',
      'availableCaptureCapabilities',
      'privacyRequirements',
      'redactionSupported',
      'rightsClearanceRequired',
      'permissionsConfirmed',
      'compatibleDomainIds',
      'technicalLimitations',
      'evidenceIds',
    ],
    'trustedContext.proofCapability',
    errors,
  );
  for (const field of [
    'supportedEvidenceTypeIds',
    'supportedProofModes',
    'supportedClaimCategories',
    'supportedOutputCategories',
    'availableCaptureCapabilities',
    'privacyRequirements',
    'compatibleDomainIds',
    'technicalLimitations',
  ]) validateStringArray(
    trustedContext.proofCapability?.[field],
    `trustedContext.proofCapability.${field}`,
    errors,
  );
  for (const field of ['redactionSupported', 'rightsClearanceRequired', 'permissionsConfirmed']) {
    validateBoolean(
      trustedContext.proofCapability?.[field],
      `trustedContext.proofCapability.${field}`,
      errors,
    );
  }

  validateEvidenceBackedObject(
    trustedContext.constraints,
    [
      'forbiddenMethodIds',
      'forbiddenActionTypes',
      'illegalActionTypes',
      'medicalClearanceRequired',
      'medicalClearancePresent',
      'evidenceIds',
    ],
    'trustedContext.constraints',
    errors,
  );
  for (const field of ['forbiddenMethodIds', 'forbiddenActionTypes', 'illegalActionTypes']) {
    validateStringArray(trustedContext.constraints?.[field], `trustedContext.constraints.${field}`, errors);
  }
  validateBoolean(
    trustedContext.constraints?.medicalClearanceRequired,
    'trustedContext.constraints.medicalClearanceRequired',
    errors,
  );
  validateBoolean(
    trustedContext.constraints?.medicalClearancePresent,
    'trustedContext.constraints.medicalClearancePresent',
    errors,
  );

  validateEvidenceBackedObject(
    trustedContext.availability,
    ['availableMinutes', 'resourceIds', 'evidenceIds'],
    'trustedContext.availability',
    errors,
  );
  validateNumber(trustedContext.availability?.availableMinutes, 'trustedContext.availability.availableMinutes', errors);
  validateStringArray(trustedContext.availability?.resourceIds, 'trustedContext.availability.resourceIds', errors);

  validateEvidenceBackedObject(
    trustedContext.recovery,
    ['status', 'maxEffortUnits', 'evidenceIds'],
    'trustedContext.recovery',
    errors,
  );
  if (!RECOVERY_STATES.has(trustedContext.recovery?.status)) {
    errors.push('trustedContext.recovery.status is invalid');
  }
  validateNumber(trustedContext.recovery?.maxEffortUnits, 'trustedContext.recovery.maxEffortUnits', errors);

  validateEvidenceBackedObject(
    trustedContext.verifiedPreferences,
    ['preferredWorkUnitTypeIds', 'preferredMethodIds', 'evidenceIds'],
    'trustedContext.verifiedPreferences',
    errors,
  );
  validateStringArray(
    trustedContext.verifiedPreferences?.preferredWorkUnitTypeIds,
    'trustedContext.verifiedPreferences.preferredWorkUnitTypeIds',
    errors,
  );
  validateStringArray(
    trustedContext.verifiedPreferences?.preferredMethodIds,
    'trustedContext.verifiedPreferences.preferredMethodIds',
    errors,
  );

  validateDomainFacts(trustedContext.domainFacts, errors);

  if (!Array.isArray(trustedContext.evidenceRegistry)) {
    errors.push('trustedContext.evidenceRegistry must be an array');
  } else {
    const ids = [];
    for (const [index, record] of trustedContext.evidenceRegistry.entries()) {
      const path = `trustedContext.evidenceRegistry[${index}]`;
      if (!exactFields(
        record,
        [
          'id',
          'sourceType',
          'verificationStatus',
          'capturedFacts',
          'sequence',
          'relevanceCategory',
          'metadata',
        ],
        path,
        errors,
      )) continue;
      validateString(record.id, `${path}.id`, errors);
      validateIdentifier(record.sourceType, `${path}.sourceType`, errors);
      if (!VERIFICATION_STATES.has(record.verificationStatus)) {
        errors.push(`${path}.verificationStatus is invalid`);
      }
      if (!isPlainObject(record.capturedFacts) || Object.keys(record.capturedFacts).length === 0) {
        errors.push(`${path}.capturedFacts must be a non-empty plain object`);
      }
      validateNumber(record.sequence, `${path}.sequence`, errors, { integer: true });
      if (Number.isInteger(record.sequence) && record.sequence > trustedContext.currentSequence) {
        errors.push(`${path}.sequence cannot be later than trustedContext.currentSequence`);
      }
      if (!EVIDENCE_RELEVANCE.has(record.relevanceCategory)) {
        errors.push(`${path}.relevanceCategory is invalid`);
      }
      validateEvidenceMetadata(record.metadata, `${path}.metadata`, errors);
      ids.push(record.id);
    }
    if (new Set(ids).size !== ids.length) errors.push('trustedContext.evidenceRegistry ids must be unique');
  }

  return { valid: errors.length === 0, errors };
}

function validateMissionStructure(value, errors) {
  if (!exactFields(value, ['kind', 'hard', 'medium', 'fixed'], 'candidateProposal.missionStructure', errors)) return;
  if (!STRUCTURE_KINDS.has(value.kind)) {
    errors.push('candidateProposal.missionStructure.kind must be hard_medium or fixed');
    return;
  }
  if (value.kind === 'hard_medium') {
    validateVersionShape(value.hard, 'candidateProposal.missionStructure.hard', errors);
    validateVersionShape(value.medium, 'candidateProposal.missionStructure.medium', errors);
    if (value.fixed !== null) errors.push('hard_medium structure cannot include fixed');
  } else {
    if (value.hard !== null || value.medium !== null) errors.push('fixed structure cannot include hard or medium versions');
    validateVersionShape(value.fixed, 'candidateProposal.missionStructure.fixed', errors, { fixed: true });
  }
}

function validateDomainDetails(proposal, errors) {
  const expected = proposal.domainId === 'founder'
    ? FOUNDER_DOMAIN_DETAIL_FIELDS_BY_WORK_UNIT[proposal.workUnitTypeId]
    : DOMAIN_DETAIL_FIELDS[proposal.domainId];
  if (!expected) {
    if (!isPlainObject(proposal.domainDetails)) errors.push('candidateProposal.domainDetails must be a plain object');
    return;
  }
  if (!exactFields(proposal.domainDetails, expected, 'candidateProposal.domainDetails', errors)) return;
  const details = proposal.domainDetails;
  for (const [key, value] of Object.entries(details)) {
    const path = `candidateProposal.domainDetails.${key}`;
    if (Array.isArray(value)) validateStringArray(value, path, errors);
    else if (typeof value === 'boolean') validateBoolean(value, path, errors);
    else if (typeof value === 'number') validateNumber(value, path, errors);
    else validateString(value, path, errors);
  }
  if (proposal.domainId === 'fitness' && !PROGRESSION_ACTIONS.has(details.progressionAction)) {
    errors.push('candidateProposal.domainDetails.progressionAction is invalid');
  }
  if (proposal.domainId === 'money' && !FINANCIAL_RISK_LEVELS.has(details.riskLevel)) {
    errors.push('candidateProposal.domainDetails.riskLevel is invalid');
  }
}

function validateExecutionItemDomainDetails(details, domainId, path, errors) {
  const expected = EXECUTION_ITEM_DOMAIN_DETAIL_FIELDS[domainId];
  if (!expected) {
    if (!isPlainObject(details)) errors.push(`${path} must be a plain object`);
    return;
  }
  const errorCountBeforeThisItem = errors.length;
  if (!exactFields(details, expected, path, errors)) return;
  for (const [key, value] of Object.entries(details)) {
    const fieldPath = `${path}.${key}`;
    if (Array.isArray(value)) validateStringArray(value, fieldPath, errors);
    else if (typeof value === 'boolean') validateBoolean(value, fieldPath, errors);
    else if (typeof value === 'number') validateNumber(value, fieldPath, errors);
    else validateString(value, fieldPath, errors);
  }
  // Domain-specific semantic bounds only run once this item's own fields are
  // structurally well-formed — otherwise e.g. a missing `sets` field would
  // also be reported as "not a positive whole number", duplicating the
  // exactFields error above with a confusing second one.
  if (errors.length > errorCountBeforeThisItem) return;

  // Domain-specific semantic bounds, independent of any one request's
  // trusted facts (those cross-checks — e.g. Fitness equipment actually
  // available, Money amount within the confirmed affordable ceiling — need
  // request access and live in response-validator.js's semanticReasons
  // instead). These are the structural invariants a well-formed item must
  // satisfy no matter which request produced it.
  if (domainId === 'fitness') {
    if (!Number.isInteger(details.sets) || details.sets < 1) errors.push(`${path}.sets must be a positive whole number`);
    if (!Number.isInteger(details.repRangeLow) || details.repRangeLow < 0) errors.push(`${path}.repRangeLow must be a non-negative whole number`);
    if (!Number.isInteger(details.repRangeHigh) || details.repRangeHigh < 1) errors.push(`${path}.repRangeHigh must be a positive whole number`);
    if (Number.isFinite(details.repRangeLow) && Number.isFinite(details.repRangeHigh) && details.repRangeLow > details.repRangeHigh) {
      errors.push(`${path}.repRangeLow must not exceed repRangeHigh`);
    }
    if (!Number.isInteger(details.restSeconds) || details.restSeconds < 0) errors.push(`${path}.restSeconds must be a non-negative whole number`);
  }
  if (domainId === 'athlete') {
    if (!Number.isInteger(details.sets) || details.sets < 1) errors.push(`${path}.sets must be a positive whole number`);
    if (!Number.isFinite(details.repsOrDurationSeconds) || details.repsOrDurationSeconds < 0) errors.push(`${path}.repsOrDurationSeconds must be a non-negative number`);
    if (!Number.isInteger(details.recoverySeconds) || details.recoverySeconds < 0) errors.push(`${path}.recoverySeconds must be a non-negative whole number`);
  }
  if (domainId === 'money') {
    if (!Number.isFinite(details.amount) || details.amount < 0) errors.push(`${path}.amount must be a non-negative number`);
    if (!FINANCIAL_RISK_LEVELS.has(details.riskLevel)) errors.push(`${path}.riskLevel is invalid`);
  }
}

function validateExecutionItem(item, domainId, index, errors) {
  const path = `candidateProposal.professionalExecutionUnit.items[${index}]`;
  if (!exactFields(item, EXECUTION_ITEM_FIELDS, path, errors)) return;
  validateIdentifier(item.itemId, `${path}.itemId`, errors);
  validateNumber(item.order, `${path}.order`, errors, { integer: true, minimum: 1 });
  validateString(item.label, `${path}.label`, errors);
  validateIdentifier(item.actionType, `${path}.actionType`, errors);
  validateNumber(item.effortUnits, `${path}.effortUnits`, errors, { minimum: 1 });
  validateStringArray(item.requiredResourceIds, `${path}.requiredResourceIds`, errors);
  validateExecutionItemDomainDetails(item.domainItemDetails, domainId, `${path}.domainItemDetails`, errors);
}

/**
 * Checkpoint 2 completion: the ProfessionalExecutionUnit a candidate
 * actually represents — the complete session/batch/block the user will
 * perform (every exercise in a workout, every action in an outreach
 * batch, every question in an assessment), never a single vague action
 * standing in for the whole unit and never free text where a structured
 * field is required. `unitLabel`/`unitSummary`/`progressionTarget.
 * description`/`completionRequirement.description`/`proofRequirement.
 * description` are the only presentation-wording fields; everything else
 * — item order, counts, sets/reps/effort/rest, resource ids, proof
 * evidence type — is structurally typed and authoritative.
 *
 * @param {unknown} unit
 * @param {string} domainId
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateProfessionalExecutionUnit(unit, domainId) {
  const errors = [];
  if (!exactFields(unit, [
    'contractVersion', 'unitId', 'unitType', 'unitLabel', 'unitSummary', 'itemCount',
    'estimatedMinutes', 'items', 'progressionTarget', 'completionRequirement', 'proofRequirement',
  ], 'candidateProposal.professionalExecutionUnit', errors)) {
    return { valid: false, errors };
  }

  if (unit.contractVersion !== PROFESSIONAL_EXECUTION_UNIT_CONTRACT_VERSION) {
    errors.push(`candidateProposal.professionalExecutionUnit.contractVersion must be ${PROFESSIONAL_EXECUTION_UNIT_CONTRACT_VERSION}`);
  }
  validateIdentifier(unit.unitId, 'candidateProposal.professionalExecutionUnit.unitId', errors);
  if (!EXECUTION_UNIT_TYPES.has(unit.unitType)) {
    errors.push('candidateProposal.professionalExecutionUnit.unitType must be multi_item_session or single_item_session');
  }
  validateString(unit.unitLabel, 'candidateProposal.professionalExecutionUnit.unitLabel', errors);
  validateString(unit.unitSummary, 'candidateProposal.professionalExecutionUnit.unitSummary', errors);
  validateNumber(unit.estimatedMinutes, 'candidateProposal.professionalExecutionUnit.estimatedMinutes', errors, { minimum: 1 });

  if (!Array.isArray(unit.items) || unit.items.length === 0) {
    errors.push('candidateProposal.professionalExecutionUnit.items must be a non-empty array');
  } else {
    unit.items.forEach((item, index) => validateExecutionItem(item, domainId, index, errors));
    if (unit.itemCount !== unit.items.length) {
      errors.push('candidateProposal.professionalExecutionUnit.itemCount must equal items.length');
    }
    if (unit.unitType === 'single_item_session' && unit.items.length !== 1) {
      errors.push('candidateProposal.professionalExecutionUnit.unitType single_item_session must have exactly one item');
    }
    if (unit.unitType === 'multi_item_session' && unit.items.length < 2) {
      errors.push('candidateProposal.professionalExecutionUnit.unitType multi_item_session must have at least two items');
    }
    const orders = unit.items.map((item) => item.order);
    const isExactSequence = orders.every((value, index) => value === index + 1);
    if (!isExactSequence || new Set(orders).size !== orders.length) {
      errors.push('candidateProposal.professionalExecutionUnit.items order values must be exactly 1..N with no gaps or duplicates');
    }
    const itemIds = unit.items.map((item) => item.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      errors.push('candidateProposal.professionalExecutionUnit.items itemId values must be unique');
    }
  }

  if (exactFields(
    unit.progressionTarget,
    ['type', 'description', 'targetId'],
    'candidateProposal.professionalExecutionUnit.progressionTarget',
    errors,
  )) {
    validateIdentifier(unit.progressionTarget.type, 'candidateProposal.professionalExecutionUnit.progressionTarget.type', errors);
    validateString(unit.progressionTarget.description, 'candidateProposal.professionalExecutionUnit.progressionTarget.description', errors);
    validateString(unit.progressionTarget.targetId, 'candidateProposal.professionalExecutionUnit.progressionTarget.targetId', errors);
  }

  if (exactFields(
    unit.completionRequirement,
    ['description', 'requiredItemCount'],
    'candidateProposal.professionalExecutionUnit.completionRequirement',
    errors,
  )) {
    validateString(unit.completionRequirement.description, 'candidateProposal.professionalExecutionUnit.completionRequirement.description', errors);
    validateNumber(
      unit.completionRequirement.requiredItemCount,
      'candidateProposal.professionalExecutionUnit.completionRequirement.requiredItemCount',
      errors,
      { integer: true, minimum: 1 },
    );
    if (Array.isArray(unit.items) && unit.completionRequirement.requiredItemCount !== unit.items.length) {
      errors.push(
        'candidateProposal.professionalExecutionUnit.completionRequirement.requiredItemCount must equal items.length '
        + '(every item in the professional unit is required)',
      );
    }
  }

  if (exactFields(
    unit.proofRequirement,
    ['description', 'evidenceTypeId', 'proofMode'],
    'candidateProposal.professionalExecutionUnit.proofRequirement',
    errors,
  )) {
    validateString(unit.proofRequirement.description, 'candidateProposal.professionalExecutionUnit.proofRequirement.description', errors);
    validateIdentifier(unit.proofRequirement.evidenceTypeId, 'candidateProposal.professionalExecutionUnit.proofRequirement.evidenceTypeId', errors);
    if (!PROOF_MODES.has(unit.proofRequirement.proofMode)) {
      errors.push('candidateProposal.professionalExecutionUnit.proofRequirement.proofMode is invalid');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * @param {unknown} candidateProposal
 * @returns {{valid:boolean,errors:string[]}}
 */
export function validateCandidateProposal(candidateProposal) {
  const errors = [];
  if (!exactFields(candidateProposal, PROPOSAL_FIELDS, 'candidateProposal', errors)) {
    return { valid: false, errors };
  }
  validateIdentifier(candidateProposal.candidateId, 'candidateProposal.candidateId', errors);
  validateString(candidateProposal.title, 'candidateProposal.title', errors);
  validateIdentifier(candidateProposal.domainId, 'candidateProposal.domainId', errors);
  validateIdentifier(candidateProposal.workUnitTypeId, 'candidateProposal.workUnitTypeId', errors);

  if (exactFields(candidateProposal.method, ['id', 'targetIds', 'progressionIntent'], 'candidateProposal.method', errors)) {
    validateIdentifier(candidateProposal.method.id, 'candidateProposal.method.id', errors);
    validateStringArray(candidateProposal.method.targetIds, 'candidateProposal.method.targetIds', errors);
    if (!PROGRESSION_ACTIONS.has(candidateProposal.method.progressionIntent)) {
      errors.push('candidateProposal.method.progressionIntent is invalid');
    }
  }

  if (exactFields(
    candidateProposal.intendedOutcome,
    ['type', 'targetId', 'measurable'],
    'candidateProposal.intendedOutcome',
    errors,
  )) {
    validateIdentifier(candidateProposal.intendedOutcome.type, 'candidateProposal.intendedOutcome.type', errors);
    validateString(candidateProposal.intendedOutcome.targetId, 'candidateProposal.intendedOutcome.targetId', errors);
    validateBoolean(candidateProposal.intendedOutcome.measurable, 'candidateProposal.intendedOutcome.measurable', errors);
  }

  if (!Array.isArray(candidateProposal.missionSteps) || candidateProposal.missionSteps.length === 0) {
    errors.push('candidateProposal.missionSteps must be a non-empty array');
  } else {
    const outputIds = [];
    for (const [index, step] of candidateProposal.missionSteps.entries()) {
      const path = `candidateProposal.missionSteps[${index}]`;
      if (!exactFields(
        step,
        ['id', 'actionType', 'outputId', 'outputCategoryId', 'effortUnits'],
        path,
        errors,
      )) continue;
      validateIdentifier(step.id, `${path}.id`, errors);
      validateIdentifier(step.actionType, `${path}.actionType`, errors);
      validateString(step.outputId, `${path}.outputId`, errors);
      validateIdentifier(step.outputCategoryId, `${path}.outputCategoryId`, errors);
      validateNumber(step.effortUnits, `${path}.effortUnits`, errors, { minimum: 1 });
      outputIds.push(step.outputId);
    }
    if (new Set(outputIds).size !== outputIds.length) {
      errors.push('candidateProposal.missionSteps outputIds must be unique');
    }
  }

  validateString(candidateProposal.targetMilestoneId, 'candidateProposal.targetMilestoneId', errors);
  validateString(candidateProposal.targetRouteNodeId, 'candidateProposal.targetRouteNodeId', errors);
  validateIdentifier(
    candidateProposal.targetBottleneckCategory,
    'candidateProposal.targetBottleneckCategory',
    errors,
  );
  validateMissionStructure(candidateProposal.missionStructure, errors);
  validateNumber(candidateProposal.estimatedMinutes, 'candidateProposal.estimatedMinutes', errors, { minimum: 1 });
  validateStringArray(candidateProposal.requiredResourceIds, 'candidateProposal.requiredResourceIds', errors);

  if (exactFields(
    candidateProposal.proofPlan,
    ['evidenceTypeId', 'proofMode', 'claims'],
    'candidateProposal.proofPlan',
    errors,
  )) {
    validateIdentifier(candidateProposal.proofPlan.evidenceTypeId, 'candidateProposal.proofPlan.evidenceTypeId', errors);
    if (!PROOF_MODES.has(candidateProposal.proofPlan.proofMode)) {
      errors.push('candidateProposal.proofPlan.proofMode is invalid');
    }
    if (!Array.isArray(candidateProposal.proofPlan.claims)
      || candidateProposal.proofPlan.claims.length === 0) {
      errors.push('candidateProposal.proofPlan.claims must be a non-empty array');
    } else {
      const claimIds = [];
      for (const [index, claim] of candidateProposal.proofPlan.claims.entries()) {
        const path = `candidateProposal.proofPlan.claims[${index}]`;
        if (!exactFields(claim, ['id', 'categoryId'], path, errors)) continue;
        validateIdentifier(claim.id, `${path}.id`, errors);
        validateIdentifier(claim.categoryId, `${path}.categoryId`, errors);
        claimIds.push(claim.id);
      }
      if (new Set(claimIds).size !== claimIds.length) {
        errors.push('candidateProposal.proofPlan.claims ids must be unique');
      }
    }
  }

  validateEvidenceReferences(candidateProposal.evidenceRefs, 'candidateProposal.evidenceRefs', errors);
  validateDomainDetails(candidateProposal, errors);
  const executionUnitResult = validateProfessionalExecutionUnit(candidateProposal.professionalExecutionUnit, candidateProposal.domainId);
  errors.push(...executionUnitResult.errors);
  if (executionUnitResult.valid) {
    const unit = candidateProposal.professionalExecutionUnit;
    if (unit.estimatedMinutes !== candidateProposal.estimatedMinutes) {
      errors.push('candidateProposal.professionalExecutionUnit.estimatedMinutes must equal candidateProposal.estimatedMinutes');
    }
    if (isPlainObject(candidateProposal.proofPlan)) {
      if (unit.proofRequirement.evidenceTypeId !== candidateProposal.proofPlan.evidenceTypeId) {
        errors.push('candidateProposal.professionalExecutionUnit.proofRequirement.evidenceTypeId must equal candidateProposal.proofPlan.evidenceTypeId');
      }
      if (unit.proofRequirement.proofMode !== candidateProposal.proofPlan.proofMode) {
        errors.push('candidateProposal.professionalExecutionUnit.proofRequirement.proofMode must equal candidateProposal.proofPlan.proofMode');
      }
    }
    // The universal resource contract: candidate.requiredResourceIds must be
    // exactly the union of every item's own requiredResourceIds, across all
    // six domains — never a separately-authored top-level list that could
    // silently diverge from what the items actually declare.
    if (Array.isArray(candidateProposal.requiredResourceIds)) {
      const itemUnion = unionOfItemRequiredResources(unit.items);
      const normalizedTopLevel = [...new Set(candidateProposal.requiredResourceIds)].sort();
      if (itemUnion === null || JSON.stringify(itemUnion) !== JSON.stringify(normalizedTopLevel)) {
        errors.push('candidateProposal.requiredResourceIds must equal the exact union of every professionalExecutionUnit item\'s requiredResourceIds');
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateMissionEvaluationInput(trustedContext, candidateProposal) {
  const trusted = validateTrustedEvaluationContext(trustedContext);
  const proposal = validateCandidateProposal(candidateProposal);
  return {
    valid: trusted.valid && proposal.valid,
    errors: [
      ...trusted.errors,
      ...proposal.errors,
    ],
  };
}

export function assertValidMissionEvaluationInput(trustedContext, candidateProposal) {
  const result = validateMissionEvaluationInput(trustedContext, candidateProposal);
  if (!result.valid) throw new MissionEvaluationValidationError(result.errors);
}

/**
 * Backward name retained as a fail-closed validator for the new two-object
 * envelope. Old self-scoring candidates are rejected as unknown fields.
 */
export function validateMissionCandidate(value) {
  if (!isPlainObject(value)) return { valid: false, errors: ['evaluation input must be a plain object'] };
  const envelopeErrors = [];
  exactFields(value, ['trustedContext', 'candidateProposal'], 'evaluationInput', envelopeErrors);
  const input = validateMissionEvaluationInput(value.trustedContext, value.candidateProposal);
  return {
    valid: envelopeErrors.length === 0 && input.valid,
    errors: [...envelopeErrors, ...input.errors],
  };
}

export function assertValidMissionCandidate(value) {
  const result = validateMissionCandidate(value);
  if (!result.valid) throw new MissionEvaluationValidationError(result.errors);
}
