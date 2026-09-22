/* ════════════════════════════════════════════════════════════════════════
   ASSEMBLYAI STREAMING — the speaker-labelled transcription path.

   Exists for one reason: the OpenAI realtime endpoint refuses the diarizing
   model, and VISION cannot say whether a sentence came from the founder or
   the prospect without speaker labels. The proven OpenAI path is untouched
   and still selectable; this is a second option, not a replacement.

   TRANSCRIPTION AND SPEAKERS ONLY. Nothing here calls call_assist, and
   gpt-5.6-terra is not involved in any part of it.

   The browser never holds the permanent key. It asks VISION for a
   single-use token that expires in ten minutes, and that token is the only
   credential in this file.
   ══════════════════════════════════════════════════════════════════════ */
import {
  assemblyTurnToSegment, segmentEventFrom,
} from '../goal-engine/live-intelligence/transcription-providers.js';
import {
  createDiarization, applySegment, calibrateFounder, diarizedTranscript, stability,
} from '../goal-engine/live-intelligence/diarization.js';
import {
  createCallFeed, considerTurn, markCalibrated, coverage,
} from '../goal-engine/live-intelligence/call-feed.js';
import {
  CAPTURE_MODE, assessCapture, captureNotice,
} from '../goal-engine/live-intelligence/capture-health.js';

const api = {};
window.VISION_ASSEMBLY = api;

/* Two deliberate calibration utterances, and only those two. */
const CALIBRATION_TURNS = 2;

let session = null;

function fresh() {
  return {
    state: 'idle', ws: null, stream: null, ctx: null, node: null, source: null,
    usageId: null, startedAt: 0, seconds: 0, error: null,
    captureMode: null, captureFrames: 0, levels: [],
    recorder: null, recordChunks: [], recordMime: null, recording: false,
    turns: [], events: [], diar: createDiarization(),
    resolvedConfig: null,
    calibrationItemId: null, framesSent: 0, bytesSent: 0,
    feed: createCallFeed(), handoff: null, workspaceId: null,
    analysis: null, analysisBusy: false, analysisError: null,
    /* Observability for the live proof: when each analysis was asked for and
       answered, and how often a new utterance landed while one was still in
       flight. A silent call assistant that renders stale guidance is worse
       than one that renders none. */
    analysisLog: [], deferrals: 0,
    /* Two independent reasons the mic can be off, and neither may silently
       cancel the other. The runner asks for `desiredCapture` on every turn
       boundary (true when it is the founder's turn, false otherwise); a
       founder's own Mute button sets `userMuted`. Fresh per call, so a mute
       from a previous rehearsal can never bleed into the next one. */
    desiredCapture: true, userMuted: false,
    onChange() {},
  };
}

/* The track is only ever actually on when BOTH sides agree: it is the
   founder's turn AND the founder has not muted themselves. Whichever of the
   two changes last, this is the one place that reconciles them — the turn
   engine can keep calling setCapture(true) every time it is the founder's
   turn without ever fighting a manual mute the founder is still holding. */
function applyCapture() {
  if (!session || !session.stream) return false;
  var actual = !!session.desiredCapture && !session.userMuted;
  try {
    session.stream.getAudioTracks().forEach((t) => { t.enabled = actual; });
    return true;
  } catch (e) { return false; }
}

const move = (next) => {
  if (!session) return;
  session.state = next;
  try { session.onChange(api.snapshot()); } catch (e) { /* view only */ }
};

/* ONE PLACE DECIDES WHETHER ATTRIBUTION IS TRUSTWORTHY, so the surface, the
   feed and the diagnostics can never disagree about it. */
function health() {
  if (!session) return assessCapture({});
  return assessCapture({
    capturedSeconds: session.captureFrames / 16000,
    elapsedSeconds: session.startedAt ? (Date.now() - session.startedAt) / 1000 : 0,
    mode: session.captureMode,
  });
}

api.snapshot = function () {
  if (!session) return { state: 'idle', turns: [], transcript: [] };
  const capture = health();
  /* A call VISION did not hear properly has no speakers, only sentences. The
     transcript still shows -- the founder can read it -- but nothing claims
     to know who said it. */
  const rows = diarizedTranscript(session.diar);
  /* ── WHEN THE PROVIDER ACTUALLY DELIVERED THIS FRAGMENT ──────────────
     Wall clock, stamped the instant the Turn message parsed, and joined by
     `itemId` -- the id both shapes already share. It was being attached to
     rows inside the call-feed loop and nowhere else, so the release path,
     which is the one place that reasons about arrival, could not see it.

     This is the measurement `decideRelease` has never had. SETTLE_MS is a
     WALL-CLOCK window and the only continuation figures on record are
     AUDIO-clock gaps; nothing has ever recorded how long after one finalised
     fragment the next one ARRIVES. Read-only: no decision consumes it. */
  const arrivals = session.turnArrivals || {};
  const withArrival = rows.map((r) => ({ ...r, arrivedAt: arrivals[r.itemId] ?? null }));
  const transcript = capture.trustAttribution
    ? withArrival
    : withArrival.map((r) => ({ ...r, role: 'unknown', roleWithheld: 'capture_degraded' }));
  return {
    state: session.state,
    error: session.error,
    turns: session.turns.slice(),
    transcript,
    capture,
    captureNotice: captureNotice(capture),
    stability: stability(session.diar),
    analysis: session.analysis,
    analysisError: session.analysisError,
    coverage: coverage(session.feed),
    analysisLog: session.analysisLog.slice(),
    deferrals: session.deferrals,
    /* Read-only projections the command surface renders from. No behaviour
       depends on them; they exist so the UI never has to guess at state. */
    calibrated: !!session.calibrationItemId,
    calibrationAttempts: session.calibrationAttempts || 0,
    calibrationWindow: CALIBRATION_TURNS,
    calibrationItemIds: (session.calibrationItemIds || []).slice(),
    calibrationConflict: !!session.calibrationConflict,
    /* The server's own answer to "what model/mode/turn-silence set is
       actually in force", captured from Begin above. Read-only. */
    resolvedConfig: session.resolvedConfig,
    framesSent: session.framesSent,
    bytesSent: session.bytesSent,
    /* Word timings are relative to the stream; this places them on the wall
       clock so "when did the founder stop speaking" is answerable. */
    startedAt: session.startedAt,
    seconds: session.startedAt ? Math.round((Date.now() - session.startedAt) / 1000) : session.seconds,
  };
};
api.events = () => (session ? session.events.slice() : []);

/* MUTE AT THE TRACK, NOT AT THE HANDLER. Disabling the microphone track stops
   audio reaching the peer connection at all, so nothing is transcribed and
   nothing is billed while VISION's own voice is coming out of the speakers.
   Filtering afterwards would still let synthetic speech into attribution.
   THIS IS THE TURN ENGINE'S CALL, not the founder's — it says whose turn it
   is, not whether the founder wants to be heard. See applyCapture(). */
api.setCapture = function (on) {
  if (!session) return false;
  session.desiredCapture = !!on;
  return applyCapture();
};
/* THE FOUNDER'S OWN CALL — the Mute button. Independent of whatever the turn
   engine last asked for: muting mid-turn holds through the rest of that
   turn, and unmuting only actually re-opens the track if it is still (or
   again) the founder's turn to speak. */
api.setUserMute = function (muted) {
  if (!session) return false;
  session.userMuted = !!muted;
  return applyCapture();
};
api.userMuted = function () { return !!(session && session.userMuted); };
/* ── RECORDING THE FOUNDER, ONLY IF THEY SAID YES ────────────────────
   Started explicitly by the caller after it has read the stored preference.
   Nothing here decides consent; it only obeys it.

   Recording the SAME MediaStream the transcriber uses has a property worth
   stating: setCapture(false) disables the track while VISION speaks, so a
   disabled track records SILENCE. The synthesised prospect voice can never
   land in the founder's recording, and the timeline still lines up with the
   wall clock because the silence occupies the real elapsed time. */
api.startRecording = function () {
  if (!session || !session.stream || session.recorder) return false;
  if (typeof window.MediaRecorder !== 'function') return false;
  var mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    .find(function (m) { try { return window.MediaRecorder.isTypeSupported(m); } catch (e) { return false; } });
  try {
    session.recorder = mime ? new window.MediaRecorder(session.stream, { mimeType: mime })
      : new window.MediaRecorder(session.stream);
    session.recordMime = session.recorder.mimeType || mime || 'audio/webm';
    session.recordChunks = [];
    session.recorder.ondataavailable = function (e) {
      if (e.data && e.data.size) session.recordChunks.push(e.data);
    };
    session.recorder.start(1000);
    session.recording = true;
    return true;
  } catch (e) { session.recorder = null; return false; }
};
api.stopRecording = function () {
  return new Promise(function (resolve) {
    if (!session || !session.recorder) { resolve(null); return; }
    var rec = session.recorder;
    var finish = function () {
      var chunks = session.recordChunks.slice();
      session.recorder = null; session.recording = false;
      if (!chunks.length) { resolve(null); return; }
      try { resolve(new Blob(chunks, { type: session.recordMime || 'audio/webm' })); }
      catch (e) { resolve(null); }
    };
    rec.onstop = finish;
    try { rec.stop(); } catch (e) { finish(); }
    setTimeout(function () { if (session && session.recorder === rec) finish(); }, 4000);
  });
};
api.recordingMime = function () { return session ? session.recordMime : null; };
api.wordsFor = function (itemId) {
  return (session && session.turnWords && session.turnWords[itemId]) || [];
};
api.levels = function () { return session ? session.levels.slice() : []; };

api.capturing = function () {
  if (!session || !session.stream) return false;
  return session.stream.getAudioTracks().some((t) => t.enabled);
};
api.diagnostics = () => {
  if (!session) return { hasSession: false };
  return {
    hasSession: true, state: session.state,
    hasStream: !!session.stream,
    audioTracks: session.stream ? session.stream.getAudioTracks().map((t) => ({
      kind: t.kind, readyState: t.readyState, label: t.label })) : [],
    wsState: session.ws ? session.ws.readyState : null,
    framesSent: session.framesSent, bytesSent: session.bytesSent,
    usageId: session.usageId, seconds: session.snapshotSeconds,
    calibrationItemId: session.calibrationItemId,
    calibrationFailures: session.calibrationFailures || 0,
    calibrationAttempts: session.calibrationAttempts || 0,
    calibratedOnAttempt: session.calibratedOnAttempt || null,
    calibrationWindow: CALIBRATION_TURNS,
    founderSpeakerId: session.diar.founderSpeakerId,
    prospectSpeakerId: session.diar.prospectSpeakerId,
    overflow: session.diar.overflow,
    captureMode: session.captureMode,
    captureFrames: session.captureFrames,
    capture: health(),
  };
};

api.start = async function (opts) {
  if (session && ['listening', 'connecting', 'requesting_mic'].includes(session.state)) return;
  session = fresh();
  session.onChange = (opts && opts.onChange) || function () {};
  /* The prospect context call_assist analyses against, carried from Leads. */
  session.handoff = (opts && opts.handoff) || null;
  session.workspaceId = (opts && opts.workspaceId) || null;

  /* 1 — microphone first: a refusal must cost nothing and reach no provider. */
  move('requesting_mic');
  try {
    session.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
  } catch (error) {
    session.error = 'Microphone permission was refused.';
    move('failed');
    return;
  }

  /* 2 — a single-use token, minted server-side. */
  move('connecting');
  let mint = null;
  try {
    const res = await window.VISION.sb.functions.invoke('live-intelligence', {
      body: { action: 'assembly_token', workspaceId: session.workspaceId },
    });
    mint = res && res.data;
  } catch (e) { mint = null; }
  if (!mint || mint.ok !== true || typeof mint.token !== 'string') {
    session.error = 'VISION could not start an AssemblyAI session.';
    api.stop({ status: 'failed' });
    return;
  }
  session.usageId = mint.usageId || null;

  /* 3 — the stream. 16 kHz mono PCM is what the socket expects, so the audio
     graph is created at that rate rather than resampled by hand. */
  const RATE = 16000;
  /* ── PHOENIX A/B: DIARISATION, OFF BY DEFAULT FOR NOBODY ─────────────
     Structurally confirmed diarisation is genuinely active (`resolvedConfig`
     echoed `speaker_labels: true` back from a real session) and structurally
     confirmed Practice never reads its speaker/role output -- the mic is
     muted while the synthesised prospect "speaks", so AssemblyAI never
     receives a second voice to separate on a Practice call.

     `diarizationDisabled` is opt-IN, read from a caller-supplied flag that
     only Practice's own setup screen can set (see li-practice-call.js's
     `diar=off` URL read); li-call.js's call to `.start()` never passes it,
     so Live Call Intelligence's connection is untouched by construction --
     proven, not assumed, by qa-practice-diarization-ab.mjs.

     Field ORDER is preserved exactly as before when the flag is false/unset,
     so the disabled-condition query string is byte-identical to what shipped
     before this A/B existed. */
  const diarizationDisabled = !!(opts && opts.diarizationDisabled === true);
  /* ── PHOENIX A/B #2: TURN-DETECTION MODE ──────────────────────────────
     `resolvedConfig` (the server's own "Begin" echo) confirmed the current
     live default is `mode: "balanced"` -- AssemblyAI applies that whenever
     the caller omits the param, so OMITTING it is condition A, byte-
     identical to every call this branch has ever made. Sending the literal
     string 'min_latency' is condition B, and is the only other value this
     gate will ever pass through -- fails closed to A on anything else,
     including a typo or an unexpected opts shape. */
  const assemblyTurnMode = (opts && opts.assemblyTurnMode === 'min_latency') ? 'min_latency' : null;
  const params = { token: mint.token, speech_model: 'u3-rt-pro' };
  if (!diarizationDisabled) { params.speaker_labels = 'true'; params.max_speakers = '2'; }
  params.sample_rate = String(RATE);
  params.format_turns = 'true';
  if (assemblyTurnMode) { params.mode = assemblyTurnMode; }
  const query = new URLSearchParams(params);
  const ws = new WebSocket(`${mint.wsUrl}?${query.toString()}`);
  ws.binaryType = 'arraybuffer';
  session.ws = ws;

  ws.addEventListener('message', (e) => {
    let msg = null;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    session.events.push({ type: msg.type, at: Date.now(), speaker: msg.speaker_label || null });

    /* ── WHAT THE SERVER ACTUALLY RESOLVED ────────────────────────────
       AssemblyAI's real-time API sends a "Begin" message on every session,
       unprompted, echoing back the model, mode and turn-detection defaults
       it actually applied -- documented shape:
       {"type":"Begin",...,"configuration":{"model":"...","mode":"...",...}}.
       VISION's connection string sends `speech_model=u3-rt-pro`, which does
       not appear anywhere in AssemblyAI's CURRENT documentation -- it is the
       original launch id for what AssemblyAI's docs now call
       "universal-3-5-pro", and the blog post that introduced it now carries
       AssemblyAI's own banner that newer models have since shipped. So which
       model, mode, and turn-silence defaults are actually governing every
       live VISION session is presently UNKNOWN from documentation alone --
       AssemblyAI's own docs disagree with each other 2-3 ways on the exact
       numbers for the most likely candidate model.

       This message was received on every connection already; nothing read
       it. Captured, never acted on: no turn-taking decision changes because
       of what this holds, so a malformed or absent Begin message costs
       nothing beyond the observation itself. */
    if (msg.type === 'Begin' && msg.configuration && typeof msg.configuration === 'object') {
      session.resolvedConfig = { ...msg.configuration, capturedAt: Date.now() };
    }
    if (msg.type === 'Turn') {
      session.turns.push({
        order: msg.turn_order, endOfTurn: msg.end_of_turn === true,
        transcript: msg.transcript, speakerLabel: msg.speaker_label || null,
        /* START, END AND CONFIDENCE WERE BEING THROWN AWAY. Words per
           minute, the pause before an answer, a rushed objection and filler
           frequency are all arithmetic on these three numbers. They cost
           nothing to keep and they are not a recording of anyone. */
        words: (msg.words || []).filter((w) => w && w.word_is_final)
          .map((w) => ({ text: w.text, speaker: w.speaker || null,
            start: typeof w.start === 'number' ? w.start : null,
            end: typeof w.end === 'number' ? w.end : null,
            confidence: typeof w.confidence === 'number' ? w.confidence : null })),
        at: Date.now(),
      });
      const seg = assemblyTurnToSegment(msg);
      if (seg) {
        session.turnArrivals = session.turnArrivals || {};
        session.turnArrivals[seg.itemId] = Date.now();
        /* Keyed by the id the consumer will actually ask for. Deriving the
           id back out of a turn order failed whenever the provider omitted
           one, and silently produced a turn with no word timings at all. */
        session.turnWords = session.turnWords || {};
        session.turnWords[seg.itemId] = (msg.words || [])
          .filter(function (w) { return w && w.word_is_final; })
          .map(function (w) {
            return { text: w.text, start: typeof w.start === 'number' ? w.start : null,
              end: typeof w.end === 'number' ? w.end : null,
              confidence: typeof w.confidence === 'number' ? w.confidence : null };
          });
        applySegment(session.diar, segmentEventFrom(seg));
        /* THE FIRST FINALISED TURN IS THE CALIBRATION UTTERANCE — the line
           the founder speaks alone before dialling. Nothing else may set it. */
        /* ── THE CALIBRATION WINDOW ────────────────────────────────────
           Calibration may only be established by an utterance the founder
           spoke DELIBERATELY, before the call. Those are the first N turns
           and no others, so a run where every calibration comes back UNKNOWN
           ends with no founder rather than quietly promoting whoever spoke
           next — which on a real call is the prospect answering the phone.

           Within the window an UNKNOWN turn is skipped and not consumed: the
           founder simply says the second line, which is the whole reason
           there are two. */
        /* EVERY turn in the window is put to calibration, not just turns up
           to the first success. The second line's only job once the first has
           landed is to CONTRADICT it -- and a contradiction is the one signal
           that catches a confidently-wrong diarizer. Stopping early threw that
           signal away. */
        session.calibrationAttempts = session.calibrationAttempts || 0;
        if (session.calibrationAttempts < CALIBRATION_TURNS) {
          session.calibrationAttempts += 1;
          session.calibrationItemIds = (session.calibrationItemIds || []).concat(seg.itemId);
          const cal = calibrateFounder(session.diar, seg.itemId);
          if (cal.ok) {
            if (!session.calibrationItemId) {
              session.calibrationItemId = seg.itemId;
              session.calibratedOnAttempt = session.calibrationAttempts;
              markCalibrated(session.feed);
            }
          } else if (cal.conflict) {
            session.calibrationConflict = true;
          } else if (cal.retryable) {
            session.calibrationFailures = (session.calibrationFailures || 0) + 1;
          }
        }
      }
      /* ── INTO call_assist ─────────────────────────────────────────
         Every turn is reconsidered rather than only the newest, because an
         earlier turn can become attributable once the speaker picture
         settles. A turn already analysed is refused by the feed itself, so
         reconsidering costs nothing. */
      feedAttributedTurns();
      try { session.onChange(api.snapshot()); } catch (err) { /* view only */ }
    }
  });

  ws.addEventListener('error', () => {
    session.error = 'The AssemblyAI stream failed.';
    api.stop({ status: 'failed' });
  });
  ws.addEventListener('close', (e) => {
    if (session && session.state === 'listening') {
      session.events.push({ type: `Closed:${e.code}`, at: Date.now() });
    }
  });

  ws.addEventListener('open', async () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx({ sampleRate: RATE });
      const source = ctx.createMediaStreamSource(session.stream);

      /* CAPTURE DOES NOT SHARE A THREAD WITH RENDERING.
         The ScriptProcessorNode this replaced ran on the main thread, beside
         the JSON parsing, the snapshot rebuild, the re-render and the awaited
         call_assist request. Under that load it returned CORRUPTED audio --
         duplicated words, and two voices 64 Hz apart collapsed onto one
         speaker label -- while still reporting 97.5% of the expected samples.
         The damage was invisible to every measurement we had.

         There is no safe fallback here. A browser without AudioWorklet cannot
         capture a call accurately enough to say who spoke, and guessing is
         the one thing this whole path exists to avoid. */
      if (!ctx.audioWorklet || typeof window.AudioWorkletNode !== 'function') {
        try { ctx.close(); } catch (e) { /* nothing to close */ }
        session.error = 'This browser cannot record a call accurately enough to tell speakers apart.';
        api.stop({ status: 'failed' });
        return;
      }
      await ctx.audioWorklet.addModule(new URL('./li-capture-worklet.js', import.meta.url));
      const node = new AudioWorkletNode(ctx, 'vision-capture');
      session.captureMode = CAPTURE_MODE.AUDIO_THREAD;
      node.port.onmessage = (ev) => {
        const d = ev.data || {};
        /* Every sample the AUDIO thread saw, regardless of whether the main
           thread was ready for it. This is the honest coverage number. */
        if (typeof d.frames === 'number') session.captureFrames = d.frames;
        if (typeof d.rms === 'number') {
          session.levels.push({ at: Date.now(), rms: Math.round(d.rms * 10000) / 10000 });
          /* Bounded: a long call cannot grow this without limit. */
          if (session.levels.length > 6000) session.levels.splice(0, 2000);
        }
        if (!session.ws || session.ws.readyState !== 1 || !d.pcm) return;
        session.ws.send(d.pcm);
        session.framesSent += 1;
        session.bytesSent += d.pcm.byteLength;
      };
      source.connect(node);
      /* Zero-gain sink: the node must be pulled by the graph, and routing a
         live microphone to the speakers would be feedback. */
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute);
      mute.connect(ctx.destination);
      session.ctx = ctx; session.node = node; session.source = source;
      session.startedAt = Date.now();
      move('listening');
    } catch (err) {
      session.error = 'The audio graph could not be built.';
      api.stop({ status: 'failed' });
    }
  });
};

async function feedAttributedTurns() {
  if (!session || !session.handoff) return;
  /* Degraded capture must not reach call_assist. Its whole safety model rests
     on only the prospect being able to establish a fact about their business,
     and audio VISION could not hear properly cannot support that claim. */
  if (!health().trustAttribution) return;
  const rows = diarizedTranscript(session.diar);
  for (let i = 0; i < rows.length; i += 1) {
    const verdict = considerTurn(session.feed, rows[i], {
      /* Every attempt, including the ones the diarizer refused: they are all
         VISION's setup, none of them are the call. */
      calibrationItemIds: session.calibrationItemIds || [],
      sequence: i + 1,
      /* Has a second speaker actually been established? diarizedTranscript()
         above recomputes this, so it reflects everything heard so far. */
      prospectResolved: !!session.diar.prospectSpeakerId,
    });
    rows[i].arrivedAt = (session.turnArrivals || {})[rows[i].itemId] || null;
    if (!verdict.feed) continue;
    /* One in flight at a time: call_assist analyses the whole transcript so
       far, so two overlapping requests would pay twice to answer the same
       question and the later answer would win by luck of ordering. The turn
       is un-marked so the next event reconsiders it. */
    if (session.analysisBusy) {
      session.deferrals += 1;
      session.feed.sent.delete(rows[i].itemId);
      continue;
    }
    session.analysisBusy = true;
    const askedAt = Date.now();
    const turnArrivedAt = rows[i].arrivedAt || askedAt;
    try {
      const res = await window.VISION.sb.functions.invoke('live-intelligence', {
        body: { ...verdict.payload, workspaceId: session.workspaceId, handoff: session.handoff },
      });
      const data = res && res.data;
      if (data && data.ok === true) {
        session.analysis = data.analysis || null;
        session.analysisError = null;
        if (data.workspaceId) session.workspaceId = data.workspaceId;
        session.analysisLog.push({
          itemId: rows[i].itemId, speaker: rows[i].role,
          askedAt, respondedAt: Date.now(), ms: Date.now() - askedAt,
          turnToGuidanceMs: Date.now() - turnArrivedAt,
          source: data.source || null, modelCalled: data.modelCalled === true,
          modelReason: data.modelReason || null,
          /* Was the transcript longer by the time the answer came back? That
             is what stale guidance looks like from the inside. */
          turnsWhenAsked: rows.length,
          turnsWhenAnswered: diarizedTranscript(session.diar).length,
        });
      } else {
        session.analysisError = 'VISION could not read that line.';
      }
    } catch (e) {
      session.analysisError = 'VISION could not be reached.';
    }
    session.analysisBusy = false;
    try { session.onChange(api.snapshot()); } catch (e2) { /* view only */ }
  }
}

api.stop = function (opts) {
  if (!session) return;
  const status = (opts && opts.status) || 'completed';
  if (session.startedAt) session.seconds = Math.round((Date.now() - session.startedAt) / 1000);
  session.snapshotSeconds = session.seconds;

  try { if (session.ws && session.ws.readyState === 1) session.ws.send(JSON.stringify({ type: 'Terminate' })); } catch (e) {}
  try { if (session.ws) session.ws.close(); } catch (e) {}
  try { if (session.node) session.node.disconnect(); } catch (e) {}
  try { if (session.source) session.source.disconnect(); } catch (e) {}
  try { if (session.ctx) session.ctx.close(); } catch (e) {}
  try { if (session.stream) session.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  session.node = null; session.source = null; session.ctx = null; session.stream = null;

  if (session.usageId) {
    const id = session.usageId; const secs = session.seconds;
    session.usageId = null;
    try {
      window.VISION.sb.functions.invoke('live-intelligence', {
        body: { action: 'transcribe_finalize', usageId: id, audioSeconds: secs,
          status: status === 'failed' ? 'failed' : 'completed' },
      });
    } catch (e) { /* the ledger sweep recovers an unfinalised reservation */ }
  }
  move(status === 'failed' ? 'failed' : 'stopped');
};
