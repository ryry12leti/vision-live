/**
 * Founder task-quality gate.
 *
 * A SEPARATE, additive layer, deliberately outside founder-execution-context
 * (route eligibility), founder-bottleneck (confidence/ambiguity) and
 * founder-venture-state (the reducer/conflict/confidence-relevant-key
 * system). It runs AFTER the engine has already selected and validated a
 * task, and decides only one narrow thing: does this specific task, as
 * WORDED for persistence, still contain a genuinely fillable, un-fabricated
 * gap that would make it too vague to act on. If so it returns exactly one
 * question, reusing the SAME { needs_clarification, clarification_questions }
 * contract shape the engine's own clarification path already returns -- the
 * frontend requires no new logic, and the founder answers it through the
 * exact same intake_confirm correction path already used for
 * idea/targetCustomer/completedWork.
 *
 * This gate NEVER changes which task the engine selects, never changes
 * confidence, never resolves a conflict, and never reads or writes a
 * customerEntity fact -- it only reads the venture's OWN answer to a
 * question it itself can ask (outreachChannel), from the raw fact ledger
 * the caller already has in scope. Answering that question changes NOTHING
 * about eligibility or the bottleneck; it only fills in HOW the founder
 * carries out the task the engine already chose.
 *
 * Routes that instruct the founder to reach a real prospect (interview,
 * outreach, or an offer test that also requires a reachable customer -- see
 * founder-execution-context/route-eligibility.js's founder_offer_test) are
 * meaningless without a channel: "contact them" is not an action. Routes
 * that do not involve reaching anyone (product delivery, retention
 * analysis, operating process, strategy decision) are never gated here.
 */

import { BOTTLENECK_CATEGORY_ROUTES } from '../founder-bottleneck/contract.js';
import { buildMissionContext, missionFirstClause } from '../decision-core/mission-context.js';
import { buildFounderQuestion } from '../founder-execution-context/contract.js';

const OUTREACH_SHAPED_ROUTES = Object.freeze([
  'founder_customer_interview_set',
  'founder_sales_outreach_block',
  'founder_offer_test',
]);

const CHANNEL_QUESTION = 'How will you reach them: call, text, email, or in person?';
/* The identified form of the same question. This gate is a second producer on
   the same 409 contract as the engine's own clarification path, so it must put
   the same identity on the wire -- otherwise the ONE question that reaches the
   founder through this path is the one question the client still has to
   recognise by its wording. */
const CHANNEL_QUESTION_DETAIL = buildFounderQuestion('outreach_channel_for_task', CHANNEL_QUESTION);

const VALID_CHANNELS = Object.freeze(['call', 'text', 'email', 'in_person']);

/**
 * Maps free founder text to one of the fixed channel values, without
 * inventing anything not implied by what they actually wrote. Unrecognised
 * text is still saved as the raw fact (never discarded), but is not treated
 * as satisfying the gate -- see resolveChannelFromLedger.
 */
export function interpretChannelAnswer(text) {
  const t = String(text || '').toLowerCase();
  // Whichever channel the founder named FIRST wins. The previous fixed check
  // order (email, text, call, in_person) read the founder's own sentence out
  // of sequence: "in-person walk-in to the business during opening hours,
  // asking for the owner or manager, followed up by phone" was mapped to
  // `call`, because `phone` was tested before `walk-in` was tested at all --
  // so a founder whose primary channel is walking in was told to phone.
  // A single-channel answer is unaffected: only one pattern matches at all.
  const patterns = [
    ['email', /\bemail\b/],
    /* Bare "message" removed. It matched "I message founders on LinkedIn" and
       "I DM them on Instagram"-style answers as SMS, so the task told an
       agency founder to TEXT brands they reach on LinkedIn. Those channels
       have no entry in the fixed call/text/email/in_person set, and inventing
       the nearest one is worse than admitting we cannot map it: an unmapped
       answer still counts as ANSWERED (resolveChannelFromLedger) and the
       founder's own words are used verbatim instead. "text message" still
       maps, because that phrasing is unambiguous. */
    ['text', /\btext\b|\bsms\b|\btext\s+message\b/],
    ['call', /\bcall|phone\b/],
    ['in_person', /\bin[\s-]?person|visit|walk[\s-]?in|drop by/],
  ];
  let best = null;
  for (const [channel, pattern] of patterns) {
    const found = t.search(pattern);
    if (found === -1) continue;
    if (best === null || found < best.at) best = { channel, at: found };
  }
  return best ? best.channel : null;
}

const CHANNEL_LABEL = Object.freeze({
  call: 'Call them', text: 'Text them', email: 'Email them', in_person: 'Visit them in person',
});

// Founder-specific mapping from the fixed channel set to the imperative verb
// a mission compiler needs for a sentence ("Call 3 reachable prospects...").
// Lives here, not in decision-core, because "call/text/email/visit" is
// Founder outreach vocabulary, not a domain-neutral concept.
const CHANNEL_VERB = Object.freeze({
  call: 'Call', text: 'Text', email: 'Email', in_person: 'Visit',
});

/**
 * The latest active scalar fact for a given key, read straight from the raw
 * ledger. Used for keys (outreachChannel, targetCustomer) that are NOT
 * whitelisted snapshot sections -- see snapshot.js's buildFounderGoalEngineSnapshot,
 * whose fixed return shape genuinely omits both. `snapshot.targetCustomer`
 * is always undefined; reading it there is dead code, not a degrade-to-null
 * case, so this is the only correct source for either value.
 */
function resolveLatestScalarFactFromLedger(factLedger, factKey) {
  const fact = (factLedger || [])
    .filter((f) => f.factKey === factKey && f.active)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))[0];
  return fact ? String(fact.value || '').trim() || null : null;
}

function resolveChannelFromLedger(factLedger) {
  const fact = (factLedger || [])
    .filter((f) => f.factKey === 'outreachChannel' && f.active)
    .sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt))[0];
  if (!fact) return { known: false, channel: null, raw: null };
  const channel = interpretChannelAnswer(fact.value);
  // A recorded answer this gate cannot map to a fixed channel still counts
  // as "answered" -- the founder DID respond, and asking the identical
  // question again would be exactly the unanswerable-loop defect this
  // whole investigation started from. The raw text is used verbatim instead.
  return { known: true, channel, raw: String(fact.value || '').trim() };
}

/**
 * @param {object} params
 * @param {object} params.result A validated, status:'selected' FounderDecisionResult.
 * @param {object[]} params.factLedger The venture's raw fact ledger (already in scope at the call site; see founder-engine-bridge.mjs).
 * @returns {{ok: true, channelLabel: string|null, needsChannel: boolean}|{ok: false, question: string, questionDetail: {id: string, factKeys: string[], question: string}, needsChannel: true}}
 */
export function evaluateFounderTaskQuality({ result, factLedger }) {
  const category = result?.currentBottleneck?.category || null;
  const candidateRoutes = BOTTLENECK_CATEGORY_ROUTES[category] || [];
  const needsChannel = candidateRoutes.some((routeId) => OUTREACH_SHAPED_ROUTES.includes(routeId));
  if (!needsChannel) return { ok: true, channelLabel: null, needsChannel: false };

  const resolved = resolveChannelFromLedger(factLedger);
  if (!resolved.known) {
    return {
      ok: false, question: CHANNEL_QUESTION, questionDetail: CHANNEL_QUESTION_DETAIL, needsChannel: true,
    };
  }
  const channelLabel = resolved.channel ? CHANNEL_LABEL[resolved.channel] : resolved.raw;
  return { ok: true, channelLabel, needsChannel: true };
}

/**
 * Read-only content for the adapter to weave into task text. `offerText`
 * comes from `snapshot` -- the value the reducer already resolved as the
 * trusted winner for offerPricing/offer -- NEVER re-derived from the raw
 * ledger here, so this can never disagree with what the rest of the system
 * already treats as true. `channelLabel` and the MissionContext's
 * `targetLabel` are the two values that genuinely cannot come from
 * `snapshot` (outreachChannel and targetCustomer are both NOT in
 * buildFounderGoalEngineSnapshot's fixed return shape -- see
 * founder-venture-state/snapshot.js's SNAPSHOT_REQUIRED_FIELDS; reading
 * `snapshot.targetCustomer` is always undefined, not a degrade-to-null
 * case), so both are read from the raw ledger, which is safe here because
 * intake is their only writer (see
 * api/_lib/founder-intake-shared.mjs's ALLOWED_CORRECTION_FIELDS).
 *
 * `missionContext` is the same facts, reshaped into the domain-neutral
 * MissionContext contract (see decision-core/mission-context.js) for the
 * mission compiler to word the selected task's title/steps/statement with
 * from the start, rather than the adapter patching them on afterwards.
 * Building it is Founder's job -- it alone knows that "outreachChannel" maps
 * to an action, "offer" is the subject, and "targetCustomer" is the target;
 * the compiler and decision-core never see those Founder-specific names.
 *
 * @param {object} params
 * @param {object} params.snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @param {object[]} params.factLedger
 * @returns {{offerText: string|null, channelLabel: string|null, missionContext: import('../decision-core/mission-context.js').MissionContext}}
 */
/* VISION writes these labels itself (founder-intake/extract.js) when a founder
   reports a COUNT of prospects rather than naming them. They are not real
   business names and must never be described as ones the founder chose. */
const GENERATED_PROSPECT_LABEL = /^(?:reachable|listed) prospect \d+$/i;

const CONTACT_ROUTE_NOUN = Object.freeze({
  call: 'a phone number', email: 'an email address',
  website_form: 'a contact form', public_social: 'a public social page',
});

/**
 * The named prospects on this venture, with the two things that honestly
 * explain why each is on the list: the customer type it was matched on, and
 * the public contact route recorded for it. Both come straight off the
 * customerEntity fact written when the founder approved the lead
 * (opportunity-intelligence/founder-bridge.js's approvedOpportunityFacts) --
 * nothing here re-derives or infers a reason.
 *
 * @returns {{name: string, segment: string|null, routes: string[]}[]}
 */
export function resolveProspectDetails(factLedger) {
  return (factLedger || [])
    .filter((fact) => fact?.active === true
      && typeof fact.factKey === 'string'
      && fact.factKey.startsWith('customerEntity:')
      && fact.value?.relationshipType === 'prospect')
    .map((fact) => ({
      name: String(fact.value.safeDisplayLabel || '').trim(),
      segment: typeof fact.value.segmentId === 'string' && fact.value.segmentId
        ? fact.value.segmentId.replace(/_/g, ' ').trim()
        : null,
      routes: (Array.isArray(fact.value.availableChannelIds) ? fact.value.availableChannelIds : [])
        .map((channel) => CONTACT_ROUTE_NOUN[channel]).filter(Boolean),
    }))
    .filter((entry) => entry.name && !GENERATED_PROSPECT_LABEL.test(entry.name));
}

export function resolveFounderTaskContentFacts({ snapshot, factLedger }) {
  const offerText = snapshot?.offerPricing?.status === 'known'
    ? (snapshot.offerPricing.value?.notes || null)
    : (snapshot?.offer?.status === 'known' ? snapshot.offer.value : null);
  const resolved = resolveChannelFromLedger(factLedger);
  const channelLabel = resolved.known
    ? (resolved.channel ? CHANNEL_LABEL[resolved.channel] : resolved.raw)
    : null;
  const targetLabel = missionFirstClause(resolveLatestScalarFactFromLedger(factLedger, 'targetCustomer'), 60);
  const prospects = resolveProspectDetails(factLedger);
  const missionContext = buildMissionContext({
    actionVerb: resolved.known && resolved.channel ? CHANNEL_VERB[resolved.channel] : null,
    actionLabel: channelLabel,
    subjectText: offerText,
    targetLabel,
    domain: 'founder',
  });
  return { offerText: offerText || null, channelLabel, missionContext, prospects };
}

/**
 * Structural, non-fabricating safety net -- NOT a second decision. If this
 * ever fails after the gate already said `ok`, that means the adapter
 * failed to weave in content it should have had, which is an adapter bug,
 * not a founder-answerable question: the caller should fail closed (no
 * task persisted) rather than invent a new clarification round for
 * something the founder cannot fix by answering anything.
 *
 * @param {object} params
 * @param {object} params.task The composed legacy task (founderDecisionResultToLegacyTask output).
 * @param {boolean} params.needsChannel From evaluateFounderTaskQuality.
 * @param {string|null} params.offerText From resolveFounderTaskContentFacts.
 * @returns {{valid: boolean, reasons: string[]}}
 */
export function validateFounderTaskConcreteness({ task, needsChannel, offerText }) {
  const reasons = [];
  const haystack = `${task?.why || ''} ${task?.mistake_to_avoid || ''} ${(task?.steps || []).join(' ')}`.toLowerCase();

  /* `needsChannel` is derived from the BOTTLENECK CATEGORY's candidate routes,
     not from the task that was actually selected. That is right for deciding
     whether to ASK the founder their channel, and wrong here: a category whose
     routes include outreach can still resolve to a task that contacts nobody.
     A real founder hit exactly that. The engine selected the prerequisite
     "Build a qualified list of 10 <target customer>" -- identify, record,
     choose, record -- which correctly names no channel, and this gate then
     failed it for having none. generate-tasks fails closed on a concreteness
     failure, so a venture with complete, confirmed facts got NO task at all
     and the UI reported "couldn't reach the engine".
     The channel only has to be concrete when the task actually directs the
     founder to reach a person, so that is what is tested. Mentioning contact
     in passing is not enough: prospect-list steps legitimately say "record a
     contact route for each", and the outcome text may mention outreach as what
     the task unlocks later. */
  const instructsContact = (task?.steps || []).some((step) => (
    /^\s*(call|text|message|dm|email|visit|contact|reach out|speak|ask|interview|pitch|book)\b/i.test(String(step))
  ));
  if (needsChannel && instructsContact && !/\b(call|text|email|in person|visit)\b/i.test(haystack)) {
    reasons.push('no concrete outreach channel resolved into the task text');
  }
  if (offerText) {
    const fragment = offerText.trim().slice(0, 24).toLowerCase();
    if (fragment && !haystack.includes(fragment)) {
      reasons.push('the venture\'s actual offer is not referenced in the task text');
    }
  }
  if (!task?.proof_must_show || !String(task.proof_must_show).trim()) {
    reasons.push('no concrete proof requirement');
  }
  if (!Array.isArray(task?.good_proof_examples) || task.good_proof_examples.length === 0) {
    reasons.push('no evidence examples');
  }
  if (!Array.isArray(task?.steps) || task.steps.length === 0) {
    reasons.push('no execution steps');
  }
  return { valid: reasons.length === 0, reasons };
}

export {
  OUTREACH_SHAPED_ROUTES, CHANNEL_QUESTION, VALID_CHANNELS, CHANNEL_LABEL,
};
