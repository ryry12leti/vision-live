/* ═══════════════════════════════════════════════════════════════
   analytics.js — VISION lightweight, privacy-safe event tracking
   ---------------------------------------------------------------
   Goal: know what beta testers do, WITHOUT ever shipping anything
   sensitive off-device. There is no paid provider and no heavy SDK.

   Safety model (defence in depth):
   • Event names are hard-allowlisted — an unknown name is dropped.
   • Metadata is sanitised: only short primitives survive; any key or
     value that looks like PII (email, name, note, photo path, raw goal
     text, a URL, anything long) is stripped. So a caller MISTAKE can't
     leak data — the module refuses to forward it.
   • Sinks are best-effort and optional: console in dev only, and Vercel
     Web Analytics (window.va) ONLY if it's already on the page. If no
     sink exists, track() is a silent no-op that never throws.

   Public API: window.VISION.analytics.track(name, meta)
   ═══════════════════════════════════════════════════════════════ */
document.body.classList.add('loaded');
window.VISION = window.VISION || {};
(function (V) {
  'use strict';

  /* ── the only event names that will ever be sent ── */
  var ALLOWED = {
    // funnel
    landing_view: 1, signup_view: 1, login_view: 1, signup_submit: 1, login_success: 1,
    onboarding_start: 1, onboarding_complete: 1, dashboard_view: 1,
    // activation
    first_task_viewed: 1, proof_upload_started: 1, proof_upload_selected: 1,
    proof_upload_removed: 1, proof_submit_started: 1, proof_submit_no_photo_blocked: 1,
    proof_submit_success: 1, proof_submit_failed: 1, proof_submit_duplicate_blocked: 1,
    proof_submit_rejected: 1, proof_submit_suspicious: 1,
    first_proof_complete: 1,
    proof_success_cta_standing: 1, proof_success_cta_next_task: 1,
    // retention
    tasks_view: 1, strategist_view: 1, standing_view: 1, profile_view: 1, settings_view: 1,
    daily_constraints_set: 1,
    // social
    friends_view: 1, friend_modal_opened: 1, invite_code_copied: 1,
    // trust
    privacy_view: 1, terms_view: 1, feedback_submitted: 1,
    // auth
    google_signin_started: 1, google_signin_failed: 1,
    apple_signin_started: 1, apple_signin_failed: 1, email_option_expanded: 1,
    password_reset_requested: 1, password_reset_view: 1, password_reset_success: 1,
    logout_clicked: 1, logout_success: 1,
    onboarding_view: 1, onboarding_step_completed: 1,
    // analyst
    analyst_view: 1, analyst_question_sent: 1,
    // connections
    connections_view: 1, connection_connect: 1, connection_disconnect: 1, connection_sync: 1,
    // reliability (failure beacons — no payload beyond allowlisted meta)
    onboarding_save_failed: 1, task_linter_fallback: 1
  };

  /* ── metadata key allowlist: only these keys may travel, and only as
        short primitives. Everything else is dropped. No email, no name,
        no note, no image path, no raw goal text can be expressed here. ── */
  var META_KEYS = {
    goal_domain: 1, path: 1, proof_count: 1, task_count: 1, xp_gained: 1,
    streak: 1, scope: 1, rating: 1, source: 1, ok: 1, duplicate: 1, reason: 1
  };

  var isDev = (function () {
    try {
      var h = location.hostname;
      return location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' ||
             h === '0.0.0.0' || h === '' || /\.local$/.test(h);
    } catch (e) { return false; }
  })();

  function looksSensitive(s) {
    return /@/.test(s) || /https?:\/\//i.test(s) || /\//.test(s) || s.length > 32;
  }

  function sanitize(meta) {
    var out = {};
    if (!meta || typeof meta !== 'object') return out;
    for (var k in meta) {
      if (!Object.prototype.hasOwnProperty.call(meta, k)) continue;
      if (META_KEYS[k] !== 1) continue;
      var v = meta[k];
      if (typeof v === 'number' && isFinite(v)) { out[k] = v; continue; }
      if (typeof v === 'boolean') { out[k] = v; continue; }
      if (typeof v === 'string') {
        var t = v.trim();
        if (t && !looksSensitive(t)) out[k] = t;
      }
    }
    return out;
  }

  function track(name, meta) {
    try {
      if (ALLOWED[name] !== 1) return;
      var data = sanitize(meta);
      if (isDev) {
        try { console.debug('[VISION analytics]', name, data); } catch (e) {}
      }
      if (typeof window.va === 'function') {
        try { window.va('event', { name: name, data: data }); } catch (e) {}
      }
    } catch (e) {}
  }

  V.analytics = { track: track };
})(window.VISION);
