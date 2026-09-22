import { CONTEXT_FUSION_CONTRACT_VERSION, contextIdFor, validateOntologyFusedContext, assertPacketForContextFusion } from './contract.js';
import { CONTEXT_FUSION_AUTHORITY } from './authority.js';

export function compileOntologyFusedContext(packetInput) {
  const packet = assertPacketForContextFusion(packetInput);
  const componentStatuses = packet.components.map((component) => Object.freeze({
    componentType: component.componentType,
    ownerSystem: component.ownerSystem,
    consultationStatus: component.consultationStatus,
    readStatus: component.readStatus,
    historyCompleteness: component.historyCompleteness,
    sourceResolutionStatus: component.sourceResolutionStatus,
    reasonCode: component.resolutionReasonCode ?? component.reasonCode,
  }));
  const sourceReferences = [
    ...packet.entityRefs.map((entry) => ({ kind: 'ENTITY', ref: entry.entityId, ownerSystem: 'ONTOLOGY_IDENTITY', verificationStatus: 'SYSTEM_VERIFIED', confidence: null, freshness: 'HISTORICAL', privacyClass: 'VENTURE_PRIVATE', sourceStatus: entry.resolutionStatus })),
    ...packet.claimViews.map((entry) => ({ kind: 'CLAIM', ref: entry.claimRef, ownerSystem: entry.ownerSystem, verificationStatus: entry.verificationStatus, confidence: entry.confidence, freshness: entry.freshness.status, privacyClass: entry.privacyClass, sourceStatus: 'PRESENT' })),
    ...packet.evidenceViews.map((entry) => ({ kind: 'EVIDENCE', ref: entry.evidenceRef, ownerSystem: entry.ownerSystem, verificationStatus: entry.trustClass, confidence: null, freshness: 'HISTORICAL', privacyClass: entry.privacyClass, sourceStatus: 'PRESENT' })),
  ].sort((left, right) => `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`));
  const contextRelations = packet.relationships.map((entry) => ({
    relationshipId: entry.relationshipId,
    predicateId: entry.predicateId,
    subjectRef: entry.subjectRef,
    objectRef: entry.objectRef,
    epistemicStatus: entry.epistemicStatus,
    verificationStatus: entry.verificationStatus,
    effectiveFrom: entry.effectiveFrom,
    effectiveTo: entry.effectiveTo,
    evidenceRefs: entry.evidenceRefs,
  })).sort((left, right) => left.relationshipId.localeCompare(right.relationshipId));
  const uncertainty = componentStatuses
    .filter((entry) => entry.readStatus !== 'PRESENT' || entry.sourceResolutionStatus !== 'VERIFIED')
    .map((entry) => ({ sourceType: 'COMPONENT', sourceRef: entry.componentType, status: entry.sourceResolutionStatus, reasonCode: entry.reasonCode }));
  if (packet.viewStatus.status !== 'PRESENT') uncertainty.push({ sourceType: 'BOUNDED_VIEWS', sourceRef: packet.companyStateVersionId, status: packet.viewStatus.status, reasonCode: packet.viewStatus.reasonCode });
  uncertainty.sort((left, right) => `${left.sourceType}:${left.sourceRef}`.localeCompare(`${right.sourceType}:${right.sourceRef}`));
  const provenance = packet.evidenceViews.map((entry) => ({
    kind: 'EVIDENCE', ref: entry.evidenceRef, ownerSystem: entry.ownerSystem,
    nativeVersion: entry.nativeVersion, contentHash: entry.contentHash, recordedAt: entry.recordedAt,
  })).sort((left, right) => left.ref.localeCompare(right.ref));
  const context = {
    contractVersion: CONTEXT_FUSION_CONTRACT_VERSION,
    authority: CONTEXT_FUSION_AUTHORITY,
    contextId: '',
    status: packet.status === 'PRESENT' ? 'COMPLETE' : 'INCOMPLETE',
    ventureId: packet.ventureId,
    companyStateVersionId: packet.companyStateVersionId,
    manifestHash: packet.manifestHash,
    asOf: packet.asOf,
    componentStatuses,
    sourceReferences,
    contextRelations,
    contradictions: [...packet.contradictions].sort((left, right) => left.contradictionRef.localeCompare(right.contradictionRef)),
    uncertainty,
    provenance,
    limits: packet.limits,
  };
  context.contextId = contextIdFor(context);
  return validateOntologyFusedContext(context);
}
