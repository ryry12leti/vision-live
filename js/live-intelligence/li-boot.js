/* ═══════════════════════════════════════════════════════════════
   li-boot.js — standalone Live Intelligence bootstrap
   ---------------------------------------------------------------
   Reuses the canonical Supabase client when the full VISION shell is
   present and records honest startup diagnostics for standalone use.

   Public API: window.VISION.liBoot
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  /* NO PROJECT REF LIVES HERE. This file used to hardcode the production
     project, which had three consequences: the diagnostic called any other
     backend "NOT the expected production backend" even when staging was
     exactly what was wanted, `boot.projectRef` reported production no matter
     what was actually configured, and Live Intelligence read as
     production-only to anyone auditing it.

     The environment is resolved exactly where every other VISION page
     resolves it — js/supabase.js, which derives the ref from the configured
     URL and applies the production/preview rules — and this file consumes
     that verdict rather than re-deriving or overriding it. */

  function step(label) { return { label: label, ok: null, detail: '' }; }

  var diagnostics = {
    supabaseLibrary: step('Supabase client library'),
    config: step('Supabase configuration'),
    client: step('Supabase client created'),
    session: step('Authenticated session'),
    workspaceRpc: step('Workspace RPC reachable'),
    error: null,
    projectRef: null,
    startedAt: new Date().toISOString()
  };

  function fail(target, detail) {
    target.ok = false;
    target.detail = String(detail || '').slice(0, 400);
  }
  function pass(target, detail) {
    target.ok = true;
    target.detail = String(detail || '').slice(0, 400);
  }

  var lib = window.supabase;
  if (!lib || typeof lib.createClient !== 'function') {
    fail(diagnostics.supabaseLibrary,
      'window.supabase is missing. The CDN script did not load — check the network, or an extension blocking cdn.jsdelivr.net.');
  } else {
    pass(diagnostics.supabaseLibrary, 'UMD global loaded from cdn.jsdelivr.net');
  }

  var cfg = window.SUPABASE_CONFIG || null;
  if (!cfg) {
    fail(diagnostics.config,
      'window.SUPABASE_CONFIG is undefined. js/supabase-config.js is missing. Copy js/supabase-config.example.js to js/supabase-config.js and fill in the project URL and anon key.');
  } else if (!cfg.url || !cfg.anonKey) {
    fail(diagnostics.config, 'js/supabase-config.js is present but url or anonKey is empty.');
  } else if (String(cfg.url).indexOf('YOUR-') > -1) {
    fail(diagnostics.config, 'js/supabase-config.js still contains the placeholder values from the example file.');
  } else {
    var match = /^https:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(cfg.url);
    diagnostics.projectRef = match ? match[1] : null;
    /* The shared guard's answer, when the shell is present. It already knows
       which project this deployment is allowed to talk to. */
    var identity = V.envIdentity || null;
    diagnostics.env = (identity && identity.env) || (window.VISION_RUNTIME || {}).env || null;
    if (identity && identity.blocked) {
      fail(diagnostics.config, 'environment guard blocked this backend: ' + identity.blocked);
    } else {
      pass(diagnostics.config, 'project ' + (diagnostics.projectRef || 'unknown')
        + (diagnostics.env ? ' (' + diagnostics.env + ')' : ''));
    }
  }

  /* A BLOCKED ENVIRONMENT MUST NOT GET A CLIENT BY THE BACK DOOR. When
     js/supabase.js refuses a backend it sets V.sb = null — and the branch
     below then built a fresh, unguarded client from the same config, which
     defeated the block entirely. The whole point of the guard is that a page
     wired to the wrong project cannot reach it, so a null V.sb caused by a
     refusal is a stop, not an invitation to make our own. */
  if (V.envBlocked) {
    V.sb = null;
    fail(diagnostics.client, 'refused: ' + V.envBlocked);
  } else if (V.sb) {
    pass(diagnostics.client, 'reusing canonical client from js/supabase.js');
  } else if (diagnostics.supabaseLibrary.ok && diagnostics.config.ok) {
    try {
      V.sb = lib.createClient(cfg.url, cfg.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      pass(diagnostics.client, 'standalone client created (js/supabase.js absent)');
    } catch (error) {
      V.sb = null;
      fail(diagnostics.client, error && error.message ? error.message : String(error));
    }
  } else {
    V.sb = null;
  }

  var boot = {
    diagnostics: diagnostics,
    /* THE PROJECT ACTUALLY IN USE, resolved from the configured URL. This
       reported the hardcoded production ref regardless of what the page was
       connected to — a field whose only job is to say where we are, lying
       whenever we were anywhere else. */
    projectRef: diagnostics.projectRef,
    env: diagnostics.env || null,

    probe: async function () {
      if (!diagnostics.supabaseLibrary.ok || !diagnostics.config.ok || !diagnostics.client.ok) {
        diagnostics.error = 'Startup stopped before a Supabase client could be created.';
        return { canProceed: false, session: null, diagnostics: diagnostics };
      }

      var session = null;
      try {
        var sessionResult = await V.sb.auth.getSession();
        if (sessionResult.error) throw sessionResult.error;
        session = (sessionResult.data && sessionResult.data.session) || null;
        if (session) {
          pass(diagnostics.session, 'restored for ' +
            (session.user && session.user.email ? session.user.email : session.user.id));
        } else {
          diagnostics.session.ok = null;
          diagnostics.session.detail = 'no stored session — sign in below';
        }
      } catch (error) {
        fail(diagnostics.session, error && error.message ? error.message : String(error));
        diagnostics.error = 'Could not read the stored session.';
        return { canProceed: false, session: null, diagnostics: diagnostics };
      }

      if (!session) {
        diagnostics.workspaceRpc.ok = null;
        diagnostics.workspaceRpc.detail = 'not attempted — requires a session';
        return { canProceed: true, session: null, diagnostics: diagnostics };
      }

      try {
        var response = await V.sb.rpc('live_intelligence_list_workspaces', {
          p_include_archived: false,
          p_limit: 1,
          p_offset: 0
        });
        if (response.error) throw response.error;
        var count = Array.isArray(response.data) ? response.data.length : 0;
        pass(diagnostics.workspaceRpc,
          'live_intelligence_list_workspaces answered (' + count + ' workspace' +
          (count === 1 ? '' : 's') + ' visible)');
        return { canProceed: true, session: session, diagnostics: diagnostics };
      } catch (error) {
        fail(diagnostics.workspaceRpc,
          (error && error.code ? '[' + error.code + '] ' : '') +
          (error && error.message ? error.message : String(error)));
        diagnostics.error = 'The backend rejected or did not answer the workspace request.';
        return { canProceed: false, session: session, diagnostics: diagnostics };
      }
    },

    signIn: async function (email, password) {
      if (!V.sb) return { ok: false, message: 'No Supabase client. See the startup diagnostics.' };
      try {
        var result = await V.sb.auth.signInWithPassword({ email: email, password: password });
        if (result.error) return { ok: false, message: result.error.message };
        return { ok: true, session: result.data.session };
      } catch (error) {
        return { ok: false, message: error && error.message ? error.message : String(error) };
      }
    },

    signOut: async function () {
      if (!V.sb) return;
      try { await V.sb.auth.signOut(); } catch (error) { /* already gone */ }
    }
  };

  V.liBoot = boot;

  /* The continuous layer starts after the synchronous workspace app and page
     controller have bound their DOM. This keeps the existing controller
     untouched and makes an extension-load failure non-destructive. */
  function loadContinuousLayer() {
    if (document.querySelector('script[data-live-intelligence-continuous]')) return;
    var script = document.createElement('script');
    script.src = 'js/live-intelligence-continuous.js';
    script.async = false;
    script.setAttribute('data-live-intelligence-continuous', '');
    script.onerror = function () {
      try { console.error('Continuous Live Intelligence failed to load.'); } catch (error) {}
    };
    (document.head || document.documentElement).appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadContinuousLayer, { once: true });
  } else {
    setTimeout(loadContinuousLayer, 0);
  }
})(window.VISION);
