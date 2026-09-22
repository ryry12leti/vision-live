/**
 * Connects the Founder Execution Entities bundle to Goal Engine request
 * construction -- the sanctioned attachment point for
 * `programme.requiredAttributes.founderExecutionEntities`, mirroring
 * request-integration-v2.js's founderVentureSnapshot attach exactly.
 *
 * Merges safely alongside `founderVentureSnapshot` and `founderExecutionContext`
 * (or anything else already present) and never overwrites either. Fails
 * closed on a malformed bundle or one that does not genuinely belong to the
 * exact venture/role/state-version it is being attached alongside.
 */

import { validateFounderExecutionEntities } from './entity-snapshot.js';

export const FOUNDER_EXECUTION_ENTITIES_REQUEST_FIELD = 'founderExecutionEntities';

/**
 * @typedef {object} AttachFounderExecutionEntitiesResult
 * @property {boolean} valid
 * @property {object} [requiredAttributes] Present only when valid === true.
 * @property {string} [reason]
 * @property {string[]} [errors]
 */

/**
 * @param {object|null|undefined} baseRequiredAttributes The programme's existing requiredAttributes (may already carry founderVentureSnapshot etc.).
 * @param {object} entityBundle buildFounderExecutionEntities(...)'s result.
 * @param {object} expected
 * @param {string} expected.ventureId
 * @param {string} expected.ventureRole
 * @param {number} expected.stateVersion
 * @returns {AttachFounderExecutionEntitiesResult}
 */
export function attachFounderExecutionEntitiesToRequiredAttributes(baseRequiredAttributes, entityBundle, expected) {
  const check = validateFounderExecutionEntities(entityBundle, expected.ventureId, expected.ventureRole, expected.stateVersion);
  if (!check.valid) return { valid: false, reason: 'invalid_entity_bundle', errors: check.errors };

  return {
    valid: true,
    requiredAttributes: {
      ...(baseRequiredAttributes || {}),
      [FOUNDER_EXECUTION_ENTITIES_REQUEST_FIELD]: entityBundle,
    },
  };
}

/**
 * @param {object} request
 * @returns {object|null}
 */
export function readFounderExecutionEntitiesFromRequest(request) {
  return request?.programme?.requiredAttributes?.[FOUNDER_EXECUTION_ENTITIES_REQUEST_FIELD] ?? null;
}
