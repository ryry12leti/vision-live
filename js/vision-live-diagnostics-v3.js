/* ============================================================================
   VISION · Live Proof V3 — diagnostics overlay (window.VISION.liveDiagnosticsV3)
   ----------------------------------------------------------------------------
   Server-authorised owner/admin ONLY. Renders the engine
   version, feature-flag state, active contract + verifier identity, camera view,
   selected side, visibility, equipment signal, phase, joint angles, rep-candidate
   status, rejected-rep reason, current coaching cue, FPS and inference latency.

   It NEVER renders merely because query parameters are present. Production
   access requires get_my_proof_qa_status() to have set
   VISION.proofQaAuthorized=true. Local automation can opt in only with the
   explicit VISION_QA_TEST_AUTHORIZED flag on localhost.

   A small always-on version chip (e.g. "Live Proof V3 · Dumbbell Curl") is
   available separately via mountVersionChip() so the tester always knows which
   engine produced a session — this is safe to show in staging.
   ========================================================================== */
(function (root) {
  'use strict';

  function isEnabled() {
    try {
      var qs = new URLSearchParams(root.location ? root.location.search : '');
      var h = (root.location && root.location.hostname) || '';
      var requested = qs.get('proof_qa') === '1' && qs.get('diag') === '1';
      if (!requested) return false;
      if (root.VISION && root.VISION.proofQaAuthorized === true) return true;
      if (/^(localhost|127\.0\.0\.1)$/.test(h) && root.VISION_QA_TEST_AUTHORIZED === true) return true;
    } catch (e) {}
    return false;
  }

  function el(tag, css, text) {
    var d = document.createElement(tag);
    if (css) d.style.cssText = css;
    if (text != null) d.textContent = text;
    return d;
  }

  function mountVersionChip(host, label) {
    if (!host) return null;
    var chip = el('div', 'position:absolute;top:8px;left:8px;z-index:40;padding:3px 9px;border-radius:999px;' +
      'font:600 11px/1.4 Inter,system-ui,sans-serif;color:#dfe7ff;background:rgba(20,26,48,.72);' +
      'backdrop-filter:blur(6px);border:1px solid rgba(120,150,255,.3);letter-spacing:.02em;', label || 'Live Proof V3');
    chip.setAttribute('data-vision-diag', 'chip');
    host.appendChild(chip);
    return { set: function (t) { chip.textContent = t; } };
  }

  function create(host) {
    if (!isEnabled() || !host) return { enabled: false, update: function () {}, destroy: function () {} };
    var panel = el('div', 'position:absolute;bottom:8px;left:8px;right:8px;z-index:41;max-height:44%;overflow:auto;' +
      'padding:8px 10px;border-radius:10px;font:500 10.5px/1.5 ui-monospace,Menlo,monospace;color:#b9c6ff;' +
      'background:rgba(8,10,22,.82);border:1px solid rgba(120,150,255,.28);white-space:pre-wrap;');
    panel.setAttribute('data-vision-diag', 'panel');
    host.appendChild(panel);

    var lastT = 0, fps = 0;
    function line(k, v) { return k.padEnd(14) + (v == null ? '—' : v); }

    return {
      enabled: true,
      update: function (r, extra) {
        extra = extra || {};
        var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        if (lastT) { var dt = now - lastT; if (dt > 0) fps = fps * 0.8 + (1000 / dt) * 0.2; }
        lastT = now;
        var id = (root.VISION && root.VISION.envIdentity) || {};
        var rows = [
          line('App', 'VISION ' + (id.env === 'preview' ? 'Preview' : (id.env || 'local'))),
          line('Backend', id.ref === 'qosaphtqksvocufjvtpa' ? 'Vision production' : (id.ref ? 'Vision staging (' + id.ref + ')' : 'demo — none')),
          line('Commit', id.commit || '—'),
          line('Engine', (r && r.engineVersion) || 'live-proof-v3'),
          line('Flag', extra.flag || (root.VISION_LIVE_V3 ? 'V3 on' : 'V3 off')),
          line('Contract', (r && r.exerciseId) || '—'),
          line('Verifier', (r && r.verifierId ? r.verifierId + ' v' + r.verifierVersion : '—')),
          line('Camera', (r && r.cameraView) || '—'),
          line('Side', (r && r.selectedSide) || '—'),
          line('State', (r && r.state) || '—'),
          line('Person', r ? (r.personVisible ? 'yes ' : 'no ') + Math.round((r.personConfidence || 0) * 100) + '%' : '—'),
          line('Landmarks', r ? Math.round((r.requiredLandmarksVisible || 0) * 100) + '%' : '—'),
          line('Equipment', r && r.equipmentRequired ? ((r.equipmentVisible ? 'seen ' : 'none ') + Math.round((r.equipmentConfidence || 0) * 100) + '% ' + (r.equipmentAssociated ? 'assoc' : 'unassoc') + (r.weightVerified ? '' : ' · weight NOT machine-verified')) : 'n/a'),
          line('Phase', (r && r.phase) || '—'),
          line('Angle', r && r.jointAngle != null ? r.jointAngle + '°' : '—'),
          line('Calib', r && r.calibration ? ('top ' + r.calibration.top + '° / bottom ' + r.calibration.bottom + '°' + (r.calibrated ? '' : ' (calibrating)')) : (r && !r.calibrated ? 'calibrating…' : '—')),
          line('Reps', r ? (r.reps + (extra.target ? ' / ' + extra.target : '')) : '—'),
          line('Rejected', r ? (r.rejectedReps + (r.rejectionReason ? '  last: ' + r.rejectionReason : '')) : '—'),
          line('Coach', (r && r.cue) || extra.cue || '—'),
          line('FPS', Math.round(fps) + (extra.poseMs ? ' · pose ' + Math.round(extra.poseMs) + 'ms' : '') + (extra.objMs ? ' · obj ' + Math.round(extra.objMs) + 'ms' : ''))
        ];
        panel.textContent = rows.join('\n');
      },
      destroy: function () { try { host.removeChild(panel); } catch (e) {} }
    };
  }

  var api = { isEnabled: isEnabled, create: create, mountVersionChip: mountVersionChip };
  root.VISION = root.VISION || {};
  root.VISION.liveDiagnosticsV3 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
