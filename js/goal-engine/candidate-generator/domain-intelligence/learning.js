/**
 * Learning domain intelligence: targets the actual assessment, rubric
 * criterion, knowledge gap, and required output from trusted domain facts.
 * Every canonical work unit is an active retrieval/application/drafting/
 * revision/submission action — there is no passive-reading route to fall
 * back to, so this module never needs to reject one.
 *
 * Seven canonical work-unit families exist, each a genuinely distinct
 * action sequence (LEARNING_WORK_UNITS below). A knowledge-gap or rubric-
 * criterion ID is a real trusted fact, but it is not itself a diagnostic
 * question, retrieval prompt, application case, or mock-assessment task —
 * routes that genuinely need one (diagnostic, retrieval, application, mock
 * assessment) read the actual trusted task id from the versioned
 * `learningExecutionContext` contract (request.programme.requiredAttributes
 * .learningExecutionContext, validated by shared.js's
 * validateExecutionContextRoute against LEARNING_ROUTE_CONTEXT_FIELDS) and
 * exclude the route when no genuine task exists — never manufacture a
 * question from the gap/criterion id itself. Drafting, revision, and
 * submission-check routes are legitimately grounded directly in the rubric
 * criteria themselves (drafting *against* a criterion, revising *against*
 * a criterion, verifying *a* criterion are not questions).
 */

import {
  LEARNING_EXECUTION_CONTEXT_CONTRACT_VERSION,
} from '../../mission-evaluator/candidate-contract.js';
import {
  buildExecutionUnit,
  firstPairing,
  hardEffortFor,
  hasRequiredResources,
  mediumEffortFor,
  missionStructureFor,
  progressionTargetFor,
  proofRequirementFor,
  resourceIdsForBindingKeys,
  timeBudgetFor,
  trustedMethodIdFor,
  twoStepPlan,
  unionOfItemRequiredResources,
  validateExecutionContextRoute,
} from './shared.js';

const BOTTLENECK_WORK_UNITS = Object.freeze({
  specific_knowledge_gap: ['learning_diagnostic_set', 'learning_retrieval_block'],
  retrieval_failure: ['learning_retrieval_block'],
  application_failure: ['learning_application_set'],
  drafting_block: ['learning_draft_section'],
  rubric_mismatch: ['learning_draft_section', 'learning_revision_pass'],
  revision_quality: ['learning_revision_pass'],
  submission_risk: ['learning_submission_check'],
});

const GOAL_CATEGORY_WORK_UNITS = Object.freeze({
  assessment_output: ['learning_mock_assessment'],
  rubric_mastery: ['learning_application_set', 'learning_draft_section'],
  knowledge_gap: ['learning_diagnostic_set'],
  recall: ['learning_retrieval_block'],
  application: ['learning_application_set'],
  drafting: ['learning_draft_section'],
  revision: ['learning_revision_pass'],
  submission_readiness: ['learning_submission_check'],
});

const STRATEGIC_PRINCIPLE = Object.freeze({
  learning_diagnostic_set: 'Locate the specific knowledge or skill gap with a representative diagnostic',
  learning_retrieval_block: 'Closed-book retrieval on the named material, corrected against an authoritative source',
  learning_application_set: 'Apply the target concept across a coherent set of problems or cases',
  learning_draft_section: 'Produce a complete assessment section tied to the named rubric criteria',
  learning_revision_pass: 'Revise the draft against feedback or the rubric with substantive changes',
  learning_mock_assessment: 'Complete a bounded assessment under representative conditions and analyse errors',
  learning_submission_check: 'Verify the final output against every material rubric and submission requirement',
});

// Route field contracts for learningExecutionContext.routes[workUnitTypeId].
// `taskIds` (where `hasTaskIds` is true) must pair 1:1, in order, with the
// trusted domainFacts array named by `pairedField` — every item's real
// trusted task is tied to the exact knowledge gap or rubric criterion it
// targets. `resourceBindings` is required on every route: the exact
// trusted resource ids each of this route's items genuinely need
// (assessment file, rubric, source material, draft, feedback, ...), never
// inferred from an assessmentId or rubric-criterion id alone.
const LEARNING_ROUTE_CONTEXT_FIELDS = Object.freeze({
  learning_diagnostic_set: Object.freeze({
    required: ['taskIds', 'resourceBindings'], optional: [], pairedField: 'knowledgeGapIds', hasTaskIds: true,
    resourceBindingKeys: Object.freeze({ required: ['taskResource', 'answerWorkspace', 'resultWorkspace'], optional: ['sourceMaterial'] }),
  }),
  learning_retrieval_block: Object.freeze({
    required: ['taskIds', 'sourceId', 'resourceBindings'], optional: [], pairedField: 'knowledgeGapIds', hasTaskIds: true,
    resourceBindingKeys: Object.freeze({ required: ['promptResource', 'correctionSourceAccess', 'answerWorkspace', 'resultWorkspace'] }),
  }),
  learning_application_set: Object.freeze({
    required: ['taskIds', 'resourceBindings'], optional: [], pairedField: 'rubricCriterionIds', hasTaskIds: true,
    resourceBindingKeys: Object.freeze({ required: ['taskResource', 'answerWorkspace'], optional: ['referenceMaterial'] }),
  }),
  learning_draft_section: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['assessmentFile', 'requiredSection', 'rubricAccess', 'draftWorkspace'], optional: ['sourceMaterial'] }),
  }),
  learning_revision_pass: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['currentDraft', 'rubricAccess', 'revisionWorkspace'], optional: ['teacherFeedback', 'sourceMaterial'] }),
  }),
  learning_mock_assessment: Object.freeze({
    required: ['taskIds', 'assessmentScopeId', 'resourceBindings'], optional: [], pairedField: 'rubricCriterionIds', hasTaskIds: true,
    resourceBindingKeys: Object.freeze({ required: ['mockTaskSet', 'instructionsResource', 'responseWorkspace', 'resultWorkspace'] }),
  }),
  learning_submission_check: Object.freeze({
    required: ['resourceBindings'], optional: [],
    resourceBindingKeys: Object.freeze({ required: ['finalDraft', 'rubricAccess', 'instructionsResource', 'checklistWorkspace'], optional: ['citationRequirements', 'wordCountRequirement', 'fileFormatRequirement'] }),
  }),
});

// Per work unit: which resourceBindingKeys apply to every per-target item
// vs. this route's own closing/synthesis item (null when the route has no
// closing item — see LEARNING_WORK_UNITS[...].closing). Every function
// receives the already-validated route so an omitted optional binding
// (e.g. teacherFeedback) simply contributes no resources.
const LEARNING_ITEM_RESOURCE_BINDINGS = Object.freeze({
  learning_diagnostic_set: Object.freeze({
    item: (route) => ['taskResource', 'answerWorkspace', ...(route.resourceBindings.sourceMaterial ? ['sourceMaterial'] : [])],
    closing: () => ['resultWorkspace'],
  }),
  learning_retrieval_block: Object.freeze({
    item: () => ['promptResource', 'answerWorkspace'],
    closing: () => ['correctionSourceAccess', 'resultWorkspace'],
  }),
  learning_application_set: Object.freeze({
    item: (route) => ['taskResource', 'answerWorkspace', ...(route.resourceBindings.referenceMaterial ? ['referenceMaterial'] : [])],
    closing: null,
  }),
  learning_draft_section: Object.freeze({
    item: (route) => ['assessmentFile', 'requiredSection', 'draftWorkspace', ...(route.resourceBindings.sourceMaterial ? ['sourceMaterial'] : [])],
    closing: () => ['rubricAccess', 'draftWorkspace'],
  }),
  learning_revision_pass: Object.freeze({
    item: (route) => [
      'currentDraft', 'rubricAccess', 'revisionWorkspace',
      ...(route.resourceBindings.teacherFeedback ? ['teacherFeedback'] : []),
      ...(route.resourceBindings.sourceMaterial ? ['sourceMaterial'] : []),
    ],
    closing: null,
  }),
  learning_mock_assessment: Object.freeze({
    item: () => ['mockTaskSet', 'instructionsResource', 'responseWorkspace'],
    closing: () => ['resultWorkspace'],
  }),
  learning_submission_check: Object.freeze({
    item: () => ['finalDraft', 'rubricAccess'],
    closing: (route) => [
      'instructionsResource', 'checklistWorkspace',
      ...(route.resourceBindings.citationRequirements ? ['citationRequirements'] : []),
      ...(route.resourceBindings.wordCountRequirement ? ['wordCountRequirement'] : []),
      ...(route.resourceBindings.fileFormatRequirement ? ['fileFormatRequirement'] : []),
    ],
  }),
});

/**
 * Each of the seven canonical Learning work units, as a genuinely distinct
 * action sequence rather than a shared `solve_and_correct_output` applied
 * everywhere. `sourceField` names which trusted domainFacts array grounds
 * this route's targets (falling back to `fallbackField` when the primary
 * array is empty). Routes with a `LEARNING_ROUTE_CONTEXT_FIELDS` entry
 * source each item's `referenceId` from the matching trusted task id
 * (paired by order with `sourceField`); routes without one use the trusted
 * knowledge-gap/rubric-criterion id itself as `referenceId`, which
 * `supportingReferenceId` never duplicates.
 */
const LEARNING_WORK_UNITS = Object.freeze({
  learning_diagnostic_set: Object.freeze({
    sourceField: 'knowledgeGapIds',
    referenceType: 'diagnostic_task',
    actionType: 'attempt_and_classify_error',
    stageType: 'diagnostic',
    itemLabel: (id) => `Diagnostic attempt: ${id}`,
    closing: Object.freeze({ actionType: 'record_diagnostic_result', label: 'Record the diagnostic result', referenceType: 'diagnostic_result' }),
  }),
  learning_retrieval_block: Object.freeze({
    sourceField: 'knowledgeGapIds',
    referenceType: 'retrieval_prompt',
    actionType: 'closed_book_retrieval_attempt',
    stageType: 'retrieval',
    itemLabel: (id) => `Closed-book retrieval: ${id}`,
    closing: Object.freeze({ actionType: 'record_retrieval_result', label: 'Correct against the authoritative source and record the retrieval result', referenceType: 'retrieval_result' }),
  }),
  learning_application_set: Object.freeze({
    sourceField: 'rubricCriterionIds',
    referenceType: 'application_task',
    actionType: 'solve_and_correct_output',
    stageType: 'application',
    itemLabel: (id) => `Apply the concept: ${id}`,
  }),
  learning_draft_section: Object.freeze({
    sourceField: 'rubricCriterionIds',
    referenceType: 'rubric_criterion',
    actionType: 'draft_required_component',
    stageType: 'drafting',
    itemLabel: (id) => `Draft the component for: ${id}`,
    closing: Object.freeze({ actionType: 'run_rubric_review', label: 'Run the rubric review on the completed draft section', referenceType: 'draft_section_result' }),
  }),
  learning_revision_pass: Object.freeze({
    sourceField: 'rubricCriterionIds',
    referenceType: 'rubric_criterion',
    actionType: 'revise_against_criterion',
    stageType: 'revision',
    itemLabel: (id) => `Revise against: ${id}`,
  }),
  learning_mock_assessment: Object.freeze({
    sourceField: 'rubricCriterionIds',
    referenceType: 'mock_task',
    actionType: 'complete_under_mock_conditions',
    stageType: 'mock_assessment',
    itemLabel: (id) => `Mock-condition task: ${id}`,
    closing: Object.freeze({ actionType: 'review_mock_errors', label: 'Review errors and record the final mock result', referenceType: 'mock_assessment_result' }),
  }),
  learning_submission_check: Object.freeze({
    sourceField: 'rubricCriterionIds',
    referenceType: 'rubric_criterion',
    actionType: 'verify_rubric_criterion',
    stageType: 'submission_check',
    itemLabel: (id) => `Verify rubric criterion: ${id}`,
    closing: Object.freeze({ actionType: 'verify_output_format_and_instructions', label: 'Verify instructions, required sections, and output format', referenceType: 'submission_checklist_result' }),
  }),
});

function relevantWorkUnitIds(request) {
  const canonicalIds = new Set(request.canonicalWorkUnits.map((wu) => wu.id));
  const priority = [
    ...(BOTTLENECK_WORK_UNITS[request.bottleneck.category] || []),
    ...(GOAL_CATEGORY_WORK_UNITS[request.goal.category] || []),
  ].filter((id) => canonicalIds.has(id));
  const ordered = [...new Set(priority)];
  if (ordered.length === 0) return [...canonicalIds].sort();
  return ordered;
}

/**
 * Returns null when the request carries no trusted assessment id, no
 * trusted required output, or no trusted allowed learning method — the
 * caller must exclude the route rather than validate a blank field or fall
 * back to a fabricated `${workUnitTypeId}_output` / `${workUnitTypeId}_method`
 * placeholder.
 */
function domainDetailsFor(request) {
  const facts = request.domainFacts;
  if (typeof facts.assessmentId !== 'string' || facts.assessmentId.trim().length === 0) return null;
  const requiredOutputId = (facts.requiredOutputIds || [])[0];
  if (!requiredOutputId) return null;
  const learningMethod = (facts.allowedLearningMethods || [])[0];
  if (!learningMethod) return null;
  return {
    assessmentId: facts.assessmentId,
    rubricCriterionIds: facts.rubricCriterionIds || [],
    knowledgeGapIds: facts.knowledgeGapIds || [],
    requiredOutputId,
    learningStage: facts.learningStage,
    learningMethod,
    completionEvidenceId: requiredOutputId,
  };
}

/**
 * Reads and validates this route's learningExecutionContext entry — always
 * required now, for its resourceBindings alone if nothing else. For routes
 * with `hasTaskIds`, also validates that `taskIds` pairs exactly 1:1 (in
 * order) with the trusted domainFacts targets that ground this route.
 * Returns null when the context is absent, malformed, the resource
 * bindings are incomplete, or (for task-based routes) the task count does
 * not exactly match the target count — the caller must exclude the route
 * rather than invent a question from the knowledge-gap/rubric-criterion id
 * or leave an item genuinely resource-free.
 */
function trustedRouteFor(request, workUnitTypeId, targets) {
  const route = validateExecutionContextRoute(
    request, 'learningExecutionContext', LEARNING_EXECUTION_CONTEXT_CONTRACT_VERSION, LEARNING_ROUTE_CONTEXT_FIELDS, workUnitTypeId,
  );
  if (!route) return null;
  const spec = LEARNING_ROUTE_CONTEXT_FIELDS[workUnitTypeId];
  if (spec.hasTaskIds && route.taskIds.length !== targets.length) return null;
  return route;
}

/**
 * The complete study/assessment block for one of the seven canonical
 * Learning work units: one ordered item per confirmed trusted target
 * (knowledge gap or rubric criterion), plus this route's own closing
 * synthesis item where one applies. Returns null when the request carries
 * no confirmed target, no confirmed required output, no valid trusted
 * learningExecutionContext route (resourceBindings included), or — for
 * diagnostic/retrieval/application/mock routes — no genuine trusted task
 * per target — the caller must exclude the route rather than invent one to
 * assess or leave it resource-free.
 */
function executionUnitFor(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard }) {
  const spec = LEARNING_WORK_UNITS[workUnitTypeId];
  const facts = request.domainFacts;
  const requiredOutputId = (facts.requiredOutputIds || [])[0];
  if (!requiredOutputId) return null;

  const targets = facts[spec.sourceField] || [];
  if (targets.length === 0) return null;

  const routeContextSpec = LEARNING_ROUTE_CONTEXT_FIELDS[workUnitTypeId];
  const route = trustedRouteFor(request, workUnitTypeId, targets);
  if (!route) return null;
  const taskIds = routeContextSpec.hasTaskIds ? route.taskIds : null;
  const closingSupportingReferenceId = routeContextSpec.hasTaskIds
    ? (route.sourceId || route.assessmentScopeId || facts.assessmentId)
    : facts.assessmentId;

  const bindings = LEARNING_ITEM_RESOURCE_BINDINGS[workUnitTypeId];
  const itemRequiredResourceIds = resourceIdsForBindingKeys(route, bindings.item(route));

  const totalItems = targets.length + (spec.closing ? 1 : 0);
  const perItemEffort = Math.max(1, Math.floor(hard / totalItems));

  const items = targets.map((target, index) => ({
    itemId: `${workUnitTypeId}_item_${index + 1}`,
    order: index + 1,
    label: spec.itemLabel(taskIds ? taskIds[index] : target),
    actionType: spec.actionType,
    effortUnits: perItemEffort,
    requiredResourceIds: itemRequiredResourceIds,
    domainItemDetails: {
      referenceId: taskIds ? taskIds[index] : target,
      referenceType: spec.referenceType,
      supportingReferenceId: taskIds ? target : facts.assessmentId,
      requiredOutputId,
      stageType: spec.stageType,
    },
  }));

  if (spec.closing) {
    items.push({
      itemId: `${workUnitTypeId}_item_${items.length + 1}`,
      order: items.length + 1,
      label: spec.closing.label,
      actionType: spec.closing.actionType,
      effortUnits: Math.max(1, hard - (perItemEffort * targets.length)),
      requiredResourceIds: resourceIdsForBindingKeys(route, bindings.closing(route)),
      domainItemDetails: {
        referenceId: requiredOutputId,
        referenceType: spec.closing.referenceType,
        supportingReferenceId: closingSupportingReferenceId,
        requiredOutputId,
        stageType: spec.stageType,
      },
    });
  }

  return buildExecutionUnit({
    workUnitTypeId,
    unitType: items.length > 1 ? 'multi_item_session' : 'single_item_session',
    unitLabel: STRATEGIC_PRINCIPLE[workUnitTypeId] || workUnitTypeId,
    unitSummary: `${targets.length} rubric/knowledge-targeted task${targets.length === 1 ? '' : 's'}${spec.closing ? ' plus result' : ''} · ${timeBudgetMinutes} minutes`,
    items,
    estimatedMinutes: timeBudgetMinutes,
    progressionTarget: progressionTargetFor(measurableOutcome, 'Correct every item against the rubric and close the previously identified gaps.'),
    proofRequirement: proofRequirementFor(pairing.evidenceTypeId, pairing.proofMode, 'Submit the corrected, complete output for every item in this block.'),
  });
}

function briefForWorkUnit(request, workUnitTypeId, index) {
  const pairing = firstPairing(request, workUnitTypeId);
  if (!pairing) return null;

  // Learning is the one domain whose trusted facts carry their own
  // allowed-method list (allowedLearningMethods): a supported method must
  // also appear there, not merely be the sole verified capability entry.
  const methodId = trustedMethodIdFor(request, { allowedMethodIds: request.domainFacts.allowedLearningMethods });
  if (!methodId) return null;

  const domainDetailConstraints = domainDetailsFor(request);
  if (!domainDetailConstraints) return null;

  const hard = hardEffortFor(request, { preferred: 6 });
  const medium = mediumEffortFor(hard);
  const structure = missionStructureFor(hard, medium);
  const claimCategoryId = pairing.sharedClaimCategoryIds[0];
  const outputCategoryId = pairing.sharedOutputCategoryIds[0];
  const timeBudgetMinutes = timeBudgetFor(request, { preferred: 40 });
  const measurableOutcome = { type: `${workUnitTypeId}_outcome`, targetId: request.currentMilestone.id, measurable: true };

  const executionUnit = executionUnitFor(request, workUnitTypeId, { measurableOutcome, timeBudgetMinutes, pairing, hard });
  if (!executionUnit) return null;

  // The union of what the execution unit's own items actually require is
  // the sole source of truth for the brief's requiredResourceIds. A route
  // whose real per-item resources (assessment file, rubric, draft,
  // feedback, ...) are not fully available must still exclude the route
  // rather than plan an unexecutable mission.
  const requiredResourceIds = unionOfItemRequiredResources(executionUnit.items);
  if (requiredResourceIds === null || !hasRequiredResources(request, requiredResourceIds)) return null;

  return {
    briefId: `learning_brief_${index + 1}`,
    strategyLens: `${request.bottleneck.category}_via_${workUnitTypeId}`,
    workUnitTypeId,
    evidenceTypeId: pairing.evidenceTypeId,
    proofMode: pairing.proofMode,
    claimCategoryId,
    outputCategoryId,
    strategicReason: `${STRATEGIC_PRINCIPLE[workUnitTypeId]}, addressing the active bottleneck (${request.bottleneck.category}).`,
    method: { id: methodId, progressionIntent: 'maintain' },
    measurableOutcome,
    missionStepPlan: twoStepPlan(outputCategoryId, 'retrieve_or_review_material', LEARNING_WORK_UNITS[workUnitTypeId].actionType, hard),
    missionStructureKind: structure.missionStructureKind,
    timeBudgetMinutes,
    effortBudget: structure.effortBudget,
    requiredResourceIds,
    domainDetailConstraints,
    professionalExecutionUnit: executionUnit,
  };
}

/**
 * @param {object} request
 * @returns {object[]} 0-5 candidate briefs, genuinely distinct by work unit.
 */
export function planLearningBriefs(request) {
  const briefs = [];
  for (const workUnitTypeId of relevantWorkUnitIds(request)) {
    const brief = briefForWorkUnit(request, workUnitTypeId, briefs.length);
    if (brief) briefs.push(brief);
  }
  return briefs;
}
