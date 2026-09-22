/**
 * Mounts the Founder Calendar into founder.html.
 *
 * Deliberately additive: it touches none of the intake, clarification or
 * "what VISION understood" panels, which are owned by
 * js/founder-lead-intelligence.js and already work. This only appends a
 * Calendar once the founder actually has a venture to show.
 */

import { createFounderCalendar } from './ui.js';
import { CALENDAR_ERROR } from './api.js';

const panel = document.getElementById('founder-calendar-panel');
const root = document.getElementById('fc');
const drawer = document.getElementById('fc-drawer');

/** Waits for js/supabase.js to have created the client. Module scripts defer,
 *  so this is normally already true; the poll covers a slow CDN. */
function whenReady(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const started = Date.now();
    (function poll() {
      const V = window.V || window.VISION;
      if (V && V.sb && V.auth) return resolve(V);
      if (Date.now() - started > timeoutMs) return resolve(null);
      return setTimeout(poll, 60);
    }());
  });
}

(async function boot() {
  if (!panel || !root) return;
  const V = await whenReady();
  if (!V) return;

  const user = await V.auth.getUser().catch(() => null);
  /* Unauthenticated founders already get the sign-in gate above; adding a
     second "sign in" surface here would just be noise. */
  if (!user) return;

  const calendar = createFounderCalendar({
    root,
    drawer,
    invoke: (name, opts) => V.sb.functions.invoke(name, opts),
  });

  /* Exposed before the first read, so intake can reveal the Calendar the
     moment a week is proposed. Not an authority: everything it returns comes
     from the last server snapshot. */
  window.VISION_FOUNDER_CALENDAR = calendar;

  async function loadAndReveal() {
    const res = await calendar.load();
    /* A founder still in intake has no venture yet. Showing "no venture"
       beside the questions they are in the middle of answering would read as
       an error when nothing is wrong, so the Calendar stays out of the way
       until there is a week to show. */
    if (!res.ok && res.error === CALENDAR_ERROR.NO_VENTURE) return res;

    /* NOR when there is nothing yet to show. A venture exists from the moment
       intake starts, so NO_VENTURE stops being true long before there is a
       week -- and without this the founder answers VISION's questions with an
       empty Calendar sitting underneath saying "Nothing is planned yet",
       which reads as a broken product rather than an unfinished setup.
       Caught by driving the real journey in a browser; no unit test was ever
       going to notice it.

       The Calendar reveals when there IS a week: a proposal to review, or
       live work. An error still reveals -- a founder who HAS a plan must be
       told it could not be loaded, never shown nothing. */
    const snap = calendar.getSnapshot();
    const hasWeek = Boolean(calendar.getProposal())
      || Boolean(snap && (snap.items.length || snap.currentWork.workItemId));
    if (res.ok && !hasWeek) return res;

    panel.classList.remove('hidden');
    panel.hidden = false;
    document.dispatchEvent(new CustomEvent('vision:founder-calendar-ready', {
      detail: { ok: res.ok, error: res.error ?? null, proposed: Boolean(res.proposal) },
    }));
    return res;
  }

  /* THE CONTINUOUS JOURNEY. When intake finishes it proposes a week rather
     than persisting one, then fires this. The Calendar reveals itself on the
     same page the founder is already looking at -- there is no Calendar to
     navigate to, and the decision to accept is made while looking at the
     actual week, not at a link promising one. */
  document.addEventListener('vision:founder-plan-proposed', () => { loadAndReveal(); });

  await loadAndReveal();
}());
