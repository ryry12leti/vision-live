const CONTRACT_VERSION = 'ontology.v1';

export const OBJECT_KINDS = Object.freeze([
  'ENTITY', 'CLAIM', 'EVIDENCE', 'EVENT', 'STATE_VERSION',
  'DECISION', 'ACTION', 'EXPECTED_OUTCOME', 'ACTUAL_OUTCOME', 'LEARNING',
]);
export const PRIVACY_CLASSES = Object.freeze([
  'PUBLIC', 'VENTURE_PRIVATE', 'PII_RESTRICTED', 'HIGHLY_RESTRICTED', 'PROHIBITED',
]);
export const READ_STATUSES = Object.freeze(['PRESENT', 'UNKNOWN', 'NOT_CONSULTED', 'UNAVAILABLE', 'READ_FAILED']);
export const HISTORY_COMPLETENESS = Object.freeze(['COMPLETE', 'INCOMPLETE']);

export const OWNER_SYSTEMS = Object.freeze({
  ONTOLOGY_IDENTITY: Object.freeze({ id: 'ONTOLOGY_IDENTITY', canonical: true, available: true }),
  FOUNDER_STATE: Object.freeze({ id: 'FOUNDER_STATE', canonical: true, available: true }),
  FOUNDER_WORK: Object.freeze({ id: 'FOUNDER_WORK', canonical: true, available: true }),
  ACTIVE_OUTCOME: Object.freeze({ id: 'ACTIVE_OUTCOME', canonical: true, available: true }),
  OPPORTUNITY_INTELLIGENCE: Object.freeze({ id: 'OPPORTUNITY_INTELLIGENCE', canonical: true, available: true }),
  TRENDS: Object.freeze({ id: 'TRENDS', canonical: false, available: false }),
  TERRA: Object.freeze({ id: 'TERRA', canonical: false, available: false }),
  PI: Object.freeze({ id: 'PI', canonical: false, available: false }),
  OUTCOME_LEARNING: Object.freeze({ id: 'OUTCOME_LEARNING', canonical: false, available: false }),
});

const FORBIDDEN_NORMALIZED = Object.freeze([
  'recommendedaction', 'shouldact', 'strategicpriority', 'candidatewinner',
  'beststrategy', 'todaysmove', 'executionpriority', 'recommendednextstep',
  'prioritychoice', 'preferredcandidate', 'actnow', 'optimalstrategy',
]);
const PII_PATTERN = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\s().-]*){8,}\d\b)/i;

function fail(message) {
  throw new TypeError(message);
}

function normalized(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertExactFields(value, required, optional = [], label = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  for (const key of keys) if (!allowed.has(key)) fail(`${label}.${key} is not allowed`);
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`);
}

function assertIso(value, label, nullable = false) {
  if (nullable && value === null) return;
  assertString(value, label);
  if (Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO-compatible timestamp`);
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) fail(`${label} is invalid`);
}

export function assertNoStrategySmuggling(value, path = '$', seen = new WeakSet()) {
  if (typeof value === 'string') {
    const compact = normalized(value);
    if (FORBIDDEN_NORMALIZED.some((term) => compact.includes(term))) fail(`${path} contains forbidden strategy authority`);
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { assertNoStrategySmuggling(JSON.parse(trimmed), `${path}<json>`, seen); } catch (error) {
        if (error instanceof SyntaxError) return;
        throw error;
      }
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) fail(`${path} contains a cyclic value`);
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_NORMALIZED.includes(normalized(key))) fail(`${path}.${key} is a forbidden strategy field`);
    assertNoStrategySmuggling(nested, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

export function assertPrivacyAllowed(privacyClass, scalar = undefined) {
  assertEnum(privacyClass, PRIVACY_CLASSES, 'privacyClass');
  if (['PII_RESTRICTED', 'HIGHLY_RESTRICTED', 'PROHIBITED'].includes(privacyClass)) {
    fail(`${privacyClass} content cannot cross the Phase 0 ontology seam`);
  }
  if (typeof scalar === 'string' && PII_PATTERN.test(scalar)) fail('PII-like scalar content is rejected');
}

export function validateObjectRef(ref) {
  assertExactFields(ref, ['contractVersion', 'kind', 'ventureId', 'ownerSystem', 'namespace', 'localId', 'version', 'contentHash'], [], 'OntologyObjectRefV1');
  if (ref.contractVersion !== CONTRACT_VERSION) fail('OntologyObjectRefV1.contractVersion is invalid');
  assertEnum(ref.kind, OBJECT_KINDS, 'OntologyObjectRefV1.kind');
  assertString(ref.ventureId, 'OntologyObjectRefV1.ventureId');
  if (!OWNER_SYSTEMS[ref.ownerSystem]) fail('OntologyObjectRefV1.ownerSystem is invalid');
  assertString(ref.namespace, 'OntologyObjectRefV1.namespace');
  assertString(ref.localId, 'OntologyObjectRefV1.localId');
  if (PII_PATTERN.test(ref.ventureId) || PII_PATTERN.test(ref.namespace) || PII_PATTERN.test(ref.localId)) fail('OntologyObjectRefV1 contains PII-like identifiers');
  if (ref.version !== null) assertString(ref.version, 'OntologyObjectRefV1.version');
  if (ref.contentHash !== null) assertString(ref.contentHash, 'OntologyObjectRefV1.contentHash');
  assertNoStrategySmuggling(ref);
  return Object.freeze(structuredClone(ref));
}

export function objectRef(input) {
  return validateObjectRef({ contractVersion: CONTRACT_VERSION, version: null, contentHash: null, ...input });
}

function validateClaimValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('OntologyClaimV1.value must be an object');
  if (value.type === 'REF') {
    assertExactFields(value, ['type', 'ref'], [], 'OntologyClaimV1.value');
    validateObjectRef(value.ref);
  } else if (value.type === 'REDACTED_SCALAR') {
    assertExactFields(value, ['type', 'value'], [], 'OntologyClaimV1.value');
    if (!['string', 'number', 'boolean'].includes(typeof value.value)) fail('REDACTED_SCALAR value is invalid');
    if (typeof value.value === 'string' && value.value.length > 512) fail('REDACTED_SCALAR is too long');
  } else if (value.type === 'NONE' || value.type === 'UNKNOWN') {
    assertExactFields(value, ['type'], [], 'OntologyClaimV1.value');
  } else fail('OntologyClaimV1.value.type is invalid');
}

export function validateEvidenceRef(evidence) {
  assertExactFields(evidence, ['contractVersion', 'evidenceRef', 'ownerSystem', 'nativeEvidenceId', 'nativeVersion', 'contentHash', 'fingerprint', 'observer', 'provider', 'observedAt', 'recordedAt', 'evidenceClass', 'trustClass', 'privacyClass'], [], 'OntologyEvidenceRefV1');
  if (evidence.contractVersion !== CONTRACT_VERSION) fail('OntologyEvidenceRefV1.contractVersion is invalid');
  validateObjectRef(evidence.evidenceRef);
  if (!OWNER_SYSTEMS[evidence.ownerSystem] || evidence.evidenceRef.ownerSystem !== evidence.ownerSystem) fail('OntologyEvidenceRefV1 owner-system mismatch');
  for (const field of ['nativeEvidenceId', 'fingerprint', 'observer', 'provider', 'evidenceClass', 'trustClass']) assertString(evidence[field], `OntologyEvidenceRefV1.${field}`);
  if (PII_PATTERN.test(evidence.nativeEvidenceId) || PII_PATTERN.test(evidence.fingerprint) || PII_PATTERN.test(evidence.observer) || PII_PATTERN.test(evidence.provider)) fail('OntologyEvidenceRefV1 contains PII-like identifiers');
  if (evidence.nativeVersion !== null) assertString(evidence.nativeVersion, 'OntologyEvidenceRefV1.nativeVersion');
  if (evidence.contentHash !== null) assertString(evidence.contentHash, 'OntologyEvidenceRefV1.contentHash');
  assertIso(evidence.observedAt, 'OntologyEvidenceRefV1.observedAt');
  assertIso(evidence.recordedAt, 'OntologyEvidenceRefV1.recordedAt');
  assertPrivacyAllowed(evidence.privacyClass);
  assertNoStrategySmuggling(evidence);
  return Object.freeze(structuredClone(evidence));
}

export function validateClaim(claim) {
  assertExactFields(claim, ['contractVersion', 'claimRef', 'ownerSystem', 'subjectRef', 'claimType', 'value', 'epistemicStatus', 'verificationStatus', 'confidence', 'occurredAt', 'observedAt', 'recordedAt', 'freshness', 'evidenceRefs', 'contradictionRefs', 'sourceVersion', 'privacyClass'], [], 'OntologyClaimV1');
  if (claim.contractVersion !== CONTRACT_VERSION) fail('OntologyClaimV1.contractVersion is invalid');
  validateObjectRef(claim.claimRef);
  validateObjectRef(claim.subjectRef);
  if (!OWNER_SYSTEMS[claim.ownerSystem] || claim.claimRef.ownerSystem !== claim.ownerSystem || claim.subjectRef.ownerSystem !== claim.ownerSystem) fail('OntologyClaimV1 owner-system mismatch');
  if (claim.claimRef.ventureId !== claim.subjectRef.ventureId) fail('OntologyClaimV1 cross-venture reference');
  assertString(claim.claimType, 'OntologyClaimV1.claimType');
  validateClaimValue(claim.value);
  assertEnum(claim.epistemicStatus, ['OBSERVED', 'INFERRED', 'ASSERTED', 'UNKNOWN'], 'OntologyClaimV1.epistemicStatus');
  assertEnum(claim.verificationStatus, ['VERIFIED', 'UNVERIFIED', 'DISPUTED', 'UNKNOWN'], 'OntologyClaimV1.verificationStatus');
  if (typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) fail('OntologyClaimV1.confidence is invalid');
  assertIso(claim.occurredAt, 'OntologyClaimV1.occurredAt', true);
  assertIso(claim.observedAt, 'OntologyClaimV1.observedAt');
  assertIso(claim.recordedAt, 'OntologyClaimV1.recordedAt');
  assertExactFields(claim.freshness, ['status', 'asOf'], [], 'OntologyClaimV1.freshness');
  assertEnum(claim.freshness.status, ['CURRENT', 'STALE', 'UNKNOWN'], 'OntologyClaimV1.freshness.status');
  assertIso(claim.freshness.asOf, 'OntologyClaimV1.freshness.asOf', true);
  for (const field of ['evidenceRefs', 'contradictionRefs']) {
    if (!Array.isArray(claim[field])) fail(`OntologyClaimV1.${field} must be an array`);
    claim[field].forEach((ref) => {
      validateObjectRef(ref);
      if (ref.ventureId !== claim.claimRef.ventureId) fail(`OntologyClaimV1.${field} contains a cross-venture reference`);
    });
  }
  if (claim.sourceVersion !== null) assertString(claim.sourceVersion, 'OntologyClaimV1.sourceVersion');
  assertPrivacyAllowed(claim.privacyClass, claim.value.type === 'REDACTED_SCALAR' ? claim.value.value : undefined);
  assertNoStrategySmuggling(claim);
  return Object.freeze(structuredClone(claim));
}

export function claim(input) {
  return validateClaim({ contractVersion: CONTRACT_VERSION, ...input });
}

export function validateReadRequest(request) {
  assertExactFields(request, ['ventureId', 'asOf'], ['requestedNativeVersion', 'expectedContentHash'], 'readAsOf request');
  assertString(request.ventureId, 'readAsOf.ventureId');
  assertIso(request.asOf, 'readAsOf.asOf');
  if (request.requestedNativeVersion !== undefined) assertString(request.requestedNativeVersion, 'readAsOf.requestedNativeVersion');
  if (request.expectedContentHash !== undefined) assertString(request.expectedContentHash, 'readAsOf.expectedContentHash');
  assertNoStrategySmuggling(request);
  return Object.freeze(structuredClone(request));
}

export function contractVersion() { return CONTRACT_VERSION; }
