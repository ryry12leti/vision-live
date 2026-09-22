/* VISION Tasks · Proof Verified
   A single normalized result object drives the immediate result and the
   expanded four-section intelligence review. Awarding remains authoritative
   in rank-reveal.js; this module is presentation-only. */
(function (root) {
  'use strict';

  const VisionTasks = root.VisionTasks = root.VisionTasks || {};
  let activeResult = null;
  let recordOnly = false;
  let terminalActionTaken = false;
  let reviewTrigger = null;
  let keyHandler = null;
  let pointsAnimationToken = 0;

  function $(id) { return document.getElementById(id); }
  function setText(id, value) { const el = $(id); if (el) el.textContent = value == null ? '' : String(value); }
  function setHidden(id, hidden) { const el = $(id); if (el) el.hidden = !!hidden; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
  function numberOr(value, fallback) { if (value === null || value === undefined || value === '') return fallback; const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function concise(value, limit) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > (limit || 220) ? text.slice(0, (limit || 220) - 1).trim() + '…' : text;
  }
  function first(source, keys, fallback) {
    for (const key of keys) if (source && source[key] !== undefined && source[key] !== null && source[key] !== '') return source[key];
    return fallback;
  }
  function sentence(value) {
    const text = concise(value, 240);
    return text && !/[.!?]$/.test(text) ? text + '.' : text;
  }
  function verificationTime(value) {
    const date = value ? new Date(value) : new Date();
    if (!Number.isFinite(date.getTime())) return 'Verified just now';
    try {
      const today = new Date();
      const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
      const time = new Intl.DateTimeFormat(undefined, { hour:'numeric', minute:'2-digit' }).format(date);
      if (sameDay) return 'Verified today at ' + time;
      return 'Verified ' + new Intl.DateTimeFormat(undefined, { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' }).format(date);
    } catch (e) { return 'Verified'; }
  }
  function lowerFirst(value) {
    const text = concise(value, 190);
    return text ? text.charAt(0).toLowerCase() + text.slice(1) : '';
  }
  function completedAction(value) {
    return lowerFirst(value).replace(/^complete\b/i, 'completed').replace(/^perform\b/i, 'performed').replace(/^finish\b/i, 'finished');
  }
  function reducedMotion(options) {
    if (options && options.reducedMotion === true) return true;
    try { if (D && D.forceReducedMotionPreview === true) return true; } catch (e) {}
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  function syncChrome() {
    try { if (typeof root.__visionSyncCineChrome === 'function') { root.__visionSyncCineChrome(); return; } } catch (e) {}
    try { document.documentElement.classList.toggle('vision-cine-active', !!document.querySelector('.td-cine.show')); } catch (e) {}
  }

  const CRITERION_LABELS = {
    passed: 'Passed', partial: 'Partially passed', missed: 'Missed', not_verifiable: 'Not verifiable'
  };
  function criterionState(value) {
    const state = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (/not_?verif|unverif|unknown|unassess/.test(state)) return 'not_verifiable';
    if (/partial/.test(state)) return 'partial';
    if (/miss|fail|not_?demonstrated|not_?met|below/.test(state)) return 'missed';
    return 'passed';
  }
  function normalizeCriteria(model, record) {
    const source = Array.isArray(model.criteria) && model.criteria.length ? model.criteria
      : Array.isArray(record && record.criteriaResults) ? record.criteriaResults : [];
    const criteria = source.slice(0, 8).map(function (item, index) {
      const object = item && typeof item === 'object' ? item : { label:item, detail:item };
      const state = criterionState(object.state || object.status);
      return {
        label:concise(object.label || object.name || object.criterion || ('Standard criterion ' + (index + 1)), 90),
        detail:concise(object.explanation || object.detail || object.description || object.reason || object.label || 'Assessed against the locked Standard.', 210),
        state:state,
        stateLabel:CRITERION_LABELS[state]
      };
    });
    if (criteria.length) return criteria;
    const execution = numberOr(model.execution, numberOr(record && record.executionScore, 0));
    return [{
      label:'Locked Standard assessment',
      detail:concise(model.analyst || (record && record.analystFeedback) || 'The submitted execution was assessed against the Standard locked at task start.', 210),
      state:execution >= 70 ? 'passed' : 'partial',
      stateLabel:execution >= 70 ? CRITERION_LABELS.passed : CRITERION_LABELS.partial
    }];
  }

  function normalizeAward(raw, kind) {
    const object = raw && raw[kind];
    if (object && typeof object === 'object') {
      const title = object.title || object.name || object.label;
      return title ? { title:concise(title, 72) } : null;
    }
    const earned = raw && (raw[kind + 'Earned'] === true || raw[kind + '_earned'] === true);
    const title = first(raw, [kind + 'Title', kind + '_title'], typeof object === 'string' ? object : '');
    return earned && title ? { title:concise(title, 72) } : null;
  }

  const IMPACT_LABELS = {
    accelerated:'Trajectory accelerated',
    protected:'Target protected',
    unchanged:'Trajectory unchanged',
    slightly_delayed:'Slightly behind target',
    materially_delayed:'Trajectory delayed'
  };
  function impactKey(value) {
    const key = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
    if (IMPACT_LABELS[key]) return key;
    if (/recover|required|delay|behind/.test(key)) return /material|recover|required/.test(key) ? 'materially_delayed' : 'slightly_delayed';
    if (/protect|on_track|on_target/.test(key)) return 'protected';
    if (/acceler|ahead/.test(key)) return 'accelerated';
    if (/unchang|stable|neutral/.test(key)) return 'unchanged';
    return '';
  }
  function dateValue(value) {
    const text = String(value || '').trim();
    if (!text) return NaN;
    const parts = text.split(/\s*[–—]\s*|\s+-\s+/).filter(Boolean);
    const parsed = Date.parse(parts[parts.length - 1]);
    return Number.isFinite(parsed) ? parsed : NaN;
  }
  function normalizeTrajectory(raw, primaryImprovement) {
    const embedded = raw && raw.trajectory && typeof raw.trajectory === 'object' ? raw.trajectory : {};
    if (embedded.measurable === false || (raw && raw.goalMeasurable === false)) return null;
    const target = concise(first(raw, ['desiredTargetDate','desired_target_date'], first(embedded, ['target','desiredTarget','desiredTargetDate'], '')), 60);
    const projection = concise(first(raw, ['projectedCompletionRange','projected_completion_range'], first(embedded, ['estimate','estimatedAchievement','projection','projectedCompletionRange'], '')), 70);
    const previousProjection = concise(first(raw, ['previousProjectedCompletionRange','previous_projected_completion_range'], first(embedded, ['previousProjection','previousProjectedDate','previous_projected_date'], '')), 70);
    const confidence = concise(first(raw, ['trajectoryConfidence','trajectory_confidence'], embedded.confidence || ''), 40);
    if (!target || !projection || !confidence) return null;

    let impact = impactKey(first(raw, ['trajectoryImpact','trajectory_impact'], embedded.impact || ''));
    const deadline = dateValue(first(embedded, ['acceptedTargetEnd','accepted_target_end'], target));
    const projectedEnd = dateValue(first(embedded, ['projectionEnd','projection_end'], projection));
    if (Number.isFinite(deadline) && Number.isFinite(projectedEnd)) {
      if (projectedEnd > deadline && !['slightly_delayed','materially_delayed'].includes(impact)) impact = 'slightly_delayed';
      if (projectedEnd <= deadline && ['slightly_delayed','materially_delayed'].includes(impact)) impact = 'protected';
      if (!impact) impact = projectedEnd <= deadline ? 'protected' : 'slightly_delayed';
    }
    if (!impact) return null;
    const slipped = impact === 'slightly_delayed' || impact === 'materially_delayed';
    let recovery = concise(first(raw, ['recoveryAction','recovery_action'], embedded.recovery || embedded.recoveryAction || ''), 190);
    if (slipped && !recovery) {
      recovery = primaryImprovement
        ? 'Recovery action: make the missing requirement directly verifiable in the next locked mission — ' + sentence(primaryImprovement)
        : 'Recovery action: complete the next locked mission at the required Standard to begin restoring the projected range.';
    }
    let proofImpact = concise(first(raw, ['trajectoryProofImpact','trajectory_proof_impact'], embedded.proofImpact || embedded.proof_impact || ''), 180);
    if (!proofImpact) {
      if (impact === 'accelerated') proofImpact = previousProjection && previousProjection !== projection
        ? 'This proof nudged the rolling projection earlier, from ' + previousProjection + ' to ' + projection + '.'
        : 'This proof nudged the rolling projection slightly earlier.';
      else if (slipped) proofImpact = previousProjection && previousProjection !== projection
        ? 'This proof nudged the rolling projection later, from ' + previousProjection + ' to ' + projection + '.'
        : 'This proof added a small delay to the rolling projection.';
      else if (impact === 'protected') proofImpact = 'This proof protected the current projection; your desired target did not change.';
      else proofImpact = 'This proof did not materially change the rolling projection.';
    }
    return { target, projection, previousProjection, impact, impactLabel:IMPACT_LABELS[impact], confidence, proofImpact:sentence(proofImpact), recovery:slipped ? recovery : '' };
  }

  function previewSource() {
    try {
      const image = $('tdPreview'), video = $('tdVideoPreview');
      if (image && image.style.display !== 'none' && image.getAttribute('src')) return { kind:'image', src:image.getAttribute('src') };
      if (video && video.style.display !== 'none' && video.getAttribute('src')) return { kind:'video', src:video.getAttribute('src') };
    } catch (e) {}
    return null;
  }
  function evidenceKind(item) {
    const type = String(item && (item.kind || item.type || item.mimeType || item.mime_type) || '').toLowerCase();
    if (/image|photo|screenshot/.test(type)) return 'image';
    if (/video|camera|screen/.test(type)) return 'video';
    if (/audio|voice/.test(type)) return 'audio';
    if (/gps|location|route/.test(type)) return 'gps';
    if (/text|written|reflection/.test(type)) return 'text';
    return 'proof';
  }
  function evidenceLabel(kind, index, rawItem) {
    const explicit = rawItem && (rawItem.label || rawItem.title || rawItem.displayName || rawItem.display_name);
    if (explicit) return concise(explicit, 80);
    const labels = { image:'Image proof', video:'Video proof', audio:'Voice proof', gps:'GPS proof', text:'Written proof', proof:'Submitted proof' };
    return (labels[kind] || labels.proof) + (index > 0 ? ' ' + (index + 1) : '');
  }
  function normalizeEvidence(raw, model, record, criteria, primaryImprovement) {
    const supplied = first(raw, ['evidenceItems','evidence_items'], null);
    const metadata = Array.isArray(supplied) && supplied.length ? supplied
      : Array.isArray(model.evidenceMetadata) && model.evidenceMetadata.length ? model.evidenceMetadata
      : Array.isArray(record && record.submittedEvidenceMetadata) ? record.submittedEvidenceMetadata : [];
    const passed = criteria.find(function (item) { return item.state === 'passed'; });
    const weak = criteria.find(function (item) { return item.state !== 'passed'; });
    const observed = Array.isArray(model.observed) ? model.observed : [];
    const preview = previewSource();
    const source = metadata.length ? metadata : [{}];
    return source.slice(0, 6).map(function (item, index) {
      const object = item && typeof item === 'object' ? item : { excerpt:item };
      const kind = evidenceKind(object);
      const proved = concise(first(object, ['proved','whatProved','what_proved'], observed[index] || (passed && (passed.detail || passed.label)) || 'The evidence was relevant to the completed task and could be assessed against the locked Standard.'), 190);
      const limitation = concise(first(object, ['limitation','couldNotProve','could_not_prove','whatCouldNotProve'], weak ? (weak.detail || weak.label) : primaryImprovement || 'No material verification gap was identified in this evidence.'), 190);
      const confidence = concise(first(object, ['confidence','verificationConfidence','verification_confidence'], model.confidence && model.confidence.label || record && record.verificationConfidence || 'Not stated'), 50);
      const ownPreview = first(object, ['previewUrl','preview_url','src','url'], '');
      return {
        label:evidenceLabel(kind, index, object), kind,
        preview:ownPreview ? { kind:kind === 'video' ? 'video' : 'image', src:String(ownPreview) } : index === 0 ? preview : null,
        excerpt:concise(first(object, ['excerpt','text','summary'], ''), 240), proved, limitation, confidence
      };
    });
  }

  function normalizeRetry(raw, executionScore, pointsEarned, maxPoints, primaryImprovement) {
    const retry = raw && raw.retry && typeof raw.retry === 'object' ? raw.retry : {};
    const explicitlyRecommended = retry.recommended === true || retry.show === true || (raw && raw.retryRecommended === true);
    const allowed = retry.allowed !== false && !(raw && raw.retryAllowed === false);
    let recoverable = numberOr(first(raw, ['recoverablePoints','recoverable_points'], first(retry, ['recoverablePoints','recoverable_points'], NaN)), NaN);
    if (!Number.isFinite(recoverable) && Number.isFinite(maxPoints) && maxPoints > pointsEarned) recoverable = Math.round(maxPoints - pointsEarned);
    const tinyGain = Number.isFinite(recoverable) && recoverable < 4;
    // With no server execution score we cannot claim the attempt fell short,
    // so a retry is only ever offered when the server explicitly recommends one.
    const scored = Number.isFinite(Number(executionScore));
    const recommended = allowed && explicitlyRecommended && !!primaryImprovement && scored && executionScore < 90 && !tinyGain;
    const estimatedTime = concise(first(raw, ['estimatedRetryTime','estimated_retry_time'], first(retry, ['estimatedTime','estimated_retry_time'], '')), 50);
    let context = '';
    if (recommended && estimatedTime) context = 'Estimated retry time: ' + estimatedTime;
    else if (recommended && Number.isFinite(recoverable) && recoverable > 0) context = 'Improving the missing evidence could recover up to ' + recoverable + ' points.';
    return {
      show:recommended,
      primary:recommended && (retry.primary === true || (raw && raw.retryPrimary === true)) && scored && executionScore < 75,
      label:concise(retry.label || 'Improve This Proof', 40),
      context:context,
      recoverablePoints:Number.isFinite(recoverable) ? recoverable : null,
      estimatedTime:estimatedTime
    };
  }

  function buildResult(event, model, raw, record) {
    event = event || {};
    model = model || {};
    raw = raw || {};
    record = record || null;
    const criteriaResults = normalizeCriteria(model, record);
    const passed = criteriaResults.find(function (item) { return item.state === 'passed'; });
    const weak = criteriaResults.find(function (item) { return item.state !== 'passed'; });
    const taskTitle = concise(event.taskTitle || record && record.taskTitle || (function () { try { return D.task && D.task.title; } catch (e) { return ''; } })() || 'Completed task', 180);
    // The server currently returns an award decision (`awarded`) but no execution
    // score — there is no execution_score/point_ceiling anywhere in the proof RPCs
    // or Edge Functions. When no real score is supplied we keep it null and hide
    // every dependent claim rather than inventing a number the server never made.
    const rawExecution = first(raw, ['executionScore','execution_score'], first(model, ['execution'], record && record.executionScore));
    // Guard explicitly against null/undefined/'': Number(null) is 0, which would
    // silently render a fabricated 0/100 score the server never reported.
    const executionScore = (rawExecution !== null && rawExecution !== undefined && rawExecution !== '' && Number.isFinite(Number(rawExecution)))
      ? Math.round(clamp(rawExecution, 0, 100))
      : null;
    const hasExecutionScore = executionScore !== null;
    const pointsEarned = Math.max(0, Math.round(numberOr(event.pointsEarned, numberOr(first(raw, ['pointsEarned','points_earned','awarded'], first(model, ['awarded'], record && record.finalPoints)), 0))));
    let maxPoints = numberOr(first(raw, ['maximumAvailablePoints','maximum_available_points','pointCeiling'], first(model, ['maxPotential'], record && record.baseTaskPoints)), NaN);
    if (Number.isFinite(maxPoints)) maxPoints = Math.max(pointsEarned, Math.round(maxPoints));

    const suppliedReview = concise(first(raw, ['proofReviewSummary','proof_review_summary'], ''), 340);
    const suppliedImprovement = concise(first(raw, ['primaryImprovement','primary_improvement','keyLesson','key_lesson'], ''), 190);
    const benchmarkImprovement = hasExecutionScore && executionScore < 90 && model.standard ? concise(model.standard.benchmark || model.standard.level || '', 190) : '';
    const primaryImprovement = suppliedImprovement || (weak ? concise(weak.detail || weak.label, 190) : benchmarkImprovement);
    const passSentence = sentence(first(raw, ['passedSummary','passed_summary'], passed ? 'The evidence verified that you ' + completedAction(passed.detail || passed.label).replace(/^you\s+/i, '') : 'The submitted proof verified the completed task against the locked Standard'));
    const weaknessSentence = weak ? sentence(first(raw, ['weaknessSummary','weakness_summary'], 'Most importantly, ' + lowerFirst(weak.detail || weak.label))) : primaryImprovement ? sentence('The main quality gap was ' + lowerFirst(primaryImprovement)) : 'No material weakness was identified in the verified evidence.';
    const lessonSource = suppliedReview || primaryImprovement || weaknessSentence || passSentence;
    const proofReviewSummary = sentence(concise(String(lessonSource).split(/[.!?]\s+/)[0], 200));
    const trajectory = normalizeTrajectory(raw, primaryImprovement);
    const retry = normalizeRetry(raw, executionScore, pointsEarned, maxPoints, primaryImprovement);
    const evidenceItems = normalizeEvidence(raw, model, record, criteriaResults, primaryImprovement);

    const withheld = Number.isFinite(maxPoints) ? Math.max(0, maxPoints - pointsEarned) : null;
    let pointsNarrative = concise(first(raw, ['pointsNarrative','points_narrative'], raw.pointsExplanation && raw.pointsExplanation.narrative), 300);
    if (!pointsNarrative && Number.isFinite(maxPoints)) {
      pointsNarrative = withheld > 0
        ? primaryImprovement
          ? 'Your selected proof method allowed up to ' + maxPoints + ' points. ' + withheld + ' points were withheld because ' + lowerFirst(primaryImprovement) + '.'
          : hasExecutionScore
            ? 'Your selected proof method allowed up to ' + maxPoints + ' points. The ' + executionScore + '/100 execution score converted that ceiling into a final award of ' + pointsEarned + ' points.'
            : 'Your selected proof method allowed up to ' + maxPoints + ' points. The server awarded ' + pointsEarned + ' points for the verified execution.'
        : 'Your selected proof method allowed up to ' + maxPoints + ' points. The verified execution earned the full available award.';
    }
    if (!pointsNarrative) pointsNarrative = 'The final award reflects only the execution that could be verified against the locked Standard.';

    const explicitAdaptation = concise(first(raw, ['nextSystemAdaptation','next_system_adaptation','tomorrowAdaptation','tomorrow_adaptation'], ''), 280);
    const nextSystemAdaptation = concise(explicitAdaptation || (primaryImprovement
      ? 'The next mission will target the same gap while preserving your goal: ' + sentence(primaryImprovement)
      : 'VISION will preserve this locked Standard and continue with the next mission.'), 280);
    const adaptationMeaningful = first(raw, ['tomorrowAdapted','tomorrow_adapted'], null) === true || !!explicitAdaptation || (!!primaryImprovement && hasExecutionScore && executionScore < 90);
    const nextEvidence = concise(first(raw, ['nextEvidenceRequirement','next_evidence_requirement'], primaryImprovement ? 'Make the missing requirement directly visible: ' + sentence(primaryImprovement) : ''), 180);
    const rankChanged = event.rankUnlocked === true || event.rankChanged === true;
    const currentRank = concise(event.newRank || event.currentRank || '', 50);
    const previousRank = rankChanged ? concise(event.previousRank || '', 50) : '';
    const pointsToNextRank = Math.max(0, Math.round(numberOr(event.nextRankDistance, numberOr(event.pointsToNextRank, 0))));
    const rankExplanation = rankChanged ? concise(first(raw, ['rankExplanation','rank_explanation'],
      'This verified proof moved your total from ' + Math.max(0, Math.round(numberOr(event.previousPoints, 0))) + ' to ' + Math.max(0, Math.round(numberOr(event.newTotal, pointsEarned))) + ' points, crossing the ' + currentRank + ' threshold.'), 210) : '';

    return {
      verificationStatus:'verified', taskTitle, executionScore, pointsEarned,
      currentRank, previousRank, nextRank:concise(event.nextRank || '', 50),
      pointsToNextRank, rankChanged, rankProgress:Math.round(clamp(event.progressPct, 0, 100)), rankExplanation,
      milestone:normalizeAward(raw, 'milestone'), badge:normalizeAward(raw, 'badge'),
      proofReviewSummary, primaryImprovement, trajectory, retry,
      criteriaResults, evidenceItems,
      pointsExplanation:{ maximumAvailable:Number.isFinite(maxPoints) ? maxPoints : null, executionScore, finalPoints:pointsEarned, narrative:pointsNarrative },
      nextSystemAdaptation, nextEvidence,
      tomorrowAdaptation:{ show:adaptationMeaningful, text:nextSystemAdaptation, appliedLabel:'Applied to tomorrow’s mission' },
      verifiedAt:first(raw, ['verifiedAt','verified_at','completedAt','completed_at'], event.timestamp || record && record.completionDateTime || new Date().toISOString()),
      ownerPreview:(raw.ownerTest === true || raw.ownerPreview === true) && raw.ownerPreviewHidden !== true,
      mobilePreview:raw.ownerMobilePreview === true,
      verificationConfidence:concise(model.confidence && model.confidence.label || record && record.verificationConfidence || '', 50),
      sourceRecord:record
    };
  }

  function resultFromRecord(record) {
    record = record || {};
    const attempt = Array.isArray(record.verificationAttempts) && record.verificationAttempts.length ? record.verificationAttempts[record.verificationAttempts.length - 1] : {};
    const event = record.latestRankEvent || {
      taskTitle:record.taskTitle, pointsEarned:record.finalPoints, newRank:'', previousRank:'', nextRank:'', nextRankDistance:0, progressPct:0, rankUnlocked:false
    };
    const model = {
      criteria:record.criteriaResults || attempt.criteriaResults || [],
      evidenceMetadata:record.submittedEvidenceMetadata || attempt.evidenceMetadata || [],
      confidence:{ label:record.verificationConfidence || attempt.verificationConfidence || '' },
      execution:record.executionScore, awarded:record.finalPoints,
      maxPotential:record.baseTaskPoints, analyst:record.analystFeedback,
      observed:(record.passedCriteria || []).map(function (item) { return item.detail || item.label || item; })
    };
    const raw = record.resultExperience || {};
    return buildResult(event, model, raw, record);
  }

  function renderPoints(result, isStatic) {
    const el = $('tdrPoints'), target = result.pointsEarned;
    const token = ++pointsAnimationToken;
    // No server execution score -> show nothing rather than "null/100".
    if (result.executionScore === null) {
      setText('tdrScore', '');
      setHidden('tdrScore', true);
    } else {
      setText('tdrScore', result.executionScore + '/100');
      setHidden('tdrScore', false);
    }
    if (!el) return;
    if (isStatic) { el.textContent = '+' + target; return; }
    const start = performance.now(), duration = 520;
    el.textContent = '+0';
    function frame(now) {
      if (token !== pointsAnimationToken) return;
      const progress = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - progress, 3);
      const host = $('tdResult');
      el.textContent = '+' + Math.round(target * eased);
      if (progress < 1 && host && host.classList.contains('show')) requestAnimationFrame(frame);
      else el.textContent = '+' + target;
    }
    requestAnimationFrame(frame);
  }

  function renderRank(result) {
    const host = $('tdResult'), track = $('tdrRankTrack');
    setText('tdrRankK', result.rankChanged ? 'Rank reveal' : 'Current rank');
    setText('tdrRankPrev', result.rankChanged ? result.previousRank : '');
    setText('tdrRankNow', result.currentRank || 'Rank unavailable');
    const distance = $('tdrRankDist');
    if (distance) {
      distance.textContent = '';
      if (result.nextRank && result.pointsToNextRank > 0) {
        const strong = document.createElement('b'); strong.textContent = String(result.pointsToNextRank);
        distance.append(strong, document.createTextNode(' points until ' + result.nextRank));
      } else distance.textContent = result.nextRank ? 'Progress applied' : 'Highest configured rank reached';
    }
    setText('tdrRankReason', result.rankExplanation);
    setHidden('tdrRankReason', !result.rankChanged || !result.rankExplanation);
    if (host) host.style.setProperty('--tdr-rank-progress', result.rankProgress + '%');
    if (track) {
      track.setAttribute('aria-valuenow', String(result.rankProgress));
      track.setAttribute('aria-label', result.nextRank ? result.rankProgress + '% progress toward ' + result.nextRank : 'Highest configured rank reached');
    }
  }

  function renderAwards(result) {
    setText('tdrMilestoneTitle', result.milestone && result.milestone.title);
    setText('tdrBadgeTitle', result.badge && result.badge.title);
    setHidden('tdrMilestone', !result.milestone);
    setHidden('tdrBadge', !result.badge);
    setHidden('tdrAwards', !result.milestone && !result.badge);
  }

  function renderTrajectory(result) {
    const trajectory = result.trajectory, host = $('tdrTraj'), shell = $('tdrShell');
    if (!trajectory) {
      if (host) host.hidden = true;
      if (shell) shell.classList.remove('has-trajectory');
      return;
    }
    setText('tdrTrajTarget', trajectory.target);
    setText('tdrTrajEst', trajectory.projection);
    setText('tdrTrajPrevious', trajectory.previousProjection);
    setText('tdrTrajImpact', trajectory.impactLabel);
    setText('tdrTrajConfidence', trajectory.confidence);
    setText('tdrTrajProofImpact', trajectory.proofImpact);
    setText('tdrTrajRecovery', trajectory.recovery);
    setHidden('tdrTrajPreviousWrap', !trajectory.previousProjection);
    setHidden('tdrTrajProofImpact', !trajectory.proofImpact);
    setHidden('tdrTrajRecovery', !trajectory.recovery);
    if (host) { host.hidden = false; host.dataset.impact = trajectory.impact; }
    if (shell) shell.classList.add('has-trajectory');
  }

  function renderTomorrow(result) {
    const adaptation = result.tomorrowAdaptation || {};
    setText('tdrTomorrowText', adaptation.text);
    setText('tdrTomorrowState', adaptation.appliedLabel || 'Applied to tomorrow’s mission');
    setHidden('tdrTomorrow', !adaptation.show);
    const shell = $('tdrShell');
    if (shell) shell.classList.toggle('has-adaptation', !!adaptation.show);
  }

  function renderSummary(result, isStatic) {
    setText('tdrTitle', 'Proof Verified');
    setText('tdrSub', 'Your execution was verified against today’s locked Professional Standard.');
    setText('tdrVerifiedAt', verificationTime(result.verifiedAt));
    renderPoints(result, isStatic);
    renderRank(result);
    renderAwards(result);
    setText('tdrReviewSummary', result.proofReviewSummary);
    setText('tdrImprovementText', result.primaryImprovement);
    /* The summary is deliberately the one concise lesson. The expanded report
       retains the underlying improvement detail without repeating it here. */
    setHidden('tdrImprovement', true);
    renderTrajectory(result);
    renderTomorrow(result);
    setText('tdrRetryContext', result.retry.context);
    setHidden('tdrRetryContext', !result.retry.context);
    const improve = $('tdrImprove');
    if (improve) { improve.hidden = !result.retry.show; improve.textContent = result.retry.label; }
    const host = $('tdResult');
    if (host) {
      host.classList.toggle('is-unlocked', result.rankChanged);
      host.classList.toggle('is-retry', result.retry.show);
      host.classList.toggle('is-static', isStatic);
      host.classList.toggle('is-owner-mobile', result.mobilePreview);
      host.dataset.rankChanged = String(result.rankChanged);
      host.dataset.pointsEarned = String(result.pointsEarned);
      host.dataset.executionScore = String(result.executionScore);
    }
    setHidden('tdrOwnerPreview', !result.ownerPreview);
  }

  function evidenceIcon(kind) {
    if (kind === 'gps') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2"/></svg>';
    if (kind === 'audio') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>';
    if (kind === 'video') return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2"/></svg>';
    if (kind === 'text') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4"/></svg>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 17 5-4 3 2 3-3 3 5"/></svg>';
  }
  function addEvidenceLine(host, label, value) {
    const p = document.createElement('p'), span = document.createElement('span'), b = document.createElement('b');
    span.textContent = label; b.textContent = value; p.append(span, b); host.appendChild(p);
  }
  function renderCriteria(result) {
    const host = $('tdrCriteria'); if (!host) return;
    host.textContent = '';
    result.criteriaResults.forEach(function (item) {
      const row = document.createElement('article'); row.className = 'tdr-criterion';
      const copy = document.createElement('div'); copy.className = 'tdr-criterion-copy';
      const title = document.createElement('b'); title.textContent = item.label;
      const detail = document.createElement('p'); detail.textContent = item.detail;
      const state = document.createElement('span'); state.className = 'tdr-state is-' + item.state.replace(/_/g, '-'); state.textContent = item.stateLabel;
      copy.append(title, detail); row.append(copy, state); host.appendChild(row);
    });
  }
  function renderEvidence(result) {
    const host = $('tdrEvidence'); if (!host) return;
    host.textContent = '';
    result.evidenceItems.forEach(function (item) {
      const row = document.createElement('article'); row.className = 'tdr-evidence-item';
      const media = document.createElement('div'); media.className = 'tdr-evidence-media';
      if (item.preview && item.preview.src) {
        const node = document.createElement(item.preview.kind === 'video' ? 'video' : 'img');
        node.src = item.preview.src;
        if (node.tagName === 'VIDEO') { node.controls = true; node.playsInline = true; node.preload = 'metadata'; }
        else node.alt = '';
        media.appendChild(node);
      } else media.innerHTML = evidenceIcon(item.kind);
      const copy = document.createElement('div'); copy.className = 'tdr-evidence-copy';
      const title = document.createElement('h4'); title.textContent = item.label;
      const lines = document.createElement('div'); lines.className = 'tdr-evidence-lines';
      if (item.excerpt) addEvidenceLine(lines, 'Submitted', '“' + item.excerpt + '”');
      addEvidenceLine(lines, 'What it proved', item.proved);
      addEvidenceLine(lines, 'Could not prove', item.limitation);
      const confidence = document.createElement('div'); confidence.className = 'tdr-evidence-confidence'; confidence.textContent = item.confidence;
      copy.append(title, lines, confidence); row.append(media, copy); host.appendChild(row);
    });
  }
  function renderOptionalNext(id, value) {
    const host = $(id); if (!host) return;
    host.hidden = !value;
    const target = host.querySelector('b'); if (target) target.textContent = value || '';
  }
  function renderReport(result) {
    setText('tdrReportTask', result.taskTitle);
    setText('tdrReportScore', result.executionScore === null ? 'Not scored' : result.executionScore);
    renderCriteria(result);
    renderEvidence(result);
    setText('tdrMaxPoints', result.pointsExplanation.maximumAvailable == null ? 'Not stated' : result.pointsExplanation.maximumAvailable + ' points');
    setText('tdrExecutionPercent', result.executionScore === null ? 'Not returned by the server' : result.executionScore + '%');
    setText('tdrFinalPoints', result.pointsEarned + ' points');
    setText('tdrPointsNarrative', result.pointsExplanation.narrative);
    setText('tdrNextAdaptation', result.nextSystemAdaptation);
    renderOptionalNext('tdrNextTrajectory', result.trajectory && result.trajectory.impactLabel);
    renderOptionalNext('tdrNextWeakness', result.primaryImprovement);
    renderOptionalNext('tdrNextEvidence', result.nextEvidence);
  }

  function focusElement(id) {
    const el = $(id);
    if (!el) return false;
    try { el.focus({ preventScroll:true }); } catch (e) { el.focus(); }
    return document.activeElement === el;
  }
  function openReview(fromRecord) {
    if (!activeResult) return false;
    recordOnly = fromRecord === true || recordOnly;
    reviewTrigger = document.activeElement;
    renderReport(activeResult);
    const host = $('tdResult'), shell = $('tdrShell'), report = $('tdrReport'), back = $('tdrBack');
    if (shell) shell.hidden = true;
    if (report) report.hidden = false;
    if (host) { host.classList.add('is-reviewing'); host.setAttribute('aria-label', 'Full proof review'); }
    if (back) {
      const label = recordOnly ? 'Close review' : 'Back to result';
      back.setAttribute('aria-label', label);
      const span = back.querySelector('span'); if (span) span.textContent = label;
    }
    const scroll = $('tdrReportScroll'); if (scroll) scroll.scrollTop = 0;
    focusElement('tdrReportTitle');
    return true;
  }
  function closeReview() {
    if (recordOnly) { moveOn(); return; }
    const host = $('tdResult'), shell = $('tdrShell'), report = $('tdrReport');
    if (report) report.hidden = true;
    if (shell) shell.hidden = false;
    if (host) { host.classList.remove('is-reviewing'); host.setAttribute('aria-label', 'Proof verification result'); }
    if (reviewTrigger && document.contains(reviewTrigger)) { try { reviewTrigger.focus({ preventScroll:true }); } catch (e) { reviewTrigger.focus(); } }
  }
  function verificationApi() { return VisionTasks.verification || {}; }
  function moveOn() {
    if (terminalActionTaken) return;
    terminalActionTaken = true;
    hide();
    const api = verificationApi();
    try {
      if (api.continueAfterVerificationResult) {
        Promise.resolve(api.continueAfterVerificationResult()).catch(function (error) {
          console.error('[VISION] Move On could not refresh the Tasks page', error);
        });
      }
    } catch (error) { console.error('[VISION] Move On could not refresh the Tasks page', error); }
  }
  function improve() {
    if (terminalActionTaken || !activeResult || !activeResult.retry.show) return;
    terminalActionTaken = true;
    hide();
    const api = verificationApi();
    try { if (api.resubmitProofAttempt) api.resubmitProofAttempt(); } catch (e) {}
  }
  function focusableWithin() {
    const host = $('tdResult'); if (!host) return [];
    const panel = host.classList.contains('is-reviewing') ? $('tdrReport') : $('tdrShell');
    return panel ? Array.from(panel.querySelectorAll('button:not([hidden]):not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(function (el) { return !el.hidden && el.offsetParent !== null; }) : [];
  }
  function wire() {
    const primary = $('tdrPrimary'), improveButton = $('tdrImprove'), review = $('tdrReview'), back = $('tdrBack'), reportClose = $('tdrReportClose');
    if (primary) primary.onclick = moveOn;
    if (improveButton) improveButton.onclick = improve;
    if (review) review.onclick = function () { openReview(false); };
    if (back) back.onclick = closeReview;
    if (reportClose) reportClose.onclick = moveOn;
    if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
    keyHandler = function (event) {
      const host = $('tdResult'); if (!host || !host.classList.contains('show')) return;
      if (event.key === 'Escape' && host.classList.contains('is-reviewing')) { event.preventDefault(); event.stopImmediatePropagation(); closeReview(); return; }
      if (event.key !== 'Tab') return;
      const items = focusableWithin(); if (!items.length) return;
      const firstItem = items[0], lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener('keydown', keyHandler, true);
  }

  function showHost(isStatic) {
    const host = $('tdResult'), shell = $('tdrShell'), report = $('tdrReport');
    if (!host) return false;
    if (report) report.hidden = true;
    if (shell) shell.hidden = false;
    host.classList.remove('show','is-resolved','is-reviewing','is-leaving');
    void host.offsetWidth;
    host.classList.add('show');
    host.setAttribute('aria-hidden','false');
    host.setAttribute('aria-label','Proof verification result');
    syncChrome();
    if (isStatic) host.classList.add('is-resolved');
    else host.classList.add('is-resolved');
    const sheet = $('tdSheet'); if (sheet) sheet.scrollTop = 0;
    return true;
  }
  function hide() {
    const host = $('tdResult');
    if (!host) return;
    pointsAnimationToken += 1;
    host.classList.remove('show','is-resolved','is-unlocked','is-retry','is-static','is-reviewing','is-leaving','is-owner-mobile');
    host.setAttribute('aria-hidden','true');
    const report = $('tdrReport'), shell = $('tdrShell');
    if (report) report.hidden = true;
    if (shell) shell.hidden = false;
    if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
    syncChrome();
  }

  function assertRenderableResult(result) {
    if (!result || result.verificationStatus !== 'verified') throw new TypeError('Verified result is missing or has an invalid status.');
    if (!Number.isFinite(Number(result.pointsEarned))) throw new TypeError('Verified result is missing pointsEarned.');
    // executionScore may legitimately be null: the server awards points without
    // returning an execution score. It must still never be a malformed number.
    if (result.executionScore !== null && !Number.isFinite(Number(result.executionScore))) throw new TypeError('Verified result has an invalid executionScore.');
    if (!result.taskTitle) throw new TypeError('Verified result is missing taskTitle.');
    if (!Array.isArray(result.criteriaResults) || !Array.isArray(result.evidenceItems)) throw new TypeError('Verified result review data is invalid.');
    ['tdResult','tdrShell','tdrTitle','tdrVerifiedAt','tdrPoints','tdrScore','tdrRankNow','tdrReviewSummary','tdrTomorrow','tdrPrimary','tdrReview'].forEach(function (id) {
      if (!$(id)) throw new Error('Verified result DOM is missing #' + id + '.');
    });
    return result;
  }

  function present(result, options) {
    options = options || {};
    const host = $('tdResult'); if (!host) throw new Error('Verified result host #tdResult is missing.');
    assertRenderableResult(result);
    terminalActionTaken = false;
    recordOnly = false;
    const isStatic = reducedMotion(options);
    activeResult = result;
    renderSummary(activeResult, isStatic);
    renderReport(activeResult);
    wire();
    if (!showHost(isStatic)) throw new Error('Verified result host could not be opened.');
    if (!focusElement('tdrTitle')) throw new Error('Verified result title could not receive focus.');
    return true;
  }

  function presentRecord(record) {
    if (!record) return false;
    terminalActionTaken = false;
    recordOnly = true;
    activeResult = resultFromRecord(record);
    assertRenderableResult(activeResult);
    renderSummary(activeResult, reducedMotion({}));
    renderReport(activeResult);
    wire();
    const isStatic = reducedMotion({});
    if (!showHost(isStatic)) throw new Error('Completed result host could not be opened.');
    openReview(true);
    return true;
  }

  VisionTasks.resultScreen = {
    present:present,
    presentRecord:presentRecord,
    openReview:function () { return openReview(false); },
    closeReview:closeReview,
    hide:hide,
    normalize:buildResult,
    validate:assertRenderableResult,
    inspect:function () { return activeResult ? JSON.parse(JSON.stringify(activeResult)) : null; }
  };
})(window);
