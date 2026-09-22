import { deriveOutcomeMeasurability } from './evidence.js';

/**
 * Exact Constitution §E 100-point rubric, derived from trusted facts.
 */

export const MISSION_QUALITY_RUBRIC = Object.freeze([
  Object.freeze({ id: 'expectedMilestoneProgress', label: 'Expected milestone progress', weight: 25 }),
  Object.freeze({ id: 'bottleneckLeverage', label: 'Bottleneck leverage', weight: 20 }),
  Object.freeze({ id: 'routePrerequisiteCorrectness', label: 'Route and prerequisite correctness', weight: 15 }),
  Object.freeze({ id: 'completeProfessionalUnit', label: 'Complete professional unit', weight: 10 }),
  Object.freeze({ id: 'capabilityFit', label: 'Capability fit', weight: 10 }),
  Object.freeze({ id: 'timeResourcesRecoveryFit', label: 'Time, resources and recovery fit', weight: 8 }),
  Object.freeze({ id: 'outcomeProofConfidence', label: 'Outcome and proof confidence', weight: 7 }),
  Object.freeze({ id: 'verifiedPreferenceFit', label: 'Verified preference fit', weight: 5 }),
]);

export const MISSION_QUALITY_MAX_SCORE = MISSION_QUALITY_RUBRIC
  .reduce((total, dimension) => total + dimension.weight, 0);

const DOMAIN_DIMENSION_RULES = Object.freeze({
  fitness: Object.freeze({
    expectedMilestoneProgress: ['fitness_programme_and_phase_match', 'fitness_progressive_stimulus_adequacy'],
    bottleneckLeverage: ['fitness_progressive_stimulus_adequacy'],
    routePrerequisiteCorrectness: ['fitness_programme_and_phase_match'],
    completeProfessionalUnit: ['fitness_progressive_stimulus_adequacy'],
    capabilityFit: ['fitness_progressive_stimulus_adequacy', 'fitness_recovery_and_safety_fit'],
    outcomeProofConfidence: ['fitness_proof_claim_honesty'],
  }),
  founder: Object.freeze({
    expectedMilestoneProgress: ['founder_market_reality_contact', 'founder_complete_business_output'],
    bottleneckLeverage: ['founder_bottleneck_leverage'],
    routePrerequisiteCorrectness: ['founder_stage_and_capacity_fit'],
    completeProfessionalUnit: ['founder_complete_business_output'],
    capabilityFit: ['founder_stage_and_capacity_fit'],
    outcomeProofConfidence: ['founder_complete_business_output', 'founder_integrity_and_legality'],
  }),
  learning: Object.freeze({
    expectedMilestoneProgress: ['learning_assessment_and_rubric_match', 'learning_complete_output_value'],
    bottleneckLeverage: ['learning_specific_gap_leverage'],
    routePrerequisiteCorrectness: ['learning_assessment_and_rubric_match', 'learning_integrity_and_submission_fit'],
    completeProfessionalUnit: ['learning_complete_output_value'],
    capabilityFit: ['learning_retrieval_or_application_quality'],
    outcomeProofConfidence: ['learning_complete_output_value', 'learning_integrity_and_submission_fit'],
  }),
  money: Object.freeze({
    expectedMilestoneProgress: ['money_goal_category_correctness', 'money_material_financial_progress'],
    bottleneckLeverage: ['money_goal_category_correctness', 'money_material_financial_progress'],
    routePrerequisiteCorrectness: ['money_cash_flow_and_obligation_fit'],
    completeProfessionalUnit: ['money_material_financial_progress'],
    capabilityFit: ['money_cash_flow_and_obligation_fit', 'money_risk_and_protection_integrity'],
    outcomeProofConfidence: ['money_material_financial_progress', 'money_privacy_minimisation'],
  }),
  creator: Object.freeze({
    expectedMilestoneProgress: ['creator_current_project_bottleneck', 'creator_complete_creative_output'],
    bottleneckLeverage: ['creator_current_project_bottleneck'],
    routePrerequisiteCorrectness: ['creator_current_project_bottleneck'],
    completeProfessionalUnit: ['creator_complete_creative_output'],
    capabilityFit: ['creator_medium_platform_audience_match'],
    outcomeProofConfidence: ['creator_complete_creative_output', 'creator_rights_and_metric_integrity'],
  }),
  athlete: Object.freeze({
    expectedMilestoneProgress: [
      'athlete_sport_position_event_specificity',
      'athlete_training_phase_correctness',
      'athlete_performance_bottleneck_leverage',
    ],
    bottleneckLeverage: ['athlete_performance_bottleneck_leverage'],
    routePrerequisiteCorrectness: ['athlete_training_phase_correctness', 'athlete_coach_programme_alignment'],
    completeProfessionalUnit: ['athlete_coach_programme_alignment'],
    capabilityFit: ['athlete_sport_position_event_specificity', 'athlete_recovery_and_safety_fit'],
    outcomeProofConfidence: ['athlete_recovery_and_safety_fit'],
  }),
});

if (MISSION_QUALITY_MAX_SCORE !== 100) {
  throw new Error(`Mission-quality rubric must total 100, received ${MISSION_QUALITY_MAX_SCORE}`);
}

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function unique(values) {
  return [...new Set(values)];
}

function missionEffort(proposal) {
  return proposal.missionStructure.kind === 'fixed'
    ? proposal.missionStructure.fixed.effortUnits
    : proposal.missionStructure.hard.effortUnits;
}

function dimension(definition, checks, evidenceGroups, extraReasons = [], domainFactor = 1) {
  const passed = checks.filter((item) => item.passed).length;
  const hasRequiredEvidence = evidenceGroups.every((group) => group.length > 0);
  const fraction = checks.length > 0 && hasRequiredEvidence
    ? (passed / checks.length) * domainFactor
    : 0;
  const evidenceIds = unique(evidenceGroups.flat());
  const reasons = [
    ...checks.filter((item) => !item.passed).map((item) => item.reason),
    ...extraReasons,
  ];
  if (!hasRequiredEvidence) reasons.push('Claim-bound evidence is missing for one or more dimension facts');
  return Object.freeze({
    label: definition.label,
    maxScore: definition.weight,
    earnedScore: round(definition.weight * fraction),
    reasons: Object.freeze(unique(reasons)),
    verifiedEvidenceIds: Object.freeze(unique(evidenceIds)),
    uncertainty: round(1 - fraction),
  });
}

function check(passed, reason) {
  return Object.freeze({ passed: Boolean(passed), reason });
}

function domainFactor(proposal, domainRuleResults, dimensionId) {
  const ruleIds = DOMAIN_DIMENSION_RULES[proposal.domainId]?.[dimensionId] || [];
  if (ruleIds.length === 0) return 1;
  const results = new Map(domainRuleResults.map((rule) => [rule.ruleId, rule]));
  return ruleIds.reduce(
    (sum, ruleId) => sum + (results.get(ruleId)?.derivedScoreContribution || 0),
    0,
  ) / ruleIds.length;
}

function domainEvidenceForDimension(proposal, domainRuleResults, dimensionId) {
  const ruleIds = new Set(DOMAIN_DIMENSION_RULES[proposal.domainId]?.[dimensionId] || []);
  return unique(domainRuleResults
    .filter((rule) => ruleIds.has(rule.ruleId))
    .flatMap((rule) => rule.verifiedEvidenceIds));
}

export function emptyDimensionScores() {
  return Object.freeze(Object.fromEntries(MISSION_QUALITY_RUBRIC.map((definition) => [
    definition.id,
    Object.freeze({
      label: definition.label,
      maxScore: definition.weight,
      earnedScore: 0,
      reasons: Object.freeze(['Evaluation input did not satisfy the contract']),
      verifiedEvidenceIds: Object.freeze([]),
      uncertainty: 1,
    }),
  ])));
}

/**
 * Derive all rubric dimensions without accepting candidate-authored scores.
 */
export function scoreMissionCandidate(
  context,
  proposal,
  pack,
  domainRuleResults,
  evidence,
  { preferenceEligible = false } = {},
) {
  const definitions = Object.fromEntries(MISSION_QUALITY_RUBRIC.map((item) => [item.id, item]));
  const domainAverage = domainRuleResults.length
    ? domainRuleResults.reduce((sum, rule) => sum + rule.derivedScoreContribution, 0) / domainRuleResults.length
    : 0;
  const workUnit = pack?.professionalWorkUnitTypes.find((item) => item.id === proposal.workUnitTypeId);
  const effort = missionEffort(proposal);
  const allResourcesAvailable = proposal.requiredResourceIds
    .every((resourceId) => context.availability.resourceIds.includes(resourceId));
  const preferenceEvidence = evidence.idsForContext('preference');
  const preferenceMatches = context.verifiedPreferences.preferredWorkUnitTypeIds.includes(proposal.workUnitTypeId)
    || context.verifiedPreferences.preferredMethodIds.includes(proposal.method.id);
  const outcomeMeasurable = deriveOutcomeMeasurability(context, proposal, evidence);

  const scores = {
    expectedMilestoneProgress: dimension(definitions.expectedMilestoneProgress, [
      check(pack?.supportedGoalCategories.includes(context.goal.category), 'Goal category is unsupported'),
      check(pack?.milestoneCategories.includes(context.activeMilestone.category), 'Active milestone category is unsupported'),
      check(proposal.targetMilestoneId === context.activeMilestone.id, 'Mission does not target the active milestone'),
      check(proposal.intendedOutcome.targetId === context.activeMilestone.id, 'Intended outcome points elsewhere'),
      check(outcomeMeasurable, 'Intended outcome lacks a bounded output, target, or claim-bound proof'),
      check(domainAverage >= 0.8, 'Domain derivation predicts weak milestone progress'),
    ], [
      evidence.idsForContext('goal'),
      evidence.idsForContext('milestone'),
      evidence.idsForProof(),
      domainEvidenceForDimension(proposal, domainRuleResults, 'expectedMilestoneProgress'),
    ], [], domainFactor(
      proposal,
      domainRuleResults,
      'expectedMilestoneProgress',
    )),

    bottleneckLeverage: dimension(definitions.bottleneckLeverage, [
      check(pack?.bottleneckCategories.includes(context.activeBottleneck.category), 'Active bottleneck category is unsupported'),
      check(proposal.targetBottleneckCategory === context.activeBottleneck.category, 'Mission does not target the active bottleneck'),
      check(domainRuleResults.some((rule) => rule.passed && (
        rule.ruleId.includes('bottleneck')
        || rule.ruleId.includes('stimulus')
        || rule.ruleId.includes('gap')
        || rule.ruleId.includes('financial_progress')
      )), 'No derived domain rule confirms bottleneck leverage'),
    ], [
      evidence.idsForContext('bottleneck'),
      evidence.idsForProof(),
      domainEvidenceForDimension(proposal, domainRuleResults, 'bottleneckLeverage'),
    ], [], domainFactor(
      proposal,
      domainRuleResults,
      'bottleneckLeverage',
    )),

    routePrerequisiteCorrectness: dimension(definitions.routePrerequisiteCorrectness, [
      check(proposal.targetRouteNodeId === context.routeNode.id, 'Mission targets the wrong route node'),
      check(context.routeNode.allowedWorkUnitTypeIds.includes(proposal.workUnitTypeId), 'Work unit is not allowed on the active route'),
      check(context.prerequisites.status === 'satisfied', 'A trusted prerequisite is missing'),
      check(proposal.targetMilestoneId === context.activeMilestone.id, 'Route does not terminate at the active milestone'),
    ], [
      evidence.idsForContext('route'),
      evidence.idsForContext('milestone'),
      domainEvidenceForDimension(proposal, domainRuleResults, 'routePrerequisiteCorrectness'),
    ], [], domainFactor(
      proposal,
      domainRuleResults,
      'routePrerequisiteCorrectness',
    )),

    completeProfessionalUnit: dimension(definitions.completeProfessionalUnit, [
      check(Boolean(workUnit), 'Work-unit type is not canonical for the domain'),
      check(proposal.missionSteps.length >= 2, 'Mission is not a complete multi-step professional unit'),
      check(proposal.missionSteps.every((step) => step.outputId), 'One or more steps lack a defined output'),
      check(outcomeMeasurable, 'Professional output lacks a bounded target or claim-bound proof'),
      check(Boolean(proposal.intendedOutcome.targetId), 'Professional output has no target'),
    ], [
      evidence.idsForContext('programme'),
      evidence.idsForContext('milestone'),
      evidence.idsForProof(),
      domainEvidenceForDimension(proposal, domainRuleResults, 'completeProfessionalUnit'),
    ], [], domainFactor(
      proposal,
      domainRuleResults,
      'completeProfessionalUnit',
    )),

    capabilityFit: dimension(definitions.capabilityFit, [
      check(context.capability.supportedMethodIds.includes(proposal.method.id), 'Method is not supported by verified capability'),
      check(effort <= context.capability.maxEffortUnits, 'Mission exceeds verified capability'),
      check(domainRuleResults.filter((rule) => rule.passed).length >= 4, 'Domain derivation does not support capability fit'),
    ], [
      evidence.idsForContext('capability'),
      evidence.idsForContext('programme'),
      domainEvidenceForDimension(proposal, domainRuleResults, 'capabilityFit'),
    ], [], domainFactor(
      proposal,
      domainRuleResults,
      'capabilityFit',
    )),

    timeResourcesRecoveryFit: dimension(definitions.timeResourcesRecoveryFit, [
      check(proposal.estimatedMinutes <= context.availability.availableMinutes, 'Mission exceeds available time'),
      check(allResourcesAvailable, 'One or more required resources are unavailable'),
      check(context.recovery.status !== 'recovery_required', 'Trusted readiness requires recovery'),
      check(effort <= context.recovery.maxEffortUnits, 'Mission exceeds the trusted recovery load'),
    ], [
      evidence.idsForContext('availability'),
      evidence.idsForContext('recovery'),
      evidence.idsForContext('constraints'),
    ]),

    outcomeProofConfidence: dimension(definitions.outcomeProofConfidence, [
      check(outcomeMeasurable, 'Outcome lacks a bounded output, target, or claim-bound proof'),
      check(evidence.proofCapabilityAssessment(pack).passed, 'Proof is incompatible with trusted proof capability'),
      check(proposal.proofPlan.claims.length > 0, 'Proof plan has no bounded claims'),
      check(evidence.idsForProof().length > 0, 'No claim-bound proof evidence supports interpretation'),
    ], [
      evidence.idsForProof(),
      domainEvidenceForDimension(proposal, domainRuleResults, 'outcomeProofConfidence'),
    ], [], domainFactor(
      proposal,
      domainRuleResults,
      'outcomeProofConfidence',
    )),

    verifiedPreferenceFit: dimension(definitions.verifiedPreferenceFit, [
      check(preferenceEligible, 'Preferences cannot score unless candidates are strategically near-equal'),
      check(preferenceMatches, 'Mission does not match a verified preference'),
    ], [preferenceEligible ? preferenceEvidence : []]),
  };

  const totalScore = round(Object.values(scores).reduce((sum, item) => sum + item.earnedScore, 0));
  return Object.freeze({
    totalScore,
    dimensionScores: Object.freeze(scores),
  });
}
