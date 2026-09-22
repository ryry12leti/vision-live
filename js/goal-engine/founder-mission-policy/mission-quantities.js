/**
 * Founder mission quantities.
 *
 * How many businesses to screen, how many to approve, and how many to contact
 * first — for THIS founder, on THIS mission.
 *
 * These numbers used to be module constants inside the mission template
 * (`PROSPECT_COUNT = 10`, `PROSPECT_SELECT_COUNT = 3`), which made the size of
 * a founder's first outreach push a property of VISION's source code rather
 * than of their situation. A founder with two hours a week and one with forty
 * were given identical targets, and the number could not move without a
 * deploy.
 *
 * The basis is `pushLevel` — the founder's own recorded answer about how hard
 * they want to be pushed. It is the only capacity signal in the ledger that
 * the founder states directly, which makes it the honest input here: the
 * mission gets bigger because they asked for it to be, not because the engine
 * guessed at their week.
 *
 * The tiers below ARE a policy written in code, and that is deliberate — they
 * are one table, in one place, that varies per founder and is reported with
 * its basis, rather than a literal buried in a sentence template. What must
 * never happen again is a quantity that cannot vary at all.
 *
 * Shape rules that hold at every tier, because they are what make the mission
 * coherent rather than arbitrary:
 *   screen > approve  -- screening only means something if some get cut.
 *   approve > contact -- the point of a qualified list is having somewhere to
 *                        go after the first contacts fail.
 *   contact >= 2      -- one contact produces an anecdote, not a signal.
 */

import { assessBatchProgress } from '../decision-core/evidence-batch.js';

/**
 * Quantities per recorded push level.
 *
 * `screen` is roughly double `approve` throughout: across real local-business
 * discovery, about half of what looks plausible in a directory turns out to be
 * closed, out of area, or already served — so a founder told to approve N must
 * be told to look at meaningfully more than N or they will pad the list to
 * hit the number.
 */
const QUANTITIES_BY_PUSH_LEVEL = Object.freeze({
  low: Object.freeze({ screen: 8, approve: 4, contact: 2 }),
  moderate: Object.freeze({ screen: 16, approve: 8, contact: 3 }),
  high: Object.freeze({ screen: 24, approve: 12, contact: 5 }),
});

/** Used when the founder has not recorded a push level. Reported as such. */
const DEFAULT_PUSH_LEVEL = 'moderate';

/**
 * Resolves the quantities for a prospect-gathering mission.
 *
 * @param {object} params
 * @param {Record<string, {value: unknown}>} params.perKey Fact map from rebuildStateFromFacts(...).
 * @returns {{screenCount: number, requiredCount: number, contactCount: number, pushLevel: string, basis: 'push_level'|'default_capacity'}}
 */
export function resolveProspectMissionQuantities({ perKey }) {
  const recorded = typeof perKey?.pushLevel?.value === 'string' ? perKey.pushLevel.value.trim().toLowerCase() : '';
  const known = Object.prototype.hasOwnProperty.call(QUANTITIES_BY_PUSH_LEVEL, recorded);
  const pushLevel = known ? recorded : DEFAULT_PUSH_LEVEL;
  const tier = QUANTITIES_BY_PUSH_LEVEL[pushLevel];
  return {
    screenCount: tier.screen,
    requiredCount: tier.approve,
    contactCount: tier.contact,
    pushLevel,
    basis: known ? 'push_level' : 'default_capacity',
  };
}

/**
 * Classifies a founder's prospect batch against the quantities this mission
 * actually requires.
 *
 * Exists so no founder-side caller re-derives progress with its own
 * comparison — the `collected === 0` check this replaces is precisely what
 * created the gap where a founder with some prospects but not enough was
 * neither asked to finish nor allowed to move on.
 *
 * @param {object} params
 * @param {number} params.usableProspectCount
 * @param {number} params.requiredCount From resolveProspectMissionQuantities.
 * @returns {{state: 'empty'|'partial'|'met', collected: number, required: number, remaining: number}}
 */
export function assessProspectBatch({ usableProspectCount, requiredCount }) {
  return assessBatchProgress({ collectedCount: usableProspectCount, requiredCount });
}
