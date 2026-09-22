/**
 * Connects the Founder Execution Context builder to Goal Engine request
 * construction -- the sanctioned attachment point for
 * `programme.requiredAttributes.founderExecutionContext`, merging safely
 * alongside `founderVentureSnapshot` (or anything else already present)
 * and never overwriting it. Same generic, unstructured
 * `requiredAttributes` extension point request-builder.js already passes
 * through unchanged -- no changes needed there.
 */

import { FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION } from './contract.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @typedef {object} AttachFounderExecutionContextResult
 * @property {boolean} valid
 * @property {object} [requiredAttributes] Present only when valid === true.
 * @property {string} [reason]
 * @property {string[]} [errors]
 */

/**
 * Fails closed (never partially attaches) when the built context's own
 * declared contractVersion/ventureId/ventureRole/snapshotStateVersion do not
 * match the exact snapshot it must have been derived from -- an execution
 * context built from a stale or different snapshot must never be trusted
 * merely because it happens to arrive alongside a newer one.
 *
 * @param {object|null|undefined} baseRequiredAttributes The programme's existing requiredAttributes (may already carry founderVentureSnapshot etc.).
 * @param {ReturnType<import('./builder.js').buildFounderExecutionContext>} builtContext
 * @param {object} expected
 * @param {string} expected.ventureId
 * @param {string} expected.ventureRole
 * @param {number} expected.stateVersion
 * @returns {AttachFounderExecutionContextResult}
 */
export function attachFounderExecutionContextToRequiredAttributes(baseRequiredAttributes, builtContext, expected) {
  if (!isPlainObject(builtContext) || !isPlainObject(builtContext.wireContext) || !isPlainObject(builtContext.wireContext.routes)) {
    return { valid: false, reason: 'invalid_execution_context', errors: ['built execution context is not a plain object with a wireContext.routes object'] };
  }
  if (builtContext.contractVersion !== FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION
    || builtContext.wireContext.contractVersion !== FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION) {
    return { valid: false, reason: 'invalid_execution_context', errors: [`contractVersion must be ${FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION}`] };
  }
  if (builtContext.ventureId !== expected.ventureId) {
    return { valid: false, reason: 'venture_id_mismatch', errors: ['execution context ventureId does not match the attached snapshot'] };
  }
  if (builtContext.ventureRole !== expected.ventureRole || builtContext.ventureRole !== 'primary') {
    return { valid: false, reason: 'venture_role_mismatch', errors: ['execution context must be built from the primary snapshot and match the expected role'] };
  }
  if (builtContext.snapshotStateVersion !== expected.stateVersion) {
    return { valid: false, reason: 'state_version_mismatch', errors: ['execution context was derived from a different snapshot state version'] };
  }

  return {
    valid: true,
    requiredAttributes: {
      ...(baseRequiredAttributes || {}),
      founderExecutionContext: builtContext.wireContext,
    },
  };
}

/**
 * @param {object} request
 * @returns {object|null}
 */
export function readFounderExecutionContextFromRequest(request) {
  return request?.programme?.requiredAttributes?.founderExecutionContext ?? null;
}
