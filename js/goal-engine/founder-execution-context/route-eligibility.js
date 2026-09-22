/**
 * Founder Execution Context — route eligibility.
 *
 * Evaluates each of the 7 canonical Founder work-unit routes against the
 * trusted V2 Founder Venture Snapshot and (for the 4 routes that need real
 * entities) the trusted Founder Execution Entities bundle. This determines
 * ELIGIBILITY only -- it never picks a bottleneck, never ranks routes
 * against each other, and never chooses Today's Move. Which (if any)
 * eligible route a real request actually plans is entirely up to the
 * existing, unmodified relevantWorkUnitIds()/domainDetailsFor() logic in
 * domain-intelligence/founder.js.
 *
 * Four eligibility states:
 *   - 'eligible': every required snapshot/entity fact and every required
 *     resource binding is genuinely present.
 *   - 'clarification_required': the route is structurally derivable in
 *     principle, but a specific real fact or entity the founder would need
 *     to supply/confirm directly is still missing.
 *   - 'blocked': the underlying facts/entities are sufficient, but either a
 *     required platform resource is not confirmed available, or a genuine
 *     entity exists in a state that makes it currently unusable (e.g. an
 *     unreachable prospect, a resolved decision) -- an operational gap, not
 *     a question for the founder.
 *   - 'not_relevant': permanently not derivable regardless of any input
 *     (unused today -- every one of the 7 routes now has SOME real
 *     derivation path once its inputs exist).
 *
 * `founder_product_delivery_slice`/`founder_retention_analysis` remain
 * snapshot-derived. `founder_offer_test` now joins customer interviews and
 * sales outreach in requiring a real reachable target. `founder_customer_interview_set`/
 * `founder_sales_outreach_block`/`founder_operating_process`/
 * `founder_strategy_decision` are new: they also consult the trusted
 * Founder Execution Entities bundle (see founder-venture-state/
 * entity-snapshot.js) for a real, individually-identified customer/
 * process/decision -- never a fabricated one.
 */

import { FOUNDER_ROUTE_CONTEXT_FIELDS } from './contract.js';
import { resolveResourceBindings } from './resource-bindings.js';
import { isUsableEntity } from '../founder-venture-state/index.js';

export const EMPTY_ENTITY_BUNDLE = Object.freeze({
  customerEntities: Object.freeze([]),
  operatingProcessEntities: Object.freeze([]),
  strategyDecisionEntities: Object.freeze([]),
});

function knownFields(snapshot, fields) {
  return fields.filter((field) => snapshot[field]?.status === 'known');
}
function unknownFields(snapshot, fields) {
  return fields.filter((field) => snapshot[field]?.status !== 'known');
}
function provenanceFor(snapshot, fields) {
  return fields
    .map((field) => snapshot[field]?.sourceFactId)
    .filter((id) => typeof id === 'string' && id.length > 0);
}
function eligibleCustomerEntities(entityBundle) {
  return (entityBundle.customerEntities || []).filter(isUsableEntity);
}

// One evaluator per canonical work unit. Each returns:
//   { status: 'derivable', known, missing, identifierFields }
//   { status: 'clarification_required'|'blocked', known, missing, reason }
// 'derivable' proceeds to a resource-binding check (may still downgrade to
// 'blocked' there); the other two statuses are final. Every identifierField
// is either a stable reference to a real underlying fact/entity, or (for
// *OutputId fields) a deterministically-generated PLANNED OUTPUT reference
// -- never a guess at content, never an invented input entity.
const ROUTE_EVALUATORS = Object.freeze({
  founder_offer_test(snapshot, ventureId, entityBundle) {
    const neededFields = ['offerPricing', 'customerEvidence'];
    const missing = unknownFields(snapshot, neededFields);
    if (missing.length > 0) {
      return {
        status: 'clarification_required', missing, known: knownFields(snapshot, neededFields), reason: `missing trusted venture facts: ${missing.join(', ')}`,
      };
    }
    const usable = eligibleCustomerEntities(entityBundle);
    if (usable.length === 0) {
      return {
        status: 'clarification_required', missing: ['customerEntities'], known: neededFields, reason: 'no individually-identified, confirmed target customer/prospect entities exist yet',
      };
    }
    if (!usable.some((entity) => entity.value.contactability === 'reachable')) {
      return {
        status: 'blocked', missing: ['reachable_customer'], known: [...neededFields, 'customerEntities'], reason: 'confirmed prospects exist but none are currently reachable',
      };
    }
    return {
      status: 'derivable',
      missing: [],
      known: neededFields,
      identifierFields: {
        offerId: `${ventureId}_offer`,
        targetSegmentId: `${ventureId}_target_segment`,
        resultOutputId: `${ventureId}_offer_test_result`,
      },
    };
  },
  founder_product_delivery_slice(snapshot, ventureId) {
    const neededFields = ['unfinishedWork'];
    const clarityFields = ['offerPricing', 'currentGoal'];
    const missing = unknownFields(snapshot, neededFields);
    const hasArticulatedTarget = knownFields(snapshot, clarityFields).length > 0;
    if (missing.length > 0 || !hasArticulatedTarget) {
      const allMissing = [...missing, ...(hasArticulatedTarget ? [] : ['offerPricing_or_currentGoal'])];
      return {
        status: 'clarification_required', missing: allMissing, known: knownFields(snapshot, [...neededFields, ...clarityFields]), reason: `missing trusted venture facts: ${allMissing.join(', ')}`,
      };
    }
    return {
      status: 'derivable',
      missing: [],
      known: [...neededFields, ...clarityFields.filter((f) => snapshot[f]?.status === 'known')],
      identifierFields: {
        productSliceId: `${ventureId}_product_slice`,
        acceptanceCriteriaIds: [`${ventureId}_acceptance_criteria`],
        deliveryOutputId: `${ventureId}_delivery_result`,
      },
    };
  },
  founder_retention_analysis(snapshot, ventureId) {
    const neededFields = ['customerEvidence'];
    const missing = unknownFields(snapshot, neededFields);
    const hasRealCustomers = snapshot.customerEvidence?.status === 'known'
      && (snapshot.customerEvidence.value?.customerCount > 0 || snapshot.customerEvidence.value?.hasPayingCustomers === true);
    if (missing.length > 0 || !hasRealCustomers) {
      const allMissing = missing.length > 0 ? missing : ['customerEvidence_no_real_customers_yet'];
      return {
        status: 'clarification_required', missing: allMissing, known: knownFields(snapshot, neededFields), reason: `missing trusted venture facts: ${allMissing.join(', ')}`,
      };
    }
    return {
      status: 'derivable',
      missing: [],
      known: neededFields,
      identifierFields: {
        cohortId: `${ventureId}_customer_cohort`,
        dataSourceId: `${ventureId}_customer_evidence`,
        decisionOutputId: `${ventureId}_retention_decision`,
      },
    };
  },
  founder_customer_interview_set(snapshot, ventureId, entityBundle) {
    const usable = eligibleCustomerEntities(entityBundle);
    if (usable.length === 0) {
      return {
        status: 'clarification_required', missing: ['customerEntities'], known: [], reason: 'no individually-identified, confirmed target customer/prospect entities exist yet',
      };
    }
    if (!usable.some((entity) => entity.value.contactability === 'reachable')) {
      return {
        status: 'blocked', missing: ['reachable_customer'], known: ['customerEntities'], reason: 'confirmed prospects exist but none are currently reachable',
      };
    }
    return {
      status: 'derivable',
      missing: [],
      known: ['customerEntities'],
      identifierFields: { resultOutputId: `${ventureId}_interview_result` },
    };
  },
  founder_sales_outreach_block(snapshot, ventureId, entityBundle) {
    const offerKnown = snapshot.offerPricing?.status === 'known';
    const usable = eligibleCustomerEntities(entityBundle);
    if (usable.length === 0) {
      return {
        status: 'clarification_required', missing: ['customerEntities'], known: [], reason: 'no individually-identified, confirmed target customer/prospect entities exist yet',
      };
    }
    if (!offerKnown) {
      return {
        status: 'clarification_required', missing: ['offerPricing'], known: ['customerEntities'], reason: 'a sufficiently clear offer is required before outreach',
      };
    }
    const reachable = usable.filter((entity) => entity.value.contactability === 'reachable');
    if (reachable.length === 0) {
      return {
        status: 'blocked', missing: ['reachable_customer'], known: ['customerEntities', 'offerPricing'], reason: 'confirmed prospects exist but none are currently reachable',
      };
    }
    return {
      status: 'derivable',
      missing: [],
      known: ['customerEntities', 'offerPricing'],
      identifierFields: { resultOutputId: `${ventureId}_outreach_result`, offerId: `${ventureId}_offer` },
    };
  },
  founder_operating_process(snapshot, ventureId, entityBundle) {
    const usable = (entityBundle.operatingProcessEntities || []).filter(isUsableEntity);
    if (usable.length === 0) {
      return {
        status: 'clarification_required', missing: ['operatingProcessEntities'], known: [], reason: 'no real, confirmed operating-process record exists yet',
      };
    }
    // Deterministic, non-strategic tiebreak when more than one usable
    // process exists (already sorted by entityId) -- the SAME kind of fixed
    // "pick one value for a single-value field" resolution
    // OUTCOME_TYPE_PRIORITY already uses; it is not a judgment about which
    // process matters most.
    const process = usable[0];
    return {
      status: 'derivable',
      missing: [],
      known: ['operatingProcessEntities'],
      identifierFields: {
        processId: process.entityId,
        verificationOutputId: `${ventureId}_process_verification`,
        ...(process.value.failurePointId ? { failurePointId: process.value.failurePointId } : {}),
      },
    };
  },
  founder_strategy_decision(snapshot, ventureId, entityBundle) {
    const usable = (entityBundle.strategyDecisionEntities || []).filter(isUsableEntity);
    if (usable.length === 0) {
      return {
        status: 'clarification_required', missing: ['strategyDecisionEntities'], known: [], reason: 'no real, confirmed strategy decision exists yet',
      };
    }
    const open = usable.filter((entity) => entity.value.decisionStatus === 'open');
    if (open.length === 0) {
      return {
        status: 'blocked', missing: [], known: ['strategyDecisionEntities'], reason: 'the only strategy decision(s) on record are resolved/archived, not open',
      };
    }
    const withEnoughOptions = open.filter((entity) => Array.isArray(entity.value.optionIds) && entity.value.optionIds.length >= 2);
    if (withEnoughOptions.length === 0) {
      return {
        status: 'clarification_required', missing: ['strategy_decision_options'], known: ['strategyDecisionEntities'], reason: 'an open decision exists but has fewer than two real options',
      };
    }
    const decision = withEnoughOptions[0];
    return {
      status: 'derivable',
      missing: [],
      known: ['strategyDecisionEntities'],
      identifierFields: {
        decisionId: decision.entityId,
        optionIds: decision.value.optionIds,
        decisionOutputId: `${ventureId}_strategy_decision_result`,
        ...(decision.value.criteriaIds?.length ? { criteriaIds: decision.value.criteriaIds } : {}),
      },
    };
  },
});

/**
 * @typedef {object} RouteEligibility
 * @property {string} routeId
 * @property {'eligible'|'clarification_required'|'blocked'|'not_relevant'} eligibility
 * @property {string} reason
 * @property {string[]} supportingFacts Snapshot/entity field names this route's eligibility genuinely relied on.
 * @property {string[]} missingPrerequisites Snapshot fields, entity categories, or resource-binding keys still missing.
 * @property {object} identifierFields The route's required identifier fields when eligible; {} otherwise.
 * @property {object} resourceBindings Only genuinely-available bindings; {} when not eligible.
 * @property {number} confidence Mirrors the overall snapshot confidence (no independent per-route confidence formula exists; never fabricated).
 * @property {string[]} provenanceReferences Real sourceFactId values backing this route's supporting facts.
 */

/**
 * @param {object} snapshot buildFounderGoalEngineSnapshot(...)'s validated output.
 * @param {string[]} availableResourceIds Trusted resource ids (see resource-bindings.js).
 * @param {object} [entityBundle] buildFounderExecutionEntities(...)'s validated output. Defaults to an empty bundle -- every existing caller/QA scenario that never passes one keeps behaving exactly as before (the 4 entity-dependent routes simply stay clarification_required).
 * @returns {RouteEligibility[]} Exactly 7 entries, one per FOUNDER_ROUTE_CONTEXT_FIELDS key.
 */
export function evaluateRouteEligibility(snapshot, availableResourceIds, entityBundle = EMPTY_ENTITY_BUNDLE) {
  const routeIds = Object.keys(FOUNDER_ROUTE_CONTEXT_FIELDS);
  return routeIds.map((routeId) => {
    const evaluation = ROUTE_EVALUATORS[routeId](snapshot, snapshot.ventureId, entityBundle);

    if (evaluation.status === 'clarification_required' || evaluation.status === 'blocked') {
      return {
        routeId,
        eligibility: evaluation.status,
        reason: evaluation.reason,
        supportingFacts: evaluation.known,
        missingPrerequisites: evaluation.missing,
        identifierFields: {},
        resourceBindings: {},
        confidence: snapshot.confidence,
        provenanceReferences: provenanceFor(snapshot, evaluation.known),
      };
    }

    const { bindings, missingRequired, missingOptional } = resolveResourceBindings(routeId, availableResourceIds);
    if (missingRequired.length > 0) {
      return {
        routeId,
        eligibility: 'blocked',
        reason: `required resources not confirmed available: ${missingRequired.join(', ')}`,
        supportingFacts: evaluation.known,
        missingPrerequisites: missingRequired,
        identifierFields: {},
        resourceBindings: {},
        confidence: snapshot.confidence,
        provenanceReferences: provenanceFor(snapshot, evaluation.known),
      };
    }

    return {
      routeId,
      eligibility: 'eligible',
      reason: 'trusted venture facts/entities and required resources are all confirmed',
      supportingFacts: evaluation.known,
      missingPrerequisites: missingOptional,
      identifierFields: evaluation.identifierFields,
      resourceBindings: bindings,
      confidence: snapshot.confidence,
      provenanceReferences: provenanceFor(snapshot, evaluation.known),
    };
  });
}
