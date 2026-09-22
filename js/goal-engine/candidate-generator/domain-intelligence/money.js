/**
 * Money domain intelligence: stays within the affordable amount, legal
 * actions, and maximum risk; preserves privacy/redaction requirements. The
 * investment work unit is only ever selected when the bottleneck or goal
 * category is genuinely about risk or investing — a debt/saving/cash-flow
 * goal never gets routed into speculative investing work.
 *
 * A normal work unit must represent the complete bounded financial action
 * — every ordered verification check plus the action itself plus the
 * record step, not a single vague "make a payment" standing in for the
 * whole unit. The checklist steps are a fixed, safe professional procedure
 * (verify -> execute -> record); the amount, category, and risk ceiling
 * filled into each step are the request's own trusted domain facts, never
 * invented.
 */

import {
  MONEY_EXECUTION_CONTEXT_CONTRACT_VERSION,
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
  insufficient_earning: ['money_income_action_block'],
  spending_leak: ['money_budget_allocation', 'money_cash_flow_review'],
  high_cost_debt: ['money_debt_repayment_action'],
  cash_flow_volatility: ['money_cash_flow_review', 'money_budget_allocation'],
  missing_savings_buffer: ['money_savings_transfer_plan'],
  risk_mismatch: ['money_investment_policy_step'],
  protection_gap: ['money_risk_protection_review'],
});

const GOAL_CATEGORY_WORK_UNITS = Object.freeze({
  earning: ['money_income_action_block'],
  saving: ['money_savings_transfer_plan'],
  debt_reduction: ['money_debt_repayment_action'],
  cash_flow: ['money_cash_flow_review'],
  budgeting: ['money_budget_allocation'],
  investing: ['money_investment_policy_step'],
  risk_management: ['money_risk_protection_review'],
  wealth_protection: ['money_risk_protection_review'],
});

const STRATEGIC_PRINCIPLE = Object.freeze({
  money_income_action_block: 'A qualified earning action with a tracked outcome',
  money_savings_transfer_plan: 'A savings action tied to a defined target, amount, and cash-flow constraint',
  money_debt_repayment_action: 'A debt-reduction action based on balance, interest, and repayment strategy',
  money_cash_flow_review: 'Reconcile income and outgoings and decide the material correction',
  money_budget_allocation: 'Build or revise a usable allocation with a realistic buffer',
  money_investment_policy_step: 'A risk-appropriate investment step within the confirmed risk ceiling',
  money_risk_protection_review: 'Address a concrete protection gap in reserves, insurance, or account security',
});

// The fixed, safe verify -> execute -> record checklist per work unit — a
// canonical professional procedure, never a per-user fabrication. Amount/
// category/risk are filled in from trusted domain facts at each step.
const WORK_UNIT_CHECKLIST = Object.freeze({
  money_income_action_block: ['confirm_qualified_opportunity', 'execute_income_action', 'record_verified_outcome'],
  money_savings_transfer_plan: ['confirm_affordable_amount', 'execute_savings_transfer', 'record_redacted_confirmation'],
  money_debt_repayment_action: ['confirm_balance_and_minimum', 'execute_scheduled_payment', 'record_redacted_confirmation'],
  money_cash_flow_review: ['reconcile_income_and_outgoings', 'identify_material_variance', 'record_correction_decision'],
  money_budget_allocation: ['confirm_essential_costs', 'allocate_remaining_buffer', 'record_budget_decision'],
  money_investment_policy_step: ['confirm_risk_ceiling', 'execute_investment_step', 'record_policy_decision'],
  money_risk_protection_review: ['identify_protection_gap', 'confirm_coverage_action', 'record_protection_decision'],
});

// Versioned trusted resource contract: request.programme.requiredAttributes
// .moneyExecutionContext.routes[workUnitTypeId].resourceBindings — the
// exact trusted account/payment/analysis/decision resources each work
// unit's checklist steps genuinely need (see shared.js
// validateExecutionContextRoute). Money's other route facts
// (financialCategory/amount/riskLevel/actionType/measurableOutcomeId) stay
// domainFacts-driven — already real, trusted, per-request values — this
// context exists solely to supply what domainFacts has no field for: the
// resources.
const MONEY_ROUTE_CONTEXT_FIELDS = Object.freeze({
  money_income_action_block: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['opportunityRecord', 'incomeActionAccess', 'resultWorkspace'] }),
  }),
  money_savings_transfer_plan: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['savingsTarget', 'transferAccess', 'redactionCapability', 'resultWorkspace'] }),
  }),
  money_debt_repayment_action: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['debtStatement', 'paymentAccess', 'redactionCapability', 'resultWorkspace'] }),
  }),
  money_cash_flow_review: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['cashFlowRecord', 'analysisWorkspace', 'decisionWorkspace'] }),
  }),
  money_budget_allocation: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['budgetRecord', 'analysisWorkspace', 'decisionWorkspace'] }),
  }),
  money_investment_policy_step: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['investmentPolicy', 'riskProfile', 'accountAccess', 'decisionWorkspace'] }),
  }),
  money_risk_protection_review: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['protectionRecord', 'coverageOptions', 'decisionWorkspace'] }),
  }),
});

// Per work unit: which resourceBindingKeys apply to each checklist step, in
// the same order as WORK_UNIT_CHECKLIST — a payment/transfer step never
// gets the whole route's resource union, only what that exact step needs
// (e.g. "execute" needs account/payment access; "record" needs the
// redaction capability, never the reverse).
const MONEY_STEP_RESOURCE_BINDINGS = Object.freeze({
  money_income_action_block: [['opportunityRecord'], ['incomeActionAccess'], ['resultWorkspace']],
  money_savings_transfer_plan: [['savingsTarget'], ['transferAccess'], ['redactionCapability', 'resultWorkspace']],
  money_debt_repayment_action: [['debtStatement'], ['paymentAccess'], ['redactionCapability', 'resultWorkspace']],
  money_cash_flow_review: [['cashFlowRecord', 'analysisWorkspace'], ['cashFlowRecord', 'analysisWorkspace'], ['decisionWorkspace']],
  money_budget_allocation: [['budgetRecord'], ['budgetRecord', 'analysisWorkspace'], ['decisionWorkspace']],
  money_investment_policy_step: [['investmentPolicy', 'riskProfile'], ['accountAccess'], ['decisionWorkspace']],
  money_risk_protection_review: [['protectionRecord'], ['coverageOptions'], ['decisionWorkspace']],
});

const CHECKLIST_STEP_LABELS = Object.freeze({
  confirm_qualified_opportunity: 'Confirm the qualified earning opportunity',
  execute_income_action: 'Execute the earning action',
  record_verified_outcome: 'Record the verified outcome',
  confirm_affordable_amount: 'Confirm the affordable transfer amount',
  execute_savings_transfer: 'Execute the savings transfer',
  record_redacted_confirmation: 'Record the redacted confirmation',
  confirm_balance_and_minimum: 'Confirm the current balance and minimum obligation',
  execute_scheduled_payment: 'Execute the scheduled payment',
  reconcile_income_and_outgoings: 'Reconcile income and outgoings for the period',
  identify_material_variance: 'Identify the material variance',
  record_correction_decision: 'Record the correction decision',
  confirm_essential_costs: 'Confirm essential costs and obligations',
  allocate_remaining_buffer: 'Allocate the remaining buffer',
  record_budget_decision: 'Record the budget decision',
  confirm_risk_ceiling: 'Confirm the risk ceiling and category fit',
  execute_investment_step: 'Execute the investment step',
  record_policy_decision: 'Record the investment policy decision',
  identify_protection_gap: 'Identify the concrete protection gap',
  confirm_coverage_action: 'Confirm the coverage action',
  record_protection_decision: 'Record the protection decision',
});

/**
 * Returns null when the request carries no trusted legal action type or no
 * trusted required outcome — the caller must exclude the route rather than
 * fall back to a fabricated `${workUnitTypeId}_action` / `_outcome_record`
 * placeholder.
 */
function domainDetailsFor(request, workUnitTypeId) {
  const facts = request.domainFacts;
  const actionType = (facts.legalActionTypes || [])[0];
  const measurableOutcomeId = (facts.requiredOutcomeIds || [])[0];
  if (!actionType || !measurableOutcomeId) return null;
  // Only the investment work unit may use the confirmed risk ceiling; every
  // other route stays at 'low' risk regardless of what the ceiling allows.
  const riskLevel = workUnitTypeId === 'money_investment_policy_step'
    ? (facts.maximumRiskLevel || 'low')
    : 'low';
  return {
    financialCategory: facts.financialCategory,
    amount: Number.isFinite(facts.affordableAmount) ? facts.affordableAmount : 0,
    riskLevel,
    actionType,
    measurableOutcomeId,
    privacySafe: Boolean(facts.privacySafeProofRequired),
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
 * The complete bounded financial action: the work unit's fixed verify ->
 * execute -> record checklist, each step carrying the request's own
 * trusted amount/category/risk ceiling and the exact trusted resources
 * that exact step needs. Returns null when moneyExecutionContext does not
 * carry a valid resourceBindings entry for this route — the caller must
 * exclude the route rather than leave a payment/transfer step genuinely
 * resource-free.
 */
function executionUnitFor(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard, domainDetails }) {
  const checklist = WORK_UNIT_CHECKLIST[workUnitTypeId];
  if (!checklist) return null;
  const route = validateExecutionContextRoute(
    request, 'moneyExecutionContext', MONEY_EXECUTION_CONTEXT_CONTRACT_VERSION, MONEY_ROUTE_CONTEXT_FIELDS, workUnitTypeId,
  );
  if (!route) return null;
  const stepBindings = MONEY_STEP_RESOURCE_BINDINGS[workUnitTypeId];

  const perItemEffort = Math.max(1, Math.floor(hard / checklist.length));
  const items = checklist.map((actionType, index) => ({
    itemId: `${workUnitTypeId}_item_${index + 1}`,
    order: index + 1,
    label: CHECKLIST_STEP_LABELS[actionType] || actionType,
    actionType,
    effortUnits: perItemEffort,
    requiredResourceIds: resourceIdsForBindingKeys(route, stepBindings[index]),
    domainItemDetails: {
      financialCategory: domainDetails.financialCategory,
      amount: domainDetails.amount,
      riskLevel: domainDetails.riskLevel,
    },
  }));

  return buildExecutionUnit({
    workUnitTypeId,
    unitType: 'multi_item_session',
    unitLabel: STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId,
    unitSummary: `${items.length} checks and actions · ${timeBudgetMinutes} minutes`,
    items,
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(measurableOutcome, 'Complete this action within the confirmed affordable amount and risk ceiling.'),
    proofRequirement: proofRequirementFor(pairing.evidenceTypeId, pairing.proofMode, 'Submit the redacted record confirming every step of this action was completed.'),
  });
}

function briefForWorkUnit(request, workUnitTypeId, index) {
  const pairing = firstPairing(request, workUnitTypeId);
  if (!pairing) return null;

  const methodId = trustedMethodIdFor(request);
  if (!methodId) return null;

  const hard = hardEffortFor(request, { preferred: 5 });
  const medium = mediumEffortFor(hard);
  const structure = missionStructureFor(hard, medium);
  const claimCategoryId = pairing.sharedClaimCategoryIds[0];
  const outputCategoryId = pairing.sharedOutputCategoryIds[0];
  const timeBudgetMinutes = timeBudgetFor(request, { preferred: 30 });
  const measurableOutcome = { type: `${workUnitTypeId}_outcome`, targetId: request.currentMilestone.id, measurable: true };
  const domainDetails = domainDetailsFor(request, workUnitTypeId);
  if (!domainDetails) return null;

  const executionUnit = executionUnitFor(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard, domainDetails });
  if (!executionUnit) return null;

  // The union of what the execution unit's own items actually require is
  // the sole source of truth for the brief's requiredResourceIds. A
  // payment/transfer route whose real per-step resources (account access,
  // verified balance, redaction capability, ...) are not fully available
  // must still exclude the route rather than plan an unexecutable action.
  const requiredResourceIds = unionOfItemRequiredResources(executionUnit.items);
  if (requiredResourceIds === null || !hasRequiredResources(request, requiredResourceIds)) return null;

  return {
    briefId: `money_brief_${index + 1}`,
    strategyLens: `${request.bottleneck.category}_via_${workUnitTypeId}`,
    workUnitTypeId,
    evidenceTypeId: pairing.evidenceTypeId,
    proofMode: pairing.proofMode,
    claimCategoryId,
    outputCategoryId,
    strategicReason: `${STRATEGIC_PRINCIPLE[workUnitTypeId]}, addressing the active bottleneck (${request.bottleneck.category}).`,
    method: { id: methodId, progressionIntent: 'maintain' },
    measurableOutcome,
    missionStepPlan: twoStepPlan(outputCategoryId, 'verify_affordable_action', 'execute_and_record_action', hard),
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
export function planMoneyBriefs(request) {
  const briefs = [];
  for (const workUnitTypeId of relevantWorkUnitIds(request)) {
    const brief = briefForWorkUnit(request, workUnitTypeId, briefs.length);
    if (brief) briefs.push(brief);
  }
  return briefs;
}
