/* ════════════════════════════════════════════════════════════════════════
   THE HALF OF THE SEMANTIC READ THAT IS A MODEL.

   One statement, one offer: what does it mean, of the things lexical rules
   cannot safely read themselves? The contract lives in `offer-relevance.js`
   and nothing decided here survives without passing it -- this file only
   asks.

   ENUM-PINNED, because that is what stops invention rather than the prompt
   asking nicely. Each item's concept is a closed set in the schema itself,
   its quote must be lifted verbatim, and strict mode refuses anything else.
   A model that wants to say something interesting has nowhere to put it.

   IT IS NEVER TOLD WHAT IT IS FOR. No move, no ladder, no score, no hidden
   scenario. It cannot know that `pain_we_address` is the one concept that
   changes the founder's advice, which is the only defence against a model
   that has learned to be helpful.

   WP7: UP TO TWO ITEMS, NOT ONE RELATION. One statement can carry both an
   interest and a constraint ("we like it, but there's no budget until next
   quarter") -- collapsing that into a single field would force the model
   to throw one fact away before it ever reaches admission. The four new
   concepts sit alongside the original seven in one enum; the array is what
   changed, not the vocabulary's home. */
import { RELATION } from './offer-relevance.js';

export const OFFER_RELEVANCE_MODEL_VERSION = 'practice_offer_relevance_model_v2';

const RELATIONS = Object.keys(RELATION).map((k) => RELATION[k]);

export const RELEVANCE_SCHEMA = Object.freeze({
  name: 'practice_offer_relevance',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        maxItems: 2,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['concept', 'quote', 'confidence'],
          properties: {
            concept: { type: 'string', enum: RELATIONS },
            /* Verbatim, or null. The contract discards an acted-on concept
               whose quote is not literally present in what they said, so a
               paraphrase costs the model the verdict rather than earning it
               a nicer one. */
            quote: { type: ['string', 'null'] },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
        },
      },
    },
  },
});

/* Deliberately short. It describes the job and the offer and stops; there
   is no worked example, because an example is the fastest way to teach a
   model which answer we are hoping for. */
export function relevancePrompt(input) {
  const objections = (input.knownObjections || []).length
    ? `\nObjections this founder already expects: ${input.knownObjections.join('; ')}`
    : '';
  const price = input.offerPricing ? `\nPricing: ${input.offerPricing}` : '';
  const kind = input.businessType ? `\nThe prospect runs: ${input.businessType}` : '';
  return [
    'A salesperson is on a cold call. Decide what the prospect\'s last statement',
    'means, relative to what this salesperson sells.',
    '',
    `What they sell: ${input.offerWhat}${price}${kind}${objections}`,
    '',
    `The prospect just said: "${input.said}"`,
    '',
    'List 0-2 items. Each item is one of these concepts, with the exact words',
    'that support it:',
    `- ${RELATION.PAIN_WE_ADDRESS}: they named a problem this offer would help with,`,
    '  whether or not they realise it. Judge the underlying problem, not the words:',
    '  a problem can be named in terms that share no vocabulary with the offer.',
    `- ${RELATION.PAIN_WE_DO_NOT_ADDRESS}: a real problem, but not one this offer touches.`,
    `- ${RELATION.ALTERNATIVE_IN_PLACE}: they already handle it some other way.`,
    `- ${RELATION.NEED_DISMISSED}: they say the problem does not exist for them.`,
    `- ${RELATION.CONSTRAINT}: money, procurement or timing stands in the way of buying.`,
    '  NEVER use this for who has the authority to decide, who they would need to ask,',
    '  or an offer to transfer/route the call -- that is a different question this',
    '  file does not ask you, and an answer here about it is discarded either way.',
    `- ${RELATION.OBJECTION_OR_CONCERN}: a doubt or hesitation that is not a flat no.`,
    `- ${RELATION.CONDITIONAL_INTEREST}: interest that depends on a stated condition`,
    '  ("if the numbers work out", "as long as it does not take much time").',
    `- ${RELATION.INTEREST_CONFIRMED}: clear interest with no condition attached.`,
    `- ${RELATION.EXPLICIT_REJECTION}: a clear, unconditional no.`,
    `- ${RELATION.UNRELATED}: logistics, courtesy or small talk.`,
    `- ${RELATION.UNCLEAR}: you cannot tell.`,
    '',
    'For each item, quote the exact words that support it, copied verbatim from',
    'their statement -- or null if you cannot point to specific words. If sarcasm,',
    'a quotation of someone else\'s words, or a reported statement changes what the',
    'sentence actually means, judge the real meaning, not the surface words.',
    'Answer only in the schema.',
  ].join('\n');
}

/* The call itself is injected, so this module stays pure and testable and
   the provider lives where every other provider in Practice lives. */
export async function readOfferRelevance({ input = null, call = null } = {}) {
  if (!input || typeof call !== 'function') return null;
  try {
    return await call({ prompt: relevancePrompt(input), schema: RELEVANCE_SCHEMA });
  } catch (e) {
    /* FAILS TO NOTHING, NEVER TO A GUESS. A relevance read that could not
       run leaves the decision exactly as it was before this layer existed. */
    return null;
  }
}
