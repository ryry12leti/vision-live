/* ============================================================================
   VISION · Daily Proof Engine  (self-contained, localStorage-only layer)
   ----------------------------------------------------------------------------
   Implements the proof-based future system that sits *on top of* the existing
   vision-core engine. It owns two scores and never touches backend state:

     • Daily Proof Score   — today only. "How much proof-backed action today?"
     • VISION Rank Score    — 30-day average of Daily Proof Scores.

   Philosophy:  Claims don't build rank. Proof does.
   All state lives in localStorage under `visionProfile`.
   Exposed as window.VISION.proof.
   ========================================================================== */
(function () {
  'use strict';
  const KEY = 'visionProfile';

  /* ----- date helpers ------------------------------------------------------ */
  const MS_PER_DAY = window.VISION && window.VISION.core && window.VISION.core.MS_PER_DAY || 864e5;
  const today = () => window.VISION && window.VISION.core ? window.VISION.core.today() : new Date().toISOString().slice(0, 10);
  function addDays(iso, n) { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / MS_PER_DAY); }

  function read() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function write(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} return p; }

  /* ----- seed the profile from existing onboarding ------------------------- */
  function onboarding() {
    try { if (window.VISION && VISION.core && VISION.core.getOnboarding) return VISION.core.getOnboarding() || {}; } catch (e) {}
    return {};
  }
  function goalText(ob) {
    ob = ob || onboarding();
    return (ob.goalText || ob.primaryGoal || ob.goalDetail ||
      (ob.goalAnalysis && ob.goalAnalysis.rawGoal) ||
      localStorage.getItem('vision_main_goal') || '').toString();
  }

  function ensureProfile() {
    let p = read();
    const ob = onboarding();
    if (!p) {
      p = {
        name: ob.name || '',
        goal: goalText(ob),
        arena: ob.arena || '',
        goalDetail: ob.goalDetail || ob.why || '',
        timeline: ob.timeline || ob.milestone || '',
        fixedDate: ob.fixedDate || '',
        bodyStats: { heightCm: ob.heightCm || null, weightKg: ob.weightKg || null, age: ob.age || null },
        distraction: ob.distraction || ob.distractionOther || '',
        intensity: ob.intensity || '',
        proofUploaded: false,
        proofType: '',
        startDate: today(),
        streak: 0,
        lastActiveDate: '',
        dailyScores: {},
        visionRankScore: 0
      };
      write(p);
    } else if (!p.goal && goalText(ob)) {
      p.goal = goalText(ob); write(p);
    }
    /* keep the premium-flow Goal Profile fields in sync (PART 11) so missions,
       difficulty, proof requirement and personality always reflect onboarding */
    const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const gp = readJSON('vision_goal_profile') || {};        // goalProfile
    const mp = readJSON('vision_mission_profile') || {};      // missionProfile
    const pp = readJSON('vision_personality_profile') || {};  // personalityProfile
    let dirty = false;
    const sync = (k, v) => { if (v != null && v !== '' && p[k] !== v) { p[k] = v; dirty = true; } };
    sync('pushStyle',      ob.pushStyle      || gp.pushStyle      || pp.pushStyle);
    sync('currentLevel',   ob.currentLevel   || ob.level || gp.currentLevel   || mp.missionDifficulty);
    sync('availableTime',  ob.availableTime  || gp.availableTimePerDay || mp.dailyTimeBudget);
    sync('proofRequirement', ob.proofType    || gp.proofType      || mp.proofRequirement);
    sync('quitTrigger',    ob.quitTrigger    || gp.quitTrigger    || pp.quitTrigger || p.distraction);
    sync('milestone',      ob.milestone      || gp.milestoneTimeframe || mp.milestoneTarget);
    if (dirty) write(p);
    return p;
  }

  /* ----- path detection (mirrors the spec's keyword routing) --------------- */
  function pathOf(p) {
    const g = ((p && p.goal) || goalText()).toLowerCase();
    if (/(football|soccer|athlete|sport|cricket|basketball|tennis|rugby|boxing|mma)/.test(g)) return 'athlete';
    if (/(gym|muscle|body|fitness|lean|weight|abs|strength|lift)/.test(g)) return 'fitness';
    if (/(business|agency|money|website|sales|entrepreneur|startup|client|brand|freelance|revenue)/.test(g)) return 'founder';
    if (/(doctor|medicine|study|exam|school|atar|nursing|degree|university|college|test|grade)/.test(g)) return 'academic';
    return 'custom';
  }
  const PATH_LABEL = { athlete: 'Athlete', fitness: 'Fitness', founder: 'Founder', academic: 'Academic', custom: 'Custom' };

  /* ----- personalised daily goals ----------------------------------------- */
  function generateDailyGoals(p) {
    p = p || ensureProfile();
    // category intelligence: missions inferred from the user's own goal language
    if (window.VISION_AI && VISION_AI.generateMissions) {
      try {
        const ob2 = onboarding();
        const ms = VISION_AI.generateMissions({
          goal: p.goal || goalText(ob2),
          skill: ob2.selectedSkill || localStorage.getItem('vision_selected_skill') || '',
          fitness: !!ob2.fitnessIncluded,
          level: p.currentLevel || ob2.currentLevel || ob2.level || '',
          availableTime: p.availableTime || ob2.availableTime || null,
          proofType: p.proofRequirement || ob2.proofType || '',
          quitTrigger: p.quitTrigger || ob2.quitTrigger || p.distraction || ''
        });
        if (ms && ms.length) return ms.slice(0, 5).map((g, i) => ({ id: 'g' + i, points: i === 0 ? 25 : 20, ...g }));
      } catch (e) {}
    }
    const path = pathOf(p);
    const SETS = {
      athlete: [
        { title: '30 min skill work', desc: 'Build touch, control, and confidence.', category: 'Skill', proof: 'Training photo, timer screenshot, or notes.' },
        { title: 'Conditioning block', desc: 'Sprints, endurance, or strength. Body keeps the score.', category: 'Conditioning', proof: 'Workout or timer screenshot.' },
        { title: 'Recovery or tactical study', desc: 'Stretch, sleep prep, or study one match.', category: 'Recovery', proof: 'Notes photo or video timestamp.' }
      ],
      fitness: [
        { title: 'Complete today’s workout', desc: 'The session you scheduled. No negotiation.', category: 'Training', proof: 'Gym mirror photo or app screenshot.' },
        { title: 'Hit protein / steps target', desc: 'Fuel and movement decide the result.', category: 'Nutrition', proof: 'Tracker or steps screenshot.' },
        { title: 'Recovery & mobility', desc: '10 min mobility or an early night.', category: 'Recovery', proof: 'Notes photo or timer screenshot.' }
      ],
      founder: [
        { title: 'Contact 5 leads', desc: 'Future clients do not appear by themselves.', category: 'Outreach', proof: 'Screenshot of sent messages.' },
        { title: 'Build / improve one asset', desc: 'Ship one real thing — page, offer, or feature.', category: 'Build', proof: 'Screenshot of the work.' },
        { title: 'Learn or practice sales', desc: '20 min studying how to sell or market.', category: 'Skill', proof: 'Notes photo or course screenshot.' }
      ],
      academic: [
        { title: '60 min deep study', desc: 'Protect one serious, distraction-free block.', category: 'Study', proof: 'Timer screenshot or notes photo.' },
        { title: 'Practice questions', desc: 'Test recall, not just recognition.', category: 'Practice', proof: 'Photo of worked problems.' },
        { title: 'Revise a weak topic', desc: 'Attack what scares you, not what’s easy.', category: 'Revision', proof: 'Notes photo or app screenshot.' }
      ],
      custom: [
        { title: 'One deep work block', desc: 'Protect 45–60 focused minutes on what matters.', category: 'Focus', proof: 'Timer screenshot or notes photo.' },
        { title: 'One skill-building action', desc: 'Get measurably better at the core skill.', category: 'Skill', proof: 'Screenshot or photo of the work.' },
        { title: 'One proof / reflection action', desc: 'Capture today so future you can see it.', category: 'Proof', proof: 'Any screenshot or photo.' }
      ]
    };
    const goals = SETS[path].slice();
    // fitness add-on: if onboarding included fitness alongside a non-fitness goal
    const ob = onboarding();
    if (ob && ob.fitnessIncluded && path !== 'fitness' && path !== 'athlete') {
      goals.push({ title: 'Train your body · 20–30 min', desc: 'You chose to build the body too.', category: 'Fitness', proof: 'Workout photo or app screenshot.' });
    }
    // goal language: make the custom path speak the user's own goal
    const g = (p.goal || '').trim();
    if (path === 'custom' && g) {
      goals[0] = { ...goals[0], title: 'One deep work block on “' + (g.length > 34 ? g.slice(0, 34) + '…' : g) + '”' };
    }
    return goals.slice(0, 5).map((gl, i) => ({ id: 'g' + i, points: i === 0 ? 25 : 20, ...gl }));
  }

  /* ----- per-day mission completion (localStorage, resets each new day) ---- */
  function missionStore(p) {
    p = p || ensureProfile();
    if (!p.missions || p.missions.date !== today()) { p.missions = { date: today(), done: {} }; write(p); }
    return p.missions;
  }
  function getMissions() {
    const p = ensureProfile();
    const m = missionStore(p);
    return generateDailyGoals(p).map(g => ({ ...g, done: !!m.done[g.id] }));
  }
  function setMissionDone(id, done) {
    const p = ensureProfile();
    const m = missionStore(p);
    m.done[id] = !!done;
    write(p);
    try { dispatchEvent(new CustomEvent('vision:mission-toggled', { detail: { id, done: !!done } })); } catch (e) {}
    return m.done;
  }

  /* ----- reflection memory -------------------------------------------------- */
  function getReflections() {
    const p = ensureProfile();
    const ds = p.dailyScores || {};
    return Object.keys(ds).filter(d => ds[d].reflectionText).sort()
      .map(d => ({ date: d, text: ds[d].reflectionText }));
  }

  /* ----- momentum / loss-aversion state ------------------------------------ */
  function momentumState() {
    const p = ensureProfile();
    refreshStreak(p);
    const t = today();
    const ds = p.dailyScores || {};
    const todayLogged = !!ds[t];
    if (todayLogged) {
      if (p.streak >= 7) return { label: 'Momentum Strong', risk: false };
      if (p.streak >= 4) return { label: 'Locked In', risk: false };
      if (p.streak >= 2) return { label: 'Momentum Building', risk: false };
      return { label: 'Momentum Active', risk: false };
    }
    if (p.streak >= 1) return { label: 'Streak At Risk', risk: true };
    return { label: 'No Proof Yet', risk: true };
  }

  /* ----- memory insights: emotional continuity from stored history --------- */
  function memoryInsights() {
    const p = ensureProfile();
    const ds = p.dailyScores || {};
    const refl = getReflections();
    const days = Object.keys(ds).sort();
    const chips = [];
    const since = p.startDate ? daysBetween(p.startDate, today()) : 0;
    if (since >= 1) chips.push('Goal set ' + since + 'd ago');
    if (refl.length) chips.push(refl.length + ' reflection' + (refl.length > 1 ? 's' : ''));
    if (days.length >= 3) {
      let bestAvg = -1, bestEnd = null;
      days.forEach(d => {
        const w = days.filter(x => x <= d && daysBetween(x, d) < 7);
        const avg = w.reduce((s, x) => s + (ds[x].dailyProofScore || 0), 0) / w.length;
        if (avg > bestAvg) { bestAvg = avg; bestEnd = d; }
      });
      if (bestEnd) {
        const ago = daysBetween(bestEnd, today());
        chips.push('Strongest week · ' + (ago <= 0 ? 'now' : ago + 'd ago'));
      }
    }
    let quote = null;
    if (refl.length) {
      const old = refl.filter(r => daysBetween(r.date, today()) >= 7);
      const pick = old.length ? old[old.length - 1] : refl[refl.length - 1];
      quote = { ...pick, ago: daysBetween(pick.date, today()) };
    }
    return { chips, quote };
  }

  /* ----- scoring ----------------------------------------------------------- */
  /* proof strength caps: Text 20 · Screenshot 60 · Video 80 (legacy levels kept) */
  const PROOF = { Text: 20, Screenshot: 60, Video: 80, Claimed: 45, Reflected: 55, Shown: 80 };
  function computeDailyScore({ goalsCompleted = 0, total = 3, proofLevel = 'Claimed', streak = 0, bonusCompleted = false }) {
    let points = Math.round((Math.min(goalsCompleted, total) / Math.max(1, total)) * 60);
    let cap = PROOF[proofLevel] || 45;
    if (proofLevel === 'Shown') {
      points += 16;
      if (streak >= 2) { points += 12; cap = 90; }
      if (bonusCompleted) { points += 4; cap = Math.max(cap, 95); }
    } else if (proofLevel === 'Reflected') {
      points = Math.max(points, 40);
    }
    return Math.max(0, Math.min(cap, points));
  }
  function scoreMessage({ goalsCompleted = 0, proofLevel = 'Claimed', streak = 0, bonusCompleted = false }) {
    if (proofLevel === 'Text') return 'Words logged. Proof still unseen.';
    if (proofLevel === 'Screenshot') return 'Screenshot accepted. Video proof scores higher.';
    if (proofLevel === 'Video') return bonusCompleted ? 'Elite day. Detailed proof on record.' : 'Strong proof. VISION sees the work.';
    if (proofLevel === 'Claimed') return 'Claimed effort. Proof not shown.';
    if (proofLevel === 'Reflected') return 'Reflection logged. Proof still weak.';
    if (bonusCompleted) return 'Elite day. You separated from average.';
    if (streak >= 2) return 'Growth confirmed. Streak protected.';
    return 'Growth shown. Proof accepted.';
  }

  /* ----- VISION rank (30-day average) ------------------------------------- */
  const RANKS = [
    [0, 'Beginner'], [25, 'Awake'], [50, 'Locked In'], [75, 'Relentless'], [92, 'Top 1%']
  ];
  function rankFor(score) {
    let r = RANKS[0];
    for (const tier of RANKS) if (score >= tier[0]) r = tier;
    const idx = RANKS.indexOf(r);
    const next = RANKS[idx + 1] || null;
    return { name: r[1], floor: r[0], next: next ? next[1] : null, nextFloor: next ? next[0] : null, top: !next };
  }
  function visionRankScore(p) {
    p = p || ensureProfile();
    const ds = p.dailyScores || {};
    // last 30 calendar days, only days that have a score
    const cutoff = addDays(today(), -29);
    const vals = Object.keys(ds).filter(d => d >= cutoff).map(d => ds[d].dailyProofScore).filter(n => typeof n === 'number');
    if (!vals.length) return 0;
    return Math.round(vals.reduce((s, n) => s + n, 0) / vals.length);
  }

  /* ----- streak / daily roll ---------------------------------------------- */
  function refreshStreak(p) {
    const ds = p.dailyScores || {};
    let streak = 0, d = today();
    if (!ds[d]) d = addDays(d, -1); // today not logged yet → count up to yesterday
    while (ds[d]) { streak++; d = addDays(d, -1); }
    p.streak = streak;
    return streak;
  }

  /* ----- public state read ------------------------------------------------ */
  function state() {
    const p = ensureProfile();
    refreshStreak(p);
    const t = today();
    const todayEntry = (p.dailyScores || {})[t] || null;
    const yKey = addDays(t, -1);
    const yEntry = (p.dailyScores || {})[yKey] || null;
    p.visionRankScore = visionRankScore(p);
    write(p);

    const rank = rankFor(p.visionRankScore);
    return {
      profile: p,
      path: pathOf(p),
      pathLabel: PATH_LABEL[pathOf(p)],
      goals: generateDailyGoals(p),
      todayScore: todayEntry ? todayEntry.dailyProofScore : 0,
      todayLogged: !!todayEntry,
      todayEntry,
      proofLevel: todayEntry ? todayEntry.proofLevel : null,
      visionRankScore: p.visionRankScore,
      rank,
      streak: p.streak,
      yesterday: yEntry,
      driftedYesterday: !yEntry || !yEntry.proofUploaded,
      futureMessage: futureMessage(p),
      rankMessage: rankMessage(p.visionRankScore, todayEntry ? todayEntry.dailyProofScore : 0)
    };
  }

  /* ----- commit a day's proof (DEPRECATED) --------------------------------
     SINGLE-PATH INVARIANT: XP/score is granted ONLY through the photo-gated
     VISION.core.logProof (demo) / submit_proof RPC (backend) on the Task page.
     This engine no longer writes a parallel, photo-less score. Kept as a thin
     no-op so any stale caller fails safe (writes nothing) instead of awarding
     points without a photo. */
  function logDay() {
    return { error: 'use-core-logProof', deprecated: true };
  }

  /* ----- copy: future-you + rank messages by path -------------------------- */
  function futureMessage(p) {
    const lines = {
      athlete: 'Future you did not become dangerous by scrolling. Train today.',
      fitness: 'Future you was built in the sessions you almost skipped. Show up.',
      founder: 'Future you owns the agency because you did the boring outreach today.',
      academic: 'Future you got accepted because you studied when it was quiet.',
      custom: 'Future you is not asking for motivation. Future you is asking for proof.'
    };
    return lines[pathOf(p)];
  }
  function rankMessage(rankScore, todayScore) {
    if (todayScore >= 80 && rankScore < 50) return 'Strong day. Now repeat it.';
    if (rankScore >= 92) return 'Top 1%. Hard to reach. Harder to hold.';
    if (rankScore >= 75) return 'Relentless. Hard to ignore.';
    if (rankScore >= 50) return 'Locked in. Keep the line moving.';
    if (rankScore >= 25) return 'Awake. Intention is showing.';
    if (rankScore > 0) return 'You’ve started. Now be consistent.';
    return 'No proof yet. Your rank starts today.';
  }

  window.VISION = window.VISION || {};
  window.VISION.proof = {
    KEY, today, ensureProfile, state, logDay,
    getMissions, setMissionDone, getReflections, momentumState, memoryInsights,
    generateDailyGoals, computeDailyScore, scoreMessage,
    visionRankScore, rankFor, pathOf, PATH_LABEL,
    RANKS: RANKS.map(r => ({ floor: r[0], name: r[1] }))
  };
})();
