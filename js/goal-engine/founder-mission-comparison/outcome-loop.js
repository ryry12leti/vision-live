/**
 * Outcome Loop — what the request handler does once an outcome is resolved.
 *
 * Closing an outcome mid-request invalidates the run that is already in
 * flight: the venture's state_version has moved, the thread the run loaded is
 * now history, and generating from it would either continue a finished
 * outcome or throw. The run must therefore stop and the client must ask
 * again against fresh state.
 *
 * That handoff is a normal, expected outcome of a successful request, so it
 * is modelled as a RETURNED decision rather than a thrown error. Throwing
 * would put a routine success on the same path as a crash -- the run would
 * be failed with an error code that misdescribes what happened, and the
 * closure (already committed, deliberately) would look like part of a
 * failure.
 *
 * Kept here rather than inline in the edge function so the loop's semantics
 * are testable without a deployment, and so the protected request handler
 * holds no policy of its own -- it calls this and does what it says.
 */

/* Reused deliberately: `manual_refresh` is already in both the client and
   server reason allowlists and is already classified as a regeneration, so
   the automatic re-request needs no new vocabulary on either side. */
export const OUTCOME_REGENERATE_REASON = 'manual_refresh';

export const OUTCOME_REGENERATE_ERROR = 'outcome_resolved_regenerate_required';

/**
 * Turns the result of applyFounderOutcomeResolution into the response the
 * handler should return.
 *
 * @param {{ok: boolean, finalState?: string, outcomeId?: string, evidenceCount?: number, stateVersion?: number, reason?: string, detail?: string}} resolution
 * @returns {{committed: boolean, releaseRun: boolean, runFailureCode: string|null, httpStatus: number, body: object, diagnostic: object}}
 */
export function planOutcomeLoopResponse(resolution) {
  if (resolution && resolution.ok === true) {
    return {
      committed: true,
      /* Stop the in-flight run. It loaded pre-closure state and can no longer
         produce a valid decision. The run is closed out through the same
         mechanism every other early return uses, so it never lingers and
         blocks the very re-request we are about to ask for. */
      releaseRun: true,
      runFailureCode: 'outcome_resolved',
      httpStatus: 409,
      body: {
        ok: false,
        error: OUTCOME_REGENERATE_ERROR,
        /* The machine-readable flag the client keys off. Explicit rather than
           inferred from the error string. */
        regenerate_required: true,
        regenerate_reason: OUTCOME_REGENERATE_REASON,
        /* The closure is COMMITTED and stays committed regardless of what
           happens next. Reporting it here means a client whose follow-up
           request fails still knows the outcome closed, and can say so
           instead of implying the resolution was lost. */
        outcome_resolution: {
          committed: true,
          state: resolution.finalState,
          outcome_id: resolution.outcomeId,
          evidence_count: resolution.evidenceCount,
          state_version: resolution.stateVersion,
        },
        retry_after_ms: 0,
      },
      diagnostic: { reason: 'outcome_resolved' },
    };
  }

  /* Refused. Nothing was written, so the run is untouched and generation
     continues normally -- failing to close an outcome must never cost the
     founder their daily task. */
  return {
    committed: false,
    releaseRun: false,
    runFailureCode: null,
    httpStatus: 0,
    body: null,
    diagnostic: { outcome_resolution_refused: (resolution && resolution.reason) || 'unknown' },
  };
}
