/* ════════════════════════════════════════════════════════════════════════
   WHETHER AN ORDINARY MISTAKE DESERVES A HANGUP.

   The deterministic engine already knows when exitIntent has crossed a
   mode's threshold. What it could not tell apart was WHY: a founder who
   just leaned on a Guarded prospect once, cold, with no prior refusal at
   all, crossed the exact same number as a founder who kept selling after
   being told twice to stop. Both ended the call identically -- observed
   live: Guarded's own overreach amplification let a single pressure line
   end a rehearsal before anything had a chance to teach it.

   This file draws that line. Two categories only:

     EXTREME   -- decided entirely in prospect-behaviour.js, no judge
                  involved, ever: hostility, and pushing again after an
                  EXPLICIT stop (do-not-contact or a clear "not interested").
                  Nothing here can soften either.

     CANDIDATE -- everything else that crosses the threshold. An ordinary
                  sales mistake -- pressure, a premature pitch, an
                  unsupported assumption, pushing once after soft
                  resistance, general patience decay -- gets a severity
                  reading before the engine commits to ending the call.

   The model, when one is consulted, never decides state. It returns a
   severity and a confidence; `mapSeverityToDecision` is the ONLY thing
   that turns that into a state change, and it is a pure function with no
   model in it -- fully exercised by the cheap tests in this step. The same
   function runs whether a real judge answered or the flag is off: the
   FALLBACK verdict below is not a bypass, it is the floor this fix
   guarantees with zero model calls -- never instant-terminal on one
   unverified overreach, never silently free either.
   ══════════════════════════════════════════════════════════════════════ */

export const HANGUP_SEVERITY_VERSION = 'practice_hangup_severity_v1';

export const SEVERITY = Object.freeze({
  MINOR: 'minor_mistake',
  FRICTION: 'meaningful_friction',
  BOUNDARY: 'strong_boundary_violation',
  TERMINAL: 'terminal',
});
const SEVERITY_VALUES = Object.freeze(Object.values(SEVERITY));

export const CONFIDENCE = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });
const CONFIDENCE_VALUES = Object.freeze(Object.values(CONFIDENCE));

/* THE FLOOR. No judge consulted -- flag off, call failed, timed out, came
   back malformed -- and no judge NEEDED to guarantee the fix: continue,
   but the mistake still costs something. This is deliberately never
   `minor_mistake` (an unverified pass is not the same as an earned one)
   and never `terminal` (an unreachable judge must not manufacture the exact
   ending this file exists to prevent). */
export const FALLBACK_SEVERITY = SEVERITY.FRICTION;
export const FALLBACK_CONFIDENCE = CONFIDENCE.MEDIUM;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/* ── STRICT STRUCTURED OUTPUT ────────────────────────────────────────── */
export const HANGUP_SEVERITY_SCHEMA = Object.freeze({
  name: 'hangup_severity',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['severity', 'confidence', 'reason'],
    properties: {
      severity: { type: 'string', enum: [...SEVERITY_VALUES] },
      confidence: { type: 'string', enum: [...CONFIDENCE_VALUES] },
      reason: { type: 'string', description: 'One short sentence, plain language.' },
    },
  },
});

/* ── IS THIS TURN EVEN A CANDIDATE? ─────────────────────────────────────
   Reads the marker prospect-behaviour.js leaves on the state -- never
   re-derives it. Two producers deciding the same thing twice is how this
   codebase's worst bugs happened. */
export function hangupCandidateOf(turn) {
  return (turn && turn.prospectStateAfter && turn.prospectStateAfter.hangupCandidate) || null;
}

/* ── MINIMAL CONTEXT, NOTHING ELSE ───────────────────────────────────────
   Exactly what the brief asked for and no more: 2-3 turns, mode, situation,
   the line itself, and whatever the deterministic engine already knows
   about repetition. `guidedWarned` is accepted but never required -- Guided
   Practice's pause history lives in a different layer (call-state.js /
   rule-engine) that this file does not reach into; a caller that has it may
   pass it, and one that does not is not blocked from using this at all. */
export function buildSeverityContext({ turn, history = [], mode = null, situationId = null, guidedWarned = null } = {}) {
  const candidate = hangupCandidateOf(turn);
  const recentTurns = (history || []).slice(-3).map((h) => ({
    speaker: h.speaker === 'founder' ? 'founder' : 'prospect',
    text: String(h.text || '').slice(0, 400),
  }));
  return {
    candidate,
    recentTurns,
    mode: mode || (turn && turn.mode) || null,
    situationId: situationId || null,
    founderLine: (turn && turn.founderText) || '',
    guidedWarned: typeof guidedWarned === 'boolean' ? guidedWarned : null,
  };
}

/* ── THE PROMPT ───────────────────────────────────────────────────────── */
export function buildSeverityPrompt(ctx) {
  const c = ctx.candidate || {};
  const lines = (ctx.recentTurns || [])
    .map((t) => `${t.speaker === 'founder' ? 'FOUNDER' : 'PROSPECT'}: ${t.text}`)
    .join('\n');
  return [
    'You are judging ONE moment in a sales rehearsal: a prospect is considering ending the call. Decide how severe the founder\'s last move actually was.',
    '',
    'RECENT TURNS:',
    lines || '(no prior turns)',
    '',
    `BUYER MODE: ${ctx.mode || 'unspecified'}`,
    `SITUATION: ${ctx.situationId || 'unspecified'}`,
    `THE FOUNDER'S LINE BEING JUDGED: "${ctx.founderLine}"`,
    `WHAT THIS LINE WAS CLASSIFIED AS: ${c.action || 'unknown'}`,
    `TIMES THIS FOUNDER HAS OVERREACHED SO FAR THIS CALL (including this one): ${c.overreachCount != null ? c.overreachCount : 'unknown'}`,
    ctx.guidedWarned != null ? `GUIDED PRACTICE ALREADY WARNED ABOUT THIS EARLIER IN THE CALL: ${ctx.guidedWarned ? 'yes' : 'no'}` : '',
    '',
    'A single ordinary sales mistake -- pressure, a premature pitch, an unsupported assumption, pushing once after soft resistance ("we\'re happy with what we have"), or general patience decay -- is usually minor_mistake or meaningful_friction: coachable, not terminal. Reserve strong_boundary_violation and terminal for a pattern of overreach, pushing again after the prospect was already clearly done, or anything that reads as genuinely abusive. Judge only what is actually in front of you.',
  ].filter(Boolean).join('\n');
}

/* ── THE ONLY THING THAT TURNS A VERDICT INTO STATE ──────────────────────
   Pure. No model call reaches this function; it reaches this function's
   RESULT. Low confidence never manufactures a hangup -- a judge unsure of
   itself is downgraded one tier before anything else happens, so an
   uncertain "terminal" cannot end a call outright and an uncertain
   "strong_boundary_violation" cannot either. */
export function mapSeverityToDecision({ severity, confidence, candidate } = {}) {
  const rawSeverity = SEVERITY_VALUES.includes(severity) ? severity : FALLBACK_SEVERITY;
  const rawConfidence = CONFIDENCE_VALUES.includes(confidence) ? confidence : FALLBACK_CONFIDENCE;
  const c = candidate || {};
  const threshold = typeof c.exitThreshold === 'number' ? c.exitThreshold : 0.75;
  const exitIntent = typeof c.exitIntent === 'number' ? c.exitIntent : threshold;
  const overreachCount = typeof c.overreachCount === 'number' ? c.overreachCount : 1;
  const candidateCount = typeof c.candidateCount === 'number' ? c.candidateCount : 1;

  const effective = (rawConfidence === CONFIDENCE.LOW && rawSeverity === SEVERITY.TERMINAL) ? SEVERITY.BOUNDARY
    : (rawConfidence === CONFIDENCE.LOW && rawSeverity === SEVERITY.BOUNDARY) ? SEVERITY.FRICTION
      : rawSeverity;

  /* Pulls exitIntent back UNDER the threshold by a margin, rather than by a
     fixed delta -- robust to however far past the threshold this candidate
     already was. Each tier leaves progressively less headroom, which is
     the whole mechanism behind "repeated behaviour escalates aggressively":
     a founder who earns a second candidate moment starts it much closer
     to the edge than the first one did. */
  const relieve = (margin) => clamp01(Math.min(threshold - margin, exitIntent));

  const wellPast = exitIntent >= threshold + 0.15;
  /* REPETITION NEEDS NO JUDGE. Whether this is the founder's second
     overreach in the SAME call is a fact the deterministic engine already
     has with certainty -- not a nuance a model is suited for -- so it
     escalates independently of whatever severity came back, exactly as
     specified: "repeated behaviour after coaching/resistance should
     escalate much more aggressively". ONE bar, not a tier-by-tier one:
     `overreachCount` already counted THIS turn's own overreach (see
     prospect-behaviour.js), so >= 2 means a genuine second offence, and
     this is deliberately the same bar the pre-fix code effectively used --
     the fix narrows to the FIRST offence only, and changes nothing about
     what a second one does.

     TWO SIGNALS, NOT ONE. `overreachCount` only moves for pressure and
     unsupported_assumption -- a wall of "Bananas." never overreaches in
     that narrow sense, so on its own this counter would let sustained
     nonsense stall forever just under the threshold, relieved every single
     time. `candidateCount` -- how many times THIS call has already needed
     forgiving, whatever the cause -- is the general form of the same fact,
     and catches that. Either counts as a second offence. */
  const escalatedRepeat = overreachCount >= 2 || candidateCount >= 2;

  if (effective === SEVERITY.MINOR) {
    return { tier: effective, effectiveSeverity: effective, ended: false, endedReason: null,
      resistanceDelta: 0, exitIntent: relieve(0.15), reason: 'coachable_mistake' };
  }
  if (effective === SEVERITY.FRICTION) {
    if (escalatedRepeat) {
      return { tier: effective, effectiveSeverity: effective, ended: true,
        endedReason: c.cause || 'pushed_too_hard', resistanceDelta: 0, exitIntent, reason: 'friction_repeated' };
    }
    return { tier: effective, effectiveSeverity: effective, ended: false, endedReason: null,
      resistanceDelta: 0.08, exitIntent: relieve(0.05), reason: 'meaningful_friction' };
  }
  if (effective === SEVERITY.BOUNDARY) {
    /* Hangup only if current state/history justifies it, exactly as
       specified: a repeat within this call, or exitIntent that was already
       well past the threshold rather than sitting right on it. */
    if (escalatedRepeat || wellPast) {
      return { tier: effective, effectiveSeverity: effective, ended: true,
        endedReason: c.cause || 'pushed_too_hard', resistanceDelta: 0, exitIntent, reason: 'boundary_upheld' };
    }
    return { tier: effective, effectiveSeverity: effective, ended: false, endedReason: null,
      resistanceDelta: 0.18, exitIntent: relieve(0.02), reason: 'boundary_downgraded' };
  }
  /* terminal */
  return { tier: SEVERITY.TERMINAL, effectiveSeverity: effective, ended: true,
    endedReason: c.cause || 'pushed_too_hard', resistanceDelta: 0, exitIntent, reason: 'terminal' };
}

/* The verdict used when no model is consulted at all -- flag off is the
   default for this whole step, by design ("Do NOT run paid/live-model
   testing yet"). Calling mapSeverityToDecision with this is identical to
   calling it with a real medium-confidence meaningful_friction verdict:
   there is no separate bypass path to drift out of sync with the real one. */
export function fallbackVerdict(reason = 'judge_unavailable') {
  return { severity: FALLBACK_SEVERITY, confidence: FALLBACK_CONFIDENCE, reason };
}
