/* ═══════════════════════════════════════════════════════════════
   owner-founder-intake.js — Founder Intake & Clarification preview.

   Real user goal -> extracted context -> targeted clarification ->
   confirm/correct -> personalised Today's Move, running through the real,
   unmodified Founder Goal Engine (see js/goal-engine/founder-intake/).
   Every network call is same-origin (/api/owner/founder-*), gated by the
   same fp_session cookie as the rest of this preview. Nothing here is
   persisted; Today's Move always shows persisted_task_id: null.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var latestUnderstood = [];
  var latestClarifyQuestions = [];
  var pendingActions = {}; // fieldKey -> {type: 'confirm'|'reject'|'correct', text?: string}

  var step1 = document.getElementById('intake-step1');
  var step2 = document.getElementById('intake-step2');
  var step3 = document.getElementById('intake-step3');
  var step4 = document.getElementById('intake-step4');
  var step5 = document.getElementById('intake-step5');
  var step6 = document.getElementById('intake-step6');
  var techDetails = document.getElementById('intake-tech-details');
  var actionsRow = document.getElementById('intake-actions-row');
  var leadPanel = document.getElementById('lead-intelligence-panel');
  var leadStartBtn = document.getElementById('lead-start-btn');
  var leadSearchControls = document.getElementById('lead-search-controls');
  var leadLocation = document.getElementById('lead-location');
  var leadInterpretBtn = document.getElementById('lead-interpret-btn');
  var leadLocationResult = document.getElementById('lead-location-result');
  var leadProviderState = document.getElementById('lead-provider-state');
  var leadFixtureLabel = document.getElementById('lead-fixture-label');
  var leadUseFixtures = document.getElementById('lead-use-fixtures');
  var leadSearchBtn = document.getElementById('lead-search-btn');
  var leadSearchStatus = document.getElementById('lead-search-status');
  var leadContext = document.getElementById('lead-context');
  var leadFunnel = document.getElementById('lead-funnel');
  var leadResults = document.getElementById('lead-results');
  var leadSalesPracticeBoundary = document.getElementById('lead-sales-practice-boundary');
  var leadSalesPracticeStatus = document.getElementById('lead-sales-practice-status');
  var leadRerunBtn = document.getElementById('lead-rerun-btn');
  var interpretedLocation = null;
  var opportunityRows = [];
  var currentProviderMode = null;

  var DIMENSION_LABELS = {
    targetCustomerFit: 'Customer fit', locationFit: 'Location', opportunityRelevance: 'Relevance',
    evidenceStrength: 'Evidence', contactability: 'Contactability', founderOfferFit: 'Offer fit',
    founderCapabilityFit: 'Capability evidence', freshness: 'Evidence freshness', priorContactRisk: 'No-prior-contact confidence', opportunityScore: 'Opportunity Score',
  };

  var goalInput = document.getElementById('intake-goal');
  var progressInput = document.getElementById('intake-progress');
  var intakeSubmitBtn = document.getElementById('intake-submit-btn');
  var intakeStatus = document.getElementById('intake-status');
  var understoodList = document.getElementById('understood-list');
  var clarifyQuestionsEl = document.getElementById('clarify-questions');
  var clarifySubmitBtn = document.getElementById('clarify-submit-btn');
  var clarifyStatus = document.getElementById('clarify-status');
  var confirmList = document.getElementById('confirm-list');
  var generateBtn = document.getElementById('generate-btn');
  var generateStatus = document.getElementById('generate-status');
  var missionHeading = document.getElementById('mission-heading');
  var todaysMoveContent = document.getElementById('todays-move-content');
  var personalizationList = document.getElementById('personalization-list');
  var technicalContentEl = document.getElementById('intake-technical-content');
  var startOverBtn = document.getElementById('start-over-btn');

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

  async function postJson(url, body) {
    var resp;
    try {
      resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    } catch (e) {
      return { networkError: true };
    }
    var data = null;
    try { data = await resp.json(); } catch (e) { /* leave null */ }
    return { status: resp.status, data: data };
  }

  function setStatus(el, text, isError) {
    el.textContent = text || '';
    el.className = 'status-line' + (isError ? ' err' : '');
  }

  function show(el) { el.classList.remove('hidden'); }
  function hideAll(els) { els.forEach(function (e) { e.classList.add('hidden'); }); }

  function renderUnderstood(rows) {
    understoodList.innerHTML = rows.filter(function (r) { return r.status !== 'unknown'; }).map(function (r) {
      return '<div class="field-row">'
        + '<div class="field-top"><span class="field-label">' + esc(r.label) + '</span>'
        + '<span class="status-badge ' + r.status + '">' + esc(r.status) + '</span></div>'
        + '<div class="field-value">' + esc(displayValue(r.value)) + '</div>'
        + (r.source ? '<div class="field-source">Source: ' + esc(r.source) + '</div>' : '')
        + '</div>';
    }).join('') || '<p class="sub">Nothing recognisable yet.</p>';
  }

  function renderClarifyQuestions(questions) {
    clarifyQuestionsEl.innerHTML = questions.map(function (q, i) {
      return '<div class="clarify-item"><div class="q">' + esc(q.question) + '</div>'
        + '<input type="text" data-question-id="' + esc(q.id || ('q' + i)) + '" maxlength="1000" />'
        + '</div>';
    }).join('');
  }

  function renderConfirmList(rows) {
    var inferred = rows.filter(function (r) { return r.status === 'inferred'; });
    var known = rows.filter(function (r) { return r.status === 'known'; });
    var html = '';
    inferred.forEach(function (r) {
      var action = pendingActions[r.key];
      html += '<div class="field-row" data-field-key="' + esc(r.key) + '">'
        + '<div class="field-top"><span class="field-label">' + esc(r.label) + '</span>'
        + '<span class="status-badge inferred">inferred</span></div>'
        + '<div class="field-value" data-role="value">' + esc(displayValue(r.value)) + '</div>'
        + '<input type="text" class="hidden" data-role="edit-input" maxlength="1000" value="' + esc(displayValue(r.value)) + '" />'
        + '<div class="field-actions">'
        + '<button type="button" class="small' + (action && action.type === 'confirm' ? ' active' : '') + '" data-act="confirm">Confirm</button>'
        + '<button type="button" class="small' + (action && action.type === 'correct' ? ' active' : '') + '" data-act="edit">Edit</button>'
        + '<button type="button" class="small' + (action && action.type === 'reject' ? ' active danger' : '') + '" data-act="reject">Wrong</button>'
        + '</div></div>';
    });
    if (known.length) {
      html += '<p class="sub" style="margin-top:14px;">Already known: ' + known.map(function (r) { return esc(r.label); }).join(', ') + '</p>';
    }
    confirmList.innerHTML = html || '<p class="sub">Nothing left to confirm.</p>';

    confirmList.querySelectorAll('.field-row').forEach(function (row) {
      var key = row.getAttribute('data-field-key');
      row.querySelectorAll('button[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act');
          if (act === 'confirm') {
            pendingActions[key] = { type: 'confirm' };
          } else if (act === 'reject') {
            pendingActions[key] = { type: 'reject' };
          } else if (act === 'edit') {
            row.querySelector('[data-role="edit-input"]').classList.remove('hidden');
            pendingActions[key] = { type: 'correct', text: row.querySelector('[data-role="edit-input"]').value };
            return;
          }
          renderConfirmList(latestUnderstood);
        });
      });
      var editInput = row.querySelector('[data-role="edit-input"]');
      editInput.addEventListener('input', function () {
        pendingActions[key] = { type: 'correct', text: editInput.value };
      });
    });
  }

  /* Default view shows ONLY: the mission (or a single decision notice),
     why this move, required evidence, expected outcome, confidence, and
     the one quiet notice -- never all 7 routes, internal fact keys,
     persisted_task_id, null values, or trust enums (those live only in
     Technical Details below). */
  function renderMissionResult(result) {
    var mission = result.mission;
    var html = '';

    if (result.decision === 'direct' || result.decision === 'prerequisite') {
      missionHeading.textContent = "Today's Move";
      html += '<div class="result-section"><h3>' + esc(mission.title) + '</h3>';
      html += '<div class="kv"><dt>Mission</dt><dd>' + esc(mission.missionStatement) + '</dd></div>';
      html += '<div class="kv"><dt>Completion definition</dt><dd>' + esc(mission.completionDefinition) + '</dd></div>';
      html += '<div class="kv"><dt>Required evidence</dt><dd>' + esc((mission.requiredEvidence || []).join('; ')) + '</dd></div>';
      html += '<div class="kv"><dt>Expected outcome</dt><dd>' + esc(mission.expectedBusinessOutcome) + '</dd></div>';
      html += '<div class="kv"><dt>Confidence</dt><dd>' + esc(mission.confidence) + '</dd></div>';
      html += '<div class="kv"><dt>Why this move</dt><dd>' + esc(mission.whyNow) + '</dd></div>';
      html += '</div><p class="sub">' + esc(result.notice) + '</p>';
    } else {
      missionHeading.textContent = 'VISION needs one decision before it can set today’s move.';
      html += '<div class="result-section">';
      if (result.clarificationQuestions && result.clarificationQuestions.length) {
        html += '<ul class="plain">' + result.clarificationQuestions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul>';
      }
      html += '</div>';
    }
    todaysMoveContent.innerHTML = html;
  }

  function renderTechnicalDetails(technical) {
    var html = '';
    if (technical.bottleneck) {
      html += '<div class="result-section"><h3>Selected Bottleneck</h3>';
      html += '<div class="kv"><dt>Bottleneck</dt><dd>' + esc(technical.bottleneck.label) + '</dd></div>';
      html += '<div class="kv"><dt>Fact confidence</dt><dd>' + esc(technical.bottleneck.confidence) + '</dd></div>';
      html += '</div>';
    }
    if (technical.missionLevel) {
      html += '<div class="result-section"><h3>Mission Type</h3>';
      html += '<div class="kv"><dt>Type</dt><dd>' + esc(technical.missionLevel === 'prerequisite' ? 'Prerequisite (creates a missing resource)' : 'Direct execution') + '</dd></div>';
      if (technical.missingPrerequisite) html += '<div class="kv"><dt>Missing resource</dt><dd>' + esc(technical.missingPrerequisite) + '</dd></div>';
      html += '</div>';
    }
    html += '<div class="result-section"><h3>Founder Route Evaluations</h3>';
    (technical.routeEvaluations || []).forEach(function (r) {
      html += '<div class="route-item"><span class="pill ' + (r.state === 'Ready to execute' ? 'eligible' : 'blocked') + '">' + esc(r.state) + '</span>' + esc(r.route)
        + '<div class="route-reason">' + esc(r.reason) + '</div></div>';
    });
    html += '</div>';
    if (technical.candidatesConsidered && technical.candidatesConsidered.length) {
      html += '<div class="result-section"><h3>Candidates Considered</h3><ul class="plain">';
      technical.candidatesConsidered.forEach(function (c) { html += '<li>' + esc(c.title) + ' (' + esc(c.route) + ')</li>'; });
      html += '</ul></div>';
    }
    html += '<div class="result-section"><h3>Preview Status</h3><p class="sub">' + esc(technical.persistenceStatus) + '</p></div>';
    technicalContentEl.innerHTML = html;
  }

  function renderOpportunities(rows, providerMode) {
    opportunityRows = rows || [];
    currentProviderMode = providerMode || currentProviderMode;
    var modeNotice = providerMode === 'fixture_only'
      ? '<p class="provider-state">Owner-preview fixtures — these are not live businesses or live provider results.</p>'
      : '<p class="provider-state">Google Places server-provider results. Evidence still requires review and approval.</p>';
    if (!leadFunnel.querySelector('.provider-state')) leadFunnel.insertAdjacentHTML('afterbegin', modeNotice);
    var html = '';
    if (!opportunityRows.length) html += '<p class="sub">No opportunity met the quality threshold. Founder’s manual discovery mission remains available.</p>';
    opportunityRows.forEach(function (item) {
      var observations = (item.observations || []).map(function (obs) {
        return '<div class="evidence"><strong>' + esc(obs.evidenceStatus) + '</strong> — ' + esc(obs.observation)
          + ' <a href="' + esc(obs.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Source</a></div>';
      }).join('');
      var dimensions = Object.keys(DIMENSION_LABELS).map(function (key) {
        var value = item.ranking && item.ranking.dimensions ? item.ranking.dimensions[key] : null;
        return '<div class="score-cell"><strong>' + esc(value == null ? '—' : value) + '</strong><span>' + esc(DIMENSION_LABELS[key]) + '</span></div>';
      }).join('');
      var evidenceCounts = { OBSERVED: 0, INFERRED: 0, UNKNOWN: 0 };
      (item.observations || []).forEach(function (obs) {
        if (Object.prototype.hasOwnProperty.call(evidenceCounts, obs.evidenceStatus)) evidenceCounts[obs.evidenceStatus] += 1;
      });
      var eligibility = item.eligibility || {};
      var blockedReasons = (eligibility.reasons || []).join(', ').replace(/_/g, ' ');
      var provenanceCount = Object.keys(item.ranking && item.ranking.provenance || {}).reduce(function (total, key) {
        return total + (item.ranking.provenance[key] || []).filter(function (entry) { return entry.evidenceStatus !== 'UNKNOWN'; }).length;
      }, 0);
      var sources = (item.sources || []).map(function (source) {
        return '<a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">' + esc(source.type || 'source') + '</a>';
      }).join(' · ');
      html += '<article class="opportunity-card" data-opportunity-id="' + esc(item.id) + '">'
        + '<h4>' + esc(item.name) + '</h4><div class="sub">' + esc(item.category || 'Local business') + ' · ' + esc(item.address || '') + '</div>'
        + '<div class="opportunity-score">Opportunity Score ' + esc(item.ranking && item.ranking.dimensions && item.ranking.dimensions.opportunityScore) + '/100</div>'
        + '<div class="sub">Lead Qualification Threshold: 30 · evidence-backed estimate, not factual verification</div>'
        + '<p>' + esc(item.ranking && item.ranking.explanation) + '</p><div class="score-grid">' + dimensions + '</div>'
        + '<div class="lead-context"><span class="pill ' + (item.ranking && item.ranking.qualified ? 'eligible' : 'blocked') + '">' + (item.ranking && item.ranking.qualified ? 'Qualified Lead' : 'Not qualified') + '</span><span class="pill">' + esc(item.state || 'researched') + '</span>'
        + '<span class="pill ' + (eligibility.memoryEligible ? 'eligible' : 'blocked') + '">Memory ' + (eligibility.memoryEligible ? 'eligible' : 'blocked') + '</span>'
        + '<span class="pill ' + (eligibility.campaignEligible ? 'eligible' : 'blocked') + '">Campaign ' + (eligibility.campaignEligible ? 'eligible' : 'blocked') + '</span>'
        + '<span class="pill ' + (eligibility.founderEligible ? 'eligible' : 'blocked') + '">Founder ' + (eligibility.founderEligible ? 'eligible' : 'blocked') + '</span>'
        + '<span class="pill ' + (eligibility.contactEligible ? 'eligible' : 'blocked') + '">Outreach ' + (eligibility.contactEligible ? 'unlocked' : 'locked') + '</span></div>'
        + '<div class="evidence-heading">Evidence · ' + evidenceCounts.OBSERVED + ' observed · ' + evidenceCounts.INFERRED + ' inferred · ' + evidenceCounts.UNKNOWN + ' unknown</div>' + observations
        + '<div class="evidence">Sources: ' + (sources || 'No public source URL recorded') + '</div>'
        + '<div class="evidence">Score provenance: ' + esc(provenanceCount) + ' non-UNKNOWN claim references. Approval never changes an evidence class.</div>'
        + '<div class="evidence">Deduplication: ' + esc(item.deduplication && item.deduplication.status || 'unknown') + '. Lead gates: ' + esc(blockedReasons || 'passed') + '</div>'
        + '<div class="opportunity-actions">'
        + '<button class="small' + (item.state === 'approved' ? ' active' : '') + '" type="button" data-lead-action="approve">Approve</button>'
        + '<button class="small' + (item.state === 'rejected' ? ' active danger' : '') + '" type="button" data-lead-action="reject">Reject</button>'
        + '<button class="small" type="button" data-lead-action="replace">Replace</button>'
        + '</div></article>';
    });
    leadResults.innerHTML = html;
    leadResults.querySelectorAll('[data-lead-action]').forEach(function (button) {
      button.addEventListener('click', async function () {
        var card = button.closest('[data-opportunity-id]');
        var cardButtons = card.querySelectorAll('[data-lead-action]');
        if (button.disabled) return;
        cardButtons.forEach(function (b) { b.disabled = true; });
        var action = button.getAttribute('data-lead-action');
        var payload = { action: 'decision', opportunityId: card.getAttribute('data-opportunity-id'), decision: action };
        if (action === 'reject') payload.reason = 'poor_match';
        var res = await postJson('/api/owner/lead-intelligence', payload);
        if (!res.data || res.data.ok !== true) {
          setStatus(leadSearchStatus, 'Could not save that decision.', true);
          cardButtons.forEach(function (b) { b.disabled = false; });
          return;
        }
        opportunityRows = opportunityRows.map(function (row) { return row.id === res.data.opportunity.id ? res.data.opportunity : row; });
        renderOpportunities(opportunityRows, currentProviderMode);
        leadRerunBtn.disabled = !opportunityRows.some(function (row) { return row.eligibility && row.eligibility.founderEligible; });
        if (opportunityRows.some(function (row) { return row.state === 'approved'; })) show(leadSalesPracticeBoundary);
      });
    });
  }

  async function handleLeadStart() {
    show(leadSearchControls);
    var res = await postJson('/api/owner/lead-intelligence', { action: 'provider_state' });
    if (!res.data || res.data.ok !== true) { leadProviderState.textContent = 'Provider state unavailable.'; return; }
    leadProviderState.textContent = res.data.provider === 'configured' && res.data.configuredMode === 'google_places'
      ? 'Google Places is configured for live server-side discovery.'
      : 'Live discovery is disabled or not configured. The manual Founder path remains available.';
    if (res.data.fixtureAvailable) {
      show(leadFixtureLabel);
      if (res.data.provider !== 'configured' || res.data.configuredMode !== 'google_places') leadUseFixtures.checked = true;
    }
  }

  async function handleInterpretLocation() {
    leadSearchBtn.disabled = true;
    setStatus(leadLocationResult, 'Interpreting location…');
    var res = await postJson('/api/owner/lead-intelligence', { action: 'interpret_location', location: leadLocation.value, mode: 'locality' });
    if (!res.data || res.data.ok !== true || res.data.location.requiresClarification) {
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
    var res = await postJson('/api/owner/lead-intelligence', {
      action: 'search', location: leadLocation.value, mode: interpretedLocation.mode,
      userApproved: true, providerMode: leadUseFixtures.checked ? 'fixture' : 'live', founderLevel: 'beginner',
    });
    leadSearchBtn.disabled = false;
    if (!res.data || res.data.ok !== true) {
      // A failed search must never leave a previous search's cards on screen looking
      // as though they belong to this (failed) run -- clear the stale funnel/results/context.
      opportunityRows = [];
      currentProviderMode = null;
      leadResults.innerHTML = '';
      leadContext.innerHTML = '';
      leadFunnel.innerHTML = '';
      leadRerunBtn.disabled = true;
      setStatus(leadSearchStatus, res.data && res.data.error === 'provider_not_configured'
        ? 'Live provider unavailable. Founder’s manual discovery mission is still available.'
        : 'Search could not complete. Founder’s manual discovery mission is still available.', true);
      return;
    }
    var counts = res.data.result.counts || {};
    setStatus(leadSearchStatus, 'Found ' + (counts.discovered || 0) + ' candidates and returned ' + (counts.qualified || 0) + ' Qualified Leads at Opportunity Score 30+.');
    leadContext.innerHTML = '<span class="pill not-persisted">' + esc(res.data.ventureContext.label) + '</span>'
      + '<span class="pill">' + esc(res.data.ventureContext.role) + ' · ' + esc(res.data.ventureContext.lifecycleStatus) + '</span>'
      + '<span class="pill">Target: ' + esc(res.data.ventureContext.targetCustomer) + '</span>';
    leadFunnel.innerHTML = '<div class="funnel-grid">'
      + '<div class="score-cell"><strong>' + (counts.discovered || 0) + '</strong><span>Discovered</span></div>'
      + '<div class="score-cell"><strong>' + (counts.afterFiltering || 0) + '</strong><span>Filtered</span></div>'
      + '<div class="score-cell"><strong>' + (counts.cheaplyScored || 0) + '</strong><span>Cheap score</span></div>'
      + '<div class="score-cell"><strong>' + (counts.deeplyResearched || 0) + '</strong><span>Researched</span></div>'
      + '<div class="score-cell"><strong>' + (counts.qualified || 0) + '</strong><span>Qualified Leads (30+)</span></div></div>';
    renderOpportunities(res.data.result.opportunities, res.data.providerMode);
  }

  async function handleFounderRerun() {
    leadRerunBtn.disabled = true;
    var res = await postJson('/api/owner/lead-intelligence', { action: 'rerun_founder' });
    leadRerunBtn.disabled = false;
    if (!res.data || res.data.ok !== true) { setStatus(leadSalesPracticeStatus, 'Approve at least one eligible Qualified Lead first.', true); return; }
    renderMissionResult(res.data.result);
    renderTechnicalDetails(res.data.result.technical || {});
    setStatus(leadSalesPracticeStatus, res.data.outreachActionsUnlocked
      ? 'Founder context updated. A real Sales-Practice Score of 40+ has unlocked outreach.'
      : 'Founder context updated with the Qualified Lead. Outreach remains locked until a real Live Intelligence Sales-Practice Score reaches 40.', false);
  }

  async function handleIntakeSubmit() {
    var goalText = goalInput.value.trim();
    var progressText = progressInput.value.trim();
    if (!goalText) { setStatus(intakeStatus, 'Tell VISION what you are trying to build first.', true); return; }
    intakeSubmitBtn.disabled = true;
    setStatus(intakeStatus, 'Understanding your Founder goal…');
    pendingActions = {};

    var res = await postJson('/api/owner/founder-intake', { goalText: goalText, progressText: progressText });
    intakeSubmitBtn.disabled = false;
    if (res.networkError || !res.data || res.data.ok !== true) {
      setStatus(intakeStatus, 'Could not process that goal. Try again.', true);
      return;
    }
    setStatus(intakeStatus, '');
    latestUnderstood = res.data.understood;
    latestClarifyQuestions = res.data.clarificationQuestions;
    renderUnderstood(latestUnderstood);
    hideAll([step3, step4, step5, step6, leadPanel, leadSearchControls, leadSalesPracticeBoundary, techDetails]);
    show(step2);
    show(actionsRow);

    if (latestClarifyQuestions.length) {
      renderClarifyQuestions(latestClarifyQuestions);
      show(step3);
    } else {
      renderConfirmList(latestUnderstood);
      show(step4);
    }
  }

  async function handleClarifySubmit() {
    var answers = latestClarifyQuestions.map(function (q, i) {
      var input = clarifyQuestionsEl.querySelector('input[data-question-id="' + (q.id || ('q' + i)) + '"]');
      return { questionId: q.id, answerText: input ? input.value.trim() : '' };
    }).filter(function (a) { return a.questionId && a.answerText; });

    if (!answers.length) { setStatus(clarifyStatus, 'Answer at least one question, or leave them for now.', true); }
    clarifySubmitBtn.disabled = true;
    setStatus(clarifyStatus, 'Checking missing context…');

    var res = answers.length
      ? await postJson('/api/owner/founder-clarify', { answers: answers })
      : { data: { ok: true, understood: latestUnderstood, clarificationQuestions: [] } };
    clarifySubmitBtn.disabled = false;
    if (res.networkError || !res.data || res.data.ok !== true) {
      setStatus(clarifyStatus, 'Could not process those answers. Try again.', true);
      return;
    }
    setStatus(clarifyStatus, '');
    latestUnderstood = res.data.understood;
    renderUnderstood(latestUnderstood);
    hideAll([step4, step5, step6, techDetails]);
    renderConfirmList(latestUnderstood);
    show(step4);
  }

  async function handleGenerate() {
    var confirm = [];
    var reject = [];
    var corrections = {};
    Object.keys(pendingActions).forEach(function (key) {
      var action = pendingActions[key];
      if (action.type === 'confirm') confirm.push(key);
      else if (action.type === 'reject') reject.push(key);
      else if (action.type === 'correct' && action.text && action.text.trim()) corrections[key] = action.text.trim();
    });

    generateBtn.disabled = true;
    setStatus(generateStatus, 'Evaluating Founder routes…');

    if (confirm.length || reject.length || Object.keys(corrections).length) {
      var confirmRes = await postJson('/api/owner/founder-confirm', { confirm: confirm, reject: reject, corrections: corrections });
      if (confirmRes.networkError || !confirmRes.data || confirmRes.data.ok !== true) {
        generateBtn.disabled = false;
        setStatus(generateStatus, 'Could not save your confirmations. Try again.', true);
        return;
      }
      latestUnderstood = confirmRes.data.understood;
      pendingActions = {};
    }

    setStatus(generateStatus, 'Comparing possible moves…');
    var res = await postJson('/api/owner/founder-generate', {});
    generateBtn.disabled = false;
    if (res.networkError || !res.data || res.data.ok !== true) {
      setStatus(generateStatus, 'Could not generate Today’s Move. Try again.', true);
      return;
    }
    setStatus(generateStatus, 'Preparing Today’s Move…');

    var result = res.data.result;
    renderMissionResult(result);
    personalizationList.innerHTML = (result.personalization || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('');
    renderTechnicalDetails(result.technical || {});

    setStatus(generateStatus, '');
    show(step5);
    show(step6);
    show(techDetails);
    if (result.decision === 'prerequisite' && result.technical && result.technical.missingPrerequisite === 'Reachable prospects') show(leadPanel);
  }

  async function handleStartOver() {
    await postJson('/api/owner/founder-reset', {});
    goalInput.value = '';
    progressInput.value = '';
    pendingActions = {};
    latestUnderstood = [];
    latestClarifyQuestions = [];
    hideAll([step2, step3, step4, step5, step6, leadPanel, leadSearchControls, leadSalesPracticeBoundary, techDetails, actionsRow]);
    interpretedLocation = null;
    opportunityRows = [];
    leadUseFixtures.checked = false;
    leadRerunBtn.disabled = true;
    setStatus(leadSalesPracticeStatus, 'Live Intelligence integration is not wired in this Lead Intelligence preview.');
    leadResults.innerHTML = '';
    leadContext.innerHTML = '';
    leadFunnel.innerHTML = '';
    currentProviderMode = null;
    setStatus(intakeStatus, '');
    setStatus(clarifyStatus, '');
    setStatus(generateStatus, '');
  }

  intakeSubmitBtn.addEventListener('click', handleIntakeSubmit);
  clarifySubmitBtn.addEventListener('click', handleClarifySubmit);
  generateBtn.addEventListener('click', handleGenerate);
  startOverBtn.addEventListener('click', handleStartOver);
  leadStartBtn.addEventListener('click', handleLeadStart);
  leadInterpretBtn.addEventListener('click', handleInterpretLocation);
  leadSearchBtn.addEventListener('click', handleLeadSearch);
  leadRerunBtn.addEventListener('click', handleFounderRerun);
})();
