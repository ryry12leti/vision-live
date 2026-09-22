/* ════════════════════════════════════════════════════════════════════════
   PHASE 2 — SERVER-SIDE EVIDENCE EXTRACTION

   One derivation of one settled call, done once, on the server.

   The producers are unchanged: runRules() and readReactions(), the same
   two deterministic readers the client has always run live. What changes
   is WHO runs them and WHEN. The browser cannot be the durable authority
   for evidence -- it runs before playback has finished, so it cannot know
   whether the prospect was actually heard; it cannot be re-run over an old
   call, so an extractor upgrade could never reprocess anything; and it is
   the user's own machine.

   ── SAID IS NOT EARNED ───────────────────────────────────────────────
   The prospect's greeting is a real, persisted, citable turn. It is also
   not something the founder achieved. So it is present for the readers --
   an event may quote it, and identity may be read from it -- and absent
   from the state fold that decides how far the call has progressed. The
   same distinction Phase 1 settled for the live rail at 47a25712, applied
   in the one place that now derives durable evidence.

   ── UNHEARD IS NOT EVIDENCE ──────────────────────────────────────────
   Prospect content the founder never heard arrives here already blanked
   by the caller. Nothing is re-decided; this file simply cannot invent
   what it was not given. Where delivery was never RECORDED at all -- the
   654 prospect turns written before Phase 1 tracked it -- unknown is
   treated as unknown, not as heard, and the run says so.
   ══════════════════════════════════════════════════════════════════════ */
import { runRules } from './rule-engine.js';
import { readReactions } from './reaction-reader.js';
import { buildAnswerKey } from './answer-key.js';
import { initialCallState, advanceCallState } from './call-state.js';
import { deriveEventId } from './candidate-events.js';

/* Bump this and every call becomes re-extractable without touching a byte
   of what the previous version concluded. That is the whole reason it is
   part of the event identity. */
/* v2 (P5R-1): the reaction reader emits two things it could not express
   before -- explicit_refusal_to_answer for the language people actually use
   (0 of 6 real refusals were detected at v1) and authority_disclaimed. The
   run identity MUST move with it: ensurePersistentEvidence short-circuits on
   a complete run at (session, fingerprint, extractor_version), so leaving
   this at v1 would return `already_canonical` and never re-extract. v1 runs
   and their events stay on disk, superseded rather than rewritten. */
/* v3 (P5R-2): both producers changed what they emit for an unchanged call
   (the close idiom mask, and the greeting no longer answering). New ids, new
   run, prior run superseded -- v2 rows stay on disk as history. */
/* v4 (P5R-3): the rule engine emits `pitch_declined`, so an unchanged call
   yields a new event. Without this bump ensurePersistentEvidence returns
   `already_canonical` and the new evidence never lands -- which is exactly
   what it did on the first attempt. */
/* v8 (P5R-6b): the rule engine emits one further canonical event
   (`pitched_a_non_buyer`), so a settled call yields a different event set
   than it did at v7. New ids, coexisting with v7 rather than colliding. */
/* v9 (P5R-7): two further canonical events per settled call. New ids,
   coexisting with v8 rather than colliding. */
/* v10 (P5R-7.1): completion is derived server-side rather than read from
   the client column, so a settled call whose rows carry `turn_complete:
   false` mid-conversation now yields a different event set. Staging holds 19
   such founder rows, so this is a real output change, not a theoretical one.
   New ids, coexisting with v9 rather than colliding. */
/* v11 (P5R-7.2): ON CONTRACT PRINCIPLE, not on measured output. The
   retraction guard now requires the retry to exist, so a turn combining a
   non-accepted branch with an incomplete claim derives differently than it
   did at v10. Staging holds ZERO such rows, so no existing call's evidence
   changes -- but the frozen rule is that changed MEANING moves the version,
   and reusing a version for a changed derivation is the one thing it exists
   to prevent. A run that cannot be distinguished from its predecessor by
   today's data is exactly the case where the discipline earns its keep. */
export const EXTRACTOR_VERSION = 'practice_server_extractor_v11';

const attOf = (t) => Number(t && (t.attempt_no ?? t.attemptNo)) || 1;
const textOf = (t) => String((t && (t.content ?? t.text)) || '');

/* The greeting is the prospect turn that opens the call, before the
   founder has said anything. Identified structurally rather than by
   matching words, so a greeting that happens to sound like an answer is
   still a greeting. */
export function isGreeting(turn, all) {
  if (!turn || turn.speaker !== 'prospect') return false;
  const firstFounder = (all || []).find((t) => t && t.speaker === 'founder');
  if (!firstFounder) return turn.sequence === 0;
  return turn.sequence < firstFounder.sequence;
}

const deliveryOf = (t) => (t && t.timing_detail && t.timing_detail.audioDeliveryOutcome) || null;

/* ── DELIVERY IS A CLAIM, AND ITS PREMISE IS CHECKABLE ─────────────────
   The server cannot know what a founder HEARD, and nothing here pretends
   otherwise. But `cut_short` and `never_started` are not claims about
   hearing -- they are claims that the call STOPPED at this line, and that
   premise is a fact about the transcript the server already owns.

   It mattered because the claim is client-written and suppressive: a
   `cut_short` blanks the prospect's content outright, and an absent stamp
   drops every event citing the turn. So a founder could delete the one
   objection they mishandled by stamping the turn they did not like. The
   evidence that would count against them is exactly the evidence they can
   erase, which is the wrong way round for a proof-based product.

   `api.stop()` is the only thing that cuts prospect audio short, and it
   ends the call: it sets phase 'ended', finishes the session and scores it.
   There is no barge-in. So a suppression claim on a turn the founder went
   on to answer contradicts the record.

   Four states, and `disputed` is the honest one -- NOT `delivered`:

     delivered   the client said so, and content is server-authored now, so
                 this can only surface a line the server really generated.
     undelivered claimed undelivered AND the call really did stop there
                 (it is the server-owned terminal turn, or no founder spoke
                 after it). Honoured: content blanked, as before.
     disputed    claimed undelivered but the founder answered afterwards.
                 We assert only that they kept talking. Content stands and
                 events derive, carrying `disputed` so no consumer mistakes
                 this for a clean delivery.
     unknown     no stamp, and nothing to check the premise against.
                 Fail-closed exactly as before -- events citing it dropped.

   An unstamped turn in a RESERVED session that the founder answered is
   `disputed` too: every current client stamps every prospect row, so a gap
   there is anomalous rather than historical. Legacy sessions keep the old
   fail-closed reading untouched, so no existing score moves. */
export const DELIVERY = Object.freeze({
  DELIVERED: 'delivered', UNDELIVERED: 'undelivered',
  DISPUTED: 'disputed', UNKNOWN: 'unknown',
});

/* ── WHOSE FACT IS "THIS TURN FINISHED"? ──────────────────────────────
   `turn_complete` is written by the browser through practice_turn_append_v1,
   which passes it straight into the row, and the RPC is still granted to
   `authenticated`. A verifier proved the consequence with the transcript
   byte-identical: setting it false on the pitch and close turns deleted
   `offer_asserted`, `close_attempted` and `unearned_close`, made the call
   unscorable, and moved `pitch_discipline` from `attempted_failure` to
   `absent` in the durable ledger. A founder could erase a bad call.

   This file previously argued the column had to be trusted because "no
   server-owned fact separates the transcriber cutting my sentence off from
   me hiding this turn". That was wrong, and the fact was already in use one
   subsystem over: Part X closed delivery suppression by observing that a
   founder who ANSWERED a line proves they heard it. The same shape applies
   here -- A CALL THAT CONTINUED PAST A TURN PROVES THAT TURN ENDED.

   So the claim is honoured only where it can still be honest:

     - the LAST turn may be incomplete; that is a genuine cut-off, and the
       terminal boundary is server-owned already (`terminal_turn_id`)
     - a SUPERSEDED attempt keeps its claim; retries are excluded by branch
       and supersession, and this must not quietly re-admit them
     - an accepted turn the call continued past is COMPLETE, whatever the
       column says

   This does not force every turn complete and does not weaken eligibility:
   the only claims it overrules are ones the call's own shape contradicts. */
export function effectiveComplete(turn, allTurns) {
  const claimed = (turn.turn_complete ?? turn.complete) !== false;
  if (claimed) return true;
  /* ── P5R-7.2: A RETRACTION ONLY COUNTS IF THE RETRY LANDED ─────────
     `branch` is written by the client too (`coalesce(p_branch,'accepted')`
     goes straight into the row and the RPC still has EXECUTE for
     `authenticated`). Honouring an incomplete claim purely because the turn
     called itself non-accepted put the delete button back: a verifier set
     `turn_complete:false` + `branch:'superseded'` and erased
     `offer_asserted`, `close_attempted` and `unearned_close`, took the call
     to unscorable, and moved `pitch_discipline` back to `absent`.

     The legitimate shape this guard exists for is repair-after-cut: a turn
     cut off mid-sentence, SUPERSEDED BY A RETRY THAT ACTUALLY HAPPENED.
     `rule-engine`'s `repair_after_cut` requires exactly that
     (`prev.complete === false`), so the guard cannot simply be dropped.

     What separates the repair from the forge is whether the retry EXISTS --
     a higher attempt at the same sequence. That is a fact about the turn
     list, not a claim on the row, and it cannot be asserted by writing one
     turn. It is checked here rather than at the write path because at INSERT
     time the retry has not been written yet, so the RPC cannot tell the two
     apart; only the assembled call can.

     Measured against staging before changing it: of 10 real superseded rows,
     0 are incomplete, so no existing row's reading moves. */
  const accepted = String(turn.branch ?? 'accepted') === 'accepted';
  if (!accepted) {
    const seq = Number(turn.sequence);
    const att = Number(turn.attempt_no ?? turn.attemptNo ?? 1);
    const repaired = (allTurns || []).some((x) => Number(x.sequence) === seq
      && Number(x.attempt_no ?? x.attemptNo ?? 1) > att);
    return repaired ? false : true;
  }
  const seq = Number(turn.sequence);
  const callContinued = (allTurns || []).some((x) => Number(x.sequence) > seq);
  return callContinued;
}

export function resolveDelivery(turns, opts = {}) {
  const rows = turns || [];
  const lastFounder = rows.reduce((max, t) => (t && t.speaker === 'founder'
    && Number(t.sequence) > max ? Number(t.sequence) : max), -1);
  const terminalTurnId = opts.terminalTurnId || null;
  const reserved = opts.sequencingMode === 'reserved';
  const out = new Map();
  rows.forEach((t) => {
    if (!t || t.speaker !== 'prospect') return;
    const key = `${t.sequence}:${attOf(t)}`;
    const claimed = deliveryOf(t);
    /* The founder demonstrably went on speaking after this line. A transcript
       fact -- never a claim that they heard it. */
    const answered = lastFounder > Number(t.sequence);
    const stoppedHere = (terminalTurnId && t.turn_id === terminalTurnId) || !answered;
    if (claimed === 'completed') { out.set(key, DELIVERY.DELIVERED); return; }
    if (claimed === 'cut_short' || claimed === 'never_started') {
      out.set(key, stoppedHere ? DELIVERY.UNDELIVERED : DELIVERY.DISPUTED); return;
    }
    /* The greeting has never carried a stamp and never needed one. */
    if (isGreeting(t, rows)) { out.set(key, DELIVERY.DELIVERED); return; }
    if (!claimed && reserved && answered) { out.set(key, DELIVERY.DISPUTED); return; }
    out.set(key, claimed ? DELIVERY.DELIVERED : DELIVERY.UNKNOWN);
  });
  return out;
}

/* Content is erased ONLY for a turn whose undelivered claim survived the
   check above. Shared so scoring and extraction cannot drift apart. */
export function neutraliseUndelivered(rows, opts = {}) {
  const resolved = resolveDelivery(rows, opts);
  return (rows || []).map((t) => {
    if (!t || t.speaker !== 'prospect') return t;
    return resolved.get(`${t.sequence}:${attOf(t)}`) === DELIVERY.UNDELIVERED
      ? { ...t, content: '' } : t;
  });
}

/**
 * Derive the evidence for one settled call.
 *
 * `turns` are the authoritative rows, already neutralised for delivery by
 * the caller. Nothing here mutates them and nothing re-reads the network.
 */
export function extractEvidence({ sessionId, sourceFingerprint, turns = [], handoff = {},
  sessionFormat = null, extractorVersion = EXTRACTOR_VERSION,
  terminalTurnId = null, sequencingMode = null,
  /* The canonical pre-call research, resolved server-side from
     practice_sessions.prospect_ref. NULL is the fail-closed state and the
     default: with no research the grounding rule emits nothing. */
  research = null } = {}) {
  if (!sessionId) throw new Error('extract_without_session');
  if (!sourceFingerprint) throw new Error('extract_without_source_fingerprint');

  const assembled = turns.map((t) => ({
    sequence: t.sequence,
    attemptNo: attOf(t),
    speaker: t.speaker,
    text: textOf(t),
    complete: effectiveComplete(t, turns),
    /* `founderAction` USED TO BE PASSED HERE AND WAS READ BY NOBODY. It is
       client-authored through practice_turn_append_v1, so handing it to the
       extractors was a standing invitation for a future rule to consult it
       and quietly let a founder label their own turn. Verified before
       removal: zero reads in rule-engine, reaction-reader, answer-key,
       call-state and evidence-gates. Removing it changes no output today and
       closes the door on it changing one tomorrow.

       `complete` stays, deliberately. It is also client-authored and it DOES
       reach the extractors (rule-engine's incomplete_turn gate), but unlike
       delivery -- where "the founder went on speaking" proves they heard --
       no server-owned fact separates "the transcriber cut my sentence off"
       from "I am hiding this turn". Overruling it would convict founders on
       partial speech. The suppression is neutralised where it lands instead,
       in mastery-observation. */
  }));

  /* WHAT THE FOUNDER HAD EARNED as of each turn. Folded in order, and the
     greeting is folded over rather than into -- nobody earns being
     answered. */
  const earned = assembled.filter((t, i) => !isGreeting(turns[i], turns));
  const before = new Map();
  let state = initialCallState(handoff);
  earned.forEach((t) => {
    if (!before.has(String(t.sequence))) before.set(String(t.sequence), state);
    state = advanceCallState(state, t);
  });
  /* A turn the fold never saw still needs an answer for "what was true
     before you spoke": the nearest earlier state, which is what was true. */
  const stateAt = (seq) => {
    if (before.has(String(seq))) return before.get(String(seq));
    let best = null;
    before.forEach((v, k) => { if (Number(k) < Number(seq)) best = v; });
    return best;
  };

  const answerKey = buildAnswerKey(earned, handoff);
  const raw = runRules({ sessionId, turns: assembled, stateAt, answerKey, research })
    .concat(readReactions({ sessionId, turns: assembled }));

  /* ── DELIVERY PROVENANCE, FAIL CLOSED ───────────────────────────────
     An event that leans on a prospect turn whose delivery was never
     recorded is not evidence that the founder heard it -- it is evidence
     that nobody knows. Dropped, and the run is marked so no consumer
     mistakes a partial derivation for a whole one. */
  /* Only genuinely UNKNOWN delivery drops an event now. A suppression claim
     the transcript contradicts resolves to `disputed`, which keeps the
     evidence and says so -- otherwise the one objection a founder mishandled
     is the one they can delete. See resolveDelivery. */
  const resolved = resolveDelivery(turns, { terminalTurnId, sequencingMode });
  const deliveryAt = (seq, att) => resolved.get(`${seq}:${att || 1}`) || DELIVERY.UNKNOWN;
  const unknownDelivery = new Set();
  turns.forEach((t) => {
    if (t.speaker === 'prospect' && !isGreeting(t, turns)
      && deliveryAt(t.sequence, attOf(t)) === DELIVERY.UNKNOWN) {
      unknownDelivery.add(`${t.sequence}:${attOf(t)}`);
    }
  });
  const citesUnknown = (e) => (e.citations || []).some((c) => c.speaker === 'prospect'
    && unknownDelivery.has(`${c.sequence}:${c.attemptNo || 1}`));
  /* An event is only as clean as the worst delivery it leans on. */
  const deliveryFor = (e) => ((e.citations || [])
    .filter((c) => c.speaker === 'prospect')
    .map((c) => deliveryAt(c.sequence, c.attemptNo))
    .includes(DELIVERY.DISPUTED) ? DELIVERY.DISPUTED : DELIVERY.DELIVERED);

  const kept = raw.filter((e) => !citesUnknown(e));
  const droppedForProvenance = raw.length - kept.length;

  /* ── ASSISTANCE, RECORDED RATHER THAN RE-INFERRED ───────────────────
     Whether help was on screen when the founder spoke is a fact about the
     call, and a later consumer must never have to guess it back out of
     whether a coaching event happens to exist.

     IT IS STAMPED ON THE PROSPECT'S ROW, NOT THE FOUNDER'S. This read the
     founder turn's own timing_detail, which never carries the key -- the
     rail is rendered WHILE THE PROSPECT IS SPEAKING, so the runtime stamps
     coachingRenderedAt on that prospect turn, and the founder who answers
     next is the one who had help on screen. Measured on staging before
     changing it: 16 prospect turns carry coachingRenderedAt and ZERO of 642
     founder turns do. So `assisted` was false on every event ever derived,
     and the regression that covered it passed only because its fixture put
     the key where real data never does.

     That matters beyond tidiness: `assisted` is what tells mastery whether
     a success was earned unaided. Dead, it would have let assisted work
     promote a seller to reliable. */
  const coached = new Set();
  let railOpen = false;
  turns.slice()
    .sort((x, y) => (Number(x.sequence) - Number(y.sequence)) || (attOf(x) - attOf(y)))
    .forEach((t) => {
      if (t.speaker === 'prospect') {
        railOpen = Boolean(t.timing_detail && t.timing_detail.coachingRenderedAt);
        return;
      }
      /* Every attempt at the turn that followed it, superseded ones
         included: the rail was on screen for all of them. */
      if (railOpen) coached.add(`${t.sequence}:${attOf(t)}`);
    });

  /* Re-stamped with the full run identity. The producers do not know which
     run they are being asked for, and should not -- so the identity is
     applied once, here, through the same derivation the store uses. */
  const idMap = new Map();
  const stamped = kept.map((e) => {
    const eventId = deriveEventId({
      sessionId, sourceFingerprint, extractorVersion,
      ruleId: e.ruleId, ruleVersion: e.ruleVersion, citations: e.citations,
    });
    idMap.set(e.eventId, eventId);
    return { ...e, eventId, sourceFingerprint, extractorVersion,
      sessionFormat: sessionFormat || null,
      assisted: coached.has(`${e.subjectSequence}:${e.subjectAttemptNo || 1}`),
      deliveryProvenance: deliveryFor(e) };
  });
  /* A corroboration points at another event by id, and both ids just
     changed. Left unmapped it would dangle at a row from a different run. */
  const remapped = stamped.map((e) => (e.corroboratesEventId
    ? { ...e, corroboratesEventId: idMap.get(e.corroboratesEventId) || null }
    : e));

  return {
    events: remapped,
    provenanceComplete: unknownDelivery.size === 0,
    droppedForProvenance,
    extractorVersion,
    sourceFingerprint,
  };
}

/* The wire shape practice_candidate_events_append_v1 expects. */
export function toAppendPayload(events = []) {
  return events.map((e) => ({
    eventId: e.eventId,
    producer: e.producer,
    producerVersion: e.producerVersion,
    ruleId: e.ruleId,
    ruleVersion: e.ruleVersion,
    eventType: e.eventType,
    subjectSequence: e.subjectSequence,
    subjectAttemptNo: e.subjectAttemptNo,
    subjectTurnComplete: e.subjectTurnComplete,
    subjectCreditEligible: e.subjectCreditEligible,
    citations: e.citations,
    authority: e.authority,
    authorityBasis: e.authorityBasis,
    corroboratesEventId: e.corroboratesEventId || null,
    contractVersion: e.contractVersion,
    extractorVersion: e.extractorVersion,
    sourceFingerprint: e.sourceFingerprint,
    sessionFormat: e.sessionFormat || null,
    assisted: e.assisted === true,
    deliveryProvenance: e.deliveryProvenance || 'delivered',
  }));
}
