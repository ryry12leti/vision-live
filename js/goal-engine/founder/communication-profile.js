/* ════════════════════════════════════════════════════════════════════════
   HOW THE FOUNDER TALKS — and nothing else about them.

   A script that is strategically perfect and sounds nothing like the person
   reading it gets abandoned on the second call. So VISION learns the
   founder's WORDING, and only their wording.

   WHAT THIS DELIBERATELY DOES NOT DO: it does not score the founder, rank
   them, or infer anything about intelligence, personality, confidence,
   demographics, or how they sound. Every trait is a property of the TEXT —
   sentence length, contractions, hedges, repeated phrases — and each carries
   the evidence it came from, so a founder can see why VISION concluded it
   and disagree.

   Style is not permission. A founder who naturally rambles, pitches early or
   overclaims keeps their voice and loses the behaviour: the strategy stays
   the authority, and the profile only chooses words.
   ══════════════════════════════════════════════════════════════════════ */

export const PROFILE_VERSION = 1;

const CONTRACTION = /\b(\w+'(s|re|ve|ll|d|t|m)|gonna|wanna|kinda|sorta)\b/gi;
const FORMAL_LINK = /\b(therefore|furthermore|moreover|consequently|in addition|with regard to|utilise|utilize|leverage|facilitate|implement|regarding|subsequently)\b/gi;
const CASUAL_MARK = /\b(yeah|yep|basically|honestly|look|anyway|pretty much|a bit|stuff|thing is)\b/gi;
const HEDGE = /\b(sort of|kind of|maybe|perhaps|i think|i guess|possibly|probably|might be|a little bit)\b/gi;
const FILLER = /\b(um|uh|erm|you know|i mean)\b/gi;
const ABSOLUTE = /\b(everyone|nobody|always|never|guaranteed|the best|number one|instantly|100%)\b/gi;
/* Exported so the corrector can be proven to cover every phrase this
   detects — a flagged phrase with no fix is reported and then printed. */
export const PRESSURE_PHRASES = Object.freeze(['you need to', 'you have to', 'you should just',
  'trust me', 'no-brainer', "why wouldn't you", 'obviously you']);
const PUSH = /\b(you need to|you have to|you should just|trust me|no[- ]brainer|why wouldn'?t you|obviously you)\b/gi;

/* A LINE BREAK IS NOT A FULL STOP. Splitting on newlines counted wrapped
   text as separate sentences, which made a long formal paragraph look terse
   and — worse — made a founder who rambles in one unbroken run-on look like
   five tidy sentences, hiding the exact habit that most needs correcting. */
const sentences = (t) => String(t || '').replace(/\s*\n+\s*/g, ' ')
  .split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 1);
const words = (t) => String(t || '').toLowerCase().match(/[a-z']+/g) || [];
const count = (t, re) => (String(t || '').match(re) || []).length;
const per100 = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

const trait = (value, confidence, evidence) => ({ value, confidence, evidence: evidence || null });

/* Confidence scales with how much was actually said. Two sentences cannot
   establish a habit, and saying so beats a number that pretends otherwise. */
function confidenceFor(sampleWords, strength) {
  const volume = Math.min(1, sampleWords / 120);
  return Math.round(Math.min(0.9, 0.25 + volume * 0.45 + strength * 0.3) * 100) / 100;
}

export function deriveCommunicationProfile(transcript, { now = new Date().toISOString(), source = 'spoken_intro' } = {}) {
  const raw = String(transcript || '').trim();
  const sents = sentences(raw);
  const w = words(raw);
  const total = w.length;

  /* Judged on how much was SAID, not how it was punctuated: a founder who
     speaks one 90-word sentence has told VISION plenty. */
  if (total < 25) {
    /* NOT ENOUGH TO LEARN FROM. A confident profile from one line would make
       every later adaptation a guess wearing a number. */
    return { version: PROFILE_VERSION, source, updatedAt: now, sampleWords: total,
      usable: false, reason: 'not_enough_speech', traits: {}, phrases: [], correct: [] };
  }

  const avgLen = Math.round((total / sents.length) * 10) / 10;
  const longOnes = sents.filter((s) => words(s).length > 34).length;
  const contractions = per100(count(raw, CONTRACTION), total);
  const formal = per100(count(raw, FORMAL_LINK), total);
  const casual = per100(count(raw, CASUAL_MARK), total);
  const hedges = per100(count(raw, HEDGE), total);
  const fillers = per100(count(raw, FILLER), total);
  const longWords = per100(w.filter((x) => x.length >= 9).length, total);

  const traits = {
    sentenceLength: trait(avgLen <= 13 ? 'short' : (avgLen <= 22 ? 'medium' : 'long'),
      confidenceFor(total, sents.length >= 5 ? 0.8 : 0.4),
      `${avgLen} words per sentence across ${sents.length}`),
    formality: trait(formal > casual + 0.4 ? 'formal' : (casual > formal ? 'casual' : 'neutral'),
      confidenceFor(total, Math.min(1, Math.abs(formal - casual) / 2)),
      formal > casual ? 'uses formal connectives' : (casual ? 'uses casual markers' : 'neither markedly')),
    contractions: trait(contractions >= 1.5 ? 'frequent' : (contractions > 0 ? 'occasional' : 'rare'),
      confidenceFor(total, Math.min(1, contractions / 3)), `${contractions} per 100 words`),
    vocabulary: trait(longWords >= 9 ? 'technical' : (longWords >= 5 ? 'mixed' : 'plain'),
      confidenceFor(total, 0.6), `${longWords}% words of 9+ letters`),
    directness: trait(hedges >= 1.6 ? 'hedged' : (hedges > 0.5 ? 'measured' : 'direct'),
      confidenceFor(total, Math.min(1, hedges / 3)), `${hedges} hedges per 100 words`),
    /* A tendency recorded so it can be CORRECTED, never reproduced. */
    concision: trait(
      (avgLen > 34 || longOnes >= 2 || fillers >= 2) ? 'rambling' : (avgLen <= 15 ? 'concise' : 'measured'),
      confidenceFor(total, Math.min(1, (longOnes + fillers + (avgLen > 34 ? 2 : 0)) / 3)),
      `${avgLen} words per sentence, ${longOnes} over 34, ${fillers} fillers per 100 words`),
  };

  return { version: PROFILE_VERSION, source, updatedAt: now, sampleWords: total,
    usable: true, reason: null, traits, phrases: recurringPhrases(raw),
    correct: correctionsFor(raw, traits) };
}

/* Runs the founder actually repeats — their phrasing, not vocabulary VISION
   invented for them. */
export function recurringPhrases(text, { min = 2, max = 4 } = {}) {
  const w = words(text);
  const seen = new Map();
  for (const n of [3, 2]) {
    for (let i = 0; i + n <= w.length; i += 1) {
      const gram = w.slice(i, i + n).join(' ');
      if (/^(the|and|but|for|you|our|that|this|with|they|are|was|its|it's)\b/.test(gram)) continue;
      if (gram.length < 9) continue;
      seen.set(gram, (seen.get(gram) || 0) + 1);
    }
  }
  return [...seen.entries()].filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1]).slice(0, max).map(([phrase, times]) => ({ phrase, times }));
}

/* WHAT MUST BE CORRECTED, not copied. */
export function correctionsFor(text, traits) {
  const out = [];
  if (traits.concision && traits.concision.value === 'rambling') {
    out.push({ id: 'tighten', why: 'Long sentences lose a prospect on the phone.' });
  }
  if (count(text, ABSOLUTE) > 0) {
    out.push({ id: 'no_absolutes', why: 'Absolute claims are not grounded and cannot be supported.' });
  }
  if (count(text, PUSH) > 0) {
    out.push({ id: 'soften_pressure', why: 'Pressure phrasing raises resistance rather than interest.' });
  }
  return out;
}

/* A sentence the founder can read back, built only from observed traits. */
export function describeProfile(profile) {
  if (!profile || !profile.usable) return 'VISION has not heard enough yet to match your wording.';
  const t = profile.traits;
  const bits = [];
  if (t.concision.value === 'concise') bits.push('concise');
  if (t.formality.value === 'casual') bits.push('conversational');
  if (t.formality.value === 'formal') bits.push('more formal');
  if (t.directness.value === 'direct') bits.push('direct');
  if (t.directness.value === 'hedged') bits.push('careful with claims');
  if (t.vocabulary.value === 'plain') bits.push('plain-spoken');
  const style = bits.length ? bits.join(', ') : 'the way you put things';
  const fix = profile.correct.length
    ? ' VISION will still keep the sales approach tight where your natural habits would work against you.' : '';
  return `Got it. Scripts will sound ${style}, while the sales strategy stays exactly as VISION set it.${fix}`;
}
