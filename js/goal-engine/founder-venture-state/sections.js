/**
 * Founder Venture State V2 — additional field vocabulary.
 *
 * Extends (never replaces) contract.js's V1 TrustedField vocabulary
 * (SCALAR_FACT_FIELDS/LIST_FACT_FIELDS/validateFactValue) with the richer
 * set of sections the collection + maintenance system needs: product/
 * service state, customer evidence, traction, revenue, acquisition,
 * delivery, retention, operations, team, integrations, and proof summary.
 *
 * Every new field is additive to V1's OPTIONAL_STATE_TOP_FIELDS — nothing
 * here changes what a V1 ventureState looks like or requires. A "section"
 * field is a TrustedField (see contract.js's validateTrustedField) whose
 * `value` is either `null` (explicitly unknown — never omitted, never
 * guessed) or a plain object using ONLY the fixed, narrow key allowlist
 * defined here for that section. Unknown/invented keys are rejected, so a
 * caller can never smuggle a fabricated fact through an unvalidated
 * free-form object.
 */

import { isNonEmptyString, validTimestamp } from './contract.js';

// Each new list field: a non-empty array of distinct non-empty strings,
// exactly like V1's LIST_FACT_FIELDS.
export const V2_LIST_FACT_FIELDS = Object.freeze([
  'currentPriorities', // what the founder is trying to move next, in their own words
  'recentProgress', // short, dated, verified-or-reported progress notes
  'constraints', // real limiting factors (time, budget, skills, legal)
]);

// Section fields: TrustedField-wrapped, nullable, narrow-schema objects.
// The key set for each section is intentionally small and literal — this
// list IS the contract; nothing outside it can ever be stored.
// Integrations get one section field PER PROVIDER (integrationGithub,
// integrationSupabase, integrationVercel, integrationWebsite) rather than
// one shared 'integrations' key. If they shared one key, two providers
// reporting in the same call would collide under the fact-ledger's
// same-key precedence rule (same rank + different value => "conflict"),
// which is wrong — GitHub being connected and Vercel being connected are
// independent facts, not competing values for one field. snapshot.js
// composes the final `integrations` output section from all four.
export const INTEGRATION_PROVIDERS = Object.freeze(['github', 'supabase', 'vercel', 'website']);
export const INTEGRATION_SECTION_FIELDS = Object.freeze(
  INTEGRATION_PROVIDERS.map((provider) => `integration${provider[0].toUpperCase()}${provider.slice(1)}`),
);

// SECURITY/LOGIC FIX: offer pricing (what the founder charges) and revenue
// (what has actually been earned) are DIFFERENT facts and must never share
// one section. A prior revision bundled them into one 'revenueState'
// section, which meant a chat statement like "I'm charging $399" had to
// fabricate hasRevenue:false/monthlyRevenueUsd:0/an implicit customer count
// just to fit the shape -- i.e. inventing "proof" of zero revenue/customers
// that was never actually stated. Fixed by splitting into two independent
// sections, each populated ONLY from a fact that genuinely addresses it.
// The Founder Active Outcome Thread: the durable, versioned record of the
// currently-committed Today's Move and why it is what it is. Deliberately
// minimal -- userId/ventureId/createdAt/updatedAt/history are already
// carried by the surrounding fact envelope and fact-ledger supersede chain
// (see fact-ledger.js/assembler.js), so this section only stores the
// genuinely NEW information: what the active outcome is, what route/
// bottleneck it currently maps to, its own version counter, and why it last
// changed. A new task version is written by superseding the previous
// activeOutcomeThread fact (see founder-mission-comparison/right-next-move.js);
// the OLD version remains in the fact ledger's history, never deleted.
export const ACTIVE_OUTCOME_EXECUTION_STATES = Object.freeze([
  'in_progress', 'blocked', 'completed_step_outcome_open', 'completed_outcome_closed', 'abandoned', 'superseded',
]);
/* 'superseded' closes an outcome that was neither achieved nor disproven:
   the venture's situation changed enough that VISION is now pursuing a
   different business result. It is a real closure, not a silent rewrite --
   the replacing thread names the outcome it superseded. */
export const ACTIVE_OUTCOME_COMPLETION_STATES = Object.freeze(['open', 'achieved', 'disproven', 'abandoned', 'superseded']);

export const SECTION_FIELD_KEYS = Object.freeze({
  productOrService: Object.freeze(['status', 'description']),
  /* Two layers in one section value, deliberately.
     OUTCOME identity (outcomeId, outcomeStatement, outcomeCompletionCriteria,
     outcomeCreatedAt, outcomeReason, bottleneckAtOutcomeCreation,
     supersedesOutcomeId) is frozen at outcome creation and carried forward
     untouched while tactics change underneath it. TACTIC fields
     (currentRouteId, currentTaskTitle, taskVersion, completionCriteria)
     change every time the move changes. `activeOutcome` predates the
     outcome layer and is retained as the task-derived summary string.
     The outcome fields are OPTIONAL on read so threads persisted before
     this contract still validate; every new write populates them. */
  activeOutcomeThread: Object.freeze([
    'activeOutcome', 'currentBottleneckCategory', 'currentRouteId', 'currentTaskTitle', 'taskVersion',
    'executionState', 'latestEventSummary', 'latestEventInterpretation', 'reasonForLastChange',
    'relatedEntityIds', 'completionCriteria', 'outcomeCompletionState',
    'outcomeId', 'outcomeStatement', 'outcomeCompletionCriteria', 'outcomeCreatedAt',
    'outcomeReason', 'bottleneckAtOutcomeCreation', 'supersedesOutcomeId',
  ]),
  customerEvidence: Object.freeze(['customerCount', 'hasPayingCustomers', 'evidenceType', 'notes']),
  traction: Object.freeze(['metric', 'value', 'asOf']),
  // What the founder charges (or intends to charge) -- never implies
  // anyone has actually paid.
  offerPricing: Object.freeze(['price', 'currency', 'pricingModel', 'billingInterval', 'pricingStatus', 'notes']),
  // What has actually been earned -- never inferred from a stated price.
  revenue: Object.freeze(['amount', 'currency', 'period', 'notes']),
  acquisition: Object.freeze(['channels', 'notes']),
  delivery: Object.freeze(['method', 'notes']),
  retention: Object.freeze(['status', 'notes']),
  operations: Object.freeze(['processNotes']),
  team: Object.freeze(['size', 'roles']),
  proofSummary: Object.freeze(['verifiedFactCount', 'lastProofAt']),
  ...Object.fromEntries(INTEGRATION_SECTION_FIELDS.map((field) => [field, Object.freeze(['connected', 'lastSyncAt', 'referenceId'])])),
});
export const V2_SECTION_FACT_FIELDS = Object.freeze(Object.keys(SECTION_FIELD_KEYS));

const PRODUCT_STATUSES = Object.freeze(['idea', 'prototype', 'mvp', 'live', 'paused']);
const CUSTOMER_EVIDENCE_TYPES = Object.freeze(['none', 'interviews', 'waitlist', 'paying_customers']);
const RETENTION_STATUSES = Object.freeze(['unknown', 'churning', 'stable', 'growing']);
const BILLING_INTERVALS = Object.freeze(['one_time', 'weekly', 'monthly', 'annual', 'per_project']);
const PRICING_STATUSES = Object.freeze(['draft', 'published', 'unknown']);

// LEGACY: the pre-repair bundled pricing/revenue key. Still a recognised
// fact_key (so a historical row using it is never rejected/deleted -- see
// fact-ledger.js's rebuildStateFromFacts), but no first-party collector
// emits it and it is never auto-migrated into offerPricing or revenue
// without an unambiguous, narrowly-defined rule.
export const LEGACY_REVENUE_STATE_FIELD = 'revenueState';

export const V2_FIELD_NAMES = Object.freeze([...V2_LIST_FACT_FIELDS, ...V2_SECTION_FACT_FIELDS]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isBoolean(value) {
  return typeof value === 'boolean';
}

function isNonEmptyStringArrayLoose(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item));
}

function validateIntegrationProviderRecord(provider, value, path, errors) {
  if (value === null) return;
  const allowed = ['connected', 'lastSyncAt', 'referenceId'];
  if (!isPlainObject(value)) { errors.push(`${path} must be null or a plain object`); return; }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`unknown ${path} field: ${key}`);
  }
  if (!Object.hasOwn(value, 'connected') || typeof value.connected !== 'boolean') {
    errors.push(`${path}.connected must be a boolean`);
  }
  if (Object.hasOwn(value, 'lastSyncAt') && value.lastSyncAt !== null && !validTimestamp(value.lastSyncAt)) {
    errors.push(`${path}.lastSyncAt must be null or a valid timestamp`);
  }
  if (Object.hasOwn(value, 'referenceId') && value.referenceId !== null && !isNonEmptyString(value.referenceId)) {
    errors.push(`${path}.referenceId must be null or a non-empty string`);
  }
  // Never claim connected without a real, safe reference to what it's connected to.
  if (value.connected === true && (!Object.hasOwn(value, 'referenceId') || !isNonEmptyString(value.referenceId))) {
    errors.push(`${path} claims connected=true without a real referenceId`);
  }
}

/**
 * Validates one section object's fields against the narrow allowlist for
 * that section — plus a handful of section-specific type/enum rules for
 * the fields that need them. Every key MUST be in SECTION_FIELD_KEYS[field]
 * or it is rejected outright as an unknown/invented field.
 */
function validateSectionObject(field, value, path, errors) {
  const allowedKeys = SECTION_FIELD_KEYS[field];
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) errors.push(`unknown ${path} field: ${key}`);
  }

  if (field === 'productOrService') {
    if (Object.hasOwn(value, 'status') && !PRODUCT_STATUSES.includes(value.status)) errors.push(`${path}.status is not a supported product/service status`);
    if (Object.hasOwn(value, 'description') && !isNonEmptyString(value.description)) errors.push(`${path}.description must be a non-empty string`);
  } else if (field === 'customerEvidence') {
    if (Object.hasOwn(value, 'customerCount') && !isNonNegativeNumber(value.customerCount)) errors.push(`${path}.customerCount must be a non-negative number`);
    if (Object.hasOwn(value, 'hasPayingCustomers') && !isBoolean(value.hasPayingCustomers)) errors.push(`${path}.hasPayingCustomers must be a boolean`);
    if (Object.hasOwn(value, 'evidenceType') && !CUSTOMER_EVIDENCE_TYPES.includes(value.evidenceType)) errors.push(`${path}.evidenceType is not supported`);
    if (Object.hasOwn(value, 'notes') && !isNonEmptyString(value.notes)) errors.push(`${path}.notes must be a non-empty string`);
  } else if (field === 'traction') {
    if (!Object.hasOwn(value, 'metric') || !isNonEmptyString(value.metric)) errors.push(`${path}.metric must be a non-empty string`);
    if (!Object.hasOwn(value, 'value') || !(typeof value.value === 'string' || typeof value.value === 'number')) errors.push(`${path}.value must be a string or number`);
    if (!Object.hasOwn(value, 'asOf') || !validTimestamp(value.asOf)) errors.push(`${path}.asOf must be a valid timestamp`);
  } else if (field === 'offerPricing') {
    if (Object.hasOwn(value, 'price') && !isNonNegativeNumber(value.price)) errors.push(`${path}.price must be a non-negative number`);
    if (Object.hasOwn(value, 'currency') && !isNonEmptyString(value.currency)) errors.push(`${path}.currency must be a non-empty string`);
    if (Object.hasOwn(value, 'pricingModel') && !isNonEmptyString(value.pricingModel)) errors.push(`${path}.pricingModel must be a non-empty string`);
    if (Object.hasOwn(value, 'billingInterval') && !BILLING_INTERVALS.includes(value.billingInterval)) errors.push(`${path}.billingInterval is not supported`);
    if (Object.hasOwn(value, 'pricingStatus') && !PRICING_STATUSES.includes(value.pricingStatus)) errors.push(`${path}.pricingStatus is not supported`);
    if (Object.hasOwn(value, 'notes') && !isNonEmptyString(value.notes)) errors.push(`${path}.notes must be a non-empty string`);
  } else if (field === 'revenue') {
    if (Object.hasOwn(value, 'amount') && !isNonNegativeNumber(value.amount)) errors.push(`${path}.amount must be a non-negative number`);
    if (Object.hasOwn(value, 'currency') && !isNonEmptyString(value.currency)) errors.push(`${path}.currency must be a non-empty string`);
    if (Object.hasOwn(value, 'period') && !isNonEmptyString(value.period)) errors.push(`${path}.period must be a non-empty string`);
    if (Object.hasOwn(value, 'notes') && !isNonEmptyString(value.notes)) errors.push(`${path}.notes must be a non-empty string`);
  } else if (field === 'acquisition') {
    if (Object.hasOwn(value, 'channels') && !isNonEmptyStringArrayLoose(value.channels)) errors.push(`${path}.channels must be a non-empty array of non-empty strings`);
    if (Object.hasOwn(value, 'notes') && !isNonEmptyString(value.notes)) errors.push(`${path}.notes must be a non-empty string`);
  } else if (field === 'delivery') {
    if (Object.hasOwn(value, 'method') && !isNonEmptyString(value.method)) errors.push(`${path}.method must be a non-empty string`);
    if (Object.hasOwn(value, 'notes') && !isNonEmptyString(value.notes)) errors.push(`${path}.notes must be a non-empty string`);
  } else if (field === 'retention') {
    if (Object.hasOwn(value, 'status') && !RETENTION_STATUSES.includes(value.status)) errors.push(`${path}.status is not supported`);
    if (Object.hasOwn(value, 'notes') && !isNonEmptyString(value.notes)) errors.push(`${path}.notes must be a non-empty string`);
  } else if (field === 'operations') {
    if (!Object.hasOwn(value, 'processNotes') || !isNonEmptyString(value.processNotes)) errors.push(`${path}.processNotes must be a non-empty string`);
  } else if (field === 'team') {
    if (Object.hasOwn(value, 'size') && !(typeof value.size === 'number' && Number.isInteger(value.size) && value.size >= 1)) errors.push(`${path}.size must be a positive integer`);
    if (Object.hasOwn(value, 'roles') && !isNonEmptyStringArrayLoose(value.roles)) errors.push(`${path}.roles must be a non-empty array of non-empty strings`);
  } else if (INTEGRATION_SECTION_FIELDS.includes(field)) {
    validateIntegrationProviderRecord(field, value, path, errors);
  } else if (field === 'proofSummary') {
    if (!Object.hasOwn(value, 'verifiedFactCount') || !isNonNegativeNumber(value.verifiedFactCount)) errors.push(`${path}.verifiedFactCount must be a non-negative number`);
    if (Object.hasOwn(value, 'lastProofAt') && value.lastProofAt !== null && !validTimestamp(value.lastProofAt)) errors.push(`${path}.lastProofAt must be null or a valid timestamp`);
  } else if (field === 'activeOutcomeThread') {
    if (!Object.hasOwn(value, 'activeOutcome') || !isNonEmptyString(value.activeOutcome)) errors.push(`${path}.activeOutcome must be a non-empty string`);
    if (!Object.hasOwn(value, 'currentBottleneckCategory') || !isNonEmptyString(value.currentBottleneckCategory)) errors.push(`${path}.currentBottleneckCategory must be a non-empty string`);
    if (!Object.hasOwn(value, 'currentRouteId') || !isNonEmptyString(value.currentRouteId)) errors.push(`${path}.currentRouteId must be a non-empty string`);
    if (!Object.hasOwn(value, 'currentTaskTitle') || !isNonEmptyString(value.currentTaskTitle)) errors.push(`${path}.currentTaskTitle must be a non-empty string`);
    if (!Object.hasOwn(value, 'taskVersion') || !Number.isInteger(value.taskVersion) || value.taskVersion < 1) errors.push(`${path}.taskVersion must be a positive integer`);
    if (!Object.hasOwn(value, 'executionState') || !ACTIVE_OUTCOME_EXECUTION_STATES.includes(value.executionState)) errors.push(`${path}.executionState is not supported`);
    if (Object.hasOwn(value, 'latestEventSummary') && value.latestEventSummary !== null && !isNonEmptyString(value.latestEventSummary)) errors.push(`${path}.latestEventSummary must be null or a non-empty string`);
    if (Object.hasOwn(value, 'latestEventInterpretation') && value.latestEventInterpretation !== null && !isNonEmptyString(value.latestEventInterpretation)) errors.push(`${path}.latestEventInterpretation must be null or a non-empty string`);
    if (!Object.hasOwn(value, 'reasonForLastChange') || !isNonEmptyString(value.reasonForLastChange)) errors.push(`${path}.reasonForLastChange must be a non-empty string`);
    if (!Object.hasOwn(value, 'relatedEntityIds') || !Array.isArray(value.relatedEntityIds) || !value.relatedEntityIds.every((id) => isNonEmptyString(id))) errors.push(`${path}.relatedEntityIds must be an array of non-empty strings`);
    if (!Object.hasOwn(value, 'completionCriteria') || !isNonEmptyString(value.completionCriteria)) errors.push(`${path}.completionCriteria must be a non-empty string`);
    if (!Object.hasOwn(value, 'outcomeCompletionState') || !ACTIVE_OUTCOME_COMPLETION_STATES.includes(value.outcomeCompletionState)) errors.push(`${path}.outcomeCompletionState is not supported`);
    /* Outcome-identity layer. Optional so pre-contract threads still
       validate, but never nullable-when-present: a thread that claims an
       outcome identity must carry a real one. */
    if (Object.hasOwn(value, 'outcomeId') && !isNonEmptyString(value.outcomeId)) errors.push(`${path}.outcomeId must be a non-empty string`);
    if (Object.hasOwn(value, 'outcomeStatement') && !isNonEmptyString(value.outcomeStatement)) errors.push(`${path}.outcomeStatement must be a non-empty string`);
    if (Object.hasOwn(value, 'outcomeCompletionCriteria') && !isNonEmptyString(value.outcomeCompletionCriteria)) errors.push(`${path}.outcomeCompletionCriteria must be a non-empty string`);
    if (Object.hasOwn(value, 'outcomeCreatedAt') && !validTimestamp(value.outcomeCreatedAt)) errors.push(`${path}.outcomeCreatedAt must be a valid timestamp`);
    if (Object.hasOwn(value, 'outcomeReason') && !isNonEmptyString(value.outcomeReason)) errors.push(`${path}.outcomeReason must be a non-empty string`);
    if (Object.hasOwn(value, 'bottleneckAtOutcomeCreation') && !isNonEmptyString(value.bottleneckAtOutcomeCreation)) errors.push(`${path}.bottleneckAtOutcomeCreation must be a non-empty string`);
    /* null is meaningful here: this outcome superseded nothing. */
    if (Object.hasOwn(value, 'supersedesOutcomeId') && value.supersedesOutcomeId !== null && !isNonEmptyString(value.supersedesOutcomeId)) errors.push(`${path}.supersedesOutcomeId must be null or a non-empty string`);
  }
}

/**
 * Validates one V2 field's raw value (list or section) — dispatches by
 * field name. Section values may be `null` (explicitly unknown); list
 * values may not (an unknown list is simply absent from the state, never
 * present-but-empty, matching V1's convention for completedWork etc).
 *
 * @returns {boolean} true if this function recognised and validated `field` (whether or not it passed); false if `field` is not a V2 field at all.
 */
export function validateV2FactValue(field, value, path, errors) {
  if (V2_LIST_FACT_FIELDS.includes(field)) {
    if (!isNonEmptyStringArrayLoose(value) || new Set(value).size !== value.length) {
      errors.push(`${path} must be a non-empty array of distinct non-empty strings`);
    }
    return true;
  }
  if (V2_SECTION_FACT_FIELDS.includes(field)) {
    if (value === null) return true;
    if (!isPlainObject(value)) { errors.push(`${path} must be null or a plain object`); return true; }
    validateSectionObject(field, value, path, errors);
    return true;
  }
  if (field === LEGACY_REVENUE_STATE_FIELD) {
    validateLegacyRevenueStateValue(value, path, errors);
    return true;
  }
  return false;
}

/**
 * Validates the LEGACY bundled pricing/revenue shape -- never accepted for
 * a NEW fact (no collector produces this key any more), but a historical
 * row using it must still pass basic structural validation rather than
 * being treated as corrupt. See rebuildStateFromFacts (fact-ledger.js) for
 * how such a row is handled at rebuild time: never auto-trusted as either
 * offerPricing or revenue unless it unambiguously normalises.
 */
export function validateLegacyRevenueStateValue(value, path, errors) {
  if (value === null) return;
  if (!isPlainObject(value)) { errors.push(`${path} must be null or a plain object`); return; }
  const allowed = ['hasRevenue', 'monthlyRevenueUsd', 'pricingModel', 'notes'];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`unknown ${path} field: ${key}`);
  }
  if (Object.hasOwn(value, 'hasRevenue') && !isBoolean(value.hasRevenue)) errors.push(`${path}.hasRevenue must be a boolean`);
  if (Object.hasOwn(value, 'monthlyRevenueUsd') && !isNonNegativeNumber(value.monthlyRevenueUsd)) errors.push(`${path}.monthlyRevenueUsd must be a non-negative number`);
  if (Object.hasOwn(value, 'pricingModel') && !isNonEmptyString(value.pricingModel)) errors.push(`${path}.pricingModel must be a non-empty string`);
  if (Object.hasOwn(value, 'notes') && !isNonEmptyString(value.notes)) errors.push(`${path}.notes must be a non-empty string`);
}

/**
 * Attempts an UNAMBIGUOUS normalisation of one legacy revenueState value
 * into a real offerPricing value. Only the exact shape the pre-repair chat
 * collector actually produced (hasRevenue:false, monthlyRevenueUsd:0, and a
 * pricingModel that is literally a dollar amount like "$399") is
 * unambiguous enough to migrate automatically -- it can only have come from
 * a stated price, since the old code always paired it with a fabricated
 * (never real) zero-revenue claim. Any other shape (hasRevenue:true, a
 * non-dollar pricingModel, extra notes, etc.) is genuinely ambiguous and
 * must NOT be guessed at; the caller (rebuildStateFromFacts) surfaces it as
 * a clarification requirement instead.
 *
 * @param {unknown} value
 * @returns {{price: number, currency: string}|null} null when ambiguous.
 */
export function tryNormalizeLegacyRevenueStateToOfferPricing(value) {
  if (!isPlainObject(value)) return null;
  const isUnambiguousZeroRevenueShape = value.hasRevenue === false
    && value.monthlyRevenueUsd === 0
    && Object.keys(value).every((key) => ['hasRevenue', 'monthlyRevenueUsd', 'pricingModel'].includes(key));
  const priceMatch = typeof value.pricingModel === 'string' ? value.pricingModel.match(/^\$(\d+(?:\.\d+)?)$/) : null;
  if (isUnambiguousZeroRevenueShape && priceMatch) {
    return { price: Number(priceMatch[1]), currency: 'USD' };
  }
  return null;
}
