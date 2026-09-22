/* ════════════════════════════════════════════════════════════════════════
   WHO ANSWERS, AND WHAT KIND OF CALL IT IS. DECIDED ON THE SERVER, ONCE.

   The founder knows the prospect, why VISION chose them, and both plans.
   They must not know who picks up. That is the whole product claim, and it
   survives exactly as long as the selection is (a) plausible, (b) genuinely
   uncertain, and (c) never visible.

   PLAUSIBLE, NOT RANDOM. A solo consultant does not have a receptionist.
   Giving every business a gatekeeper because gatekeepers are interesting
   would teach founders to expect one, which is the same failure as never
   giving them one.

   UNCERTAIN, WITH BOUNDED STEERING. VISION may lean toward a founder's
   weaknesses and away from what they just practised -- but only a little,
   and the caps are the point. The review screen already tells a founder what
   their weakest category is, so unbounded steering hands them the input to a
   predictor the product built for them. Randomness has to dominate or §3
   quietly defeats §11.

   NEVER A ROTATION. No counter, no cycle, no "you have not had a gatekeeper
   for a while so here is one". Recency nudges a weight; it can never force a
   draw. A founder who works out the pattern is practising VISION.

   NEVER VISIBLE. `publicScenario()` is the only thing that may leave the
   server, and it deliberately returns almost nothing. Everything else --
   role, axes, every weight that produced them -- is server-side state, and
   §14 forbids it reaching the client or the score.
   ══════════════════════════════════════════════════════════════════════ */
import { drawVariation, CALL_VARIATION_VERSION } from './call-variation.js';

import { roleTiltOf, resolveIntensity } from './practice-intensity.js';

export const SCENARIO_VERSION = 'practice_scenario_v1';

export const ROLES = Object.freeze(['gatekeeper', 'influencer', 'decision_maker']);

/* ── CAPS, FROM THE LOCKED DESIGN ─────────────────────────────────────
   Binding. Weakness may move a role's probability by at most 15 points and
   recency by at most 10, from the plausibility baseline. Together they can
   never exceed the floor below, so no plausible role is ever ruled out and
   no role is ever certain. */
export const MAX_WEAKNESS_SHIFT = 0.15;
export const MAX_RECENCY_SHIFT = 0.10;
/* Nothing plausible ever drops below this. Uncertainty that can be argued
   down to zero is not uncertainty. */
export const MIN_PLAUSIBLE_PROBABILITY = 0.05;

/* ── PLAUSIBILITY ─────────────────────────────────────────────────────
   From what VISION actually knows about the business, and from nothing else.
   Where it knows nothing, the distribution says so rather than inventing a
   front desk. */
const SHAPES = Object.freeze({
  /* Somebody's job is to answer that phone. */
  front_desk: Object.freeze({ gatekeeper: 0.45, influencer: 0.25, decision_maker: 0.30 }),
  /* One person, who is also the owner, the receptionist and the accounts
     department. A gatekeeper here is an answering service, which happens --
     rarely, and DELIBERATELY below MIN_PLAUSIBLE_PROBABILITY. The floor
     exists so uncertainty is never argued away; it must not be able to make
     a business into something it is not. One solo consultant in twenty
     answering through a receptionist is not a hard call, it is a wrong one. */
  solo: Object.freeze({ gatekeeper: 0.02, influencer: 0.04, decision_maker: 0.94 }),
  /* Enough people that it might not be the owner, not enough for reception. */
  small_team: Object.freeze({ gatekeeper: 0.15, influencer: 0.35, decision_maker: 0.50 }),
  unknown: Object.freeze({ gatekeeper: 0.20, influencer: 0.30, decision_maker: 0.50 }),
});

const FRONT_DESK = /\b(clinic|vet|veterinar|dental|dentist|doctor|surgery|practice|salon|spa|barber|garage|dealership|restaurant|hotel|gym|leisure|physio|chiroprac|optician|pharmac|estate agen|letting|law firm|solicitor|accountan)\w*/i;
const SOLO = /\b(solo|freelance|freelancer|independent|sole trader|one[- ]person|self[- ]employed|consultant|coach)\w*/i;

/* Size beats words. A "consultancy" with forty staff has a front desk and a
   "dental practice" run alone does not, so an explicit headcount is trusted
   over anything the description says. */
export function businessShape(prospect = {}) {
  const size = Number(prospect.headcount ?? prospect.employees ?? NaN);
  if (Number.isFinite(size)) {
    if (size <= 1) return 'solo';
    if (size >= 12) return 'front_desk';
    return 'small_team';
  }
  const descriptive = [prospect.businessType, prospect.category, prospect.industry,
    prospect.description].filter((v) => typeof v === 'string').join(' ');
  /* P1-5: THE NAME IS EVIDENCE, AND IT WAS THE ONLY EVIDENCE THERE WAS.
     This read four descriptive fields and ignored `prospect.name`, so
     "Ardley Veterinary Clinic" and "Lumina Dental Clinic Sydney" -- names
     containing three separate FRONT_DESK terms between them -- resolved to
     `unknown` and were modelled as businesses that might not have a front
     desk at all. Measured over 2000 seeds, that is gatekeeper 20.6% where
     the shape they actually are gives 46.0%: the role was under-drawn for
     precisely the businesses most certain to have one.
     disclosureLedger's domainOf() has always read the name for exactly this
     purpose, so the two files disagreed about what describes a business.

     THE NAME IS USED FOR A POSITIVE SIGNAL ONLY. An unrecognised name is not
     evidence of size, so it must not turn `unknown` into `small_team` --
     that would quietly LOWER gatekeeper (0.20 -> 0.15) for every business
     whose name says nothing, which is the opposite of the intent. Only the
     descriptive fields can imply a size we were not told. */
  const text = [descriptive, typeof prospect.name === 'string' ? prospect.name : '']
    .filter(Boolean).join(' ');
  if (!text.trim()) return 'unknown';
  if (SOLO.test(text)) return 'solo';
  if (FRONT_DESK.test(text)) return 'front_desk';
  return descriptive.trim() ? 'small_team' : 'unknown';
}

export function plausibilityFor(prospect = {}) {
  return { ...SHAPES[businessShape(prospect)] };
}

/* ── STEERING, BOUNDED ────────────────────────────────────────────────
   Which role most exercises a weak skill. Not a claim that the skill is only
   testable there -- a claim about where it is MOST testable, used only to
   nudge. */
const ROLE_FOR_WEAKNESS = Object.freeze({
  routing: 'gatekeeper',
  pitchDiscipline: 'gatekeeper',
  qualification: 'influencer',
  listening: 'influencer',
  discovery: 'decision_maker',
  objectionHandling: 'decision_maker',
  pitchTiming: 'decision_maker',
  close: 'decision_maker',
  opening: null,
  grounding: null,
});

/* ── A KNOWN REAL CONTACT OUTRANKS THE HIDDEN DRAW ────────────────────
   Business truth beats simulation state. Hidden state may make this person
   distracted, guarded, hostile or in a hurry; it may NOT make a named
   receptionist the owner, or an owner a receptionist. The moment VISION
   actually knows who answers, the draw is constrained to roles compatible
   with that person, and the uncertainty moves to how they behave.

   ONLY WHEN AUTHORITY IS ESTABLISHED. `authorityKnown` is the lead's own
   flag (`bestContact.roleAuthorityKnown`), and the leads rail says plainly
   what its absence means: "Title as published. Whether they can approve this
   is not established." A published job title is NOT knowledge of authority,
   so an unknown or unrecognised contact leaves every role in play exactly as
   before -- this narrows the draw where there is truth to narrow it with,
   and changes nothing where there is not. */
const DECIDES = /\b(owner|founder|co-?founder|proprietor|principal|partner|director|managing director|md|ceo|coo|cto|cfo|president|chair(man|woman|person)?|head of)\b/i;
const DOES_NOT_DECIDE = /\b(receptionist|front desk|front of house|secretary|assistant|admin|administrator|administrative|clerk|coordinator|scheduler|dispatcher)\b/i;

/**
 * What the business actually knows about this contact's authority.
 *
 * @returns {'decides'|'does_not_decide'|null} null means UNKNOWN -- either
 *          authority was never established, or the title is one this does not
 *          recognise. Both fail OPEN to the existing full role variation,
 *          because a guess about a real person is worse than a hidden draw.
 */
export function knownAuthorityOf(contactRole) {
  if (!contactRole || contactRole.authorityKnown !== true) return null;
  /* THE JOB TITLE ONLY. `kind` is deliberately NOT read: it is the CONTACT
     CHANNEL (`contactKind` -- person/business, generic mailbox), not a
     statement about the person, and reading it inverts the answer for a real
     shape. An owner reached through an admin@ mailbox is still the owner, and
     because a non-deciding word wins the tie below, folding `kind` in would
     have demoted them. */
  const text = typeof contactRole.role === 'string' ? contactRole.role : '';
  if (!text.trim()) return null;
  /* A non-deciding title wins a tie: "receptionist to the managing director"
     is a receptionist, and crediting the borrowed word would produce exactly
     the contradiction this exists to prevent. */
  if (DOES_NOT_DECIDE.test(text)) return 'does_not_decide';
  if (DECIDES.test(text)) return 'decides';
  return null;
}

/* Which hidden roles can still be true of that person. A known decision
   maker cannot be a gatekeeper or an influencer without the simulation
   contradicting the record; a known receptionist cannot be the decision
   maker. Influencer stays available to a non-deciding contact because
   "involved but does not sign it off" is compatible with the title. */
export function allowedRoles(contactRole) {
  const known = knownAuthorityOf(contactRole);
  if (known === 'decides') return ['decision_maker'];
  if (known === 'does_not_decide') return ['gatekeeper', 'influencer'];
  return ROLES.slice();
}

/* Applied to the base AND again after steering: `steer` adds a flat
   MAX_WEAKNESS_SHIFT to its target role, which would otherwise resurrect a
   role the known contact rules out. */
function maskRoles(weights, allowed) {
  const out = {};
  ROLES.forEach((r) => { out[r] = allowed.includes(r) ? (weights[r] || 0) : 0; });
  return out;
}

const clampShift = (n, cap) => Math.max(-cap, Math.min(cap, n));

/* Weakness pulls TOWARD a role. Recency pushes AWAY from what was just
   practised -- and is deliberately weaker, because recency is the axis that
   turns into a rotation if you let it. */
function steer(base, { weakestCategory = null, recentRoles = [] } = {}) {
  const out = { ...base };
  const target = ROLE_FOR_WEAKNESS[weakestCategory] || null;
  if (target && out[target] != null) {
    out[target] += clampShift(MAX_WEAKNESS_SHIFT, MAX_WEAKNESS_SHIFT);
  }
  /* Only the LAST few calls, and only a nudge each. A long history of
     gatekeepers must not drive the weight to zero. */
  const recent = (recentRoles || []).slice(-3);
  recent.forEach((role, i) => {
    if (out[role] == null) return;
    /* The most recent call counts most, and the three together cannot exceed
       the cap. */
    out[role] -= clampShift(MAX_RECENCY_SHIFT / (recent.length - i), MAX_RECENCY_SHIFT);
  });
  return out;
}

/* NORMALISE FIRST, THEN FLOOR, THEN GIVE BACK THE DIFFERENCE. Flooring
   before normalising does not work and my first version did exactly that:
   a five-person firm pushed by three recent gatekeepers came out at 0.0476
   against a floor of 0.05, because dividing by the total pulled the floored
   value straight back under it. The floor has to be applied to the finished
   distribution, and the room for it taken from the roles that have it.

   A role the business makes essentially impossible keeps its own tiny
   baseline rather than being raised to the floor -- plausibility outranks
   uncertainty, or a solo consultant gets a receptionist one call in twenty. */
function normalise(weights, base) {
  const raw = {};
  ROLES.forEach((r) => { raw[r] = Math.max(0, weights[r] || 0); });
  const total = ROLES.reduce((a, r) => a + raw[r], 0);
  if (total <= 0) return { ...base };
  const out = {};
  ROLES.forEach((r) => { out[r] = raw[r] / total; });

  /* The floor a role is entitled to: the shared minimum if the business
     makes it plausible at all, otherwise its own baseline and no more. */
  const floorFor = (r) => ((base[r] || 0) >= MIN_PLAUSIBLE_PROBABILITY
    ? MIN_PLAUSIBLE_PROBABILITY : (base[r] || 0));

  const short = ROLES.filter((r) => out[r] < floorFor(r));
  if (!short.length) return out;
  const owed = short.reduce((a, r) => a + (floorFor(r) - out[r]), 0);
  const donors = ROLES.filter((r) => !short.includes(r));
  const donorTotal = donors.reduce((a, r) => a + out[r], 0);
  if (donorTotal <= owed) return out;      /* nothing to give; leave it alone */
  short.forEach((r) => { out[r] = floorFor(r); });
  donors.forEach((r) => { out[r] -= owed * (out[r] / donorTotal); });
  return out;
}

function seededUnit(seed) {
  const s = String(seed == null ? 'x' : seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/* ── DIFFICULTY TILTS PLAUSIBILITY. IT DOES NOT PICK A ROLE ───────────
   Applied to the BASE weights, before steering and before normalising, so
   every existing invariant still decides the outcome: a business shape that
   makes a role near-impossible keeps its own tiny baseline (normalise()'s
   floorFor deliberately refuses to raise it to the shared floor), so a solo
   trader's 0.02 gatekeeper weight is ~0.04 at Brutal and still essentially
   never drawn. Difficulty makes an ambiguous authority MORE LIKELY WHERE IT
   WAS ALREADY POSSIBLE -- it cannot invent a receptionist for a one-man
   business, and it cannot make any role certain, which is what keeps the
   hidden role unpredictable rather than a readout of the dial. */
function tilt(base, intensity) {
  if (!intensity) return base;
  const by = roleTiltOf(intensity);
  const out = { ...base };
  ROLES.forEach((r) => {
    const mult = by[r] == null ? 1 : by[r];
    const b = Math.max(0, out[r] || 0);
    /* AN IMPLAUSIBLE ROLE CAN ONLY BE TILTED DOWN. Measured: without this,
       Brutal raised a solo trader's gatekeeper weight from 0.02 to 0.061 and
       drew a receptionist for a one-man business 22 times in 400 seeds --
       one call in eighteen, which is the precise outcome normalise() was
       written to prevent. Difficulty may amplify an ambiguity the business
       actually has; it may not manufacture one it does not. */
    out[r] = b < MIN_PLAUSIBLE_PROBABILITY ? Math.min(b, b * mult) : b * mult;
  });
  return out;
}

export function roleWeights(prospect = {}, history = {}, intensity = null, contactRole = null) {
  const allowed = allowedRoles(contactRole);
  const base = maskRoles(tilt(plausibilityFor(prospect), resolveIntensity(intensity)), allowed);
  /* Every SHAPE gives all three roles a positive weight, so this cannot fire
     today -- but normalise() returns the base unchanged on a zero total, and
     an all-zero distribution would fall through the draw loop to the LAST
     role, which is `decision_maker`. That is precisely the contradiction
     being prevented, so it is closed here rather than left to arithmetic. */
  if (ROLES.reduce((a, r) => a + base[r], 0) <= 0) {
    const even = {};
    ROLES.forEach((r) => { even[r] = allowed.includes(r) ? 1 / allowed.length : 0; });
    return even;
  }
  return normalise(maskRoles(steer(base, history), allowed), base);
}

/**
 * THE HIDDEN SCENARIO. Server-side only, for the whole call.
 *
 * @param {object} input
 * @param {object} input.prospect  what VISION knows about the business
 * @param {object} input.history   { weakestCategory, recentRoles }
 * @param {string} input.seed      stable per call -- the session id
 * @param {object} input.contactRole  the REAL contact, when one is known --
 *        `{ role, kind, authorityKnown }` from the lead's bestContact
 */
export function selectScenario({
  prospect = {}, history = {}, seed = null, intensity = null, contactRole = null,
} = {}) {
  const weights = roleWeights(prospect, history, intensity, contactRole);
  let point = seededUnit(`${seed == null ? 'no-seed' : seed}::role`);
  let role = ROLES[ROLES.length - 1];
  for (const r of ROLES) {
    point -= weights[r];
    if (point <= 0) { role = r; break; }
  }
  return Object.freeze({
    version: SCENARIO_VERSION,
    variationVersion: CALL_VARIATION_VERSION,
    role,
    shape: businessShape(prospect),
    variation: drawVariation({ role, seed }),
    /* Kept for replay and for owner diagnostics. NEVER projected. */
    weights: Object.freeze({ ...weights }),
  });
}

/* ── THE ONLY THING THAT MAY LEAVE THE SERVER ─────────────────────────
   Not a filter over the scenario -- a separate, tiny object built from
   scratch. A denylist would leak the first field somebody adds and forgets;
   this leaks nothing by construction, because there is nothing in it.

   `hasScenario` exists so the client can tell a Controlled Uncertainty call
   from a legacy one without learning anything about it. */
export function publicScenario(scenario) {
  return Object.freeze({ hasScenario: !!scenario, version: scenario ? scenario.version : null });
}

/* What a scenario must never contain by the time it reaches a scoring
   producer. Exported so the seam contract and the leak test share one list
   rather than two that can drift. */
export const NEVER_PUBLIC = Object.freeze(['role', 'variation', 'weights', 'shape']);
