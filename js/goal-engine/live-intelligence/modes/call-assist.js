/* ════════════════════════════════════════════════════════════════════════
   SILENT CALL INTELLIGENCE — the deterministic floor.

   This is NOT practice. VISION never speaks as the prospect here, never
   roleplays and never produces a line of dialogue. It watches a real
   conversation and tells the founder what just changed and what to do next.

   THE ASYMMETRY IS THE WHOLE DESIGN. A prospect's sentence is evidence about
   their business. A founder's sentence is evidence about the FOUNDER — it can
   raise a warning, it can move the call's phase, and it can never make
   something true about the prospect. "So you're obviously looking for more
   patients" resolves nothing; it is the thing to warn about.

   Everything here is session-scoped and pure: nothing it returns is written
   to Leads, Founder State, Calendar or venture memory.
   ══════════════════════════════════════════════════════════════════════ */
/* ── MATCHING AN UNKNOWN AGAINST WHAT WAS SAID ────────────────────────
   The practice partner's matcher is deliberately conservative: it catches a
   founder reusing an unknown's own words. A live call needs one step more,
   because the prospect answers in THEIR words, not VISION's. "It is not yet
   known whether the clinic is seeking more new patients" is settled by "we do
   want more patients" — and stemming alone never bridges seeking/want, so the
   whole of scenario 4 failed silently against the shared matcher.

   The bridge is a small, closed synonym table over the handful of intent
   verbs a buyer actually uses, applied identically to both sides. It is
   deliberately NOT general paraphrase matching: no deterministic matcher gets
   there, and pretending otherwise is how false resolutions start. Anything
   this misses stays UNKNOWN, which is the safe direction. Practice mode's
   matcher is left exactly as it was. */
const SYNONYM = Object.freeze({
  seeking: 'WANT', seek: 'WANT', looking: 'WANT', look: 'WANT', want: 'WANT', wants: 'WANT',
  need: 'WANT', needs: 'WANT', needing: 'WANT', after: 'WANT', keen: 'WANT', interested: 'WANT',
  more: 'MORE', additional: 'MORE', extra: 'MORE', increase: 'MORE', grow: 'MORE', growing: 'MORE',
  decides: 'DECIDE', decide: 'DECIDE', signs: 'DECIDE', sign: 'DECIDE', approves: 'DECIDE',
  approve: 'DECIDE', authorises: 'DECIDE', authorizes: 'DECIDE',
});
const CALL_STOPWORDS = new Set(['it', 'is', 'not', 'yet', 'known', 'whether', 'which', 'who', 'what',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'on', 'in', 'at', 'we', 'you', 'they', 'i',
  'do', 'does', 'did', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'that', 'this',
  'their', 'our', 'my', 'your', 'so', 'but', 'if', 'as', 'currently', 'obviously', 'really',
  'just', 'also', 'about', 'with', 'from', 'up', 'out', 'any', 'all', 'can', 'could', 'would']);

export function callTokens(text) {
  return [...new Set(String(text || '')
    .toLowerCase()
    .replace(/^it is not yet known (whether|which|who|what|if)\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !CALL_STOPWORDS.has(w))
    .map((w) => SYNONYM[w] || w.slice(0, 5)))];
}

export const CALL_PHASES = Object.freeze(['opening', 'discovery', 'objection', 'qualifying', 'closing']);

/* ── what a prospect line can reveal ──────────────────────────────────── */
const REVEAL_PATTERNS = Object.freeze([
  { key: 'acquisition_channel', label: 'How they get customers now',
    re: /\b(google|seo|referral|referrals|word of mouth|facebook|instagram|tiktok|ads?|adwords|walk[- ]?ins?|repeat|website|directory)\b/i },
  { key: 'existing_provider', label: 'Who already does this for them',
    re: /\b(agency|consultant|freelancer|in[- ]house|someone|team|we use|we work with|handled by)\b/i },
  { key: 'capacity', label: 'Whether they have room for more work',
    re: /\b(capacity|book(ed)?|full|quiet|slow|busy|waitlist|openings?|availability|weekdays?|weekends?)\b/i },
  { key: 'volume', label: 'Numbers they run on',
    re: /\b\d[\d,.]*\s*(a|per)?\s*(patients?|clients?|customers?|leads?|jobs?|bookings?|month|week|day)\b/i },
  { key: 'timing', label: 'When they would act',
    re: /\b(this (month|quarter|year)|next (month|quarter|year)|right now|at the moment|currently|soon|later)\b/i },
  { key: 'decision_process', label: 'Who decides',
    re: /\b(i decide|my (partner|wife|husband|business partner)|the owner|head office|board|we[' ]?d have to|talk to)\b/i },
  { key: 'budget', label: 'What they spend',
    re: /\b(budget|spend|costs?|price|pay(ing)?|\$\s?\d)/i },
]);

/* ── objections a prospect actually raises ────────────────────────────── */
const OBJECTIONS = Object.freeze([
  { kind: 'existing_provider', re: /\b(already (have|got|work)|we use|someone (is )?handl|our (agency|guy|team)|being looked after|sorted)\b/i,
    reads: 'They already have someone doing this.',
    explore: 'What made you go with them, and what would you change if you could?' },
  { kind: 'no_need', re: /\b(not (looking|interested|really)|we[' ]?re (fine|good|ok|okay)|don[' ]?t need|no need|happy as we are)\b/i,
    reads: 'They are saying there is no problem to solve.',
    explore: 'Fair enough — what would have to change for this to be worth a look?' },
  { kind: 'timing', re: /\b(not (right )?now|bad time|too busy|maybe later|circle back|after (the )?(holidays|christmas|new year)|next (month|quarter|year))\b/i,
    reads: 'The timing is the objection, not the offer.',
    explore: 'What is taking priority right now, and when does that clear?' },
  { kind: 'price', re: /\b(too expensive|cost too much|can[' ]?t afford|out of (our )?budget|how much|what (does|would) (it|that) cost|pricey)\b/i,
    reads: 'Cost is the blocker they named.',
    explore: 'Before cost — if it worked, what would it need to be worth to you?' },
  { kind: 'trust', re: /\b(tried (that|this|it) before|didn[' ]?t work|burned|waste of money|scam|sceptical|skeptical)\b/i,
    reads: 'They have been let down doing this before.',
    explore: 'What went wrong last time? I would rather not repeat it.' },
  { kind: 'authority', re: /\b(not my (call|decision)|talk to (my|the)|have to (ask|check)|run it by)\b/i,
    reads: 'They are not the one who decides.',
    explore: 'Who else would need to be comfortable with this, and what would they ask?' },
]);

/* A founder line that pitches. Used to detect pitching before discovery. */
const PITCH_RE = /\b(we (offer|provide|do|help|specialise|specialize)|our (service|package|system|programme|program)|i can (get|bring|deliver)|it costs|for \$|per month|sign up|get started)\b/i;
const QUESTION_RE = /\?\s*$|^(what|how|when|where|why|who|which|do|does|did|are|is|was|were|can|could|would|will|have|has|tell me)\b/i;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const lower = (s) => clean(s).toLowerCase();

function linesBy(transcript, speaker) {
  return (transcript || []).filter((t) => t && t.speaker === speaker);
}

/* ── PHASE ────────────────────────────────────────────────────────────
   Derived from what has actually happened, not from a turn counter: a call
   that hits an objection on turn two is in the objection phase. */
export function callPhase(transcript, objection, revealed = []) {
  const turns = (transcript || []).length;
  if (objection) return 'objection';
  /* Opening is "nothing has been established yet", not "few turns have
     happened". A prospect who answers the first question with something real
     has moved the call on, and telling the founder to open again would be
     advice for a call that is no longer happening. */
  if (turns <= 2 && revealed.length === 0) return 'opening';
  const founderLines = linesBy(transcript, 'founder');
  const prospectLines = linesBy(transcript, 'prospect');
  const pitched = founderLines.some((t) => PITCH_RE.test(t.text));
  if (pitched && prospectLines.length >= 2) return 'closing';
  if (prospectLines.length >= 2) return 'qualifying';
  return 'discovery';
}

/* ── WHAT THE PROSPECT REVEALED ───────────────────────────────────────
   PROSPECT LINES ONLY. This is the rule the whole feature rests on. */
export function revealedBy(transcript) {
  const out = [];
  const seen = new Set();
  for (const turn of linesBy(transcript, 'prospect')) {
    for (const pattern of REVEAL_PATTERNS) {
      if (!pattern.re.test(turn.text)) continue;
      if (seen.has(pattern.key)) continue;
      seen.add(pattern.key);
      out.push({ key: pattern.key, what: pattern.label, said: clean(turn.text).slice(0, 240), sequence: turn.sequence });
    }
  }
  return out;
}

/* ── UNKNOWNS THE PROSPECT ACTUALLY SETTLED ───────────────────────────
   Same content-term matching the practice partner uses, but pointed the
   other way and restricted to the prospect: only the person who owns the
   fact can establish it. A founder saying it does not count, which is
   scenario 3 and the reason this is not symmetrical. */
export function unknownsResolvedBy(transcript, unknowns) {
  const resolved = [];
  for (const unknown of (unknowns || [])) {
    const terms = callTokens(unknown);
    if (terms.length === 0) continue;
    for (const turn of linesBy(transcript, 'prospect')) {
      if (/\?\s*$/.test(clean(turn.text))) continue;   // a question settles nothing
      const said = new Set(callTokens(turn.text));
      const hits = terms.filter((t) => said.has(t));
      if (hits.length >= 2) {
        resolved.push({ unknown, settledBy: clean(turn.text).slice(0, 240), sequence: turn.sequence });
        break;
      }
    }
  }
  return resolved;
}

export function objectionIn(transcript) {
  /* The LATEST prospect objection is the live one. An objection raised three
     turns ago and since answered should not keep steering the call. */
  const prospect = linesBy(transcript, 'prospect');
  for (let i = prospect.length - 1; i >= 0; i -= 1) {
    for (const o of OBJECTIONS) {
      if (o.re.test(prospect[i].text)) {
        return { kind: o.kind, reads: o.reads, said: clean(prospect[i].text).slice(0, 240),
          sequence: prospect[i].sequence, explore: o.explore };
      }
    }
  }
  return null;
}

/* ── WARNINGS ─────────────────────────────────────────────────────────
   About the FOUNDER's own last move, which is the only thing they can still
   change. One warning at a time: a list of five is a list nobody reads mid
   call. */
export function warningFor(transcript, unknowns, objection) {
  const founder = linesBy(transcript, 'founder');
  const last = founder[founder.length - 1];
  if (!last) return null;
  const text = clean(last.text);

  /* Asserting something about the prospect that they have not established. */
  for (const unknown of (unknowns || [])) {
    const terms = callTokens(unknown);
    if (terms.length === 0) continue;
    const said = new Set(callTokens(text));
    const hits = terms.filter((t) => said.has(t));
    const asserting = !/\?\s*$/.test(text) && !QUESTION_RE.test(text);
    if (hits.length >= 2 && asserting) {
      const settled = unknownsResolvedBy(transcript, [unknown]).length > 0;
      if (!settled) return `You stated that as fact and they have not said it. Ask instead of assuming.`;
    }
  }

  if (objection && PITCH_RE.test(text)) {
    return `They raised something and you pitched over it. Deal with the objection first.`;
  }
  const prospectCount = linesBy(transcript, 'prospect').length;
  if (PITCH_RE.test(text) && prospectCount < 2) {
    return `You are pitching before you know enough to aim it. Ask one more question first.`;
  }
  return null;
}

/* ── THE MOVE ─────────────────────────────────────────────────────────── */
function nextMoveFor({ phase, objection, revealed, resolved, handoff, warning }) {
  if (objection) {
    return { nextMove: `Do not pitch. ${objection.reads} Understand it before you go further.`,
      nextQuestion: objection.explore };
  }
  if (warning && /pitching before/.test(warning)) {
    return { nextMove: 'Slow down and find the constraint before you offer anything.',
      nextQuestion: handoff?.script?.firstQuestion || 'What is the main thing holding that back right now?' };
  }
  if (phase === 'opening' && revealed.length === 0) {
    return { nextMove: 'Earn the next minute — say why you called and hand them the floor.',
      nextQuestion: handoff?.script?.firstQuestion || 'How are you getting most of your new customers at the moment?' };
  }
  if (revealed.some((r) => r.key === 'acquisition_channel') && !revealed.some((r) => r.key === 'capacity')) {
    return { nextMove: 'You know where their work comes from. Now find out whether they can take more of it.',
      nextQuestion: 'If more came in next week, do you have room to take it?' };
  }
  if (resolved.length && revealed.some((r) => r.key === 'capacity')) {
    return { nextMove: 'They have named a real gap. Reflect it back and check you have it right before offering anything.',
      nextQuestion: 'So the gap is the quieter days rather than volume overall — have I got that right?' };
  }
  if (phase === 'closing') {
    return { nextMove: 'Ask for the specific next step rather than a general yes.',
      nextQuestion: handoff?.desiredClose?.note ? `Would ${String(handoff.desiredClose.note).slice(0, 120)} be worth doing?` : 'Would a short look at it next week be worth your time?' };
  }
  return { nextMove: 'Keep them talking about how it works now — you do not have enough to aim at yet.',
    nextQuestion: 'What have you already tried for that?' };
}

/* ── THE WHOLE ANALYSIS ───────────────────────────────────────────────── */
/* THE SAME CHUNK TWICE IS ONE CHUNK. The table enforces this with
   unique(workspace_id, sequence), but the analyser must not depend on the
   caller having gone through the table: a retried request or a resent chunk
   would otherwise change the phase by inflating the turn count, which is
   exactly what scenario 5 caught. First occurrence wins. */
export function dedupeTranscript(transcript) {
  const seen = new Set();
  return (transcript || []).filter((t) => {
    if (!t || typeof t.sequence !== 'number') return true;
    if (seen.has(t.sequence)) return false;
    seen.add(t.sequence);
    return true;
  });
}

export function analyseCall({ transcript: raw = [], handoff = null } = {}) {
  const transcript = dedupeTranscript(raw);
  const unknowns = Array.isArray(handoff?.unknowns) ? handoff.unknowns : [];
  const objection = objectionIn(transcript);
  const revealed = revealedBy(transcript);
  const resolved = unknownsResolvedBy(transcript, unknowns);
  const warning = warningFor(transcript, unknowns, objection);
  const phase = callPhase(transcript, objection, revealed);
  const { nextMove, nextQuestion } = nextMoveFor({ phase, objection, revealed, resolved, handoff, warning });

  return {
    phase,
    whatTheyRevealed: revealed,
    unknownsResolved: resolved,
    objection,
    nextMove,
    nextQuestion,
    warning,
    /* Which unknowns are STILL open, so the panel can show what not to assert.
       Derived, never stored: the call session does not own the prospect. */
    stillUnknown: unknowns.filter((u) => !resolved.some((r) => r.unknown === u)),
    basis: 'deterministic',
  };
}
