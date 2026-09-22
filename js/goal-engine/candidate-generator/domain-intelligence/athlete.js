/**
 * Athlete domain intelligence: preserves the coach programme, matches
 * sport/position/event, training phase, performance focus, and competition
 * sequence from trusted domain facts, and adapts technical load to recovery
 * and available resources. Never claims a sport-specific training route
 * requiring venue or equipment while none is confirmed available: such a
 * route is excluded entirely, and a genuinely resource-free canonical work
 * unit (review, recovery) is preferred as a fallback instead.
 *
 * A normal coach-aligned training session (technical/tactical/strength-
 * conditioning/phase/competition-preparation) must represent the complete
 * session — every drill, in the coach's own order, with its own sets/reps/
 * duration/intensity/recovery — never one drill standing in for the whole
 * session. That complete session can only come from the trusted coach
 * programme (see shared.js trustedPrescribedExecutionUnit); when the
 * programme does not carry one, the route is excluded rather than
 * fabricated. Recovery and performance review remain genuinely single-item
 * work, still produced as a single-item ProfessionalExecutionUnit.
 *
 * Athlete's canonical domain facts carry no explicit equipment list (unlike
 * Fitness's domainFacts.equipmentIds): there is no field in the schema
 * declaring what a given sport/session genuinely requires. Whatever the
 * user simply has confirmed available today is never treated as proof a
 * specific drill is viable — each drill declares its own trusted
 * requiredResourceIds on the item itself (the universal execution-item
 * resource field every domain shares — see unionOfItemRequiredResources,
 * candidate-contract.js), and every one of them must genuinely be
 * available.
 */

import {
  buildExecutionUnit,
  firstPairing,
  hardEffortFor,
  hasRequiredResources,
  isRecoveryDegraded,
  mediumEffortFor,
  missionStructureFor,
  progressionTargetFor,
  proofRequirementFor,
  timeBudgetFor,
  trustedMethodIdFor,
  trustedPrescribedExecutionUnit,
  twoStepPlan,
  unionOfItemRequiredResources,
} from './shared.js';

const BOTTLENECK_WORK_UNITS = Object.freeze({
  technical_execution_gap: ['athlete_technical_session'],
  tactical_decision_gap: ['athlete_tactical_session'],
  sport_specific_physical_gap: ['athlete_strength_conditioning_session'],
  recovery_or_load_issue: ['athlete_recovery_protocol'],
  programme_adherence: ['athlete_phase_session'],
  competition_preparation_gap: ['athlete_competition_preparation'],
});

const GOAL_CATEGORY_WORK_UNITS = Object.freeze({
  sport_performance: ['athlete_performance_review'],
  position_or_event_performance: ['athlete_technical_session'],
  technical_skill: ['athlete_technical_session'],
  tactical_skill: ['athlete_tactical_session'],
  strength_and_conditioning: ['athlete_strength_conditioning_session'],
  recovery: ['athlete_recovery_protocol'],
  training_phase: ['athlete_phase_session'],
  competition_readiness: ['athlete_competition_preparation'],
});

const STRATEGIC_PRINCIPLE = Object.freeze({
  athlete_technical_session: 'Sport- and position-specific technical practice against the named execution standard',
  athlete_tactical_session: 'Representative decision-practice tied to the athlete role and game model',
  athlete_strength_conditioning_session: 'The programme-prescribed physical preparation session for this phase',
  athlete_performance_review: 'Review competition or training evidence and decide the next intervention',
  athlete_recovery_protocol: 'The assigned recovery or return-to-training protocol',
  athlete_phase_session: 'The coach session appropriate to the current training phase',
  athlete_competition_preparation: 'A competition-readiness unit covering the relevant requirements',
});

// Sport-specific training/preparation work genuinely needs a venue or
// equipment (a court, a field, sport-specific gear). Review and recovery
// are analysis/check-in units that need nothing beyond the athlete's own
// evidence and are always resource-free. The same set doubles as "must
// represent the complete coach-prescribed session, not one drill": these
// are exactly the sessions a coach programme actually schedules.
const SESSION_WORK_UNITS = new Set([
  'athlete_technical_session',
  'athlete_tactical_session',
  'athlete_strength_conditioning_session',
  'athlete_competition_preparation',
  'athlete_phase_session',
]);

function relevantWorkUnitIds(request) {
  const canonicalIds = new Set(request.canonicalWorkUnits.map((wu) => wu.id));
  const priority = [
    ...(BOTTLENECK_WORK_UNITS[request.bottleneck.category] || []),
    ...(GOAL_CATEGORY_WORK_UNITS[request.goal.category] || []),
  ].filter((id) => canonicalIds.has(id));
  let ordered = [...new Set(priority)];
  if (isRecoveryDegraded(request) && canonicalIds.has('athlete_recovery_protocol') && !ordered.includes('athlete_recovery_protocol')) {
    ordered.unshift('athlete_recovery_protocol');
  }
  if (ordered.length === 0) ordered = [...canonicalIds].sort();

  // Every canonical work unit stays a candidate fallback, even when the
  // bottleneck/goal-category priority list did not happen to name a
  // currently resource-viable one. A session work unit is only viable when
  // the trusted programme actually prescribes one and every drill's own
  // trusted resources are genuinely available — never merely "some
  // resource is available".
  const withFallback = [...new Set([...ordered, ...[...canonicalIds].sort()])];
  return withFallback.filter((workUnitTypeId) => {
    if (!SESSION_WORK_UNITS.has(workUnitTypeId)) return true;
    const prescribed = trustedPrescribedExecutionUnit(request);
    if (!prescribed) return false;
    const union = unionOfItemRequiredResources(prescribed.items);
    return union !== null && hasRequiredResources(request, union);
  });
}

/**
 * Returns null when the request carries no trusted performance focus — the
 * caller must exclude the route rather than fall back to a fabricated
 * "general_performance" placeholder.
 */
function domainDetailsFor(request) {
  const facts = request.domainFacts;
  const performanceFocus = (facts.performanceFocuses || [])[0];
  if (!performanceFocus) return null;
  return {
    sport: facts.sport,
    positionOrEvent: facts.positionOrEvent,
    trainingPhase: facts.trainingPhase,
    // Must equal request.programme.programmeId: this is the one domainDetails
    // field response-validator.js checks against an approved external
    // programme, and silently diverging from it would be treated as an
    // unapproved programme replacement.
    coachProgrammeId: request.programme.programmeId,
    performanceFocus,
    competitionSequence: facts.competitionSequence || 'no_upcoming_competition',
    sportSpecific: true,
  };
}

/**
 * The complete coach-prescribed session for a sport-specific work unit —
 * every drill, in the coach's own order, with its own sets/reps/duration/
 * intensity/recovery/resources — sourced exclusively from the trusted coach
 * programme. Returns null when the programme does not carry a valid
 * prescription: the caller must exclude the route rather than invent a
 * session.
 */
function multiItemExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing }) {
  const prescribed = trustedPrescribedExecutionUnit(request);
  if (!prescribed) return null;
  return buildExecutionUnit({
    workUnitTypeId,
    unitType: 'multi_item_session',
    unitLabel: prescribed.unitLabel,
    unitSummary: `${prescribed.items.length} drills · ${timeBudgetMinutes} minutes`,
    items: prescribed.items,
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(
      measurableOutcome,
      'Beat the previous verified session by one rep, one round, or an approved intensity increase.',
    ),
    proofRequirement: proofRequirementFor(
      pairing.evidenceTypeId,
      pairing.proofMode,
      'Record the completed drill series and submit the required session evidence.',
    ),
  });
}

/**
 * A single-item ProfessionalExecutionUnit for genuinely single-item work:
 * performance review or the assigned recovery protocol. Never claims to be
 * a multi-drill session — it never was one — and genuinely requires no
 * resources, so `drillId` names the work unit's own already-trusted
 * canonical id rather than a fabricated drill that does not exist.
 */
function singleItemExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, hard, isRecoveryRoute, pairing }) {
  const item = {
    itemId: `${workUnitTypeId}_item_1`,
    order: 1,
    label: isRecoveryRoute ? 'Assigned recovery or return-to-training protocol' : (STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId),
    actionType: isRecoveryRoute ? 'complete_recovery_protocol' : 'complete_performance_review',
    effortUnits: hard,
    requiredResourceIds: [],
    domainItemDetails: {
      drillId: workUnitTypeId,
      sets: 1,
      repsOrDurationSeconds: isRecoveryRoute ? timeBudgetMinutes * 60 : 0,
      intensity: isRecoveryRoute ? 'low_recovery_intensity' : 'analysis_only',
      recoverySeconds: 0,
      competitionRelevant: false,
    },
  };
  return buildExecutionUnit({
    workUnitTypeId,
    unitType: 'single_item_session',
    unitLabel: STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId,
    unitSummary: isRecoveryRoute
      ? 'Complete the assigned recovery protocol and record readiness signals.'
      : 'Review evidence and decide the next coaching intervention.',
    items: [item],
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(measurableOutcome, isRecoveryRoute ? 'Restore full training readiness.' : 'Identify the principal performance bottleneck.'),
    proofRequirement: proofRequirementFor(pairing.evidenceTypeId, pairing.proofMode, 'Submit the required proof for this unit.'),
  });
}

function briefForWorkUnit(request, workUnitTypeId, index) {
  const pairing = firstPairing(request, workUnitTypeId);
  if (!pairing) return null;

  const methodId = trustedMethodIdFor(request);
  if (!methodId) return null;

  const domainDetailConstraints = domainDetailsFor(request);
  if (!domainDetailConstraints) return null;

  const isRecoveryRoute = workUnitTypeId === 'athlete_recovery_protocol';
  const hard = isRecoveryRoute ? 1 : hardEffortFor(request, { preferred: 7 });
  const medium = mediumEffortFor(hard);
  const structure = missionStructureFor(hard, medium);
  const claimCategoryId = pairing.sharedClaimCategoryIds[0];
  const outputCategoryId = pairing.sharedOutputCategoryIds[0];
  const timeBudgetMinutes = timeBudgetFor(request, { preferred: isRecoveryRoute ? 20 : 45 });
  const measurableOutcome = { type: `${workUnitTypeId}_outcome`, targetId: request.currentMilestone.id, measurable: true };

  const executionUnit = SESSION_WORK_UNITS.has(workUnitTypeId)
    ? multiItemExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing })
    : singleItemExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, hard, isRecoveryRoute, pairing });
  if (!executionUnit) return null;

  // The union of what the execution unit's own drills actually require is
  // the sole source of truth for the brief's requiredResourceIds — never
  // "whatever happens to be available". A prescription whose real per-drill
  // resources are not fully available must still exclude the route.
  const requiredResourceIds = unionOfItemRequiredResources(executionUnit.items);
  if (requiredResourceIds === null || !hasRequiredResources(request, requiredResourceIds)) return null;

  return {
    briefId: `athlete_brief_${index + 1}`,
    strategyLens: isRecoveryRoute ? 'recovery_before_further_load' : `${request.bottleneck.category}_via_${workUnitTypeId}`,
    workUnitTypeId,
    evidenceTypeId: pairing.evidenceTypeId,
    proofMode: pairing.proofMode,
    claimCategoryId,
    outputCategoryId,
    strategicReason: isRecoveryRoute
      ? `Recovery status is ${request.effortLimits.recoveryStatus}; the coach-assigned recovery protocol takes priority over further load.`
      : `${STRATEGIC_PRINCIPLE[workUnitTypeId]}, addressing the active bottleneck (${request.bottleneck.category}).`,
    method: { id: methodId, progressionIntent: isRecoveryRoute ? 'none' : 'maintain' },
    measurableOutcome,
    missionStepPlan: twoStepPlan(
      outputCategoryId,
      'prepare_session',
      isRecoveryRoute ? 'complete_recovery_protocol' : 'execute_sport_specific_session',
      hard,
    ),
    missionStructureKind: structure.missionStructureKind,
    timeBudgetMinutes,
    effortBudget: structure.effortBudget,
    requiredResourceIds,
    domainDetailConstraints,
    professionalExecutionUnit: executionUnit,
  };
}

/**
 * @param {object} request
 * @returns {object[]} 0-5 candidate briefs, genuinely distinct by work unit.
 */
export function planAthleteBriefs(request) {
  const briefs = [];
  for (const workUnitTypeId of relevantWorkUnitIds(request)) {
    const brief = briefForWorkUnit(request, workUnitTypeId, briefs.length);
    if (brief) briefs.push(brief);
  }
  return briefs;
}
