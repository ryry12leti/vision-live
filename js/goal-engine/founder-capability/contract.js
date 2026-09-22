/**
 * Founder Capability Contract — the one shape every execution capability
 * implements.
 *
 * WHY THIS EXISTS. VISION has one Founder engine, not four. The engine owns
 * Venture State, derived stage, the Active Outcome, bottleneck ranking,
 * capability selection, the Today's Move lifecycle, taskVersion, proof, reload
 * persistence and next-move calculation. A capability owns only: whether it can
 * do the selected work, what Work Item that creates, what mission it generates,
 * what workspace it needs, what evidence proves it, how success changes state,
 * and how it fails safely. Nothing else.
 *
 * THE NAMING RULE IS ENFORCED, NOT SUGGESTED. A capability is named by the
 * SHAPE OF THE WORK and the EVIDENCE THAT PROVES IT, never by an industry.
 * `recruit_target_people` serves a game studio, a course and a consumer app;
 * `game_playtester_recruitment` serves one and quietly recreates the
 * per-industry engines this architecture exists to prevent. validateFounder
 * Capability REJECTS an industry-shaped id, because a rule that is only written
 * down is a rule that erodes.
 *
 * THE COUNT IS CAPPED. Past roughly a dozen capabilities, sprawl has almost
 * certainly happened -- see registry.js, which fails loudly rather than letting
 * the list grow quietly.
 *
 * HONESTY OVER COMPLETENESS. Several contract fields describe machinery VISION
 * has not built yet (workspaces, per-capability completion handlers). A
 * capability may declare such a field `notImplemented('<why>')`, and the
 * validator REQUIRES a real reason when it does. That is deliberate: a stubbed
 * function returning null would look implemented and silently do nothing, which
 * is exactly the class of defect this codebase keeps finding. An honest,
 * declared gap is inspectable; a fake implementation is not.
 */

export const FOUNDER_CAPABILITY_CONTRACT_VERSION = 1;

/** Every field a capability must declare. Order is the lifecycle order. */
export const FOUNDER_CAPABILITY_FIELDS = Object.freeze([
  'capabilityId', 'version', 'supportedBottlenecks', 'stageConstraints',
  'eligibilityRules', 'requiredFacts', 'requiredResources', 'workItemType',
  'missionBuilder', 'workspaceType', 'workspaceConfigSchema', 'requiredActions',
  'evidenceSchema', 'completionHandler', 'stateUpdateRules', 'nextMovePolicy',
  'clarificationPolicy', 'unsupportedFallback',
]);

/** Fields that must be a function (or an explicit, reasoned gap). */
const BEHAVIOUR_FIELDS = Object.freeze([
  'eligibilityRules', 'missionBuilder', 'completionHandler',
  'clarificationPolicy', 'unsupportedFallback',
]);

/** Fields whose absence would make the capability unsafe, so a gap is banned. */
const GAP_FORBIDDEN_FIELDS = Object.freeze([
  'eligibilityRules', 'missionBuilder', 'evidenceSchema', 'completionHandler',
  'unsupportedFallback',
]);

/* Bottleneck categories the shared engine ranks (founder-bottleneck/contract.js).
   Duplicated as a literal on purpose: importing the bottleneck module here
   would make the capability layer depend on the ranking layer, and the contract
   must be readable by a capability author without pulling in the engine. Kept
   honest by qa-founder-capability-contract.mjs, which asserts the two agree. */
export const CAPABILITY_BOTTLENECK_CATEGORIES = Object.freeze([
  'insufficient_customer_evidence', 'weak_demand', 'sales_conversion',
  'delivery_throughput', 'retention_failure', 'operational_constraint',
  'strategic_ambiguity',
]);

/** Derived stages (founder-stage/index.js). Same reasoning as above. */
export const CAPABILITY_STAGES = Object.freeze([
  'scaling', 'retaining', 'delivering', 'acquiring', 'launched',
  'testing', 'building', 'prototype', 'validation', 'idea',
]);

/* Words that name an INDUSTRY, a PLATFORM or a PRODUCT TYPE rather than a shape
   of work. Any of these in a capabilityId is sprawl, caught at registration.
   The list is the concrete set the architecture review called out, plus the
   obvious neighbours -- it does not need to be exhaustive to work, because it
   catches the exact way this mistake gets made: reaching for the founder's
   industry when naming the thing they do. */
const INDUSTRY_SHAPED_TERMS = Object.freeze([
  'steam', 'shopify', 'amazon', 'etsy', 'ebay', 'wordpress', 'youtube', 'tiktok',
  'instagram', 'linkedin', 'app_store', 'appstore', 'play_store', 'playstore',
  'game', 'gaming', 'playtester', 'saas', 'ecommerce', 'dropship', 'dropshipping',
  'agency', 'restaurant', 'cafe', 'salon', 'gym', 'newsletter', 'podcast',
  'course', 'coaching', 'nonprofit', 'charity', 'marketplace', 'freelance',
  'mobile_app', 'web_app', 'plumber', 'plumbing', 'trades', 'retail',
  /* PRODUCT TYPES, not just industries. `app_beta_testing` slipped past a list
     that had `mobile_app` but not bare `app` -- and it is the same mistake:
     naming the capability after the artefact instead of the work. "Test a
     build with real users" serves an app, a game and a website alike. */
  'app', 'beta', 'website', 'webpage', 'store', 'shop', 'blog', 'platform',
]);

const ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Declares a contract field that VISION cannot honestly populate yet.
 *
 * Use this instead of a stub. A stub that returns null is indistinguishable
 * from a working implementation that found nothing, and that ambiguity is how
 * dead wiring survives for months.
 *
 * @param {string} reason Why it cannot be populated yet, in plain words.
 */
export function notImplemented(reason) {
  if (!isNonEmptyString(reason)) {
    throw new Error('notImplemented requires a real reason -- an undeclared gap is worse than a missing field');
  }
  return Object.freeze({ implemented: false, reason: reason.trim() });
}

/** @returns {boolean} true when a field is an explicitly declared gap. */
export function isDeclaredGap(value) {
  return isPlainObject(value) && value.implemented === false && isNonEmptyString(value.reason);
}

/**
 * Structural, fail-closed validator. Runs at registration, so a malformed
 * capability can never reach a founder.
 *
 * @param {unknown} capability
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateFounderCapability(capability) {
  const errors = [];
  if (!isPlainObject(capability)) return { valid: false, errors: ['capability must be a plain object'] };

  for (const field of FOUNDER_CAPABILITY_FIELDS) {
    if (!Object.hasOwn(capability, field)) errors.push(`missing required field: ${field}`);
  }
  for (const field of Object.keys(capability)) {
    if (!FOUNDER_CAPABILITY_FIELDS.includes(field)) errors.push(`unknown field: ${field}`);
  }
  if (errors.length > 0) return { valid: false, errors };

  // ── Identity ───────────────────────────────────────────────────────────
  if (!isNonEmptyString(capability.capabilityId) || !ID_RE.test(capability.capabilityId)) {
    errors.push('capabilityId must be lower_snake_case');
  } else {
    const parts = capability.capabilityId.split('_');
    const industry = INDUSTRY_SHAPED_TERMS.filter((term) => (
      term.includes('_') ? capability.capabilityId.includes(term) : parts.includes(term)
    ));
    if (industry.length > 0) {
      errors.push(`capabilityId names an industry or platform (${industry.join(', ')}) -- capabilities are named by the shape of the work and the evidence that proves it, never by who the founder happens to be`);
    }
  }
  if (!Number.isInteger(capability.version) || capability.version < 1) {
    errors.push('version must be a positive integer');
  }

  // ── Selection inputs ───────────────────────────────────────────────────
  if (!isStringArray(capability.supportedBottlenecks) || capability.supportedBottlenecks.length === 0) {
    errors.push('supportedBottlenecks must be a non-empty array');
  } else {
    for (const category of capability.supportedBottlenecks) {
      if (!CAPABILITY_BOTTLENECK_CATEGORIES.includes(category)) errors.push(`supportedBottlenecks contains an unknown category: ${category}`);
    }
  }

  if (!isPlainObject(capability.stageConstraints)) {
    errors.push('stageConstraints must be an object');
  } else {
    const { allowedStages, blockedStages } = capability.stageConstraints;
    if (!isStringArray(allowedStages ?? []) || !isStringArray(blockedStages ?? [])) {
      errors.push('stageConstraints.allowedStages/blockedStages must be arrays of stage names');
    }
    for (const stage of [...(allowedStages ?? []), ...(blockedStages ?? [])]) {
      if (!CAPABILITY_STAGES.includes(stage)) errors.push(`stageConstraints names an unknown stage: ${stage}`);
    }
    /* Declaring both is a contradiction waiting to be resolved arbitrarily. */
    if ((allowedStages ?? []).length > 0 && (blockedStages ?? []).length > 0) {
      errors.push('stageConstraints must declare allowedStages OR blockedStages, never both');
    }
  }

  if (!isStringArray(capability.requiredFacts)) errors.push('requiredFacts must be an array of fact keys');
  if (!isStringArray(capability.requiredResources)) errors.push('requiredResources must be an array of canonical resource ids');

  // ── Work and execution ─────────────────────────────────────────────────
  if (!isNonEmptyString(capability.workItemType) || !ID_RE.test(capability.workItemType)) {
    errors.push('workItemType must be lower_snake_case');
  }
  if (!isStringArray(capability.requiredActions) || capability.requiredActions.length === 0) {
    errors.push('requiredActions must be a non-empty array of action types');
  }
  if (!isNonEmptyString(capability.workspaceType) && !isDeclaredGap(capability.workspaceType)) {
    errors.push('workspaceType must be a string or a declared gap');
  }
  if (!isPlainObject(capability.workspaceConfigSchema) && !isDeclaredGap(capability.workspaceConfigSchema)) {
    errors.push('workspaceConfigSchema must be an object or a declared gap');
  }

  // ── Evidence and completion ────────────────────────────────────────────
  if (!isPlainObject(capability.evidenceSchema)) {
    errors.push('evidenceSchema must be an object');
  } else {
    if (!isStringArray(capability.evidenceSchema.requiredEvidenceKinds) || capability.evidenceSchema.requiredEvidenceKinds.length === 0) {
      errors.push('evidenceSchema.requiredEvidenceKinds must be a non-empty array -- a capability that cannot say what proves it is done can never be verified');
    }
    if (!isNonEmptyString(capability.evidenceSchema.proofType)) {
      errors.push('evidenceSchema.proofType must name the proof modality');
    }
  }

  if (!isPlainObject(capability.stateUpdateRules)) {
    errors.push('stateUpdateRules must be an object');
  } else if (!isStringArray(capability.stateUpdateRules.factsWritten)) {
    errors.push('stateUpdateRules.factsWritten must list the fact keys a completion writes');
  }

  if (!isPlainObject(capability.nextMovePolicy)) {
    errors.push('nextMovePolicy must be an object');
  } else if (!['work_item', 'bottleneck', 'venture_state'].includes(capability.nextMovePolicy.loopBackTo)) {
    errors.push('nextMovePolicy.loopBackTo must be work_item, bottleneck or venture_state');
  }

  // ── Behaviour fields ───────────────────────────────────────────────────
  for (const field of BEHAVIOUR_FIELDS) {
    const value = capability[field];
    const isFn = typeof value === 'function';
    const isGap = isDeclaredGap(value);
    if (!isFn && !isGap) {
      errors.push(`${field} must be a function or a declared gap (notImplemented('<why>'))`);
    }
    if (isGap && GAP_FORBIDDEN_FIELDS.includes(field)) {
      errors.push(`${field} may not be a declared gap -- a capability without it cannot run or fail safely`);
    }
  }
  if (isDeclaredGap(capability.evidenceSchema)) {
    errors.push('evidenceSchema may not be a declared gap -- without it completion cannot be proven');
  }

  return { valid: errors.length === 0, errors };
}
