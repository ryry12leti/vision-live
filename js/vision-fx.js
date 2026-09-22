/* ═══════════════════════════════════════════════════════════════
   vision-fx.js — VISION.fx : the "surge" reward effect
   A smooth ball of lightning beads up from the verified-points
   number, LOOPS across the screen on a spiral-loop path trailing a
   single silky glowing streak, and strikes the Profile nav tab —
   charging it with a gold glow. Canvas-rendered with additive
   blending: a velocity-stretched hot core, one continuous smooth
   comet trail (no beads/dots), and a light electric crackle.
   No dependencies. Respects prefers-reduced-motion. window.VISION.fx.
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};
(function (V) {
  'use strict';

  let reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion:reduce)').matches; } catch (e) {}

  /* palette — raw rgb triplets so we can vary alpha freely (mirror css/app.css) */
  const GOLD  = '230,196,106';   // --gold
  const CHAMP = '244,232,200';   // --champagne
  const WHITE = '255,255,255';

  /* ── tunables ──────────────────────────────────────────────────── */
  const TRAVEL   = 1750;   // ms — loop flight time (reads fast through the loop via easing)
  const IMPACT   = 440;    // ms — strike + settle
  const TURNS    = 1.5;    // revolutions of the orbiting offset → one clean self-crossing loop
  const AMP_FRAC = 0.34;   // loop radius as a fraction of min(viewport) — how wide it sweeps
  const TRAIL_MS = 340;    // trail = the last ~340ms of motion → same length on 60/120Hz

  let active = null;             // the in-flight run (only one at a time)

  /* ── geometry helpers ─────────────────────────────────────────── */
  function rectCenter(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function profileLink() {
    return document.querySelector('.vlinks a[href*="profile"]');
  }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutCubic(t)   { return 1 - Math.pow(1 - t, 3); }

  /* a jagged lightning polyline from a→b, `segs` segments, `amp` perpendicular jitter */
  function boltPath(a, b, segs, amp) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;          // perpendicular unit vector
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const off = (i === 0 || i === segs) ? 0 : (Math.random() * 2 - 1) * amp;
      pts.push({ x: a.x + dx * t + nx * off, y: a.y + dy * t + ny * off });
    }
    return pts;
  }
  function strokePolyline(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  /* ── lifecycle ────────────────────────────────────────────────── */
  function teardown(run) {
    if (!run) return;
    if (run.raf) cancelAnimationFrame(run.raf);
    if (run.canvas && run.canvas.parentNode) run.canvas.parentNode.removeChild(run.canvas);
    if (active === run) active = null;
  }

  /* charge the target nav tab — CSS .fx-charged drives the glow (both layouts) */
  function chargeTab(el, dur) {
    if (!el) return;
    el.classList.add('fx-charged');
    setTimeout(() => el.classList.remove('fx-charged'), dur || 1900);
  }

  /* ── the effect ───────────────────────────────────────────────── */
  function surge(opts) {
    opts = opts || {};
    let target = (opts.to && opts.to.nodeType === 1) ? opts.to : profileLink();
    if (!target || !document.body) return;          // nothing to strike — no-op

    /* reduced motion → glow the tab, skip all canvas motion */
    if (reduce) { chargeTab(target, 1400); return; }

    teardown(active);                               // replace any in-flight run

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:500;pointer-events:none';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);                            // draw in CSS pixels, retina-crisp

    /* start point: explicit origin → origin element → upper-centre fallback */
    let start;
    if (opts.origin && typeof opts.origin.x === 'number') start = { x: opts.origin.x, y: opts.origin.y };
    else if (opts.originEl) start = rectCenter(opts.originEl);
    else start = { x: W / 2, y: H * 0.42 };

    const end = rectCenter(target);

    /* ── spiral-loop path ──────────────────────────────────────────
       pos(t) = orbitCentre(t) + amp(t)·(cos φ, sin φ)
       · orbitCentre lerps start→target but is pulled toward screen centre
         mid-flight, so the loop sweeps the screen yet starts/ends exactly.
       · amp rises then decays to 0 → both ends land dead-on, no clamps.
       · φ winds TURNS revolutions; φ0 opens the loop away from the tab. */
    const dx = end.x - start.x, dy = end.y - start.y;
    const CX = W / 2, CY = H / 2;
    const AMP = Math.min(Math.min(W, H) * AMP_FRAC, Math.hypot(dx, dy) * 1.1 + 120, 360);
    const baseAng = Math.atan2(dy, dx);             // start→target direction
    const side = (end.x >= start.x) ? 1 : -1;       // tab on the right vs left
    const phi0 = baseAng + side * Math.PI * 0.62;   // open the loop away from the tab
    const spin = -side;                             // handedness → final turn curls into the tab

    function pathAt(t) {
      const S = easeInOutCubic(t);
      const bx = start.x + dx * S, by = start.y + dy * S;
      const blend = Math.sin(Math.PI * t) * 0.5;    // pull orbit toward screen centre mid-flight
      const ox = bx + (CX - bx) * blend, oy = by + (CY - by) * blend;
      const amp = Math.pow(Math.sin(Math.PI * t), 1.15) * AMP;
      const a = phi0 + spin * TURNS * 2 * Math.PI * t;
      return { x: ox + Math.cos(a) * amp, y: oy + Math.sin(a) * amp };
    }
    /* peak path speed — normalises the velocity-stretch regardless of viewport/distance */
    let vmax = 1e-6;
    for (let s = 0; s <= 24; s++) {
      const e = 0.004, a = pathAt(Math.max(0, s / 24 - e)), b = pathAt(Math.min(1, s / 24 + e));
      vmax = Math.max(vmax, Math.hypot(b.x - a.x, b.y - a.y));
    }

    const t0 = performance.now();
    const trail = [];              // {x,y,t} recent path points → one smooth streak
    let charged = false;

    const run = { canvas, raf: 0 };
    active = run;

    /* smooth glowing orb: soft bloom + white-hot core, stretched along velocity */
    function drawOrb(x, y, r, k, ang, stretch, squash) {
      ctx.save();
      ctx.translate(x, y);
      if (ang != null) { ctx.rotate(ang); ctx.scale(stretch, squash); }
      const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 3.4);
      bloom.addColorStop(0,    'rgba(' + WHITE + ',' + (0.85 * k) + ')');
      bloom.addColorStop(0.16, 'rgba(' + CHAMP + ',' + (0.60 * k) + ')');
      bloom.addColorStop(0.44, 'rgba(' + GOLD  + ',' + (0.26 * k) + ')');
      bloom.addColorStop(1,    'rgba(' + GOLD  + ',0)');
      ctx.fillStyle = bloom;
      ctx.beginPath(); ctx.arc(0, 0, r * 3.4, 0, 7); ctx.fill();
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      core.addColorStop(0,   'rgba(' + WHITE + ',' + k + ')');
      core.addColorStop(0.55, 'rgba(' + CHAMP + ',' + (0.9 * k) + ')');
      core.addColorStop(1,   'rgba(' + GOLD  + ',0)');
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      ctx.restore();
    }

    /* trace ONE smooth curve through the trail points (quadratic through midpoints) */
    function traceTrail() {
      ctx.beginPath();
      ctx.moveTo(trail[0].x, trail[0].y);
      for (let i = 1; i < trail.length - 1; i++) {
        const mx = (trail[i].x + trail[i + 1].x) / 2, my = (trail[i].y + trail[i + 1].y) / 2;
        ctx.quadraticCurveTo(trail[i].x, trail[i].y, mx, my);
      }
      const last = trail[trail.length - 1];
      ctx.lineTo(last.x, last.y);
    }

    function frame(now) {
      run.raf = requestAnimationFrame(frame);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';     // additive — light adds up
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const travelT = Math.min((now - t0) / TRAVEL, 1);

      if (travelT < 1) {
        /* ── looping flight ──────────────────────────────────────── */
        const pos = pathAt(travelT);
        const va = pathAt(Math.max(0, travelT - 0.004)), vb = pathAt(Math.min(1, travelT + 0.004));
        const vx = vb.x - va.x, vy = vb.y - va.y;
        const vang = Math.atan2(vy, vx);
        const speedN = Math.min(Math.hypot(vx, vy) / vmax, 1);

        /* sample every frame, trim by age → dense points, framerate-independent */
        trail.push({ x: pos.x, y: pos.y, t: now });
        while (trail.length && now - trail[0].t > TRAIL_MS) trail.shift();
        if (trail.length > 90) trail.splice(0, trail.length - 90);

        /* ONE continuous smooth streak — 3 additive passes (wide dim → thin bright),
           each a length-gradient that fades the tail out (taper). No beads/dots. */
        if (trail.length > 2) {
          const tp = trail[0], hp = trail[trail.length - 1];
          const streak = (mid, head, a) => {
            const g = ctx.createLinearGradient(tp.x, tp.y, hp.x, hp.y);
            g.addColorStop(0,    'rgba(' + mid  + ',0)');
            g.addColorStop(0.55, 'rgba(' + mid  + ',' + (a * 0.45) + ')');
            g.addColorStop(1,    'rgba(' + head + ',' + a + ')');
            return g;
          };
          ctx.strokeStyle = streak(GOLD,  CHAMP, 0.30); ctx.lineWidth = 16;  traceTrail(); ctx.stroke();
          ctx.strokeStyle = streak(GOLD,  WHITE, 0.55); ctx.lineWidth = 7;   traceTrail(); ctx.stroke();
          ctx.strokeStyle = streak(CHAMP, WHITE, 0.95); ctx.lineWidth = 2.6; traceTrail(); ctx.stroke();
        }

        /* the ball — grows in at launch, stretches along velocity into a comet */
        const orbR = 8 + 6 * easeOutCubic(Math.min(travelT / 0.16, 1));
        drawOrb(pos.x, pos.y, orbR, 1, vang, 1 + speedN * 1.1, 1 - speedN * 0.26);

        /* light electric crackle — one thin glowing tendril off the back, occasional */
        if (Math.random() < 0.7) {
          ctx.shadowColor = 'rgba(' + CHAMP + ',0.9)'; ctx.shadowBlur = 8;
          const ang = vang + Math.PI + (Math.random() - 0.5) * 1.3;
          const reach = 16 + Math.random() * 22;
          const tip = { x: pos.x + Math.cos(ang) * reach, y: pos.y + Math.sin(ang) * reach };
          ctx.strokeStyle = 'rgba(' + WHITE + ',' + (0.30 + Math.random() * 0.4) + ')';
          ctx.lineWidth = 1.1;
          strokePolyline(ctx, boltPath(pos, tip, 4, 5));
          ctx.shadowBlur = 0;
        }
      } else {
        /* ── smooth impact at the tab: flash + expanding ring (no dots) ── */
        if (!charged) { charged = true; chargeTab(target, 1900); }

        const it = Math.min((now - (t0 + TRAVEL)) / IMPACT, 1);
        const fade = 1 - it;

        /* bright flash collapsing into the tab */
        drawOrb(end.x, end.y, 22 * fade + 4, Math.min(fade * 1.15, 1));

        /* expanding shock ring */
        ctx.strokeStyle = 'rgba(' + CHAMP + ',' + (0.55 * fade) + ')';
        ctx.lineWidth = 2.4 * fade + 0.4;
        ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(' + GOLD + ',' + fade + ')';
        ctx.beginPath(); ctx.arc(end.x, end.y, 6 + easeOutCubic(it) * 54, 0, 7); ctx.stroke();
        ctx.shadowBlur = 0;

        if (it >= 1) { teardown(run); return; }
      }
    }
    run.raf = requestAnimationFrame(frame);
  }

  /* convenience: launch from the verified-points number → strike Profile tab */
  function surgeToProfile(opts) {
    opts = opts || {};
    const o = { to: profileLink() };
    if (opts.origin) o.origin = opts.origin;
    else o.originEl = opts.originEl || document.getElementById('doneScore') || null;
    surge(o);
  }

  V.fx = { surge, surgeToProfile, _profileLink: profileLink };
})(window.VISION);
