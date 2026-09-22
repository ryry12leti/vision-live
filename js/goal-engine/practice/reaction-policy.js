/* ════════════════════════════════════════════════════════════════════════
   HOW THEY REACT — decided here, phrased somewhere else.

   The state engine already knew everything needed to make a prospect stop
   behaving like an answer machine. It just never asked itself the question.
   `informationAllowed` was three prose bands off `engagement` alone, handed
   to a model as a suggestion, and its lowest rung still ANSWERED:
   "answers minimally and does not elaborate". There was no way for a
   prospect to decline. So every legitimate question got a legitimate answer,
   forever, and thirty seconds in the founder knew what he was talking to.

   Two axes, and only two:

     DISCLOSURE   how much of what they know comes out
     INITIATIVE   whether anything comes back the other way

   They are orthogonal on purpose. "Dodge", "brush off" and "partial answer"
   are not three reactions, they are two axes read together, and modelling
   them as separate enum values is what makes a policy like this untestable.

   WHAT THIS FILE DOES NOT DECIDE, because something upstream already did:
   objections, refusals, hostility, hangups. Each of those is settled inside
   applyFounderAction before this runs. This defers to them and records that
   it deferred. A second opinion on a decided question is how the two-producer
   conflicts started last time.
   ══════════════════════════════════════════════════════════════════════ */

import { contentWords, contentOverlap } from './evidence-gates.js';
import { situationWillingnessShift } from './situation-state.js';

export const REACTION_POLICY_VERSION = 'practice_reaction_policy_v1';

export const DISCLOSURE = Object.freeze({
  NONE: 'none', PARTIAL: 'partial', FULL: 'full', VOLUNTEER: 'volunteer',
});
export const INITIATIVE = Object.freeze({
  NONE: 'none', CLARIFY: 'clarify', QUESTION_BACK: 'question_back', CHALLENGE: 'challenge',
});

/* WHY THEY SAID LITTLE. The founder is protected by exactly one of these,
   and it is not the flattering one. */
export const WITHHOLD_CAUSE = Object.freeze({
  /* They could have answered and chose not to. THE ONLY protecting cause. */
  PROSPECT_STATE: 'prospect_state',
  /* The question could not be answered as asked. The founder's own doing. */
  QUESTION_UNCLEAR: 'question_unclear',
  /* Nothing was asked, so nothing was withheld. */
  NOTHING_ASKED: 'nothing_asked',
  /* Some other layer had already ended the exchange. */
  UPSTREAM: 'upstream_authority',
});

/* Everything this policy stands down for, named so a test can prove it did. */
export const DEFERRED = Object.freeze({
  CALL_ENDED: 'call_ended', HOSTILITY: 'hostility', OBJECTION: 'objection',
});

/* ── WHAT ARE THEY BEING ASKED ABOUT ──────────────────────────────────
   The thing that separates a real person from an archetype. Skeptical is
   uniformly guarded: it challenges anything vague, whatever the subject.
   A REAL person is guarded SELECTIVELY -- they will happily confirm what
   anyone could look up, and go quiet the moment you ask about the numbers,
   the contract or who signs. Mood is not what decides it. Subject is.

   VISION already knows which is which and never used it: `evidence.observed`
   is what it verified from public sources, `unknowns` is what it explicitly
   could not find. Those two lists ARE the prospect's public/private line.

   Realistic mode only. The three archetypes are fixed characters and must
   keep behaving exactly as they always have. */
export const TOPIC = Object.freeze({
  PUBLIC: 'already_public', PRIVATE: 'commercially_private', NEUTRAL: 'neutral',
});
const PUBLIC_SHIFT = +0.15;
const PRIVATE_SHIFT = -0.18;

export function topicOf(text, context = {}) {
  const t = String(text || '');
  if (!t.trim()) return TOPIC.NEUTRAL;
  const unknowns = Array.isArray(context.unknowns) ? context.unknowns : [];
  const observed = (context.evidence && context.evidence.observed) || [];
  /* PRIVATE WINS A TIE. A question that touches both a verified fact and an
     open unknown is reaching for the unknown -- "you're rated 5, so how many
     patients a week is that?" is a question about the number, not the
     rating, and answering it as though it were public hands over the one
     thing the prospect had a reason to hold back. */
  const hitsUnknown = unknowns.some((u) => contentOverlap(u, t) >= 0.2);
  if (hitsUnknown) return TOPIC.PRIVATE;
  if (observed.some((o) => contentOverlap(o, t) >= 0.25)) return TOPIC.PUBLIC;
  return TOPIC.NEUTRAL;
}

export const topicShiftFor = (topic) => (topic === TOPIC.PUBLIC ? PUBLIC_SHIFT
  : (topic === TOPIC.PRIVATE ? PRIVATE_SHIFT : 0));

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/* ── WILLINGNESS ──────────────────────────────────────────────────────
   Not a new lever. A reading of four the engine already maintains, in the
   proportions the engine already treats them: engagement is how present
   they are, trust is whether the last thing landed, informationWillingness
   is the mode's disposition, and resistance subtracts from all of it.

   At turn one this scores receptive 0.60, skeptical and realistic 0.30,
   resistant 0.05 — which is the whole point. The same question already gets
   three different reactions before anybody has done anything.

   THE SITUATION TERM is read off `state.situation` directly rather than
   threaded through as another parameter, because the situation already
   lives on the same state object as engagement/trust/resistance -- it is
   turn-by-turn mutable state, not a mode property. Deliberately the
   smallest term here (see situationWillingnessShift's own bound): a
   Receptive prospect who is rushed must still be more willing than a
   Resistant one who is not, or situation would be doing mode's job. */
export function willingness(state = {}, mode = {}, topicShift = 0) {
  return clamp01(
    0.40 * num(state.engagement)
    + 0.30 * num(state.trust)
    + 0.30 * num(mode.informationWillingness)
    - 0.30 * num(state.resistance)
    + num(topicShift)
    + situationWillingnessShift(state.situation),
  );
}

/* ── A QUESTION THAT CANNOT BE ANSWERED AS ASKED ──────────────────────
   Deliberately narrow. Every line this matches is a line the founder should
   have asked better, and a prospect asking what they mean is the honest
   reaction — so this must never catch a good broad question, because the
   founder is NOT protected when it fires. Two questions at once, or a
   question with no subject in it, and nothing else. */
export function questionIsUnclear(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!/\?/.test(raw)) return false;
  /* Stacked questions: answering either one leaves the other hanging. */
  if ((raw.match(/\?/g) || []).length >= 2) return true;
  /* No subject. "How does that work?" names nothing the prospect can reach
     for. Note this is the same bar isWeakDiscovery uses to call a question
     weak, and that is not a coincidence: the reaction and the mark against
     the founder have to agree about which questions were unanswerable. */
  return contentWords(raw).length < 2;
}

/* ── DISCLOSURE ───────────────────────────────────────────────────────── */
function decideDisclosure({ state, mode, effects, founderAsked, unclear, topic }) {
  const shift = topicShiftFor(topic);
  const w = willingness(state, mode, shift);
  const because = [`willingness ${w.toFixed(2)}`];
  if (shift > 0) because.push('this is already public about them');
  if (shift < 0) because.push('this is the commercially private side');

  /* An answer to a fair question about their own objection is EARNED, and
     outranks the bands: this is the one move that already had a reveal flag
     on it before this file existed. */
  if (effects.reveal) {
    because.push('they were asked a fair question about their own position');
    return { disclosure: DISCLOSURE.FULL, because, w };
  }
  if (!founderAsked) {
    because.push('nothing was asked');
    return { disclosure: DISCLOSURE.NONE, because, w };
  }
  if (unclear) {
    because.push('the question could not be answered as asked');
    return { disclosure: DISCLOSURE.NONE, because, w };
  }
  /* VOLUNTEERING IS EARNED TWICE. Willing is not enough — nobody offers you
     more than you asked for until they have already accepted there is
     something to talk about and that you may talk about it. */
  if (w >= 0.55 && num(state.needDiscovered) >= 0.4 && state.pitchPermission === true) {
    because.push('willing, a need is on the table, and they let him pitch');
    return { disclosure: DISCLOSURE.VOLUNTEER, because, w };
  }
  if (w >= 0.45) { because.push('willing enough to answer properly'); return { disclosure: DISCLOSURE.FULL, because, w }; }
  if (w >= 0.22) { because.push('will give part of it'); return { disclosure: DISCLOSURE.PARTIAL, because, w }; }
  because.push('not willing to get into it');
  return { disclosure: DISCLOSURE.NONE, because, w };
}

/* ── INITIATIVE ───────────────────────────────────────────────────────
   Every branch here is a reaction to the turn that just happened. None of
   it fires on the weather. */
const OPENS_A_DOOR = Object.freeze(['discovery_question', 'high_value_follow_up',
  'pitch', 'grounded_observation', 'relevant_opening']);

function decideInitiative({ state, effects, classification, founderAsked, unclear, w }) {
  const action = classification.action;
  const because = [];

  /* Already the engine's call, and already phrased downstream. */
  if (effects.challenge) { because.push('he asserted something they did not say'); return { initiative: INITIATIVE.CHALLENGE, because }; }
  if (action === 'pressure') { because.push('he leaned on them'); return { initiative: INITIATIVE.CHALLENGE, because }; }
  /* THE OBJECTION LAYER OWNS THE MOUTH while an objection stands. Adding a
     second thing to say here is how a prospect ends up holding an objection
     and asking a friendly question in the same breath. */
  if (state.activeObjection) { because.push('an objection is still open'); return { initiative: INITIATIVE.NONE, because, deferredTo: DEFERRED.OBJECTION }; }
  if (founderAsked && unclear) { because.push('they cannot answer it as asked'); return { initiative: INITIATIVE.CLARIFY, because }; }
  /* A statement they see no point in gets asked what the point is. */
  if (!founderAsked && w < 0.25) { because.push('he said something and they do not see where it goes'); return { initiative: INITIATIVE.CLARIFY, because }; }
  /* INTEREST LOOKS LIKE CURIOSITY, not agreement. A prospect who has warmed
     up starts asking practical questions back — and that, not a longer
     answer, is what tells a founder he is getting somewhere. */
  if (founderAsked && num(state.engagement) >= 0.55 && num(state.trust) >= 0.5 && OPENS_A_DOOR.includes(action)) {
    because.push('engaged and trusting enough to want something back');
    return { initiative: INITIATIVE.QUESTION_BACK, because };
  }
  return { initiative: INITIATIVE.NONE, because };
}

/* ── THE DECISION ─────────────────────────────────────────────────────── */
export function decideReaction({ state = {}, mode = {}, classification = {}, effects = {},
  founderAsked = false, founderText = '', context = {} } = {}) {
  const base = { version: REACTION_POLICY_VERSION };

  /* NOTHING BELOW THIS LINE GETS A VOTE once the call is over or the founder
     was abusive. Both were decided by applyFounderAction, terminally. */
  /* ABUSE IS NAMED BEFORE THE ENDING IT CAUSED. Hostility always ends the
     call, so testing `ended` first left this branch unreachable and every
     abusive turn deferring to a generic "the call is over" — true, and
     useless to anything downstream asking why nothing was disclosed. */
  if (classification.action === 'hostile') {
    return { ...base, disclosure: DISCLOSURE.NONE, initiative: INITIATIVE.NONE,
      deferredTo: DEFERRED.HOSTILITY, because: ['he was abusive'],
      withholding: { withheld: false, cause: WITHHOLD_CAUSE.UPSTREAM, prospectCaused: false } };
  }
  if (state.ended === true) {
    return { ...base, disclosure: DISCLOSURE.NONE, initiative: INITIATIVE.NONE,
      deferredTo: DEFERRED.CALL_ENDED, because: ['the call is over'],
      withholding: { withheld: false, cause: WITHHOLD_CAUSE.UPSTREAM, prospectCaused: false } };
  }

  const unclear = founderAsked ? questionIsUnclear(founderText) : false;
  /* Only the derived mode reads the subject. The three archetypes are fixed
     characters and their behaviour must not move. */
  const topic = (mode.id === 'vision_realistic' && founderAsked && !unclear)
    ? topicOf(founderText, context) : TOPIC.NEUTRAL;
  const d = decideDisclosure({ state, mode, effects, founderAsked, unclear, topic });
  const i = decideInitiative({ state, effects, classification, founderAsked, unclear, w: d.w });

  const shortOfAnAnswer = d.disclosure === DISCLOSURE.NONE || d.disclosure === DISCLOSURE.PARTIAL;
  let cause = null;
  if (!founderAsked) cause = WITHHOLD_CAUSE.NOTHING_ASKED;
  else if (unclear) cause = WITHHOLD_CAUSE.QUESTION_UNCLEAR;
  else if (shortOfAnAnswer) cause = WITHHOLD_CAUSE.PROSPECT_STATE;

  return {
    ...base,
    disclosure: d.disclosure,
    initiative: i.initiative,
    topic,
    deferredTo: i.deferredTo || null,
    willingness: Math.round(d.w * 100) / 100,
    because: d.because.concat(i.because),
    withholding: {
      withheld: founderAsked && shortOfAnAnswer,
      cause,
      /* THE ONE FLAG SCORING IS ALLOWED TO READ. A founder is protected when
         a prospect who could have answered chose not to — and never when his
         own question was the reason nothing came back. Being wrong in that
         direction would excuse exactly the discovery this product exists to
         teach. */
      prospectCaused: founderAsked && shortOfAnAnswer && cause === WITHHOLD_CAUSE.PROSPECT_STATE,
    },
  };
}

/* ── WHAT THE MODEL IS TOLD ───────────────────────────────────────────
   Prose, because the model reads prose. The DECISION is the enum above;
   this is only its translation, and it is the last thing that happens. */
export function disclosurePhrase(disclosure) {
  if (disclosure === DISCLOSURE.VOLUNTEER) return 'may share a specific detail, and may add something they were not asked for';
  if (disclosure === DISCLOSURE.FULL) return 'may share a specific detail about how things work today';
  if (disclosure === DISCLOSURE.PARTIAL) return 'may answer briefly without volunteering more — part of it, not all of it';
  return 'does not answer this. They deflect, or say it is not something they would get into';
}

export function initiativePhrase(initiative) {
  if (initiative === INITIATIVE.CLARIFY) return 'Ask them what they actually mean before answering anything.';
  if (initiative === INITIATIVE.QUESTION_BACK) return 'Ask them a practical question back about what they just raised.';
  if (initiative === INITIATIVE.CHALLENGE) return 'Push back on what they just said.';
  return '';
}
