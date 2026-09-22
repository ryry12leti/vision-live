/* ════════════════════════════════════════════════════════════════════════
   WHAT IS HAPPENING AROUND THEM RIGHT NOW.

   MODE is a temperament: how this person generally approaches a sales call,
   fixed for the whole rehearsal. SITUATION is circumstance: what is going on
   around them at the moment the phone rings, and it can turn a Receptive
   temperament into a hard conversation, or a Resistant one into an easy
   surprise. The two are read together and never merged -- a mode change
   swaps the character; a situation change swaps the moment. Keeping them
   apart is what lets a founder describe what went wrong afterward: "she was
   Receptive, but rushed" is a sentence with two separable causes.

   None of this touches the prospect's underlying facts. `evidence.observed`,
   `unknowns`, `objections`, the business itself -- all identical across
   every call with this prospect, in every situation. Only the WEATHER
   changes.
   ══════════════════════════════════════════════════════════════════════ */

import { activityPressure } from './business-activity-state.js';

export const SITUATION_STATE_VERSION = 'practice_situation_state_v1';

export const SITUATIONS = Object.freeze({
  NORMAL: 'normal',
  RUSHED: 'rushed',
  BUSY_DISTRACTED: 'busy_distracted',
  GUARDED: 'guarded',
  CURIOUS_ENGAGED: 'curious_engaged',
});
export const SITUATION_IDS = Object.freeze(Object.values(SITUATIONS));
export const VISION_ADAPTIVE = 'vision_adaptive';

export const SITUATION_LABELS = Object.freeze({
  normal: 'Normal',
  rushed: 'Rushed',
  busy_distracted: 'Busy / Distracted',
  guarded: 'Guarded',
  curious_engaged: 'Curious / Engaged',
});

export const SITUATION_DESCRIBES = Object.freeze({
  normal: 'No particular pressure. An ordinary moment to take a call.',
  rushed: 'About to do something else. Attention is available but running out.',
  busy_distracted: 'Doing several things at once. Attention arrives in fragments.',
  guarded: 'Wary of an unexpected call before anything is said.',
  curious_engaged: 'A quiet moment, and some spare interest in why you called.',
});

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/* ── WHAT EACH SITUATION MEANS AT THE FIRST RING ────────────────────────
   Small deltas layered onto whatever the mode already set -- this must
   never overpower mode differentiation. `attention` is the one genuinely
   new lever: how much bandwidth is available for this call right now, in a
   way `engagement` and `resistance` do not capture. A resistant prospect
   with full attention is a wall; a receptive one that is rushed is a
   different kind of hard. */
export const SITUATION_STARTUP = Object.freeze({
  normal: { attention: 0.70, exitIntent: 0, engagement: 0, trust: 0 },
  rushed: { attention: 0.32, exitIntent: +0.12, engagement: -0.04, trust: 0 },
  busy_distracted: { attention: 0.38, exitIntent: +0.06, engagement: -0.08, trust: 0 },
  guarded: { attention: 0.55, exitIntent: 0, engagement: -0.05, trust: -0.08 },
  curious_engaged: { attention: 0.80, exitIntent: -0.05, engagement: +0.08, trust: +0.04 },
});

/* ── HOW ATTENTION MOVES, PER SITUATION ─────────────────────────────────
   The founder can make this better or worse. A rushed prospect rewards
   getting to the point and punishes rambling hard; a curious one is far
   more forgiving and rewards a genuinely relevant question generously; a
   guarded one barely moves either way from ordinary talk but punishes
   overreach heavily, because the wariness was never about pace. */
const SITUATION_REACTIONS = Object.freeze({
  normal: { onConciseRelevant: +0.05, onRamble: -0.07, onOverreach: -0.14 },
  rushed: { onConciseRelevant: +0.12, onRamble: -0.20, onOverreach: -0.16 },
  busy_distracted: { onConciseRelevant: +0.10, onRamble: -0.14, onOverreach: -0.14 },
  guarded: { onConciseRelevant: +0.04, onRamble: -0.05, onOverreach: -0.24 },
  curious_engaged: { onConciseRelevant: +0.16, onRamble: -0.04, onOverreach: -0.12 },
});

const RELEVANT_ACTIONS = Object.freeze([
  'relevant_opening', 'discovery_question', 'high_value_follow_up', 'objection_exploration',
]);
const RAMBLE_WORDS = 40;
const CONCISE_WORDS = 22;

const wordCount = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;

/* Behaviour, not personality -- the same distinction the founder-action
   classifier already makes, read here for length and relevance instead of
   for content. */
export function isRamble(text, action) {
  if (wordCount(text) >= RAMBLE_WORDS) return true;
  return action === 'generic_question' || action === 'repetition';
}
export function isConciseRelevant(text, action) {
  return RELEVANT_ACTIONS.includes(action) && wordCount(text) <= CONCISE_WORDS;
}
const isOverreach = (action) => action === 'pressure' || action === 'unsupported_assumption';

/* ── THE ATTENTION MOVE FOR ONE TURN ─────────────────────────────────────
   Returns null for an ORDINARY turn -- one that is neither a rambling nor a
   concise-and-relevant move -- so the caller drifts attention gently back
   toward the situation's own starting point instead of leaving it frozen.
   A call is not one unremarkable turn away from being unrecoverable, and a
   founder who steadies things after a bad turn gets the credit for it. */
export function attentionDelta(situationId, action, text) {
  const cfg = SITUATION_REACTIONS[situationId] || SITUATION_REACTIONS.normal;
  if (isOverreach(action)) return cfg.onOverreach;
  if (isRamble(text, action)) return cfg.onRamble;
  if (isConciseRelevant(text, action)) return cfg.onConciseRelevant;
  return null;
}

/* Drift is separate from delta because it needs the CURRENT value, which
   attentionDelta alone cannot see. */
function driftTo(current, target, rate) {
  return current + (target - current) * rate;
}

/* ── ONE TURN, APPLIED ────────────────────────────────────────────────── */
export function applySituationTurn(situation, action, text) {
  if (!situation || !situation.id) return situation;
  const startTarget = (SITUATION_STARTUP[situation.id] || SITUATION_STARTUP.normal).attention;
  const delta = attentionDelta(situation.id, action, text);
  let attention = situation.attention;
  attention = delta == null ? driftTo(attention, startTarget, 0.06) : attention + delta;
  attention = clamp01(attention);

  const givenSignal = situation.timePressureSignalGiven === true;
  const wantsSignal = (situation.id === 'rushed' || situation.id === 'busy_distracted')
    && !givenSignal && attention < 0.4;

  return {
    ...situation,
    attention,
    turnsSeen: (situation.turnsSeen || 0) + 1,
    timePressureSignalGiven: givenSignal || wantsSignal,
    /* The turn on which the signal should be spoken, so the dialogue layer
       says it exactly once rather than re-deciding from a boolean it cannot
       tell just flipped. */
    signalDue: wantsSignal,
  };
}

/* ── THE ADDITIVE TERM FOR reaction-policy's willingness() ───────────────
   Deliberately conservative: attention alone spans roughly -0.21..+0.14 and
   the two dispositional situations (guarded / curious) add at most ±0.06.
   Mode's own spread (0.05..0.95 informationWillingness) and trust/resistance
   remain the dominant terms -- this nudges, it does not override, which is
   the whole point of keeping mode and situation separate. */
export function situationWillingnessShift(situation) {
  if (!situation || !situation.id) return 0;
  const attention = typeof situation.attention === 'number' ? situation.attention : 0.7;
  const attentionTerm = (attention - 0.6) * 0.35;
  const dispositionTerm = situation.id === 'guarded' ? -0.06
    : situation.id === 'curious_engaged' ? 0.06 : 0;
  return Math.max(-0.3, Math.min(0.2, attentionTerm + dispositionTerm));
}

/* Guarded overreach amplification for applyFounderAction. A pressure phrase
   or an invented claim reads as confirmation of the wariness, not merely as
   a bad move -- so the trust/resistance effect scales up specifically here,
   rather than a new entry in the EFFECTS table that every other mode would
   also see. */
export function situationOverreachScale(situation, action) {
  if (!situation || situation.id !== 'guarded' || !isOverreach(action)) return 1;
  return 1.4;
}

/* ── DETERMINISTIC SEEDED SELECTION ──────────────────────────────────────
   A small string hash, not a PRNG needing external state. Same seed, same
   context -> same pick, always -- which is what "reproducible tests" and
   "one call stays coherent" both require. A different seed (a different
   call) can land on a different plausible situation from the same weights. */
function seededUnit(seed) {
  const s = String(seed || 'x');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  /* >>> 0 forces unsigned before the division, so this is always [0, 1). */
  return ((h >>> 0) % 100000) / 100000;
}

const HOUR_BUCKETS = Object.freeze(['early', 'morning', 'midday', 'afternoon', 'evening', 'late']);
function hourBucket(hour) {
  /* Boundaries chosen so a pre-lunch call (the brief's own worked example,
     "Tuesday 11:10am") lands in the busier `morning` window rather than
     the quieter lunch dip -- clinics and trades both run hardest right up
     to midday, not from it. */
  if (hour < 8) return 'early';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'midday';
  if (hour < 17) return 'afternoon';
  if (hour < 19) return 'evening';
  return 'late';
}

/* Coarse and honest on purpose -- this is a plausibility weighting, not a
   research subsystem. Each entry is a busyness weight per hour bucket for
   businesses that keyword-match the industry text. Unmatched industries get
   a flat, low-confidence profile rather than a guess dressed as a finding. */
const INDUSTRY_BUSY = Object.freeze([
  { match: /dental|clinic|medical|doctor|gp\b|physio|vet\b/i,
    weights: { early: 0.1, morning: 0.7, midday: 0.35, afternoon: 0.6, evening: 0.15, late: 0.05 } },
  { match: /restaurant|cafe|coffee|bar\b|hospitality|catering/i,
    weights: { early: 0.1, morning: 0.35, midday: 0.75, afternoon: 0.25, evening: 0.8, late: 0.3 } },
  { match: /salon|barber|spa|beauty/i,
    weights: { early: 0.1, morning: 0.3, midday: 0.5, afternoon: 0.6, evening: 0.4, late: 0.1 } },
  { match: /plumb|electric|builder|trade|contractor|hvac|roofing/i,
    weights: { early: 0.55, morning: 0.4, midday: 0.25, afternoon: 0.25, evening: 0.1, late: 0.05 } },
  { match: /retail|shop|store|boutique/i,
    weights: { early: 0.05, morning: 0.25, midday: 0.4, afternoon: 0.4, evening: 0.3, late: 0.1 } },
  { match: /law|legal|solicitor|account|advisor|consult/i,
    weights: { early: 0.1, morning: 0.45, midday: 0.3, afternoon: 0.4, evening: 0.1, late: 0.05 } },
]);
const FLAT_BUSY = Object.freeze({ early: 0.2, morning: 0.35, midday: 0.35, afternoon: 0.35, evening: 0.2, late: 0.1 });

function industryBusyness(industry, bucket) {
  const found = INDUSTRY_BUSY.find((row) => row.match.test(String(industry || '')));
  return { weight: (found ? found.weights : FLAT_BUSY)[bucket] || 0.25, matched: !!found };
}

function roleAttentionAdjust(role) {
  const r = String(role || '').toLowerCase();
  if (/owner|principal|director|founder/.test(r)) return -0.15;
  if (/reception|front.?desk|assistant|coordinator/.test(r)) return +0.10;
  if (/manager/.test(r)) return -0.05;
  return 0;
}

/* ── VISION ADAPTIVE ──────────────────────────────────────────────────
   Builds a PLAUSIBILITY distribution over the five situations from what
   VISION actually has -- industry, role, and the day/time the call is
   happening -- then makes one deterministic, seeded draw from it. The
   distribution is the honest part: nothing here is asserted as fact, and
   the confidence returned is the picked situation's own share of the
   weight, not a manufactured certainty. */
export function deriveAdaptiveSituation({ context = {}, seed = null, now = null, activity = null } = {}) {
  const industry = (context.prospect && context.prospect.industry) || '';
  const role = (context.contactRole && context.contactRole.role) || '';
  const when = now instanceof Date ? now : (now ? new Date(now) : new Date());
  /* ── THE BUSINESS'S CLOCK, NOT THE SERVER'S ──────────────────────────
     `when.getHours()` is UTC inside the edge function, so a Sydney practice
     at 11am local was being read as hour 0 / bucket 'early' -- measured in
     the Practice corpus, not theorised, and it meant every busyness weight
     below was applied to the wrong time of day for any business outside the
     server's zone. BusinessActivityState resolves the real local clock from
     the business's own UTC offset; when it cannot (no verified timezone) we
     keep the previous behaviour rather than pretend UTC is local. */
  const useLocal = activity && Number.isFinite(activity.local_hour) && Number.isFinite(activity.local_day);
  const day = useLocal ? activity.local_day : when.getDay(); /* 0 = Sunday */
  const hour = useLocal ? activity.local_hour : when.getHours();
  const bucket = hourBucket(hour);
  const isWeekend = day === 0 || day === 6;

  const { weight: busyWeight, matched: industryMatched } = industryBusyness(industry, bucket);
  const roleAdj = roleAttentionAdjust(role);
  /* ── ACTIVITY PRESSURE, CONFIDENCE-SCALED ────────────────────────────
     activityPressure() already scales its deltas by the state's confidence
     (high 1.0, medium 0.7, low 0.35), so a low-confidence guess barely
     moves the baseline and an uncertain one moves it not at all. The delta
     is applied to BUSYNESS ONLY. Busyness feeds `rushed` and
     `busy_distracted` below; `guarded` -- the suspicious, hostile-leaning
     situation -- carries a flat baseline that busyness never touches. So a
     busy business becomes hurried, never rude, and that is structural
     rather than a matter of tuning. */
  const pressure = activity ? activityPressure(activity) : null;
  const activityLift = pressure ? -pressure.attentionDelta : 0;
  const busyness = clamp01(busyWeight - roleAdj * 0.6
    + (day === 1 && bucket === 'morning' ? 0.08 : 0) + activityLift);

  const reasoning = [];
  reasoning.push(industryMatched
    ? `${HOUR_BUCKETS.includes(bucket) ? bucket : 'this'} calls to a ${industry.toLowerCase()} business are often ${busyWeight >= 0.5 ? 'busier' : 'quieter'} around this time of day — this is a plausibility signal, not a known fact about them today.`
    : 'No specific industry pattern was available, so busyness is a low-confidence, flat estimate.');
  if (role) {
    reasoning.push(roleAdj < 0
      ? `The contact appears to be ${role.toLowerCase()}, whose attention on an unscheduled call is often more divided.`
      : (roleAdj > 0 ? `The contact appears to be ${role.toLowerCase()}, whose role usually involves fielding calls directly.` : ''));
  }
  if (day === 1 && bucket === 'morning') reasoning.push('Monday mornings often carry a backlog from the weekend.');
  if (isWeekend) reasoning.push('This falls on a weekend, which weakens confidence for a typically weekday business.');

  /* Weights over the five situations. `guarded` gets a flat baseline for
     any unsolicited call; `curious_engaged` gets a small boost from spare
     capacity (the inverse of busyness) and from a role built around
     answering calls. */
  const weights = {
    rushed: busyness * 1.0,
    busy_distracted: busyness * 0.8 * (roleAdj > 0 ? 0.7 : 1),
    guarded: 0.32 + (isWeekend ? 0.05 : 0),
    curious_engaged: 0.14 + (1 - busyness) * 0.18 + Math.max(0, roleAdj) * 0.6,
    normal: 0.22,
  };
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const normalised = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v / total]));

  /* Weighted deterministic draw. */
  const order = ['rushed', 'busy_distracted', 'guarded', 'curious_engaged', 'normal'];
  const draw = seededUnit(`${seed || 'no-seed'}::${industry}::${role}::${day}::${hour}`);
  let acc = 0; let picked = 'normal';
  for (const id of order) {
    acc += normalised[id];
    if (draw < acc) { picked = id; break; }
  }

  const confidenceScore = normalised[picked];
  const confidence = confidenceScore >= 0.4 ? 'medium' : 'low';

  return {
    id: picked,
    source: 'adaptive',
    confidence,
    confidenceScore: Math.round(confidenceScore * 100) / 100,
    distribution: normalised,
    reasoning: reasoning.filter(Boolean),
    basis: {
      industry: industry || null, role: role || null, dayOfWeek: day, hour, bucket, industryMatched,
      /* Which clock produced `hour`, so a reader can tell a real local
         reading from the legacy server one without guessing. */
      clock: useLocal ? 'business_local' : 'server',
      activityState: activity ? activity.state : null,
      activityConfidence: activity ? activity.confidence : null,
      activityLift: Math.round(activityLift * 100) / 100,
    },
  };
}

/* ── ENTRY POINT ─────────────────────────────────────────────────────── */
export function resolveSituation({ situationId, context = {}, seed = null, now = null } = {}) {
  if (situationId && SITUATION_IDS.includes(situationId)) {
    return { id: situationId, source: 'explicit', confidence: 'explicit', reasoning: [] };
  }
  /* The activity state rides on the context, like every other server-side
     input the engine consumes, so no call site needs a new parameter. */
  return deriveAdaptiveSituation({ context, seed, now, activity: context.businessActivity || null });
}

/* The initial mutable state, layered onto whatever mode already produced.
   `attention`, `turnsSeen` and the one-time signal flag live here; the
   meta (id/source/confidence/reasoning/basis) is fixed for the call. */
export function initialSituationState({ situationId, context = {}, seed = null, now = null } = {}) {
  const resolved = resolveSituation({ situationId, context, seed, now });
  const startup = SITUATION_STARTUP[resolved.id] || SITUATION_STARTUP.normal;
  return {
    ...resolved,
    attention: clamp01(startup.attention),
    turnsSeen: 0,
    timePressureSignalGiven: false,
    signalDue: false,
    version: SITUATION_STATE_VERSION,
  };
}

/* ── WHAT THE MODEL / FLOOR IS TOLD — NEVER A NUMBER ───────────────────
   Prose bands, the same pattern `disclosurePhrase` uses in the reaction
   policy: the DECISION is the number above, this is only its translation,
   and translating it is the only thing this function is allowed to do. */
export function situationPosturePhrase(situation) {
  if (!situation || !situation.id) return '';
  const a = situation.attention;
  const label = SITUATION_LABELS[situation.id] || 'Normal';
  if (a >= 0.65) return `${label}: you have room for this call right now.`;
  if (a >= 0.4) return `${label}: you can talk, but you are not fully free.`;
  return `${label}: your attention is stretched thin right now.`;
}

/* Spoken once, only when it is genuinely due — the caller checks
   `situation.signalDue` and clears it after the line is used. Content-free
   about the business, exactly like the deterministic floor everywhere
   else. */
export function timePressureLine(situationId) {
  if (situationId === 'rushed') return "I've only got a minute, so make it quick.";
  if (situationId === 'busy_distracted') return 'Sorry, go ahead — I am half doing something else.';
  return null;
}

/* ── FROM STORED TURNS TO A TRAJECTORY ───────────────────────────────────
   The scoring and post-call functions below both want the same shape: one
   row per founder turn, with the attention it produced and how far that
   moved from the turn before. Read once, here, so neither has to know the
   stored row shape (`state_after`, `founder_action`, `content`) itself. */
export function situationTrajectoryFromTurns(turns = []) {
  const founder = (turns || []).filter((t) => t && t.speaker === 'founder')
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const rows = [];
  let prevAttention = null;
  founder.forEach((t, i) => {
    const situation = t.state_after && t.state_after.situation;
    if (!situation || typeof situation.id !== 'string') return;
    const attention = typeof situation.attention === 'number' ? situation.attention : null;
    if (attention == null) return;
    const startTarget = (SITUATION_STARTUP[situation.id] || SITUATION_STARTUP.normal).attention;
    const delta = prevAttention == null ? (attention - startTarget) : (attention - prevAttention);
    rows.push({
      turn: i + 1, sequence: t.sequence, attention, delta,
      founderText: t.content || '', founderWords: wordCount(t.content || ''),
      founderAction: t.founder_action || null,
      signalGiven: situation.signalDue === true,
      situationId: situation.id,
    });
    prevAttention = attention;
  });
  return rows;
}

/* ── POST-CALL: CAUSE, THEN EFFECT ───────────────────────────────────────
   Reads the ATTENTION TRAJECTORY the runner already recorded turn by turn
   (see `situationTrajectory` below) and states what happened and what the
   founder did about it, without inventing a reason the state does not
   support. This is deliberately never shown live -- the existing principle
   that live is execution-only and post-call carries the psychology. */
export function situationTimeline(trajectory = []) {
  if (!trajectory.length) return [];
  const lines = [];
  const signalRow = trajectory.find((r) => r.signalGiven);
  if (signalRow) {
    lines.push(`At turn ${signalRow.turn} the prospect signalled limited time or attention.`);
    const after = trajectory.filter((r) => r.turn > signalRow.turn).slice(0, 3);
    const before = trajectory.filter((r) => r.turn < signalRow.turn).slice(-2);
    const avgWords = (rows) => (rows.length
      ? rows.reduce((sum, r) => sum + (r.founderWords || 0), 0) / rows.length : null);
    const wBefore = avgWords(before); const wAfter = avgWords(after);
    if (wBefore != null && wAfter != null) {
      if (wAfter < wBefore - 4) lines.push('You shortened what you said after that, and attention recovered.');
      else if (wAfter > wBefore + 4) lines.push(`You kept explaining for a while after that, and their answers ${
        after.some((r) => r.attention < signalRow.attention) ? 'grew shorter' : 'did not open up'}.`);
    }
  }
  const worst = trajectory.reduce((a, b) => (b.attention < a.attention ? b : a), trajectory[0]);
  if (worst && worst.delta != null && worst.delta < -0.12) {
    lines.push(`At turn ${worst.turn} attention dropped sharply after "${(worst.founderAction || 'that move')}" — ${
      isRamble(worst.founderText, worst.founderAction) ? 'the explanation ran long for the moment they were in' : 'it read as pressure or an assumption'}.`);
  }
  const best = trajectory.reduce((a, b) => (b.delta != null && b.delta > (a.delta || -1) ? b : a), trajectory[0]);
  if (best && best.delta != null && best.delta > 0.08) {
    lines.push(`At turn ${best.turn} a concise, relevant question earned more attention rather than less.`);
  }
  return lines;
}

/* ── SITUATIONAL ADAPTATION, AS A SALES-EXECUTION SIGNAL ────────────────
   Folded into the existing score rather than a bonus category: did the
   founder's behaviour correlate with attention recovering, or did a smooth
   opener ignore a prospect who was visibly stretched thin? Returns a
   -1..+1 signal and the reasons, for the caller to weight into whatever
   category already covers how the call was played. */
export function situationalAdaptationSignal(trajectory = []) {
  if (trajectory.length < 2) return { signal: 0, reasons: ['too little of the call to judge'] };
  const reasons = [];
  let signal = 0;

  const signalRow = trajectory.find((r) => r.signalGiven);
  if (signalRow) {
    const after = trajectory.filter((r) => r.turn > signalRow.turn);
    const recovered = after.some((r) => r.attention >= signalRow.attention + 0.1);
    const ignoredWordy = after.slice(0, 2).some((r) => (r.founderWords || 0) >= RAMBLE_WORDS);
    if (recovered) { signal += 0.4; reasons.push('noticed the time-pressure signal and attention recovered afterward'); }
    if (ignoredWordy) { signal -= 0.5; reasons.push('kept explaining at length right after being told time was short'); }
  }

  const overreaches = trajectory.filter((r) => isOverreach(r.founderAction));
  if (overreaches.length) { signal -= 0.3 * Math.min(2, overreaches.length); reasons.push('pushed or assumed while the prospect was reading as guarded or stretched'); }

  const earlyDrops = trajectory.slice(0, 3).filter((r) => r.delta != null && r.delta < -0.1);
  const laterRecovery = trajectory.slice(3).some((r) => r.delta != null && r.delta > 0.08);
  if (earlyDrops.length && laterRecovery) { signal += 0.2; reasons.push('the opening cost attention, but the approach was adjusted afterward'); }
  if (earlyDrops.length && !laterRecovery) { signal -= 0.15; reasons.push('attention dropped early and the approach never adjusted'); }

  return { signal: Math.max(-1, Math.min(1, signal)), reasons };
}
