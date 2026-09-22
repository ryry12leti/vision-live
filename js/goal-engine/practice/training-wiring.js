/* ════════════════════════════════════════════════════════════════════════
   PHASE 4 WP-3 — TURNING AN OBJECTIVE INTO WHAT P1's SELECTOR CONSUMES

   Two small, pure adapters. Neither imports `scenario-selection.js` and
   neither imports `situation-state.js` for anything but its own exported,
   unmodified, pure functions -- this file translates INTO their existing
   vocabularies, it does not extend them.

   ── WHY A REVERSE MAP, NOT A NEW HISTORY FIELD ─────────────────────────
   `training-objective.js` already refuses to speak P1's scored-category
   vocabulary (`ROLE_FOR_WEAKNESS`'s keys, three of which are Phase 3's
   fairness-blocked axes). But `steer()` in scenario-selection.js only
   understands `history.weakestCategory` in that same vocabulary -- it is
   PRIVATE and frozen, and adding a new field it would recognise means
   editing a P1 file, which WP-2 committed not to do. The alternative used
   here needs no P1 edit at all: `ROLE_FOR_WEAKNESS` maps SEVERAL category
   names onto each of the three roles, so picking any one representative
   key per role reaches the exact same target role through the exact same,
   unmodified, already-tested mechanism. `ROLE_FOR_WEAKNESS` itself is
   private, so this table cannot be verified by import -- it is verified by
   test instead: qa-practice-training-wiring.mjs feeds each key straight
   into the real `roleWeights()` and asserts the shift lands on the role
   this file claims it does. A P1 change that broke the mapping would fail
   that test, not fail silently here.
   ══════════════════════════════════════════════════════════════════════ */
import { ROLES } from './scenario-selection.js';
import { SITUATION_IDS, deriveAdaptiveSituation } from './situation-state.js';

/* One representative key per role, verified against the real, running
   roleWeights() by qa-practice-training-wiring.mjs rather than trusted on
   sight -- ROLE_FOR_WEAKNESS is private, so nothing here can import it to
   check. */
const WEAKEST_CATEGORY_FOR_ROLE = Object.freeze({
  gatekeeper: 'routing',
  influencer: 'qualification',
  decision_maker: 'discovery',
});

/* `objective.constraints.roleTilt` -> the `history` shape selectScenario()
   already accepts. `recentRoles` is the seller's ACTUAL last few drawn
   roles (from practice_scenarios), never invented -- steer()'s own recency
   term is meant to react to what really happened, and feeding it anything
   else would defeat the point of wiring it up at all. */
export function historyForObjective(objective, recentRoles = []) {
  const tilt = objective && objective.constraints && objective.constraints.roleTilt;
  const weakestCategory = tilt ? (WEAKEST_CATEGORY_FOR_ROLE[tilt] || null) : null;
  return { weakestCategory, recentRoles: (recentRoles || []).filter(Boolean) };
}

/* ── COVERAGE, WITHOUT TOUCHING THE HIDDEN GENERATOR'S DECISION LOGIC ──
   P4-07: no identical (role, situationFamily) pair twice in any 3. P1's
   situation draw has no history awareness at all -- deriveAdaptiveSituation
   takes {context, seed, now} and nothing about what was drawn before, and
   this file does not add that awareness to it (that would be editing a P1
   file's decision logic, which stays untouched). Instead it chooses WHICH
   seed to feed into the same unmodified draw: check what a candidate seed
   would produce, and if it collides with recent history, try a different
   seed. A BOUNDED number of retries, never a hard block -- eventually it
   accepts whatever the last attempt gives, matching "never a filter that
   forces a draw" exactly as scenario-selection.js's own steer()/normalise()
   already refuse to. */
const MAX_SEED_RETRIES = 2;

/* `recentPairs`: this seller's last few real {role, situationFamily} pairs,
   oldest first. `role`: the role ALREADY drawn for this call (scenario
   selection runs first). `baseSeed`, `context`, `now`: exactly what would
   be passed to createProspectState() downstream -- the speculative check
   here and the real draw later use the identical inputs, so they agree by
   construction rather than by hoping two independent computations match. */
export function chooseSituationSeed({ baseSeed, role, context = {}, now, recentPairs = [] } = {}) {
  const recent = new Set((recentPairs || []).slice(-2)
    .filter((p) => p && p.role && p.situationFamily)
    .map((p) => `${p.role}::${p.situationFamily}`));

  let seed = baseSeed;
  let situationFamily = null;
  for (let attempt = 0; attempt <= MAX_SEED_RETRIES; attempt += 1) {
    const candidateSeed = attempt === 0 ? baseSeed : `${baseSeed}::retry${attempt}`;
    const derived = deriveAdaptiveSituation({ context, seed: candidateSeed, now });
    situationFamily = derived.id;
    seed = candidateSeed;
    if (!recent.has(`${role}::${situationFamily}`)) break;
    /* Collided, and retries remain: try again. On the LAST attempt, accept
       the collision rather than looping -- a bounded nudge, not a promise. */
  }
  return Object.freeze({ seed, situationFamily });
}

export { SITUATION_IDS, ROLES };
