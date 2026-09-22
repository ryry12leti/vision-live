/**
 * Active Outcome closure — the deterministic gate between "the founder said
 * something" and "the outcome is closed".
 *
 * WHY THIS EXISTS. right-next-move.js has always exported
 * closeActiveOutcomeThread, and until now nothing in production ever called
 * it: outcomeCompletionState was written 'open' at creation and carried
 * forward untouched forever. An outcome that can be created but never
 * achieved, disproven or abandoned is not a lifecycle -- it is a label.
 *
 * The rule this module enforces is the Founder authority rule the rest of
 * the engine already follows: a client may REPORT, only server-owned state
 * may CLOSE. Concretely:
 *
 *   abandoned  -- the founder's own explicit decision is sufficient. Giving
 *                 up on a business objective needs no evidence; it is their
 *                 venture. It still needs an attributable reason.
 *   disproven  -- needs an attributable, already-interpreted meaningful
 *                 event (the same structured event type decideRightNextMove
 *                 requires before it will move the founder at all). A bare
 *                 client claim is not enough to record that a business
 *                 assumption was falsified.
 *   achieved   -- needs server-owned corroboration at a trusted level.
 *                 This is the one a client must never be able to assert on
 *                 its own: "I hit my outcome" awards the founder a completed
 *                 business result, and provisional or client-only evidence
 *                 can no more close an outcome than it can make a route
 *                 eligible (founder-venture-state/entity-snapshot.js applies
 *                 the identical trust ladder to entities).
 *   superseded -- never client-reportable at all. Only the engine supersedes
 *                 an outcome, and only when the bottleneck genuinely changed
 *                 (see right-next-move.js's outcome boundary).
 *
 * Pure and deterministic: no database, no clock, no model. Same inputs,
 * same decision, every time.
 */

/* Trust levels that count as server-owned corroboration. Deliberately the
   same ladder entity usability uses -- provisional and disputed are visible
   but never load-bearing. */
const CORROBORATING_TRUST_LEVELS = Object.freeze(['proof_verified', 'system_verified', 'user_confirmed']);

/* What a founder may ask for. 'superseded' is absent by design. */
export const OUTCOME_CLOSURE_REQUESTS = Object.freeze(['achieved', 'disproven', 'abandoned']);

export class OutcomeClosureError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'OutcomeClosureError';
    this.code = code;
  }
}

function refuse(reasonCode, explanation) {
  return { closed: false, finalState: null, reasonCode, explanation };
}

/**
 * Decides whether a requested closure may be committed.
 *
 * @param {object} params
 * @param {object|null} params.activeThread The venture's current activeOutcomeThread value.
 * @param {'achieved'|'disproven'|'abandoned'} params.requestedState What the founder reported.
 * @param {string} params.reason Attributable, human-readable reason for the closure.
 * @param {{summary: string, interpretation: string}|null} [params.meaningfulEvent]
 *   A structured, already-interpreted event (see opportunity-intelligence/founder-bridge.js's
 *   interpretFounderOutcomeReport). Required for 'disproven'.
 * @param {{trustLevel: string, summary: string}|null} [params.corroboration]
 *   Server-owned evidence that the outcome's completion criteria were met.
 *   Required for 'achieved'. `trustLevel` must come from the fact ledger,
 *   never from the request body.
 * @returns {{closed: boolean, finalState: string|null, reasonCode: string, explanation: string}}
 */
export function resolveOutcomeClosure({
  activeThread, requestedState, reason, meaningfulEvent = null, corroboration = null,
}) {
  if (!OUTCOME_CLOSURE_REQUESTS.includes(requestedState)) {
    throw new OutcomeClosureError('unsupported_closure_request', `requestedState must be one of ${OUTCOME_CLOSURE_REQUESTS.join(', ')} (got "${requestedState}"); 'superseded' is engine-only and can never be requested`);
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new OutcomeClosureError('missing_close_reason', 'closing an outcome requires an attributable reason');
  }
  if (!activeThread || typeof activeThread !== 'object') {
    return refuse('no_active_outcome', 'this venture has no active outcome to close');
  }
  if (activeThread.outcomeCompletionState !== 'open') {
    /* Idempotent rather than an error: a retried close request must not
       corrupt an already-closed outcome, and must not look like success
       for a DIFFERENT final state than the one on record. */
    return refuse(
      activeThread.outcomeCompletionState === requestedState ? 'already_closed_same_state' : 'already_closed_other_state',
      `this outcome is already "${activeThread.outcomeCompletionState}"`,
    );
  }

  if (requestedState === 'disproven') {
    if (!meaningfulEvent || typeof meaningfulEvent.interpretation !== 'string' || !meaningfulEvent.interpretation.trim()) {
      return refuse('event_required', 'recording an outcome as disproven requires an attributable interpreted event, not an unsupported claim');
    }
  }

  if (requestedState === 'achieved') {
    if (!corroboration || typeof corroboration.trustLevel !== 'string') {
      return refuse('corroboration_required', 'an outcome is only achieved when server-owned state confirms its completion criteria were met');
    }
    if (!CORROBORATING_TRUST_LEVELS.includes(corroboration.trustLevel)) {
      return refuse('corroboration_not_trusted', `evidence at trust level "${corroboration.trustLevel}" cannot close an outcome as achieved`);
    }
  }

  return {
    closed: true,
    finalState: requestedState,
    reasonCode: 'closure_authorised',
    explanation: reason.trim(),
  };
}
