/* ════════════════════════════════════════════════════════════════════════
   THE EDITOR — the founder's language, upgraded

   Terra writes candidates. This layer picks the best two and makes them
   sound like the person who will have to say them out loud. It is a MOUTH,
   not a brain: it may shorten, rewrite, combine or select, and it may not
   decide what the founder should be doing.

   That distinction is not a hope, it is enforced downstream. Everything
   this returns goes through the same adherence and distinctness gates the
   candidates went through, so an editor line that quietly executes a better
   sales move than the locked one is discarded no matter how well it reads.
   Measured in testing, that is the failure this stage actually has: asked
   to establish how cover works today, it reached for the problem instead,
   because searching for pain is the more natural sentence.

   The context it receives is the same packet the composer used. It is given
   NOTHING about score, fault severity or authority -- an editor that knows
   how badly the founder is doing starts writing to the mark.
   ══════════════════════════════════════════════════════════════════════ */

export const EDITOR_VERSION = 'practice_wording_editor_v1';

export const EDITOR_BATCH_SCHEMA = Object.freeze({
  name: 'practice_wording_edit',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['cards'],
    properties: {
      cards: {
        type: 'array', minItems: 1, maxItems: 3,
        items: {
          type: 'object', additionalProperties: false,
          required: ['moment', 'lines'],
          properties: {
            moment: { type: 'string' },
            /* Exactly two. Asking for "the best two" and accepting three is
               how a selection step turns back into a generation step. */
            lines: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } },
          },
        },
      },
    },
  },
  strict: true,
});

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/* The editor sees the moment, the locked move, and the candidates. It does
   not see the fault name or anything that reads as a verdict. */
export function editorPrompt(inputs = [], candidates = new Map()) {
  const blocks = inputs.map((i) => {
    const lines = candidates.get(i.moment) || [];
    return [
      `MOMENT ${i.moment}`,
      `THEY ARE: ${clean(i.prospect || '')}`,
      `THE FOUNDER SAID: "${clean(i.founderSaid)}"`,
      i.prospectLines && i.prospectLines.length
        ? `THEY HAD JUST SAID: ${i.prospectLines.map((p) => `"${clean(p)}"`).join(' ')}` : null,
      `THE MOVE HE MUST MAKE: ${clean(i.move && i.move.goal)}`,
      i.openUnknown ? `STILL UNKNOWN: ${clean(i.openUnknown)}` : null,
      i.activeObjection ? `OBJECTION STANDING: "${clean(i.activeObjection)}"` : null,
      i.style ? `HOW HE TALKS: ${clean(i.style)}` : null,
      'CANDIDATE LINES:',
      ...lines.map((l, n) => `  ${n + 1}. "${clean(l)}"`),
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return [
    'You are editing what a salesperson will say out loud on a live call.',
    '',
    'For each moment, return the BEST TWO lines.',
    'You may select a candidate unchanged, shorten it, rewrite it, or combine parts.',
    '',
    'The objective for each moment is fixed. You are choosing HOW he says it,',
    'never WHAT he does. A line that makes a different sales move is wrong,',
    'however well it reads.',
    '',
    'Write the way this founder talks. Spoken English, contractions, short.',
    'No corporate phrasing. No narrating your reasoning inside the sentence.',
    'Never invent a fact about their business that is not above.',
    'The two lines must be genuinely different approaches, not one idea reworded.',
    '',
    blocks,
  ].join('\n');
}

/* Nothing here trusts the model's own count or ordering. */
export function readEditorCards(parsed) {
  const out = new Map();
  for (const card of (parsed && parsed.cards) || []) {
    const moment = clean(card && card.moment);
    if (!moment) continue;
    const lines = ((card && card.lines) || []).map(clean).filter(Boolean);
    if (lines.length) out.set(moment, lines);
  }
  return out;
}
