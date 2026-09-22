/* ════════════════════════════════════════════════════════════════════════
   LEADS BOARD — the whole page, deterministically, for zero model calls
   ────────────────────────────────────────────────────────────────────────
   Opening Leads must never generate language. A founder with a hundred saved
   prospects would otherwise pay for a hundred syntheses every time they
   glanced at their own list, and would wait minutes to see a list they
   already own.

   So the board is built entirely from things code already knows: the durable
   ranking artifact, the structured evidence, canonical Founder State, and the
   deterministic selection and next-action logic that L1 owns. Language for a
   single prospect is generated later, once, when that prospect is opened —
   and cached after that.

   FOUNDER STATE IS BUILT ONCE. It is identical for every lead in the venture,
   and rebuilding it per lead turned an O(1) read into O(N) work for no
   difference in output.

   ORDERING IS CODE-OWNED. No model is asked which lead matters most; that is
   a decision with a defensible answer, and a decision with a defensible
   answer does not go to a model.
   ════════════════════════════════════════════════════════════════════════ */

import { buildProspectContext } from './prospect-context.js';
import { buildSelectionRationale, decideNextBestAction, deterministicLanguage } from './prospect-intelligence.js';
import { toLeadViewModel } from './workspace-view-model.js';
import {
  founderStateFromLedger, prospectFromPersistedLead, deriveLeadType, pipelineStageFor,
} from './prospect-runtime.js';
import { LEAD_QUALIFICATION_THRESHOLD } from './ranking.js';
import { isRefusalAction } from './prospect-intelligence-contract.js';
import { assessPriority, PRIORITY_BAND_TO_LEGACY, OFFER_GAP_KINDS, reconcileActionWithPriority } from './priority-intelligence.js';

/* Band order on the Qualified surface, strongest first. Mirrors the locked
   frontend's four bands exactly. */
const BAND_RANK = Object.freeze({ now: 0, strong: 1, watch: 2, no: 3 });

/* Within a band, how soon the action wants attention. */
const URGENCY_RANK = Object.freeze({
  within_the_hour: 0, this_week: 1, before_contact: 2, not_now: 3,
});

/* Actions that are refusals — a workspace for one of these would be an
   approach VISION is telling the founder not to make. The set itself lives
   in prospect-intelligence-contract.js; re-exported below for the callers
   that already import it from here. */

/* Durable states that mean the prospect has entered the pipeline rather than
   still being a discovery result. */
const PIPELINE_STATES = new Set([
  'contacted', 'no_response', 'interested', 'not_interested',
  'follow_up_needed', 'meeting_booked', 'converted', 'lost',
]);

/**
 * Everything the Leads page needs, with no model involved.
 *
 * @param {object[]} params.leads reloaded opportunities (loadVentureLeads)
 * @param {object[]} params.facts active canonical Founder ledger rows
 */
export function buildLeadsBoard({
  leads = [], facts = [], ventureId, ventureName = null, now = new Date().toISOString(),
}) {
  /* ONCE. See the header. */
  const ventureState = founderStateFromLedger(facts, { ventureId, ventureName });
  /* Read ONCE for the whole venture, like Founder State above: it is the
     same declaration for every lead, and re-reading it per row would turn
     an O(1) lookup into O(N) for an identical answer. */
  const offerAddresses = offerAddressesFromFacts(facts);

  const rows = leads.map((lead) => buildBoardRow({ lead, ventureState, now, offerAddresses }))
    .filter(Boolean)
    .sort(compareBoardRows);

  const actionable = rows.filter((row) => row.workspaceAvailable);

  return {
    venture: {
      id: ventureId,
      name: ventureState.businessName,
      targetCustomer: ventureState.targetCustomer,
      offerConfirmed: ventureState.offerConfirmed,
      /* The board needs to know whether an offer exists, not what it says —
         the offer text belongs in a workspace, not in a list payload. */
      currentObjective: ventureState.currentObjective,
    },
    /* The dominant Next Move is simply the first actionable row in the
       deterministic order. There is no separate ranking for it, because a
       second ranking is a second thing that can disagree. */
    nextMove: actionable.length > 0 ? nextMoveFrom(actionable[0]) : null,
    funnel: buildFunnel(rows),
    tabs: {
      discover: rows.filter((row) => row.surfaces.discover).map((row) => row.id),
      qualified: rows.filter((row) => row.surfaces.qualified).map((row) => row.id),
      pipeline: rows.filter((row) => row.surfaces.pipeline).map((row) => row.id),
    },
    leads: rows,
    counts: {
      total: rows.length,
      qualified: rows.filter((row) => row.surfaces.qualified).length,
      actionable: actionable.length,
      pipeline: rows.filter((row) => row.surfaces.pipeline).length,
    },
    /* Honest, and load-bearing for the empty state: nothing here was searched
       for, because no discovery provider is connected yet. */
    discovery: { providerConnected: false, lastSearchAt: null },
    generatedAt: now,
    modelCalled: false,
  };
}

/* ── WHICH GAPS THIS FOUNDER'S OFFER CLOSES ────────────────────────────
   Read as a DECLARATION from the canonical ledger, never parsed out of the
   offer's prose. Anything that is not a recognised gap kind is dropped
   rather than guessed at, and an absent declaration yields [] -- which
   priority-intelligence.js reads as "need is unknown", not as "no need".

   WHY IT IS A FACT AND NOT AN INFERENCE. "Do they need what I sell" cannot
   be answered without knowing what the founder sells FIXES, and that is
   knowledge only the founder has. Deriving it from the offer sentence would
   be exactly the regex-on-prose scoring this engine already removed once. */
export function offerAddressesFromFacts(facts = []) {
  const fact = (facts || []).find((f) => f && f.active !== false && f.factKey === 'offerAddresses');
  const value = Array.isArray(fact?.value) ? fact.value : null;
  if (!value) return [];
  return value.filter((gap) => OFFER_GAP_KINDS.includes(gap));
}

function buildBoardRow({ lead, ventureState, now, offerAddresses }) {
  if (!lead || !lead.id) return null;

  const leadType = deriveLeadType(lead.signals || []);
  const prospect = prospectFromPersistedLead(lead, { leadType });
  const ranking = lead.ranking || null;

  /* The same deterministic pipeline the workspace uses, minus the model. A
     board row and an opened workspace can therefore never disagree about the
     action, the band or whether contact is permitted. */
  const context = buildProspectContext({ prospect, ventureState, ranking, eligibility: null, leadType, now });
  const selection = buildSelectionRationale({ context, ranking });
  const rawDecision = decideNextBestAction({ context, ranking, eligibility: null });

  /* ── ONE ANSWER, NOT TWO ────────────────────────────────────────────
     Two authorities describe the same prospect and, until this line, were
     never reconciled. The action engine reads reachability: a business with
     a published phone is "call this week". Priority Intelligence reads the
     PAIR (prospect, offer): a business that already has online booking is
     `not_worth_time` to a founder who sells booking funnels.

     Both were right about their own question, and the board printed both —
     so a prospect labelled "Not worth your time" arrived carrying "Call this
     week", an openable Workspace and a finished call script, and was counted
     in `counts.actionable`. A founder with thirty minutes was being offered
     the one business VISION had just judged not worth them.

     The band wins, because it is the only one of the two that knows what the
     founder actually sells. `observe_only` is an existing REFUSAL_ACTION, so
     workspaceAvailable, the actionable count and the Workspace refusal note
     all follow from this single change rather than from four parallel ones.

     Deliberately narrow: it fires only when the offer scope is DECLARED and
     need is not UNKNOWN — the same condition that lets the band override at
     all. An undeclared offer changes nothing, because then VISION does not
     know enough to overrule reachability. */
  const priority = assessPriority({
    signals: lead.signals || [], offerAddresses, now,
    consent: context.contactability?.consent || null,
    priorContactChecked: lead.priorContactChecked,
    alreadyContacted: (lead.contactHistory || []).length > 0,
    previouslyRejected: lead.state === 'rejected',
  });
  const priorityDecides = offerAddresses.length > 0 && priority.factors.need.evidenceStatus !== 'UNKNOWN';
  const decision = reconcileActionWithPriority({
    decision: rawDecision, priority, priorityDecides, isRefusal: isRefusalAction,
  });

  /* Deterministic language, for the preview only. This is the plain, always-
     true copy — never a model call, and never presented as the finished
     workspace. */
  const language = deterministicLanguage({ context, selection, decision });

  const record = {
    contractVersion: 1,
    leadId: lead.id,
    ventureId: ventureState.ventureId,
    generatedAt: now,
    leadType,
    identity: {
      name: context.prospect.name || null,
      category: context.prospect.category || null,
      location: context.prospect.location || null,
    },
    lifecycleStage: context.lifecycle.stage,
    isLead: context.lifecycle.isLead,
    confidence: confidenceOf(context, ranking),
    presentationGrade: null,
    qualification: {
      opportunityScore: Number.isFinite(ranking?.dimensions?.opportunityScore) ? ranking.dimensions.opportunityScore : null,
      qualified: ranking?.qualified === true,
      threshold: LEAD_QUALIFICATION_THRESHOLD,
      source: 'ranking',
    },
    contactability: context.contactability,
    freshness: context.freshness,
    pipelineStage: pipelineStageFor(lead),
    selection: {
      whyChosen: selection.whyChosen,
      whyNow: selection.whyNow,
      reasons: selection.reasons,
      strongestEvidenceRefs: selection.strongestEvidenceRefs,
      importantUnknowns: selection.importantUnknowns,
      relativePriorityReason: selection.relativePriorityReason,
    },
    workspace: {
      whyThisProspect: language.whyThisProspect,
      strengths: language.strengths,
      weaknesses: language.weaknesses,
      offerFit: language.offerFit,
      signalTimeline: context.timeline,
      nextBestAction: decision,
      whatToSay: language.whatToSay,
      objections: [],
      callStructure: [],
      outreach: language.outreach,
    },
    provenance: { synthesis: 'deterministic', repairAttempted: false, rejectedViolations: [] },
  };

  const view = toLeadViewModel(record, { now });

  /* THE BOARD SHIPS NO WORKSPACE. Sending a deterministic workspace for every
     lead would triple the payload and, worse, would show plain fallback copy
     in a surface the founder reasonably reads as the finished article. The
     workspace is fetched per prospect, on open. */
  delete view.ws;
  delete view.wsNote;

  const qualified = record.qualification.qualified === true;
  const inPipeline = PIPELINE_STATES.has(lead.state) || (lead.contactHistory || []).length > 0;

  /* ── "WORTH MY TIME?", asked separately from "valid lead?" ──────────
     Qualification (above) decided whether this is a real, reachable
     business of the right type. This decides whether it is worth THIS
     founder's next hour, which is a question about the PAIR (prospect,
     offer) and cannot be answered by any property of the prospect alone.

     IT ONLY OVERRIDES THE BAND WHEN THE OFFER SCOPE IS DECLARED. Without
     that declaration need is honestly UNKNOWN, and letting an unknown
     collapse every lead into `watch` would be worse than the action-derived
     banding that shipped before -- it would replace a partial answer with
     no answer. So: declared -> real offer-relative bands; undeclared ->
     exactly today's behaviour, plus a stated reason the founder can act on. */
  const band = priorityDecides ? PRIORITY_BAND_TO_LEGACY[priority.band] : view.band;

  return {
    ...view,
    band,
    priority: {
      band: priority.band, decides: priorityDecides, because: priority.because,
      withinBand: priority.withinBand, factors: priority.factors, reasons: priority.reasons,
    },
    /* THE DECIDED ACTION, AS A KEY. `next.action` is the display LABEL — "Find
       a contact route" — which is the right thing to render and the wrong
       thing to branch on. A server gate that read it got undefined and
       silently never fired; caught while wiring the decision-maker action,
       whose do_not_contact / observe_only refusal depends on it. Exposed
       beside the label so a consumer never has to reverse-engineer one from
       the other. */
    actionKey: decision.action,
    /* Only a lead the founder may actually act on gets an openable workspace.
       A refusal is shown on the row itself with its reason. */
    workspaceAvailable: !isRefusalAction(decision.action),
    surfaces: {
      /* Discovery results are prospects that have not entered the pipeline. */
      discover: !inPipeline,
      /* Qualified means the CANONICAL ranking qualified it. A row cannot reach
         this surface by having a friendly action or a nice thesis. */
      qualified,
      pipeline: inPipeline,
    },
    /* Sort keys, exposed so ordering is inspectable rather than mysterious. */
    order: {
      bandRank: BAND_RANK[band] ?? 9,
      urgencyRank: URGENCY_RANK[decision.urgency] ?? 9,
      /* Within a band, order by worth-my-time when that was actually
         computed; by the qualification score otherwise. Never across bands
         -- the gates own that, so a high score can never lift a prospect
         out of "not worth time". */
      score: priorityDecides ? priority.withinBand : (record.qualification.opportunityScore ?? -1),
    },
    /* The opener preview the Next Move strip shows. Deterministic, therefore
       free, and replaced by the real one when the workspace opens. */
    openerPreview: language.whatToSay.opening || null,
  };
}

/** Deterministic and total: two runs over the same data can never disagree. */
export function compareBoardRows(a, b) {
  return (a.order.bandRank - b.order.bandRank)
    || (a.order.urgencyRank - b.order.urgencyRank)
    || (b.order.score - a.order.score)
    /* Stable final tie-break on the id, which is unique — so no pair of rows
       is ever left in an arbitrary order. */
    || String(a.id).localeCompare(String(b.id));
}

function nextMoveFrom(row) {
  return {
    leadId: row.id,
    name: row.name,
    sub: row.sub,
    temp: row.temp,
    action: row.next.action,
    channel: row.next.channel,
    urgency: row.next.urgency,
    why: row.next.why,
    thesis: row.thesis,
    age: row.age,
    /* WHAT TO SAY, in preview form. The board answers all four questions
       without generating anything. */
    openerPreview: row.openerPreview,
  };
}

/** Counts by lifecycle stage, with the lead line marked. */
function buildFunnel(rows) {
  const order = ['anonymous', 'engaged', 'lead', 'qualified', 'hot', 'customer'];
  const labels = { anonymous: 'Anonymous', engaged: 'Engaged', lead: 'Lead', qualified: 'Qualified', hot: 'Hot', customer: 'Customer' };
  const isLead = { anonymous: false, engaged: false, lead: true, qualified: true, hot: true, customer: true };
  const counts = Object.fromEntries(order.map((key) => [key, 0]));
  for (const row of rows) if (counts[row.temp] !== undefined) counts[row.temp] += 1;
  return order.map((key) => ({ key, label: labels[key], value: counts[key], isLead: isLead[key] }));
}

/** Same shape as the workspace's confidence: the strength of what was
 * observed, reduced when the file is stale or unqualified. */
function confidenceOf(context, ranking) {
  const observed = context.evidence.observed || [];
  if (!observed.length) return 0;
  const mean = observed.reduce((total, signal) => total + (Number.isFinite(signal.confidence) ? signal.confidence : 0), 0) / observed.length;
  const fresh = context.freshness.fresh ? 1 : 0.5;
  const qualified = ranking?.qualified === true ? 1 : 0.7;
  return Math.max(0, Math.min(1, Number((mean * fresh * qualified).toFixed(2))));
}

/* REFUSAL_ACTIONS is deliberately NOT re-exported here. It used to be a Set on
   this object; consolidating made it a frozen Array, and an exported field
   whose type quietly inverts is worse than one that is gone — a caller writing
   `.has(action)` would get a TypeError instead of a rename error. Import it,
   or isRefusalAction(), from prospect-intelligence-contract.js. */
export const LEADS_BOARD_INTERNALS = Object.freeze({
  BAND_RANK, URGENCY_RANK, PIPELINE_STATES, buildFunnel, confidenceOf,
});
