/* ============================================================================
   VISION · Live Proof V3 — equipment detector + object tracker
   (window.VISION.equipmentDetectorV3)
   ----------------------------------------------------------------------------
   HONESTY CONTRACT (Phase 6): the app may only claim it "detected a dumbbell"
   when a REAL object-detection model identified one. Wrist motion is never
   turned into fake dumbbell recognition. As of 2026-07-16 no off-the-shelf
   browser model with a dumbbell class and a verified commercial licence exists
   (COCO-SSD: Apache-2.0 but no dumbbell class; Ultralytics OIv7 YOLOv8: has
   the class but AGPL-3.0; Roboflow community models: unverified provenance,
   no measured validation). See docs/equipment-detection-v3.md for the
   investigation, dataset tooling and training/export pipeline.

   Until a validated model is configured:
     • status().available === false, reason 'no_licensed_model'
     • detect() returns [] — verifiers therefore keep weightVerified === false
     • weighted exercises stay staging-only (registry productionEnabled=false)
     • weighted tasks are BLOCKED from Live Proof and routed to photo proof

   When a model IS configured (configure({modelUrl,…}) + load()):
     • runs as a SEPARATE, SLOWER inference loop than MoveNet (caller schedules;
       recommended ≥600ms cadence) on the same downscaled canvas
     • an object tracker interpolates between detection frames, associates
       detections to previous tracks (IoU + proximity + motion continuity) and
       carries tracks through TEMPORARY occlusion with a grace period
     • output objects are [{class,score,box:{x,y,w,h},trackId,occluded}] in the
       pose keypoint coordinate space — the verifier associates them to wrists
   ========================================================================== */
(function (root) {
  'use strict';

  var OCCLUSION_GRACE_MS = 900;   // keep a lost track alive (marked occluded)
  var MIN_SCORE = 0.45;           // detection confidence floor
  var IOU_MATCH = 0.25;           // min IoU to continue a track
  var DIST_MATCH = 80;            // fallback centre-distance matcher (px, pre-normalised)

  var config = null;              // { modelUrl, classes:{index→name}, licence:{name,source,url}, inputSize }
  var model = null;
  var modelStatus = 'unavailable';// 'unavailable' | 'loading' | 'ready' | 'error'
  var statusReason = 'no_licensed_model';
  var lastInferMs = 0;

  function iou(a, b) {
    var x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    var x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    var inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    var uni = a.w * a.h + b.w * b.h - inter;
    return uni > 0 ? inter / uni : 0;
  }
  function centre(b) { return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; }

  /* ── track store ── */
  var tracks = [];   // {id, class, box, score, vx, vy, lastSeen, occluded}
  var nextTrackId = 1;

  function updateTracks(dets, now) {
    var used = {};
    // match each detection to the best existing track (IoU, then proximity)
    for (var i = 0; i < dets.length; i++) {
      var d = dets[i], best = null, bestScore = 0;
      for (var j = 0; j < tracks.length; j++) {
        var t = tracks[j];
        if (used[t.id] || t.class !== d.class) continue;
        var ov = iou(t.box, d.box);
        var dc = centre(d.box), tc = centre(t.box);
        var dist = Math.hypot(dc.x - tc.x, dc.y - tc.y);
        var s = ov >= IOU_MATCH ? 1 + ov : (dist <= DIST_MATCH ? 1 - dist / DIST_MATCH : 0);
        if (s > bestScore) { bestScore = s; best = t; }
      }
      if (best) {
        var dt = Math.max(1, now - best.lastSeen);
        var c1 = centre(d.box), c0 = centre(best.box);
        best.vx = (c1.x - c0.x) / dt; best.vy = (c1.y - c0.y) / dt; // motion continuity
        best.box = d.box; best.score = d.score; best.lastSeen = now; best.occluded = false;
        used[best.id] = true; d.trackId = best.id;
      } else {
        var nt = { id: nextTrackId++, class: d.class, box: d.box, score: d.score, vx: 0, vy: 0, lastSeen: now, occluded: false };
        tracks.push(nt); used[nt.id] = true; d.trackId = nt.id;
      }
      d.occluded = false;
    }
    // age unmatched tracks: interpolate through short occlusion, then drop
    var out = dets.slice();
    tracks = tracks.filter(function (t) {
      if (used[t.id]) return true;
      var age = now - t.lastSeen;
      if (age > OCCLUSION_GRACE_MS) return false;
      // predicted position while occluded (linear motion model)
      var pb = { x: t.box.x + t.vx * age, y: t.box.y + t.vy * age, w: t.box.w, h: t.box.h };
      out.push({ class: t.class, score: t.score * 0.6, box: pb, trackId: t.id, occluded: true });
      return true;
    });
    return out;
  }

  /* ── model lifecycle ── */
  // configure() is the drop-in point for a future VALIDATED model. It must only
  // ever be called with a model whose licence + validation are documented in
  // docs/equipment-detection-v3.md — see the acceptance gate there.
  function configure(cfg) {
    if (!cfg || !cfg.modelUrl || !cfg.licence || !cfg.licence.name || !cfg.licence.source) {
      throw new Error('equipmentDetectorV3.configure requires {modelUrl, classes, licence:{name,source}}');
    }
    config = cfg;
    modelStatus = 'unavailable';
    statusReason = 'configured_not_loaded';
  }
  async function load() {
    if (!config) { modelStatus = 'unavailable'; statusReason = 'no_licensed_model'; return null; }
    if (model) return model;
    if (!root.tf || !root.tf.loadGraphModel) { modelStatus = 'error'; statusReason = 'tfjs_not_loaded'; return null; }
    modelStatus = 'loading';
    try {
      model = await root.tf.loadGraphModel(config.modelUrl);
      modelStatus = 'ready'; statusReason = '';
      return model;
    } catch (e) {
      model = null; modelStatus = 'error'; statusReason = 'model_load_failed';
      return null;
    }
  }

  // detect(input, now) → tracked objects in the input's pixel space.
  // With no model configured this ALWAYS returns [] — never fabricated boxes.
  async function detect(input, now) {
    now = Number(now || 0);
    if (!model || modelStatus !== 'ready') return updateTracks([], now);
    var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    var dets = [];
    try {
      var tf = root.tf;
      var size = config.inputSize || 320;
      var img = tf.tidy(function () {
        return tf.image.resizeBilinear(tf.browser.fromPixels(input), [size, size]).expandDims(0).toInt();
      });
      var res = await model.executeAsync(img);
      img.dispose();
      // standard TF OD-API export: [boxes(1,N,4 ymin,xmin,ymax,xmax norm), scores(1,N), classes(1,N)]
      var arr = Array.isArray(res) ? res : [res];
      var boxes = await arr[0].array(), scores = await arr[1].array(), classes = arr[2] ? await arr[2].array() : null;
      arr.forEach(function (t) { try { t.dispose(); } catch (e) {} });
      var W = input.width || input.videoWidth || size, H = input.height || input.videoHeight || size;
      var names = config.classes || {};
      for (var i = 0; i < scores[0].length; i++) {
        if (scores[0][i] < MIN_SCORE) continue;
        var cls = classes ? names[Math.round(classes[0][i])] : 'dumbbell';
        if (!cls) continue;
        var b = boxes[0][i];
        dets.push({ class: cls, score: scores[0][i],
          box: { x: b[1] * W, y: b[0] * H, w: (b[3] - b[1]) * W, h: (b[2] - b[0]) * H } });
      }
    } catch (e) { /* detection is optional evidence — fail soft, never block pose */ }
    lastInferMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return updateTracks(dets, now);
  }

  function status() {
    return {
      available: modelStatus === 'ready',
      modelStatus: modelStatus,
      reason: statusReason,
      licence: config && config.licence ? config.licence : null,
      lastInferMs: Math.round(lastInferMs),
      activeTracks: tracks.length
    };
  }
  function resetTracks() { tracks = []; nextTrackId = 1; }

  var api = { configure: configure, load: load, detect: detect, status: status,
              resetTracks: resetTracks, _updateTracks: updateTracks /* exposed for tests */ };
  root.VISION = root.VISION || {};
  root.VISION.equipmentDetectorV3 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
