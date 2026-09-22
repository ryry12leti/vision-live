/**
 * Founder Mission Policy — the shared decision layer between the raw
 * Founder Goal Engine output (bottleneck + route evaluations + candidates)
 * and any consumer (this preview today; anywhere else the engine is used
 * later). Nothing here modifies founder-bottleneck/, founder-mission-
 * comparison/, founder-execution-context/, or the fact-ledger -- it only
 * composes their existing, unmodified exports and decides which of four
 * outcomes to return:
 *
 *   - direct        a real, currently-executable route (the engine's own
 *                    candidate), used as-is or promoted despite the raw
 *                    engine's own confidence gate (see below).
 *   - prerequisite   the correct bottleneck is known but a specific,
 *                    safely-creatable resource is missing -- generate the
 *                    smallest mission that creates it (never Lead
 *                    Intelligence: no automated discovery, the founder
 *                    identifies the real businesses/prices themselves).
 *   - clarification  the route or action genuinely cannot be chosen yet.
 *   - no_mission     the input is dangerously ambiguous or self-
 *                    contradictory; never guess.
 *
 * CORE FIX: todays-move.js's selectFounderTodaysMove() refuses to select
 * ANY mission once bottleneckAssessment.confidence === 'low', even when a
 * real, fully-derivable candidate exists (compareFounderCandidates picks a
 * winner independently of bottleneck confidence -- see comparison.js).
 * That rule correctly protects FACT/ROUTE confidence, but a purely self-
 * reported venture (no proof_verified/system_verified fact ever exists)
 * mathematically caps at 'low' after the staleness downgrade in
 * confidence.js, regardless of how complete the founder's answers are --
 * so it would NEVER select anything. This module is exactly where the task
 * says to draw the line: fact confidence, recommendation confidence, and
 * execution permission are separate concerns. When a winning candidate
 * exists, this promotes it as a 'direct' mission, honestly relabelled as
 * self-report-based (never claimed as independently verified), instead of
 * silently refusing to act.
 */

import { assessFounderBottleneck } from '../founder-bottleneck/index.js';
import { planFounderMissionComparison } from '../founder-mission-comparison/index.js';
import { detectExplicitConflict } from './conflict-detection.js';
import {
  prospectDiscoveryMission, audienceDiscoveryMission, offerDefinitionMission, retentionInvestigationMission, supplierShortlistMission,
  deliveryCommitmentMission,
} from './prerequisite-missions.js';
import { unfinishedWorkSplitByFunction } from '../founder-bottleneck/signals.js';
import { resolveProspectMissionQuantities, assessProspectBatch } from './mission-quantities.js';
import { routeFounderVenture } from '../founder-venture-router/index.js';

export const MISSION_DECISIONS = Object.freeze(['direct', 'prerequisite', 'clarification', 'no_mission']);

// The self-report ceiling: a mission generated or promoted by THIS policy
// layer (as opposed to one the raw engine already selected at genuinely
// medium/high bottleneck confidence) is never claimed above 'medium' --
// matching the trust hierarchy's own ceiling for user_confirmed facts
// (never system_verified/proof_verified without real, external evidence).
const SELF_REPORT_CONFIDENCE_CEILING = 'medium';

function cleanPhrase(value) {
  return typeof value === 'string' ? value.trim().replace(/[.!?\s]+$/, '') : null;
}

function buildDirectMission(todaysMove) {
  return { ...todaysMove, missionLevel: 'direct' };
}

/** Promotes a winning candidate the raw engine found but wouldn't commit
 * to, purely because of the low-bottleneck-confidence gate. Every field
 * comes directly from the real candidate brief -- nothing invented.
 *
 * Exported because BOTH orchestrators need it. The daily path
 * (founder-decision-service) had no promotion at all, so it threw away a
 * fully-derived, bottleneck-aligned candidate and fell through to the
 * prerequisite templates -- the same class of two-paths-disagree defect that
 * sharing the prerequisite resolver already fixed once. A missed-call SaaS
 * with a failing webhook had `founder_product_delivery_slice` selected by the
 * comparison, with real steps ("Complete: Webhook processing fails...",
 * "Verify every acceptance criterion"), and was handed a prospect list
 * instead. */
export function promoteWinningCandidate({
  winner, bottleneckAssessment, comparisonResult,
}) {
  return {
    status: 'selected',
    missionLevel: 'direct',
    selectedCandidateId: winner.candidateId,
    routeId: winner.routeId,
    businessFunction: winner.businessFunction,
    bottleneckId: bottleneckAssessment.primaryBottleneck.category,
    title: winner.title,
    missionStatement: winner.missionStatement,
    /* The candidate's actual EXECUTION content. Omitting it produced a mission
       that named an outcome with no way to carry it out, and buildSelectedResult
       reads all three to adapt them to the founder's skill level. */
    steps: winner.steps,
    professionalStandard: winner.professionalStandard,
    learningSupport: winner.learningSupport ?? null,
    whyNow: `Based on what you told VISION: ${winner.whyNow}`,
    expectedBusinessOutcome: winner.expectedBusinessOutcome,
    completionDefinition: winner.completionDefinition,
    requiredResources: winner.requiredResourceIds,
    missingResources: winner.missingResourceIds,
    requiredEvidence: winner.requiredEvidence,
    timeEstimate: winner.timeEstimateMinutes,
    effortLevel: winner.effortLevel,
    deadline: null,
    // The bottleneck's own fact-confidence stays whatever it genuinely is
    // (never overstated); recommendation confidence is capped separately.
    confidence: SELF_REPORT_CONFIDENCE_CEILING,
    selectionExplanation: `Based on your confirmed answers: ${comparisonResult.explanation} This is a safe, reversible action; execution has not yet been verified.`,
    rejectedAlternativeSummaries: [],
    clarificationQuestions: [],
    persistedTaskId: null,
  };
}

/**
 * Tries to generate a safe, deterministic prerequisite mission for the
 * primary bottleneck when no route is currently executable at all. Only
 * ever fires when the resource it would create is genuinely safe to
 * generate (never inventing a target market, a price, or evidence the
 * founder never stated).
 */
/* Which capability the founder is actually exercising, per assessed
   constraint. Used to pick the skill-level assessor and to adapt the steps --
   never to choose the mission. */
const BUSINESS_FUNCTION_BY_CATEGORY = Object.freeze({
  insufficient_customer_evidence: 'validation',
  weak_demand: 'validation',
  sales_conversion: 'sales',
  delivery_throughput: 'delivery',
  retention_failure: 'retention',
  operational_constraint: 'operations',
  strategic_ambiguity: 'strategy',
});

/**
 * Builds the prerequisite mission for an assessed constraint, or null when
 * none can be created without inventing a fact.
 *
 * Exported because BOTH orchestrators need it. The daily path
 * (founder-decision-service) previously had no prerequisite generation at all,
 * so a venture could get a real task from intake and only a question from its
 * daily run. Keeping one implementation is the point -- a second copy would
 * drift, and the two paths would disagree again.
 *
 * @param {object} params
 * @param {object} params.perKey Fact values keyed by factKey; a key is ABSENT when unknown (see perKeyFromSnapshot in the decision service).
 * @param {object} params.entityBundle Trusted buildFounderExecutionEntities(...) output.
 * @param {object} params.bottleneckAssessment Trusted assessFounderBottleneck(...) output.
 * @param {object[]} params.routeEvaluations executionContext.routeEvaluations.
 * @returns {object|null} A TodaysMove-shaped mission, missionLevel 'prerequisite'.
 */
export function generateFounderPrerequisiteMission(params) {
  const mission = tryGeneratePrerequisiteMission(params);
  if (!mission) return null;
  /* `prospectBatchReference` is optional on purpose: every existing caller
     that has never heard of a stored batch keeps working and simply produces
     a mission with `evidenceBatchReference: null`, which is honest -- there
     genuinely is no batch to point at until the founder runs a search. */
  /* bottleneckId and businessFunction are stamped HERE, from the real
     assessment, rather than hardcoded into each template -- a template cannot
     know which constraint caused it to be chosen, and a wrong guess would
     silently mislabel the task and its skill adaptation. */
  const category = params.bottleneckAssessment?.primaryBottleneck?.category ?? null;
  return {
    ...mission,
    bottleneckId: category,
    businessFunction: BUSINESS_FUNCTION_BY_CATEGORY[category] ?? 'strategy',
  };
}

function tryGeneratePrerequisiteMission({
  perKey, entityBundle, bottleneckAssessment, routeEvaluations, prospectBatchReference = null,
}) {
  const usableProspects = (entityBundle?.customerEntities || []).filter((entity) => entity.verificationStatus !== 'provisional');
  /* Quantities come from THIS founder's recorded push level, not from a
     constant in the template -- see mission-quantities.js. */
  const prospectQuantities = resolveProspectMissionQuantities({ perKey });
  /* Three states, not one boolean. `noProspects = usableProspects.length === 0`
     is what this replaces, and it left every count between 1 and the
     requirement belonging to no branch at all: the prerequisite stopped
     regenerating (so the founder was never asked to finish the list) while the
     advance trigger still required the full count (so the thread never moved),
     pinning them to a mission they could no longer make progress on. */
  const prospectBatch = assessProspectBatch({
    usableProspectCount: usableProspects.length,
    requiredCount: prospectQuantities.requiredCount,
  });
  const prospectRequirementUnmet = prospectBatch.state !== 'met';
  /* Retained under its original name for the checks below that genuinely mean
     "zero" rather than "not enough" -- the offer-definition prerequisite is
     reachable the moment ANY prospect exists to define an offer against. */
  const noProspects = prospectBatch.state === 'empty';
  const targetCustomerLabel = cleanPhrase(perKey.targetCustomer?.value);
  const offerLabel = cleanPhrase(perKey.offer?.value) || cleanPhrase(perKey.idea?.value);
  const offerKnown = Boolean(perKey.offerPricing);

  // Retention: checked FIRST and takes priority over prospect discovery.
  // Real, existing paying customers are exactly the case where a founder
  // should never be told to go find new prospects -- the assessed
  // bottleneck is retention, not customer/problem validation, and
  // founder_retention_analysis is only 'blocked' (missing analytics
  // tooling this preview never assumes), not genuinely inapplicable.
  const evidence = perKey.customerEvidence?.value;
  const hasRealCustomers = Boolean(evidence) && (evidence.hasPayingCustomers === true || (evidence.customerCount || 0) > 0);
  const retentionIsBottleneck = bottleneckAssessment?.primaryBottleneck?.category === 'retention_failure';
  const retentionBlockedOnResources = (routeEvaluations || []).some((r) => r.routeId === 'founder_retention_analysis' && r.eligibility === 'blocked');
  if (retentionIsBottleneck && hasRealCustomers && retentionBlockedOnResources) {
    return retentionInvestigationMission({ routeId: 'founder_retention_analysis' });
  }

  // Prospect discovery: the dominant prerequisite for a customer/problem-
  // validation bottleneck. Only fires when the target customer is
  // genuinely known -- otherwise this would invent a target market, which
  // is exactly what a clarification question exists for instead. Never
  // fires when the founder already has real paying customers (see above).
  /* `!hasRealCustomers` alone was too blunt. It correctly stops a founder with
     paying customers being sent prospecting when the constraint is VALIDATION
     or RETENTION -- but an established business whose assessed constraint is
     ACQUISITION is exactly who should be building a prospect list. A real
     agency (four retainer clients, $18k monthly recurring, acquisition entirely
     by referral) has proven demand and still no way to reach more, and was
     left with a clarification question instead of the obvious next step. */
  const acquisitionIsBottleneck = bottleneckAssessment?.primaryBottleneck?.category === 'sales_conversion';
  if (prospectRequirementUnmet && targetCustomerLabel && (!hasRealCustomers || acquisitionIsBottleneck)) {
    /* THE GATE. This template is written entirely around enumerable trading
       businesses -- 27 strings about business names, locations, contact
       methods, "still trading", maps and directories, dead pages. Run against a
       founder whose customers are individual people it produces a fluent,
       confident, wholly false task, which is worse than producing nothing.
       Only a target the router can actually enumerate reaches it. Anything
       else returns null and is answered honestly by the caller -- never by
       quietly substituting this template. */
    const route = routeFounderVenture({ perKey });
    /* A venture selling to individual people gets the AUDIENCE mission instead.
       Refusing the business template was necessary -- there is no directory of
       "PC players who like deckbuilders" -- but refusing alone left the founder
       with an honest explanation and no move, which is only half an answer.
       What is enumerable for a consumer venture is not the people but the
       places they already gather, and every step of that a founder can verify
       with their own eyes. */
    if (route.targetEntity === 'individual_consumer' && route.confidence !== 'low') {
      return audienceDiscoveryMission({
        targetCustomerLabel,
        offerLabel,
        routeId: 'founder_customer_interview_set',
        quantities: prospectQuantities,
      });
    }
    /* Still unknown, or a business target the router is not confident about:
       generate nothing rather than guess which mission shape fits. */
    if (route.missionPattern !== 'enumerable_business_prospects' || route.confidence === 'low') {
      return null;
    }
    return prospectDiscoveryMission({
      targetCustomerLabel,
      offerLabel,
      /* The list unlocks whichever route the constraint actually points at:
         outreach for an acquisition gap, interviews for a validation one. */
      routeId: acquisitionIsBottleneck ? 'founder_sales_outreach_block' : 'founder_customer_interview_set',
      demandAlreadyProven: acquisitionIsBottleneck && hasRealCustomers,
      quantities: prospectQuantities,
      batchProgress: prospectBatch,
      batchReference: prospectBatchReference || null,
    });
  }

  // Offer definition: only reachable once prospects are not themselves the
  // blocker (having reachable prospects already makes customer interviews
  // directly executable, so this only matters in the narrower case where
  // interviews are not the assessed bottleneck's route but sales/offer
  // testing is, and no offer exists yet to test or present).
  if (!noProspects && !offerKnown) {
    return offerDefinitionMission({ routeId: 'founder_offer_test' });
  }

  // Supplier/sourcing gap: a physical product needs a supplier or
  // manufacturer that has not been identified yet -- this is the fallback
  // the other three prerequisites above never cover (no target customer to
  // validate yet, no prospects to define an offer against), and the
  // 7-route model has no direct representation for sourcing. Reaching this
  // point already means a real primary bottleneck exists (see the
  // primaryBottleneck check above), so a founder who has said no more than
  // "I picked my first product but have no manufacturer" still gets a real
  // mission -- supplierShortlistMission's own generic "your first product"
  // fallback is used rather than inventing a specific product name.
  const supplierGapItem = (perKey.unfinishedWork?.value || []).find((item) => /\bsupplier\b|\bmanufactur(?:er|ing)\b/i.test(item));
  if (supplierGapItem) {
    const productLabel = cleanPhrase(perKey.idea?.value) || cleanPhrase(perKey.offer?.value);
    return supplierShortlistMission({ productLabel, routeId: 'founder_product_delivery_slice' });
  }

  /* Delivery with no engineering route. Checked LAST so validation, acquisition
     and sourcing all keep priority -- a founder with no customers should be
     told to validate demand before being told to finish building something.
     But once those are genuinely not the constraint, a blocked delivery route
     used to end the flow at `return null` and the founder was asked "What is
     blocking progress on product/delivery right now?" -- a question their own
     recorded unfinished work had already answered, and which no answer could
     unblock, because the route needs a repository and build environment an
     agency or consultancy will never connect.
     Only DELIVERY-shaped work qualifies: the sales/delivery split is what stops
     "I have no repeatable way of getting new clients" from being handed back as
     a build task. */
  const deliveryIsBottleneck = bottleneckAssessment?.primaryBottleneck?.category === 'delivery_throughput';
  const deliveryBlockedOnResources = (routeEvaluations || []).some((r) => r.routeId === 'founder_product_delivery_slice' && r.eligibility === 'blocked');
  if (deliveryIsBottleneck && deliveryBlockedOnResources) {
    const { deliveryShaped } = unfinishedWorkSplitByFunction({
      unfinishedWork: { status: 'known', value: perKey.unfinishedWork?.value || [] },
    });
    /* No recorded item means there is nothing to name, and naming nothing would
       invent the work -- a clarification question is the honest outcome there. */
    if (deliveryShaped.length > 0) {
      return deliveryCommitmentMission({ workItem: deliveryShaped[0], routeId: 'founder_product_delivery_slice' });
    }
  }

  return null;
}

/**
 * @param {object} params
 * @param {object} params.snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @param {object} params.entityBundle Trusted buildFounderExecutionEntities(...) output.
 * @param {object} params.executionContext Trusted buildFounderExecutionContext(...) output.
 * @param {Record<string, object>} params.perKey rebuildStateFromFacts(...).perKey -- the full fact map (snapshot alone omits targetCustomer/offer/idea/businessModelFamily).
 * @param {string[]} params.rawTexts Every raw piece of text the founder typed this session, for conflict detection.
 * @param {string} params.evaluationTime ISO timestamp "now".
 * @param {{title:string}[]} [params.recentTasks]
 * @returns {{
 *   decision: 'direct'|'prerequisite'|'clarification'|'no_mission',
 *   mission: object|null,
 *   clarificationQuestions: string[],
 *   reason: string,
 *   bottleneckAssessment: object|null,
 *   candidateSummaries: object[],
 * }}
 */
export function resolveFounderMissionPolicy({
  snapshot, entityBundle, executionContext, perKey, rawTexts = [], evaluationTime, recentTasks = [],
  missionContext = null,
}) {
  const conflict = detectExplicitConflict(rawTexts);
  if (conflict) {
    return {
      decision: 'no_mission', mission: null, clarificationQuestions: [conflict.question], reason: conflict.reason, bottleneckAssessment: null, candidateSummaries: [],
    };
  }

  let bottleneckAssessment;
  try {
    bottleneckAssessment = assessFounderBottleneck({
      snapshot, entityBundle, executionContext, evaluationTime,
    });
  } catch (error) {
    return {
      decision: 'clarification', mission: null, clarificationQuestions: executionContext.clarificationQuestions, reason: 'bottleneck_assessment_failed', bottleneckAssessment: null, candidateSummaries: [],
    };
  }

  if (!bottleneckAssessment.primaryBottleneck) {
    return {
      decision: 'clarification', mission: null, clarificationQuestions: executionContext.clarificationQuestions, reason: 'bottleneck_undetermined', bottleneckAssessment, candidateSummaries: [],
    };
  }

  // missionContext is wording-only (see decision-core/mission-context.js) and
  // planFounderMissionComparison has always accepted it -- this layer simply
  // never passed it on, so the compiler's actionVerb/subjectText/targetLabel
  // branches were dead on every intake-path call and every task degraded to
  // template text. Forwarding it cannot change WHICH mission is selected.
  const { candidates, comparisonResult, todaysMove } = planFounderMissionComparison({
    snapshot, entityBundle, executionContext, bottleneckAssessment, recentTasks, missionContext,
  });
  const candidateSummaries = candidates.map((c) => ({
    candidateId: c.candidateId, routeId: c.routeId, bottleneckAlignment: c.bottleneckAlignment, title: c.title, timeEstimateMinutes: c.timeEstimateMinutes, effortLevel: c.effortLevel,
  }));

  if (comparisonResult.selectedCandidateId) {
    const winner = candidates.find((c) => c.candidateId === comparisonResult.selectedCandidateId);
    if (todaysMove.status === 'selected') {
      return {
        decision: 'direct', mission: buildDirectMission(todaysMove), clarificationQuestions: [], reason: 'direct_execution', bottleneckAssessment, candidateSummaries,
      };
    }
    return {
      decision: 'direct',
      mission: promoteWinningCandidate({ winner, bottleneckAssessment, comparisonResult }),
      clarificationQuestions: [],
      reason: 'direct_execution_self_reported',
      bottleneckAssessment,
      candidateSummaries,
    };
  }

  const prereq = generateFounderPrerequisiteMission({
    perKey, entityBundle, bottleneckAssessment, routeEvaluations: executionContext.routeEvaluations,
  });
  if (prereq) {
    return {
      decision: 'prerequisite', mission: prereq, clarificationQuestions: [], reason: 'prerequisite_generated', bottleneckAssessment, candidateSummaries,
    };
  }

  return {
    decision: 'clarification', mission: null, clarificationQuestions: todaysMove.clarificationQuestions, reason: 'no_safe_prerequisite', bottleneckAssessment, candidateSummaries,
  };
}
