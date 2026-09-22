/* ════════════════════════════════════════════════════════════════════════
   WHAT JUST PASSED BETWEEN THESE TWO PEOPLE

   The behaviour engine classifies the FOUNDER'S SENTENCE. That is not the
   same question as what just happened in the conversation, and the gap
   between the two is where Guided got things exactly backwards.

   Measured on a real blind call: the prospect answered the phone with
   "Ardley Veterinary Clinic, Priya speaking, can you bear with me one
   second?" and the founder talked straight over it with a full pitch. The
   sentence ended in a question, `state.turns` was 0, so the classifier
   returned `discovery_question` -- which carries engagement +0.1 -- and
   Guided told him "Engagement up: you gave them room to keep talking."
   He had done the precise opposite, and it was the one habit he had come
   to practise.

   Nothing was broken in the classifier. It answered the question it was
   asked. Nobody was asking the other one.

   ── WHAT THIS FILE IS, AND IS NOT ────────────────────────────────────
   It reads a PAIR: the prospect's last line and the founder's answer to
   it. It decides nothing about psychology and holds no state -- it names
   what happened so that the one engine that does own psychology can price
   it, and so Guided can describe it. Both read the same object, which is
   what stops the founder being told one thing while the prospect does
   another.

   reaction-reader.js is the post-call equivalent: same idea, richer
   evidence, no live budget. This one runs on the turn, from two strings.
   ══════════════════════════════════════════════════════════════════════ */
import { HARD_NO, SOFT_NO, DO_NOT_CONTACT } from './call-state.js';

export const INTERACTION_READ_VERSION = 'practice_interaction_read_v1';

/* What the PROSPECT just did. Ordered by how much it constrains the
   founder's next move: a boundary outranks a question, because ignoring
   it costs more than answering it well earns. */
export const MOVE = Object.freeze({
  DO_NOT_CONTACT: 'do_not_contact',
  REFUSED: 'refused',
  SET_BOUNDARY: 'set_boundary',
  ASKED_TO_WAIT: 'asked_to_wait',
  WRAPPING_UP: 'wrapping_up',
  SAID_BUSY: 'said_busy',
  CORRECTED: 'corrected_founder',
  NO_AUTHORITY: 'no_authority',
  OFFERED_TRANSFER: 'offered_transfer',
  OBJECTED: 'objected',
  CONFUSED: 'confused',
  ASKED_QUESTION: 'asked_question',
  SHOWED_INTEREST: 'showed_interest',
  DISCLOSED: 'disclosed',
  NONE: 'none',
});

/* What the FOUNDER did about it. */
export const RESPONSE = Object.freeze({
  ACKNOWLEDGED: 'acknowledged',
  ANSWERED: 'answered',
  EXPLORED: 'explored',
  ADAPTED: 'adapted',
  RECOVERED: 'recovered',
  IGNORED: 'ignored',
  TALKED_OVER: 'talked_over',
  PUSHED_AFTER_REFUSAL: 'pushed_after_refusal',
  REPEATED: 'repeated',
  CONTRADICTED: 'contradicted',
  NEUTRAL: 'neutral',
});

/* THE MODEL WRITES TYPOGRAPHIC APOSTROPHES. "There’s always someone on
   the desk" and "There's always someone on the desk" are the same
   sentence, and matching only the straight one switched every pattern in
   this file off on real prospect text. `call-state.js` has carried this
   same normalisation, and this same comment, since the day it was bitten
   by it -- this file simply never got it, and the miss only became
   visible once there were patterns here worth missing.

   Normalised once, here, so no pattern below has to remember. */
const norm = (s) => String(s == null ? '' : s)
  .replace(/[‘’ʼ]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).split(/\s+/).filter(Boolean);

/* ── THE PROSPECT'S MOVE ──────────────────────────────────────────────
   Deliberately narrow. A pattern that fires on anything is worse than one
   that fires on nothing, because the founder is then told off for turns
   nobody would call a mistake. */
const ASKED_TO_WAIT = /\b(?:bear with me|hold on|hang on|one second|one sec|one moment|just a (?:sec|second|moment|minute)|give me a (?:sec|second|minute|moment)|can you hold|two seconds|wait a (?:sec|second|moment))\b/i;
/* "I am slammed" is a brush-off. "Reception is slammed on a Monday" is
   somebody telling you how their business runs -- the single most useful
   thing a founder can get -- and scoring it as a brush-off would punish
   them for the discovery they just earned. So the bare adjectives never
   match alone: they need a first-person subject or a right-now marker.
   The unambiguous whole phrases below need no such help. */
/* ── THEY ARE ENDING THE CALL ────────────────────────────────────────
   Not a refusal -- they have not said no to anything -- and not the same
   as being busy, which asks for a better time. This is somebody leaving
   now, and the only correct response is to let them.

   Measured on a real staging call: "Look, I have to go. Thanks anyway."
   was six words that matched nothing, so it read as ordinary disclosure
   and the rail told the founder to ask a departing stranger for their
   name. The tester ignored it and let her off the call, and was right. */
const WRAPPING_UP = /\b(?:i (?:have|need|really need|will have|am going) to (?:go|get on|run|dash|shoot off)|i (?:must|should) (?:go|get on|dash)|i'?ll (?:have to )?(?:go|leave it there|let you go)|(?:i'?ve )?got to go|must (?:dash|run)|i need to (?:get back to|crack on)|leave it there for now)\b/i;

const BUSY_PHRASE = /\b(?:only (?:got|have) a (?:minute|second|moment)|in the middle of something|middle of something|not a good time|bad time|caught me (?:at|on|mid)|haven'?t got time|no time (?:for|right now)|got a lot on|rushed off my feet)\b/i;
const BUSY_STATE = /\b(?:i|we|it)(?:'m| am|'re| are|'s| is)\s+(?:a (?:bit|little) |really |pretty |very |absolutely )?(?:slammed|swamped|hectic|chaos|snowed under|flat out|busy)\b|\bbusy right now\b/i;
const SAID_BUSY = { test: (t) => BUSY_PHRASE.test(t) || BUSY_STATE.test(t) };
/* A boundary is an instruction about HOW to make contact, not a refusal
   of the contact itself. Pushing past it is its own mistake. */
/* "Email us" is an instruction to the founder. "They usually just email us"
   is a description of how their customers behave, and reading it as a
   boundary took a plain disclosure and told him he had been told off. The
   email clauses now need to be addressed to him -- imperative at the start
   of a clause, or an explicit "you can". */
const SET_BOUNDARY = /(?:\buse the (?:enquiry|contact|web ?site) form\b|\bsend (?:it|that|an email|us an email)\b|\b(?:put|drop) (?:it|that) in an email\b|(?:^|[.!?;,]\s*|\byou (?:can|could|should|'?d better) )email (?:it|us|that)\b|\bgo through (?:the|our) website\b|\bi (?:can'?t|do not|don'?t) give out (?:staff |their )?names?\b|\bnot giving out\b|\bspeak to (?:them|him|her) (?:directly|yourself)\b)/i;
/* PEOPLE DO NOT SAY "IT IS NOT MY DECISION". On a coherent staging call
   the prospect disclaimed authority twice -- "I am not the one who makes
   decisions on services like that" and "Someone else would need to sign
   that off" -- and neither matched, so the rail never routed on a call
   where the door had been named twice. The shapes below are those two and
   their obvious neighbours; the concept is unchanged. */
/* ── AUTHORITY, BUILT FROM THE TWO THINGS PEOPLE ACTUALLY SAY ───────
   This was a list of phrasings, and it has now missed a real one on three
   separate calls: "I am not the one who makes decisions", "someone else
   would need to sign that off", "I could not sign off changing providers",
   "the partners would sign that off", "I would not make the final call".
   Adding each as it appeared is how a list stays permanently one call
   behind, so this is composed instead of enumerated.

   Two shapes, and between them they are the whole concept: I CANNOT (a
   negated first person joined to deciding, signing, approving or saying
   yes) and SOMEBODY ELSE DOES (a named other party joined to the same).
   The gap between subject and verb is bounded and may not cross a
   sentence, so "I could not say" three clauses from "sign off" does not
   match. The literal shapes that were never sentences -- "above my pay",
   "I just answer the phones" -- are kept as they were. */
const AUTH_CANNOT = /(?:i|it) (?:could ?n[o']?t|would ?n[o']?t|do ?n[o']?t|can ?n[o']?t|cannot|can'?t|am not the one to|is not (?:mine|my)) [^.!?]{0,24}?(?:sign(?: it)? off|sign off|decide|approve|authoris|authoriz|make (?:the |that |those |this |a )?(?:final )?(?:call|decision)|say yes)/i;
const AUTH_SOMEBODY_ELSE = /(?:the )?(?:partners?|owners?|principals?|directors?|practice manager|office manager|head office|my (?:boss|manager)|someone else|somebody else|the (?:vets?|dentists?)) (?:would|will|has to|have to|needs? to|is the one who|are the ones who) [^.!?]{0,20}?(?:sign|decide|approve|authoris|authoriz|make)/i;
const AUTH_LITERAL = /\b(?:not the (?:person|one) who|not my (?:call|decision)|above my pay|you'?d need to (?:speak|talk) to|not (?:down to|mine to|up to) me|i'?m just whoever|i just answer)\b/i;
/* PASSIVE, where the decider is the object rather than the subject:
   "That would have to be signed off by the principal." */
const AUTH_PASSIVE = /(?:would|will|has to|have to|needs? to) (?:be )?(?:signed off|approved|authoris(?:ed)?|authoriz(?:ed)?|okayed) by/i;
const NO_AUTHORITY = {
  test: (t) => AUTH_LITERAL.test(t) || AUTH_CANNOT.test(t) || AUTH_SOMEBODY_ELSE.test(t)
    || AUTH_PASSIVE.test(t),
};
const OFFERED_TRANSFER = /\b(?:put you through|transfer you|pass you (?:to|over)|i can (?:pass|forward)|let me get|i'?ll get (?:you )?(?:someone|him|her))\b/i;
const CORRECTED = /\b(?:that'?s not (?:right|true|what|quite)|that is not (?:right|true|what|quite)|i (?:never|did ?n[o']?t) sa(?:y|id)|well,? i did ?n[o']?t|not necessarily true|you did ask|actually,? (?:no|i)|i wouldn'?t say that)\b/i;
/* ── AN OBJECTION DOES NOT ANNOUNCE ITSELF ────────────────────────────
   The list above is the textbook shapes -- price, incumbent, tried it
   before. Almost nobody on a real call says any of them. What they say is
   "Most people use the website now.", and what it MEANS is "phone cover is
   not worth anything to us". A blind judge watching one staging call named
   that the only substantive thing the prospect said, said twice, and the
   rail never once addressed it.

   Three shapes, and each is a claim about why the need does not apply:
     ALREADY COVERED   -- somebody or something is already doing it
     ANOTHER WAY       -- the work arrives through a different channel
     NOT A PROBLEM     -- it does not happen, or it does not matter

   THE DISCRIMINATION THAT MATTERS is against ordinary disclosure. "Reception
   picks up when they can, otherwise it rings out to voicemail" describes how
   the place runs and concedes the gap; "There's always someone on the desk"
   asserts there is no gap. Both are about the same subject and only the
   second is pushing back. So none of these match a plain description of a
   process -- every one of them requires the sufficiency claim itself.

   This lives HERE and deliberately not in `call-state`: read wrong on the
   rail it costs one suggestion, read wrong in the recorded state it costs
   the founder a mark. That is the same reasoning that took the in-house
   pattern back out of the denial list. */
const ALREADY_COVERED = /\b(?:we already have (?:someone|somebody|a|an|our own)|we already (?:use|work with|deal with)|already work(?:ing)? with|we(?:'ve| have) got (?:that|it|this) covered|we (?:already |normally |usually |just )?(?:handle|do|manage|cover|run|deal with) (?:it|that|them|those|all of it|the \w+|our \w+) (?:ourselves|in[- ]house|internally|another way|a different way|differently)|we (?:keep|do|handle) (?:it all|it|that|all of it) in[- ]house|there(?:'s| is) always (?:someone|somebody)|we always have (?:someone|somebody)|(?:someone|somebody) is always (?:here|there|on)|we (?:never|do ?n[o']?t) let (?:\w+ ){0,3}ring out|it never (?:goes|rings) (?:to voicemail|out))\b/i;
const ANOTHER_WAY = /\b(?:(?:most|majority) (?:of )?(?:people|customers|clients|patients|of them|of ours|of our \w+) (?:just |normally |usually |tend to )?(?:use|go|book|do|prefer)|(?:they|people|customers|clients|patients) (?:usually|normally|tend to|generally|mostly) (?:just )?(?:use|go|book|email|message|do)|everyone (?:just )?(?:uses|goes|books)|(?:they|people) (?:just )?(?:use|go through) (?:the|our) (?:website|site|form|portal|app))\b/i;
/* `|something` used to sit in the first alternative and it swallowed a
   DECLINE: "Well, no, it is not something we'd get into." read as a
   brush-off worth exploring, so a blind judge watched the rail probe a
   flat no while the founder was mid-goodbye. "Not something we worry
   about" is still covered, by the clause written for it. */
const NOT_A_PROBLEM = /\b(?:(?:that|it|this)(?:'s| is) not (?:really )?(?:an issue|a problem|a concern)|not (?:really )?(?:an issue|a problem|a concern) (?:here|for us)|we do ?n[o']?t (?:get|have) (?:many|much|a lot of|that many)|(?:hardly|rarely) (?:ever )?(?:happens|comes up|an issue)|not something we (?:worry|think) about|(?:it|that)(?:'s| is) fine (?:as it is|the way it is)|(?:it|that) works fine|no (?:real )?need for)\b/i;
/* ── THE FOURTH SHAPE: THEY DOUBT IT WOULD WORK ────────────────────────
   The three above all deny the NEED -- somebody covers it, it arrives
   another way, it does not happen. This one concedes the need and doubts
   the ANSWER: "I'm not convinced this would save us much", "I don't think
   the ROI works". Found by audit: both read `disclosed` and the rail
   offered generic discovery, when the thing in the room was a doubt worth
   answering.

   TWO CLAUSES, NOT ONE, and the second is what keeps this narrow. A doubt
   marker alone ("I don't think...") is most of English. This requires the
   doubt to land on the OFFER's efficacy -- working, saving, being worth
   it -- and to be ABOUT something (it/this/that/the), not about the
   speaker.

   That pairing is also what protects the two families tested AFTER this
   one, which a bare doubt marker would have swallowed:
     "I don't think that's my call"      -> `call` is not an efficacy word
     "I'm not sure I can approve that"   -> no it/this/that before one
   Neither needs a denylist; they simply never form the second clause. The
   same is true of a question -- "Do you think this would work?" carries no
   first-person doubt -- and of plain disclosure. */
const DOUBTS_VALUE = new RegExp(
  "\\b(?:(?:i'?m|i am) not (?:convinced|sure|sold)"
  + "|i (?:do ?n[o']?t|ca ?n[o']?t|could ?n[o']?t) (?:think|see|believe))\\b"
  + '[^.!?]{0,20}?\\b(?:it|this|that|the|there)\\b[^.!?]{0,20}?'
  + '\\b(?:works?|working|save|saves|saving|help|helps|helping|worth|roi|'
  + 'return|difference|benefit|value|justify|stack up|add up)\\b', 'i');
const OBJECTED = {
  test: (t) => /\b(?:we already have|already work(?:ing)? with|we'?re happy with|too expensive|no budget|can'?t afford|tried that before|did ?n[o']?t stick|did ?n[o']?t fit)\b/i.test(t)
    || ALREADY_COVERED.test(t) || ANOTHER_WAY.test(t) || NOT_A_PROBLEM.test(t)
    || DOUBTS_VALUE.test(t),
};
/* THE CONTRACTED FORM IS A DIFFERENT STRING. "What is this about?" matched
   and "What's it about?" did not, so the same question from the same person
   produced two different moves depending on whether they contracted it --
   and on a real staging call it produced both, five turns apart. The house
   rule is to spell out the forms people actually use rather than expand
   contractions globally; this is the third file to be bitten by it. */
/* "What do you mean?" is somebody who has lost the thread. "What do you
   mean BY missed?" is somebody asking you to define one word, which is a
   direct question with an answer -- and on a real call the panel told the
   founder to rephrase her own question instead of answering theirs, two
   turns after correctly telling her that answering comes first. The
   qualified form falls through to the question gate. */
const CONFUSED = /\b(?:what do you mean(?! by\b)|sorry,? what|which part|not sure what you|what(?:'s| is| was) (?:this|it) (?:about|in relation to)|what(?:'s| is) it you (?:want|wanted)|come again|say that again)\b/i;
const SHOWED_INTEREST = /\b(?:tell me more|go on|what (?:exactly )?(?:do|are) you (?:offer|offering|proposing)|how (?:much|does that work)|what would (?:that|you) (?:cost|need)|send it over|interested)\b/i;

/* Six or more content words that are not a refusal and not a question:
   somebody telling you how their business runs. Same bar reaction-reader
   uses for a substantive answer, restated for the live path. */
const DISCLOSED_MIN_WORDS = 6;

/* ── A QUESTION IS NOT ALWAYS THE LAST THING SOMEBODY SAYS ────────────
   Both this and `asksOutright` tested `/\?\s*$/` -- the utterance had to
   END in a question mark. People do not talk like that. Measured on a real
   staging call: "Who is calling? We don't let calls ring out." and "What
   are you actually asking for? Most people use the website now." both read
   as ordinary disclosure, so the founder was coached to run a discovery
   probe at somebody who had just asked him his name, and to dodge the one
   question in the whole call that reached for the transaction.

   A trailing remark after the question is the most natural shape there is,
   and it made the question invisible.

   Deliberately conservative: the sentence must END in a question mark AND
   OPEN with an interrogative, so a rhetorical tail -- "we handle it
   ourselves, do you know what I mean?" -- is still not a question somebody
   is waiting on an answer to. */
const INTERROGATIVE = /^(?:(?:so|but|and|ok|okay|right|sorry|well|erm|um|hm)[,\s]+)*(?:who|what|when|where|why|which|whose|whom|how|is|are|was|were|do|does|did|can|could|will|would|should|shall|have|has|had|am|may|might)\b/i;
const SENTENCE = /[^.!?]+[.!?]?/g;
export function asksSomething(said) {
  const t = norm(said);
  if (!t.includes('?')) return false;
  return (t.match(SENTENCE) || []).some((part) => {
    const p = part.trim();
    return /\?$/.test(p) && INTERROGATIVE.test(p.replace(/^[^A-Za-z]+/, ''));
  });
}

/* ── HAS ANYBODY SAID WHO THEY ARE ───────────────────────────────────
   Transcript-visible only, and deliberately so. The prep sheet names a
   contact role, but that is a guess about who SHOULD answer -- on a real
   staging call the person who picked up plainly was not the practice
   manager it named, and coaching from it would have told the founder he
   knew something he did not. The hidden scenario role is never readable
   here at all.

   Two ways it becomes known: they introduce themselves, or they say what
   they do. A business name is neither -- "You've got Bramwell Veterinary
   Centre" tells you the building, not the person. */
/* "You're through to Calder Dental" was on this list and it names the
   BUILDING, not the person -- the same reason a bare business name is not
   identity. It fired on a real call and stopped the rail asking who had
   actually answered. */
const GAVE_NAME = /(?:^|[.!?]\s*)(?:yes,?\s*|yeah,?\s*)?speaking\b|\b(?:this is \w+|it(?:'s| is) \w+ (?:here|speaking)|\w+ speaking|my name(?:'s| is) \w+|\w+ here\b)/i;
const GAVE_ROLE = /\b(?:i(?:'m| am) (?:the |a |on )?(?:practice manager|office manager|owner|principal|partner|director|receptionist|reception|nurse|vet|dentist|manager|assistant|on (?:the )?(?:desk|reception|front desk))|i (?:just )?(?:answer|cover|work on) (?:the )?(?:phones?|desk|reception)|i(?:'m| am) (?:just )?(?:the|a) \w+ here|i run (?:the|this) (?:place|practice|clinic)|i look after (?:the )?\w+)/i;
export function statesIdentity(said) {
  const t = norm(said);
  return GAVE_NAME.test(t) || GAVE_ROLE.test(t);
}

export function readProspectMove(said) {
  const t = norm(said);
  if (!t) return MOVE.NONE;
  if (DO_NOT_CONTACT.test(t)) return MOVE.DO_NOT_CONTACT;
  /* Order matters below this line: the most constraining reading of the
     same sentence wins, because that is the one it costs most to ignore. */
  /* Above the wait family: "hold on a second" asks you to stay, "I have
     to go" ends it, and reading the second as the first keeps a founder
     talking at somebody already putting the phone down. */
  if (WRAPPING_UP.test(t)) return MOVE.WRAPPING_UP;
  if (ASKED_TO_WAIT.test(t)) return MOVE.ASKED_TO_WAIT;
  if (HARD_NO.test(t)) return MOVE.REFUSED;
  if (SET_BOUNDARY.test(t)) return MOVE.SET_BOUNDARY;
  if (CORRECTED.test(t)) return MOVE.CORRECTED;
  /* A BAD MOMENT IS A WAIT SIGNAL, and it outranks an objection for the
     same reason `asked_to_wait` does: talking past somebody who has just
     said they are mid-something costs more than winning the argument
     could earn. It sat BELOW the objection test, which did not matter
     while that test only knew textbook objections -- "I'm in the middle
     of something. It never goes to voicemail." used to reach it. Now that
     implicit objections are read, it would not have. */
  if (SAID_BUSY.test(t)) return MOVE.SAID_BUSY;
  if (SOFT_NO.test(t) || OBJECTED.test(t)) return MOVE.OBJECTED;
  if (OFFERED_TRANSFER.test(t)) return MOVE.OFFERED_TRANSFER;
  if (NO_AUTHORITY.test(t)) return MOVE.NO_AUTHORITY;
  if (CONFUSED.test(t)) return MOVE.CONFUSED;
  if (SHOWED_INTEREST.test(t)) return MOVE.SHOWED_INTEREST;
  if (asksSomething(said)) return MOVE.ASKED_QUESTION;
  if (words(t).length >= DISCLOSED_MIN_WORDS) return MOVE.DISCLOSED;
  return MOVE.NONE;
}

/* ── DID THE FOUNDER ACTUALLY DEAL WITH IT ────────────────────────────
   Acknowledgement has to be the thing the move asked for. "I'll be quick"
   answers "I'm busy"; it does not answer "hold on a second", and treating
   the two as the same is how a founder gets credit for steamrolling. */
const ACK_WAIT = /^(?:\W*)(?:sure|of course|certainly|no problem|no worries|yeah,? sure|yes,? of course|absolutely|take your time|no rush|i'?ll (?:wait|hold)|go ahead)\b/i;
const ACK_BUSY = /\b(?:i'?ll be quick|be quick|thirty seconds|one question|two minutes|very quick|won'?t keep you|quick one|shall i call back|call (?:you )?back|another time)\b/i;
const ACK_BOUNDARY = /\b(?:i'?ll do that|will do|of course|understood|no problem|fair enough|that'?s fine|sure|i'?ll (?:send|use|email|go through))\b/i;
const APOLOGY = /\b(?:sorry|apolog|my (?:mistake|bad|fault)|fair (?:enough|point)|you'?re right|i (?:overstated|misspoke|shouldn'?t have)|that'?s on me|i stand corrected)\b/i;

/* A reply short enough to BE an acknowledgement rather than a speech. */
const ACK_MAX_WORDS = 8;
/* Past this, a founder who has not acknowledged is plainly continuing
   with their own agenda rather than responding. */
const TALKED_OVER_MIN_WORDS = 12;

/* The founder actions that mean "still selling". Pushing any of these
   after a refusal or a boundary is the mistake, regardless of wording. */
const STILL_SELLING = Object.freeze(['pitch', 'premature_pitch', 'close_request',
  'pressure', 'unsupported_assumption', 'objection_response']);

export function readInteraction({ prospectSaid = '', founderText = '', classification = null,
  authorityEvidence = null } = {}) {
  const move = readProspectMove(prospectSaid);
  const said = String(founderText || '');
  const n = words(said).length;
  const action = (classification && classification.action) || null;
  const selling = STILL_SELLING.includes(action);

  let response = RESPONSE.NEUTRAL;
  let genericBoundaryIgnored = false;
  let pushedAfterRefusal = false;

  if (move === MOVE.ASKED_TO_WAIT) {
    if (ACK_WAIT.test(said) || n <= ACK_MAX_WORDS) response = RESPONSE.ACKNOWLEDGED;
    else if (n >= TALKED_OVER_MIN_WORDS || selling) {
      response = RESPONSE.TALKED_OVER; genericBoundaryIgnored = true;
    } else response = RESPONSE.NEUTRAL;
  } else if (move === MOVE.DO_NOT_CONTACT || move === MOVE.REFUSED) {
    if (selling) { response = RESPONSE.PUSHED_AFTER_REFUSAL; pushedAfterRefusal = true; }
    else if (action === 'professional_exit' || APOLOGY.test(said)) response = RESPONSE.ACKNOWLEDGED;
    else response = RESPONSE.NEUTRAL;
  } else if (move === MOVE.SET_BOUNDARY) {
    if (ACK_BOUNDARY.test(said)) response = RESPONSE.ACKNOWLEDGED;
    else if (selling) { response = RESPONSE.IGNORED; genericBoundaryIgnored = true; }
    else response = RESPONSE.NEUTRAL;
  } else if (move === MOVE.SAID_BUSY) {
    if (ACK_BUSY.test(said) || n <= ACK_MAX_WORDS) response = RESPONSE.ACKNOWLEDGED;
    else if (n >= TALKED_OVER_MIN_WORDS) { response = RESPONSE.TALKED_OVER; genericBoundaryIgnored = true; }
  } else if (move === MOVE.CORRECTED) {
    /* Taking a correction well is one of the few genuine recoveries the
       engine can see, and it is worth more than the mistake cost. */
    if (APOLOGY.test(said)) response = RESPONSE.RECOVERED;
    else if (action === 'unsupported_assumption') response = RESPONSE.CONTRADICTED;
    else response = RESPONSE.NEUTRAL;
  } else if (move === MOVE.ASKED_QUESTION || move === MOVE.CONFUSED) {
    /* Answering a direct question is the floor of listening. A founder who
       asks something else instead has changed the subject on them. */
    if (action === 'high_value_follow_up' || action === 'objection_exploration') response = RESPONSE.EXPLORED;
    else if (action === 'repetition') response = RESPONSE.REPEATED;
    else if (selling && move === MOVE.CONFUSED) { response = RESPONSE.IGNORED; genericBoundaryIgnored = true; }
    else response = RESPONSE.ANSWERED;
  } else if (move === MOVE.DISCLOSED || move === MOVE.SHOWED_INTEREST) {
    if (action === 'high_value_follow_up' || action === 'objection_exploration') response = RESPONSE.EXPLORED;
    else if (action === 'repetition') response = RESPONSE.REPEATED;
    else if (action === 'grounded_observation') response = RESPONSE.ACKNOWLEDGED;
    else response = RESPONSE.NEUTRAL;
  } else if (move === MOVE.OBJECTED) {
    if (action === 'objection_exploration') response = RESPONSE.EXPLORED;
    else if (selling && action !== 'objection_response') { response = RESPONSE.IGNORED; genericBoundaryIgnored = true; }
    else response = RESPONSE.NEUTRAL;
  } else if (move === MOVE.NO_AUTHORITY || move === MOVE.OFFERED_TRANSFER) {
    /* WP4: retired from the ignoredBoundary chain entirely -- NOT a
       fallback for when authorityEvidence is absent. This raw lexical
       match (readProspectMove's own NO_AUTHORITY/OFFERED_TRANSFER regex,
       a DIFFERENT pattern from evidence-gates.js's AUTHORITY_DISCLAIM/
       ROUTING_OFFER -- the entire reason Boundary B exists) no longer
       decides psychology. `response` still describes what the raw text
       looked like, for whatever reads it as colour; ignoredBoundary is
       decided below, from B alone. */
    if (action === 'close_request' || action === 'pitch' || action === 'premature_pitch') {
      response = RESPONSE.IGNORED;
    } else if (action === 'high_value_follow_up' || action === 'discovery_question') response = RESPONSE.ADAPTED;
    else response = RESPONSE.NEUTRAL;
  }

  if (response === RESPONSE.NEUTRAL && action === 'repetition') response = RESPONSE.REPEATED;

  /* THE AUTHORITY-DRIVEN CAUSE, COMPUTED INDEPENDENTLY OF THE ABOVE.
     Not keyed on `move` at all -- B's own state is the sole source, so a
     raw match this file's regex found (or missed) can never resurrect or
     suppress it. `&& selling`: evidence that the prospect disclaimed
     authority or offered to route the call is not itself a boundary
     ignored -- ignoring it while still trying to sell is. A spent
     disclaim does not count: the person it described is no longer who is
     being sold to. Compound utterances can make this AND a generic cause
     both true in the same turn; they OR into one boolean below, so the
     psychology bump this feeds (prospect-behaviour.js) fires once either
     way, never twice. */
  const authorityBoundaryIgnored = selling && !!(authorityEvidence && (
    (authorityEvidence.authority.state === 'disclaimed' && !authorityEvidence.spentByTransfer)
    || authorityEvidence.routing.state === 'offered'
  ));
  const ignoredBoundary = genericBoundaryIgnored || authorityBoundaryIgnored;

  return Object.freeze({
    version: INTERACTION_READ_VERSION,
    move,
    response,
    /* ── THEY PUT A QUESTION TO HIM ──────────────────────────────────
       A fact about the sentence, not a reading of it, and deliberately
       separate from `move`. "What exactly are you offering?" is classified
       SHOWED_INTEREST -- correctly, it is the strongest buying signal on
       the list -- and that classification swallowed the fact that it is
       also a direct question somebody is waiting on an answer to. The rail
       read the interest, decided the ladder still had discovery to do, and
       asked how their reception works at a prospect who had just asked what
       the product was.

       The move stays what it is. This is the second thing that was true
       about the same sentence and had nowhere to go. */
    asksOutright: asksSomething(prospectSaid),
    /* The two facts the psychology engine prices and Guided describes. */
    ignoredBoundary,
    pushedAfterRefusal,
    /* True when the founder did something that answers the moment, used
       only to let a genuine recovery outrank a stale negative. */
    constructive: response === RESPONSE.EXPLORED || response === RESPONSE.ADAPTED
      || response === RESPONSE.RECOVERED || response === RESPONSE.ACKNOWLEDGED,
  });
}
