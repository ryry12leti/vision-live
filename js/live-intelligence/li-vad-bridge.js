/* The pure detector is an ES module and li-transcribe.js is a classic script,
   so this is the one seam between them. It re-exports the SAME functions the
   $0 fixture suite tests — no second implementation, nothing to drift. */
import { createVad, feedVad, flushVad, VAD_DEFAULTS } from '../goal-engine/live-intelligence/utterance-vad.js';
window.VISION_VAD = { createVad, feedVad, flushVad, VAD_DEFAULTS };
