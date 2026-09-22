/* ════════════════════════════════════════════════════════════════════════
   PROSPECT CONTEXT — everything the model is allowed to see, and nothing else
   ────────────────────────────────────────────────────────────────────────
   One bounded object per prospect, assembled from structured state only.

   WHY IT IS BOUNDED RATHER THAN "THE FOUNDER'S DATA". Two reasons, and the
   second is the important one:

     1. Cost and latency. Obvious, and the least interesting.
     2. A model cannot repeat a fact it was never given. Almost every way a
        sales script lies is by reaching for something plausible — a client
        count, a result, a guarantee. If the only founder facts in the context
        are the ones that actually exist and are actually trusted, the model
        has nothing to reach for, and the grounding validator downstream is
        catching leaks rather than doing the whole job alone.

   RAW TRANSCRIPT NEVER ENTERS. Founder Questions already distilled the
   interview into structured, status-carrying facts; re-feeding the transcript
   would smuggle back in every unconfirmed thing the founder said out loud
   while thinking.
   ════════════════════════════════════════════════════════════════════════ */

import { CONSENT_STATUSES, PROSPECT_CONTACT_CHANNELS, LEAD_LIFECYCLE_STAGES, isLeadStage } from './prospect-intelligence-contract.js';
import { detectOfferGaps } from './priority-intelligence.js';

/* THE CANONICAL FOUNDER LEDGER VOCABULARY, verified against the real check
   constraint on public.founder_venture_facts:
     provisional | user_confirmed | system_verified | proof_verified
     | disputed | superseded

   L1 shipped with ['user_confirmed', 'observed', 'verified']. Two of those
   three are not values the ledger can ever hold, so they matched nothing,
   while `system_verified` and `proof_verified` — facts VISION established
   itself and facts backed by proof — were being silently discarded as
   untrusted. Queried, not guessed: staging holds 2,458 user_confirmed,
   1,074 provisional and 340 superseded rows.

   `provisional` is deliberately excluded. A provisional fact is something the
   founder said once and has not confirmed; it is fine as context for VISION's
   own reasoning and it is not a sentence to put in a founder's mouth in front
   of a customer. `disputed` and `superseded` are excluded for the obvious
   reason. */
export const TRUSTED_FACT_STATUSES = Object.freeze(['user_confirmed', 'system_verified', 'proof_verified']);
export const UNTRUSTED_FACT_STATUSES = Object.freeze(['provisional', 'disputed', 'superseded']);

/* Claims that are commercially load-bearing: if the founder says one of these
   on a call and it is not true, it is not a rough edge, it is a lie told on
   VISION's instruction. They may ONLY come from a trusted founder fact, and
   the validator re-checks every one of them against this same list. */
export const SENSITIVE_CLAIM_KEYS = Object.freeze([
  'clientCount', 'caseStudies', 'customerResults', 'revenue', 'roi',
  'yearsExperience', 'pricing', 'guarantees', 'partnerships', 'previousWork',
  'certifications', 'teamSize',
]);

/* ── THE CLAIM NAME IS NOT ALWAYS THE FACT KEY ────────────────────────
   `pricing` was consumed here and written nowhere. The intake pipeline emits
   `offerPricing` (offer_detail -> offer + offerPricing, see
   founder-lead-intelligence.js), the fact registry declares `offerPricing`
   with intakeQuestionId `offer_price`, and every founder-facing surface
   labels it Pricing -- but `byKey.get('pricing')` matched none of that, so
   `trustedClaims.pricing` was undefined for every founder in every
   environment. A founder who answered the price question still had a
   prospect who could not be told the price.

   The suite did not catch it because its fixture writes `factKey: 'pricing'`
   directly, which proves the fact_key/key normalisation works and proves
   nothing about whether a real founder's answer arrives. Same shape as the
   `offerAddresses` defect the fact registry documents: consumed under a name
   the writer never uses.

   Aliased rather than renamed. The claim keeps the name the prompt, the
   validator and the language cache already use, and only its SOURCE widens,
   so nothing downstream has to move. First key that resolves wins, so a
   canonical `offerPricing` beats a legacy `pricing` row. */
const CLAIM_SOURCE_KEYS = Object.freeze({
  pricing: Object.freeze(['offerPricing', 'pricing']),
});

function iso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}
function text(value, max = 400) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null;
}

/**
 * The founder half of the context: confirmed identity, offer and target
 * customer, plus only those sensitive claims the venture state actually
 * established.
 *
 * An absent offer is returned as `null` and is NOT substituted. A generic
 * stand-in offer is how a prospect gets pitched something the founder never
 * agreed to sell.
 */
export function buildFounderContext(ventureState = {}) {
  const facts = Array.isArray(ventureState.facts) ? ventureState.facts : [];
  /* BOTH conditions, not either. Status alone was the only filter, which meant
     the guard against a retired fact rested on 'superseded' happening not to
     appear in the trusted list rather than on the ledger's own activity flag.
     A superseded fact that had been written with a trusted status would have
     walked straight into a sales script. `active !== false` rather than
     `active === true` so a caller that legitimately has no activity column
     (an in-memory fixture) is not silently emptied. */
  const trusted = facts.filter((fact) => fact
    && TRUSTED_FACT_STATUSES.includes(fact.verificationStatus)
    && fact.active !== false);

  const byKey = new Map();
  for (const fact of trusted) {
    /* The ledger column is `fact_key`; the adapter normalises it to `key`.
       Both are accepted so a raw row cannot silently contribute nothing. */
    const key = typeof fact.key === 'string' ? fact.key : (typeof fact.factKey === 'string' ? fact.factKey : null);
    if (key && fact.value != null) byKey.set(key, fact);
  }

  const claims = {};
  for (const key of SENSITIVE_CLAIM_KEYS) {
    /* Most claims are sourced by their own name; only the aliased ones look
       further, and they still only ever read TRUSTED facts -- `byKey` was
       already filtered above, so widening the source cannot widen the gate. */
    const sources = CLAIM_SOURCE_KEYS[key] || [key];
    let fact = null;
    let sourcedFrom = key;
    for (const source of sources) {
      fact = byKey.get(source);
      if (fact) { sourcedFrom = source; break; }
    }
    if (fact) {
      claims[key] = {
        value: typeof fact.value === 'string' ? fact.value.slice(0, 300) : fact.value,
        verificationStatus: fact.verificationStatus,
        /* Names the fact it actually came from, not the claim it became --
           a provenance line that said `founder_fact:pricing` for a value
           read out of `offerPricing` would be quietly wrong. */
        sourceReference: text(fact.sourceReference, 200) || `founder_fact:${sourcedFrom}`,
      };
    }
  }

  return {
    ventureId: text(ventureState.ventureId, 200),
    businessName: text(ventureState.businessName, 200),
    /* Verbatim. Paraphrasing an offer is how its terms quietly change. */
    offer: text(ventureState.offer, 600),
    offerConfirmed: Boolean(text(ventureState.offer, 600)) && ventureState.offerConfirmed === true,
    targetCustomer: text(ventureState.targetCustomer, 400),
    currentObjective: text(ventureState.currentObjective, 400),
    currentBottleneck: text(ventureState.currentBottleneck, 400),
    founderLevel: text(ventureState.founderLevel, 40),
    /* ONLY the sensitive claims that exist and are trusted. An empty object
       means the model may make none of them. */
    trustedClaims: claims,
  };
}

/**
 * Resolves what contact is actually permitted, from evidence rather than
 * optimism.
 *
 * B2B: a published business contact route needs no consent — it is published
 * in order to be used — but it must have been OBSERVED, not assumed.
 * B2C: an identified person needs an explicit grant, and the grant names which
 * channels it covers. Permission is the INTERSECTION of what we observed and
 * what they allowed; a channel in only one of those lists is not usable.
 */
export function resolveContactability(prospect = {}, { leadType = 'b2b' } = {}) {
  const observed = [];
  for (const channel of prospect.contactChannels || []) {
    if (PROSPECT_CONTACT_CHANNELS.includes(channel)) observed.push(channel);
  }

  const raw = prospect.consent || {};
  const declared = CONSENT_STATUSES.includes(raw.status)
    ? raw.status
    : (leadType === 'b2b' ? 'not_required' : 'unknown');
  /* A CONSENT RECORD WE CANNOT READ IS TREATED AS A REFUSAL, never as silence.
     deriveConsent carries the raw value it could not place in the vocabulary;
     without this, 'opted_out' or 'revoked' collapsed to 'unknown', and on a
     B2B lead unknown becomes the permissive 'not_required' below. */
  const unreadable = typeof raw.unrecognisedStatus === 'string' && raw.unrecognisedStatus.length > 0;
  /* THE B2B BASELINE IS "NOT REQUIRED", and consent must not quietly lower it.
     A published business line needs no consent, so 'granted' and 'unknown' add
     nothing and must not REDUCE permission — otherwise attaching consent to
     B2B at all would turn every business carrying an inconclusive consent
     record into do_not_contact. Only an explicit refusal, or a record we
     cannot read, changes the answer. */
  /* An unreadable record reports 'unknown', NOT 'withdrawn'. We did not observe
     a withdrawal; we observed a consent record we cannot place in the
     vocabulary. Saying 'withdrawn' would be a confident claim about something
     nobody established — the exact move this engine refuses everywhere else.
     'unknown' is both true and sufficient: it is neither 'not_required' nor
     'granted', so nothing below permits a channel, contactPermitted is false,
     and decideNextBestAction refuses with "a contact route exists but consent
     does not cover it". */
  const status = unreadable ? 'unknown'
    : (leadType === 'b2b' && !['declined', 'withdrawn'].includes(declared) ? 'not_required' : declared);
  const allowed = Array.isArray(raw.allowedChannels)
    ? raw.allowedChannels.filter((channel) => PROSPECT_CONTACT_CHANNELS.includes(channel))
    : [];

  const consent = {
    status,
    /* Carried, not dropped: the decision ladder and the spend gate must be able
       to ask the same question, and "there is a consent record we cannot read"
       is not expressible in the four-value status vocabulary. */
    unrecognisedStatus: unreadable ? raw.unrecognisedStatus : null,
    source: text(raw.source, 200),
    grantedAt: iso(raw.grantedAt),
    allowedChannels: [...new Set(allowed)],
  };

  let permitted = [];
  if (status === 'not_required') {
    permitted = [...new Set(observed)];
  } else if (status === 'granted') {
    const allowSet = new Set(consent.allowedChannels);
    permitted = [...new Set(observed.filter((channel) => allowSet.has(channel)))];
  }
  /* declined / withdrawn / unknown -> nothing is permitted. "We never asked"
     and "they said no" both mean the founder may not contact them; only the
     explanation differs, and that difference is carried in `status`. */

  /* THREE SEPARATE IDEAS, AND THEY MUST NOT COLLAPSE INTO ONE.
       observedChannels        a route exists — an OBSERVED fact
       permittedChannels       the person granted it, where consent applies
       policyStatus            whether any jurisdiction/channel policy has
                               actually been evaluated
     `permittedChannels` on a B2B lead currently means "published for the
     purpose of being contacted", and that is a product rule, not a legal
     finding. Naming the third idea explicitly — as `not_evaluated` — is what
     stops "we found a public phone number" being read downstream as "VISION
     determined this call is lawful everywhere". No compliance engine is being
     built here and no B2B behaviour changes; this is the field that stops a
     later reader inferring a conclusion nobody reached. */
  const policyStatus = status === 'not_required'
    ? 'not_evaluated_public_business_route'
    : (permitted.length > 0 ? 'consent_recorded_policy_not_evaluated' : 'no_permitted_channel');

  return {
    observedChannels: [...new Set(observed)],
    permittedChannels: permitted,
    consent,
    contactPermitted: permitted.length > 0,
    policyStatus,
  };
}

/**
 * The B2C lifecycle position. Never inferred upward: activity alone cannot
 * promote a visitor past the lead line, because what makes a lead is
 * identifying themselves, not generating events.
 */
export function resolveLifecycle(prospect = {}, { leadType = 'b2b', qualified = false } = {}) {
  if (leadType === 'b2b') {
    /* A business surfaced by discovery is an opportunity, not a person in a
       consumer funnel. It sits at `lead` once it has an identity we can act
       on, which for a business is simply being a named, listed entity — and
       moves to `qualified_lead` when the CANONICAL ranking qualified it.
       Returning 'lead' unconditionally put two canonically-qualified
       prospects under "Lead" and left "Qualified" reading zero on the real
       staging board. */
    return qualified
      ? { stage: 'qualified_lead', isLead: true, reason: 'A named business whose ranking meets the qualification threshold.' }
      : { stage: 'lead', isLead: true, reason: 'A named business with a public listing is an identified opportunity.' };
  }
  const declared = LEAD_LIFECYCLE_STAGES.includes(prospect.lifecycleStage) ? prospect.lifecycleStage : 'anonymous';
  const identified = Boolean(text(prospect.name, 200)) && prospect.identified === true;
  /* The one direction this function will move a stage is DOWN. An upstream
     system that labels an unidentified visitor a "hot lead" is corrected
     here rather than believed. */
  const stage = isLeadStage(declared) && !identified ? 'engaged' : declared;
  return {
    stage,
    isLead: isLeadStage(stage),
    reason: isLeadStage(stage)
      ? 'This person identified themselves.'
      : 'Activity was recorded but nobody identified themselves, so this is audience rather than a lead.',
  };
}

/** Latest dated evidence and whether it is still usable. */
export function resolveFreshness(prospect = {}, { now = new Date().toISOString(), staleAfterMs = 30 * 24 * 60 * 60 * 1000 } = {}) {
  const times = (prospect.signals || [])
    .filter((signal) => signal && signal.evidenceStatus !== 'UNKNOWN')
    .map((signal) => Date.parse(signal.checkedAt))
    .filter(Number.isFinite);
  const nowMs = Date.parse(now);
  if (!times.length || !Number.isFinite(nowMs)) {
    return { latestCheckedAt: null, ageMs: null, fresh: false, reason: 'freshness_unknown', staleAfterMs };
  }
  const latest = Math.max(...times);
  const ageMs = nowMs - latest;
  /* Future-dated evidence is not fresh, it is wrong. */
  if (ageMs < 0) return { latestCheckedAt: new Date(latest).toISOString(), ageMs, fresh: false, reason: 'future_dated_evidence', staleAfterMs };
  const fresh = ageMs <= staleAfterMs;
  return {
    latestCheckedAt: new Date(latest).toISOString(),
    ageMs,
    fresh,
    reason: fresh ? 'fresh' : 'stale_evidence',
    staleAfterMs,
  };
}

/**
 * Chronological signal timeline. Built only from dated signals that exist —
 * there is no interpolation and no "probably happened around then".
 */
export function buildSignalTimeline(prospect = {}, { max = 12 } = {}) {
  return (prospect.signals || [])
    .filter((signal) => signal && signal.evidenceStatus !== 'UNKNOWN' && Number.isFinite(Date.parse(signal.checkedAt)))
    .map((signal) => ({
      at: signal.checkedAt,
      label: String(signal.detail || signal.kind).slice(0, 120),
      kind: signal.kind,
      evidenceStatus: signal.evidenceStatus,
      sourceReference: signal.sourceUrl || signal.sourceReference || null,
      signalId: signal.signalId,
    }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

/**
 * Everything nobody has established. These stay visible for the life of the
 * record: an unknown that quietly disappears becomes an assumption, and an
 * assumption in a sales script becomes a claim.
 *
 * Each unknown carries `subjectTokens`, which is what lets the grounding
 * validator notice the model asserting one of them as fact later.
 */
export function collectImportantUnknowns(prospect = {}, { max = 8 } = {}) {
  const fromSignals = (prospect.signals || [])
    .filter((signal) => signal && signal.evidenceStatus === 'UNKNOWN')
    .map((signal) => ({
      statement: String(signal.detail || `Unknown: ${signal.kind}`).slice(0, 260),
      subjectTokens: subjectTokensOf(signal.value?.subjectTokens, signal.detail),
      signalId: signal.signalId,
    }));
  const declared = (prospect.unknowns || []).map((item) => ({
    statement: String(item?.statement || item || '').slice(0, 260),
    subjectTokens: subjectTokensOf(item?.subjectTokens, item?.statement || item),
    signalId: item?.signalId || null,
  })).filter((item) => item.statement.length > 0);
  const seen = new Set();
  return [...declared, ...fromSignals].filter((item) => {
    const key = item.statement.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}

const UNKNOWN_STOP_WORDS = new Set([
  'whether', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'their', 'they', 'them',
  'of', 'for', 'to', 'and', 'or', 'in', 'on', 'at', 'by', 'with', 'currently',
  'unknown', 'if', 'has', 'have', 'had', 'this', 'that', 'it', 'its', 'be', 'been',
  'any', 'some', 'we', 'do', 'does', 'not', 'no', 'yet', 'still', 'would', 'could',
]);

/** Content words that name what an unknown is ABOUT. */
export function subjectTokensOf(explicit, statement) {
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((token) => String(token).toLowerCase()).filter(Boolean).slice(0, 8);
  }
  return String(statement || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !UNKNOWN_STOP_WORDS.has(word))
    .slice(0, 8);
}

/**
 * The whole bounded context, ready to be serialised into a model prompt.
 *
 * `allowedNumbers` is assembled here rather than in the validator so both
 * sides read the same list: it is every numeric value that appears anywhere in
 * real evidence or trusted founder facts. Anything numeric the model writes
 * that is not in this set was invented.
 */
export function buildProspectContext({
  prospect, ventureState, ranking = null, eligibility = null,
  leadType = 'b2b', now = new Date().toISOString(),
  /* Narrow by contract, and never reaches anything that scores. */
  contact = null,
}) {
  const founder = buildFounderContext(ventureState || {});
  const contactability = resolveContactability(prospect || {}, { leadType });
  const lifecycle = resolveLifecycle(prospect || {}, { leadType, qualified: ranking?.qualified === true });
  const freshness = resolveFreshness(prospect || {}, { now });
  const timeline = buildSignalTimeline(prospect || {});
  const unknowns = collectImportantUnknowns(prospect || {});

  const observedSignals = (prospect?.signals || []).filter((signal) => signal?.evidenceStatus === 'OBSERVED');
  const inferredSignals = (prospect?.signals || []).filter((signal) => signal?.evidenceStatus === 'INFERRED');

  /* THE GAP THIS FOUNDER CAN ACTUALLY CLOSE, resolved once here so the
     selection rationale and the script cannot disagree about it. Reuses
     priority-intelligence's detector rather than re-deriving gaps: a second
     gap vocabulary is how two surfaces come to describe the same prospect
     differently. OBSERVED only — an inferred gap is not something to open a
     cold call by asserting. */
  const declaredScope = Array.isArray(ventureState?.offerAddresses) ? ventureState.offerAddresses : [];
  const offerGap = declaredScope.length > 0
    ? (detectOfferGaps(prospect?.signals || [])
      .find((gap) => declaredScope.includes(gap.gap) && gap.evidenceStatus === 'OBSERVED') || null)
    : null;

  return {
    now,
    leadType,
    founder,
    /* WHO WE WOULD BE TALKING TO — and deliberately only three fields.
       kind and role change TONE, which objection leads and what commitment is
       worth asking for. Nothing else is carried: not the address, not the
       verification state, not the confidence. Those describe how good the
       CONTACT is, and letting them in here is the shape of the mistake this
       codebase already guards against — a verified email must never make a
       prospect more worth pursuing. `authorityKnown` is hard-coded false
       because contact-intelligence refuses to infer authority from a title
       and this layer must not quietly re-infer it. */
    contact: contact && typeof contact === 'object' ? {
      kind: contact.kind === 'personal' ? 'personal' : (contact.kind === 'generic' ? 'generic' : null),
      role: text(contact.role, 120),
      authorityKnown: false,
    } : null,
    /* Stored grounded external events, carried verbatim. This layer neither
       fetches nor judges them — resolveWhyNow does — but without them on the
       context the Workspace could only ever see the freshness sentence, which
       is how VISION came to say "nothing here is time-sensitive" about a
       prospect whose acquisition it had already stored. */
    whyNowSignals: Array.isArray(prospect?.whyNowSignals) ? prospect.whyNowSignals.slice(0, 25) : [],
    /* null is a real answer: no declared scope, or no observed gap. */
    offerGap: offerGap ? {
      gap: offerGap.gap, detail: text(offerGap.detail, 300),
      evidenceStatus: offerGap.evidenceStatus, sourceUrl: offerGap.sourceUrl || null,
    } : null,
    prospect: {
      id: text(prospect?.id, 200),
      name: text(prospect?.name, 200),
      category: text(prospect?.category, 200),
      location: text(prospect?.address || prospect?.location, 300),
      identified: prospect?.identified === true,
    },
    lifecycle,
    contactability,
    freshness,
    timeline,
    unknowns,
    evidence: {
      observed: observedSignals.map(summariseSignal),
      inferred: inferredSignals.map(summariseSignal),
    },
    /* Copied, never recomputed. See the contract module's header. */
    ranking: ranking ? {
      dimensions: { ...ranking.dimensions },
      qualified: ranking.qualified === true,
      explanation: text(ranking.explanation, 400),
    } : null,
    eligibility: eligibility ? {
      qualified: eligibility.qualified === true,
      approved: eligibility.approved === true,
      fresh: eligibility.fresh === true,
      contactEligible: eligibility.contactEligible === true,
      reasons: (eligibility.reasons || []).slice(0, 12),
    } : null,
    allowedNumbers: collectAllowedNumbers({ prospect, founder }),
  };
}

function summariseSignal(signal) {
  return {
    signalId: signal.signalId,
    kind: signal.kind,
    evidenceStatus: signal.evidenceStatus,
    detail: String(signal.detail || '').slice(0, 260),
    sourceReference: signal.sourceUrl || signal.sourceReference || null,
    checkedAt: signal.checkedAt,
    confidence: signal.confidence,
  };
}

/** Every number that legitimately exists, as normalised strings. */
export function collectAllowedNumbers({ prospect, founder }) {
  const found = new Set();
  const harvest = (value) => {
    for (const match of String(value ?? '').matchAll(/\d+(?:[.,]\d+)?/g)) {
      found.add(match[0].replace(/,/g, ''));
    }
  };
  for (const signal of prospect?.signals || []) {
    harvest(signal?.detail);
    for (const value of Object.values(signal?.value || {})) {
      if (typeof value === 'string' || typeof value === 'number') harvest(value);
    }
  }
  for (const claim of Object.values(founder?.trustedClaims || {})) harvest(claim?.value);
  harvest(founder?.offer);
  return [...found];
}
