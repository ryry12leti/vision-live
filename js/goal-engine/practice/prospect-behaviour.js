import { isCloseAttempt, isPitchAttempt, attribution, PRESSURE } from './evidence-gates.js';
import { decideReaction, disclosurePhrase, initiativePhrase, DISCLOSURE, INITIATIVE } from './reaction-policy.js';
import { initialSituationState, applySituationTurn, situationOverreachScale, timePressureLine } from './situation-state.js';
import { mapSeverityToDecision } from './hangup-severity.js';
/* The SAME words call-state reads as a refusal. A second opinion about what
   "no" sounds like is how two layers end up disagreeing about the call. */
import { HARD_NO, SOFT_NO, DO_NOT_CONTACT } from './call-state.js';
import { readInteraction } from './interaction-read.js';
/* ════════════════════════════════════════════════════════════════════════
   THE SIMULATED PROSPECT'S BRAIN.

   Difficulty controls RESISTANCE, never the outcome. A founder can lose a
   receptive prospect by pitch-dumping and can earn a follow-up from a
   resistant one by asking a single good question — and a resistant prospect
   who genuinely has no need is allowed to stay uninterested no matter how
   long the founder keeps talking. Rehearsal that rewards persistence teaches
   persistence; this rewards qualification.

   THE MODEL DOES NOT OWN ANY OF THIS. State moves deterministically here, and
   a language model is later handed a posture and a permitted set of facts to
   phrase. It cannot decide that resistance evaporated, that a real unknown
   became true, or that the founder earned the close.

   SIMULATION IS SEALED. A rehearsal may invent plausible private detail —
   otherwise every practice prospect answers "I don't know" — but every
   invented fact is marked simulated and is structurally unable to leave.
   "The fake prospect said it" must never become "VISION knows this".
   ══════════════════════════════════════════════════════════════════════ */

import {
  resolveIntensity, applyIntensityToMode, intensityEffectScale,
  intensityNeedDiscoveryScale, objectionGateOf, endsOnFirstDamagingMove,
} from './practice-intensity.js';

export const BEHAVIOUR_MODES = Object.freeze({
  receptive: Object.freeze({
    id: 'receptive', label: 'Receptive',
    describes: 'Willing to hear why you called, and reasonably open — but still expects relevance.',
    initialResistance: 0.2, openness: 0.75, patience: 0.8, informationWillingness: 0.7,
    exitThreshold: 0.85, maxObjections: 1,
  }),
  skeptical: Object.freeze({
    id: 'skeptical', label: 'Skeptical',
    describes: 'Will give you a moment, but needs a reason. Challenges anything vague.',
    initialResistance: 0.5, openness: 0.45, patience: 0.55, informationWillingness: 0.4,
    exitThreshold: 0.75, maxObjections: 3,
  }),
  resistant: Object.freeze({
    id: 'resistant', label: 'Resistant',
    describes: 'Not looking for this, and trying to get off the phone. Ground has to be earned.',
    initialResistance: 0.8, openness: 0.2, patience: 0.3, informationWillingness: 0.2,
    exitThreshold: 0.6, maxObjections: 4,
  }),
  vision_realistic: Object.freeze({
    id: 'vision_realistic', label: 'VISION Realistic',
    describes: 'How this prospect would most likely behave, from what VISION actually knows about them.',
    /* Filled by deriveRealisticBehaviour — these are only the fallbacks used
       when a prospect has no grounded state at all. */
    initialResistance: 0.5, openness: 0.45, patience: 0.55, informationWillingness: 0.4,
    exitThreshold: 0.75, maxObjections: 3,
  }),
});

export const MODE_IDS = Object.freeze(Object.keys(BEHAVIOUR_MODES));
export const DEFAULT_MODE = 'vision_realistic';

/* P0-1: the highest `needDiscovered` a scenario drawn with
   `variation.painExists === false` may ever hold. Below need_uncovered
   (0.4), pitchPermission (0.5), qualified_opportunity (0.6) and
   closePermission (0.5), so none of them can be reached by a call where the
   engine itself decided there is nothing to find. Exported so the
   regression suite asserts against this value rather than a copy of it. */
export const NO_PAIN_NEED_CEILING = 0.3;

const clamp = (n) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

/* ── VISION REALISTIC ─────────────────────────────────────────────────
   Derived from what is actually known, and from nothing else. The tempting
   move is to make a prospect resistant because that is "harder"; the honest
   one is to make them resistant only where the evidence says they would be.
   An unknown makes them GUARDED, never dissatisfied — VISION must not invent
   that an incumbent is performing badly in order to hand the founder an
   opening that does not exist. */
export function deriveRealisticBehaviour(context = {}) {
  const observed = (context.evidence && context.evidence.observed) || [];
  const unknowns = context.unknowns || [];
  const objections = context.objections || [];
  const whyNow = context.whyNow || {};
  const role = (context.contactRole && context.contactRole.role) || null;

  const hasProvider = objections.some((o) => /already have|someone (is )?handl|our agency|in[- ]house/i.test(o.q || ''));
  const groundedUrgency = !!(whyNow && whyNow.tier && whyNow.tier !== 'none' && whyNow.what);
  const proof = observed.length;

  const reasoning = [];
  let resistance = 0.45;
  let openness = 0.5;
  let need = 0.3;

  if (hasProvider) {
    resistance += 0.2; openness -= 0.1;
    reasoning.push('They appear to already have someone doing this, so the first real resistance is an incumbent, not disinterest.');
  }
  if (groundedUrgency) {
    resistance -= 0.15; openness += 0.15; need += 0.2;
    reasoning.push(`There is observed timing evidence (${whyNow.tier}), so a reason to talk now exists.`);
  } else {
    reasoning.push('No urgency has been observed, so they have no particular reason to engage today.');
  }
  if (proof >= 3) {
    openness += 0.1;
    reasoning.push(`VISION verified ${proof} things about them, so an informed opener is possible.`);
  } else if (proof === 0) {
    resistance += 0.1;
    reasoning.push('Nothing has been verified about them, so anything specific would be a guess.');
  }
  if (unknowns.length >= 2) {
    reasoning.push(`${unknowns.length} things are still unknown, so they will be guarded rather than forthcoming.`);
  }
  if (role && /owner|principal|director/i.test(role)) {
    resistance += 0.05;
    reasoning.push('The contact appears to be the owner, whose time is the hardest to get.');
  }

  /* NEED IS NOT ASSUMED. Without evidence of a gap, the honest starting point
     is that there may be no opportunity here at all — which is what makes a
     professional exit a real possible outcome rather than a consolation. */
  const base = resistance >= 0.65 ? BEHAVIOUR_MODES.resistant
    : (resistance >= 0.42 ? BEHAVIOUR_MODES.skeptical : BEHAVIOUR_MODES.receptive);

  return {
    id: 'vision_realistic', label: 'VISION Realistic',
    resembles: base.id,
    initialResistance: clamp(resistance),
    openness: clamp(openness),
    /* ── DERIVED, NOT INHERITED ────────────────────────────────────
       These two were copied wholesale off whichever archetype the
       resistance score happened to land on, which is why VISION Realistic
       kept collapsing into Skeptical: same patience, same willingness, and
       resistance close enough that the two produced the same reply to the
       same question. Both are now read off the same evidence everything
       else here is read off.

       A business VISION verified several things about is USED TO BEING
       LOOKED UP, and talks more freely about the visible side of itself.
       A business with a lot still unknown is unlisted on purpose, and
       talks less. Patience is time, not mood: an owner has less of it than
       a manager, and someone with an observed reason to talk has more. */
    patience: clamp(base.patience
      + (groundedUrgency ? 0.15 : 0)
      - (role && /owner|principal|director/i.test(role) ? 0.1 : 0)),
    informationWillingness: clamp(base.informationWillingness
      + (proof >= 3 ? 0.15 : 0)
      - (unknowns.length >= 2 ? 0.1 : 0)
      - (hasProvider ? 0.05 : 0)),
    exitThreshold: base.exitThreshold,
    maxObjections: base.maxObjections,
    currentNeedStrength: clamp(need),
    likelyObjections: objections.map((o) => o.q).filter(Boolean).slice(0, 4),
    exitLikelihood: clamp(resistance - (groundedUrgency ? 0.15 : 0)),
    reasoning,
  };
}

export function resolveMode(modeId, context) {
  const base = modeId === 'vision_realistic'
    ? deriveRealisticBehaviour(context)
    : (BEHAVIOUR_MODES[modeId] || BEHAVIOUR_MODES[DEFAULT_MODE]);
  /* THE TWO DIALS, LAYERED ON LAST. Every caller of this function passes a
     context, so this is the one place the founder's Difficulty and Pressure
     have to be read for the whole engine to see them -- takeFounderTurn,
     createProspectState and resolveHangupCandidate all resolve their mode
     here. Absent intensity returns `base` untouched, which is every caller
     that predates the dials. */
  const intensity = resolveIntensity(context) || resolveIntensity(context && context.state);
  return intensity ? applyIntensityToMode(base, intensity) : base;
}

/* ── STATE ────────────────────────────────────────────────────────────── */
export function createProspectState(modeId = DEFAULT_MODE, context = {}) {
  const m = resolveMode(modeId, context);
  return {
    mode: modeId,
    resembles: m.resembles || modeId,
    /* CARRIED, NOT RE-CHOSEN. The whole state is round-tripped through the
       client between turns, so the dials ride with it and every later turn
       resolves the same policy. Re-clamped on every read (resolveIntensity
       rejects anything that is not a known level), so a tampered or stale
       value degrades to medium rather than being believed. */
    intensity: m.intensity || resolveIntensity(context) || null,
    engagement: clamp(m.openness),
    resistance: clamp(m.initialResistance),
    trust: 0.5,
    needDiscovered: clamp(m.currentNeedStrength || 0),
    /* WHAT IS HAPPENING RIGHT NOW, separate from mode's temperament. Resolved
       once here -- explicit if the founder chose one, seeded-adaptive
       otherwise -- and carried on the state exactly like every other field
       below, so it persists turn to turn through the same state-passthrough
       the client already round-trips. `context.situationSeed` is what makes
       repeated calls with this same prospect able to differ; a missing seed
       still resolves (falls back to a fixed default draw), it just cannot
       vary call to call. */
    /* NULL, not a silent adaptive draw, when nobody asked for a situation.
       Every existing caller -- every test in this suite, every non-Sales
       surface -- constructs state with no `context.situation` at all, and
       must see EXACTLY the behaviour it saw before this file existed. The
       rest of this module already treats a null situation as a true no-op
       (situationWillingnessShift, applySituationTurn, situationOverreachScale
       all short-circuit on it), so the only thing that can leak the new
       axis into an old caller is resolving one when nothing was requested.
       Resolution only runs when the caller explicitly asked -- an explicit
       situation id, or 'vision_adaptive'. */
    situation: context.situation
      ? initialSituationState({ situationId: context.situation, context, seed: context.situationSeed || null })
      : null,
    pitchPermission: false,
    activeObjection: null,
    objectionsRaised: 0,
    overreached: 0,
    /* HOW MANY TIMES THIS CALL HAS ALREADY BEEN FORGIVEN. `overreached`
       only counts pressure/unsupported_assumption -- it never moves for a
       founder who says nothing in particular, over and over. A wall of
       "Bananas." never overreaches in that narrow sense, but it is
       exactly the "excessive talking / weak handling" pattern that should
       still wear a prospect out -- and needs its own counter, since it has
       no other one to borrow. Incremented once per hangupCandidate raised,
       whatever action caused it. */
    hangupCandidatesSeen: 0,
    ignoredAnswer: 0,
    /* The last read of what passed between them, so Guided describes the
       same interaction the state was just priced on. */
    lastInteraction: null,
    /* Set by applyFounderAction against mode.exitThreshold -- the same
       number that ends the call. Never a second threshold. */
    callAtRisk: false,
    repeated: 0,
    nextStepWillingness: 0,
    exitIntent: clamp(m.initialResistance * 0.5),
    turns: 0,
    said: [],
    /* What the prospect last said. Without it a founder who picks up on the
       reply is indistinguishable from one asking a fresh generic question —
       so the highest-value move in sales was unscoreable. */
    lastProspectLine: '',
    /* EVERY line the prospect has given, not only the last. A claim is
       supported if they said it three turns ago just as much as one. */
    prospectSaid: [],
    ended: false,
    endedReason: null,
  };
}

/* ── FOUNDER ACTION CLASSIFICATION ────────────────────────────────────
   Behaviour, never personality. Every label below is something the founder
   DID on this turn. */
export const FOUNDER_ACTIONS = Object.freeze([
  'relevant_opening', 'irrelevant_opening', 'grounded_observation', 'unsupported_assumption',
  'discovery_question', 'high_value_follow_up', 'generic_question', 'pitch', 'premature_pitch',
  'objection_response', 'objection_exploration', 'close_request', 'pressure', 'repetition',
  'professional_exit', 'hostile',
]);
/* NOT IN THAT LIST, DELIBERATELY: `non_buyer_pitch`. This engine never emits
   it -- it is an upgrade projectScoringTurns applies to a `pitch` once the
   Reconciler has stood behind `pitched_a_non_buyer`, and it exists only
   downstream of reconciliation. Adding it here would claim the behaviour
   engine can classify a fault it has no evidence for. */

/* ── CONTEMPT AIMED AT THE PERSON ──────────────────────────────────────
   Narrow on purpose. A founder rehearsing a cold call swears at himself,
   calls his own notes useless and apologises for wasting your time -- none
   of that is aimed at the prospect, and hanging up on it would teach him to
   speak carefully to a machine instead of naturally to a person.

   So each pattern needs a second-person target, and REPORTED hostility ("a
   prospect told me to shut up last week") is excluded by the attribution
   check that already exists for exactly this. */
/* SAME NOUN LIST, TWO WORD ORDERS. English inverts subject and auxiliary
   for a yes/no question -- "you're an idiot" becomes "are you an idiot" --
   so a pattern anchored only to declarative order missed every hostile
   line phrased as a question, and worse: it fell through to
   `discovery_question`, which the reaction policy REWARDS. Found auditing
   the whole system a second time; confirmed 4/4 on real fronted insults.
   The noun list itself is unchanged -- this widens WHERE it may appear,
   not WHAT counts as an insult, so it cannot convict a new word it did not
   already convict in the declarative form. */
/* ── AN ALLOWLIST OF INSULTS FAILS OPEN, AND IT DID ───────────────────
   A founder said "you're probably wasting my fucking time. Fuck you." and
   NONE of it matched: `fuck off` was listed and `fuck you` was not, and the
   noun form required the exact phrase "waste of time" rather than "wasting
   my ... time". So the turn was not hostile, the call did not end, the 30
   ceiling never applied and the review named an earlier unsupported
   assumption as the biggest leak. The call scored 59.

   Everything downstream of this match was already correct. Rebuilt as four
   named SHAPES rather than a phrase list, so the next unlisted insult is
   covered by its form:

     1. profanity aimed at the second person   fuck you / screw yourself
     2. dismissal of the person                shut up / get lost
     3. contempt about the person              you're an idiot / you clown
     4. contempt about their time              wasting my fucking time

   Two deliberate narrowings, because widening a terminal classifier is how
   false convictions get built:

   - The words that may sit between "you" and the insult come from a CLOSED
     adjective list. `you \w+ clown` would convict "did you find the clown".
   - Shape 4 requires MY time. "I'm probably wasting your time" is
     self-deprecation, and it is the phrasing a nervous founder actually
     uses, so it must never reach the terminal branch. */
/* Nouns that insult in ANY of the frames below. "your idiot" is not a
   sentence anybody writes, so the possessive costs nothing here. */
const HOSTILE_NOUNS_CORE = '(?:idiot|moron|useless|clueless|pathetic|prick|clown'
  + '|dickhead|asshole|arsehole|bastard|wanker|muppet|twat|scumbag'
  + '|waste of (?:my )?time|waste of space)';
/* ── ORDINARY NOUNS THAT ONLY INSULT AFTER A COPULA ───────────────────
   `loser` and `joke` are new at this commit, and unlike every noun above
   them their POSSESSIVE is ordinary English: "your joke landed well with
   the team", "I liked your joke earlier", "your loser bracket analogy".
   All three are terminal at this commit and clean at its parent, so the
   widening introduced them -- and terminal means the call ends and the
   score caps at 30 for a founder who paid a compliment.

   "you're a joke" is still an insult, so they stay in the copula and
   `are you a ...` frames and are excluded only from the possessive. This
   is the same distinction HOSTILE_VOCATIVE_NOUNS already draws one frame
   further down, for the same reason ("you joke about it a lot"). */
const HOSTILE_NOUNS_PREDICATE_ONLY = '(?:loser|joke)';
const HOSTILE_NOUNS = `(?:${HOSTILE_NOUNS_CORE}|${HOSTILE_NOUNS_PREDICATE_ONLY})`;
/* Bare "you X" with no copula. Deliberately a SUBSET: `joke`, `useless` and
   `waste of...` are left out because "you joke about it" and "you useless
   feature" are ordinary sentences, and this branch has no verb to lean on. */
const HOSTILE_VOCATIVE_NOUNS = '(?:idiot|moron|prick|clown|dickhead|asshole'
  + '|arsehole|bastard|wanker|muppet|twat|scumbag|loser)';
const HOSTILE_ADJ = '(?:absolute|total|complete|utter|fucking|fuckin|stupid'
  + '|bloody|damn|goddamn|useless|pathetic|dumb|thick|lazy|arrogant|little)';
/* ── SHAPE 4 MUST NAME ITS SUBJECT, LIKE THE OTHER THREE DO ───────────
   Shapes 1-3 all bind to the second person -- `fuck YOU`, `YOU'RE an
   idiot`, `are YOU a moron`. Shape 4 as first written matched only the
   OBJECT phrase, `wasting my time`, and never asked who was doing the
   wasting -- so it convicted every subject equally:

     "I am, and I want to be honest with you, wasting my time here."   FP
     "I'm the one who has been ... wasting my time."                   FP
     "Their last vendor told them they were wasting my time."          FP
     "They were wasting my time, not the other way round."             FP

   All four are hostile at this commit and clean at its parent, so shape 4
   introduced them. SELF_DIRECTED does not save them: it only looks 24
   characters back, and shape 4 matches far deeper into a sentence than the
   phrase list it replaced ever did. Widening that window is the wrong fix
   -- it would start excusing "I am calling because you're an idiot".

   So the subject is required, through a CLOSED list of the copulas and
   adverbs that may sit between `you` and the verb -- the same closed-list
   discipline HOSTILE_ADJ already uses, and for the same reason: an open
   gap would let `you` leap across arbitrary prose and convict the very
   sentences above. `stop wasting my time` is kept as the one subjectless
   form, because an imperative's subject IS the person addressed -- but not
   when it is itself the object of another verb ("I need TO STOP wasting
   my time"), which the lookbehind excludes. */
const HOSTILE_LINK = '(?:are|were|is|was|have|has|had|been|being|keep|keeps'
  + '|kept|do|did|just|only|now|still|probably|really|literally|honestly'
  + '|clearly|basically|obviously|frankly|simply|totally|completely'
  + '|absolutely|definitely|certainly|seriously|apparently|constantly)';
const HOSTILE_TIME = `wast(?:e|ed|ing)(?:\\s+of)?\\s+(?:${HOSTILE_ADJ}\\s+)*my\\s+(?:${HOSTILE_ADJ}\\s+)*time\\b`;
const HOSTILE_RE = new RegExp(
  `\\b((?:fuck|screw|stuff)\\s+(?:you|yourself)\\b`
  + `|(?:fuck|piss|sod|bugger)\\s+off\\b`
  + `|(?<!\\b(?:i|we|they|he|she|it|people|everyone|someone|somebody|nobody|customers?|clients?|callers?|staff|they'd|we'd)\\b[^.?!]{0,14})(?:shut (?:up|it)\\b|stop talking\\b|be quiet\\b|get lost\\b)`
  + `|you(?:'?re| are) (?:an? )?(?:${HOSTILE_ADJ} )*${HOSTILE_NOUNS}\\b`
  + `|your (?:an? )?(?:${HOSTILE_ADJ} )*${HOSTILE_NOUNS_CORE}\\b`
  + `|are you (?:being )?(?:an? )?(?:${HOSTILE_ADJ} )*${HOSTILE_NOUNS}\\b`
  + `|you\\s+(?:an?\\s+)?(?:${HOSTILE_ADJ}\\s+)*${HOSTILE_VOCATIVE_NOUNS}\\b`
  + `|you(?:'?(?:re|ve|ll))?(?:\\s+${HOSTILE_LINK})*\\s+${HOSTILE_TIME}`
  + `|(?<!\\bto\\s)stop\\s+${HOSTILE_TIME})`, 'i');
/* ── ONE SPOKEN SENTENCE, MANY TRANSCRIBED FORMS ──────────────────────
   Practice is a SPOKEN product: this text arrives from a transcriber, and
   "you're an idiot" reaches us as `youre`, `you’re` (U+2019), `you  are`
   with a doubled space, or `fuck-you` hyphenated. Every one of those was
   clean while the identical utterance was terminal.

   This is NORMALISATION, not fuzzy matching: it folds forms that are the
   same characters typed differently -- curly apostrophes to ASCII, hyphens
   between words to spaces, runs of whitespace to one. It never edits
   letters, so it cannot invent a match that the words do not contain.
   The apostrophe-less `youre` is handled in the pattern instead, because
   deleting apostrophes wholesale would turn "can't" into "cant". */
export function normaliseHostilityText(text) {
  return String(text == null ? '' : text)
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Said ABOUT themselves, not to the prospect. */
const SELF_DIRECTED = /\b(i (?:am|'m)|my|we (?:are|'re)|our|me)\b[^.?!]{0,24}$/i;

/* ── THE ONE HOSTILITY DECISION, AND IT TAKES NO STATE ────────────────
   Pure and exported so the SCORE can re-derive this from the transcript
   instead of trusting a client-written `detected_events` array. Returns
   the matched phrase, or null.

   THE GUARD BELOW WAS DEAD. `attribution()` returns `{pass, reason}` and
   this read `.reported`, which is always `undefined` -- so `!undefined`
   was permanently true and quoted speech was never excluded here at all.
   Only SELF_DIRECTED's 24-character window was holding it, which is why
   "They told me to fuck off" was safe and `She said "fuck you" to the
   receptionist` was not. Reading `.pass` is the whole fix. */
export function severeHostility(text) {
  const t = normaliseHostilityText(text);
  const m = HOSTILE_RE.exec(t);
  if (!m) return null;
  if (!attribution(t, m[0]).pass) return null;
  if (SELF_DIRECTED.test(t.slice(0, m.index))) return null;
  return m[0].toLowerCase();
}

const RE = {
  question: /\?\s*$/,
  /* MOVED TO evidence-gates.js's `isPitchAttempt`, which this file now
     calls instead of matching its own copy. Three real staging failures
     were fixed here one at a time -- a rebuttal ("most firms we work with
     had something in place already") convicted as a pitch, a loss-framing
     question ("does that ever cost you a registration?") convicted as
     pricing, and a plain third-person pitch ("we RUN front-desk overflow
     for clinics") that matched nothing at all -- and a fourth was found the
     same way afterwards: "I'm trying to get you guys an AI receptionist",
     a real staging call, matched nothing either, because the first-person
     branch only ever covered "I can get/bring/deliver". Fixing it here
     again would have been a fourth local patch to a pattern the rule
     engine already has its own opinion about; isPitchAttempt is the one
     answer both now share. */
  /* "book" alone matched a dentist's appointment book, so asking "is there
     room in the book?" — a discovery question — was read as asking for the
     meeting and cost the founder ground. A close asks to book SOMETHING. */
  /* A CLOSE IS AN ASK FOR TIME, however it is phrased. "Would fifteen
     minutes on Thursday work for you?" names no meeting, no calendar and no
     next week, and was invisible here — while the rule engine's own CLOSE
     and TIME_BOX shapes caught it perfectly. The two producers disagreeing
     about whether a close happened is the disagreement itself; the second
     alternative below is the rule engine's test, adopted so they agree. */
  close: /\b(next week|book (a|an|in|us|you|some time)\b|calendar|send (you )?(over|through)|worth (a|fifteen|15)?\s*(look|chat|call|conversation)|catch up|follow up|meeting|meet\b|would you be open|shall we|set (something|a time) up)\b/i,
  /* A number of minutes, plus an ask. Either half alone is not a close:
     "it takes twenty minutes" is a fact, "would you be open" is caught above. */
  timeBox: /\b(\d{1,3}|ten|fifteen|twenty|thirty|half an hour)\s*(minutes?|mins?|hour)\b/i,
  asking: /\b(worth|would you|would .* work|shall we|suggest|propose|book|set up|put (some )?time|happy to|if you'?re open|does that work|work for you)\b/i,
  /* ONE DEFINITION, SHARED WITH THE RULE ENGINE -- exactly the pattern
     `asksForTime` above already uses `isCloseAttempt` for. This used to be
     its own separate literal, missing the adverb tolerance added to
     evidence-gates.js's PRESSURE (Step 3): "you REALLY need to sort this
     out" matched the rule engine's own copy -- which pauses Guided
     Practice and scores `pressure_applied` -- but not this one, so the
     PROSPECT never reacted as pressured for the same line the coaching
     told the founder he had pushed on. Live, on staging: guarded's
     overreach amplification (situationOverreachScale) gates on
     `classification.action === 'pressure'`, so this silently disabled it
     for the exact phrasing the product brief itself used as an example. */
  pressure: PRESSURE,
  /* ── LEAVING WELL ────────────────────────────────────────────────────
     scoreClose() gives a clean exit full marks, so this regex is the only
     thing between a founder who does the right thing and a review telling
     them "no exit was made". It was one contraction wide.

     Measured on canonical staging, 2026-08-22: "Then I do not think there is
     anything here for you today. Thanks for being straight with me. I will
     leave it there." was classified `generic_question` and scored 0/10 on
     close — because the pattern required "I'll" and the founder said "I
     will". A textbook no-fit exit, recorded as a generic question.

     Three shapes, and a turn only has to be one of them: LEAVING, NO FIT, or
     a COURTEOUS SIGN-OFF. Deliberately not "thanks"/"no problem" on their
     own — those appear mid-call constantly, and the caller's !isQuestion
     guard is not enough to carry them. */
  exit: new RegExp([
    /* leaving */
    "\\bi(?:'|\u2019)?(?:ll| will| am going to| shall)? ?(?:leave|let) (?:it|you|that)\\b",
    "\\bleave (?:it|you|that) (?:there|here|with you|to it)\\b",
    "\\bleave you to it\\b",
    "\\bi(?:'|\u2019)?ll let you (?:go|get on)\\b",
    /* no fit */
    "\\bnot (?:the )?right (?:time|fit|person|call)\\b",
    "\\b(?:no|nothing|not anything) (?:here |there )?for you\\b",
    "\\b(?:do not|don'?t|doubt i) think (?:there(?:'| i)?s |we(?:'| a)?re |this is |it(?:'| i)?s )?(?:anything|any|a fit|for you|right)\\b",
    "\\bsounds like.*\\bnot\\b",
    "\\bnot (?:a|the) fit\\b",
    /* courteous sign-off */
    "\\b(?:appreciate|thanks for|thank you for) (?:your|the) (?:time|honesty|candour|candor)\\b",
    "\\bthanks for being (?:straight|honest|clear|frank|up ?front)\\b",
    "\\bwon'?t take up (?:any )?more\\b",
  ].join('|'), 'i'),
  objectionProbe: /\b(what made you|how (is|are) that (going|working)|what would you change|how did you (choose|pick)|what prompted|when you say)\b/i,
  hedge: /\b(just (wondering|checking)|quick question)\b/i,
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

/* An assertion about the prospect that the recorded unknowns say is unknown.
   Reuses the same content-term idea the live call uses. */
/* ── IS THIS SENTENCE EVEN ABOUT THEM? ────────────────────────────────
   An unsupported assumption is a claim about the PROSPECT. Vocabulary
   overlap alone cannot tell "I do content and paid social" from "you have
   nobody doing content and paid social", and it fired on the first: a
   founder describing their own service was told they had invented a fact
   about the prospect. Being confidently wrong at the exact moment VISION
   claims authority is the one thing this cannot afford.

   So the claim must actually reference them. Second person, the prospect's
   own name, or their business as a definite thing. Deliberately NOT
   "they/their", which far more often means a third party — an incumbent
   provider, other practices, patients. */
function aboutTheProspect(text, context = {}) {
  const t = ` ${norm(text)} `;
  if (/\b(you|your|youre|yours)\b/.test(t)) return true;
  if (/\b(the|this) (clinic|practice|business|company|team|shop|firm)\b/.test(t)) return true;
  const name = norm((context.prospect && context.prospect.name) || '');
  /* Match on the distinctive part of the name, not on "dental" or "clinic". */
  const GENERIC = new Set(['dental', 'clinic', 'practice', 'group', 'the', 'and', 'sydney',
    'london', 'centre', 'center', 'medical', 'studio', 'company', 'limited', 'ltd']);
  return name.split(' ').filter((w) => w.length > 3 && !GENERIC.has(w)).some((w) => t.includes(` ${w} `));
}

/* Everything the founder was HANDED before the call: what VISION verified,
   and who they are ringing. Repeating any of it is quoting evidence, not
   inventing a fact, so none of it may count toward asserting an unknown.

   The measured failure this fixes: VISION put "Two reconciliations-assistant
   roles advertised five weeks apart" in `evidence.observed`, the founder
   opened by citing exactly that and asking what sat behind it, and the
   overlap test scored the company's own name plus the word it shared with
   the evidence as two hits against an open unknown. The best opening in the
   corpus was recorded as the Biggest Leak, in all four behaviour modes.

   LIMIT, STATED: this establishes that the founder used terms they were
   given. It cannot tell whether they OVERSTATED what those terms support --
   "two roles were advertised" and "you are clearly drowning" share their
   vocabulary. Overstatement is a semantic question and belongs to the judge,
   which already has a contract for it. */
function grantedTerms(context = {}) {
  const out = new Set();
  const add = (str) => norm(str).split(' ')
    .filter((w) => w.length > 3).forEach((w) => out.add(w.slice(0, 5)));
  ((context.evidence && context.evidence.observed) || []).forEach(add);
  if (context.prospect && context.prospect.name) add(context.prospect.name);
  return out;
}

/* ── A CLAIM THE FOUNDER HAS NO BUSINESS MAKING ───────────────────────
   assertsUnknown() can only fire on an ENUMERATED unknown, so a founder who
   invented a claim VISION had never thought to list was invisible. Measured:
   "The close is slipping every month and your team is overloaded" — the
   prospect had said nothing of the sort, VISION had verified nothing of the
   sort, and it came back `generic_question`. 0 of 5 planted assumptions were
   caught.

   The rule is about SUPPORT, not about a list. A founder may say anything
   the prospect said, anything VISION verified, and anything they are plainly
   not asserting. What is left is a claim about someone else's business with
   nothing behind it.

   FIVE GATES, AND EVERY ONE OF THEM PROTECTS THE FOUNDER:

     SHAPE      a subject that is them, and a predicate. "Thanks for your
                time" contains "your" and asserts nothing.
     HEDGED     "I imagine", "it might be", "would". A guess offered as a
                guess is not a claim, and treating it as one teaches
                founders to stop thinking out loud.
     ATTRIBUTED "you said", "you mentioned". Repeating their answer back is
                the single most useful thing in discovery.
     NEGATED    "I am not going to assume your close is slipping."
     SUPPORTED  the content came from what they disclosed, or from what
                VISION verified.

   It cannot detect OVERSTATEMENT of a supported fact — "two roles were
   advertised" and "you are clearly drowning" share a vocabulary. That is
   semantic and the judge already has a contract for it. */
const HEDGED = /\b(?:i (?:imagine|suspect|guess|assume|wonder|expect)|might|maybe|perhaps|possibly|probably|presumably|i think|i would (?:have )?(?:say|thought)|sounds like|seems like|if\b|would\b|could\b|do not know|don't know|correct me)\b/i;
const ATTRIBUTED = /\b(?:you (?:said|mentioned|told|were saying|say)|as you (?:said|mentioned|put it)|you just said)\b/i;
const NEGATED_CLAIM = /\b(?:not|never|no|nothing)\b/i;
/* Them, then a predicate about them. Closed-class auxiliaries plus a bare
   progressive, so the test is grammatical rather than a topic list. */
const CLAIM_SHAPE = /\b(?:you|your\s+[a-z]+(?:\s+[a-z]+)?)\s+(?:is|are|was|were|has|have|had|gets?|keeps?|looks?|feels?|seems?|sounds?|ends? up|[a-z]+ing)\b/i;

function claimsAboutThem(text, context = {}) {
  const t = norm(text);
  if (CLAIM_SHAPE.test(t)) return true;
  /* "Harrow and Bell are losing hours" — their name as the subject. */
  const name = norm((context.prospect && context.prospect.name) || '');
  const GENERIC = new Set(['dental', 'clinic', 'practice', 'group', 'the', 'and', 'sydney',
    'london', 'centre', 'center', 'medical', 'studio', 'company', 'limited', 'ltd']);
  const distinctive = name.split(' ').filter((w) => w.length > 3 && !GENERIC.has(w));
  return distinctive.some((w) => new RegExp(`\\b${w}\\b[^.?!]{0,24}?\\b(?:is|are|was|were|has|have|had|[a-z]+ing)\\b`, 'i').test(t));
}

/* CLOSED-CLASS AND DISCOURSE WORDS CARRY NO CLAIM. Without this,
   "Your reconciliation work is handled internally, then" — every content
   word of which the prospect had just said — was accused, because "your",
   "work" and "then" counted as three novel terms. Deliberately no domain
   nouns: "team", "close" and "reconciliation" are exactly what a claim is
   made of and must always count. Stems are truncated to five characters to
   match the comparison they feed. */
const NO_CLAIM_STEMS = new Set(['your', 'yours', 'youre', 'then', 'that', 'this', 'these',
  'those', 'there', 'here', 'thing', 'thing', 'stuff', 'about', 'with', 'from', 'into',
  'just', 'only', 'also', 'well', 'right', 'okay', 'thank', 'thanks', 'pleas', 'sorry',
  'going', 'been', 'being', 'quite', 'very', 'much', 'more', 'most', 'some', 'actua',
  'reall', 'obvio', 'clear', 'hones', 'basic', 'simpl', 'guess', 'anyth', 'somet',
  'every', 'alway', 'never', 'still', 'again', 'other', 'thats', 'youve',
  /* THE CALL ITSELF IS NOT THEIR BUSINESS. "I know you are busy — one
     question and I will leave it there" is a courtesy every cold call opens
     with, and it was accused: `you are` is a claim shape, and `know`,
     `busy`, `question` and `leave` counted as four novel terms. A founder
     being polite about interrupting somebody is not inventing a fact about
     how their company runs, and telling them it is would be the single
     fastest way to make this review unusable. */
  'know', 'knows', 'quest', 'leave', 'minut', 'secon', 'momen', 'busy', 'free',
  'time', 'times', 'quick', 'inter', 'catch', 'calli', 'call', 'calls', 'speak',
  'ring', 'bothe', 'blue', 'hello', 'morni', 'after', 'today', 'week', 'weeks',
  'chat', 'talk', 'asked', 'askin', 'wonde', 'mind',
  /* AND NEITHER IS THANKING THEM ON THE WAY OUT. The block above fixed
     courtesy at the START of a call; the same accusation was still live at
     the END of one. Measured on a real staging call: "Appreciate you
     talking with me — have a good one." was convicted as a claim invented
     about their business, which cost grounding, counted toward the
     three-fabrications ceiling that capped the call at 45, and — because
     `unsupported_assumption` carries `challenge: true` — told the prospect
     to push back on a sign-off. 3 of 10 ordinary closing pleasantries were
     accused the same way.
     Every stem here is politeness with no business content: a real
     fabrication still needs two substantive terms, and "your reception
     team is losing dozens of calls a week" keeps them all. */
  'appre', 'talki', 'have', 'good', 'great', 'takin', 'cheer', 'welco',
  'enjoy', 'care', 'nice', 'lovel', 'luck', 'day', 'days']);

/* Content the founder introduced that nobody established. */
function unsupportedContent(text, context = {}, disclosed = []) {
  const granted = grantedTerms(context);
  const said = new Set();
  disclosed.forEach((line) => norm(line).split(' ')
    .filter((w) => w.length > 3).forEach((w) => said.add(w.slice(0, 5))));
  return norm(text).split(' ').filter((w) => w.length > 3).map((w) => w.slice(0, 5))
    .filter((w) => !granted.has(w) && !said.has(w) && !NO_CLAIM_STEMS.has(w));
}

/* A CLAIM LIVES IN ONE SENTENCE. norm() strips punctuation, so testing the
   whole turn let a subject in one sentence pair with a verb in the next:
   "Hi, is that Harrow and Bell? My name is Ryan." became "harrow and bell my
   name is", which read as a claim about them. Caught by the Step 2B
   regression, not by my own labelled set — which is why that case is now in
   it. Each sentence is judged on its own, against everything disclosed. */
export function assertsUnsupportedClaim(text, context = {}, disclosed = []) {
  const whole = String(text || '').trim();
  if (!whole) return null;
  for (const raw of whole.split(/(?<=[.?!])\s+/)) {
    const t = raw.trim();
    if (!t || RE.question.test(t) || /\?/.test(t)) continue;
    if (!aboutTheProspect(t, context)) continue;
    if (!claimsAboutThem(t, context)) continue;
    if (HEDGED.test(t) || ATTRIBUTED.test(t) || NEGATED_CLAIM.test(t)) continue;
    /* Two substantive terms nobody put on the table. One is a coincidence. */
    const novel = unsupportedContent(t, context, disclosed);
    if (novel.length >= 2) return `claimed without evidence: ${t.slice(0, 80)}`;
  }
  return null;
}

function assertsUnknown(text, unknowns, context = {}) {
  /* No reference to them, no claim about them. */
  if (!aboutTheProspect(text, context)) return null;
  const said = new Set(norm(text).split(' ').filter((w) => w.length > 3).map((w) => w.slice(0, 5)));
  const granted = grantedTerms(context);
  for (const u of (unknowns || [])) {
    const terms = [...new Set(norm(u)
      .replace(/^it is not yet known (whether|which|who|what|if)\s+/, '')
      .split(' ').filter((w) => w.length > 3).map((w) => w.slice(0, 5)))];
    if (terms.length < 2) continue;
    /* A term the founder was given proves nothing about invention. */
    const hits = terms.filter((t) => said.has(t) && !granted.has(t));
    if (hits.length >= 2 && !RE.question.test(String(text).trim())) return u;
  }
  return null;
}

/* ── A QUESTION THAT USES WHAT THEY JUST GAVE YOU ─────────────────────
   A high-value follow-up takes the prospect's last answer and goes one level
   further into it. Detection required a literal word of five characters or
   more to reappear, so a founder who did exactly that in their own words was
   scored as asking a fresh generic question. Measured: 1 of 4 caught, and
   the three misses were the three best follow-ups in the set.

   English does not repeat itself when it refers back — it POINTS back.
   "And when somebody in there is away, who picks it up?" carries no word
   from their answer and is unmistakably about it. So the echo test keeps its
   job and gains a second signal beside it: a referring expression pointing
   at something they actually said.

   THERE MUST BE SOMETHING TO BUILD ON. A pointer is only a follow-up if the
   prospect disclosed something to point at; after a refusal there is nothing
   there, and the same words are a founder talking to themselves. */
/* BARE PRONOUNS ONLY. `those`, `this` and `they` are usually determiners
   or third parties: "where are most of those enquiries coming from" points
   at a noun the FOUNDER introduced in the same breath, not at anything the
   prospect said, and counting it credited a fresh discovery question as a
   follow-up — which then changed when pitch permission was earned. Caught
   by the Guided Practice suite, not by this set. */
const REFERS_BACK = /\b(?:that|it|its|them|there)\b/i;
const A_REFUSAL = /\b(?:can(?:no|')t (?:really )?(?:say|discuss|comment|get into|go into)|not (?:going to|able to|prepared to) (?:say|discuss|comment|go into)|would rather not|no comment|not (?:something|somethin) i)\b/i;

export function buildsOnTheirAnswer(text, state = {}) {
  const theirLast = String(state.lastProspectLine || '').trim();
  /* Nothing was revealed, so nothing can be built on. */
  if (theirLast.split(/\s+/).filter(Boolean).length < 4) return false;
  if (A_REFUSAL.test(theirLast)) return false;
  const t = norm(text);
  const echo = norm(theirLast).split(' ').filter((w) => w.length > 4);
  if (echo.some((w) => t.includes(w))) return true;
  /* A referring expression, pointing at what they just said. */
  return REFERS_BACK.test(t);
}

/* Both shapes of an ask for time, in one place so the objection branch and
   the ordinary branch can never drift apart. */
/* ONE DEFINITION, SHARED WITH THE RULE ENGINE. Both producers used to keep
   their own close shapes and disagreed: this one called "Would fifteen
   minutes on Tuesday work to go through it properly?" a close_request while
   the rule engine did not recognise it, so no authoritative `unearned_close`
   was ever raised and the founder got no card. */
function asksForTime(t) {
  return isCloseAttempt(t, { speaker: 'founder' }).pass;
}

/* Same delegation as asksForTime above, to the shared answer for "was that
   a pitch?" -- see evidence-gates.js's isPitchAttempt for why this file no
   longer keeps its own copy. */
function isPitch(t) {
  return isPitchAttempt(t, { speaker: 'founder' }).pass;
}

export function classifyFounderTurn(text, state, context = {}) {
  const t = String(text || '').trim();
  if (!t) return { action: 'generic_question', detail: 'empty' };
  const isQuestion = RE.question.test(t);
  const observed = (context.evidence && context.evidence.observed) || [];

  /* BEFORE ANYTHING ELSE. Contempt is not a sales move to be graded on the
     ladder below -- it ends the conversation, so nothing further about the
     turn matters. `attribution` is the same check the diagnosis layer uses
     to tell a founder's own claim from one he is quoting. */
  const hostile = severeHostility(t);
  if (hostile) return { action: 'hostile', detail: hostile };

  if (RE.exit.test(t) && !isQuestion) return { action: 'professional_exit' };
  /* SAME GUARD `exit` ABOVE ALREADY HAS. evidence-gates.js's own
     coercionAdmissible() has always refused to convict a question --
     "a question is not coercion, and neither is a sentence that DECLINES
     to coerce" -- but this raw check never had that guard, so a genuine
     qualification question sharing the phrase shape ("Do you have to run
     this by anyone else?", "What would you need to see before...?")
     convicted as pressure, making the simulated prospect more resistant in
     reaction to good discovery. */
  if (RE.pressure.test(t) && !isQuestion) return { action: 'pressure' };

  /* Repetition is judged against what this founder has already said. */
  const already = state.said.some((prev) => {
    const a = new Set(norm(prev).split(' ')); const b = norm(t).split(' ');
    const overlap = b.filter((w) => w.length > 3 && a.has(w)).length;
    return b.length > 3 && overlap / b.filter((w) => w.length > 3).length > 0.7;
  });
  if (already) return { action: 'repetition' };

  /* ── NOT ON THE OPENING ────────────────────────────────────────────
     Before the prospect has said a word, NOTHING is supported by
     disclosure, so "unsupported" has no discriminating power — every
     opening looks like an invention. It also depends on the founder's
     wording matching the stored evidence, and it does not have to:
     VISION recorded "Publicly rated 5 from 411 reviews" and the founder
     said "a five rating from four hundred and eleven reviews", which
     shares almost no stem with it. That accused the best opening in the
     Guided Practice corpus.

     An opening is judged as an opening — relevant_opening /
     irrelevant_opening already do that job. assertsUnknown() still covers
     turn zero, because a NAMED unknown stated as fact is precise enough to
     accuse on without any disclosure to compare against. */
  const invented = assertsUnknown(t, context.unknowns, context)
    || (state.turns > 0 ? assertsUnsupportedClaim(t, context, state.prospectSaid || []) : null);
  if (invented) return { action: 'unsupported_assumption', detail: invented };

  if (state.activeObjection) {
    /* ── ASKING FOR THE MEETING IS STILL ASKING FOR THE MEETING ────────
       Any question during an open objection was returned as
       `objection_exploration`, so a founder who explored the objection AND
       asked for Thursday was recorded as having done only the first. The
       close vanished from the evidence entirely and could never be judged.

       These are two different moves and the label goes to the one with
       consequences. It is NOT a conviction: `close_attempted` is neutral in
       the reconciler, and whether the close was UNEARNED is decided later,
       from qualification — a well-qualified close during an objection is a
       good move and is scored as one. */
    if (asksForTime(t)) return { action: 'close_request', detail: 'closed during an open objection' };
    if (RE.objectionProbe.test(t) || (isQuestion && !isPitch(t))) {
      return { action: 'objection_exploration' };
    }
    if (isPitch(t)) return { action: 'premature_pitch', detail: 'pitched over an objection' };
    return { action: 'objection_response' };
  }

  if (asksForTime(t)) return { action: 'close_request' };

  if (isPitch(t)) {
    return state.pitchPermission ? { action: 'pitch' } : { action: 'premature_pitch' };
  }

  if (isQuestion) {
    if (state.turns === 0) return { action: 'discovery_question', detail: 'opening question' };
    /* A follow-up that references what they just said is worth more than a
       fresh generic question. */
    if (buildsOnTheirAnswer(t, state)) return { action: 'high_value_follow_up' };
    if (t.split(/\s+/).length <= 4) return { action: 'generic_question' };
    return { action: 'discovery_question' };
  }

  if (state.turns === 0) {
    const grounded = observed.some((o) => {
      const words = norm(o).split(' ').filter((w) => w.length > 4);
      return words.filter((w) => norm(t).includes(w)).length >= 2;
    });
    return { action: grounded ? 'relevant_opening' : 'irrelevant_opening' };
  }

  const grounded = observed.some((o) => {
    const words = norm(o).split(' ').filter((w) => w.length > 4);
    return words.filter((w) => norm(t).includes(w)).length >= 2;
  });
  return { action: grounded ? 'grounded_observation' : 'generic_question' };
}

/* The caller records the prospect's reply so the next founder turn can be
   judged against it. The engine never invents the reply itself — that is the
   model's job, downstream of this contract. */
export function recordProspectLine(state, text) {
  const line = String(text || '');
  return { ...state, lastProspectLine: line,
    prospectSaid: (state.prospectSaid || []).concat(line ? [line] : []) };
}

/* ── CONSEQUENCES ─────────────────────────────────────────────────────── */
/* Still pushing AT THE MOMENT IT ENDED. Accepting a no is not on this list,
   which is the whole point. */
const PUSHING_ACTIONS = Object.freeze(['pressure', 'unsupported_assumption',
  'premature_pitch', 'repetition']);

/* How far short of this prospect's own exit threshold still counts as
   close to the end. Read with mode.exitThreshold, never on its own -- see
   callAtRisk at the foot of applyFounderAction. */
const AT_RISK_MARGIN = 0.12;

const EFFECTS = {
  relevant_opening: { engagement: +0.15, resistance: -0.1, trust: +0.1 },
  irrelevant_opening: { engagement: -0.1, resistance: +0.15, exitIntent: +0.1 },
  grounded_observation: { trust: +0.1, engagement: +0.05 },
  unsupported_assumption: { trust: -0.25, resistance: +0.15, challenge: true },
  discovery_question: { engagement: +0.1, needDiscovered: +0.1, resistance: -0.05 },
  high_value_follow_up: { engagement: +0.15, needDiscovered: +0.2, trust: +0.1, resistance: -0.1 },
  generic_question: { engagement: -0.02, patienceCost: true },
  pitch: { engagement: +0.05, nextStepWillingness: +0.15 },
  premature_pitch: { resistance: +0.25, engagement: -0.15, exitIntent: +0.15, trust: -0.1 },
  objection_response: { resistance: +0.05 },
  objection_exploration: { engagement: +0.1, trust: +0.15, resistance: -0.15, reveal: true },
  close_request: {},
  pressure: { resistance: +0.3, trust: -0.2, exitIntent: +0.3 },
  repetition: { engagement: -0.15, exitIntent: +0.15, patienceCost: true },
  professional_exit: { endsWell: true },
  /* The prospect does not weigh this against how the call was going. */
  hostile: { engagement: -0.6, resistance: +0.6, trust: -0.6, exitIntent: +1, endsCall: true },
};

export function applyFounderAction(state, classification, mode, context = {}) {
  const s = { ...state };
  const theyJustSaid = String((context && context.prospectSaid) || '');
  const changes = [];
  const e = EFFECTS[classification.action] || {};
  const before = { engagement: s.engagement, resistance: s.resistance, trust: s.trust, exitIntent: s.exitIntent };

  /* GUARDED READS OVERREACH AS CONFIRMATION. A pressure phrase or an
     invented claim does not just cost trust everywhere -- to a prospect who
     was already wary before anything was said, it reads as exactly the
     kind of call they expected. Scaled here, once, rather than adding a
     situation-aware branch to every one of the seventeen EFFECTS entries
     above. */
  const overreachScale = situationOverreachScale(s.situation, classification.action);

  /* The founder's own two dials, read off the mode resolveMode already
     built. Null for every caller that never set them. */
  const intensity = (mode && mode.intensity) || null;

  /* ── P0-1: SCENARIO TRUTH OUTRANKS FOUNDER TECHNIQUE ─────────────────
     `needDiscovered` rises from the founder's ACTION LABEL
     (discovery_question +0.1, high_value_follow_up +0.2) and nothing reads
     what the prospect actually said -- `buildsOnTheirAnswer` keys on word
     overlap, so a denial that echoes the founder's own words scores HIGHER
     than a confession that does not.

     On a scenario the engine itself drew as having no pain
     (`variation.painExists === false`) that produced a measured absurdity:
     in the 100-turn run, 5 of 8 no-pain calls reached
     `qualified_opportunity`. In one, the prospect used five of five
     no-pain ledger facts correctly and said "it just isn't a problem here"
     -- and the engine recorded needDiscovered 0.6 -> 1.0, granted
     pitchPermission, and reported a qualified opportunity. The founder was
     told they had uncovered a need the scenario says does not exist.

     THE NARROWEST CORRECTION: a need that is not there cannot be
     discovered, so positive needDiscovered deltas do not land. Deliberately
     scoped to GAINS ONLY on THIS ONE KEY:
       - the starting value is untouched, so no scenario begins differently;
       - losses still land, so a founder can still destroy a weak position;
       - every other axis (trust, engagement, resistance, exitIntent,
         nextStepWillingness) is completely unaffected;
       - `painExists !== false` -- including absent/unknown -- is untouched,
         so this can only ever fire where the engine has positively decided
         there is no pain.
     pitchPermission (needs >= 0.5), qualified_opportunity (>= 0.6) and
     closePermission (>= 0.5) all read this one value, so capping the source
     fixes all three without touching their thresholds or the outcome table. */
  const noPain = !!(context && context.scenario && context.scenario.variation
    && context.scenario.variation.painExists === false);

  const bump = (key, by) => {
    if (!by) return;
    /* Resistance is stickier the more resistant the mode: a resistant
       prospect does not soften as fast as a receptive one, and pretending
       otherwise is where rehearsal stops teaching anything. */
    /* PRESSURE decides how much of a delta actually lands, and it is NOT a
       symmetric multiplier: an unforgiving prospect punishes harder AND
       returns less, so damage and recovery are scaled apart. DIFFICULTY
       separately slows how fast need can be uncovered, and only on gains --
       a harder problem makes the need harder to FIND, never faster to lose. */
    /* PRESSURE decides how much of a delta actually lands, and it is NOT a
       symmetric multiplier: an unforgiving prospect punishes harder AND
       returns less, so damage and recovery are scaled apart. DIFFICULTY
       separately slows how fast need can be uncovered, and only on gains --
       a harder problem makes the need harder to FIND, never faster to lose. */
    const scale = (key === 'resistance' && by < 0 ? (1 - mode.initialResistance * 0.6) : 1)
      * overreachScale
      * intensityEffectScale(intensity, key, by)
      * (key === 'needDiscovered' ? intensityNeedDiscoveryScale(intensity, by) : 1);
    s[key] = clamp(s[key] + by * scale);
    changes.push(`${key} ${by > 0 ? '+' : ''}${Math.round(by * scale * 100) / 100}`);
  };
  bump('engagement', e.engagement); bump('resistance', e.resistance);
  bump('trust', e.trust); bump('exitIntent', e.exitIntent);
  bump('needDiscovered', e.needDiscovered); bump('nextStepWillingness', e.nextStepWillingness);

  /* ── P0-1: A CEILING, NOT JUST A BRAKE ON GAINS ──────────────────────
     The first cut of this guard withheld positive `needDiscovered` deltas
     and left the SEEDED value alone, on the reasoning that blocking gains
     was the narrowest possible correction. That was wrong, and an
     adversarial replay found it: `createProspectState` seeds
     `needDiscovered` from `currentNeedStrength` (:186), and difficulty
     scales it (practice-intensity.js, `easy` = x1.30). On easy + grounded
     urgency the seed alone is 0.65 -- already past the 0.6
     qualified_opportunity line and the 0.5 pitch line -- so a no-pain call
     reported `qualified_opportunity` on turn one, before the founder had
     said anything. Blocking gains never touched it. The first test suite
     could not see it either, because its fixtures pinned whyNow none and no
     difficulty, and one of its checks asserted the untouched seed as a
     FEATURE.

     A ceiling fixes both halves at once and is simpler than the brake it
     replaces: the seed is clamped down to it, and no gain can climb past
     it, so the `by > 0` test the brake needed is gone. Placed here, after
     the bumps and BEFORE pitch permission is considered (:1010), because
     that grant reads `needDiscovered` and would otherwise be decided on the
     unclamped value.

     0.3 is the base the mode's own need derivation starts from, so a
     no-pain scenario sits at that floor rather than at an invented number.
     It is a `min`, so the harder modes that seed BELOW it (hard 0.22,
     brutal 0.15) are left exactly where they are -- this can only ever
     lower, never raise. Every downstream reader is governed by it without
     touching one threshold: need_uncovered (>= 0.4), pitchPermission
     (>= 0.5), qualified_opportunity (>= 0.6), closePermission (>= 0.5). */
  if (noPain && s.needDiscovered > NO_PAIN_NEED_CEILING) {
    changes.push(`needDiscovered capped ${s.needDiscovered} -> ${NO_PAIN_NEED_CEILING} (scenario has no pain)`);
    s.needDiscovered = NO_PAIN_NEED_CEILING;
  }

  /* THE MOMENT ITSELF MOVES TOO. Attention rises or falls with what the
     founder actually did, and drifts back toward the situation's own
     starting point on an ordinary turn rather than freezing. */
  if (s.situation && s.situation.id) {
    const beforeAttention = s.situation.attention;
    s.situation = applySituationTurn(s.situation, classification.action, classification.text);
    if (Math.abs(s.situation.attention - beforeAttention) >= 0.005) {
      changes.push(`attention ${s.situation.attention >= beforeAttention ? '+' : ''}${Math.round((s.situation.attention - beforeAttention) * 100) / 100}`);
    }
  }

  if (e.patienceCost) { s.exitIntent = clamp(s.exitIntent + (1 - mode.patience) * 0.12); changes.push('patience spent'); }

  /* ── WHAT PASSED BETWEEN THEM, NOT JUST WHAT HE SAID ────────────────
     EFFECTS above prices the founder's SENTENCE. It cannot see that the
     sentence was an answer to "can you bear with me one second?" -- so a
     pitch delivered straight over a request to wait was priced as an
     opening question and paid +0.1 engagement. Measured on a real call.

     Read once, here, and both consumers use this same object: the state
     below, and Guided (which reads `lastInteraction` off the state it is
     handed). That is what stops the founder being told one thing while
     the prospect does another -- there is no second opinion to disagree
     with, because there is no second read.

     Priced on the SAME dials as everything else and scaled by the same
     pressure multipliers via bump(), so Difficulty and Pressure govern
     this exactly as they govern every other mistake. Ignoring somebody is
     a patience and resistance event, never a trust one: they do not think
     less of you for it, they are just done being talked over. */
  /* WP4: the caller's own validated authority/routing timeline (evidence-
     gates.js's readAuthorityEvidence), as of this exchange -- computed
     upstream, from a transcript this file never holds, and passed through
     exactly like prospectSaid above. Absent, readInteraction's own
     authority-driven cause simply cannot fire (never a fallback to the
     raw lexical read it replaced), so every caller that predates it, or
     has not been wired to compute it, behaves exactly as it did before. */
  const interaction = readInteraction({
    prospectSaid: theyJustSaid, founderText: classification.text, classification,
    authorityEvidence: (context && context.authorityEvidence) || null,
  });
  s.lastInteraction = interaction;
  if (interaction.ignoredBoundary || interaction.pushedAfterRefusal) {
    bump('exitIntent', interaction.pushedAfterRefusal ? 0.22 : 0.16);
    bump('resistance', 0.12);
    /* The counter that has been declared and never incremented since this
       file was written. It is what "ignored an important answer" in the
       product brief always meant, and there is finally evidence behind it. */
    s.ignoredAnswer += 1;
    changes.push(interaction.pushedAfterRefusal ? 'pushed after a refusal' : 'ignored what they asked');
  }

  if (classification.action === 'unsupported_assumption') s.overreached += 1;
  if (classification.action === 'repetition') s.repeated += 1;
  if (classification.action === 'pressure') s.overreached += 1;

  /* PITCH PERMISSION IS EARNED, never assumed and never granted by asking. */
  if (!s.pitchPermission && s.needDiscovered >= 0.5 && s.trust >= 0.5 && s.resistance <= 0.55) {
    s.pitchPermission = true;
    changes.push('pitch permission earned');
  }
  if (classification.action === 'pressure' || classification.action === 'unsupported_assumption') {
    if (s.pitchPermission) { s.pitchPermission = false; changes.push('pitch permission lost'); }
  }

  /* Objections surface from the mode's own likely list, when resistance is
     high enough to warrant one and the budget allows. */
  /* DIFFICULTY OWNS OBJECTIONS, NOT PRESSURE. This gate used to be a bare
     0.45 against resistance -- which pressure also moves -- so turning
     tolerance down silently raised the objection count and the two axes were
     not independent at all. The threshold now comes from difficulty and
     returns exactly 0.45 when no dials are set. */
  if (!s.activeObjection && s.objectionsRaised < mode.maxObjections
      && s.resistance >= objectionGateOf(intensity) && s.turns >= 1
      && ['premature_pitch', 'pitch', 'close_request', 'irrelevant_opening'].includes(classification.action)) {
    const likely = (mode.likelyObjections && mode.likelyObjections.length)
      ? mode.likelyObjections
      : (context.objections || []).map((o) => o.q).filter(Boolean);
    if (likely.length) {
      s.activeObjection = likely[s.objectionsRaised % likely.length];
      s.objectionsRaised += 1;
      changes.push('objection raised');
    }
  }
  if (['objection_exploration', 'objection_response'].includes(classification.action) && s.activeObjection) {
    if (classification.action === 'objection_exploration') { s.activeObjection = null; changes.push('objection explored'); }
  }

  /* CLOSING BEFORE IT IS EARNED COSTS GROUND. */
  if (classification.action === 'close_request') {
    if (s.pitchPermission && s.needDiscovered >= 0.5 && s.trust >= 0.5) {
      s.nextStepWillingness = clamp(s.nextStepWillingness + 0.4);
      changes.push('close landed');
    } else {
      s.resistance = clamp(s.resistance + 0.2);
      s.exitIntent = clamp(s.exitIntent + 0.15);
      changes.push('closed too early');
    }
  }

  s.turns += 1;
  s.said = [...s.said, String(classification.text || '')].slice(-12);

  /* ENDINGS. A genuine no is allowed to stand. */
  if (classification.action === 'hostile') {
    /* TERMINAL, AND DECIDED HERE. Not by a threshold that a mode could tune
       below it, and never by the model -- which phrases the last line and
       nothing else. */
    s.ended = true;
    s.endedReason = 'hostility_from_founder';
  } else if (classification.action === 'professional_exit') {
    s.ended = true;
    s.endedReason = s.needDiscovered < 0.35 ? 'no_fit_identified' : 'founder_closed_politely';
  } else if (s.exitIntent >= mode.exitThreshold) {
    s.ended = true;
    /* PRESSURE IS PUSHING, the first time. Requiring two overreaches before
       calling it that let a founder end a call by leaning on someone and be
       told the prospect merely lost patience — which teaches the wrong
       lesson about which behaviour ended it. */
    /* HOW IT ENDED, NOT WHAT HE DID TEN TURNS AGO. `overreached` is a
       lifetime counter, so a founder who made one assumption early and then
       accepted a no politely was told he pushed too hard -- observed on a
       real call that ended:

         FOUNDER   Do you want to buy my course?
         PROSPECT  No, I'm not interested.
         FOUNDER   Okay.
         PROSPECT  Thanks, goodbye.

       Pressure ended a call only if he was still pushing when it ended. */
    const pushingNow = PUSHING_ACTIONS.includes(classification.action);
    const refused = HARD_NO.test(theyJustSaid) || SOFT_NO.test(theyJustSaid);
    const cause = pushingNow ? 'pushed_too_hard' : (refused ? 'refusal_accepted' : 'lost_patience');

    /* ── A GRACEFUL EXIT IS NOT A MISTAKE ─────────────────────────────
       `refusal_accepted` is the founder taking a no well and the call
       winding down on its own -- the worked example above, ending on
       "Okay" / "Thanks, goodbye." There is no severity question to ask
       about a founder who did nothing wrong, and a judge asked one would
       be a second opinion on a call that was never in danger. Untouched:
       exactly as terminal as it always was. */
    const gracefulExit = !pushingNow && refused;

    /* ── EXTREME, AND DECIDED HERE ONLY ──────────────────────────────
       Ignoring an EXPLICIT stop -- "take us off your list", or pushing
       again right after a clear "not interested" -- stays exactly as
       terminal as it always was. No judge, no candidate, no softening:
       this is the one shape of "pushed_too_hard" that was never the bug.
       Soft resistance ("we're happy with what we have") is deliberately
       NOT in this gate -- pushing once after soft resistance is an
       ordinary mistake, not an ignored stop, and belongs in the candidate
       branch below. */
    const explicitStop = DO_NOT_CONTACT.test(theyJustSaid) || HARD_NO.test(theyJustSaid);
    /* ── BRUTAL PRESSURE, AND WHY IT IS NOT A TRAPDOOR ────────────────
       The forgiveness pass below exists because ONE ordinary mistake should
       not end a rehearsal before anything has taught it. At Brutal pressure
       it does not apply -- but only to a founder who is STILL PUSHING at the
       moment exit intent crossed this prospect's own threshold.

       Three conditions all have to hold, and every one of them is something
       the founder did: exit intent crossed the threshold, the move that
       crossed it was a pushing move, and the founder chose Brutal. General
       patience decay (`lost_patience`) is deliberately excluded, so a Brutal
       call cannot end on a run of merely unremarkable turns. A founder who
       says nothing damaging is not reachable by this branch at any level. */
    const brutalTerminal = pushingNow && endsOnFirstDamagingMove(intensity);
    if (gracefulExit || (pushingNow && explicitStop) || brutalTerminal) {
      s.endedReason = cause;
    } else {
      /* ── CANDIDATE, NOT A VERDICT ─────────────────────────────────
         Everything else that crossed the threshold -- a single pressure
         line, a premature pitch, an unsupported assumption, pushing once
         after SOFT resistance, or general patience decay with nothing
         extreme in it -- is exactly what let a Guarded prospect hang up
         on one ordinary mistake before anything had a chance to teach it.
         The call is left open (s.ended stays false) and the reason it
         WOULD have ended is recorded for a caller to resolve -- with a
         severity judge if one is enabled, or with the same conservative
         floor this fix guarantees when one is not. See
         hangup-severity.js: mapSeverityToDecision is the only thing that
         turns this into a state change, and a model never reaches state
         directly. */
      s.ended = false;
      s.endedReason = null;
      s.hangupCandidatesSeen = (s.hangupCandidatesSeen || 0) + 1;
      s.hangupCandidate = {
        cause, action: classification.action, founderText: String(classification.text || ''),
        overreachCount: s.overreached, candidateCount: s.hangupCandidatesSeen,
        exitIntent: s.exitIntent, exitThreshold: mode.exitThreshold,
      };
    }
  }

  /* ── THE CALL IS AT RISK, DECIDED WHERE THE CALL ENDS ────────────────
     Computed here, in the engine, against the SAME `mode.exitThreshold`
     the branch above uses to end the call -- not re-derived by a surface
     that could drift from it. Guided reads this boolean and nothing else,
     so "they are close to ending the call" and the prospect actually
     ending it are two readings of one number rather than two opinions.

     AT_RISK_MARGIN is how far short of the threshold still counts as
     close. It is not a second threshold with its own opinion: cross the
     real one and `ended` is already true, in which case nothing is at
     risk any more because nothing is left.

     A hangup CANDIDATE also counts, and is the stronger signal of the
     two: the engine decided this turn would have ended the call and then
     forgave it. That is as close as a call gets without being over.

     Deliberately NOT a function of Pressure alone. Brutal narrows the
     threshold, so Brutal gets here sooner -- but only ever because this
     founder's own exitIntent actually climbed. A Brutal call where
     nothing damaging happens never reports risk. */
  /* PROXIMITY IS NOT ENOUGH ON ITS OWN. One hard push from a standing
     start lands within a whisker of the threshold at Medium, and calling
     that "close to ending the call" spends the warning on turn one and
     leaves nothing to escalate to. Risk is proximity AND damage that has
     actually been accumulating -- a forgiven hangup candidate, or a
     founder who has now overreached more than once. That is the shape the
     brief asks for: Patience down first, critical when it is earned. */
  const accumulating = !!s.hangupCandidate || (s.hangupCandidatesSeen || 0) > 0
    || (s.overreached || 0) >= 2 || (s.ignoredAnswer || 0) >= 2;
  s.callAtRisk = !s.ended && accumulating
    && s.exitIntent >= (mode.exitThreshold - AT_RISK_MARGIN);

  return { state: s, changes, before };
}

/* ── OUTCOMES ─────────────────────────────────────────────────────────
   Never win/lose. What actually happened, and whether the founder played it
   correctly, are two different questions. */
export const OUTCOMES = Object.freeze([
  'conversation_ended_immediately', 'permission_to_continue_earned', 'need_uncovered',
  'qualified_opportunity', 'follow_up_earned', 'meeting_earned', 'not_a_fit',
  'prospect_declined', 'founder_lost_the_conversation', 'in_progress',
]);

export function outcomeOf(state, mode) {
  if (state.ended) {
    if (state.endedReason === 'no_fit_identified') return 'not_a_fit';
    if (state.endedReason === 'founder_closed_politely') {
      return state.nextStepWillingness >= 0.5 ? 'follow_up_earned' : 'prospect_declined';
    }
    if (state.endedReason === 'hostility_from_founder') return 'founder_lost_the_conversation';
    /* They said no and he took it. That is a decline, not a call he lost. */
    if (state.endedReason === 'refusal_accepted') return 'prospect_declined';
    if (state.endedReason === 'pushed_too_hard') return 'founder_lost_the_conversation';
    return state.turns <= 2 ? 'conversation_ended_immediately' : 'founder_lost_the_conversation';
  }
  if (state.nextStepWillingness >= 0.6) return 'meeting_earned';
  if (state.nextStepWillingness >= 0.4) return 'follow_up_earned';
  if (state.needDiscovered >= 0.6 && state.pitchPermission) return 'qualified_opportunity';
  if (state.needDiscovered >= 0.4) return 'need_uncovered';
  if (state.engagement > mode.openness) return 'permission_to_continue_earned';
  return 'in_progress';
}

/* WAS THE FOUNDER RIGHT? Separate from what happened, because ending a call
   with a prospect who has no need is correct execution and a poor outcome
   would be the wrong lesson. */
export function executionVerdict(state) {
  if (state.endedReason === 'no_fit_identified') {
    return { correct: true, why: 'You established there was no need and ended it without wasting either side\'s time.' };
  }
  if (state.overreached >= 2) {
    return { correct: false, why: 'You kept going after they had answered — that costs the relationship, not just the call.' };
  }
  if (state.repeated >= 2) {
    return { correct: false, why: 'You repeated yourself rather than working with what they told you.' };
  }
  if (state.needDiscovered >= 0.5 && state.trust >= 0.5) {
    return { correct: true, why: 'You found a real gap before offering anything.' };
  }
  return { correct: null, why: 'Not enough happened yet to judge how it was played.' };
}

/* ── THE TURN CONTRACT ────────────────────────────────────────────────
   What a language model will later be handed. It phrases; it does not
   decide. */
export function takeFounderTurn({ mode: modeId = DEFAULT_MODE, state, text, context = {} }) {
  const mode = resolveMode(modeId, context);
  const before = state || createProspectState(modeId, context);
  const stateForClassify = context.prospectSaid ? recordProspectLine(before, context.prospectSaid) : before;
  const classification = { ...classifyFounderTurn(text, stateForClassify, context), text };
  const withReply = context.prospectSaid ? recordProspectLine(before, context.prospectSaid) : before;
  const { state: after, changes } = applyFounderAction(withReply, classification, mode, context);
  const e = EFFECTS[classification.action] || {};
  return buildTurn({ modeId, mode, before, classification, after, changes, e, text, context });
}

/* ── EVERYTHING A TURN CARRIES, GIVEN A STATE ────────────────────────────
   Factored out of takeFounderTurn so a hangup-severity resolution can
   re-derive the SAME fields from an ADJUSTED state without a second, drifting
   copy of this logic. Pure: identical inputs produce an identical turn,
   whether `after` came straight from applyFounderAction or was adjusted by
   resolveHangupCandidate below. Behaviour for the normal path is unchanged --
   this is an extraction, not a rewrite. */
function buildTurn({ modeId, mode, before, classification, after, changes, e, text, context }) {
  const posture = after.ended ? 'closing'
    : (after.resistance >= 0.7 ? 'guarded'
      : (after.resistance >= 0.45 ? 'measured' : 'open'));

  const founderAsked = RE.question.test(String(text || '').trim());

  /* ── HOW THEY REACT ────────────────────────────────────────────────
     Two axes, decided from state the engine already keeps. This replaced
     three prose bands read off `engagement` alone whose lowest rung still
     answered the question — which is why a prospect could never decline. */
  const reaction = decideReaction({ state: after, mode, classification,
    effects: e, founderAsked, founderText: text, context });

  /* WHAT THE MODEL MAY SAY. An explicit allowance, not a suggestion, and now
     the policy's decision translated rather than a second opinion on it. */
  const informationAllowed = disclosurePhrase(reaction.disclosure);

  /* Evaluated ONCE. Both readings below come from this single decision, so
     there is no way for them to disagree about which branch was taken. */
  const instruction = instructionFor(classification.action, after, mode);
  /* Decided once: the allowance moves with the imperative or not at all. */
  const answerable = answerableInstruction(instruction, reaction,
    classification.action, founderAsked, after);

  return {
    mode: modeId,
    resembles: mode.resembles || modeId,
    prospectStateBefore: before,
    founderAction: classification.action,
    founderActionDetail: classification.detail || null,
    /* DID HE ACTUALLY ASK ANYTHING? `generic_question` is the classifier's
       terminal default -- what a turn gets when nothing else matched -- so
       it lands on statements too, including "Shut up." Downstream that
       label was read as fact and answered with "It varies. Why do you
       ask?", which answers a question nobody asked and reads like the
       prospect replying to an earlier part of the call. The label cannot
       carry that distinction, so the fact travels separately. */
    founderAsked,
    /* WHAT THEY ACTUALLY SAID, on the turn that describes it. The edge
       function used to splice this in for the model prompt alone
       (`{ ...turn, founderText }`), so every other consumer -- including the
       deterministic floor, which needs it to answer the right KIND of
       question -- silently saw undefined and fell through to a generic line. */
    founderText: String(text == null ? '' : text),
    stateChanges: changes,
    allowedResponsePosture: posture,
    activeObjection: after.activeObjection,
    informationAllowed,
    /* Simulated detail is permitted only when the prospect is willing to
       talk, and is always marked. */
    /* A prospect who is not disclosing does not invent new private detail
       to not disclose. Partial says less of what is already known; none says
       nothing. Only an open answer mints anything new. */
    simulatedFactsAllowed: after.engagement >= 0.4 && !after.ended
      && (reaction.disclosure === DISCLOSURE.FULL || reaction.disclosure === DISCLOSURE.VOLUNTEER),
    reaction,
    /* Hoisted out of `reaction` because every downstream fairness check reads
       this one boolean and nothing else from the policy. */
    prospectCausedWithholding: reaction.withholding.prospectCaused === true,
    challengeFounder: !!e.challenge,
    exitIntent: after.exitIntent,
    closePermission: after.pitchPermission && after.needDiscovered >= 0.5,
    outcomeState: outcomeOf(after, mode),
    execution: executionVerdict(after),
    /* The action's own instruction, then what the policy decided comes back
       the other way. Appended, never substituted: the upstream instruction is
       the one that carries objection, refusal and hangup authority. */
    responseInstruction: [instruction.instruction,
      initiativePhrase(reaction.initiative)].filter(Boolean).join(' '),
    /* ── THE SAME DECISION, READ FOR A TURN THAT HAS SOMETHING TO SAY ──
       Measured on staging: across 102 turns where the disclosure ledger had
       granted the prospect an earned fact, this field said "only what was
       asked" (67) or "you have not agreed there is a problem yet" (35) --
       so the one imperative in the prompt told them to withhold the very
       thing they had just been handed, and it is the last line the model
       reads. Two authorities decided the same turn and neither knew of the
       other.
       They cannot simply be merged here: admissibleDisclosures needs the
       trust and attention THIS turn produced, so the offer does not exist
       yet. What is deferred is therefore only the CHOICE -- both readings
       are decided now, by one function, from one state, so they can never
       drift apart. reconcileTurnWithDisclosure() picks between them once the
       ledger has ruled.
       Note the second reading exists for EVERY branch, not only the ones
       whose words change: a branch that keeps its own imperative must still
       stop ordering a question back, or the single action that unlocks the
       deepest facts would deflect on exactly the turn it earned one. */
    /* What the imperative becomes once the ledger has granted something --
       computed for EVERY branch, because even a branch that keeps its own
       words must stop ordering a question back. */
    responseInstructionIfOffered: instructionWhenOffered(instruction, answerable, reaction),
    /* This turn is not going to say a business fact whatever the ledger
       granted -- so the grant must be withdrawn, not spent. */
    refusesToAnswer: instruction.refuses === true,
    /* Raised only where the prospect is actually going to answer: a call
       that is ending does not become more forthcoming. */
    informationAllowedIfOffered: answerable ? allowanceIfAnswerable(reaction) : informationAllowed,
    prospectStateAfter: after,
  };
}

/* ── RESOLVING A CANDIDATE ────────────────────────────────────────────────
   The one place a severity verdict is allowed to touch state, and it does
   so entirely through mapSeverityToDecision -- a pure function this file
   does not own and does not second-guess. Re-derives the WHOLE turn through
   buildTurn rather than patching individual fields, so posture, the
   response instruction, disclosure, all of it stay consistent with
   whatever the decision actually was -- exactly as if the deterministic
   engine had reached that state on its own.

   `context` is required for the same reason `takeFounderTurn` needs it:
   `resolveMode` depends on it, and a caller that already has the turn has
   the handoff sitting right next to it. */
export function resolveHangupCandidate(turn, verdict, context = {}) {
  const candidate = turn && turn.prospectStateAfter && turn.prospectStateAfter.hangupCandidate;
  if (!candidate) return turn;

  const decision = mapSeverityToDecision({ severity: verdict && verdict.severity,
    confidence: verdict && verdict.confidence, candidate });

  const mode = resolveMode(turn.mode, context);
  const after = { ...turn.prospectStateAfter, hangupCandidate: undefined,
    ended: decision.ended, endedReason: decision.endedReason,
    exitIntent: clamp(decision.exitIntent),
    resistance: clamp(turn.prospectStateAfter.resistance + (decision.resistanceDelta || 0)) };
  delete after.hangupCandidate;

  const classification = { action: turn.founderAction, detail: turn.founderActionDetail,
    text: turn.founderText };
  const e = EFFECTS[classification.action] || {};

  const resolved = buildTurn({ modeId: turn.mode, mode, before: turn.prospectStateBefore,
    classification, after, changes: turn.stateChanges, e, text: turn.founderText, context });
  /* Kept off the normal turn shape entirely -- this is an audit trail for
     whoever called the judge, not a new thing the dialogue layer or the
     scoring layer needs to know exists. */
  resolved.hangupSeverity = { ...decision, verdict: verdict || null };
  return resolved;
}

/* ── WHOSE TURN MAY BE ANSWERED WITH AN EARNED FACT ─────────────────────
   The default branch at the end of instructionFor is the terminal case for
   NINE different founder actions, and most of them must not volunteer
   anything. Answering a `repetition` rewards a founder for asking the same
   question again. Answering a `close_request` hands over operational detail
   while the prompt's MUST NOT block separately forbids agreeing to the
   meeting, so the close itself goes unanswered. Answering an
   `irrelevant_opening` has the prospect offer up how their phones work as
   its first words after an opener the engine has just judged irrelevant.
   So the override is granted by NAME, never by "whatever fell through". */
const ANSWERABLE_ACTIONS = Object.freeze(new Set([
  'premature_pitch', 'discovery_question', 'generic_question',
]));

/* Returns BOTH readings of one decision: `instruction` for a turn with
   nothing to offer, and `answerable` for the same turn when the ledger has
   already granted an earned fact. `only()` marks a branch that writes no
   second reading -- either because it outranks disclosure (a call ending, a
   held objection, a reaction to pressure, a disputed assertion) or because
   it already tells them to answer.
   These branches are guarded TWICE, and deliberately: ANSWERABLE_ACTIONS
   above would block them anyway, because no action that reaches one of them
   is in the allow-set -- a question asked while an objection is held
   reclassifies to objection_exploration, and no question ever ends a call.
   Removing either guard alone therefore changes no behaviour, which is the
   point of having both; it is redundancy, not dead code, and the exhaustive
   gate in qa-practice-prospect-behaviour asserts the property rather than
   either mechanism. */
function instructionFor(action, s, mode) {
  /* `refuses` marks a branch that is not going to deliver a business fact at
     all -- not merely one whose words stay the same. It is what lets the
     reconciler WITHDRAW an offer instead of letting it be burned unspoken. */
  const only = (instruction) => ({ instruction, answerable: null, refuses: true });
  const answers = (instruction) => ({ instruction, answerable: null, refuses: false });
  if (s.ended && s.endedReason === 'no_fit_identified') return only('Accept the close politely. There is no need here and both of you know it.');
  if (s.ended) return only('End the call. You have run out of patience for this.');
  /* DISPUTES THE CLAIM, NOT THE TRANSCRIPT. This ended "You did not say
     that." -- an order to deny having spoken, handed to a model that
     complies. Whether that denial is true depends on a transcript this
     instruction has never seen, so on a misclassification it forces the
     prospect to contradict its own words. Same fault the deterministic
     floor carried (prospect-dialogue.js), fixed the same way: challenge
     what they ASSERTED, assert nothing about what was said. */
  if (action === 'unsupported_assumption') return only('Push back on what they just asserted. They are taking something for granted that is not settled.');
  if (action === 'pressure') return only('React badly to being pushed. Become shorter and less willing.');
  /* Not being sold yet is a position about THEIR OFFER. It was never a reason
     to refuse a plain question about your own business, and answering first
     does not concede anything -- the scepticism still gets said. */
  if (action === 'premature_pitch') {
    return { refuses: false, instruction: 'You have not agreed there is a problem yet. Say so, briefly.',
      answerable: 'They asked you something you can answer. Answer it plainly first, then say you are not sold there is a problem.' };
  }
  if (action === 'objection_exploration') return answers('They asked a fair question about your situation. Give them the real reason.');
  if (action === 'high_value_follow_up') return answers('They listened. Answer with something specific.');
  if (s.activeObjection) return only(`Hold the objection: "${s.activeObjection}"`);
  /* Wanting off the phone shortens the answer; it does not delete it. */
  if (mode.initialResistance >= 0.7 && s.turns <= 2) {
    return { refuses: false, instruction: 'Try to get off the phone without being rude.',
      answerable: 'You want to get off the phone -- but answer what they asked first, in one line, then try to wrap up.' };
  }
  return { refuses: false, instruction: 'Answer as a busy person would: briefly, and only what was asked.',
    answerable: 'Answer as a busy person would: briefly. You know the answer to what they asked -- give it rather than deflecting.' };
}

/* ── THE ANSWERABLE READING, WITH ITS INITIATIVE RECONCILED ──────────────
   The initiative phrase is appended to the instruction, so it is part of the
   same imperative. QUESTION_BACK ("ask them a practical question back") is
   the one that competes directly: on a turn with a fact in hand it tells the
   model to return a question instead of the answer, which is the deflection
   being fixed. It is dropped from the answerable reading ONLY -- the ordinary
   reading is untouched, so a turn with nothing to offer still questions back
   exactly as it does today. CLARIFY and CHALLENGE are kept: asking what they
   mean, or pushing back on what they said, are both compatible with also
   answering, and neither is a way to avoid it. */
function answerableInstruction(instruction, reaction, action, founderAsked, s) {
  if (!instruction || !instruction.answerable) return null;
  if (!ANSWERABLE_ACTIONS.has(action)) return null;
  /* A HELD OBJECTION OUTRANKS THE ACTION LABEL. `premature_pitch` is tested
     BEFORE `s.activeObjection` inside instructionFor, so a founder who
     pitches over a live objection is labelled premature_pitch and would
     otherwise take the overridable path -- dropping the objection from the
     only imperative in the prompt. Keying on the STATE closes that, because
     the state is what the guarantee was ever about. */
  if (s && s.activeObjection) return null;
  /* THE LEDGER'S RELEVANCE TEST IS NOT A QUESTION TEST. askedAbout() matches
     topic words anywhere in the founder's line with no interrogative
     requirement, so "You must be busy." puts a fact on offer having asked
     nothing. Answering it would be the very failure the engine's own
     question test was added to stop -- a prospect replying to a question
     nobody asked -- so the override borrows that same test rather than
     trusting relevance to imply one. */
  if (!founderAsked) return null;
  return instruction.answerable;
}

/* ── THE INITIATIVE THAT COMPETES WITH ANSWERING ─────────────────────────
   The initiative phrase is appended to the instruction, so it is part of the
   same imperative and it lands last. Two of the three contradict an answer
   outright: QUESTION_BACK ("ask them a practical question back") returns a
   question instead of the answer, and CLARIFY ("ask them what they actually
   mean BEFORE ANSWERING ANYTHING") says the opposite of answering in the
   very next clause and wins by recency. CHALLENGE ("push back on what they
   just said") is compatible -- a person can answer and still push back.
   This is applied on EVERY branch, not only the overridable ones. Otherwise
   `high_value_follow_up` -- the single action that unlocks the ledger's
   deepest facts -- would keep ordering the prospect to question back on the
   exact turns the deepest fact was just earned.
   `decideReaction` is untouched: reaction.initiative still reports what the
   policy decided, so nothing downstream of the policy changes. */
const INITIATIVE_COMPETES_WITH_ANSWERING = Object.freeze(
  new Set([INITIATIVE.QUESTION_BACK, INITIATIVE.CLARIFY]));

function instructionWhenOffered(instruction, answerable, reaction) {
  const initiative = reaction
    && INITIATIVE_COMPETES_WITH_ANSWERING.has(reaction.initiative)
    ? '' : initiativePhrase(reaction && reaction.initiative);
  return [answerable || (instruction && instruction.instruction), initiative]
    .filter(Boolean).join(' ');
}

/* ── HOW MUCH THEY SAY, RECONCILED TOO ──────────────────────────────────
   The prompt prints "HOW MUCH YOU SAY" on the line AFTER the imperative, so
   it is the last word the model reads. For DISCLOSURE.NONE it reads "does
   not answer this. They deflect, or say it is not something they would get
   into" -- which on the 22 measured turns where the ledger had granted a
   fact and the reaction policy still said NONE would simply overrule the
   line above it. Correcting only the imperative would move the contradiction
   one line down into the stronger position.
   PARTIAL, never FULL: the ledger has earned them the right to answer, not a
   reason to be forthcoming. A reluctant prospect answers briefly and stops. */
function allowanceIfAnswerable(reaction) {
  return disclosurePhrase(reaction && reaction.disclosure === DISCLOSURE.NONE
    ? DISCLOSURE.PARTIAL : (reaction && reaction.disclosure));
}

/* ── ONE AUTHORITY PER TURN ──────────────────────────────────────────────
   The ledger decides what this prospect MAY say; the behaviour engine decides
   what they DO. Both have now spoken, so this picks the single instruction
   that is true of the turn. The caller assigns the result back onto the turn,
   which is what keeps the string the model is given and the string that is
   persisted identical -- there is no second copy anywhere.
   MUST be called after any hangup candidate is resolved: resolveHangupCandidate
   re-derives the whole turn through buildTurn, so a choice made before it
   would be silently discarded. */
export function reconcileTurnWithDisclosure(turn, disclosure) {
  const offered = !!(disclosure && Array.isArray(disclosure.offer) && disclosure.offer.length);
  if (!turn || !offered) return { turn, disclosure };

  /* ── A REFUSAL WITHDRAWS THE GRANT, IT DOES NOT SPEND IT ──────────────
     The offer block is itself an imperative -- disclosure-ledger.js prints
     "Work the SUBSTANCE of exactly ONE of these into your reply" ABOVE this
     turn's instruction -- so a branch that is ending the call, holding an
     objection, reacting to being pushed or disputing an assertion would
     otherwise carry two orders that contradict each other, with the refusal
     merely last rather than alone.
     Worse, the ids are round-tripped as `alreadySaid` and treated as spent,
     so a fact granted on such a turn is burned WITHOUT EVER BEING SPOKEN and
     can never be offered again -- the ledger drains into silence, which is
     the repetition failure it exists to remove. Withdrawing returns it to
     `withheld`, where a later, better question can still earn it. */
  if (turn.refusesToAnswer) {
    return {
      turn,
      disclosure: {
        ...disclosure,
        offer: [],
        withheld: [...(disclosure.withheld || []), ...disclosure.offer.map((f) => f.id)],
        reason: 'granted_but_the_prospect_is_not_answering_this_turn',
      },
    };
  }

  if (!turn.responseInstructionIfOffered) return { turn, disclosure };
  return {
    turn: {
      ...turn,
      responseInstruction: turn.responseInstructionIfOffered,
      informationAllowed: turn.informationAllowedIfOffered || turn.informationAllowed,
    },
    disclosure,
  };
}

/* ── THE SIMULATION BOUNDARY ──────────────────────────────────────────
   Facts invented during rehearsal are marked at creation and there is no
   function here that returns them in a shape anything durable would accept. */
export function simulatedFact(text) {
  return { text: String(text || ''), simulated: true, source: 'practice_simulation', durable: false };
}
export function factsSafeToPersist(facts) {
  /* Deliberately always empty for simulated facts: the caller cannot opt in. */
  return (facts || []).filter((f) => f && f.simulated !== true && f.durable === true);
}
