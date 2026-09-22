import {
  assertNoStrategySmuggling,
  validateEvidenceRef,
  validateObjectRef,
} from './contracts.js';

const RELATIONSHIP_ID_RE = /^or:v1:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_RE = /^(?:sha256:[0-9a-f]{64}|md5:[0-9a-f]{32})$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const RELATIONSHIP_EPISTEMIC_STATUSES = Object.freeze([
  'SUPPORTED', 'PROVISIONAL', 'DISPUTED', 'CONTRADICTED', 'RETRACTED',
]);

export const RELATIONSHIP_VERIFICATION_STATUSES = Object.freeze([
  'UNVERIFIED', 'EVIDENCE_BACKED', 'OWNER_CONFIRMED', 'SYSTEM_VERIFIED',
]);

const predicate = (subjectKind, objectKind, logicalWriter, available) => Object.freeze({
  subjectKind,
  objectKind,
  logicalWriter,
  minimumEvidenceRefs: 1,
  temporalSemantics: 'RECORDED_AND_EFFECTIVE_INTERVAL',
  correctionSemantics: 'APPEND_SUCCESSOR',
  retractionSemantics: 'APPEND_RETRACTED_SUCCESSOR',
  allowedReaders: Object.freeze(['VENTURE_OWNER']),
  forbiddenWriters: Object.freeze(['ANON', 'AUTHENTICATED_DIRECT_DML', 'SERVICE_ROLE', 'NON_OWNER']),
  available,
});

export const ONTOLOGY_RELATIONSHIP_PREDICATES = Object.freeze({
  DECISION_OBSERVED_COMPANY_STATE: predicate('DECISION', 'STATE_VERSION', 'DEMIGOD', false),
  DECISION_RELIED_ON_CLAIM: predicate('DECISION', 'CLAIM', 'DEMIGOD', false),
  DECISION_EXPECTED_OUTCOME: predicate('DECISION', 'EXPECTED_OUTCOME', 'DEMIGOD', false),
  DECISION_RESULTED_IN_ACTION: predicate('DECISION', 'ACTION', 'DEMIGOD', false),
  ACTION_AFFECTED_ENTITY: predicate('ACTION', 'ENTITY', 'FOUNDER_WORK', true),
  ACTUAL_OUTCOME_EVALUATED_EXPECTED_OUTCOME: predicate('ACTUAL_OUTCOME', 'EXPECTED_OUTCOME', 'OUTCOME_LEARNING', false),
  CLAIM_CONTRADICTS_CLAIM: predicate('CLAIM', 'CLAIM', 'CONTRADICTION_COMPILER', false),
});

function fail(message) {
  throw new TypeError(message);
}

function exactObject(value, required, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const expected = new Set(required);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) fail(`${label}.${key} is not allowed`);
}

function iso(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO-compatible timestamp`);
}

export function relationshipPredicate(predicateId) {
  const contract = ONTOLOGY_RELATIONSHIP_PREDICATES[predicateId];
  if (!contract) fail('predicateId is not in the closed Ontology V1 relationship registry');
  return contract;
}

export function validateRelationshipSourceVersion(sourceVersion, expectedWriter) {
  exactObject(sourceVersion, ['schemaVersion', 'writerVersion', 'contentHash'], 'RelationshipSourceVersionV1');
  if (sourceVersion.schemaVersion !== 'ontology.relationship.v1') fail('sourceVersion.schemaVersion is invalid');
  if (sourceVersion.writerVersion !== `${expectedWriter}:v1`) fail('sourceVersion.writerVersion does not match predicate authority');
  if (!HASH_RE.test(sourceVersion.contentHash)) fail('sourceVersion.contentHash is invalid');
  assertNoStrategySmuggling(sourceVersion, 'sourceVersion');
  return Object.freeze(structuredClone(sourceVersion));
}

export function validateOntologyRelationship(input) {
  exactObject(input, [
    'relationshipId', 'ventureId', 'predicateId', 'subjectRef', 'objectRef',
    'ownerSystem', 'evidenceRefs', 'epistemicStatus', 'verificationStatus',
    'confidence', 'effectiveFrom', 'effectiveTo', 'recordedAt',
    'supersedesRelationshipId', 'sourceVersion',
  ], 'OntologyRelationshipV1');

  if (typeof input.relationshipId !== 'string' || !RELATIONSHIP_ID_RE.test(input.relationshipId)) {
    fail('relationshipId must be or:v1:<lowercase-uuidv7>');
  }
  if (typeof input.ventureId !== 'string' || input.ventureId.trim() === '') fail('ventureId is invalid');
  const contract = relationshipPredicate(input.predicateId);
  const subject = validateObjectRef(input.subjectRef);
  const object = validateObjectRef(input.objectRef);
  if (subject.kind !== contract.subjectKind || object.kind !== contract.objectKind) fail('relationship endpoint kind mismatch');
  if (subject.ventureId !== input.ventureId || object.ventureId !== input.ventureId) fail('relationship contains a cross-venture endpoint');
  if (input.ownerSystem !== contract.logicalWriter) fail('relationship ownerSystem does not match its logical writer');
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length < contract.minimumEvidenceRefs || input.evidenceRefs.length > 32) {
    fail('relationship evidence requirement is not satisfied');
  }
  for (const evidence of input.evidenceRefs) {
    validateEvidenceRef(evidence);
    if (evidence.evidenceRef.ventureId !== input.ventureId) fail('relationship contains cross-venture evidence');
  }
  if (!RELATIONSHIP_EPISTEMIC_STATUSES.includes(input.epistemicStatus)) fail('epistemicStatus is invalid');
  if (!RELATIONSHIP_VERIFICATION_STATUSES.includes(input.verificationStatus)) fail('verificationStatus is invalid');
  if (input.confidence !== null && (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1)) fail('confidence is invalid');
  iso(input.effectiveFrom, 'effectiveFrom');
  iso(input.effectiveTo, 'effectiveTo', true);
  iso(input.recordedAt, 'recordedAt');
  if (input.effectiveTo !== null && Date.parse(input.effectiveTo) <= Date.parse(input.effectiveFrom)) fail('effective interval is invalid');
  if (input.supersedesRelationshipId !== null) {
    if (typeof input.supersedesRelationshipId !== 'string' || !RELATIONSHIP_ID_RE.test(input.supersedesRelationshipId)
      || input.supersedesRelationshipId === input.relationshipId) fail('supersedesRelationshipId is invalid');
  }
  validateRelationshipSourceVersion(input.sourceVersion, contract.logicalWriter);
  assertNoStrategySmuggling(input, 'OntologyRelationshipV1');
  return Object.freeze(structuredClone(input));
}

export function relationshipAvailability(predicateId) {
  const contract = relationshipPredicate(predicateId);
  return Object.freeze({
    predicateId,
    status: contract.available ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: contract.available ? null : 'LOGICAL_WRITER_NOT_CANONICAL',
  });
}

export function assertRelationshipWriteResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('relationship write returned an invalid response');
  if (!['CREATED', 'IDEMPOTENT_REPLAY', 'SUPERSEDED', 'RETRACTED'].includes(result.status)) {
    fail(`relationship write failed closed: ${String(result.status)}`);
  }
  return result;
}

export function validateRelationshipRefVersion(value, label = 'version') {
  if (value !== null && (typeof value !== 'string' || !VERSION_RE.test(value))) fail(`${label} is invalid`);
  return value;
}
