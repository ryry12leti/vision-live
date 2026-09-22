/**
 * Founder Recovery — the ONE decision about whether execution has stalled.
 *
 * Shared by the live generate-tasks path and any shadow/QA path, so recovery
 * can never mean two different things in two places.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It counts nothing itself. The unresolved
 * run already exists, correctly, in summariseFounderAttempts().unresolvedRunOnRoute,
 * which alone knows that:
 *
 *   - silence is UNRESOLVED, not failure -- nobody said the founder failed;
 *   - one task rewritten several times is ONE attempt, not several;
 *   - a completed attempt ends the run;
 *   - changing route resets the run, because three unresolved interview tasks
 *     say nothing about outreach.
 *
 * A second counter here would eventually disagree with that one, and the
 * disagreement would show up as VISION intervening about work the founder
 * already finished.
 */

/* Three consecutive unresolved attempts on the SAME active route. Two is a bad
   week; three is a pattern worth interrupting for. Deliberately a named
   constant so the threshold is one decision in one place. */
export const RECOVERY_UNRESOLVED_THRESHOLD = 3;

export const RECOVERY_STATUSES = Object.freeze(['needs_confirmation', 'needs_assistance', 'resolved']);
export const RECOVERY_RESPONSES = Object.freeze(['still_matters', 'no_longer_matters']);

/**
 * Should VISION interrupt and ask whether this work still matters?
 *
 * @param {{unresolvedRunOnRoute?: number}} attemptSummary Output of summariseFounderAttempts.
 * @param {{routeId?: string|null, workItemId?: string|null}} [pending]
 * @returns {{recoveryRequired: boolean, unresolvedAttemptCount: number,
 *            routeId: string|null, workItemId: string|null, reason: string}}
 */
export function evaluateFounderRecovery(attemptSummary, pending = {}) {
  const run = Number(attemptSummary?.unresolvedRunOnRoute);
  const unresolvedAttemptCount = Number.isFinite(run) && run > 0 ? run : 0;
  const routeId = pending.routeId ?? null;
  const workItemId = pending.workItemId ?? null;
  const recoveryRequired = Boolean(routeId)
    && unresolvedAttemptCount >= RECOVERY_UNRESOLVED_THRESHOLD;

  return {
    recoveryRequired,
    unresolvedAttemptCount,
    routeId,
    workItemId,
    /* Describes the OBSERVATION, never a judgement about the person. The
       system knows the work stayed unresolved; it does not know why, and
       inferring avoidance or laziness from silence would be inventing
       evidence. */
    reason: recoveryRequired
      ? `the same work has stayed unresolved for ${unresolvedAttemptCount} consecutive attempts on this route`
      : 'execution is within normal range',
  };
}

/**
 * What kind of help may be prepared once the founder says the work still
 * matters.
 *
 * The split is about CONSEQUENCE, not difficulty. Preparation stays inside
 * VISION and is reversible; anything that reaches the outside world -- a
 * person, a payment, a publication, a deletion -- is the founder's to approve
 * and their reputation on the line, so 5E only ever describes it.
 */
export const RECOVERY_ASSISTANCE_ALLOWED = Object.freeze([
  'clarify_execution_steps',
  'break_down_scope',
  'prepare_draft_or_checklist',
  'diagnose_dependency',
  'organise_existing_information',
]);

export const RECOVERY_ASSISTANCE_APPROVAL_REQUIRED = Object.freeze([
  'contact_someone',
  'publish',
  'purchase_or_spend',
  'deploy',
  'delete',
  'submit',
  'make_external_commitment',
]);

/**
 * The assistance handoff. 5E builds the description; it performs none of it.
 *
 * @param {{frictionNote?: string|null}} [input]
 */
export function buildRecoveryAssistancePlan(input = {}) {
  const note = typeof input.frictionNote === 'string' ? input.frictionNote.trim() : '';
  return {
    allowed: [...RECOVERY_ASSISTANCE_ALLOWED],
    approvalRequired: [...RECOVERY_ASSISTANCE_APPROVAL_REQUIRED],
    /* If the founder did not tell us what was in the way, we do not guess.
       "unknown" is the honest value; a plausible-sounding inferred reason
       would be fiction the founder then has to argue with. */
    friction: note ? { source: 'founder_reported', note: note.slice(0, 400) } : { source: 'unknown', note: null },
    performsExternalActions: false,
  };
}
