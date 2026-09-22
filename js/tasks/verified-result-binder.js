/* ═══════════════════════════════════════════════════════════════
   VISION · Verified result binder

   Binds the verified-result screen to the REAL server decision.

   The screen was originally written against the planned proof-session
   contract (docs/proof-session-backend-contracts.md), which was never
   implemented server-side. This binder replaces that layer with the
   authoritative sources that actually exist today:

     · points   ← `awarded` from VISION.api.submitProof (server decision)
     · totals   ← get_user_standing() via VISION.api.getStanding()
     · rank     ← VisionTasks.rankReveal, fed the server totals explicitly

   Anything the server does not return (execution score, per-criterion
   results, evidence breakdown, milestones, badges, trajectory) is left
   absent so the screen renders an honest reduced state. Nothing here
   invents a verification judgement, and nothing here decides acceptance —
   the server has already done that before this module is called.
════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var VisionTasks = root.VisionTasks = root.VisionTasks || {};
  var continueAfter = null;

  function api() {
    return (root.VISION && root.VISION.api) || null;
  }

  /* Server-authoritative point totals. Returns null when the standing RPC
     cannot be read — the caller then falls back to the plain unlock
     cinematic rather than showing a rank movement we cannot substantiate. */
  function serverTotals(awarded) {
    var a = api();
    if (!a || typeof a.getStanding !== 'function') return Promise.resolve(null);
    return Promise.resolve(a.getStanding()).then(function (standing) {
      var facts = standing && standing.facts;
      if (!facts || typeof facts.verified_points !== 'number') return null;
      var newTotal = Math.max(0, Math.round(facts.verified_points));
      return { newTotal: newTotal, previousTotal: Math.max(0, newTotal - awarded) };
    }).catch(function () { return null; });
  }

  /* The server enforces one accepted proof per task per day, so task + UTC
     date is a stable, non-fabricated key for de-duplicating the reveal. */
  function attemptKey(mission) {
    return String((mission && mission.id) || 'task') + ':' + new Date().toISOString().slice(0, 10);
  }

  /**
   * Present the verified-proof result screen from a real server decision.
   * Resolves true when the screen was shown, false when it could not be
   * shown truthfully (caller should fall back to the unlock cinematic).
   */
  function presentVerifiedResult(options) {
    options = options || {};
    var awarded = Math.max(0, Math.round(Number(options.awarded) || 0));
    var mission = options.mission || null;

    if (!awarded || !VisionTasks.rankReveal || !VisionTasks.resultScreen) return Promise.resolve(false);
    if (!document.getElementById('tdResult')) return Promise.resolve(false);

    return serverTotals(awarded).then(function (totals) {
      if (!totals) return false;

      var event = VisionTasks.rankReveal.applyAward({
        taskId: String((mission && mission.id) || ''),
        taskTitle: (mission && mission.title) || '',
        attemptId: attemptKey(mission),
        pointsEarned: awarded,
        previousTotal: totals.previousTotal,
        newTotal: totals.newTotal,
        verificationConfidence: options.confidence != null ? String(options.confidence) : '',
        accepted: true,
        finalPoints: true
      });

      if (!event || (!event.applied && !event.event)) return false;
      var display = event.event || event;

      // No model / raw / record: the server returns no execution score,
      // criteria or evidence breakdown, so those stay genuinely absent.
      var result = VisionTasks.resultScreen.normalize(display, null, {
        verifiedAt: display.timestamp || new Date().toISOString()
      }, null);

      VisionTasks.resultScreen.present(result, {});
      return new Promise(function (resolve) { continueAfter = resolve; });
    }).catch(function (error) {
      console.error('[VISION] Verified result screen could not be presented', error);
      return false;
    });
  }

  /* Called by the result screen's "Move On" / report-close buttons. */
  VisionTasks.verification = Object.assign({}, VisionTasks.verification, {
    continueAfterVerificationResult: function () {
      var resolve = continueAfter;
      continueAfter = null;
      if (resolve) resolve(true);
      return true;
    }
  });

  VisionTasks.presentVerifiedResult = presentVerifiedResult;
})(window);
