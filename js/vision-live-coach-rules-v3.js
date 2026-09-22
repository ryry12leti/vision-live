/* ============================================================================
   VISION · Live Proof V3 — real-time coaching engine (window.VISION.liveCoachV3)
   ----------------------------------------------------------------------------
   Deterministic, on-device, no network (Phase 9). Turns the V3 verifier's
   per-frame evidence into AT MOST ONE user-facing cue at a time, chosen by
   priority, only after a problem PERSISTS across frames, and never repeated more
   often than its cooldown. Rejected-rep reasons fire immediately (highest
   priority) so the user always learns why a rep did not count.

   No LLM is called for frame-level coaching. The optional cloud/semantic coach
   remains a separate, supplementary layer.
   ========================================================================== */
(function (root) {
  'use strict';

  // reason code → { message, priority, persistMs, cooldownMs, immediate, category }
  // priority: higher wins when multiple problems are active in the same frame.
  // category (Live Proof Finish Package 8): an explicit, machine-readable grouping
  // — setup | visibility | form | tempo | continuity | camera_placement — additive
  // metadata read by nothing in the priority/persistence/cooldown arbitration logic
  // below (which only ever compares `priority`), so adding it changes no existing
  // behavior. It exists so a caller (diagnostics, a future coaching-quality report)
  // can group cues without re-deriving the grouping from priority numbers or
  // comment headers, which is fragile and was previously the only signal.
  var RULES = {
    // A. rejected-rep feedback — immediate, no persistence required
    bottom_range_not_reached: { message: 'Almost — go all the way down before coming back up.', priority: 95, persistMs: 0, cooldownMs: 1500, immediate: true, category: 'form' },
    top_range_not_reached:    { message: 'Return fully to the start to finish the rep.', priority: 95, persistMs: 0, cooldownMs: 1500, immediate: true, category: 'form' },
    movement_too_small:       { message: 'That was only part of the movement — use the full range.', priority: 95, persistMs: 0, cooldownMs: 1500, immediate: true, category: 'form' },
    movement_too_fast:        { message: 'Slow down — control each rep so it counts.', priority: 90, persistMs: 0, cooldownMs: 1500, immediate: true, category: 'tempo' },
    incomplete_lockout:       { message: 'Finish the rep — lock out at the top.', priority: 90, persistMs: 0, cooldownMs: 1500, immediate: true, category: 'form' },
    incomplete_depth:         { message: 'Go deeper to reach full depth.', priority: 90, persistMs: 0, cooldownMs: 1500, immediate: true, category: 'form' },
    excessive_body_swing:     { message: 'Keep your torso still — no swinging.', priority: 88, persistMs: 0, cooldownMs: 2000, immediate: true, category: 'form' },

    // B. visibility / setup — persistent, high priority (nothing counts without this).
    // blocksPraise: true means a rep can never be praised in the SAME frame this
    // reason is merely active, even before it has persisted long enough to actually
    // be announced — "nothing counts without this" applies to praise too, not only to
    // whether the cue itself is shown yet.
    person_not_visible:          { message: 'Step into frame so the camera can see you.', priority: 80, persistMs: 300, cooldownMs: 2500, blocksPraise: true, category: 'visibility' },
    required_landmark_missing:   { message: 'Keep the joints for this exercise inside the frame.', priority: 78, persistMs: 300, cooldownMs: 2500, blocksPraise: true, category: 'visibility' },
    pushup_support_not_visible:  { message: 'Keep your whole body and both hands visible.', priority: 79, persistMs: 250, cooldownMs: 2200, blocksPraise: true, category: 'visibility' },
    pushup_support_not_verified: { message: 'Hold a straight two-hand push-up position.', priority: 78, persistMs: 250, cooldownMs: 2200, blocksPraise: true, category: 'setup' },
    pushup_setup_not_stable:     { message: 'Hold your push-up setup steady before starting.', priority: 76, persistMs: 300, cooldownMs: 2200, blocksPraise: true, category: 'setup' },
    camera_view_not_stable:      { message: 'Hold this camera angle steady.', priority: 72, persistMs: 250, cooldownMs: 2200, blocksPraise: true, category: 'camera_placement' },
    invalid_camera_view:         { message: 'Adjust your camera angle for this exercise.', priority: 70, persistMs: 500, cooldownMs: 3000, blocksPraise: true, category: 'camera_placement' },
    low_tracking_confidence:     { message: 'Improve your lighting or step back for steadier tracking.', priority: 68, persistMs: 500, cooldownMs: 3000, blocksPraise: true, category: 'visibility' },
    unsupported_equipment_variant:{ message: 'Use the bodyweight version or choose the weighted task.', priority: 82, persistMs: 0, cooldownMs: 2500, immediate: true, blocksPraise: true, category: 'setup' },

    // C. equipment (honest — only ever a note, never a block)
    equipment_not_visible:              { message: 'Keep your dumbbells inside the frame.', priority: 55, persistMs: 700, cooldownMs: 4000, category: 'visibility' },
    equipment_not_associated_with_hand: { message: 'Hold the dumbbell in your working hand within frame.', priority: 55, persistMs: 700, cooldownMs: 4000, category: 'visibility' },

    // D. tracking recovery / hold
    tracking_lost_mid_rep: { message: 'Rep counting paused — step back into the frame.', priority: 60, persistMs: 0, cooldownMs: 2000, immediate: true, category: 'continuity' },
    hold_form_broken:      { message: 'Fix your position to resume the hold.', priority: 50, persistMs: 300, cooldownMs: 2500, category: 'continuity' },
    no_movement:           { message: 'Keep moving with control.', priority: 40, persistMs: 500, cooldownMs: 3000, category: 'tempo' },

    // E. measurable form signals (Phase 4) — persistence is enforced upstream by
    // the FormMonitor; cooldown here stops nagging. Resolution = signal clears.
    elbow_drift:          { message: 'Keep your elbow pinned to your side.', priority: 62, persistMs: 0, cooldownMs: 3000, category: 'form' },
    shoulder_lift:        { message: 'Relax your shoulders — don’t shrug the weight up.', priority: 58, persistMs: 0, cooldownMs: 3500, category: 'form' },
    excessive_torso_lean: { message: 'Stand tall — keep your torso steady.', priority: 60, persistMs: 0, cooldownMs: 3000, category: 'form' },
    uneven_extension:     { message: 'Move both sides together through the same range.', priority: 57, persistMs: 0, cooldownMs: 3500, category: 'form' },
    wrist_below_elbow:    { message: 'Press straight up — keep your wrists over your elbows.', priority: 61, persistMs: 0, cooldownMs: 3000, category: 'form' },
    hips_too_high:        { message: 'Lower your hips — flatten your body line.', priority: 56, persistMs: 0, cooldownMs: 3000, category: 'form' },
    hips_too_low:         { message: 'Lift your hips — don’t let them sag.', priority: 56, persistMs: 0, cooldownMs: 3000, category: 'form' },

    // F. unsupported-claim guidance (Package 8) — fires only via the explicit
    // proof_family guard in Coach.prototype.observe below, never through the normal
    // coachReason/rejectionReason candidate path. No verifier in this codebase sets
    // proof_family today (object_interaction/target_interaction/movement_sequence/
    // unsupported_subjective have no runtime verifier — see the server-only claim
    // contract projection, Package 7), so this is forward-looking: if one is ever wired up, the coach
    // must never imply camera verification for it.
    unsupported_claim_family: { message: 'Camera can’t verify this — log it with photo or video instead.', priority: 100, persistMs: 0, cooldownMs: 4000, immediate: true, blocksPraise: true, category: 'setup' }
  };

  // Fail-closed authoring guards, enforced at module load (not just by convention):
  // a future rule author cannot silently add a wall-of-text cue or medical/injury
  // language — the module throws immediately rather than shipping it.
  var MAX_CUE_LENGTH = 90;
  var MEDICAL_LANGUAGE = /\b(diagnos\w*|injur\w*|torn|tear(?:ed|ing)?|sprain\w*|fractur\w*|dislocat\w*|see a doctor|physician|symptom\w*|medical(?:ly)?\s*condition)\b/i;
  for (var _ruleKey in RULES) {
    var _rule = RULES[_ruleKey];
    if (typeof _rule.message !== 'string' || !_rule.message.length) throw new Error('vision-live-coach-rules-v3: rule "' + _ruleKey + '" has no message');
    if (_rule.message.length > MAX_CUE_LENGTH) throw new Error('vision-live-coach-rules-v3: cue for "' + _ruleKey + '" exceeds ' + MAX_CUE_LENGTH + ' chars (cues must stay brief)');
    if (MEDICAL_LANGUAGE.test(_rule.message)) throw new Error('vision-live-coach-rules-v3: cue for "' + _ruleKey + '" contains medical/injury/diagnosis language, which this coach must never use');
  }

  /* --------------------------------------------------------------------------
     Real-video setup hardening.

     Open-licensed camera replays showed that unsupported view fragments could
     leak into calibration and that an eight-count T push-up could cross the
     elbow-angle state machine once. This boundary runs before V3 calibration.
     It preserves completed reps, but drops partial candidates and restarts the
     personal range whenever camera/setup continuity breaks.
     -------------------------------------------------------------------------- */
  var HARDENING_VERSION = 'real-video-hardening-v1';
  var VIEW_STABLE_MS = 800;
  var PUSHUP_SETUP_STABLE_MS = 1000;
  var BODYWEIGHT_EXERCISES = { pushup: true, squat: true, lunge: true, situp: true, plank: true };
  var DISALLOWED_BODYWEIGHT_OBJECT = /^(?:dumbbell|barbell|kettlebell|weight|weight_plate|plate)$/;

  function poseConfidence(pose) {
    var points = (pose && pose.keypoints) || [], total = 0, count = 0;
    for (var i = 0; i < points.length; i++) {
      var score = Number(points[i] && points[i].score || 0);
      if (score >= 0.3) { total += score; count++; }
    }
    return count ? total / count : 0;
  }

  function setupResult(verifier, pose, view, reason, cue) {
    var person = !!(pose && pose.keypoints && pose.keypoints.length >= 3);
    var extra = {
      state: 'need_setup', cameraView: view || 'unknown', personVisible: person,
      personConfidence: poseConfidence(pose), requiredLandmarksVisible: 0,
      phase: 'idle', repCompleted: false, coachReason: reason, cue: cue
    };
    if (verifier && typeof verifier._baseResult === 'function') return verifier._baseResult(extra);
    return Object.assign({
      engineVersion: 'live-proof-v3', exerciseId: verifier && verifier.exerciseId,
      verifierId: verifier && verifier.id, verifierVersion: verifier && verifier.version,
      mode: verifier && verifier.mode, reps: verifier && verifier.reps || 0,
      rejectedReps: verifier && verifier.rejectedReps || 0,
      holdMs: verifier && verifier.holdMs || 0,
      validDurationMs: verifier && verifier.validDurationMs || 0
    }, extra);
  }

  function resetForBrokenSetup(verifier) {
    try { if (verifier.machine && verifier.machine.dropPartial) verifier.machine.dropPartial(); } catch (_) {}
    try { if (verifier.machineR && verifier.machineR.dropPartial) verifier.machineR.dropPartial(); } catch (_) {}
    try { if (verifier.form && verifier.form.clearRepFlags) verifier.form.clearRepFlags(); } catch (_) {}
    // V3 recalibrate() preserves completed reps while discarding the stale range.
    try { if (typeof verifier.recalibrate === 'function') verifier.recalibrate(); } catch (_) {}
  }

  function disallowedBodyweightObject(frame) {
    var objects = (frame && frame.objects) || [];
    for (var i = 0; i < objects.length; i++) {
      var object = objects[i] || {};
      var cls = String(object.class || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (Number(object.score || 0) >= 0.45 && DISALLOWED_BODYWEIGHT_OBJECT.test(cls)) return cls;
    }
    return null;
  }

  function pushupSetup(liveV3, pose) {
    if (!pose) return { ok: false, reason: 'pushup_support_not_visible', cue: 'Show your full body and both hands' };
    var kp = liveV3.kp, angle = liveV3.angle, scale = liveV3.torsoScale(pose);
    var side = liveV3.bestSide(pose, ['shoulder', 'hip', 'ankle']);
    var shoulder = side === 'none' ? null : kp(pose, side + '_shoulder');
    var hip = side === 'none' ? null : kp(pose, side + '_hip');
    var ankle = side === 'none' ? null : kp(pose, side + '_ankle');
    var leftShoulder = kp(pose, 'left_shoulder'), rightShoulder = kp(pose, 'right_shoulder');
    var leftWrist = kp(pose, 'left_wrist'), rightWrist = kp(pose, 'right_wrist');
    if (!shoulder || !hip || !ankle || !leftShoulder || !rightShoulder || !leftWrist || !rightWrist || !scale) {
      return { ok: false, reason: 'pushup_support_not_visible', cue: 'Keep shoulders, hips, ankles and both hands visible' };
    }

    var bodyLine = angle(shoulder, hip, ankle);
    var horizontal = Math.abs(shoulder.x - ankle.x) > Math.abs(shoulder.y - ankle.y) * 1.35;
    var leftSupported = leftWrist.y > leftShoulder.y + scale * 0.06;
    var rightSupported = rightWrist.y > rightShoulder.y + scale * 0.06;
    var handsLevel = Math.abs(leftWrist.y - rightWrist.y) <= scale * 0.30;
    var shouldersLevel = Math.abs(leftShoulder.y - rightShoulder.y) <= scale * 0.22;
    if (!(bodyLine != null && bodyLine >= 150 && horizontal && leftSupported && rightSupported && handsLevel && shouldersLevel)) {
      return { ok: false, reason: 'pushup_support_not_verified', cue: 'Hold a straight two-hand push-up position' };
    }
    return { ok: true };
  }

  function hardenVerifier(liveV3, verifier) {
    if (!verifier || verifier.__realVideoHardened || typeof verifier.update !== 'function') return verifier;
    var spec = verifier.spec || liveV3.registry[verifier.exerciseId] || {};
    var originalUpdate = verifier.update.bind(verifier);
    var state = { blocked: true, view: null, viewSince: null, setupSince: null };
    verifier.__realVideoHardened = true;
    verifier.__realVideoHardeningVersion = HARDENING_VERSION;

    verifier.update = function (frame) {
      var pose = frame && frame.pose;
      var now = Number(frame && frame.timestamp || 0);
      var view = pose ? liveV3.estimateCameraView(pose) : 'unknown';
      var acceptedViews = spec.acceptedViews || null;

      if (BODYWEIGHT_EXERCISES[verifier.exerciseId]) {
        var objectClass = disallowedBodyweightObject(frame);
        if (objectClass) {
          if (!state.blocked) resetForBrokenSetup(verifier);
          state.blocked = true; state.viewSince = null; state.setupSince = null;
          return setupResult(verifier, pose, view, 'unsupported_equipment_variant',
            'This bodyweight verifier cannot validate added equipment');
        }
      }

      if (acceptedViews && acceptedViews.length) {
        if (acceptedViews.indexOf(view) < 0) {
          if (!state.blocked) resetForBrokenSetup(verifier);
          state.blocked = true; state.view = view; state.viewSince = null; state.setupSince = null;
          return setupResult(verifier, pose, view, 'invalid_camera_view', spec.viewHint || 'Adjust your camera angle');
        }
        if (state.view !== view || state.viewSince == null) {
          if (!state.blocked) resetForBrokenSetup(verifier);
          state.blocked = true; state.view = view; state.viewSince = now; state.setupSince = null;
        }
        if (now - state.viewSince < VIEW_STABLE_MS) {
          return setupResult(verifier, pose, view, 'camera_view_not_stable', 'Hold this camera angle steady');
        }
      }

      if (verifier.exerciseId === 'pushup') {
        var setup = pushupSetup(liveV3, pose);
        if (!setup.ok) {
          if (!state.blocked) resetForBrokenSetup(verifier);
          state.blocked = true; state.setupSince = null;
          return setupResult(verifier, pose, view, setup.reason, setup.cue);
        }
        if (state.setupSince == null) state.setupSince = now;
        if (now - state.setupSince < PUSHUP_SETUP_STABLE_MS) {
          state.blocked = true;
          return setupResult(verifier, pose, view, 'pushup_setup_not_stable', 'Hold your two-hand push-up setup steady');
        }
      }

      if (state.blocked) {
        resetForBrokenSetup(verifier);
        state.blocked = false;
      }
      return originalUpdate(frame);
    };
    return verifier;
  }

  function installVerifierHardening() {
    var liveV3 = root.VISION && root.VISION.liveV3;
    if (!liveV3 || liveV3.__realVideoHardeningInstalled) return !!liveV3;
    if (typeof liveV3.create !== 'function') return false;

    // A front camera cannot prove a push-up's support/depth/body-line contract.
    if (liveV3.registry && liveV3.registry.pushup) {
      liveV3.registry.pushup.acceptedViews = ['side', 'front_angle'];
      liveV3.registry.pushup.viewHint = 'Turn side-on and keep your whole body plus both hands visible';
    }
    liveV3.REASONS.pushup_support_not_visible = 'pushup_support_not_visible';
    liveV3.REASONS.pushup_support_not_verified = 'pushup_support_not_verified';
    liveV3.REASONS.pushup_setup_not_stable = 'pushup_setup_not_stable';
    liveV3.REASONS.camera_view_not_stable = 'camera_view_not_stable';
    liveV3.REASONS.unsupported_equipment_variant = 'unsupported_equipment_variant';

    var originalCreate = liveV3.create;
    liveV3.create = function (exerciseId) {
      return hardenVerifier(liveV3, originalCreate.call(liveV3, exerciseId));
    };
    if (typeof liveV3.createByVerifierId === 'function') {
      var originalById = liveV3.createByVerifierId;
      liveV3.createByVerifierId = function (verifierId) {
        return hardenVerifier(liveV3, originalById.call(liveV3, verifierId));
      };
    }
    liveV3.__realVideoHardeningInstalled = true;
    liveV3.hardeningVersion = HARDENING_VERSION;
    return true;
  }

  // Package 7 proof families that can never be verified by pose/camera evidence
  // alone — object presence, object contact, target/outcome success, and
  // subjective quality (the server-only claim contract's object_interaction/target_interaction/
  // unsupported_subjective/custom_observable). If a verifier result ever names one
  // of these (none does today — forward-looking guard), the coach must give setup/
  // fallback guidance only and must never announce a rep as verified/clean.
  var NEVER_COACH_AS_VERIFIED_FAMILIES = {
    object_interaction: true, target_interaction: true,
    unsupported_subjective: true, custom_observable: true
  };

  function Coach(opts) {
    opts = opts || {};
    this.rules = Object.assign({}, RULES, opts.rules || {});
    this.active = {};    // reason -> { since }
    this.announced = {}; // reason -> true, once its cue has actually been shown
    this.lastFired = {}; // reason -> timestamp
    this.lastReps = 0;
    this.log = []; // {t, reason, message, corrected?} — for the diagnostics bundle
  }

  // Feed one V3 verifier result. Returns { cue, reason } (cue '' when nothing to say).
  Coach.prototype.observe = function (result, now) {
    now = Number(now || 0);

    // A task whose claim contract belongs to a never-camera-verifiable proof
    // family is coached with setup/fallback guidance only — no candidate
    // arbitration, no praise path, regardless of any rep/duration evidence the
    // (necessarily unqualified) verifier might otherwise report.
    if (result && NEVER_COACH_AS_VERIFIED_FAMILIES[result.proofFamily]) {
      if (result) this.lastReps = result.reps || this.lastReps;
      var guardRule = this.rules.unsupported_claim_family;
      this.log.push({ t: now, reason: 'unsupported_claim_family', message: guardRule.message });
      if (this.log.length > 200) this.log.shift();
      return { cue: guardRule.message, reason: 'unsupported_claim_family' };
    }

    var candidates = [];

    // 1. a rejected rep this frame → immediate, top priority
    if (result && result.rejectionReason && this.rules[result.rejectionReason]) {
      candidates.push({ reason: result.rejectionReason, rule: this.rules[result.rejectionReason], persistedFor: Infinity });
    }
    // 2. a live coach reason (visibility / view / equipment / hold) → needs persistence
    var reason = result && result.coachReason;
    if (reason && this.rules[reason]) {
      if (!this.active[reason]) this.active[reason] = { since: now };
      candidates.push({ reason: reason, rule: this.rules[reason], persistedFor: now - this.active[reason].since });
    }
    // clear any active reasons that resolved this frame — an issue that was
    // actually ANNOUNCED (not merely active-but-not-yet-persisted) and has now
    // cleared gets an explicit 'corrected' log entry, so a caller can tell "issue
    // disappeared after the cue" apart from "issue never came up again" without
    // re-deriving it from raw timestamps.
    var rejectionReason = result && result.rejectionReason;
    for (var r in this.active) {
      if (r !== reason && r !== rejectionReason) {
        delete this.active[r];
        if (this.announced[r]) {
          delete this.announced[r];
          this.log.push({ t: now, reason: r, corrected: true });
          if (this.log.length > 200) this.log.shift();
        }
      }
    }

    // pick the highest-priority candidate that has persisted long enough and is off cooldown
    var pick = null;
    var praiseBlocked = false;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i], rule = c.rule;
      // A blocksPraise reason suppresses positive reinforcement for as long as it is
      // MERELY ACTIVE — independent of whether it has persisted/cooled down enough to
      // actually be displayed this frame. "Nothing counts without this" applies to
      // praise even in the frame before the cue itself is shown.
      if (rule.blocksPraise) praiseBlocked = true;
      if (!rule.immediate && c.persistedFor < (rule.persistMs || 0)) continue;
      // `0` is a legitimate real timestamp (the very first video/session frame) and
      // must never be confused with "never fired" — a reason that has genuinely never
      // fired uses -Infinity so its cooldown window is always already elapsed.
      var last = Object.prototype.hasOwnProperty.call(this.lastFired, c.reason) ? this.lastFired[c.reason] : -Infinity;
      if (now - last < (rule.cooldownMs || 0)) continue;
      if (!pick || rule.priority > pick.rule.priority) pick = c;
    }

    if (!pick) {
      // Positive reinforcement on a fresh rep when nothing is wrong — but never for a
      // rep the verifier itself has not calibrated. The coach must not trust
      // repCompleted/reps blindly; a verifier bug that ever completed a rep before
      // calibration finished must not also earn praise for it. Verifiers without a
      // calibration concept at all (hold/duration modes) carry no `calibration` field,
      // so their absence is not itself suppressed.
      var calibrationKnown = result && Object.prototype.hasOwnProperty.call(result, 'calibration') && result.calibration;
      var uncalibrated = calibrationKnown && result.calibration.calibrated === false;
      if (result && !uncalibrated && !praiseBlocked && result.repCompleted && result.reps > this.lastReps) { this.lastReps = result.reps; return { cue: 'Rep ' + result.reps + ' — clean.', reason: 'rep_counted' }; }
      if (result) this.lastReps = result.reps || this.lastReps;
      return { cue: '', reason: null };
    }
    this.lastFired[pick.reason] = now;
    this.announced[pick.reason] = true;
    if (result) this.lastReps = result.reps || this.lastReps;
    this.log.push({ t: now, reason: pick.reason, message: pick.rule.message });
    if (this.log.length > 200) this.log.shift();
    return { cue: pick.rule.message, reason: pick.reason };
  };

  Coach.prototype.events = function () { return this.log.slice(); };

  function create(opts) { return new Coach(opts); }

  installVerifierHardening();
  var api = { create: create, RULES: RULES, installVerifierHardening: installVerifierHardening,
              hardeningVersion: HARDENING_VERSION };
  root.VISION = root.VISION || {};
  root.VISION.liveCoachV3 = api;
  root.VISION.liveV3Hardening = { version: HARDENING_VERSION, install: installVerifierHardening };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
