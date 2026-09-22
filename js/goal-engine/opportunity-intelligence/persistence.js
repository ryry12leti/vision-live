/* Canonical Lead Intelligence persistence service.
   Every read or write against the eleven opportunity_* tables goes through
   this module -- no other file (Edge Function, UI, or Founder module)
   queries those tables directly. This module owns zero business logic: it
   never scores, ranks, deduplicates or decides eligibility. It only
   translates between the in-memory "opportunity" shape the pure functions
   in funnel.js/ranking.js/eligibility.js/memory.js already operate on, and
   the durable rows the 20260802130000 migration's RPCs persist. Every
   function takes an authenticated `client` (a Supabase client created with
   the CALLER's own JWT, never a service-role client) so every operation
   genuinely runs as that user and is subject to RLS + the RPCs' own
   auth.uid() ownership checks -- this module adds no trust of its own. */

import { stableEntityIdentityKey } from './deduplication.js';

function unwrap(result, action) {
  if (result.error) throw new Error(`${action}_failed:${result.error.message || result.error.code || 'unknown'}`);
  return result.data;
}

/** Finds the caller's own active (non-archived) venture of a given role by
 * calling the real, already-existing list_founder_ventures_v1() RPC --
 * never a client-supplied venture id treated as ground truth. Returns null
 * if the caller has no such venture yet. */
export async function resolveActiveVenture(client, { role = 'primary' } = {}) {
  const result = await client.rpc('list_founder_ventures_v1');
  const rows = unwrap(result, 'list_founder_ventures') || [];
  const match = rows.find((row) => row.venture_role === role && row.status !== 'archived');
  if (!match) return null;
  return { ventureId: match.venture_id, ventureRole: match.venture_role, ventureLifecycleStatus: match.status, name: match.venture_name || null };
}

/** Creates the caller's first venture of a given role. Thin wrapper over
 * create_founder_venture_v1 -- this is pure create (see the RPC's own
 * comment), so callers must call resolveActiveVenture() first and only
 * fall back to this when it returns null. */
export async function createVenture(client, { ventureId, role = 'primary', name = null }) {
  const result = await client.rpc('create_founder_venture_v1', {
    p_venture_id: ventureId, p_venture_role: role, p_venture_name: name,
  });
  return unwrap(result, 'create_founder_venture');
}

export function candidateToPersistableOpportunity(candidate) {
  const externalIdentityKey = stableEntityIdentityKey(candidate);
  if (!externalIdentityKey) throw new Error('opportunity_missing_identity_key');
  return {
    name: candidate.name, category: candidate.category || null, provider: candidate.provider || null,
    externalProviderId: candidate.externalProviderId || null, externalIdentityKey,
    location: candidate.address ? { label: candidate.address } : {},
    officialWebsite: candidate.officialWebsite || null, publicPhone: candidate.publicPhone || null,
    publicEmail: candidate.publicEmail || null, contactFormUrl: candidate.contactFormUrl || null,
    publicSocialProfiles: candidate.publicSocialUrl ? [candidate.publicSocialUrl] : [],
    bookingUrl: candidate.bookingUrl || null, mapUrl: candidate.mapUrl || null,
    lastCheckedAt: candidate.lastCheckedAt || null,
    sources: (candidate.sources || []).map((source) => ({ type: source.type, url: source.url })),
    observations: (candidate.observations || []).map((observation) => ({
      sourceUrl: observation.sourceUrl, observation: observation.observation, evidenceStatus: observation.evidenceStatus,
      confidence: observation.confidence, researchMethod: observation.researchMethod, checkedAt: observation.checkedAt,
    })),
    // The FULL ranking artifact. provenance and qualification were previously
    // dropped, and assertRankingShape() requires both -- so every lead reloaded
    // from the database failed eligibility and no saved prospect could ever
    // produce a Founder task.
    ranking: candidate.ranking ? {
      qualified: candidate.ranking.qualified === true,
      explanation: candidate.ranking.explanation || '',
      dimensions: candidate.ranking.dimensions || {},
      provenance: candidate.ranking.provenance || {},
      qualification: candidate.ranking.qualification || {},
    } : { qualified: false, explanation: '', dimensions: {}, provenance: {}, qualification: {} },
  };
}

/** Persists one funnel run's discovered/ranked opportunities atomically via
 * opportunity_search_persist_v1. `idempotencyKey` must be stable for a
 * given logical search attempt (the caller should reuse the same key across
 * a client-side retry of the SAME request, and a fresh key for a genuinely
 * new search) so a network retry can never duplicate a search run. */
/* ── WHO IS ALLOWED TO AUTHOR RESEARCH ────────────────────────────────
   Practice grounds a founder's claims on the OBSERVED rows these three
   functions write, so a founder able to call them directly could author the
   evidence they are judged against. The RPCs are now revoked from
   `authenticated` and reachable only by the service role, through trusted
   wrappers that take a server-verified user id.

   `expectedUserId` is that id. It is resolved by the Edge Function from the
   caller's own JWT, under RLS, BEFORE any service-role client is used -- it
   is never read from a request body. Passing it selects the trusted wrapper;
   omitting it keeps the original call, which now only a service-role caller
   could make anyway.

   Nothing about the payload changes. Source, confidence, evidence status,
   research method and checked-at are written exactly as before, and the
   inner function's own venture-ownership check still runs. */
const trusted = (name, expectedUserId) => (expectedUserId ? `${name}_trusted_v1` : `${name}_v1`);

export async function persistSearchRun(client, {
  ventureId, search, opportunities, idempotencyKey, counts = null, providerMetadata = null, providerFailures = null,
  expectedUserId = null,
}) {
  if (!ventureId) throw new Error('ventureId_required');
  if (!idempotencyKey) throw new Error('idempotencyKey_required');
  const payload = (opportunities || []).map(candidateToPersistableOpportunity);
  const result = await client.rpc(trusted('opportunity_search_persist', expectedUserId), {
    ...(expectedUserId ? { p_expected_user_id: expectedUserId } : {}),
    p_venture_id: ventureId,
    p_search: {
      purpose: search?.purpose || null,
      status: search?.status || 'completed',
      searchContext: {
        mode: search?.location?.mode || null,
        scope: search?.location?.scope || search?.location?.mode || null,
        targetCustomer: search?.targetCustomer || null,
        counts: counts || null,
      },
      interpretedLocation: search?.location || {},
      // The real funnel counts, so a run that discovered 20 and qualified 0 is
      // recorded as exactly that instead of silently as "discovered 0".
      discoveredCount: Number.isInteger(counts?.discovered) ? counts.discovered : (payload.length || 0),
      qualifiedCount: Number.isInteger(counts?.qualified) ? counts.qualified : null,
      providerCostMetadata: {
        counts: counts || {},
        providers: Array.isArray(providerMetadata) ? providerMetadata : [],
        providerFailures: Array.isArray(providerFailures) ? providerFailures : [],
      },
    },
    p_opportunities: payload,
    p_idempotency_key: idempotencyKey,
  });
  return unwrap(result, 'opportunity_search_persist');
}

/** The durable form of one structured signal. Mirrors signals.js exactly —
 * this is a serialisation, not a second model of evidence. */
export function signalToPersistable(signal) {
  return {
    signalId: signal.signalId,
    signalVersion: Number.isInteger(signal.signalVersion) ? signal.signalVersion : 1,
    kind: signal.kind,
    evidenceStatus: signal.evidenceStatus,
    confidence: signal.confidence,
    sourceUrl: signal.sourceUrl || null,
    sourceReference: signal.sourceReference || null,
    sourceType: signal.sourceType,
    researchMethod: signal.researchMethod,
    checkedAt: signal.checkedAt,
    value: signal.value && typeof signal.value === 'object' ? signal.value : {},
    detail: signal.detail,
  };
}

/**
 * Persists the structured evidence for ONE already-persisted opportunity.
 *
 * A second call rather than a field on opportunity_search_persist_v1: that
 * RPC's contract is in use and extending it would change behaviour for every
 * existing caller, whereas this is purely additive. The entity is addressed by
 * its stable external identity key because that is the only handle the caller
 * still holds after the search persist — the RPC resolves it to an owned
 * opportunity id itself and refuses anything that is not the caller's.
 *
 * Idempotent by (opportunity, signalId, version): re-persisting a rediscovered
 * business does not duplicate its evidence.
 */
export async function persistOpportunitySignals(client, { ventureId, externalIdentityKey, signals, expectedUserId = null }) {
  if (!ventureId) throw new Error('ventureId_required');
  if (!externalIdentityKey) throw new Error('externalIdentityKey_required');
  const payload = (signals || []).map(signalToPersistable);
  if (payload.length === 0) return { status: 'ok', inserted: 0 };
  const result = await client.rpc(trusted('opportunity_signals_persist', expectedUserId), {
    ...(expectedUserId ? { p_expected_user_id: expectedUserId } : {}),
    p_venture_id: ventureId,
    p_external_identity_key: externalIdentityKey,
    p_signals: payload,
  });
  return unwrap(result, 'opportunity_signals_persist');
}

/** Persists every ranked candidate's signals after a search run. Best-effort
 * per candidate so one malformed business cannot cost the whole run its
 * evidence; the caller receives the per-candidate outcome. */
export async function persistSearchRunSignals(client, { ventureId, opportunities, expectedUserId = null }) {
  const results = [];
  for (const candidate of opportunities || []) {
    const externalIdentityKey = stableEntityIdentityKey(candidate);
    if (!externalIdentityKey || !(candidate.signals || []).length) continue;
    try {
      const outcome = await persistOpportunitySignals(client, {
          ventureId, externalIdentityKey, signals: candidate.signals, expectedUserId });
      results.push({ externalIdentityKey, ...outcome });
    } catch (error) {
      results.push({ externalIdentityKey, status: 'failed', reason: String(error?.message || 'unknown').slice(0, 120) });
    }
  }
  return results;
}

export async function recordDecision(client, { ventureId, opportunityId, action, reason = null, correction = null }) {
  const result = await client.rpc('opportunity_lead_decision_v1', {
    p_venture_id: ventureId, p_opportunity_id: opportunityId, p_decision: action, p_reason: reason, p_correction: correction,
  });
  return unwrap(result, 'opportunity_lead_decision');
}

export async function persistContactEvent(client, {
  ventureId, opportunityId, campaignId = null, channel, outcome, exactSource,
  originalWording = null, responseUsed = null, confidence = 1, occurredAt = null,
}) {
  const result = await client.rpc('opportunity_contact_event_record_v1', {
    p_venture_id: ventureId, p_opportunity_id: opportunityId, p_campaign_id: campaignId, p_channel: channel,
    p_outcome: outcome, p_exact_source: exactSource, p_original_wording: originalWording,
    p_response_used: responseUsed, p_confidence: confidence, p_occurred_at: occurredAt || new Date().toISOString(),
  });
  return unwrap(result, 'opportunity_contact_event_record');
}

export async function saveSalesPracticeScore(client, { ventureId, score, failedCategories = [] }) {
  const result = await client.rpc('opportunity_sales_practice_score_save_v1', {
    p_venture_id: ventureId, p_score: score, p_failed_categories: failedCategories,
  });
  return unwrap(result, 'opportunity_sales_practice_score_save');
}

/** Reshapes durable rows back into exactly the in-memory "opportunity"
 * object the existing pure functions (evaluateOpportunityEligibility,
 * applyOpportunityDecision, rankOpportunity's own output shape) already
 * consume -- so Lead Intelligence's already-audited business logic runs
 * unchanged whether its input came from a fixture, an ephemeral draft, or a
 * durable database row. Pure function: exported separately from the
 * network calls above so it is unit-testable without a database. */
export function reshapeVentureLeads({ entities, sources, observations, rankings, approvals, contactEvents, signals, ventureId, userId, ventureRole, ventureLifecycleStatus }) {
  /* Structured evidence, restored to exactly the shape signals.js produced.
     Nothing is re-derived and nothing is parsed out of prose — each row is
     the signal that was built at research time, stored and handed back. */
  const signalsByEntity = new Map();
  for (const row of signals || []) {
    if (!signalsByEntity.has(row.opportunity_id)) signalsByEntity.set(row.opportunity_id, []);
    signalsByEntity.get(row.opportunity_id).push({
      signalId: row.signal_id,
      signalVersion: row.signal_version,
      kind: row.kind,
      evidenceStatus: row.evidence_status,
      confidence: Number(row.confidence),
      sourceUrl: row.source_url || null,
      sourceReference: row.source_reference || null,
      sourceType: row.source_type,
      researchMethod: row.research_method,
      checkedAt: row.checked_at,
      value: row.value && typeof row.value === 'object' ? row.value : {},
      detail: row.detail,
    });
  }

  const sourcesByEntity = new Map();
  for (const source of sources || []) {
    if (!sourcesByEntity.has(source.opportunity_id)) sourcesByEntity.set(source.opportunity_id, []);
    sourcesByEntity.get(source.opportunity_id).push(source);
  }
  const observationsByEntity = new Map();
  for (const observation of observations || []) {
    if (!observationsByEntity.has(observation.opportunity_id)) observationsByEntity.set(observation.opportunity_id, []);
    observationsByEntity.get(observation.opportunity_id).push(observation);
  }
  const latestRankingByEntity = new Map();
  for (const ranking of rankings || []) {
    const existing = latestRankingByEntity.get(ranking.opportunity_id);
    if (!existing || new Date(ranking.ranked_at) > new Date(existing.ranked_at)) latestRankingByEntity.set(ranking.opportunity_id, ranking);
  }
  const historyByEntity = new Map();
  for (const approval of approvals || []) {
    if (!historyByEntity.has(approval.opportunity_id)) historyByEntity.set(approval.opportunity_id, []);
    historyByEntity.get(approval.opportunity_id).push({ to: approval.decision, reason: approval.reason, correction: approval.correction, at: approval.decided_at });
  }
  const contactHistoryByEntity = new Map();
  for (const event of contactEvents || []) {
    if (!contactHistoryByEntity.has(event.opportunity_id)) contactHistoryByEntity.set(event.opportunity_id, []);
    contactHistoryByEntity.get(event.opportunity_id).push({
      channel: event.channel, outcome: event.outcome, exactSource: event.exact_source, originalWording: event.original_wording,
      confidence: event.structured_confidence, responseUsed: event.response_used, at: event.occurred_at,
    });
  }

  return (entities || []).map((entity) => {
    const entityObservations = (observationsByEntity.get(entity.id) || []).map((observation) => ({
      sourceUrl: (sourcesByEntity.get(entity.id) || []).find((source) => source.id === observation.source_id)?.source_url || null,
      observation: observation.exact_observation, evidenceStatus: observation.evidence_status,
      confidence: Number(observation.confidence), researchMethod: observation.research_method, checkedAt: observation.checked_at,
    }));
    const ranking = latestRankingByEntity.get(entity.id);
    const contactChannels = [entity.public_phone && 'call', entity.public_email && 'email', entity.contact_form_url && 'website_form', Array.isArray(entity.public_social_profiles) && entity.public_social_profiles.length > 0 && 'public_social'].filter(Boolean);
    return {
      id: entity.id, name: entity.name, category: entity.category, address: entity.location?.label || null,
      officialWebsite: entity.official_website, publicPhone: entity.public_phone, publicEmail: entity.public_email,
      contactFormUrl: entity.contact_form_url, mapUrl: entity.map_url, bookingUrl: entity.booking_url,
      state: entity.current_state, rejectionReason: entity.rejection_reason, correction: entity.correction,
      lastCheckedAt: entity.last_checked_at, ventureId, userId, ventureRole, ventureLifecycleStatus,
      observations: entityObservations, contactChannels,
      /* THE FIELD ranking.js AND PROSPECT INTELLIGENCE ACTUALLY READ. Before
         opportunity_signals existed this key was simply absent, so every
         reloaded lead arrived with no evidence, no timeline and unknown
         freshness — which resolved every saved prospect to "refresh
         evidence" and left the workspace empty. */
      signals: signalsByEntity.get(entity.id) || [],
      ranking: ranking ? {
        qualified: ranking.qualified,
        explanation: ranking.explanation,
        dimensions: { ...ranking.component_scores, opportunityScore: ranking.opportunity_score },
        provenance: ranking.provenance || {},
        qualification: ranking.qualification || {},
      } : null,
      history: (historyByEntity.get(entity.id) || []).sort((left, right) => new Date(left.at) - new Date(right.at)),
      contactHistory: (contactHistoryByEntity.get(entity.id) || []).sort((left, right) => new Date(left.at) - new Date(right.at)),
    };
  });
}

/** Loads every current lead for one venture and reshapes it. Uses separate,
 * explicitly venture-scoped selects rather than PostgREST embedded-resource
 * syntax, because the composite (id,user_id,founder_venture_id) foreign
 * keys this schema uses for cross-venture isolation are not always
 * auto-detected for embedding -- explicit selects are slower but never
 * silently wrong. Every select still relies on RLS (select-own policies)
 * for user isolation; the explicit .eq('founder_venture_id', ventureId)
 * additionally scopes it to one of the caller's (possibly two) ventures. */
/** @param {object} [context] userId / ventureRole / ventureLifecycleStatus.
 * evaluateOpportunityEligibility() checks all three (wrong_user_owner,
 * secondary_venture_blocked, active_primary_venture_required). They were never
 * passed through, so every reloaded lead failed those checks regardless of the
 * caller's actual ownership -- a second reason a saved lead could never
 * produce a Founder task. */
export async function loadVentureLeads(client, ventureId, context = {}) {
  const [entities, sources, observations, rankings, approvals, contactEvents, signals] = await Promise.all([
    client.from('opportunity_entities').select('*').eq('founder_venture_id', ventureId),
    client.from('opportunity_sources').select('*').eq('founder_venture_id', ventureId),
    client.from('opportunity_observations').select('*').eq('founder_venture_id', ventureId),
    client.from('opportunity_rankings').select('*').eq('founder_venture_id', ventureId),
    client.from('opportunity_approvals').select('*').eq('founder_venture_id', ventureId),
    client.from('opportunity_contact_events').select('*').eq('founder_venture_id', ventureId),
    client.from('opportunity_signals').select('*').eq('founder_venture_id', ventureId),
  ]);
  for (const [label, result] of [['entities', entities], ['sources', sources], ['observations', observations], ['rankings', rankings], ['approvals', approvals], ['contactEvents', contactEvents], ['signals', signals]]) {
    if (result.error) throw new Error(`load_${label}_failed:${result.error.message || result.error.code || 'unknown'}`);
  }
  return reshapeVentureLeads({
    entities: entities.data, sources: sources.data, observations: observations.data, rankings: rankings.data,
    approvals: approvals.data, contactEvents: contactEvents.data, signals: signals.data, ventureId,
    userId: context.userId, ventureRole: context.ventureRole, ventureLifecycleStatus: context.ventureLifecycleStatus,
  });
}

/* ── CONTACT INTELLIGENCE (L5B) ────────────────────────────────────────
   DELIBERATELY NOT PART OF loadVentureLeads. Contacts are loaded for ONE
   prospect, in the Workspace path only, and never join the lead object the
   board and ranking consume. That is the strongest available guarantee
   that contact quality cannot contaminate prospect quality: the scoring
   path does not merely ignore these rows, it never receives them. */
function reshapeContactRow(row) {
  return {
    contactId: row.contact_id, opportunityId: row.opportunity_id,
    channel: row.channel, value: row.value, normalizedValue: row.normalized_value,
    personName: row.person_name, personRole: row.person_role, contactKind: row.contact_kind,
    provider: row.provider, verificationStatus: row.verification_status,
    confidence: row.confidence === null ? null : Number(row.confidence),
    sources: Array.isArray(row.sources) ? row.sources : [],
    firstSeenAt: row.first_seen_at, lastCheckedAt: row.last_checked_at,
  };
}

/** Durable contacts for ONE owned opportunity. RLS-scoped to the caller;
 *  the extra venture/opportunity filters make a cross-venture row
 *  unreachable even if a policy were ever loosened. */
export async function loadOpportunityContacts(client, ventureId, opportunityId) {
  const result = await client.from('opportunity_contacts').select('*')
    .eq('founder_venture_id', ventureId).eq('opportunity_id', opportunityId);
  if (result.error) throw new Error(`load_contacts_failed:${result.error.message || result.error.code || 'unknown'}`);
  return (result.data || []).map(reshapeContactRow);
}

/** The record of whether we have ALREADY LOOKED, and what happened.
 *  Without reading this, a domain that publishes no contacts is
 *  indistinguishable from one nobody has searched — and every request
 *  re-asks the provider to re-learn the same nothing. Measured live: the
 *  second call to a barren domain went straight back out to Hunter. */
export async function loadOpportunityContactLookup(client, ventureId, opportunityId, provider = 'hunter') {
  const result = await client.from('opportunity_contact_lookups').select('*')
    .eq('founder_venture_id', ventureId).eq('opportunity_id', opportunityId).eq('provider', provider);
  if (result.error) throw new Error(`load_contact_lookup_failed:${result.error.message || result.error.code || 'unknown'}`);
  const row = (result.data || [])[0];
  if (!row) return null;
  return {
    provider: row.provider, outcome: row.outcome, foundCount: row.found_count,
    reason: row.reason, lookedAt: row.looked_at,
  };
}

/** Idempotent by (opportunity, channel, normalized value) inside the RPC:
 *  re-enriching the same business updates its contacts rather than
 *  appending duplicates. */
/* ── WHY-NOW SIGNALS ──────────────────────────────────────────────────
   A SEPARATE STORE FROM opportunity_signals, and the separation is the point:
   nothing loaded here reaches ranking.js or priority-intelligence.js, so a
   dated external event can explain a good prospect without being able to
   create one. See the migration header for why writing these as ordinary
   signals would forge evidence freshness rather than express an event date. */
export async function loadOpportunityWhyNowSignals(client, ventureId, opportunityId) {
  const result = await client.from('opportunity_why_now_signals').select('*')
    .eq('founder_venture_id', ventureId).eq('opportunity_id', opportunityId);
  if (result.error) throw new Error(`load_why_now_failed:${result.error.message || result.error.code || 'unknown'}`);
  return (result.data || []).map((row) => ({
    claim: row.claim,
    excerpt: row.excerpt || null,
    sourceUrl: row.source_url,
    sourceHost: row.source_host || null,
    publishedAt: row.published_at,
    category: row.category,
    entityConfidence: row.entity_confidence === null ? null : Number(row.entity_confidence),
    entityBasis: row.entity_basis || null,
    provider: row.provider,
    checkedAt: row.checked_at,
  }));
}

export async function persistOpportunityWhyNowSignals(client, { ventureId, opportunityId, signals, expectedUserId = null }) {
  if (!ventureId) throw new Error('ventureId_required');
  if (!opportunityId) throw new Error('opportunityId_required');
  const payload = (signals || []).map((s) => ({
    claim: s.claim, excerpt: s.excerpt ?? null,
    sourceUrl: s.sourceUrl, sourceHost: s.sourceHost ?? null,
    publishedAt: s.publishedAt, category: s.category,
    entityConfidence: s.entityConfidence ?? null, entityBasis: s.entityBasis ?? null,
    provider: s.provider || 'exa',
  }));
  if (payload.length === 0) return { status: 'ok', written: 0 };
  const result = await client.rpc(trusted('opportunity_why_now_persist', expectedUserId), {
    ...(expectedUserId ? { p_expected_user_id: expectedUserId } : {}),
    p_venture_id: ventureId, p_opportunity_id: opportunityId, p_signals: payload,
  });
  return unwrap(result, 'opportunity_why_now_persist');
}

export async function persistOpportunityContacts(client, { ventureId, opportunityId, contacts }) {
  if (!ventureId) throw new Error('ventureId_required');
  if (!opportunityId) throw new Error('opportunityId_required');
  const payload = (contacts || []).map((contact) => ({
    channel: contact.channel, value: contact.value, normalizedValue: contact.normalizedValue,
    personName: contact.personName ?? null, personRole: contact.personRole ?? null,
    contactKind: contact.contactKind, provider: contact.provider,
    verificationStatus: contact.verificationStatus,
    confidence: contact.confidence ?? null, sources: contact.sources || [],
  }));
  if (payload.length === 0) return { status: 'ok', written: 0 };
  const result = await client.rpc('opportunity_contacts_persist_v1', {
    p_venture_id: ventureId, p_opportunity_id: opportunityId, p_contacts: payload,
  });
  return unwrap(result, 'opportunity_contacts_persist');
}

export async function loadSalesPracticeScore(client, ventureId) {
  const result = await client.from('opportunity_campaigns').select('sales_practice_score, status')
    .eq('founder_venture_id', ventureId).in('status', ['draft', 'sales_practice_locked', 'active', 'paused']).limit(1);
  if (result.error) throw new Error(`load_sales_practice_score_failed:${result.error.message || result.error.code || 'unknown'}`);
  const row = result.data?.[0];
  return row ? { score: row.sales_practice_score, locked: (row.sales_practice_score ?? 0) < 40 } : null;
}

/* ── PROSPECT LANGUAGE CACHE ─────────────────────────────────────────────
   Prose in, prose out. Neither of these functions knows or cares whether the
   language is any good — that is decided by the grounding validator on every
   read, in prospect-runtime.js. */

/** The caller's cached language for one owned opportunity, or null. Read
 * directly and RLS-scoped, so another user's row is not merely filtered out —
 * it is unreadable. */
export async function loadProspectLanguageCache(client, { ventureId, opportunityId }) {
  const result = await client.from('prospect_language_cache').select('*')
    .eq('founder_venture_id', ventureId).eq('opportunity_id', opportunityId).limit(1);
  if (result.error) throw new Error(`load_prospect_language_cache_failed:${result.error.message || result.error.code || 'unknown'}`);
  const row = result.data?.[0];
  if (!row) return null;
  return {
    inputFingerprint: row.input_fingerprint,
    contractVersion: row.contract_version,
    policyVersion: row.language_policy_version,
    modelName: row.model_name,
    synthesisSource: row.synthesis_source,
    languageJson: row.language_json,
    generatedAt: row.generated_at,
    validUntil: row.valid_until,
    usageMetadata: row.usage_metadata || {},
  };
}

/** Writes the current grounded language. Only ever called AFTER grounding
 * succeeded; the RPC additionally refuses any synthesis source that is not
 * model/model_repaired, so a fallback cannot be stored even by mistake. */
export async function saveProspectLanguageCache(client, {
  ventureId, opportunityId, inputFingerprint, contractVersion, policyVersion,
  modelName, synthesisSource, language, generatedAt, validUntil, usage = {},
}) {
  const result = await client.rpc('prospect_language_cache_upsert_v1', {
    p_venture_id: ventureId,
    p_opportunity_id: opportunityId,
    p_input_fingerprint: inputFingerprint,
    p_contract_version: contractVersion,
    p_language_policy_version: policyVersion,
    p_model_name: modelName,
    p_synthesis_source: synthesisSource,
    p_language: language,
    p_generated_at: generatedAt,
    p_valid_until: validUntil,
    p_usage: usage,
  });
  return unwrap(result, 'prospect_language_cache_upsert');
}
