/* ════════════════════════════════════════════════════════════════════════
   MICROPHONE CAPTURE, ON THE AUDIO THREAD.

   This file exists because of one measured failure. VISION used to capture
   with a ScriptProcessorNode, which runs on the MAIN thread — the same
   thread that parses every socket message, rebuilds the whole call snapshot,
   re-renders the surface and awaits call_assist. When that thread got busy,
   the captured audio came back corrupted: words duplicated ("Lumina is
   Lumina Dental Clinic", "Mostly, mostly referrals") and two clearly
   distinct voices — a 64 Hz gap in fundamental frequency — collapsed onto a
   single speaker label.

   The provider was never the problem. Replayed straight from disk, the exact
   same audio diarized identically three times running. Only the browser's
   capture path was lossy, and only when the founder's own laptop was busy —
   which is precisely when they are on a call.

   An AudioWorkletProcessor runs on the real-time audio thread. It cannot be
   starved by rendering or by an awaited fetch. Delivery to the main thread
   may still arrive late and in bursts when that thread is busy, and that is
   fine: bursts were tested against the provider and diarize correctly. Late
   is survivable. Corrupt is not.
   ══════════════════════════════════════════════════════════════════════ */

/* 2048 samples at 16 kHz is 128 ms per message — small enough that the
   provider sees a steady stream, large enough not to flood the main thread
   with postMessage traffic it would have to service while rendering. */
const BATCH = 2048;

class VisionCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(BATCH);
    this.n = 0;
    /* Every sample the audio thread has seen. The main thread compares this
       against the wall clock to know whether capture actually kept up, which
       is a fact about the device rather than a guess about it. */
    this.frames = 0;
    this.rmsSum = 0;
    this.rmsCount = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    /* No input yet, or the track is disabled while VISION's own voice plays.
       Returning true keeps the processor alive for the rest of the call. */
    if (!ch || !ch.length) return true;
    this.frames += ch.length;

    /* Level, measured where the samples already are. Loudness and silence
       are objective facts about a recording; nothing here infers anything
       about the person speaking. */
    let sum = 0;
    for (let i = 0; i < ch.length; i += 1) sum += ch[i] * ch[i];
    this.rmsSum += sum; this.rmsCount += ch.length;

    for (let i = 0; i < ch.length; i += 1) {
      const c = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n] = c < 0 ? c * 0x8000 : c * 0x7fff;
      this.n += 1;
      if (this.n === BATCH) {
        /* Transferred, not copied: ownership moves to the main thread so a
           busy main thread can never leave the audio thread waiting on it. */
        const out = new Int16Array(this.buf);
        const rms = this.rmsCount ? Math.sqrt(this.rmsSum / this.rmsCount) : 0;
        this.port.postMessage({ pcm: out.buffer, frames: this.frames, rms: rms }, [out.buffer]);
        this.rmsSum = 0; this.rmsCount = 0;
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('vision-capture', VisionCaptureProcessor);
