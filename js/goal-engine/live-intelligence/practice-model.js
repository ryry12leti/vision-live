/* ════════════════════════════════════════════════════════════════════════
   THE PRACTICE PARTNER'S PROMPT, SHAPE AND GROUNDING VALIDATOR — all pure.

   The model plays the PROSPECT. That is a roleplay, and roleplay needs room
   to invent: a real practice manager knows their own diary, and a partner
   that refuses to answer anything unrecorded is not a conversation, it is a
   wall. So invention about the prospect's own business is ALLOWED.

   What is not allowed is the invention leaking out as VISION's finding, or
   contradicting what VISION actually observed. Those two rules are the whole
   safety model here:

     1. STAY IN CHARACTER. No coaching, no scoring, no "good opener" — the
        moment it critiques, the founder is no longer practising, and a later
        step owns feedback deliberately.
     2. DO NOT CONTRADICT OBSERVED EVIDENCE. If VISION read a 5-star rating
        from 411 reviews, the prospect cannot say it has no reviews. Anything
        VISION recorded as UNKNOWN, the roleplay may answer freely — that is
        exactly the uncertainty the founder is rehearsing against.

   A reply that breaks either rule is rejected and the deterministic partner
   answers instead. Fallback is not an error path here; it is the floor.
   ══════════════════════════════════════════════════════════════════════ */

export const PRACTICE_REPLY_SCHEMA = Object.freeze({
  name: 'practice_reply',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reply'],
    properties: {
      reply: { type: 'string', description: 'What the prospect says next. One or two sentences.' },
    },
  },
});

export function practiceTurnMessages({ context }) {
  const c = context || {};
  const p = c.prospect || {};
  const role = c.contactRole && c.contactRole.role ? c.contactRole.role : 'someone who works there';

  const system = [
    `You are ${p.name}${p.sub ? ` (${p.sub})` : ''}. You are ${role}, answering an unexpected sales call.`,
    'You are NOT an assistant, a coach or an AI. Never break character. Never evaluate, score, praise or advise the caller — no "good question", no "you should try". If you would say something about how they are selling, say nothing instead and just answer as the person.',
    'Reply with ONE or TWO sentences. Real people on unexpected calls are short.',
    'You are busy and mildly sceptical, not hostile. If they earn it, you engage.',
    '',
    'FACTS ABOUT YOUR BUSINESS THAT ARE PUBLICLY TRUE — never contradict these:',
    ...(c.evidence && c.evidence.observed || []).map((e) => `  - ${e}`),
    '',
    'Anything not listed above you may answer however a real person in your position plausibly would. You know your own diary, your own suppliers and your own plans; the caller does not.',
    '',
    'Objections a person like you would realistically raise, if the moment fits:',
    ...(c.objections || []).map((o) => `  - ${o.objection}`),
  ].join('\n');

  const transcript = (c.history || []).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  return [{ role: 'system', content: system }, ...transcript];
}

/* ── grounding ────────────────────────────────────────────────────────── */

const COACHING = [
  /\bgood (question|opener|opening|point)\b/i, /\byou should\b/i, /\btry saying\b/i,
  /\bas an ai\b/i, /\blanguage model\b/i, /\bI am (an assistant|here to help)\b/i,
  /\bnice job\b/i, /\bwell done\b/i, /\bthat was a\b.*\b(strong|weak) (open|question)\b/i,
  /\bpractice\b/i, /\bscore\b/i, /\bfeedback\b/i, /\broleplay\b/i,
];

/** Numbers the prospect may cite: only those VISION actually observed. */
function observedNumbers(context) {
  const text = ((context.evidence && context.evidence.observed) || []).join(' ');
  return new Set((text.match(/\b\d[\d,.]*\b/g) || []).map((n) => n.replace(/[.,]$/, '')));
}

export function validatePracticeReply(reply, context) {
  const problems = [];
  const text = typeof reply === 'string' ? reply.trim() : '';

  if (!text) problems.push({ code: 'empty_reply' });
  if (text.length > 600) problems.push({ code: 'too_long', detail: `${text.length} chars` });

  for (const re of COACHING) {
    if (re.test(text)) { problems.push({ code: 'broke_character', detail: String(re) }); break; }
  }

  /* A number the prospect quotes that VISION never observed is the reply
     asserting a measurable fact the founder may repeat back as real. Small
     numbers are allowed through — "two chairs", "10 years" — because
     rejecting every digit makes natural speech impossible. */
  const allowed = observedNumbers(context || {});
  const cited = (text.match(/\b\d[\d,.]{2,}\b/g) || []).map((n) => n.replace(/[.,]$/, ''));
  const invented = cited.filter((n) => !allowed.has(n));
  if (invented.length > 0) problems.push({ code: 'unobserved_number', detail: invented.join(', ') });

  /* The reply must not deny something VISION observed. Checked on the
     strongest signal a prospect would plausibly contradict: a review count. */
  const observedText = (((context || {}).evidence || {}).observed || []).join(' ').toLowerCase();
  if (/\b(rated|reviews?)\b/.test(observedText)
      && /\b(no|not any|zero|haven'?t got any) (reviews?|ratings?)\b/i.test(text)) {
    problems.push({ code: 'contradicts_observed', detail: 'denies the observed review base' });
  }

  return { valid: problems.length === 0, problems, reply: text };
}
