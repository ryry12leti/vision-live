/**
 * Founder Mission Policy — deterministic prerequisite mission templates.
 *
 * A prerequisite mission is generated only when VISION can safely create
 * the missing resource itself, without inventing a fact about the real
 * world (a real business, a real price, a real customer). Every template
 * here only ever asks the founder to go COLLECT real information (business
 * names, a public source, a stated price) -- it never claims a business
 * needs the service, never fabricates contact details, never invents
 * revenue or commitments. This is deliberately NOT Lead Intelligence: no
 * automated discovery, no scraping, no maps/Places API -- the founder does
 * the identifying, VISION only defines the mission and the evidence bar.
 */

import { buildEvidenceBatchReference } from '../decision-core/evidence-batch.js';

/* The mission's title always starts with one of these. Exported as the one
   durable signal that "the venture's active task IS the prospect-discovery
   prerequisite" -- the thread's routeId cannot answer that question, because
   this mission is deliberately stamped with the TARGET route's id
   (founder_customer_interview_set / founder_sales_outreach_block), the same
   id it carries once genuinely unlocked. A title prefix is the only durable
   signal available without a schema change, and it is the same kind of
   signal deriveFounderCompletionEvent already relies on for its own re-fire
   guard, so this is not a new class of fragility.

   Both prefixes are deliberately COUNT-INDEPENDENT. They used to embed the
   literal quantity (`...list of 10 `), which only worked while the quantity
   was a constant; now that it varies per founder, a prefix containing the
   number would stop matching for everyone whose push level is not moderate,
   silently disabling the advance trigger for them. */
export const PROSPECT_LIST_TITLE_PREFIX = 'Build a qualified list of ';
/* The partial-batch variant. A distinct prefix rather than a reworded suffix
   so the two states are distinguishable by the same cheap check. */
export const PROSPECT_LIST_CONTINUE_TITLE_PREFIX = 'Finish your qualified list of ';

/**
 * Whether a task title belongs to the prospect-discovery prerequisite, in
 * either its starting or its continuing form.
 *
 * Callers must use this rather than testing one prefix: a founder who has
 * already gathered some prospects is on the CONTINUE title, and a check
 * against the start prefix alone would conclude they were on some unrelated
 * mission and refuse to advance them.
 */
export function isProspectListMissionTitle(title) {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) return false;
  return text.startsWith(PROSPECT_LIST_TITLE_PREFIX) || text.startsWith(PROSPECT_LIST_CONTINUE_TITLE_PREFIX);
}

/* The templates below interpolate the founder's OWN free text (their target
   customer, their offer, their product), which intake accepts up to
   MAX_ANSWER_TEXT_LENGTH = 1000 characters. Nothing here bounded it, so a
   normal answer produced a title far past the database's limit.
   Measured: a real answer gave a 227-byte title against a 120-BYTE cap in
   validate_founder_generated_task_v1, which rejects rather than trims -- and
   founderDecisionResultToLegacyTask's own clean(title, 120) slices by
   CHARACTER, so a multibyte answer can still exceed 120 bytes after it. Hence
   a byte-aware bound here, at the point the text is composed. */
const TITLE_BYTE_BUDGET = 112;
/* 130, not a rounder number, because missionStatement becomes the task's `why`
   and validate_founder_generated_task_v1 caps that at 500 BYTES -- and, like
   the title, rejects rather than trims. The longest statement here is 193
   bytes of fixed text around two interpolations, so 2 x 130 leaves 453 bytes
   worst case. founderDecisionResultToLegacyTask's clean(why, 500) slices by
   character and so cannot be relied on to keep a multibyte answer under a byte
   cap. */
const PHRASE_BYTE_BUDGET = 130;
const ELLIPSIS_BYTES = 3;

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).length;
}

/** Trims to a word boundary inside a BYTE budget, never mid-word and never
 * mid-character. Returns the text untouched when it already fits, so short
 * answers are never marked with an ellipsis they did not earn. */
/* Words that cannot END a shortened phrase. Cutting on a bare word boundary
   left titles like "...small service businesses in Newcastle who either have no
   website or…" -- grammatical up to the last two words, then dangling. A
   trailing conjunction, preposition, article or relative pronoun promises a
   continuation that the ellipsis then swallows, which reads as a bug rather
   than as a deliberate shortening. Dropping them lands the cut on a complete
   idea: "...small service businesses in Newcastle…". */
const DANGLING_TAIL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or',
  'per', 'that', 'the', 'their', 'them', 'these', 'this', 'those', 'to', 'via', 'who', 'whom',
  'whose', 'which', 'with', 'within', 'while', 'when', 'where', 'either', 'neither', 'both',
  'my', 'our', 'your', 'its', 'his', 'her', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
]);

function trimDanglingTail(text) {
  const words = text.split(' ').filter(Boolean);
  /* Never strip below half the words -- a phrase made mostly of these would
     otherwise collapse to almost nothing, which is worse than a dangling word. */
  const floor = Math.max(1, Math.ceil(words.length / 2));
  while (words.length > floor && DANGLING_TAIL_WORDS.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) {
    words.pop();
  }
  return words.join(' ');
}

function boundedPhrase(value, maxBytes) {
  const text = String(value ?? '').trim();
  if (byteLength(text) <= maxBytes) return text;
  let cut = text;
  while (cut.length > 1 && byteLength(cut) > maxBytes - ELLIPSIS_BYTES) cut = cut.slice(0, -1);
  const lastSpace = cut.lastIndexOf(' ');
  /* Only honour the word boundary when it keeps most of the budget; a single
     very long token would otherwise collapse the phrase to almost nothing. */
  if (lastSpace > Math.floor(cut.length / 2)) cut = cut.slice(0, lastSpace);
  /* Also drop a trailing comma/semicolon so the ellipsis follows a word. */
  return `${trimDanglingTail(cut.trimEnd()).replace(/[,;:]+$/, '')}…`;
}

function cleanPhrase(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.trim().replace(/[.!?\s]+$/, '');
}

/* Lowercases the first letter so the founder's own phrase reads correctly
   mid-sentence ("Find 8 independent cafes..."), EXCEPT where doing so would
   corrupt an acronym. "PC players who like roguelike deckbuilders" became "pC
   players" in the task title -- the first thing a founder reads, and a typo
   that makes the whole task look machine-generated.
   The rule is capitalisation INSIDE the first word: an ordinary sentence
   opening ("Independent cafes") has no capital after its first letter, while a
   name does -- PC, SaaS, B2B, iOS, UK, SEO, DTC. That covers mixed-case
   acronyms an all-caps test would miss, and needs no list to maintain. */
function lowerFirst(value) {
  if (value.length === 0) return value;
  const firstWord = value.split(/\s/, 1)[0];
  if (/[A-Z]/.test(firstWord.slice(1))) return value;
  return value[0].toLowerCase() + value.slice(1);
}

/**
 * @param {object} params
 * @param {string|null} params.targetCustomerLabel Real, self-reported target customer description.
 * @param {string|null} params.offerLabel Real, self-reported offer/idea description.
 * @param {string} params.routeId The route this prerequisite unlocks.
 * @param {{screenCount: number, requiredCount: number, contactCount: number}} params.quantities
 *   Resolved for THIS founder by mission-quantities.js. Required: there is no
 *   fallback quantity here, because a default written into the template is
 *   exactly the hardcoding that made every founder's list the same size.
 * @param {{state: 'empty'|'partial', collected: number, remaining: number}} params.batchProgress
 *   How far along the founder's real prospect batch already is. Decides
 *   whether this mission reads as "start the list" or "finish the list", and
 *   is what closes the gap where a partly-built list left the founder with
 *   no mission at all.
 * @param {{batchId: string, source: string}|null} [params.batchReference]
 *   Durable pointer to the stored batch, when one exists.
 * @returns {object} A TodaysMove-shaped mission, missionLevel: 'prerequisite'.
 */
export function prospectDiscoveryMission({
  targetCustomerLabel, offerLabel, routeId, demandAlreadyProven = false, quantities, batchProgress,
  batchReference = null,
}) {
  if (!quantities || !Number.isInteger(quantities.requiredCount) || quantities.requiredCount <= 0) {
    throw new RangeError('prospectDiscoveryMission requires resolved mission quantities; the list size must come from the founder, not from this template');
  }
  const { screenCount, requiredCount, contactCount } = quantities;
  const progress = batchProgress && batchProgress.state === 'partial'
    ? batchProgress
    : { state: 'empty', collected: 0, remaining: requiredCount };
  const continuing = progress.state === 'partial';
  /* How many the founder still has to add. On a fresh list this is the full
     requirement; on a partly-built one it is only the shortfall, which is the
     whole point -- being told to "find 8" after already approving 5 is what
     makes a founder abandon the list rather than finish it. */
  const outstanding = continuing ? progress.remaining : requiredCount;
  const targets = lowerFirst(cleanPhrase(targetCustomerLabel, 'target customers'));
  const offer = lowerFirst(cleanPhrase(offerLabel, 'your service'));
  /* The title previously ended `to validate your ${offer}`, which broke in two
     ways at once. Grammatically, a real offer almost always opens with a
     determiner -- "a full mobile groom at their house" -- giving "validate
     your a full mobile groom". And it put a second unbounded free-text field
     into the one string with the tightest budget.
     Dropping that clause fixes both: the offer is not lost, it still appears
     verbatim in missionStatement below, where "it may need <offer>" reads
     correctly with the determiner intact and the founder's own wording is
     preserved rather than reworded to fit a sentence frame. The title keeps
     the part that makes it actionable -- who the list is of. */
  const titleLead = continuing ? PROSPECT_LIST_CONTINUE_TITLE_PREFIX : PROSPECT_LIST_TITLE_PREFIX;
  const titleTargets = boundedPhrase(targets, TITLE_BYTE_BUDGET - byteLength(titleLead));

  return {
    status: 'selected',
    missionLevel: 'prerequisite',
    routeId,
    unlocksRouteIds: ['founder_customer_interview_set', 'founder_sales_outreach_block'],
    missingPrerequisite: 'customerEntities',
    title: `${titleLead}${titleTargets}`,
    missionStatement: continuing
      ? `You have ${progress.collected} qualified so far. Add ${outstanding} more ${boundedPhrase(targets, PHRASE_BYTE_BUDGET)} to reach ${requiredCount}. Record each business name, location, public contact method, and one observable reason it may need ${boundedPhrase(offer, PHRASE_BYTE_BUDGET)}. Select the strongest ${contactCount} for first contact.`
      : `Find ${requiredCount} ${boundedPhrase(targets, PHRASE_BYTE_BUDGET)} that match your target customer. Record each business name, location, public contact method, and one observable reason it may need ${boundedPhrase(offer, PHRASE_BYTE_BUDGET)}. Select the strongest ${contactCount} prospects for first contact.`,
    completionDefinition: `A completed list of ${requiredCount} real ${boundedPhrase(targets, PHRASE_BYTE_BUDGET)}, with ${contactCount} prioritised prospects and one evidence-based reason for each priority.`,
    requiredEvidence: [
      `${requiredCount} named businesses, each currently trading`,
      'a public source or link for each',
      'a contact method where publicly available',
      'the specific gap observed for each, in your own words',
      `${contactCount} prioritised prospects with the opening line you would use`,
    ],
    expectedBusinessOutcome: 'You gain a real prospect base that unlocks customer interviews or outreach, instead of relying on an abstract target market.',
    confidence: 'medium',
    /* An established business reaching this mission has PROVEN demand -- saying
       "no customer evidence exists yet" to a founder with paying clients is
       simply false, and is the kind of line that makes a real user stop
       trusting the rest of the task. */
    /* The continuing case gets its own wording for a plain accuracy reason:
       telling a founder who has already qualified real businesses that "no
       individually identified prospects exist yet" is false, and it is the
       kind of line that makes them stop believing the rest of the task. */
    whyNow: continuing
      ? `You already have ${progress.collected} qualified ${progress.collected === 1 ? 'prospect' : 'prospects'} recorded, which is real progress -- but ${requiredCount} is the point where the list stops being a handful of names and starts being something you can work through without running out after two rejections. ${outstanding} more finishes it.`
      : demandAlreadyProven
        ? 'Based on what you told VISION, you already have paying customers, so the offer clearly sells. What you do not have is a repeatable way to reach more of them -- every client so far arrived without a system behind it. A real, qualified prospect list is the smallest useful step toward one.'
        : 'Based on what you told VISION, your service is ready and you want clients, but no individually identified prospects or customer evidence exist yet. Prospect discovery is the smallest useful action that unlocks the next validated route.',
    selectionExplanation: continuing
      ? `Customer/problem validation is the assessed bottleneck. ${progress.collected} qualified ${progress.collected === 1 ? 'prospect exists' : 'prospects exist'} but the mission asked for ${requiredCount}, so finishing the list is the smallest safe next action -- moving to outreach on a partial list would burn the few real prospects already found.`
      : `Customer/problem validation is the assessed bottleneck. No named, reachable prospects exist yet, so the smallest safe next action is building a real, qualified prospect list -- not a route that assumes prospects already exist.`,
    requiredResources: [],
    missingResources: [],
    timeEstimate: 60,
    effortLevel: 'moderate',
    deadline: null,
    rejectedAlternativeSummaries: [],
    persistedTaskId: null,
    /* These told the founder WHAT to produce and nothing about HOW, which is
       the difference between a task and a mentor. "Identify 10 real
       businesses" is not instruction -- a founder who knew how to source and
       qualify prospects would not be stuck at this bottleneck. Each step now
       names where to look, what to look at, and what disqualifies a business,
       within the 200-byte per-step limit the task contract enforces. */
    steps: [
      /* Names VISION's own lead search first: it finds real businesses by area
         and segment against a live places provider, and sending a founder to a
         manual maps search when the product can do it is worse than useless.
         Named by its NAV LABEL, not by a URL. An earlier version read "Open
         VISION's Founder page (/founder)", which hardcoded a frontend route
         into engine output; a route can be renamed without the engine knowing,
         and the founder would be sent to a dead address by a task that still
         looked authoritative. A nav label is the stable, user-visible handle.
         The label must keep matching the nav entry in dashboard.html/tasks.html
         -- qa-founder-prospect-search-reachable.mjs fails if it stops. The
         manual route stays as the alternative, since the search may not cover
         every segment. */
      { order: 1, label: `Open Prospects in the menu and search for ${boundedPhrase(targets, 60)}, or use maps and directories. Aim for ${screenCount} clearly still trading.`.slice(0, 200), actionType: 'identify_prospects', referenceId: null },
      { order: 2, label: 'For each, open their website and social pages. Write down the specific gap you can SEE: no site, a dead page, nothing posted recently, no reviews answered.'.slice(0, 200), actionType: 'record_prospect_source', referenceId: null },
      { order: 3, label: `Cut any where you could not see the gap yourself, and any national chain or business already running an agency. Keep the best ${outstanding}.`.slice(0, 200), actionType: 'record_prospect_source', referenceId: null },
      { order: 4, label: `Pick the ${contactCount} with the clearest gap. For each, write the one sentence you would open with, naming what you saw.`.slice(0, 200), actionType: 'prioritise_prospects', referenceId: null },
      { order: 5, label: `Record the finished list: name, location, contact route, the gap you observed, and your opening line for the top ${contactCount}.`.slice(0, 200), actionType: 'record_prospect_list', referenceId: null },
    ],
    /* The bar that decides whether a business belongs on the list at all.
       Previously this said only that entries must be real and verifiable,
       which does not tell a founder what makes a prospect WORTH contacting. */
    professionalStandard: [
      'A business only qualifies if you can see the gap yourself -- a missing site, a dead page, nothing posted for months. Never an assumption about what they need',
      'Every entry has a real name, a location and a contact route you have actually opened, not one you assume exists',
      'No national chains and nobody already running an agency: you want an owner who can decide without a committee',
      `The ${contactCount} you prioritise are chosen on the gap you recorded, not on which business felt nicest to approach`,
    ],
    learningSupport: null,
    /* Domain-neutral pointer to the stored batch (decision-core/
       evidence-batch.js), carried on the mission so the task compiled from it
       can name a real, re-resolvable collection instead of embedding prospect
       records that would be stale the moment one is approved or rejected.
       Null when no batch exists yet -- the founder has not run a search. */
    evidenceBatchReference: batchReference
      ? buildEvidenceBatchReference({
        kind: 'customer_prospect',
        batchId: batchReference.batchId,
        source: batchReference.source,
        collectedCount: progress.collected,
        requiredCount,
      })
      : null,
  };
}

/* The consumer-audience counterpart to prospectDiscoveryMission.
   A founder selling to individual people cannot be handed a business prospect
   list -- there is no directory of "PC players who like deckbuilders", and
   pretending otherwise is what the venture router now refuses. But refusing is
   only half an answer: a founder who is told "not supported yet" and given
   nothing has still been left without a move.
   What IS enumerable for a consumer venture is not the people, it is the
   PLACES they already gather. A founder can genuinely go and list real
   communities, check whether they are alive, and read their rules -- every
   step is something they can verify with their own eyes, which is the same bar
   the business mission holds.
   Deliberately NOT game-specific. It names no platform, no store and no genre:
   the same mission serves a consumer app, a DTC brand and a creator, and the
   founder's own words for their audience carry the specificity. */
export function audienceDiscoveryMission({
  targetCustomerLabel, offerLabel, routeId, quantities,
}) {
  if (!quantities || !Number.isInteger(quantities.requiredCount) || quantities.requiredCount <= 0) {
    throw new RangeError('audienceDiscoveryMission requires resolved mission quantities; the list size must come from the founder, not from this template');
  }
  const { screenCount, requiredCount, contactCount } = quantities;
  const targets = lowerFirst(cleanPhrase(targetCustomerLabel, 'the people you are building for'));
  const offer = lowerFirst(cleanPhrase(offerLabel, 'what you are building'));
  const titleLead = 'Find the places ';
  const titleTargets = boundedPhrase(targets, TITLE_BYTE_BUDGET - byteLength(titleLead) - byteLength(' already gather'));

  return {
    status: 'selected',
    missionLevel: 'prerequisite',
    routeId,
    unlocksRouteIds: ['founder_customer_interview_set'],
    missingPrerequisite: 'customerEntities',
    title: `${titleLead}${titleTargets} already gather`,
    missionStatement: `Find ${requiredCount} real communities where ${boundedPhrase(targets, PHRASE_BYTE_BUDGET)} already spend time. For each, record its name, a link, how active it is in the last week, and its rule on self-promotion. Pick the ${contactCount} most alive to take part in first.`,
    completionDefinition: `A list of ${requiredCount} named communities, each with a link, an activity check and its promotion rule, and ${contactCount} chosen to join first.`,
    requiredEvidence: [
      `${requiredCount} named communities, each with a working link`,
      'evidence each one is active: a post or comment from the last 7 days',
      'the self-promotion rule for each, in its own words',
      `${contactCount} chosen to take part in first`,
      'the one thing you would post in each that is not an advert',
    ],
    expectedBusinessOutcome: 'You gain a real, checked list of places your audience already gathers, so the next step is talking to people who exist rather than guessing where they are.',
    confidence: 'medium',
    whyNow: `Based on what you told VISION, ${boundedPhrase(offer, 90)} is for individual people, not businesses -- so there is no directory to look them up in. The places they already gather are the closest thing that can be listed and checked, and having that list is what makes every later conversation possible.`,
    selectionExplanation: 'Customer/problem validation is the assessed bottleneck, and this venture sells to individuals. A business prospect list cannot be built for that audience, so the smallest safe next action is finding the real places those people already are.',
    requiredResources: [],
    missingResources: [],
    timeEstimate: 60,
    effortLevel: 'moderate',
    deadline: null,
    rejectedAlternativeSummaries: [],
    persistedTaskId: null,
    steps: [
      { order: 1, label: `Search for where ${boundedPhrase(targets, 55)} gather: forums, group chats, subreddits, review threads. Aim for ${screenCount}.`.slice(0, 200), actionType: 'identify_prospects', referenceId: null },
      { order: 2, label: 'Open each one and look at the last 7 days. Note the newest post date and roughly how many people are talking, not the member count.'.slice(0, 200), actionType: 'record_prospect_source', referenceId: null },
      { order: 3, label: `Cut anything with nothing posted this week, and read each survivor's rules on self-promotion. Keep the best ${requiredCount}.`.slice(0, 200), actionType: 'record_prospect_source', referenceId: null },
      { order: 4, label: `Pick the ${contactCount} most active. For each, write the one thing you could post that would be useful even if you were selling nothing.`.slice(0, 200), actionType: 'prioritise_prospects', referenceId: null },
      { order: 5, label: 'Record the list: name, link, newest post date, promotion rule, and your opening post for the top few.'.slice(0, 200), actionType: 'record_prospect_list', referenceId: null },
    ],
    professionalStandard: [
      'A community only counts if you saw someone post in it this week -- member counts are vanity and dead groups look identical to alive ones until you check',
      'Read the self-promotion rule before you plan anything. Being removed from the right room is worse than never joining it',
      'The thing you post first has to be worth reading on its own. Earn the right to mention what you are building',
      `The ${contactCount} you prioritise are chosen on how alive they are, not on how big they look`,
    ],
    learningSupport: null,
    evidenceBatchReference: null,
  };
}

/**
 * @param {object} params
 * @param {string} params.routeId The route this prerequisite unlocks.
 * @returns {object} A TodaysMove-shaped mission, missionLevel: 'prerequisite'.
 */
export function retentionInvestigationMission({ routeId }) {
  return {
    status: 'selected',
    missionLevel: 'prerequisite',
    routeId,
    unlocksRouteIds: ['founder_retention_analysis'],
    missingPrerequisite: 'cohortData',
    title: 'Identify why your most recent customers stopped using the product',
    missionStatement: 'List your 3-5 most recently churned or inactive customers. For each, record when they joined, when they went inactive, and any known reason (support message, feedback, cancellation note). Look for one pattern that repeats across them.',
    completionDefinition: 'A written list of 3-5 recently churned customers with join/inactive dates and any known reason, plus one identified repeated pattern if a real one exists.',
    requiredEvidence: [
      '3-5 identified churned or inactive customers',
      'join and inactive dates for each',
      'any known reason for leaving, where available',
      'one identified repeated pattern, only if genuinely supported',
    ],
    expectedBusinessOutcome: 'A concrete, evidence-based understanding of why customers are leaving, instead of an assumption about churn.',
    confidence: 'medium',
    whyNow: 'Based on what you told VISION, you have real paying customers but retention is a concern -- understanding why specific customers left is the smallest safe action before deciding what to change.',
    selectionExplanation: 'Retention is the assessed bottleneck and real customers exist, but no analytics/cohort tooling is connected yet -- a manual review of recently churned customers is the smallest safe next action.',
    requiredResources: [],
    missingResources: [],
    timeEstimate: 45,
    effortLevel: 'moderate',
    deadline: null,
    rejectedAlternativeSummaries: [],
    persistedTaskId: null,
    steps: [
      { order: 1, label: 'List your 3-5 most recently churned or inactive customers', actionType: 'inspect_retention_cohort_evidence', referenceId: null },
      { order: 2, label: 'Record when each joined and when each went inactive', actionType: 'inspect_retention_cohort_evidence', referenceId: null },
      { order: 3, label: 'Record any known reason for each, from their own words where you have them', actionType: 'identify_material_drop_off', referenceId: null },
      { order: 4, label: 'Write down one pattern that repeats across them, only if a real one exists', actionType: 'select_intervention', referenceId: null },
    ],
    professionalStandard: [
      'Only customers who genuinely churned or went inactive are listed',
      'A reason is recorded only where real evidence for it exists',
      'A pattern is claimed only when two or more customers actually share it',
    ],
    learningSupport: null,
  };
}

/**
 * Sourcing prerequisite for a physical/ecommerce product that is defined
 * but has no supplier or manufacturer identified yet. The 7 canonical
 * Founder routes have no direct representation for "find a supplier" (it
 * is neither customer validation, offer testing, nor generic product
 * delivery) -- this is deliberately NOT an 8th primary route, just the
 * closest responsible prerequisite: it blocks both product delivery and
 * offer testing until real sourcing options exist. Exactly like
 * prospectDiscoveryMission, this is never automated supplier intelligence
 * -- the founder researches and selects real suppliers themselves; VISION
 * only defines the mission and the evidence bar.
 *
 * @param {object} params
 * @param {string|null} params.productLabel Real, self-reported product/idea description. Never a made-up product.
 * @param {string} params.routeId The route this prerequisite unlocks.
 * @returns {object} A TodaysMove-shaped mission, missionLevel: 'prerequisite'.
 */
export function supplierShortlistMission({ productLabel, routeId }) {
  const product = lowerFirst(cleanPhrase(productLabel, 'your first product'));
  const supplierTitleLead = 'Build a shortlist of 5 viable suppliers for ';
  const titleProduct = boundedPhrase(product, TITLE_BYTE_BUDGET - byteLength(supplierTitleLead));
  return {
    status: 'selected',
    missionLevel: 'prerequisite',
    routeId,
    unlocksRouteIds: ['founder_product_delivery_slice', 'founder_offer_test'],
    missingPrerequisite: 'supplierRecord',
    title: `${supplierTitleLead}${titleProduct}`,
    missionStatement: `Identify five suppliers capable of producing ${boundedPhrase(product, PHRASE_BYTE_BUDGET)}. Record minimum order quantity, indicative pricing where public or provided, sample availability, production location, estimated lead time and contact method. Select the strongest two for sample enquiries.`,
    completionDefinition: 'A five-supplier comparison with two prioritised candidates and clear reasons for the ranking.',
    requiredEvidence: [
      'five real supplier names',
      'a public source link for each',
      'available MOQ information',
      'available lead-time information',
      'sample availability',
      'two prioritised suppliers',
      'an evidence-based reason for each priority',
    ],
    expectedBusinessOutcome: 'You can test product feasibility and begin sample discussions without pretending a supplier relationship already exists.',
    confidence: 'medium',
    whyNow: `Based on what you told VISION, ${boundedPhrase(product, PHRASE_BYTE_BUDGET)} is defined but no supplier or manufacturer has been identified yet -- a real sourcing option is required before product delivery or offer testing can safely proceed.`,
    selectionExplanation: 'No supplier or manufacturer exists yet for the chosen product, which blocks both product delivery and offer testing -- building a real, evidence-based supplier shortlist is the smallest safe next action. You research and select the suppliers yourself; VISION never invents a supplier name, price, or availability.',
    requiredResources: [],
    missingResources: [],
    timeEstimate: 60,
    effortLevel: 'moderate',
    deadline: null,
    rejectedAlternativeSummaries: [],
    persistedTaskId: null,
    steps: [
      { order: 1, label: `Identify five suppliers capable of producing ${boundedPhrase(product, 120)}`.slice(0, 200), actionType: 'identify_prospects', referenceId: null },
      { order: 2, label: 'Record MOQ, indicative pricing, sample availability, location and lead time for each', actionType: 'record_prospect_source', referenceId: null },
      { order: 3, label: 'Select the strongest two and write why', actionType: 'prioritise_prospects', referenceId: null },
      { order: 4, label: 'Record the finished comparison', actionType: 'record_prospect_list', referenceId: null },
    ],
    professionalStandard: [
      'Every supplier is real and reachable, with a public source recorded',
      'Figures are recorded only where the supplier actually publishes or provides them',
      'The two priorities are justified on the recorded evidence',
    ],
    learningSupport: null,
  };
}

/**
 * @param {object} params
 * @param {string} params.routeId The route this prerequisite unlocks.
 * @returns {object} A TodaysMove-shaped mission, missionLevel: 'prerequisite'.
 */
export function offerDefinitionMission({ routeId }) {
  return {
    status: 'selected',
    missionLevel: 'prerequisite',
    routeId,
    unlocksRouteIds: ['founder_offer_test', 'founder_sales_outreach_block'],
    missingPrerequisite: 'offerPricing',
    title: 'Define the smallest testable version of your offer',
    missionStatement: 'Write down exactly what you would offer a first customer today: what you deliver, at what price or pricing approach, and what makes it easy to say yes to. Keep it small enough to test with your first few prospects.',
    completionDefinition: 'A single written offer statement: what is delivered, the price or pricing approach, and the timeframe.',
    requiredEvidence: [
      'a written description of what is delivered',
      'a stated price or pricing approach',
      'confirmation this offer is realistic to deliver now',
    ],
    expectedBusinessOutcome: 'A concrete, testable offer that can be presented to real prospects instead of a vague service description.',
    confidence: 'medium',
    whyNow: 'Based on what you told VISION, no clear price or offer exists yet, and testing or contacting prospects responsibly needs one first.',
    selectionExplanation: 'Prospects are confirmed, but no offer or price exists to test or present -- defining one is the smallest safe next action.',
    requiredResources: [],
    missingResources: [],
    timeEstimate: 30,
    effortLevel: 'light',
    deadline: null,
    rejectedAlternativeSummaries: [],
    persistedTaskId: null,
    steps: [
      { order: 1, label: 'Write down exactly what a first customer receives', actionType: 'confirm_offer_and_segment', referenceId: null },
      { order: 2, label: 'Write down the price, or the pricing approach if you charge per job', actionType: 'confirm_offer_and_segment', referenceId: null },
      { order: 3, label: 'Write down the timeframe you can genuinely deliver it in', actionType: 'confirm_offer_and_segment', referenceId: null },
      { order: 4, label: 'Record the finished offer as one short statement', actionType: 'record_offer_test_result', referenceId: null },
    ],
    professionalStandard: [
      'The price is a real number or a real pricing rule, never "it depends"',
      'What is delivered is specific enough that two people would picture the same thing',
      'The timeframe is one you can meet today, not one you hope to meet later',
    ],
    learningSupport: null,
  };
}

/* Unfinished work is recorded as a description of what is NOT done ("not built
   the agency website"), so pasting it after an imperative lead produces
   "Finish and deliver: not built the agency website". These patterns turn the
   common negation phrasings back into the action they describe. Anything that
   does not match confidently keeps the founder's own sentence after a neutral
   lead -- an awkward-but-accurate title beats a confidently rewritten wrong one. */
const NEGATED_WORK_RE = /^(?:i\s+|we\s+)?(?:have\s+not|haven'?t|has\s+not|hasn'?t|had\s+not|did\s+not|didn'?t|not|never)\s+(?:yet\s+)?(built|created|made|set\s?up|finished|launched|written|wrote|designed|published|shipped|sent|started)\s+(.+)$/i;
const IMPERATIVE_BY_PARTICIPLE = Object.freeze({
  built: 'Build', created: 'Create', made: 'Make', setup: 'Set up', 'set up': 'Set up',
  finished: 'Finish', launched: 'Launch', designed: 'Design',
  published: 'Publish', shipped: 'Ship', sent: 'Send', started: 'Start',
  written: 'Write', wrote: 'Write',
});

/** @returns {{imperative: string|null, subject: string}} */
function readWorkItem(item) {
  const text = cleanPhrase(item, '');
  const match = NEGATED_WORK_RE.exec(text);
  if (!match) return { imperative: null, subject: text };
  const verb = IMPERATIVE_BY_PARTICIPLE[match[1].toLowerCase().replace(/\s+/g, ' ')]
    ?? IMPERATIVE_BY_PARTICIPLE[match[1].toLowerCase().replace(/\s+/g, '')];
  if (!verb) return { imperative: null, subject: text };
  /* "not built X yet" leaves a trailing "yet" that reads as unfinished text
     once the sentence is flipped into an imperative. */
  return { imperative: verb, subject: cleanPhrase(match[2].replace(/\s+yet\b\.?\s*$/i, ''), text) };
}

/**
 * Delivery prerequisite for a founder whose assessed constraint is
 * product/delivery but who has no engineering route available.
 *
 * founder_product_delivery_slice requires repository_access/build_environment,
 * which an agency, a consultancy or any non-technical founder will never have.
 * Without this template the delivery category won the ranking, its only route
 * was 'blocked', and the founder was asked "What is blocking progress on
 * product/delivery right now?" -- a question their own recorded answer had
 * already answered, and which no answer could unblock. Two archetypes
 * dead-ended there.
 *
 * The work is the founder's own recorded words; nothing here decides WHAT
 * they should build, only that one named outstanding item gets finished and
 * evidenced.
 *
 * @param {object} params
 * @param {string} params.workItem The founder's own delivery-shaped unfinished-work sentence.
 * @param {string} params.routeId The route this prerequisite unlocks.
 * @returns {object} A TodaysMove-shaped mission, missionLevel: 'prerequisite'.
 */
export function deliveryCommitmentMission({ workItem, routeId }) {
  const { imperative, subject } = readWorkItem(workItem);
  const lead = imperative ? `${imperative} ` : 'Finish and deliver: ';
  const title = `${lead}${boundedPhrase(imperative ? lowerFirst(subject) : subject, TITLE_BYTE_BUDGET - byteLength(lead))}`;
  const quoted = boundedPhrase(subject, PHRASE_BYTE_BUDGET);
  return {
    status: 'selected',
    missionLevel: 'prerequisite',
    routeId,
    unlocksRouteIds: ['founder_product_delivery_slice'],
    missingPrerequisite: 'buildEnvironment',
    title,
    missionStatement: `You recorded this as still outstanding: ${quoted}. Cut it down to the smallest version you can genuinely finish and put in front of a customer in one sitting, finish that version today, and write down what is now done and what deliberately is not.`,
    completionDefinition: 'One named outstanding item is finished to a usable standard, with a written note of what is done and what was deliberately left out.',
    requiredEvidence: [
      'the finished item itself, or a link or screenshot of it',
      'a written note of what is now done',
      'a written note of what was deliberately left out of this version',
    ],
    expectedBusinessOutcome: 'The work you named as outstanding is actually finished and usable, instead of staying on the list another week.',
    confidence: 'medium',
    whyNow: 'Based on what you told VISION, this is the work you said is still not done, and it is holding up everything that depends on it. Finishing one small version of it today is worth more than planning around it again.',
    /* Deliberately says why the ordinary product route is unavailable, so this
       never reads as VISION ignoring the engineering path. */
    selectionExplanation: 'Product/delivery is the assessed constraint, but the standard delivery route needs a code repository and build environment that this venture has not connected -- so the smallest safe next action is to finish one named outstanding item by hand and evidence it.',
    requiredResources: [],
    missingResources: [],
    timeEstimate: 60,
    effortLevel: 'moderate',
    deadline: null,
    rejectedAlternativeSummaries: [],
    persistedTaskId: null,
    steps: [
      { order: 1, label: `Cut down to the smallest usable version of: ${quoted}`.slice(0, 200), actionType: 'identify_product_slice', referenceId: null },
      { order: 2, label: 'Finish that version today', actionType: 'complete_delivery_implementation', referenceId: null },
      { order: 3, label: 'Check it is genuinely usable by someone other than you', actionType: 'verify_acceptance_criteria', referenceId: null },
      { order: 4, label: 'Record what is now done and what you deliberately left out', actionType: 'record_delivery_result', referenceId: null },
    ],
    professionalStandard: [
      'The version you finish is usable on its own, not a partial draft',
      'What was left out is written down deliberately, not quietly dropped',
      'Done means a customer could actually use it, not that it is nearly there',
    ],
    learningSupport: null,
  };
}
