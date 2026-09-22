/* ════════════════════════════════════════════════════════════════════════
   WHAT MAY REACH call_assist — the gate between hearing and analysing.

   call_assist rests on one rule: only the PROSPECT can establish a fact about
   their business, and the FOUNDER saying something is a warning rather than
   evidence. That rule is only as good as the speaker label attached to each
   line, so this is where a line earns the right to be analysed at all.

   NOTHING UNATTRIBUTED GETS THROUGH. A turn VISION could not attribute is not
   downgraded, not guessed at, and not sent as "probably the founder" — it is
   held back and counted, so the founder can be told their call is partially
   unread rather than silently given analysis of half a conversation.
   ══════════════════════════════════════════════════════════════════════ */

export const FEEDABLE_ROLES = Object.freeze(['founder', 'prospect']);

/* Reasons a turn is withheld, so the panel can say which — a silent drop and
   a deliberate hold look identical from the outside otherwise. */
export const WITHHELD = Object.freeze({
  UNATTRIBUTED: 'unattributed',
  BEFORE_CALIBRATION: 'before_calibration',
  CALIBRATION_UTTERANCE: 'calibration_utterance',
  EMPTY: 'empty',
  ALREADY_SENT: 'already_sent',
  SPEAKER_UNRESOLVED: 'speaker_unresolved',
});

export function createCallFeed() {
  /* SETS OF itemIds, NOT COUNTERS. When call_assist is busy the caller
     un-sends a turn so the next event reconsiders it, and a plain counter
     incremented again on every pass -- a 7-turn call reported 4 founder and
     7 prospect turns. Distinct ids cannot be counted twice. */
  return {
    sent: new Set(), withheld: [], calibrated: false,
    heard: { founder: new Set(), prospect: new Set() },
  };
}

/* HOW MANY FOUNDER-ONLY TURNS BEFORE SILENCE FROM THE OTHER SIDE IS WORTH
   SAYING OUT LOUD. Two is normal at the top of a call -- the founder opens,
   the prospect has not replied yet. By the fourth the founder has been
   talking alone for a while, and either the prospect genuinely has not spoken
   or VISION is not hearing them as a separate voice. Both are worth knowing
   and neither is a guess about which. */
export const LONE_FOUNDER_TURNS = 4;

/* `turn` is a diarized row: { itemId, speakerId, role, text, ... }.
   Returns { feed: boolean, reason, payload } — payload is exactly what the
   call_assist action expects, and is only ever built for an attributed turn. */
export function considerTurn(feed, turn, {
  calibrationItemIds = [], sequence, prospectResolved = false,
} = {}) {
  if (!feed || !turn) return { feed: false, reason: WITHHELD.EMPTY };

  const text = typeof turn.text === 'string' ? turn.text.trim() : '';
  if (!text) return withhold(feed, turn, WITHHELD.EMPTY);

  /* The calibration lines are VISION's own setup, not part of the call. They
     are how the founder is identified; analysing them would put "VISION
     founder calibration" into a sales conversation.

     EVERY calibration ATTEMPT counts, not just the one that succeeded. The
     first attempt is routinely unattributable — that is why there are two —
     and classing a refused attempt as unread call audio tells the founder
     their conversation was partly missed when only VISION's own setup line
     was skipped. */
  if (calibrationItemIds.includes(turn.itemId)) {
    return withhold(feed, turn, WITHHELD.CALIBRATION_UTTERANCE);
  }
  if (!feed.calibrated) return withhold(feed, turn, WITHHELD.BEFORE_CALIBRATION);

  /* THE LOAD-BEARING LINE. */
  if (!FEEDABLE_ROLES.includes(turn.role)) {
    return withhold(feed, turn, WITHHELD.UNATTRIBUTED);
  }

  if (feed.sent.has(turn.itemId)) return { feed: false, reason: WITHHELD.ALREADY_SENT };

  /* ── NO SECOND VOICE, NO CONVERSATION TO READ ─────────────────────────
     If the diarizer merges the prospect into the founder's label, every line
     comes back as 'founder' and passes the check above -- the role is real,
     it is just wrong. call_assist then analyses a dialogue as a monologue,
     and the result is not merely empty, it is INVERTED: warningFor() reads
     the newest founder line, which is actually the prospect's, and tells the
     founder "You stated that as fact and they have not said it" about a
     sentence the prospect had just said. Measured, not theorised.

     So nothing is fed until VISION has actually heard a second speaker.
     Nothing is lost by waiting: turns are reconsidered on every event, so
     the founder's opening lines are fed the moment the prospect answers,
     with the roles that were right all along. Defaults to false, because a
     caller that forgets this should send nothing rather than send it
     unattributed. */
  if (prospectResolved !== true) return withhold(feed, turn, WITHHELD.SPEAKER_UNRESOLVED);

  if (feed.heard && feed.heard[turn.role] instanceof Set) feed.heard[turn.role].add(turn.itemId);
  feed.sent.add(turn.itemId);

  return {
    feed: true,
    reason: null,
    payload: {
      action: 'call_assist',
      mode: 'call',
      speaker: turn.role,
      input: text,
      sequence: Number.isInteger(sequence) ? sequence : feed.sent.size,
    },
  };
}

/* ONE ENTRY PER TURN, not one per look. Turns are reconsidered on every
   event, so pushing blindly counted the same withheld line eleven times and
   reported a call as massively unread when one setup utterance was skipped. */
function withhold(feed, turn, reason) {
  const existing = feed.withheld.findIndex((w) => w.itemId === turn.itemId);
  const entry = { itemId: turn.itemId, reason, text: turn.text || '' };
  if (existing >= 0) feed.withheld[existing] = entry;
  else feed.withheld.push(entry);
  return { feed: false, reason };
}

export function markCalibrated(feed) {
  if (feed) feed.calibrated = true;
  return feed;
}

/* What the founder should be told about coverage. An analysis built on four
   of six turns is not wrong, but presenting it as if it heard everything is. */
export function coverage(feed) {
  const unread = (feed ? feed.withheld : []).filter((w) => w.reason === WITHHELD.UNATTRIBUTED);
  const heard = (feed && feed.heard) || {};
  const heardFounder = heard.founder instanceof Set ? heard.founder.size : 0;
  const heardProspect = heard.prospect instanceof Set ? heard.prospect.size : 0;
  /* ── THE OTHER HALF OF THE CALL ───────────────────────────────────────
     Attribution gaps were the only thing coverage could see, and a diarizer
     that merges the prospect INTO the founder produces no gaps at all: every
     line comes back confidently labelled founder, unattributed stays zero,
     and VISION reports it read the whole conversation while never once having
     heard the other person.

     Counting the roles actually fed closes that. It does not claim to detect
     a merge -- a prospect who says nothing looks the same from here, and
     VISION has no way to tell those apart without guessing. It states the one
     thing that is true in both cases: the prospect has not been heard. */
  const prospectHeard = heardProspect > 0;
  /* COUNT WHAT WAS SEEN, NOT ONLY WHAT WAS SENT. Once turns are withheld
     because no second speaker exists, heard.founder stays at zero -- so a
     signal that counted only fed turns would fall silent in precisely the
     situation it was built to report. The withheld list is deduped by
     itemId, so these are distinct turns, not repeated looks. */
  const unresolved = (feed ? feed.withheld : [])
    .filter((w) => w.reason === WITHHELD.SPEAKER_UNRESOLVED).length;
  const founderSeen = heardFounder + unresolved;
  return {
    analysed: feed ? feed.sent.size : 0,
    unattributed: unread.length,
    complete: unread.length === 0,
    unreadTexts: unread.map((w) => w.text),
    founderTurns: founderSeen,
    prospectTurns: heardProspect,
    prospectHeard,
    /* Only once the founder has been talking alone long enough for it to mean
       something. Before that this is just the top of a call. */
    loneFounder: !prospectHeard && founderSeen >= LONE_FOUNDER_TURNS,
  };
}
