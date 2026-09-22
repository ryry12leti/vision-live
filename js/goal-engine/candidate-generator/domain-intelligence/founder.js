/**
 * Founder domain intelligence: prioritises real customer, sales, product,
 * or delivery evidence over generic planning. A bottleneck that names a
 * customer/sales/demand gap always routes to a customer-contact work unit
 * when one is available — operating-process or strategy work is only
 * selected when the bottleneck is genuinely operational or strategic.
 *
 * Two structurally distinct execution shapes exist:
 *
 * - Customer-batch work units (interview set, sales outreach block): one
 *   ordered contact item per confirmed trusted target customer
 *   (domainFacts.targetCustomerIds), plus a closing synthesis item — never
 *   a single vague "contact customers" item standing in for the batch, and
 *   never an invented customer.
 * - Checklist-style work units (offer test, product delivery slice,
 *   retention analysis, operating process, strategy decision): a fixed,
 *   safe professional procedure, each step referencing the exact trusted
 *   fact this route is about (offer, product slice, retention cohort,
 *   process, or decision).
 *
 * Every work unit's route-specific facts (a real customer interview result,
 * an offer, a product slice, a retention cohort, a process, a strategy
 * decision) AND every item's real requiredResourceIds (CRM/contact access,
 * repository/build/test environments, analytics access, process tooling,
 * decision evidence, ...) come from the versioned `founderExecutionContext`
 * trusted contract (request.programme.requiredAttributes.
 * founderExecutionContext, validated by shared.js's
 * validateExecutionContextRoute against FOUNDER_ROUTE_CONTEXT_FIELDS) —
 * never domainFacts.targetCustomerIds standing in for a fact it does not
 * represent, and never a fabricated `${domainId}_unspecified_customer`
 * placeholder or an empty requiredResourceIds for an action that genuinely
 * depends on files, tools, or access. When the trusted context does not
 * carry the exact field or resource binding a route needs, the route is
 * excluded — and when a required resource is trusted but not currently
 * available, the route is excluded the same way Fitness/Athlete equipment
 * unavailability excludes theirs (see hasRequiredResources below).
 *
 * Retention analysis, operating-process repair, and strategy decisions are
 * genuinely internal work: their domainDetails (FOUNDER_DOMAIN_DETAIL_
 * FIELDS_BY_WORK_UNIT in candidate-contract.js) carry no targetCustomerId
 * field at all, so a missing customer can never block them, and their
 * resource bindings never include customer/CRM resources either.
 */

import {
  FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION,
  FOUNDER_ROUTE_CONTEXT_FIELDS,
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
  insufficient_customer_evidence: ['founder_customer_interview_set'],
  weak_demand: ['founder_offer_test', 'founder_customer_interview_set'],
  sales_conversion: ['founder_sales_outreach_block', 'founder_offer_test'],
  delivery_throughput: ['founder_product_delivery_slice', 'founder_operating_process'],
  retention_failure: ['founder_retention_analysis'],
  operational_constraint: ['founder_operating_process'],
  strategic_ambiguity: ['founder_strategy_decision'],
});

const GOAL_CATEGORY_WORK_UNITS = Object.freeze({
  validation: ['founder_offer_test', 'founder_customer_interview_set'],
  customer_discovery: ['founder_customer_interview_set'],
  sales: ['founder_sales_outreach_block'],
  product_delivery: ['founder_product_delivery_slice'],
  retention: ['founder_retention_analysis'],
  operations: ['founder_operating_process'],
  strategy: ['founder_strategy_decision'],
});

const STRATEGIC_PRINCIPLE = Object.freeze({
  founder_customer_interview_set: 'Direct customer-evidence collection against the current hypothesis',
  founder_sales_outreach_block: 'Real prospecting or follow-up with a defined segment and tracked outcome',
  founder_product_delivery_slice: 'Ship a usable product slice that produces real customer feedback',
  founder_retention_analysis: 'Analyse the retention cohort and decide the next intervention',
  founder_operating_process: 'Repair the operating process actually blocking delivery',
  founder_strategy_decision: 'Make a bounded decision from explicit market and execution evidence',
  founder_offer_test: 'Run an end-to-end offer test against a real customer and ask',
});

// The trusted activeBusinessFunctions entry each work unit genuinely
// belongs to — a fixed, professional-procedure mapping (like
// STRATEGIC_PRINCIPLE), never a per-request guess. The route is only
// planned when the business's own trusted active-function list actually
// confirms it; picking domainFacts.activeBusinessFunctions[0] regardless of
// route (the prior behaviour) could silently label a retention mission
// "sales".
const FOUNDER_WORK_UNIT_BUSINESS_FUNCTION = Object.freeze({
  founder_customer_interview_set: 'validation',
  founder_sales_outreach_block: 'sales',
  founder_offer_test: 'validation',
  founder_product_delivery_slice: 'delivery',
  founder_retention_analysis: 'retention',
  founder_operating_process: 'operations',
  founder_strategy_decision: 'strategy',
});

// Customer-batch work units: one ordered item per confirmed trusted target
// customer, plus a closing synthesis item. Distinct actionType/referenceType
// per work unit, never a shared generic action for every route.
// `itemResourceBindingKeys`/`synthesisResourceBindingKeys` are functions of
// the validated route (so an omitted optional binding, e.g. notesWorkspace,
// simply contributes no resources) naming which FOUNDER_ROUTE_CONTEXT_
// FIELDS[...].resourceBindingKeys apply to every customer item vs. the
// closing synthesis item — every customer item shares the same resources
// (one CRM/channel/question-set genuinely serves the whole batch), the
// synthesis item requires only the result workspace.
const CUSTOMER_BATCH_WORK_UNITS = Object.freeze({
  founder_customer_interview_set: Object.freeze({
    itemActionType: 'conduct_structured_interview',
    itemLabel: (id) => `Interview ${id}`,
    referenceType: 'target_customer',
    synthesisActionType: 'synthesize_interview_findings',
    synthesisLabel: 'Synthesize interview findings against the current hypothesis',
    synthesisReferenceType: 'interview_synthesis',
    unitSummaryNoun: 'confirmed target customer',
    itemResourceBindingKeys: (route) => ['contactAccess', 'questionSet', 'channel', ...(route.resourceBindings.notesWorkspace ? ['notesWorkspace'] : [])],
    synthesisResourceBindingKeys: () => ['resultWorkspace'],
  }),
  founder_sales_outreach_block: Object.freeze({
    itemActionType: 'contact_and_record_outcome',
    itemLabel: (id) => `Contact ${id}`,
    referenceType: 'target_customer',
    synthesisActionType: 'record_batch_result',
    synthesisLabel: 'Record the batch result across every outreach/follow-up',
    synthesisReferenceType: 'outreach_batch_result',
    unitSummaryNoun: 'confirmed target customer',
    itemResourceBindingKeys: (route) => ['crmAccess', 'channel', ...(route.resourceBindings.offerRecord ? ['offerRecord'] : [])],
    synthesisResourceBindingKeys: () => ['resultWorkspace'],
  }),
});

// Checklist-style work units: a fixed, safe professional procedure. Every
// step references the same trusted fact (referenceId), sourced from the
// validated founderExecutionContext route. `stepResourceBindingKeys` is one
// function-of-the-validated-route per step, in order — each step only
// requires the exact resources its own action needs, never the route's
// whole resource union.
const CHECKLIST_WORK_UNITS = Object.freeze({
  founder_offer_test: Object.freeze({
    steps: ['confirm_offer_and_segment', 'present_offer', 'capture_offer_response', 'record_offer_test_result'],
    referenceType: 'offer',
    primaryField: 'offerId',
    supportingField: 'targetSegmentId',
    stepResourceBindingKeys: [
      () => ['offerRecord', 'segmentRecord'],
      (route) => ['presentationChannel', ...(route.resourceBindings.testAudienceAccess ? ['testAudienceAccess'] : [])],
      () => ['responseCaptureRecord'],
      () => ['resultWorkspace'],
    ],
  }),
  founder_product_delivery_slice: Object.freeze({
    steps: ['identify_product_slice', 'complete_delivery_implementation', 'verify_acceptance_criteria', 'deliver_to_customer', 'record_delivery_result'],
    referenceType: 'product_slice',
    primaryField: 'productSliceId',
    supportingField: 'acceptanceCriteriaIds',
    stepResourceBindingKeys: [
      () => ['productSpec', 'acceptanceCriteria'],
      () => ['repositoryAccess', 'buildEnvironment'],
      () => ['testEnvironment', 'acceptanceCriteria'],
      (route) => ['deliveryAccess', ...(route.resourceBindings.customerDeliveryChannel ? ['customerDeliveryChannel'] : [])],
      () => ['resultWorkspace'],
    ],
  }),
  founder_retention_analysis: Object.freeze({
    steps: ['inspect_retention_cohort_evidence', 'identify_material_drop_off', 'determine_likely_cause', 'select_intervention', 'record_retention_decision'],
    referenceType: 'retention_cohort',
    primaryField: 'cohortId',
    supportingField: 'dataSourceId',
    stepResourceBindingKeys: [
      () => ['cohortData', 'analyticsAccess'],
      () => ['analyticsAccess', 'metricDefinitions'],
      () => ['analyticsAccess', 'metricDefinitions'],
      (route) => (route.resourceBindings.interventionEvidence ? ['interventionEvidence'] : ['analyticsAccess']),
      () => ['decisionWorkspace'],
    ],
  }),
  founder_operating_process: Object.freeze({
    steps: ['inspect_current_process', 'identify_failure_point', 'apply_process_repair', 'verify_revised_process', 'record_operational_outcome'],
    referenceType: 'operating_process',
    primaryField: 'processId',
    supportingField: null,
    stepResourceBindingKeys: [
      () => ['processDocumentation', 'toolAccess'],
      () => ['processDocumentation', 'operationalRecord'],
      () => ['toolAccess'],
      () => ['verificationEnvironment'],
      () => ['outcomeWorkspace'],
    ],
  }),
  founder_strategy_decision: Object.freeze({
    steps: ['review_relevant_evidence', 'compare_trusted_options', 'select_strategy_route', 'record_strategy_decision'],
    referenceType: 'strategy_decision',
    primaryField: 'decisionId',
    supportingField: 'optionIds',
    stepResourceBindingKeys: [
      () => ['decisionEvidence'],
      () => ['optionRecords', 'decisionCriteria'],
      () => ['optionRecords', 'decisionCriteria'],
      () => ['decisionWorkspace'],
    ],
  }),
});

const CHECKLIST_STEP_LABELS = Object.freeze({
  confirm_offer_and_segment: 'Confirm the trusted offer and target segment',
  present_offer: 'Present the offer to the confirmed customer',
  capture_offer_response: 'Capture acceptance, rejection, or objection',
  record_offer_test_result: 'Record the offer-test result',
  identify_product_slice: 'Identify the trusted product slice and required output',
  complete_delivery_implementation: 'Complete implementation or delivery of the product slice',
  verify_acceptance_criteria: 'Verify the slice meets its acceptance criteria',
  deliver_to_customer: 'Deliver the slice to the confirmed customer',
  record_delivery_result: 'Record the delivery result and customer evidence',
  inspect_retention_cohort_evidence: 'Inspect the retention cohort evidence',
  identify_material_drop_off: 'Identify the material drop-off',
  determine_likely_cause: 'Determine the likely cause from trusted evidence',
  select_intervention: 'Choose one intervention',
  record_retention_decision: 'Record the analysis and decision',
  inspect_current_process: 'Inspect the current operating process',
  identify_failure_point: 'Identify the exact failure point',
  apply_process_repair: 'Apply the repair',
  verify_revised_process: 'Verify the revised process',
  record_operational_outcome: 'Record the operational outcome',
  review_relevant_evidence: 'Review the relevant trusted evidence',
  compare_trusted_options: 'Compare the trusted options against the decision criteria',
  select_strategy_route: 'Select the route and note the assumptions and next action',
  record_strategy_decision: 'Record the decision',
});

// Route field contracts for founderExecutionContext.routes[workUnitTypeId]
// (see shared.js validateExecutionContextRoute) now live in
// mission-evaluator/candidate-contract.js's FOUNDER_ROUTE_CONTEXT_FIELDS
// (imported above) -- the single shared source of truth every builder of a
// real founderExecutionContext (see js/goal-engine/founder-execution-context/)
// must import, rather than a second, independently-drifting copy.

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

function founderExecutionContextRouteFor(request, workUnitTypeId) {
  return validateExecutionContextRoute(
    request, 'founderExecutionContext', FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION, FOUNDER_ROUTE_CONTEXT_FIELDS, workUnitTypeId,
  );
}

/**
 * Discriminated per-work-unit domainDetails (FOUNDER_DOMAIN_DETAIL_FIELDS_
 * BY_WORK_UNIT in candidate-contract.js). Returns null when any field this
 * exact work unit requires is not genuinely trusted — the caller must
 * exclude the route rather than fall back to a fabricated
 * `${domainId}_unspecified_customer` placeholder or a generic 'sales'/
 * 'customer_commitment' default.
 */
function domainDetailsFor(request, workUnitTypeId) {
  const facts = request.domainFacts;
  const businessFunction = FOUNDER_WORK_UNIT_BUSINESS_FUNCTION[workUnitTypeId];
  if (!(facts.activeBusinessFunctions || []).includes(businessFunction)) return null;
  const outcomeTypeId = (facts.requiredOutcomeTypes || [])[0];
  if (!outcomeTypeId) return null;

  const common = { businessStage: facts.businessStage, businessFunction, outcomeTypeId };

  if (CUSTOMER_BATCH_WORK_UNITS[workUnitTypeId]) {
    const targetCustomerId = (facts.targetCustomerIds || [])[0];
    if (!targetCustomerId) return null;
    const route = founderExecutionContextRouteFor(request, workUnitTypeId);
    if (!route) return null;
    return { ...common, targetCustomerId, routeOutputId: route.resultOutputId };
  }

  const spec = CHECKLIST_WORK_UNITS[workUnitTypeId];
  const route = founderExecutionContextRouteFor(request, workUnitTypeId);
  if (!route) return null;
  const routeOutputId = route[FOUNDER_ROUTE_CONTEXT_FIELDS[workUnitTypeId].routeOutputField];

  if (workUnitTypeId === 'founder_offer_test') {
    return { ...common, offerId: route.offerId, targetSegmentId: route.targetSegmentId, routeOutputId };
  }
  if (workUnitTypeId === 'founder_product_delivery_slice') {
    return { ...common, productSliceId: route.productSliceId, acceptanceCriteriaIds: route.acceptanceCriteriaIds, routeOutputId };
  }
  if (workUnitTypeId === 'founder_retention_analysis') {
    return { ...common, cohortId: route.cohortId, dataSourceId: route.dataSourceId, routeOutputId };
  }
  if (workUnitTypeId === 'founder_operating_process') {
    return { ...common, processId: route.processId, routeOutputId };
  }
  if (workUnitTypeId === 'founder_strategy_decision') {
    return { ...common, decisionId: route.decisionId, optionIds: route.optionIds, routeOutputId };
  }
  return null;
}

/**
 * The complete customer-evidence batch: one ordered item per confirmed
 * trusted target customer, plus a closing synthesis item. Returns null when
 * the request carries no confirmed target customer — the caller must
 * exclude the route rather than invent one to contact.
 */
function customerBatchExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard }) {
  const spec = CUSTOMER_BATCH_WORK_UNITS[workUnitTypeId];
  const targetCustomerIds = request.domainFacts.targetCustomerIds || [];
  if (targetCustomerIds.length === 0) return null;
  const route = founderExecutionContextRouteFor(request, workUnitTypeId);
  if (!route) return null;

  const itemRequiredResourceIds = resourceIdsForBindingKeys(route, spec.itemResourceBindingKeys(route));
  const synthesisRequiredResourceIds = resourceIdsForBindingKeys(route, spec.synthesisResourceBindingKeys(route));

  const totalItems = targetCustomerIds.length + 1;
  const perItemEffort = Math.max(1, Math.floor(hard / totalItems));

  const items = targetCustomerIds.map((targetCustomerId, index) => ({
    itemId: `${workUnitTypeId}_item_${index + 1}`,
    order: index + 1,
    label: spec.itemLabel(targetCustomerId),
    actionType: spec.itemActionType,
    effortUnits: perItemEffort,
    requiredResourceIds: itemRequiredResourceIds,
    domainItemDetails: {
      referenceId: targetCustomerId,
      referenceType: spec.referenceType,
      supportingReferenceId: request.programme.programmeId,
    },
  }));
  items.push({
    itemId: `${workUnitTypeId}_item_${items.length + 1}`,
    order: items.length + 1,
    label: spec.synthesisLabel,
    actionType: spec.synthesisActionType,
    effortUnits: Math.max(1, hard - (perItemEffort * targetCustomerIds.length)),
    requiredResourceIds: synthesisRequiredResourceIds,
    domainItemDetails: {
      referenceId: route.resultOutputId,
      referenceType: spec.synthesisReferenceType,
      supportingReferenceId: targetCustomerIds[0],
    },
  });

  return buildExecutionUnit({
    workUnitTypeId,
    unitType: 'multi_item_session',
    unitLabel: STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId,
    unitSummary: `${targetCustomerIds.length} ${spec.unitSummaryNoun}${targetCustomerIds.length === 1 ? '' : 's'} plus synthesis · ${timeBudgetMinutes} minutes`,
    items,
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(measurableOutcome, 'Convert more of this batch than the previous verified batch.'),
    proofRequirement: proofRequirementFor(pairing.evidenceTypeId, pairing.proofMode, 'Record the outcome of every contact in this batch and submit the completed log.'),
  });
}

/**
 * The complete bounded checklist: verify -> act -> record, every step
 * referencing the exact trusted fact this route is about and requiring
 * only the exact resources that exact step's own action needs. Returns
 * null when founderExecutionContext does not carry a trusted value (or
 * resource binding) for this route — the caller must exclude the route
 * rather than fabricate one.
 */
function checklistExecutionUnit(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard }) {
  const spec = CHECKLIST_WORK_UNITS[workUnitTypeId];
  const route = founderExecutionContextRouteFor(request, workUnitTypeId);
  if (!route) return null;
  const referenceId = route[spec.primaryField];
  const supportingValue = spec.supportingField ? route[spec.supportingField] : request.programme.programmeId;
  const supportingReferenceId = Array.isArray(supportingValue) ? supportingValue[0] : supportingValue;

  const perItemEffort = Math.max(1, Math.floor(hard / spec.steps.length));
  const items = spec.steps.map((actionType, index) => ({
    itemId: `${workUnitTypeId}_item_${index + 1}`,
    order: index + 1,
    label: CHECKLIST_STEP_LABELS[actionType] || actionType,
    actionType,
    effortUnits: perItemEffort,
    requiredResourceIds: resourceIdsForBindingKeys(route, spec.stepResourceBindingKeys[index](route)),
    domainItemDetails: { referenceId, referenceType: spec.referenceType, supportingReferenceId },
  }));

  return buildExecutionUnit({
    workUnitTypeId,
    unitType: 'multi_item_session',
    unitLabel: STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId,
    unitSummary: `${items.length} checks and actions · ${timeBudgetMinutes} minutes`,
    items,
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(measurableOutcome, 'Complete this action and record a decision or outcome grounded in the trusted evidence.'),
    proofRequirement: proofRequirementFor(pairing.evidenceTypeId, pairing.proofMode, 'Submit the completed record for every step of this action.'),
  });
}

function executionUnitFor(request, workUnitTypeId, options) {
  if (CUSTOMER_BATCH_WORK_UNITS[workUnitTypeId]) return customerBatchExecutionUnit(request, workUnitTypeId, options);
  if (CHECKLIST_WORK_UNITS[workUnitTypeId]) return checklistExecutionUnit(request, workUnitTypeId, options);
  return null;
}

function briefForWorkUnit(request, workUnitTypeId, index) {
  const pairing = firstPairing(request, workUnitTypeId);
  if (!pairing) return null;

  const methodId = trustedMethodIdFor(request);
  if (!methodId) return null;

  const domainDetailConstraints = domainDetailsFor(request, workUnitTypeId);
  if (!domainDetailConstraints) return null;

  const hard = hardEffortFor(request, { preferred: 6 });
  const medium = mediumEffortFor(hard);
  const structure = missionStructureFor(hard, medium);
  const claimCategoryId = pairing.sharedClaimCategoryIds[0];
  const outputCategoryId = pairing.sharedOutputCategoryIds[0];
  const timeBudgetMinutes = timeBudgetFor(request, { preferred: 45 });
  const measurableOutcome = { type: `${workUnitTypeId}_outcome`, targetId: request.currentMilestone.id, measurable: true };

  const executionUnit = executionUnitFor(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard });
  if (!executionUnit) return null;

  // The union of what the execution unit's own items actually require is
  // the sole source of truth for the brief's requiredResourceIds. A route
  // whose real per-item resources are not fully available must still
  // exclude the route rather than plan an unexecutable mission — the same
  // fail-closed rule Fitness/Athlete equipment already enforces.
  const requiredResourceIds = unionOfItemRequiredResources(executionUnit.items);
  if (requiredResourceIds === null || !hasRequiredResources(request, requiredResourceIds)) return null;

  return {
    briefId: `founder_brief_${index + 1}`,
    strategyLens: `${request.bottleneck.category}_via_${workUnitTypeId}`,
    workUnitTypeId,
    evidenceTypeId: pairing.evidenceTypeId,
    proofMode: pairing.proofMode,
    claimCategoryId,
    outputCategoryId,
    strategicReason: `${STRATEGIC_PRINCIPLE[workUnitTypeId]}, addressing the active bottleneck (${request.bottleneck.category}).`,
    method: { id: methodId, progressionIntent: 'maintain' },
    measurableOutcome,
    missionStepPlan: twoStepPlan(outputCategoryId, 'prepare_engagement', 'execute_and_record_outcome', hard),
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
export function planFounderBriefs(request) {
  const briefs = [];
  for (const workUnitTypeId of relevantWorkUnitIds(request)) {
    const brief = briefForWorkUnit(request, workUnitTypeId, briefs.length);
    if (brief) briefs.push(brief);
  }
  return briefs;
}
