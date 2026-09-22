/**
 * Founder Execution Entities — materialised collections and the trusted
 * bundle projection, mirroring snapshot.js's buildMaterialisedVentureState/
 * buildFounderGoalEngineSnapshot pattern exactly (two altitudes: the full
 * always-present materialised view, then a read-only trusted projection).
 *
 * An entity is never a second source of truth: every value here is read
 * straight out of fact-ledger.js's rebuildStateFromFacts() `perKey`/
 * `conflicts`/`firstSeenAt` output for keys matching entities.js's
 * `<entityType>:<entityId>` pattern -- the same reducer, same trust
 * hierarchy, same append-only history every other Founder fact already
 * uses. Nothing here merges, ranks, or persists a competing collection.
 */

import { isNonEmptyString, validTimestamp } from './contract.js';
import {
  ENTITY_ID_PATTERN,
  parseEntityFactKey,
  validateEntityFactValue,
} from './entities.js';

export const FOUNDER_EXECUTION_ENTITIES_CONTRACT_VERSION = 1;

const ENTITY_TYPE_TO_COLLECTION = Object.freeze({
  customerEntity: 'customerEntities',
  operatingProcessEntity: 'operatingProcessEntities',
  strategyDecisionEntity: 'strategyDecisionEntities',
});
const COLLECTION_NAMES = Object.freeze(Object.values(ENTITY_TYPE_TO_COLLECTION));
const USABLE_TRUST_STATES = Object.freeze(['proof_verified', 'system_verified', 'user_confirmed']);
const PROJECTED_TRUST_STATES = Object.freeze(['proof_verified', 'system_verified', 'user_confirmed', 'provisional', 'disputed']);

function lifecycleStatusFor(entityType, value) {
  if (entityType === 'customerEntity') return value.customerStatus;
  if (entityType === 'operatingProcessEntity') return value.lifecycleStatus;
  if (entityType === 'strategyDecisionEntity') return value.decisionStatus;
  return 'unknown';
}

/**
 * A usable-for-eligibility entity: proof_verified/system_verified/
 * user_confirmed, and not archived/inactive. 'provisional' entities are
 * deliberately excluded here -- they remain VISIBLE in the collection (see
 * buildEntityCollections) but must never make a route eligible on their
 * own (task rule: "provisional entities may be visible but must produce
 * clarification or confirmation requirements").
 */
export function isUsableEntity(entity) {
  if (!USABLE_TRUST_STATES.includes(entity.verificationStatus)) return false;
  if (entity.lifecycleStatus === 'archived' || entity.lifecycleStatus === 'inactive') return false;
  return true;
}

/**
 * Groups fact-ledger perKey entries into the three entity collections.
 * Deterministic: always sorted by entityId, never by insertion/object-key
 * order, so identical trusted inputs always produce identical output.
 *
 * @param {ReturnType<import('./fact-ledger.js').rebuildStateFromFacts>} rebuilt
 * @param {string} ventureId
 * @returns {{customerEntities: object[], operatingProcessEntities: object[], strategyDecisionEntities: object[]}}
 */
export function buildEntityCollections(rebuilt, ventureId) {
  const { perKey, conflicts, firstSeenAt } = rebuilt;
  const collections = { customerEntities: [], operatingProcessEntities: [], strategyDecisionEntities: [] };

  for (const [factKey, fact] of Object.entries(perKey)) {
    const parsed = parseEntityFactKey(factKey);
    if (!parsed) continue;
    const { entityType, entityId } = parsed;
    const entityConflicts = conflicts
      .filter((conflict) => conflict.factKey === factKey)
      .map((conflict) => ({ ...conflict }));

    collections[ENTITY_TYPE_TO_COLLECTION[entityType]].push({
      entityId,
      entityType,
      ventureId,
      lifecycleStatus: lifecycleStatusFor(entityType, fact.value),
      verificationStatus: fact.verificationStatus,
      value: fact.value,
      sourceFactId: fact.factId,
      provenance: fact.sourceReference,
      confidence: fact.confidence,
      firstObservedAt: firstSeenAt?.[factKey] ?? fact.occurredAt,
      lastConfirmedAt: fact.occurredAt,
      conflicts: entityConflicts,
    });
  }

  for (const name of COLLECTION_NAMES) {
    collections[name].sort((a, b) => a.entityId.localeCompare(b.entityId));
  }
  return collections;
}

function averageConfidence(entities) {
  const values = entities.map((entity) => entity.confidence).filter((value) => typeof value === 'number');
  if (values.length === 0) return 0;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

// Freshness mirrors snapshot.js's own convention: "fresh" means the evidence
// we hold is CURRENT, never merely that the bundle was just computed.
//
// user_confirmed counts alongside proof_verified/system_verified for exactly
// the same reason it does in snapshot.js's isStale(): an entity the founder
// affirmatively confirmed is current evidence, even though it is not proof.
// Trust is untouched -- verificationStatus is unchanged, provenanceSummary
// still reports each tier separately, and confidence weighting is unaffected.
// Without this, an intake-only venture's entity bundle was permanently stale,
// and founder-bottleneck/confidence.js downgrades on
// `snapshot.freshness === 'stale' || entityBundle.freshness === 'stale'` --
// so fixing only the snapshot side left the same venture pinned to 'low'.
// Provisional entities still never establish currency.
function computeFreshness(entities, evaluationTime, staleAfterMs) {
  const CURRENCY_STATES = ['proof_verified', 'system_verified', 'user_confirmed'];
  const lastConfirmedTimes = entities
    .filter((entity) => CURRENCY_STATES.includes(entity.verificationStatus))
    .map((entity) => Date.parse(entity.lastConfirmedAt))
    .filter((ms) => Number.isFinite(ms));
  if (lastConfirmedTimes.length === 0) return 'stale';
  const mostRecent = Math.max(...lastConfirmedTimes);
  return Date.parse(evaluationTime) - mostRecent > staleAfterMs ? 'stale' : 'fresh';
}

function provenanceSummary(entities) {
  const counts = {};
  for (const entity of entities) counts[entity.verificationStatus] = (counts[entity.verificationStatus] || 0) + 1;
  return counts;
}

/**
 * The trusted, read-only Founder Execution Entities bundle -- the exact
 * shape attached to `programme.requiredAttributes.founderExecutionEntities`
 * (see entity-request-integration.js). Never merges primary and secondary;
 * operates on exactly one venture's materialised state per call.
 *
 * @param {object} state buildMaterialisedVentureState(...)'s result (must already carry an `entities` field -- see snapshot.js).
 * @param {string} evaluationTime ISO timestamp "now".
 * @param {number} [staleAfterMs] Defaults to 30 days.
 * @returns {object}
 */
export function buildFounderExecutionEntities(state, evaluationTime, staleAfterMs = 30 * 24 * 60 * 60 * 1000) {
  const { customerEntities, operatingProcessEntities, strategyDecisionEntities } = state.entities;
  const all = [...customerEntities, ...operatingProcessEntities, ...strategyDecisionEntities];

  const missingEntityInputs = [];
  if (customerEntities.filter(isUsableEntity).length === 0) missingEntityInputs.push('customerEntities');
  if (operatingProcessEntities.filter(isUsableEntity).length === 0) missingEntityInputs.push('operatingProcessEntities');
  if (strategyDecisionEntities.filter((entity) => isUsableEntity(entity) && entity.value.decisionStatus === 'open').length === 0) {
    missingEntityInputs.push('strategyDecisionEntities');
  }

  return {
    contractVersion: FOUNDER_EXECUTION_ENTITIES_CONTRACT_VERSION,
    ventureId: state.ventureId,
    ventureRole: state.ventureRole,
    sourceStateVersion: state.stateVersion,
    customerEntities,
    operatingProcessEntities,
    strategyDecisionEntities,
    conflicts: all.flatMap((entity) => entity.conflicts),
    missingEntityInputs,
    confidence: averageConfidence(all),
    freshness: computeFreshness(all, evaluationTime, staleAfterMs),
    provenanceSummary: provenanceSummary(all),
  };
}

const BUNDLE_REQUIRED_FIELDS = Object.freeze([
  'contractVersion', 'ventureId', 'ventureRole', 'sourceStateVersion',
  'customerEntities', 'operatingProcessEntities', 'strategyDecisionEntities',
  'conflicts', 'missingEntityInputs', 'confidence', 'freshness', 'provenanceSummary',
]);
const ENTITY_VIEW_REQUIRED_FIELDS = Object.freeze([
  'entityId', 'entityType', 'ventureId', 'lifecycleStatus', 'verificationStatus', 'value',
  'sourceFactId', 'provenance', 'confidence', 'firstObservedAt', 'lastConfirmedAt', 'conflicts',
]);

function validateEntityView(entity, collectionName, expectedVentureId, index, errors, seenIds) {
  const path = `${collectionName}[${index}]`;
  if (entity === null || typeof entity !== 'object' || Array.isArray(entity)) {
    errors.push(`${path} must be a plain object`);
    return;
  }
  for (const field of ENTITY_VIEW_REQUIRED_FIELDS) {
    if (!Object.hasOwn(entity, field)) errors.push(`missing required field: ${path}.${field}`);
  }
  for (const field of Object.keys(entity)) {
    if (!ENTITY_VIEW_REQUIRED_FIELDS.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  }
  if (errors.some((e) => e.startsWith(`missing required field: ${path}.`))) return;

  if (!ENTITY_ID_PATTERN.test(entity.entityId)) errors.push(`${path}.entityId must be a snake_case entity id`);
  if (!Object.hasOwn(ENTITY_TYPE_TO_COLLECTION, entity.entityType) || ENTITY_TYPE_TO_COLLECTION[entity.entityType] !== collectionName) {
    errors.push(`${path}.entityType does not match its collection (${collectionName})`);
  }
  if (entity.ventureId !== expectedVentureId) errors.push(`${path} belongs to a different venture (cross-venture entity injection)`);
  if (!PROJECTED_TRUST_STATES.includes(entity.verificationStatus)) errors.push(`${path}.verificationStatus is not a supported projected trust state`);
  if (!isNonEmptyString(entity.sourceFactId)) errors.push(`${path}.sourceFactId (provenance) is required`);
  if (!isNonEmptyString(entity.provenance)) errors.push(`${path}.provenance is required`);
  if (entity.confidence !== null && (!Number.isFinite(entity.confidence) || entity.confidence < 0 || entity.confidence > 1)) {
    errors.push(`${path}.confidence must be null or a number from 0 to 1`);
  }
  if (!validTimestamp(entity.firstObservedAt)) errors.push(`${path}.firstObservedAt must be a valid timestamp`);
  if (!validTimestamp(entity.lastConfirmedAt)) errors.push(`${path}.lastConfirmedAt must be a valid timestamp`);
  if (!Array.isArray(entity.conflicts)) errors.push(`${path}.conflicts must be an array`);

  const valueErrors = [];
  validateEntityFactValue(entity.entityType, entity.value, `${path}.value`, valueErrors);
  errors.push(...valueErrors);

  const expectedLifecycleStatus = lifecycleStatusFor(entity.entityType, entity.value);
  if (entity.lifecycleStatus !== expectedLifecycleStatus) {
    errors.push(`${path}.lifecycleStatus does not match the canonical status in its value`);
  }

  const dupKey = `${entity.entityId}`;
  if (seenIds.has(dupKey)) {
    errors.push(`entity id "${entity.entityId}" is duplicated (within or across entity types) -- one id cannot belong to two entities`);
  }
  seenIds.add(dupKey);

}

/**
 * Fail-closed validator: never partially attaches a malformed bundle. Must
 * be run before ANY field of a bundle (freshly built or reloaded from a
 * cached state) is trusted downstream.
 *
 * @param {unknown} bundle
 * @param {string} expectedVentureId
 * @param {string} expectedVentureRole
 * @param {number} expectedStateVersion
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateFounderExecutionEntities(bundle, expectedVentureId, expectedVentureRole, expectedStateVersion) {
  const errors = [];
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { valid: false, errors: ['bundle must be a plain object'] };
  }
  for (const field of BUNDLE_REQUIRED_FIELDS) {
    if (!Object.hasOwn(bundle, field)) errors.push(`missing required field: bundle.${field}`);
  }
  for (const field of Object.keys(bundle)) {
    if (!BUNDLE_REQUIRED_FIELDS.includes(field)) errors.push(`unknown bundle field: ${field}`);
  }
  if (errors.length > 0) return { valid: false, errors };

  if (bundle.contractVersion !== FOUNDER_EXECUTION_ENTITIES_CONTRACT_VERSION) errors.push(`bundle.contractVersion must be ${FOUNDER_EXECUTION_ENTITIES_CONTRACT_VERSION}`);
  if (!bundle.ventureId) errors.push('bundle.ventureId is required');
  else if (bundle.ventureId !== expectedVentureId) errors.push('bundle.ventureId does not match the expected ventureId');
  if (bundle.ventureRole !== expectedVentureRole || !['primary', 'secondary'].includes(bundle.ventureRole)) {
    errors.push('bundle.ventureRole does not match the expected ventureRole (secondary cannot be passed as primary, or vice versa)');
  }
  if (bundle.sourceStateVersion !== expectedStateVersion) errors.push('bundle.sourceStateVersion does not match the expected snapshot state version');
  if (!Number.isFinite(bundle.confidence) || bundle.confidence < 0 || bundle.confidence > 1) errors.push('bundle.confidence must be a number from 0 to 1');
  if (!['fresh', 'stale'].includes(bundle.freshness)) errors.push('bundle.freshness must be fresh or stale');
  if (!Array.isArray(bundle.conflicts)) errors.push('bundle.conflicts must be an array');
  if (!Array.isArray(bundle.missingEntityInputs)) errors.push('bundle.missingEntityInputs must be an array');
  if (bundle.provenanceSummary === null || typeof bundle.provenanceSummary !== 'object' || Array.isArray(bundle.provenanceSummary)) {
    errors.push('bundle.provenanceSummary must be a plain object');
  }

  if (errors.length > 0) return { valid: false, errors };

  const seenIds = new Set();
  for (const collectionName of COLLECTION_NAMES) {
    if (!Array.isArray(bundle[collectionName])) {
      errors.push(`bundle.${collectionName} must be an array`);
      continue;
    }
    bundle[collectionName].forEach((entity, index) => validateEntityView(entity, collectionName, expectedVentureId, index, errors, seenIds));
  }

  return { valid: errors.length === 0, errors };
}
