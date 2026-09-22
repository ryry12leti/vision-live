/**
 * Parses and validates raw provider output into candidate proposals the
 * evaluator can later accept, without ever evaluating, scoring, or selecting
 * a candidate. Everything here is fail-closed: anything not explicitly
 * proven safe is rejected with a diagnostic reason, and nothing invalid is
 * ever repaired or silently corrected.
 */

import { validateCandidateProposal } from '../mission-evaluator/candidate-contract.js';
import {
  CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION,
  MAX_CANDIDATES_HARD_LIMIT,
  MAX_RESPONSE_BYTES,
  PROVIDER_RESPONSE_FIELDS,
  isPlainObject,
} from './contract.js';
import { byteLength } from './canonical.js';
import { verifyCandidatesAnswerInstructions } from './domain-intelligence/instruction-compiler.js';
import { unionOfItemRequiredResources } from './domain-intelligence/shared.js';

// The only domainDetails field, per domain, that identifies the active
// programme a candidate claims to belong to. Domains without such a field
// cannot silently claim a different programme through domainDetails.
const PROGRAMME_DETAIL_FIELD = Object.freeze({
  fitness: 'programmeId',
  athlete: 'coachProgrammeId',
});

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function missionEffortUnits(proposal) {
  return proposal.missionStructure.kind === 'fixed'
    ? proposal.missionStructure.fixed.effortUnits
    : proposal.missionStructure.hard.effortUnits;
}

function rejected(candidateId, reasons) {
  return { candidateId: candidateId ?? null, reasons };
}

function malformed(reason) {
  return { validCandidates: [], rejected: [], malformed: true, malformedReason: reason };
}

function responseByteLength(rawOutput) {
  try {
    return byteLength(rawOutput);
  } catch {
    return Infinity;
  }
}

/**
 * Every location a candidate can name an executable method: the top-level
 * method plus whichever mission-structure sub-version is present. A
 * forbidden method must be caught wherever it appears, not only at the top
 * level.
 */
function allMethodLocations(proposal) {
  const locations = [{ path: 'method.id', methodId: proposal.method.id }];
  if (proposal.missionStructure.kind === 'hard_medium') {
    locations.push(
      { path: 'missionStructure.hard.methodId', methodId: proposal.missionStructure.hard.methodId },
      { path: 'missionStructure.medium.methodId', methodId: proposal.missionStructure.medium.methodId },
    );
  } else {
    locations.push({ path: 'missionStructure.fixed.methodId', methodId: proposal.missionStructure.fixed.methodId });
  }
  return locations;
}

/**
 * Structural + safety semantic checks against the exact request this batch
 * was generated for. Runs only after `validateCandidateProposal` has already
 * confirmed the proposal is structurally well-formed and carries no unknown
 * (candidate-authored score/confidence/acceptance/authority) fields.
 */
function semanticReasons(proposal, request, domainPack) {
  const reasons = [];

  if (proposal.domainId !== request.domainId) {
    reasons.push(`domainId ${proposal.domainId} does not match the requested domain ${request.domainId}`);
  }

  const workUnit = request.canonicalWorkUnits.find((item) => item.id === proposal.workUnitTypeId);
  if (!workUnit) {
    reasons.push(`workUnitTypeId ${proposal.workUnitTypeId} is not a canonical work unit with a valid proof pairing on the active route`);
  }

  if (proposal.targetMilestoneId !== request.currentMilestone.id) {
    reasons.push('targetMilestoneId does not match the active milestone for this exact goal');
  }
  if (proposal.targetRouteNodeId !== request.route.routeNodeId) {
    reasons.push('targetRouteNodeId does not match the active route for this exact goal');
  }
  if (proposal.targetBottleneckCategory !== request.bottleneck.category) {
    reasons.push('targetBottleneckCategory does not match the active bottleneck for this exact goal');
  }

  const pairing = request.validProofPairings.find((item) => (
    item.workUnitTypeId === proposal.workUnitTypeId && item.evidenceTypeId === proposal.proofPlan.evidenceTypeId
  ));
  const evidenceType = request.allowedProof.evidenceTypes.find((item) => item.id === proposal.proofPlan.evidenceTypeId);
  if (!pairing) {
    reasons.push(
      `(${proposal.workUnitTypeId}, ${proposal.proofPlan.evidenceTypeId}) is not a precomputed valid proof pairing for this request`,
    );
  } else if (pairing.proofMode !== proposal.proofPlan.proofMode) {
    reasons.push(`proofPlan.proofMode ${proposal.proofPlan.proofMode} does not match evidence type ${pairing.evidenceTypeId}`);
  }

  if (pairing) {
    for (const claim of proposal.proofPlan.claims) {
      if (!pairing.sharedClaimCategoryIds.includes(claim.categoryId)) {
        reasons.push(`proofPlan.claims categoryId ${claim.categoryId} is outside the valid pairing's shared claim categories`);
      }
    }
    for (const step of proposal.missionSteps) {
      if (!pairing.sharedOutputCategoryIds.includes(step.outputCategoryId)) {
        reasons.push(`missionSteps outputCategoryId ${step.outputCategoryId} is outside the valid pairing's shared output categories`);
      }
    }
  }

  if (proposal.estimatedMinutes > request.availability.availableMinutes) {
    reasons.push(`estimatedMinutes ${proposal.estimatedMinutes} exceeds available time ${request.availability.availableMinutes}`);
  }
  const unavailableResources = proposal.requiredResourceIds.filter(
    (resourceId) => !request.availability.resourceIds.includes(resourceId),
  );
  if (unavailableResources.length > 0) {
    reasons.push(`requiredResourceIds unavailable: ${unavailableResources.join(', ')}`);
  }

  // The execution unit's own items are the source of truth for what the
  // mission genuinely requires, across all six domains: the top-level
  // requiredResourceIds must equal their exact deduplicated union (already
  // enforced structurally by validateCandidateProposal, and independently
  // recalculated here so response-validator never merely trusts that prior
  // pass), and every item's own resources must independently be available
  // too — the only check that would catch an item quietly requiring
  // something the top-level list omitted.
  if (proposal.professionalExecutionUnit) {
    const items = proposal.professionalExecutionUnit.items || [];
    const itemUnion = unionOfItemRequiredResources(items);
    const normalizedRequired = [...new Set(proposal.requiredResourceIds)].sort();
    if (itemUnion === null || JSON.stringify(itemUnion) !== JSON.stringify(normalizedRequired)) {
      reasons.push(
        `requiredResourceIds (${normalizedRequired.join(', ') || 'none'}) does not equal the exact union of every `
        + `execution item's requiredResourceIds (${itemUnion ? itemUnion.join(', ') || 'none' : 'invalid'})`,
      );
    }
    for (const item of items) {
      const itemUnavailable = (item.requiredResourceIds || []).filter(
        (resourceId) => !request.availability.resourceIds.includes(resourceId),
      );
      if (itemUnavailable.length > 0) {
        reasons.push(`professionalExecutionUnit item ${item.itemId} requires unavailable resources: ${itemUnavailable.join(', ')}`);
      }
    }
  }

  // Fitness substitutionApproved may only be true when the trusted
  // programme explicitly approved that exact movement substitution — never
  // a provider's own claim.
  if (proposal.domainId === 'fitness' && proposal.professionalExecutionUnit) {
    const approvedSubstitutions = Array.isArray(request.programme?.requiredAttributes?.approvedSubstitutions)
      ? request.programme.requiredAttributes.approvedSubstitutions
      : [];
    for (const item of proposal.professionalExecutionUnit.items || []) {
      if (item.domainItemDetails?.substitutionApproved && !approvedSubstitutions.includes(item.domainItemDetails.movementId)) {
        reasons.push(`professionalExecutionUnit item ${item.itemId} claims an approved substitution for ${item.domainItemDetails.movementId} the trusted programme never approved`);
      }
    }
  }

  // Money: every item's amount/risk must stay within the trusted confirmed
  // ceilings, in addition to the domain-intelligence-level default — the
  // fail-closed authority never trusts a provider's own arithmetic.
  if (proposal.domainId === 'money' && proposal.professionalExecutionUnit) {
    const affordableAmount = request.domainFacts.affordableAmount;
    const riskOrder = ['low', 'moderate', 'high', 'extreme'];
    const maxRiskIndex = riskOrder.indexOf(request.domainFacts.maximumRiskLevel);
    for (const item of proposal.professionalExecutionUnit.items || []) {
      const details = item.domainItemDetails || {};
      if (Number.isFinite(affordableAmount) && details.amount > affordableAmount) {
        reasons.push(`professionalExecutionUnit item ${item.itemId} amount ${details.amount} exceeds the confirmed affordable amount ${affordableAmount}`);
      }
      if (maxRiskIndex >= 0 && riskOrder.indexOf(details.riskLevel) > maxRiskIndex) {
        reasons.push(`professionalExecutionUnit item ${item.itemId} riskLevel ${details.riskLevel} exceeds the confirmed maximum risk ${request.domainFacts.maximumRiskLevel}`);
      }
    }
  }

  const effortCeiling = Math.min(request.effortLimits.capabilityMaxEffortUnits, request.effortLimits.recoveryMaxEffortUnits);
  const effort = missionEffortUnits(proposal);
  if (effort > effortCeiling) {
    reasons.push(`mission effortUnits ${effort} exceeds the trusted capability/recovery ceiling ${effortCeiling}`);
  }

  const programmeField = PROGRAMME_DETAIL_FIELD[proposal.domainId];
  if (programmeField && request.programme.external) {
    const claimedProgrammeId = proposal.domainDetails?.[programmeField];
    if (claimedProgrammeId !== undefined && claimedProgrammeId !== request.programme.programmeId) {
      reasons.push(
        `domainDetails.${programmeField} (${claimedProgrammeId}) attempts to replace the approved external programme `
        + `${request.programme.programmeId} without a separate approval`,
      );
    }
  }

  if (domainPack && !domainPack.professionalWorkUnitTypes.some((item) => item.id === proposal.workUnitTypeId)) {
    reasons.push(`workUnitTypeId ${proposal.workUnitTypeId} does not exist in the ${domainPack.domainId} domain pack`);
  }

  // Proof and safety restrictions enforced again, per candidate, in addition
  // to the blanket request-level block. Nothing here is ever repaired.
  const actionTypes = proposal.missionSteps.map((step) => step.actionType);
  const forbiddenAction = actionTypes.find((type) => request.constraints.forbiddenActionTypes.includes(type));
  if (forbiddenAction) reasons.push(`missionSteps actionType ${forbiddenAction} is a forbidden action`);
  const illegalAction = actionTypes.find((type) => request.constraints.illegalActionTypes.includes(type));
  if (illegalAction) reasons.push(`missionSteps actionType ${illegalAction} is an illegal action`);
  // The canonical evaluator contract (hard-gates.js) requires hard/medium/
  // fixed methodId to exactly equal the top-level method.id; it never
  // permits a different version. Check every executable method location for
  // both a forbidden method and disagreement with the top-level method.
  for (const { path, methodId } of allMethodLocations(proposal)) {
    if (request.constraints.forbiddenMethodIds.includes(methodId)) {
      reasons.push(`${path} ${methodId} is a forbidden method`);
    }
    if (path !== 'method.id' && methodId !== proposal.method.id) {
      reasons.push(`${path} ${methodId} does not agree with the top-level method.id ${proposal.method.id}`);
    }
  }
  if (request.constraints.medicalClearanceRequired && !request.constraints.medicalClearancePresent) {
    reasons.push('required medical clearance is not present');
  }
  if (request.prerequisites.status === 'missing') {
    reasons.push(`missing prerequisites: ${request.prerequisites.missingIds.join(', ')}`);
  }
  if (!request.proofSafety.permissionsConfirmed) {
    reasons.push('trusted proof capability has not confirmed required permissions');
  }
  if (!request.proofSafety.compatibleDomainIds.includes(proposal.domainId)) {
    reasons.push(`trusted proof capability does not list ${proposal.domainId} as a compatible domain`);
  }
  const claimCategoryIds = proposal.proofPlan.claims.map((claim) => claim.categoryId);
  const outputCategoryIds = proposal.missionSteps.map((step) => step.outputCategoryId);
  const limitationHit = [
    `evidence_type:${proposal.proofPlan.evidenceTypeId}`,
    `proof_mode:${proposal.proofPlan.proofMode}`,
    `work_unit:${proposal.workUnitTypeId}`,
    ...claimCategoryIds.map((id) => `claim_category:${id}`),
    ...outputCategoryIds.map((id) => `output_category:${id}`),
  ].find((limitation) => request.proofSafety.technicalLimitations.includes(limitation));
  if (limitationHit) reasons.push(`trusted proof capability reports a technical limitation: ${limitationHit}`);

  if (proposal.domainId === 'money' && request.domainFacts.privacySafeProofRequired) {
    const redactionRequired = request.proofSafety.redactionSupported
      && request.proofSafety.privacyRequirements.includes('redaction_required');
    if (!redactionRequired) {
      reasons.push('trusted proof capability cannot satisfy the required financial redaction');
    }
  }
  if (proposal.domainId === 'creator' && request.proofSafety.rightsClearanceRequired) {
    const rightsCleared = request.domainFacts.rightsCleared === true && request.proofSafety.permissionsConfirmed;
    if (!rightsCleared) {
      reasons.push('trusted proof capability lacks required rights or permission confirmation');
    }
  }

  return reasons;
}

/**
 * Two proposals are structural duplicates when everything except
 * `candidateId` is identical: a provider cannot manufacture "distinct"
 * candidates by relabelling one real proposal under multiple ids.
 */
function structuralSignature(proposal) {
  const { candidateId, ...rest } = proposal;
  void candidateId;
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    }
    return value;
  };
  return JSON.stringify(stable(rest));
}

/**
 * @param {unknown} rawOutput Raw structured output returned by the injected provider.
 * @param {object} request The exact frozen request this output was generated for.
 * @param {object} domainPack The canonical domain pack used to build the request.
 * @param {object} instructions The exact compiled instruction batch (see domain-intelligence/instruction-compiler.js)
 *   the provider was given for this request. Required: this is what actually enforces "a response for different
 *   briefs must fail" — the provider is never trusted to have checked this itself.
 * @returns {{validCandidates: object[], rejected: object[], malformed: boolean, malformedReason: string|null}}
 */
export function validateProviderResponse(rawOutput, request, domainPack, instructions) {
  if (!isPlainObject(rawOutput)) {
    return malformed('Provider output must be a plain object');
  }

  const missingFields = PROVIDER_RESPONSE_FIELDS.filter((field) => !Object.hasOwn(rawOutput, field));
  if (missingFields.length > 0) {
    return malformed(`Provider output is missing required fields: ${missingFields.join(', ')}`);
  }
  const unknownFields = Object.keys(rawOutput).filter((field) => !PROVIDER_RESPONSE_FIELDS.includes(field));
  if (unknownFields.length > 0) {
    return malformed(`Provider output contains unknown fields: ${unknownFields.join(', ')}`);
  }

  if (rawOutput.contractVersion !== CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION) {
    return malformed(
      `Provider output.contractVersion ${rawOutput.contractVersion} does not match the expected `
      + `${CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION}`,
    );
  }
  if (rawOutput.requestId !== request.requestId) {
    return malformed(`Provider output.requestId ${rawOutput.requestId} does not match request ${request.requestId}`);
  }
  if (rawOutput.contextId !== request.contextId) {
    return malformed(`Provider output.contextId ${rawOutput.contextId} does not match request ${request.contextId}`);
  }
  if (rawOutput.goalId !== request.goalId) {
    return malformed(`Provider output.goalId ${rawOutput.goalId} does not match request ${request.goalId}`);
  }
  if (rawOutput.requestHash !== request.requestHash) {
    return malformed(
      `Provider output.requestHash ${rawOutput.requestHash} does not match the exact request fingerprint `
      + `${request.requestHash} (stale, mismatched, or tampered request)`,
    );
  }
  if (rawOutput.instructionsHash !== instructions.instructionsHash) {
    return malformed(
      `Provider output.instructionsHash ${rawOutput.instructionsHash} does not match the exact instruction batch `
      + `fingerprint ${instructions.instructionsHash} (stale, mismatched, or tampered instructions — a response `
      + 'generated for a different brief batch must never be accepted)',
    );
  }

  if (!Array.isArray(rawOutput.candidates)) {
    return malformed('Provider output.candidates must be an array');
  }
  if (rawOutput.candidates.length > MAX_CANDIDATES_HARD_LIMIT) {
    return malformed(`Provider output.candidates length ${rawOutput.candidates.length} exceeds the hard limit ${MAX_CANDIDATES_HARD_LIMIT}`);
  }
  if (rawOutput.candidates.length > request.candidateCount) {
    return malformed(
      `Provider output.candidates length ${rawOutput.candidates.length} exceeds the requested candidateCount ${request.candidateCount}`,
    );
  }
  const byteLength = responseByteLength(rawOutput);
  if (byteLength > MAX_RESPONSE_BYTES) {
    return malformed(`Provider output size ${byteLength} bytes exceeds the hard limit ${MAX_RESPONSE_BYTES} bytes`);
  }

  const validCandidates = [];
  const rejectedProposals = [];
  const seenCandidateIds = new Set();
  const seenSignatures = new Map();
  // Which instruction each accepted candidate answered. No two accepted
  // candidates may answer the same instruction: a different candidateId,
  // title, or other provider-authored wording does not create a distinct
  // strategy, only a distinct label on the identical one.
  const claimedInstructionIds = new Map();

  for (const rawCandidate of rawOutput.candidates) {
    const structural = validateCandidateProposal(rawCandidate);
    if (!structural.valid) {
      rejectedProposals.push(rejected(
        isPlainObject(rawCandidate) && typeof rawCandidate.candidateId === 'string' ? rawCandidate.candidateId : null,
        structural.errors,
      ));
      continue;
    }

    if (seenCandidateIds.has(rawCandidate.candidateId)) {
      rejectedProposals.push(rejected(rawCandidate.candidateId, [`candidateId ${rawCandidate.candidateId} duplicates an earlier candidate in this batch`]));
      continue;
    }

    const signature = structuralSignature(rawCandidate);
    if (seenSignatures.has(signature)) {
      rejectedProposals.push(rejected(rawCandidate.candidateId, [
        `candidateId ${rawCandidate.candidateId} is structurally identical to candidate ${seenSignatures.get(signature)} `
        + '(differs only by id, not a distinct candidate)',
      ]));
      continue;
    }

    const reasons = semanticReasons(rawCandidate, request, domainPack);
    // Enforced here, in the trusted validator, on every candidate from
    // every provider — real or QA — regardless of whether that provider
    // did any self-checking of its own. A candidate whose route matches
    // none of this exact instruction batch did not come from the briefs
    // this request actually planned.
    const correlation = verifyCandidatesAnswerInstructions([rawCandidate], instructions);
    if (!correlation.valid) reasons.push(...correlation.errors);

    const matchedInstructionId = correlation.matches[0]?.instructionId ?? null;
    if (matchedInstructionId && claimedInstructionIds.has(matchedInstructionId)) {
      reasons.push(
        `candidateId ${rawCandidate.candidateId} fully answers instruction ${matchedInstructionId}, already answered by `
        + `candidate ${claimedInstructionIds.get(matchedInstructionId)} in this batch (no two candidates may answer the `
        + 'same instruction; a different id, title, or wording does not create a distinct strategy)',
      );
    }

    if (reasons.length > 0) {
      rejectedProposals.push(rejected(rawCandidate.candidateId, reasons));
      continue;
    }

    seenCandidateIds.add(rawCandidate.candidateId);
    seenSignatures.set(signature, rawCandidate.candidateId);
    claimedInstructionIds.set(matchedInstructionId, rawCandidate.candidateId);
    // Canonical-clone and deep-freeze so nothing downstream — including the
    // provider's own handler, if it kept a reference — can mutate an
    // accepted candidate after validation.
    validCandidates.push(deepFreeze(structuredClone(rawCandidate)));
  }

  return { validCandidates, rejected: rejectedProposals, malformed: false, malformedReason: null };
}
