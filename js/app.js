/* ═══════════════════════════════════════════
   app.js — general page interactions (loads LAST)
   Loader, ambient light, reveals, goal state, proof tiles,
   simulate, scroll parallax, dashboard, toast, waitlist, dust.
   Owns shared helpers and runs the master init().
═══════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  /* ═══════════ LOADER ═══════════ */
  addEventListener('load', () => {
    setTimeout(() => {
      document.getElementById('loTitle').classList.add('in');
      setTimeout(() => endLoader(), 3600);
    }, 300);
  });
  function endLoader() {
    document.getElementById('loader').classList.add('done');
    document.getElementById('nav').classList.add('show');
    // stagger HUDs
    ['hTL','hTR','hBL','hBR'].forEach((id, i) => setTimeout(() => document.getElementById(id)?.classList.add('show'), 800 + i * 400));
  }

  /* ═══════════ AMBIENT LIGHT ═══════════ */
  const ambient = document.getElementById('ambient');
  let mx = innerWidth / 2, my = innerHeight * .4;
  addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    ambient.style.setProperty('--mx', mx + 'px');
    ambient.style.setProperty('--my', my + 'px');
  }, { passive: true });

  /* ═══════════ REVEAL OBSERVER ═══════════ */
  const rio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); } }), { threshold: .16 });
  document.querySelectorAll('.reveal').forEach(el => rio.observe(el));

  /* ═══════════ MANIFESTO WORD REVEAL ═══════════ */
  (function () {
    const el = document.getElementById('maniH');
    el.innerHTML = el.textContent.trim().split(/\s+/).map(w => `<span class="mw">${w}</span>`).join(' ');
    const words = [...el.querySelectorAll('.mw')];
    new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { words.forEach((w, i) => setTimeout(() => w.classList.add('lit'), i * 75)); o.disconnect(); } }), { threshold: .4 }).observe(el);
  })();

  /* ═══════════ WATCHING WORD REVEAL ═══════════ */
  (function () {
    const el = document.getElementById('watchH');
    el.innerHTML = el.textContent.trim().split(/\s+/).map(w => `<span class="ww">${w}</span>`).join(' ');
    const words = [...el.querySelectorAll('.ww')];
    new IntersectionObserver((es, o) => es.forEach(e => { if (e.isIntersecting) { words.forEach((w, i) => setTimeout(() => w.classList.add('lit'), i * 90)); o.disconnect(); } }), { threshold: .4 }).observe(el);
  })();

  /* ═══════════ STATE ═══════════ */
  const GOALS = ['discipline', 'fitness', 'money', 'study'];
  const state = { goals: { discipline: 0, fitness: 0, money: 0, study: 0 }, streaks: { discipline: 0, fitness: 0, money: 0, study: 0 } };
  const SKEY = 'vision_v2';
  const milestones = { 10: 'Momentum', 20: 'Consistency', 30: 'Discipline', 40: 'Strength', 50: 'Identity Shift', 60: 'Resolve', 70: 'Conviction', 80: 'Transformation', 90: 'Mastery', 100: 'Ascended' };
  let lastUnlock = 0;

  function save() { V.storage.write(SKEY, { g: state.goals, s: state.streaks, ts: Date.now() }); }
  function load() { const r = V.storage.read(SKEY); if (!r) return null; Object.assign(state.goals, r.g || {}); Object.assign(state.streaks, r.s || {}); return r; }
  function total() { return Math.round(GOALS.reduce((a, g) => a + state.goals[g], 0) / GOALS.length); }
  function futureScore() { return 430 + total() * 3 + Object.values(state.streaks).reduce((a, v) => a + v, 0); }

  /* ═══════════ ANIMATE NUMBER ═══════════ */
  function animNum(el, to, dur = 1100) {
    if (!el) return;
    const from = parseInt(el.textContent) || 0;
    el.textContent = to;  // immediate fallback
    const t0 = performance.now();
    (function s(t) { const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(from + (to - from) * e); if (p < 1) requestAnimationFrame(s); })(performance.now());
    setTimeout(() => { if (el) el.textContent = to; }, dur + 80);
  }

  /* ═══════════ RENDER ═══════════ */
  function render() {
    const t = total(), fs = futureScore();
    // goal bars
    GOALS.forEach(g => {
      const pct = state.goals[g];
      document.querySelectorAll(`[data-goalbar="${g}"]`).forEach(b => b.style.width = pct + '%');
      document.querySelectorAll(`[data-goalval="${g}"]`).forEach(n => n.textContent = pct);
    });
    // totals
    document.querySelectorAll('[data-total]').forEach(n => n.textContent = t);
    // phone + float cards
    animNum(document.getElementById('pScore'), fs);
    animNum(document.getElementById('pStreak'), Object.values(state.streaks).reduce((a, v) => a + v, 0));
    animNum(document.getElementById('pLbScore'), fs);
    animNum(document.getElementById('fcScore'), fs);
    animNum(document.getElementById('srScore'), fs);
    const pf = document.getElementById('pProgFill'); if (pf) pf.style.width = t + '%';
    const pv = document.getElementById('pStepVal'); if (pv) pv.textContent = t;
    // unlock
    const lvl = Math.floor(t / 10);
    if (lvl > lastUnlock && t > 0) {
      lastUnlock = lvl;
      showToast(`<b>New future unlocked</b> · ${t}% · ${milestones[lvl * 10] || ''}`);
    }
  }

  /* ═══════════ AWARD ═══════════ */
  function award(goal, pts) {
    state.goals[goal] = Math.min(100, state.goals[goal] + pts);
    state.streaks[goal]++;
    save(); render();
  }

  /* ═══════════ PROOF TILES ═══════════ */
  function runProof(tile) {
    if (tile.classList.contains('verifying')) return;
    const goal = tile.dataset.goal, action = tile.dataset.action;
    const txt = tile.querySelector('.pt-txt');
    tile.classList.remove('verified'); tile.classList.add('verifying');
    if (txt) txt.textContent = 'Saving privately…';
    setTimeout(() => {
      tile.classList.remove('verifying'); tile.classList.add('verified');
      if (txt) txt.innerHTML = `Saved privately · ${action} · <span class="amt up">8<i class="arw"></i></span>`;
      award(goal, 8);
      showToast(`<span class="amt up">8<i class="arw"></i></span> · ${action} · proof saved`);
      setTimeout(() => { tile.classList.remove('verified'); if (txt) txt.textContent = 'Saving privately…'; }, 2200);
    }, 1300);
  }
  document.querySelectorAll('.ptile').forEach(tile => {
    tile.addEventListener('click', () => runProof(tile));
    // keyboard-operable (role="button")
    tile.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runProof(tile); }
    });
  });

  /* real upload */
  const proofFile = document.getElementById('proofFile'); let pendingTile = null;
  document.querySelectorAll('.puse-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); pendingTile = btn.closest('.ptile'); proofFile.value = ''; proofFile.click(); });
  });
  proofFile.addEventListener('change', () => {
    const f = proofFile.files && proofFile.files[0]; if (!f || !pendingTile) return;
    const tile = pendingTile, img = tile.querySelector('.pprev'), url = URL.createObjectURL(f);
    img.onload = () => URL.revokeObjectURL(url); img.src = url; tile.classList.add('has-img');
    // small delay then trigger verify
    setTimeout(() => tile.click(), 50);
  });

  /* ═══════════ SIMULATE ═══════════ */
  document.getElementById('autoBtn').addEventListener('click', function () {
    this.disabled = true; this.style.opacity = .5;
    const seq = [...GOALS, ...GOALS, ...GOALS, 'discipline', 'fitness'];
    let n = 0;
    const iv = setInterval(() => {
      if (total() >= 100 || n >= seq.length) { clearInterval(iv); this.disabled = false; this.style.opacity = 1; return; }
      award(seq[n % seq.length], 9); n++;
    }, 340);
  });

  /* ═══════════ SCROLL: hero zoom + parallax ═══════════ */
  const heroSec = document.getElementById('top');
  const heroWrap = document.getElementById('heroWrap');
  const heroText = document.getElementById('heroText');
  const earnSec = document.getElementById('earn');
  const earnImg = document.getElementById('earnImg');
  const earnCopy = document.getElementById('earnCopy');
  let ticking = false;
  function onScroll() {
    // hero
    const hr = heroSec.getBoundingClientRect();
    const hp = Math.min(Math.max(-hr.top / (heroSec.offsetHeight - innerHeight), 0), 1);
    if (heroWrap) heroWrap.style.transform = `scale(${(1.06 + hp * 0.5).toFixed(3)})`;
    if (heroText) { heroText.style.opacity = (1 - hp * 1.2).toFixed(3); heroText.style.transform = `translateY(${hp * -60}px)`; }
    // earn parallax
    const er = earnSec.getBoundingClientRect();
    const ep = Math.min(Math.max(-er.top / (earnSec.offsetHeight - innerHeight), 0), 1);
    if (earnImg) earnImg.style.transform = `scale(${(1.06 + ep * 0.22).toFixed(3)}) translateY(${(ep - 0.5) * -30}px)`;
    if (earnCopy) { earnCopy.style.transform = `translateY(${(0.5 - ep) * 40}px)`; earnCopy.style.opacity = `${Math.sin(ep * Math.PI * 0.9 + 0.1)}`; }
    ticking = false;
  }
  addEventListener('scroll', () => { if (!ticking) { requestAnimationFrame(onScroll); ticking = true; } }, { passive: true });

  /* ═══════════ DASHBOARD — reveal floats + animate phone ═══════════ */
  const dashIO = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    ['fcA','fcB','fcC','fcD'].forEach((id, i) => setTimeout(() => document.getElementById(id)?.classList.add('show'), i * 180));
    // animate phone bars
    const pf = document.getElementById('pProgFill'); if (pf) setTimeout(() => pf.style.width = total() + '%', 300);
    animNum(document.getElementById('pScore'), futureScore(), 1400);
    animNum(document.getElementById('fcScore'), futureScore(), 1400);
    animNum(document.getElementById('srScore'), futureScore(), 1400);
    dashIO.disconnect();
  }), { threshold: .35 });
  dashIO.observe(document.getElementById('dash'));

  /* ═══════════ TOAST ═══════════ */
  let toastT;
  function showToast(msg) {
    const el = document.getElementById('toast'), txt = document.getElementById('toastTxt');
    txt.innerHTML = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2800);
  }

  /* ═══════════ EXPOSE SHARED HELPERS ═══════════ */
  V.animNum = animNum;
  V.showToast = showToast;
  V.state = state;
  V.total = total;
  V.futureScore = futureScore;

  /* ═══════════ INIT ═══════════ */
  (function () {
    const r = load();
    lastUnlock = Math.floor(total() / 10);
    render(); onScroll();
    if (r && total() > 0 && ((Date.now() - r.ts) / 36e5) >= 20) {
      setTimeout(() => showToast('Welcome back — log today\'s proof to keep your streak alive.'), 2400);
    }
    save();
    // recompute dashboard when revisited mid-session
    new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) render(); }), { threshold: .3 }).observe(document.getElementById('proof'));

  })();

  /* ═══════════ DUST PARTICLES ═══════════ */
  (function () {
    const c = document.getElementById('dust');
    if (!c) return;
    // no ambient motion when the user prefers reduced motion
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const x = c.getContext('2d');
    let w, h, p = [], raf = null, running = false;
    function rs() { w = c.width = innerWidth; h = c.height = innerHeight; } rs(); addEventListener('resize', rs);
    const N = Math.min(110, Math.floor(innerWidth / 13));
    for (let i = 0; i < N; i++) p.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.4 + .2, vx: (Math.random() - .5) * .08, vy: (Math.random() - .5) * .08, a: Math.random() * .45 + .04 });
    let sy = 0; addEventListener('scroll', () => sy = scrollY, { passive: true });
    function draw() {
      x.clearRect(0, 0, w, h);
      for (const q of p) {
        const dx = mx - q.x, dy = my - q.y, dist = Math.hypot(dx, dy) || 1;
        if (dist < 280) { q.vx += dx / dist * .0013; q.vy += dy / dist * .0013; }
        q.vx *= .99; q.vy *= .99; q.x += q.vx; q.y += q.vy;
        if (q.x < 0) q.x = w; if (q.x > w) q.x = 0; if (q.y < 0) q.y = h; if (q.y > h) q.y = 0;
        const py = ((q.y - sy * .024 * q.r) % h + h) % h;
        x.beginPath(); x.arc(q.x, py, q.r, 0, 7);
        x.fillStyle = `rgba(220,228,240,${q.a})`; x.fill();
      }
      raf = requestAnimationFrame(draw);
    }
    function start() { if (!running) { running = true; raf = requestAnimationFrame(draw); } }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = null; }
    // pause the loop when the tab is hidden (perf)
    document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
    start();
  })();
})(window.VISION);
