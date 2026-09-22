/* ════════════════════════════════════════════════════════════════════════
   HOW LONG A PERSON WOULD TAKE TO ANSWER

   Two different things get confused when a rehearsal feels slow. One is how
   long VISION takes to produce a reply — that is a bug when it is high, and
   it is fixed by making the machine faster. The other is how long the
   PERSON would have taken, which is not a bug at all: someone dismissing a
   cold call answers instantly, and someone weighing a question they have
   never been asked does not.

   Measured before this existed: the model returns in ~1.6s at the median.
   That is already close to human, so this is a FLOOR, never an addition —
   if the machine took longer than the person would have, nobody waits
   twice. A dismissal gets a floor below the technical time and therefore
   costs nothing at all.

   Deterministic. The same turn in the same state always yields the same
   number, including the small variation, which is derived from the words
   rather than drawn at random — a rehearsal that cannot be replayed cannot
   be debugged.
   ══════════════════════════════════════════════════════════════════════ */

export const RESPONSE_TIMING_VERSION = 'practice_response_timing_v1';

/* Nobody is faster than this, and nobody makes a founder wait longer. */
const FLOOR_MS = 350;
const CEILING_MS = 2600;

/* What the prospect is doing decides most of it. */
const BASE = Object.freeze({
  receptive: 1450,
  vision_realistic: 1500,
  skeptical: 1950,
  resistant: 1100,
});

/* Answering is quick. Thinking is not.

   Keying this on the action label alone did not work: "when reception is
   tied up, what happens to that call?" comes back as a plain
   `discovery_question`, the same label as "how's business?", and the two
   are nothing alike to answer. What separates them is the SHAPE of the
   question -- a condition to consider, and enough of it to be specific. */
const THINKS = Object.freeze(['high_value_follow_up', 'objection_exploration']);
/* A question with a condition in it: the prospect has to picture a
   situation before they can answer. */
const CONDITIONAL = /\b(when|whenever|if|once|after|during|what happens|how often|in that case)\b/i;
const isQuestion = (t) => /\?\s*$/.test(String(t || '').trim());
const substantial = (t) => {
  const words = String(t || '').trim().split(/\s+/).filter(Boolean);
  return isQuestion(t) && words.length >= 8 && CONDITIONAL.test(t);
};
const DISMISSES = Object.freeze(['pressure', 'premature_pitch', 'repetition', 'hostile']);

/* A question about money, loss or blame is answered more carefully than one
   about how the diary works. */
const SENSITIVE = /\b(cost|costs|costing|lose|losing|lost|revenue|profit|margin|money|spend|budget|price|fault|blame|complain|struggl|problem|worst)\b/i;

/* Same words, same wobble. Enough to stop four replies landing on the same
   millisecond without making a run impossible to reproduce. */
function jitter(text, spread) {
  const s = String(text || '');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = ((h * 31) + s.charCodeAt(i)) % 100000;
  return Math.round(((h % 200) / 200 - 0.5) * 2 * spread);
}
const clamp = (n) => Math.max(FLOOR_MS, Math.min(CEILING_MS, Math.round(n)));

export function responseDelay({ mode = 'vision_realistic', turn = {}, founderText = '' } = {}) {
  const s = turn.prospectStateAfter || {};
  const action = turn.founderAction || '';
  const because = [];
  let ms = BASE[mode] != null ? BASE[mode] : BASE.vision_realistic;

  /* ── THE CALL IS OVER, OR NEARLY ────────────────────────────────────
     Nobody deliberates on the way out. This is checked first because it
     overrides everything below it. */
  if (s.ended) { because.push('ending the call'); return { targetMs: clamp(FLOOR_MS + 150), because, version: RESPONSE_TIMING_VERSION }; }

  /* ── DISMISSING TAKES NO THOUGHT ────────────────────────────────────
     "Not interested" is the fastest thing anyone says on a cold call, and
     a resistant prospect brushing someone off should feel immediate. */
  if (DISMISSES.includes(action)) { ms -= 550; because.push('brushing it off'); }
  if (turn.activeObjection) { ms -= 300; because.push('already has an answer ready'); }
  if (typeof s.exitIntent === 'number' && s.exitIntent >= 0.6) { ms -= 350; because.push('wants off the phone'); }
  if (typeof s.engagement === 'number' && s.engagement <= 0.25) { ms -= 200; because.push('barely engaged'); }

  /* ── SOME QUESTIONS DESERVE A BEAT ──────────────────────────────────
     A resistant prospect who is finally asked something worth considering
     slows down — which is the only moment their timing tells the founder
     he did something right. */
  if (THINKS.includes(action)) { ms += 450; because.push('actually thinking about it'); }
  else if (substantial(founderText)) { ms += 400; because.push('picturing the situation first'); }
  else if (isQuestion(founderText)) { ms -= 120; because.push('an easy one to answer'); }
  if (SENSITIVE.test(founderText)) { ms += 300; because.push('a question they would weigh'); }
  if (typeof s.trust === 'number' && s.trust >= 0.6) { ms -= 150; because.push('comfortable answering'); }
  if (typeof s.resistance === 'number' && s.resistance >= 0.7) { ms -= 150; because.push('guarded, keeping it short'); }

  ms += jitter(founderText, 120);
  return { targetMs: clamp(ms), because, version: RESPONSE_TIMING_VERSION };
}
