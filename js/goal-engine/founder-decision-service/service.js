/**
 * Founder Decision Service — the ONE canonical Founder engine entry point
 * (spec Phase 2). Both the live real-user path (generate-tasks) and the
 * owner shadow preview (goal-engine-shadow-run) must call this exact
 * function; neither may re-implement bottleneck/mission/Right-Next-Move
 * logic of its own. Pure and read-only: never calls a database, never
 * calls a model provider, never persists -- the caller applies
 * `result.stateUpdates` through the real Founder Venture State RPCs and
 * `result.todaysMove` through the real task-persistence path.
 */

import { assessFounderBottleneck, FounderBottleneckInputError } from '../founder-bottleneck/index.js';
import {
  planFounderMissionComparison, FounderMissionComparisonInputError,
  decideRightNextMove, RightNextMoveInputError,
} from '../founder-mission-comparison/index.js';
import { generateFounderPrerequisiteMission, promoteWinningCandidate } from '../founder-mission-policy/index.js';
import { routeFounderVenture, describeUnsupportedTarget } from '../founder-venture-router/index.js';
import { assessFounderCapabilityLevel } from './skill-level.js';
import { adaptExecutionForSkillLevel } from './adaptation.js';
import { FOUNDER_DECISION_RESULT_VERSION } from './contract.js';
import { buildFounderQuestion } from '../founder-execution-context/contract.js';
import { consumeOntologyContextForDecision } from './ontology-context.js';

export class FounderDecisionServiceError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'FounderDecisionServiceError';
    this.code = code;
  }
}

/* The prerequisite resolver reads facts by key and treats an ABSENT key as
   unknown (`Boolean(perKey.offerPricing)` is its "is there an offer at all?"
   test). A snapshot section is present-but-unknown instead, so handing the
   snapshot straight over would report every unknown fact as known.
   Only some of what the resolver needs is in the snapshot at all: offerPricing,
   customerEvidence and unfinishedWork are top-level sections, but
   targetCustomer has NO snapshot representation and `idea` is only
   ventureDefinition.description. The caller therefore passes the fact ledger's
   own perKey when it has one (see founder-engine-bridge), and this fills the
   rest. Without the caller's perKey there is no target customer, so no
   prospect-discovery prerequisite can be produced -- which is why a web-design
   founder with no clients got a task from intake and a question from the daily
   path even after both paths shared a resolver. */
const SNAPSHOT_SECTION_FACT_KEYS = Object.freeze(['offerPricing', 'customerEvidence', 'unfinishedWork']);

function perKeyFromSnapshot(snapshot, factsByKey) {
  const perKey = {};
  for (const key of SNAPSHOT_SECTION_FACT_KEYS) {
    const section = snapshot?.[key];
    if (section && section.status === 'known') perKey[key] = { value: section.value };
  }
  const description = snapshot?.ventureDefinition?.description;
  if (typeof description === 'string' && description.trim()) perKey.idea = { value: description };
  /* The caller's ledger-derived facts are authoritative where they exist --
     they are the same values the intake path resolves against. */
  for (const [key, entry] of Object.entries(factsByKey || {})) {
    if (entry && entry.value !== undefined && entry.value !== null) perKey[key] = { value: entry.value };
  }
  return perKey;
}

function clarificationResult({
  ventureId, ventureRole, questions, reason,
}) {
  return {
    contractVersion: FOUNDER_DECISION_RESULT_VERSION,
    status: 'clarification_required',
    ventureId,
    ventureRole,
    activeOutcome: null,
    currentBottleneck: null,
    decisionType: null,
    todaysMove: null,
    completionDefinition: null,
    expectedOutcome: null,
    professionalStandard: null,
    standardGuidance: null,
    requiredEvidence: null,
    evidenceBatchReference: null,
    learningSupport: null,
    guidanceLevel: null,
    relatedEntities: null,
    taskVersion: null,
    stateUpdates: { activeOutcomeThread: null, entityFactUpdates: [] },
    reasonForDecision: reason,
    confidence: 'low',
    clarificationQuestions: questions.map((entry) => entry.question).slice(0, 3),
    clarificationQuestionsDetailed: questions.slice(0, 3),
    userSafeExplanation: null,
  };
}

/**
 * Turns a prerequisite mission into the SAME FounderDecisionResult a route-based
 * mission produces, through the same Right-Next-Move, capability and adaptation
 * layers -- so the frontend, the persistence adapter and the task-quality gate
 * cannot tell the two apart and need no new branch.
 *
 * @param {object} params
 * @param {object} params.mission A TodaysMove-shaped prerequisite carrying steps, professionalStandard, bottleneckId and businessFunction.
 * @returns {object} A validated-shape FounderDecisionResult with status 'selected'.
 */
function buildSelectedResult({
  ventureId, ventureRole, mission, bottleneckAssessment, snapshot, entityBundle, activeThread, meaningfulEvent,
  evaluationTime,
}) {
  let rightNextMove;
  try {
    rightNextMove = decideRightNextMove({
      activeThread, todaysMove: mission, meaningfulEvent, ventureId, evaluationTime,
    });
  } catch (error) {
    const code = error instanceof RightNextMoveInputError ? error.code : 'right_next_move_failed';
    throw new FounderDecisionServiceError(code, `Right-Next-Move decision failed: ${error.message}`);
  }

  const { level: skillLevel } = assessFounderCapabilityLevel(mission.businessFunction, snapshot, entityBundle);
  const adapted = adaptExecutionForSkillLevel({
    level: skillLevel,
    businessFunction: mission.businessFunction,
    steps: mission.steps,
    professionalStandard: mission.professionalStandard,
    learningSupport: mission.learningSupport ?? null,
    requiredEvidence: mission.requiredEvidence,
  });

  const outcomeSentence = String(mission.expectedBusinessOutcome || '').trim();
  const titleSentence = String(mission.title || '').trim().replace(/\.$/, '');

  return {
    contractVersion: FOUNDER_DECISION_RESULT_VERSION,
    status: 'selected',
    ventureId,
    ventureRole,
    activeOutcome: rightNextMove.nextThread.activeOutcome,
    currentBottleneck: {
      category: bottleneckAssessment.primaryBottleneck.category,
      label: bottleneckAssessment.primaryBottleneck.label,
      score: bottleneckAssessment.primaryBottleneck.score,
      reason: bottleneckAssessment.primaryBottleneck.reason,
    },
    decisionType: rightNextMove.decision,
    todaysMove: {
      title: mission.title,
      missionStatement: mission.missionStatement,
      steps: adapted.steps,
      timeEstimateMinutes: mission.timeEstimate,
      effortLevel: mission.effortLevel,
    },
    completionDefinition: mission.completionDefinition,
    expectedOutcome: mission.expectedBusinessOutcome,
    professionalStandard: adapted.professionalStandard,
    standardGuidance: adapted.standardGuidance,
    requiredEvidence: adapted.requiredEvidence,
    learningSupport: adapted.learningSupport,
    guidanceLevel: adapted.guidanceLevel,
    relatedEntities: rightNextMove.nextThread.relatedEntityIds,
    taskVersion: rightNextMove.nextThread.taskVersion,
    stateUpdates: {
      activeOutcomeThread: rightNextMove.decision === 'keep' ? null : rightNextMove.nextThread,
      entityFactUpdates: [],
    },
    reasonForDecision: rightNextMove.reason,
    confidence: bottleneckAssessment.confidence,
    clarificationQuestions: [],
    clarificationQuestionsDetailed: [],
    userSafeExplanation: `${titleSentence}. ${outcomeSentence}`.trim(),
    /* Only prerequisite missions carry one today; every other mission
       explicitly references no batch. */
    evidenceBatchReference: mission.evidenceBatchReference ?? null,
  };
}

/**
 * @param {object} params
 * @param {object} params.snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @param {object} params.entityBundle Trusted buildFounderExecutionEntities(...) output (already reflecting any just-applied engagement-signal update).
 * @param {object} params.executionContext Trusted buildFounderExecutionContext(...) output.
 * @param {string} params.evaluationTime ISO timestamp.
 * @param {{title: string}[]} [params.recentTasks] Recent live task titles, for duplication detection only.
 * @param {object|null} [params.activeThread] The venture's current activeOutcomeThread section value, or null if none exists yet.
 * @param {{summary: string, interpretation: string, relatedEntityIds?: string[]}|null} [params.meaningfulEvent] A structured, already-interpreted event reported this call, or null for a routine recomputation.
 * @param {{offerText: string|null, channelLabel: string|null}|null} [params.missionContext] Real, already-trusted venture facts used to word the mission concretely (see task-quality-gate.js's resolveFounderTaskContentFacts). Never changes WHICH task is selected -- only how the selected one reads.
 * @param {object|null} [params.factsByKey] The venture's fact ledger keyed by factKey (founder-engine-bridge exposes this as `perKey`). Used ONLY to build a prerequisite mission when no route can produce one; never changes which route is selected.
 * @param {{batchId: string, source: string}|null} [params.evidenceBatchReference] Durable pointer to the stored batch of gathered items this venture is working through, resolved by the CALLER from whichever subsystem owns it. Purely a pointer the mission can carry so a task can name a real, re-resolvable collection instead of embedding records; never changes which route or mission is selected.
 * @param {{candidateId: string, candidateSetSignature: string}|null} [params.tieBreakChoice] A user's bounded answer to a previous bottleneck tie-break. Ignored unless it names one of the CURRENT top two tied candidates; never overrides a clear evidence winner.
 * @param {object|null} [params.ontologyContext] Validated frozen Ontology/Context Fusion context. It is consumed only as provenance and uncertainty context; it has no strategy authority.
 * @returns {object} A validated-shape FounderDecisionResult (see contract.js).
 */
export function runFounderDecisionService({
  snapshot, entityBundle, executionContext, evaluationTime, recentTasks = [], activeThread = null, meaningfulEvent = null,
  tieBreakChoice = null, missionContext = null, factsByKey = null, evidenceBatchReference = null,
  ontologyContext = null,
}) {
  const ventureId = snapshot.ventureId;
  const ventureRole = snapshot.ventureRole;

  /* Deliberately no decision fields are read from this value. Validation and
     venture binding prove that the exact frozen context was consumed by this
     same service, while the existing Demigod logic below remains the sole
     owner of candidates, strategy, active outcome, Today’s Move and priority. */
  if (ontologyContext !== null) consumeOntologyContextForDecision(ontologyContext, ventureId);

  let bottleneckAssessment;
  try {
    bottleneckAssessment = assessFounderBottleneck({
      snapshot, entityBundle, executionContext, evaluationTime, tieBreakChoice,
    });
  } catch (error) {
    const code = error instanceof FounderBottleneckInputError ? error.code : 'bottleneck_assessment_failed';
    throw new FounderDecisionServiceError(code, `bottleneck assessment failed: ${error.message}`);
  }

  let planned;
  try {
    planned = planFounderMissionComparison({
      snapshot, entityBundle, executionContext, bottleneckAssessment, recentTasks, missionContext,
    });
  } catch (error) {
    const code = error instanceof FounderMissionComparisonInputError ? error.code : 'mission_comparison_failed';
    throw new FounderDecisionServiceError(code, `mission comparison failed: ${error.message}`);
  }
  const { candidates, comparisonResult, todaysMove } = planned;

  /* A REAL ROUTE OUTRANKS A PREREQUISITE TEMPLATE.
     selectFounderTodaysMove refuses to commit once bottleneck confidence is
     'low' -- and a purely self-reported venture mathematically caps at 'low'
     after the staleness downgrade, however complete its answers are. The
     intake path has always promoted the winning candidate past that gate
     (founder-mission-policy's documented CORE FIX); this path never did, so it
     discarded a fully-derived, bottleneck-aligned mission and fell through to
     the prerequisite templates below.
     What that cost: a missed-call SaaS with two pilot accounts, billing
     integrated and "webhook processing fails so missed calls are dropped" had
     founder_product_delivery_slice generated, aligned `primary` and SELECTED by
     the comparison -- with real steps ("Complete: ...", "Verify every
     acceptance criterion") -- and was handed "Build a qualified list of
     plumbing businesses" instead.
     Confidence is still never overstated: promoteWinningCandidate caps the
     recommendation at 'medium' and labels it self-reported. */
  if (todaysMove.status !== 'selected' && comparisonResult?.selectedCandidateId) {
    const winner = candidates.find((candidate) => candidate.candidateId === comparisonResult.selectedCandidateId);
    if (winner) {
      return buildSelectedResult({
        ventureId,
        ventureRole,
        mission: promoteWinningCandidate({ winner, bottleneckAssessment, comparisonResult }),
        bottleneckAssessment,
        snapshot,
        entityBundle,
        activeThread,
        meaningfulEvent,
        evaluationTime,
      });
    }
  }

  /* No route could produce a mission. Before falling back to a question, try
     the prerequisite templates -- the SAME resolver the intake path uses.
     Without this the two orchestrators disagreed: a venture could be given a
     real task at onboarding and nothing but a question on its daily run. The
     worst case was a blocked route with no alternative, e.g. an agency whose
     constraint is product/delivery but who will never connect a repository,
     asked "What is blocking progress on product/delivery right now?" -- a
     question their own recorded answer had already answered, and which no
     answer could unblock.
     A prerequisite is still only produced when one can be built from recorded
     facts; when it cannot, the question is the honest outcome and is asked
     exactly as before. */
  if (todaysMove.status !== 'selected') {
    /* A prerequisite is only safe once the venture state is actually decidable.
       The intake path reaches this resolver only after detectExplicitConflict
       has cleared; this path has no equivalent, and without the same gate a
       ledger holding two contradictory descriptions of the business was handed
       a confident task instead of the question that resolves the contradiction
       -- confidently acting on a state we know is self-contradictory is worse
       than asking.
       Deliberately NOT gated on 'low' bottleneck confidence, which was tried
       first: an early-stage founder with no customers is assessed
       low-confidence BECAUSE they have no customer evidence -- that is the
       diagnosis itself, not doubt about it -- and gating on it withheld the
       prospect-list task from exactly the founders who most need one.
       Note `blockingConflicts` is read with an explicit length check, not
       `a || b`: it is an empty ARRAY when nothing is blocking, which is truthy,
       so `blockingConflicts || conflicts` silently discarded every real
       conflict and this gate passed the self-contradictory ledger it exists to
       stop. */
    const conflicts = snapshot?.blockingConflicts?.length ? snapshot.blockingConflicts : (snapshot?.conflicts || []);
    const decidable = conflicts.length === 0 && (snapshot?.missingCriticalContext || []).length === 0;
    const prerequisite = decidable
      ? generateFounderPrerequisiteMission({
        perKey: perKeyFromSnapshot(snapshot, factsByKey),
        entityBundle,
        bottleneckAssessment,
        routeEvaluations: executionContext.routeEvaluations,
        prospectBatchReference: evidenceBatchReference,
      })
      : null;
    if (prerequisite) {
      return buildSelectedResult({
        ventureId, ventureRole, mission: prerequisite, bottleneckAssessment,
        snapshot, entityBundle, activeThread, meaningfulEvent, evaluationTime,
      });
    }
    /* No route ran and no prerequisite could be built. Before falling back to
       the generic question, say the specific true thing when there is one: a
       founder whose customers are players has told VISION exactly who they
       sell to, and asking them again "who are your customers?" is both useless
       and insulting -- it reads as though nothing they typed was heard.
       This is the honest end of the gate in founder-mission-policy: that gate
       refuses to run the business-prospect template, and this explains why
       rather than leaving a generic question in its place. */
    const routerPerKey = perKeyFromSnapshot(snapshot, factsByKey);
    const route = routeFounderVenture({ perKey: routerPerKey });
    /* REAL QUESTIONS COME FIRST. This message replaced them outright, and that
       stranded a founder completely: with completedWork and unfinishedWork
       still missing, `decidable` is false, so no prerequisite is even attempted
       -- and the two questions that would have made it decidable were swapped
       for an explanation with no answer box. Nothing they could do moved it.
       "Not supported yet" is only true once VISION actually knows the venture.
       While it is still missing critical facts, the honest thing is to ask for
       them; the unsupported state is the END of intake, not a substitute for
       it. */
    if (todaysMove.clarificationQuestions.length === 0 && route.missionPattern === 'unsupported_target') {
      return clarificationResult({
        ventureId,
        ventureRole,
        questions: [buildFounderQuestion('unsupported_target', describeUnsupportedTarget(route, routerPerKey.targetCustomer?.value))],
        reason: route.reason,
      });
    }
    return clarificationResult({
      ventureId,
      ventureRole,
      questions: todaysMove.clarificationQuestionsDetailed.length > 0
        ? todaysMove.clarificationQuestionsDetailed
        : [buildFounderQuestion('blocking_progress', 'What is the single most important thing blocking progress right now?')],
      reason: todaysMove.selectionExplanation,
    });
  }

  /* A route SELECTED. Normally that ends it -- the prerequisite templates are
     a fallback for when no route can run, and they should stay one.
     The exception is a route that CONSUMES a batch the founder is still in the
     middle of gathering. Route eligibility asks only whether at least one
     usable prospect exists, so approving a single business flipped
     founder_customer_interview_set to eligible and the founder was handed
     "Interview Lead 0 to validate the core problem" -- abandoning the list
     VISION had just told them to build to eight, and spending the one real
     prospect they had on a mission the batch was not ready for.
     So: while the batch is genuinely below what the active mission asked for,
     and the winning route is one this prerequisite exists to unlock, finishing
     the batch wins. Any other route is untouched -- a founder whose real
     constraint has moved elsewhere is not dragged back to list-building. */
  const decidableForBatch = (snapshot?.blockingConflicts?.length ? snapshot.blockingConflicts : (snapshot?.conflicts || [])).length === 0
    && (snapshot?.missingCriticalContext || []).length === 0;
  if (decidableForBatch) {
    const unfinishedBatchMission = generateFounderPrerequisiteMission({
      perKey: perKeyFromSnapshot(snapshot, factsByKey),
      entityBundle,
      bottleneckAssessment,
      routeEvaluations: executionContext.routeEvaluations,
      prospectBatchReference: evidenceBatchReference,
    });
    if (unfinishedBatchMission
      && Array.isArray(unfinishedBatchMission.unlocksRouteIds)
      && unfinishedBatchMission.unlocksRouteIds.includes(todaysMove.routeId)) {
      return buildSelectedResult({
        ventureId, ventureRole, mission: unfinishedBatchMission, bottleneckAssessment,
        snapshot, entityBundle, activeThread, meaningfulEvent, evaluationTime,
      });
    }
  }

  let rightNextMove;
  try {
    rightNextMove = decideRightNextMove({
      activeThread, todaysMove, meaningfulEvent, ventureId, evaluationTime,
    });
  } catch (error) {
    const code = error instanceof RightNextMoveInputError ? error.code : 'right_next_move_failed';
    throw new FounderDecisionServiceError(code, `Right-Next-Move decision failed: ${error.message}`);
  }

  const winner = candidates.find((candidate) => candidate.candidateId === todaysMove.selectedCandidateId);
  if (!winner) throw new FounderDecisionServiceError('winning_candidate_missing', 'selected candidateId does not match any generated candidate');

  const { level: skillLevel } = assessFounderCapabilityLevel(todaysMove.businessFunction, snapshot, entityBundle);
  const adapted = adaptExecutionForSkillLevel({
    level: skillLevel,
    businessFunction: todaysMove.businessFunction,
    steps: winner.steps,
    professionalStandard: todaysMove.professionalStandard,
    learningSupport: todaysMove.learningSupport,
    requiredEvidence: todaysMove.requiredEvidence,
  });

  /* expectedBusinessOutcome is a full sentence ("The venture gains a
     recorded commitment or evidenced no from each attempted contact."), so
     interpolating it after "toward" produced a mangled run-on ending in
     ".:" -- seen verbatim on the real Today's Move card. Present the two as
     separate sentences instead, and never emit a doubled full stop. */
  const outcomeSentence = String(todaysMove.expectedBusinessOutcome || '').trim();
  const titleSentence = String(todaysMove.title || '').trim().replace(/\.$/, '');
  const userSafeExplanation = rightNextMove.decision === 'start'
    ? `${titleSentence}. ${outcomeSentence}`.trim()
    : rightNextMove.decision === 'keep'
      ? `Continuing today's move: ${titleSentence}.`
      : `${meaningfulEvent?.summary ? 'Based on what you just reported, ' : ''}today's move is now: ${titleSentence}.`;

  return {
    contractVersion: FOUNDER_DECISION_RESULT_VERSION,
    status: 'selected',
    ventureId,
    ventureRole,
    activeOutcome: rightNextMove.nextThread.activeOutcome,
    currentBottleneck: {
      category: bottleneckAssessment.primaryBottleneck.category,
      label: bottleneckAssessment.primaryBottleneck.label,
      score: bottleneckAssessment.primaryBottleneck.score,
      reason: bottleneckAssessment.primaryBottleneck.reason,
    },
    decisionType: rightNextMove.decision,
    todaysMove: {
      title: todaysMove.title,
      missionStatement: todaysMove.missionStatement,
      steps: adapted.steps,
      timeEstimateMinutes: todaysMove.timeEstimate,
      effortLevel: todaysMove.effortLevel,
    },
    completionDefinition: todaysMove.completionDefinition,
    expectedOutcome: todaysMove.expectedBusinessOutcome,
    professionalStandard: adapted.professionalStandard,
    standardGuidance: adapted.standardGuidance,
    requiredEvidence: adapted.requiredEvidence,
    learningSupport: adapted.learningSupport,
    guidanceLevel: adapted.guidanceLevel,
    relatedEntities: rightNextMove.nextThread.relatedEntityIds,
    taskVersion: rightNextMove.nextThread.taskVersion,
    stateUpdates: {
      activeOutcomeThread: rightNextMove.decision === 'keep' ? null : rightNextMove.nextThread,
      entityFactUpdates: [],
    },
    reasonForDecision: rightNextMove.reason,
    confidence: bottleneckAssessment.confidence,
    clarificationQuestions: [],
    clarificationQuestionsDetailed: [],
    userSafeExplanation,
    /* Route-selected missions reference no batch: this builder handles the
       case where a real route produced the mission, and only the prerequisite
       templates carry a batch pointer. Stated explicitly rather than omitted,
       because the contract is exact-fields. */
    evidenceBatchReference: todaysMove.evidenceBatchReference ?? null,
  };
}
