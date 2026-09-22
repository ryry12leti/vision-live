/* ════════════════════════════════════════════════════════════════════════
   LEADS VIEW MODEL — canonical Prospect Intelligence → the locked frontend
   ────────────────────────────────────────────────────────────────────────
   The frontend (leads.html / js/leads-mock.js, locked at 8d68fd0) knows about
   leads. It does not know about Google Places candidates, signal kinds,
   ranking dimensions, eligibility reason codes or database rows, and it must
   not learn: the moment a provider-shaped object reaches a template, changing
   provider means changing the UI.

   This is the only place the two vocabularies meet.

   WHAT IT REFUSES TO DO
   The fixtures carry an A+/A/B grade. There is no canonical backend mapping
   onto those letters and this adapter does not invent one — `grade` comes
   through as null. A grade is a claim about where a lead sits in a
   distribution, and we have no distribution until providers are connected.
   Filling the field with a plausible letter now would be indistinguishable, to
   every later reader, from a real one.
   ════════════════════════════════════════════════════════════════════════ */

import { NEXT_ACTIONS, isRefusalAction } from './prospect-intelligence-contract.js';

/* Frontend temperature vocabulary (js/leads-mock.js HIERARCHY). Maps from the
   canonical lifecycle stage, which is the only source of it. */
const STAGE_TO_TEMP = Object.freeze({
  anonymous: 'anonymous',
  engaged: 'engaged',
  lead: 'lead',
  qualified_lead: 'qualified',
  hot_lead: 'hot',
  customer: 'customer',
});

/* Which band a lead lands in on the Qualified tab. Driven by the ACTION, not
   by a score: the bands answer "what deserves your time today", and that is
   what an action already is. */
/* L5B — the ONE place a contact selection becomes something the frontend
   renders. Exported because the Workspace is served by two paths (the pure
   view model, and the Edge Function merging durable contacts in after the
   scoring pipeline has finished) and a second copy of this mapping is how
   the two would drift.

   PROJECTION ONLY. The selection was already made by contact-intelligence.js
   from durable rows; nothing here re-decides who the best contact is, and
   nothing it returns is ever read back into a score. */
export function contactProjection(selection) {
  const best = selection?.bestContact;
  if (!best) return null;
  const personal = best.contactKind === 'personal';
  return {
    /* Gated on kind, not merely on presence: a generic mailbox must never
       render a person's name, whatever a stale row still holds. */
    name: personal ? (best.personName || null) : null,
    role: personal ? (best.personRole || null) : null,
    channel: selection.bestChannel,
    value: best.value,
    kind: best.contactKind,
    /* The provider's own words for what was established — never flattened
       to "verified". */
    verification: best.verificationLabel,
    confidence: selection.confidence,
    /* WHEN THIS WAS LAST CONFIRMED. Nothing rendered carried the age, so a
       contact checked this morning and one checked seven months ago produced
       byte-identical HTML and the founder had no way to tell. */
    lastCheckedAt: best.lastCheckedAt || null,
    /* Whether the observed title implies authority is NOT established — VISION
       holds no fact about who an offer is sold to. Carried so the UI can say
       so instead of letting the job title imply it. */
    roleAuthorityKnown: false,
    why: selection.reason,
    alternativeCount: (selection.alternatives || []).length,
  };
}

const ACTION_TO_BAND = Object.freeze({
  call_now: 'now',
  call_this_week: 'strong',
  email: 'strong',
  clarify_offer: 'watch',
  research_prospect: 'watch',
  research_contact_route: 'watch',
  refresh_evidence: 'watch',
  observe_only: 'no',
  do_not_contact: 'no',
});

const ACTION_LABEL = Object.freeze({
  call_now: 'Call now',
  call_this_week: 'Call this week',
  email: 'Send the email',
  clarify_offer: 'Clarify your offer first',
  research_prospect: 'Research before contacting',
  research_contact_route: 'Find a contact route',
  refresh_evidence: 'Refresh the evidence',
  observe_only: 'Not contactable',
  do_not_contact: 'Do not contact',
});

const URGENCY_LABEL = Object.freeze({
  within_the_hour: 'Within the hour',
  this_week: 'This week',
  before_contact: 'Before any contact',
  not_now: 'Not now',
});

function relativeAge(fromIso, nowIso) {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return '';
  const minutes = Math.max(0, Math.round((now - from) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

/**
 * One canonical record → one frontend lead object.
 *
 * The shape mirrors what js/leads-mock.js renders, so the locked templates
 * need no change to consume real intelligence. Fields the backend genuinely
 * cannot supply yet are `null`, not filled with something plausible.
 */
/* WHAT HAPPENED, WHEN, WHY IT MAY MATTER, AND HOW SURE — as four separate
   fields. Flattening Why Now into one sentence is what let a standing gap and
   a dated acquisition read identically; the founder has to be able to tell at
   a glance whether this is an EVENT or simply the need they already knew
   about. `provider` is deliberately not projected: the source article is
   shown, the vendor that found it is not. */
const WHY_NOW_LABEL = Object.freeze({
  verified_event: 'Recent event',
  recent_change: 'Recent activity',
  unresolved_need: 'Current need — no timing event',
  none: 'No timing event',
});

export function whyNowProjection(resolved, { canResearch = false } = {}) {
  if (!resolved) {
    return {
      tier: 'none', label: WHY_NOW_LABEL.none, eventDriven: false, what: null, when: null,
      whyItMatters: 'No strong external timing event is currently verified. The opportunity is based on the observed need, not artificial urgency.',
      confidence: 'none', caution: false, sourceUrl: null, caveat: null, canResearch: canResearch === true,
    };
  }
  return {
    tier: resolved.tier,
    label: WHY_NOW_LABEL[resolved.tier] || WHY_NOW_LABEL.none,
    eventDriven: resolved.eventDriven === true,
    what: resolved.headline || null,
    when: resolved.whenLabel || null,
    whyItMatters: resolved.why || null,
    confidence: resolved.confidence || 'none',
    /* A takeover or a closure is a reason to be careful, not a sales trigger.
       Carried as its own flag so the UI can say so rather than relying on the
       founder reading the category correctly. */
    caution: resolved.caution === true,
    sourceUrl: resolved.sourceUrl || null,
    caveat: resolved.caveat || null,
    canResearch: canResearch === true,
  };
}

export function toLeadViewModel(record, { now = record?.generatedAt } = {}) {
  if (!record || typeof record !== 'object') throw new Error('view_model_requires_a_prospect_intelligence_record');

  const action = record.workspace?.nextBestAction || {};
  const actionKey = NEXT_ACTIONS.includes(action.action) ? action.action : 'research_prospect';
  const say = record.workspace?.whatToSay || {};
  const outreach = record.workspace?.outreach || {};
  const permitted = new Set(record.contactability?.permittedChannels || []);

  return {
    id: record.leadId,
    kind: record.leadType === 'b2c' ? 'person' : 'business',
    /* Never the id. A UUID in the name slot is the single most obvious way a
       real page announces that nothing real is behind it. */
    name: record.identity?.name || null,
    /* The identity line under the name: "Dental practice · Surry Hills, NSW".
       Built only from parts that exist — a lone separator is worse than a
       shorter line. */
    sub: [record.identity?.category, record.identity?.location].filter(Boolean).join(' · ') || null,
    industry: record.identity?.category || null,
    location: record.identity?.location || null,
    stage: record.pipelineStage || 'new',

    /* Deliberately null. See the header. */
    grade: null,

    temp: STAGE_TO_TEMP[record.lifecycleStage] || 'lead',
    isLead: record.isLead === true,
    band: ACTION_TO_BAND[actionKey] || 'watch',

    /* The one-line "why VISION likes it" the Qualified row shows. */
    thesis: firstSentence(record.selection?.whyChosen) || '',
    confidence: record.confidence,
    confidenceNote: record.selection?.relativePriorityReason
      || (record.freshness?.fresh ? 'Based on current evidence.' : 'The evidence behind this is not current.'),

    age: relativeAge(record.freshness?.latestCheckedAt, now),
    source: { label: sourceLabel(record), campaign: record.campaignId || null },

    consent: record.leadType === 'b2c' ? consentLine(record) : null,

    /* L5B — WHO to contact. Absent unless enrichment has actually run, and
       absent is rendered as absent: the frontend shows nothing rather than
       an empty contact card, because "we have not looked yet" and "there is
       nobody here" must not look the same.
       PROJECTION ONLY. This is a selection already made by
       contact-intelligence.js from durable rows; nothing here decides who
       the best contact is, and nothing downstream may read it back into a
       score. */
    bestContact: contactProjection(record.contactSelection),
    whyNow: whyNowProjection(record.selection?.whyNowResolved, { canResearch: false }),

    next: {
      action: ACTION_LABEL[actionKey] || 'Review this prospect',
      channel: action.channel || 'none',
      urgency: URGENCY_LABEL[action.urgency] || 'Not now',
      why: action.why || '',
    },

    evidence: {
      observed: (record.workspace?.signalTimeline || [])
        .filter((entry) => entry.evidenceStatus === 'OBSERVED')
        .map((entry) => entry.label),
      inferred: (record.selection?.reasons || [])
        .filter((reason) => reason.evidenceStatus === 'INFERRED')
        .map((reason) => reason.statement),
      unknown: (record.selection?.importantUnknowns || []).map((unknown) => unknown.statement),
    },

    /* The full-page workspace. Null when there is genuinely nothing to show,
       which the locked frontend already renders as an honest "no prospect
       file" state rather than an empty shell. */
    ws: hasWorkspaceContent(record, actionKey) ? {
      /* ── THE PROJECTION IS AN ALLOWLIST, AND SILENCE IS ITS FAILURE MODE ──
         Anything absent here simply never reaches the browser, with no error
         anywhere: the server sends it, this drops it, the renderer reads
         undefined and draws nothing. Both of these were added upstream and
         verified in the live payload, and neither appeared on screen for
         exactly that reason. If a workspace field is ever added again, it
         must be added HERE too or it does not exist as far as the founder
         is concerned. */
      offer: record.workspace.offer || null,
      gatekeeper: record.workspace.gatekeeper || null,
      why: record.workspace.whyThisProspect,
      strengths: record.workspace.strengths || [],
      weaknesses: record.workspace.weaknesses || [],
      fit: record.workspace.offerFit,
      timeline: (record.workspace.signalTimeline || []).map((entry) => ({
        t: relativeAge(entry.at, now),
        label: entry.label,
        weight: entry.evidenceStatus === 'OBSERVED' ? 'high' : 'mid',
        detail: `${entry.evidenceStatus}${entry.sourceReference ? ` · ${entry.sourceReference}` : ''}`,
      })),
      say: {
        opening: say.opening || '',
        angle: say.angle || '',
        firstQuestion: say.firstQuestion || '',
        discovery: say.discoveryQuestions || [],
        dontSay: say.dontSay || [],
      },
      objections: (record.workspace.objections || []).map((item) => ({
        q: item.objection,
        why: item.likelyMeaning,
        response: item.response,
      })),
      callStructure: (record.workspace.callStructure || []).map((item, index) => ({
        phase: item.phase,
        time: item.time || `Step ${index + 1}`,
        note: item.note,
      })),
      /* A channel with no permission is OMITTED, not shown empty. The locked
         frontend disables a channel tab whose value is falsy. */
      outreach: {
        call: permitted.has('call') ? outreach.call || '' : '',
        email: permitted.has('email') && outreach.email
          ? { subject: emailSubject(record), body: outreach.email } : '',
        sms: permitted.has('sms') ? outreach.sms || '' : '',
        dm: permitted.has('dm') ? outreach.dm || '' : '',
      },
      history: [],
    } : null,

    /* Shown by the locked frontend when `ws` is null. Always a real reason. */
    wsNote: hasWorkspaceContent(record, actionKey) ? null : workspaceRefusalNote(record, actionKey),
  };
}

function firstSentence(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  const match = value.match(/^[^.!?]+[.!?]/);
  return (match ? match[0] : value).slice(0, 200);
}

function sourceLabel(record) {
  const first = (record.workspace?.signalTimeline || [])[record.workspace?.signalTimeline?.length - 1];
  return first?.sourceReference || (record.leadType === 'b2c' ? 'First-party inbound' : 'Discovered');
}

function consentLine(record) {
  const consent = record.contactability?.consent || {};
  if (consent.status === 'granted') {
    return `Contact consent ${consent.grantedAt ? `given ${consent.grantedAt}` : 'on file'}${consent.allowedChannels?.length ? ` for ${consent.allowedChannels.join(', ')}` : ''}.`;
  }
  if (consent.status === 'declined' || consent.status === 'withdrawn') return `Consent ${consent.status}. No outreach permitted.`;
  return 'No consent recorded. VISION can read the signal but not contact this person.';
}

function emailSubject(record) {
  return firstSentence(record.selection?.whyNow) || 'Following up';
}

/* Actions that are refusals. A refusal must never render an approach file, no
   matter how much evidence sits behind it — an anonymous visitor has plenty of
   observed activity, and showing a call strategy for one would be the exact
   mistake the lead hierarchy exists to prevent.

   The set itself lives in prospect-intelligence-contract.js beside the action
   vocabulary it is drawn from. This file kept a copy, so did leads-board.js,
   and now so would prospect-intelligence.js — three copies of one rule is two
   too many, and the third would have been the one that drifted. */

/** Is there enough real content, AND permission, to justify a full workspace? */
function hasWorkspaceContent(record, actionKey) {
  if (isRefusalAction(actionKey)) return false;
  const say = record.workspace?.whatToSay || {};
  return Boolean(String(say.opening || '').trim() || String(say.angle || '').trim())
    && Boolean(String(record.workspace?.whyThisProspect || '').trim());
}

function workspaceRefusalNote(record, actionKey) {
  const reasons = {
    observe_only: 'This is audience activity, not a lead. Nobody identified themselves and no permission exists, so there is no person here to build a file about.',
    do_not_contact: 'VISION will not write an approach for a prospect it is not permitted to contact. The signal is still readable above.',
    refresh_evidence: 'The evidence behind this prospect is stale or undated. A call strategy built on it would be built on something that may have stopped being true.',
    research_contact_route: 'No contact route has been observed, so there is nothing to write a script for yet.',
    research_prospect: 'There is not enough observed evidence to derive a call strategy. VISION will not invent one — an invented strategy is worse than none.',
    clarify_offer: 'The venture has no confirmed offer, so any approach VISION wrote would be selling something the founder never agreed to.',
  };
  return reasons[actionKey] || 'VISION has not built a prospect file for this one yet.';
}

/** Whole-board projection. Ordering is the caller's (code-owned) decision. */
export function toLeadsBoardViewModel(records, { now = new Date().toISOString() } = {}) {
  return (records || []).map((record) => toLeadViewModel(record, { now }));
}

export const VIEW_MODEL_INTERNALS = Object.freeze({
  STAGE_TO_TEMP, ACTION_TO_BAND, ACTION_LABEL, URGENCY_LABEL, relativeAge, hasWorkspaceContent,
});
