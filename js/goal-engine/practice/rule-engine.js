/* ════════════════════════════════════════════════════════════════════════
   WHAT THE FOUNDER OBSERVABLY DID.

   Deterministic only. Every rule cites the turn that caused it and the exact
   words relied on, and every rule may decline. What declines here is the
   Nuance Judge's job later; guessing is nobody's.

   THREE THINGS THE COUNCIL MEASURED THAT SHAPE THIS FILE:

   1. RULES RUN ON ASSEMBLED TURNS, NEVER PERSISTED ROWS. A lexical repeat
      test over persisted rows finds three matches in this corpus; the same
      test over Pass-1 assembled turns finds none. All three were transcriber
      cuts -- "If it's not useful, you" scored 0.50 overlap against the turn
      it was cut from. A two-word fragment makes any ratio explode.

   2. UNEARNED CLOSE READS QUALIFICATION, NOT PITCH PERMISSION. Those two
      fields disagree on every close in the corpus, in both directions: call
      A had permission and zero qualification, call B had qualification and no
      permission -- and B's permission was granted by a three-word fragment.
      Permission means "they invited the offer". It does not mean a need
      exists, which is what an unearned close is about.

   3. THE FOUNDER'S REAL CLOSE PHRASING IS A TIME BOX. "15 minutes where I
      show you exactly where those enquiries are going" is a close, and the
      existing classifier misses it in two of the four closes in this corpus.
   ══════════════════════════════════════════════════════════════════════ */

import {
  normalise, polarityIsAffirmed, attribution, isMatrixImperativeTo, isCloseAttempt,
  isWeakDiscovery, objectionMishandled, OFFER_CONTENT, isPitchAttempt,
  audioProvenance, contentOverlap, contentWords, stripDiscourseHead, PRESSURE, coercionAdmissible,
  pitchedDisclaimedNonBuyerAdmissible } from './evidence-gates.js';
import { ANSWER_STATE } from './answer-key.js';
import { ASKED_WHY_YOU_CALLED } from './call-state.js';
/* ONE AUTHORITY, REUSED -- not a second classifier. This is the same
   exported predicate the live behaviour engine uses to assign
   `unsupported_assumption`, so the server cannot drift from what the founder
   was told during the call. It reads only the founder's own text, the
   prospect's transcribed lines, and the granted-research context passed in;
   it has no access to any hidden scenario field. Verified before reuse:
   grantedTerms / aboutTheProspect / claimsAboutThem read exactly
   `context.prospect.name` and `context.evidence.observed`. */
import { assertsUnsupportedClaim, buildsOnTheirAnswer } from './prospect-behaviour.js';
import {
  makeEvent, citation, applyEligibility, PRODUCER, AUTHORITY, NEGATIVE_TYPES,
} from './candidate-events.js';

/* v2 (P5R-1): emits `unsupported_assumption`, which the server has never
   produced -- the type was declared in the vocabulary and had no producer, so
   `grounding_claims` had a NEGATIVE half that could never fire and a positive
   half derived from absence. Changes what this producer emits for an
   unchanged call, so the version moves and event ids move with it. */
/* v3 (P5R-2): the authority idiom "it's not your call" is masked out of the
   close test, so a routing request that acknowledges authority no longer
   produces close_attempted/unearned_close. Changes what this producer emits
   for an unchanged call, so the version moves and event ids move with it. */
/* Bounded to the founder declaring they will NOT offer/sell/pitch. Not
   "maybe later", not a question about pitching -- a stated decision. */
/* The founder asking who owns it or where to go next. Bounded to an ASK --
   naming a role in passing is not a routing question. */
/* Deliberately broad: this only ever SUPPRESSES credit, so over-matching
   costs a founder nothing and under-matching would pay them for arguing. */
const OBJECTION_LIKE = /\b(?:covered|sorted|not (?:really )?an issue|not looking|not for us|already (?:have|got|work)|happy with|too expensive|no budget|can'?t afford|not my (?:call|decision)|only got a minute|no thanks|not interested|do ?n'?t need)\b/i;

const ROUTING_ASK = /\b(?:who (?:should|would|do) i (?:be )?(?:speak|talk|send|address)|who (?:owns|looks after|handles|deals with|is the right person)|who (?:actually )?owns|is that (?:someone else|you)|are you the (?:right person|person who)|what(?:'s| is) the (?:best|right) (?:way|person|number|address)|better time to ring|name (?:i|to) (?:should )?(?:ask for|put on)|would they rather i)\b/i;

/* The prospect naming WHO or WHERE, which is what a routing ask is for. */
const ROUTE_NAMED = /\b(?:practice manager|office manager|practice owner|the owner|the director|the partner|the principal|head of|manager would|manager deals|manager looks after|reception would)\b|\b(?:email|drop (?:them|her|him) a line|ring the main|main number|main inbox|put .{0,20} on it)\b/i;

const PITCH_DECLINED = /\b(?:i'?m|i am|we'?re|we are)\s+not\s+(?:going to|gonna|here to|about to)\s+(?:pitch|sell|push|flog|offer)\b|\bi\s+(?:wo|will)\s*n[o']?t\s+(?:pitch|sell|push)\b|\bnot\s+here\s+to\s+(?:pitch|sell)\b/i;

/* v5 (P5R-6b): emits `pitched_a_non_buyer` -- the offer spent on someone who
   had already said the decision was not theirs. The type was in the
   vocabulary with no server producer, so the heaviest non-buyer axis was
   graded on a string the browser wrote. Changes what this producer emits for
   an unchanged call, so the version moves and event ids move with it. */
/* v6 (P5R-7): emits `offer_asserted` and `close_earned`. Both are facts the
   rubric had no canonical word for, which is why it read `founder_action` and
   `pitch_permission_before` -- client columns that moved both axes on a
   byte-identical transcript. Changes what this producer emits, so the version
   moves and event ids move with it. */
export const RULE_ENGINE_VERSION = 'practice_rule_engine_v6';
const RV = 'v3';

/* ── WHAT THE FOUNDER WAS GRANTED, AND BY WHOM ─────────────────────────
   OBSERVED research GRANTS: VISION showed the founder this fact, so citing
   it is not an invention. INFERRED research does NOT grant -- it is VISION's
   own inference, and letting a guess license an assertion-as-fact is the
   absence-becomes-evidence mistake wearing a different hat. But an INFERRED
   fact that explains the claim does SUPPRESS the accusation, because
   convicting a founder for repeating something the product showed them would
   be worse than staying silent.

   The two are separated by running the SAME predicate against two contexts,
   rather than by a second matcher that could drift from the first:

     granted  = OBSERVED only            -> still flagged? it is an invention
     explains = OBSERVED + INFERRED      -> no longer flagged? inference explains it

   Fail closed: with no research resolved we do not know what was granted, so
   nothing is emitted at all. Not knowing what a founder was told is never
   evidence that they made it up. */
function researchContext(research, extra) {
  const observed = ((research && research.observed) || []).map((r) => r.text).filter(Boolean);
  const more = (extra || []).map((r) => r.text).filter(Boolean);
  return {
    prospect: { name: (research && research.prospectName) || '' },
    evidence: { observed: observed.concat(more) },
  };
}

const CLOSE = /\b(worth (a|fifteen|15)?\s*(look|chat|call|conversation)|book (a|some) time|set (something|a time) up|would .* work for you|next week|catch up|meet)\b/i;
/* The close this founder actually uses, and the one the old classifier
   misses: an explicit time box offered as the ask. */
const TIME_BOX = /\b(\d{1,3}|ten|fifteen|twenty|thirty)\s*(minutes?|mins?)\b/i;
/* An offer is asserted content -- a price, a deliverable, a mechanism --
   not merely the presence of a sales noun. "I'm not going to pitch you a
   package" contains the noun and asserts the opposite. */
/* AN OFFER IS ASSERTED CONTENT, not a noun that happens to appear near a
   sale. A bare "a month" fired this on "roughly how many of those a month
   would you say are genuinely new?" -- a discovery question. A money unit
   only counts when a figure is attached to it. */
/* ── AN OFFER, IN TWO SHAPES ──────────────────────────────────────────
   COMMERCIAL is money and named deliverables. It was the whole test, and it
   caught 4 of 10 real pitches on a labelled set: "We help accountancy firms
   cut their month-end close time roughly in half" is unmistakably an offer
   and names no price, no package and no service noun. So a founder could
   pitch before earning it, be classified `premature_pitch` by the behaviour
   engine every time, and never once be told -- the rule engine declined, and
   a claim the stronger producer declines is withheld.

   VALUE is the other shape: a first-person actor, a verb about doing
   something FOR someone, and the someone. All three are required in one
   clause, which is what keeps it from being the loose legacy regex --
   `\bwe (offer|provide|do|help)\b` alone matches "we help each other out".

   Both shapes still pass through the same four gates the rule already had:
   not a question, attributable to the founder, actually heard, and
   affirmed rather than negated. */
/* SOMEBODY ELSE'S CLAIM IS NOT AN OFFER — and attribution() already knows.
   I added a reported-speech guard here and then could not kill it with a
   mutation: "They said we help too many firms already" is refused by
   attribution() with reason `reported_speech`, with or without it. A guard
   no test can kill is a guard nobody can prove still works, so it is gone
   and the gate that actually does the job is named instead. */
/* Honouring the refusal. None of these may ever read as continuing to sell. */
const COMPLIANCE = /\b(sorry to have bothered|i'?ll take you off|i will take you off|remove you from|won'?t call again|will not call again|understood,? i'?ll leave|apologies)\b/i;
/* PRESSURE now lives in evidence-gates.js so the admission layer judges
   coercion by the same phrases this engine does, not a second list. */

const isQuestion = (t) => /\?\s*$/.test(normalise(t));
const REPEAT_THRESHOLD = 0.6;

/* Only turns VISION actually heard, in full, may be interpreted at all. */
function interpretable(turn) {
  if (!turn || turn.speaker !== 'founder') return { pass: false, reason: 'not_founder' };
  if (turn.branch === 'superseded') return { pass: false, reason: 'superseded_branch' };
  if (turn.complete !== true) return { pass: false, reason: 'incomplete_turn' };
  return { pass: true, reason: 'ok' };
}

function ev(o) { try { return makeEvent(o); } catch (e) { return null; } }

/* `turns` are Pass-1 ASSEMBLED turns in call order, each carrying speaker,
   text, sequence, attemptNo, complete, creditEligible and (where known) the
   delivery/levels provenance Pass 1 kept.
   `stateAt(seq)` returns the Pass-2 call state as it stood BEFORE that turn. */
export function runRules({ sessionId, turns = [], stateAt, answerKey, research = null } = {}) {
  const out = [];
  const push = (e) => { if (e) out.push(e); };
  const rows = (turns || []).filter((t) => t && normalise(t.text));

  /* Questions the prospect has already dealt with, in any way. */
  const settled = [];
  /* Prospect lines so far, for the disclosure half of the claim test, and a
     founder-turn counter for the opening exemption below. */
  const prospectSaid = [];
  let founderTurnNo = 0;
  let lastProspectLine = null;
  let lastProspectTurn = null;

  rows.forEach((turn, i) => {
    const said = normalise(turn.text);
    const seq = typeof turn.sequence === 'number' ? turn.sequence : i;

    if (turn.speaker === 'prospect') {
      for (let k = settled.length - 1; k >= 0; k -= 1) {
        if (settled[k].answeredAtSeq == null) {
          settled[k].answeredAtSeq = seq;
          settled[k].answer = said;
          settled[k].answerTurn = turn;
          break;
        }
      }
      prospectSaid.push(said);
      lastProspectLine = said;
      lastProspectTurn = turn;
      return;
    }
    const founderIndex = founderTurnNo;
    founderTurnNo += 1;

    const fit = interpretable(turn);
    const heard = audioProvenance(turn);
    const state = (typeof stateAt === 'function' ? stateAt(seq) : null) || null;
    const cite = citation(turn, said);
    if (!cite) return;

    const base = {
      sessionId, producer: PRODUCER.RULE, producerVersion: RULE_ENGINE_VERSION,
      ruleVersion: RV, subject: turn, sequence: seq,
    };

    /* A turn VISION did not finish hearing is recorded and interpreted for
       nothing. It stays visible; it produces no finding. */
    if (!fit.pass) {
      if (fit.reason === 'incomplete_turn') {
        push(ev({ ...base, ruleId: 'turn_not_interpretable', eventType: 'turn_not_interpretable',
          citations: [cite], authority: AUTHORITY.INELIGIBLE, authorityBasis: 'incomplete_turn' }));
      }
      return;
    }

    /* ── 1. CONTINUING TO SELL AFTER AN EXPLICIT DO-NOT-CONTACT ───────
       The highest-authority rule in the file, and the one the customer test
       proved missing: the prospect said "please don't call again" and the
       founder asked for a meeting. Nothing recorded it. */
    /* P0: COMPLYING IS NOT SELLING. The rule used to require only that a
       founder turn existed after the refusal, so an apology that honoured it
       -- "I'm sorry to have bothered you, I'll take you off my list" -- drew
       the most serious accusation in the taxonomy. Continuing to sell means
       asking for something, offering something, or pressing. */
    const stillSelling = (CLOSE.test(said) || TIME_BOX.test(said) || OFFER_CONTENT.test(said)
      || PRESSURE.test(said) || isQuestion(said)) && !COMPLIANCE.test(said);
    if (state && state.refusal && state.refusal.state === 'do_not_contact' && stillSelling) {
      const refusalCite = state.refusal.evidence
        ? { sequence: state.refusal.atSeq, attemptNo: 1, speaker: 'prospect',
          quote: String(state.refusal.evidence).slice(0, 300) } : null;
      push(ev({ ...base, ruleId: 'sold_after_do_not_contact',
        eventType: 'sold_after_do_not_contact',
        citations: refusalCite ? [refusalCite, cite] : [cite],
        authority: AUTHORITY.SUPPORTED,
        authorityBasis: `founder_spoke_after_do_not_contact_at_seq_${state.refusal.atSeq}` }));
    } else if (state && state.refusal && state.refusal.state === 'hard_no'
      && PRESSURE.test(said) && polarityIsAffirmed(said, PRESSURE).pass) {
      push(ev({ ...base, ruleId: 'pressure_after_refusal', eventType: 'pressure_applied',
        citations: [cite], authority: AUTHORITY.SUPPORTED,
        authorityBasis: 'pressure_phrase_after_hard_refusal' }));
    } else if (coercionAdmissible(said).pass) {
      /* COERCION NEEDS NO REFUSAL TO BE COERCION. Telling someone they are
         falling behind, or that rivals are already ahead of them, is a fear
         appeal on turn two as much as on turn nine -- and the behaviour
         engine's phrase list does not contain either shape, so without a
         producer here nobody sees it at all.

         This is the same gate the admission layer uses, so the two cannot
         drift apart: an affirmed coercive phrase that is not a question. */
      push(ev({ ...base, ruleId: 'coercive_pressure', eventType: 'pressure_applied',
        citations: [cite], authority: AUTHORITY.SUPPORTED,
        authorityBasis: 'coercive_phrase_affirmed_and_not_a_question' }));
    }

    /* ── 2. A CLOSE, AND WHETHER IT WAS EARNED ─────────────────────── */
    /* A time box is only a close when it is being OFFERED. "Do many patients
       wait thirty minutes?" is a discovery question with a duration in it. */
    /* THE SHARED CONTRACT, not a second opinion. This kept its own shapes
       and missed asks the behaviour classifier caught, so a real premature
       close produced no authoritative finding and no coaching card. */
    const closeAsk = isCloseAttempt(said, { speaker: 'founder' });
    /* attribution and polarity are already inside the shared contract. */
    const closeish = closeAsk.pass;
    if (closeish && turn.creditEligible !== false && heard.pass) {
      push(ev({ ...base, ruleId: 'close_attempted', eventType: 'close_attempted',
        citations: [cite], authority: AUTHORITY.SUPPORTED,
        authorityBasis: CLOSE.test(said) ? 'close_phrase' : 'time_box_offer' }));
      const level = state && state.qualification ? state.qualification.level : 0;
      /* ── P5R-7: THE EARNED CASE, AS A FACT RATHER THAN AN ABSENCE ────
         `unearned_close` said "this close had no basis". Nothing said the
         opposite, so the rubric read a CLIENT column
         (`pitch_permission_before`) to decide a close was earned -- the
         simulator's private warmth deciding a founder's score. Removing that
         column left only the absence of a fault, and absence is not credit.

         So the earned case gets its own event, from the SAME transcript-
         derived qualification level the fault reads. Level >= 2 means the
         prospect's own words established something worth closing on. */
      if (level >= 2) {
        push(ev({ ...base, ruleId: 'close_earned', eventType: 'close_earned',
          citations: [cite], authority: AUTHORITY.SUPPORTED,
          authorityBasis: `qualification_level_${level}_at_close` }));
      }
      if (level <= 1) {
        /* P0: THE ANSWER KEY WAS BEING THREADED IN AND DROPPED. A founder who
           asked and was refused has not failed to qualify -- the prospect
           declined. The claim is kept as a fact and withheld as an accusation. */
        const refused = ((answerKey && answerKey.entries) || []).filter((x) =>
          x.state === ANSWER_STATE.REFUSED || x.state === ANSWER_STATE.UNKNOWN_TO_PROSPECT).length;
        push(ev({ ...base, ruleId: 'unearned_close', eventType: 'unearned_close',
          citations: [cite],
          authority: refused > 0 ? AUTHORITY.WITHHELD : AUTHORITY.SUPPORTED,
          authorityBasis: refused > 0
            ? `qualification_level_${level}_but_prospect_withheld_${refused}_answers`
            : `qualification_level_${level}_at_close` }));
      }
    }

    /* ── 3. AN OFFER MADE WITHOUT PERMISSION ──────────────────────────
       Requires asserted offer content. The measured failure this replaces:
       "I'm not going to pitch you a package" was stored as a pitch because
       the word `package` appeared inside its own negation. */
    /* ── A PITCH FOLLOWED BY A QUESTION IS STILL A PITCH ──────────────
       This tested `!isQuestion(said)` on the WHOLE TURN, so any offer that
       ended with a question was invisible. Measured on Call C sequence 9 --
       "...we help practices like yours turn those enquiries into booked
       appointments through the content and paid ads side. Would it be worth
       me sending something over?" -- offer content present, the live engine
       flagged it, and the canonical extractor emitted nothing.

       That is the same composition error as the close classifier, inverted:
       there, words from separate sentences combined into a claim nobody
       made; here, one sentence cancelled a claim another sentence did make.
       Pitch-then-ask is one of the commonest shapes in cold calling, so this
       was not an edge case -- and it let `declined` stand on a call where the
       founder had already pitched. Judged per sentence: an assertion is not
       undone by a question next to it. */
    const offerSentence = String(said).split(/(?<=[.?!])\s+/)
      .map((x) => x.trim())
      .find((x) => x && !isQuestion(x) && OFFER_CONTENT.test(x)
        && attribution(x, OFFER_CONTENT).pass);
    if (offerSentence && heard.pass) {
      const affirmed = polarityIsAffirmed(offerSentence, OFFER_CONTENT);
      /* Permission for the call, OR the one-turn exemption for answering a
         direct "what are you calling about?" -- see ASKED_WHY_YOU_CALLED.
         Scoped to the immediately preceding prospect line so it excuses the
         reply and nothing after it. */
      const prevProspect = rows.slice(0, i).reverse().find((x) => x.speaker === 'prospect');
      const answeringWhy = !!(prevProspect && ASKED_WHY_YOU_CALLED.test(normalise(prevProspect.text)));
      const granted = !!(state && state.pitchPermission && state.pitchPermission.granted)
        || answeringWhy;
      if (!affirmed.pass) {
        push(ev({ ...base, ruleId: 'pitched_without_permission',
          eventType: 'pitched_without_permission', citations: [cite],
          authority: AUTHORITY.WITHHELD, authorityBasis: `offer_content_${affirmed.reason}` }));
      } else if (!granted) {
        push(ev({ ...base, ruleId: 'pitched_without_permission',
          eventType: 'pitched_without_permission', citations: [cite],
          authority: AUTHORITY.SUPPORTED, authorityBasis: 'offer_asserted_before_permission' }));
      }

      /* ── 3a. THE OFFER SPENT ON SOMEONE WHO SAID IT WAS NOT THEIRS ────
         A DIFFERENT FAULT FROM THE ONE ABOVE, and the rule above cannot
         stand in for it: permission to keep talking is not authority to buy.
         Measured -- "Go on then, quickly" grants permission, so a founder
         who then pitched straight past "that's not my call" produced NO
         canonical event at all.

         `pitched_a_non_buyer` existed only as a string in the browser's
         `detected_events`, and the reconciler's own gate keys on
         `founderAction`, another column the browser writes. So the heaviest
         axis on the non-buyer track rested on the seller's own label.

         The judgement here is `pitchedDisclaimedNonBuyerAdmissible` --
         REUSED WHOLE, not reimplemented: it already owns the transfer
         boundary and the question/negation/attribution guards. The only
         thing changed is where its `action` comes from: this engine has
         just proved, from the transcript, that the sentence asserts an
         offer, so it supplies that proof itself instead of trusting a
         label the seller wrote.

         THE OFFER TEST IS `isPitchAttempt`, NOT `OFFER_CONTENT`. Measured:
         "We offer call overflow handling for practices like yours, four
         hundred a month" does not match OFFER_CONTENT at all, so gating on
         the rule above would have shipped a conviction that fires on almost
         nothing -- worse than the column it replaces. `isPitchAttempt`
         carries the guards this needs anyway: the callback exclusion,
         cost-as-loss-framing, negation and attribution. Per SENTENCE, for
         the same reason rule 3 is: pitch-then-ask is still a pitch. */
    }
    if (heard.pass) {
      const pitchSentence = String(said).split(/(?<=[.?!])\s+/)
        .map((x) => x.trim())
        .find((x) => x && isPitchAttempt(x, { speaker: 'founder' }).pass);

      /* ── P5R-7: AN OFFER WAS ASSERTED HERE ───────────────────────────
         The fact `pitchTiming` had no canonical word for. That axis decided
         whether an offer happened from `founder_action`, a column the
         BROWSER writes -- so with the transcript byte-identical, relabelling
         one turn `pitch` instead of `premature_pitch` moved the axis from
         2/10 to 10/10.

         Detected with `isPitchAttempt`, not `OFFER_CONTENT`. That matters
         for FAIL-CLOSED: OFFER_CONTENT misses real offers ("we offer call
         overflow handling ... four hundred a month" is a measured miss), and
         an offer the extractor cannot see must never become a clean pitch.
         `isPitchAttempt` carries the guards this needs -- callback
         exclusion, cost-as-loss-framing, negation, attribution -- and is
         judged per SENTENCE, so pitch-then-ask is still a pitch.

         This event says only that an offer was ASSERTED. Whether it was
         earned is a separate question answered by separate evidence
         (`explicit_permission_to_continue` before it, or
         `pitched_without_permission` on it); where neither exists the axis
         declines to score rather than guessing. */
      if (pitchSentence) {
        push(ev({ ...base, ruleId: 'offer_asserted', eventType: 'offer_asserted',
          citations: [cite], authority: AUTHORITY.SUPPORTED,
          authorityBasis: 'offer_content_asserted_by_the_founder' }));
        /* ── AND WHETHER THEY HAD INVITED IT ─────────────────────────
           The positive half. Without it `pitchTiming` could only ever
           convict: every clean pitch fell to `not_tested`, which is the
           axis disabled in all but name.

           The permission read here is CALL-STATE's -- granted when the
           prospect literally says "what are you offering" / "tell me more"
           (call-state.js PITCH_INVITED), storing their quote. Phase 3
           established that this is the FAIR one, and it is a fold over the
           transcript. It is NOT `prospect-behaviour.js`'s pitchPermission,
           which is the simulator's private warmth, and NOT the
           `pitch_permission_before` column the browser writes.

           Emitted from the SAME broad detection as `offer_asserted`, so an
           offer this engine reads is judged by a permission signal it also
           read. Asserted-and-not-invited does NOT convict on its own -- the
           rubric returns not_tested, because a permission this engine failed
           to recognise must not become a fault any more than it may become
           credit. Conviction still requires `pitched_without_permission`. */
        const invited = !!(state && state.pitchPermission && state.pitchPermission.granted);
        if (invited) {
          push(ev({ ...base, ruleId: 'offer_invited', eventType: 'offer_invited',
            citations: [cite], authority: AUTHORITY.SUPPORTED,
            authorityBasis: state && state.pitchPermission && state.pitchPermission.atSeq != null
              ? `pitch_invited_at_${state.pitchPermission.atSeq}` : 'pitch_invited' }));
        }
      }
      const nb = pitchSentence ? pitchedDisclaimedNonBuyerAdmissible({
        turns: rows.map((r) => ({ speaker: r.speaker, text: r.text, sequence: r.sequence })),
        pitch: { sequence: turn.sequence, action: 'pitch' },
      }) : null;
      if (nb && nb.pass) {
        const disclaim = rows.find((r) => r.sequence === nb.disclaimedAt && r.speaker === 'prospect');
        push(ev({ ...base, ruleId: 'pitched_a_non_buyer', eventType: 'pitched_a_non_buyer',
          citations: disclaim
            ? [cite, { quote: String(disclaim.text).slice(0, 240), speaker: 'prospect',
              sequence: disclaim.sequence, attemptNo: disclaim.attemptNo || 1 }]
            : [cite],
          authority: AUTHORITY.SUPPORTED, authorityBasis: nb.reason }));
      }
    }

    /* ── 3b. A CLAIM ABOUT THEM THAT NOBODY PUT ON THE TABLE ──────────
       FAIL CLOSED FIRST. No resolved research means we do not know what the
       founder was granted, and not knowing what someone was told is never
       evidence that they invented it. Emit nothing -- not even a withheld
       row, because there is no decision to record.

       THE OPENING IS EXEMPT, exactly as the live engine exempts it. Before
       the prospect has said a word nothing is supported by disclosure, so
       every opening looks like an invention; and the founder's phrasing need
       not share stems with the stored research ("Publicly rated 5 from 411
       reviews" vs "a five rating from four hundred and eleven reviews").
       Dropping this guard accuses the best opening in the corpus -- measured,
       and it is the mutation this rule is proved against. */
    /* The empty-OBSERVED case is refused HERE as well as by the caller. The
       caller already nulls research when nothing was observed, but a
       fail-closed property that depends on a caller is not a property -- and
       "no granted facts" would otherwise make every claim novel by
       construction, which is the harshest possible reading of the least
       information. */
    if (research && (research.observed || []).length && heard.pass && founderIndex > 0) {
      const flagged = assertsUnsupportedClaim(
        said, researchContext(research), prospectSaid.slice());
      if (flagged) {
        /* Which INFERRED fact, if any, explains it. Tested one at a time so
           the provenance names the actual source rather than "something in
           the inferred set". */
        const inferred = (research.inferred || []);
        const explainedBy = inferred.find((row) => !assertsUnsupportedClaim(
          said, researchContext(research, [row]), prospectSaid.slice()));
        const obsIds = (research.observed || []).map((r) => r.id).filter(Boolean);
        push(ev({ ...base,
          ruleId: 'unsupported_assumption', eventType: 'unsupported_assumption',
          citations: [cite],
          /* INFERRED never grants, so the accusation is WITHHELD rather than
             absent: the producer saw the claim and declined to stand behind
             calling it invented. Withheld evidence is filtered out of mastery
             and can never become positive grounding either -- this event type
             is negative-only, so a suppressed accusation credits nobody. */
          authority: explainedBy ? AUTHORITY.WITHHELD : AUTHORITY.SUPPORTED,
          authorityBasis: explainedBy
            ? `claim_explained_by_inferred_research:${explainedBy.id || 'unidentified'}`
            : `claim_unmatched_against_${obsIds.length}_observed:${obsIds.slice(0, 4).join(',') || 'none'}`,
        }));
      }
    }

    /* ── 3b. AN OBJECTION LEFT STANDING ────────────────────────────
       Read from the state BEFORE this turn, so a fault can never attach to
       a turn that preceded the objection. Exploring, clarifying and leaving
       well are all correct handling and none of them reaches here. */
    const openObjection = state && state.activeObjection ? state.activeObjection : null;
    if (openObjection && heard.pass) {
      const mishandled = objectionMishandled(said, {
        objection: openObjection.said || null,
        isPitch: OFFER_CONTENT.test(said) && polarityIsAffirmed(said, OFFER_CONTENT).pass,
        isClose: closeAsk.pass,
      });
      if (mishandled.pass) {
        const objCite = openObjection.said
          ? { sequence: openObjection.atSeq, attemptNo: 1, speaker: 'prospect',
            quote: String(openObjection.said).slice(0, 300) } : null;
        push(ev({ ...base, ruleId: 'objection_not_handled', eventType: 'objection_not_handled',
          citations: objCite ? [objCite, cite] : [cite],
          authority: AUTHORITY.SUPPORTED, authorityBasis: mishandled.reason }));
      }
    }

    /* ── 3c. A QUESTION THAT ADVANCES NOTHING ──────────────────────
       Weak is not the same as broad: what makes a question weak is that it
       engages with nothing established and asks for nothing in particular.
       The vocabulary is everything said BEFORE this turn, so a founder can
       never be marked down for not referencing what came later. */
    if (heard.pass && !closeAsk.pass) {
      const vocabulary = new Set();
      rows.slice(0, i).forEach((prior) => normalise(prior.text).split(' ')
        .filter((w) => w.length > 4).forEach((w) => vocabulary.add(w)));
      /* Asked and declined is not the founder's fault: after a refusal a
         broad question is the reasonable move. */
      const declined = ((answerKey && answerKey.entries) || [])
        .some((x) => x && x.state === 'refused' && typeof x.atSeq === 'number' && x.atSeq < turn.sequence);
      const weak = isWeakDiscovery(said, { vocabulary, refused: declined });
      /* ── AN OPENING IS NOT A DISCOVERY ATTEMPT ───────────────────────
         "Hi, is now an okay time?" is the founder asking permission to
         speak, and it was being convicted as weak discovery -- so a call
         the prospect ended at their first reply came back reading "You
         lost most ground on your discovery. No questions were asked."
         An accusation for a chance that never arrived is the defect this
         whole repair exists to remove, and it was hiding on the shortest
         call there is. The FIRST founder turn is exempt; every one after
         it is judged exactly as before. */
      const isOpeningTurn = !rows.slice(0, i).some((x) => x.speaker === 'founder');
      if (weak.pass && !isOpeningTurn) {
        push(ev({ ...base, ruleId: 'weak_discovery', eventType: 'weak_discovery',
          citations: [cite], authority: AUTHORITY.SUPPORTED, authorityBasis: weak.reason }));
      }
    }

    /* ── 4. ASKING SOMETHING ALREADY DEALT WITH ────────────────────── */
    if (isQuestion(said)) {
      const prior = settled.find((q) => q.answeredAtSeq != null
        && contentOverlap(q.question, said) >= REPEAT_THRESHOLD);
      if (prior) {
        const priorCite = { sequence: prior.seq, attemptNo: prior.attemptNo, speaker: 'founder',
          quote: String(prior.question).slice(0, 300) };
        const answerCite = prior.answerTurn
          ? citation(prior.answerTurn, normalise(prior.answerTurn.text)) : null;
        /* Re-asking something the prospect REFUSED is a different thing from
           re-asking something they answered. Only the second is a listening
           failure; the first is recorded and handed on. */
        /* P1: the same question was being called a listening failure even
           though three other layers had already recorded the answer as a
           refusal. The answer key is the authority on that, not a private
           phrase list that drifts from it. */
        const keyEntry = ((answerKey && answerKey.entries) || []).find((x) =>
          x.answeredAtSeq === prior.answeredAtSeq && x.answer);
        const wasRefused = !!(keyEntry
          && (keyEntry.state === ANSWER_STATE.REFUSED
            || keyEntry.state === ANSWER_STATE.UNKNOWN_TO_PROSPECT));
        push(ev({ ...base,
          ruleId: wasRefused ? 'refused_and_asked_again' : 'question_repeated',
          eventType: 'question_repeated',
          citations: [priorCite, cite].concat(answerCite ? [answerCite] : []),
          authority: wasRefused ? AUTHORITY.WITHHELD : AUTHORITY.SUPPORTED,
          authorityBasis: wasRefused
            ? 'reasked_after_refusal_not_a_listening_failure'
            : `content_overlap_${Math.round(contentOverlap(prior.question, said) * 100)}pct_with_answered_question` }));
      }
      settled.push({ question: said, seq, attemptNo: turn.attemptNo || 1,
        answeredAtSeq: null, answer: null, answerTurn: null });
    }

    /* ── 4b. DECLINING TO PITCH IS A DECISION, NOT AN ABSENCE ────────
       "I'm not going to pitch you, it's not your call" is the correct move
       against a gatekeeper, and it had no word in the vocabulary -- so it
       was recorded exactly like never noticing the moment. Emitted here and
       INVALIDATED below if the founder goes on to pitch anyway, because a
       promise not to sell followed by selling is not restraint.

       Founder speech is the founder's own, so this is influenceable by
       construction. It is bounded two ways: the invalidation pass, and the
       fact that `declined` earns nothing -- it removes a false negative and
       never creates a positive. Saying the sentence buys silence, not credit. */
    if (PITCH_DECLINED.test(said) && polarityIsAffirmed(said, PITCH_DECLINED).pass
      && attribution(said, PITCH_DECLINED).pass && heard.pass) {
      push(ev({ ...base, ruleId: 'pitch_declined', eventType: 'pitch_declined',
        citations: [cite], authority: AUTHORITY.SUPPORTED,
        authorityBasis: 'founder_declined_to_offer_in_their_own_words' }));
    }

    /* ══ THE POSITIVE HALF ═══════════════════════════════════════════
       Every event above this line describes a mistake. That asymmetry was
       measured on four organic calls: the best-sold call produced NINE
       events and scored LOWEST of the four, because more engagement meant
       more detectable faults and there was almost nothing a founder could
       do that left a trace. These four leave one.

       All are founder-side achievements, so they are `rule_engine` events,
       and all pass through applyEligibility -- a turn VISION did not finish
       hearing cannot earn credit any more than it can earn blame. */

    /* 6a. BUILT ON WHAT THEY JUST SAID. The exported predicate the live
       engine already uses, which reads ONLY the previous prospect line --
       verified transcript-derived in the Phase 3 fairness sweep, and the
       reason `listening_and_building` can finally have a positive of its
       own instead of a rubric axis reading a client-written column. */
    /* THREE PRECONDITIONS, because the shared predicate is deliberately loose
       for the live rail where a false positive costs nothing. As CREDIT it
       has to be tighter, and the first probe showed why: it fired on every
       founder turn of all four organic calls, including the opening and
       including the messy seller who steamrolled three brush-offs.

         not the opening      you cannot build on a greeting, the same rule
                              that stopped a greeting counting as an answer
         they said something  the previous prospect turn is not the greeting
         it was not a brush-off  building on "we're covered" by arguing with
                              it is not listening; an objection is handled by
                              6b or mishandled by the fault above, not both */
    const prevWasGreeting = lastProspectTurn
      && !rows.slice(0, rows.indexOf(lastProspectTurn)).some((x) => x.speaker === 'founder');
    const prevWasPushback = lastProspectLine && OBJECTION_LIKE.test(lastProspectLine);
    if (lastProspectLine && founderIndex > 0 && !prevWasGreeting && !prevWasPushback
      && buildsOnTheirAnswer(said, { lastProspectLine })) {
      const theirCite = lastProspectTurn ? citation(lastProspectTurn, normalise(lastProspectTurn.text)) : null;
      push(applyEligibility(ev({ ...base,
        ruleId: 'built_on_their_answer', eventType: 'built_on_their_answer',
        citations: theirCite ? [theirCite, cite] : [cite],
        authority: AUTHORITY.SUPPORTED,
        authorityBasis: 'reused_their_own_words_or_referred_back' }), heard));
    }

    /* 6b. ENGAGED AN OPEN OBJECTION. The inverse was already computed and
       thrown away: objectionMishandled returns `explored_the_objection` or
       `left_the_call_professionally` as FAIL reasons. Handling an objection
       well was therefore invisible while mishandling it was not. */
    if (state && state.activeObjection) {
      const open = state.activeObjection;
      const verdict = objectionMishandled(said, { objection: open.said || null,
        isPitch: OFFER_CONTENT.test(said) && polarityIsAffirmed(said, OFFER_CONTENT).pass,
        isClose: isCloseAttempt(said, { speaker: 'founder' }).pass });
      if (!verdict.pass && /explored_the_objection|left_the_call_professionally/.test(verdict.reason)) {
        const objCite = open.said
          ? { sequence: open.atSeq, attemptNo: 1, speaker: 'prospect',
            quote: String(open.said).slice(0, 300) } : null;
        push(applyEligibility(ev({ ...base,
          ruleId: 'objection_addressed', eventType: 'objection_addressed',
          citations: objCite ? [objCite, cite] : [cite],
          authority: AUTHORITY.SUPPORTED, authorityBasis: verdict.reason }), heard));
      }
    }

    /* 6c. A CLAIM THE RESEARCH ACTUALLY SUPPORTS. Fires only when the
       granted research is what makes it supported: the same claim against
       NO research would be flagged, and against the OBSERVED facts is not.
       So this is precisely "they used what VISION showed them", and it can
       never fire on a founder who asserted nothing -- which is the whole
       reason `grounding` could only ever be `not_tested`.

       Same fail-closed rule as the accusation: no resolved research, no
       event. Not knowing what they were granted cannot manufacture credit
       any more than it can manufacture blame. */
    if (research && (research.observed || []).length && heard.pass && founderIndex > 0) {
      const withoutResearch = assertsUnsupportedClaim(
        said, { prospect: { name: research.prospectName || '' }, evidence: { observed: [] } },
        prospectSaid.slice());
      const withResearch = assertsUnsupportedClaim(
        said, researchContext(research), prospectSaid.slice());
      if (withoutResearch && !withResearch) {
        push(applyEligibility(ev({ ...base,
          ruleId: 'grounded_claim', eventType: 'grounded_claim', citations: [cite],
          authority: AUTHORITY.SUPPORTED,
          authorityBasis: `claim_supported_by_${(research.observed || []).length}_observed_facts` }), heard));
      }
    }

    /* 6d. GOT A ROUTE. The founder asked who or where, and the prospect
       named one. Cited on both turns, and the naming half is the SERVER'S
       text since ec3ab3b7, so this cannot be self-awarded. */
    if (ROUTING_ASK.test(said)) {
      const next = rows.slice(i + 1).find((x) => x.speaker === 'prospect');
      if (next && ROUTE_NAMED.test(normalise(next.text))) {
        const nextCite = citation(next, normalise(next.text));
        push(applyEligibility(ev({ ...base,
          ruleId: 'routing_obtained', eventType: 'routing_obtained',
          citations: nextCite ? [cite, nextCite] : [cite],
          authority: AUTHORITY.SUPPORTED,
          authorityBasis: 'asked_who_owns_it_and_was_told' }), heard));
      }
    }

    /* ── 5. REPAIR, ONLY WHERE THE STRUCTURE PROVES IT ────────────────
       T1: the coached retry. Both halves are persisted, the retracted
       attempt is marked superseded, and the accepted one shares its
       sequence. attempt_no is NOT dense -- call A jumps 1 to 3 -- so this
       pairs by sequence and by "later attempt", never by attempt === 2. */
    if ((turn.attemptNo || 1) > 1) {
      const first = rows.find((r) => r.speaker === 'founder' && r.sequence === seq
        && (r.attemptNo || 1) < (turn.attemptNo || 1) && r.branch === 'superseded');
      if (first) {
        const focus = (first.detectedEvents || []).map(String)
          .find((e) => /^coached:/.test(e)) || '';
        const firstCite = citation(first, normalise(first.text));
        if (firstCite) {
          push(applyEligibility(ev({ ...base, ruleId: 'repair_of_coached_turn',
            eventType: 'repair_of', citations: [firstCite, cite],
            authority: AUTHORITY.SUPPORTED,
            authorityBasis: `retry_accepted_after_${focus.replace('coached:', '') || 'coaching'}` }), heard));
        }
      }
    } else {
      /* T2+T3: repair of a turn the microphone cut, at distance ONE only.
         Beyond one founder turn there is no stored field that separates
         "the turn that repaired the cut" from "a fresh mistake after it" --
         and the corpus contains exactly that case. It is handed on. */
      const prev = rows.slice(0, i).reverse().find((r) => r.speaker === 'founder');
      if (prev && prev.complete === false) {
        const between = rows.slice(rows.indexOf(prev) + 1, i)
          .filter((r) => r.speaker === 'founder').length;
        const prevCite = citation(prev, normalise(prev.text));
        /* THE COUNCIL FOUND THE COUNTEREXAMPLE IN THE CORPUS. After a cut the
           prospect asked for clarification, and the founder's very next turn
           was not a repair -- it was the worst turn in the call. The repair
           came two turns later. Nothing stored separates those two cases, so
           nothing here claims to. Only the coached retry above, where both
           halves are persisted and paired by sequence, is proven. */
        if (prevCite) {
          push(ev({ ...base, ruleId: 'repair_after_cut',
            eventType: 'repair_candidate_unresolved', citations: [prevCite, cite],
            authority: AUTHORITY.WITHHELD,
            authorityBasis: `repair_after_cut_distance_${between + 1}_not_structurally_decidable` }));
        }
      }
    }
  });

  /* ── A RETRY IS ONLY A REPAIR IF IT REPAIRED SOMETHING ─────────────
     The frozen coaching gate accepts a retry when the turn's ACTION LABEL
     changes, not when the damage is undone. On the real corpus that let a
     coached premature pitch be "repaired" by an unearned close -- and the
     review then named that very sentence the biggest leak of the call, so
     one screen said corrected and damaging about the same words.

     This is producer-internal consistency, not the Reconciler: a rule may
     not assert a repair that this same engine's own evidence contradicts.
     Where it does, the fact is kept and the CLAIM is withdrawn, with the
     contradiction named, for the judge to settle. */
  const damaging = new Map();
  /* ── INVALIDATION: A PROMISE NOT TO SELL, FOLLOWED BY SELLING ──────
     `declined` is the one state a founder can influence with a sentence, so
     it is the one state that has to be checked against what they did next.
     A pitch at any later sequence retracts it -- the event stays, WITHHELD,
     so the attempt to claim restraint is visible rather than erased. */
  {
    const pitchedAt = out.filter((e) => e && (e.eventType === 'pitched_without_permission'
      || e.eventType === 'close_attempted') && e.authority === AUTHORITY.SUPPORTED)
      .map((e) => Number(e.subjectSequence));
    out.forEach((e, i) => {
      if (!e || e.eventType !== 'pitch_declined') return;
      if (pitchedAt.some((s) => s > Number(e.subjectSequence))) {
        out[i] = { ...e, authority: AUTHORITY.WITHHELD,
          authorityBasis: 'declined_then_offered_anyway' };
      }
    });
  }

  out.forEach((e) => {
    if (e.authority !== AUTHORITY.SUPPORTED) return;
    if (!NEGATIVE_TYPES.includes(e.eventType)) return;
    const k = `${e.subjectSequence}:${e.subjectAttemptNo}`;
    damaging.set(k, (damaging.get(k) || []).concat(e.eventType));
  });
  return out.map((e) => {
    if (e.eventType !== 'repair_of' && e.eventType !== 'repair_after_cut') return e;
    if (e.authority !== AUTHORITY.SUPPORTED) return e;
    const hit = damaging.get(`${e.subjectSequence}:${e.subjectAttemptNo}`);
    if (!hit || !hit.length) return e;
    return Object.freeze({ ...e, authority: AUTHORITY.WITHHELD,
      authorityBasis: `retry_accepted_but_introduced_${hit.sort().join('_and_')}` });
  });
}
