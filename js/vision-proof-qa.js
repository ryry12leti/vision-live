/* VISION owner-only proof diagnostics controller.
 * Query parameters request the UI; VISION.proofQaAuthorized (set from the
 * authenticated server RPC) is the sole production authority.
 * Exports are recursively sanitised and never contain tokens, profiles or raw
 * media/landmark payloads. */
(function (root) {
  'use strict';

  var panel = null;
  var body = null;
  var actions = { restartVerifier: null, restartCalibration: null };
  var blockedKey = /(?:access|refresh)?token|password|secret|service.?role|anon.?key|authorization|cookie|email|profile|raw.?media|(?:audio|image|video).?data|blob|bytes|landmarks?|keypoints?/i;
  var secretValue = /(?:bearer\s+|service[_-]?role|sb_(?:secret|publishable)_|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.)/i;

  function defaults() {
    return {
      common: {
        environment: '—', build_commit: '—', backend_ref: '—', task_id: '—',
        contract_version: '—', modality: '—', verifier: '—', session_ref: '—',
        final_server_result: '—', rejection_reason: '—'
      },
      live: {
        pose_model_state: 'idle', pose_model_version: 'MoveNet singlepose-lightning-v4',
        fps: '—', inference_latency_ms: '—', camera_resolution: '—', orientation: '—',
        selected_body_side: '—', view_classification: '—', landmark_visibility_summary: '—',
        setup_state: '—', calibration_state: '—', phase: '—', accepted_count: 0,
        rejected_count: 0, last_rejection_reason: '—', tracking_state: '—',
        coaching_reason: '—', integrity_status: '—', equipment_verification_status: '—'
      },
      voice: {
        microphone_state: 'idle', recorded_duration_ms: 0, speaking_duration_ms: '—',
        silence_ratio: '—', audio_size: 0, audio_type: '—', transcription_status: '—',
        freshness_challenge: '—', semantic_rubric_score: '—', replay_dedup_status: '—',
        final_result: '—'
      },
      photo: {
        source: '—', dimensions: '—', mime: '—', size: 0,
        perceptual_hash_result: '—', exact_hash_duplicate_result: '—',
        freshness_challenge: '—', required_evidence: '—', model_confidence: '—',
        final_result: '—'
      },
      health: { status: 'not loaded' }
    };
  }

  var state = defaults();

  function requested() {
    try {
      var q = new URLSearchParams(root.location.search);
      return q.get('proof_qa') === '1' && q.get('diag') === '1';
    } catch (_) { return false; }
  }

  function authorised() {
    if (!requested()) return false;
    if (root.VISION && root.VISION.proofQaAuthorized === true) return true;
    return /^(localhost|127\.0\.0\.1)$/.test(root.location.hostname || '') && root.VISION_QA_TEST_AUTHORIZED === true;
  }

  function cloneSafe(value, depth) {
    if (depth > 6 || value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return secretValue.test(value) ? '[redacted]' : value.slice(0, 500);
    if (Array.isArray(value)) return value.slice(0, 50).map(function (v) { return cloneSafe(v, depth + 1); });
    if (typeof value !== 'object') return String(value).slice(0, 500);
    var out = {};
    Object.keys(value).slice(0, 100).forEach(function (key) {
      if (!blockedKey.test(key)) out[key] = cloneSafe(value[key], depth + 1);
    });
    return out;
  }

  function safeSnapshot() {
    return cloneSafe({ schema: 'vision-proof-diagnostics-v1', generated_at: new Date().toISOString(), diagnostics: state }, 0);
  }

  function shortId(value) {
    var s = String(value || '');
    return s ? s.slice(0, 8) : '—';
  }

  function merge(section, values) {
    if (!state[section] || !values || typeof values !== 'object') return;
    Object.keys(values).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(state[section], key) && !blockedKey.test(key)) {
        state[section][key] = cloneSafe(values[key], 0);
      }
    });
    render();
  }

  function setTask(task, modality) {
    task = task || {};
    var contract = task.proofContract || task.proof_contract || {};
    var id = (root.VISION && root.VISION.envIdentity) || {};
    var verifierId = contract.verifier_id || contract.verifierId || '—';
    var verifierVersion = contract.verifier_version || contract.verifierVersion || contract.version || '—';
    merge('common', {
      environment: id.env || 'local', build_commit: id.commit || '—', backend_ref: id.ref || '—',
      task_id: shortId(task.id), contract_version: task.proofContractVersion || task.proof_contract_version || contract.contract_version || '—',
      modality: modality || contract.proof_type || task.recommendedProofType || task.recommended_proof_type || 'photo',
      verifier: verifierId + ' v' + verifierVersion, session_ref: shortId(root.VISION && root.VISION.currentProofSessionId)
    });
  }

  function button(text, fn) {
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = text;
    b.style.cssText = 'pointer-events:auto;border:1px solid #3d4d78;background:#151b31;color:#dce5ff;border-radius:6px;padding:5px 7px;font:600 10px system-ui;cursor:pointer';
    b.addEventListener('click', fn); return b;
  }

  async function copy() {
    var text = JSON.stringify(safeSnapshot(), null, 2);
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
  }

  function download() {
    var blob = new Blob([JSON.stringify(safeSnapshot(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'vision-proof-diagnostics-' + Date.now() + '.json'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  async function loadHealth() {
    state.health = { status: 'loading' }; render();
    try {
      var report = await root.VISION.api.proofHealthReport(7);
      state.health = report && !report.error ? cloneSafe(report, 0) : { status: 'error', reason: String((report && report.error) || 'rpc_error').slice(0, 120) };
    } catch (_) { state.health = { status: 'error', reason: 'rpc_error' }; }
    render();
  }

  function clear() { state = defaults(); try { localStorage.removeItem('vision_proof_qa_diagnostics'); } catch (_) {} render(); }

  function renderSection(name, data) {
    var rows = Object.keys(data).map(function (key) { return key + ': ' + (data[key] == null ? '—' : String(data[key])); });
    return '[' + name.toUpperCase() + ']\n' + rows.join('\n');
  }

  function render() {
    if (!body) return;
    var modality = String(state.common.modality || '').toLowerCase();
    var sections = [renderSection('common', state.common)];
    if (state[modality]) sections.push(renderSection(modality, state[modality]));
    if (state.health && state.health.status !== 'not loaded') sections.push('[HEALTH]\n' + JSON.stringify(state.health, null, 1));
    body.textContent = sections.join('\n\n');
  }

  function mount() {
    if (!authorised() || panel) return false;
    panel = document.createElement('aside');
    panel.id = 'visionProofQaPanel'; panel.setAttribute('data-vision-proof-qa', 'true');
    panel.style.cssText = 'pointer-events:none;position:fixed;right:10px;top:70px;z-index:2147483640;width:min(390px,calc(100vw - 20px));max-height:70vh;overflow:auto;background:rgba(8,11,23,.96);color:#c9d6ff;border:1px solid #34446f;border-radius:10px;box-shadow:0 16px 48px rgba(0,0,0,.45);padding:10px;font:500 10.5px/1.45 ui-monospace,Menlo,monospace;text-align:left';
    var title = document.createElement('div'); title.textContent = 'VISION · OWNER PROOF QA'; title.style.cssText = 'font:700 11px system-ui;letter-spacing:.1em;margin-bottom:8px;color:#fff';
    var controls = document.createElement('div'); controls.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px';
    controls.appendChild(button('Copy diagnostics', copy));
    controls.appendChild(button('Download JSON', download));
    controls.appendChild(button('Clear local', clear));
    controls.appendChild(button('Health report', loadHealth));
    controls.appendChild(button('Restart verifier', function () { if (actions.restartVerifier) actions.restartVerifier(); }));
    controls.appendChild(button('Restart calibration', function () { if (actions.restartCalibration) actions.restartCalibration(); }));
    body = document.createElement('pre'); body.style.cssText = 'margin:0;white-space:pre-wrap;overflow-wrap:anywhere';
    panel.appendChild(title); panel.appendChild(controls); panel.appendChild(body); document.body.appendChild(panel); render();
    return true;
  }

  function destroy() { if (panel) panel.remove(); panel = null; body = null; }
  function setActions(next) { actions = Object.assign(actions, next || {}); }

  root.VISION = root.VISION || {};
  root.VISION.proofQa = {
    requested: requested, authorised: authorised, mount: mount, destroy: destroy,
    update: merge, setTask: setTask, setActions: setActions, snapshot: safeSnapshot,
    shortId: shortId, clear: clear
  };
})(window);
