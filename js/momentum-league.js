/* ═══════════════════════════════════════════
   momentum-league.js — Momentum League section
   Demo-only: fills the XP bar on reveal and runs a short,
   premium rank-up preview. No backend. Reuses VISION.animNum.
   Exposed on window.VISION.momentum.
═══════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* current demo standing */
  const XP_NOW = 742, XP_NEXT = 900, RIVAL_GAP = 34;

  /* count up a number, deferring to the shared helper when present */
  function count(el, to) {
    if (!el) return;
    if (reduceMotion || !V.animNum) { el.textContent = to; return; }
    V.animNum(el, to, 900);
  }

  function fillBar(el, pct) {
    if (!el) return;
    el.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  /* fill the section's bars/numbers once it scrolls into view */
  function init() {
    const sec = document.getElementById('momentum-league');
    if (!sec) return;

    const xpFill   = document.getElementById('mlXpFill');
    const rivalBar = document.getElementById('mlRivalFill');

    const miniFills = [...sec.querySelectorAll('.ml-mini-fill')];
    const reveal = () => {
      fillBar(xpFill, (XP_NOW / XP_NEXT) * 100);
      // rival bar: how close "you" are to catching the rival (gap shrinks as it nears 100)
      fillBar(rivalBar, 100 - (RIVAL_GAP / 100) * 100 * 0.5);
      count(document.getElementById('mlXpNow'), XP_NOW);
      count(document.getElementById('mlImprove'), 18);
      count(document.getElementById('mlStreak'), 12);
      // near-win cards: each fills to its data-fill (staggered unless reduced motion)
      miniFills.forEach((el, i) => {
        const to = (+el.dataset.fill || 0) + '%';
        if (reduceMotion) el.style.width = to;
        else setTimeout(() => { el.style.width = to; }, 140 + i * 90);
      });
    };

    if (reduceMotion) { reveal(); return; }
    const io = new IntersectionObserver((entries, obs) => {
      entries.forEach(e => { if (e.isIntersecting) { setTimeout(reveal, 200); obs.disconnect(); } });
    }, { threshold: 0.3 });
    io.observe(sec);
  }

  /* short, subtle rank-up preview: XP fills to full, badge lifts/glows, label flips */
  function preview() {
    const btn   = document.getElementById('mlRankUp');
    const xpFill = document.getElementById('mlXpFill');
    const badge = document.getElementById('mlBadge');
    const label = document.getElementById('mlRankLabel');
    const note  = document.getElementById('mlUnlock');
    if (!btn) return;

    if (reduceMotion) {
      fillBar(xpFill, 100);
      badge && badge.classList.add('up');
      if (label) label.textContent = 'Gold I reached';
      if (note) note.textContent = 'Gold I badge unlocked';
      return;
    }

    btn.disabled = true;
    fillBar(xpFill, 100);                       // CSS transitions the fill
    if (label) label.textContent = 'Gold I reached';
    setTimeout(() => { badge && badge.classList.add('up'); }, 650);  // badge lift + glow
    setTimeout(() => { if (note) note.textContent = 'Gold I badge unlocked'; }, 950);

    // settle back to the demo's resting state so the preview is repeatable
    setTimeout(() => {
      badge && badge.classList.remove('up');
      fillBar(xpFill, (XP_NOW / XP_NEXT) * 100);
      if (label) label.textContent = 'Gold II';
      if (note) note.textContent = 'Gold I badge';
      btn.disabled = false;
    }, 3200);
  }

  // wire the button at parse time (element exists; handler runs later)
  document.getElementById('mlRankUp')?.addEventListener('click', preview);

  V.momentum = { init, preview };
})(window.VISION);
