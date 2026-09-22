/* ═══════════════════════════════════════════════════════════════
   li-api.js — Live Intelligence Supabase service layer
   ---------------------------------------------------------------
   The only place in the Live Intelligence frontend that talks to
   Supabase. Every call carries the authenticated user session; the
   anon key is public by design and RLS plus SECURITY DEFINER RPCs are
   the security boundary. No service-role key ever reaches the browser.

   Transport choice: the deployed Edge Functions each ship the VISION
   CORS allowlist (visionproof.app + localhost dev ports), so they are
   called directly. The live-intelligence-workbench gateway is NOT used
   because it emits no Access-Control-Allow-Origin header and therefore
   cannot be reached cross-origin from a Vercel-hosted page.

   Public API: window.VISION.liApi
═══════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  var cfg = window.SUPABASE_CONFIG || {};
  var sb = V.sb || null;

  /* ───────── error model ───────── */

  /* Every failure surfaces as LiError so the view can render an honest
     state instead of guessing from a thrown string. */
  function LiError(code, status, detail) {
    var e = new Error(code);
    e.name = 'LiError';
    e.code = code;
    e.status = status || 0;
    e.detail = detail || null;
    e.retryable = RETRYABLE.indexOf(code) > -1 || status === 429 || status === 502 ||
                  status === 503 || status === 504 || status === 0;
    return e;
  }
  var RETRYABLE = [
    'network_offline', 'network_failed', 'model_timeout', 'route_unavailable',
    'reasoning_unreachable', 'gateway_failed', 'analysis_timeout'
  ];

  /* Map transport + RPC failures onto the states Phase 18 requires. */
  function classify(status, payload) {
    var raw = (payload && (payload.error || payload.message)) || '';
    if (status === 401) return 'auth_expired';
    if (status === 403) return raw === 'origin_not_allowed' ? 'origin_not_allowed' : 'forbidden';
    if (status === 404) return 'not_found';
    if (status === 409) return raw && raw.indexOf('conflict') > -1 ? 'revision_conflict' : 'conflict';
    if (status === 413) return 'file_too_large';
    if (status === 422) return 'unsupported_format';
    if (status === 429) return raw === 'deferred' ? 'quota_reached' : 'rate_limited';
    if (status === 503) return raw === 'route_unavailable' ? 'route_unavailable' : 'provider_unavailable';
    if (status === 504) return 'analysis_timeout';
    if (raw) return String(raw).slice(0, 120);
    return 'request_failed';
  }

  /* Did the Supabase project answer at all? Any response -- success or error
     -- proves the network and the origin are fine. */
  async function projectReachable() {
    try {
      /* /auth/v1/health, not /rest/v1/. PostgREST's root answers 401 without
         a real user JWT, and a 401 makes the browser log an error of its own
         -- noise added by the very code meant to remove noise. The auth health
         endpoint answers 200 to the anon key and carries proper CORS. */
      var r = await fetch(cfg.url + '/auth/v1/health', { headers: { apikey: cfg.anonKey } });
      return !!r;
    } catch (e) { return false; }
  }

  /* ───────── session ───────── */

  function configured() {
    return !!(sb && cfg.url && cfg.anonKey);
  }

  async function getSession() {
    if (!sb) return null;
    try {
      var r = await sb.auth.getSession();
      return (r.data && r.data.session) || null;
    } catch (e) { return null; }
  }

  async function requireSession() {
    var s = await getSession();
    if (!s || !s.access_token) throw LiError('auth_expired', 401);
    return s;
  }

  async function currentUserId() {
    var s = await getSession();
    return s && s.user ? s.user.id : null;
  }

  /* ───────── transport ───────── */

  /* Direct Edge Function call. `signal` lets the caller cancel a stale
     analysis so an older response can never overwrite a newer edit. */
  async function callFunction(slug, action, input, options) {
    if (!configured()) throw LiError('backend_not_configured', 0);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw LiError('network_offline', 0);
    }
    var opts = options || {};
    var session = await requireSession();
    var res;
    try {
      res = await fetch(cfg.url + '/functions/v1/' + slug, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + session.access_token,
          'apikey': cfg.anonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action: action, input: input || {} }),
        signal: opts.signal || null
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw LiError('aborted', 0);
      /* A MISSING EDGE FUNCTION IS INDISTINGUISHABLE FROM A DROPPED
         CONNECTION, unless you ask. Supabase answers an unknown function slug
         with a 404 that carries no CORS headers, so the browser refuses to
         let us read it and reports an opaque network failure -- the same
         thing it reports when the wifi dies. Calling that "the connection was
         interrupted" sent the founder to retry something that will never
         succeed on this deployment.

         So ask the project itself. If REST answers, the network is fine and
         this function simply is not deployed here. One extra request, only
         ever on the failure path. */
      if (await projectReachable()) {
        throw LiError('function_not_deployed', 404, slug);
      }
      throw LiError('network_failed', 0, String(e && e.message || e));
    }

    var payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }

    if (!res.ok) throw LiError(classify(res.status, payload), res.status, payload);
    if (!payload || typeof payload !== 'object') throw LiError('malformed_response', res.status);

    /* Several functions answer 202 for "accepted, still running". That is
       not a success the UI may present as a finished result. */
    if (res.status === 202) {
      return { pending: true, status: payload.status || 'processing', payload: payload };
    }
    if (payload.ok === false) throw LiError(classify(res.status, payload), res.status, payload);
    return payload;
  }

  /* The deployed functions do NOT share one response shape, and reading the
     wrong one is silent: every field comes back `undefined` and the page
     renders an empty / "nothing returned" state while the backend is healthy.
     Both shapes are verified against the deployed source:

       live-intelligence-workspace / -changes / -files
         `json({ ok:true, data }, 200)` — the RPC result is under `data`.

       live-intelligence-runtime
         a gateway that SPREADS the reasoning function's body and appends
         `runtime`. For ask/analyse/understand/clarify that body is
         `{ ok, job_id, data: <persistence result>, result: <model output> }`,
         so `data` is NOT the answer — `result` is. Unwrapping `data` here
         would hand the page the row-count from the apply RPC.

     unwrapEnvelope is therefore applied per endpoint, never globally. */
  function unwrapEnvelope(payload) {
    if (payload && payload.pending === true) return payload;
    if (payload && payload.ok === true && Object.prototype.hasOwnProperty.call(payload, 'data')) {
      return payload.data;
    }
    return payload;
  }
  function enveloped(promise) { return Promise.resolve(promise).then(unwrapEnvelope); }

  /* Reasoning results, normalised into one shape the view can switch on.
     `pending` is a real backend state (202 already_processing / retry_scheduled)
     and must never be presented as a finished answer. */
  function reasoning(promise) {
    return Promise.resolve(promise).then(function (payload) {
      if (payload && payload.pending === true) {
        return { pending: true, status: payload.status || 'processing', result: null, jobId: null };
      }
      return {
        pending: false,
        status: (payload && payload.status) || 'complete',
        result: (payload && payload.result) || null,
        jobId: (payload && payload.job_id) || null,
        runtime: (payload && payload.runtime) || null
      };
    });
  }

  /* SECURITY DEFINER RPC through supabase-js (session attached by the client). */
  async function callRpc(name, args) {
    if (!configured()) throw LiError('backend_not_configured', 0);
    await requireSession();
    var r = await sb.rpc(name, args || {});
    if (r.error) {
      var code = r.error.code === '42501' ? 'forbidden'
               : r.error.code === 'P0002' ? 'not_found'
               : r.error.code === '22023' ? 'invalid_request'
               : String(r.error.message || 'rpc_failed').slice(0, 120);
      throw LiError(code, r.error.code === '42501' ? 403 : 400, r.error);
    }
    return r.data;
  }

  /* ───────── workspaces (Phase 3) ───────── */

  var api = {};

  api.LiError = LiError;
  api.configured = configured;
  api.getSession = getSession;
  api.currentUserId = currentUserId;
  api.callFunction = callFunction;
  api.callRpc = callRpc;

  /* Resolves to the bare array live_intelligence_list_workspaces returns. */
  api.listWorkspaces = function (opts) {
    var o = opts || {};
    return enveloped(callFunction('live-intelligence-workspace', 'list', {
      include_archived: !!o.includeArchived,
      limit: o.limit || 50,
      offset: o.offset || 0
    })).then(function (d) { return Array.isArray(d) ? d : []; });
  };

  /* Workspaces are linked to a task through live_intelligence_workspaces
     .linked_task_id. list_workspaces does NOT select that column, so the
     list alone can never answer "is there already a workspace for this
     task?" — read the column directly instead. RLS on that table is
     (user_id = auth.uid()), so this stays owner-scoped. */
  api.findWorkspaceForTask = async function (taskId) {
    if (!taskId) return null;
    if (!configured()) throw LiError('backend_not_configured', 0);
    await requireSession();
    var result = await sb.from('live_intelligence_workspaces')
      .select('id,last_opened_at')
      .eq('linked_task_id', taskId)
      .is('deleted_at', null)
      .neq('status', 'archived')
      .order('last_opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error) {
      var status = result.error.code === '42501' ? 403 : 400;
      throw LiError(status === 403 ? 'forbidden' : 'workspace_lookup_failed', status, result.error);
    }
    return result.data && result.data.id ? result.data.id : null;
  };

  /* Resolves to { workspace_id, document_id, setup_status, status }.
     There is no `id` key — the RPC names it workspace_id. */
  api.createWorkspace = function (input) {
    return enveloped(callFunction('live-intelligence-workspace', 'create', {
      task_description: input.taskDescription,
      desired_outcome: input.desiredOutcome || null,
      title: input.title || null,
      linked_task_id: input.taskId || input.linkedTaskId || null,
      feedback_intensity: input.feedbackIntensity || 'balanced'
    }));
  };

  /* v2 is the single bootstrap read: workspace + state + documents +
     attachments + issues + messages + versions + changes + resolved goal
     relationship + any linked proof-improvement session. */
  api.getWorkspace = function (workspaceId, messageLimit) {
    return callRpc('live_intelligence_get_workspace_v2', {
      p_workspace_id: workspaceId,
      p_message_limit: messageLimit || 50
    });
  };

  api.updateWorkspace = function (workspaceId, patch) {
    return enveloped(callFunction('live-intelligence-workspace', 'update', {
      workspace_id: workspaceId,
      title: patch.title || null,
      desired_outcome: patch.desiredOutcome || null,
      feedback_intensity: patch.feedbackIntensity || null,
      user_level_override: patch.userLevelOverride || null
    }));
  };

  api.renameWorkspace = function (workspaceId, title) {
    return api.updateWorkspace(workspaceId, { title: title });
  };

  api.archiveWorkspace = function (workspaceId, archive) {
    return enveloped(callFunction('live-intelligence-workspace', 'archive', {
      workspace_id: workspaceId,
      archive: archive !== false
    }));
  };

  /* ───────── goal relationship (Phase 13) ───────── */

  api.resolveGoalRelationship = function (workspaceId) {
    return callRpc('live_intelligence_resolve_goal_relationship_v1', { p_workspace_id: workspaceId });
  };

  api.setGoalRelationship = function (workspaceId, relationship, disableGoalContext) {
    return callRpc('live_intelligence_set_goal_relationship_v1', {
      p_workspace_id: workspaceId,
      p_relationship: relationship,
      p_disable_goal_context: !!disableGoalContext
    });
  };

  /* ───────── documents (Phase 4) ───────── */

  /* Resolves to { status:'saved'|'unchanged', revision, document_id }.
     A stale expected_revision is NOT a resolved value: the function answers
     409 and this rejects with code 'revision_conflict', carrying the server's
     current revision on `serverRevision` so the caller can resync instead of
     guessing. content_format defaults to null so the server keeps the
     document's existing format — declaring 'markdown' while writing HTML
     mislabels the stored row for every later reader. */
  api.autosave = function (input) {
    return enveloped(callFunction('live-intelligence-workspace', 'autosave', {
      workspace_id: input.workspaceId,
      document_id: input.documentId,
      content: input.content,
      expected_revision: input.expectedRevision,
      content_format: input.contentFormat || null,
      checkpoint_reason: input.checkpointReason || null,
      checkpoint_source: input.checkpointSource || 'user'
    })).catch(function (e) {
      if (e && e.code === 'revision_conflict') {
        var d = e.detail && e.detail.data;
        e.serverRevision = d && d.server_revision != null ? d.server_revision : null;
      }
      throw e;
    });
  };

  api.createCheckpoint = function (input) {
    return enveloped(callFunction('live-intelligence-workspace', 'checkpoint', {
      workspace_id: input.workspaceId,
      document_id: input.documentId,
      reason: input.reason,
      label: input.label || null,
      source: input.source || 'manual'
    }));
  };

  api.listVersions = function (workspaceId, documentId, limit) {
    return enveloped(callFunction('live-intelligence-changes', 'versions', {
      workspace_id: workspaceId,
      document_id: documentId,
      limit: limit || 30
    }));
  };

  api.restoreVersion = function (input) {
    return callRpc('live_intelligence_restore_document_version_v1', {
      p_document_id: input.documentId,
      p_version_id: input.versionId,
      p_expected_revision: input.expectedRevision
    });
  };

  /* ───────── analysis (Phase 7) ───────── */

  /* Resolves to { pending, status, result, jobId }. On success `result` is the
     validated analysis contract:
       { work_summary, strengths:[{title,evidence}], issues:[…], delivery }
     The runtime NEVER receives the document body from here — it reads the
     saved revision server-side, so an unsaved edit is deliberately not
     analysed. Callers must autosave first. */
  api.analyse = function (input, signal) {
    return reasoning(callFunction('live-intelligence-runtime', 'analyse', {
      workspace_id: input.workspaceId,
      document_id: input.documentId || null,
      section_id: input.sectionId || null,
      depth: input.depth || 'fast',
      focus_text: input.focusText || null,
      query_text: input.queryText || null,
      force: !!input.force
    }, { signal: signal }));
  };

  /* `result.understanding.needs_clarification` + `clarification_question` is
     how a workspace created without a desired outcome gets out of
     setup_status='needs_clarification'. Until it does, analyse answers 400
     needs_clarification. */
  api.understand = function (workspaceId, signal) {
    return reasoning(callFunction('live-intelligence-runtime', 'understand', {
      workspace_id: workspaceId
    }, { signal: signal }));
  };

  api.clarify = function (workspaceId, answer, signal) {
    return reasoning(callFunction('live-intelligence-runtime', 'clarify', {
      workspace_id: workspaceId, answer: answer
    }, { signal: signal }));
  };

  /* ───────── ask (Phase 9) ───────── */

  /* result = { answer, next_action, confidence, used_context, grounding_refs } */
  api.ask = function (input, signal) {
    return reasoning(callFunction('live-intelligence-runtime', 'ask', {
      workspace_id: input.workspaceId,
      document_id: input.documentId || null,
      section_id: input.sectionId || null,
      question: input.question,
      focus_text: input.focusText || null
    }, { signal: signal }));
  };

  /* ───────── issues (Phase 10) ───────── */

  /* Backend-defined actions only: start_addressing | dismiss_for_now |
     dont_show_again | reopen. issue_state returns the plain {ok,data}
     envelope — it never reaches a model, so there is no `result`. */
  api.setIssueState = function (issueId, issueAction, reason) {
    return enveloped(callFunction('live-intelligence-runtime', 'issue_state', {
      issue_id: issueId, issue_action: issueAction, reason: reason || null
    }));
  };

  api.quietIssue = function (issueId, reason) {
    return api.setIssueState(issueId, 'dismiss_for_now', reason);
  };

  /* ───────── change proposals (Phase 11) ───────── */

  /* Resolves to { status:'previewed', proposal:{id,…}, meaning_contract }
     or { status:'existing', proposal_id, meaning_contract }. */
  api.previewChange = function (input) {
    return enveloped(callFunction('live-intelligence-changes', 'preview', {
      issue_id: input.issueId,
      expected_revision: input.expectedRevision,
      client_request_id: input.clientRequestId || null
    }));
  };

  /* Resolves to { status:'applied'|'blocked'|'manual_only'|…, revision, … }.
     A non-'applied' status is a real server decision (e.g. the meaning
     contract refused the edit) and must be surfaced, not treated as success. */
  api.applyChange = function (proposalId, expectedRevision) {
    return enveloped(callFunction('live-intelligence-changes', 'apply', {
      proposal_id: proposalId, expected_revision: expectedRevision
    }));
  };

  api.undoChange = function (proposalId, expectedRevision) {
    return enveloped(callFunction('live-intelligence-changes', 'undo', {
      proposal_id: proposalId, expected_revision: expectedRevision
    }));
  };

  api.rejectChange = function (proposalId, reason) {
    return enveloped(callFunction('live-intelligence-changes', 'reject', {
      proposal_id: proposalId, reason: reason || null
    }));
  };

  api.changeHistory = function (workspaceId, documentId, limit) {
    return enveloped(callFunction('live-intelligence-changes', 'history', {
      workspace_id: workspaceId, document_id: documentId || null, limit: limit || 30
    }));
  };

  /* ───────── realtime state (Phase 6) ───────── */

  api.realtimeState = function (workspaceId, documentId) {
    return enveloped(callFunction('live-intelligence-realtime', 'state', {
      workspace_id: workspaceId, document_id: documentId
    }));
  };

  api.editSignal = function (input) {
    return enveloped(callFunction('live-intelligence-realtime', 'signal', input));
  };

  /* ───────── attachments (Phase 5) ───────── */

  /* Authoritative allowlist, mirrored from live_intelligence_register_attachment_v2.
     Video and audio are deliberately absent: the media route reports
     video_enabled=false and its provider secret is not configured. */
  api.ATTACHMENT_LIMITS = {
    maxBytes: 52428800,
    image: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    file: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain', 'text/markdown', 'application/msword', 'application/rtf',
      'image/jpeg', 'image/png', 'image/webp'
    ],
    videoEnabled: false
  };

  /* Private path contract enforced server-side: {user_id}/{workspace_id}/... */
  api.buildObjectPath = function (userId, workspaceId, filename) {
    var safe = String(filename || 'upload')
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(-120);
    return userId + '/' + workspaceId + '/' + Date.now() + '-' +
           Math.random().toString(36).slice(2, 8) + '-' + safe;
  };

  api.uploadAttachmentObject = async function (objectPath, file) {
    if (!configured()) throw LiError('backend_not_configured', 0);
    await requireSession();
    var r = await sb.storage.from('live-intelligence').upload(objectPath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false
    });
    if (r.error) throw LiError('upload_failed', 0, r.error.message);
    return r.data;
  };

  api.registerAttachment = function (input) {
    return callRpc('live_intelligence_register_attachment_v2', {
      p_workspace_id: input.workspaceId,
      p_object_path: input.objectPath,
      p_original_filename: input.filename,
      p_mime_type: input.mimeType,
      p_size_bytes: input.sizeBytes,
      p_attachment_kind: input.kind,
      p_metadata: input.metadata || {}
    });
  };

  api.queueAttachmentProcessing = function (attachmentId, force) {
    return callRpc('live_intelligence_queue_attachment_processing_v1', {
      p_attachment_id: attachmentId, p_force: !!force
    });
  };

  /* The queue RPC only enqueues. This Edge Function actually performs the
     extraction, so "Ready" is never shown for an unprocessed attachment.

     NOT enveloped: the deployed live-intelligence-files bundle could not be
     read back from the platform, so its response shape is UNVERIFIED. These
     two are unused by live-intelligence.html; leave them raw rather than
     assert a contract nobody has confirmed. Verify before wiring them up. */
  api.processAttachment = function (attachmentId, retry) {
    return callFunction('live-intelligence-files', retry ? 'retry' : 'process', {
      attachment_id: attachmentId
    });
  };

  api.attachmentStatus = function (attachmentId) {
    return callFunction('live-intelligence-files', 'status', {
      attachment_id: attachmentId, include_content: false
    });
  };

  api.retryAttachment = function (attachmentId) {
    return callRpc('live_intelligence_retry_attachment_v1', { p_attachment_id: attachmentId });
  };

  api.removeAttachment = function (attachmentId) {
    return callRpc('live_intelligence_remove_attachment_v1', { p_attachment_id: attachmentId });
  };

  /* Short-lived signed URL. Never a permanent public URL. */
  api.signedAttachmentUrl = async function (objectPath, seconds) {
    if (!configured()) throw LiError('backend_not_configured', 0);
    await requireSession();
    var r = await sb.storage.from('live-intelligence')
      .createSignedUrl(objectPath, seconds || 300);
    if (r.error) throw LiError('signed_url_failed', 0, r.error.message);
    return r.data && r.data.signedUrl;
  };

  /* ───────── proof improvement (Phase 14) ───────── */

  api.createProofImprovementSession = function (input) {
    return callRpc('live_intelligence_create_proof_improvement_session_v1', {
      p_proof_id: input.proofId,
      p_improvement_objective: input.objective || null,
      p_retry_allowed: typeof input.retryAllowed === 'boolean' ? input.retryAllowed : null,
      p_retry_recommended: typeof input.retryRecommended === 'boolean' ? input.retryRecommended : null,
      p_retry_window_ends_at: input.retryWindowEndsAt || null
    });
  };

  api.getProofImprovementSession = function (sessionId) {
    return callRpc('live_intelligence_get_proof_improvement_session_v1', { p_session_id: sessionId });
  };

  api.moveOnFromImprovement = function (sessionId) {
    return callRpc('live_intelligence_move_on_from_improvement_v1', { p_session_id: sessionId });
  };

  /* ───────── usage / ops ───────── */

  api.myUsage = function () {
    return callRpc('live_intelligence_get_my_runtime_usage', {});
  };

  api.recordWritingFeedback = function (input) {
    return callRpc('live_intelligence_record_writing_feedback', {
      p_suggested_text: input.suggestedText,
      p_action: input.action,
      p_workspace_id: input.workspaceId || null,
      p_document_id: input.documentId || null,
      p_issue_id: input.issueId || null,
      p_original_text: input.originalText || null,
      p_final_text: input.finalText || null,
      p_voice_match_rating: input.voiceMatchRating || null,
      p_reason_code: input.reasonCode || null,
      p_metadata: input.metadata || {}
    });
  };

  V.liApi = api;
})(window.VISION);
