/* founder-lead-intelligence.js — the REAL authenticated Founder + Lead
   Intelligence surface. Every write goes through the "lead-intelligence"
   Supabase Edge Function, which derives the signed-in user and their real
   active primary venture server-side; this file never sends a user or
   venture id as though it were trusted. Internal terms (RLS, migration,
   provider adapter, database row) never appear in anything rendered here —
   only plain product language. */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var signinGate = document.getElementById('signin-gate');
  var app = document.getElementById('founder-app');
  var ventureSetupPanel = document.getElementById('venture-setup-panel');
  var goalText = document.getElementById('goal-text');
  var goalSubmitBtn = document.getElementById('goal-submit-btn');
  var goalStatus = document.getElementById('goal-status');
  var clarifyPanel = document.getElementById('clarify-panel');
  var clarifyQuestionsEl = document.getElementById('clarify-questions');
  var clarifySubmitBtn = document.getElementById('clarify-submit-btn');
  var clarifyStatus = document.getElementById('clarify-status');
  var confirmPanel = document.getElementById('confirm-panel');
  var confirmListEl = document.getElementById('confirm-list');
  var confirmSubmitBtn = document.getElementById('confirm-submit-btn');
  var confirmStatus = document.getElementById('confirm-status');
  var todaysMovePanel = document.getElementById('todays-move-panel');
  var todaysMoveContent = document.getElementById('todays-move-content');
  var leadPanel = document.getElementById('lead-intelligence-panel');
  var providerStateEl = document.getElementById('provider-state');
  var leadLocation = document.getElementById('lead-location');
  var leadInterpretBtn = document.getElementById('lead-interpret-btn');
  var leadLocationResult = document.getElementById('lead-location-result');
  var leadSearchBtn = document.getElementById('lead-search-btn');
  var leadSearchStatus = document.getElementById('lead-search-status');
  var leadFunnel = document.getElementById('lead-funnel');
  var leadResults = document.getElementById('lead-results');
  var salesPracticePanel = document.getElementById('sales-practice-panel');
  var salesPracticeStatus = document.getElementById('sales-practice-status');
  var rerunFounderBtn = document.getElementById('rerun-founder-btn');

  var interpretedLocation = null;
  var latestClarifyQuestions = [];
  var latestUnderstood = [];
  var pendingActions = {};
  var currentLeads = [];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function displayValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join('; ');
    if (typeof value === 'object') return Object.entries(value).map(function (kv) { return kv[0] + ': ' + kv[1]; }).join(', ');
    return String(value);
  }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function setStatus(el, text, isError) {
    el.textContent = text || '';
    el.className = 'status-line' + (isError ? ' err' : '');
  }

  async function callFn(action, extra) {
    if (!V.sb) return { data: null, error: { message: 'not_configured' } };
    var body = Object.assign({ action: action }, extra || {});
    return V.sb.functions.invoke('lead-intelligence', { body: body });
  }

  /* Returns the SAME three states the Calendar uses, because this is the same
     question asked from a second place and one of them must not be able to
     answer it differently. `null` used to mean both "no proposal" and "the
     read failed", and the caller treated both as permission to generate a new
     week -- which could supersede a proposal the founder was mid-review on and
     throw away their edits. */
  async function readOpenProposal() {
    if (!V.sb) return { state: 'error' };
    var res;
    try { res = await V.sb.functions.invoke('founder-calendar', { body: { action: 'read_proposal' } }); }
    catch (e) { return { state: 'error' }; }
    if (res && res.error) return { state: 'error' };
    var b = res && res.data;
    if (!b || b.ok !== true || !b.proposal || typeof b.proposal.status !== 'string') {
      return { state: 'error' };
    }
    if (b.proposal.status === 'open') return { state: 'open', proposal: b.proposal };
    if (b.proposal.status === 'none') return { state: 'none' };
    return { state: 'error' };
  }

  async function generateFounderTask(extra) {
    if (!V.sb) return { data: null, error: { message: 'not_configured' } };
    return V.sb.functions.invoke('generate-tasks', {
      body: Object.assign({ mode: 'initial', reason: 'auto' }, extra || {}),
    });
  }

  function friendlyError(code) {
    var known = {
      opportunities_not_required: 'Your next step right now does not need new prospects.',
      no_active_primary_venture: 'Set up your venture first.',
      archived_venture_blocked: 'This venture has been archived.',
      paused_venture_blocked: 'This venture is paused.',
      provider_not_configured: 'Live search is unavailable right now. You can still add prospects manually once that opens up.',
      location_requires_clarification: 'Confirm the state and country before searching.',
      eligible_approved_opportunity_required: 'Approve at least one qualified prospect first.',
      founder_setup_required: 'Finish setting up your venture first.',
      founder_venture_unavailable: 'This venture is not active right now.',
      founder_generation_unavailable: 'Today\u2019s Move is temporarily unavailable. Please try again shortly.',
      founder_event_unavailable: 'That update could not be applied to your current venture.',
      generation_in_flight: 'Today\u2019s Move is already updating. Try again in a moment.',
      generation_temporarily_unavailable: 'Today\u2019s Move is temporarily unavailable. Please try again shortly.',
      more_information_required: 'VISION needs a little more information before choosing Today\u2019s Move.',
      rate_limited: 'You have reached today\u2019s refresh limit. Your current move is still available.',
    };
    return known[code] || 'Something did not go through. Please try again.';
  }

  /* The single place that decides what to show next after any intake step:
     unresolved clarification questions first, then any inferred fact that
     still needs the user's confirmation or correction, and only once both
     are empty does Today's Move get generated. Skipping the confirm step
     (i.e. blindly trusting an inferred value) is exactly what produces a
     nonsensical mission when free text doesn't parse cleanly -- so this
     function is the one place that ordering is enforced. */
  function advanceIntakeFlow(understood, clarificationQuestions) {
    latestUnderstood = understood || [];
    if (clarificationQuestions && clarificationQuestions.length) {
      hide(confirmPanel);
      renderClarify(clarificationQuestions);
      return;
    }
    hide(clarifyPanel);
    var inferred = latestUnderstood.filter(function (row) { return row.status === 'inferred'; });
    if (inferred.length) {
      renderConfirm(inferred);
      return;
    }
    hide(confirmPanel);
    refreshTodaysMove();
  }

  function renderClarify(questions) {
    latestClarifyQuestions = questions || [];
    clarifyQuestionsEl.innerHTML = latestClarifyQuestions.map(function (q, index) {
      return '<div class="question-row"><label>' + esc(q.question) + '</label>'
        + '<textarea rows="2" data-answer-index="' + index + '" data-question-id="' + esc(q.id || '') + '"></textarea></div>';
    }).join('');
    show(clarifyPanel);
  }

  function renderConfirm(inferredRows) {
    pendingActions = {};
    confirmListEl.innerHTML = inferredRows.map(function (row) {
      return '<div class="field-row" data-field-key="' + esc(row.key) + '">'
        + '<div class="field-top"><span class="field-label">' + esc(row.label || row.key) + '</span>'
        + '<span class="status-badge">inferred</span></div>'
        + '<div class="field-value" data-role="value">' + esc(displayValue(row.value)) + '</div>'
        + '<input type="text" class="hidden" data-role="edit-input" maxlength="1000" value="' + esc(displayValue(row.value)) + '" />'
        + '<div class="field-actions">'
        + '<button type="button" class="small" data-act="confirm">Looks right</button>'
        + '<button type="button" class="small" data-act="edit">Fix it</button>'
        + '<button type="button" class="small" data-act="reject">Wrong</button>'
        + '</div></div>';
    }).join('');
    confirmListEl.querySelectorAll('.field-row').forEach(function (row) {
      var key = row.getAttribute('data-field-key');
      var editInput = row.querySelector('[data-role="edit-input"]');
      row.querySelectorAll('button[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          row.querySelectorAll('button[data-act]').forEach(function (b) { b.classList.remove('active', 'danger'); });
          if (act === 'confirm') { pendingActions[key] = { type: 'confirm' }; btn.classList.add('active'); editInput.classList.add('hidden'); }
          else if (act === 'reject') { pendingActions[key] = { type: 'reject' }; btn.classList.add('active', 'danger'); editInput.classList.add('hidden'); }
          else { pendingActions[key] = { type: 'correct', text: editInput.value }; btn.classList.add('active'); editInput.classList.remove('hidden'); editInput.focus(); }
        });
      });
      editInput.addEventListener('input', function () { pendingActions[key] = { type: 'correct', text: editInput.value }; });
    });
    show(confirmPanel);
  }

  async function handleConfirmSubmit() {
    var confirm = []; var reject = []; var corrections = {};
    Object.keys(pendingActions).forEach(function (key) {
      var action = pendingActions[key];
      if (action.type === 'confirm') confirm.push(key);
      else if (action.type === 'reject') reject.push(key);
      else if (action.type === 'correct' && action.text && action.text.trim()) { confirm.push(key); corrections[key] = action.text.trim(); }
    });
    confirmSubmitBtn.disabled = true;
    setStatus(confirmStatus, 'Saving…');
    var res = await callFn('intake_confirm', { confirm: confirm, corrections: corrections, reject: reject });
    confirmSubmitBtn.disabled = false;
    if (res.error || !res.data || res.data.ok !== true) { setStatus(confirmStatus, 'Could not save your answers.', true); return; }
    setStatus(confirmStatus, '');
    advanceIntakeFlow(res.data.understood, res.data.clarificationQuestions);
  }

  function productMoveFromGeneration(data) {
    var result = data && data.founder_result;
    if (result && result.todays_move) return result;
    var task = data && Array.isArray(data.tasks) ? data.tasks[0] : null;
    if (!task) return null;
    return {
      todays_move: {
        title: task.title,
        missionStatement: task.why,
        steps: Array.isArray(task.steps) ? task.steps.map(function (step) { return { label: step }; }) : [],
      },
      completion_definition: task.proof_prompt,
      professional_standard: task.mission_intent && task.mission_intent.avoid_pattern
        ? [task.mission_intent.avoid_pattern]
        : (task.mistake_to_avoid ? [task.mistake_to_avoid] : []),
      required_evidence: Array.isArray(task.good_proof_examples) && task.good_proof_examples.length
        ? task.good_proof_examples
        : String(task.proof_must_show || '').split(';').map(function (item) { return item.trim(); }).filter(Boolean),
      expected_outcome: task.helps,
      user_safe_explanation: task.why_personalised,
    };
  }

  function renderTodaysMove(data, needsOpportunities) {
    var result = productMoveFromGeneration(data);
    if (!result || !result.todays_move) { hide(todaysMovePanel); return; }
    var mission = result.todays_move;
    var steps = Array.isArray(mission.steps) ? mission.steps : [];
    var standard = Array.isArray(result.professional_standard) ? result.professional_standard : [];
    var evidence = Array.isArray(result.required_evidence) ? result.required_evidence : [];
    todaysMoveContent.innerHTML = '<h3>' + esc(mission.title || 'Your next step') + '</h3>'
      + '<p>' + esc(mission.missionStatement || '') + '</p>'
      + (steps.length ? '<ol>' + steps.map(function (step) { return '<li>' + esc(step.label || step) + '</li>'; }).join('') + '</ol>' : '')
      + (result.completion_definition ? '<p><strong>Done when:</strong> ' + esc(result.completion_definition) + '</p>' : '')
      + (result.expected_outcome ? '<p><strong>Expected outcome:</strong> ' + esc(result.expected_outcome) + '</p>' : '')
      + (standard.length ? '<p><strong>Professional Standard:</strong></p><ul>' + standard.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>' : '')
      + (evidence.length ? '<p><strong>Required Evidence:</strong></p><ul>' + evidence.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>' : '');
    show(todaysMovePanel);
    /* The two surviving callers are the LIVE adaptive path -- a founder who
       already approved their plan reports a lead outcome, or asks VISION to
       rework it. Those legitimately persist. Re-reading the Calendar here is
       what stops the two surfaces disagreeing: whatever VISION just changed,
       the authoritative week on the same page reflects it immediately. */
    document.dispatchEvent(new CustomEvent('vision:founder-plan-proposed'));
    if (needsOpportunities === true) { show(leadPanel); loadProviderState(); }
  }

  /**
   * THE END OF THE INTAKE JOURNEY.
   *
   * This used to call generate-tasks in persisting mode on every page load and
   * again after confirmation, which wrote authoritative work -- a live task, a
   * fact, Current Work -- before the founder had seen any of it. Everything
   * downstream then asked for approval of something that was already real,
   * which made the approval decorative.
   *
   * It now PROPOSES. The engine runs identically and stops before the
   * authoritative write, and the Calendar reveals the proposed week on this
   * same page for the founder to accept or edit. Nothing becomes real until
   * they say so.
   *
   * A 409 founder_plan_already_active is the returning founder: they have a
   * live plan, so there is nothing to propose and the Calendar simply loads it.
   * That is the normal steady state, not an error, and it is why this can never
   * become a recurring weekly approval ritual.
   */
  async function refreshTodaysMove() {
    /* AN OPEN PROPOSAL IS NOT RE-PROPOSED.
       Without this, every page load ran the engine again and superseded the
       week the founder was in the middle of reviewing -- so a refresh handed
       them a DIFFERENT plan, and any edit they had made was replaced by a
       fresh draft. Found by refreshing the browser mid-review on staging;
       nothing offline would have shown it, because the regeneration is
       individually correct. A pending decision is not a reason to decide again. */
    var existing = await readOpenProposal();
    if (existing.state === 'open') {
      setStatus(goalStatus, '');
      revealCalendar();
      return;
    }
    if (existing.state === 'error') {
      /* We do not know whether a proposed week exists. Proposing anyway could
         supersede one the founder is reviewing and discard their edits, so
         this stops and lets the Calendar show its own retryable error. */
      setStatus(goalStatus, friendlyError('calendar_read_failed'), true);
      revealCalendar();
      return;
    }
    var res = await generateFounderTask({ mode: 'initial', reason: 'auto', propose: true });
    var body = res.data;
    var alreadyLive = (body && body.error === 'founder_plan_already_active')
      || (res.error && res.error.context && res.error.context.status === 409);
    if (alreadyLive) {
      setStatus(goalStatus, '');
      revealCalendar();
      return;
    }
    if (res.error || !body || body.ok !== true) {
      setStatus(goalStatus, friendlyError(body && body.error), true);
      return;
    }
    setStatus(goalStatus, '');
    /* Deliberately does NOT render #todays-move-panel. A proposed week is not
       today's move, and showing one above the Calendar is exactly the second
       source of truth this phase removes: two surfaces answering "what should
       I work on" from different backends, neither invalidating the other. */
    revealCalendar();
  }

  /** Hands off to the Calendar on the same page. No navigation, no CTA. */
  function revealCalendar() {
    if (todaysMovePanel) { todaysMovePanel.hidden = true; todaysMovePanel.classList.add('hidden'); }
    document.dispatchEvent(new CustomEvent('vision:founder-plan-proposed'));
  }

  async function loadProviderState() {
    var res = await callFn('provider_state');
    if (res.error || !res.data) return;
    providerStateEl.textContent = res.data.provider === 'configured'
      ? 'Live search is available.'
      : 'Live search is not configured yet. Manual prospect entry remains available soon.';
  }

  function renderLeads(leads) {
    currentLeads = leads || [];
    if (!currentLeads.length) {
      leadResults.innerHTML = '<p class="sub">No prospect met the quality bar yet.</p>';
      return;
    }
    leadResults.innerHTML = currentLeads.map(function (item) {
      var eligibility = item.eligibility || {};
      var evidence = (item.observations || []).slice(0, 3).map(function (obs) {
        return '<div class="evidence">' + esc(obs.observation) + '</div>';
      }).join('');
      var report = item.state === 'approved'
        ? '<div class="outcome-report"><label>What happened after you contacted ' + esc(item.name) + '?</label>'
          + '<textarea rows="3" maxlength="1000" data-lead-report placeholder="Write the outcome in your own words."></textarea>'
          + '<button class="small" type="button" data-report-outcome>Update Today\u2019s Move</button>'
          + '<div class="status-line" data-report-status aria-live="polite"></div></div>'
        : '';
      return '<article class="opportunity-card" data-opportunity-id="' + esc(item.id) + '">'
        + '<h4>' + esc(item.name) + '</h4><div class="sub">' + esc(item.category || 'Local business') + '</div>'
        + '<div class="opportunity-score">' + esc(item.ranking && item.ranking.dimensions && item.ranking.dimensions.opportunityScore) + '/100</div>'
        + '<div class="lead-context"><span class="pill">' + esc(item.state || 'new') + '</span>'
        + '<span class="pill ' + (eligibility.founderEligible ? 'eligible' : 'blocked') + '">' + (eligibility.founderEligible ? 'Qualified Lead' : 'Not yet qualified') + '</span></div>'
        + evidence
        + '<div class="opportunity-actions">'
        + '<button class="small' + (item.state === 'approved' ? ' active' : '') + '" type="button" data-lead-action="approve">Approve</button>'
        + '<button class="small' + (item.state === 'rejected' ? ' active danger' : '') + '" type="button" data-lead-action="reject">Not a fit</button>'
        + '</div>' + report + '</article>';
    }).join('');
    leadResults.querySelectorAll('[data-lead-action]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (button.disabled) return;
        var card = button.closest('[data-opportunity-id]');
        var buttons = card.querySelectorAll('[data-lead-action]');
        buttons.forEach(function (b) { b.disabled = true; });
        var payload = { opportunityId: card.getAttribute('data-opportunity-id'), decision: button.getAttribute('data-lead-action') };
        if (payload.decision === 'reject') payload.reason = 'poor_match';
        var res = await callFn('decision', payload);
        buttons.forEach(function (b) { b.disabled = false; });
        if (res.error || !res.data || res.data.ok !== true) { setStatus(leadSearchStatus, 'Could not save that decision.', true); return; }
        renderLeads(res.data.leads);
        maybeShowSalesPracticePanel();
      });
    });
    leadResults.querySelectorAll('[data-report-outcome]').forEach(function (button) {
      button.addEventListener('click', async function () {
        if (button.disabled) return;
        var card = button.closest('[data-opportunity-id]');
        var item = currentLeads.find(function (lead) { return String(lead.id) === card.getAttribute('data-opportunity-id'); });
        var input = card.querySelector('[data-lead-report]');
        var status = card.querySelector('[data-report-status]');
        var text = input ? input.value.trim() : '';
        if (!text) { setStatus(status, 'Describe what happened first.', true); return; }
        button.disabled = true;
        setStatus(status, 'Updating Today\u2019s Move\u2026');
        var res = await generateFounderTask({
          mode: 'regenerate',
          reason: 'auto',
          founder_event: {
            entityId: founderEntityIdForLead(item || { id: card.getAttribute('data-opportunity-id') }),
            responseOption: 'got_response',
            freeText: text,
          },
        });
        button.disabled = false;
        if (res.error || !res.data || res.data.ok !== true) {
          setStatus(status, friendlyError(res.data && res.data.error), true);
          return;
        }
        renderTodaysMove(res.data, false);
        setStatus(status, 'Today\u2019s Move now reflects this outcome.');
      });
    });
  }

  function founderEntityIdForLead(item) {
    var value = 'lead_' + (item.id || item.name || 'entity');
    var cleaned = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 56);
    return /^[a-z]/.test(cleaned) ? cleaned : 'opportunity_' + (cleaned || 'entity');
  }

  function maybeShowSalesPracticePanel() {
    var anyApproved = currentLeads.some(function (item) { return item.state === 'approved'; });
    if (anyApproved) { show(salesPracticePanel); show(rerunFounderBtn); } else { hide(salesPracticePanel); }
  }

  async function handleGoalSubmit() {
    var text = goalText.value.trim();
    if (!text) { setStatus(goalStatus, 'Describe your venture first.', true); return; }
    goalSubmitBtn.disabled = true;
    setStatus(goalStatus, 'Thinking…');
    var res = await callFn('intake_start', { goalText: text });
    goalSubmitBtn.disabled = false;
    if (res.error || !res.data || res.data.ok !== true) { setStatus(goalStatus, friendlyError(res.data && res.data.error), true); return; }
    setStatus(goalStatus, '');
    hide(ventureSetupPanel);
    advanceIntakeFlow(res.data.understood, res.data.clarificationQuestions);
  }

  /* A question may answer MORE THAN ONE fact, and the two storage paths are not
     interchangeable:

       intake_clarify  runs the extractor and then ONE targeted fallback --
                       QUESTION_FALLBACK[questionId] -- which writes exactly one
                       fact key.
       intake_confirm  writes a correction per key named in `corrections`, so it
                       can satisfy every key a question asks about.

     Sending a multi-fact question through intake_clarify therefore satisfies
     only its FIRST key, leaves the others unknown, and the engine asks the same
     question again next round -- forever. Measured on the six archetypes:
     55 questions asked and three ventures never reaching a task, versus 26 and
     five with correct routing.

     Every intake question is single-fact TODAY, so this is latent rather than
     live; it goes live the moment a question declares more than one key, which
     is exactly what the Need Ledger emits (offer_detail -> offer + offerPricing).
     Routing on the question's own declared factKeys means the client is correct
     for both banks without needing to know which one asked.

     Mirrors answerFounderQuestion in js/vision-daily-plan.js, which already
     splits on factKeys.length the same way. */
  async function handleClarifySubmit() {
    var single = [];
    var corrections = {};
    latestClarifyQuestions.forEach(function (q, index) {
      var el = clarifyQuestionsEl.querySelector('[data-answer-index="' + index + '"]');
      var text = el ? el.value.trim() : '';
      if (!text) return;
      var keys = Array.isArray(q.factKeys) ? q.factKeys : [];
      if (keys.length > 1) {
        for (var i = 0; i < keys.length; i += 1) corrections[keys[i]] = text;
      } else {
        /* Zero or one key: the extractor path, unchanged. A question with no
           declared key (the revenue-conflict question) has no targeted fallback
           and must be parsed, never assumed. */
        single.push({ questionId: q.id, answerText: text });
      }
    });
    if (!single.length && !Object.keys(corrections).length) return;

    clarifySubmitBtn.disabled = true;
    setStatus(clarifyStatus, 'Saving…');
    var res = null;
    if (single.length) {
      res = await callFn('intake_clarify', { answers: single });
      if (res.error || !res.data || res.data.ok !== true) {
        clarifySubmitBtn.disabled = false;
        setStatus(clarifyStatus, 'Could not save your answers.', true);
        return;
      }
    }
    if (Object.keys(corrections).length) {
      res = await callFn('intake_confirm', { confirm: [], corrections: corrections, reject: [] });
      if (res.error || !res.data || res.data.ok !== true) {
        clarifySubmitBtn.disabled = false;
        setStatus(clarifyStatus, 'Could not save your answers.', true);
        return;
      }
    }
    clarifySubmitBtn.disabled = false;
    setStatus(clarifyStatus, '');
    advanceIntakeFlow(res.data.understood, res.data.clarificationQuestions);
  }

  async function handleInterpretLocation() {
    leadSearchBtn.disabled = true;
    setStatus(leadLocationResult, 'Interpreting location…');
    var res = await callFn('interpret_location', { location: leadLocation.value, mode: 'locality' });
    if (res.error || !res.data || res.data.ok !== true || res.data.location.requiresClarification) {
      interpretedLocation = null;
      setStatus(leadLocationResult, (res.data && res.data.location && res.data.location.reason) || 'Confirm the state and country before searching.', true);
      return;
    }
    interpretedLocation = res.data.location;
    setStatus(leadLocationResult, 'VISION will search: ' + interpretedLocation.label);
    leadSearchBtn.disabled = false;
  }

  async function handleLeadSearch() {
    if (!interpretedLocation) { setStatus(leadSearchStatus, 'Interpret and confirm the location first.', true); return; }
    leadSearchBtn.disabled = true;
    setStatus(leadSearchStatus, 'Discovering candidates, then deeply researching only the strongest…');
    var res = await callFn('search', {
      location: leadLocation.value, mode: interpretedLocation.mode, userApproved: true,
      idempotencyKey: 'search_' + Date.now(),
    });
    leadSearchBtn.disabled = false;
    if (res.error || !res.data || res.data.ok !== true) {
      leadFunnel.innerHTML = ''; leadResults.innerHTML = '';
      // Prefer the server's own specific reason (and the interpretations it
      // can offer) over the generic message, so an ambiguous location tells
      // the founder exactly what to add rather than leaving them stuck.
      var detail = res.data && res.data.details;
      var options = (res.data && res.data.suggestions) || [];
      var message = detail
        ? detail + (options.length ? ' For example: ' + options.slice(0, 3).join(', ') + '.' : '')
        : friendlyError(res.data && res.data.error);
      setStatus(leadSearchStatus, message, true);
      return;
    }
    var counts = res.data.counts || {};
    setStatus(leadSearchStatus, 'Found ' + (counts.qualified || 0) + ' qualified prospect' + (counts.qualified === 1 ? '' : 's') + '.');
    leadFunnel.innerHTML = '<div class="funnel-grid">'
      + '<div class="score-cell"><strong>' + (counts.discovered || 0) + '</strong><span>Found</span></div>'
      + '<div class="score-cell"><strong>' + (counts.afterFiltering || 0) + '</strong><span>Filtered</span></div>'
      + '<div class="score-cell"><strong>' + (counts.deeplyResearched || 0) + '</strong><span>Researched</span></div>'
      + '<div class="score-cell"><strong>' + (counts.websitesInspected || 0) + '</strong><span>Sites checked</span></div>'
      + '<div class="score-cell"><strong>' + (counts.qualified || 0) + '</strong><span>Qualified</span></div></div>';
    renderLeads(res.data.leads);
  }

  async function handleRerunFounder() {
    rerunFounderBtn.disabled = true;
    var intake = await callFn('rerun_founder');
    if (intake.error || !intake.data || intake.data.ok !== true) {
      rerunFounderBtn.disabled = false;
      setStatus(salesPracticeStatus, friendlyError(intake.data && intake.data.error), true);
      return;
    }
    var res = await generateFounderTask({ mode: 'regenerate', reason: 'manual_refresh' });
    rerunFounderBtn.disabled = false;
    if (res.error || !res.data || res.data.ok !== true) { setStatus(salesPracticeStatus, friendlyError(res.data && res.data.error), true); return; }
    renderTodaysMove(res.data, false);
    setStatus(salesPracticeStatus, 'Today’s Move now reflects your approved prospects.');
  }

  async function bootstrap() {
    var res = await callFn('bootstrap', { ventureName: 'My venture' });
    if (res.error || !res.data || res.data.ok !== true) {
      if (res.data && res.data.error === 'no_active_primary_venture') { show(ventureSetupPanel); return; }
      setStatus(goalStatus, 'Could not load your workspace. Please try again shortly.', true);
      return;
    }
    hide(ventureSetupPanel);
    renderLeads(res.data.leads);
    maybeShowSalesPracticePanel();
    advanceIntakeFlow(res.data.understood, res.data.clarificationQuestions);
  }

  async function init() {
    var user = V.auth ? await V.auth.getUser() : null;
    if (!user) { show(signinGate); return; }
    hide(signinGate);
    show(app);
    await bootstrap();
  }

  goalSubmitBtn.addEventListener('click', handleGoalSubmit);
  clarifySubmitBtn.addEventListener('click', handleClarifySubmit);
  confirmSubmitBtn.addEventListener('click', handleConfirmSubmit);
  leadInterpretBtn.addEventListener('click', handleInterpretLocation);
  leadSearchBtn.addEventListener('click', handleLeadSearch);
  rerunFounderBtn.addEventListener('click', handleRerunFounder);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.VISION);
