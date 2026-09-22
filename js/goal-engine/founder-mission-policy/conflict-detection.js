/**
 * Founder Mission Policy — explicit self-report conflict detection.
 *
 * The fact-ledger's own conflict detection (fact-ledger.js's
 * rebuildStateFromFacts) only catches two SAME-KEY facts disagreeing (e.g.
 * two different completedWork values at the same trust tier). It cannot
 * catch a founder saying "I finished everything" in one answer and "the
 * product is not built" in another -- two different claims that are only
 * contradictory once read together as plain language. This is a narrow,
 * deliberately conservative, deterministic check over the raw text the
 * founder actually typed (never an LLM call): when both an explicit
 * completion claim and an explicit non-completion claim are present, no
 * mission may be generated until the founder resolves which is true.
 */

const EXPLICIT_COMPLETE_RE = /\b(?:i(?:'ve| have)?\s+)?(?:finished|completed)\s+(?:everything|it all|building it)\b|\beverything\s+is\s+(?:done|finished|built|complete)\b|\b(?:the\s+|my\s+|our\s+)?(?:product|service|app|website|agency|offer|business)\s+(?:is|are|'s)\s+(?:finished|ready|done|complete|built|live)\b|\bwe\s+(?:have\s+)?launched\b|\bit'?s\s+(?:finished|ready|done|live|built)\b/i;
// Broadened beyond the original "[noun] (is )?not built" shape to also
// catch passive-voice phrasing ("has not been built/created/made") and a
// direct first-person denial ("I have not created it") -- both real
// founder phrasings for "this does not exist yet" that the original,
// narrower pattern missed.
const EXPLICIT_INCOMPLETE_RE = /\b(?:the\s+)?(?:product|service|app|website|agency|offer)\s+(?:is\s+)?not\s+built\b|\bnot\s+built\s+yet\b|\bhaven'?t\s+built\s+(?:it|anything|the\s+product)\b|\bproduct\s+is\s+not\s+built\b|\b(?:has|have)\s+not\s+(?:been\s+)?(?:built|created|made)\b|\bi\s+have\s+not\s+created\s+it\b/i;

/**
 * @param {string[]} rawTexts Every raw piece of text the founder typed this session (goal, progress note, clarification answers, corrections).
 * @returns {{reason: string, question: string}|null}
 */
export function detectExplicitConflict(rawTexts) {
  const corpus = (rawTexts || []).filter((text) => typeof text === 'string' && text.trim().length > 0).join(' \n ');
  if (!corpus) return null;
  if (EXPLICIT_COMPLETE_RE.test(corpus) && EXPLICIT_INCOMPLETE_RE.test(corpus)) {
    return {
      reason: 'conflicting_completion_claims',
      question: 'You said you finished everything, but also that the product is not built yet -- which is accurate?',
    };
  }
  return null;
}
