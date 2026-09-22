/* ════════════════════════════════════════════════════════════════════════
   SESSION-SCOPED BUSINESS TRUTH — the same facts, read once

   Measured on Ryan's first real call: every founder turn re-read the entity
   row, then signals and observations, then recompiled BusinessTruth, all
   inside the request the prospect model is waiting behind. The evidence had
   not changed between turns; the work had.

   WHAT MAKES A SESSION A SAFE BOUNDARY. A Practice call is one conversation
   with one prospect. `prospect_ref` cannot change inside it -- the session
   row carries it and the scenario is pinned to it -- and research is not
   expected to land mid-call. So the snapshot is bound to the session and
   reused for its whole life, rather than to a wall-clock TTL invented for
   the purpose. A TTL would be a guess about how fast research moves; the
   session boundary is a fact about what the founder is doing.

   THIS MODULE HOLDS NO AUTHORITY. It decides only whether a snapshot may be
   REUSED. It never compiles truth, never reads a database, never relaxes a
   role ceiling and never invents a fact. Everything it returns came from
   compileBusinessTruth on the same trusted rows; the provenance travels
   with it and is asserted on the way back out.
   ══════════════════════════════════════════════════════════════════════ */

export const TRUTH_CACHE_VERSION = 'practice_truth_cache_v1';

/* A snapshot may only be reused for the business it was compiled for, at the
   compiler version that compiled it. Both are recorded ON the snapshot, so a
   mismatch is detectable without trusting the caller. */
export function snapshotFrom(truth, { prospectRef = null, at = null, buildMs = null } = {}) {
  if (!truth || typeof truth !== 'object') return null;
  const ref = String(prospectRef == null ? '' : prospectRef);
  if (!ref) return null;
  return Object.freeze({
    version: TRUTH_CACHE_VERSION,
    prospectRef: ref,
    /* The compiler's own version, carried from the truth it produced. A
       compiler upgrade must not be served from a snapshot built by its
       predecessor -- that is how a stale ceiling outlives its authority. */
    truthVersion: truth.version || null,
    truth,
    builtAt: at == null ? null : new Date(at).toISOString(),
    buildMs: Number.isFinite(buildMs) ? buildMs : null,
  });
}

/* Reusable ONLY when every identity field matches. Anything unrecognised,
   malformed, or from another business or compiler version is refused, and
   the caller falls back to the uncached path. Refusal is always safe; reuse
   is the thing that must be earned. */
export function isCacheUsable(snapshot, { prospectRef = null, truthVersion = null, now = null, maxAgeMs = null } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return { usable: false, reason: 'no_snapshot' };
  if (snapshot.version !== TRUTH_CACHE_VERSION) return { usable: false, reason: 'cache_version_mismatch' };
  if (!snapshot.truth || typeof snapshot.truth !== 'object') return { usable: false, reason: 'no_truth' };
  const ref = String(prospectRef == null ? '' : prospectRef);
  if (!ref || snapshot.prospectRef !== ref) return { usable: false, reason: 'prospect_mismatch' };
  if (truthVersion && snapshot.truthVersion && snapshot.truthVersion !== truthVersion) {
    return { usable: false, reason: 'truth_version_mismatch' };
  }
  /* A bound is optional and OFF by default: the session boundary is the real
     rule. When a caller does supply one, an unparseable or future builtAt is
     refused rather than treated as fresh. */
  if (Number.isFinite(maxAgeMs) && maxAgeMs > 0) {
    const built = snapshot.builtAt ? Date.parse(snapshot.builtAt) : NaN;
    if (!Number.isFinite(built)) return { usable: false, reason: 'unknown_age' };
    const age = (now == null ? Date.now() : new Date(now).getTime()) - built;
    if (!Number.isFinite(age) || age < 0) return { usable: false, reason: 'unknown_age' };
    if (age > maxAgeMs) return { usable: false, reason: 'expired' };
    return { usable: true, reason: 'fresh', ageMs: age };
  }
  const built = snapshot.builtAt ? Date.parse(snapshot.builtAt) : NaN;
  const age = Number.isFinite(built) ? (now == null ? Date.now() : new Date(now).getTime()) - built : null;
  return { usable: true, reason: 'session_scoped', ageMs: Number.isFinite(age) ? age : null };
}

/* What the runtime records about a turn's truth read. Observation only --
   ids, timings and a reason, never a fact and never a transcript. */
export function cacheObservation(decision, { buildMs = null } = {}) {
  return Object.freeze({
    truth_cache_hit: !!(decision && decision.usable),
    truth_cache_reason: (decision && decision.reason) || 'unknown',
    truth_cache_age_ms: (decision && Number.isFinite(decision.ageMs)) ? decision.ageMs : null,
    truth_cache_build_ms: Number.isFinite(buildMs) ? buildMs : null,
  });
}
