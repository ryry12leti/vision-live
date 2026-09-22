/**
 * Founder Venture State V2 — the append-only fact ledger.
 *
 * This is the DB-row-shaped contract for `public.founder_venture_facts`
 * (see the migration) and the deterministic reducer that rebuilds a
 * materialised venture state from that ledger. It extends V1's
 * TrustedField/mergeField precedence idea (contract.js, assembler.js) to a
 * richer six-state verification vocabulary and an explicit, auditable
 * conflict record — it does not replace V1's assembleFounderVentureState,
 * which keeps working exactly as before for existing callers.
 *
 * CORE RULE: a fact is either recorded with real provenance and a real
 * value, or it does not exist. There is no "confident guess" tier. Missing
 * information is represented by the field being absent from the rebuilt
 * state (reported as unknown/missing by snapshot.js and clarification.js),
 * never by inventing a placeholder value.
 */

import { retireConflictsResolvedBy } from '../decision-core/index.js';
import {
  FOUNDER_MODES,
  FOUNDER_STAGES,
  LIST_FACT_FIELDS,
  SCALAR_FACT_FIELDS,
  VENTURE_ROLES,
  isFounderStage,
  isNonEmptyString,
  validTimestamp,
  validateFactValue as validateV1FactValue,
} from './contract.js';
import { isEntityFactKey, validateEntityFactValue } from './entities.js';
import {
  LEGACY_REVENUE_STATE_FIELD,
  V2_FIELD_NAMES,
  V2_LIST_FACT_FIELDS,
  V2_SECTION_FACT_FIELDS,
  tryNormalizeLegacyRevenueStateToOfferPricing,
  validateV2FactValue,
} from './sections.js';

export const FOUNDER_VENTURE_FACT_LEDGER_VERSION = 1;

// Table C's source_type vocabulary (task spec, section 4/C).
export const FACT_SOURCE_TYPES = Object.freeze([
  'onboarding',
  'analyst_chat',
  'user_manual_update',
  'verified_proof',
  'uploaded_file',
  'github',
  'supabase',
  'vercel',
  'website',
  'system_observation',
]);

// Table C's verification_status vocabulary (task spec, section 2/C). A
// fresh fact may only ever arrive as one of the first four; 'disputed' and
// 'superseded' are states the SERVICE applies to an existing fact through
// an explicit dispute/supersede operation, never a status a new incoming
// fact claims for itself.
export const VERIFICATION_STATES = Object.freeze([
  'provisional', 'user_confirmed', 'system_verified', 'proof_verified', 'disputed', 'superseded',
]);
export const INCOMING_VERIFICATION_STATES = Object.freeze(['provisional', 'user_confirmed', 'system_verified', 'proof_verified']);

// Trust hierarchy (task spec, section 2): proof_verified > system_verified >
// user_confirmed > provisional. 'disputed' carries no authority (rank -1 —
// strictly below provisional, so it never silently wins a merge and never
// blocks a fresh, better-sourced fact from superseding it). 'superseded' is
// terminal and excluded from rebuild entirely (see isLiveFact below).
const AUTHORITY_RANK = Object.freeze({
  disputed: -1,
  provisional: 0,
  user_confirmed: 1,
  system_verified: 2,
  proof_verified: 3,
  superseded: -2,
});
export function authorityRank(verificationStatus) {
  return AUTHORITY_RANK[verificationStatus];
}

const SOURCE_TYPE_TO_DEFAULT_STATUS = Object.freeze({
  onboarding: 'user_confirmed',
  analyst_chat: 'provisional',
  user_manual_update: 'user_confirmed',
  verified_proof: 'proof_verified',
  uploaded_file: 'provisional',
  github: 'system_verified',
  supabase: 'system_verified',
  vercel: 'system_verified',
  website: 'provisional',
  system_observation: 'system_verified',
});
export function defaultVerificationStatusFor(sourceType) {
  return SOURCE_TYPE_TO_DEFAULT_STATUS[sourceType];
}

// Every recognised fact_key across V1 + V2, so the ledger can validate a
// key it wasn't specifically written for as "unrecognised" rather than
// silently accepting it.
export const STRUCTURED_FACT_KEYS = Object.freeze(['currentStage', 'founderMode']);
// LEGACY_REVENUE_STATE_FIELD ('revenueState') is recognised so a historical
// row using the pre-repair bundled shape is never rejected outright (see
// sections.js's validateLegacyRevenueStateValue) -- but it is NOT part of
// V2_FIELD_NAMES and no first-party collector emits it again.
export const ALL_FACT_KEYS = Object.freeze([
  ...SCALAR_FACT_FIELDS, ...LIST_FACT_FIELDS, ...STRUCTURED_FACT_KEYS, ...V2_FIELD_NAMES, LEGACY_REVENUE_STATE_FIELD,
]);

export const FACT_TYPES = Object.freeze(['scalar', 'list', 'section', 'stage', 'mode', 'entity']);

/**
 * Classifies a fact_key into one of FACT_TYPES — always derived from the
 * key itself, never caller-supplied, so a fact's declared type can never
 * mismatch its actual key (see buildFact/validateVentureFact).
 *
 * Entity keys (`<entityType>:<entityId>`, see entities.js) are matched by
 * PATTERN rather than a fixed enum membership, since an unbounded number of
 * distinct entities can exist -- everything else here is still a closed,
 * finite key list.
 */
export function factTypeFor(factKey) {
  if (factKey === 'currentStage') return 'stage';
  if (factKey === 'founderMode') return 'mode';
  if (SCALAR_FACT_FIELDS.includes(factKey)) return 'scalar';
  if (LIST_FACT_FIELDS.includes(factKey) || V2_LIST_FACT_FIELDS.includes(factKey)) return 'list';
  if (V2_SECTION_FACT_FIELDS.includes(factKey)) return 'section';
  if (factKey === LEGACY_REVENUE_STATE_FIELD) return 'section';
  if (isEntityFactKey(factKey)) return 'entity';
  return null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validates one fact_key/value pair against whichever registry (V1
 * scalar/list, V1 structured stage/mode, or V2 section/list) actually owns
 * that key. Returns false (with an error pushed) for any key not
 * recognised anywhere — there is no silent passthrough for an unknown key.
 */
export function validateFactKeyValue(factKey, value, path, errors) {
  if (factKey === 'currentStage') {
    if (!isFounderStage(value)) errors.push(`${path} is not a supported Founder stage`);
    return true;
  }
  if (factKey === 'founderMode') {
    if (!FOUNDER_MODES.includes(value)) errors.push(`${path} is not a supported Founder mode`);
    return true;
  }
  if (SCALAR_FACT_FIELDS.includes(factKey) || LIST_FACT_FIELDS.includes(factKey)) {
    validateV1FactValue(factKey, value, path, errors);
    return true;
  }
  if (validateV2FactValue(factKey, value, path, errors)) return true;
  const entityKey = isEntityFactKey(factKey) ? factKey.split(':')[0] : null;
  if (entityKey) {
    validateEntityFactValue(entityKey, value, path, errors);
    return true;
  }
  errors.push(`${path} references an unrecognised fact_key: ${factKey}`);
  return false;
}

/**
 * Validates one raw founder_venture_facts row (or a to-be-inserted fact
 * before it is written) — the exact fields the migration's
 * `founder_venture_facts` table defines. `metadata` is a free but shallow
 * plain object (never validated for content — callers must not put secrets
 * there; see collectors, which never do).
 *
 * @param {unknown} fact
 * @param {number} index
 * @param {string[]} errors
 */
export function validateVentureFact(fact, index, errors) {
  const path = `facts[${index}]`;
  if (!isPlainObject(fact)) { errors.push(`${path} must be a plain object`); return; }
  const required = [
    'factId', 'ventureId', 'userId', 'factType', 'factKey', 'value', 'sourceType', 'sourceReference',
    'sourceEventId', 'verificationStatus', 'confidence', 'occurredAt', 'recordedAt',
    'supersedesFactId', 'active', 'metadata',
  ];
  for (const field of required) {
    if (!Object.hasOwn(fact, field)) errors.push(`missing required field: ${path}.${field}`);
  }
  for (const field of Object.keys(fact)) {
    if (!required.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  }
  if (errors.length > 0) return;

  if (!isNonEmptyString(fact.factId)) errors.push(`${path}.factId must be a non-empty string`);
  if (!isNonEmptyString(fact.ventureId)) errors.push(`${path}.ventureId must be a non-empty string`);
  if (!isNonEmptyString(fact.userId)) errors.push(`${path}.userId must be a non-empty string`);
  if (!ALL_FACT_KEYS.includes(fact.factKey) && !isEntityFactKey(fact.factKey)) errors.push(`${path}.factKey is not a recognised fact key`);
  else if (fact.factType !== factTypeFor(fact.factKey)) errors.push(`${path}.factType does not match the actual type of factKey "${fact.factKey}"`);
  if (!FACT_SOURCE_TYPES.includes(fact.sourceType)) errors.push(`${path}.sourceType is not supported`);
  if (!isNonEmptyString(fact.sourceReference)) errors.push(`${path}.sourceReference must be a non-empty string (provenance is mandatory)`);
  if (fact.sourceEventId !== null && !isNonEmptyString(fact.sourceEventId)) errors.push(`${path}.sourceEventId must be null or a non-empty string`);
  if (!VERIFICATION_STATES.includes(fact.verificationStatus)) errors.push(`${path}.verificationStatus is not supported`);
  if (fact.confidence !== null && (!Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 1)) {
    errors.push(`${path}.confidence must be null or a number from 0 to 1`);
  }
  if (!validTimestamp(fact.occurredAt)) errors.push(`${path}.occurredAt must be a valid timestamp`);
  if (!validTimestamp(fact.recordedAt)) errors.push(`${path}.recordedAt must be a valid timestamp`);
  if (validTimestamp(fact.occurredAt) && validTimestamp(fact.recordedAt) && Date.parse(fact.occurredAt) > Date.parse(fact.recordedAt) + 5 * 60 * 1000) {
    errors.push(`${path}: occurredAt cannot be meaningfully after recordedAt (impossible date ordering)`);
  }
  if (fact.supersedesFactId !== null && !isNonEmptyString(fact.supersedesFactId)) errors.push(`${path}.supersedesFactId must be null or a non-empty string`);
  if (fact.supersedesFactId === fact.factId) errors.push(`${path}.supersedesFactId cannot reference itself`);
  if (typeof fact.active !== 'boolean') errors.push(`${path}.active must be a boolean`);
  if (!isPlainObject(fact.metadata)) errors.push(`${path}.metadata must be a plain object`);

  if (ALL_FACT_KEYS.includes(fact.factKey) || isEntityFactKey(fact.factKey)) {
    validateFactKeyValue(fact.factKey, fact.value, `${path}.value`, errors);
  }
}

export function validateVentureFacts(facts) {
  const errors = [];
  if (!Array.isArray(facts)) return { valid: false, errors: ['facts must be an array'] };
  facts.forEach((fact, index) => validateVentureFact(fact, index, errors));
  const ids = facts.map((fact) => fact?.factId).filter(isNonEmptyString);
  if (new Set(ids).size !== ids.length) errors.push('fact factIds must be unique');
  return { valid: errors.length === 0, errors };
}

function byOccurredThenId(left, right) {
  const leftMs = Date.parse(left.occurredAt);
  const rightMs = Date.parse(right.occurredAt);
  if (leftMs !== rightMs) return leftMs - rightMs;
  return left.factId.localeCompare(right.factId);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Deterministically rebuilds materialised per-key state from an array of
 * facts (the exact "state rebuild from the fact ledger" the task requires,
 * and the "rebuild is deterministic" QA proof: the same fact array, in any
 * input order, always folds to the same result because facts are always
 * re-sorted by occurredAt/factId before folding).
 *
 * Only `active === true` facts are considered live; a fact whose
 * verificationStatus is 'superseded' is excluded even if still marked
 * active (belt-and-suspenders — the service should also set active=false
 * when it supersedes a fact). 'disputed' facts ARE still considered (at
 * rank -1) so a dispute can legitimately be overridden by any fresh
 * incoming fact, but a disputed fact can never itself win over anything.
 *
 * @param {object[]} facts Already-validated founder_venture_facts rows for exactly one venture.
 * @returns {{
 *   perKey: Record<string, {value: unknown, verificationStatus: string, factId: string, occurredAt: string}>,
 *   conflicts: {factKey: string, factIds: string[], reason: string}[],
 *   history: {factKey: string, previous: object, replacedByFactId: string}[],
 *   lastVerifiedAt: string|null,
 *   lastConfirmedAt: string|null,
 *   firstSeenAt: Record<string, string>,
 * }}
 */
export function rebuildStateFromFacts(facts) {
  const live = facts
    .filter((fact) => fact.active === true && fact.verificationStatus !== 'superseded')
    .slice()
    .sort(byOccurredThenId);

  const perKey = {};
  let conflicts = [];
  const history = [];
  // Conflicts that a strictly higher-trust fact later resolved. Retained for
  // audit: the disagreement genuinely happened, and both original facts are
  // still in the ledger and in `history`.
  const resolvedConflicts = [];
  // The earliest occurredAt ever seen live for each key, independent of
  // which fact currently wins the merge -- used for an entity's honest
  // "first observed" time (see entity-snapshot.js), additive only, changes
  // nothing about the existing per-key winner logic below.
  const firstSeenAt = {};
  let lastVerifiedAt = null;
  // Tracked SEPARATELY from lastVerifiedAt and never merged into it: a
  // user_confirmed fact is a fact the founder affirmatively reviewed and
  // stood behind, which is real evidence of currency but is NOT proof. It
  // never changes any fact's verificationStatus, never feeds CONFIDENCE_WEIGHT,
  // and never makes a venture count as verified.
  let lastConfirmedAt = null;

  for (const rawFact of live) {
    let fact = rawFact;
    if (rawFact.factKey === LEGACY_REVENUE_STATE_FIELD) {
      // LEGACY: the pre-repair bundled pricing/revenue fact. Never
      // auto-trusted as-is -- either it unambiguously normalises to a real
      // offerPricing fact (see sections.js), or it is surfaced as a
      // clarification requirement and contributes to NEITHER offerPricing
      // NOR revenue. Either way, the original fact row is untouched.
      const normalized = tryNormalizeLegacyRevenueStateToOfferPricing(rawFact.value);
      if (normalized) {
        fact = { ...rawFact, factKey: 'offerPricing', value: normalized };
      } else {
        conflicts.push({
          factKey: LEGACY_REVENUE_STATE_FIELD,
          factIds: [rawFact.factId],
          reason: 'legacy bundled pricing/revenue fact is ambiguous and was not auto-migrated to offerPricing or revenue -- clarification required',
        });
        continue;
      }
    }
    if (fact.verificationStatus === 'proof_verified' || fact.verificationStatus === 'system_verified') {
      if (!lastVerifiedAt || Date.parse(fact.occurredAt) > Date.parse(lastVerifiedAt)) lastVerifiedAt = fact.occurredAt;
    }
    if (fact.verificationStatus === 'user_confirmed') {
      if (!lastConfirmedAt || Date.parse(fact.occurredAt) > Date.parse(lastConfirmedAt)) lastConfirmedAt = fact.occurredAt;
    }
    if (!firstSeenAt[fact.factKey] || Date.parse(fact.occurredAt) < Date.parse(firstSeenAt[fact.factKey])) {
      firstSeenAt[fact.factKey] = fact.occurredAt;
    }
    const current = perKey[fact.factKey];
    const incomingRank = authorityRank(fact.verificationStatus);
    if (!current) {
      perKey[fact.factKey] = fact;
      continue;
    }
    const currentRank = authorityRank(current.verificationStatus);
    if (incomingRank > currentRank) {
      history.push({ factKey: fact.factKey, previous: current, replacedByFactId: fact.factId });
      // A strictly higher-trust fact authoritatively settles a disagreement
      // recorded between lower-trust facts for this SAME key -- that is what
      // an explicit user confirmation of a conflicted field means. Without
      // this, confirming the field replaced the value but left the conflict
      // standing, and confidence stayed pinned low forever. The rule itself
      // is a Goal Engine invariant, not a Founder one, so it lives in
      // decision-core; nothing is deleted here (both original facts remain in
      // the ledger, the superseded value in `history`, the retired conflict in
      // `resolvedConflicts`), and equal-trust disagreements are never resolved.
      const resolution = retireConflictsResolvedBy({
        conflicts, factKey: fact.factKey, factId: fact.factId, incomingRank, currentRank,
      });
      conflicts = resolution.conflicts;
      resolvedConflicts.push(...resolution.retired);
      perKey[fact.factKey] = fact;
    } else if (incomingRank === currentRank) {
      if (sameValue(current.value, fact.value)) {
        // Same tier, same value, later occurrence — accept as a
        // reaffirmation, never flagged as a conflict.
        history.push({ factKey: fact.factKey, previous: current, replacedByFactId: fact.factId });
        perKey[fact.factKey] = fact;
      } else {
        // Same tier, genuinely disagreeing values: never silently pick one.
        conflicts.push({
          factKey: fact.factKey,
          factIds: [current.factId, fact.factId],
          reason: `two ${fact.verificationStatus} facts disagree on ${fact.factKey}`,
        });
      }
    }
    // incomingRank < currentRank: silently ignored for merge purposes (a
    // lower-trust fact never overwrites a higher-trust one) — the fact
    // itself is still preserved untouched in the ledger, satisfying "never
    // delete historical facts to hide a contradiction".
  }

  return {
    perKey, conflicts, history, resolvedConflicts, lastVerifiedAt, lastConfirmedAt, firstSeenAt,
  };
}

/**
 * Structural helper reused by the service: is `role` a valid venture role.
 */
export function isVentureRole(role) {
  return VENTURE_ROLES.includes(role);
}

/**
 * Shared fact-object factory used by every collector (collectors/*.js) so
 * the exact founder_venture_facts row shape is built in exactly one place.
 * `verificationStatus` defaults to the source type's fixed default (see
 * SOURCE_TYPE_TO_DEFAULT_STATUS) — a collector may only raise it by an
 * explicit, separate confirm/dispute/supersede operation later, never by
 * passing a higher status here than its source type is trusted for.
 *
 * @param {object} params
 * @param {string} params.factId
 * @param {string} params.ventureId
 * @param {string} params.userId
 * @param {string} params.factKey
 * @param {unknown} params.value
 * @param {string} params.sourceType One of FACT_SOURCE_TYPES.
 * @param {string} params.sourceReference Non-empty; mandatory provenance.
 * @param {string|null} [params.sourceEventId]
 * @param {string} params.occurredAt ISO timestamp.
 * @param {string} params.recordedAt ISO timestamp.
 * @param {string|null} [params.verificationStatus] Overrides the source-type default; must still be one of INCOMING_VERIFICATION_STATES.
 * @param {number|null} [params.confidence]
 * @param {string|null} [params.supersedesFactId]
 * @param {object} [params.metadata]
 * @returns {object}
 */
export function buildFact({
  factId, ventureId, userId, factKey, value, sourceType, sourceReference, sourceEventId = null,
  occurredAt, recordedAt, verificationStatus = null, confidence = null, supersedesFactId = null, metadata = {},
}) {
  return {
    factId,
    ventureId,
    userId,
    factType: factTypeFor(factKey),
    factKey,
    value,
    sourceType,
    sourceReference,
    sourceEventId,
    verificationStatus: verificationStatus || defaultVerificationStatusFor(sourceType),
    confidence,
    occurredAt,
    recordedAt,
    supersedesFactId,
    active: true,
    metadata,
  };
}

export { FOUNDER_STAGES };
