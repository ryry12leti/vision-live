/**
 * Helpers shared by every per-domain intelligence module. Pure functions
 * only: no randomness, no clock reads, no I/O. The same request always
 * plans the same briefs.
 */

import { isPlainObject } from '../contract.js';
import {
  EXECUTION_ITEM_DOMAIN_DETAIL_FIELDS,
  PROFESSIONAL_EXECUTION_UNIT_CONTRACT_VERSION,
  unionOfItemRequiredResources,
} from '../../mission-evaluator/candidate-contract.js';

export { unionOfItemRequiredResources };

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/**
 * Reads and strictly validates request.programme.requiredAttributes.
 * prescribedExecutionUnit — the only trusted source for a genuine,
 * programme-authored complete session (e.g. a full Arm Day: every
 * exercise, in order, with its prescribed sets/reps/load/rest). The
 * canonical schema leaves `programme.requiredAttributes` unstructured (a
 * plain object, no fixed field list) specifically so this richer, nested
 * prescription can live there without touching the strictly-typed
 * domainFacts schema.
 *
 * Returns null on ANY structural defect — missing, wrong shape, an item
 * missing a field, an out-of-order item, domainItemDetails not matching
 * the current domain's exact field list — never repairs or partially
 * trusts a broken prescription. Callers must treat null as "this route is
 * not executable from what the programme actually prescribes" and either
 * fall back to a genuinely single-item canonical route or fail closed,
 * never fabricate a session.
 *
 * @param {object} request
 * @returns {{unitLabel: string, items: object[]}|null}
 */
export function trustedPrescribedExecutionUnit(request) {
  const prescribed = request.programme?.requiredAttributes?.prescribedExecutionUnit;
  if (!isPlainObject(prescribed)) return null;
  if (typeof prescribed.unitLabel !== 'string' || prescribed.unitLabel.trim().length === 0) return null;
  if (!Array.isArray(prescribed.items) || prescribed.items.length === 0) return null;

  const expectedDetailFields = EXECUTION_ITEM_DOMAIN_DETAIL_FIELDS[request.domainId];
  const requiredItemFields = ['itemId', 'order', 'label', 'actionType', 'effortUnits', 'requiredResourceIds', 'domainItemDetails'];
  const seenItemIds = new Set();

  for (const [index, item] of prescribed.items.entries()) {
    if (!isPlainObject(item)) return null;
    const keys = Object.keys(item);
    if (keys.length !== requiredItemFields.length || !requiredItemFields.every((field) => keys.includes(field))) return null;
    if (typeof item.itemId !== 'string' || !IDENTIFIER_PATTERN.test(item.itemId) || seenItemIds.has(item.itemId)) return null;
    seenItemIds.add(item.itemId);
    if (item.order !== index + 1) return null;
    if (typeof item.label !== 'string' || item.label.trim().length === 0) return null;
    if (typeof item.actionType !== 'string' || !IDENTIFIER_PATTERN.test(item.actionType)) return null;
    if (!Number.isFinite(item.effortUnits) || item.effortUnits < 1) return null;
    if (!Array.isArray(item.requiredResourceIds)
      || item.requiredResourceIds.some((id) => typeof id !== 'string' || !IDENTIFIER_PATTERN.test(id))
      || new Set(item.requiredResourceIds).size !== item.requiredResourceIds.length) return null;
    if (!isPlainObject(item.domainItemDetails)) return null;
    if (expectedDetailFields) {
      const detailKeys = Object.keys(item.domainItemDetails);
      if (detailKeys.length !== expectedDetailFields.length || !expectedDetailFields.every((field) => detailKeys.includes(field))) return null;
    }
  }

  return { unitLabel: prescribed.unitLabel, items: prescribed.items };
}

/**
 * A genuinely trusted identifier: a non-empty snake_case string. Used to
 * distinguish a real trusted fact from a fabricated placeholder — a
 * fabricated value is never validated this strictly by construction, so a
 * caller that only ever reads through this check can never accidentally
 * accept a locally-invented id.
 */
export function isTrustedIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

/**
 * A non-empty array of trusted identifiers (see isTrustedIdentifier), with
 * duplicates rejected — a real set of distinct trusted references, not a
 * padded or repeated list.
 */
export function isTrustedIdentifierArray(value, { minLength = 1 } = {}) {
  return Array.isArray(value)
    && value.length >= minLength
    && value.every((item) => isTrustedIdentifier(item))
    && new Set(value).size === value.length;
}

/**
 * Reads one named nested trusted contract from request.programme.
 * requiredAttributes — e.g. founderExecutionContext, learningExecutionContext
 * — the same unstructured-at-the-schema-level extension point
 * trustedPrescribedExecutionUnit already uses for Fitness/Athlete sessions.
 * Returns null when absent or not a plain object; callers must still
 * individually validate whichever specific fields their own work unit
 * needs (isTrustedIdentifier/isTrustedIdentifierArray), never assume
 * presence implies validity.
 *
 * @param {object} request
 * @param {string} key
 * @returns {object|null}
 */
export function trustedExecutionContext(request, key) {
  const context = request.programme?.requiredAttributes?.[key];
  return isPlainObject(context) ? context : null;
}

/**
 * Reads and strictly validates one work-unit-specific route out of a
 * versioned, discriminated execution-context contract stored under
 * `request.programme.requiredAttributes[contextKey]` — e.g.
 * `founderExecutionContext` / `learningExecutionContext`. This is the
 * general form of `trustedPrescribedExecutionUnit` above, for domains whose
 * canonical `domainFacts` schema has no field for the route-specific fact a
 * work unit needs (an offer id, a retention cohort id, a diagnostic task
 * id, ...): rather than let each domain module invent one, the fact must
 * come from this exact, versioned, provenance-backed extension of the same
 * trusted `programme` authority `prescribedExecutionUnit` already uses.
 *
 * Returns null on ANY structural defect — the context object missing or
 * malformed, a `contractVersion` mismatch, no `routes` object, no entry for
 * this exact `workUnitTypeId`, an unknown field, a missing required field,
 * a field failing `isTrustedIdentifier`/`isTrustedIdentifierArray`, or (when
 * `spec.resourceBindingKeys` is declared) a malformed `resourceBindings`
 * object — never repairs or partially trusts a broken route. Callers must
 * treat null as "this route has no genuine trusted fact to build from" and
 * exclude the route, never fabricate one.
 *
 * A route field named `resourceBindings` is validated specially: its value
 * must be a plain object whose own keys are drawn from
 * `spec.resourceBindingKeys.{required,optional}` (the same required/
 * optional-field shape as the route itself) and whose every value is a
 * genuinely trusted, non-empty, deduplicated resource-id array — the same
 * source of truth item.requiredResourceIds construction reads from, so a
 * provider can never see a resource id that was not itself declared trusted
 * here.
 *
 * @param {object} request
 * @param {string} contextKey e.g. 'founderExecutionContext'
 * @param {number} expectedContractVersion
 * @param {Object<string, {required: string[], optional?: string[], resourceBindingKeys?: {required: string[], optional?: string[]}}>} routeFieldsByWorkUnit
 * @param {string} workUnitTypeId
 * @returns {object|null} The validated route object (only its declared fields), or null.
 */
export function validateExecutionContextRoute(request, contextKey, expectedContractVersion, routeFieldsByWorkUnit, workUnitTypeId) {
  const context = request.programme?.requiredAttributes?.[contextKey];
  if (!isPlainObject(context)) return null;
  if (context.contractVersion !== expectedContractVersion) return null;
  if (!isPlainObject(context.routes)) return null;

  const spec = routeFieldsByWorkUnit[workUnitTypeId];
  if (!spec) return null;
  const route = context.routes[workUnitTypeId];
  if (!isPlainObject(route)) return null;

  const allowedFields = [...spec.required, ...(spec.optional || [])];
  const keys = Object.keys(route);
  if (keys.length === 0 || !keys.every((field) => allowedFields.includes(field))) return null;
  if (!spec.required.every((field) => Object.hasOwn(route, field))) return null;

  for (const [field, value] of Object.entries(route)) {
    if (field === 'resourceBindings') {
      if (!spec.resourceBindingKeys || !isValidResourceBindings(value, spec.resourceBindingKeys)) return null;
      continue;
    }
    if (Array.isArray(value)) {
      if (!isTrustedIdentifierArray(value)) return null;
    } else if (!isTrustedIdentifier(value)) {
      return null;
    }
  }
  return route;
}

function isValidResourceBindings(bindings, keySpec) {
  if (!isPlainObject(bindings)) return false;
  const allowedKeys = [...keySpec.required, ...(keySpec.optional || [])];
  const keys = Object.keys(bindings);
  if (keys.length === 0 || !keys.every((key) => allowedKeys.includes(key))) return false;
  if (!keySpec.required.every((key) => Object.hasOwn(bindings, key))) return false;
  return Object.values(bindings).every((value) => isTrustedIdentifierArray(value));
}

/**
 * Reads one named binding out of an already-`validateExecutionContextRoute`-
 * validated route's `resourceBindings` — the exact trusted resource ids one
 * specific item/action genuinely needs, never the whole route's resource
 * union. Returns `[]` for an omitted optional binding key; never invents a
 * value for a key the route's own resourceBindingKeys does not declare.
 *
 * @param {object} route The object validateExecutionContextRoute returned.
 * @param {string} key
 * @returns {string[]}
 */
export function resourceBinding(route, key) {
  return route.resourceBindings?.[key] || [];
}

/**
 * The deterministic, deduplicated, sorted union of every named binding's
 * resources — what one exact item/action needs when it draws on more than
 * one binding (e.g. a delivery step needing both `deliveryAccess` and an
 * optional `customerDeliveryChannel`). Callers pass a plain array of keys,
 * including any conditionally-included optional ones already resolved by
 * the caller (e.g. `route.resourceBindings.offerRecord ? ['offerRecord'] : []`).
 *
 * @param {object} route The object validateExecutionContextRoute returned.
 * @param {string[]} keys
 * @returns {string[]}
 */
export function resourceIdsForBindingKeys(route, keys) {
  return [...new Set(keys.flatMap((key) => resourceBinding(route, key)))].sort();
}

/**
 * The measurable-outcome-shaped progression target every execution unit
 * carries: what "beat the previous verified session" means for this exact
 * brief, tied to the same measurable outcome the brief itself targets.
 */
export function progressionTargetFor(measurableOutcome, description) {
  return { type: measurableOutcome.type, description, targetId: measurableOutcome.targetId };
}

/**
 * The proof-collection requirement every execution unit carries, tied to
 * the exact evidence type/proof mode the brief's own trusted proof pairing
 * already established — never a different one than proofPlan declares.
 */
export function proofRequirementFor(evidenceTypeId, proofMode, description) {
  return { description, evidenceTypeId, proofMode };
}

/**
 * Assembles the full, versioned ProfessionalExecutionUnit a brief carries.
 * `estimatedMinutes` should always be the brief's own timeBudgetMinutes
 * (validateCandidateBrief enforces this): a single source of truth for how
 * long the unit takes, not a second, potentially-diverging duration.
 */
export function buildExecutionUnit({
  workUnitTypeId, unitType, unitLabel, unitSummary, items, estimatedMinutes, progressionTarget, proofRequirement,
}) {
  return {
    contractVersion: PROFESSIONAL_EXECUTION_UNIT_CONTRACT_VERSION,
    unitId: `${workUnitTypeId}_unit`,
    unitType,
    unitLabel,
    unitSummary,
    itemCount: items.length,
    estimatedMinutes,
    items,
    progressionTarget,
    completionRequirement: {
      description: items.length === 1
        ? 'Complete the single prescribed item'
        : `Complete all ${items.length} prescribed items in this session`,
      requiredItemCount: items.length,
    },
    proofRequirement,
  };
}

/**
 * Every precomputed valid proof pairing available for one work unit,
 * ordered deterministically (request.validProofPairings is already built in
 * a stable order by request-builder.js).
 */
export function pairingsForWorkUnit(request, workUnitTypeId) {
  return request.validProofPairings.filter((pairing) => pairing.workUnitTypeId === workUnitTypeId);
}

/**
 * The trusted ceiling no mission may exceed: the lower of verified
 * capability and current recovery allowance.
 */
export function effortCeiling(request) {
  return Math.min(request.effortLimits.capabilityMaxEffortUnits, request.effortLimits.recoveryMaxEffortUnits);
}

/**
 * Recovery is degraded (not 'ready'): every planned effort must be scaled
 * down, not just capped, so a "limited" or "recovery_required" status
 * visibly changes the plan rather than only being caught by the ceiling.
 */
export function isRecoveryDegraded(request) {
  return request.effortLimits.recoveryStatus !== 'ready';
}

/**
 * Deterministic Hard effort within the trusted ceiling, scaled down further
 * when recovery is degraded so effort genuinely adapts rather than merely
 * being clamped at the last moment.
 */
export function hardEffortFor(request, { preferred = 8 } = {}) {
  const ceiling = effortCeiling(request);
  const recoveryFactor = request.effortLimits.recoveryStatus === 'recovery_required'
    ? 0.4
    : request.effortLimits.recoveryStatus === 'limited'
      ? 0.7
      : 1;
  return Math.max(1, Math.min(Math.floor(preferred * recoveryFactor), Math.floor(ceiling)));
}

export function mediumEffortFor(hardEffort) {
  return Math.max(1, Math.floor(hardEffort / 2));
}

/**
 * Choose between a Hard/Medium pair and a Fixed structure based on the
 * actual computed effort: when the trusted ceiling is so low that no
 * strictly-smaller Medium version exists (Medium must be < Hard), fall back
 * to a single Fixed effort rather than producing an invalid pair. This is
 * how a degraded-recovery day can still plan a minimal, valid mission.
 */
export function missionStructureFor(hardEffort, mediumEffort) {
  if (mediumEffort >= hardEffort) {
    return { missionStructureKind: 'fixed', effortBudget: { fixed: Math.max(1, hardEffort) } };
  }
  return { missionStructureKind: 'hard_medium', effortBudget: { hard: hardEffort, medium: mediumEffort } };
}

/**
 * Time budget bounded by what is actually available today, scaled down
 * under degraded recovery so a low-readiness day plans a shorter session
 * rather than the same duration at lower intensity only.
 */
export function timeBudgetFor(request, { preferred = 45 } = {}) {
  const recoveryFactor = request.effortLimits.recoveryStatus === 'recovery_required'
    ? 0.5
    : request.effortLimits.recoveryStatus === 'limited'
      ? 0.75
      : 1;
  return Math.max(1, Math.min(request.availability.availableMinutes, Math.round(preferred * recoveryFactor)));
}

/**
 * A method may only be selected when it is unambiguously trusted. The
 * canonical schema carries no field linking a verified method to a specific
 * work unit, so this never picks "the first" of several supported methods —
 * that would be guessing which one actually applies here. It only returns a
 * method when the user's verified capability record lists exactly one
 * supported method (no ambiguity possible), and — where the domain's own
 * trusted facts carry a narrower allowed-method list for this exact route
 * (e.g. Learning's allowedLearningMethods) — that method must also appear
 * there. Returns null, never a fabricated `${workUnitTypeId}_method`
 * placeholder, when no such method exists; callers must exclude the route
 * rather than invent a method no authority actually confirmed.
 *
 * @param {object} request
 * @param {{allowedMethodIds?: string[]}} [options] A narrower, domain-fact-sourced allow-list for this route, if one exists.
 * @returns {string|null}
 */
export function trustedMethodIdFor(request, { allowedMethodIds } = {}) {
  const supported = request.effortLimits.supportedMethodIds || [];
  if (supported.length !== 1) return null;
  const [methodId] = supported;
  if (Array.isArray(allowedMethodIds) && allowedMethodIds.length > 0 && !allowedMethodIds.includes(methodId)) return null;
  return methodId;
}

/**
 * Whether every one of `requiredResourceIds` is genuinely available in this
 * exact request. An empty requirement list is always compatible — there is
 * nothing to check, not an assumption that resources do not matter.
 */
export function hasRequiredResources(request, requiredResourceIds) {
  if (!requiredResourceIds || requiredResourceIds.length === 0) return true;
  const available = new Set(request.availability.resourceIds);
  return requiredResourceIds.every((id) => available.has(id));
}

/**
 * Build one missionStepPlan pair (prepare + execute) sharing the brief's
 * output category. Every domain module builds at least these two steps;
 * some add a third (e.g. review/record) for a richer professional unit.
 */
export function twoStepPlan(outputCategoryId, prepareAction, executeAction, executeEffort) {
  return [
    { id: 'prepare', actionType: prepareAction, outputCategoryId, effortUnits: 2 },
    { id: 'execute', actionType: executeAction, outputCategoryId, effortUnits: executeEffort },
  ];
}

/**
 * Deterministically pick the first pairing for a work unit, or null when
 * the work unit has no trusted pairing in this exact request (it should
 * already have been filtered out of request.canonicalWorkUnits, but domain
 * modules stay defensive rather than assuming).
 */
export function firstPairing(request, workUnitTypeId) {
  return pairingsForWorkUnit(request, workUnitTypeId)[0] || null;
}
