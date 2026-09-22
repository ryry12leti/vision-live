/* ═══════════════════════════════════════════════════════════════
   vision-connections.js — VISION Connections client (VISION.connections)
   ---------------------------------------------------------------
   Thin wrapper over the connections-* Edge Functions. The browser NEVER
   sees a token — it only ever asks the server to start/stop a connection,
   trigger a sync, and read back SAFE status + summarised context.

   Demo mode (no Supabase session): every method resolves to a safe empty
   result so pages that use it degrade gracefully to "no connections".

   Public API:
     VISION.connections.status()               -> { providers:[...] }
     VISION.connections.start(provider)         -> redirects, or {configured:false}
     VISION.connections.disconnect(provider)    -> { status:'disconnected' }
     VISION.connections.syncNow(provider)       -> { ok, insight_count }
     VISION.connections.context()               -> { context:{ facts, structured, connected } }
   ═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};
(function (V) {
  'use strict';

  function sb() { return V.sb || null; }
  function live() { try { return !!(V.data && V.data.live && V.data.live()) || !!sb(); } catch (e) { return !!sb(); } }
  function tzOffset() { try { return new Date().getTimezoneOffset(); } catch (e) { return 0; } }

  // Uniform invoke: returns parsed data or throws a short error code.
  async function call(fn, body) {
    var client = sb();
    if (!client) throw new Error('not_signed_in');
    var res = await client.functions.invoke(fn, { body: body || {} });
    if (res && res.error) {
      var code = 'request_failed';
      try {
        if (res.error.context && typeof res.error.context.json === 'function') {
          var j = await res.error.context.json();
          code = (j && j.error) || code;
        }
      } catch (e) {}
      var err = new Error(code); err.code = code; throw err;
    }
    return (res && res.data) || {};
  }

  async function status() {
    if (!live()) return { providers: [] };
    try { return await call('connections-status', {}); }
    catch (e) { return { providers: [], error: e.code || 'request_failed' }; }
  }

  // Returns {configured:false} when the provider OAuth client isn't set up yet;
  // otherwise navigates the browser to the provider's consent screen.
  async function start(provider) {
    if (!live()) return { error: 'not_signed_in' };
    var data = await call('connections-start', { provider: provider, tzOffsetMin: tzOffset() });
    if (data && data.configured === false) return { configured: false };
    if (data && data.authorize_url) {
      try { V.analytics && V.analytics.track && V.analytics.track('connection_connect', { source: provider }); } catch (e) {}
      window.location.href = data.authorize_url;
      return { redirecting: true };
    }
    return { error: 'no_url' };
  }

  async function disconnect(provider) {
    if (!live()) return { error: 'not_signed_in' };
    var data = await call('connections-disconnect', { provider: provider });
    try { V.analytics && V.analytics.track && V.analytics.track('connection_disconnect', { source: provider }); } catch (e) {}
    return data;
  }

  async function syncNow(provider) {
    if (!live()) return { error: 'not_signed_in' };
    var data = await call('connections-sync', { provider: provider, tzOffsetMin: tzOffset() });
    try { V.analytics && V.analytics.track && V.analytics.track('connection_sync', { source: provider, ok: !!(data && data.ok) }); } catch (e) {}
    return data;
  }

  async function context() {
    if (!live()) return { context: { facts: [], structured: {}, connected: [] } };
    try { return await call('connections-context', {}); }
    catch (e) { return { context: { facts: [], structured: {}, connected: [] } }; }
  }

  V.connections = { status: status, start: start, disconnect: disconnect, syncNow: syncNow, context: context };
})(window.VISION);
