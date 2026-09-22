/**
 * Deterministic Founder mission compiler. Internal identifiers remain in
 * structured reference fields only; user-visible copy uses safe, neutral
 * descriptions and never invents demand, commitments, customers, or dates.
 *
 * The `missionContext` parameter threaded through this file is the shared,
 * domain-neutral contract from decision-core/mission-context.js -- this
 * file is the only place that interprets its fields for Founder wording.
 * Founder's own resolver (task-quality-gate.js's
 * resolveFounderTaskContentFacts) is the only place that BUILDS one from
 * Founder facts (recorded channel, offer, target customer). Nothing here is
 * Founder-exclusive by contract -- another Goal Engine domain adopts this
 * same pattern by building its own MissionContext and passing it to its own
 * compiler, without touching this file.
 */

import { missionPhrase } from '../decision-core/mission-context.js';
import { unfinishedWorkItems, customerCount, hasPayingCustomers } from '../founder-bottleneck/signals.js';

const EVIDENCE_LABEL = Object.freeze({
  founder_customer_interview_set: ['A synthesis of repeated pain points, alternatives and urgency from every interview'],
  founder_sales_outreach_block: ['A booked, declined or no-response outcome for every contact'],
  founder_offer_test: ['An accepted, declined or objection response to the current offer'],
  founder_product_delivery_slice: ['Verification that every acceptance criterion was met'],
  founder_retention_analysis: ['The largest drop-off point and one chosen intervention'],
  founder_operating_process: ['Verification that the repaired process completes without the same failure'],
  founder_strategy_decision: ['The selected option, supporting evidence and next action'],
});

const MAX_BATCH_ITEMS = 3;

// Every entity-derived phrase below is read from a field the validator
// already REQUIRES to be a non-empty string whenever that entity/route is
// eligible at all (processName: entities.js's validateProcessEntityValue;
// decisionQuestion: validateStrategyDecisionEntityValue) -- so these are not
// "when available" degrades in the optional-field sense, they are always
// present for a route that was ever offered. unfinishedWorkItems/
// customerCount ARE genuinely optional snapshot fields and every use below
// falls back to the prior generic phrasing when absent.

function offerTestSteps(ids, entities, missionContext) {
  const verb = missionContext?.actionVerb;
  const offer = missionPhrase(missionContext?.subjectText, 90);
  const prospect = entities[0]?.value?.safeDisplayLabel || 'one reachable prospect';
  return [
    { order: 1, label: 'Confirm the current offer and selected customer segment', actionType: 'confirm_offer_and_segment', referenceId: ids.offerId },
    {
      order: 2,
      label: (verb
        ? `${verb} ${prospect} and present your offer${offer ? ` ("${offer}")` : ''}`
        : `Present the offer to ${prospect}`).slice(0, 200),
      actionType: 'present_offer',
      referenceId: ids.offerId,
    },
    { order: 3, label: 'Capture acceptance, rejection or objection', actionType: 'capture_offer_response', referenceId: ids.offerId },
    { order: 4, label: 'Record the offer-test response', actionType: 'record_offer_test_result', referenceId: ids.resultOutputId },
  ];
}

function productDeliverySteps(ids, snapshot) {
  const item = missionPhrase(unfinishedWorkItems(snapshot)[0], 140);
  return [
    {
      order: 1,
      label: (item ? `Confirm the acceptance criteria for: ${item}` : 'Confirm the next unfinished product slice and its acceptance criteria').slice(0, 200),
      actionType: 'identify_product_slice',
      referenceId: ids.productSliceId,
    },
    {
      order: 2,
      label: (item ? `Complete: ${item}` : 'Complete implementation of the slice').slice(0, 200),
      actionType: 'complete_delivery_implementation',
      referenceId: ids.productSliceId,
    },
    { order: 3, label: 'Verify every acceptance criterion', actionType: 'verify_acceptance_criteria', referenceId: ids.productSliceId },
    { order: 4, label: 'Mark the verified slice ready for delivery and record the result', actionType: 'record_delivery_result', referenceId: ids.deliveryOutputId },
    {
      order: 5,
      label: 'If any acceptance criterion fails, do not mark it delivered -- note exactly what is missing and revisit before shipping.',
      actionType: 'handle_incomplete_verification',
      referenceId: ids.deliveryOutputId,
    },
  ];
}

function retentionSteps(ids, snapshot) {
  const n = hasPayingCustomers(snapshot) ? customerCount(snapshot) : 0;
  const cohort = n > 0 ? `your current cohort of ${n} paying customer${n === 1 ? '' : 's'}` : 'the current retention cohort';
  return [
    { order: 1, label: `Inspect ${cohort}'s evidence`.slice(0, 200), actionType: 'inspect_retention_cohort_evidence', referenceId: ids.cohortId },
    { order: 2, label: 'Identify the largest material drop-off point', actionType: 'identify_material_drop_off', referenceId: ids.cohortId },
    { order: 3, label: 'Choose one intervention grounded in the evidence', actionType: 'select_intervention', referenceId: ids.cohortId },
    { order: 4, label: 'Record the analysis and chosen intervention', actionType: 'record_retention_decision', referenceId: ids.decisionOutputId },
    {
      order: 5,
      label: 'If the chosen intervention does not move the metric, record that outcome honestly and choose a different intervention next -- never repeat what already failed.',
      actionType: 'handle_intervention_outcome',
      referenceId: ids.decisionOutputId,
    },
  ];
}

function operatingProcessSteps(ids, entities) {
  const processName = missionPhrase(entities[0]?.value?.processName, 80);
  return [
    { order: 1, label: (processName ? `Inspect your ${processName} process` : 'Inspect the current operating process').slice(0, 200), actionType: 'inspect_current_process', referenceId: ids.processId },
    { order: 2, label: 'Identify the exact failure point', actionType: 'identify_failure_point', referenceId: ids.processId },
    { order: 3, label: (processName ? `Apply and verify the repair to your ${processName} process` : 'Apply and verify the repair').slice(0, 200), actionType: 'apply_process_repair', referenceId: ids.processId },
    { order: 4, label: 'Record the verified operational outcome', actionType: 'record_operational_outcome', referenceId: ids.verificationOutputId },
    {
      order: 5,
      label: 'If the repair does not hold under real use, do not mark it fixed -- record exactly how it failed and try a different repair.',
      actionType: 'handle_repair_failure',
      referenceId: ids.verificationOutputId,
    },
  ];
}

function strategyDecisionSteps(ids, entities) {
  const question = missionPhrase(entities[0]?.value?.decisionQuestion, 100);
  return [
    { order: 1, label: (question ? `Review the relevant evidence for: ${question}` : 'Review the relevant evidence for the open decision').slice(0, 200), actionType: 'review_relevant_evidence', referenceId: ids.decisionId },
    { order: 2, label: `Compare the ${ids.optionIds.length} confirmed options against the decision criteria`, actionType: 'compare_trusted_options', referenceId: ids.decisionId },
    { order: 3, label: 'Choose one option and note the assumptions and next action', actionType: 'select_strategy_route', referenceId: ids.decisionId },
    { order: 4, label: 'Record the decision and next action', actionType: 'record_strategy_decision', referenceId: ids.decisionOutputId },
    {
      order: 5,
      label: 'If new evidence contradicts the choice before you act on it, pause and re-decide -- never execute a decision you no longer believe.',
      actionType: 'handle_decision_reversal',
      referenceId: ids.decisionOutputId,
    },
  ];
}

function interviewBatchSteps(ids, entities, missionContext) {
  const verb = missionContext?.actionVerb || 'Interview';
  const items = entities.slice(0, MAX_BATCH_ITEMS).map((entity, index) => ({
    order: index + 1,
    label: `${verb} ${entity.value.safeDisplayLabel} and ask what problem they are trying to solve`.slice(0, 200),
    actionType: 'conduct_structured_interview',
    referenceId: entity.entityId,
  }));
  items.push({ order: items.length + 1, label: 'Synthesize findings against the current hypothesis', actionType: 'synthesize_interview_findings', referenceId: ids.resultOutputId });
  return items;
}

function outreachBatchSteps(ids, entities, missionContext) {
  const verb = missionContext?.actionVerb || 'Contact';
  const offer = missionPhrase(missionContext?.subjectText, 80);
  const items = entities.slice(0, MAX_BATCH_ITEMS).map((entity, index) => ({
    order: index + 1,
    label: (offer
      ? `${verb} ${entity.value.safeDisplayLabel} and present your offer ("${offer}")`
      : `${verb} ${entity.value.safeDisplayLabel} and present the current offer`).slice(0, 200),
    actionType: 'contact_and_record_outcome',
    referenceId: entity.entityId,
  }));
  items.push({
    order: items.length + 1,
    label: 'Ask for a clear yes, no, or objection, and record their exact words',
    actionType: 'record_batch_result',
    referenceId: ids.resultOutputId,
  });
  return items;
}

// A prospect who has already responded and asked for something specific
// (proof/pricing/proposal/meeting) needs that thing created and delivered --
// not another first contact. One create+send pair per named prospect, never
// invented for a request type the entity does not actually carry.
const REQUEST_ACTION_LABEL = Object.freeze({
  proof: 'Create a personalised proof of your work',
  pricing: 'Prepare clear, specific pricing',
  proposal: 'Prepare a written proposal',
  meeting: 'Confirm meeting logistics',
});

function hasPendingRequest(entities) {
  return entities.some((entity) => Boolean(entity.value.pendingRequest));
}

function followUpDeliverySteps(ids, entities) {
  const items = [];
  for (const entity of entities.slice(0, MAX_BATCH_ITEMS)) {
    const actionLabel = REQUEST_ACTION_LABEL[entity.value.pendingRequest] || 'Prepare the specific requested follow-up';
    items.push({
      order: items.length + 1,
      label: `${actionLabel} for ${entity.value.safeDisplayLabel}, addressing exactly what they asked for`,
      actionType: 'create_requested_followup_asset',
      referenceId: entity.entityId,
    });
    items.push({
      order: items.length + 1,
      label: `Send it to ${entity.value.safeDisplayLabel} with a clear invitation to take the next step`,
      actionType: 'send_requested_followup',
      referenceId: entity.entityId,
    });
  }
  items.push({ order: items.length + 1, label: 'Record the outcome of every follow-up sent', actionType: 'record_followup_outcome', referenceId: ids.resultOutputId });
  return items;
}

export function buildSteps(routeId, identifierFields, reachableEntities, missionContext, snapshot) {
  switch (routeId) {
    case 'founder_offer_test': return offerTestSteps(identifierFields, reachableEntities, missionContext);
    case 'founder_product_delivery_slice': return productDeliverySteps(identifierFields, snapshot);
    case 'founder_retention_analysis': return retentionSteps(identifierFields, snapshot);
    case 'founder_operating_process': return operatingProcessSteps(identifierFields, reachableEntities);
    case 'founder_strategy_decision': return strategyDecisionSteps(identifierFields, reachableEntities);
    case 'founder_customer_interview_set': return interviewBatchSteps(identifierFields, reachableEntities, missionContext);
    case 'founder_sales_outreach_block':
      return hasPendingRequest(reachableEntities)
        ? followUpDeliverySteps(identifierFields, reachableEntities)
        : outreachBatchSteps(identifierFields, reachableEntities, missionContext);
    default: return [];
  }
}

function ventureNoun(snapshot) {
  return snapshot.identity?.ventureName || 'The venture';
}

/* ── Real-fact mission context ──────────────────────────────────────────
   The batch routes below previously ignored the venture's real facts
   entirely and emitted "Contact N reachable prospects with the current
   offer" -- an instruction that names no channel, no offer and no target,
   so a founder still has to decide what to actually do. The pending-request
   path in this same file already demonstrates the right standard ("Create
   and send the requested proof to <named prospect> today"), so the routes
   below bring the generic path up to it using ONLY missionContext fields --
   never a fabricated value. missionContext itself may be null (no domain
   facts resolved yet), and every field on it may independently be null; in
   every such case the wording degrades to the previous generic phrasing
   rather than inventing anything.

   `target` (missionContext.targetLabel) is deliberately used ONLY inside
   full sentences below, never spliced into a cardinal-number noun slot like
   "Call 1 <target>" -- target is normally a plural descriptive phrase
   ("Local business owners"), and "1 Local business owners" does not agree
   grammatically. "N reachable prospects" is always safe there. */

const targetPhrase = (missionContext, max = 60) => missionPhrase(missionContext?.targetLabel, max);

/* ── Naming the real businesses ────────────────────────────────────────
   Every entity-based route already puts real business names in its STEPS
   (buildSteps below uses safeDisplayLabel), but the titles said
   "2 reachable prospects" -- discarding names the engine was already
   holding, in the one line the founder reads first.
   This is deliberately ONE shared helper used by every entity-based route
   rather than a fix to a single builder, so a route added later inherits
   the same behaviour instead of quietly reverting to a count.

   Two rules make it safe to apply everywhere:

   1. NEVER name a generated placeholder. When a founder reports a COUNT
      ("I have 4 prospects") rather than names, extract.js writes
      safeDisplayLabel as "Reachable prospect 1"/"Listed prospect 2"
      itself (extract.js:641,650 -- `${label} ${i}`). Putting those in a
      title gives "Visit Reachable prospect 1, Reachable prospect 2", which
      is worse than the count it replaced. Matching that pattern is
      recognising a string THIS system wrote, not guessing at user data.

      The same rule has to cover a label that is EXACTLY a bare role noun
      ("Prospect", "Lead", "Customer", "Contact", singular or plural, with
      or without the reachable/listed prefix or a trailing index). Such a
      label names a CATEGORY, not a company, so "Interview Prospect to
      validate the core problem" fails rule 1's actual test -- it reads as a
      bug rather than as a summary -- even though this system did not write
      it. The match stays fully anchored, so it only ever fires on a label
      that is nothing but the bare noun: real names keep flowing through,
      including ones that merely start with it ("Prospect Medical Holdings")
      or contain it ("Bright Prospect Dental").
   2. NEVER truncate a business name. Titles are capped at 120 BYTES by the
      database, and "Visit Raine & Horne Dub…" is worse than an honest
      count. So names are used only when the finished title genuinely fits;
      otherwise the count phrasing stands. */
const GENERATED_PROSPECT_LABEL = /^(?:reachable |listed )?(?:prospect|lead|customer|contact)s?(?: \d+)?$/i;
const TITLE_BYTE_CAP = 116;

function titleByteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).length;
}

/** Real, founder-meaningful names for the batch, or null when any of them is
 * one of VISION's own generated placeholders. All-or-nothing on purpose: a
 * half-named batch ("Raine & Horne Dubbo and 2 reachable prospects") reads as
 * a bug rather than a summary. */
function realEntityNames(entities, limit = MAX_BATCH_ITEMS) {
  const batch = (entities || []).slice(0, limit);
  if (batch.length === 0) return null;
  const labels = batch.map((entity) => String(entity?.value?.safeDisplayLabel || '').trim());
  if (labels.some((label) => !label || GENERATED_PROSPECT_LABEL.test(label))) return null;
  return labels;
}

function joinNames(labels) {
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** The subject phrase for a title: the real names when they fit inside the
 * byte cap once the surrounding words are counted, else the safe count. */
function titleSubject(entities, countPhrase, lead = '', tail = '') {
  const labels = realEntityNames(entities);
  if (!labels) return countPhrase;
  const named = joinNames(labels);
  return titleByteLength(`${lead}${named}${tail}`) <= TITLE_BYTE_CAP ? named : countPhrase;
}

/** The same names for a sentence body, where the byte budget is far larger
 * (missionStatement becomes `why`, capped at 500 bytes, not 120). */
function statementSubject(entities, countPhrase) {
  const labels = realEntityNames(entities);
  return labels ? joinNames(labels) : countPhrase;
}


const NARRATIVE_BUILDERS = Object.freeze({
  founder_offer_test(_ids, snapshot, entities, missionContext) {
    const verb = missionContext?.actionVerb;
    const offer = missionPhrase(missionContext?.subjectText, 90);
    /* Same rule as the batch routes: a generated "Reachable prospect 1"
       label must not be presented as a business name. */
    const prospect = statementSubject(entities.slice(0, 1), 'one reachable prospect');
    return {
      title: verb ? `${verb} ${prospect} to test your offer today` : 'Test the current offer with one reachable prospect today',
      // verb's fallback is a bare meeting verb ('Meet with'), never a
      // second "present the offer" clause -- that previously duplicated
      // with the unconditional "and present ... offer" clause below
      // whenever no channel was known ("Present the current offer to X and
      // present the current offer, ask...").
      missionStatement: `${verb ? `${verb} ${prospect}` : `Meet with ${prospect}`} and present ${offer ? `your offer ("${offer}")` : 'the current offer'}, ask for a clear commitment, rejection or objection, then record the response.`,
      expectedBusinessOutcome: `A real willingness-to-pay signal for ${ventureNoun(snapshot)}'s current offer.`,
      completionDefinition: 'The response is recorded with an explicit accepted, declined or objection outcome.',
    };
  },
  founder_product_delivery_slice(_ids, snapshot) {
    const item = missionPhrase(unfinishedWorkItems(snapshot)[0], 90);
    return {
      title: item ? `Complete and verify: ${item}` : 'Complete and verify the next unfinished product slice',
      missionStatement: item
        ? `Complete "${item}", verify every acceptance criterion, and mark the result ready for delivery.`
        : 'Complete the next unfinished product slice, verify every acceptance criterion, and mark the result ready for delivery.',
      expectedBusinessOutcome: `${ventureNoun(snapshot)} has one more verified, usable implementation unit ready to deliver.`,
      completionDefinition: 'Every listed acceptance criterion is verified and the delivery result is recorded.',
    };
  },
  founder_retention_analysis(_ids, snapshot) {
    const n = hasPayingCustomers(snapshot) ? customerCount(snapshot) : 0;
    const cohort = n > 0 ? `your current cohort of ${n} paying customer${n === 1 ? '' : 's'}` : 'the current customer cohort';
    return {
      title: 'Analyse the current retention cohort and choose one intervention',
      missionStatement: `Review ${cohort}, identify the largest drop-off point, and choose one intervention to test.`,
      expectedBusinessOutcome: `${ventureNoun(snapshot)} converts the current retention evidence into one bounded next action.`,
      completionDefinition: 'The largest drop-off and one evidence-grounded intervention are recorded.',
    };
  },
  founder_operating_process(_ids, snapshot, entities) {
    // Sized for this title's own overhead ("Repair the confirmed failure in
    // your " + X + " process" = 46 fixed chars) against the DB's real
    // 120-byte title cap -- unlike processName's use in buildSteps below,
    // which has the 200-byte step cap's much larger margin and keeps 80.
    const processName = missionPhrase(entities[0]?.value?.processName, 55);
    return {
      title: processName ? `Repair the confirmed failure in your ${processName} process` : 'Repair the confirmed failure in the current operating process',
      missionStatement: processName
        ? `Repair the confirmed failure point in your ${processName} process and verify it completes without the same failure.`
        : 'Repair the confirmed failure point in the current operating process and verify the process completes without the same failure.',
      expectedBusinessOutcome: `${ventureNoun(snapshot)} removes a confirmed operational failure that is blocking reliable execution.`,
      completionDefinition: 'The repaired process completes without the identified failure and the outcome is recorded.',
    };
  },
  founder_strategy_decision(ids, snapshot, entities) {
    const question = missionPhrase(entities[0]?.value?.decisionQuestion, 100);
    return {
      title: question ? `Resolve: ${question}` : 'Resolve the open strategic decision',
      missionStatement: `Compare the ${ids.optionIds.length} confirmed options for${question ? ` "${question}"` : ' the open decision'}, choose one using the available evidence, and record the next action.`,
      expectedBusinessOutcome: `${ventureNoun(snapshot)} is no longer blocked by the open strategic question.`,
      completionDefinition: 'The selected option, supporting evidence, assumptions and next action are recorded.',
    };
  },
  founder_customer_interview_set(_ids, snapshot, entities, missionContext) {
    const n = Math.min(entities.length, MAX_BATCH_ITEMS);
    const plural = n === 1 ? '' : 's';
    const verb = missionContext?.actionVerb;
    const target = targetPhrase(missionContext);
    // Title carries the concrete channel; count stays with the always-safe
    // "reachable prospect(s)" noun, never the (plural) target descriptor.
    const lead = verb ? `${verb} ` : 'Interview ';
    const tail = ' to validate the core problem';
    const countPhrase = `${n} reachable prospect${plural}`;
    const subject = titleSubject(entities, countPhrase, lead, tail);
    const named = statementSubject(entities, countPhrase);
    const isNamed = named !== countPhrase;
    return {
      title: `${lead}${subject}${tail}`,
      /* When the businesses are named they already identify who this is
         about, so the "from <target customer>" qualifier is dropped -- it
         would read "Interview Raine & Horne Dubbo from Small local
         businesses in Dubbo", describing a named business as a category. */
      missionStatement: `${lead}${named}${!isNamed && target ? ` from ${target}` : ''} about the problem they face, then record repeated pain points, current alternatives and urgency.`,
      expectedBusinessOutcome: `${ventureNoun(snapshot)} gains first-party customer evidence on the current hypothesis.`,
      completionDefinition: 'A synthesis covering every interview is recorded, including repeated pain points, alternatives and urgency.',
    };
  },
  founder_sales_outreach_block(_ids, snapshot, entities, missionContext) {
    if (hasPendingRequest(entities)) {
      const named = entities.slice(0, MAX_BATCH_ITEMS).map((entity) => entity.value.safeDisplayLabel).join(', ');
      const requestNoun = entities[0].value.pendingRequest;
      return {
        title: `Create and send the requested ${requestNoun} to ${named} today`,
        missionStatement: `${named} already responded and is waiting on ${requestNoun} before they will proceed. Create it, address exactly what they asked for, and send it with a clear invitation to take the next step.`,
        expectedBusinessOutcome: `${ventureNoun(snapshot)} advances ${named} to the next real step in the sales process -- a response, a booked meeting, or specific feedback -- not a guaranteed sale.`,
        completionDefinition: `The ${requestNoun} is created, addresses ${named}'s specific request, is sent to the correct prospect with a clear next step, and the send is recorded.`,
      };
    }
    const n = Math.min(entities.length, MAX_BATCH_ITEMS);
    const plural = n === 1 ? '' : 's';
    const verb = missionContext?.actionVerb;
    const target = targetPhrase(missionContext);
    const offer = missionPhrase(missionContext?.subjectText, 90);
    const outreachLead = verb ? `${verb} ` : 'Contact ';
    const outreachTail = verb ? ' and present your offer' : ' with the current offer';
    const outreachCount = `${n} reachable prospect${plural}`;
    const outreachSubject = titleSubject(entities, outreachCount, outreachLead, outreachTail);
    const outreachNamed = statementSubject(entities, outreachCount);
    const outreachIsNamed = outreachNamed !== outreachCount;
    return {
      title: `${outreachLead}${outreachSubject}${outreachTail}`,
      missionStatement: `${outreachLead}${outreachNamed}${!outreachIsNamed && target ? ` from ${target}` : ''} and present ${offer ? `your offer ("${offer}")` : 'the current offer'}, then record whether each booked, declined or did not respond.`,
      expectedBusinessOutcome: `${ventureNoun(snapshot)} gains a recorded commitment or evidenced no from each attempted contact.`,
      completionDefinition: 'An outcome is recorded for every contact attempted.',
    };
  },
});

export function composeMissionNarrative(routeId, identifierFields, snapshot, entities, bottleneckLabel, missionContext) {
  const built = NARRATIVE_BUILDERS[routeId](identifierFields, snapshot, entities, missionContext);
  return {
    ...built,
    /* Universal, route-independent safety net -- each builder above sizes
       its own real-data truncation budget against this title's 120-byte DB
       cap, but a second guarantee here means a future route (or a wider
       real fact than anticipated) fails safe with a clean ellipsis instead
       of a hard 'invalid_task:invalid_title' at persistence, the same
       failure class the original 'invalid_step' incident belonged to. 116,
       not 120: missionPhrase's trailing "…" costs 3 UTF-8 bytes for 1
       truncated character, so 116 leaves headroom for that under the
       120-byte cap even in the worst case. */
    title: missionPhrase(built.title, 116) || built.title,
    whyNow: `This is the best-supported available action for the current ${bottleneckLabel} constraint, based on the trusted evidence on record.`,
  };
}

const FOLLOWUP_EVIDENCE_LABEL = Object.freeze([
  'The final proof/pricing/proposal asset actually created (a file or accessible link)',
  'Evidence it was sent to the correct prospect (message text or communication record)',
  'The related persisted lead/prospect entity id',
]);

export function requiredEvidenceFor(routeId, entities = []) {
  if (routeId === 'founder_sales_outreach_block' && hasPendingRequest(entities)) return FOLLOWUP_EVIDENCE_LABEL;
  return EVIDENCE_LABEL[routeId] || [];
}

// A locked Professional Standard: the fixed, deterministic quality bar this
// route's output must meet, adapted to a real prospect's stated request
// rather than a generic checklist. New for the specific move, never a
// carry-over of the prior (e.g. cold-call) task's standard -- callers that
// version Today's Move are expected to keep the OLD standard attached to the
// OLD task version in their own history, not overwrite it in place.
const PROFESSIONAL_STANDARD_LABEL = Object.freeze({
  founder_customer_interview_set: ['Ask open questions, do not lead the answer', 'Capture the exact pain point in the prospect\'s own words', 'Record alternatives and urgency, not just interest'],
  founder_sales_outreach_block: ['Reference the offer accurately', 'Ask for a clear yes, no, or objection', 'Record the exact outcome, not an impression'],
  founder_offer_test: ['State the price and what it includes plainly', 'Ask for a real commitment, not a hypothetical opinion', 'Record acceptance, rejection or objection verbatim'],
  founder_product_delivery_slice: ['Meet every stated acceptance criterion', 'Verify before marking complete', 'Do not expand scope beyond the defined slice'],
  founder_retention_analysis: ['Base the drop-off point on real cohort data', 'Choose one intervention, not a list of options', 'State the evidence for the chosen intervention'],
  founder_operating_process: ['Fix the confirmed failure point specifically', 'Verify the process completes without the same failure', 'Do not redesign the whole process beyond the fix'],
  founder_strategy_decision: ['Compare the real recorded options only', 'Ground the choice in available evidence', 'State the next action the decision implies'],
});
const FOLLOWUP_STANDARD_LABEL = Object.freeze([
  'Directly relevant to this exact business, not a generic template',
  'Demonstrates understanding of what they specifically asked for',
  'Sufficient quality to establish credibility, not a rough draft',
  'Focused in scope -- addresses the request, not a full unrelated pitch',
  'States the value clearly',
  'Ends with one clear next step (e.g. book a call)',
  'Sent the same day the request was made',
]);

export function professionalStandardFor(routeId, entities = []) {
  if (routeId === 'founder_sales_outreach_block' && hasPendingRequest(entities)) return FOLLOWUP_STANDARD_LABEL;
  return PROFESSIONAL_STANDARD_LABEL[routeId] || [];
}

// Learning support surfaces at most ONE focused resource, and only when the
// move asks for a skill most founders have not already demonstrated (spec:
// never attach generic learning merely to fill a card). Today this fires
// only for the follow-up-delivery case, which is the one concrete "needs
// help" scenario in scope; every other canonical route intentionally
// returns null rather than a fabricated generic tip.
const FOLLOWUP_LEARNING_SUPPORT = Object.freeze({
  proof: 'The smallest credible proof is a real, personalised sample of the actual deliverable -- not a generic portfolio piece. Show them their own homepage/product, not someone else\'s.',
  pricing: 'Lead with the value the price buys, then the number -- state it plainly and do not apologise for it.',
  proposal: 'Keep it to one page: the problem in their words, what you will do, and the price. A long proposal reads as less confident, not more thorough.',
  meeting: 'Propose two concrete times rather than asking "when works for you?" -- it is easier to say yes to a specific slot.',
});

export function learningSupportFor(routeId, entities = []) {
  if (routeId === 'founder_sales_outreach_block' && hasPendingRequest(entities)) {
    return FOLLOWUP_LEARNING_SUPPORT[entities[0].value.pendingRequest] || null;
  }
  return null;
}
