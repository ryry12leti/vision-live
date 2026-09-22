/* ════════════════════════════════════════════════════════════════════════
   THE UNIVERSAL MODE CONTRACT

   One table describes every mode Live Intelligence knows. Auth, workspace
   resolution, session binding, context bounding and persistence read this
   table; none of them contains a branch on which mode is running. That is
   the whole design goal — a second mode is a ROW plus a handler, never a
   change to the infrastructure underneath.

   `requires` is what makes validation universal. The runtime used to say
   `if (action === 'practice_turn') { ...check the handoff... }`, which is a
   sales-shaped branch sitting inside generic request validation. Each mode
   now declares what it needs and the validator enforces it generically, so
   `analyse_decision` declaring `decision` costs nothing to support.

   IMPLEMENTED IS A PROPERTY, NOT AN ABSENCE. A recognised-but-unbuilt mode
   answers 501 with its own description, which is a different fact from "that
   is not a thing" and is worth telling a caller apart.
   ══════════════════════════════════════════════════════════════════════ */

/* What a mode may demand of a request. Each entry is a path into the body
   and the refusal reason to give when it is missing — declared so a new mode
   cannot invent a refusal vocabulary of its own. */
export const LI_REQUIREMENTS = Object.freeze({
  handoff: {
    check: (body) => !!(body && body.handoff && typeof body.handoff === 'object'),
    reason: 'handoff_required',
    detail: 'This mode needs the prospect handoff from the Workspace.',
  },
  handoffProspect: {
    check: (body) => !!(body && body.handoff && body.handoff.prospect && body.handoff.prospect.name),
    reason: 'handoff_prospect_required',
    detail: 'The handoff names no prospect.',
  },
  transcriptSpeaker: {
    check: (body) => body && (body.speaker === 'founder' || body.speaker === 'prospect'),
    reason: 'speaker_required',
    detail: 'A transcript line must say who said it: founder or prospect.',
  },
  transcriptSequence: {
    check: (body) => body && Number.isInteger(body.sequence) && body.sequence >= 0,
    reason: 'sequence_required',
    detail: 'A transcript line needs its sequence number, so a resent chunk is not counted twice.',
  },
  handoffScript: {
    check: (body) => !!(body && body.handoff && body.handoff.script && typeof body.handoff.script === 'object'),
    reason: 'handoff_script_required',
    detail: 'The handoff carries no script to practise against.',
  },
});

export const LI_MODE_REGISTRY = Object.freeze({
  practice_turn: Object.freeze({
    action: 'practice_turn',
    mode: 'practice',
    implemented: true,
    requires: Object.freeze(['handoff', 'handoffProspect', 'handoffScript']),
    /* Named rather than a function reference: the registry stays a pure data
       table that a test can read, and the runtime owns the wiring. */
    handler: 'practiceTurn',
    describes: 'Rehearse a real call against a prospect VISION has already researched.',
  }),
  call_assist: Object.freeze({
    action: 'call_assist',
    mode: 'call',
    implemented: true,
    /* No script requirement: this is a REAL call, not a rehearsal of one. The
       prospect context still matters, so the handoff does. */
    requires: Object.freeze(['handoff', 'handoffProspect', 'transcriptSpeaker', 'transcriptSequence']),
    handler: 'callAssist',
    describes: 'Watch a live call silently and tell you what just changed and what to do next.',
  }),
  think_with_me: Object.freeze({
    action: 'think_with_me',
    mode: 'think',
    implemented: false,
    requires: Object.freeze([]),
    handler: null,
    describes: 'Talk a problem through without VISION taking any action on your behalf.',
  }),
  work_with_me: Object.freeze({
    action: 'work_with_me',
    mode: 'work',
    implemented: false,
    requires: Object.freeze([]),
    handler: null,
    describes: 'Work on a live artefact together, with VISION proposing changes you approve.',
  }),
  analyse_decision: Object.freeze({
    action: 'analyse_decision',
    mode: 'analyse',
    implemented: false,
    requires: Object.freeze([]),
    handler: null,
    describes: 'Examine a decision you are weighing, and what would have to be true either way.',
  }),
});

export const LI_ACTIONS = Object.freeze(Object.keys(LI_MODE_REGISTRY));
export const LI_IMPLEMENTED_ACTIONS = Object.freeze(
  LI_ACTIONS.filter((a) => LI_MODE_REGISTRY[a].implemented));
export const LI_MODE_NAMES = Object.freeze(
  [...new Set(LI_ACTIONS.map((a) => LI_MODE_REGISTRY[a].mode))]);

export function resolveMode(action) {
  return LI_MODE_REGISTRY[action] || null;
}

/** Generic requirement check. Knows nothing about sales. */
export function checkRequirements(descriptor, body) {
  for (const key of (descriptor.requires || [])) {
    const rule = LI_REQUIREMENTS[key];
    if (!rule) continue;
    if (!rule.check(body)) return { ok: false, reason: rule.reason, detail: rule.detail };
  }
  return { ok: true };
}
