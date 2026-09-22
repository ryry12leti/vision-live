/* VISION bodyweight routing companion.
   Runs independently from registry installation so late-loaded classifier code
   receives the extended patterns without depending on script timing. */
(function (root) {
  'use strict';
  var attempts = 0;
  function install() {
    var V = root.VISION || {};
    var live = V.liveV3;
    var classifier = V.exerciseClassifierV3;
    if (!live || !live.registry || !classifier || !Array.isArray(classifier.PATTERNS)) return false;
    if (V.bodyweightRoutingV3 && V.bodyweightRoutingV3.installed) return true;

    if (live.registry.jumping_jack) live.registry.jumping_jack.bilateral = false;

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
    var existing = Object.create(null);
    classifier.PATTERNS.forEach(function (item) { existing[item.ex] = true; });
    for (var i = additions.length - 1; i >= 0; i--) {
      if (!existing[additions[i].ex]) classifier.PATTERNS.unshift(additions[i]);
    }
    V.bodyweightRoutingV3 = { version: 'bodyweight-routing-v3-1', installed: true, patterns: additions.map(function (item) { return item.ex; }) };
    return true;
  }
  function wait() {
    if (install()) return;
    attempts++;
    if (attempts < 400) setTimeout(wait, 25);
    else {
      root.VISION = root.VISION || {};
      root.VISION.bodyweightRoutingV3 = { version: 'bodyweight-routing-v3-1', installed: false, error: 'dependencies_unavailable' };
    }
  }
  wait();
})(typeof window !== 'undefined' ? window : globalThis);
