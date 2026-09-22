/* Live Proof phase-evidence bridge.

   Translates on-device HUD state into an ordered stream of canonical phase
   observations so the SERVER can reconstruct repetitions. The browser reports
   observations only; it never counts a verified rep and never sends raw frames
   or complete pose streams.

   Protocol negotiation, the session id, retries and ordering all belong to
   live-controller-bridge.js / live-runtime.js. This file reads the negotiated
   protocol and adds exactly one thing: a setup-gated, canonical phase stream
   with a small privacy-safe geometry summary. */
(function () {
  'use strict';

  var installed = false;
  var timer = null;
  var attempts = 0;
  var sessionId = null;
  var observedVersion = 1;
  var lastPhase = '';
  var lastPhaseAt = 0;
  var observations = 0;
  var setupCurrent = false;
  var setupGeneration = 0;
  var lastHudState = null;
  var originalQueue = null;

  var INTERRUPTIONS = ['client_setup_lost', 'client_tracking_unstable', 'client_hold_interrupted',
    'client_engine_degraded', 'client_camera_interrupted', 'client_backgrounded'];

  function hasSurfaces() {
    return window.VISION && VISION.liveTransport && typeof VISION.liveTransport.protocol === 'function' &&
      typeof window.updateLiveHud === 'function' && typeof window.queueLiveClaimEvent === 'function' &&
      typeof window.closeLive === 'function' && typeof window.stopLiveSession === 'function';
  }

  function negotiated() {
    try { return VISION.liveTransport.protocol() || {}; } catch (_) { return {}; }
  }

  function protocolVersion() { return observedVersion; }

  function reset() {
    sessionId = null;
    observedVersion = 1;
    lastPhase = '';
    lastPhaseAt = 0;
    observations = 0;
    setupCurrent = false;
    setupGeneration++;
    lastHudState = null;
  }

  function revokeSetup() {
    setupCurrent = false;
    setupGeneration++;
    lastPhase = '';
  }

  function syncSession() {
    var negotiatedId = negotiated().sessionId || null;
    var activeId = null;
    try { activeId = (typeof CAP !== 'undefined' && CAP && CAP.liveSessionId) ? String(CAP.liveSessionId) : null; } catch (_) { activeId = null; }
    var current = activeId || negotiatedId;
    if (current !== sessionId) {
      reset();
      sessionId = current;
    }
    if (sessionId) {
      var version = Number(negotiated().version);
      observedVersion = Number.isFinite(version) ? Math.max(1, version) : 1;
    }
    return sessionId;
  }

  function resultOf(state) {
    try { return (state && state.v3 && state.v3.result) || state || {}; } catch (_) { return state || {}; }
  }

  function exerciseOf(state, result) {
    var value = '';
    try { value = result.exerciseId || state.exercise || state.exerciseId || ''; } catch (_) { value = ''; }
    return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 48);
  }

  function sidePhase(result, side) {
    try { return String((result.sides && result.sides[side] && result.sides[side].phase) || '').toLowerCase(); }
    catch (_) { return ''; }
  }

  function canonicalPhase(state) {
    var result = resultOf(state);
    var exercise = exerciseOf(state || {}, result);
    var raw = '';
    try { raw = result.phase || state.phase || ''; } catch (_) { raw = ''; }
    raw = String(raw || '').toLowerCase().replace(/[^a-z_]/g, '').slice(0, 32);
    if (!raw || ['idle', 'setup', 'calibrating', 'transition', 'returning', 'tracking_unstable', 'form_paused'].indexOf(raw) >= 0) return '';

    if (/jumping_?jack|star_?jump/.test(exercise)) {
      var jl = sidePhase(result, 'left'), jr = sidePhase(result, 'right');
      if ((jl === 'top' && jr === 'top') || raw === 'top' || raw === 'open') return 'open';
      if ((jl === 'bottom' && jr === 'bottom') || raw === 'bottom' || raw === 'closed') return 'closed';
      return '';
    }

    if (/mountain_?climber/.test(exercise)) {
      var ml = sidePhase(result, 'left'), mr = sidePhase(result, 'right');
      if (ml === 'bottom' && mr !== 'bottom') return 'left_drive';
      if (mr === 'bottom' && ml !== 'bottom') return 'right_drive';
      if (ml === 'top' && mr === 'top') return 'plank';
      if (['left_drive', 'right_drive', 'plank'].indexOf(raw) >= 0) return raw;
      return '';
    }

    if (/burpee/.test(exercise)) {
      if (raw === 'top' || raw === 'standing') return 'standing';
      if (raw === 'bottom' || raw === 'floor') return 'floor';
      return '';
    }

    if (/plank/.test(exercise)) {
      if (raw === 'holding' || raw === 'hold') return 'hold';
      return '';
    }

    if (result.mode === 'duration' || /shadowbox|soccer|generic_movement|cardio|running|walking/.test(exercise)) {
      return raw === 'moving' || raw === 'active' ? 'active' : '';
    }

    if (raw === 'top' || raw === 'bottom') return raw;
    if (['closed', 'open', 'standing', 'floor', 'left_drive', 'right_drive', 'plank', 'hold', 'active'].indexOf(raw) >= 0) return raw;
    return '';
  }

  function finiteNumber(value, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    return Math.round(n * 10) / 10;
  }

  function compactGeometry(state, result, phase) {
    var geometry = { geometry_version: 1 };
    var metric = finiteNumber(result.jointAngle != null ? result.jointAngle : state.jointAngle, 0, 1000);
    var calibration = result.calibration && typeof result.calibration === 'object' ? result.calibration : null;
    var top = calibration ? finiteNumber(calibration.top, 0, 1000) : null;
    var bottom = calibration ? finiteNumber(calibration.bottom, 0, 1000) : null;

    if (metric == null && result.sides && typeof result.sides === 'object') {
      var preferred = phase === 'left_drive' ? result.sides.left : phase === 'right_drive' ? result.sides.right : null;
      if (preferred) metric = finiteNumber(preferred.angle, 0, 1000);
      if (metric == null) {
        var values = ['left', 'right'].map(function (side) {
          return result.sides[side] ? finiteNumber(result.sides[side].angle, 0, 1000) : null;
        }).filter(function (value) { return value != null; });
        if (values.length) metric = Math.round((values.reduce(function (a, b) { return a + b; }, 0) / values.length) * 10) / 10;
      }
    }

    if (metric != null) geometry.metric_angle = metric;
    if (top != null && bottom != null && Math.abs(top - bottom) >= 1) {
      geometry.calibration_top = top;
      geometry.calibration_bottom = bottom;
      geometry.calibration_span = Math.round(Math.abs(top - bottom) * 10) / 10;
    }
    var visibility = finiteNumber(result.requiredLandmarksVisible != null ? result.requiredLandmarksVisible : state.requiredLandmarksVisible, 0, 1);
    if (visibility != null) geometry.visibility_ratio = visibility;
    var view = String(result.cameraView || state.cameraView || '').toLowerCase();
    if (['front', 'front_angle', 'side', 'unknown'].indexOf(view) >= 0) geometry.camera_view = view;
    return geometry;
  }

  function sendObservation(state) {
    if (protocolVersion() < 2 || !sessionId || !setupCurrent || typeof originalQueue !== 'function') return Promise.resolve(null);
    if (!state || state.poseTracking !== true || state.runtimeCanProgress === false ||
        (state.visibilityState && state.visibilityState !== 'ready')) {
      lastPhase = '';
      return Promise.resolve(null);
    }

    var phase = canonicalPhase(state);
    if (!phase) return Promise.resolve(null);
    if (phase === lastPhase) return Promise.resolve(null);
    var now = performance.now();
    lastPhase = phase;
    lastPhaseAt = now;
    observations++;

    var result = resultOf(state);
    var selectedSide = String(state.selectedSide || result.selectedSide || 'none');
    if (phase === 'left_drive') selectedSide = 'left';
    else if (phase === 'right_drive') selectedSide = 'right';
    if (['left', 'right', 'none'].indexOf(selectedSide) < 0) selectedSide = 'none';
    var payload = Object.assign({
      phase: phase,
      selected_side: selectedSide,
      visibility_state: String(state.visibilityState || 'ready').slice(0, 32)
    }, compactGeometry(state, result, phase));
    var quality = Number(state.trackingConfidence != null ? state.trackingConfidence : result.personConfidence);
    if (Number.isFinite(quality)) payload.tracking_quality = Math.max(0, Math.min(1, quality));
    return Promise.resolve(originalQueue('client_phase_observation', payload)).catch(function () {});
  }

  function install() {
    if (installed) return true;
    if (!hasSurfaces()) return false;

    var originalHud = window.updateLiveHud;
    var originalClose = window.closeLive;
    var originalStop = window.stopLiveSession;
    originalQueue = window.queueLiveClaimEvent;

    window.queueLiveClaimEvent = function (type, payload) {
      if (INTERRUPTIONS.indexOf(type) >= 0) revokeSetup();

      if (type === 'client_setup_candidate') {
        var generation = ++setupGeneration;
        var setupReceipt = originalQueue(type, payload);
        return Promise.resolve(setupReceipt).then(function (receipt) {
          if (generation !== setupGeneration) return receipt;
          setupCurrent = true;
          lastPhase = '';
          return sendObservation(lastHudState).then(function () { return receipt; });
        });
      }

      if (type === 'client_rep_candidate') {
        return sendObservation(lastHudState).then(function () {
          return originalQueue(type, payload);
        });
      }

      return originalQueue(type, payload);
    };

    window.updateLiveHud = function (state) {
      syncSession();
      // syncSession may reset per-session evidence, including lastHudState.
      // Store the current frame only after that reset so an accepted setup
      // receipt can emit the first canonical observation deterministically.
      lastHudState = state || null;
      var result = originalHud.call(this, state);
      sendObservation(state);
      return result;
    };

    window.stopLiveSession = async function () {
      var result = await originalStop.apply(this, arguments);
      if (result !== false) reset();
      return result;
    };

    window.closeLive = function () {
      var result = originalClose.apply(this, arguments);
      reset();
      return result;
    };

    installed = true;
    window.__visionLivePhaseEvidenceSnapshot = function () {
      return {
        installed: installed,
        protocolVersion: protocolVersion(),
        sessionId: sessionId,
        lastPhase: lastPhase,
        lastPhaseAt: lastPhaseAt,
        observations: observations,
        setupCurrent: setupCurrent
      };
    };
    try { window.dispatchEvent(new CustomEvent('vision:live-phase-evidence-ready')); } catch (_) {}
    return true;
  }

  function poll() {
    if (install()) return;
    attempts++;
    if (attempts >= 400) {
      try { window.dispatchEvent(new CustomEvent('vision:live-phase-evidence-unavailable')); } catch (_) {}
      return;
    }
    timer = setTimeout(poll, 50);
  }

  window.VISION = window.VISION || {};
  window.VISION.livePhaseEvidence = {
    install: install,
    reset: reset,
    isInstalled: function () { return installed; },
    snapshot: function () { return window.__visionLivePhaseEvidenceSnapshot ? window.__visionLivePhaseEvidenceSnapshot() : null; }
  };

  poll();
})();
