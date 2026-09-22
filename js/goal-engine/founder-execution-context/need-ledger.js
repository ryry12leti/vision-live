/**
 * Founder Execution Context — the need ledger.
 *
 * ONE ranked answer to "what is the single highest-value thing to ask next",
 * derived from the Goal Engine's own verdicts rather than restated alongside
 * them.
 *
 * WHAT THIS REPLACES. clarification.js ordered route prerequisites by a
 * hand-written constant:
 *
 *   const PRIORITY_ORDER = ['offer', 'offerPricing_or_currentGoal', ...];
 *   // "an unknown offer blocks the most routes ... so it is asked before a
 *   //  narrower single-route gap"
 *
 * The reasoning in that comment is sound and the list was a fair snapshot of
 * it -- but it is reasoning ABOUT route eligibility, frozen into a literal, in
 * a different file from the routes. Add a route, change a prerequisite, and the
 * list is silently wrong with nothing to catch it. This module measures the
 * same thing it was approximating: how many routes actually name this key as
 * their blocker, counted from the evaluations route-eligibility.js just
 * produced.
 *
 * NOT A SECOND DEFINITION OF WHAT MATTERS. Every input here is an existing
 * verdict: route-eligibility decides which routes are blocked and on what,
 * the snapshot decides what is known and what conflicts, and
 * FOUNDER_QUESTION_CATALOG decides which fact keys an answer writes. This
 * module contains no opinion about which facts are important -- only the
 * comparator that orders what the engine already said.
 */

import { FOUNDER_QUESTION_CATALOG, QUESTION_ID_BY_CONFLICTED_FACT, QUESTION_ID_BY_MISSING_FACT } from './contract.js';

/** Ranked worst-first. A conflict cannot be resolved by more context, so it
 *  outranks a gap; a gap the bottleneck assessment needs outranks one only a
 *  single route needs. */
export const NEED_KINDS = Object.freeze([
  'conflict', 'missing_critical', 'route_prerequisite', 'understanding_floor', 'entity_prerequisite',
]);
const KIND_RANK = Object.freeze(Object.fromEntries(NEED_KINDS.map((kind, index) => [kind, index])));

/* Which snapshot SECTIONS a route prerequisite key stands for.
 *
 * This is a naming map, not a judgement: route-eligibility.js emits two
 * compound keys that do not name a section directly, and this says which
 * sections each covers. It deliberately encodes no opinion about importance --
 * that is measured, below.
 *
 * Everything else is already a section name, because route-eligibility resolves
 * it through unknownFields(snapshot, fields), which indexes the snapshot by
 * exactly these names. */
const PREREQUISITE_SECTIONS = Object.freeze({
  offerPricing_or_currentGoal: Object.freeze(['offerPricing', 'currentGoal']),
  customerEvidence_no_real_customers_yet: Object.freeze(['customerEvidence']),
});

/* THE UNDERSTANDING FLOOR.
 *
 * What VISION must understand about a venture to advise it honestly -- not what
 * the Goal Engine minimally needs to emit a task. Those are different bars, and
 * conflating them is how an engine ends up confidently advising a business it
 * cannot describe. A task being technically generatable is not a reason to stop
 * asking.
 *
 * MEMBERSHIP only. This list says WHICH facts matter; it holds no opinion about
 * order or urgency -- that stays measured, in the comparator below. So this is
 * not a second question-priority algorithm, and there is still exactly one.
 *
 * Most of these already reach the ledger as missing_critical or a route
 * prerequisite. The four marked `floorOnly` do not reach it any other way: no
 * route blocks on them and they are not CRITICAL_SECTIONS, so without this they
 * would simply never be asked -- which is the failure this floor exists to
 * prevent.
 *
 * `relevantWhen` keeps a question from being asked of a founder it cannot help:
 * outreachChannel matters when the venture is acquisition-shaped, and that is
 * read from the live route evaluations rather than guessed. */
const OUTREACH_SHAPED_ROUTES = Object.freeze(['founder_sales_outreach_block', 'founder_customer_interview_set', 'founder_offer_test']);

export const FOUNDER_UNDERSTANDING_FLOOR = Object.freeze([
  { factKey: 'idea', questionId: 'what_building', floorOnly: true },
  { factKey: 'offer', questionId: 'offer_detail' },
  { factKey: 'offerPricing', questionId: 'offer_price' },
  { factKey: 'targetCustomer', questionId: 'who_for' },
  { factKey: 'immediateGoal', questionId: 'next_outcome' },
  { factKey: 'customerEvidence', questionId: 'evidence' },
  { factKey: 'completedWork', questionId: 'completed' },
  { factKey: 'unfinishedWork', questionId: 'unfinished' },
  { factKey: 'currentBottleneck', questionId: 'current_bottleneck', floorOnly: true },
  {
    factKey: 'outreachChannel',
    questionId: 'outreach_channel',
    floorOnly: true,
    relevantWhen: (routeEvaluations) => routeEvaluations.some((route) => (
      OUTREACH_SHAPED_ROUTES.includes(route.routeId) && route.eligibility !== 'not_relevant')),
  },
  { factKey: 'constraints', questionId: 'resources_constraints', floorOnly: true },
]);

/* The floor reads the fact ledger's own perKey, not the snapshot: `idea`,
   `currentBottleneck`, `outreachChannel` and `constraints` are not projected
   onto the Goal Engine snapshot at all, so a snapshot-only check would report
   them permanently unknown and ask forever. */
function floorFactIsKnown(factKey, perKey, snapshot) {
  if (perKey && perKey[factKey]) return true;
  return snapshot?.[factKey]?.status === 'known';
}

function sectionsFor(missingFactKey) {
  return PREREQUISITE_SECTIONS[missingFactKey] || [missingFactKey];
}

/**
 * Can a text answer actually clear this blocker?
 *
 * DERIVED FROM LIVE STATE, not declared. route-eligibility.js reports a key as
 * missing for one of two different reasons, and the difference decides whether
 * asking is useful:
 *
 *   - the section is UNKNOWN -- nothing is recorded, so any honest answer
 *     records it and the route re-evaluates. 'certain'.
 *   - the section is KNOWN but its VALUE does not qualify -- e.g.
 *     founder_retention_analysis emits customerEvidence_no_real_customers_yet
 *     only when customerEvidence IS known and neither customerCount > 0 nor
 *     hasPayingCustomers is true (route-eligibility.js:127-133). A founder who
 *     has already said "no paying clients yet" cannot make that true by saying
 *     it again. 'value_gated'.
 *
 * The rule is the same one either way -- is a section this key covers already
 * known? -- so it stays correct for the compound keys without special-casing
 * them. offerPricing_or_currentGoal is emitted only when NEITHER section is
 * known, so it resolves to 'certain'; customerEvidence_no_real_customers_yet is
 * emitted only when the section IS known, so it resolves to 'value_gated'.
 *
 * @returns {'certain'|'value_gated'}
 */
function satisfiabilityOf(missingFactKey, snapshot) {
  const alreadyKnown = sectionsFor(missingFactKey)
    .some((section) => snapshot?.[section]?.status === 'known');
  return alreadyKnown ? 'value_gated' : 'certain';
}

/**
 * How many currently-blocked routes name this key as their blocker.
 *
 * MEASURED, never declared. This is the number PRIORITY_ORDER's comment was
 * reasoning about; counting it from the live evaluations means adding a route
 * or changing a prerequisite updates the ordering automatically, instead of
 * leaving a literal in another file quietly wrong.
 *
 * Scoped to 'clarification_required' for the same reason clarification.js
 * scopes its scan there: a 'blocked' route is waiting on a RESOURCE
 * (repositoryAccess, cohortData, ...), which is not a fact a founder can state,
 * and those keys are not in the question catalog at all.
 */
function unblockedRoutesFor(missingFactKey, routeEvaluations) {
  return routeEvaluations
    .filter((route) => route.eligibility === 'clarification_required'
      && route.missingPrerequisites.includes(missingFactKey))
    .map((route) => route.routeId)
    .sort();
}

/**
 * Every blocker the engine currently reports, ranked, worst first.
 *
 * The comparator is LEXICOGRAPHIC over an ordered tuple rather than a weighted
 * score. A weighted score drifts under refactor, makes a regression hard to
 * localise, and cannot answer a founder asking "why this question?". Each field
 * below is a tie-break for the one above it, and the last field is total, so
 * the order is total: two runs on identical input cannot disagree.
 *
 *   1. kind          -- a contradiction outranks a gap
 *   2. unblockCount  -- MEASURED; more blocked routes cleared, first
 *   3. satisfiable   -- a certain unblock outranks a value-gated maybe
 *   4. factKeys      -- a question answering two facts outranks one answering one
 *   5. bootstrapIndex -- the declared cold-start order, for a thin venture where
 *                        every count above is zero
 *   6. questionId    -- lexicographic; the total-order guarantee
 *
 * @param {object} params
 * @param {object} params.snapshot Trusted snapshot (conflicts, missingCriticalContext, section statuses).
 * @param {import('./route-eligibility.js').RouteEligibility[]} params.routeEvaluations
 * @param {Set<string>} params.unanswerablePrerequisites Keys that are WORK, not answers (clarification.js owns this list).
 * @param {string[]} params.bootstrapOrder Question ids, cold-start tie-break only.
 * @param {(key: string) => void} params.assertKnownKey Throws for a key with no verdict; clarification.js owns the error type.
 * @param {object} [params.perKey] The fact ledger's per-key map, for floor facts the snapshot does not carry.
 * @param {boolean} [params.understandingFloor] Include FOUNDER_UNDERSTANDING_FLOOR needs. Founder Chat opts in; the daily path does not.
 * @returns {object[]} Needs in a deterministic total order.
 */
export function buildFounderNeedLedger({
  snapshot,
  routeEvaluations,
  unanswerablePrerequisites,
  bootstrapOrder = [],
  assertKnownKey = () => {},
  perKey = null,
  understandingFloor = false,
}) {
  const needs = [];
  const seenQuestionIds = new Set();

  const push = (need) => {
    /* One need per QUESTION, not per fact key: `offer` and `offerPricing` are
       two route prerequisites answered by the same question, and asking it
       twice would be asking the same thing twice. The first occurrence wins
       because needs are added worst-kind-first. */
    if (!need.questionId || seenQuestionIds.has(need.questionId)) return;
    seenQuestionIds.add(need.questionId);
    needs.push(need);
  };

  const buildNeed = (kind, questionId, factKeys, extra = {}) => ({
    needId: `${kind}:${questionId}`,
    kind,
    questionId,
    factKeys,
    unblocks: [],
    satisfiable: 'certain',
    ...extra,
  });

  /* 1. CONTRADICTIONS, from the FULL conflict list.
     Filtering to snapshot.blockingConflicts was tried here and is wrong.
     blockingConflicts keeps only facts in HIGH_IMPACT_SECTIONS
     (snapshot.js:126,469) -- which does NOT include `idea`. A venture holding
     two different descriptions of its own business would have stopped being
     asked about it, and that is the exact staging deadlock
     scripts/qa-founder-clarification-convergence.mjs was written to lock out;
     it failed immediately, which is the system working.
     The filter that belongs here is the one already below: a conflicted fact
     becomes a question only if QUESTION_ID_BY_CONFLICTED_FACT has an entry for
     it. That table holds exactly idea/offer/targetCustomer -- all three
     founder-answerable -- so engine bookkeeping (activeOutcomeThread) and
     integration metadata are excluded by having no question at all, not by an
     impact list that also drops a real one. */
  for (const conflict of snapshot?.conflicts || []) {
    const questionId = QUESTION_ID_BY_CONFLICTED_FACT[conflict.factKey];
    if (!questionId) continue;
    push(buildNeed('conflict', questionId, [...FOUNDER_QUESTION_CATALOG[questionId].factKeys]));
  }

  /* 2. MISSING CRITICAL CONTEXT -- the bottleneck assessment cannot reach usable
     confidence without these regardless of which route is eligible, so they
     outrank any single route's prerequisite. */
  for (const factKey of snapshot?.missingCriticalContext || []) {
    const questionId = QUESTION_ID_BY_MISSING_FACT[factKey];
    if (!questionId) continue;
    push(buildNeed('missing_critical', questionId, [...FOUNDER_QUESTION_CATALOG[questionId].factKeys], {
      unblocks: unblockedRoutesFor(factKey, routeEvaluations),
      satisfiable: satisfiabilityOf(factKey, snapshot),
    }));
  }

  /* 3. ROUTE PREREQUISITES. */
  const prerequisiteKeys = new Set();
  for (const route of routeEvaluations) {
    if (route.eligibility !== 'clarification_required') continue;
    for (const missing of route.missingPrerequisites) prerequisiteKeys.add(missing);
  }
  for (const key of [...prerequisiteKeys].sort()) {
    if (unanswerablePrerequisites.has(key)) {
      /* Recorded, never asked. These are records the founder must CREATE, so a
         question dead-ends; the honest response is a prerequisite mission. They
         stay in the ledger so a caller can see the venture IS blocked and on
         what, rather than seeing an empty list and inferring nothing is wrong. */
      needs.push({
        needId: `entity_prerequisite:${key}`,
        kind: 'entity_prerequisite',
        questionId: null,
        factKeys: [key],
        unblocks: unblockedRoutesFor(key, routeEvaluations),
        satisfiable: 'requires_entity',
      });
      continue;
    }
    assertKnownKey(key);
    const questionId = QUESTION_ID_BY_MISSING_FACT[key];
    push(buildNeed('route_prerequisite', questionId, [...FOUNDER_QUESTION_CATALOG[questionId].factKeys], {
      unblocks: unblockedRoutesFor(key, routeEvaluations),
      satisfiable: satisfiabilityOf(key, snapshot),
    }));
  }

  /* 4. THE UNDERSTANDING FLOOR -- asked after anything that blocks a decision,
     but asked. A venture VISION cannot describe is one it should not be
     advising, however eligible its routes happen to be.
     OPT-IN PER CALLER, because the two surfaces have genuinely different jobs.
     Founder Chat is where VISION builds its picture of the venture, so it opts
     in. The dashboard's Today's Move asks only what blocks TODAY's decision --
     a founder returning on day forty should not be asked what they are building.
     Same ledger, same comparator; the caller states its scope. The wording for
     these ids also lives in the intake bank, not the engine's tables. */
  for (const entry of (understandingFloor ? FOUNDER_UNDERSTANDING_FLOOR : [])) {
    if (floorFactIsKnown(entry.factKey, perKey, snapshot)) continue;
    if (entry.relevantWhen && !entry.relevantWhen(routeEvaluations)) continue;
    if (!FOUNDER_QUESTION_CATALOG[entry.questionId]) continue;
    push({
      needId: `understanding_floor:${entry.questionId}`,
      kind: 'understanding_floor',
      questionId: entry.questionId,
      factKeys: [entry.factKey],
      unblocks: [],
      satisfiable: 'certain',
    });
  }

  const bootstrapIndex = (need) => {
    const index = bootstrapOrder.indexOf(need.questionId);
    return index === -1 ? bootstrapOrder.length : index;
  };
  const SATISFIABLE_RANK = { certain: 0, value_gated: 1, requires_entity: 2 };

  /* Unblock count ranks PREREQUISITES, and only prerequisites.
     A route prerequisite exists to make a route executable, so "how many routes
     does this clear" is the thing it is for. Missing critical context exists for
     a different reason -- the bottleneck assessment cannot reach usable
     confidence without it (confidence.js:45,61) regardless of which route is
     eligible -- so ranking it by route-unblocking measures the wrong quantity.
     Ranking both the same way was tried and produced a visibly worse question
     order: unfinishedWork is BOTH critical context and a delivery-route
     prerequisite, so it scored an unblock while `offer` and `targetCustomer`
     scored none, and a founder who had not yet said what they sell was asked
     what was unfinished about it first. Critical context falls through to the
     bootstrap order instead, which is the sequence intake already asks in. */
  const RANKS_BY_UNBLOCK = new Set(['route_prerequisite', 'entity_prerequisite']);
  const unblockRank = (need) => (RANKS_BY_UNBLOCK.has(need.kind) ? need.unblocks.length : 0);

  return needs.sort((left, right) => (
    KIND_RANK[left.kind] - KIND_RANK[right.kind]
    || unblockRank(right) - unblockRank(left)
    || SATISFIABLE_RANK[left.satisfiable] - SATISFIABLE_RANK[right.satisfiable]
    || right.factKeys.length - left.factKeys.length
    || bootstrapIndex(left) - bootstrapIndex(right)
    || String(left.questionId).localeCompare(String(right.questionId))
  ));
}

/** The askable needs, in order -- the ledger minus the ones that are work. */
export function askableNeeds(needs) {
  return needs.filter((need) => need.questionId !== null);
}
