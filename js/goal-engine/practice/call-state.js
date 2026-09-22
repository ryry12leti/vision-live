import { founderAdvancedSomething } from './evidence-gates.js';

/* ════════════════════════════════════════════════════════════════════════
   WHAT IS ACTUALLY HAPPENING IN THIS CALL.

   Six facts, and deliberately only six. Not a graph: a graph of unreliable
   labels is a filing system for wrong answers, and every field here has to
   earn its place by gating a decision something else will make later.

     1  pitch permission     -- may the founder explain the offer yet
     2  active objection     -- what is standing in the way right now
     3  refusal state        -- how firmly they have said no, and whether
                                they have asked not to be contacted
     4  answered questions   -- so asking again can be recognised as asking again
     5  facts and unknowns   -- what they have told us, and what they have
                                REFUSED to tell us, which is not the same as
                                never having been asked
     6  qualification        -- how far the need has actually been established

   Every transition is deterministic and cites the turn that caused it. No
   model runs here. Nothing in this file scores anything; it records what is
   true so that something else can judge fairly.

   Only grounded, completed founder turns may move the state. A sentence the
   microphone cut in half is not evidence that a question was asked.
   ══════════════════════════════════════════════════════════════════════ */

export const CALL_STATE_VERSION = 'practice_call_state_v1';

export const REFUSAL = Object.freeze({
  NONE: 'none', SOFT: 'soft_no', HARD: 'hard_no', DO_NOT_CONTACT: 'do_not_contact',
});
/* Exported so a rewind can ask whether a refusal in a discarded branch
   outranks the one at the checkpoint, without forming a second opinion
   about how refusals are ordered. */
export const REFUSAL_RANK = Object.freeze({ none: 0, soft_no: 1, hard_no: 2, do_not_contact: 3 });

export const QUALIFICATION = Object.freeze([
  'nothing',            /* 0 nothing established                                */
  'situation',          /* 1 they described how things currently work           */
  'problem',            /* 2 they acknowledged something is not working         */
  'intent',             /* 3 they said they want it different                   */
  'timing_or_authority',/* 4 they named when, who decides, or what it is worth  */
]);

/* ── the language that is unambiguous enough to act on ─────────────────
   Everything here is a phrase a person says on purpose. Nothing infers mood,
   interest or personality. */
/* Exported for the same reason HARD_NO/SOFT_NO already are: the hangup-
   severity split in prospect-behaviour.js has to recognise an EXPLICIT
   stop request as its own thing, distinct from ordinary refusal language --
   continuing to push after "take us off your list" stays hard-terminal
   with no judge involved, and a second private copy of this pattern is
   exactly how the two layers would end up disagreeing about what one
   sounds like. */
export const DO_NOT_CONTACT = /\b(do ?n[o']?t (call|contact|ring|phone) (me|us)? ?again|remove (me|us) from your (call )?list|take (me|us) off (your|the|my|this) (call )?list|stop calling)\b/i;
export const HARD_NO = /\b(not interested|no,? thank you|we're not interested|i'?ll leave it there|please stop|goodbye|end of (the )?call)\b/i;
export const SOFT_NO = /\b(we'?re happy with|not (actively )?looking|not (right )?now|not a priority|we already have|no,? we'?re fine|not for us)\b/i;

/* The prospect inviting the offer. "What is this regarding?" is NOT this --
   that is asking why you called, not asking to be sold to. */
/* ── AND ASKING WHY YOU CALLED IS NOT ONE ─────────────────────────────
   P5R widened this to "what's this about / what are you calling about /
   what can I do for you", on the reasoning that a founder who answers a
   direct question should not be convicted for it. That reasoning erased the
   line the comment above draws, and it was never gated: with the widening
   in, "What is this regarding?" GRANTED pitch permission, so
   `pitched_without_permission` could not fire after the commonest opening
   any gatekeeper uses -- 13 of 13 labelled premature pitches went uncaught,
   and only the pre-existing suites noticed.

   The distinction stands: asking what you want is not asking to be sold to.
   Answering "what's this regarding?" with a REASON is not a pitch and was
   never convicted as one; answering it with the full offer still is. */
const PITCH_INVITED = /\b(what (exactly )?(are you|do you) (offering|proposing|selling)|what (is|are) (it|you) you (do|offer)|what would (you|that) (involve|look like)|what are you suggesting|tell me (more|what you do)|what service are you offering)\b/i;

/* ── "WHY ARE YOU CALLING?" IS A QUESTION, NOT A LICENCE ───────────────
   A direct request for the REASON for the call earns an answer, and the
   answer names what you do -- so convicting that one turn of pitching
   without permission punishes the founder for replying. But it is not
   permission either: P5R first fixed this by folding these phrasings into
   PITCH_INVITED, which grants permission for the WHOLE REMAINING CALL, and
   that silently excused every later pitch too. Measured: 13 of 13 labelled
   premature pitches stopped being caught.

   Exported separately, and consumed as a ONE-TURN exemption by the rule
   engine: the turn that answers the question is excused, and the call's
   permission state is untouched. */
export const ASKED_WHY_YOU_CALLED = /\b(what(?:'s| is) (?:this|it) (?:about|regarding|in aid of)|what are you (?:calling|ringing|phoning) (?:about|for|in connection with)|what(?:'s| is) this\?|what can i do for you|how can i help you)\b/i;

/* An explicit refusal to answer -- different from not having been asked. */
const REFUSED_TO_ANSWER = /\b(i (do ?n[o']?t|couldn'?t|can'?t) (have|say|give|share|quote)|no breakdown|not (something )?(we|i) (normally )?discuss|off the top of my head|not in front of me|do ?n[o']?t track)\b/i;

/* Objections, as the prospect states them. */
/* A DENIAL IS ONLY AN OBJECTION WHEN IT PUSHES BACK ON THE FOUNDER.

   "We don't currently use an agency" and "I haven't said we're looking to
   outsource" are the same grammatical shape and opposite conversational
   acts. The first answers a question. The second rejects something the
   founder advanced. Nothing IN the sentence separates them -- only the move
   it answers does, which is why this needs the founder's previous turn and
   why reading the prospect line alone could never have worked.

   Two gates, both required: the line has to reject a claim, an assumption,
   or an interpretation, AND the founder has to have actually put one
   forward. `founderAdvancedSomething` decides that second question, and it
   is the only thing that decides it -- no second opinion about what counts
   as a claim, an offer, or an ask. */
const DENIAL_OBJECTIONS = [
  /* Contractions are normalised for apostrophes, not expanded, so "i didn't
     say" and "i did not say" are two different strings and only the first
     was here. A prospect using the full form pushed back and the engine
     heard nothing. */
  /* "did not" takes the bare verb: it is "I did not SAY", never "did not
     said". Folding it into the perfect-tense branch produced a pattern that
     could only match ungrammatical English, so a prospect using the full
     form pushed back and the engine heard nothing. */
  [/\b(?:i (?:haven't|have not|never) said|i (?:did not|didn't) say|that's not what i said)\b/i, 'disputes_attribution'],
  [/\b(?:you'?re assuming|you are assuming|you'?ve assumed|you assumed)\b/i, 'disputes_assumption'],
  [/\b(?:i don't agree|i disagree|that's not (?:really )?how we see it|that's not our view)\b/i, 'disputes_interpretation'],
  /* "WE HANDLE THE PHONES OURSELVES" WAS ADDED HERE AND TAKEN BACK OUT.
     Said back to a pitch it is the incumbent objection, and a real blind
     call raised it verbatim against a founder selling phone cover. Asked
     how things work, it is the single most useful answer a founder can get.

     `lastFounderMove.asserted` looked like the gate that separates them --
     it is what separates the denials above -- and it is not, because
     `founderAdvancedSomething` passes on ordinary discovery questions,
     including three of VISION's own coaching lines: "Walk me through how it
     runs at the moment.", "When that does not go to plan, what actually
     happens?" and "What does that cost you when it goes wrong?". So the
     founder says exactly what the rail told him to, the prospect answers it
     honestly, and the engine books an objection against him -- in the
     SCORED review, not just the live rail.

     Separating the two readings needs to know he PITCHED, which is a
     classifier fact this file is not given. Until it is, the live rail
     reads the objection from `interaction-read` on the turn it happens,
     where being wrong costs one suggestion rather than a mark. */
];

const OBJECTIONS = [
  [/\bwe already have (someone|a|an)\b|\balready (working|work) with\b/i, 'already_has_provider'],
  [/\bwe'?re happy with (what|how)\b|\bhappy as we are\b/i, 'satisfied'],
  [/\b(too expensive|out of our budget|no budget|cannot afford|can'?t afford)\b/i, 'price'],
  [/\bnot (actively )?looking\b|\bnot a priority\b|\bnot right now\b/i, 'no_priority'],
  [/\b(need to|have to) (speak|check) (to|with)\b|\bnot my decision\b|\bsomeone else (decides|handles)\b/i, 'authority'],
];

/* Ground the qualification ladder in things the prospect actually said. */
const SITUATION = /\b(we (get|use|run|handle|do)|mostly|usually|our (patients|clients|customers|team)|through (our|the))\b/i;
/* EVERY ALTERNATIVE HERE IS WRAPPED BY \b(...)\b, so each one has to match
   a WHOLE word. "frustrat" is not a whole word, so it matched nothing a
   prospect has ever said -- not "frustration", not "frustrated". The same
   trap silently killed the plurals: a prospect saying "we have problems
   with it" was not credited with having a problem, and the founder's close
   was then called unearned and interrupted mid-call.

   The concepts are unchanged. Only the word forms people actually use are
   added, and each is spelled out rather than left to \w*, so nothing
   unrelated ("problematic", "issuer", "gapping") slips in behind a stem. */
const PROBLEM = /\b(problems?|issues?|struggl(?:e|es|ing)|gaps?|drop off|drops off|not (working|great)|could be better|frustrat(?:e|ed|es|ing|ion|ions)|too (few|many)|wish we)\b/i;
const INTENT = /\b(we (want|would like|need) to|we'?re trying to|looking to (grow|improve|fix|change)|keen to)\b/i;
const TIMING_AUTHORITY = /\b(next (week|month|quarter)|by (the end of|then)|i (decide|sign off)|the (owner|principal|practice manager) (decides|would)|budget (is|of)|we (spend|pay))\b/i;

/* THE MODEL WRITES TYPOGRAPHIC APOSTROPHES. "I don’t have that breakdown"
   and "I don't have that breakdown" are the same sentence, and matching only
   the straight one silently switched off refusal and negation detection on
   every real prospect line. Normalised once, here, so no pattern below has to
   remember. */
const txt = (v) => String(v == null ? '' : v)
  .replace(/[‘’ʼ]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-')
  .trim();
const isQuestion = (t) => /\?\s*$/.test(txt(t));

/* "We're not actively looking to change anything" is not intent to change.
   Reading it as intent is exactly the vocabulary-matching this record exists
   to replace, so the qualification ladder only climbs on an AFFIRMED phrase:
   the clause containing the match must not be negated. */
/* A negator or a reporting verb in front of a self-negating phrase. */
const AHEAD = /\b(not|never|no|isn't|aren't|don't|doesn't|didn't|won't|wouldn't|can't|cannot|couldn't)\b|\b(say|says|said|saying|tell|tells|told|telling|ask|asks|asked|asking|mean|means|meant|suggest|suggests|think|thought|hear|heard|reckon)\b/i;
function standsAlone(said, re) {
  const idx = said.search(re);
  if (idx < 0) return false;
  /* P0: "We're not interested, so please remove us from your call list" was
     failing open because the whole sentence counted as the preceding clause.
     Commas and connectives separate clauses; only the one the phrase sits in
     can disqualify it. */
  const before = said.slice(0, idx).split(/[.!?;,:]|\b(?:but|so|although|though|however)\b/).pop();
  return !AHEAD.test(before || '');
}
const DENIAL_RE = /\b(i (didn't|did not|never) say|that's not what i said|i wouldn't say|i wouldn't assume)\b/i;
const NEGATOR = /\b(not|never|no|nothing|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|can'?t|cannot|couldn'?t|hardly|barely)\b/i;
function affirms(said, re) {
  const m = re.exec(said);
  if (!m) return false;
  const clause = said.slice(0, m.index).split(/[.!?;]/).pop();
  return !NEGATOR.test(clause);
}

export function initialCallState(handoff = {}) {
  const unknowns = Array.isArray(handoff.unknowns) ? handoff.unknowns : [];
  return {
    version: CALL_STATE_VERSION,
    pitchPermission: { granted: false, atSeq: null, evidence: null },
    activeObjection: null,                 /* { kind, said, atSeq, against? }   */
    /* The founder's previous complete turn, kept ONLY so a prospect denial
       can be read against what it answers. Not scored, not shown. */
    lastFounderMove: null,                 /* { atSeq, said, asserted }         */
    refusal: { state: REFUSAL.NONE, atSeq: null, evidence: null },
    answeredQuestions: [],                 /* { question, askedAtSeq, answer }  */
    facts: { disclosed: [], unknowns: unknowns.map((u) => ({ text: txt(u), status: 'open', atSeq: null })) },
    qualification: { level: 0, label: QUALIFICATION[0], basis: [] },
    turnsSeen: 0, turnsIgnored: 0,
    /* Who said a word FIRST, and what the prospect has explicitly denied.
       Not scored, not shown -- only used to refuse bad evidence. */
    provenance: { founderTerms: [], prospectTerms: [], deniedTerms: [] },
  };
}

function raiseRefusal(state, next, seq, said) {
  if (REFUSAL_RANK[next] > REFUSAL_RANK[state.refusal.state]) {
    state.refusal = { state: next, atSeq: seq, evidence: said.slice(0, 200) };
  }
}

function raiseQualification(state, level, seq, said) {
  if (level > state.qualification.level) {
    state.qualification = {
      level, label: QUALIFICATION[level],
      basis: state.qualification.basis.concat([{ level, atSeq: seq, evidence: said.slice(0, 160) }]),
    };
  }
}

/* One turn in, the same state object back, advanced.
   `turn` is { speaker, text, sequence, complete, creditEligible }. */
/* PASS 3 CORRECTION. Pass 2 read call D up to `problem` on this line:
     "Possibly, but I'd need to understand what you mean by the gap and how
      you'd assess it."
   Three things are wrong with it as evidence, and each is now a gate:
     - `gap` is the FOUNDER's word, introduced at D#4. A prospect echoing your
       jargon has disclosed nothing.
     - `Possibly` is a hedge. One hedged line is never a fact.
     - two turns earlier the prospect said "I didn't say there was a gap to
       investigate", and a denial outranks a later inferred agreement.
   With all three, call D correctly stops at `situation`. */
function qualificationAllowed(said, re, ctx) {
  if (HEDGE_RE.test(said)) return false;
  const m = re.exec(said);
  if (!m) return false;
  const terms = m[0].toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length >= 3);
  return terms.every((t) => {
    if (ctx.deniedTerms.has(t)) return false;
    if (ctx.prospectTerms.has(t)) return true;
    return !ctx.founderTerms.has(t);
  });
}
const HEDGE_RE = /\b(suppose|possibly|perhaps|maybe|might|could|probably|i guess|i imagine|sort of|kind of)\b/i;
/* P2: the gate existed for the word "gap", and the filter dropped it -- three
   letters. Short content words are exactly the jargon a founder introduces. */
const TERM_STOP = new Set(('the and for you our are was has had not but with that this from they them our'
  + ' your who how why what when where can will would could our its it is be do does did are am').split(' '));
const termsOf = (t) => txt(t).toLowerCase().replace(/[^a-z0-9'\s]/g, ' ')
  .split(/\s+/).filter((w) => w.length >= 3 && !TERM_STOP.has(w));

/* ── HISTORY IS NOT A POINTER ─────────────────────────────────────────
   This mutated the state it was given and returned the same object, so a
   caller keeping a snapshot per turn kept N references to ONE object that
   went on changing. By the end of the call every "state before turn 2" was
   the state after turn 9.

   Measured on the six-industry proof, 2026-08-23: a prospect said "please
   take us off your list" on the final turn, and the rule engine convicted
   three EARLIER founder turns of `sold_after_do_not_contact` — including a
   polite discovery question asked three turns before the refusal existed.
   The most severe accusation in the taxonomy, on innocent turns, taking the
   Biggest Leak and two of three correction cards.

   Nothing about the rules was wrong. They asked for the state before a turn
   and were handed the state after the call.

   Two call sites had already worked around it by hand-cloning
   (practice-benchmark-baseline.mjs and li-practice-runner.js) — which is
   how it survived: the workaround looked like ordinary defensive copying
   rather than a symptom. Fixing it at the source protects every caller,
   including the ones that never knew they needed it.

   PURE, so future information cannot travel backwards by construction
   rather than by each caller remembering to copy. The state is plain JSON —
   no dates, maps or functions — so a structured clone is exact. */
const cloneState = (s) => (typeof structuredClone === 'function'
  ? structuredClone(s) : JSON.parse(JSON.stringify(s)));

export function advanceCallState(state, turn) {
  const s = state ? cloneState(state) : initialCallState();
  const said = txt(turn && turn.text);
  const seq = turn && typeof turn.sequence === 'number' ? turn.sequence : null;
  if (!said) return s;

  /* A HALF-HEARD SENTENCE IS NOT EVIDENCE. A founder turn the microphone cut
     may not open a question, grant permission, or move qualification. The
     prospect's lines are validated server text and are always grounded. */
  if (turn.speaker === 'founder' && turn.complete !== true) {
    s.turnsIgnored += 1;
    return s;
  }
  s.turnsSeen += 1;

  if (turn.speaker === 'founder') {
    termsOf(said).forEach((w) => {
      if (!s.provenance.founderTerms.includes(w)) s.provenance.founderTerms.push(w);
    });
    if (isQuestion(said)) {
      s.answeredQuestions.push({ question: said.slice(0, 300), askedAtSeq: seq, answer: null, answeredAtSeq: null });
    }
    s.lastFounderMove = { atSeq: seq, said: said.slice(0, 200), asserted: founderAdvancedSomething(said).pass };
    /* AN OBJECTION IS ANSWERED BY THE VERY NEXT THING THE FOUNDER SAYS --
       well or badly. Whether it was handled or trampled is judged elsewhere,
       against the state as it stood BEFORE this turn; what matters here is
       that it stops being open afterwards.

       Left open it never closed at all, and a founder who acknowledged the
       objection, explored it, and closed three turns later was convicted of
       closing over an objection he had already dealt with. That is the same
       shape of bug as state time-travel: a fact from one moment reaching
       forward and convicting turns it has nothing to do with. */
    s.activeObjection = null;
    return s;
  }

  /* ── the prospect ──────────────────────────────────────────────────── */
  /* "I'm not asking you to stop calling" is not a do-not-contact, and neither
     is "my partner said don't change anything". The phrase carries its own
     negator, so what disqualifies it is a negator or a reporting verb sitting
     in FRONT of it. Refusal is monotonic, so this is the one place where a
     false positive can never be walked back -- it gets the strictest gate. */
  if (DO_NOT_CONTACT.test(said) && standsAlone(said, DO_NOT_CONTACT)) {
    raiseRefusal(s, REFUSAL.DO_NOT_CONTACT, seq, said);
  } else if (HARD_NO.test(said) && standsAlone(said, HARD_NO)) raiseRefusal(s, REFUSAL.HARD, seq, said);
  else if (SOFT_NO.test(said)) raiseRefusal(s, REFUSAL.SOFT, seq, said);

  if (!s.pitchPermission.granted && affirms(said, PITCH_INVITED)) {
    s.pitchPermission = { granted: true, atSeq: seq, evidence: said.slice(0, 200) };
  }

  const hit = OBJECTIONS.find(([re]) => re.test(said));
  if (hit) s.activeObjection = { kind: hit[1], said: said.slice(0, 200), atSeq: seq };
  else {
    /* A denial only becomes an objection against something the founder put
       forward. The move it answers is recorded on the objection so a later
       reader can see WHAT was pushed back on, not just that something was. */
    const denial = DENIAL_OBJECTIONS.find(([re]) => re.test(said));
    if (denial && s.lastFounderMove && s.lastFounderMove.asserted) {
      s.activeObjection = {
        kind: denial[1], said: said.slice(0, 200), atSeq: seq,
        against: { atSeq: s.lastFounderMove.atSeq, said: s.lastFounderMove.said },
      };
    }
  }

  /* The most recent unanswered question is now answered -- including when the
     answer is a refusal to answer, which is itself a fact about the call. */
  if (DENIAL_RE.test(said)) {
    termsOf(said).forEach((w) => {
      if (!s.provenance.deniedTerms.includes(w)) s.provenance.deniedTerms.push(w);
    });
  }
  for (let i = s.answeredQuestions.length - 1; i >= 0; i -= 1) {
    if (s.answeredQuestions[i].answer === null) {
      s.answeredQuestions[i].answer = said.slice(0, 300);
      s.answeredQuestions[i].answeredAtSeq = seq;
      s.answeredQuestions[i].refused = REFUSED_TO_ANSWER.test(said);
      break;
    }
  }

  if (REFUSED_TO_ANSWER.test(said)) {
    /* Asked and declined is not the same as never asked, and the difference
       decides whether a founder could have discovered anything at all. */
    const open = s.facts.unknowns.find((u) => u.status === 'open');
    if (open) { open.status = 'refused'; open.atSeq = seq; }
  } else {
    s.facts.disclosed.push({ text: said.slice(0, 300), atSeq: seq });
    const ctx = {
      founderTerms: new Set(s.provenance.founderTerms),
      prospectTerms: new Set(s.provenance.prospectTerms),
      deniedTerms: new Set(s.provenance.deniedTerms),
    };
    if (affirms(said, SITUATION) && qualificationAllowed(said, SITUATION, ctx)) raiseQualification(s, 1, seq, said);
    if (affirms(said, PROBLEM) && qualificationAllowed(said, PROBLEM, ctx)) raiseQualification(s, 2, seq, said);
    if (affirms(said, INTENT) && qualificationAllowed(said, INTENT, ctx)) raiseQualification(s, 3, seq, said);
    if (affirms(said, TIMING_AUTHORITY) && qualificationAllowed(said, TIMING_AUTHORITY, ctx)) raiseQualification(s, 4, seq, said);
    termsOf(said).forEach((w) => {
      if (!s.provenance.prospectTerms.includes(w)) s.provenance.prospectTerms.push(w);
    });
  }
  return s;
}

/* Replay a whole call. Pure: same turns in, same state out, every time. */
export function buildCallState(turns = [], handoff = {}) {
  return (turns || []).reduce((s, t) => advanceCallState(s, t), initialCallState(handoff));
}

/* What the record is for: the small set of questions other layers will ask. */
export function stillSellingAfterStop(state, founderTurnsAfter = []) {
  if (!state || REFUSAL_RANK[state.refusal.state] < REFUSAL_RANK[REFUSAL.DO_NOT_CONTACT]) return false;
  return founderTurnsAfter.some((t) => t && t.complete === true && txt(t.text).length > 0);
}
export function unknownsRefused(state) {
  return (state && state.facts.unknowns.filter((u) => u.status === 'refused').length) || 0;
}
