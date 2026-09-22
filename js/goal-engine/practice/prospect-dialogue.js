/* ════════════════════════════════════════════════════════════════════════
   THE PROSPECT'S MOUTH — and only their mouth.

   The behaviour engine has already decided everything that matters by the
   time this runs: how resistant they are, whether a need exists, whether the
   founder earned permission to pitch, whether the call is over. A language
   model is handed that decision and asked to say it like a person would.

   So the validator here is not about tone. It is about AUTHORITY. A reply
   that accepts a close the founder did not earn, confirms an unknown, keeps
   talking after the engine ended the call, coaches the founder, or CLAIMS a
   capability the hidden scenario withholds -- final decision authority, or a
   transfer the draw forbids -- is rejected -- not repaired, and never
   repaired by asking a model again. The deterministic line is used instead,
   which is always available and never wrong about state.

   WP4: the capability check is a CONTRADICTION GUARD, not a disclosure
   engine. It fires only on an EXPLICIT claim; a neutral or evasive reply is
   valid under every hidden role, because compelling disclosure would reveal
   the very thing this file exists to keep hidden. It runs on MODEL output
   only -- the deterministic floor is engine-authored, not model drift, and
   is trusted by construction, checked separately by deriveCapabilities' own
   caller for its one dynamic passthrough (see prospect-dialogue.js's own
   floor section) rather than by running this validator on the floor itself,
   which would let it reject its own fallback with nothing left beneath it.
   ══════════════════════════════════════════════════════════════════════ */

import { timePressureLine } from './situation-state.js';
/* Who answered, and what is actually true about this call. Server-side. */
import { roleBrief } from './role-brief.js';
/* What this prospect could tell them, and whether they have earned it. */
import { disclosureLines } from './disclosure-ledger.js';
/* The exact phrasing post-call already trusts for "offered a transfer" --
   reused rather than re-defined, so a claim this file rejects and evidence
   B later admits can never disagree about what "offering a transfer" means. */
import { ROUTING_OFFER } from './evidence-gates.js';

export const PROSPECT_REPLY_SCHEMA = Object.freeze({
  name: 'prospect_reply',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'tone', 'simulatedFactsIntroduced'],
    properties: {
      reply: { type: 'string', description: 'What this person says next. One or two sentences.' },
      tone: { type: 'string',
        enum: ['receptive', 'neutral', 'guarded', 'skeptical', 'resistant', 'disengaging'],
        description: 'Descriptive only. It does not change anything.' },
      simulatedFactsIntroduced: {
        type: 'array',
        items: { type: 'string', description: 'Any private detail invented for this rehearsal.' },
      },
    },
  },
});

export const TONES = Object.freeze(['receptive', 'neutral', 'guarded', 'skeptical', 'resistant', 'disengaging']);

/* Tone the engine's posture implies, used to check the model is not painting
   a resistant prospect as receptive. */
/* Deliberately overlapping. An open prospect can still be guarded on one
   point — correcting someone who misquoted them is a guarded act however
   well the call is going — and a guarded one can answer in a flat neutral
   tone. Narrow bands rejected perfectly good lines: "No, I said referrals"
   was refused for sounding guarded during a friendly call. What must never
   pass is a RESISTANT prospect sounding receptive, and that still cannot. */
/* ── P1-3: WHICH TONES A STATE CAN HONESTLY PRODUCE ───────────────────
   Validation only. This table is read at exactly one place, the tone gate in
   validateProspectReply; `allowedResponsePosture` itself is what reaches the
   prompt, and the posture BANDS in prospect-behaviour.js are untouched, so
   nothing the prospect is told about itself changes here.

   Two gaps, both measured in the 100-turn corpus, which produced 7 of its 10
   schema rejections -- every one of them a reply that read correctly and was
   thrown away for the deterministic floor:

   1. `resistant` was legal only at `guarded` (resistance >= 0.70), so a
      prospect at 0.64-0.68 pushed hard by a closing tactic could not sound
      resistant. Three rejections sat in that gap: "Sorry, don't hold
      anything for us." at 0.68, "Sorry, I'm not agreeing to anything off a
      call like this." at 0.64, "No, not on this call." at 0.67. `measured`
      spans 0.45-0.69 and is already the noticeably-guarded band -- a person
      there declining firmly is not contradicting their state.

   2. `disengaging` was legal ONLY under `closing`, which requires the engine
      to have ALREADY ended the call. There was therefore no state in which a
      prospect could begin winding down -- disengagement could only be
      reported after the fact, never as it happened. Two rejections sat in
      that gap, both at 0.47: "Right, okay. I think you've got the wrong
      number." and "Alright, please do."

   DELIBERATELY NOT WIDENED TO `open`. Below 0.45 the engine records a
   prospect who is not resistant, and letting one turn resistant or
   disengaging from there is exactly the "too easy" failure this is meant to
   avoid. `guarded` remains available under `open`, which is the honest label
   for a polite decline from a warm state -- so the register is still
   reachable without claiming a hostility the state does not support. */
const POSTURE_TONES = Object.freeze({
  open: ['receptive', 'neutral', 'guarded'],
  measured: ['neutral', 'guarded', 'skeptical', 'receptive', 'resistant', 'disengaging'],
  guarded: ['neutral', 'guarded', 'skeptical', 'resistant', 'disengaging'],
  closing: ['resistant', 'disengaging', 'guarded', 'neutral'],
});

/* ── HOW IT IS SAID, NEVER WHAT IS SAID ───────────────────────────────
   Delivery only, read from state the engine has ALREADY decided. Nothing
   here widens what may be disclosed -- `informationAllowed` and the MUST
   NOT list still own that entirely.

   Hesitation is POSITIONAL: before a refusal or a hedge, never before
   something given freely. A prospect who says "um" every turn is not more
   human, only noisier.

   DEVICES ARE ATTACHED TO CONDITIONS, NOT OFFERED AS A MENU. The first
   version listed four and let the model choose; it took the cheapest one
   every time, so fillers fired on 80% of guarded turns while
   self-correction and unfinished speech never fired at all (0/17 each,
   measured). Naming the moment a device belongs to is what makes the rare
   ones happen -- and costs fewer tokens than the menu did. */
function deliveryDirectives(turn, opening = false, hasOffer = false) {
  const s = (turn && turn.prospectStateAfter) || {};
  const situation = s.situation || null;
  const attention = situation && typeof situation.attention === 'number' ? situation.attention : 0.7;
  const posture = turn && turn.allowedResponsePosture;
  const over = typeof s.overreached === 'number' ? s.overreached : 0;
  const rep = typeof s.repeated === 'number' ? s.repeated : 0;
  const out = [];

  /* PACE — a hard ceiling, because "keep it brief" was read as a
     suggestion and produced 10-word replies under a 13-word baseline.

     THRESHOLDS ARE SET AGAINST THE LIVE RANGE, NOT THE STATIC TABLE.
     situation-state.js starts `rushed` at 0.32, but applySituationTurn
     drifts attention upward from the first turn: measured live it was
     0.440 -> 0.560 -> 0.680, so a `< 0.4` gate never fired once in a real
     call and the clip it guards was dead code. Read from the table alone
     this looked correct, which is exactly why it had to be measured. */
  /* THE CEILING IS FOR THE ANSWER, NOT INSTEAD OF IT. Measured on staging:
     of 105 turns where the ledger had granted an earned fact, 37 were also
     told "UNDER 8 WORDS ... break off mid-thought" -- and this block is
     printed BELOW both the imperative and the allowance, so it had the last
     word on all of them. The earlier fix that made brevity offer-aware
     gates at `attention < 0.4`, but the comment above records that 0.4
     never fires in a live call; the real constraint is this one at 0.50, and
     only 11 of those 37 turns were ever softened. That gap is why an earned
     fact still lost.
     Still brief -- a distracted person does not deliver a paragraph. What
     changes is that the budget is spent ON the answer, and the two clauses
     that actively forbid delivering it (a fragment, breaking off mid-thought)
     are dropped when there is something to say. */
  if (attention < 0.50) {
    out.push(hasOffer
      ? 'RUSHED: ONE short sentence, and it IS the answer. No preamble, no question back.'
      : 'RUSHED: UNDER 8 WORDS. A fragment beats a sentence. No question back. '
        + 'If it runs long, break off mid-thought rather than finishing tidily.');
  } else if (attention < 0.68) {
    out.push(hasOffer
      ? 'HALF-LISTENING: under 20 words, and the answer comes first.'
      : 'HALF-LISTENING: under 15 words.');
  }

  if (posture === 'open') {
    out.push('OPEN: answer straight away. No hesitation marker at all.');
  } else if (posture === 'guarded' || posture === 'measured') {
    /* NOT ON THE OPENER. Hesitation is positional by design -- it belongs
       before a refusal or a hedge -- and picking up the phone is neither.
       Emitting it unconditionally put "Um," in front of 6 of 10 measured
       openers and made the first thing the founder hears the most
       repetitive line in the call. */
    out.push(opening
      ? 'GUARDED: you do not know who this is yet. No hesitation marker -- you have nothing to hedge about yet.'
      : 'GUARDED: ONE hesitation marker before declining or hedging -- never before something '
        + 'you give freely. When you half-answer, correct yourself mid-sentence once, like '
        + '"we do, well, we used to".');
  } else if (posture === 'closing') {
    out.push('DONE: flat. No hesitation, no question, nothing offered.');
  }

  if (over >= 2 || rep >= 2) {
    out.push('PUSHED AGAIN: fewer words than your last reply, nothing new, and let it trail off unfinished.');
  } else if (over >= 1) {
    out.push('PUSHED ONCE: shorter and vaguer than your last reply.');
  }

  return out;
}

/* ── PROSPECT-SIDE VARIANCE ───────────────────────────────────────────
   Three identical staging calls produced the SAME SENTENCE three times
   with only the hesitation word rotated:
     "Um, what do you mean by overflow?" / "Um, what do you mean by
      front-desk overflow?" / "Well, what do you mean by overflow?"
   The filler variety added earlier was cosmetically hiding structural
   identity rather than creating any.

   These rotate the SHAPE of a turn -- whether the prospect answers then
   probes, answers and stops, or probes before answering. They say nothing
   about WHAT may be disclosed: `informationAllowed` and the MUST NOT list
   still own that completely, so this cannot leak a fact or soften a
   refusal. Deterministic authority is untouched -- the state engine never
   sees this, and the same state still produces the same state.

   Seeded from the caller's per-turn id, so a turn is reproducible while
   two separate calls diverge. With no seed the shape is index 0 and every
   existing test stays deterministic. */
/* MEASURED: 75% of a 40-turn corpus ended in a question mark, against four
   shapes of which only one says not to volley one back. A prospect who
   always hands the question back is a prospect who is never actually
   answering, and it is the loudest tell in the corpus after the repeated
   refusal.

   The four added shapes are the ways real answers are imperfect. They are
   not personality -- the same person gives all five on different turns
   depending on what they were asked and how much of their attention is
   free. Measured absence: self-correction and trailing off were 0% of 40
   turns, which is not how anyone speaks. */
/* A SHAPE MUST NOT BE QUOTABLE. Measured in the after-corpus: the shape
   "answer first, then ask what they are getting at" produced the literal
   clause "what are you getting at" in three separate turns -- the shape
   table had become a new source of the repetition it exists to prevent.
   These are written as descriptions of a MOVE with no speakable clause in
   them, so there is nothing to copy. */
const TURN_SHAPES = Object.freeze([
  'SHAPE: answer, then put the question of why they are asking back to them.',
  'SHAPE: answer and stop there. No question back this turn.',
  'SHAPE: make them define their terms before you give anything.',
  'SHAPE: give the shortest true answer and leave it at that.',
  'SHAPE: answer only PART of what they asked, and do not mention the rest. No question back.',
  'SHAPE: answer a NEARBY question rather than the one they asked, as though you half-heard it.',
  'SHAPE: hedge instead of committing to a number. You would have to check. No question back.',
  'SHAPE: begin one answer, break off, and replace it with a more accurate one.',
]);

/* ── THE OPENER NEEDED ITS OWN TABLE ──────────────────────────────────
   TURN_SHAPES could not differentiate the first turn, and measurably did
   not: "Um, what's this regarding?" was still the commonest reply in the
   corpus after shape rotation shipped. Every shape above presupposes there
   is something to ANSWER, and on a cold pickup there is not -- so all four
   collapse onto the same move, "ask what this is about".

   These are the things a real person actually does when the phone goes and
   they do not know the caller. They vary the MOVE, not the disclosure:
   nothing here reveals a fact, and the posture, pace and MUST NOT list
   still apply on top exactly as they do to any other turn. */
const OPENER_SHAPES = Object.freeze([
  'SHAPE: confirm they have reached the right place, then ask what it is about.',
  'SHAPE: ask who is calling, before anything else.',
  'SHAPE: just ask what it is about. Nothing else.',
  'SHAPE: answer only the question they actually asked, then stop.',
  'SHAPE: give a bare acknowledgement and let them explain themselves.',
  'SHAPE: say you are in the middle of something, then ask what they want.',
]);

/* ── THE SHAPE MAY NOT OUTRANK AN EARNED FACT ─────────────────────────
   SHAPE is the LAST behavioural line in the prompt -- below the imperative,
   the allowance and the delivery ceiling -- and it was chosen by
   hashOf(turnId) alone, which cannot see whether the ledger granted
   anything. Measured on staging: 37 of 50 replies ended in an ask-back, and
   three shapes forbade the answer outright ("before you give anything",
   "hedge instead of committing", "answer a NEARBY question rather than the
   one they asked" -- the last being the mechanism behind a substitution rate
   that ROSE from 14.3% to 21.9% once the prospect became willing to answer
   at all).

   These tables are INDEX-ALIGNED with the two above. The hash is untouched,
   so the same turn still draws the same conversational MOVE and the run-to-
   run variation is exactly what it was; what changes is only that the
   move's answer-blocking clause is replaced by an answer-FIRST reading of
   the same move. Tone, brevity, hesitation, resistance and the ask-back all
   survive -- they simply follow the answer instead of standing in for it.
   Where a shape already answers first, the two tables hold the same string
   and nothing changes at all. */
const TURN_SHAPES_WITH_FACT = Object.freeze([
  'SHAPE: answer, then put the question of why they are asking back to them.',
  'SHAPE: answer and stop there. No question back this turn.',
  'SHAPE: give the answer you have, THEN make them define their terms before you add anything beyond it.',
  'SHAPE: give the shortest true answer and leave it at that.',
  'SHAPE: answer with the note you have and nothing beyond it. Do not volunteer the rest. No question back.',
  'SHAPE: as though you half-heard them: give the note you have, then check you got the question right.',
  'SHAPE: give the note you have plainly, then hedge on anything BEYOND it. You would have to check the rest. No question back.',
  'SHAPE: begin one answer, break off, and replace it with the note you have, which is the accurate one.',
]);

const OPENER_SHAPES_WITH_FACT = Object.freeze([
  'SHAPE: confirm they have reached the right place, answer what they asked, then ask what it is about.',
  'SHAPE: answer what they asked, then ask who is calling.',
  'SHAPE: answer what they asked in one line, then ask what it is about.',
  'SHAPE: answer only the question they actually asked, then stop.',
  'SHAPE: acknowledge them, answer what they asked, then let them explain themselves.',
  'SHAPE: say you are in the middle of something, answer them anyway, then ask what they want.',
]);

const hashOf = (seed) => {
  const s = String(seed);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return Math.abs(h);
};

/* `opening` is decided by whether the prospect has spoken yet, not by a
   turn counter -- the counter lives on state the dialogue layer is not
   given, and a retry would have reset it anyway. */
function shapeFor(seed, opening, hasOffer = false) {
  const table = opening
    ? (hasOffer ? OPENER_SHAPES_WITH_FACT : OPENER_SHAPES)
    : (hasOffer ? TURN_SHAPES_WITH_FACT : TURN_SHAPES);
  if (!seed) return table[0];
  return table[hashOf(seed) % table.length];
}

/* Variety rules, not a device list. Refusal SHAPE is called out separately
   because the measured failure was four near-identical refusals with the
   synonyms swapped -- rewording a template is not varying it. */
/* The em-dash rule is not style policing. Measured at 47.5% of turns in a
   40-turn corpus -- nearly one line in two -- against a rate in real speech
   transcripts of approximately never, because it is a punctuation mark
   people write and do not say. Same for the three-item list: it is how a
   model offers options and not how someone on a phone does.

   The "never refuse twice in the same words" line below was already here
   when the corpus measured six near-identical refusals. It is kept because
   it does no harm, but the fix for that is the disclosure ledger, not this
   sentence. An instruction the model has already ignored is not evidence
   about what it will do next time. */
const SPEECH_TEXTURE = [
  'SPOKEN, NOT WRITTEN:',
  '- Vary the hesitation word (um, well, look, sorry, hm, I mean). Never open two replies alike.',
  '- Never refuse twice in the same words. Change the SHAPE, not the synonyms: a flat no, a reason, '
  + 'a question back, a deferral, a half-answer.',
  '- Never name your feeling. Show it by giving less.',
  '- NO DASHES. Write the way it would be said: a full stop, a comma, or start a new sentence. '
  + 'Never join two thoughts with a dash of any kind.',
  '- Never offer a three-item list ("calls, bookings, or admin"). Pick one and say it.',
  '- Not every reply is a question. Plenty of turns just answer, or just stop.',
  /* MEASURED AT 2.9% OF 70 TURNS, against a shape table where one shape in
     eight asks for exactly this. Speech is full of half-finished sentences
     and the corpus had almost none, which is the last obviously-written tell
     left after the dashes went. Stated as a MECHANISM and not as an example
     on purpose: the ledger measured verbatim copying of any quotable line
     given to this model, so a sample repair would come back word for word.
     Ellipsis is explicitly allowed because the dash ban above removed the
     other way of showing a broken sentence. */
  '- Sentences do not always come out right first time. You can begin one, change your mind '
  + 'part-way, and finish it differently. You can let one trail off unfinished with "...".',
].join('\n');

/* ── what the model is given ──────────────────────────────────────────
   Only what is needed to phrase THIS turn. Not the whole state, and never
   the levers. */
export function buildProspectInput({ turn, context = {}, history = [], simulatedSoFar = [],
  variantSeed = null, scenario = null, disclosure = null }) {
  const p = context.prospect || {};
  const role = (context.contactRole && context.contactRole.role) || 'someone who works there';
  const observed = (context.evidence && context.evidence.observed) || [];
  const situation = (turn.prospectStateAfter && turn.prospectStateAfter.situation) || null;

  /* One derivation, used by both the delivery block and the shape table. */
  const opening = !history.some((h) => h.speaker === 'prospect');
  /* Whether the ladder has actually earned this turn a fact to say. Read in
     three places below, all of which used to compete with it. */
  const hasOffer = !!(disclosure && Array.isArray(disclosure.offer) && disclosure.offer.length);

  const system = [
    `You are ${p.name || 'a local business'}. You are ${role}, answering an unexpected sales call.`,
    'You are a real person, not an assistant. Never coach, evaluate, praise or advise the caller.',
    'Never mention practice, rehearsal, roleplay, difficulty or how you are behaving.',
    '',
    /* ── THE MOMENT, NOT JUST THE TEMPERAMENT ─────────────────────────
       `allowedResponsePosture` below is mode's line -- how they generally
       are. This is situation's: what is going on around them right now,
       which can make a short reply from an otherwise willing person the
       honest one. Attention low enough replies get tighter than the usual
       one-or-two-sentence floor, because a person with a minute to spare
       does not deliver a paragraph. */
    /* ── A SHORT REPLY IS STILL AN ANSWER ─────────────────────────────
       At low attention this said "ONE short sentence", `signalDue` said "say
       you are short on time", and the disclosure block said "work in exactly
       one of these facts". Three demands, one sentence -- and across six real
       calls the fact was what got dropped: five of eighteen disclosures never
       reached speech at all, the prospect answering a question it had just
       been handed the answer to with "what is this regarding?".

       Being busy makes someone BRIEF. It does not make them stop answering a
       question they know the answer to and re-greet the caller instead. So
       when a fact has been earned, the one sentence has to carry it. */
    (situation && situation.attention < 0.4)
      ? (hasOffer
        ? 'Reply with ONE short sentence. You do not have room for more right now -- so that one sentence is the answer, not a deflection.'
        : 'Reply with ONE short sentence. You do not have room for more right now.')
      : 'Reply with ONE or TWO sentences. People on unexpected calls are short.',
    'Do not repeat the caller\'s sentence back. Do not explain your own objection as though teaching it.',
    /* Hesitation moved to deliveryDirectives, which says WHEN rather than
       merely permitting it; only the disclosure half belongs here now. */
    'You may answer only part of a question, or ask what they mean.',
    situation ? `RIGHT NOW: ${situation.attention >= 0.65 ? 'you have room for this call.' : (situation.attention >= 0.4 ? 'you can talk, but you are not fully free.' : 'your attention is stretched thin.')}` : '',
    /* The time signal yields to an earned fact rather than competing with it.
       A real person short on time says the useful thing FIRST and mentions
       the clock around it; they do not withhold what they know in order to
       announce that they are busy. */
    (situation && situation.signalDue && !hasOffer)
      ? 'SAY, NATURALLY AND BRIEFLY, THAT YOU ARE SHORT ON TIME OR ATTENTION RIGHT NOW -- once, as part of this reply, in your own words (for example "I have only got a minute").'
      : ((situation && situation.signalDue)
        ? 'You are short on time, and you may say so briefly -- but ANSWER FIRST. The note below is the answer.'
        : ''),
    '',
    /* ── WHO ANSWERED, AND WHAT IS ACTUALLY TRUE HERE ─────────────────
       Server-side only. Placed above the turn instruction because it
       constrains what the turn instruction can mean: "answer their question"
       is a different act for someone who cannot answer it. Empty on a call
       with no scenario, so pre-Controlled-Uncertainty behaviour is byte
       identical. */
    ...roleBrief(scenario),
    /* CONTENT, NOT INSTRUCTION. The corpus repeated a refusal six times
       because the model had nothing specific to say; this is the something.
       Placed after the role brief so it is constrained by who answered. */
    ...disclosureLines(disclosure),
    '',
    `HOW YOU FEEL RIGHT NOW: ${turn.allowedResponsePosture}.`,
    `WHAT YOU DO THIS TURN: ${turn.responseInstruction}`,
    turn.activeObjection ? `YOU ARE HOLDING THIS OBJECTION: "${turn.activeObjection}"` : '',
    `HOW MUCH YOU SAY: ${turn.informationAllowed}.`,
    '',
    /* Delivery sits directly under the state it is derived from, so a
       reader of this prompt can see that it restates that state rather
       than adding to it. */
    ...deliveryDirectives(turn, opening, hasOffer),
    shapeFor(variantSeed, opening, hasOffer),
    SPEECH_TEXTURE,
    '',
    'PUBLICLY TRUE ABOUT YOUR BUSINESS — never contradict:',
    ...observed.map((o) => `  - ${o}`),
    simulatedSoFar.length
      ? ['', 'THINGS YOU HAVE ALREADY SAID IN THIS CALL — stay consistent with them:',
        ...simulatedSoFar.map((f) => `  - ${f}`)].join('\n')
      : '',
    '',
    'YOU MUST NOT:',
    turn.closePermission
      ? '  - (a next step is acceptable if they ask for one)'
      : '  - agree to a meeting, a follow-up, or any next step. You are not there yet.',
    '  - claim you need what they are selling unless you have already said so.',
    '  - confirm anything you have not been told is true about your business.',
    turn.exitIntent >= 0.8 || turn.outcomeState === 'not_a_fit'
      ? '  - continue the conversation. Close it politely.' : '',
  ].filter(Boolean).join('\n');

  /* THE OPENING SURVIVES. A flat last-6 window drops the first exchange on
     any call past eight turns, so a prospect stops remembering why the
     caller said they rang -- and starts asking again. The first two turns
     are what the whole call is anchored to, so they are kept and the
     window slides underneath them. Deduplicated by position, so a short
     call is byte-identical to what it was before. */
  const head = history.slice(0, 2);
  const tail = history.slice(-6);
  const merged = history.length <= 8 ? history.slice(-8) : [...head, ...tail];
  const recent = merged.map((h) => ({
    role: h.speaker === 'prospect' ? 'assistant' : 'user',
    content: h.text,
  }));

  return [{ role: 'system', content: system }, ...recent,
    { role: 'user', content: turn.founderText || '' }];
}

/* ── the authority gate ───────────────────────────────────────────────── */
const COACHING = [
  /\bgood (question|point|opener|opening)\b/i, /\bthat( i|'?)s a great\b/i, /\byou should (try|ask|say)\b/i,
  /\bas an ai\b/i, /\blanguage model\b/i, /\bhere'?s (a )?tip\b/i, /\bnice (job|work)\b/i,
  /\bwell done\b/i, /\broleplay\b/i,
  /\bkeep it up\b/i, /\btry (framing|asking)\b/i,
  /* ── THESE THREE ARE ORDINARY BUSINESS ENGLISH FIRST ────────────────
     `practice`, `score` and `feedback` were bare word matches, and every
     one of them refused a reply a real prospect would obviously give. A
     veterinary PRACTICE, a dental PRACTICE, a manager who gets good
     FEEDBACK from clients, a buyer who would SCORE one supplier against
     another -- measured live, 5 of 5 plausible business replies were
     rejected outright.

     The cost was invisible and therefore worse than a crash: a rejected
     reply silently falls back to the deterministic floor, so the prospect
     went flat and generic at exactly the moment it was being most natural
     about its own business. VISION's own fixtures are a veterinary
     practice and a dental practice, so this fired constantly.

     Each now has to appear in a REHEARSAL sense to be refused. Breaking
     character is still caught; describing your own business is not. */
  /\b(this is|that was|just|good|nice|more) practice\b/i,
  /\bpractice (session|call|run|mode|scenario)\b/i,
  /\b(your|my|some) (score|feedback)\b/i,
  /\bfeedback (on|for) (you|your)\b/i,
  /\bscored? (you|well|highly|badly)\b/i,
];
const ACCEPTS_CLOSE = /\b(yes,? (let'?s|we can|sounds good)|book (it|me|us) in|send (it|that) (over|through)|put (something|a time) in|next week works|that works for me|happy to (meet|chat|catch up)|go ahead and send)\b/i;

/* ── WP4: THE THREE CLAIMS THE HIDDEN SCENARIO MAY FORBID ──────────────
   Mirrors ACCEPTS_CLOSE exactly: a few precise, representative phrasings,
   not exhaustive coverage -- narrow by design, so a merely evasive or
   ambiguous reply is never mistaken for an explicit claim. */
const CLAIMS_FINAL_AUTHORITY = /\b(?:i (?:make|can make) (?:that|the|this) (?:final )?(?:call|decision)|i(?:'ll| will)? decide (?:that|this|on that)|that'?s my (?:call|decision)|i(?:'m| am) the (?:one who decides|decision[- ]maker)|i can (?:sign off|approve) (?:that|this|on that)|i(?:'ll| will)? sign off on (?:that|this))\b/i;
const CLAIMS_TRANSFER_COMPLETED = /\b(?:i(?:'ve| have) (?:put you through|transferred you|passed you (?:over|on))|you'?re through (?:now|to (?:them|him|her))|putting you through now|here(?:'s| is) (?:the|our|my) (?:owner|director|manager|partner|boss))\b/i;

/* Derived from the scenario's own drawn axes, never a role name or the
   scenario itself. `authorityClarity` is prompt intensity for HOW the
   model communicates its authority, not a gate on WHAT it may claim, so it
   is deliberately absent from this formula. Not invertible to a role:
   gatekeeper and influencer both produce {false,false,false} under
   transferPath 'none'. */
export function deriveCapabilities(scenario) {
  const role = scenario && scenario.role;
  const transferPath = scenario && scenario.variation && scenario.variation.transferPath;
  return Object.freeze({
    mayClaimFinalDecisionAuthority: role === 'decision_maker',
    mayClaimTransferOffer: transferPath !== 'none' && transferPath != null,
    mayClaimTransferCompletion: transferPath === 'offered_completed',
  });
}
/* Neither withheld nor asserted -- every capability permitted, so a caller
   that does not yet know about capabilities (every existing test fixture,
   every call before WP4) sees no behaviour change. */
export const ALL_CAPABILITIES_PERMITTED = Object.freeze({
  mayClaimFinalDecisionAuthority: true, mayClaimTransferOffer: true, mayClaimTransferCompletion: true,
});

/* THE ONE FUNCTION BOTH CALLERS SHARE -- Boundary A on the model's reply,
   and the deterministic floor's own guard on its one dynamic passthrough
   (the activeObjection line, prep-sheet text and therefore not enumerable
   the way every other floor pool is). Reusing this rather than duplicating
   it is what makes "explicit claim" mean the same thing in both places. */
export function forbiddenCapabilityClaim(text, capabilities = ALL_CAPABILITIES_PERMITTED) {
  const t = String(text || '');
  if (!capabilities.mayClaimFinalDecisionAuthority && CLAIMS_FINAL_AUTHORITY.test(t)) {
    return 'claimed_final_decision_authority';
  }
  if (!capabilities.mayClaimTransferOffer && ROUTING_OFFER.test(t)) {
    return 'claimed_transfer_offer';
  }
  if (!capabilities.mayClaimTransferCompletion && CLAIMS_TRANSFER_COMPLETED.test(t)) {
    return 'claimed_transfer_completion';
  }
  return null;
}
const CLAIMS_NEED = /\b(we (do )?need (that|this|help|more)|we'?re desperate|we are looking for (exactly )?that|that'?s exactly what we need|we want more (patients|customers|clients))\b/i;
const URGENCY_INVENTION = /\b(we just (opened|lost|had)|our (contract|agency) (just )?(ended|expired)|we'?re (about to|just about to) (launch|open)|as it happens we)\b/i;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function validateProspectReply(parsed, { turn, context = {}, maxSentences = 3, maxChars = 320,
  /* WP4: absent by default -- every existing caller keeps today's exact
     behaviour. Only the live turn handler, which alone knows the drawn
     scenario, ever passes anything narrower. */
  capabilities = ALL_CAPABILITIES_PERMITTED,
  /* P1-2: what the disclosure ledger authorised for THIS turn, as returned
     by admissibleDisclosures(). Absent by default -- every existing caller,
     and every call on a session with no ledger, keeps today's exact
     behaviour, because an absent ledger authorises nothing. */
  disclosure = null } = {}) {
  const problems = [];
  const bad = (code, detail) => problems.push({ code, detail: detail || null });

  if (!parsed || typeof parsed !== 'object') return { valid: false, problems: [{ code: 'not_an_object' }] };
  const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
  if (!reply) bad('empty_reply');
  if (!TONES.includes(parsed.tone)) bad('tone_unknown', String(parsed.tone));
  if (!Array.isArray(parsed.simulatedFactsIntroduced)) bad('facts_not_a_list');

  /* SHORT. A prospect who answers an unexpected call in three paragraphs is
     not a prospect. */
  if (reply.length > maxChars) bad('too_long', `${reply.length} chars`);
  const sentences = reply.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 1);
  if (sentences.length > maxSentences) bad('too_many_sentences', String(sentences.length));

  if (COACHING.some((re) => re.test(reply))) bad('coaching_or_out_of_character');

  /* ── THE PROSPECT MAY NOT REWRITE THE TRANSCRIPT ────────────────────
     Denying having said something is only ever coherent as a reply to
     the founder ATTRIBUTING a statement to them. Where the founder made
     no such attribution, "I didn't say that" is a claim about a record
     the model is guessing at, and on a misclassification it denies the
     prospect's own words.

     This is the general guard, and it is here rather than in the prompt
     because the prompt is advice and this is a rule. Both earlier paths
     -- the deterministic floor's canned denial and instructionFor's
     "You did not say that." -- were fixed at their own sources, and a
     blind mystery-user call then produced the same contradiction a third
     way: the MODEL chose a speech-denial by itself ("Well, I didn't say
     that.", reply_source `model`, real session 7f66852f) after the
     founder had attributed nothing. Fixing instructions cannot reach
     that. Rejection falls back to the deterministic floor, which is now
     coherence-safe by construction, so the two fixes compose.

     A genuine correction survives: if the founder says "you said X" or
     "like you mentioned", the attribution is there and the denial is a
     legitimate -- often necessary -- move. */
  const DENIES_SPEECH = /\b(?:i\s+(?:never|didn'?t|did not)\s+(?:say|said|tell|mention)|(?:that'?s|thats)\s+not\s+what\s+i\s+(?:said|say)|i\s+said\s+no\s+such)/i;
  const FOUNDER_ATTRIBUTED = /\b(?:you\s+(?:said|say|says|mentioned|told|stated|indicated)|you'?ve\s+(?:said|mentioned|told)|(?:like|as)\s+you\s+(?:said|mentioned)|according\s+to\s+you|your\s+(?:point|words)\b)/i;
  if (DENIES_SPEECH.test(reply) && !FOUNDER_ATTRIBUTED.test(String(turn.founderText || ''))) {
    bad('denied_speech_without_attribution');
  }

  /* THE LOAD-BEARING CHECKS. Each one is a decision the engine already made
     and the model is not permitted to revisit. */
  if (!turn.closePermission && ACCEPTS_CLOSE.test(reply)) bad('accepted_close_without_permission');
  if (CLAIMS_NEED.test(reply) && (turn.prospectStateAfter?.needDiscovered ?? 0) < 0.5) {
    bad('invented_need');
  }
  if (URGENCY_INVENTION.test(reply)) bad('invented_urgency_event');

  /* ── WP4: THE MODEL MAY NOT CLAIM WHAT THE HIDDEN SCENARIO WITHHOLDS ──
     Symmetric to accepted_close_without_permission just above: a decision
     the engine (here, the drawn scenario) already made, that the model is
     not permitted to revisit. Fires only on an explicit claim -- silence,
     evasion and ambiguity all pass, on purpose. */
  const forbidden = forbiddenCapabilityClaim(reply, capabilities);
  if (forbidden) bad('simulator_consistency', forbidden);

  /* A resistant prospect does not sound receptive. */
  const allowedTones = POSTURE_TONES[turn.allowedResponsePosture] || TONES;
  if (parsed.tone && !allowedTones.includes(parsed.tone)) {
    bad('tone_contradicts_state', `${parsed.tone} under ${turn.allowedResponsePosture}`);
  }

  /* The engine ended the call. The model does not get to continue it. */
  const ended = turn.prospectStateAfter && turn.prospectStateAfter.ended;
  /* "Goodbye" is one word, so \bbye\b never matched the commonest sign-off
     there is -- and a model ending the call politely was told it had
     continued past the exit. Widened here, not in the tone gate: what tone
     is allowed under `closing` was already correct. */
  if (ended && !/\b(bye|goodbye|good luck|thanks|thank you|all the best|take care|no thanks|not interested|busy|go)\b/i.test(reply)) {
    bad('continued_after_exit');
  }

  /* ── AN UNKNOWN STAYS UNKNOWN unless the engine permitted invention ──
     ...OR unless the DISCLOSURE LEDGER already authorised this turn's
     detail, which is a different authority and used to be ignored here.

     THE DEFECT THIS CLOSES. admissibleDisclosures() can return
     `relevant_and_earned` and put a fact into the prompt -- the prompt then
     says "they have just earned one. Work the SUBSTANCE of exactly ONE of
     these into your reply". Meanwhile the engine's own
     `simulatedFactsAllowed` is computed from the reaction policy
     (prospect-behaviour.js:1260 requires disclosure FULL or VOLUNTEER) and
     can be false at the same moment. The model obeyed the prompt, declared
     the fact honestly, and was rejected for inventing it. Measured twice in
     the 100-turn run: the ledger offered `volume` ("it comes in waves,
     quiet then all at once"), the prospect said "it can be quiet and then
     all come through at once", and the reply was thrown away for the floor
     -- at the exact moment it was being most specific.

     WHAT THIS AUTHORISES, STATED HONESTLY. It permits AS MANY declared
     facts as the ledger offered this turn, and only when it offered any.
     It does NOT verify that a declared string IS the offered fact, and it
     deliberately does not pretend to: the prompt instructs the model to
     paraphrase ("these are notes, not lines: do not use this wording"), and
     measured against the real rejections the declared text shares only one
     or two stemmed words with the ledger text -- no threshold separates a
     faithful paraphrase from a coincidence, so a text match here would be a
     guess wearing the costume of a check.

     What keeps it narrow instead:
       - it cannot fire at all when the ledger offered nothing, which is
         exactly the genuinely-invented case (conv7: offer [], model minted
         "Enquiries mostly reach the clinic through reception") -- still
         rejected;
       - the count is capped at what was offered, so an authorised fact
         cannot be used as cover for smuggling extra ones alongside it. The
         prompt's own rule is "do not mention more than one";
       - `disclosure` defaults to null, so every existing caller and every
         call with no ledger keeps today's exact behaviour.
     Identity of the content is still policed by the unchanged gates below
     and by the MUST NOT block in the prompt -- unsupportedContent,
     confirmed_unknown, and the capability claims. */
  const offeredFacts = (disclosure && Array.isArray(disclosure.offer)) ? disclosure.offer : [];
  const declaredFacts = parsed.simulatedFactsIntroduced || [];
  if (!turn.simulatedFactsAllowed && declaredFacts.length) {
    /* TWO CONDITIONS, BOTH REQUIRED. The count alone was not enough: an
       adversarial replay declared ONE fact against ONE offered fact and
       smuggled a completely unrelated invention through, because nothing
       tied the declared string to the earned one.

       So each declared fact must also be LEXICALLY BOUND to some offered
       fact. Measured on the real rejections, a faithful paraphrase always
       shares at least one distinctive stemmed word with the fact it came
       from -- conv4 shares "quiet", conv21 shares "waves"+"quiet" -- while
       five different unrelated inventions ("tied into a contract with
       another supplier", "three unlisted branches and a council contract",
       "the owner is retiring", ...) share exactly ZERO. One word is a thin
       margin and it is chosen deliberately: the prompt orders the model to
       paraphrase, so a stricter threshold would reject honest work, and the
       failure direction here is REJECTION -> the deterministic floor, which
       is the safe side and is what already happened before this fix.

       Matched against the DECLARED string, never the reply. Using the reply
       would reopen the hole exactly: a model could recite the earned fact
       in its reply while declaring an unrelated one, and the reply's overlap
       would authorise the invention.

       Same stemming idiom as the `confirmed_unknown` check below (>4 chars,
       first 5), so the two gates read text the same way. */
    const stemsOf = (s) => new Set(norm(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 4).map((w) => w.slice(0, 5)));
    const offeredStems = offeredFacts.map((f) => stemsOf(f && f.text));
    const unbound = declaredFacts.filter((d) => {
      const ds = stemsOf(d);
      return !offeredStems.some((os) => [...ds].some((w) => os.has(w)));
    });
    if (unbound.length) {
      bad('invented_when_not_permitted',
        `not earned: ${String(unbound[0]).slice(0, 60)}`);
    } else if (declaredFacts.length > offeredFacts.length) {
      /* Every declared fact matched something, but there are more of them
         than were earned -- an earned fact is not cover for extras. The
         prompt's own rule is "do not mention more than one". */
      bad('invented_when_not_permitted',
        `${declaredFacts.length} declared, ${offeredFacts.length} earned`);
    }
  }
  for (const u of (context.unknowns || [])) {
    const terms = [...new Set(norm(u).replace(/^it is not yet known (whether|which|who|what|if) /, '')
      .split(' ').filter((w) => w.length > 4).map((w) => w.slice(0, 5)))];
    if (terms.length < 2) continue;
    const said = new Set(norm(reply).split(' ').map((w) => w.slice(0, 5)));
    const hits = terms.filter((t) => said.has(t));
    /* Confirming an unknown is only allowed when the engine let the prospect
       introduce simulated detail — and it is then marked as simulated. */
    if (hits.length >= 2 && !turn.simulatedFactsAllowed) bad('confirmed_unknown', u.slice(0, 60));
  }

  return { valid: problems.length === 0, problems, reply, tone: parsed.tone };
}

/* Every fact the model introduced, sealed on the way in. */
export function sealSimulatedFacts(parsed) {
  return ((parsed && parsed.simulatedFactsIntroduced) || []).map((text) => ({
    text: String(text), simulated: true, source: 'practice_simulation', durable: false,
  }));
}

/* ── the floor ────────────────────────────────────────────────────────
   Always available, never wrong about state. Used when the model is off,
   unreachable, or rejected. */
export function deterministicProspectReply(turn, capabilities = ALL_CAPABILITIES_PERMITTED) {
  const s = turn.prospectStateAfter || {};

  /* ── HOW THE CALL ENDED DECIDES HOW THEY SAY GOODBYE ────────────────
     Three endings, three different things to say. Collapsing the last two
     meant a founder who recognised there was no fit, said so, and left
     courteously was answered with "Look, I have to go" — the prospect
     escaping a call the founder had already closed. That punishes exactly
     the behaviour the rubric gives full marks for. */
  if (s.ended) {
    if (s.endedReason === 'no_fit_identified') {
      return { reply: 'No worries. Thanks for calling.', tone: 'neutral' };
    }
    if (s.endedReason === 'founder_closed_politely') {
      return { reply: 'That is fair enough. Thanks for being straight about it.', tone: 'neutral' };
    }
    /* Short, and the last thing they say. A prospect spoken to like that
       does not deliver a lesson on the way out -- they go. */
    if (s.endedReason === 'hostility_from_founder') {
      return { reply: 'Right — I am ending the call there. Goodbye.', tone: 'disengaging' };
    }
    return { reply: 'Look, I have to go. Thanks anyway.', tone: 'disengaging' };
  }

  /* ── WP4.2: THE ONE DYNAMIC LINE IN AN OTHERWISE STATIC FLOOR ─────────
     Every other reply in this function is a fixed string, checked exhaustively
     against the capability triplet by its own test, never by this guard.
     activeObjection is prep-sheet text (drawn from the founder's own script,
     not model output) and therefore cannot be enumerated the same way -- an
     authoring error here could assert a capability the scenario withholds.
     Reuses forbiddenCapabilityClaim, the exact function Boundary A runs on
     the model, rather than a second definition of "explicit claim". Boundary
     A itself still never runs on this function's output -- this is a
     narrower, separate guard, and unlike A there is no model to fall back
     from: a forbidden objection line simply does not return here, and
     execution continues to whatever this function would otherwise say. */
  if (turn.activeObjection && !forbiddenCapabilityClaim(turn.activeObjection, capabilities)) {
    return { reply: turn.activeObjection, tone: 'skeptical' };
  }
  /* ── A CHALLENGE MAY DISPUTE THE CLAIM, NEVER THE TRANSCRIPT ─────────
     This line was 'I never said that, actually.' — a canned denial of
     having SPOKEN, emitted by a floor that has never seen the transcript
     and cannot know what was said. On a real staging call it fired two
     turns after this prospect had twice said "Use the enquiry form", when
     the founder agreed with them ("Alright, I'll send it through the form
     then. Appreciate you talking with me — have a good one."). The
     prospect denied its own words, the founder noticed, and the call was
     over as a believable conversation.

     The trigger was a classifier false positive (fixed separately, at its
     own source), but the deeper fault is here: no line that asserts what
     was or was not SAID can be safe in a context-free fallback, because
     it is a claim about a record this function does not hold. Whatever
     misclassification arrives next, these dispute the CLAIM's accuracy
     and assert nothing about the conversation — so the floor is now
     incapable of contradicting the transcript rather than merely unlikely
     to. Rotated on turns like every other pool here, so a founder who
     over-claims twice does not hear one stock sentence twice. */
  if (turn.challengeFounder) {
    return { reply: ['I would not go that far.',
      'Where has that come from?',
      'That is not quite right.'][(s.turns || 0) % 3], tone: 'guarded' };
  }

  /* ── THE MOMENT ANNOUNCES ITSELF, ONCE ───────────────────────────────
     Below objection and challenge on purpose -- what the prospect is
     actively holding always outranks a passing situational cue. The floor
     never composes two lines, so this is a full reply rather than a
     prefix, and it fires only on the single turn the situation layer
     marked as due, which already guarantees it happens at most once. */
  const situation = s.situation || null;
  if (situation && situation.signalDue) {
    const line = timePressureLine(situation.id);
    if (line) return { reply: line, tone: 'neutral' };
  }

  if (turn.founderAction === 'premature_pitch') {
    /* The same misstep lands differently depending on how much patience they
       had to begin with. One floor line for every mode made a resistant
       prospect and a receptive one answer identically. */
    if (turn.allowedResponsePosture === 'guarded') return { reply: 'We are not looking at that, sorry.', tone: 'resistant' };
    if (turn.allowedResponsePosture === 'open') return { reply: 'Okay — what does that actually involve?', tone: 'neutral' };
    return { reply: 'Right. I am not sure we need that.', tone: 'guarded' };
  }
  if (turn.founderAction === 'pressure') return { reply: 'I would rather you did not push it.', tone: 'resistant' };

  /* ── WHAT THEY DID, THEN HOW THEY FEEL ABOUT IT ───────────────────
     Posture used to be tested BEFORE the founder's action, so two lines —
     "We are fine at the moment, honestly." when guarded and "Sure — what did
     you notice?" when open — answered every remaining move in the game.
     Observed live: four different discovery questions in a row, four
     identical replies. Anything that is not a reaction to a specific misstep
     is decided by the ACTION first; posture then chooses between phrasings of
     that reaction, and is the fallback only when the action has no reaction
     of its own.

     NOTHING HERE ASSERTS A FACT ABOUT THE BUSINESS. The floor runs when the
     model is off, unreachable or rejected, and a fallback that invented
     detail would be a second unreviewed author. These lines are responsive
     and content-free: they move the conversation on without establishing
     anything the founder could then be credited with having discovered. */
  const a = turn.founderAction;
  const guarded = turn.allowedResponsePosture === 'guarded';
  const open = turn.allowedResponsePosture === 'open';

  /* ── WHAT THE POLICY DECIDED ──────────────────────────────────────
     `informationAllowed` is a SENTENCE. It was being read here as a boolean,
     so `turn.informationAllowed && !guarded` was true for every non-guarded
     prospect at any willingness whatsoever — the unwilling pool was
     unreachable in production and only the test fixtures, which pass a real
     boolean, ever saw it. The reaction is the actual decision; the boolean
     path stays for the fixtures that predate it. */
  const R = turn.reaction || null;
  const declining = R ? R.disclosure === 'none' : !turn.informationAllowed;
  const initiative = R ? R.initiative : 'none';

  /* ── AN AFFIRMING LINE IS AN ANSWER ────────────────────────────────
     "That is closer to it, yes." and "That is public, yes." both CONFIRM
     what the founder just said. Reaching either while the policy is
     withholding hands over agreement the engine refused to give -- which is
     worse than merely answering, because the founder can then be credited
     with having established it.

     Found on staging, not by a unit test: a resistant prospect who had just
     said "I'm not going to go into that over the phone" answered the very
     next question with "That is closer to it, yes." The action branches
     below were written before there was a disclosure axis and read posture
     only. Nothing else down here affirms, so nothing else needs this. */
  const affirms = a === 'high_value_follow_up' || a === 'grounded_observation';
  if (affirms && declining && turn.founderAsked !== false) {
    const decline = [
      { reply: 'I would rather not get into that, honestly.', tone: 'guarded' },
      { reply: 'That is not something I would discuss on a call like this.', tone: 'guarded' },
      { reply: 'I am not going to comment on that.', tone: 'guarded' },
    ];
    return decline[(Number(s.turns) || 0) % decline.length];
  }

  /* ── AND AN AFFIRMATION ANSWERS A STATEMENT, NEVER A QUESTION ──────
     The gate above catches the case where the engine was withholding. It
     does not catch the far more common one: the founder ASKED something,
     the prospect was perfectly willing, the model reply was rejected, and
     the floor said "That is closer to it, yes." to a question. Nothing was
     affirmed because nothing was asserted -- observed live on "Who actually
     touches that, day to day?" and again on "How often does that cause you
     a problem?".

     A willing person who cannot answer specifically does not agree with the
     question. They say they would have to check. Which of those they say is
     chosen by WHAT WAS ASKED -- a number, a time, a person, a place -- so
     the reply is caused by the founder's line rather than by a rotation
     counter, and it still asserts nothing about the business.

     Several of these land on the answer key as `explicitly_unknown`, which
     is the honest record: the founder did not get the information, and is
     not marked down for failing to. */
  if (affirms && turn.founderAsked !== false) {
    const asked = String(turn.founderText || '').toLowerCase();
    const unprepared = /\bhow (?:many|much|often)\b|\bwhat (?:number|volume|percentage|proportion)\b|\bhow long\b/.test(asked)
      ? { reply: 'I would not want to give you a number off the top of my head.', tone: 'neutral' }
      : /\bwho\b/.test(asked)
        ? { reply: 'It depends who is on that day, so I would have to check.', tone: 'neutral' }
        : /\bwhen\b|\bhow soon\b|\bhow quickly\b/.test(asked)
          ? { reply: 'That varies quite a bit, so I would not want to guess.', tone: 'neutral' }
          : /\bwhere\b/.test(asked)
            ? { reply: 'A few different places, honestly — I would have to check.', tone: 'neutral' }
            : /\bwhy\b/.test(asked)
              ? { reply: 'That is just how it has always been done here.', tone: 'neutral' }
              : { reply: 'I would have to check before I said anything definite.', tone: 'neutral' };
    /* Partial willingness still shortens it. */
    return guarded ? { ...unprepared, tone: 'guarded' } : unprepared;
  }

  if (a === 'relevant_opening') {
    return open ? { reply: 'Sure — what did you notice?', tone: 'receptive' }
      : guarded ? { reply: 'Go on, briefly.', tone: 'guarded' }
        : { reply: 'Go on.', tone: 'neutral' };
  }
  if (a === 'irrelevant_opening') return { reply: 'Sorry — what is this about?', tone: 'guarded' };
  if (a === 'repetition') return { reply: 'I think I just answered that.', tone: 'guarded' };
  if (a === 'unsupported_assumption') return { reply: 'Where are you getting that from?', tone: 'guarded' };
  if (a === 'grounded_observation') {
    return guarded ? { reply: 'That is public, yes.', tone: 'guarded' }
      : { reply: 'That is right, yes.', tone: 'neutral' };
  }
  if (a === 'close_request') return { reply: 'What would that actually be for?', tone: 'guarded' };
  if (a === 'pitch') return { reply: 'And what would that involve, practically?', tone: 'neutral' };
  if (a === 'objection_response' || a === 'objection_exploration') {
    return { reply: 'Maybe. I am not convinced yet.', tone: 'skeptical' };
  }
  if (a === 'high_value_follow_up') {
    return open ? { reply: 'Yes — that is the part that matters.', tone: 'receptive' }
      : { reply: 'That is closer to it, yes.', tone: 'neutral' };
  }
  if (a === 'discovery_question' || a === 'generic_question') {
    /* Whether they are willing to say anything at all is already decided by
       the engine. The floor obeys it rather than deciding again.

       ROTATED ON THE TURN COUNT, because a founder asks several questions in
       a row and a real person does not answer three of them with the same
       sentence. Still fully deterministic — same call, same replies. */
    const n = Number(s.turns) || 0;
    const willing = [
      { reply: 'Possibly. What are you getting at?', tone: 'neutral' },
      { reply: 'It varies. Why do you ask?', tone: 'neutral' },
      { reply: 'I would have to think about that. What is behind the question?', tone: 'neutral' },
    ];
    const unwilling = [
      { reply: 'That is not really something I would get into on a cold call.', tone: 'guarded' },
      { reply: 'I am not going to go into that with someone I have just met.', tone: 'guarded' },
      { reply: 'What is it you actually want, sorry?', tone: 'guarded' },
    ];
    /* ── ONLY ANSWER A QUESTION THAT WAS ASKED ──────────────────────
       Every line above replies to something. `generic_question` is also
       the classifier's terminal default, so it lands on statements that
       matched nothing -- and a founder who said "Shut up." was answered
       "It varies. Why do you ask?", which invents a question and reads
       exactly like the prospect responding to an earlier part of the call.
       Observed in a real rehearsal.

       A statement gets a reply to a statement. Nothing here decides how
       willing they are: that is still the engine's call, obeyed above. */
    if (turn.founderAsked === false) {
      const heard = [
        { reply: 'Right.', tone: 'neutral' },
        { reply: 'Okay.', tone: 'neutral' },
        { reply: 'Go on.', tone: 'neutral' },
      ];
      const unimpressed = [
        { reply: 'Sorry — what is it you actually want?', tone: 'guarded' },
        { reply: 'I am not sure what you mean by that.', tone: 'guarded' },
        { reply: 'Is there a point to this?', tone: 'guarded' },
      ];
      const said = (!declining && !guarded) ? heard : unimpressed;
      return said[n % said.length];
    }

    /* ── INITIATIVE, WHEN THERE IS ANY ──────────────────────────────
       Content-free on purpose, like everything else down here: the floor
       may come back at the founder, but it may never establish a fact he
       could then be credited with discovering.

       ONLY WHEN NOTHING IS BEING DISCLOSED. The two axes are orthogonal and
       collapsing them here was a real defect: a warmed-up prospect asked
       "how many new patients do you take a week?" came back with "how would
       that sit with what we already do?" — a question back INSTEAD of the
       answer, which is a non-sequitur, not initiative. When they are
       answering, the willing pool below already comes back at the founder in
       the same breath, which is what a person does. */
    if (initiative === 'clarify') {
      const clarify = [
        { reply: 'What do you mean exactly?', tone: 'neutral' },
        { reply: 'Sorry — which part are you asking about?', tone: 'neutral' },
        { reply: 'Can you be more specific about what you are after?', tone: 'guarded' },
      ];
      return clarify[n % clarify.length];
    }
    if (initiative === 'question_back' && declining) {
      const back = [
        { reply: 'What would that actually look like in practice?', tone: 'neutral' },
        { reply: 'How would that sit with what we already do?', tone: 'neutral' },
        { reply: 'Who else have you done that for?', tone: 'neutral' },
      ];
      return back[n % back.length];
    }

    const pool = (!declining && !guarded) ? willing : unwilling;
    return pool[n % pool.length];
  }

  /* Only now, and only for an action with no reaction of its own. */
  if (guarded) return { reply: 'We are fine at the moment, honestly.', tone: 'guarded' };
  if (open) return { reply: 'Sure — go ahead.', tone: 'receptive' };
  return { reply: 'Right. What is this in relation to?', tone: 'neutral' };
}
