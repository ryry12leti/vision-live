/* ════════════════════════════════════════════════════════════════════════
   PHASE 4 WP-4 — THE WHITELIST EXPLANATION

   Turns a persisted TrainingObjective into plain language, from EXACTLY the
   fields a founder may see and nothing else. `explainObjective()` takes
   `{skill, track, intent, rationale}` -- never `constraints`, never
   `scenario`, never a raw mastery observation. The scenario object is not
   merely filtered out here; it is never passed to this function by any
   caller, so there is nothing in scope to leak by a future edit forgetting
   a field. The same structural defence `publicScenario()` already uses.

   NOTHING HERE IS REGENERATED FROM LIVE STATE. Every input comes from the
   ONE persisted `practice_training_objectives` row for that session --
   never a fresh call to selectObjective(), never a fresh business-context
   read. A refresh or reopen reads the same row and gets the same
   explanation, because there is only one source for it to read.

   THE BUSINESS LINE IS HONEST ABOUT ITS OWN SCOPE. WP-2's own
   businessFrequency() only modulates ONE of the six skills
   (authority_and_routing) -- every other skill is shape-neutral by design,
   documented in training-objective.js itself. Showing a confident
   business-shaped reason for the other five would claim a connection that
   was never used to select them. The business line therefore appears ONLY
   for authority_and_routing, and even there it says "VISION does not know
   enough yet" when the shape is 'unknown' rather than inventing a reason.

   Pure. No I/O, no clock, no randomness.
   ══════════════════════════════════════════════════════════════════════ */

export const EXPLANATION_VERSION = 'practice_training_explanation_v1';

/* Matches li-practice-progress.js's own MASTERY_LABEL exactly, on purpose
   -- a founder seeing "Handling objections" on the Mastery panel and a
   different phrase here for the same skill would read as two products
   disagreeing about their own vocabulary. That file is a classic script,
   not an ES module, so it cannot be imported here; keep these in sync by
   hand if either changes. */
const SKILL_LABEL = Object.freeze({
  discovery: 'Discovery',
  listening_and_building: 'Listening and building',
  grounding_claims: 'Grounding what you claim',
  objection_handling: 'Handling objections',
  pitch_discipline: 'Pitch discipline',
  authority_and_routing: 'Reaching a decision-maker',
});

const TRACK_PHRASE = Object.freeze({
  buyer: 'on calls with a real buyer',
  non_buyer: "on calls that don't reach a buyer",
  live: 'on real calls',
});

/* Per-shape, per the exact honesty scope above -- ONLY consulted when
   skill === 'authority_and_routing'. */
const AUTHORITY_BUSINESS_LINE = Object.freeze({
  front_desk: 'Your business likely has someone else who could pick up first, so this comes up often.',
  small_team: 'With a few people around, this comes up sometimes, not every call.',
  solo: "You're usually the one who answers, so this comes up rarely — but it still matters on the calls where it does.",
  unknown: "VISION doesn't know enough about your business yet to say how often this comes up.",
});

function intentPhrase(intent, track) {
  const trackPhrase = TRACK_PHRASE[track] || TRACK_PHRASE.buyer;
  switch (intent) {
    case 'repair':
      return `VISION is giving you more practice here because your recent evidence ${trackPhrase} is limited.`;
    case 'reinforce':
      return `This is a strength — VISION is keeping it sharp with practice ${trackPhrase} so it stays that way.`;
    case 'cover':
      return `This hasn't come up enough yet ${trackPhrase} for VISION to know how you handle it.`;
    case 'maintain':
    default:
      return `A routine rep ${trackPhrase}, to keep things moving.`;
  }
}

/* Only when there is a real number to report -- never invented, never a
   score. `eligible` and `lastSeen` are the two facts a founder can already
   see on the Mastery panel itself; this is the same vocabulary, applied to
   why THIS call was chosen rather than to what was already demonstrated. */
function evidenceLine(rationale) {
  const basis = rationale && rationale.evidenceBasis;
  if (!basis || basis.eligible == null) return null;
  const n = Number(basis.eligible) || 0;
  if (n === 0) return null;
  return `Based on ${n} recent call${n === 1 ? '' : 's'}.`;
}

function businessLine(skill, rationale) {
  if (skill !== 'authority_and_routing') return null;
  const shape = rationale && rationale.businessBasis && rationale.businessBasis.shape;
  return AUTHORITY_BUSINESS_LINE[shape] || AUTHORITY_BUSINESS_LINE.unknown;
}

/* `{skill, track, intent, rationale}` -- the exact four columns
   practice_training_objectives persists beyond its hidden ones. Anything
   else on the argument object is ignored, not merely unused: this function
   never reads `.constraints`, `.role`, `.situationFamily` even if a caller
   passed the whole row by mistake. */
export function explainObjective({ skill, track, intent, rationale } = {}) {
  if (!skill || !SKILL_LABEL[skill]) return null;
  const label = SKILL_LABEL[skill];
  return Object.freeze({
    version: EXPLANATION_VERSION,
    headline: `Today's focus: ${label.toLowerCase()}.`,
    why: intentPhrase(intent, track),
    evidenceLine: evidenceLine(rationale),
    businessLine: businessLine(skill, rationale),
  });
}

/* ── THE REVIEW'S COPY OF THE FOCUS (Phase 5 WP-3) ──────────────────────
   What practice_score persists into result.review.trainingFocus: the same
   whitelisted explanation the founder saw when the call started, plus the
   three REFERENCE fields (skill/track/intent — the exact columns Phase 4
   persisted and already explains in prose) so the review's consequence
   card can match the session's own mastery observation without a second
   authority deciding which skill was trained. References, never rendered
   label strings: the skill key is the same public taxonomy name the
   Mastery panel already shows. Same structural whitelist as
   explainObjective — hidden columns are never read, so they cannot ride
   along. */
export function trainingFocusFor(row) {
  const explanation = explainObjective(row || {});
  if (!explanation) return null;
  return Object.freeze({
    ...explanation,
    skill: row.skill,
    track: row.track || null,
    intent: row.intent || null,
  });
}

export { SKILL_LABEL };
