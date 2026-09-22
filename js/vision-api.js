/* ═══════════════════════════════════════════════════════════════
   vision-api.js — VISION async data layer (Supabase-backed)
   ---------------------------------------------------------------
   Mirrors the shapes returned by VISION.core (the localStorage demo
   layer) so page render() functions barely change — they just await.
   Used when a real backend session exists; otherwise pages fall back
   to VISION.core (demo mode).

   Points are NEVER computed here. submitProof() uploads the photo, calls
   submit_proof() (which only records a 'checking' proof — it never awards),
   then calls the validate-proof Edge Function with ONLY the proof_id. The
   server verifies the image and awards via finalize_proof_decision — the sole
   awarder (no accepted proof = no points, enforced server-side).

   Public API: window.VISION.api
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';
  var sb = V.sb, C = V.core, A = V.auth;
  if (!sb || !C || !A) { return; } // demo mode — no api layer

  function today() { return C.today(); }

  /* C.today() resolves the user's local day from their saved canonical IANA
     timezone. It is synchronous (30-odd call sites depend on that), so the
     zone has to be in place before the first read. This fetches it once per
     session and hands it to the core; the core also persists it, so a warm
     reload is already correct before this resolves.

     Every caller that reads or writes a dated row must await this first,
     otherwise the client can read one day while the server writes another --
     which is exactly how a founder's carried-forward task renders as an empty
     day. */
  var tzPrimed = null;
  function primeTimezone() {
    if (tzPrimed) return tzPrimed;
    tzPrimed = (async function () {
      try {
        var id = await uid(); if (!id) return null;
        var r = await sb.from('profiles').select('timezone').eq('id', id).maybeSingle();
        var tz = r && r.data && r.data.timezone;
        if (tz) C.setTimezone(tz);
        return tz || null;
      } catch (e) { return null; }
    })();
    return tzPrimed;
  }
  async function uid() { var u = await A.getUser(); return u ? u.id : null; }

  function dataURLtoBlob(d) {
    var a = d.split(','), m = (a[0].match(/:(.*?);/) || [null, 'image/jpeg'])[1];
    var b = atob(a[1]), n = b.length, u8 = new Uint8Array(n);
    while (n--) { u8[n] = b.charCodeAt(n); }
    return new Blob([u8], { type: m });
  }

  // Re-encode an HEIC/HEIF blob as JPEG via canvas fallback.
  // Returns the original blob unchanged if re-encoding fails.
  async function heicToJpeg(blob) {
    if (typeof createImageBitmap !== 'function') return blob;
    try {
      var img = await createImageBitmap(blob);
      var ratio = 1;
      if (img.width > 4096 || img.height > 4096) { ratio = Math.min(4096 / img.width, 4096 / img.height); }
      var w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
      var c = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : (function(){ var cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv; })();
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      var jpeg = typeof c.convertToBlob === 'function'
        ? await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 })
        : await new Promise(function (res) { c.toBlob(function (b) { res(b); }, 'image/jpeg', 0.88); });
      img.close();
      return jpeg;
    } catch (e) { return blob; }
  }

  /* ───────── reads ───────── */
  async function getProfile() {
    var id = await uid(); if (!id) return null;
    var r = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
    var p = r.data || {};
    return { name: p.display_name || p.username || 'You', path: p.path || 'discipline',
             primaryGoal: p.main_goal || '', obstacle: p.obstacle || '', spec: '', win: '',
             username: p.username, inviteCode: p.invite_code, joined: p.created_at,
             desiredTaskCount: p.desired_task_count,
             // personalisation fields — additive, no breaking changes
             pathType: p.path_type || '', goalCategory: p.goal_category || '',
             goalRole: p.goal_role || '', sportRole: p.sport_role || '',
             currentLevel: p.current_level || '', targetLevel: p.target_level || '',
             mainSkillGap: p.main_skill_gap || '',
             mainBlocker: p.main_blocker || p.biggest_blocker || '',
             preferredTaskMinutes: p.preferred_task_minutes || 0,
             preferredTime: p.preferred_time || '',
             preferredProofType: p.preferred_proof_type || '',
             dailyStrategy: p.daily_strategy || '',
             onboardingSummary: p.onboarding_summary || '' };
  }

  async function getScores() {
    var id = await uid(); if (!id) return null;
    var s = (await sb.from('scores').select('*').eq('user_id', id).maybeSingle()).data || {};
    var pc = await sb.from('proofs').select('id', { count: 'exact', head: true }).eq('user_id', id);
    return { potentialScore: s.potential_score || 0, futureScore: s.future_score || 340,
             trajectory: C.trajectoryOf(s.potential_score || 0), proofCount: pc.count || 0 };
  }

  async function getXp() {
    var id = await uid(); if (!id) return null;
    var s = (await sb.from('scores').select('*').eq('user_id', id).maybeSingle()).data || {};
    var ct = await sb.from('proofs').select('id', { count: 'exact', head: true })
                     .eq('user_id', id).eq('date', today());
    return { totalXp: s.total_xp || 0, todayXp: s.today_xp || 0, completedToday: ct.count || 0,
             streak: s.streak || 0, bestStreak: s.best_streak || 0,
             multiplier: s.multiplier || 1, lastActive: s.last_active,
             dailyProofScore: s.daily_proof_score || 0 };
  }

  /* ── standing from authoritative facts ─────────────────────────────────────
     Delegates to VISION.core.standingFor so demo and signed-in resolve to the
     SAME deterministic 6-tier model (verified points + proof days + Hard Tasks). */
  function standingFromFacts(verifiedPoints, proofDays, hardTasks) {
    var sFor = window.VISION && VISION.core && VISION.core.standingFor;
    if (!sFor) return null;
    return sFor(verifiedPoints, proofDays, hardTasks);
  }

  /* ── single combined state loader ─────────────────────────────────────────
     Returns one normalised object derived exclusively from Supabase data.
     Standing is computed via the get_user_standing() RPC which runs the same
     proof-window formula as VISION.core.getPercentile() — but server-side, so
     it never depends on localStorage being hydrated first.
     hydrateLocal() still runs in parallel to keep localStorage warm for
     offline use and legacy page paths. */
  async function getCanonicalAppState() {
    var id = await uid(); if (!id) return null;
    // Fan out: hydrate localStorage in parallel with all Supabase reads.
    // get_user_standing is the authoritative standing source — no localStorage dependency.
    var results = await Promise.all([
      getProfile(),
      getXp(),
      getScores(),
      getTasks(),
      hydrateLocal().catch(function () { return false; }),
      sb.rpc('get_user_standing').then(function (r) { return r.data || null; }).catch(function () { return null; })
    ]);
    var profile = results[0] || {}, xp = results[1] || {};
    var scores = results[2] || {}, tasks = results[3] || [];
    var standingRow = results[5]; // {verified_points, proof_days, hard_tasks, standing, next_standing, remaining, ...}

    // Derive standing from authoritative backend facts (preferred); fall back to
    // localStorage-based getPercentile only when offline.
    var pct = null;
    var backendOk = standingRow && typeof standingRow.verified_points === 'number';
    if (backendOk) {
      pct = standingFromFacts(standingRow.verified_points, standingRow.proof_days, standingRow.hard_tasks);
    }
    if (!pct || !pct.tier) {
      try { pct = window.VISION && VISION.core && VISION.core.getPercentile && VISION.core.getPercentile(); } catch (e) {}
    }

    var standing = (pct && pct.tier)
      ? { score: Math.round(pct.verifiedPoints != null ? pct.verifiedPoints : (pct.score || 0)),
          name: pct.tier.title, display: pct.tier.display, progressPct: pct.progressPct || 0,
          nextName: pct.nextTier ? pct.nextTier.title : null,
          verifiedPoints: pct.verifiedPoints, proofDays: pct.proofDays, hardTasks: pct.hardTasks,
          remaining: pct.remaining || null, nextTier: pct.nextTier || null,
          backendVerified: !!backendOk }
      : null; // null = genuinely unknown (offline + no cached data) — pages handle gracefully

    // Compute today's authoritative facts from proofs + awards (must match)
    var verifiedPointsToday = 0;
    var acceptedProofsToday = 0;
    try {
      const currentUid = await uid();
      verifiedPointsToday = await getVerifiedPointsToday();
      var todayProofs = (await sb.from('proofs').select('id', { count: 'exact', head: true })
        .eq('user_id', currentUid).eq('date', today()).eq('decision', 'accepted')).count || 0;
      acceptedProofsToday = todayProofs;
    } catch (e) { /* best effort */ }

    // Ensure xp object carries the canonical today values for consumers that still read it
    xp = xp || {};
    xp.verifiedPointsToday = verifiedPointsToday;
    xp.acceptedProofsToday = acceptedProofsToday;

    return { profile: profile, xp: xp, scores: scores, tasks: tasks, standing: standing,
             verifiedPointsToday: verifiedPointsToday, acceptedProofsToday: acceptedProofsToday,
             currentTask: tasks.find(function (t) { return !t.done; }) || tasks[0] || null };
  }

  /* ── canonical daily directives (backend) ──
     Build the SAME 3 directives (Core/Momentum/Edge) the demo layer produces,
     via the shared selector in tasks-library.js, then persist them through
     set_daily_plan (server CLAMPS XP by difficulty). Falls back to the legacy
     generate_daily_tasks RPC for users with no goal. submit_proof/RLS untouched. */
  // human-readable phrase for a blocker key, for personalised copy
  var BLOCKER_PHRASE = {
    phone: 'getting pulled into your phone', confidence: 'doubting yourself',
    unclear: 'not knowing where to start', energy: 'low energy',
    time: 'not having enough time', fear: 'fear of starting',
    resources: 'not having the right setup', inconsistency: 'breaking your streak',
    procrastination: 'putting it off', 'no-plan': 'having no plan'
  };
  function humanBlocker(b) {
    if (!b) return '';
    var key = String(b).toLowerCase().trim();
    return BLOCKER_PHRASE[key] || key;
  }
  // a specific, profile-aware reason (NEVER the generic "Based on: ...") — ties the
  // directive to the user's goal domain, biggest blocker and preferred time budget.
  function personalWhy(d, ctx) {
    ctx = ctx || {};
    var mins = ctx.preferredMinutes || d.time_estimate_minutes || null;
    var blk = humanBlocker(ctx.blocker);
    var domain = (ctx.goalDomain || ctx.arena || '').toString().replace(/[-_]/g, ' ').trim();
    var span = mins ? (mins + '-minute ') : '';
    var aim = domain ? ('your ' + domain + ' goal') : 'your goal';
    var s = blk
      ? ('Because ' + blk + ' is what holds you back most, this ' + span + (d.kind || 'core') + ' task is built to beat it and push ' + aim + ' forward today.')
      : ('This ' + span + (d.kind || 'core') + ' task is chosen to move ' + aim + ' forward today.');
    if (ctx.pathIdentity) s += ' ' + ctx.pathIdentity + ' show up for this one.';
    return s;
  }
  // a concrete harder variant (object → persisted in the upgrade_task jsonb column)
  function buildUpgrade(d, ctx) {
    var base = d.time_estimate_minutes || (ctx && ctx.preferredMinutes) || 20;
    return {
      title: (d.task_title || "Today's task") + ' -- then push one level harder',
      est_minutes: Math.round(base * 1.5) + ' min',
      note: 'Add ~50% more time or a tougher set. This is the version that separates a strong day from an average one.'
    };
  }
  function directiveToRpc(d, ctx) {
    return {
      key: d.task_id, title: d.task_title,
      meta: d.time_estimate_minutes + ' min', est_minutes: d.time_estimate_minutes + ' min',
      difficulty: d.difficulty,                       // easy|core|hard bucket (server re-clamps XP)
      role: d.kind, why: d.why_this_matters, helps: d.why_this_matters, steps: d.steps,
      proof_prompt: d.proof_required, proof_must_show: d.proof_required,
      proof_reject_if: (d.rejection_reasons || []).join('; '),
      good_proof_examples: d.proof_examples_good || [],
      // ── personalised extras (persisted by set_daily_plan; clamped server + here) ──
      why_personalised: personalWhy(d, ctx).slice(0, 500),
      mistake_to_avoid: ((d.rejection_reasons || [])[0] || '').slice(0, 300),
      fallback_task: d.fallback_version || null,
      upgrade_task: buildUpgrade(d, ctx),
      personalisation_tags: d.personalization_factors_used || []
    };
  }
  function buildSelectorTasks(ob, constraints, history, behaviour) {
    if (!(V.tasks && V.tasks.selectDailyDirectives)) return null;
    var goal = ob.goalText || ob.primaryGoal || ob.goalDetail || (ob.goalAnalysis && ob.goalAnalysis.rawGoal) || '';
    if (!goal && !ob.goalAnalysis) return null;
    var ga = ob.goalAnalysis || null;
    var arena = (C && C.pathOf) ? C.pathOf(ob) : ((ga && ga.parentPath) || 'discipline');
    var blocker = ob.obstacle || ob.goal_blocker || ob.goalBlocker || ob.block || ob.distraction ||
                  (ga && ga.blockers && ga.blockers[0]) || '';
    // full-profile personalisation context — re-derived via the SAME helper onboarding uses
    var pp = null;
    try { if (V.goal && V.goal.buildPersonalisationProfile) pp = V.goal.buildPersonalisationProfile({ onboarding: ob, analysis: ga }); } catch (e) {}
    var ctx = {
      goal: goal, arena: arena, blocker: blocker,
      streak: (behaviour && behaviour.streak) || 0, missedYesterday: !!(behaviour && behaviour.missedYesterday),
      planStyle: ob.plan_style || ob.planStyle || (pp && pp.style && pp.style.planStyle) || '',
      preferredMinutes: ob.preferred_task_minutes || (pp && pp.capacity && pp.capacity.minutes) || (constraints && constraints.minutes) || null,
      preferredProofType: ob.preferred_proof_type || (pp && pp.style && pp.style.proofPreference) || '',
      goalDomain: ob.goal_domain || (ga && ga.domain) || '',
      pathIdentity: ob.path_identity || (ga && ga.pathIdentity) || '',
      age: ob.age || null, bodyBase: ob.bodyBase || ob.body_base || null
    };
    try {
      var directives = V.tasks.selectDailyDirectives(ctx, constraints || { minutes: 15, energy: 'normal' }, history || {});
      return (directives || []).map(function (d) { return directiveToRpc(d, ctx); });
    } catch (e) { return null; }
  }
  // last-7-day template ids + yesterday's per-kind proof requirement (anti-repeat)
  async function backendDirectiveHistory() {
    var id = await uid(); if (!id) return {};
    var t0 = today();
    var sevenAgo = new Date(Date.parse(t0) - 7 * C.MS_PER_DAY).toISOString().slice(0, 10);
    var rows = (await sb.from('daily_tasks').select('task_key,role,proof_must_show,date')
                  .eq('user_id', id).gte('date', sevenAgo).lt('date', t0).order('date', { ascending: true })).data || [];
    var yest = new Date(Date.parse(t0) - C.MS_PER_DAY).toISOString().slice(0, 10);
    var yp = {};
    rows.forEach(function (r) { if (r.date === yest && r.role) yp[r.role] = r.proof_must_show; });
    return { date: t0, recentTemplateIds: rows.map(function (r) { return r.task_key; }), yesterdayProofRequired: yp };
  }
  // resolve the goal context (prefer hydrated local; else read the backend row)
  async function loadGoalContext() {
    var ob = (C && C.getOnboarding && C.getOnboarding()) || {};
    if (ob.goalAnalysis || ob.goalText) return ob;
    var id = await uid(); if (!id) return ob;
    var row = (await sb.from('onboarding_answers').select('raw,goal_analysis')
                 .eq('user_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
    if (row) {
      var r = Object.assign({}, row.raw || {});
      if (row.goal_analysis) r.goalAnalysis = row.goal_analysis;
      if (!r.goalText && r.goalAnalysis) r.goalText = r.goalAnalysis.rawGoal;
      return r;
    }
    return ob;
  }
  // light behaviour signal for the personalisation layer (streak / miss / today)
  async function backendHistory() {
    try {
      var id = await uid(); if (!id) return {};
      var s = (await sb.from('scores').select('streak,last_active').eq('user_id', id).maybeSingle()).data || {};
      var tcount = (await sb.from('proofs').select('id', { count: 'exact', head: true }).eq('user_id', id).eq('date', today())).count || 0;
      return { streak: s.streak || 0, completedToday: tcount, missedYesterday: ((s.streak || 0) === 0 && !!s.last_active) };
    } catch (e) { return {}; }
  }
  /* ── daily constraints (time + energy), per user per date — Supabase-backed ── */
  async function getDailyConstraints() {
    var id = await uid(); if (!id) return { minutes: 15, energy: 'normal', set: false, source: 'default' };
    var t = (await sb.from('daily_constraints').select('time_minutes,energy').eq('user_id', id).eq('date', today()).maybeSingle()).data;
    if (t) return { minutes: t.time_minutes, energy: t.energy, set: true, source: 'today' };
    var last = (await sb.from('daily_constraints').select('time_minutes,energy').eq('user_id', id).lt('date', today()).order('date', { ascending: false }).limit(1).maybeSingle()).data;
    if (last) return { minutes: last.time_minutes, energy: last.energy, set: false, source: 'last' };
    return { minutes: 15, energy: 'normal', set: false, source: 'default' };
  }
  async function setDailyConstraints(minutes, energy) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var r = await sb.rpc('set_daily_constraints', { p_minutes: minutes, p_energy: energy });
    if (r.error) return { error: r.error.message };
    var d = r.data || {};
    return { minutes: d.time_minutes != null ? d.time_minutes : minutes, energy: d.energy || energy, set: true, source: 'today' };
  }

  /* ═══════════════════════════════════════════════════════════════════
     TASK REGENERATION CONTRACT
     ---------------------------------------------------------------------
     One clean path used by onboarding-complete, redo-onboarding, the daily
     auto-seed and the manual Refresh button. It FORCES OpenAI generate-tasks
     against the user's CURRENT saved profile, persists via set_daily_plan
     (which keeps today's already-proven tasks + all proof/XP rows), and only
     ever falls back to PATH-SPECIFIC tasks built from the current goal — never
     the generic local fitness/sleep selector when a real goal exists.
     ═══════════════════════════════════════════════════════════════════ */

  // domain → words that SHOULD appear (pos) and words that signal a WRONG,
  // leftover path (neg). Used to detect a stale set after a goal change.
  var ANCHOR_BANK = {
    money:      { pos: ['money','income','revenue','client','lead','offer','sale','sales','service','business','outreach','product','customer','quote','invoice','profit','pricing','cash'],
                  neg: ['protein','wind-down','wind down','bodyweight','squat','plank','conditioning','macros','reps','sets'] },
    fitness:    { pos: ['workout','training','rep','set','strength','stamina','cardio','muscle','gym','run','mobility','exercise','form','lift'],
                  neg: ['invoice','outreach','cold email','sales call','lead list'] },
    study:      { pos: ['study','revision','exam','question','past paper','notes','topic','practice','recall','concept','flashcard','essay'],
                  neg: ['protein','bodyweight','squat','invoice','outreach'] },
    exam:       { pos: ['exam','past paper','timed','question','topic','revision','mark','recall','practice'],
                  neg: ['protein','bodyweight','squat','invoice','outreach'] },
    language:   { pos: ['vocabulary','grammar','speaking','listening','pronunciation','conversation','reading','phrase','word','immersion','sentence'],
                  neg: ['protein','bodyweight','squat','invoice','outreach'] },
    discipline: { pos: ['focus','deep work','distraction','routine','timer','block','consistency','habit','reflection','pomodoro'],
                  neg: ['protein','squat','invoice'] },
    sport:      { pos: ['drill','technique','training','match','session','skill','footwork','practice','game'],
                  neg: ['invoice','outreach','protein shake'] },
    soccer:     { pos: ['soccer','football','ball','pitch','goal','finishing','passing','dribbling','touch','training'],
                  neg: ['invoice','outreach'] },
    career:     { pos: ['job','interview','application','resume','cv','career','role','portfolio','networking','linkedin'],
                  neg: ['protein','bodyweight','squat'] },
    content:    { pos: ['video','post','content','channel','audience','script','hook','thumbnail','reel','upload'],
                  neg: ['protein','bodyweight','squat'] },
    creative:   { pos: ['write','draw','paint','produce','record','create','draft','page','design','piece'],
                  neg: ['protein','bodyweight','squat'] },
    confidence: { pos: ['conversation','social','speak','approach','eye contact','people','initiate'],
                  neg: ['protein','bodyweight','squat','invoice'] },
    health_habit:{ pos: ['water','meal','nutrition','habit','eat','calorie','protein','hydration'],
                  neg: ['invoice','outreach','cold email'] },
    sleep_routine:{ pos: ['sleep','wind down','wind-down','wake','bedtime','screen','morning','routine'],
                  neg: ['invoice','outreach','sales call'] },
    screen_time:{ pos: ['phone','screen','app','offline','scroll','limit','notification'],
                  neg: ['invoice','outreach'] }
  };
  var GOAL_DOMAIN_HINTS = [
    ['money',    /\bmoney\b|income|revenue|\$|\bk\/?mo|per month|\bsave\b|saving|\bdebt\b|\binvest|business|client|sell|sales|\bearn|salary|rich|profit|side hustle|freelanc|agency|startup/],
    ['fitness',  /\bfit(ness)?\b|\bgym\b|muscle|physique|\babs\b|lose (weight|fat)|strength|bulk|shred|workout|push.?up|pull.?up|cardio|stronger|six.?pack/],
    ['language', /japanese|spanish|french|mandarin|chinese|korean|arabic|german|italian|punjabi|hindi|fluent|language/],
    ['exam',     /\batar\b|\bsat\b|\bgmat\b|\bgre\b|ielts|\bbar exam\b|nclex|driving test|past paper/],
    ['study',    /study|exam|revision|maths?|\bgpa\b|degree|homework|biology|chemistry|physics|essay/],
    ['soccer',   /soccer|football|striker|winger|midfield|goalkeep/],
    ['sport',    /cricket|basketball|tennis|boxing|\bmma\b|rugby|swim|sprint|athlet|sport/],
    ['content',  /youtube|tiktok|instagram|channel|content creat|streamer|followers|subscribers/],
    ['career',   /\bcareer\b|\bjob\b|interview|resume|\bcv\b|promotion|lawyer|engineer|developer/],
    ['confidence',/confidence|confident|talk to|social skills|shy|outgoing/],
    ['discipline',/disciplin|procrastinat|lazy|consistent|productive|lock in|focus more/],
    ['sleep_routine',/sleep|wake up|bedtime|morning routine|night routine/],
    ['screen_time',/screen.?time|phone addict|stop scrolling|less phone/]
  ];
  function domainKeyFor(profile) {
    profile = profile || {};
    var cat = String(profile.goal_category || profile.goalCategory || '').toLowerCase().trim();
    if (cat && ANCHOR_BANK[cat]) return cat;
    var dom = String(profile.goal_domain || profile.goalDomain || '').toLowerCase().trim();
    if (dom && ANCHOR_BANK[dom]) return dom;
    var path = String(profile.path || '').toLowerCase().trim();
    var PATH_MAP = { money: 'money', fitness: 'fitness', study: 'study' };
    if (PATH_MAP[path]) return PATH_MAP[path];
    var goal = String(profile.main_goal || profile.primaryGoal || profile.goalText || '').toLowerCase();
    for (var i = 0; i < GOAL_DOMAIN_HINTS.length; i++) {
      if (GOAL_DOMAIN_HINTS[i][1].test(goal)) return GOAL_DOMAIN_HINTS[i][0];
    }
    return null;
  }
  // significant goal words (>=4 chars, not stopwords) as extra positive anchors
  function goalWordAnchors(profile) {
    var goal = String((profile && (profile.main_goal || profile.primaryGoal || profile.goalText)) || '').toLowerCase();
    var stop = /^(want|wanna|need|would|like|going|start|learn|become|better|improve|getting|trying|working|really|every|daily|myself|self|month|make|more|with|that|this|into|your|their|some)$/;
    return goal.split(/[^a-z0-9]+/).filter(function (w) { return w.length >= 4 && !stop.test(w); }).slice(0, 6);
  }
  function buildProfileAnchors(profile) {
    var key = domainKeyFor(profile);
    var bank = key ? ANCHOR_BANK[key] : null;
    var words = goalWordAnchors(profile);
    if (!bank && !words.length) return null;
    return {
      domain: key || 'custom',
      domainKnown: !!bank,                              // only banked domains are reliably detectable
      pos: (bank ? bank.pos : []).concat(words),
      neg: bank ? bank.neg : []
    };
  }
  function taskText(t) {
    return [t.title, t.proofPrompt, t.proof_prompt, t.whyPersonalised, t.why_personalised, t.why, t.meta, t.helps]
      .filter(Boolean).join(' ').toLowerCase();
  }
  // STALE = the set clearly belongs to a different path than the current profile.
  // Conservative: only true when tasks miss EVERY current-domain word, or carry a
  // forbidden cross-domain word while missing every current-domain word.
  function isTaskSetStaleForProfile(tasks, profile) {
    if (!tasks || !tasks.length) return true;
    var a = buildProfileAnchors(profile);
    // only flag stale for a KNOWN domain bank (money/fitness/study/…). Custom/unknown
    // goals are left alone so a paraphrased-but-correct set can't loop the regenerator.
    if (!a || !a.domainKnown || !a.pos.length) return false;
    var texts = tasks.map(taskText);
    var anyPos = texts.some(function (x) { return a.pos.some(function (k) { return x.indexOf(k) > -1; }); });
    if (!anyPos) return true;
    var anyForbidden = a.neg.length && texts.some(function (x) { return a.neg.some(function (k) { return x.indexOf(k) > -1; }); });
    if (anyForbidden && !anyPos) return true;
    // also stale if any task was seeded by the local selector / legacy generator
    if (tasks.some(function (t) { var s = String(t.taskSource || t.task_source || ''); return s === 'local_selector_fallback' || s === 'legacy_generate_daily_tasks'; }) && !anyPos) return true;
    return false;
  }

  /* The client-side fallback task bank is gone.
     It held ~15 hand-written tasks per goal domain and wrote them into
     daily_tasks through set_daily_plan whenever generation failed, tagged
     task_source='fallback_path_specific'. Two things make that wrong now:

       1. generate-tasks v65 owns generation AND persistence
          (persist_generated_daily_plan_v1). The browser is not a writer of
          daily_tasks any more, so a client-authored plan would bypass the
          generation policy, the goal snapshot and the proof contract.
       2. A task the user did not earn a personalised plan for must not be
          presented as one. The engine failing is an honest state with a
          retry, not a reason to invent work and award XP against it.

     Every caller was already removed when the daily-plan client took over;
     this deletes the bank itself and its export so nothing can call it
     again. scripts/qa-daily-plan-contract.mjs holds the fail-closed
     behaviour that replaced it. */

  function mapTask(t) {
    return { id: t.id, title: t.title, meta: t.description, difficulty: t.difficulty,
             proof: true, goalType: t.goal_type, baseXp: t.base_xp,
             status: t.status,
             done: t.activation_status === 'accepted' || t.status === 'done',
             kind: t.role, role: t.role, why: t.why, helps: t.helps, steps: t.steps || [],
             estMinutes: t.est_minutes, proofPrompt: t.proof_prompt, proofMustShow: t.proof_must_show,
             proofRejectIf: t.proof_reject_if, goodProofExamples: t.good_proof_examples || [],
             whyPersonalised: t.why_personalised, mistakeToAvoid: t.mistake_to_avoid,
             fallback: t.fallback_task, upgrade: t.upgrade_task, tags: t.personalisation_tags || [],
             taskSource: t.task_source, profileGoalSnapshot: t.profile_goal_snapshot || '',
             profilePathTypeSnapshot: t.profile_path_type_snapshot || '', generatedReason: t.generated_reason,
             activationStatus: t.activation_status || 'queued',
             effortLevel: t.effort_level || 'medium',
             taskType: t.task_type || '',
             recommendedProofType: t.recommended_proof_type || null,
             proofContract: t.proof_contract || null,
             proofContractVersion: t.proof_contract_version || null,
             videoReviewEligible: t.video_review_eligible === true,
             videoReviewRetentionDays: t.video_review_retention_days || null,
             sequencePosition: t.sequence_position || null,
             adaptedFromTaskId: t.adapted_from_task_id || null,
             proofDecision: t.proofDecision || null };
  }
  async function readBackendTasks(id) {
    var r = await sb.from('daily_tasks').select('*').eq('user_id', id).eq('date', today())
      .order('sequence_position', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    return (r.data || []).map(mapTask);
  }

  // THE single regeneration contract. The deployed generate-tasks function owns
  // generation AND persistence: it writes daily_tasks itself and returns the real
  // rows. This wrapper therefore only translates the caller's intent into a reason
  // string the server actually accepts and hands the work to VISION.dailyPlan —
  // it must never persist tasks of its own, and it must never invent a task.
  //
  // Legacy caller reasons are mapped here because the server rejects anything
  // outside its allowlist with 400 invalid_generation_reason:
  //   auto_daily | manual | manual_retry -> auto
  //   manual_refresh                     -> manual_refresh   (regenerate + quota)
  //   onboarding_complete | onboarding_redo -> unchanged
  var SERVER_REASON = {
    auto: 'auto',
    auto_daily: 'auto',
    manual: 'auto',
    manual_retry: 'auto',
    manual_refresh: 'manual_refresh',
    onboarding_complete: 'onboarding_complete',
    onboarding_redo: 'onboarding_redo'
  };

  async function regenerateTasksForCurrentProfile(options) {
    var plan = V.dailyPlan;
    if (plan) {
      var o = options || {};
      var wanted = SERVER_REASON[String(o.reason || 'auto')] || 'auto';
      // A forced regen must still use a reason the server treats as a regenerate,
      // otherwise `force:true` silently downgrades to the idempotent initial path.
      var serverReason = (o.force === true && wanted === 'auto') ? 'manual_refresh' : wanted;
      var s = await plan.load({ force: o.force === true, reason: serverReason });
      if (s.status === 'ready') {
        try { dispatchEvent(new CustomEvent('vision:tasks-upgraded')); } catch (e) {}
        return { ok: true, source: s.source || 'server', error: null, tasks: s.tasks };
      }
      if (s.status === 'clarification_required') {
        try { dispatchEvent(new CustomEvent('vision:plan-clarification', { detail: { question: s.question } })); } catch (e) {}
        return { ok: false, error: 'clarification_required', question: s.question, tasks: [] };
      }
      var err = s.error || { code: 'generation_failed', message: 'The plan engine could not finish.', retryable: true };
      try { dispatchEvent(new CustomEvent('vision:tasks-upgrade-failed', { detail: err })); } catch (e) {}
      return { ok: false, error: err.code, message: err.message, retryable: err.retryable, tasks: [] };
    }
    return legacyRegenerateTasksForCurrentProfile(options);
  }

  // No dailyPlan module on the page. The old inline client spoke a contract the
  // deployed function rejects (reason:'auto_daily' -> 400) and then re-persisted
  // tasks the server had already written. Running it would put a wrong or generic
  // task in front of the user, so it is gone: say what is missing instead.
  async function legacyRegenerateTasksForCurrentProfile() {
    console.error('[VISION] js/vision-daily-plan.js is not loaded on this page — task generation is unavailable.');
    return {
      ok: false,
      error: 'plan_client_missing',
      message: 'This page cannot reach the plan engine.',
      retryable: false,
      tasks: []
    };
  }

  // Generation guard — a concurrency limiter, NOT a per-day cap (the old per-day
  // `vision_fb_upgrade_<date>` latch stranded users on generic tasks all day and was
  // the confirmed root cause). Concurrent same-tab callers share one in-flight
  // generation; a short failure cooldown stops AUTO reasons from hammering a down
  // model; a cross-tab lock avoids double-spend. A manual Retry bypasses all of these
  // (it calls clearGenerationCooldown() and passes reason:'manual_retry').
  var GEN_INFLIGHT = null;
  var GEN_FAIL_COOLDOWN_MS = 45 * 1000, GEN_LOCK_TTL_MS = 90 * 1000;
  function genFailKey() { try { return 'vision_gen_fail_' + today(); } catch (e) { return 'vision_gen_fail'; } }
  function genLockKey(id) { try { return 'vision_gen_lock_' + id + '_' + today(); } catch (e) { return 'vision_gen_lock'; } }
  function inGenerationCooldown() {
    try { var t = Number(localStorage.getItem(genFailKey()) || 0); return t > 0 && (Date.now() - t) < GEN_FAIL_COOLDOWN_MS; }
    catch (e) { return false; }
  }
  function noteGenerationFailure() { try { localStorage.setItem(genFailKey(), String(Date.now())); } catch (e) {} }
  function clearGenerationCooldown() { try { localStorage.removeItem(genFailKey()); } catch (e) {} }
  function genLockHeld(id) {
    try { var t = Number(localStorage.getItem(genLockKey(id)) || 0); return t > 0 && (Date.now() - t) < GEN_LOCK_TTL_MS; }
    catch (e) { return false; }
  }
  function acquireGenLock(id) { try { localStorage.setItem(genLockKey(id), String(Date.now())); } catch (e) {} }
  function releaseGenLock(id) { try { localStorage.removeItem(genLockKey(id)); } catch (e) {} }

  // The client no longer writes daily_tasks at all. generate-tasks v65 persists
  // the plan server-side (persist_generated_daily_plan_v1) and is the only writer,
  // so the old mixed-set cleanup (re-persisting rows through set_daily_plan_v2 to
  // beat a generic fast-seed) has nothing left to clean up — and would now be
  // actively harmful: its payload predates goal_role, milestone_id,
  // proof_contract_v3 and generation_run_id, so re-writing a server plan through
  // it would silently strip those fields off today's real task.

  async function ensureDailyPlan(obCtx) {
    var id = await uid(); if (!id) return false;
    var existingTasks = await readBackendTasks(id);
    // Only an ACCEPTED proof locks the day. A rejected proof earned nothing, so it must
    // not freeze the plan (esp. a rejected generic-fallback task — the user still needs
    // real tasks). Pending/rejected proofs don't count toward the lock.
    var proofsToday = (await sb.from('proofs').select('id', { count: 'exact', head: true }).eq('user_id', id).eq('date', today()).eq('decision', 'accepted')).count || 0;
    var profile = (await sb.from('profiles').select('*').eq('id', id).maybeSingle()).data || {};
    // Goal-snapshot stale check runs unconditionally — even on locked days — so tasks
    // generated for an old goal are deferred before they can surface as the active Task.
    // Accepted tasks are never touched by defer_stale_goal_tasks (see migration).
    var curGoal = (profile.main_goal || '').toLowerCase().trim();
    var hasSnapshotStale = curGoal && existingTasks.some(function (t) {
      var snap = (t.profileGoalSnapshot || '').toLowerCase().trim();
      return snap && snap !== curGoal && (t.activationStatus === 'active' || t.activationStatus === 'queued');
    });
    if (hasSnapshotStale) {
      try { await sb.rpc('defer_stale_goal_tasks', { p_date: today() }); } catch (e) {}
      existingTasks = await readBackendTasks(id);
    }
    // mixed set (grok + generic fallback coexisting) → personalised always wins
    var hasGrokRows = existingTasks.some(function (t) {
      var s = String(t.taskSource || '');
      return s && s !== 'fallback_path_specific' && s !== 'legacy_unknown';
    });
    var hasFbRows = existingTasks.some(function (t) {
      return String(t.taskSource || '') === 'fallback_path_specific';
    });
    if (hasGrokRows && hasFbRows) {
      // Server-owned plan: report it, never rewrite it from the browser.
      console.warn('[VISION] today has both personalised and fallback rows — server-side cleanup required.');
    }
    // lock the plan once the first proof of the day is logged (after stale cleanup).
    if (existingTasks.length > 0 && proofsToday > 0) return true;
    // If tasks exist but ALL are deferred (goal changed mid-day, no proof yet), fall
    // through to regeneration so the user always has an active/queued task to work on.
    var hasActionable = existingTasks.some(function(t) {
      return t.activationStatus === 'active' || t.activationStatus === 'queued';
    });
    if (existingTasks.length > 0 && !hasActionable) {
      // deferred-only: fall through to regeneration below
    } else {
      // Legacy null-source tasks (pre-integrity migration) — treat as stale if the
      // current profile has a known goal domain, so they get replaced with OpenAI tasks.
      var allLegacy = existingTasks.length > 0 && existingTasks.every(function (t) {
        var s = String(t.taskSource || t.task_source || '');
        return s === '' || s === 'legacy_unknown';
      });
      // An all-generic set is NOT a valid resting state (no generic tasks, ever).
      // Fall through to the blocking regeneration below — set_daily_plan_v2 replaces
      // today's UNPROVEN fallback rows with the real LLM tasks. (Proven days already
      // returned at the day-lock above, so a proven set is never touched here.)
      var allFallback = existingTasks.length > 0 && existingTasks.every(function (t) {
        return String(t.taskSource || t.task_source || '') === 'fallback_path_specific';
      });
      if (allFallback) {
        // fall through to blocking regeneration below
      } else if (allLegacy && buildProfileAnchors(profile) && buildProfileAnchors(profile).domainKnown) {
        // fall through to blocking regeneration below
      } else {
        // current & on-path personalised set → keep
        if (existingTasks.length > 0 && !isTaskSetStaleForProfile(existingTasks, profile)) return true;
      }
    }
    // missing / all-deferred / stale / legacy / all-generic → BLOCKING LLM regen.
    // The concurrency guard inside regenerateTasksForCurrentProfile makes repeated
    // getTasks() calls (proof-logged / storage events) share the one in-flight call
    // or hit the failure cooldown, so this never stacks or persists a generic set.
    var rg = await regenerateTasksForCurrentProfile({ reason: 'auto_daily', force: false, bypassManualQuota: true });
    return !!(rg && rg.ok);
  }

  // Returns today's tasks for the signed-in user with full V2 field mapping.
  // ensureDailyPlan() runs first: generates tasks if missing, defers stale-goal tasks,
  // and locks the plan once a proof has been submitted.
  // activationStatus is always mapped from activation_status (never defaulted to 'active').
  // done = true only when activation_status='accepted' (new system) or status='done' (legacy).
  async function getTasks() {
    var id = await uid(); if (!id) return [];
    /* Before ensureDailyPlan(), which itself reads and writes dated rows. */
    await primeTimezone();
    await ensureDailyPlan();
    // Order matches readBackendTasks: sequence_position first, then created_at for stable sort.
    var r = await sb.from('daily_tasks').select('*').eq('user_id', id).eq('date', today())
              .order('sequence_position', { ascending: true, nullsFirst: false })
              .order('created_at', { ascending: true });
    // latest proof decision per task today (one proof row per task/day by unique constraint)
    var proofByTask = {};
    try {
      var pr = (await sb.from('proofs').select('task_id,decision')
                  .eq('user_id', id).eq('date', today())).data || [];
      pr.forEach(function (p) { proofByTask[p.task_id] = p.decision; });
    } catch (e) {}
    // NO GENERIC TASKS EVER: the UI must never render a generic fallback row. Drop
    // every fallback_path_specific row here (covers tasks.html, dashboard, all
    // consumers) so an all-generic day surfaces as [] → "still generating". The ONLY
    // exception: a fallback row already proved/accepted today — hiding it would erase
    // visible XP, so a proof-locked legacy day is grandfathered through unfiltered.
    // readBackendTasks() stays UNFILTERED so ensureDailyPlan/seed/promoter can still
    // see fallback rows in order to replace them.
    var rows = (r.data || []);
    var anyProvenFallback = rows.some(function (t) {
      return String(t.task_source || '') === 'fallback_path_specific' &&
             (t.activation_status === 'accepted' || proofByTask[t.id] === 'accepted');
    });
    if (!anyProvenFallback) {
      rows = rows.filter(function (t) { return String(t.task_source || '') !== 'fallback_path_specific'; });
    }
    return rows.map(function (t) {
      var decision = proofByTask[t.id] || null;
      return { id: t.id, title: t.title, meta: t.description, difficulty: t.difficulty,
               proof: true, goalType: t.goal_type, baseXp: t.base_xp,
               status: t.status,
               done: t.activation_status === 'accepted' || t.status === 'done',
               proofDecision: decision,
               kind: t.role, role: t.role, why: t.why, helps: t.helps, steps: t.steps || [],
               estMinutes: t.est_minutes, proofPrompt: t.proof_prompt, proofMustShow: t.proof_must_show,
               proofRejectIf: t.proof_reject_if, goodProofExamples: t.good_proof_examples || [],
               whyPersonalised: t.why_personalised, mistakeToAvoid: t.mistake_to_avoid,
               fallback: t.fallback_task, upgrade: t.upgrade_task, tags: t.personalisation_tags || [],
               activationStatus: t.activation_status || 'queued',
               recommendedProofType: t.recommended_proof_type || null,
               proofContract: t.proof_contract || null,
               proofContractVersion: t.proof_contract_version || null,
               taskSource: t.task_source || null,
               profileGoalSnapshot: t.profile_goal_snapshot || '',
               profilePathTypeSnapshot: t.profile_path_type_snapshot || '',
               sequencePosition: t.sequence_position || null,
               /* Same omission as vision-daily-plan.js's mapRow, in the second
                  mapper. The Tasks page reads through here while the dashboard
                  reads through mapRow, so dropping these only here would leave
                  Home and Tasks disagreeing about the same task -- Home showing
                  a Professional Standard and a prospect-batch reference that
                  Tasks could not see. mission_intent.evidence_reference is the
                  only durable pointer from a task to its stored batch, so a
                  mapper that drops it drops the batch link. */
               missionIntent: t.mission_intent || null,
               contextAnchors: t.context_anchors || null };
    });
  }

  async function seedTaskStreamIfEmpty() {
    // Background seed: only trigger if user is authenticated, onboarded, has a goal,
    // AND has zero active/queued tasks. Uses a per-user/day/session lock to prevent
    // duplicate generations across tabs.
    var id = await uid();
    if (!id) return;

    var profile = (await sb.from('profiles').select('*').eq('id', id).maybeSingle()).data || {};
    if (!profile.onboarding_complete) return;
    var goal = (profile.main_goal || '').trim();
    if (!goal) return;

    // Only skip when a PERSONALISED actionable task already exists. An all-generic
    // day (fallback_path_specific rows) must NOT short-circuit — it needs replacing.
    var existingTasks = await readBackendTasks(id);
    var hasPersonalisedActionable = existingTasks.some(function(t) {
      var src = String(t.taskSource || t.task_source || '');
      return (t.activationStatus === 'active' || t.activationStatus === 'queued') &&
             src !== 'fallback_path_specific';
    });
    if (hasPersonalisedActionable) return;

    // Session lock prevents multiple tabs from seeding simultaneously
    var lockKey = id + '_' + today() + '_seeding';
    if (sessionStorage.getItem(lockKey)) return;
    sessionStorage.setItem(lockKey, Date.now().toString());

    try {
      // BLOCKING LLM regen — never a fast generic seed. On failure returns
      // {ok:false, error:'engine_*'} so the page shows a loading/retry state.
      var result = await regenerateTasksForCurrentProfile({
        reason: 'auto_daily',
        force: false,
        bypassManualQuota: true
      });
      console.log('[VISION seedTaskStreamIfEmpty] ok=' + (result&&result.ok) +
                  ' tasks=' + (result&&result.tasks?result.tasks.length:0) +
                  ' error=' + (result&&result.error));
      return result;
    } catch (e) {
      console.error('[VISION seedTaskStreamIfEmpty] threw:', e);
      return { ok: false, error: String(e), tasks: [] };
    } finally {
      sessionStorage.removeItem(lockKey);
    }
  }

  async function isTaskDone(taskId) {
    var id = await uid(); if (!id) return false;
    // Only accepted proofs count as a completed task
    var r = await sb.from('proofs').select('id', { count: 'exact', head: true })
                    .eq('user_id', id).eq('task_id', taskId)
                    .eq('date', today()).eq('decision', 'accepted');
    return (r.count || 0) > 0;
  }

  /* ───────── writes ───────── */
  // map the onboarding "arena" to a task path (the newer onboarding uses arenas)
  var ARENA_PATH = { body: 'fitness', money: 'money', business: 'money', creator: 'money',
                     study: 'study', career: 'study', custom: 'discipline' };

  // save onboarding → profile + onboarding_answers, then seed today's tasks.
  // Robust to both onboarding payload shapes (index-based and arena/score-based).
  async function saveOnboarding(ob) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var u = await A.getUser();
    // was this user already onboarded? (distinguishes a Profile-settings REDO from a
    // first-time complete — both force OpenAI regen, this is for the reason tag)
    var wasOnboarded = false;
    try { var pr0 = (await sb.from('profiles').select('onboarding_complete').eq('id', id).maybeSingle()).data; wasOnboarded = !!(pr0 && pr0.onboarding_complete); } catch (_) {}
    // universal analysis: ANY goal → domain + parentPath + identity
    var goalText = ob.goalText || ob.primaryGoal || ob.goalDetail || '';
    var ga = (V.goal && V.goal.analyzeGoal && goalText) ? (function () { try { return V.goal.analyzeGoal(goalText, ob); } catch (e) { return null; } })() : null;
    /* THE USER'S OWN ANSWER WINS.
       Onboarding asks "Which area matters most right now?" and the founder
       picks "Business or income" -- which PRIMARY_AREA_CHOICES maps to the
       Founder Analyst. That answer reached this function all along, in
       ob.answers.mainAnalyst, and was used only to label the reveal ceremony.
       Routing was derived purely from a keyword read of the goal sentence, so
       a founder who explicitly said "Business or income" could still be filed
       as discipline, custom or fitness and never reach the Founder engine.
       Asking someone a question and then ignoring the answer is worse than not
       asking: it is the one signal here that carries no inference risk at all.
       The classifier stays as the fallback for when nothing was chosen. */
    var ANALYST_DOMAIN = {
      'Founder Analyst': 'business', 'Money Analyst': 'money', 'Fitness Analyst': 'fitness',
      'Athlete Analyst': 'sport', 'Learning Analyst': 'education', 'Creator Analyst': 'content'
    };
    var DOMAIN_PARENT_PATH = {
      business: 'money', money: 'money', fitness: 'fitness',
      sport: 'fitness', education: 'study', content: 'money'
    };
    var answers = ob.answers || {};
    var chosenAnalyst = ob.mainAnalyst || ob.primaryGoalAnalyst
      || answers.mainAnalyst || answers.primaryGoalAnalyst || '';
    var chosenDomain = ANALYST_DOMAIN[chosenAnalyst] || null;
    var path = (chosenDomain && DOMAIN_PARENT_PATH[chosenDomain])
      || (ga && ga.parentPath) || ARENA_PATH[ob.arena] || (C.pathOf ? C.pathOf(ob) : null) || 'discipline';
    var base = ob.potentialScore || ob.onboardingScore || (C.basePotential ? C.basePotential(ob) : 42);
    var bodyBase = ob.bodyBase || ob.body_base ||
                   (ob.gender === 'female' ? 'female' : ob.gender === 'male' ? 'male' : null);
    var intensity = C.INTENSITY[ob.intensityIdx];
    if (!intensity && typeof ob.intensity === 'number') intensity = C.INTENSITY[ob.intensity];
    var prof = {
      id: id,
      display_name: ob.displayName || ob.name || (u && u.email ? u.email.split('@')[0] : 'Athlete'),
      age: ob.age || null, height_cm: ob.height || ob.heightCm || null, weight_kg: ob.weight || ob.weightKg || null,
      body_base: bodyBase,
      path: path, main_goal: goalText || ob.goal || null,
      /* Same precedence as `path` above: the explicitly chosen area wins, the
         goal-text classifier is the fallback. goal_domain is what
         generate-tasks' domain(p) reads to decide whether a request reaches the
         Founder engine at all, so this is the field that actually routes. */
      goal_domain: chosenDomain || (ga ? ga.domain : null), path_identity: ga ? ga.pathIdentity : null,
      obstacle: ob.obstacle || ob.block || ob.distraction || (ga && ga.blockers && ga.blockers[0]) || null,
      intensity: intensity || null,
      state: ob.state || null, country: ob.country || null,
      base_potential: Math.round(Math.max(0, Math.min(100, base))),
      onboarding_complete: true, updated_at: new Date().toISOString()
    };
    // only set the handle when one was chosen — never wipe an existing username
    if (ob.username) prof.username = String(ob.username).trim().toLowerCase();
    var up = await sb.from('profiles').upsert(prof, { onConflict: 'id' });
    if (up.error && (up.error.message || '').indexOf('profiles_username_key') > -1) {
      // username got claimed mid-onboarding — don't fail the whole flow over it;
      // the profile page prompts to pick another handle
      prof.username = null;
      up = await sb.from('profiles').upsert(prof, { onConflict: 'id' });
    }
    if (up.error) return { error: 'profile_failed', detail: up.error.message };
    // mark onboarding complete (best-effort: ignore if the column isn't migrated yet —
    // the profile row now exists, which the auth guard treats as onboarded either way)
    try { await sb.from('profiles').update({ onboarding_complete: true }).eq('id', id); } catch (_) {}
    // best-effort: persist the personalisation summary onto the profile (ignored if columns
    // aren't migrated yet — kept out of the main upsert so a missing column can't fail onboarding)
    try {
      if (V.goal && V.goal.buildPersonalisationProfile) {
        var pp = V.goal.buildPersonalisationProfile({ onboarding: Object.assign({}, ob, { goalAnalysis: ga }), analysis: ga });
        await sb.from('profiles').update({
          plan_style: pp.style.planStyle, biggest_blocker: pp.blocker.primary,
          preferred_task_minutes: pp.capacity.minutes, preferred_proof_type: pp.style.proofPreference
        }).eq('id', id);
      }
    } catch (_) {}
    // best-effort: persist the adaptive-chat structured profile so generate-tasks can
    // make tasks goal-subtype-specific (winger vs goalkeeper). Kept out of the main
    // upsert so a not-yet-migrated column can never fail onboarding.
    try {
      await sb.from('profiles').update({
        /* generate-tasks' domain(p) reads `goal_category || domain_type ||
           path_type` FIRST and returns it outright, so this field outranks
           goal_domain entirely. Leaving the classifier's guess here would have
           silently undone the choice honoured above: a founder who picked
           "Business or income" still landed on goal_category 'custom' and was
           routed away from the Founder engine by the very first line of
           domain(). Same precedence as everywhere else -- the user's answer
           first, the classifier only as fallback. */
        goal_category:   ob.goalCategory || chosenDomain || (ga && ga.domain) || null,
        goal_subtype:    ob.goalSubtype || null,
        goal_role:       ob.goalRole || (ga && ga.pathIdentity) || null,
        sport_role:      ob.sportRole || null,
        domain_type:     ob.domainType || null,
        current_level:   ob.currentLevel || ob.level || null,
        main_skill_gap:  ob.mainSkillGap || null,
        preferred_time:  ob.preferredTime || null,
        onboarding_summary: ob.onboardingSummary || ob.summarisedGoal || null
      }).eq('id', id);
    } catch (_) {}
    // best-effort: persist the Universal Path Graph fields (path_type, target, resources,
    // 7-day plan, daily strategy). Kept in its own try/catch so an un-migrated column can
    // never fail onboarding — generate-tasks reads these to build path-specific tasks.
    try {
      await sb.from('profiles').update({
        path_type:      ob.pathType || null,
        target_level:   ob.targetLevel || null,
        main_blocker:   ob.mainBlocker || ob.obstacle || ob.block || null,
        daily_strategy: ob.dailyStrategy || null,
        resources:      Array.isArray(ob.resources) ? ob.resources : null,
        seven_day_plan: Array.isArray(ob.sevenDayPlan) ? ob.sevenDayPlan : null,
        first_proof_task: (ob.firstProofTask && typeof ob.firstProofTask === 'object') ? ob.firstProofTask : null
      }).eq('id', id);
    } catch (_) {}
    await sb.from('onboarding_answers').insert({
      user_id: id, goals: ob.cat || null, screen_time: ob.screenIdx, sleep: ob.sleepIdx,
      training_days: ob.trainingIdx, goal_effort: ob.goalEffortIdx, distraction: ob.distraction || null,
      intensity: ob.intensityIdx, obstacle: ob.obstacle || null,
      body_base: ob.bodyBase || ob.body_base || null,
      age: ob.age || null, height_cm: ob.height || null, weight_kg: ob.weight || null,
      custom_goal_text: goalText || null, goal_reason: ob.goalReason || ob.goal_reason || null,
      available_time: ob.availableTime || ob.available_time || null,
      proof_preference: ob.proofPreference || ob.proof_preference || null,
      goal_analysis: ga || null, raw: ob
    });
    // persist the chosen daily task count (by onboarding intensity) BEFORE regenerating
    // so the generator + the daily-plan cap know how many tasks this user wants
    // (best-effort: a missing column must not fail onboarding). NULL → 5 downstream.
    try {
      var desiredCount = (Number(ob.desiredTaskCount) > 0)
        ? Math.min(Math.max(3, Number(ob.desiredTaskCount)), 7)
        : Math.min(Math.max(3, (ob.intensityIdx || 0) + 3), 7);
      await sb.from('profiles').update({ desired_task_count: desiredCount }).eq('id', id);
    } catch (_) {}
    // Replace today's tasks for the NEW profile via the single regeneration contract.
    // This forces OpenAI generate-tasks against the just-saved profile (does NOT burn
    // the manual refresh quota), keeps any already-proven tasks + all proof/XP rows
    // (set_daily_plan only deletes unproven, off-plan slots), and only ever falls back
    // to PATH-SPECIFIC tasks — never the generic local fitness/sleep selector.
    // `reason` distinguishes a first-time complete from a Profile-settings redo.
    var regenReason = wasOnboarded ? 'onboarding_redo' : 'onboarding_complete';
    try {
      await regenerateTasksForCurrentProfile({ reason: regenReason, force: true, bypassManualQuota: true });
    } catch (_) {}
    return { ok: true };
  }

  // THE proof gateway (two-phase, server-authoritative):
  //   1. Upload photo to private storage.
  //   2. Call submit_proof RPC → creates a 'checking' proof record (NEVER awards points).
  //   3. Call validate-proof Edge Function with ONLY the proof_id.
  //      The server downloads the image, runs vision AI, and calls finalize_proof_decision.
  //
  // Returns one of:
  //   { duplicate: true }                     — task already accepted today
  //   { status:'accepted', proofId, awarded } — proof verified, points awarded
  //   { status:'pending_review', proofId }    — ambiguous evidence, under review
  //   { status:'rejected', proofId, reason }  — clear rejection by validator
  //   { status:'checking', proofId }          — validator error/timeout; retry later
  //   { error: string, detail?: string }      — upload or RPC failure
  //
  // FAIL CLOSED: any validator error leaves the task INCOMPLETE. The user can retry.
  // pick a storage extension from a media blob's MIME type
  function extForType(t) {
    t = (t || '').toLowerCase();
    if (t.indexOf('png') > -1) return 'png';
    if (t.indexOf('webp') > -1) return 'webp';
    if (t.indexOf('image') > -1) return 'jpg';
    if (t.indexOf('mp4') > -1 || t.indexOf('m4a') > -1) return t.indexOf('audio') > -1 ? 'm4a' : 'mp4';
    if (t.indexOf('webm') > -1) return 'webm';
    if (t.indexOf('ogg') > -1) return 'ogg';
    if (t.indexOf('mpeg') > -1 || t.indexOf('mp3') > -1) return 'mp3';
    if (t.indexOf('wav') > -1) return 'wav';
    if (t.indexOf('video') > -1) return 'mp4';
    if (t.indexOf('audio') > -1) return 'webm';
    return 'jpg';
  }

  async function issueProofChallenge(taskId, proofType) {
    var type = String(proofType || '').toLowerCase() === 'voice' ? 'voice' : 'photo';
    var r = await sb.rpc('issue_proof_capture_challenge_v1', { p_task_id: taskId, p_modality: type });
    if (r.error) return { error: 'challenge_failed', detail: String(r.error.message || '').slice(0, 160) };
    return r.data || { error: 'challenge_failed' };
  }

  async function submitProof(taskId, photo, note, opts) {
    opts = opts || {};
    var proofType = opts.proofType || 'photo';
    // Live Proof is valid only when a stopped, server-backed session exists.
    // The database verifies ownership, task/contract binding, integrity and the
    // final checkpoint again; this client guard only prevents a broken upload.
    if (proofType === 'live' && !opts.liveSessionId) {
      return { error: 'live_session_required' };
    }
    // Browser summaries are display/debug context only. V2 validation ignores
    // them and reads the attached server-backed session evidence.
    if (opts.coachSummary) {
      var cs = String(opts.coachSummary).slice(0, 700);
      note = note ? (String(note).slice(0, 160) + ' · ' + cs) : cs;
    }
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    if (!photo) return { error: 'no-photo' };
    var blob = (typeof photo === 'string') ? dataURLtoBlob(photo) : photo;
    // re-encode HEIC as JPEG (unsupported by Supabase Storage + OpenAI Vision)
    if (blob.type && blob.type.indexOf('heic') > -1) {
      try { blob = await heicToJpeg(blob); } catch (e) { /* fall through with original */ }
    }
    var ext = extForType(blob.type);
    var existingLivePath = proofType === 'live' && opts.liveSessionId ? String(opts.existingMediaPath || '') : '';
    var path = existingLivePath || (id + '/' + today() + '/' + taskId + '-' + Date.now() + '.' + ext);

    // Phase 1: upload media to private storage
    if (!existingLivePath) {
      var up = await sb.storage.from('proofs').upload(
        path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false }
      );
      if (up.error) return { error: 'upload_failed', detail: up.error.message };
    }

    // live proof: upload the auto-captured poster still alongside the clip
    var posterPath = null;
    if (opts.poster) {
      var pblob = (typeof opts.poster === 'string') ? dataURLtoBlob(opts.poster) : opts.poster;
      posterPath = id + '/' + today() + '/' + taskId + '-' + Date.now() + '-poster.jpg';
      var pup = await sb.storage.from('proofs').upload(posterPath, pblob, { contentType: pblob.type || 'image/jpeg', upsert: false });
      if (pup.error) posterPath = null; // non-fatal; validator falls back to clip sanity
    }

    // Phase 2: create proof record in 'checking' state (never awards points)
    var r = await sb.rpc('submit_proof', {
      p_task_id: taskId, p_image_path: path, p_note: note || null,
      p_proof_type: proofType, p_poster_path: posterPath,
      p_live_session_id: proofType === 'live' ? opts.liveSessionId : null,
      p_challenge_id: proofType === 'live' ? null : (opts.challengeId || null)
    });
    if (r.error) {
      var m = r.error.message || '';
      if (m.indexOf('no_photo')     > -1) return { error: 'no-photo' };
      if (m.indexOf('invalid_task') > -1) return { error: 'invalid_task' };
      return { error: 'rpc_failed', detail: m };
    }
    var d = r.data || {};
    // Already accepted today (idempotent guard)
    if (d.status === 'accepted') return { duplicate: true };
    var proofId = d.proof_id;
    if (!proofId) return { error: 'no_proof_id' };
    // Phase 3: run server-authoritative validator — sends ONLY proof_id
    var vr;
    try {
      // V3 always uses the dedicated session validator. Never route a Live
      // proof through the generic still-image validator or an obsolete flag.
      if (proofType === 'live') {
        vr = await sb.functions.invoke('validate-proof-v2', { body: { proof_id: proofId } });
      } else {
        vr = await sb.functions.invoke('validate-proof', { body: { proof_id: proofId } });
      }
    } catch (e) {
      // network failure calling Edge Function — leave proof in 'checking', user can retry
      return { status: 'checking', proofId: proofId, error: 'validator_unreachable' };
    }
    if (vr.error) {
      return { status: 'checking', proofId: proofId, error: 'validator_error' };
    }
    var vd = vr.data || {};
    var decision = vd.decision || 'checking';

    if (decision === 'accepted') {
      var awarded = (vd.finalized && typeof vd.finalized.points === 'number')
                   ? vd.finalized.points : 0;
      // Roll the stream: keep the hidden queue topped up in the background so the
      // next move is always ready. Fire-and-forget — never blocks the receipt.
      try { topUpTasks().catch(function () {}); } catch (e) {}
      return { ok: true, status: 'accepted', proofId: proofId, awarded: awarded,
               reason: vd.reason || '' };
    }
    if (decision === 'pending_review') {
      return { ok: true, status: 'pending_review', suspicious: true,
               proofId: proofId, awarded: 0, reason: vd.reason || '' };
    }
    if (decision === 'rejected') {
      return { ok: true, status: 'rejected', rejected: true,
               proofId: proofId, awarded: 0, reason: vd.reason || '' };
    }
    // 'checking' — validator error or timeout, task stays incomplete
    return { status: 'checking', proofId: proofId, reason: vd.reason || 'retry' };
  }

  // Daily "Refresh tasks". The deployed function enforces the daily quota
  // (consume_refresh_quota_for_date_v1) AND writes the replacement rows itself,
  // so this is a thin pass-through: sending reason:'manual_refresh' is what puts
  // the server in `regenerate` mode. The old body re-persisted the response with
  // set_daily_plan_v2, which double-wrote the plan the server had just written.
  async function refreshTasks() {
    var plan = V.dailyPlan;
    if (!plan) return { error: 'plan_client_missing' };
    var s = await plan.refresh();
    if (s.status === 'ready') return { ok: true, source: s.source || 'manual_refresh', tasks: s.tasks };
    if (s.status === 'clarification_required') {
      return { error: 'clarification_required', question: s.question };
    }
    var e = s.error || {};
    if (e.code === 'rate_limited') {
      return { error: 'rate_limited', remaining: 0, message: 'You\'ve used today\'s refreshes. More tomorrow.' };
    }
    // Fail CLOSED: today's existing tasks are left exactly as they are and no
    // fallback set is written. `engine_unavailable` is the stable code callers
    // (doRefresh) switch on; `code`/`message` carry the real server reason.
    return {
      error: 'engine_unavailable',
      code: e.code || 'generation_failed',
      message: e.message || 'The plan engine could not finish.',
      retryable: e.retryable !== false
    };
  }

  // recent proofs for the history strip (no image URLs — photos stay private)
  async function getRecentProofs(limit) {
    var id = await uid(); if (!id) return [];
    var r = await sb.from('proofs')
                    .select('task_id,task_title,earned_xp,date,created_at,verification_status,decision')
                    .eq('user_id', id).order('created_at', { ascending: false }).limit(limit || 12);
    return (r.data || []).map(function (p) {
      return { taskId: p.task_id, taskTitle: p.task_title, earnedXp: p.earned_xp, date: p.date,
               decision: p.decision || null,
               verificationStatus: p.verification_status || 'approved',
               timestamp: Date.parse(p.created_at) || Date.now() };
    });
  }

  async function saveDesiredTaskCount(count) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var v = Math.min(Math.max(3, Math.round(Number(count) || 5)), 7);
    var r = await sb.from('profiles').update({ desired_task_count: v }).eq('id', id);
    return r.error ? { error: r.error.message } : { ok: true, value: v };
  }

  /* ── Settings: persist plan / preference fields. Allowlisted columns only;
     each value is validated so the settings drawer can never write junk. ── */
  async function updateGoalPrefs(fields) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var f = fields || {}, patch = {};
    if (f.mainGoal != null) { var g = String(f.mainGoal).trim().slice(0, 240); if (g) patch.main_goal = g; }
    if (f.intensity != null && /^(Balanced|Committed|Obsessed)$/.test(String(f.intensity).trim())) patch.intensity = String(f.intensity).trim();
    if (f.preferredTaskMinutes != null) { var m = Math.round(Number(f.preferredTaskMinutes)); if (m >= 5 && m <= 180) patch.preferred_task_minutes = m; }
    if (f.preferredTime != null) { var pt = String(f.preferredTime).trim().slice(0, 24); patch.preferred_time = pt; }
    if (!Object.keys(patch).length) return { error: 'nothing_to_update' };
    patch.updated_at = new Date().toISOString();
    var r = await sb.from('profiles').update(patch).eq('id', id);
    return r.error ? { error: r.error.message } : { ok: true, patch: patch };
  }

  /* ── Settings → Data: export the caller's OWN rows as JSON. RLS already
     restricts every table to self, so this can only ever read the user's data. ── */
  async function exportMyData() {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var out = { exported_at: new Date().toISOString(), user_id: id };
    try {
      out.profile    = (await sb.from('profiles').select('*').eq('id', id).maybeSingle()).data || null;
      out.scores     = (await sb.from('scores').select('*').eq('user_id', id).maybeSingle()).data || null;
      out.onboarding = (await sb.from('onboarding_answers').select('*').eq('user_id', id)).data || [];
      out.proofs     = (await sb.from('proofs').select('*').eq('user_id', id)).data || [];
      out.xp_events  = (await sb.from('xp_events').select('*').eq('user_id', id)).data || [];
    } catch (e) { return { error: String(e) }; }
    return { ok: true, data: out };
  }

  /* ── Settings → Data: permanently delete the caller's OWN account. Calls the
     SECURITY DEFINER delete_my_account() RPC, which removes proof images then
     deletes auth.users (every table cascades). Then clears the local session. ── */
  async function deleteAccount() {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var r = await sb.rpc('delete_my_account');
    if (r.error) return { error: r.error.message };
    try { await sb.auth.signOut({ scope: 'global' }); } catch (_) {}
    return { ok: true };
  }

  // rename only — guarded by the profiles_update_own RLS policy
  async function updateDisplayName(name) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var n = String(name || '').trim().slice(0, 40);
    if (n.length < 2) return { error: 'too_short' };
    var r = await sb.from('profiles').update({ display_name: n }).eq('id', id);
    return r.error ? { error: r.error.message } : { ok: true, name: n };
  }

  /* ── username: the unique handle behind invite codes / identity ── */
  var USERNAME_RE = /^[a-z0-9_]{3,20}$/;
  function normalizeUsername(name) { return String(name || '').trim().toLowerCase(); }

  async function isUsernameAvailable(name) {
    var n = normalizeUsername(name);
    if (!USERNAME_RE.test(n)) return { available: false, error: 'invalid' };
    var r = await sb.rpc('is_username_available', { p_username: n });
    if (r.error) return { available: false, error: r.error.message };
    return { available: r.data === true };
  }

  // claim/change the handle — own row only (profiles_update_own RLS)
  async function setUsername(name) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var n = normalizeUsername(name);
    if (!USERNAME_RE.test(n)) return { error: 'invalid' };
    var avail = await isUsernameAvailable(n);
    if (avail.error && avail.error !== 'invalid') return { error: avail.error };
    if (!avail.available) return { error: 'taken' };
    var r = await sb.from('profiles').update({ username: n }).eq('id', id);
    if (r.error) {
      // race: someone claimed it between the check and the write
      if ((r.error.message || '').indexOf('profiles_username_key') > -1) return { error: 'taken' };
      return { error: r.error.message };
    }
    return { ok: true, username: n };
  }

  async function saveFeedback(answers, rating) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var r = await sb.from('feedback').insert({ user_id: id, answers: answers || {}, rating: rating || null });
    return r.error ? { error: r.error.message } : { ok: true };
  }

  // Report a bad/wrong task — beta feedback loop for the founder.
  // Privacy-safe bad-task report (task_reports v2). Collects ONLY: task id, a
  // coarse reason category, a stable reason_code, an optional short note, and the
  // proof-contract compiler version that produced the task. NO profile data
  // (goal/name/email) is ever sent — the server already knows the caller and can
  // re-derive context from task_id if needed. `meta` is optional for back-compat.
  async function reportBadTask(taskId, taskTitle, reason, note, meta) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var VALID = ['wrong_goal','too_easy','too_hard','generic','unsafe','other'];
    var category = VALID.indexOf(reason) > -1 ? reason : 'other';
    meta = meta || {};
    // reason_code: a stable machine identifier (defaults to rpt_<category>); the
    // caller may pass a more specific code. compiler_version: the task's proof
    // contract/compiler version so a fix can target the exact generator revision.
    var reasonCode = String(meta.reasonCode || ('rpt_' + category)).slice(0, 40);
    var compilerVersion = (meta.compilerVersion === 0 || meta.compilerVersion)
      ? String(meta.compilerVersion).slice(0, 40) : null;
    var base = {
      user_id: id,
      task_id: taskId || null,
      task_title: String(taskTitle || '').slice(0, 200),
      report_reason: category,
      report_note: String(note || '').slice(0, 500)
    };
    // Attempt the v2 insert (reason_code + compiler_version). If those columns are
    // not yet migrated in this environment PostgREST rejects the whole insert
    // (unknown column), so fall back to the base columns — the report still lands.
    // Mirrors the generate-tasks path-column fallback: ship the client ahead of
    // the migration without ever breaking the feature.
    var r = await sb.from('task_reports').insert(Object.assign({
      reason_code: reasonCode,
      compiler_version: compilerVersion
    }, base));
    if (r.error && /column|schema cache|reason_code|compiler_version|PGRST204/i.test(String(r.error.message || ''))) {
      r = await sb.from('task_reports').insert(base);
    }
    return r.error ? { error: r.error.message } : { ok: true };
  }

  // Detect whether a saved profile is genuinely "old-format" (pre-path-graph),
  // i.e. it cannot tell generate-tasks which domain to build for.
  //
  // generate-tasks resolves the domain as `goal_category || domain_type ||
  // path_type` (supabase/functions/generate-tasks/index.ts) — path_type is only
  // the LAST fallback. Treating a missing path_type as old-format on its own
  // therefore mislabels every profile that carries the domain another way: a
  // Founder profile completed seconds earlier writes goal_category='business'
  // and no path_type, and was being told its "goal profile uses an older
  // format. Redo onboarding" while the engine was in fact routing it fine.
  // Mirror the server's own precedence instead of inventing a second rule.
  function hasMissingPathFields(profile) {
    if (!profile || !profile.onboarding_complete) return false;
    if (profile.goal_category || profile.domain_type) return false;
    return !profile.path_type;
  }

  /* ───────── leaderboard / friends (ready; page wiring is a follow-up) ───────── */
  async function getLeaderboard(scope) {
    var me = await uid();
    var rows;
    if (scope === 'friends' && me) {
      var fr = await sb.from('friends').select('friend_id').eq('user_id', me).eq('status', 'accepted');
      var ids = (fr.data || []).map(function (x) { return x.friend_id; }); ids.push(me);
      rows = (await sb.from('public_stats').select('*').in('id', ids)).data || [];
    } else {
      // public_stats is privacy-scoped to self + accepted friends, so every
      // scope (incl. legacy state/country — those columns no longer exist)
      // ranks within the caller's visible circle
      var ord = scope === 'momentum' ? 'momentum_score' : 'total_xp';
      rows = (await sb.from('public_stats').select('*').order(ord, { ascending: false }).limit(50)).data || [];
    }
    rows = rows.map(function (r) {
      return { id: r.id, name: r.id === me ? 'You' : r.name, you: r.id === me,
               xp: r.total_xp, totalXp: r.total_xp, improvement: r.improvement, move: 0, movement: 0,
               streak: r.streak, path: r.path };
    });
    rows.sort(function (a, b) {
      return scope === 'momentum' ? (b.xp - a.xp) : (b.improvement - a.improvement || b.xp - a.xp);
    });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    var LABELS = { momentum: { label: 'Momentum', loc: 'rising fastest' }, friends: { label: 'Friends', loc: 'your circle this week' },
                   state: { label: 'State', loc: 'your state' }, country: { label: 'Country', loc: 'your country' },
                   worldwide: { label: 'Worldwide', loc: 'global' } };
    return { scope: scope, meta: LABELS[scope] || { label: scope, loc: '' }, rows: rows };
  }

  async function addFriendByCode(code) {
    var r = await sb.rpc('add_friend_by_code', { p_code: code });
    return r.error ? { error: r.error.message } : (r.data || {});
  }
  async function acceptFriend(id) {
    var r = await sb.rpc('accept_friend', { p_friend_id: id });
    return r.error ? { error: r.error.message } : (r.data || {});
  }

  /* ───────── friends (real, signed-in) ───────── */
  var PROOF_XP = C.XP_BY_DIFF.core;
  function daysLeftInWeek() { var d = new Date().getDay(); return ((7 - d) % 7) || 7; }

  async function acceptedFriendIds(me) {
    var fr = await sb.from('friends').select('friend_id').eq('user_id', me).eq('status', 'accepted');
    return (fr.data || []).map(function (x) { return x.friend_id; });
  }
  // accepted friends + the live "You" row, ranked by improvement then XP
  async function getFriendBoard() {
    var me = await uid(); if (!me) return { rows: [] };
    var ids = await acceptedFriendIds(me);
    var allIds = ids.concat([me]);
    var stats = (await sb.from('public_stats').select('*').in('id', allIds)).data || [];
    var rows = stats.map(function (s) {
      return { id: s.id, you: s.id === me, name: s.id === me ? 'You' : s.name,
               initials: (s.name || '?').trim()[0] || '?',
               totalXp: s.total_xp, todayXp: 0, proofCountToday: s.proofs_today || 0,
               streak: s.streak, improvement: s.improvement, movement: 0, path: s.path, status: '' };
    });
    rows.sort(function (a, b) { return b.improvement - a.improvement || b.totalXp - a.totalXp; });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return { rows: rows };
  }

  async function getWeeklyRival() {
    var me = await uid(); if (!me) return { none: true };
    var ids = await acceptedFriendIds(me);
    if (!ids.length) return { none: true };
    var myXp = (((await sb.from('scores').select('total_xp').eq('user_id', me).maybeSingle()).data) || {}).total_xp || 0;
    var fstats = (await sb.from('public_stats').select('*').in('id', ids)).data || [];
    var above = fstats.filter(function (f) { return f.total_xp > myXp; }).sort(function (a, b) { return a.total_xp - b.total_xp; });
    var target = above[0] || fstats.slice().sort(function (a, b) { return b.total_xp - a.total_xp; })[0];
    if (!target) return { none: true };
    var xpGap = Math.max(0, target.total_xp - myXp);
    return { none: false, friendId: target.id, name: target.name, yourXp: myXp, rivalXp: target.total_xp,
             xpGap: xpGap, proofGap: xpGap > 0 ? Math.max(1, Math.ceil(xpGap / PROOF_XP)) : 0,
             daysLeft: daysLeftInWeek(), rewardXp: 120, status: myXp >= target.total_xp ? 'ahead' : 'behind' };
  }

  async function getFriendChallenges() {
    var me = await uid(); if (!me) return [];
    var r = (await sb.from('friend_challenges').select('*')
              .or('creator_id.eq.' + me + ',friend_id.eq.' + me).order('created_at', { ascending: false })).data || [];
    var proofsToday = (await sb.from('proofs').select('id', { count: 'exact', head: true }).eq('user_id', me).eq('date', today())).count || 0;
    return r.map(function (c) {
      return { id: c.id, friendId: c.friend_id, friendName: 'Friend', title: c.title, description: c.title,
               requiredProofs: c.required_proofs, yourProgress: Math.min(proofsToday, c.required_proofs),
               friendProgress: 0, rewardXp: c.reward_xp, status: c.status };
    });
  }

  async function getFriendActivity() {
    var me = await uid(); if (!me) return [];
    var r = (await sb.from('friend_activity').select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(8)).data || [];
    return r.map(function (a) {
      return { id: a.id, friendName: a.actor_id === me ? 'You' : 'Friend', action: a.action, type: a.type,
               timestamp: Date.parse(a.created_at) || Date.now() };
    });
  }

  async function getInviteCode() {
    var me = await uid(); if (!me) return '';
    var p = (await sb.from('profiles').select('invite_code').eq('id', me).maybeSingle()).data || {};
    return p.invite_code || '';
  }

  async function getSocialStats() {
    var board = await getFriendBoard();
    var me = board.rows.find(function (r) { return r.you; });
    var proofWins = me ? board.rows.filter(function (r) { return !r.you && r.totalXp < me.totalXp; }).length : 0;
    return { friends: board.rows.filter(function (r) { return !r.you; }).length,
             weeklyRank: me ? me.rank : board.rows.length, weeklyOf: board.rows.length,
             rivalWins: 0, proofWins: proofWins, inviteCode: await getInviteCode() };
  }

  async function getFriendProfile(id) {
    var me = await uid();
    var s = (await sb.from('public_stats').select('*').eq('id', id).maybeSingle()).data;
    if (!s) return null;
    var myXp = (((await sb.from('scores').select('total_xp').eq('user_id', me).maybeSingle()).data) || {}).total_xp || 0;
    var xpGap = Math.max(0, s.total_xp - myXp);
    var todayCount = s.proofs_today || 0;
    var board = await getFriendBoard(); var brow = board.rows.find(function (r) { return r.id === id; });
    var rival = await getWeeklyRival();
    return { isFriend: true, id: s.id, name: s.name, initials: (s.name || '?').trim()[0] || '?', path: s.path,
             totalXp: s.total_xp, proofCountToday: todayCount, streak: s.streak, improvement: s.improvement,
             movement: 0, status: '', friendRank: brow ? brow.rank : null,
             gap: { yourXp: myXp, friendXp: s.total_xp, xpGap: xpGap, proofGap: xpGap > 0 ? Math.max(1, Math.ceil(xpGap / PROOF_XP)) : 0, status: myXp >= s.total_xp ? 'ahead' : 'behind' },
             challenge: null, isRival: !rival.none && rival.friendId === id, rivalReward: rival.rewardXp || 120 };
  }

  /* ───────── hydrate localStorage from backend (for deterministic pages) ───────── */
  // Writes ONLY the signed-in user's own data into their own vision_* keys, so the
  // existing deterministic logic (getStrategy, future-self, badges) runs on real data.
  // map a backend path back to an onboarding category so C.pathOf() resolves it
  var PATH_CAT = { fitness: 'fitness', study: 'student', money: 'business', discipline: 'mind' };

  async function hydrateLocal() {
    var id = await uid(); if (!id) return false;
    await primeTimezone();
    var prof = await getProfile();
    var ob = (await sb.from('onboarding_answers').select('raw,goal_analysis').eq('user_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
    // ensure a `cat` so the deterministic local logic (tasks/strategist) uses the real path
    var obOut = (ob && ob.raw) ? Object.assign({}, ob.raw) : {};
    if (!obOut.cat && prof && prof.path) obOut.cat = PATH_CAT[prof.path] || 'mind';
    // carry the universal goal analysis so the engine drives strategist/tasks in backend mode
    if (ob && ob.goal_analysis) obOut.goalAnalysis = ob.goal_analysis;
    if (!obOut.goalText && obOut.goalAnalysis) obOut.goalText = obOut.goalAnalysis.rawGoal;
    if (!obOut.goalText && prof && prof.primaryGoal) obOut.goalText = prof.primaryGoal;
    C.write(C.KEYS.onboarding, obOut);
    if (prof) C.write(C.KEYS.profile, { name: prof.name, path: prof.path, primaryGoal: prof.primaryGoal, spec: '', win: '', obstacle: prof.obstacle, joined: prof.joined });
    var path = prof ? prof.path : '';
    // Only mirror ACCEPTED proofs (decision='accepted') so the local standing/streak
    // approximation matches get_user_standing. Pending/rejected proofs earn 0 points
    // and must not count as movement. The backfill in the integrity migration ensures
    // all existing 'approved' rows have decision='accepted'.
    var pr = (await sb.from('proofs').select('*').eq('user_id', id).eq('decision', 'accepted').order('created_at')).data || [];
    C.write(C.KEYS.proofs, pr.map(function (p) {
      return { id: p.id, taskId: p.task_id, taskTitle: p.task_title, goalType: path, difficulty: 'core',
               baseXp: p.earned_xp, earnedXp: p.earned_xp, note: p.note, photoDataUrl: '',
               timestamp: Date.parse(p.created_at) || Date.now(), date: p.date };
    }));
    // carry today's PERSONALISED tasks into a local cache so why_personalised /
    // mistake_to_avoid / fallback / upgrade / tags survive a reload (and an offline
    // open). getTasks() reads these live from the DB when online; this is the mirror.
    try {
      var dt = (await sb.from('daily_tasks').select('*').eq('user_id', id).eq('date', today()).order('created_at')).data || [];
      C.write('vision_daily_tasks', { date: today(), tasks: dt.map(function (t) {
        return { id: t.id, title: t.title, difficulty: t.difficulty, role: t.role, baseXp: t.base_xp,
                 goalType: t.goal_type,
                 whyPersonalised: t.why_personalised, mistakeToAvoid: t.mistake_to_avoid,
                 fallback: t.fallback_task, upgrade: t.upgrade_task, tags: t.personalisation_tags || [] };
      }) });
    } catch (e) {}
    var xp = await getXp();
    if (xp) C.write(C.KEYS.xp, { totalXp: xp.totalXp, todayXp: xp.todayXp, completedToday: xp.completedToday, streak: xp.streak, bestStreak: xp.bestStreak, multiplier: xp.multiplier, lastActive: xp.lastActive, dailyProofScore: xp.dailyProofScore || 0 });
    var sc = await getScores();
    if (sc) C.write(C.KEYS.scores, { potentialScore: sc.potentialScore, futureScore: sc.futureScore, trajectory: sc.trajectory, proofCount: sc.proofCount, updated: today() });
    // mirror today's backend constraints into the local store so the local
    // deterministic layer (strategist/dashboard demo paths) plans with the
    // same time/energy the backend plan was built from
    try {
      var dc = (await sb.from('daily_constraints').select('time_minutes,energy').eq('user_id', id).eq('date', today()).maybeSingle()).data;
      if (dc && C.getDailyConstraints && C.setDailyConstraints) {
        var lc = C.getDailyConstraints();
        if (!lc.set || lc.minutes !== dc.time_minutes || lc.energy !== dc.energy) C.setDailyConstraints(dc.time_minutes, dc.energy);
      }
    } catch (e) {}
    return true;
  }

  async function hasVisionPro() {
    var id = await uid(); if (!id) return false;
    try {
      var r = await sb.from('profiles').select('subscription_tier').eq('id', id).maybeSingle();
      return (r.data && r.data.subscription_tier === 'vision_pro') || false;
    } catch (e) { return false; }
  }

  // Exact deployed ask-vision contract (verified against Supabase project
  // qosaphtqksvocufjvtpa, ask-vision v22): the body may contain ONLY
  // task_id/mode/question (an extra key 400s as unknown_fields) and mode
  // must be exactly one of these — anything else 400s as invalid_mode. The
  // Analyst chat's own intent vocabulary (chat sends 'message', quick
  // actions send ids like 'execution_blocker', 'am_final', …) is a much
  // richer local taxonomy that was never meant to reach the wire as-is, so
  // it is translated here, at the single point the request body is built.
  var ASK_VISION_MODES = ['explain', 'example', 'easier', 'harder', 'proof', 'stuck', 'goal', 'custom'];
  function askVisionMode(mode) {
    var m = String(mode == null ? '' : mode).trim().toLowerCase();
    return ASK_VISION_MODES.indexOf(m) > -1 ? m : 'custom';
  }

  async function askVision(taskId, question, mode) {
    // Only send task_id, mode, question — task content is loaded server-side.
    var body = { task_id: taskId, question: question, mode: askVisionMode(mode) };
    // supabase-js has no per-call timeout; race the invoke so a hung request
    // surfaces a clean retryable error instead of spinning forever. The function
    // itself aborts the model at 25s, so 30s is a safe outer bound.
    var res;
    try {
      var invoke = sb.functions.invoke('ask-vision', { body: body });
      var timeout = new Promise(function (_, reject) {
        setTimeout(function () { reject({ error: 'timeout', message: 'Analyst timed out. Try again.' }); }, 30000);
      });
      res = await Promise.race([invoke, timeout]);
    } catch (e) {
      if (e && e.error) throw e;                 // our timeout sentinel
      throw { error: 'connection_failed', message: 'Could not reach the Analyst.' };
    }
    if (res.error) {
      // Non-2xx: supabase-js returns a FunctionsHttpError whose JSON body lives
      // in error.context (a Response) and is NOT auto-parsed. Extract the real
      // error code (quota_exceeded, no_profile, no_active_task, ai_*, …) so the
      // UI can show a specific state instead of a generic failure.
      var parsed = null, status = 0;
      try {
        var ctx = res.error.context;
        if (ctx) { status = ctx.status || 0; if (typeof ctx.json === 'function') parsed = await ctx.json(); }
      } catch (e2) { /* body unreadable — fall through to generic */ }
      if (parsed && parsed.error) { parsed.status = status; throw parsed; }
      throw { error: 'connection_failed', message: (res.error && res.error.message) || 'Could not reach the Analyst.', status: status };
    }
    var data = res.data || {};
    if (data.error) throw data; // 2xx-with-error (defensive)
    // Validate the shape before handing to the UI — never render a blank card.
    if (typeof data.answer !== 'string' || !data.answer.trim()) {
      throw { error: 'invalid_response', message: 'Analyst returned an empty answer.' };
    }
    return { answer: data.answer, sections: data.sections, cached: data.cached, task_id: data.task_id, quota: data.quota };
  }

  async function getAskVisionQuota() {
    var id = await uid(); if (!id) return null;
    try {
      var res = await sb.rpc('get_ask_vision_quota');
      if (res.error) return null;
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (!row) return null;
      return { used: Number(row.used), remaining: Number(row.remaining), limit: Number(row.limit || 50) };
    } catch (e) { return null; }
  }

  async function getActiveTask() {
    var id = await uid(); if (!id) return null;
    var r = await sb.from('daily_tasks').select('*')
      .eq('user_id', id).eq('date', today()).eq('activation_status', 'active')
      .order('sequence_position', { ascending: true, nullsFirst: false }).limit(1).maybeSingle();
    if (r.error || !r.data) return null;
    var t = r.data;
    var pr = await sb.from('proofs').select('decision')
      .eq('task_id', t.id).eq('user_id', id).eq('date', today())
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    t.proofDecision = (pr.data && pr.data.decision) || null;
    return mapTask(t);
  }

  async function getDailyProgression() {
    var id = await uid(); if (!id) return null;
    try {
      var r = await sb.rpc('get_daily_progression', { p_date: today() });
      if (r.error) return null;
      return r.data || null;
    } catch(e) { return null; }
  }

  /* ── Standing (server-authoritative) ──
     Reads get_user_standing (verified points + proof days + accepted Hard Tasks)
     and maps via the shared 6-tier model. Falls back to the local demo standing
     only when offline. */
  async function getStanding() {
    var id = await uid(); if (!id) return null;
    var row = null;
    try { var r = await sb.rpc('get_user_standing'); row = (r && r.data) || null; } catch (e) {}
    if (row && typeof row.verified_points === 'number') {
      var st = standingFromFacts(row.verified_points, row.proof_days, row.hard_tasks) || {};
      st.backendVerified = true;
      st.facts = row;
      return st;
    }
    try { var p = window.VISION && VISION.core && VISION.core.getPercentile && VISION.core.getPercentile();
      if (p) { p.backendVerified = false; return p; } } catch (e) {}
    return null;
  }

  /* ── Rolling top-up ──
     Top-up is now a SERVER-ONLY generation mode. The deployed generate-tasks
     function answers 403 internal_generation_required to any browser request
     carrying mode:'topup' or reason:'rolling_topup', because a top-up must be
     claimed with a service-role idempotency key. The browser calling it could
     only ever fail, so it no longer calls it.

     The current server policy is one dominant Today's Move anyway
     (generation_policy_v1_one_dominant_move, final_task_count 1), so there is no
     hidden queue for the client to keep topped up. Left as an explicit no-op
     rather than deleted so the fire-and-forget callers keep working. */
  async function topUpTasks() {
    return { ok: false, skipped: true, reason: 'server_owned' };
  }

  async function getVerifiedPointsToday() {
    var id = await uid(); if (!id) return 0;
    var t = today();
    var r = await sb.from('xp_events').select('amount').eq('user_id', id).eq('source', 'proof_award').gte('created_at', t).lt('created_at', t + 'T23:59:59.999Z');
    return (r.data || []).reduce(function(s, e) { return s + (e.amount || 0); }, 0);
  }

  async function proposeAdaptation(taskId, reasonType, description) {
    var vr;
    try {
      vr = await sb.functions.invoke('propose-adaptation', {
        body: { task_id: taskId, reason_type: reasonType, description: description || '' }
      });
    } catch(e) { return { ok: false, error: 'network_error' }; }
    if (vr.error) return { ok: false, error: vr.error.message || 'invoke_error' };
    return vr.data || { ok: false, error: 'no_data' };
  }

  async function applyAdaptation(adaptationId) {
    var r = await sb.rpc('apply_task_adaptation', { p_adaptation_id: adaptationId });
    if (r.error) return { ok: false, error: r.error.message };
    return r.data || { ok: false };
  }

  /* ── FUEL TRACKER (nutrition) ──────────────────────────────────────────────
     Photo of food → upload to private storage → insert nutrition_logs (pending)
     → estimate-nutrition Edge Function writes macros server-side → read back. */
  async function logMeal(photo) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    if (!photo) return { error: 'no-photo' };
    var blob = (typeof photo === 'string') ? dataURLtoBlob(photo) : photo;
    if (blob.type && blob.type.indexOf('heic') > -1) {
      try { blob = await heicToJpeg(blob); } catch (e) {}
    }
    var ext = (blob.type && blob.type.indexOf('png') > -1) ? 'png'
            : (blob.type && blob.type.indexOf('webp') > -1) ? 'webp' : 'jpg';
    var path = id + '/fuel/' + today() + '/' + Date.now() + '.' + ext;

    var up = await sb.storage.from('proofs').upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (up.error) return { error: 'upload_failed', detail: up.error.message };

    var ins = await sb.from('nutrition_logs')
      .insert({ user_id: id, date: today(), image_url: path, status: 'pending' })
      .select('id').single();
    if (ins.error || !ins.data) return { error: 'insert_failed', detail: ins.error && ins.error.message };
    var logId = ins.data.id;

    // server-authoritative macro estimate. The photo is the ONLY source of macros —
    // the browser sends just the log id and the Edge Function's vision read owns the
    // write. There is no client-supplied hint, so nothing typed can influence the macros.
    var body = { log_id: logId };
    try {
      var er = await sb.functions.invoke('estimate-nutrition', { body: body });
      if (er && er.data && er.data.meal) return { meal: er.data.meal };
    } catch (e) { /* fall through — re-read row below */ }

    // re-read whatever the function wrote (or pending)
    var rb = await sb.from('nutrition_logs').select('id,label,kcal,protein,carbs,fats,confidence,status').eq('id', logId).single();
    return { meal: rb.data || { id: logId, status: 'pending' } };
  }

  async function getNutritionToday(d) {
    var id = await uid(); if (!id) return { meals: [] };
    var r = await sb.from('nutrition_logs')
      .select('id,label,kcal,protein,carbs,fats,confidence,status,created_at')
      .eq('user_id', id).eq('date', d || today()).order('created_at', { ascending: true });
    if (r.error) return { meals: [] };
    var meals = (r.data || []).filter(function (m) { return m.status === 'estimated'; })
      .map(function (m) { return { id: m.id, label: m.label, kcal: m.kcal || 0, protein: m.protein || 0, carbs: m.carbs || 0, fats: m.fats || 0, confidence: m.confidence, img: null }; });
    return { meals: meals };
  }

  async function awardNutritionGoal(d) {
    var r = await sb.rpc('award_nutrition_goal', { p_date: d || today() });
    if (r.error) return { error: String(r.error.message || r.error) };
    return r.data || { awarded: false };
  }

  async function setFuelProfile(stats) {
    var id = await uid(); if (!id) return { error: 'not_authenticated' };
    var patch = {};
    if (stats.weightKg != null) patch.weight_kg = stats.weightKg;
    if (stats.heightCm != null) patch.height_cm = stats.heightCm;
    if (stats.age != null) patch.age = stats.age;
    if (stats.sex) patch.sex = stats.sex;
    if (stats.fuelGoal) patch.fuel_goal = stats.fuelGoal;
    if (!Object.keys(patch).length) return { ok: true };
    var r = await sb.from('profiles').update(patch).eq('id', id);
    return r.error ? { error: r.error.message } : { ok: true };
  }

  async function liveSessionStart(taskId, device) { var r=await sb.functions.invoke('live-session-start',{body:{task_id:taskId,device:device||{}}}); return r.error?{error:r.error.message}:r.data; }
  async function liveSessionEvent(sessionId, sequence, clientMs, type, payload) { var r=await sb.functions.invoke('live-session-event',{body:{session_id:sessionId,sequence_number:sequence,client_monotonic_ms:clientMs,event_type:type,event_payload:payload||{}}}); return r.error?{error:r.error.message}:r.data; }
  async function liveSessionCheckpoint(sessionId, checkpointId, path, fingerprint) { var r=await sb.functions.invoke('live-session-checkpoint',{body:{session_id:sessionId,checkpoint_id:checkpointId,path:path,fingerprint:fingerprint||''}}); return r.error?{error:r.error.message}:r.data; }
  async function liveSessionCheckpointRequestFinal(sessionId) { var r=await sb.functions.invoke('live-session-checkpoint',{body:{action:'request_final',session_id:sessionId}}); return r.error?{error:r.error.message}:r.data; }
  async function liveSessionUploadCheckpoint(sessionId, checkpointId, photo) {
    var id=await uid();if(!id||!photo)return{error:'invalid_checkpoint_upload'};
    var blob=typeof photo==='string'?dataURLtoBlob(photo):photo;if(!blob||!String(blob.type||'').startsWith('image/'))return{error:'checkpoint_must_be_image'};
    var ext=extForType(blob.type),path=id+'/'+today()+'/live-checkpoints/'+sessionId+'-'+checkpointId+'-'+Date.now()+'.'+ext;
    var up=await sb.storage.from('proofs').upload(path,blob,{contentType:blob.type||'image/jpeg',upsert:false});if(up.error)return{error:'checkpoint_upload_failed'};
    var digest='';try{var hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());digest=Array.from(new Uint8Array(hash)).map(function(v){return v.toString(16).padStart(2,'0');}).join('');}catch(e){}
    var receipt=await liveSessionCheckpoint(sessionId,checkpointId,path,digest);if(receipt&&receipt.accepted_checkpoint_receipt)receipt.path=path;return receipt;
  }
  async function liveSessionFinish(sessionId, sequence, clientMs, summary) { var r=await sb.functions.invoke('live-session-finish',{body:{session_id:sessionId,sequence_number:sequence,client_monotonic_ms:clientMs,summary:summary||{}}}); return r.error?{error:r.error.message}:r.data; }
  async function liveSessionStatus(sessionId) { var r=await sb.functions.invoke('live-session-status',{body:{session_id:sessionId}}); return r.error?{error:r.error.message}:r.data; }
  async function createCustomTask(input) {
    input=input||{};
    var r=await sb.functions.invoke('create-custom-task',{body:{title:String(input.title||'').trim(),description:String(input.description||'').trim(),goal:String(input.goal||'').trim(),proof_type:String(input.proofType||'auto')}});
    if(r.error){var code='';try{if(r.error.context&&typeof r.error.context.json==='function'){var detail=await r.error.context.json();code=String(detail&&detail.error||'');}}catch(e){}return{error:code||r.error.message};}
    return r.data;
  }

  V.api = {
    getProfile: getProfile, getScores: getScores, getXp: getXp,
    logMeal: logMeal, getNutritionToday: getNutritionToday, awardNutritionGoal: awardNutritionGoal, setFuelProfile: setFuelProfile,
    getCanonicalAppState: getCanonicalAppState, standingFromFacts: standingFromFacts,
    getStanding: getStanding, topUpTasks: topUpTasks,
    getTasks: getTasks, seedTaskStreamIfEmpty: seedTaskStreamIfEmpty, isTaskDone: isTaskDone, getRecentProofs: getRecentProofs,
    getDailyConstraints: getDailyConstraints, setDailyConstraints: setDailyConstraints,
    saveOnboarding: saveOnboarding, submitProof: submitProof, issueProofChallenge: issueProofChallenge, refreshTasks: refreshTasks, saveFeedback: saveFeedback,
    regenerateTasksForCurrentProfile: regenerateTasksForCurrentProfile, clearGenerationCooldown: clearGenerationCooldown,
    isTaskSetStaleForProfile: isTaskSetStaleForProfile, buildProfileAnchors: buildProfileAnchors,
    ensureDailyPlan: ensureDailyPlan,
    updateDisplayName: updateDisplayName, saveDesiredTaskCount: saveDesiredTaskCount,
    updateGoalPrefs: updateGoalPrefs, exportMyData: exportMyData, deleteAccount: deleteAccount,
    isUsernameAvailable: isUsernameAvailable, setUsername: setUsername,
    getLeaderboard: getLeaderboard, addFriendByCode: addFriendByCode, acceptFriend: acceptFriend,
    getFriendBoard: getFriendBoard, getWeeklyRival: getWeeklyRival,
    getFriendChallenges: getFriendChallenges, getFriendActivity: getFriendActivity,
    getInviteCode: getInviteCode, getSocialStats: getSocialStats, getFriendProfile: getFriendProfile,
    hasVisionPro: hasVisionPro, askVision: askVision, getAskVisionQuota: getAskVisionQuota,
    hydrateLocal: hydrateLocal,
    reportBadTask: reportBadTask, hasMissingPathFields: hasMissingPathFields,
    getActiveTask: getActiveTask,
    getVerifiedPointsToday: getVerifiedPointsToday,
    createCustomTask: createCustomTask,
    deferStaleGoalTasks: async function() { var r = await sb.rpc('defer_stale_goal_tasks'); return r.data || { deferred: 0 }; },
    getDailyProgression: getDailyProgression,
    proposeAdaptation: proposeAdaptation,
    applyAdaptation: applyAdaptation,
    liveSessionStart: liveSessionStart, liveSessionEvent: liveSessionEvent, liveSessionCheckpoint: liveSessionCheckpoint,
    liveSessionCheckpointRequestFinal: liveSessionCheckpointRequestFinal, liveSessionUploadCheckpoint: liveSessionUploadCheckpoint,
    liveSessionFinish: liveSessionFinish, liveSessionStatus: liveSessionStatus,
    // ── owner/admin proof QA + telemetry (server-authoritative) ──────────────
    // Access is decided ONLY by the server (app_admins allowlist via
    // can_access_proof_qa); the client never authorises itself. Telemetry is
    // best-effort and descriptive only — it can never carry a trusted decision
    // and never blocks or affects a proof flow.
    getProofQaStatus: async function () {
      try { var r = await sb.rpc('get_my_proof_qa_status'); return (r && !r.error && r.data) ? r.data : { is_admin: false, authenticated: false }; }
      catch (e) { return { is_admin: false, authenticated: false }; }
    },
    canAccessProofQa: async function () {
      try { var r = await sb.rpc('can_access_proof_qa'); return !!(r && !r.error && r.data === true); }
      catch (e) { return false; }
    },
    recordProofTelemetry: async function (ev) {
      ev = ev || {};
      if (!ev.event_type) return { ok: false };
      try {
        var r = await sb.rpc('record_proof_telemetry', {
          p_event_type: String(ev.event_type),
          p_modality: ev.modality || null, p_verifier_id: ev.verifier_id || null,
          p_reason_code: ev.reason_code || null, p_device_class: ev.device_class || null,
          p_duration_ms: (ev.duration_ms != null ? (ev.duration_ms | 0) : null),
          p_fps: (ev.fps != null ? Number(ev.fps) : null),
          p_latency_ms: (ev.latency_ms != null ? Number(ev.latency_ms) : null),
          p_count_total: (ev.count_total != null ? (ev.count_total | 0) : null),
          p_confidence_bucket: ev.confidence_bucket || null,
          p_proof_id: ev.proof_id || null,
          p_live_session_id: ev.live_session_id || null,
          p_contract_version: (ev.contract_version != null ? (ev.contract_version | 0) : null),
          p_verifier_version: ev.verifier_version || null,
          p_browser_category: ev.browser_category || null
        });
        return { ok: !(r && r.error) };
      } catch (e) { return { ok: false }; }
    },
    proofHealthReport: async function (days) {
      try { var r = await sb.rpc('proof_health_report', { p_days: (days | 0) || 1 }); return (r && r.error) ? { error: String(r.error.message || r.error) } : (r ? r.data : { error: 'rpc_error' }); }
      catch (e) { return { error: 'rpc_error' }; }
    },
    submitReflection: async function(text) {
      var r = await sb.rpc('submit_daily_reflection', { p_text: text });
      return r.data || { ok: false, reason: r.error ? String(r.error.message || r.error) : 'rpc_error' };
    },
    evaluateReflection: async function(reflectionId) {
      var vr;
      try {
        vr = await sb.functions.invoke('evaluate-reflection', { body: { reflection_id: reflectionId } });
      } catch (e) {
        return { status: 'retry', feedback: 'Could not evaluate yet — try again.' };
      }
      if (vr.error) {
        return { status: 'retry', feedback: 'Could not evaluate yet — try again.' };
      }
      return vr.data || { status: 'retry', feedback: 'Could not evaluate yet — try again.' };
    }
  };
})(window.VISION);
