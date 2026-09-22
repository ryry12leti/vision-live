/**
 * Founder Execution Context — clarification.
 *
 * Derives at most 3 questions from route eligibility results, targeting
 * exactly the missing prerequisite that would unblock candidate planning --
 * never a complete-biography sweep, and never a fact the snapshot has
 * already confirmed known (a route is only ever 'clarification_required'
 * because route-eligibility.js independently found a specific snapshot
 * field unknown, so a question for that field is structurally guaranteed
 * not to repeat something already known).
 */

import {
  CLARIFICATION_QUESTION_BY_CONFLICTED_FACT,
  CLARIFICATION_QUESTION_BY_MISSING_FACT,
  FOUNDER_QUESTION_CATALOG,
  QUESTION_ID_BY_CONFLICTED_FACT,
  QUESTION_ID_BY_MISSING_FACT,
} from './contract.js';
import { buildFounderNeedLedger, askableNeeds } from './need-ledger.js';
import { INTAKE_QUESTION_IDS } from '../founder-venture-state/clarification.js';

const MAX_QUESTIONS = 3;

/* Prerequisites that are WORK, not answers -- asking for them can only ever
   dead-end, so they are never turned into a question.

   `customerEntities` is the whole set today. route-eligibility.js emits it with
   `missing: ['customerEntities']` in exactly one situation: ZERO usable
   customer entities exist. (When entities DO exist but none are reachable the
   route is 'blocked', and blocked routes are not scanned below.) So the
   question "Which of your prospects can you actually reach today? Name one you
   know is real and reachable." was only ever asked of a founder with no
   prospects at all -- and the client can only CONFIRM an already-recorded one,
   so it returned no_confirmable_prospect (409) and the founder saw an error.
   It was unanswerable 100% of the time it was asked.
   Having no prospects is not a gap in what VISION knows; it is work the
   founder has to go and do, and there is already a mission for that
   (prospectDiscoveryMission / audienceDiscoveryMission). When no such mission
   is appropriate -- an established venture whose constraint is not acquisition
   -- asking them to name a prospect is doubly wrong, and the caller's own
   fallback question about the real constraint is the honest thing to show. */
/* Traced against route-eligibility.js before being added here -- each is a
   record the founder must CREATE, not a fact they can state:
     operatingProcessEntities  -- 'no real, confirmed operating-process record
                                  exists' (route-eligibility.js:195)
     strategyDecisionEntities  -- 'no real, confirmed strategy decision exists'
                                  (route-eligibility.js:219)
     strategy_decision_options -- an open decision carries fewer than 2
                                  optionIds (route-eligibility.js:231)
   All three are entity-bundle prerequisites in exactly the same class as
   customerEntities: satisfying them means recording entities with ids, which a
   free-text answer cannot do. Asking would dead-end the founder the same way
   the customerEntities question did. strategy_decision_options is the most
   plausible future candidate -- "what are you choosing between?" is a real
   question -- but it needs to create option ENTITIES, so it stays here until
   there is a flow that can. */
const UNANSWERABLE_PREREQUISITES = new Set([
  'customerEntities',
  'operatingProcessEntities',
  'strategyDecisionEntities',
  'strategy_decision_options',
]);

/* A missing key that is neither askable nor explicitly unanswerable is a
   vocabulary gap in this module -- previously it returned null and the question
   disappeared with no trace anywhere. Failing loudly is the point: the four
   keys above were only discovered by reading route-eligibility.js line by line,
   which is not a discovery mechanism. */
export class FounderClarificationVocabularyError extends Error {
  constructor(missingFactKey) {
    super(`founder_clarification_vocabulary_gap:${missingFactKey}`);
    this.name = 'FounderClarificationVocabularyError';
    this.code = 'founder_clarification_vocabulary_gap';
    this.missingFactKey = missingFactKey;
  }
}

/* PRIORITY_ORDER used to live here:
 *
 *   // Highest-value-first: an unknown offer or unfinished-work fact blocks the
 *   // most routes (offer_test AND product_delivery_slice both need one of
 *   // these), so it is asked before a narrower single-route gap.
 *   const PRIORITY_ORDER = ['offer', 'offerPricing_or_currentGoal', ...];
 *
 * The reasoning was right; freezing it into a literal was the problem. It is
 * reasoning ABOUT route eligibility, kept in a different file from the routes,
 * with nothing to catch it when a route or a prerequisite changes.
 * need-ledger.js measures the same quantity the comment was estimating -- how
 * many blocked routes actually name this key -- from the evaluations
 * route-eligibility.js just produced. */

/* The three aliases below are compound conditions route-eligibility emits under
   their own names; each is answered by an existing question, so they resolve to
   that question's wording. Everything else looks itself up. */
const QUESTION_TEXT_ALIAS = Object.freeze({
  offerPricing: 'offer',
  offerPricing_or_currentGoal: 'currentGoal',
  customerEvidence_no_real_customers_yet: 'customerEvidence',
});

/* questionId -> the exact wording to show, built by inverting the tables above
   rather than retyping them. A question's TEXT belongs to this module; the
   ledger decides only which question. Built once, and asserted consistent: two
   prerequisite keys resolving to one id (offer and offerPricing both resolve to
   offer_detail) must resolve to one wording, or the id would name two different
   questions depending on which route happened to report first. */
const QUESTION_TEXT_BY_ID = (() => {
  const byId = {};
  const claim = (id, text, source) => {
    if (!id || !text) return;
    if (byId[id] && byId[id] !== text) {
      throw new Error(`founder_question_text_ambiguous:${id}:${source}`);
    }
    byId[id] = text;
  };
  for (const [factKey, id] of Object.entries(QUESTION_ID_BY_CONFLICTED_FACT)) {
    claim(id, CLARIFICATION_QUESTION_BY_CONFLICTED_FACT[factKey], `conflict:${factKey}`);
  }
  for (const [factKey, id] of Object.entries(QUESTION_ID_BY_MISSING_FACT)) {
    claim(id, CLARIFICATION_QUESTION_BY_MISSING_FACT[QUESTION_TEXT_ALIAS[factKey] || factKey], `missing:${factKey}`);
  }
  return Object.freeze(byId);
})();

function questionTextFor(need) {
  const text = QUESTION_TEXT_BY_ID[need.questionId];
  if (!text) throw new FounderClarificationVocabularyError(need.questionId);
  return text;
}

/**
 * @param {string} missingFactKey A key from RouteEligibility.missingPrerequisites.
 * @returns {{id: string, factKeys: string[], question: string}}
 * @throws {FounderClarificationVocabularyError} if the key is neither askable nor declared unanswerable.
 */
function questionFor(missingFactKey) {
  const textKey = QUESTION_TEXT_ALIAS[missingFactKey] || missingFactKey;
  const id = QUESTION_ID_BY_MISSING_FACT[missingFactKey];
  const question = CLARIFICATION_QUESTION_BY_MISSING_FACT[textKey];
  const entry = id ? FOUNDER_QUESTION_CATALOG[id] : null;
  if (!id || !question || !entry) throw new FounderClarificationVocabularyError(missingFactKey);
  return { id, factKeys: entry.factKeys, question };
}

/**
 * Blockers are asked in the order they actually block:
 *   1. an unresolved conflict -- the venture holds two equal-trust values and
 *      no amount of further context can settle it;
 *   2. missing critical context -- the bottleneck assessment cannot reach
 *      usable confidence without it, no matter which route is eligible;
 *   3. a specific route prerequisite.
 * The caller shows one at a time, so this order is the order the founder is
 * actually asked.
 *
 * Every returned question carries the stable id and the fact keys its answer
 * writes, so no consumer ever has to recover the meaning of a question from its
 * English text. That inference used to happen in two independent places
 * (api/_lib/founder-intake-shared.mjs's QUESTION_TEXT_TO_ID and
 * js/vision-daily-plan.js's FOUNDER_QUESTION_FACT_KEY), and a reworded question
 * silently lost its meaning in both.
 *
 * @param {import('./route-eligibility.js').RouteEligibility[]} routeEvaluations
 * @param {object} [snapshot] Trusted snapshot, for conflicts and missing critical context.
 * @returns {{id: string, factKeys: string[], question: string}[]} At most 3, never duplicated, never for a fact already known.
 * @throws {FounderClarificationVocabularyError} if a route reports a missing prerequisite this module has no verdict on.
 */
export function computeExecutionContextClarificationQuestions(routeEvaluations, snapshot = null) {
  const needs = buildFounderNeedLedger({
    snapshot,
    routeEvaluations,
    unanswerablePrerequisites: UNANSWERABLE_PREREQUISITES,
    /* Cold-start tie-break ONLY, and deliberately the intake question bank
       rather than a new list. A venture with nothing recorded has every count
       the ledger measures at zero, so something has to break the tie; reusing
       the order intake already asks in means the two paths agree on where to
       start instead of holding separate opinions. */
    bootstrapOrder: INTAKE_QUESTION_IDS,
    /* The throwing verdict stays here: this module owns the vocabulary and its
       error type, the ledger only orders what it is given. */
    assertKnownKey: (key) => { questionFor(key); },
  });

  return askableNeeds(needs)
    .slice(0, MAX_QUESTIONS)
    .map((need) => ({
      id: need.questionId,
      factKeys: need.factKeys,
      /* Wording still comes from this module's own tables -- the ledger decides
         WHICH question, never how it reads. */
      question: questionTextFor(need),
    }));
}
