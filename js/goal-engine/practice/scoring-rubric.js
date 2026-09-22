/* ════════════════════════════════════════════════════════════════════════
   PRACTICE SCORING — the authority.

   The model is never asked "rate this salesperson". It cannot be: every
   point below is derived from an event the frozen behaviour engine already
   emitted, or from a timing the transcriber already measured. The rubric
   turns evidence into points; nothing else is allowed to.

   HARSH ON PURPOSE. Nobody scores for trying, for finishing the call, for
   sounding friendly or for reading the suggested script. A mediocre call
   lands in the fifties and that is the correct answer, not a bug.

   OUTCOME IS NOT QUALITY. The simulated prospect decides what happens; this
   decides how well it was done. A founder who fabricates their way to a yes
   scores badly, and a founder who correctly identifies no fit and leaves
   well can score very highly.
   ══════════════════════════════════════════════════════════════════════ */

/* ── VERSION ──────────────────────────────────────────────────────────
   v1_1, not v1. Phase 2B changed what the same evidence is WORTH: delivery
   is earned in bands rather than deducted from perfect, repeated dead
   questions lose discovery credit, and 90+ now requires positive evidence
   rather than an absence of mistakes. A v1 result and a v1_1 result are not
   comparable, and calling them the same version would quietly rewrite every
   score already stored. Old rows keep their rubric and their meaning. */
import { situationTrajectoryFromTurns, situationalAdaptationSignal } from './situation-state.js';
/* The routing category is judged by the product's own move contract. One
   definition of what that sentence has to do, not two. */
import { adheres } from './move-adherence.js';
import { severeHostility } from './prospect-behaviour.js';

/* v1_2: an insufficient NON-BUYER call now nulls sales and delivery exactly
   as the buyer path always did, instead of persisting numbers beside a null
   overall (Phase 5 WP-0, defect C). Changed meaning for the same evidence =
   a new version, per the frozen contract; v1_1 rows stand untouched behind
   their own cache key. */
/* v1_3 (P5R-4): every axis now declares how the five canonical opportunity
   outcomes affect its eligibility, and only an ATTEMPT is scored or enters
   the denominator. Changes what stored numbers mean, so the version moves
   and old rows keep their own. */
/* v1_4 (P5R-6): discovery, listening and grounding read canonical evidence
   instead of client-authored founder_action, and grounding can finally score
   a POSITIVE. */
/* v1_5 (P5R-7): pitchTiming and close read canonical evidence only. Both
   previously moved on client columns with the transcript unchanged, so the
   meaning of the number changed and the version moves with it. */
/* v1_6 (P5R-7.3): on a reserved session, supersession is the SERVER's
   derivation from attempts, not the row's `branch` claim -- so whether a
   call is scored at all stopped being the client's decision. Scoring
   meaning changed; EXTRACTOR_VERSION does NOT move, because canonical
   events are derived upstream of this projection and are byte-identical. */
export const RUBRIC_VERSION = 'practice_sales_v1_9';
export const EVIDENCE_VERSION = 'practice_evidence_v1';

/* Weights are the contract. Changing one is a new rubric version. */
export const SALES_WEIGHTS = Object.freeze({
  opening: 10, discovery: 15, listening: 15, grounding: 15,
  pitchTiming: 10, objectionHandling: 15, qualification: 10, close: 10,
});
export const DELIVERY_WEIGHTS = Object.freeze({
  clarity: 25, approachability: 20, pacing: 20, concision: 15, composure: 10, rhythm: 10,
});
/* Selling badly with a lovely voice is still selling badly. */
export const OVERALL_WEIGHTING = Object.freeze({ sales: 0.7, delivery: 0.3 });

export const STATUS = Object.freeze({
  SUFFICIENT: 'sufficient', THIN: 'thin', NOT_TESTED: 'not_tested', INSUFFICIENT: 'insufficient',
});

/* A call this short cannot be judged, and pretending otherwise would be the
   most damaging thing this engine could do. */
export const MIN_FOUNDER_TURNS = 4;
export const MIN_TESTED_WEIGHT = 55;

/* ══ WHAT MAKES A SCORE FAIR, FROM FIRST PRINCIPLES ════════════════════
   P5R-5. `testedWeight >= 55` was calibrated when the denominator was
   inflated by absence: axes were "tested" by default, so 55 points of weight
   was a low bar that almost every call cleared. Once P5R-4 stopped scoring
   absence, the SAME calls fell to 35-50 and every one of them read
   insufficient. Raising or lowering the threshold would only be tuning a
   number whose meaning had already changed underneath it.

   A score here is a RATIO -- earned over tested. What makes a ratio fair is
   not how much weight happened to be in scope; it is how many INDEPENDENT
   behaviours it averages over. One axis at 15 points is one observation
   wearing a large number, and a mean of one is not a mean.

   So sufficiency counts genuinely tested AXES, not weight:

     MIN_SCORED_AXES   how many independent behaviours a ratio needs before
                       it is a summary rather than a single opinion.

   And the three states that are facts about the call -- absent, prevented,
   declined -- are simply NOT IN THE POOL. They cannot count against
   sufficiency, because a chance that never arose, a door the prospect shut
   and a moment the founder judged correctly are not failures to measure.
   That is what "harder or more opportunities cannot mechanically lower a
   stronger seller" means in arithmetic: an untested axis changes neither
   numerator nor denominator, so reaching one more axis can only move the
   score by how the seller actually performed in it.

   Reasoned, not calibrated -- the same honest position as PROJECTION_PARAM_V1
   and OBSERVATION_LOGIC_V1. Two is the smallest number for which a mean is
   not a single opinion; no data supports a larger one today and this does not
   pretend otherwise. Versioned with the rubric, so changing it is a visible
   decision rather than a silent retune. */
export const MIN_SCORED_AXES = 2;

/* ── COACHING IS A SEPARATE DECISION FROM SCORING ──────────────────────
   They were one flag, so a call that could not be scored also could not be
   coached -- which is precisely backwards for the seller who needs it most.
   The black-box measured it: a founder hung up on after three turns got no
   score AND almost no assessment, while the single most useful thing on that
   call (they pitched before earning the right to) was sitting in canonical
   evidence the whole time.

   A NUMBER needs enough independent behaviours to average.
   A LESSON needs one cited fact.

   Those are different bars and they are now asked separately. */
export function coachingSufficiency(sales, canonicalFindings = 0) {
  const tested = Object.values(sales || {})
    .filter((c) => c && typeof c.max === 'number' && c.evidenceStatus !== STATUS.NOT_TESTED).length;
  return canonicalFindings > 0 || tested > 0;
}

/* Genuinely tested axes — the pool a fair ratio averages over. */
export function scoredAxisCount(sales) {
  /* ── `thin` DOES NOT COUNT, AND SAYING SO IS NOT A THRESHOLD ────────
     An axis marked THIN has already declared that what it saw was not
     enough to stand on. Counting it toward "do we have enough to score
     this call" contradicts the axis's own statement about itself -- and it
     was how a two-turn call reached a number: one real axis, two thin ones,
     three by the count and one in substance. This is the axis's own verdict
     being honoured, not a floor tuned until the corpus behaved. */
  return Object.values(sales || {})
    .filter((c) => c && typeof c.max === 'number' && c.max > 0
      && c.evidenceStatus !== STATUS.NOT_TESTED && c.evidenceStatus !== STATUS.THIN).length;
}

/* ── THE NON-BUYER SET ────────────────────────────────────────────────
   A confirmed non-buyer call is NOT a buyer call with categories switched
   off, and treating it as one produced a defect that could be computed
   exactly: mark buyer discovery, pitch timing, objection handling and close
   NOT_TESTED and 50 of the 100 weight above remains -- below MIN_TESTED_WEIGHT.
   A FLAWLESS gatekeeper call would have told the founder there was not
   enough evidence to judge them.

   You cannot divide by a denominator built for a different conversation. So
   this is its own denominator, over the things a non-buyer call actually
   tests, and its floors are lower because a correctly handled gatekeeper
   call is SUPPOSED to be short. A founder who routes in three turns has done
   the job; a rubric that calls that insufficient is training them to stay on
   the phone. */
export const NON_BUYER_WEIGHTS = Object.freeze({
  opening: 15,          /* you still have to earn the first ten seconds  */
  listening: 15,        /* you still have to hear what they told you     */
  pitchDiscipline: 30,  /* the offer is not spent on someone who cannot accept it */
  routing: 25,          /* did you try to reach who can                  */
  nextStep: 15,         /* a name, a role, a time, or a clean exit       */
});
export const MIN_NON_BUYER_FOUNDER_TURNS = 3;
export const MIN_NON_BUYER_TESTED_WEIGHT = 40;

/* Which denominator a call is scored against. Two tracks, and the progress
   layer may never average them -- a non-buyer `overall` is a different
   denominator over different categories, so mixing them would make a
   founder's improvement partly a record of which role they drew. */
/* THREE DENOMINATORS, THREE TRACKS, NEVER AVERAGED.

   `buyer` and `non_buyer` are the two Practice sets. `live` is a real call,
   and it is a third thing again rather than a rehearsal with better audio:
   delivery is never scored on a phone line, pitch timing is only testable
   when the prospect said in words that they wanted to hear the offer, and
   some fraction of the turns could not be attributed at all. A number built
   over that is not comparable with one built over a simulator that told us
   everything.

   Averaging any two of these would make a founder's improvement partly a
   record of which KIND of call they happened to make, which is noise they
   can neither see nor control. */
export const TRACK = Object.freeze({ BUYER: 'buyer', NON_BUYER: 'non_buyer', LIVE: 'live' });

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const r1 = (n) => Math.round(n * 10) / 10;
const textOf = (t) => String((t && (t.content ?? t.text)) || '');

const cat = (score, max, status, count, refs, why, confidence = 0.9) => ({
  score: r1(clamp(score, 0, max)), max, evidenceStatus: status,
  evidenceCount: count, confidence: status === STATUS.NOT_TESTED ? 0 : confidence,
  evidenceRefs: refs.slice(0, 12), why,
});

/* ── the evidence shapes this reads ─────────────────────────────────────
   `turns` are practice_turns rows: founder rows carry founder_action,
   detected_events, pitch permission either side, words and delivery. */
const founderTurns = (turns) => turns.filter((t) => t.speaker === 'founder' && t.branch !== 'superseded');
const failedTurns = (turns) => turns.filter((t) => t.speaker === 'founder' && t.branch === 'superseded');
const actionsOf = (turns, ...names) => founderTurns(turns).filter((t) => names.includes(t.founder_action));
const refsOf = (rows) => rows.map((t) => ({ sequence: t.sequence, atMs: t.audio_start_ms ?? null,
  action: t.founder_action, text: String(t.content || '').slice(0, 70) }));

/* ── WAS THIS QUESTION ALREADY ANSWERED? ──────────────────────────────
   Deterministic and deliberately conservative. A question counts as DEAD
   only when the founder had already asked essentially the same thing AND
   the prospect had already given a substantive answer to it. Everything
   short of that is left alone, because punishing a founder for clarifying
   is worse than missing a repeat. */
const STOPW = new Set(['a','an','the','and','or','but','so','to','of','in','on','at','for','is','are',
  'was','be','it','that','this','i','you','we','they','my','your','our','have','has','do','does','not',
  'with','about','would','will','can','if','there','what','when','where','how','from','me','us','them',
  'as','by','most','more','any','some','just','get','got','like','right','now','then','their']);
const content = (t) => new Set(String(t || '').toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length > 2 && !STOPW.has(w)) || []);
const overlap = (a, b) => {
  const A = content(a); const B = content(b);
  if (A.size < 2 || B.size < 2) return 0;
  let hit = 0; A.forEach((w) => { if (B.has(w)) hit += 1; });
  return hit / Math.min(A.size, B.size);
};
/* A founder checking they heard correctly, not re-asking. */
const CLARIFY = /\b(sorry|apologies|just so|to be clear|did you say|you mean|i missed|say that again|repeat that)\b/i;
const SUBSTANTIVE = 6;   /* content words that count as a real answer */

export function markDeadQuestions(turns) {
  const out = new Map();
  const seq = turns.slice().sort((a, b) => a.sequence - b.sequence);
  const askedBefore = [];
  for (let i = 0; i < seq.length; i += 1) {
    const t = seq[i];
    if (t.speaker !== 'founder' || t.branch === 'superseded') continue;
    /* The engine's own follow-up verdict always wins: building on an answer
       is the opposite of repeating a question. */
    if (t.founder_action === 'high_value_follow_up') { askedBefore.push(t); continue; }
    const text = String(t.content || '');
    const clarifying = CLARIFY.test(text);
    let dead = null;
    for (const prev of askedBefore) {
      if (overlap(text, prev.content) < 0.6) continue;
      /* Did the prospect actually answer it in between? */
      const between = seq.filter((x) => x.speaker === 'prospect'
        && x.sequence > prev.sequence && x.sequence < t.sequence);
      const answered = between.some((x) => content(x.content).size >= SUBSTANTIVE);
      if (!answered) continue;
      /* Clarifying a vague answer is legitimate; re-asking a full one is not. */
      if (clarifying && !between.some((x) => content(x.content).size >= SUBSTANTIVE + 4)) continue;
      dead = prev.sequence;
      break;
    }
    if (dead !== null) out.set(t.sequence, dead);
    askedBefore.push(t);
  }
  return out;
}

/* EVERY LABEL THAT MEANS "THEY MADE THE OFFER". `non_buyer_pitch` is an
   upgrade of `pitch`, so every bucket that counted a pitch has to count it
   too -- otherwise convicting a founder of the worst fault in the system
   would quietly REMOVE their pitch from delivery, script similarity, opening
   and objection scoring, and the fault would read as a reward. */
const PITCH_ACTIONS = Object.freeze(['pitch', 'premature_pitch', 'non_buyer_pitch']);

/* ══ SALES ═══════════════════════════════════════════════════════════ */

/* Every canonical event that means "an offer was on the table at this
   sequence" -- the exact set scorePitchTiming already trusts for the same
   question. Not a new primitive: reusing it is what keeps this a citation
   rather than a second definition of "pitched" that could drift from the
   first. */
const OFFER_EVENT_TYPES = Object.freeze(['pitched_without_permission', 'pitched_a_non_buyer', 'offer_asserted']);

function scoreOpening(turns, lens) {
  const f = founderTurns(turns);
  const first = f[0];
  if (!first) return cat(0, 10, STATUS.NOT_TESTED, 0, [], 'No founder turn was recorded.');
  /* ── THE TOP RUNG WAS BOUGHT WITH A CLIENT-WRITTEN LABEL ────────────
     `founder_action: 'relevant_opening'` returned 10/10, and that column is
     written by the browser through practice_turn_append_v1. One string, full
     marks. There is no canonical "this opening was relevant" event, and
     there cannot be one without a model, so the fix is not to re-source the
     rung -- it is to stop awarding a top mark nobody can verify.

     What IS canonical stays: an opening that asserted something unestablished
     about the prospect is a cited server-derived fault, and it still scores 0.
     A pitch-shaped opening is transcript-evident and still scores 1. Between
     those, the honest answer is the neutral rung -- an opening the product
     cannot tell apart from any other is not a 10.

     `assumed` reads the canonical lens first and falls back only for legacy
     calls with no canonical run. */
  const assumed = lens
    ? lens.sequences('unsupported_assumption').includes(Number(first.sequence))
    : (first.detected_events || []).includes('unsupported_assumption');
  if (assumed) return cat(0, 10, STATUS.SUFFICIENT, 1, refsOf([first]),
    'The opening asserted something about the prospect that had not been established.');
  /* ── P5R-7.5: THE SAME COLUMN, THE SAME EXPLOIT ─────────────────────
     `PITCH_ACTIONS.includes(first.founder_action)` decided whether the
     opening was a pitch from a string the browser writes. A verifier moved
     this axis 1/10 -> 5/10 with the transcript BYTE-IDENTICAL by relabelling
     the same turn `relevant_opening` instead of `premature_pitch`.

     Whether an offer was on the table at the FIRST founder turn is exactly
     what pitchTiming already answers from canonical events, so this asks the
     same question of the same sequence rather than reading the label. */
  const pitchedAtOpening = lens
    ? OFFER_EVENT_TYPES.some((type) => lens.sequences(type).includes(Number(first.sequence)))
    : PITCH_ACTIONS.includes(first.founder_action);
  if (pitchedAtOpening) return cat(1, 10, STATUS.SUFFICIENT, 1, refsOf([first]),
    'Opened by selling rather than by giving a reason for the call.');
  return cat(5, 10, STATUS.SUFFICIENT, 1, refsOf([first]),
    'The opening was serviceable but did not earn attention on its own.');
}

function scoreDiscovery(turns, dead, lens) {
  /* CANONICAL FIRST (P5R-6). This counted `discovery_question`,
     `high_value_follow_up` and `generic_question` off `founder_action`. The
     server-derived question of record is what the asking ACHIEVED: answers
     obtained, against questions that advanced nothing or were re-asked. */
  if (lens) {
    const answers = lens.count('explicit_answer');
    const weak = lens.count('weak_discovery');
    const repeats = lens.count('question_repeated');
    const refused = lens.count('explicit_refusal_to_answer');
    if (answers === 0 && weak === 0 && repeats === 0 && refused === 0) {
      return cat(0, 15, STATUS.NOT_TESTED, 0, [],
        'No question on this call sought anything specific, so discovery was not scored.');
    }
    const raw = Math.max(0, Math.min(15, (answers * 6) - (weak * 3) - (repeats * 4)));
    return cat(raw, 15, STATUS.SUFFICIENT, answers + weak + repeats, [],
      answers === 0
        ? 'No question drew a substantive answer.'
        : `${answers} question${answers === 1 ? '' : 's'} drew a substantive answer`
          + (weak || repeats ? `, and ${weak + repeats} advanced nothing.` : '.'));
  }
  const real = actionsOf(turns, 'discovery_question', 'high_value_follow_up');
  const generic = actionsOf(turns, 'generic_question');
  const total = real.length + generic.length;
  if (!total) return cat(0, 15, STATUS.SUFFICIENT, 0, [],
    'No questions were asked. Nothing about the prospect was established.');

  /* VALUE, NOT VOLUME. Ten mediocre questions must not beat five good ones,
     and a question the prospect already answered is worth nothing at all. */
  let deadCount = 0; let hv = 0; let useful = 0; let low = 0;
  for (const t of real.concat(generic)) {
    if (dead.has(t.sequence)) { deadCount += 1; continue; }
    if (t.founder_action === 'high_value_follow_up') hv += 1;
    else if (t.founder_action === 'discovery_question') useful += 1;
    else low += 1;
  }
  /* VOLUME IS CAPPED, VALUE IS NOT. Plain questions contribute up to four
     before they stop counting, so a founder cannot reach full marks by
     asking the same kind of thing eight times -- the top of this category
     needs follow-ups that build on what the prospect actually said. */
  const value = hv * 1 + Math.min(useful, 4) * 0.6 + Math.min(low, 3) * 0.1;
  const raw = 15 * clamp(value / 5, 0, 1);
  const status = total >= 3 ? STATUS.SUFFICIENT : STATUS.THIN;
  return cat(raw, 15, status, total, refsOf(real.concat(generic)),
    `${real.length} question${real.length === 1 ? '' : 's'} sought something specific; ${generic.length} were generic`
    + (deadCount ? `; ${deadCount} asked again for something already answered.` : '.'));
}

function scoreListening(turns, dead, lens) {
  /* ── CANONICAL FIRST (P5R-6) ─────────────────────────────────────────
     This counted `high_value_follow_up` and `repetition` off `founder_action`,
     a column the browser writes -- and it was the axis carrying almost the
     whole score on the messy organic call (13.4/15 for a seller who
     steamrolled three brush-offs), while the developing seller's genuinely
     better listening scored through the same client label.

     `built_on_their_answer` is the server-derived equivalent: the same
     exported predicate, gated on not-the-opening, not-the-greeting and
     not-a-brush-off, and citing the prospect turn it built on. */
  /* ── ONLY TURNS THAT COULD HAVE EARNED IT MAY LOSE IT ──────────────
     `built_on_their_answer` deliberately refuses the OPENING turn -- you
     cannot build on a greeting -- so a call whose only founder turn is the
     opening had no turn eligible to earn the positive, and scoring it 3/15
     for "no turn built on what the prospect said" convicts the founder for
     not doing something the rule would not have credited. Measured on a
     one-turn call: 3/15, and an overall of 32.

     Outside the lens branch on purpose: this is a fact about the SHAPE of
     the call, not about the evidence read from it, so it holds on the
     legacy path too -- which is where a one-founder-turn call was still
     collecting a listening score after P5R-5 retired the turn-count floor.
     An eligible turn is a founder turn after their first, which is exactly
     the precondition the producer uses. */
  {
    const prospectTurns = (turns || []).filter((t) => t && t.speaker === 'prospect').length;
    const eligible = Math.max(0, founderTurns(turns).length - 1);
    if (prospectTurns < 2 || eligible === 0) {
      return cat(0, 15, STATUS.NOT_TESTED, 0, [],
        'There was not enough back and forth to judge listening.');
    }
  }
  if (lens) {
    const built = lens.count('built_on_their_answer');
    const repeats = lens.count('question_repeated');
    const raw = built === 0 ? (repeats > 0 ? 0 : 3)
      : Math.max(0, Math.min(15, (built * 5) - (repeats * 4)));
    return cat(raw, 15, STATUS.SUFFICIENT, built + repeats, [],
      built === 0
        ? 'No turn built on what the prospect had just said.'
        : `${built} turn${built === 1 ? '' : 's'} built on what the prospect had just said`
          + (repeats ? `, and ${repeats} re-asked something already answered.` : '.'));
  }
  const f = founderTurns(turns);
  const hvf = actionsOf(turns, 'high_value_follow_up');
  const repeats = actionsOf(turns, 'repetition');
  /* Asking again for something the prospect already told you is not a
     discovery problem, it is a listening one. */
  const deadRepeats = f.filter((t) => dead.has(t.sequence));
  const opportunities = Math.max(1, f.length - 1);
  const rate = hvf.length / opportunities;
  let raw = 15 * clamp(rate * 2.2, 0, 1);
  raw -= repeats.length * 4;
  raw -= deadRepeats.length * 3.5;
  /* Reading on while the prospect is answering is the failure this
     category exists to catch. */
  const scripted = f.filter((t) => Number(t.script_similarity) >= 0.6);
  const ignoredWhileScripted = scripted.length >= 2 && hvf.length === 0;
  if (ignoredWhileScripted) raw = Math.min(raw, 4);

  /* ── SITUATIONAL ADAPTATION, INSIDE THIS CATEGORY'S OWN BUDGET ───────
     Not a ninth weight and not a bonus category -- listening is already
     "did the founder read and respond to what the prospect gave them",
     and a Situation is exactly one more thing the prospect gives them, so
     the same category is where noticing it belongs. `NOT_TESTED` calls
     (no situation on the call at all) are completely unaffected: the
     signal is 0 and the modifier below is a no-op. The most this can move
     the score is +/-2.5 of the 15 points -- it nudges an existing
     assessment of listening, it does not replace it. */
  const trajectory = situationTrajectoryFromTurns(turns);
  const adaptation = situationalAdaptationSignal(trajectory);
  /* No explicit clamp needed here -- cat() below clamps every score to its
     category's own weight regardless, and a second clamp that duplicates
     an already-authoritative one is exactly the kind of code that looks
     protective without protecting anything. */
  if (adaptation.signal) raw += adaptation.signal * 2.5;

  const status = f.length >= 3 ? STATUS.SUFFICIENT : STATUS.THIN;
  return cat(raw, 15, status, f.length, refsOf(hvf.concat(repeats, deadRepeats)),
    (ignoredWhileScripted
      ? 'The suggested wording was followed while the prospect’s answers went unused.'
      : `${hvf.length} turn${hvf.length === 1 ? '' : 's'} built on what the prospect had just said`
        + (deadRepeats.length ? `; ${deadRepeats.length} asked again for something already answered.` : '.'))
    + (adaptation.signal ? ` ${adaptation.reasons[0]}.` : ''));
}

function scoreGrounding(turns, lens) {
  const f = founderTurns(turns);
  /* The omission path: leaving `unsupported_assumption` out of the
     client-written `detected_events` gave n=0 and full marks. The canonical
     producer exists now (P5R-1) and cannot be omitted by a caller. */
  const assumptions = lens
    ? lens.sequences('unsupported_assumption').map((sq) => ({ sequence: sq }))
    : f.filter((t) => (t.detected_events || []).includes('unsupported_assumption'));
  const failed = failedTurns(turns).filter((t) => t.founder_action === 'unsupported_assumption');
  const n = assumptions.length;
  /* ── SILENCE IS NOT GROUNDING ────────────────────────────────────────
     `n === 0` awarded 15/15 with the sentence "Nothing was asserted about
     the prospect that they had not said." That was true of a founder who
     grounded every claim, of one who made no claims at all, and of one who
     was hung up on after three turns -- and it scored all three identically.
     Measured: 15/15 on all four frozen calls, including one where the
     founder made an unsupported claim and was hung up on a turn later.

     There is no canonical "made a supported claim" event, so a clean record
     is not evidence of good grounding -- it is the absence of evidence
     either way. With canonical evidence available and nothing in it, the
     honest answer is NOT TESTED: earns nothing, costs nothing, out of the
     denominator. When an unsupported claim IS on the record, it scores.

     Without a lens (legacy calls) the old behaviour is untouched, so no
     stored score moves for a call this cannot re-read. */
  if (lens) {
    /* P5R-6 gave this axis a POSITIVE. Until now a clean record was the
       absence of evidence either way, so the only honest answer was
       not_tested. `grounded_claim` fires when the founder made a claim the
       GRANTED RESEARCH supports -- the same claim against no research would
       be flagged -- so a supported claim is now visible, not just an
       unsupported one. */
    const grounded = lens.count('grounded_claim');
    if (n === 0 && grounded === 0) {
      return cat(0, 15, STATUS.NOT_TESTED, f.length, [],
        'Nothing on the record shows a claim about the prospect that needed backing up, '
        + 'so this was not scored either way.');
    }
    const raw = n === 0 ? 15 : Math.max(0, 15 - (n * 7));
    return cat(raw, 15, STATUS.SUFFICIENT, grounded + n, [],
      n === 0
        ? `${grounded} claim${grounded === 1 ? '' : 's'} about the prospect `
          + `${grounded === 1 ? 'was' : 'were'} backed by what VISION had verified.`
        : `${n} claim${n === 1 ? '' : 's'} about the prospect ${n === 1 ? 'was' : 'were'} never established.`);
  }
  let raw;
  if (n === 0) raw = 15;
  else if (n === 1) raw = 8;
  else if (n === 2) raw = 4;
  else raw = 2;                     /* three or more: capped, not scaled */
  const status = f.length >= 3 ? STATUS.SUFFICIENT : STATUS.THIN;
  return cat(raw, 15, status, f.length, refsOf(assumptions),
    n === 0 ? 'Nothing was asserted about the prospect that they had not said.'
      : `${n} claim${n === 1 ? '' : 's'} about the prospect were never established`
        + (failed.length ? ` (${failed.length} corrected on a retry).` : '.'));
}

function scorePitchTiming(turns, lens) {
  /* ── P5R-7: CANONICAL ONLY, AND IT FAILS CLOSED ────────────────────
     This read `founder_action` for whether a pitch happened and how it was
     labelled. A verifier moved the axis 2/10 -> 10/10 with the transcript
     BYTE-IDENTICAL, by relabelling one turn `pitch` instead of
     `premature_pitch` -- a column the browser writes deciding the score.

     Every input below is now a canonical event. `offer_asserted` says an
     offer was made; `pitched_without_permission` and `pitched_a_non_buyer`
     say it was badly timed or aimed; `explicit_permission_to_continue` --
     the prospect's OWN words, server-authored since ec3ab3b7 -- is the only
     thing that can earn full marks.

     Where the record shows an offer but nothing about whether it was
     invited, the axis DECLINES. That is the whole point: a detection this
     engine missed must never read as a clean pitch. */
  if (!lens) {
    return cat(0, 10, STATUS.NOT_TESTED, 0, [],
      'This call has no canonical evidence, so pitch timing was not judged.');
  }
  const f = founderTurns(turns);
  const turnsAt = (type) => {
    const seqs = new Set(lens.sequences(type));
    return f.filter((t) => seqs.has(Number(t.sequence)));
  };
  const nonBuyer = turnsAt('pitched_a_non_buyer');
  const premature = turnsAt('pitched_without_permission');
  const offers = turnsAt('offer_asserted');
  if (!offers.length && !premature.length && !nonBuyer.length) {
    return cat(0, 10, STATUS.NOT_TESTED, 0, [],
      'The offer was never put to them, so pitch timing was not tested.');
  }
  /* WORST FIRST. Pitching after being told the decision is not theirs is not
     a badly-timed pitch -- it is a pitch aimed at someone who could never
     accept it, so there is no partial credit to give. */
  if (nonBuyer.length) {
    return cat(0, 10, STATUS.SUFFICIENT, nonBuyer.length + offers.length, refsOf(nonBuyer),
      'The offer was made to someone who had already said the decision was not theirs.');
  }
  if (premature.length) {
    /* Capped, because a polished pitch dumped before any need exists is the
       failure -- not a slightly-worse version of a good pitch. */
    const raw = premature.length >= 2 ? 0 : 2;
    return cat(raw, 10, STATUS.SUFFICIENT, premature.length + offers.length, refsOf(premature),
      `Pitched ${premature.length} time${premature.length === 1 ? '' : 's'} before earning the right to.`);
  }
  /* `offer_invited` is emitted on the offer turn itself when the prospect had
     invited it, from the same detection that produced `offer_asserted` --
     so an offer this engine can read is always judged by a permission signal
     it also read. `explicit_permission_to_continue` is accepted as well: it
     is the prospect's own recorded words, and it corroborates rather than
     replaces. */
  const invitedSeqs = new Set(lens.sequences('offer_invited'));
  const firstOffer = Math.min(...offers.map((t) => Number(t.sequence)));
  const invitedBefore = offers.some((t) => invitedSeqs.has(Number(t.sequence)))
    || lens.sequences('explicit_permission_to_continue').some((sq) => Number(sq) < firstOffer);
  if (invitedBefore) {
    return cat(10, 10, STATUS.SUFFICIENT, offers.length, refsOf(offers),
      'The offer came only after the prospect had invited it.');
  }
  return cat(0, 10, STATUS.NOT_TESTED, offers.length, [],
    'The offer was made, but nothing on the record shows whether they had '
    + 'invited it, so the timing was not scored.');
}

function scoreObjectionHandling(turns, lens) {
  const f = founderTurns(turns);
  /* CANONICAL FIRST. `active_objection` and `founder_action` are both
     client-authored, so asserting both was enough to score 15/15 -- the
     forge path P5R-0 closed for mastery and left open for the score. */
  if (lens) {
    const raised = lens.count('explicit_objection');
    if (!raised) {
      return cat(0, 15, STATUS.NOT_TESTED, 0, [], 'No objection was raised, so this was not tested.');
    }
    /* ── ABSENCE IS NOT HANDLING, HERE EITHER ─────────────────────────
       This awarded 15/15 when no `objection_not_handled` fired -- which is
       the absence-becomes-credit defect P5R exists to end, reappearing in the
       axis I had just moved to canonical evidence. Caught on the messy
       organic call: three objections steamrolled, no fault event, FULL MARKS.

       Credit now requires `objection_addressed` -- a positive event, cited on
       both the objection and the turn that engaged it. No positive and no
       fault means we saw an objection and cannot tell what happened next,
       which is `not_tested`, not fifteen out of fifteen. */
    const addressed = lens.count('objection_addressed');
    const mishandled = lens.count('objection_not_handled');
    if (addressed === 0 && mishandled === 0) {
      return cat(0, 15, STATUS.NOT_TESTED, raised, [],
        `${raised} objection${raised === 1 ? ' was' : 's were'} raised, but nothing on the `
        + 'record shows how it was handled, so this was not scored.');
    }
    /* AND IT CITES THE TURNS. Moving this axis onto canonical evidence, I
       passed an empty refs array -- so it scored and pointed at nothing, and
       the founder got a number with no moment behind it. A scored axis that
       cannot show its evidence is the same failure as one that invents it. */
    const cited = new Set([...lens.sequences('objection_addressed'),
      ...lens.sequences('objection_not_handled')]);
    const refs = refsOf(f.filter((t) => cited.has(Number(t.sequence))));
    const raw = Math.max(0, Math.min(15, (addressed * 8) - (mishandled * 8)));
    return cat(raw, 15, STATUS.SUFFICIENT, raised, refs,
      mishandled === 0
        ? `${addressed} objection${addressed === 1 ? ' was' : 's were'} engaged with rather than talked over.`
        : `${mishandled} of ${raised} objection${raised === 1 ? '' : 's'} was left standing.`);
  }
  const withObjection = f.filter((t) => !!t.active_objection);
  if (!withObjection.length) {
    return cat(0, 15, STATUS.NOT_TESTED, 0, [], 'No objection was raised, so this was not tested.');
  }
  const explored = withObjection.filter((t) => t.founder_action === 'objection_exploration');
  const steamrolled = withObjection.filter((t) => [...PITCH_ACTIONS, 'close_request', 'pressure']
    .includes(t.founder_action));
  let raw;
  if (steamrolled.length && !explored.length) raw = 0;
  else if (explored.length && !steamrolled.length) raw = 15;
  else if (explored.length) raw = 8;
  else raw = 5;
  return cat(raw, 15, STATUS.SUFFICIENT, withObjection.length, refsOf(withObjection),
    steamrolled.length && !explored.length
      ? 'The objection was talked past rather than understood.'
      : (explored.length ? 'The objection was explored before it was answered.'
        : 'The objection was acknowledged but never opened up.'));
}

/* ── QUALIFICATION IS WITHDRAWN FROM THE SCORE ─────────────────────────
   P5R-5. Both of its inputs are written by the browser:

     state_after.needDiscovered   set needDiscovered: 1 -> 10/10
     session.outcome              set p_outcome: 'not_a_fit' -> 10/10 flat

   Two independent forge paths to full marks on a ten-point axis, through
   practice_turn_append_v1 and practice_session_finish_v1 respectively. And
   `needDiscovered` is the SIMULATOR'S PRIVATE STATE -- Phase 3 already ruled
   this axis fairness-blocked and refused to let it move mastery, because a
   seller cannot appeal a verdict built on evidence they were never shown.

   It has no canonical replacement: there is no server-derived "the need was
   established" event, and inventing one from the absence of a refusal is the
   mistake this whole repair exists to end. So the axis is NOT_TESTED until a
   canonical source exists. It earns nothing, costs nothing, and leaves the
   denominator -- the same treatment `absent` gets, for the same reason: we
   cannot measure it honestly.

   Withdrawing beats keeping a number that is both forgeable and unfair. */
function scoreQualification(turns) {
  const f = founderTurns(turns);
  return cat(0, 10, STATUS.NOT_TESTED, f.length, [],
    'Qualification is not scored: the only signals for it are the simulator\'s own '
    + 'private state, which you were never shown.');
}

function scoreClose(turns, session, lens) {
  /* ── P5R-7: CANONICAL ONLY, AND IT FAILS CLOSED ────────────────────
     This decided a close was EARNED from `pitch_permission_before` -- the
     simulator's private warmth, written through the browser. A verifier
     moved the axis 2/10 -> 10/10 with the transcript BYTE-IDENTICAL by
     flipping that one boolean. It also read `founder_action` for whether a
     close or a professional exit happened at all, and
     `state_after.ignoredAnswer` for how gracefully the founder left.

     All of it is gone. `close_attempted` says a next step was asked for;
     `close_earned` and `unearned_close` -- BOTH derived from the same
     transcript qualification level -- say whether there was basis for it;
     `pressure_applied` and `sold_after_do_not_contact` say it was pushed.

     The professional-exit credit is not reproduced here: it rested entirely
     on `founder_action: professional_exit`, and no canonical event says a
     founder left well. Under the fail-closed rule that is `not_tested`, not
     ten out of ten -- an absence the engine cannot read must not pay. */
  if (!lens) {
    return cat(0, 10, STATUS.NOT_TESTED, 0, [],
      'This call has no canonical evidence, so the close was not judged.');
  }
  const f = founderTurns(turns);
  const turnsAt = (type) => {
    const seqs = new Set(lens.sequences(type));
    return f.filter((t) => seqs.has(Number(t.sequence)));
  };
  const pressured = turnsAt('pressure_applied').concat(turnsAt('sold_after_do_not_contact'));
  if (pressured.length) {
    return cat(0, 10, STATUS.SUFFICIENT, pressured.length, refsOf(pressured),
      'Pressure was applied after the prospect had made their position clear.');
  }
  const closes = turnsAt('close_attempted');
  if (!closes.length) {
    return cat(0, 10, STATUS.NOT_TESTED, 0, [], 'No next step was asked for.');
  }
  const earnedSeqs = new Set(lens.sequences('close_earned'));
  const unearnedSeqs = new Set(lens.sequences('unearned_close'));
  const earned = closes.filter((t) => earnedSeqs.has(Number(t.sequence)));
  const unearned = closes.filter((t) => unearnedSeqs.has(Number(t.sequence)));
  /* Per turn, not per call: a founder who closes too early and then genuinely
     earns it later still gets credit for the clean one. What a flagged close
     can no longer do is BE that clean one. */
  if (earned.length) {
    return cat(10, 10, STATUS.SUFFICIENT, earned.length, refsOf(earned),
      'Asked for a next step after establishing there was something worth solving.');
  }
  if (unearned.length) {
    return cat(2, 10, STATUS.SUFFICIENT, unearned.length, refsOf(unearned),
      'You asked for their time before establishing they have a problem worth solving.');
  }
  /* A close whose basis the Reconciler WITHHELD -- the prospect refused the
     topic, so the founder is not to blame and no credit is owed either. */
  return cat(0, 10, STATUS.NOT_TESTED, closes.length, [],
    'A next step was asked for, but the record does not settle whether there '
    + 'was basis for it, so the close was not scored.');
}

/* ══ DELIVERY ════════════════════════════════════════════════════════ */

/* Below this many words, a turn's own wpm is real -- it is genuinely how
   fast those words were said -- but it is not a reliable POINT for judging
   how much the founder's pace varied across the call. A two-word reflex
   ("Shut up.") has almost none of a sentence's onset/offset overhead, so
   its instantaneous rate runs high by construction, not because the
   founder sped up. Verified against a real captured session: three one-
   and two-word acknowledgements timed the way real short reflexes actually
   are dragged a sustained, genuinely excellent 150wpm speaker's measured
   average to 211wpm, and Clarity from 25/25 to 9/25 -- on a founder who
   never once departed from a clean, professional pace on any real
   sentence. Matches `enough` below in spirit: not enough evidence to weigh
   on its own. */
const RELIABLE_RATE_MIN_WORDS = 5;

function deliveryStats(turns) {
  const rows = founderTurns(turns).map((t) => t.delivery).filter(Boolean);
  const words = rows.reduce((a, d) => a + (d.wordCount || 0), 0);
  const spoken = rows.reduce((a, d) => a + (d.spokenMs || 0), 0);
  const fillers = rows.reduce((a, d) => a + (d.fillerCount || 0), 0);
  const wpms = rows.map((d) => d.wpm).filter((x) => typeof x === 'number' && x > 0);
  /* Reliable-turn subset, for judging CONSISTENCY only -- see
     RELIABLE_RATE_MIN_WORDS above. The overall rate below does not need
     this filter: it is weighted by actual speaking time, so a short turn
     already contributes only its own true share rather than casting one
     equal vote against a much longer one. */
  const reliableWpms = rows.filter((d) => (d.wordCount || 0) >= RELIABLE_RATE_MIN_WORDS
    && typeof d.wpm === 'number' && d.wpm > 0).map((d) => d.wpm);
  const levels = rows.map((d) => d.levelMean).filter((x) => typeof x === 'number');
  /* THE SAME RELIABILITY FLOOR, FOR THE SAME REASON, ON TWO MORE METRICS.
     A two-word reflex has nowhere to pause and next to no signal to average
     an RMS level over -- its levelMean is a thin-sample artifact, not a
     measurement of composure, and it cannot have "paused mid-sentence"
     because it has no mid-sentence. Left unfiltered, six natural
     acknowledgements ("Right.", "Got it.") on top of an unchanged, genuinely
     well-paced call pull Composure from exceptional to ordinary and Rhythm's
     pause credit down with them -- proven on the real scoring function
     before this fix, in qa-practice-delivery-weighting.mjs section 6. */
  const reliableRows = rows.filter((d) => (d.wordCount || 0) >= RELIABLE_RATE_MIN_WORDS);
  const reliableLevels = reliableRows.map((d) => d.levelMean).filter((x) => typeof x === 'number');
  const reliablePauses = reliableRows.reduce((a, d) => a + (d.pauseCount || 0), 0);
  const lengths = founderTurns(turns).map((t) => (t.delivery && t.delivery.wordCount) || 0);
  const pauses = rows.reduce((a, d) => a + (d.pauseCount || 0), 0);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { rows, words, spoken, fillers, wpms, reliableWpms, levels, reliableLevels,
    reliableRows, reliablePauses, lengths, pauses,
    /* THE CALL'S ACTUAL RATE: total words over total speaking time, not an
       average of each turn's own rate. A turn-weighted average let a
       two-word reflex outvote a sixteen-word sentence -- this is total
       distance over total time, the same correction "average speed" always
       needs over "average of instantaneous speeds". Falls back to the
       simple mean only when spokenMs is entirely absent, which should not
       happen on a real call. */
    wpmMean: spoken > 0 ? (words / spoken) * 60000 : mean(wpms),
    /* Falls back to the unfiltered mean only when NO turn on the whole call
       reached the reliability floor -- an imperfect estimate beats reporting
       nothing when that is genuinely all there is. */
    levelMean: reliableLevels.length ? mean(reliableLevels) : mean(levels),
    fillerPer100: words ? (fillers / words) * 100 : 0,
    longest: lengths.length ? Math.max(...lengths) : 0 };
}

function scoreDelivery(turns) {
  const s = deliveryStats(turns);
  if (!s.rows.length) {
    const none = cat(0, 0, STATUS.NOT_TESTED, 0, [], 'No word-level timing was captured for this call.');
    return { score: null, status: STATUS.INSUFFICIENT, clarity: none, approachability: none,
      pacing: none, concision: none, composure: none, rhythm: none, stats: s };
  }
  const n = s.rows.length;
  const out = {};

  /* ── EARNED IN BANDS ──────────────────────────────────────────────
     Speaking at a sensible pace with no fillers is CLEAN BASELINE, not
     elite. It is what "ordinary" looks like, and ordinary is about two
     thirds of the marks. Professional and exceptional require positive
     evidence sustained across the call, so a founder cannot reach the top
     of a category merely by having nothing wrong with them. */
  const LEVELS = { bad: 0.12, weak: 0.36, ordinary: 0.62, strong: 0.80, professional: 0.92, exceptional: 1.0 };
  /* `tests` is ordered best-first; the first one that matches wins. */
  const grade = (tests, fallback = 'ordinary') => {
    for (const [name, ok] of tests) if (ok) return { f: LEVELS[name], name };
    return { f: LEVELS[fallback], name: fallback };
  };

  const fillers = s.fillerPer100;
  const wpm = s.wpmMean || 0;
  /* PACE CONSISTENCY, FROM THE RELIABLE TURNS ONLY. See RELIABLE_RATE_MIN_
     WORDS above. No reliable pair to compare defaults to 0 -- no evidence
     of inconsistency is not evidence of inconsistency, the same principle
     NOT_TESTED already applies to a fault with no evidence behind it. */
  const spread = s.reliableWpms.length > 1
    ? Math.max(...s.reliableWpms) - Math.min(...s.reliableWpms) : 0;
  const avgLen = s.lengths.length ? s.lengths.reduce((a, b) => a + b, 0) / s.lengths.length : 0;
  const enough = n >= 5;          /* a short call cannot demonstrate sustained quality */

  /* CLARITY — understandable, uncluttered, sustained. */
  const clarity = grade([
    ['exceptional', enough && fillers < 0.4 && wpm >= 132 && wpm <= 168 && s.longest <= 40],
    ['professional', enough && fillers < 1.0 && wpm >= 126 && wpm <= 174 && s.longest <= 52],
    ['strong', enough && fillers < 2.0 && wpm >= 120 && wpm <= 182 && s.longest <= 68],
    ['ordinary', fillers < 4.5 && wpm >= 100 && wpm <= 200 && s.longest <= 110],
    ['weak', fillers < 8 && wpm >= 85 && wpm <= 215],
    ['bad', true],
  ]);
  out.clarity = cat(25 * clarity.f, 25, STATUS.SUFFICIENT, n, [],
    `${fillers.toFixed(1)} fillers per 100 words at about ${Math.round(wpm)} words per minute; longest answer ${s.longest} words.`);

  /* APPROACHABILITY — did the delivery leave room for a conversation. */
  const approach = grade([
    ['exceptional', enough && avgLen <= 22 && s.longest <= 40],
    ['professional', enough && avgLen <= 30 && s.longest <= 52],
    ['strong', enough && avgLen <= 36 && s.longest <= 68],
    ['ordinary', avgLen <= 65 && s.longest <= 110],
    ['weak', avgLen <= 90],
    ['bad', true],
  ]);
  out.approachability = cat(20 * approach.f, 20, STATUS.SUFFICIENT, n, [],
    `Turns averaged ${Math.round(avgLen)} words; the longest ran to ${s.longest}.`);

  /* PACING — the band AND how steady it stayed across sections. */
  const pacing = grade([
    ['exceptional', enough && wpm >= 134 && wpm <= 166 && spread <= 18],
    ['professional', enough && wpm >= 128 && wpm <= 172 && spread <= 28],
    ['strong', enough && wpm >= 120 && wpm <= 180 && spread <= 45],
    ['ordinary', wpm >= 100 && wpm <= 200 && spread <= 80],
    ['weak', wpm >= 85 && wpm <= 215],
    ['bad', true],
  ]);
  out.pacing = cat(20 * pacing.f, 20, STATUS.SUFFICIENT, s.wpms.length, [],
    `Average ${Math.round(wpm)} words per minute, ranging ${Math.round(spread)} across sustained turns.`);

  /* CONCISION — enough said, without monologues. Silence is not rewarded. */
  const concision = grade([
    ['exceptional', enough && avgLen >= 8 && avgLen <= 26 && s.longest <= 44],
    ['professional', enough && avgLen >= 7 && avgLen <= 34 && s.longest <= 58],
    ['strong', enough && avgLen >= 6 && avgLen <= 46 && s.longest <= 80],
    ['ordinary', avgLen <= 75 && s.longest <= 125],
    ['weak', avgLen <= 100],
    ['bad', true],
  ]);
  out.concision = cat(15 * concision.f, 15, STATUS.SUFFICIENT, n, [],
    `Longest single answer was ${s.longest} words.`);

  /* COMPOSURE — level and pace steadiness. An observation, never an emotion. */
  const lvlSpread = s.reliableLevels.length > 1
    ? Math.max(...s.reliableLevels) - Math.min(...s.reliableLevels) : 0;
  const rel = (s.levelMean && s.levelMean > 0) ? lvlSpread / s.levelMean : null;
  const composure = (rel == null)
    ? { f: LEVELS.ordinary, name: 'ordinary' }
    : grade([
      ['exceptional', enough && rel <= 0.12 && spread <= 20],
      ['professional', enough && rel <= 0.25 && spread <= 32],
      ['strong', enough && rel <= 0.45 && spread <= 50],
      ['ordinary', rel <= 0.9 && spread <= 90],
      ['weak', rel <= 1.4],
      ['bad', true],
    ]);
  /* THE REASON MUST NAME WHAT ACTUALLY GATED IT. This used to be a fixed
     line -- "speaking level stayed within a normal range" -- printed
     whether or not that was true, and whether or not level was even what
     limited the score: composure is gated on BOTH rel (level) and spread
     (pace) together, so a call crushed entirely by pace inconsistency still
     read as a clean bill of health on level. Both real numbers, always. */
  out.composure = cat(10 * composure.f, 10,
    s.levels.length ? STATUS.SUFFICIENT : STATUS.THIN, s.levels.length, [],
    s.levels.length
      ? `Speaking level varied by about ${Math.round((rel || 0) * 100)}% of the mean`
        + (s.reliableWpms.length > 1 ? `, and pace by ${Math.round(spread)} words per minute across sustained turns.` : '.')
      : 'Level was only partly measurable on this call.');

  /* RHYTHM — questions asked, and room left for them to be answered. */
  const questions = founderTurns(turns).filter((t) => /\?\s*$/.test(String(t.content || '').trim())).length;
  const qRatio = n ? questions / n : 0;
  /* SAME FLOOR AS THE PACE STATS. A pause needs somewhere to happen -- a
     one-word reflex has no mid-sentence to pause in -- so a call padded with
     natural short acknowledgements diluted this by turn COUNT even though
     nothing about the founder's real pausing on the turns long enough to
     have any changed. Falls back to the unfiltered figure only when no turn
     on the call reached the floor. */
  const pausesPerTurn = s.reliableRows.length ? s.reliablePauses / s.reliableRows.length
    : (n ? s.pauses / n : 0);
  const rhythm = grade([
    ['exceptional', enough && qRatio >= 0.6 && pausesPerTurn >= 1.2],
    ['professional', enough && qRatio >= 0.5 && pausesPerTurn >= 0.8],
    ['strong', enough && qRatio >= 0.38 && pausesPerTurn >= 0.5],
    ['ordinary', qRatio >= 0.2],
    ['weak', qRatio > 0],
    ['bad', true],
  ]);
  out.rhythm = cat(10 * rhythm.f, 10, STATUS.SUFFICIENT, n, [],
    `${questions} of ${n} turns ended on a question.`);

  const score = Object.keys(DELIVERY_WEIGHTS).reduce((a, k) => a + out[k].score, 0);
  return { score: r1(score), status: STATUS.SUFFICIENT, ...out, stats: s,
    bands: { clarity: clarity.name, approachability: approach.name, pacing: pacing.name,
      concision: concision.name, composure: composure.name, rhythm: rhythm.name } };
}

/* ══ PATTERNS ════════════════════════════════════════════════════════
   Promoted only when repeated AND material. Saying "um" twice is not a
   pattern; assuming three times is. */
function patterns(turns, sales, delivery) {
  const out = [];
  const push = (type, count, severity, refs, why) => out.push({ type, evidenceCount: count, severity, refs: refs.slice(0, 6), why });
  const f = founderTurns(turns);
  const assumptions = f.filter((t) => (t.detected_events || []).includes('unsupported_assumption'));
  if (assumptions.length >= 2) push('assumes_instead_of_asking', assumptions.length,
    assumptions.length >= 3 ? 'high' : 'medium', refsOf(assumptions),
    'Told the prospect things about their own business that they had not said.');
  const premature = actionsOf(turns, 'premature_pitch');
  if (premature.length >= 2) push('pitches_before_earning_it', premature.length, 'high', refsOf(premature),
    'Went to the offer repeatedly before establishing a reason for it.');
  const repeats = actionsOf(turns, 'repetition');
  if (repeats.length >= 2) push('repeats_questions', repeats.length, 'medium', refsOf(repeats),
    'Asked again for something already asked.');
  if (delivery.stats && delivery.stats.fillerPer100 > 6) push('high_filler_rate',
    Math.round(delivery.stats.fillerPer100), 'medium', [],
    `${delivery.stats.fillerPer100.toFixed(1)} fillers per 100 words is high enough to interrupt the listener.`);
  const pressure = actionsOf(turns, 'pressure');
  if (pressure.length >= 1) push('pressure_after_no', pressure.length, 'high', refsOf(pressure),
    'Kept pushing after the prospect had made their position clear.');
  /* Rushing the pitch specifically -- the pattern the brief calls out. */
  const pitchRows = actionsOf(turns, ...PITCH_ACTIONS).map((t) => t.delivery).filter(Boolean);
  const discRows = actionsOf(turns, 'discovery_question', 'high_value_follow_up').map((t) => t.delivery).filter(Boolean);
  if (pitchRows.length && discRows.length) {
    const pm = pitchRows.reduce((a, d) => a + (d.wpm || 0), 0) / pitchRows.length;
    const dm = discRows.reduce((a, d) => a + (d.wpm || 0), 0) / discRows.length;
    if (pm - dm > 40) push('rushes_the_pitch', pitchRows.length, 'medium', [],
      `Speaking sped up from about ${Math.round(dm)} to ${Math.round(pm)} words per minute when the offer came up.`);
  }
  return out;
}

/* ══ SCRIPT RELIANCE ═════════════════════════════════════════════════
   Descriptive. It explains behaviour; it does not own the score. */
function scriptReliance(turns) {
  const f = founderTurns(turns).filter((t) => typeof t.script_similarity === 'number');
  const mean = (a) => (a.length ? r1(a.reduce((x, y) => x + y, 0) / a.length * 100) : null);
  const by = (names) => mean(founderTurns(turns)
    .filter((t) => names.includes(t.founder_action) && typeof t.script_similarity === 'number')
    .map((t) => Number(t.script_similarity)));
  return {
    overall: mean(f.map((t) => Number(t.script_similarity))),
    opening: (() => { const first = founderTurns(turns)[0];
      return first && typeof first.script_similarity === 'number' ? r1(first.script_similarity * 100) : null; })(),
    discovery: by(['discovery_question', 'high_value_follow_up']),
    pitch: by(PITCH_ACTIONS),
    close: by(['close_request']),
    note: 'Descriptive only. High similarity is not penalised on its own.',
  };
}

/* ══ NON-BUYER ═══════════════════════════════════════════════════════
   Two categories that exist only on a call where the person cannot buy, and
   both are DETERMINISTIC on purpose. If "did they understand the situation?"
   fell to the Nuance Judge, gatekeeper scoring would be model opinion --
   which is the competitor weakness this product exists to beat. The judge
   may add nuance above this floor; it may never be the only thing here. */

/* THE OFFER IS NOT SPENT ON SOMEONE WHO CANNOT ACCEPT IT. Read from the
   reconciled event, which is the thing that survived the evidence bar --
   never from the label, and never from the hidden role. */
/* THE HEAVIEST NON-BUYER AXIS, ON THE WORST OF BOTH DEFECTS ────────────────
   It read `detected_events.includes('pitched_a_non_buyer')` -- a column the
   BROWSER writes -- and then paid full marks, 30 of 100, for that string's
   ABSENCE. So a founder who really did spend the offer on a gatekeeper could
   delete the fault by omitting one word from `p_events`, and a call in which
   nothing happened at all collected the same 30/30 as one where the offer was
   genuinely and deliberately held back.

   `pitched_a_non_buyer` has no canonical producer, so there is nothing to
   swap it for. The axis is graded on the canonical pitch faults that DO
   exist, and absence earns nothing -- the disposition P5R-4 already applied
   to `qualification`. Holding back deliberately is not punished by that,
   because the eligibility layer resolves it to `declined` and withdraws the
   axis before it can be read as a failure. */
function scorePitchDiscipline(turns, lens) {
  const f = founderTurns(turns);
  const W = NON_BUYER_WEIGHTS.pitchDiscipline;
  if (!lens) {
    return cat(0, W, STATUS.NOT_TESTED, 0, [],
      'This call has no canonical evidence, so the offer was not judged.');
  }
  const faults = new Set([...lens.sequences('pitched_a_non_buyer'),
    ...lens.sequences('pitched_without_permission'),
    ...lens.sequences('sold_after_do_not_contact')]);
  const spent = f.filter((t) => faults.has(Number(t.sequence)));
  if (spent.length) {
    return cat(0, W, STATUS.SUFFICIENT, spent.length, refsOf(spent),
      'The offer was made to someone who had already said the decision was not theirs.');
  }
  if (lens.has('explicit_permission_to_continue')) {
    const seqs = lens.sequences('explicit_permission_to_continue');
    return cat(W, W, STATUS.SUFFICIENT, seqs.length,
      refsOf(f.filter((t) => Number(t.sequence) > Math.min(...seqs)).slice(0, 2)),
      'The offer waited until they invited it.');
  }
  return cat(0, W, STATUS.NOT_TESTED, 0, [],
    'The offer never came up on this call, so pitch discipline was not tested.');
}

/* DID THEY TRY TO REACH WHO CAN. Judged by the product's own move contract
   rather than by a keyword list here: `reach_the_decision_maker` already
   defines what that sentence has to do, and a second definition in this file
   is a second definition of the same rule. */
function scoreRouting(turns) {
  const f = founderTurns(turns);
  if (!f.length) {
    return cat(0, NON_BUYER_WEIGHTS.routing, STATUS.NOT_TESTED, 0, [], 'Nothing was said.');
  }
  const asked = f.filter((t) => adheres(textOf(t), 'reach_the_decision_maker').pass);
  if (asked.length) {
    return cat(NON_BUYER_WEIGHTS.routing, NON_BUYER_WEIGHTS.routing, STATUS.SUFFICIENT,
      asked.length, refsOf(asked), 'Asked who owns the decision, and asked to reach them.');
  }
  return cat(0, NON_BUYER_WEIGHTS.routing, STATUS.SUFFICIENT, f.length, refsOf(f.slice(0, 3)),
    'The call never asked who could actually decide.');
}

/* An existing category, re-scaled to this denominator. The scorers are
   reused unchanged -- the locked design says so -- but `cat` embeds the max,
   and a 10-point opening dropped into a 15-point slot would silently cost
   the founder a third of it. */
function rescale(category, max) {
  if (!category || !category.max) return category;
  return { ...category, score: r1((category.score / category.max) * max), max };
}

/* ══ GUIDED ══════════════════════════════════════════════════════════ */
function guidedSummary(turns) {
  const failed = failedTurns(turns);
  const retries = turns.filter((t) => t.speaker === 'founder' && Number(t.attempt_no) > 1);
  const accepted = retries.filter((t) => (t.detected_events || []).some((e) => /^retry_accepted/.test(e)));
  const reasons = failed.map((t) => (t.detected_events || []).find((e) => /^coached:/.test(e)) || '')
    .map((e) => e.replace('coached:', '')).filter(Boolean);
  const repeated = reasons.filter((x, i) => reasons.indexOf(x) !== i);
  return { interventions: failed.length, retries: retries.length, acceptedRetries: accepted.length,
    repeatedMistakes: [...new Set(repeated)],
    firstAttemptActions: failed.map((t) => t.founder_action) };
}

function evidenceSufficiencyOf(insufficient, testedWeight) {
  if (insufficient) return STATUS.INSUFFICIENT;
  return testedWeight >= 85 ? STATUS.SUFFICIENT : STATUS.THIN;
}

/* ── THE NON-BUYER CALL, END TO END ───────────────────────────────────
   Its own denominator, its own floors, and the same shape of result object
   so nothing downstream has to know which track it is looking at. The one
   field that differs is `track`, and everything that consumes a score reads
   it rather than inferring.

   NO GLOBAL CEILINGS AND NO 90-GATE. Both are calibrated against the buyer
   set -- "three unsupported claims" and "eight positive signals" are counts
   over categories this call does not have. Reusing them would import a
   denominator through the back door after taking care to replace it. */
/* ── THE CALL THE FOUNDER ENDED ───────────────────────────────────────
   A ceiling, and the only one that applies on BOTH tracks. The other two
   are counts over buyer categories -- "three unsupported claims", "pressure
   after a refusal" -- and importing them onto a gatekeeper call would smuggle
   a denominator back in after taking care to replace it. This one counts
   nothing and belongs to no denominator: the prospect left, and they left
   because of a turn the behaviour engine attributed to the founder in code.
   That is equally true of whoever answered the phone.

   Two causes, two ceilings, because they are not the same mistake. Hostility
   ends the call by how a person was treated and invalidates it as a sales
   attempt outright. Still pushing when they left is a sales error -- terminal,
   but recognisably an error about selling. */
const ENDING_CEILINGS = Object.freeze({
  hostility_from_founder: { cap: 30, why: 'The prospect ended the call after how they were spoken to.' },
  pushed_too_hard: { cap: 45, why: 'The prospect ended the call while still being pushed.' },
});


/* ── HOSTILITY THE SCORE CAN TRUST, AND CANNOT BE RETRIED AWAY ────────
   Two defects, one function.

   IT READ `detected_events`, WHICH THE CLIENT WRITES. Omitting one array
   entry lifted the ceiling on an abusive call. The utterance is re-derived
   here from the transcript with the same predicate the behaviour engine
   uses, so the consequence follows from what was said, not from what the
   browser chose to report.

   IT ALSO READ ONLY NON-SUPERSEDED TURNS (`founderTurns` drops
   `branch === 'superseded'`), so a founder could abuse, retry, and have the
   cap disappear with the attempt. A hostile line the prospect actually
   received is historical fact and a retry does not unsay it.

   BUT AN INTERCEPTED LINE IS NOT A HOSTILE CALL. Guided stops some
   attempts before they reach the Prospect Brain -- "that did not send" --
   and those must not be punished. The two are told apart by a
   server-owned fact rather than a client claim: whether the PROSPECT
   ANSWERED that attempt. An intercepted attempt is superseded by its retry
   with nothing generated in between; a delivered one has the prospect's
   reply sitting between it and the founder's next turn.

   Accepted turns need no such test -- they stand in the call as spoken. */
function deliveredHostility(turns = []) {
  const ordered = [...turns].filter(Boolean).sort((a, b) => (Number(a.sequence) - Number(b.sequence))
    || (Number(a.attempt_no ?? a.attemptNo ?? 1) - Number(b.attempt_no ?? b.attemptNo ?? 1)));
  for (let i = 0; i < ordered.length; i += 1) {
    const t = ordered[i];
    if (t.speaker !== 'founder') continue;
    if (!severeHostility(t.text ?? t.content ?? '')) continue;
    if (String(t.branch ?? 'accepted') !== 'superseded') return t;
    /* Superseded: did the prospect answer THIS attempt? */
    for (let j = i + 1; j < ordered.length && ordered[j].speaker !== 'founder'; j += 1) {
      if (ordered[j].speaker === 'prospect') return t;
    }
  }
  return null;
}

function endingCeiling(f, allTurns = f) {
  /* HOSTILITY CAPS ON ITS OWN EVIDENCE, NOT ON THE PROSPECT SUCCEEDING.
     This read `conversation_ended_by_founder` alone, which only exists when
     the simulated prospect actually terminated -- so abuse on the last turn,
     or abuse a simulation carried on through, was capped by nothing and
     scored as an ordinary call. A founder does not get the ceiling lifted
     because the person they abused kept talking.

     Checked FIRST and returning the same 30 the ending path already
     returned, so a hostile call that DID end is scored exactly as before.
     `pushed_too_hard` is untouched in both value and trigger. */
  const hostile = deliveredHostility(allTurns);
  if (hostile) return ENDING_CEILINGS.hostility_from_founder;
  const ended = f.find((t) => (t.detected_events || []).includes('conversation_ended_by_founder'));
  if (!ended) return null;
  const tag = (ended.detected_events || []).map(String)
    .find((e) => e.indexOf('ended_because:') === 0);
  const reason = tag ? tag.slice('ended_because:'.length) : null;
  /* A stored call from before the reason was recorded still ended, and the
     ceiling that applies to it is the gentler of the two -- never the
     harsher one on a cause nobody wrote down. */
  return ENDING_CEILINGS[reason] || ENDING_CEILINGS.pushed_too_hard;
}

function scoreNonBuyerCall({ turns, session, now, dead, f, lens = null,
  opportunityOutcomes = null }) {
  const sales = applyOpportunityEligibility({
    opening: rescale(scoreOpening(turns, lens), NON_BUYER_WEIGHTS.opening),
    listening: rescale(scoreListening(turns, dead, lens), NON_BUYER_WEIGHTS.listening),
    pitchDiscipline: scorePitchDiscipline(turns, lens),
    routing: scoreRouting(turns),
    nextStep: rescale(scoreClose(turns, session, lens), NON_BUYER_WEIGHTS.nextStep),
  }, opportunityOutcomes);
  const delivery = scoreDelivery(turns);
  const tested = Object.keys(NON_BUYER_WEIGHTS).filter((k) => sales[k].evidenceStatus !== STATUS.NOT_TESTED);
  const testedWeight = tested.reduce((a, k) => a + NON_BUYER_WEIGHTS[k], 0);
  const earned = tested.reduce((a, k) => a + sales[k].score, 0);
  /* Same rule on both tracks: a correctly handled gatekeeper call is
     SUPPOSED to be short, so a turn count was always the wrong gate here. */
  const insufficient = scoredAxisCount(sales) < MIN_SCORED_AXES;
  let salesScore = testedWeight > 0 ? (earned / testedWeight) * 100 : 0;
  const ending = endingCeiling(f, turns);
  const ceilings = ending ? [ending] : [];
  if (ending) salesScore = Math.min(salesScore, ending.cap);
  const deliveryScore = delivery.score;
  const overall = deliveryScore == null ? r1(salesScore)
    : r1(salesScore * OVERALL_WEIGHTING.sales + deliveryScore * OVERALL_WEIGHTING.delivery);

  return {
    rubricVersion: RUBRIC_VERSION,
    evidenceVersion: EVIDENCE_VERSION,
    scoredAt: now || new Date().toISOString(),
    track: TRACK.NON_BUYER,
    outcome: session.outcome || null,
    overallScore: insufficient ? null : overall,
    /* SYMMETRY WITH THE BUYER PATH (v1_2). An insufficient call nulls all
       three numbers, not just the overall -- persisting a real sales_score
       under a null overall taught every downstream reader two different
       meanings of "not enough evidence" depending on which desk answered
       the phone. */
    sales: { score: insufficient ? null : r1(salesScore), testedWeight, ...sales },
    delivery: insufficient ? { ...delivery, score: null } : delivery,
    /* THE HONEST HALF OF PROGRESSION. Excellent gatekeeper execution earns
       full credit on this track and proves nothing about discovery,
       objection handling or closing -- so the buyer categories are named as
       untested rather than quietly omitted, and a consumer that wants to
       know what this call did NOT establish can read it. */
    unscored: ['discovery', 'grounding', 'pitchTiming', 'objectionHandling', 'qualification', 'close'],
    appliedCeilings: ceilings,
    majorPatterns: [],
    guided: guidedSummary(turns),
    scriptReliance: scriptReliance(turns),
    achievement: null,
    evidenceSufficiency: evidenceSufficiencyOf(insufficient, testedWeight),
    assessmentConfidence: insufficient ? 0.3 : 0.75,
  };
}

/* ══ THE SCORE ═══════════════════════════════════════════════════════
   PHASE 7 SEAM — `dead`. markDeadQuestions re-reads the transcript with its
   own overlap threshold, and the rule engine already answers that same
   question with a citation and a reconciled status. Where the caller has
   that answer it is passed IN, so a repeat the Reconciler refused cannot be
   charged here by a second opinion nobody can see. Omit it and the behaviour
   is exactly what it always was. Nothing else about this function moved: no
   weight, no threshold, no category. */


/* ══ THE CANONICAL LENS ════════════════════════════════════════════════
   P5R-4. Four axes read `detected_events`, `founder_action` and
   `active_objection` -- all three written by the BROWSER through
   practice_turn_append_v1. So the score a founder is shown depended on
   columns that founder could author, and it contradicted the server's own
   evidence: Call C scored `pitchTiming 10/10` while its canonical run holds
   `pitched_without_permission@9`.

   These read canonical events instead. `null` means the caller supplied
   none -- a legacy call, or a run that never completed -- and each axis then
   falls back to its previous behaviour, so an un-migrated caller cannot
   silently lose scoring. WITHHELD and INELIGIBLE events are excluded: the
   producer declined to stand behind them, and a score is a claim. */
function canonicalLens(events) {
  /* ── AN EMPTY DERIVATION IS NOT A MISSING ONE ──────────────────────
     `!events.length` used to be treated like `null`, so a call whose
     extractors RAN and found nothing fell all the way back to the legacy
     client-column path -- where the absence of a fault is credit. Measured
     on a one-founder-turn call: `grounding 15/15`, and an overall of 36.9
     on "Hi, is the owner around?". That is the exact defect P5R exists to
     remove, surviving in the one case nobody scored: the empty call.

     `null` still means "no derivation was available" (a legacy row), and
     that path is unchanged. `[]` means "we looked and there was nothing",
     which is a fact, and every axis reads it as not-tested. */
  if (!Array.isArray(events)) return null;
  const supported = events.filter((e) => {
    /* Only what the Reconciler STOOD BEHIND. A withheld event is one its own
       producer disowned, and it must not grade anyone. Missing authority is
       admitted because the offline harnesses build events without one. */
    const a = e && e.authority;
    return !a || a === 'supported';
  });
  const typed = (t) => supported.filter((e) => (e.eventType || e.event_type) === t);
  const seqOf = (e) => Number(e.subjectSequence ?? e.subject_sequence);
  return {
    has: (t) => typed(t).length > 0,
    count: (t) => typed(t).length,
    sequences: (t) => typed(t).map(seqOf).filter((n) => Number.isFinite(n)),
  };
}

/* ══ HOW EACH SCORED AXIS TREATS THE FIVE OUTCOMES ═════════════════════
   P5R-4. Every axis must say, out loud and in one place, what each
   canonical opportunity outcome does to its eligibility and its score. It
   was previously decided implicitly and inconsistently inside eight separate
   functions, and the inconsistencies were measurable:

     Call C scored pitchTiming 10/10 -- "the offer came only after the
     prospect had given a reason for it" -- on a call whose canonical
     evidence contains `pitched_without_permission@9`.

     Calls A, C and E scored grounding 15/15 for asserting nothing, while
     their canonical grounding outcome is `unknown` because no research
     resolved and the rule correctly refused to accuse.

   THE RULE, ONE LINE: only an ATTEMPT is scored, and only an attempt is in
   the denominator.

     absent              not tested. Earns nothing, costs nothing, and its
                         weight LEAVES the denominator. A skill that never
                         came up cannot make a seller look worse.
     prevented           not tested. The counterparty closed it. Charging a
                         founder for a door somebody else shut is the single
                         most damaging thing this rubric could do.
     declined            not tested. The founder judged that acting was
                         wrong and did not act. Not a success -- it earns
                         nothing -- but emphatically not a failure.
     attempted_success   tested, scored on its own terms.
     attempted_failure   tested, scored on its own terms.
     unknown             not tested. We could not read it; that is not the
                         seller's fault either.

   Two axes have NO canonical opportunity source and say so rather than
   pretending: `opening` (Phase 3 dropped the matching skill deliberately)
   and `qualification` (fairness-blocked -- it reads the simulator's private
   needDiscovered). They keep their existing eligibility and are declared
   here so the gap is visible instead of silent. */
export const AXIS_OPPORTUNITY_SOURCE = Object.freeze({
  discovery: 'discovery',
  listening: 'listening_and_building',
  grounding: 'grounding_claims',
  objectionHandling: 'objection_handling',
  pitchTiming: 'pitch_discipline',
  close: 'authority_and_routing',
  opening: null,          /* no canonical skill — declared, not inferred     */
  qualification: null,    /* fairness-blocked source — see the header        */

  /* ── THE NON-BUYER TRACK USES DIFFERENT AXIS NAMES ──────────────────
     Found by a gate, not by reading: this map only covered the BUYER names,
     so the non-buyer track never had opportunity eligibility applied at all
     and a gatekeeper call with nothing measurable in it still scored 44.1.
     The invariant is "EVERY scored axis declares its behaviour", and half
     the axes were quietly outside it. */
  pitchDiscipline: 'pitch_discipline',
  routing: 'authority_and_routing',
  nextStep: 'authority_and_routing',
});

/* The only two outcomes that put an axis in the denominator. */
export const SCORED_OUTCOMES = Object.freeze(['attempted_success', 'attempted_failure']);

/* Why an axis was not tested, in the seller's language. Absence is never
   phrased as a shortcoming. */
const NOT_TESTED_BECAUSE = Object.freeze({
  absent: 'This never came up on the call, so it was not scored.',
  prevented: 'The prospect closed this off, so it was not scored — that is not held against you.',
  declined: 'You judged that this was not the moment, and did not force it. Not scored either way.',
});

/* ── `unknown` IS DELIBERATELY NOT IN THAT TABLE ───────────────────────
   It means the MASTERY SKILL could not be read -- usually because its
   canonical positive event does not exist yet, or its quality source was
   withdrawn for being client-authored. That is a statement about the durable
   ledger, NOT about the rubric axis, which scores a different question from
   different evidence: `listening` counts turns that built on what the
   prospect just said, straight from the transcript, whether or not a
   canonical "built on their answer" event exists.

   Treating `unknown` as not-tested was tried and measured first: it drove
   testedWeight from 75 to between 20 and 35 on all four frozen calls,
   putting every one of them under the evidence floor. That is not honesty,
   it is a product that scores nothing. The three states above are FACTS
   ABOUT THE CALL -- the chance never arose, the prospect closed it, the
   founder declined it -- and only those override an axis. */

/* Applied AFTER an axis computes, so an axis never has to know about the
   opportunity model and the model never has to know about eight rubrics.
   An axis with no canonical outcome is returned untouched. */
export function applyOpportunityEligibility(sales, outcomes) {
  if (!outcomes || typeof outcomes !== 'object') return sales;
  const out = { ...sales };
  Object.keys(out).forEach((axis) => {
    const skill = AXIS_OPPORTUNITY_SOURCE[axis];
    if (!skill) return;
    const outcome = outcomes[skill];
    if (!outcome || SCORED_OUTCOMES.includes(outcome)) return;
    const why = NOT_TESTED_BECAUSE[outcome];
    if (!why) return;
    out[axis] = cat(0, out[axis].max, STATUS.NOT_TESTED, 0, [], why);
  });
  return out;
}

export function scorePractice({ turns = [], session = {}, now = null, dead: injectedDead = null,
  track = TRACK.BUYER,
  /* Canonical opportunity outcomes, keyed by mastery skill. Absent means the
     caller had none, and every axis then keeps its own eligibility exactly as
     before -- so a caller that has not been updated cannot silently lose
     scoring. */
  opportunityOutcomes = null,
  /* The canonical events themselves, for the four axes that used to read
     client-authored columns. */
  canonicalEvents = null } = {}) {
  const f = founderTurns(turns);
  const dead = injectedDead instanceof Map ? injectedDead : markDeadQuestions(turns);
  const lens = canonicalLens(canonicalEvents);
  /* The lens is built BEFORE this dispatch on purpose. It used to be built
     after, so the non-buyer track ran the entire call on the pre-P5R-4 path:
     no canonical evidence, no opportunity eligibility, every axis falling back
     to `detected_events`. Nothing caught it because every P5R-4 fixture scores
     `track: 'buyer'` -- a gate can only see the track it runs. */
  if (track === TRACK.NON_BUYER) {
    return scoreNonBuyerCall({ turns, session, now, dead, f, lens, opportunityOutcomes });
  }
  const sales = applyOpportunityEligibility({
    opening: scoreOpening(turns, lens), discovery: scoreDiscovery(turns, dead, lens),
    listening: scoreListening(turns, dead, lens), grounding: scoreGrounding(turns, lens),
    pitchTiming: scorePitchTiming(turns, lens),
    objectionHandling: scoreObjectionHandling(turns, lens),
    qualification: scoreQualification(turns), close: scoreClose(turns, session, lens),
  }, opportunityOutcomes);
  const delivery = scoreDelivery(turns);

  /* Untested categories leave the denominator rather than scoring zero --
     a founder is not marked down for an objection that never came. */
  const tested = Object.keys(SALES_WEIGHTS).filter((k) => sales[k].evidenceStatus !== STATUS.NOT_TESTED);
  const testedWeight = tested.reduce((a, k) => a + SALES_WEIGHTS[k], 0);
  const earned = tested.reduce((a, k) => a + sales[k].score, 0);

  /* SUFFICIENCY COUNTS BEHAVIOURS, NOT WEIGHT. The founder-turn floor goes
     with it: it was a raw count the COUNTERPARTY controls -- Call A was hung
     up on at three turns and failed the gate for it -- and "did enough
     independent things get tested" already covers what it was protecting
     against, without charging a founder for someone else ending the call. */
  const scoredAxes = scoredAxisCount(sales);
  const insufficient = scoredAxes < MIN_SCORED_AXES;
  let salesScore = testedWeight > 0 ? (earned / testedWeight) * 100 : 0;

  /* ── GLOBAL CEILINGS ────────────────────────────────────────────────
     Category penalties do most of the work. These exist only for failures
     that invalidate the sale itself. */
  const ceilings = [];
  const assumptionCount = f.filter((t) => (t.detected_events || []).includes('unsupported_assumption')).length;
  if (assumptionCount >= 3) { ceilings.push({ cap: 45, why: `${assumptionCount} unsupported claims about the prospect.` }); }
  if (actionsOf(turns, 'pressure').length > 0) { ceilings.push({ cap: 55, why: 'Pressure applied after a clear refusal.' }); }
  const ending = endingCeiling(f, turns);
  if (ending) ceilings.push(ending);
  const cap = ceilings.length ? Math.min(...ceilings.map((c) => c.cap)) : null;
  if (cap != null) salesScore = Math.min(salesScore, cap);
  const majorPatterns = patterns(turns, sales, delivery);

  const deliveryScore = delivery.score;
  let overall = (deliveryScore == null)
    ? r1(salesScore)
    : r1(salesScore * OVERALL_WEIGHTING.sales + deliveryScore * OVERALL_WEIGHTING.delivery);

  /* ── THE 90 GATE ────────────────────────────────────────────────────
     Ninety has to be an achievement, not the score you get for avoiding
     mistakes. Reaching it requires POSITIVE evidence of good execution
     across the call, and every one of these is a thing the founder did
     rather than a thing they failed to do. */
  const positives = [];
  if (sales.opening.score >= SALES_WEIGHTS.opening * 0.9) positives.push('relevant_opening');
  if (sales.discovery.score >= SALES_WEIGHTS.discovery * 0.8) positives.push('adaptive_discovery');
  if (sales.listening.score >= SALES_WEIGHTS.listening * 0.8) positives.push('built_on_answers');
  if (sales.grounding.score >= SALES_WEIGHTS.grounding) positives.push('stayed_grounded');
  if (sales.qualification.score >= SALES_WEIGHTS.qualification * 0.8) positives.push('qualified');
  if (sales.pitchTiming.evidenceStatus === STATUS.NOT_TESTED
    || sales.pitchTiming.score >= SALES_WEIGHTS.pitchTiming) positives.push('pitch_timed_or_untested');
  if (sales.objectionHandling.evidenceStatus === STATUS.NOT_TESTED
    || sales.objectionHandling.score >= SALES_WEIGHTS.objectionHandling * 0.9) positives.push('objection_handled_or_untested');
  if (sales.close.score >= SALES_WEIGHTS.close * 0.9) positives.push('earned_next_step_or_clean_exit');

  const DEPTH_FOR_90 = 6;
  const gate90 = {
    sufficient: evidenceSufficiencyOf(insufficient, testedWeight) === STATUS.SUFFICIENT,
    salesAtLeast90: salesScore >= 90,
    deliveryAtLeast85: deliveryScore != null && deliveryScore >= 85,
    noCeiling: ceilings.length === 0,
    noMajorPattern: majorPatterns.length === 0,
    enoughDepth: f.length >= DEPTH_FOR_90,
    positiveEvidence: positives.length >= 7,
  };
  const eligible90 = Object.values(gate90).every(Boolean);

  /* Ninety-five is harder again: nothing merely adequate anywhere. */
  const scored = Object.keys(SALES_WEIGHTS)
    .filter((k) => sales[k].evidenceStatus !== STATUS.NOT_TESTED);
  const gate95 = {
    ...gate90,
    everyCategoryExcellent: scored.every((k) => sales[k].score >= SALES_WEIGHTS[k] * 0.9),
    deliveryAtLeast92: deliveryScore != null && deliveryScore >= 92,
    positiveEvidenceComplete: positives.length === 8,
  };
  const eligible95 = Object.values(gate95).every(Boolean);

  if (overall > 94 && !eligible95) overall = 94;
  if (overall >= 90 && !eligible90) overall = 89;
  overall = r1(overall);

  const evidenceSufficiency = evidenceSufficiencyOf(insufficient, testedWeight);
  /* VISION's confidence in its own assessment. Never the founder's. */
  const assessmentConfidence = insufficient ? 0.2 : r1(clamp(testedWeight / 100, 0.3, 0.97));

  return {
    rubricVersion: RUBRIC_VERSION, evidenceVersion: EVIDENCE_VERSION,
    scoredAt: now,
    /* STATED, NOT INFERRED. Leaving it off this path made "buyer" mean
       `undefined`, which every consumer would have had to guess at. */
    track: TRACK.BUYER,
    outcome: session.outcome || null,
    overallScore: insufficient ? null : overall,
    sales: { score: insufficient ? null : r1(salesScore), testedWeight, ...sales },
    delivery: { score: insufficient ? null : deliveryScore,
      clarity: delivery.clarity, approachability: delivery.approachability, pacing: delivery.pacing,
      concision: delivery.concision, composure: delivery.composure, rhythm: delivery.rhythm },
    scriptReliance: scriptReliance(turns),
    majorPatterns,
    guided: guidedSummary(turns),
    appliedCeilings: ceilings,
    evidenceSufficiency, assessmentConfidence,
    /* Shown so a future review can say WHY ninety was or was not reached. */
    achievement: { positives, gate90, eligible90, eligible95 },
    founderTurnCount: f.length,
    /* Deferred, and named so nothing downstream invents it. */
    unscored: ['pitch_variation', 'monotone', 'interruption_overlap'],
  };
}
