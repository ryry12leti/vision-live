/* Package 6 — Daily refresh / generation UI (extracted byte-exact from tasks-page.js).
   Owns the signed-in "Refresh tasks" button: the server-authoritative remaining-quota cache
   (refreshDayKey/get/setRefreshRemaining), the button state (setRefreshUI), and doRefresh
   (calls VISION.api.refreshTasks, re-renders). The server (consume_refresh_quota) is the
   source of truth for the daily limit. Loaded before tasks-page.js; BACKEND_TASKS / SIGNED_IN
   and render helpers resolve at call time from shared global scope. */
/* ================================================================
   DAILY "REFRESH TASKS" — signed-in only, 1/day (server-gated by
   consume_refresh_quota inside the generate-tasks Edge Function).
   ================================================================ */
/* Remaining refreshes today — the SERVER (consume_refresh_quota) is the source of
   truth; we cache its reported "remaining" per-day in localStorage so the button
   reflects it across reloads without pre-guessing the daily limit. Unknown (null)
   = never refreshed yet today → button is enabled and just says "Refresh". */
function refreshDayKey() {
  try { return 'vision_refresh_left_' + (VISION.core && VISION.core.today ? VISION.core.today() : new Date().toISOString().slice(0,10)); }
  catch(e) { return 'vision_refresh_left'; }
}
function getRefreshRemaining() {
  try { const v = localStorage.getItem(refreshDayKey()); return v === null ? null : Math.max(0, parseInt(v, 10) || 0); }
  catch(e) { return null; }
}
function setRefreshRemaining(n) {
  if (typeof n !== 'number' || isNaN(n)) return;
  try { localStorage.setItem(refreshDayKey(), String(Math.max(0, n))); } catch(e) {}
}
function setRefreshUI() {
  const btn = $('refreshBtn'), chip = $('refreshLeft'), lbl = $('refreshLbl');
  if (!btn || !chip) return;
  btn.classList.remove('is-spinning');
  if (!SIGNED_IN) { btn.hidden = true; chip.hidden = true; return; }   // backend-only feature
  btn.hidden = false; chip.hidden = false; if (lbl) lbl.textContent = 'Refresh';
  const left = getRefreshRemaining();
  if (left === 0) {
    btn.disabled = true; btn.style.opacity = '.45'; chip.textContent = 'Used up · resets tomorrow';
  } else if (left === null) {
    btn.disabled = false; btn.style.opacity = ''; chip.textContent = 'New task on demand';
  } else {
    btn.disabled = false; btn.style.opacity = ''; chip.textContent = left + ' refresh' + (left === 1 ? '' : 'es') + ' left today';
  }
}
async function doRefresh() {
  const btn = $('refreshBtn'), chip = $('refreshLeft'), lbl = $('refreshLbl');
  if (!btn || btn.disabled) return;
  if (!SIGNED_IN || !(VISION.api && VISION.api.refreshTasks)) { try { VISION.ui.toast('Sign in to refresh your tasks'); } catch(e){} return; }
  btn.disabled = true; btn.classList.add('is-spinning'); if (lbl) lbl.textContent = 'Refreshing…'; if (chip) chip.textContent = 'Generating a new task…';
  let r;
  try { r = await VISION.api.refreshTasks(); } catch(e) { r = { error: 'failed' }; }
  if (r && (r.ok || r.fallback)) {
    if (typeof r.remaining === 'number') setRefreshRemaining(r.remaining);
    if (Array.isArray(r.tasks)) BACKEND_TASKS = r.tasks;
    try { renderScoreStrip(); } catch(e){}
    renderTasks(getMissions(BACKEND_TASKS));
    try { VISION.ui.toast(r.fallback ? '<b>New task ready</b>' : '<b>Fresh task generated</b>'); } catch(e){}
  } else if (r && r.error === 'rate_limited') {
    setRefreshRemaining(0);
    try { VISION.ui.toast('<b>You’ve used today’s refreshes</b> · more tomorrow'); } catch(e){}
  } else if (r && r.error === 'clarification_required') {
    // The plan engine is not broken — it wants one diagnostic answer first.
    setRefreshUI();
    try { VISION.ui.toast('<b>One answer needed first</b> · answer the question on your dashboard'); } catch(e){}
    return;
  } else {
    setRefreshUI();   // re-enable
    // Show the reason the server actually gave rather than a blanket retry nudge.
    const why = (r && r.message) ? String(r.message) : 'try again in a moment';
    try { VISION.ui.toast('<b>Couldn’t refresh</b> · ' + why); } catch(e){}
    return;
  }
  setRefreshUI();
}
try { if ($('refreshBtn')) $('refreshBtn').addEventListener('click', doRefresh); } catch(e) {}
