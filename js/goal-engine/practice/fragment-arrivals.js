/* ── WALL-CLOCK FRAGMENT ARRIVAL ─────────────────────────────────────────
   `decideRelease` waits a WALL-CLOCK window (SETTLE_MS) to find out whether
   another fragment of the same thought is still on the wire. The only
   continuation figures on record are AUDIO-clock gaps -- 146 ms and 33 ms --
   and turn-assembly.js's own THE TWO CLOCKS comment records that the
   fragments behind them did not ARRIVE for another ~3.2 s. So the window has
   never been sized from the quantity it actually governs, and an attempt to
   shorten it from those audio-clock numbers was reverted.

   This computes the missing measurement. It decides nothing: no release path
   reads what it returns.

   THE JOIN KEY IS `itemId`, never transcript text. Text is neither unique
   across a call nor stable across a formatted revision of the same turn.
   ──────────────────────────────────────────────────────────────────────── */

export const FRAGMENT_ARRIVAL_VERSION = 'practice_fragment_arrival_v1';

/**
 * @param partIds       fragment ids of ONE founder thought, in order
 * @param arrivalById   itemId -> wall-clock ms the provider delivered it
 * @param releaseAt     wall-clock ms this thought was released
 * @param releasedBy    decideRelease().reason
 * @param previousReleaseAt  when the PREVIOUS thought was released, or null
 */
export function fragmentArrivals({ partIds = [], arrivalById = {}, releaseAt = null,
  releasedBy = null, previousReleaseAt = null, settleMs = null, dangleSettleMs = null } = {}) {
  const fragments = (partIds || []).map((itemId) => {
    const at = arrivalById ? arrivalById[itemId] : undefined;
    return { itemId, arrivedAt: typeof at === 'number' ? at : null };
  });
  /* An unstamped fragment is COUNTED, never dropped. A silently shorter list
     would understate the gaps and read as better latency than was measured. */
  const stamped = fragments.filter((f) => f.arrivedAt !== null);
  const intraTurnGapsMs = [];
  for (let i = 1; i < stamped.length; i += 1) {
    intraTurnGapsMs.push(stamped[i].arrivedAt - stamped[i - 1].arrivedAt);
  }
  const firstArrivedAt = stamped.length ? stamped[0].arrivedAt : null;
  const lastArrivedAt = stamped.length ? stamped[stamped.length - 1].arrivedAt : null;
  return {
    version: FRAGMENT_ARRIVAL_VERSION,
    fragments,
    fragmentCount: fragments.length,
    unstampedCount: fragments.length - stamped.length,
    firstArrivedAt,
    lastArrivedAt,
    /* THE DATASET. Real wall-clock deltas between consecutive fragments the
       assembler joined into one thought -- continuations the settle window
       actually caught. */
    intraTurnGapsMs,
    releaseAt: typeof releaseAt === 'number' ? releaseAt : null,
    releasedBy: releasedBy || null,
    waitedAfterLastFragmentMs: (typeof releaseAt === 'number' && lastArrivedAt !== null)
      ? releaseAt - lastArrivedAt : null,
    /* THE CROSS-TURN HALF. A fragment that arrives shortly after the previous
       thought was released is a continuation the window did NOT catch, and
       is how a premature release is identified offline. */
    previousReleaseAt: typeof previousReleaseAt === 'number' ? previousReleaseAt : null,
    msSincePreviousRelease: (typeof releaseAt === 'number' && typeof previousReleaseAt === 'number')
      ? releaseAt - previousReleaseAt : null,
    firstArrivalAfterPreviousReleaseMs:
      (firstArrivedAt !== null && typeof previousReleaseAt === 'number')
        ? firstArrivedAt - previousReleaseAt : null,
    settleMs: typeof settleMs === 'number' ? settleMs : null,
    dangleSettleMs: typeof dangleSettleMs === 'number' ? dangleSettleMs : null,
  };
}
