/* ════════════════════════════════════════════════════════════════════════
   PROSPECT INTELLIGENCE RUNTIME — the two boundaries and the orchestrator
   ────────────────────────────────────────────────────────────────────────
   L1 is pure and knows nothing about databases. The Edge Function knows about
   databases and should know nothing about sales reasoning. This module is the
   seam, and it is deliberately pure JavaScript so the whole runtime can be
   tested in Node against fixtures — the Edge Function supplies rows and an
   HTTP-calling function, nothing else.

   TWO ADAPTERS, ONE ORCHESTRATOR:

     founderStateFromLedger()      canonical founder_venture_facts -> L1 ventureState
     prospectFromPersistedLead()   a reloaded opportunity          -> L1 prospect
     runProspectIntelligence()     both, plus the model, plus the validator

   NOTHING HERE DECIDES ANYTHING. Ranking, qualification, selection, the next
   action, evidence status and consent all remain where they already were.
   This module moves data across a boundary and calls things in order.
   ════════════════════════════════════════════════════════════════════════ */

import { buildProspectIntelligence, buildSelectionRationale, decideNextBestAction } from './prospect-intelligence.js';
import { buildProspectContext } from './prospect-context.js';
import {
  buildInputFingerprint, resolveCachedLanguage, deriveValidUntil, shouldCache,
  languageSourceLabel, PROSPECT_LANGUAGE_POLICY_VERSION, CACHE_STATUS,
} from './prospect-language-cache.js';
import { PROSPECT_INTELLIGENCE_CONTRACT_VERSION } from './prospect-intelligence-contract.js';
import { toLeadViewModel } from './workspace-view-model.js';
import { TRUSTED_FACT_STATUSES } from './prospect-context.js';

/* Keys that are NOT facts. The ledger uses these prefixes for questions that
   are still open — a value the founder half-said, or one VISION could not
   resolve. Staging holds live examples of both, always with zero confirmed
   rows. They exist to drive the interview, and a sentence built from one would
   be a sentence the founder never actually agreed to. */
const NON_FACT_KEY_PREFIXES = ['pendingFact:', 'unresolvedFact:'];

function isRealFactKey(key) {
  return typeof key === 'string'
    && key.length > 0
    && !NON_FACT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function factKeyOf(fact) {
  return typeof fact?.factKey === 'string' ? fact.factKey
    : (typeof fact?.key === 'string' ? fact.key : null);
}

/* The ledger stores jsonb, so a value may be a string, an object or an array.
   Only a string is safe to hand to a model as prose; the rest are summarised
   through a named extractor per key rather than JSON.stringify'd into a
   sentence nobody wrote. */
function scalarText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/**
 * Canonical Founder ledger -> the bounded ventureState L1 consumes.
 *
 * @param {object[]} facts rows already reshaped by the caller (factKey, value,
 *   verificationStatus, sourceReference, active).
 */
export function founderStateFromLedger(facts, { ventureId, ventureName = null } = {}) {
  const usable = (facts || []).filter((fact) => fact
    && fact.active !== false
    && isRealFactKey(factKeyOf(fact)));

  /* Latest wins on a duplicate key. The ledger deactivates a superseded fact,
     so an active duplicate is a re-statement rather than a contradiction. */
  const byKey = new Map();
  for (const fact of usable) {
    const key = factKeyOf(fact);
    const existing = byKey.get(key);
    if (!existing || Date.parse(fact.recordedAt || 0) >= Date.parse(existing.recordedAt || 0)) byKey.set(key, fact);
  }
  const get = (key) => byKey.get(key) || null;
  const trusted = (fact) => Boolean(fact) && TRUSTED_FACT_STATUSES.includes(fact.verificationStatus) && fact.active !== false;

  const offerFact = get('offer');
  const offerText = offerFact ? scalarText(offerFact.value) : null;

  /* SERVER-SIDE, AND ONLY FROM THE LEDGER. A request cannot assert this, and
     the mere existence of a string called "offer" is not enough: a
     provisional or disputed offer is something the founder mentioned, not
     something they committed to selling. Unconfirmed here means L1's
     deterministic decision stays clarify_offer, which is the honest outcome. */
  const offerConfirmed = Boolean(offerText) && trusted(offerFact);

  /* Canonical key -> the sensitive-claim vocabulary L1's grounding validator
     already checks against. Each extractor is explicit; there is no generic
     stringify, because the point of these is that they are the claims that
     become sentences a founder says to a customer. */
  const claimSources = {
    clientCount: {
      fact: get('customerEvidence'),
      read: (value) => (value && typeof value === 'object' && Number.isFinite(value.customerCount)
        ? `${value.customerCount} paying customer${value.customerCount === 1 ? '' : 's'}`
        : null),
    },
    pricing: {
      fact: get('offerPricing'),
      read: (value) => (value && typeof value === 'object' ? scalarText(value.notes) : scalarText(value)),
    },
    previousWork: {
      fact: get('completedWork'),
      read: (value) => (Array.isArray(value) ? value.map(scalarText).filter(Boolean).join('; ') || null : scalarText(value)),
    },
  };

  const facts_out = [];
  for (const [claimKey, source] of Object.entries(claimSources)) {
    if (!trusted(source.fact)) continue;
    const value = source.read(source.fact.value);
    if (!value) continue;
    facts_out.push({
      key: claimKey,
      value,
      verificationStatus: source.fact.verificationStatus,
      active: true,
      sourceReference: source.fact.sourceReference || `founder_fact:${factKeyOf(source.fact)}`,
    });
  }

  const targetCustomerFact = get('targetCustomer');
  const objectiveFact = get('immediateGoal');
  const bottleneckFact = get('currentBottleneck');
  const ideaFact = get('idea');

  return {
    ventureId,
    businessName: ventureName || null,
    /* Verbatim, never paraphrased. */
    offer: offerText,
    offerConfirmed,
    /* Read even when only provisional: knowing WHO the founder sells to shapes
       VISION's own reasoning and never becomes a claim about the founder. The
       sensitive claims above are the ones gated on trust. */
    targetCustomer: targetCustomerFact ? scalarText(targetCustomerFact.value) : null,
    /* WHAT THE OFFER ACTUALLY FIXES. Priority Intelligence has read this fact
       since it shipped; the language layer never had it, so the call opener
       led with whichever signal weighed most — for a business with a phone,
       "the published call route is an established way to open a conversation".
       True, and useless as an opening line to a founder selling booking
       funnels. Carried here so the script can lead with the gap it can close. */
    offerAddresses: (() => {
      const fact = get('offerAddresses');
      return Array.isArray(fact?.value) ? fact.value.map(scalarText).filter(Boolean) : [];
    })(),
    currentObjective: objectiveFact ? scalarText(objectiveFact.value) : null,
    currentBottleneck: bottleneckFact ? scalarText(bottleneckFact.value) : null,
    businessIdea: ideaFact ? scalarText(ideaFact.value) : null,
    founderLevel: null,
    facts: facts_out,
    /* Diagnostic only; never rendered. */
    ledgerSummary: {
      activeFactCount: usable.length,
      offerStatus: offerFact ? offerFact.verificationStatus : 'absent',
      excludedNonFactKeys: (facts || []).filter((fact) => !isRealFactKey(factKeyOf(fact))).length,
    },
  };
}

/* ── B2C STATE, DERIVED FROM DURABLE EVIDENCE ────────────────────────────
   NO NEW COLUMNS, AND NO MIGRATION. An earlier pass of this work concluded a
   second migration was needed to give lifecycle, identity and consent a
   durable home. That was wrong, and re-checking the constraint is what showed
   it: opportunity_signals.kind is length-bounded rather than an enum, and
   `value` is jsonb, so the evidence table already carries all three.

   It is also the better design. Whether somebody identified themselves, and
   what they consented to, are FACTS ABOUT EVENTS — they have a source, a
   timestamp and an evidence status. Putting them in columns would make them
   settings that something could write; leaving them as signals means they
   inherit the same provenance rules as every other piece of evidence, and a
   lifecycle stage can be rebuilt from them rather than stored twice and
   allowed to drift. */

function signalsOf(signals, kind) {
  return (signals || []).filter((signal) => signal?.kind === kind);
}
function latest(signals) {
  return [...signals].sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0] || null;
}

/** Is this an inbound consumer record or an outbound business one? Decided by
 * the evidence present, never by the request. */
export function deriveLeadType(signals) {
  const identity = latest(signalsOf(signals, 'identity'));
  if (identity?.value?.entityType === 'person') return 'b2c';
  if (identity?.value?.entityType === 'business') return 'b2b';
  /* No identity signal: first-party inbound evidence still means a consumer
     record, because those kinds only exist for people arriving at the
     founder's own property. */
  const inbound = ['inbound_activity', 'inbound_intent', 'consent']
    .some((kind) => signalsOf(signals, kind).length > 0);
  return inbound ? 'b2c' : 'b2b';
}

/** Consent, read from the structured value only. Never parsed out of prose —
 * a permission derived from wording is not a permission. */
export function deriveConsent(signals) {
  const signal = latest(signalsOf(signals, 'consent'));
  if (!signal) return null;
  const value = signal.value || {};
  const allowed = Array.isArray(value.allowedChannels) ? value.allowedChannels : [];
  /* CASE AND WHITESPACE ARE NOT A DIFFERENT ANSWER. `opportunity_signals.value`
     is free-form jsonb with no CHECK on consent status, so 'DECLINED' and
     ' declined' were both read as unrecognised. */
  const raw = typeof value.status === 'string' ? value.status.trim().toLowerCase() : '';
  const recognised = ['granted', 'declined', 'withdrawn', 'unknown'].includes(raw);
  return {
    status: recognised ? raw : 'unknown',
    /* AN UNREADABLE REFUSAL IS NOT "WE NEVER ASKED". Anything outside the
       vocabulary — 'opted_out', 'revoked', a typo — used to collapse to
       'unknown', and unknown is the one non-granted status that still permits a
       B2B approach. So the fact that we could not read it is carried
       separately, and every consumer treats it as a refusal. Failing closed on
       a consent record we do not understand is the only safe direction. */
    unrecognisedStatus: recognised ? null
      : (typeof value.status === 'string' && value.status.trim() ? value.status.trim().slice(0, 40) : null),
    allowedChannels: allowed,
    source: typeof value.source === 'string' ? value.source : (signal.sourceReference || null),
    grantedAt: signal.checkedAt,
  };
}

/**
 * The lifecycle stage, RECONSTRUCTED rather than stored. Storing it would mean
 * keeping a derived value beside the evidence it came from, and the two would
 * eventually disagree — which is exactly how an unidentified visitor ends up
 * labelled a hot lead.
 */
export function deriveLifecycle(signals, { qualified = false, state = null } = {}) {
  if (['converted', 'won'].includes(state)) return { stage: 'customer', identified: true };

  const identity = latest(signalsOf(signals, 'identity'));
  const identified = identity?.value?.identified === true;

  if (!identified) {
    /* Below the line. Returning or reading deeply is engagement, not identity;
       a click alone is neither. */
    const engaged = signalsOf(signals, 'inbound_intent').length > 0
      || signalsOf(signals, 'inbound_activity').length > 1;
    return { stage: engaged ? 'engaged' : 'anonymous', identified: false };
  }
  if (!qualified) return { stage: 'lead', identified: true };

  /* Hot needs live intent, not merely a fresh file. */
  const intent = latest(signalsOf(signals, 'inbound_intent'));
  const intentAgeMs = intent ? Date.now() - Date.parse(intent.checkedAt) : Infinity;
  const HOT_WINDOW_MS = 48 * 60 * 60 * 1000;
  return { stage: intentAgeMs <= HOT_WINDOW_MS ? 'hot_lead' : 'qualified_lead', identified: true };
}

/**
 * A reloaded opportunity -> the L1 prospect input.
 *
 * Pass-through by design: `signals` and `ranking` are the durable artefacts
 * and are handed on untouched. Nothing is re-derived, no observation is parsed
 * back into a signal, and no provider-shaped field crosses this line.
 */
export function prospectFromPersistedLead(lead, { leadType = null } = {}) {
  if (!lead || typeof lead !== 'object') throw new Error('prospect_runtime_requires_a_lead');
  const signals = Array.isArray(lead.signals) ? lead.signals : [];
  const resolvedType = leadType || deriveLeadType(signals);
  const lifecycle = deriveLifecycle(signals, { qualified: lead.ranking?.qualified === true, state: lead.state });
  const consent = deriveConsent(signals);
  return {
    whyNowSignals: Array.isArray(lead?.whyNowSignals) ? lead.whyNowSignals : [],
    id: lead.id,
    name: lead.name,
    category: lead.category || null,
    address: lead.address || null,
    /* DERIVED, NEVER ASSERTED. This was hardcoded to true, which meant a B2C
       visitor who never identified themselves arrived at L1 already flagged as
       identified — and resolveLifecycle()'s demotion rule, the one thing
       stopping an anonymous visitor being presented as a hot lead, could never
       fire. For a business, being a named public entity IS the identification.
       For a person it has to come from the durable record. */
    /* DERIVED FROM EVIDENCE. For a business, being a named public entity is
       the identification. For a person it requires an identity signal — which
       is what keeps an anonymous visitor from being promoted. */
    identified: resolvedType === 'b2b' ? Boolean(lead.name) : lifecycle.identified,
    /* Contact routes as the funnel observed them. */
    /* Entity columns UNION routes asserted by contactability evidence. The
       columns only describe a PUBLIC business listing; an inbound consumer's
       phone number arrives with their enquiry and lives in first-party
       evidence, so reading columns alone left a consented lead with no route
       and produced do_not_contact for someone who had just asked to be
       called. */
    contactChannels: [...new Set([
      ...(Array.isArray(lead.contactChannels) ? lead.contactChannels : []),
      ...signalsOf(signals, 'contactability')
        .filter((signal) => signal.evidenceStatus !== 'UNKNOWN' && typeof signal.value?.channel === 'string')
        .map((signal) => signal.value.channel),
    ])],
    /* The durable structured evidence. */
    signals: Array.isArray(lead.signals) ? lead.signals : [],
    /* AN UNKNOWN IS A SIGNAL, NOT A SEPARATE LIST — and that is what makes it
       durable. L1 accepts a plain `unknowns` array as a fixture convenience,
       but nothing persists such an array and nothing should: an open question
       recorded during research is evidence about what was looked for and not
       established, so it belongs in opportunity_signals with evidenceStatus
       UNKNOWN, where collectImportantUnknowns() already reads it.
       This pass-through exists only for the case where a caller supplies one
       in memory; a reloaded lead carries its unknowns inside `signals`. */
    unknowns: Array.isArray(lead.unknowns) ? lead.unknowns : [],
    priorContactChecked: Array.isArray(lead.contactHistory),
    alreadyContacted: (lead.contactHistory || []).length > 0,
    previouslyRejected: lead.state === 'rejected',
    /* Reconstructed each time from the signals, never read back from a stored
       copy. lifecycleStage stays B2C-only — it is the inbound-funnel idea. */
    ...(resolvedType === 'b2c' ? { lifecycleStage: lifecycle.stage } : {}),
    /* CONSENT IS ATTACHED FOR BOTH LEAD TYPES, and this is the fix for a real
       defect: it used to ride inside the B2C-only spread above, so for every
       B2B lead `prospect.consent` was undefined and resolveContactability
       defaulted the status to 'not_required'. Measured end to end — a B2B
       prospect carrying a WITHDRAWN consent signal was refused a paid contact
       lookup by the server and, in the same breath, told the founder to call
       them this week, with a script. VISION would not spend a cent finding a
       route to someone who said no, then recommended the route already on file.

       Attaching it does NOT make B2B stricter in general: resolveContactability
       keeps the B2B baseline of 'not_required' for every status except an
       explicit refusal, because a published business line needs no consent.
       Only 'declined', 'withdrawn' and a record we cannot read change
       anything. */
    consent,
    state: lead.state,
  };
}

/* ── DURABLE STATE -> THE LOCKED FRONTEND'S PIPELINE STAGES ──────────────
   Only mappings the backend can actually prove.

   `proposal` IS DELIBERATELY UNREACHABLE. The locked frontend draws a
   "Proposal out" column, and nothing in opportunity_entities.current_state or
   the contact-event vocabulary records that a proposal was sent. Inferring it
   from "interested" would be a guess rendered as a fact in a column a founder
   uses to decide who to chase. The column stays empty until something durable
   backs it. */
export const OPPORTUNITY_STATE_TO_PIPELINE = Object.freeze({
  discovered: 'new',
  researched: 'new',
  approved: 'new',
  contacted: 'contacted',
  no_response: 'contacted',
  interested: 'conversation',
  follow_up_needed: 'conversation',
  meeting_booked: 'conversation',
  converted: 'won',
  lost: 'lost',
  not_interested: 'lost',
  rejected: 'lost',
  replaced: 'lost',
});

export function pipelineStageFor(lead) {
  const mapped = OPPORTUNITY_STATE_TO_PIPELINE[lead?.state];
  if (mapped) return mapped;
  /* A contact event exists but the entity state never moved: contacted is the
     weakest claim the evidence supports. */
  return (lead?.contactHistory || []).length > 0 ? 'contacted' : 'new';
}

/**
 * The full runtime, minus I/O.
 *
 * @param {function|null} synthesize injected model caller. Omitted or failing
 *   means the deterministic record — a supported outcome, not an error.
 */
export async function runProspectIntelligence({
  lead, facts, ventureId, ventureName = null, leadType = null,
  comparisonSet = null, now = new Date().toISOString(), synthesize = null,
  /* Narrow by contract — see buildProspectContext. Never reaches ranking:
     the durable ranking is copied, never recomputed, and assessPriority is
     not given this. */
  contact = null,
}) {
  const ventureState = founderStateFromLedger(facts, { ventureId, ventureName });
  /* SERVER-DERIVED. A caller may still pass leadType for a unit test, but the
     Edge Function does not — the evidence decides. */
  const resolvedLeadType = leadType || deriveLeadType(lead?.signals || []);
  const prospect = prospectFromPersistedLead(lead, { leadType: resolvedLeadType });

  /* THE DURABLE RANKING IS THE CANONICAL ONE. It is reused rather than
     recomputed: re-ranking here would mean two places could disagree about
     whether a lead qualifies, and the persisted artifact is the one every
     other part of the system already reads. */
  const ranking = lead.ranking || null;

  /* Model telemetry is captured HERE rather than threaded back through L1,
     which must stay ignorant of whether a model exists at all. Counts and
     durations only — the adapter already strips everything else. Both calls
     are recorded so a repair's cost is visible rather than hidden inside the
     first one's number. */
  const calls = [];
  const instrumented = typeof synthesize === 'function'
    ? async (args) => {
      const result = await synthesize(args);
      calls.push({
        ok: result?.ok === true,
        reason: result?.reason || null,
        ms: Number.isFinite(result?.ms) ? result.ms : null,
        usage: result?.usage || null,
        model: result?.model || null,
      });
      return result;
    }
    : null;

  const { record, validation, context, selection, decision } = await buildProspectIntelligence({
    prospect, ventureState, ranking, eligibility: null,
    leadType: resolvedLeadType, comparisonSet, now, synthesize: instrumented, contact,
  });

  const sumUsage = (field) => {
    const values = calls.map((call) => call.usage?.[field]).filter(Number.isFinite);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  const modelAttempted = calls.length > 0;
  const modelDiagnostics = calls.length === 0 ? null : {
    name: calls.find((call) => call.model)?.model || null,
    callCount: calls.length,
    ms: calls.reduce((total, call) => total + (call.ms || 0), 0),
    failureReasons: calls.filter((call) => !call.ok).map((call) => call.reason),
    usage: {
      inputTokens: sumUsage('inputTokens'),
      cachedInputTokens: sumUsage('cachedInputTokens'),
      outputTokens: sumUsage('outputTokens'),
      reasoningTokens: sumUsage('reasoningTokens'),
      totalTokens: sumUsage('totalTokens'),
    },
  };

  return {
    record,
    validation,
    workspace: toLeadViewModel({ ...record, pipelineStage: pipelineStageFor(lead) }, { now }),
    leadType: resolvedLeadType,
    diagnostics: {
      /* "NOT ASKED" AND "ASKED AND FAILED" ARE DIFFERENT FACTS, and the whole
         cost story depends on telling them apart. A refused prospect now
         skips synthesis entirely (prospect-intelligence.js), so `calls` is
         empty — not because a model was tried and rejected, but because the
         deterministic language is the intended and only answer. Reporting
         that as a "fallback" from a call that never happened made the saving
         invisible and the telemetry self-contradictory. */
      languageSource: record.provenance.synthesis === 'model' ? 'model'
        : record.provenance.synthesis === 'model_repaired' ? 'model_repaired'
          : modelAttempted ? 'deterministic_fallback' : 'deterministic_by_design',
      /* Derived from whether a call was actually made, never assumed. */
      modelCalled: modelAttempted,
      model: modelDiagnostics,
      validation: {
        initialValid: record.provenance.synthesis === 'model',
        repairAttempted: record.provenance.repairAttempted === true,
        repairValid: record.provenance.synthesis === 'model_repaired',
        fallbackReason: record.provenance.synthesis === 'deterministic'
          ? (record.provenance.rejectedViolations || []).map((violation) => violation.code)[0]
            || calls.filter((call) => !call.ok).map((call) => call.reason)[0]
            || (modelAttempted ? 'no_model' : 'refusal_no_language_required')
          : null,
        violationCodes: (record.provenance.rejectedViolations || []).map((violation) => violation.code),
      },
      runtime: {
        loadedFromDatabase: true,
        structuredSignals: prospect.signals.length > 0,
        structuredSignalCount: prospect.signals.length,
        founderStateSource: 'canonical_ledger',
        leadType: resolvedLeadType,
        leadTypeSource: 'derived_from_signals',
        activeFactCount: ventureState.ledgerSummary.activeFactCount,
        offerStatus: ventureState.ledgerSummary.offerStatus,
        offerConfirmed: ventureState.offerConfirmed,
      },
      decision: { action: decision.action, channel: decision.channel, urgency: decision.urgency },
    },
    /* Returned for tests and telemetry, never serialised to a client. */
    internals: { context, selection, decision, ventureState },
  };
}

/**
 * The cached runtime.
 *
 * THE ORDER MATTERS AND IS THE WHOLE POINT. Everything authoritative is
 * rebuilt from current data BEFORE the cache is consulted, and the cached
 * prose is then judged against those fresh results. A cache hit therefore
 * skips exactly one thing — the model call — and nothing else. Selection, the
 * next action, consent, contactability, qualification and the grounding
 * verdict are computed identically whether or not a row existed.
 *
 * @param {object} cache  {load(), save()} — injected so this stays pure.
 */
export async function runProspectIntelligenceCached({
  lead, facts, ventureId, ventureName = null, leadType = null, comparisonSet = null,
  now = new Date().toISOString(), synthesize = null, modelName = null,
  cache = null, hash = null, contact = null,
}) {
  const ventureState = founderStateFromLedger(facts, { ventureId, ventureName });
  const resolvedLeadType = leadType || deriveLeadType(lead?.signals || []);
  const prospect = prospectFromPersistedLead(lead, { leadType: resolvedLeadType });
  const ranking = lead.ranking || null;

  /* 1-6 — CURRENT authority, every time. */
  const context = buildProspectContext({ prospect, ventureState, ranking, eligibility: null, leadType: resolvedLeadType, now });
  const selection = buildSelectionRationale({ context, ranking, comparisonSet });
  const decision = decideNextBestAction({ context, ranking, eligibility: null });

  /* 7-9 — the cache, as a candidate only. */
  let cacheStatus = CACHE_STATUS.MISS_GENERATED;
  let cacheReason = 'no_cache_configured';
  let cachedLanguage = null;
  let cachedRow = null;
  let fingerprint = null;

  const cacheable = typeof cache?.load === 'function' && typeof hash === 'function';
  if (cacheable) {
    fingerprint = await buildInputFingerprint({
      prospect, ranking, founderContext: context.founder, decision, modelName, hash,
      contact: context.contact,
    });
    cachedRow = await cache.load();
    const resolved = resolveCachedLanguage({
      cached: cachedRow, currentFingerprint: fingerprint, context, selection, decision, now,
    });
    cacheStatus = resolved.status;
    cacheReason = resolved.reason;
    if (resolved.usable) cachedLanguage = resolved.language;
  }

  /* A hit reuses the prose and calls nothing. */
  if (cachedLanguage) {
    const { record, validation } = await buildProspectIntelligence({
      prospect, ventureState, ranking, eligibility: null, leadType: resolvedLeadType,
      comparisonSet, now,
      /* The "model" is the cached text. It still passes through the identical
         validate-or-fall-back path, so a cached string gets no privilege a
         fresh generation would not have had. */
      synthesize: async () => ({ ok: true, parsed: cachedLanguage, ms: 0, usage: null, model: cachedRow?.modelName || null }),
    });
    return {
      record, validation,
      workspace: toLeadViewModel({ ...record, pipelineStage: pipelineStageFor(lead) }, { now }),
      leadType: resolvedLeadType,
      cache: {
        status: CACHE_STATUS.HIT,
        fingerprint,
        generatedAt: cachedRow?.generatedAt || null,
        validUntil: cachedRow?.validUntil || null,
      },
      diagnostics: {
        languageSource: languageSourceLabel({ synthesisSource: cachedRow?.synthesisSource || 'model', fromCache: true }),
        modelCalled: false,
        model: null,
        validation: { initialValid: true, repairAttempted: false, repairValid: false, fallbackReason: null, violationCodes: [] },
        runtime: runtimeDiagnostics({ prospect, ventureState, resolvedLeadType }),
        decision: { action: decision.action, channel: decision.channel, urgency: decision.urgency },
      },
      internals: { context, selection, decision, ventureState },
    };
  }

  /* A miss runs the normal L2 path. */
  const generated = await runProspectIntelligence({
    lead, facts, ventureId, ventureName, leadType: resolvedLeadType, comparisonSet, now, synthesize,
  });

  const source = generated.record.provenance.synthesis;
  if (cacheable && typeof cache.save === 'function' && shouldCache(source)) {
    /* Only AFTER grounding succeeded, and only the language. */
    try {
      await cache.save({
        inputFingerprint: fingerprint,
        contractVersion: PROSPECT_INTELLIGENCE_CONTRACT_VERSION,
        policyVersion: PROSPECT_LANGUAGE_POLICY_VERSION,
        modelName: generated.diagnostics.model?.name || modelName || 'unknown',
        synthesisSource: source,
        language: languageFromRecord(generated.record),
        generatedAt: now,
        validUntil: deriveValidUntil({ decision, freshness: context.freshness, now }),
        usage: generated.diagnostics.model?.usage || {},
      });
    } catch (error) {
      /* A cache write failing must never fail the founder's request. The
         answer is already computed and already valid; the only cost is that
         the next open regenerates. */
      generated.diagnostics.cacheWriteError = String(error?.message || 'unknown').slice(0, 120);
    }
  }

  return {
    ...generated,
    cache: {
      status: shouldCache(source) ? cacheStatus : CACHE_STATUS.FALLBACK_NOT_CACHED,
      fingerprint,
      generatedAt: shouldCache(source) ? now : null,
      validUntil: shouldCache(source) ? deriveValidUntil({ decision, freshness: context.freshness, now }) : null,
      reason: cacheReason,
    },
    /* A MISS NO LONGER IMPLIES A CALL. This used to hardcode `true`, which was
       accurate while every miss ran the model; a refusal now misses the cache
       and calls nothing, and the $0 guarantee is asserted against this exact
       field (scripts/qa-leads-staging-browser.mjs). Trust the generator. */
    diagnostics: { ...generated.diagnostics },
  };
}

/** The language half of a record, in the exact shape the contract validates
 * and the cache stores. Nothing code-owned travels with it. */
export function languageFromRecord(record) {
  const w = record.workspace;
  return {
    whyChosen: record.selection.whyChosen,
    whyNow: record.selection.whyNow,
    whyThisProspect: w.whyThisProspect,
    strengths: w.strengths,
    weaknesses: w.weaknesses,
    offerFit: w.offerFit,
    whatToSay: w.whatToSay,
    objections: w.objections,
    callStructure: w.callStructure,
    outreach: w.outreach,
  };
}

function runtimeDiagnostics({ prospect, ventureState, resolvedLeadType }) {
  return {
    loadedFromDatabase: true,
    structuredSignals: prospect.signals.length > 0,
    structuredSignalCount: prospect.signals.length,
    founderStateSource: 'canonical_ledger',
    leadType: resolvedLeadType,
    leadTypeSource: 'derived_from_signals',
    activeFactCount: ventureState.ledgerSummary.activeFactCount,
    offerStatus: ventureState.ledgerSummary.offerStatus,
    offerConfirmed: ventureState.offerConfirmed,
  };
}

export const PROSPECT_RUNTIME_INTERNALS = Object.freeze({
  NON_FACT_KEY_PREFIXES, isRealFactKey, scalarText, factKeyOf, signalsOf, latest,
});
