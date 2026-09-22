/**
 * Founder Venture State V2 — the clarification engine.
 *
 * Given a rebuilt venture state (fact-ledger.js's per-key map), returns the
 * smallest useful set of clarification questions — never more than three,
 * never repeating something already known, always ordered by what the next
 * intelligent Founder decision actually needs first (task spec section 8).
 * Pure function: same input, same questions, every time.
 */

const QUESTION_ORDER = Object.freeze([
  {
    /* Narrowed to `idea` alone, which is exactly what this question's own
       fallback writes. It previously also counted `offer` and `niche`, so a
       founder who described what they SELL was never asked what they are
       BUILDING -- and `idea` stayed permanently unknown. Measured: VISION
       finished intake understanding 10 of 11 floor facts for four of eight
       archetypes, missing the venture itself, while believing the question had
       been answered.
       The warning above is against requiring `offer` here -- that would ask a
       question whose own answer could never satisfy it. Requiring `idea` is the
       opposite: the fallback writes precisely this key, so one answer settles
       it and the fallback<->knownWhen invariant holds exactly. */
    id: 'what_building',
    knownWhen: (perKey) => Boolean(perKey.idea),
    factKeys: Object.freeze(['idea']),
    question: 'What exactly are you building or selling?',
  },
  /* `what_building` above is satisfied by an IDEA alone, so a founder who
     says "I'm starting a cleaning business" marks it answered and is never
     asked what they actually sell. But `offer` is a CRITICAL_SECTION
     (snapshot.js), so it stays `unknown`, keeps missingCriticalContext
     non-empty, pins bottleneck confidence to 'low', and the engine refuses to
     select a mission -- while the question that could fill it never gets
     asked. That is an unanswerable loop, the same shape as the one already
     fixed for next_outcome (see QUESTION_FALLBACK in
     api/_lib/founder-intake-shared.mjs).
     Fixed by asking for the offer in its OWN question rather than by
     tightening what_building's knownWhen: what_building's fallback writes to
     `idea`, so making it require `offer` would ask a question whose own answer
     could never satisfy it -- trading one loop for another. */
  {
    id: 'offer_detail',
    knownWhen: (perKey) => Boolean(perKey.offer),
    factKeys: Object.freeze(['offer']),
    question: 'What exactly do you sell, and what does someone get for it?',
  },
  {
    id: 'who_for',
    knownWhen: (perKey) => Boolean(perKey.targetCustomer),
    factKeys: Object.freeze(['targetCustomer']),
    question: 'Who is it for?',
  },
  {
    id: 'completed',
    knownWhen: (perKey) => Boolean(perKey.completedWork),
    factKeys: Object.freeze(['completedWork']),
    question: 'What have you completed so far?',
  },
  {
    id: 'unfinished',
    knownWhen: (perKey) => Boolean(perKey.unfinishedWork),
    factKeys: Object.freeze(['unfinishedWork']),
    question: 'What is currently unfinished?',
  },
  {
    id: 'next_outcome',
    knownWhen: (perKey) => Boolean(perKey.immediateGoal),
    factKeys: Object.freeze(['immediateGoal']),
    question: 'What outcome are you trying to achieve next?',
  },
  {
    id: 'evidence',
    knownWhen: (perKey) => Boolean(perKey.customerEvidence || perKey.revenue),
    factKeys: Object.freeze(['customerEvidence']),
    question: 'What evidence of customers, users, or revenue exists?',
  },
  /* Neither of the next two is a CRITICAL_SECTION, so asking them cannot make
     a venture MORE likely to fail closed on low confidence. They exist purely
     so the selected task can be worded with the founder's real terms:
     resolveFounderTaskContentFacts (founder-decision-service/task-quality-gate.js)
     reads offerPricing/offer as the task's subject and outreachChannel as its
     action verb. Without them a task says "present the current offer" instead
     of quoting what the founder actually charges, and guesses at how they
     reach people. Placed after `evidence` so every confidence- and
     bottleneck-driving answer is collected first. */
  {
    id: 'offer_price',
    knownWhen: (perKey) => Boolean(perKey.offerPricing),
    factKeys: Object.freeze(['offerPricing']),
    question: 'What do you charge for it, and how is it billed?',
  },
  {
    /* Same wording as CHANNEL_QUESTION in
       founder-decision-service/task-quality-gate.js, which asks this same
       thing later and only when a selected task happens to need it. Asking it
       here means an outreach task is concrete on day one instead of after a
       detour. Kept identical so a founder is never asked the same thing twice
       in two different phrasings. */
    id: 'outreach_channel',
    knownWhen: (perKey) => Boolean(perKey.outreachChannel),
    factKeys: Object.freeze(['outreachChannel']),
    question: 'How will you reach them: call, text, email, or in person?',
  },
  {
    /* Asked last among understanding questions: it is the founder's own read on
       the constraint, which is most useful once they have already described the
       venture, the offer and the work. Never an input to the engine's own
       bottleneck assessment. */
    id: 'current_bottleneck',
    knownWhen: (perKey) => Boolean(perKey.currentBottleneck),
    factKeys: Object.freeze(['currentBottleneck']),
    question: 'What is the single biggest thing holding the business back right now?',
  },
  {
    id: 'resources_constraints',
    knownWhen: (perKey) => Boolean(perKey.availableResourceIds || perKey.constraints),
    factKeys: Object.freeze(['constraints']),
    question: 'What resources or constraints affect execution?',
  },
]);

export const MAX_CLARIFICATION_QUESTIONS = 3;

/* Asked only when the ledger holds two disagreeing revenue claims. It has no
   QUESTION_FALLBACK entry on purpose: its answer must be parsed into
   offerPricing/revenue by the extractor, and storing the raw sentence under
   either key would assert a number the founder may not have given. It carries
   an id all the same -- an unidentified question is how a question becomes
   untraceable, and this one had been reaching the API as `id: null`. */
const REVENUE_CONFLICT_QUESTION = Object.freeze({
  id: 'pricing_revenue_conflict',
  /* Deliberately EMPTY. This question has no targeted fallback: its answer must
     be parsed into offerPricing/revenue by the extractor, and naming fact keys
     here would tell the client to write the founder's raw sentence into both --
     asserting a price and a revenue figure they may never have given. An empty
     set routes it through the extractor path, which is exactly today's
     behaviour. */
  factKeys: Object.freeze([]),
  question: 'What is your current offer price, and how much revenue have you actually earned?',
});

/**
 * Every question carries its stable id. The ids below have always existed in
 * QUESTION_ORDER -- this function used to discard them and return bare text,
 * and api/_lib/founder-intake-shared.mjs then recovered each id by looking the
 * exact English string back up in a duplicate table (QUESTION_TEXT_TO_ID). Any
 * reworded question silently became `id: null`, which meant no targeted
 * fallback and an answer that could vanish. The id now travels with the
 * question it belongs to.
 *
 * @param {Record<string, {value: unknown}>} perKey rebuildStateFromFacts(...).perKey
 * @param {{factKey: string}[]} [conflicts] rebuildStateFromFacts(...).conflicts
 * @param {number} [limit] How many to return. Defaults to MAX_CLARIFICATION_QUESTIONS so
 *   every existing caller is unchanged. Founder Chat passes Infinity: the Need Ledger
 *   ranks, and a bank-ordered cap applied BEFORE ranking is a second question-order
 *   algorithm competing with it -- the ledger could only ever choose among the first
 *   three unanswered bank questions, in bank order.
 * @returns {{id: string, factKeys: string[], question: string}[]} At most MAX_CLARIFICATION_QUESTIONS, most important first, never repeating known information.
 */
export function computeClarificationQuestions(perKey, conflicts = [], limit = MAX_CLARIFICATION_QUESTIONS) {
  const questions = [];
  if (conflicts.some((conflict) => conflict?.factKey === 'revenueState')) {
    questions.push({ id: REVENUE_CONFLICT_QUESTION.id, factKeys: REVENUE_CONFLICT_QUESTION.factKeys, question: REVENUE_CONFLICT_QUESTION.question });
  }
  for (const item of QUESTION_ORDER) {
    if (questions.length >= limit) break;
    if (item.knownWhen(perKey)) continue;
    questions.push({ id: item.id, factKeys: item.factKeys, question: item.question });
  }
  return questions;
}

/* Questions driven by a ledger CONFLICT rather than by a knownWhen gap. They
   are exempt from the QUESTION_FALLBACK rule (every bank question must have a
   fallback writing the exact fact its own knownWhen reads, or it re-asks
   forever), because they have no knownWhen to satisfy -- what retires them is
   the conflict being resolved.
   The exemption is DECLARED here rather than inferred from a missing entry, so
   a genuinely forgotten fallback still fails
   scripts/qa-founder-clarification-fallback-coverage.mjs instead of looking
   like a deliberate omission.
   KNOWN LIMITATION, recorded rather than papered over: answering
   pricing_revenue_conflict records offerPricing/revenue through the extractor,
   but nothing retires the ambiguous legacy `revenueState` row, so the conflict
   -- and therefore the question -- persists. That predates this change (the
   question previously reached the client with `id: null`, so its answer was
   discarded before it was even sent). Resolving it means an audited
   deactivation of the legacy fact, which is a ledger change, not a question
   change. */
export const CONFLICT_DRIVEN_QUESTION_IDS = Object.freeze([REVENUE_CONFLICT_QUESTION.id]);

/** The complete id vocabulary this module can emit, for validators that must
 *  prove no question can reach a caller without a known identity. */
export const INTAKE_QUESTION_IDS = Object.freeze([
  ...CONFLICT_DRIVEN_QUESTION_IDS,
  ...QUESTION_ORDER.map((item) => item.id),
]);
