/**
 * Founder Intake — deterministic goal-statement/clarification-answer
 * extraction.
 *
 * Same spirit as founder-venture-state/collectors/chat.js (deterministic,
 * rule-based, never an LLM call, never a guess): a small, explicit set of
 * clear factual patterns, always emitted `analyst_chat` / `provisional` —
 * an inference, never disguised as a verified fact. The one exception is
 * `immediateGoal`, which is the user's own verbatim goal statement (not a
 * parsed inference) and is recorded `onboarding` / `user_confirmed`
 * immediately — see extractFounderIntakeFacts below.
 *
 * This is deliberately NOT a general-purpose NLP parser (task rule: "do
 * not pretend a fragile keyword parser fully understands arbitrary
 * businesses"). It only ever emits a field when a clear, literal pattern
 * matched; everything else is left absent so the real clarification engine
 * (founder-venture-state/clarification.js, unmodified) asks for it.
 */

import { buildFact } from '../founder-venture-state/fact-ledger.js';
import { HYPOTHETICAL_RE } from '../founder-venture-state/collectors/chat.js';
import { buildEntityFactKey } from '../founder-venture-state/entities.js';

export const MAX_INTAKE_TEXT_LENGTH = 500;

const NUMBER_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
});

const VAGUE_IDEA_STOPLIST = new Set([
  'a business', 'business', 'a company', 'company', 'something', 'a startup', 'startup',
  'a venture', 'venture', 'my own thing', 'my own business', 'my own company',
]);

// Loose business-shape vocabulary used only to decide whether an OWNERSHIP
// statement ("I have X" / "I run X") is plausibly describing the venture
// itself, as opposed to a customer-evidence or resource statement that
// happens to start with the same words ("I have no clients", "I have a
// lead list"). classifyBusinessModelFamily already recognises specific
// shapes (agency, app, clothing brand, ...); this is the broader fallback
// for a generic word like "startup"/"venture" that names no specific family.
const GENERIC_BUSINESS_NOUN_RE = /\b(business|company|agency|startup|venture|brand)\b/i;

function clean(text) {
  return typeof text === 'string' ? text.trim().slice(0, MAX_INTAKE_TEXT_LENGTH) : '';
}

function stripTrailingPunctuation(text) {
  return text.replace(/[.!?\s]+$/, '').trim();
}

// A trailing clause the founder tacked onto the SAME sentence as their
// venture description, but which describes something else entirely (no
// customers yet, a missing supplier) -- never part of the venture identity
// or target-customer text itself. Stripped before venture-clause splitting
// so e.g. "a website agency for cafés no clients yet" yields target
// customer "cafés", not "cafés no clients yet"; the trigger phrase itself
// is still independently picked up by extractCustomerEvidence/
// extractUnfinishedWork, which run over the ORIGINAL, unstripped text.
const TRAILING_QUALIFIER_CLAUSE_RE = /\s*(?:,|;|-|\.\.\.|\bbut\b|\band\b)?\s*\b(?:no\s+(?:clients?|customers?|users?|leads?|prospects?|supplier|manufacturer)|(?:have\s+not|haven'?t)\s+(?:found|chosen|picked|selected)?\s*(?:a\s+)?(?:supplier|manufacturer)|need(?:\s+to\s+find)?\s+a\s+(?:supplier|manufacturer))\b.*$/i;

function stripTrailingQualifierClause(text) {
  return text.replace(TRAILING_QUALIFIER_CLAUSE_RE, '').trim();
}

// GOAL_VERB_RE/OWNERSHIP_PATTERNS capture EVERYTHING after the matched verb
// via `(.+)$` -- for a single-sentence input that is exactly the venture
// description, but a real founder often adds a second sentence about
// something else entirely ("I want to launch a fitness clothing brand. I
// know what products I want to sell, but I have not found a supplier.").
// Without this, the venture idea/product label would swallow that whole
// second sentence verbatim, producing a garbled, cut-off mission title.
// Truncates at the first sentence-ending punctuation that is followed by
// more text -- never at a single trailing terminator, which just ends the
// one sentence normally.
function truncateAtSentenceBoundary(text) {
  const terminatorMatch = /[.!?]/.exec(text);
  if (!terminatorMatch) return text;
  const idx = terminatorMatch.index;
  const rest = text.slice(idx + 1).trim();
  return rest ? text.slice(0, idx + 1) : text;
}

// Order matters: more specific business shapes are checked before broader
// ones, so e.g. "coaching" is never misclassified as a generic agency, and
// "personal-brand" is never misclassified as generic ecommerce "brand".
// ecommerce_product is checked BEFORE local_physical_business specifically:
// a compound product noun like "gym clothes"/"gym wear" contains a
// physical-business word ("gym") describing the PRODUCT, not the venture --
// and unlike the selling/for/making connectors, there is no separator to
// split it out first, so the classifier itself must prefer the more
// specific product read here.
const BUSINESS_MODEL_PATTERNS = Object.freeze([
  { family: 'creator_led_business', re: /\b(personal[\s-]?brand|creator|content\s+business|influencer|paid\s+community|online\s+course)\b/i },
  { family: 'ecommerce_product', re: /\b(clothing|clothes|apparel|wear|brand|ecommerce|e-commerce|product\s+line|merchandise|store)\b/i },
  { family: 'local_physical_business', re: /\b(restaurant|takeaway|cafe|café|storefront|salon|clinic|gym)\b/i },
  { family: 'coaching_consulting', re: /\b(coach(?:ing)?|consult(?:ing|ant)?|mentor(?:ing)?)\b/i },
  { family: 'software_app', re: /\b(app|software|saas|platform|tool)\b/i },
  { family: 'agency_service_freelance', re: /\b(agency|freelance|service)\b/i },
]);

function classifyBusinessModelFamily(ideaText) {
  if (!ideaText) return null;
  for (const { family, re } of BUSINESS_MODEL_PATTERNS) {
    if (re.test(ideaText)) return family;
  }
  return null;
}

/**
 * Splits a raw "what are you building" clause into {ideaText, offerText,
 * targetCustomerText} using only two unambiguous connector shapes ("X
 * selling Y to Z" and "X for Z") -- anything else is left as one whole
 * idea phrase with no separately identified customer, never guessed.
 */
function splitVentureClause(remainder) {
  const sellingMatch = remainder.match(/^(.*?)\bselling\b\s+(.+?)\s+\bto\b\s+(.+)$/i);
  if (sellingMatch) {
    return {
      ideaText: stripTrailingPunctuation(remainder),
      // Classification must run on the VENTURE only ("marketing agency"),
      // never on the target-customer clause ("cafés in Dubbo") -- otherwise
      // a customer description like "cafés" or "gyms" can falsely classify
      // the venture itself as that kind of physical business.
      ventureOnlyText: stripTrailingPunctuation(sellingMatch[1]),
      offerText: stripTrailingPunctuation(sellingMatch[2]),
      targetCustomerText: stripTrailingPunctuation(sellingMatch[3]),
    };
  }
  const forMatch = remainder.match(/^(.*?)\s+\bfor\b\s+(.+)$/i);
  if (forMatch) {
    return {
      ideaText: stripTrailingPunctuation(forMatch[1]),
      ventureOnlyText: stripTrailingPunctuation(forMatch[1]),
      offerText: null,
      targetCustomerText: stripTrailingPunctuation(forMatch[2]),
    };
  }
  // "a small agency MAKING cafe websites" -- no "for"/"selling...to"
  // connector, but the venture and its output are still cleanly separable.
  // Without this, classification would run on the WHOLE phrase and a
  // customer-shaped word inside the output clause ("cafe") could
  // misclassify the venture itself as that kind of physical business (the
  // same bug the selling/for split above already guards against).
  const makingMatch = remainder.match(/^(.*?)\s+\b(?:making|building|creating)\b\s+(.+)$/i);
  if (makingMatch) {
    return {
      ideaText: stripTrailingPunctuation(remainder),
      ventureOnlyText: stripTrailingPunctuation(makingMatch[1]),
      offerText: stripTrailingPunctuation(makingMatch[2]),
      targetCustomerText: null,
    };
  }
  return {
    ideaText: stripTrailingPunctuation(remainder), ventureOnlyText: stripTrailingPunctuation(remainder), offerText: null, targetCustomerText: null,
  };
}

const GOAL_VERB_RE = /\b(?:i\s*(?:'m|am)|i\s+want\s+to|i'?m\s+planning\s+to|i\s+plan\s+to)\s+(?:build(?:ing)?|run(?:ning)?|start(?:ing)?|launch(?:ing)?|open(?:ing)?|creat(?:e|ing)|sell(?:ing)?)\s+(?:an?\s+)?(.+)$/i;

// Present-tense OWNERSHIP/OPERATION phrasing ("I have a marketing agency",
// "we run a website business", "my company is a clothing brand") -- a real
// founder describes an EXISTING venture this way far more often than with
// GOAL_VERB_RE's "I want to build" framing. Anchored at the start of the
// text (never mid-sentence) to keep this narrow: it must be the founder's
// own opening statement about what they have/run, not an incidental "I
// have" clause buried in a longer sentence about something else.
const OWNERSHIP_PATTERNS = Object.freeze([
  /^(?:i|we)\s+(?:already\s+)?(?:have|own|run|operate|got)\s+(?:an?\s+)?(.+)$/i,
  /^got\s+(?:an?\s+)?(.+)$/i,
  /^(?:my|our)\s+(?:business|company)\s+is\s+(.+)$/i,
]);

function matchOwnershipRemainder(text) {
  for (const re of OWNERSHIP_PATTERNS) {
    const match = text.match(re);
    if (match) return match[1];
  }
  return null;
}

function extractVentureFields(text) {
  const goalMatch = text.match(GOAL_VERB_RE);
  let remainder = goalMatch ? goalMatch[1] : null;
  // Ownership phrasing is broader/riskier than GOAL_VERB_RE's explicit
  // build-intent verbs ("I have X" could describe the venture, or could be
  // "I have no clients"/"I have a lead list") -- requireBusinessShape gates
  // it below to only accept a match that plausibly names an actual
  // business, never any bare "I have ..." clause.
  let requireBusinessShape = false;
  if (!remainder) {
    const ownershipRemainder = matchOwnershipRemainder(text);
    if (ownershipRemainder) {
      remainder = ownershipRemainder;
      requireBusinessShape = true;
    }
  }
  if (!remainder) return {};
  remainder = truncateAtSentenceBoundary(remainder);
  remainder = stripTrailingQualifierClause(remainder);
  const normalizedRemainder = stripTrailingPunctuation(remainder).toLowerCase();
  if (!remainder || VAGUE_IDEA_STOPLIST.has(normalizedRemainder)) return {};

  const {
    ideaText, ventureOnlyText, offerText, targetCustomerText,
  } = splitVentureClause(remainder);
  const fields = {};
  if (ideaText && !VAGUE_IDEA_STOPLIST.has(ideaText.toLowerCase())) {
    const family = classifyBusinessModelFamily(ventureOnlyText);
    if (requireBusinessShape && !family && !GENERIC_BUSINESS_NOUN_RE.test(ventureOnlyText)) {
      // Ownership-shaped text that names no recognisable business at all
      // ("I have no clients", "I have a lead list") -- never guess a
      // venture identity out of it.
      return {};
    }
    fields.idea = ideaText;
    if (family) fields.businessModelFamily = family;
  }
  if (offerText) fields.offer = offerText;
  if (targetCustomerText) fields.targetCustomer = targetCustomerText;
  return fields;
}

// Adjectival/state completion phrasing ("the service is ready", "my app is
// live", "everything's built") -- distinct from the verb-object phrasing
// below ("I built a sample website"). Subject capture is generic (any short
// leading noun phrase) rather than a fixed noun list, so it also covers an
// unnamed subject the founder describes in their own words.
const COMPLETE_STATE_RE = /\b([a-z][\w\s]{0,40}?)\s+(?:is|are|'s)\s+(?:finished|ready|done|complete|built|live)\b/i;
/* The subject must begin at a CLAUSE boundary. With only a \b in front, the
   lazy subject group could start mid-sentence and still satisfy the pattern:
   "Two client reports are half written and one migration is unfinished"
   matched from the word "are" onward, so the recorded item became the fragment
   "are half written and one migration is unfinished". That was harmless while
   unfinished work was only COUNTED, and became visible the moment it was used
   to word a task title.
   Capturing the clause itself (group 1) rather than the whole match also keeps
   the leading "and "/", " out of the recorded text. */
const INCOMPLETE_STATE_RE = /(?:^|[.;,]\s*|\b(?:and|but|so)\s+)([a-z]\w*(?:\s+\w+){0,6}?\s+(?:is|are|'s)\s+(?:not\s+(?:ready|finished|done|built|live|complete)|unfinished))\b/i;
const STILL_BUILDING_RE = /\b(?:i'?m|i\s+am|we'?re|we\s+are)\s+still\s+building\b\s*(.*?)[.!]?$/i;
const SUPPLIER_GAP_RE = /\b(?:i|we)\s+(?:have\s+not|haven'?t)\s+(?:found|chosen|picked|selected)\s+(?:a\s+)?(supplier|manufacturer)\b|\bno\s+(supplier|manufacturer)\s*(?:yet)?\b|\bneed(?:\s+to\s+find)?\s+a\s+(supplier|manufacturer)\b/i;

function extractCompletedWork(text) {
  const items = [];
  const verbMatch = text.match(/\bi(?:'ve| have)?\s*(?:already\s+)?(?:built|prepared|made|created|finished|set up|setup)\s+(.+?)[.!]?$/i);
  if (verbMatch) items.push(stripTrailingPunctuation(verbMatch[0].replace(/^i(?:'ve| have)?\s*/i, '').trim()));

  const stateMatch = text.match(COMPLETE_STATE_RE);
  if (stateMatch) {
    const phrase = stripTrailingPunctuation(stateMatch[0].trim());
    if (!items.some((item) => item.toLowerCase() === phrase.toLowerCase())) items.push(phrase);
  }
  if ((/\bwe\s+(?:have\s+)?launched\b/i.test(text) || /\bit'?s\s+live\b/i.test(text)) && !items.some((item) => /launch|live/i.test(item))) {
    items.push('launched');
  }
  return items.length > 0 ? items : null;
}

function extractUnfinishedWork(text) {
  const items = [];
  const needMatch = text.match(/\b(?:i\s+(?:still\s+)?(?:need|have)\s+to|(?:i\s+)?haven'?t\s+(?:yet\s+)?)\s+(.+?)[.!]?$/i);
  if (needMatch) items.push(stripTrailingPunctuation(needMatch[0].trim()));

  const stateMatch = text.match(INCOMPLETE_STATE_RE);
  if (stateMatch) {
    const phrase = stripTrailingPunctuation((stateMatch[1] || stateMatch[0]).trim());
    if (!items.some((item) => item.toLowerCase() === phrase.toLowerCase())) items.push(phrase);
  }

  const stillBuildingMatch = text.match(STILL_BUILDING_RE);
  if (stillBuildingMatch) {
    const obj = stripTrailingPunctuation((stillBuildingMatch[1] || '').trim());
    items.push(obj ? `still building ${obj}` : 'still building the product');
  }

  if ((/\bwe\s+(?:have\s+)?not\s+launched\b/i.test(text) || /\bhaven'?t\s+launched\b/i.test(text)) && !items.some((item) => /launch/i.test(item))) {
    items.push('has not launched yet');
  }

  const supplierMatch = text.match(SUPPLIER_GAP_RE);
  if (supplierMatch) {
    const noun = /manufactur/i.test(supplierMatch[0]) ? 'manufacturer' : 'supplier';
    items.push(`find a ${noun}`);
  }

  return items.length > 0 ? items : null;
}

const NEGATIVE_CUSTOMER_EVIDENCE_PATTERNS = Object.freeze([
  // Any explicit "no clients/customers/users/leads/prospects" statement,
  // anywhere in the text ("I have no clients", "no leads yet", "we
  // launched but have no clients") -- deliberately not anchored to a
  // specific pronoun/verb prefix, since founders phrase this many ways.
  /\bno\s+(?:clients?|customers?|users?|leads?|prospects?)\b/i,
  /\b(?:i\s+)?have\s*n'?t\s+signed\s+a\s+client\b/i,
  /\bhave\s+not\s+signed\s+a\s+client\b/i,
  /\b(?:nobody|no ?one)\s+(?:has\s+)?paid\b/i,
  /\b(?:nobody|no ?one)\s+(?:is\s+)?us(?:es|ing)\s+it\b/i,
  /* The money-shaped denials. Without these, the REVENUE_EVIDENCE_RE below
     reads "zero revenue" / "no paid orders" as a revenue statement, because it
     matches on the earning noun and a nearby figure -- and "300 email
     subscribers, zero paying students" would be recorded as paying customers.
     Negatives are evaluated first and win outright, exactly as before. */
  /\b(?:no|zero|0)\s+(?:paying|paid)\b/i,
  /\b(?:no|zero|0)\s+(?:revenue|sales|orders?|income|turnover|takings|bookings)\b/i,
  /\b(?:revenue|sales|orders?|income)\s+(?:is|are|of)?\s*(?:still\s+)?(?:zero|nil|nothing|0)\b/i,
  /\bnothing\s+(?:sold|paid|earned)\b/i,
  /\bnot\s+(?:sold|earned|charged|made)\s+(?:anything|a\s+(?:penny|cent|dollar|pound))\b/i,
]);

/* A money figure the founder states as MONEY THEY HAVE RECEIVED. Requires an
   explicit earning noun, never a bare amount: an intake answer about PRICE
   ("2400 pounds flat, half up front") names a figure and is not evidence that
   anyone has paid it, and extractCustomerEvidence runs over every piece of
   intake text, including that one. The earning noun is what separates the two.
   `revenue|mrr|arr|...` must appear within the same clause as the figure. */
const MONEY_FIGURE = String.raw`(?:[$£€]\s?[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d+)?\s*(?:k|m)?\s*(?:dollars?|pounds?|euros?|usd|gbp|eur)\b)`;
/* "billed" and "invoiced" are deliberately ABSENT. They read as revenue in
   "4800 pounds billed so far" but as billing CADENCE in "199 dollars per month
   per site, billed monthly" -- and the second is how founders answer the
   pricing question, which this same extractor sees. A price is not evidence
   anyone paid it, so the ambiguous pair is dropped rather than guessed at;
   every genuine revenue statement in the fixtures still matches on
   revenue/sales/turnover/recurring or on a stated paying count. */
const EARNING_NOUN = String.raw`(?:revenue|mrr|arr|recurring|turnover|takings|earned|earning|profit|sales|income)`;
const REVENUE_EVIDENCE_RE = new RegExp(
  `(?:${MONEY_FIGURE}[^.!?]{0,40}?\\b${EARNING_NOUN}\\b)|(?:\\b${EARNING_NOUN}\\b[^.!?]{0,40}?${MONEY_FIGURE})`,
  'i',
);

/* Completed transactions. An order, sale or booking is money that changed
   hands, so it establishes hasPayingCustomers -- but a transaction is NOT a
   customer (300 orders may be 200 people), so this deliberately never sets
   customerCount. Overstating the customer count would be the same class of
   fabrication the "paying" requirement below exists to prevent. */
const TRANSACTION_EVIDENCE_RE = /\b(?:\d[\d,]*)\s+(?:orders?|sales|purchases|bookings|covers|units\s+sold|paid\s+signups?)\b/i;

// "40 paying users" / "I have 12 paying customers" -- a real, quantified
// positive customer-evidence signal. Deliberately requires the word
// "paying" (never infers payment from a bare "N users/customers", which
// could just as easily mean signups) -- so it only ever emits
// hasPayingCustomers:true when the founder actually said so.
/* The "I have" prefix and the immediate paying+noun adjacency were both too
   strict for how founders actually write. A real agency answer -- "Four paying
   retainer clients, about 18k a month recurring" -- matched neither, so a
   founder with four paying clients and $18k monthly recurring was assessed as
   having NO customer evidence and told "you do not have proof yet that people
   will pay for this". Verified end to end on the agency scenario.
   Widened on two axes only:
     * the lead-in is optional ("Four paying clients" on its own counts), and
     * one descriptive word may sit between "paying" and the noun
       ("paying RETAINER clients", "paying MONTHLY subscribers").
   The word "paying" is still REQUIRED -- a bare "N clients" could just as
   easily mean signups, and this must never infer payment the founder did not
   state. ASPIRATIONAL_PAYING_RE below then rejects the wanted-not-had case,
   which widening the lead-in would otherwise have let through. */
/* The noun is OPEN (any word, singular or plural), because the word carrying
   the meaning has always been "paying", not the noun after it -- whatever a
   founder calls the people paying them, they have said those people pay. The
   closed list was its own trap: "60 paying MEMBERS", a paid community's entire
   traction, matched nothing and the venture read as having no customers.
   The stoplist sits immediately after "paying" and before the optional
   descriptive word, so "paying" stays attached to a person-noun: placed after
   that group, the group simply absorbed the particle and "3 paying off debts"
   counted as three customers. */
const POSITIVE_PAYING_CUSTOMER_RE = /\b(?:(?:i|we)\s+(?:have|had|currently\s+have)\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+paying\s+(?!for\b|off\b|out\b|into\b|down\b|back\b|up\b|it\b|the\b|a\b|an\b)(?:[a-z]+\s+)?([a-z]+)\b/i;

/* "I want three paying clients" / "hoping for 10 paying customers" state a
   GOAL, not evidence. Without this, dropping the mandatory "I have" prefix
   above would record them as customers the founder does not have -- exactly
   the fabrication this module exists to prevent. */
/* `convert`/`grow`/`reach`/`get to` were missing, and the intake question
   "What outcome are you trying to achieve next?" invites exactly that phrasing:
   "Convert to ten paying accounts" was being recorded as ten real paying
   accounts. Harmless while the noun list was closed ("accounts" did not match);
   a fabrication the moment it was opened. */
const ASPIRATIONAL_PAYING_RE = /\b(?:want|need|hope|hoping|aim|aiming|goal|target|targeting|looking\s+for|trying\s+to\s+(?:get|find|land|sign)|would\s+like|wish|plan(?:ning)?\s+to|convert(?:ing)?(?:\s+to)?|grow(?:ing)?\s+to|scale\s+to|reach(?:ing)?|get(?:ting)?\s+to|first)\b[^.!?]{0,40}?\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+paying\b/i;

/* A CLARIFICATION ANSWER MAY ONLY SPEAK TO WHAT IT WAS ASKED.
   extractFactsFromText runs over every piece of intake text, so an answer
   about PRICE ("Nothing sold directly yet"), about UNFINISHED WORK ("no
   bookings", "no paid conversion") or about the NEXT OUTCOME ("Convert to ten
   paying accounts") each produced a customerEvidence fact of its own. When
   those disagreed with the real evidence answer, two equal-trust facts landed
   in the ledger, and which one won was decided by whether the two intake calls
   happened to fall in the same millisecond: the same venture, with the same
   answers, produced a different bottleneck and a different task between
   consecutive runs. Reproduced 2 times in 6 on the creator fixture.

   Scoped to intake clarification answers ONLY, and only those NOT asking about
   evidence. Free text from anywhere else -- the goal and progress statements,
   corrections, analyst chat, any caller with its own sourceReference -- behaves
   exactly as it always has. An allowlist was tried first and was the wrong
   shape: it silently stopped extracting for every caller not on it, which is
   the same quiet degradation this module keeps being bitten by. */
function sourceMayAssertCustomerEvidence(sourceReference) {
  const match = /^intake_clarification:(.+)$/.exec(String(sourceReference ?? ''));
  return !match || match[1] === 'evidence';
}

/**
 * Reads a founder's own words about traction into the four structured fields
 * `customerEvidence` allows (see founder-venture-state/sections.js). The
 * structure is what matters: every downstream consumer -- most importantly
 * `hasRealCustomers` in founder-mission-policy -- reads ONLY
 * `hasPayingCustomers`/`customerCount` and cannot see prose. Anything that
 * fell through to a `{notes}` blob was therefore treated as ZERO customers,
 * so a restaurant billing 34k a month, a community with 60 paying members and
 * a brand with 300 orders were each told "you do not have proof yet that
 * people will pay for this" and sent to find their first customer.
 *
 * Three independent positive signals, in decreasing specificity. None of them
 * infers payment that was not stated -- free audience counts (subscribers,
 * installs, followers, list size) deliberately match NOTHING here, because an
 * audience is not evidence of revenue and claiming otherwise would be the same
 * fabrication the "paying" requirement has always guarded against.
 */
function extractCustomerEvidence(text) {
  if (NEGATIVE_CUSTOMER_EVIDENCE_PATTERNS.some((re) => re.test(text))) {
    return { hasPayingCustomers: false, evidenceType: 'none' };
  }
  if (ASPIRATIONAL_PAYING_RE.test(text)) return null;

  // 1. A stated count of people who pay -- the only signal that yields a count.
  const positiveMatch = text.match(POSITIVE_PAYING_CUSTOMER_RE);
  if (positiveMatch) {
    const raw = positiveMatch[1].toLowerCase();
    const count = NUMBER_WORDS[raw] ?? Number(raw);
    if (Number.isFinite(count) && count > 0) {
      return { customerCount: count, hasPayingCustomers: true, evidenceType: 'paying_customers' };
    }
  }

  /* 2/3. Money received, or completed transactions. Both prove the market has
     paid without saying how many people did, so both set hasPayingCustomers
     and leave customerCount absent rather than guessing it. That distinction
     is load-bearing: prospect-list missions size themselves off customerCount,
     and inventing one would produce a confidently wrong number. */
  if (REVENUE_EVIDENCE_RE.test(text) || TRANSACTION_EVIDENCE_RE.test(text)) {
    return { hasPayingCustomers: true, evidenceType: 'paying_customers' };
  }
  return null;
}

function extractOfferPricing(text) {
  const match = text.match(/\bmy\s+(.+?)\s+offer\s+is\s+\$?([\d,]+(?:\.\d+)?)/i)
    || text.match(/\bi(?:'m| am)\s+charging\s+\$?(\d+(?:\.\d+)?)\b/i);
  if (!match) return null;
  if (match.length === 3) {
    return { offer: stripTrailingPunctuation(match[1]).replace(/^\w/, (c) => c.toUpperCase()), price: Number(match[2].replace(/,/g, '')) };
  }
  return { offer: null, price: Number(match[1]) };
}

function extractBottleneck(text) {
  const match = text.match(/\b(?:current\s+)?(?:problem|blocker|bottleneck)\s+is\s+(.+?)[.!]?$/i);
  if (!match) return null;
  return stripTrailingPunctuation(match[1]);
}

const NUMBER_WORD_ALTERNATION = 'one|two|three|four|five|six|seven|eight|nine|ten';

// Each pattern names a real, individually-identifiable prospect count and
// an honest contactability for it: "I know N shop owners"/"...to contact"
// implies the founder can actually reach them (reachable); "I made a list
// of N shops" only confirms the list exists, not that any entry is
// individually confirmed reachable yet (unknown) -- never overclaimed.
const PROSPECT_COUNT_PATTERNS = Object.freeze([
  { re: new RegExp(`\\b(\\d+|${NUMBER_WORD_ALTERNATION})\\b[^.!]{0,50}\\b(?:can contact|to contact|reachable)\\b`, 'i'), contactability: 'reachable' },
  { re: new RegExp(`\\bi\\s+know\\s+(\\d+|${NUMBER_WORD_ALTERNATION})\\s+(?:local\\s+)?(?:business(?:es)?|shop\\s*owners?|shops?|companies|prospects?|contacts?|clients?)\\b`, 'i'), contactability: 'reachable' },
  { re: new RegExp(`\\b(?:i|we)\\s+(?:already\\s+)?(?:made|built|have|created)\\s+a\\s+list\\s+of\\s+(\\d+|${NUMBER_WORD_ALTERNATION})\\s+(?:shops?|businesses|companies|prospects?|leads?|clients?|customers?)\\b`, 'i'), contactability: 'unknown' },
]);

function extractReachableProspectCount(text) {
  for (const { re, contactability } of PROSPECT_COUNT_PATTERNS) {
    const match = text.match(re);
    if (!match) continue;
    const raw = match[1].toLowerCase();
    const count = NUMBER_WORDS[raw] ?? Number(raw);
    if (!Number.isFinite(count) || count <= 0 || count > 20) continue;
    return { count, contactability };
  }
  return null;
}

/* Real external tooling, named by the founder. These are the resources VISION
   cannot provide and must never assume (see EXTERNAL_RESOURCE_IDS in
   founder-intake/pipeline.js): without a way to declare them, the delivery,
   retention and operating-process routes were unreachable for every founder
   forever, including the ones who genuinely do have a repository and a CI
   pipeline. `availableResourceIds` was already a first-class list fact -- read
   by the intake pipeline, mapped into the snapshot as `resources`, consulted
   by the clarification gate -- with no producer anywhere in the codebase.

   Deliberately narrow: only unambiguous tool names and phrases that state
   POSSESSION. A founder saying "I need to set up CI" has named the same tool
   while saying the opposite, so the negative/aspirational guard below matters
   as much as the vocabulary. Anything unrecognised simply yields nothing and
   the route stays honestly blocked. */
const DECLARED_RESOURCE_PATTERNS = Object.freeze([
  { re: /\b(?:github|gitlab|bitbucket|repo|repository|codebase|source\s+control|version\s+control)\b/i, ids: ['repository_access'] },
  { re: /\b(?:ci\/?cd|ci\s+pipeline|continuous\s+integration|build\s+pipeline|github\s+actions|jenkins|circleci)\b/i, ids: ['build_environment'] },
  { re: /\b(?:vercel|netlify|heroku|fly\.io|render|railway|aws|gcp|azure|cloudflare)\b/i, ids: ['build_environment', 'delivery_access'] },
  { re: /\b(?:staging\s+environment|test\s+suite|unit\s+tests|automated\s+tests|test\s+environment)\b/i, ids: ['test_environment'] },
  { re: /\b(?:app\s?store|play\s?store|steam(?:works)?|testflight|production\s+environment)\b/i, ids: ['delivery_access'] },
  { re: /\b(?:mixpanel|amplitude|posthog|heap|google\s+analytics|ga4|product\s+analytics|analytics\s+dashboard)\b/i, ids: ['product_analytics_dashboard'] },
  { re: /\b(?:stripe|chargebee|recurly|paddle|subscription\s+data|cohort\s+data|churn\s+report)\b/i, ids: ['retention_cohort_data'] },
  { re: /\b(?:notion|linear|jira|asana|trello|airtable|clickup|monday\.com)\b/i, ids: ['operating_tool_access'] },
  { re: /\b(?:sop|standard\s+operating\s+procedure|runbook|checklist\s+system|documented\s+process)\b/i, ids: ['process_verification_environment'] },
]);

/* "I don't have a repo", "no CI yet", "I need to set up analytics" -- each
   names a tool while stating its ABSENCE. Scanned per clause so one denial
   does not discard a genuine declaration elsewhere in the same answer. */
const RESOURCE_DENIAL_RE = /\b(?:no|not|never|without|lack(?:ing)?|need(?:s|ed)?\s+to|haven'?t|have\s+not|don'?t\s+have|going\s+to|planning\s+to|want\s+to|should\s+(?:get|set)|yet\s+to)\b/i;

/**
 * @param {string} text The founder's own words about resources/constraints.
 * @returns {string[]|null} Canonical resource ids the founder said they HAVE.
 */
function extractAvailableResourceIds(text) {
  /* Clause-level, not whole-answer: "I have a GitHub repo but no CI yet"
     declares one tool and denies another, and judging the whole sentence
     either way would be wrong in one direction or the other. */
  const clauses = String(text).split(/[.;,]|\bbut\b|\bthough\b|\bhowever\b|\balthough\b/i);
  const ids = new Set();
  for (const clause of clauses) {
    if (!clause.trim() || RESOURCE_DENIAL_RE.test(clause)) continue;
    for (const { re, ids: candidateIds } of DECLARED_RESOURCE_PATTERNS) {
      if (re.test(clause)) candidateIds.forEach((id) => ids.add(id));
    }
  }
  return ids.size > 0 ? [...ids].sort() : null;
}

/**
 * Shapes a founder's DIRECT answer about customer evidence into the section
 * value, keeping their exact words in `notes` AND reading whatever structure
 * those words contain.
 *
 * This exists because the two write paths that produce a `customerEvidence`
 * fact from a targeted answer -- the intake question fallback and an
 * `intake_confirm` correction -- both stored `{ notes: "<raw text>" }` and
 * nothing else. Prose is invisible to every consumer (`hasRealCustomers` reads
 * only the structured fields), so answering the demand question could never
 * change the assessment, no matter what the founder wrote. Re-asking the same
 * question was the only possible outcome.
 *
 * Notes are always retained: the structure is an addition, never a
 * replacement, so nothing the founder said is discarded or paraphrased.
 *
 * @param {string} text The founder's own answer.
 * @returns {{customerCount?: number, hasPayingCustomers?: boolean, evidenceType?: string, notes: string}}
 */
export function shapeCustomerEvidenceAnswer(text) {
  const notes = typeof text === 'string' ? text.trim() : '';
  const structured = notes ? extractCustomerEvidence(clean(notes)) : null;
  return structured ? { ...structured, notes } : { notes };
}

const CURRENCY_BY_SYMBOL = Object.freeze({ $: 'USD', '£': 'GBP', '€': 'EUR' });
const BILLING_INTERVAL_PATTERNS = Object.freeze([
  { re: /\b(?:per\s+month|a\s+month|monthly|\/\s*mo(?:nth)?\b|p\/m\b)/i, interval: 'monthly' },
  { re: /\b(?:per\s+week|a\s+week|weekly|\/\s*wk\b)/i, interval: 'weekly' },
  { re: /\b(?:per\s+year|a\s+year|annually|annual|\/\s*yr\b)/i, interval: 'annual' },
  { re: /\b(?:one[-\s]?off|one[-\s]?time|upfront|up\s+front)\b/i, interval: 'one_time' },
  { re: /\bper\s+(?:project|job|engagement)\b/i, interval: 'per_project' },
]);

/**
 * Shapes a founder's DIRECT answer about pricing into the offerPricing section
 * value, keeping their exact words in `notes` AND reading the structure those
 * words contain.
 *
 * Same defect, same shape as shapeCustomerEvidenceAnswer above: both write
 * paths that produce an `offerPricing` fact from a targeted answer -- the
 * offer_price question fallback and an `intake_confirm` correction -- stored
 * `{ notes: "<raw text>" }`. `pricingStatus` is only ever set by the structured
 * extractor, so signals.offerPublished() read false for EVERY founder who
 * answered the pricing question, and route-assessment.js scored them
 * weak_demand 45 for "an offer exists but is not published/live" -- while
 * holding the price they had just typed. That file already carries a workaround
 * for the paying-customer half of the fallout; a pre-revenue founder still got
 * the wrong constraint.
 *
 * The general extractor's patterns are deliberately narrow because it runs over
 * arbitrary prose where "$50" could mean anything. Here the founder was asked
 * "What do you charge for it, and how is it billed?", so a single amount in the
 * answer IS the price. Two or more distinct amounts ("$50 setup then $20/mo")
 * are genuinely ambiguous and are left as notes rather than guessed at.
 *
 * @param {string} text The founder's own answer.
 * @returns {{price?: number, currency?: string, billingInterval?: string, pricingStatus?: string, notes: string}}
 */
export function shapeOfferPricingAnswer(text) {
  const notes = typeof text === 'string' ? text.trim() : '';
  if (!notes) return { notes };

  const cleaned = clean(notes);

  /* Every amount the founder wrote that names its own currency, keyed by value
     so "$50 ... $50" is one price rather than an ambiguous two. */
  const amountsByValue = new Map();
  for (const match of cleaned.matchAll(/([$£€])\s?(\d[\d,]*(?:\.\d+)?)|\b(\d[\d,]*(?:\.\d+)?)\s?(USD|GBP|EUR)\b/gi)) {
    const value = Number((match[2] ?? match[3]).replace(/,/g, ''));
    if (Number.isFinite(value)) amountsByValue.set(value, match[1] ? CURRENCY_BY_SYMBOL[match[1]] : match[4].toUpperCase());
  }

  const structured = extractOfferPricing(cleaned);
  let price = typeof structured?.price === 'number' ? structured.price : null;
  /* Two or more distinct amounts ("$50 setup then $20/mo") are genuinely
     ambiguous when the general extractor did not already pick one. */
  if (price === null && amountsByValue.size === 1) [price] = [...amountsByValue.keys()];
  if (price === null) return { notes };
  const currency = amountsByValue.get(price) ?? null;

  const billing = BILLING_INTERVAL_PATTERNS.find((entry) => entry.re.test(cleaned));
  return {
    price,
    /* Only ever recorded when it was actually stated -- never defaulted to a
       currency the founder did not name. */
    ...(currency ? { currency } : {}),
    ...(billing ? { billingInterval: billing.interval } : {}),
    /* The same status the general extractor records for a stated price. The
       founder was asked what they charge, in the present tense; speculative
       phrasing never reaches here (applyClarificationAnswers skips the fallback
       entirely when extraction flagged the answer hypothetical). */
    pricingStatus: 'published',
    notes,
  };
}

/**
 * Extracts every recognisable Founder fact from one piece of free text.
 * Hypothetical/speculative phrasing blocks extraction entirely (same gate
 * as collectors/chat.js). Every fact here is `analyst_chat` / provisional.
 *
 * @param {object} params
 * @param {string} params.ventureId
 * @param {string} params.userId
 * @param {string} params.text
 * @param {string} params.sourceReference Non-secret provenance label, e.g. `intake_goal_statement` or `intake_clarification:who_for`.
 * @param {string} params.occurredAt ISO timestamp.
 * @param {number} [params.seedSeq] Starting sequence number for factId uniqueness across multiple calls sharing one sourceReference.
 * @returns {{facts: object[], skippedHypothetical: boolean, nextSeq: number}}
 */
export function extractFactsFromText({
  ventureId, userId, text, sourceReference, occurredAt, seedSeq = 0,
}) {
  const cleaned = clean(text);
  if (!cleaned) return { facts: [], skippedHypothetical: false, nextSeq: seedSeq };
  if (HYPOTHETICAL_RE.test(cleaned)) return { facts: [], skippedHypothetical: true, nextSeq: seedSeq };

  let seq = seedSeq;
  const facts = [];
  // founder_venture_facts.fact_id is a bare global primary key, not scoped by
  // venture_id (confirmed against the live schema) -- every generated factId
  // in this module must therefore be venture-scoped itself, or a second
  // venture for the same user (archive-and-restart, or a genuine 'secondary'
  // venture, which the schema explicitly supports) collides on the exact
  // same sourceReference-derived id and appendFacts throws an unhandled 500.
  const push = (factKey, value) => {
    facts.push(buildFact({
      factId: `${ventureId}:${sourceReference}:${seq++}`,
      ventureId,
      userId,
      factKey,
      value,
      sourceType: 'analyst_chat',
      sourceReference,
      occurredAt,
      recordedAt: occurredAt,
      metadata: { extractedFrom: 'founder_intake' },
    }));
  };

  const ventureFields = extractVentureFields(cleaned);
  if (ventureFields.businessModelFamily) push('businessModelFamily', ventureFields.businessModelFamily);
  if (ventureFields.idea) push('idea', ventureFields.idea);
  if (ventureFields.targetCustomer) push('targetCustomer', ventureFields.targetCustomer);

  const offerPricing = extractOfferPricing(cleaned);
  if (offerPricing) {
    if (offerPricing.offer) push('offer', offerPricing.offer);
    else if (ventureFields.offer) push('offer', ventureFields.offer);
    push('offerPricing', { price: offerPricing.price, pricingStatus: 'published' });
  } else if (ventureFields.offer) {
    push('offer', ventureFields.offer);
  }

  const completedWork = extractCompletedWork(cleaned);
  if (completedWork) push('completedWork', completedWork);

  const unfinishedWork = extractUnfinishedWork(cleaned);
  if (unfinishedWork) push('unfinishedWork', unfinishedWork);

  const customerEvidence = sourceMayAssertCustomerEvidence(sourceReference)
    ? extractCustomerEvidence(cleaned) : null;
  if (customerEvidence) push('customerEvidence', customerEvidence);

  const bottleneck = extractBottleneck(cleaned);
  if (bottleneck) push('currentBottleneck', bottleneck);

  /* The only producer of `availableResourceIds` -- without it the delivery,
     retention and operating-process routes are permanently blocked for every
     founder, because those need real tooling VISION will not assume. */
  const declaredResources = extractAvailableResourceIds(cleaned);
  if (declaredResources) push('availableResourceIds', declaredResources);

  const prospectMatch = extractReachableProspectCount(cleaned);
  if (prospectMatch) {
    const { count: prospectCount, contactability } = prospectMatch;
    const label = contactability === 'reachable' ? 'Reachable prospect' : 'Listed prospect';
    for (let i = 1; i <= prospectCount; i += 1) {
      facts.push(buildFact({
        factId: `${ventureId}:${sourceReference}:${seq++}`,
        ventureId,
        userId,
        factKey: buildEntityFactKey('customerEntity', `intake_prospect_${i}`),
        value: {
          relationshipType: 'prospect',
          safeDisplayLabel: `${label} ${i}`,
          contactability,
          customerStatus: 'active',
        },
        sourceType: 'analyst_chat',
        sourceReference,
        occurredAt,
        recordedAt: occurredAt,
        metadata: { extractedFrom: 'founder_intake' },
      }));
    }
  }

  return { facts, skippedHypothetical: false, nextSeq: seq };
}

/**
 * Top-level intake entry point for STEP 1 (goal statement + optional
 * progress note). `immediateGoal` is the user's own verbatim words, not a
 * parsed inference, so it alone is recorded `onboarding` / user_confirmed
 * (Known) immediately -- everything else extracted from the same text is
 * `analyst_chat` / provisional (Inferred) until the user confirms it in
 * STEP 4.
 *
 * @param {object} params
 * @param {string} params.ventureId
 * @param {string} params.userId
 * @param {string} params.goalText
 * @param {string|null} [params.progressText]
 * @param {string} params.occurredAt ISO timestamp.
 * @returns {{facts: object[], skippedHypothetical: boolean}}
 */
export function extractFounderIntakeFacts({
  ventureId, userId, goalText, progressText = null, occurredAt,
}) {
  const goal = clean(goalText);
  if (!goal) return { facts: [], skippedHypothetical: false };

  const facts = [];
  facts.push(buildFact({
    factId: `${ventureId}:intake_goal_statement:verbatim`,
    ventureId,
    userId,
    factKey: 'immediateGoal',
    value: goal,
    sourceType: 'onboarding',
    sourceReference: 'intake_goal_statement',
    occurredAt,
    recordedAt: occurredAt,
  }));

  const goalExtraction = extractFactsFromText({
    ventureId, userId, text: goal, sourceReference: 'intake_goal_statement', occurredAt, seedSeq: 0,
  });
  facts.push(...goalExtraction.facts);

  let skippedHypothetical = goalExtraction.skippedHypothetical;
  const progress = clean(progressText);
  if (progress) {
    const progressExtraction = extractFactsFromText({
      ventureId, userId, text: progress, sourceReference: 'intake_progress_statement', occurredAt, seedSeq: 0,
    });
    facts.push(...progressExtraction.facts);
    skippedHypothetical = skippedHypothetical || progressExtraction.skippedHypothetical;
  }

  return { facts, skippedHypothetical };
}
