/**
 * Derived Founder Stage — what currently EXISTS in the venture.
 *
 * The first locked step of the Founder OS after Venture State. Stage is a
 * derived fact, never a stored one: it is recomputed from the current snapshot
 * on every call and there is deliberately no setter, no fact key and no column.
 * That is a direct response to `businessModelFamily`, which IS a stored field
 * nothing keeps up to date -- it was null in 24 of 24 real ventures tested.
 *
 * STAGE IS NOT A BOTTLENECK. Stage says what exists; the bottleneck says what
 * is in the way. Stage's only job in this milestone is to say which bottlenecks
 * are BELIEVABLE for a venture in this condition -- it never scores, never
 * ranks and never selects. A venture with nothing built cannot have a delivery
 * constraint; a venture whose product is half-finished cannot validate demand
 * through it. Those are statements about reality, not judgements about priority.
 *
 * DELIBERATELY SEPARATE FROM `FOUNDER_STAGES`. That enum
 * (founder-venture-state/contract.js) is the DECLARED stage vocabulary --
 * a fact the founder could state directly. It has never been populated by
 * anything. This module neither reads nor writes it; the two vocabularies are
 * kept apart so a future declared stage can be compared against derived stage
 * rather than silently overwriting it.
 *
 * NOTHING IS FABRICATED. Every signal below comes from a fact the founder
 * recorded or a resource they declared. Absence of evidence produces 'idea' at
 * LOW confidence, never an invented product state.
 */

import * as signals from '../founder-bottleneck/signals.js';

export const FOUNDER_DERIVED_STAGE_VERSION = 1;

/**
 * Ordered most-advanced first. The ladder is evaluated top-down and the first
 * stage whose evidence rule is satisfied wins, so a venture that genuinely
 * satisfies several (a launched product that is also acquiring) resolves to the
 * one describing its CURRENT work, which is what "most relevant to the active
 * outcome" means in practice.
 */
export const FOUNDER_DERIVED_STAGES = Object.freeze([
  'scaling', 'retaining', 'delivering', 'acquiring', 'launched',
  'testing', 'building', 'prototype', 'validation', 'idea',
]);

export const FOUNDER_DERIVED_STAGE_CONFIDENCE = Object.freeze(['high', 'medium', 'low']);

/* ── Text evidence ─────────────────────────────────────────────────────────
   Scanned across completedWork and unfinishedWork, never a single required
   phrase. Each pattern names a class of observable state, not one wording. */

/** Something real exists and can be run or looked at.
    Deliberately excludes set-up verbs (set up / installed / configured) and
    design artefacts (designed / wireframes). A Shopify store with a theme
    installed and no product chosen matched "set up" and derived as 'building',
    which then suppressed the customer-validation constraint that IS that
    founder's real problem. Preparing a container is not having a product. */
const BUILT_ARTIFACT_RE = /\b(?:built|build(?:ing)?|prototype|mvp|working version|playable|deployed|deploy(?:ed|ment)?|live|shipped|launched|published|running|functioning|implemented|coded|developed|site is up|website is (?:live|up))\b/i;

/** Publicly or operationally available to real users. */
const LAUNCHED_RE = /\b(?:launched|in production|production|publicly available|public launch|app ?store|play ?store|steam|went live|is live|now live|open(?:ed)? (?:to|for) (?:the )?public|available to (?:buy|download|customers|users)|storefront (?:is )?open|trading|open two years|open for \w+ years)\b/i;

/** Not yet ready for normal users -- the prototype qualifier. */
const EARLY_STAGE_QUALIFIER_RE = /\b(?:prototype|mvp|early|rough|proof of concept|poc|vertical slice|not polished|unpolished|alpha|pre-?alpha|sketch(?:ed|es)?|paper|concept|internal only|not ready)\b/i;

/** The current work is verification rather than construction. */
const TESTING_WORK_RE = /\b(?:qa|test(?:ing|ers?|ed)?|playtest(?:ing|ers?)?|beta|acceptance (?:test|criteria)|verify|verification|validate the build|bug ?fix(?:ing|es)?|regression|user testing|usability)\b/i;

/** A real commitment from a real customer that must now be fulfilled.
    Names the ACT of accepting a specific piece of work, never the existence of
    a customer relationship: "retainer client" matched here and derived a
    consultant with one long-standing client and no pipeline as 'delivering',
    which suppressed the acquisition constraint that was actually their whole
    problem. Having a client is customer evidence; accepting a job is a
    commitment. */
const ACCEPTED_COMMITMENT_RE = /\b(?:client (?:accepted|approved|signed|agreed)|accepted and paid|paid a deposit|deposit (?:paid|received)|signed (?:off|the contract|a contract)|contract signed|order (?:placed|received|confirmed)|commissioned|booked (?:the|a) (?:project|job)|requirements (?:collected|agreed)|scope agreed)\b/i;

/** Continued usage is the issue. */
const RETENTION_WORK_RE = /\b(?:churn(?:ing|ed)?|retention|cancel(?:l?ed|l?ing|s|lations?)?|stopped using|drop[- ]?off|not coming back|unsubscrib|repeat (?:purchase|rate|buyers?)|renew(?:al|als|ing)?|lapsed|win ?back|reactivat)\b/i;

/** Capacity, efficiency or expansion is the issue. */
const SCALING_WORK_RE = /\b(?:scal(?:e|ing)|capacity|at capacity|hire|hiring|recruit(?:ing)? staff|delegate|bottlenecked on (?:me|time)|too much work|cannot keep up|can'?t keep up|expand(?:ing|sion)?|second location|more (?:staff|team)|systemi[sz]e|outsourc)\b/i;

/** Nothing has been made; the work so far is thinking, not building. */
const IDEA_ONLY_RE = /\b(?:nothing (?:built|made|yet)|just an idea|only an idea|idea only|not started|haven'?t started|no code|researched|research(?:ing)?|sketch(?:ed|es)?|on paper|positioning|domain (?:bought|registered)|thinking about)\b/i;

/* A clause that DENIES something must never be read as evidence FOR it.
   "Nothing built yet", "No code written", "not started" all contain the very
   words that describe a real product, and scanning whole answers read them as
   proof a product existed -- an idea-stage founder was derived as 'building'
   off the word inside their own denial. Negation is judged per clause so one
   denial cannot erase a genuine claim sitting beside it ("Early playable
   prototype with core combat. Not polished." claims one and denies the other). */
const NEGATION_RE = /\b(?:no|not|nothing|none|never|without|zero|haven'?t|hasn'?t|hadn'?t|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|yet\s+to|still\s+to)\b/i;

function clausesOf(items) {
  return (Array.isArray(items) ? items : [])
    .filter((entry) => typeof entry === 'string')
    .flatMap((entry) => entry.split(/[.;,•]/))
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** Clauses that ASSERT something, with denials removed. */
function assertedText(items) {
  return clausesOf(items).filter((clause) => !NEGATION_RE.test(clause)).join(' • ');
}

function textOf(items) {
  return (Array.isArray(items) ? items : []).filter((entry) => typeof entry === 'string').join(' • ');
}

function firstMatch(re, haystack) {
  const found = re.exec(haystack);
  return found ? found[0] : null;
}

/**
 * Derives the venture's current stage from what the founder has actually
 * recorded.
 *
 * @param {object} params
 * @param {object} params.snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @param {object} [params.entityBundle] Trusted buildFounderExecutionEntities(...) output.
 * @param {string} params.evaluationTime ISO timestamp; stamped as derivedAt so a caller can prove when this was computed.
 * @returns {{value: string, confidence: 'high'|'medium'|'low', evidenceReferences: string[], reason: string, derivedAt: string, version: number}}
 */
export function deriveFounderStage({ snapshot, entityBundle = null, evaluationTime }) {
  const evidence = [];
  const note = (field, detail) => {
    const factId = snapshot?.[field]?.sourceFactId;
    evidence.push(`${field}: ${detail}${factId ? ` (${factId})` : ''}`);
  };

  const completed = signals.completedWorkItems(snapshot);
  const unfinished = signals.unfinishedWorkItems(snapshot);
  /* Claims of what EXISTS are read only from clauses that assert. Statements
     of what is WRONG or OUTSTANDING keep their full text, because a denial is
     exactly the signal there ("churn is high", "webhook fails"). */
  const completedText = assertedText(completed);
  const assertedWorkText = `${completedText} • ${assertedText(unfinished)}`;
  const unfinishedText = textOf(unfinished);
  const allWorkText = `${textOf(completed)} • ${unfinishedText}`;
  const { salesShaped, deliveryShaped } = signals.unfinishedWorkSplitByFunction(snapshot);

  const declared = new Set(signals.declaredResourceIds(snapshot));
  const hasRepo = declared.has('repository_access');
  const hasBuildEnv = declared.has('build_environment') || declared.has('test_environment');
  const hasDeployAccess = declared.has('delivery_access');
  if (declared.size > 0) note('resources', `declared ${[...declared].sort().join(', ')}`);

  /* Integrations are read WHERE AVAILABLE, exactly as the milestone allows.
     Nothing populates them today (the collectors exist with no producer), so
     this is future-proofing that costs nothing and fabricates nothing. */
  const integrations = snapshot?.integrations || {};
  const integrationConnected = (provider) => integrations?.[provider]?.status === 'known'
    && integrations[provider]?.value?.connected === true;
  const repoConnected = integrationConnected('github');
  const deployConnected = integrationConnected('vercel');
  const siteConnected = integrationConnected('website');
  if (repoConnected || deployConnected || siteConnected) {
    note('integrations', `connected: ${['github', 'vercel', 'website'].filter(integrationConnected).join(', ')}`);
  }

  const hasPayingCustomers = signals.hasPayingCustomers(snapshot) || signals.customerCount(snapshot) > 0;
  const hasRevenue = signals.hasRealRevenue(snapshot);
  const usableProspects = entityBundle ? signals.usableCustomerEntities(entityBundle).length : 0;
  const offerKnown = signals.offerKnown(snapshot);

  const builtPhrase = firstMatch(BUILT_ARTIFACT_RE, completedText);
  /* COMPLETED work only. Being available is something that has happened, so it
     can only be evidenced by what is done -- scanning outstanding work read
     "a Steam page and a launch plan" (a to-do list) as proof the game had
     already launched, and an unplayable prototype derived as 'launched'. */
  const launchedPhrase = firstMatch(LAUNCHED_RE, completedText);
  const earlyPhrase = firstMatch(EARLY_STAGE_QUALIFIER_RE, allWorkText);
  const testingPhrase = firstMatch(TESTING_WORK_RE, unfinishedText);
  const commitmentPhrase = firstMatch(ACCEPTED_COMMITMENT_RE, allWorkText);
  const retentionPhrase = firstMatch(RETENTION_WORK_RE, allWorkText);
  const scalingPhrase = firstMatch(SCALING_WORK_RE, allWorkText);
  const ideaOnlyPhrase = firstMatch(IDEA_ONLY_RE, completedText);

  /* A product exists if the founder DESCRIBED one, or declared the
     infrastructure that only a real one needs. Two independent routes to the
     same conclusion, so neither a quiet phrasing nor an unmentioned repo alone
     decides it. */
  const infrastructureImpliesProduct = hasRepo && (hasBuildEnv || hasDeployAccess);
  const productExists = Boolean(builtPhrase) || infrastructureImpliesProduct || repoConnected;
  if (builtPhrase) note('completedWork', `describes real built work ("${builtPhrase}")`);
  if (infrastructureImpliesProduct) note('resources', 'declared a repository plus a build or deployment environment');

  const decide = (value, confidence, reason) => ({
    value, confidence, evidenceReferences: evidence.slice(), reason, derivedAt: evaluationTime, version: FOUNDER_DERIVED_STAGE_VERSION,
  });

  // ── The ladder, most advanced first ────────────────────────────────────

  /* 10. SCALING — a repeatable motion exists and capacity is the limit. */
  if (scalingPhrase && (hasPayingCustomers || hasRevenue) && productExists) {
    note('unfinishedWork', `capacity/expansion is the stated constraint ("${scalingPhrase}")`);
    return decide('scaling', 'medium', `Real customers and a working offer exist, and the recorded constraint is capacity or expansion ("${scalingPhrase}") rather than finding or serving customers.`);
  }

  /* 9. RETAINING — real users exist and keeping them is the issue. */
  if (retentionPhrase && (hasPayingCustomers || hasRevenue)) {
    note('unfinishedWork', `continued usage is the stated issue ("${retentionPhrase}")`);
    return decide('retaining', hasPayingCustomers && hasRevenue ? 'high' : 'medium', `Customers already exist and pay, and the recorded issue is whether they stay ("${retentionPhrase}").`);
  }

  /* 8. DELIVERING — an accepted commitment exists and fulfilling it is the work. */
  const convertedEntities = entityBundle ? signals.payingOrConvertedCustomerEntities(entityBundle).length : 0;
  if ((commitmentPhrase || convertedEntities > 0) && deliveryShaped.length > 0) {
    note('completedWork', commitmentPhrase ? `an accepted commitment is on record ("${commitmentPhrase}")` : `${convertedEntities} converted customer entity(s) on record`);
    note('unfinishedWork', `${deliveryShaped.length} outstanding fulfilment item(s)`);
    return decide('delivering', 'high', `A real customer commitment has been accepted and ${deliveryShaped.length} piece(s) of the work to fulfil it are still outstanding.`);
  }

  /* 7. ACQUIRING — the offer is usable, nothing is outstanding on the product
     itself, and reaching customers is the constraint. Ranked ABOVE 'launched'
     because being available is a fact about the product while acquiring is a
     fact about the current work, and the ladder resolves to whichever describes
     what the founder is actually doing. Requires zero outstanding product work,
     so a half-built product never reads as an acquisition problem. */
  const acquisitionIsTheWork = salesShaped.length > 0
    || (usableProspects === 0 && !hasPayingCustomers);
  if (offerKnown && deliveryShaped.length === 0 && acquisitionIsTheWork) {
    note('offer', 'a real offer is on record with no outstanding product work');
    if (salesShaped.length > 0) note('unfinishedWork', `acquisition work is outstanding ("${salesShaped[0].slice(0, 60)}")`);
    return decide('acquiring', salesShaped.length > 0 ? 'medium' : 'low', 'A usable offer exists, nothing is outstanding on the product, and the recorded constraint is reaching customers.');
  }

  /* 6. LAUNCHED — available, with no more specific current work identified. */
  if (launchedPhrase && productExists) {
    note('completedWork', `publicly or operationally available ("${launchedPhrase}")`);
    return decide('launched', 'medium', `The product or service is recorded as available ("${launchedPhrase}") with no outstanding build or acquisition work.`);
  }

  /* 5. TESTING — a usable build exists and the current work is verification.
     The !earlyPhrase guard keeps a rough prototype awaiting playtesting at
     'prototype': it is not ready for normal users, so verification of it is
     not the same activity as QA on a finished build. */
  if (productExists && testingPhrase && !earlyPhrase) {
    note('unfinishedWork', `current work is verification ("${testingPhrase}")`);
    return decide('testing', 'medium', `A usable build exists and the outstanding work is verification rather than construction ("${testingPhrase}").`);
  }

  /* 4. PROTOTYPE — something testable exists but is not ready for real users.
     Ranked ABOVE 'building' because "not ready for normal users" is the more
     specific claim: a rough prototype almost always has outstanding work too,
     so checking building first would swallow every prototype. */
  if (productExists && earlyPhrase) {
    note('completedWork', `an early, not-yet-ready version exists ("${earlyPhrase}")`);
    return decide('prototype', 'medium', `An early usable version exists ("${earlyPhrase}") and nothing indicates it is ready for normal users.`);
  }

  /* 3. BUILDING — real product work exists with a bounded piece unfinished.
     A deployed product with a named broken component is still building, and
     telling that founder to go find customers is the defect this milestone
     exists to fix. */
  if (productExists && deliveryShaped.length > 0) {
    note('unfinishedWork', `${deliveryShaped.length} bounded piece(s) of product/delivery work outstanding`);
    const confidence = infrastructureImpliesProduct && builtPhrase ? 'high' : 'medium';
    return decide('building', confidence, `Concrete product or delivery work exists and ${deliveryShaped.length} bounded piece(s) of it remain unfinished.`);
  }

  /* 2. VALIDATION — actively testing the problem, customer or offer, with
     nothing usable built yet. */
  if (!productExists && (offerKnown || signals.hasAnyCustomerEvidence(snapshot) || usableProspects > 0)) {
    note('offer', offerKnown ? 'an offer is described but nothing usable is built' : 'customer evidence is being gathered with nothing built');
    return decide('validation', 'medium', 'The problem, customer or offer is being tested and no usable product or accepted delivery exists yet.');
  }

  /* 1. IDEA — the floor. Reached by ABSENCE of evidence, so it is always
     reported at low confidence: "we found nothing" is not the same as "we
     verified there is nothing". */
  if (ideaOnlyPhrase) note('completedWork', `describes thinking rather than building ("${ideaOnlyPhrase}")`);
  else note('completedWork', 'no credible prototype, product, delivery or launch evidence found');
  return decide('idea', 'low', 'No credible prototype, product, delivery or launch evidence is on record.');
}
