/* ═══════════════════════════════════════════════════════════════
   supabase-client.js — landing-page Supabase bootstrap (index.html)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* Keep the landing hero clean. The full app explanation lives on the
     verified public purpose page, not in the hero. */
  function cleanLandingHero() {
    var isLanding = location.pathname === '/' || location.pathname.endsWith('/index.html');
    if (!isLanding) return;
    var purpose = document.querySelector('.hero-purpose');
    var loaderDescription = document.querySelector('.lo-desc');
    if (purpose) purpose.remove();
    if (loaderDescription) loaderDescription.remove();
  }

  cleanLandingHero();

  var cfg = window.SUPABASE_CONFIG || {};
  var lib = window.supabase;

  if (!lib || !lib.createClient || !cfg.url || !cfg.anonKey ||
      cfg.url.indexOf('YOUR-') > -1) {
    return;
  }

  var client = lib.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
  });
  window.sbClient = client;

  window.sbSignInWithGoogle = async function (redirectPath) {
    try {
      var r = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + (redirectPath || '/onboarding.html') }
      });
      if (r.error) { console.warn('[VISION] Google sign-in error:', r.error.message); location.href = 'login.html'; }
    } catch (e) {
      console.warn('[VISION] Google sign-in exception:', e);
      location.href = 'login.html';
    }
  };
})();
