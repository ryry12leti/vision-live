/* ═══════════════════════════════════════════════════════════════
   connected-navigation.js — canonical routes for the refreshed shell
   ---------------------------------------------------------------
   The refreshed Dashboard / Analyst / Tasks surfaces reach each other
   and Live Intelligence through this one module, so the active task id
   travels with the user instead of being re-derived per page.

   It owns no product state. It reads the active task id that the page
   already knows and appends it as a relative query parameter.

   Public API: window.VISION.nav
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var ANALYST = 'analyst.html';
  var LIVE_INTELLIGENCE = 'live-intelligence.html';

  /* Task ids are opaque server identifiers. Accept only the shapes the
     backend actually issues (uuid / slug-safe) so a crafted value can
     never smuggle a scheme, path traversal, or foreign origin into a
     link that we then assign to location.href. */
  function safeTaskId(id) {
    if (typeof id !== 'string') return null;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    return id;
  }

  /* The active task id, in order of trust: explicit argument, the value
     already on this page's URL, then whatever the page's own model
     exposes. Never invented. */
  function activeTaskId(explicit) {
    var id = safeTaskId(explicit);
    if (id) return id;
    try {
      id = safeTaskId(new URLSearchParams(location.search).get('task_id'));
      if (id) return id;
    } catch (e) {}
    try {
      var st = V.state || {};
      id = safeTaskId(st.activeTaskId || (st.activeTask && st.activeTask.id));
      if (id) return id;
    } catch (e) {}
    return null;
  }

  function withTask(page, taskId) {
    var id = activeTaskId(taskId);
    return id ? page + '?task_id=' + encodeURIComponent(id) : page;
  }

  function analystHref(taskId) { return withTask(ANALYST, taskId); }
  function liveIntelligenceHref(taskId) { return withTask(LIVE_INTELLIGENCE, taskId); }

  function openAnalyst(taskId) { location.href = analystHref(taskId); }
  function openLiveIntelligence(taskId) { location.href = liveIntelligenceHref(taskId); }

  /* Declarative entry points. Any element carrying data-open-analyst or
     data-open-live-intelligence routes correctly without page-specific
     wiring; an optional data-task-id overrides the ambient one. */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest(
      '[data-open-analyst],[data-open-live-intelligence]') : null;
    if (!t) return;
    e.preventDefault();
    var id = t.getAttribute('data-task-id');
    if (t.hasAttribute('data-open-live-intelligence')) openLiveIntelligence(id);
    else openAnalyst(id);
  });

  V.nav = {
    safeTaskId: safeTaskId,
    activeTaskId: activeTaskId,
    analystHref: analystHref,
    liveIntelligenceHref: liveIntelligenceHref,
    openAnalyst: openAnalyst,
    openLiveIntelligence: openLiveIntelligence
  };
})(window.VISION);
