/**
 * Connects the Founder Venture State V2 trusted snapshot
 * (snapshot.js's buildFounderGoalEngineSnapshot) to Goal Engine request
 * construction.
 *
 * This is a DELIBERATELY separate module from request-integration.js. V1's
 * ventureState and V2's snapshot are structurally incompatible shapes (see
 * contract.js's validatePreviousVentureState vs. snapshot.js's
 * validateFounderGoalEngineSnapshot) -- reusing V1's
 * `founderVentureState` requiredAttributes key for V2 data would silently
 * corrupt whichever consumer reads it expecting the other shape. V2 gets
 * its own versioned key, `founderVentureSnapshot`.
 *
 * Same generic extension point as V1 (request-builder.js's
 * buildGenerationRequest already passes `programme.requiredAttributes`
 * straight through unchanged), so request-builder.js needs zero changes
 * here either.
 *
 * This module is intentionally the ONLY place that decides whether a V2
 * snapshot is allowed to reach a Goal Engine request at all -- the lifecycle
 * and role checks below are the enforcement point for "paused/archived
 * ventures cannot own a mission" and "secondary can never be attached as
 * primary", not something callers are trusted to have already checked.
 */

import { FOUNDER_VENTURE_SNAPSHOT_VERSION, validateFounderGoalEngineSnapshot } from './snapshot.js';

export const FOUNDER_VENTURE_SNAPSHOT_REQUEST_FIELD = 'founderVentureSnapshot';

const KNOWN_LIFECYCLE_STATUSES = new Set(['active', 'paused', 'archived']);

/**
 * @typedef {object} AttachFounderVentureSnapshotResult
 * @property {boolean} valid
 * @property {object} [requiredAttributes] Present only when valid === true.
 * @property {string} [reason] A short machine-readable reason code, present only when valid === false.
 * @property {string[]} [errors] Structural validation errors, present only for malformed snapshots.
 * @property {string[]} [unresolvedQuestions] Present only when reason === 'insufficient_context' (never more than 3, taken directly from the snapshot).
 */

/**
 * Attempts to attach a trusted V2 Founder Venture snapshot to a programme's
 * `requiredAttributes`. Fails closed (never partially attaches) when:
 *   - the snapshot itself is structurally invalid or tampered
 *     (validateFounderGoalEngineSnapshot);
 *   - the snapshot is a secondary venture (secondary must never be attached
 *     as the primary Founder context -- primary/secondary isolation is
 *     enforced here, not left to the caller);
 *   - the venture's lifecycle status is not 'active' (a paused venture
 *     remains readable elsewhere but cannot own a mission; an archived
 *     venture cannot generate candidates at all);
 *   - the snapshot itself reports missing critical context (offer,
 *     targetCustomer, completedWork, unfinishedWork, currentGoal) -- rather
 *     than attach a context too thin to reason about, this returns the
 *     snapshot's own (already-capped-at-3) unresolvedQuestions so the
 *     caller can surface `clarification_required` instead of generating
 *     candidates from a near-empty venture.
 *
 * @param {object|null|undefined} baseRequiredAttributes
 * @param {object} snapshot buildFounderGoalEngineSnapshot(...)'s result.
 * @param {'active'|'paused'|'archived'} ventureLifecycleStatus The venture's founder_ventures.status (or get_founder_venture_context_for_owner_v1's venture_status).
 * @returns {AttachFounderVentureSnapshotResult}
 */
export function attachFounderVentureSnapshotToRequiredAttributes(baseRequiredAttributes, snapshot, ventureLifecycleStatus) {
  const structuralCheck = validateFounderGoalEngineSnapshot(snapshot);
  if (!structuralCheck.valid) {
    return { valid: false, reason: 'invalid_snapshot', errors: structuralCheck.errors };
  }
  // validateFounderGoalEngineSnapshot only checks that contractVersion is
  // PRESENT (a plain field-shape check); it never checks the VALUE, so a
  // tampered/future/unsupported version would otherwise pass through
  // silently. This is the pre-attach gate the contract requires ("validate
  // contract version"), enforced here rather than widening the shared
  // structural validator's behaviour for its other callers.
  if (snapshot.contractVersion !== FOUNDER_VENTURE_SNAPSHOT_VERSION) {
    return { valid: false, reason: 'invalid_snapshot', errors: [`snapshot.contractVersion must be ${FOUNDER_VENTURE_SNAPSHOT_VERSION}`] };
  }

  if (snapshot.ventureRole !== 'primary') {
    return { valid: false, reason: 'secondary_cannot_be_primary', errors: ['a secondary venture snapshot can never be attached as the primary Founder context'] };
  }

  if (!KNOWN_LIFECYCLE_STATUSES.has(ventureLifecycleStatus)) {
    return { valid: false, reason: 'invalid_lifecycle_status', errors: [`ventureLifecycleStatus must be one of ${[...KNOWN_LIFECYCLE_STATUSES].join(', ')}`] };
  }
  if (ventureLifecycleStatus === 'archived') {
    return { valid: false, reason: 'archived_venture_cannot_generate_candidates', errors: [] };
  }
  if (ventureLifecycleStatus === 'paused') {
    return { valid: false, reason: 'paused_venture_cannot_own_a_mission', errors: [] };
  }

  if (snapshot.missingCriticalContext.length > 0) {
    return {
      valid: false,
      reason: 'insufficient_context',
      errors: [],
      unresolvedQuestions: snapshot.unresolvedQuestions,
    };
  }

  return {
    valid: true,
    requiredAttributes: {
      ...(baseRequiredAttributes || {}),
      [FOUNDER_VENTURE_SNAPSHOT_REQUEST_FIELD]: snapshot,
    },
  };
}

/**
 * Reads the V2 Founder Venture snapshot back out of an already-built
 * generation request (`request.programme.requiredAttributes.
 * founderVentureSnapshot`). Returns null when absent -- the correct,
 * backward-compatible state for every non-Founder domain, every V1-only
 * Founder request, and any request built before this field existed.
 *
 * @param {object} request The built generation request (or a trustedContext).
 * @returns {object|null}
 */
export function readFounderVentureSnapshotFromRequest(request) {
  return request?.programme?.requiredAttributes?.[FOUNDER_VENTURE_SNAPSHOT_REQUEST_FIELD] ?? null;
}
