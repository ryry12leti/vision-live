/* Extracted verbatim from the tasks.html inline <script> (Package 3 modularisation).
   Behaviour-preserving: same code, same load position (after all VISION modules),
   now cacheable + no longer embedded in the HTML file. Further decomposition into
   js/tasks/* and js/proof/* modules should follow with per-module browser QA. */
try {
  const previewHost = /^vision-[a-z0-9-]+-mdhindsa787-9414s-projects\.vercel\.app$/.test(location.hostname);
  const localHost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const isolatedBackend = window.VISION_LIVE_V2_TEST_BACKEND === true;
  window.VISION_LIVE_V2 = isolatedBackend && (previewHost || localHost) && new URLSearchParams(location.search).get('live_v2') === '1';
  // Live Proof V3 is the production engine: fail-closed, pose-model-mandatory,
  // server-authoritative. The legacy motion path can never accept a session.
  window.VISION_LIVE_V3 = true;
  // The STAGING CHAIN (signed-out ?demo=1 test tasks + staging-only exercises)
  // remains preview/local-only — it must never run on production hosts.
  window.VISION_LIVE_V3_STAGING_CHAIN = (previewHost || localHost) && new URLSearchParams(location.search).get('live_v3') === '1';
} catch(e) { window.VISION_LIVE_V2 = false; window.VISION_LIVE_V3 = true; window.VISION_LIVE_V3_STAGING_CHAIN = false; }
/* ================================================================
   TASKS PAGE — using the same VISION system as dashboard_updated.html
   Safe: every block is wrapped in try/catch.
   VISION_BOOT.ok() is ALWAYS called, even on error.
   ================================================================ */

/* Shared primitives now live in js/tasks/dom-helpers.js (loaded first):
   $/$$/setText/safeGet + prefersReducedMotion/wait. The local demo harness
   (TASK_DEMO + demoTaskSeed/seedDemoTasks/demoAcceptProof) lives in
   js/tasks/demo-harness.js, loaded before this bootstrap. */

/* ================================================================
   TASKS PAGE — shared page state + boot coordination
   ================================================================ */


let D = { task: null, fileObj: null, file: false, submitting: false, progression: null, adaptation: null, proofType: 'photo', poster: null, coachSummary: null, liveSessionId: null, telemetryStarted: false, telemetryFinal: false };





var BACKEND_TASKS = null;
let SIGNED_IN = false;




/* Owner proof-QA is deliberately fail-closed. Query parameters only request
   the UI; the authenticated database RPC is the sole authority. Keeping the
   result on VISION lets the diagnostics module make a synchronous decision
   when a Live session starts without ever inspecting email or profile data. */
async function initProofQaAccess(){
  try {
    const qs = new URLSearchParams(location.search);
    const requested = qs.get('proof_qa') === '1' && qs.get('diag') === '1';
    VISION.proofQaAuthorized = false;
    VISION.proofQaStatus = { authenticated: true, is_admin: false };
    if (!requested || !(VISION.api && VISION.api.getProofQaStatus)) return false;
    const status = await VISION.api.getProofQaStatus();
    const authorised = !!(status && status.authenticated === true && status.is_admin === true);
    VISION.proofQaStatus = {
      authenticated: !!(status && status.authenticated),
      is_admin: authorised,
      environment: status && status.environment ? String(status.environment) : null
    };
    VISION.proofQaAuthorized = authorised;
    return authorised;
  } catch(e) {
    try { VISION.proofQaAuthorized = false; } catch(ee) {}
    return false;
  }
}

/* ================================================================
   INIT — boot-guard safe, always calls VISION_BOOT.ok()
   ================================================================ */
addEventListener('DOMContentLoaded', async () => {

  /* 1. start the boot watchdog */
  try { if (window.VISION_BOOT) VISION_BOOT.watch(10000); } catch(e) {}

  /* 2. demo mode renders local missions immediately; backend mode shows a loading
        skeleton so a signed-in user never sees (or gets stuck on) demo tasks. */
  try { renderScoreStrip(); } catch(e) {}
  let paintedFromCache = false;
  if (VISION && VISION.backend) {
    // Optimistic first paint: if a prior load this same day cached the real task
    // list, render it instantly so a warm reload skips the shimmer skeleton.
    // hydrateBackendTasks() below still runs and reconciles with fresh data.
    try {
      const dk = (VISION.core && VISION.core.today) ? VISION.core.today() : new Date().toISOString().slice(0,10);
      const raw = localStorage.getItem('vision_tasks_render_cache');
      const cached = raw ? JSON.parse(raw) : null;
      if (cached && cached.date === dk && cached.tasks && cached.tasks.length) {
        renderTasks(getMissions(cached.tasks));
        paintedFromCache = true;
      }
    } catch(e) {}
    if (!paintedFromCache) renderTasksLoading();
    // safety net (DEMO/logged-out only): a signed-in user's skeleton is owned by the
    // blocking LLM generation (which can take ~15-28s), so this must NOT swap in a
    // demo/empty set mid-generation. It only rescues the logged-out path.
    setTimeout(() => { if (!BACKEND_TASKS && !SIGNED_IN) { try { renderTasks(getMissions(null)); } catch(e) {} } }, 6000);
  } else {
    let localMissions = FALLBACK_MISSIONS;
    try { localMissions = getMissions(null); } catch(e) {}
    renderTasks(localMissions);
  }

  /* 3. attempt backend hydration */
  try {
    if (VISION && VISION.backend) {
      const A = VISION.auth;
      // V3 staging physical-test chain: on preview/localhost hosts with the
      // staging-chain flag, ?demo=1 runs signed-out instead of bouncing to
      // login. That flag can never be true on production hosts, so production
      // ?demo=1 still requires a real session.
      const v3DemoChain = window.VISION_LIVE_V3_STAGING_CHAIN === true && TASK_DEMO;
      const sess = v3DemoChain ? null : await A.requireOnboarded('login.html', 'onboarding.html');
      if (sess) {
        SIGNED_IN = true;
        await initProofQaAccess();
        try { if (VISION.proofQa) VISION.proofQa.mount(); } catch(e) {}
        // The loading skeleton is a successful first paint — clear the boot watchdog
        // and reveal the page NOW, before the ~15-28s blocking generation, so the
        // boot-guard "taking too long" banner never fires mid-generation.
        try { if (window.VISION_BOOT) VISION_BOOT.ok(); } catch(e) {}
        try { VISION.ui.ready(); } catch(e) {}
        // Skip the "Building…" flash when we already painted real cached tasks —
        // a warm reload shouldn't imply a regeneration is happening.
        if (!paintedFromCache) { try { setPersonalisingBanner('pending'); } catch(e) {} }  // "Building…" during the blocking first-load generation
        await hydrateBackendTasks(false);
      } else if (v3DemoChain) {
        /* V3 staging test chain — render the seed directly so a later local
           fallback render can never race/overwrite it */
        try { seedDemoTasks(); } catch(e) {}
      } else {
        /* not a backend session after all → show local demo tasks */
        let localMissions = FALLBACK_MISSIONS;
        try { localMissions = getMissions(null); } catch(e) {}
        renderTasks(localMissions);
      }
    }
  } catch(e) {
    /* backend path errored before sign-in resolved — fall back to local render */
    if (!SIGNED_IN) { try { renderTasks(getMissions(null)); } catch(ee) {} }
  }
  try { VISION.ui.ready(); } catch(e) {}  // hold skeleton until REAL data is painted (backend hydrate or demo) — no 0s flash

  /* 4. analytics (non-blocking) */
  try { VISION.analytics.track('tasks_view'); } catch(e) {}

  /* 4b. fuel tracker (fitness/athlete users only) */
  try { initFuel(); } catch(e) {}

  /* 5. ALWAYS signal boot complete */
  try { if (window.VISION_BOOT) VISION_BOOT.ok(); } catch(e) {}

  /* 6. signal app-ready for ask-vision & other modules */
  try { document.dispatchEvent(new Event('appReady')); } catch(e) {}
});

/* grok background upgrade finished → swap the richer tasks in seamlessly (no reload) */
addEventListener('vision:tasks-upgraded', async () => {
  if (!SIGNED_IN) return;
  try {
    BACKEND_TASKS = await VISION.api.getTasks();
    renderScoreStrip();
    renderTasks(getMissions(BACKEND_TASKS));   // renderTasks hides the "personalising" pill
  } catch (e) {}
});

// Generation returned fallback / errored → surface the retry pill (only while there's
// no real task on screen; a later success clears it via renderTasks).
addEventListener('vision:tasks-upgrade-failed', () => {
  if (!SIGNED_IN || SEED_IN_FLIGHT) return;
  try { if (noActionableMission(getMissions(BACKEND_TASKS))) setPersonalisingBanner('failed'); } catch (e) {}
});

// Manual retry: clear the failure cooldown and force a fresh blocking generation.
addEventListener('DOMContentLoaded', () => {
  const retry = $('pbRetry'); if (!retry) return;
  retry.addEventListener('click', async () => {
    if (!SIGNED_IN || !(VISION && VISION.api && VISION.api.regenerateTasksForCurrentProfile)) return;
    if (SEED_IN_FLIGHT) return;
    retry.disabled = true;
    SEED_IN_FLIGHT = true;
    setPersonalisingBanner('pending');
    try { renderTasksLoading(); } catch (e) {}
    try { if (VISION.api.clearGenerationCooldown) VISION.api.clearGenerationCooldown(); } catch (e) {}
    let res = null;
    try { res = await VISION.api.regenerateTasksForCurrentProfile({ reason: 'manual_retry', bypassManualQuota: true, force: true }); } catch (e) {}
    SEED_IN_FLIGHT = false;
    if (res && res.ok && res.tasks && res.tasks.length) {
      setPersonalisingBanner('hide');
      try { BACKEND_TASKS = await VISION.api.getTasks(); } catch (e) {}
      try { renderScoreStrip(); } catch (e) {}
      try { renderTasks(getMissions(BACKEND_TASKS)); } catch (e) {}
    } else if (res && res.error === 'clarification_required') {
      // Not a failure: the generation gate wants one diagnostic answer first.
      // The answer form lives on the dashboard, so say that instead of showing
      // a generic "couldn't load" and looping the user through more retries.
      renderPlanBlocked(
        'Your Analyst needs one answer first',
        (res.question && res.question.text) || 'Answer the question on your dashboard to unlock today’s move.',
        'dashboard.html'
      );
      setPersonalisingBanner('hide');
    } else {
      renderTasksError(res && res.message);
      setPersonalisingBanner('failed');
    }
  });
});

/* live updates from proof modal on dashboard / other pages.
   Signed-in users must NEVER be flipped back to local/demo missions — re-read the
   backend tasks instead (getMissions(null) renders the local fallback set). */
async function rerenderTasksLive() {
  try { renderScoreStrip(); } catch(e) {}
  if (SIGNED_IN && VISION && VISION.api && VISION.api.getTasks) {
    try { BACKEND_TASKS = await VISION.api.getTasks(); } catch(e) {}
    try { if (VISION.api.getDailyProgression) D.progression = await VISION.api.getDailyProgression(); } catch(e) {}
    try { renderTasks(getMissions(BACKEND_TASKS)); } catch(e) {}
    return;
  }
  try { renderTasks(getMissions(null)); } catch(e) {}
}
addEventListener('vision:proof-logged', () => { rerenderTasksLive(); });
addEventListener('storage', e => {
  if (e.key && (e.key.indexOf('vision') === 0 || e.key === 'visionProfile')) { rerenderTasksLive(); }
});
