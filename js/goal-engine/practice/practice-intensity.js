/* ════════════════════════════════════════════════════════════════════════
   TWO DIALS, AND THEY MEASURE DIFFERENT THINGS.

   The founder used to pick a temperament (Receptive / Skeptical / Resistant)
   and a situation (Normal / Busy / Guarded / Curious). Seven names for what
   are really two independent questions, and both of them answerable by the
   person being tested -- so a founder could select a convenient opponent and
   the hidden state was not hidden at all.

     DIFFICULTY   how hard the SALES PROBLEM is: whether authority is clear,
                  how much work uncovering the need takes, how many and how
                  layered the objections are, how freely anything is
                  disclosed, how obvious the next move is.

     PRESSURE     how forgiving the PERSON is: how much patience they start
                  with, how fast poor execution costs ground, how much a good
                  follow-up wins back, and how close a genuinely damaging
                  move sits to ending the call.

   They are orthogonal on purpose. A patient person with an impossible
   qualification problem and an easy sale to a man looking for a reason to
   hang up are both real calls, and neither is reachable on one axis.

   MEDIUM IS TODAY. Every lever below is a no-op at medium/medium, which is
   the tuned baseline the whole Practice suite was measured against. Easy and
   Hard/Brutal are symmetric departures FROM that baseline rather than a new
   centre, so the default rehearsal is byte-identical to the shipped one and
   every existing caller -- none of which passes intensity at all -- keeps
   exactly the behaviour it had. `resolveIntensity(null)` returns null and
   every accessor treats null as medium.

   WHAT THIS FILE DOES NOT DO: pick a role, pick a situation, write a line of
   dialogue, or hold any state. It is policy, read by the engines that
   already own those things. Nothing here is scripted per level -- there is
   no table of Brutal sentences, because a level that ships its own replies
   is a costume, not a difficulty.
   ══════════════════════════════════════════════════════════════════════ */

export const PRACTICE_INTENSITY_VERSION = 'practice_intensity_v1';

export const INTENSITY_LEVELS = Object.freeze(['easy', 'medium', 'hard', 'brutal']);
export const DEFAULT_DIFFICULTY = 'medium';
export const DEFAULT_PRESSURE = 'medium';

export const DIFFICULTY_LABELS = Object.freeze({
  easy: 'Easy', medium: 'Medium', hard: 'Hard', brutal: 'Brutal',
});
export const PRESSURE_LABELS = DIFFICULTY_LABELS;

/* What the founder is told each dial means. Deliberately describes the
   PROBLEM and the PERSON, never the hidden variables that implement them --
   "authority is often unclear" is a promise about difficulty; "you are
   speaking to the receptionist" would be a leak. */
export const DIFFICULTY_DESCRIBES = Object.freeze({
  easy: 'The problem is in plain sight. Whoever answers can usually act, and they will tell you most of what you ask.',
  medium: 'A realistic call. Some things have to be drawn out, and not everyone can decide.',
  hard: 'Authority is often unclear, the need has to be worked for, and objections come in layers.',
  brutal: 'Almost nothing is offered. Expect to be routed, to be given half an answer, and to earn every fact.',
});
export const PRESSURE_DESCRIBES = Object.freeze({
  easy: 'Patient. A clumsy turn costs you very little and a good one wins it straight back.',
  medium: 'A realistic amount of goodwill. Mistakes cost, and recover.',
  hard: 'Short on patience. Poor execution compounds and is slow to forgive.',
  brutal: 'Almost no tolerance. A genuinely damaging move can end the call there and then.',
});

const clamp01 = (n) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

/* ── DIFFICULTY: THE SALES PROBLEM ────────────────────────────────────
   `roleTilt` MULTIPLIES the plausibility weights scenario-selection already
   computed from the business shape; it never replaces them and never pins a
   role. A solo trader's 0.02 gatekeeper weight is still ~0.04 at Brutal --
   difficulty makes an ambiguous authority MORE LIKELY where it was already
   possible, and cannot invent a receptionist for a one-man business. That is
   what keeps hidden-role selection unpredictable rather than a function of
   the dial. */
const DIFFICULTY_POLICY = Object.freeze({
  easy: Object.freeze({
    informationWillingness: +0.20,
    maxObjections: -1,
    objectionGate: 0.60,
    needStrengthScale: 1.30,
    needDiscoveryScale: 1.25,
    disclosureDepthGate: -0.10,
    roleTilt: Object.freeze({ gatekeeper: 0.50, influencer: 0.85, decision_maker: 1.60 }),
  }),
  medium: Object.freeze({
    informationWillingness: 0,
    maxObjections: 0,
    objectionGate: 0.45,
    needStrengthScale: 1,
    needDiscoveryScale: 1,
    disclosureDepthGate: 0,
    roleTilt: Object.freeze({ gatekeeper: 1, influencer: 1, decision_maker: 1 }),
  }),
  hard: Object.freeze({
    informationWillingness: -0.15,
    maxObjections: +1,
    objectionGate: 0.35,
    needStrengthScale: 0.75,
    needDiscoveryScale: 0.80,
    disclosureDepthGate: +0.10,
    roleTilt: Object.freeze({ gatekeeper: 1.50, influencer: 1.20, decision_maker: 0.80 }),
  }),
  brutal: Object.freeze({
    informationWillingness: -0.30,
    maxObjections: +2,
    objectionGate: 0.28,
    needStrengthScale: 0.50,
    needDiscoveryScale: 0.60,
    disclosureDepthGate: +0.18,
    roleTilt: Object.freeze({ gatekeeper: 2.00, influencer: 1.30, decision_maker: 0.60 }),
  }),
});

/* ── PRESSURE: HOW FORGIVING THE PERSON IS ────────────────────────────
   `terminalOnFirstDamagingMove` is the whole of Brutal's teeth, and it is
   deliberately NOT a random trapdoor. It changes nothing about WHICH moves
   are damaging and nothing about when a hangup is considered: the engine
   still has to have raised a hangup candidate -- meaning exit intent already
   crossed this prospect's own threshold -- AND the founder has to still be
   pushing at that moment. Brutal removes the forgiveness pass that would
   have let that first crossing go, so one genuinely damaging move ends the
   call. A founder who says nothing damaging cannot be hung up on by this
   flag, at any level. */
const PRESSURE_POLICY = Object.freeze({
  easy: Object.freeze({
    patience: +0.20,
    exitThreshold: +0.12,
    damageScale: 0.70,
    recoveryScale: 1.30,
    terminalOnFirstDamagingMove: false,
  }),
  medium: Object.freeze({
    patience: 0,
    exitThreshold: 0,
    damageScale: 1,
    recoveryScale: 1,
    terminalOnFirstDamagingMove: false,
  }),
  hard: Object.freeze({
    patience: -0.18,
    exitThreshold: -0.12,
    damageScale: 1.35,
    recoveryScale: 0.85,
    terminalOnFirstDamagingMove: false,
  }),
  brutal: Object.freeze({
    patience: -0.32,
    exitThreshold: -0.22,
    damageScale: 1.75,
    recoveryScale: 0.70,
    terminalOnFirstDamagingMove: true,
  }),
});

/* Keys where a RISE is bad news for the founder. Everything else improves as
   it rises, so one map decides whether a delta is damage or recovery without
   each call site having to know. */
const HARM_WHEN_RISING = Object.freeze(new Set(['resistance', 'exitIntent']));

const level = (value, fallback) => (INTENSITY_LEVELS.includes(value) ? value : fallback);

/* ── THE ONE ENTRY POINT ──────────────────────────────────────────────
   Returns null when nothing was asked for, which every accessor below reads
   as medium. Anything unrecognised -- a stale posture id, a tampered state,
   a number -- clamps to the default rather than throwing or being trusted:
   the whole prospect state is round-tripped through the client, so this is
   re-derived on every read instead of believed once. */
export function resolveIntensity(input) {
  if (!input || typeof input !== 'object') return null;
  const raw = input.intensity && typeof input.intensity === 'object' ? input.intensity : input;
  const hasDifficulty = typeof raw.difficulty === 'string';
  const hasPressure = typeof raw.pressure === 'string';
  if (!hasDifficulty && !hasPressure) return null;
  return Object.freeze({
    version: PRACTICE_INTENSITY_VERSION,
    difficulty: level(raw.difficulty, DEFAULT_DIFFICULTY),
    pressure: level(raw.pressure, DEFAULT_PRESSURE),
  });
}

const difficultyOf = (intensity) =>
  DIFFICULTY_POLICY[level(intensity && intensity.difficulty, DEFAULT_DIFFICULTY)];
const pressureOf = (intensity) =>
  PRESSURE_POLICY[level(intensity && intensity.pressure, DEFAULT_PRESSURE)];

/* ── THE MODE, AS THE TWO DIALS LEAVE IT ──────────────────────────────
   Layered onto whatever mode already produced -- VISION Realistic derives
   its numbers from real evidence about this prospect, and that stays the
   base. Difficulty owns the fields that describe the PROBLEM; pressure owns
   the fields that describe the PERSON'S TOLERANCE. No field is written by
   both, which is what makes the axes independent rather than two names for
   one slider. */
export function applyIntensityToMode(mode, intensity) {
  if (!mode || !intensity) return mode;
  const d = difficultyOf(intensity);
  const p = pressureOf(intensity);
  return {
    ...mode,
    /* DIFFICULTY */
    informationWillingness: clamp01((mode.informationWillingness || 0) + d.informationWillingness),
    maxObjections: Math.max(0, (mode.maxObjections || 0) + d.maxObjections),
    currentNeedStrength: clamp01((mode.currentNeedStrength || 0) * d.needStrengthScale),
    /* PRESSURE
       NOT initialResistance, deliberately. Baseline wariness is a property of
       the PROBLEM and it is entangled with objections, which difficulty owns
       -- and raising it here made Brutal unwinnable: a more resistant
       prospect softens more slowly (the engine's own stickiness term) toward
       a FIXED pitch-permission ceiling of 0.55, so permission could never be
       earned and the first pitch of every Brutal call ended it. Tolerance is
       expressed by patience, the exit threshold and the damage/recovery
       scales, none of which gate whether a pitch can ever be earned. */
    patience: clamp01((mode.patience || 0) + p.patience),
    exitThreshold: clamp01((mode.exitThreshold || 0) + p.exitThreshold),
    intensity,
  };
}

/* How much of a state delta actually lands. Damage and recovery are scaled
   separately so "unforgiving" and "hard to win back" are two properties of
   pressure rather than one symmetric multiplier -- a Brutal prospect punishes
   harder AND rewards less, which is what low tolerance feels like. */
export function intensityEffectScale(intensity, key, by) {
  if (!intensity || !by) return 1;
  const p = pressureOf(intensity);
  const harm = HARM_WHEN_RISING.has(key) ? by > 0 : by < 0;
  return harm ? p.damageScale : p.recoveryScale;
}

/* Uncovering the need is slower on a harder problem. Applied only to GAINS:
   difficulty makes need harder to find, never faster to lose. */
export function intensityNeedDiscoveryScale(intensity, by) {
  if (!intensity || !(by > 0)) return 1;
  return difficultyOf(intensity).needDiscoveryScale;
}

/* The resistance an objection has to overcome before it is raised. Returns
   the shipped 0.45 whenever no intensity is present. */
export function objectionGateOf(intensity) {
  return difficultyOf(intensity).objectionGate;
}

/* Multipliers for scenario-selection's already-computed plausibility
   weights. Never a replacement, never a pin. */
export function roleTiltOf(intensity) {
  return difficultyOf(intensity).roleTilt;
}

/* Added to the trust a deeper fact costs. Positive means facts are held
   back harder. */
export function disclosureDepthGateOf(intensity) {
  return difficultyOf(intensity).disclosureDepthGate;
}

/* Whether one genuinely damaging move is allowed to end the call outright.
   Read only where a hangup candidate has ALREADY been raised. */
export function endsOnFirstDamagingMove(intensity) {
  return pressureOf(intensity).terminalOnFirstDamagingMove === true;
}

/* What may be shown to the founder. The two dials are their own choice, so
   they are safe to echo; nothing derived from them -- role, situation,
   objection path, hidden facts -- appears here. */
export function publicIntensity(intensity) {
  if (!intensity) return null;
  return {
    difficulty: intensity.difficulty,
    pressure: intensity.pressure,
    difficultyLabel: DIFFICULTY_LABELS[intensity.difficulty] || null,
    pressureLabel: PRESSURE_LABELS[intensity.pressure] || null,
  };
}
