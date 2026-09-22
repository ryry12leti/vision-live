/* ════════════════════════════════════════════════════════════════════════
   UTTERANCE BOUNDARIES — a local silence detector with exactly one power.

   It decides WHEN to send input_audio_buffer.commit. That is all. It does not
   transcribe, does not produce text, does not judge what was said, and never
   touches the transcript: OpenAI remains the only source of words. Getting
   this wrong costs a boundary in the wrong place, never a wrong sentence.

   Why it exists: this model rejects server turn detection, so with
   turn_detection null nothing on the server closes an utterance. A single
   commit at the end of a call settles only whatever is still buffered — the
   previous run captured the last sentence of four and dropped the rest. A
   real call needs a boundary each time the founder or the prospect stops
   talking, inside ONE realtime session.

   HYSTERESIS IS THE WHOLE TRICK. One threshold makes the state flap on every
   breath and every keyboard tap, and each flap is a commit that splits a
   sentence in half. Speech must cross a HIGHER bar to begin than it has to
   fall below to end, so ordinary noise between words cannot end an utterance.
   ══════════════════════════════════════════════════════════════════════ */

/* One place to tune from real calls. Conservative on purpose: a boundary
   arriving late costs a little latency, a boundary arriving early cuts a
   sentence in two and no downstream step can put it back together. */
export const VAD_DEFAULTS = Object.freeze({
  /* RMS of the mic signal, 0..1. Entering speech is deliberately harder than
     staying in it. */
  speechRms: 0.020,
  silenceRms: 0.012,
  /* A cough or a chair scrape is not an utterance. */
  minSpeechMs: 300,
  /* How long the quiet has to last before the utterance is considered over.
     Natural mid-sentence pauses are commonly 150-400 ms; 700 ms sits above
     them and below the gap people leave when they have actually finished. */
  silenceHoldMs: 700,
  /* Two commits in quick succession would fragment one utterance. */
  commitCooldownMs: 500,
});

export function createVad(config = {}) {
  return {
    cfg: { ...VAD_DEFAULTS, ...config },
    state: 'idle',          /* idle | speech | trailing */
    speechMs: 0,
    silenceStart: 0,
    lastFrame: 0,
    lastCommitAt: -Infinity,
    /* Set when real speech has happened since the last commit. Without it a
       long silence could commit an empty buffer over and over. */
    pendingSpeech: false,
    transitions: [],
  };
}

const note = (vad, at, from, to) => {
  if (from !== to) vad.transitions.push({ at, from, to });
};

/* Feed one audio frame. `rms` is 0..1, `atMs` is a monotonic clock.
   Returns { commit: boolean, reason } — commit is the ONLY output that
   matters; everything else is for the tests and the diagnostics panel. */
export function feedVad(vad, rms, atMs) {
  const c = vad.cfg;
  const frameMs = vad.lastFrame ? Math.max(0, atMs - vad.lastFrame) : 0;
  vad.lastFrame = atMs;
  const from = vad.state;

  if (vad.state === 'idle') {
    if (rms >= c.speechRms) {
      vad.state = 'speech';
      vad.speechMs = 0;
      vad.pendingSpeech = true;
    }
    note(vad, atMs, from, vad.state);
    return { commit: false, reason: vad.state === 'speech' ? 'speech_started' : 'idle' };
  }

  if (vad.state === 'speech') {
    vad.speechMs += frameMs;
    if (rms < c.silenceRms) {
      vad.state = 'trailing';
      vad.silenceStart = atMs;
    }
    note(vad, atMs, from, vad.state);
    return { commit: false, reason: vad.state === 'trailing' ? 'maybe_ending' : 'speaking' };
  }

  /* trailing — quiet, but not yet long enough to be over. */
  if (rms >= c.speechRms) {
    /* A PAUSE, NOT AN ENDING. They took a breath mid-sentence. */
    vad.state = 'speech';
    vad.speechMs += frameMs;
    note(vad, atMs, from, vad.state);
    return { commit: false, reason: 'resumed' };
  }

  if (atMs - vad.silenceStart < c.silenceHoldMs) {
    return { commit: false, reason: 'waiting_out_silence' };
  }

  /* The silence has held. Whether that closes an utterance depends on there
     having been one. */
  vad.state = 'idle';
  note(vad, atMs, from, vad.state);

  if (!vad.pendingSpeech) return { commit: false, reason: 'nothing_to_commit' };
  if (vad.speechMs < c.minSpeechMs) {
    vad.pendingSpeech = false;
    return { commit: false, reason: 'too_short' };
  }
  if (atMs - vad.lastCommitAt < c.commitCooldownMs) {
    return { commit: false, reason: 'cooldown' };
  }
  vad.lastCommitAt = atMs;
  vad.pendingSpeech = false;
  vad.speechMs = 0;
  return { commit: true, reason: 'utterance_ended' };
}

/* Hanging up mid-sentence must not lose it. Same conditions as a natural
   boundary, minus the wait for silence that is never going to arrive. */
export function flushVad(vad, atMs) {
  if (!vad.pendingSpeech) return { commit: false, reason: 'nothing_pending' };
  if (vad.speechMs < vad.cfg.minSpeechMs) return { commit: false, reason: 'too_short' };
  vad.pendingSpeech = false;
  vad.lastCommitAt = atMs;
  vad.speechMs = 0;
  vad.state = 'idle';
  return { commit: true, reason: 'stopped_while_speaking' };
}
