/* Package 6 — Nutrition / Fuel-tracker UI (extracted verbatim from tasks-page.js).
   Owns ONLY the fuel card + meal-scan sheet rendering. Server authority is unchanged:
   all macros come from VISION.nutrition (the server vision read) — nothing is typed here.
   Loaded before tasks-page.js; these globals are called at runtime by the page bootstrap. */
/* ================================================================
   FUEL TRACKER — nutrition card (fitness/athlete users)
   ================================================================ */

function fuelGoalLabel(g){ return g === 'cut' ? 'Cutting' : g === 'bulk' ? 'Bulking' : 'Maintain'; }

function paintFuel(state){
  if (!state) return;
  const t = state.targets || {}, tot = state.totals || {}, pct = state.pct || {};
  setText('fuelGoalChip', fuelGoalLabel(t.goal));
  setText('fuelProteinT', t.protein || 0);
  setText('fuelKcalT', t.kcal || 0);
  setText('fuelCarbsV', tot.carbs || 0);
  setText('fuelFatsV', tot.fats || 0);
  const n = (state.meals || []).length;
  setText('fuelMealCount', n + (n === 1 ? ' meal' : ' meals'));
  // count-up the headline numbers
  try { VISION.ui.countUp($('fuelProteinV'), tot.protein || 0, 800); } catch(e){ setText('fuelProteinV', tot.protein||0); }
  try { VISION.ui.countUp($('fuelKcalV'), tot.kcal || 0, 800); } catch(e){ setText('fuelKcalV', tot.kcal||0); }
  // bars (next frame so the width transition animates)
  requestAnimationFrame(() => {
    const pf = $('fuelProteinFill'), kf = $('fuelKcalFill');
    if (pf) pf.style.width = (pct.protein || 0) + '%';
    if (kf) kf.style.width = (pct.kcal || 0) + '%';
  });
  const pm = $('fuelProteinMetric'), km = $('fuelKcalMetric');
  const pb = $('fuelProteinBar'), kb = $('fuelKcalBar');
  if (pm) pm.classList.toggle('is-hit', !!state.hitProtein);
  if (km) km.classList.toggle('is-hit', !!state.hitKcal);
  if (pb) pb.classList.toggle('is-hit', !!state.hitProtein);
  if (kb) kb.classList.toggle('is-hit', !!state.hitKcal);
  const banner = $('fuelHitBanner');
  if (banner) banner.classList.toggle('show', !!state.hit);
  // graceful degradation: when body stats are missing, targets are generic but the
  // card still works — surface a quiet, dismissible path to add stats for precision.
  const note = $('fuelStatsNote');
  if (note) note.style.display = (t.hasStats === false) ? 'block' : 'none';
}

async function refreshFuel(){
  try { const st = await VISION.nutrition.today(); paintFuel(st); return st; } catch(e){ return null; }
}

/* sheet view helpers — only one of status / result / reject is visible at a time */
function fsShow(which){
  const st = $('fsStatus'), rs = $('fsResult'), rj = $('fsReject');
  if (st) st.style.display = (which === 'status') ? 'block' : 'none';
  if (rs) rs.style.display = (which === 'result') ? 'block' : 'none';
  if (rj) rj.style.display = (which === 'reject') ? 'block' : 'none';
}
function fsReject(icon, title, sub){
  $('fsRejectIc').textContent = icon;
  $('fsRejectT').textContent = title;
  $('fsRejectS').textContent = sub;
  fsShow('reject');
}
function fsRenderResult(meal){
  setText('fsLabel', meal.label || 'Meal');
  setText('fsKcal', meal.kcal || 0);
  setText('fsProtein', meal.protein || 0);
  setText('fsCarbs', meal.carbs || 0);
  setText('fsFats', meal.fats || 0);
  const conf = Math.round(meal.confidence || 0);
  setText('fsConf', conf ? ('VISION read · ' + conf + '% confidence') : 'VISION read from your photo');
  fsShow('result');
}

/* upload → VISION reads the photo → show the read-only result (or reject non-food).
   The macros come ONLY from the server vision read; nothing is typed. */
async function openFuelSheet(photo){
  const sheet = $('fuelSheet'); if (!sheet) return;
  const prev = $('fsPreview');
  if (prev && typeof photo === 'string'){ prev.src = photo; prev.style.display = 'block'; }
  else if (prev){ prev.style.display = 'none'; }
  fsShow('status');
  $('fsStatus').innerHTML = '<span class="fs-spin"></span>Reading your plate…';
  sheet.classList.add('show');

  let res;
  try { res = await VISION.nutrition.logMeal(photo); }
  catch(e){ res = { error: 'failed' }; }
  // the sheet may have been dismissed while the model read the photo
  if (!sheet.classList.contains('show')) return;

  if (!res || res.error){
    fsReject('⚠️', 'Couldn’t reach the reader', 'Something went wrong. Check your connection and try another photo.');
    return;
  }
  const meal = res.meal || {};
  if (meal.status === 'failed'){
    fsReject('🍽️', 'That doesn’t look like a meal', 'Snap a clear photo of your food and VISION will read the calories and protein — nothing else counts.');
    return;
  }
  if (meal.status !== 'estimated'){
    fsReject('⏳', 'Couldn’t read it just yet', 'The reader was busy. Try the same photo again in a moment.');
    return;
  }
  // success — read-only result + live bars + award
  fsRenderResult(meal);
  const st = res.state || await refreshFuel();
  paintFuel(st);
  if (res.awardResult && res.awardResult.awarded){
    try { VISION.ui.toast('<b>+50 verified points</b> · fuel targets hit ◆'); } catch(e){}
  } else {
    try { VISION.ui.toast('<b>Meal logged</b> · ' + (meal.protein||0) + 'g protein, ' + (meal.kcal||0) + ' kcal'); } catch(e){}
  }
}
function closeFuelSheet(){ const s = $('fuelSheet'); if (s) s.classList.remove('show'); }

async function initFuel(){
  if (!(VISION && VISION.nutrition)) return;
  if (!VISION.nutrition.isFitnessUser()) return;
  const card = $('fuelCard'); if (!card) return;
  card.style.display = 'block';
  // wire controls (once)
  const fileInput = $('fuelFile'), logBtn = $('fuelLogBtn');
  if (logBtn && !logBtn._wired){ logBtn._wired = true; logBtn.addEventListener('click', () => fileInput && fileInput.click()); }
  if (fileInput && !fileInput._wired){
    fileInput._wired = true;
    fileInput.addEventListener('change', function(){
      const f = this.files && this.files[0]; if (!f) return;
      // signed-in path uploads the File; demo path needs a dataURL for preview/storage
      if (SIGNED_IN){ openFuelSheet(f); openFuelPreview(f); }
      else { const r = new FileReader(); r.onload = e => openFuelSheet(e.target.result); r.readAsDataURL(f); }
      this.value = '';
    });
  }
  const pick = () => fileInput && fileInput.click();
  if ($('fsScrim') && !$('fsScrim')._wired){ $('fsScrim')._wired = true; $('fsScrim').addEventListener('click', closeFuelSheet); }
  if ($('fsDone') && !$('fsDone')._wired){ $('fsDone')._wired = true; $('fsDone').addEventListener('click', closeFuelSheet); }
  if ($('fsRejectClose') && !$('fsRejectClose')._wired){ $('fsRejectClose')._wired = true; $('fsRejectClose').addEventListener('click', closeFuelSheet); }
  if ($('fsRetry') && !$('fsRetry')._wired){ $('fsRetry')._wired = true; $('fsRetry').addEventListener('click', () => { closeFuelSheet(); pick(); }); }
  await refreshFuel();
}
// signed-in: File has no string preview; render an object URL into the sheet image
function openFuelPreview(file){
  try { const prev = $('fsPreview'); if (prev){ prev.src = URL.createObjectURL(file); prev.style.display = 'block'; } } catch(e){}
}
