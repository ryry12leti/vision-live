/* ════════════════════════════════════════════════════════════════════════
   SPEAKING THE PROSPECT'S REPLY — the seam only.

   No credential for a speech provider exists in this environment, so nothing
   here calls one. What exists is the contract the voice layer must satisfy,
   and the rules that matter more than the provider does.

   THE VOICE IS NOT THE DIFFICULTY. A resistant prospect is resistant in what
   they say and how little they give away, not in a theatrical performance.
   Anger, seduction and cinematic delivery are all wrong for a person taking
   an unexpected call at work, and a "scary voice" would teach a founder to
   fear tone rather than read a conversation.

   AND VISION NEVER LISTENS TO ITSELF. The prospect's words are already known
   — they were generated here — so re-transcribing the synthetic audio would
   pay a second provider to learn something already in hand, and would feed
   VISION's own voice back into founder attribution.
   ══════════════════════════════════════════════════════════════════════ */

export const VOICE_PROVIDERS = Object.freeze({
  elevenlabs: Object.freeze({
    id: 'elevenlabs', credentialEnv: 'ELEVENLABS_API_KEY',
    streaming: true, serverSideOnly: true,
    model: 'eleven_flash_v2_5',
    /* $0.05 per 1000 characters for Flash, from elevenlabs.io/pricing/api,
       captured 2026-08-20. */
    pricing: Object.freeze({
      microusd_per_1k_chars: 50000,
      source: 'https://elevenlabs.io/pricing/api', capturedOn: '2026-08-20',
    }),
  }),
});
/* There was a second speculative entry here naming another provider's key
   variable. It was never used, and the public build refuses to ship any file
   containing that literal — correctly, since it cannot tell a variable name
   from a secret. One provider we actually call beats two we might. */

/* BROWSER-NATIVE IS THE CURRENT DEFAULT. The ElevenLabs seam above is kept
   whole for later — it is blocked on account quota, not on code — but a
   rehearsal that cannot speak is not a rehearsal, and the platform already
   ships a speech engine that costs nothing. */
export const DEFAULT_VOICE_PROVIDER = 'browser_speech';
export const PAID_VOICE_PROVIDER = 'elevenlabs';

/* ── choosing a system voice ──────────────────────────────────────────
   Voice names differ across Mac, Windows, iOS and every browser, so naming
   one would work on the machine it was written on and nowhere else. Rank by
   properties instead and take the best available. */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|hysterical|bad|pipe|deranged)\b/i;

export function pickBrowserVoice(voices) {
  const english = (voices || []).filter((v) => /^en(-|_|$)/i.test(v.lang || ''));
  const usable = english.filter((v) => !NOVELTY.test(v.name || ''));
  const pool = usable.length ? usable : english;
  if (!pool.length) return null;
  const score = (v) => {
    let n = 0;
    /* A local voice does not need the network and starts sooner. */
    if (v.localService) n += 4;
    /* Platforms label their better voices; prefer them without naming one. */
    if (/\b(natural|neural|premium|enhanced|siri)\b/i.test(v.name || '')) n += 3;
    if (v.default) n += 1;
    if (/^en-(GB|US|AU)/i.test(v.lang || '')) n += 1;
    return n;
  };
  return pool.slice().sort((a, b) => score(b) - score(a))[0];
}

/* Delivery only. Rate and pitch stay near neutral: a resistant prospect is
   resistant in what they say, and slowing the voice down would turn a
   behaviour into a performance. */
export function utteranceSettingsFor(tone) {
  const brisk = tone === 'resistant' || tone === 'disengaging';
  return { rate: brisk ? 1.08 : 1.0, pitch: 1.0, volume: 1.0 };
}

/* Delivery direction, not acting direction. */
export const VOICE_DIRECTION = Object.freeze({
  receptive: 'ordinary, unhurried',
  neutral: 'ordinary, unhurried',
  guarded: 'shorter, a little clipped',
  skeptical: 'shorter, a little clipped',
  resistant: 'brisk, wanting to end the call',
  disengaging: 'brisk, wanting to end the call',
});

const BANNED_DIRECTION = /\b(angry|furious|shout|seductive|sultry|dramatic|cinematic|whisper|sinister|menacing|excited|salesy)\b/i;

export function voiceDirectionFor(tone) {
  const d = VOICE_DIRECTION[tone] || VOICE_DIRECTION.neutral;
  return BANNED_DIRECTION.test(d) ? VOICE_DIRECTION.neutral : d;
}

/* What the browser may be given. Never a permanent key, and never a reason
   to re-transcribe what VISION itself said. */
/* Builds a request for the SERVER-SIDE provider. The browser path never
   calls this, so it defaults to the paid provider rather than to whichever
   voice happens to be default today. */
export function speechRequestFor({ reply, tone, provider = PAID_VOICE_PROVIDER }) {
  const p = VOICE_PROVIDERS[provider];
  if (!p) return { ok: false, reason: 'unknown_provider' };
  const text = String(reply || '').trim();
  if (!text) return { ok: false, reason: 'nothing_to_say' };
  if (text.length > 400) return { ok: false, reason: 'reply_too_long_for_speech' };
  return {
    ok: true, provider: p.id, text,
    direction: voiceDirectionFor(tone),
    /* The transcript of this audio is ALREADY KNOWN. */
    knownTranscript: text,
    mustNotRetranscribe: true,
    serverMintsCredential: true,
  };
}

/* Turn-taking. V1 is clean hand-off: nothing is captured while VISION speaks,
   which is also what stops the microphone hearing the reply. */
export function micStateFor(phase) {
  if (phase === 'prospect_speaking') return { capture: false, why: 'VISION is speaking; the founder\'s microphone is not capturing.' };
  if (phase === 'founder_speaking') return { capture: true, why: 'Listening to the founder.' };
  return { capture: false, why: 'Waiting.' };
}

export function providerStatus(env = {}) {
  return Object.values(VOICE_PROVIDERS).map((p) => ({
    id: p.id, configured: !!env[p.credentialEnv], credentialEnv: p.credentialEnv,
  }));
}
