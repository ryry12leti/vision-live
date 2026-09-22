/**
 * Canonical Goal Engine domain-pack contract.
 *
 * This module is pure configuration validation. It does not score missions,
 * generate missions, select proof, or write authoritative state.
 */

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export const DOMAIN_PACK_CONTRACT_VERSION = 2;

export const DOMAIN_PACK_REQUIRED_FIELDS = Object.freeze([
  'domainId',
  'version',
  'supportedGoalCategories',
  'milestoneCategories',
  'professionalWorkUnitTypes',
  'prerequisiteCategories',
  'bottleneckCategories',
  'progressSignals',
  'capabilitySignals',
  'constraintSignals',
  'recoveryReadinessSignals',
  'proofCompatibleEvidenceTypes',
  'hardScalingRules',
  'mediumScalingRules',
  'fixedMissionConditions',
  'clarificationTriggers',
  'safetyIntegrityGates',
  'externalPlanRules',
  'forbiddenGenericMissionPatterns',
  'evaluationRuleIds',
]);

const COLLECTION_RULES = Object.freeze({
  supportedGoalCategories: 5,
  milestoneCategories: 4,
  professionalWorkUnitTypes: 5,
  prerequisiteCategories: 3,
  bottleneckCategories: 3,
  progressSignals: 3,
  capabilitySignals: 3,
  constraintSignals: 3,
  recoveryReadinessSignals: 1,
  proofCompatibleEvidenceTypes: 2,
  hardScalingRules: 3,
  mediumScalingRules: 3,
  fixedMissionConditions: 1,
  clarificationTriggers: 3,
  safetyIntegrityGates: 3,
  externalPlanRules: 2,
  forbiddenGenericMissionPatterns: 3,
  evaluationRuleIds: 3,
});

const STRUCTURED_COLLECTIONS = new Set([
  'professionalWorkUnitTypes',
  'proofCompatibleEvidenceTypes',
  'hardScalingRules',
  'mediumScalingRules',
  'fixedMissionConditions',
  'clarificationTriggers',
  'safetyIntegrityGates',
  'externalPlanRules',
  'forbiddenGenericMissionPatterns',
]);

/**
 * @typedef {object} DomainPackRule
 * @property {string} id Stable, domain-namespaced identifier.
 * @property {string} description Operational rule stated in domain language.
 */

/**
 * @typedef {object} ProfessionalWorkUnitType
 * @property {string} id Stable, domain-namespaced identifier.
 * @property {string} description Complete professional unit and intended outcome.
 * @property {string[]} compatibleEvidenceTypeIds Evidence types capable of proving the output.
 * @property {string[]} allowedClaimCategoryIds Canonical claims this unit may make.
 * @property {string[]} producedOutputCategoryIds Canonical outputs this unit produces.
 */

/**
 * @typedef {object} ProofCompatibleEvidenceType
 * @property {string} id Stable, domain-namespaced identifier.
 * @property {'photo'|'voice'|'live'|'hybrid'} proofMode Existing VISION proof modality.
 * @property {string} description What the modality can honestly evidence.
 * @property {string[]} supportedClaimCategoryIds Canonical claims this evidence can verify.
 * @property {string[]} capturedOutputCategoryIds Canonical outputs this evidence can capture.
 * @property {string[]} requiredCaptureCapabilityIds Trusted capture capabilities required.
 */

/**
 * @typedef {object} DomainPack
 * @property {string} domainId
 * @property {string} version Semantic version.
 * @property {string[]} supportedGoalCategories
 * @property {string[]} milestoneCategories
 * @property {ProfessionalWorkUnitType[]} professionalWorkUnitTypes
 * @property {string[]} prerequisiteCategories
 * @property {string[]} bottleneckCategories
 * @property {string[]} progressSignals
 * @property {string[]} capabilitySignals
 * @property {string[]} constraintSignals
 * @property {string[]} recoveryReadinessSignals
 * @property {ProofCompatibleEvidenceType[]} proofCompatibleEvidenceTypes
 * @property {DomainPackRule[]} hardScalingRules
 * @property {DomainPackRule[]} mediumScalingRules
 * @property {DomainPackRule[]} fixedMissionConditions
 * @property {DomainPackRule[]} clarificationTriggers
 * @property {DomainPackRule[]} safetyIntegrityGates
 * @property {DomainPackRule[]} externalPlanRules
 * @property {DomainPackRule[]} forbiddenGenericMissionPatterns
 * @property {string[]} evaluationRuleIds
 */

export class DomainPackValidationError extends Error {
  constructor(errors) {
    super(`Invalid domain pack: ${errors.join('; ')}`);
    this.name = 'DomainPackValidationError';
    this.errors = Object.freeze([...errors]);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasUniqueValues(values) {
  return new Set(values).size === values.length;
}

function validateStringCollection(pack, field, errors) {
  const values = pack[field];
  if (!Array.isArray(values)) return;

  for (const [index, value] of values.entries()) {
    if (!isNonEmptyString(value)) errors.push(`${field}[${index}] must be a non-empty string`);
  }

  const normalised = values.filter(isNonEmptyString).map((value) => value.trim().toLowerCase());
  if (!hasUniqueValues(normalised)) errors.push(`${field} must not contain duplicates`);
}

function validateNamespacedRuleCollection(pack, field, errors) {
  const values = pack[field];
  if (!Array.isArray(values)) return;
  const ids = [];

  for (const [index, value] of values.entries()) {
    if (!isPlainObject(value)) {
      errors.push(`${field}[${index}] must be an object`);
      continue;
    }

    if (!isNonEmptyString(value.id) || !IDENTIFIER_PATTERN.test(value.id)) {
      errors.push(`${field}[${index}].id must be a snake_case identifier`);
    } else {
      ids.push(value.id);
      if (isNonEmptyString(pack.domainId) && !value.id.startsWith(`${pack.domainId}_`)) {
        errors.push(`${field}[${index}].id must be namespaced to ${pack.domainId}`);
      }
    }

    if (!isNonEmptyString(value.description)) {
      errors.push(`${field}[${index}].description must be a non-empty string`);
    }
  }

  if (!hasUniqueValues(ids)) errors.push(`${field} ids must be unique`);
}

function validateEvidenceTypes(pack, errors) {
  validateNamespacedRuleCollection(pack, 'proofCompatibleEvidenceTypes', errors);
  const values = pack.proofCompatibleEvidenceTypes;
  if (!Array.isArray(values)) return;

  const supportedModes = new Set(['photo', 'voice', 'live', 'hybrid']);
  for (const [index, value] of values.entries()) {
    if (isPlainObject(value) && !supportedModes.has(value.proofMode)) {
      errors.push(`proofCompatibleEvidenceTypes[${index}].proofMode must use an existing VISION proof modality`);
    }
    for (const field of [
      'supportedClaimCategoryIds',
      'capturedOutputCategoryIds',
      'requiredCaptureCapabilityIds',
    ]) {
      if (!Array.isArray(value?.[field]) || value[field].length === 0) {
        errors.push(`proofCompatibleEvidenceTypes[${index}].${field} must be non-empty`);
      } else if (!hasUniqueValues(value[field])) {
        errors.push(`proofCompatibleEvidenceTypes[${index}].${field} must not contain duplicates`);
      } else if (value[field].some((id) => !isNonEmptyString(id) || !IDENTIFIER_PATTERN.test(id))) {
        errors.push(`proofCompatibleEvidenceTypes[${index}].${field} must contain snake_case identifiers`);
      }
    }
  }
}

function validateWorkUnits(pack, errors) {
  validateNamespacedRuleCollection(pack, 'professionalWorkUnitTypes', errors);
  const workUnits = pack.professionalWorkUnitTypes;
  if (!Array.isArray(workUnits)) return;

  const evidenceIds = new Set(
    Array.isArray(pack.proofCompatibleEvidenceTypes)
      ? pack.proofCompatibleEvidenceTypes.map((item) => item?.id).filter(isNonEmptyString)
      : [],
  );

  for (const [index, workUnit] of workUnits.entries()) {
    if (!isPlainObject(workUnit)) continue;
    if (!Array.isArray(workUnit.compatibleEvidenceTypeIds) || workUnit.compatibleEvidenceTypeIds.length === 0) {
      errors.push(`professionalWorkUnitTypes[${index}].compatibleEvidenceTypeIds must be non-empty`);
      continue;
    }

    if (!hasUniqueValues(workUnit.compatibleEvidenceTypeIds)) {
      errors.push(`professionalWorkUnitTypes[${index}].compatibleEvidenceTypeIds must not contain duplicates`);
    }

    for (const field of ['allowedClaimCategoryIds', 'producedOutputCategoryIds']) {
      if (!Array.isArray(workUnit[field]) || workUnit[field].length === 0) {
        errors.push(`professionalWorkUnitTypes[${index}].${field} must be non-empty`);
      } else if (!hasUniqueValues(workUnit[field])) {
        errors.push(`professionalWorkUnitTypes[${index}].${field} must not contain duplicates`);
      } else if (workUnit[field].some((id) => (
        !isNonEmptyString(id)
        || !IDENTIFIER_PATTERN.test(id)
        || !id.startsWith(`${pack.domainId}_`)
      ))) {
        errors.push(`professionalWorkUnitTypes[${index}].${field} must contain domain-namespaced identifiers`);
      }
    }

    for (const evidenceId of workUnit.compatibleEvidenceTypeIds) {
      if (!evidenceIds.has(evidenceId)) {
        errors.push(`professionalWorkUnitTypes[${index}] references unknown evidence type ${evidenceId}`);
      }
    }
  }
}

/**
 * Validate an unknown value against the canonical domain-pack contract.
 *
 * @param {unknown} candidate
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateDomainPack(candidate) {
  const errors = [];
  if (!isPlainObject(candidate)) {
    return { valid: false, errors: ['domain pack must be a plain object'] };
  }

  for (const field of DOMAIN_PACK_REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(candidate, field)) {
      errors.push(`missing required field: ${field}`);
    }
  }

  const unknownFields = Object.keys(candidate).filter((field) => !DOMAIN_PACK_REQUIRED_FIELDS.includes(field));
  for (const field of unknownFields) errors.push(`unknown domain-pack field: ${field}`);

  if (!isNonEmptyString(candidate.domainId) || !IDENTIFIER_PATTERN.test(candidate.domainId)) {
    errors.push('domainId must be a snake_case identifier');
  }
  if (!isNonEmptyString(candidate.version) || !VERSION_PATTERN.test(candidate.version)) {
    errors.push('version must be a semantic version');
  }

  for (const [field, minimum] of Object.entries(COLLECTION_RULES)) {
    const values = candidate[field];
    if (!Array.isArray(values)) {
      errors.push(`${field} must be an array`);
    } else if (values.length < minimum) {
      errors.push(`${field} must contain at least ${minimum} entries`);
    }
  }

  for (const field of Object.keys(COLLECTION_RULES)) {
    if (!STRUCTURED_COLLECTIONS.has(field)) validateStringCollection(candidate, field, errors);
  }

  for (const field of STRUCTURED_COLLECTIONS) {
    if (field !== 'professionalWorkUnitTypes' && field !== 'proofCompatibleEvidenceTypes') {
      validateNamespacedRuleCollection(candidate, field, errors);
    }
  }

  validateEvidenceTypes(candidate, errors);
  validateWorkUnits(candidate, errors);

  return { valid: errors.length === 0, errors };
}

/**
 * @param {unknown} candidate
 * @returns {asserts candidate is DomainPack}
 */
export function assertValidDomainPack(candidate) {
  const result = validateDomainPack(candidate);
  if (!result.valid) throw new DomainPackValidationError(result.errors);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

/**
 * Validate and deeply freeze a canonical domain pack.
 *
 * @param {DomainPack} pack
 * @returns {Readonly<DomainPack>}
 */
export function defineDomainPack(pack) {
  const materialized = structuredClone(pack);
  materialized.professionalWorkUnitTypes = materialized.professionalWorkUnitTypes.map((workUnit) => ({
    ...workUnit,
    allowedClaimCategoryIds: workUnit.allowedClaimCategoryIds
      || [`${workUnit.id}_completed`],
    producedOutputCategoryIds: workUnit.producedOutputCategoryIds
      || [`${workUnit.id}_record`],
  }));
  materialized.proofCompatibleEvidenceTypes = materialized.proofCompatibleEvidenceTypes.map((evidenceType) => {
    const compatibleWorkUnits = materialized.professionalWorkUnitTypes.filter((workUnit) => (
      workUnit.compatibleEvidenceTypeIds.includes(evidenceType.id)
    ));
    return {
      ...evidenceType,
      supportedClaimCategoryIds: evidenceType.supportedClaimCategoryIds
        || uniqueSorted(compatibleWorkUnits.flatMap((workUnit) => workUnit.allowedClaimCategoryIds)),
      capturedOutputCategoryIds: evidenceType.capturedOutputCategoryIds
        || uniqueSorted(compatibleWorkUnits.flatMap((workUnit) => workUnit.producedOutputCategoryIds)),
      requiredCaptureCapabilityIds: evidenceType.requiredCaptureCapabilityIds || (
        evidenceType.proofMode === 'voice'
          ? ['microphone']
          : evidenceType.proofMode === 'hybrid'
            ? ['artifact_capture']
            : ['camera']
      ),
    };
  });
  assertValidDomainPack(materialized);
  return deepFreeze(materialized);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}
