/* ════════════════════════════════════════════════════════════════════════
   REAL MICROPHONE → OPENAI REALTIME TRANSCRIPTION, over WebRTC.

   TRANSCRIPTION ONLY. Nothing here calls call_assist: this step exists to
   prove the audio transport and the transcript quality on their own, so that
   when cognition is wired to it later a bad answer can only be a cognition
   problem. The peer connection is deliberately receive-nothing — no audio
   track is added in the answer direction and no response is ever requested,
   so there is no path by which VISION could speak on a live call.

   THE BROWSER NEVER SEES THE PERMANENT PROVIDER KEY. It asks VISION for a
   short-lived client secret, which VISION mints server-side and which expires
   in ten minutes. That ephemeral secret is the only credential in this file.

   (Deliberately not naming the server-side key variable here: the public
   build scans every shipped file for that literal and refuses to publish one
   that contains it. The guard is blunt on purpose, and it caught this comment
   on the first deploy — which is exactly the behaviour you want from it.)
   ══════════════════════════════════════════════════════════════════════ */
(function (V) {
  'use strict';

  var api = {};
  window.VISION_TRANSCRIBE = api;

  var DELTA = 'conversation.item.input_audio_transcription.delta';
  var COMPLETED = 'conversation.item.input_audio_transcription.completed';

  var session = null;

  function fresh() {
    return {
      state: 'idle', pc: null, dc: null, stream: null,
      usageId: null, model: null, startedAt: 0, seconds: 0,
      items: new Map(), order: 0, error: null,
      /* Every data-channel event, both directions, for evidence. Types and
         ids only — never transcript text, which is the founder's call. */
      events: [], commitCount: 0, deltaSeen: false,
      /* Set by each delta, cleared by each commit: proof there is NEW audio
         worth settling. This is what stops a second commit for the same
         silence and what makes an empty-buffer commit impossible. */
      deltaSinceCommit: false,
      vad: null, audioCtx: null, analyser: null, vadTimer: null,
      onChange: function () {},
    };
  }

  /* Same rules as the pure module, kept in step deliberately: an item_id is
     the identity, a completion replaces the partial rather than appending,
     and ordering follows first-sight rather than arrival. */
  function applyEvent(s, event) {
    if (!event || typeof event !== 'object') return false;
    var id = event.item_id;
    if (typeof id !== 'string' || !id) return false;
    if (event.type !== DELTA && event.type !== COMPLETED) return false;

    var item = s.items.get(id);
    if (!item) {
      s.order += 1;
      item = { itemId: id, sequence: s.order, partial: '', final: null, status: 'partial' };
      s.items.set(id, item);
    }
    if (event.type === DELTA) {
      if (item.status === 'final') return false;
      item.partial += (typeof event.delta === 'string' ? event.delta : '');
      return true;
    }
    if (item.status === 'final') return false;
    item.final = (typeof event.transcript === 'string' ? event.transcript : '');
    item.status = 'final';
    return true;
  }

  function view(s) {
    return Array.from(s.items.values()).sort(function (a, b) { return a.sequence - b.sequence; })
      .map(function (i) {
        return { itemId: i.itemId, sequence: i.sequence, status: i.status,
          text: i.status === 'final' ? i.final : i.partial };
      });
  }

  api.snapshot = function () {
    if (!session) return { state: 'idle', items: [], partial: '', seconds: 0, error: null };
    var rows = view(session);
    var open = rows.filter(function (r) { return r.status === 'partial' && r.text.trim(); });
    return {
      state: session.state,
      model: session.model,
      items: rows.filter(function (r) { return r.status === 'final' && r.text.trim(); }),
      partial: open.length ? open[open.length - 1].text.trim() : '',
      seconds: session.state === 'listening'
        ? Math.round((Date.now() - session.startedAt) / 1000) : session.seconds,
      error: session.error,
    };
  };

  function move(s, next) {
    s.state = next;
    try { s.onChange(api.snapshot()); } catch (e) {}
  }

  api.start = async function (opts) {
    if (session && (session.state === 'listening' || session.state === 'connecting'
      || session.state === 'requesting_mic')) return;
    session = fresh();
    session.onChange = (opts && opts.onChange) || function () {};
    var workspaceId = (opts && opts.workspaceId) || null;

    /* 1 — the microphone, before anything is minted or reserved. A founder
       who declines should cost nothing and reach no provider. */
    move(session, 'requesting_mic');
    try {
      session.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (error) {
      session.error = (error && error.name === 'NotAllowedError')
        ? 'Microphone permission was refused, so there is nothing to listen to.'
        : 'No microphone is available in this browser.';
      move(session, 'failed');
      return;
    }

    /* 2 — a short-lived credential from VISION. */
    move(session, 'connecting');
    var token = null;
    try {
      var minted = await V.sb.functions.invoke('live-intelligence', {
        body: { action: 'transcribe_token', workspaceId: workspaceId },
      });
      token = minted && minted.data;
      if (!token || token.ok !== true) {
        var ctx = minted && minted.error && minted.error.context;
        var refusal = null;
        try { if (ctx && typeof ctx.json === 'function') refusal = await ctx.clone().json(); } catch (e) {}
        session.error = (refusal && refusal.details)
          || 'VISION could not start a transcription session.';
        api.stop({ status: 'failed', errorCode: (refusal && refusal.error) || 'token_failed' });
        return;
      }
    } catch (error) {
      session.error = 'VISION could not be reached to start transcription.';
      move(session, 'failed');
      return;
    }
    session.usageId = token.usageId || null;
    session.model = token.model || null;

    /* 3 — the peer connection. Microphone out; nothing in. */
    try {
      var pc = new RTCPeerConnection();
      session.pc = pc;
      session.stream.getTracks().forEach(function (track) { pc.addTrack(track, session.stream); });

      var dc = pc.createDataChannel('oai-events');
      session.dc = dc;
      dc.addEventListener('message', function (e) {
        var parsed = null;
        try { parsed = JSON.parse(e.data); } catch (err) { return; }
        if (parsed && typeof parsed.type === 'string') {
          session.events.push({ dir: 'in', type: parsed.type,
            itemId: parsed.item_id || null, at: Date.now() });
          if (parsed.type === DELTA) { session.deltaSeen = true; session.deltaSinceCommit = true; }
        }
        if (applyEvent(session, parsed)) {
          try { session.onChange(api.snapshot()); } catch (err2) {}
        }
      });
      dc.addEventListener('open', function () {
        session.startedAt = Date.now();
        move(session, 'listening');
        startVad();
      });

      pc.addEventListener('connectionstatechange', function () {
        if (session && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
          /* NEVER RECONNECTS ON ITS OWN. Audio that was lost is lost, and
             quietly resuming would leave the founder believing the whole call
             was captured. */
          session.error = 'The transcription connection dropped. Start listening again when you are ready.';
          api.stop({ status: 'failed', errorCode: 'connection_' + pc.connectionState });
        }
      });

      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      var answer = await fetch(token.callsUrl, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: 'Bearer ' + token.clientSecret, 'Content-Type': 'application/sdp' },
      });
      if (!answer.ok) {
        session.error = 'The transcription service refused the connection.';
        api.stop({ status: 'failed', errorCode: 'sdp_' + answer.status });
        return;
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
    } catch (error) {
      session.error = 'The transcription connection could not be established.';
      api.stop({ status: 'failed', errorCode: 'webrtc_failed' });
    }
  };

  /* ── COMMITTING THE INPUT BUFFER ──────────────────────────────────────
     With turn_detection null nothing on the server closes an utterance, so
     the client owns that moment. One commit, at the point the founder stops
     talking — the buffer is then transcribed and the completed event carries
     the settled text.

     EXACTLY ONCE, and never on an empty buffer: committing silence asks the
     model to transcribe nothing, and committing repeatedly would fragment one
     utterance into several. */
  api.commit = function () {
    if (!session) return { sent: false, reason: 'no_session' };
    if (session.state !== 'listening') return { sent: false, reason: 'not_listening' };
    if (!session.dc || session.dc.readyState !== 'open') return { sent: false, reason: 'channel_closed' };
    /* NEVER AN EMPTY BUFFER, and never twice for one silence: a commit is
       only meaningful if OpenAI has sent transcript deltas since the last
       one. A call may commit many times — once per utterance — but never
       for audio that has already been settled. */
    if (!session.deltaSinceCommit) return { sent: false, reason: 'empty_buffer' };
    try {
      session.dc.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    } catch (e) {
      return { sent: false, reason: 'send_failed' };
    }
    session.deltaSinceCommit = false;
    session.commitCount += 1;
    session.events.push({ dir: 'out', type: 'input_audio_buffer.commit', itemId: null, at: Date.now() });
    return { sent: true, commitCount: session.commitCount };
  };

  api.events = function () { return session ? session.events.slice() : []; };
  api.vadTransitions = function () {
    return session && session.vad ? session.vad.transitions.slice() : [];
  };

  /* ── THE LOCAL SILENCE DETECTOR ───────────────────────────────────────
     Reads the level of the SAME microphone stream that is already going to
     OpenAI — one getUserMedia, one peer connection, one realtime session.
     It never transcribes and never produces text; its only authority is
     choosing the moment to send a commit that is already proven to work. */
  var VAD_FRAME_MS = 50;
  function startVad() {
    if (!session || !session.stream || !window.VISION_VAD) return;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      var src = ctx.createMediaStreamSource(session.stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      /* Deliberately NOT connected to a destination: this is measurement, and
         routing the microphone to the speakers on a live call is feedback. */
      src.connect(analyser);
      var buf = new Float32Array(analyser.fftSize);
      session.audioCtx = ctx;
      session.analyser = analyser;
      session.vad = window.VISION_VAD.createVad();

      session.vadTimer = setInterval(function () {
        if (!session || session.state !== 'listening') return;
        analyser.getFloatTimeDomainData(buf);
        var sum = 0;
        for (var i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
        var rms = Math.sqrt(sum / buf.length);
        var verdict = window.VISION_VAD.feedVad(session.vad, rms, Date.now());
        if (verdict.commit) api.commit();
      }, VAD_FRAME_MS);
    } catch (e) { /* no Web Audio: commits still happen on stop */ }
  }

  function stopVad(atMs) {
    if (!session) return;
    if (session.vadTimer) { clearInterval(session.vadTimer); session.vadTimer = null; }
    if (session.vad && window.VISION_VAD) {
      /* One last boundary if they were still talking when it ended. */
      var f = window.VISION_VAD.flushVad(session.vad, atMs);
      if (f.commit) api.commit();
    }
    try { if (session.audioCtx) session.audioCtx.close(); } catch (e) {}
    session.audioCtx = null; session.analyser = null;
  }

  api.stop = function (opts) {
    if (!session) return;
    var status = (opts && opts.status) || 'completed';
    /* Settle whatever is still buffered before tearing the channel down —
       otherwise the last thing said is lost. The detector decides whether
       there IS anything: an utterance that already committed on its own
       silence must not be committed a second time here. */
    if (status !== 'failed') { try { stopVad(Date.now()); } catch (e) {} }
    if (session.startedAt) session.seconds = Math.round((Date.now() - session.startedAt) / 1000);

    try { if (session.dc) session.dc.close(); } catch (e) {}
    try { if (session.pc) session.pc.close(); } catch (e) {}
    /* Every track stopped, so the browser's recording indicator goes out. A
       microphone left open after a call is over is its own kind of breach. */
    try {
      if (session.stream) session.stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {}
    session.dc = null; session.pc = null; session.stream = null;

    if (session.usageId) {
      var id = session.usageId; var secs = session.seconds;
      session.lastUsageId = id;
      session.usageId = null;
      try {
        V.sb.functions.invoke('live-intelligence', {
          body: { action: 'transcribe_finalize', usageId: id, audioSeconds: secs,
            status: status === 'failed' ? 'failed' : 'completed',
            errorCode: (opts && opts.errorCode) || null },
        });
      } catch (e) {}
    }
    move(session, status === 'failed' ? 'failed' : 'stopped');
  };

  /* ── OBSERVABILITY, NOT SIMULATION ────────────────────────────────────
     Reports the REAL state of the real objects: whether a live MediaStream
     exists, what its audio tracks say about themselves, and what the peer
     connection reports. It fabricates nothing and changes nothing, which is
     what lets an automated test prove the audio path actually ran instead of
     proving that a stub was installed. */
  api.diagnostics = async function () {
    if (!session) return { hasSession: false };
    var tracks = [];
    try {
      if (session.stream) {
        tracks = session.stream.getAudioTracks().map(function (t) {
          return { kind: t.kind, readyState: t.readyState, enabled: t.enabled,
            muted: t.muted, label: t.label };
        });
      }
    } catch (e) {}
    var outboundBytes = null; var candidatePairs = 0;
    try {
      if (session.pc && session.pc.getStats) {
        var stats = await session.pc.getStats();
        stats.forEach(function (r) {
          if (r.type === 'outbound-rtp' && r.kind === 'audio') outboundBytes = r.bytesSent;
          if (r.type === 'candidate-pair' && r.state === 'succeeded') candidatePairs += 1;
        });
      }
    } catch (e) {}
    return {
      hasSession: true, state: session.state, model: session.model,
      hasStream: !!session.stream, audioTracks: tracks,
      pcState: session.pc ? session.pc.connectionState : null,
      iceState: session.pc ? session.pc.iceConnectionState : null,
      dcState: session.dc ? session.dc.readyState : null,
      outboundAudioBytes: outboundBytes, succeededCandidatePairs: candidatePairs,
      itemCount: session.items.size, usageId: session.usageId || session.lastUsageId || null,
      commitCount: session.commitCount,
      vadState: session.vad ? session.vad.state : null,
      eventTypes: session.events.map(function (x) { return x.dir + ':' + x.type; }),
      seconds: session.startedAt ? Math.round((Date.now() - session.startedAt) / 1000) : session.seconds,
    };
  };

  /* Only settled text ever leaves here. */
  api.committedTurns = function () {
    if (!session) return [];
    return view(session).filter(function (i) { return i.status === 'final' && i.text.trim(); })
      .map(function (i, index) {
        return { speaker: 'captured_audio', text: i.text.trim(), sequence: index + 1, itemId: i.itemId };
      });
  };
})(window.VISION);
