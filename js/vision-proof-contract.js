/* VISION proof-contract — shared browser normalisation, never an award authority.
   Supports contract v1 (historical) and v2 (current). v2 is additive: it adds
   set-aware hold fields (seconds_per_set, total_target_value, rest_seconds) plus
   capability metadata, so a plank task with multiple sets can be represented
   correctly instead of being flattened into a rep-shaped v1 contract.
   The verifier allowlists below are the single mirror of config/proof-capabilities.json
   and are checked for drift by scripts/qa-proof-capabilities-parity.mjs. */
(function (root) {
  'use strict';

  var TYPES = ['photo', 'voice', 'live'];
  var VERIFIERS = [
    'live-pushup-v1', 'live-squat-v1', 'live-plank-v1', 'live-lunge-v1',
    'live-jumping-jack-v1', 'live-burpee-v1', 'live-situp-v1', 'live-pullup-v1',
    'live-mountain-climber-v1', 'live-soccer-drill-v1', 'live-shadowboxing-v1',
    'live-generic-movement-v1'
  ];
  var HOLD_VERIFIERS = ['live-plank-v1'];
  var DURATION_VERIFIERS = ['live-soccer-drill-v1', 'live-shadowboxing-v1', 'live-generic-movement-v1'];
  // Production-enabled verifiers that can actually open a camera / start a
  // server session. A persisted contract may name any known verifier, but only
  // these may execute — mirrors production_enabled=true in the registry.
  var PRODUCTION_VERIFIERS = [
    'live-pushup-v1', 'live-squat-v1', 'live-lunge-v1', 'live-situp-v1',
    'live-pullup-v1', 'live-plank-v1', 'live-shadowboxing-v1',
    'live-soccer-drill-v1', 'live-generic-movement-v1'
  ];
  function modeFor(verifierId) {
    if (HOLD_VERIFIERS.indexOf(verifierId) >= 0) return 'hold';
    if (DURATION_VERIFIERS.indexOf(verifierId) >= 0) return 'duration';
    return 'reps';
  }

  var V1_KEYS = ['version','proof_type','verifier_id','target_kind','target_value','sets','reps_per_set','required_camera_view','required_landmarks','setup_instruction','finish_rule','fallback_proof_type','must_show','reject_if'];
  var V2_KEYS = ['version','proof_type','capability_id','verifier_id','verifier_version','mode','target_kind','target_value','sets','reps_per_set','seconds_per_set','rest_seconds','total_target_value','required_camera_view','accepted_camera_views','required_landmarks','setup_instruction','must_show','reject_if','fallback_proof_type','finish_rule','minimum_runtime_version'];

  function canonicalProofType(value) {
    var v = String(value || '').trim().toLowerCase();
    if (v === 'screenshot' || v === 'image' || v === 'knowledge') return 'photo';
    return TYPES.indexOf(v) > -1 ? v : null;
  }

  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function optionalInt(value, max) {
    if (value == null) return null;
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max ? value : undefined;
  }
  function optionalString(value, max) {
    if (value == null) return null;
    return typeof value === 'string' && value.length <= max ? value : undefined;
  }
  function isNullish(obj, key) { return !has(obj, key) || obj[key] == null; }

  /* ── V1 (historical contracts) ──────────────────────────────────────────── */
  function normalizeV1(raw) {
    if (Object.keys(raw).some(function (key) { return V1_KEYS.indexOf(key) < 0; })) return { ok: false, error: 'unknown_contract_field' };
    if (!['version','proof_type','verifier_id','target_kind','target_value'].every(function (key) { return has(raw, key); })) return { ok: false, error: 'missing_contract_field' };
    if (typeof raw.proof_type !== 'string' || TYPES.indexOf(raw.proof_type) < 0) return { ok: false, error: 'invalid_proof_type' };
    var proofType = raw.proof_type;
    if (typeof raw.target_kind !== 'string') return { ok: false, error: 'invalid_target_kind' };
    var targetKind = raw.target_kind;
    if (['reps', 'hold_seconds', 'duration_seconds', 'evidence'].indexOf(targetKind) < 0) return { ok: false, error: 'invalid_target_kind' };
    var targetValue = null;
    if (targetKind === 'evidence') {
      if (raw.target_value !== null) return { ok: false, error: 'evidence_target_must_be_null' };
    } else {
      if (typeof raw.target_value !== 'number' || !Number.isFinite(raw.target_value) || raw.target_value <= 0) return { ok: false, error: 'target_required' };
      targetValue = raw.target_value;
      if (targetValue > 86400) return { ok: false, error: 'target_too_large' };
      if (targetKind === 'reps' && (!Number.isInteger(targetValue) || targetValue > 500)) return { ok: false, error: 'invalid_rep_target' };
      if (targetKind === 'hold_seconds' && targetValue > 600) return { ok: false, error: 'invalid_hold_target' };
    }
    var verifierId = raw.verifier_id === null ? null : (typeof raw.verifier_id === 'string' && raw.verifier_id.length <= 64 ? raw.verifier_id : undefined);
    if (verifierId === undefined) return { ok: false, error: 'invalid_verifier' };
    if (proofType === 'live' && VERIFIERS.indexOf(verifierId) < 0) return { ok: false, error: 'unsupported_verifier' };
    if (proofType !== 'live' && verifierId) return { ok: false, error: 'verifier_requires_live' };
    if (proofType === 'live' && HOLD_VERIFIERS.indexOf(verifierId) >= 0 && targetKind !== 'hold_seconds') return { ok: false, error: 'live_target_mismatch' };
    if (proofType === 'live' && DURATION_VERIFIERS.indexOf(verifierId) >= 0 && targetKind !== 'duration_seconds') return { ok: false, error: 'live_target_mismatch' };
    if (proofType === 'live' && HOLD_VERIFIERS.indexOf(verifierId) < 0 && DURATION_VERIFIERS.indexOf(verifierId) < 0 && targetKind !== 'reps') return { ok: false, error: 'live_target_mismatch' };
    if (proofType === 'voice' && targetKind === 'reps') return { ok: false, error: 'voice_rep_mismatch' };
    var sets = optionalInt(raw.sets, 100), repsPerSet = optionalInt(raw.reps_per_set, 500);
    if (sets === undefined || repsPerSet === undefined) return { ok: false, error: 'invalid_set_fields' };
    var cameraView = optionalString(raw.required_camera_view, 80);
    if (cameraView === undefined) return { ok: false, error: 'invalid_camera_view' };
    if (has(raw, 'required_landmarks') && !Array.isArray(raw.required_landmarks)) return { ok: false, error: 'invalid_landmarks' };
    var landmarks = raw.required_landmarks || [];
    if (landmarks.length > 20 || landmarks.some(function (item) { return typeof item !== 'string' || item.length > 64; })) return { ok: false, error: 'invalid_landmarks' };
    var setup = optionalString(raw.setup_instruction, 240), mustShow = optionalString(raw.must_show, 400), rejectIf = optionalString(raw.reject_if, 400);
    if (setup === undefined || mustShow === undefined || rejectIf === undefined) return { ok: false, error: 'invalid_contract_text' };
    if (has(raw, 'finish_rule') && raw.finish_rule !== 'target_or_insufficient' && raw.finish_rule !== 'evidence_review') return { ok: false, error: 'invalid_finish_rule' };
    var fallback = raw.fallback_proof_type == null ? null : raw.fallback_proof_type;
    if (fallback !== null && fallback !== 'photo' && fallback !== 'voice') return { ok: false, error: 'invalid_fallback' };
    return { ok: true, contract: {
      version: 1, proof_type: proofType, verifier_id: verifierId,
      target_kind: targetKind, target_value: targetValue,
      sets: sets, reps_per_set: repsPerSet,
      seconds_per_set: null, total_target_value: targetValue, rest_seconds: null,
      mode: proofType === 'live' ? modeFor(verifierId) : null,
      capability_id: null, verifier_version: null,
      required_camera_view: cameraView || null,
      accepted_camera_views: cameraView ? [cameraView] : [],
      required_landmarks: landmarks,
      setup_instruction: setup || '',
      finish_rule: proofType === 'live' ? 'target_or_insufficient' : 'evidence_review',
      fallback_proof_type: fallback, must_show: mustShow || '', reject_if: rejectIf || '',
      minimum_runtime_version: null
    } };
  }

  /* ── V2 (current contracts) ─────────────────────────────────────────────── */
  function normalizeV2(raw) {
    if (Object.keys(raw).some(function (key) { return V2_KEYS.indexOf(key) < 0; })) return { ok: false, error: 'unknown_contract_field' };
    if (!['version','proof_type','target_kind','target_value'].every(function (key) { return has(raw, key); })) return { ok: false, error: 'missing_contract_field' };
    if (typeof raw.proof_type !== 'string' || TYPES.indexOf(raw.proof_type) < 0) return { ok: false, error: 'invalid_proof_type' };
    var proofType = raw.proof_type;
    if (typeof raw.target_kind !== 'string' || ['reps', 'hold_seconds', 'duration_seconds', 'evidence'].indexOf(raw.target_kind) < 0) return { ok: false, error: 'invalid_target_kind' };
    var targetKind = raw.target_kind;
    var verifierId = raw.verifier_id == null ? null : (typeof raw.verifier_id === 'string' && raw.verifier_id.length <= 64 ? raw.verifier_id : undefined);
    if (verifierId === undefined) return { ok: false, error: 'invalid_verifier' };

    // Evidence (photo/voice): no verifier, no numeric target.
    if (proofType !== 'live') {
      if (verifierId) return { ok: false, error: 'verifier_requires_live' };
      if (targetKind !== 'evidence' || raw.target_value !== null) return { ok: false, error: 'evidence_target_must_be_null' };
      if (proofType === 'voice' && targetKind === 'reps') return { ok: false, error: 'voice_rep_mismatch' };
      var mShow = optionalString(raw.must_show, 400), rIf = optionalString(raw.reject_if, 400);
      if (mShow === undefined || rIf === undefined) return { ok: false, error: 'invalid_contract_text' };
      return { ok: true, contract: {
        version: 2, proof_type: proofType, capability_id: null, verifier_id: null,
        verifier_version: null, mode: null, target_kind: 'evidence', target_value: null,
        sets: null, reps_per_set: null, seconds_per_set: null, rest_seconds: null, total_target_value: null,
        required_camera_view: null, accepted_camera_views: [], required_landmarks: [],
        setup_instruction: optionalString(raw.setup_instruction, 240) || '',
        must_show: mShow || '', reject_if: rIf || '', fallback_proof_type: null,
        finish_rule: 'evidence_review', minimum_runtime_version: null
      } };
    }

    // Live: verifier must be known, and its mode must agree with target_kind.
    if (VERIFIERS.indexOf(verifierId) < 0) return { ok: false, error: 'unsupported_verifier' };
    var mode = modeFor(verifierId);
    var expectKind = mode === 'hold' ? 'hold_seconds' : (mode === 'duration' ? 'duration_seconds' : 'reps');
    if (targetKind !== expectKind) return { ok: false, error: 'live_target_mismatch' };
    if (has(raw, 'mode') && raw.mode != null && raw.mode !== mode) return { ok: false, error: 'mode_mismatch' };

    if (typeof raw.target_value !== 'number' || !Number.isFinite(raw.target_value) || raw.target_value <= 0) return { ok: false, error: 'target_required' };
    var targetValue = raw.target_value;
    var sets = optionalInt(raw.sets, 100), repsPerSet = optionalInt(raw.reps_per_set, 500);
    var secondsPerSet = optionalInt(raw.seconds_per_set, 600), restSeconds = optionalInt(raw.rest_seconds, 600);
    var totalTarget = optionalInt(raw.total_target_value, 86400);
    if ([sets, repsPerSet, secondsPerSet, restSeconds, totalTarget].some(function (v) { return v === undefined; })) return { ok: false, error: 'invalid_set_fields' };

    if (mode === 'reps') {
      if (!Number.isInteger(targetValue) || targetValue > 500) return { ok: false, error: 'invalid_rep_target' };
      if (secondsPerSet != null) return { ok: false, error: 'rep_contract_has_seconds' };   // rep contract must not carry hold time
      if (sets != null && repsPerSet != null && sets * repsPerSet !== targetValue) return { ok: false, error: 'rep_total_mismatch' };
      if (totalTarget != null && totalTarget !== targetValue) return { ok: false, error: 'rep_total_mismatch' };
    } else if (mode === 'hold') {
      // Hold contracts carry NO reps. target_value is the TOTAL valid hold the
      // client must accumulate (= sets * seconds_per_set); seconds_per_set is the
      // per-set sub-goal the runtime segments on. A multi-set hold is never
      // flattened to a single set's seconds.
      if (repsPerSet != null) return { ok: false, error: 'hold_contract_has_reps' };
      if (secondsPerSet == null) return { ok: false, error: 'hold_missing_seconds_per_set' };
      var effectiveSets = sets || 1;
      var expectedTotal = effectiveSets * secondsPerSet;
      if (targetValue > 600) return { ok: false, error: 'invalid_hold_target' };
      if (targetValue !== expectedTotal) return { ok: false, error: 'hold_total_mismatch' };
      if (totalTarget != null && totalTarget !== expectedTotal) return { ok: false, error: 'hold_total_mismatch' };
    } else { // duration
      if (targetValue > 3600) return { ok: false, error: 'target_too_large' };
      if (repsPerSet != null || secondsPerSet != null) return { ok: false, error: 'duration_has_rep_fields' };
      if (totalTarget != null && totalTarget !== targetValue) return { ok: false, error: 'duration_total_mismatch' };
    }

    var cameraView = optionalString(raw.required_camera_view, 80);
    if (cameraView === undefined) return { ok: false, error: 'invalid_camera_view' };
    if (has(raw, 'accepted_camera_views') && raw.accepted_camera_views != null && !Array.isArray(raw.accepted_camera_views)) return { ok: false, error: 'invalid_camera_view' };
    var acceptedViews = raw.accepted_camera_views || (cameraView ? [cameraView] : []);
    if (acceptedViews.some(function (v) { return typeof v !== 'string' || v.length > 80; })) return { ok: false, error: 'invalid_camera_view' };
    if (has(raw, 'required_landmarks') && !Array.isArray(raw.required_landmarks)) return { ok: false, error: 'invalid_landmarks' };
    var landmarks = raw.required_landmarks || [];
    if (landmarks.length > 20 || landmarks.some(function (item) { return typeof item !== 'string' || item.length > 64; })) return { ok: false, error: 'invalid_landmarks' };
    var setup = optionalString(raw.setup_instruction, 240), mustShow = optionalString(raw.must_show, 400), rejectIf = optionalString(raw.reject_if, 400);
    if (setup === undefined || mustShow === undefined || rejectIf === undefined) return { ok: false, error: 'invalid_contract_text' };
    // Live contracts must carry explicit rejection rules — never blank.
    if (!rejectIf) return { ok: false, error: 'live_missing_reject_rules' };
    if (has(raw, 'finish_rule') && raw.finish_rule !== 'target_or_insufficient') return { ok: false, error: 'invalid_finish_rule' };
    var fallback = raw.fallback_proof_type == null ? null : raw.fallback_proof_type;
    if (fallback !== null && fallback !== 'photo' && fallback !== 'voice') return { ok: false, error: 'invalid_fallback' };

    return { ok: true, contract: {
      version: 2, proof_type: 'live',
      capability_id: optionalString(raw.capability_id, 64) || null,
      verifier_id: verifierId,
      verifier_version: optionalInt(raw.verifier_version, 999) || 1,
      mode: mode, target_kind: targetKind, target_value: targetValue,
      sets: sets, reps_per_set: repsPerSet, seconds_per_set: secondsPerSet,
      rest_seconds: restSeconds, total_target_value: totalTarget != null ? totalTarget : (mode === 'hold' ? (sets || 1) * secondsPerSet : targetValue),
      required_camera_view: cameraView || null, accepted_camera_views: acceptedViews,
      required_landmarks: landmarks, setup_instruction: setup || '',
      must_show: mustShow || '', reject_if: rejectIf,
      fallback_proof_type: fallback, finish_rule: 'target_or_insufficient',
      minimum_runtime_version: optionalString(raw.minimum_runtime_version, 16) || null
    } };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'missing_contract' };
    if (!has(raw, 'version')) return { ok: false, error: 'missing_contract_field' };
    if (raw.version === 2) return normalizeV2(raw);
    if (raw.version === 1) return normalizeV1(raw);
    return { ok: false, error: 'unsupported_contract_version' };
  }

  function proofTypeForTask(task, legacyClassifier) {
    task = task || {};
    var normalized = normalize(task.proofContract || task.proof_contract);
    if (normalized.ok) return normalized.contract.proof_type;
    var serverType = canonicalProofType(task.recommendedProofType || task.recommended_proof_type);
    if (serverType) return serverType;
    return canonicalProofType(typeof legacyClassifier === 'function' ? legacyClassifier(task) : null) || 'photo';
  }

  // A contract may load (normalize.ok) yet still not be executable Live because
  // the verifier is not production-enabled. Callers gate the camera on this.
  function isExecutableLive(contract) {
    return !!(contract && contract.proof_type === 'live' && PRODUCTION_VERIFIERS.indexOf(contract.verifier_id) >= 0);
  }

  var api = {
    TYPES: TYPES, VERIFIERS: VERIFIERS, HOLD_VERIFIERS: HOLD_VERIFIERS, DURATION_VERIFIERS: DURATION_VERIFIERS,
    PRODUCTION_VERIFIERS: PRODUCTION_VERIFIERS, modeFor: modeFor,
    canonicalProofType: canonicalProofType, normalize: normalize,
    proofTypeForTask: proofTypeForTask, isExecutableLive: isExecutableLive
  };
  root.VISION = root.VISION || {};
  root.VISION.proofContract = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
