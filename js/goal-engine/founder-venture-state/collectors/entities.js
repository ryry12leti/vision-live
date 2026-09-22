/**
 * Founder Execution Entities collectors.
 *
 * Structured ingestion builders (onboarding/manual/proof/integration
 * sources) plus one narrow, deterministic chat-extraction pattern per
 * entity type -- never a general-purpose NLP extractor, only the specific
 * unambiguous statement shapes named in the task spec, gated by the exact
 * same HYPOTHETICAL_RE chat.js already uses. An extracted chat suggestion
 * is always `analyst_chat` / `provisional`: visible, never eligible until a
 * human confirms it (collectors/manual.js) or it is otherwise verified.
 */

import { buildFact } from '../fact-ledger.js';
import { buildEntityFactKey, ENTITY_ID_PATTERN } from '../entities.js';
import { HYPOTHETICAL_RE } from './chat.js';

// ---------------------------------------------------------------------------
// Structured ingestion builders -- one per entity type, mirroring
// collectors/manual.js's buildManualUpdateFact shape but pre-shaping the
// entity factKey/value so callers never hand-construct one.
// ---------------------------------------------------------------------------

export function buildCustomerEntityFact({
  ventureId, userId, customerEntityId, relationshipType, segmentId = null, safeDisplayLabel, contactability,
  availableChannelIds = [], customerStatus, sourceType, sourceReference, occurredAt, recordedAt = occurredAt,
  verificationStatus = null, confidence = null, factId = `${sourceReference}:${customerEntityId}`,
}) {
  return buildFact({
    factId,
    ventureId,
    userId,
    factKey: buildEntityFactKey('customerEntity', customerEntityId),
    value: {
      relationshipType, segmentId, safeDisplayLabel, contactability, availableChannelIds, customerStatus,
    },
    sourceType,
    sourceReference,
    occurredAt,
    recordedAt,
    verificationStatus,
    confidence,
  });
}

export function buildProcessEntityFact({
  ventureId, userId, processEntityId, processName, businessFunction, lifecycleStatus,
  currentProcessState = null, failurePointId = null, processDocumentationResourceId = null,
  operationalRecordResourceId = null, verificationEnvironmentResourceId = null,
  sourceType, sourceReference, occurredAt, recordedAt = occurredAt, verificationStatus = null,
  confidence = null, factId = `${sourceReference}:${processEntityId}`,
}) {
  return buildFact({
    factId,
    ventureId,
    userId,
    factKey: buildEntityFactKey('operatingProcessEntity', processEntityId),
    value: {
      processName,
      businessFunction,
      lifecycleStatus,
      currentProcessState,
      failurePointId,
      processDocumentationResourceId,
      operationalRecordResourceId,
      verificationEnvironmentResourceId,
    },
    sourceType,
    sourceReference,
    occurredAt,
    recordedAt,
    verificationStatus,
    confidence,
  });
}

export function buildStrategyDecisionEntityFact({
  ventureId, userId, strategyDecisionEntityId, decisionQuestion, decisionStatus, optionIds,
  criteriaIds = [], decisionEvidenceResourceId = null, decisionDeadline = null,
  sourceType, sourceReference, occurredAt, recordedAt = occurredAt, verificationStatus = null,
  confidence = null, factId = `${sourceReference}:${strategyDecisionEntityId}`,
}) {
  return buildFact({
    factId,
    ventureId,
    userId,
    factKey: buildEntityFactKey('strategyDecisionEntity', strategyDecisionEntityId),
    value: {
      decisionQuestion, decisionStatus, optionIds, criteriaIds, decisionEvidenceResourceId, decisionDeadline,
    },
    sourceType,
    sourceReference,
    occurredAt,
    recordedAt,
    verificationStatus,
    confidence,
  });
}

// ---------------------------------------------------------------------------
// Chat extraction. Deterministic, rule-based (never an LLM call). Every
// extracted fact is analyst_chat/provisional -- see fact-ledger.js's
// SOURCE_TYPE_TO_DEFAULT_STATUS; only an explicit user confirmation or
// verified proof can raise one afterwards.
// ---------------------------------------------------------------------------

function slugify(text) {
  const cleaned = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  const safe = /^[a-z]/.test(cleaned) ? cleaned : `entity_${cleaned}`;
  return ENTITY_ID_PATTERN.test(safe) && safe.length > 0 ? safe : null;
}

function splitNamedList(text) {
  return text
    .split(/,|\band\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

// "I need to interview three cafe owners: Cafe A, Cafe B and Cafe C."
const CUSTOMER_LIST_RE = /\binterview\s+.*?:\s*(.+?)[.!]?$/i;
// "Our onboarding process fails when the verification email does not arrive."
const PROCESS_FAILURE_RE = /\b(?:our|the|my)\s+(.+?)\s+process\s+(fails?|breaks?|is broken)\s+when\s+(.+?)[.!]?$/i;
// "I am deciding between charging monthly or charging annually."
const STRATEGY_CHOICE_RE = /\bi(?:'m| am)\s+deciding\s+between\s+(.+?)\s+or\s+(.+?)[.!]?$/i;

/**
 * @param {object} params
 * @param {string} params.ventureId
 * @param {string} params.userId
 * @param {string} params.message Raw chat message text.
 * @param {string} params.messageReference Stable, non-secret reference to this exact message.
 * @param {string} params.occurredAt ISO timestamp.
 * @returns {{facts: object[], skippedHypothetical: boolean}}
 */
export function extractCandidateEntityFactsFromChatMessage({
  ventureId, userId, message, messageReference, occurredAt,
}) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { facts: [], skippedHypothetical: false };
  }
  if (HYPOTHETICAL_RE.test(message)) {
    return { facts: [], skippedHypothetical: true };
  }

  const facts = [];
  let seq = 0;

  const customerMatch = message.match(CUSTOMER_LIST_RE);
  if (customerMatch) {
    for (const name of splitNamedList(customerMatch[1])) {
      const entityId = slugify(name);
      if (!entityId) continue;
      facts.push(buildCustomerEntityFact({
        ventureId,
        userId,
        customerEntityId: entityId,
        relationshipType: 'prospect',
        safeDisplayLabel: name,
        contactability: 'unknown',
        customerStatus: 'active',
        sourceType: 'analyst_chat',
        sourceReference: `${messageReference}:${seq++}`,
        occurredAt,
      }));
    }
  }

  const processMatch = message.match(PROCESS_FAILURE_RE);
  if (processMatch) {
    const processLabel = processMatch[1].trim();
    const entityId = slugify(`${processLabel}_process`);
    if (entityId) {
      facts.push(buildProcessEntityFact({
        ventureId,
        userId,
        processEntityId: entityId,
        processName: `${processLabel} process`,
        businessFunction: 'operations',
        lifecycleStatus: 'active',
        currentProcessState: `fails when ${processMatch[3].trim()}`,
        sourceType: 'analyst_chat',
        sourceReference: `${messageReference}:${seq++}`,
        occurredAt,
      }));
    }
  }

  const strategyMatch = message.match(STRATEGY_CHOICE_RE);
  if (strategyMatch) {
    const optionA = slugify(strategyMatch[1]);
    const optionB = slugify(strategyMatch[2]);
    if (optionA && optionB && optionA !== optionB) {
      const entityId = slugify(`decide_${strategyMatch[1]}_or_${strategyMatch[2]}`);
      if (entityId) {
        facts.push(buildStrategyDecisionEntityFact({
          ventureId,
          userId,
          strategyDecisionEntityId: entityId,
          decisionQuestion: message.trim(),
          decisionStatus: 'open',
          optionIds: [optionA, optionB],
          sourceType: 'analyst_chat',
          sourceReference: `${messageReference}:${seq++}`,
          occurredAt,
        }));
      }
    }
  }

  return { facts, skippedHypothetical: false };
}
