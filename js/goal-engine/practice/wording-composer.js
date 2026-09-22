/* ════════════════════════════════════════════════════════════════════════
   THE WORDING COMPOSER — the only model in the coaching path, and the
   smallest possible job for it.

   Best Move is already locked before this runs. The model is asked one
   question — "say THAT, three ways, to THIS person" — and every answer it
   gives is checked against the state before a founder sees it. It cannot
   change the diagnosis, the move, the evidence, the score, the authority or
   the call state, because it is never given any of them to change and
   because nothing downstream reads its output for anything but wording.

   IF IT FAILS, THE DETERMINISTIC LINES STAND. A rejected batch is not
   retried and not partially salvaged into a three-slot quota: say-it.js
   already produces honest, state-filled alternatives, and shipping worse
   wording than that to fill a third slot would be a straight downgrade.

   WHAT IT IS ALLOWED TO SEE is enumerated below and enforced by
   composerInput(), so a future caller cannot widen it by accident.
   ══════════════════════════════════════════════════════════════════════ */

export const COMPOSER_VERSION = 'practice_wording_composer_v1';

/* Everything the model may receive. Anything not on this list is a leak. */
export const COMPOSER_INPUT_ALLOWED = Object.freeze([
  'founderSaid', 'prospectLines', 'bestMove', 'because', 'disclosedFacts',
  'openUnknown', 'activeObjection', 'refusalState', 'style',
]);
/* And what it must never receive, asserted in the suite. */
export const COMPOSER_INPUT_FORBIDDEN = Object.freeze([
  'score', 'overall', 'rubric', 'weights', 'verdict', 'finding', 'findingId',
  'eventType', 'authority', 'diagnosis', 'whatWasWrong', 'callState',
  'qualification', 'pitchPermission', 'sessionId', 'userId',
]);

/* ── ONE REQUEST FOR THE WHOLE REVIEW ─────────────────────────────────
   A call has at most three cards and they are written for the same
   conversation. Asking three times cost three round trips and three
   prompts carrying the same transcript, for no benefit — and it made the
   model unable to see that two cards were about the same move, which is
   exactly the repetition a founder notices. One request, one batch, and
   the cards can be told apart by their moment. */
export const COMPOSER_BATCH_SCHEMA = Object.freeze({
  name: 'practice_wording_batch',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['cards'],
    properties: {
      cards: {
        type: 'array', minItems: 1, maxItems: 3,
        items: {
          type: 'object', additionalProperties: false,
          required: ['moment', 'alternatives'],
          properties: {
            moment: { type: 'string' },
            alternatives: {
              type: 'array', minItems: 2, maxItems: 3,
              items: {
                type: 'object', additionalProperties: false,
                required: ['say', 'approach'],
                properties: {
                  say: { type: 'string' },
                  approach: { type: 'string',
                    enum: ['ask_it_straight', 'admit_the_gap', 'use_what_they_said', 'make_it_easy_to_answer'] },
                },
              },
            },
          },
        },
      },
    },
  },
});

export const COMPOSER_SCHEMA = Object.freeze({
  name: 'practice_wording_alternatives',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['alternatives'],
    properties: {
      alternatives: {
        type: 'array', minItems: 2, maxItems: 3,
        items: {
          type: 'object', additionalProperties: false,
          required: ['say', 'approach'],
          properties: {
            say: { type: 'string' },
            /* Named so two lines that are the same idea twice are visible
               as such rather than counted as two alternatives. */
            approach: { type: 'string',
              enum: ['ask_it_straight', 'admit_the_gap', 'use_what_they_said', 'make_it_easy_to_answer'] },
          },
        },
      },
    },
  },
});

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const words = (v) => clean(v).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean);

/* ── WHAT THE MODEL IS GIVEN ──────────────────────────────────────────
   Built here so the shape is one thing, checkable in one place. */
export function composerInput({ founderSaid = '', prospectLines = [], move = null,
  disclosedFacts = [], openUnknown = null, activeObjection = null,
  refusalState = 'none', style = null } = {}) {
  if (!move || !move.moveId) return null;
  return {
    founderSaid: clean(founderSaid),
    prospectLines: (prospectLines || []).map(clean).filter(Boolean).slice(-3),
    bestMove: { id: move.moveId, goal: move.goal },
    because: (move.because || []).map((b) => clean(b.fact)).filter(Boolean),
    disclosedFacts: (disclosedFacts || []).map(clean).filter(Boolean).slice(-4),
    openUnknown: openUnknown ? clean(openUnknown) : null,
    activeObjection: activeObjection ? clean(activeObjection) : null,
    refusalState: clean(refusalState) || 'none',
    style: style || null,
  };
}

/* Terms this call actually contains, so a line can be checked for being
   about THIS conversation rather than about selling in general. */
export function callVocabulary(inputs) {
  const out = new Set();
  for (const i of inputs) {
    [i.founderSaid, i.openUnknown, i.activeObjection,
      ...(i.prospectLines || []), ...(i.disclosedFacts || [])]
      .filter(Boolean).forEach((line) => words(line)
        .filter((w) => w.length > 4).forEach((w) => out.add(w)));
  }
  return out;
}

export function composerBatchPrompt(inputs) {
  const shared = inputs[0] || {};
  return [
    'You write what a founder could have said on a sales call. Each moment below',
    'has a strategic move that has ALREADY BEEN DECIDED. You do not decide it,',
    'question it, or do anything else instead of it.',
    '',
    shared.prospectLines && shared.prospectLines.length
      ? `WHAT THE PROSPECT SAID ON THIS CALL:\n${shared.prospectLines.map((l) => `  - "${l}"`).join('\n')}` : '',
    shared.disclosedFacts && shared.disclosedFacts.length
      ? `WHAT THEY HAVE ESTABLISHED:\n${shared.disclosedFacts.map((f) => `  - ${f}`).join('\n')}` : '',
    shared.openUnknown ? `STILL UNKNOWN (never state this as fact): ${shared.openUnknown}` : '',
    shared.activeObjection ? `THEIR OPEN OBJECTION: "${shared.activeObjection}"` : '',
    shared.refusalState && shared.refusalState !== 'none' ? `THEY HAVE REFUSED: ${shared.refusalState}` : '',
    shared.style ? `THE FOUNDER'S OWN STYLE: ${JSON.stringify(shared.style)}` : '',
    '',
    'THE MOMENTS:',
    ...inputs.map((i) => [
      `  moment "${i.moment}"`,
      `    THE MOVE: ${i.bestMove.goal}`,
      i.because.length ? `    WHY: ${i.because.join('; ')}` : '',
      `    THE FOUNDER SAID (do not reuse it): "${i.founderSaid}"`,
    ].filter(Boolean).join('\n')),
    '',
    'RULES:',
    '1. Every line must execute THAT moment\'s move. Not a different move.',
    '2. Two or three lines per moment, each a genuinely different approach.',
    '3. Every line must refer to something from THIS call — what they said, the',
    '   work they described, the thing still unknown. No line that would fit any',
    '   sales call.',
    '4. State no fact they have not said. Invent no pain, urgency or intent.',
    '5. Never reuse the founder\'s sentence or any large part of it.',
    '6. If two moments share the same move, do not repeat yourself: approach it',
    '   differently for each.',
    '7. Sound like a person speaking. One or two sentences each.',
    '8. Never say what the prospect thinks or feels.',
  ].filter(Boolean).join('\n');
}

export function composerPrompt(input) {
  return [
    'You write what a founder could have said on a sales call. You are given a',
    'strategic move that has ALREADY BEEN DECIDED. You do not decide it, question',
    'it, or do anything else instead of it.',
    '',
    `THE MOVE: ${input.bestMove.goal}`,
    input.because.length ? `WHY IT IS THE MOVE: ${input.because.join('; ')}` : '',
    '',
    `WHAT THE FOUNDER ACTUALLY SAID (do not reuse it): "${input.founderSaid}"`,
    input.prospectLines.length
      ? `WHAT THE PROSPECT SAID:\n${input.prospectLines.map((l) => `  - "${l}"`).join('\n')}` : '',
    input.disclosedFacts.length
      ? `WHAT THEY HAVE ESTABLISHED:\n${input.disclosedFacts.map((f) => `  - ${f}`).join('\n')}` : '',
    input.openUnknown ? `STILL UNKNOWN (never state this as fact): ${input.openUnknown}` : '',
    input.activeObjection ? `THEIR OPEN OBJECTION: "${input.activeObjection}"` : '',
    input.refusalState !== 'none' ? `THEY HAVE REFUSED: ${input.refusalState}` : '',
    input.style ? `THE FOUNDER'S OWN STYLE: ${JSON.stringify(input.style)}` : '',
    '',
    'RULES:',
    '1. Every line must execute THE MOVE above. Not a different move.',
    '2. Two or three lines, each a genuinely different approach — not rewordings.',
    '3. State no fact they have not said. Invent no pain, urgency or intent.',
    '4. Do not reuse the founder\'s sentence or any large part of it.',
    '5. Sound like a person speaking, not a script. One or two sentences each.',
    '6. Never say what the prospect thinks or feels.',
  ].filter(Boolean).join('\n');
}

/* ── THE VALIDATOR ────────────────────────────────────────────────────
   Every rejection reason is a rule the founder would have been misled by.
   Nothing here trusts the model's own `approach` label to be true. */
/* `costs?` on its own convicted "Is it something that costs you, or is it
   fine as it is?" — a discovery question, and one of the better ones. A
   price is a number or a currency, not the verb. */
const SELLING = /\b(?:we (?:offer|provide|help|work with|deliver|run|handle)|our (?:service|package|programme|program)|costs?\s+(?:about|around|roughly|from|£|\$|\d)|per month|pricing|sign up|get started)\b/i;
const CLOSING = /\b(book (a|an|some)|next week|calendar|fifteen minutes|15 minutes|shall we|meeting|catch up|worth a (look|chat))\b/i;
const MIND_READING = /\b(you (feel|think|believe|want|need)|you are (frustrated|worried|struggling|keen|unhappy)|i know you)\b/i;
const FILLER = /\b(circle back|touch base|synerg|leverage|reach out|value.add|game.chang|low.hanging|bring in more of that|new enquiries)\b/i;
/* Moves that are DISCOVERY: selling or closing inside them is a different move. */
const DISCOVERY_MOVES = new Set(['establish_situation', 'find_the_problem', 'establish_intent',
  'qualify_timing', 'verify_the_assumption', 'build_on_their_answer', 'explore_the_objection']);
const NO_CONTINUATION = new Set(['end_professionally']);

export function validateAlternatives({ alternatives = [], move = null, input = null,
  vocabulary = null } = {}) {
  const kept = []; const rejected = [];
  const drop = (say, reason) => rejected.push({ say: clean(say), reason });
  const saidWords = new Set(words(input && input.founderSaid));
  const unknownWords = new Set(words(input && input.openUnknown));
  const disclosed = words((input && input.disclosedFacts ? input.disclosedFacts.join(' ') : ''));

  for (const a of alternatives) {
    const say = clean(a && a.say);
    if (!say || say.length < 12) { drop(say, 'empty_or_too_short'); continue; }
    if (say.length > 240) { drop(say, 'too_long_to_say_aloud'); continue; }

    /* Their own failed sentence handed back. Checked first: it is a fact
       about the input rather than a judgement about strategy, and it is the
       more useful thing to tell a founder. */
    const mine0 = words(say);
    if (mine0.length && mine0.filter((w) => w.length > 3 && saidWords.has(w)).length
      / Math.max(1, mine0.filter((w) => w.length > 3).length) >= 0.6) {
      drop(say, 'repeats_the_founder_sentence'); continue;
    }

    /* A hard no is a hard no, whatever the move looks like. */
    if (input && input.refusalState === 'do_not_contact' && !NO_CONTINUATION.has(move.moveId)) {
      drop(say, 'continues_after_do_not_contact'); continue;
    }
    if (input && (input.refusalState === 'hard_no' || input.refusalState === 'do_not_contact')
      && (SELLING.test(say) || CLOSING.test(say))) {
      drop(say, 'sells_or_closes_after_a_no'); continue;
    }
    /* Executing a DIFFERENT strategic move. */
    if (DISCOVERY_MOVES.has(move.moveId) && SELLING.test(say)) { drop(say, 'pitches_when_the_move_is_discovery'); continue; }
    if (DISCOVERY_MOVES.has(move.moveId) && CLOSING.test(say)) { drop(say, 'closes_when_the_move_is_discovery'); continue; }
    if (move.moveId === 'earn_permission' && CLOSING.test(say)) { drop(say, 'closes_when_the_move_is_to_earn_permission'); continue; }

    /* Facts nobody established, and feelings nobody reported. */
    if (MIND_READING.test(say)) { drop(say, 'asserts_what_the_prospect_thinks_or_feels'); continue; }
    if (FILLER.test(say)) { drop(say, 'generic_template_language'); continue; }

    /* An unresolved unknown stated as fact. A QUESTION about it is the
       point of the move; a declarative about it is the fault repeated. */
    if (unknownWords.size >= 2 && !/\?\s*$/.test(say)) {
      const overlap = words(say).filter((w) => unknownWords.has(w) && !disclosed.includes(w)).length;
      if (overlap >= 3) { drop(say, 'states_an_unresolved_unknown_as_fact'); continue; }
    }
    /* ── ABOUT THIS CALL, OR ABOUT SELLING IN GENERAL ────────────────
       "When that does not go to plan, what actually happens?" executes the
       move and would fit any call ever made. On the measured run one line
       in seven named nothing from the conversation. A line has to carry at
       least one word this call actually used. */
    if (vocabulary && vocabulary.size >= 4) {
      const grounded = words(say).some((w) => w.length > 4 && vocabulary.has(w));
      if (!grounded) { drop(say, 'names_nothing_from_this_call'); continue; }
    }
    if (kept.some((k) => k.toLowerCase() === say.toLowerCase())) { drop(say, 'duplicate'); continue; }
    /* Near-duplicates are one idea, not two. */
    if (kept.some((k) => {
      const a2 = new Set(words(k).filter((w) => w.length > 3));
      const b2 = words(say).filter((w) => w.length > 3);
      return b2.length && b2.filter((w) => a2.has(w)).length / b2.length >= 0.75;
    })) { drop(say, 'near_duplicate_of_another_alternative'); continue; }

    kept.push(say);
  }
  return { kept: kept.slice(0, 3), rejected };
}
