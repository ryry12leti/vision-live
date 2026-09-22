/* ════════════════════════════════════════════════════════════════════════
   THE BEST MOVE — what a good salesperson does NEXT, from the state the
   call was actually in at that moment.

   It used to be a ten-line lookup keyed mostly on which fault had been
   raised, which meant it answered "what did you do wrong" a second time
   instead of "what should you have done". This decides from the STATE: how
   firmly they have refused, whether an objection is open, whether the
   founder has earned the right to explain, how far the need is actually
   established, and what is still unknown.

   NO MODEL DECIDES THIS. It is a pure function of a recorded state and a
   diagnosed fault, so the same call always produces the same move, the move
   can be replayed from the stored state, and every one of them carries the
   state facts that chose it. A model that picked the strategy could not be
   audited, could not be reproduced, and could not be pointed at the
   evidence that justified it.

   IT DECIDES A GOAL, NEVER A SENTENCE. Wording is a separate layer and is
   allowed no opinion about which move is right — see waysToSay().
   ══════════════════════════════════════════════════════════════════════ */

import { actionableRelevance } from './offer-relevance.js';

export const BEST_MOVE_VERSION = 'practice_best_move_v1';

/* The ladder the qualification level walks up. Each rung names what is not
   yet established, because that is the thing the next question is for. */
export const MOVES = Object.freeze({
  end_professionally: { id: 'end_professionally',
    goal: 'Acknowledge it and end the call.',
    why: 'They have asked not to be contacted. There is no next move.' },
  accept_the_no: { id: 'accept_the_no',
    goal: 'Accept the no, and leave one door open.',
    why: 'They have said no clearly. Anything that ignores it costs more than it can win.' },
  explore_the_objection: { id: 'explore_the_objection',
    goal: 'Understand the objection before answering it.',
    why: 'An objection you have not understood cannot be answered, only argued with.' },
  verify_the_assumption: { id: 'verify_the_assumption',
    goal: 'Ask the thing you assumed.',
    why: 'You stated something about their business that nobody had established.' },
  build_on_their_answer: { id: 'build_on_their_answer',
    goal: 'Use the answer they already gave.',
    why: 'They have answered this. Asking again spends the goodwill that answer bought.' },
  establish_situation: { id: 'establish_situation',
    goal: 'Find out how it works today.',
    why: 'Nothing is established yet, so there is nothing to sell against.' },
  find_the_problem: { id: 'find_the_problem',
    goal: 'Find out whether any of it is actually a problem.',
    why: 'You know how it works, but not whether it costs them anything.' },
  establish_intent: { id: 'establish_intent',
    goal: 'Find out whether they want it different.',
    why: 'A problem they are content to live with is not an opportunity.' },
  qualify_timing: { id: 'qualify_timing',
    goal: 'Establish when, who decides, and what it is worth.',
    why: 'They want it different. Without timing or authority there is still nothing to book.' },
  earn_permission: { id: 'earn_permission',
    goal: 'Earn the right to explain what you do.',
    why: 'There is a problem worth solving, but they have not asked to hear the offer.' },
  make_the_offer: { id: 'make_the_offer',
    goal: 'Explain the offer, against the problem they named.',
    why: 'They have a problem and they have invited the answer.' },
  ask_for_next_step: { id: 'ask_for_next_step',
    goal: 'Ask for the next step.',
    why: 'The need is established and the offer has landed.' },
  /* NOT A RUNG ON THE LADDER. Every move above assumes the person on the
     phone could eventually say yes. This one is for when they have said, in
     their own words, that they could not -- at which point more discovery
     with them is the same mistake continuing. */
  reach_the_decision_maker: { id: 'reach_the_decision_maker',
    goal: 'Find out who decides, and ask to reach them.',
    why: 'They have told you it is not their call, so nothing you say to them can be accepted.' },

  /* ── MOVES THAT ARE NOT QUESTIONS ────────────────────────────────────
     The ladder above assumes the next move is something to SAY. Several of
     the highest-value moves in a real call are not: waiting, following an
     instruction, or stopping. A rail that can only ever hand over another
     question will hand one over at the exact moment saying nothing is the
     whole skill, which is what it did -- six discovery questions after the
     prospect had twice asked to be left alone.

     `behaviourOnly` means there is no sentence to offer and the goal IS the
     advice. The wording layer returns nothing for these on purpose. */
  let_them_finish: { id: 'let_them_finish',
    goal: 'Pause and let them finish.',
    why: 'They asked for a moment. Anything you say now is talking over them.',
    behaviourOnly: true },
  respect_the_boundary: { id: 'respect_the_boundary',
    goal: 'Acknowledge what they have asked, and follow it.',
    why: 'They told you how they will and will not deal with this. Pushing past it '
      + 'costs more than the answer was worth.' },
  acknowledge_the_pressure: { id: 'acknowledge_the_pressure',
    goal: 'Acknowledge it is a bad moment, and ask for one minute or a better time.',
    why: 'They have told you they are busy. Carrying on regardless is the fastest way to lose the call.' },
  /* BEHAVIOUR-ONLY FOR A REASON THAT IS NOT STYLE. Nobody but the founder
     knows the answer to the question he was just asked, so a wording layer
     that offered one would be inventing it. The goal is the whole advice. */
  answer_their_question: { id: 'answer_their_question',
    goal: 'Answer what they just asked, plainly, before anything else.',
    why: 'They asked you something directly. Not answering it is the clearest signal you are not listening.',
    behaviourOnly: true },
  /* THE GOAL HAS TO BE SOMETHING THE WORDING CAN ACTUALLY CARRY. It read
     "Say plainly who you are and why you are calling", and no line in the
     library names either -- this layer does not know the founder's name or
     his business, and inventing them is exactly what it must not do. A
     blind judge caught the gap: instructed to say who he was, he was handed
     "Sorry, let me start again, properly." The opener is the useful part;
     the goal now says whose job the rest is. */
  clear_up_the_confusion: { id: 'clear_up_the_confusion',
    goal: 'Start again — then say who you are and why you called, in one line.',
    why: 'They have not followed you. More of the same adds to what they already did not understand.' },
  /* ── THE THING THEY NAMED, WHICH YOU HAPPEN TO SOLVE ────────────────
     A prospect saying "if anything needed attention it would be staffing,
     not the phones" to somebody selling front-desk cover has, without
     meaning to, handed over the whole call. Read as a sentence it is a
     brush-off. Read against the offer it is the pain, volunteered.

     This move exists so that gets picked up, and it deliberately does NOT
     pitch. It asks about the thing THEY raised, in their words. Whether
     the offer may then be explained is the ladder's decision and nothing
     here shortcuts it -- connecting the two before it is earned is the
     same premature pitch as always, just better aimed. */
  explore_their_pain: { id: 'explore_their_pain',
    goal: 'Pick up the problem they just named, and find out what it costs them.',
    why: 'They named something your offer speaks to. It is worth more than anything you could have asked.' },

  /* ── WHO IS ACTUALLY ON THE PHONE ────────────────────────────────────
     Different from routing, and the difference is the whole point. Routing
     is for when they have TOLD you the decision is not theirs; this is for
     when nobody has said who they are at all. A founder who has been
     talking for six turns without knowing whether he is speaking to the
     practice manager or whoever happened to walk past the phone is not
     having a sales conversation, and no rung on the ladder notices.

     Read from the transcript and nowhere else: the prep sheet's contact
     role is a guess about who SHOULD answer, and the hidden scenario role
     is never readable at all. */
  identify_the_person: { id: 'identify_the_person',
    goal: 'Find out who you are speaking to.',
    why: 'You do not know who has answered, so you cannot tell what anything they say is worth.' },
  /* THEY ARE LEAVING, WHICH IS NOT THE SAME AS SAYING NO. Nothing has
     been refused; the call is simply over for them. Holding the door open
     on the way out is the whole move, and it is the one thing a founder
     under pressure reliably forgets. */
  let_them_go: { id: 'let_them_go',
    goal: 'They are ending the call. Let them go cleanly, and leave one door open.',
    why: 'They have said they need to go. Anything that keeps them costs the door you could have left open.' },
  leave_it_there: { id: 'leave_it_there',
    goal: 'There is nothing more to earn here — close it out politely.',
    why: 'You have asked this in every way it can be asked and nothing has opened up. '
      + 'Continuing costs more than it can now win.' },
});

/* A private copy of the refusal ordering used to sit here, unreferenced.
   `call-state.js` exports the canonical one for exactly the reason the
   comment there gives -- two layers holding separate opinions about how
   refusals rank is how they end up disagreeing -- and a dead second copy in
   the file that DECIDES on refusals is an invitation to reach for it. */

/* ── WHEN A MOVE HAS BEEN ANSWERED BY NOT BEING ANSWERED ──────────────
   Three ATTEMPTS at the same move with nothing to show for them. Two is a
   founder mid-thought; four is the founder having already noticed before
   the rail did. An attempt is a turn where he actually made the move and
   the conversation did not move on -- never a turn where the rail merely
   suggested it, and never a turn where it worked. */
const SPENT_AFTER = 3;
/* Two prospect turns of somebody telling you how the place runs. One can
   be an aside; two is a description. Held to the same bar
   `interaction-read` already uses for a substantive answer rather than a
   second opinion about what counts as disclosure. */
const SUBSTANTIVE_FOR_SITUATION = 2;
/* Explaining yourself once is ordinary. Twice, to somebody who still does
   not know who you are, is the call telling you that you have not reached
   a counterpart yet. */
const EXPLAIN_BEFORE_ASKING_WHO = 2;

/* A fact from the state, with the line that put it there. Every move carries
   these so a founder can be shown WHY this was the move. */
const because = (fact, evidence, atSeq) => ({ fact, evidence: evidence || null,
  atSeq: typeof atSeq === 'number' ? atSeq : null });

/* ── AN UNKNOWN THEY REFUSED GOES TO THE BACK, NOT IN THE BIN ─────────
   This filtered `resolved` only. Nothing in the engine ever writes
   `resolved` -- the one status a prospect turn can actually set is
   `refused` -- so the filter removed nothing, and `unknowns[0]`, which is
   what every discovery move is ABOUT, stayed pinned to the first seeded
   unknown for the whole call.

   Measured on a real staging call: the top unknown sat at `refused` from
   turn 12, and the rail went on building the same question around it for
   the remaining eight turns, having already been told no once.

   DROPPING THEM OUTRIGHT WAS THE WRONG CORRECTION, and an adversarial
   review caught it. `call-state` marks the first OPEN unknown refused
   whenever a prospect declines, regardless of which one was actually asked
   about -- and because `rung()` now rotates through the list, the rail
   routinely asks about the second or third. So a decline struck off a
   different, never-asked unknown and left the genuinely refused one
   targetable: the exact inversion of what this exists to do. Deleting them
   turned a pre-existing mis-attribution into permanent, founder-visible
   destruction of a prep-sheet question.

   Ordering instead of filtering fixes the bug that was proven -- a refused
   unknown is never what the next question is built around while anything
   else is open -- and costs nothing when the attribution was wrong, because
   nothing is lost. A prospect who declined at turn three may answer at turn
   eleven; that is the rail's own doctrine, and `notEarnedYet` says so. */
const openUnknowns = (state) => {
  const all = (((state || {}).facts || {}).unknowns || [])
    .filter((u) => u && u.status !== 'resolved');
  return all.filter((u) => u.status !== 'refused')
    .concat(all.filter((u) => u.status === 'refused'));
};
const lastDisclosed = (state) => {
  const d = (((state || {}).facts || {}).disclosed || []);
  return d.length ? d[d.length - 1] : null;
};

/* ── THE DECISION ─────────────────────────────────────────────────────
   Read top to bottom. Each gate is a fact about the call that makes every
   move below it wrong, which is why the order is the policy. */
export function decideBestMove({ state = null, fault = null,
  read = null, memory = null, evidence = null, relevance = null, authorityEvidence = null } = {}) {
  const s = state || {};
  const refusal = (s.refusal && s.refusal.state) || 'none';
  const perm = !!(s.pitchPermission && s.pitchPermission.granted);
  const qual = (s.qualification && s.qualification.level) || 0;
  const unknowns = openUnknowns(s);

  /* ── WHAT THEY JUST DID ───────────────────────────────────────────
     Read from `interaction-read`, which is the layer that already names
     a prospect's move and is already trusted by the psychology engine and
     by Guided. Not a second opinion: the SAME object, reaching one more
     consumer. Absent (the review path, replaying an old card) everything
     below simply falls through to the ladder, exactly as before. */
  const r = read || {};
  const did = r.move || null;
  /* ── NOBODY HAS SAID WHO THEY ARE ─────────────────────────────────
     Explicitly a tri-state, not a truthiness test. The review and replay
     path supplies no evidence at all, and `undefined` must not read as
     "unknown" there -- it means "not asked", and a stored card has to
     decide exactly what it decided before. Only the live rail, which has
     the transcript in front of it, ever says false. */
  const ev = evidence || {};
  /* ── WHAT IT MEANT, GIVEN WHAT HE SELLS ───────────────────────────
     Semantic evidence from `offer-relevance`, admitted there and reduced
     to the one relation that may change a move. Absent -- no model, no
     key, a call that predates it, the review replaying a stored card --
     everything below behaves exactly as it did before it existed. */
  const meaning = actionableRelevance(relevance);
  const identityUnknown = !!(evidence && evidence.identityKnown === false);
  const heardIt = (m) => did === m;
  /* An objection is live either because the state is still holding one, or
     because they just raised one. The state clears it on the founder's very
     next turn -- deliberately, so a founder who dealt with it is not
     convicted of ignoring it three turns later -- which means by the time
     the rail reads the state the objection it should be acting on has
     usually already gone. Reading both is what closes that window. */
  const objection = s.activeObjection
    || (heardIt('objected') ? { kind: 'stated_objection', said: r.said || null, atSeq: r.atSeq || null } : null);

  /* ── HOW LONG THIS MOVE HAS BEEN THE ANSWER ───────────────────────
     A move may persist -- if it is still the right one, novelty for its own
     sake is worse than repetition. But a discovery move offered three times
     running that has changed nothing has been answered, and the answer is
     that there is nothing there. Escalating then is not impatience; it is
     reading the room. */
  const ranFor = (memory && memory.lastMoveId ? (memory.runLength || 0) : 0);

  /* ── GIVING UP ON A MOVE IS A FACT ABOUT THE CALL, NOT A COUNTER ───
     The run length resets the moment the move changes, so escalation on the
     run length alone was not sticky: the ladder retired
     `establish_situation`, offered `find_the_problem`, and then -- because
     the counter now belonged to a different move and the situation was
     still not established -- went straight back to `establish_situation`.
     Measured: establish, establish, establish, find_the_problem, establish,
     establish. It looked like progress for exactly one turn.

     "You have asked this every way it can be asked and they would not
     answer" is a durable thing to know about a conversation. It is carried
     rather than recomputed, and it is only ever added to. */
  const abandoned = (memory && Array.isArray(memory.spentMoves)) ? memory.spentMoves.slice() : [];
  const retire = (moveId) => { if (!abandoned.includes(moveId)) abandoned.push(moveId); };
  /* ── TRIED AND FAILED, NOT MERELY OFFERED ──────────────────────────
     This counted RECOMMENDATIONS, which is not the same thing at all and
     was catastrophic on the calls that were going well. A cooperative
     prospect answering every question still ticked the counter, because the
     counter never asked whether the founder had made the move or whether
     anything had come back. Reproduced: a willing prospect, a founder
     saying exactly what the rail told him, and by exchange seven the advice
     was "There is nothing more to earn here — close it out politely." One
     exchange after they said they would like it sorted before the spring
     rush. The rail talked him out of a call he was winning.

     `failedAttempts` is incremented by the rail only when the founder
     ACTUALLY MADE the move and the conversation did not move on. A move
     that is working resets it; a move he never tried does not tick at all.
     That is what "asked every way it can be asked and they would not
     answer" was always supposed to mean. */
  /* ── COUNTED PER MOVE, NOT FOR THE LAST ONE ────────────────────────
     This was a single counter belonging to whichever move ran last, so it
     reset the moment anything interrupted the run -- and a real call
     interrupts constantly. Measured on a live staging call: `answer their
     question` was recommended SIX times in fourteen turns, each time with
     no wording under it, and `spentMoves` finished empty. The counter never
     got past one, because the prospect kept alternating and the move kept
     coming back fresh.

     A move that keeps returning and keeps achieving nothing is exactly the
     wallpaper this whole subsystem exists to prevent; consecutive runs are
     only the most obvious shape of it. Attempts belong to the MOVE. */
  const failedByMove = (memory && memory.failedByMove && typeof memory.failedByMove === 'object')
    ? memory.failedByMove : {};
  /* How many times each move has been RECOMMENDED, which is a different
     question from how many times it was attempted and failed. */
  const seenByMove = (memory && memory.seenByMove && typeof memory.seenByMove === 'object')
    ? memory.seenByMove : {};
  /* The last clause is the backstop for the founder who ignores the rail
     entirely: the counter cannot tick for him, but once every phrasing has
     been put in front of him and none used, there is nothing left to say. */
  /* ── TWO WAYS TO BE SPENT, AND ONLY ONE OF THEM CAN BE UNDONE ──────
     Being retired for attempts is a claim about the PROSPECT -- asked every
     way, would not answer -- and them opening up falsifies it, so the rail
     clears that list on real progress. Running out of phrasings is a claim
     about the LIBRARY, and no amount of progress writes a fifth sentence.
     Collapsed into one list, a stonewaller who varied their wording kept
     resetting the slate and the same exhausted move came back with nothing
     to say. */
  const usedUp = (memory && Array.isArray(memory.exhaustedMoves)) ? memory.exhaustedMoves : [];
  const spent = (moveId) => abandoned.includes(moveId)
    || usedUp.includes(moveId)
    || (failedByMove[moveId] || 0) >= SPENT_AFTER;

  const out = (move, extra = {}) => ({
    moveId: move.id, goal: move.goal, why: move.why,
    behaviourOnly: move.behaviourOnly === true,
    /* Carried on every move, so the caller threads one thing back and
       cannot drop it by taking a branch that forgot to include it. */
    spentMoves: abandoned.slice(),
    version: BEST_MOVE_VERSION, ...extra,
  });
  const toThem = (fact) => [because(fact, r.said || null,
    typeof r.atSeq === 'number' ? r.atSeq : null)];

  /* 1. THEY HAVE ASKED YOU TO STOP. Nothing else applies. */
  if (refusal === 'do_not_contact') {
    return out(MOVES.end_professionally, {
      because: [because('they asked not to be contacted', s.refusal.evidence, s.refusal.atSeq)] });
  }
  /* 2. A CLEAR NO STANDS. */
  if (refusal === 'hard_no') {
    return out(MOVES.accept_the_no, {
      because: [because('they said no clearly', s.refusal.evidence, s.refusal.atSeq)] });
  }
  /* ── REFUSAL IS THE STATE'S CALL, AND ONLY THE STATE'S ───────────────
     There were two more gates here, reading `refused` and `do_not_contact`
     straight off the live turn. They looked like the boundary gates below
     and were the opposite of them.

     `call-state` raises refusal through `standsAlone`, which rejects a
     phrase carrying a negator or a reporting verb in front of it -- "I am
     not asking you to stop calling", "my partner said don't change
     anything". `readProspectMove` applies no such test, by design: it names
     what a sentence sounds like, and the psychology engine wants that.

     So a live gate here could only ever fire in the cases the state had
     ALREADY considered and rejected as false positives, and its effect
     would be to tell a founder to accept a no that nobody had said.
     Refusal is monotonic and terminal; it gets the strictest reading in the
     codebase, and there must be exactly one of them. */

  /* 2b. THEY ASKED FOR THE FLOOR, OR TOLD YOU HOW THIS WILL WORK.
     Above every question in the file. Whatever the ladder wants to
     establish, establishing it over the top of someone who has just asked
     you to wait costs more than the answer is worth -- and unlike a rung,
     these expire: they are about the sentence that was just spoken, so they
     are read from the turn rather than from accumulated state. */
  if (heardIt('wrapping_up')) {
    return out(MOVES.let_them_go, { because: toThem('they have said they need to go') });
  }
  if (heardIt('asked_to_wait')) {
    return out(MOVES.let_them_finish, { because: toThem('they asked you to hold on') });
  }
  if (heardIt('set_boundary')) {
    return out(MOVES.respect_the_boundary, {
      subject: { kind: 'boundary', text: r.said || null },
      because: toThem('they told you how they will deal with this') });
  }
  if (heardIt('said_busy')) {
    return out(MOVES.acknowledge_the_pressure, { because: toThem('they told you it is a bad moment') });
  }

  /* 3. THE FAULT THE CARD IS ABOUT, WHERE IT NAMES ITS OWN REPAIR. An
     assumption is repaired by asking the thing that was assumed, and asking
     it is a better move than anything the ladder would suggest — the
     founder has already touched the subject, they simply asserted it. */
  /* THE SAME REPAIRS, REACHED FROM THE LIVE TURN. Mid-call there is no
     diagnosed fault yet -- faults are raised after the turn is scored -- so
     these branches were unreachable from the rail and served only the
     post-call correction. The prospect's own move carries the same
     information at the moment it matters: being told the decision is not
     theirs IS the non-buyer, and repeating a question they already answered
     IS the repetition.

     `verify_the_assumption` is deliberately NOT given a live route.
     Mid-call, being corrected does not present as a diagnosed assumption --
     it presents as a prospect pushing back, which `call-state` already
     records as an objection under exactly the gate that separates a
     pushback from an answer. Routing it here instead would take the same
     sentence away from `explore_the_objection`, which is the better move
     and the one the engine has always made. The repair belongs where the
     fault is actually known: the review. */
  if (fault === 'unsupported_assumption') {
    const target = unknowns[0] || null;
    const told = lastDisclosed(s);
    return out(MOVES.verify_the_assumption, {
      subject: target
        ? { kind: 'unknown', text: target.text, disclosed: told ? told.text : null }
        : { kind: 'their_claim', disclosed: told ? told.text : null },
      because: [because('this was stated, not established', null, null)]
        .concat(target ? [because('still unknown', target.text, target.atSeq)] : []) });
  }
  /* THEY HAVE TOLD YOU THEY CANNOT BUY. This sits with the other faults that
     name their own repair, and above the ladder: asking someone who cannot
     decide how their process works is discovery aimed at the wrong person.

     WP4: no longer a raw lexical read. `heardIt('no_authority')` /
     `heardIt('offered_transfer')` were interaction-read.js's stateless,
     single-turn regex -- no negation, no attribution, no memory of a
     transfer having since completed. `authorityEvidence` is
     readAuthorityEvidence's own validated, sequence-aware timeline
     (evidence-gates.js), computed by the caller from the same transcript.
     A disclaim that a completed transfer has since SPENT is excluded on
     purpose: the person now on the line was not the one who disclaimed,
     and telling the founder to keep chasing "the decision maker" would be
     coaching against evidence, not from it. */
  const bAuthority = authorityEvidence && authorityEvidence.authority.state === 'disclaimed'
    && !authorityEvidence.spentByTransfer ? authorityEvidence.authority : null;
  const bRouting = authorityEvidence && authorityEvidence.routing.state === 'offered'
    ? authorityEvidence.routing : null;
  const bEvidence = bAuthority || bRouting;
  if (fault === 'pitched_a_non_buyer' || bEvidence) {
    const told = lastDisclosed(s);
    const saidIt = (bEvidence && bEvidence.quote) || (told ? told.text : null);
    const atSeq = bEvidence ? bEvidence.atSequence : (told ? told.atSeq : null);
    return out(MOVES.reach_the_decision_maker, {
      subject: { kind: 'routing', disclosed: saidIt },
      because: [because('they said the decision is not theirs', saidIt, atSeq)] });
  }
  if (fault === 'question_repeated') {
    const answered = (s.answeredQuestions || []).filter((q) => q.answer && !q.refused);
    const last = answered.length ? answered[answered.length - 1] : null;
    /* EVERY MOVE CARRIES ITS STATE, including this one. With no answered
       question on record the move is still right — the fault says they
       repeated one — but the reason has to say that honestly rather than
       leave the founder a goal with nothing behind it. */
    return out(MOVES.build_on_their_answer, {
      subject: last ? { kind: 'answer', text: last.answer, question: last.question } : { kind: 'answer' },
      because: last
        ? [because('they already answered this', last.answer, last.answeredAtSeq)]
        : [because('this question was asked before', null, null)] });
  }

  /* 4b. THEY ASKED YOU SOMETHING. Below a boundary and below an objection,
     because both of those constrain harder -- but above every rung, because
     a founder who answers his own agenda instead of their question has
     stopped having a conversation. */
  /* ── YOU STILL DO NOT KNOW WHO THIS IS ──────────────────────────────
     Establishing who answered ranks BELOW everything they have just done,
     and that is right turn by turn -- but on a call where every single
     turn triggers something, it never gets one. Measured on a real
     staging call: twelve turns, nobody ever said who they were, and this
     move was never once offered because a question, a brush-off, a bad
     moment or a goodbye won every time.

     So it pre-empts the SECOND round of explaining yourself, and only
     that. Being asked who you are twice, after answering, is not another
     question to answer -- it is the clearest evidence available that
     nobody on this call knows who they are talking to. This does not
     reorder the priorities; it stops one of them repeating over a
     standing fact that never gets its turn. */
  /* EXPLORING AN OBJECTION COUNTS TOO. The pre-empt was written for the
     explain-again moves, and on a call where the prospect objects every
     turn the objection gate wins instead -- so establishing who answered
     starved exactly as before, just past a different gate. Seven turns, no
     name, no role, and the standing objection was "we already have someone
     on reception" from somebody who may well BE that someone: an answer
     nobody can weigh without knowing whose job it protects. */
  const EXPLAINERS = [MOVES.answer_their_question.id, MOVES.clear_up_the_confusion.id,
    MOVES.explore_the_objection.id];
  const explainedBefore = EXPLAINERS.reduce((n, id) => n + (seenByMove[id] || 0), 0);
  if (identityUnknown && explainedBefore >= EXPLAIN_BEFORE_ASKING_WHO
    && (seenByMove[MOVES.identify_the_person.id] || 0) < SPENT_AFTER
    && !spent(MOVES.identify_the_person.id)
    && (heardIt('confused') || heardIt('asked_question') || heardIt('objected'))) {
    return out(MOVES.identify_the_person, {
      subject: { kind: 'person' },
      because: [because('you have explained yourself twice and still do not know who this is',
        r.said || null, typeof r.atSeq === 'number' ? r.atSeq : null)] });
  }

  if (heardIt('confused')) {
    if (!spent(MOVES.clear_up_the_confusion.id)) {
      /* ── THE SAME MOVE, TWO DIFFERENT SITUATIONS ──────────────────
         "Say who you are and why you called" is exactly right when they
         have just picked up and do not know who this is. Four turns into a
         conversation, when they are asking what one phrase meant, it is
         absurd -- and a blind judge watched it happen: the founder had
         introduced himself in full at turn 2, ran three turns of discovery,
         the prospect asked "what do you mean by find out afterwards?", and
         the panel told him to start again and say who he was.

         The goal is what changes, not the move: they are still confused and
         the wording pool still fits. Underway is read from what they have
         actually given up, so it cannot be fooled by turn count alone. */
      const underway = (ev.substantive || 0) >= 1 || (ev.answered || 0) >= 1
        || (((s.facts || {}).disclosed || []).length > 1);
      return out(MOVES.clear_up_the_confusion, {
        goal: underway
          ? 'Put that last question a different way.'
          : MOVES.clear_up_the_confusion.goal,
        subject: { kind: 'question', text: r.said || null },
        because: toThem('they do not follow what you are asking') });
    }
    /* Started again three times and they still do not know what this is
       about. Same conclusion as answering it three times: it is not a
       wording problem, it is the wrong person. */
    retire(MOVES.clear_up_the_confusion.id);
    return out(MOVES.reach_the_decision_maker, {
      subject: { kind: 'routing', disclosed: r.said || null },
      because: [because('you have started again three times and they are still asking',
        r.said || null, typeof r.atSeq === 'number' ? r.atSeq : null)] });
  }
  /* A QUESTION IS STILL A QUESTION WHEN IT IS ALSO A BUYING SIGNAL.
     "What exactly are you offering?" reads as SHOWED_INTEREST, which is
     right and is the strongest signal on the list -- and it left the
     founder being told to go and establish their situation, because
     nothing downstream noticed somebody was waiting on an answer.
     Whether the offer has been EARNED is a separate question, and the
     ladder below still owns it. */
  /* ── ONE SENTENCE, TWO TRUE THINGS ─────────────────────────────────
     The reader assigns a single move, and it files "What are you actually
     asking for? Most people use the website now." as an objection --
     correctly, that IS an objection. It is also a direct question, and a
     direct question outranks one. The same shape swallowed the buying
     signal in "What exactly are you offering?".

     So the fact is read alongside the move, and only for the readings
     this gate genuinely outranks. A boundary, a request to wait, a
     refusal or a stated lack of authority are all handled ABOVE and none
     of them are listed here: being asked a question does not entitle you
     to talk over any of those. */
  const OUTRANKED_BY_A_QUESTION = ['showed_interest', 'objected', 'disclosed', 'none'];
  if (heardIt('asked_question')
    || (r.asksOutright === true && OUTRANKED_BY_A_QUESTION.includes(did))) {
    if (!spent(MOVES.answer_their_question.id)) {
      return out(MOVES.answer_their_question, {
        subject: { kind: 'question', text: r.said || null },
        because: toThem('they asked you a direct question') });
    }
    /* ── HE HAS ANSWERED IT THREE TIMES AND THEY STILL DO NOT KNOW ────
       Not a wording problem, and telling him to explain himself a fourth
       time teaches him the wrong lesson about why the call is going
       nowhere. Somebody who cannot hold on to what this is about after
       three plain answers is not the person who could ever say yes. */
    retire(MOVES.answer_their_question.id);
    /* Establishing who this is has already had its three goes by now --
       the pre-empt above gets there after two explanations, long before
       this move can spend -- so what is left really is routing. */
    const told = lastDisclosed(s);
    return out(MOVES.reach_the_decision_maker, {
      subject: { kind: 'routing', disclosed: r.said || (told ? told.text : null) },
      because: [because('you have explained this three times and they are still asking',
        r.said || null, typeof r.atSeq === 'number' ? r.atSeq : null)] });
  }

  /* ── HE HAS ALREADY SAID GOODBYE ────────────────────────────────────
     Below the gates above, because a boundary, an objection or a direct
     question all still deserve an answer on the way out. But above the
     ladder, because coaching discovery into a call the founder has closed
     and the prospect has accepted is the clearest possible case of "do not
     keep exploring when the correct action is to exit".

     Measured on a live staging call: he said "I'll send something over in
     writing instead, thanks for your time, have a good one", the prospect
     said "Hm, alright. Thanks.", and the rail answered "How often does that
     cause you a problem, if at all?" A blind judge marked it the worst
     recommendation in the call.

     `professional_exit` is the classifier's own label for his turn, and it
     only fires when they have NOT come back with a question, an objection
     or interest -- all of which are handled above and reopen the call. */
  /* `objected` is on this list and the reason is a measured one: he had
     cleanly closed the call, they answered "it is not something we'd get
     into", and the rail told him to go and understand the objection. An
     objection raised as somebody hangs up is a reason, not an opening.
     A question, a boundary or genuine interest still reopen the call and
     are all handled above this. */
  if (r.founderExited === true
    && (did === null || heardIt('disclosed') || heardIt('none') || heardIt('objected'))) {
    return out(MOVES.leave_it_there, {
      because: [because('you have already closed this out', r.said || null,
        typeof r.atSeq === 'number' ? r.atSeq : null)] });
  }

  /* ── A PAIN THEY VOLUNTEERED OUTRANKS THE OBJECTION AROUND IT ───────
     These arrive in the same breath more often than not: "we already have
     someone on the desk, and honestly staffing is the nightmare". The
     objection tells you why they are saying no. The pain tells you where
     a yes could come from, and it is the more valuable of the two.

     Below a boundary, a refusal and a direct question, all of which
     constrain harder and are handled above. Spendable like everything
     else, so a pain they will not open up cannot become the new
     wallpaper. */
  /* CAPPED ON RECOMMENDATIONS, like establishing who they are, and for the
     same reason: this is a standing fact about the call rather than a
     thing that expires, so the attempt counter cannot retire it while the
     prospect keeps talking about the pain -- progress resets the count
     every turn. Three questions about one thread is a discovery sequence;
     six is the founder stuck on it while the rest of the ladder waits. */
  const exploredPain = seenByMove[MOVES.explore_their_pain.id] || 0;
  if (meaning && exploredPain < SPENT_AFTER && !spent(MOVES.explore_their_pain.id)) {
    return out(MOVES.explore_their_pain, {
      subject: { kind: 'their_pain', text: meaning.quote },
      because: [because('they named this themselves, and it is what you sell against',
        meaning.quote, typeof r.atSeq === 'number' ? r.atSeq : null)] });
  }
  if (meaning && exploredPain >= SPENT_AFTER) retire(MOVES.explore_their_pain.id);

  /* 4. AN OPEN OBJECTION OUTRANKS THE LADDER. Discovery underneath an
     objection they have not been allowed to explain is not discovery. */
  /* ── AND IT IS SPENDABLE, LIKE EVERY OTHER MOVE THAT CAN PERSIST ───
     Every gate above this one is about a sentence the prospect has JUST
     spoken, so it expires by itself on the next turn. This one is not: an
     objection lives in the recorded state, so a prospect who keeps raising
     it got `explore_the_objection` for as long as it stood -- the original
     frozen-move failure, reappearing in the one branch the cascade's
     escalation could not reach.

     Three attempts at opening an objection up, with nothing to show for
     them, means they are not going to explain it. Falling through to the
     ladder is right: there may still be something else worth asking. */
  if (objection) {
    if (!spent(MOVES.explore_the_objection.id)) {
      return out(MOVES.explore_the_objection, {
        subject: { kind: 'objection', text: objection.said || null, objectionKind: objection.kind || null },
        because: [because('an objection is open', objection.said, objection.atSeq)] });
    }
    retire(MOVES.explore_the_objection.id);
  }

  /* ── AND WHO IS ACTUALLY ON THE PHONE ───────────────────────────────
     Below everything they have just done -- a boundary, a question or an
     objection all deserve their answer first -- and above the ladder,
     because every rung on it assumes the answers are worth something, and
     an answer from somebody whose job you do not know is worth nothing.

     Only when NOBODY has said who they are. It stops the moment they do,
     which is what keeps it from becoming another thing asked twice, and it
     is spendable like every other move for the case where they will not
     say. Explicit no-authority is handled far above this: once they have
     told you it is not their call, the move is to reach whoever it is,
     not to keep asking their name. */
  /* ── TWO CONDITIONS, AND BOTH ARE ABOUT NOT NAGGING ────────────────
     There has to be a conversation to establish this in. Offered against
     a closing pleasantry -- "No worries. Thanks for calling." -- asking
     who they are is not a next best action, it is a non-sequitur, and on
     a real call it fired five turns running against exactly that.

     And it is capped on RECOMMENDATIONS, not just attempts. Every other
     move retires when he tries it and it fails; this one he may simply
     never ask, and a standing fact that never gets acted on must not
     become the thing he is told every turn until the words run out. Told
     three times and not asked, it stops asking. */
  /* `none` is on this list, and it has to be: "Yes it is." is somebody
     confirming you have the right place and is exactly the moment to ask
     who they are. It reads the same as "No worries. Thanks for calling.",
     which is not -- but what separates those two is that he has already
     said goodbye, and the exit gate above owns that. The protection
     against nagging is the cap below, not a narrower list here. */
  /* `corrected_founder` is on this list because nothing above handles it:
     being corrected reaches the objection gate through recorded state, and
     when no objection was recorded it falls straight to the ladder. Left
     off, a prospect who corrected the founder silently skipped
     establishing who they were -- which on a real call meant identity was
     never asked for three turns and then asked at the door. */
  const STILL_TALKING = ['disclosed', 'asked_question', 'confused', 'objected',
    'showed_interest', 'corrected_founder', 'none'];
  const askedWhoAlready = seenByMove[MOVES.identify_the_person.id] || 0;
  if (identityUnknown && STILL_TALKING.includes(did)
    && askedWhoAlready < SPENT_AFTER && !spent(MOVES.identify_the_person.id)) {
    return out(MOVES.identify_the_person, {
      subject: { kind: 'person' },
      because: [because('nobody has said who is on the phone', r.said || null,
        typeof r.atSeq === 'number' ? r.atSeq : null)] });
  }
  if (identityUnknown && askedWhoAlready >= SPENT_AFTER) retire(MOVES.identify_the_person.id);

  /* ── HE ASKED SOMETHING THEY HAD ALREADY ANSWERED ───────────────────
     BELOW the three gates above, and that placement is the whole point.
     This sat with the fault branches, where `fault === 'question_repeated'`
     still belongs -- but reached live from the classifier it outranked the
     open objection, the confusion and the direct question, all of which the
     file's own comments declare outrank everything under them. One
     `repetition` label and the founder was told to build on "the answer
     they already gave" while the wording layer quoted the prospect's own
     unanswered question back at him.

     The label itself is current, not stale: the runner reassigns it every
     turn. It was only ever in the wrong place. */
  if (r.response === 'repeated') {
    const answered = (s.answeredQuestions || []).filter((q) => q.answer && !q.refused);
    const last = answered.length ? answered[answered.length - 1] : null;
    return out(MOVES.build_on_their_answer, {
      subject: last ? { kind: 'answer', text: last.answer, question: last.question } : { kind: 'answer' },
      because: last
        ? [because('they already answered this', last.answer, last.answeredAtSeq)]
        : [because('this question was asked before', null, null)] });
  }

  /* 5. THE LADDER. Each rung is what is NOT yet established. */
  /* WHICH UNKNOWN THIS MOVE IS ABOUT. A move may legitimately persist --
     the same rung can be right for several turns running -- but building
     the same question around the SAME unknown every time is exactly how the
     rail turned into wallpaper. Walking the list means a persisting move
     still asks something new, and it walks it from real state (how long
     THIS move has been the answer) rather than a counter that ticks on
     anything that moves. */
  const rung = (move, factText) => {
    const sameAgain = memory && memory.lastMoveId === move.id ? ranFor : 0;
    const target = unknowns.length ? unknowns[sameAgain % unknowns.length] : null;
    const top = (s.qualification && s.qualification.basis || []).slice(-1)[0] || null;
    return out(move, {
      subject: { kind: 'unknown', text: target ? target.text : null },
      because: [because(factText, top ? top.evidence : null, top ? top.atSeq : null)]
        .concat(lastDisclosed(s) ? [because('they have told you this much',
          lastDisclosed(s).text, lastDisclosed(s).atSeq)] : []) });
  };

  /* ── WHAT HAS ACTUALLY BEEN EARNED ────────────────────────────────
     `qualification.level` used to be the only thing the ladder read, and on
     real calls it barely moves: a thirty-turn call with thirteen answered
     questions and fourteen disclosed facts finished at level 0 with an
     empty basis, so the rail offered `establish_situation` thirty times.

     That gate is not repaired here — it has its own fix, with its own
     before-and-after, because the scored review reads it too. What changes
     is that it stops being the ONLY evidence. Somebody who has answered a
     prepared question, or twice told you at length how the place runs, has
     established their situation whatever the vocabulary list made of it.

     ONLY THIS RUNG IS COMPENSATED, and the reason is a hard one. The move
     it promotes to, `find_the_problem`, ASKS whether any of it hurts — it
     asserts nothing. Every rung above depends on a problem having been
     admitted, and inferring that from "they talked a lot" would be the
     engine inventing pain, which is the one thing the wording layer is
     forbidden to do and the decision layer must not do either. */
  const situationKnown = qual >= 1 || (ev.answered || 0) >= 1
    || (ev.substantive || 0) >= SUBSTANTIVE_FOR_SITUATION;

  /* ── THE RUNGS, IN ORDER, EACH WITH ITS OWN THREE GOES ────────────
     Written as a cascade rather than a chain of returns, because the move
     a spent rung escalates TO must itself be able to be spent. The first
     version returned `find_the_problem` from inside the
     `establish_situation` branch, so find_the_problem never reached its own
     check: measured on a twelve-turn call where the prospect declined
     everything, it ran for nine consecutive turns. The escalation looked
     like progress for exactly one turn and then froze one rung higher than
     before.

     Take the first rung that has not been asked every way it can be asked.
     Retire the ones passed over, so the decision is carried rather than
     recomputed. When they are all spent there is nothing left to earn, and
     saying so is the honest move. */
  const held = (s.qualification && s.qualification.basis || []).slice(-1)[0] || null;

  /* QUALIFIED AND INVITED, so the ladder has nothing left to establish. */
  if (perm && qual >= 4) {
    return out(MOVES.ask_for_next_step, {
      subject: { kind: 'problem', text: held ? held.evidence : null },
      because: [because('the need is established', held ? held.evidence : null, held ? held.atSeq : null),
        because('and they invited the offer', s.pitchPermission.evidence, s.pitchPermission.atSeq)] });
  }

  const rungs = [];
  if (!situationKnown) rungs.push([MOVES.establish_situation, 'nothing is established yet']);
  if (qual < 2) rungs.push([MOVES.find_the_problem, situationKnown
    ? 'you know how it works, not whether it hurts'
    : 'they will not describe the setup, so ask what it costs instead']);
  /* A problem is on the record and they have not asked to hear the answer.
     Sits above intent for the same reason it always has: assuming the right
     to explain is the commonest way a good call is lost. */
  if (qual >= 2 && !perm) rungs.push([MOVES.earn_permission, null]);
  /* ONLY WHILE INTENT IS STILL UNKNOWN. Pushed unconditionally it sat ahead
     of `qualify_timing` in the list and won at level three -- asking
     somebody who has just said they want it changed whether they want it
     changed. The cascade takes the first rung that is not spent, so an
     entry that is always present is an entry that always wins. */
  if (qual < 3) {
    rungs.push([MOVES.establish_intent, qual >= 2
      ? 'they have a problem, but not stated they want it different'
      : 'nothing in it is a problem to them, so find out whether they would change it anyway']);
  }
  /* LEVEL FOUR IS TIMING AND AUTHORITY ESTABLISHED -- it is what the rung
     exists to get. Pushed at `>= 3` it was offered to somebody who had
     already named when, who decides, or what it is worth, asking them for
     the thing they had just given. */
  if (qual === 3) rungs.push([MOVES.qualify_timing, 'they want it different, but when and who decides is unknown']);
  /* ── THEY ASKED TO HEAR IT, SO THERE IS SOMETHING LEFT TO DO ────────
     Without this the cascade ran out of discovery rungs and fell through to
     `leave_it_there` -- telling a founder to close it out politely at
     somebody who has a problem AND has asked what he does. That is the
     worst advice in the file, given at the best moment in the call.

     Last in the list on purpose. It is reached only when the rungs above it
     are spent, which cannot happen without memory, so the replay and review
     path (which passes none) still takes the same rung it always did. */
  if (perm && qual >= 2) {
    rungs.push([MOVES.make_the_offer, 'they have a problem and they have asked to hear the answer']);
  }

  for (const [move, why] of rungs) {
    if (spent(move.id)) { retire(move.id); continue; }
    if (move.id === MOVES.earn_permission.id) {
      return out(MOVES.earn_permission, {
        subject: { kind: 'problem', text: held ? held.evidence : null },
        because: [because('a problem is established', held ? held.evidence : null,
          held ? held.atSeq : null),
        because('they have not asked to hear the offer', null, null)] });
    }
    /* Both of these are ABOUT the problem they named, not about an open
       unknown, so they take the subject `rung` cannot give them. */
    if (move.id === MOVES.make_the_offer.id) {
      return out(MOVES.make_the_offer, {
        subject: { kind: 'problem', text: held ? held.evidence : null },
        because: [because('they invited the offer', s.pitchPermission.evidence, s.pitchPermission.atSeq)]
          .concat(held ? [because('against this', held.evidence, held.atSeq)] : []) });
    }
    return rung(move, why);
  }

  /* Every rung asked every way it can be asked, and none of them opened
     anything up. Continuing is the mistake going on longer. */
  return out(MOVES.leave_it_there, {
    because: [because('nothing on the ladder has opened up',
      held ? held.evidence : null, held ? held.atSeq : null)]
      .concat(lastDisclosed(s) ? [because('this is all they have given you',
        lastDisclosed(s).text, lastDisclosed(s).atSeq)] : []) });
}
