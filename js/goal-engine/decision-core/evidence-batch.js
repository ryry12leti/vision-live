/**
 * Goal Engine decision core — evidence batches.
 *
 * The domain-neutral contract for "this mission is about a specific, stored
 * collection of things the user gathered, and it is done when enough of them
 * are approved".
 *
 * Every Goal Engine eventually grows a mission of this shape. Founder builds
 * a list of prospects. Learning builds a deck of questions to drill. Fitness
 * builds a set of sessions to complete. Creator builds a slate of ideas to
 * publish. In each case the same three problems appear, and each one has
 * been solved wrongly at least once by writing domain-specific code:
 *
 *   1. WHERE THE ITEMS LIVE. The items belong in the subsystem that produced
 *      them, with its own schema, provenance and access rules. Copying them
 *      into the task record duplicates truth, and the copy goes stale the
 *      moment the user approves or rejects one. A mission therefore carries a
 *      REFERENCE -- a stable id it can re-resolve -- and never the records.
 *
 *   2. HOW MANY ARE NEEDED. Hardcoding the quantity into the mission template
 *      (`a list of 10`) makes it a property of the code rather than of the
 *      user's situation, so it cannot vary with their capacity, their market,
 *      or the size of the decision they are trying to make. The required
 *      count is an INPUT, supplied by whoever composed the mission.
 *
 *   3. WHAT "PARTLY DONE" MEANS. This is the one that actually breaks
 *      engines. Checking `collected === 0` to decide whether to keep asking,
 *      and `collected >= required` to decide whether to advance, leaves every
 *      count in between belonging to neither branch: the engine stops asking
 *      for more AND refuses to move on. The user is pinned to a mission they
 *      can no longer make progress on. Progress is therefore THREE states,
 *      not two booleans, and this file exists mainly so no domain has to
 *      rediscover that.
 *
 * This file names no domain, no item type and no fact key. A Goal Engine
 * adopts it by passing its own kind, counts and batch id.
 * `scripts/qa-goal-engine-evidence-batch.mjs` asserts that purity.
 */

/**
 * Progress states for a batch. Deliberately exhaustive and mutually
 * exclusive: every non-negative collected count maps to exactly one.
 *
 *   empty   -- nothing usable gathered yet. The mission is to START the batch.
 *   partial -- some usable items, but fewer than required. The mission is to
 *              FINISH the batch, and it must say how many are left.
 *   met     -- the requirement is satisfied. The batch can be handed on to
 *              whatever comes next.
 */
export const BATCH_PROGRESS_STATES = Object.freeze(['empty', 'partial', 'met']);

/**
 * Classifies how far along a batch is.
 *
 * `requiredCount` must be a positive integer supplied by the caller. There is
 * deliberately no default: a silent fallback quantity is exactly the
 * hardcoding this module exists to prevent, and a missing requirement is a
 * composition bug the caller should see rather than a number to guess.
 *
 * @param {object} params
 * @param {number} params.collectedCount Usable items currently in the batch. Negative or non-integer is treated as 0.
 * @param {number} params.requiredCount How many usable items this mission needs. Must be a positive integer.
 * @returns {{state: 'empty'|'partial'|'met', collected: number, required: number, remaining: number}}
 * @throws {RangeError} when `requiredCount` is not a positive integer.
 */
export function assessBatchProgress({ collectedCount, requiredCount }) {
  if (!Number.isInteger(requiredCount) || requiredCount <= 0) {
    throw new RangeError('assessBatchProgress requires a positive integer requiredCount; the quantity must come from the mission, never from a default');
  }
  const collected = Number.isInteger(collectedCount) && collectedCount > 0 ? collectedCount : 0;
  const remaining = Math.max(0, requiredCount - collected);
  let state = 'partial';
  if (collected === 0) state = 'empty';
  else if (remaining === 0) state = 'met';
  return { state, collected, required: requiredCount, remaining };
}

/**
 * @typedef {object} EvidenceBatchReference
 * @property {string} kind What the batch contains, in the owning domain's vocabulary. Provenance only — shared code never branches on it.
 * @property {string} batchId Stable id the owning subsystem can re-resolve the batch from. Opaque here.
 * @property {string} source Which subsystem owns the batch and can resolve `batchId`.
 * @property {number} collected Usable items at the time the reference was built.
 * @property {number} required How many usable items the mission needs.
 * @property {number} remaining `required - collected`, floored at 0.
 * @property {'empty'|'partial'|'met'} state Progress at the time the reference was built.
 */

/**
 * Builds a durable, resolvable pointer from a mission to a stored batch.
 *
 * The counts are snapshotted deliberately. They record what the engine
 * believed when it composed the mission, which is what makes a later
 * disagreement with the live data legible instead of invisible — the
 * reference is a claim that can be checked, not a cache to be trusted.
 * Consumers that need current numbers re-resolve `batchId` against `source`.
 *
 * @param {object} params
 * @param {string} params.kind
 * @param {string} params.batchId
 * @param {string} params.source
 * @param {number} params.collectedCount
 * @param {number} params.requiredCount
 * @returns {EvidenceBatchReference}
 * @throws {TypeError} when kind/batchId/source are not non-empty strings.
 * @throws {RangeError} when `requiredCount` is not a positive integer.
 */
export function buildEvidenceBatchReference({
  kind, batchId, source, collectedCount, requiredCount,
}) {
  const text = (value, label) => {
    const cleaned = typeof value === 'string' ? value.trim() : '';
    if (!cleaned) throw new TypeError(`buildEvidenceBatchReference requires a non-empty ${label}`);
    return cleaned;
  };
  const progress = assessBatchProgress({ collectedCount, requiredCount });
  return {
    kind: text(kind, 'kind'),
    batchId: text(batchId, 'batchId'),
    source: text(source, 'source'),
    collected: progress.collected,
    required: progress.required,
    remaining: progress.remaining,
    state: progress.state,
  };
}

/**
 * Whether a batch reaching its requirement is a real change worth acting on.
 *
 * An engine that advances whenever the requirement is currently met would
 * re-advance on every recomputation, because "met" stays true forever. The
 * transition is what matters, so this compares against the state already
 * recorded on the mission thread.
 *
 * @param {object} params
 * @param {'empty'|'partial'|'met'|null} params.previousState State recorded when the mission was last composed, or null if never.
 * @param {'empty'|'partial'|'met'} params.currentState State now.
 * @returns {boolean} True only on a first-time crossing into 'met'.
 */
export function batchRequirementNewlyMet({ previousState, currentState }) {
  return currentState === 'met' && previousState !== 'met';
}
