/**
 * Founder Execution Context — resource-binding resolution.
 *
 * Binds only resources that genuinely exist: a route's resourceBindings can
 * only ever contain a canonical resource id that is ALSO present in the
 * caller's trusted `availableResourceIds` (the exact same list
 * hasRequiredResources() in domain-intelligence/shared.js checks a built
 * request against -- built from the real available_resources sourceType,
 * never invented here). A binding key with no available candidate is simply
 * omitted from the result -- never fabricated, never defaulted.
 */

import { FOUNDER_ROUTE_CONTEXT_FIELDS, CANONICAL_RESOURCE_IDS } from './contract.js';

/**
 * @typedef {object} ResourceBindingResolution
 * @property {object} bindings Only the keys that were genuinely resolvable (each value a one-element array of the bound resource id, matching isTrustedIdentifierArray).
 * @property {string[]} missingRequired Required binding keys with no available resource -- the route cannot be eligible while any of these remain non-empty.
 * @property {string[]} missingOptional Optional binding keys with no available resource -- informational only, never blocking.
 */

/**
 * @param {string} routeId One of the 7 canonical Founder work-unit ids.
 * @param {string[]} availableResourceIds Trusted, already-real resource ids (e.g. from the request's available_resources source).
 * @returns {ResourceBindingResolution}
 */
export function resolveResourceBindings(routeId, availableResourceIds) {
  const spec = FOUNDER_ROUTE_CONTEXT_FIELDS[routeId]?.resourceBindingKeys;
  const canonical = CANONICAL_RESOURCE_IDS[routeId];
  if (!spec || !canonical) {
    return { bindings: {}, missingRequired: [], missingOptional: [] };
  }
  const available = new Set(Array.isArray(availableResourceIds) ? availableResourceIds : []);
  const bindings = {};
  const missingRequired = [];
  for (const key of spec.required) {
    const resourceId = canonical[key];
    if (resourceId && available.has(resourceId)) {
      bindings[key] = [resourceId];
    } else {
      missingRequired.push(key);
    }
  }
  const missingOptional = [];
  for (const key of spec.optional || []) {
    const resourceId = canonical[key];
    if (resourceId && available.has(resourceId)) {
      bindings[key] = [resourceId];
    } else {
      missingOptional.push(key);
    }
  }
  return { bindings, missingRequired, missingOptional };
}
