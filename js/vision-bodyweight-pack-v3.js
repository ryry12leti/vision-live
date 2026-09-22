/* VISION Live Proof V3 — extended bodyweight engineering pack.
   Adds engineering-ready, production-gated verifier contracts for bodyweight
   variants that previously fell through to generic movement/photo. It reuses the
   proven V3 RepMachine/hold runtime and never marks physical qualification true. */
(function (root) {
  'use strict';

  var installed = false;
  var attempts = 0;

  function install() {
    if (installed) return true;
    var V = root.VISION || {};
    var live = V.liveV3;
    if (!live || !live.registry || typeof live.create !== 'function' || typeof live.angle !== 'function' || typeof live.kp !== 'function') return false;

    function kp(pose, name) { return live.kp(pose, name); }
    function angle(a, b, c) { return live.angle(a, b, c); }
    function elbowMetric(pose, side) { return angle(kp(pose, side + '_shoulder'), kp(pose, side + '_elbow'), kp(pose, side + '_wrist')); }
    function kneeMetric(pose, side) { return angle(kp(pose, side + '_hip'), kp(pose, side + '_knee'), kp(pose, side + '_ankle')); }
    function hipMetric(pose, side) { return angle(kp(pose, side + '_shoulder'), kp(pose, side + '_hip'), kp(pose, side + '_knee')); }
    function armRaiseMetric(pose, side) { return angle(kp(pose, side + '_hip'), kp(pose, side + '_shoulder'), kp(pose, side + '_wrist')); }
    function torsoScale(pose) {
      var s = kp(pose, 'left_shoulder') || kp(pose, 'right_shoulder');
      var h = kp(pose, 'left_hip') || kp(pose, 'right_hip');
      return s && h ? Math.max(1, Math.hypot(s.x - h.x, s.y - h.y)) : 1;
    }
    function calfMetric(pose, side) {
      var knee = kp(pose, side + '_knee'), ankle = kp(pose, side + '_ankle');
      return knee && ankle ? 100 * Math.hypot(knee.x - ankle.x, knee.y - ankle.y) / torsoScale(pose) : null;
    }
    function bodySpanMetric(pose) {
      var nose = kp(pose, 'nose');
      var ankle = kp(pose, 'left_ankle') || kp(pose, 'right_ankle');
      return nose && ankle ? 100 * Math.hypot(nose.x - ankle.x, nose.y - ankle.y) / torsoScale(pose) : null;
    }
    function straightBody(pose) {
      var best = 0;
      ['left', 'right'].forEach(function (side) {
        var a = angle(kp(pose, side + '_shoulder'), kp(pose, side + '_hip'), kp(pose, side + '_ankle'));
        if (a != null) best = Math.max(best, a);
      });
      return best >= 150;
    }
    function wallSitCheck(pose) {
      var best = null;
      ['left', 'right'].forEach(function (side) {
        var a = kneeMetric(pose, side);
        if (a != null && (best == null || Math.abs(a - 90) < Math.abs(best - 90))) best = a;
      });
      return best != null && best >= 65 && best <= 115;
    }
    function deadHangCheck(pose) {
      var valid = false;
      ['left', 'right'].forEach(function (side) {
        var wrist = kp(pose, side + '_wrist'), shoulder = kp(pose, side + '_shoulder');
        var elbow = elbowMetric(pose, side);
        if (wrist && shoulder && elbow != null && wrist.y < shoulder.y && elbow > 150) valid = true;
      });
      return valid;
    }
    function hollowHoldCheck(pose) {
      var shoulder = kp(pose, 'left_shoulder') || kp(pose, 'right_shoulder');
      var hip = kp(pose, 'left_hip') || kp(pose, 'right_hip');
      var ankle = kp(pose, 'left_ankle') || kp(pose, 'right_ankle');
      return !!(shoulder && hip && ankle && shoulder.y < hip.y && ankle.y < hip.y + torsoScale(pose) * 0.8);
    }

    function rep(id, name, verifierId, opts) {
      live.registry[id] = Object.assign({
        exerciseId: id,
        displayName: name,
        verifierId: verifierId,
        verifierVersion: '1',
        mode: 'reps',
        workingLandmarks: ['hip', 'knee', 'ankle'],
        metric: kneeMetric,
        minAmplitude: 40,
        minRepMs: 500,
        maxRepMs: 12000,
        minVisibility: 0.7,
        lowerBody: true,
        productionEnabled: false,
        engineeringReady: true,
        realCameraQualified: false,
        qualificationLevel: 'ENGINEERING_READY',
        requiredEquipment: [],
        formSignals: []
      }, opts || {});
    }
    function hold(id, name, verifierId, opts) {
      live.registry[id] = Object.assign({
        exerciseId: id,
        displayName: name,
        verifierId: verifierId,
        verifierVersion: '1',
        mode: 'hold',
        workingLandmarks: ['shoulder', 'hip', 'ankle'],
        holdCheck: straightBody,
        minVisibility: 0.6,
        productionEnabled: false,
        engineeringReady: true,
        realCameraQualified: false,
        qualificationLevel: 'ENGINEERING_READY',
        requiredEquipment: []
      }, opts || {});
    }

    rep('knee_pushup', 'Knee Push-up', 'v3-knee-pushup', {
      workingLandmarks: ['shoulder', 'elbow', 'wrist'], metric: elbowMetric, minAmplitude: 35, lowerBody: false
    });
    rep('incline_pushup', 'Incline Push-up', 'v3-incline-pushup', {
      workingLandmarks: ['shoulder', 'elbow', 'wrist'], metric: elbowMetric, minAmplitude: 35, lowerBody: false
    });
    rep('split_squat', 'Split Squat', 'v3-split-squat');
    rep('forward_lunge', 'Forward Lunge', 'v3-forward-lunge');
    rep('reverse_lunge', 'Reverse Lunge', 'v3-reverse-lunge');
    rep('lateral_lunge', 'Lateral Lunge', 'v3-lateral-lunge');
    rep('crunch', 'Crunch', 'v3-crunch', {
      workingLandmarks: ['shoulder', 'hip', 'knee'], metric: hipMetric, minAmplitude: 28, minRepMs: 450, lowerBody: false
    });
    rep('bicycle_crunch', 'Bicycle Crunch', 'v3-bicycle-crunch', {
      workingLandmarks: ['shoulder', 'hip', 'knee'], metric: hipMetric, minAmplitude: 30, minRepMs: 450, lowerBody: false, bilateral: true
    });
    rep('glute_bridge', 'Glute Bridge', 'v3-glute-bridge', {
      workingLandmarks: ['shoulder', 'hip', 'knee'], metric: hipMetric, minAmplitude: 25, minRepMs: 550, lowerBody: false
    });
    rep('hip_thrust', 'Hip Thrust', 'v3-hip-thrust', {
      workingLandmarks: ['shoulder', 'hip', 'knee'], metric: hipMetric, minAmplitude: 25, minRepMs: 550, lowerBody: false
    });
    rep('calf_raise', 'Calf Raise', 'v3-calf-raise', {
      workingLandmarks: ['hip', 'knee', 'ankle'], metric: calfMetric, minAmplitude: 7, minRepMs: 400
    });
    rep('jumping_jack', 'Jumping Jack', 'v3-jumping-jack', {
      workingLandmarks: ['hip', 'shoulder', 'wrist'], metric: armRaiseMetric, minAmplitude: 75, minRepMs: 500, lowerBody: true, bilateral: true
    });
    rep('mountain_climber', 'Mountain Climber', 'v3-mountain-climber', {
      workingLandmarks: ['hip', 'knee', 'ankle'], metric: kneeMetric, minAmplitude: 40, minRepMs: 350, bilateral: true
    });
    rep('high_knees', 'High Knees', 'v3-high-knees', {
      workingLandmarks: ['shoulder', 'hip', 'knee'], metric: hipMetric, minAmplitude: 35, minRepMs: 300, bilateral: true
    });
    rep('burpee', 'Burpee', 'v3-burpee', {
      workingLandmarks: ['shoulder', 'hip', 'ankle'], metric: function (pose) { return bodySpanMetric(pose); }, minAmplitude: 45, minRepMs: 1000, maxRepMs: 20000
    });
    rep('step_up', 'Step-up', 'v3-step-up', {
      workingLandmarks: ['hip', 'knee', 'ankle'], metric: kneeMetric, minAmplitude: 35, minRepMs: 500, bilateral: true, requiredEquipment: ['box_or_step']
    });

    hold('forearm_plank', 'Forearm Plank', 'v3-forearm-plank');
    hold('high_plank', 'High Plank', 'v3-high-plank');
    hold('side_plank', 'Side Plank', 'v3-side-plank');
    hold('wall_sit', 'Wall Sit', 'v3-wall-sit', {
      workingLandmarks: ['hip', 'knee', 'ankle'], holdCheck: wallSitCheck, lowerBody: true, holdCue: 'Keep your back supported and knees near a right angle'
    });
    hold('dead_hang', 'Dead Hang', 'v3-dead-hang', {
      workingLandmarks: ['shoulder', 'elbow', 'wrist'], holdCheck: deadHangCheck, requiredEquipment: ['pull_up_bar'], holdCue: 'Keep both arms long and the bar in the setup view'
    });
    hold('hollow_hold', 'Hollow Hold', 'v3-hollow-hold', {
      workingLandmarks: ['shoulder', 'hip', 'ankle'], holdCheck: hollowHoldCheck, holdCue: 'Keep shoulders and legs raised with control'
    });

    var registryCheck = live.validateRegistry && live.validateRegistry();
    if (registryCheck && registryCheck.ok === false) {
      Object.keys(live.registry).forEach(function (key) {
        if (live.registry[key] && live.registry[key].qualificationLevel === 'ENGINEERING_READY') delete live.registry[key];
      });
      throw new Error('bodyweight_pack_registry_invalid');
    }

    var classifier = V.exerciseClassifierV3;
    if (classifier && Array.isArray(classifier.PATTERNS)) {
      var additions = [
        { ex: 'knee_pushup', re: /knee\s*push.?up/ },
        { ex: 'incline_pushup', re: /incline\s*push.?up/ },
        { ex: 'split_squat', re: /split\s*squat/ },
        { ex: 'forward_lunge', re: /forward\s*lunge/ },
        { ex: 'reverse_lunge', re: /reverse\s*lunge/ },
        { ex: 'lateral_lunge', re: /lateral\s*lunge|side\s*lunge/ },
        { ex: 'bicycle_crunch', re: /bicycle\s*crunch/ },
        { ex: 'crunch', re: /\bcrunch/ },
        { ex: 'glute_bridge', re: /glute\s*bridge/ },
        { ex: 'hip_thrust', re: /hip\s*thrust/ },
        { ex: 'calf_raise', re: /calf\s*raise/ },
        { ex: 'jumping_jack', re: /jumping\s*jack|star\s*jump/ },
        { ex: 'mountain_climber', re: /mountain\s*climber/ },
        { ex: 'high_knees', re: /high\s*knee/ },
        { ex: 'burpee', re: /\bburpee/ },
        { ex: 'step_up', re: /step[ -]?up/ },
        { ex: 'forearm_plank', re: /forearm\s*plank/ },
        { ex: 'high_plank', re: /high\s*plank/ },
        { ex: 'side_plank', re: /side\s*plank/ },
        { ex: 'wall_sit', re: /wall\s*sit/ },
        { ex: 'dead_hang', re: /dead\s*hang/ },
        { ex: 'hollow_hold', re: /hollow\s*hold/ }
      ];
      for (var i = additions.length - 1; i >= 0; i--) classifier.PATTERNS.unshift(additions[i]);
    }

    V.bodyweightPackV3 = {
      version: 'bodyweight-pack-v3-1',
      installed: true,
      exercises: Object.keys(live.registry).filter(function (key) {
        return live.registry[key] && live.registry[key].qualificationLevel === 'ENGINEERING_READY';
      })
    };
    installed = true;
    return true;
  }

  function waitForRuntime() {
    if (install()) return;
    attempts++;
    if (attempts < 400) setTimeout(waitForRuntime, 25);
    else {
      root.VISION = root.VISION || {};
      root.VISION.bodyweightPackV3 = { version: 'bodyweight-pack-v3-1', installed: false, error: 'live_v3_unavailable' };
    }
  }

  waitForRuntime();
})(typeof window !== 'undefined' ? window : globalThis);
