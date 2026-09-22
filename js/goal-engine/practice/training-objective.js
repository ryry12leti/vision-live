/* ════════════════════════════════════════════════════════════════════════
   PHASE 4 WP-2 — WHY THIS SELLER NEEDS THIS SCENARIO

   Chooses a TRAINING OBJECTIVE -- one (skill, track) pair and a reason --
   BEFORE any scenario exists. Scoring is deterministic; the draw is a
   SEEDED SAMPLE, never argmax, for the same reason `selectScenario()`
   samples rather than picks a winner: an always-lowest-skill selector is a
   predictor a founder can learn, and a predictable trainer is not a trainer.

   THE BOUNDARY THIS FILE DOES NOT CROSS. It narrows a distribution; it
   never names an outcome. Its output is `constraints.roleTilt` -- a NUDGE
   DIRECTION, one of the three roles or null -- never a role assignment.
   `scenario-selection.js` is not imported for its selection machinery and
   is not modified: this file does not reimplement MAX_WEAKNESS_SHIFT, the
   probability floor, or the seeded draw that turns a tilt into an actual
   role. Those stay exactly where they are, exactly as tested. It reuses
   ONE proven, exported, pure function -- `businessShape()` -- because
   inventing a second business-size classifier beside an already-certified
   one would be the everything-looks-like-a-nail mistake, not caution.

   IT MAPS TO THE SIX PHASE 3 SKILLS AND NEVER TO A SCORED CATEGORY. An
   earlier draft of the locked architecture's own role-tilt table
   (`ROLE_FOR_WEAKNESS` in scenario-selection.js) is keyed by scored rubric
   categories -- three of which are the fairness-blocked axes Phase 3
   refuses to grade on. This file has its own, separate skill-to-role map,
   keyed by Phase 3's skill vocabulary, so a blocked axis has no path in.

   MASTERY IS READ IN THE EXACT SHAPE `practice_mastery_read_v1` RETURNS --
   snake_case top level (`current_reliability`, `demonstrated_level`,
   `basis`), so the real caller (WP-3) can pass the RPC result straight
   through with no adapter, and no adapter is a bug this project cannot
   afford to write twice. Only BANDED fields are read, never a raw
   observation or a raw transcript: repair need comes from
   `current_reliability`, never from re-deriving it, so Phase 3's own
   hysteresis (one poor call moves neither level, mutation-proven at T12)
   is inherited rather than re-implemented and possibly gotten wrong.

   Pure. No I/O, no clock, no randomness outside the injected seed.
   ══════════════════════════════════════════════════════════════════════ */
import { SKILLS } from './mastery-identity.js';
import { businessShape, ROLES } from './scenario-selection.js';

export const OBJECTIVE_VERSION = 'practice_training_objective_v1';
/* Reasoned, not calibrated -- the same honest position as Phase 3's
   PROJECTION_PARAM_V1 and WP-1's FRESHNESS_VERSION. No product data
   supports these five numbers today; bumping the version and re-deriving
   costs nothing, because nothing here is stored as truth -- it is
   recomputed from Phase 3's own projection on every call. */
export const OBJECTIVE_PARAM_VERSION = 'practice_objective_param_v1';

export const INTENT = Object.freeze({
  REPAIR: 'repair', REINFORCE: 'reinforce', COVER: 'cover', MAINTAIN: 'maintain',
});

/* PRACTICE SELECTS A TRAINING SCENARIO, NEVER A LIVE ONE. `live` track
   mastery may exist as informational context (Phase 3 keeps the door open
   for it), but Practice never GENERATES a live call -- a real call is
   diagnosed after the fact, not selected in advance -- so it is never a
   candidate track here. Widening this is a future phase's decision, not a
   silent default. */
const CANDIDATE_TRACKS = Object.freeze(['buyer', 'non_buyer']);

/* `business` was 0.4 in the first draft and was raised here after
   DIAGNOSING it against real fixture data, not by feel: at 0.4, a
   front-desk business and a solo-consultant business -- correctly
   classified, verified via founderBusinessShape() -- produced gatekeeper
   tilt within 12% of each other over 300 seeded draws. Business
   conditioning that weak is exactly the R3 risk (business context stays
   too coarse to matter), materialising for real rather than staying
   theoretical. At 1.2, front_desk vs solo produce a 1.7x gatekeeper-tilt
   ratio with the floor still intact -- material, not manufactured, and
   still bounded by FLOOR_BLEND below. */
const WEIGHTS = Object.freeze({
  repair: 1.0, reinforce: 0.5, cover: 0.9, business: 1.2, recency: 0.8,
});
/* Every candidate keeps at least this share of a uniform floor, blended
   into the softmax output -- the same discipline as scenario-selection.js's
   own MIN_PLAUSIBLE_PROBABILITY: uncertainty that can be argued to zero by
   the scoring terms above is not uncertainty. */
const FLOOR_BLEND = 0.12;
/* No skill may be the objective more than 3 times in any 6 consecutive
   objectives -- checked as "already 3 in the last 5", since drawing it once
   more would make 4 in 6. A hard exclusion from the candidate set, not a
   soft penalty: the additive `recency` term already nudges away from a
   repeatedly-picked skill, and this is the backstop that guarantees it. */
const HARD_CAP_WINDOW = 5;
const HARD_CAP_COUNT = 3;
/* A strong/reliable skill this long unused is fully due for reinforcement;
   the age factor saturates rather than growing without bound. */
const REINFORCE_SATURATION_DAYS = 21;

/* Phase 3's own skill vocabulary reused verbatim, never re-declared. */
export { SKILLS };

/* ── SKILL → ROLE, P4's OWN MAP, NOT scenario-selection.js's ───────────
   Mirrors the P1 mapping wherever a direct analogue exists (discovery,
   listening, objection handling, pitch discipline and routing all map the
   same way ROLE_FOR_WEAKNESS already did); grounding_claims has no P1
   analogue and is a stated judgement call -- a claim gets grounded or not
   mid-pitch, most often to the person who would actually buy. */
export const ROLE_FOR_SKILL = Object.freeze({
  discovery: 'decision_maker',
  listening_and_building: 'influencer',
  grounding_claims: 'decision_maker',
  objection_handling: 'decision_maker',
  pitch_discipline: 'gatekeeper',
  authority_and_routing: 'gatekeeper',
});
/* Every value is a role scenario-selection.js actually recognises, checked
   at module load rather than trusted -- a typo here would otherwise surface
   only much later, as a role tilt that WP-3's wiring silently drops. */
Object.values(ROLE_FOR_SKILL).forEach((r) => {
  if (!ROLES.includes(r)) throw new Error(`training_objective_unknown_role:${r}`);
});

/* ── BUSINESS FREQUENCY, DELIBERATELY THIN ─────────────────────────────
   Only ONE skill responds to business shape. Every other skill stays
   neutral across every shape -- not because the other five never vary by
   business, but because nothing in the reader's nine sections supports a
   defensible claim about how much they vary, and a false precision here is
   worse than an honest flat line. `authority_and_routing` is the one clear,
   textually-grounded exception: scenario-selection.js's own SHAPES table
   already asserts, and this codebase already tests, that a solo consultant
   essentially never has a gatekeeper (0.02) while a front-desk business
   almost always might (0.45) -- the same shape classifier, reused rather
   than re-derived, gives the same honest answer here. */
/* `unknown` is 1.0 -- the SAME value every OTHER skill implicitly uses
   for every shape (`businessFrequency`'s own fallback below). That equality
   is load-bearing: it is what makes "no business signal" genuinely neutral
   rather than silently boosting or suppressing authority_and_routing
   relative to the other five skills. front_desk and small_team sit ABOVE
   that true baseline (a genuine boost, not merely "not suppressed" -- an
   earlier version set front_desk to 1.0 too, which is mathematically a
   no-op: softmax responds only to score DIFFERENCES, and 1.0 next to every
   other skill's 1.0 moves nothing). solo sits below it, never at zero. */
const BUSINESS_FREQUENCY = Object.freeze({
  front_desk: { authority_and_routing: 1.7 },
  small_team: { authority_and_routing: 1.1 },
  unknown: { authority_and_routing: 1.0 },
  solo: { authority_and_routing: 0.15 },
});

function fnv1aUnit(seed) {
  const s = String(seed == null ? 'x' : seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

function ageDays(iso, now) {
  if (!iso || !now) return null;
  const then = Date.parse(iso); const n = Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(n)) return null;
  return Math.max(0, (n - then) / 86400000);
}

function stateFor(masteryStates, skill, track) {
  return (masteryStates || []).find((s) => s && s.skill === skill && s.track === track) || null;
}

/* Business shape is derived from the FOUNDER'S OWN description -- their
   offer, who they sell to, how they reach them -- fed through the exact
   same classifier scenario-selection.js already uses for a PROSPECT's
   description. Only sections that are actually KNOWN contribute text; an
   entirely-unknown context yields an empty description, and businessShape's
   own fallback already resolves that to 'unknown' honestly. */
export function founderBusinessShape(businessContext) {
  const s = (businessContext && businessContext.sections) || {};
  const known = (key) => (s[key] && s[key].status === 'known' ? s[key].value : null);
  const asText = (v) => (typeof v === 'string' ? v : (v && typeof v.notes === 'string' ? v.notes : ''));
  const description = [known('offer'), known('targetCustomer'), known('outreachChannel')]
    .map(asText).filter(Boolean).join(' ');
  return businessShape({ description });
}

function repairNeed(state) {
  if (!state) return 0;
  if (state.confidence === 'low') return 0;
  if (state.current_reliability === 'developing') return 1.0;
  if (state.current_reliability === 'inconsistent') return 0.6;
  return 0;
}

function reinforceValue(state, now) {
  if (!state) return 0;
  if (state.current_reliability !== 'strong' && state.current_reliability !== 'reliable') return 0;
  const lastSeen = state.basis && state.basis.lastSeen;
  const age = ageDays(lastSeen, now);
  /* No lastSeen at all should not happen once a skill is graded, but a
     missing signal is treated as maximally due rather than assumed recent --
     the safe direction when the data does not say. */
  const ageFactor = age == null ? 1 : Math.min(1, age / REINFORCE_SATURATION_DAYS);
  const base = state.current_reliability === 'strong' ? 1.0 : 0.7;
  return base * ageFactor;
}

/* Scoped deliberately to the binary "not yet gradable" case. A graded
   skill's under-testing (high opportunityAbsent within a real band) is a
   real but SEPARATE signal this term does not also chase -- repair and
   reinforce already own every graded skill, and layering a second coverage
   signal on top risks double-counting the same evidence two ways. */
function coverageDebt(state) {
  if (!state) return 1;
  return state.current_reliability === 'insufficient_evidence' ? 1 : 0;
}

function businessFrequency(skill, shape) {
  const table = BUSINESS_FREQUENCY[shape] || BUSINESS_FREQUENCY.unknown;
  return table[skill] != null ? table[skill] : 1;
}

function recencyPenalty(skill, recentObjectives) {
  const recent = (recentObjectives || []).slice(-HARD_CAP_WINDOW);
  const count = recent.filter((o) => o && o.skill === skill).length;
  return count / HARD_CAP_WINDOW;
}

function hardCapped(skill, recentObjectives) {
  const recent = (recentObjectives || []).slice(-HARD_CAP_WINDOW);
  return recent.filter((o) => o && o.skill === skill).length >= HARD_CAP_COUNT;
}

/* One evidence-derived reason, and the dominant term that produced it --
   `constraints`/`rationale` carry the FACTS an explanation can later be
   built from; they carry no scenario detail, because none exists yet. */
function intentFor(terms) {
  if (terms.repair > 0) return INTENT.REPAIR;
  if (terms.cover > 0) return INTENT.COVER;
  if (terms.reinforce > 0) return INTENT.REINFORCE;
  return INTENT.MAINTAIN;
}

function objectiveId(seed, skill, track) {
  const basis = `${seed || 'no-seed'}|${skill}|${track}`;
  return `to_${fnv1aUnit(basis).toString(36).slice(2, 10)}${fnv1aUnit(`1${basis}`).toString(36).slice(2, 10)}`;
}

/* ── THE SELECTOR ───────────────────────────────────────────────────────
   `masteryStates`: practice_mastery_read_v1('current').states, unmodified.
   `businessContext`: business-context.js's businessContextFor() output.
   `recentObjectives`: prior objectives for THIS user, oldest first, as
     `{skill, track, intent, selectedAt}` -- the smallest shape the anti-loop
     cap and recency term need; a full objective works too, extra fields
     are ignored.
   `seed`: stable per call (the session id) so the same inputs always
     redraw the same objective -- controlled uncertainty, not chaos.
   `now`: injected ISO timestamp. */
export function selectObjective({
  masteryStates = [], businessContext = null, recentObjectives = [], seed = null, now,
} = {}) {
  if (!now) throw new Error('select_objective_without_now');
  const shape = founderBusinessShape(businessContext);

  let candidates = [];
  for (const skill of SKILLS) {
    if (hardCapped(skill, recentObjectives)) continue;
    for (const track of CANDIDATE_TRACKS) {
      const state = stateFor(masteryStates, skill, track);
      const terms = {
        repair: repairNeed(state),
        reinforce: reinforceValue(state, now),
        cover: coverageDebt(state),
        business: businessFrequency(skill, shape),
        recency: recencyPenalty(skill, recentObjectives),
      };
      const score = WEIGHTS.repair * terms.repair + WEIGHTS.reinforce * terms.reinforce
        + WEIGHTS.cover * terms.cover + WEIGHTS.business * terms.business
        - WEIGHTS.recency * terms.recency;
      candidates.push({ skill, track, state, terms, score });
    }
  }
  /* The hard cap can exclude at most one skill from a 5-length recent
     window (3+3 > 5), so this can only be empty if SKILLS or
     CANDIDATE_TRACKS is itself empty -- a configuration error, not a
     reachable runtime state, and NOT silently patched over. */
  if (!candidates.length) throw new Error('select_objective_no_candidates');

  /* Softmax, then blended with a uniform floor so nothing is ever
     certain to be excluded, mirroring scenario-selection.js's own
     normalise-then-floor discipline. */
  const exp = candidates.map((c) => Math.exp(c.score));
  const total = exp.reduce((a, b) => a + b, 0);
  const n = candidates.length;
  const probs = exp.map((e) => (1 - FLOOR_BLEND) * (e / total) + FLOOR_BLEND * (1 / n));
  const probTotal = probs.reduce((a, b) => a + b, 0);

  let point = fnv1aUnit(`${seed == null ? 'no-seed' : seed}::objective`) * probTotal;
  let winner = candidates[candidates.length - 1];
  for (let i = 0; i < candidates.length; i += 1) {
    point -= probs[i];
    if (point <= 0) { winner = candidates[i]; break; }
  }

  const intent = intentFor(winner.terms);
  const roleTilt = intent === INTENT.MAINTAIN && winner.terms.business === 1
    ? null /* nothing about this pick argues for any particular role */
    : (ROLE_FOR_SKILL[winner.skill] || null);

  return Object.freeze({
    objectiveId: objectiveId(seed, winner.skill, winner.track),
    version: OBJECTIVE_VERSION,
    paramVersion: OBJECTIVE_PARAM_VERSION,
    skill: winner.skill,
    track: winner.track,
    intent,
    rationale: Object.freeze({
      evidenceBasis: winner.state ? Object.freeze({
        currentReliability: winner.state.current_reliability,
        demonstratedLevel: winner.state.demonstrated_level,
        eligible: (winner.state.basis && winner.state.basis.eligible) ?? null,
        lastSeen: (winner.state.basis && winner.state.basis.lastSeen) ?? null,
      }) : null,
      businessBasis: Object.freeze({ shape }),
    }),
    constraints: Object.freeze({ roleTilt }),
    selectedAt: now,
  });
}
