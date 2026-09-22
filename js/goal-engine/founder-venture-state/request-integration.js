/**
 * Connects Founder Venture State to Goal Engine request construction.
 *
 * js/goal-engine/candidate-generator/request-builder.js's buildGenerationRequest
 * already passes `trustedContext.programme.requiredAttributes` straight
 * through into the hashable request unchanged (it is the same generic,
 * unstructured extension point founderExecutionContext/
 * learningExecutionContext/moneyExecutionContext/creatorExecutionContext
 * already use — see domain-intelligence/shared.js's
 * validateExecutionContextRoute). Adding Founder Venture State there means
 * request-builder.js itself needs zero changes: this module is the one
 * sanctioned place that populates `requiredAttributes.founderVentureState`
 * before a trusted context is built, and the one sanctioned place that
 * reads it back out downstream.
 *
 * This is deliberately NOT a place where request-builder.js's own
 * `hashableRequest`-building logic is touched — doing that would touch
 * requestHash/instructionsHash computation for every domain, which is
 * explicitly out of scope ("preserve all non-Founder domains", "do not
 * alter scoring or route selection").
 */

import { validatePreviousVentureState } from './contract.js';

export const FOUNDER_VENTURE_STATE_REQUEST_FIELD = 'founderVentureState';

/**
 * Merges a genuinely trusted primary Founder venture state into a
 * programme's `requiredAttributes`, ready to hand to trusted-context
 * assembly ahead of `buildGenerationRequest`. Never accepts an arbitrary
 * caller-supplied object: `primaryVentureState` is independently
 * re-validated with the exact same strictness a persisted `previousState`
 * gets (validatePreviousVentureState) before it is trusted, regardless of
 * where the caller obtained it (freshly assembled, reloaded from
 * persistence, or anything else) — a malformed or tampered object is
 * rejected here, not merely assumed safe because some earlier step
 * produced it.
 *
 * @param {object|null|undefined} baseRequiredAttributes The programme's existing requiredAttributes (may already carry founderExecutionContext etc.).
 * @param {object} primaryVentureState The exact ventureState object (e.g. from service.js's loadPrimaryVenture or a 'ready' recordUpdate result's `.ventureState`).
 * @returns {{valid: true, requiredAttributes: object}|{valid: false, errors: string[]}}
 */
export function attachFounderVentureStateToRequiredAttributes(baseRequiredAttributes, primaryVentureState) {
  const check = validatePreviousVentureState(
    primaryVentureState,
    primaryVentureState?.ventureId,
    primaryVentureState?.ventureRole,
  );
  if (!check.valid) return { valid: false, errors: check.errors };

  return {
    valid: true,
    requiredAttributes: {
      ...(baseRequiredAttributes || {}),
      [FOUNDER_VENTURE_STATE_REQUEST_FIELD]: primaryVentureState,
    },
  };
}

/**
 * Reads Founder Venture State back out of an already-built generation
 * request (`request.programme.requiredAttributes.founderVentureState`) —
 * the one canonical accessor downstream Founder code should use, so no
 * caller needs to know the exact nested path. Returns null when absent,
 * which is the correct, backward-compatible state for every non-Founder
 * domain and for any Founder request built before this field existed.
 *
 * @param {object} request The built generation request (or a trustedContext).
 * @returns {object|null}
 */
export function readFounderVentureStateFromRequest(request) {
  return request?.programme?.requiredAttributes?.[FOUNDER_VENTURE_STATE_REQUEST_FIELD] ?? null;
}
