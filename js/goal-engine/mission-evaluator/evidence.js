/**
 * Claim-bound trusted evidence resolution.
 *
 * A record is usable only when it is verified, has the correct relevance
 * category, and its captured facts satisfy every explicit claim predicate.
 */

function unique(values) {
  return [...new Set(values)];
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchesClaim(facts, claim) {
  if (!Object.hasOwn(facts, claim.fact)) return false;
  const actual = facts[claim.fact];
  switch (claim.operator) {
    case 'equals':
      return deepEqual(actual, claim.value);
    case 'includes':
      return Array.isArray(actual) && actual.includes(claim.value);
    case 'includes_all':
      return Array.isArray(actual)
        && Array.isArray(claim.value)
        && claim.value.every((value) => actual.includes(value));
    case 'gte':
      return Number.isFinite(actual) && actual >= claim.value;
    case 'lte':
      return Number.isFinite(actual) && actual <= claim.value;
    default:
      return false;
  }
}

function contextBinding(context, category) {
  const bindings = {
    goal: {
      ids: context.goal.evidenceIds,
      claims: [
        { fact: 'goalCategory', operator: 'equals', value: context.goal.category },
      ],
    },
    milestone: {
      ids: context.activeMilestone.evidenceIds,
      claims: [
        { fact: 'milestoneId', operator: 'equals', value: context.activeMilestone.id },
        { fact: 'milestoneCategory', operator: 'equals', value: context.activeMilestone.category },
      ],
    },
    route: {
      ids: context.routeNode.evidenceIds,
      claims: [
        { fact: 'routeNodeId', operator: 'equals', value: context.routeNode.id },
        {
          fact: 'allowedWorkUnitTypeIds',
          operator: 'includes_all',
          value: context.routeNode.allowedWorkUnitTypeIds,
        },
      ],
    },
    bottleneck: {
      ids: context.activeBottleneck.evidenceIds,
      claims: [
        { fact: 'bottleneckCategory', operator: 'equals', value: context.activeBottleneck.category },
      ],
    },
    programme: {
      ids: context.programme.evidenceIds,
      claims: [
        { fact: 'programmeId', operator: 'equals', value: context.programme.id },
        { fact: 'programmeStage', operator: 'equals', value: context.programme.stage },
        { fact: 'programmeExternal', operator: 'equals', value: context.programme.external },
      ],
    },
    capability: {
      ids: context.capability.evidenceIds,
      claims: [
        {
          fact: 'supportedMethodIds',
          operator: 'includes_all',
          value: context.capability.supportedMethodIds,
        },
        { fact: 'maxEffortUnits', operator: 'equals', value: context.capability.maxEffortUnits },
      ],
    },
    progress: {
      ids: context.progress.evidenceIds,
      claims: [
        { fact: 'signalIds', operator: 'includes_all', value: context.progress.signalIds },
      ],
    },
    constraints: {
      ids: context.constraints.evidenceIds,
      claims: [
        {
          fact: 'forbiddenMethodIds',
          operator: 'equals',
          value: context.constraints.forbiddenMethodIds,
        },
        {
          fact: 'forbiddenActionTypes',
          operator: 'equals',
          value: context.constraints.forbiddenActionTypes,
        },
        {
          fact: 'illegalActionTypes',
          operator: 'equals',
          value: context.constraints.illegalActionTypes,
        },
        {
          fact: 'medicalClearanceRequired',
          operator: 'equals',
          value: context.constraints.medicalClearanceRequired,
        },
        {
          fact: 'medicalClearancePresent',
          operator: 'equals',
          value: context.constraints.medicalClearancePresent,
        },
      ],
    },
    availability: {
      ids: context.availability.evidenceIds,
      claims: [
        {
          fact: 'availableMinutes',
          operator: 'equals',
          value: context.availability.availableMinutes,
        },
        {
          fact: 'resourceIds',
          operator: 'includes_all',
          value: context.availability.resourceIds,
        },
      ],
    },
    recovery: {
      ids: context.recovery.evidenceIds,
      claims: [
        { fact: 'recoveryStatus', operator: 'equals', value: context.recovery.status },
        { fact: 'maxEffortUnits', operator: 'equals', value: context.recovery.maxEffortUnits },
      ],
    },
    preference: {
      ids: context.verifiedPreferences.evidenceIds,
      claims: [
        {
          fact: 'preferredWorkUnitTypeIds',
          operator: 'includes_all',
          value: context.verifiedPreferences.preferredWorkUnitTypeIds,
        },
        {
          fact: 'preferredMethodIds',
          operator: 'includes_all',
          value: context.verifiedPreferences.preferredMethodIds,
        },
      ],
    },
    proof_capability: {
      ids: context.proofCapability.evidenceIds,
      claims: [
        {
          fact: 'supportedEvidenceTypeIds',
          operator: 'equals',
          value: context.proofCapability.supportedEvidenceTypeIds,
        },
        {
          fact: 'supportedProofModes',
          operator: 'equals',
          value: context.proofCapability.supportedProofModes,
        },
        {
          fact: 'compatibleDomainIds',
          operator: 'equals',
          value: context.proofCapability.compatibleDomainIds,
        },
      ],
    },
  };
  return bindings[category] || null;
}

function factSignature(value) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    return JSON.stringify(value);
  }
  return null;
}

export function createEvidenceResolver(context, proposal) {
  const records = new Map(context.evidenceRegistry.map((record) => [record.id, record]));
  const usedIds = new Set();

  function recordsSupporting(ids, relevanceCategory, claims = []) {
    const supported = unique(ids)
      .map((id) => records.get(id))
      .filter((record) => (
        record
        && record.verificationStatus === 'verified'
        && record.relevanceCategory === relevanceCategory
        && Object.keys(record.capturedFacts).length > 0
        && claims.every((claim) => matchesClaim(record.capturedFacts, claim))
      ));
    for (const record of supported) usedIds.add(record.id);
    return supported;
  }

  function idsSupporting(ids, relevanceCategory, claims = []) {
    return Object.freeze(recordsSupporting(ids, relevanceCategory, claims).map((record) => record.id));
  }

  function idsForContext(category) {
    const binding = contextBinding(context, category);
    if (!binding) return Object.freeze([]);
    return idsSupporting(binding.ids, category, binding.claims);
  }

  function idsForDomain(claims = []) {
    return idsSupporting(context.domainFacts.evidenceIds, 'domain', [
      { fact: 'domainId', operator: 'equals', value: context.domainFacts.domainId },
      ...claims,
    ]);
  }

  function idsForProof() {
    const claimCategoryIds = proposal.proofPlan.claims.map((claim) => claim.categoryId);
    const outputCategoryIds = proposal.missionSteps.map((step) => step.outputCategoryId);
    return idsSupporting(
      context.proofCapability.evidenceIds,
      'proof_capability',
      [
        {
          fact: 'supportedEvidenceTypeIds',
          operator: 'includes',
          value: proposal.proofPlan.evidenceTypeId,
        },
        { fact: 'supportedProofModes', operator: 'includes', value: proposal.proofPlan.proofMode },
        { fact: 'supportedClaimCategories', operator: 'includes_all', value: claimCategoryIds },
        { fact: 'supportedOutputCategories', operator: 'includes_all', value: outputCategoryIds },
        { fact: 'compatibleDomainIds', operator: 'includes', value: proposal.domainId },
      ],
    );
  }

  function proofCapabilityAssessment(pack) {
    const capabilityIds = idsForProof();
    const workUnit = pack?.professionalWorkUnitTypes.find((item) => item.id === proposal.workUnitTypeId);
    const packEvidence = pack?.proofCompatibleEvidenceTypes
      .find((item) => item.id === proposal.proofPlan.evidenceTypeId);
    const claimCategoryIds = unique(proposal.proofPlan.claims.map((claim) => claim.categoryId));
    const outputCategoryIds = unique(proposal.missionSteps.map((step) => step.outputCategoryId));
    const limitations = context.proofCapability.technicalLimitations;
    const reasons = [];
    if (!workUnit || !packEvidence
      || packEvidence.proofMode !== proposal.proofPlan.proofMode
      || !workUnit.compatibleEvidenceTypeIds.includes(proposal.proofPlan.evidenceTypeId)
      || !claimCategoryIds.every((categoryId) => workUnit.allowedClaimCategoryIds.includes(categoryId))
      || !outputCategoryIds.every((categoryId) => workUnit.producedOutputCategoryIds.includes(categoryId))
      || !claimCategoryIds.every((categoryId) => packEvidence.supportedClaimCategoryIds.includes(categoryId))
      || !outputCategoryIds.every((categoryId) => packEvidence.capturedOutputCategoryIds.includes(categoryId))) {
      reasons.push('Proof plan is incompatible with the canonical domain pack and work unit');
    }
    if (capabilityIds.length === 0) {
      reasons.push('Trusted proof capability does not support the proposed type, mode, claim category, or output category');
    }
    if (limitations.includes(`evidence_type:${proposal.proofPlan.evidenceTypeId}`)
      || limitations.includes(`proof_mode:${proposal.proofPlan.proofMode}`)
      || limitations.includes(`work_unit:${proposal.workUnitTypeId}`)
      || claimCategoryIds.some((id) => limitations.includes(`claim_category:${id}`))
      || outputCategoryIds.some((id) => limitations.includes(`output_category:${id}`))) {
      reasons.push('A trusted technical limitation blocks the proposed proof plan');
    }
    if (packEvidence
      && !packEvidence.requiredCaptureCapabilityIds.every((capabilityId) => (
        context.proofCapability.availableCaptureCapabilities.includes(capabilityId)
      ))) {
      reasons.push('Trusted proof capability lacks a required capture capability');
    }
    if (proposal.domainId === 'money'
      && context.domainFacts.facts.privacySafeProofRequired
      && (!context.proofCapability.redactionSupported
        || !context.proofCapability.privacyRequirements.includes('redaction_required'))) {
      reasons.push('Trusted proof capability cannot satisfy required financial redaction');
    }
    if (proposal.domainId === 'creator'
      && context.proofCapability.rightsClearanceRequired
      && (context.domainFacts.facts.rightsCleared !== true
        || !context.proofCapability.permissionsConfirmed)) {
      reasons.push('Trusted proof capability lacks required rights or permission confirmation');
    }
    return Object.freeze({
      passed: reasons.length === 0,
      reasons: Object.freeze(reasons),
      evidenceIds: Object.freeze(capabilityIds),
    });
  }

  function unresolvedProposalIds() {
    return Object.freeze(proposal.evidenceRefs.filter((id) => !usedIds.has(id)));
  }

  function usedRecords() {
    return [...usedIds].map((id) => records.get(id)).filter(Boolean);
  }

  function uniqueSourceMetadata(recordsToMeasure = usedRecords()) {
    const sources = new Map();
    for (const record of recordsToMeasure) {
      for (const source of record.metadata.sources) {
        if (!sources.has(source.independentSourceKey)) {
          sources.set(source.independentSourceKey, source);
        }
      }
    }
    return [...sources.values()];
  }

  function recency(recordsToMeasure = usedRecords()) {
    const sources = uniqueSourceMetadata(recordsToMeasure);
    if (sources.length === 0) return 0;
    const evaluationMs = Date.parse(context.evaluationTime);
    const staleWindowMs = 30 * 24 * 60 * 60 * 1000;
    const total = sources.reduce((sum, source) => {
      const sourceMs = Date.parse(source.occurredAt || source.ingestedAt);
      const age = Math.max(0, evaluationMs - sourceMs);
      return sum + Math.max(0, 1 - (age / staleWindowMs));
    }, 0);
    return total / sources.length;
  }

  function independentAgreement(recordsToMeasure = usedRecords()) {
    if (recordsToMeasure.length === 0) return 0;
    // Facts are grouped by category-qualified path (e.g. "capability.maxEffortUnits",
    // "recovery.maxEffortUnits") so unrelated facts that happen to share a raw
    // field name across different evidence categories are never compared as
    // though they were the same fact.
    const facts = new Map();
    for (const record of recordsToMeasure) {
      for (const [key, value] of Object.entries(record.capturedFacts)) {
        const signature = factSignature(value);
        if (signature === null) continue;
        const factPath = `capturedFacts.${key}`;
        const qualifiedFact = `${record.relevanceCategory}.${key}`;
        const sources = record.metadata.sources.filter((source) => (
          source.supportedFactPaths.includes(factPath)
        ));
        if (sources.length === 0) continue;
        if (!facts.has(qualifiedFact)) facts.set(qualifiedFact, new Map());
        for (const source of sources) {
          facts.get(qualifiedFact).set(source.independentSourceKey, signature);
        }
      }
    }
    const comparable = [...facts.values()].filter((values) => values.size > 1);
    if (comparable.length === 0) return 0;
    const agreeing = comparable.filter((values) => new Set(values.values()).size === 1).length;
    return agreeing / comparable.length;
  }

  return Object.freeze({
    idsSupporting,
    idsForContext,
    idsForDomain,
    idsForProof,
    proofCapabilityAssessment,
    unresolvedProposalIds,
    recency,
    independentAgreement,
    independentSourceCount: () => uniqueSourceMetadata().length,
    usedEvidenceIds: () => Object.freeze([...usedIds]),
  });
}

export function deriveOutcomeMeasurability(context, proposal, evidence) {
  const outputIds = proposal.missionSteps.map((step) => step.outputId);
  return Boolean(
    proposal.intendedOutcome.targetId === context.activeMilestone.id
    && proposal.targetMilestoneId === context.activeMilestone.id
    && proposal.proofPlan.claims.length > 0
    && outputIds.length > 0
    && new Set(outputIds).size === outputIds.length
    && evidence.idsForProof().length > 0
  );
}
