/* ════════════════════════════════════════════════════════════════════════
   WHAT THE PROSPECT OBSERVABLY DID.

   Enumerated signals only. This is not a personality detector and it never
   becomes one: no trust, no rapport, no enthusiasm, no confidence, no
   buying intent inferred from politeness, no emotional state.

   CORROBORATING, NEVER ORIGINATING. Every signal here is an observation
   about a prospect line that exists in the record. The reader cannot invent
   a finding about the founder's performance -- the contract refuses to
   construct one -- it can only stand beside a rule event and say "and the
   prospect reacted like this."

   The four things this file keeps apart, because the customer test showed
   the product conflating them:

     an ANSWER            "Mostly through our website and referrals."
     a REFUSAL TO ANSWER  "I don't have that breakdown."
     a CORRECTION         "I didn't say there was a gap to investigate."
     a REFUSAL TO PROCEED "Please don't call again."

   Only the last is a refusal in the sense that matters to a call, and only
   the third tells you the founder got something wrong.
   ══════════════════════════════════════════════════════════════════════ */

import {
  normalise, attribution, polarityIsAffirmed, hedgeFloor, sarcasmAbstain,
  isMatrixImperativeTo, contentWords, contentOverlap, isExplicitDenial,
  negatedBeforeMatch, stripDiscourseHead, admitAuthorityDisclaim,
} from './evidence-gates.js';
import {
  makeEvent, citation, PRODUCER, AUTHORITY, REACTION_TYPES,
} from './candidate-events.js';

/* v2 (P5R-1): explicit_refusal_to_answer widened to the language the corpus
   actually uses (0 of 6 real refusals were detected before), and
   authority_disclaimed added as a first-class cited event. Both change what
   this producer emits for an unchanged call, so the version moves and the
   ids move with it -- v1 events are superseded, never rewritten. */
/* v3 (P5R-2): an answer now requires a prior founder turn, so the prospect's
   greeting is no longer recorded as an answer to a question nobody asked. */
export const READER_VERSION = 'practice_reaction_reader_v4';
const RV = 'v2';

/* ── the enumerated triggers ──────────────────────────────────────────── */
const DNC = /\b(don't|do not|never) (call|contact|ring|phone) (me|us)?\s*again\b|\bremove (me|us) from your (call )?list\b|\btake (me|us) off (your|the|my|this) (call )?list\b|\bstop calling\b/i;
const REFUSE_PROCEED = /\b(not interested|no,? thank you|i'll leave it there|please stop|we're not interested)\b/i;
/* ── P5R-1: THESE MATCHED NOTHING PEOPLE ACTUALLY SAY ──────────────────
   Measured against the four human black-box calls: SIX unmistakable refusals
   were spoken and ZERO were detected, because the old patterns required the
   literal token `discuss`, or the contraction `i'd rather not` with an
   apostrophe, or "i can't SAY" specifically.

     "Well, we don't get into that."                        (A)
     "Um, we don't really get into that."                   (C)
     "Hm, that's not really something we'd get into."       (C)
     "Sorry, I can't give that out."                        (C)
     "Um, whoever's nearest. Not getting into numbers."     (E)
     "I would rather not get into that, honestly."          (E)

   That blindness is load-bearing, not cosmetic: `explicit_refusal_to_answer`
   is the ONLY event in the whole vocabulary that can say the prospect
   PREVENTED something. Without it a stonewalled founder is indistinguishable
   from a lazy one, which is a large part of why the corpus scores better
   sellers lower. Widened to the shapes people use -- "get into", "give out",
   "go into", "share", the uncontracted "I would rather not", and hedges
   ("not really", "we'd") -- while keeping the same discipline: these still
   run behind attribution and polarity gates below. */
const CANNOT_ANSWER = /\b(i (don't|do not) know|i couldn'?t say|i can'?t say|i (don't|do not) have (that|those|a breakdown|the figures)|not in front of me|we (don't|do not) track|no breakdown)\b/i;
const WILL_NOT_ANSWER = new RegExp([
  /* the original shapes, unchanged */
  "\\bwe (?:do ?n'?t|don't) (?:normally )?discuss\\b",
  "\\bnot something we discuss\\b",
  "\\bon an unsolicited call\\b",
  /* "I'd rather not" AND "I would rather not". An ALLOWLIST of complements
     was tried first and was wrong: it fixed the "rather not keep you waiting"
     over-fire but silently dropped "I'd rather not GUESS on that" from the
     judgement corpus -- a real refusal, caught by that suite, not by mine.
     Overfitting to one fixture set is the failure mode here, so this excludes
     the courtesy shapes instead of enumerating the refusal ones. */
  "\\bi(?:'d| would) rather not\\b(?!\\s+(?:keep|waste|take up|hold|trouble|bother|disturb|have to|impose)\\b)",
  /* THE FAMILY THE CORPUS ACTUALLY USES. "get into" / "go into" / "give out"
     / "share", with the hedges people put in front of them ("really",
     "we'd", "that's not something..."). THE NEGATION IS MANDATORY: made
     optional it matched "We get into that quite a lot actually", turning an
     affirmative into a refusal -- the exact inversion this WP exists to
     stop. Bounded to first-person subjects so it cannot match the founder
     being quoted back. */
  "\\b(?:we|i)(?:'d| would)?\\s*(?:do ?n'?t|do not|can'?t|cannot|won'?t|will not)\\s*(?:really |normally |usually )?(?:get|go) into (?:that|this|it|those|numbers|specifics|details)\\b",
  "\\bnot (?:really )?something (?:we|i)(?:'d| would)? ?(?:get|go) into\\b",
  "\\bnot (?:getting|going) into (?:that|this|it|those|numbers|specifics|details)\\b",
  "\\b(?:i|we) can'?t (?:give|hand) (?:that|this|it|those) out\\b",
  "\\b(?:i|we) (?:can'?t|cannot|won'?t|would rather not) (?:share|disclose|give) (?:that|this|it|those)\\b",
  /* ALSO FROM THE JUDGEMENT CORPUS, never covered at v1 either: the
     "I'm not going to ..." future refusal, and "couldn't tell you" /
     "we don't record", which are refusals of the same kind as the
     already-listed "we don't track". */
  "\\b(?:i|we)(?:'m| am|'re| are)? ?not (?:going to|gonna) (?:get|go) into\\b",
  "\\bi (?:genuinely |honestly |really )?couldn'?t tell you\\b",
  "\\bwe (?:do ?n'?t|do not) record (?:that|this|it|those)\\b",
].join('|'), 'i');
/* ── AN ELLIPTICAL AUTHORITY DISCLAIM ──────────────────────────────────
   "Um, not me." is an unmistakable authority disclaim and the shared
   AUTHORITY_DISCLAIM pattern misses it entirely, because on its own it is
   not one -- "Was it you who called?" "Not me." is about a phone call.

   What makes it a disclaim is WHAT IT ANSWERS. So the ellipsis is admitted
   only when the founder's immediately preceding turn asked an authority
   question, which is a pure transcript fact needing no hidden state. That is
   also the exact distinction the owner asked for: the prospect is disclaiming
   AUTHORITY, not KNOWLEDGE -- Call D's "not me" is followed by three turns of
   detailed operational answers, and this must not be read as ignorance.

   Deliberately kept LOCAL rather than widened into AUTHORITY_DISCLAIM: that
   pattern is shared by unspentDisclaimer, the non-buyer pitch gate and the
   semantic-item admission, and "not me" is generic enough that widening it
   there would over-fire across all three. */
const AUTHORITY_QUESTION = /\b(?:are|is) (?:you|that) the (?:right|best) person\b|\bwho (?:should i|would i|do i|shall i)\b|\bwho (?:looks after|handles|owns|decides|deals with|is responsible for)\b|\bis that (?:someone else|your call|you)\b|\bor is that someone else\b|\bwho(?:'s| is) the (?:right|best) person\b/i;
/* The leading filler is carried here rather than leaned on stripDiscourseHead,
   which handles a different set of heads and leaves "Um," in place -- measured
   on Call D's actual line, where it silently cost the whole match. */
const FILLER_HEAD = "(?:(?:um|uh|erm?|well|oh|hm+|sorry|ah|right|so)\\b[,\\s]*)*";
const ELLIPTICAL_DISCLAIM = new RegExp(`^${FILLER_HEAD}(?:`
  + "(?:that(?:'s| is)? )?not me\\b"
  + "|(?:that(?:'d| would)? be )?someone else\\b"
  + "|(?:that(?:'s| is)? )?not (?:my|really my) (?:area|call|department|remit)\\b"
  + ')', 'i');

/* ── THE COMMONEST BRUSH-OFFS WERE NOT OBJECTIONS ──────────────────────
   Measured on a real call whose TRAINING FOCUS WAS OBJECTION HANDLING: the
   prospect said "we're covered", "that's not an issue here" and "we're not
   looking at that", and the Post-Call reported "No objection was raised, so
   this was not tested". Three objections, none detected, on the one call the
   product had asked the founder to practise objections.

   The original list was accurate and narrow -- it caught the textbook
   phrasings ("too expensive", "we already have someone") and none of the
   ways people actually deflect on the phone. Widened to the deflection
   family, still requiring the prospect to be pushing back rather than
   merely answering. */
const OBJECTION = new RegExp([
  '\\bwe already have (someone|a|an)\\b',
  '\\balready work(ing)? with\\b',
  "\\bwe're happy with\\b",
  '\\btoo expensive\\b', '\\bno budget\\b', "\\bcan't afford\\b",
  '\\bnot my decision\\b', '\\bsomeone else (decides|handles)\\b',
  /* the deflection family the corpus actually uses */
  /* "we're covered" is a brush-off; "we're covered until Friday" is a rota.
     A time or agent complement means they are answering, not deflecting. */
  "\\bwe(?:'re| are) (?:all )?(?:covered|sorted|fine|good|set)\\b(?!\\s+(?:until|till|for|by|on|from|with|through)\\b)",
  "\\b(?:that(?:'s| is)|it(?:'s| is)) not (?:really )?an issue\\b",
  "\\bwe(?:'re| are) not (?:really )?looking (?:at|for|into)\\b",
  "\\bnot (?:really )?(?:for|something for) us\\b",
  "\\bwe (?:do ?n'?t|don't) need\\b",
  "\\bwe(?:'ve| have) (?:got|already got) (?:that|someone|somebody|an agency)\\b",
  /* ── THE CHALLENGE TO RELEVANCE ────────────────────────────────────
     "Right, but why would that be something we'd look at?" is an objection
     in every sales vocabulary, and NEITHER detector saw it: the reader has
     no lexicon for it, and call-state's own five patterns miss it too. On
     the staging transcript that guards this file the objection was real --
     it was the SCENARIO'S OWN enumerated objection, raised by the behaviour
     engine -- and the founder answered it. The reader reads only transcript,
     so a scenario-raised objection is invisible to it unless the words
     themselves carry the shape. They do here.

     Bounded to a challenge aimed at the OFFER'S WORTH, not to curiosity:
     "why would we/I", "why should we/I", "what's in it for us". "Why does
     it do that" and "why are you calling" are not matched. */
  "\\bwhy (?:would|should) (?:we|i|that|it|they)\\b",
  "\\bwhat(?:'s| is) in it for (?:us|me)\\b",
].join('|'), 'i');
const LACK_PRIORITY = /\b(not (actively )?looking|not a priority|not right now|not at the moment|comfortable with where)\b/i;
const PROVIDER_SATISFIED = /\b(we're happy with|happy as we are|no complaints|works fine|working (well|fine) for us)\b/i;
const CLARIFY = /^(sorry|pardon|come again)\b|\b(what do you mean|say that again|which one|what exactly do you mean)\b/i;
const SOCIAL_ONLY = /^(?:[^a-z]*\b(thank you|thanks|appreciate|kind of you|good of you|nice of you|pleasure|no worries|of course|that'?s (very )?(kind|good))\b[^.]*[.!]?\s*)+$/i;
const CORRECTION = /\b(actually,? i (said|meant)|i said that wrong|i misspoke|what i meant was|to correct that|sorry,? i said)\b/i;
/* P1: "I've got a moment - what's this regarding?" is a request for a reason,
   not permission to sell. Pass 2 already refuses to grant permission on it and
   the two must not disagree, so this list matches Pass 2's narrower one. */
const PERMISSION = /\b(go ahead|fire away|sure,? go on|carry on|what (exactly )?(are you|do you) (offering|proposing)|tell me more)\b/i;
/* Politeness with no proposition in it. Never a signal. */
/* A whole line made of nothing but acknowledgment tokens. "Okay, sure." is
   two of them and a comma, which is why a single-token test missed it. */
const BACKCHANNEL_TOKEN = /^(ok|okay|sure|right|mm|mhm|yeah|yes|fine|alright|thanks|cheers|understood|gotcha)$/i;
const isBackchannel = (t) => {
  const parts = normalise(t).replace(/[.!?,;]/g, ' ').split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.length <= 4 && parts.every((w) => BACKCHANNEL_TOKEN.test(w));
};

const isQuestion = (t) => /\?\s*$/.test(normalise(t));

function reaction({ sessionId, type, turn, rule, basis, authority, corroborates }) {
  const cite = citation(turn, normalise(turn.text));
  if (!cite) return null;
  return makeEvent({
    sessionId, producer: PRODUCER.READER, producerVersion: READER_VERSION,
    ruleId: rule, ruleVersion: RV, eventType: type,
    subject: turn, citations: [cite],
    authority: authority || AUTHORITY.SUPPORTED, authorityBasis: basis,
    corroborates: corroborates || null, sequence: turn.sequence,
  });
}

/* `turns` are Pass-1 ASSEMBLED turns in call order. */
export function readReactions({ sessionId, turns = [] } = {}) {
  const out = [];
  const founderSoFar = [];
  const prospectSoFar = [];

  (turns || []).forEach((turn) => {
    const said = normalise(turn.text);
    if (!said) return;
    if (turn.speaker !== 'prospect') { founderSoFar.push(said); return; }

    const add = (type, rule, basis, authority) => {
      const e = reaction({ sessionId, type, turn, rule, basis, authority });
      if (e) out.push(e);
    };

    /* A BACKCHANNEL IS NOT A SIGNAL. "Okay, sure." carries no proposition,
       and reading agreement into it is how a roleplay flatters a founder. */
    if (isBackchannel(said)) {
      prospectSoFar.push(said);
      add('explicit_answer', 'backchannel_withheld',
        'no_proposition_in_line', AUTHORITY.WITHHELD);
      return;
    }
    /* Deterministic reading is unsafe here; withhold BOTH readings. */
    if (sarcasmAbstain(said).pass === false) {
      prospectSoFar.push(said);
      add('explicit_answer', 'sarcasm_abstain', 'ambiguous_polarity', AUTHORITY.WITHHELD);
      return;
    }

    /* ── refusal to proceed, hardest first ───────────────────────────
       A DNC has to be an imperative in the matrix clause aimed at the
       founder. "We're not asking you to stop calling" is not one. */
    if (DNC.test(said)) {
      const act = isMatrixImperativeTo(said, DNC);
      const own = attribution(said, DNC);
      /* NOT polarity: the "don't" belongs to the phrase. What disqualifies
         it is a negator in FRONT of it -- "I'm not asking you to stop". */
      const pol = negatedBeforeMatch(said, DNC);
      if (act.pass && own.pass && pol.pass) {
        add('explicit_do_not_contact', 'dnc_matrix_imperative', 'imperative_addressed_to_caller');
      } else {
        add('explicit_do_not_contact', 'dnc_matrix_imperative',
          `withheld:${[act, own, pol].find((g) => !g.pass).reason}`, AUTHORITY.WITHHELD);
      }
    } else if (REFUSE_PROCEED.test(said) && attribution(said, REFUSE_PROCEED).pass
      && negatedBeforeMatch(said, REFUSE_PROCEED).pass) {
      add('explicit_refusal_to_proceed', 'refusal_to_proceed', 'explicit_refusal_phrase');
    }

    /* ── answering, or declining to ──────────────────────────────────── */
    if (WILL_NOT_ANSWER.test(said)) {
      add('explicit_refusal_to_answer', 'will_not_answer', 'declined_to_share');
    } else if (CANNOT_ANSWER.test(said)) {
      add('explicit_refusal_to_answer', 'cannot_answer', 'stated_they_do_not_hold_it');
    } else if (founderSoFar.length && contentWords(said).length >= 6 && !isQuestion(said)
      && !SOCIAL_ONLY.test(said)
      && !REFUSE_PROCEED.test(said) && !DNC.test(said)) {
      /* AN ANSWER NEEDS SOMEBODY TO HAVE SPOKEN FIRST. The bar was content
         words, not a question, not courtesy -- and never that anyone had
         asked anything. So the prospect's GREETING cleared it at sequence 0,
         before the founder had said a word. That greeting is `discovery`'s
         only positive event, so it alone produced `discovery: present/strong`
         in Call A, whose rubric says "0 questions sought something specific",
         and in Call C, where it was the ONLY canonical event in thirteen
         turns.

         The bar is a prior FOUNDER TURN rather than a prior question,
         deliberately: "Tell me how new patients find you" is an imperative,
         not a question, and the reply to it is a real answer. Requiring a
         question mark would trade one falsehood for another. */
      /* P1: "Thank you, that's very kind, I appreciate you taking the time"
         cleared the content-word bar and was recorded as a disclosure, which
         flipped the topic to discoverable. Courtesy is not an answer, and a
         refusal is not one either. */
      add('explicit_answer', 'substantive_answer', 'asserted_content');
    }

    /* ── disclaiming AUTHORITY (never knowledge) ─────────────────────── */
    {
      /* The full shared gate first -- "that's not my call", "I'm not the
         one who decides" -- unchanged, and already carrying its own
         question/negation/attribution/hedge checks. */
      const full = admitAuthorityDisclaim(said);
      /* Failing that, the elliptical form, admitted ONLY as the answer to an
         authority question the founder actually asked on the previous turn. */
      const askedAuthority = founderSoFar.length
        && AUTHORITY_QUESTION.test(founderSoFar[founderSoFar.length - 1]);
      const elliptical = !full && askedAuthority
        && ELLIPTICAL_DISCLAIM.test(stripDiscourseHead(said));
      if (full || elliptical) {
        /* `possible` strength is a hedged disclaim ("I don't think that's
           really my call"). Recorded, but not stood behind -- the same
           discipline every other hedged reading here uses. */
        const hedged = full && full.strength !== 'explicit';
        add('explicit_authority_disclaimed',
          full ? 'authority_disclaimed_explicit' : 'authority_disclaimed_elliptical',
          full ? `self_asserted_disclaim_${full.strength}`
            : 'answered_an_authority_question_with_a_disclaimer',
          hedged ? AUTHORITY.WITHHELD : AUTHORITY.SUPPORTED);
      }
    }

    /* ── correcting the founder, or correcting themselves ────────────── */
    if (isExplicitDenial(said) || CORRECTION.test(said)) {
      add('explicit_correction', 'explicit_denial', 'prospect_denied_a_claim');
    }

    /* ── objections and standing ─────────────────────────────────────── */
    if (OBJECTION.test(said) && attribution(said, OBJECTION).pass
      && polarityIsAffirmed(stripDiscourseHead(said), OBJECTION).pass) {
      add('explicit_objection', 'stated_objection', 'objection_phrase_affirmed');
    }
    if (PROVIDER_SATISFIED.test(said) && polarityIsAffirmed(stripDiscourseHead(said), PROVIDER_SATISFIED).pass) {
      add('explicit_current_provider_satisfaction', 'provider_satisfied', 'stated_satisfaction');
    }
    if (LACK_PRIORITY.test(said) && attribution(said, LACK_PRIORITY).pass
      && negatedBeforeMatch(said, LACK_PRIORITY).pass) {
      /* "not actively looking" IS the affirmed form of this signal -- the
         negation is the content, so polarity is not applied here. */
      add('explicit_lack_of_priority', 'no_priority', 'stated_no_current_priority');
    }

    /* ── the prospect steering ───────────────────────────────────────── */
    if (CLARIFY.test(said) && isQuestion(said)) {
      const echo = founderSoFar.length ? contentOverlap(founderSoFar[founderSoFar.length - 1], said) : 0;
      add('explicit_clarification_request', 'clarification_request',
        echo >= 0.5 ? 'echoes_the_unfinished_ask' : 'asked_for_clarification');
    } else if (isQuestion(said)) {
      add('explicit_prospect_question', 'prospect_question', 'prospect_asked_a_question');
    }
    if (PERMISSION.test(said) && hedgeFloor(said).pass
      && negatedBeforeMatch(said, PERMISSION).pass && attribution(said, PERMISSION).pass) {
      add('explicit_permission_to_continue', 'permission_to_continue', 'invited_to_continue');
    }

    prospectSoFar.push(said);
  });
  return out;
}

export { REACTION_TYPES };
