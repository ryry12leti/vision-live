import { deriveOutcomeMeasurability } from './evidence.js';

/**
 * Deterministic domain-rule derivation for all six canonical packs.
 */

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function includesAll(container = [], required = []) {
  return required.every((value) => container.includes(value));
}

function overlaps(left = [], right = []) {
  return left.some((value) => right.includes(value));
}

function proofCompatible(pack, evidence) {
  return evidence.proofCapabilityAssessment(pack).passed;
}

function makeRule(ruleId, checks, evidenceGroups, clarificationWhen = false) {
  const failed = checks.filter((item) => !item.passed);
  const contribution = checks.length === 0 ? 0 : checks.filter((item) => item.passed).length / checks.length;
  const missingEvidence = evidenceGroups.some((group) => group.length === 0);
  const passed = failed.length === 0 && !missingEvidence;
  const reasons = failed.map((item) => item.reason);
  if (missingEvidence) reasons.push('Claim-bound verified evidence is missing for one or more required facts');
  return Object.freeze({
    ruleId,
    passed,
    derivedScoreContribution: round(contribution * (missingEvidence ? 0 : 1)),
    reasons: Object.freeze(reasons),
    verifiedEvidenceIds: Object.freeze([...new Set(evidenceGroups.flat())]),
    uncertainty: round(Math.min(1, (1 - contribution) + (missingEvidence ? 0.25 : 0))),
    clarificationRequired: clarificationWhen || missingEvidence,
  });
}

function check(passed, reason) {
  return Object.freeze({ passed: Boolean(passed), reason });
}

function domainEvidence(evidence, trusted, fields) {
  return evidence.idsForDomain(fields.map((field) => ({
    fact: field,
    operator: 'equals',
    value: trusted[field],
  })));
}

function fitnessRules(context, proposal, pack, evidence) {
  const trusted = context.domainFacts.facts;
  const details = proposal.domainDetails;
  const programmeDomainEvidence = domainEvidence(evidence, trusted, [
    'targetMuscleIds',
    'movementIds',
    'energySystemIds',
  ]);
  const stimulusDomainEvidence = domainEvidence(evidence, trusted, [
    'minWorkingSets',
    'maxWorkingSets',
    'effortTarget',
    'requiredProgressionActions',
    'equipmentIds',
  ]);
  const outcomeMeasurable = deriveOutcomeMeasurability(context, proposal, evidence);

  return [
    makeRule('fitness_goal_category_match', [
      check(pack.supportedGoalCategories.includes(context.goal.category), 'Goal category is not supported by Fitness'),
      check(proposal.targetMilestoneId === context.activeMilestone.id, 'Mission does not target the active fitness milestone'),
    ], [[...evidence.idsForContext('goal'), ...evidence.idsForContext('milestone')]]),
    makeRule('fitness_programme_and_phase_match', [
      check(details.programmeId === context.programme.id, 'Mission is not tied to the active programme'),
      check(details.trainingPhase === context.programme.stage, 'Mission does not match the active training phase'),
      check(overlaps(details.targetMuscleIds, trusted.targetMuscleIds)
        || overlaps(details.movementIds, trusted.movementIds)
        || overlaps(details.energySystemIds, trusted.energySystemIds),
      'Mission does not target the required muscle, movement, or energy system'),
    ], [evidence.idsForContext('programme'), programmeDomainEvidence], !context.programme.id),
    makeRule('fitness_progressive_stimulus_adequacy', [
      check(details.workingSets >= trusted.minWorkingSets, 'Working-set dose is below the programme minimum'),
      check(details.workingSets <= trusted.maxWorkingSets, 'Working-set dose exceeds the programme maximum'),
      check(details.effortTarget === trusted.effortTarget, 'Effort target does not match the active programme'),
      check(trusted.requiredProgressionActions.includes(details.progressionAction)
        && proposal.method.progressionIntent === details.progressionAction,
      'No verified progressive-overload or progression intent matches the programme'),
      check(includesAll(context.availability.resourceIds, details.equipmentIds), 'Required fitness equipment is unavailable'),
    ], [
      stimulusDomainEvidence,
      evidence.idsForContext('capability'),
      evidence.idsForContext('availability'),
    ]),
    makeRule('fitness_recovery_and_safety_fit', [
      check(context.recovery.status !== 'recovery_required', 'Trusted recovery state requires recovery instead of training'),
      check(proposal.missionStructure.kind === 'fixed'
        || proposal.missionStructure.hard.effortUnits <= context.recovery.maxEffortUnits,
      'Mission effort exceeds the trusted recovery limit'),
      check(!context.constraints.forbiddenMethodIds.includes(proposal.method.id), 'Method is forbidden by trusted safety constraints'),
      check(!context.constraints.medicalClearanceRequired || context.constraints.medicalClearancePresent,
        'Required medical clearance is missing'),
    ], [evidence.idsForContext('recovery'), evidence.idsForContext('constraints')]),
    makeRule('fitness_proof_claim_honesty', [
      check(proofCompatible(pack, evidence), 'Proof plan cannot verify this Fitness work unit'),
      check(proposal.proofPlan.claims.length > 0, 'Proof plan contains no bounded claims'),
      check(outcomeMeasurable, 'Fitness outcome lacks a bounded output, target, or claim-bound proof'),
    ], [evidence.idsForProof()]),
  ];
}

// Founder work units whose domainDetails genuinely carries a targetCustomerId
// (FOUNDER_DOMAIN_DETAIL_FIELDS_BY_WORK_UNIT in candidate-contract.js).
// Retention analysis, operating-process repair, and strategy decisions are
// genuinely internal: they have no customer field to check, so
// founder_market_reality_contact checks their own primary trusted route
// reference instead (see FOUNDER_ROUTE_REFERENCE_FIELD below).
const FOUNDER_CUSTOMER_FACING_WORK_UNITS = new Set(['founder_customer_interview_set', 'founder_sales_outreach_block']);
const FOUNDER_ROUTE_REFERENCE_FIELD = Object.freeze({
  founder_offer_test: 'targetSegmentId',
  founder_product_delivery_slice: 'productSliceId',
  founder_retention_analysis: 'cohortId',
  founder_operating_process: 'processId',
  founder_strategy_decision: 'decisionId',
});

function founderRules(context, proposal, pack, evidence) {
  const trusted = context.domainFacts.facts;
  const details = proposal.domainDetails;
  const marketEvidence = domainEvidence(evidence, trusted, [
    'businessStage',
    'targetCustomerIds',
    'activeBusinessFunctions',
    'requiredOutcomeTypes',
  ]);
  const outcomeMeasurable = deriveOutcomeMeasurability(context, proposal, evidence);
  return [
    makeRule('founder_bottleneck_leverage', [
      check(pack.bottleneckCategories.includes(context.activeBottleneck.category), 'Founder bottleneck category is unsupported'),
      check(proposal.targetBottleneckCategory === context.activeBottleneck.category, 'Mission does not target the active commercial bottleneck'),
      check(trusted.activeBusinessFunctions.includes(details.businessFunction), 'Business function does not address the active bottleneck'),
    ], [evidence.idsForContext('bottleneck'), marketEvidence]),
    makeRule('founder_market_reality_contact', [
      FOUNDER_CUSTOMER_FACING_WORK_UNITS.has(proposal.workUnitTypeId)
        ? check(trusted.targetCustomerIds.includes(details.targetCustomerId), 'Mission lacks contact with the verified target customer')
        : check(Boolean(details[FOUNDER_ROUTE_REFERENCE_FIELD[proposal.workUnitTypeId]]),
          'Mission lacks a verified trusted reference for this work unit'),
      check(['validation', 'sales', 'delivery', 'retention', 'operations', 'strategy'].includes(details.businessFunction),
        'Mission does not create direct customer or market contact'),
    ], [marketEvidence]),
    makeRule('founder_complete_business_output', [
      check(trusted.requiredOutcomeTypes.includes(details.outcomeTypeId),
        'Mission outcome is not the required measurable customer or business outcome'),
      check(Boolean(details.routeOutputId), 'Mission does not produce a named business evidence output'),
      check(outcomeMeasurable, 'Business outcome lacks a bounded output, target, or claim-bound proof'),
    ], [evidence.idsForContext('milestone'), marketEvidence, evidence.idsForProof()]),
    makeRule('founder_stage_and_capacity_fit', [
      check(details.businessStage === trusted.businessStage, 'Mission does not match the verified business stage'),
      check(details.businessStage === context.programme.stage, 'Mission conflicts with the active external or operating plan'),
      check(proposal.estimatedMinutes <= context.availability.availableMinutes, 'Mission exceeds available founder time'),
    ], [marketEvidence, evidence.idsForContext('programme'), evidence.idsForContext('availability')]),
    makeRule('founder_integrity_and_legality', [
      check(!context.constraints.illegalActionTypes.includes(details.businessFunction), 'Mission proposes an illegal business action'),
      check(!context.constraints.forbiddenActionTypes.some((type) => proposal.missionSteps.some((step) => step.actionType === type)),
        'Mission violates a trusted founder integrity constraint'),
      check(proofCompatible(pack, evidence), 'Proof plan cannot verify the founder work output'),
    ], [evidence.idsForContext('constraints'), evidence.idsForProof()]),
  ];
}

function learningRules(context, proposal, pack, evidence) {
  const trusted = context.domainFacts.facts;
  const details = proposal.domainDetails;
  const learningEvidence = domainEvidence(evidence, trusted, [
    'assessmentId',
    'rubricCriterionIds',
    'knowledgeGapIds',
    'requiredOutputIds',
    'learningStage',
    'allowedLearningMethods',
  ]);
  const outcomeMeasurable = deriveOutcomeMeasurability(context, proposal, evidence);
  return [
    makeRule('learning_assessment_and_rubric_match', [
      check(details.assessmentId === trusted.assessmentId, 'Mission targets the wrong assessment or learning requirement'),
      check(overlaps(details.rubricCriterionIds, trusted.rubricCriterionIds), 'Mission does not address a verified rubric criterion'),
      check(details.learningStage === trusted.learningStage, 'Mission does not match the current learning stage'),
    ], [learningEvidence, evidence.idsForContext('programme')]),
    makeRule('learning_specific_gap_leverage', [
      check(overlaps(details.knowledgeGapIds, trusted.knowledgeGapIds), 'Mission does not target the verified knowledge gap'),
      check(proposal.targetBottleneckCategory === context.activeBottleneck.category, 'Mission does not target the active learning bottleneck'),
    ], [learningEvidence, evidence.idsForContext('bottleneck')]),
    makeRule('learning_retrieval_or_application_quality', [
      check(trusted.allowedLearningMethods.includes(details.learningMethod), 'Learning method is not valid for the evidenced gap'),
      check(proposal.method.id === details.learningMethod, 'Structured method and domain learning method disagree'),
    ], [learningEvidence, evidence.idsForContext('capability')]),
    makeRule('learning_complete_output_value', [
      check(trusted.requiredOutputIds.includes(details.requiredOutputId), 'Mission does not create the required assessment output'),
      check(Boolean(details.completionEvidenceId), 'Mission lacks a defined completion or understanding artefact'),
      check(outcomeMeasurable, 'Learning outcome lacks a bounded output, target, or claim-bound proof'),
    ], [learningEvidence, evidence.idsForContext('milestone'), evidence.idsForProof()]),
    makeRule('learning_integrity_and_submission_fit', [
      check(!context.constraints.illegalActionTypes.some((type) => proposal.missionSteps.some((step) => step.actionType === type)),
        'Mission violates academic or legal integrity'),
      check(!context.constraints.forbiddenActionTypes.some((type) => proposal.missionSteps.some((step) => step.actionType === type)),
        'Mission violates a trusted assessment constraint'),
      check(proofCompatible(pack, evidence), 'Proof plan cannot verify the learning output'),
    ], [evidence.idsForContext('constraints'), evidence.idsForProof()]),
  ];
}

const RISK_LEVELS = Object.freeze(['low', 'moderate', 'high', 'extreme']);
const PRIVACY_COMPATIBLE_MONEY_EVIDENCE = new Set(['money_redacted_record_photo', 'money_hybrid_action']);

function moneyRules(context, proposal, pack, evidence) {
  const trusted = context.domainFacts.facts;
  const details = proposal.domainDetails;
  const financeEvidence = domainEvidence(evidence, trusted, [
    'financialCategory',
    'affordableAmount',
    'maximumRiskLevel',
    'legalActionTypes',
    'requiredOutcomeIds',
    'privacySafeProofRequired',
    'redactionConfirmed',
  ]);
  const privacyEvidence = evidence.idsForDomain([
    { fact: 'privacySafeProofRequired', operator: 'equals', value: trusted.privacySafeProofRequired },
    { fact: 'redactionConfirmed', operator: 'equals', value: true },
  ]);
  const outcomeMeasurable = deriveOutcomeMeasurability(context, proposal, evidence);
  return [
    makeRule('money_goal_category_correctness', [
      check(pack.supportedGoalCategories.includes(context.goal.category), 'Financial goal category is unsupported'),
      check(details.financialCategory === context.goal.category, 'Mission substitutes a different financial category'),
      check(details.financialCategory === trusted.financialCategory, 'Mission category conflicts with trusted financial facts'),
    ], [evidence.idsForContext('goal'), financeEvidence]),
    makeRule('money_material_financial_progress', [
      check(details.amount > 0, 'Mission has no material financial amount'),
      check(trusted.requiredOutcomeIds.includes(details.measurableOutcomeId), 'Mission lacks the required measurable financial outcome'),
      check(outcomeMeasurable, 'Financial outcome lacks a bounded output, target, or claim-bound proof'),
    ], [evidence.idsForContext('milestone'), financeEvidence, evidence.idsForProof()]),
    makeRule('money_cash_flow_and_obligation_fit', [
      check(details.amount <= trusted.affordableAmount, 'Mission is unaffordable under trusted cash-flow constraints'),
      check(details.amount >= 0, 'Mission amount is invalid'),
      check(proposal.estimatedMinutes <= context.availability.availableMinutes, 'Mission exceeds available administration time'),
    ], [financeEvidence, evidence.idsForContext('availability')]),
    makeRule('money_risk_and_protection_integrity', [
      check(RISK_LEVELS.indexOf(details.riskLevel) <= RISK_LEVELS.indexOf(trusted.maximumRiskLevel),
        'Mission risk exceeds verified capacity'),
      check(trusted.legalActionTypes.includes(details.actionType), 'Financial action is not legal or authorised'),
      check(!context.constraints.illegalActionTypes.includes(details.actionType), 'Financial action is prohibited by trusted constraints'),
    ], [financeEvidence, evidence.idsForContext('constraints')]),
    makeRule('money_privacy_minimisation', [
      check(!trusted.privacySafeProofRequired || trusted.redactionConfirmed,
        'Trusted evidence does not confirm required redaction or privacy minimisation'),
      check(PRIVACY_COMPATIBLE_MONEY_EVIDENCE.has(proposal.proofPlan.evidenceTypeId),
        'Selected proof type is not privacy-compatible for financial evidence'),
      check(proofCompatible(pack, evidence), 'Proof plan cannot verify the financial output safely'),
      check(evidence.idsForProof().length > 0, 'Proof claims are not supported by claim-bound evidence'),
    ], [privacyEvidence, evidence.idsForProof()]),
  ];
}

function creatorRules(context, proposal, pack, evidence) {
  const trusted = context.domainFacts.facts;
  const details = proposal.domainDetails;
  const creatorEvidence = domainEvidence(evidence, trusted, [
    'medium',
    'platform',
    'projectId',
    'productionStage',
    'audienceIds',
    'allowedDistributionActions',
    'requiredPublishableOutputs',
  ]);
  const rightsEvidence = evidence.idsForDomain([
    { fact: 'rightsCleared', operator: 'equals', value: true },
  ]);
  const outcomeMeasurable = deriveOutcomeMeasurability(context, proposal, evidence);
  return [
    makeRule('creator_medium_platform_audience_match', [
      check(details.medium === trusted.medium, 'Mission uses the wrong creative medium'),
      check(details.platform === trusted.platform, 'Mission uses the wrong platform'),
      check(trusted.audienceIds.includes(details.audienceId), 'Mission does not target the verified audience'),
    ], [creatorEvidence]),
    makeRule('creator_current_project_bottleneck', [
      check(details.projectId === trusted.projectId, 'Mission is not part of the active creative project'),
      check(details.productionStage === trusted.productionStage, 'Mission does not match the current production stage'),
      check(proposal.targetBottleneckCategory === context.activeBottleneck.category, 'Mission ignores the active creative bottleneck'),
    ], [creatorEvidence, evidence.idsForContext('bottleneck')]),
    makeRule('creator_complete_creative_output', [
      check(trusted.requiredPublishableOutputs.includes(details.publishableOutputId),
        'Mission does not create the required publishable output'),
      check(outcomeMeasurable, 'Creative outcome lacks a bounded output, target, or claim-bound proof'),
      check(proposal.missionSteps.length >= 2, 'Creative work unit is incomplete'),
    ], [creatorEvidence, evidence.idsForContext('milestone'), evidence.idsForProof()]),
    makeRule('creator_distribution_or_learning_value', [
      check(trusted.allowedDistributionActions.includes(details.distributionAction),
        'Mission lacks a valid audience distribution or learning action'),
      check(Boolean(details.audienceId), 'Mission lacks a defined audience'),
    ], [creatorEvidence]),
    makeRule('creator_rights_and_metric_integrity', [
      check(trusted.rightsCleared === true, 'Required creative rights or permissions are not cleared'),
      check(rightsEvidence.length > 0, 'Trusted evidence does not confirm required rights or permissions are cleared'),
      check(!context.constraints.illegalActionTypes.some((type) => proposal.missionSteps.some((step) => step.actionType === type)),
        'Mission violates rights or legal constraints'),
      check(proofCompatible(pack, evidence), 'Proof plan cannot verify the creative output'),
    ], [rightsEvidence, evidence.idsForContext('constraints'), evidence.idsForProof()]),
  ];
}

function athleteRules(context, proposal, pack, evidence) {
  const trusted = context.domainFacts.facts;
  const details = proposal.domainDetails;
  const athleteEvidence = domainEvidence(evidence, trusted, [
    'sport',
    'positionOrEvent',
    'trainingPhase',
    'coachProgrammeId',
    'performanceFocuses',
    'competitionSequence',
    'allowedSessionTypes',
  ]);
  return [
    makeRule('athlete_sport_position_event_specificity', [
      check(details.sport === trusted.sport, 'Mission targets the wrong sport'),
      check(details.positionOrEvent === trusted.positionOrEvent, 'Mission targets the wrong position or event'),
      check(details.trainingPhase === trusted.trainingPhase, 'Mission does not match the sport training phase'),
      check(trusted.performanceFocuses.includes(details.performanceFocus),
        'Mission does not target the sport-specific performance focus'),
      check(trusted.allowedSessionTypes.includes(proposal.workUnitTypeId),
        'Work unit is not sport- and phase-specific'),
    ], [athleteEvidence, evidence.idsForContext('programme')]),
    makeRule('athlete_training_phase_correctness', [
      check(details.trainingPhase === trusted.trainingPhase, 'Mission does not match the active athlete training phase'),
      check(details.competitionSequence === trusted.competitionSequence, 'Mission conflicts with the competition schedule'),
    ], [athleteEvidence, evidence.idsForContext('programme')]),
    makeRule('athlete_performance_bottleneck_leverage', [
      check(trusted.performanceFocuses.includes(details.performanceFocus),
        'Mission does not target the verified technical, tactical, or physical focus'),
      check(proposal.targetBottleneckCategory === context.activeBottleneck.category,
        'Mission does not target the active athlete bottleneck'),
    ], [athleteEvidence, evidence.idsForContext('bottleneck')]),
    makeRule('athlete_coach_programme_alignment', [
      check(details.coachProgrammeId === trusted.coachProgrammeId, 'Mission conflicts with the coach or programme'),
      check(details.coachProgrammeId === context.programme.id, 'Mission is not tied to the active athlete programme'),
      check(trusted.allowedSessionTypes.includes(proposal.workUnitTypeId), 'Work unit is not prescribed for this phase'),
    ], [athleteEvidence, evidence.idsForContext('programme')]),
    makeRule('athlete_recovery_and_safety_fit', [
      check(context.recovery.status !== 'recovery_required', 'Trusted recovery state blocks athlete training'),
      check(proposal.missionStructure.kind === 'fixed'
        || proposal.missionStructure.hard.effortUnits <= context.recovery.maxEffortUnits,
      'Session exceeds the trusted recovery load'),
      check(!context.constraints.medicalClearanceRequired || context.constraints.medicalClearancePresent,
        'Required athlete medical clearance is missing'),
      check(proofCompatible(pack, evidence), 'Proof plan cannot verify the athlete session'),
    ], [
      evidence.idsForContext('recovery'),
      evidence.idsForContext('constraints'),
      evidence.idsForProof(),
    ]),
  ];
}

const DOMAIN_EVALUATORS = Object.freeze({
  fitness: fitnessRules,
  founder: founderRules,
  learning: learningRules,
  money: moneyRules,
  creator: creatorRules,
  athlete: athleteRules,
});

export function evaluateDomainRules(context, proposal, pack, evidence) {
  const evaluator = DOMAIN_EVALUATORS[proposal.domainId];
  if (!pack || !evaluator) return Object.freeze([]);
  const results = evaluator(context, proposal, pack, evidence);
  const expected = new Set(pack.evaluationRuleIds);
  if (results.length !== expected.size || results.some((result) => !expected.has(result.ruleId))) {
    throw new Error(`Domain evaluator for ${proposal.domainId} does not match its canonical pack rule ids`);
  }
  return Object.freeze(results);
}
