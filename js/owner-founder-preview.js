/* ═══════════════════════════════════════════════════════════════
   owner-founder-preview.js — Founder Goal Engine owner shadow preview.

   Read-only. Every network call from THIS FILE goes only to same-origin
   API routes (/api/owner/founder-preview, /api/owner/destroy) -- never
   directly to any Supabase project. This page is only ever served (by
   api/owner/preview-page.mjs) after the server has already validated the
   fp_session HttpOnly cookie -- there is no login form, no bearer token,
   and nothing auth-related in this file or in localStorage/sessionStorage.
   The cookie itself is HttpOnly, so this script cannot read it either.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var selectedFixture = 'complete';
  var destroyed = false;

  var runPanel = document.getElementById('run-panel');
  var resultPanel = document.getElementById('result-panel');
  var runBtn = document.getElementById('run-btn');
  var statusLine = document.getElementById('status-line');
  var destroyBtn = document.getElementById('destroy-access');
  var buildShaEl = document.getElementById('build-sha');
  var envIndicatorEl = document.getElementById('env-indicator');

  var RUN_ERROR_MESSAGES = {
    invalid_session: 'Your preview session expired. Open a fresh access link.',
    owner_credential_not_configured: 'The preview owner credential is not configured on this deployment.',
    not_authorized: 'This account is not authorized as the Founder Goal Engine owner.',
    invalid_fixture: 'Unknown fixture selected.',
    fixture_not_configured: 'This fixture is not configured on this deployment.',
    preview_backend_unreachable: 'Could not reach the preview backend. Try again.',
    timeout: 'The Founder Goal Engine did not respond in time.',
    malformed_response: 'The Founder Goal Engine returned an unreadable response.',
    function_error: 'The Founder Goal Engine reported an internal error.',
    unexpected_status: 'The Founder Goal Engine returned an unexpected response.',
    not_found: 'This preview is not enabled on this deployment.',
    invalid_json: 'Malformed request.',
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function redactedRef(url) {
    var m = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i.exec(url || '');
    if (!m) return 'unconfigured';
    var ref = m[1];
    return ref.length > 8 ? ref.slice(0, 4) + '…' + ref.slice(-4) : ref;
  }

  function initTopbarMeta() {
    var runtime = window.VISION_RUNTIME || {};
    buildShaEl.textContent = runtime.commit ? ('build ' + runtime.commit) : 'build unknown';
    var ref = window.SUPABASE_CONFIG ? redactedRef(window.SUPABASE_CONFIG.url) : 'unconfigured';
    envIndicatorEl.textContent = (runtime.env || 'unknown') + ' • backend ' + ref;
  }

  async function postJson(url, body) {
    var resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      });
    } catch (e) {
      return { networkError: true };
    }
    var data = null;
    try { data = await resp.json(); } catch (e) { /* leave null */ }
    return { status: resp.status, data: data };
  }

  function lockOut(message) {
    destroyed = true;
    runBtn.disabled = true;
    destroyBtn.disabled = true;
    resultPanel.classList.add('hidden');
    resultPanel.innerHTML = '';
    runPanel.classList.add('hidden');
    statusLine.textContent = '';
    var banner = document.createElement('div');
    banner.className = 'banner';
    banner.textContent = message;
    document.querySelector('main').prepend(banner);
  }

  async function handleDestroy() {
    if (destroyed) return;
    if (!window.confirm('Destroy preview access? This immediately revokes the current session and cannot be undone.')) return;
    destroyBtn.disabled = true;
    await postJson('/api/owner/destroy', {});
    lockOut('Preview access destroyed. Reloading this page will not restore it.');
  }

  function selectFixture(el) {
    document.querySelectorAll('.fixture-opt').forEach(function (n) { n.classList.remove('selected'); });
    el.classList.add('selected');
    selectedFixture = el.getAttribute('data-fixture');
  }

  function renderRouteList(eligible, blocked) {
    var html = '';
    (eligible || []).forEach(function (routeId) {
      html += '<div class="route-item"><span class="pill eligible">Eligible</span>' + esc(humanizeRouteId(routeId)) + '</div>';
    });
    (blocked || []).forEach(function (b) {
      html += '<div class="route-item"><span class="pill blocked">Not available</span>' + esc(humanizeRouteId(b.route_id))
        + '<div class="route-reason">' + esc(b.reason || '') + '</div></div>';
    });
    return html;
  }

  function humanizeRouteId(routeId) {
    var map = {
      founder_customer_interview_set: 'Customer interviews',
      founder_sales_outreach_block: 'Sales outreach',
      founder_offer_test: 'Offer test',
      founder_product_delivery_slice: 'Product delivery',
      founder_retention_analysis: 'Retention analysis',
      founder_operating_process: 'Operating process',
      founder_strategy_decision: 'Strategy decision',
    };
    return map[routeId] || 'Founder route';
  }

  function renderComplete(result) {
    var move = result.founder_todays_move || {};
    var bottleneck = result.founder_bottleneck_intelligence || {};
    var mission = result.founder_mission_comparison || {};
    var context = result.founder_execution_context || {};
    var entities = result.founder_execution_entities || {};
    var fvs = result.founder_venture_state || {};
    var primary = fvs.primary || {};
    var snapshot = primary.snapshot || {};

    var html = '';

    html += '<div class="result-section"><h3>Today’s Move</h3>';
    if (move.status === 'selected') {
      html += '<div class="kv"><dt>Title</dt><dd>' + esc(move.title) + '</dd></div>';
      html += '<div class="kv"><dt>Mission</dt><dd>' + esc(move.missionStatement) + '</dd></div>';
      html += '<div class="kv"><dt>Completion definition</dt><dd>' + esc(move.completionDefinition) + '</dd></div>';
      html += '<div class="kv"><dt>Required evidence</dt><dd>' + esc((move.requiredEvidence || []).join('; ')) + '</dd></div>';
      html += '<div class="kv"><dt>Expected outcome</dt><dd>' + esc(move.expectedBusinessOutcome) + '</dd></div>';
      html += '<div class="kv"><dt>Confidence</dt><dd>' + esc(move.confidence) + '</dd></div>';
    } else {
      html += '<p>No mission selected (status: ' + esc(move.status) + ').</p>';
    }
    html += '<span class="pill not-persisted">Not persisted — persisted_task_id is null</span>';
    html += '</div>';

    html += '<div class="result-section"><h3>Why This Move</h3>';
    html += '<div class="kv"><dt>Selected bottleneck</dt><dd>' + esc(bottleneck.primary_bottleneck && bottleneck.primary_bottleneck.label) + '</dd></div>';
    html += '<div class="kv"><dt>Explanation</dt><dd>' + esc(bottleneck.primary_bottleneck && bottleneck.primary_bottleneck.reason) + '</dd></div>';
    html += '<div class="kv"><dt>Why now</dt><dd>' + esc(move.whyNow) + '</dd></div>';
    html += '</div>';

    html += '<div class="result-section"><h3>Eligible Founder Routes (' + ((context.eligible_routes || []).length) + ' of 7 eligible)</h3>';
    html += renderRouteList(context.eligible_routes, context.blocked_routes);
    html += '</div>';

    html += '<div class="result-section"><h3>Candidate Comparison</h3>';
    html += '<div class="kv"><dt>Candidates compared</dt><dd>' + esc(mission.candidate_count) + '</dd></div>';
    html += '<div class="kv"><dt>Selection confidence</dt><dd>' + esc(mission.selection_confidence) + '</dd></div>';
    html += '<div class="kv"><dt>Selection explanation</dt><dd>' + esc(move.selectionExplanation) + '</dd></div>';
    if (move.rejectedAlternativeSummaries && move.rejectedAlternativeSummaries.length) {
      html += '<ul class="plain">';
      move.rejectedAlternativeSummaries.forEach(function (s) { html += '<li>' + esc(s) + '</li>'; });
      html += '</ul>';
    }
    html += '</div>';

    html += '<div class="result-section"><h3>Venture Context Summary</h3>';
    html += '<div class="kv"><dt>Stage</dt><dd>' + esc(snapshot.stage && snapshot.stage.value) + '</dd></div>';
    html += '<div class="kv"><dt>Current goal</dt><dd>' + esc(snapshot.currentGoal && snapshot.currentGoal.value) + '</dd></div>';
    html += '<div class="kv"><dt>Current priorities</dt><dd>' + esc((snapshot.currentPriorities && snapshot.currentPriorities.value || []).join('; ')) + '</dd></div>';
    html += '<div class="kv"><dt>Customer evidence</dt><dd>' + esc(snapshot.customerEvidence && snapshot.customerEvidence.value && snapshot.customerEvidence.value.notes) + '</dd></div>';
    html += '<div class="kv"><dt>Prospect count</dt><dd>' + esc(entities.customer_entity_count) + '</dd></div>';
    html += '</div>';

    html += '<div class="result-section"><h3>Technical Verification</h3>';
    html += '<div class="kv"><dt>Bridge attached</dt><dd>' + esc(fvs.bridge && fvs.bridge.attached) + '</dd></div>';
    html += '<div class="kv"><dt>Routes evaluated</dt><dd>7</dd></div>';
    html += '<div class="kv"><dt>persisted_task_id</dt><dd>null</dd></div>';
    html += '<div class="kv"><dt>State</dt><dd>read-only, nothing written</dd></div>';
    html += '<div class="kv"><dt>Execution context version</dt><dd>' + esc(context.contract_version) + '</dd></div>';
    html += '<div class="kv"><dt>Entity bundle version</dt><dd>' + esc(entities.contract_version) + '</dd></div>';
    html += '<details><summary>Raw diagnostic response (developer only)</summary><pre>' + esc(JSON.stringify(result, null, 2)) + '</pre></details>';
    html += '</div>';

    return html;
  }

  function renderSparse(result) {
    var move = result.founder_todays_move || {};
    var fvs = result.founder_venture_state || {};

    var html = '';
    html += '<div class="result-section"><h3>Context Needed</h3>';
    html += '<p>VISION did not have enough trusted context to select a mission for this venture, and refused to invent one.</p>';
    html += '<div class="kv"><dt>Status</dt><dd>' + esc(move.status) + '</dd></div>';
    html += '<div class="kv"><dt>Bridge attached</dt><dd>' + esc(fvs.bridge && fvs.bridge.attached) + '</dd></div>';
    if (move.clarificationQuestions && move.clarificationQuestions.length) {
      html += '<p>Clarification questions (' + move.clarificationQuestions.length + '):</p><ul class="plain">';
      move.clarificationQuestions.forEach(function (q) { html += '<li>' + esc(q) + '</li>'; });
      html += '</ul>';
    }
    html += '<span class="pill not-persisted">Not persisted — persisted_task_id is null</span>';
    html += '<details><summary>Raw diagnostic response (developer only)</summary><pre>' + esc(JSON.stringify(result, null, 2)) + '</pre></details>';
    html += '</div>';
    return html;
  }

  async function handleRun() {
    if (destroyed) return;
    runBtn.disabled = true;
    statusLine.textContent = 'Running Founder analysis — contacting the Founder Goal Engine…';
    statusLine.className = '';
    resultPanel.classList.add('hidden');
    resultPanel.innerHTML = '';

    var res = await postJson('/api/owner/founder-preview', { fixture: selectedFixture });
    runBtn.disabled = false;

    if (res.networkError) {
      statusLine.textContent = 'Network error contacting this deployment.';
      statusLine.className = 'err';
      return;
    }
    if (!res.data || res.data.ok !== true) {
      var code = res.data && res.data.error;
      statusLine.textContent = (code && RUN_ERROR_MESSAGES[code]) || ('Request failed (status ' + res.status + ').');
      statusLine.className = 'err';
      if (code === 'invalid_session') lockOut('Preview access expired. Open a fresh access link.');
      return;
    }

    statusLine.textContent = '';
    var result = res.data.result;
    resultPanel.innerHTML = res.data.fixture === 'sparse' ? renderSparse(result) : renderComplete(result);
    resultPanel.classList.remove('hidden');
  }

  destroyBtn.addEventListener('click', handleDestroy);
  runBtn.addEventListener('click', handleRun);
  document.querySelectorAll('.fixture-opt').forEach(function (el) {
    el.addEventListener('click', function () { selectFixture(el); });
  });

  initTopbarMeta();
})();
