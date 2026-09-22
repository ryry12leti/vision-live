/**
 * Founder Decision Service — skill-level execution adaptation.
 *
 * Adapts HOW MUCH support a mission gives, never WHAT quality bar it holds.
 * The Professional Standard's principles are passed through completely
 * unchanged at every level -- "simplify execution, not excellence." Only
 * step guidance, required-evidence phrasing, and learning support vary.
 */

const STEP_GUIDANCE_BY_ACTION_TYPE = Object.freeze({
  confirm_offer_and_segment: 'Write down the exact price and who it is for in one sentence each -- do not proceed until both are concrete.',
  present_offer: 'Say the price out loud to yourself first so it does not feel like the hard part when you say it to them.',
  capture_offer_response: 'Write down their exact words, not your summary of what they meant.',
  record_offer_test_result: 'One line: accepted, declined, or the exact objection they raised.',
  conduct_structured_interview: 'Ask "tell me about the last time this was a problem for you" instead of "would you use this" -- specific past examples beat hypothetical opinions.',
  synthesize_interview_findings: 'List only things two or more people said, not a single interesting comment.',
  contact_and_record_outcome: 'Have the exact opening line ready before you call -- do not improvise it live.',
  record_batch_result: 'One line per contact: booked, declined, or no response -- no summarising multiple into one.',
  create_requested_followup_asset: 'Make it about THEM specifically -- their name, their exact request, not a generic template with their name pasted in.',
  send_requested_followup: 'Include one clear next step in the message (e.g. "does Thursday work for a 15-minute call?") -- do not just attach the asset and wait.',
  identify_product_slice: 'Pick the smallest slice that is still genuinely usable on its own, not the easiest to build.',
  complete_delivery_implementation: 'Stop as soon as every acceptance criterion is met -- resist adding anything not on the list.',
  verify_acceptance_criteria: 'Check each criterion one at a time and mark it explicitly -- do not eyeball the whole list at once.',
  record_delivery_result: 'State exactly which criteria were verified and how.',
});

const DEFAULT_STEP_GUIDANCE = 'Do this one part fully before moving to the next -- do not batch multiple steps together the first time.';

const BEGINNER_LEARNING_BY_FUNCTION = Object.freeze({
  sales: 'Aim for one honest "no" or "yes" rather than a vague maybe -- a clear response is real progress either way, and a maybe usually means the offer was not concrete enough.',
  validation: 'Ask about problems they have actually had, not opinions on your idea -- people are far more honest about a real past frustration than a hypothetical future purchase.',
  delivery: 'Ship the smallest version that is genuinely usable, then improve it with real feedback -- do not polish before anyone has used it.',
  retention: 'Look at when people actually stop, not just whether they eventually churn -- the exact drop-off point tells you what to fix.',
  operations: 'Fix the process at the exact step it breaks -- do not redesign the whole workflow around one failure point.',
  strategy: 'Write down what evidence would change your mind before you decide -- it keeps the choice about the business, not a feeling.',
});

/**
 * @param {object[]} steps From candidate-brief.js/mission-compiler.js.
 * @param {'beginner'|'developing'|'advanced'} level
 * @returns {object[]}
 */
function adaptSteps(steps, level) {
  if (level === 'beginner') {
    return steps.map((step) => ({
      ...step,
      guidance: STEP_GUIDANCE_BY_ACTION_TYPE[step.actionType] || DEFAULT_STEP_GUIDANCE,
    }));
  }
  if (level === 'advanced' && steps.length > 2) {
    // Collapse every step but the last (which is always the "record the
    // result" step -- see mission-compiler.js) into one combined directive.
    // Fewer, higher-leverage checkpoints; nothing about WHAT must be done
    // is removed, only how many separate prompts it is broken into.
    const [last, ...rest] = [...steps].reverse();
    const combinedLabel = rest.reverse().map((step) => step.label).join('; then ');
    return [
      { order: 1, label: combinedLabel, actionType: 'combined_execution', referenceId: steps[0].referenceId },
      { ...last, order: 2 },
    ];
  }
  return steps;
}

/**
 * @param {string[]} requiredEvidence
 * @param {'beginner'|'developing'|'advanced'} level
 * @returns {string[]}
 */
function adaptRequiredEvidence(requiredEvidence, level) {
  if (level === 'beginner') {
    /* Said ONCE, not per item. Appending it to every entry cost ~60 characters
       each, and proof_must_show joins the list into a 320-BYTE column: with
       five requirements the repetition consumed the whole budget and the real
       requirements were truncated mid-word, so the founder read the same
       parenthetical three times and never saw the last two things they had to
       show. The instruction is the same; it just no longer crowds out the
       content it applies to. */
    return [...requiredEvidence, 'be literal and explicit in each of these -- do not summarise or paraphrase'];
  }
  return requiredEvidence;
}

/**
 * @param {string|null} learningSupport The engine's own learning support (already null unless genuinely useful).
 * @param {'beginner'|'developing'|'advanced'} level
 * @param {string} businessFunction
 * @returns {string|null}
 */
function adaptLearningSupport(learningSupport, level, businessFunction) {
  if (level === 'advanced') return null; // no forced basic lesson for an advanced founder
  if (learningSupport) return learningSupport; // the engine already has something genuinely useful to say
  if (level === 'beginner') return BEGINNER_LEARNING_BY_FUNCTION[businessFunction] || null;
  return null;
}

/* "Professional standard" means: how would someone who does this discipline
   for a living execute THIS task? Not a generic exhortation, and not a famous
   name borrowed from an unrelated field -- a founder building a prospect list
   was being shown a deep-work author, because the picker keyed off a goal
   category founders never set.
   Each entry names a practitioner genuinely associated with that discipline
   and states the standard their published method actually holds -- nothing is
   attributed to them that they are not known for, and no quote is invented. */
const FUNCTION_STANDARD = Object.freeze({
  validation: ['Rob Fitzpatrick', 'The Mom Test standard: ask what someone has already done, never what they would do. An opinion is not evidence; a past action is.'],
  sales: ['Aaron Ross', 'The Predictable Revenue standard: narrow who you approach before you approach anyone. Research earns the reply; volume without it just burns the list.'],
  delivery: ['Jason Fried', 'The Basecamp standard: ship the smallest version that is genuinely usable, and cut scope rather than miss the finish.'],
  retention: ['Des Traynor', 'The Intercom standard: go to the people who actually left and use their words. Churn is explained by customers, not by dashboards.'],
  operations: ['Eliyahu Goldratt', 'The Theory of Constraints standard: fix the one step that limits everything else, and leave the rest alone until it does.'],
  strategy: ['Richard Rumelt', 'The good-strategy standard: name the real obstacle plainly, then choose one coherent action against it. A list of goals is not a strategy.'],
});

/**
 * @param {'beginner'|'developing'|'advanced'} level
 * @param {string} businessFunction One of BUSINESS_FUNCTIONS.
 * @returns {string|null}
 */
function standardGuidanceFor(level, businessFunction) {
  const entry = FUNCTION_STANDARD[businessFunction];
  /* No entry means no claim: fall back to the plain guidance rather than
     attributing this task to someone who has nothing to do with it. */
  if (!entry) {
    if (level === 'beginner') return 'Every principle here matters -- do not skip one because it takes longer the first time.';
    if (level === 'developing') return 'Check your work against each principle before marking this complete.';
    return null;
  }
  const [name, standard] = entry;
  const closing = level === 'beginner'
    ? ' Hold every principle below, even where it is slower the first time.'
    : level === 'developing'
      ? ' Check your work against each principle below before marking this complete.'
      : '';
  return `How ${name} would hold this task. ${standard}${closing}`;
}

/**
 * @param {object} params
 * @param {'beginner'|'developing'|'advanced'} params.level
 * @param {string} params.businessFunction
 * @param {object[]} params.steps
 * @param {string[]} params.professionalStandard Passed through unchanged -- never lowered.
 * @param {string|null} params.learningSupport
 * @param {string[]} params.requiredEvidence
 * @returns {{steps: object[], professionalStandard: string[], standardGuidance: string|null, learningSupport: string|null, requiredEvidence: string[], guidanceLevel: string}}
 */
export function adaptExecutionForSkillLevel({
  level, businessFunction, steps, professionalStandard, learningSupport, requiredEvidence,
}) {
  return {
    steps: adaptSteps(steps, level),
    professionalStandard, // identical principles at every level -- simplify execution, not excellence
    standardGuidance: standardGuidanceFor(level, businessFunction),
    learningSupport: adaptLearningSupport(learningSupport, level, businessFunction),
    requiredEvidence: adaptRequiredEvidence(requiredEvidence, level),
    guidanceLevel: level,
  };
}
