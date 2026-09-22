/* ═══════════════════════════════════════════════════════════════
   app-ui.js — shared UI helpers for VISION app pages
   Atmosphere (ambient light + gold starfield), toast, count-up,
   reveal-on-load. Exposed on window.VISION.ui. No dependencies.
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};
(function (V) {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* ambient cursor light */
  addEventListener('mousemove', e => {
    const a = $('#amb'); if (!a) return;
    a.style.setProperty('--mx', e.clientX + 'px');
    a.style.setProperty('--my', e.clientY + 'px');
  }, { passive: true });

  /* gold starfield (uses #stars canvas if present) */
  function starfield() {
    const c = $('#stars'); if (!c || reduce) return;
    const x = c.getContext('2d'); let w, h, st = [];
    function rs() { w = c.width = innerWidth; h = c.height = innerHeight; } rs(); addEventListener('resize', rs);
    const N = Math.min(72, Math.floor(innerWidth / 22));
    for (let i = 0; i < N; i++) st.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * .8 + .25,
      vx: (Math.random() - .5) * .03, vy: (Math.random() - .5) * .03, a: Math.random() * .13 + .04, tw: Math.random() * 6.28 });
    (function d() {
      x.clearRect(0, 0, w, h);
      for (const s of st) { s.x += s.vx; s.y += s.vy; s.tw += .009;
        if (s.x < 0) s.x = w; if (s.x > w) s.x = 0; if (s.y < 0) s.y = h; if (s.y > h) s.y = 0;
        const a = s.a * (.6 + .4 * Math.sin(s.tw));
        x.beginPath(); x.arc(s.x, s.y, s.r, 0, 7); x.fillStyle = 'rgba(206,214,228,' + a + ')'; x.fill(); }
      requestAnimationFrame(d);
    })();
  }

  /* toast — needs #toast > .tk markup */
  let tT;
  function toast(msg) {
    const e = $('#toast'); if (!e) return;
    $('.tk', e).innerHTML = msg; e.classList.add('show');
    clearTimeout(tT); tT = setTimeout(() => e.classList.remove('show'), 2600);
  }

  /* animated count-up — eases from the currently rendered value to `to`
     so re-renders don't snap back to 0 */
  function countUp(el, to, dur, fmt) {
    if (!el) return; dur = dur || 1400;
    const from = parseInt((el.textContent || '').replace(/[^\d-]/g, ''), 10) || 0;
    if (reduce || from === to) { el.textContent = fmt ? fmt(to) : to; return; }
    const t0 = performance.now();
    (function step(t) {
      const p = Math.min((t - t0) / dur, 1), k = 1 - Math.pow(1 - p, 3), v = Math.round(from + (to - from) * k);
      el.textContent = fmt ? fmt(v) : v;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = fmt ? fmt(to) : to;
    })(performance.now());
  }

  /* scroll-reveal: .reveal elements animate in as they enter the viewport.
     Above-the-fold ones fire on load; below-fold ones fire on scroll. */
  function reveals() {
    const els = $$('.reveal'); if (!els.length) return;
    if (reduce || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
    // light per-sibling stagger
    els.forEach(e => { if (!e.style.transitionDelay) {
      const sibs = e.parentElement ? [...e.parentElement.children].filter(c => c.classList.contains('reveal')) : [e];
      const i = sibs.indexOf(e); if (i > 0) e.style.transitionDelay = Math.min(i * 70, 280) + 'ms';
    }});
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(e => io.observe(e));
  }

  /* cinematic "verifying" pass over a proof photo — resolves when done.
     Adds .verifying to the card; CSS draws the scan line + checkmark. */
  function scanVerify(card) {
    return new Promise(res => {
      if (!card || reduce) return res();
      card.classList.add('verifying');
      setTimeout(() => { card.classList.add('checked'); }, 1050);
      setTimeout(() => { card.classList.remove('verifying', 'checked'); res(); }, 1550);
    });
  }

  /* soft page transitions: fade body in on load, fade out before navigating */
  function pageTransitions() {
    addEventListener('DOMContentLoaded', () => document.body.classList.add('loaded'));
    if (reduce) return;
    addEventListener('click', e => {
      if (e.defaultPrevented) return;
      const a = e.target.closest && e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (a.target === '_blank' || a.hasAttribute('data-noflip') || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!href || href[0] === '#' || /^(https?:|mailto:|tel:)/.test(href)) return;
      e.preventDefault();
      document.body.classList.add('leaving');
      setTimeout(() => { location.href = href; }, 220);
    });
    // restore on bfcache back-nav
    addEventListener('pageshow', e => { if (e.persisted) document.body.classList.remove('leaving'); });
  }

  /* point-amount as a number + green-up / red-down arrow (the app's XP replacement).
     amt(40) → "40 ▲" (green up).  amt(-12) → "12 ▼" (red down).  amt(0) → flat.
     opts: {dir:'up'|'down'|'flat'} to force direction, {fmt:fn} to format the number. */
  function amt(n, opts) {
    opts = opts || {};
    const num = Number(n) || 0;
    const dir = opts.dir || (num > 0 ? 'up' : num < 0 ? 'down' : 'flat');
    const val = opts.fmt ? opts.fmt(Math.abs(num)) : Math.abs(num).toLocaleString();
    return '<span class="amt ' + dir + '">' + val + '<i class="arw"></i></span>';
  }

  /* ── safe value helpers — never let NaN / Invalid Date / undefined reach the DOM ──
     Shared canonical utilities so every page derives Days Enlisted, future pace,
     counts and dates the same way. parseDateSafe accepts date-only ("YYYY-MM-DD")
     and full ISO timestamps; the previous bug was string-concatenating
     "<iso-timestamp>"+"T00:00:00" which produced an Invalid Date → NaN. */
  function parseDateSafe(v) {
    if (v == null) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var s = String(v).trim(); if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00'; // date-only → local midnight
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  /* inclusive whole-day count since `v` (min 1). null if `v` can't be parsed.
     Future dates clamp to 1 ("enlisted today"). Never returns NaN. */
  function daysSince(v) {
    var d = parseDateSafe(v); if (!d) return null;
    var ms = Date.now() - d.getTime();
    if (!isFinite(ms)) return null;
    if (ms < 0) return 1;
    return Math.max(1, Math.floor(ms / 86400000) + 1);
  }
  /* coerce to a finite number or `fb` (default 0) — guards toLocaleString/% math */
  function toFinite(n, fb) { var x = Number(n); return isFinite(x) ? x : (fb === undefined ? 0 : fb); }
  /* singular/plural without inventing a number */
  function plural(n, one, many) { return Math.abs(Number(n)) === 1 ? one : (many || (one + 's')); }
  /* finite number for display, else an honest dash */
  function safeCount(n, dash) { var x = Number(n); return isFinite(x) ? x.toLocaleString() : (dash || '—'); }

  /* skeleton loaders: clear the `is-loading` flag once the first real render
     lands. Idempotent; defaults to <body>. Pages mark hero values with
     `data-sk` (see css/app.css) and call this when their data is painted. */
  function ready(root) { (root || document.body).classList.remove('is-loading'); }

  /* ── shared nav avatar ────────────────────────────────────────────────
     Populate the profile avatar in the standard nav (`.nav-avatar-wrap`) with
     the user's initial + photo when available. Works in demo and backend mode;
     degrades to "V" until an identity is known. Idempotent — safe to re-run as
     identity hydrates. Pages just include the markup; this fills it in so every
     page's nav is identical without per-page JS. */
  function navIdentityName() {
    try { var ob = (V.core && V.core.getOnboarding && V.core.getOnboarding()) || {};
      if (ob.name && String(ob.name).trim()) return String(ob.name).trim(); } catch (e) {}
    try { var u = (V.auth && V.auth.user) || window.__visionUser;
      var meta = u && (u.user_metadata || u);
      var nm = meta && (meta.full_name || meta.name);
      if (nm && String(nm).trim()) return String(nm).trim();
      if (u && u.email) return String(u.email).split('@')[0]; } catch (e) {}
    return '';
  }
  function navProfileImage() {
    try { var ls = localStorage.getItem('vision_avatar_url'); if (ls) return ls; } catch (e) {}
    try { var u = (V.auth && V.auth.user) || window.__visionUser;
      var meta = u && (u.user_metadata || u);
      if (meta && (meta.avatar_url || meta.picture)) return meta.avatar_url || meta.picture; } catch (e) {}
    return null;
  }
  function navInitials(name) {
    if (!name || !name.trim()) return 'V';
    return name.trim().split(/\s+/).map(function (w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
  }
  function mountNavAvatar() {
    var wrap = document.querySelector('.nav-avatar-wrap');
    if (!wrap) return;
    var init = navInitials(navIdentityName());
    var initEl = wrap.querySelector('.nav-av-init');
    if (initEl) initEl.textContent = init;
    var img = navProfileImage();
    var av = wrap.querySelector('.nav-avatar');
    if (img && av && !av.querySelector('img')) {
      var im = new Image();
      im.className = 'nav-av-img';
      im.alt = '';
      im.style.width = '100%'; im.style.height = '100%'; im.style.objectFit = 'cover';
      im.onload = function () { av.innerHTML = ''; av.appendChild(im); };
      im.onerror = function () {}; /* keep the initial fallback already in place */
      im.src = img;
    }
  }
  addEventListener('DOMContentLoaded', mountNavAvatar);
  /* re-run once identity hydrates (pages dispatch appReady after backend load) */
  addEventListener('appReady', mountNavAvatar);
  document.addEventListener('appReady', mountNavAvatar);

  /* load post-load enhancements (daily-task fixes) once ready */
  function loadFixes() {
    if (document.getElementById('vision-fixes-js')) return;
    var s = document.createElement('script');
    s.id = 'vision-fixes-js';
    s.src = 'js/vision-fixes.js?v=2';
    s.defer = true;
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', loadFixes);
  else loadFixes();

  pageTransitions();
  addEventListener('DOMContentLoaded', () => { starfield(); reveals(); });

  V.ui = { $, $$, toast, countUp, reveals, starfield, scanVerify, amt, ready,
           parseDateSafe, daysSince, toFinite, plural, safeCount, mountNavAvatar };
})(window.VISION);
