/* VISION Tasks · Verified award state
   Owns idempotent point/rank application only. The verification controller
   synchronously hands its returned event to the one #tdResult renderer. */
(function (root) {
  'use strict';

  const VisionTasks = root.VisionTasks = root.VisionTasks || {};
  const VERSION = 1;
  const captures = new Map();
  const FALLBACK_RANKS = [
    'Bronze III','Bronze II','Bronze I','Silver III','Silver II','Silver I',
    'Gold III','Gold II','Gold I','Platinum','Diamond','Elite','Legend','Mythic'
  ];
  const FALLBACK_THRESHOLDS = (function () {
    const values = [0]; let needed = 300;
    for (let i = 1; i < FALLBACK_RANKS.length; i += 1) {
      values.push(values[i - 1] + needed);
      needed = Math.round(needed * 1.16);
    }
    return values;
  })();

  function userScope() {
    try { if (typeof CURRENT_USER_ID !== 'undefined' && CURRENT_USER_ID) return String(CURRENT_USER_ID); } catch (e) {}
    return 'demo';
  }
  function storeKey(testMode) { return 'vision_rank_reveal_v' + VERSION + '_' + userScope() + (testMode ? '_owner_test' : ''); }
  function emptyState() { return { version:VERSION, currentTotal:null, awards:{}, history:[] }; }
  function readState(testMode) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storeKey(testMode)) || 'null');
      if (!parsed || typeof parsed !== 'object') return emptyState();
      parsed.awards = parsed.awards && typeof parsed.awards === 'object' ? parsed.awards : {};
      parsed.history = Array.isArray(parsed.history) ? parsed.history : [];
      return Object.assign(emptyState(), parsed);
    } catch (e) { return emptyState(); }
  }
  function writeState(state, testMode) {
    try { localStorage.setItem(storeKey(testMode), JSON.stringify(state)); return true; } catch (e) { return false; }
  }
  function coreTotal() {
    let total = 0;
    try { total = Math.max(total, Number(root.VISION && VISION.core && VISION.core.getXp().totalXp) || 0); } catch (e) {}
    try { total = Math.max(total, Number(root.__demoPoints) || 0); } catch (e) {}
    return Math.max(0, Math.round(total));
  }
  function currentTotal(testMode) {
    const state = readState(testMode);
    return Math.max(0, Number(state.currentTotal) || 0, testMode ? 0 : coreTotal());
  }
  function rankInfo(total) {
    total = Math.max(0, Math.round(Number(total) || 0));
    try {
      if (root.VISION && VISION.core && typeof VISION.core.rankForXp === 'function') {
        const live = VISION.core.rankForXp(total);
        return { index:live.index, name:live.name, next:live.next, xpToNext:live.xpToNext, pct:live.pct, atMax:live.atMax };
      }
    } catch (e) {}
    let index = 0;
    FALLBACK_THRESHOLDS.forEach(function (threshold, candidate) { if (total >= threshold) index = candidate; });
    const atMax = index >= FALLBACK_RANKS.length - 1;
    const nextIndex = Math.min(index + 1, FALLBACK_RANKS.length - 1);
    const floor = FALLBACK_THRESHOLDS[index], ceiling = FALLBACK_THRESHOLDS[nextIndex];
    return {
      index:index, name:FALLBACK_RANKS[index], next:FALLBACK_RANKS[nextIndex], atMax:atMax,
      xpToNext:atMax ? 0 : Math.max(0, ceiling - total),
      pct:atMax ? 100 : Math.round(((total - floor) / Math.max(1, ceiling - floor)) * 100)
    };
  }
  function awardKey(taskId, attemptId) { return String(taskId || '') + '::' + String(attemptId || ''); }
  function capturePrevious(attemptId, taskId, testMode) {
    if (!attemptId || !taskId) return null;
    const snapshot = { previousTotal:currentTotal(testMode), capturedAt:new Date().toISOString(), testMode:!!testMode };
    captures.set(awardKey(taskId, attemptId), snapshot);
    captures.set(String(taskId) + '::latest', snapshot);
    return snapshot;
  }
  function concise(value, fallback, limit) {
    const text = String(value || fallback || '').replace(/\s+/g, ' ').trim();
    return text.length > (limit || 160) ? text.slice(0, (limit || 160) - 1).trim() + '…' : text;
  }
  function evidenceStrength(model) {
    const passed = model && Array.isArray(model.criteria) ? model.criteria.find(function (item) { return item.state === 'passed'; }) : null;
    return concise(passed && (passed.detail || passed.label), 'the completed task evidence', 110);
  }
  function evidenceWeakness(model) {
    const weak = model && Array.isArray(model.criteria) ? model.criteria.find(function (item) { return item.state !== 'passed'; }) : null;
    return concise(weak && (weak.detail || weak.label), 'the next locked Standard criterion', 110);
  }
  function analystCopy(event, model) {
    if (event.rankUnlocked) return 'Your verified execution in ' + event.taskTitle + ' crossed the ' + event.newRank + ' threshold. The points came from ' + evidenceStrength(model) + '.';
    if (!event.nextRankDistance) return 'You earned ' + event.pointsEarned + ' points from ' + evidenceStrength(model) + '. The next mission should strengthen ' + evidenceWeakness(model) + '.';
    return 'You earned ' + event.pointsEarned + ' points from ' + evidenceStrength(model) + '. You are now ' + event.nextRankDistance + ' points from ' + event.nextRank + '.';
  }
  function displayEvent(payload) {
    payload = payload || {};
    const points = Math.max(0, Math.round(Number(payload.pointsEarned) || 0));
    const testMode = payload.testMode === true;
    const observedTotal = currentTotal(testMode);
    const requestedPrevious = Number(payload.previousTotal);
    const requestedNew = Number(payload.newTotal);
    const previousTotal = Number.isFinite(requestedPrevious) ? Math.max(0, Math.round(requestedPrevious)) : Math.max(0, observedTotal - points);
    const newTotal = Number.isFinite(requestedNew) ? Math.max(previousTotal, Math.round(requestedNew)) : observedTotal;
    const before = rankInfo(previousTotal), after = rankInfo(newTotal);
    const basePoints = Math.max(0, Math.round(Number(payload.basePoints) || 0));
    const strengthModifier = Math.round(Number(payload.proofStrengthModifier) || 0);
    const event = {
      id:awardKey(payload.taskId, payload.attemptId), taskId:String(payload.taskId || ''), taskTitle:concise(payload.taskTitle, 'Completed task', 180),
      attemptId:String(payload.attemptId || ''), previousPoints:previousTotal, pointsEarned:points, newTotal:newTotal,
      previousRank:before.name, newRank:after.name, nextRank:after.next,
      rankUnlocked:after.index > before.index, nextRankDistance:after.xpToNext, progressPct:after.pct,
      executionScore:Math.max(0, Math.round(Number(payload.executionScore) || 0)),
      verificationConfidence:String(payload.verificationConfidence || ''), timestamp:new Date().toISOString(), revealViewed:true,
      proofTier:Number(payload.proofTier) || null, proofTierLabel:String(payload.proofTierLabel || ''),
      basePoints:basePoints || null,
      maxPotential:basePoints ? Math.max(basePoints + Math.max(0, strengthModifier), points) : null,
      pointsReason:String(payload.pointsReason || '')
    };
    if (!event.pointsReason) event.pointsReason = event.executionScore >= 85 ? 'Strong execution against the locked Standard' : event.executionScore >= 70 ? 'Solid execution against the locked Standard' : 'Verified execution against the locked Standard';
    event.analystExplanation = analystCopy(event, payload.model || {});
    return event;
  }
  function persistRankCache(event) {
    try {
      localStorage.setItem('vision_rank_state', JSON.stringify({ rankScore:event.newTotal, currentRank:event.newRank, previousRank:event.previousRank, nextRank:event.nextRank, pointsToNext:event.nextRankDistance, updatedAt:event.timestamp }));
    } catch (e) {}
  }
  function updateRankEverywhere(event) {
    try {
      document.documentElement.dataset.visionRank = event.newRank;
      document.querySelectorAll('[data-vision-rank-name]').forEach(function (el) { el.textContent = event.newRank; });
      document.querySelectorAll('[data-vision-rank-points]').forEach(function (el) { el.textContent = String(event.newTotal); });
      const name = document.getElementById('vrName'), score = document.getElementById('vrScore');
      if (name) name.textContent = event.newRank;
      if (score) score.textContent = String(event.newTotal);
      root.dispatchEvent(new CustomEvent('vision:rank-updated', { detail:event }));
    } catch (e) {}
  }
  function applyAward(payload) {
    payload = payload || {};
    const points = Math.max(0, Math.round(Number(payload.pointsEarned) || 0));
    const taskId = String(payload.taskId || ''), attemptId = String(payload.attemptId || ''), testMode = payload.testMode === true;
    if (!taskId || !attemptId || !points || payload.accepted !== true || payload.finalPoints !== true || payload.preview === true) return { applied:false, reason:'ineligible' };
    const key = awardKey(taskId, attemptId), state = readState(testMode);
    if (state.awards[key]) return { applied:false, duplicate:true, event:state.awards[key] };
    const captured = captures.get(key) || captures.get(taskId + '::latest');
    const observed = currentTotal(testMode), requestedPrevious = Number(payload.previousTotal);
    let previousTotal = Number.isFinite(requestedPrevious) ? Math.max(0, Math.round(requestedPrevious)) : captured ? captured.previousTotal : observed;
    if (state.currentTotal != null) previousTotal = Math.max(previousTotal, Number(state.currentTotal) || 0);
    const requestedNew = Number(payload.newTotal);
    const newTotal = Number.isFinite(requestedNew) ? Math.max(previousTotal, Math.round(requestedNew)) : previousTotal + points;
    const before = rankInfo(previousTotal), after = rankInfo(newTotal), timestamp = new Date().toISOString();
    const basePoints = Math.max(0, Math.round(Number(payload.basePoints) || 0));
    const strengthModifier = Math.round(Number(payload.proofStrengthModifier) || 0);
    const event = {
      id:key, taskId:taskId, taskTitle:concise(payload.taskTitle, 'Completed task', 180), attemptId:attemptId,
      previousPoints:previousTotal, pointsEarned:points, newTotal:newTotal,
      previousRank:before.name, newRank:after.name, nextRank:after.next,
      rankUnlocked:after.index > before.index, nextRankDistance:after.xpToNext, progressPct:after.pct,
      executionScore:Math.max(0, Math.round(Number(payload.executionScore) || 0)),
      verificationConfidence:String(payload.verificationConfidence || ''), timestamp:timestamp, revealViewed:false,
      proofTier:Number(payload.proofTier) || null, proofTierLabel:String(payload.proofTierLabel || ''),
      basePoints:basePoints || null,
      maxPotential:basePoints ? Math.max(basePoints + Math.max(0, strengthModifier), points) : null,
      pointsReason:String(payload.pointsReason || '')
    };
    if (!event.pointsReason) event.pointsReason = event.executionScore >= 85 ? 'Strong execution against the locked Standard' : event.executionScore >= 70 ? 'Solid execution against the locked Standard' : 'Verified execution against the locked Standard';
    event.analystExplanation = analystCopy(event, payload.model || {});
    state.currentTotal = newTotal;
    state.awards[key] = event;
    state.history.push(event);
    if (state.history.length > 100) state.history = state.history.slice(-100);
    writeState(state, testMode);
    captures.delete(key); captures.delete(taskId + '::latest');
    if (!testMode) {
      persistRankCache(event); updateRankEverywhere(event);
      try { if (VisionTasks.verification && VisionTasks.verification.attachRankEvent) VisionTasks.verification.attachRankEvent(taskId, event); } catch (e) {}
    }
    return { applied:true, event:event };
  }
  function markViewed(event, testMode) {
    const state = readState(testMode), stored = state.awards[event.id];
    if (!stored || stored.revealViewed) return;
    stored.revealViewed = true; stored.revealViewedAt = new Date().toISOString();
    state.awards[event.id] = stored;
    const index = state.history.findIndex(function (item) { return item.id === event.id; });
    if (index >= 0) state.history[index] = stored;
    writeState(state, testMode);
  }
  function present(event, options) {
    if (!event) return false;
    markViewed(event, options && options.testMode === true);
    if (VisionTasks.verification && typeof VisionTasks.verification.presentRankEvent === 'function') {
      return VisionTasks.verification.presentRankEvent(event, options || {});
    }
    return false;
  }
  function hide() {
    try { if (VisionTasks.resultScreen && typeof VisionTasks.resultScreen.hide === 'function') VisionTasks.resultScreen.hide(); } catch (e) {}
  }
  function fromVerification(payload) {
    payload = payload || {};
    const applied = applyAward(payload);
    if (!applied.event) applied.event = displayEvent(payload);
    return applied;
  }
  function inspect(testMode) { return JSON.parse(JSON.stringify(readState(testMode === true))); }
  function resetTestState() { try { localStorage.removeItem(storeKey(true)); } catch (e) {} return inspect(true); }

  VisionTasks.rankReveal = {
    capturePrevious:capturePrevious,
    currentTotal:currentTotal,
    rankInfo:rankInfo,
    displayEvent:displayEvent,
    applyAward:applyAward,
    fromVerification:fromVerification,
    present:present,
    hide:hide,
    inspect:inspect,
    history:function (testMode) { return inspect(testMode).history; },
    resetTestState:resetTestState
  };
})(window);
