/**
 * Right-Next-Move — the Active Outcome Thread continuity layer.
 *
 * founder-mission-comparison/todays-move.js answers "what is the single best
 * Today's Move right now" from a fresh snapshot -- but never persists and
 * never looks at what the founder was ALREADY working on. This module adds
 * exactly that missing comparison: given the founder's current Active
 * Outcome Thread (see founder-venture-state/sections.js's activeOutcomeThread
 * field) and a freshly computed TodaysMove, decide whether the active
 * pursuit continues unchanged, is refined, or is replaced -- and refuses to
 * replace anything unless a specific, attributable meaningful event backs
 * the change (spec: one weak/ambiguous signal must never silently swap the
 * founder's active task; a repeated/independent event may still change the
 * bottleneck, since that decision already happened one layer down in
 * founder-bottleneck/route-assessment.js's own evidence thresholds).
 *
 * Pure and read-only: never calls a database, never persists. The caller
 * writes the returned `nextThread` as the new activeOutcomeThread fact
 * (superseding the previous one) only when `decision` is not 'keep'.
 */

import {
  ACTIVE_OUTCOME_EXECUTION_STATES, ACTIVE_OUTCOME_COMPLETION_STATES,
} from '../founder-venture-state/sections.js';

export const RIGHT_NEXT_MOVE_VERSION = 1;
export const DECISIONS = Object.freeze(['start', 'keep', 'refine', 'replace']);
export const CHANGE_SCOPES = Object.freeze(['none', 'immediate_execution', 'strategy']);

export class RightNextMoveInputError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'RightNextMoveInputError';
    this.code = code;
  }
}

/* A tiny deterministic hash (FNV-1a, 32-bit). Deliberately NOT crypto and
   deliberately not random: the same creation inputs must always produce the
   same outcomeId, so a replayed request cannot mint a second identity for
   the same outcome. Runs identically under Node and Deno with no import. */
function stableHash(seed) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

/**
 * Mints a NEW outcome identity. Called only where the business result being
 * pursued genuinely changes: the venture's first outcome, or one that
 * supersedes a previous outcome.
 *
 * The statement is captured from the mission ONCE, here, and then frozen.
 * After creation the outcome never re-derives itself from task text -- that
 * coupling is precisely what made the "active outcome" evaporate whenever
 * the tactic underneath it changed.
 */
function createOutcomeIdentity({
  todaysMove, ventureId, evaluationTime, reason, supersedesOutcomeId,
}) {
  return {
    outcomeId: `outcome_${stableHash(`${ventureId}|${todaysMove.bottleneckId}|${evaluationTime}|${supersedesOutcomeId || ''}`)}`,
    outcomeStatement: todaysMove.expectedBusinessOutcome,
    outcomeCompletionCriteria: todaysMove.completionDefinition,
    outcomeCreatedAt: evaluationTime,
    outcomeReason: reason,
    bottleneckAtOutcomeCreation: todaysMove.bottleneckId,
    supersedesOutcomeId: supersedesOutcomeId ?? null,
  };
}

/* Carries an existing outcome identity forward untouched. A thread persisted
   before the outcome contract existed has no identity to carry; it keeps
   whatever it had and gains one the next time its outcome is genuinely
   created or superseded, rather than being retro-fitted with a fabricated
   creation time. */
function carryOutcomeIdentity(activeThread) {
  if (!activeThread || typeof activeThread.outcomeId !== 'string') return null;
  return {
    outcomeId: activeThread.outcomeId,
    outcomeStatement: activeThread.outcomeStatement,
    outcomeCompletionCriteria: activeThread.outcomeCompletionCriteria,
    outcomeCreatedAt: activeThread.outcomeCreatedAt,
    outcomeReason: activeThread.outcomeReason,
    bottleneckAtOutcomeCreation: activeThread.bottleneckAtOutcomeCreation,
    supersedesOutcomeId: activeThread.supersedesOutcomeId ?? null,
  };
}

function buildThread({
  todaysMove, meaningfulEvent, previousTaskVersion, outcomeCompletionState, executionState, outcomeIdentity,
}) {
  return {
    activeOutcome: todaysMove.expectedBusinessOutcome,
    currentBottleneckCategory: todaysMove.bottleneckId,
    currentRouteId: todaysMove.routeId,
    currentTaskTitle: todaysMove.title,
    taskVersion: previousTaskVersion + 1,
    executionState,
    latestEventSummary: meaningfulEvent?.summary ?? null,
    latestEventInterpretation: meaningfulEvent?.interpretation ?? null,
    reasonForLastChange: meaningfulEvent?.interpretation ?? 'initial Today\'s Move for this venture',
    relatedEntityIds: meaningfulEvent?.relatedEntityIds ?? [],
    completionCriteria: todaysMove.completionDefinition,
    outcomeCompletionState,
    ...(outcomeIdentity || {}),
  };
}

/**
 * @param {object} params
 * @param {object|null} params.activeThread A validated activeOutcomeThread section value, or null when this venture has none yet.
 * @param {object} params.todaysMove A validated TodaysMove with status 'selected' (see founder-mission-comparison/todays-move.js).
 * @param {{summary: string, interpretation: string, relatedEntityIds?: string[]}|null} params.meaningfulEvent
 *   A structured, already-interpreted real-world event reported THIS call (see opportunity-intelligence/founder-bridge.js's
 *   interpretFounderOutcomeReport), or null when this is a routine same-day/next-day recomputation with no new report.
 * @returns {{decision: 'start'|'keep'|'refine'|'replace', changeScope: 'none'|'immediate_execution'|'strategy', reason: string, nextThread: object}}
 */
export function decideRightNextMove({
  activeThread, todaysMove, meaningfulEvent = null, ventureId = null, evaluationTime = null,
}) {
  if (!todaysMove || todaysMove.status !== 'selected') {
    throw new RightNextMoveInputError('todays_move_not_selected', 'decideRightNextMove requires a TodaysMove with status "selected"; callers must handle clarification_required themselves before reaching this layer');
  }
  if (activeThread !== null && (typeof activeThread !== 'object' || !Number.isInteger(activeThread.taskVersion))) {
    throw new RightNextMoveInputError('invalid_active_thread', 'activeThread must be null or a valid activeOutcomeThread value');
  }

  /* Identity seed. Optional so existing callers keep working unchanged, but
     without it no outcome identity can be minted -- an outcome whose id
     depended on wall-clock or randomness could not survive a replay. */
  const canMintIdentity = typeof ventureId === 'string' && ventureId
    && typeof evaluationTime === 'string' && evaluationTime;

  if (!activeThread) {
    const reason = 'no active outcome thread exists yet for this venture';
    return {
      decision: 'start',
      changeScope: 'none',
      reason,
      nextThread: buildThread({
        todaysMove,
        meaningfulEvent,
        previousTaskVersion: 0,
        outcomeCompletionState: 'open',
        executionState: 'in_progress',
        outcomeIdentity: canMintIdentity
          ? createOutcomeIdentity({
            todaysMove, ventureId, evaluationTime, reason, supersedesOutcomeId: null,
          })
          : null,
      }),
    };
  }
  if (activeThread.outcomeCompletionState !== 'open') {
    throw new RightNextMoveInputError('outcome_already_closed', `activeThread.outcomeCompletionState is "${activeThread.outcomeCompletionState}"; a closed outcome thread must be deliberately reopened/replaced by the caller, never silently continued`);
  }

  const bottleneckChanged = activeThread.currentBottleneckCategory !== todaysMove.bottleneckId;
  const routeChanged = activeThread.currentRouteId !== todaysMove.routeId;
  const titleChanged = activeThread.currentTaskTitle !== todaysMove.title;

  if (!bottleneckChanged && !routeChanged && !titleChanged) {
    return {
      decision: 'keep',
      changeScope: 'none',
      reason: 'the highest-leverage route, bottleneck and mission content are unchanged; continuing the current Today\'s Move',
      nextThread: activeThread,
    };
  }

  if (!meaningfulEvent) {
    // A recomputation that would change the active move MUST be backed by
    // an attributable event -- never a silent swap from re-running the same
    // pipeline (spec: do not require midnight/a new day, but also never
    // drift the active task without a reason a human can read).
    return {
      decision: 'keep',
      changeScope: 'none',
      reason: `the newly computed route/mission differs from the active thread (${routeChanged ? `route ${activeThread.currentRouteId} -> ${todaysMove.routeId}` : `content changed under bottleneck ${activeThread.currentBottleneckCategory}`}), but no meaningful event was reported since the last computation -- the active move is not replaced without one`,
      nextThread: activeThread,
    };
  }

  const decision = (bottleneckChanged || routeChanged) ? 'replace' : 'refine';
  /* changeScope describes how far the REASONING moved, not what happened to
     the outcome. A bottleneck shift is a broader change than swapping one
     route for another, and saying so is useful -- but it carries no
     authority over outcome identity. See THE OUTCOME BOUNDARY below. */
  const changeScope = bottleneckChanged ? 'strategy' : 'immediate_execution';
  const reason = decision === 'replace'
    ? `${meaningfulEvent.interpretation} -- ${routeChanged ? `route changed from ${activeThread.currentRouteId} to ${todaysMove.routeId}` : `bottleneck changed from ${activeThread.currentBottleneckCategory} to ${todaysMove.bottleneckId}`}`
    : `${meaningfulEvent.interpretation} -- same route and bottleneck, mission content updated to address it`;

  /* THE OUTCOME BOUNDARY. This function NEVER changes outcome identity.
     It re-plans tactics; it does not decide what business result the
     venture is chasing.

     An earlier version of this treated a bottleneck change as a new
     business outcome. That was wrong, and wrong in a way that quietly
     destroyed the thing this whole layer exists to protect: "acquire the
     first 3 paying customers" stays exactly the same outcome while the
     bottleneck legitimately moves insufficient_customer_evidence ->
     sales_conversion, because the engine simply learned more about WHY the
     goal is not yet met. Superseding there would have thrown away the
     outcome, and its history, every time the diagnosis sharpened.

     The bottleneck is context and reasoning. It is recorded on the outcome
     at creation (bottleneckAtOutcomeCreation) for traceability and is
     reported live in currentBottleneckCategory -- neither is identity.

     An outcome therefore leaves 'open' by exactly one route: an explicit,
     attributable transition -- achieved, disproven, abandoned (see
     outcome-closure.js) or superseded (see supersedeActiveOutcome below).
     Never by inference, and never as a side effect of re-planning. */
  return {
    decision,
    changeScope,
    reason,
    nextThread: buildThread({
      todaysMove,
      meaningfulEvent,
      previousTaskVersion: activeThread.taskVersion,
      outcomeCompletionState: activeThread.outcomeCompletionState,
      executionState: 'in_progress',
      outcomeIdentity: carryOutcomeIdentity(activeThread),
    }),
  };
}

/**
 * Deliberately replaces the venture's Active Outcome with a different
 * business result, preserving the old one as history.
 *
 * This is the ONLY way one open outcome becomes another, and it is never
 * reached by inference: the caller must name an attributable event and a
 * reason, exactly as decideRightNextMove requires before it will move the
 * founder at all. "The bottleneck moved" is not on its own grounds to call
 * this -- the diagnosis sharpening is not the goal changing.
 *
 * Returns BOTH halves so the transition is auditable: the closed outcome
 * (outcomeCompletionState 'superseded') and the new thread that names it
 * through supersedesOutcomeId.
 *
 * @param {object} params
 * @param {object} params.activeThread The venture's current, open thread.
 * @param {object} params.todaysMove The selected TodaysMove for the NEW outcome.
 * @param {{summary: string, interpretation: string, relatedEntityIds?: string[]}} params.meaningfulEvent
 * @param {string} params.reason Attributable reason the previous outcome is being replaced.
 * @param {string} params.ventureId
 * @param {string} params.evaluationTime
 * @returns {{supersededOutcome: object, nextThread: object}}
 */
export function supersedeActiveOutcome({
  activeThread, todaysMove, meaningfulEvent, reason, ventureId, evaluationTime,
}) {
  if (!todaysMove || todaysMove.status !== 'selected') {
    throw new RightNextMoveInputError('todays_move_not_selected', 'superseding an outcome requires a TodaysMove with status "selected"');
  }
  if (!activeThread || activeThread.outcomeCompletionState !== 'open') {
    throw new RightNextMoveInputError('outcome_already_closed', 'only an open outcome can be superseded');
  }
  if (!meaningfulEvent || typeof meaningfulEvent.interpretation !== 'string' || !meaningfulEvent.interpretation.trim()) {
    throw new RightNextMoveInputError('event_required', 'superseding an outcome requires an attributable interpreted event -- an outcome is never replaced by inference');
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new RightNextMoveInputError('missing_close_reason', 'superseding an outcome requires an attributable reason');
  }
  if (typeof ventureId !== 'string' || !ventureId || typeof evaluationTime !== 'string' || !evaluationTime) {
    throw new RightNextMoveInputError('identity_seed_required', 'superseding an outcome requires ventureId and evaluationTime so the new outcomeId is deterministic');
  }

  const carried = carryOutcomeIdentity(activeThread);
  return {
    supersededOutcome: closeActiveOutcomeThread(activeThread, 'superseded', reason.trim()),
    nextThread: buildThread({
      todaysMove,
      meaningfulEvent,
      previousTaskVersion: activeThread.taskVersion,
      outcomeCompletionState: 'open',
      executionState: 'in_progress',
      outcomeIdentity: createOutcomeIdentity({
        todaysMove,
        ventureId,
        evaluationTime,
        reason: reason.trim(),
        supersedesOutcomeId: carried?.outcomeId ?? null,
      }),
    }),
  };
}

/**
 * Marks a completed STEP without closing the active outcome -- the outcome
 * (e.g. "win the first paying client") stays open until its own completion
 * criteria are met, disproven, or deliberately abandoned (spec: a task step
 * can complete while the active outcome remains open).
 *
 * @param {object} activeThread
 * @param {string} completedStepSummary Human-readable record of what was completed (e.g. "called the qualified café prospects").
 * @returns {object} A new thread version with executionState set to completed_step_outcome_open.
 */
export function recordCompletedStepOutcomeOpen(activeThread, completedStepSummary) {
  if (!activeThread || activeThread.outcomeCompletionState !== 'open') {
    throw new RightNextMoveInputError('outcome_already_closed', 'cannot record a completed step against a thread whose outcome is not open');
  }
  return {
    ...activeThread,
    taskVersion: activeThread.taskVersion + 1,
    executionState: 'completed_step_outcome_open',
    reasonForLastChange: `step completed: ${completedStepSummary}`,
  };
}

/**
 * Closes the active outcome thread -- the ONLY way outcomeCompletionState
 * ever leaves 'open' (spec: the active outcome closes only when its real
 * completion definition is met, disproven, or the user deliberately
 * changes/abandons it -- never merely because one step finished).
 *
 * @param {object} activeThread
 * @param {'achieved'|'disproven'|'abandoned'|'superseded'} finalState
 * @param {string} reason
 * @returns {object}
 */
const CLOSED_EXECUTION_STATE = Object.freeze({
  achieved: 'completed_outcome_closed',
  disproven: 'abandoned',
  abandoned: 'abandoned',
  superseded: 'superseded',
});

export function closeActiveOutcomeThread(activeThread, finalState, reason) {
  if (!ACTIVE_OUTCOME_COMPLETION_STATES.includes(finalState) || finalState === 'open') {
    throw new RightNextMoveInputError('invalid_final_state', `finalState must be one of achieved, disproven, abandoned, superseded (got "${finalState}")`);
  }
  if (!activeThread || activeThread.outcomeCompletionState !== 'open') {
    throw new RightNextMoveInputError('outcome_already_closed', 'this outcome thread is already closed');
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new RightNextMoveInputError('missing_close_reason', 'closing an outcome requires an attributable reason');
  }
  return {
    ...activeThread,
    taskVersion: activeThread.taskVersion + 1,
    executionState: CLOSED_EXECUTION_STATE[finalState],
    outcomeCompletionState: finalState,
    reasonForLastChange: reason,
  };
}

// Re-exported for callers that only need the enum, not the decision logic.
export { ACTIVE_OUTCOME_EXECUTION_STATES, ACTIVE_OUTCOME_COMPLETION_STATES };
