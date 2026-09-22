/* ═══════════════════════════════════════════════════════════════
   supabase.js — VISION Supabase client bootstrap
   ---------------------------------------------------------------
   Loads the Supabase JS client (UMD global `supabase`, loaded via a
   <script> tag before this file) and creates VISION.sb from the public
   config in window.SUPABASE_CONFIG (js/supabase-config.js, gitignored,
   generated at build time by scripts/gen-config.cjs regardless of hosting
   provider). The anon key is public by design — RLS is the
   security boundary.

   If no config is present, VISION.sb stays null and the app runs in
   localStorage DEMO mode (vision-core.js / vision-friends.js).
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';
  var cfg = window.SUPABASE_CONFIG || {};
  var lib = window.supabase; // UMD global from the CDN script

  /* ── Environment identity guard ──────────────────────────────
     A previous Preview was accidentally wired to a non-VISION backend
     (wrong Supabase project → OAuth bounced to a foreign domain). This
     guard makes that class of mix-up impossible to miss: if the runtime
     backend is not an approved VISION project for this deployment, the
     app is blocked BEFORE any auth or camera use. No secrets shown. */
  var VISION_PROD_REF = 'qosaphtqksvocufjvtpa';
  var rt = window.VISION_RUNTIME || {};
  function refOf(u) {
    var m = /^https:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(u || '');
    return m ? m[1] : null;
  }
  var ref = refOf(cfg.url);
  var liveV3Requested = false;
  try { liveV3Requested = new URLSearchParams(location.search).get('live_v3') === '1'; } catch (e) {}
  var blockReason = null;
  if (rt.env === 'production' && ref && ref !== VISION_PROD_REF) blockReason = 'backend does not match the VISION production project';
  else if (rt.env === 'preview' && rt.expectedRef && ref && ref !== rt.expectedRef) blockReason = 'backend does not match this Preview’s expected staging project';
  else if (rt.env === 'preview' && liveV3Requested && ref === VISION_PROD_REF) blockReason = 'Live Proof V3 staging must not run against the production backend';

  /* Safe identity surface for diagnostics (no keys, no secrets). */
  V.envIdentity = { ref: ref, env: rt.env || null, commit: rt.commit || null, blocked: blockReason };

  if (blockReason) {
    V.sb = null;
    V.backend = false;
    V.envBlocked = blockReason;
    var show = function () {
      try {
        var d = document.createElement('div');
        d.setAttribute('role', 'alert');
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0a0b0e;' +
          'color:#e8ebf2;font:15px/1.6 -apple-system,system-ui,sans-serif;display:flex;' +
          'align-items:center;justify-content:center;text-align:center;padding:24px';
        d.innerHTML = '<div style="max-width:480px"><strong style="display:block;font-size:18px;margin-bottom:10px">Staging configuration error.</strong>' +
          'This VISION Preview is connected to the wrong backend.<br><br>' +
          '<span style="opacity:.7;font-size:13px">Reason: ' + blockReason + '. Login and proof submission are disabled.</span></div>';
        (document.body || document.documentElement).appendChild(d);
      } catch (e) {}
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
    return;
  }

  /* A real developer machine, where running without a backend is a legitimate
     design preview. Anything else — visionproof.app, a Vercel Preview, any other
     deployed host — is a real user-facing deployment. */
  V.isLocalDevHost = function () {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '' ||
           /\.local$/.test(h) || location.protocol === 'file:';
  };

  if (!lib || !lib.createClient || !cfg.url || !cfg.anonKey ||
      cfg.url.indexOf('YOUR-') === 0 || cfg.url.indexOf('YOUR-') > -1) {
    V.sb = null;
    V.backend = false;

    /* scripts/gen-config.cjs writes an EMPTY js/supabase-config.js when
       SUPABASE_URL / SUPABASE_ANON_KEY are missing at build time ("app will run
       in DEMO mode"). On a deployed host that used to fail silently: sign-in did
       nothing, and every page fell back to its bundled demo data — a localStorage
       goal, locally invented tasks, and the sample Live Intelligence workspace —
       which is indistinguishable from a working app showing wrong data.
       A deployed build with no backend is a broken deployment. Say so. */
    if (!V.isLocalDevHost()) {
      V.envBlocked = 'backend not configured for this deployment';
      var warn = function () {
        try {
          if (document.getElementById('visionBackendMisconfigured')) return;
          var d = document.createElement('div');
          d.id = 'visionBackendMisconfigured';
          d.setAttribute('role', 'alert');
          d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0a0b0e;' +
            'color:#e8ebf2;font:15px/1.6 -apple-system,system-ui,sans-serif;display:flex;' +
            'align-items:center;justify-content:center;text-align:center;padding:24px';
          d.innerHTML = '<div style="max-width:480px"><strong style="display:block;font-size:18px;margin-bottom:10px">Backend not configured.</strong>' +
            'This deployment was built without its Supabase settings, so sign-in, tasks, Analyst and Live Intelligence cannot work.<br><br>' +
            '<span style="opacity:.7;font-size:13px">Set SUPABASE_URL and SUPABASE_ANON_KEY for this environment in the hosting provider\'s project settings and redeploy. No sample or offline data is shown, because none of it would be yours.</span></div>';
          (document.body || document.documentElement).appendChild(d);
        } catch (e) {}
      };
      if (document.body) warn(); else document.addEventListener('DOMContentLoaded', warn);
    }
    return;
  }

  V.sb = lib.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
  V.backend = true;

  /* Google OAuth sign-in — used by vision.html "Find My Rank" / "Claim My Position" buttons */
  V.signInWithGoogle = async function (redirectPath) {
    try {
      var r = await V.sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + (redirectPath || '/login.html') }
      });
      if (r.error) { console.warn('[VISION] Google sign-in error:', r.error.message); return { ok: false, error: r.error.message }; }
      return { ok: true };
    } catch (e) { console.warn('[VISION] Google sign-in exception:', e); return { ok: false, error: String(e) }; }
  };
})(window.VISION);
