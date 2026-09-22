/**
 * Founder Execution Context — shared vocabulary.
 *
 * Re-exports the single shared contract domain-intelligence/founder.js
 * itself validates against (see mission-evaluator/candidate-contract.js),
 * so this subsystem can never drift from what the planner actually accepts.
 *
 * Also defines the fixed, platform-wide canonical resource-id vocabulary
 * per route binding key, and a fixed business-function -> outcome-type
 * lookup -- the same "fixed lookup table, never a per-request guess" style
 * domain-intelligence/founder.js's own STRATEGIC_PRINCIPLE/
 * FOUNDER_WORK_UNIT_BUSINESS_FUNCTION already use.
 */

export {
  FOUNDER_EXECUTION_CONTEXT_CONTRACT_VERSION,
  FOUNDER_ROUTE_CONTEXT_FIELDS,
} from '../mission-evaluator/candidate-contract.js';

// The businessFunction each of the 7 canonical Founder work units belongs
// to (mirrors founder.js's own FOUNDER_WORK_UNIT_BUSINESS_FUNCTION, which is
// not exported -- duplicated here deliberately as a SEPARATE, smaller fact:
// this table only needs to know which function gates domainFacts
// eligibility, not the full routing logic).
export const FOUNDER_WORK_UNIT_BUSINESS_FUNCTION = Object.freeze({
  founder_customer_interview_set: 'validation',
  founder_sales_outreach_block: 'sales',
  founder_offer_test: 'validation',
  founder_product_delivery_slice: 'delivery',
  founder_retention_analysis: 'retention',
  founder_operating_process: 'operations',
  founder_strategy_decision: 'strategy',
});

// Work units this subsystem can derive from Founder Venture Snapshot facts
// alone. The other 5 (including offer testing, which needs a reachable real
// target) additionally need a
// real entity from the Founder Execution Entities bundle (see
// founder-venture-state/entity-snapshot.js) -- see route-eligibility.js's
// ROUTE_EVALUATORS for exactly how each of the 7 becomes eligible. No route
// is permanently unavailable any more; each simply requires its own real
// inputs to exist.
export const SNAPSHOT_ONLY_DERIVABLE_WORK_UNITS = Object.freeze([
  'founder_product_delivery_slice',
  'founder_retention_analysis',
]);
export const ENTITY_DEPENDENT_WORK_UNITS = Object.freeze([
  'founder_customer_interview_set',
  'founder_sales_outreach_block',
  'founder_offer_test',
  'founder_operating_process',
  'founder_strategy_decision',
]);

// A fixed, non-strategic tiebreak for domainFacts.requiredOutcomeTypes[0] --
// founder.js's own domainDetailsFor() reads a single shared outcomeTypeId
// for whichever work unit it is currently evaluating (the existing schema
// has no per-work-unit outcome-type field), so when more than one business
// function is genuinely active this fixed priority order picks ONE label
// deterministically. This does not affect WHICH routes are eligible -- only
// this cosmetic/display field within domainDetailConstraints -- and is
// therefore not a bottleneck or Today's-Move decision.
export const OUTCOME_TYPE_PRIORITY = Object.freeze(['validation', 'delivery', 'retention', 'sales', 'operations', 'strategy']);
export const OUTCOME_TYPE_BY_BUSINESS_FUNCTION = Object.freeze({
  validation: 'validation_result',
  sales: 'customer_commitment',
  delivery: 'delivery_output',
  retention: 'retention_decision',
  operations: 'operational_outcome',
  strategy: 'strategy_decision_output',
});

// Canonical, platform-wide resource-id vocabulary per route binding key.
// These are fixed capability-type identifiers (the same platform-defined
// vocabulary hasRequiredResources() already checks profiles.resources
// against) -- never per-venture-unique ids -- so a route's resourceBindings
// can only ever be genuinely "available" when the founder's own confirmed
// available-resources list literally contains one of these exact ids.
export const CANONICAL_RESOURCE_IDS = Object.freeze({
  founder_customer_interview_set: Object.freeze({
    contactAccess: 'crm_contact_access',
    questionSet: 'interview_question_set',
    channel: 'interview_channel',
    resultWorkspace: 'interview_result_workspace',
    notesWorkspace: 'interview_notes_workspace',
  }),
  founder_sales_outreach_block: Object.freeze({
    crmAccess: 'crm_directory_access',
    channel: 'outreach_call_channel',
    resultWorkspace: 'outreach_result_workspace',
    offerRecord: 'offer_record',
  }),
  founder_offer_test: Object.freeze({
    offerRecord: 'offer_record',
    segmentRecord: 'segment_record',
    presentationChannel: 'offer_presentation_channel',
    responseCaptureRecord: 'offer_response_capture_record',
    resultWorkspace: 'offer_result_workspace',
    testAudienceAccess: 'offer_test_audience_access',
  }),
  founder_product_delivery_slice: Object.freeze({
    productSpec: 'product_spec',
    acceptanceCriteria: 'product_acceptance_criteria',
    repositoryAccess: 'repository_access',
    buildEnvironment: 'build_environment',
    testEnvironment: 'test_environment',
    deliveryAccess: 'delivery_access',
    resultWorkspace: 'delivery_result_workspace',
    customerDeliveryChannel: 'customer_delivery_channel',
  }),
  founder_retention_analysis: Object.freeze({
    cohortData: 'retention_cohort_data',
    analyticsAccess: 'product_analytics_dashboard',
    metricDefinitions: 'retention_metric_definitions',
    decisionWorkspace: 'retention_decision_workspace',
    interventionEvidence: 'retention_intervention_evidence',
  }),
  founder_operating_process: Object.freeze({
    processDocumentation: 'process_documentation',
    toolAccess: 'operating_tool_access',
    operationalRecord: 'operational_record',
    verificationEnvironment: 'process_verification_environment',
    outcomeWorkspace: 'operating_outcome_workspace',
  }),
  founder_strategy_decision: Object.freeze({
    decisionEvidence: 'strategy_decision_evidence',
    optionRecords: 'strategy_option_records',
    decisionCriteria: 'strategy_decision_criteria',
    decisionWorkspace: 'strategy_decision_workspace',
  }),
});

// The venture-snapshot section(s) each CRITICAL clarification topic maps to,
// and the fixed, deterministic question text -- never fabricated per
// venture, never repeated once the fact is known (callers only ever surface
// a question for a section this module has independently confirmed is
// unknown).
export const CLARIFICATION_QUESTION_BY_MISSING_FACT = Object.freeze({
  offer: 'What is your core offer (what do you charge for, or plan to)?',
  customerEvidence: 'Who are your current or target customers, and what evidence do you have of demand?',
  unfinishedWork: 'What work is still unfinished on your product or service right now?',
  currentGoal: 'What is the single most important thing you are trying to achieve right now?',
  // A provisional customer entity is deliberately not usable for eligibility
  // (see founder-venture-state/entity-snapshot.js: "provisional entities may
  // be visible but must produce clarification or confirmation requirements").
  // Without this entry that confirmation requirement had no question, so
  // computeExecutionContextClarificationQuestions() returned [] and
  // selectFounderTodaysMove() fell back to a generic question whose answer can
  // only ever write facts that are already known -- the venture could never
  // leave clarification. The answer to THIS question is a confirmation of one
  // specific, already-recorded prospect, never a new fabricated one.
  customerEntities: 'Which of your prospects can you actually reach today? Name one you know is real and reachable.',
  // Critical context the bottleneck assessment needs before it can trust any
  // constraint. These were previously unreachable from here: route eligibility
  // never requires them, so nothing ever asked, and the venture sat at low
  // confidence permanently.
  targetCustomer: 'Who is your target customer?',
  completedWork: 'What have you completed so far?',
});

/**
 * A conflicted fact is not a MISSING fact -- the venture holds two
 * equal-trust values for it and the system must never silently pick one. Only
 * an explicit user answer (recorded at higher trust) resolves it.
 */
export const CLARIFICATION_QUESTION_BY_CONFLICTED_FACT = Object.freeze({
  idea: 'We have two different descriptions of your business on record. Which one is right?',
  offer: 'We have two different descriptions of your offer on record. Which one is right?',
  targetCustomer: 'We have two different target customers on record. Which one is right?',
});

/* ── Founder question identity ─────────────────────────────────────────────
 *
 * ONE stable, server-supplied vocabulary for every question VISION can ask a
 * founder. The contract that matters is IDENTITY -> WHICH FACTS THE ANSWER
 * WRITES. Wording is presentation and stays with each emitter: the intake flow
 * and the execution-context engine legitimately word the same fact differently
 * ("What exactly do you sell, and what does someone get for it?" vs "What is
 * your core offer (what do you charge for, or plan to)?"), and unifying the
 * text would be a UX change nobody asked for. Unifying the ID is the fix.
 *
 * WHY. Three layers independently re-derived a question's meaning from its
 * exact English text:
 *   1. clarification.js returned bare strings with no id at all;
 *   2. api/_lib/founder-intake-shared.mjs recovered an id via
 *      QUESTION_TEXT_TO_ID[text] (its own comment called this a bridge for
 *      "clarification.js (unmodified)");
 *   3. js/vision-daily-plan.js recovered a fact key via
 *      FOUNDER_QUESTION_FACT_KEY[text].
 * Any reworded question silently lost its meaning, and a question whose key
 * had no entry vanished without trace.
 *
 * The ids are the ones already in production use (KNOWN_QUESTION_IDS in
 * api/_lib/founder-intake-shared.mjs) so nothing already stored is invalidated.
 * `factKeys` is deliberately an array: the offer question asks about both
 * `offer` and `offerPricing`, and answering it must satisfy both or the founder
 * is asked again (see scripts/qa-founder-question-fact-routing.mjs).
 */
export const FOUNDER_QUESTION_CATALOG = Object.freeze({
  what_building: Object.freeze({ factKeys: Object.freeze(['idea']) }),
  offer_detail: Object.freeze({ factKeys: Object.freeze(['offer', 'offerPricing']) }),
  who_for: Object.freeze({ factKeys: Object.freeze(['targetCustomer']) }),
  completed: Object.freeze({ factKeys: Object.freeze(['completedWork']) }),
  unfinished: Object.freeze({ factKeys: Object.freeze(['unfinishedWork']) }),
  next_outcome: Object.freeze({ factKeys: Object.freeze(['immediateGoal']) }),
  evidence: Object.freeze({ factKeys: Object.freeze(['customerEvidence']) }),
  offer_price: Object.freeze({ factKeys: Object.freeze(['offerPricing']) }),
  outreach_channel: Object.freeze({ factKeys: Object.freeze(['outreachChannel']) }),
  resources_constraints: Object.freeze({ factKeys: Object.freeze(['constraints']) }),
  /* The founder's OWN view of what is holding them back. Deliberately not an
     input to bottleneck assessment -- the engine derives the constraint from
     evidence and keeps that authority (see the note on bottleneck_tie_break
     below). This is understanding: it is shown in the understood view and used
     to word personalisation, so VISION can say what the founder told it rather
     than only what it inferred. */
  current_bottleneck: Object.freeze({ factKeys: Object.freeze(['currentBottleneck']) }),

  /* Emitted by route-eligibility when confirmed prospects exist but none has
     contactability === 'reachable'. It has a stable id here so the identity
     exists, but it is NOT reachable today: route-eligibility only ever attaches
     it to a 'blocked' route, and computeExecutionContextClarificationQuestions
     scans 'clarification_required' routes only. Making it askable means
     scanning blocked routes -- a behaviour change, not a contract change, and
     deliberately not made here. */
  reachable_customer: Object.freeze({ factKeys: Object.freeze(['customerEntities']) }),

  /* Disambiguation questions. A conflict is two equal-trust values the ledger
     refuses to silently pick between, so the answer rewrites one named fact. */
  conflict_idea: Object.freeze({ factKeys: Object.freeze(['idea']) }),
  conflict_offer: Object.freeze({ factKeys: Object.freeze(['offer']) }),
  conflict_target_customer: Object.freeze({ factKeys: Object.freeze(['targetCustomer']) }),
  completion_claim_conflict: Object.freeze({ factKeys: Object.freeze(['completedWork', 'unfinishedWork']) }),

  /* Last-resort questions. They interpolate the bottleneck's own label
     ("...on product/delivery right now?"), so no exact-text table could ever
     match them -- js/vision-daily-plan.js resorts to PREFIX matching for
     exactly these two, which an id removes the need for. */
  blocking_progress: Object.freeze({ factKeys: Object.freeze(['unfinishedWork']) }),

  /* Asked after a selected task turns out to need a channel it does not have
     (founder-decision-service/task-quality-gate.js). Post-selection wording
     only -- it never changes WHICH task was chosen. */
  outreach_channel_for_task: Object.freeze({ factKeys: Object.freeze(['outreachChannel']) }),

  /* STATEMENTS, not questions: `factKeys: []` says so explicitly.
     Both are cases where VISION is telling the founder something rather than
     asking, and no fact the founder could type would change the outcome. The
     client already renders them without an answer box -- but today it does so
     by ACCIDENT (the text matched no entry in its table), which is
     indistinguishable from a question whose mapping someone forgot. Declaring
     the empty fact set makes "there is nothing to answer here" a stated
     property of the question rather than a gap.
     bottleneck_tie_break is a known limitation kept as-is on purpose: the
     founder plausibly COULD answer it, but the only fact the answer maps to is
     `currentBottleneck`, which is not an input the bottleneck assessment reads
     back, so offering an answer box would re-ask the same tie forever. Fixing
     that means making the assessment honour a founder-declared constraint --
     real work, deliberately not smuggled into a contract repair. */
  bottleneck_tie_break: Object.freeze({ factKeys: Object.freeze([]) }),
  unsupported_target: Object.freeze({ factKeys: Object.freeze([]) }),
});

/* Missing-prerequisite key -> question id. Includes the aliases
   route-eligibility emits for compound conditions. A key that is absent here
   AND absent from UNANSWERABLE_PREREQUISITES is a programming error, not a
   silent no-op -- see clarification.js. */
export const QUESTION_ID_BY_MISSING_FACT = Object.freeze({
  offer: 'offer_detail',
  offerPricing: 'offer_detail',
  offerPricing_or_currentGoal: 'next_outcome',
  currentGoal: 'next_outcome',
  targetCustomer: 'who_for',
  completedWork: 'completed',
  unfinishedWork: 'unfinished',
  customerEvidence: 'evidence',
  customerEvidence_no_real_customers_yet: 'evidence',
  reachable_customer: 'reachable_customer',
});

export const QUESTION_ID_BY_CONFLICTED_FACT = Object.freeze({
  idea: 'conflict_idea',
  offer: 'conflict_offer',
  targetCustomer: 'conflict_target_customer',
});

/**
 * The one way to attach identity to a question that is composed at the call
 * site rather than looked up (the last-resort questions interpolate a
 * bottleneck label, so they can never be table entries). Throws on an id the
 * catalog does not know, for the same reason clarification.js throws: a
 * question with no identity is exactly the failure this contract exists to
 * remove, and it must not be creatable by typo.
 *
 * @param {string} id A FOUNDER_QUESTION_CATALOG key.
 * @param {string} question The exact wording to show the founder.
 * @returns {{id: string, factKeys: string[], question: string}}
 */
export function buildFounderQuestion(id, question) {
  const entry = FOUNDER_QUESTION_CATALOG[id];
  if (!entry) throw new Error(`founder_question_unknown_id:${id}`);
  if (typeof question !== 'string' || !question.trim()) throw new Error(`founder_question_empty_text:${id}`);
  return { id, factKeys: entry.factKeys, question };
}
