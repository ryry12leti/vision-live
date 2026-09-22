/* ════════════════════════════════════════════════════════════════════════
   PROSPECT LANGUAGE CACHE — prose only, never authority
   ────────────────────────────────────────────────────────────────────────
   THE ONE RULE THIS MODULE EXISTS TO ENFORCE:

     CACHED LANGUAGE IS UNTRUSTED DERIVED DATA.

   What is cached is the English a model wrote. What is NOT cached, ever, is
   anything that decides something: ranking, qualification, consent,
   contactability, the next action, evidence status or Founder State. All of
   those are recomputed from current authoritative data on every single
   request, including a cache hit, and the cached prose is then re-validated
   against those fresh results before it is allowed anywhere near a founder.

   A fingerprint match is NOT sufficient. It is a cheap pre-filter that says
   "the inputs look unchanged"; the grounding validator is what says "this
   sentence is still true". A row an authenticated user edited in their own
   cache is still just a candidate string that has to survive the validator.

   WHY A FINGERPRINT AT ALL, THEN. Because re-validating is cheap and
   re-generating is not: without it every reopen costs a model call, and a
   founder with a hundred prospects would pay for a hundred generations every
   time they browsed their own list.
   ════════════════════════════════════════════════════════════════════════ */

import { validateProspectLanguage, PROSPECT_INTELLIGENCE_CONTRACT_VERSION } from './prospect-intelligence-contract.js';
import { groundProspectLanguage, LIVE_INTENT_WINDOW_MS } from './prospect-intelligence.js';

/**
 * The prompt / grounding / output-policy version.
 *
 * Bump ONLY when a change should make previously-generated language obsolete —
 * a reworked prompt, a new grounding rule, a changed output contract. Not a
 * git SHA: most commits do not change what good language looks like, and using
 * one would throw away every cached record on every deploy.
 */
/* 2 — strengths must be business reasons rather than execution readiness.
   Bumped deliberately: prose written under the old policy is obsolete by
   definition, and leaving it cached would mean the fix is invisible on every
   prospect VISION has already written about. The cost is one regeneration per
   prospect, on first open, and it is the honest price of a policy change. */
export const PROSPECT_LANGUAGE_POLICY_VERSION = 2;

export const CACHE_STATUS = Object.freeze({
  HIT: 'hit',
  MISS_GENERATED: 'miss_generated',
  INVALID_REGENERATED: 'invalid_regenerated',
  EXPIRED_REGENERATED: 'expired_regenerated',
  FALLBACK_NOT_CACHED: 'fallback_not_cached',
});

/* ── FINGERPRINT ─────────────────────────────────────────────────────────
   Only inputs that can MATERIALLY change the language. Deliberately narrow:
   an unrelated Founder fact changing must not invalidate a hundred prospect
   workspaces, so the founder half is exactly the fields the prompt actually
   receives and nothing else. */

/** Stable stringify: key order can never change the hash. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

/** The signal fields that change meaning. `sourceUrl` is included because a
 * claim's source is part of the claim; `detail` because it is the sentence the
 * model is shown. */
function fingerprintableSignal(signal) {
  return {
    id: signal.signalId,
    v: signal.signalVersion ?? 1,
    k: signal.kind,
    e: signal.evidenceStatus,
    c: signal.confidence,
    s: signal.sourceUrl || signal.sourceReference || null,
    t: signal.checkedAt,
    val: signal.value || {},
    d: signal.detail,
  };
}

/**
 * @param {function} hash async (string) => hex digest. Injected so this module
 *   stays pure — Deno and Node reach WebCrypto differently and neither belongs
 *   in domain code.
 */
export async function buildInputFingerprint({
  prospect, ranking, founderContext, decision = null, modelName = null, hash, contact = null,
}) {
  const material = {
    /* PRODUCT VERSIONS. A contract or policy change makes old prose obsolete
       by definition. The model identity is included because a different model
       is a different writer. */
    contractVersion: PROSPECT_INTELLIGENCE_CONTRACT_VERSION,
    policyVersion: PROSPECT_LANGUAGE_POLICY_VERSION,
    model: modelName || null,

    /* PROSPECT. Identity, every structured signal, and the durable state that
       changes what should be said. */
    prospect: {
      id: prospect?.id || null,
      name: prospect?.name || null,
      category: prospect?.category || null,
      location: prospect?.address || prospect?.location || null,
      state: prospect?.state || null,
      channels: [...(prospect?.contactChannels || [])].sort(),
      signals: (prospect?.signals || []).map(fingerprintableSignal)
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
      contactHistory: (prospect?.contactHistory || []).map((event) => ({
        c: event.channel, o: event.outcome, at: event.at,
      })).sort((a, b) => String(a.at).localeCompare(String(b.at))),
    },

    /* RANKING, as the durable artifact. */
    ranking: ranking ? {
      dimensions: ranking.dimensions || {},
      qualified: ranking.qualified === true,
      qualification: ranking.qualification || {},
    } : null,

    /* FOUNDER — ONLY what the prompt is given. Adding the whole ledger here
       would mean any unrelated answer the founder gives invalidates every
       cached workspace they own. */
    founder: {
      businessName: founderContext?.businessName || null,
      offer: founderContext?.offer || null,
      offerConfirmed: founderContext?.offerConfirmed === true,
      targetCustomer: founderContext?.targetCustomer || null,
      currentObjective: founderContext?.currentObjective || null,
      currentBottleneck: founderContext?.currentBottleneck || null,
      trustedClaims: founderContext?.trustedClaims || {},
    },

    /* WHO WE WOULD BE TALKING TO, and ONLY WHEN THERE IS SOMEBODY. The script
       now ranks objections and picks a commitment from the contact's kind and
       role, so prose written before a contact was found is stale once one is:
       "send the audit over" is the wrong close for a generic inbox that needs
       an introduction instead.

       ADDED CONDITIONALLY ON PURPOSE. Emitting `contact: null` for every
       prospect would change the canonical material for every row ever cached
       and invalidate the lot — paying a model call each to regenerate prose
       that has not changed. A prospect with no contact keeps the exact
       fingerprint it had before this field existed. Identity only: the
       address itself is not here, because a re-verified address is not a
       reason to rewrite the script. */
    ...(contact && (contact.kind || contact.role)
      ? { contact: { kind: contact.kind || null, role: contact.role || null } }
      : {}),

    /* THE DECIDED ACTION. Language is written FOR an action; if the action
       changes, prose written for the old one is wrong even when every input
       behind it looks the same. */
    decision: decision ? { action: decision.action, channel: decision.channel } : null,
  };
  return hash(canonical(material));
}

/* ── TEMPORAL VALIDITY ───────────────────────────────────────────────────
   `now` is deliberately NOT in the fingerprint — it would mint a new key every
   second and the cache would never hit. Time is handled as an explicit
   expiry derived from what the language actually claims. */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long this language may remain authoritative.
 *
 * The binding constraint is whichever runs out first: the urgency the copy
 * asserts, or the freshness of the evidence under it. Language that says
 * "you have got about an hour" must not still be served tomorrow.
 */
export function deriveValidUntil({ decision, freshness, now }) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return null;

  const byUrgency = {
    /* Bounded by the same window that produced the claim, so the copy and the
       decision expire together. */
    within_the_hour: LIVE_INTENT_WINDOW_MS,
    this_week: 7 * DAY_MS,
    before_contact: 3 * DAY_MS,
    not_now: 7 * DAY_MS,
  }[decision?.urgency] ?? DAY_MS;

  /* Never outlive the evidence. */
  const staleAfterMs = Number.isFinite(freshness?.staleAfterMs) ? freshness.staleAfterMs : 30 * DAY_MS;
  const latestMs = Date.parse(freshness?.latestCheckedAt);
  const evidenceDeadline = Number.isFinite(latestMs) ? (latestMs + staleAfterMs) - nowMs : staleAfterMs;

  const lifetime = Math.max(0, Math.min(byUrgency, evidenceDeadline));
  return new Date(nowMs + lifetime).toISOString();
}

/* ── THE AUTHORITY RULE ──────────────────────────────────────────────────
   Everything above is a pre-filter. This is the gate. */

/**
 * Decides whether cached language may be used, having already been given the
 * CURRENT context, selection and decision — all recomputed by the caller.
 *
 * @returns {{usable: boolean, status: string, reason: string|null, language: object|null}}
 */
export function resolveCachedLanguage({
  cached, currentFingerprint, context, selection, decision, now = new Date().toISOString(),
}) {
  if (!cached || !cached.languageJson) {
    return { usable: false, status: CACHE_STATUS.MISS_GENERATED, reason: 'no_cached_language', language: null };
  }
  if (cached.inputFingerprint !== currentFingerprint) {
    return { usable: false, status: CACHE_STATUS.MISS_GENERATED, reason: 'inputs_changed', language: null };
  }
  if (cached.policyVersion !== PROSPECT_LANGUAGE_POLICY_VERSION
    || cached.contractVersion !== PROSPECT_INTELLIGENCE_CONTRACT_VERSION) {
    return { usable: false, status: CACHE_STATUS.INVALID_REGENERATED, reason: 'policy_version_changed', language: null };
  }
  const validUntilMs = Date.parse(cached.validUntil);
  if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.parse(now)) {
    return { usable: false, status: CACHE_STATUS.EXPIRED_REGENERATED, reason: 'expired', language: null };
  }

  /* Shape first, then grounding — both against CURRENT reality, exactly as a
     fresh generation would be judged. This is the step that makes an edited
     cache row harmless: it has to be true now, not merely stored. */
  const shape = validateProspectLanguage(cached.languageJson);
  if (!shape.valid) {
    return { usable: false, status: CACHE_STATUS.INVALID_REGENERATED, reason: `malformed:${shape.errors[0]}`, language: null };
  }
  const grounded = groundProspectLanguage({ language: cached.languageJson, context, decision, selection });
  if (!grounded.valid) {
    return {
      usable: false,
      status: CACHE_STATUS.INVALID_REGENERATED,
      reason: grounded.violations.map((violation) => violation.code)[0] || 'grounding_failed',
      language: null,
    };
  }
  return { usable: true, status: CACHE_STATUS.HIT, reason: null, language: cached.languageJson };
}

/**
 * Should this generation be written to the cache?
 *
 * Deterministic fallback is NEVER stored. It is what VISION says when the
 * model is unavailable, and persisting it would let a two-minute outage pin
 * the weaker language in place until something unrelated changed the
 * fingerprint. A miss that regenerates next time is the cheaper mistake.
 */
export function shouldCache(synthesisSource) {
  return synthesisSource === 'model' || synthesisSource === 'model_repaired';
}

/** The language source label once cache provenance is included. */
export function languageSourceLabel({ synthesisSource, fromCache }) {
  if (!fromCache) return synthesisSource;
  return synthesisSource === 'model_repaired' ? 'cached_model_repaired' : 'cached_model';
}

export const CACHE_INTERNALS = Object.freeze({ canonical, fingerprintableSignal, HOUR_MS, DAY_MS });
