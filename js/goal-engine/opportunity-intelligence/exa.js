/* ════════════════════════════════════════════════════════════════════════
   EXA — WHY NOW, and only why now
   ────────────────────────────────────────────────────────────────────────
   Google Places answers "does this business exist and match". Hunter answers
   "can we reach it". Apollo answers "who should we reach". Exa answers the one
   question none of them can:

       something changed at this company recently — is that a reason to act
       this week rather than next quarter?

   NOT A DISCOVERY PROVIDER, and the shape enforces it: this module exposes
   `searchCompanyNews()` and no `discover()`, so selectDiscoveryProvider cannot
   pick it. Using a neural web search to find prospects would be slower,
   dearer and less grounded than the provider that already does it.

   TWO DATES, AND CONFLATING THEM IS THE WHOLE RISK.
     publishedAt   when the world says the thing happened. The only date that
                   can make something recent.
     checkedAt     when WE looked. Says nothing about the company.
   A result with no publishedAt is dropped, not dated to now — an undated
   article about an unknown time cannot establish that now is the moment, and
   stamping it with today's date is how a five-year-old press release becomes
   "they just expanded".

   ENTITY COLLISION IS THE SECOND RISK. "Quay Dental" exists in several
   countries; an expansion in one is not evidence about another. A result must
   independently tie itself to THIS company — by domain, or by naming it — or
   it is discarded rather than assumed.
   ════════════════════════════════════════════════════════════════════════ */
import { DiscoveryProviderError, PROVIDER_FAILURE_REASONS } from './providers.js';

export const EXA_SEARCH_ENDPOINT = 'https://api.exa.ai/search';

function providerError(code, status = null) {
  const known = PROVIDER_FAILURE_REASONS.includes(code) ? code : 'provider_failed';
  const retryable = ['provider_timeout', 'provider_rate_limited', 'provider_unavailable', 'provider_network_error'].includes(known);
  return new DiscoveryProviderError(known, { providerId: 'exa', status, retryable });
}

/* How old a company event may be and still be a reason to act NOW. Ninety days
   is a quarter: long enough that a new location or a funding round is still
   live context, short enough that it is not history. Deliberately a constant a
   reader can argue with rather than a number buried in a comparison. */
export const WHY_NOW_FRESH_DAYS = 90;

/* What kind of change this is. Categories exist so the founder can tell a new
   location from a hiring push without reading three articles, and so nothing
   has to be inferred from prose downstream. `other` is a real answer. */
export const WHY_NOW_CATEGORIES = Object.freeze([
  'expansion', 'contraction', 'ownership_change', 'hiring', 'funding', 'launch', 'campaign',
  'leadership_change', 'other',
]);

/* Ordered: the first match wins, so the more specific patterns lead. These
   classify what a headline SAYS. They do not decide whether it matters — that
   is offer-relative and lives in why-now-intelligence.js. */
const CATEGORY_PATTERNS = Object.freeze([
  { category: 'funding', pattern: /\b(raise[sd]?|raising|funding|seed round|series [a-e]\b|investment round|backed by|secures? \$)/i },
  /* WHO IS THE SUBJECT OF THE DEAL. Tested BEFORE expansion because the two
     are the same words read in opposite directions: a group that BUYS twelve
     centres is expanding, and a group that IS BOUGHT has changed hands. The
     live diagnosis is what forced this apart — every real headline about the
     test prospect ("Beam Dental Bidco Launches Takeover Bid for Pacific
     Smiles", "Pacific Smiles Group to be Delisted Following Acquisition")
     classified as `expansion`, which would have told a founder that a company
     being absorbed and delisted was opening new sites. The patterns here are
     all PASSIVE or ownership-naming ("acquired by", "takeover bid", "stake
     in", "delisted"); the ACTIVE forms ("acquires", "acquisition of") stay
     with expansion below, so direction decides the category. */
  { category: 'ownership_change', pattern: /\b(delist\w*|acquired by|bought by|purchased by|taken over by|takeover (bid|offer|target)|compulsory acquisition|chang(e|es|ed|ing) (of )?ownership|now owned by|sold to|new owner(s|ship)?|stake in|majority stake|merges? with|merger)\b/i },
  /* Acquisitions made BY this company are expansion, and the query asks for
     them by name — asking for something the classifier cannot recognise would
     only produce results we then discard as non-events. */
  { category: 'expansion', pattern: /\b(new (location|branch|clinic|store|site|premises|office)|second (location|clinic|store)|opens? (a|its)?\s*(new|second|third)|expand(s|ing|ed)?|expansion|relocat(e|es|ing|ed)|acquir(e|es|ed|ing)|acquisition)\b/i },
  /* `appoints?` deliberately does NOT live here. Appointing somebody is a
     leadership change; hiring is taking on staff. Both patterns held it and
     hiring is tested first, so "appoints a new principal" classified as
     hiring — and the founder would have been told they are growing the team
     when in fact the person who chooses suppliers just changed. */
  /* A CLOSURE IS AN EVENT. Dropping unclassified results as noEvent made
     VISION blind to the negative half of the news — closures, redundancies,
     administration — which are precisely the events that should stop a founder
     approaching, and which the contradiction detector needs in order to see a
     disagreement at all. Deliberately AFTER expansion, so a headline whose
     subject is an opening ("opens second clinic after nearby practice closes")
     classifies by what it is about rather than by the worst word in it. */
  { category: 'contraction', pattern: /\b(clos(es|ed|ing|ure)|shut(s|ting)?( down)?|ceas(es|ed|ing) (trading|operations)|liquidat\w*|administration|receivership|redundanc\w*|lay(s|ing)? off|laid off|job cuts|downsiz\w*)\b/i },
  { category: 'hiring', pattern: /\b(hiring|now hiring|recruit(s|ing)?|joins? the team|new (hire|role|position)|grow(s|ing) the team)\b/i },
  /* `owner` removed: a new OWNER is an ownership change, not a new person in a
     role, and it is now matched above. `takes over` stays — "takes over as
     practice principal" is a role change, while "taken over by" is matched
     earlier as ownership. */
  { category: 'leadership_change', pattern: /\b(appoints?|steps down|new (ceo|director|principal|partner)|leadership change|chang(e|es|ed|ing) leadership|new leadership|takes over|succeeds?)\b/i },
  { category: 'launch', pattern: /\b(launch(es|ed|ing)?|introduc(es|ed|ing)|new (service|treatment|product|offering)|now offer(s|ing))\b/i },
  /* `sponsor` is NOT here, and the first newsworthy live call is why. A
     LinkedIn post reading "The Inspire 2026 Gala Dinner, sponsored by Envista
     Group..." classified as THIS company's marketing campaign — the sponsor
     was somebody else entirely. The classifier matches words anywhere in the
     text and has no notion of who the subject is, so a word that usually names
     a THIRD PARTY's action is the wrong thing to match on. Losing a genuine
     self-sponsorship is the cheaper error. */
  { category: 'campaign', pattern: /\b(campaign|promotion|advertis\w*|rebrand(s|ed|ing)?|new website)\b/i },
]);

export function classifyWhyNow(text) {
  const value = typeof text === 'string' ? text : '';
  for (const entry of CATEGORY_PATTERNS) {
    if (entry.pattern.test(value)) return entry.category;
  }
  return 'other';
}

function cleanText(value, max = 400) {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/* Tokens worth matching a company on. Drops the legal-form and generic words
   that make everything look like everything: "Dental Pty Ltd" must not match a
   different practice merely because both are dental companies. */
const GENERIC_COMPANY_TOKENS = new Set([
  'the', 'and', 'ltd', 'limited', 'pty', 'inc', 'llc', 'plc', 'co', 'company',
  'group', 'holdings', 'services', 'clinic', 'centre', 'center', 'practice',
  'studio', 'dental', 'medical', 'health', 'care', 'australia', 'sydney',
]);

export function companyTokens(name) {
  return String(name || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !GENERIC_COMPANY_TOKENS.has(t));
}

/**
 * Does this result independently tie itself to THIS company?
 *
 * Returns the strength of the tie, never a boolean, because "published on
 * their own domain" and "mentions a distinctive word from their name" are
 * different qualities of evidence and the caller should be able to say so.
 */
export function entityMatch({ resultUrl, resultText, companyName, companyDomain }) {
  const host = hostOf(resultUrl);
  if (companyDomain && host && (host === companyDomain || host.endsWith(`.${companyDomain}`))) {
    return { matched: true, basis: 'own_domain', confidence: 0.95 };
  }
  const tokens = companyTokens(companyName);
  if (tokens.length === 0) return { matched: false, basis: 'no_distinctive_name', confidence: 0 };
  const haystack = String(resultText || '').toLowerCase();
  const hits = tokens.filter((t) => haystack.includes(t));
  if (hits.length === 0) return { matched: false, basis: 'company_not_mentioned', confidence: 0 };
  /* Naming the company in an article is weaker than publishing it yourself:
     trade press covers many businesses in one piece, and a mention is not a
     statement that the piece is ABOUT them. */
  return {
    matched: true, basis: 'named_in_source',
    confidence: hits.length >= 2 ? 0.7 : 0.5, matchedTokens: hits.slice(0, 5),
  };
}

/**
 * Exa's search payload → grounded Why-Now candidates. PURE.
 *
 * Every returned item carries the SOURCE and the PUBLISHED DATE, and anything
 * lacking either is discarded rather than defaulted. Nothing here decides
 * whether a signal matters to the founder's offer; it decides only what the
 * world actually said and when.
 */
export function normalizeExaSearch(payload, {
  companyName, companyDomain, now = new Date().toISOString(), freshDays = WHY_NOW_FRESH_DAYS,
} = {}) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const nowMs = Date.parse(now);
  const signals = [];
  const discarded = { undated: 0, stale: 0, unmatched: 0, unusable: 0, noEvent: 0 };
  /* WHAT WAS THROWN AWAY, not just how much. Three paid calls returned "5
     results, 5 non-events" and that number cannot distinguish the two answers
     that matter: Exa returned the company's website again (retrieval is
     wrong), or Exa returned real news the classifier failed to place (the
     classifier is wrong). Those need opposite fixes, and counts alone sent the
     last run's diagnosis into guesswork.

     Title and host only, capped, and DELIBERATELY NOT PERSISTED — this is
     diagnostic output for whoever ran the search, not evidence about the
     prospect, and storing rejected material next to accepted material is how
     the two get confused later. */
  const discardedSamples = [];
  const sample = (reason, title, url) => {
    if (discardedSamples.length >= 10) return;
    discardedSamples.push({ reason, title: (title || '').slice(0, 160), host: hostOf(url) });
  };

  for (const item of results) {
    const url = cleanText(item?.url, 500);
    const title = cleanText(item?.title, 300);
    const snippet = cleanText(item?.text || item?.summary, 600);
    if (!url || !title) { discarded.unusable += 1; sample('unusable', title, url); continue; }

    /* NO DATE, NO CLAIM ABOUT NOW. */
    const publishedRaw = item?.publishedDate || item?.published_date || null;
    const publishedMs = Date.parse(publishedRaw);
    if (!Number.isFinite(publishedMs)) { discarded.undated += 1; sample('undated', title, url); continue; }
    /* A future date is a broken feed, not tomorrow's news. */
    if (Number.isFinite(nowMs) && publishedMs > nowMs + 86_400_000) { discarded.undated += 1; sample('future_dated', title, url); continue; }

    const ageDays = Number.isFinite(nowMs) ? Math.floor((nowMs - publishedMs) / 86_400_000) : null;
    if (ageDays === null || ageDays > freshDays) { discarded.stale += 1; sample('stale', title, url); continue; }

    const match = entityMatch({ resultUrl: url, resultText: `${title} ${snippet || ''}`, companyName, companyDomain });
    if (!match.matched) { discarded.unmatched += 1; sample('unmatched', title, url); continue; }

    /* A PAGE IS NOT AN EVENT, and the first real Exa response proved how much
       this matters. Asked about a Sydney dental clinic, Exa returned five
       results — every one from the company's OWN domain, so every one passing
       entity matching at 0.95: "Zoom Whitening Sydney", "Dental Crown Sydney",
       "Cosmetic Dentist Sydney". Static service pages carrying a publishedDate
       from a sitemap. Nothing had happened.

       All five were stored as why-now signals. Dated 46 days back they merely
       read as stale, but dated ten days back the founder would have been told
       "Zoom Whitening Sydney // Lumina Dental (published 10 days ago)" was a
       reason to call this week. That is manufactured urgency built out of a
       price list.

       `other` is exactly the classifier saying no change verb matched — no
       opening, no hire, no launch, no funding, nothing happened. It is
       therefore not a why-now signal, and it is dropped here rather than
       stored and filtered later, so a barren search is recorded as the
       none_found it actually is instead of "we found five things".

       The cost is real and accepted: a genuine news story whose wording no
       pattern recognises is dropped too. Missing a reason is a far smaller
       harm than inventing one, and `other` carries no inference anyway — it
       would have been shown as a bare claim with no reasoning behind it. */
    const category = classifyWhyNow(`${title} ${snippet || ''}`);
    if (category === 'other') { discarded.noEvent += 1; sample('noEvent', title, url); continue; }

    signals.push({
      /* The claim is the SOURCE'S words, not ours. */
      claim: title,
      excerpt: snippet,
      sourceUrl: url,
      sourceHost: hostOf(url),
      publishedAt: new Date(publishedMs).toISOString(),
      ageDays,
      category,
      /* Confidence is about WHETHER THIS IS THE RIGHT COMPANY, not about
         whether the event matters. Exa's own relevance score is carried
         separately and never substituted for it. */
      entityConfidence: match.confidence,
      entityBasis: match.basis,
      providerScore: Number.isFinite(item?.score) ? item.score : null,
      checkedAt: now,
    });
  }

  /* One claim per source URL — a feed that syndicates the same article twice
     is one fact, not two. */
  const seen = new Set();
  const deduped = signals.filter((s) => {
    if (seen.has(s.sourceUrl)) return false;
    seen.add(s.sourceUrl);
    return true;
  });

  return { provider: 'exa', companyDomain: companyDomain || null, signals: deduped, discarded, discardedSamples, checkedAt: now };
}

/**
 * Transport. `searchCompanyNews` and no `discover` — see the header.
 */
export function createExaProvider({
  apiKey, fetchImpl = globalThis.fetch, maxLookups = 1, timeoutMs = 8000, usage = null,
} = {}) {
  const counters = usage || { lookups: 0, successes: 0, failures: 0, lastFailureReason: null };
  return {
    id: 'exa',
    configured: typeof apiKey === 'string' && apiKey.length > 0,
    credentialRequirement: 'EXA_API_KEY',
    getUsage: () => ({ ...counters }),

    async searchCompanyNews(query, {
      companyName, companyDomain, numResults = 5, freshDays = WHY_NOW_FRESH_DAYS, now = new Date().toISOString(),
    } = {}) {
      if (typeof query !== 'string' || query.trim().length === 0) throw providerError('provider_request_rejected');
      if (!this.configured) throw providerError('provider_auth_rejected');
      if (counters.lookups >= maxLookups) throw providerError('provider_rate_limited');
      counters.lookups += 1;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        /* THE DATE FILTER IS SENT, NOT ONLY APPLIED AFTERWARDS. Asking the
           provider for a bounded window costs the same and makes it far less
           likely the whole result set is history we then throw away. */
        const startPublishedDate = new Date(Date.parse(now) - freshDays * 86_400_000).toISOString();
        const response = await fetchImpl(EXA_SEARCH_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            query: query.slice(0, 500),
            type: 'auto',
            category: 'news',
            numResults: Math.max(1, Math.min(10, numResults)),
            startPublishedDate,
            /* THE PROSPECT'S OWN WEBSITE IS NOT NEWS ABOUT THE PROSPECT, and
               until this line it consumed the entire result budget: nine of
               the ten results across two paid calls were the company's own
               marketing pages — "Fees and Payment Options", "About", "Dental
               Crown Sydney". `category: 'news'` did not exclude them and
               `startPublishedDate` could not, because the provider stamps
               evergreen pages with a recent CRAWL date (a fees page came back
               dated three weeks old). Excluding the domain is the only filter
               that actually frees the five slots for third-party coverage.
               The cost is real and accepted: a genuine announcement posted
               only on the company's own site is now unreachable, which is why
               `entity_basis` still carries 'own_domain' for the day a
               newsroom-path allowlist makes those retrievable again. */
            ...(companyDomain ? { excludeDomains: [String(companyDomain).replace(/^www\./i, '')] } : {}),
            contents: { text: { maxCharacters: 600 } },
          }),
          signal: controller.signal,
        });
        if (!response || typeof response.status !== 'number') {
          counters.failures += 1; counters.lastFailureReason = 'provider_malformed_response';
          throw providerError('provider_malformed_response');
        }
        if (!response.ok) {
          const code = response.status === 429 ? 'provider_rate_limited'
            : response.status === 451 ? 'provider_legally_restricted'
            : response.status === 402 ? 'provider_quota_exhausted'
            : [401, 403].includes(response.status) ? 'provider_auth_rejected'
            : response.status >= 500 ? 'provider_unavailable'
            : 'provider_request_rejected';
          counters.failures += 1; counters.lastFailureReason = code;
          throw providerError(code, response.status);
        }
        let payload;
        try { payload = await response.json(); } catch {
          counters.failures += 1; counters.lastFailureReason = 'provider_malformed_response';
          throw providerError('provider_malformed_response');
        }
        const normalized = normalizeExaSearch(payload, { companyName, companyDomain, now, freshDays });
        counters.successes += 1;
        return normalized;
      } catch (error) {
        if (error instanceof DiscoveryProviderError) throw error;
        const code = error?.name === 'AbortError' ? 'provider_timeout' : 'provider_network_error';
        counters.failures += 1; counters.lastFailureReason = code;
        throw providerError(code);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
