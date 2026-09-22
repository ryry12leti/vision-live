/* ════════════════════════════════════════════════════════════════════════
   WHAT IS ACTUALLY UNCERTAIN ABOUT THIS CALL.

   The hidden role is the smaller half of Controlled Uncertainty, and
   treating it as the whole thing would ship a product that is unpredictable
   for about twenty calls. Three roles times five situation states is fifteen
   combinations; a founder doing 20-50 rehearsals meets each one several
   times and starts recognising them.

   ROLE DECIDES WHO ANSWERS. THESE DECIDE WHETHER THE CALL IS WINNABLE.

   That is the difference that cannot be memorised. A founder can learn what
   a rushed gatekeeper sounds like. They cannot learn in advance whether the
   problem VISION assumed this prospect has actually exists, because on a
   real cold call they never know that either -- and a discovery sequence
   rehearsed against a prospect who always turns out to have the problem is
   the single most dangerous habit this product could teach.

   FIVE AXES, DRAWN TOGETHER, NOT INDEPENDENTLY. Independent draws produce
   incoherent calls: a prospect with no problem who raises a price objection,
   a decision-maker who offers to transfer you. Coherence is what makes
   uncertainty believable rather than chaotic, so the draw is constrained --
   see `coherenceOf`.

   DETERMINISTIC FROM A SEED. Same seed, same call, always. A rehearsal that
   cannot be replayed cannot be debugged, and a scenario that drifts between
   turns of the same call is not a scenario.

   NOTHING HERE IS EVER SENT TO THE CLIENT. See scenario-selection.js, which
   owns that rule and enforces it.
   ══════════════════════════════════════════════════════════════════════ */

export const CALL_VARIATION_VERSION = 'practice_call_variation_v1';

/* ── THE AXES ─────────────────────────────────────────────────────────
   Each is a thing a real cold call varies on, that a founder cannot see
   before dialling, and that changes what the RIGHT behaviour is. An axis
   that does not change the right behaviour is decoration. */
export const AXES = Object.freeze({
  /* Can the founder tell whether this person decides? This is the axis the
     critical fault lives on, and `ambiguous` is the one that protects good
     selling: a founder who pitches a plausible influencer has made a
     judgement call, not a mistake. */
  authorityClarity: Object.freeze(['explicit', 'ambiguous', 'unstated']),

  /* THE MOST IMPORTANT ONE. VISION picked this prospect because it believed
     they had a problem. Sometimes that belief is wrong, and the correct
     outcome is a short call and a clean exit -- which must score WELL. */
  painExists: Object.freeze([true, false]),

  /* Only reachable when someone who cannot decide answers. */
  transferPath: Object.freeze(['none', 'offered_completed', 'offered_refused', 'person_unavailable']),

  objectionPath: Object.freeze(['none', 'price', 'incumbent', 'timing', 'trust']),

  /* How much of their attention is actually available, separate from mood:
     a curious prospect can still be unwilling to give you ten minutes. */
  engagement: Object.freeze(['low', 'medium', 'high']),
});

export const AXIS_IDS = Object.freeze(Object.keys(AXES));

/* ── WEIGHTS, NOT UNIFORM DRAWS ───────────────────────────────────────
   A uniform draw over five axes makes the unusual as common as the usual,
   and a founder who meets a no-pain prospect every other call learns to
   assume no pain. These are roughly how often each shows up on real cold
   calls into a cold list. */
const BASE_WEIGHTS = Object.freeze({
  authorityClarity: Object.freeze({ explicit: 0.30, ambiguous: 0.40, unstated: 0.30 }),
  painExists: Object.freeze({ true: 0.60, false: 0.40 }),
  transferPath: Object.freeze({ none: 0.25, offered_completed: 0.35, offered_refused: 0.20, person_unavailable: 0.20 }),
  objectionPath: Object.freeze({ none: 0.20, price: 0.20, incumbent: 0.25, timing: 0.20, trust: 0.15 }),
  engagement: Object.freeze({ low: 0.30, medium: 0.45, high: 0.25 }),
});

/* A small string hash, not a PRNG needing external state: same seed, same
   draw, always. Deliberately the same shape as situation-state's, because
   the two have to be independently reproducible and neither may consume the
   other's stream -- a shared generator would make a change to one axis
   silently reshuffle the other. */
function seededUnit(seed) {
  const s = String(seed == null ? 'x' : seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/* One draw from a weight map. Keys are strings on the way in and are handed
   back as the axis's own type, so `painExists` stays a boolean. */
function draw(weights, seed, cast = (v) => v) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (!entries.length || total <= 0) return null;
  let point = seededUnit(seed) * total;
  for (const [key, w] of entries) {
    point -= w;
    if (point <= 0) return cast(key);
  }
  return cast(entries[entries.length - 1][0]);
}

/* ── COHERENCE ────────────────────────────────────────────────────────
   §12 asks for uncertainty that stays BELIEVABLE. Independent draws do not:
   a decision-maker who offers to put you through, or a prospect with no
   problem at all who argues about price, reads as a broken simulator rather
   than a hard call -- and a founder who notices the seams starts playing the
   seams.

   Constraints are applied as weight edits BEFORE the draw, never as a
   correction afterwards. Redrawing until something looks sensible would make
   the result depend on how many times we tried, which is not reproducible. */
export function coherenceOf(role) {
  const w = {
    authorityClarity: { ...BASE_WEIGHTS.authorityClarity },
    painExists: { ...BASE_WEIGHTS.painExists },
    transferPath: { ...BASE_WEIGHTS.transferPath },
    objectionPath: { ...BASE_WEIGHTS.objectionPath },
    engagement: { ...BASE_WEIGHTS.engagement },
  };

  /* Nobody transfers you to themselves. A decision-maker may still be
     unavailable in the sense of "not now", but that is timing, not routing. */
  if (role === 'decision_maker') {
    w.transferPath = { none: 1 };
    /* They are the authority, so it is rarely a mystery for long. */
    w.authorityClarity = { explicit: 0.45, ambiguous: 0.30, unstated: 0.25 };
  }

  /* A gatekeeper is not a buyer, so the buyer's objections do not belong to
     them. What they push back with is routing resistance, which lives on
     transferPath, not on objectionPath. */
  if (role === 'gatekeeper') {
    w.objectionPath = { none: 1 };
    w.authorityClarity = { explicit: 0.45, ambiguous: 0.35, unstated: 0.20 };
    w.transferPath = { none: 0.10, offered_completed: 0.40, offered_refused: 0.25, person_unavailable: 0.25 };
  }

  /* An influencer is the genuinely ambiguous case, and the one the critical
     fault must never convict. They can route, and they can object. */
  if (role === 'influencer') {
    w.authorityClarity = { explicit: 0.15, ambiguous: 0.60, unstated: 0.25 };
    w.transferPath = { none: 0.45, offered_completed: 0.25, offered_refused: 0.15, person_unavailable: 0.15 };
  }

  return w;
}

/* Two axes still have to agree with each other after the draw, and the
   honest way to do that is to draw the dependent one from weights the first
   one edited -- not to overwrite it. */
function objectionWeightsGiven(base, painExists) {
  if (painExists) return base;
  /* No problem exists. "Too expensive" and "we already have someone" are
     answers to a problem being raised; with nothing to solve, what a real
     prospect says is that it is not a priority, or nothing at all.

     INTERSECTED WITH THE ROLE, NOT SUBSTITUTED FOR IT. Returning this map
     outright overrode the gatekeeper's `{none: 1}` and handed 22% of
     gatekeepers a buyer objection -- a receptionist arguing about timing.
     The role constraint is the stronger claim and must survive: an option
     the role does not have cannot be reintroduced by a later axis. */
  const shaped = { none: 0.55, timing: 0.30, incumbent: 0.15 };
  const out = {};
  Object.keys(base).forEach((k) => { if (base[k] > 0 && shaped[k] > 0) out[k] = shaped[k]; });
  return Object.keys(out).length ? out : base;
}

/**
 * THE CALL THIS FOUNDER IS ABOUT TO HAVE.
 *
 * @param {object}  input
 * @param {string}  input.role  gatekeeper | influencer | decision_maker
 * @param {string}  input.seed  stable per call
 * @returns {{version:string, role:string, authorityClarity:string,
 *            painExists:boolean, transferPath:string, objectionPath:string,
 *            engagement:string}}
 */
export function drawVariation({ role = 'decision_maker', seed = null } = {}) {
  const w = coherenceOf(role);
  /* A separate seed per axis, so adding an axis later cannot reshuffle the
     ones already drawn -- a shared stream would invalidate every recorded
     scenario the first time this file grows. */
  const at = (axis) => `${seed == null ? 'no-seed' : seed}::${axis}`;

  const painExists = draw(w.painExists, at('painExists'), (k) => k === 'true');
  const objectionPath = draw(objectionWeightsGiven(w.objectionPath, painExists), at('objectionPath'));

  return Object.freeze({
    version: CALL_VARIATION_VERSION,
    role,
    authorityClarity: draw(w.authorityClarity, at('authorityClarity')),
    painExists,
    transferPath: draw(w.transferPath, at('transferPath')),
    objectionPath,
    engagement: draw(w.engagement, at('engagement')),
  });
}

/* ── WHAT THE FOUNDER IS ALLOWED TO BE JUDGED ON ──────────────────────
   An axis that made a category untestable must make it NOT_TESTED, not
   score it zero. A prospect with no problem cannot have their objection
   handled, and a founder marked down for failing to handle an objection
   nobody raised has been punished for the draw.

   This is the bridge between the variation and §9: outcome is not
   performance, and the axes are the clearest case of it in the product. */
export function untestableUnder(variation) {
  const v = variation || {};
  const out = new Set();
  if (v.objectionPath === 'none') out.add('objectionHandling');
  /* No pain means no need to discover and nothing the offer answers. The
     founder still has to ASK -- discovery stays tested -- but pitch timing
     cannot be, because the correct number of pitches is zero. */
  if (v.painExists === false) out.add('pitchTiming');
  return out;
}
