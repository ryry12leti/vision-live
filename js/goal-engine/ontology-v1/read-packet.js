import { assertNoStrategySmuggling, assertPrivacyAllowed } from './contracts.js';
import { COMPANY_STATE_COMPONENT_REGISTRY, validateCompanyStateComponent } from './company-state.js';

export const ONTOLOGY_READ_PACKET_VERSION = 'ontology-read-packet/v1';
export const ONTOLOGY_READ_LIMITS = Object.freeze({
  maxEntities: 50,
  maxClaims: 50,
  maxEvidenceRefs: 100,
  maxRelationships: 100,
  maxDepth: 1,
});
export const SOURCE_RESOLUTION_STATUSES = Object.freeze([
  'VERIFIED', 'UNKNOWN', 'NOT_CONSULTED', 'UNAVAILABLE', 'READ_FAILED', 'SOURCE_VERSION_MISMATCH',
]);

const TOP_FIELDS = Object.freeze([
  'contractVersion', 'status', 'ventureId', 'companyStateVersionId', 'manifestHash', 'asOf',
  'components', 'entityRefs', 'claimViews', 'evidenceViews', 'relationships', 'contradictions',
  'viewStatus', 'historyCompleteness', 'limits',
]);
const COMPONENT_FIELDS = Object.freeze([
  'componentType', 'ownerSystem', 'nativeStateId', 'nativeVersionId', 'watermark', 'schemaVersion',
  'contentHash', 'asOf', 'consultationStatus', 'readStatus', 'historyCompleteness', 'reasonCode',
  'sourceResolutionStatus', 'resolutionReasonCode',
]);
const ENTITY_FIELDS = Object.freeze([
  'entityId', 'entityType', 'entityStatus', 'entityVersion', 'resolutionStatus',
  'historyCompleteness', 'recordedAt',
]);
const CLAIM_FIELDS = Object.freeze([
  'claimRef', 'subjectRef', 'ownerSystem', 'claimType', 'epistemicStatus', 'verificationStatus',
  'confidence', 'occurredAt', 'recordedAt', 'freshness', 'evidenceRefs', 'contradictionRefs',
  'sourceVersion', 'privacyClass',
]);
const EVIDENCE_FIELDS = Object.freeze([
  'evidenceRef', 'ownerSystem', 'nativeEvidenceId', 'nativeVersion', 'contentHash', 'fingerprint',
  'observedAt', 'recordedAt', 'evidenceClass', 'trustClass', 'privacyClass',
]);
const RELATIONSHIP_FIELDS = Object.freeze([
  'relationshipId', 'predicateId', 'subjectRef', 'objectRef', 'ownerSystem', 'epistemicStatus',
  'verificationStatus', 'confidence', 'effectiveFrom', 'effectiveTo', 'recordedAt',
  'sourceVersion', 'evidenceRefs',
]);
const CONTRADICTION_FIELDS = Object.freeze(['contradictionRef', 'claimRefs', 'status', 'reasonCode']);
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const VERSION_ID_RE = /^csv:v1:[0-9a-f]{64}$/;
const REF_RE = /^(?:claim|evidence|contradiction):v1:(?:k1:)?[0-9a-f]{64}$/;
const FACT_WATERMARK_RE = /^wm:v1:k1:[0-9a-f]{64}@[1-9][0-9]*$/;

function fail(message) { throw new TypeError(message); }
function plain(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
}
function exact(value, fields, label) {
  plain(value, label);
  for (const field of fields) if (!Object.hasOwn(value, field)) fail(`${label}.${field} is required`);
  for (const field of Object.keys(value)) if (!fields.includes(field)) fail(`${label}.${field} is not allowed`);
}
function iso(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail(`${label} must be UTC ISO-8601 with millisecond precision`);
  }
}
function boundedArray(value, max, label) {
  if (!Array.isArray(value) || value.length > max) fail(`${label} exceeds its bounded array contract`);
}
function reference(value, kind, label) {
  if (typeof value !== 'string' || (kind === 'venture' ? !value.startsWith('venture:v1:') : !REF_RE.test(value))) {
    fail(`${label} is invalid`);
  }
}
function piiSafe(value, label) {
  if (typeof value !== 'string') fail(`${label} is invalid`);
  if (/^(?:o[er]:v1:[0-9a-f-]+|[0-9a-f]{8}-[0-9a-f-]{27}|(?:sha256|md5):[0-9a-f]+|(?:claim|evidence|contradiction|fact-ref):v1:(?:k1:)?[0-9a-f]+|wm:v1:k1:[0-9a-f]{64}@[1-9][0-9]*)$/i.test(value)) return;
  assertPrivacyAllowed('VENTURE_PRIVATE', value);
}
function endpoint(value, label) {
  exact(value, ['kind', 'ownerSystem', 'namespace', 'localId', 'version', 'contentHash'], label);
  for (const field of ['kind', 'ownerSystem', 'namespace', 'localId']) {
    if (typeof value[field] !== 'string' || !value[field]) fail(`${label}.${field} is invalid`);
    piiSafe(value[field], `${label}.${field}`);
  }
  if (value.version !== null && typeof value.version !== 'string') fail(`${label}.version is invalid`);
  if (value.contentHash !== null && !/^(?:sha256:[0-9a-f]{64}|md5:[0-9a-f]{32})$/.test(value.contentHash)) fail(`${label}.contentHash is invalid`);
}

export function validateOntologyReadPacket(packet) {
  exact(packet, TOP_FIELDS, 'OntologyReadPacketV1');
  if (packet.contractVersion !== ONTOLOGY_READ_PACKET_VERSION) fail('read packet contractVersion is invalid');
  if (!['PRESENT', 'INCOMPLETE'].includes(packet.status)) fail('read packet status is invalid');
  if (typeof packet.ventureId !== 'string' || !packet.ventureId) fail('read packet ventureId is invalid');
  piiSafe(packet.ventureId, 'read packet ventureId');
  if (!VERSION_ID_RE.test(packet.companyStateVersionId)) fail('read packet companyStateVersionId is invalid');
  if (!HASH_RE.test(packet.manifestHash)) fail('read packet manifestHash is invalid');
  iso(packet.asOf, 'read packet asOf');
  if (!Array.isArray(packet.components) || packet.components.length !== COMPANY_STATE_COMPONENT_REGISTRY.length) fail('read packet requires ten component statuses');
  packet.components.forEach((component, index) => {
    exact(component, COMPONENT_FIELDS, `components[${index}]`);
    const frozen = Object.fromEntries(Object.entries(component).filter(([key]) => !['sourceResolutionStatus', 'resolutionReasonCode'].includes(key)));
    validateCompanyStateComponent(frozen, index);
    const watermarkValues = component.watermark === null ? [] : Array.isArray(component.watermark) ? component.watermark : [component.watermark];
    watermarkValues.forEach((value) => piiSafe(value, `components[${index}].watermark`));
    if (component.componentType === 'FOUNDER_ENTITIES_FACTS'
      && component.readStatus === 'PRESENT'
      && !watermarkValues.every((value) => FACT_WATERMARK_RE.test(value))) {
      fail('founder fact watermark is not a keyed pseudonym');
    }
    if (!SOURCE_RESOLUTION_STATUSES.includes(component.sourceResolutionStatus)) fail('component sourceResolutionStatus is invalid');
    if (component.readStatus !== 'PRESENT' && component.sourceResolutionStatus !== component.readStatus) fail('non-present frozen status cannot be upgraded');
    if (component.readStatus === 'PRESENT' && !['VERIFIED', 'SOURCE_VERSION_MISMATCH', 'READ_FAILED'].includes(component.sourceResolutionStatus)) fail('present component resolution is invalid');
    if (component.resolutionReasonCode !== null && typeof component.resolutionReasonCode !== 'string') fail('component resolutionReasonCode is invalid');
  });

  boundedArray(packet.entityRefs, ONTOLOGY_READ_LIMITS.maxEntities, 'entityRefs');
  packet.entityRefs.forEach((entity, index) => {
    exact(entity, ENTITY_FIELDS, `entityRefs[${index}]`);
    if (typeof entity.entityId !== 'string' || typeof entity.entityType !== 'string') fail('entity reference is invalid');
    piiSafe(entity.entityId, 'entityId'); piiSafe(entity.entityType, 'entityType');
    if (!['ACTIVE', 'RETIRED'].includes(entity.entityStatus) || !Number.isInteger(Number(entity.entityVersion))) fail('entity state is invalid');
    if (entity.resolutionStatus !== 'PRESENT' || entity.historyCompleteness !== 'COMPLETE') fail('unproven entity history cannot be exposed');
    iso(entity.recordedAt, 'entity recordedAt');
  });

  boundedArray(packet.claimViews, ONTOLOGY_READ_LIMITS.maxClaims, 'claimViews');
  packet.claimViews.forEach((claim, index) => {
    exact(claim, CLAIM_FIELDS, `claimViews[${index}]`);
    reference(claim.claimRef, 'claim', 'claimRef'); reference(claim.subjectRef, 'venture', 'subjectRef');
    if (!['FOUNDER_STATE', 'OUTCOME_LEARNING'].includes(claim.ownerSystem) || typeof claim.claimType !== 'string') fail('claim owner/type is invalid');
    piiSafe(claim.claimType, 'claimType');
    if (!['OBSERVED', 'ASSERTED', 'UNKNOWN'].includes(claim.epistemicStatus)) fail('claim epistemicStatus is invalid');
    if (!['VERIFIED', 'UNVERIFIED', 'DISPUTED', 'UNKNOWN'].includes(claim.verificationStatus)) fail('claim verificationStatus is invalid');
    if (typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) fail('claim confidence is invalid');
    iso(claim.occurredAt, 'claim occurredAt'); iso(claim.recordedAt, 'claim recordedAt');
    exact(claim.freshness, ['status', 'asOf'], 'claim freshness');
    if (!['CURRENT', 'STALE', 'UNKNOWN'].includes(claim.freshness.status)) fail('claim freshness status is invalid');
    iso(claim.freshness.asOf, 'claim freshness asOf');
    boundedArray(claim.evidenceRefs, ONTOLOGY_READ_LIMITS.maxEvidenceRefs, 'claim evidenceRefs');
    boundedArray(claim.contradictionRefs, ONTOLOGY_READ_LIMITS.maxClaims, 'claim contradictionRefs');
    claim.evidenceRefs.forEach((ref) => reference(ref, 'evidence', 'claim evidenceRef'));
    claim.contradictionRefs.forEach((ref) => reference(ref, 'contradiction', 'claim contradictionRef'));
    if (!['PUBLIC', 'VENTURE_PRIVATE'].includes(claim.privacyClass)) fail('claim privacy is not permitted');
  });

  boundedArray(packet.evidenceViews, ONTOLOGY_READ_LIMITS.maxEvidenceRefs, 'evidenceViews');
  packet.evidenceViews.forEach((evidence, index) => {
    exact(evidence, EVIDENCE_FIELDS, `evidenceViews[${index}]`);
    reference(evidence.evidenceRef, 'evidence', 'evidenceRef');
    if (typeof evidence.nativeEvidenceId !== 'string' || typeof evidence.nativeVersion !== 'string' || !HASH_RE.test(evidence.contentHash)) fail('evidence native reference is invalid');
    piiSafe(evidence.nativeEvidenceId, 'nativeEvidenceId'); piiSafe(evidence.nativeVersion, 'nativeVersion'); piiSafe(evidence.fingerprint, 'fingerprint');
    iso(evidence.observedAt, 'evidence observedAt'); iso(evidence.recordedAt, 'evidence recordedAt');
    if (!['PUBLIC', 'VENTURE_PRIVATE'].includes(evidence.privacyClass)) fail('evidence privacy is not permitted');
  });

  boundedArray(packet.relationships, ONTOLOGY_READ_LIMITS.maxRelationships, 'relationships');
  packet.relationships.forEach((relationship, index) => {
    exact(relationship, RELATIONSHIP_FIELDS, `relationships[${index}]`);
    endpoint(relationship.subjectRef, 'relationship subjectRef'); endpoint(relationship.objectRef, 'relationship objectRef');
    if (typeof relationship.relationshipId !== 'string' || typeof relationship.predicateId !== 'string') fail('relationship identity is invalid');
    piiSafe(relationship.relationshipId, 'relationshipId'); piiSafe(relationship.predicateId, 'predicateId');
    iso(relationship.effectiveFrom, 'relationship effectiveFrom'); iso(relationship.effectiveTo, 'relationship effectiveTo', true); iso(relationship.recordedAt, 'relationship recordedAt');
    boundedArray(relationship.evidenceRefs, ONTOLOGY_READ_LIMITS.maxEvidenceRefs, 'relationship evidenceRefs');
    relationship.evidenceRefs.forEach((ref) => reference(ref, 'evidence', 'relationship evidenceRef'));
    exact(relationship.sourceVersion, ['schemaVersion', 'writerVersion', 'contentHash'], 'relationship sourceVersion');
  });

  boundedArray(packet.contradictions, ONTOLOGY_READ_LIMITS.maxClaims, 'contradictions');
  packet.contradictions.forEach((contradiction, index) => {
    exact(contradiction, CONTRADICTION_FIELDS, `contradictions[${index}]`);
    reference(contradiction.contradictionRef, 'contradiction', 'contradictionRef');
    if (!Array.isArray(contradiction.claimRefs) || contradiction.claimRefs.length < 2 || contradiction.claimRefs.length > ONTOLOGY_READ_LIMITS.maxClaims) fail('contradiction claimRefs are invalid');
    contradiction.claimRefs.forEach((ref) => reference(ref, 'claim', 'contradiction claimRef'));
    if (contradiction.status !== 'OPEN' || contradiction.reasonCode !== 'CONFLICTING_ACTIVE_CLAIMS') fail('contradiction state is invalid');
  });

  exact(packet.viewStatus, ['status', 'reasonCode'], 'viewStatus');
  if (!['PRESENT', 'UNAVAILABLE', 'READ_FAILED'].includes(packet.viewStatus.status)) fail('viewStatus is invalid');
  if (!['COMPLETE', 'INCOMPLETE'].includes(packet.historyCompleteness)) fail('historyCompleteness is invalid');
  exact(packet.limits, Object.keys(ONTOLOGY_READ_LIMITS), 'limits');
  if (JSON.stringify(packet.limits) !== JSON.stringify(ONTOLOGY_READ_LIMITS)) fail('read limits do not match the locked bounds');
  assertNoStrategySmuggling(packet, 'OntologyReadPacketV1');
  return Object.freeze(structuredClone(packet));
}

export function createOntologyReadPacket({ manifest, components, views }) {
  const safeViews = views?.status === 'PRESENT' ? views : {
    entityRefs: [], claimViews: [], evidenceViews: [], relationships: [], contradictions: [],
    entityHistoryCompleteness: 'INCOMPLETE',
  };
  const incomplete = components.some((component) => component.historyCompleteness === 'INCOMPLETE'
    || !['VERIFIED', 'UNKNOWN', 'NOT_CONSULTED'].includes(component.sourceResolutionStatus))
    || views?.status !== 'PRESENT' || safeViews.entityHistoryCompleteness !== 'COMPLETE';
  return validateOntologyReadPacket({
    contractVersion: ONTOLOGY_READ_PACKET_VERSION,
    status: incomplete ? 'INCOMPLETE' : 'PRESENT',
    ventureId: manifest.ventureId,
    companyStateVersionId: manifest.companyStateVersionId,
    manifestHash: manifest.manifestHash,
    asOf: manifest.asOf,
    components,
    entityRefs: safeViews.entityRefs ?? [],
    claimViews: safeViews.claimViews ?? [],
    evidenceViews: safeViews.evidenceViews ?? [],
    relationships: safeViews.relationships ?? [],
    contradictions: safeViews.contradictions ?? [],
    viewStatus: views?.status === 'PRESENT' ? { status: 'PRESENT', reasonCode: null }
      : { status: views?.status === 'READ_FAILED' ? 'READ_FAILED' : 'UNAVAILABLE', reasonCode: views?.reasonCode ?? 'BOUNDED_VIEWS_UNAVAILABLE' },
    historyCompleteness: incomplete ? 'INCOMPLETE' : 'COMPLETE',
    limits: ONTOLOGY_READ_LIMITS,
  });
}
