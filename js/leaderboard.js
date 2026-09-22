/* ═══════════════════════════════════════════
   leaderboard.js — Rankings tabs + rendering
   - Existing tabs (friends/local/school/city) render via renderLB() — unchanged.
   - New "momentum" tab ranks by improvement + consistency via renderMomentum().
   Exposed on window.VISION.{renderLB, renderMomentum}.
═══════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  /* ── existing score-based ladders (unchanged data) ── */
  const ranks = {
    friends:[['01','M','Marcus',2840,true,2],['02','J','Jordan',2610,true,1],['03','Y','You',2390,'you',4],['04','S','Sofia',1980,false,-1],['05','D','Devin',1740,false,-2]],
    local:[['01','A','A. Reyes',5120,true,3],['02','K','K. Osei',4870,true,-1],['03','T','T. Lund',4410,true,2],['14','Y','You',2390,'you',7],['15','R','R. Vance',2330,false,-3]],
    school:[['01','P','P. Mori',6210,true,0],['02','L','L. Chen',5980,true,2],['03','N','N. Patel',5640,true,-1],['09','Y','You',2390,'you',5],['10','B','B. Falk',2280,false,-2]],
    city:[['01','W','W. Stone',9440,true,1],['02','I','I. Sokolov',9120,true,-2],['03','E','E. Marsh',8770,true,1],['41','Y','You',2390,'you',9],['42','G','G. Ito',2360,false,-1]]
  };

  /* ── Momentum League: ranked by weekly improvement + consistency, not raw score.
     [rank, avatar, name, tier, improvement%, xp, flag, delta] ── */
  const momentum = [
    ['01','A','Ava','Mythic',42,4820,true,3],
    ['02','J','Jayden','Legend',39,4430,true,1],
    ['03','A','Arjun','Diamond',35,4180,true,-1],
    ['04','M','Mara','Platinum',31,3870,false,2],
    ['05','S','Sora','Platinum',27,3540,false,0],
    ['84','Y','You','Gold II',18,2190,'you',6]
  ];

  /* delta as icon + text (never colour alone) */
  function deltaHTML(dlt) {
    if (dlt > 0) return `<span class="dlt u" aria-label="up ${dlt}">▲${dlt}</span>`;
    if (dlt < 0) return `<span class="dlt d" aria-label="down ${Math.abs(dlt)}">▼${Math.abs(dlt)}</span>`;
    return `<span class="dlt s" aria-label="no change">–</span>`;
  }

  /* existing renderer — logic unchanged, only delta extracted to helper */
  function renderLB(key) {
    const body = document.getElementById('lbBody');
    if (!body) return;
    body.classList.remove('is-momentum');
    body.innerHTML = ranks[key].map(([r, av, nm, sc, flag, dlt]) => {
      const cls = flag === 'you' ? 'you' : (flag === true ? 'top' : '');
      return `<div class="lb-row ${cls}"><div class="lr num">${r}${deltaHTML(dlt)}</div><div class="who"><div class="av">${av}</div><div class="nm">${nm === 'You' ? '' : nm}</div></div><div class="sc num">${sc.toLocaleString()}</div></div>`;
    }).join('');
  }

  /* momentum renderer — richer rows: tier badge + improvement + XP */
  function renderMomentum() {
    const body = document.getElementById('lbBody');
    if (!body) return;
    body.classList.add('is-momentum');
    body.innerHTML = momentum.map(([r, av, nm, tier, imp, xp, flag, dlt]) => {
      const cls = flag === 'you' ? 'you' : (flag === true ? 'top' : '');
      const tierCls = 'tier-' + tier.split(' ')[0].toLowerCase();
      return `<div class="lb-row mlb-row ${cls}">
        <div class="lr num">${r}${deltaHTML(dlt)}</div>
        <div class="who"><div class="av ${tierCls}">${av}</div><div class="ml-id"><div class="nm">${nm === 'You' ? '' : nm}</div><div class="ml-tier ${tierCls}">${tier}</div></div></div>
        <div class="ml-improve" aria-label="${imp} percent improvement this week"><span class="ml-imp-ico" aria-hidden="true">▲</span>+${imp}%</div>
        <div class="sc num">${xp.toLocaleString()}<small> XP</small></div>
      </div>`;
    }).join('');
  }

  V.renderLB = renderLB;
  V.renderMomentum = renderMomentum;

  /* ── tab wiring (click + keyboard) ── */
  const tabs = [...document.querySelectorAll('.rtabs button')];

  function selectTab(btn) {
    tabs.forEach(x => { x.classList.remove('on'); x.setAttribute('aria-selected', 'false'); x.tabIndex = -1; });
    btn.classList.add('on');
    btn.setAttribute('aria-selected', 'true');
    btn.tabIndex = 0;
    if (btn.dataset.rank === 'momentum') renderMomentum();
    else renderLB(btn.dataset.rank);
    // re-trigger the rank-movement chips animation
    document.querySelectorAll('#rankChips .rchip').forEach(c => { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); });
  }

  tabs.forEach((b, i) => {
    b.addEventListener('click', () => selectTab(b));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(i + dir + tabs.length) % tabs.length];
      next.focus();
      selectTab(next);
    });
  });
})(window.VISION);
