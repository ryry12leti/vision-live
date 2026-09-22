import {
  HISTORY_COMPLETENESS, OWNER_SYSTEMS, READ_STATUSES,
  claim, objectRef, validateEvidenceRef, validateObjectRef, validateReadRequest,
} from './contracts.js';

const assertStatus = (value) => {
  if (!READ_STATUSES.includes(value)) throw new TypeError(`invalid read status: ${value}`);
  return value;
};

function unavailable(ownerSystem, ventureId, asOf, status = 'UNAVAILABLE') {
  return Object.freeze({
    status: assertStatus(status), ownerSystem, ventureId, asOf,
    historyCompleteness: 'INCOMPLETE', nativeVersion: null, contentHash: null,
    objectRefs: Object.freeze([]), claims: Object.freeze([]), evidenceRefs: Object.freeze([]), contradictionRefs: Object.freeze([]),
  });
}

function validateOwnerSnapshot(snapshot, binding, ownerSystem) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError(`${ownerSystem} read returned no snapshot`);
  if (snapshot.userId !== binding.userId || snapshot.ventureId !== binding.ventureId) throw new TypeError(`${ownerSystem} owner boundary mismatch`);
  if (snapshot.ownerSystem !== ownerSystem) throw new TypeError(`${ownerSystem} owner-system mismatch`);
  if (typeof snapshot.nativeVersion !== 'string' || !snapshot.nativeVersion) throw new TypeError(`${ownerSystem} nativeVersion is required`);
  if (typeof snapshot.contentHash !== 'string' || !snapshot.contentHash) throw new TypeError(`${ownerSystem} contentHash is required`);
  if (Number.isNaN(Date.parse(snapshot.recordedAt))) throw new TypeError(`${ownerSystem} recordedAt is invalid`);
}

function resultFromSnapshot(snapshot, request, binding, ownerSystem, adapt, completeness = 'COMPLETE') {
  validateOwnerSnapshot(snapshot, binding, ownerSystem);
  if (request.requestedNativeVersion && request.requestedNativeVersion !== snapshot.nativeVersion) throw new TypeError(`${ownerSystem} source version mismatch`);
  if (request.expectedContentHash && request.expectedContentHash !== snapshot.contentHash) throw new TypeError(`${ownerSystem} content hash mismatch`);
  const view = adapt(snapshot);
  if (!HISTORY_COMPLETENESS.includes(completeness)) throw new TypeError('invalid history completeness');
  return Object.freeze({
    status: 'PRESENT', ownerSystem, ventureId: request.ventureId, asOf: request.asOf,
    historyCompleteness: completeness, nativeVersion: snapshot.nativeVersion, contentHash: snapshot.contentHash,
    objectRefs: Object.freeze(view.objectRefs ?? []), claims: Object.freeze(view.claims ?? []),
    evidenceRefs: Object.freeze(view.evidenceRefs ?? []), contradictionRefs: Object.freeze(view.contradictionRefs ?? []),
  });
}

function baseAdapter({ ownerSystem, userId, ventureId, readCurrent, readHistorical, adapt }) {
  if (!OWNER_SYSTEMS[ownerSystem]?.canonical) throw new TypeError(`${ownerSystem} is not a canonical owner system`);
  if (typeof readCurrent !== 'function' || typeof adapt !== 'function') throw new TypeError('read-only functions are required');
  const binding = Object.freeze({ userId, ventureId });
  return Object.freeze({
    ownerSystem,
    async readAsOf(rawRequest) {
      const request = validateReadRequest(rawRequest);
      if (request.ventureId !== binding.ventureId) throw new TypeError(`${ownerSystem} cross-venture read rejected`);
      try {
        const current = await readCurrent();
        if (current === null) return unavailable(ownerSystem, ventureId, request.asOf, 'UNKNOWN');
        validateOwnerSnapshot(current, binding, ownerSystem);
        const historical = Date.parse(request.asOf) < Date.parse(current.recordedAt)
          || (request.requestedNativeVersion && request.requestedNativeVersion !== current.nativeVersion);
        if (historical) {
          if (typeof readHistorical !== 'function') return unavailable(ownerSystem, ventureId, request.asOf);
          const exact = await readHistorical(request);
          if (!exact) return unavailable(ownerSystem, ventureId, request.asOf);
          return resultFromSnapshot(exact, request, binding, ownerSystem, adapt, 'COMPLETE');
        }
        return resultFromSnapshot(current, request, binding, ownerSystem, adapt, 'COMPLETE');
      } catch (error) {
        if (error instanceof TypeError) throw error;
        return unavailable(ownerSystem, ventureId, request.asOf, 'READ_FAILED');
      }
    },
  });
}

function evidenceObjectRef(ownerSystem, snapshot, item) {
  return objectRef({ kind: 'EVIDENCE', ventureId: snapshot.ventureId, ownerSystem, namespace: item.namespace ?? 'native-evidence', localId: item.id, version: item.version ?? snapshot.nativeVersion, contentHash: item.contentHash ?? null });
}

function evidenceView(ownerSystem, snapshot, item) {
  const evidenceRef = evidenceObjectRef(ownerSystem, snapshot, item);
  return validateEvidenceRef({
    contractVersion: 'ontology.v1', evidenceRef, ownerSystem, nativeEvidenceId: item.id,
    nativeVersion: item.version ?? snapshot.nativeVersion, contentHash: item.contentHash ?? null,
    fingerprint: item.fingerprint, observer: item.observer, provider: item.provider,
    observedAt: item.observedAt, recordedAt: item.recordedAt,
    evidenceClass: item.evidenceClass, trustClass: item.trustClass, privacyClass: item.privacyClass,
  });
}

function adaptFounderState(snapshot) {
  const entityRefs = (snapshot.entities ?? []).map((item) => objectRef({ kind: 'ENTITY', ventureId: snapshot.ventureId, ownerSystem: 'FOUNDER_STATE', namespace: item.namespace ?? 'founder-entity', localId: item.id, version: snapshot.nativeVersion, contentHash: item.contentHash ?? null }));
  const evidenceRefs = (snapshot.evidence ?? []).map((item) => evidenceView('FOUNDER_STATE', snapshot, item));
  const claims = (snapshot.facts ?? []).map((fact) => {
    const claimRef = objectRef({ kind: 'CLAIM', ventureId: snapshot.ventureId, ownerSystem: 'FOUNDER_STATE', namespace: 'founder-fact', localId: fact.id, version: snapshot.nativeVersion, contentHash: fact.contentHash ?? null });
    const subjectRef = fact.subjectRef ?? entityRefs.find((ref) => ref.localId === fact.subjectId) ?? objectRef({ kind: 'ENTITY', ventureId: snapshot.ventureId, ownerSystem: 'FOUNDER_STATE', namespace: 'venture', localId: snapshot.ventureId });
    return claim({
      claimRef, ownerSystem: 'FOUNDER_STATE', subjectRef, claimType: fact.claimType,
      value: fact.unknown ? { type: 'UNKNOWN' } : fact.ref ? { type: 'REF', ref: fact.ref } : fact.value === null ? { type: 'NONE' } : { type: 'REDACTED_SCALAR', value: fact.value },
      epistemicStatus: fact.epistemicStatus, verificationStatus: fact.verificationStatus, confidence: fact.confidence,
      occurredAt: fact.occurredAt ?? null, observedAt: fact.observedAt, recordedAt: fact.recordedAt,
      freshness: fact.freshness, evidenceRefs: fact.evidenceRefs ?? [], contradictionRefs: fact.contradictionRefs ?? [],
      sourceVersion: snapshot.nativeVersion, privacyClass: fact.privacyClass,
    });
  });
  return { objectRefs: entityRefs, claims, evidenceRefs, contradictionRefs: (snapshot.contradictionRefs ?? []).map(validateObjectRef) };
}

function adaptReferenceList(ownerSystem, namespace, kind) {
  return (snapshot) => ({
    objectRefs: (snapshot.records ?? []).map((item) => objectRef({ kind, ventureId: snapshot.ventureId, ownerSystem, namespace, localId: item.id, version: item.version ?? snapshot.nativeVersion, contentHash: item.contentHash ?? null })),
    evidenceRefs: (snapshot.evidence ?? []).map((item) => evidenceView(ownerSystem, snapshot, item)),
    claims: [], contradictionRefs: (snapshot.contradictionRefs ?? []).map(validateObjectRef),
  });
}

export const createFounderStateAdapter = (options) => baseAdapter({ ...options, ownerSystem: 'FOUNDER_STATE', adapt: adaptFounderState });
export const createFounderWorkAdapter = (options) => baseAdapter({ ...options, ownerSystem: 'FOUNDER_WORK', adapt: adaptReferenceList('FOUNDER_WORK', 'founder-work', 'ACTION') });
export const createActiveOutcomeAdapter = (options) => baseAdapter({ ...options, ownerSystem: 'ACTIVE_OUTCOME', adapt: adaptReferenceList('ACTIVE_OUTCOME', 'active-outcome', 'ACTUAL_OUTCOME') });
export const createOpportunityIntelligenceAdapter = (options) => baseAdapter({ ...options, ownerSystem: 'OPPORTUNITY_INTELLIGENCE', adapt: adaptReferenceList('OPPORTUNITY_INTELLIGENCE', 'opportunity-observation', 'EVIDENCE') });

export function readNoncanonicalSystem(ownerSystem, { ventureId, asOf, consulted = false }) {
  if (OWNER_SYSTEMS[ownerSystem]?.canonical !== false) throw new TypeError(`${ownerSystem} is not a noncanonical Phase 0 system`);
  return unavailable(ownerSystem, ventureId, asOf, consulted ? 'UNAVAILABLE' : 'NOT_CONSULTED');
}
