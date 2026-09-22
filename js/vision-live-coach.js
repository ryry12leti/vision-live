/* ============================================================================
   VISION · Real-Time Live Proof Engine  (window.VISION.liveCoach)
   ----------------------------------------------------------------------------
   Powers "live" proof: the user performs a physical drill on camera and the
   session itself becomes the proof. Three layers, all fail-safe, mobile-light:

     1. POSE VERIFIER (on-device, TFJS MoveNet): loaded lazily from CDN when a
        session starts. Inference runs on a SMALL offscreen canvas (≤256px,
        ≤192px on phones) at 3–5fps — never the full-res video — so phone GPUs
        don't OOM; the backend falls back webgl → wasm → cpu. Each task's own
        rep/hold/duration target is parsed (parseLiveSpec) and drives both the
        verifier and the finish gate. Reps only count on a full clean cycle
        (hysteresis + smoothing), holds only accumulate while the body line is
        actually held. If the model can't load the engine degrades to layer 2.
     2. MOTION ENGINE (instant, zero dependency): a tiny frame-differencing
        loop reads the live <video> on a 96×72 canvas ~10×/s and emits an
        instant motion level + sustained-activity time + a rough rep count.
     3. CLOUD COACH (semantic, supplementary): every ~2.5s one small frame is
        POSTed to the `live-coach` Edge Function for a live cue
        { status:'good'|'adjust'|'offtask', cue }. Enriches, never gates.

   Nothing here awards points or stores frames. On finish the controller
   exposes the best 'good' still + a structured evidence summary; the caller
   uploads them through VISION.api.submitProof and the validate-proof Edge
   Function (OpenAI vision) weighs the whole session's evidence for the verdict.
   ========================================================================== */
(function () {
  'use strict';

  // ── evidence gate: how much real activity before "Finish & verify" unlocks ──
  var MIN_GOOD_FRAMES = 4;      // cloud frames judged on-task …
  var MIN_SECONDS     = 15;     // … across ≥15s, OR
  var MIN_ACTIVE_MS   = 8000;   // ≥8s of sustained real movement (works offline), OR
  var MIN_REPS        = 6;      // ≥6 detected reps, OR
  var CLOUD_MS        = 2500;   // cloud-cue cadence
  var TICK_MS         = 100;    // motion sample + HUD cadence (~10fps)
  var POSE_MS         = 200;    // pose inference cadence (~5fps)
  var MAX_FRAMES      = 40;     // cloud frame cap / session (matches the Edge Function)
  // motion thresholds (mean abs frame diff, scaled to ~0..1)
  var MOTION_SCALE    = 14;
  var MOTION_ACTIVE   = 0.12;   // above this = "moving"
  var REP_HI          = 0.34;   // arm a rep
  var REP_LO          = 0.14;   // …then count it on the way down
  var KP_MIN_SCORE    = 0.3;    // keypoint confidence floor

  // ── device tier: phones / low-memory devices run pose on a SMALLER canvas at a
  //    SLOWER cadence so the WebGL backend never OOM-crashes the tab (the old bug).
  //    Every metric is an angle/ratio/relative comparison, so downscaling the
  //    inference frame never changes a result — it only bounds GPU texture memory. ──
  var IS_MOBILE = (function () {
    try {
      var ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      var mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
      var cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 0;
      return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) || (mem && mem <= 4) || (cores && cores <= 4);
    } catch (e) { return false; }
  })();
  var POSE_CANVAS_MAX = IS_MOBILE ? 192 : 256;  // longest inference-canvas edge
  if (IS_MOBILE) POSE_MS = 333;                 // ~3fps on phones (desktop stays ~5fps)

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); },
                   function (e) { clearTimeout(t); reject(e); });
    });
  }

  // grab a jpeg dataURL from the live video (for the cloud coach / poster)
  function grabFrame(video, maxW, quality) {
    var vw = video.videoWidth || 640, vh = video.videoHeight || 480;
    if (!vw || !vh) return null;
    var scale = Math.min(1, maxW / vw);
    var w = Math.round(vw * scale), h = Math.round(vh * scale);
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    try { cv.getContext('2d').drawImage(video, 0, 0, w, h); return cv.toDataURL('image/jpeg', quality); }
    catch (e) { return null; }
  }

  function newSessionId() {
    var r = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? crypto.getRandomValues(new Uint32Array(2)).join('')
      : String(Math.floor(Math.random() * 1e12));
    return 's' + Date.now().toString(36) + r;
  }

  /* ==========================================================================
   POSE LAYER — TFJS MoveNet, lazy singleton, fail-closed for V3.
   ========================================================================== */
  var TF_VERSION = '4.22.0';
  var POSE_DETECTION_VERSION = '2.1.3';
  var MOVENET_VERSION = 'singlepose-lightning-v4';
  var TF_URL   = '/vendor/tfjs/tf-4.22.0.min.js';
  var PD_URL   = '/vendor/pose-detection/pose-detection-2.1.3.min.js';
  var WASM_URL = '/vendor/tfjs/tf-backend-wasm-4.22.0.min.js';
  var WASM_PATH = '/vendor/tfjs/';
  var MODEL_URL = '/models/movenet-singlepose-lightning-v4/model.json';
  var detectorPromise = null;
  var activeBackend = '';   // 'webgl' | 'wasm' | 'cpu' — surfaced for engineStatus
  var poseRuntimeStatus = { state: 'idle', reason: null, tfVersion: TF_VERSION,
    poseDetectionVersion: POSE_DETECTION_VERSION, modelVersion: MOVENET_VERSION,
    modelUrl: MODEL_URL, externalRequests: 0 };

  var scriptPromises = {};
  function loadScript(src, ready) {
    if (ready()) return Promise.resolve();
    if (scriptPromises[src]) return scriptPromises[src];
    scriptPromises[src] = withTimeout(new Promise(function (resolve, reject) {
      if (ready()) return resolve();
      var existing = document.querySelector('script[data-vision-src="' + src + '"]');
      if (existing) { existing.addEventListener('load', function(){ ready() ? resolve() : reject(new Error('script_no_global')); }, { once:true }); existing.addEventListener('error', reject, { once:true }); return; }
      var s = document.createElement('script');
      s.src = src; s.async = true; s.setAttribute('data-vision-src', src);
      s.onload = function () { ready() ? resolve() : reject(new Error('script_no_global')); };
      s.onerror = function () { reject(new Error('script_load_failed')); };
      document.head.appendChild(s);
    }), 12000).catch(function(e){ var s=document.querySelector('script[data-vision-src="'+src+'"]'); if(s&&s.parentNode)s.parentNode.removeChild(s); delete scriptPromises[src]; throw e; });
    return scriptPromises[src];
  }

  // Pick a backend that won't OOM a phone: webgl (with F16 + memory-frugal flags)
  // → wasm → cpu. Whatever wins is recorded in activeBackend.
  async function selectBackend() {
    var tf = window.tf;
    try {
      tf.env().set('WEBGL_FORCE_F16_TEXTURES', true);
      tf.env().set('WEBGL_PACK', true);
      tf.env().set('WEBGL_DELETE_TEXTURE_THRESHOLD', 0);
      tf.env().set('WEBGL_CPU_FORWARD', true);
    } catch (e) {}
    try { await tf.setBackend('webgl'); await tf.ready(); if (tf.getBackend() === 'webgl') { activeBackend = 'webgl'; return; } } catch (e) {}
    try {
      await loadScript(WASM_URL, function () { return !!(tf.wasm || (window.tf && window.tf.wasm)); });
      if (tf.wasm && tf.wasm.setWasmPaths) tf.wasm.setWasmPaths(WASM_PATH);
      await tf.setBackend('wasm'); await tf.ready();
      if (tf.getBackend() === 'wasm') { activeBackend = 'wasm'; return; }
    } catch (e) {}
    try { await tf.setBackend('cpu'); await tf.ready(); activeBackend = 'cpu'; } catch (e) { activeBackend = ''; }
  }

  function getDetector() {
    if (!detectorPromise) {
      poseRuntimeStatus.state = 'loading'; poseRuntimeStatus.reason = null;
      detectorPromise = (async function () {
        await loadScript(TF_URL, function () { return !!window.tf; });
        await loadScript(PD_URL, function () { return !!window.poseDetection; });
        await selectBackend();
        if (!activeBackend) throw new Error('pose_backend_unavailable');
        await window.tf.ready();
        // MoveNet SinglePose Lightning, pinned to VISION's same-origin model.
        // No TFHub/default fallback is permitted: a missing model fails closed.
        var d = await withTimeout(window.poseDetection.createDetector(
          window.poseDetection.SupportedModels.MoveNet,
          { modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
            modelUrl: MODEL_URL, enableSmoothing: true }
        ), 20000);
        poseRuntimeStatus.state = 'ready'; poseRuntimeStatus.backend = activeBackend;
        return d;
      })().catch(function (e) {
        detectorPromise = null; // allow a later retry
        poseRuntimeStatus.state = 'failed';
        poseRuntimeStatus.reason = String(e && e.message || e || 'pose_model_unavailable').slice(0, 120);
        return null;
      });
    }
    return detectorPromise;
  }

  function kp(pose, name) {
    if (!pose || !pose.keypoints) return null;
    for (var i = 0; i < pose.keypoints.length; i++) {
      var k = pose.keypoints[i];
      if (k.name === name && k.score >= KP_MIN_SCORE) return k;
    }
    return null;
  }
  // angle in degrees at joint b, formed by a–b–c
  function jointAngle(a, b, c) {
    if (!a || !b || !c) return null;
    var v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
    var d1 = Math.sqrt(v1x * v1x + v1y * v1y), d2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (!d1 || !d2) return null;
    var cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (d1 * d2)));
    return Math.acos(cos) * 180 / Math.PI;
  }
  // best-visible side's joint angle (e.g. hip-knee-ankle) — null if neither side tracks
  function sideAngle(pose, names) { // names = [proximal, joint, distal] without side prefix
    var best = null;
    ['left_', 'right_'].forEach(function (side) {
      var a = kp(pose, side + names[0]), b = kp(pose, side + names[1]), c = kp(pose, side + names[2]);
      var ang = jointAngle(a, b, c);
      if (ang != null && (best == null || Math.min(a.score, b.score, c.score) > best.score)) {
        best = { angle: ang, score: Math.min(a.score, b.score, c.score) };
      }
    });
    return best ? best.angle : null;
  }
  // fraction of the 12 core body keypoints currently visible
  var CORE_KPS = ['left_shoulder','right_shoulder','left_elbow','right_elbow','left_hip','right_hip',
                  'left_knee','right_knee','left_ankle','right_ankle','left_wrist','right_wrist'];
  function coreVisibility(pose) {
    var n = 0;
    for (var i = 0; i < CORE_KPS.length; i++) if (kp(pose, CORE_KPS[i])) n++;
    return n / CORE_KPS.length;
  }
  function visibilityAssessment(pose, width, height, lightingConfidence) {
    var points=(pose&&pose.keypoints||[]).filter(function(p){return Number(p.score||0)>=KP_MIN_SCORE;});
    if(points.length<3)return {state:'no_person',cue:'Step into frame',confidence:0,fullBody:false};
    var xs=points.map(function(p){return p.x;}),ys=points.map(function(p){return p.y;});
    var minX=Math.min.apply(Math,xs),maxX=Math.max.apply(Math,xs),minY=Math.min.apply(Math,ys),maxY=Math.max.apply(Math,ys);
    var bw=(maxX-minX)/Math.max(1,width),bh=(maxY-minY)/Math.max(1,height),vis=coreVisibility(pose);
    var full=!!(kp(pose,'nose')&&kp(pose,'left_shoulder')&&kp(pose,'right_shoulder')&&kp(pose,'left_hip')&&kp(pose,'right_hip')&&kp(pose,'left_ankle')&&kp(pose,'right_ankle'));
    if(lightingConfidence<.18)return {state:'poor_lighting',cue:'Move into brighter, even light',confidence:vis,fullBody:full};
    if(bh>.94||bw>.94)return {state:'too_close',cue:'Step back so your body fits',confidence:vis,fullBody:full};
    if(bh<.24&&bw<.34)return {state:'too_far',cue:'Move a little closer',confidence:vis,fullBody:full};
    if(minX<width*.015||maxX>width*.985||minY<height*.015||maxY>height*.985)return {state:'out_of_frame',cue:'Centre yourself in frame',confidence:vis,fullBody:full};
    if(vis<.4)return {state:'partial_person',cue:'Show the joints needed for this task',confidence:vis,fullBody:full};
    return {state:'ready',cue:'Tracking ready',confidence:vis,fullBody:full};
  }

  /* ==========================================================================
     TASK VERIFIERS — exercise-specific rep/hold counting with hysteresis.
     A rep counts ONLY on a full down→up cycle; smoothing kills jitter counts.
     ========================================================================== */
  function detectExercise(task) {
    var hay = ((task.title || '') + ' ' + (task.proofMustShow || task.proofPrompt || '') + ' ' +
               (task.meta || task.description || '')).toLowerCase();
    // ── hold families first (a "wall sit" must not match as a squat) ──
    if (/wall.?sit/.test(hay))                  return 'wall_sit';
    if (/\bplank|hollow.?hold|hold\b.*\b(position|pose|plank)/.test(hay)) return 'plank';
    // ── rep families ──
    if (/push.?up|press.?up/.test(hay))         return 'pushup';
    if (/pull.?up|chin.?up/.test(hay))          return 'pullup';
    if (/\bsquat/.test(hay))                     return 'squat';
    if (/\blunge/.test(hay))                     return 'lunge';
    if (/jumping.?jack|star.?jump/.test(hay))    return 'jumping_jack';
    if (/burpee/.test(hay))                      return 'burpee';
    if (/mountain.?climb/.test(hay))             return 'mountain_climber';
    if (/high.?knee/.test(hay))                  return 'high_knees';
    if (/sit.?up/.test(hay))                     return 'situp';
    if (/crunch/.test(hay))                      return 'crunch';
    if (/glute.?bridge|hip.?thrust/.test(hay))   return 'glute_bridge';
    if (/calf.?raise/.test(hay))                 return 'calf_raise';
    if (/(?:shoulder|overhead|military).?press/.test(hay)) return 'shoulder_press';
    if (/bicep.?curl|\bcurl\b/.test(hay))        return 'bicep_curl';
    if (/lateral.?raise/.test(hay))              return 'lateral_raise';
    if (/jump.?rope|skip(?:ping)?.?rope/.test(hay)) return 'jump_rope';
    return 'generic';
  }
  var HOLD_EXERCISES = { plank: 1, wall_sit: 1 };

  // Parse the TASK'S OWN target so the session is accurate for THIS drill: rep
  // count (incl. sets×reps), a hold duration, or a time-based effort. Falls back
  // to sensible defaults so the finish gate always has a concrete target.
  function parseLiveSpec(task) {
    var ex = detectExercise(task);
    var t = ((task.title || '') + ' ' + (task.proofMustShow || task.proofPrompt || task.meta || task.description || '')).toLowerCase();
    var sets = 0, reps = 0, targetReps = 0, holdSeconds = 0, durationSeconds = 0;
    var m = t.match(/(\d{1,2})\s*(?:sets?\s*(?:of|x|×)?|x|×)\s*(\d{1,3})/);
    if (m) { sets = parseInt(m[1], 10); reps = parseInt(m[2], 10); }
    if (!reps) {
      var r = t.match(/(\d{1,3})\s*(?:reps?|repetitions?|push.?ups?|press.?ups?|squats?|lunges?|sit.?ups?|crunches?|burpees?|pull.?ups?|chin.?ups?|curls?|raises?|presses?|jacks?|climbers?|dips?|steps?|skips?|knees?|jumps?)\b/);
      if (r) reps = parseInt(r[1], 10);
    }
    var secs = 0;
    var mm = t.match(/(\d{1,3})\s*(?:-|\s)?\s*(?:minutes?|mins?)\b/);
    var hs = t.match(/(\d{1,3})\s*(?:-|\s)?\s*(?:seconds?|secs?|s)\b/);
    if (mm) secs = parseInt(mm[1], 10) * 60;
    else if (hs) secs = parseInt(hs[1], 10);
    // last-resort rep count: a known REP exercise with a number that never sat next
    // to a counted noun ("30 jumping jacks", "100 skips", "40 high knees"). Take the
    // first standalone integer that ISN'T a time/weight/percent value, so the target
    // matches the drill instead of silently defaulting to 10.
    if (!reps && ex !== 'generic' && !HOLD_EXERCISES[ex]) {
      var g = t.match(/\b(\d{1,3})\b(?!\s*(?:seconds?|secs?|s\b|minutes?|mins?|m\b|hours?|hrs?|kgs?|lbs?|%|x|×|reps?))/);
      if (g && !(mm || hs)) reps = parseInt(g[1], 10);
    }
    if (sets && reps) targetReps = sets * reps;
    else if (reps) targetReps = reps;
    if (secs) {
      if (HOLD_EXERCISES[ex] || /\bhold\b|plank|wall.?sit/.test(t)) holdSeconds = secs;
      else durationSeconds = secs;
    }
    if (!targetReps && !holdSeconds && !durationSeconds) {
      if (HOLD_EXERCISES[ex]) holdSeconds = 30;
      else if (ex !== 'generic') targetReps = 10;
    }
    return {
      exercise: ex, sets: sets, reps: reps,
      targetReps: Math.min(200, Math.max(0, targetReps || 0)),
      holdSeconds: Math.min(600, Math.max(0, holdSeconds || 0)),
      durationSeconds: Math.min(1800, Math.max(0, durationSeconds || 0))
    };
  }

  // Anti-cheat rep counter (ported from the reference rep/phase engine).
  // A rep counts ONLY after a full clean cycle top→descending→bottom→ascending→top,
  // and is REJECTED (not counted) when it fails any honesty gate:
  //   • partial_rom  — range of motion below floor (shallow/fake rep)
  //   • debounce     — <400ms since last rep (bounced/jittered double-count)
  //   • no_movement  — the frame-diff engine saw no real body movement (static photo)
  // Hysteresis on the phase thresholds kills jitter flicker so noise can't inflate
  // the count. Rejections are tallied so validate-proof weighs honest evidence.
  var REP_HYSTERESIS = 5;      // deg — absorbs MoveNet jitter near a threshold
  var REP_DEBOUNCE_MS = 400;   // min gap between counted reps
  function makePhaseCounter(metric, downEnter, upEnter, minRom) {
    var MIN_ROM = minRom || 40;
    var current = 'setup', ema = null, reps = 0, rejected = 0;
    var minA = 180, maxA = 0, lastRep = 0, lastAngleT = 0, seq = [], reasons = [];
    function pushSeq(p) { if (seq[seq.length - 1] !== p) { seq.push(p); if (seq.length > 10) seq.shift(); } }
    function resetRom() { minA = 180; maxA = 0; }
    function reject(reason, rom) {
      rejected++; reasons.push(reason); if (reasons.length > 20) reasons.shift(); resetRom();
      return { reps: reps, phase: current, tracked: true, rejected: reason, rom: rom };
    }
    return {
      rejectedCount: function () { return rejected; },
      rejections: function () { return reasons.slice(); },
      update: function (pose, now, moving) {
        now = now || Date.now();
        var raw = metric(pose);
        if (raw == null) {
          if (lastAngleT && now - lastAngleT > 1000) resetRom(); // stale ROM across a tracking gap
          return { reps: reps, phase: current, tracked: false };
        }
        ema = ema == null ? raw : ema * 0.6 + raw * 0.4;
        var a = ema;
        if (lastAngleT && now - lastAngleT > 1000) resetRom();
        lastAngleT = now;
        if (a < minA) minA = a;
        if (a > maxA) maxA = a;
        var topEnter = upEnter, topExit = upEnter - REP_HYSTERESIS;
        var botEnter = downEnter, botExit = downEnter + REP_HYSTERESIS;
        var np;
        if (current === 'top')            np = (a < topExit) ? 'descending' : 'top';
        else if (current === 'bottom')    np = (a >= botExit) ? 'ascending' : 'bottom';
        else if (current === 'descending')np = (a < botEnter) ? 'bottom' : (a >= topEnter ? 'top' : 'descending');
        else if (current === 'ascending') np = (a >= topEnter) ? 'top' : (a < botEnter ? 'bottom' : 'ascending');
        else                              np = (a >= topEnter) ? 'top' : (a < botEnter ? 'bottom' : 'descending');
        current = np; pushSeq(np);
        if (np === 'top' && seq.length >= 3) {
          var hasD = false, hasB = false, hasA = false, hasT = false;
          for (var i = Math.max(0, seq.length - 5); i < seq.length; i++) {
            var p = seq[i];
            if (p === 'descending') hasD = true; else if (p === 'bottom') hasB = true;
            else if (p === 'ascending') hasA = true; else if (p === 'top') hasT = true;
          }
          if (hasD && hasB && hasA && hasT) {
            var rom = maxA - minA;
            if (rom < MIN_ROM)               return reject('partial_rom', rom);
            if (lastRep && now - lastRep < REP_DEBOUNCE_MS) return reject('debounce', rom);
            if (moving === false && rom < 40) return reject('no_movement', rom);
            reps++; lastRep = now; resetRom(); seq = [];
            return { reps: reps, phase: current, tracked: true, repCompleted: true, rom: rom };
          }
        }
        return { reps: reps, phase: current, tracked: true };
      }
    };
  }

  // Generic pose rep counter — for rhythmic drills without a bespoke joint-angle
  // verifier (burpees, high knees, mountain climbers, curls-without-clear-side,
  // jump rope, unknown physical work). Counts scale-invariant VERTICAL oscillation
  // of the lower body (knees, else whole-body) normalized by torso length, with
  // adaptive thresholds + the same debounce/no_movement honesty gates as the angle
  // counter, and the same public interface so getCoachSummary stays uniform.
  function makeOscCounter() {
    var ema = null, reps = 0, rejected = 0, reasons = [];
    var lo = Infinity, hi = -Infinity, phase = 'setup', armed = false, lastRep = 0, lastT = 0;
    function note(r) { rejected++; reasons.push(r); if (reasons.length > 20) reasons.shift(); }
    function signal(pose) {
      var ls = kp(pose, 'left_shoulder'), rs = kp(pose, 'right_shoulder');
      var lh = kp(pose, 'left_hip'), rh = kp(pose, 'right_hip');
      if (!lh && !rh) return null;
      var hipY = (lh && rh) ? (lh.y + rh.y) / 2 : (lh || rh).y;
      var shY  = (ls && rs) ? (ls.y + rs.y) / 2 : (ls ? ls.y : (rs ? rs.y : null));
      var torso = (shY != null) ? Math.abs(hipY - shY) : null;
      if (!torso || torso < 1) return null;
      var lk = kp(pose, 'left_knee'), rk = kp(pose, 'right_knee');
      if (lk || rk) { var kneeY = (lk && rk) ? (lk.y + rk.y) / 2 : (lk || rk).y; return (kneeY - hipY) / torso; }
      return hipY / torso;   // whole-body vertical fallback (jumps/hops)
    }
    return {
      rejectedCount: function () { return rejected; },
      rejections: function () { return reasons.slice(); },
      update: function (pose, now, moving) {
        now = now || Date.now();
        var raw = signal(pose);
        if (raw == null) return { reps: reps, phase: phase, tracked: false };
        ema = (ema == null) ? raw : ema * 0.6 + raw * 0.4;
        var v = ema;
        if (lastT && now - lastT > 1500) { lo = Infinity; hi = -Infinity; } // reset range across a gap
        lastT = now;
        lo = Math.min(lo, v); hi = Math.max(hi, v);
        var amp = hi - lo;
        if (amp < 0.06) return { reps: reps, phase: phase, tracked: true }; // too little travel to judge
        var loZone = lo + amp * 0.30, hiZone = hi - amp * 0.30, np = phase;
        if (v <= loZone) np = 'lo';
        else if (v >= hiZone) np = 'hi';
        if (np === 'lo') armed = true;
        else if (np === 'hi' && armed) {
          armed = false;
          if (moving === false) note('no_movement');
          else if (lastRep && now - lastRep < REP_DEBOUNCE_MS) note('debounce');
          else { reps++; lastRep = now; }
        }
        phase = np;
        return { reps: reps, phase: phase, tracked: true };
      }
    };
  }

  function makeVerifier(kind) {
    if (kind === 'squat' || kind === 'lunge') {
      var kneeDown = kind === 'squat' ? 105 : 110;
      // full-depth squat/lunge: bottom < kneeDown, top > 155, ROM floor 45°
      return { mode: 'reps', counter: makePhaseCounter(function (pose) {
        return sideAngle(pose, ['hip', 'knee', 'ankle']);
      }, kneeDown, 155, 45) };
    }
    if (kind === 'pushup') {
      return { mode: 'reps', counter: makePhaseCounter(function (pose) {
        // require torso in frame so a face-only crop can't count "reps"
        if (!kp(pose, 'left_hip') && !kp(pose, 'right_hip')) return null;
        return sideAngle(pose, ['shoulder', 'elbow', 'wrist']);
      }, 95, 150, 45) };
    }
    if (kind === 'pullup') {
      // elbow flex↔extend; a rep is a full swing between hang and chin-up
      return { mode: 'reps', counter: makePhaseCounter(function (pose) {
        return sideAngle(pose, ['shoulder', 'elbow', 'wrist']);
      }, 70, 150, 55) };
    }
    if (kind === 'bicep_curl' || kind === 'shoulder_press') {
      return { mode: 'reps', counter: makePhaseCounter(function (pose) {
        return sideAngle(pose, ['shoulder', 'elbow', 'wrist']);
      }, 65, 150, 50) };
    }
    if (kind === 'situp' || kind === 'crunch') {
      return { mode: 'reps', counter: makePhaseCounter(function (pose) {
        return sideAngle(pose, ['shoulder', 'hip', 'knee']);
      }, 75, 125, 35) };
    }
    if (kind === 'glute_bridge') {
      // hip EXTENSION: small angle at the bottom, near-straight (≈165°) at the top
      return { mode: 'reps', counter: makePhaseCounter(function (pose) {
        return sideAngle(pose, ['shoulder', 'hip', 'knee']);
      }, 125, 165, 28) };
    }
    if (kind === 'jumping_jack') {
      // open = wrists above nose AND ankles wider than 1.5× shoulders; rep on close→open→close.
      // Debounce + rejection tally mirror the angle counter so the summary is uniform.
      var phase = 'closed', reps = 0, jjRejected = 0, jjReasons = [], jjLastRep = 0;
      return { mode: 'reps', counter: {
        rejectedCount: function () { return jjRejected; },
        rejections: function () { return jjReasons.slice(); },
        update: function (pose, now) {
        now = now || Date.now();
        var nose = kp(pose, 'nose'), lw = kp(pose, 'left_wrist'), rw = kp(pose, 'right_wrist');
        var ls = kp(pose, 'left_shoulder'), rs = kp(pose, 'right_shoulder');
        var la = kp(pose, 'left_ankle'), ra = kp(pose, 'right_ankle');
        if (!nose || !lw || !rw || !ls || !rs || !la || !ra) return { reps: reps, phase: phase, tracked: false };
        var shoulderW = Math.abs(ls.x - rs.x) || 1;
        var ankleW = Math.abs(la.x - ra.x);
        var armsUp = lw.y < nose.y && rw.y < nose.y;
        var open = armsUp && ankleW > shoulderW * 1.5;
        var closed = !armsUp && lw.y > ls.y && rw.y > rs.y && ankleW < shoulderW * 1.15;
        if (phase === 'closed' && open) phase = 'open';
        else if (phase === 'open' && closed) {
          phase = 'closed';
          if (jjLastRep && now - jjLastRep < REP_DEBOUNCE_MS) { jjRejected++; jjReasons.push('debounce'); if (jjReasons.length > 20) jjReasons.shift(); }
          else { reps++; jjLastRep = now; }
        }
        return { reps: reps, phase: phase, tracked: true };
      } } };
    }
    if (kind === 'plank') {
      // hold verifier: shoulders–hips–ankles roughly collinear and torso near-horizontal
      return { mode: 'hold', check: function (pose) {
        var sh = kp(pose, 'left_shoulder') || kp(pose, 'right_shoulder');
        var hip = kp(pose, 'left_hip') || kp(pose, 'right_hip');
        var ank = kp(pose, 'left_ankle') || kp(pose, 'right_ankle');
        if (!sh || !hip || !ank) return false;
        var lineAngle = jointAngle(sh, hip, ank);           // straight body ≈ 180°
        var dx = Math.abs(sh.x - ank.x), dy = Math.abs(sh.y - ank.y);
        var horizontal = dx > dy * 1.2;                     // body closer to horizontal than vertical
        return lineAngle != null && lineAngle > 150 && horizontal;
      } };
    }
    if (kind === 'wall_sit') {
      // hold verifier: knees bent ≈90° with the torso upright against a wall
      return { mode: 'hold', check: function (pose) {
        var knee = sideAngle(pose, ['hip', 'knee', 'ankle']);
        var sh = kp(pose, 'left_shoulder') || kp(pose, 'right_shoulder');
        var hip = kp(pose, 'left_hip') || kp(pose, 'right_hip');
        if (knee == null || !sh || !hip) return false;
        var upright = Math.abs(sh.y - hip.y) > Math.abs(sh.x - hip.x); // torso more vertical than horizontal
        return knee > 55 && knee < 125 && upright;
      } };
    }
    // any other physical drill → generic vertical-oscillation rep counter (still
    // pose-verified, not just motion) so EVERY live task gets honest reps.
    return { mode: 'reps', counter: makeOscCounter(), generic: true };
  }

  /* ==========================================================================
     SESSION CONTROLLER
     ========================================================================== */
  function create(opts) {
    opts = opts || {};
    var video    = opts.video;
    var task     = opts.task || {};
    var onUpdate = typeof opts.onUpdate === 'function' ? opts.onUpdate : function () {};
    var sb = window.VISION && window.VISION.sb;
    var sessionId = newSessionId();
    var contractResult = window.VISION && VISION.proofContract ? VISION.proofContract.normalize(task.proofContract || task.proof_contract) : { ok:false };
    var contract = contractResult.ok ? contractResult.contract : null;
    var spec      = parseLiveSpec(task);
    var contractExercises = {
      'live-pushup-v1':'pushup','live-squat-v1':'squat','live-plank-v1':'plank','live-lunge-v1':'lunge',
      'live-jumping-jack-v1':'jumping_jack','live-burpee-v1':'burpee','live-situp-v1':'situp','live-pullup-v1':'pullup',
      'live-mountain-climber-v1':'mountain_climber','live-soccer-drill-v1':'soccer_drill','live-shadowboxing-v1':'shadowboxing','live-generic-movement-v1':'generic_movement'
    };
    var exercise  = contract&&contractExercises[contract.verifier_id]?contractExercises[contract.verifier_id]:spec.exercise;
    var verifier  = null;
    var legacyIds = { pushup:'live-pushup-v1', squat:'live-squat-v1', plank:'live-plank-v1', jumping_jack:'live-jumping-jack-v1' };
    var executableContract = contract || (legacyIds[exercise] ? { verifier_id:legacyIds[exercise], target_kind:spec.holdSeconds?'hold_seconds':'reps', target_value:spec.holdSeconds||spec.targetReps||10 } : null);
    var v2Verifier = executableContract && window.VISION && VISION.liveVerifiers ? VISION.liveVerifiers.create(executableContract) : null;

    /* ── LIVE PROOF V3 (staging flag) ──────────────────────────────────────────
       When window.VISION_LIVE_V3 === true the calibrated V3 engine replaces the
       V1/V2 rep counters for THIS session: exactly ONE verifier + ONE coach,
       fed by the SAME MoveNet loop below (poseTick) — there is never a second
       pose loop or a second rep counter. Invalid/unknown contracts are refused
       BEFORE the camera-driven session begins and we fall back to V1 honestly. */
    var v3 = null, v3Blocked = null, v3EquipmentReady = false;
    if (window.VISION_LIVE_V3 === true && window.VISION && VISION.liveV3 && VISION.exerciseClassifierV3 && VISION.liveCoachV3) {
      try {
        var eqApi = window.VISION && VISION.equipmentDetectorV3;
        var eqStatus = eqApi && eqApi.status ? eqApi.status() : null;
        v3EquipmentReady = !!(eqStatus && eqStatus.available === true && eqStatus.ready === true);
        var v3TaskText = [task.title, task.proofMustShow || task.proofPrompt, task.meta || task.description].filter(Boolean).join(' ');
        // AUTHORITATIVE CONTRACT RUNTIME: once a task carries a valid, server-issued
        // Live proof contract, the browser MUST verify exactly what that contract
        // says — it must not re-derive the exercise from the title/prose. The
        // title classifier is only used before a contract exists (custom tasks,
        // legacy rows). This is what stops a plank contract from being verified as
        // the wrong movement because the wording was ambiguous.
        var contractV3Id = (contract && contract.proof_type === 'live') ? contractExercises[contract.verifier_id] : null;
        var contractExecutable = !!(contractV3Id && VISION.liveV3.isProductionEnabled && VISION.liveV3.isProductionEnabled(contractV3Id));
        var v3Cls = contractExecutable
          ? { outcome: 'exact', exerciseId: contractV3Id, source: 'proof_contract', confidence: 1 }
          : (contract && contract.proof_type === 'live')
            // Contract names a verifier this runtime cannot execute in production.
            // Fall back honestly — never silently reclassify to a different exercise.
            ? { outcome: 'unsupported', reason: 'contract_verifier_unavailable' }
            : VISION.exerciseClassifierV3.classify(v3TaskText, {
                equipmentVerificationEnabled: v3EquipmentReady,
                // strict production semantics unless the preview-only staging chain
                // is explicitly active (never true on production hosts)
                forProduction: window.VISION_LIVE_V3_STAGING_CHAIN !== true
              });
        if (v3Cls && v3Cls.reason === 'equipment_model_unavailable') {
          v3Blocked = {
            reason: 'equipment_verification_unavailable',
            message: 'Automatic dumbbell verification is not ready for this task. Use photo proof showing the dumbbells and completed set details.'
          };
        } else if ((v3Cls.outcome === 'exact' || v3Cls.outcome === 'generic') && v3Cls.exerciseId) {
          var v3Check = VISION.liveV3.validateContract(v3Cls.exerciseId);
          if (v3Check.ok) {
            var requiresEquipment = !!(v3Check.spec.requiredEquipment && v3Check.spec.requiredEquipment.length);
            if (requiresEquipment && !v3EquipmentReady) {
              v3Blocked = {
                reason: 'equipment_verification_unavailable',
                message: 'Automatic dumbbell verification is not ready for this task. Use photo proof showing the dumbbells and completed set details.'
              };
            } else {
              v3 = {
                classification: v3Cls, spec: v3Check.spec,
                verifier: VISION.liveV3.create(v3Cls.exerciseId),
                coach: VISION.liveCoachV3.create(),
                stage: 'setup', stageSince: 0, setupOkSince: 0, setupBadSince: 0, countdownUntil: 0,
                checklist: [], calibrationStuck: false, last: null, lastPhase: '',
                objects: [], lastObjectsAt: 0, objMs: 0, eqBusy: false,
                diag: { landmarks: [], phases: [], reps: [], rejections: [], tracking: [],
                        poseMs: [], startedAt: 0, lastLandmarkAt: 0, lastTrackingOk: null }
              };
            }
          }
        }
      } catch (e) {
        v3Blocked = { reason: 'v3_initialization_failed', message: 'Live Proof could not start safely. Retry or use another proof type.' };
        v3 = null;
      }
    } else if (window.VISION_LIVE_V3 === true) {
      // V3 is the mandated engine but its modules did not load — fail closed.
      // The legacy motion path must never carry a session.
      v3Blocked = { reason: 'v3_modules_unavailable',
        message: 'Live verification could not load. Nothing was accepted — reload and retry, or use another proof type.' };
    }
    if (window.VISION_LIVE_V3 === true && !v3 && !v3Blocked) {
      // Classifier could not resolve this task to a validated verifier. Live
      // Proof cannot honestly verify it — route the user to a fallback proof
      // instead of silently degrading to motion/legacy counting.
      v3Blocked = { reason: 'live_verification_unavailable',
        message: 'This task can’t be verified live yet. Use photo proof instead.' };
    }
    if (v3 || v3Blocked) v2Verifier = null; // V3 owns the decision; never fall back to a weaker counter
    // per-task targets that drive the finish gate (0 = not applicable)
    var TARGET_REPS    = contract && contract.target_kind === 'reps' ? contract.target_value : (spec.targetReps || 0);
    var HOLD_TARGET_MS = contract && contract.target_kind === 'hold_seconds' ? contract.target_value * 1000 : (spec.holdSeconds ? spec.holdSeconds * 1000 : 0);
    var DUR_TARGET_MS  = contract && contract.target_kind === 'duration_seconds' ? contract.target_value * 1000 : (spec.durationSeconds ? spec.durationSeconds * 1000 : 0);

    var state = {
      totalFrames: 0, goodFrames: 0, offFrames: 0, adjustFrames: 0,
      reps: 0, startedAt: 0, elapsedMs: 0,
      motion: 0, activeMs: 0, motionActive: false,
      canStop: true, canFinish: false, canSubmitForReview: false, evidenceSufficient: false,
      targetReached: false, evidenceState: 'tracking_unavailable', selectedSide: 'none',
      lastStatus: 'idle', lastCue: '',
      // pose-layer state (new)
      exercise: exercise, poseReady: false, poseTracking: false,
      clientCountedReps: 0, clientRejectedReps: 0, clientClaimedHoldMs: 0, holdMs: 0, phase: 'up',
      clientClaimedDurationMs: 0,
      poseFrames: 0, poseVisibleFrames: 0,
      visibilityState: 'no_person', visibilityCue: 'Step into frame', trackingConfidence: 0,
      lightingConfidence: 1, frameStability: 1, fullBodyVisible: false, recoveredAt: 0,
      // per-task targets + engine status (drives the HUD)
      targetReps: TARGET_REPS, holdTargetMs: HOLD_TARGET_MS, durationTargetMs: DUR_TARGET_MS,
      engineStatus: 'loading',  // 'loading' | 'pose' | 'motion'
      // which verifier owns this session — exactly one, never two counters
      activeEngine: v3Blocked ? 'blocked' : (v3 ? 'v3' : (v2Verifier ? 'v2' : 'v1'))
    };
    var cues = [], bestFrame = null;
    var running = false, timer = null, inFlight = false, lastSend = 0, lastTick = 0, lastStill = 0;
    var detector = null, poseBusy = false, lastPose = 0, motionReps = 0, poseErrors = 0;

    // grab a fresh full-quality still from the live video (the proof for live tasks)
    function grabStill() { var s = grabFrame(video, 900, 0.85); if (s) bestFrame = s; return bestFrame; }

    // motion-detection scratch
    var mcv = document.createElement('canvas'); mcv.width = 96; mcv.height = 72;
    var mctx = mcv.getContext('2d', { willReadFrequently: true });
    var prevData = null, repArmed = false;

    // downscaled inference canvas — pose runs on THIS (≤256px, ≤192px on phones),
    // NEVER the full-res <video>, so the WebGL backend can't OOM-crash the tab.
    var pcv = document.createElement('canvas'); pcv.width = POSE_CANVAS_MAX; pcv.height = POSE_CANVAS_MAX;
    var pctx = pcv.getContext('2d');
    function poseInput() {
      var vw = video && video.videoWidth, vh = video && video.videoHeight;
      if (!vw || !vh) return null;
      var scale = Math.min(1, POSE_CANVAS_MAX / Math.max(vw, vh));
      var w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
      if (pcv.width !== w) pcv.width = w;
      if (pcv.height !== h) pcv.height = h;
      try { pctx.drawImage(video, 0, 0, w, h); return pcv; } catch (e) { return null; }
    }

    // Stopping is always available in the UI; evidence sufficiency is separate.
    // Elapsed time never becomes verification evidence.
    function recomputeGate() {
      // V3 is fail-closed. Its result is the only fact that can unlock Finish.
      // Frame differencing, elapsed time, cloud goodFrames and legacy motion reps
      // are never accepted as substitutes for exercise-specific verification.
      if (v3Blocked) {
        state.targetReached = false;
        state.evidenceSufficient = false;
        state.canSubmitForReview = false;
        state.canFinish = false;
        state.evidenceState = v3Blocked.reason;
        state.lastCue = v3Blocked.message;
        return;
      }
      if (v3) {
        var v3Result = v3.last || {};
        var v3Ok = false;
        if (v3.verifier.mode === 'hold') {
          v3Ok = HOLD_TARGET_MS > 0 && (v3Result.holdMs || 0) >= HOLD_TARGET_MS;
        } else if (v3.verifier.mode === 'duration') {
          v3Ok = DUR_TARGET_MS > 0 && (v3Result.validDurationMs || 0) >= DUR_TARGET_MS;
        } else {
          v3Ok = TARGET_REPS > 0 && (v3Result.reps || 0) >= TARGET_REPS;
        }
        if (v3.spec.requiredEquipment && v3.spec.requiredEquipment.length) {
          v3Ok = v3Ok && v3EquipmentReady && v3Result.weightVerified === true &&
                 v3Result.equipmentAssociated === true;
        }
        v3Ok = v3Ok && v3.stage === 'counting' && v3Result.personVisible === true &&
               v3Result.state !== 'need_setup' && v3Result.state !== 'tracking_unstable';
        state.targetReached = v3Ok;
        state.evidenceSufficient = v3Ok;
        state.canSubmitForReview = v3Ok;
        state.canFinish = v3Ok;
        state.evidenceState = v3Ok ? 'client_claim_complete_unverified' : 'v3_target_not_verified';
        return;
      }

      var mode = v2Verifier && HOLD_TARGET_MS > 0 ? 'hold' : (verifier ? verifier.mode : 'reps'), ok = false;
      if (mode === 'hold') {
        var holdTarget = HOLD_TARGET_MS || MIN_ACTIVE_MS;
        ok = state.holdMs >= holdTarget;
      } else if (DUR_TARGET_MS) {
        ok = state.clientClaimedDurationMs >= DUR_TARGET_MS;
      } else if (TARGET_REPS) {
        ok = state.clientCountedReps >= TARGET_REPS;
      } else {
        ok = (state.goodFrames >= MIN_GOOD_FRAMES && state.elapsedMs >= MIN_SECONDS * 1000) ||
             state.activeMs >= MIN_ACTIVE_MS ||
             state.reps >= MIN_REPS ||
             state.clientCountedReps >= MIN_REPS ||
             state.holdMs >= MIN_ACTIVE_MS;
      }
      state.targetReached = ok;
      state.evidenceSufficient = ok;
      state.canSubmitForReview = ok || state.clientCountedReps > 0 || state.holdMs > 0 || state.activeMs >= MIN_ACTIVE_MS;
      state.canFinish = state.canSubmitForReview;
      state.evidenceState = ok ? 'client_claim_complete_unverified' : state.poseTracking ? (state.canSubmitForReview ? 'client_claim_partial' : 'stopped_before_target') : 'tracking_failed';
    }
    function pushCue(c) { if (c && cues.indexOf(c) === -1) { cues.push(c); if (cues.length > 6) cues.shift(); } }

    // ── instant on-device motion (frame differencing) ──────────────────────────
    function sampleMotion(dtMs) {
      var vw = video && video.videoWidth, vh = video && video.videoHeight;
      if (!vw || !vh) return;
      var cur;
      try { mctx.drawImage(video, 0, 0, mcv.width, mcv.height); cur = mctx.getImageData(0, 0, mcv.width, mcv.height).data; }
      catch (e) { return; } // not ready / cross-origin — skip this frame
      if (prevData) {
        var sum = 0, n = cur.length, px = n / 4;
        for (var i = 0; i < n; i += 4) {
          sum += Math.abs(cur[i] - prevData[i]) + Math.abs(cur[i + 1] - prevData[i + 1]) + Math.abs(cur[i + 2] - prevData[i + 2]);
        }
        var raw = sum / (px * 3 * 255);                 // 0..1 mean abs diff
        var luminance=0;for(var li=0;li<n;li+=4)luminance+=(cur[li]+cur[li+1]+cur[li+2])/(3*255);state.lightingConfidence=luminance/px;
        var m = Math.min(1, raw * MOTION_SCALE);
        state.motion = state.motion * 0.55 + m * 0.45;  // EMA smooth
        // Under V3 frame differencing is a diagnostic (lighting / camera-shake)
        // only — raw scene motion never banks active time or reps.
        if (!v3 && !v3Blocked) {
          if (state.motion > MOTION_ACTIVE) state.activeMs += dtMs;
          // rep = a motion burst (arm high, count on the way down)
          if (!repArmed && state.motion > REP_HI) repArmed = true;
          else if (repArmed && state.motion < REP_LO) { repArmed = false; motionReps++; }
        }
      }
      prevData = cur.slice ? cur.slice() : new Uint8ClampedArray(cur);
    }

    // ── V3 stage machine + diagnostics (Phase 5) ───────────────────────────────
    function v3Now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
    // Real pose tracking on a moving subject is inherently noisy: a single
    // frame where the checklist isn't all-green (one required keypoint's
    // confidence briefly dips under a real camera) must not discard the
    // whole 1200ms stability window, or a session can flicker forever and
    // never accumulate an unbroken stretch — exactly as CORE_LOSS_MS already
    // grants tracking-loss recovery a short grace instead of resetting on
    // the very first bad frame (js/vision-live-verifiers-v3.js). Proven via
    // scripts/qa-live-proof-core-pushup-setup-jitter-repro.mjs: a checklist
    // that flickers ok/not-ok roughly every other frame (never fully lost)
    // left v3.stage stuck in 'setup' indefinitely under the old hard-reset.
    var SETUP_NOISE_GRACE_MS = 400;
    function v3StageTick(now, pose) {
      if (v3.stage === 'setup') {
        v3.checklist = VISION.liveV3.setupChecklist(v3.spec.exerciseId, pose || null);
        v3.checklist.push({ key: 'lighting', label: 'Enough lighting', ok: state.lightingConfidence >= 0.18 });
        var allOk = v3.checklist.every(function (i) { return i.ok; });
        if (allOk) {
          v3.setupBadSince = 0;
          if (!v3.setupOkSince) v3.setupOkSince = now;
        } else {
          if (!v3.setupBadSince) v3.setupBadSince = now;
          // only discard the accumulated stable window once the checklist has
          // been unstable longer than a brief single-frame tracking blip
          if (now - v3.setupBadSince >= SETUP_NOISE_GRACE_MS) v3.setupOkSince = 0;
        }
        // setup must stay valid (allowing brief noise above) for a stable
        // period before we ever advance
        if (allOk && v3.setupOkSince && now - v3.setupOkSince >= 1200) {
          v3.stage = v3.verifier.mode === 'reps' ? 'practice' : 'countdown';
          v3.stageSince = now;
          if (v3.stage === 'countdown') v3.countdownUntil = now + 3000;
        }
      } else if (v3.stage === 'countdown' && now >= v3.countdownUntil) {
        v3.stage = 'counting'; v3.stageSince = now;
        if (!v3.diag.startedAt) v3.diag.startedAt = now;
      } else if (v3.stage === 'practice' && !v3.calibrationStuck && now - v3.stageSince > 45000) {
        v3.calibrationStuck = true; // UI explains + offers restart / camera advice / fallback
      }
    }
    function v3Record(res, now, poseMs) {
      var d = v3.diag;
      function push(a, x, cap) { a.push(x); if (a.length > (cap || 300)) a.shift(); }
      if (poseMs != null) push(d.poseMs, Math.round(poseMs), 240);
      if (res.phase !== v3.lastPhase) { push(d.phases, { t: Math.round(now), phase: res.phase }); v3.lastPhase = res.phase; }
      if (res.repCompleted) push(d.reps, { t: Math.round(now), rep: res.reps, rom: res.romMax != null ? Math.round(res.romMax - res.romMin) : null });
      if (res.rejectionReason) push(d.rejections, { t: Math.round(now), reason: res.rejectionReason, measurements: res.rejectionMeasurements || null });
      var trackingOk = !!res.personVisible && res.state !== 'need_setup';
      if (trackingOk !== d.lastTrackingOk) { push(d.tracking, { t: Math.round(now), ok: trackingOk }); d.lastTrackingOk = trackingOk; }
      if (now - d.lastLandmarkAt >= 1000) {
        d.lastLandmarkAt = now;
        push(d.landmarks, { t: Math.round(now), view: res.cameraView, side: res.selectedSide,
          vis: Math.round((res.requiredLandmarksVisible || 0) * 100) / 100,
          angle: res.jointAngle, phase: res.phase, calibrated: !!res.calibrated }, 240);
      }
    }
    // equipment detection runs as a SEPARATE, SLOWER loop (≥700ms) than MoveNet;
    // with no licensed model configured status().available is false → no-op.
    function v3EquipmentTick(now) {
      if (!v3.spec.requiredEquipment || !v3.spec.requiredEquipment.length) return;
      var eq = window.VISION && VISION.equipmentDetectorV3;
      if (!eq || v3.eqBusy || now - v3.lastObjectsAt < 700) return;
      if (!eq.status().available) { v3.objects = []; return; }
      v3.eqBusy = true;
      var t0 = v3Now();
      Promise.resolve(eq.detect(pcv, now)).then(function (objs) {
        v3.objects = objs || []; v3.objMs = v3Now() - t0; v3.lastObjectsAt = now;
      }).catch(function () {}).finally(function () { v3.eqBusy = false; });
    }
    function v3Snapshot() {
      var eq = window.VISION && VISION.equipmentDetectorV3;
      return {
        stage: v3.stage, checklist: v3.checklist, calibrationStuck: v3.calibrationStuck,
        countdownRemaining: v3.stage === 'countdown' ? Math.max(0, Math.ceil((v3.countdownUntil - v3Now()) / 1000)) : 0,
        displayName: v3.spec.displayName, exerciseId: v3.spec.exerciseId,
        verifierId: v3.spec.verifierId, verifierVersion: v3.spec.verifierVersion,
        mode: v3.verifier.mode, equipmentRequired: !!(v3.spec.requiredEquipment && v3.spec.requiredEquipment.length),
        equipmentModel: eq ? eq.status() : { available: false, reason: 'module_missing' },
        result: v3.last, objMs: Math.round(v3.objMs)
      };
    }

    // ── pose verifier tick (~5fps, async, reentry-guarded) ────────────────────
    async function poseTick(dtMs) {
      if (!detector || poseBusy || !video || !video.videoWidth) return;
      var input = poseInput();
      if (!input) return;
      poseBusy = true;
      try {
        var poseT0 = v3Now();
        var poses = await detector.estimatePoses(input, { maxPoses: 1 });
        var poseMs = v3Now() - poseT0;
        state.poseMs = poseMs;
        poseErrors = 0;
        var pose = poses && poses[0];
        state.poseFrames++;
        var vis = pose ? coreVisibility(pose) : 0;
        var va=visibilityAssessment(pose,pcv.width,pcv.height,state.lightingConfidence),was=state.visibilityState;
        state.visibilityState=va.state;state.visibilityCue=va.cue;state.trackingConfidence=va.confidence;state.fullBodyVisible=va.fullBody;
        if(va.state==='ready'&&was!=='ready')state.recoveredAt=Date.now();
        var visible = vis >= 0.4;
        if (visible) state.poseVisibleFrames++;
        state.poseTracking = visible;
        if (v3) {
          // ── V3 path: the real MoveNet result feeds the ONE V3 verifier ──
          var nowMs = v3Now();
          v3StageTick(nowMs, pose || null);
          v3EquipmentTick(nowMs);
          if (v3.stage === 'practice' || v3.stage === 'counting') {
            var vres = v3.verifier.update({
              timestamp: nowMs, pose: pose || null, objects: v3.objects,
              frameMetadata: { width: pcv.width, height: pcv.height }
            });
            v3.last = vres;
            v3Record(vres, nowMs, poseMs);
            var obs = v3.coach.observe(vres, nowMs);
            if (obs && obs.cue) state.lastCue = obs.cue;
            // practice calibration locked → explicit countdown before counting.
            // (RepMachine counts nothing until calibrated, so the practice rep
            // can never increment the real count; the countdown gap drops any
            // partial candidate via the verifier's frame-gap guard.)
            if (v3.stage === 'practice' && vres.calibrated) {
              v3.stage = 'countdown'; v3.stageSince = nowMs;
              v3.countdownUntil = nowMs + 3000; v3.calibrationStuck = false;
            }
            state.clientCountedReps = vres.reps || 0;
            state.clientRejectedReps = vres.rejectedReps || 0;
            state.clientClaimedHoldMs = vres.holdMs || 0; state.holdMs = vres.holdMs || 0;
            state.clientClaimedDurationMs = vres.validDurationMs || 0;
            state.phase = vres.phase; state.selectedSide = vres.selectedSide;
            state.poseTracking = !!vres.personVisible && vres.state !== 'need_setup';
          } else {
            // setup / countdown: frames are deliberately NOT fed to the verifier —
            // nothing can count before the counted session begins
            state.poseTracking = visible;
          }
          state.v3 = v3Snapshot();
        } else if (v2Verifier) {
          var vr = v2Verifier.update({ timestamp: (typeof performance !== 'undefined' ? performance.now() : Date.now()), pose: pose || null });
          state.clientCountedReps = vr.clientCountedReps; state.clientRejectedReps = vr.clientRejectedReps; state.clientClaimedHoldMs = vr.clientClaimedHoldMs; state.holdMs = vr.clientClaimedHoldMs;
          state.clientClaimedDurationMs=vr.clientClaimedDurationMs||0;
          state.phase = vr.phase; state.selectedSide = vr.selectedSide; state.poseTracking = vr.trackingStable;
          if (vr.cue) state.lastCue = vr.cue;
        } else if (verifier && pose && visible) {
          if (verifier.mode === 'reps') {
            // pass real time + whether the motion engine currently sees movement, so a
            // static photo can't bank reps and shallow/bounced reps are rejected honestly
            var r = verifier.counter.update(pose, Date.now(), state.motion > MOTION_ACTIVE);
            if (r.tracked) { state.clientCountedReps = r.reps; state.phase = r.phase; }
            if (verifier.counter.rejectedCount) state.clientRejectedReps = verifier.counter.rejectedCount();
          } else if (verifier.mode === 'hold') {
            if (verifier.check(pose)) state.holdMs += dtMs;
          }
        }
        // the verified count is the honest one — surface it as THE rep count
        if ((v3 || v2Verifier || (verifier && verifier.mode === 'reps')) && (state.poseVisibleFrames > 4 || state.clientCountedReps > 0)) {
          state.reps = state.clientCountedReps;
        } else if (verifier && verifier.mode === 'hold') {
          state.reps = 0;
        } else {
          state.reps = motionReps;
        }
      } catch (e) {
        // Legacy engines: pose is best-effort — motion engine carries the session.
        // V3: pose IS the session. Persistent inference failure fails the session
        // closed instead of silently degrading to raw motion counting.
        poseErrors++;
        if (poseErrors >= 5) {
          detector = null;
          if (v3) {
            v3Blocked = { reason: 'pose_model_unavailable',
              message: 'Live verification stopped working. Nothing was accepted — retry or use another proof type.' };
            v3 = null;
            state.engineStatus = 'failed';
            state.poseReady = false;
            state.lastCue = v3Blocked.message;
            state.evidenceState = v3Blocked.reason;
          } else {
            state.engineStatus = 'motion';
          }
        }
      } finally { poseBusy = false; }
    }

    // ── cloud coach (semantic cue, supplementary) ──────────────────────────────
    async function cloudTick() {
      if (inFlight || state.totalFrames >= MAX_FRAMES) return;
      var frame = grabFrame(video, 384, 0.4);
      if (!frame || !sb || !sb.functions) return;
      inFlight = true;
      try {
        var res = await withTimeout(sb.functions.invoke('live-coach', {
          body: { task_id: task.id, frame: frame, session_id: sessionId, frame_index: state.totalFrames }
        }), 9000);
        var data = (res && res.data) || {};
        var status = data.status || 'checking', cue = data.cue || '';
        if (status !== 'checking') {
          state.totalFrames++;
          state.lastStatus = status;
          if (cue) state.lastCue = cue;
          if (status === 'good') { state.goodFrames++; var still = grabFrame(video, 800, 0.85); if (still) bestFrame = still; }
          else if (status === 'adjust') { state.adjustFrames++; pushCue(cue); }
          else if (status === 'offtask') { state.offFrames++; if (cue) pushCue(cue); }
        }
      } catch (e) { /* fail soft — the motion engine carries the session */ }
      finally { inFlight = false; }
    }

    // ── single driving loop (instant) ──────────────────────────────────────────
    function loop() {
      if (!running) return;
      var now = Date.now();
      var dt = lastTick ? (now - lastTick) : TICK_MS; lastTick = now;
      state.elapsedMs = now - state.startedAt;
      try { sampleMotion(dt); } catch (e) {}
      if (detector && now - lastPose >= POSE_MS) { var pdt = lastPose ? (now - lastPose) : POSE_MS; lastPose = now; poseTick(pdt); }
      // pose unavailable → surface the motion engine's rough rep count so the HUD
      // and gate still have a live signal (holds don't show reps)
      if (!v3 && !v3Blocked && !detector && !v2Verifier && (!verifier || verifier.mode !== 'hold')) state.reps = motionReps;
      // keep a recent live still ready (this — not the video — is the uploaded proof)
      if (now - lastStill >= 1500) { lastStill = now; var s = grabFrame(video, 900, 0.8); if (s) bestFrame = s; }
      recomputeGate();
      try { onUpdate(state); } catch (e) {}
      // Cloud checkpoints are setup/mid/final or risk-triggered, never a 2.5s stream.
      if (state.totalFrames < 1 || (state.totalFrames < 2 && state.elapsedMs >= 15000) || (!state.poseTracking && state.elapsedMs >= 5000)) {
        if (now - lastSend >= 8000) { lastSend = now; cloudTick(); }
      }
    }

    return {
      async start() {
        if (running) return { ok: true };
        if (v3Blocked) {
          state.engineStatus = 'failed';
          state.lastStatus = 'offtask';
          state.lastCue = v3Blocked.message;
          state.evidenceState = v3Blocked.reason;
          recomputeGate();
          try { onUpdate(state); } catch (e) {}
          return { ok: false, error: v3Blocked.reason, message: v3Blocked.message };
        }
        try {
          if (sb && sb.rpc) {
            var q = await sb.rpc('consume_live_coach_quota', { p_max: 25 });
            var row = q && q.data && (Array.isArray(q.data) ? q.data[0] : q.data);
            if (row && row.allowed === false) return { ok: false, error: 'rate_limited' };
          }
        } catch (e) { /* quota is a soft guard */ }
        running = true; state.startedAt = Date.now(); state.lastStatus = 'arming';
        state.motionActive = true; lastTick = 0; lastSend = 0; lastPose = 0; prevData = null;
        // V3 never degrades to raw motion. A real pose model is mandatory before
        // the counted session can begin. Legacy engines retain their old loading path.
        state.engineStatus = 'loading';
        if (v3) {
          try { detector = await getDetector(); } catch (e) { detector = null; }
          if (!detector) {
            running = false;
            state.poseReady = false;
            state.engineStatus = 'failed';
            state.lastStatus = 'offtask';
            state.lastCue = 'Pose tracking could not load. Live Proof was not accepted — retry or use another proof type.';
            state.evidenceState = 'pose_model_unavailable';
            recomputeGate();
            try { onUpdate(state); } catch (e) {}
            return { ok: false, error: 'pose_model_unavailable' };
          }
          state.poseReady = true;
          state.engineStatus = 'pose';
        } else {
          getDetector().then(function (d) {
            if (d) { detector = d; state.poseReady = true; state.engineStatus = 'pose'; }
            else { state.engineStatus = 'motion'; }
          }).catch(function () { state.engineStatus = 'motion'; });
        }
        timer = setInterval(loop, TICK_MS);
        onUpdate(state);
        return { ok: true };
      },
      stop() {
        running = false; if (timer) { clearInterval(timer); timer = null; }
        state.elapsedMs = Date.now() - state.startedAt;
        // V3 instances are session-scoped: freeze the coach log into the diag
        // bundle and drop live references so nothing keeps observing frames.
        if (v3 && v3.coach) { try { v3.diag.coaching = v3.coach.events(); } catch (e) {} }
      },
      getState() { return state; },
      getBestFrame() { return bestFrame; },
      grabStill() { return grabStill(); },
      // ── V3 session controls (null when this session runs V1/V2) ─────────────
      isV3() { return !!v3; },
      getV3() { return v3 ? v3Snapshot() : null; },
      v3Recalibrate() {
        if (!v3) return false;
        v3.verifier.recalibrate();
        v3.stage = 'practice'; v3.stageSince = v3Now();
        v3.calibrationStuck = false; v3.countdownUntil = 0;
        return true;
      },
      // structured V3 evidence for the proof path — facts only, weight NEVER
      // claimed as machine-verified without a real equipment model
      getV3Evidence() {
        if (!v3) return null;
        var r = v3.last || {};
        var tally = {};
        (v3.diag.rejections || []).forEach(function (x) { tally[x.reason] = (tally[x.reason] || 0) + 1; });
        return {
          engine: 'live-proof-v3', exercise_id: v3.spec.exerciseId,
          verifier_id: v3.spec.verifierId, verifier_version: v3.spec.verifierVersion,
          mode: v3.verifier.mode, stage: v3.stage,
          reps: r.reps || 0, rejected_reps: r.rejectedReps || 0, rejection_tally: tally,
          hold_ms: r.holdMs || 0, valid_duration_ms: r.validDurationMs || 0,
          calibration: r.calibration || null, camera_view: r.cameraView || 'unknown',
          selected_side: r.selectedSide || 'none',
          equipment_required: !!(v3.spec.requiredEquipment && v3.spec.requiredEquipment.length),
          weight_verified: false
        };
      },
      // full diagnostics bundle for the staging export button — no tokens, no
      // account data, no raw video; landmark SUMMARIES only
      getV3Diagnostics() {
        if (!v3) return null;
        var eq = window.VISION && VISION.equipmentDetectorV3;
        return {
          exported_at_ms: Date.now(),
          contract: {
            classification: v3.classification, exercise_id: v3.spec.exerciseId,
            verifier_id: v3.spec.verifierId, verifier_version: v3.spec.verifierVersion,
            mode: v3.verifier.mode,
            target_reps: TARGET_REPS || 0, hold_target_ms: HOLD_TARGET_MS || 0, duration_target_ms: DUR_TARGET_MS || 0
          },
          engine: { name: 'live-proof-v3', pose_model: MOVENET_VERSION, model_url: MODEL_URL,
                    tfjs_version: TF_VERSION, pose_detection_version: POSE_DETECTION_VERSION,
                    backend: activeBackend, engine_status: state.engineStatus,
                    model_state: poseRuntimeStatus.state, model_failure_reason: poseRuntimeStatus.reason },
          device: { mobile: IS_MOBILE, ua_class: IS_MOBILE ? 'mobile' : 'desktop',
                    camera: { width: video && video.videoWidth || 0, height: video && video.videoHeight || 0 },
                    inference_canvas: { width: pcv.width, height: pcv.height } },
          session: { stage: v3.stage, camera_view: v3.last ? v3.last.cameraView : 'unknown',
                     selected_side: v3.last ? v3.last.selectedSide : 'none',
                     calibration: v3.last ? v3.last.calibration : null,
                     calibration_stuck: v3.calibrationStuck,
                     counted_reps: v3.last ? v3.last.reps : 0, rejected_reps: v3.last ? v3.last.rejectedReps : 0,
                     hold_ms: v3.last ? v3.last.holdMs : 0, valid_duration_ms: v3.last ? v3.last.validDurationMs : 0,
                     elapsed_ms: state.elapsedMs,
                     // setup-gate detail — the precise reason a session that never
                     // leaves 'setup' is stuck (see SETUP_NOISE_GRACE_MS above):
                     // which checklist item(s) are currently failing, whether a
                     // brief noise-grace window is active, and how much of the
                     // required 1200ms of unbroken stability has accumulated.
                     setup_checklist: v3.stage === 'setup' ? v3.checklist : null,
                     setup_failing_items: v3.stage === 'setup' ? (v3.checklist || []).filter(function (c) { return !c.ok; }).map(function (c) { return c.key; }) : [],
                     setup_stable_ms: v3.stage === 'setup' && v3.setupOkSince ? Math.max(0, Math.round(v3Now() - v3.setupOkSince)) : 0,
                     setup_noise_grace_active: v3.stage === 'setup' && !!v3.setupBadSince,
                     lighting_confidence: Math.round((state.lightingConfidence || 0) * 100) / 100 },
          timeline: { landmarks: v3.diag.landmarks, phase_transitions: v3.diag.phases,
                      rep_candidates: v3.diag.reps, rejections: v3.diag.rejections,
                      tracking: v3.diag.tracking, coaching: v3.diag.coaching || (v3.coach ? v3.coach.events() : []) },
          performance: { pose_latency_ms: v3.diag.poseMs, equipment_latency_ms: Math.round(v3.objMs),
                         pose_fps_nominal: Math.round(1000 / POSE_MS) },
          equipment: { model: eq ? eq.status() : { available: false }, last_tracks: v3.objects, weight_verified: false }
        };
      },
      // Structured evidence summary — carried in the proof note and weighed by the
      // validate-proof Edge Function (OpenAI vision) at final judgement. Facts only.
      getCoachSummary() {
        var parts = [];
        var goal = TARGET_REPS ? (' · target ' + TARGET_REPS + ' reps')
                 : HOLD_TARGET_MS ? (' · target ' + Math.round(HOLD_TARGET_MS / 1000) + 's hold')
                 : DUR_TARGET_MS ? (' · target ' + Math.round(DUR_TARGET_MS / 1000) + 's') : '';
        parts.push('Live session ' + Math.round(state.elapsedMs / 1000) + 's · exercise: ' + exercise + goal);
        if (v3 && v3.last) {
          var v3r = v3.last;
          parts.push('engine live-proof-v3 · ' + v3.spec.verifierId + ' v' + v3.spec.verifierVersion +
            ' · counted ' + (v3r.reps || 0) + (TARGET_REPS ? '/' + TARGET_REPS : '') +
            ' · rejected ' + (v3r.rejectedReps || 0) +
            (v3.spec.requiredEquipment && v3.spec.requiredEquipment.length ? ' · movement tracked, dumbbell NOT machine-verified' : ''));
        }
        if (verifier && verifier.mode === 'reps' && state.poseFrames > 0) {
          parts.push('on-device rep candidates: ' + state.clientCountedReps + (TARGET_REPS ? ' / target ' + TARGET_REPS : '') + ' (server review required)');
          if (state.clientRejectedReps > 0) {
            var rj = (verifier.counter.rejections && verifier.counter.rejections()) || [];
            var tally = {};
            rj.forEach(function (x) { tally[x] = (tally[x] || 0) + 1; });
            var breakdown = Object.keys(tally).map(function (k) { return tally[k] + '×' + k; }).join(', ');
            parts.push('on-device rejected candidates: ' + state.clientRejectedReps + (breakdown ? ' (' + breakdown + ')' : '') + ' — partial/bounced/static not counted');
          }
        }
        if (verifier && verifier.mode === 'hold' && state.holdMs > 0) {
          parts.push('verified hold: ' + Math.round(state.holdMs / 1000) + 's' + (HOLD_TARGET_MS ? ' / target ' + Math.round(HOLD_TARGET_MS / 1000) + 's' : '') + ' (body line actually held)');
        }
        if (state.poseFrames > 0) {
          parts.push('person visible ' + Math.round(100 * state.poseVisibleFrames / state.poseFrames) + '% of pose frames');
        } else {
          parts.push('pose tracking unavailable this session');
        }
        if (state.reps > 0 && (!verifier || verifier.mode !== 'reps')) parts.push('motion reps≈' + state.reps);
        parts.push('sustained movement ' + Math.round(state.activeMs / 1000) + 's');
        if(DUR_TARGET_MS)parts.push('pose-tracked valid movement '+Math.round(state.clientClaimedDurationMs/1000)+'s / target '+Math.round(DUR_TARGET_MS/1000)+'s');
        parts.push('visibility '+state.visibilityState+' · tracking confidence '+Math.round(state.trackingConfidence*100)+'%');
        if (state.totalFrames) parts.push('cloud coach ' + state.goodFrames + '/' + state.totalFrames + ' frames on-task');
        if (cues.length) parts.push('cues: ' + cues.slice(0, 2).map(function (c) { return '“' + c + '”'; }).join(', '));
        return parts.join(' · ').slice(0, 600);
      }
    };
  }

  window.VISION = window.VISION || {};
  window.VISION.liveCoach = {
    create: create, poseEligible: function () { return true; },
    preload: getDetector,
    // exposed for the anti-cheat unit test (scripts/qa-live-anticheat.mjs)
    makePhaseCounter: makePhaseCounter,
    // per-task spec + exercise detection (also used by tests)
    parseLiveSpec: parseLiveSpec, detectExercise: detectExercise,
    MIN_GOOD_FRAMES: MIN_GOOD_FRAMES, MIN_SECONDS: MIN_SECONDS,
    MIN_ACTIVE_MS: MIN_ACTIVE_MS, MIN_REPS: MIN_REPS
  };
})();
