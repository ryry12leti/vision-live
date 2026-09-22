/* ════════════════════════════════════════════════════════════════════════
   THE UNIVERSAL ACTION CONTRACT

   Three intents, and the separation between them is the safety model:

     inform   answer only. Nothing is recorded as an action at all.
     propose  a recommendation is recorded. NOTHING ELSE IS WRITTEN.
     apply    an allowlisted handler runs, after the server re-checks who is
              asking and which venture and workspace they are in.

   MODE LOGIC CANNOT WRITE TO VISION TABLES. A mode returns an action
   DESCRIPTION; the runtime hands it to the action RPC, which decides whether
   it may run. There is deliberately no path from a mode handler to a table.

   MODEL TEXT IS NOT AUTHORITY. An action whose origin is 'model' and which no
   founder confirmed is refused at apply — and the refusal is RECORDED, so an
   attempt is visible rather than silently dropped.

   ONE HARMLESS ACTION IS IMPLEMENTED. `noop_echo` writes nothing outside the
   action row itself. Real mutations are a later step on purpose: the contract
   and its refusals are what needed proving first.
   ══════════════════════════════════════════════════════════════════════ */

export const LI_INTENTS = Object.freeze(['inform', 'propose', 'apply']);

/* Every action VISION recognises. `applyHandler: null` means it may be
   proposed and never applied — the honest state for anything whose handler
   has not been written. */
export const LI_ACTION_REGISTRY = Object.freeze({
  /* THE FIRST REAL ACTION. When the founder asserts something VISION recorded
     as UNKNOWN, the practice partner pushes back — and that push-back is worth
     keeping, because it is the mistake most likely to be repeated on the real
     call.

     PROPOSED, NEVER AUTO-APPLIED. VISION noticing something is not the founder
     agreeing it matters, and a practice partner that silently wrote notes
     about the founder's mistakes would be keeping a file on them.

     Its origin is 'system', not 'model': the detection is the deterministic
     comparison in practiceTurnReply against the recorded unknowns, not
     anything a model said. That distinction is what makes it appliable at all.

     Session scope only — see the apply handler. A practice slip is a fact
     about one rehearsal, not about the venture. */
  remember_practice_note: Object.freeze({
    actionType: 'remember_practice_note',
    target: 'live_intelligence_memory_items',
    applyHandler: 'remember_practice_note',
    requiresConfirmation: true,
    describes: 'Keep a note from this rehearsal in the session, so the same slip is visible next time.',
  }),

  noop_echo: Object.freeze({
    actionType: 'noop_echo',
    target: 'live_intelligence_actions',
    applyHandler: 'noop_echo',
    requiresConfirmation: false,
    describes: 'A harmless fixture action that records itself and changes nothing else.',
  }),
});

export const LI_ACTION_TYPES = Object.freeze(Object.keys(LI_ACTION_REGISTRY));
export const LI_APPLIABLE_ACTION_TYPES = Object.freeze(
  LI_ACTION_TYPES.filter((t) => !!LI_ACTION_REGISTRY[t].applyHandler));

export const LI_ACTION_BOUNDS = Object.freeze({
  reason: 1000, payloadChars: 4000, target: 120, idempotencyKey: 200,
});

/* ── PROPOSALS A PRACTICE TURN MAY RAISE ─────────────────────────────────
   Pure, and deliberately narrow: exactly one condition produces exactly one
   proposal. A mode that can propose anything it likes is a mode that will
   eventually propose something nobody reviewed. Returns null far more often
   than it returns an action, which is the correct ratio. */
export function proposalsForPracticeTurn({
  basis, unknownAsserted = null, turnKey = null, existingNotes = [],
} = {}) {
  if (basis !== 'unknown_asserted' || !unknownAsserted || !turnKey) return null;

  /* ALREADY NOTED? THEN DO NOT ASK AGAIN. The key is per-TURN, so without
     this a founder who slips on the same unknown three times is offered the
     same note three times — and a system that keeps asking for a decision the
     founder already made reads as not listening. The repeat is still worth
     surfacing; it is just not a new proposal. */
  const note = practiceNoteFor(unknownAsserted);
  const already = (existingNotes || []).some((n) => normaliseNote(n) === normaliseNote(note));
  if (already) return { alreadyNoted: true, note };

  return {
    intent: 'propose',
    actionType: 'remember_practice_note',
    target: 'live_intelligence_memory_items',
    payload: { note, scope: 'session' },
    reason: 'You stated this as fact during the rehearsal, and VISION has not established it.',
    /* Keyed to the TURN, so a retry of the same turn cannot raise a second
       proposal about the same slip. */
    idempotencyKey: `practice_note:${turnKey}`,
    origin: 'system',
  };
}

/* One place builds the note text. Two would drift, and the dedup above
   compares note to note. */
export function practiceNoteFor(unknown) {
  return `Asserted without evidence: ${String(unknown || '').slice(0, 240)}`;
}
const normaliseNote = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function resolveAction(actionType) {
  return LI_ACTION_REGISTRY[actionType] || null;
}

/**
 * Validate an action before it is sent anywhere. Pure — this decides shape
 * and permission-in-principle; the RPC decides ownership in fact.
 */
export function validateLiAction({
  intent, actionType, target = null, payload = {}, reason = null,
  idempotencyKey = null, origin = 'system', confirmed = false,
} = {}) {
  const refuse = (r, d) => ({ ok: false, reason: r, detail: d });

  if (!LI_INTENTS.includes(intent)) return refuse('intent_invalid', `"${intent}" is not an action intent.`);
  if (!actionType || typeof actionType !== 'string') return refuse('action_type_required', 'No action type was given.');

  const descriptor = resolveAction(actionType);
  if (!descriptor) return refuse('action_type_unknown', `"${actionType}" is not a Live Intelligence action.`);

  if (!idempotencyKey || typeof idempotencyKey !== 'string') {
    return refuse('idempotency_key_required', 'Every action needs a key so a retry cannot repeat it.');
  }
  if (idempotencyKey.length > LI_ACTION_BOUNDS.idempotencyKey) return refuse('idempotency_key_too_long');

  if (payload && JSON.stringify(payload).length > LI_ACTION_BOUNDS.payloadChars) {
    return refuse('payload_too_large', `Keep the payload under ${LI_ACTION_BOUNDS.payloadChars} characters.`);
  }
  if (reason && String(reason).length > LI_ACTION_BOUNDS.reason) return refuse('reason_too_long');

  if (intent === 'apply') {
    if (!descriptor.applyHandler) {
      return refuse('action_not_appliable',
        `${actionType} can be proposed but has no handler, so it cannot be applied yet.`);
    }
    /* The same rule the RPC enforces, asked earlier so the founder is told
       before a round trip. The RPC is still the authority. */
    if (origin === 'model' && confirmed !== true) {
      return refuse('model_origin_unconfirmed',
        'VISION suggested this. It has to be confirmed before it changes anything.');
    }
    if (descriptor.requiresConfirmation && confirmed !== true) {
      return refuse('confirmation_required', 'This action needs explicit confirmation.');
    }
  }

  return {
    ok: true,
    intent,
    actionType,
    target: target || descriptor.target,
    payload: payload || {},
    reason: reason || null,
    idempotencyKey,
    origin: ['model', 'founder', 'system'].includes(origin) ? origin : 'system',
    confirmed: confirmed === true,
    handler: intent === 'apply' ? descriptor.applyHandler : null,
  };
}

/* ── USAGE GUARDS, the pure half ─────────────────────────────────────────
   The ceilings live here so a test can read them and the runtime cannot
   quietly disagree with what was reviewed. */
export const LI_USAGE_GUARDS = Object.freeze({
  /* ONE model call per turn. Not a budget to spend down — a structural fact:
     the adapter is invoked once and never retried, because an automatic retry
     on a timeout is how one stuck request becomes five paid ones. */
  modelCallsPerTurn: 1,
  /* A single practice session cannot exceed this many turns. A stuck UI
     resending forever is stopped by the reservation, before any provider. */
  sessionTurnCeiling: 60,
  maxInputChars: 2000,
  maxOutputChars: 600,
  timeoutMs: 20000,
  retries: 0,
});
