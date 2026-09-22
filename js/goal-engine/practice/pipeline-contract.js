/* ════════════════════════════════════════════════════════════════════════
   THE FIVE SEAMS A FINDING HAS TO SURVIVE.

   Every defect in this feature had the same shape, five times running: a
   producer and a consumer that never met. The behaviour label was dropped
   before reconciliation. The fault was gated on the rule engine's own
   vocabulary and never reached the rubric. The server built its response by
   hand and left the reconciled labels out. The browser rebuilt the timeline
   from stored rows the reconciler had already replaced. The timeline was
   gated on a label the review did not know.

   Not one of those failed loudly. Every suite stayed green through all five,
   because each test built its own inputs and therefore tested a call that
   could not exist. Three were caught by mutation testing and two only by a
   live run.

   SO THE SEAMS ARE DECLARED, NOT REMEMBERED. This file says what each hand-
   off must carry. It computes nothing and decides nothing -- it is the list
   the end-to-end regression walks, and the thing a new fault type has to be
   added to. A field dropped anywhere along the chain now fails a test with
   the seam's name on it instead of arriving as a blank space on a founder's
   screen.

   WHAT THIS IS NOT. It is not a runtime validator, and production does not
   call it. A check that runs in the request path would have to decide what
   to do when it fails, and the honest answer -- refuse to score -- is worse
   for the founder than a missing label. It runs in the tests, where the
   answer is simply "fix it before it ships".
   ══════════════════════════════════════════════════════════════════════ */

export const PIPELINE_CONTRACT_VERSION = 'practice_pipeline_contract_v1';

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k)
  && o[k] !== undefined;

/* Each seam names the two ends, the fields the hand-off must carry, and the
   defect that put it here. `of` extracts the rows the contract applies to,
   so a caller cannot accidentally check the wrong half of a payload. */
export const SEAMS = Object.freeze([
  Object.freeze({
    id: 'stored_rows_to_reconciler',
    from: 'practice_turns rows', to: 'the reconciled call',
    /* `founderAction` was absent here. The transcript alone cannot say
       whether a turn was a pitch, so the one CRITICAL fault could never fire
       on a real call while every offline suite passed. */
    requires: Object.freeze(['sequence', 'attemptNo', 'speaker', 'text', 'founderAction']),
    of: (payload) => (payload.assembled || []).filter((t) => t.speaker === 'founder'),
  }),
  Object.freeze({
    id: 'reconciler_to_rubric',
    from: 'the reconciled findings', to: 'the scored turns',
    /* The projection was gated on NEGATIVE_TYPES -- the RULE ENGINE's
       vocabulary -- so a fault the Reconciler derives itself was authoritative
       in the ledger and weighed nothing. */
    requires: Object.freeze(['sequence', 'speaker', 'founder_action', 'detected_events']),
    of: (payload) => (payload.scoringTurns || []).filter((t) => t.speaker === 'founder'),
  }),
  Object.freeze({
    id: 'pipeline_to_server_payload',
    from: 'runPracticePipeline', to: 'the practice_score response',
    /* The response was assembled by hand in index.ts. `scoredTurns` was left
       out, so every label reconciliation changed stopped at the server. */
    requires: Object.freeze(['overall', 'categories', 'scoredTurns', 'corrections',
      'biggestLeak', 'biggestWin', 'provenance']),
    of: (payload) => (payload.reviewPayload ? [payload.reviewPayload] : []),
  }),
  Object.freeze({
    id: 'server_payload_to_client_turns',
    from: 'the practice_score response', to: 'the browser\'s turn rows',
    /* The browser read practice_turns straight from the database, so it drew
       the behaviour engine's original labels over the reconciler's. */
    requires: Object.freeze(['sequence', 'founder_action', 'detected_events']),
    of: (payload) => (payload.clientTurns || []).filter((t) => t.speaker === 'founder'),
  }),
  Object.freeze({
    id: 'score_row_to_progress',
    from: 'practice_progress_read_v1', to: 'the progress screen',
    /* THE FOURTH ALLOWLIST TO DROP A FIELD A CONSUMER NEEDED. The progress
       RPC projects a deliberately small slice of the review, and `track` was
       not in it -- so every row would have defaulted to `buyer`, the
       non-buyer track would have been permanently empty, and nothing would
       have errored. The founder's improvement line would quietly have been
       partly a record of which role they drew. */
    requires: Object.freeze(['session_id', 'scored_at', 'track', 'result']),
    of: (payload) => payload.progressRows || [],
  }),
  Object.freeze({
    id: 'live_score_to_progress',
    from: 'live_progress_read_v1', to: 'the progress screen',
    /* THE THIRD DENOMINATOR. A real call is not a rehearsal with better
       audio: delivery is never scored on a phone line, pitch timing is only
       testable when the prospect said in words that they wanted the offer,
       and some turns could not be attributed at all. `coverage` travels with
       the score because a call scored over 71% of its turns and one scored
       over 98% are both above the floor and are not the same claim -- drop
       it and the screen cannot say so. */
    requires: Object.freeze(['session_id', 'scored_at', 'track', 'coverage', 'result']),
    of: (payload) => payload.liveProgressRows || [],
  }),
  Object.freeze({
    id: 'scenario_to_scoring',
    from: 'the hidden scenario', to: 'anything that scores',
    /* THE SEAM THAT RUNS THE OTHER WAY. Every seam above asks whether enough
       arrived. This one asks whether too much did.

       Controlled Uncertainty picks the role before the call starts, and the
       product is worthless the moment that reaches the founder -- directly,
       or through a finding that was decided by it. So what crosses here is
       `publicScenario()`: an object built from scratch that contains nothing,
       rather than the scenario with fields removed. A denylist leaks the
       first field somebody adds and forgets, which is exactly how `offer`
       and `gatekeeper` came to be invisible on the workspace screen -- the
       same mistake pointed the other way. */
    requires: Object.freeze(['hasScenario', 'version']),
    of: (payload) => (payload.publicScenario ? [payload.publicScenario] : []),
    /* Unlike every other seam, this one also FORBIDS. */
    forbids: Object.freeze(['role', 'variation', 'weights', 'shape']),
  }),
  Object.freeze({
    id: 'client_turns_to_review_model',
    from: 'the browser\'s turn rows', to: 'what the founder sees',
    /* The timeline is gated on EVENT_LABELS and on audio timing. A label the
       review did not know made the moment vanish entirely -- strictly worse
       than the fault not existing. */
    requires: Object.freeze(['sequence', 'action', 'label', 'isLeak', 'atMs']),
    of: (payload) => (payload.model && payload.model.moments) || [],
  }),
]);

export const SEAM_IDS = Object.freeze(SEAMS.map((s) => s.id));

/**
 * What is missing, and where. Returns one row per offending object rather
 * than a boolean, because "something is wrong somewhere in the pipeline" is
 * the report that made these defects take days to find.
 */
export function checkSeams(payload = {}) {
  const problems = [];
  SEAMS.forEach((seam) => {
    const rows = seam.of(payload) || [];
    /* A seam with nothing to check is itself a finding: every stage of a
       scored call has founder turns in it, so an empty list means the
       hand-off produced nothing at all. */
    if (!rows.length) {
      problems.push({ seam: seam.id, index: null, missing: ['<no rows at this seam>'] });
      return;
    }
    rows.forEach((row, index) => {
      const missing = seam.requires.filter((k) => !has(row, k));
      if (missing.length) problems.push({ seam: seam.id, index, missing });
      /* A LEAK IS A SEAM FAILURE TOO. Checked on the serialised row, not on
         its own keys: hidden state nested three levels down is still hidden
         state that reached the founder. */
      const leaked = (seam.forbids || []).filter((k) => new RegExp(`"${k}"`).test(JSON.stringify(row)));
      if (leaked.length) problems.push({ seam: seam.id, index, leaked });
    });
  });
  return problems;
}
