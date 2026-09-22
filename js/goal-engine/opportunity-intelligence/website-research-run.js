/* ════════════════════════════════════════════════════════════════════════
   THE RESEARCH RUN — SERVER-OWNED, CACHED, IDEMPOTENT

   The live proof of the reader worked, but it required hand-seeding the
   signals as service role. That is not a product path: a founder cannot run
   psql before a call. This file is the orchestrator that closes it —
   identity, cache, research, verification, persistence — with every I/O
   injected so the whole decision surface is testable without a network.

   ── WHAT IT REFUSES ─────────────────────────────────────────────────────
   Anything but a MATCHED identity. AMBIGUOUS and MISMATCH are the states
   that exist precisely because research must not attach to the wrong
   business, and this is the only consumer that could make that mistake
   expensive.

   ── WHY A CACHE IS A CORRECTNESS FEATURE, NOT A COST ONE ────────────────
   Researching on every call would mean the prospect's knowledge could
   change mid-conversation, and would spend money proportional to practice
   volume rather than to the number of businesses. The freshness window is
   the same 30-day constant the rest of Opportunity Intelligence already
   uses (eligibility.js), so "fresh" means one thing in this codebase.

   ── FAILURE MUST NOT DESTROY WHAT WE ALREADY KNEW ───────────────────────
   A failed or partial run returns a typed status and writes nothing over
   existing evidence. Persistence is ON CONFLICT DO NOTHING keyed by
   signal_id, and signal ids are derived from the claim's content, so the
   same page read twice cannot produce a second copy of the same fact.
   ══════════════════════════════════════════════════════════════════════ */

import { researchMayBeUsed } from '../practice/prospect-identity.js';
import {
  candidatePages, readPage, verifyClaims, claimsToSignals,
  RESEARCH_METHOD, WEBSITE_PROVIDER,
} from './website-research.js';
import { OPPORTUNITY_STALE_AFTER_MS } from './eligibility.js';

export const RUN_VERSION = 'practice_website_research_run_v1';
/* Website intelligence is stable: a practice does not change what it treats
   every week. Deliberately the SAME window the rest of the subsystem uses
   rather than a second, independently-drifting constant. */
export const RESEARCH_FRESH_MS = OPPORTUNITY_STALE_AFTER_MS;
export const MAX_PAGES_PER_RUN = 3;

export const RESEARCH_STATUS = Object.freeze({
  CACHED: 'cached_fresh',
  RESEARCHED: 'researched',
  PARTIAL: 'researched_partial',
  IDENTITY_REFUSED: 'identity_not_matched',
  NO_WEBSITE: 'no_official_website',
  DISABLED: 'disabled',
  UNCONFIGURED: 'unconfigured',
  FAILED: 'research_failed',
});

/* A stable id per claim, so re-reading the same page cannot create a second
   row for the same fact. Content-derived rather than positional: a page that
   adds a service at the top must not renumber every existing signal. */
export function deriveSignalId(kind, value) {
  const basis = `${kind}::${String(value ?? '').toLowerCase().trim()}`;
  let h = 0;
  for (let i = 0; i < basis.length; i += 1) { h = ((h << 5) - h + basis.charCodeAt(i)) | 0; }
  return `web_${kind}_${Math.abs(h).toString(36)}`.slice(0, 60);
}

/**
 * Is existing website research still fresh?
 * Only rows this pipeline wrote count — a Places listing being recent says
 * nothing about whether the website has been read.
 */
export function websiteResearchFreshness(signals, nowMs) {
  const mine = (signals || []).filter((s) => s?.research_method === RESEARCH_METHOD);
  if (!mine.length) return { fresh: false, count: 0, latestMs: null };
  const stamps = mine
    .map((s) => Date.parse(s.checked_at || ''))
    .filter((n) => Number.isFinite(n));
  const latestMs = stamps.length ? Math.max(...stamps) : null;
  const fresh = latestMs !== null && nowMs >= latestMs && (nowMs - latestMs) <= RESEARCH_FRESH_MS;
  return { fresh, count: mine.length, latestMs };
}

/**
 * Run (or skip) website research for one verified prospect.
 *
 * Every side effect is injected: `readPageImpl` does the model call,
 * `fetchPageText` retrieves the page for quote verification, `persist`
 * writes through the trusted RPC. Nothing here touches a network or a
 * database directly, which is what makes the whole decision tree provable
 * offline.
 */
export async function runWebsiteResearch({
  identity, entity, existingSignals = [], now = Date.now(),
  apiKey = null, enabled = true,
  readPageImpl = readPage, fetchPageText = null, persist = null,
  maxPages = MAX_PAGES_PER_RUN,
} = {}) {
  const base = { version: RUN_VERSION, researched: 0, verified: 0, rejected: 0, persisted: 0, pages: [] };

  /* ── IDENTITY FIRST, ALWAYS. */
  if (!researchMayBeUsed(identity)) {
    return { ...base, status: RESEARCH_STATUS.IDENTITY_REFUSED, identity: identity?.status ?? null };
  }
  if (!enabled) return { ...base, status: RESEARCH_STATUS.DISABLED };

  /* ── CACHE BEFORE COST. */
  const freshness = websiteResearchFreshness(existingSignals, now);
  if (freshness.fresh) {
    return { ...base, status: RESEARCH_STATUS.CACHED, cached: freshness.count, latestMs: freshness.latestMs };
  }

  const site = entity?.official_website || entity?.website || null;
  if (!site) return { ...base, status: RESEARCH_STATUS.NO_WEBSITE };
  if (!apiKey) return { ...base, status: RESEARCH_STATUS.UNCONFIGURED };

  const pages = candidatePages(site, maxPages);
  const signals = [];
  let attempted = 0; let succeeded = 0; let verified = 0; let rejected = 0;

  for (const { url, intent } of pages) {
    attempted += 1;
    const r = await readPageImpl({ url, intent, apiKey });
    if (!r?.ok) { base.pages.push({ url, intent, ok: false, reason: r?.reason ?? 'unknown' }); continue; }
    succeeded += 1;

    /* THE QUOTE IS CHECKED AGAINST TEXT WE FETCHED OURSELVES. The model
       does not get to supply the evidence its own claim is judged against;
       without an independent copy of the page there is nothing to verify
       with, so every claim from that page is dropped rather than trusted. */
    let pageText = '';
    if (typeof fetchPageText === 'function') {
      try { pageText = String((await fetchPageText(url)) || ''); } catch { pageText = ''; }
    }
    const { kept, rejected: bad } = verifyClaims(r.claims, pageText);
    verified += kept.length; rejected += bad.length;
    base.pages.push({ url, intent, ok: true, claimed: r.claims.length, verified: kept.length, rejected: bad.length });

    for (const row of claimsToSignals({ claims: kept, url, entityId: entity.id, observedAt: new Date(now).toISOString() })) {
      if (!row.kind) continue; /* no compiler home — dropped, never invented into one */
      signals.push({
        signalId: deriveSignalId(row.kind, row.value?.claim ?? ''),
        kind: row.kind,
        evidenceStatus: 'OBSERVED',
        confidence: row.confidence,
        sourceUrl: row.source_url,
        sourceType: WEBSITE_PROVIDER,
        researchMethod: RESEARCH_METHOD,
        checkedAt: row.checked_at,
        value: row.value,
        detail: `The official website states: ${String(row.value?.quote ?? '').slice(0, 400)}`,
      });
    }
  }

  /* DEDUPE BEFORE WRITING. A service listed on both the home page and the
     services page is ONE fact, and content-derived ids correctly give it one
     id -- which means the payload would otherwise carry the same row twice.
     The RPC's ON CONFLICT would absorb it, but relying on the database to
     tidy a payload we could have built correctly is how a second copy
     eventually slips through a path that has no such constraint. First
     occurrence wins, so the earliest page (home) supplies the quote. */
  const byId = new Map();
  for (const sig of signals) if (!byId.has(sig.signalId)) byId.set(sig.signalId, sig);
  const unique = [...byId.values()];

  /* NOTHING USABLE IS NOT AN EMPTY WRITE. Persisting zero rows would still
     move nothing, but returning FAILED rather than RESEARCHED keeps the
     caller from recording a successful run that produced no evidence. */
  if (!unique.length) {
    return { ...base, status: RESEARCH_STATUS.FAILED, researched: attempted, verified, rejected,
      reason: succeeded ? 'no_claim_survived_verification' : 'no_page_could_be_read' };
  }

  let persisted = 0;
  if (typeof persist === 'function') {
    /* A persistence failure must leave prior evidence untouched. The RPC is
       ON CONFLICT DO NOTHING, so a partial write is additive and a retry is
       safe -- but a throw here is reported, never swallowed into success. */
    try { persisted = (await persist(unique)) ?? unique.length; }
    catch (e) {
      return { ...base, status: RESEARCH_STATUS.FAILED, researched: attempted, verified, rejected,
        reason: 'persistence_failed', detail: String(e?.message ?? e).slice(0, 200) };
    }
  }

  /* PARTIAL IS SAID OUT LOUD. Some pages failing is normal (a site with no
     /services path), but a caller that cannot tell partial from complete
     will treat thin evidence as the whole truth about the business. */
  const partial = succeeded < attempted;
  return {
    ...base,
    status: partial ? RESEARCH_STATUS.PARTIAL : RESEARCH_STATUS.RESEARCHED,
    researched: attempted, pagesRead: succeeded, verified, rejected, persisted,
    duplicatesCollapsed: signals.length - unique.length,
    signals: unique,
  };
}
