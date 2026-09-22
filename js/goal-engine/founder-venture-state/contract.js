/**
 * Founder Venture State: the trusted, versioned record of what a Founder is
 * actually building — separate from, and upstream of, Goal Engine's
 * per-goal trusted context (js/goal-engine/trusted-context). This module
 * owns validation only: field shapes, trust-status rules, and the
 * venture-source-record contract. Bottleneck detection and Today's Move
 * generation are future consumers, not built here.
 *
 * Every meaningful fact carries its own source status (verified /
 * user_reported / provisional, see FACT_SOURCE_STATUSES) rather than the
 * venture as a whole having one confidence level — a founder who has
 * connected GitHub for their repo but has only told the chat about their
 * target customer should see the repo facts as verified and the customer
 * fact as provisional, not one blended number.
 *
 * Persistence design: a `ventureState` result from assembler.js IS the
 * complete persistable record — there is no separate internal replay bag.
 * Every trust-tracked field the merge needs to resume from (value,
 * sourceStatus, sourceRecordId, recordedAt) is already present in the
 * public shape, so a caller may `JSON.stringify` the whole `ventureState`
 * object, store it, reload it verbatim, and pass it back as
 * `previousState` — nothing is silently dropped by that round trip, and
 * nothing needs reconstructing from data the public contract doesn't
 * expose. `validatePreviousVentureState` re-validates every field of a
 * supplied `previousState` exactly as strictly as a fresh source record,
 * so corrupted or stale-schema persisted state fails closed with
 * `invalid_input` rather than silently flowing through.
 */

export const FOUNDER_VENTURE_STATE_CONTRACT_VERSION = 1;

export const VENTURE_ROLES = Object.freeze(['primary', 'secondary']);
export const MAX_VENTURES_PER_ROLE = Object.freeze({ primary: 1, secondary: 1 });

export const BUSINESS_MODEL_FAMILIES = Object.freeze([
  'software_app',
  'agency_service_freelance',
  'ecommerce_product',
  'creator_led_business',
  'local_physical_business',
  'coaching_consulting',
  'other_founder_venture',
]);

export const FOUNDER_STAGES = Object.freeze([
  'venture_discovery',
  'problem_validation',
  'customer_validation',
  'offer_validation',
  'product_building',
  'launch_preparation',
  'customer_acquisition',
  'delivery',
  'retention',
  'operations',
  'team_and_hiring',
  'scaling',
  'strategy_and_capital',
]);

// Only 'explicit' (a real fact directly reported) and 'unknown' (nothing
// ever reported) exist in this contract version. 'inferred' is reserved
// for a future stage-inference implementation and is deliberately NOT
// accepted here — see validateStageView below and assembler.js's
// buildStage, which never produces anything but these two.
export const STAGE_SOURCES = Object.freeze(['explicit', 'unknown']);
export const RESERVED_UNIMPLEMENTED_STAGE_SOURCES = Object.freeze(['inferred']);

export const FOUNDER_MODES = Object.freeze(['working', 'strategic', 'idealistic']);
export const DEFAULT_FOUNDER_MODE = 'working';

export const PUSH_LEVELS = Object.freeze(['low', 'moderate', 'high']);

// The only three trust tiers a fact may carry. There is no "unverified but
// trust it anyway" tier: a fact that fails all three is not recorded.
export const FACT_SOURCE_STATUSES = Object.freeze(['verified', 'user_reported', 'provisional']);
// Monotonic upgrade order: a fact may only move left-to-right, never back,
// and a same-or-lower incoming status can never overwrite a higher one —
// see assembler.js mergeField.
const STATUS_RANK = Object.freeze({ provisional: 0, user_reported: 1, verified: 2 });
export function statusRank(status) {
  return STATUS_RANK[status];
}

// A venture source record's sourceType is the sole determinant of the
// resulting fact status for every field it reports — mirrors trusted-
// context/contract.js's SOURCE_PROVENANCE_MATRIX pattern (one fixed,
// non-negotiable authority per source type) at a smaller, venture-scoped
// altitude.
export const VENTURE_SOURCE_TYPES = Object.freeze([
  'chat_message_update',
  'user_confirmed_venture_fact',
  'verified_venture_evidence',
]);
export const SOURCE_TYPE_STATUS = Object.freeze({
  chat_message_update: 'provisional',
  user_confirmed_venture_fact: 'user_reported',
  verified_venture_evidence: 'verified',
});
const VENTURE_AUTHORITY_TYPES = new Set(['ai_extracted', 'user_confirmed', 'integration_verified']);
const VENTURE_ACTOR_TYPES = new Set(['ai', 'user', 'integration']);
export const VENTURE_SOURCE_PROVENANCE_MATRIX = Object.freeze({
  chat_message_update: Object.freeze({ authority: 'ai_extracted', actorType: 'ai' }),
  user_confirmed_venture_fact: Object.freeze({ authority: 'user_confirmed', actorType: 'user' }),
  verified_venture_evidence: Object.freeze({ authority: 'integration_verified', actorType: 'integration' }),
});

export const NEXT_ACTIONS = Object.freeze([
  'provide_manual_information',
  'upload_file',
  'provide_website_url',
  'connect_github',
  'connect_supabase',
  'connect_vercel',
]);

// Fields that end up as a plain TrustedField {value, sourceStatus,
// sourceRecordId, recordedAt} in the output. `pushLevel` is enum-
// restricted like businessModelFamily but otherwise a plain TrustedField —
// it does NOT get a structured view the way currentStage/founderMode do.
export const SCALAR_FACT_FIELDS = Object.freeze([
  'ventureName', 'idea', 'niche', 'businessModelFamily', 'targetCustomer', 'offer',
  'currentLevel', 'immediateGoal', 'futureGoal', 'requestedHelp', 'currentBottleneck', 'pushLevel',
  // Read only by the task-quality gate (task-quality-gate.js) to make an
  // outreach-shaped task's action concrete. A schema registration only --
  // never added to CONFIDENCE_RELEVANT_FACT_KEYS, never read by
  // route-eligibility, never part of any conflict/confidence computation.
  'outreachChannel',
]);
// List fields: a non-empty array of non-empty strings.
export const LIST_FACT_FIELDS = Object.freeze(['completedWork', 'unfinishedWork', 'availableResourceIds']);
export const TRUSTED_FIELD_NAMES = Object.freeze([...SCALAR_FACT_FIELDS, ...LIST_FACT_FIELDS]);
// `currentStage` and `founderMode` carry their own richer structured view
// (source/confidence/supportingFactIds for stage; defaulted for mode)
// rather than a plain TrustedField — see validateStageView/
// validateFounderModeView.
export const STRUCTURED_FIELD_NAMES = Object.freeze(['currentStage', 'founderMode']);
export const VENTURE_FACT_FIELDS = Object.freeze([...TRUSTED_FIELD_NAMES, ...STRUCTURED_FIELD_NAMES]);

// Every field required for the venture state to be usable by a future
// consumer (see MINIMUM USABLE CONTEXT). businessModelFamily and one of
// {idea, niche} establish "what they are building"; ventureName is not
// required — an unnamed idea is still real context.
export const REQUIRED_USABLE_FIELDS = Object.freeze([
  'businessModelFamily', 'completedWork', 'unfinishedWork', 'requestedHelp',
]);
// At least one of these must be present to establish "what the user is
// building or operating" — a bare businessModelFamily with no idea/niche/
// offer is not enough to act on.
export const WHAT_FIELDS_ANY_OF = Object.freeze(['idea', 'niche', 'offer']);

// The complete persisted ventureState shape: every field a caller may see
// on a 'ready' result. Used by validatePreviousVentureState to reject any
// unknown/missing/extra field on a supplied previousState — the same
// exact-fields discipline applied to fresh input is applied to persisted
// input.
const REQUIRED_STATE_TOP_FIELDS = Object.freeze([
  'contractVersion', 'ventureId', 'ventureRole', 'businessModelFamily', 'currentStage',
  'completedWork', 'unfinishedWork', 'requestedHelp', 'founderMode', 'stateConfidence',
  'updatedAt', 'history', 'rejectedUpdates',
]);
const OPTIONAL_STATE_TOP_FIELDS = Object.freeze([
  'ventureName', 'idea', 'niche', 'targetCustomer', 'offer', 'currentLevel',
  'immediateGoal', 'futureGoal', 'currentBottleneck', 'availableResourceIds', 'pushLevel',
]);

export class FounderVentureStateValidationError extends Error {
  constructor(errors) {
    super(`Invalid Founder venture-state input: ${errors.join('; ')}`);
    this.name = 'FounderVentureStateValidationError';
    this.errors = Object.freeze([...errors]);
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item))
    && new Set(value).size === value.length;
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
  return required.every((field) => Object.hasOwn(value, field));
}

/**
 * Like exactFields, but distinguishes required from optional fields — the
 * persisted ventureState shape has genuinely optional fields (an unnamed
 * venture never has `ventureName`), which a single fixed field list cannot
 * express.
 */
function fieldsWithinAllowed(value, required, optional, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be a plain object`);
    return false;
  }
  const allowed = [...required, ...optional];
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`missing required field: ${path}.${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  }
  return required.every((field) => Object.hasOwn(value, field));
}

export function validTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

export function validateFactValue(field, value, path, errors) {
  if (field === 'businessModelFamily') {
    if (!BUSINESS_MODEL_FAMILIES.includes(value)) errors.push(`${path} is not a supported business-model family`);
  } else if (field === 'currentStage') {
    if (!FOUNDER_STAGES.includes(value)) errors.push(`${path} is not a supported Founder stage`);
  } else if (field === 'pushLevel') {
    if (!PUSH_LEVELS.includes(value)) errors.push(`${path} is not a supported push level`);
  } else if (field === 'founderMode') {
    if (!FOUNDER_MODES.includes(value)) errors.push(`${path} is not a supported Founder mode`);
  } else if (LIST_FACT_FIELDS.includes(field)) {
    if (!isNonEmptyStringArray(value)) errors.push(`${path} must be a non-empty array of distinct non-empty strings`);
  } else if (SCALAR_FACT_FIELDS.includes(field)) {
    if (!isNonEmptyString(value)) errors.push(`${path} must be a non-empty string`);
  } else {
    errors.push(`${path} is not a recognised venture-state field`);
  }
}

/**
 * Validates one plain TrustedField {value, sourceStatus, sourceRecordId,
 * recordedAt} — the shape every scalar/list venture fact takes once
 * accepted, whether freshly merged or carried forward from previousState.
 */
function validateTrustedField(field, trustedField, path, errors) {
  if (!exactFields(trustedField, ['value', 'sourceStatus', 'sourceRecordId', 'recordedAt'], path, errors)) return;
  if (!FACT_SOURCE_STATUSES.includes(trustedField.sourceStatus)) errors.push(`${path}.sourceStatus is invalid`);
  if (!isNonEmptyString(trustedField.sourceRecordId)) errors.push(`${path}.sourceRecordId must be a non-empty string`);
  if (!validTimestamp(trustedField.recordedAt)) errors.push(`${path}.recordedAt must be a valid timestamp`);
  validateFactValue(field, trustedField.value, `${path}.value`, errors);
}

/**
 * Validates the structured currentStage view. Only 'explicit' (a real
 * fact, confidence always exactly 1 — there is no partial-confidence
 * inference in this contract version) and 'unknown' (every other field
 * strictly null/empty) are accepted. A stored `source: 'inferred'` is
 * rejected with an explicit "not implemented" reason rather than treated
 * as a generic malformed value, and rather than silently accepted as if
 * inference already existed.
 */
function validateStageView(view, path, errors) {
  if (!exactFields(view, ['value', 'source', 'confidence', 'sourceStatus', 'supportingFactIds', 'updatedAt'], path, errors)) return;
  if (RESERVED_UNIMPLEMENTED_STAGE_SOURCES.includes(view.source)) {
    errors.push(`${path}.source '${view.source}' is not implemented in contract version ${FOUNDER_VENTURE_STATE_CONTRACT_VERSION}`);
    return;
  }
  if (!STAGE_SOURCES.includes(view.source)) {
    errors.push(`${path}.source must be one of ${STAGE_SOURCES.join(', ')}`);
    return;
  }
  if (view.source === 'unknown') {
    if (view.value !== null) errors.push(`${path}.value must be null when source is unknown`);
    if (view.confidence !== null) errors.push(`${path}.confidence must be null when source is unknown`);
    if (view.sourceStatus !== null) errors.push(`${path}.sourceStatus must be null when source is unknown`);
    if (!Array.isArray(view.supportingFactIds) || view.supportingFactIds.length !== 0) {
      errors.push(`${path}.supportingFactIds must be an empty array when source is unknown`);
    }
    if (view.updatedAt !== null) errors.push(`${path}.updatedAt must be null when source is unknown`);
    return;
  }
  if (!FOUNDER_STAGES.includes(view.value)) errors.push(`${path}.value is not a supported Founder stage`);
  if (view.confidence !== 1) errors.push(`${path}.confidence must be exactly 1 for an explicit stage`);
  if (!FACT_SOURCE_STATUSES.includes(view.sourceStatus)) errors.push(`${path}.sourceStatus is invalid`);
  if (!isNonEmptyStringArray(view.supportingFactIds)) errors.push(`${path}.supportingFactIds must be a non-empty array of distinct non-empty strings`);
  if (!validTimestamp(view.updatedAt)) errors.push(`${path}.updatedAt must be a valid timestamp`);
}

/**
 * Validates the structured founderMode view, including internal
 * consistency between `defaulted` and the other fields — a defaulted mode
 * must look exactly like the system default (provisional, no source
 * record, no timestamp), never a mix that pretends to be both defaulted
 * and explicitly evidenced.
 */
function validateFounderModeView(view, path, errors) {
  if (!exactFields(view, ['value', 'sourceStatus', 'defaulted', 'sourceRecordId', 'updatedAt'], path, errors)) return;
  if (!FOUNDER_MODES.includes(view.value)) errors.push(`${path}.value is not a supported Founder mode`);
  if (typeof view.defaulted !== 'boolean') { errors.push(`${path}.defaulted must be a boolean`); return; }
  if (view.defaulted) {
    if (view.sourceStatus !== 'provisional') errors.push(`${path}.sourceStatus must be provisional when defaulted`);
    if (view.sourceRecordId !== null) errors.push(`${path}.sourceRecordId must be null when defaulted`);
    if (view.updatedAt !== null) errors.push(`${path}.updatedAt must be null when defaulted`);
    if (view.value !== DEFAULT_FOUNDER_MODE) errors.push(`${path}.value must be ${DEFAULT_FOUNDER_MODE} when defaulted`);
  } else {
    if (!FACT_SOURCE_STATUSES.includes(view.sourceStatus)) errors.push(`${path}.sourceStatus is invalid`);
    if (!isNonEmptyString(view.sourceRecordId)) errors.push(`${path}.sourceRecordId must be a non-empty string when not defaulted`);
    if (!validTimestamp(view.updatedAt)) errors.push(`${path}.updatedAt must be a valid timestamp when not defaulted`);
  }
}

function validateHistoryEntry(entry, path, errors) {
  if (!exactFields(entry, ['field', 'previous', 'replacedAt', 'replacedBySourceRecordId'], path, errors)) return;
  if (!VENTURE_FACT_FIELDS.includes(entry.field)) {
    errors.push(`${path}.field is not a recognised venture-state field`);
    return;
  }
  if (!validTimestamp(entry.replacedAt)) errors.push(`${path}.replacedAt must be a valid timestamp`);
  if (!isNonEmptyString(entry.replacedBySourceRecordId)) errors.push(`${path}.replacedBySourceRecordId must be a non-empty string`);
  validateTrustedField(entry.field, entry.previous, `${path}.previous`, errors);
}

function validateRejectedUpdateEntry(entry, path, errors) {
  if (!exactFields(entry, [
    'field', 'attemptedValue', 'attemptedStatus', 'attemptedSourceRecordId', 'existingStatus', 'reason',
  ], path, errors)) return;
  if (!VENTURE_FACT_FIELDS.includes(entry.field)) {
    errors.push(`${path}.field is not a recognised venture-state field`);
    return;
  }
  if (!FACT_SOURCE_STATUSES.includes(entry.attemptedStatus)) errors.push(`${path}.attemptedStatus is invalid`);
  if (!FACT_SOURCE_STATUSES.includes(entry.existingStatus)) errors.push(`${path}.existingStatus is invalid`);
  if (!isNonEmptyString(entry.attemptedSourceRecordId)) errors.push(`${path}.attemptedSourceRecordId must be a non-empty string`);
  if (!isNonEmptyString(entry.reason)) errors.push(`${path}.reason must be a non-empty string`);
  validateFactValue(entry.field, entry.attemptedValue, `${path}.attemptedValue`, errors);
}

/**
 * Validates one venture source record: the atomic unit of Founder venture
 * evidence, structurally identical in spirit to trusted-context's
 * sourceRecords (contractVersion, sourceRecordId, provenance, timestamps)
 * but scoped to one ventureId and a fixed, small VENTURE_SOURCE_TYPES
 * vocabulary. `capturedFacts` may report any subset of VENTURE_FACT_FIELDS;
 * every value must already match that field's own type/enum — an invalid
 * enum value here is rejected outright, never coerced or dropped silently.
 */
export function validateVentureSourceRecord(record, index, errors) {
  const path = `sourceRecords[${index}]`;
  if (!exactFields(record, [
    'contractVersion', 'sourceRecordId', 'ventureId', 'sourceType',
    'occurredAt', 'capturedFacts', 'provenance',
  ], path, errors)) return;

  if (record.contractVersion !== FOUNDER_VENTURE_STATE_CONTRACT_VERSION) {
    errors.push(`${path}.contractVersion must be ${FOUNDER_VENTURE_STATE_CONTRACT_VERSION}`);
  }
  if (!isNonEmptyString(record.sourceRecordId)) errors.push(`${path}.sourceRecordId must be a non-empty string`);
  if (!isNonEmptyString(record.ventureId)) errors.push(`${path}.ventureId must be a non-empty string`);
  if (!VENTURE_SOURCE_TYPES.includes(record.sourceType)) errors.push(`${path}.sourceType is unsupported`);
  if (!validTimestamp(record.occurredAt)) errors.push(`${path}.occurredAt must be a valid timestamp`);

  if (!isPlainObject(record.capturedFacts) || Object.keys(record.capturedFacts).length === 0) {
    errors.push(`${path}.capturedFacts must be a non-empty plain object`);
  } else {
    for (const [field, value] of Object.entries(record.capturedFacts)) {
      if (!VENTURE_FACT_FIELDS.includes(field)) {
        errors.push(`${path}.capturedFacts.${field} is not a recognised venture-state field`);
        continue;
      }
      validateFactValue(field, value, `${path}.capturedFacts.${field}`, errors);
    }
  }

  if (VENTURE_SOURCE_TYPES.includes(record.sourceType)) {
    const expected = VENTURE_SOURCE_PROVENANCE_MATRIX[record.sourceType];
    if (!exactFields(record.provenance, ['authority', 'actorType', 'referenceId'], `${path}.provenance`, errors)) return;
    if (!VENTURE_AUTHORITY_TYPES.has(record.provenance.authority)) errors.push(`${path}.provenance.authority is invalid`);
    if (!VENTURE_ACTOR_TYPES.has(record.provenance.actorType)) errors.push(`${path}.provenance.actorType is invalid`);
    if (record.provenance.authority !== expected.authority || record.provenance.actorType !== expected.actorType) {
      errors.push(`${path}.provenance authority/actor pair is not permitted for ${record.sourceType}`);
    }
    if (!isNonEmptyString(record.provenance.referenceId)) errors.push(`${path}.provenance.referenceId must be a non-empty string`);
  }
}

/**
 * Fully re-validates a persisted `ventureState` object before it may be
 * used as `previousState` for another assembly call. This is the exact
 * same strictness applied to fresh source records: exact fields only, every
 * enum re-checked against the current contract, every TrustedField
 * structurally sound, `currentStage`/`founderMode` internally consistent,
 * and every `history`/`rejectedUpdates` entry individually validated.
 *
 * A `previousState` that is missing, has extra/renamed fields, carries an
 * enum value no longer supported, or is otherwise malformed fails here —
 * the caller (assembleFounderVentureState) turns that into `invalid_input`
 * rather than silently treating it as "no prior facts" or passing corrupt
 * data through to a 'ready' result.
 *
 * @param {unknown} previousState
 * @param {string} expectedVentureId
 * @param {string} expectedVentureRole
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validatePreviousVentureState(previousState, expectedVentureId, expectedVentureRole) {
  const errors = [];
  if (!fieldsWithinAllowed(previousState, REQUIRED_STATE_TOP_FIELDS, OPTIONAL_STATE_TOP_FIELDS, 'previousState', errors)) {
    return { valid: false, errors };
  }

  if (previousState.contractVersion !== FOUNDER_VENTURE_STATE_CONTRACT_VERSION) {
    errors.push(`previousState.contractVersion must be ${FOUNDER_VENTURE_STATE_CONTRACT_VERSION}`);
  }
  if (previousState.ventureId !== expectedVentureId) {
    errors.push('previousState.ventureId does not match this assembly\'s ventureId');
  }
  if (!VENTURE_ROLES.includes(previousState.ventureRole)) {
    errors.push('previousState.ventureRole must be primary or secondary');
  } else if (previousState.ventureRole !== expectedVentureRole) {
    errors.push('previousState.ventureRole does not match this assembly\'s ventureRole');
  }
  if (!validTimestamp(previousState.updatedAt)) errors.push('previousState.updatedAt must be a valid timestamp');
  if (!Number.isFinite(previousState.stateConfidence) || previousState.stateConfidence < 0 || previousState.stateConfidence > 1) {
    errors.push('previousState.stateConfidence must be a number from 0 to 1');
  }

  for (const field of TRUSTED_FIELD_NAMES) {
    if (Object.hasOwn(previousState, field)) {
      validateTrustedField(field, previousState[field], `previousState.${field}`, errors);
    }
  }
  if (Object.hasOwn(previousState, 'currentStage')) validateStageView(previousState.currentStage, 'previousState.currentStage', errors);
  if (Object.hasOwn(previousState, 'founderMode')) validateFounderModeView(previousState.founderMode, 'previousState.founderMode', errors);

  if (!Array.isArray(previousState.history)) {
    errors.push('previousState.history must be an array');
  } else {
    previousState.history.forEach((entry, index) => validateHistoryEntry(entry, `previousState.history[${index}]`, errors));
  }
  if (!Array.isArray(previousState.rejectedUpdates)) {
    errors.push('previousState.rejectedUpdates must be an array');
  } else {
    previousState.rejectedUpdates.forEach((entry, index) => validateRejectedUpdateEntry(entry, `previousState.rejectedUpdates[${index}]`, errors));
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates the full assembly input: one venture (never a mix), an
 * optional previous state to merge against, and the new source records
 * describing what changed. `ventureRole` here is the caller's asserted
 * role for this exact ventureId — the assembler does not infer or default
 * it. Portfolio-wide rules (max two ventures, one per role) are enforced
 * separately by addVentureToPortfolio, since that is a fact about the
 * whole portfolio, not about any one assembly call.
 */
export function validateAssemblyInput(input) {
  const errors = [];
  if (!exactFields(input, [
    'contractVersion', 'ventureId', 'ventureRole', 'evaluationTime', 'previousState', 'sourceRecords',
  ], 'assemblyInput', errors)) return { valid: false, errors };

  if (input.contractVersion !== FOUNDER_VENTURE_STATE_CONTRACT_VERSION) {
    errors.push(`assemblyInput.contractVersion must be ${FOUNDER_VENTURE_STATE_CONTRACT_VERSION}`);
  }
  if (!isNonEmptyString(input.ventureId)) errors.push('assemblyInput.ventureId must be a non-empty string');
  if (!VENTURE_ROLES.includes(input.ventureRole)) errors.push('assemblyInput.ventureRole must be primary or secondary');
  if (!validTimestamp(input.evaluationTime)) errors.push('assemblyInput.evaluationTime must be a valid timestamp');

  if (input.previousState !== null) {
    const previousStateCheck = validatePreviousVentureState(input.previousState, input.ventureId, input.ventureRole);
    if (!previousStateCheck.valid) errors.push(...previousStateCheck.errors);
  }

  if (!Array.isArray(input.sourceRecords)) {
    errors.push('assemblyInput.sourceRecords must be an array');
  } else {
    input.sourceRecords.forEach((record, index) => validateVentureSourceRecord(record, index, errors));
    const ids = input.sourceRecords.map((record) => record?.sourceRecordId).filter(isNonEmptyString);
    if (new Set(ids).size !== ids.length) errors.push('sourceRecords sourceRecordIds must be unique');
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidAssemblyInput(input) {
  const result = validateAssemblyInput(input);
  if (!result.valid) throw new FounderVentureStateValidationError(result.errors);
}

/**
 * A pure structural check over a whole Founder's venture portfolio — at
 * most one primary and at most one optional secondary, unique ventureIds,
 * each venture's declared role matching MAX_VENTURES_PER_ROLE. Reached
 * through addVentureToPortfolio below; not intended to be the only caller
 * forever, but never dead code — every portfolio mutation must go through
 * a function that calls this.
 *
 * @param {{ventureId: string, ventureRole: string}[]} ventures
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateVenturePortfolio(ventures) {
  const errors = [];
  if (!Array.isArray(ventures)) return { valid: false, errors: ['ventures must be an array'] };
  ventures.forEach((venture, index) => {
    if (!isPlainObject(venture)) { errors.push(`ventures[${index}] must be a plain object`); return; }
    if (!exactFields(venture, ['ventureId', 'ventureRole'], `ventures[${index}]`, errors)) return;
    if (!isNonEmptyString(venture.ventureId)) errors.push(`ventures[${index}].ventureId must be a non-empty string`);
    if (!VENTURE_ROLES.includes(venture.ventureRole)) errors.push(`ventures[${index}].ventureRole must be primary or secondary`);
  });
  if (errors.length > 0) return { valid: false, errors };

  const ids = ventures.map((v) => v.ventureId);
  if (new Set(ids).size !== ids.length) errors.push('ventureIds must be unique within a portfolio');
  for (const role of VENTURE_ROLES) {
    const count = ventures.filter((v) => v.ventureRole === role).length;
    if (count > MAX_VENTURES_PER_ROLE[role]) {
      errors.push(`a founder may have at most ${MAX_VENTURES_PER_ROLE[role]} ${role} venture(s), found ${count}`);
    }
  }
  const total = ventures.length;
  if (total > VENTURE_ROLES.length) errors.push(`a founder may have at most ${VENTURE_ROLES.length} ventures total, found ${total}`);
  return { valid: errors.length === 0, errors };
}

/**
 * The real, reachable portfolio entry point validateVenturePortfolio is
 * used through: given a founder's existing venture identities and a
 * candidate new venture, returns the resulting portfolio only if it would
 * still satisfy validateVenturePortfolio — never lets a caller add a third
 * venture, a second primary, a second secondary, or a duplicate ventureId.
 * There is no persistence here (out of scope for this repair): the caller
 * owns fetching `existingPortfolio` and storing the returned `portfolio`.
 *
 * @param {{ventureId: string, ventureRole: string}[]} existingPortfolio
 * @param {string} ventureId
 * @param {string} ventureRole
 * @returns {{valid: boolean, errors: string[], portfolio?: {ventureId: string, ventureRole: string}[]}}
 */
export function addVentureToPortfolio(existingPortfolio, ventureId, ventureRole) {
  const errors = [];
  if (!Array.isArray(existingPortfolio)) errors.push('existingPortfolio must be an array');
  if (!isNonEmptyString(ventureId)) errors.push('ventureId must be a non-empty string');
  if (!VENTURE_ROLES.includes(ventureRole)) errors.push('ventureRole must be primary or secondary');
  if (errors.length > 0) return { valid: false, errors };

  const candidatePortfolio = [...existingPortfolio, { ventureId, ventureRole }];
  const portfolioCheck = validateVenturePortfolio(candidatePortfolio);
  if (!portfolioCheck.valid) return { valid: false, errors: portfolioCheck.errors };
  return { valid: true, errors: [], portfolio: candidatePortfolio };
}

export function isFounderStage(value) {
  return FOUNDER_STAGES.includes(value);
}

export function isBusinessModelFamily(value) {
  return BUSINESS_MODEL_FAMILIES.includes(value);
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
