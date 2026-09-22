/* ════════════════════════════════════════════════════════════════════════
   REWIND AND RESUME — the same person, continuing the same call.

   A founder who is about to retry a turn must not be handed a different
   prospect. Everything said before the retry point stays exactly as it was
   said, because it is READ from the stored turns rather than regenerated:
   the pinned prefix is the transcript, not a re-run of it.

   Two projections of the same turns already exist and must not be confused.
   The REVIEW projection folds every attempt, superseded ones included,
   because the judge has to see the fault the retry was coached on. The
   ACTIVE projection -- this one -- folds only the surviving attempt at each
   sequence, because that is the conversation the prospect is actually in.
   `buildCallState` does the folding in both cases, so there is exactly one
   interpretation of what a turn means.

   ONE THING CROSSES THE REWIND ON PURPOSE. If the discarded branch reached
   a hard no or a do-not-contact, that survives. Rewinding a founder's bad
   turn is a training affordance; it is not a licence to un-hear someone
   asking not to be sold to. Everything else the branch learned is dropped.
   ══════════════════════════════════════════════════════════════════════ */
import { buildCallState, REFUSAL, REFUSAL_RANK } from './call-state.js';

const att = (t) => {
  if (t == null) return 1;
  if (typeof t.attemptNo === 'number') return t.attemptNo;
  if (typeof t.attempt_no === 'number') return t.attempt_no;
  return 1;
};
const clone = (v) => (typeof structuredClone === 'function'
  ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/* A tiny stable digest, so "replaying this checkpoint is deterministic" is
   a claim a test can make cheaply rather than by deep-comparing. */
function digest(value) {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* THE ACTIVE CONVERSATION: the surviving attempt at every sequence. A
   prospect line belongs to the founder attempt it answered, so it carries
   the same attempt number and is dropped with it. */
export function activeTurns(turns = []) {
  const latest = new Map();
  turns.forEach((t) => {
    const cur = latest.get(t.sequence);
    if (cur == null || att(t) > cur) latest.set(t.sequence, att(t));
  });
  return turns.filter((t) => att(t) === latest.get(t.sequence));
}

export function nextAttemptAt(turns = [], sequence) {
  let top = 0;
  turns.forEach((t) => { if (t.sequence === sequence && att(t) > top) top = att(t); });
  return top + 1;
}

/* THERE ARE TWO STATE MACHINES, and a resume needs both.

   `call-state.js` tracks what the CALL has established -- refusal,
   qualification, permissions, facts. The prospect simulator keeps its own
   separate state: resistance, trust, exit intent, how often the founder has
   overreached. Restoring only the first hands the retry to a prospect whose
   patience is still spent by a turn that no longer happened.

   The simulator already returns its state on every turn and already accepts
   one back, so rewinding it is a matter of keeping the snapshots rather than
   changing how it behaves. `behaviourStates` maps a sequence to the
   simulator state as it stood BEFORE that turn. */

/* Freeze a checkpoint immediately BEFORE `sequence`. */
export function checkpointAt({ turns = [], sequence, handoff = {}, behaviourStates = null } = {}) {
  if (typeof sequence !== 'number') throw new Error('rewind_requires_a_sequence');
  const active = activeTurns(turns);
  const pinned = active.filter((t) => t.sequence < sequence);
  const discarded = active.filter((t) => t.sequence >= sequence);

  const state = buildCallState(pinned, handoff);

  /* What the discarded branch reached. Folded with the SAME function, so a
     refusal means here exactly what it means everywhere else. */
  const branch = buildCallState(active, handoff);
  const carried = REFUSAL_RANK[branch.refusal.state] > REFUSAL_RANK[state.refusal.state]
    && REFUSAL_RANK[branch.refusal.state] >= REFUSAL_RANK[REFUSAL.HARD]
    ? clone(branch.refusal) : null;
  if (carried) state.refusal = carried;

  /* The simulator state as it stood before the retried turn, if the caller
     kept it. Null is honest -- it means "not captured", never "start over",
     because a fresh simulator is a different person. */
  const behaviour = behaviourStates
    ? (behaviourStates instanceof Map
      ? behaviourStates.get(sequence) : behaviourStates[sequence]) : undefined;

  return Object.freeze({
    sequence,
    pinned: Object.freeze(clone(pinned)),
    behaviour: behaviour === undefined ? null : Object.freeze(clone(behaviour)),
    behaviourCaptured: behaviour !== undefined,
    discarded: Object.freeze(clone(discarded)),
    state: Object.freeze(state),
    safetyCarried: carried ? Object.freeze({ ...carried, reason: 'refusal_is_monotonic' }) : null,
    handoff: Object.freeze(clone(handoff)),
    hash: digest({ pinned, state }),
  });
}

/* Resume from a checkpoint with a new founder turn, and optionally the
   prospect line it produced. The checkpoint is never mutated, so two
   branches taken from one checkpoint cannot reach each other. */
export function resumeFrom(checkpoint, { founderTurn, prospectTurn } = {}) {
  if (!checkpoint || !Array.isArray(checkpoint.pinned)) throw new Error('resume_requires_a_checkpoint');
  if (!founderTurn || typeof founderTurn.text !== 'string') throw new Error('resume_requires_a_founder_turn');

  const pinned = clone(checkpoint.pinned);
  const attemptNo = nextAttemptAt(
    checkpoint.pinned.concat(checkpoint.discarded || []), checkpoint.sequence);

  const retry = { ...clone(founderTurn), speaker: 'founder',
    sequence: checkpoint.sequence, attemptNo, complete: true };
  const turns = pinned.concat([retry]);
  if (prospectTurn && typeof prospectTurn.text === 'string') {
    turns.push({ ...clone(prospectTurn), speaker: 'prospect',
      sequence: checkpoint.sequence + 1, attemptNo });
  }
  /* Re-fold from the pinned prefix so the retry is interpreted against the
     checkpoint state, and carry the monotonic refusal across. */
  const state = buildCallState(turns, checkpoint.handoff);
  if (checkpoint.safetyCarried
    && REFUSAL_RANK[checkpoint.safetyCarried.state] > REFUSAL_RANK[state.refusal.state]) {
    state.refusal = clone(checkpoint.safetyCarried);
  }
  return { turns, state, attemptNo, hash: digest({ pinned: turns, state }) };
}
