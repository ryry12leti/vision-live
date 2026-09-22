/* Package 6 — Shared DOM helpers (extracted byte-exact from tasks-page.js).
   MUST load before every other tasks/proof module: those modules run element-wiring
   at load time (addEventListener on $('…')), so $ / $$ / setText / safeGet have to be
   defined first. Foundational primitives plus the approved-layout asset loader. */
/* safe helpers ----------------------------------------------------------- */
function safeGet(fn, fallback) {
  try { return fn(); } catch(e) { return fallback; }
}
function $(id)  { return document.getElementById(id); }
function $$(sel){ return Array.from(document.querySelectorAll(sel)); }
function setText(id, v) { const el = $(id); if (el) el.textContent = v; }
/* motion/timing primitives — shared by task-cinematic, live-ui and voice-ui.
   Kept here (loaded first) so those modules resolve them regardless of order. */
function prefersReducedMotion(){
  try { return matchMedia('(prefers-reduced-motion:reduce)').matches; } catch(e) { return false; }
}
function wait(ms){ return new Promise(res => setTimeout(res, ms)); }

/* Approved Tasks composition is isolated in its own controller + stylesheet.
   Loading it here keeps tasks.html modular and avoids re-embedding page logic. */
(function loadApprovedTasksLayoutAssets(){
  try {
    if (!document.querySelector('link[data-approved-tasks-layout]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'css/tasks/approved-layout.css';
      link.setAttribute('data-approved-tasks-layout', '');
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-approved-tasks-layout]')) {
      var script = document.createElement('script');
      script.src = 'js/tasks/approved-layout.js';
      script.async = true;
      script.setAttribute('data-approved-tasks-layout', '');
      document.head.appendChild(script);
    }
  } catch(e) {
    console.error('[VISION] could not load approved Tasks layout assets', e);
  }
})();
