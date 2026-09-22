/**
 * Founder Bottleneck Intelligence — per-route assessment.
 *
 * Produces exactly one RouteAssessment per canonical Founder route (spec
 * section 5). `eligibility`/`missingInputs`/route-level `confidence` are
 * read straight from the already-computed, trusted
 * founder-execution-context routeEvaluations -- never re-derived -- so this
 * module can never disagree with the eligibility founder-execution-context
 * itself already established. Every other dimension is a NEW fact this
 * module computes from the snapshot/entity evidence, deliberately kept
 * simple and explainable (no opaque blended ML score): each dimension is a
 * small, documented function of real signals, and a route with no relevant
 * evidence legitimately scores 0 (spec section 9 -- no floors).
 */

import { FOUNDER_WORK_UNIT_BUSINESS_FUNCTION } from '../founder-execution-context/contract.js';
import { MIN_MEANINGFUL_CATEGORY_SCORE } from './contract.js';
import * as signals from './signals.js';
import { deriveFounderStage } from '../founder-stage/index.js';

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// A route's structural feasibility today is a direct, honest reflection of
// founder-execution-context's own eligibility verdict -- eligible routes are
// executable now, clarification_required/blocked routes are not (yet), and
// not_relevant routes never are.
const FEASIBILITY_BY_ELIGIBILITY = Object.freeze({
  eligible: 100, clarification_required: 20, blocked: 10, not_relevant: 0,
});

/* ── Stage believability ───────────────────────────────────────────────────
   Derived stage says what EXISTS. It never scores, never ranks and never
   selects -- its only job here is to cap constraints that the venture's actual
   condition makes implausible. A venture with nothing built cannot have a
   delivery constraint. A venture whose product is half-finished cannot
   validate demand through it. Those are statements about reality.

   The cap is a CEILING, not zero: the constraint stays visible as a secondary
   one, because "unlikely right now" is not "impossible". This replaces the
   narrower hasBlockedProductInFlight signal from the previous milestone --
   same idea, now expressed once through stage instead of ad hoc.

   ONLY POSITIVELY-ESTABLISHED STAGES CAP ANYTHING. 'idea' and 'validation' are
   reached by the ABSENCE of product evidence, so capping delivery there would
   mean "no product was described, therefore delivery cannot be the constraint"
   -- inferring from absence, which is exactly what this engine must never do.
   A founder who simply did not describe their build in the words this module
   recognises would have had a real delivery constraint suppressed. Tried it,
   and it broke four existing bottleneck cases that were right all along.
   Every stage that DOES cap is established by something observed: a bounded
   piece of outstanding work, an accepted commitment, zero outstanding product
   work, churn against real paying customers.

   Deliberately absent elsewhere: 'prototype' does NOT cap customer validation.
   The whole point of a prototype is to put it in front of people, so a game
   prototype with no playtesters genuinely has a validation constraint; capping
   it would send that founder to finish art instead of finding players.
   'launched' caps nothing -- available, with no specific work identified, says
   nothing about which constraint leads.
   Retention is never capped: retentionDimensions already returns 0 without real
   customers, so a cap would be redundant scoring dressed up as a constraint.
   'operational_constraint' and 'strategic_ambiguity' are never capped: no
   fixture gives evidence about when they are implausible, and guessing is
   exactly what this module must not do. */
/* DERIVED from the two thresholds it has to clear, never hand-picked.
   A ceiling only constrains anything if it lands below MIN_MEANINGFUL_CATEGORY_
   SCORE -- the point at which the ranking stops treating a category as evidence
   of a bottleneck at all -- which is exactly what "not believable at this
   stage" should mean. It must also clear CATEGORY_TIE_MARGIN, because two
   categories within 8 points are treated as tied and resolved by a fixed
   priority hierarchy: capped at 20 against retention's floor of 20 the gap was
   0, at 15 the gap was 5, and both times `execution_leverage` won the tie and
   a venture whose entire problem was churn was still told to go and build.
   Tying the constant to the rules keeps it correct if either threshold moves. */
const STAGE_IMPLAUSIBLE_CEILING = MIN_MEANINGFUL_CATEGORY_SCORE - 5;
const IMPLAUSIBLE_CATEGORIES_BY_STAGE = Object.freeze({
  idea: Object.freeze([]),
  validation: Object.freeze([]),
  prototype: Object.freeze([]),
  launched: Object.freeze([]),
  // A bounded piece of the product is unfinished: demand cannot be validated
  // through it until that is done.
  building: Object.freeze(['insufficient_customer_evidence']),
  testing: Object.freeze(['insufficient_customer_evidence']),
  // Nothing is outstanding on the product itself (deliveryShaped is empty).
  acquiring: Object.freeze(['delivery_throughput']),
  // A real customer commitment has been accepted.
  delivering: Object.freeze(['insufficient_customer_evidence']),
  // Real paying customers exist and the recorded issue is whether they stay.
  retaining: Object.freeze(['insufficient_customer_evidence', 'delivery_throughput']),
  scaling: Object.freeze(['insufficient_customer_evidence']),
});

/** Which bottleneck category each route's dimensions speak to. */
const CATEGORY_BY_ROUTE = Object.freeze({
  founder_customer_interview_set: 'insufficient_customer_evidence',
  founder_offer_test: 'weak_demand',
  founder_sales_outreach_block: 'sales_conversion',
  founder_product_delivery_slice: 'delivery_throughput',
  founder_retention_analysis: 'retention_failure',
  founder_operating_process: 'operational_constraint',
  founder_strategy_decision: 'strategic_ambiguity',
});

function resourceReadinessFor(routeEvaluation) {
  if (routeEvaluation.eligibility === 'eligible') return 100;
  if (routeEvaluation.eligibility === 'blocked' && routeEvaluation.missingPrerequisites.length > 0) return 20;
  return 0;
}

// ---------------------------------------------------------------------------
// Per-route-family evidence dimensions. Grouped by the underlying business
// question each route answers (spec section 6's strong-signal categories).
// ---------------------------------------------------------------------------
function customerValidationDimensions(snapshot, entityBundle) {
  const count = signals.customerCount(snapshot);
  const hasEvidence = signals.hasAnyCustomerEvidence(snapshot);
  const usableProspects = signals.usableCustomerEntities(entityBundle).length;
  let bottleneckRelevance = 0;
  const supporting = [];
  const contradicting = [];
  /* Hoisted: payment being proven now decides WHICH branch is taken, not just
     how steeply the chosen one decays. `count === 0` used to mean "no
     customers" outright, which was safe only while a customer count was the
     single thing the extractor could ever produce. It now reads revenue and
     completed transactions too, and those deliberately carry NO count -- money
     received does not say how many people sent it, and inventing a number
     there would be a fabrication. Without this, an agency billing $18k a month
     scored 75 for "reports no real customers/prospects yet", which its own
     recorded revenue flatly contradicts. */
  const demandProven = signals.hasPayingCustomers(snapshot) || signals.hasRealRevenue(snapshot);
  if (!hasEvidence) {
    bottleneckRelevance = 90;
    supporting.push('customerEvidence is unknown or reports zero customers/prospects');
  } else if (!demandProven && (count === 0 || signals.customerEvidenceType(snapshot) === 'none')) {
    bottleneckRelevance = 75;
    supporting.push('customerEvidence is known but reports no real customers/prospects yet');
  } else if (count === 0) {
    /* Payment is on record but the founder stated no headcount. Validation is
       substantially settled -- someone paid -- so this scores at the same floor
       the demand-proven branch below decays toward, without pretending to a
       count that was never given. */
    bottleneckRelevance = 30;
    supporting.push('payment is on record, but no confirmed customer count has been stated');
  } else {
    /* N people who have PAID is far stronger validation than N who merely
       showed interest, so the two cannot decay from the same starting point.
       Treating them alike left a consultancy with three paying clients scoring
       51 here -- enough to win the ranking and tell a profitable business that
       nobody had proven they would pay. */
    bottleneckRelevance = clamp((demandProven ? 30 : 60) - count * 8);
    if (bottleneckRelevance > 0) {
      supporting.push(demandProven
        ? `only ${count} paying customer(s) on record so far`
        : `only ${count} confirmed customer(s)/prospect(s) on record`);
    } else {
      contradicting.push(`${count} confirmed customers/prospects already on record`);
    }
  }
  /* Having no individually-identified PROSPECT is a validation gap only for a
     venture that has not yet proven anyone will pay. For a business with
     paying customers it says something about the sales pipeline, not about
     whether the problem is real -- and adding it here double-counted the same
     absence that salesConversionDimensions already scores. */
  if (usableProspects === 0 && !signals.hasPayingCustomers(snapshot) && !signals.hasRealRevenue(snapshot)) {
    bottleneckRelevance = clamp(bottleneckRelevance + 15);
    supporting.push('no individually-identified, confirmed customer/prospect entities exist');
  }
  if (signals.stageSuggestsBuildingContinues(snapshot) && bottleneckRelevance >= 50) {
    supporting.push(`declared stage (${signals.declaredStage(snapshot)}) shows work continuing without demand evidence`);
  }
  /* The stage constraint that used to live here now applies uniformly to every
     category in assessRoutes -- see IMPLAUSIBLE_CATEGORIES_BY_STAGE. */
  return { bottleneckRelevance, evidenceGapSeverity: bottleneckRelevance, supporting, contradicting };
}

function offerValidationDimensions(snapshot) {
  const hasEvidence = signals.hasAnyCustomerEvidence(snapshot);
  const count = signals.customerCount(snapshot);
  const supporting = [];
  const contradicting = [];
  let relevance = 0;
  // Weak demand is only a meaningful category once problem/customer
  // evidence already exists at some level -- otherwise the gap is
  // insufficient_customer_evidence, not weak_demand (spec section 6).
  if (!hasEvidence) {
    contradicting.push('no customer evidence exists yet to test an offer against');
    return { bottleneckRelevance: 0, evidenceGapSeverity: 0, supporting, contradicting };
  }
  const demandProven = signals.hasPayingCustomers(snapshot) || signals.hasRealRevenue(snapshot);
  if (!signals.offerKnown(snapshot)) {
    relevance = 70;
    supporting.push('a real offer/price has not been recorded yet');
  } else if (!signals.offerPublished(snapshot) && !demandProven) {
    relevance = 45;
    supporting.push('an offer exists but is not published/live');
  } else if (!signals.offerPublished(snapshot)) {
    /* `pricingStatus` is only ever set by the structured pricing extractor; a
       price captured through the intake question lands as a notes blob with no
       status, so EVERY founder who answered that question looked "not
       published". For a business with paying customers that inference is
       plainly contradicted by the money already coming in -- it was scoring
       weak_demand 45 for a consultancy billing $12k an engagement. */
    contradicting.push('paying customers show the offer is live regardless of how its pricing was recorded');
  }
  if (count >= 3 && !signals.hasPayingCustomers(snapshot) && !signals.hasRealRevenue(snapshot)) {
    relevance = clamp(relevance + 30);
    supporting.push(`${count} customer(s)/prospect(s) show interest with no commitment or revenue evidence`);
  }
  return { bottleneckRelevance: relevance, evidenceGapSeverity: relevance, supporting, contradicting };
}

function salesConversionDimensions(snapshot, entityBundle) {
  const reachable = signals.reachableCustomerEntities(entityBundle).length;
  const pendingRequests = signals.entitiesWithPendingRequest(entityBundle);
  const supporting = [];
  const contradicting = [];
  let relevance = 0;
  if (!signals.offerKnown(snapshot)) {
    contradicting.push('no offer exists yet, so sales conversion cannot be the bottleneck ahead of offer validation');
    return { bottleneckRelevance: 0, evidenceGapSeverity: 0, supporting, contradicting };
  }
  if (pendingRequests.length > 0) {
    // A prospect who already responded and named a specific next step
    // (proof/pricing/proposal/meeting) is a materially stronger, more
    // immediately actionable sales-conversion signal than an unanswered
    // cold list -- closing a named, warm conversation outranks generating
    // more first contacts (spec: a warm opportunity outranks new
    // prospecting). Scored above the plain-reachable-prospect case (65)
    // rather than through the tie-break hierarchy, so it wins on evidence.
    relevance = 90;
    supporting.push(`${pendingRequests.length} prospect(s) already responded and are waiting on a specific ${pendingRequests[0].value.pendingRequest} before they will proceed`);
    supporting.push('a real, individually-identified prospect entity confirms this is an active conversation, not a hypothetical opportunity');
  } else if (reachable > 0 && !signals.hasRealRevenue(snapshot) && !signals.hasPayingCustomers(snapshot)) {
    relevance = 65;
    supporting.push(`${reachable} reachable prospect(s) exist with a real offer but no recorded revenue/commitment`);
    // The founder's own unfinished-work statement is a second, independent
    // trusted fact supporting THIS category -- previously the confidence
    // ladder reached its multi-fact threshold only by counting an unrelated
    // route that happened to score nearby, which never genuinely
    // corroborated a sales bottleneck.
    const unstartedSalesWork = signals.unfinishedWorkSplitByFunction(snapshot).salesShaped;
    if (unstartedSalesWork.length > 0) {
      supporting.push(`the founder reports acquisition work still unfinished: "${unstartedSalesWork[0]}"`);
    }
  } else if (reachable === 0) {
    /* Having nobody to contact is not evidence that acquisition is fine -- for
       an established business it is usually the acquisition problem itself.
       Scoring 0 here conflated RELEVANCE ("is this the constraint?") with
       FEASIBILITY ("can it be executed today?"), which this module already
       scores separately as feasibilityToday. The effect, verified on a real
       agency with four retainer clients and $18k monthly recurring: sales
       scored 0, and the venture was diagnosed weak_demand -- telling a founder
       whose offer demonstrably sells that people are not taking it up.
       Requires BOTH proven demand and the founder's own statement that
       acquisition work is unfinished, so it can never fire on an assumption.
       A founder with no paying customers still falls through to
       insufficient_customer_evidence, which for them is the honest answer. */
    const unstartedSalesWork = signals.unfinishedWorkSplitByFunction(snapshot).salesShaped;
    const demandProven = signals.hasPayingCustomers(snapshot) || signals.hasRealRevenue(snapshot);
    if (demandProven && unstartedSalesWork.length > 0) {
      relevance = 70;
      supporting.push('paying customers already prove the offer sells, so the gap is a repeatable way to reach more of them');
      supporting.push(`the founder reports acquisition work as still unfinished: "${unstartedSalesWork[0]}"`);
      supporting.push('no reachable prospect is on record yet, so the first step is building that list');
    } else {
      contradicting.push('no reachable prospects exist yet -- outreach cannot be executed regardless of demand');
    }
  } else if (signals.unfinishedWorkSplitByFunction(snapshot).salesShaped.length > 0) {
    // Existing paying customers do NOT mean sales conversion is solved. An
    // established business opening a genuinely unstarted acquisition channel
    // (here: reachable prospects on record PLUS the founder's own statement
    // that the outreach has never been done) has an unproven motion, even
    // though another channel already produces revenue. Scored below the
    // no-revenue-at-all case (65), since existing revenue is real mitigating
    // evidence -- and it requires BOTH a reachable prospect entity and the
    // founder's own unfinished-work statement, never an assumption.
    relevance = 60;
    // Two genuinely independent trusted facts, reported separately because
    // they are separately verifiable: the prospect entities themselves, and
    // the founder's own statement about the channel.
    supporting.push(`${reachable} reachable prospect(s) are on record for an acquisition channel that has produced no recorded commitment`);
    supporting.push(`the founder reports this acquisition work as still unfinished: "${signals.unfinishedWorkSplitByFunction(snapshot).salesShaped[0]}"`);
  } else {
    contradicting.push('revenue or paying-customer evidence already exists');
  }
  return { bottleneckRelevance: relevance, evidenceGapSeverity: relevance, supporting, contradicting };
}

function deliveryDimensions(snapshot) {
  // Only work that is NOT clearly acquisition-shaped counts toward
  // product/delivery throughput. Counting the whole unfinishedWork list here
  // made any founder-reported sales gap ("I have never done any B2B
  // outreach") register as a product/delivery bottleneck, which then won the
  // category ranking outright for businesses whose real gap was acquisition.
  const { salesShaped, deliveryShaped } = signals.unfinishedWorkSplitByFunction(snapshot);
  const unfinished = deliveryShaped;
  const completed = signals.completedWorkItems(snapshot);
  const supporting = [];
  const contradicting = [];
  let relevance = 0;
  if (unfinished.length === 0) {
    contradicting.push(salesShaped.length > 0
      ? `the ${salesShaped.length} unfinished item(s) on record describe acquisition work, not product/delivery work`
      : 'no unfinished work is recorded');
    return { bottleneckRelevance: 0, evidenceGapSeverity: 0, supporting, contradicting };
  }
  const demandExists = signals.hasAnyCustomerEvidence(snapshot) || signals.offerKnown(snapshot);
  if (demandExists) {
    relevance = clamp(40 + unfinished.length * 10);
    supporting.push(`${unfinished.length} unfinished work item(s) recorded while demand/offer evidence already exists`);
  } else {
    relevance = clamp(20 + unfinished.length * 5);
    supporting.push(`${unfinished.length} unfinished work item(s) recorded`);
  }
  if (completed.length > unfinished.length * 2) {
    relevance = clamp(relevance - 15);
    contradicting.push('completed work substantially outweighs unfinished work');
  }
  return { bottleneckRelevance: relevance, evidenceGapSeverity: relevance, supporting, contradicting };
}

function retentionDimensions(snapshot, entityBundle) {
  const supporting = [];
  const contradicting = [];
  const hasRealCustomers = signals.hasPayingCustomers(snapshot) || signals.customerCount(snapshot) > 0
    || signals.payingOrConvertedCustomerEntities(entityBundle).length > 0;
  if (!hasRealCustomers) {
    contradicting.push('no real customers exist yet, so retention cannot be the current bottleneck');
    return { bottleneckRelevance: 0, evidenceGapSeverity: 0, supporting, contradicting };
  }
  const matches = signals.retentionSignalMatches(snapshot);
  let relevance;
  if (matches.length > 0) {
    relevance = 70;
    supporting.push(`founder-reported evidence of churn/drop-off: "${matches[0]}"`);
  } else {
    // Real customers exist but this contract carries no direct
    // churn/activation signal -- honestly reflect that as a WEAK,
    // last-priority candidate rather than fabricating certainty (spec
    // section 8: never fabricate; section 7: retention is the lowest
    // default priority absent stronger evidence).
    relevance = 20;
    supporting.push('real customers exist, but no churn/retention evidence has been reported either way');
  }
  return { bottleneckRelevance: relevance, evidenceGapSeverity: relevance, supporting, contradicting };
}

function operationsDimensions(snapshot, entityBundle) {
  const supporting = [];
  const contradicting = [];
  const failing = signals.failingOperatingProcessEntities(entityBundle);
  const keywordMatches = signals.operationsSignalMatches(snapshot);
  if (failing.length === 0 && keywordMatches.length === 0) {
    contradicting.push('no recorded operating process shows a real failure point');
    return { bottleneckRelevance: 0, evidenceGapSeverity: 0, supporting, contradicting };
  }
  let relevance = 0;
  if (failing.length > 0) {
    relevance = 75;
    supporting.push(`a confirmed operating process ("${failing[0].value.processName}") has a real failure point`);
  }
  if (keywordMatches.length > 0) {
    relevance = clamp(relevance + 20);
    supporting.push(`founder-reported evidence of an operational failure: "${keywordMatches[0]}"`);
  }
  return { bottleneckRelevance: relevance, evidenceGapSeverity: relevance, supporting, contradicting };
}

function strategyDimensions(entityBundle) {
  const supporting = [];
  const contradicting = [];
  const open = signals.usableOpenStrategyDecisions(entityBundle);
  if (open.length === 0) {
    contradicting.push('no genuine open decision with two or more real options exists (a vague "grow the business" goal never creates a strategy bottleneck)');
    return { bottleneckRelevance: 0, evidenceGapSeverity: 0, supporting, contradicting };
  }
  supporting.push(`an open decision with ${open[0].value.optionIds.length} real options is blocking progress: "${open[0].value.decisionQuestion}"`);
  return { bottleneckRelevance: 70, evidenceGapSeverity: 70, supporting, contradicting };
}

const DIMENSION_BUILDERS = Object.freeze({
  founder_customer_interview_set: (snapshot, entityBundle) => customerValidationDimensions(snapshot, entityBundle),
  founder_offer_test: (snapshot) => offerValidationDimensions(snapshot),
  founder_sales_outreach_block: (snapshot, entityBundle) => salesConversionDimensions(snapshot, entityBundle),
  founder_product_delivery_slice: (snapshot) => deliveryDimensions(snapshot),
  founder_retention_analysis: (snapshot, entityBundle) => retentionDimensions(snapshot, entityBundle),
  founder_operating_process: (snapshot, entityBundle) => operationsDimensions(snapshot, entityBundle),
  founder_strategy_decision: (snapshot, entityBundle) => strategyDimensions(entityBundle),
});

// Downstream-dependency map: which OTHER routes' evidence gap would this
// route's resolution unlock. A structural, fixed fact about the business
// funnel (validation -> offer -> sales/delivery -> retention), not a
// per-request guess.
const DEPENDENTS = Object.freeze({
  founder_customer_interview_set: ['founder_offer_test', 'founder_sales_outreach_block'],
  founder_offer_test: ['founder_sales_outreach_block'],
  founder_sales_outreach_block: ['founder_retention_analysis'],
  founder_product_delivery_slice: ['founder_sales_outreach_block', 'founder_retention_analysis'],
  founder_retention_analysis: [],
  founder_operating_process: ['founder_product_delivery_slice', 'founder_sales_outreach_block'],
  founder_strategy_decision: [],
});

function dependencyUnlockValueFor(routeId, dimensionsByRoute) {
  const dependents = DEPENDENTS[routeId] || [];
  if (dependents.length === 0) return 0;
  const total = dependents.reduce((sum, id) => sum + (dimensionsByRoute[id]?.bottleneckRelevance || 0), 0);
  return clamp(total / dependents.length);
}

function urgencyFor(routeId, snapshot, entityBundle, bottleneckRelevance) {
  const survivalMatches = signals.survivalSignalMatches(snapshot);
  // Immediate survival/cash risk raises urgency specifically for the
  // money-generating routes (spec section 7) -- it never fabricates
  // relevance for a route with zero underlying evidence.
  const moneyRoutes = new Set(['founder_sales_outreach_block', 'founder_offer_test']);
  if (survivalMatches.length > 0 && moneyRoutes.has(routeId) && bottleneckRelevance > 0) return 100;
  // A prospect who already named a specific next step (proof/pricing/
  // proposal/meeting) is inherently time-sensitive on its own terms --
  // goodwill/momentum decays the longer a warm reply goes unanswered --
  // independent of any separate cash-survival signal.
  if (routeId === 'founder_sales_outreach_block' && bottleneckRelevance > 0 && signals.entitiesWithPendingRequest(entityBundle).length > 0) {
    return 95;
  }
  return clamp(bottleneckRelevance * 0.6);
}

function proofabilityFor(eligibility) {
  // Every canonical route has a real, defined proof pairing in the Founder
  // domain pack -- proofability is about whether this route can currently
  // be executed and evidenced, which eligibility already establishes.
  return FEASIBILITY_BY_ELIGIBILITY[eligibility];
}

function duplicationRiskFor(routeId, snapshot) {
  const completed = signals.completedWorkItems(snapshot).join(' ').toLowerCase();
  if (!completed) return 0;
  const businessFunction = FOUNDER_WORK_UNIT_BUSINESS_FUNCTION[routeId];
  const hit = completed.includes(businessFunction);
  return hit ? 30 : 0;
}

function riskOrCostFor(routeId) {
  // Customer-facing routes carry modest external/reputational risk;
  // internal routes carry effectively none. A fixed, documented lookup --
  // never a per-request guess.
  const CUSTOMER_FACING = new Set(['founder_sales_outreach_block', 'founder_customer_interview_set', 'founder_offer_test']);
  return CUSTOMER_FACING.has(routeId) ? 20 : 5;
}

/**
 * @param {object} params
 * @param {object} params.snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @param {object} params.entityBundle Trusted buildFounderExecutionEntities(...) output.
 * @param {object} params.executionContext Trusted buildFounderExecutionContext(...) output.
 * @returns {object[]} Exactly 7 RouteAssessment objects, one per canonical route, in FOUNDER_ROUTE_IDS order.
 */
export function assessRoutes({ snapshot, entityBundle, executionContext }) {
  const evaluationByRoute = Object.fromEntries(executionContext.routeEvaluations.map((route) => [route.routeId, route]));
  const dimensionsByRoute = {};
  for (const routeId of Object.keys(DIMENSION_BUILDERS)) {
    dimensionsByRoute[routeId] = DIMENSION_BUILDERS[routeId](snapshot, entityBundle);
  }

  /* DERIVED STAGE, applied as a believability constraint. Recomputed here from
     the snapshot rather than read from a stored field: stage is derived, and a
     stored one drifts (see founder-stage/index.js). It is computed ONCE and
     used only to cap -- it contributes no score of its own, so it can never
     become a second bottleneck. */
  const derivedStage = deriveFounderStage({ snapshot, entityBundle, evaluationTime: snapshot.updatedAt || snapshot.lastConfirmedAt || null });
  const implausibleCategories = new Set(IMPLAUSIBLE_CATEGORIES_BY_STAGE[derivedStage.value] || []);

  return Object.keys(DIMENSION_BUILDERS).map((routeId) => {
    const routeEvaluation = evaluationByRoute[routeId];
    const dimensions = dimensionsByRoute[routeId];
    const { evidenceGapSeverity, supporting } = dimensions;
    const contradicting = [...dimensions.contradicting];
    let { bottleneckRelevance } = dimensions;
    if (implausibleCategories.has(CATEGORY_BY_ROUTE[routeId]) && bottleneckRelevance > STAGE_IMPLAUSIBLE_CEILING) {
      bottleneckRelevance = STAGE_IMPLAUSIBLE_CEILING;
      contradicting.push(`the venture is at the "${derivedStage.value}" stage, which makes this an unlikely current constraint: ${derivedStage.reason}`);
    }
    const feasibilityToday = FEASIBILITY_BY_ELIGIBILITY[routeEvaluation.eligibility];
    const resourceReadiness = resourceReadinessFor(routeEvaluation);
    const dependencyUnlockValue = dependencyUnlockValueFor(routeId, dimensionsByRoute);
    const expectedBusinessImpact = clamp(bottleneckRelevance * 0.7 + dependencyUnlockValue * 0.3);
    const urgency = urgencyFor(routeId, snapshot, entityBundle, bottleneckRelevance);
    const proofability = proofabilityFor(routeEvaluation.eligibility);
    const duplicationRisk = duplicationRiskFor(routeId, snapshot);
    const riskOrCost = riskOrCostFor(routeId);
    const confidence = Math.round(snapshot.confidence * routeEvaluation.confidence * 100) / 100;

    const routeScore = bottleneckRelevance === 0 && feasibilityToday === 0
      ? null
      : clamp(
        bottleneckRelevance * 0.30
          + expectedBusinessImpact * 0.20
          + feasibilityToday * 0.15
          + resourceReadiness * 0.10
          + urgency * 0.10
          + proofability * 0.10
          - duplicationRisk * 0.10
          - riskOrCost * 0.05,
      );

    return {
      routeId,
      eligibility: routeEvaluation.eligibility,
      businessFunction: FOUNDER_WORK_UNIT_BUSINESS_FUNCTION[routeId],
      bottleneckRelevance: clamp(bottleneckRelevance),
      evidenceGapSeverity: clamp(evidenceGapSeverity),
      expectedBusinessImpact,
      dependencyUnlockValue,
      urgency,
      feasibilityToday,
      resourceReadiness,
      proofability,
      duplicationRisk,
      riskOrCost,
      confidence,
      supportingEvidence: supporting,
      contradictingEvidence: contradicting,
      missingInputs: routeEvaluation.missingPrerequisites,
      explanation: supporting.length > 0
        ? `${supporting.join('; ')}.`
        : `No evidence currently supports this route as the bottleneck (${contradicting.join('; ') || 'no supporting facts on record'}).`,
      routeScore,
    };
  });
}
