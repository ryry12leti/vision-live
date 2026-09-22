(function () {
  'use strict';

  var config = window.SUPABASE_CONFIG || {};
  var client = window.supabase && config.url && config.anonKey
    ? window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
    : null;
  var $ = function (id) { return document.getElementById(id); };
  var task = null;
  var upload = null;
  var controller = null;
  var previewUrl = null;
  var retryAction = null;
  var operationSignature = null;
  var operationKey = null;
  var MAX_BYTES = 250 * 1024 * 1024;
  var ALLOWED_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];

  function setProgress(label, percent) {
    percent = Math.max(0, Math.min(100, Number(percent) || 0));
    $('progress').textContent = label;
    $('bar').style.width = percent + '%';
    document.querySelector('[role=progressbar]').setAttribute('aria-valuenow', String(Math.round(percent)));
  }

  function message(value, isError) {
    $('result').textContent = value;
    $('result').className = 'state' + (isError ? ' error' : '');
  }

  function fingerprint(value) {
    var hash = 2166136261;
    for (var i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function selectedFile() {
    return $('reviewFile').files && $('reviewFile').files[0];
  }

  function validateFile() {
    var file = selectedFile();
    if (!file) throw new Error('Choose a video.');
    if (ALLOWED_MIMES.indexOf(file.type) < 0) throw new Error('Use MP4, MOV or WebM.');
    if (file.size < 1 || file.size > MAX_BYTES) throw new Error('Video exceeds the 250 MiB limit.');
    return file;
  }

  function idempotencyKey(file) {
    var signature = [task && task.id, file.name, file.size, file.type, file.lastModified || 0].join(':');
    if (signature !== operationSignature) {
      operationSignature = signature;
      var storageName = 'vision.video-review.' + fingerprint(signature);
      try { operationKey = sessionStorage.getItem(storageName); } catch (error) {}
      if (!operationKey) {
        operationKey = 'upload-' + crypto.randomUUID();
        try { sessionStorage.setItem(storageName, operationKey); } catch (error) {}
      }
    }
    return operationKey;
  }

  function deviceFamily() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios_safari';
    if (/Android/i.test(ua)) return 'android_chrome';
    if (/Mac/i.test(ua) && /Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'desktop_safari';
    if (/Chrome/i.test(ua)) return 'desktop_chrome';
    return 'unknown';
  }

  function invoke(name, body) {
    return client.functions.invoke(name, { body: body }).then(function (result) {
      if (result.error || (result.data && result.data.error)) {
        throw new Error((result.data && result.data.error) || (result.error && result.error.message) || name + '_failed');
      }
      return result.data || {};
    });
  }

  function readMetadata(file) {
    return new Promise(function (resolve, reject) {
      var video = document.createElement('video');
      var objectUrl = URL.createObjectURL(file);
      var settled = false;
      var timer = setTimeout(function () { fail('Video codec is not supported by this browser.'); }, 15000);
      function clean() {
        clearTimeout(timer);
        URL.revokeObjectURL(objectUrl);
        video.removeAttribute('src');
        video.load();
      }
      function fail(reason) {
        if (settled) return;
        settled = true;
        clean();
        reject(new Error(reason));
      }
      video.onloadedmetadata = function () {
        if (settled) return;
        settled = true;
        var metadata = {
          duration_ms: Math.round(video.duration * 1000),
          width: video.videoWidth,
          height: video.videoHeight,
          fps: null
        };
        clean();
        if (!Number.isFinite(metadata.duration_ms) || metadata.duration_ms < 1000 || metadata.duration_ms > 900000 ||
            metadata.width < 120 || metadata.width > 7680 || metadata.height < 120 || metadata.height > 4320) {
          reject(new Error('Video metadata is outside supported limits.'));
        } else {
          resolve(metadata);
        }
      };
      video.onerror = function () { fail('Video codec is not supported by this browser.'); };
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;
    });
  }

  function uploadResumable(file, reservation, signal) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      function finish(callback, value) {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        callback(value);
      }
      function abort() {
        if (!upload) return finish(reject, new DOMException('Cancelled', 'AbortError'));
        upload.abort(true).finally(function () {
          finish(reject, new DOMException('Cancelled', 'AbortError'));
        });
      }
      signal.addEventListener('abort', abort, { once: true });
      upload = new tus.Upload(file, {
        endpoint: reservation.resumable_endpoint,
        retryDelays: [0, 2000, 5000, 10000],
        headers: { 'x-signature': reservation.upload_token },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: 6 * 1024 * 1024,
        metadata: {
          bucketName: reservation.bucket,
          objectName: reservation.path,
          contentType: file.type,
          cacheControl: '3600'
        },
        onProgress: function (sent, total) {
          setProgress('Uploading private video…', total ? sent / total * 85 : 0);
        },
        onError: function (error) { finish(reject, new Error(error.message || 'upload_failed')); },
        onSuccess: function () { finish(resolve); }
      });
      upload.findPreviousUploads().then(function (previous) {
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch(function (error) { finish(reject, error); });
    });
  }

  function stateCopy(asset, decision) {
    if (decision === 'approved') return 'Approved by an authorised reviewer. The server applied the task decision exactly once.';
    if (decision === 'rejected') return 'Rejected by an authorised reviewer. The reason and diagnostics remain available for audit.';
    if (decision === 'unsupported') return 'Unsupported: this clip requires evidence the active verifier cannot establish.';
    if (!asset) return 'No video submitted for this task.';
    if (asset.status === 'reserved') return 'Uploading: a resumable private upload is reserved.';
    if (asset.status === 'uploaded' || asset.status === 'analysing') return 'Processing: the private upload is being checked.';
    if (asset.status === 'pending_review' || asset.status === 'analysed') return 'Needs review: no XP or task completion has been awarded.';
    if (asset.status === 'reviewed') return 'Approved by an authorised reviewer.';
    if (asset.status === 'rejected') return 'Rejected by an authorised reviewer.';
    if (asset.status === 'failed') return 'Upload or processing failed. Choose the video and retry.';
    if (asset.status === 'deleted') return 'The submitted video has been deleted.';
    return 'Uploaded: awaiting authoritative processing.';
  }

  async function refreshSubmissionState() {
    if (!task) return;
    var assets = await client.from('proof_video_assets')
      .select('id,status,created_at')
      .eq('task_id', task.id)
      .eq('purpose', 'user_video_proof')
      .order('created_at', { ascending: false })
      .limit(1);
    if (assets.error) throw assets.error;
    var asset = assets.data && assets.data[0];
    var decision = null;
    if (asset) {
      var decisions = await client.from('proof_video_review_decisions')
        .select('decision,reason,decided_at')
        .eq('asset_id', asset.id)
        .maybeSingle();
      if (decisions.error) throw decisions.error;
      decision = decisions.data && decisions.data.decision;
    }
    message(stateCopy(asset, decision), false);
  }

  async function submit() {
    if (!task || controller) return;
    controller = new AbortController();
    $('submit').disabled = true;
    $('cancel').disabled = false;
    $('retry').disabled = true;
    retryAction = submit;
    try {
      var file = validateFile();
      var metadata = await readMetadata(file);
      var reservation = await invoke('video-proof-upload', {
        task_id: task.id,
        capability_id: task.capability,
        purpose: 'user_video_proof',
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        capture_source: 'uploaded',
        device_family: deviceFamily(),
        consent_to_training: false,
        ground_truth: {},
        metadata: {
          last_modified: file.lastModified || 0,
          browser_device: deviceFamily(),
          environment: 'unknown',
          camera_position: 'unknown',
          lighting: 'unknown',
          people_count: 0,
          rotation_degrees: 0,
          source: 'task_video_review'
        },
        idempotency_key: idempotencyKey(file)
      });
      await uploadResumable(file, reservation, controller.signal);
      setProgress('Verifying stored object…', 90);
      await invoke('video-proof-finalize', {
        asset_id: reservation.asset_id,
        duration_ms: metadata.duration_ms,
        width: metadata.width,
        height: metadata.height,
        fps: null
      });
      setProgress('Needs review', 100);
      await refreshSubmissionState();
    } catch (error) {
      var cancelled = error && error.name === 'AbortError';
      setProgress(cancelled ? 'Cancelled' : 'Upload stopped', 0);
      message(cancelled ? 'Upload cancelled. You can retry safely.' : String(error.message || error), true);
      $('retry').disabled = false;
    } finally {
      upload = null;
      controller = null;
      $('cancel').disabled = true;
      $('submit').disabled = !task;
    }
  }

  function showPreview(file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    $('preview').src = previewUrl;
    $('preview').hidden = false;
    message('Ready to upload ' + file.name + '.', false);
  }

  async function boot() {
    try {
      if (!client) throw new Error('Backend unavailable.');
      var taskId = new URLSearchParams(location.search).get('task');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId || '')) {
        throw new Error('Open Video Review Proof from an eligible VISION task.');
      }
      var session = await client.auth.getSession();
      if (!session.data.session) throw new Error('Sign in to Vision first.');
      var result = await client.from('daily_tasks')
        .select('id,title,video_review_eligible,video_review_retention_days,activation_status,proof_contract,proof_contract_v3')
        .eq('id', taskId)
        .maybeSingle();
      if (result.error || !result.data) throw new Error('Task not found.');
      var capability = (result.data.proof_contract_v3 && result.data.proof_contract_v3.capability_id) ||
        (result.data.proof_contract && result.data.proof_contract.capability_id);
      if (!result.data.video_review_eligible || !capability || ['active', 'queued'].indexOf(result.data.activation_status) < 0) {
        throw new Error('This task is not eligible for uploaded Video Review Proof.');
      }
      task = { id: result.data.id, capability: capability };
      $('taskState').textContent = result.data.title + ' · private retention ' + result.data.video_review_retention_days + ' days · authoritative review required';
      $('submit').disabled = false;
      await refreshSubmissionState();
    } catch (error) {
      $('taskState').textContent = 'Unavailable';
      message(String(error.message || error), true);
    }
  }

  $('reviewFile').addEventListener('change', function () {
    try { showPreview(validateFile()); } catch (error) { message(error.message, true); }
  });
  $('reviewDrop').addEventListener('dragover', function (event) { event.preventDefault(); });
  $('reviewDrop').addEventListener('drop', function (event) {
    event.preventDefault();
    if (!event.dataTransfer.files[0]) return;
    var transfer = new DataTransfer();
    transfer.items.add(event.dataTransfer.files[0]);
    $('reviewFile').files = transfer.files;
    $('reviewFile').dispatchEvent(new Event('change'));
  });
  $('submit').addEventListener('click', submit);
  $('cancel').addEventListener('click', function () { if (controller) controller.abort(); });
  $('retry').addEventListener('click', function () { if (retryAction) retryAction(); });
  window.addEventListener('pagehide', function () {
    if (controller) controller.abort();
    if (upload) upload.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
  boot();
})();
