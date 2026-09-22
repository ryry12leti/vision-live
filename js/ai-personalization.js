/* ============================================================================
   VISION · AI Personalization Layer (PLACEHOLDER — no backend yet)
   ----------------------------------------------------------------------------
   Every function here returns clean demo data so the front-end works today.
   To go live, replace the body of each function with a real API call and keep
   the same return shape — nothing else in the UI needs to change.
   Exposed as window.VISION_AI.
   ========================================================================== */
(function () {
  'use strict';

  /* ----- proof tiers (single source of truth for the whole front-end) ----- */
  const PROOF_TIERS = {
    text:       { key: 'text',       label: 'Tell VISION what you did', symbol: '◈', rank: 'Started',   max: 20 },
    screenshot: { key: 'screenshot', label: 'Screenshot proof',         symbol: '◆', rank: 'Locked In',  max: 60 },
    video:      { key: 'video',      label: 'Video / detailed proof',   symbol: '◇', rank: 'Relentless', max: 80 }
  };
  /* status labels by proof quality — used on dashboard + tasks */
  const PROOF_RANKS = [
    { symbol: '◈', name: 'Started',   note: 'Text proof · 20' },
    { symbol: '◆', name: 'Locked In',  note: 'Screenshot proof · 60' },
    { symbol: '◇', name: 'Relentless', note: 'Video / detailed proof · 80' },
    { symbol: '✦', name: 'Top 1%',     note: 'Proof + 100–200 word reflection · 100' }
  ];

  const MAX_DAILY_GOALS = 5;
  const REFLECTION_MIN_WORDS = 100;
  const REFLECTION_MAX_WORDS = 200;

  function wordCount(t) { return String(t || '').trim().split(/\s+/).filter(Boolean).length; }

  /* ==========================================================================
     CATEGORY INFERENCE — mission categories derived from the user's own goal
     language, never from a hardcoded career list. Keyword *clusters* map to
     behaviour categories; anything unmatched falls back to universal ones.
  ========================================================================== */
  const CATEGORY_CLUSTERS = [
    { re: /(financial freedom|passive income|wealth|invest|trading|trader|stocks|crypto|forex|millionaire)/i,
      cats: ['Income', 'Skill Building', 'Execution', 'Learning'] },
    { re: /(business|agency|startup|saas|client|sales|entrepreneur|freelance|revenue|brand|company|founder)/i,
      cats: ['Build', 'Sales', 'Learning', 'Execution'] },
    { re: /(athlete|sport|cricket|football|soccer|basketball|tennis|rugby|boxing|mma|runner|sprinter|swimmer|professional player)/i,
      cats: ['Training', 'Skill', 'Recovery', 'Discipline'] },
    { re: /(gym|muscle|physique|lean|shred|bulk|weight|abs|strength|fitness|body)/i,
      cats: ['Training', 'Nutrition', 'Recovery', 'Discipline'] },
    { re: /(study|exam|school|university|college|degree|atar|grades|medicine|doctor|nurse|lawyer|engineer|pilot|test)/i,
      cats: ['Study', 'Practice', 'Revision', 'Discipline'] },
    { re: /(content|creator|youtube|channel|music|musician|artist|writer|writing|design|film|video|audience|followers)/i,
      cats: ['Create', 'Publish', 'Learning', 'Execution'] },
    { re: /(coding|coder|developer|programmer|software|app|website|engineer)/i,
      cats: ['Build', 'Skill Building', 'Learning', 'Execution'] }
  ];
  const FALLBACK_CATS = ['Skill', 'Execution', 'Learning', 'Discipline'];

  /* one short mission template per category — title is the focus, no fluff */
  const CATEGORY_MISSIONS = {
    Training:        { title: '30 min serious training',          proof: 'Training photo or timer.' },
    Skill:           { title: 'Sharpen the core skill · 30 min',  proof: 'Photo or screenshot of the work.' },
    'Skill Building':{ title: 'Build the skill that pays · 30 min', proof: 'Screenshot or notes.' },
    Recovery:        { title: 'Recover like a professional',      proof: 'Notes or timer screenshot.' },
    Discipline:      { title: 'One block · zero distractions',    proof: 'Timer screenshot.' },
    Build:           { title: 'Move the build forward',           proof: 'Screenshot of the work.' },
    Sales:           { title: 'Reach out to 5 people',            proof: 'Screenshot of sent messages.' },
    Learning:        { title: 'Learn one thing that compounds',   proof: 'Notes or course screenshot.' },
    Execution:       { title: 'One deep work block · 45 min',     proof: 'Timer or work screenshot.' },
    Income:          { title: 'Make one move toward income',      proof: 'Screenshot of the move.' },
    Nutrition:       { title: 'Hit fuel + movement targets',      proof: 'Tracker screenshot.' },
    Study:           { title: '60 min deep study',                proof: 'Timer or notes photo.' },
    Practice:        { title: 'Practice under test conditions',   proof: 'Photo of worked problems.' },
    Revision:        { title: 'Attack one weak topic',            proof: 'Notes photo.' },
    Create:          { title: 'Create one visible piece',         proof: 'Screenshot of the piece.' },
    Publish:         { title: 'Put one thing into the world',     proof: 'Link or post screenshot.' }
  };

  function inferCategories(goalText, selectedSkill, fitnessIncluded) {
    const blob = [goalText, selectedSkill].filter(Boolean).join(' ');
    let cats = null;
    for (const c of CATEGORY_CLUSTERS) { if (c.re.test(blob)) { cats = c.cats.slice(); break; } }
    if (!cats) cats = FALLBACK_CATS.slice();
    if (selectedSkill && cats.indexOf('Skill') < 0 && cats.indexOf('Skill Building') < 0) cats.splice(1, 0, 'Skill');
    if (fitnessIncluded && cats.indexOf('Training') < 0) cats.push('Training');
    return cats.slice(0, MAX_DAILY_GOALS);
  }

  /* the lead mission speaks the user's own goal language */
  function personalizeTitle(category, goal) {
    const g = '“' + goal + '”';
    const T = {
      Build: 'Move ' + g + ' forward', Income: 'One move toward ' + g,
      Training: 'Train for ' + g, Study: '60 min of study for ' + g,
      Create: 'Create for ' + g, Skill: 'Train the skill behind ' + g,
      'Skill Building': 'Build the skill behind ' + g
    };
    return T[category] || ('Push ' + g + ' forward today');
  }

  /* proof requirement → a concrete proof hint the user agreed to in onboarding */
  const PROOF_HINTS = {
    photo: 'Photo of the work.', screenshot: 'Screenshot of the work.', timer: 'Timer screenshot.',
    video: 'Short video clip.', notes: 'Photo of your notes.', reflection: 'Written reflection (50+ words).',
    'uploaded work': 'Upload the finished work.'
  };
  function proofHint(proofType) {
    const k = String(proofType || '').toLowerCase().trim();
    return PROOF_HINTS[k] || (k ? ('Proof: ' + proofType + '.') : 'Screenshot or photo of the work.');
  }
  function timeBudget(mins) { mins = parseInt(mins, 10) || 0; return mins >= 60 ? '60 min' : (mins >= 15 ? mins + ' min' : '30 min'); }
  /* difficulty verb scales the lead focus block with the user's stated level */
  function levelBlock(level, mins) {
    const t = timeBudget(mins), l = String(level || '').toLowerCase();
    if (/advanced|semi|pro|academy/.test(l)) return 'One hard ' + t + ' block at full intensity';
    if (/interm/.test(l)) return 'One focused ' + t + ' block';
    return 'One ' + t + ' focused block';
  }

  /* generateMissions({goal, skill, fitness, level, availableTime, proofType, quitTrigger})
     → up to 5 identity-tied missions, tuned to the saved Goal Profile (PART 5). */
  function generateMissions(u) {
    u = u || {};
    const goal = String(u.goal || '').trim();
    const hint = proofHint(u.proofType);
    const cats = inferCategories(goal, u.skill, u.fitness);
    const list = cats.map(c => {
      const t = CATEGORY_MISSIONS[c] || CATEGORY_MISSIONS.Execution;
      return { title: t.title, proof: hint, category: c, desc: c };
    });
    // lead mission speaks the user's goal, scaled by their level + daily time
    if (list.length) {
      const lead = (goal && goal.length <= 38) ? personalizeTitle(list[0].category, goal) : levelBlock(u.level, u.availableTime);
      list[0] = { ...list[0], title: lead };
    }
    // anti-distraction mission named after their real quit trigger (PART 5) —
    // replace the generic Discipline mission so the plan speaks their enemy
    const enemy = String(u.quitTrigger || '').trim();
    if (enemy && !/^(none|nothing|n\/a)$/i.test(enemy)) {
      const anti = { title: 'Remove ' + enemy.toLowerCase() + ' during your focus block', proof: hint, category: 'Discipline', desc: 'Anti-distraction' };
      const di = list.findIndex(m => m.category === 'Discipline');
      if (di >= 0) list[di] = anti; else list.push(anti);
    }
    // proof mission always last, in their chosen proof format
    list.push({ title: 'Submit today’s proof', proof: hint, category: 'Proof', desc: 'Proof' });
    // de-dupe by title, cap at MAX
    const seen = {}; const out = [];
    list.forEach(m => { if (!seen[m.title]) { seen[m.title] = 1; out.push(m); } });
    return out.slice(0, MAX_DAILY_GOALS);
  }

  /* ── PART 6 · personality wording keyed by the user's chosen push style ── */
  const PERSONALITY = {
    'No-BS':       { tone: 'direct',     intensity: 'high',   antiQuit: 'No excuses. Submit proof.',                 missionIntro: 'No excuses today. Submit proof.',         proofPrompt: 'Prove it. No proof, no progress.' },
    'Calm':        { tone: 'steady',     intensity: 'low',    antiQuit: 'Small proof today. Keep moving.',           missionIntro: 'Small proof today. Keep moving.',         proofPrompt: 'One calm step. Add your proof.' },
    'Tactical':    { tone: 'precise',    intensity: 'medium', antiQuit: 'One focused block. One measurable result.', missionIntro: 'One focused block. One measurable result.', proofPrompt: 'Log the result. Attach your proof.' },
    'Competitive': { tone: 'aggressive', intensity: 'high',   antiQuit: 'Someone else is moving. Don’t fall behind.', missionIntro: 'Someone else is already moving. Don’t fall behind.', proofPrompt: 'Stay ahead. Submit your proof.' },
    'Supportive':  { tone: 'encouraging',intensity: 'medium', antiQuit: 'You don’t need perfect. You need proof.',    missionIntro: 'You don’t need perfect. You need proof.',  proofPrompt: 'You’ve got this. Add your proof.' }
  };
  function personality(pushStyle) { return PERSONALITY[pushStyle] || PERSONALITY['Tactical']; }

  /* ==========================================================================
     PROOF MATCH — estimate how strongly submitted proof relates to the goal.
     Guides, never blocks. Returns High / Medium / Low Match.
  ========================================================================== */
  const STOP = /^(this|that|with|from|have|been|were|will|would|today|just|some|more|very|than|then|them|they|when|what|your|mine|about|into|over|also|because|really|going|doing|done|much|like)$/;
  function tokens(t) {
    return String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.test(w));
  }
  function estimateProofMatch(proofText, opts) {
    opts = opts || {};
    const ref = new Set(tokens([opts.goal, opts.skill, (opts.categories || []).join(' ')].join(' ')));
    const pt = tokens(proofText);
    let overlap = 0; const seen = new Set();
    pt.forEach(w => { if (ref.has(w) && !seen.has(w)) { overlap++; seen.add(w); } });
    const hasFile = !!opts.hasFile, missions = opts.missionsDone || 0;
    let level = 'low';
    if (overlap >= 2 || (overlap >= 1 && hasFile && missions > 0)) level = 'high';
    else if (overlap >= 1 || (hasFile && missions > 0) || (missions > 0 && pt.length >= 8)) level = 'medium';
    const LBL = { high: 'High Match', medium: 'Medium Match', low: 'Low Match' };
    const HINT = { high: 'Proof clearly relates to your goal.', medium: 'Some relation — name the goal in your proof.', low: 'Weak relation — tie it to your goal.' };
    return { level, label: LBL[level], hint: HINT[level], overlap };
  }

  /* ==========================================================================
     DAILY SCORE — Missions 40 · Proof 40 · Consistency 20.
     "Did my actions match what I said I wanted?"
  ========================================================================== */
  function scoreDay(d) {
    d = d || {};
    const mission = Math.round(40 * Math.min(d.missionsDone || 0, d.missionsTotal || 1) / Math.max(1, d.missionsTotal || 1));
    const base = ({ text: 8, screenshot: 24, video: 32 })[d.proofType] || 0;
    const words = wordCount(d.reflectionText);
    const refl = (words >= REFLECTION_MIN_WORDS && words <= REFLECTION_MAX_WORDS) ? 8
      : words > 0 ? Math.min(4, Math.round(words / 25)) : 0;
    const proof = Math.min(40, base + refl);
    const consistency = Math.round(20 * Math.min(d.streak || 0, 7) / 7);
    const score = Math.min(100, mission + proof + consistency);
    return { score, mission, proof, consistency, reflectionFull: refl >= 8 };
  }

  /* ==========================================================================
     DAILY PROOF SCORE — the canonical breakdown (PART 5). Out of 100:
       • Mission completion ...... 40   (all of today's missions done)
       • Proof submitted ......... 30   (real proof attached)
       • Focused time completed .. 15   (hit the daily time budget)
       • Reflection .............. 10   (50–200 word summary)
       • Streak bonus ............  5   (active streak)
     Pure, deterministic, no Math.random. Replace the body with a backend call
     later and keep this return shape.
  ========================================================================== */
  function dailyProofScore(d) {
    d = d || {};
    const total = Math.max(1, d.missionsTotal || 1);
    const done = Math.min(d.missionsCompleted != null ? d.missionsCompleted : (d.missionsDone || 0), total);
    const missionCompletion = Math.round(40 * done / total);
    const proofSubmitted   = d.proofSubmitted ? 30 : 0;
    const focusMinutesGoal = d.timeBudget || d.availableTime || 0;
    const focusDone        = focusMinutesGoal ? (d.focusMinutes || 0) >= focusMinutesGoal : !!d.focusCompleted;
    const focusedTime      = focusDone ? 15 : 0;
    const words            = wordCount(d.reflectionText);
    const reflection       = (words >= REFLECTION_MIN_WORDS) ? 10 : (words > 0 ? Math.min(6, Math.round(words / 10)) : 0);
    const streakBonus      = (d.streak || 0) > 0 ? 5 : 0;
    const score = Math.min(100, missionCompletion + proofSubmitted + focusedTime + reflection + streakBonus);
    return { score, missionCompletion, proofSubmitted, focusedTime, reflection, streakBonus };
  }

  /* --------------------------------------------------------------------------
     calculateDailyProofScore(proofs, reflectionText) → { score, base, reflectionBonus, rank }
     proofs: array of { type: 'text'|'screenshot'|'video' } — one per daily goal.
     Rules (front-end demo of the real model):
       • total daily score is always out of 100, no matter how many goals
       • base proof score caps at 80 (video); screenshots-only caps at 60; text-only 20
       • the final 20 points require a 100–200 word daily summary
     Replace with a real API call later — keep the return shape.
  -------------------------------------------------------------------------- */
  function calculateDailyProofScore(proofs, reflectionText) {
    proofs = (proofs || []).slice(0, MAX_DAILY_GOALS);
    let base = 0;
    if (proofs.length) {
      const vals = proofs.map(p => (PROOF_TIERS[p.type] || PROOF_TIERS.text).max);
      base = vals.reduce((s, v) => s + v, 0) / vals.length;
      // mixed proof bonus: stronger evidence variety scores higher than its average
      const hasVideo = proofs.some(p => p.type === 'video');
      const hasShot = proofs.some(p => p.type === 'screenshot');
      if (hasVideo && hasShot) base += 7;
      // hard caps by strongest evidence present
      const cap = hasVideo ? 80 : hasShot ? 60 : 20;
      base = Math.min(cap, Math.round(base));
    }
    const words = wordCount(reflectionText);
    const reflectionBonus = (words >= REFLECTION_MIN_WORDS && words <= REFLECTION_MAX_WORDS) ? 20
      : words > 0 ? Math.min(10, Math.round(words / 10)) : 0;
    const score = Math.min(100, base + reflectionBonus);
    return { score, base, reflectionBonus, rank: rankForScore(score, proofs, reflectionBonus) };
  }

  function rankForScore(score, proofs, reflectionBonus) {
    const hasVideo = (proofs || []).some(p => p.type === 'video');
    const hasShot = (proofs || []).some(p => p.type === 'screenshot');
    const hasFile = hasVideo || hasShot;
    if (hasFile && reflectionBonus >= 20) return PROOF_RANKS[3]; // Top 1% — file + full reflection
    if (hasVideo) return PROOF_RANKS[2];                         // Relentless
    if (hasShot) return PROOF_RANKS[1];                          // Locked In
    return PROOF_RANKS[0];                                       // Started
  }

  /* --------------------------------------------------------------------------
     validateProofAgainstGoal(userGoal, taskTitle, uploadedFile) → pending result.
     TEMPORARY layer: no proof is auto-accepted. Every screenshot/video upload
     sits in "Pending AI Review" until the real backend verifies it matches the
     user's goal. Replace the body with a real AI call later — keep the shape.
     UI copy lives here so every page shows the same messages.
  -------------------------------------------------------------------------- */
  const PROOF_PENDING_MESSAGE = 'Proof received. VISION will verify that this matches your goal before locking today’s points.';
  const PROOF_NO_GOAL_MESSAGE = 'Choose a goal/task before uploading proof.';
  function validateProofAgainstGoal(userGoal, taskTitle, uploadedFile) {
    if (!userGoal && !taskTitle) {
      return { status: 'no_goal', message: PROOF_NO_GOAL_MESSAGE, estimatedOnly: true };
    }
    return {
      status: 'pending',
      message: 'AI verification required before points are locked.',
      estimatedOnly: true
    };
  }

  /* --------------------------------------------------------------------------
     getDashboardMode(competitionChoice) → { mode, standingLabel, scoreWord }
     competitionChoice: 'Leaderboard' | 'You vs You' (saved during onboarding)
  -------------------------------------------------------------------------- */
  function getDashboardMode(competitionChoice) {
    const c = String(competitionChoice || localStorage.getItem('vision_competition_mode') || '').toLowerCase();
    if (c.indexOf('leader') === 0) {
      return { mode: 'leaderboard', standingLabel: 'Ranking System', scoreWord: 'ranking' };
    }
    return { mode: 'private', standingLabel: 'Private System', scoreWord: 'private score' };
  }

  /* --------------------------------------------------------------------------
     analyzeUserGoal(userGoal, selectedSkill, fitnessChoice) → demo analysis.
     Replace with a real AI call later — keep the return shape.
  -------------------------------------------------------------------------- */
  function analyzeUserGoal(userGoal, selectedSkill, fitnessChoice) {
    return {
      goal: userGoal || selectedSkill || 'your future self',
      selectedSkill: selectedSkill || null,
      fitnessIncluded: !!fitnessChoice,
      focusAreas: [userGoal && 'your goal', selectedSkill, fitnessChoice && 'fitness'].filter(Boolean),
      summary: 'Demo analysis — connect the AI backend to personalize this.'
    };
  }

  /* --------------------------------------------------------------------------
     generatePersonalizedGoalPlan(userData) → demo daily plan (max 5 goals).
     userData: the onboarding payload (goal, skill, fitness, desire, obstacle…).
     Replace with a real AI call later — keep the return shape.
  -------------------------------------------------------------------------- */
  function generatePersonalizedGoalPlan(userData) {
    const goal = (userData && (userData.goalText || userData.primaryGoal || userData.selectedSkill)) || 'your goal';
    const plan = [
      { title: '45 minutes of focused work on ' + goal, proofType: 'screenshot' },
      { title: 'Learn one thing that moves ' + goal + ' forward', proofType: 'screenshot' },
      { title: 'Produce one visible piece of progress', proofType: 'video' }
    ];
    if (userData && userData.fitnessIncluded) plan.push({ title: 'Train your body for 20–30 minutes', proofType: 'video' });
    plan.push({ title: 'Write your 100–200 word daily summary', proofType: 'text' });
    return plan.slice(0, MAX_DAILY_GOALS);
  }

  window.VISION_AI = {
    PROOF_TIERS, PROOF_RANKS, MAX_DAILY_GOALS,
    REFLECTION_MIN_WORDS, REFLECTION_MAX_WORDS, wordCount,
    calculateDailyProofScore, getDashboardMode,
    inferCategories, generateMissions, estimateProofMatch, scoreDay, dailyProofScore,
    analyzeUserGoal, generatePersonalizedGoalPlan, personality, proofHint,
    validateProofAgainstGoal, PROOF_PENDING_MESSAGE, PROOF_NO_GOAL_MESSAGE
  };
})();
