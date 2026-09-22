/**
 * Founder Venture State V2 — materialised state composition and the
 * trusted Goal Engine snapshot.
 *
 * Two altitudes:
 *   - buildMaterialisedVentureState(): the full Table-B `state` jsonb shape
 *     (every section, always present, either `{status:'known', ...}` or
 *     `{status:'unknown'}` — never omitted, never guessed).
 *   - buildFounderGoalEngineSnapshot(): a read-only projection of that
 *     state for Goal Engine / owner-shadow-run consumption, adding
 *     freshness, missing-critical-context, and a provenance summary. Never
 *     merges primary and secondary — it operates on exactly one venture's
 *     materialised state per call.
 */

import { computeRelevantConfidence } from '../decision-core/index.js';
import { computeClarificationQuestions } from './clarification.js';
import { INTEGRATION_PROVIDERS } from './sections.js';
import { buildEntityCollections } from './entity-snapshot.js';

export const FOUNDER_VENTURE_SNAPSHOT_VERSION = 1;

// Every section a materialised state always carries, in the exact
// snake_case-equivalent camelCase names the task's spec section B lists
// (stage/offer/productOrService/targetCustomer/customerEvidence/traction/
// offerPricing/revenue/acquisition/delivery/retention/operations/team/resources/
// constraints/completedWork/unfinishedWork/currentPriorities/currentGoal/
// recentProgress/bottleneckCandidates/integrations/proofSummary), mapped
// onto the underlying fact-ledger key that actually carries it.
const SECTION_TO_FACT_KEY = Object.freeze({
  ideaSummary: 'idea',
  stage: 'currentStage',
  offer: 'offer',
  productOrService: 'productOrService',
  targetCustomer: 'targetCustomer',
  customerEvidence: 'customerEvidence',
  traction: 'traction',
  // Offer pricing (what is charged) and revenue (what has been earned) are
  // deliberately separate sections/fact keys -- see sections.js's header
  // comment for the confirmed bug this repairs.
  offerPricing: 'offerPricing',
  revenue: 'revenue',
  acquisition: 'acquisition',
  delivery: 'delivery',
  retention: 'retention',
  operations: 'operations',
  team: 'team',
  resources: 'availableResourceIds',
  constraints: 'constraints',
  completedWork: 'completedWork',
  unfinishedWork: 'unfinishedWork',
  currentPriorities: 'currentPriorities',
  currentGoal: 'immediateGoal',
  recentProgress: 'recentProgress',
  // Structural only — no bottleneck inference exists anywhere in this
  // system. This section can only ever be populated by a direct,
  // explicitly-reported currentBottleneck fact (see fact-ledger.js);
  // nothing derives or guesses a bottleneck.
  bottleneckCandidates: 'currentBottleneck',
  proofSummary: 'proofSummary',
});

const CRITICAL_SECTIONS = Object.freeze(['offer', 'targetCustomer', 'completedWork', 'unfinishedWork', 'currentGoal']);
const CONFIDENCE_WEIGHT = Object.freeze({
  proof_verified: 1, system_verified: 0.85, user_confirmed: 0.6, provisional: 0.3, disputed: 0.05,
});

/* ── Fact-specific freshness ───────────────────────────────────────────
   Age means different things to different facts. What a venture IS (its
   idea, who it sells to, its business model) does not expire on a clock --
   it changes only when the founder contradicts or explicitly updates it.
   What a venture is DOING right now (leads, traction, recent execution)
   genuinely decays. The previous rule made no such distinction: one global
   `max(lastVerifiedAt, lastConfirmedAt)` older than 30 days marked the
   ENTIRE state stale, which is precisely "lower confidence merely because
   every fact is old" -- a founder who answered everything honestly was
   downgraded for the passage of time alone.

   Windows are per TIER, not per fact, so this stays deterministic and
   auditable. `stable` never expires by time; only a contradiction or an
   explicit newer fact can change it. */
const DAY_MS = 24 * 60 * 60 * 1000;

export const FACT_FRESHNESS_WINDOW_MS = Object.freeze({
  stable: Number.POSITIVE_INFINITY,
  semi_stable: 90 * DAY_MS,
  volatile: 14 * DAY_MS,
});

const SECTION_FRESHNESS_TIER = Object.freeze({
  // Stable: identity//direction. Valid until contradicted or changed.
  ideaSummary: 'stable',
  targetCustomer: 'stable',
  currentGoal: 'stable',
  constraints: 'stable',
  productOrService: 'stable',
  stage: 'stable',
  // Semi-stable: how the venture currently operates -- may drift.
  offer: 'semi_stable',
  offerPricing: 'semi_stable',
  acquisition: 'semi_stable',
  resources: 'semi_stable',
  currentPriorities: 'semi_stable',
  delivery: 'semi_stable',
  operations: 'semi_stable',
  team: 'semi_stable',
  // Volatile: live execution state -- decays fast.
  customerEvidence: 'volatile',
  revenue: 'volatile',
  traction: 'volatile',
  retention: 'volatile',
  recentProgress: 'volatile',
  bottleneckCandidates: 'volatile',
  completedWork: 'volatile',
  unfinishedWork: 'volatile',
  proofSummary: 'volatile',
});

/* A stale or contradicted fact may only BLOCK the next mission when the
   engine actually depends on it. High-impact == the same set confidence is
   computed from (the critical sections plus pricing/customer evidence) plus
   the customerEntity collection. Everything else -- integrations, venture
   metadata, and the engine's OWN bookkeeping facts such as
   activeOutcomeThread -- is still recorded and still visible in
   `conflicts`, but can never pin a fully-answered venture to 'low'. */
const HIGH_IMPACT_SECTIONS = Object.freeze([...CRITICAL_SECTIONS, 'offerPricing', 'customerEvidence']);

// integrations is composed from the 4 independent per-provider fact keys
// (integrationGithub/integrationSupabase/integrationVercel/
// integrationWebsite — see sections.js) rather than being one shared fact
// key, so GitHub reporting connected while Vercel reports not-connected can
// never look like a "conflict" between two facts fighting over one field.
function composeIntegrationsSection(perKey) {
  const result = {};
  for (const provider of INTEGRATION_PROVIDERS) {
    const factKey = `integration${provider[0].toUpperCase()}${provider.slice(1)}`;
    result[provider] = fieldView(perKey, factKey);
  }
  return result;
}

function fieldView(perKey, factKey) {
  const fact = perKey[factKey];
  if (!fact) return { status: 'unknown' };
  return {
    status: 'known',
    value: fact.value,
    verificationStatus: fact.verificationStatus,
    sourceFactId: fact.factId,
    occurredAt: fact.occurredAt,
  };
}

// Task-decision confidence must be computed from the facts the Founder
// decision engine actually consults -- the critical context sections plus the
// route prerequisites in founder-execution-context/route-eligibility.js -- and
// nothing else. Averaging EVERY distinct ledger key meant an unrelated
// provisional extraction (businessModelFamily, team, recentProgress, ...)
// pulled the mean down, so recording MORE optional context made task
// generation LESS likely. Required facts that are still provisional do
// legitimately lower confidence; unrelated ones are simply not counted.
const CONFIDENCE_RELEVANT_FACT_KEYS = Object.freeze([
  ...CRITICAL_SECTIONS.map((section) => SECTION_TO_FACT_KEY[section]),
  'offerPricing', 'customerEvidence',
]);

// The customer-entity prerequisite is satisfied by ONE usable prospect (see
// route-eligibility.js), so the collection contributes a single best-trust
// member rather than one entry per prospect: holding five prospects must not
// dilute confidence, and confirming one must not be diluted by the other four.
const CONFIDENCE_AGGREGATE_GROUPS = Object.freeze([{ prefix: 'customerEntity:' }]);

// The algorithm is the shared Goal Engine invariant; only the key list and
// the aggregate group above are Founder's.
function computeConfidence(perKey) {
  return computeRelevantConfidence({
    facts: perKey,
    relevantFactKeys: CONFIDENCE_RELEVANT_FACT_KEYS,
    aggregateGroups: CONFIDENCE_AGGREGATE_GROUPS,
    weights: CONFIDENCE_WEIGHT,
  });
}

/**
 * @param {object} params
 * @param {string} params.ventureId
 * @param {string} params.ventureRole
 * @param {string} params.userId
 * @param {number} params.stateVersion Positive integer, incremented by the service on every accepted mutation.
 * @param {{ventureName: string|null, ventureType: string|null, ventureDomain: string|null, businessModel: string|null, description: string|null, status: string}} params.ventureRow
 * @param {ReturnType<import('./fact-ledger.js').rebuildStateFromFacts>} params.rebuilt
 * @param {string} params.evaluationTime ISO timestamp.
 * @returns {object} The complete materialised Table-B state shape.
 */
export function buildMaterialisedVentureState({
  ventureId, ventureRole, userId, stateVersion, ventureRow, rebuilt, evaluationTime,
}) {
  const { perKey, conflicts, lastVerifiedAt, lastConfirmedAt = null } = rebuilt;
  const sections = {};
  for (const [sectionName, factKey] of Object.entries(SECTION_TO_FACT_KEY)) {
    sections[sectionName] = fieldView(perKey, factKey);
  }

  return {
    contractVersion: FOUNDER_VENTURE_SNAPSHOT_VERSION,
    ventureId,
    ventureRole,
    userId,
    stateVersion,
    identity: {
      ventureName: ventureRow.ventureName ?? null,
      ventureType: ventureRow.ventureType ?? null,
      ventureDomain: ventureRow.ventureDomain ?? null,
    },
    ventureDefinition: {
      businessModel: ventureRow.businessModel ?? null,
      description: ventureRow.description ?? null,
    },
    ...sections,
    /* The engine's own bookkeeping thread, composed so it can be READ back.
       It was already a recognised fact key and already reached `perKey`, but
       nothing ever put it on the materialised state -- so
       founder-engine-bridge's `context.state?.activeOutcomeThread` was
       permanently undefined, with three consequences that all looked like
       separate bugs:
         - every run reported has_active_thread false even with a live thread;
         - activeThreadFactId stayed null, so persistence APPENDED a new thread
           fact instead of superseding the old one, leaving several active at
           once (the duplicate records the blockingConflicts filter below was
           written to tolerate);
         - decideRightNextMove always received activeThread null, so every
           decision was 'start' and taskVersion could never leave 1, silently
           disabling keep/refine/replace and the meaningful-event gate.
       Deliberately NOT added to SECTION_TO_FACT_KEY: that map drives
       confidence, clarification questions and freshness, and this is engine
       bookkeeping, not a founder-supplied section. */
    activeOutcomeThread: fieldView(perKey, 'activeOutcomeThread'),
    integrations: composeIntegrationsSection(perKey),
    // Founder Execution Entities: minimal structured references to real
    // business objects (identified prospects, a real operating process, an
    // open strategy decision) -- grouped straight out of the SAME rebuilt
    // fact-ledger reducer output above, never a second persisted
    // collection (see entity-snapshot.js).
    entities: buildEntityCollections(rebuilt, ventureId),
    /* Display/diagnostic only -- nothing routes an answer through this list,
       so it stays the plain string[] its own validator and the shadow-run
       response already declare. The identified form lives where answers are
       actually routed (computeDraftView / clarificationQuestionsDetailed). */
    unresolvedQuestions: computeClarificationQuestions(perKey, conflicts).map((entry) => entry.question),
    conflicts,
    confidence: computeConfidence(perKey),
    lastVerifiedAt,
    lastConfirmedAt,
    updatedAt: evaluationTime,
  };
}

const MATERIALISED_STATE_TOP_FIELDS = Object.freeze([
  'contractVersion', 'ventureId', 'ventureRole', 'userId', 'stateVersion', 'identity', 'ventureDefinition',
  ...Object.keys(SECTION_TO_FACT_KEY), 'integrations', 'entities', 'unresolvedQuestions', 'conflicts', 'confidence',
  'lastVerifiedAt', 'updatedAt',
]);
// Accepted but not required, so a state row persisted before this field
// existed stays valid and is simply treated as never-confirmed until its next
// rebuild. Requiring it would turn every already-stored venture into
// invalid_stored_state, which venture-row-probe.js reports BEFORE
// loadOrRebuildFounderTrustedContext gets a chance to refresh the cache.
const MATERIALISED_STATE_OPTIONAL_FIELDS = Object.freeze(['lastConfirmedAt', 'activeOutcomeThread']);

const ENTITY_COLLECTION_NAMES = Object.freeze(['customerEntities', 'operatingProcessEntities', 'strategyDecisionEntities']);
const ENTITY_VIEW_FIELDS = Object.freeze([
  'entityId', 'entityType', 'ventureId', 'lifecycleStatus', 'verificationStatus', 'value',
  'sourceFactId', 'provenance', 'confidence', 'firstObservedAt', 'lastConfirmedAt', 'conflicts',
]);

function isEntityViewShape(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return ENTITY_VIEW_FIELDS.every((field) => Object.hasOwn(value, field)) && Array.isArray(value.conflicts);
}

// Lightweight structural check only -- full semantic/trust validation of a
// PROJECTED bundle happens in entity-snapshot.js's
// validateFounderExecutionEntities (called separately by the owner-shadow
// probe on buildFounderExecutionEntities's output, never here).
function isEntityCollectionsShape(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== ENTITY_COLLECTION_NAMES.length || !ENTITY_COLLECTION_NAMES.every((name) => keys.includes(name))) return false;
  return ENTITY_COLLECTION_NAMES.every((name) => Array.isArray(value[name]) && value[name].every(isEntityViewShape));
}

function isSectionFieldViewShape(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.status === 'unknown') return Object.keys(value).length === 1;
  if (value.status === 'known') {
    return ['status', 'value', 'verificationStatus', 'sourceFactId', 'occurredAt'].every((key) => Object.hasOwn(value, key));
  }
  return false;
}

/**
 * Structurally re-validates a raw `founder_venture_state.state` jsonb value
 * before ANY of its fields are trusted — the V2 equivalent of V1's
 * validatePreviousVentureState. A caller (e.g. the owner shadow run) must
 * call this on raw table JSON before ever calling
 * buildFounderGoalEngineSnapshot() on it; a malformed/tampered/mismatched
 * row fails closed here instead of silently propagating.
 *
 * @param {unknown} state
 * @param {string} expectedVentureId
 * @param {string} expectedVentureRole
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateMaterialisedVentureState(state, expectedVentureId, expectedVentureRole) {
  const errors = [];
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, errors: ['state must be a plain object'] };
  }
  for (const field of MATERIALISED_STATE_TOP_FIELDS) {
    if (!Object.hasOwn(state, field)) errors.push(`missing required field: state.${field}`);
  }
  for (const field of Object.keys(state)) {
    if (!MATERIALISED_STATE_TOP_FIELDS.includes(field) && !MATERIALISED_STATE_OPTIONAL_FIELDS.includes(field)) {
      errors.push(`unknown state field: ${field}`);
    }
  }
  if (errors.length > 0) return { valid: false, errors };

  if (state.contractVersion !== FOUNDER_VENTURE_SNAPSHOT_VERSION) errors.push(`state.contractVersion must be ${FOUNDER_VENTURE_SNAPSHOT_VERSION}`);
  if (state.ventureId !== expectedVentureId) errors.push('state.ventureId does not match the expected ventureId');
  if (state.ventureRole !== expectedVentureRole) errors.push('state.ventureRole does not match the expected ventureRole (secondary cannot be passed as primary, or vice versa)');
  if (!['primary', 'secondary'].includes(state.ventureRole)) errors.push('state.ventureRole must be primary or secondary');
  if (!Number.isInteger(state.stateVersion) || state.stateVersion < 1) errors.push('state.stateVersion must be a positive integer');
  if (!Number.isFinite(state.confidence) || state.confidence < 0 || state.confidence > 1) errors.push('state.confidence must be a number from 0 to 1');
  if (!Array.isArray(state.conflicts)) errors.push('state.conflicts must be an array');
  if (!Array.isArray(state.unresolvedQuestions) || state.unresolvedQuestions.length > 3) errors.push('state.unresolvedQuestions must be an array of at most 3 questions');

  for (const sectionName of Object.keys(SECTION_TO_FACT_KEY)) {
    if (!isSectionFieldViewShape(state[sectionName])) errors.push(`state.${sectionName} is not a valid known/unknown section view`);
  }
  if (state.identity === null || typeof state.identity !== 'object') errors.push('state.identity must be a plain object');
  if (state.ventureDefinition === null || typeof state.ventureDefinition !== 'object') errors.push('state.ventureDefinition must be a plain object');
  if (!isEntityCollectionsShape(state.entities)) errors.push('state.entities is not a valid entity-collections shape');
  if (state.integrations === null || typeof state.integrations !== 'object') {
    errors.push('state.integrations must be a plain object');
  } else {
    for (const provider of INTEGRATION_PROVIDERS) {
      if (!isSectionFieldViewShape(state.integrations[provider])) errors.push(`state.integrations.${provider} is not a valid known/unknown section view`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// Freshness means "the evidence we hold is CURRENT", not "this was just
// computed" -- a rebuild running now must never by itself make a venture
// look fresh.
//
// Currency can be established two ways, and only these two:
//   - lastVerifiedAt   -- a proof_verified/system_verified fact (unchanged).
//   - lastConfirmedAt  -- a fact the founder affirmatively confirmed.
//
// A confirmation is NOT a proof, and this function is the only place the two
// are treated alike. Trust is unaffected everywhere else: verificationStatus
// is untouched, CONFIDENCE_WEIGHT still scores user_confirmed at 0.6 vs
// proof_verified at 1, and provenanceSummary still reports them separately --
// so a confirmed-but-unproven venture still cannot reach 'high' confidence.
//
// Without this, a brand-new venture whose intake is fully confirmed had
// lastVerifiedAt === null, was therefore permanently 'stale', and the stale
// downgrade in founder-bottleneck/confidence.js pinned it to 'low' forever --
// which todays-move.js treats as "never select". Intake-only ventures could
// never receive a first Today's Move at all. Both timestamps still age out of
// the same staleAfterMs window, so a confirmation genuinely goes stale later.
/**
 * Per-section staleness against that section's own tier window.
 *
 * `staleScaleMs` scales every FINITE tier window (it is the legacy
 * `staleAfterMs` parameter, kept so existing callers/tests can still shorten
 * or lengthen the horizon); `stable` stays infinite regardless, because a
 * stable fact is only ever invalidated by contradiction or explicit change,
 * never by the clock.
 *
 * @returns {{section: string, tier: string, stale: boolean, highImpact: boolean}[]}
 */
function evaluateSectionFreshness(state, evaluationTime, staleScaleMs) {
  const now = Date.parse(evaluationTime);
  const scale = Number.isFinite(staleScaleMs) && staleScaleMs > 0
    ? staleScaleMs / (30 * DAY_MS)
    : 1;
  const results = [];
  for (const [section, tier] of Object.entries(SECTION_FRESHNESS_TIER)) {
    const field = state[section];
    // An unknown section is a MISSING-context problem, never a staleness
    // one -- missingCriticalContext already reports it, and double-counting
    // it here would penalise the same gap twice.
    if (!field || field.status !== 'known') continue;
    const window = FACT_FRESHNESS_WINDOW_MS[tier];
    const observedAt = Date.parse(field.occurredAt);
    const stale = Number.isFinite(window)
      && Number.isFinite(observedAt)
      && Number.isFinite(now)
      && (now - observedAt) > (window * scale);
    results.push({
      section, tier, stale, highImpact: HIGH_IMPACT_SECTIONS.includes(section),
    });
  }
  return results;
}

/**
 * Builds the read-only Goal Engine snapshot from an already-composed
 * materialised state. Never merges primary and secondary (operates on one
 * venture at a time); never claims a section is more certain than its
 * recorded verificationStatus; contains no secrets (the materialised state
 * never carries any — see fact-ledger.js's metadata contract).
 *
 * @param {object} state buildMaterialisedVentureState(...)'s result.
 * @param {string} evaluationTime ISO timestamp "now".
 * @param {number} [staleAfterMs] Defaults to 30 days.
 * @returns {object}
 */
export function buildFounderGoalEngineSnapshot(state, evaluationTime, staleAfterMs = 30 * 24 * 60 * 60 * 1000) {
  const missingCriticalContext = CRITICAL_SECTIONS.filter((section) => state[section].status === 'unknown');
  const provenanceCounts = {};
  for (const sectionName of Object.keys(SECTION_TO_FACT_KEY)) {
    const section = state[sectionName];
    if (section.status === 'known') {
      provenanceCounts[section.verificationStatus] = (provenanceCounts[section.verificationStatus] || 0) + 1;
    }
  }

  const sectionFreshness = evaluateSectionFreshness(state, evaluationTime, staleAfterMs);
  const staleHighImpactSections = sectionFreshness.filter((f) => f.stale && f.highImpact).map((f) => f.section);
  const staleLowImpactSections = sectionFreshness.filter((f) => f.stale && !f.highImpact).map((f) => f.section);

  /* The currency anchor. Freshness means "the evidence we hold is CURRENT",
     so something must have affirmatively established that currency -- either
     a verification (lastVerifiedAt) or a founder confirmation
     (lastConfirmedAt), per the contract documented above evaluateSectionFreshness.

     The impact-aware section sweep above answers a NARROWER question: "has a
     section we already trust aged out?" It reads only `occurredAt` and never
     `verificationStatus`, so on its own it calls a venture fresh whenever no
     KNOWN high-impact section has expired -- which is true of a venture whose
     facts are all unconfirmed guesses, and vacuously true of a venture with no
     known sections at all. Both then read as fresh without a single piece of
     evidence anyone verified or confirmed.

     So the two rules compose as a conjunction rather than the sweep replacing
     the anchor: currency must be established AND still unexpired, and no
     high-impact section may have aged out. Fails closed -- a missing or
     unparseable timestamp is treated as "never confirmed", never as now. */
  const anchorMs = [state.lastVerifiedAt, state.lastConfirmedAt]
    .map((timestamp) => Date.parse(timestamp ?? ''))
    .filter((parsed) => Number.isFinite(parsed))
    .reduce((newest, parsed) => Math.max(newest, parsed), -Infinity);
  const evaluatedMs = Date.parse(evaluationTime);
  const currencyIsCurrent = Number.isFinite(anchorMs)
    && Number.isFinite(evaluatedMs)
    && (evaluatedMs - anchorMs) <= staleAfterMs;

  /* Contradictions are NEVER weakened or hidden: `conflicts` still carries
     every one, exactly as before. `blockingConflicts` is an additive,
     narrower view -- only those on facts the engine actually depends on --
     so a disagreement between two engine-internal activeOutcomeThread
     records cannot pin a fully-answered venture to 'low' forever (observed
     on staging). Every genuine high-impact contradiction still blocks. */
  const blockingConflicts = (state.conflicts || []).filter((conflict) => (
    HIGH_IMPACT_SECTIONS.some((section) => SECTION_TO_FACT_KEY[section] === conflict.factKey)
    || String(conflict.factKey || '').startsWith('customerEntity:')
  ));

  return {
    contractVersion: FOUNDER_VENTURE_SNAPSHOT_VERSION,
    ventureId: state.ventureId,
    ventureRole: state.ventureRole,
    identity: state.identity,
    ventureDefinition: state.ventureDefinition,
    stage: state.stage,
    currentGoal: state.currentGoal,
    completedWork: state.completedWork,
    unfinishedWork: state.unfinishedWork,
    currentPriorities: state.currentPriorities,
    customerEvidence: state.customerEvidence,
    traction: state.traction,
    offerPricing: state.offerPricing,
    revenue: state.revenue,
    resources: state.resources,
    constraints: state.constraints,
    recentProgress: state.recentProgress,
    unresolvedQuestions: state.unresolvedQuestions,
    conflicts: state.conflicts,
    blockingConflicts,
    missingCriticalContext,
    confidence: state.confidence,
    // Fresh requires BOTH: currency was affirmatively established and has not
    // expired, AND no high-impact section has aged out. Impact-aware as
    // before -- only a stale HIGH-IMPACT fact marks the whole snapshot stale;
    // stale low-impact facts are reported separately and never block
    // generation on their own.
    freshness: currencyIsCurrent && staleHighImpactSections.length === 0 ? 'fresh' : 'stale',
    staleHighImpactSections,
    staleLowImpactSections,
    stateVersion: state.stateVersion,
    provenanceSummary: provenanceCounts,
  };
}

const SNAPSHOT_REQUIRED_FIELDS = Object.freeze([
  'contractVersion', 'ventureId', 'ventureRole', 'identity', 'ventureDefinition', 'stage', 'currentGoal',
  'completedWork', 'unfinishedWork', 'currentPriorities', 'customerEvidence', 'traction', 'offerPricing', 'revenue',
  'resources', 'constraints', 'recentProgress', 'unresolvedQuestions', 'conflicts', 'missingCriticalContext',
  'confidence', 'freshness', 'stateVersion', 'provenanceSummary',
  // Additive, impact-aware freshness/contradiction detail (see
  // SECTION_FRESHNESS_TIER). `conflicts` and `freshness` keep their original
  // meaning for every existing consumer.
  'blockingConflicts', 'staleHighImpactSections', 'staleLowImpactSections',
]);

/**
 * Structural validation for a snapshot before it is trusted by any
 * downstream consumer (owner shadow run, a future request-integration
 * attachment point). Fails closed on any missing/unknown field, matching
 * the same exact-fields discipline contract.js already applies elsewhere.
 */
export function validateFounderGoalEngineSnapshot(snapshot) {
  const errors = [];
  if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { valid: false, errors: ['snapshot must be a plain object'] };
  }
  for (const field of SNAPSHOT_REQUIRED_FIELDS) {
    if (!Object.hasOwn(snapshot, field)) errors.push(`missing required field: snapshot.${field}`);
  }
  for (const field of Object.keys(snapshot)) {
    if (!SNAPSHOT_REQUIRED_FIELDS.includes(field)) errors.push(`unknown snapshot field: ${field}`);
  }
  if (errors.length) return { valid: false, errors };
  if (snapshot.contractVersion !== FOUNDER_VENTURE_SNAPSHOT_VERSION) errors.push(`snapshot.contractVersion must be ${FOUNDER_VENTURE_SNAPSHOT_VERSION}`);
  if (!['primary', 'secondary'].includes(snapshot.ventureRole)) errors.push('snapshot.ventureRole must be primary or secondary');
  if (!['fresh', 'stale'].includes(snapshot.freshness)) errors.push('snapshot.freshness must be fresh or stale');
  if (!Number.isFinite(snapshot.confidence) || snapshot.confidence < 0 || snapshot.confidence > 1) {
    errors.push('snapshot.confidence must be a number from 0 to 1');
  }
  if (!Number.isInteger(snapshot.stateVersion) || snapshot.stateVersion < 1) errors.push('snapshot.stateVersion must be a positive integer');
  if (!Array.isArray(snapshot.unresolvedQuestions) || snapshot.unresolvedQuestions.length > 3) {
    errors.push('snapshot.unresolvedQuestions must be an array of at most 3 questions');
  }
  return { valid: errors.length === 0, errors };
}
