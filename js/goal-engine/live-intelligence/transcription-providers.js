/* ════════════════════════════════════════════════════════════════════════
   TWO TRANSCRIPTION PROVIDERS, AND NOTHING RESEMBLING A FRAMEWORK.

   VISION needs trustworthy founder-vs-prospect attribution, and the OpenAI
   realtime path cannot give it: that endpoint refuses the diarizing model.
   So a second provider exists for exactly one reason — speaker labels — and
   this file is the whole abstraction: a table of two entries and one adapter
   that turns AssemblyAI's Turn events into the segment shape the existing
   diarization module already consumes.

   The OpenAI path stays selectable and unchanged. Intelligence is unaffected
   either way: gpt-5.6-terra remains the call-assist model, and nothing here
   goes near it.
   ══════════════════════════════════════════════════════════════════════ */

export const TRANSCRIPTION_PROVIDERS = Object.freeze({
  openai_realtime: Object.freeze({
    id: 'openai_realtime',
    transport: 'webrtc',
    model: 'gpt-live-transcribe',
    diarization: false,
    /* Proven end to end: continuous utterance capture with client-side
       boundaries. It simply cannot say who spoke. */
    speakerLabels: 'none',
    pricing: Object.freeze({
      unit: 'per_minute', audio_microusd_per_minute: 17000,
      source: 'https://developers.openai.com/api/docs/pricing', capturedOn: '2026-08-20',
    }),
  }),
  assemblyai_streaming: Object.freeze({
    id: 'assemblyai_streaming',
    transport: 'websocket',
    wsUrl: 'wss://streaming.assemblyai.com/v3/ws',
    tokenUrl: 'https://streaming.assemblyai.com/v3/token',
    model: 'u3-rt-pro',
    diarization: true,
    speakerLabels: 'per_turn_and_final_word',
    /* $0.45/hr streaming + $0.12/hr diarization add-on = $0.57/hr, which is
       34,200 microusd per HOUR of audio... expressed per minute to sit
       alongside the other route in the same ledger arithmetic. */
    pricing: Object.freeze({
      unit: 'per_minute',
      audio_microusd_per_minute: 9500,          /* $0.57/hr / 60 = $0.0095/min */
      base_microusd_per_hour: 450000,
      diarization_microusd_per_hour: 120000,
      source: 'https://www.assemblyai.com/pricing', capturedOn: '2026-08-20',
    }),
  }),
});

/* ASSEMBLYAI IS THE DEFAULT because it is the only path that can say WHO
   spoke, and call_assist's entire safety model depends on that: only the
   prospect can establish a fact about their business. It also costs
   $0.57/hr against $1.02/hr.

   OpenAI stays selectable and proven. A diarization outage should degrade to
   an unattributed transcript, not to no transcript at all — but an
   unattributed transcript must never be fed to call_assist as if it were
   attributed, which is why the fallback changes what VISION can DO, not just
   which provider it dials. */
export const DEFAULT_TRANSCRIPTION_PROVIDER = 'assemblyai_streaming';
export const FALLBACK_TRANSCRIPTION_PROVIDER = 'openai_realtime';

/* What each provider entitles the runtime to. A provider without speaker
   labels cannot produce founder/prospect roles, so call_assist is simply not
   available on it — stated here rather than left as an assumption. */
export function providerCapabilities(id) {
  const p = TRANSCRIPTION_PROVIDERS[id];
  if (!p) return { known: false, canAttributeSpeakers: false, canFeedCallAssist: false };
  return {
    known: true,
    canAttributeSpeakers: p.diarization === true,
    canFeedCallAssist: p.diarization === true,
  };
}

export function resolveProvider(id) {
  return TRANSCRIPTION_PROVIDERS[id] || null;
}

/* Connection parameters for a diarizing AssemblyAI session. max_speakers is
   pinned to 2 because a sales call has two parties: telling the model that up
   front is documented to improve label accuracy, and a third label is a
   signal something is wrong rather than a person to accommodate. */
export function assemblyStreamingParams({ sampleRate = 16000, maxSpeakers = 2 } = {}) {
  return {
    speech_model: 'u3-rt-pro',
    speaker_labels: true,
    max_speakers: maxSpeakers,
    sample_rate: sampleRate,
    format_turns: true,
  };
}

/* ── ASSEMBLYAI TURN → THE SEGMENT SHAPE WE ALREADY MAP ────────────────
   AssemblyAI documents three things this has to respect rather than paper
   over:
     · a turn shorter than one second can come back as the literal string
       "UNKNOWN" — that is the model declining to identify, not a speaker;
     · early assignments are less stable, because it has little voice to go on;
     · overlapping speech is assigned wholesale to ONE speaker.
   The first is handled here by refusing to treat UNKNOWN as an identity. The
   other two are why calibration is a dedicated utterance spoken alone, and
   why an unstable third label collapses everything to unknown rather than
   being absorbed. */
export const ASSEMBLY_UNKNOWN_LABEL = 'UNKNOWN';
/* NOT EVERY NON-IDENTITY IS SPELLED "UNKNOWN". A live run returned PENDING
   for the opening turn — the diarizer had not settled who was speaking yet —
   and because only the literal UNKNOWN was recognised, PENDING was registered
   as a third speaker. Three speakers tripped the overflow guard, every role
   collapsed to unknown, and the call went from fully attributed to one turn
   in seven. The failure was safe and completely useless.

   These are placeholders, not people. */
export const ASSEMBLY_NON_IDENTITY = Object.freeze(['UNKNOWN', 'PENDING', 'UNDEFINED', 'NONE', '']);
export const isNonIdentity = (label) =>
  ASSEMBLY_NON_IDENTITY.includes(String(label || '').trim().toUpperCase());

export function assemblyTurnToSegment(turn) {
  if (!turn || typeof turn !== 'object') return null;
  if (turn.type !== 'Turn') return null;
  /* ONLY FINALISED TURNS BECOME SEGMENTS. A turn still being revised is the
     equivalent of a partial: useful on screen, never a committed attribution. */
  if (turn.end_of_turn !== true) return null;

  const text = typeof turn.transcript === 'string' ? turn.transcript.trim() : '';
  if (!text) return null;

  const label = typeof turn.speaker_label === 'string' ? turn.speaker_label : '';
  const words = Array.isArray(turn.words) ? turn.words : [];
  const finalWords = words.filter((w) => w && w.word_is_final === true);
  const start = finalWords.length && typeof finalWords[0].start === 'number' ? finalWords[0].start / 1000 : null;
  const end = finalWords.length && typeof finalWords[finalWords.length - 1].end === 'number'
    ? finalWords[finalWords.length - 1].end / 1000 : null;

  /* Word-level labels exist on final words. If they disagree with the turn
     label, the turn is not one speaker and must not be attributed to one. */
  const wordSpeakers = [...new Set(finalWords
    .map((w) => (typeof w.speaker === 'string' ? w.speaker : null))
    .filter(Boolean))];
  /* A PLACEHOLDER WORD IS NOT A SECOND SPEAKER. Every clean run of the live
     fixture returns the opening turn with words labelled ["PENDING", "A"] --
     the diarizer had not settled on the first syllable and then did. Counting
     PENDING as a distinct speaker made that turn "mixed" and threw it away,
     which silently burned the first of only two calibration attempts on every
     single call. Placeholders are dropped here for the same reason they are
     dropped at turn level: they are the model declining to answer yet. */
  const realWordSpeakers = wordSpeakers.filter((w) => !isNonIdentity(w));
  const mixed = realWordSpeakers.length > 1;

  const usable = label && !isNonIdentity(label) && !mixed;

  return {
    itemId: typeof turn.turn_order === 'number' ? `turn_${turn.turn_order}` : `turn_${text.slice(0, 12)}`,
    speaker: usable ? label : ASSEMBLY_UNKNOWN_LABEL,
    text, start, end,
    /* Kept so a report can say WHY something was unattributable rather than
       just that it was. */
    reason: usable ? null : (mixed ? 'mixed_word_speakers' : `provider_placeholder_label:${label || 'empty'}`),
    wordSpeakers,
  };
}

/* The event the existing diarization module understands. */
export function segmentEventFrom(assemblySegment) {
  if (!assemblySegment) return null;
  return {
    type: 'conversation.item.input_audio_transcription.segment',
    item_id: assemblySegment.itemId,
    speaker: assemblySegment.speaker,
    text: assemblySegment.text,
    start: assemblySegment.start,
    end: assemblySegment.end,
  };
}
