/**
 * Founder Venture Router — is this founder's target customer something VISION
 * can actually enumerate?
 *
 * WHY THIS EXISTS. There is exactly ONE prospect-discovery mission template,
 * and it contains 27 assumption-bearing strings about enumerable trading
 * businesses: "business name", "location", "contact method", "still trading",
 * "maps and directories", "a dead page", "no national chains". Nothing gated
 * it. A solo game developer whose target customer is "PC players who like
 * roguelike deckbuilders" was handed, fluently and confidently:
 *
 *   "Find 8 PC players ... Record each business name, location, public contact
 *    method, and one observable reason it may need a premium single-player PC
 *    game ... Aim for 16 clearly still trading."
 *
 * Every clause is false for that founder, and it reads exactly as authoritative
 * as a correct task. That is worse than an error: the engine's whole claim is
 * that it never asserts what the founder did not tell it.
 *
 * WHAT THIS DELIBERATELY IS NOT. It is not a business-model classifier. There
 * is already one (`classifyBusinessModelFamily`, whose output this passes
 * through verbatim), and a second parallel taxonomy would be two things to keep
 * in sync. It is also not what the gate needs: `local_physical_business` (a
 * café) sells to CONSUMERS while `agency_service_freelance` sells to
 * BUSINESSES, so the family genuinely does not determine whether the target is
 * enumerable. The one question that does is asked directly.
 *
 * PURITY. No Supabase, no HTTP, no environment, no frontend routes, no clock.
 * Input is the venture's own confirmed facts; output is a plain object.
 * `scripts/qa-founder-venture-router.mjs` asserts that.
 */

/** What the founder is trying to reach. */
export const TARGET_ENTITIES = Object.freeze(['business_or_organisation', 'individual_consumer', 'unknown']);
/** Which discovery surface, if any, can enumerate that target today. */
export const DISCOVERY_MODES = Object.freeze(['business_search', 'unsupported', 'unknown']);
/** Which mission shape the target admits. */
export const MISSION_PATTERNS = Object.freeze([
  'enumerable_business_prospects', 'unsupported_target', 'clarification_required',
]);
export const WORKSPACE_MODES = Object.freeze(['lead_intelligence', 'none']);
export const ROUTER_CONFIDENCE = Object.freeze(['high', 'medium', 'low']);

/* Terms that only make sense as an ORGANISATION being sold to. Kept to nouns a
   founder uses for the thing they would look up in a directory -- never verbs,
   never adjectives, and never words that merely co-occur with business ("my
   business" describes the founder, not their customer, which is why the
   possessive forms are excluded below). */
const BUSINESS_TARGET_RE = [
  /\bbusinesses?\b/i, /\bcompan(?:y|ies)\b/i, /\bfirms?\b/i, /\bagenc(?:y|ies)\b/i,
  /\bstartups?\b/i, /\bbrands?\b/i, /\bstores?\b/i, /\bshops?\b/i, /\bretailers?\b/i,
  /* A venue noun followed by "-goers" names the PEOPLE who visit it, not the
     venue: "gym goers" and "cafe goers" are consumers, while "gyms" and
     "cafes" are businesses you could look up. Without this, a bottle sold to
     "commuters and gym goers" read as targeting both. */
  /\brestaurants?\b(?!\s*-?\s*goers?)/i, /\bcaf(?:e|é)s?\b(?!\s*-?\s*goers?)/i,
  /\bsalons?\b/i, /\bclinics?\b/i, /\bgyms?\b(?!\s*-?\s*goers?)/i,
  /\bpractices?\b/i, /\boffices?\b/i, /\bpractitioners?\b/i, /\bcontractors?\b/i,
  /\btrad(?:e|ie)s(?:people|men)?\b/i, /\bplumbers?\b/i, /\belectricians?\b/i,
  /\bdentists?\b/i, /\baccountants?\b/i, /\bbookkeepers?\b/i, /\breal\s+estate\b/i,
  /* "owners" alone is a trap: "salon owners" is a business but "pet owners"
     and "homeowners" are consumers, and the bare word matched both. The
     specific business nouns above already catch "salon owners" via "salon",
     so only the explicitly business-qualified form is kept here. */
  /\bbusiness\s+owners?\b/i, /\bmanagers?\b/i, /\bteams?\b/i, /\borgani[sz]ations?\b/i,
  /\bschools?\b/i, /\bcharit(?:y|ies)\b/i, /\bnon[\s-]?profits?\b/i,
  /\bB2B\b/i, /\bSMBs?\b/i, /\bSMEs?\b/i, /\benterprises?\b/i, /\bsuppliers?\b/i,
  /\bwholesalers?\b/i, /\bdistributors?\b/i, /\bstudios?\b/i, /\bpracticing\b/i,
];

/* Terms that only make sense as an INDIVIDUAL PERSON being reached. These are
   the ones that must never reach a places provider. */
const CONSUMER_TARGET_RE = [
  /\bplayers?\b/i, /\bgamers?\b/i, /\bplaytesters?\b/i, /\bstreamers?\b/i,
  /\bviewers?\b/i, /\bsubscribers?\b/i, /\bfans?\b/i, /\blisteners?\b/i, /\breaders?\b/i,
  /\bshoppers?\b/i, /\bconsumers?\b/i, /\bhobb(?:y|yist)s?\b/i, /\benthusiasts?\b/i,
  /\bstudents?\b/i, /\bparents?\b/i, /\bmums?\b/i, /\bmoms?\b/i, /\bdads?\b/i,
  /\bteens?\b/i, /\bteenagers?\b/i, /\bkids?\b/i, /\bchildren\b/i, /\bathletes?\b/i,
  /\brunners?\b/i, /\blifters?\b/i, /\bbeginners?\b/i, /\bcommuters?\b/i,
  /\btravell?ers?\b/i, /\bhomeowners?\b/i, /\brenters?\b/i, /\bindividuals?\b/i,
  /\bB2C\b/i, /\bfollowers?\b/i, /\bcreators?\b/i, /\bcommunity\s+members?\b/i,
];

/* Words that genuinely point both ways and must never decide on their own.
   "users" can be seats at a company or people on a phone; "clients" can be
   retainer businesses or a coach's individuals; "customers" is the bare noun
   almost every founder uses regardless of shape. Listed only so the reason
   string can say the target was named but not resolved. */
const AMBIGUOUS_TARGET_RE = [
  /\busers?\b/i, /\bclients?\b/i, /\bcustomers?\b/i, /\bpeople\b/i, /\bmembers?\b/i,
  /\bprofessionals?\b/i, /\bpatients?\b/i, /\bbuyers?\b/i, /\bsubscribers?\b/i,
];

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function countMatches(patterns, haystack) {
  if (!haystack) return 0;
  let hits = 0;
  for (const re of patterns) if (re.test(haystack)) hits += 1;
  return hits;
}

/**
 * Routes a founder venture from its own confirmed facts.
 *
 * The target customer is weighted decisively over the offer and idea: a
 * founder describing "a premium PC game" has described their PRODUCT, and
 * products do not tell you whether the buyer is a person or a company. Only
 * the target-customer clause answers that, so a signal found solely in the
 * offer or idea can support a reading but never establish one alone.
 *
 * @param {object} params
 * @param {Record<string, {value: unknown}>} params.perKey The venture's fact map (rebuildStateFromFacts(...).perKey).
 * @returns {{businessModelFamily: string|null, stage: string|null, targetEntity: string,
 *   discoveryMode: string, missionPattern: string, workspaceMode: string,
 *   confidence: string, reason: string}}
 */
export function routeFounderVenture({ perKey } = {}) {
  const facts = perKey && typeof perKey === 'object' ? perKey : {};
  /* Passed through exactly as recorded, never re-derived here -- including
     null. This router adds a routing decision; it does not add a taxonomy. */
  const businessModelFamily = typeof facts.businessModelFamily?.value === 'string'
    ? facts.businessModelFamily.value : null;
  const stage = typeof facts.currentStage?.value === 'string' ? facts.currentStage.value : null;

  const targetCustomer = text(facts.targetCustomer?.value);
  const offer = text(facts.offer?.value);
  const idea = text(facts.idea?.value);

  const unresolved = (reason, confidence = 'low') => ({
    businessModelFamily,
    stage,
    targetEntity: 'unknown',
    discoveryMode: 'unknown',
    missionPattern: 'clarification_required',
    workspaceMode: 'none',
    confidence,
    reason,
  });

  if (!targetCustomer) {
    return unresolved('no target customer is recorded, so the kind of thing being reached is unknown');
  }

  const targetBusiness = countMatches(BUSINESS_TARGET_RE, targetCustomer);
  const targetConsumer = countMatches(CONSUMER_TARGET_RE, targetCustomer);
  /* Supporting evidence only. Never enough on its own -- see the doc comment. */
  const supportBusiness = countMatches(BUSINESS_TARGET_RE, `${offer} ${idea}`);
  const supportConsumer = countMatches(CONSUMER_TARGET_RE, `${offer} ${idea}`);

  if (targetBusiness > 0 && targetConsumer > 0) {
    /* Both readings are genuinely present ("shop owners and their customers").
       Forcing one to keep generation moving is exactly what this gate exists
       to stop. */
    return unresolved(
      `the target customer names both businesses and individual people, so it is not clear which VISION should go and find`,
    );
  }

  if (targetConsumer > 0) {
    return {
      businessModelFamily,
      stage,
      targetEntity: 'individual_consumer',
      discoveryMode: 'unsupported',
      missionPattern: 'unsupported_target',
      workspaceMode: 'none',
      confidence: supportConsumer > 0 ? 'high' : 'medium',
      reason: 'the target customer is individual people, not businesses that can be looked up in a directory',
    };
  }

  if (targetBusiness > 0) {
    return {
      businessModelFamily,
      stage,
      targetEntity: 'business_or_organisation',
      discoveryMode: 'business_search',
      missionPattern: 'enumerable_business_prospects',
      workspaceMode: 'lead_intelligence',
      /* The category input a business search needs IS the target-customer
         phrase, which is present by definition on this branch. Location is not
         required here: the founder supplies area/nationwide/online at search
         time, and interpretLocation refuses rather than guesses. */
      confidence: supportBusiness > 0 ? 'high' : 'medium',
      reason: 'the target customer is businesses or organisations, which can be enumerated by a business search',
    };
  }

  const ambiguous = countMatches(AMBIGUOUS_TARGET_RE, targetCustomer) > 0;
  return unresolved(
    ambiguous
      ? 'the target customer is named only in general terms, so whether it is businesses or individual people is unresolved'
      : 'the target customer does not clearly name businesses or individual people',
  );
}

/**
 * The founder-facing sentence for a target VISION understands but cannot yet
 * enumerate. Says what was understood before what is missing -- a founder who
 * has told VISION exactly who they sell to should not be told it does not
 * know.
 */
export function describeUnsupportedTarget(route, targetCustomerLabel) {
  /* The founder's own sentence usually ends in a full stop, and this quotes it
     mid-clause -- "...and Balatro., not local businesses" reads as a typo in a
     message whose whole job is to sound like it was understood. */
  const who = text(targetCustomerLabel).replace(/[.!?]+$/, '') || 'the people you described';
  if (route?.targetEntity === 'individual_consumer') {
    return `VISION understands that your customers are ${who}, not local businesses. Finding individual people is not a discovery route VISION supports yet, so it will not hand you a business prospect list that does not fit your venture.`;
  }
  return `VISION could not tell from "${who}" whether you are selling to businesses or to individual people, and it will not guess. Describe who buys in one sentence -- for example "independent cafes in Leeds" or "PC players who like roguelike deckbuilders".`;
}
