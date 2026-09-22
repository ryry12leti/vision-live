/* ════════════════════════════════════════════════════════════════════════
   WHY-NOW INTELLIGENCE — is there a reason to act this week?
   ────────────────────────────────────────────────────────────────────────
   Contact Intelligence answers "can we reach them". Decision-Maker answers
   "who". This layer answers the question a founder actually asks before
   picking up the phone, and it is the one VISION has never been able to
   answer with anything outside its own database:

       something changed at this company — does that make now the moment?

   WHY THIS CANNOT MOVE THE PRIORITY BAND, and why that is not a limitation.
   assessTiming (priority-intelligence.js) scores timing from
   `Math.max(checkedAt)` across the prospect's signals — the date WE LOOKED,
   not the date anything happened. It has exactly four outcomes: live inbound
   intent, current, stale, unknown. There is no slot in it for "a grounded
   external event 18 days ago", so writing an Exa finding into
   opportunity_signals would not express that event at all — it would simply
   stamp today's date on the prospect and make a 60-day-old evidence file read
   as current. That is the forged-freshness defect this codebase has already
   measured once, on the Hunter path, and the guarantee that stopped it was
   structural: enrichment writes nothing the scorer reads.

   The same guarantee holds here. Why-Now signals live in their own store,
   never in opportunity_signals, and nothing in this file is imported by
   ranking.js or priority-intelligence.js. A timing signal alone can never turn
   a bad opportunity into a good one — it can only explain a good one.

   OBSERVED AND INFERRED ARE DIFFERENT SENTENCES.
       Observed:  "Company opened a second location 18 days ago."   (the source)
       Inference: "Expansion MAY increase demand for your service." (hedged)
       Never:     "They desperately need this now."                 (invented)
   whyNowNarrative() emits the first two and has no branch that can produce
   the third.
   ════════════════════════════════════════════════════════════════════════ */
import { WHY_NOW_FRESH_DAYS, WHY_NOW_CATEGORIES } from './exa.js';

export { WHY_NOW_FRESH_DAYS, WHY_NOW_CATEGORIES };

/* A signal this old is history, not context. Distinct from the provider's
   fetch window so the two can diverge without one silently widening the
   other. */
export const WHY_NOW_ACTIONABLE_DAYS = 45;

/* How long a why-now LOOKUP is respected before the same question may be
   bought again. Company news does not change hourly, and a founder reopening
   a prospect five times in a week must not buy five searches. */
export const WHY_NOW_LOOKUP_FRESH_DAYS = 21;

export const WHY_NOW_SKIP_REASONS = Object.freeze([
  'not_b2b', 'not_worth_pursuing', 'contact_forbidden', 'timing_already_established',
  'recently_looked', 'no_searchable_identity', 'restricted',
  /* Was returned by the band gate but never declared here — a caller
     enumerating this list to explain a refusal had no sentence for it. */
  'not_requested',
]);

/* THE QUERY, AND WHY THE FIRST TWO LIVE CALLS RETURNED NOTHING USEFUL.
   It was `${name} ${category} news announcement`, which interpolated the raw
   category SLUG — the actual string sent for a dental group was
   "Pacific Smiles Group dental_practice news announcement". A neural search
   given a company name and the word "news" returns that company, and both live
   calls came back with the company's own service pages and a LinkedIn post.

   This asks for the EVENTS instead. The terms are exactly the categories the
   classifier can recognise, so the search and the interpretation agree about
   what counts as a reason to act — asking for something we cannot classify
   would only produce results we then discard.

   HONESTY ABOUT WHAT THIS IS WORTH: no live call has tested it. Both captured
   payloads were retrieved with the OLD query, so replaying them proves the
   pipeline handles them correctly and proves nothing about whether this query
   finds better ones. That needs a paid call, and it should not be spent until
   there is reason to think the retrieval has actually changed. */
export function whyNowSearchQuery(companyName) {
  const name = String(companyName || '').trim();
  if (!name) return '';
  /* Phrased as the sentence that would INTRODUCE the article rather than as a
     bag of keywords. The previous version appended eight comma-separated
     terms to the company name; against a neural index that dilutes the
     embedding until the only strong term left is the name itself, which is
     exactly why both captured payloads came back as the company's homepage.
     The events are still named — the classifier has to be able to recognise
     whatever this retrieves — but they read as prose. */
  return `Here is a news article about ${name} — opening a new location, being `
    + 'acquired or changing ownership, raising funding, hiring, launching a new '
    + 'service, changing leadership, or closing down:';
}

/* ── IS THERE A TIMING QUESTION WORTH BUYING AN ANSWER TO? ───────────── */

/**
 * Does VISION already know why now?
 *
 * Two ways it can: the prospect reached out (which no external article can
 * improve on), or a grounded why-now signal is already on file and still
 * actionable. Either makes the purchase pointless.
 */
export function timingAlreadyEstablished({ signals = [], whyNowSignals = [], now = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(now);
  /* THEIR OWN INBOUND BEATS ANY ARTICLE. Somebody who contacted you this week
     is the strongest possible timing evidence and it is already free. */
  const intent = (signals || []).filter((s) => s?.kind === 'inbound_intent' && s.evidenceStatus !== 'UNKNOWN');
  for (const s of intent) {
    const age = nowMs - Date.parse(s.checkedAt);
    if (Number.isFinite(age) && age <= 7 * 86_400_000) {
      return { established: true, reason: 'inbound_intent',
        detail: 'This prospect contacted you within the last week. Nothing an article says will beat that as a reason to act now.' };
    }
  }
  const live = (whyNowSignals || []).filter((s) => {
    const age = nowMs - Date.parse(s?.publishedAt);
    return Number.isFinite(age) && age / 86_400_000 <= WHY_NOW_ACTIONABLE_DAYS;
  });
  if (live.length > 0) {
    return { established: true, reason: 'why_now_on_file',
      detail: 'A recent, grounded reason to act is already on file for this prospect.' };
  }
  return { established: false, reason: null, detail: null };
}

/**
 * The full gate. Refuses soonest and cheapest, and — like every other paid
 * path in this codebase — delegates the band policy rather than restating it.
 */
export function whyNowEligibility({
  leadType = 'b2b', band = null, action = null, consent = null,
  companyName = null, signals = [], whyNowSignals = [], lookup = null,
  explicit = false, now = new Date().toISOString(),
  enrichmentDecision,
} = {}) {
  const refuse = (reason, detail) => ({ allowed: false, reason, detail });

  if (leadType !== 'b2b') {
    return refuse('not_b2b', 'Why-now research is about a company changing. This is a person who came to you directly.');
  }
  if (consent && (consent.unrecognisedStatus || ['declined', 'withdrawn'].includes(consent.status))) {
    return refuse('contact_forbidden', 'This prospect has refused contact, so VISION will not spend on a reason to approach them.');
  }
  if (['do_not_contact', 'observe_only'].includes(action)) {
    return refuse('contact_forbidden', 'VISION does not recommend approaching this prospect, so a reason to act now would be useless.');
  }
  /* ONE BAND POLICY. Injected rather than imported so this module stays free
     of the contact layer; the caller passes the same enrichmentDecision every
     other paid path uses, and an unrecognised band fails closed there. */
  if (typeof enrichmentDecision === 'function') {
    const decision = enrichmentDecision(band, { explicit });
    if (!decision.allowed) {
      return refuse(
        String(band ?? '').trim().toLowerCase() === 'not_worth_time' ? 'not_worth_pursuing' : 'not_requested',
        decision.reason);
    }
  } else if (String(band ?? '').trim().toLowerCase() === 'not_worth_time') {
    return refuse('not_worth_pursuing', 'VISION does not recommend spending time on this prospect.');
  }

  /* WHY-NOW NEVER RUNS ON ITS OWN. Three paid calls returned nothing usable,
     and the diagnosis was not a bug in this layer: VISION sells to local
     service businesses, and a single-site clinic generates no indexed news
     however well the search is phrased. A layer that auto-ran across a book
     of such prospects would spend steadily to be told 'none_found' — so the
     founder asks for it, on the prospects they have reason to think are
     covered. That is what makes this OPTIONAL rather than part of the funnel,
     and the band policy above still applies on top of the request. */
  if (!explicit) {
    return refuse('not_requested',
      'VISION only researches a reason to act now when you ask. Most local businesses '
      + 'publish no news, so this is worth spending on for prospects likely to appear '
      + 'in public coverage — multi-site groups, funded companies, or businesses you '
      + 'have seen written about.');
  }

  /* Without a distinctive name there is nothing to search FOR, and a search
     that cannot be tied back to this company can only produce collisions. */
  if (!companyName || String(companyName).trim().length < 3) {
    return refuse('no_searchable_identity', 'This prospect has no distinctive company name to research.');
  }

  if (lookup?.outcome === 'restricted') {
    return refuse('restricted', 'This source has refused on legal grounds. VISION will not ask again.');
  }
  const lookedMs = Date.parse(lookup?.lookedAt);
  const nowMs = Date.parse(now);
  if (lookup && Number.isFinite(lookedMs) && Number.isFinite(nowMs)) {
    const ageDays = (nowMs - lookedMs) / 86_400_000;
    if (['found', 'none_found'].includes(lookup.outcome) && ageDays <= WHY_NOW_LOOKUP_FRESH_DAYS) {
      return refuse('recently_looked', lookup.outcome === 'none_found'
        ? 'VISION recently looked for a reason to act now and found nothing published. It will not buy that answer again yet.'
        : 'VISION recently researched why now for this prospect. Reusing that answer rather than buying it twice.');
    }
    if (lookup.outcome === 'unavailable' && (nowMs - lookedMs) < 15 * 60 * 1000) {
      return refuse('recently_looked', 'That research source could not be reached a moment ago. VISION will try again shortly.');
    }
  }

  const established = timingAlreadyEstablished({ signals, whyNowSignals, now });
  if (established.established) return refuse('timing_already_established', established.detail);

  return { allowed: true, reason: 'timing_unknown',
    detail: 'Nothing on file explains why this week rather than next quarter.' };
}

/* ── WHAT THE FOUNDER IS TOLD ──────────────────────────────────────────── */

/* What each category may be SUGGESTED to mean, hedged. Deliberately all
   "may" — none of these is a finding about the prospect's need, and the
   wording is the guard: there is no template here that can assert one. */
const CATEGORY_INFERENCE = Object.freeze({
  /* Covers acquisitions too, now that the classifier recognises them — "opening
     or moving premises" is the wrong sentence for a group that just bought
     twelve centres. */
  expansion: 'Opening, moving or acquiring sites often comes with a push for new customers.',
  /* THE ONE CATEGORY THAT ARGUES AGAINST ACTING. A business contracting is not
     a sales opening dressed as bad news, and saying so is the whole reason
     negative events are classified rather than discarded. */
  contraction: 'A business contracting is usually a reason to wait rather than to approach. Confirm what is actually happening before spending effort here.',
  hiring: 'Hiring usually means capacity is growing, which can create pressure to fill it.',
  funding: 'New funding often precedes spending on growth.',
  launch: 'A new service usually needs an audience told about it.',
  /* Hedged like every sibling. This read "They ARE already spending attention
     on marketing" — an assertion about the prospect derived from one headline,
     which is the shape of claim this layer exists not to make. */
  campaign: 'Visible marketing activity may mean the topic is already live for them.',
  /* Deliberately two-sided. New ownership does open supplier reviews, but it
     just as often freezes every decision until the transition settles, and a
     founder told only the first half would read a takeover as a buying
     signal. Naming both is the honest form of this one. */
  ownership_change: 'New ownership often triggers a review of suppliers, though decisions can also freeze while the change settles. Confirm who decides now before approaching.',
  leadership_change: 'A new person in a role often reviews existing suppliers.',
  other: null,
});

/**
 * Rank grounded signals by how much they could justify acting now. Never
 * invents a reason; orders reasons that already exist.
 */
export function rankWhyNowSignals(signals = [], { now = new Date().toISOString() } = {}) {
  const nowMs = Date.parse(now);
  return [...(signals || [])]
    .map((s) => {
      const ageDays = Number.isFinite(Date.parse(s?.publishedAt)) && Number.isFinite(nowMs)
        ? Math.floor((nowMs - Date.parse(s.publishedAt)) / 86_400_000) : null;
      const actionable = ageDays !== null && ageDays <= WHY_NOW_ACTIONABLE_DAYS;
      return { ...s, ageDays, actionable };
    })
    /* Entity confidence FIRST: being about the right company matters more than
       being recent. A fresh article about somebody else is worth nothing. */
    .sort((a, b) => (b.entityConfidence ?? 0) - (a.entityConfidence ?? 0)
      || (a.ageDays ?? 1e9) - (b.ageDays ?? 1e9));
}

/**
 * Where sources disagree, say so rather than picking a winner.
 *
 * Two sources in the same category within a fortnight corroborate. Two that
 * contradict — an expansion and a closure, a hire and a departure — are
 * reported as unresolved, because guessing which is true is exactly the
 * confident-wrong answer this product refuses.
 */
const CONTRADICTORY_PAIRS = [
  ['expansion', /\b(clos(es|ed|ing|ure)|shut(s|ting)?( down)?|ceas(es|ed|ing)|liquidat\w*|administration)\b/i],
  ['hiring', /\b(redundanc\w*|lay(s|ing)? off|laid off|job cuts|downsiz\w*)\b/i],
];

export function resolveWhyNowConflicts(signals = []) {
  const conflicts = [];
  for (const [category, opposite] of CONTRADICTORY_PAIRS) {
    const positives = signals.filter((s) => s.category === category);
    const positiveUrls = new Set(positives.map((s) => s.sourceUrl));
    /* A CONFLICT NEEDS TWO SOURCES. Filtering the two sides independently let a
       SINGLE article count as both — "opens second clinic after nearby practice
       closes" was reported to the founder as sources disagreeing about this
       company, when one source had described one coherent event. Disagreement
       is something that happens BETWEEN sources; a piece mentioning somebody
       else's closure is context, not contradiction. */
    const negatives = signals.filter((s) => !positiveUrls.has(s.sourceUrl)
      && opposite.test(`${s.claim} ${s.excerpt || ''}`));
    if (positives.length > 0 && negatives.length > 0) {
      conflicts.push({
        category,
        detail: `Sources disagree about this company: one reports ${category}, another reports the opposite. VISION cannot tell which is current.`,
        sourceUrls: [...positives, ...negatives].map((s) => s.sourceUrl).slice(0, 4),
      });
    }
  }
  return { conflicts, unresolved: conflicts.length > 0 };
}

/**
 * The founder-facing account. Observed and Inference are separate FIELDS, not
 * one paragraph, so the UI cannot accidentally present a hedge as a finding.
 */
export function whyNowNarrative(signals = [], { now = new Date().toISOString() } = {}) {
  const ranked = rankWhyNowSignals(signals, { now });
  const { conflicts, unresolved } = resolveWhyNowConflicts(ranked);
  const usable = ranked.filter((s) => s.actionable);

  if (ranked.length === 0) {
    return {
      state: 'none_found', observed: null, inference: null, conflicts: [],
      caveat: 'VISION found no recent public reason that now is a better moment than any other. That is not a mark against this prospect.',
      signals: [],
    };
  }
  if (usable.length === 0) {
    const oldest = ranked[0];
    return {
      state: 'stale', observed: null, inference: null, conflicts,
      caveat: `The most recent thing VISION found about this company was published ${oldest.ageDays} days ago, which is too old to make now the moment.`,
      signals: ranked,
    };
  }

  const best = usable[0];
  return {
    state: unresolved ? 'conflicting' : 'established',
    /* THE SOURCE'S WORDS AND ITS DATE, together. A claim without its date is
       how "opened a second location" becomes undated folklore. */
    observed: `${best.claim} (published ${best.ageDays} day${best.ageDays === 1 ? '' : 's'} ago).`,
    /* Hedged, and only where the category has something honest to suggest. */
    inference: CATEGORY_INFERENCE[best.category] || null,
    sourceUrl: best.sourceUrl,
    publishedAt: best.publishedAt,
    category: best.category,
    entityBasis: best.entityBasis,
    conflicts,
    caveat: unresolved
      ? 'Sources disagree about this company, so treat this as unconfirmed and ask rather than assert.'
      : (best.entityBasis === 'named_in_source'
        ? 'This was reported by a third party rather than published by the company, so confirm it before relying on it.'
        : null),
    signals: ranked,
  };
}

/* THE ONE THING THIS LAYER MAY NEVER PRODUCE. Exported so a test can assert
   against the real list rather than a copy, and so the rule is legible. */
export const FORBIDDEN_URGENCY_PATTERNS = Object.freeze([
  /\bdesperate\w*/i, /\burgently needs?\b/i, /\bmust act now\b/i, /\bneeds? (our|your) (service|help)\b/i,
  /\bperfect timing\b/i, /\bready to buy\b/i, /\bwill definitely\b/i, /\bguaranteed\b/i,
]);

export function assertsUnfoundedUrgency(text) {
  const value = typeof text === 'string' ? text : '';
  return FORBIDDEN_URGENCY_PATTERNS.some((p) => p.test(value));
}

/* ═══════════════════ THE ONE WHY NOW ═══════════════════════════════════
   Until this function there were TWO unrelated answers to "why now", built
   by different layers and never compared. `whyNowNarrative` above described
   grounded external events and never reached the Workspace; the Workspace
   showed a freshness sentence from prospect-intelligence that says something
   about VISION's research rather than about the prospect's week. A founder
   could therefore be told "nothing here is time-sensitive" on a prospect
   whose acquisition VISION had already stored.

   ONE ANSWER, WITH ITS TIER STATED. The tier is part of the output and not a
   private detail, because "they were acquired 12 days ago" and "they still
   have no booking page" are both real and are NOT the same kind of claim.
   Collapsing them into one confident sentence is precisely how a timing
   layer starts manufacturing urgency.

   THE HIERARCHY IS STRICT AND FAILS DOWNWARD, never upward: a weaker tier can
   never be promoted by adding more of it. Ten stale articles do not make a
   verified event, and a strong need never becomes an event.
   ══════════════════════════════════════════════════════════════════════ */

export const WHY_NOW_TIERS = Object.freeze([
  'verified_event',   // 1 — a dated, attributed, entity-matched external event
  'recent_change',    // 2 — a dated first-party signal from the prospect itself
  'unresolved_need',  // 3 — no event; the observed gap, labelled as the weaker reason
  'none',             // 4 — nothing. Said plainly.
]);

/* What a real event suggests, and what to ASK about it. Every entry is
   hedged and every question is open: the event is a reason to start the
   conversation, never evidence of what they need. `angle` completes
   "I saw ..." so it can never assert an outcome. */
const EVENT_SCRIPT = Object.freeze({
  expansion: {
    angle: 'you have recently expanded',
    question: 'How are you handling customer acquisition across the new sites?',
    discovery: 'What changed operationally when the new location came on?',
  },
  ownership_change: {
    angle: 'the ownership of the business has recently changed',
    question: 'Who is making decisions on marketing while that settles?',
    discovery: 'Has the change altered what you are planning for this year?',
  },
  funding: {
    angle: 'you have recently raised',
    question: 'What are the first things you are putting that behind?',
    discovery: 'Is customer acquisition part of what the raise is meant to fund?',
  },
  hiring: {
    angle: 'you have been hiring',
    question: 'Is the extra capacity ahead of demand, or catching up with it?',
    discovery: 'What would need to be true to keep the new team busy?',
  },
  launch: {
    angle: 'you have launched something new',
    question: 'How are you getting that in front of people so far?',
    discovery: 'Who is the new service aimed at?',
  },
  leadership_change: {
    angle: 'there has been a change in who is leading things',
    question: 'Is that changing how you are approaching marketing?',
    discovery: 'Are existing suppliers being reviewed as part of that?',
  },
  /* DELIBERATELY NOT A SALES TRIGGER. A business closing sites or shedding
     staff is a reason to be careful, and the question asks whether it is even
     the right time rather than prospecting into bad news. */
  contraction: {
    angle: 'things have been changing on your side recently',
    question: 'Is now a sensible time to be talking, or would later be better?',
    discovery: null,
  },
  campaign: {
    angle: 'you have had some marketing activity running',
    question: 'How is that going so far?',
    discovery: 'Who is looking after that at the moment?',
  },
  other: { angle: null, question: null, discovery: null },
});

/* Events that argue for WAITING rather than approaching. Kept as data so
   both the narrative and the action layer read the same list. */
export const WHY_NOW_CAUTION_CATEGORIES = Object.freeze(['contraction', 'ownership_change']);

function relativeAge(days) {
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * The single Why Now for a prospect. Pure; decides nothing about spend.
 *
 * @param {object[]} whyNowSignals stored grounded external events (tier 1)
 * @param {object[]} timingReasons dated first-party signals (tier 2)
 * @param {object|null} offerGap the observed, addressable gap (tier 3)
 * @param {object|null} freshness context.freshness
 * @param {boolean} researchAvailable whether asking a source is even possible
 */
export function resolveWhyNow({
  whyNowSignals = [], timingReasons = [], offerGap = null,
  freshness = null, researchAvailable = false, now = new Date().toISOString(),
} = {}) {
  const base = {
    tier: 'none', eventDriven: false, headline: null, when: null, whenLabel: null,
    why: null, confidence: 'none', category: null, sourceUrl: null, caveat: null,
    caution: false, conflicts: [], researchAvailable: researchAvailable === true,
  };

  /* ── TIER 1 ─────────────────────────────────────────────────────────── */
  if (Array.isArray(whyNowSignals) && whyNowSignals.length > 0) {
    const n = whyNowNarrative(whyNowSignals, { now });
    if (n.state === 'established' || n.state === 'conflicting') {
      const best = (n.signals || []).find((s) => s.actionable) || n.signals[0];
      return {
        ...base,
        tier: 'verified_event',
        eventDriven: true,
        headline: best?.claim || n.observed,
        when: best?.publishedAt || n.publishedAt || null,
        whenLabel: relativeAge(best?.ageDays),
        why: n.inference,
        /* An event we could not tie confidently to THIS company, or that
           sources disagree about, is reported as medium — never as the same
           thing as a first-party announcement. */
        confidence: n.state === 'conflicting' ? 'low'
          : (best?.entityBasis === 'own_domain' && (best?.entityConfidence ?? 0) >= 0.8 ? 'high' : 'medium'),
        category: n.category || best?.category || null,
        sourceUrl: n.sourceUrl || best?.sourceUrl || null,
        caveat: n.caveat,
        caution: WHY_NOW_CAUTION_CATEGORIES.includes(n.category || best?.category),
        conflicts: n.conflicts || [],
      };
    }
    /* STALE IS NOT AN EVENT. Falling through is the whole point: an old
       article must not outrank a current unmet need, and must never be
       redressed as "recent". */
    if (n.state === 'stale') base.caveat = n.caveat;
  }

  /* ── TIER 2 ─────────────────────────────────────────────────────────── */
  const dated = (Array.isArray(timingReasons) ? timingReasons : [])
    .filter((r) => r && r.statement);
  if (dated.length > 0) {
    return {
      ...base,
      tier: 'recent_change',
      eventDriven: true,
      headline: dated[0].statement,
      when: dated[0].at || null,
      whenLabel: dated[0].at ? relativeAge(Math.floor((Date.parse(now) - Date.parse(dated[0].at)) / 86_400_000)) : null,
      why: 'This is recent activity from the prospect itself, which usually means the topic is already live for them.',
      confidence: 'high',
      caveat: base.caveat,
    };
  }

  /* ── TIER 3 ─────────────────────────────────────────────────────────── */
  if (offerGap && offerGap.detail) {
    return {
      ...base,
      tier: 'unresolved_need',
      eventDriven: false,
      headline: offerGap.detail,
      why: 'This is a standing gap rather than something that just happened, so it is a reason to act — not a reason that today is better than next week.',
      confidence: freshness && freshness.fresh === false ? 'low' : 'medium',
      caveat: freshness && freshness.fresh === false
        ? 'The evidence behind this is out of date. Refresh it before opening a conversation built on it.'
        : base.caveat,
    };
  }

  /* ── TIER 4 ─────────────────────────────────────────────────────────── */
  return {
    ...base,
    tier: 'none',
    why: 'No strong external timing event is currently verified. The opportunity is based on the observed need, not artificial urgency.',
    caveat: base.caveat,
  };
}

/** One sentence, for the places that still carry Why Now as a string. */
export function whyNowSentence(resolved) {
  if (!resolved) return '';
  if (resolved.tier === 'verified_event' || resolved.tier === 'recent_change') {
    const when = resolved.whenLabel ? ` (${resolved.whenLabel})` : '';
    return `${resolved.headline}${when}${resolved.why ? ` ${resolved.why}` : ''}`.trim();
  }
  if (resolved.tier === 'unresolved_need') {
    return `${resolved.headline} ${resolved.why}`.trim();
  }
  return String(resolved.why || '');
}

/** What to say about a real event. Returns nulls when there is nothing real. */
export function whyNowScript(resolved) {
  const empty = { angle: null, question: null, discovery: null };
  if (!resolved || resolved.tier !== 'verified_event') return empty;
  const entry = EVENT_SCRIPT[resolved.category] || EVENT_SCRIPT.other;
  return { angle: entry.angle, question: entry.question, discovery: entry.discovery };
}
