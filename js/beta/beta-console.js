/* Vision Beta Console — owner-only review of public Live Proof beta sessions.
   Authorisation is server-side: every read/write goes through SECURITY DEFINER
   RPCs gated by public.is_owner(). A non-owner who signs in gets 'not authorized'
   and sees nothing. Replays telemetry (pose/coach summaries) — never raw video. */
(function () {
  'use strict';
  var CFG = window.SUPABASE_CONFIG || {};
  var sb = (window.supabase && CFG.url && CFG.anonKey)
    ? window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;
  var $ = function (id) { return document.getElementById(id); };
  var SESSIONS = [];

  function rpc(name, args) { return sb.rpc(name, args || {}); }

  // ── auth ──────────────────────────────────────────────────────────────────
  function showDash(on) { $('auth').style.display = on ? 'none' : ''; $('dash').style.display = on ? '' : 'none'; }
  function signIn() {
    var err = $('authErr'); err.textContent = '';
    sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value })
      .then(function (r) {
        if (r.error) { err.textContent = r.error.message; return; }
        boot();
      });
  }
  function signOut() { sb.auth.signOut().then(function () { location.reload(); }); }

  function boot() {
    // gate on is_owner via a real owner RPC; non-owners get 42501
    rpc('beta_owner_summary').then(function (r) {
      if (r.error) {
        if (/not authorized|42501/i.test(r.error.message || '')) {
          $('authErr').textContent = 'This account is not a beta owner.';
          sb.auth.signOut(); showDash(false); return;
        }
        $('authErr').textContent = r.error.message; return;
      }
      showDash(true);
      renderSummary(r.data);
      loadInvitesFilters();
      loadSessions();
    });
  }

  // ── summary ─────────────────────────────────────────────────────────────────
  function tile(v, k, cls) { return '<div class="tile glass"><div class="v ' + (cls || '') + '">' + v + '</div><div class="k">' + k + '</div></div>'; }
  function renderSummary(s) {
    s = s || {};
    var html = tile(s.total_sessions || 0, 'sessions')
      + tile(s.completed || 0, 'completed', 'good')
      + tile((s.abandoned || 0) + (s.failed || 0), 'failed / left', 'warn')
      + tile(s.false_accepts || 0, 'false accepts', 'bad')
      + tile(s.false_rejects || 0, 'false rejects', 'bad')
      + tile(s.avg_confidence != null ? Math.round(s.avg_confidence * 100) + '%' : '—', 'avg conf')
      + tile(s.avg_fps != null ? s.avg_fps : '—', 'avg fps')
      + tile((s.invites && s.invites.active) || 0, 'active invites');
    $('tiles').innerHTML = html;
    // exercise filter options
    var fx = $('fExercise'), have = fx.value;
    var opts = ['<option value="">All exercises</option>'];
    Object.keys(s.by_exercise || {}).forEach(function (k) { opts.push('<option value="' + k + '">' + k + ' (' + s.by_exercise[k] + ')</option>'); });
    fx.innerHTML = opts.join(''); fx.value = have;
    var fd = $('fDevice'), hd = fd.value, dopts = ['<option value="">All devices</option>'];
    Object.keys(s.by_device || {}).forEach(function (k) { dopts.push('<option value="' + k + '">' + k + '</option>'); });
    fd.innerHTML = dopts.join(''); fd.value = hd;
  }

  // ── sessions table ───────────────────────────────────────────────────────────
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function fmtWhen(t) { if (!t) return '—'; var d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
  function detected(s) {
    if (s.mode === 'hold') return Math.round((s.hold_ms || 0) / 1000) + 's / ' + s.target_value + 's';
    if (s.mode === 'duration') return Math.round((s.valid_duration_ms || 0) / 1000) + 's / ' + s.target_value + 's';
    return (s.detected_reps || 0) + ' / ' + s.target_value;
  }
  function loadSessions() {
    rpc('beta_owner_sessions', {
      p_exercise: $('fExercise').value || null, p_device: $('fDevice').value || null,
      p_only_failures: $('fFail').checked, p_sort: $('fSort').value, p_limit: 500
    }).then(function (r) {
      if (r.error) return;
      SESSIONS = r.data || [];
      var rows = SESSIONS.map(function (s, i) {
        return '<tr class="row" data-i="' + i + '">'
          + '<td class="muted">' + fmtWhen(s.created_at) + '</td>'
          + '<td>' + esc(s.exercise) + '</td>'
          + '<td><span class="badge b-' + s.completion_status + '">' + s.completion_status.replace('_', ' ') + '</span></td>'
          + '<td>' + detected(s) + '</td>'
          + '<td>' + (s.confidence != null ? Math.round(s.confidence * 100) + '%' : '—') + '</td>'
          + '<td>' + (s.fps != null ? Math.round(s.fps) : '—') + '</td>'
          + '<td>' + (s.tracking_loss || 0) + '</td>'
          + '<td class="muted">' + esc(s.device || '—') + '</td>'
          + '<td class="muted">' + esc(s.browser || '—') + '</td>'
          + '<td>' + (s.owner_label ? '<span class="lbl lbl-' + s.owner_label + '">' + s.owner_label.replace('_', ' ') + '</span>' : '') + '</td>'
          + '</tr>';
      }).join('');
      $('rows').innerHTML = rows;
      $('empty').style.display = SESSIONS.length ? 'none' : '';
      $('count').textContent = SESSIONS.length + ' session' + (SESSIONS.length === 1 ? '' : 's');
      Array.prototype.forEach.call(document.querySelectorAll('tr.row'), function (tr) {
        tr.addEventListener('click', function () { openDrawer(SESSIONS[+tr.getAttribute('data-i')]); });
      });
    });
  }

  // ── drawer + telemetry replay ────────────────────────────────────────────────
  var replayTimer = null;
  function openDrawer(s) {
    if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
    var cam = s.camera_quality || {};
    var html = '<span class="close" id="drawerClose">✕</span>'
      + '<h2>' + esc(s.exercise) + ' · <span class="muted">' + esc(s.title) + '</span></h2>'
      + '<div class="muted" style="font-size:12px">' + fmtWhen(s.created_at) + ' · session ' + esc(String(s.id).slice(0, 8)) + '</div>'
      + '<div class="kv">'
      + kv('Result', s.completion_status.replace('_', ' '))
      + kv('Detected', detected(s))
      + kv('Confidence', s.confidence != null ? Math.round(s.confidence * 100) + '%' : '—')
      + kv('Rejected reps', s.rejected_reps || 0)
      + kv('Inference FPS', (cam.inference_fps != null ? cam.inference_fps : (s.fps != null ? Math.round(s.fps) : '—')))
      + kv('Camera FPS', cam.camera_fps != null ? cam.camera_fps : '—')
      + kv('Latency p50 / p95', (cam.latency_p50_ms != null ? cam.latency_p50_ms : (s.latency_ms != null ? Math.round(s.latency_ms) : '—')) + ' / ' + (cam.latency_p95_ms != null ? cam.latency_p95_ms : '—') + 'ms')
      + kv('Tracking loss', s.tracking_loss || 0)
      + kv('Embedded browser', esc(cam.embedded_browser || 'no'))
      + kv('Camera', (cam.width || '?') + '×' + (cam.height || '?') + ' ' + (cam.orientation || ''))
      + kv('Device / OS', esc((s.device || '?') + ' · ' + (s.os || '?')))
      + kv('Browser', esc(s.browser || '—'))
      + kv('Verifier', esc((s.verifier_id || '—') + ' v' + (s.verifier_version || '?')))
      + kv('Failure', esc(s.failure_reason || '—'))
      + '</div>'
      + '<div class="section-t">Telemetry replay <span class="muted">(pose &amp; coaching — no video)</span></div>'
      + '<div class="replay">'
      + '<div class="rp-hud"><span class="rp-dot" id="rpDot"></span><span class="rp-reps" id="rpReps">0</span><div class="rp-bar"><i id="rpFill"></i></div></div>'
      + '<input class="rp-scrub" id="rpScrub" type="range" min="0" max="0" value="0" />'
      + '<div class="rp-meta"><span id="rpPhase">—</span><span id="rpTime">0.0s</span></div>'
      + '<div style="margin-top:8px;display:flex;gap:8px"><button class="btn sm" id="rpPlay">▶ Play</button><span class="muted" id="rpInfo" style="align-self:center;font-size:12px"></span></div>'
      + '</div>'
      + '<div class="section-t">Owner label</div>'
      + '<div class="labelbtns">'
      + labelBtn(s, 'valid', 'Valid') + labelBtn(s, 'false_accept', 'False accept')
      + labelBtn(s, 'false_reject', 'False reject') + labelBtn(s, 'invalid', 'Invalid') + '</div>'
      + '<input id="ownerNote" placeholder="Note (optional)" style="width:100%;margin-top:10px" value="' + esc(s.owner_note || '') + '" />'
      + '<div class="section-t">Diagnostics bundle</div>'
      + '<div class="diag" id="diagJson">' + esc(JSON.stringify(s.telemetry && s.telemetry.evidence || s.telemetry || {}, null, 1)).slice(0, 6000) + '</div>';
    $('panel').innerHTML = html;
    $('drawer').classList.add('on');
    $('drawerClose').addEventListener('click', closeDrawer);
    Array.prototype.forEach.call(document.querySelectorAll('[data-label]'), function (b) {
      b.addEventListener('click', function () { setLabel(s.id, b.getAttribute('data-label')); });
    });
    loadReplay(s.id);
  }
  function kv(k, v) { return '<div><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
  function labelBtn(s, val, txt) { return '<button class="btn ' + (s.owner_label === val ? '' : 'ghost') + ' sm" data-label="' + val + '">' + txt + '</button>'; }
  function closeDrawer() { if (replayTimer) clearInterval(replayTimer); replayTimer = null; $('drawer').classList.remove('on'); }

  function setLabel(id, label) {
    rpc('beta_owner_label', { p_session_id: id, p_label: label, p_note: ($('ownerNote') && $('ownerNote').value) || null })
      .then(function (r) { if (!r.error) { loadSessions(); rpc('beta_owner_summary').then(function (x) { if (!x.error) renderSummary(x.data); }); var s = SESSIONS.filter(function (x) { return x.id === id; })[0]; if (s) { s.owner_label = label; openDrawer(s); } } });
  }

  function loadReplay(id) {
    rpc('beta_owner_session_events', { p_session_id: id }).then(function (r) {
      var ev = (r.error ? [] : r.data) || [];
      var scrub = $('rpScrub'), info = $('rpInfo');
      if (!ev.length) { info.textContent = 'No telemetry stream recorded.'; return; }
      scrub.max = ev.length - 1;
      info.textContent = ev.length + ' events over ' + (ev[ev.length - 1].t_ms ? Math.round(ev[ev.length - 1].t_ms / 1000) : '?') + 's';
      function apply(i) {
        var e = ev[i] || {}, p = e.payload || {};
        $('rpReps').textContent = p.reps != null ? p.reps : (p.progress != null ? p.progress + '%' : '—');
        $('rpFill').style.width = (p.progress || 0) + '%';
        $('rpDot').className = 'rp-dot' + (p.tracking ? ' on' : '');
        $('rpPhase').textContent = e.type + (p.phase ? ' · ' + p.phase : '');
        $('rpTime').textContent = ((e.t_ms || 0) / 1000).toFixed(1) + 's';
      }
      apply(0);
      scrub.addEventListener('input', function () { if (replayTimer) { clearInterval(replayTimer); replayTimer = null; $('rpPlay').textContent = '▶ Play'; } apply(+scrub.value); });
      $('rpPlay').addEventListener('click', function () {
        if (replayTimer) { clearInterval(replayTimer); replayTimer = null; $('rpPlay').textContent = '▶ Play'; return; }
        $('rpPlay').textContent = '❚❚ Pause';
        replayTimer = setInterval(function () {
          var v = (+scrub.value + 1);
          if (v > +scrub.max) { clearInterval(replayTimer); replayTimer = null; $('rpPlay').textContent = '▶ Play'; return; }
          scrub.value = v; apply(v);
        }, 320);
      });
    });
  }

  // ── invites ──────────────────────────────────────────────────────────────────
  function loadInvitesFilters() {}
  function inviteBtn() {
    rpc('beta_owner_list_invites').then(function (r) {
      var list = (r.error ? [] : r.data) || [];
      var rows = list.map(function (v) {
        var link = location.origin + '/beta/live?invite=…';
        return '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06)">'
          + '<div><div style="font-weight:600">' + esc(v.label || '(no label)') + '</div>'
          + '<div class="muted" style="font-size:12px">' + v.uses + '/' + v.max_uses + ' used · ' + (v.usable ? 'active' : 'inactive')
          + (v.expires_at ? ' · exp ' + fmtWhen(v.expires_at) : '') + '</div></div>'
          + (v.usable ? '<button class="btn ghost sm" data-revoke="' + v.id + '">Revoke</button>' : '') + '</div>';
      }).join('');
      $('panel').innerHTML = '<span class="close" id="drawerClose">✕</span><h2>Beta invites</h2>'
        + '<div style="display:flex;gap:8px;margin:14px 0;flex-wrap:wrap">'
        + '<input id="invLabel" placeholder="Label (who is it for)" style="flex:1;min-width:140px" />'
        + '<input id="invUses" type="number" value="25" min="1" style="width:80px" title="max uses" />'
        + '<input id="invHours" type="number" value="336" min="1" style="width:90px" title="expiry hours" />'
        + '<button class="btn sm" id="invCreate">Create</button></div>'
        + '<div id="invLink" class="diag" style="display:none"></div>'
        + '<div class="section-t">Existing</div>' + (rows || '<div class="muted">None yet.</div>');
      $('drawer').classList.add('on');
      $('drawerClose').addEventListener('click', closeDrawer);
      $('invCreate').addEventListener('click', function () {
        rpc('beta_owner_create_invite', { p_label: $('invLabel').value || null, p_max_uses: +$('invUses').value || 1, p_expires_in_hours: +$('invHours').value || 168 })
          .then(function (x) {
            if (x.error) { alert(x.error.message); return; }
            var link = location.origin + '/beta/live?invite=' + x.data.invite_token;
            var box = $('invLink'); box.style.display = ''; box.textContent = link;
            navigator.clipboard && navigator.clipboard.writeText(link).catch(function () {});
            inviteBtn();
          });
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-revoke]'), function (b) {
        b.addEventListener('click', function () { rpc('beta_owner_revoke_invite', { p_invite_id: b.getAttribute('data-revoke') }).then(inviteBtn); });
      });
    });
  }

  // ── export ────────────────────────────────────────────────────────────────────
  function exportCsv() {
    if (!SESSIONS.length) return;
    var cols = ['created_at', 'exercise', 'completion_status', 'detected_reps', 'rejected_reps', 'hold_ms', 'valid_duration_ms', 'target_value', 'confidence', 'fps', 'latency_ms', 'tracking_loss', 'device', 'os', 'browser', 'verifier_id', 'verifier_version', 'failure_reason', 'owner_label', 'id'];
    var csv = [cols.join(',')].concat(SESSIONS.map(function (s) {
      return cols.map(function (c) { var v = s[c]; v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    })).join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'vision-beta-sessions-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  // ── init ────────────────────────────────────────────────────────────────────
  function init() {
    if (!sb) { $('authErr').textContent = 'Backend not configured for this host.'; return; }
    $('signinBtn').addEventListener('click', signIn);
    $('password').addEventListener('keydown', function (e) { if (e.key === 'Enter') signIn(); });
    $('signoutBtn').addEventListener('click', signOut);
    $('refreshBtn').addEventListener('click', function () { boot(); });
    $('exportBtn').addEventListener('click', exportCsv);
    $('inviteBtn').addEventListener('click', inviteBtn);
    ['fExercise', 'fDevice', 'fSort'].forEach(function (id) { $(id).addEventListener('change', loadSessions); });
    $('fFail').addEventListener('change', loadSessions);
    $('drawer').addEventListener('click', function (e) { if (e.target === $('drawer')) closeDrawer(); });
    sb.auth.getSession().then(function (r) { if (r.data && r.data.session) boot(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
