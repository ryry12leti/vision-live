/**
 * Founder Venture State V2 — Execution Entities fact-key contract.
 *
 * Founder Execution Entities are minimal structured references to real
 * business objects a Founder route genuinely needs (an identified
 * prospect, a real operating process, an open strategy decision) -- never
 * a CRM, never a contact database, never a place for private conversations
 * or credentials. The trusted memory of record stays the SAME append-only
 * Founder Venture State fact ledger (fact-ledger.js) every other Founder
 * fact already uses -- an entity is just a fact whose `factKey` names one
 * specific record instead of one shared venture-wide field.
 *
 * Fact-key shape: `<entityType>:<entityId>`, e.g.
 * `customerEntity:acme_cafe_owner`. Because `rebuildStateFromFacts`
 * (fact-ledger.js) already picks the single highest-authority LIVE fact per
 * distinct factKey and tracks same-tier disagreement as a conflict, giving
 * every entity its OWN factKey means the existing reducer -- unmodified --
 * already gives each entity independent, correct trust/merge/conflict
 * behaviour. No second merge engine, no new table.
 *
 * `entityId` must be a snake_case identifier (the same pattern
 * candidate-generator/domain-intelligence/shared.js's isTrustedIdentifier
 * enforces) because founder_operating_process.processId and
 * founder_strategy_decision.decisionId/optionIds flow this exact value
 * straight into that validator once a route becomes eligible -- requiring
 * it at ingestion, for every entity type, keeps the contract uniform and
 * means an entity id is always safe to use as a route field without any
 * further transformation (which could otherwise blur "real input" and
 * "invented reference").
 */

import { isNonEmptyString, validTimestamp } from './contract.js';

export const ENTITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const ENTITY_TYPES = Object.freeze(['customerEntity', 'operatingProcessEntity', 'strategyDecisionEntity']);

const ENTITY_KEY_RE = /^(customerEntity|operatingProcessEntity|strategyDecisionEntity):([a-z][a-z0-9]*(?:_[a-z0-9]+)*)$/;

/**
 * @param {unknown} factKey
 * @returns {boolean}
 */
export function isEntityFactKey(factKey) {
  return typeof factKey === 'string' && ENTITY_KEY_RE.test(factKey);
}

/**
 * @param {string} factKey
 * @returns {{entityType: string, entityId: string}|null}
 */
export function parseEntityFactKey(factKey) {
  const match = typeof factKey === 'string' ? factKey.match(ENTITY_KEY_RE) : null;
  if (!match) return null;
  return { entityType: match[1], entityId: match[2] };
}

/**
 * @param {string} entityType One of ENTITY_TYPES.
 * @param {string} entityId
 * @returns {string}
 */
export function buildEntityFactKey(entityType, entityId) {
  return `${entityType}:${entityId}`;
}

// ---------------------------------------------------------------------------
// PII gate. Never store raw contact details anywhere in an entity fact -- a
// "safe reference" points at a trusted CRM/upload record without exposing
// the sensitive value itself.
// ---------------------------------------------------------------------------
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(?:\+?\d[\s.-]?){7,}/;
const SECRET_RE = /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{12,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\b(?:sk|pk|ghp|gho|github_pat)_[A-Za-z0-9_-]{16,})/i;
const PROHIBITED_FIELD_NAMES = new Set([
  'email', 'emailaddress', 'phone', 'phonenumber', 'mobile', 'address', 'physicaladdress',
  'password', 'credentials', 'accesstoken', 'refreshtoken', 'apikey', 'secret', 'rawmessage',
  'transcript', 'privatemessage',
]);

function normalizedFieldName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function containsPii(value) {
  if (typeof value !== 'string') return false;
  return EMAIL_RE.test(value) || PHONE_RE.test(value) || SECRET_RE.test(value);
}

/**
 * Public defense-in-depth PII check, reused by entity-snapshot.js's bundle
 * validator: does any string field of this (already fact-shaped) value
 * look like an email/phone, or use a prohibited field name outright?
 *
 * @param {unknown} value An entity's `.value` (or any plain object).
 * @returns {boolean}
 */
export function containsPiiValue(value) {
  if (containsPii(value)) return true;
  if (Array.isArray(value)) return value.some((item) => containsPiiValue(item));
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, fieldValue]) => (
    PROHIBITED_FIELD_NAMES.has(normalizedFieldName(key)) || containsPiiValue(fieldValue)
  ));
}

function rejectProhibitedFields(value, path, errors) {
  if (containsPiiValue(value)) {
    errors.push(`${path} contains a prohibited sensitive field or value`);
  }
}

// ---------------------------------------------------------------------------
// Customer / prospect entity.
// ---------------------------------------------------------------------------
const RELATIONSHIP_TYPES = Object.freeze(['prospect', 'lead', 'customer', 'user']);
const CONTACTABILITY_STATES = Object.freeze(['reachable', 'not_reachable', 'unknown']);
const CUSTOMER_STATUSES = Object.freeze(['active', 'inactive', 'converted', 'archived']);
// Post-contact conversation state for a specific entity -- orthogonal to
// customerStatus (which tracks lifecycle, not conversation outcome). Mirrors
// the relevant subset of opportunity-intelligence/contract.js's own
// OPPORTUNITY_STATES so a lead's real-world response can be reflected here
// without redefining a second vocabulary.
export const ENGAGEMENT_STATES = Object.freeze([
  'not_contacted', 'contacted', 'no_response', 'interested', 'not_interested',
  'follow_up_needed', 'meeting_booked', 'lost', 'converted',
]);
// A specific, named next step this entity is waiting on the founder to
// deliver (e.g. the café owner who said "interested, but show me proof
// first"). Never invented -- only ever set from an explicit founder report
// (see opportunity-intelligence/founder-bridge.js's syncEngagementUpdate).
export const PENDING_REQUEST_TYPES = Object.freeze(['proof', 'pricing', 'proposal', 'meeting']);
const CUSTOMER_ENTITY_FIELDS = Object.freeze([
  'relationshipType', 'segmentId', 'safeDisplayLabel', 'contactability', 'availableChannelIds', 'customerStatus',
  'engagementState', 'pendingRequest',
]);

function validateCustomerEntityValue(value, path, errors) {
  rejectProhibitedFields(value, path, errors);
  for (const key of Object.keys(value)) {
    if (!CUSTOMER_ENTITY_FIELDS.includes(key)) errors.push(`unknown ${path} field: ${key}`);
  }
  if (!Object.hasOwn(value, 'relationshipType') || !RELATIONSHIP_TYPES.includes(value.relationshipType)) errors.push(`${path}.relationshipType must be one of ${RELATIONSHIP_TYPES.join(', ')}`);
  if (Object.hasOwn(value, 'segmentId') && value.segmentId !== null && !isNonEmptyString(value.segmentId)) errors.push(`${path}.segmentId must be null or a non-empty string`);
  if (!Object.hasOwn(value, 'safeDisplayLabel') || !isNonEmptyString(value.safeDisplayLabel)) errors.push(`${path}.safeDisplayLabel must be a non-empty string`);
  if (!Object.hasOwn(value, 'contactability') || !CONTACTABILITY_STATES.includes(value.contactability)) errors.push(`${path}.contactability must be one of ${CONTACTABILITY_STATES.join(', ')}`);
  if (Object.hasOwn(value, 'availableChannelIds')) {
    if (!Array.isArray(value.availableChannelIds) || !value.availableChannelIds.every((id) => isNonEmptyString(id))) errors.push(`${path}.availableChannelIds must be an array of non-empty strings`);
  }
  if (!Object.hasOwn(value, 'customerStatus') || !CUSTOMER_STATUSES.includes(value.customerStatus)) errors.push(`${path}.customerStatus must be one of ${CUSTOMER_STATUSES.join(', ')}`);
  if (Object.hasOwn(value, 'engagementState') && value.engagementState !== null && !ENGAGEMENT_STATES.includes(value.engagementState)) errors.push(`${path}.engagementState must be null or one of ${ENGAGEMENT_STATES.join(', ')}`);
  if (Object.hasOwn(value, 'pendingRequest') && value.pendingRequest !== null && !PENDING_REQUEST_TYPES.includes(value.pendingRequest)) errors.push(`${path}.pendingRequest must be null or one of ${PENDING_REQUEST_TYPES.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Operating process entity.
// ---------------------------------------------------------------------------
const PROCESS_LIFECYCLE_STATES = Object.freeze(['active', 'inactive', 'archived']);
const PROCESS_ENTITY_FIELDS = Object.freeze([
  'processName', 'businessFunction', 'lifecycleStatus', 'currentProcessState', 'failurePointId',
  'processDocumentationResourceId', 'operationalRecordResourceId', 'verificationEnvironmentResourceId',
]);

function validateProcessEntityValue(value, path, errors) {
  rejectProhibitedFields(value, path, errors);
  for (const key of Object.keys(value)) {
    if (!PROCESS_ENTITY_FIELDS.includes(key)) errors.push(`unknown ${path} field: ${key}`);
  }
  if (!Object.hasOwn(value, 'processName') || !isNonEmptyString(value.processName)) errors.push(`${path}.processName must be a non-empty string`);
  if (!Object.hasOwn(value, 'businessFunction') || !isNonEmptyString(value.businessFunction)) errors.push(`${path}.businessFunction must be a non-empty string`);
  if (!Object.hasOwn(value, 'lifecycleStatus') || !PROCESS_LIFECYCLE_STATES.includes(value.lifecycleStatus)) errors.push(`${path}.lifecycleStatus must be one of ${PROCESS_LIFECYCLE_STATES.join(', ')}`);
  if (Object.hasOwn(value, 'currentProcessState') && value.currentProcessState !== null && !isNonEmptyString(value.currentProcessState)) errors.push(`${path}.currentProcessState must be null or a non-empty string`);
  if (Object.hasOwn(value, 'failurePointId') && value.failurePointId !== null && !isNonEmptyString(value.failurePointId)) errors.push(`${path}.failurePointId must be null or a non-empty string`);
  for (const resourceField of ['processDocumentationResourceId', 'operationalRecordResourceId', 'verificationEnvironmentResourceId']) {
    if (Object.hasOwn(value, resourceField) && value[resourceField] !== null && !isNonEmptyString(value[resourceField])) errors.push(`${path}.${resourceField} must be null or a non-empty string`);
  }
}

// ---------------------------------------------------------------------------
// Strategy decision entity.
// ---------------------------------------------------------------------------
const DECISION_STATUSES = Object.freeze(['open', 'resolved', 'archived']);
const STRATEGY_ENTITY_FIELDS = Object.freeze([
  'decisionQuestion', 'decisionStatus', 'optionIds', 'criteriaIds', 'decisionEvidenceResourceId', 'decisionDeadline',
]);

function validateStrategyDecisionEntityValue(value, path, errors) {
  rejectProhibitedFields(value, path, errors);
  for (const key of Object.keys(value)) {
    if (!STRATEGY_ENTITY_FIELDS.includes(key)) errors.push(`unknown ${path} field: ${key}`);
  }
  if (!Object.hasOwn(value, 'decisionQuestion') || !isNonEmptyString(value.decisionQuestion)) errors.push(`${path}.decisionQuestion must be a non-empty string`);
  if (!Object.hasOwn(value, 'decisionStatus') || !DECISION_STATUSES.includes(value.decisionStatus)) errors.push(`${path}.decisionStatus must be one of ${DECISION_STATUSES.join(', ')}`);
  if (!Object.hasOwn(value, 'optionIds') || !Array.isArray(value.optionIds) || value.optionIds.length === 0
    || !value.optionIds.every((id) => ENTITY_ID_PATTERN.test(id)) || new Set(value.optionIds).size !== value.optionIds.length) {
    errors.push(`${path}.optionIds must be a non-empty array of distinct snake_case option ids`);
  }
  if (value.decisionStatus === 'open' && Array.isArray(value.optionIds) && value.optionIds.length < 2) {
    errors.push(`${path}.optionIds must contain at least two real option ids for an open decision`);
  }
  if (Object.hasOwn(value, 'criteriaIds')) {
    if (!Array.isArray(value.criteriaIds) || !value.criteriaIds.every((id) => isNonEmptyString(id))) errors.push(`${path}.criteriaIds must be an array of non-empty strings`);
  }
  if (Object.hasOwn(value, 'decisionEvidenceResourceId') && value.decisionEvidenceResourceId !== null && !isNonEmptyString(value.decisionEvidenceResourceId)) errors.push(`${path}.decisionEvidenceResourceId must be null or a non-empty string`);
  if (Object.hasOwn(value, 'decisionDeadline') && value.decisionDeadline !== null && !validTimestamp(value.decisionDeadline)) errors.push(`${path}.decisionDeadline must be null or a valid timestamp`);
}

/**
 * @param {string} entityType One of ENTITY_TYPES.
 * @param {unknown} value
 * @param {string} path
 * @param {string[]} errors
 */
export function validateEntityFactValue(entityType, value, path, errors) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} must be a plain object`);
    return;
  }
  if (entityType === 'customerEntity') validateCustomerEntityValue(value, path, errors);
  else if (entityType === 'operatingProcessEntity') validateProcessEntityValue(value, path, errors);
  else if (entityType === 'strategyDecisionEntity') validateStrategyDecisionEntityValue(value, path, errors);
  else errors.push(`${path} references an unrecognised entity type: ${entityType}`);
}
