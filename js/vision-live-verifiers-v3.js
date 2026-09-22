/* ============================================================================
   VISION · Live Proof V3 — calibrated real-world recognition engine
   ----------------------------------------------------------------------------
   Pure, deterministic, dependency-free. No network, no DOM, no storage, no XP.
   Everything here is a state machine over LANDMARKS (and optional equipment
   object tracks). It never awards points — the browser only produces evidence;
   the server verifies and awards.

   What V3 fixes over V1/V2 (see docs/live-proof-real-world-architecture.md):
     • Calibrates rep thresholds to the ACTUAL user + camera from a practice
       range instead of relying solely on universal fixed angles.
     • Estimates camera view and best visible body side before counting.
     • Anchor-based rep cycle detection (handles curls, presses, squats, etc.
       regardless of which extreme the user rests at) with explicit
       machine-readable rejection reasons for every non-counted candidate.
     • Measurable exercise-specific FORM SIGNALS (elbow drift, torso swing,
       shoulder shrug, uneven arms, hip sag/pike…) — every issue carries a
       reason code + confidence and must PERSIST before it is surfaced.
     • Dedicated dumbbell verifiers that COUNT from pose geometry and expose an
       honest equipment signal (dumbbell object tracks are optional evidence,
       never fabricated). Weight-verification is gated: with no trained object
       model bundled, weightVerified is always false and dumbbell exercises stay
       production-gated (registry.productionEnabled === false).
     • Tracking-loss pauses counting and never manufactures a false rep on
       recovery.

   The engine is exercised offline by scripts/qa-live-v3.mjs with SYNTHETIC
   landmark sequences (logic-only — NOT real-camera computer-vision accuracy)
   and by scripts/qa-live-v3-video.mjs with REAL video through real MoveNet.
   ========================================================================== */
(function (root) {
  'use strict';

  var ENGINE_VERSION = 'live-proof-v3';
  var KP_MIN_SCORE = 0.3;

  // ── canonical machine-readable rejection / form reason codes ────────────────
  var REASONS = {
    person_not_visible: 'person_not_visible',
    required_landmark_missing: 'required_landmark_missing',
    equipment_not_visible: 'equipment_not_visible',
    equipment_not_associated_with_hand: 'equipment_not_associated_with_hand',
    movement_too_small: 'movement_too_small',
    top_range_not_reached: 'top_range_not_reached',
    bottom_range_not_reached: 'bottom_range_not_reached',
    incorrect_phase_order: 'incorrect_phase_order',
    movement_too_fast: 'movement_too_fast',
    tracking_lost_mid_rep: 'tracking_lost_mid_rep',
    excessive_body_swing: 'excessive_body_swing',
    incomplete_lockout: 'incomplete_lockout',
    incomplete_depth: 'incomplete_depth',
    invalid_camera_view: 'invalid_camera_view',
    low_tracking_confidence: 'low_tracking_confidence',
    // form-signal codes (Phase 4 — measurable, body-scale-normalised)
    elbow_drift: 'elbow_drift',
    shoulder_lift: 'shoulder_lift',
    excessive_torso_lean: 'excessive_torso_lean',
    uneven_extension: 'uneven_extension',
    wrist_below_elbow: 'wrist_below_elbow',
    hips_too_high: 'hips_too_high',
    hips_too_low: 'hips_too_low',
    hold_form_broken: 'hold_form_broken'
  };

  // ── geometry helpers ────────────────────────────────────────────────────────
  function kp(pose, name) {
    var a = (pose && pose.keypoints) || [];
    for (var i = 0; i < a.length; i++) {
      if (a[i].name === name && Number(a[i].score || 0) >= KP_MIN_SCORE) return a[i];
    }
    return null;
  }
  function angle(a, b, c) {
    if (!a || !b || !c) return null;
    var x1 = a.x - b.x, y1 = a.y - b.y, x2 = c.x - b.x, y2 = c.y - b.y;
    var m1 = Math.hypot(x1, y1), m2 = Math.hypot(x2, y2);
    if (!m1 || !m2) return null;
    return Math.acos(Math.max(-1, Math.min(1, (x1 * x2 + y1 * y2) / (m1 * m2)))) * 180 / Math.PI;
  }
  function midY(a, b) { return a && b ? (a.y + b.y) / 2 : (a ? a.y : (b ? b.y : null)); }
  function midPt(a, b) {
    if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return a || b || null;
  }
  function minScore() {
    var s = 1;
    for (var i = 0; i < arguments.length; i++) { var p = arguments[i]; if (!p) return 0; s = Math.min(s, Number(p.score || 0)); }
    return s;
  }
  // body scale = torso length (mid-shoulder → mid-hip). All form distances are
  // divided by this so thresholds are camera-distance independent (no raw pixels).
  function torsoScale(pose) {
    var s = midPt(kp(pose, 'left_shoulder'), kp(pose, 'right_shoulder'));
    var h = midPt(kp(pose, 'left_hip'), kp(pose, 'right_hip'));
    if (!s || !h) return null;
    var d = Math.hypot(s.x - h.x, s.y - h.y);
    return d >= 1 ? d : null;
  }
  // torso lean from vertical in degrees (0 = perfectly upright)
  function torsoLeanDeg(pose) {
    var s = midPt(kp(pose, 'left_shoulder'), kp(pose, 'right_shoulder'));
    var h = midPt(kp(pose, 'left_hip'), kp(pose, 'right_hip'));
    if (!s || !h) return null;
    var dx = Math.abs(s.x - h.x), dy = Math.abs(s.y - h.y);
    if (dx < 0.001 && dy < 0.001) return null;
    return Math.atan2(dx, dy) * 180 / Math.PI;
  }
  // signed perpendicular offset of the hip from the shoulder→ankle line, in body
  // scales. Positive = hip on the "up" side of the line (piked), negative = sagging.
  function hipLineOffset(pose) {
    var sh = kp(pose, 'left_shoulder') || kp(pose, 'right_shoulder');
    var hip = kp(pose, 'left_hip') || kp(pose, 'right_hip');
    var ank = kp(pose, 'left_ankle') || kp(pose, 'right_ankle');
    var scale = torsoScale(pose);
    if (!sh || !hip || !ank || !scale) return null;
    var vx = ank.x - sh.x, vy = ank.y - sh.y, L = Math.hypot(vx, vy);
    if (L < 1) return null;
    // cross product gives the signed distance; normalise sign so "hip above the
    // line" (screen-up, smaller y) is positive regardless of facing direction
    var cross = (vx * (hip.y - sh.y) - vy * (hip.x - sh.x)) / L;
    var upSign = vx >= 0 ? -1 : 1;
    return { offset: (cross * upSign) / scale, conf: minScore(sh, hip, ank) };
  }

  // fraction of the joints a verifier needs that are currently tracked
  function landmarksVisible(pose, side, joints) {
    if (!joints || !joints.length) return 0;
    var have = 0;
    for (var i = 0; i < joints.length; i++) {
      var name = side === 'both' ? joints[i] : side + '_' + joints[i];
      if (kp(pose, name)) have++;
    }
    return have / joints.length;
  }
  // fraction of FULL keypoint names (e.g. duration-mode movementJoints) tracked
  function namedVisible(pose, names) {
    if (!names || !names.length) return 0;
    var have = 0;
    for (var i = 0; i < names.length; i++) if (kp(pose, names[i])) have++;
    return have / names.length;
  }

  // ── camera view + best-side estimation ──────────────────────────────────────
  function estimateCameraView(pose) {
    var ls = kp(pose, 'left_shoulder'), rs = kp(pose, 'right_shoulder');
    var lh = kp(pose, 'left_hip'), rh = kp(pose, 'right_hip');
    if (!ls || !rs || !lh || !rh) return 'unknown';
    var shoulderSpan = Math.abs(ls.x - rs.x);
    var torso = Math.abs(midY(ls, rs) - midY(lh, rh)) || 1;
    var ratio = shoulderSpan / torso; // wide when facing camera, narrow when side-on
    if (ratio >= 0.55) return 'front';
    if (ratio >= 0.30) return 'front_angle';
    return 'side';
  }
  function scoreSide(pose, side, joints) {
    var sum = 0, n = 0;
    for (var i = 0; i < joints.length; i++) {
      var p = kp(pose, side + '_' + joints[i]);
      if (!p) return -1; // missing a required joint on this side
      sum += Number(p.score || 0); n++;
    }
    return n ? sum / n : -1;
  }
  function bestSide(pose, joints) {
    if (!joints || !joints.length) return 'none';
    var l = scoreSide(pose, 'left', joints), r = scoreSide(pose, 'right', joints);
    if (l < 0 && r < 0) return 'none';
    if (l < 0) return 'right';
    if (r < 0) return 'left';
    return l >= r ? 'left' : 'right';
  }

  // ── optional equipment association ───────────────────────────────────────────
  // frame.objects (when a real detector exists) is
  //   [{class,score,box:{x,y,w,h},trackId?,occluded?}]
  // in the SAME coordinate space as the pose keypoints. With no trained model
  // bundled this is always empty → equipment stays honestly unverified.
  function associateEquipment(frame, wrist, cls) {
    var none = { visible: false, confidence: 0, associated: false, trackId: null, occluded: false };
    var objs = (frame && frame.objects) || [];
    if (!wrist || !objs.length) return none;
    var best = null, bestD = Infinity;
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (String(o.class || '').toLowerCase() !== cls) continue;
      var b = o.box || {};
      var cx = b.x + (b.w || 0) / 2, cy = b.y + (b.h || 0) / 2;
      var d = Math.hypot(cx - wrist.x, cy - wrist.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    if (!best) return none;
    // associate when the object centre is within ~1.5 hand-widths of the wrist
    var b2 = best.box || {}, reach = Math.max(b2.w || 0, b2.h || 0) * 1.5 + 30;
    return { visible: true, confidence: Number(best.score || 0), associated: bestD <= reach,
             trackId: best.trackId != null ? best.trackId : null, occluded: !!best.occluded };
  }

  /* ==========================================================================
     FORM MONITOR — measurable per-exercise form signals (Phase 4).
     Every signal is body-scale-normalised (never raw pixels) and must PERSIST
     for persistMs before it becomes an active issue. Resolution = the signal's
     measure returning null/0 clears it. Cooldown/user-cue live in the coach
     rules (vision-live-coach-rules-v3.js) keyed by the same reason code.
     A signal marked repInvalidating that persisted during the current excursion
     rejects the rep candidate with its reason code.
     ========================================================================== */
  function FormMonitor(signals) {
    this.signals = signals || [];
    this.state = {};    // reason -> { since }
    this.repFlags = {}; // repInvalidating reasons persistent during this excursion
  }
  FormMonitor.prototype.reset = function () { this.state = {}; this.repFlags = {}; };
  FormMonitor.prototype.clearRepFlags = function () { this.repFlags = {}; };
  FormMonitor.prototype.currentRepFlag = function () {
    for (var k in this.repFlags) return k;
    return null;
  };
  // returns the highest-severity persistent issue { reason, severity, confidence } or null
  FormMonitor.prototype.update = function (pose, side, now, ctx) {
    var active = null;
    for (var i = 0; i < this.signals.length; i++) {
      var sig = this.signals[i], m = null;
      try { m = sig.measure(pose, side, ctx); } catch (e) { m = null; }
      if (m && m.sev > 0) {
        var st = this.state[sig.reason];
        if (!st) st = this.state[sig.reason] = { since: now };
        var persisted = (now - st.since) >= (sig.persistMs == null ? 400 : sig.persistMs);
        if (persisted) {
          if (sig.repInvalidating && m.sev >= 0.95) this.repFlags[sig.reason] = true;
          if (!active || m.sev > active.severity) {
            active = { reason: sig.reason, severity: Math.min(2, m.sev), confidence: m.conf == null ? 1 : m.conf };
          }
        }
      } else {
        delete this.state[sig.reason]; // resolved
      }
    }
    return active;
  };

  // ── shared signal builders (each returns {sev, conf} or null) ───────────────
  // torso swings/leans past `deg` degrees from vertical
  function sigTorsoLean(deg, repInvalidating, reason) {
    return { reason: reason || REASONS.excessive_torso_lean, persistMs: 450, repInvalidating: !!repInvalidating,
      measure: function (pose) {
        var lean = torsoLeanDeg(pose);
        if (lean == null || lean <= deg) return null;
        return { sev: (lean - deg) / 12, conf: minScore(kp(pose, 'left_shoulder') || kp(pose, 'right_shoulder'), kp(pose, 'left_hip') || kp(pose, 'right_hip')) };
      } };
  }
  // working elbow drifts forward/away from the shoulder line (curls) — front views only
  function sigElbowDrift(maxFrac) {
    return { reason: REASONS.elbow_drift, persistMs: 500,
      measure: function (pose, side, ctx) {
        if (ctx.view === 'side') return null; // horizontal drift unmeasurable side-on
        var sh = kp(pose, side + '_shoulder'), el = kp(pose, side + '_elbow');
        var scale = ctx.scale || torsoScale(pose);
        if (!sh || !el || !scale) return null;
        var drift = Math.abs(el.x - sh.x) / scale;
        if (drift <= maxFrac) return null;
        return { sev: (drift - maxFrac) / 0.15, conf: minScore(sh, el) };
      } };
  }
  // shoulder shrugging toward the ear (curls / raises)
  function sigShoulderLift(minFrac) {
    return { reason: REASONS.shoulder_lift, persistMs: 600,
      measure: function (pose, side, ctx) {
        var sh = kp(pose, side + '_shoulder'), ear = kp(pose, side + '_ear') || kp(pose, 'nose');
        var scale = ctx.scale || torsoScale(pose);
        if (!sh || !ear || !scale) return null;
        var gap = Math.abs(sh.y - ear.y) / scale;
        if (gap >= minFrac) return null;
        return { sev: (minFrac - gap) / 0.08, conf: minScore(sh, ear) };
      } };
  }
  // both arms visible but moving through clearly different ranges (press/raise/squat)
  function sigUnevenSides(metric, maxDelta, repInvalidating) {
    return { reason: REASONS.uneven_extension, persistMs: 700, repInvalidating: !!repInvalidating,
      measure: function (pose) {
        var l = metric(pose, 'left'), r = metric(pose, 'right');
        if (l == null || r == null) return null; // only judged when BOTH are measurable
        var d = Math.abs(l - r);
        if (d <= maxDelta) return null;
        return { sev: (d - maxDelta) / 25, conf: 0.8 };
      } };
  }
  // pressing with wrists collapsing below the elbows while arms are extended
  function sigWristBelowElbow() {
    return { reason: REASONS.wrist_below_elbow, persistMs: 450,
      measure: function (pose, side, ctx) {
        var el = kp(pose, side + '_elbow'), wr = kp(pose, side + '_wrist');
        var scale = ctx.scale || torsoScale(pose);
        if (!el || !wr || !scale) return null;
        var m = ctx.metricValue;
        if (m == null || m < 120) return null;    // only judged in the extended range
        var below = (wr.y - el.y) / scale;        // +ve = wrist below elbow on screen
        if (below <= 0.10) return null;
        return { sev: (below - 0.10) / 0.15, conf: minScore(el, wr) };
      } };
  }
  // push-up body line: hips piking up or sagging down off the shoulder→ankle line.
  // repInvalidating: true — the pushup registry's own default_reject_if text promises
  // "Reject if the hips sag or pike out of a straight line"; without this flag these
  // signals only ever produced a coaching cue and never actually rejected a rep no
  // matter how severe the sag/pike was (found while auditing Phase 4 adversarial
  // coverage against the mission's "body-line constraints" requirement).
  function sigBodyLine(maxFrac) {
    return [
      { reason: REASONS.hips_too_high, persistMs: 500, repInvalidating: true,
        measure: function (pose) {
          var h = hipLineOffset(pose);
          if (!h || h.offset <= maxFrac) return null;
          return { sev: (h.offset - maxFrac) / 0.15, conf: h.conf };
        } },
      { reason: REASONS.hips_too_low, persistMs: 500, repInvalidating: true,
        measure: function (pose) {
          var h = hipLineOffset(pose);
          if (!h || h.offset >= -maxFrac) return null;
          return { sev: (-h.offset - maxFrac) / 0.15, conf: h.conf };
        } }
    ];
  }

  /* ==========================================================================
     CALIBRATION + ANCHOR-BASED REP MACHINE
     --------------------------------------------------------------------------
     A rep is one full excursion from the user's resting anchor extreme to the
     opposite extreme and back. Thresholds are derived from the user's OWN
     observed range (calibration), not fixed textbook angles. Every candidate
     that fails a gate is rejected with a specific machine-readable reason.
     ========================================================================== */
  var EMA = 0.45;              // metric smoothing
  var CALIB_FRAMES = 4;        // frames to establish a stable rest baseline
  var DEBOUNCE_MS = 400;       // min gap between counted reps
  var CORE_LOSS_MS = 400;      // grace before core-body tracking loss resets
  var LOWER_LOSS_MS = 650;     // longer grace for lower-body drills

  function RepMachine(spec) {
    this.minAmplitude = spec.minAmplitude;   // required peak-to-peak deg for a valid rep
    this.minRepMs = spec.minRepMs || 450;
    this.maxRepMs = spec.maxRepMs || 12000;
    this.zoneFrac = spec.zoneFrac || 0.30;   // how deep into an extreme counts as "in the zone"
    this.reset();
  }
  RepMachine.prototype.reset = function () {
    this.ema = null; this.calibrated = false;
    this.restAngle = null; this.flexAngle = null; // running extrema
    this.baselineCount = 0; this.baselineSum = 0; this.startAvg = null;
    this.anchorAtTop = null;                       // which extreme the user rests at
    this.phase = 'idle'; this.inExcursion = false; this.reachedOpposite = false;
    this.exStart = 0; this.exMin = 180; this.exMax = 0;
    this.reps = 0; this.rejected = 0; this.lastRep = 0;
    this.lastReason = null; this.lastMeasure = null;
  };
  // restart calibration WITHOUT losing already-counted reps (Phase 5 restart button)
  RepMachine.prototype.recalibrate = function () {
    var reps = this.reps, rejected = this.rejected, lastRep = this.lastRep;
    this.reset();
    this.reps = reps; this.rejected = rejected; this.lastRep = lastRep;
  };
  // returns { repCompleted, rejected:{reason,measurements}|null, phase, calibrated,
  //           angle, romMin, romMax, calibration:{top,bottom} }
  RepMachine.prototype.update = function (rawAngle, now, ctx) {
    if (rawAngle == null) {
      // metric unavailable this frame → do not advance; caller handles tracking loss
      return { repCompleted: false, rejected: null, phase: this.phase, calibrated: this.calibrated,
               angle: null, calibration: this._calib() };
    }
    this.ema = this.ema == null ? rawAngle : this.ema * (1 - EMA) + rawAngle * EMA;
    var a = this.ema;
    if (this.restAngle == null) { this.restAngle = a; this.flexAngle = a; }
    // continuously widen the observed range (this is the personal calibration)
    if (a > this.restAngle) this.restAngle = a;
    if (a < this.flexAngle) this.flexAngle = a;

    // CALIBRATION: learn the user's rest anchor + full personal range from one
    // practice excursion before any rep is counted. The practice rep is NOT
    // counted; the anchor is set from where the user rests, never mid-motion.
    if (!this.calibrated) {
      if (this.startAvg == null) {
        this.baselineSum += a; this.baselineCount++;
        if (this.baselineCount >= CALIB_FRAMES) this.startAvg = this.baselineSum / this.baselineCount;
      }
      var range = this.restAngle - this.flexAngle;
      if (this.startAvg != null && range >= this.minAmplitude &&
          Math.abs(a - this.startAvg) <= range * this.zoneFrac) {
        // practice excursion complete and returned to the start → lock calibration
        this.calibrated = true;
        this.anchorAtTop = this.startAvg >= (this.restAngle + this.flexAngle) / 2;
        this.phase = this.anchorAtTop ? 'top' : 'bottom';
        this.inExcursion = false; this.reachedOpposite = false;
        this.exMin = a; this.exMax = a;
      }
      return { repCompleted: false, rejected: null, phase: 'calibrating', calibrated: this.calibrated,
               angle: a, calibration: this._calib() };
    }

    var rng = Math.max(1, this.restAngle - this.flexAngle);
    var topEnter = this.restAngle - rng * this.zoneFrac;
    var botEnter = this.flexAngle + rng * this.zoneFrac;
    var inTop = a >= topEnter, inBottom = a <= botEnter;
    this.phase = inTop ? 'top' : inBottom ? 'bottom' : (this.inExcursion && this.reachedOpposite ? 'returning' : 'transition');

    var anchorZone = this.anchorAtTop ? inTop : inBottom;
    var oppositeZone = this.anchorAtTop ? inBottom : inTop;

    // update the current excursion's achieved range
    if (this.inExcursion) { if (a < this.exMin) this.exMin = a; if (a > this.exMax) this.exMax = a; }

    if (!this.inExcursion && !anchorZone) {
      // left the anchor → begin a candidate rep
      this.inExcursion = true; this.reachedOpposite = false;
      this.exStart = now; this.exMin = a; this.exMax = a;
    } else if (this.inExcursion && oppositeZone) {
      this.reachedOpposite = true;
    } else if (this.inExcursion && anchorZone) {
      // returned to the anchor → resolve the candidate
      var cand = this._resolve(now, ctx);
      this.inExcursion = false; this.reachedOpposite = false;
      return cand;
    }
    return { repCompleted: false, rejected: null, phase: this.phase, calibrated: true,
             angle: a, romMin: this.exMin, romMax: this.exMax, calibration: this._calib() };
  };
  RepMachine.prototype._calib = function () {
    if (this.restAngle == null) return null;
    return { top: Math.round(this.restAngle), bottom: Math.round(this.flexAngle),
             anchorAtTop: this.anchorAtTop };
  };
  RepMachine.prototype._reject = function (reason, now, measurements) {
    this.rejected++; this.lastReason = reason; this.lastMeasure = measurements || null;
    return { repCompleted: false, rejected: { reason: reason, measurements: measurements || {} },
             phase: this.phase, calibrated: true, angle: this.ema, calibration: this._calib() };
  };
  RepMachine.prototype._resolve = function (now, ctx) {
    var achieved = this.exMax - this.exMin;
    var elapsed = now - this.exStart;
    var meas = { rom: Math.round(achieved), elapsedMs: Math.round(elapsed),
                 requiredRom: this.minAmplitude };
    // 1. never reached the opposite extreme → shallow / incomplete
    if (!this.reachedOpposite || achieved < this.minAmplitude) {
      var reason = this.anchorAtTop ? REASONS.bottom_range_not_reached : REASONS.top_range_not_reached;
      if (achieved < this.minAmplitude * 0.55) reason = REASONS.movement_too_small;
      return this._reject(reason, now, meas);
    }
    // 2. implausibly fast (bounced / jittered) → not a controlled rep
    if (elapsed < this.minRepMs) return this._reject(REASONS.movement_too_fast, now, meas);
    if (elapsed > this.maxRepMs) return this._reject(REASONS.incorrect_phase_order, now, meas);
    // 3. debounce a double-count
    if (this.lastRep && now - this.lastRep < DEBOUNCE_MS) return this._reject(REASONS.movement_too_fast, now, meas);
    // 4. form gate accumulated by the FormMonitor during this excursion (e.g. body
    //    swing) — reject the candidate with the specific form reason
    if (ctx && ctx.formReject) return this._reject(ctx.formReject, now, meas);
    this.reps++; this.lastRep = now;
    return { repCompleted: true, rejected: null, phase: this.phase, calibrated: true,
             angle: this.ema, romMin: this.exMin, romMax: this.exMax, calibration: this._calib() };
  };
  RepMachine.prototype.dropPartial = function () {
    // tracking lost mid-rep → discard the candidate, keep completed reps, no false count
    var had = this.inExcursion;
    this.inExcursion = false; this.reachedOpposite = false;
    return had;
  };

  /* ==========================================================================
     VERIFIER — wraps a RepMachine (or hold/duration logic) with tracking,
     camera-view, side selection, form monitoring, equipment signal, and a
     uniform result shape. update() BRANCHES BY MODE first: rep mode reads
     workingLandmarks; hold mode reads its own required landmarks; duration
     mode reads movementJoints — no mode ever touches another mode's fields.
     ========================================================================== */
  function Verifier(spec) {
    this.spec = spec;
    this.id = spec.verifierId;
    this.version = spec.verifierVersion;
    this.exerciseId = spec.exerciseId;
    this.mode = spec.mode; // 'reps' | 'hold' | 'duration'
    this.side = 'none';
    this.reset();
  }
  Verifier.prototype.reset = function () {
    var s = this.spec;
    this.side = 'none';
    this.machine = this.mode === 'reps' ? new RepMachine(s) : null;
    this.machineR = (this.mode === 'reps' && s.bilateral) ? new RepMachine(s) : null; // right arm
    this.form = (this.mode === 'reps' && s.formSignals && s.formSignals.length) ? new FormMonitor(s.formSignals) : null;
    this.holdMs = 0; this.validDurationMs = 0;
    this.lastFrame = 0; this.lastValid = 0; this.lossStart = 0;
    this.reps = 0; this.rejectedReps = 0;
    this.cameraView = 'unknown'; this.paused = false;
    this.prevCentre = null; this.prevMovementPoints = null; this.lastMoveAt = 0;
    this._lastHoldAt = 0;
  };
  // restart practice calibration but KEEP the reps already counted (Phase 5)
  Verifier.prototype.recalibrate = function () {
    if (this.machine) this.machine.recalibrate();
    if (this.machineR) this.machineR.recalibrate();
    if (this.form) this.form.reset();
    this.side = 'none'; this.lossStart = 0;
  };

  Verifier.prototype._baseResult = function (extra) {
    var s = this.spec;
    return Object.assign({
      engineVersion: ENGINE_VERSION,
      exerciseId: this.exerciseId,
      verifierId: this.id,
      verifierVersion: this.version,
      mode: this.mode,
      state: 'need_setup',
      cameraView: this.cameraView,
      selectedSide: this.side,
      personVisible: false, personConfidence: 0, requiredLandmarksVisible: 0,
      equipmentRequired: !!(s.requiredEquipment && s.requiredEquipment.length),
      equipmentVisible: false, equipmentConfidence: 0, equipmentAssociated: false,
      equipmentTrackId: null, equipmentOccluded: false, workingHand: null,
      weightVerified: false,
      phase: 'idle', jointAngle: null, calibrated: false, calibration: null,
      repCompleted: false, reps: this.reps, rejectedReps: this.rejectedReps,
      rejectionReason: null, rejectionMeasurements: null,
      holdMs: this.holdMs, validDurationMs: this.validDurationMs,
      formIssue: null,
      coachReason: null, cue: ''
    }, extra || {});
  };

  Verifier.prototype.update = function (frame) {
    var s = this.spec, pose = frame && frame.pose;
    var now = Number(frame && frame.timestamp || 0);
    var gap = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;

    // hard frame gap → discard any partial rep candidate
    if (gap > 1000) {
      if (this.machine) this.machine.dropPartial();
      if (this.machineR) this.machineR.dropPartial();
      if (this.form) this.form.clearRepFlags();
    }

    // person / landmark visibility
    if (!pose || !pose.keypoints || !pose.keypoints.length) {
      return this._loss(now, REASONS.person_not_visible, 'Step into frame');
    }
    this.cameraView = estimateCameraView(pose);

    // ── MODE BRANCH — each mode reads only its own spec fields ──
    if (this.mode === 'duration') return this._updateDuration(frame, pose, now, gap);
    if (this.mode === 'hold') return this._updateHold(frame, pose, now, gap);
    if (s.bilateral) return this._updateBilateral(frame, now, gap);

    // ── rep mode (single working side) ──
    var joints = s.workingLandmarks; // e.g. ['shoulder','elbow','wrist']
    var chosen = this.side === 'none' ? bestSide(pose, joints) : this.side;
    var vis = chosen === 'none' ? 0 : landmarksVisible(pose, chosen, joints);
    if (chosen === 'none' || vis < (s.minVisibility || 0.75)) {
      return this._loss(now, chosen === 'none' ? REASONS.person_not_visible : REASONS.required_landmark_missing,
        chosen === 'none' ? 'Show your working side to the camera' : 'Keep ' + joints.join(', ') + ' in frame');
    }
    this.side = chosen; this.lossStart = 0; this.lastValid = now;

    // camera-view gate
    if (s.acceptedViews && s.acceptedViews.indexOf(this.cameraView) < 0 && this.cameraView !== 'unknown') {
      return this._baseResult({ state: 'need_setup', personVisible: true, personConfidence: vis,
        requiredLandmarksVisible: vis, coachReason: REASONS.invalid_camera_view,
        cue: s.viewHint || 'Adjust your camera angle for this exercise' });
    }

    // equipment signal (optional evidence — never fabricated, never a hard gate here)
    var equip = { visible: false, confidence: 0, associated: false, trackId: null, occluded: false };
    if (s.requiredEquipment && s.requiredEquipment.length) {
      var wrist = kp(pose, this.side + '_wrist');
      equip = associateEquipment(frame, wrist, s.requiredEquipment[0]);
    }

    var metric = s.metric(pose, this.side);
    if (metric == null) return this._loss(now, REASONS.required_landmark_missing, 'Keep your joints in frame');

    // form monitor runs on EVERY frame; issues need persistence before surfacing
    var issue = null;
    if (this.form) {
      var ctx = { scale: torsoScale(pose), view: this.cameraView, metric: s.metric,
                  metricValue: metric, phase: this.machine.phase, calib: this.machine._calib() };
      issue = this.form.update(pose, this.side, now, ctx);
    }
    var formReject = (this.form && this.machine.inExcursion) ? this.form.currentRepFlag() : null;
    var out = this.machine.update(metric, now, { formReject: formReject });
    if (this.form && !this.machine.inExcursion) this.form.clearRepFlags();
    return this._repResult(out, now, vis, equip, metric, issue);
  };

  Verifier.prototype._repResult = function (out, now, vis, equip, metric, issue) {
    var state = out.calibrated ? 'ready' : 'calibrating';
    if (out.repCompleted) this.reps = this.machine.reps;
    if (out.rejected) this.rejectedReps++;
    return this._baseResult({
      state: state, personVisible: true, personConfidence: vis, requiredLandmarksVisible: vis,
      equipmentVisible: equip.visible, equipmentConfidence: equip.confidence, equipmentAssociated: equip.associated,
      equipmentTrackId: equip.trackId, equipmentOccluded: equip.occluded,
      workingHand: equip.associated ? this.side : null,
      weightVerified: false, // no trained model → weighting is never machine-verified
      phase: out.phase, jointAngle: metric == null ? null : Math.round(metric),
      calibrated: out.calibrated, calibration: out.calibration,
      repCompleted: out.repCompleted, reps: this.machine.reps, rejectedReps: this.rejectedReps,
      rejectionReason: out.rejected ? out.rejected.reason : null,
      rejectionMeasurements: out.rejected ? out.rejected.measurements : null,
      formIssue: issue,
      coachReason: out.rejected ? null : (issue ? issue.reason : null)
    });
  };

  Verifier.prototype._updateBilateral = function (frame, now, gap) {
    // alternating arms tracked independently — one arm never counts for the other,
    // and one side's rejection never erases the other side's valid completion.
    var s = this.spec, pose = frame.pose, joints = s.workingLandmarks;
    var res = this._baseResult({ phase: 'idle' });
    var sides = ['left', 'right'], anyVisible = false, visMax = 0;
    var completedSide = null, rejectedInfo = null, perSide = {};
    for (var i = 0; i < 2; i++) {
      var sd = sides[i], m = sd === 'left' ? this.machine : this.machineR;
      var vis = landmarksVisible(pose, sd, joints);
      visMax = Math.max(visMax, vis);
      if (vis < (s.minVisibility || 0.7)) {
        if (gap > 1000) m.dropPartial();
        perSide[sd] = { visible: false, phase: m.phase, reps: m.reps, calibrated: m.calibrated };
        continue;
      }
      anyVisible = true;
      var metric = s.metric(pose, sd);
      if (metric == null) { perSide[sd] = { visible: false, phase: m.phase, reps: m.reps, calibrated: m.calibrated }; continue; }
      var r = m.update(metric, now, {});
      perSide[sd] = { visible: true, phase: r.phase, reps: m.reps, calibrated: r.calibrated, angle: Math.round(metric) };
      if (r.repCompleted) { completedSide = sd; res.jointAngle = Math.round(metric); }
      if (r.rejected) { this.rejectedReps++; rejectedInfo = { side: sd, reason: r.rejected.reason, measurements: r.rejected.measurements }; }
    }
    this.reps = this.machine.reps + this.machineR.reps;
    res.reps = this.reps; res.rejectedReps = this.rejectedReps;
    res.personVisible = anyVisible;
    res.personConfidence = visMax; res.requiredLandmarksVisible = visMax;
    // calibration state reported correctly: calibrated once either arm has calibrated
    res.calibrated = !!(this.machine.calibrated || this.machineR.calibrated);
    res.calibration = this.machine._calib() || this.machineR._calib();
    res.sides = perSide; // independent per-arm phases preserved for UI/diagnostics
    if (completedSide) {
      res.repCompleted = true;
      res.phase = completedSide + '_rep';
    } else {
      res.phase = 'L:' + ((perSide.left && perSide.left.phase) || 'idle') +
                  '·R:' + ((perSide.right && perSide.right.phase) || 'idle');
    }
    // a completion outranks a same-frame rejection on the other arm
    if (rejectedInfo && !completedSide) {
      res.rejectionReason = rejectedInfo.reason;
      res.rejectionMeasurements = rejectedInfo.measurements;
      res.rejectionSide = rejectedInfo.side;
    } else if (rejectedInfo) {
      res.otherSideRejection = rejectedInfo;
    }
    res.state = anyVisible ? (res.calibrated ? 'ready' : 'calibrating') : 'need_setup';
    if (!anyVisible) { res.coachReason = REASONS.required_landmark_missing; res.cue = 'Keep both arms in frame'; }
    // equipment (per-arm) — honest, optional
    if (s.requiredEquipment && s.requiredEquipment.length) {
      var lw = kp(pose, 'left_wrist'), rw = kp(pose, 'right_wrist');
      var eL = associateEquipment(frame, lw, s.requiredEquipment[0]);
      var eR = associateEquipment(frame, rw, s.requiredEquipment[0]);
      res.equipmentVisible = eL.visible || eR.visible;
      res.equipmentConfidence = Math.max(eL.confidence, eR.confidence);
      res.equipmentAssociated = eL.associated || eR.associated;
      res.equipmentTrackId = eL.trackId != null ? eL.trackId : eR.trackId;
      res.equipmentOccluded = !!(eL.occluded || eR.occluded);
      res.workingHand = eL.associated ? 'left' : (eR.associated ? 'right' : null);
    }
    return res;
  };

  Verifier.prototype._updateHold = function (frame, pose, now, gap) {
    // hold mode uses ITS OWN required landmarks (either side qualifies) and never
    // requests rep-only fields like a working-side metric.
    var s = this.spec, joints = s.workingLandmarks || [];
    var vis = Math.max(landmarksVisible(pose, 'left', joints), landmarksVisible(pose, 'right', joints));
    if (vis < (s.minVisibility || 0.6)) {
      return this._loss(now, REASONS.required_landmark_missing, 'Keep your whole body in frame');
    }
    this.lossStart = 0; this.lastValid = now;
    var equip = { visible: false, confidence: 0, associated: false, trackId: null, occluded: false };
    if (s.requiredEquipment && s.requiredEquipment.length) {
      var wrist = kp(pose, 'left_wrist') || kp(pose, 'right_wrist');
      equip = associateEquipment(frame, wrist, s.requiredEquipment[0]);
    }
    // holdReason gives the SPECIFIC break reason (hips_too_high / hips_too_low…);
    // holdCheck remains the boolean gate. Valid time pauses while form is broken.
    var reason = s.holdReason ? s.holdReason(pose) : (s.holdCheck(pose) ? null : REASONS.hold_form_broken);
    var good = !reason && gap <= 500;
    if (good) {
      if (this._lastHoldAt) this.holdMs += Math.max(0, Math.min(250, now - this._lastHoldAt));
      this._lastHoldAt = now;
    } else {
      this._lastHoldAt = 0; // pause valid hold time on form break / tracking loss
    }
    return this._baseResult({
      state: 'ready', personVisible: true, personConfidence: vis, requiredLandmarksVisible: vis,
      equipmentVisible: equip.visible, equipmentConfidence: equip.confidence, equipmentAssociated: equip.associated,
      phase: good ? 'holding' : 'form_paused', holdMs: this.holdMs,
      coachReason: good ? null : (reason || REASONS.hold_form_broken),
      cue: good ? 'Hold steady' : (s.holdCue || 'Fix your position to resume the hold')
    });
  };

  Verifier.prototype._updateDuration = function (frame, pose, now, gap) {
    // duration mode uses movementJoints (full keypoint names) — it never calls
    // bestSide()/landmarksVisible() with rep-mode fields.
    var s = this.spec, joints = s.movementJoints, pts = [];
    for (var i = 0; i < joints.length; i++) { var p = kp(pose, joints[i]); if (p) pts.push({ name: joints[i], x: p.x, y: p.y }); }
    var vis = namedVisible(pose, joints);
    var ls = kp(pose, 'left_shoulder'), rs = kp(pose, 'right_shoulder'), lh = kp(pose, 'left_hip'), rh = kp(pose, 'right_hip');
    var scale = 1;
    if ((ls || rs) && (lh || rh)) scale = Math.max(1, Math.abs(midY(ls || rs, rs || ls) - midY(lh || rh, rh || lh)));
    if (pts.length < Math.ceil(joints.length * 0.65)) {
      return this._loss(now, REASONS.required_landmark_missing, 'Return to frame so movement can be tracked');
    }
    this.lossStart = 0; this.lastValid = now;
    var cx = 0, cy = 0; for (var j = 0; j < pts.length; j++) { cx += pts[j].x; cy += pts[j].y; }
    cx /= pts.length; cy /= pts.length;
    var travel = 0, matched = 0;
    if (this.prevMovementPoints) {
      for (var m = 0; m < pts.length; m++) {
        var prior = this.prevMovementPoints[pts[m].name];
        if (!prior) continue;
        travel += Math.hypot(pts[m].x - prior.x, pts[m].y - prior.y) / scale;
        matched++;
      }
      if (matched) travel /= matched;
    }
    var dt = this.lastMoveAt ? Math.min(500, Math.max(0, now - this.lastMoveAt)) : 0;
    this.prevCentre = { x: cx, y: cy };
    this.prevMovementPoints = Object.create(null);
    for (var n = 0; n < pts.length; n++) this.prevMovementPoints[pts[n].name] = { x: pts[n].x, y: pts[n].y };
    this.lastMoveAt = now;
    var moving = travel >= (s.minTravel || 0.07);
    if (moving && gap <= 600) this.validDurationMs += dt;
    return this._baseResult({
      state: 'ready', personVisible: true, personConfidence: vis, requiredLandmarksVisible: vis,
      phase: moving ? 'moving' : 'paused', validDurationMs: this.validDurationMs,
      coachReason: moving ? null : 'no_movement',
      cue: moving ? 'Movement tracked' : 'Keep moving with control'
    });
  };

  Verifier.prototype._loss = function (now, reason, cue) {
    if (!this.lossStart) this.lossStart = now;
    var s = this.spec, grace = s.lowerBody ? LOWER_LOSS_MS : CORE_LOSS_MS;
    var lost = now - this.lossStart >= grace;
    // Time-based proof must break continuity on the first missing frame. The
    // grace period controls coaching/state transitions only; it must never let
    // a hold or duration verifier credit time that was not actually tracked.
    if (s.mode === 'hold') this._lastHoldAt = 0;
    if (s.mode === 'duration') { this.prevCentre = null; this.prevMovementPoints = null; this.lastMoveAt = 0; }
    if (lost) {
      if (this.machine) this.machine.dropPartial();
      if (this.machineR) this.machineR.dropPartial();
      if (this.form) this.form.clearRepFlags();
      this.side = 'none';
    }
    return this._baseResult({
      state: lost ? 'need_setup' : 'tracking_unstable',
      coachReason: reason,
      cue: cue || 'Return to the starting position',
      // completed reps + hold are preserved; only the in-progress candidate is dropped
      reps: this.reps, holdMs: this.holdMs, validDurationMs: this.validDurationMs
    });
  };

  /* ==========================================================================
     REGISTRY VALIDATION — a verifier missing a required field for its mode is
     a build error (def() throws) and an invalid runtime contract (create()
     refuses), so the camera never starts on a broken spec.
     ========================================================================== */
  function validateSpec(spec) {
    var errs = [];
    if (!spec || typeof spec !== 'object') return ['spec_missing'];
    ['exerciseId', 'verifierId', 'verifierVersion', 'displayName', 'mode'].forEach(function (k) {
      if (!spec[k]) errs.push('missing_' + k);
    });
    if (spec.mode === 'reps') {
      if (!Array.isArray(spec.workingLandmarks) || !spec.workingLandmarks.length) errs.push('reps_missing_workingLandmarks');
      if (typeof spec.metric !== 'function') errs.push('reps_missing_metric');
      if (!(spec.minAmplitude > 0)) errs.push('reps_missing_minAmplitude');
    } else if (spec.mode === 'hold') {
      if (typeof spec.holdCheck !== 'function') errs.push('hold_missing_holdCheck');
      if (!Array.isArray(spec.workingLandmarks) || !spec.workingLandmarks.length) errs.push('hold_missing_workingLandmarks');
    } else if (spec.mode === 'duration') {
      if (!Array.isArray(spec.movementJoints) || !spec.movementJoints.length) errs.push('duration_missing_movementJoints');
      if (!(spec.minTravel > 0)) errs.push('duration_missing_minTravel');
    } else if (spec.mode) {
      errs.push('unknown_mode_' + spec.mode);
    }
    return errs;
  }
  function validateRegistry() {
    var errors = {};
    for (var k in REG) {
      var e = validateSpec(REG[k]);
      if (e.length) errors[k] = e;
    }
    return { ok: Object.keys(errors).length === 0, errors: errors };
  }
  // the runtime pre-camera contract gate: unknown exercise or invalid spec → not ok
  function validateContract(exerciseId) {
    var spec = REG[exerciseId];
    if (!spec) return { ok: false, errors: ['unknown_exercise'], spec: null };
    var e = validateSpec(spec);
    return { ok: e.length === 0, errors: e, spec: spec };
  }

  // live setup checklist for the pre-session stage (Phase 5). Returns concrete
  // per-landmark items the UI can render; all must be ok before countdown.
  function setupChecklist(exerciseId, pose) {
    var spec = REG[exerciseId];
    var items = [];
    var person = !!(pose && pose.keypoints && pose.keypoints.filter(function (p) { return Number(p.score || 0) >= KP_MIN_SCORE; }).length >= 3);
    items.push({ key: 'person', label: 'Person detected', ok: person });
    if (!spec) return items;
    var view = person ? estimateCameraView(pose) : 'unknown';
    if (spec.mode === 'duration') {
      items.push({ key: 'movement_joints', label: 'Tracked joints visible', ok: person && namedVisible(pose, spec.movementJoints) >= 0.65 });
    } else {
      var joints = spec.workingLandmarks || [];
      var side = person ? bestSide(pose, joints) : 'none';
      for (var i = 0; i < joints.length; i++) {
        var j = joints[i];
        var ok = side !== 'none' ? !!kp(pose, side + '_' + j) : !!(kp(pose, 'left_' + j) || kp(pose, 'right_' + j));
        items.push({ key: j, label: 'Working ' + j.replace(/_/g, ' ') + ' visible', ok: ok });
      }
    }
    if (spec.lowerBody || spec.mode === 'hold') {
      items.push({ key: 'lower_body', label: 'Lower body visible', ok: !!(kp(pose, 'left_ankle') || kp(pose, 'right_ankle')) });
    }
    if (spec.acceptedViews) {
      items.push({ key: 'camera_view', label: 'Camera position suitable', ok: view === 'unknown' || spec.acceptedViews.indexOf(view) >= 0 });
    }
    return items;
  }

  /* ==========================================================================
     EXERCISE REGISTRY — the canonical set of supported contracts.
     productionEnabled === false means "runs in staging but must stay on a
     fallback proof in production until the accuracy/equipment gate passes".
     ========================================================================== */
  function elbowMetric(pose, side) { return angle(kp(pose, side + '_shoulder'), kp(pose, side + '_elbow'), kp(pose, side + '_wrist')); }
  function kneeMetric(pose, side) { return angle(kp(pose, side + '_hip'), kp(pose, side + '_knee'), kp(pose, side + '_ankle')); }
  function hipMetric(pose, side) { return angle(kp(pose, side + '_shoulder'), kp(pose, side + '_hip'), kp(pose, side + '_knee')); }
  function armRaiseMetric(pose, side) { return angle(kp(pose, side + '_hip'), kp(pose, side + '_shoulder'), kp(pose, side + '_wrist')); }

  // form-signal bundles per family (Phase 4). Incomplete extension/flexion,
  // depth and speed are enforced by the calibrated RepMachine gates; these
  // signals cover the posture faults the machine alone cannot see.
  var CURL_SIGNALS = [
    sigTorsoLean(18, true, REASONS.excessive_body_swing), // swinging the weight up
    sigElbowDrift(0.38),
    sigShoulderLift(0.16)
  ];
  var PRESS_SIGNALS = [
    sigTorsoLean(22),
    sigWristBelowElbow(),
    sigUnevenSides(elbowMetric, 32)
  ];
  var RAISE_SIGNALS = [
    sigTorsoLean(18),
    sigShoulderLift(0.16),
    sigUnevenSides(armRaiseMetric, 30)
  ];
  var SQUAT_SIGNALS = [
    sigTorsoLean(48), // some forward lean is normal in a squat — flag only gross collapse
    sigUnevenSides(kneeMetric, 30)
  ];
  var PUSHUP_SIGNALS = sigBodyLine(0.16);
  // Coaching-only (not repInvalidating): a lunge naturally involves more torso
  // motion than a squat, and there is no textual reject_if promise for lunge
  // form the way pushup's body-line has — this closes the "form constraints"
  // coverage gap (previously zero form signals existed for lunge at all)
  // without risking a false rejection from a threshold that was never
  // validated against real footage.
  var LUNGE_SIGNALS = [
    sigTorsoLean(35)
  ];

  var REG = {}; // exerciseId -> spec
  function def(spec) {
    var errs = validateSpec(spec);
    if (errs.length) throw new Error('live-proof-v3 invalid verifier spec ' + (spec && spec.exerciseId) + ': ' + errs.join(','));
    REG[spec.exerciseId] = spec;
  }

  // ── bodyweight rep families ────────────────────────────────────────────────
  def({ exerciseId: 'pushup', displayName: 'Push-up', verifierId: 'v3-pushup', verifierVersion: '1', mode: 'reps',
    workingLandmarks: ['shoulder', 'elbow', 'wrist'], metric: elbowMetric, minAmplitude: 40, minRepMs: 500,
    acceptedViews: ['side', 'front_angle', 'front'], viewHint: 'Turn side-on so your arm bend is visible',
    formSignals: PUSHUP_SIGNALS,
    productionEnabled: true, requiredEquipment: [] });
  def({ exerciseId: 'squat', displayName: 'Squat', verifierId: 'v3-squat', verifierVersion: '1', mode: 'reps',
    workingLandmarks: ['hip', 'knee', 'ankle'], metric: kneeMetric, minAmplitude: 45, minRepMs: 550, lowerBody: true,
    acceptedViews: ['side', 'front_angle'], viewHint: 'Turn slightly side-on so your knee bend shows',
    formSignals: SQUAT_SIGNALS,
    productionEnabled: true, requiredEquipment: [] });
  def({ exerciseId: 'lunge', displayName: 'Lunge', verifierId: 'v3-lunge', verifierVersion: '1', mode: 'reps',
    workingLandmarks: ['hip', 'knee', 'ankle'], metric: kneeMetric, minAmplitude: 45, minRepMs: 600, lowerBody: true,
    acceptedViews: ['side', 'front_angle'], formSignals: LUNGE_SIGNALS,
    productionEnabled: true, requiredEquipment: [] });
  // No formSignals: the hip-angle metric already IS the primary form concern for
  // a sit-up/crunch (torso-to-thigh range), and none of the existing signal
  // helpers (built for standing/overhead-press postures — torso lean relative to
  // a vertical stance, shoulder-to-ear shrug distance) have been validated
  // against a lying-down posture. A geometrically-unvalidated new check risks
  // confusing/wrong coaching cues, which is worse than no check — an honest gap,
  // not a silently-invented one.
  def({ exerciseId: 'situp', displayName: 'Sit-up / Crunch', verifierId: 'v3-situp', verifierVersion: '1', mode: 'reps',
    workingLandmarks: ['shoulder', 'hip', 'knee'], metric: hipMetric, minAmplitude: 35, minRepMs: 500,
    acceptedViews: ['side', 'front_angle'], productionEnabled: true, requiredEquipment: [] });
  def({ exerciseId: 'pullup', displayName: 'Pull-up / Chin-up', verifierId: 'v3-pullup', verifierVersion: '1', mode: 'reps',
    workingLandmarks: ['shoulder', 'elbow', 'wrist'], metric: elbowMetric, minAmplitude: 55, minRepMs: 600,
    acceptedViews: ['front', 'front_angle'], productionEnabled: true, requiredEquipment: [] });

  // ── holds ──────────────────────────────────────────────────────────────────
  function plankLine(pose) {
    var sh = kp(pose, 'left_shoulder') || kp(pose, 'right_shoulder');
    var hip = kp(pose, 'left_hip') || kp(pose, 'right_hip');
    var ank = kp(pose, 'left_ankle') || kp(pose, 'right_ankle');
    if (!sh || !hip || !ank) return null;
    var line = angle(sh, hip, ank);
    var dx = Math.abs(sh.x - ank.x), dy = Math.abs(sh.y - ank.y);
    return { line: line, horizontal: dx > dy * 1.2 };
  }
  def({ exerciseId: 'plank', displayName: 'Plank', verifierId: 'v3-plank', verifierVersion: '1', mode: 'hold',
    workingLandmarks: ['shoulder', 'hip', 'ankle'], productionEnabled: true, requiredEquipment: [],
    // Every other exercise declares acceptedViews, which is what engages the
    // shared view-stability/reset hardening (coach-rules.js) — without it, a
    // camera rotation mid-hold was never detected or reset at all. plankLine()
    // itself already requires a roughly horizontal body line, which is only
    // reliably measurable from a side-on or angled view (a straight front view
    // foreshortens the shoulder-hip-ankle line too much to judge sag/pike).
    acceptedViews: ['side', 'front_angle'], viewHint: 'Turn side-on so your body line is visible',
    holdCue: 'Straighten your body line',
    holdCheck: function (pose) {
      var p = plankLine(pose);
      return !!(p && p.line != null && p.line > 150 && p.horizontal);
    },
    // specific break reason so the coach can say WHICH way to fix the hips.
    // Valid hold time pauses while any reason is active (form broken).
    holdReason: function (pose) {
      var p = plankLine(pose);
      if (!p || p.line == null) return REASONS.required_landmark_missing;
      if (!p.horizontal) return REASONS.hold_form_broken;
      if (p.line > 150) return null;
      var h = hipLineOffset(pose);
      if (h && h.offset > 0.10) return REASONS.hips_too_high;
      if (h && h.offset < -0.10) return REASONS.hips_too_low;
      return REASONS.hold_form_broken;
    } });

  // ── duration drills ─────────────────────────────────────────────────────────
  def({ exerciseId: 'shadowboxing', displayName: 'Shadowboxing', verifierId: 'v3-shadowboxing', verifierVersion: '1', mode: 'duration',
    movementJoints: ['left_wrist', 'right_wrist', 'left_elbow', 'right_elbow'], minTravel: 0.08,
    productionEnabled: true, requiredEquipment: [] });
  def({ exerciseId: 'soccer_drill', displayName: 'Soccer Drill', verifierId: 'v3-soccer', verifierVersion: '1', mode: 'duration',
    movementJoints: ['left_ankle', 'right_ankle', 'left_knee', 'right_knee'], minTravel: 0.07,
    productionEnabled: true, requiredEquipment: [] });
  def({ exerciseId: 'generic_movement', displayName: 'Verified Movement', verifierId: 'v3-generic', verifierVersion: '1', mode: 'duration',
    movementJoints: ['left_wrist', 'right_wrist', 'left_ankle', 'right_ankle'], minTravel: 0.06,
    productionEnabled: true, requiredEquipment: [] });

  // ── dumbbell rep families ────────────────────────────────────────────────────
  // These COUNT reps from pose geometry, but weightVerified is always false and
  // productionEnabled is false: without a trained dumbbell object model bundled,
  // the "weighted" claim cannot be machine-verified, so they stay staging-only
  // and fall back to photo/generic in production (see classifier + registry).
  function dumbbell(id, name, vid, opts) {
    def(Object.assign({
      exerciseId: id, displayName: name, verifierId: vid, verifierVersion: '1', mode: 'reps',
      workingLandmarks: ['shoulder', 'elbow', 'wrist'], metric: elbowMetric,
      minAmplitude: 45, minRepMs: 500, requiredEquipment: ['dumbbell'],
      acceptedViews: ['front', 'front_angle', 'side'], productionEnabled: false,
      formSignals: CURL_SIGNALS, viewHint: 'Face the camera so both arms and dumbbells are visible'
    }, opts || {}));
  }
  dumbbell('dumbbell_bicep_curl', 'Dumbbell Bicep Curl', 'v3-db-bicep-curl');
  dumbbell('dumbbell_hammer_curl', 'Hammer Curl', 'v3-db-hammer-curl');
  dumbbell('dumbbell_alt_curl', 'Alternating Dumbbell Curl', 'v3-db-alt-curl', { bilateral: true });
  dumbbell('dumbbell_shoulder_press', 'Dumbbell Shoulder Press', 'v3-db-shoulder-press',
    { minAmplitude: 50, formSignals: PRESS_SIGNALS });
  dumbbell('dumbbell_lateral_raise', 'Dumbbell Lateral Raise', 'v3-db-lateral-raise',
    { workingLandmarks: ['hip', 'shoulder', 'wrist'], metric: armRaiseMetric,
      minAmplitude: 40, minRepMs: 600, formSignals: RAISE_SIGNALS });
  dumbbell('dumbbell_front_raise', 'Dumbbell Front Raise', 'v3-db-front-raise',
    { workingLandmarks: ['hip', 'shoulder', 'wrist'], metric: armRaiseMetric,
      minAmplitude: 40, minRepMs: 600, formSignals: RAISE_SIGNALS });
  dumbbell('dumbbell_bent_row', 'Bent-over Dumbbell Row', 'v3-db-bent-row', { minAmplitude: 40 });
  dumbbell('dumbbell_one_arm_row', 'One-arm Dumbbell Row', 'v3-db-one-arm-row', { minAmplitude: 40 });
  dumbbell('goblet_squat', 'Goblet Squat', 'v3-db-goblet-squat',
    { workingLandmarks: ['hip', 'knee', 'ankle'], metric: kneeMetric, minAmplitude: 45, minRepMs: 550,
      lowerBody: true, formSignals: SQUAT_SIGNALS });
  dumbbell('dumbbell_rdl', 'Dumbbell Romanian Deadlift', 'v3-db-rdl',
    { workingLandmarks: ['shoulder', 'hip', 'knee'], metric: hipMetric, minAmplitude: 35, minRepMs: 700,
      lowerBody: true, formSignals: [] });
  dumbbell('dumbbell_bench_press', 'Dumbbell Bench Press', 'v3-db-bench-press', { minAmplitude: 45, formSignals: [] });
  dumbbell('dumbbell_tricep_extension', 'Dumbbell Tricep Extension', 'v3-db-tricep-ext', { minAmplitude: 45, formSignals: [] });
  dumbbell('dumbbell_lunge', 'Weighted Dumbbell Lunge', 'v3-db-lunge',
    { workingLandmarks: ['hip', 'knee', 'ankle'], metric: kneeMetric, minAmplitude: 45, minRepMs: 600,
      lowerBody: true, formSignals: SQUAT_SIGNALS });

  function create(exerciseIdOrSpec) {
    var spec, check;
    if (typeof exerciseIdOrSpec === 'string') {
      check = validateContract(exerciseIdOrSpec);
      if (!check.ok) return null;
      spec = check.spec;
    } else {
      spec = exerciseIdOrSpec;
      if (!spec || validateSpec(spec).length) return null;
    }
    return new Verifier(spec);
  }
  function createByVerifierId(vid) {
    for (var k in REG) if (REG[k].verifierId === vid) return create(k);
    return null;
  }

  var api = {
    ENGINE_VERSION: ENGINE_VERSION,
    REASONS: REASONS,
    registry: REG,
    create: create,
    createByVerifierId: createByVerifierId,
    validateSpec: validateSpec,
    validateRegistry: validateRegistry,
    validateContract: validateContract,
    setupChecklist: setupChecklist,
    estimateCameraView: estimateCameraView,
    bestSide: bestSide,
    torsoScale: torsoScale, torsoLeanDeg: torsoLeanDeg, hipLineOffset: hipLineOffset,
    kp: kp, angle: angle,
    isProductionEnabled: function (exerciseId) { return !!(REG[exerciseId] && REG[exerciseId].productionEnabled); },
    listExercises: function () { return Object.keys(REG); }
  };
  root.VISION = root.VISION || {};
  root.VISION.liveV3 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
