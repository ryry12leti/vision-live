/**
 * Founder Chat — question selection.
 *
 * The Need Ledger decides WHICH question Founder Chat asks next; the intake
 * question bank supplies the wording. There is one selection algorithm, and
 * this is the adapter that lets the intake draft feed it.
 *
 * THE OBJECTIVE IS UNDERSTANDING, NOT BREVITY. A task being technically
 * generatable is not a reason to stop asking: the engine can select a move for a
 * venture VISION could not describe back to its founder, and advising from that
 * position is how confident, wrong advice gets made. So the ledger is asked with
 * `understandingFloor: true`, and questioning continues while any floor fact is
 * still unknown even when every route is already satisfied.
 *
 * Ten useful questions beat four that leave VISION half-blind. The cap here is a
 * guardrail against absurd length, not a target.
 */

import { buildMaterialisedVentureState, buildFounderGoalEngineSnapshot } from '../founder-venture-state/snapshot.js';
import { buildEntityCollections } from '../founder-venture-state/entity-snapshot.js';
import { buildFounderExecutionContext } from '../founder-execution-context/builder.js';
import { buildFounderNeedLedger, askableNeeds, FOUNDER_UNDERSTANDING_FLOOR } from '../founder-execution-context/need-ledger.js';
import { computeClarificationQuestions, INTAKE_QUESTION_IDS } from '../founder-venture-state/clarification.js';
import { CLARIFICATION_QUESTION_BY_CONFLICTED_FACT, QUESTION_ID_BY_CONFLICTED_FACT, FOUNDER_QUESTION_CATALOG } from '../founder-execution-context/contract.js';
import { buildSyntheticVentureRow, INTAKE_BASELINE_RESOURCE_IDS } from './pipeline.js';

/* One question at a time. Founder Chat is a conversation, and a conversation
   that fires three questions at once gets three shallow answers. The ledger
   ranks, so the top need is by construction the highest-value thing to ask. */
export const FOUNDER_CHAT_QUESTIONS_PER_TURN = 1;

/* A guardrail against a pathological loop, NOT a question budget. It sits far
   above the ~10 the floor implies, so it can only ever fire on a genuine defect
   -- and if it fires the reason is reported rather than silently swallowed. */
export const FOUNDER_CHAT_QUESTION_CAP = 20;

const UNANSWERABLE_PREREQUISITES = new Set([
  'customerEntities', 'operatingProcessEntities', 'strategyDecisionEntities', 'strategy_decision_options',
]);

/* Why a need was chosen, in the founder's terms rather than the engine's. Used
   for the "why am I being asked this" line and for test evidence -- never for
   selection, which stays entirely the ledger's. */
const RATIONALE_BY_KIND = Object.freeze({
  conflict: 'Two answers disagree, and no further context can settle it.',
  missing_critical: 'The venture cannot be assessed with confidence until this is known.',
  route_prerequisite: 'This is what currently blocks a real next move.',
  understanding_floor: 'VISION needs this to understand the venture, even though a task could be generated without it.',
});

/**
 * Builds the Goal Engine view of an intake draft. Returns null when the draft
 * is too thin to materialise -- the caller then falls back to the bank, so a
 * founder is never left with no question because the engine could not run.
 */
function engineViewOf(facts, ventureId, rebuilt) {
  try {
    const evaluationTime = new Date().toISOString();
    const ventureRow = buildSyntheticVentureRow(rebuilt.perKey);
    const state = buildMaterialisedVentureState({
      ventureId, ventureRole: 'primary', userId: `${ventureId}_selector`, stateVersion: 1, ventureRow, rebuilt, evaluationTime,
    });
    const snapshot = buildFounderGoalEngineSnapshot(state, evaluationTime);
    const entityBundle = buildEntityCollections(rebuilt, ventureId);
    const executionContext = buildFounderExecutionContext({
      snapshot, availableResourceIds: INTAKE_BASELINE_RESOURCE_IDS, entityBundle,
    });
    return { snapshot, executionContext };
  } catch {
    /* Fails closed to the bank rather than to silence. */
    return null;
  }
}

/**
 * @param {object} params
 * @param {object[]} params.facts The draft's accumulated facts.
 * @param {string} params.ventureId
 * @param {object} params.rebuilt rebuildStateFromFacts(facts)
 * @returns {{questions: {id: string, factKeys: string[], question: string}[], rationale: object|null, understandingComplete: boolean}}
 */
export function selectFounderChatQuestions({ facts, ventureId, rebuilt }) {
  /* The bank is the wording authority AND the answerability authority: a
     question only appears here while its own knownWhen is unsatisfied, so
     anything VISION already reliably knows is excluded before selection even
     begins.
     UNCAPPED deliberately. The bank's own default caps at three IN BANK ORDER,
     and applying that before the ledger ranks makes it a second
     question-order algorithm: the ledger could only ever choose among the first
     three unanswered bank questions. The cap that matters is applied after
     ranking, below. */
  const available = computeClarificationQuestions(rebuilt.perKey, rebuilt.conflicts, Number.POSITIVE_INFINITY);
  const byId = new Map(available.map((entry) => [entry.id, entry]));

  /* A CONTRADICTION IS NOT A GAP, so the knownWhen bank has no question for it:
     both values are known, they simply disagree. The ledger ranks conflicts
     first -- correctly, since no amount of further context settles one -- but
     every conflict need was being dropped here for want of wording, and Founder
     Chat asked the next gap instead while the contradiction stood.
     The wording comes from the engine's existing conflicted-fact table, so
     there is still one vocabulary and no new question text. */
  for (const conflict of rebuilt.conflicts || []) {
    const questionId = QUESTION_ID_BY_CONFLICTED_FACT[conflict.factKey];
    const question = CLARIFICATION_QUESTION_BY_CONFLICTED_FACT[conflict.factKey];
    if (!questionId || !question || byId.has(questionId)) continue;
    byId.set(questionId, {
      id: questionId,
      factKeys: [...FOUNDER_QUESTION_CATALOG[questionId].factKeys],
      question,
    });
  }

  const engine = engineViewOf(facts, ventureId, rebuilt);
  if (!engine) {
    return {
      questions: available.slice(0, FOUNDER_CHAT_QUESTIONS_PER_TURN),
      rationale: available.length ? { kind: 'bootstrap', reason: 'Getting the basics of the venture on record.' } : null,
      understandingComplete: available.length === 0,
    };
  }

  const needs = buildFounderNeedLedger({
    snapshot: engine.snapshot,
    routeEvaluations: engine.executionContext.routeEvaluations,
    unanswerablePrerequisites: UNANSWERABLE_PREREQUISITES,
    bootstrapOrder: INTAKE_QUESTION_IDS,
    perKey: rebuilt.perKey,
    understandingFloor: true,
  });

  /* A need only becomes a question if the bank still has one for it. That is
     what keeps an internal prerequisite -- a record the founder must create, not
     a fact they can state -- from ever being put to them as a question, and it
     is why nothing already known can be re-asked. */
  const selected = [];
  for (const need of askableNeeds(needs)) {
    const entry = byId.get(need.questionId);
    if (!entry) continue;
    selected.push({ need, entry });
    if (selected.length >= FOUNDER_CHAT_QUESTIONS_PER_TURN) break;
  }

  /* STOPPING. Not "a task can be generated" -- that is an outcome, not a
     licence. Questioning stops when nothing contradicts, nothing critical is
     missing, the understanding floor is covered, and every remaining need is
     one an answer provably cannot improve. */
  const blocking = needs.filter((need) => need.kind === 'conflict' || need.kind === 'missing_critical');
  const floorOutstanding = FOUNDER_UNDERSTANDING_FLOOR
    .filter((item) => needs.some((need) => need.kind === 'understanding_floor' && need.questionId === item.questionId))
    .map((item) => item.factKey);
  const remainingHasValue = askableNeeds(needs).some((need) => (
    byId.has(need.questionId) && need.satisfiable !== 'value_gated'));

  return {
    questions: selected.map(({ entry }) => entry),
    rationale: selected.length
      ? {
        kind: selected[0].need.kind,
        reason: RATIONALE_BY_KIND[selected[0].need.kind] || 'This materially improves what VISION knows.',
        unblocks: selected[0].need.unblocks,
        satisfiable: selected[0].need.satisfiable,
      }
      : null,
    understandingComplete: blocking.length === 0 && floorOutstanding.length === 0 && !remainingHasValue,
  };
}
