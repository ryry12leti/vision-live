/**
 * Deterministic hard gates derived from trusted context and proposal facts.
 */

function result(id, label, passed, reason, failureState = 'rejected', applicable = true) {
  return Object.freeze({
    id,
    label,
    essential: true,
    applicable,
    passed,
    reason: passed ? null : reason,
    failureState: passed ? null : failureState,
  });
}

function sameVersionCore(left, right) {
  return left.methodId === right.methodId
    && left.outcomeType === right.outcomeType
    && left.milestoneId === right.milestoneId
    && left.professionalPrinciple === right.professionalPrinciple;
}

function hardMediumRelationshipValid(context, proposal) {
  if (proposal.missionStructure.kind !== 'hard_medium') return true;
  const { hard, medium } = proposal.missionStructure;
  return sameVersionCore(hard, medium)
    && hard.methodId === proposal.method.id
    && hard.outcomeType === proposal.intendedOutcome.type
    && hard.milestoneId === context.activeMilestone.id
    && medium.effortUnits < hard.effortUnits;
}

function fixedMissionValid(context, proposal, pack) {
  if (proposal.missionStructure.kind !== 'fixed') return true;
  const fixed = proposal.missionStructure.fixed;
  return fixed.methodId === proposal.method.id
    && fixed.outcomeType === proposal.intendedOutcome.type
    && fixed.milestoneId === context.activeMilestone.id
    && pack.fixedMissionConditions.some((condition) => condition.id === fixed.conditionId)
    && context.programme.external
    && fixed.externalRequirement.trim().length > 0;
}

function missionEffort(proposal) {
  return proposal.missionStructure.kind === 'fixed'
    ? proposal.missionStructure.fixed.effortUnits
    : proposal.missionStructure.hard.effortUnits;
}

export function evaluateHardGates(context, proposal, pack, domainRuleResults, scoring, evidence) {
  const gates = [];
  const supportedDomain = Boolean(pack);
  const actionTypes = proposal.missionSteps.map((step) => step.actionType);
  const workUnit = pack?.professionalWorkUnitTypes.find((item) => item.id === proposal.workUnitTypeId);
  const requiredEvidenceCategories = ['goal', 'milestone', 'route', 'bottleneck'];
  const completeContext = requiredEvidenceCategories
    .every((category) => evidence.idsForContext(category).length > 0)
    && evidence.idsForDomain().length > 0;
  const unsafe = context.constraints.forbiddenMethodIds.includes(proposal.method.id)
    || actionTypes.some((type) => context.constraints.forbiddenActionTypes.includes(type))
    || (context.constraints.medicalClearanceRequired && !context.constraints.medicalClearancePresent);
  const illegal = actionTypes.some((type) => context.constraints.illegalActionTypes.includes(type));
  const allResourcesAvailable = proposal.requiredResourceIds
    .every((resourceId) => context.availability.resourceIds.includes(resourceId));
  const effort = missionEffort(proposal);
  const recoveryRequired = context.recovery.status === 'recovery_required';
  const feasible = proposal.estimatedMinutes <= context.availability.availableMinutes
    && allResourcesAvailable
    && effort <= context.recovery.maxEffortUnits
    && !recoveryRequired;
  const domainRequirementsPass = supportedDomain
    && context.domainFacts.domainId === proposal.domainId
    && pack.supportedGoalCategories.includes(context.goal.category)
    && domainRuleResults.length === pack.evaluationRuleIds.length
    && domainRuleResults.every((rule) => rule.passed);
  const proofCapability = evidence.proofCapabilityAssessment(pack);

  gates.push(result(
    'supported_domain',
    'Supported domain',
    supportedDomain,
    `No canonical domain pack exists for ${proposal.domainId}`,
    'domain_not_ready',
  ));
  gates.push(result(
    'required_context',
    'Required context',
    completeContext,
    'Trusted goal, milestone, route, bottleneck, and domain evidence must be verified and relevant',
    'clarification_required',
  ));
  gates.push(result('safety', 'Safety', !unsafe, 'Trusted constraints identify an unsafe mission', 'blocked'));
  gates.push(result('legality', 'Legality and integrity', !illegal, 'Trusted constraints identify an illegal or integrity-violating action', 'blocked'));
  gates.push(result(
    'prerequisites',
    'Prerequisites',
    context.prerequisites.status === 'satisfied',
    `Missing prerequisite: ${context.prerequisites.missingIds.join(', ')}`,
    'missing_prerequisite',
  ));
  gates.push(result(
    'milestone_relevance',
    'Milestone relevance',
    supportedDomain
      ? scoring.dimensionScores.expectedMilestoneProgress.earnedScore >= 12.5
        && proposal.targetMilestoneId === context.activeMilestone.id
      : true,
    'Derived milestone progress is too weak or targets the wrong milestone',
    'rejected',
    supportedDomain,
  ));
  gates.push(result(
    'bottleneck_relevance',
    'Bottleneck relevance',
    supportedDomain
      ? scoring.dimensionScores.bottleneckLeverage.earnedScore >= 10
        && proposal.targetBottleneckCategory === context.activeBottleneck.category
      : true,
    'Derived bottleneck leverage is too weak or targets the wrong bottleneck',
    'rejected',
    supportedDomain,
  ));
  gates.push(result(
    'professional_work_unit',
    'Professional work-unit validity',
    supportedDomain ? Boolean(workUnit) && proposal.missionSteps.length >= 2 : true,
    'Proposal is not a complete professional work unit declared by the canonical domain pack',
    'rejected',
    supportedDomain,
  ));
  gates.push(result(
    'proof_compatibility',
    'Proof compatibility',
    supportedDomain ? proofCapability.passed : true,
    proofCapability.reasons.join('; ') || 'Proof plan is not compatible with trusted capability',
    'rejected',
    supportedDomain,
  ));
  gates.push(result(
    'time_resources_recovery_feasibility',
    'Time, resources, and recovery feasibility',
    feasible,
    recoveryRequired
      ? 'Recovery is the highest-value safe action'
      : 'Mission exceeds trusted time, resource, capability, or recovery limits',
    recoveryRequired ? 'recovery_required' : 'blocked',
  ));
  gates.push(result(
    'hard_medium_relationship',
    'Hard/Medium relationship',
    hardMediumRelationshipValid(context, proposal),
    'Hard and Medium must share method, outcome, milestone, and professional principle, with Medium reducing scope',
    'rejected',
    proposal.missionStructure.kind === 'hard_medium',
  ));
  gates.push(result(
    'fixed_mission_validity',
    'Fixed Mission validity',
    supportedDomain ? fixedMissionValid(context, proposal, pack) : true,
    'Fixed Mission must match a canonical condition and verified external requirement without a Hard/Medium pair',
    'rejected',
    supportedDomain && proposal.missionStructure.kind === 'fixed',
  ));
  gates.push(result(
    'domain_pack_requirements',
    'Domain-pack requirements',
    supportedDomain ? domainRequirementsPass : true,
    'One or more internally derived canonical domain rules failed',
    'rejected',
    supportedDomain,
  ));

  return Object.freeze(gates);
}
