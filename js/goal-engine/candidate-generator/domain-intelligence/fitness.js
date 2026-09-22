/**
 * Fitness domain intelligence: preserves the active programme, selects the
 * correct muscles/movements/sets/progression from real trusted domain
 * facts, and adapts to recovery, equipment, and available time. Never
 * recommends a random exercise — every brief is driven by the active
 * bottleneck, the supported goal category, or (when neither maps) a stable
 * fallback over the request's own canonical work units. Never claims a
 * work unit requiring specific equipment while it is unavailable: such a
 * route is excluded entirely rather than silently produced with an empty
 * resource requirement, and a genuinely resource-free canonical work unit
 * is preferred as a fallback when equipment is missing.
 *
 * A normal session work unit (hypertrophy/strength/conditioning/adherence)
 * must represent the complete programmed session — every exercise, in
 * order, with its own sets/reps/load/rest — never one exercise standing in
 * for the whole session. That complete session can only come from the
 * trusted active programme (see shared.js trustedPrescribedExecutionUnit);
 * when the programme does not carry one, the route is excluded rather than
 * fabricated. A genuinely single-movement work unit (movement practice,
 * programme review, the assigned recovery protocol) still produces a
 * single-item ProfessionalExecutionUnit from real domain facts, since it
 * never claimed to be a multi-exercise session in the first place.
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

const PROGRESSION_ACTIONS = new Set(['none', 'maintain', 'increase_load', 'increase_reps', 'increase_difficulty', 'increase_duration']);

const BOTTLENECK_WORK_UNITS = Object.freeze({
  insufficient_progressive_overload: ['fitness_hypertrophy_session', 'fitness_strength_session'],
  technical_limit: ['fitness_movement_practice'],
  programme_non_adherence: ['fitness_adherence_block', 'fitness_programme_review'],
  recovery_deficit: ['fitness_recovery_protocol'],
  conditioning_specificity_gap: ['fitness_conditioning_session'],
  nutrition_or_energy_mismatch: ['fitness_programme_review'],
});

const GOAL_CATEGORY_WORK_UNITS = Object.freeze({
  hypertrophy: ['fitness_hypertrophy_session'],
  strength: ['fitness_strength_session'],
  fat_loss: ['fitness_conditioning_session'],
  conditioning: ['fitness_conditioning_session'],
  movement_skill: ['fitness_movement_practice'],
  recovery: ['fitness_recovery_protocol'],
  programme_adherence: ['fitness_adherence_block'],
});

const STRATEGIC_PRINCIPLE = Object.freeze({
  fitness_hypertrophy_session: 'Progressive hypertrophy overload on the active programme',
  fitness_strength_session: 'Progressive strength overload on the programmed lift',
  fitness_conditioning_session: 'Energy-system-specific conditioning against the current benchmark',
  fitness_movement_practice: 'Bounded technical practice against the named standard',
  fitness_programme_review: 'Evidence-based programme progression or deload decision',
  fitness_recovery_protocol: 'Assigned recovery protocol to restore training readiness',
  fitness_adherence_block: 'Complete the programme-defined block without substitution',
});

// The work units that genuinely depend on the programme's prescribed
// equipment. Everything else (technical practice, review, recovery) is
// resource-free and always executable regardless of equipment on hand.
const EQUIPMENT_DEPENDENT_WORK_UNITS = new Set([
  'fitness_hypertrophy_session',
  'fitness_strength_session',
  'fitness_conditioning_session',
  'fitness_adherence_block',
]);

// The same set doubles as "must represent the complete programmed session,
// not one exercise": a normal Arm Day/Push Day/Pull Day/Leg Day work unit
// is always equipment-prescribed, and genuinely single-movement work
// (movement practice, review, recovery) is always resource-free. Splitting
// this into a second, independent classification would risk the two
// drifting apart; they are the same real-world distinction.
const SESSION_WORK_UNITS = EQUIPMENT_DEPENDENT_WORK_UNITS;

/**
 * A cheap upfront estimate of what an equipment-dependent work unit will
 * require, used only to decide which work units are worth attempting to
 * plan at all (relevantWorkUnitIds) before the real execution unit — and
 * its items' own trusted requiredResourceIds — exists yet. Once a brief's
 * execution unit is actually built, requiredResourceIds is always
 * re-derived from the exact union of its items instead (see
 * unionOfItemRequiredResources, candidate-contract.js); this estimate is
 * never the value placed on the brief itself.
 */
function estimatedResourcesFor(request, workUnitTypeId) {
  if (!EQUIPMENT_DEPENDENT_WORK_UNITS.has(workUnitTypeId)) return [];
  return [...(request.domainFacts.equipmentIds || [])];
}

function relevantWorkUnitIds(request) {
  const canonicalIds = new Set(request.canonicalWorkUnits.map((wu) => wu.id));
  const priority = [
    ...(BOTTLENECK_WORK_UNITS[request.bottleneck.category] || []),
    ...(GOAL_CATEGORY_WORK_UNITS[request.goal.category] || []),
  ].filter((id) => canonicalIds.has(id));
  let ordered = [...new Set(priority)];

  // Degraded recovery surfaces the recovery-protocol route as a genuinely
  // distinct competing strategy, not merely a lower-effort version of the
  // same training route.
  if (isRecoveryDegraded(request) && canonicalIds.has('fitness_recovery_protocol') && !ordered.includes('fitness_recovery_protocol')) {
    ordered.unshift('fitness_recovery_protocol');
  }
  if (ordered.length === 0) ordered = [...canonicalIds].sort();

  // Every canonical work unit stays a candidate fallback, even when the
  // bottleneck/goal-category priority list did not happen to name a
  // currently resource-viable one: an equipment-dependent route with
  // missing equipment must not silently take the whole route down when a
  // genuinely resource-free canonical work unit is available instead.
  const withFallback = [...new Set([...ordered, ...[...canonicalIds].sort()])];
  return withFallback.filter((workUnitTypeId) => hasRequiredResources(request, estimatedResourcesFor(request, workUnitTypeId)));
}

function domainDetailsFor(request, workUnitTypeId, progressionAction) {
  const facts = request.domainFacts;
  const min = Number.isFinite(facts.minWorkingSets) ? facts.minWorkingSets : 1;
  const max = Number.isFinite(facts.maxWorkingSets) ? facts.maxWorkingSets : min;
  return {
    programmeId: request.programme.programmeId,
    trainingPhase: request.programme.stage,
    targetMuscleIds: facts.targetMuscleIds || [],
    movementIds: facts.movementIds || [],
    energySystemIds: facts.energySystemIds || [],
    workingSets: Math.min(Math.max(min, 1), max),
    effortTarget: facts.effortTarget || 'rir_1_2',
    progressionAction,
    equipmentIds: estimatedResourcesFor(request, workUnitTypeId),
  };
}

/**
 * The complete programmed session for an equipment-dependent work unit —
 * every prescribed exercise, in the programme's own order, with its own
 * sets/reps/load/rest — sourced exclusively from the trusted active
 * programme. Returns null when the programme does not carry a valid
 * prescription: the caller must exclude the route rather than invent a
 * workout, exactly like a missing proof pairing already does.
 */
function multiItemExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing }) {
  const prescribed = trustedPrescribedExecutionUnit(request);
  if (!prescribed) return null;
  return buildExecutionUnit({
    workUnitTypeId,
    unitType: 'multi_item_session',
    unitLabel: prescribed.unitLabel,
    unitSummary: `${prescribed.items.length} exercises · ${timeBudgetMinutes} minutes`,
    items: prescribed.items,
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(
      measurableOutcome,
      'Beat the previous verified session by one rep or an approved load increase.',
    ),
    proofRequirement: proofRequirementFor(
      pairing.evidenceTypeId,
      pairing.proofMode,
      'Record weight and reps for every working set and submit the completed training log.',
    ),
  });
}

/**
 * A single-item ProfessionalExecutionUnit for genuinely single-movement
 * work: technique practice, programme review, or the assigned recovery
 * protocol. Never claims to be a multi-exercise session — it never was
 * one — but still uses the same versioned contract, derived from the same
 * trusted domain facts the rest of the brief already uses. Returns null
 * when the request carries no trusted movement to name — never a
 * fabricated `${workUnitTypeId}_movement` placeholder; the caller must
 * exclude the route instead.
 */
function singleItemExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, hard, isRecoveryRoute, pairing }) {
  const facts = request.domainFacts;
  const movementId = (facts.movementIds || [])[0];
  if (!movementId) return null;

  const item = {
    itemId: `${workUnitTypeId}_item_1`,
    order: 1,
    label: isRecoveryRoute ? 'Assigned recovery protocol' : (STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId),
    actionType: isRecoveryRoute ? 'complete_recovery_protocol' : 'execute_technical_standard',
    effortUnits: hard,
    requiredResourceIds: [],
    domainItemDetails: {
      movementId,
      targetMuscleIds: facts.targetMuscleIds || [],
      sets: 1,
      repRangeLow: 1,
      repRangeHigh: 1,
      loadOrIntensity: 'bodyweight_or_technical',
      effortTarget: facts.effortTarget || 'technical_standard',
      restSeconds: 60,
      substitutionApproved: false,
    },
  };
  return buildExecutionUnit({
    workUnitTypeId,
    unitType: 'single_item_session',
    unitLabel: STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId,
    unitSummary: isRecoveryRoute
      ? 'Complete the assigned recovery protocol and record readiness signals.'
      : 'A single bounded technical or review unit, not a multi-exercise session.',
    items: [item],
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(measurableOutcome, isRecoveryRoute ? 'Restore full training readiness.' : 'Meet the named execution standard.'),
    proofRequirement: proofRequirementFor(pairing.evidenceTypeId, pairing.proofMode, 'Submit the required proof for this unit.'),
  });
}

function briefForWorkUnit(request, workUnitTypeId, index) {
  const pairing = firstPairing(request, workUnitTypeId);
  if (!pairing) return null;

  const methodId = trustedMethodIdFor(request);
  if (!methodId) return null;

  const isRecoveryRoute = workUnitTypeId === 'fitness_recovery_protocol';
  const hard = isRecoveryRoute ? 1 : hardEffortFor(request);
  const medium = mediumEffortFor(hard);
  const structure = missionStructureFor(hard, medium);
  const progressionAction = isRecoveryRoute
    ? 'none'
    : (request.domainFacts.requiredProgressionActions || []).find((action) => PROGRESSION_ACTIONS.has(action)) || 'maintain';
  const claimCategoryId = pairing.sharedClaimCategoryIds[0];
  const outputCategoryId = pairing.sharedOutputCategoryIds[0];
  const timeBudgetMinutes = timeBudgetFor(request, { preferred: isRecoveryRoute ? 20 : 45 });
  const measurableOutcome = { type: `${workUnitTypeId}_outcome`, targetId: request.currentMilestone.id, measurable: true };

  const executionUnit = SESSION_WORK_UNITS.has(workUnitTypeId)
    ? multiItemExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing })
    : singleItemExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, hard, isRecoveryRoute, pairing });
  if (!executionUnit) return null;

  // The union of what the execution unit's own items actually require is
  // the sole source of truth for the brief's requiredResourceIds — never
  // domainFacts.equipmentIds directly, which is only used as a cheap
  // upfront estimate above. A prescription whose real per-item equipment
  // is not fully available (even if the upfront estimate looked fine) must
  // still exclude the route rather than plan an unexecutable session.
  const requiredResourceIds = unionOfItemRequiredResources(executionUnit.items);
  if (requiredResourceIds === null || !hasRequiredResources(request, requiredResourceIds)) return null;

  return {
    briefId: `fitness_brief_${index + 1}`,
    strategyLens: isRecoveryRoute ? 'recovery_before_further_load' : `${request.bottleneck.category}_via_${workUnitTypeId}`,
    workUnitTypeId,
    evidenceTypeId: pairing.evidenceTypeId,
    proofMode: pairing.proofMode,
    claimCategoryId,
    outputCategoryId,
    strategicReason: isRecoveryRoute
      ? `Recovery status is ${request.effortLimits.recoveryStatus}; restoring readiness takes priority over further training load.`
      : `${STRATEGIC_PRINCIPLE[workUnitTypeId]}, addressing the active bottleneck (${request.bottleneck.category}).`,
    method: { id: methodId, progressionIntent: progressionAction },
    measurableOutcome,
    missionStepPlan: twoStepPlan(
      outputCategoryId,
      'prepare_session',
      isRecoveryRoute ? 'complete_recovery_protocol' : 'execute_progressive_working_sets',
      hard,
    ),
    missionStructureKind: structure.missionStructureKind,
    timeBudgetMinutes,
    effortBudget: structure.effortBudget,
    requiredResourceIds,
    domainDetailConstraints: domainDetailsFor(request, workUnitTypeId, progressionAction),
    professionalExecutionUnit: executionUnit,
  };
}

/**
 * @param {object} request
 * @returns {object[]} 0-5 candidate briefs, genuinely distinct by work unit.
 */
export function planFitnessBriefs(request) {
  const briefs = [];
  for (const workUnitTypeId of relevantWorkUnitIds(request)) {
    const brief = briefForWorkUnit(request, workUnitTypeId, briefs.length);
    if (brief) briefs.push(brief);
  }
  return briefs;
}
