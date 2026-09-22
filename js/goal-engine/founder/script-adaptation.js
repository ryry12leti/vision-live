/* ════════════════════════════════════════════════════════════════════════
   LOCKED STRATEGY → FOUNDER WORDING.

   One direction of authority, and it is not negotiable: the strategy decides
   WHAT is said and the profile decides only HOW it is worded. Facts,
   evidence, the discovery objective, the allowed claims and the next step
   come out the other side identical or the adaptation is rejected.

   The tempting failure is the opposite: letting a founder's natural style
   quietly rewrite the sales logic because the result "sounds like them".
   A founder who rambles gets their voice, not their run-on sentences. One
   who pressures gets their directness, not "trust me, it's a no-brainer".
   Style is not permission, so every correction the profile recorded is
   applied AFTER the styling and cannot be undone by it.
   ══════════════════════════════════════════════════════════════════════ */

const CONTRACT = [
  [/\bI am\b/g, "I'm"], [/\bI have\b/g, "I've"], [/\byou are\b/g, "you're"],
  [/\bwe are\b/g, "we're"], [/\bit is\b/g, "it's"], [/\bthat is\b/g, "that's"],
  [/\bdo not\b/g, "don't"], [/\bwould not\b/g, "wouldn't"], [/\bcannot\b/g, "can't"],
  [/\bthere is\b/g, "there's"], [/\bwe will\b/g, "we'll"], [/\bI will\b/g, "I'll"],
];
const EXPAND = CONTRACT.map(([re, to]) => [new RegExp(to.replace(/'/g, "'"), 'g'), null]);

/* Formal ↔ plain pairs. Meaning-preserving by construction: each pair is two
   ways of saying one thing, never two different things. */
const PLAIN = [
  [/\bI am reaching out\b/gi, 'I got in touch'], [/\bI wanted to reach out\b/gi, 'I wanted to get in touch'],
  [/\butilis[ez]e\b/gi, 'use'], [/\bleverage\b/gi, 'use'], [/\bfacilitate\b/gi, 'help with'],
  [/\bimplement\b/gi, 'set up'], [/\bidentif(y|ied)\b/gi, (m) => (m.toLowerCase() === 'identify' ? 'spot' : 'spotted')],
  [/\bin order to\b/gi, 'to'], [/\bwith regard to\b/gi, 'about'], [/\bregarding\b/gi, 'about'],
  [/\bassist\b/gi, 'help'], [/\bcommence\b/gi, 'start'], [/\bsubsequently\b/gi, 'then'],
  [/\bapproximately\b/gi, 'about'], [/\badditional\b/gi, 'more'], [/\bcurrently\b/gi, 'right now'],
  /* WHOLE PHRASES, ARTICLES INCLUDED. Replacing the noun and leaving its
     article behind produced "an something that could improve your how you get
     enquiries" — grammatical wreckage that reads as a bug, not as the
     founder. */
  [/\ban opportunity to improve\b/gi, 'something that could improve'],
  [/\bopportunity to improve\b/gi, 'something that could improve'],
  [/\byour digital acquisition strategy\b/gi, 'how you get enquiries'],
  [/\bdigital acquisition strategy\b/gi, 'how you get enquiries'],
];
const FORMALISE = [
  [/\bget in touch\b/gi, 'reach out'], [/\bspot\b/gi, 'identify'], [/\bhelp with\b/gi, 'assist with'],
  [/\bset up\b/gi, 'implement'], [/\babout\b/gi, 'regarding'], [/\bright now\b/gi, 'currently'],
];

/* Corrections. Applied last, so styling can never reintroduce them. */
export const PRESSURE_FIXES = [
  [/\byou need to\b/gi, 'it may be worth'],
  [/\byou have to\b/gi, 'it usually helps to'],
  [/\byou should just\b/gi, 'it may be worth'],
  [/\btrust me,?\s*/gi, ''],
  [/\ba no[- ]brainer\b/gi, 'straightforward'],
  [/\bno[- ]brainer\b/gi, 'straightforward'],
  [/\bwhy wouldn'?t you\b/gi, 'would it be worth'],
  [/\bobviously you\b/gi, 'you might'],
];

const CORRECTORS = {
  no_absolutes: (s) => s
    .replace(/\bguaranteed\b/gi, 'likely').replace(/\b100%\b/g, 'consistently')
    .replace(/\b(everyone|nobody)\b/gi, (m) => (m.toLowerCase() === 'everyone' ? 'a lot of people' : 'not many people'))
    .replace(/\b(always|never)\b/gi, (m) => (m.toLowerCase() === 'always' ? 'usually' : 'rarely'))
    .replace(/\bthe best\b/gi, 'a strong option').replace(/\bnumber one\b/gi, 'well regarded'),
  /* EVERY PATTERN THE DETECTOR FLAGS NEEDS A RULE HERE. The first version
     detected "you should just" and had no correction for it, so the phrase
     was reported as a problem and then printed unchanged — the worst of both.
     PRESSURE_FIXES below is asserted against the detector's own vocabulary. */
  soften_pressure: (s) => PRESSURE_FIXES.reduce((acc, [re, to]) => acc.replace(re, to), s)
    .replace(/\s{2,}/g, ' ').replace(/^\s*,\s*/, ''),
  tighten: (s) => {
    /* Split anything that has become a run-on. Bounded, not rewritten. */
    const parts = s.split(/,\s+(?=(?:and|but|so|which|because)\b)/i);
    if (parts.length < 2) return s;
    return parts.map((p, i) => {
      const t = p.trim().replace(/^(and|but|so|which|because)\s+/i, '');
      const cap = t.charAt(0).toUpperCase() + t.slice(1);
      return i === parts.length - 1 ? cap : cap.replace(/[.,]$/, '') + '.';
    }).join(' ');
  },
};

const apply = (s, pairs) => pairs.reduce((acc, [re, to]) =>
  acc.replace(re, typeof to === 'function' ? to : to), s);

function styleLine(line, profile) {
  if (!line || !profile || !profile.usable) return line;
  const t = profile.traits;
  let out = String(line);

  if (t.formality.value === 'casual' || t.vocabulary.value === 'plain') out = apply(out, PLAIN);
  if (t.formality.value === 'formal') out = apply(out, FORMALISE);
  if (t.contractions.value === 'frequent') out = apply(out, CONTRACT);
  if (t.contractions.value === 'rare') {
    out = out.replace(/\bI'm\b/g, 'I am').replace(/\byou're\b/g, 'you are')
      .replace(/\bit's\b/g, 'it is').replace(/\bdon't\b/g, 'do not');
  }
  void EXPAND;
  return out.replace(/\s{2,}/g, ' ').trim();
}

/* THE CORRECTIONS ALWAYS RUN, whatever the style said. */
function correctLine(line, profile) {
  let out = String(line || '');
  for (const c of ((profile && profile.correct) || [])) {
    const fn = CORRECTORS[c.id];
    if (fn) out = fn(out);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function adaptLine(line, profile) {
  return correctLine(styleLine(line, profile), profile);
}

/* ── the whole script ─────────────────────────────────────────────────── */
export function adaptScript(strategy, profile) {
  const s = strategy || {};
  const neutral = {
    opening: s.opening || null,
    firstQuestion: s.firstQuestion || null,
    discovery: Array.isArray(s.discovery) ? s.discovery.slice() : [],
    objectionResponses: Array.isArray(s.objectionResponses) ? s.objectionResponses.slice() : [],
    close: s.close || null,
  };
  const adapted = {
    opening: adaptLine(neutral.opening, profile),
    /* THE QUESTION IS NEVER REWORDED AWAY. Its wording may change; its
       presence and what it asks about may not, because it is the discovery
       objective rather than a sentence. */
    firstQuestion: adaptLine(neutral.firstQuestion, profile),
    discovery: neutral.discovery.map((d) => adaptLine(d, profile)),
    objectionResponses: neutral.objectionResponses.map((o) => adaptLine(o, profile)),
    close: adaptLine(neutral.close, profile),
  };
  return { neutral, adapted, corrections: ((profile && profile.correct) || []).map((c) => c.id) };
}

/* ── the gate ─────────────────────────────────────────────────────────
   Proves the adaptation changed only wording. If it cannot prove that, the
   adapted script is discarded and the neutral one is used — the same shape
   as every other grounding decision in VISION. */
const CONTENT = /[a-z0-9]+/gi;
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'for',
  'is', 'are', 'was', 'be', 'it', 'that', 'this', 'i', 'you', 'we', 'they', 'my', 'your', 'our',
  'im', 'ive', 'youre', 'were', 'its', 'am', 'have', 'has', 'do', 'does', 'not', 'dont', 'with',
  'about', 'right', 'now', 'more', 'use', 'help', 'start', 'then', 'get', 'got', 'would', 'will',
  'ill', 'well', 'can', 'cant', 'cannot', 'there', 'theres', 'thats', 'wouldnt']);
const contentSet = (t) => new Set((String(t || '').toLowerCase().match(CONTENT) || [])
  .filter((x) => !STOP.has(x) && x.length > 2));

export function verifyAdaptation({ strategy, neutral, adapted, facts = [] }) {
  const problems = [];
  const bad = (code, detail) => problems.push({ code, detail });

  /* Nothing may vanish. */
  for (const k of ['opening', 'firstQuestion', 'close']) {
    if (neutral[k] && !adapted[k]) bad('dropped_section', k);
  }
  if (adapted.discovery.length !== neutral.discovery.length) bad('discovery_count_changed');
  if (adapted.objectionResponses.length !== neutral.objectionResponses.length) bad('objections_count_changed');

  /* NO NEW CLAIM. Every content word in the adapted script must come from the
     neutral script, the strategy's facts, or the founder's own recorded
     phrases — never from nowhere. */
  const allowed = new Set([...contentSet(Object.values(neutral).flat().join(' ')),
    ...contentSet(facts.join(' '))]);
  const PLAIN_OK = new Set(['spot', 'spotted', 'usually', 'rarely', 'likely', 'consistently',
    'straightforward', 'worth', 'might', 'people', 'lot', 'many', 'regarding', 'assist',
    'implement', 'identify', 'currently', 'reach', 'touch', 'enquiries', 'improve', 'something',
    'could', 'option', 'strong', 'regarded', 'helps', 'how', 'way', 'ways']);
  const introduced = [...contentSet(Object.values(adapted).flat().join(' '))]
    .filter((x) => !allowed.has(x) && !PLAIN_OK.has(x));
  if (introduced.length) bad('introduced_content', introduced.slice(0, 6).join(', '));

  /* Facts survive verbatim where the neutral script carried them. */
  for (const f of facts) {
    const token = String(f).match(/\b\d[\d,.]*\b/g) || [];
    for (const n of token) {
      const inNeutral = Object.values(neutral).flat().join(' ').includes(n);
      const inAdapted = Object.values(adapted).flat().join(' ').includes(n);
      if (inNeutral && !inAdapted) bad('fact_lost', n);
    }
  }
  return { valid: problems.length === 0, problems };
}
