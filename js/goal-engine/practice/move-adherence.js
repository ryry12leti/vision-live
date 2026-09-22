/* ════════════════════════════════════════════════════════════════════════
   MOVE ADHERENCE — does this sentence execute the move it was written for?

   The wording layer decides HOW the founder says something. It does not get
   to decide WHAT he does. That line was crossed in testing: asked to
   establish how cover works today, the composer returned "when it gets
   tight, does a shift ever go uncovered?" -- a better sentence executing a
   different move. Good sales advice for the wrong moment is worse than
   clumsy advice for the right one, because the founder cannot tell.

   What separates the moves is not tone, it is what the question is ABOUT.
   Establishing a situation asks about the MECHANISM: who does what, and in
   what order. Finding a problem asks what that mechanism COSTS. Intent asks
   whether they want it different. Those are different objects, and a
   sentence can be tested for which one it reaches for.

   This is code, not a model. A model asked to check its own output invents
   a second opinion about the move, which is the thing being prevented.
   ══════════════════════════════════════════════════════════════════════ */

import { contentOverlap } from './evidence-gates.js';

/* TWO LINES THAT SAY THE SAME THING ARE ONE LINE.

   Filtering for adherence shrinks the candidate pool, and what survives can
   be near-identical -- "do those calls ever have to wait?" alongside "when
   the branches are busy, do calls ever have to wait?". Exact-match dedupe
   never saw it, because they differ by a clause.

   Measured on real pairs from the live runs, restatements score 0.60-0.67
   content-word overlap and genuinely different angles score 0.00-0.33, so
   the line sits between them with margin on both sides. Reusing the
   existing overlap predicate rather than writing a second opinion about
   what "similar" means. */
const TOO_SIMILAR = 0.5;

const norm = (v) => String(v == null ? '' : v)
  .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').trim();

/* What the sentence is asking ABOUT. */
const MECHANISM = /\b(what happens|how do(?:es)? (?:it|that|you|they)|how is|how are|how'?s that (?:handled|done)|who\b|walk me through|talk me through|what do you do when|what'?s the process|how does that work|what happens next|how it works|what goes on|look(?:s)? like|what does a (?:normal|typical|average)|how (?:that|it) runs)\b/i;
/* WHAT IT COSTS THEM, in the words people use for it. Wiring the gate into
   the real composer showed this was too literal: "does the backlog ever
   hold up anything else?" and "is that a real cost, or just a busy week?"
   are both asking what the situation costs, and both were being thrown out
   for not saying the word "cost" in the one shape this knew. */
/* WHAT IT COSTS THEM -- in money, time, temper or lost work. This does not
   demand the word "cost", because almost nobody uses it. Live, the literal
   version threw out four consecutive lines from Terra, Sol and the rewrite
   on one card, and "headache" could never match "headaches" for the same
   reason the qualification ladder's stems could not match their own words. */
const COST = /\b(problems?|issues?|difficult|difficulty|trouble|costs?|lose|losing|lost|uncovered|missed?|misses|miss out|headaches?|nuisance|hassle|grief|pressure|struggl(?:e|es|ing)|slips?|slipping|fall through|falls through|goes? wrong|ever mean|bite you|bites?|hurt|painful|drop(?:ped)? off|gone elsewhere|holds? up|held up|hold(?:ing)? (?:you|it|anything) up|set you back|knock[- ]on|delays?|delayed|leave you short|left short|chas(?:e|es|ing)|complain(?:s|ing|t|ts)?|left waiting|waiting (?:around|on)|falls? behind|irritation|irritating|annoying|annoy(?:s|ance)?|feels? it|bears? the brunt|picks? up the pieces|holds? (?:\w+ )?up|held (?:\w+ )?up)\b/i;

/* CONSEQUENCE OF SOMETHING GOING WRONG. "What happens when that gets
   missed?" opens exactly like a mechanism question and is asking about
   fallout, so the negative condition is what separates them -- "what
   happens when someone calls" stays a situation question. */
const ADVERSE = /\b(nobody|no one|no-one|missed?|misses|goes? wrong|fall(?:s)? through|fails?|failed|late|too late|cannot|can'?t|do(?:es)? not|don'?t|never|forgets?|forgot|breaks?|broken)\b/i;
const CONSEQUENCE = /\b(what then|what (?:\w+ ){0,2}happens|what does that mean|what do you do)\b/i;
const DESIRE = /\b(want (?:it|that|them)|want to (?:change|fix|improve|sort)|would you (?:like|want)|looking to (?:change|fix|improve)|keen to|wish|do anything about|change that|worth changing|happy (?:with|as) (?:it|things)|could change|worth doing something about|tried to (?:change|fix|sort))\b/i;
const TIMING = /\b(when would|how soon|who decides|signs? off|budget|what would it be worth|who else would|by when|this year|next year|this quarter|for it to happen|realistically be)\b/i;
/* ASKING TO EXPLAIN, not the politeness that opens a question. "Can I ask
   whether that is actually the case?" is a verifying question wearing a
   courtesy; treating it as a permission request threw a correct line out of
   the deterministic library. Only a bare "can I" counts. */
/* `worth me` ALONE WAS TOO BROAD. It is here to catch "is it worth me
   telling you what we do" -- asking leave to pitch. It also caught "Is it
   worth me talking to whoever handles that instead?", which is the routing
   move asking to be sent to the decision maker, and threw that line out of
   its own library. Bound to the verbs that actually mean explaining the
   offer; `earn_permission`'s own line still matches on "worth me telling". */
const PERMISSION = /\b(can i(?! ask\b)|could i(?! ask\b)|may i(?! ask\b)|mind if i|would it help if i|worth me (?:telling|explaining|running|showing|sending|going)|shall i (?:send|explain|show)|do you want (?:the|me to)|would it be useful if i|want me to (?:explain|run through|tell))\b/i;
/* THREE OF THE FOUR LINES IN THE LIBRARY FAILED THIS.
   `ask_for_next_step` ships four phrasings and only "Shall we put some time
   in to look at it properly?" ever passed, so the move had a pool of one:
   the rail offered it once and then went silent, at the end of a call the
   founder had actually qualified. Silent for a purely lexical reason, in
   the subsystem whose entire complaint was that it repeats itself and then
   stops being useful.

   The additions are all ways of asking for the next step that do not use
   the word "book" or "diary" -- proposing a call, asking what they would
   need to see, or naming the next step outright. This pattern is also a
   FORBID in eleven other contracts, so it is kept to phrases that only
   appear when somebody is moving the conversation forward. */
const NEXT_STEP = /\b(shall we|would (?:\w+ ){0,3}(?:work|suit)|put (?:something|time|it) in|in the diary|book (?:a|something|it)|jump on a call|(?:ten|fifteen|twenty|thirty) minutes|the next step|a short call|before deciding|want to see before)\b/i;
const OBJECTION = /\b(when you say|what makes you say|what'?s behind|what made you|how did you (?:choose|pick|land on)|is that because|say more about|what does that look like|what would have to be different|how long has that been|worth another look|before i say anything)\b/i;

/* Polar questions test a claim. Open questions ask how something works. */
/* Polar questions test a claim -- including the elliptical kind, where the
   auxiliary is simply dropped. "Anything going missing?" and "Much slipping
   through?" are how people actually ask, and requiring "does anything..."
   would fail a founder for sounding like a person. */
const POLAR = /^(?:[^.?!]*\b)?(?:do|does|did|is|are|was|were|have|has|had|can|could|would|will|any|anything|anyone|much|many)\b[^?]*\?/i;
const HOW_OFTEN = /\b(how often|how many times|how much of the time|ever)\b/i;
const IS_QUESTION = /\?\s*$/;
/* Asking WHO owns it, or asking to be taken to them. Deliberately narrow:
   "who decides" belongs to TIMING as well, and that overlap is correct --
   both moves want the same fact for different reasons. */
const ROUTING = /\b(who (?:would be|is) the (?:best|right) person|who (?:would i|should i|do i) (?:speak|talk) to|who (?:owns|handles|decides|would decide)|put me through|point me (?:to|at)|worth (?:me )?(?:speaking|talking) to|should i be (?:speaking|talking) to)\b/i;

/* ── CONCEDING SOMETHING, RATHER THAN ASKING FOR SOMETHING ────────────
   What separates these from every pattern above is that they do not reach
   for a fact at all. They give ground. The thing to test for is that the
   ground is actually given and not immediately taken back. */
const ACCEPTS = /\b(understood|of course|no problem|that is fair|that'?s fair|fair enough|will do|i'?ll do that|i will do that|thanks for telling me|i (?:will|won'?t) not push|i will not push|i won'?t push|go through the proper|i'?(?:ll|ve)? ?(?:will )?go through|noted)\b/i;
const RESPECTS_TIME = /\b(be quick|bad (?:moment|time)|better time|call (?:you )?back|another time|thirty seconds|one question|let you go|won'?t keep you|i am gone|i'?m gone)\b/i;
const RESTARTS = /\b(start again|back up|put (?:it|that) (?:a )?different|(?:was|is|been) not clear|wasn'?t clear|isn'?t clear|not explained|let me (?:start|back|try|put)|my fault|sorry)\b/i;
const EXITS = /\b(leave it there|thanks for your time|thanks for hearing me out|let you get on|not (?:one )?for you|thanks for being straight|i'?ll let you|i will let you|appreciate your time|leave you to it)\b/i;
/* Selling, in the shape it takes when it is smuggled in behind a
   concession: "of course, but what we do is..." */
const PITCHES = /\bwe (?:do|run|handle|provide|offer|specialise|work with)\b/i;

/* Asking who has answered the phone. Deliberately narrow, and separate
   from ROUTING's "who should I speak to": this asks about the person
   already on the line, not for a different one. */
const ASKS_WHO = /\b(?:who am i (?:speaking|talking) (?:with|to)|who have i got|who (?:am i|is this)\b|who i am talking to|did not catch your name|didn'?t catch your name|what was your name|who are you|may i ask who)/i;

/* Inviting them to expand on something they raised. Distinct from COST,
   which asks what it is worth -- this asks what it looks like. */
const SAY_MORE = /\b(?:say more about|how does that show up|how does it show up|how long has that been|who feels that most|what does that look like|would fix first|tell me more about)\b/i;

const LETS_GO = /\b(?:of course|no problem|thanks for your time|thanks for taking the call|i will let you get on|i'?ll let you get on|easy to find|that is fine|that'?s fine|understood)\b/i;

const PASS = (reason) => ({ pass: true, reason });
const FAIL = (reason) => ({ pass: false, reason });

/* Per move: what the sentence must reach for, and what disqualifies it.
   A move absent from this table is not gated -- silence here means "no
   contract expressed", never "anything goes unnoticed", which is why
   `adheres` reports `no_contract_for_move` rather than passing quietly. */
const CONTRACT = Object.freeze({
  establish_situation: {
    require: (t) => MECHANISM.test(t),
    forbid: [['searches_for_a_problem', COST], ['asks_about_intent', DESIRE],
      ['asks_for_time', NEXT_STEP], ['asks_permission', PERMISSION], ['qualifies_timing', TIMING]],
    missing: 'does_not_ask_how_it_works',
  },
  find_the_problem: {
    require: (t) => COST.test(t) || (CONSEQUENCE.test(t) && ADVERSE.test(t)),
    forbid: [['asks_for_time', NEXT_STEP], ['asks_permission', PERMISSION]],
    missing: 'does_not_ask_what_it_costs',
  },
  verify_the_assumption: {
    /* Testing a claim is polar, or asks how often it happens. */
    require: (t) => IS_QUESTION.test(t) && (POLAR.test(t) || HOW_OFTEN.test(t)),
    forbid: [['asks_for_time', NEXT_STEP], ['asks_permission', PERMISSION]],
    missing: 'does_not_test_the_claim',
  },
  establish_intent: {
    require: (t) => DESIRE.test(t),
    forbid: [['asks_for_time', NEXT_STEP]],
    missing: 'does_not_ask_whether_they_want_it_different',
  },
  qualify_timing: {
    require: (t) => TIMING.test(t),
    forbid: [['asks_permission', PERMISSION]],
    missing: 'does_not_qualify_timing_authority_or_value',
  },
  explore_the_objection: {
    require: (t) => OBJECTION.test(t),
    forbid: [['asks_for_time', NEXT_STEP], ['pitches_instead', /\bwe (?:do|run|handle|provide)\b/i]],
    missing: 'does_not_open_up_the_objection',
  },
  earn_permission: {
    require: (t) => PERMISSION.test(t),
    forbid: [['asks_for_time', NEXT_STEP]],
    missing: 'does_not_ask_permission',
  },
  ask_for_next_step: {
    require: (t) => NEXT_STEP.test(t),
    forbid: [],
    missing: 'does_not_ask_for_a_next_step',
  },
  /* ASKING WHO, NOT ASKING MORE. The failure mode this gate exists to stop is
     a line that sounds contrite and then carries on selling or carries on
     interrogating the person who already said it is not their call. */
  reach_the_decision_maker: {
    require: (t) => ROUTING.test(t),
    /* NOT `MECHANISM`. It contains a bare `who\b` -- it is there to catch
       "who does that at the moment?" as a situation question -- so forbidding
       it here rejected every routing line in the library, including the one
       this move exists to produce. `require: ROUTING` is the protection: a
       sentence that asks how their process works cannot satisfy it. */
    forbid: [['pitches_instead', /\bwe (?:do|run|handle|provide|offer)\b/i],
      ['asks_for_time', NEXT_STEP], ['asks_permission', PERMISSION]],
    missing: 'does_not_ask_who_decides_or_to_be_put_through',
  },

  /* ── THE MOVES THAT ARE NOT DISCOVERY ────────────────────────────────
     Every contract above tests what a QUESTION reaches for. These four
     execute by conceding something, and the failure mode is the opposite
     one: a line that acknowledges the boundary and then carries straight on
     selling or asking. So each requires the concession and forbids the
     sell.

     `let_them_finish` and `answer_their_question` are absent on purpose —
     they carry no wording at all, so there is nothing to gate. */
  respect_the_boundary: {
    require: (t) => ACCEPTS.test(t),
    forbid: [['asks_for_time', NEXT_STEP], ['asks_permission', PERMISSION],
      ['pitches_instead', PITCHES]],
    missing: 'does_not_accept_the_boundary',
  },
  acknowledge_the_pressure: {
    require: (t) => RESPECTS_TIME.test(t),
    forbid: [['asks_for_time', NEXT_STEP], ['pitches_instead', PITCHES]],
    missing: 'does_not_acknowledge_the_bad_moment',
  },
  clear_up_the_confusion: {
    /* PERMISSION is deliberately NOT forbidden: "can I put that a different
       way?" is asking leave to rephrase, which is the move itself. */
    require: (t) => RESTARTS.test(t),
    forbid: [['asks_for_time', NEXT_STEP], ['pitches_instead', PITCHES]],
    missing: 'does_not_start_again',
  },
  /* Asking WHO, and nothing else. The way to get this wrong is to ask
     their name and then carry straight on with the pitch or the ladder,
     which is how it would quietly become another discovery question. */
  identify_the_person: {
    require: (t) => ASKS_WHO.test(t),
    /* NOT `MECHANISM` -- it carries a bare `who\b` to catch "who does that
       at the moment?" as a situation question, and it therefore rejects
       every line this move exists to produce. `require: ASKS_WHO` is the
       protection; the routing move above carries the identical warning
       because it was bitten by the identical thing. */
    forbid: [['asks_for_time', NEXT_STEP], ['pitches_instead', PITCHES],
      ['searches_for_a_problem', COST]],
    missing: 'does_not_ask_who_is_on_the_phone',
  },
  /* Asking about the thing THEY named. The way to get this wrong is to
     answer it -- to reach for the offer on the turn it was volunteered --
     so pitching and asking for time are both out, and the line has to
     reach for what it costs or how it shows up rather than for a fix. */
  explore_their_pain: {
    require: (t) => COST.test(t) || SAY_MORE.test(t),
    forbid: [['pitches_instead', PITCHES], ['asks_for_time', NEXT_STEP],
      ['asks_permission', PERMISSION]],
    missing: 'does_not_ask_what_it_costs_or_how_it_shows_up',
  },
  /* Letting them go. The failure is not rudeness, it is the small ask --
     one more question, a callback time, a name -- from somebody who has
     already said they are going. */
  let_them_go: {
    require: (t) => LETS_GO.test(t),
    forbid: [['asks_for_time', NEXT_STEP], ['asks_permission', PERMISSION],
      ['pitches_instead', PITCHES], ['searches_for_a_problem', COST]],
    missing: 'does_not_let_them_go',
  },
  leave_it_there: {
    require: (t) => EXITS.test(t),
    forbid: [['asks_for_time', NEXT_STEP], ['asks_permission', PERMISSION],
      ['pitches_instead', PITCHES]],
    missing: 'does_not_close_it_out',
  },
});

export function adheres(sentence, moveId) {
  const t = norm(sentence);
  if (!t) return FAIL('nothing_said');
  const c = CONTRACT[moveId];
  if (!c) return { pass: true, reason: 'no_contract_for_move', ungated: true };
  for (const [why, re] of c.forbid) if (re.test(t)) return FAIL(why);
  return c.require(t) ? PASS('executes_the_locked_move') : FAIL(c.missing);
}

export const GATED_MOVES = Object.freeze(Object.keys(CONTRACT));

/* THE LADDER, exactly as briefed: keep what passes, fall back to a passing
   candidate, and only then allow ONE bounded rewrite. The rewrite is a
   caller-supplied function so this module stays pure and testable -- and so
   a rewrite that also fails cannot loop. */
/* THE SYNCHRONOUS CORE. The deterministic fallback is assembled inside a
   synchronous pipeline and must clear the same bar as model wording -- an
   off-move sentence is off-move whoever wrote it -- so the filtering lives
   here and the async wrapper adds only the rewrite. */
export function gateLines({ moveId, lines = [], want = 2, already = [] } = {}) {
  const audit = [];
  const keep = already.slice();
  for (const line of lines) {
    if (keep.length >= want) break;
    const v = adheres(line, moveId);
    if (!v.pass) { audit.push({ line, pass: false, reason: v.reason }); continue; }
    const twin = keep.find((k) => k.toLowerCase() === String(line).toLowerCase()
      || contentOverlap(k, line) >= TOO_SIMILAR);
    if (twin) { audit.push({ line, pass: false, reason: 'restates_a_kept_line', twin }); continue; }
    audit.push({ line, pass: true, reason: v.reason });
    keep.push(line);
  }
  return { lines: keep.slice(0, want), audit };
}

export async function applyMoveGate({ moveId, solLines = [], terraCandidates = [], rewrite = null, want = 2 }) {
  const audit = [];
  const keep = [];
  const consider = (line, origin) => {
    if (keep.length >= want) return;
    const v = adheres(line, moveId);
    if (!v.pass) { audit.push({ line, origin, pass: false, reason: v.reason }); return; }
    /* On-move, but is it a second angle or the same one again? */
    const twin = keep.find((k) => k.toLowerCase() === String(line).toLowerCase()
      || contentOverlap(k, line) >= TOO_SIMILAR);
    if (twin) {
      audit.push({ line, origin, pass: false, reason: 'restates_a_kept_line', twin });
      return;
    }
    audit.push({ line, origin, pass: true, reason: v.reason });
    keep.push(line);
  };
  solLines.forEach((l) => consider(l, 'sol'));
  terraCandidates.forEach((l) => consider(l, 'terra'));

  let rewritten = 0;
  if (keep.length < want && typeof rewrite === 'function') {
    /* The rewrite is told what is already kept, so it writes a DIFFERENT
       angle rather than a third way of saying the surviving one. */
    const extra = await rewrite({ moveId, need: want - keep.length, avoid: keep.slice() });
    rewritten = 1;
    (Array.isArray(extra) ? extra : []).forEach((l) => consider(l, 'sol_rewrite'));
  }
  return { lines: keep.slice(0, want), audit, rewriteUsed: rewritten,
    shortfall: Math.max(0, want - keep.length) };
}
