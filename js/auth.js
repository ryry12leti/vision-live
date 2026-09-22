/* ═══════════════════════════════════════════════════════════════
   auth.js — VISION auth helpers (Supabase Auth)
   ═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';
  var sb = V.sb;

  async function getSession() {
    if (!sb) return null;
    try { var r = await sb.auth.getSession(); return (r.data && r.data.session) || null; }
    catch (e) { return null; }
  }
  async function getUser() {
    var s = await getSession();
    return s ? s.user : null;
  }
  async function signUp(email, password, meta) {
    if (!sb) return { error: { message: 'No backend configured' } };
    return sb.auth.signUp({ email: email, password: password, options: { data: meta || {} } });
  }
  async function signIn(email, password) {
    if (!sb) return { error: { message: 'No backend configured' } };
    return sb.auth.signInWithPassword({ email: email, password: password });
  }
  async function signOut() {
    if (!sb) return { error: null };
    return sb.auth.signOut();
  }
  async function signOutAll() {
    if (!sb) return { error: null };
    return sb.auth.signOut({ scope: 'global' });
  }
  async function signInWithGoogle() {
    if (!sb) return { error: { message: 'Backend not configured' } };
    return sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/login.html' }
    });
  }
  async function signInWithApple() {
    if (!sb) return { error: { message: 'Backend not configured' } };
    return sb.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: window.location.origin + '/login.html' }
    });
  }
  async function resetPasswordForEmail(email) {
    if (!sb) return { error: { message: 'No backend configured' } };
    return sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password.html'
    });
  }
  async function updatePassword(newPassword) {
    if (!sb) return { error: { message: 'No backend configured' } };
    return sb.auth.updateUser({ password: newPassword });
  }
  async function resendConfirmation(email) {
    if (!sb) return { error: { message: 'No backend configured' } };
    return sb.auth.resend({ type: 'signup', email: email });
  }
  function onChange(cb) {
    if (sb) sb.auth.onAuthStateChange(function (_e, s) { cb(s); });
  }

  var LEGAL_VERSION = '2026-06-21';
  var PENDING_CONSENT_KEY = 'vision_pending_consent';

  function stagePendingConsent() {
    try {
      var at = new Date().toISOString();
      sessionStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify({
        terms_accepted_at: at, privacy_accepted_at: at, legal_version: LEGAL_VERSION
      }));
    } catch (e) {}
  }

  async function flushPendingConsent() {
    if (!sb) return;
    var raw;
    try { raw = sessionStorage.getItem(PENDING_CONSENT_KEY); } catch (e) { return; }
    if (!raw) return;
    var c;
    try { c = JSON.parse(raw); }
    catch (e) {
      try { sessionStorage.removeItem(PENDING_CONSENT_KEY); } catch (e2) {}
      return;
    }
    if (!c || !c.terms_accepted_at) return;
    try {
      var r = await sb.rpc('record_consent', {
        p_terms: c.terms_accepted_at,
        p_privacy: c.privacy_accepted_at || c.terms_accepted_at,
        p_version: c.legal_version || LEGAL_VERSION
      });
      if (!r.error) {
        try { sessionStorage.removeItem(PENDING_CONSENT_KEY); } catch (e3) {}
      }
    } catch (e) {}
  }

  async function deleteAccountSecure() {
    if (!sb) return { error: 'backend_not_configured' };
    var existing = await getSession();
    if (!existing) return { error: 'not_authenticated' };

    /* The deletion endpoint accepts only an access token issued in the previous
       30 minutes. Refresh first so a stolen old tab cannot delete an account. */
    try {
      var refreshed = await sb.auth.refreshSession();
      if (refreshed.error || !(refreshed.data && refreshed.data.session)) {
        return { error: 'recent_auth_required' };
      }
    } catch (e) { return { error: 'recent_auth_required' }; }

    try {
      var result = await sb.functions.invoke('delete-account', {
        body: { confirm: 'DELETE' }
      });
      if (result.error || !(result.data && result.data.ok === true)) {
        return {
          error: (result.data && result.data.error) || 'account_delete_failed'
        };
      }
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e2) {}
      return result.data;
    } catch (e) { return { error: 'account_delete_failed' }; }
  }

  /* auth.js loads before vision-api.js. Intercept the later V.api assignment and
     replace only deleteAccount, ensuring stale bundles cannot call the obsolete
     SQL deletion function. All other API methods remain untouched. */
  function installSecureApiOverride() {
    var slot = V.api;
    function secure(api) {
      if (api && typeof api === 'object') api.deleteAccount = deleteAccountSecure;
      return api;
    }
    try {
      var descriptor = Object.getOwnPropertyDescriptor(V, 'api');
      if (!descriptor || descriptor.configurable !== false) {
        Object.defineProperty(V, 'api', {
          configurable: true,
          enumerable: true,
          get: function () { return slot; },
          set: function (value) { slot = secure(value); }
        });
        slot = secure(slot);
      } else if (slot) secure(slot);
    } catch (e) {
      if (V.api) V.api.deleteAccount = deleteAccountSecure;
    }
  }

  async function requireAuth(redirect) {
    if (!V.backend) return null;
    var s = await getSession();
    if (!s) { location.replace(redirect || 'login.html'); return null; }
    return s;
  }
  async function isAuthed() {
    if (!V.backend) return false;
    return !!(await getSession());
  }
  async function isOnboarded() {
    if (!sb) return true;
    var u = await getUser();
    if (!u) return false;
    var r = await sb.from('profiles').select('onboarding_complete').eq('id', u.id).maybeSingle();
    if (r.error) {
      var ex = await sb.from('profiles').select('id').eq('id', u.id).maybeSingle();
      return !!ex.data;
    }
    if (!r.data) return false;
    if (r.data.onboarding_complete === false) return false;
    return true;
  }

  var NEXT_KEY = 'vision_next_path';
  function safeRelativePath(p) {
    if (typeof p !== 'string' || !p) return null;
    if (p.charAt(0) !== '/') return null;
    if (p.charAt(1) === '/' || p.charAt(1) === '\\') return null;
    if (p.indexOf('://') > -1 || p.indexOf('\\') > -1) return null;
    return p;
  }
  function stageNextFromUrl() {
    try {
      var n = safeRelativePath(new URLSearchParams(location.search).get('next'));
      if (n) sessionStorage.setItem(NEXT_KEY, n);
    } catch (e) {}
  }
  function takeNext() {
    try {
      var n = safeRelativePath(sessionStorage.getItem(NEXT_KEY));
      sessionStorage.removeItem(NEXT_KEY);
      return n;
    } catch (e) { return null; }
  }
  stageNextFromUrl();

  async function destinationAfterAuth() {
    if (!(await isOnboarded())) return 'onboarding.html';
    return takeNext() || 'dashboard.html';
  }
  async function requireOnboarded(loginRedirect, onboardingRedirect) {
    if (!V.backend) return null;
    var s = await getSession();
    if (!s) { location.replace(loginRedirect || 'login.html'); return null; }
    if (!(await isOnboarded())) {
      location.replace(onboardingRedirect || 'onboarding.html');
      return null;
    }
    return s;
  }

  V.auth = {
    getSession: getSession, getUser: getUser,
    signUp: signUp, signIn: signIn, signOut: signOut, signOutAll: signOutAll,
    signInWithGoogle: signInWithGoogle, signInWithApple: signInWithApple,
    resetPasswordForEmail: resetPasswordForEmail, updatePassword: updatePassword,
    resendConfirmation: resendConfirmation,
    deleteAccount: deleteAccountSecure,
    onChange: onChange, requireAuth: requireAuth, isAuthed: isAuthed,
    isOnboarded: isOnboarded, destinationAfterAuth: destinationAfterAuth,
    requireOnboarded: requireOnboarded,
    LEGAL_VERSION: LEGAL_VERSION, safeRelativePath: safeRelativePath,
    stagePendingConsent: stagePendingConsent, flushPendingConsent: flushPendingConsent,
    configured: !!sb
  };
  installSecureApiOverride();
})(window.VISION);
