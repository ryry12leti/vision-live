/* ════════════════════════════════════════════════════════════════════════
   PROSPECT INTELLIGENCE — the decision layer
   ────────────────────────────────────────────────────────────────────────
   Turns a qualified, ranked opportunity into the record the Prospect
   Workspace renders.

   THE SPLIT, and it is the whole design:

     CODE decides    which prospect, why it was chosen, whether it qualifies,
                     whether contact is permitted, which channel exists, what
                     the next action is, and what counts as evidence.
     THE MODEL only  writes English for decisions code has already made.

   That is not a stylistic preference. Everything in the first list has a
   correct answer that can be checked; everything in the second is a judgement
   about wording. A model asked to do the first will produce a fluent, plausible
   answer with no way to tell whether it is right — and a sales script is
   exactly the artefact where "fluent and wrong" is most expensive, because the
   founder says it out loud to a real person.

   So the model is given a decision and asked to phrase it. If it phrases it in
   a way that adds a fact, the grounding validator removes it. If it cannot be
   repaired, the deterministic record is used instead — which is plainer, and
   true.
   ════════════════════════════════════════════════════════════════════════ */

import {
  PROSPECT_INTELLIGENCE_CONTRACT_VERSION, BOUNDS, NEXT_ACTIONS, isRefusalAction,
  prospectLanguageSchema, validateProspectLanguage, validateProspectIntelligence,
} from './prospect-intelligence-contract.js';
import { buildProspectContext, SENSITIVE_CLAIM_KEYS } from './prospect-context.js';
import { buildGatekeeperPlan } from './gatekeeper-plan.js';
import { LEAD_QUALIFICATION_THRESHOLD } from './ranking.js';
import { resolveWhyNow, whyNowSentence, whyNowScript } from './why-now-intelligence.js';
import { assessPriority, reconcileActionWithPriority } from './priority-intelligence.js';
import { deriveScriptStrategy, buildObjections, GAP_DISCOVERY, EVENT_DISCOVERY, EVIDENCE_DISCOVERY } from './sales-strategy.js';

/* ════════════ 1 · WHY VISION CHOSE THIS PROSPECT ════════════
   Assembled from the ranking provenance that already exists. Every reason
   names the dimension it came from, the evidence status of that dimension and
   the source reference behind it — so "why" is traceable rather than asserted.

   "High opportunity score" is not a reason and never appears: the score is the
   consequence of the reasons, not one of them. */

const DIMENSION_LANGUAGE = Object.freeze({
  targetCustomerFit: 'this is the kind of business the founder is trying to reach',
  locationFit: 'it sits inside the area the founder searched',
  opportunityRelevance: 'there is an observable commercial opening here',
  evidenceStrength: 'several independent signals agree',
  contactability: 'there is a public route to a human',
  founderOfferFit: 'the founder\'s confirmed offer speaks to something observable about how this business currently operates',
  founderCapabilityFit: 'the founder has capability evidence for this',
  freshness: 'the evidence is current',
  priorContactRisk: 'no prior contact or rejection is recorded',
});

/* The same dimension means the same thing for an inbound person, but calling
   Sarah Mitchell "the kind of business the founder is trying to reach" is the
   sort of wrong noun that tells a founder immediately that nothing read their
   file. One brain, two vocabularies. */
const DIMENSION_LANGUAGE_B2C = Object.freeze({
  targetCustomerFit: 'they match who the founder is trying to reach',
  opportunityRelevance: 'they came to the founder rather than the other way round',
  contactability: 'there is a consented route to reach them',
});

function dimensionPhrase(dimension, leadType) {
  if (leadType === 'b2c' && DIMENSION_LANGUAGE_B2C[dimension]) return DIMENSION_LANGUAGE_B2C[dimension];
  return DIMENSION_LANGUAGE[dimension];
}

/* ── THREE CLASSES OF REASON, AND THEY ARE NOT INTERCHANGEABLE ───────────
   The flat output this replaced said things like "VISION chose them because
   they have a website, a phone number and the evidence is fresh." Every one of
   those is true and none of them is a reason to want a customer — they are
   reasons VISION is ABLE to act, which is a different question.

     BUSINESS     why this prospect is commercially worth pursuing
     TIMING       why acting now matters, and only when something actually
                  happened
     READINESS    whether VISION can act at all

   Why Chosen is built from BUSINESS. Timing may strengthen it. Readiness is
   reported separately and may never be the headline. */
export const REASON_CLASSES = Object.freeze({
  targetCustomerFit: 'business',
  founderOfferFit: 'business',
  opportunityRelevance: 'business',
  founderCapabilityFit: 'business',
  evidenceStrength: 'readiness',
  contactability: 'readiness',
  locationFit: 'readiness',
  freshness: 'readiness',
  priorContactRisk: 'readiness',
});
/* Order within the business class, explicit rather than by score: "who they
   are" then "why our offer matters to them" then "what the opening is". */
const BUSINESS_ORDER = ['targetCustomerFit', 'founderOfferFit', 'opportunityRelevance', 'founderCapabilityFit'];
const HEADLINE_RANK = new Map(BUSINESS_ORDER.map((dimension, index) => [dimension, index]));

function topReasons(ranking, { max = BOUNDS.maxReasons } = {}) {
  const dimensions = ranking?.dimensions || {};
  const provenance = ranking?.provenance || {};
  const entries = Object.keys(DIMENSION_LANGUAGE)
    .filter((dimension) => Number.isFinite(dimensions[dimension]) && dimensions[dimension] > 0)
    .map((dimension) => {
      const claims = (provenance[dimension] || []).filter((claim) => claim.contribution > 0);
      const best = claims.sort((a, b) => b.contribution - a.contribution)[0] || null;
      return {
        dimension,
        score: dimensions[dimension],
        reasonClass: REASON_CLASSES[dimension] || 'readiness',
        headline: REASON_CLASSES[dimension] === 'business',
        headlineRank: HEADLINE_RANK.has(dimension) ? HEADLINE_RANK.get(dimension) : Number.MAX_SAFE_INTEGER,
        statement: String(best?.rationale || DIMENSION_LANGUAGE[dimension]).slice(0, BOUNDS.reason),
        evidenceStatus: best?.evidenceStatus || 'UNKNOWN',
        sourceReference: best?.sourceReference || null,
      };
    })
    /* Headline dimensions first IN THEIR DECLARED ORDER, then everything else
       by strength. Fully deterministic: two runs can never disagree. */
    .sort((a, b) => (b.headline - a.headline)
      || (a.headlineRank - b.headlineRank)
      || (b.score - a.score)
      || a.dimension.localeCompare(b.dimension));
  return entries.slice(0, max);
}

/**
 * The deterministic answer to "why this prospect, why for this founder, why
 * now, and why before the others".
 *
 * Where a part is not actually known it says so. `relativePriorityReason` is
 * null unless a real comparison set was supplied — claiming a prospect is the
 * best available when nothing was compared is exactly the kind of confident
 * nonsense this layer exists to prevent.
 */
export function buildSelectionRationale({ context, ranking, comparisonSet = null }) {
  const reasons = topReasons(ranking);
  const name = context.prospect.name || 'this prospect';
  const target = context.founder.targetCustomer;

  const businessReasons = reasons.filter((reason) => reason.reasonClass === 'business' && reason.evidenceStatus !== 'UNKNOWN');
  const executionReadiness = reasons.filter((reason) => reason.reasonClass === 'readiness' && reason.evidenceStatus !== 'UNKNOWN');

  /* TIMING IS ITS OWN CLASS AND IT NEEDS AN EVENT. Freshness is not urgency:
     "the file is current" says something about VISION's research, not about
     the prospect's week. Only a dated first-party intent or activity signal
     earns a timing reason. */
  const timingReasons = (context.evidence.observed || [])
    .filter((signal) => ['inbound_intent', 'inbound_activity'].includes(signal.kind))
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    .slice(0, 2)
    .map((signal) => ({
      dimension: signal.kind, reasonClass: 'timing', score: null,
      statement: signal.detail, evidenceStatus: signal.evidenceStatus, sourceReference: signal.sourceReference,
    }));

  const clauses = businessReasons.slice(0, 3).map((reason) => dimensionPhrase(reason.dimension, context.leadType));

  let whyChosen;
  if (clauses.length === 0) {
    whyChosen = `VISION surfaced ${name}, but nothing in the current evidence establishes a commercial reason to pursue it ahead of anything else. Treat it as unresearched — a contact route existing is not a reason to want a customer.`;
  } else {
    const forFounder = target ? ` for a founder selling to ${target}` : '';
    whyChosen = `VISION prioritised ${name}${forFounder} because ${joinClauses(clauses)}.`.slice(0, BOUNDS.whyChosen);
  }

  /* ONE WHY NOW, WITH ITS TIER. This used to be three branches over
     freshness, which is a fact about VISION's research rather than about the
     prospect's week — and it could not see the stored external events at all,
     so a prospect whose acquisition VISION had already saved was told
     "nothing here is time-sensitive". resolveWhyNow ranks the real evidence
     and says which kind it found. */
  const whyNowResolved = resolveWhyNow({
    whyNowSignals: context.whyNowSignals || [],
    timingReasons, offerGap: context.offerGap || null,
    freshness: context.freshness, now: context.now,
  });
  const whyNow = whyNowSentence(whyNowResolved).slice(0, BOUNDS.whyNow);

  let relativePriorityReason = null;
  if (Array.isArray(comparisonSet) && comparisonSet.length > 0) {
    const scores = comparisonSet
      .map((item) => item?.ranking?.dimensions?.opportunityScore)
      .filter(Number.isFinite);
    const mine = ranking?.dimensions?.opportunityScore;
    if (scores.length && Number.isFinite(mine)) {
      const better = scores.filter((score) => score > mine).length;
      relativePriorityReason = better === 0
        ? `Compared against ${scores.length} other researched prospect${scores.length === 1 ? '' : 's'} in this run, none scored higher on the same dimensions.`
        : `${better} of ${scores.length} other researched prospects scored higher on the same dimensions, so this one is not the top of the list.`;
    }
  }

  return {
    whyChosen,
    whyNow,
    /* The structured answer beside the sentence: the Workspace needs the
       date, the confidence and whether this is event-driven, and none of
       those survive being flattened into prose. */
    whyNowResolved,
    reasons,
    comparisonSetSize: Array.isArray(comparisonSet) ? comparisonSet.length : 0,
    /* The three classes, kept apart all the way to the prompt. Handing the
       model one undifferentiated list is what let readiness masquerade as
       commercial value in the first place. */
    businessReasons,
    timingReasons,
    executionReadiness,
    strongestEvidenceRefs: reasons.map((reason) => reason.sourceReference).filter(Boolean).slice(0, BOUNDS.maxEvidenceRefs),
    importantUnknowns: context.unknowns.slice(0, BOUNDS.maxUnknowns),
    relativePriorityReason,
  };
}

function joinClauses(clauses) {
  if (clauses.length === 1) return clauses[0];
  return `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
}

/* ════════════ 2 · NEXT BEST ACTION ════════════
   One action, chosen by precedence. Every branch above the outreach ones is a
   refusal, and each refusal is a real product state rather than an error: the
   honest answer to "what should I do about this lead" is often "not that". */

/* How long an inbound intent event stays "live". Exported so the cache can
   derive how long language written about it may remain authoritative. */
export const LIVE_INTENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const CHANNEL_PREFERENCE = Object.freeze(['call', 'email', 'sms', 'dm', 'website_form', 'public_social', 'in_person']);

function preferredChannel(permitted) {
  for (const channel of CHANNEL_PREFERENCE) {
    if (permitted.includes(channel)) return channel;
  }
  return null;
}

export function decideNextBestAction({ context, ranking, eligibility }) {
  const { contactability, lifecycle, freshness, founder } = context;
  const evidenceRefs = (context.evidence.observed || []).map((signal) => signal.sourceReference).filter(Boolean).slice(0, 6);
  const make = (action, channel, urgency, why) => ({
    action, channel, urgency, why: String(why).slice(0, BOUNDS.actionWhy), evidenceRefs,
  });

  /* 1 — below the lead line. Activity is not permission and it is not a
     person; there is nobody to contact. */
  if (!lifecycle.isLead) {
    return make('observe_only', null, 'not_now',
      `${lifecycle.reason} A click, a return visit or a page view is audience behaviour — there is no identified person here and no permission, so there is nobody to contact.`);
  }

  /* 2 — consent forbids it. Checked before everything else about the
     prospect's quality, because a great lead we may not contact is still a
     lead we may not contact. */
  const consentStatus = contactability.consent.status;
  if (['declined', 'withdrawn'].includes(consentStatus)) {
    return make('do_not_contact', null, 'not_now',
      `Consent was ${consentStatus}. VISION can keep reading the signal, but no outreach is permitted on any channel.`);
  }
  /* A CONSENT RECORD VISION CANNOT READ IS NOT SILENCE. 'opted_out', 'revoked'
     or a typo does not fit the four-value vocabulary and used to collapse to
     'unknown' — which on a B2B lead is the permissive baseline. The advice and
     the spend gate now ask the same question, so a record we cannot interpret
     stops both, and the sentence says exactly what happened rather than
     claiming a withdrawal nobody observed. */
  if (contactability.consent.unrecognisedStatus) {
    return make('do_not_contact', null, 'not_now',
      `A consent record exists for this prospect that VISION cannot interpret ("${contactability.consent.unrecognisedStatus}"). Until it is resolved, no outreach is permitted — an unreadable refusal is not permission.`);
  }
  if (!contactability.contactPermitted && consentStatus === 'unknown' && context.leadType === 'b2c') {
    return make('do_not_contact', null, 'not_now',
      'No consent is recorded for this person. Analysis is fine; contacting them is not, and "we never asked" is not the same as permission.');
  }

  /* 3 — evidence too old to act on. Acting on stale evidence is how a founder
     opens a call with something that stopped being true a month ago. */
  if (!freshness.fresh) {
    return make('refresh_evidence', null, 'before_contact',
      freshness.reason === 'freshness_unknown'
        ? 'Nothing on file is dated, so there is no way to tell whether any of it is still true. Re-check before relying on it.'
        : 'The evidence behind this prospect is out of date. Refresh it before opening a conversation built on it.');
  }

  /* 4 — no route in. */
  if (contactability.observedChannels.length === 0) {
    return make('research_contact_route', null, 'before_contact',
      'No public contact route has been observed for this prospect. Find the route before writing anything to send down it.');
  }

  /* 5 — permitted-channel gap: routes exist but consent does not cover them. */
  if (!contactability.contactPermitted) {
    return make('do_not_contact', null, 'not_now',
      `A contact route exists but consent does not cover it. Permitted channels: none of ${contactability.observedChannels.join(', ')}.`);
  }

  /* 6 — the founder's own offer is not established. Outreach without a
     confirmed offer produces a call the founder cannot finish. */
  if (!founder.offerConfirmed) {
    return make('clarify_offer', null, 'before_contact',
      'The venture has no confirmed offer on file. VISION will not invent one, and an approach built on a guessed offer wastes the only first impression available.');
  }

  /* 7 — not qualified, or too thin to justify contact. */
  const qualified = ranking?.qualified === true && eligibility?.qualified !== false;
  if (!qualified) {
    return make('research_prospect', null, 'before_contact',
      `The evidence does not yet meet the ${LEAD_QUALIFICATION_THRESHOLD}-point qualification threshold. More research, not more confidence.`);
  }

  /* 8 — contactable, qualified, permitted. Urgency comes from a real timing
     signal or it is not claimed. */
  const channel = preferredChannel(contactability.permittedChannels);
  /* URGENCY EXPIRES, AND IT HAS TO BE CHECKED. This selected the most recent
     inbound_intent and declared "call now, within the hour" with no regard for
     when it happened — so an enquiry from three weeks ago, still inside the
     30-day freshness window, told the founder to drop everything. Freshness
     means the file is current; urgency means something happened recently, and
     they are not the same clock.

     24 hours is the window in which "they just got in touch" is still a true
     thing to say on a call. Past it the lead is still qualified and still
     worth calling — it is simply no longer this hour's emergency. */
  const timingRaw = (context.evidence.observed || [])
    .filter((signal) => signal.kind === 'inbound_intent')
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0] || null;
  const nowMs = Date.parse(context.now);
  const timingAgeMs = timingRaw ? nowMs - Date.parse(timingRaw.checkedAt) : Infinity;
  const timing = Number.isFinite(timingAgeMs) && timingAgeMs >= 0 && timingAgeMs <= LIVE_INTENT_WINDOW_MS
    ? timingRaw
    : null;

  if (timing && channel === 'call') {
    return make('call_now', 'call', 'within_the_hour',
      `${timing.detail} Live intent decays fast, and a consented phone number is the fastest route to it.`);
  }
  if (channel === 'call') {
    return make('call_this_week', 'call', 'this_week',
      'This prospect is qualified and reachable by phone, and nothing on file makes it urgent. A call this week is the highest-value next step.');
  }
  return make('email', channel, 'this_week',
    `This prospect is qualified and reachable by ${channel}. No phone route is permitted, so ${channel} is the route that exists.`);
}

/* ════════════ 3 · GROUNDING VALIDATOR ════════════
   The model's output is treated as a claim about reality, and every claim is
   checked against the context it was given. */

/* Sales sludge. If the opening could be sent to any business in the country
   with the name swapped, it has failed the only job it has. */
const GENERIC_PHRASES = [
  'innovative', 'cutting-edge', 'cutting edge', 'ai-powered', 'ai powered',
  'world-class', 'world class', 'best-in-class', 'best in class',
  'we help businesses grow', 'help businesses grow', 'take your business to the next level',
  'game-changing', 'game changing', 'synergy', 'leverage our', 'maximise your roi',
  'maximize your roi', 'unlock your potential', 'revolutionary', 'one-stop shop',
  'passionate about', 'industry-leading', 'industry leading', 'seamless solution',
  'bespoke solutions', 'digital transformation journey',
];

/* First-person commercial claims. Each of these is a statement about the
   FOUNDER's track record, and none may appear unless the venture state
   established it. */
const FOUNDER_CLAIM_PATTERNS = [
  { key: 'clientCount', re: /\b(?:i|we)\b[^.!?]{0,60}\b(?:work with|works with|worked with|serve|servicing|manage|help(?:ed)?)\b[^.!?]{0,40}\b(?:\d+|a dozen|dozens|hundreds|thousands|several|many|numerous)\b/i },
  /* FIRST PERSON REQUIRED. Without it this fired on "would you want to grow
     patient numbers?" — a question to the prospect, not a claim about the
     founder's track record — and sent a good generation to fallback. The key
     means "the founder claims they produced this result", so the subject has
     to be the founder. "We increased revenue 40%" is still caught. */
  { key: 'customerResults', re: /\b(?:i|we|our)\b[^.!?]{0,50}\b(?:increase[d]?|boost(?:ed)?|grew|grow(?:n)?|double[d]?|triple[d]?|improve[d]?)\b[^.!?]{0,40}\b(?:\d+\s*%|\d+\s*percent|revenue|sales|bookings|patients|leads)\b/i },
  { key: 'yearsExperience', re: /\b(?:\d+|ten|fifteen|twenty)\+?\s*years?\b[^.!?]{0,20}\b(?:experience|in the industry|doing this)\b/i },
  { key: 'caseStudies', re: /\b(?:case stud(?:y|ies)|our results with|we did this for)\b/i },
  { key: 'guarantees', re: /\b(?:guarantee|guaranteed|money[- ]back|no risk|risk[- ]free)\b/i },
  { key: 'partnerships', re: /\b(?:official partner|certified partner|we partner with)\b/i },
  { key: 'certifications', re: /\b(?:certified|accredited)\b[^.!?]{0,30}\b(?:by|with|in)\b/i },
  { key: 'teamSize', re: /\b(?:our team of|team of)\s+(?:\d+|a dozen|dozens)\b/i },
];

/* Words that turn an assertion back into an open question. */
const HEDGES = /\b(?:whether|unknown|unclear|not established|not confirmed|if|might|may|could|possibly|perhaps|worth asking|ask (?:them|whether|if)|we do not know|we don't know|i do not know|assume|assumption|suspect)\b/i;

function sentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0);
}

/**
 * Does the text ASSERT something we explicitly listed as UNKNOWN?
 *
 * A QUESTION ABOUT AN UNKNOWN IS THE POINT, NOT A VIOLATION. The whole design
 * of the discovery section is to turn the biggest unknown into the first
 * question — "Is there room in the book, or are you at capacity?" is the
 * correct treatment of "whether the newer practitioners have unused capacity",
 * and an earlier version of this function rejected it, which would have
 * blocked every good generation the engine produced. Interrogatives are
 * skipped for that reason; only declarative sentences can assert.
 */
export function assertsUnknownAsFact(text, unknowns) {
  const hits = [];
  for (const sentence of sentences(text)) {
    if (sentence.trim().endsWith('?')) continue;
    if (HEDGES.test(sentence)) continue;
    const lower = sentence.toLowerCase();
    for (const unknown of unknowns || []) {
      const tokens = unknown.subjectTokens || [];
      if (!tokens.length) continue;
      if (tokens.some((token) => lower.includes(token))) {
        hits.push({ unknown: unknown.statement, sentence: sentence.trim().slice(0, 200) });
        break;
      }
    }
  }
  return hits;
}

/** Numbers in the text that do not exist anywhere in the evidence. */
export function unsupportedNumbers(text, allowedNumbers) {
  const allowed = new Set(allowedNumbers || []);
  const found = [];
  for (const match of String(text || '').matchAll(/\d+(?:[.,]\d+)?/g)) {
    const raw = match[0].replace(/,/g, '');
    if (allowed.has(raw)) continue;
    /* Placeholders and ordinary small numbers of minutes/questions are not
       factual claims about the prospect. Anything above this is. */
    if (Number(raw) <= 10) continue;
    found.push(raw);
  }
  return [...new Set(found)];
}

/* ── WHY CHOSEN QUALITY, CHECKED STRUCTURALLY ────────────────────────────
   Not keyword policing. The test is whether the sentence rests on a class of
   reason that can carry it: readiness answers "can we act", and an answer made
   only of readiness is the flat output this gate exists to reject. Keywords
   are used ONLY for the two claims that are checkable in words — a score
   citation and a manufactured superiority claim. */
const SCORE_CITATION_RE = /\b(?:opportunity\s+)?score\b|\b\d{1,3}\s*\/\s*100\b|\bA\+|\bgrade\b|\bhigh[- ]potential\b/i;
const SUPERIORITY_RE = /\b(?:best|top|strongest|highest[- ]value)\s+(?:available|option|prospect|lead|opportunity)\b|\bbetter than (?:the )?(?:others|the rest)\b/i;
const URGENCY_RE = /\b(?:urgent|urgently|right now|immediately|act fast|time[- ]critical|closing fast|running out)\b/i;

export function assessWhyChosenQuality(whyChosen, { selection, comparisonSetSize = 0 }) {
  const problems = [];
  const text = String(whyChosen || '');
  const hasBusinessEvidence = (selection.businessReasons || []).length > 0;

  if (text.trim().length < 30) problems.push({ code: 'why_chosen_too_short', detail: 'no explanation was produced' });

  /* Rests only on readiness. Detected structurally: if business evidence
     exists but not one business reason's own subject appears, the sentence is
     explaining that we CAN act rather than why we should want to. */
  if (hasBusinessEvidence) {
    const mentionsBusiness = (selection.businessReasons || []).some((reason) => {
      const tokens = String(reason.statement || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 4);
      return tokens.some((token) => text.toLowerCase().includes(token));
    });
    if (!mentionsBusiness) {
      problems.push({ code: 'why_chosen_is_only_readiness', detail: 'the explanation cites no business reason even though business evidence exists' });
    }
  }
  if (SCORE_CITATION_RE.test(text)) {
    problems.push({ code: 'why_chosen_cites_score', detail: 'the score or grade is not a business reason' });
  }
  if (SUPERIORITY_RE.test(text) && comparisonSetSize === 0) {
    problems.push({ code: 'why_chosen_claims_priority_without_cohort', detail: 'a superiority claim was made with nothing to compare against' });
  }
  /* A verified external event IS a dated timing signal, and it does not live
     in timingReasons (which only ever held first-party intent). Without this
     the validator would reject language grounded in the acquisition VISION
     itself stored — while still rejecting urgency claimed on a standing gap,
     which is the case it exists for. */
  const datedTiming = (selection.timingReasons || []).length > 0
    || ['verified_event', 'recent_change'].includes(selection.whyNowResolved?.tier);
  if (URGENCY_RE.test(text) && !datedTiming) {
    problems.push({ code: 'why_chosen_claims_urgency_without_timing', detail: 'urgency was claimed with no dated timing signal' });
  }
  return { valid: problems.length === 0, problems };
}

/**
 * The full grounding pass. Returns every violation it can find rather than
 * the first, so a repair attempt gets the whole list.
 */
export function groundProspectLanguage({ language, context, decision, selection }) {
  const violations = [];

  /* 10 — malformed or oversized. */
  const shape = validateProspectLanguage(language);
  if (!shape.valid) {
    return { valid: false, violations: shape.errors.map((error) => ({ code: 'malformed_output', detail: error })) };
  }

  const outreach = language.outreach || {};
  const say = language.whatToSay || {};
  /* Prose the model wrote that is presented to the founder as fact or script.
     `likelyMeaning` is deliberately included — an interpretation may be an
     interpretation, but it may not smuggle in a number. */
  const allProse = [
    language.whyChosen, language.whyNow, language.whyThisProspect, language.offerFit,
    ...(language.strengths || []), ...(language.weaknesses || []),
    say.opening, say.angle, say.firstQuestion,
    ...(say.discoveryQuestions || []), ...(say.dontSay || []),
    ...(language.objections || []).flatMap((item) => [item.objection, item.likelyMeaning, item.response]),
    ...(language.callStructure || []).map((item) => item.note),
    outreach.call, outreach.email, outreach.sms, outreach.dm,
  ].filter(Boolean).join('\n');

  /* 7 / 8 — the decisions code made must actually be present. */
  if (!language.whyChosen || language.whyChosen.trim().length < 30) {
    violations.push({ code: 'missing_why_chosen', detail: 'whyChosen is absent or too short to explain anything' });
  }
  /* 13 — Why Chosen must be a commercial argument, not a readiness report. */
  for (const problem of assessWhyChosenQuality(language.whyChosen, {
    selection, comparisonSetSize: selection.comparisonSetSize || 0,
  }).problems) violations.push(problem);
  if (!decision || !NEXT_ACTIONS.includes(decision.action)) {
    violations.push({ code: 'missing_next_best_action', detail: 'no deterministic next best action was supplied' });
  }

  /* 2 — an UNKNOWN asserted as fact. */
  for (const hit of assertsUnknownAsFact(allProse, selection.importantUnknowns)) {
    violations.push({ code: 'unknown_asserted_as_fact', detail: `"${hit.sentence}" asserts something recorded as unknown: ${hit.unknown}` });
  }

  /* 3 — a number that exists nowhere in the evidence. */
  const invented = unsupportedNumbers(allProse, context.allowedNumbers);
  for (const number of invented) {
    violations.push({ code: 'unsupported_numeric_claim', detail: `the number ${number} does not appear in any evidence or trusted founder fact` });
  }

  /* 4 — a founder claim the venture state never established. */
  /* Questions are not claims. A founder ASKING whether something is true is
     the behaviour this system is trying to produce, so it must never be
     mistaken for asserting it. */
  const declarativeProse = allProse.split(/(?<=[.!?])\s+/).filter((sentence) => !sentence.trim().endsWith('?')).join(' ');
  for (const pattern of FOUNDER_CLAIM_PATTERNS) {
    if (!pattern.re.test(declarativeProse)) continue;
    if (!context.founder.trustedClaims[pattern.key]) {
      violations.push({ code: 'unsupported_founder_claim', detail: `the copy makes a ${pattern.key} claim, and the venture state has no trusted ${pattern.key} fact` });
    }
  }

  /* 1 — an evidence reference that does not exist. */
  const knownRefs = new Set([
    ...(context.evidence.observed || []).map((signal) => signal.sourceReference),
    ...(context.evidence.inferred || []).map((signal) => signal.sourceReference),
    ...(selection.strongestEvidenceRefs || []),
  ].filter(Boolean));
  for (const ref of language.evidenceRefs || []) {
    if (!knownRefs.has(ref)) violations.push({ code: 'unknown_evidence_reference', detail: `evidence reference ${ref} does not exist` });
  }

  /* 5 — a script for a channel that does not exist. */
  const permitted = new Set(context.contactability.permittedChannels);
  for (const channel of ['call', 'email', 'sms', 'dm']) {
    const script = String(outreach[channel] || '').trim();
    if (script.length > 0 && !permitted.has(channel)) {
      violations.push({ code: 'nonexistent_channel_script', detail: `an outreach script was written for ${channel}, which is not a permitted channel for this prospect` });
    }
  }

  /* 6 — B2C outreach copy with no consent at all. */
  if (context.leadType === 'b2c' && !context.contactability.contactPermitted) {
    const anyScript = ['call', 'email', 'sms', 'dm'].some((channel) => String(outreach[channel] || '').trim().length > 0);
    if (anyScript) violations.push({ code: 'b2c_outreach_without_consent', detail: 'outreach copy was produced for a B2C prospect with no permitted channel' });
  }

  /* 9 — generic sales sludge, or an opening that names no real fact. */
  const lowerSay = `${say.opening || ''} ${say.angle || ''}`.toLowerCase();
  for (const phrase of GENERIC_PHRASES) {
    if (lowerSay.includes(phrase)) {
      violations.push({ code: 'generic_sales_language', detail: `the opening or angle contains generic sales language: "${phrase}"` });
    }
  }
  if (decision && decision.channel && !openingReferencesEvidence(say.opening, context)) {
    violations.push({ code: 'opening_references_no_evidence', detail: 'the opening does not reference any observed fact about this prospect' });
  }

  /* 11 — stale evidence written about as though current. */
  if (!context.freshness.fresh && /\b(?:right now|currently|at the moment|as of today|today)\b/i.test(allProse)) {
    violations.push({ code: 'stale_evidence_presented_as_current', detail: 'the copy speaks in the present tense about evidence that is stale or undated' });
  }

  /* 12 — the model trying to move a code-owned decision. */
  for (const field of ['qualified', 'opportunityScore', 'score', 'grade', 'rank', 'priority', 'nextBestAction', 'action', 'channel']) {
    if (Object.prototype.hasOwnProperty.call(language, field)) {
      violations.push({ code: 'model_changed_code_owned_decision', detail: `the model returned "${field}", which is owned by code` });
    }
  }

  return { valid: violations.length === 0, violations };
}

/** Does the opening actually mention something we observed? */
function openingReferencesEvidence(opening, context) {
  const text = String(opening || '').toLowerCase();
  if (!text) return false;
  const tokens = new Set();
  for (const signal of context.evidence.observed || []) {
    for (const word of String(signal.detail || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length > 4) tokens.add(word);
    }
    for (const value of Object.values(signal.value || {})) {
      if (typeof value === 'string' && value.length > 4) tokens.add(value.toLowerCase());
    }
  }
  const name = String(context.prospect.name || '').toLowerCase();
  for (const word of name.split(/[^a-z0-9]+/)) if (word.length > 3) tokens.add(word);
  return [...tokens].some((token) => text.includes(token));
}

/* ════════════ 4 · DETERMINISTIC LANGUAGE ════════════
   The fallback, and the thing every model answer is measured against. It is
   plain on purpose: it says only what the evidence supports, and where the
   evidence runs out it says that instead of inventing the next sentence. */

/* How INTERESTING an observed fact is to open a conversation with, by kind.
   Lower is better. This is not the same question as how much a signal
   contributes to the score: "a public listing exists" is load-bearing for
   qualification and worthless as an opening line, and picking observed[0]
   opened a real call with "Public listing with an official website." */
const OPENING_INTEREST = Object.freeze({
  inbound_intent: 0,     // they just did something
  reputation: 1,         // a number about them they are proud of
  conversion_path: 2,    // how their business actually converts
  inbound_activity: 3,
  operating_status: 4,
  location_fit: 5,
  category_fit: 6,
  contactability: 7,
  consent: 8,
  listing: 9,            // "you exist" is not an observation worth stating
});

function mostInterestingObserved(observed) {
  return [...(observed || [])].sort((a, b) => {
    const rank = (OPENING_INTEREST[a.kind] ?? 50) - (OPENING_INTEREST[b.kind] ?? 50);
    if (rank !== 0) return rank;
    return String(a.signalId).localeCompare(String(b.signalId));
  });
}

/** Turns "Whether growth is currently a priority" into a question a human
 * would actually ask, without asserting the thing being asked about. */
/* An unknown is a note ABOUT the prospect, so it is written in the third
   person. The question is addressed TO them. Without this, the first question
   on a consented inbound call came out as "Can I ask whether she has an
   existing policy?" — asked of Sarah, about Sarah. */
function toSecondPerson(text) {
  return String(text)
    .replace(/\b(?:she|he|they)\s+has\b/gi, 'you have')
    .replace(/\b(?:she|he|they)\s+is\b/gi, 'you are')
    .replace(/\b(?:she|he|they)\s+was\b/gi, 'you were')
    .replace(/\b(?:she|he|they)\s+would\b/gi, 'you would')
    .replace(/\b(?:she|he|they)\b/gi, 'you')
    .replace(/\b(?:her|his|their)\b/gi, 'your')
    .replace(/\byour\s+own\b/gi, 'your own');
}

export function questionFromUnknown(unknown) {
  const raw = String(unknown?.statement || '').trim().replace(/[.?]+$/, '');
  if (!raw) return null;
  const stripped = toSecondPerson(raw.replace(/^whether\s+/i, '').replace(/^if\s+/i, ''));
  /* Keeping the "whether" framing is what stops the question reading as a
     statement: an earlier version produced "Can I ask about one thing I could
     not establish: growth is currently a priority?", which asserts the very
     thing it is asking about. */
  const lead = stripped.charAt(0).toLowerCase() + stripped.slice(1);
  return `Can I ask whether ${lead}?`;
}

export function deterministicLanguage({ context, selection, decision }) {
  const name = context.prospect.name || 'this prospect';
  const observed = context.evidence.observed || [];
  const strongest = mostInterestingObserved(observed).slice(0, 3);
  const offer = context.founder.offer;

  /* BUSINESS REASONS, NOT THE HEAVIEST SIGNALS. This took the top three
     OBSERVED signals by weight, which for almost every prospect means "a
     website is listed", "a phone route is published", "the address matches
     the search area" — facts that establish VISION CAN act, never that the
     prospect is worth pursuing. The same distinction Why Chosen has enforced
     since it shipped (REASON_CLASSES) was simply never applied here, so the
     Pitch Assessment column filled with plumbing and buried the one line that
     mattered. Readiness is kept only to top up when there is nothing else,
     because an empty column is worse than a boring one. */
  const businessStrengths = (selection.businessReasons || [])
    .map((reason) => reason.statement)
    .filter(Boolean);
  const readinessBackfill = strongest.map((signal) => signal.detail);
  const strengths = [...new Set([...businessStrengths, ...readinessBackfill])]
    .slice(0, 3)
    .map((line) => String(line).slice(0, BOUNDS.strength));
  const weaknesses = selection.importantUnknowns.slice(0, 3)
    .map((unknown) => `Not established: ${unknown.statement}`.slice(0, BOUNDS.weakness));

  const permitted = context.contactability.permittedChannels;
  const canWrite = (channel) => permitted.includes(channel);

  /* THE GAP FIRST, THE HEAVIEST SIGNAL SECOND. `strongest[0]` is whichever
     evidence scored highest, which for any business with a phone number is
     the phone number — an opening line that tells a prospect something they
     already know and gives the founder nothing to sell. When the founder has
     declared what their offer closes and that gap was OBSERVED here, that is
     the specific, checkable thing worth opening on. Falls back to exactly the
     previous behaviour whenever no such gap exists. */
  const openingFact = context.offerGap?.detail || strongest[0]?.detail || null;
  /* ── THE STRATEGY DECIDES, THEN THE WORDS ARE WRITTEN ───────────────
     Derived from intelligence that already exists — evidence, unknowns, the
     tiered Why Now, the decided action, the contact's role. Nothing here
     re-computes any of it. */
  const strategy = deriveScriptStrategy({
    context, selection, decision,
    whyNow: selection.whyNowResolved || null,
    contact: context.contact || null,
    offerGap: context.offerGap || null,
    stage: context.lifecycle?.stage || null,
  });

  /* INBOUND IS A DIFFERENT CONVERSATION FROM OUTBOUND, and the difference is
     who started it. Reciting a consumer's browsing back to them — "I noticed
     something specific: viewed quote information twice" — is accurate and
     reads as surveillance; the same fact told as their own action ("you got in
     touch") is the thing they would say themselves. Only used when an inbound
     intent signal exists, i.e. when they really did make contact. */
  const madeContact = (observed || []).some((signal) => signal.kind === 'inbound_intent');
  const business = context.founder.businessName;
  /* WHEN SOMETHING ACTUALLY HAPPENED, OPEN ON IT. A founder who has been told
     a prospect was acquired twelve days ago and then reads "I noticed you have
     no booking page" is holding two scripts and will trust neither. The angle
     completes "I saw ..." so it can only report the event, never diagnose from
     it, and the question is open — the event earns the conversation, it does
     not establish what they need. */
  const eventSay = whyNowScript(selection.whyNowResolved);
  let opening = '';
  if (decision.channel && eventSay.angle) {
    opening = `Hi — is this ${name}? My name is [name]. I saw ${eventSay.angle}, so the timing seemed worth one question rather than a pitch. Have you got ninety seconds?`;
  } else if (decision.channel && madeContact) {
    opening = `Hi ${name}, it is [name]${business ? ` from ${business}` : ''}. You got in touch${business ? ` with ${business}` : ''}, so I wanted to catch you while it is still fresh rather than leave it until tomorrow. Is now an okay two minutes?`;
  } else if (decision.channel && strategy.hook?.spoken) {
    /* SHORTER, AND SAYABLE. The previous opening read VISION's evidence prose
       down the phone — "I noticed something specific and wanted to check
       whether it is deliberate: The website was read and offers no self-serve
       booking or ordering route." Accurate, forty words, and audibly written
       by software. Same claim, said the way a person says it. */
    opening = `Hi, is that ${name}? My name is [name] — I will be quick. ${strategy.hook.spoken.charAt(0).toUpperCase()}${strategy.hook.spoken.slice(1)}, and I wanted to check whether that is deliberate rather than assume. Have you got a minute?`;
  } else if (decision.channel && openingFact) {
    opening = `Hi, is that ${name}? My name is [name] — I will be quick. I noticed ${openingFact.charAt(0).toLowerCase()}${openingFact.slice(1)} Have you got a minute?`;
  }


  /* THE QUESTION ASKS HOW THEY COPE TODAY, NOT WHETHER THE GAP EXISTS.
     "Do you have online booking?" is a question VISION already answered by
     reading the site, and asking it tells the prospect nobody looked. "Are
     most new customers booking through the website now, or are calls still
     doing most of the work?" is genuinely unknown and gets them talking
     about the thing the offer addresses. */
  const gapQuestion = strategy.gap ? GAP_DISCOVERY[strategy.gap] : null;
  /* STRUCTURED, NOT PROSE. The first version tested /phone/i against the
     signal's DETAIL sentence and failed on "The published call route is an
     established way to open a conversation" — a real route, described without
     the word phone. observedChannels is the structured list and cannot drift
     with wording. */
  const channels = context.contactability?.observedChannels || [];
  const phoneOnly = channels.length > 0 && channels.every((c) => c === 'call');
  const hasReputation = (observed || []).some((sg) => sg.kind === 'reputation');
  const eventQuestion = eventSay.question || null;
  const unknownQuestion = questionFromUnknown(selection.importantUnknowns[0]);

  const firstQuestion = eventQuestion || gapQuestion || unknownQuestion
    || 'How are new customers finding you at the moment?';

  const discovery = [...new Set([
    firstQuestion,
    gapQuestion,
    strategy.eventDriven ? (EVENT_DISCOVERY[selection.whyNowResolved?.category] || null) : null,
    unknownQuestion,
    /* Only when the contact is a generic inbox. Asking a named practice
       manager "who else would be part of a decision" on a first call is both
       presumptuous and something VISION has no evidence about. */
    strategy.commitment.kind === 'introduce_decision_maker'
      ? 'Who would normally be involved in a decision like this?' : null,
    /* GROUNDED IN WHAT WAS ACTUALLY OBSERVED, so the founder sounds like
       somebody who looked. Only offered when the evidence is really there:
       the phone question needs the phone to be the ONLY route found, and the
       reputation question needs a reputation signal on file. */
    phoneOnly ? EVIDENCE_DISCOVERY.phone_only : null,
    hasReputation ? EVIDENCE_DISCOVERY.reputation : null,
    'What have you already tried for that?',
  ].filter(Boolean))].slice(0, BOUNDS.maxDiscovery);

  return {
    whyChosen: selection.whyChosen,
    whyNow: selection.whyNow,
    whyThisProspect: `${selection.whyChosen} ${selection.whyNow}`.slice(0, BOUNDS.whyThisProspect),
    strengths,
    weaknesses,
    offerFit: offer
      ? `The founder's recorded offer is: "${offer}". VISION has not written a tailored fit argument for this prospect — the deterministic record states the offer verbatim rather than paraphrasing it into something that was never agreed.`.slice(0, BOUNDS.offerFit)
      : 'No confirmed offer is on file for this venture, so no fit argument can be made. Clarify the offer first.',
    whatToSay: {
      opening,
      angle: eventSay.angle
        ? `Lead with the event — ${selection.whyNowResolved?.headline || eventSay.angle} — and ask what it changed rather than asserting what they now need.`.slice(0, BOUNDS.angle)
        : (openingFact
          ? `Lead with what was actually observed — ${strategy.hook?.spoken || openingFact} — and ask before diagnosing.`.slice(0, BOUNDS.angle)
          : 'There is not enough observed evidence to build an angle. Research before approaching.'),
      firstQuestion: firstQuestion.slice(0, BOUNDS.firstQuestion),
      discoveryQuestions: discovery,
      dontSay: [
        'Do not state anything from the Unknown list as though it were established.',
        'Do not describe results, client numbers or experience the venture record does not contain.',
      ],
    },
    /* WAS AN EMPTY ARRAY. A founder on a real call gets pushback in the first
       thirty seconds, and VISION's deterministic floor handed them nothing. */
    objections: buildObjections({
      hook: strategy.hook, commitment: strategy.commitment, likelyConcern: strategy.likelyConcern,
    }).map((item) => ({
      objection: item.objection.slice(0, BOUNDS.objection),
      likelyMeaning: item.likelyMeaning.slice(0, BOUNDS.likelyMeaning),
      response: item.response.slice(0, BOUNDS.objectionResponse),
    })),
    /* THE WHOLE CALL, not the first ninety seconds. The bridge and the close
       were simply missing, so the script ran out exactly where a founder
       needs it most. */
    callStructure: [
      { phase: 'Open', note: 'Name yourself, give the observed reason you called, ask for the time.'.slice(0, BOUNDS.callNote) },
      { phase: 'Ask, then stop talking', note: `Lead with: ${firstQuestion}`.slice(0, BOUNDS.callNote) },
      { phase: 'Discover', note: 'Work through the discovery questions. Do not diagnose yet — you are checking whether the thing you observed is actually a problem for them.'.slice(0, BOUNDS.callNote) },
      {
        phase: 'Bridge — only if they say it is a problem',
        /* CONDITIONAL BY CONSTRUCTION. The sentence is unusable until the
           prospect has said the problem is real, which is the only honest
           order: VISION observed an absence, not a need. */
        note: (strategy.bridge
          ? `If they confirm it — and only then — connect it: "${strategy.bridge.condition}, that is the part we handle." Do not pitch into silence.`
          : 'No confirmed offer is on file, so there is nothing to bridge to. Clarify the offer first.').slice(0, BOUNDS.callNote),
      },
      { phase: 'Expect pushback', note: 'The likely objections are listed beside this. Answer, then ask one more question rather than pressing.'.slice(0, BOUNDS.callNote) },
      { phase: 'Close', note: strategy.commitment.ask.slice(0, BOUNDS.callNote) },
    ],
    outreach: {
      call: canWrite('call') ? opening : '',
      email: canWrite('email') && openingFact
        ? `Hi [name],\n\n${openingFact}\n\n${firstQuestion}\n\n[name]` : '',
      sms: canWrite('sms') && openingFact ? `Hi [name] — ${openingFact} ${firstQuestion}` : '',
      dm: canWrite('dm') && openingFact ? `${openingFact} ${firstQuestion}` : '',
    },
  };
}

/* ════════════ 5 · ORCHESTRATION ════════════ */

export function buildProspectPrompt({ context, selection, decision }) {
  const permitted = context.contactability.permittedChannels;
  const inbound = context.leadType === 'b2c';

  const system = [
    'You write the intelligence file a founder reads in the sixty seconds before contacting a real person. Every decision has already been made by code; you phrase them, you do not revisit them.',
    '',
    'THINK IN THIS ORDER, and let it show in what you write:',
    '  1. What was actually OBSERVED about this prospect.',
    '  2. What that might mean commercially — stated as a possibility, not a diagnosis.',
    '  3. What is still UNKNOWN and would change the answer.',
    '  4. The one question that tests it.',
    '  5. Wider discovery.',
    '  6. The offer, and ONLY if the answers make it relevant.',
    'The founder must not pitch before establishing that the problem is real. A pitch in step 2 is a failed call.',
    '',
    'WHY CHOSEN — the hardest part, and the one most often written badly.',
    'Answer: why this prospect, why for THIS founder, and why now (only if a timing event exists).',
    'Use the BUSINESS reasons. Execution readiness — that a phone number exists, that a website exists, that the research is fresh — explains why VISION CAN act, never why the prospect is worth pursuing. Never open with it.',
    'Never cite a score, a grade, or a ranking position. Never claim this prospect beats others unless a comparison cohort is given below.',
    '',
    'UNKNOWNS. Anything listed under UNKNOWNS may appear ONLY as a question, or hedged with "may", "might", "could", "possibly", or "it is not yet known whether".',
    'You may NOT write "they need", "they want", "they are struggling", "they lack", "they are losing" or any equivalent about an unknown. That is the single most common reason an answer is rejected.',
    '',
    'THE OPENING must sound like a human saying it out loud. Ask permission, reference ONE genuinely interesting observed fact, and diagnose nothing.',
    'Pick the fact a person would find worth discussing. "You have a website" and "you have a phone number" are true and boring — never open with those.',
    '',
    'THE FIRST QUESTION must test the business condition behind the most important unknown, not recite the unknown back.',
    'Weak: "Can I ask whether growth is currently a priority?"  Strong: "Where are most of your new patients coming from at the moment?"',
    '',
    'DISCOVERY: 3-5 questions that would actually decide whether this opportunity is real. Draw only on categories that fit this prospect — current solution, capacity, pain, urgency, decision ownership, economics, incumbent provider, desired outcome. Never ask something the context already answers.',
    '',
    'OBJECTIONS must fit this prospect and this offer. likelyMeaning is interpretation and must be hedged. Never attack an incumbent provider you have no evidence about.',
    '',
    'STRENGTHS are reasons this PITCH could land, not reasons VISION could dial. Same test as WHY CHOSEN: "an official website is listed", "listed as currently operating", "a public call route is available" and "the address matches the search area" are execution readiness — they say the prospect is real and reachable, which is a precondition, not an argument. Use the BUSINESS reasons: who they are, what the offer speaks to, what was actually observed about how they operate. If only readiness facts exist, return fewer strengths rather than padding with them.',
    'WEAKNESSES are the open questions that could sink this pitch, each phrased as an unknown — "it is not yet known whether ...". Never a criticism of the prospect and never a finding.',
    '',
    'DO NOT SAY must be specific to this prospect. "Do not make unsupported claims" is useless; "Do not tell them their marketing is failing — nothing observed establishes that" is useful.',
    '',
    'ABSOLUTE RULES:',
    '  A. Use ONLY facts given below. If it is not here, it is not true and you may not say it.',
    '  B. Never claim anything about the founder — client numbers, results, revenue, years of experience, guarantees, partnerships, certifications, team size — unless it appears under trustedClaims.',
    '  C. Never use a number that does not appear in the context.',
    `  D. Write outreach ONLY for: ${permitted.length ? permitted.join(', ') : 'NONE — return an empty string for every channel'}. Empty string for every other channel. Do not send the same script four times; each channel reads differently.`,
    inbound
      ? '  E. This person contacted the founder. Speak to them in the second person. Their browsing history may justify urgency internally but must NEVER be recited back — say "you got in touch about a quote", never "I saw you viewed our pricing page twice".'
      : '  E. This is outbound. The prospect does not know who the founder is, so earn the conversation before asking for anything.',
    '',
    `The action, already decided by code: ${decision.action}${decision.channel ? ` via ${decision.channel}` : ''}. Write for that action and no other.`,
  ].join('\n');

  const user = JSON.stringify({
    founder: {
      businessName: context.founder.businessName,
      confirmedOffer: context.founder.offer,
      offerIsConfirmed: context.founder.offerConfirmed,
      targetCustomer: context.founder.targetCustomer,
      currentObjective: context.founder.currentObjective,
      currentBottleneck: context.founder.currentBottleneck,
      trustedClaims: context.founder.trustedClaims,
    },
    prospect: context.prospect,
    leadType: context.leadType,
    lifecycle: context.lifecycle,
    contactability: context.contactability,
    freshness: context.freshness,
    observedEvidence: context.evidence.observed,
    inferredEvidence: context.evidence.inferred,
    UNKNOWNS: selection.importantUnknowns,
    timeline: context.timeline,
    /* Three separate lists, on purpose. */
    selection: {
      businessReasons: (selection.businessReasons || []).map((reason) => reason.statement),
      timingReasons: (selection.timingReasons || []).map((reason) => reason.statement),
      executionReadiness: (selection.executionReadiness || []).map((reason) => reason.statement),
      comparisonCohortSize: selection.comparisonSetSize || 0,
    },
    /* THE PLAN THE WORDS MUST SERVE. Handing the model evidence and asking for
       a script gets a script that is about the evidence; handing it the
       objective, the hook, the unknown to resolve and the commitment to ask
       for gets one that is about the conversation. The deterministic path
       already generates from exactly this, so a cache hit and a generation
       are working to the same plan rather than two different ones. */
    scriptStrategy: deriveScriptStrategy({
      context, selection, decision,
      whyNow: selection.whyNowResolved || null,
      contact: context.contact || null,
      offerGap: context.offerGap || null,
      stage: context.lifecycle?.stage || null,
    }),
    decidedAction: decision,
  });

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Builds the canonical Prospect Intelligence record.
 *
 * @param {object} params
 * @param {function|null} [params.synthesize] async ({messages, schema}) =>
 *   {ok, parsed}. INJECTED, never imported: this module runs in Node under
 *   test against a scripted model and in Deno in production against the real
 *   adapter, and it must not know the difference. Omit it and the record is
 *   built deterministically, which is a supported outcome rather than a
 *   degraded one.
 */
export async function buildProspectIntelligence({
  prospect, ventureState, ranking, eligibility, leadType = 'b2b',
  comparisonSet = null, now = new Date().toISOString(), synthesize = null, contact = null,
}) {
  const context = buildProspectContext({ prospect, ventureState, ranking, eligibility, leadType, now, contact });
  const selection = buildSelectionRationale({ context, ranking, comparisonSet });
  /* THE SAME RECONCILIATION THE BOARD APPLIES. Without it the two surfaces
     disagree about one prospect: the board refused a real staging lead as
     `observe_only` with no workspace, and opening that same lead returned
     "Call this week" and a finished script. */
  const priority = assessPriority({
    signals: prospect?.signals || [], offerAddresses: ventureState?.offerAddresses || [], now,
    consent: context.contactability?.consent || null,
    priorContactChecked: prospect?.priorContactChecked,
    alreadyContacted: (prospect?.contactHistory || []).length > 0,
    previouslyRejected: prospect?.state === 'rejected',
  });
  const priorityDecides = (ventureState?.offerAddresses || []).length > 0
    && priority.factors.need.evidenceStatus !== 'UNKNOWN';
  const decision = reconcileActionWithPriority({
    decision: decideNextBestAction({ context, ranking, eligibility }),
    priority, priorityDecides, isRefusal: isRefusalAction,
  });

  let language = deterministicLanguage({ context, selection, decision });
  let synthesisSource = 'deterministic';
  let repairAttempted = false;
  let violations = [];

  /* A REFUSED PROSPECT IS NEVER WORTH A GENERATION. The decision above may
     be "do not contact", "find a contact route first", "the evidence is
     stale" — and every one of those means the workspace shows a refusal
     note, not a script. The language would be written, cached, and never
     read by anybody.

     Found while trying to prove the contact dead-end on real staging: every
     uncached prospect cost a model call to open, INCLUDING the refused ones
     whose script is discarded by hasWorkspaceContent() moments later. The
     deterministic language is already computed above and is all a refusal
     needs. */
  if (typeof synthesize === 'function' && !isRefusalAction(decision.action)) {
    const schema = prospectLanguageSchema();
    const attempt = async (messages) => {
      const result = await synthesize({ messages, schema });
      if (!result || result.ok !== true || !result.parsed) return null;
      const grounded = groundProspectLanguage({ language: result.parsed, context, decision, selection });
      return { parsed: result.parsed, grounded };
    };

    const messages = buildProspectPrompt({ context, selection, decision });
    let outcome = await attempt(messages);

    /* ONE bounded repair. The retry is given the exact violations rather than
       "try again", because a model that could not see what was wrong the first
       time will reproduce it. If the second answer is still ungrounded we stop
       — a third attempt is just a slower way to accept a worse answer, and the
       deterministic record is always available and always true. */
    if (outcome && !outcome.grounded.valid) {
      violations = outcome.grounded.violations;
      repairAttempted = true;
      const repairMessages = [
        ...messages,
        { role: 'assistant', content: JSON.stringify(outcome.parsed) },
        {
          role: 'user',
          content: `That answer was rejected. Fix EVERY one of these and change nothing else:\n${violations.map((violation) => `- [${violation.code}] ${violation.detail}`).join('\n')}`,
        },
      ];
      outcome = await attempt(repairMessages);
    }

    if (outcome && outcome.grounded.valid) {
      language = outcome.parsed;
      synthesisSource = repairAttempted ? 'model_repaired' : 'model';
      violations = [];
    } else if (outcome) {
      violations = outcome.grounded.violations;
    }
  }

  /* ── THE EVENT OUTRANKS THE PROSE, WHATEVER WROTE IT ─────────────────
     A verified event reached the deterministic script, and nothing else. On a
     CACHE HIT the stored prose is served instead — and the cache fingerprint
     (prospect-language-cache.js) covers signals, ranking, founder facts and
     the decided action, but NOT why-now signals. So a founder could click
     Research, watch the Why Now block fill with an acquisition twelve days
     old, and still be reading an opening written before VISION knew about it.
     The same applies to model prose generated before the event landed.

     Fixed HERE rather than in the fingerprint on purpose: adding why-now
     signals to the fingerprint is the tidier-looking answer, but it
     invalidates every cached row the moment any event is stored, and the
     regenerated prose costs a model call to say something this overlay
     already produces deterministically and for free.

     Only the three lines that reference the event are replaced. Everything
     else the model wrote — strengths, weaknesses, fit, objections, outreach —
     is untouched, because none of it is made wrong by the event. */
  const eventOverlay = whyNowScript(selection.whyNowResolved);
  if (eventOverlay.angle && language?.whatToSay) {
    const deterministic = deterministicLanguage({ context, selection, decision });
    language = {
      ...language,
      whatToSay: {
        ...language.whatToSay,
        opening: deterministic.whatToSay.opening,
        angle: deterministic.whatToSay.angle,
        firstQuestion: deterministic.whatToSay.firstQuestion,
        discoveryQuestions: deterministic.whatToSay.discoveryQuestions,
      },
    };
  }

  const record = {
    contractVersion: PROSPECT_INTELLIGENCE_CONTRACT_VERSION,
    leadId: context.prospect.id || prospect?.id || 'unknown',
    ventureId: context.founder.ventureId || ventureState?.ventureId || 'unknown',
    generatedAt: now,
    leadType,
    /* DISPLAY IDENTITY. Proven missing by the L3 field audit: the view model's
       name fell through `workspace.name || selection.displayName || leadId`,
       and neither of the first two has ever existed on this record — so every
       real lead rendered its UUID where its name belongs. Identity is carried
       explicitly now rather than reconstructed by a fallback chain. */
    identity: {
      name: context.prospect.name || null,
      category: context.prospect.category || null,
      location: context.prospect.location || null,
    },
    lifecycleStage: context.lifecycle.stage,
    isLead: context.lifecycle.isLead,
    confidence: overallConfidence(context, ranking),
    /* Stays null until real lead distribution data exists. */
    presentationGrade: null,
    qualification: {
      opportunityScore: Number.isFinite(ranking?.dimensions?.opportunityScore) ? ranking.dimensions.opportunityScore : null,
      qualified: ranking?.qualified === true,
      threshold: LEAD_QUALIFICATION_THRESHOLD,
      source: 'ranking',
    },
    contactability: context.contactability,
    freshness: context.freshness,
    selection: {
      /* Model prose replaces the deterministic sentence ONLY once grounded. */
      whyChosen: language.whyChosen || selection.whyChosen,
      whyNow: language.whyNow || selection.whyNow,
      /* THE STRUCTURE SURVIVES THE PROSE. Model language may replace the
         sentence, but the tier, the date, the confidence and the source are
         facts the Workspace renders as its own fields — flattening them into
         whyNow would mean the founder is shown "12 days ago" only if a model
         chose to mention it. Deliberately taken from the deterministic
         resolver, never from generated text. */
      whyNowResolved: selection.whyNowResolved || null,
      reasons: selection.reasons,
      strongestEvidenceRefs: selection.strongestEvidenceRefs,
      importantUnknowns: selection.importantUnknowns,
      relativePriorityReason: selection.relativePriorityReason,
    },
    workspace: {
      /* ── WHAT THE FOUNDER IS ACTUALLY SELLING ──────────────────────────
         The workspace described the PROSPECT in depth and the OFFER not at
         all, so a founder walked into a call with no answer to "how much is
         it?" -- the commonest question in the first ninety seconds. Both
         values are already established and already gated: `offer` is carried
         verbatim (paraphrasing an offer changes its terms) and `pricing` is
         read from trustedClaims, so it exists here only when a trusted
         founder fact established it. Absent stays null and is never
         substituted. */
      offer: {
        what: context.founder.offer || null,
        pricing: (context.founder.trustedClaims && context.founder.trustedClaims.pricing
          && context.founder.trustedClaims.pricing.value) || null,
        pricingSource: (context.founder.trustedClaims && context.founder.trustedClaims.pricing
          && context.founder.trustedClaims.pricing.sourceReference) || null,
      },
      /* ── THE OTHER CONVERSATION ────────────────────────────────────────
         `whatToSay` prepares the call with the decision-maker. On a cold
         call to a business with a front desk that is usually not who picks
         up, so the founder arrived prepared for the half of the call they
         had not reached yet. Deterministic, compact, and carried ALONGSIDE
         the buyer script rather than instead of it -- showing both is what
         keeps who-answers unknown. Handing over only the buyer script tells
         the founder, implicitly, that the buyer will answer. */
      gatekeeper: buildGatekeeperPlan({
        prospectName: context.prospect && context.prospect.name,
        contactRole: context.contact && context.contact.role,
        offer: context.founder.offer,
      }),
      whyThisProspect: language.whyThisProspect,
      strengths: language.strengths || [],
      weaknesses: language.weaknesses || [],
      offerFit: language.offerFit,
      signalTimeline: context.timeline,
      nextBestAction: decision,
      whatToSay: language.whatToSay,
      objections: language.objections || [],
      callStructure: language.callStructure || [],
      outreach: language.outreach,
    },
    provenance: {
      synthesis: synthesisSource,
      repairAttempted,
      rejectedViolations: violations,
      rankingSource: 'ranking.js',
      eligibilitySource: 'eligibility.js',
    },
  };

  const validation = validateProspectIntelligence(record);
  return { record, validation, context, selection, decision };
}

/** Confidence in the FILE, not in the sale. It is the strength of what we
 * actually observed, reduced when the file is stale or thin. */
function overallConfidence(context, ranking) {
  const observed = context.evidence.observed || [];
  if (!observed.length) return 0;
  const mean = observed.reduce((total, signal) => total + (Number.isFinite(signal.confidence) ? signal.confidence : 0), 0) / observed.length;
  const freshnessFactor = context.freshness.fresh ? 1 : 0.5;
  const qualifiedFactor = ranking?.qualified === true ? 1 : 0.7;
  return Math.max(0, Math.min(1, Number((mean * freshnessFactor * qualifiedFactor).toFixed(2))));
}

export const PROSPECT_INTELLIGENCE_INTERNALS = Object.freeze({
  DIMENSION_LANGUAGE, GENERIC_PHRASES, FOUNDER_CLAIM_PATTERNS, HEDGES,
  BUSINESS_ORDER, REASON_CLASSES, OPENING_INTEREST,
  topReasons, preferredChannel, openingReferencesEvidence, overallConfidence,
  mostInterestingObserved, SENSITIVE_CLAIM_KEYS,
});
