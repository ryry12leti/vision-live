/* ════════════════════════════════════════════════════════════════════════
   CALL INTELLIGENCE — the model path's schema, prompt and grounding gate.
   All pure. The transport lives in supabase/functions/_shared.

   The model here has a much narrower job than the practice partner. It does
   not speak, invent, or play anyone: it reads a transcript VISION already
   has and returns an analysis. So the validator is not about tone — it is
   about ATTRIBUTION. Every claim it makes must point at a line somebody
   actually said, and every claim about the PROSPECT must point at a line the
   PROSPECT said. A model that promotes "so you're obviously looking for more
   patients" into a resolved unknown has done the one thing this feature
   exists to prevent, and it is rejected rather than repaired.

   Rejection falls back to the deterministic analysis, which is always
   computed first and is never worse than nothing.
   ══════════════════════════════════════════════════════════════════════ */
import { CALL_PHASES } from './modes/call-assist.js';

/* Strict mode: every property required, additionalProperties false, and none
   of the keywords strict mode rejects (minItems/maxItems/format/pattern). */
export const CALL_INTELLIGENCE_SCHEMA = Object.freeze({
  name: 'call_intelligence',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['phase', 'whatTheyRevealed', 'unknownsResolved', 'objection', 'nextMove', 'nextQuestion', 'warning'],
    properties: {
      phase: { type: 'string', enum: [...CALL_PHASES] },
      whatTheyRevealed: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['what', 'said'],
          properties: {
            what: { type: 'string', description: 'What this tells the founder, in plain words.' },
            said: { type: 'string', description: 'The prospect words this is drawn from, quoted exactly.' },
          },
        },
      },
      unknownsResolved: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['unknown', 'settledBy'],
          properties: {
            unknown: { type: 'string', description: 'One of the recorded unknowns, copied exactly.' },
            settledBy: { type: 'string', description: 'The PROSPECT words that settled it, quoted exactly.' },
          },
        },
      },
      objection: {
        type: ['object', 'null'], additionalProperties: false,
        required: ['kind', 'reads', 'said'],
        properties: {
          kind: { type: 'string' },
          reads: { type: 'string', description: 'What the objection actually means.' },
          said: { type: 'string', description: 'The prospect words, quoted exactly.' },
        },
      },
      nextMove: { type: 'string', description: 'The single highest-value thing for the founder to do next.' },
      nextQuestion: { type: 'string', description: 'One question for the FOUNDER to ask. Never the prospect speaking.' },
      warning: { type: ['string', 'null'], description: 'What the founder is getting wrong right now, or null.' },
    },
  },
});

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function callAssistInput({ context, transcript, deterministic }) {
  const c = context || {};
  const p = c.prospect || {};
  const lines = (transcript || []).map((t) => `${t.speaker === 'prospect' ? 'PROSPECT' : 'FOUNDER'}: ${t.text}`);

  const system = [
    'You are analysing a live sales call for the FOUNDER, silently. You are not on the call.',
    'You never write dialogue. You never speak as the prospect. You never roleplay.',
    '',
    'THE RULE THAT MATTERS MOST: only the PROSPECT can establish a fact about their own business.',
    'If the FOUNDER asserts something, that is not evidence — it is a warning that they are assuming.',
    'Anything not established by a PROSPECT line stays unknown.',
    '',
    `The prospect is ${p.name || 'this business'}${p.sub ? ` (${p.sub})` : ''}.`,
    '',
    'What VISION already observed publicly (do not contradict, do not repeat as new):',
    ...((c.evidence && c.evidence.observed) || []).map((e) => `  - ${e}`),
    '',
    'Recorded unknowns. Mark one resolved ONLY if a PROSPECT line settles it, and copy the unknown exactly:',
    ...((c.unknowns) || []).map((u) => `  - ${u}`),
    '',
    'Quote exactly when you fill "said" or "settledBy" — copy the words from the transcript, do not paraphrase.',
    'nextQuestion is a question the FOUNDER should ask. One question. Never a line for the prospect.',
    'Give one warning at most, about the founder\'s most recent move, or null.',
  ].join('\n');

  const user = [
    'TRANSCRIPT SO FAR:',
    ...lines,
    '',
    'A deterministic pass produced this. Improve on it where the transcript supports something better;',
    'do not contradict it about WHO said what.',
    JSON.stringify({
      phase: deterministic?.phase, objection: deterministic?.objection?.kind || null,
      warning: deterministic?.warning || null,
    }),
  ].join('\n');

  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/* ── the gate ─────────────────────────────────────────────────────────── */
export function validateCallIntelligence(parsed, { transcript = [], handoff = null } = {}) {
  const problems = [];
  const bad = (code, detail) => problems.push({ code, detail });
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, problems: [{ code: 'not_an_object' }] };
  }

  const prospectText = norm((transcript || []).filter((t) => t.speaker === 'prospect').map((t) => t.text).join(' '));
  const anyText = norm((transcript || []).map((t) => t.text).join(' '));
  const quoted = (s) => {
    const n = norm(s);
    return n.length > 0 && prospectText.includes(n);
  };

  if (!CALL_PHASES.includes(parsed.phase)) bad('phase_unknown', String(parsed.phase));
  if (typeof parsed.nextMove !== 'string' || !parsed.nextMove.trim()) bad('no_next_move');
  if (typeof parsed.nextQuestion !== 'string') bad('no_next_question');
  if (String(parsed.nextMove || '').length > 400 || String(parsed.nextQuestion || '').length > 300) bad('too_long');

  /* NOTHING IS ATTRIBUTED TO THE PROSPECT THAT THE PROSPECT DID NOT SAY. */
  for (const r of (Array.isArray(parsed.whatTheyRevealed) ? parsed.whatTheyRevealed : [])) {
    if (!quoted(r?.said)) bad('revealed_not_said', String(r?.said || '').slice(0, 80));
  }
  if (parsed.objection && !quoted(parsed.objection.said)) {
    bad('objection_not_said', String(parsed.objection.said || '').slice(0, 80));
  }

  /* THE ONE THAT MATTERS. An unknown may only be resolved by a PROSPECT line,
     and only an unknown VISION actually recorded. A founder's assertion
     appears in `anyText` but not in `prospectText`, so promoting it fails
     here by construction rather than by the model's good behaviour. */
  const known = Array.isArray(handoff?.unknowns) ? handoff.unknowns : [];
  for (const u of (Array.isArray(parsed.unknownsResolved) ? parsed.unknownsResolved : [])) {
    if (!known.includes(u?.unknown)) bad('unknown_invented', String(u?.unknown || '').slice(0, 80));
    if (!quoted(u?.settledBy)) {
      bad(norm(u?.settledBy) && anyText.includes(norm(u?.settledBy))
        ? 'resolved_by_the_founder'     // said on the call, but not by the prospect
        : 'resolved_by_nothing',
      String(u?.settledBy || '').slice(0, 80));
    }
  }

  /* It must not have written dialogue for anyone. */
  const dialogue = /^\s*(prospect|them)\s*:/i;
  if (dialogue.test(String(parsed.nextQuestion || '')) || dialogue.test(String(parsed.nextMove || ''))) {
    bad('wrote_dialogue');
  }

  /* Numbers it cannot have got from the call or from what VISION observed. */
  const allowed = new Set(
    `${anyText} ${norm(((handoff?.evidence?.observed) || []).join(' '))}`.match(/\d[\d,.]*/g) || []);
  const cited = `${parsed.nextMove} ${parsed.nextQuestion} ${parsed.warning || ''}`.match(/\b\d[\d,.]*\b/g) || [];
  for (const n of cited) {
    if (n.replace(/[^\d]/g, '').length >= 3 && !allowed.has(n)) bad('invented_number', n);
  }

  return { valid: problems.length === 0, problems, analysis: parsed };
}
