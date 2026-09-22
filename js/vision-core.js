/* ═══════════════════════════════════════════════════════════════
   vision-core.js — VISION web MVP data layer + game logic
   ---------------------------------------------------------------
   One shared module that every app page reads from, so the whole
   product loop (onboarding → dashboard → tasks → proof → scores →
   leaderboard → profile) stays in sync. Pure vanilla JS, no build.

   All state lives in localStorage under the vision_* contract:
     vision_onboarding  vision_profile  vision_tasks   vision_proofs
     vision_xp          vision_scores   vision_leaderboard vision_feedback

   Public API: window.VISION.core
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  const KEYS = {
    onboarding:  'vision_onboarding',
    profile:     'vision_profile',
    tasks:       'vision_tasks',
    proofs:      'vision_proofs',
    xp:          'vision_xp',
    scores:      'vision_scores',
    leaderboard: 'vision_leaderboard',
    feedback:    'vision_feedback',
    strategy:    'vision_strategy'
  };

  /* ---------- low-level storage ---------- */
  function read(k)  { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  /* ---------- the user's local day ----------
     "Today" is the single most load-bearing value in the product: it selects
     the day's tasks, the day's proofs, and which projection the Founder
     Calendar resolves. Client and server MUST agree on it, or the server
     writes a row for one date while the client reads another and the user
     sees an empty day.

     So there is exactly one source of truth: the user's saved canonical IANA
     timezone (profiles.timezone). Not the browser clock -- a founder who
     travels, or whose device is set wrong, must not silently change what day
     their proof belongs to. Not server UTC -- that is a different day from
     the user's evening across most of the planet.

     This mirrors the server's localDate() derivation exactly, including using
     Intl with an explicit timeZone, so any zone works: ahead of UTC, behind
     it, half-hour offsets, and DST transitions are all just "what date is it
     there right now".

     The Australia/Sydney literal below is NOT a rule -- it is the same
     unreachable fallback the server keeps, used only when no profile has
     been loaded at all. profiles.timezone is NOT NULL with a default, so a
     signed-in user always supplies a real zone. It is cached in localStorage
     so the first synchronous call after a reload is already correct rather
     than briefly reading the wrong day. */
  const TZ_KEY = 'vision_user_timezone';
  let userTimezone = null;
  try { userTimezone = localStorage.getItem(TZ_KEY) || null; } catch (e) { userTimezone = null; }

  function setTimezone(tz) {
    const clean = (typeof tz === 'string' && tz.trim()) ? tz.trim() : null;
    if (!clean || clean === userTimezone) return userTimezone;
    userTimezone = clean;
    try { localStorage.setItem(TZ_KEY, clean); } catch (e) {}
    return userTimezone;
  }
  function getTimezone() { return userTimezone; }

  function dateIn(tz) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const get = (t) => { let v = null; for (let i = 0; i < parts.length; i++) if (parts[i].type === t) v = parts[i].value; return v; };
    const y = get('year'), m = get('month'), d = get('day');
    if (!y || !m || !d) throw new Error('incomplete date parts');
    return y + '-' + m + '-' + d;
  }

  function today() {
    try { return dateIn(userTimezone || 'Australia/Sydney'); }
    catch (e) {
      /* An invalid saved zone must not strand the user on a broken date. */
      try { return dateIn('Australia/Sydney'); }
      catch (e2) { return new Date().toISOString().slice(0, 10); }
    }
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function dayDiff(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY); }

  /* ═══════════════ RANKS & XP CURVE ═══════════════ */
  const RANKS = ['Bronze III', 'Bronze II', 'Bronze I', 'Silver III', 'Silver II', 'Silver I',
                 'Gold III', 'Gold II', 'Gold I', 'Platinum', 'Diamond', 'Elite', 'Legend', 'Mythic'];

  // cumulative XP needed to *reach* each rank (rising curve)
  const RANK_THRESH = (function () {
    const t = [0]; let need = 300;
    for (let i = 1; i < RANKS.length; i++) { t.push(t[i - 1] + need); need = Math.round(need * 1.16); }
    return t;
  })();

  function rankForXp(totalXp) {
    let idx = 0;
    for (let i = 0; i < RANK_THRESH.length; i++) if (totalXp >= RANK_THRESH[i]) idx = i;
    const atMax  = idx >= RANKS.length - 1;
    const nextI  = Math.min(idx + 1, RANKS.length - 1);
    const base   = RANK_THRESH[idx];
    const ceil   = RANK_THRESH[nextI];
    return {
      index: idx, name: RANKS[idx], next: RANKS[nextI],
      xpInto: totalXp - base, xpSpan: Math.max(1, ceil - base),
      xpToNext: atMax ? 0 : Math.max(0, ceil - totalXp),
      pct: atMax ? 100 : Math.round(((totalXp - base) / Math.max(1, ceil - base)) * 100),
      atMax
    };
  }

  function streakMultiplier(s) {
    if (s >= 60) return 2.0;
    if (s >= 30) return 1.75;
    if (s >= 14) return 1.5;
    if (s >= 7)  return 1.25;
    if (s >= 3)  return 1.1;
    return 1.0;
  }

  /* ═══════════════ ONBOARDING → POTENTIAL SCORE ═══════════════ */
  // Points indexed by onboarding option index (onboarding.html data-i),
  // following the brief's Potential Score formula.
  const PTS = {
    screen:    [20, 15, 8, 3, 0],   // 1-2h, 2-4h, 4-6h, 6-8h, 8h+
    sleep:     [0, 6, 12, 18, 20],  // <5h, 5-6h, 6-7h, 7-8h, 8h+
    training:  [0, 6, 12, 15, 15],  // 0, 1-2, 3-4, 5-6, 7 days
    goal:      [0, 6, 10, 16, 20],  // <30m, 30-60m, 1-2h, 2-4h, 4h+
    intensity: [5, 8, 10, 12]       // Balanced, Committed, Obsessed, Extreme
  };

  // onboarding goal category → task path bucket
  const CAT_PATH = {
    fitness: 'fitness', student: 'study', coding: 'study',
    business: 'money', audience: 'money',
    mind: 'discipline', general: 'discipline'
  };

  const TRAJ = [
    { min: 86, label: 'Future-Proof' },
    { min: 71, label: 'Locked In' },
    { min: 51, label: 'Building' },
    { min: 31, label: 'Unstable' },
    { min: 0,  label: 'Drifting' }
  ];
  function trajectoryOf(score) { return (TRAJ.find(t => score >= t.min) || TRAJ[TRAJ.length - 1]).label; }

  function getOnboarding() { return read(KEYS.onboarding); }
  // path = one of the 4 legacy buckets (fitness|study|money|discipline), used by
  // scores/leaderboard/ranks. With the universal engine, ANY goal maps to a
  // parentPath; older users with only a category still resolve via CAT_PATH.
  function pathOf(ob) {
    ob = ob || getOnboarding() || {};
    if (ob.goalAnalysis && ob.goalAnalysis.parentPath) return ob.goalAnalysis.parentPath;
    if (V.goal && V.goal.analyzeGoal && (ob.goalText || ob.primaryGoal || ob.goalDetail)) {
      try { return V.goal.analyzeGoal(ob.goalText || ob.primaryGoal || ob.goalDetail, ob).parentPath; } catch (e) {}
    }
    return CAT_PATH[ob.cat] || 'discipline';
  }

  // base (no-proof) potential from onboarding answers, max 85
  function basePotential(ob) {
    ob = ob || getOnboarding();
    if (!ob) return 42; // sensible demo default
    const v = (arr, i) => (i == null || arr[i] == null) ? 0 : arr[i];
    return clamp(
      v(PTS.screen, ob.screenIdx) + v(PTS.sleep, ob.sleepIdx) +
      v(PTS.training, ob.trainingIdx) + v(PTS.goal, ob.goalEffortIdx) +
      v(PTS.intensity, ob.intensityIdx), 0, 85);
  }

  /* ═══════════════ TASK TEMPLATES ═══════════════ */
  // difficulty → base verified points (photo proof required). Easy 20, Medium 45,
  // Hard 80. Legacy 'core' is an alias of medium.
  const XP_BY_DIFF = { easy: 20, medium: 45, core: 45, hard: 80 };
  // canonical user-facing difficulty label (never shows "Core")
  function difficultyLabel(d) {
    var k = String(d || 'medium').toLowerCase();
    if (k === 'core') k = 'medium';
    return ({ easy: 'EASY', medium: 'MEDIUM', hard: 'HARD' })[k] || 'MEDIUM';
  }
  function taskBasePoints(d) {
    var k = String(d || 'medium').toLowerCase();
    if (k === 'core') k = 'medium';
    return ({ easy: 20, medium: 45, hard: 80 })[k] || 45;
  }
  const TASK_TEMPLATES = {
    study: [
      { id: 'study-sprint',  title: 'Study Sprint',   meta: '45-min focused block', difficulty: 'core', proof: true },
      { id: 'revision-proof', title: 'Revision Proof', meta: 'Notes · flashcards · past paper', difficulty: 'hard', proof: true },
      { id: 'phone-free',    title: 'Phone-Free Block', meta: 'No phone for 90 minutes', difficulty: 'easy', proof: true }
    ],
    fitness: [
      { id: 'workout-proof', title: 'Workout Proof',  meta: 'Gym · run · home session', difficulty: 'core', proof: true },
      { id: 'hit-steps',     title: 'Hit Your Steps', meta: '8,000+ steps today', difficulty: 'easy', proof: true },
      { id: 'recovery',      title: 'Recovery Check',  meta: 'Sleep · stretch · hydration', difficulty: 'easy', proof: true }
    ],
    money: [
      { id: 'skill-builder', title: 'Skill Builder',  meta: 'Build the skill that pays', difficulty: 'core', proof: true },
      { id: 'save-track',    title: 'Save / Track',   meta: 'Log savings · no-spend · invoice', difficulty: 'easy', proof: true },
      { id: 'opportunity',   title: 'Opportunity Action', meta: 'One move toward the goal', difficulty: 'hard', proof: true }
    ],
    discipline: [
      { id: 'deep-work',     title: 'Deep Work Block', meta: '90 minutes, no distractions', difficulty: 'core', proof: true },
      { id: 'reset',         title: 'Room / Desk Reset', meta: 'Reset your environment', difficulty: 'easy', proof: true },
      { id: 'plan-tomorrow', title: 'Plan Tomorrow',  meta: 'Write tomorrow’s top 3', difficulty: 'easy', proof: true }
    ]
  };

  /* ═══════════════ TASK COACHING (the "how-to" layer) ═══════════════
     Deterministic per-task guidance keyed by task id. The Strategist page
     teaches with this; the Tasks page still collects the photo proof.
     Built to be swapped for AI/backend later. Title/XP/difficulty come from
     the template above — not duplicated here. Non-shaming language only. */
  const TASK_COACHING = {
    // ── Study / The Scholar ──
    'study-sprint': {
      time: '30–45 min',
      why: 'Trains deep focus before motivation fades — your obstacle is procrastination, so we start by proving one focused block.',
      steps: ['Pick one subject.', 'Choose one clear piece of work.', 'Put your phone away or turn on Do Not Disturb.', 'Set a 30–45 minute timer.', 'Work on only that one thing — don’t switch.', 'When done, photograph the completed work.'],
      proof: 'A photo of your completed notes, questions, flashcards, or a timer beside your finished work.',
      goodProof: 'The photo clearly shows work that got done — not just a tidy desk.',
      avoid: 'Don’t upload a random desk photo. Proof must show completed work.',
      helps: 'Builds deep focus, beats procrastination, and creates real evidence you studied.'
    },
    'revision-proof': {
      time: '40–60 min',
      why: 'Active recall is what actually moves grades — this proves you tested yourself, not just reread.',
      steps: ['Pick a topic you’ll be examined on.', 'Close your notes.', 'Write answers, flashcards, or a past-paper question from memory.', 'Check and correct your mistakes.', 'Photograph the completed recall work.'],
      proof: 'A photo of flashcards, a past-paper answer, or written recall — with corrections visible.',
      goodProof: 'Shows you produced answers from memory, then checked them.',
      avoid: 'Don’t photograph a page you only highlighted. Re-reading isn’t revision.',
      helps: 'Active recall locks knowledge in and exposes gaps before the exam does.'
    },
    'phone-free': {
      time: '30–60 min',
      why: 'High screen time weakens your focus window, so this trains control before deep work.',
      steps: ['Put your phone in another room or out of reach.', 'Choose a 30–60 minute block.', 'Start one task before checking any messages.', 'Keep the phone away until the block ends.', 'Photograph your phone-free setup or the work you finished.'],
      proof: 'A photo of your work setup with the phone away, or the work completed during the block.',
      goodProof: 'Shows a genuine phone-free session — phone out of reach, work in progress or done.',
      avoid: 'Don’t leave the phone beside you and call it controlled.',
      helps: 'Builds focus discipline and cuts the distraction loop that feeds procrastination.'
    },
    // ── Fitness / The Athlete ──
    'workout-proof': {
      time: '20–45 min',
      why: 'Your goal needs consistency, not a perfect session — this proves you trained today.',
      steps: ['Choose gym, run, sport, or a home workout.', 'Train for at least 20 minutes.', 'Keep it simple — just finish the session.', 'Note what you did.', 'Take proof after the session.'],
      proof: 'A photo of your workout notes, gym equipment, a running-app screen, or kit after training.',
      goodProof: 'Clearly tied to a session you just did — not an old or generic photo.',
      avoid: 'Don’t upload an old photo or a random mirror selfie.',
      helps: 'Builds consistency, energy, and the discipline that compounds over weeks.'
    },
    'hit-steps': {
      time: 'Across the day',
      why: 'Daily movement keeps your baseline up between training days — easy proof that protects momentum.',
      steps: ['Aim for 8,000+ steps today.', 'Walk after a meal or take the longer route.', 'Check your phone or watch step count.', 'Screenshot the step total once you hit it.'],
      proof: 'A screenshot of your step count for today at 8,000+.',
      goodProof: 'Today’s date and the step total are both visible.',
      avoid: 'Don’t screenshot a past day’s total.',
      helps: 'Keeps energy and recovery up, and protects your streak on non-gym days.'
    },
    'recovery': {
      time: '10–20 min',
      why: 'Recovery is where training turns into results — and poor sleep makes every session harder.',
      steps: ['Pick one: stretch, mobility, hydration, or an early wind-down.', 'Spend 10–20 minutes on it.', 'Keep your phone out of the bedroom tonight if you can.', 'Photograph your recovery setup or log.'],
      proof: 'A photo of your stretch/mobility setup, water intake, or a sleep wind-down log.',
      goodProof: 'Shows a real recovery action taken today.',
      avoid: 'Don’t skip this on hard-training days — that’s when it matters most.',
      helps: 'Better recovery and sleep raise tomorrow’s energy and training quality.'
    },
    // ── Money / The Builder ──
    'skill-builder': {
      time: '30–60 min',
      why: 'Money follows a skill — progress comes from building something, not watching content.',
      steps: ['Pick one skill: sales, coding, design, editing, outreach, or web building.', 'Choose one small output to create.', 'Make something visible: a draft, design, script, page, or offer.', 'Save the result.', 'Photograph or screenshot the output.'],
      proof: 'A screenshot or photo of the thing you actually created.',
      goodProof: 'Shows real output you produced — a file, design, page, or message.',
      avoid: 'Don’t upload a video you watched. Proof must show output you made.',
      helps: 'Turns learning into evidence and builds a skill people pay for.'
    },
    'save-track': {
      time: '10 min',
      why: 'Awareness is the first money habit — tracking beats guessing.',
      steps: ['Open your bank or a notes app.', 'Log today’s spending, a saving, or a no-spend day.', 'Note one number you want to improve.', 'Screenshot the log.'],
      proof: 'A screenshot of your savings log, no-spend note, or a sent/paid invoice.',
      goodProof: 'Shows a real entry dated today.',
      avoid: 'Don’t fake numbers — this only helps if it’s honest.',
      helps: 'Builds the money-awareness habit that makes every other decision better.'
    },
    'opportunity': {
      time: '20–40 min',
      why: 'One real move toward income beats a week of planning — this proves you acted.',
      steps: ['Pick one opportunity: an outreach message, a pitch, a listing, or an application.', 'Make it specific to a real person or platform.', 'Send it or publish it today.', 'Capture proof of the action.'],
      proof: 'A screenshot of the message sent, listing posted, or application submitted.',
      goodProof: 'Shows a real, sent action — recipient or platform visible.',
      avoid: 'Don’t draft it and leave it unsent. The proof is in sending.',
      helps: 'Creates real shots at income and builds the habit of taking action.'
    },
    // ── Discipline / The Operator ──
    'deep-work': {
      time: '60–90 min',
      why: 'Self-control is a muscle — one protected block trains it more than a perfect day planned.',
      steps: ['Choose the one task that matters most.', 'Remove distractions — phone away, tabs closed.', 'Set a 60–90 minute block.', 'Work only on that task.', 'Photograph the work you completed.'],
      proof: 'A photo of the completed work from your deep-work block.',
      goodProof: 'Shows a finished piece of focused work, not just a setup.',
      avoid: 'Don’t multitask — switching breaks the rep you’re training.',
      helps: 'Builds the focus and self-control that carry into every goal.'
    },
    'reset': {
      time: '10–15 min',
      why: 'Your environment shapes your behaviour — a clear space lowers the friction to start.',
      steps: ['Pick your desk, room, or workspace.', 'Spend 10–15 minutes resetting it.', 'Clear what’s not needed; set out what is.', 'Photograph the reset space.'],
      proof: 'A before/after, or a photo of the reset, ready-to-work space.',
      goodProof: 'Shows a genuinely cleared, ready space.',
      avoid: 'Don’t let a 10-minute reset turn into an hour of avoidance.',
      helps: 'Removes friction so starting tomorrow’s deep work is easy.'
    },
    'plan-tomorrow': {
      time: '5–10 min',
      why: 'Deciding tonight removes tomorrow’s hesitation — and hesitation is where discipline leaks.',
      steps: ['Write your top 3 tasks for tomorrow.', 'Make the first one small enough to start.', 'Set when and where you’ll do it.', 'Photograph your written plan.'],
      proof: 'A photo of your written top-3 plan for tomorrow.',
      goodProof: 'Shows three clear, specific tasks — not vague goals.',
      avoid: 'Don’t list 10 things. Three real priorities beat a long wish-list.',
      helps: 'Pre-deciding cuts procrastination and makes tomorrow’s start automatic.'
    }
  };
  const DIFF_LABEL = { easy: 'Easy', medium: 'Medium', core: 'Medium', hard: 'Hard' };
  const ENGINE_DIFF_LABEL = { easy: 'Easy', medium: 'Medium', core: 'Medium', hard: 'Hard' };

  function tasksFor(path) {
    const base = TASK_TEMPLATES[path] || TASK_TEMPLATES.discipline;
    return base.map(t => Object.assign({ goalType: path, baseXp: XP_BY_DIFF[t.difficulty] }, t));
  }

  /* ═══════════ UNIVERSAL GOAL ENGINE BRIDGE ═══════════
     When the user has a free-text goal, goal-strategist.js drives tasks +
     strategy for ANY goal. Falls back to the legacy 4-path templates for
     older users with no goal text, so nothing breaks for them. */
  function engineAvailable() { return !!(V.goal && V.goal.deterministicStrategy); }
  function goalTextOf(ob) { ob = ob || getOnboarding() || {}; return ob.goalText || ob.primaryGoal || ob.goalDetail || (ob.goalAnalysis && ob.goalAnalysis.rawGoal) || ''; }
  function hasGoal(ob) { ob = ob || getOnboarding(); return !!(ob && (ob.goalAnalysis || goalTextOf(ob))); }
  function engineBundle(ob) {
    ob = ob || getOnboarding() || {};
    if (!engineAvailable() || !hasGoal(ob)) return null;
    // full behaviour signal so the personalisation layer can adapt (miss/streak/capacity)
    const st = proofDayStats();
    const xp = getXp();
    const missedYesterday = (xp.streak === 0 && st.provenDays > 0);
    const hist = {
      completedToday: proofsToday().length,
      provenDays: st.provenDays,
      streak: xp.streak || 0,
      missedYesterday: missedYesterday,
      completionRate: st.provenDays > 0 ? Math.min(1, st.provenDays / (st.provenDays + (missedYesterday ? 1 : 0))) : 0,
      screenHigh: !!(ob && ob.screenIdx != null && ob.screenIdx >= 3)
    };
    try { return V.goal.deterministicStrategy(goalTextOf(ob), ob, hist); } catch (e) { return null; }
  }
  // engine's 3 role-tasks mapped to the core task shape the app already uses
  function engineTasks(ob) {
    const b = engineBundle(ob); if (!b) return null;
    const path = b.analysis.parentPath;
    return b.daily.guidedAssignments.map(t => ({
      id: t.key, title: t.title, meta: t.estimated_minutes, difficulty: t.difficulty,
      baseXp: t.xp, goalType: path, proof: true, role: t.role
    }));
  }
  function tasksSig(ob) {
    ob = ob || getOnboarding() || {};
    return (ob.goalAnalysis && ob.goalAnalysis.domain) ? ('engine:' + ob.goalAnalysis.domain) : pathOf(ob);
  }

  // today's task list, regenerated when the date or goal signature changes
  function getTasks() {
    // Daily Directives are the task list: generated from the user's main goal.
    // Keep the legacy cache in sync so older readers (strategist, decay) agree.
    const list = getDailyDirectives().list;
    write(KEYS.tasks, { date: today(), path: tasksSig(), list: list });
    return list;
  }

  /* ═══════════════ MAIN GOAL → DAILY DIRECTIVES ═══════════════
     The core loop: Main Goal → Daily Directives → Proof → Score → Standing.
     Rule-based (never random, never one-size-fits-all). The user's goal lives
     in vision_main_goal; each day's five directives are persisted under
     vision_directives_YYYY-MM-DD and refresh once per day (or when the goal
     changes). Each directive carries an `arena` (goalType) so logging its proof
     flows straight into the existing scoring → Standing pipeline. */
  function getMainGoal() {
    let g = localStorage.getItem('vision_main_goal');
    if (!g) {                                   // backfill for users onboarded before this existed
      const ob = getOnboarding() || {};
      g = ob.primaryGoal || ob.goalText || ob.goalDetail || '';
      if (g) localStorage.setItem('vision_main_goal', g);
    }
    return g || '';
  }
  function setMainGoal(text) {
    text = (text || '').toString().trim();
    if (text) localStorage.setItem('vision_main_goal', text);
  }

  // broad goal type — drives which directive set the user receives
  const GOAL_TYPE_RULES = [
    { type: 'trading',  re: /\b(trade|trader|trading|forex|stock|stocks|crypto|invest|investing|day\s*trad|scalp|swing\s*trad)\b/i },
    { type: 'sport',    re: /\b(cricket|cricketer|footy|football|footballer|soccer|basketball|baller|tennis|rugby|athlete|athletic|sprint|sprinter|boxing|boxer|mma|swim|swimmer|golf|golfer|hockey|baseball|marathon|sport|sports)\b/i },
    { type: 'fitness',  re: /\b(gym|muscle|physique|bodybuild|body\s*build|aesthetic|lean|shred|abs|bulk|strength|fit|fitness|lose\s*weight|fat\s*loss|gain\s*muscle)\b/i },
    { type: 'business', re: /\b(business|entrepreneur|startup|start-?up|agency|company|founder|sales|client|clients|customer|ecommerce|e-commerce|dropship|income|revenue|freelanc|make\s*money|earn)\b/i },
    { type: 'academic', re: /\b(exam|study|student|university|college|degree|atar|gpa|grade|grades|medicine|doctor|nurse|lawyer|law|engineer|engineering|pass|school|test|revision)\b/i },
    { type: 'creative', re: /\b(music|musician|artist|content|creator|youtube|youtuber|design|designer|writer|write|film|video|photograph|paint|draw|produce|producer|beats|streamer|podcast)\b/i },
    { type: 'career',   re: /\b(job|career|pilot|developer|programmer|profession|promotion|interview|hired|apprentice|electrician|plumber)\b/i }
  ];
  function detectGoalType(text) {
    text = (text || '').toLowerCase();
    for (let i = 0; i < GOAL_TYPE_RULES.length; i++) if (GOAL_TYPE_RULES[i].re.test(text)) return GOAL_TYPE_RULES[i].type;
    return 'general';
  }

  // tidy the goal into a short noun for interpolation ("I want to become a doctor" → "doctor")
  function goalNoun(g) {
    g = (g || '').trim();
    if (!g) return 'your goal';
    g = g.replace(/^i\s+(want|wish|plan|aim|hope|need)\s+to\s+/i, '')
         .replace(/^(become|be|get|reach|build|make|start|achieve|grow|launch)\s+(a|an|the)?\s*/i, '')
         .replace(/[.!?]+$/, '').trim();
    return g || 'your goal';
  }
  function sportNoun(g) {
    g = (g || '').toLowerCase();
    const m = { cricketer: 'cricket', footballer: 'football', baller: 'basketball', basketballer: 'basketball',
                sprinter: 'sprint', boxer: 'boxing', swimmer: 'swimming', golfer: 'golf' };
    for (const k in m) if (g.indexOf(k) >= 0) return m[k];
    const sports = ['cricket', 'football', 'soccer', 'basketball', 'tennis', 'rugby', 'boxing', 'mma', 'swimming', 'golf', 'hockey', 'baseball', 'athletics', 'running'];
    for (let i = 0; i < sports.length; i++) if (g.indexOf(sports[i]) >= 0) return sports[i];
    return 'your sport';
  }

  // five directives per goal type. c=category, a=arena(scoring bucket), d=difficulty.
  const DIRECTIVE_TEMPLATES = {
    sport: [
      { c: 'Fitness',     a: 'fitness',    d: 'core', t: 'Complete 20 minutes of sprint or endurance training.', r: 'Athletic engines are built off the field.' },
      { c: 'Skill',       a: 'fitness',    d: 'core', t: 'Practice {sport} drills for 30 minutes.', r: 'Deliberate reps separate the elite.' },
      { c: 'Learning',    a: 'study',      d: 'easy', t: 'Watch 10 minutes of professional {sport} analysis.', r: 'Study the level you are chasing.' },
      { c: 'Discipline',  a: 'discipline', d: 'core', t: 'Remove all distractions before training.', r: 'Focus multiplies every rep.' },
      { c: 'Consistency', a: 'discipline', d: 'easy', t: 'Upload proof of today’s {sport} work.', r: 'Proof is the only thing that counts.' }
    ],
    business: [
      { c: 'Money',       a: 'money',      d: 'hard', t: 'Contact 5 potential customers or improve one offer.', r: 'Revenue follows real conversations.' },
      { c: 'Skill',       a: 'money',      d: 'core', t: 'Build or improve one part of your product.', r: 'Ship something better than yesterday.' },
      { c: 'Learning',    a: 'study',      d: 'easy', t: 'Study one sales, marketing, or business lesson.', r: 'Sharpen the skill that prints money.' },
      { c: 'Discipline',  a: 'discipline', d: 'core', t: 'Complete 90 minutes of deep work.', r: 'Founders are made in the focused hours.' },
      { c: 'Consistency', a: 'discipline', d: 'easy', t: 'Upload proof of today’s progress.', r: 'Proof is the only thing that counts.' }
    ],
    trading: [
      { c: 'Learning',    a: 'study',      d: 'core', t: 'Review one trading concept or strategy.', r: 'Edge comes from understanding, not luck.' },
      { c: 'Skill',       a: 'money',      d: 'core', t: 'Backtest or paper trade one setup.', r: 'Reps build real pattern recognition.' },
      { c: 'Discipline',  a: 'discipline', d: 'core', t: 'Write down your risk rules before trading.', r: 'Risk control is the whole game.' },
      { c: 'Money',       a: 'money',      d: 'easy', t: 'Track one trade idea without over-risking.', r: 'Protect capital first, profit second.' },
      { c: 'Consistency', a: 'discipline', d: 'easy', t: 'Upload a screenshot of your trading journal.', r: 'The journal is the proof.' }
    ],
    fitness: [
      { c: 'Fitness',     a: 'fitness',    d: 'core', t: 'Train one muscle group with full effort.', r: 'The physique is built one session at a time.' },
      { c: 'Skill',       a: 'fitness',    d: 'core', t: 'Perfect your form on one key lift.', r: 'Technique is what makes the work pay.' },
      { c: 'Learning',    a: 'study',      d: 'easy', t: 'Study one nutrition or training principle.', r: 'Knowledge accelerates results.' },
      { c: 'Discipline',  a: 'discipline', d: 'core', t: 'Hit your protein target and avoid junk today.', r: 'Discipline at the table beats the gym.' },
      { c: 'Consistency', a: 'discipline', d: 'easy', t: 'Upload proof of today’s training.', r: 'Proof is the only thing that counts.' }
    ],
    academic: [
      { c: 'Learning',    a: 'study',      d: 'core', t: 'Complete one focused study block toward {goal}.', r: 'Mastery is built in deep blocks.' },
      { c: 'Skill',       a: 'study',      d: 'core', t: 'Do active recall or past questions for 30 minutes.', r: 'Testing yourself beats re-reading.' },
      { c: 'Discipline',  a: 'discipline', d: 'core', t: 'Phone away for one deep study session.', r: 'Attention is the scarce resource.' },
      { c: 'Fitness',     a: 'fitness',    d: 'easy', t: 'Move for 20 minutes to protect your focus.', r: 'A sharp mind needs a moved body.' },
      { c: 'Consistency', a: 'discipline', d: 'easy', t: 'Upload proof of today’s study.', r: 'Proof is the only thing that counts.' }
    ],
    creative: [
      { c: 'Skill',       a: 'money',      d: 'core', t: 'Create one piece of work toward {goal}.', r: 'Output is the only path to mastery.' },
      { c: 'Learning',    a: 'study',      d: 'easy', t: 'Study one creator or technique in your field.', r: 'Learn from the best, then add your edge.' },
      { c: 'Discipline',  a: 'discipline', d: 'core', t: '90 minutes of focused creation, no scrolling.', r: 'Deep work is where the good work lives.' },
      { c: 'Fitness',     a: 'fitness',    d: 'easy', t: 'Move for 20 minutes to keep your energy high.', r: 'Creativity rides on physical energy.' },
      { c: 'Consistency', a: 'discipline', d: 'easy', t: 'Publish or upload proof of today’s work.', r: 'Shipping beats perfecting.' }
    ],
    career: [
      { c: 'Skill',       a: 'money',      d: 'core', t: 'Practice one core skill for your field for 30 minutes.', r: 'Skill is the currency of your career.' },
      { c: 'Learning',    a: 'study',      d: 'easy', t: 'Study one lesson toward becoming {goal}.', r: 'Close the gap to the role you want.' },
      { c: 'Discipline',  a: 'discipline', d: 'core', t: '90 minutes of deep, distraction-free work.', r: 'The focused win the promotions.' },
      { c: 'Fitness',     a: 'fitness',    d: 'easy', t: 'Train your body for 20 minutes.', r: 'Energy and discipline carry into your work.' },
      { c: 'Consistency', a: 'discipline', d: 'easy', t: 'Upload proof of today’s progress.', r: 'Proof is the only thing that counts.' }
    ],
    general: [
      { c: 'Fitness',     a: 'fitness',    d: 'core', t: 'Train your body for 20–30 minutes.', r: 'A strong body powers everything else.' },
      { c: 'Skill',       a: 'money',      d: 'core', t: 'Spend 30 minutes getting better at {goal}.', r: 'Skill compounds with daily reps.' },
      { c: 'Learning',    a: 'study',      d: 'easy', t: 'Learn one thing that moves you toward {goal}.', r: 'Knowledge is the lever.' },
      { c: 'Discipline',  a: 'discipline', d: 'core', t: '90 minutes of focused work, no distractions.', r: 'Discipline is the bridge to your goal.' },
      { c: 'Consistency', a: 'discipline', d: 'easy', t: 'Upload proof of today’s work toward {goal}.', r: 'Proof is the only thing that counts.' }
    ]
  };

  function generateDirectives(goal, type) {
    const tpl = DIRECTIVE_TEMPLATES[type] || DIRECTIVE_TEMPLATES.general;
    const noun = goalNoun(goal), sport = sportNoun(goal);
    const fill = s => s.replace(/\{goal\}/g, noun).replace(/\{sport\}/g, sport);
    return tpl.map(d => ({
      id: 'd-' + d.c.toLowerCase(),
      category: d.c,
      title: fill(d.t),
      reason: fill(d.r),
      completed: false,
      proofAttached: false,
      note: '',
      // fields the task UI + scoring pipeline consume
      arena: d.a, goalType: d.a, difficulty: d.d, baseXp: XP_BY_DIFF[d.d], meta: fill(d.r), proof: true
    }));
  }

  function directivesKey(date) { return 'vision_directives_' + (date || today()); }

  /* ═══════════ DAILY 2-TAP CONSTRAINTS (time + energy) ═══════════
     A lightweight per-user-per-date capacity signal the selector reads so
     the SAME goal yields a different plan on a 5-min low-energy day vs a
     60-min high-energy one. The demo layer stores these locally (date-
     stamped, device-local); the backend layer (vision-api) persists them
     server-side. Defaults to the last set value, else a safe 15 / normal. */
  const CONSTRAINTS_KEY = 'vision_daily_constraints';
  const MS_PER_DAY = 864e5;
  const VALID_MINUTES = [5, 15, 30, 60];
  const VALID_ENERGY = ['low', 'normal', 'high'];
  function normConstraints(c) {
    c = c || {};
    let m = parseInt(c.minutes, 10); if (VALID_MINUTES.indexOf(m) === -1) m = 15;
    let e = String(c.energy || '').toLowerCase(); if (VALID_ENERGY.indexOf(e) === -1) e = 'normal';
    return { minutes: m, energy: e };
  }
  function getDailyConstraints() {
    const all = read(CONSTRAINTS_KEY) || {};
    if (all[today()]) return Object.assign(normConstraints(all[today()]), { set: true, source: 'today' });
    const dates = Object.keys(all).sort();
    if (dates.length) return Object.assign(normConstraints(all[dates[dates.length - 1]]), { set: false, source: 'last' });
    return Object.assign(normConstraints(null), { set: false, source: 'default' });
  }
  function setDailyConstraints(minutes, energy) {
    const all = read(CONSTRAINTS_KEY) || {};
    const c = normConstraints({ minutes: minutes, energy: energy });
    all[today()] = c;
    const dates = Object.keys(all).sort();
    while (dates.length > 14) { delete all[dates.shift()]; }   // keep the store small
    write(CONSTRAINTS_KEY, all);
    // re-roll today's directives to reflect new capacity — but only before the
    // first proof of the day (after that the plan is locked; change applies tomorrow)
    if (proofsToday().length === 0) localStorage.removeItem(directivesKey());
    return Object.assign(c, { set: true, source: 'today' });
  }

  /* the user + behaviour context the selector personalises against */
  function directiveBlocker(ob) {
    ob = ob || getOnboarding() || {};
    return ob.obstacle || ob.block || ob.distraction || ob.goal_blocker ||
           (ob.goalAnalysis && ob.goalAnalysis.blockers && ob.goalAnalysis.blockers[0]) || '';
  }
  function directiveContext() {
    const ob = getOnboarding() || {};
    const xp = getXp();
    const st = proofDayStats();
    return {
      goal: getMainGoal(),
      arena: pathOf(ob),                                  // fitness | study | money | discipline
      blocker: directiveBlocker(ob),
      streak: xp.streak || 0,
      missedYesterday: (xp.streak === 0 && st.provenDays > 0),
      mode: ob.mode || ob.standing || null
    };
  }
  /* last-7-day history for anti-repeat: template ids used + yesterday's proof reqs */
  function directiveHistory() {
    const ids = [];
    const t = Date.parse(today());
    for (let d = 7; d >= 1; d--) {                         // chronological (oldest → newest)
      const date = new Date(t - d * MS_PER_DAY).toISOString().slice(0, 10);
      const cache = read(directivesKey(date));
      if (cache && cache.list) cache.list.forEach(x => { if (x && (x.task_id || x.id)) ids.push(x.task_id || x.id); });
    }
    const yCache = read(directivesKey(new Date(t - MS_PER_DAY).toISOString().slice(0, 10)));
    const yesterdayProofRequired = {};
    if (yCache && yCache.list) yCache.list.forEach(x => { if (x && x.kind) yesterdayProofRequired[x.kind] = x.proof_required; });
    return { date: today(), recentTemplateIds: ids, yesterdayProofRequired: yesterdayProofRequired };
  }

  /* "Personalized for you" line — built from the factors the selector actually
     used. Never prints sensitive/embarrassing raw text: the goal shows as
     "your goal" and the blocker as a clean normalized category. */
  const BLOCKER_DISPLAY = {
    phone: 'phone distraction', procrastination: 'procrastination', 'no-plan': 'no clear plan',
    'low-energy': 'low energy', fear: 'fear of failing', confidence: 'low confidence',
    'bad-environment': 'a tough environment', time: 'limited time', inconsistency: 'inconsistency'
  };
  function personalizationSummary(directive, constraints, ctx) {
    directive = directive || {};
    ctx = ctx || directiveContext();
    const con = constraints || getDailyConstraints();
    const factors = directive.personalization_factors_used || directive.tags || ['goal', 'arena', 'time_today', 'energy_today', 'blocker'];
    const has = f => factors.indexOf(f) > -1;
    const parts = [];
    if (has('goal')) parts.push('your goal');
    const arena = directive.arena || directive.goalType || ctx.arena;
    if (has('arena') && arena) parts.push(arena + ' arena');
    if (has('time_today') && con && con.minutes) parts.push(con.minutes + ' min today');
    if (has('energy_today') && con && con.energy) parts.push(con.energy + ' energy');
    if (has('blocker') && ctx.blocker) {
      const tag = (V.tasks && V.tasks.normalizeBlocker) ? V.tasks.normalizeBlocker(ctx.blocker) : 'inconsistency';
      parts.push('blocker: ' + (BLOCKER_DISPLAY[tag] || tag));
    }
    if (has('streak_state') && ((ctx.streak || 0) > 0 || ctx.missedYesterday)) parts.push(ctx.missedYesterday ? 'comeback day' : ('day ' + ((ctx.streak || 0) + 1) + ' streak'));
    return parts.length ? ('Based on: ' + parts.join(' · ')) : '';
  }

  function getDailyDirectives() {
    const key = directivesKey();
    const goal = getMainGoal();
    const con = getDailyConstraints();
    const sig = goal + '|' + con.minutes + '|' + con.energy;
    let saved = read(key);
    const stale = !saved || saved.sig !== sig;
    const locked = !!(saved && saved.list && proofsToday().length > 0);   // plan locks after first proof
    if (stale && !locked) {
      let list;
      if (V.tasks && V.tasks.selectDailyDirectives) {       // canonical 3-directive selector
        list = V.tasks.selectDailyDirectives(directiveContext(), { minutes: con.minutes, energy: con.energy }, directiveHistory());
      } else {                                              // defensive legacy fallback (library not loaded)
        list = generateDirectives(goal, detectGoalType(goal));
      }
      saved = { date: today(), goal: goal, sig: sig, constraints: { minutes: con.minutes, energy: con.energy }, list: list };
      write(key, saved);
    }
    // proofs are the single source of truth — sync completion flags from today's proofs
    const doneIds = {};
    proofsToday().forEach(p => { doneIds[p.taskId] = true; });
    saved.list.forEach(d => { const id = d.task_id || d.id; if (doneIds[id]) { d.completed = true; d.proofAttached = true; } });
    write(key, saved);
    return saved;
  }

  // mark a directive complete with photo proof — routes through logProof so the
  // proof feeds the arena scoring (and therefore the Standing) automatically.
  function attachDirectiveProof(id, opts) {
    opts = opts || {};
    const d = getDailyDirectives();
    const dir = d.list.find(x => x.id === id);
    if (!dir) return { error: 'no-directive' };
    const res = logProof(
      { id: dir.id, title: dir.title, goalType: dir.arena, baseXp: dir.baseXp, difficulty: dir.difficulty },
      { note: opts.note, photoDataUrl: opts.photoDataUrl, verification: opts.verification }
    );
    if (res && !res.error) {
      dir.completed = true; dir.proofAttached = !!opts.photoDataUrl; if (opts.note) dir.note = opts.note;
      write(directivesKey(), d);
    }
    return res;
  }
  // lightweight completion toggle (no scoring) — proof is what earns standing
  function completeDirective(id, note) {
    const d = getDailyDirectives();
    const dir = d.list.find(x => x.id === id);
    if (!dir) return { error: 'no-directive' };
    dir.completed = true; if (note) dir.note = note;
    write(directivesKey(), d);
    return { ok: true, directive: dir };
  }

  /* ═══════════════ PROOFS ═══════════════ */
  function getProofs() { return read(KEYS.proofs) || []; }
  function proofsToday() { return getProofs().filter(p => p.date === today()); }
  function isTaskDone(taskId) { return proofsToday().some(p => p.taskId === taskId); }

  /* ═══════════════ XP STORE ═══════════════ */
  function getXp() {
    let x = read(KEYS.xp);
    if (!x) x = { totalXp: 0, todayXp: 0, completedToday: 0, streak: 0, bestStreak: 0, multiplier: 1.0, lastActive: null };
    // roll over a new day
    if (x.lastActive !== today()) { x.todayXp = 0; x.completedToday = 0; }
    x.multiplier = streakMultiplier(x.streak);
    return x;
  }

  // advances the streak for today's first proof; returns true if it *extended*
  // an existing streak (so a "streak maintained" bonus can be awarded once/day)
  function bumpStreak(x) {
    const t = today();
    if (x.lastActive === t) return false;      // already counted today
    const extended = !!(x.lastActive && dayDiff(x.lastActive, t) === 1);
    x.streak = extended ? x.streak + 1 : 1;    // extend, or reset (first ever / gap)
    x.bestStreak = Math.max(x.bestStreak || 0, x.streak);
    return extended;
  }

  /* ═══════════════ SCORES ═══════════════ */
  function getScores() {
    const ob = getOnboarding();
    const x  = getXp();
    const ptBonus  = Math.min(proofsToday().length * 5, 15);
    const potential = clamp(basePotential(ob) + ptBonus, 0, 100);
    const future    = 340 + x.totalXp;          // momentum points, climbs with proof
    const scores = {
      potentialScore: potential,
      futureScore: future,
      trajectory: trajectoryOf(potential),
      proofCount: getProofs().length,
      updated: today()
    };
    write(KEYS.scores, scores);
    return scores;
  }
  function recomputeScores() { return getScores(); }

  // global rank derived from potential (smaller potential ⇒ further back)
  const POOL = 842000;
  function globalRank() {
    const s = getScores().potentialScore;
    return clamp(Math.round((100 - s) / 100 * POOL) + 1, 1, POOL);
  }
  // weekly improvement %, demo-derived from momentum (proof + streak)
  function improvement() {
    const x = getXp();
    return clamp(6 + x.completedToday * 7 + x.streak * 2, 4, 96);
  }

  /* ═══════════════ PROFILE ═══════════════ */
  function buildProfile(ob) {
    ob = ob || getOnboarding() || {};
    const a = (ob.goalAnalysis) || (V.goal && V.goal.analyzeGoal && (ob.goalText || ob.primaryGoal) ? (function () { try { return V.goal.analyzeGoal(ob.goalText || ob.primaryGoal, ob); } catch (e) { return null; } })() : null);
    const prof = {
      name: ob.name || 'You',
      path: pathOf(ob),
      pathName: a ? a.pathIdentity : (pathIdentity(pathOf(ob)).name),
      domain: a ? a.domainLabel : null,
      goal: (ob.goalText || ob.primaryGoal || ''),
      primaryGoal: ob.primaryGoal || ob.goalText || 'Self Improvement',
      spec: ob.spec || '—',
      win: ob.dest || 'Build momentum',
      obstacle: ob.obstacle || (a && a.blockers && a.blockers[0]) || '—',
      joined: today()
    };
    write(KEYS.profile, prof);
    return prof;
  }
  function getProfile() { return read(KEYS.profile) || buildProfile(); }

  /* ═══════════════ LEADERBOARD (demo) ═══════════════ */
  const NAMES = ['Alex M.', 'Jordan T.', 'Priya K.', 'Diego R.', 'Sora N.', 'Mia L.', 'Kofi A.',
                 'Lena V.', 'Omar S.', 'Yuki H.', 'Noah B.', 'Ivy C.', 'Marco D.', 'Sana Q.'];
  const PLACES = {
    momentum:  { label: 'Momentum',  loc: 'rising fastest' },
    friends:   { label: 'Friends',   loc: 'your circle' },
    state:     { label: 'State',     loc: 'NSW' },
    country:   { label: 'Country',   loc: 'Australia' },
    worldwide: { label: 'Worldwide', loc: 'Global' }
  };

  function seedLeaderboard() {
    let lb = read(KEYS.leaderboard);
    if (lb) return lb;
    const mk = (n, seed) => {
      const arr = [];
      for (let i = 0; i < n; i++) {
        arr.push({
          name: NAMES[(i + seed) % NAMES.length],
          xp: Math.round(2600 - i * (60 + seed * 4) + (i % 3) * 40),
          improvement: clamp(58 - i * 3 + ((i * 7 + seed) % 9), 6, 92),
          move: ((i * 5 + seed) % 7) - 3,
          state: ['NSW', 'VIC', 'QLD', 'WA'][(i + seed) % 4],
          country: ['AUS', 'USA', 'GBR', 'CAN'][(i + seed) % 4]
        });
      }
      return arr;
    };
    lb = { momentum: mk(14, 1), friends: mk(7, 3), state: mk(20, 2), country: mk(25, 5), worldwide: mk(30, 7) };
    write(KEYS.leaderboard, lb);
    return lb;
  }

  // returns rows for a scope with the current user inserted & flagged, ranked by improvement
  function getLeaderboard(scope) {
    scope = PLACES[scope] ? scope : 'momentum';
    const lb = seedLeaderboard();
    const rows = (lb[scope] || []).slice();
    const x = getXp();
    const you = {
      name: 'You', you: true,
      xp: x.totalXp,
      improvement: improvement(),
      move: Math.max(0, x.completedToday),
      state: 'NSW', country: 'AUS'
    };
    rows.push(you);
    rows.sort((a, b) => b.improvement - a.improvement || b.xp - a.xp);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { scope, meta: PLACES[scope], rows };
  }

  /* ═══════════════ PERSONAL GOAL STRATEGIST ═══════════════
     Deterministic "goal brain": turns onboarding + proof history into a
     day-by-day blueprint (Day X of Y, days remaining, today's plan, forecast).
     Pure local logic — built to be swapped for AI/backend later. State lives in
     vision_strategy; only startDate + totalDays are sticky, the rest recomputes
     from real photo proof, so the path only advances when effort is proven. */
  const INTENSITY = ['Balanced', 'Committed', 'Obsessed', 'Extreme'];
  const INTENSITY_DAYS = [60, 45, 35, 30];   // base length by intensity index

  const PATH_IDENTITY = {
    study: {
      name: 'The Scholar', why: 'study tasks',
      todayFocus: 'Deep study + screen control', weekFocus: 'Build a daily study rhythm',
      milestones: ['first study streak locked', 'exam-week revision rhythm', 'consistent top-effort proof']
    },
    fitness: {
      name: 'The Athlete', why: 'training tasks',
      todayFocus: 'Train + recover', weekFocus: 'Make training non-negotiable',
      milestones: ['first training streak locked', 'weekly volume target', 'athlete-level consistency']
    },
    money: {
      name: 'The Builder', why: 'builder tasks',
      todayFocus: 'Build the skill that pays', weekFocus: 'Turn effort into income reps',
      milestones: ['first build streak locked', 'first real opportunity action', 'repeatable money habit']
    },
    discipline: {
      name: 'The Operator', why: 'discipline tasks',
      todayFocus: 'Order + deep work', weekFocus: 'Lock in daily self-control',
      milestones: ['first discipline streak locked', 'two-week control rhythm', 'a self-run operating system']
    }
  };
  function pathIdentity(path) { return PATH_IDENTITY[path] || PATH_IDENTITY.discipline; }

  function strategyTarget(ob, path) {
    const id = pathIdentity(path);
    if (ob && ob.dest) return 'Reach ' + ob.dest + ' with consistent photo proof';
    return 'Build a ' + id.name.replace('The ', '').toLowerCase() + '’s rhythm with daily proof';
  }

  // distinct proof days + "full assignment" days from proof history (deterministic)
  function proofDayStats() {
    const byDay = {};
    getProofs().forEach(p => { byDay[p.date] = (byDay[p.date] || 0) + 1; });
    const saved = read(KEYS.tasks);
    const taskCount = Math.max(1, (saved && saved.list) ? saved.list.length : 3);
    const days = Object.keys(byDay);
    return { provenDays: days.length, fullDays: days.filter(d => byDay[d] >= taskCount).length, taskCount };
  }

  // non-shaming pace label from today's completion + streak (no harsh words)
  function paceLabel(ratio, streak) {
    if (ratio >= 1 && streak >= 3) return 'Ahead';
    if (ratio >= 0.5 || streak >= 3) return 'On track';
    if (streak >= 1 || ratio > 0)   return 'Building';
    return 'Slipping';
  }

  function strategyExplanation(ob, path, screenHigh) {
    const id = pathIdentity(path);
    const goal = (ob && ob.primaryGoal) ? ob.primaryGoal.toLowerCase() : 'your goal';
    const obstacle = (ob && ob.obstacle) ? ob.obstacle.toLowerCase() : 'inconsistency';
    let s = 'VISION is giving you ' + id.why + ' because your goal is ' + goal +
            ' and your obstacle is ' + obstacle + '.';
    if (screenHigh) s += ' Your screen time is high, so today includes a phone-free block.';
    return s;
  }

  /* ── coaching copy builders (deterministic, non-shaming) ── */
  const SCREEN_LBL = ['1–2h', '2–4h', '4–6h', '6–8h', '8h+'];
  const EFFORT_LBL = ['under 30 min', '30–60 min', '1–2h', '2–4h', '4h+'];

  // per-path "today's strategic move" (the core coaching headline)
  const STRATEGIC_MOVE = {
    study:      { headline: 'Protect focus before chasing motivation.', principle: 'Make the first action small enough to start, then prove it.' },
    fitness:    { headline: 'Win the day by finishing the session, not perfecting it.', principle: 'Consistency beats intensity — just train, then prove it.' },
    money:      { headline: 'Turn time into output, not just input.', principle: 'Create one visible thing today and prove it.' },
    discipline: { headline: 'Remove friction, then take one protected rep.', principle: 'Make starting easy and let the proof carry the day.' }
  };
  const THEREFORE = {
    study:      'Today focuses on reducing friction and proving one deep, phone-free study block.',
    fitness:    'Today focuses on finishing one session and proving you trained — consistency first.',
    money:      'Today focuses on producing one visible output and proving real action, not consumption.',
    discipline: 'Today focuses on clearing friction and proving one protected deep-work rep.'
  };

  // 3–5 personalised, non-shaming insight lines explaining why the plan exists
  function buildDiagnosis(ob, path, doneToday, totalToday, provenDays) {
    const out = [];
    const obstacle = (ob && ob.obstacle) ? ob.obstacle.toLowerCase() : 'inconsistency';
    out.push('Your obstacle is ' + obstacle + ', so today leads with one low-friction proof.');
    if (ob && ob.screenIdx != null && ob.screenIdx >= 3) out.push('High screen time is narrowing your focus window — today protects it with a phone-free block.');
    if (ob && ob.sleepIdx != null && ob.sleepIdx <= 1) out.push('Sleep is still building, so today’s load stays controlled rather than maxed out.');
    if (path === 'fitness' && ob && ob.trainingIdx != null && ob.trainingIdx <= 1) out.push('Training is still becoming a habit — consistency comes before intensity.');
    if (ob && ob.goalEffortIdx != null && ob.goalEffortIdx <= 1) out.push('Daily effort toward the goal is still low, so we start small enough to actually begin.');
    const pathLine = { study: 'Your goal needs repeated output and recall, not motivation.', fitness: 'Your goal needs reps, not a single perfect session.', money: 'Your goal needs output you create, not more content consumed.', discipline: 'Your goal needs friction removed, not more willpower.' }[path];
    if (pathLine) out.push(pathLine);
    out.push(provenDays === 0 ? 'Consistency is still forming — your first few photo proofs matter most.' : (doneToday > 0 ? doneToday + ' of ' + totalToday + ' proven today — momentum is live, keep it going.' : 'You’ve proven before — today is about restarting the streak.'));
    return out.slice(0, 5);
  }

  // the brain panel: why VISION picked today's strategy
  function buildReasoning(ob, path, doneToday, totalToday) {
    const goal = (ob && ob.primaryGoal) || 'Self Improvement';
    const obstacle = (ob && ob.obstacle) || 'Inconsistency';
    const bullets = ['Goal = ' + goal, 'Obstacle = ' + obstacle];
    if (ob && ob.screenIdx != null) bullets.push('Screen time = ' + (SCREEN_LBL[ob.screenIdx] || '—'));
    if (ob && ob.goalEffortIdx != null) bullets.push('Daily effort = ' + (EFFORT_LBL[ob.goalEffortIdx] || '—'));
    bullets.push('Proof today = ' + doneToday + '/' + totalToday);
    return { bullets: bullets, therefore: THEREFORE[path] || THEREFORE.discipline };
  }

  /* Universal blueprint strategy (any goal). Produces the SAME shape the
     Strategist page consumes, populated from the goal engine. Reuses the
     existing day-count / proof-stat logic so pacing stays consistent. */
  /* Canonical directive → strategist "guided assignment" shape. The Strategist
     page renders the SAME three directives the Tasks page does (one source of
     truth), with the coaching carried on each directive contract. */
  function directiveGuided(t) {
    return {
      id: t.id, title: t.title, xp: t.baseXp,
      difficulty: ENGINE_DIFF_LABEL[t.difficulty] || 'Core',
      time: t.meta, why: t.whyChosen || t.why || '',
      steps: t.steps || [],
      proof: t.proofMustShow || t.proof_required || '',
      goodProof: t.goodProof || ((t.proof_examples_good || []).join(' · ')) || '',
      avoid: t.mistake || t.avoid || ((t.rejection_reasons || [])[0]) || '',
      helps: t.helps || '',
      done: isTaskDone(t.id),
      whyChosen: t.whyChosen || '', mistake: t.mistake || '',
      fallback: t.fallback, upgrade: t.upgrade,
      tags: t.personalization_factors_used || t.tags || [],
      role: t.role || t.kind,
      paceImpact: t.difficulty === 'hard' ? 'A core proof — moves your goal the most today.'
                : t.difficulty === 'core' ? 'Proving this brings your goal closer today.'
                : 'Quick proof — keeps today’s momentum alive.'
    };
  }

  function buildEngineStrategy(ob) {
    const b = engineBundle(ob); if (!b) return null;
    const a = b.analysis, bp = b.blueprint;
    const xp = getXp();
    const tasks = getTasks();
    const ptoday = proofsToday();

    const saved = read(KEYS.strategy) || {};
    const startDate = saved.startDate || today();
    const intensityIdx = (ob && ob.intensityIdx != null) ? ob.intensityIdx : 1;
    let totalDays = saved.totalDays;
    if (!totalDays) {
      const base = INTENSITY_DAYS[intensityIdx] != null ? INTENSITY_DAYS[intensityIdx] : 45;
      totalDays = clamp(Math.round(base * (1.12 - basePotential(ob) / 200)), 30, 60);
    }

    const st = proofDayStats();
    const progressDays = st.provenDays + 0.5 * st.fullDays;
    const currentDay = Math.min(Math.floor(progressDays) + 1, totalDays);
    const daysRemaining = clamp(Math.round(totalDays - progressDays), 1, totalDays);

    const todayObjectives = tasks.map(t => ({ id: t.id, title: t.title, meta: t.meta, baseXp: t.baseXp, difficulty: t.difficulty, done: isTaskDone(t.id) }));
    const doneToday = todayObjectives.filter(o => o.done).length;
    const totalToday = todayObjectives.length;
    const remaining = totalToday - doneToday;
    const assignmentComplete = remaining === 0 && totalToday > 0;

    const forecast = {
      current: daysRemaining,
      ifCompleteToday: clamp(daysRemaining - clamp(remaining + 1, 1, 4), 1, totalDays),
      ifMissToday: clamp(daysRemaining + 2, 1, totalDays + 4)
    };

    const mDays = [Math.max(2, Math.round(totalDays * 0.16)), Math.round(totalDays * 0.4), Math.round(totalDays * 0.72)];
    const milestones = (a.milestoneStyle || []).map((m, i) => ({ day: mDays[i] || mDays[mDays.length - 1], label: m }));
    const nextMilestone = milestones.find(m => m.day > currentDay) || milestones[milestones.length - 1];
    const target = bp.oneSentenceMission;
    const milestoneMap = milestones.concat([{ day: totalDays, label: target, final: true }]);

    // the SAME three canonical directives the Tasks page renders (one source of truth)
    const guidedAssignments = tasks.map(directiveGuided);

    const move = b.daily.todayMove;
    const strategicMove = { headline: move.headline, principle: bp.dailyOperatingRule, why: move.whyItMatters };
    const paceDeltaIfComplete = Math.max(0, daysRemaining - forecast.ifCompleteToday);
    const proofImpact = remaining > 0
      ? 'Completing today’s ' + remaining + ' photo proof' + (remaining > 1 ? 's' : '') + ' can bring your goal up to ' + Math.max(1, paceDeltaIfComplete) + ' day' + (paceDeltaIfComplete === 1 ? '' : 's') + ' closer.'
      : 'Today’s assignment is fully proven — tomorrow’s strategy is unlocked.';
    const reasoningBullets = ['Goal = ' + a.normalizedGoal, 'Domain = ' + a.domainLabel, 'Blocker = ' + (a.blockers[0] || '—'), 'Proof today = ' + doneToday + '/' + totalToday];

    const strategy = {
      goal: a.normalizedGoal, path: a.parentPath, pathName: a.pathIdentity,
      domain: a.domain, domainLabel: a.domainLabel,
      obstacle: cap(a.blockers[0] || 'Inconsistency'), intensity: INTENSITY[intensityIdx] || 'Committed',
      target: target, startDate: startDate, currentDay: currentDay, totalDays: totalDays, daysRemaining: daysRemaining,
      currentPace: (st.provenDays === 0 && doneToday === 0) ? 'Building' : paceLabel(totalToday ? doneToday / totalToday : 0, xp.streak),
      todayFocus: bp.todayFocus, weekFocus: bp.sevenDayTarget,
      milestones: milestones, nextMilestone: nextMilestone,
      todayObjectives: todayObjectives, doneToday: doneToday, totalToday: totalToday, assignmentComplete: assignmentComplete,
      tomorrowPreview: assignmentComplete ? ('Tomorrow: ' + bp.dailyOperatingRule.toLowerCase()) : 'Unlocks after today’s proof',
      forecast: forecast, explanation: bp.whyYouAreStuck,
      guidedAssignments: guidedAssignments,
      diagnosisInsights: b.daily.diagnosis,
      strategicMove: strategicMove,
      reasoningBullets: reasoningBullets, reasoningTherefore: bp.oneSentenceMission,
      proofImpact: proofImpact, paceDeltaIfComplete: paceDeltaIfComplete,
      paceDeltaIfMissed: Math.max(0, forecast.ifMissToday - daysRemaining),
      milestoneMap: milestoneMap,
      nextUnlock: assignmentComplete ? ('Tomorrow: ' + bp.sevenDayTarget) : null,
      completedProofsToday: ptoday.length, lastUpdated: today(),
      // ── NEW universal-blueprint fields (richer pages can read these) ──
      blueprint: bp, analysis: a, proofStandard: bp.proofStandard,
      mission: bp.oneSentenceMission, dailyRule: bp.dailyOperatingRule, whyStuck: bp.whyYouAreStuck,
      sevenDayTarget: bp.sevenDayTarget, thirtyDayTarget: bp.thirtyDayTarget,
      requiredHabits: bp.requiredHabits, safetyNote: bp.safetyNote, engine: true,
      // ── personalisation layer (per-user) ──
      whyPersonalised: b.daily.whyPersonalised || b.daily.diagnosis,
      patternSummary: b.daily.patternSummary, planStyle: b.daily.planStyle,
      tone: b.daily.tone, focus: b.daily.todayFocus,
      personalisation: b.profile
    };
    write(KEYS.strategy, strategy);
    return strategy;
  }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function getStrategy() {
    const ob = getOnboarding();
    // Universal engine drives any free-text goal; legacy 4-path is the fallback.
    if (engineAvailable() && hasGoal(ob)) { const es = buildEngineStrategy(ob); if (es) return es; }
    const path = pathOf(ob);
    const id = pathIdentity(path);
    const xp = getXp();
    const tasks = getTasks();
    const ptoday = proofsToday();

    // sticky fields: set once, then preserved across recomputes
    const saved = read(KEYS.strategy) || {};
    const startDate = saved.startDate || today();
    const intensityIdx = (ob && ob.intensityIdx != null) ? ob.intensityIdx : 1;
    let totalDays = saved.totalDays;
    if (!totalDays) {
      const base = INTENSITY_DAYS[intensityIdx] != null ? INTENSITY_DAYS[intensityIdx] : 45;
      totalDays = clamp(Math.round(base * (1.12 - basePotential(ob) / 200)), 30, 60);
    }

    // progress only advances on real proof; a full assignment day advances faster
    const st = proofDayStats();
    const progressDays = st.provenDays + 0.5 * st.fullDays;
    const currentDay = Math.min(Math.floor(progressDays) + 1, totalDays);
    const daysRemaining = clamp(Math.round(totalDays - progressDays), 1, totalDays);

    // today's objectives — same source the tasks page renders (strategist drives tasks)
    const todayObjectives = tasks.map(t => ({
      id: t.id, title: t.title, meta: t.meta, baseXp: t.baseXp,
      difficulty: t.difficulty, done: isTaskDone(t.id)
    }));
    const doneToday = todayObjectives.filter(o => o.done).length;
    const totalToday = todayObjectives.length;
    const remaining = totalToday - doneToday;
    const assignmentComplete = remaining === 0 && totalToday > 0;

    // forecast = display-only projections (real daysRemaining only moves on proof)
    const forecast = {
      current: daysRemaining,
      ifCompleteToday: clamp(daysRemaining - clamp(remaining + 1, 1, 4), 1, totalDays),
      ifMissToday: clamp(daysRemaining + 2, 1, totalDays + 4)
    };

    // milestones scaled to the plan length
    const mDays = [Math.max(2, Math.round(totalDays * 0.16)), Math.round(totalDays * 0.4), Math.round(totalDays * 0.72)];
    const milestones = id.milestones.map((m, i) => ({ day: mDays[i], label: m }));
    const nextMilestone = milestones.find(m => m.day > currentDay) || milestones[milestones.length - 1];

    const screenHigh = !!(ob && ob.screenIdx != null && ob.screenIdx >= 3);

    // ── coaching layer (the "goal brain" teaching content) ──
    const target = strategyTarget(ob, path);
    // the SAME three canonical directives the Tasks page renders (one source of truth)
    const guidedAssignments = tasks.map(directiveGuided);
    const move = STRATEGIC_MOVE[path] || STRATEGIC_MOVE.discipline;
    const strategicMove = { headline: move.headline, principle: move.principle, why: strategyExplanation(ob, path, screenHigh) };
    const reasoning = buildReasoning(ob, path, doneToday, totalToday);
    const paceDeltaIfComplete = Math.max(0, daysRemaining - forecast.ifCompleteToday);
    const paceDeltaIfMissed = Math.max(0, forecast.ifMissToday - daysRemaining);
    const proofImpact = remaining > 0
      ? 'Completing today’s ' + remaining + ' photo proof' + (remaining > 1 ? 's' : '') + ' can bring your goal up to ' + Math.max(1, paceDeltaIfComplete) + ' day' + (paceDeltaIfComplete === 1 ? '' : 's') + ' closer.'
      : 'Today’s assignment is fully proven — tomorrow’s strategy is unlocked.';
    const milestoneMap = milestones.concat([{ day: totalDays, label: target, final: true }]);
    const strategy = {
      goal: (ob && ob.primaryGoal) || 'Self Improvement',
      path: path, pathName: id.name,
      obstacle: (ob && ob.obstacle) || 'Inconsistency',
      intensity: INTENSITY[intensityIdx] || 'Committed',
      target: target,
      startDate: startDate, currentDay: currentDay, totalDays: totalDays, daysRemaining: daysRemaining,
      // a brand-new path reads "Building", never "Slipping" — no shame on day one
      currentPace: (st.provenDays === 0 && doneToday === 0) ? 'Building'
                   : paceLabel(totalToday ? doneToday / totalToday : 0, xp.streak),
      todayFocus: id.todayFocus, weekFocus: id.weekFocus,
      milestones: milestones, nextMilestone: nextMilestone,
      todayObjectives: todayObjectives, doneToday: doneToday, totalToday: totalToday,
      assignmentComplete: assignmentComplete,
      tomorrowPreview: assignmentComplete
        ? 'Tomorrow: ' + id.weekFocus.toLowerCase() + ' — a fresh assignment is ready.'
        : 'Unlocks after today’s proof',
      forecast: forecast,
      explanation: strategyExplanation(ob, path, screenHigh),
      // ── coaching layer (Strategist page) ──
      guidedAssignments: guidedAssignments,
      diagnosisInsights: buildDiagnosis(ob, path, doneToday, totalToday, st.provenDays),
      strategicMove: strategicMove,
      reasoningBullets: reasoning.bullets,
      reasoningTherefore: reasoning.therefore,
      proofImpact: proofImpact,
      paceDeltaIfComplete: paceDeltaIfComplete,
      paceDeltaIfMissed: paceDeltaIfMissed,
      milestoneMap: milestoneMap,
      nextUnlock: assignmentComplete ? ('Tomorrow: ' + id.weekFocus.toLowerCase() + ' — a fresh assignment is ready.') : null,
      completedProofsToday: ptoday.length,
      lastUpdated: today()
    };
    write(KEYS.strategy, strategy);
    return strategy;
  }
  function recomputeStrategy() { return getStrategy(); }

  /* ═══════════════ LOG PROOF (the core write) ═══════════════
     THE single XP gateway. No photo = no XP — enforced here so the rule
     can't be bypassed even by code that skips the UI. */
  const XP_STREAK_MAINTAINED = 15;   // bonus when an existing streak is extended
  const XP_ASSIGNMENT_COMPLETE = 100; // bonus when the last task of the day is proven

  function logProof(task, opts) {
    opts = opts || {};
    if (!task || !task.id) return { error: 'no-task' };
    if (!opts.photoDataUrl) return { error: 'no-photo' };   // PHOTO PROOF ONLY
    if (isTaskDone(task.id)) return { duplicate: true };

    const x = getXp();
    const streakExtended = bumpStreak(x);
    x.multiplier = streakMultiplier(x.streak);
    const taskXp = Math.round((task.baseXp || 20) * x.multiplier);

    const proof = {
      id: 'pf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      taskId: task.id,
      taskTitle: task.title,
      goalType: task.goalType || pathOf(),
      difficulty: task.difficulty || 'core',
      baseXp: task.baseXp || 20,
      earnedXp: taskXp,
      note: (opts.note || '').slice(0, 280),
      photoDataUrl: opts.photoDataUrl,
      // 'pending' = awaiting AI verification — points shown as estimated only
      verificationStatus: opts.verificationStatus || '',
      timestamp: Date.now(),
      date: today()
    };

    const proofs = getProofs();
    proofs.push(proof);
    write(KEYS.proofs, proofs);

    // bonuses (all still photo-gated — only reachable via a real proof above)
    const streakBonus = streakExtended ? XP_STREAK_MAINTAINED : 0;
    const assignmentComplete = proofsToday().length === getTasks().length;
    const assignmentBonus = assignmentComplete ? XP_ASSIGNMENT_COMPLETE : 0;
    const earnedXp = taskXp + streakBonus + assignmentBonus;

    x.totalXp += earnedXp;
    x.todayXp += earnedXp;
    x.completedToday += 1;
    x.lastActive = today();
    write(KEYS.xp, x);

    const scores = recomputeScores();
    const strategy = recomputeStrategy();   // advance the blueprint from proven effort
    const result = { proof, xp: x, scores, strategy, taskXp, streakBonus, assignmentBonus, assignmentComplete };
    window.dispatchEvent(new CustomEvent('vision:proof-logged', { detail: result }));
    return result;
  }

  /* ═══════════════ FEEDBACK ═══════════════ */
  function saveFeedback(answers) {
    const all = read(KEYS.feedback) || [];
    all.push(Object.assign({ ts: Date.now(), date: today() }, answers));
    write(KEYS.feedback, all);
    return true;
  }
  function getFeedback() { return read(KEYS.feedback) || []; }

  /* ═══════════════ ONBOARDING SAVE (called by onboarding.html) ═══════════════ */
  function saveOnboarding(data) {
    const ob = Object.assign({ ts: Date.now() }, data);
    if (!ob.goalText) ob.goalText = ob.primaryGoal || ob.goalDetail || '';
    // run the universal analysis once at save time and store it (forward-safe)
    if (V.goal && V.goal.analyzeGoal && ob.goalText) {
      try { ob.goalAnalysis = V.goal.analyzeGoal(ob.goalText, ob); } catch (e) {}
    }
    write(KEYS.onboarding, ob);
    buildProfile(ob);
    // store the main goal and regenerate today's directives from it
    setMainGoal(ob.primaryGoal || ob.goalText || ob.goalDetail || '');
    localStorage.removeItem(directivesKey());           // fresh goal ⇒ fresh directives
    const list = getDailyDirectives().list;
    write(KEYS.tasks, { date: today(), path: tasksSig(ob), list });
    localStorage.removeItem(KEYS.strategy);   // fresh goal ⇒ fresh blueprint length/start
    recomputeScores();
    recomputeStrategy();
    return ob;
  }

  /* ═══════════════ RESET (demo) ═══════════════ */
  function reset(keepOnboarding) {
    Object.keys(KEYS).forEach(k => {
      if (keepOnboarding && (k === 'onboarding' || k === 'profile')) return;
      localStorage.removeItem(KEYS[k]);
    });
    if (!keepOnboarding) { localStorage.removeItem('vision_score'); localStorage.removeItem('vision_unlock'); }
  }

  /* ---------- legacy migration (run once) ---------- */
  (function migrate() {
    if (read(KEYS.scores)) return;
    let legacy = parseInt(localStorage.getItem('vision_score') || localStorage.getItem('vision_unlock') || '', 10);
    if (!isNaN(legacy) && legacy > 0) {
      write(KEYS.scores, { potentialScore: clamp(legacy, 0, 100), futureScore: 340 + legacy * 4,
                           trajectory: trajectoryOf(legacy), proofCount: 0, updated: today() });
    }
  })();

  /* ═══════════════ STANDING · identity progression ═══════════════
     The title IS the identity. The percentage is the proof.
     Not "you completed tasks" — "you are becoming someone rare."
     Ten standings, each rarer than the last. Score is built from proven
     action (volume), consistency (streak), and alignment (potential).
     New users begin as Started; only sustained effort reaches Ascended.
     NOTE: `display` is the tier's standing level, an estimate of the user's
     own consistency — NOT a measured ranking against other members. The UI
     labels it as an estimate; do not present it as a live population rank. */
  /* Six deterministic standings. A standing is how consistently a user turns their
     chosen goal into verified real-world action — NOT how elite they already are.
     It is earned from authoritative facts only: verified points, unique proof days,
     and accepted Hard Tasks. Every requirement of a tier must be met to hold it, so
     a user can never rank up from one Task or by repeating tiny Easy Tasks. */
  const STANDING_TIERS = [
    { idx: 0, title: 'Unproven',    display: 'Starting standing',            reqPoints: 0,     reqDays: 0,   reqHard: 0,
      rarity: 'Where everyone begins',
      copy: 'Your standing begins the moment you prove your first real action.',
      sub: 'Nothing is proven yet — that changes with one accepted proof.',
      decree: 'Everyone starts here. Few choose to leave it.' },
    { idx: 1, title: 'Committed',   display: '500 pts · 7 proof days',       reqPoints: 500,   reqDays: 7,   reqHard: 0,
      rarity: 'Beginning to separate',
      copy: 'You have started turning your goal into proven action.',
      sub: 'Action has begun.',
      decree: 'You have decided. That alone sets you apart.' },
    { idx: 2, title: 'Disciplined', display: '2,000 pts · 21 days · 3 hard', reqPoints: 2000,  reqDays: 21,  reqHard: 3,
      rarity: 'Showing up, week after week',
      copy: 'You prove it consistently — not once, but as a pattern.',
      sub: 'Consistency is becoming identity.',
      decree: 'You are becoming someone who does the work.' },
    { idx: 3, title: 'Proven',      display: '6,000 pts · 60 days · 10 hard', reqPoints: 6000,  reqDays: 60,  reqHard: 10,
      rarity: 'A record that speaks for itself',
      copy: 'Sustained, verified effort that the distracted never reach.',
      sub: 'The distracted version of you is far behind.',
      decree: 'You are becoming someone the work cannot break.' },
    { idx: 4, title: 'Relentless',  display: '15,000 pts · 120 days · 25 hard', reqPoints: 15000, reqDays: 120, reqHard: 25,
      rarity: 'Does not stop where others do',
      copy: 'You do not stop where almost everyone else does.',
      sub: 'Stopping is no longer in you.',
      decree: 'You are becoming someone who does not break.' },
    { idx: 5, title: 'Exceptional', display: '35,000 pts · 250 days · 60 hard', reqPoints: 35000, reqDays: 250, reqHard: 60,
      rarity: 'Almost no one sustains this',
      copy: 'You prove at a level almost no one sustains.',
      sub: 'A standing almost no one reaches.',
      decree: 'You are becoming someone the world calls rare.' }
  ];
  // Back-compat alias: older callers reference C.PERCENTILE_TIERS for the ladder.
  const PERCENTILE_TIERS = STANDING_TIERS;

  /* Pure mapping: authoritative facts → standing. Reused by the backend-fact path
     (VISION.api.getStanding) so demo and signed-in resolve to the same model. */
  function standingFor(verifiedPoints, proofDays, hardTasks) {
    verifiedPoints = Math.max(0, Math.round(verifiedPoints || 0));
    proofDays = Math.max(0, Math.round(proofDays || 0));
    hardTasks = Math.max(0, Math.round(hardTasks || 0));
    let idx = 0;
    for (let i = STANDING_TIERS.length - 1; i >= 0; i--) {
      const t = STANDING_TIERS[i];
      if (verifiedPoints >= t.reqPoints && proofDays >= t.reqDays && hardTasks >= t.reqHard) { idx = i; break; }
    }
    const tier = STANDING_TIERS[idx];
    const nextTier = idx < STANDING_TIERS.length - 1 ? STANDING_TIERS[idx + 1] : null;
    const remaining = nextTier ? {
      points: Math.max(0, nextTier.reqPoints - verifiedPoints),
      days:   Math.max(0, nextTier.reqDays   - proofDays),
      hard:   Math.max(0, nextTier.reqHard   - hardTasks)
    } : null;
    let progressPct = 100;
    if (nextTier) {
      const span = (cur, lo, hi) => hi <= lo ? 1 : Math.min(1, Math.max(0, (cur - lo) / (hi - lo)));
      const p = span(verifiedPoints, tier.reqPoints, nextTier.reqPoints);
      const d = span(proofDays,      tier.reqDays,   nextTier.reqDays);
      const h = nextTier.reqHard > tier.reqHard ? span(hardTasks, tier.reqHard, nextTier.reqHard) : 1;
      progressPct = Math.min(99, Math.round(Math.min(p, d, h) * 100));
    }
    return {
      standing: tier.title, tier, nextTier, idx,
      verifiedPoints, proofDays, hardTasks, remaining,
      progressPct, score: verifiedPoints,
      eliteRank: null, eliteTotal: 0, tiers: STANDING_TIERS
    };
  }

  /* Trailing-window activity from real proof history. Reads the local proof
     store, which VISION.api.hydrateLocal() fills from Supabase when signed in,
     so this scoring is backend-ready without any change here. */
  function proofWindows() {
    const proofs = getProofs();
    const t = Date.parse(today());
    const d7 = new Set(), d30 = new Set(), all = new Set();
    proofs.forEach(p => {
      if (!p.date) return;
      all.add(p.date);
      const d = (t - Date.parse(p.date)) / MS_PER_DAY;
      if (d >= 0 && d < 7)  d7.add(p.date);
      if (d >= 0 && d < 30) d30.add(p.date);
    });
    return { total: proofs.length, days7: d7.size, days30: d30.size, provenDays: all.size };
  }

  /* Demo-mode standing facts from the local store. Signed-in users get the
     authoritative version from the server (get_user_standing). */
  function localStandingFacts() {
    const xp = getXp();
    const w = proofWindows();
    let hard = 0;
    try {
      const tasks = (typeof getTasks === 'function') ? getTasks() : [];
      const hardKeys = new Set(tasks.filter(t => String(t.difficulty || '').toLowerCase() === 'hard')
                                    .map(t => t.id || t.key).filter(Boolean));
      const seen = new Set();
      getProofs().forEach(p => {
        const k = p.taskId || p.task_id || p.key;
        const sig = (p.date || '') + '|' + (k || '');
        if (k && hardKeys.has(k) && !seen.has(sig)) { seen.add(sig); hard++; }
      });
    } catch (e) { /* best-effort in demo */ }
    return { verifiedPoints: xp.totalXp || 0, proofDays: w.provenDays || 0, hardTasks: hard };
  }

  function getPercentile() {
    const f = localStandingFacts();
    return standingFor(f.verifiedPoints, f.proofDays, f.hardTasks);
  }

  /* ═══════════════ CATEGORY STANDINGS · a standing for every arena ═══════════════
     Each life category carries its own seven-tier standing with its own titles.
     A user can be Iron Warrior in Fitness and only a Saver in Wealth — the spread
     is the point. Scores derive from proof volume in that arena + streak (for
     Consistency) + a light onboarding base, so standings move with real action.
     MVP heuristic — swappable for a richer per-category signal later. */
  const CATEGORY_TIERS = [
    { display: '50%',   threshold: 0 },
    { display: '25%',   threshold: 12 },
    { display: '10%',   threshold: 28 },
    { display: '5%',    threshold: 50 },
    { display: '1%',    threshold: 80 },
    { display: '0.1%',  threshold: 120 },
    { display: '0.01%', threshold: 170 }
  ];
  // icon = a clean monogram letter (rendered as a premium CSS square — no emoji).
  const CATEGORIES = [
    { key: 'fitness',     icon: 'F', label: 'Fitness',
      titles: ['Casual Lifter', 'Gym Regular', 'Gym Bro', 'True Gym Bro', 'Iron Warrior', 'Fitness Beast', 'Physical Specimen'] },
    { key: 'wealth',      icon: 'W', label: 'Wealth',
      titles: ['Saver', 'Money Mover', 'Money Maker', 'Real Money Maker', 'Wealth Builder', 'Wealth Creator', 'Money Magnet'] },
    { key: 'learning',    icon: 'L', label: 'Learning',
      titles: ['Student', 'Learner', 'Scholar', 'Knowledge Seeker', 'Genius', 'Mastermind', 'Polymath'] },
    { key: 'business',    icon: 'B', label: 'Business',
      titles: ['Worker', 'Builder', 'Operator', 'Deal Maker', 'Entrepreneur', 'Founder', 'Visionary'] },
    { key: 'consistency', icon: 'C', label: 'Consistency',
      titles: ['Showing Up', 'Consistent', 'Locked In', 'Reliable', 'Unbreakable', 'Machine', 'Relentless'] }
  ];

  // the user's goal maps to ONE primary arena (the rest stay secondary in the UI)
  const PATH_PRIMARY_ARENA = { fitness: 'fitness', study: 'learning', money: 'wealth', discipline: 'business' };
  function getPrimaryCategoryKey() { return PATH_PRIMARY_ARENA[pathOf()] || 'consistency'; }

  // personalization: derive arena type from goal text → custom labels per category
  function getArenaType() {
    const ob = getOnboarding() || {};
    const gt = (ob.goalText || ob.primaryGoal || '').toLowerCase();
    if (/soccer|football|basketball|tennis|rugby|hockey|baseball|golf|cricket|sport|athlet|sprint|marathon|runner|swimmer|boxing|fighter|mma/.test(gt)) return 'athlete';
    if (/muscle|gym|fit|physique|weight|abs|body|health|strength|bench|workout|training/.test(gt)) return 'body';
    if (/money|save|earn|income|rich|wealth|\$|millionaire|salary/.test(gt)) return 'money';
    if (/trading|crypto|stocks|invest|forex/.test(gt)) return 'trading';
    if (/agency|business|startup|client|sales|saas|ecommerce|brand|company|entrepreneur/.test(gt)) return 'business';
    if (/exam|test|study|school|university|atar|grade|medicine|doctor|scientist|degree/.test(gt)) return 'study';
    if (/pilot|career|job|lawyer|engineer|nurse|apprentice|apprenticeship|licence|license/.test(gt)) return 'career';
    if (/creator|content|youtube|tiktok|instagram|audience|influencer/.test(gt)) return 'creator';
    return 'custom';
  }

  const ARENA_LABELS = {
    body:     { label: 'Fitness',     identity: 'True Gym Bro' },
    athlete:  { label: 'Athlete',     identity: 'Athlete' },
    money:    { label: 'Money',       identity: 'Money Maker' },
    trading:  { label: 'Trader',      identity: 'Trader' },
    business: { label: 'Business',    identity: 'Founder' },
    study:    { label: 'Scholar',     identity: 'Scholar' },
    career:   { label: 'Career',      identity: 'Professional' },
    creator:  { label: 'Creator',     identity: 'Creator' },
    custom:   { label: 'Consistency', identity: 'Consistent' },
  };

  function getPersonalizedCategory(categoryKey) {
    const defaults = {
      fitness:     { label: 'Fitness',     identity: 'True Gym Bro' },
      wealth:      { label: 'Money',       identity: 'Money Maker' },
      learning:    { label: 'Learning',    identity: 'The Genius' },
      business:    { label: 'Discipline',  identity: 'Locked In' },
      consistency: { label: 'Consistency', identity: 'Machine Mode' },
    };
    const primary = getPrimaryCategoryKey();
    if (categoryKey !== primary) return defaults[categoryKey];
    const arena = getArenaType();
    return ARENA_LABELS[arena] || defaults[categoryKey];
  }

  function getRelevantCategoryKeys() {
    return [getPrimaryCategoryKey()];
  }

  // map a proof's goalType (legacy path bucket) → category keys it feeds
  function proofCategoryKeys(goalType) {
    switch (goalType) {
      case 'fitness':    return ['fitness'];
      case 'study':      return ['learning'];
      case 'money':      return ['wealth', 'business'];   // money proofs feed both
      case 'discipline': return ['business'];
      default:           return [];
    }
  }

  function categoryStandingIndex(score) {
    let idx = 0;
    for (let i = 0; i < CATEGORY_TIERS.length; i++) if (score >= CATEGORY_TIERS[i].threshold) idx = i;
    return idx;
  }

  function getCategoryStandings() {
    const proofs = getProofs();
    const xp = getXp();
    const streak = xp.streak || 0;
    const t = Date.parse(today());

    // Each arena rises ONLY from proof related to that arena (by goalType):
    //   volume (each matching proof) + sustained work (distinct active days).
    const tally = { fitness: 0, wealth: 0, learning: 0, business: 0, consistency: 0 };
    const arenaDays = { fitness: new Set(), wealth: new Set(), learning: new Set(), business: new Set() };
    const allDays = new Set(), days7 = new Set();
    proofs.forEach(p => {
      if (!p.date) return;
      allDays.add(p.date);
      const d = (t - Date.parse(p.date)) / MS_PER_DAY;
      if (d >= 0 && d < 7) days7.add(p.date);
      proofCategoryKeys(p.goalType).forEach((k, i) => {
        tally[k] += (i === 0 ? 12 : 7);                 // primary arena weighted over secondary
        if (arenaDays[k]) arenaDays[k].add(p.date);
      });
    });
    // reward sustained effort in each arena (distinct days it was proven)
    ['fitness', 'wealth', 'learning', 'business'].forEach(k => { tally[k] += arenaDays[k].size * 3; });
    // Consistency is the cross-cutting arena: streak + total active days + recent rhythm
    tally.consistency += streak * 6 + allDays.size * 4 + days7.size * 3;

    const primaryKey = getPrimaryCategoryKey();
    return CATEGORIES.map(c => {
      const score = Math.round(tally[c.key] || 0);
      const idx = categoryStandingIndex(score);
      const t = CATEGORY_TIERS[idx];
      const nextT = idx < CATEGORY_TIERS.length - 1 ? CATEGORY_TIERS[idx + 1] : null;
      const floor = t.threshold, ceil = nextT ? nextT.threshold : floor + 60;
      return {
        key: c.key, icon: c.icon, label: c.label, primary: c.key === primaryKey,
        title: c.titles[idx], display: t.display, standingIndex: idx, score,
        nextTitle: nextT ? c.titles[idx + 1] : null,
        nextDisplay: nextT ? nextT.display : null,
        progressPct: Math.min(99, Math.round(((score - floor) / Math.max(1, ceil - floor)) * 100)),
        atTop: idx === CATEGORY_TIERS.length - 1
      };
    });
  }

  // the arena with the lowest current score — every user gets one clear target
  function getWeakestCategory() {
    const cats = getCategoryStandings();
    let w = cats[0];
    cats.forEach(c => { if (c.score < w.score || (c.score === w.score && c.standingIndex < w.standingIndex)) w = c; });
    return w;
  }

  /* ═══════════════ LEADERBOARD ACCESS · locked until ELITE ═══════════════
     Rankings are a privilege of standing. Started→Driven see nothing.
     Elite unlocks the board; each rarer tier opens a more exclusive world,
     culminating in Ascended being ranked only against other Ascended. */
  function getLeaderboardAccess() {
    const p = getPercentile();
    const idx = p.tiers.indexOf(p.tier);   // 0 = Ascended … 9 = Started
    const ELITE_IDX = 4;                    // Elite = Top 10%
    const unlocked = idx <= ELITE_IDX;
    let level = 'locked', label = 'Higher Standings Locked',
        description = 'Earned access — opens at ELITE, Top 10%. Proof is the only key.', rankText = null;

    if (idx === 0) {                                   // Ascended
      level = 'ascended'; label = 'The Ascended Circle';
      description = 'You are ranked only against other Ascended.';
      if (p.eliteRank) rankText = 'Rank #' + p.eliteRank + ' of ' + p.eliteTotal;
    } else if (idx === 1) {                            // Legendary
      level = 'uncommon'; label = 'Exclusive Leaderboard';
      description = 'An exclusive board, open only to Legendary and above.';
    } else if (idx === 2) {                            // Exceptional
      level = 'exceptional'; label = 'Global Rankings';
      description = 'You can now view the global rankings.';
    } else if (idx <= ELITE_IDX) {                     // Elite (and Relentless)
      level = 'elite'; label = 'Leaderboard Unlocked';
      description = 'You have entered the rankings. The world opens up.';
    } else {                                           // Started → Driven
      const elite = p.tiers[ELITE_IDX];
      description = 'Earned at ELITE — Top ' + elite.display + '. Climb there with proof.';
    }
    return { unlocked, level, label, description, idx, eliteIdx: ELITE_IDX, rankText, tier: p.tier };
  }

  /* ═══════════════ PUBLIC API ═══════════════ */
  V.core = {
    KEYS, read, write, today, setTimezone, getTimezone,
    // standing (deterministic 6-tier progression)
    getPercentile, PERCENTILE_TIERS, STANDING_TIERS, standingFor,
    // difficulty → verified points / label
    XP_BY_DIFF, difficultyLabel, taskBasePoints,
    // category standings + leaderboard access
    getCategoryStandings, getWeakestCategory, getPrimaryCategoryKey, getArenaType, getPersonalizedCategory, getRelevantCategoryKeys, getLeaderboardAccess, CATEGORIES, CATEGORY_TIERS,
    // onboarding / profile
    getOnboarding, saveOnboarding, pathOf, getProfile, buildProfile,
    // scores
    getScores, recomputeScores, basePotential, trajectoryOf, globalRank, improvement,
    // tasks / proofs
    getTasks, tasksFor, getProofs, proofsToday, isTaskDone, logProof,
    // main goal → daily directives (the core loop)
    getMainGoal, setMainGoal, detectGoalType, getDailyDirectives, generateDirectives,
    attachDirectiveProof, completeDirective,
    // daily 2-tap constraints (time + energy) + the context the selector reads
    getDailyConstraints, setDailyConstraints, directiveContext, directiveHistory,
    personalizationSummary,
    // strategist (personal goal blueprint)
    getStrategy, recomputeStrategy, pathIdentity,
    // xp / ranks
    getXp, rankForXp, streakMultiplier, RANKS, XP_BY_DIFF,
    // shared constants
    MS_PER_DAY, VALID_MINUTES, VALID_ENERGY, INTENSITY,
    // leaderboard
    getLeaderboard, seedLeaderboard, PLACES,
    // feedback / reset
    saveFeedback, getFeedback, reset
  };
})(window.VISION);
