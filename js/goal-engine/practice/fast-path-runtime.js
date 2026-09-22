/* ════════════════════════════════════════════════════════════════════════
   FAST PATH RUNTIME — wiring the prepared pieces into the live turn

   truth-cache.js, authorised-move.js and streamProspectModel() were built
   and proven in isolation (Fast Path Prep V1) but never connected to the
   prospect model call the live handler actually makes. This module is that
   connection point, kept pure and out of index.ts so the decision of WHICH
   path a turn takes -- and the guarantee that a streamed result can never
   be judged by different rules than a buffered one -- can be proven offline
   rather than trusted.

   THE INVARIANT THIS FILE EXISTS TO HOLD: a clause a founder hears must have
   passed the SAME validator regardless of which provider call produced it.
   Streaming does not relax what may be said; it only changes when the
   authority to say it was decided -- before generation, per the frozen
   authorised-move contract, rather than after.
   ══════════════════════════════════════════════════════════════════════ */

import { clauseAdmissible } from './authorised-move.js';

export const FAST_PATH_RUNTIME_VERSION = 'practice_fast_path_runtime_v1';

/**
 * The withheld facts, as {id, text} objects, for clauseAdmissible() to check
 * a candidate clause against. `disclosure.withheld` is ids only; the ledger
 * carries the text. A missing ledger or disclosure yields no withheld facts
 * -- refusing to guess never widens what a clause may say, it only removes
 * the ability to CATCH a leak, and the caller decides whether that is safe
 * to proceed on (see shouldAttemptStream: no authorisedMove, no attempt).
 */
export function withheldFactsFor(ledger, disclosure) {
  const ids = new Set(
    (disclosure && Array.isArray(disclosure.withheld)) ? disclosure.withheld : []);
  if (!ids.size) return [];
  const facts = (ledger && Array.isArray(ledger.facts)) ? ledger.facts : [];
  return facts
    .filter((f) => f && ids.has(f.id))
    .map((f) => ({ id: f.id, text: f.text }));
}

/**
 * The per-clause gate streamProspectModel() calls as each candidate clause
 * closes. Bound once per turn to the frozen authorisedMove and the withheld
 * facts computed above -- never re-derived mid-stream, so the authority a
 * clause is checked against cannot drift while the response is still being
 * generated. Returns null (never a gate that always passes) when there is
 * no authorised move to check against.
 */
export function buildClauseGate(authorisedMove, withheldFacts) {
  if (!authorisedMove) return null;
  return (clause) => clauseAdmissible(clause, authorisedMove, withheldFacts).admissible === true;
}

/**
 * Whether the streaming path may even be attempted this turn. ALL FOUR must
 * hold -- this is deliberately a conjunction, not a priority order, so
 * flipping any single input back off is sufficient to restore the buffered
 * path with no other change. `authorisedMove` absent means STEP 2 never
 * built a decision to check a streamed clause against, and streaming
 * without one would be exactly the inverted authority this exists to avoid.
 */
export function shouldAttemptStream({
  modelEnabled = false, streamContractEnabled = false, modelStreamEnabled = false,
  authorisedMove = null,
} = {}) {
  return modelEnabled === true && streamContractEnabled === true
    && modelStreamEnabled === true && !!authorisedMove;
}

/**
 * Turns a provider result (the SAME {ok, parsed, usage, ms, reason} shape
 * both callProspectModel() and streamProspectModel() return) into the
 * dialogue/source/modelReason/simulated the caller persists. Called
 * identically for a streamed result, a buffered fallback after a streaming
 * failure, and a plain buffered call -- so which path produced `called` can
 * never change what is accepted. This is the ONE place validation happens;
 * a streamed clause that reached the founder's ear via the gate is still
 * re-checked here against the complete, closed response before anything is
 * treated as final.
 *
 * @param {object}   input.called        provider result
 * @param {Function} input.validate      validateProspectReply, injected so
 *                                        this stays a pure function of its
 *                                        arguments and needs no import wiring
 *                                        beyond what index.ts already has
 * @param {Function} input.seal          sealSimulatedFacts, same reason
 * @param {object}   input.deterministic the pre-computed floor reply, used
 *                                        verbatim on any failure or rejection
 */
export function resolveModelOutcome({
  called = null, validate, seal, turn, context, capabilities, disclosure, deterministic,
} = {}) {
  if (!called || called.ok !== true) {
    return {
      dialogue: deterministic, source: 'deterministic_fallback',
      modelReason: (called && called.reason) || 'model_failed',
      simulated: [], validateMs: null, valid: false,
    };
  }
  const t0 = Date.now();
  const checked = validate(called.parsed, { turn, context, capabilities, disclosure });
  const validateMs = Date.now() - t0;
  if (checked.valid) {
    return {
      dialogue: { reply: checked.reply, tone: checked.tone },
      source: 'model', modelReason: null,
      simulated: seal(called.parsed), validateMs, valid: true,
    };
  }
  return {
    dialogue: deterministic, source: 'deterministic_fallback',
    modelReason: `rejected:${checked.problems.map((x) => x.code).join(',')}`,
    simulated: [], validateMs, valid: false,
  };
}

/**
 * The observable timing envelope for a turn's model resolution. Additive
 * only -- every field is null when its subsystem never ran, so a response
 * built with every flag off carries the same shape as before plus inert
 * nulls, never a changed existing field.
 */
export function timingEnvelope({
  truthCacheObs = null, streamAttempted = false, streamTiming = null,
  streamFellBackTo = null,
} = {}) {
  const t = streamTiming || {};
  return {
    truthCacheHit: truthCacheObs ? !!truthCacheObs.truth_cache_hit : null,
    truthPrepMs: truthCacheObs ? (truthCacheObs.truth_cache_build_ms ?? null) : null,
    streamAttempted: !!streamAttempted,
    streamFellBackTo: streamFellBackTo || null,
    modelRequestAt: streamAttempted ? (t.model_request_at ?? null) : null,
    modelFirstEventAt: streamAttempted ? (t.model_first_event_at ?? null) : null,
    modelFirstContentAt: streamAttempted ? (t.model_first_content_at ?? null) : null,
    firstSafeClauseAt: streamAttempted ? (t.first_safe_clause_at ?? null) : null,
    modelCompleteAt: streamAttempted ? (t.model_complete_at ?? null) : null,
  };
}

/**
 * The full per-turn model resolution. The provider calls are INJECTED
 * (`streamCall`/`bufferedCall`) rather than imported, so this function is a
 * pure orchestration of its inputs and can be driven with fakes in tests --
 * the real caller supplies closures over streamProspectModel()/
 * callProspectModel(). Everything about WHEN each is called and how a
 * failure is handled lives here, once, rather than duplicated at the call
 * site or left untestable inside index.ts.
 *
 * GUARANTEES, each covered by its own mutation-tested gate:
 *  - `bufferedCall` runs AT MOST ONCE per turn, `streamCall` AT MOST ONCE.
 *  - `resolveModelOutcome` runs EXACTLY ONCE on whichever result is final,
 *    so exactly one dialogue/source/modelReason/simulated set is ever
 *    produced -- there is no path that can persist two.
 *  - A provider call that throws is caught and treated as a failed result,
 *    never left to propagate past this function and never silently dropped.
 */
export async function runProspectModelTurn({
  attemptStream = false, streamCall = null, bufferedCall,
  validate, seal, turn, context, capabilities, disclosure, deterministic,
} = {}) {
  let streamFellBackTo = null;
  let streamTiming = null;
  let called;
  const runBuffered = async () => {
    try { return await bufferedCall(); }
    catch (_e) { return { ok: false, reason: 'buffered_threw', ms: 0, usage: null }; }
  };
  if (attemptStream && typeof streamCall === 'function') {
    let streamed;
    try { streamed = await streamCall(); }
    catch (_e) { streamed = { ok: false, reason: 'stream_threw', ms: 0, usage: null, timing: null }; }
    streamTiming = streamed.timing || null;
    if (streamed.ok === true) {
      called = streamed;
    } else {
      /* FAIL SAFE TO THE EXISTING BUFFERED PATH. Named, not swallowed --
         streamFellBackTo distinguishes "never attempted" from "attempted
         and recovered" for anyone reading the response later. */
      streamFellBackTo = streamed.reason || 'stream_failed';
      called = await runBuffered();
    }
  } else {
    called = await runBuffered();
  }
  const outcome = resolveModelOutcome({
    called, validate, seal, turn, context, capabilities, disclosure, deterministic,
  });
  return {
    ...outcome, called,
    usage: (called && called.usage) || null,
    latency: (called && typeof called.ms === 'number') ? called.ms : null,
    streamAttempted: !!(attemptStream && typeof streamCall === 'function'),
    streamFellBackTo, streamTiming,
  };
}
