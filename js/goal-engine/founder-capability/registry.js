/**
 * Founder Capability Registry — the one list, with the sprawl guard on it.
 *
 * Registration validates. A malformed capability throws here rather than
 * reaching a founder, which is the whole reason the contract is a validator and
 * not a document.
 *
 * THE COUNT IS THE ARCHITECTURE'S IMMUNE SYSTEM. The failure mode this whole
 * design exists to prevent is not bad code -- it is a slow drift back to
 * per-industry engines, one reasonable-looking addition at a time. Nobody ever
 * adds "the game engine"; they add `game_playtester_recruitment` because it is
 * five minutes of work and obviously useful. The cap makes that drift loud.
 *
 * If you are here because the cap fired: the question is not "how do we raise
 * the limit". It is "which two of these are the same shape of work with a
 * different noun in front of it".
 */

import { validateFounderCapability } from './contract.js';
import { discoverAndReviewEntities } from './capabilities/discover-and-review-entities.js';
import { completeProductWork } from './capabilities/complete-product-work.js';

/** Past roughly a dozen, industry sprawl has almost certainly happened. */
export const FOUNDER_CAPABILITY_SOFT_LIMIT = 12;

export class FounderCapabilityRegistryError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'FounderCapabilityRegistryError';
    this.code = code;
  }
}

const REGISTERED = [discoverAndReviewEntities, completeProductWork];

/**
 * Validates every capability and returns the frozen registry.
 *
 * @returns {Readonly<Record<string, object>>} keyed by capabilityId
 */
export function buildFounderCapabilityRegistry(capabilities = REGISTERED) {
  const byId = {};
  for (const capability of capabilities) {
    const { valid, errors } = validateFounderCapability(capability);
    if (!valid) {
      throw new FounderCapabilityRegistryError(
        'invalid_capability',
        `capability "${capability?.capabilityId ?? '(unnamed)'}" failed contract validation:\n  - ${errors.join('\n  - ')}`,
      );
    }
    if (byId[capability.capabilityId]) {
      throw new FounderCapabilityRegistryError('duplicate_capability', `capability "${capability.capabilityId}" is registered twice`);
    }
    byId[capability.capabilityId] = capability;
  }

  const count = Object.keys(byId).length;
  if (count > FOUNDER_CAPABILITY_SOFT_LIMIT) {
    throw new FounderCapabilityRegistryError(
      'capability_sprawl',
      `${count} capabilities registered, above the soft limit of ${FOUNDER_CAPABILITY_SOFT_LIMIT}. `
      + 'Stop and review whether industry-specific sprawl has occurred: two capabilities that differ only by the kind of thing being worked on are one capability with an input.',
    );
  }
  return Object.freeze(byId);
}

export const FOUNDER_CAPABILITIES = buildFounderCapabilityRegistry();
export const FOUNDER_CAPABILITY_IDS = Object.freeze(Object.keys(FOUNDER_CAPABILITIES));

/**
 * Which route each capability currently describes.
 *
 * Descriptive only at this milestone: route selection is unchanged and does not
 * consult this map. It exists so the mapping is written down in one place
 * rather than inferred, and so the next milestone can invert the dependency
 * without archaeology.
 */
export const CAPABILITY_BY_ROUTE_ID = Object.freeze({
  founder_customer_interview_set: 'discover_and_review_entities',
  founder_sales_outreach_block: 'discover_and_review_entities',
  founder_product_delivery_slice: 'complete_product_work',
});

/** Routes with no capability mapped yet -- named, not hidden. */
export const UNMAPPED_ROUTE_IDS = Object.freeze([
  'founder_offer_test', 'founder_retention_analysis',
  'founder_operating_process', 'founder_strategy_decision',
]);
