/* VISION Universal Live Runtime — the single Live Proof foundation.

   This module owns EVERY reliability primitive the Live pipeline has:
     · one camera manager (singleton stream ownership + stale-request fencing)
     · one model manager (ref-counted load/dispose)
     · one inference loop (adaptive scheduling, pause on background)
     · one evidence queue — ordered, idempotent, retrying, persistent,
       crash-recovering and session-isolating (LiveEvidenceQueue)
     · one retry engine (retry / isRetryableTransportError), shared by the queue
       and by the direct start/finish calls in the controller bridge
     · one tracking-recovery implementation (RecoveryManager)

   There are deliberately no wrappers, prototype patches or "v2/v3/v4" layers on
   top of this file: earlier generations of the transport lived in separate
   scripts that monkey-patched each other, which made ordering and recovery
   behaviour depend on script load timing. Everything now lives here.

   It is dependency-free and unit-testable in Node; browser auto-install is
   fail-soft. The browser never owns proof decisions — this file only guarantees
   that consented evidence reaches the server exactly once, in order. */
(function (root, factory) {
  var api = factory(root || globalThis);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.VISION = root.VISION || {};
    root.VISION.liveRuntime = api;
    try { api.installBrowserGuards(); } catch (_) {}
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var TRANSPORT_VERSION = 'unified-v5';
  var STORAGE_KEY = 'vision.live.evidence.v3';
  var MAX_PERSISTED = 512;
  var MAX_SENT_KEYS = 512;
  var MAX_RECORD_AGE_MS = 30 * 60 * 1000;
  var DEFAULT_MAX_RETRIES = 3;
  var DEFAULT_RETRY_DELAY_MS = 80;
  var MAX_RETRY_DELAY_MS = 1000;

  function nowMs() {
    return root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now();
  }
  function wallClock() { return Date.now(); }
  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, Math.max(0, ms || 0)); });
  }
  function percentile(values, p) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
  }
  function stopStream(stream) {
    try { (stream && stream.getTracks ? stream.getTracks() : []).forEach(function (t) { try { t.stop(); } catch (_) {} }); } catch (_) {}
  }
  function isVideoRequest(constraints) {
    return !!(constraints && constraints.video);
  }
  function errorText(error) {
    return String((error && (error.message || error.error || error.name)) || error || '');
  }

  /* ── the one retry engine ─────────────────────────────────────────────────
     A transport error is retryable; a server decision is not. Everything that
     talks to the Live endpoints (queued evidence, session start, session
     finish) funnels through these two functions so the retry budget, backoff
     curve and retryable-error classification exist exactly once. */
  function isRetryableTransportError(error) {
    var message = errorText(error).toLowerCase();
    return /failed to fetch|network|timeout|timed out|abort|connection|offline|request failed|send a request|502|503|504/.test(message);
  }

  function backoffMs(attempt, baseDelayMs) {
    var base = Number(baseDelayMs);
    if (!Number.isFinite(base) || base <= 0) return 0;
    return Math.min(MAX_RETRY_DELAY_MS, base * Math.pow(2, attempt));
  }

  /* Runs `fn(attempt)` until it resolves or the bounded budget is spent.
     `attempts` counts retries, so attempts=3 means up to 4 calls. */
  async function retry(fn, options) {
    options = options || {};
    var budget = Number(options.attempts);
    budget = Number.isFinite(budget) ? Math.max(0, budget) : DEFAULT_MAX_RETRIES;
    var delay = options.baseDelayMs == null ? DEFAULT_RETRY_DELAY_MS : Number(options.baseDelayMs);
    var shouldRetry = typeof options.shouldRetry === 'function' ? options.shouldRetry : isRetryableTransportError;
    var lastError = null;
    for (var attempt = 0; attempt <= budget; attempt++) {
      try {
        return await fn(attempt);
      } catch (error) {
        lastError = error;
        if (attempt >= budget || !shouldRetry(error)) break;
        var pause = backoffMs(attempt, delay);
        if (pause > 0) await wait(pause);
      }
    }
    throw lastError || new Error('live_transport_failed');
  }

  function CameraManager(options) {
    options = options || {};
    this.mediaDevices = options.mediaDevices || (root.navigator && root.navigator.mediaDevices) || null;
    this.originalGetUserMedia = options.getUserMedia || (this.mediaDevices && this.mediaDevices.getUserMedia && this.mediaDevices.getUserMedia.bind(this.mediaDevices));
    this.activeStream = null;
    this.generation = 0;
    this.listeners = [];
    this.settings = null;
    this.lastError = null;
    this._trackCleanup = null;
  }
  CameraManager.prototype.acquire = async function (constraints) {
    if (!this.originalGetUserMedia) throw new Error('media_devices_unavailable');
    var generation = ++this.generation;
    var previous = this.activeStream;
    var stream;
    try {
      stream = await this.originalGetUserMedia(constraints);
    } catch (error) {
      var retryable = previous && error && (error.name === 'NotReadableError' || error.name === 'AbortError');
      if (!retryable) { this.lastError = error; throw error; }
      stopStream(previous);
      if (this.activeStream === previous) { this.activeStream = null; this._releaseTrack(); }
      stream = await this.originalGetUserMedia(constraints);
    }
    if (generation !== this.generation) {
      stopStream(stream);
      throw new Error('stale_camera_request');
    }
    var videoTrack = stream && stream.getVideoTracks ? stream.getVideoTracks()[0] : null;
    if (!videoTrack || videoTrack.readyState === 'ended') {
      stopStream(stream);
      throw new Error('camera_not_live');
    }
    if (previous && previous !== stream) stopStream(previous);
    this._releaseTrack();
    this.activeStream = stream;
    this.settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
    this._bindTrack(videoTrack, stream);
    return stream;
  };
  /* Track listeners are always released before a new track is bound and on
     stop(), so repeated acquire/flip cycles cannot accumulate handlers. */
  CameraManager.prototype._releaseTrack = function () {
    var release = this._trackCleanup;
    this._trackCleanup = null;
    if (release) { try { release(); } catch (_) {} }
  };
  CameraManager.prototype._bindTrack = function (track, stream) {
    var self = this;
    function ended() { if (self.activeStream === stream) { self.activeStream = null; self._releaseTrack(); self._emit('ended', {}); } }
    function mute() { if (self.activeStream === stream) self._emit('muted', {}); }
    function unmute() { if (self.activeStream === stream) self._emit('unmuted', {}); }
    if (!(track && track.addEventListener)) return;
    track.addEventListener('ended', ended);
    track.addEventListener('mute', mute);
    track.addEventListener('unmute', unmute);
    this._trackCleanup = function () {
      if (!track.removeEventListener) return;
      track.removeEventListener('ended', ended);
      track.removeEventListener('mute', mute);
      track.removeEventListener('unmute', unmute);
    };
  };
  CameraManager.prototype.on = function (fn) { if (typeof fn === 'function') this.listeners.push(fn); return fn; };
  CameraManager.prototype._emit = function (type, payload) { this.listeners.slice().forEach(function (fn) { try { fn(type, payload || {}); } catch (_) {} }); };
  CameraManager.prototype.stop = function () {
    this.generation++;
    this._releaseTrack();
    stopStream(this.activeStream);
    this.activeStream = null;
    this.settings = null;
  };
  CameraManager.prototype.snapshot = function () {
    return { active: !!this.activeStream, generation: this.generation, settings: this.settings || null, lastError: this.lastError ? errorText(this.lastError) : null };
  };

  function ModelManager() {
    this.entries = Object.create(null);
  }
  ModelManager.prototype.acquire = function (key, loader) {
    if (!key || typeof loader !== 'function') return Promise.reject(new Error('invalid_model_request'));
    var entry = this.entries[key];
    if (!entry) {
      entry = this.entries[key] = { refs: 0, value: null, promise: null, error: null, generation: 1 };
      entry.promise = Promise.resolve().then(loader).then(function (value) {
        if (!value) throw new Error('model_loader_returned_empty');
        entry.value = value;
        return value;
      }).catch(function (error) {
        entry.error = error;
        entry.promise = null;
        throw error;
      });
    }
    entry.refs++;
    return entry.value ? Promise.resolve(entry.value) : entry.promise;
  };
  ModelManager.prototype.release = function (key, disposeWhenUnused) {
    var entry = this.entries[key];
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0 && disposeWhenUnused) {
      try { if (entry.value && typeof entry.value.dispose === 'function') entry.value.dispose(); } catch (_) {}
      delete this.entries[key];
    }
  };
  ModelManager.prototype.disposeAll = function () {
    var self = this;
    Object.keys(this.entries).forEach(function (key) {
      var entry = self.entries[key];
      try { if (entry.value && typeof entry.value.dispose === 'function') entry.value.dispose(); } catch (_) {}
      delete self.entries[key];
    });
  };
  ModelManager.prototype.snapshot = function () {
    var result = {};
    Object.keys(this.entries).forEach(function (key) {
      var e = this.entries[key];
      result[key] = { refs: e.refs, ready: !!e.value, loading: !!e.promise && !e.value, error: e.error ? errorText(e.error) : null };
    }, this);
    return result;
  };

  function InferenceLoop(options) {
    options = options || {};
    this.intervalMs = Math.max(16, Number(options.intervalMs) || 200);
    this.mode = options.mode || 'balanced';
    this.running = false;
    this.paused = false;
    this.timer = null;
    this.generation = 0;
    this.frameId = 0;
    this.droppedFrames = 0;
    this.samples = [];
    this.lastTickAt = 0;
  }
  InferenceLoop.prototype.setMode = function (mode) {
    this.mode = ['full', 'balanced', 'low-power'].indexOf(mode) >= 0 ? mode : 'balanced';
    this.intervalMs = this.mode === 'full' ? 100 : this.mode === 'low-power' ? 400 : 200;
  };
  InferenceLoop.prototype.start = function (processor) {
    if (this.running) throw new Error('inference_loop_already_running');
    if (typeof processor !== 'function') throw new Error('inference_processor_required');
    this.running = true;
    this.paused = false;
    var generation = ++this.generation;
    var self = this;
    async function tick() {
      if (!self.running || generation !== self.generation) return;
      if (self.paused) { self.timer = setTimeout(tick, self.intervalMs); return; }
      var scheduled = nowMs();
      if (self.lastTickAt && scheduled - self.lastTickAt > self.intervalMs * 2.5) self.droppedFrames++;
      self.lastTickAt = scheduled;
      var id = ++self.frameId;
      var started = nowMs();
      try { await processor({ frameId: id, scheduledAt: scheduled, generation: generation }); } catch (_) {}
      /* A stop() during the awaited processor must not schedule another tick. */
      if (!self.running || generation !== self.generation) return;
      var elapsed = Math.max(0, nowMs() - started);
      self.samples.push(elapsed);
      if (self.samples.length > 240) self.samples.shift();
      var delay = Math.max(0, self.intervalMs - elapsed);
      self.timer = setTimeout(tick, delay);
    }
    tick();
    return generation;
  };
  InferenceLoop.prototype.pause = function () { this.paused = true; };
  InferenceLoop.prototype.resume = function () { this.paused = false; };
  InferenceLoop.prototype.stop = function () {
    this.running = false;
    this.paused = false;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  };
  InferenceLoop.prototype.metrics = function () {
    var elapsed = this.samples.reduce(function (a, b) { return a + b; }, 0);
    return { running: this.running, paused: this.paused, mode: this.mode, frameId: this.frameId, droppedFrames: this.droppedFrames,
      averageLatencyMs: this.samples.length ? elapsed / this.samples.length : 0, p95LatencyMs: percentile(this.samples, 0.95) };
  };

  /* ── persistence (the one persistence layer) ──────────────────────────────
     sessionStorage, not localStorage: recovery is scoped to the tab that
     captured the evidence, so a reload or a crash restores the queue while a
     new tab never inherits another tab's session. */
  function safeSessionStorage() {
    try {
      var storage = root.sessionStorage;
      if (!storage) return null;
      var probe = '__vision_live_transport_probe__';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return storage;
    } catch (_) { return null; }
  }

  function readPersisted() {
    var storage = safeSessionStorage();
    if (!storage) return [];
    try {
      var parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) return [];
      var cutoff = wallClock() - MAX_RECORD_AGE_MS;
      return parsed.filter(function (entry) {
        return entry && entry.event && entry.event.idempotencyKey && Number(entry.queuedAt || 0) >= cutoff;
      }).slice(-MAX_PERSISTED);
    } catch (_) { return []; }
  }

  function sessionIdOf(record) {
    return String((record && record.event && record.event.sessionId) || '');
  }

  /* ── LiveEvidenceQueue — the one queue ────────────────────────────────────
     Guarantees, in order of importance:
       1. Strict FIFO delivery. A record is only sent when it is at the head, so
          the server never sees sequence N+1 before sequence N.
       2. Idempotency. Records are keyed by `idempotencyKey`; a retry re-sends
          the identical event (same sequence, same payload) and the server
          returns its stored receipt.
       3. Durability. Pending records are written to sessionStorage before every
          delivery attempt and cleared only after acknowledgement, so a reload
          or crash mid-flight resumes rather than loses evidence.
       4. Session isolation. A session that fails permanently is quarantined the
          moment a *different* session enqueues, so one dead session cannot
          block every later session in the same tab.
     The queue never interprets a server decision — a rejected event is a
     failure, and failures stop the head rather than silently skipping it. */
  function LiveEvidenceQueue(options) {
    options = options || {};
    var retries = Number(options.maxRetries);
    var retryDelay = Number(options.retryDelayMs);
    this.sender = typeof options.sender === 'function' ? options.sender : null;
    this.maxRetries = Number.isFinite(retries) ? Math.max(0, retries) : DEFAULT_MAX_RETRIES;
    this.retryDelayMs = Number.isFinite(retryDelay) ? Math.max(0, retryDelay) : DEFAULT_RETRY_DELAY_MS;
    this.shouldRetry = typeof options.shouldRetry === 'function' ? options.shouldRetry : isRetryableTransportError;
    this.records = [];
    this.byKey = Object.create(null);
    this.sentKeys = [];
    this.processing = false;
    this.flushWaiters = [];
    this.queued = 0;
    this.sent = 0;
    this.failed = 0;
    this.restored = 0;
    this.quarantined = 0;
    this.quarantinedSessions = 0;
    this.lastQuarantinedSessionId = null;
    this.lastQuarantineError = null;
    this.lastError = null;
    if (options.persist !== false) this._restore();
  }

  LiveEvidenceQueue.prototype._restore = function () {
    var entries = readPersisted();
    for (var i = 0; i < entries.length; i++) {
      var event = entries[i].event;
      var key = String(event.idempotencyKey);
      if (this.byKey[key]) continue;
      var record = this._record(key, event, Number(entries[i].queuedAt || wallClock()));
      this.byKey[key] = record;
      this.records.push(record);
      this.restored++;
      this.queued++;
    }
  };

  LiveEvidenceQueue.prototype._record = function (key, event, queuedAt) {
    return {
      key: key,
      event: event,
      state: 'queued',
      attempts: 0,
      waiters: [],
      result: null,
      error: null,
      queuedAt: queuedAt == null ? wallClock() : queuedAt
    };
  };

  LiveEvidenceQueue.prototype._persist = function () {
    var storage = safeSessionStorage();
    if (!storage) return;
    try {
      var pending = this.records.slice(-MAX_PERSISTED).map(function (record) {
        return { event: record.event, queuedAt: record.queuedAt || wallClock() };
      });
      if (pending.length) storage.setItem(STORAGE_KEY, JSON.stringify(pending));
      else storage.removeItem(STORAGE_KEY);
    } catch (_) {}
  };

  LiveEvidenceQueue.prototype._rememberSent = function (key) {
    this.sentKeys.push(key);
    while (this.sentKeys.length > MAX_SENT_KEYS) {
      var expired = this.sentKeys.shift();
      var record = this.byKey[expired];
      if (record && record.state === 'sent') delete this.byKey[expired];
    }
  };

  LiveEvidenceQueue.prototype.setSender = function (sender) {
    this.sender = typeof sender === 'function' ? sender : null;
    var head = this.records[0];
    if (this.sender && head && head.state === 'failed' && errorText(head.error) === 'evidence_sender_unavailable') {
      head.state = 'queued';
      head.error = null;
      head.attempts = 0;
    }
    this._pump();
  };

  LiveEvidenceQueue.prototype._waitFor = function (record) {
    return new Promise(function (resolve, reject) { record.waiters.push({ resolve: resolve, reject: reject }); });
  };

  LiveEvidenceQueue.prototype.enqueue = function (event) {
    if (!event || !event.idempotencyKey) return Promise.reject(new Error('idempotency_key_required'));
    this._isolateFailedSession(event);
    var key = String(event.idempotencyKey);
    var record = this.byKey[key];
    if (record && record.state === 'sent') return Promise.resolve(record.result || { status: 'duplicate', idempotencyKey: key });
    if (record) {
      /* An exact retry of a still-pending key rejoins the same record: the
         server must never receive the same key twice concurrently. */
      var rejoined = this._waitFor(record);
      if (record.state === 'failed') {
        record.state = 'queued';
        record.error = null;
        record.attempts = 0;
      }
      this._persist();
      this._pump();
      return rejoined;
    }
    record = this._record(key, event);
    this.byKey[key] = record;
    this.records.push(record);
    this.queued++;
    this._persist();
    var pending = this._waitFor(record);
    this._pump();
    return pending;
  };

  /* One session-isolation implementation, invoked from the single enqueue
     path. A permanently failed head blocks the queue on purpose (ordering);
     that block is only lifted for evidence belonging to a *different* session,
     which proves the failed session has been abandoned. */
  LiveEvidenceQueue.prototype._isolateFailedSession = function (event) {
    var head = this.records[0];
    if (!head || head.state !== 'failed') return 0;
    var failedSessionId = sessionIdOf(head);
    var incomingSessionId = String((event && event.sessionId) || '');
    if (!failedSessionId || !incomingSessionId || failedSessionId === incomingSessionId) return 0;
    return this._quarantineSession(failedSessionId, head.error);
  };

  LiveEvidenceQueue.prototype._quarantineSession = function (sessionId, reason) {
    sessionId = String(sessionId || '');
    if (!sessionId) return 0;
    var self = this;
    var removed = 0;
    var kept = [];
    this.records.forEach(function (record) {
      /* Never drop a record that is mid-flight: the server may still be
         processing it, and cancelling the head here would let the next record
         overtake it. Only settled/queued records are quarantined. */
      if (sessionIdOf(record) !== sessionId || record.state === 'inflight') {
        kept.push(record);
        return;
      }
      removed++;
      record.state = 'quarantined';
      record.error = reason || record.error || new Error('live_session_quarantined');
      record.waiters.splice(0).forEach(function (entry) {
        try { entry.reject(record.error); } catch (_) {}
      });
      if (self.byKey[record.key] === record) delete self.byKey[record.key];
    });
    if (!removed) return 0;
    this.records = kept;
    this.quarantined += removed;
    this.quarantinedSessions++;
    this.lastQuarantinedSessionId = sessionId;
    this.lastQuarantineError = errorText(reason) || 'live_session_quarantined';
    this._persist();
    this._pump();
    return removed;
  };

  LiveEvidenceQueue.prototype._send = function (record) {
    var self = this;
    if (typeof this.sender !== 'function') return Promise.reject(new Error('evidence_sender_unavailable'));
    return retry(function (attempt) {
      record.attempts = attempt + 1;
      return self.sender(record.event, attempt);
    }, {
      attempts: this.maxRetries,
      baseDelayMs: this.retryDelayMs,
      shouldRetry: function (error) { return self.shouldRetry(error); }
    });
  };

  LiveEvidenceQueue.prototype._pump = function () {
    var self = this;
    if (this.processing) return;
    var record = this.records[0];
    if (!record) { this._resolveFlush(); return; }
    if (record.state === 'failed') return;
    this.processing = true;
    record.state = 'inflight';
    this._persist();
    Promise.resolve().then(function () { return self._send(record); }).then(function (result) {
      self.processing = false;
      /* A quarantine can settle while this record is in flight; only mutate the
         queue if this record is still the live head. */
      if (record.state === 'quarantined') { self._persist(); self._pump(); return; }
      record.state = 'sent';
      record.result = result;
      record.error = null;
      self.sent++;
      self.lastError = null;
      record.waiters.splice(0).forEach(function (entry) { entry.resolve(result); });
      if (self.records[0] === record) self.records.shift();
      self._rememberSent(record.key);
      self._persist();
      self._pump();
    }).catch(function (error) {
      self.processing = false;
      if (record.state === 'quarantined') { self._persist(); self._pump(); return; }
      record.state = 'failed';
      record.error = error;
      self.failed++;
      self.lastError = error;
      record.waiters.splice(0).forEach(function (entry) { entry.reject(error); });
      self._persist();
      self.flushWaiters.splice(0).forEach(function (entry) { entry.reject(error); });
    });
  };

  LiveEvidenceQueue.prototype._resolveFlush = function () {
    if (this.records.length) return;
    this._persist();
    var snapshot = this.snapshot();
    this.flushWaiters.splice(0).forEach(function (entry) { entry.resolve(snapshot); });
  };

  LiveEvidenceQueue.prototype.flush = function () {
    var head = this.records[0];
    if (!head) return Promise.resolve(this.snapshot());
    if (head.state === 'failed') {
      head.state = 'queued';
      head.error = null;
      head.attempts = 0;
      this._persist();
    }
    var self = this;
    var pending = new Promise(function (resolve, reject) {
      self.flushWaiters.push({ resolve: resolve, reject: reject });
    });
    this._pump();
    return pending;
  };

  LiveEvidenceQueue.prototype.snapshot = function () {
    var head = this.records[0];
    return {
      transport: TRANSPORT_VERSION,
      queued: this.queued,
      sent: this.sent,
      failed: this.failed,
      restored: this.restored,
      quarantined: this.quarantined,
      quarantinedSessions: this.quarantinedSessions,
      lastQuarantinedSessionId: this.lastQuarantinedSessionId,
      lastQuarantineError: this.lastQuarantineError,
      uniqueEvents: Object.keys(this.byKey).length,
      pending: this.records.length,
      persisted: this.records.length,
      headState: head ? head.state : null,
      lastError: this.lastError ? errorText(this.lastError) : null
    };
  };

  function RecoveryManager(options) {
    options = options || {};
    this.stableMs = Math.max(100, Number(options.stableMs) || 1200);
    this.state = 'tracking';
    this.lostAt = 0;
    this.stableSince = 0;
    this.lossCount = 0;
  }
  RecoveryManager.prototype.update = function (tracked, at) {
    at = at == null ? nowMs() : at;
    if (!tracked) {
      if (this.state !== 'lost') this.lossCount++;
      this.state = 'lost';
      this.lostAt = this.lostAt || at;
      this.stableSince = 0;
      return { state: this.state, canProgress: false, recovered: false };
    }
    if (this.state === 'tracking') return { state: this.state, canProgress: true, recovered: false };
    if (!this.stableSince) this.stableSince = at;
    this.state = 'recovering';
    if (at - this.stableSince >= this.stableMs) {
      this.state = 'tracking';
      this.lostAt = 0;
      this.stableSince = 0;
      return { state: this.state, canProgress: true, recovered: true };
    }
    return { state: this.state, canProgress: false, recovered: false };
  };
  RecoveryManager.prototype.snapshot = function () { return { state: this.state, lossCount: this.lossCount, lostAt: this.lostAt, stableSince: this.stableSince }; };

  function LiveRuntime(options) {
    options = options || {};
    this.camera = options.camera || new CameraManager(options);
    this.models = options.models || new ModelManager();
    this.inference = options.inference || new InferenceLoop(options);
    this.evidence = options.evidence || new LiveEvidenceQueue(options);
    this.recovery = options.recovery || new RecoveryManager(options);
    this.controller = null;
    this.destroyed = false;
  }
  LiveRuntime.prototype.bindController = function (controller) {
    if (this.controller && this.controller !== controller && typeof this.controller.stop === 'function') {
      try { this.controller.stop(); } catch (_) {}
    }
    this.controller = controller || null;
    return controller;
  };
  LiveRuntime.prototype.destroy = function () {
    if (this.destroyed) return;
    this.destroyed = true;
    try { if (this.controller && typeof this.controller.stop === 'function') this.controller.stop(); } catch (_) {}
    this.controller = null;
    this.inference.stop();
    this.camera.stop();
    this.models.disposeAll();
  };
  LiveRuntime.prototype.snapshot = function () {
    return { camera: this.camera.snapshot(), models: this.models.snapshot(), inference: this.inference.metrics(), evidence: this.evidence.snapshot(), recovery: this.recovery.snapshot(), controllerBound: !!this.controller, destroyed: this.destroyed };
  };

  var singleton = null;
  var browserInstalled = false;
  var pageHidden = false;
  var coachPollTimer = null;
  function create(options) { return new LiveRuntime(options || {}); }
  /* A destroyed runtime is replaced, never revived: reusing a torn-down
     singleton was how stale camera/model state leaked across sessions. The
     replacement re-reads persisted evidence, so nothing is lost. */
  function getSingleton() { if (!singleton || singleton.destroyed) singleton = create(); return singleton; }

  /* One camera wrapper. It is re-entrant: if another script replaced
     navigator.mediaDevices.getUserMedia after us we re-wrap the *original*
     raw function rather than stacking a second wrapper on top of ours. */
  function wrapMediaDevices() {
    var md = root.navigator && root.navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') return;
    var current = md.getUserMedia;
    if (current.__visionRuntimeWrapped) return;
    var original = current.__visionOriginal || current.bind(md);
    function managed(constraints) {
      if (!isVideoRequest(constraints)) return original(constraints);
      var runtime = getSingleton();
      runtime.camera.mediaDevices = md;
      runtime.camera.originalGetUserMedia = original;
      return runtime.camera.acquire(constraints);
    }
    managed.__visionRuntimeWrapped = true;
    managed.__visionOriginal = original;
    try { md.getUserMedia = managed; } catch (_) {}
  }

  function wrapLiveCoachWhenReady() {
    var attempts = 0;
    if (coachPollTimer) return;
    coachPollTimer = setInterval(function () {
      attempts++;
      var vision = root.VISION;
      var coach = vision && vision.liveCoach;
      if (coach && typeof coach.create === 'function') {
        clearInterval(coachPollTimer);
        coachPollTimer = null;
        if (coach.create.__visionRuntimeWrapped) return;
        var originalCreate = coach.create;
        var managedCreate = function () {
          var controller = originalCreate.apply(coach, arguments);
          var runtime = getSingleton();
          runtime.bindController(controller);
          if (controller && typeof controller.stop === 'function' && !controller.stop.__visionRuntimeWrapped) {
            var originalStop = controller.stop.bind(controller);
            var stop = function () {
              var result = originalStop();
              if (runtime.controller === controller) runtime.controller = null;
              return result;
            };
            stop.__visionRuntimeWrapped = true;
            controller.stop = stop;
          }
          return controller;
        };
        managedCreate.__visionRuntimeWrapped = true;
        coach.create = managedCreate;
      } else if (attempts >= 200) { clearInterval(coachPollTimer); coachPollTimer = null; }
    }, 50);
  }

  function installBrowserGuards() {
    if (browserInstalled || !root || !root.document) return;
    browserInstalled = true;
    wrapMediaDevices();
    wrapLiveCoachWhenReady();
    root.addEventListener('pagehide', function () {
      pageHidden = true;
      try { if (singleton && !singleton.destroyed) singleton.destroy(); } catch (_) {}
    });
    root.addEventListener('pageshow', function () { pageHidden = false; });
    root.document.addEventListener('visibilitychange', function () {
      /* Never resurrect the singleton from a background/hide event: after
         pagehide there is no live session to pause or resume. */
      if (pageHidden || !singleton || singleton.destroyed) return;
      if (root.document.hidden) singleton.inference.pause(); else singleton.inference.resume();
    });
  }

  return {
    version: 'universal-live-runtime-2',
    transport: TRANSPORT_VERSION,
    CameraManager: CameraManager,
    ModelManager: ModelManager,
    InferenceLoop: InferenceLoop,
    LiveEvidenceQueue: LiveEvidenceQueue,
    RecoveryManager: RecoveryManager,
    LiveRuntime: LiveRuntime,
    create: create,
    getSingleton: getSingleton,
    installBrowserGuards: installBrowserGuards,
    wrapMediaDevices: wrapMediaDevices,
    isRetryableTransportError: isRetryableTransportError,
    retry: retry,
    percentile: percentile,
    STORAGE_KEY: STORAGE_KEY,
    MAX_PERSISTED: MAX_PERSISTED,
    MAX_SENT_KEYS: MAX_SENT_KEYS,
    MAX_RECORD_AGE_MS: MAX_RECORD_AGE_MS
  };
});
