/* ════════════════════════════════════════════════════════════════════════
   MODE: practice_turn — the deterministic practice partner.

   MODE-SPECIFIC LOGIC LIVES HERE, not in runtime-contract.js. That module is
   the universal envelope — validation, bounds, context shaping — and the
   moment one mode's behaviour sits inside it, the next mode has to be added
   by editing shared code. A test in qa-live-intelligence-practice-model
   asserts the separation rather than trusting it.
   ══════════════════════════════════════════════════════════════════════ */

/* ── the deterministic practice partner ───────────────────────────────
   HONEST ABOUT WHAT THIS IS. This is the floor, not the product: a scripted
   prospect that stays in character, never invents facts about its own
   business, and raises the objections the Workspace already predicted. It is
   here so the whole runtime — auth, workspace, persistence, reload — can be
   built and proven end to end at $0 before a single model call is spent.

   It answers as the PROSPECT, never as a coach, and it never confirms
   anything listed as unknown. */
export function practiceTurnReply({ context, input, turnIndex = 0 } = {}) {
  const c = context || {};
  const name = (c.prospect && c.prospect.name) || 'the prospect';
  const said = String(input || '').toLowerCase();

  /* Did the founder ASSERT something VISION recorded as unknown? */
  const overreach = assertedUnknown(c.unknowns || [], input);
  if (overreach) {
    return {
      reply: `Hang on — how would you know that? ${firstSentence(overreach)} is not something we have discussed.`,
      basis: 'unknown_asserted', objectionUsed: null,
      /* WHICH unknown, carried out. The runtime proposes a note about this
         specific slip, and a proposal that could not name it would be a
         vague accusation rather than something a founder can act on. */
      unknownAsserted: overreach,
    };
  }

  /* Otherwise walk the predicted objections in order: the founder rehearses
     against what the Workspace said they would actually hear. */
  const objection = (c.objections || [])[turnIndex % Math.max(1, (c.objections || []).length)];
  if (objection && (c.objections || []).length > 0) {
    return { reply: objection.objection, basis: 'predicted_objection', objectionUsed: objection.objection };
  }

  return {
    reply: `This is ${name}. What is it about?`,
    basis: 'neutral_open', objectionUsed: null,
  };
}

/* ── ASSERTING AN UNKNOWN ─────────────────────────────────────────────
   The first version took the first THREE WORDS of a recorded unknown and
   asked whether the founder's sentence contained that exact substring. So
   "It is not yet known whether the clinic has capacity" only ever matched
   someone who said "whether the clinic" — and "I know you have capacity"
   sailed through. It also matched QUESTIONS, which is backwards: asking
   about an unknown is precisely what the founder should be doing.

   This compares CONTENT TERMS instead, tolerates word order and small
   inflections, and only ever looks at sentences that are not questions.

   HONEST LIMIT: this catches the founder reusing the unknown's own words,
   not arbitrary paraphrase. "I know they're desperate for work" will not
   match an unknown about "seeking more new patients", because no
   deterministic matcher gets there without a model. */

const STOPWORDS = new Set([
  'it', 'is', 'not', 'yet', 'known', 'whether', 'which', 'who', 'what', 'the',
  'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'has', 'have', 'had', 'be', 'been', 'are', 'was', 'were', 'that', 'this',
  'their', 'they', 'them', 'you', 'your', 'we', 'our', 'us', 'i', 'me', 'my',
  'any', 'more', 'currently', 'also', 'still', 'there', 'here', 'about',
  'no', 'nothing', 'so', 'as', 'if', 'but', 'from', 'up', 'out', 'now',
]);

/* Five characters is enough to make "patient", "patients" and "patient's"
   the same term without collapsing genuinely different words. */
const stem = (word) => word.slice(0, 5);

export function unknownTerms(unknown) {
  return [...new Set(String(unknown || '')
    .toLowerCase()
    .replace(/^it is not yet known (whether|which|who|what|if)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map(stem))];
}

/** Sentences that are not questions — the only place an assertion can live. */
function assertedSentences(input) {
  return String(input || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.endsWith('?')
      && !/^(do|does|did|is|are|was|were|can|could|would|will|should|have|has|how|what|when|where|why|who|which)\b/i.test(part));
}

/* IS THIS SENTENCE EVEN ABOUT THE PROSPECT?

   Found live: "We help dental clinics get more patients" shares two content
   terms with an unknown about the clinic's patient capacity, and the term
   matcher alone fired on it — but the founder was describing their OWN offer,
   which is the single most common thing they will say on a practice call.
   Correcting them for it is worse than staying quiet.

   An assertion about the prospect has to actually refer to the prospect:
   second/third person, or "the/this <thing the unknown is about>". Generic
   plurals ("dental clinics") are the offer, not this business. */
const PRONOUN_REF = /\b(you|your|yours|youre|they|their|theirs|them|theyre)\b/i;
function refersToProspect(sentence, terms) {
  if (PRONOUN_REF.test(sentence)) return true;
  const definite = sentence.toLowerCase().match(/\b(?:the|this|that)\s+([a-z]+)/g) || [];
  return definite.some((m) => terms.includes(stem(m.replace(/^\S+\s+/, ''))));
}

export function assertedUnknown(unknowns, input) {
  const sentences = assertedSentences(input);
  if (sentences.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const unknown of (unknowns || [])) {
    const terms = unknownTerms(unknown);
    if (terms.length === 0) continue;
    for (const sentence of sentences) {
      const said = new Set(sentence.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/).filter(Boolean).map(stem));
      const hits = terms.filter((t) => said.has(t));
      /* TWO distinct content terms, or one long and distinctive one. A single
         common word ("patients") is how a founder talks about the business at
         all; treating that as an assertion would fire on every other turn. */
      const strong = hits.length >= 2 || hits.some((t) => t.length >= 5 && terms.length <= 3);
      if (strong && refersToProspect(sentence, terms) && hits.length > bestScore) {
        bestScore = hits.length; best = unknown;
      }
    }
  }
  return best;
}

function firstSentence(value) {
  const s = String(value || '').trim();
  const cut = s.split(/(?<=[.?!])\s/)[0] || s;
  return cut.replace(/\.$/, '');
}
