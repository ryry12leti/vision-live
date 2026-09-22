/* ═══════════════════════════════════════════════════════════════
   boot-guard.js — blank-screen guard (load FIRST, before any other script)
   ---------------------------------------------------------------
   A broken CDN, a script error, or a hung render must never strand the
   user on a silent black page. This file is dependency-free by design:
   it uses no VISION.*, no supabase, no CSS framework — only DOM APIs —
   so it still works when everything else failed to load.

   1. window.onerror / unhandledrejection → visible banner with Reload.
   2. Render watchdog: a page calls VISION_BOOT.watch(ms) early and
      VISION_BOOT.ok() after its first successful render; if ok() never
      arrives, the banner appears instead of an infinite spinner.
   Never hides errors — it surfaces them. No analytics, no network.
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var shown = false, timer = null, booted = false;

  /* Same-origin, dependency-free Live foundations. The packs and routing
     companions poll for their core dependencies, so these files can load at
     boot without relying on parser timing or duplicate script tags. */
  try {
    function injectLiveScript(src, attr, eventName) {
      if (document.querySelector('script[' + attr + ']')) return;
      var script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.setAttribute(attr, '1');
      script.onerror = function () {
        try { window.dispatchEvent(new CustomEvent(eventName)); } catch (_) {}
      };
      (document.head || document.documentElement).appendChild(script);
    }
    /* Live foundation load order is load-bearing: runtime owns camera/evidence,
       the unified controller owns all API/window wrappers, and the phase bridge
       reads its negotiated protocol. */
    injectLiveScript('js/proof/live/live-runtime.js', 'data-vision-live-runtime', 'vision:live-runtime-error');
    injectLiveScript('js/proof/live/live-controller-bridge.js', 'data-vision-live-controller-bridge', 'vision:live-controller-bridge-error');
    injectLiveScript('js/proof/live/phase-evidence-bridge.js', 'data-vision-live-phase-evidence', 'vision:live-phase-evidence-error');
    injectLiveScript('js/proof/live/equipment-engine.js', 'data-vision-equipment-engine', 'vision:equipment-engine-error');
    injectLiveScript('js/proof/live/focus-hybrid-client.js', 'data-vision-focus-hybrid-client', 'vision:focus-hybrid-client-error');
    injectLiveScript('js/vision-bodyweight-pack-v3.js', 'data-vision-bodyweight-pack', 'vision:bodyweight-pack-error');
    injectLiveScript('js/vision-bodyweight-routing-v3.js', 'data-vision-bodyweight-routing', 'vision:bodyweight-routing-error');
    injectLiveScript('js/vision-free-weight-pack-v3.js', 'data-vision-free-weight-pack', 'vision:free-weight-pack-error');
    injectLiveScript('js/vision-machine-cardio-pack-v3.js', 'data-vision-machine-cardio-pack', 'vision:machine-cardio-pack-error');
  } catch (_) { /* Live extension failure must never break the page boot guard */ }

  /* Founder clarification compatibility bridge.
     The canonical daily-plan client already has the correct Founder answer
     implementation, but its public answerQuestion(questionId, answer) router
     only selects that implementation when questionId is omitted. Connected
     Analyst correctly passes the visible question id, so Founder answers were
     accidentally sent to the legacy goal-engine-diagnostic endpoint instead.

     Boot guard loads on every relevant page before vision-daily-plan.js. Wait
     for that client to initialise, then preserve its public API while routing a
     pending Founder clarification through the Founder path. This is deliberately
     narrow: ordinary diagnostics and every non-Founder call remain untouched. */
  try {
    (function installFounderClarificationRoutingFix() {
      var attempts = 0;
      function install() {
        var plan = window.VISION && window.VISION.dailyPlan;
        if (!plan || typeof plan.answerQuestion !== 'function') {
          if (attempts++ < 400) setTimeout(install, 25);
          return;
        }
        if (plan.__founderClarificationRoutingFix === true) return;

        var originalAnswerQuestion = plan.answerQuestion;
        plan.answerQuestion = function (questionId, answer) {
          var current = typeof plan.state === 'function' ? plan.state() : null;
          var isFounderClarification = !!(
            current &&
            current.status === 'clarification_required' &&
            current.question &&
            current.question.founder === true
          );

          if (isFounderClarification) {
            return originalAnswerQuestion.call(plan, null, answer);
          }
          return originalAnswerQuestion.apply(plan, arguments);
        };
        plan.__founderClarificationRoutingFix = true;
      }
      install();
    })();
  } catch (_) { /* A compatibility patch must never block page boot. */ }

  function banner(msg) {
    if (shown) return; shown = true;
    try {
      var d = document.createElement('div');
      d.setAttribute('role', 'alert');
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;' +
        'background:#1a1d24;color:#e8ebf2;border-bottom:1px solid #3a3f4b;' +
        'font:13px/1.5 -apple-system,system-ui,sans-serif;padding:12px 16px;' +
        'display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center';
      var s = document.createElement('span');
      s.textContent = msg;
      var b = document.createElement('button');
      b.textContent = 'Reload';
      b.style.cssText = 'background:#f1f3f7;color:#0a0b0e;border:0;border-radius:8px;' +
        'padding:6px 16px;font:inherit;font-weight:600;cursor:pointer';
      b.onclick = function () { location.reload(); };
      d.appendChild(s); d.appendChild(b);
      (document.body || document.documentElement).appendChild(d);
    } catch (e) { /* last resort: never throw from the guard itself */ }
  }

  window.addEventListener('error', function (e) {
    if (booted) return;
    if (e && e.target && e.target !== window && !(e.error || e.message)) return;
    banner('Something went wrong loading this page. Reloading usually fixes it.');
  }, true);
  window.addEventListener('unhandledrejection', function () {
    if (booted) return;
    banner('Something went wrong loading this page. Reloading usually fixes it.');
  });

  window.VISION_BOOT = {
    watch: function (ms) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        banner('This page is taking too long to load. Check your connection and reload.');
      }, ms || 8000);
    },
    ok: function () { clearTimeout(timer); timer = null; booted = true; }
  };
})();
