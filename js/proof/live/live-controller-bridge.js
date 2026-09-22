/* VISION Live controller bridge — the single adapter between the mature Tasks
   Live UI and the unified Live runtime (js/proof/live/live-runtime.js).

   It deliberately wraps the production controller instead of replacing it, and
   it is the ONLY place that wraps either surface:

     · window.*        — queueLiveClaimEvent, startLiveCoaching, updateLiveHud,
                         stopLiveSession, closeLive, finishLive
     · VISION.api.live* — liveSessionStart, liveSessionEvent, liveSessionFinish

   Owning both sides in one file is what removes the old wrapper-on-wrapper
   behaviour: session start is negotiated, keyed and retried exactly once, and
   ordered evidence has exactly one queue behind it.

   Server authority is untouched. This file never decides whether a rep, a
   session or a reward is valid — it only guarantees ordered, exactly-once
   delivery of consented evidence and honest failure surfacing. */
(function () {
  'use strict';

  var installed = false;
  var timer = null;
  var attempts = 0;
  var runtime = null;
  var originals = null;
  var pendingStartRequest = null;
  var lastFinishRequest = null;
  var protocolState = { sessionId: null, protocol: 'legacy-v1', version: 1 };

  var EVIDENCE_PROTOCOL = 'phase-v2';
  var MIN_PROTOCOL_VERSION = 2;
  var START_RETRY_ATTEMPTS = 3;

  function foundation() {
    return (window.VISION && window.VISION.liveRuntime) || null;
  }

  function retryTransport(fn, args) {
    var api = foundation();
    if (!api || typeof api.retry !== 'function') return Promise.resolve(fn.apply(null, args || []));
    return api.retry(function () {
      return Promise.resolve(fn.apply(null, args || [])).then(function (result) {
        /* A transport-shaped error returned in the body (rather than thrown)
           must retry too; a server decision must not. */
        if (result && result.error && retryable(result.error)) throw new Error(String(result.error));
        return result;
      });
    }, { attempts: START_RETRY_ATTEMPTS });
  }

  function retryable(error) {
    var api = foundation();
    if (api && typeof api.isRetryableTransportError === 'function') return api.isRetryableTransportError(error);
    return /failed to fetch|network|timeout|abort|connection|offline|502|503|504/i.test(String((error && error.message) || error || ''));
  }

  function canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + canonical(value[key]);
    }).join(',') + '}';
  }

  function startSignature(taskId, device) {
    try { return String(taskId || '') + '|' + canonical(device || {}); }
    catch (_) { return String(taskId || '') + '|' + JSON.stringify(device || {}); }
  }

  function createStartId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return 'live-' + window.crypto.randomUUID();
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        var bytes = new Uint32Array(4);
        window.crypto.getRandomValues(bytes);
        return 'live-' + Array.prototype.map.call(bytes, function (value) { return value.toString(36); }).join('-');
      }
    } catch (_) {}
    return 'live-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  }

  function hasController() {
    return typeof window.startLiveCoaching === 'function' && typeof window.stopLiveSession === 'function' &&
      typeof window.closeLive === 'function' && typeof window.queueLiveClaimEvent === 'function' &&
      typeof window.updateLiveHud === 'function';
  }

  function apiSurface() {
    return window.VISION && window.VISION.api ? window.VISION.api : null;
  }

  function resetProtocol() {
    protocolState = { sessionId: null, protocol: 'legacy-v1', version: 1 };
  }

  /* ── VISION.api.live* — wrapped once, at install ────────────────────────── */
  function wrapDirectApis() {
    var api = apiSurface();
    if (!api || !originals) return;

    if (typeof api.liveSessionStart === 'function' && !api.liveSessionStart.__visionLiveBridge) {
      var rawStart = api.liveSessionStart.bind(api);
      originals.apiStart = rawStart;
      var startBridge = async function (taskId, device) {
        resetProtocol();
        var requestedDevice = device && typeof device === 'object' && !Array.isArray(device) ? Object.assign({}, device) : {};
        delete requestedDevice.client_start_id;
        /* Phase-v2 is the only protocol this client speaks. Requesting it here
           (rather than in a second wrapper) keeps negotiation, the start key
           and the retry budget in one place. */
        requestedDevice.evidence_protocol = EVIDENCE_PROTOCOL;
        var signature = startSignature(taskId, requestedDevice);
        /* One start key per distinct request. Re-using it across automatic and
           manual retries is what lets the server return the stored receipt
           instead of opening a second session. */
        if (!pendingStartRequest || pendingStartRequest.signature !== signature) {
          pendingStartRequest = { signature: signature, key: createStartId(), taskId: String(taskId || '') };
        }
        var requestDevice = Object.assign({}, requestedDevice, { client_start_id: pendingStartRequest.key });
        var result;
        try {
          result = await retryTransport(rawStart, [taskId, requestDevice]);
        } catch (error) {
          /* A non-transport failure will not succeed on retry, so the key is
             released; a transport failure keeps it for the user's retry. */
          if (!retryable(error)) pendingStartRequest = null;
          throw error;
        }
        if (result && result.error) {
          pendingStartRequest = null;
          return result;
        }
        var negotiated = String((result && result.evidence_protocol) || 'legacy-v1');
        var version = Math.max(1, Number(result && result.evidence_protocol_version) || 1);
        if (!(result && result.session_id) || negotiated !== EVIDENCE_PROTOCOL || version < MIN_PROTOCOL_VERSION) {
          /* Fail closed: without a negotiated phase stream the server cannot
             reconstruct reps, so no session may proceed. */
          pendingStartRequest = null;
          throw new Error('phase_evidence_protocol_unavailable');
        }
        protocolState = { sessionId: String(result.session_id), protocol: negotiated, version: version };
        try { if (typeof CAP !== 'undefined' && CAP) CAP.evidenceProtocolVersion = version; } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('vision:live-protocol-negotiated', { detail: { sessionId: protocolState.sessionId, version: version } })); } catch (_) {}
        pendingStartRequest = null;
        return result;
      };
      startBridge.__visionLiveBridge = true;
      startBridge.__visionOriginal = rawStart;
      api.liveSessionStart = startBridge;
    }

    if (typeof api.liveSessionEvent === 'function' && !api.liveSessionEvent.__visionLiveBridge) {
      var rawEvent = api.liveSessionEvent.bind(api);
      originals.apiEvent = rawEvent;
      /* Direct callers (the session-start handshake) retry here; queued
         evidence retries inside the queue against the raw function, so a
         single event is never retried by two engines. */
      var eventBridge = function () { return retryTransport(rawEvent, Array.prototype.slice.call(arguments)); };
      eventBridge.__visionLiveBridge = true;
      eventBridge.__visionOriginal = rawEvent;
      api.liveSessionEvent = eventBridge;
    }

    if (typeof api.liveSessionFinish === 'function' && !api.liveSessionFinish.__visionLiveBridge) {
      var rawFinish = api.liveSessionFinish.bind(api);
      originals.apiFinish = rawFinish;
      var finishBridge = function () {
        var args = Array.prototype.slice.call(arguments);
        lastFinishRequest = { raw: rawFinish, args: args, sessionId: String(args[0] || '') };
        return retryTransport(rawFinish, args);
      };
      finishBridge.__visionLiveBridge = true;
      finishBridge.__visionOriginal = rawFinish;
      api.liveSessionFinish = finishBridge;
    }
  }

  function rawEventApi() {
    var api = apiSurface();
    if (!api || typeof api.liveSessionEvent !== 'function') return null;
    return api.liveSessionEvent.__visionOriginal || (originals && originals.apiEvent) || api.liveSessionEvent.bind(api);
  }

  function attachSender(activeRuntime) {
    if (!(activeRuntime && activeRuntime.evidence && activeRuntime.evidence.setSender)) return;
    if (activeRuntime.evidence.__visionSenderBound) return;
    activeRuntime.evidence.__visionSenderBound = true;
    activeRuntime.evidence.setSender(async function (event) {
      var sender = rawEventApi();
      if (!sender) throw new Error('live_event_api_unavailable');
      var result = await sender(event.sessionId, event.sequence, event.clientMonotonicMs, event.type, event.payload || {});
      var accepted = result && (result.accepted_as_client_claim === true || result.accepted_as_phase_observation === true);
      if (!accepted || result.error) throw new Error(String((result && result.error) || 'live_event_not_accepted'));
      return result;
    });
  }

  function currentRuntime() {
    var api = foundation();
    if (!api || typeof api.getSingleton !== 'function') return null;
    var active = api.getSingleton();
    if (active !== runtime) {
      runtime = active;
      attachSender(runtime);
    }
    return runtime;
  }

  function statusError() {
    try {
      var node = document.getElementById('tdStatus');
      if (node) {
        node.textContent = 'VISION could not reach the server. Your ordered Live evidence is saved in this session — keep this page open and retry.';
        node.className = 'td-submit-status err';
      }
    } catch (_) {}
  }

  async function flushForCompletion() {
    var activeRuntime = currentRuntime();
    if (!(activeRuntime && activeRuntime.evidence)) return false;
    try { await activeRuntime.evidence.flush(); return true; }
    catch (_) { statusError(); return false; }
  }

  function cleanupCaptureHandlers() {
    try {
      var pending = typeof CAP !== 'undefined' && Array.isArray(CAP.cleanup) ? CAP.cleanup.slice() : [];
      if (typeof CAP !== 'undefined' && Array.isArray(CAP.cleanup)) CAP.cleanup.length = 0;
      pending.forEach(function (fn) { try { fn(); } catch (_) {} });
    } catch (_) {}
  }

  function snapshot() {
    var activeRuntime = currentRuntime();
    var value = activeRuntime && activeRuntime.snapshot ? activeRuntime.snapshot() : {};
    var cleanupCount = 0;
    try { cleanupCount = typeof CAP !== 'undefined' && Array.isArray(CAP.cleanup) ? CAP.cleanup.length : 0; } catch (_) {}
    value.bridge = {
      installed: installed,
      transport: (value.evidence && value.evidence.transport) || (foundation() && foundation().transport) || 'unknown',
      activeStreams: value.camera && value.camera.active ? 1 : 0,
      activeTracks: activeRuntime && activeRuntime.camera && activeRuntime.camera.activeStream && activeRuntime.camera.activeStream.getVideoTracks ? activeRuntime.camera.activeStream.getVideoTracks().filter(function (track) { return track.readyState === 'live'; }).length : 0,
      runtimeModelEntries: value.models ? Object.keys(value.models).length : 0,
      runtimeInferenceLoops: value.inference && value.inference.running ? 1 : 0,
      controllerBound: !!value.controllerBound,
      evidenceQueues: activeRuntime && activeRuntime.evidence ? 1 : 0,
      cameraLifecycleHandlers: cleanupCount,
      evidenceProtocol: protocolState.protocol,
      evidenceProtocolVersion: protocolState.version,
      pendingStartRequest: pendingStartRequest ? { taskId: pendingStartRequest.taskId, keyPresent: true } : null
    };
    return value;
  }

  function restore() {
    if (!originals) return;
    window.startLiveCoaching = originals.start;
    window.stopLiveSession = originals.stop;
    window.closeLive = originals.close;
    window.queueLiveClaimEvent = originals.queue;
    window.updateLiveHud = originals.hud;
    if (originals.finish) window.finishLive = originals.finish;
    var api = apiSurface();
    if (api && originals.apiStart && api.liveSessionStart && api.liveSessionStart.__visionLiveBridge) api.liveSessionStart = originals.apiStart;
    if (api && originals.apiEvent && api.liveSessionEvent && api.liveSessionEvent.__visionLiveBridge) api.liveSessionEvent = originals.apiEvent;
    if (api && originals.apiFinish && api.liveSessionFinish && api.liveSessionFinish.__visionLiveBridge) api.liveSessionFinish = originals.apiFinish;
  }

  function install() {
    if (installed) return true;
    if (!foundation() || !hasController()) return false;
    originals = {
      start: window.startLiveCoaching, stop: window.stopLiveSession, close: window.closeLive,
      queue: window.queueLiveClaimEvent, hud: window.updateLiveHud,
      finish: typeof window.finishLive === 'function' ? window.finishLive : null,
      apiStart: null, apiEvent: null, apiFinish: null
    };
    wrapDirectApis();
    runtime = null;
    var active = currentRuntime();
    if (!(active && active.evidence && active.recovery)) { originals = null; return false; }

    window.queueLiveClaimEvent = function (type, payload) {
      var activeRuntime = currentRuntime();
      var api = apiSurface();
      var sessionId = null;
      try { sessionId = typeof CAP !== 'undefined' && CAP.liveSessionId ? CAP.liveSessionId : null; } catch (_) {}
      if (!(activeRuntime && activeRuntime.evidence && api && sessionId)) return originals.queue(type, payload);
      /* The sequence is claimed synchronously, so call order is delivery order;
         the queue then guarantees the server sees it in that order exactly once. */
      var sequence = ++CAP.liveSequence;
      var event = {
        idempotencyKey: String(sessionId) + ':' + String(sequence) + ':' + String(type || 'event'),
        sessionId: sessionId, sequence: sequence, clientMonotonicMs: performance.now(),
        type: type, payload: payload || {}
      };
      var delivery = activeRuntime.evidence.enqueue(event);
      CAP.eventQueue = delivery.catch(function () { return null; });
      return delivery;
    };

    window.startLiveCoaching = async function () {
      var result = await originals.start.apply(this, arguments);
      try {
        var activeRuntime = currentRuntime();
        if (activeRuntime && typeof CAP !== 'undefined' && CAP && CAP.coach) activeRuntime.bindController(CAP.coach);
      } catch (_) {}
      window.__visionLiveRuntimeSnapshot = snapshot;
      return result;
    };

    window.updateLiveHud = function (state) {
      var activeRuntime = currentRuntime();
      var recovery = activeRuntime && activeRuntime.recovery ? activeRuntime.recovery.update(!!(state && state.poseTracking)) : { state: 'lost', canProgress: false };
      if (state && typeof state === 'object') {
        state.runtimeRecoveryState = recovery.state;
        state.runtimeCanProgress = recovery.canProgress;
      }
      window.__visionLiveRuntimeSnapshot = snapshot;
      return originals.hud.call(this, state);
    };

    window.stopLiveSession = async function () {
      if (!(await flushForCompletion())) return false;
      var activeRuntime = currentRuntime();
      var result = await originals.stop.apply(this, arguments);
      /* A refused stop is retryable: the camera, controller and queue stay
         alive so the user can finish the exact same session. */
      if (result === false) return false;
      cleanupCaptureHandlers();
      try { if (activeRuntime) { activeRuntime.bindController(null); activeRuntime.camera.stop(); } } catch (_) {}
      /* The session is over: a stale negotiated protocol must not be inherited
         by the next session started in this tab. */
      resetProtocol();
      return result;
    };

    window.closeLive = function () {
      var activeRuntime = currentRuntime();
      if (activeRuntime && activeRuntime.evidence) {
        /* Abandon still finalises: queued evidence must reach the server before
           the session is cancelled, or the server sees a truncated stream. */
        var flushing = activeRuntime.evidence.flush();
        try { if (typeof CAP !== 'undefined') CAP.eventQueue = flushing; } catch (_) {}
        flushing.catch(function () {});
      }
      var result = originals.close.apply(this, arguments);
      try { if (activeRuntime) { activeRuntime.bindController(null); activeRuntime.camera.stop(); activeRuntime.inference.stop(); } } catch (_) {}
      resetProtocol();
      return result;
    };

    if (originals.finish) window.finishLive = async function () {
      if (!(await flushForCompletion())) return false;
      try {
        return await originals.finish.apply(this, arguments);
      } catch (error) {
        /* A lost finish response is retried with the identical sequence so the
           server returns its stored decision instead of finalising twice. */
        var activeId = '';
        try { activeId = String((typeof CAP !== 'undefined' && CAP.liveSessionId) || ''); } catch (_) {}
        if (!lastFinishRequest || !lastFinishRequest.raw || lastFinishRequest.sessionId !== activeId) {
          statusError();
          return false;
        }
        try {
          CAP.sessionFinishPromise = retryTransport(lastFinishRequest.raw, lastFinishRequest.args);
          return await originals.finish.apply(this, arguments);
        } catch (_) {
          statusError();
          return false;
        }
      }
    };

    window.__visionLiveRuntimeSnapshot = snapshot;
    window.VISION.liveTransport = {
      version: (foundation() && foundation().transport) || 'unknown',
      protocol: function () { return { sessionId: protocolState.sessionId, protocol: protocolState.protocol, version: protocolState.version }; },
      isRetryableTransportError: retryable
    };
    window.VISION.liveRuntimeController = {
      install: install,
      isInstalled: function () { return installed; },
      snapshot: snapshot,
      destroy: function () {
        if (timer) clearTimeout(timer);
        timer = null;
        restore();
        try { if (runtime) runtime.destroy(); } catch (_) {}
        runtime = null;
        originals = null;
        pendingStartRequest = null;
        lastFinishRequest = null;
        resetProtocol();
        installed = false;
      }
    };
    installed = true;
    try { window.dispatchEvent(new CustomEvent('vision:live-runtime-controller-ready', { detail: { transport: window.VISION.liveTransport.version } })); } catch (_) {}
    return true;
  }

  function poll() {
    if (install()) return;
    attempts++;
    if (attempts < 400) timer = setTimeout(poll, 50);
    else try { window.dispatchEvent(new CustomEvent('vision:live-runtime-controller-unavailable')); } catch (_) {}
  }

  poll();
})();
