/* ════════════════════════════════════════════════════════════════════════
   CONTACT INTELLIGENCE — "who do I contact, and how sure are we?"
   ────────────────────────────────────────────────────────────────────────
   A THIRD QUESTION, KEPT APART FROM THE OTHER TWO.

     VALID LEAD?    ranking.js          — a real business of the right type
     WORTH MY TIME? priority-intelligence.js — offer-relative need
     WHO DO I CALL? this file

   NOTHING HERE MAY MOVE A PROSPECT'S PRIORITY. Finding a verified CEO
   address does not create offer need, commercial value, urgency or ability
   to pay — it makes a business the founder ALREADY wants to approach easier
   to reach. A NOT WORTH TIME prospect with a perfect contact is still not
   worth the founder's time, and this module exports nothing that could
   change that: it never sees the offer, the score, or the band.

   That separation is not stylistic. The moment enrichment can promote a
   lead, the cheapest way to look busy is to enrich everything, and the
   board fills with businesses that were easy to find contacts for rather
   than businesses worth contacting.
   ════════════════════════════════════════════════════════════════════════ */

/* Verification states, ordered by how much they actually establish. This is
   the only ranking of them anywhere, and `accept_all` sits deliberately
   BELOW `unknown`-adjacent handling in messaging: it means the server
   accepts every address, so a positive result proved nothing. */
const VERIFICATION_RANK = Object.freeze({
  valid: 5, accept_all: 3, unknown: 2, webmail: 2, disposable: 1, invalid: 0,
});

/* What each state is honestly allowed to be called in front of a founder.
   `accept_all` may never be rendered as "verified". */
export const VERIFICATION_LABEL = Object.freeze({
  valid: 'Verified address',
  accept_all: 'Unconfirmed — this server accepts all mail, so delivery proves nothing',
  unknown: 'Not verified',
  webmail: 'Personal webmail address',
  disposable: 'Disposable address',
  invalid: 'Known bad address',
});

/* THE SMALLEST ROLE RULE THAT IS HONEST. Not a taxonomy: six families, and
   an explicit refusal to guess. A title VISION does not recognise returns
   `unknown` rather than being ranked, because "Head of Clinical Governance"
   might be exactly the right person and pretending to know is worse than
   admitting we do not. */
/* ORDER IS THE CLASSIFIER. roleFamily returns the FIRST match, so the specific
   functions must be tested before `owner` — whose pattern contains a bare
   `director` and would otherwise swallow every qualified one. Found by a
   round-trip assertion added when Apollo began querying by title: we asked
   for "Marketing Director", classified the answer as `owner`, judged them
   not relevant to a marketing offer, and ranked them below a shared mailbox —
   demoting the exact person the query had gone looking for.

   `owner` is last on purpose: it is the fallback for a title that names
   seniority without naming a function. "Managing Director" and a bare
   "Director" still land there; "Marketing Director" and "Sales Director" no
   longer do. */
const ROLE_FAMILIES = Object.freeze([
  { family: 'marketing', pattern: /\b(marketing|growth|brand|digital)\b/i },
  { family: 'sales', pattern: /\b(sales|business development|account executive|bd)\b/i },
  /* `partnership\w*` for the plural — "Partnerships Manager" is the common
     form and \bpartnership\b does not match it. */
  { family: 'partnerships', pattern: /\b(partnership\w*|alliance|channel)\b/i },
  /* Both the acronym and the spelled-out form: providers return either, and a
     title we ask for must classify back into the family that asked for it. */
  { family: 'operations', pattern: /\b(operations|practice manager|office manager|general manager|coo|chief operating officer)\b/i },
  /* `reception\w*` because \breception\b does not match "Receptionist" — the
     word continues, so there is no boundary. It classified as `unknown` and so
     escaped the lowest seniority rank it belongs in. */
  { family: 'admin', pattern: /\b(reception\w*|administrator|admin|coordinator|assistant)\b/i },
  { family: 'owner', pattern: /\b(founder|owner|principal|proprietor|director|ceo|chief executive officer|managing director)\b/i },
]);

export function roleFamily(personRole) {
  if (typeof personRole !== 'string' || personRole.trim().length === 0) return 'unknown';
  for (const entry of ROLE_FAMILIES) {
    if (entry.pattern.test(personRole)) return entry.family;
  }
  return 'unknown';
}

/* WHICH ROLE IS THE RIGHT ONE DEPENDS ON THE OFFER, AND VISION DOES NOT KNOW.
   The Fact Registry declares 49 facts and not one of them names the role an
   offer is sold to — the closest, targetCustomerType, only splits consumer
   from business. So relevance is always 'unknown', and it says so.

   This used to accept an `offerRoleFamilies` argument that would have made it
   answer 'relevant'. Nothing ever passed one: 8 references, all inside this
   file, 0 from production. Keeping a parameter that implies a capability
   nobody can reach made the code read as though role targeting existed, and
   the Workspace then presented the observed title as though it had driven the
   choice. The title is reported because it was observed; it decides nothing
   beyond breaking a tie (see ROLE_SENIORITY), and the workspace still says
   approval authority is not established. */
export function roleRelevance(personRole) {
  return { family: roleFamily(personRole), relevance: 'unknown' };
}

/* ── PROGRESSIVE ENRICHMENT ────────────────────────────────────────────
   Credits are spent on prospects the founder would actually pursue.
   NOT WORTH TIME can never be enriched automatically OR explicitly: there
   is no founder intent that makes spending money on a prospect VISION just
   said to skip a good idea. WATCH is enrichable, but only when the founder
   asks — automatic enrichment of everything VISION merely hasn't ruled out
   is how a credit balance disappears overnight. */
const KNOWN_BANDS = Object.freeze(['priority_now', 'strong_opportunity', 'watch', 'not_worth_time']);

export function enrichmentDecision(rawBand, { explicit = false } = {}) {
  /* FAIL CLOSED ON AN UNKNOWN BAND. This used to fall through to "explicit is
     allowed", so undefined, '', 'nonsense', 'PRIORITY_NOW' and even
     'not_worth_time ' with a trailing space all returned allowed:true —
     including the one band whose whole contract is that it can never be
     enriched. Not client-injectable today, but it becomes a spend bug the
     moment a band is renamed or a tier is added. */
  const band = String(rawBand ?? '').trim().toLowerCase();
  if (!KNOWN_BANDS.includes(band)) {
    return { allowed: false, reason: 'VISION cannot tell how much this prospect is worth yet, so it will not spend to find a contact for it.' };
  }
  if (band === 'not_worth_time') {
    return { allowed: false, reason: 'VISION does not recommend spending time on this prospect, so it will not spend credits finding a contact for it.' };
  }
  if (band === 'priority_now' || band === 'strong_opportunity') {
    return { allowed: true, reason: explicit ? 'requested for a prospect worth pursuing' : 'automatic: a prospect worth pursuing' };
  }
  if (explicit) return { allowed: true, reason: 'requested by the founder for a watch-list prospect' };
  return { allowed: false, reason: 'This prospect is on the watch list. Ask for a contact when you decide to pursue it.' };
}

/* ── FRESHNESS ─────────────────────────────────────────────────────────
   Opening a Workspace must cost nothing. Contacts are re-fetched only when
   genuinely stale, and 30 days is chosen to match the freshness tier the
   engine already applies to evidence generally (see ranking.js's freshness
   dimension, which zeroes credit past thirty days) — one staleness idea,
   not two competing ones. */
export const CONTACT_STALE_AFTER_DAYS = 30;

/* How long a FAILED lookup suppresses another paid attempt. Deliberately
   minutes, not days: a transient outage should not lock a founder out of a
   prospect for a month, but impatience must not be able to spend a credit per
   click either. */
export const CONTACT_RETRY_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Should we spend a credit asking the provider again? Reads the LOOKUP
 * record, not just the contacts, because "we searched and this business
 * publishes nobody" is a real finding that must stop the next request from
 * re-buying it.
 *
 * A legal restriction is permanent here: it is never re-asked, at any age.
 */
export function shouldQueryProvider({ contacts = [], lookup = null, bestContact = undefined,
  now = new Date().toISOString() } = {}) {
  if (lookup?.outcome === 'restricted') {
    return { query: false, reason: 'This provider has refused on legal grounds. VISION will not ask again.' };
  }
  /* WHOSE AGE DECIDES. When a caller names the contact it is actually showing,
     that one's age decides — otherwise the MAX across the set does, which is
     the right question for "is anything here current" but the wrong one for
     "is the address on screen current".

     THE OFFER AND THE SPEND MUST ASK THE SAME FUNCTION. An earlier attempt put
     selectedContactIsStale in contactWorkspaceState only, so the Workspace
     offered a Re-check while this gate still refused it: measured, the button
     was dead in 128 of 160 configurations and clicking it changed nothing at
     all, forever. Either both agree or the founder gets a control that does
     nothing. */
  const stale = bestContact === undefined
    ? contactsAreStale(contacts, now)
    : selectedContactIsStale(bestContact, now);
  if (contacts.length > 0 && !stale) {
    /* 'cached' used to be returned here verbatim, and contactWorkspaceState
       forwarded it into the founder-facing reason, so the entire explanation
       for a priority prospect having no contact was the word "cached". */
    return { query: false, reason: 'VISION already has current contact details for this business.' };
  }
  /* A FAILED LOOK IS RETRYABLE, BUT NOT INSTANTLY. `unavailable` means we
     could not establish anything, so retrying is legitimate — but Hunter bills
     on HTTP 200, and a 200 whose body we cannot parse is recorded as
     `unavailable` too. Measured: that made every retry re-buy the same paid
     response with no ceiling at all. A short cooldown keeps the retry honest
     without pretending the failure was a finding. */
  if (lookup && lookup.outcome === 'unavailable') {
    const nowMs = Date.parse(now);
    const lookedMs = Date.parse(lookup.lookedAt);
    if (Number.isFinite(nowMs) && Number.isFinite(lookedMs)
      && (nowMs - lookedMs) < CONTACT_RETRY_COOLDOWN_MS) {
      return { query: false, retryAfterCooldown: true,
        reason: 'VISION could not reach its contact source a moment ago. It will try again shortly rather than repeat a request that just failed.' };
    }
  }

  /* A previous search that found nobody is respected for the same window a
     contact is, so a barren domain costs one credit per month, not one per
     click. */
  if (lookup && ['none_found', 'found'].includes(lookup.outcome)) {
    const nowMs = Date.parse(now);
    const lookedMs = Date.parse(lookup.lookedAt);
    if (Number.isFinite(nowMs) && Number.isFinite(lookedMs)
      && (nowMs - lookedMs) <= CONTACT_STALE_AFTER_DAYS * 86_400_000) {
      /* `found` WITH NOTHING STORED IS A REAL STATE, and it became reachable
         when the lookup outcome started being recorded BEFORE persistence: a
         storage failure leaves exactly this row. Saying "VISION already has
         current contact details" there is false. */
      if (lookup.outcome === 'found' && contacts.length === 0) {
        return { query: false, reason: 'VISION found contacts for this business but could not store them. Nothing was lost but the contact; try again later.' };
      }
      return { query: false, reason: lookup.outcome === 'none_found'
        ? 'This business publishes no professional contacts. VISION checked recently and will not re-check yet.'
        : 'VISION already has current contact details for this business.' };
    }
  }
  return { query: true, reason: 'no current contact information' };
}

/* THE AGE OF THE CONTACT ON SCREEN, not of the freshest row in the drawer.
   contactsAreStale() takes the MAX lastCheckedAt across the set, which is the
   right question for "should we go and search this domain again". It is the
   WRONG question for "is the address I am showing the founder current",
   because selectBestContact ranks on verification and seniority and never
   looks at age.

   Measured: day 0 Hunter returns zoe@ (Founder) and reception@; day 200 the
   founder re-checks, Zoe has left, Hunter returns reception@ only.
   opportunity_contacts_persist_v1 refreshes last_checked_at only for rows in
   that payload, and zoe@'s row is never deleted — so the SET looks fresh, the
   CHOSEN contact is 200 days old, and it rendered as current with no Re-check
   offered in 0 of the following 12 months. */
export function selectedContactIsStale(bestContact, now = new Date().toISOString()) {
  if (!bestContact) return true;
  const nowMs = Date.parse(now);
  const checked = Date.parse(bestContact.lastCheckedAt);
  if (!Number.isFinite(nowMs)) return false;
  if (!Number.isFinite(checked)) return true;   // undated is not evidence of currency
  return (nowMs - checked) > CONTACT_STALE_AFTER_DAYS * 86_400_000;
}

export function contactsAreStale(contacts = [], now = new Date().toISOString()) {
  if (!Array.isArray(contacts) || contacts.length === 0) return true;
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return false;
  const newest = contacts
    .map((contact) => Date.parse(contact?.lastCheckedAt))
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => b - a)[0];
  if (!Number.isFinite(newest)) return true;
  return (nowMs - newest) > CONTACT_STALE_AFTER_DAYS * 86_400_000;
}

/* ── SELECTION ─────────────────────────────────────────────────────────
   Deterministic. No model, no clock of its own. */
/* SENIORITY AS A TIEBREAK, NOT AS A CLAIM.
   The old scoring took an `offerRoleFamilies` argument and awarded +12 for a
   "relevant" role. No caller ever supplied it — 8 references, all inside this
   file, 0 from production — so roleRelevance always returned 'unknown', the
   +12 was unreachable, and equally-verified contacts fell through to an
   alphabetical tiebreak on the email address. Measured at one firm: Amy Brown
   (Receptionist) was chosen over Zoe Patel (Founder & Principal Dentist),
   because 'amy.brown@' sorts first.

   The fix is NOT to invent who the founder sells to. The Fact Registry holds
   49 facts and not one names a buyer role, so VISION genuinely does not know
   whether the owner or the office manager is the right person here — and
   ROLE_SENIORITY says nothing about that. What it does say is that when two
   addresses are otherwise indistinguishable, an owner is a better opening bet
   than a reception desk, and that ordering observed titles is a far better
   tiebreak than sorting their email addresses. The workspace still reports
   the title as observed, and still says approval authority is not
   established. */
const ROLE_SENIORITY = Object.freeze({
  owner: 4, marketing: 3, operations: 3, sales: 2, partnerships: 2, admin: 1, unknown: 0,
});

function scoreContact(contact) {
  const verification = VERIFICATION_RANK[contact?.verificationStatus] ?? 2;
  /* A known-bad address is never the recommendation, whoever it belongs
     to. */
  if (contact?.verificationStatus === 'invalid') return -1;
  const named = contact?.contactKind === 'personal' && contact?.personName ? 1 : 0;
  const providerConfidence = Number.isFinite(contact?.confidence) ? contact.confidence : 0.5;
  return (verification * 10)
    /* A named human beats a shared mailbox, but only mildly: reception@
       with a valid verification is a better bet than an unverified name. */
    + (named * 6)
    + (providerConfidence * 5)
    /* Deliberately small — it separates ties, it does not outrank
       verification or a confirmed address. */
    + (ROLE_SENIORITY[roleFamily(contact?.personRole)] ?? 0);
}

/**
 * @param {object[]} params.contacts canonical opportunity_contacts rows
 * @param {string} params.leadType 'b2b' | 'b2c'
 * @param {string[]} [params.observedChannels] non-email routes already known
 *   (phone, form) so an alternative can be offered honestly
 * @returns {{bestContact:object|null, bestChannel:string|null, confidence:string,
 *   reason:string, alternatives:object[], contactCount:number}}
 */
export function selectBestContact({
  contacts = [], leadType = 'b2b', observedChannels = [],
  /* GROUNDED ROLE TARGETS, or nothing. `{targets, grounded}` from
     offerRoleTargets() — the functions the founder's own confirmed offer names.
     Omitted or ungrounded means relevance is unknown and ranking falls back to
     evidence quality exactly as before, which is the correct behaviour for a
     founder whose offer names no function. */
  roleTargets = null,
} = {}) {
  const usable = (Array.isArray(contacts) ? contacts : [])
    .filter((contact) => contact && typeof contact.value === 'string' && contact.value.length > 0);

  const alternativesFromChannels = [...new Set(observedChannels)]
    .filter((channel) => channel !== 'email')
    .map((channel) => ({ channel, source: 'observed_route' }));

  if (usable.length === 0) {
    return {
      bestContact: null,
      bestChannel: alternativesFromChannels[0]?.channel || null,
      confidence: 'none',
      reason: alternativesFromChannels.length > 0
        ? 'No individual contact has been found yet. The published route is the only way in so far.'
        : 'No contact has been established for this business yet.',
      alternatives: alternativesFromChannels,
      contactCount: 0,
    };
  }

  /* RELEVANCE IS A TIER, NOT A BIGGER NUMBER.
     Sizing role relevance as points meant tuning it against verification and
     getting an ordering nobody could predict: a verified reception inbox
     scored 50 and a Practice Manager whose address Apollo could not verify
     scored 34, so the founder was handed info@ for an offer aimed squarely at
     the practice manager. Emailing a shared inbox is not a cheaper version of
     emailing the right person; it is a different, usually worse, outcome.

     So a contact whose OBSERVED role matches the function the offer touches
     outranks one that does not, and evidence quality decides within each tier.
     This deliberately lets an unconfirmed address for the right person beat a
     confirmed shared mailbox — and it is safe to do so because nothing here
     changes what VISION RECOMMENDS: verificationEstablishesRoute still lets
     only a confirmed address become "send the email", and the card still
     prints the verification wording. The founder gets the better person and
     the truth about the address. */
  const targets = Array.isArray(roleTargets?.targets) ? roleTargets.targets : [];
  const grounded = roleTargets?.grounded === true && targets.length > 0;
  const relevantTier = (contact) => (grounded
    && contact.contactKind === 'personal'
    && targets.includes(roleFamily(contact.personRole)) ? 1 : 0);

  const ranked = usable
    .map((contact) => ({ contact, score: scoreContact(contact), tier: relevantTier(contact) }))
    /* An invalid address is never promoted by relevance: scoreContact returns
       -1 for it, and the tier is only consulted between contacts that are
       otherwise usable. */
    .sort((a, b) => (b.score < 0 || a.score < 0 ? 0 : b.tier - a.tier)
      || b.score - a.score
      || String(a.contact.normalizedValue || '').localeCompare(String(b.contact.normalizedValue || '')));

  const best = ranked[0].contact;
  const allInvalid = ranked.every((entry) => entry.score < 0);
  if (allInvalid) {
    return {
      bestContact: null, bestChannel: alternativesFromChannels[0]?.channel || null,
      confidence: 'none',
      reason: 'Every address found for this business is known to be bad, so none of them is a route.',
      alternatives: alternativesFromChannels, contactCount: usable.length,
    };
  }

  /* Reported relevance uses the same grounded targets the ranking used, so the
     sentence and the ordering can never disagree. Without targets it stays
     'unknown' — see roleRelevance. */
  const relevance = grounded && best.contactKind === 'personal'
    ? (targets.includes(roleFamily(best.personRole)) ? 'relevant' : 'not_established')
    : roleRelevance(best.personRole).relevance;
  const family = roleFamily(best.personRole);
  const named = best.contactKind === 'personal' && best.personName;
  /* CONFIDENCE IS ABOUT THE ROUTE, NOT THE PERSON'S SENIORITY. */
  const confidence = best.verificationStatus === 'valid' ? 'high'
    : best.verificationStatus === 'invalid' ? 'none'
    : ['accept_all', 'unknown', 'webmail'].includes(best.verificationStatus) ? 'medium'
    : 'low';

  const reasonParts = [];
  if (named) {
    reasonParts.push(best.personRole
      ? `${best.personName} is listed as ${best.personRole}`
      : `${best.personName} is a named contact at this business`);
    if (relevance === 'relevant') reasonParts.push(`a ${family} role relevant to this offer`);
    else if (best.personRole) reasonParts.push('whether they can approve this is not established');
  } else {
    reasonParts.push('This is a shared business address, not an individual');
  }
  reasonParts.push(VERIFICATION_LABEL[best.verificationStatus] || 'Not verified');

  return {
    bestContact: {
      ...best,
      roleFamily: family,
      roleRelevance: relevance,
      verificationLabel: VERIFICATION_LABEL[best.verificationStatus] || 'Not verified',
    },
    bestChannel: best.channel,
    confidence,
    reason: `${reasonParts.join('. ')}.`,
    alternatives: [
      ...ranked.slice(1, 4).map((entry) => ({
        channel: entry.contact.channel, value: entry.contact.value,
        personName: entry.contact.personName, personRole: entry.contact.personRole,
        contactKind: entry.contact.contactKind, verificationStatus: entry.contact.verificationStatus,
        source: 'enriched',
      })),
      ...alternativesFromChannels,
    ],
    contactCount: usable.length,
  };
}

/* ── THE WORKSPACE CONTACT STATE ───────────────────────────────────────
   ONE server-computed verdict the frontend renders without re-deciding
   anything. The client must not re-derive eligibility: it would be a second
   copy of a policy that guards spending, and the two copies would disagree
   the first time either changed. The browser gets a state name and a
   sentence; the server keeps the authority.

   `canRequest` answers only "should the button be offered". It is never
   trusted on the way back in — enrich_prospect_contact re-runs every gate
   server-side, because a button is a suggestion and a request is a claim. */
export const CONTACT_STATES = Object.freeze([
  'has_contact',    // a usable contact is stored; render it
  'none_found',     // we looked and this business genuinely publishes nobody
  'unusable',       // we looked, addresses came back, every one is known bad
  'restricted',     // the provider refuses this domain on legal grounds
  'unavailable',    // we could not look; nothing was established either way
  'available',      // no contact yet, and looking is permitted
  'not_eligible',   // VISION does not recommend spending on this prospect
  'unsupported',    // b2c: a person, not a business directory lookup
]);

/* THESE FOUR USED TO BE ONE STATE, AND THE FOUNDER PAID FOR IT.
   "this business publishes nobody", "we found three addresses and all of them
   bounce", "we are legally barred from asking" and "the lookup failed" are
   four different facts with four different next moves, and they all reported
   as none_found. Measured: a prospect whose every address was invalid told
   the founder "No published contact was found for this business" — the
   opposite of what happened. */

/* Refusals where finding a contact would be the WRONG thing to buy. These
   are not "we don't know how to reach them" — they are "we have been told
   not to", and spending money to reach someone anyway is the one use of
   enrichment a founder should never be offered. Every OTHER refusal
   (notably research_contact_route) is exactly what enrichment fixes. */
/* ONLY A CONFIRMED ADDRESS ESTABLISHES A ROUTE.
   Hunter's vocabulary is valid | invalid | accept_all | webmail | disposable |
   unknown, and only ONE of those is a statement that mail will arrive.
   `accept_all` means the server accepts every address and therefore proves
   nothing about this one; `unknown` means verification never completed;
   `disposable` is a throwaway mailbox; `webmail` is not the company at all.

   Measured before this existed: all five non-invalid states produced the
   identical Next Best Action — "Send the email", urgency "This week" — with a
   byte-identical justification claiming the prospect "is qualified and
   reachable by email". VISION was asserting reachability it had not
   established, which is the one thing this product exists not to do.

   The graded truth was already computed (selection.confidence, and the
   verification label) and simply never reached the decision. */
export const ROUTE_ESTABLISHING_VERIFICATION = Object.freeze(['valid']);
export function verificationEstablishesRoute(status) {
  return ROUTE_ESTABLISHING_VERIFICATION.includes(status);
}

export const CONTACT_FORBIDDEN_CONSENT = Object.freeze(['declined', 'withdrawn']);
/* Exported so the Edge Function can enforce the same rule the browser shows.
   It used to exist only here, which made it advice rather than a guarantee. */
export function consentForbidsEnrichment(consent) {
  /* Accepts the derived consent OBJECT or a bare status string. The object form
     also carries `unrecognisedStatus`, which forbids: a refusal recorded as
     'opted_out' or 'REVOKED' must not read as "we never asked". */
  if (consent && typeof consent === 'object') {
    if (typeof consent.unrecognisedStatus === 'string' && consent.unrecognisedStatus.length > 0) return true;
    return CONTACT_FORBIDDEN_CONSENT.includes(consent.status);
  }
  return CONTACT_FORBIDDEN_CONSENT.includes(consent);
}

const CONTACT_FORBIDDEN_ACTIONS = new Set(['do_not_contact', 'observe_only']);

/* THE SAME GATE THE SERVER ENFORCES, ASKED EARLIER. enrich_prospect_contact
   refuses with no_searchable_domain when domainFromWebsite() rejects the
   business's website — an IP literal, a reserved host, a maps/tracking URL, a
   webmail host, or no website at all. Until this was wired in, the client
   happily offered "Find contact" to a prospect whose lookup could NEVER
   succeed: measured on real staging, the founder clicked, the server answered
   422, and the button came straight back unchanged, ready to be clicked
   forever. Offering an action VISION cannot perform is worse than saying so. */
import { domainFromWebsite } from './hunter.js';

export function contactWorkspaceState({
  contacts = [], lookup = null, band = 'watch', leadType = 'b2b',
  observedChannels = [], action = null,
  officialWebsite = null,
  now = new Date().toISOString(),
} = {}) {
  const selection = selectBestContact({ contacts, leadType, observedChannels });

  if (CONTACT_FORBIDDEN_ACTIONS.has(action)) {
    /* A stored contact is still shown — the founder may already have it and
       hiding it changes nothing about the advice. What is withheld is the
       offer to go and BUY another one. */
    return {
      state: selection.bestContact ? 'has_contact' : 'not_eligible',
      canRequest: false, selection,
      reason: selection.bestContact
        ? 'A contact is on file, but VISION does not recommend approaching this prospect.'
        : 'VISION does not recommend contacting this prospect, so it will not go looking for a way to.',
    };
  }

  /* A stored contact is worth showing whatever the band says. Enrichment
     policy governs SPENDING, not whether a founder may see what was
     already paid for.

     THE STALENESS WINDOW USED TO DIE HERE. This returned canRequest:false
     unconditionally, so shouldQueryProvider — which correctly reports a
     contact older than CONTACT_STALE_AFTER_DAYS as re-checkable — was never
     consulted once a contact existed. Measured: 4 bands x 10 actions x 5 ages
     = 200 combinations, and canRequest was false in all 200. A six-month-old
     address rendered as the current best route, forever, with no way to
     re-check it. Every spend gate still applies: the forbidden-action branch
     above already returned, and band and lead type are re-asked here. */
  if (selection.bestContact) {
    /* Re-check is offered only when it could actually RUN. The domain gate used
       to sit below this branch, so a 95-day-old contact on a prospect with an
       unusable website was offered a Re-check that the server then refused with
       no_searchable_domain — and the button came straight back. */
    const searchable = domainFromWebsite(officialWebsite).ok;
    const stale = leadType === 'b2b'
      && searchable
      && enrichmentDecision(band, { explicit: true }).allowed
      && lookup?.outcome !== 'restricted'
      /* THE SAME GATE THE SERVER ENFORCES, asked about the contact being
         SHOWN. Offering a re-check the server would refuse is a button that
         does nothing. */
      && shouldQueryProvider({ contacts, lookup, bestContact: selection.bestContact, now }).query;
    return {
      state: 'has_contact', canRequest: stale, selection,
      reason: stale
        ? `This contact has not been re-checked in over ${CONTACT_STALE_AFTER_DAYS} days.`
        : 'A contact is already on file for this business.',
    };
  }
  if (leadType !== 'b2b') {
    return { state: 'unsupported', canRequest: false, selection,
      reason: 'Contact lookup is for businesses. This is a person who came to you directly.' };
  }

  /* NOTHING TO SEARCH. Checked before eligibility and before the freshness
     gate, because no amount of founder intent or priority makes a domain
     appear — this is a property of the prospect, not a policy about it. The
     reason names the actual obstacle so the founder knows what would fix it. */
  const domain = domainFromWebsite(officialWebsite);
  if (!domain.ok) {
    return {
      state: 'not_eligible', canRequest: false, selection,
      reason: domain.reason === 'no_official_website'
        ? 'This business publishes no website, and a contact lookup starts from the company domain. Nothing to search yet.'
        : 'The website on file cannot be used for a contact lookup, so there is no company domain to search.',
    };
  }

  /* Explicit intent is what WATCH needs, so eligibility is asked in its
     explicit form — the button is the founder asking. */
  const decision = enrichmentDecision(band, { explicit: true });
  if (!decision.allowed) {
    return { state: 'not_eligible', canRequest: false, selection, reason: decision.reason };
  }

  const gate = shouldQueryProvider({ contacts, lookup, now });
  if (!gate.query) {
    /* WHICH KIND OF "NO" THIS IS. All of these used to report none_found —
       "this business publishes nobody" — including the case where addresses
       were found and every one was dead, and the case where we were legally
       barred from asking. The founder's next move differs in each. */
    if (lookup?.outcome === 'restricted') {
      return { state: 'restricted', canRequest: false, selection, reason: gate.reason };
    }
    if (gate.retryAfterCooldown) {
      return { state: 'unavailable', canRequest: false, selection, reason: gate.reason };
    }
    if (contacts.length > 0) {
      /* selectBestContact already wrote the true sentence for this — it knows
         whether every address was invalid or merely unusable for this lead. */
      return { state: 'unusable', canRequest: false, selection, reason: selection.reason || gate.reason };
    }
    return { state: 'none_found', canRequest: false, selection, reason: gate.reason };
  }
  return { state: 'available', canRequest: true, selection,
    reason: 'No contact has been found for this business yet.' };
}
