/* ═══════════════════════════════════════════════════════════════════════════
   vision-data.js — BACKEND-READY DATA LAYER  (load AFTER vision-core / vision-api)
   ---------------------------------------------------------------------------
   ONE rule for the whole app:
     • localStorage      = temporary MVP source of truth (works offline, today)
     • backend/Supabase  = real source of truth once a co-founder connects it

   Every function below:
     1. Tries the backend first  (VISION.api.<fn>) IF it exists AND the user is
        signed in (VISION.backend && authed).
     2. Falls back to localStorage if the backend is missing or fails.
     3. NEVER throws — a backend error can never break the app.

   ───────────────────────────────────────────────────────────────────────────
   PART 3 · BACKEND DATA CONTRACT  (what the co-founder must create in Supabase)
   ───────────────────────────────────────────────────────────────────────────
   users
     id · name · email · created_at

   goal_profiles
     id · user_id · main_goal · summarised_goal · goal_identity_phrase · why ·
     current_level · quit_trigger · push_style · available_time_per_day ·
     proof_type · milestone_timeframe · milestone_target · desire_level ·
     screen_time_minutes · fitness_included · goal_category · created_at · updated_at

   personality_profiles
     id · user_id · push_style · quit_trigger · desire_level · tone · intensity ·
     anti_quit_message · coaching_style · created_at · updated_at

   mission_profiles
     id · user_id · mission_difficulty · daily_time_budget · proof_requirement ·
     anti_distraction_mission · milestone_target · mission_style · created_at · updated_at

   daily_missions
     id · user_id · mission_date · title · description · category · points ·
     proof_required · proof_type · is_completed · completed_at · created_at

   proof_submissions
     id · user_id · mission_id · proof_type · proof_url · proof_text · reflection ·
     submitted_at · verified_status

   daily_scores
     id · user_id · score_date · daily_proof_score · missions_completed ·
     total_missions · proof_points · focus_minutes · reflection_points ·
     streak_bonus · created_at

   rank_history
     id · user_id · rank_score · current_rank · previous_rank ·
     seven_day_average · thirty_day_average · future_pace · created_at

   ───────────────────────────────────────────────────────────────────────────
   PART 4 · API / SUPABASE HANDOFF  (endpoints each helper maps to)
   ───────────────────────────────────────────────────────────────────────────
   POST /goal-profile        → saveGoalProfile()        create/update after onboarding
   GET  /goal-profile        → loadGoalProfile()         load on dashboard
   POST /personality-profile → savePersonalityProfile()
   GET  /personality-profile → loadPersonalityProfile()
   POST /mission-profile     → saveMissionProfile()
   GET  /mission-profile     → loadMissionProfile()
   POST /missions/generate   → saveDailyMissions()       persist generated missions
   GET  /missions/today      → loadDailyMissions()        today's missions
   POST /missions/complete   → markMissionComplete()      mark a mission done
   POST /proof-submit        → saveProofSubmission()      upload proof, tie to mission
   GET  /proof               → loadProofSubmissions()
   POST /daily-score         → saveDailyProofScore()      save Daily Proof Score
   GET  /daily-score         → loadDailyProofScores()
   GET  /rank                → loadRank()                 Rank Score, rank, future pace

   CO-FOUNDER: to go live, implement the matching VISION.api.* methods (commented
   with `BACKEND:` below). Nothing else in the front-end has to change.
═══════════════════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  /* localStorage keys — single source of truth for the MVP */
  const KEYS = {
    goalProfile:        'vision_goal_profile',
    personalityProfile: 'vision_personality_profile',
    missionProfile:     'vision_mission_profile',
    dailyMissions:      'vision_daily_missions',     // { date, missions:[...] }
    dailyScores:        'vision_daily_scores',       // { 'YYYY-MM-DD': {...} }
    proofSubmissions:   'vision_proof_submissions',  // [ {...}, ... ]
    rank:               'vision_rank_state'          // { rankScore, currentRank, ... }
  };

  /* Defer to the one source of truth (the user's saved IANA timezone) so this
     module cannot report a different day than the rows it reads were written
     under. The literal below is only reached if vision-core.js is absent. */
  const today = () => {
    try { if (window.VISION && VISION.core && VISION.core.today) return VISION.core.today(); } catch (e) {}
    try { return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }); } catch (e) { return new Date().toISOString().slice(0, 10); }
  };
  const lread = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lwrite = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} return v; };

  /* backend is "live" only when a real session exists. Safe + synchronous. */
  function live() {
    try {
      return !!(V.backend && V.api && V.auth && (V.auth.user || (V.auth.session && V.auth.session())));
    } catch (e) { return false; }
  }
  /* call an optional backend method; resolves null if it is missing or fails */
  async function tryApi(method, payload) {
    try {
      if (live() && V.api && typeof V.api[method] === 'function') {
        const r = await V.api[method](payload);
        return (r && r.error) ? null : r;
      }
    } catch (e) { /* never break the app on a backend error */ }
    return null;
  }

  /* ── GOAL PROFILE ──────────────────────────────────────────────────────── */
  async function saveGoalProfile(profile) {
    lwrite(KEYS.goalProfile, profile);                       // MVP store
    await tryApi('saveGoalProfile', profile);                // BACKEND: POST /goal-profile
    return profile;
  }
  async function loadGoalProfile() {
    const remote = await tryApi('getGoalProfile');           // BACKEND: GET /goal-profile
    if (remote) { lwrite(KEYS.goalProfile, remote); return remote; }
    return lread(KEYS.goalProfile);
  }

  /* ── PERSONALITY PROFILE ───────────────────────────────────────────────── */
  async function savePersonalityProfile(profile) {
    lwrite(KEYS.personalityProfile, profile);
    await tryApi('savePersonalityProfile', profile);         // BACKEND: POST /personality-profile
    return profile;
  }
  async function loadPersonalityProfile() {
    const remote = await tryApi('getPersonalityProfile');    // BACKEND: GET /personality-profile
    if (remote) { lwrite(KEYS.personalityProfile, remote); return remote; }
    return lread(KEYS.personalityProfile);
  }

  /* ── MISSION PROFILE ───────────────────────────────────────────────────── */
  async function saveMissionProfile(profile) {
    lwrite(KEYS.missionProfile, profile);
    await tryApi('saveMissionProfile', profile);             // BACKEND: POST /mission-profile
    return profile;
  }
  async function loadMissionProfile() {
    const remote = await tryApi('getMissionProfile');        // BACKEND: GET /mission-profile
    if (remote) { lwrite(KEYS.missionProfile, remote); return remote; }
    return lread(KEYS.missionProfile);
  }

  /* ── DAILY MISSIONS ────────────────────────────────────────────────────── */
  async function saveDailyMissions(missions) {
    const rec = { date: today(), missions: missions || [] };
    lwrite(KEYS.dailyMissions, rec);
    await tryApi('saveDailyMissions', rec);                  // BACKEND: POST /missions/generate
    return rec;
  }
  /* synchronous local read for first render; returns today's missions or [] */
  function loadDailyMissionsLocal() {
    const rec = lread(KEYS.dailyMissions);
    return (rec && rec.date === today() && Array.isArray(rec.missions)) ? rec.missions : [];
  }
  async function loadDailyMissions() {
    const remote = await tryApi('getDailyMissions', { date: today() }); // BACKEND: GET /missions/today
    if (remote && remote.missions) { lwrite(KEYS.dailyMissions, remote); return remote.missions; }
    return loadDailyMissionsLocal();
  }
  async function markMissionComplete(missionId, done) {
    await tryApi('markMissionComplete', { missionId, done: done !== false }); // BACKEND: POST /missions/complete
    try { if (V.proof && V.proof.setMissionDone) V.proof.setMissionDone(missionId, done !== false); } catch (e) {}
    return true;
  }

  /* ── PROOF SUBMISSIONS ─────────────────────────────────────────────────── */
  async function saveProofSubmission(proof) {
    const rec = Object.assign({ submitted_at: new Date().toISOString(), verified_status: 'pending' }, proof);
    const list = lread(KEYS.proofSubmissions) || [];
    list.push(rec); lwrite(KEYS.proofSubmissions, list);
    await tryApi('saveProofSubmission', rec);                // BACKEND: POST /proof-submit
    return rec;
  }
  async function loadProofSubmissions() {
    const remote = await tryApi('getProofSubmissions');      // BACKEND: GET /proof
    if (remote && Array.isArray(remote)) { lwrite(KEYS.proofSubmissions, remote); return remote; }
    return lread(KEYS.proofSubmissions) || [];
  }

  /* ── DAILY PROOF SCORES ────────────────────────────────────────────────── */
  async function saveDailyProofScore(score) {
    const map = lread(KEYS.dailyScores) || {};
    const date = (score && score.score_date) || today();
    map[date] = Object.assign({ score_date: date }, score);
    lwrite(KEYS.dailyScores, map);
    await tryApi('saveDailyProofScore', map[date]);          // BACKEND: POST /daily-score
    return map[date];
  }
  async function loadDailyProofScores() {
    const remote = await tryApi('getDailyProofScores');      // BACKEND: GET /daily-score
    if (remote) { lwrite(KEYS.dailyScores, remote); return remote; }
    // MVP: prefer this layer's store; else read the proof engine's dailyScores
    const own = lread(KEYS.dailyScores);
    if (own) return own;
    try { const p = V.proof && V.proof.ensureProfile && V.proof.ensureProfile(); return (p && p.dailyScores) || {}; }
    catch (e) { return {}; }
  }

  /* ── RANK ──────────────────────────────────────────────────────────────── */
  async function saveRank(rank) { lwrite(KEYS.rank, rank); await tryApi('saveRank', rank); return rank; }
  async function loadRank() {
    const remote = await tryApi('getRank');                  // BACKEND: GET /rank
    if (remote) { lwrite(KEYS.rank, remote); return remote; }
    return lread(KEYS.rank);
  }

  /* true once onboarding has produced a goal profile — used by the dashboard to
     decide whether generic fallback missions are allowed (they are NOT for an
     onboarded user). */
  function hasOnboardingProfile() {
    if (lread(KEYS.goalProfile)) return true;
    const ob = lread('vision_onboarding');
    return !!(ob && (ob.goalText || ob.primaryGoal || ob.goalProfile));
  }

  /* Canonical signed-in facts (single source for Home/Tasks/Analyst/Profile/Ranking).
     For signed-in: returns authoritative values derived from proofs + standing + awards.
     Falls back to core shapes for demo. All pages should prefer this over direct C. or old scores. */
  async function getCanonicalFacts() {
    try {
      if (live() && V.api && typeof V.api.getCanonicalAppState === 'function') {
        const s = await V.api.getCanonicalAppState();
        if (s) {
          const p = s.profile || {};
          const st = s.standing || {};
          const t = s.tasks || [];
          const active = s.currentTask || t.find(function (x) { return x.activationStatus === 'active'; }) || t.find(function (x) { return x.activationStatus === 'queued'; }) || null;
          return {
            profileGoal: p.primaryGoal || p.main_goal || p.goal || '',
            activeTask: active,
            verifiedPoints: st.verifiedPoints != null ? st.verifiedPoints : (s.xp && s.xp.totalXp) || 0,
            verifiedPointsToday: s.verifiedPointsToday != null ? s.verifiedPointsToday : (s.xp && s.xp.verifiedPointsToday) || 0,
            acceptedProofsToday: s.acceptedProofsToday != null ? s.acceptedProofsToday : (s.xp && s.xp.acceptedProofsToday) || 0,
            proofDays: st.proofDays != null ? st.proofDays : 0,
            hardTasks: st.hardTasks != null ? st.hardTasks : 0,
            standing: st,
            tasks: t
          };
        }
      }
    } catch (e) { /* fall through to demo */ }
    // Demo / fallback: use core shapes (best effort)
    try {
      const C = V.core || {};
      const ob = (C.getOnboarding && C.getOnboarding()) || {};
      const xp = (C.getXp && C.getXp()) || {};
      const proofs = (C.getProofs && C.getProofs()) || [];
      const today = (typeof C.today === 'function' ? C.today() : new Date().toISOString().slice(0,10));
      const todayProofs = proofs.filter(function (p) { return p.date === today; });
      const acceptedToday = todayProofs.length; // demo has no 'decision', all count
      return {
        profileGoal: ob.goalText || ob.primaryGoal || ob.goal || '',
        activeTask: null,
        verifiedPoints: xp.totalXp || 0,
        verifiedPointsToday: xp.todayXp || 0,
        acceptedProofsToday: acceptedToday,
        proofDays: new Set(proofs.map(function (p){return p.date;})).size,
        hardTasks: 0,
        standing: (C.getPercentile && C.getPercentile && C.getPercentile()) || null,
        tasks: (C.getTasks && C.getTasks()) || []
      };
    } catch (e2) { return null; }
  }

  V.data = {
    KEYS,
    saveGoalProfile, loadGoalProfile,
    savePersonalityProfile, loadPersonalityProfile,
    saveMissionProfile, loadMissionProfile,
    saveDailyMissions, loadDailyMissions, loadDailyMissionsLocal, markMissionComplete,
    saveProofSubmission, loadProofSubmissions,
    saveDailyProofScore, loadDailyProofScores,
    saveRank, loadRank,
    hasOnboardingProfile, live,
    getCanonicalFacts: getCanonicalFacts
  };
})(window.VISION);
