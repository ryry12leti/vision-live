/* ════════════════════════════════════════════════════════════════════════
   PHASE 4 WP-1 — WHAT VISION ACTUALLY KNOWS ABOUT THIS SELLER'S BUSINESS

   Reuses the canonical Founder fact ledger (`founder_venture_facts`).
   No duplicate business profile, no new table. A caller passes in the raw
   rows for one venture; this module is pure -- no I/O, no clock, no model.

   READS FACTS DIRECTLY, NOT THE MATERIALISED STATE CACHE, and that was a
   correction made against real staging data rather than the first plan.
   `founder_venture_state` looked like the right primary source -- every
   section pre-resolved to {status:'known'|'unknown'} -- but two of the nine
   business signals P4 needs, `outreachChannel` and `businessModelFamily`,
   are NEVER projected into it (verified: 0 of 234 state rows carry either
   key at all). A reader keyed on state would have silently reported both as
   permanently unknown even when the founder had told VISION directly. Facts
   are the one source that actually carries everything, so they are the only
   source read.

   NEVER ROUND-TRIPS THROUGH THE LEDGER REBUILD. `fact-ledger.js`'s
   `ALL_FACT_KEYS` on this branch does not recognise `targetCustomerType`,
   `businessModelFamily` or several others that exist in real staging rows
   (this branch and the Founder Fact Registry diverged), and its validator
   rejects unrecognised keys outright. This module never calls it -- it reads
   raw fact rows by `fact_key` string and stays agnostic to any registry.

   "ACTIVE" IS NOT ENOUGH TO FIND THE CURRENT VALUE. Verified on staging:
   one venture held three simultaneously ACTIVE `businessModelFamily` facts,
   none superseding another (independent sources, no supersedes_fact_id
   chain between them). Filtering to active=true and taking any row is a
   silent correctness bug. The latest by recorded_at (falling back to
   occurred_at, then a deterministic fact_id tie-break) is the one used.

   UNKNOWN IS FIRST-CLASS AND NEVER INFERRED INTO CERTAINTY. A section with
   no active fact is `unknown`, not a default. A stale one degrades to
   `unknown` too -- see FRESHNESS below -- because presenting old information
   as current is a worse failure than admitting nobody knows.

   TICKET SIZE AND CHANNEL STAY DESCRIPTIVE, NEVER PARSED. Verified: 222 of
   224 `offerPricing` facts are `{notes: "<sentence>"}`, not a number, and
   `outreachChannel` is unconstrained free text that in at least one real row
   conflates channel with the target customer. This module carries the raw
   value through unmodified. It does not attempt to extract a price, does
   not classify B2B/B2C, does not parse a channel enum -- any such derivation
   belongs to WP-2, which decides what a coarse signal is worth, not to the
   reader, which only has to be honest about what was said.

   `pendingFact:*` and `unresolvedFact:*` rows are excluded BY CONSTRUCTION:
   they are a different fact_key string than the resolved key, so an exact
   match on fact_key alone excludes them without special-casing.
   ══════════════════════════════════════════════════════════════════════ */

export const BUSINESS_CONTEXT_VERSION = 'practice_business_context_v1';

/* ── FRESHNESS, REASONED NOT CALIBRATED ─────────────────────────────────
   Same honest position as Phase 3's PROJECTION_PARAM_V1: no product data
   supports a specific number today, and this does not pretend otherwise.
   The entire staging corpus spans 19 days (2026-08-08 to 2026-08-27), so
   there is no organic staleness pattern to calibrate against -- calibrating
   against a 19-day-old synthetic burst would be worse than admitting the
   number is chosen, not measured. 90 days assumes a seller's offer and
   target customer do not change week to week; bumping FRESHNESS_VERSION and
   re-deriving costs nothing, because nothing here is stored -- it is
   recomputed from the ledger on every read. */
export const FRESHNESS_VERSION = 'business_context_freshness_v1';
export const STALE_AFTER_DAYS = 90;

export const STATUS = Object.freeze({ KNOWN: 'known', UNKNOWN: 'unknown' });

/* The nine business signals P4 reads, and the exact fact_key each comes
   from. `currentBottleneck` deliberately differs from its own fact_key: the
   materialised state calls it `bottleneckCandidates`, but the ledger's
   fact_key -- what this module actually reads -- is `currentBottleneck`.
   Named here so a future key never has to be rediscovered from scratch. */
export const SECTIONS = Object.freeze({
  offer: 'offer',
  targetCustomer: 'targetCustomer',
  targetCustomerType: 'targetCustomerType',
  offerPricing: 'offerPricing',
  businessModelFamily: 'businessModelFamily',
  outreachChannel: 'outreachChannel',
  immediateGoal: 'immediateGoal',
  constraints: 'constraints',
  currentBottleneck: 'currentBottleneck',
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/* Deterministic latest-wins over a set of active facts sharing one
   fact_key: recorded_at desc, occurred_at desc as a tiebreak, fact_id as a
   final deterministic tiebreak so two rows sharing both timestamps to the
   millisecond still resolve the same way on every call. */
function latestOf(rows) {
  if (!rows.length) return null;
  const sorted = rows.slice().sort((a, b) => {
    const ra = a.recorded_at || ''; const rb = b.recorded_at || '';
    if (ra !== rb) return ra < rb ? 1 : -1;
    const oa = a.occurred_at || ''; const ob = b.occurred_at || '';
    if (oa !== ob) return oa < ob ? 1 : -1;
    const ida = String(a.fact_id || ''); const idb = String(b.fact_id || '');
    return ida < idb ? 1 : ida > idb ? -1 : 0;
  });
  return sorted[0];
}

function ageDays(isoTimestamp, nowIso) {
  if (!isoTimestamp || !nowIso) return null;
  const then = Date.parse(isoTimestamp);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return (now - then) / MS_PER_DAY;
}

/* One section, resolved from the facts already filtered to this key. */
function resolveSection(rows, { now, staleAfterDays }) {
  const fact = latestOf((rows || []).filter((r) => r && r.active === true));
  if (!fact) {
    return { status: STATUS.UNKNOWN, value: null, confidence: null,
      occurredAt: null, recordedAt: null, sourceType: null,
      verificationStatus: null, degraded: null };
  }
  const occurredAt = fact.occurred_at || null;
  const recordedAt = fact.recorded_at || null;
  const age = ageDays(occurredAt || recordedAt, now);
  const stale = age != null && age > staleAfterDays;
  const base = {
    /* confidence is NEVER coalesced to a number when the ledger has none --
       several fact_keys carry it as null on every row on staging, and a
       silent 0 would read as "known to be untrustworthy" while a silent 1
       would read as certainty nobody actually has. */
    confidence: fact.confidence == null ? null : Number(fact.confidence),
    occurredAt, recordedAt,
    sourceType: fact.source_type || null,
    verificationStatus: fact.verification_status || null,
  };
  if (stale) {
    /* UNKNOWN for any consumer that only reads `status` -- which is every
       consumer this module has today. The raw value and its age are kept
       rather than deleted, because they came from the founder's own data
       and a later, explicitly staleness-aware reader should not have to
       re-derive them; but nothing here treats a degraded section as usable,
       and no caller may either without checking `degraded` itself. */
    return { ...base, status: STATUS.UNKNOWN, value: fact.value ?? null, degraded: 'stale' };
  }
  return { ...base, status: STATUS.KNOWN, value: fact.value ?? null, degraded: null };
}

/* ── THE READER ─────────────────────────────────────────────────────────
   `facts` is the raw row set for ONE venture/user from `founder_venture_facts`
   -- exactly the REST/SQL shape (snake_case columns), unfiltered by caller
   except to scope it to the right venture. `now` is an injected ISO
   timestamp; this file never calls Date.now(), so the same facts always
   resolve to the same context regardless of when the code runs. */
export function businessContextFor({ facts = [], now, staleAfterDays = STALE_AFTER_DAYS } = {}) {
  if (!now) throw new Error('business_context_without_now');
  const byKey = new Map();
  for (const row of facts || []) {
    if (!row || typeof row.fact_key !== 'string') continue;
    if (!byKey.has(row.fact_key)) byKey.set(row.fact_key, []);
    byKey.get(row.fact_key).push(row);
  }

  const sections = {};
  let known = 0; let unknown = 0; let stale = 0;
  for (const [name, factKey] of Object.entries(SECTIONS)) {
    const resolved = resolveSection(byKey.get(factKey), { now, staleAfterDays });
    sections[name] = resolved;
    if (resolved.status === STATUS.KNOWN) known += 1;
    else if (resolved.degraded === 'stale') { unknown += 1; stale += 1; }
    else unknown += 1;
  }

  return {
    version: BUSINESS_CONTEXT_VERSION,
    freshnessVersion: FRESHNESS_VERSION,
    staleAfterDays,
    sections,
    /* For explainability and diagnostics later -- never for selection
       logic, which reads `sections[...].status` directly. */
    coverage: { known, unknown, stale, total: Object.keys(SECTIONS).length },
  };
}
