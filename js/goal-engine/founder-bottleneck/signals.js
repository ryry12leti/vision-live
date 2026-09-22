/**
 * Founder Bottleneck Intelligence — deterministic evidence readers.
 *
 * Every function here reads ONLY fields that actually exist on a validated
 * buildFounderGoalEngineSnapshot(...) output or a validated
 * buildFounderExecutionEntities(...) bundle -- never invents a field, never
 * reads raw browser/chat JSON. Keyword scans operate only over founder-
 * reported free text that is already part of the trusted snapshot
 * (constraints, currentPriorities, recentProgress, currentGoal) -- a
 * deterministic pattern match, not an LLM inference -- and every match is
 * reported back in evidenceReferences so a human can verify it.
 */

import { isUsableEntity } from '../founder-venture-state/index.js';

function known(field) {
  return field && field.status === 'known';
}
function value(field) {
  return known(field) ? field.value : undefined;
}

export function isFresh(bundle) {
  return bundle.freshness === 'fresh';
}

// ---------------------------------------------------------------------------
// Customer / demand evidence.
// ---------------------------------------------------------------------------
export function customerCount(snapshot) {
  const v = value(snapshot.customerEvidence);
  return typeof v?.customerCount === 'number' ? v.customerCount : 0;
}
export function hasPayingCustomers(snapshot) {
  return value(snapshot.customerEvidence)?.hasPayingCustomers === true;
}
export function customerEvidenceType(snapshot) {
  return value(snapshot.customerEvidence)?.evidenceType ?? null;
}
export function hasAnyCustomerEvidence(snapshot) {
  return known(snapshot.customerEvidence) && (customerCount(snapshot) > 0 || customerEvidenceType(snapshot) !== 'none');
}

export function usableCustomerEntities(entityBundle) {
  return (entityBundle.customerEntities || []).filter(isUsableEntity);
}
export function reachableCustomerEntities(entityBundle) {
  return usableCustomerEntities(entityBundle).filter((entity) => entity.value.contactability === 'reachable');
}
export function payingOrConvertedCustomerEntities(entityBundle) {
  return usableCustomerEntities(entityBundle).filter((entity) => ['customer'].includes(entity.value.relationshipType) && entity.value.customerStatus === 'active');
}

// ---------------------------------------------------------------------------
// Per-entity engagement / pending-request signals (customerEntity.value's
// optional engagementState/pendingRequest fields -- see founder-venture-state/
// entities.js). A warm prospect who has already been contacted and asked for
// a specific next step (proof/pricing/proposal/meeting) is a materially
// different, higher-leverage bottleneck than "not enough reachable
// prospects" -- but only ever read from an entity a founder actually
// reported on; never inferred from silence.
export function entitiesWithPendingRequest(entityBundle, requestType = null) {
  return usableCustomerEntities(entityBundle).filter((entity) => (
    Boolean(entity.value.pendingRequest) && (requestType === null || entity.value.pendingRequest === requestType)
  ));
}
export function entitiesAwaitingResponse(entityBundle) {
  return usableCustomerEntities(entityBundle).filter((entity) => (
    ['contacted', 'follow_up_needed'].includes(entity.value.engagementState) && !entity.value.pendingRequest
  ));
}

// ---------------------------------------------------------------------------
// Offer / pricing / revenue.
// ---------------------------------------------------------------------------
export function offerKnown(snapshot) {
  return known(snapshot.offerPricing);
}
export function offerPublished(snapshot) {
  return value(snapshot.offerPricing)?.pricingStatus === 'published';
}
export function revenueAmount(snapshot) {
  const v = value(snapshot.revenue);
  return typeof v?.amount === 'number' ? v.amount : 0;
}
export function hasRealRevenue(snapshot) {
  return known(snapshot.revenue) && revenueAmount(snapshot) > 0;
}

// ---------------------------------------------------------------------------
// Delivery / work state.
// ---------------------------------------------------------------------------
/* A founder answering "what is unfinished?" with "Nothing major is unfinished"
   has reported the ABSENCE of unfinished work, but the answer is still stored
   as a list item -- so it counted as one outstanding item and handed a SaaS
   business a 50-point product/delivery bottleneck for work it had explicitly
   said was done. It also reached the mission compiler, which builds titles as
   `Complete and verify: ${item}` -- i.e. "Complete and verify: Nothing major is
   unfinished".
   Filtered at the source so every consumer agrees. Deliberately narrow: only a
   statement that IS a negation is dropped. "No manufacturer and no samples"
   names real missing work and is kept, because it says what is absent from the
   business, not that nothing is outstanding. */
const NOTHING_OUTSTANDING_PATTERNS = Object.freeze([
  /^\s*(?:nothing|none|nil|n\/a)\b/i,
  /^\s*no\s+(?:unfinished|outstanding|remaining|pending)\b/i,
  /* Allows words between the subject and the verb ("All SETUP WORK is
     complete") but stays inside one short clause, and the caller below refuses
     to apply it when the sentence carves out an exception ("all the copy is
     done EXCEPT the pricing page"), which genuinely names remaining work. */
  /\b(?:all|everything)\b[^.!?]{0,40}?\b(?:is|are|has\s+been|have\s+been)\s+(?:done|finished|complete|completed)\b/i,
  /\bnothing\s+(?:is\s+)?(?:left|outstanding|remaining|pending|unfinished)\b/i,
]);

/* A carve-out means the sentence names real remaining work no matter how it
   opens, so the negation patterns must not apply to it. */
const CARVE_OUT_RE = /\b(?:except|apart from|other than|besides|but\s+(?:the|i|we|it)|still\s+(?:need|have|to)|remaining|left\s+to\s+do)\b/i;

/** Comparison key for work items. Whitespace/case/trailing punctuation only --
 *  never fuzzy: two genuinely different items must never collapse into one. */
export function workItemKey(entry) {
  return String(entry ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '');
}

export function unfinishedWorkItems(snapshot) {
  const items = known(snapshot.unfinishedWork) ? value(snapshot.unfinishedWork) : [];
  /* Work the founder has FINISHED is not unfinished work, however it got onto
     the list. This is the chokepoint every consumer reads through -- the
     bottleneck's delivery score, the sales/delivery split, and the mission
     compiler that titles the task after unfinishedWorkItems(...)[0] -- so
     filtering here is what lets a founder advance through their own backlog
     instead of being handed the same item forever.
     It matters because completing a task changes nothing else: the founder
     fixed the webhook and passed proof, `unfinishedWork` still said "webhook
     processing fails", the mission recomputed identically, and
     decideRightNextMove correctly returned 'keep'. What actually moved them was
     gateDuplicateRecentWork eliminating the correct candidate as a duplicate --
     so they advanced onto UNRELATED work while the real item stayed open, and
     by the third day the venture fell into a clarification dead end.
     Exact normalised match only (see workItemKey). A founder who wrote the same
     sentence under both headings meant the same thing by it. */
  const finished = new Set(completedWorkItems(snapshot).map(workItemKey));
  return (Array.isArray(items) ? items : []).filter((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) return false;
    if (finished.has(workItemKey(entry))) return false;
    if (CARVE_OUT_RE.test(entry)) return true;
    return !NOTHING_OUTSTANDING_PATTERNS.some((pattern) => pattern.test(entry));
  });
}
export function completedWorkItems(snapshot) {
  const items = known(snapshot.completedWork) ? value(snapshot.completedWork) : [];
  return Array.isArray(items) ? items : [];
}

// ---------------------------------------------------------------------------
// Operating process / strategy entities.
// ---------------------------------------------------------------------------
const PROCESS_FAILURE_KEYWORDS = /\b(fail|failing|failed|broken|breaks|breaking|blocked|delay|delayed|error|manual workaround)\b/i;

export function usableOperatingProcessEntities(entityBundle) {
  return (entityBundle.operatingProcessEntities || []).filter(isUsableEntity);
}
export function failingOperatingProcessEntities(entityBundle) {
  return usableOperatingProcessEntities(entityBundle).filter((entity) => (
    Boolean(entity.value.failurePointId) || PROCESS_FAILURE_KEYWORDS.test(entity.value.currentProcessState || '')
  ));
}
export function usableOpenStrategyDecisions(entityBundle) {
  return (entityBundle.strategyDecisionEntities || [])
    .filter(isUsableEntity)
    .filter((entity) => entity.value.decisionStatus === 'open' && (entity.value.optionIds || []).length >= 2);
}

// ---------------------------------------------------------------------------
// Free-text keyword signals -- deterministic pattern matching over
// founder-reported strings only (never AI-generated inference).
// ---------------------------------------------------------------------------
const SURVIVAL_KEYWORDS = /\b(out of (cash|money|runway)|no runway|running out of (cash|money)|can'?t (make )?payroll|cannot (make )?payroll|insolven|bankrupt|shut(ting)? down|close the business|going under)\b/i;
const RETENTION_KEYWORDS = /\b(churn(ing)?|cancel(l?ed|l?ing|s)?|stopped using|inactive users?|drop[- ]?off|not coming back|unsubscrib)\b/i;
const OPERATIONS_KEYWORDS = /\b(keeps breaking|manual workaround|constant errors?|bottleneck in (fulfil?lment|delivery|support)|too many (support tickets|errors))\b/i;

function textPool(snapshot) {
  const pool = [];
  if (known(snapshot.constraints)) pool.push(...value(snapshot.constraints));
  if (known(snapshot.currentPriorities)) pool.push(...value(snapshot.currentPriorities));
  if (known(snapshot.recentProgress)) pool.push(...value(snapshot.recentProgress));
  if (known(snapshot.currentGoal)) pool.push(value(snapshot.currentGoal));
  return pool.filter((entry) => typeof entry === 'string' && entry.length > 0);
}

function scanKeywords(snapshot, pattern) {
  return textPool(snapshot).filter((entry) => pattern.test(entry));
}

export function survivalSignalMatches(snapshot) {
  return scanKeywords(snapshot, SURVIVAL_KEYWORDS);
}
export function retentionSignalMatches(snapshot) {
  return scanKeywords(snapshot, RETENTION_KEYWORDS);
}
export function operationsSignalMatches(snapshot) {
  return scanKeywords(snapshot, OPERATIONS_KEYWORDS);
}

// unfinishedWork is a generic "what is still not done" list -- it is NOT a
// product backlog. A founder legitimately records sales/acquisition work in
// it ("I have never done any B2B outreach to nearby offices"), and counting
// that toward product/delivery throughput misattributes an acquisition gap
// as an engineering one. Same deterministic keyword-scan approach as the
// signals above, and every match is surfaced in supportingEvidence so a
// human can verify the split.
/* "new customers" was listed but "new CLIENTS" was not, so a real agency
   answer -- "I have no repeatable way of getting new clients, it has all been
   referrals" -- was filed as product/delivery work. That handed a 50-point
   delivery score to a founder whose gap was purely acquisition, and starved
   the acquisition category of the founder's own strongest statement about it.
   Service businesses say "clients"; the vocabulary now covers how founders
   actually describe winning work, not just product-company phrasing. */
const SALES_SHAPED_WORK_KEYWORDS = /\b(outreach|cold (call|email|dm)|prospect(ing|s)?|lead gen(eration)?|pitch(ed|ing)?|follow[- ]?up|sales call|b2b|wholesale account|new (customers?|clients?|business)|(get|getting|win|winning|sign|signing|land|landing|find|finding)\s+(?:(?:my|our|the|a|some|new|more|extra|additional|paying|first)\s+){0,3}(customers?|clients?|business)|referral|repeatable way|acquisition channel|marketing|advertis|promot|partnership)\b/i;

export function unfinishedWorkSplitByFunction(snapshot) {
  const items = unfinishedWorkItems(snapshot).filter((entry) => typeof entry === 'string' && entry.length > 0);
  const salesShaped = items.filter((entry) => SALES_SHAPED_WORK_KEYWORDS.test(entry));
  const salesSet = new Set(salesShaped);
  return { salesShaped, deliveryShaped: items.filter((entry) => !salesSet.has(entry)) };
}

/** Canonical resource ids the founder has declared they genuinely have. */
export function declaredResourceIds(snapshot) {
  const declared = value(snapshot.resources);
  return Array.isArray(declared) ? declared.filter((id) => typeof id === 'string' && id) : [];
}


// ---------------------------------------------------------------------------
// Stage.
// ---------------------------------------------------------------------------
export function declaredStage(snapshot) {
  return known(snapshot.stage) ? value(snapshot.stage) : null;
}
const BUILDING_OR_LATER_STAGES = new Set([
  'product_building', 'launch_preparation', 'customer_acquisition', 'delivery', 'retention', 'operations', 'team_and_hiring', 'scaling', 'strategy_and_capital',
]);
export function stageSuggestsBuildingContinues(snapshot) {
  const stage = declaredStage(snapshot);
  return stage !== null && BUILDING_OR_LATER_STAGES.has(stage);
}
