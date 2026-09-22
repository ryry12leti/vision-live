/* ════════════════════════════════════════════════════════════════════════
   THE RAIL — what to say next, and why it fits THIS moment

   No second sales brain. The move comes from `decideBestMove`, the same
   locked engine the pause and the review already obey; the wording comes
   from `waysToSay` and goes through the same adherence gate as What To Say
   Instead. This file decides nothing about the call. It reads the state and
   says what is already true, in a sentence a founder can act on.

   That makes it instant -- no model, no network -- which matters more here
   than anywhere else in Practice: guidance that arrives after the founder
   has already spoken is worse than none, because he reads it while the
   prospect is waiting.

   ── WHAT THE FOUNDER MAY BE TOLD ──────────────────────────────────────
   VISION knows the prospect's trust, resistance and patience because it is
   running them. The founder does not, and telling him would replace the
   skill being practised -- reading a person -- with reading a dashboard. So
   every explanation below is phrased from something he could have noticed
   himself: what they just said, what they have and have not admitted, and
   whether they pushed back. Never a number, never a hidden lever.
   ══════════════════════════════════════════════════════════════════════ */
import { buildCallState } from './call-state.js';
import { buildAnswerKey, ANSWER_STATE } from './answer-key.js';
import { decideBestMove } from './best-move.js';
import { waysToSay, notTheirOwnWords } from './say-it.js';
import { gateLines, adheres } from './move-adherence.js';
import { readInteraction, readProspectMove, statesIdentity, MOVE } from './interaction-read.js';
import { readAuthorityEvidence } from './evidence-gates.js';

export const COACHING_RAIL_VERSION = 'practice_coaching_rail_v1';

/* The path a call actually takes. The rail marks where they are on it. */
export const SCRIPT_STAGES = Object.freeze([
  { id: 'opening', label: 'Opening' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'problem', label: 'The problem' },
  { id: 'permission', label: 'Permission & pitch' },
  { id: 'objections', label: 'Objections' },
  { id: 'close', label: 'Close or clean exit' },
]);

const lastOf = (turns, who) => {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i] && turns[i].speaker === who && String(turns[i].text || '').trim()) {
      return String(turns[i].text).trim();
    }
  }
  return null;
};
const isQuestion = (t) => /\?\s*$/.test(String(t || '').trim());

/* ── SOMETHING HE WOULD ACTUALLY SAY ──────────────────────────────────
   The deterministic library carries some constructions that read as written
   rather than spoken -- quoting the prospect back at himself, or announcing
   what he is about to do before doing it. They are fine in a written review
   where the founder is reading at his own pace, which is why they stay in
   the library that What To Say Instead shares. Out loud, mid-call, they are
   the tell that a machine wrote it, so the rail passes over them and takes
   the next line instead. It only settles for one if the pool has nothing
   plainer. */
const READS_AS_WRITTEN = /^(?:before i say anything|given ")|you said "|^coming back to that|— would it help/i;
const plainestFirst = (lines) => {
  const plain = lines.filter((l) => !READS_AS_WRITTEN.test(l));
  return plain.length ? plain.concat(lines.filter((l) => READS_AS_WRITTEN.test(l))) : lines;
};

/* WHERE THEY ARE, from what has actually been established. */
export function stageOf(state) {
  const s = state || {};
  const refusal = (s.refusal && s.refusal.state) || 'none';
  /* A SOFT NO IS AN OBJECTION, NOT THE CLOSE. Any refusal at all sent the
     stage to `close`, so "we already have someone on reception" on turn two
     labelled the rest of the call closing while every card under it said
     run discovery. Two blind judges and a tester all read the
     contradiction; only a clear no or a request to stop is the close. */
  if (refusal === 'hard_no' || refusal === 'do_not_contact') return 'close';
  if (refusal === 'soft_no') return 'objections';
  if (s.activeObjection) return 'objections';
  const qual = (s.qualification && s.qualification.level) || 0;
  if (s.pitchPermission && s.pitchPermission.granted) return 'permission';
  if (qual >= 3) return 'close';
  if (qual >= 2) return 'permission';
  if (qual >= 1) return 'problem';
  if ((s.facts && s.facts.disclosed && s.facts.disclosed.length) || qual >= 1) return 'discovery';
  return (s.turnsSeen || 0) <= 1 ? 'opening' : 'discovery';
}

/* ── WHY THIS, NOW ────────────────────────────────────────────────────
   Two sentences: what they are doing, and what this line does about it.
   Both are things the founder could have observed. */
function whyThisWorks(state, turns, move) {
  const s = state || {};
  const theySaid = lastOf(turns, 'prospect');
  const qual = (s.qualification && s.qualification.level) || 0;
  const refusal = (s.refusal && s.refusal.state) || 'none';
  const disclosed = (s.facts && s.facts.disclosed) || [];

  if (refusal !== 'none') {
    return 'They have said no, and meant it. Anything that ignores that costs '
      + 'you more than the call — acknowledging it is the only move that leaves a door open.';
  }
  if (s.activeObjection) {
    return 'They pushed back on your last claim rather than answering it. '
      + 'A question lowers the pressure and makes them explain what they actually disagree with.';
  }
  if (s.pitchPermission && s.pitchPermission.granted) {
    return 'They have asked to hear it, so the offer is welcome now rather than imposed. '
      + 'Keep it short and tied to the problem they described.';
  }
  if (theySaid && isQuestion(theySaid)) {
    return 'They have started asking practical questions, which is stronger buying behaviour '
      + 'than answering yours. This moves toward the next step without forcing a close.';
  }
  if (qual >= 3) {
    return 'They have told you it is a problem and that they want it different. '
      + 'That is enough to ask for time without it sounding like a pitch.';
  }
  if (qual >= 2) {
    /* Deliberately does NOT claim they have not said they want it changed.
       The qualification ladder lags real speech -- "we would like it sorted"
       does not move it -- and asserting a negative the founder can see is
       false costs the rail its credibility on the one turn it matters. */
    return 'They have admitted something is going wrong, in their own words. '
      + 'That is the moment to ask for the right to explain, rather than assuming you have it.';
  }
  if (qual >= 1) {
    return 'They have described how it works but have not said any of it is a problem. '
      + 'Asking this lets them name the cost instead of you assuming it.';
  }
  if (disclosed.length) {
    return 'They are answering, but only with facts so far — nothing yet about what any of it costs them. '
      + 'Asking this keeps them talking about the work rather than about you.';
  }
  return 'They are still giving short factual answers and have not admitted a problem yet. '
    + 'Asking this gets them describing how it actually works, which is what you have to sell against.';
}

/* ── THE RAIL ─────────────────────────────────────────────────────────
   Everything derived, nothing invented. Returns null only when there is no
   call yet to advise on. */
/* ── WHAT HE HAS ALREADY TRIED ────────────────────────────────────────
   The rail used to be told only the founder's LAST line, and recomputed
   from an empty memory every turn. So a prospect who declined got the same
   sentence again, and again -- observed on staging: "Walk me through how it
   runs at the moment." three times, and the third one ended the call,
   because the engine correctly scored it as repetition. VISION's own
   coaching tripped VISION's own fault detector.

   Every founder turn, not just the last one. */
const everythingHeSaid = (turns) => (turns || [])
  .filter((t) => t && t.speaker === 'founder' && String(t.text || '').trim())
  .map((t) => String(t.text).trim());

/* Did their last answer decline the question rather than answer it? Not the
   refusal LADDER, which is about refusing the call -- this is refusing the
   subject, which the ladder is right not to escalate but the rail is wrong
   to ignore. */
/* CONTRACTIONS ARE NORMALISED FOR APOSTROPHES, NOT EXPANDED. "I'd rather
   not" and "I would rather not" are two different strings, and only the
   first was here -- so a prospect declining in the full form was read as
   answering, the wording never rotated, and the rail offered the same line
   again. The same trap has been fixed twice already in `call-state.js`
   ("did not say" vs "didn't say"); it is the same trap, in the third file
   to hit it. */
const DECLINED = /\b(?:i'?m not going to|i am not going to|not something i(?:'d| would)|i(?:'d| would) rather not|we do(?:n'?t| not) (?:discuss|share|get into)|not (?:really )?something (?:i|we)|on an unsolicited call|on a cold call|i (?:can'?t|cannot|could not|couldn'?t) go into|not discussing that)\b/i;

/* ── THE MOMENT THAT IS STILL OPEN ────────────────────────────────────
   The live gates in `decideBestMove` are about the sentence that was just
   spoken, so they only apply while it is still unanswered. Once the founder
   has replied, that moment has passed, and telling him to answer a question
   he has already answered would be the same staleness this whole fix exists
   to remove -- just with a different sentence.

   The one exception is a founder who replied by ignoring it. A boundary he
   talked over is still standing. `readInteraction` is the layer that
   already decides whether the thing was dealt with or trampled, so that
   judgement is read rather than made a second time here. */
function latestExchange(turns) {
  let lastProspect = null;
  let founderAfter = null;
  for (let i = (turns || []).length - 1; i >= 0; i -= 1) {
    const t = turns[i];
    if (!t || !String(t.text || '').trim()) continue;
    if (t.speaker === 'prospect') { lastProspect = t; break; }
    /* Going backwards and overwriting leaves the founder turn CLOSEST to
       their line -- his direct reply, not whatever he said three turns
       later. A sentence the microphone cut in half is not a reply. */
    if (t.speaker === 'founder' && t.complete !== false) founderAfter = t;
  }
  return { lastProspect, founderAfter };
}

export function liveGuidance({ turns = [], handoff = {}, profile = null,
  memory = null, classification = null, relevance = null } = {}) {
  /* ── SAID IS NOT EARNED ────────────────────────────────────────────
     The prospect's greeting is a real turn -- displayed, persisted, and
     carrying the only statement of who answered the phone -- so identity
     and the authority timeline read it like any other line. Nothing that
     measures what the FOUNDER got out of the call may, because nobody
     asked for it.

     Measured on these exact readers before the greeting was admitted: it
     moves `turnsSeen` on every call, which is what separates the opening
     from discovery, and a "You're through to Calder Grove Opticians"
     shape reads as `disclosed`, inflating the substantive count that
     decides whether the conversation has progressed at all. Both would
     have been a founder credited for the prospect picking up. */
  const earned = (turns || []).filter((t) => !t || t.greeting !== true);
  const state = buildCallState(earned, handoff);

  /* ── WHAT WAS ACTUALLY EARNED ─────────────────────────────────────
     Four states, because "done" was hiding three different things: a
     question answered, a question refused, a stage passed over because the
     call changed, and a stage that never applied. */
  /* MOVED ABOVE THE DECISION. This used to be computed after the move, for
     display only -- an eight-state per-question ledger, recomputed every
     turn, that the thing actually choosing the move could not see. It is
     the richest record of what the founder has earned that Practice holds,
     and the decision was taking none of it. */
  const answerKey = buildAnswerKey(earned, handoff);
  const progress = (answerKey.entries || [])
    .filter((e) => e.state !== ANSWER_STATE.NOT_ASKED)
    .map((e) => ({
      question: e.topic,
      /* A SHORT REAL ANSWER IS NOT A REFUSAL. The answer key needs six
         content words before it calls a reply `answered`, so "they ring
         out, reception gets them next morning" lands as partial -- real
         information, honestly given, just briefly. Collapsing that into
         `not_earned_yet` would understate the founder as badly as the old
         code overstated him. */
      /* GROUND TRUTH FIRST. The reaction policy decided whether the
         prospect was going to answer BEFORE it said anything, and that
         decision rides the turn. A refusal that ends with a question back
         -- "I don't get into budget approvals, what are you looking to
         offer?" -- reads to the regex as `partially_answered`, because it
         contains a question. Staging put exactly that in `achieved` and
         emptied the revisit list, which is the defect this whole fix
         exists to remove. When the engine says they withheld, they
         withheld. */
      status: e.prospectWithheld === true ? 'not_earned_yet'
        : e.state === ANSWER_STATE.ANSWERED ? 'achieved'
        : (e.state === ANSWER_STATE.PARTIAL ? 'partly_earned'
          : (e.state === ANSWER_STATE.NOT_APPLICABLE ? 'irrelevant'
            : (e.state === ANSWER_STATE.ASKED ? 'asked' : 'not_earned_yet'))),
      because: e.state,
    }));
  const achieved = progress.filter((x) => x.status === 'achieved').map((x) => x.question);
  const partly = progress.filter((x) => x.status === 'partly_earned').map((x) => x.question);
  /* Refused, or they genuinely did not know. Both stay open. */
  const notEarned = progress.filter((x) => x.status === 'not_earned_yet').map((x) => x.question);

  /* ── WHAT THEY JUST DID, AND WHETHER IT IS STILL OPEN ─────────────── */
  const { lastProspect, founderAfter } = latestExchange(turns);
  /* WP4 BOUNDARY B. Validated, sequence-aware, transcript-only -- as of the
     most recent thing the prospect actually said, never later. With no
     prospect turn yet, asOfSequence is undefined and readAuthorityEvidence
     withholds everything on its own. */
  const authorityEvidence = readAuthorityEvidence(turns,
    { asOfSequence: lastProspect ? lastProspect.sequence : undefined });
  /* The runner refreshes this rail exactly once per exchange, after BOTH
     the founder's turn and the prospect's reply have been appended -- so
     live, `founderAfter` is null and there is no response to read from the
     text. The classification is still worth having: it describes the
     founder's most recent turn and the runner reassigns it every turn, so
     it is current rather than stale. What it must not do is OUTRANK what
     the prospect just did, and that is fixed where it belongs -- in the
     order of the gates in `decideBestMove` -- not by withholding it here. */
  const inter = readInteraction({
    prospectSaid: lastProspect ? lastProspect.text : '',
    founderText: founderAfter ? founderAfter.text : '',
    classification,
  });
  const stillOpen = !founderAfter || inter.ignoredBoundary || inter.pushedAfterRefusal;
  const read = {
    move: stillOpen ? inter.move : null,
    /* Only while it is still unanswered -- a question he has answered is
       not a question hanging in the air. */
    asksOutright: stillOpen ? inter.asksOutright === true : false,
    /* The RESPONSE survives either way: a founder who has just repeated a
       question they already answered needs telling now, not next turn. */
    response: inter.response,
    /* His own last turn was a clean exit -- the classifier's label, not a
       reading of the words. Carried so the decision can stop coaching
       discovery into a call he has already closed. */
    founderExited: !!(classification && classification.action === 'professional_exit'),
    said: lastProspect ? String(lastProspect.text) : null,
    atSeq: lastProspect && typeof lastProspect.sequence === 'number' ? lastProspect.sequence : null,
  };

  /* ── HOW MUCH THEY HAVE ACTUALLY GIVEN UP ─────────────────────────
     Counted with the same reader that names a prospect's move, at the same
     bar it already uses for a substantive answer, rather than a second
     opinion about what counts as disclosure. `facts.disclosed` cannot do
     this job: it appends on EVERY prospect turn that is not a flat refusal,
     so "Ardley Vets, Priya speaking" counts as a disclosed fact. */
  /* AND NOT A DECLINE. `MOVE.DISCLOSED` is the reader's fallback for a long
     line that is not a refusal, a question or an objection -- and "I am not
     going to go into that on an unsolicited call" is eleven words that fit
     none of those, so it counted as somebody describing their business.
     Two of them and the ladder would have decided the situation was
     established BECAUSE the prospect twice refused to establish it.
     `DECLINED` is the rail's own name for refusing the subject, already
     used two lines below, rather than a second opinion about it. */
  const substantive = earned.filter((t) => t && t.speaker === 'prospect'
    && readProspectMove(t.text) === MOVE.DISCLOSED
    && !DECLINED.test(String(t.text || ''))).length;

  /* ── DID THE CONVERSATION ACTUALLY MOVE ───────────────────────────
     One number standing for what the founder has earned: how far
     qualification got, how many prepared questions came back fully
     answered, and how much they have described unprompted. It is only ever
     compared with its own previous value, so the weights need to order the
     three, not price them. Every component is monotonic, so it rises when
     something is gained and never otherwise.

     `partlyEarned` is deliberately NOT in it. The answer key marks a
     question part-answered generously, and a prospect saying "Right, I
     see." to every question pushed the count up on every single turn --
     so the rail read a founder getting nowhere as a founder making
     progress, and no move ever retired. `substantive` is the honest
     version of the same signal: it needs six content words that are not a
     refusal, which a short REAL answer clears and a filler does not. */
  const qualNow = (state.qualification && state.qualification.level) || 0;
  const progressMark = (qualNow * 1000) + (achieved.length * 100) + substantive;
  const movedOn = !!(memory && typeof memory.progressMark === 'number'
    && progressMark > memory.progressMark);

  /* ── GIVING UP IS UNDONE BY THEM OPENING UP ───────────────────────
     Retirement is a claim about the prospect: asked this every way, would
     not answer. Monotonic, it outlived its own evidence -- somebody who
     stonewalled for four turns and then started talking was still being
     handled as though the door were shut, and the rail walked on past the
     rungs it had struck off toward a polite exit.

     If the conversation has genuinely moved, every one of those claims is
     falsified at once, so the slate clears. It cannot send the rail
     backwards: each rung still has to pass its own condition, and those
     conditions only get harder as more is established. */
  const memoryNow = (movedOn && memory)
    /* `seenByMove` is NOT cleared here, and that is the same distinction
       `exhaustedMoves` draws. Retirement and failed attempts are claims
       about the PROSPECT -- asked this, would not answer -- and them
       opening up falsifies both. How many times the rail has said a thing
       is a record of what the rail did, and no amount of progress unsays
       it. Cleared, the caps that stop a standing signal becoming
       wallpaper reset every turn the prospect keeps talking, which is
       exactly the turn they most need to hold. */
    ? { ...memory, spentMoves: [], failedAttempts: 0, failedByMove: {} }
    : memory;
  /* Never cleared by progress -- see `exhaustedMoves` below. */
  const usedUpNow = (memoryNow && Array.isArray(memoryNow.exhaustedMoves))
    ? memoryNow.exhaustedMoves : [];

  /* ── HAS ANYBODY SAID WHO THEY ARE ───────────────────────────────
     Transcript only. The prep sheet names a contact role, but that is a
     guess about who SHOULD answer -- on the staging call that produced
     this, the person who picked up plainly was not the practice manager
     it named. Coaching from it would tell the founder he knows something
     he does not, and the hidden scenario role is never readable here. */
  const identityKnown = (turns || []).some((t) => t && t.speaker === 'prospect'
    && statesIdentity(t.text));
  /* There is nobody to identify before they have said anything at all. */
  const anyProspect = (turns || []).some((t) => t && t.speaker === 'prospect'
    && String(t.text || '').trim());

  const move = decideBestMove({
    state,
    fault: null,
    read,
    memory: memoryNow,
    evidence: { substantive, answered: achieved.length, partly: partly.length,
      identityKnown: anyProspect ? identityKnown : true },
    authorityEvidence,
    /* ── WHAT IT MEANT, GIVEN WHAT HE SELLS ─────────────────────────
       Read on the server on the same turn the prospect reply was written,
       so this stays a synchronous, instant, no-network function -- which
       matters more here than anywhere else in Practice. Absent, nothing
       below behaves differently. */
    relevance,
  });
  if (!move || !move.moveId) return null;

  /* ── WHAT THE RAIL HAS ALREADY TOLD HIM ───────────────────────────
     The rail used to recompute from an empty memory every turn and only
     suppressed lines the founder had ACTUALLY SPOKEN. So a founder who read
     the advice and chose to do something else was handed the identical
     sentence again next turn, and the turn after -- six times on a real
     staging call, which is how "Say This Next" earned the description
     "wallpaper".

     Suggesting it and him ignoring it is exactly the case that must not
     repeat, and it is the one case the old suppression could not see. */
  /* Everything below reads `memoryNow` -- the memory the decision was
     ACTUALLY given -- so the outgoing memory cannot be computed from one
     version while the move was chosen from another. */
  const offered = (memoryNow && Array.isArray(memoryNow.offered)) ? memoryNow.offered : [];
  const alreadyOffered = new Set(offered.map((l) => String(l).toLowerCase()));
  const repeating = !!(memoryNow && memoryNow.lastMoveId === move.moveId);
  const priorFails = repeating ? (memoryNow.failedAttempts || 0) : 0;
  /* Carried forward, and charged against the move he actually attempted --
     which is the one the rail recommended LAST turn, not the one it is
     about to recommend now. */
  const failedByMove = { ...((memoryNow && memoryNow.failedByMove) || {}) };
  const seenByMove = { ...((memoryNow && memoryNow.seenByMove) || {}) };
  seenByMove[move.moveId] = (seenByMove[move.moveId] || 0) + 1;

  /* Did he take the advice? Judged with `adheres` -- the same contract the
     retry verdict and the review already use -- rather than a fresh opinion
     about what following advice looks like. */
  /* HIS LAST TURN, NOT HIS REPLY TO THEIR LAST TURN. Judged against
     `founderAfter` this was null on the ordinary case -- the prospect has
     just spoken and he has not answered yet -- so the one question it
     exists to answer went unanswered exactly when it was asked. The
     recommendation was made before his last turn, so his last turn is what
     either took it or did not. */
  const lastHeSaid = lastOf(turns, 'founder');
  const followedLast = (memoryNow && memoryNow.lastMoveId && lastHeSaid)
    ? adheres(lastHeSaid, memoryNow.lastMoveId).pass === true
    : null;

  if (memoryNow && memoryNow.lastMoveId && followedLast === true && !movedOn) {
    failedByMove[memoryNow.lastMoveId] = (failedByMove[memoryNow.lastMoveId] || 0) + 1;
  }

  const history = everythingHeSaid(turns);
  const theyDeclined = DECLINED.test(lastOf(turns, 'prospect') || '');

  /* ROTATE THE WORDING EVERY TIME THIS MOVE COMES BACK. The move is the
     engine's call and the rail does not get to overrule it -- but offering
     the identical sentence for a move that has already failed twice is not
     advice, it is a stuck record. `waysToSay` already rotates on an offset;
     it was simply never given one. */
  /* THE OFFSET IS NOW THE RUN OF THIS MOVE, not the length of the whole
     conversation. `history.length` counted every founder turn, so against a
     six-line pool it jumped an arbitrary distance on a turn that had
     nothing to do with this move, and stood still on the turns that did. */
  const priorAttempts = repeating ? (memoryNow.runLength || 0) : 0;
  const pool = waysToSay({ move, profile, max: 6, offset: theyDeclined ? priorAttempts : 0 }) || [];

  /* Nothing he has already said, however long ago -- and nothing the rail
     has already put in front of him. */
  const unsaid = history.reduce((lines, prev) => notTheirOwnWords(lines, prev), pool);
  const fresh = unsaid.filter((l) => !alreadyOffered.has(String(l).toLowerCase()));
  const gated = gateLines({ moveId: move.moveId, lines: plainestFirst(fresh), want: 3 });

  /* ── WHEN THERE IS NOTHING LEFT TO SAY, SAY NOTHING ─────────────────
     The old fallback was the full pool, on the reasoning that a repeated
     line is bad but no line is worse. Driving the product proved that
     backwards: the repeat was scored as `repetition` and the prospect hung
     up, so the fallback did not rescue the call, it ended it.

     A founder who has tried every way of making this move and been declined
     each time does not need a seventh phrasing. He needs to know the move
     is spent. The goal stays on screen -- only the words go quiet. */
  /* A MOVE WITH NO WORDS IS NOT A MOVE THAT RAN OUT OF THEM. `Pause and let
     them finish` carries no sentence BY DESIGN -- offering one would be the
     wording layer overruling the decision. Without this it would have been
     reported as exhausted on the very first turn it appeared, and the
     founder told he had tried every phrasing of a move he had never made. */
  const exhausted = !gated.lines.length && move.behaviourOnly !== true;

  const here = stageOf(state);
  const hereIdx = SCRIPT_STAGES.findIndex((x) => x.id === here);
  const refusedState = (state.refusal && state.refusal.state) || 'none';
  const told = !!(state.facts && state.facts.disclosed && state.facts.disclosed.length);
  const qual = (state.qualification && state.qualification.level) || 0;
  const objectionSeen = !!state.activeObjection
    || (turns || []).some((t) => t && t.speaker === 'prospect'
      && /already have someone|not looking at anything/i.test(String(t.text || '')));

  /* Did this stage's own requirement actually get met? */
  const met = (id) => {
    if (id === 'opening') return (turns || []).some((t) => t && t.speaker === 'prospect');
    if (id === 'discovery') return achieved.length > 0 || partly.length > 0 || told;
    if (id === 'problem') return qual >= 1;
    if (id === 'permission') return !!(state.pitchPermission && state.pitchPermission.granted);
    if (id === 'objections') return objectionSeen && !state.activeObjection;
    return false;
  };

  const stageState = (id) => {
    const i = SCRIPT_STAGES.findIndex((x) => x.id === id);
    if (id === here) return 'current';
    if (i > hereIdx) return 'ahead';
    /* Behind the current stage. Say WHY it is behind rather than "done". */
    if (met(id)) return 'achieved';
    if (id === 'objections' && !objectionSeen) return 'irrelevant';
    /* The call state moved on for a reason of its own -- a refusal jumps
       straight to the close -- so this was passed over, not failed. */
    if (refusedState !== 'none') return 'skipped';
    return 'not_earned_yet';
  };

  return {
    version: COACHING_RAIL_VERSION,
    sayNext: gated.lines[0] || null,
    alternatives: gated.lines.slice(1),
    /* Every phrasing of this move has been used and none of it landed. */
    exhausted,
    /* The rail never overrides the move -- it is the same object the pause
       and the review would lock, shown early. */
    /* ── THE MOVE IS THE ADVICE ────────────────────────────────────
       `goal` has been on this object all along and no surface has ever
       rendered it, so a founder only ever saw a sentence with no statement
       of what it was FOR -- and when the sentence went quiet he was left
       with nothing at all. Several moves now carry no sentence on purpose,
       which only works if the goal is on screen. */
    bestMove: { id: move.moveId, goal: move.goal, behaviourOnly: move.behaviourOnly === true },
    /* ── WHAT THE DECISION WAS GIVEN ───────────────────────────────
       The rail passes MORE to the locked engine than it used to, and "the
       rail shows the engine's move, not a second opinion" has to stay
       checkable against that. Handing back the exact inputs means a test
       can re-run `decideBestMove` with them and demand the same answer,
       rather than re-running it with less and comparing two different
       questions. Not rendered; it is the seam, written down. */
    decidedFrom: { read,
      evidence: { substantive, answered: achieved.length, partly: partly.length,
        identityKnown: anyProspect ? identityKnown : true },
      authorityEvidence,
      /* The memory the decision was ACTUALLY given, which is not always the
         one handed in -- a call that has moved on clears its retirements
         first. Replaying with the raw input would ask a different question. */
      memory: memoryNow || null, relevance: relevance || null },
    /* ── WHAT THE NEXT TURN NEEDS TO KNOW ──────────────────────────
       Handed back rather than stored: this module stays pure, and the
       runner owns the one copy that lives for the length of the call. */
    memory: {
      lastMoveId: move.moveId,
      runLength: repeating ? (memoryNow.runLength || 0) + 1 : 1,
      /* ── WHAT THE DECISION NEEDS TO KNOW ABOUT GIVING UP ──────────
         Retirement used to run off `runLength`, which counts how many
         times the rail SAID something -- so a prospect answering happily
         retired the move at the same rate as one stonewalling, and a
         willing call was talked into a polite exit by exchange seven.

         A failed attempt is a turn where he actually made the move and
         nothing came back. It works, it resets; he never tried it, it
         does not tick. */
      failedAttempts: movedOn ? 0
        : priorFails + ((repeating && followedLast === true) ? 1 : 0),
      /* ── AND THE SAME COUNT, KEPT PER MOVE ────────────────────────
         `failedAttempts` belongs to whichever move ran last, so it resets
         whenever anything interrupts the run -- and a real call interrupts
         constantly. Live on staging, `answer their question` came back six
         times in fourteen turns and this never got past one, because the
         prospect kept alternating. A move that keeps returning and keeps
         achieving nothing is the same wallpaper; consecutive runs are just
         its most obvious shape. */
      failedByMove,
      /* How many times each move has been RECOMMENDED. Distinct from
         `failedByMove`, which only counts the ones he actually made. */
      seenByMove,
      /* The scalar those comparisons are made against, carried so the next
         turn can tell "they gave us something" from "nothing changed". */
      progressMark,
      /* WHAT HE WAS SHOWN, NOT WHAT WAS COMPUTED. `alternatives` is
         returned but no surface renders it -- only `sayNext` reaches the
         founder. Recording all three burnt a six-line pool in two turns and
         left the rail silent on the third, having shown him two sentences
         and retired four he never saw.

         Capped so a long call cannot grow this without bound. Only the
         moves that repeat matter, and they repeat within a few turns. */
      offered: (gated.lines[0] ? offered.concat([gated.lines[0]]) : offered).slice(-40),
      exhausted,
      /* Which moves have been asked every way they can be asked. Decided by
         the engine, carried by the runner, never recomputed here -- plus
         the one that has just run out of wording.

         RUNNING OUT OF WORDS IS ITSELF BEING SPENT, and recording it here
         is what makes that survive an interruption. The engine's own
         `exhausted` backstop is keyed on the move that ran LAST, so an
         alternating call defeated it exactly the way it defeated the
         attempt counter: `clear up the confusion` was handed over five
         times, every phrasing used, and nothing was ever marked spent. */
      spentMoves: move.spentMoves || [],
      /* Kept apart from `spentMoves` on purpose: progress clears that list,
         and it must not clear this one. The engine's own `exhausted`
         backstop is keyed on the move that ran LAST, so an alternating call
         defeated it exactly the way it defeated the attempt counter --
         `clear up the confusion` was handed over five times, every phrasing
         used, and nothing was ever marked spent. */
      exhaustedMoves: (exhausted && !usedUpNow.includes(move.moveId))
        ? usedUpNow.concat([move.moveId]) : usedUpNow,
    },
    /* Did he take the last recommendation? null before there was one. */
    followedLast,
    /* How many turns running this has been the answer. Surfaced so a
       reviewer can see a move persisting deliberately rather than a rail
       that has stopped thinking. */
    moveRunLength: repeating ? (memoryNow.runLength || 0) + 1 : 1,
    /* Surfaced so the surface can say WHY the line changed, rather than the
       founder wondering why the rail moved on. */
    theyDeclined,
    /* `why` is deliberately NOT returned. Mid-call the founder is about to
       speak, not read an explanation, and the reasoning belongs where he
       can actually take it in -- the pause, and the post-call review. */
    stage: stageOf(state),
    /* Everything before the current stage is settled; the founder should be
       able to see that at a glance rather than re-reading it. */
    /* Questions he has already asked, so the script can stop offering them.
       Taken from the state's own record rather than re-derived. */
    /* ── ASKED IS NOT ANSWERED ──────────────────────────────────────
       This filtered on `answer !== null`, and a refusal IS stored in
       `answer` -- so "I'm not going to go into that on an unsolicited call"
       counted as answered, the script struck the question off, and the
       founder was told he had information he had never been given. The
       state's own per-question `refused` flag misses that phrasing too, so
       neither source was safe.

       The answer key is the canonical record and already separates them:
       answered, refused, explicitly_unknown, partially_answered. Only the
       first is achieved. */
    /* Struck off when the founder GOT something -- a full answer or a short
       real one. Never when he was refused, and never merely because he
       asked. That distinction is the whole point: `notEarnedYet` below is
       what used to be counted here. */
    answered: achieved.concat(partly),
    /* WHAT HE ASKED FOR AND DID NOT GET, kept eligible on purpose. Trust
       rises over a call; a question refused at turn three is worth asking
       again at turn eleven, in different words. */
    notEarnedYet: notEarned,
    partlyEarned: partly,
    progress,
    stages: SCRIPT_STAGES.map((st) => ({ ...st, state: stageState(st.id) })),
  };
}
