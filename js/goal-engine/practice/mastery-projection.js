/* ════════════════════════════════════════════════════════════════════════
   PHASE 3 WP-C — TWO QUESTIONS, NOT ONE

   The first draft of this said both "movement requires two contrary
   observations" and "one poor call moves strong to inconsistent". Those
   cannot both be true, and the fix was not to pick one -- it was to stop
   conflating two different questions:

     demonstrated_level    What has this seller PROVEN they can do?
                           All eligible observations, ever. Cannot fall from
                           the window; only from evidence being invalidated.

     current_reliability   How dependable are they RIGHT NOW?
                           The last W eligible observations. Can fall.

   Reported together, always. Only the current one, and a bad week erases a
   career; only the demonstrated one, and a stale claim stands unchallenged.

   ONE POOR CALL MOVES NEITHER. It enters the window; it does not on its own
   change a band. That is not leniency -- it is the difference between a
   measurement and a mood.

   THE WINDOW IS OVER ELIGIBLE OBSERVATIONS, NEVER OVER CALLS. A call in
   which the skill never became available produces `opportunity: absent`,
   which does not enter the window at all -- so twenty gatekeeper calls
   cannot age a seller's objection handling by a single position. `unknown`
   is excluded the same way and counted separately, so "we cannot tell" is
   visible rather than silently aging something.

   COUNT-BASED, NOT TIME-DECAYED. Every user in the corpus is a QA burst --
   21 calls a day over four days -- so a half-life tuned on that would be
   invented, and inventing a decay constant is exactly the arbitrary mechanic
   this avoids. Historical achievement is permanent. No streaks, no gap
   punishment. A returning seller keeps every past demonstration; only
   current reliability reports thin recent evidence.

   W=8 and MIN=3 are PROJECTION_PARAM_V1: versioned parameters, not
   calibrated truth. They are reasoned from practice-progress.js's existing
   bands (MIN_FOR_DIRECTION 3, MIN_FOR_TREND 5) and are adjustable by
   bumping the version and recomputing, which costs nothing because
   observations are immutable.

   Pure. No I/O, no clock, no randomness.
   ══════════════════════════════════════════════════════════════════════ */
import { isAttempted, OPPORTUNITY, DEMONSTRATED } from './mastery-identity.js';
import { isUnaidedAssistance } from './mastery-observation.js';

export const PROJECTION_VERSION = 'practice_mastery_projection_v1';
export const PROJECTION_PARAM_VERSION = 'PROJECTION_PARAM_V1';
export const WINDOW = 8;
export const MIN_ELIGIBLE = 3;

export const BAND = Object.freeze({
  INSUFFICIENT: 'insufficient_evidence',
  DEVELOPING: 'developing',
  INCONSISTENT: 'inconsistent',
  RELIABLE: 'reliable',
  STRONG: 'strong',
});

/* Ordered worst to best. `inconsistent` sits above `developing` because
   mixed evidence including real strength is a better-established position
   than consistently middling work -- and below `reliable` because it is not
   yet dependable. */
const BAND_ORDER = Object.freeze([
  BAND.INSUFFICIENT, BAND.DEVELOPING, BAND.INCONSISTENT, BAND.RELIABLE, BAND.STRONG,
]);
const rank = (b) => BAND_ORDER.indexOf(b);

export const CONFIDENCE = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' });

/* ONLY AN ATTEMPT CAN MOVE A BAND. `declined` and `prevented` are counted
   and shown and change nothing: not failing is not succeeding, and a product
   that paid out for declining would teach the sentence, not the judgement. */
const isEligible = (o) => o && isAttempted(o.opportunity);

/* THE RAW BAND over one window. Hysteresis is applied on top, by the fold --
   this function has no memory and no opinion about what came before. */
export function bandOf(window) {
  const n = window.length;
  if (n < MIN_ELIGIBLE) return BAND.INSUFFICIENT;
  const strong = window.filter((o) => o.demonstrated === DEMONSTRATED.STRONG).length;
  const weak = window.filter((o) => o.demonstrated === DEMONSTRATED.WEAK).length;
  const adequateOrBetter = window.filter((o) => o.demonstrated === DEMONSTRATED.STRONG
    || o.demonstrated === DEMONSTRATED.ADEQUATE).length;
  const unassisted = window.filter((o) => isUnaidedAssistance(o.assistance)).length;
  const weakInLastThree = window.slice(-3)
    .some((o) => o.demonstrated === DEMONSTRATED.WEAK);

  /* Mixed evidence is a FIRST-CLASS STATE, not an averaging artefact. It
     needs two contrary observations, so a single bad call cannot produce it. */
  if (strong >= 1 && weak >= 2) return BAND.INCONSISTENT;
  if (strong >= 6 && unassisted >= 2 && !weakInLastThree) return BAND.STRONG;
  if (adequateOrBetter >= 5 && unassisted >= 1) return BAND.RELIABLE;
  /* EVERY SUCCESS ASSISTED CAPS AT DEVELOPING. A seller who only ever lands
     it with the rail up has not shown they can do it alone, and is told
     exactly that rather than being quietly promoted. */
  return BAND.DEVELOPING;
}

/* ── THE FOLD ──────────────────────────────────────────────────────────
   Walks the eligible observations in order, recomputing the raw band at
   each step and applying hysteresis: a DOWNGRADE is only accepted once the
   window holds two contrary observations. Upgrades are immediate, because
   nothing is protected by refusing to notice that somebody improved.

   Deterministic and stateless from the outside: the same observations
   always produce the same history, so the projection is fully re-derivable
   and the stored state is never the truth. */
export function foldBands(eligible) {
  const history = [];
  let standing = BAND.INSUFFICIENT;
  for (let i = 0; i < eligible.length; i += 1) {
    const window = eligible.slice(Math.max(0, i + 1 - WINDOW), i + 1);
    const raw = bandOf(window);
    const contrary = window.filter((o) => o.demonstrated === DEMONSTRATED.WEAK
      || o.demonstrated === DEMONSTRATED.NONE).length;
    /* One poor call moves neither level. Two make it real. */
    const accepted = rank(raw) < rank(standing) && contrary < 2 ? standing : raw;
    standing = accepted;
    history.push({ at: i, observation: eligible[i], raw, accepted, window: window.length });
  }
  return history;
}

/* The highest band ever SUSTAINED -- reached and held for MIN_ELIGIBLE
   consecutive eligible observations. A single lucky window is not an
   achievement; holding it is. Returns the band plus when it was established
   and which observations did it, because "you demonstrated Strong" with
   nothing to point at is exactly the unfalsifiable claim this phase exists
   to avoid. */
export function sustainedLevel(history) {
  let best = { level: BAND.INSUFFICIENT, atIndex: null, observedAt: null, observationIds: [] };
  let runBand = null; let runStart = 0;
  for (let i = 0; i < history.length; i += 1) {
    const b = history[i].accepted;
    if (b !== runBand) { runBand = b; runStart = i; }
    const runLength = i - runStart + 1;
    if (runLength >= MIN_ELIGIBLE && rank(b) > rank(best.level)) {
      const establishing = history.slice(runStart, i + 1);
      best = {
        level: b,
        atIndex: i,
        observedAt: history[i].observation.observedAt || null,
        observationIds: establishing.map((h) => h.observation.observationId).filter(Boolean),
      };
    }
  }
  return best;
}

/* Sample count and context coverage, never a hidden score. */
function confidenceOf(eligibleCount, contexts) {
  if (eligibleCount < MIN_ELIGIBLE) return CONFIDENCE.LOW;
  if (eligibleCount >= 6 && contexts >= 2) return CONFIDENCE.HIGH;
  return CONFIDENCE.MEDIUM;
}

/* ── ONE SKILL ON ONE TRACK ────────────────────────────────────────────
   `observations` must already be for a single (skill, track) pair and in
   chronological order. Tracks are NEVER combined -- buildProgressByTrack
   already refuses to aggregate different denominators and mastery inherits
   that refusal rather than re-litigating it. */
export function projectSkill({ skill, track, observations = [] } = {}) {
  const ordered = observations.slice();
  const eligible = ordered.filter(isEligible);
  const absent = ordered.filter((o) => o.opportunity === OPPORTUNITY.ABSENT).length;
  const declined = ordered.filter((o) => o.opportunity === OPPORTUNITY.DECLINED).length;
  const prevented = ordered.filter((o) => o.opportunity === OPPORTUNITY.PREVENTED).length;
  const unknown = ordered.filter((o) => o.opportunity === OPPORTUNITY.UNKNOWN).length;

  const history = foldBands(eligible);
  const current = history.length ? history[history.length - 1].accepted : BAND.INSUFFICIENT;
  const demonstrated = sustainedLevel(history);

  const window = eligible.slice(-WINDOW);
  const unassisted = window.filter((o) => isUnaidedAssistance(o.assistance)).length;
  const contexts = new Set(ordered
    .map((o) => (o.context && (o.context.situation || o.context.difficulty)) || null)
    .filter(Boolean)).size;
  const last = eligible.length ? eligible[eligible.length - 1] : null;

  return {
    skill,
    track,
    projectionVersion: PROJECTION_VERSION,
    projectionParamVersion: PROJECTION_PARAM_VERSION,
    demonstratedLevel: demonstrated.level,
    demonstratedAt: demonstrated.observedAt,
    demonstratedBy: demonstrated.observationIds,
    currentReliability: current,
    confidence: confidenceOf(eligible.length, contexts),
    basis: {
      eligible: eligible.length,
      window: window.length,
      windowSize: WINDOW,
      minEligible: MIN_ELIGIBLE,
      unassisted,
      opportunityAbsent: absent,
      /* Surfaced, not hidden: "the chance was there and they chose not to"
         and "the chance was there and the prospect closed it" are facts a
         seller is entitled to see, even though neither moves a band. */
      opportunityDeclined: declined,
      opportunityPrevented: prevented,
      /* Counted, so "we cannot tell" is visible rather than a silent gap. */
      unknown,
      lastSeen: last ? (last.observedAt || null) : null,
      contexts,
    },
    why: explain({ current, demonstrated: demonstrated.level, eligible: eligible.length,
      window: window.length, unassisted, absent, unknown }),
  };
}

/* One plain sentence, from the numbers above and nothing else. No invented
   narrative, and never a percentage or a rating. */
function explain({ current, demonstrated, eligible, window, unassisted, absent, unknown }) {
  if (eligible === 0 && (absent > 0 || unknown > 0)) {
    return unknown > 0 && absent === 0
      ? 'This has not been readable on the calls so far.'
      : 'This has not come up yet.';
  }
  if (current === BAND.INSUFFICIENT) {
    return `Seen ${eligible} time${eligible === 1 ? '' : 's'} so far — needs ${MIN_ELIGIBLE}.`;
  }
  if (current === BAND.INCONSISTENT) {
    return `Demonstrated ${demonstrated}, but recently mixed across the last ${window}.`;
  }
  if (current === BAND.DEVELOPING && unassisted === 0) {
    return 'Every success so far came with coaching on screen.';
  }
  if (current === BAND.STRONG) {
    return `${eligible} demonstrations, ${unassisted} of them unaided.`;
  }
  return `${eligible} demonstrations so far, ${unassisted} unaided.`;
}

/* Every (skill, track) pair present in the ledger. Pairs are projected
   independently and never merged; a seller who is strong with buyers and
   developing with gatekeepers is BOTH, and is shown both. */
export function projectAll(observations = []) {
  const groups = new Map();
  for (const o of observations) {
    if (!o || !o.skill || !o.track) continue;
    const key = `${o.skill}|${o.track}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const out = [];
  for (const [key, list] of groups) {
    const [skill, track] = key.split('|');
    /* Chronological, with the observation id as a stable tie-break so two
       observations stamped in the same millisecond cannot reorder between
       runs and change a band. */
    list.sort((a, b) => String(a.observedAt || '').localeCompare(String(b.observedAt || ''))
      || String(a.observationId || '').localeCompare(String(b.observationId || '')));
    out.push(projectSkill({ skill, track, observations: list }));
  }
  out.sort((a, b) => a.skill.localeCompare(b.skill) || a.track.localeCompare(b.track));
  return out;
}

/* An md5-shaped digest of the observation SET a projection consumed, so a
   reader can tell whether the stored state is still current without
   recomputing it. Mirrors Phase 2's source_fingerprint exactly. */
export function observationDigest(observations = []) {
  const ids = observations.map((o) => o && o.observationId).filter(Boolean).sort();
  let h = 0x811c9dc5;
  const s = ids.join(',');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `od_${ids.length}_${h.toString(16).padStart(8, '0')}`;
}
