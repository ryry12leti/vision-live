/**
 * Creator domain intelligence: matches medium, platform, project stage,
 * audience, and distribution route from trusted domain facts, and always
 * produces a real publishable output for the exact active project — never a
 * generic "post consistently" instruction. Rights/permission state is
 * passed through honestly; response-validator.js is the fail-closed
 * authority when rights are not actually cleared.
 *
 * A normal work unit must represent the complete ordered production unit —
 * every production/editing/release/distribution action, in order, not a
 * single vague action standing in for the whole unit. The checklist steps
 * are a fixed, safe professional procedure per work unit; the platform,
 * project, output, and rights filled into each step are the request's own
 * trusted domain facts, never invented.
 */

import {
  CREATOR_EXECUTION_CONTEXT_CONTRACT_VERSION,
} from '../../mission-evaluator/candidate-contract.js';
import {
  buildExecutionUnit,
  firstPairing,
  hardEffortFor,
  hasRequiredResources,
  mediumEffortFor,
  missionStructureFor,
  progressionTargetFor,
  proofRequirementFor,
  resourceIdsForBindingKeys,
  timeBudgetFor,
  trustedMethodIdFor,
  twoStepPlan,
  unionOfItemRequiredResources,
  validateExecutionContextRoute,
} from './shared.js';

const BOTTLENECK_WORK_UNITS = Object.freeze({
  weak_idea_selection: ['creator_content_brief'],
  production_throughput: ['creator_production_block'],
  editing_quality: ['creator_editing_pass'],
  publishing_friction: ['creator_publication_release'],
  distribution_reach: ['creator_distribution_campaign'],
  audience_mismatch: ['creator_audience_analysis'],
  monetisation_conversion: ['creator_monetisation_test'],
});

const GOAL_CATEGORY_WORK_UNITS = Object.freeze({
  ideation: ['creator_content_brief'],
  production: ['creator_production_block'],
  editing: ['creator_editing_pass'],
  publishing: ['creator_publication_release'],
  distribution: ['creator_distribution_campaign'],
  audience_learning: ['creator_audience_analysis'],
  consistency_systems: ['creator_content_brief'],
  monetisation: ['creator_monetisation_test'],
});

const STRATEGIC_PRINCIPLE = Object.freeze({
  creator_content_brief: 'A decision-ready brief for the named medium, platform, audience, and format',
  creator_production_block: 'A coherent production unit for the current project',
  creator_editing_pass: 'A bounded edit against the format standard',
  creator_publication_release: 'Publish the finished, rights-cleared work to the intended platform',
  creator_distribution_campaign: 'A platform-appropriate distribution block with a tracked outcome',
  creator_audience_analysis: 'Turn specific audience feedback into one creative decision',
  creator_monetisation_test: 'A bounded monetisation test connected to the real audience and medium',
});

// The fixed, ordered production checklist per work unit — a canonical
// professional procedure, never a per-project fabrication. Platform/
// project/output/rights are filled in from trusted domain facts.
const WORK_UNIT_CHECKLIST = Object.freeze({
  creator_content_brief: ['define_format_and_audience', 'draft_brief', 'confirm_brief_ready'],
  creator_production_block: ['prepare_production_assets', 'execute_production_block', 'record_production_output'],
  creator_editing_pass: ['review_against_format_standard', 'execute_edit_pass', 'confirm_edit_complete'],
  creator_publication_release: ['verify_release_assets_and_rights', 'publish_to_platform', 'notify_audience'],
  creator_distribution_campaign: ['prepare_distribution_assets', 'execute_distribution_action', 'record_tracked_outcome'],
  creator_audience_analysis: ['review_audience_feedback', 'decide_creative_change', 'record_decision'],
  creator_monetisation_test: ['confirm_test_conditions', 'execute_monetisation_test', 'record_test_outcome'],
});

// Versioned trusted resource contract: request.programme.requiredAttributes
// .creatorExecutionContext.routes[workUnitTypeId].resourceBindings — the
// exact trusted asset/platform/rights/analytics resources each work unit's
// checklist steps genuinely need (see shared.js validateExecutionContextRoute).
// Naming a platform or project in domainFacts never proves access to it
// exists; that access is only real when this trusted contract confirms it.
const CREATOR_ROUTE_CONTEXT_FIELDS = Object.freeze({
  creator_content_brief: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['audienceData', 'briefWorkspace'] }),
  }),
  creator_production_block: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['sourceAssets', 'productionWorkspace', 'outputWorkspace'] }),
  }),
  creator_editing_pass: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['sourceFootage', 'editingProject', 'exportWorkspace'] }),
  }),
  creator_publication_release: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['finalOutput', 'rightsClearanceRecord', 'platformAccess', 'publishingPermission', 'audienceChannel'] }),
  }),
  creator_distribution_campaign: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['publishedOutput', 'distributionAssets', 'channelAccess', 'trackingWorkspace'] }),
  }),
  creator_audience_analysis: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['analyticsAccess', 'feedbackDataset', 'decisionWorkspace'] }),
  }),
  creator_monetisation_test: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['monetisationConfig', 'platformAccess', 'performanceData', 'resultWorkspace'] }),
  }),
});

// Per work unit: which resourceBindingKeys apply to each checklist step, in
// the same order as WORK_UNIT_CHECKLIST — publishing a platform name is
// never proof of platform access, so "publish_to_platform" specifically
// requires platformAccess + publishingPermission, never the whole route's
// resource union.
const CREATOR_STEP_RESOURCE_BINDINGS = Object.freeze({
  creator_content_brief: [['audienceData'], ['briefWorkspace'], ['briefWorkspace']],
  creator_production_block: [['sourceAssets'], ['productionWorkspace'], ['outputWorkspace']],
  creator_editing_pass: [['sourceFootage'], ['editingProject'], ['editingProject', 'exportWorkspace']],
  creator_publication_release: [['finalOutput', 'rightsClearanceRecord'], ['platformAccess', 'publishingPermission'], ['audienceChannel']],
  creator_distribution_campaign: [['publishedOutput', 'distributionAssets'], ['channelAccess'], ['trackingWorkspace']],
  creator_audience_analysis: [['analyticsAccess', 'feedbackDataset'], ['feedbackDataset'], ['decisionWorkspace']],
  creator_monetisation_test: [['monetisationConfig'], ['platformAccess', 'monetisationConfig'], ['performanceData', 'resultWorkspace']],
});

const CHECKLIST_STEP_LABELS = Object.freeze({
  define_format_and_audience: 'Define the format and target audience',
  draft_brief: 'Draft the content brief',
  confirm_brief_ready: 'Confirm the brief is decision-ready',
  prepare_production_assets: 'Prepare the production assets',
  execute_production_block: 'Execute the production block',
  record_production_output: 'Record the production output',
  review_against_format_standard: 'Review against the format standard',
  execute_edit_pass: 'Execute the edit pass',
  confirm_edit_complete: 'Confirm the edit is complete',
  verify_release_assets_and_rights: 'Verify release assets and rights clearance',
  publish_to_platform: 'Publish to the intended platform',
  notify_audience: 'Notify the intended audience',
  prepare_distribution_assets: 'Prepare distribution assets',
  execute_distribution_action: 'Execute the distribution action',
  record_tracked_outcome: 'Record the tracked outcome',
  review_audience_feedback: 'Review the specific audience feedback',
  decide_creative_change: 'Decide the creative change',
  record_decision: 'Record the decision',
  confirm_test_conditions: 'Confirm the monetisation test conditions',
  execute_monetisation_test: 'Execute the monetisation test',
  record_test_outcome: 'Record the test outcome',
});

/**
 * Returns null when the request carries no trusted audience, distribution
 * action, or publishable output — the caller must exclude the route rather
 * than fall back to a fabricated "unspecified" or work-unit-derived
 * placeholder.
 */
function domainDetailsFor(request) {
  const facts = request.domainFacts;
  const audienceId = (facts.audienceIds || [])[0];
  const distributionAction = (facts.allowedDistributionActions || [])[0];
  const publishableOutputId = (facts.requiredPublishableOutputs || [])[0];
  if (!audienceId || !distributionAction || !publishableOutputId) return null;
  return {
    medium: facts.medium,
    platform: facts.platform,
    projectId: facts.projectId,
    productionStage: facts.productionStage,
    audienceId,
    distributionAction,
    publishableOutputId,
    rightsCleared: Boolean(facts.rightsCleared),
  };
}

function relevantWorkUnitIds(request) {
  const canonicalIds = new Set(request.canonicalWorkUnits.map((wu) => wu.id));
  const priority = [
    ...(BOTTLENECK_WORK_UNITS[request.bottleneck.category] || []),
    ...(GOAL_CATEGORY_WORK_UNITS[request.goal.category] || []),
  ].filter((id) => canonicalIds.has(id));
  const ordered = [...new Set(priority)];
  if (ordered.length === 0) return [...canonicalIds].sort();
  return ordered;
}

/**
 * The complete ordered production/publishing/distribution unit: the work
 * unit's fixed checklist, each step carrying the request's own trusted
 * platform/project/output/rights and the exact trusted resources that
 * exact step needs. Returns null when creatorExecutionContext does not
 * carry a valid resourceBindings entry for this route — the caller must
 * exclude the route rather than let publishing/production proceed on
 * assumed access.
 */
function executionUnitFor(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard, domainDetails }) {
  const checklist = WORK_UNIT_CHECKLIST[workUnitTypeId];
  if (!checklist) return null;
  const route = validateExecutionContextRoute(
    request, 'creatorExecutionContext', CREATOR_EXECUTION_CONTEXT_CONTRACT_VERSION, CREATOR_ROUTE_CONTEXT_FIELDS, workUnitTypeId,
  );
  if (!route) return null;
  const stepBindings = CREATOR_STEP_RESOURCE_BINDINGS[workUnitTypeId];

  const perItemEffort = Math.max(1, Math.floor(hard / checklist.length));
  const items = checklist.map((actionType, index) => ({
    itemId: `${workUnitTypeId}_item_${index + 1}`,
    order: index + 1,
    label: CHECKLIST_STEP_LABELS[actionType] || actionType,
    actionType,
    effortUnits: perItemEffort,
    requiredResourceIds: resourceIdsForBindingKeys(route, stepBindings[index]),
    domainItemDetails: {
      platform: domainDetails.platform,
      projectId: domainDetails.projectId,
      requiredPublishableOutputId: domainDetails.publishableOutputId,
      rightsCleared: domainDetails.rightsCleared,
    },
  }));

  return buildExecutionUnit({
    workUnitTypeId,
    unitType: 'multi_item_session',
    unitLabel: STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId,
    unitSummary: `${items.length} ordered production actions · ${timeBudgetMinutes} minutes`,
    items,
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(measurableOutcome, 'Ship this unit for the exact active project, on platform, with rights confirmed.'),
    proofRequirement: proofRequirementFor(pairing.evidenceTypeId, pairing.proofMode, 'Submit evidence of the finished, rights-cleared output for this unit.'),
  });
}

function briefForWorkUnit(request, workUnitTypeId, index) {
  const pairing = firstPairing(request, workUnitTypeId);
  if (!pairing) return null;

  const methodId = trustedMethodIdFor(request);
  if (!methodId) return null;

  const hard = hardEffortFor(request, { preferred: 6 });
  const medium = mediumEffortFor(hard);
  const structure = missionStructureFor(hard, medium);
  const claimCategoryId = pairing.sharedClaimCategoryIds[0];
  const outputCategoryId = pairing.sharedOutputCategoryIds[0];
  const timeBudgetMinutes = timeBudgetFor(request, { preferred: 45 });
  const measurableOutcome = { type: `${workUnitTypeId}_outcome`, targetId: request.currentMilestone.id, measurable: true };
  const domainDetails = domainDetailsFor(request);
  if (!domainDetails) return null;

  const executionUnit = executionUnitFor(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard, domainDetails });
  if (!executionUnit) return null;

  // The union of what the execution unit's own items actually require is
  // the sole source of truth for the brief's requiredResourceIds. A
  // publishing/production route whose real per-step resources (final
  // output, rights clearance, platform access, ...) are not fully
  // available must still exclude the route rather than plan an
  // unexecutable release.
  const requiredResourceIds = unionOfItemRequiredResources(executionUnit.items);
  if (requiredResourceIds === null || !hasRequiredResources(request, requiredResourceIds)) return null;

  return {
    briefId: `creator_brief_${index + 1}`,
    strategyLens: `${request.bottleneck.category}_via_${workUnitTypeId}`,
    workUnitTypeId,
    evidenceTypeId: pairing.evidenceTypeId,
    proofMode: pairing.proofMode,
    claimCategoryId,
    outputCategoryId,
    strategicReason: `${STRATEGIC_PRINCIPLE[workUnitTypeId]}, addressing the active bottleneck (${request.bottleneck.category}).`,
    method: { id: methodId, progressionIntent: 'maintain' },
    measurableOutcome,
    missionStepPlan: twoStepPlan(outputCategoryId, 'prepare_asset_and_rights', 'complete_and_record_output', hard),
    missionStructureKind: structure.missionStructureKind,
    timeBudgetMinutes,
    effortBudget: structure.effortBudget,
    requiredResourceIds,
    domainDetailConstraints: domainDetails,
    professionalExecutionUnit: executionUnit,
  };
}

/**
 * @param {object} request
 * @returns {object[]} 0-5 candidate briefs, genuinely distinct by work unit.
 */
export function planCreatorBriefs(request) {
  const briefs = [];
  for (const workUnitTypeId of relevantWorkUnitIds(request)) {
    const brief = briefForWorkUnit(request, workUnitTypeId, briefs.length);
    if (brief) briefs.push(brief);
  }
  return briefs;
}
