// VISION Live Proof Core — pure canonical phase-observation helpers.
//
// Mirrors the canonicalPhase()/compactGeometry() logic in
// js/proof/live/phase-evidence-bridge.js (the legacy production capture
// flow's phase bridge) exactly — same phase vocabulary, same per-exercise
// mapping, same geometry summary shape. That vocabulary is not a style
// choice: public.live_reconstruct_reps_v2 (supabase/migrations/
// 20260724120000_live_phase_reconstruction_v2.sql) is hard-coded against
// these exact phase strings per verifier_id (top/bottom, closed/open,
// standing/floor, left_drive/right_drive). Any observer that wants
// server-side rep reconstruction MUST emit this vocabulary — this module
// exists so the Universal Live Proof camera adapter can do that without
// reimplementing (and risking drifting from) the legacy bridge's mapping.
//
// Pure functions only — no DOM, no globals, no queued events. The caller
// decides when/whether to post a client_phase_observation event.

'use strict';

export function resultOf(state) {
  try { return (state && state.v3 && state.v3.result) || state || {}; } catch (_e) { return state || {}; }
}

export function exerciseOf(state, result) {
  var value = '';
  try { value = result.exerciseId || state.exercise || state.exerciseId || ''; } catch (_e) { value = ''; }
  return String(value || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 48);
}

export function sidePhase(result, side) {
  try { return String((result.sides && result.sides[side] && result.sides[side].phase) || '').toLowerCase(); }
  catch (_e) { return ''; }
}

export function canonicalPhase(state) {
  var result = resultOf(state);
  var exercise = exerciseOf(state || {}, result);
  var raw = '';
  try { raw = result.phase || state.phase || ''; } catch (_e) { raw = ''; }
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

export function finiteNumber(value, min, max) {
  var n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return Math.round(n * 10) / 10;
}

export function compactGeometry(state, result, phase) {
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

// Builds a client_phase_observation payload, or null if the current state
// carries no new, trustworthy phase to report (mirrors phase-evidence-
// bridge.js's sendObservation() gating, minus the transport/session bits
// that module owns).
export function buildPhaseObservation(state, previousPhase) {
  if (!state || state.poseTracking !== true || state.runtimeCanProgress === false ||
      (state.visibilityState && state.visibilityState !== 'ready')) {
    return { phase: '', payload: null };
  }
  var phase = canonicalPhase(state);
  if (!phase || phase === previousPhase) return { phase: previousPhase, payload: null };

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
  return { phase: phase, payload: payload };
}

export default { canonicalPhase, compactGeometry, buildPhaseObservation, resultOf, exerciseOf, sidePhase, finiteNumber };
