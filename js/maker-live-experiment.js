/* ═══════════════════════════════════════════════════════════════
   maker-live-experiment.js — Maker Real-Market A/B V1 harness
   ---------------------------------------------------------------
   The SMALLEST production-safe client harness for exactly ONE pinned
   experiment (maker-live-proof-v1, Control A vs the frozen Maker
   Proof-row intervention as Variant B). Not a general experimentation
   platform -- assignment, variant rendering, event capture, QA
   exclusion, and signup attribution metadata only.

   Assignment: one client-generated, privacy-safe visitor_id (random
   UUID, no fingerprinting, no IP, no cross-site identity), persisted in
   localStorage so a returning visitor keeps the same variant across
   reloads. QA mode (?maker_ab=A|B&qa=1) forces a deterministic variant
   for engineering inspection WITHOUT persisting an assignment and WITHOUT
   ever being scored as real traffic -- every event this harness sends
   carries an explicit qa flag the server-side write function records
   verbatim, so QA traffic is always distinguishable, never silently
   mixed into the real counts.

   Telemetry: every event goes through the maker_live_experiment_event_write_v1
   SECURITY DEFINER RPC (see the matching migration) -- this file never
   attempts a direct table write, matching this repository's own
   established anon-write-denial convention. Every call is best-effort:
   a failed/slow network request never blocks or visibly affects the
   visitor's experience.
   ═══════════════════════════════════════════════════════════════ */
(function (V) {
  'use strict';

  var EXPERIMENT_ID = 'maker-live-proof-v1';
  var ASSIGNMENT_KEY = 'vision_maker_exp_' + EXPERIMENT_ID;
  var VISITOR_KEY = 'vision_visitor_id';

  function randomUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    // Fallback for older browsers -- still a random, non-identifying UUID-shaped string.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode etc -- non-fatal */ } }

  function getVisitorId() {
    var id = safeGet(VISITOR_KEY);
    if (!id) { id = randomUUID(); safeSet(VISITOR_KEY, id); }
    return id;
  }

  function searchParams() {
    try { return new URLSearchParams(window.location.search); } catch (e) { return null; }
  }

  function isQA() {
    var p = searchParams();
    return !!(p && p.get('qa') === '1');
  }

  function qaVariantOverride() {
    var p = searchParams();
    if (!p || p.get('qa') !== '1') return null;
    var v = p.get('maker_ab');
    return v === 'A' || v === 'B' ? v : null;
  }

  function getAssignedVariant(qa, qaOverride) {
    if (qa && qaOverride) return qaOverride; // deterministic, NOT persisted, NOT real traffic
    var stored = safeGet(ASSIGNMENT_KEY);
    if (stored === 'A' || stored === 'B') return stored;
    var assigned = Math.random() < 0.5 ? 'A' : 'B';
    safeSet(ASSIGNMENT_KEY, assigned);
    return assigned;
  }

  function getUTM() {
    var p = searchParams();
    if (!p) return { utm_source: null, utm_medium: null, utm_campaign: null };
    return {
      utm_source: p.get('utm_source') || null,
      utm_medium: p.get('utm_medium') || null,
      utm_campaign: p.get('utm_campaign') || null,
    };
  }

  var qa = isQA();
  var variant = getAssignedVariant(qa, qaVariantOverride());
  var visitorId = getVisitorId();
  var utm = getUTM();

  /**
   * Best-effort event write via the SECURITY DEFINER RPC -- never a direct
   * table write, never throws into the caller, never blocks the UI.
   */
  function track(eventName) {
    try {
      if (!V.sb || typeof V.sb.rpc !== 'function') return; // no backend configured (demo mode) -- silent no-op
      V.sb.rpc('maker_live_experiment_event_write_v1', {
        p_experiment_id: EXPERIMENT_ID,
        p_variant: variant,
        p_visitor_id: visitorId,
        p_event_name: eventName,
        p_page_path: window.location.pathname,
        p_qa: qa,
        p_utm_source: utm.utm_source,
        p_utm_medium: utm.utm_medium,
        p_utm_campaign: utm.utm_campaign,
      }).then(function () {}, function () {}); // best-effort -- failures are silently swallowed, on purpose
    } catch (e) { /* never let telemetry break the page */ }
  }

  /**
   * Variant B: expand the "Proof" accordion row using EXACTLY the
   * pattern the existing "Deadline" row already uses (matches
   * scripts/maker-live-company-loop-v1/assets/proof-row-expansion-variant.json
   * byte-for-byte in the text it inserts) -- no other change to the page.
   */
  function applyProofRowVariant() {
    var rows = document.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) {
      var h3 = rows[i].querySelector('h3');
      if (h3 && h3.textContent.trim() === 'Proof') {
        var row = rows[i];
        row.classList.add('open');
        var marker = row.querySelector('u');
        if (marker) marker.textContent = '—';
        if (!row.querySelector('.rbody')) {
          var rbody = document.createElement('div');
          rbody.className = 'rbody';
          rbody.innerHTML = '<p>Photo, voice, live, or a focus session — whatever the task calls for. '
            + 'No typed checkbox counts. The system reads what you submit and marks the day proven or missed. '
            + 'Nothing in between.</p><a class="pill">See what counts as proof</a>';
          row.appendChild(rbody);
        }
        // Diagnostic signal: fires once when the expanded Proof content
        // actually enters the viewport (a real look, not just DOM presence).
        if (window.IntersectionObserver) {
          var seen = false;
          var observer = new IntersectionObserver(function (entries) {
            for (var j = 0; j < entries.length; j++) {
              if (entries[j].isIntersecting && !seen) {
                seen = true;
                track('proof_open');
                observer.disconnect();
              }
            }
          }, { threshold: 0.5 });
          observer.observe(row);
        }
        break;
      }
    }
  }

  function attachPrimaryCtaTracking() {
    var cta = document.querySelector('.fin-cta');
    if (cta) cta.addEventListener('click', function () { track('primary_cta_click'); }, { once: true });
  }

  function init() {
    if (variant === 'B') applyProofRowVariant();
    attachPrimaryCtaTracking();
    track('experiment_exposure');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  V.makerExperiment = Object.freeze({
    experimentId: EXPERIMENT_ID,
    variant: variant,
    qa: qa,
    visitorId: visitorId,
    utm: utm,
    track: track,
  });
})(window.VISION = window.VISION || {});
