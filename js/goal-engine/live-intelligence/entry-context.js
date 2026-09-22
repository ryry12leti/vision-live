/* ════════════════════════════════════════════════════════════════════════
   WHAT LIVE INTELLIGENCE OPENS INTO.

   A founder arriving from a Leads prospect has already told VISION
   everything it needs: which business, which approach, what is still
   unknown. Asking "what would you like help with?" would be asking them to
   repeat themselves, so the entry names the prospect and recommends ONE
   action.

   LIVE INTELLIGENCE ITSELF STAYS UNIVERSAL. Sales is an ENTRY CONTEXT, not
   what the system is. This table maps an origin to an opening; a future
   planning or learning workspace adds a row and nothing underneath changes.
   Anything with no known origin gets the generic opening and no invented
   sales framing.

   EVERY ACTION HERE POINTS AT SOMETHING THAT EXISTS. Where a capability is
   not built, it is absent — not greyed out, not "coming soon". A dead
   control is worse than a missing one, because the founder spends attention
   discovering it does nothing.
   ══════════════════════════════════════════════════════════════════════ */

export const ENTRY_ORIGINS = Object.freeze(['leads', 'generic']);

/* Capabilities this build genuinely has. Passing one as false removes the
   action rather than disabling it. */
export const DEFAULT_CAPABILITIES = Object.freeze({
  liveCall: true,        /* the proven command surface */
  practiceCall: true,    /* the proven practice panel */
  voiceRehearsal: false, /* not built */
  askVision: false,      /* no endpoint that safely takes a free question */
  postCallReview: false, /* not built */
});

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const closeOf = (h) => text(h && h.desiredClose && h.desiredClose.note)
  || text(h && h.desiredClose && h.desiredClose.action) || '';

/* ── is this founder ready to dial? ───────────────────────────────────
   Deterministic, from what the handoff actually carries. Not a score and
   not a guess: an approach the founder could read aloud is one they can
   execute, and one with no first question is not. */
export function callReadiness(handoff) {
  const h = handoff || {};
  const script = h.script || {};
  const missing = [];
  if (!text(script.opening)) missing.push('an opening');
  if (!text(script.firstQuestion)) missing.push('a first question');
  /* EITHER FIELD IS A REAL NEXT STEP. Leads emits desiredClose.action ("Call
     this week") from the board and desiredClose.note from the closing phase of
     the script; the note is frequently null while the action is set. Reading
     only the note declared a fully-prepared prospect unready and recommended
     reviewing an approach that had nothing missing. */
  if (!closeOf(h)) missing.push('a next step to aim for');
  const observed = (h.evidence && h.evidence.observed) || [];
  if (!observed.length) missing.push('anything VISION has verified');
  return { ready: missing.length === 0, missing };
}

export function resolveEntry({ origin = 'generic', handoff = null, capabilities = {} } = {}) {
  const cap = { ...DEFAULT_CAPABILITIES, ...capabilities };

  if (origin !== 'leads' || !handoff || !handoff.prospect || !text(handoff.prospect.name)) {
    /* NO PROSPECT, NO SALES FRAMING. Live Intelligence opened on its own is
       not a sales tool, and pretending otherwise would be inventing a
       context the founder never asked for. */
    return {
      context: 'generic',
      title: 'Live Intelligence',
      subtitle: 'Open a prospect from Leads to work a live call with VISION beside you.',
      recommended: null,
      secondary: [],
      review: null,
      objections: [],
    };
  }

  const p = handoff.prospect;
  const readiness = callReadiness(handoff);
  const objections = Array.isArray(handoff.objections) ? handoff.objections.filter((o) => o && o.q) : [];

  /* ── ONE recommendation, and the reason for it ─────────────────────── */
  let recommended;
  const secondary = [];

  if (readiness.ready && cap.liveCall) {
    recommended = {
      id: 'live_call',
      label: 'Start live call',
      why: 'You have enough to contact them. VISION listens silently and tells you what to do next.',
    };
    if (cap.practiceCall) {
      secondary.push({ id: 'practice', label: 'Practice the call first',
        why: 'Talk it through out loud — VISION plays them, and pushes back.' });
    }
  } else {
    /* Not ready is not a refusal — it is a different first move. */
    recommended = {
      id: 'review',
      label: 'Review the approach',
      why: readiness.missing.length
        ? `Your approach is still missing ${readiness.missing.join(', ')}.`
        : 'Go over the approach before you contact them.',
    };
    if (cap.practiceCall) {
      secondary.push({ id: 'practice', label: 'Practice the call',
        why: 'Talk it through out loud — VISION plays them, and pushes back.' });
    }
    if (cap.liveCall) {
      secondary.push({ id: 'live_call', label: 'Start live call anyway',
        why: 'You can still call — VISION will work with what it has.' });
    }
  }

  /* Review and objections are DISCLOSURES on this screen, not destinations,
     so they are not also buttons. The first version listed both as actions
     AND rendered the panels they open — four controls for two things, and
     the founder has to work out that two of them do the same job. */

  return {
    context: 'leads',
    title: p.name,
    subtitle: text(p.sub) || null,
    readiness,
    recommended,
    secondary,
    /* Shown in place rather than sending the founder to a screen that cannot
       display it: Leads has no deep link to a single prospect, so "review the
       approach" would otherwise land them on the board to find it again. */
    review: {
      opening: text(handoff.script && handoff.script.opening) || null,
      firstQuestion: text(handoff.script && handoff.script.firstQuestion) || null,
      aimingFor: closeOf(handoff) || null,
      observed: ((handoff.evidence && handoff.evidence.observed) || []).slice(0, 3),
      unknowns: (handoff.unknowns || []).slice(0, 3),
    },
    objections: objections.slice(0, 4).map((o) => ({
      q: text(o.q), why: text(o.why), response: text(o.response),
    })),
  };
}
