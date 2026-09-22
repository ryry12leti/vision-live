/* ════════════════════════════════════════════════════════════════════════
   LIVE INTELLIGENCE — THE UNIVERSAL RUNTIME CONTRACT

   One envelope for every future mode, decided now so the second mode is an
   entry in a table rather than a second runtime. The shape is deliberately
   NOT sales-shaped:

       { action, mode, workspaceId, input, handoff }

   `practice_turn` is the only implemented action. `think_with_me` and
   `work_with_me` are declared as KNOWN but unimplemented, so a caller asking
   for one gets an honest "not built yet" instead of a 404 that looks like a
   bug — and adding them later means writing a handler, not rewriting this.

   Everything here is pure. No fetch, no Supabase, no model. That is what lets
   the whole first slice be tested at $0.
   ══════════════════════════════════════════════════════════════════════ */

/* THE MODE TABLE IS THE CONTRACT, and it lives in mode-registry.js. These
   re-exports keep existing importers working while making it impossible for
   this file to hold a second, drifting list of what a mode is. */
export {
  LI_ACTIONS, LI_IMPLEMENTED_ACTIONS, LI_MODE_REGISTRY, resolveMode, checkRequirements,
} from './mode-registry.js';
import { resolveMode, checkRequirements, LI_MODE_NAMES } from './mode-registry.js';

export const LI_MODES = LI_MODE_NAMES;

/* Re-exported so callers keep one import, while the BEHAVIOUR lives in
   modes/. The runtime dispatches on the registry's handler name; this is a
   convenience, not the wiring. */
export { practiceTurnReply } from './modes/practice-turn.js';

export const LI_BOUNDS = Object.freeze({
  input: 2000,
  reply: 1200,
  contextChars: 6000,
  historyTurns: 20,
  claim: 300,
});

/* ── request validation ───────────────────────────────────────────────
   A malformed handoff is refused with a NAMED reason. "invalid request" is
   useless to a founder and useless in a log; every refusal below can be
   read back to whoever sent it. */
export const LI_REFUSALS = Object.freeze([
  'action_required', 'action_unknown', 'action_not_implemented',
  'input_required', 'input_too_long', 'handoff_required',
  'handoff_prospect_required', 'handoff_script_required', 'workspace_required',
]);

export function validateLiRequest({ action, mode = null, workspaceId = null, input = null, handoff = null, speaker = null, sequence = null } = {}) {
  const refuse = (reason, detail) => ({ ok: false, reason, detail });

  if (!action || typeof action !== 'string') return refuse('action_required', 'No action was given.');

  /* ONE LOOKUP, NO BRANCHES. Whether a mode exists, whether it is built, and
     what it needs are all properties of its registry row. This function used
     to say `if (action === 'practice_turn') { ...check the handoff... }` — a
     sales-shaped condition inside generic validation, and exactly the seam
     that makes a second mode a rewrite instead of a row. */
  const descriptor = resolveMode(action);
  if (!descriptor) return refuse('action_unknown', `"${action}" is not a Live Intelligence action.`);
  if (!descriptor.implemented) {
    return refuse('action_not_implemented',
      `${action} is recognised but not built yet: ${descriptor.describes}`);
  }

  if (typeof input !== 'string' || input.trim().length === 0) {
    return refuse('input_required', 'Nothing was said, so there is nothing to answer.');
  }
  if (input.length > LI_BOUNDS.input) {
    return refuse('input_too_long', `Keep it under ${LI_BOUNDS.input} characters.`);
  }

  /* The whole body, not just the handoff: requirements are declared per mode
     and a mode that needs a speaker cannot be validated from a handoff. */
  const needs = checkRequirements(descriptor, { handoff, speaker, sequence });
  if (!needs.ok) return refuse(needs.reason, needs.detail);

  return {
    ok: true,
    action,
    /* The MODE is the registry's, not the caller's. A client asking for
       practice_turn in "work" mode would otherwise bind a session to a mode
       its own action does not implement. */
    mode: descriptor.mode,
    requestedMode: typeof mode === 'string' ? mode : null,
    handler: descriptor.handler,
    workspaceId: workspaceId || null,
    input: input.trim().slice(0, LI_BOUNDS.input),
    handoff,
    speaker: speaker === 'founder' || speaker === 'prospect' ? speaker : null,
    sequence: Number.isInteger(sequence) ? sequence : null,
  };
}

/* ── bounded context ──────────────────────────────────────────────────
   The model (when there is one) sees a BOUNDED projection, never the raw
   handoff and never the founder's whole ledger. Built here so the bound is
   one function rather than a habit. */
export function buildLiContext({ handoff, founderState = null, history = [], memory = [], now = new Date().toISOString() } = {}) {
  const h = handoff || {};
  const script = h.script || {};
  const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

  const context = {
    now,
    prospect: {
      name: text(h.prospect && h.prospect.name, 200),
      sub: text(h.prospect && h.prospect.sub, 200),
      industry: text(h.prospect && h.prospect.industry, 120),
      location: text(h.prospect && h.prospect.location, 200),
    },
    /* The founder's own offer and target, so the prospect's replies can be
       ABOUT something. Nothing else from the ledger. */
    founder: founderState ? {
      offer: text(founderState.offer, 600),
      targetCustomer: text(founderState.targetCustomer, 300),
      businessName: text(founderState.businessName, 200),
    } : null,
    /* What the founder INTENDED to say — the thing being rehearsed. */
    script: {
      opening: text(script.opening, 900),
      firstQuestion: text(script.firstQuestion, 300),
      discovery: (script.discovery || []).slice(0, 5).map((q) => text(q, 300)).filter(Boolean),
      pitchBridge: text(script.pitchBridge, 400),
      close: text(script.close, 400),
    },
    /* Evidence and unknowns, so the persona can be consistent with what is
       actually established — and refuse to confirm what is not. */
    evidence: {
      observed: ((h.evidence && h.evidence.observed) || []).slice(0, 8).map((x) => text(x, LI_BOUNDS.claim)).filter(Boolean),
    },
    unknowns: (h.unknowns || []).slice(0, 8).map((x) => text(x, LI_BOUNDS.claim)).filter(Boolean),
    objections: (h.objections || []).slice(0, 6).map((o) => ({
      objection: text(o && o.q, 200), response: text(o && o.response, 600),
    })).filter((o) => o.objection),
    whyNow: h.whyNow ? { tier: text(h.whyNow.tier, 40), what: text(h.whyNow.what, LI_BOUNDS.claim) } : null,
    contactRole: h.contactRole ? { role: text(h.contactRole.role, 120), kind: text(h.contactRole.kind, 40) } : null,
    desiredClose: h.desiredClose ? text(h.desiredClose.note, 400) : null,
    /* SCOPED MEMORY, ALREADY BOUNDED BY THE READ. Carried with its scope and
       confirmation state so a consumer can tell a founder-confirmed venture
       fact from something this session merely noted — flattening them into
       one list is how "VISION said it once" becomes "VISION knows it". */
    memory: (memory || []).slice(0, 30).map((m) => ({
      scope: m.scope || null,
      type: m.type || null,
      content: text(m.content, LI_BOUNDS.claim),
      confirmed: m.confirmed === true,
    })).filter((m) => m.content),
    history: (history || []).slice(-LI_BOUNDS.historyTurns).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: text(m.content, 600),
    })),
  };

  /* One hard ceiling on the whole thing, so no single oversized field can
     quietly blow the budget. */
  const serialised = JSON.stringify(context);
  return { context, chars: serialised.length, withinBounds: serialised.length <= LI_BOUNDS.contextChars };
}
