/* ════════════════════════════════════════════════════════════════════════
   GUIDED LIVE REACTION INTELLIGENCE

   Four founder-facing signals -- Patience, Trust, Interest, Engagement --
   read off state the behaviour engine already produces every turn. This
   file decides NOTHING about the prospect. It is a presentational lens on a
   verdict applyFounderAction already reached, exactly the relationship
   guided-coaching.js's evaluateTurn already has to the pause decision: the
   engine owns the psychology, this owns whether it is worth showing.

   THE FOUR SIGNALS, AND WHAT THEY ARE NOT THE SAME THING AS:

     PATIENCE     how close to walking away, given the rope they have left.
                  Derived from exitIntent, inverted (higher exitIntent is
                  worse, so patienceScore = 1 - exitIntent). Within an
                  ordinary turn exitIntent only ever rises -- nothing in
                  EFFECTS below reduces it -- so Patience mostly falls or
                  holds. It CAN recover: a hangup candidate the severity
                  judge forgives relieves exitIntent server-side before this
                  ever runs, and that shows up here as an ordinary rise
                  because this reads the state that already happened rather
                  than re-deriving anything. Not synthesised to always have
                  two directions -- a signal that cannot realistically
                  improve mid-call and is shown improving anyway is the
                  "fake arrow" the brief explicitly forbids.

     TRUST        state.trust, directly. Whether what was just said made the
                  prospect more or less willing to believe the next thing.

     INTEREST     whether the PROBLEM or the OFFER is becoming more real to
                  them -- needDiscovered (a need got uncovered) blended with
                  nextStepWillingness (they will act on it). Deliberately
                  NOT state.engagement: a prospect can explore an objection
                  at length (engagement climbs, trust climbs) while nothing
                  about the need or the next step moves at all, and a pitch
                  that lands moves nextStepWillingness hard while barely
                  touching engagement. See INTEREST_WEIGHT below for the
                  exact split and why it is not 50/50.

     ENGAGEMENT   state.engagement, directly. Whether they are still in the
                  conversation and giving the founder room to continue --
                  orthogonal to whether they are interested in anything yet.

   ONE REACTION AT A TIME. Every turn produces up to four deltas; only the
   single largest MEANINGFUL one is ever returned, which is what "a small
   live reaction area, not four permanent meters" means in practice. A tie
   is broken by SIGNAL_PRIORITY, not by insertion order, so the choice is
   deterministic and testable.

   PRESSURE'S INFLUENCE IS NEVER READ HERE. It does not need to be: pressure
   already scaled the raw state deltas before this file ever sees them
   (intensityEffectScale, applied inside applyFounderAction's bump()), so
   the SAME founder move produces a smaller delta at Easy and a larger one
   at Brutal automatically, and crosses (or does not cross) the
   significance threshold on its own. This module has no pressure-aware
   branch anywhere in it -- if it did, that would BE the fabricated
   reaction the brief warns against, dressed up as being "pressure-aware".
   Difficulty is the same story for Interest: needDiscoveryScale already
   throttled the needDiscovered gain upstream, so a harder problem produces
   a smaller Interest rise for the identical good question, and this file
   never asks what difficulty was set to.

   NOTHING HIDDEN IS EVER NAMED. Reason strings are keyed on
   classification.action -- a founder-visible fact, the move he just made --
   never on role, situation, pain, authority or any scenario field. No
   number is ever formatted into a reason string.
   ══════════════════════════════════════════════════════════════════════ */

export const GUIDED_REACTION_VERSION = 'practice_guided_reaction_v1';

export const SIGNAL = Object.freeze({
  PATIENCE: 'patience', TRUST: 'trust', INTEREST: 'interest', ENGAGEMENT: 'engagement',
});
export const DIRECTION = Object.freeze({ UP: 'up', DOWN: 'down' });

/* Ties broken toward the signal most urgent to a founder mid-call: losing
   patience outranks losing trust, which outranks a stalled interest, which
   outranks a dip in engagement. Not alphabetical, not insertion order --
   stated once here so a mutation that reorders it is visible as exactly
   that. */
export const SIGNAL_PRIORITY = Object.freeze([SIGNAL.PATIENCE, SIGNAL.TRUST, SIGNAL.INTEREST, SIGNAL.ENGAGEMENT]);

/* How much of a delta counts as worth interrupting a founder mid-call for.
   Calibrated against the engine's own EFFECTS table (prospect-behaviour.js):
   a single generic_question (engagement -0.02) or a lone objection_response
   (resistance +0.05, nothing else) must stay silent, while an
   unsupported_assumption (trust -0.25) or a landed pitch (nextStepWillingness
   +0.4) must fire. 0.08 sits between the two. */
export const SIGNIFICANCE_THRESHOLD = 0.08;

/* needDiscovered vs nextStepWillingness. Weighted toward the next step on
   purpose: an EARNED pitch moves nextStepWillingness by 0.4 (landed) or 0.15
   (offered) and barely touches needDiscovered at all, and "Interest rose
   when the offer connected" is the brief's own worked example -- a 50/50
   split left that delta under the significance threshold and Interest never
   fired on the one turn it exists to describe. A single good discovery
   question (needDiscovered +0.1..+0.2) still clears the bar on its own. */
const INTEREST_WEIGHT = Object.freeze({ needDiscovered: 0.45, nextStepWillingness: 0.55 });

const clamp01 = (n) => Math.max(0, Math.min(1, n));
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function scoreOf(signal, state) {
  const s = state || {};
  switch (signal) {
    case SIGNAL.PATIENCE: return 1 - clamp01(num(s.exitIntent));
    case SIGNAL.TRUST: return clamp01(num(s.trust));
    case SIGNAL.INTEREST: return clamp01(
      num(s.needDiscovered) * INTEREST_WEIGHT.needDiscovered
      + num(s.nextStepWillingness) * INTEREST_WEIGHT.nextStepWillingness);
    case SIGNAL.ENGAGEMENT: return clamp01(num(s.engagement));
    default: return 0;
  }
}

/* Exported so a test can assert the exact score a state maps to, rather
   than only the arrow a delta between two states produces. */
export function signalScores(state) {
  return Object.freeze({
    patience: scoreOf(SIGNAL.PATIENCE, state),
    trust: scoreOf(SIGNAL.TRUST, state),
    interest: scoreOf(SIGNAL.INTEREST, state),
    engagement: scoreOf(SIGNAL.ENGAGEMENT, state),
  });
}

/* ── WHY, IN PLAIN ENGLISH ─────────────────────────────────────────────
   Keyed [signal][direction][action], with a `generic` fallback so an
   unmapped or future founder_action still produces an honest sentence
   instead of a blank reaction or a crash. Every line describes the MOVE,
   never the prospect's hidden state. */
const REASONS = Object.freeze({
  [SIGNAL.PATIENCE]: {
    [DIRECTION.DOWN]: Object.freeze({
      pressure: 'You kept pushing after they answered.',
      repetition: "You asked something they'd already answered.",
      premature_pitch: 'You pitched before earning the right to.',
      irrelevant_opening: "That opening didn't land as relevant to them.",
      unsupported_assumption: 'That assumption cost you some goodwill.',
      close_request: 'You asked for time before they were ready.',
      hostile: 'That ended the call.',
      generic: 'That cost you some patience.',
    }),
    [DIRECTION.UP]: Object.freeze({
      generic: 'VISION gave you a beat back after that stumble.',
    }),
  },
  [SIGNAL.TRUST]: {
    [DIRECTION.DOWN]: Object.freeze({
      unsupported_assumption: 'You made a claim without enough grounding.',
      pressure: 'Pushing cost you some credibility.',
      premature_pitch: 'Pitching too soon read as self-interested.',
      irrelevant_opening: "That opening didn't read as being about them.",
      generic: 'That cost some credibility.',
    }),
    [DIRECTION.UP]: Object.freeze({
      grounded_observation: 'You grounded that in something real about them.',
      objection_exploration: 'You opened up their objection instead of talking past it.',
      high_value_follow_up: 'You built on what they actually said.',
      relevant_opening: 'You opened with something specific about them.',
      generic: 'That earned some credibility.',
    }),
  },
  [SIGNAL.INTEREST]: {
    [DIRECTION.DOWN]: Object.freeze({
      premature_pitch: 'That pitch landed before there was a reason for it.',
      generic: 'That made the offer feel less relevant.',
    }),
    [DIRECTION.UP]: Object.freeze({
      pitch: 'You connected the offer to a problem they revealed.',
      discovery_question: 'That opened up a real need.',
      high_value_follow_up: 'That opened up a real need.',
      close_request: "They're ready for a next step.",
      generic: 'That made the offer feel more relevant.',
    }),
  },
  [SIGNAL.ENGAGEMENT]: {
    [DIRECTION.DOWN]: Object.freeze({
      irrelevant_opening: "That opening didn't connect.",
      premature_pitch: 'They pulled back after that.',
      repetition: 'They pulled back after that.',
      generic: 'They pulled back a little.',
    }),
    [DIRECTION.UP]: Object.freeze({
      relevant_opening: 'You opened with something specific about them.',
      high_value_follow_up: 'You followed up directly on what they said.',
      discovery_question: 'You gave them room to keep talking.',
      grounded_observation: 'You gave them room to keep talking.',
      generic: 'They leaned back in.',
    }),
  },
});

function reasonFor(signal, direction, action) {
  const table = REASONS[signal][direction];
  return table[action] || table.generic;
}

const HEADLINE = Object.freeze({
  [SIGNAL.PATIENCE]: 'Patience', [SIGNAL.TRUST]: 'Trust',
  [SIGNAL.INTEREST]: 'Interest', [SIGNAL.ENGAGEMENT]: 'Engagement',
});
const ARROW = Object.freeze({ [DIRECTION.UP]: '↑', [DIRECTION.DOWN]: '↓' });

/**
 * THE ONE ENTRY POINT.
 *
 * @param {object} input
 * @param {object} input.before  prospect state before this founder turn
 * @param {object} input.after   prospect state after it (turn.prospectStateAfter)
 * @param {object} input.classification  { action, ... } -- turn.founderAction is enough
 * @param {string} input.format  'guided' | 'full_simulation' | anything else
 * @param {object} [input.authorityEvidence]  readAuthorityEvidence's own result, as of THIS
 *   turn's prospect reply -- caller-computed (this file stays transcript-blind), null if absent.
 * @returns {null | { signal, direction, headline, arrow, reason, delta }}
 */
/* ── WHAT THE FOUNDER DID TO THE MOMENT ───────────────────────────────
   Keyed on the interaction, not on the classifier label, because the
   label cannot see what it was answering. Every line names the founder's
   move and the prospect's own words -- never a number, never a threshold,
   never the hidden role or situation. */
const INTERACTION_REASON = Object.freeze({
  asked_to_wait: 'You ignored their request to wait.',
  said_busy: 'They told you they were short on time and you kept going.',
  set_boundary: 'They told you how to take this forward and you pushed past it.',
  refused: 'You pushed after they had already said no.',
  do_not_contact: 'They asked you to stop and you carried on.',
  objected: 'You talked past their objection instead of dealing with it.',
  no_authority: 'You kept selling to someone who told you they cannot decide.',
  offered_transfer: 'They offered to hand you on and you sold at them instead.',
  confused: 'They had not followed you and you carried on regardless.',
});
/* WP4: these two keys used to be picked straight off the raw, stateless
   lexical `move` -- no negation, no attribution, no memory of a transfer
   having since completed. `authorityEvidence` (readAuthorityEvidence,
   evidence-gates.js) is the validated, sequence-aware reader; when it has
   an opinion, ITS state picks the copy, authority first. When it does not
   -- absent, or genuinely no admissible evidence -- these two keys are
   NEVER read off the raw move either: a founder-facing sentence naming
   authority or routing must be evidence B validated, not a guess this file
   falls back to. The other seven causes are untouched. */
const AUTHORITY_DRIVEN_MOVES = new Set(['no_authority', 'offered_transfer']);
const fallbackReason = (i) => (i && i.pushedAfterRefusal ? 'You pushed after they had already said no.'
  : 'You carried on over something they had just asked of you.');
const interactionReason = (i, authorityEvidence) => {
  if (authorityEvidence) {
    if (authorityEvidence.authority.state === 'disclaimed' && !authorityEvidence.spentByTransfer) {
      return INTERACTION_REASON.no_authority;
    }
    if (authorityEvidence.routing.state === 'offered') return INTERACTION_REASON.offered_transfer;
  }
  const move = i && i.move;
  if (AUTHORITY_DRIVEN_MOVES.has(move)) return fallbackReason(i);
  return INTERACTION_REASON[move] || fallbackReason(i);
};

/* THE ONE LINE THAT IS ALLOWED TO SOUND URGENT. It is shown only when the
   engine's own callAtRisk is set, which is the same comparison against the
   same threshold that ends the call -- see applyFounderAction. */
export const CRITICAL_HEADLINE = 'Patience critical';
export const CRITICAL_REASON = 'They are close to ending the call.';

export function computeGuidedReaction({ before, after, classification, format,
  authorityEvidence = null } = {}) {
  /* GUIDED ONLY. Structurally this already never runs outside Practice's
     own client (Real Live Call has no code path that imports this file at
     all), but Full Simulation shares the exact same client surface and
     differs only by this one string -- so it is the one runtime check that
     actually has to hold, and it is checked first, before any state is
     even read. */
  if (format !== 'guided') return null;
  if (!before || !after) return null;
  /* THE CALL IS OVER OR THE FOUNDER WAS ABUSIVE. The ended-call screen
     already states the outcome authoritatively (li-practice-call.js's
     hungUpHtml); a live reaction under it would be redundant at best and,
     phrased as an ongoing signal, misleading at worst -- there is no more
     "next turn" for it to be feedback about. Mirrors decideReaction's own
     early return for the identical two conditions. */
  if (after.ended === true) return null;
  const action = (classification && classification.action) || null;
  if (action === 'hostile') return null;

  const beforeScores = signalScores(before);
  const afterScores = signalScores(after);
  const interaction = after.lastInteraction || null;
  /* Decided in the engine, against the same threshold that ends the call.
     Read, never re-derived: a surface that computed its own would be free
     to disagree with the prospect it is describing. */
  const atRisk = after.callAtRisk === true;

  /* ── CRITICAL ESCALATES THE HEADLINE, IT DOES NOT ERASE THE CAUSE ────
     The first cut replaced the reason with "They are close to ending the
     call", which is urgent and useless: it tells a founder the call is
     nearly gone and not what they did to get there, on the one turn the
     answer matters most. The headline carries the urgency; the reason
     keeps saying what caused it. The stock line is the fallback for the
     one case with no cause to name -- a quiet turn that is at risk from
     damage already done. */
  const emit = (signal, direction, reason, critical) => Object.freeze({
    version: GUIDED_REACTION_VERSION,
    signal,
    direction,
    headline: critical ? CRITICAL_HEADLINE : HEADLINE[signal],
    arrow: ARROW[direction],
    reason: reason || CRITICAL_REASON,
    critical: !!critical,
    /* Rounded, never raw -- this is for tests and owner diagnostics, not
       for formatting into founder-visible text. No caller may print it. */
    delta: Math.round((afterScores[signal] - beforeScores[signal]) * 100) / 100,
  });

  /* ── THE HIERARCHY ──────────────────────────────────────────────────
     Terminal and hostility already returned above. What is left, in the
     order a founder needs it:

       2. an ignored boundary, or pushing after a refusal
       3. major damage to patience or trust
       4. ordinary movement in any signal
       5. nothing worth interrupting them for

     Level 2 is checked BEFORE any delta is looked at, and that is the
     whole point of this rewrite. The founder who talked over "can you
     bear with me one second?" moved engagement +0.1, because his sentence
     ended in a question and the classifier priced the sentence. Ranking
     by delta size handed him "Engagement up: you gave them room to keep
     talking" for the exact behaviour he had come to practise stopping.
     Strong negative conversational evidence outranks a generic positive
     classifier effect, always -- never the other way round. */
  if (interaction && (interaction.ignoredBoundary || interaction.pushedAfterRefusal)) {
    return emit(SIGNAL.PATIENCE, DIRECTION.DOWN, interactionReason(interaction, authorityEvidence), atRisk);
  }

  const moved = [];
  SIGNAL_PRIORITY.forEach((signal) => {
    const delta = afterScores[signal] - beforeScores[signal];
    if (Math.abs(delta) >= SIGNIFICANCE_THRESHOLD) moved.push({ signal, delta });
  });

  /* A turn that did real damage is never reported as a good one, even
     when something else happened to rise on the same turn. */
  const damage = moved.filter((m) => m.delta < 0);
  const pool = damage.length ? damage : moved;
  let best = null;
  pool.forEach((m) => {
    /* SIGNAL_PRIORITY order is the tie-break, so the first of an equal
       pair wins by sitting earlier in the list. */
    if (!best || Math.abs(m.delta) > Math.abs(best.delta)) best = m;
  });

  /* ── CRITICAL IS AN ESCALATION, NOT A BANNER ────────────────────────
     Risk is a STATE: once the prospect is near the edge it stays true
     until the call ends or they recover. Rendering it on every later turn
     would put an identical warning on ten consecutive quiet turns, which
     is precisely the "constant stream of arrows" this module exists to
     avoid -- and a warning that never changes stops being read.

     So it is shown on the turn it BECOMES true, and again on any turn
     that makes it worse. A quiet turn while already at risk falls back to
     the ordinary rules, which will usually stay silent. */
  const newlyAtRisk = atRisk && before.callAtRisk !== true;
  const worsened = damage.length > 0;

  /* A quiet turn shows nothing -- unless this is the moment the call
     became recoverable-but-nearly-lost, which the founder cannot read off
     the transcript and most needs to know. */
  if (!best) return newlyAtRisk ? emit(SIGNAL.PATIENCE, DIRECTION.DOWN, null, true) : null;

  const direction = best.delta > 0 ? DIRECTION.UP : DIRECTION.DOWN;
  return emit(best.signal, direction,
    reasonFor(best.signal, direction, action || 'generic'),
    atRisk && (newlyAtRisk || worsened));
}
