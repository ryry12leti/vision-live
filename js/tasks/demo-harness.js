/* Package 6 — Local demo harness (extracted byte-exact from tasks-page.js).
   file:// or ?demo=1 ONLY. Seeds sample tasks and accepts proof locally so the
   verified-unlock sequence can be tried without a live backend. Guarded by
   TASK_DEMO; a no-op on the real https site (real backend tasks always win).
   Loaded before tasks-page.js: TASK_DEMO + seedDemoTasks are read by the page
   bootstrap at runtime, and this module owns the TASK_DEMO decl so its own
   load-time `if (TASK_DEMO)` wiring resolves it first. NEVER awards XP — the
   demo chain is purely presentational (basePts is a display estimate only). */

/* DEMO GATE — demo tasks, proof, points, rank and verdicts must never be
   reachable by an ordinary signed-in user on production.

   The previous comment here claimed this was "NEVER true on the live https
   site", but ?demo=1 was honoured on any host. It is now a request, not an
   authorisation: honoured only on a local origin (file:// or localhost/127.x).
   On any other host demo stays off until public.is_owner() — the server-side
   owner allowlist, granted to `authenticated` and evaluated with auth.uid() —
   confirms the account. No query parameter, localStorage value or frontend
   flag can forge that. */
var TASK_DEMO_LOCAL_ORIGIN = (function(){
  try {
    if (location.protocol === 'file:') return true;
    var h = String(location.hostname||'').toLowerCase();
    return h==='localhost' || h==='::1' || /^127\./.test(h) || /\.localhost$/.test(h);
  } catch(e){ return false; }
})();
var TASK_DEMO_REQUESTED = (function(){
  try { return location.protocol === 'file:' || /[?&]demo=1/.test(location.search); } catch(e){ return false; }
})();
var TASK_DEMO = TASK_DEMO_LOCAL_ORIGIN && TASK_DEMO_REQUESTED;

/* Owner elevation is server-verified and asynchronous. It can only ever turn
   demo ON for a confirmed owner; an ordinary user's synchronous answer above
   is already false and nothing here can change that. */
var TASK_DEMO_OWNER_CHECKED = false;
(function(){
  if (TASK_DEMO || !TASK_DEMO_REQUESTED) return;
  try {
    var sb = window.VISION && window.VISION.sb;
    if (!sb || typeof sb.rpc !== 'function') return;
    sb.rpc('is_owner').then(function(r){
      TASK_DEMO_OWNER_CHECKED = true;
      if (r && !r.error && r.data === true) {
        TASK_DEMO = true;
        try { document.documentElement.setAttribute('data-demo-owner','true'); } catch(e){}
      }
    }).catch(function(){ TASK_DEMO_OWNER_CHECKED = true; });
  } catch(e){}
})();

/* ================================================================
   LOCAL DEMO HARNESS — file:// or ?demo=1 only. Seeds 3 sample tasks
   and accepts proof locally so the verified-unlock sequence can be
   tried without a live backend. Guarded by TASK_DEMO; a no-op on
   the real https site (real backend tasks always take precedence).
   ================================================================ */
function demoTaskSeed() {
  // V3 staging chain + demo → the physical-camera test chain (all seven gated
  // exercises), so a tester can exercise the live engine with zero auth setup
  if (window.VISION_LIVE_V3_STAGING_CHAIN === true) {
    const mk = (i, title, must, active) => ({
      id: 'demo-v3-' + i, backend: true, activationStatus: active ? 'active' : 'queued',
      difficulty: 'medium', baseXp: 30, title: title,
      whyPersonalised: 'Live Proof V3 physical test task ' + i + ' of 7.',
      proofPrompt: 'A live camera session performing the exercise.',
      proofMustShow: must, recommended_proof_type: 'live'
    });
    return [
      mk(1, 'Do 10 dumbbell bicep curls (light weight)', 'You performing dumbbell curls on camera', true),
      mk(2, 'Do 10 dumbbell shoulder presses', 'You performing shoulder presses on camera'),
      mk(3, 'Do 10 lateral raises with dumbbells', 'You performing lateral raises on camera'),
      mk(4, 'Do 10 goblet squats', 'You performing goblet squats on camera'),
      mk(5, 'Do 10 push-ups with controlled form', 'You performing push-ups on camera'),
      mk(6, 'Do 10 bodyweight squats', 'You performing squats on camera'),
      mk(7, 'Hold a plank for 30 seconds', 'You holding a plank on camera')
    ];
  }
  return [
    { id:'demo-task-1', backend:true, activationStatus:'active', difficulty:'hard', baseXp:80,
      title:'Complete one 45-minute deep-focus study block — phone in another room',
      whyPersonalised:'Better grades come from uninterrupted reps, not longer hours. One clean block beats a scattered evening.',
      proofPrompt:'A photo of your study setup with a visible timer at 45:00 (or your notes at the end of the block).',
      proofMustShow:'Your workspace and a running/finished 45-minute timer' },
    { id:'demo-task-2', backend:true, activationStatus:'queued', difficulty:'medium', baseXp:45,
      title:'Rewrite your weakest topic from memory, then check it against your notes',
      whyPersonalised:'Active recall exposes the exact gaps a re-read hides — this is where your grade actually moves.',
      proofPrompt:'A photo of the page you wrote from memory, with the gaps you found marked.',
      proofMustShow:'A hand-written recall page with corrections marked' },
    { id:'demo-task-3', backend:true, activationStatus:'queued', difficulty:'easy', baseXp:20,
      title:'Plan tomorrow’s 3 priority study tasks before you sleep',
      whyPersonalised:'A decided morning removes the friction that kills follow-through.',
      proofPrompt:'A photo of your written plan — three concrete tasks with times.',
      proofMustShow:'Three dated, time-boxed tasks for tomorrow' }
  ];
}
function seedDemoTasks() {
  if (!TASK_DEMO) return;
  // never clobber a real backend that actually returned tasks
  if (SIGNED_IN && BACKEND_TASKS && BACKEND_TASKS.length) return;
  if (!window.__demoTasks) window.__demoTasks = demoTaskSeed();
  BACKEND_TASKS = window.__demoTasks;
  try { renderScoreStrip(); } catch(e) {}
  try { renderTasks(getMissions(BACKEND_TASKS)); } catch(e) {}
  // ensure the reveal-on-scroll content is visible in the local demo
  try { document.querySelectorAll('.reveal').forEach(function(el){ el.classList.add('in'); }); } catch(e) {}
}
function demoAcceptProof(mission) {
  if (!mission) return;
  const pts = basePts(mission.difficulty, mission.points);
  closeTaskDetail();
  const ready = Promise.resolve().then(function(){
    const list = window.__demoTasks || [];
    const i = list.findIndex(function(t){ return t.id === mission.id; });
    if (i >= 0) { list[i].done = true; list[i].activationStatus = 'accepted'; }
    const nx = list.find(function(t){ return t.activationStatus === 'queued'; });
    if (nx) nx.activationStatus = 'active';
    window.__demoDone   = (window.__demoDone   || 0) + 1;
    window.__demoPoints = (window.__demoPoints || 0) + pts;
    BACKEND_TASKS = list;
  });
  try { playVerifiedUnlock(pts, ready, mission); }
  catch(e) { ready.then(function(){ try { renderScoreStrip(); } catch(_){} renderTasks(getMissions(BACKEND_TASKS)); }); }
}
if (TASK_DEMO) {
  // run after the normal boot has settled so the demo set wins the render
  addEventListener('load', function(){ setTimeout(seedDemoTasks, 400); });
  setTimeout(seedDemoTasks, 1400);
}
