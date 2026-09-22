/**
 * Founder Mission Comparison — Today's Move selection (spec sections 13-17).
 *
 * Builds exactly one Today's Move when the evidence responsibly supports
 * it, or a clarification_required result with at most 3 targeted questions
 * otherwise. Never persists (persistedTaskId is always null). Structures
 * every selected result so a future user-override feature can record one
 * without this module needing to change (spec section 17) -- but never
 * writes override data itself.
 */

import { buildFounderQuestion as detailed } from '../founder-execution-context/contract.js';

/* Takes the DETAILED questions and derives the string list from them, so the
   two can never drift apart. Callers that have a bare string (the last-resort
   questions below) name the catalog id explicitly rather than leaving the
   client to recover it from the wording. */
function clarificationResult(snapshot, detailedQuestions, explanation) {
  const questions = detailedQuestions.map((entry) => entry.question);
  return {
    status: 'clarification_required',
    selectedCandidateId: null,
    ventureId: snapshot.ventureId,
    ventureRole: snapshot.ventureRole,
    routeId: null,
    businessFunction: null,
    bottleneckId: null,
    title: null,
    missionStatement: null,
    whyNow: null,
    expectedBusinessOutcome: null,
    completionDefinition: null,
    requiredResources: null,
    missingResources: null,
    timeEstimate: null,
    effortLevel: null,
    requiredEvidence: null,
    deadline: null,
    confidence: null,
    selectionExplanation: explanation,
    rejectedAlternativeSummaries: [],
    clarificationQuestions: questions.slice(0, 3),
    clarificationQuestionsDetailed: detailedQuestions.slice(0, 3),
    persistedTaskId: null,
    overrideReadiness: null,
    professionalStandard: null,
    learningSupport: null,
  };
}

const CONFIDENCE_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });

export function minimumConfidence(left, right) {
  return CONFIDENCE_RANK[left] <= CONFIDENCE_RANK[right] ? left : right;
}

const RESOURCE_LABEL = Object.freeze({
  crm_contact_access: 'Access to the confirmed prospect',
  crm_directory_access: 'Access to the prospect directory',
  interview_question_set: 'Interview questions',
  interview_channel: 'A confirmed contact channel',
  interview_result_workspace: 'A place to record interview findings',
  interview_notes_workspace: 'A place to record interview notes',
  outreach_call_channel: 'A confirmed outreach channel',
  outreach_result_workspace: 'A place to record outreach outcomes',
  offer_record: 'The current offer record',
  segment_record: 'The selected customer segment',
  offer_presentation_channel: 'A confirmed offer-presentation channel',
  offer_response_capture_record: 'A place to record the offer response',
  offer_result_workspace: 'A place to record offer-test findings',
  product_spec: 'The current product specification',
  product_acceptance_criteria: 'Product acceptance criteria',
  repository_access: 'Connected code repository',
  build_environment: 'Connected build environment',
  test_environment: 'Connected test environment',
  delivery_access: 'A delivery-ready workspace',
  delivery_result_workspace: 'A place to record delivery results',
  retention_cohort_data: 'Current customer cohort data',
  product_analytics_dashboard: 'Customer or product analytics',
  retention_metric_definitions: 'Retention metric definitions',
  retention_decision_workspace: 'A place to record the retention decision',
  process_documentation: 'Current process documentation',
  operating_tool_access: 'Access to the operating tools',
  operational_record: 'The current operational record',
  process_verification_environment: 'A place to verify the repaired process',
  operating_outcome_workspace: 'A place to record the operational outcome',
  strategy_decision_evidence: 'Evidence for the open decision',
  strategy_option_records: 'The confirmed decision options',
  strategy_decision_criteria: 'Decision criteria',
  strategy_decision_workspace: 'A place to record the decision',
});

export function humanReadableResourceLabels(ids) {
  return ids.map((id) => RESOURCE_LABEL[id] || 'A required working resource');
}

/**
 * @param {object} params
 * @param {object} params.snapshot
 * @param {object} params.executionContext
 * @param {object} params.bottleneckAssessment A validated FounderBottleneckAssessment.
 * @param {object[]} params.candidates From candidate-brief.js.
 * @param {object} params.comparisonResult From comparison.js.
 * @returns {object} A validated-shape TodaysMove.
 */
export function selectFounderTodaysMove({
  snapshot, executionContext, bottleneckAssessment, candidates, comparisonResult,
}) {
  if (!bottleneckAssessment.primaryBottleneck) {
    return clarificationResult(
      snapshot,
      executionContext.clarificationQuestionsDetailed,
      'No responsible mission selection can be made: the trusted evidence does not support a single clear bottleneck yet.',
    );
  }

  // A genuine two-way tie is an ANSWERABLE question, not a dead end. The
  // shared decision core already narrowed it to exactly the top two
  // candidates; only the wording below is Founder's. Without this, ambiguity
  // fell through to the generic low-confidence fallback, whose answer could
  // never change which constraint leads -- the deadlock this replaces.
  // Only once nothing more concrete is outstanding: while a conflict is
  // unresolved or critical context is missing, asking the founder to choose
  // between two constraints would be asking them to guess on top of a gap the
  // system can still close with a real question.
  if (bottleneckAssessment.tieBreak && executionContext.clarificationQuestions.length === 0) {
    const [first, second] = bottleneckAssessment.tieBreak.candidates;
    return clarificationResult(
      snapshot,
      [detailed('bottleneck_tie_break', `Which is really holding you back right now: ${first.label}, or ${second.label}?`)],
      `Two constraints are currently indistinguishable on the evidence (${first.label} at ${first.score} vs ${second.label} at ${second.score}), and picking one for you could send real time and money the wrong way.`,
    );
  }

  if (!comparisonResult.selectedCandidateId) {
    const questions = executionContext.clarificationQuestionsDetailed.length > 0
      ? executionContext.clarificationQuestionsDetailed
      : [detailed('blocking_progress', `What is blocking progress on ${bottleneckAssessment.primaryBottleneck.label} right now?`)];
    return clarificationResult(
      snapshot,
      questions,
      `The primary bottleneck (${bottleneckAssessment.primaryBottleneck.label}) is identified, but no route addressing it is currently executable: ${comparisonResult.explanation}`,
    );
  }

  // Low bottleneck confidence: never select, regardless of how a candidate
  // scored -- a wrong selection here could waste real time/money (spec
  // section 8). Medium confidence may still select a safe, reversible,
  // evidence-producing mission, which every one of the 7 canonical Founder
  // routes structurally is (none commit external funds, contracts, or
  // irreversible actions on their own).
  if (bottleneckAssessment.confidence === 'low') {
    return clarificationResult(
      snapshot,
      /* Was "What is the strongest evidence you have that X is the real
         constraint?" -- a question with no fact behind it. Whatever the founder
         typed had nowhere to be stored, so the client rendered it as a statement
         with no answer box and the founder had no way forward. This asks the
         same thing in the one shape that writes a fact every consumer reads
         (unfinishedWork), so the answer actually re-drives the next generation
         instead of vanishing. */
      executionContext.clarificationQuestionsDetailed.length > 0
        ? executionContext.clarificationQuestionsDetailed
        : [detailed('blocking_progress', `What is blocking progress on ${bottleneckAssessment.primaryBottleneck.label} right now?`)],
      `Bottleneck confidence is low (${bottleneckAssessment.explanation}); selecting a mission now risks acting on the wrong constraint.`,
    );
  }

  const winner = candidates.find((candidate) => candidate.candidateId === comparisonResult.selectedCandidateId);
  const rejectedAlternativeSummaries = [
    ...comparisonResult.rejectedCandidates.map((entry) => `${entry.title} (rejected: ${entry.reason})`),
    ...candidates
      .filter((candidate) => candidate.candidateId !== winner.candidateId && !comparisonResult.rejectedCandidates.some((r) => r.candidateId === candidate.candidateId))
      .map((candidate) => `${candidate.title} (not selected: lower comparison score)`),
  ];
  const selectionIsClose = comparisonResult.selectionConfidence === 'low';
  const selectionExplanation = selectionIsClose
    ? `Selected from closely matched options as the strongest reversible, evidence-producing action supported by current evidence. ${comparisonResult.explanation}`
    : comparisonResult.explanation;

  return {
    status: 'selected',
    selectedCandidateId: winner.candidateId,
    ventureId: snapshot.ventureId,
    ventureRole: snapshot.ventureRole,
    routeId: winner.routeId,
    businessFunction: winner.businessFunction,
    bottleneckId: bottleneckAssessment.primaryBottleneck.category,
    title: winner.title,
    missionStatement: winner.missionStatement,
    whyNow: winner.whyNow,
    expectedBusinessOutcome: winner.expectedBusinessOutcome,
    completionDefinition: winner.completionDefinition,
    requiredResources: humanReadableResourceLabels(winner.requiredResourceIds),
    missingResources: humanReadableResourceLabels(winner.missingResourceIds),
    timeEstimate: winner.timeEstimateMinutes,
    effortLevel: winner.effortLevel,
    requiredEvidence: winner.requiredEvidence,
    professionalStandard: winner.professionalStandard,
    learningSupport: winner.learningSupport,
    // No route in this contract currently carries confirmed external-deadline
    // evidence reaching the trusted snapshot -- never fabricated.
    deadline: null,
    confidence: minimumConfidence(bottleneckAssessment.confidence, comparisonResult.selectionConfidence),
    selectionExplanation,
    rejectedAlternativeSummaries,
    clarificationQuestions: [],
    clarificationQuestionsDetailed: [],
    persistedTaskId: null,
    overrideReadiness: {
      systemSelectedCandidateId: winner.candidateId,
      userSelectedCandidateId: null,
      overrideReason: null,
      timestamp: null,
      bottleneckAssessmentChanged: false,
      executionOrderOnlyChanged: false,
    },
  };
}
