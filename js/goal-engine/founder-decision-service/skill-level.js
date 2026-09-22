/**
 * Founder Decision Service — per-task-function skill level.
 *
 * Deterministic, evidence-based classification -- never a single global
 * beginner/advanced label. A founder can be advanced at delivery and a
 * beginner at sales simultaneously; this reads ONLY the trusted snapshot/
 * entity signals founder-bottleneck/signals.js already exposes (reused
 * unchanged, never re-derived here) and never fabricates evidence that
 * is not on record. Absence of evidence for a function means 'beginner'
 * for THAT function only -- it never lowers the Professional Standard,
 * only how much execution support the mission gives.
 */

import * as signals from '../founder-bottleneck/signals.js';

export const SKILL_LEVELS = Object.freeze(['beginner', 'developing', 'advanced']);

// Mirrors founder-bottleneck/contract.js's FOUNDER_WORK_UNIT_BUSINESS_FUNCTION
// values (this module intentionally does not import it, matching the
// existing "small, independent fact" style already used across this
// subsystem -- see founder-bottleneck/contract.js's own header on why).
export const BUSINESS_FUNCTIONS = Object.freeze([
  'validation', 'sales', 'delivery', 'retention', 'operations', 'strategy',
]);

const SALES_EVIDENCE_KEYWORDS = /\b(sold|closed a deal|signed (a |the )?client|first (sale|client|customer)|testimonial|case stud)\b/i;
const VALIDATION_EVIDENCE_KEYWORDS = /\b(interviewed|validated|customer discovery|user research)\b/i;

function textPool(snapshot) {
  const pool = [];
  const completed = signals.completedWorkItems(snapshot);
  const priorities = snapshot.currentPriorities?.status === 'known' ? snapshot.currentPriorities.value : [];
  pool.push(...completed, ...(priorities || []));
  return pool.filter((entry) => typeof entry === 'string' && entry.length > 0);
}

function assessSales(snapshot, entityBundle) {
  const converted = signals.payingOrConvertedCustomerEntities(entityBundle).length;
  const engaged = signals.usableCustomerEntities(entityBundle)
    .filter((entity) => entity.value.engagementState && entity.value.engagementState !== 'not_contacted').length;
  const hasSoldEvidence = textPool(snapshot).some((entry) => SALES_EVIDENCE_KEYWORDS.test(entry));
  if (signals.hasRealRevenue(snapshot) || signals.hasPayingCustomers(snapshot) || converted > 0 || hasSoldEvidence) {
    return { level: 'advanced', evidence: 'has real revenue, a converted customer, or recorded sales evidence' };
  }
  if (engaged > 0) {
    return { level: 'developing', evidence: `${engaged} prospect(s) already engaged in conversation, no conversion yet` };
  }
  return { level: 'beginner', evidence: 'no recorded sales conversation or outcome yet' };
}

function assessValidation(snapshot) {
  const hasEvidence = signals.hasAnyCustomerEvidence(snapshot);
  const count = signals.customerCount(snapshot);
  const hasValidationEvidence = textPool(snapshot).some((entry) => VALIDATION_EVIDENCE_KEYWORDS.test(entry));
  if (hasEvidence && (count >= 3 || hasValidationEvidence)) {
    return { level: 'advanced', evidence: `${count} customer(s)/prospect(s) on record with recorded validation work` };
  }
  if (hasEvidence && count > 0) {
    return { level: 'developing', evidence: `${count} customer(s)/prospect(s) on record, limited validation depth` };
  }
  return { level: 'beginner', evidence: 'no customer/problem evidence recorded yet' };
}

function assessDelivery(snapshot) {
  const completed = signals.completedWorkItems(snapshot);
  const unfinished = signals.unfinishedWorkItems(snapshot);
  if (completed.length === 0) {
    return { level: 'beginner', evidence: 'no completed delivery work recorded yet' };
  }
  if (completed.length > unfinished.length * 2) {
    return { level: 'advanced', evidence: `${completed.length} completed item(s) substantially outweigh ${unfinished.length} unfinished` };
  }
  return { level: 'developing', evidence: `${completed.length} completed, ${unfinished.length} still unfinished` };
}

function assessRetention(snapshot, entityBundle) {
  const hasCustomers = signals.hasPayingCustomers(snapshot) || signals.customerCount(snapshot) > 0
    || signals.payingOrConvertedCustomerEntities(entityBundle).length > 0;
  if (!hasCustomers) return { level: 'beginner', evidence: 'no real customers exist yet to retain' };
  const churnMatches = signals.retentionSignalMatches(snapshot);
  if (churnMatches.length > 0) return { level: 'developing', evidence: `active retention/churn evidence on record: "${churnMatches[0]}"` };
  return { level: 'advanced', evidence: 'real customers exist with no reported churn/retention problem' };
}

function assessOperations(snapshot, entityBundle) {
  const failing = signals.failingOperatingProcessEntities(entityBundle);
  const matches = signals.operationsSignalMatches(snapshot);
  if (failing.length === 0 && matches.length === 0) return { level: 'advanced', evidence: 'no recorded operating failure point' };
  return { level: 'developing', evidence: 'a recorded operating process has a real failure point' };
}

function assessStrategy(entityBundle) {
  const open = signals.usableOpenStrategyDecisions(entityBundle);
  if (open.length === 0) return { level: 'advanced', evidence: 'no open strategic decision is blocking progress' };
  return { level: 'developing', evidence: `an open decision with ${open[0].value.optionIds.length} real options is on record` };
}

const ASSESSORS = Object.freeze({
  sales: (snapshot, entityBundle) => assessSales(snapshot, entityBundle),
  validation: (snapshot) => assessValidation(snapshot),
  delivery: (snapshot) => assessDelivery(snapshot),
  retention: (snapshot, entityBundle) => assessRetention(snapshot, entityBundle),
  operations: (snapshot, entityBundle) => assessOperations(snapshot, entityBundle),
  strategy: (_snapshot, entityBundle) => assessStrategy(entityBundle),
});

/**
 * @param {string} businessFunction One of BUSINESS_FUNCTIONS.
 * @param {object} snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @param {object} entityBundle Trusted buildFounderExecutionEntities(...) output.
 * @returns {{level: 'beginner'|'developing'|'advanced', evidence: string}}
 */
export function assessFounderCapabilityLevel(businessFunction, snapshot, entityBundle) {
  const assessor = ASSESSORS[businessFunction];
  if (!assessor) {
    return { level: 'beginner', evidence: `no capability signal is defined for business function "${businessFunction}"` };
  }
  return assessor(snapshot, entityBundle);
}
