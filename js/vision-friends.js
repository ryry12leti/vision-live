/* ═══════════════════════════════════════════════════════════════
   vision-friends.js — VISION web MVP friends / competitive layer
   ---------------------------------------------------------------
   The social hook of the loop: a friend you're racing, a gap you can
   close with proof, and visible movement. Tester-ready and 100% local.

   IMPORTANT — this module NEVER awards XP. The only XP gateway is
   logProof() in vision-core.js (no photo = no XP). This module only
   listens to the `vision:proof-logged` event and reads the real,
   proof-derived XP back out via VISION.core. Friend rank, rival gaps
   and challenge progress all move only when real photo proof moves.

   State lives in localStorage under the vision_* contract:
     vision_friends  vision_weekly_rival  vision_friend_challenges
     vision_friend_activity  vision_invite_code

   Public API: window.VISION.friends
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  const C = V.core;   // single source of truth for real (proof-derived) state

  const KEYS = {
    friends:    'vision_friends',
    rival:      'vision_weekly_rival',
    challenges: 'vision_friend_challenges',
    activity:   'vision_friend_activity',
    invite:     'vision_invite_code'
  };

  /* ---------- low-level storage (mirrors vision-core.js) ---------- */
  function read(k)  { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function initialsOf(name) { return (name || '?').trim().slice(0, 1).toUpperCase(); }

  // average XP a single photo proof is worth — used to turn an XP gap into a
  // human "proofs to overtake" number. Single source of truth: vision-core.
  const PROOF_XP = C.XP_BY_DIFF.core;

  /* ═══════════════ SEED DATA (demo, deterministic) ═══════════════
     Friends are seeded once then persist. Their stats are static demo
     values; only YOUR row is live (recomputed from real proof). */
  // A climbable ladder: the lowest friend sits ~2-3 proofs ahead so even a
  // fresh user has a catchable weekly rival ("2 proofs to overtake"). As you
  // pass one, the next friend up becomes the rival — a natural climb.
  const SEED_FRIENDS = [
    { id: 'fr_jayden', name: 'Jayden', path: 'fitness',    totalXp: 1240, todayXp: 180, proofCountToday: 5, streak: 9,  improvement: 38, movement: 2,  state: 'NSW', status: 'climbing' },
    { id: 'fr_arjun',  name: 'Arjun',  path: 'study',      totalXp: 820,  todayXp: 140, proofCountToday: 4, streak: 5,  improvement: 28, movement: 1,  state: 'VIC', status: 'steady' },
    { id: 'fr_ava',    name: 'Ava',    path: 'discipline', totalXp: 470,  todayXp: 90,  proofCountToday: 2, streak: 14, improvement: 24, movement: -1, state: 'QLD', status: 'steady' },
    { id: 'fr_marco',  name: 'Marco',  path: 'money',      totalXp: 240,  todayXp: 60,  proofCountToday: 1, streak: 3,  improvement: 17, movement: -2, state: 'WA',  status: 'slipping' },
    { id: 'fr_sofia',  name: 'Sofia',  path: 'fitness',    totalXp: 95,   todayXp: 120, proofCountToday: 3, streak: 7,  improvement: 21, movement: 3,  state: 'NSW', status: 'climbing' }
  ];

  const EXTRA_NAMES = ['Noah', 'Mia', 'Liam', 'Zara', 'Eli', 'Priya', 'Kai', 'Leo'];

  function seedFriends() {
    let f = read(KEYS.friends);
    if (f && f.length) return f;
    f = SEED_FRIENDS.map(fr => Object.assign({ initials: initialsOf(fr.name), rank: 0 }, fr));
    write(KEYS.friends, f);
    return f;
  }

  function seedChallenges() {
    let ch = read(KEYS.challenges);
    if (ch && ch.length) return ch;
    ch = [
      { id: 'ch_proof3',   friendId: 'fr_jayden', friendName: 'Jayden', title: '3 proofs today',        description: 'Log 3 photo proofs before midnight.',        requiredProofs: 3, yourProgress: 0, friendProgress: 2, rewardXp: 60,  status: 'active' },
      { id: 'ch_study',    friendId: 'fr_arjun',  friendName: 'Arjun',  title: 'Study streak race',      description: 'Most study proofs this week takes it.',       requiredProofs: 5, yourProgress: 0, friendProgress: 3, rewardXp: 90,  status: 'active' },
      { id: 'ch_workout',  friendId: 'fr_sofia',  friendName: 'Sofia',  title: 'Workout proof race',     description: 'First to 4 workout proofs wins the week.',    requiredProofs: 4, yourProgress: 0, friendProgress: 1, rewardXp: 80,  status: 'active' },
      { id: 'ch_weekend',  friendId: 'fr_ava',    friendName: 'Ava',    title: 'Weekend consistency',    description: 'Prove effort both weekend days.',             requiredProofs: 2, yourProgress: 0, friendProgress: 0, rewardXp: 50,  status: 'active' }
    ];
    write(KEYS.challenges, ch);
    return ch;
  }

  function seedActivity() {
    let a = read(KEYS.activity);
    if (a && a.length) return a;
    const now = Date.now();
    a = [
      { id: 'ac_1', friendName: 'Jayden', action: 'logged Workout Proof', timestamp: now - 1000 * 60 * 22,  type: 'proof' },
      { id: 'ac_2', friendName: 'Ava',    action: 'completed 3 proofs',   timestamp: now - 1000 * 60 * 70,  type: 'proof' },
      { id: 'ac_3', friendName: 'Arjun',  action: 'started a 5-day streak', timestamp: now - 1000 * 60 * 140, type: 'streak' },
      { id: 'ac_4', friendName: 'Sofia',  action: 'climbed to #2 this week', timestamp: now - 1000 * 60 * 200, type: 'rank' }
    ];
    write(KEYS.activity, a);
    return a;
  }

  function ensureInvite() {
    let code = read(KEYS.invite);
    if (code) return code;
    const prof = (C && C.getProfile && C.getProfile()) || {};
    const handle = (prof.name || 'YOU').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'YOU';
    // deterministic 3-digit tag from the handle so the code is stable per user
    let sum = 0; for (let i = 0; i < handle.length; i++) sum += handle.charCodeAt(i);
    const tag = String(100 + (sum % 900));
    code = 'VISION-' + handle + '-' + tag;
    write(KEYS.invite, code);
    return code;
  }

  function ensureRival() {
    let rv = read(KEYS.rival);
    if (rv && rv.friendId) return rv;
    const friends = seedFriends();
    const yourXp = meRow().totalXp;
    // rival = the closest friend just above you; if you lead everyone, the top friend
    const above = friends.filter(f => f.totalXp > yourXp).sort((a, b) => a.totalXp - b.totalXp);
    const target = above[0] || friends.slice().sort((a, b) => b.totalXp - a.totalXp)[0];
    rv = { id: 'rival_week', friendId: target.id, name: target.name, rivalXp: target.totalXp, rewardXp: 120, wins: 2 };
    write(KEYS.rival, rv);
    return rv;
  }

  /* ═══════════════ LIVE "YOU" ROW (real proof-derived state) ═══════════════ */
  function meRow() {
    const xp = (C && C.getXp && C.getXp()) || { totalXp: 0, todayXp: 0, streak: 0 };
    const proofsToday = (C && C.proofsToday && C.proofsToday().length) || 0;
    const imp = (C && C.improvement && C.improvement()) || 0;
    return {
      id: 'you', name: 'You', you: true, initials: 'Y', path: '',
      totalXp: xp.totalXp, todayXp: xp.todayXp || 0,
      proofCountToday: proofsToday, streak: xp.streak || 0,
      improvement: imp, movement: Math.max(0, xp.completedToday || proofsToday),
      state: 'NSW', status: 'you'
    };
  }

  /* ═══════════════ PUBLIC READERS ═══════════════ */
  // demo friends only, ranked among themselves by improvement then XP
  function getFriends() {
    const f = seedFriends().slice().sort((a, b) => b.improvement - a.improvement || b.totalXp - a.totalXp);
    f.forEach((r, i) => { r.rank = i + 1; });
    return f;
  }

  // friends + the live You row, ranked together — the leaderboard's Friends view
  function getFriendBoard() {
    const rows = seedFriends().slice();
    rows.push(meRow());
    rows.sort((a, b) => b.improvement - a.improvement || b.totalXp - a.totalXp);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return { rows };
  }

  function yourFriendRank() {
    const board = getFriendBoard();
    const me = board.rows.find(r => r.you);
    return { rank: me ? me.rank : board.rows.length, of: board.rows.length };
  }

  // weekly rival with the gap recomputed live from YOUR real XP
  function getWeeklyRival() {
    const rv = ensureRival();
    const friends = seedFriends();
    const target = friends.find(f => f.id === rv.friendId) || friends[0];
    const yourXp = meRow().totalXp;
    const rivalXp = target ? target.totalXp : rv.rivalXp;
    const rawGap = rivalXp - yourXp;
    const xpGap = Math.max(0, rawGap);
    const proofGap = xpGap > 0 ? Math.max(1, Math.ceil(xpGap / PROOF_XP)) : 0;
    return {
      id: rv.id, friendId: rv.friendId, name: target ? target.name : rv.name,
      yourXp: yourXp, rivalXp: rivalXp, xpGap: xpGap, proofGap: proofGap,
      daysLeft: daysLeftInWeek(), rewardXp: rv.rewardXp || 120, wins: rv.wins || 0,
      status: yourXp >= rivalXp ? 'ahead' : 'behind'
    };
  }

  // challenge progress is driven ONLY by real photo proofs logged today
  function getFriendChallenges() {
    const proofsToday = (C && C.proofsToday && C.proofsToday().length) || 0;
    return seedChallenges().map(ch => {
      const yourProgress = clamp(proofsToday, 0, ch.requiredProofs);
      const status = yourProgress >= ch.requiredProofs ? 'won' : 'active';
      return Object.assign({}, ch, { yourProgress: yourProgress, status: status });
    });
  }

  function getFriendActivity() {
    return (read(KEYS.activity) || seedActivity()).slice(0, 8);
  }

  function getInviteCode() {
    return ensureInvite();
  }

  function getSocialStats() {
    const friends = seedFriends();
    const board = getFriendBoard();
    const me = board.rows.find(r => r.you);
    const rival = getWeeklyRival();
    const proofWins = me ? board.rows.filter(r => !r.you && r.totalXp < me.totalXp).length : 0;
    return {
      friends: friends.length,
      weeklyRank: me ? me.rank : board.rows.length,
      weeklyOf: board.rows.length,
      rivalWins: rival.wins,
      proofWins: proofWins,
      inviteCode: getInviteCode()
    };
  }

  /* ═══════════════ PROFILE PREVIEW (read-only, no XP) ═══════════════ */
  function getFriendById(id) {
    return seedFriends().find(f => f.id === id) || null;
  }

  // gap between you (real proof-derived XP) and any friend
  function getFriendGap(id) {
    const f = getFriendById(id);
    const yourXp = meRow().totalXp;
    const friendXp = f ? f.totalXp : 0;
    const xpGap = Math.max(0, friendXp - yourXp);
    const proofGap = xpGap > 0 ? Math.max(1, Math.ceil(xpGap / PROOF_XP)) : 0;
    return { yourXp: yourXp, friendXp: friendXp, xpGap: xpGap, proofGap: proofGap,
             status: yourXp >= friendXp ? 'ahead' : 'behind' };
  }

  // the challenge tied to this friend (prefer an active one), or null
  function getFriendChallengeSummary(id) {
    const mine = getFriendChallenges().filter(c => c.friendId === id);
    if (!mine.length) return null;
    return mine.find(c => c.status === 'active') || mine[0];
  }

  // everything the profile-preview modal needs about one friend
  function getFriendProfile(id) {
    const f = getFriendById(id);
    if (!f) return null;
    const brow = getFriendBoard().rows.find(r => r.id === id);
    const rival = getWeeklyRival();
    return {
      id: f.id, name: f.name, initials: f.initials, path: f.path,
      totalXp: f.totalXp, todayXp: f.todayXp, proofCountToday: f.proofCountToday,
      streak: f.streak, improvement: f.improvement, movement: f.movement, status: f.status,
      friendRank: brow ? brow.rank : null,
      gap: getFriendGap(id),
      challenge: getFriendChallengeSummary(id),
      isRival: rival.friendId === id,
      rivalReward: rival.rewardXp || 120
    };
  }

  /* ═══════════════ MUTATORS (no XP — local demo only) ═══════════════ */
  // make any friend the current weekly rival (keeps wins/reward); demo-local
  function setWeeklyRival(id) {
    const f = getFriendById(id);
    if (!f) return null;
    const rv = read(KEYS.rival) || {};
    write(KEYS.rival, { id: 'rival_week', friendId: f.id, name: f.name, rivalXp: f.totalXp,
                        rewardXp: rv.rewardXp || 120, wins: rv.wins || 0 });
    emitUpdated();
    return getWeeklyRival();
  }

  function addDemoFriend(code) {
    const friends = seedFriends();
    const used = friends.map(f => f.name);
    const name = EXTRA_NAMES.find(n => used.indexOf(n) === -1) || ('Friend' + (friends.length + 1));
    const seed = friends.length;
    const friend = {
      id: 'fr_' + name.toLowerCase(), name: name, initials: initialsOf(name), path: 'discipline',
      totalXp: 1200 + seed * 60, todayXp: 40 + (seed % 3) * 20,
      proofCountToday: (seed % 3) + 1, streak: 2 + (seed % 5),
      improvement: 14 + (seed % 9), movement: ((seed * 3) % 5) - 2,
      state: ['NSW', 'VIC', 'QLD', 'WA'][seed % 4], rank: 0,
      status: 'steady'
    };
    friends.push(friend);
    write(KEYS.friends, friends);
    pushActivity({ friendName: name, action: 'joined your circle', type: 'join' });
    emitUpdated();
    return { ok: true, friend: friend, message: name + ' added to your circle (demo).' };
  }

  function pushActivity(entry) {
    const a = read(KEYS.activity) || seedActivity();
    a.unshift(Object.assign({ id: 'ac_' + Date.now() + '_' + (a.length), timestamp: Date.now() }, entry));
    write(KEYS.activity, a.slice(0, 24));
    return a;
  }

  /* ═══════════════ PROOF HOOK ═══════════════
     Fires after vision-core has already awarded XP for a real photo proof.
     We only READ the resulting state and update friend-facing views. */
  function updateAfterProof(detail) {
    detail = detail || {};
    const newXp = (detail.xp && detail.xp.totalXp) || meRow().totalXp;
    const earned = (detail.taskXp || 0) + (detail.streakBonus || 0) + (detail.assignmentBonus || 0);
    const prevXp = newXp - earned;

    // "You logged proof"
    pushActivity({ friendName: 'You', action: 'logged ' + ((detail.proof && detail.proof.taskTitle) || 'photo proof'), type: 'proof' });

    // overtakes: friends whose XP you crossed with this proof
    seedFriends().forEach(f => {
      if (f.totalXp > prevXp && f.totalXp <= newXp) {
        pushActivity({ friendName: 'You', action: 'overtook ' + f.name, type: 'overtake' });
      }
    });

    emitUpdated();
  }

  function emitUpdated() {
    try { window.dispatchEvent(new CustomEvent('vision:friends-updated')); } catch (e) {}
  }

  /* ---------- helpers ---------- */
  function daysLeftInWeek() {
    const d = new Date().getDay();        // 0 Sun … 6 Sat
    return ((7 - d) % 7) || 7;            // days until next Monday (Sun → 7)
  }

  /* ---------- init: seed everything once, wire the proof hook ---------- */
  function init() {
    seedFriends(); seedChallenges(); seedActivity(); ensureRival();
  }
  init();
  window.addEventListener('vision:proof-logged', function (e) { updateAfterProof(e.detail); });

  /* ═══════════════ PUBLIC API ═══════════════ */
  V.friends = {
    KEYS,
    getFriends, getFriendBoard, yourFriendRank,
    getWeeklyRival, getFriendChallenges, getFriendActivity,
    getInviteCode, getSocialStats,
    getFriendById, getFriendGap, getFriendChallengeSummary, getFriendProfile,
    setWeeklyRival, addDemoFriend, pushActivity, updateAfterProof
  };
})(window.VISION);
