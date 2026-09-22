/**
 * Versioned contract for deterministic trusted-context source events.
 *
 * Version 2 separates record identity from underlying event identity, requires
 * an explicit evaluation clock, and gives every source stream a stable order.
 * This module validates provenance structure only. A future database adapter
 * must authenticate the real upstream actor; client-supplied labels are never
 * proof of identity or authority. Legacy version 1 is accepted only through an
 * explicit, lossless adapter.
 */

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const VERIFICATION_STATES = new Set(['verified', 'unverified', 'rejected']);
const GOAL_ROLES = new Set(['primary', 'secondary']);
const ASSEMBLY_STATES = new Set([
  'ready',
  'clarification_required',
  'insufficient_evidence',
  'conflicting_evidence',
  'recovery_required',
  'domain_not_ready',
]);

export const TRUSTED_CONTEXT_ASSEMBLER_VERSION = 2;
export const TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION = 2;
export const SUPPORTED_SOURCE_CONTRACT_VERSIONS = Object.freeze([1, 2]);
export const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const AUTHORITATIVE_SOURCE_TYPES = Object.freeze([
  'user_confirmed_goal',
  'active_milestone',
  'route_state',
  'prerequisite_state',
  'verified_proof_result',
  'professional_standard',
  'professional_standard_evaluation',
  'external_programme',
  'external_plan_approval',
  'capability_history',
  'verified_capability_assessment',
  'completed_mission_history',
  'system_capability_state',
  'proof_capability_state',
  'progress_history',
  'missed_task_history',
  'recovery_history',
  'schedule',
  'available_resources',
  'safety_constraints',
  'verified_preference',
  'analyst_approved_state_change',
  'domain_facts',
]);

export const NON_AUTHORITATIVE_SOURCE_TYPES = Object.freeze([
  'candidate_claim',
  'ai_generated_prose',
  'profile_text',
]);

const SOURCE_TYPES = new Set([...AUTHORITATIVE_SOURCE_TYPES, ...NON_AUTHORITATIVE_SOURCE_TYPES]);
const AUTHORITY_TYPES = new Set([
  'user_confirmed',
  'vision_server',
  'proof_server',
  'professional',
  'analyst_approved',
  'candidate',
  'ai_generated',
  'profile_unverified',
]);
const ACTOR_TYPES = new Set([
  'user',
  'vision',
  'proof_verifier',
  'professional',
  'analyst',
  'candidate',
  'ai',
  'profile',
]);

export const SOURCE_PROVENANCE_MATRIX = deepFreeze({
  user_confirmed_goal: [{ authority: 'user_confirmed', actorType: 'user' }],
  active_milestone: [{ authority: 'vision_server', actorType: 'vision' }],
  route_state: [{ authority: 'vision_server', actorType: 'vision' }],
  prerequisite_state: [{ authority: 'vision_server', actorType: 'vision' }],
  verified_proof_result: [{ authority: 'proof_server', actorType: 'proof_verifier' }],
  professional_standard: [{ authority: 'professional', actorType: 'professional' }],
  professional_standard_evaluation: [{ authority: 'professional', actorType: 'professional' }],
  external_programme: [{ authority: 'professional', actorType: 'professional' }],
  external_plan_approval: [{ authority: 'user_confirmed', actorType: 'user' }],
  capability_history: [{ authority: 'vision_server', actorType: 'vision' }],
  verified_capability_assessment: [{ authority: 'professional', actorType: 'professional' }],
  completed_mission_history: [{ authority: 'vision_server', actorType: 'vision' }],
  system_capability_state: [{ authority: 'vision_server', actorType: 'vision' }],
  proof_capability_state: [
    { authority: 'vision_server', actorType: 'vision' },
    { authority: 'proof_server', actorType: 'proof_verifier' },
  ],
  progress_history: [{ authority: 'vision_server', actorType: 'vision' }],
  missed_task_history: [{ authority: 'vision_server', actorType: 'vision' }],
  recovery_history: [{ authority: 'vision_server', actorType: 'vision' }],
  schedule: [{ authority: 'vision_server', actorType: 'vision' }],
  available_resources: [{ authority: 'vision_server', actorType: 'vision' }],
  safety_constraints: [{ authority: 'vision_server', actorType: 'vision' }],
  verified_preference: [{ authority: 'user_confirmed', actorType: 'user' }],
  analyst_approved_state_change: [{ authority: 'analyst_approved', actorType: 'analyst' }],
  domain_facts: [{ authority: 'vision_server', actorType: 'vision' }],
  candidate_claim: [{ authority: 'candidate', actorType: 'candidate' }],
  ai_generated_prose: [{ authority: 'ai_generated', actorType: 'ai' }],
  profile_text: [{ authority: 'profile_unverified', actorType: 'profile' }],
});

export const SOURCE_AUTHORITY_MATRIX = deepFreeze({
  goal_identity_and_chosen_level: ['user_confirmed_goal'],
  working_level_baseline: [
    'verified_capability_assessment',
    'professional_standard_evaluation',
    'completed_mission_history',
    'system_capability_state',
    'capability_history',
  ],
  active_milestone: ['active_milestone'],
  route_and_prerequisites: ['route_state', 'prerequisite_state'],
  external_plan: ['external_programme'],
  external_plan_approval: ['external_plan_approval'],
  verified_progress_and_proof: [
    'verified_proof_result',
    'professional_standard_evaluation',
    'completed_mission_history',
    'progress_history',
    'missed_task_history',
  ],
  safety_and_legality: ['safety_constraints'],
  time: ['schedule'],
  resources: ['available_resources'],
  recovery: ['recovery_history'],
  preferences: ['verified_preference'],
  proof_capability: ['proof_capability_state'],
  domain_facts: ['domain_facts', 'professional_standard', 'external_programme'],
});

export class TrustedContextValidationError extends Error {
  constructor(errors) {
    super(`Invalid trusted-context assembly input: ${errors.join('; ')}`);
    this.name = 'TrustedContextValidationError';
    this.errors = Object.freeze([...errors]);
  }
}

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

function validTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function validateIdentifier(value, path, errors) {
  if (!isNonEmptyString(value) || !IDENTIFIER_PATTERN.test(value)) {
    errors.push(`${path} must be a snake_case identifier`);
  }
}

function validateProvenance(record, path, errors) {
  if (!exactFields(
    record.provenance,
    ['authority', 'actorType', 'referenceId', 'streamId'],
    `${path}.provenance`,
    errors,
  )) return;
  if (!AUTHORITY_TYPES.has(record.provenance.authority)) {
    errors.push(`${path}.provenance.authority is invalid`);
  }
  if (!ACTOR_TYPES.has(record.provenance.actorType)) {
    errors.push(`${path}.provenance.actorType is invalid`);
  }
  if (!isNonEmptyString(record.provenance.referenceId)) {
    errors.push(`${path}.provenance.referenceId must be a non-empty string`);
  }
  if (!isNonEmptyString(record.provenance.streamId)) {
    errors.push(`${path}.provenance.streamId must be a non-empty string`);
  }
  const allowedPairs = SOURCE_PROVENANCE_MATRIX[record.sourceType] || [];
  if (!allowedPairs.some((pair) => (
    pair.authority === record.provenance.authority
    && pair.actorType === record.provenance.actorType
  ))) {
    errors.push(
      `${path}.provenance authority/actor pair is not permitted for ${record.sourceType}`,
    );
  }
  if (record.provenanceReference !== record.provenance.referenceId) {
    errors.push(`${path}.provenanceReference must equal ${path}.provenance.referenceId`);
  }
}

function validateSourceRecordV2(record, index, evaluationMs, errors) {
  const path = `sourceRecords[${index}]`;
  if (!exactFields(
    record,
    [
      'contractVersion',
      'sourceRecordId',
      'eventId',
      'sourceType',
      'goalId',
      'verificationStatus',
      'sourceSequence',
      'occurredAt',
      'ingestedAt',
      'eventVersion',
      'capturedFacts',
      'provenanceReference',
      'provenance',
      'confidence',
    ],
    path,
    errors,
  )) return;

  if (record.contractVersion !== TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION) {
    errors.push(`${path}.contractVersion must be ${TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION}`);
  }
  for (const field of ['sourceRecordId', 'eventId', 'goalId', 'provenanceReference']) {
    if (!isNonEmptyString(record[field])) errors.push(`${path}.${field} must be a non-empty string`);
  }
  if (!SOURCE_TYPES.has(record.sourceType)) errors.push(`${path}.sourceType is unsupported`);
  if (!VERIFICATION_STATES.has(record.verificationStatus)) {
    errors.push(`${path}.verificationStatus is invalid`);
  }
  if (record.sourceSequence !== null
    && (!Number.isInteger(record.sourceSequence) || record.sourceSequence < 0)) {
    errors.push(`${path}.sourceSequence must be null or a non-negative whole number`);
  }
  if (record.occurredAt !== null && !validTimestamp(record.occurredAt)) {
    errors.push(`${path}.occurredAt must be null or a valid timestamp`);
  }
  if (!validTimestamp(record.ingestedAt)) errors.push(`${path}.ingestedAt must be a valid timestamp`);
  if (!Number.isInteger(record.eventVersion) || record.eventVersion < 1) {
    errors.push(`${path}.eventVersion must be a positive whole number`);
  }
  if (!isPlainObject(record.capturedFacts) || Object.keys(record.capturedFacts).length === 0) {
    errors.push(`${path}.capturedFacts must be a non-empty plain object`);
  }
  if (record.sourceType === 'external_programme'
    && Object.hasOwn(record.capturedFacts, 'changeApproved')) {
    errors.push(`${path}.capturedFacts.changeApproved is forbidden; use external_plan_approval`);
  }
  if (record.confidence !== null
    && (!Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1)) {
    errors.push(`${path}.confidence must be null or a number from 0 to 1`);
  }
  validateProvenance(record, path, errors);

  for (const [field, value] of [['occurredAt', record.occurredAt], ['ingestedAt', record.ingestedAt]]) {
    if (validTimestamp(value) && Date.parse(value) > evaluationMs + MAX_FUTURE_CLOCK_SKEW_MS) {
      errors.push(`${path}.${field} is beyond the allowed future clock skew`);
    }
  }
}

function validateV2(input, errors) {
  if (!exactFields(
    input,
    [
      'contractVersion',
      'contextId',
      'goalId',
      'currentSequence',
      'evaluationTime',
      'userLocalDate',
      'sourceRecords',
    ],
    'assemblyInput',
    errors,
  )) return;
  if (input.contractVersion !== TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION) {
    errors.push(`assemblyInput.contractVersion ${input.contractVersion} is unsupported`);
  }
  validateIdentifier(input.contextId, 'assemblyInput.contextId', errors);
  if (!isNonEmptyString(input.goalId)) errors.push('assemblyInput.goalId must be a non-empty string');
  if (!Number.isInteger(input.currentSequence) || input.currentSequence < 0) {
    errors.push('assemblyInput.currentSequence must be a non-negative whole number');
  }
  if (!validTimestamp(input.evaluationTime)) {
    errors.push('assemblyInput.evaluationTime must be a valid timestamp');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.userLocalDate || '')) {
    errors.push('assemblyInput.userLocalDate must be YYYY-MM-DD');
  }
  if (!Array.isArray(input.sourceRecords)) {
    errors.push('assemblyInput.sourceRecords must be an array');
    return;
  }
  const evaluationMs = Date.parse(input.evaluationTime);
  input.sourceRecords.forEach((record, index) => validateSourceRecordV2(record, index, evaluationMs, errors));
  const ids = input.sourceRecords.map((record) => record?.sourceRecordId).filter(isNonEmptyString);
  if (new Set(ids).size !== ids.length) errors.push('sourceRecords sourceRecordIds must be unique');
}

export function validateTrustedContextAssemblyInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return { valid: false, errors: ['assemblyInput must be a plain object'] };
  const version = Object.hasOwn(input, 'contractVersion') ? input.contractVersion : 1;
  if (!SUPPORTED_SOURCE_CONTRACT_VERSIONS.includes(version)) {
    return { valid: false, errors: [`assemblyInput.contractVersion ${version} is unsupported`] };
  }
  if (version === 1) {
    errors.push('source contract version 1 must be upgraded with upgradeTrustedContextInput');
  } else {
    validateV2(input, errors);
  }
  return { valid: errors.length === 0, errors };
}

export function upgradeTrustedContextInput(input, {
  evaluationTime,
  userLocalDate,
} = {}) {
  if (input?.contractVersion === 2) return structuredClone(input);
  const legacyFields = Object.hasOwn(input || {}, 'contractVersion')
    ? ['contractVersion', 'contextId', 'goalId', 'currentSequence', 'sourceRecords']
    : ['contextId', 'goalId', 'currentSequence', 'sourceRecords'];
  const errors = [];
  exactFields(input, legacyFields, 'assemblyInput', errors);
  if (Object.hasOwn(input || {}, 'contractVersion') && input.contractVersion !== 1) {
    errors.push(`legacy contractVersion ${input.contractVersion} is unsupported`);
  }
  if (!validTimestamp(evaluationTime)) errors.push('legacy upgrade requires explicit evaluationTime');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(userLocalDate || '')) {
    errors.push('legacy upgrade requires userLocalDate YYYY-MM-DD');
  }
  if (!Array.isArray(input?.sourceRecords)) errors.push('legacy sourceRecords must be an array');
  if (errors.length) throw new TrustedContextValidationError(errors);
  return {
    contractVersion: 2,
    contextId: input.contextId,
    goalId: input.goalId,
    currentSequence: input.currentSequence,
    evaluationTime,
    userLocalDate,
    sourceRecords: input.sourceRecords.map((record) => ({
      contractVersion: 2,
      sourceRecordId: record.id,
      eventId: record.id,
      sourceType: record.sourceType,
      goalId: record.goalId,
      verificationStatus: record.verificationStatus,
      sourceSequence: record.sequence,
      occurredAt: record.timestamp,
      ingestedAt: record.timestamp || evaluationTime,
      eventVersion: 1,
      capturedFacts: structuredClone(record.capturedFacts),
      provenanceReference: record.provenance.referenceId,
      provenance: {
        ...structuredClone(record.provenance),
        streamId: `${record.sourceType}:${record.goalId}`,
      },
      confidence: record.confidence,
    })),
  };
}

export function assertValidTrustedContextAssemblyInput(input) {
  const result = validateTrustedContextAssemblyInput(input);
  if (!result.valid) throw new TrustedContextValidationError(result.errors);
}

export function isAuthoritativeSourceType(sourceType) {
  return AUTHORITATIVE_SOURCE_TYPES.includes(sourceType);
}

export function isGoalRole(value) {
  return GOAL_ROLES.has(value);
}

export function isAssemblyState(value) {
  return ASSEMBLY_STATES.has(value);
}

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
