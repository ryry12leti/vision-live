/* ════════════════════════════════════════════════════════════════════════
   IS THE AUDIO WE CAPTURED ACTUALLY GOOD ENOUGH TO SAY WHO SPOKE?

   Speaker attribution is only as trustworthy as the audio underneath it, and
   a degraded microphone path does not announce itself: the provider still
   returns confident-looking labels for audio that has been mangled. VISION
   therefore judges its own capture rather than assuming it worked.

   ONE HONEST LIMITATION, STATED UP FRONT. Coverage — how much audio the
   capture thread actually saw against how long the call has been running —
   does NOT detect main-thread capture corruption. It was measured: a
   ScriptProcessor under load still delivered 97.5% of the expected samples
   while the CONTENT was duplicated and unusable. That is exactly why capture
   moved to an AudioWorklet instead of being monitored more cleverly. This
   module is the backstop for a genuinely starved device, not a substitute
   for capturing correctly in the first place.
   ══════════════════════════════════════════════════════════════════════ */

export const CAPTURE_MODE = Object.freeze({
  AUDIO_THREAD: 'audio_thread',   /* AudioWorklet — content integrity holds */
  MAIN_THREAD: 'main_thread',     /* ScriptProcessor — corruptible under load */
});

export const CAPTURE_STATE = Object.freeze({
  WARMING: 'warming',
  HEALTHY: 'healthy',
  STARVED: 'starved',
  UNSAFE_PATH: 'unsafe_capture_path',
});

/* Below this the call has not run long enough for a ratio to mean anything —
   the first seconds are dominated by graph setup, not by device health. */
export const WARMUP_SECONDS = 4;
/* A device that has missed more than a tenth of the call is not recording the
   conversation, whatever its labels say. */
export const MIN_COVERAGE = 0.9;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function assessCapture({ capturedSeconds, elapsedSeconds, mode } = {}) {
  const captured = num(capturedSeconds);
  const elapsed = num(elapsedSeconds);

  /* A capture path that can be corrupted by a busy main thread cannot be
     trusted to attribute speakers, and no amount of measurement makes it
     trustworthy — the corruption is invisible in the numbers. Say so. */
  if (mode && mode !== CAPTURE_MODE.AUDIO_THREAD) {
    return {
      state: CAPTURE_STATE.UNSAFE_PATH, coverage: elapsed ? captured / elapsed : null,
      trustAttribution: false, reason: 'capture_not_on_audio_thread',
    };
  }
  if (elapsed < WARMUP_SECONDS) {
    return { state: CAPTURE_STATE.WARMING, coverage: null, trustAttribution: true, reason: null };
  }
  const coverage = captured / elapsed;
  if (coverage < MIN_COVERAGE) {
    return {
      state: CAPTURE_STATE.STARVED, coverage,
      trustAttribution: false, reason: 'audio_thread_starved',
    };
  }
  return { state: CAPTURE_STATE.HEALTHY, coverage, trustAttribution: true, reason: null };
}

/* What the founder is told. Never a provider name, never a metric — just
   whether VISION can stand behind who said what. */
export function captureNotice(assessment) {
  if (!assessment || assessment.trustAttribution) return null;
  return 'VISION is not hearing this call clearly enough to tell you apart from them, '
    + 'so it is holding back on who said what.';
}
