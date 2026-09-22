/**
 * Founder Venture State V2 — the state maintenance service (task spec
 * section 5). The one public entry point combining persistence
 * (persistence-v2.js), the fact ledger (fact-ledger.js), portfolio
 * enforcement (contract.js's addVentureToPortfolio/validateVenturePortfolio,
 * reused unchanged from V1), and snapshot composition (snapshot.js).
 *
 * Every mutating operation is:
 *   - user-scoped: the caller's userId must match the venture's owner, or
 *     the operation fails closed with `not_found` — a non-owner cannot
 *     distinguish "wrong owner" from "venture doesn't exist".
 *   - version-checked: every mutation takes `expectedVersion`; a mismatch
 *     returns `{status: 'version_conflict', currentVersion}` and applies
 *     nothing (optimistic concurrency — never silently overwrites a
 *     concurrently-newer state).
 *   - auditable: every accepted mutation appends one
 *     founder_venture_state_events row.
 *   - deterministic: rebuildAndSnapshot() is a pure function of the
 *     persisted fact set, so identical inputs always produce identical
 *     output regardless of call order.
 */

import {
  addVentureToPortfolio, isNonEmptyString, validTimestamp, validateVenturePortfolio,
} from './contract.js';
import { rebuildStateFromFacts, validateVentureFacts } from './fact-ledger.js';
import { buildMaterialisedVentureState, buildFounderGoalEngineSnapshot, validateFounderGoalEngineSnapshot } from './snapshot.js';
import { buildManualUpdateFact } from './collectors/manual.js';

const LIFECYCLE_STATUSES = Object.freeze(['active', 'paused', 'archived']);
const USER_FACT_STATUS_BY_SOURCE = Object.freeze({
  analyst_chat: 'provisional',
  uploaded_file: 'provisional',
  website: 'provisional',
  onboarding: 'user_confirmed',
  user_manual_update: 'user_confirmed',
});
const INTEGRATION_FACT_STATUS_BY_SOURCE = Object.freeze({
  github: 'system_verified',
  supabase: 'system_verified',
  vercel: 'system_verified',
  website: 'provisional',
});

function factsMatchSourceAuthority(facts, statusBySource) {
  return Array.isArray(facts) && facts.every(
    (fact) => statusBySource[fact?.sourceType] === fact?.verificationStatus,
  );
}

// SECURITY: an unknown venture_id and a venture owned by someone else
// return the exact SAME 'not_found' result -- never distinguished, and
// never any information about the real owner. Mirrors the migration's
// founder_venture_owner_check repair (a prior revision there leaked the
// owner's UUID to any authenticated caller); this is the JS-side
// equivalent for the reference service implementation.
function notFound() {
  return Object.freeze({ status: 'not_found' });
}
function versionConflict(currentVersion) {
  return Object.freeze({ status: 'version_conflict', currentVersion });
}
function invalidInput(errors) {
  return Object.freeze({ status: 'invalid_input', errors });
}

/**
 * @param {import('./persistence-v2.js').FounderVentureFactsPersistenceAdapter} persistence
 */
export function createFounderVentureStateServiceV2(persistence) {
  async function loadOwnedVenture(userId, ventureId) {
    const venture = await persistence.getVenture(ventureId);
    if (!venture || venture.userId !== userId) return { error: notFound() };
    return { venture };
  }

  async function rebuildAndSnapshot(venture, evaluationTime) {
    const facts = await persistence.listFactsByVenture(venture.ventureId);
    const rebuilt = rebuildStateFromFacts(facts);
    const state = buildMaterialisedVentureState({
      ventureId: venture.ventureId,
      ventureRole: venture.ventureRole,
      userId: venture.userId,
      stateVersion: venture.stateVersion,
      ventureRow: venture,
      rebuilt,
      evaluationTime,
    });
    const snapshot = buildFounderGoalEngineSnapshot(state, evaluationTime);
    return { state, snapshot, rebuilt };
  }

  async function appendAuditEvent({
    ventureId, userId, eventType, sourceType, sourceReference, beforeVersion, afterVersion, changedFields, occurredAt,
  }) {
    await persistence.appendEvent({
      eventId: `${ventureId}:${eventType}:${afterVersion}`,
      ventureId,
      userId,
      eventType,
      sourceType,
      sourceReference,
      beforeVersion,
      afterVersion,
      changedFields,
      occurredAt,
      createdAt: occurredAt,
    });
  }

  /**
   * @param {{userId: string, ventureRole: 'primary'|'secondary', ventureName: string|null, ventureType: string|null, ventureDomain: string|null, businessModel: string|null, description: string|null, goalId: string|null, ventureId: string, evaluationTime: string, initialFacts?: object[]}} input
   */
  async function createVenture(input) {
    const {
      userId, ventureRole, ventureId, evaluationTime, initialFacts = [],
    } = input;
    if (!isNonEmptyString(userId) || !isNonEmptyString(ventureId) || !validTimestamp(evaluationTime)) {
      return invalidInput(['userId, ventureId, and evaluationTime are required']);
    }
    // LOCKED VISION RULE: pausing a venture must NOT release its role slot
    // -- only archiving does. A prior revision here filtered to
    // status === 'active', which incorrectly let a user create a second
    // primary the moment they paused the first (confirmed security/logic
    // flaw). Fixed: every non-archived venture (active OR paused) still
    // counts toward the portfolio cap, matching the fixed
    // founder_ventures_one_{primary,secondary}_per_user_uniq indexes.
    const existingPortfolio = (await persistence.listVenturesByUser(userId))
      .filter((row) => row.status !== 'archived')
      .map((row) => ({ ventureId: row.ventureId, ventureRole: row.ventureRole }));
    const portfolioCheck = addVentureToPortfolio(existingPortfolio, ventureId, ventureRole);
    if (!portfolioCheck.valid) return invalidInput(portfolioCheck.errors);

    if (initialFacts.length > 0) {
      const factsCheck = validateVentureFacts(initialFacts);
      if (!factsCheck.valid) return invalidInput(factsCheck.errors);
      if (initialFacts.some((fact) => fact.ventureId !== ventureId || fact.userId !== userId)) {
        return invalidInput(['every initial fact must belong to this exact ventureId/userId']);
      }
      if (!factsMatchSourceAuthority(initialFacts, USER_FACT_STATUS_BY_SOURCE)) {
        return invalidInput(['initial facts must use a user-originated source and its fixed verification status']);
      }
    }

    const row = {
      ventureId,
      userId,
      ventureRole,
      ventureName: input.ventureName ?? null,
      ventureType: input.ventureType ?? null,
      ventureDomain: input.ventureDomain ?? null,
      businessModel: input.businessModel ?? null,
      description: input.description ?? null,
      status: 'active',
      goalId: input.goalId ?? null,
      stateVersion: 1,
      createdAt: evaluationTime,
      updatedAt: evaluationTime,
    };
    await persistence.createVenture(row);
    for (const fact of initialFacts) await persistence.appendFact(fact);
    await appendAuditEvent({
      ventureId, userId, eventType: 'venture_created', sourceType: 'user_manual_update', sourceReference: `create:${ventureId}`,
      beforeVersion: 0, afterVersion: 1, changedFields: ['*'], occurredAt: evaluationTime,
    });

    const { state, snapshot } = await rebuildAndSnapshot(row, evaluationTime);
    return Object.freeze({ status: 'ready', ventureId, stateVersion: 1, state, snapshot });
  }

  async function readVentureState(userId, ventureId, evaluationTime) {
    const { venture, error } = await loadOwnedVenture(userId, ventureId);
    if (error) return error;
    const { state, snapshot } = await rebuildAndSnapshot(venture, evaluationTime);
    return Object.freeze({ status: 'ready', state, snapshot });
  }

  async function listVentures(userId) {
    const rows = await persistence.listVenturesByUser(userId);
    return rows.map((row) => ({
      ventureId: row.ventureId, ventureRole: row.ventureRole, status: row.status, stateVersion: row.stateVersion,
    }));
  }

  /**
   * Generic fact-append operation shared by addProvisionalFacts,
   * applyVerifiedProofFacts, and applyIntegrationFacts — every incoming
   * fact must genuinely belong to this exact venture/user (never a
   * cross-venture or cross-user fact slipped into a batch).
   */
  async function appendFacts({
    userId, ventureId, facts, expectedVersion, evaluationTime, eventType, sourceType, sourceReference,
  }) {
    const { venture, error } = await loadOwnedVenture(userId, ventureId);
    if (error) return error;
    if (venture.stateVersion !== expectedVersion) return versionConflict(venture.stateVersion);
    if (!Array.isArray(facts) || facts.length === 0) return invalidInput(['facts must be a non-empty array']);
    const factsCheck = validateVentureFacts(facts);
    if (!factsCheck.valid) return invalidInput(factsCheck.errors);
    if (facts.some((fact) => fact.ventureId !== ventureId || fact.userId !== userId)) {
      return invalidInput(['every fact must belong to this exact ventureId/userId']);
    }

    for (const fact of facts) await persistence.appendFact(fact);
    const nextVersion = venture.stateVersion + 1;
    await persistence.updateVenture(ventureId, { stateVersion: nextVersion, updatedAt: evaluationTime });
    await appendAuditEvent({
      ventureId,
      userId,
      eventType,
      sourceType,
      sourceReference,
      beforeVersion: venture.stateVersion,
      afterVersion: nextVersion,
      changedFields: [...new Set(facts.map((fact) => fact.factKey))],
      occurredAt: evaluationTime,
    });

    const { state, snapshot } = await rebuildAndSnapshot({ ...venture, stateVersion: nextVersion }, evaluationTime);
    return Object.freeze({ status: 'ready', stateVersion: nextVersion, state, snapshot });
  }

  async function addProvisionalFacts({
    userId, ventureId, facts, expectedVersion, evaluationTime, sourceReference,
  }) {
    if (!factsMatchSourceAuthority(facts, {
      analyst_chat: 'provisional', uploaded_file: 'provisional', website: 'provisional',
    })) {
      return invalidInput(['addProvisionalFacts accepts only provisional chat/file/website facts']);
    }
    return appendFacts({
      userId,
      ventureId,
      facts,
      expectedVersion,
      evaluationTime,
      eventType: 'facts_added',
      sourceType: facts[0]?.sourceType,
      sourceReference,
    });
  }

  async function applyVerifiedProofFacts({
    userId, ventureId, facts, expectedVersion, evaluationTime, sourceReference,
  }) {
    if (!Array.isArray(facts) || !facts.every(
      (fact) => fact?.sourceType === 'verified_proof' && fact?.verificationStatus === 'proof_verified',
    )) {
      return invalidInput(['applyVerifiedProofFacts accepts only proof_verified facts from verified_proof']);
    }
    return appendFacts({
      userId, ventureId, facts, expectedVersion, evaluationTime, eventType: 'verified_proof_applied', sourceType: 'verified_proof', sourceReference,
    });
  }

  async function applyIntegrationFacts({
    userId, ventureId, facts, expectedVersion, evaluationTime, sourceReference,
  }) {
    if (!factsMatchSourceAuthority(facts, INTEGRATION_FACT_STATUS_BY_SOURCE)) {
      return invalidInput(['integration facts must use a supported integration source and its fixed verification status']);
    }
    return appendFacts({
      userId, ventureId, facts, expectedVersion, evaluationTime, eventType: 'integration_facts_applied', sourceType: facts[0]?.sourceType, sourceReference,
    });
  }

  /**
   * A thin, explicit single-field manual update (update stage / completed
   * work / unfinished work / current priority) — always `user_manual_update`
   * / `user_confirmed`, via collectors/manual.js's buildManualUpdateFact.
   */
  async function updateManualField({
    userId, ventureId, factKey, value, expectedVersion, evaluationTime, reference,
  }) {
    const fact = buildManualUpdateFact({
      ventureId, userId, factKey, value, factId: `${reference}:${evaluationTime}`, occurredAt: evaluationTime, reference,
    });
    return appendFacts({
      userId, ventureId, facts: [fact], expectedVersion, evaluationTime, eventType: 'manual_field_updated', sourceType: 'user_manual_update', sourceReference: reference,
    });
  }

  async function confirmFact({
    userId, ventureId, factId, expectedVersion, evaluationTime,
  }) {
    const { venture, error } = await loadOwnedVenture(userId, ventureId);
    if (error) return error;
    if (venture.stateVersion !== expectedVersion) return versionConflict(venture.stateVersion);
    const facts = await persistence.listFactsByVenture(ventureId);
    const fact = facts.find((row) => row.factId === factId);
    if (!fact) return notFound();
    if (fact.verificationStatus !== 'provisional') {
      // Already at or above user_confirmed, or disputed/superseded —
      // confirming only ever RAISES a provisional fact; it never
      // downgrades, re-raises, or resurrects anything else.
      return Object.freeze({ status: 'no_change', reason: `fact is already ${fact.verificationStatus}, not provisional` });
    }
    await persistence.updateFactFlags(factId, { verificationStatus: 'user_confirmed' });
    const nextVersion = venture.stateVersion + 1;
    await persistence.updateVenture(ventureId, { stateVersion: nextVersion, updatedAt: evaluationTime });
    await appendAuditEvent({
      ventureId, userId, eventType: 'fact_confirmed', sourceType: 'user_manual_update', sourceReference: `confirm:${factId}`,
      beforeVersion: venture.stateVersion, afterVersion: nextVersion, changedFields: [fact.factKey], occurredAt: evaluationTime,
    });
    const { state, snapshot } = await rebuildAndSnapshot({ ...venture, stateVersion: nextVersion }, evaluationTime);
    return Object.freeze({ status: 'ready', stateVersion: nextVersion, state, snapshot });
  }

  async function disputeFact({
    userId, ventureId, factId, reason, expectedVersion, evaluationTime,
  }) {
    const { venture, error } = await loadOwnedVenture(userId, ventureId);
    if (error) return error;
    if (venture.stateVersion !== expectedVersion) return versionConflict(venture.stateVersion);
    if (!isNonEmptyString(reason)) return invalidInput(['reason is required to dispute a fact']);
    const facts = await persistence.listFactsByVenture(ventureId);
    const fact = facts.find((row) => row.factId === factId);
    if (!fact) return notFound();
    await persistence.updateFactFlags(factId, { verificationStatus: 'disputed' });
    const nextVersion = venture.stateVersion + 1;
    await persistence.updateVenture(ventureId, { stateVersion: nextVersion, updatedAt: evaluationTime });
    await appendAuditEvent({
      ventureId, userId, eventType: 'fact_disputed', sourceType: 'user_manual_update', sourceReference: `dispute:${factId}`,
      beforeVersion: venture.stateVersion, afterVersion: nextVersion, changedFields: [fact.factKey], occurredAt: evaluationTime,
    });
    const { state, snapshot } = await rebuildAndSnapshot({ ...venture, stateVersion: nextVersion }, evaluationTime);
    return Object.freeze({ status: 'ready', stateVersion: nextVersion, state, snapshot });
  }

  /**
   * Supersedes an existing fact with a genuinely new one — the old fact's
   * row and value are never deleted or mutated (only its `active` flag
   * flips to false), preserving full history exactly as the task requires.
   */
  async function supersedeFact({
    userId, ventureId, oldFactId, newFact, expectedVersion, evaluationTime,
  }) {
    const { venture, error } = await loadOwnedVenture(userId, ventureId);
    if (error) return error;
    if (venture.stateVersion !== expectedVersion) return versionConflict(venture.stateVersion);
    const facts = await persistence.listFactsByVenture(ventureId);
    const oldFact = facts.find((row) => row.factId === oldFactId);
    if (!oldFact) return notFound();
    if (['proof_verified', 'system_verified'].includes(oldFact.verificationStatus)) {
      return invalidInput(['verified facts must be disputed or replaced by trusted proof/system evidence']);
    }
    const factCheck = validateVentureFacts([newFact]);
    if (!factCheck.valid) return invalidInput(factCheck.errors);
    if (newFact.supersedesFactId !== oldFactId) return invalidInput(['newFact.supersedesFactId must reference oldFactId']);
    if (newFact.ventureId !== ventureId || newFact.userId !== userId) return invalidInput(['newFact must belong to this exact ventureId/userId']);
    if (newFact.factKey !== oldFact.factKey) return invalidInput(['a replacement fact must use the same factKey as the fact it supersedes']);
    if (!factsMatchSourceAuthority([newFact], USER_FACT_STATUS_BY_SOURCE)) {
      return invalidInput(['a user replacement fact cannot claim proof/system verification']);
    }

    await persistence.appendFact(newFact);
    await persistence.updateFactFlags(oldFactId, { active: false, verificationStatus: 'superseded' });
    const nextVersion = venture.stateVersion + 1;
    await persistence.updateVenture(ventureId, { stateVersion: nextVersion, updatedAt: evaluationTime });
    await appendAuditEvent({
      ventureId, userId, eventType: 'fact_superseded', sourceType: newFact.sourceType, sourceReference: `supersede:${oldFactId}->${newFact.factId}`,
      beforeVersion: venture.stateVersion, afterVersion: nextVersion, changedFields: [newFact.factKey], occurredAt: evaluationTime,
    });
    const { state, snapshot } = await rebuildAndSnapshot({ ...venture, stateVersion: nextVersion }, evaluationTime);
    return Object.freeze({ status: 'ready', stateVersion: nextVersion, state, snapshot });
  }

  async function transitionLifecycle({
    userId, ventureId, transition, expectedVersion, evaluationTime,
  }) {
    const { venture, error } = await loadOwnedVenture(userId, ventureId);
    if (error) return error;
    if (venture.stateVersion !== expectedVersion) return versionConflict(venture.stateVersion);
    const nextStatus = { pause: 'paused', resume: 'active', archive: 'archived' }[transition];
    if (!nextStatus) return invalidInput([`unsupported transition: ${transition}`]);
    if (!LIFECYCLE_STATUSES.includes(nextStatus)) return invalidInput(['unsupported resulting status']);

    // Resuming never changes role occupancy under the fixed portfolio rule
    // (a paused venture already counted) -- this can only fire against
    // corrupted/legacy data (two non-archived same-role ventures that
    // predate the fix). Fails closed rather than trusting that data is
    // always clean.
    if (transition === 'resume') {
      const conflict = (await persistence.listVenturesByUser(userId)).find(
        (row) => row.ventureId !== ventureId && row.ventureRole === venture.ventureRole && row.status !== 'archived',
      );
      if (conflict) {
        return invalidInput([`another non-archived ${venture.ventureRole} venture already exists; cannot resume`]);
      }
    }

    const nextVersion = venture.stateVersion + 1;
    await persistence.updateVenture(ventureId, { status: nextStatus, stateVersion: nextVersion, updatedAt: evaluationTime });
    await appendAuditEvent({
      ventureId, userId, eventType: `venture_${transition}d`, sourceType: 'user_manual_update', sourceReference: `${transition}:${ventureId}`,
      beforeVersion: venture.stateVersion, afterVersion: nextVersion, changedFields: ['status'], occurredAt: evaluationTime,
    });
    return Object.freeze({ status: 'ready', stateVersion: nextVersion, ventureStatus: nextStatus });
  }

  async function getGoalEngineSnapshot(userId, ventureId, evaluationTime) {
    const { venture, error } = await loadOwnedVenture(userId, ventureId);
    if (error) return error;
    const { state, snapshot } = await rebuildAndSnapshot(venture, evaluationTime);
    const check = validateFounderGoalEngineSnapshot(snapshot);
    if (!check.valid) return invalidInput(check.errors);
    return Object.freeze({ status: 'ready', snapshot });
  }

  return {
    createVenture,
    readVentureState,
    listVentures,
    addProvisionalFacts,
    confirmFact,
    disputeFact,
    supersedeFact,
    applyVerifiedProofFacts,
    applyIntegrationFacts,
    updateManualField,
    pauseVenture: (args) => transitionLifecycle({ ...args, transition: 'pause' }),
    resumeVenture: (args) => transitionLifecycle({ ...args, transition: 'resume' }),
    archiveVenture: (args) => transitionLifecycle({ ...args, transition: 'archive' }),
    getGoalEngineSnapshot,
  };
}

export { validateVenturePortfolio };
