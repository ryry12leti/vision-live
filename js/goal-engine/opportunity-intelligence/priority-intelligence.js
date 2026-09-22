/* ════════════════════════════════════════════════════════════════════════
   PRIORITY INTELLIGENCE — "is this worth MY time?", asked separately from
   "is this a valid lead?"
   ────────────────────────────────────────────────────────────────────────
   TWO QUESTIONS, TWO LAYERS, DELIBERATELY NOT MERGED.

     VALID LEAD?    ranking.js, threshold 30, UNCHANGED. A real business of
                    the right type that can actually be reached.
     WORTH MY TIME? this file. Offer-relative. A perfectly valid lead can be
                    worth nothing to THIS founder with THIS offer.

   Why they must stay apart: qualification is a property of the prospect,
   priority is a property of the PAIR (prospect, offer). The same dental
   practice is a strong opportunity for a booking-system agency and a waste
   of time for someone selling the booking system it already has. Folding
   the second question into the first would make one score mean two things
   and quietly answer neither.

   WHAT THIS FIXES. Measured, not asserted: a simulation of ten businesses
   (scripts/qa-leads-discovery-simulation.mjs) had the practice with an
   already-excellent website rank FIRST for a website agency, because
   ranking.js's opportunityRelevance scores a known booking route (100)
   above an observed absence (90). That dimension answers "do we know how to
   approach them" -- a real question, correctly weighted for what it asks,
   and simply not the question "do they need what I sell". This file asks
   the second one.

   NOTHING HERE INVENTS EVIDENCE. Every factor reports its own evidence
   status, and UNKNOWN is a first-class answer that costs a lead its
   priority rather than being rounded down to zero and forgotten. A factor
   with no evidence never contributes a number.
   ════════════════════════════════════════════════════════════════════════ */

import { signalsOfKind } from './signals.js';

/* The four bands, in the founder's own words. These are exactly the four
   the locked frontend already renders (js/leads-ui.js BANDS), which until
   now were a relabelling of the next action -- so "Not worth time" was
   literally unreachable for a discovered business. */
export const PRIORITY_BANDS = Object.freeze(['priority_now', 'strong_opportunity', 'watch', 'not_worth_time']);

/* Legacy band keys the board and view model already use. Kept as the wire
   format so this layer can drive banding without a frontend change. */
export const PRIORITY_BAND_TO_LEGACY = Object.freeze({
  priority_now: 'now', strong_opportunity: 'strong', watch: 'watch', not_worth_time: 'no',
});

/* ── THE CLOSED GAP VOCABULARY ─────────────────────────────────────────
   A gap is something an offer can CLOSE, detected from structured signals
   only. This list is deliberately short and closed: an open-ended gap
   vocabulary becomes a prose-matching engine within two releases. */
export const OFFER_GAP_KINDS = Object.freeze([
  'no_website',           // nothing published at all
  'no_conversion_route',  // site read; no booking, ordering, quote, enquiry or contact route
  'no_online_booking',    // reachable, but no self-serve booking/ordering route
  'thin_reputation',      // little or no public review evidence
]);

const NEED_WEIGHT = Object.freeze({
  no_website: 100, no_conversion_route: 95, no_online_booking: 75, thin_reputation: 55,
});
const SELF_SERVE_ROUTES = new Set(['booking', 'ordering']);
const THIN_REVIEW_COUNT = 25;
const STALE_AFTER_DAYS = 30;
const LIVE_INTENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const bounded = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0);
const factor = (score, evidenceStatus, detail) => ({ score: bounded(score), evidenceStatus, detail });
const unknownFactor = (detail) => ({ score: 0, evidenceStatus: 'UNKNOWN', detail });

/* ── GAP DETECTION ─────────────────────────────────────────────────────
   Reads only structured signals. Every returned gap carries the evidence
   status of the signal that established it, so a gap inferred from a site
   we could not read can never be presented as a fact. */
export function detectOfferGaps(signals = []) {
  const gaps = [];
  const paths = signalsOfKind(signals, 'conversion_path');
  const informative = paths.filter((s) => s.evidenceStatus !== 'UNKNOWN');
  const listing = signalsOfKind(signals, 'listing')[0] || null;
  const reputation = signalsOfKind(signals, 'reputation')[0] || null;

  const noWebsite = paths.find((s) => s.value?.noWebsiteListed === true)
    || (listing && listing.value?.hasOfficialWebsite === false ? listing : null);
  if (noWebsite) {
    gaps.push({ gap: 'no_website', evidenceStatus: noWebsite.evidenceStatus, sourceUrl: noWebsite.sourceUrl || null,
      detail: 'No website is published, so there is nothing for a customer to arrive at.' });
  }

  const noneFound = paths.find((s) => s.value?.inspected === true && Array.isArray(s.value?.routes) && s.value.routes.length === 0);
  if (noneFound) {
    gaps.push({ gap: 'no_conversion_route', evidenceStatus: noneFound.evidenceStatus, sourceUrl: noneFound.sourceUrl || null,
      detail: 'The website was read and exposes no booking, ordering, quote, enquiry or contact route.' });
  }

  /* Only claimable when the site was actually INSPECTED. A business whose
     page we never read may well have a booking button we never saw, and
     "no online booking" would then be a fabricated weakness. */
  const inspected = paths.filter((s) => s.value?.inspected === true);
  const hasSelfServe = inspected.some((s) => SELF_SERVE_ROUTES.has(s.value?.route));
  if (inspected.length > 0 && !hasSelfServe && !noneFound) {
    const anchor = inspected[0];
    gaps.push({ gap: 'no_online_booking', evidenceStatus: anchor.evidenceStatus, sourceUrl: anchor.sourceUrl || null,
      detail: 'The website was read and offers no self-serve booking or ordering route.' });
  }

  if (reputation) {
    const count = reputation.value?.userRatingCount;
    if (Number.isInteger(count) && count < THIN_REVIEW_COUNT) {
      gaps.push({ gap: 'thin_reputation', evidenceStatus: reputation.evidenceStatus, sourceUrl: reputation.sourceUrl || null,
        detail: `Only ${count} public review${count === 1 ? '' : 's'} on record.` });
    }
  } else if (informative.length > 0) {
    gaps.push({ gap: 'thin_reputation', evidenceStatus: 'INFERRED', sourceUrl: null,
      detail: 'No public rating or review evidence was found at all.' });
  }

  return gaps;
}

/* ── THE SIX FACTORS ───────────────────────────────────────────────────
   Each answers one plain question and reports how well it actually knows. */

/* Is THIS specific gap positively established as already closed? One
   question per gap, answered only by evidence that settles that gap —
   never by "some route exists somewhere". Silence is never a yes. */
function gapAlreadyClosed(gap, signals) {
  const paths = signalsOfKind(signals, 'conversion_path');
  const observedRoutes = paths
    .filter((s) => s.evidenceStatus === 'OBSERVED' && typeof s.value?.route === 'string')
    .map((s) => s.value.route);
  if (gap === 'no_website') {
    const listing = signalsOfKind(signals, 'listing')[0];
    return listing?.value?.hasOfficialWebsite === true;
  }
  if (gap === 'no_conversion_route') return observedRoutes.length > 0;
  /* Only a SELF-SERVE route closes this one. A phone number or a contact
     form is a way to reach a human, not the online booking the offer sells. */
  if (gap === 'no_online_booking') return observedRoutes.some((route) => SELF_SERVE_ROUTES.has(route));
  if (gap === 'thin_reputation') {
    const reputation = signalsOfKind(signals, 'reputation')[0];
    const count = reputation?.value?.userRatingCount;
    return Number.isInteger(count) && count >= THIN_REVIEW_COUNT;
  }
  return false;
}

/** NEED — do they need what this founder sells? The only offer-relative
 *  factor, and the one the engine was missing entirely. */
function assessNeed(signals, offerAddresses) {
  const addressable = Array.isArray(offerAddresses)
    ? offerAddresses.filter((gap) => OFFER_GAP_KINDS.includes(gap)) : [];
  if (addressable.length === 0) {
    /* THE HONEST DEGRADATION. Without a declared offer scope this layer
       cannot rank by need, and it says so instead of substituting a proxy.
       Nothing reaches PRIORITY NOW on need it never established. */
    return { ...unknownFactor('This offer has not declared which gaps it closes, so need cannot be assessed.'), gaps: [] };
  }
  const gaps = detectOfferGaps(signals).filter((entry) => addressable.includes(entry.gap));
  if (gaps.length === 0) {
    /* NEED IS ABSENT ONLY IF EVERY GAP THIS OFFER CLOSES IS DEMONSTRABLY
       ALREADY CLOSED — checked one gap at a time, against the evidence that
       actually settles THAT gap.

       Two live defects sit behind this. Requiring inspected===true meant a
       business whose booking URL the provider publishes read as "unknown",
       sending a practice that already has exactly what the founder sells
       back into WATCH. Accepting ANY observed route instead swung it the
       other way: a listed PHONE number marked every business as solved,
       including ones that plainly still need a booking system. A phone is a
       route; it is not the thing this offer provides.

       DELIBERATELY ASYMMETRIC WITH detectOfferGaps ABOVE, which still
       requires inspected===true. Positive evidence that a route exists may
       come from a page read or a provider listing; a claim that a route is
       ABSENT may only come from having looked. A provider not listing a
       booking URL is silence, not a finding. */
    const unresolved = addressable.filter((gap) => !gapAlreadyClosed(gap, signals));
    if (unresolved.length > 0) {
      /* Two different kinds of not-knowing, and the founder is told which.
         "We never looked" and "we looked and some of it is still open" are
         different states, and collapsing them into one sentence would hide
         which one a refresh would actually fix. */
      const readAnything = signalsOfKind(signals, 'conversion_path').some((s) => s.evidenceStatus !== 'UNKNOWN');
      return {
        ...unknownFactor(readAnything
          ? 'Nothing establishes whether this business still needs what this offer provides.'
          : 'Nothing was read about this business that would show whether it needs this offer.'),
        gaps: [],
      };
    }
    /* OBSERVED ABSENCE OF NEED. We looked, and they already have what this
       offer provides. This is the finding that makes NOT WORTH TIME real. */
    return {
      score: 0, evidenceStatus: 'OBSERVED', gaps: [],
      detail: 'They already have what this offer provides — every gap it closes was checked and none is present.',
      alreadySolved: true,
    };
  }
  const best = gaps.reduce((left, right) => (NEED_WEIGHT[right.gap] > NEED_WEIGHT[left.gap] ? right : left));
  const observed = gaps.some((entry) => entry.evidenceStatus === 'OBSERVED');
  return {
    score: bounded(NEED_WEIGHT[best.gap] * (observed ? 1 : 0.6)),
    evidenceStatus: observed ? 'OBSERVED' : 'INFERRED',
    detail: best.detail, gaps,
  };
}

/** VALUE — how much is solving it plausibly worth? Demand evidence only,
 *  and INFERRED forever: review volume is not revenue and must never be
 *  presented as though it were. */
function assessValue(signals) {
  const reputation = signalsOfKind(signals, 'reputation')[0];
  const count = reputation?.value?.userRatingCount;
  const rating = Number(reputation?.value?.rating);
  if (!reputation || !Number.isInteger(count)) {
    return unknownFactor('No public demand evidence, so the size of the opportunity is unknown.');
  }
  const volume = Math.min(100, (count / 200) * 100);
  const quality = Number.isFinite(rating) ? Math.min(100, (rating / 5) * 100) : 50;
  return factor((volume * 0.7) + (quality * 0.3), 'INFERRED',
    `${count} public review${count === 1 ? '' : 's'}${Number.isFinite(rating) ? ` at ${rating}` : ''} suggests established demand.`);
}

/** TIMING — why now rather than any other week? */
function assessTiming(signals, now) {
  const nowMs = Date.parse(now);
  const intent = signalsOfKind(signals, 'inbound_intent')
    .filter((s) => s.evidenceStatus !== 'UNKNOWN')
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
  if (intent && Number.isFinite(nowMs) && (nowMs - Date.parse(intent.checkedAt)) <= LIVE_INTENT_WINDOW_MS) {
    return factor(100, 'OBSERVED', 'They reached out within the last day — this is live.');
  }
  const dated = signals.filter((s) => s.evidenceStatus !== 'UNKNOWN' && Number.isFinite(Date.parse(s.checkedAt)));
  if (!Number.isFinite(nowMs) || dated.length === 0) {
    return unknownFactor('No dated evidence, so nothing establishes that now is the moment.');
  }
  const ageDays = (nowMs - Math.max(...dated.map((s) => Date.parse(s.checkedAt)))) / 86_400_000;
  if (ageDays > STALE_AFTER_DAYS) {
    return factor(0, 'OBSERVED', `The evidence is ${Math.round(ageDays)} days old and should be refreshed before acting.`);
  }
  /* NO URGENCY IS NOT A FAULT. Most good B2B prospects are simply not
     time-sensitive, and inventing urgency is how a founder learns to
     distrust the ordering. */
  return factor(50, 'OBSERVED', 'The evidence is current. Nothing makes this urgent, and nothing makes it stale.');
}

/** REACHABILITY — can this founder actually open the conversation? */
function assessReachability(signals, consent) {
  const channels = signalsOfKind(signals, 'contactability').filter((s) => s.evidenceStatus !== 'UNKNOWN');
  if (channels.length === 0) {
    return unknownFactor('No public contact route was observed, so there is no way in yet.');
  }
  if (consent && ['declined', 'withdrawn'].includes(consent.status)) {
    return factor(0, 'OBSERVED', 'Consent was declined or withdrawn. There is no permitted route.');
  }
  const named = [...new Set(channels.map((s) => s.value?.channel).filter(Boolean))];
  return factor(Math.min(100, 55 + (named.length * 15)), 'OBSERVED',
    `Reachable by ${named.join(' and ')}.`);
}

/** CONFIDENCE — how much of this read is sighted rather than deduced?
 *  Meta-evidence: confidence in our own picture, never in the prospect. */
function assessConfidence(signals) {
  const informative = signals.filter((s) => s.evidenceStatus !== 'UNKNOWN');
  if (informative.length === 0) return unknownFactor('Nothing was established about this business.');
  const observed = informative.filter((s) => s.evidenceStatus === 'OBSERVED').length;
  const kinds = new Set(informative.map((s) => s.kind)).size;
  const ratio = observed / informative.length;
  const unknowns = signals.length - informative.length;
  return factor((ratio * 70) + Math.min(30, kinds * 6), observed > 0 ? 'OBSERVED' : 'INFERRED',
    `${observed} of ${informative.length} findings were directly observed across ${kinds} kinds of evidence`
    + `${unknowns > 0 ? `, and ${unknowns} could not be established` : ''}.`);
}

/** RISK — what would make this a bad use of the next hour? Scored so that
 *  HIGH means high risk, and read as a penalty, never as merit. */
function assessRisk(signals, { priorContactChecked, alreadyContacted, previouslyRejected } = {}) {
  const reasons = [];
  let score = 0;
  const operating = signalsOfKind(signals, 'operating_status')
    .find((s) => s.value?.operational === false);
  if (operating) { score = Math.max(score, 100); reasons.push('The business is not listed as currently operating.'); }
  if (previouslyRejected === true) { score = Math.max(score, 100); reasons.push('This prospect was rejected before.'); }
  if (alreadyContacted === true) { score = Math.max(score, 60); reasons.push('This prospect has already been contacted.'); }
  if (priorContactChecked !== true) { score = Math.max(score, 20); reasons.push('No prior-contact check is on record.'); }
  if (reasons.length === 0) return factor(0, 'OBSERVED', 'Nothing on file argues against approaching them.');
  return factor(score, 'OBSERVED', reasons.join(' '));
}

/* ── THE BAND ──────────────────────────────────────────────────────────
   NON-COMPENSATORY, on purpose. A high value score may not buy its way
   past absent need or a disqualifying risk -- that is exactly how "it
   scored well overall" ends up recommending a business that already has
   what you sell. Each gate is a separate question with a veto. */
export function bandFor({ need, timing, reachability, risk }) {
  if (risk.score >= 100) return { band: 'not_worth_time', because: risk.detail };
  if (need.alreadySolved === true) return { band: 'not_worth_time', because: need.detail };
  if (need.evidenceStatus === 'UNKNOWN') {
    return { band: 'watch', because: need.detail };
  }
  if (reachability.evidenceStatus === 'UNKNOWN' || reachability.score === 0) {
    return { band: 'watch', because: reachability.detail };
  }
  if (need.score < 50) return { band: 'watch', because: 'The need this offer addresses is weak here.' };
  if (timing.score >= 100) return { band: 'priority_now', because: timing.detail };
  if (timing.score === 0 && timing.evidenceStatus === 'OBSERVED') {
    return { band: 'watch', because: timing.detail };
  }
  if (risk.score >= 60) return { band: 'watch', because: risk.detail };
  return { band: 'strong_opportunity', because: need.detail };
}

/**
 * The whole second question, for ONE prospect against ONE offer.
 *
 * @param {object[]} params.signals structured signals (signals.js)
 * @param {string[]} params.offerAddresses which OFFER_GAP_KINDS this
 *   founder's offer closes. Absent/empty => need is UNKNOWN and nothing can
 *   be prioritised on it. Deliberately a DECLARATION, never parsed from the
 *   offer's prose.
 * @param {object} [params.consent] resolved consent, when the prospect is a
 *   person rather than a business.
 */
export function assessPriority({
  signals = [], offerAddresses = [], consent = null, now = new Date().toISOString(),
  priorContactChecked, alreadyContacted, previouslyRejected,
} = {}) {
  const need = assessNeed(signals, offerAddresses);
  const value = assessValue(signals);
  const timing = assessTiming(signals, now);
  const reachability = assessReachability(signals, consent);
  const confidence = assessConfidence(signals);
  const risk = assessRisk(signals, { priorContactChecked, alreadyContacted, previouslyRejected });

  const factors = { need, value, timing, reachability, confidence, risk };
  const { band, because } = bandFor(factors);

  /* An ordering score WITHIN a band only. It never moves a lead between
     bands -- the gates above own that -- so a strong value score can never
     smuggle a no-need prospect upward. */
  const withinBand = bounded(
    (need.score * 0.40) + (value.score * 0.25) + (timing.score * 0.15)
    + (reachability.score * 0.10) + (confidence.score * 0.10) - (risk.score * 0.20),
  );

  return {
    band,
    legacyBand: PRIORITY_BAND_TO_LEGACY[band],
    because,
    withinBand,
    factors,
    addressableGaps: need.gaps || [],
    /* Founder-readable, ordered by how much each moved the decision. Only
       factors that actually know something appear. */
    reasons: Object.entries(factors)
      .filter(([, f]) => f.evidenceStatus !== 'UNKNOWN')
      .sort((a, b) => b[1].score - a[1].score)
      .map(([name, f]) => ({ factor: name, score: f.score, evidenceStatus: f.evidenceStatus, detail: f.detail })),
  };
}

/* ── ONE ANSWER, WHEREVER IT IS ASKED ──────────────────────────────────
   The action engine reads reachability; this module reads the PAIR
   (prospect, offer). Both are right about their own question, and a surface
   that prints both without reconciling them tells the founder two things at
   once.

   THIS EXISTS AS A SHARED FUNCTION BECAUSE FIXING IT IN ONE PLACE WAS NOT
   ENOUGH. The board was reconciled first; the Workspace was not — so a real
   staging prospect was refused on the board (`observe_only`, no workspace)
   and, when opened directly, still returned "Call this week" with a finished
   call script. Two call sites, one rule.

   Narrow on purpose: it fires only when the offer scope is DECLARED and need
   is not UNKNOWN, which is the same condition that lets the band override the
   action-derived one at all. An undeclared offer changes nothing, because
   then VISION does not know enough to overrule reachability. */
export function reconcileActionWithPriority({ decision, priority, priorityDecides, isRefusal }) {
  if (!decision || !priority || priorityDecides !== true) return decision;
  if (priority.band !== 'not_worth_time') return decision;
  if (typeof isRefusal === 'function' && isRefusal(decision.action)) return decision;
  return {
    ...decision,
    action: 'observe_only',
    channel: 'none',
    urgency: 'not_now',
    /* The prospect's own reason, so the founder can disagree with the
       judgement rather than just receive it. */
    why: String(priority.because || 'This prospect does not need what the offer fixes.').slice(0, 240),
  };
}
