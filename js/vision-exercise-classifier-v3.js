/* ============================================================================
   VISION · Live Proof V3 — exercise classifier + contract builder (Phase 2)
   ----------------------------------------------------------------------------
   Deterministic mapping from a natural task description to exactly ONE outcome:
     • exact  — a supported V3 verifier (rep/hold/duration)
     • generic — the verified movement-duration verifier
     • photo  — photo proof fallback
     • voice  — voice proof fallback
     • unsupported — automatic rep counting not supported yet (honest)

   Dumbbell (weighted) exercises resolve to their verifier ONLY when equipment
   verification is enabled AND the registry marks the exercise productionEnabled
   (staging). Otherwise — because no trained dumbbell object model is bundled —
   they fall back honestly rather than claiming a verified weighted rep count.

   Never guesses an unrelated exercise for unknown text: unknown → generic or
   photo, never a random verifier.
   ========================================================================== */
(function (root) {
  'use strict';

  // ordered patterns — most specific first so "goblet squat" beats "squat", etc.
  var PATTERNS = [
    // dumbbell / weighted families
    { ex: 'dumbbell_alt_curl', re: /alternat\w*\s+(?:dumbbell\s+)?curl|alternat\w*\s+bicep/ },
    { ex: 'dumbbell_hammer_curl', re: /hammer\s*curl/ },
    { ex: 'goblet_squat', re: /goblet\s*squat/ },
    { ex: 'dumbbell_rdl', re: /romanian\s*deadlift|\brdl\b|dumbbell\s*deadlift|stiff.?leg\w*\s*deadlift/ },
    { ex: 'dumbbell_lunge', re: /(?:dumbbell|weighted|db)\s*lunge|lunge\w*\s+with\s+(?:dumbbell|weight)/ },
    { ex: 'dumbbell_shoulder_press', re: /(?:dumbbell|db)?\s*(?:shoulder|overhead|military)\s*press|shoulder\s*press\w*\s+with\s+dumbbell/ },
    { ex: 'dumbbell_lateral_raise', re: /lateral\s*raise|side\s*raise/ },
    { ex: 'dumbbell_front_raise', re: /front\s*raise/ },
    { ex: 'dumbbell_bench_press', re: /(?:dumbbell|db|chest)\s*bench\s*press|bench\s*press\w*\s+with\s+dumbbell|dumbbell\s*chest\s*press/ },
    { ex: 'dumbbell_tricep_extension', re: /tricep\w*\s*(?:extension|ext)|overhead\s*tricep/ },
    { ex: 'dumbbell_one_arm_row', re: /(?:one|single).?arm\s*(?:dumbbell\s*)?row/ },
    { ex: 'dumbbell_bent_row', re: /bent.?over\s*(?:dumbbell\s*)?row|dumbbell\s*row|db\s*row|\brows?\b.*dumbbell/ },
    { ex: 'dumbbell_bicep_curl', re: /(?:dumbbell|db)\s*(?:bicep\s*)?curl|bicep\s*curl|\bcurls?\b.*dumbbell|dumbbell.*\bcurls?\b/ },

    // bodyweight rep families
    { ex: 'pullup', re: /pull.?up|chin.?up/ },
    { ex: 'pushup', re: /push.?up|press.?up/ },
    { ex: 'lunge', re: /\blunge/ },
    { ex: 'squat', re: /\bsquat/ },
    { ex: 'situp', re: /sit.?up|crunch/ },

    // holds
    { ex: 'plank', re: /\bplank|hollow.?hold/ },

    // duration drills — footwork/movement only. Deliberately does NOT match bare
    // "dribbl": dribbling always implies ball touches/count, which is an object-
    // interaction claim (Package 6) this ankle/knee-travel-only verifier can never
    // support — "dribble a basketball 20 times" must fall through to the honest
    // photo fallback below, not claim an 'exact' pose-only match. Requires
    // "soccer"/"football" to be qualified by movement/footwork/drill wording,
    // matching the same safer convention js/vision-machine-cardio-pack-v3.js
    // already uses for its own soccer_movement pattern.
    { ex: 'soccer_drill', re: /(?:soccer|football)\s*(?:movement|footwork|drill|practice)/ },
    { ex: 'shadowboxing', re: /shadow.?box|boxing\s*(?:drill|round)|jab.?cross/ }
  ];

  // exercises that clearly aren't automatable by pose alone → honest fallbacks
  var PHOTO_HINTS = /meditat|read\b|journal|study|water|meal|photo|screenshot|clean|tidy|write\b/;
  var VOICE_HINTS = /reflect|gratitude|speak|say out loud|voice note|talk through/;
  var UNSUPPORTED_HINTS = /bench\s*press\s*barbell|barbell\s*squat|deadlift\s*barbell|swim|cycl\w+\s*outdoor|run\s+\d/;

  function classify(taskText, opts) {
    opts = opts || {};
    var reg = (root.VISION && root.VISION.liveV3 && root.VISION.liveV3.registry) || {};
    var equipmentEnabled = opts.equipmentVerificationEnabled === true;
    var forProduction = opts.forProduction === true;
    var text = String(taskText || '').toLowerCase();

    // Fail closed before broad bodyweight patterns. Without this ordering,
    // "barbell squat" matched the generic squat verifier first.
    if (UNSUPPORTED_HINTS.test(text)) return { outcome: 'unsupported', exerciseId: null, verifierId: null, reason: 'no_pose_verifier', fallbackProofType: 'photo', note: 'Automatic rep counting is not supported for this task yet.' };

    for (var i = 0; i < PATTERNS.length; i++) {
      if (PATTERNS[i].re.test(text)) {
        var ex = PATTERNS[i].ex, spec = reg[ex];
        if (!spec) break;
        var needsEquip = spec.requiredEquipment && spec.requiredEquipment.length;
        // Dumbbell family: only route to the exact weighted verifier when equipment
        // verification is available and (in production) the exercise is enabled.
        if (needsEquip && (!equipmentEnabled || (forProduction && !spec.productionEnabled))) {
          // honest fallback: the motion is real, but the WEIGHTED claim is unverifiable
          return {
            outcome: 'generic', exerciseId: 'generic_movement', verifierId: 'v3-generic',
            reason: 'equipment_model_unavailable',
            note: 'Dumbbell rep counting runs in staging but is not yet production-verified (no trained equipment model). Logged as verified movement.',
            fallbackProofType: 'photo'
          };
        }
        if (forProduction && !spec.productionEnabled) {
          return { outcome: 'photo', exerciseId: ex, verifierId: null, reason: 'exercise_production_gated',
                   fallbackProofType: 'photo' };
        }
        return {
          outcome: 'exact', exerciseId: ex, verifierId: spec.verifierId, verifierVersion: spec.verifierVersion,
          mode: spec.mode, requiredEquipment: spec.requiredEquipment || [], weightVerified: false,
          productionEnabled: !!spec.productionEnabled
        };
      }
    }

    if (VOICE_HINTS.test(text)) return { outcome: 'voice', exerciseId: null, verifierId: null, fallbackProofType: 'voice' };
    if (PHOTO_HINTS.test(text)) return { outcome: 'photo', exerciseId: null, verifierId: null, fallbackProofType: 'photo' };
    // a physical-but-unrecognised movement → honest generic movement-duration verifier.
    // Includes rhythmic drills we don't yet have a dedicated V3 counter for (burpees,
    // mountain climbers, jumping jacks, high knees) so they are logged as verified
    // movement rather than a fabricated rep count.
    if (/exercise|workout|drill|jump|move|cardio|hop|skip|dance|stretch|burpee|mountain\s*climb|high\s*knee|jumping\s*jack|star\s*jump|climber/.test(text)) {
      return { outcome: 'generic', exerciseId: 'generic_movement', verifierId: 'v3-generic', mode: 'duration' };
    }
    return { outcome: 'photo', exerciseId: null, verifierId: null, fallbackProofType: 'photo', reason: 'unrecognised_task' };
  }

  var api = { classify: classify, PATTERNS: PATTERNS };
  root.VISION = root.VISION || {};
  root.VISION.exerciseClassifierV3 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
