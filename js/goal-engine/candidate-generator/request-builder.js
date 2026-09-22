/**
 * Builds the strict, provider-neutral generation request from a verified
 * `GenerationEnvelope`, the caller-supplied canonical domain pack, and a
 * validated `GenerationConfig`. Pure and deterministic: the same inputs
 * always produce the same request (and the same `requestHash`). Never calls
 * a provider, database, or network API.
 *
 * Precomputes every valid work-unit/evidence-type proof pairing — requiring
 * overlapping claim categories, output categories, proof mode, and capture
 * capabilities across all three authorities (the canonical work unit, the
 * canonical evidence type, AND the user's actual trusted proof capability,
 * not just the first two) — and evaluates every blanket proof/safety
 * restriction (permissions, domain compatibility, medical clearance,
 * prerequisites) before a provider is ever called. If no fully trusted
 * pairing exists or a blanket restriction fails, the request is marked
 * `blocked` and the caller must not call the provider.
 */

import { CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION, CandidateGenerationConfigError } from './contract.js';
import { sha256Hex } from './canonical.js';

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function sharedValues(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function allowedEvidenceTypesFor(trustedContext, domainPack) {
  const supportedEvidenceTypeIds = new Set(trustedContext.proofCapability.supportedEvidenceTypeIds);
  const supportedProofModes = new Set(trustedContext.proofCapability.supportedProofModes);
  const availableCaptureCapabilities = new Set(trustedContext.proofCapability.availableCaptureCapabilities);
  return domainPack.proofCompatibleEvidenceTypes.filter((evidenceType) => (
    supportedEvidenceTypeIds.has(evidenceType.id)
    && supportedProofModes.has(evidenceType.proofMode)
    && evidenceType.requiredCaptureCapabilityIds.every((capability) => availableCaptureCapabilities.has(capability))
  ));
}

/**
 * A (workUnit, evidenceType) pair is a fully trusted pairing only when its
 * shared claim and output categories are also actually listed in the user's
 * verified `trustedContext.proofCapability.supportedClaimCategories` /
 * `supportedOutputCategories`. A domain pack can declare a category the
 * evidence type nominally supports while the specific user's trusted proof
 * capability has never confirmed that category — that gap must exclude the
 * pairing, not just the domain-pack-level and evidence-capability-level
 * overlap checked before this.
 */
function computeValidProofPairings(canonicalWorkUnitCandidates, allowedEvidenceTypeCandidates, trustedProofCapability) {
  const evidenceById = new Map(allowedEvidenceTypeCandidates.map((item) => [item.id, item]));
  const trustedClaimCategories = new Set(trustedProofCapability.supportedClaimCategories);
  const trustedOutputCategories = new Set(trustedProofCapability.supportedOutputCategories);
  const pairings = [];
  for (const workUnit of canonicalWorkUnitCandidates) {
    for (const evidenceTypeId of workUnit.compatibleEvidenceTypeIds) {
      const evidenceType = evidenceById.get(evidenceTypeId);
      if (!evidenceType) continue;
      const sharedClaimCategoryIds = sharedValues(workUnit.allowedClaimCategoryIds, evidenceType.supportedClaimCategoryIds)
        .filter((id) => trustedClaimCategories.has(id));
      const sharedOutputCategoryIds = sharedValues(workUnit.producedOutputCategoryIds, evidenceType.capturedOutputCategoryIds)
        .filter((id) => trustedOutputCategories.has(id));
      if (sharedClaimCategoryIds.length === 0 || sharedOutputCategoryIds.length === 0) continue;
      pairings.push({
        workUnitTypeId: workUnit.id,
        evidenceTypeId: evidenceType.id,
        proofMode: evidenceType.proofMode,
        sharedClaimCategoryIds,
        sharedOutputCategoryIds,
      });
    }
  }
  return pairings;
}

/**
 * @param {object} envelope Verified GenerationEnvelope.
 * @param {object} domainPack Canonical domain pack matching envelope.trustedContext.domainFacts.domainId.
 * @param {object} config Validated GenerationConfig.
 * @returns {Promise<Readonly<object>>} The strict generation request, deep-frozen.
 */
export async function buildGenerationRequest(envelope, domainPack, config) {
  const trustedContext = envelope.trustedContext;
  const domainId = trustedContext.domainFacts.domainId;

  if (!domainPack || domainPack.domainId !== domainId) {
    throw new CandidateGenerationConfigError(
      `domainPack.domainId must match trustedContext.domainFacts.domainId (${domainId})`,
    );
  }

  const allowedWorkUnitIds = new Set(trustedContext.routeNode.allowedWorkUnitTypeIds);
  const canonicalWorkUnitCandidates = domainPack.professionalWorkUnitTypes.filter((workUnit) => (
    allowedWorkUnitIds.has(workUnit.id)
  ));
  const allowedEvidenceTypeCandidates = allowedEvidenceTypesFor(trustedContext, domainPack);
  const validProofPairings = computeValidProofPairings(
    canonicalWorkUnitCandidates,
    allowedEvidenceTypeCandidates,
    trustedContext.proofCapability,
  );

  const pairedWorkUnitIds = new Set(validProofPairings.map((pairing) => pairing.workUnitTypeId));
  const pairedEvidenceTypeIds = new Set(validProofPairings.map((pairing) => pairing.evidenceTypeId));
  const canonicalWorkUnits = canonicalWorkUnitCandidates
    .filter((workUnit) => pairedWorkUnitIds.has(workUnit.id))
    .map((workUnit) => ({
      id: workUnit.id,
      description: workUnit.description,
      compatibleEvidenceTypeIds: [...workUnit.compatibleEvidenceTypeIds],
      allowedClaimCategoryIds: [...workUnit.allowedClaimCategoryIds],
      producedOutputCategoryIds: [...workUnit.producedOutputCategoryIds],
    }));
  const allowedEvidenceTypes = allowedEvidenceTypeCandidates
    .filter((evidenceType) => pairedEvidenceTypeIds.has(evidenceType.id))
    .map((evidenceType) => ({
      id: evidenceType.id,
      proofMode: evidenceType.proofMode,
      description: evidenceType.description,
      supportedClaimCategoryIds: [...evidenceType.supportedClaimCategoryIds],
      capturedOutputCategoryIds: [...evidenceType.capturedOutputCategoryIds],
      requiredCaptureCapabilityIds: [...evidenceType.requiredCaptureCapabilityIds],
    }));

  const blockedReasons = [];
  if (validProofPairings.length === 0) {
    blockedReasons.push(
      'No work unit and evidence type share an overlapping claim category, output category, proof mode, and capture '
      + 'capability that is also confirmed by the trusted proof capability',
    );
  }
  if (!trustedContext.proofCapability.permissionsConfirmed) {
    blockedReasons.push('Trusted proof capability has not confirmed required permissions');
  }
  if (!trustedContext.proofCapability.compatibleDomainIds.includes(domainId)) {
    blockedReasons.push(`Trusted proof capability does not list ${domainId} as a compatible domain`);
  }
  if (trustedContext.constraints.medicalClearanceRequired && !trustedContext.constraints.medicalClearancePresent) {
    blockedReasons.push('Required medical clearance is not present');
  }
  if (trustedContext.prerequisites.status === 'missing') {
    blockedReasons.push(`Missing prerequisites: ${trustedContext.prerequisites.missingIds.join(', ')}`);
  }

  // Every meaningful field the provider's response must be proven to answer.
  // Computed and hashed before the derived `blocked`/`blockedReasons` fields
  // are attached, since those are outputs of this same data, not inputs.
  const hashableRequest = {
    contractVersion: CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION,
    requestId: config.requestId,
    contextId: envelope.contextId,
    goalId: envelope.goalId,
    generatedAt: config.generatedAt,
    candidateCount: config.candidateCount,
    goal: {
      goalId: envelope.goalId,
      goalRole: envelope.goalRole,
      description: trustedContext.goal.description,
      category: trustedContext.goal.category,
    },
    domainId,
    currentMilestone: {
      id: trustedContext.activeMilestone.id,
      description: trustedContext.activeMilestone.description,
      category: trustedContext.activeMilestone.category,
    },
    route: {
      routeNodeId: trustedContext.routeNode.id,
      allowedWorkUnitTypeIds: [...trustedContext.routeNode.allowedWorkUnitTypeIds],
    },
    prerequisites: {
      status: trustedContext.prerequisites.status,
      missingIds: [...trustedContext.prerequisites.missingIds],
    },
    programme: {
      programmeId: trustedContext.programme.id,
      stage: trustedContext.programme.stage,
      external: trustedContext.programme.external,
      requiredAttributes: { ...trustedContext.programme.requiredAttributes },
    },
    bottleneck: {
      category: trustedContext.activeBottleneck.category,
      description: trustedContext.activeBottleneck.description,
    },
    workingLevel: envelope.workingLevel,
    effortLimits: {
      capabilityMaxEffortUnits: trustedContext.capability.maxEffortUnits,
      recoveryMaxEffortUnits: trustedContext.recovery.maxEffortUnits,
      recoveryStatus: trustedContext.recovery.status,
      supportedMethodIds: [...trustedContext.capability.supportedMethodIds],
    },
    availability: {
      availableMinutes: trustedContext.availability.availableMinutes,
      resourceIds: [...trustedContext.availability.resourceIds],
    },
    constraints: {
      forbiddenMethodIds: [...trustedContext.constraints.forbiddenMethodIds],
      forbiddenActionTypes: [...trustedContext.constraints.forbiddenActionTypes],
      illegalActionTypes: [...trustedContext.constraints.illegalActionTypes],
      medicalClearanceRequired: trustedContext.constraints.medicalClearanceRequired,
      medicalClearancePresent: trustedContext.constraints.medicalClearancePresent,
    },
    proofSafety: {
      permissionsConfirmed: trustedContext.proofCapability.permissionsConfirmed,
      compatibleDomainIds: [...trustedContext.proofCapability.compatibleDomainIds],
      privacyRequirements: [...trustedContext.proofCapability.privacyRequirements],
      redactionSupported: trustedContext.proofCapability.redactionSupported,
      rightsClearanceRequired: trustedContext.proofCapability.rightsClearanceRequired,
      technicalLimitations: [...trustedContext.proofCapability.technicalLimitations],
    },
    canonicalWorkUnits,
    allowedProof: {
      evidenceTypes: allowedEvidenceTypes,
      supportedClaimCategories: [...trustedContext.proofCapability.supportedClaimCategories],
      supportedOutputCategories: [...trustedContext.proofCapability.supportedOutputCategories],
    },
    validProofPairings,
    domainFacts: { ...trustedContext.domainFacts.facts },
    preferences: {
      preferredWorkUnitTypeIds: [...trustedContext.verifiedPreferences.preferredWorkUnitTypeIds],
      preferredMethodIds: [...trustedContext.verifiedPreferences.preferredMethodIds],
    },
  };

  const requestHash = await sha256Hex(hashableRequest);

  return deepFreeze({
    ...hashableRequest,
    requestHash,
    blocked: blockedReasons.length > 0,
    blockedReasons,
  });
}
