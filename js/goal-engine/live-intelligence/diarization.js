/* ════════════════════════════════════════════════════════════════════════
   WHO SAID IT — mapping diarized speakers onto founder and prospect.

   call_assist rests entirely on this. Its one load-bearing rule is that only
   the PROSPECT can establish a fact about their business and the FOUNDER
   saying something is a warning, not evidence. Get the speaker wrong and that
   rule inverts: the founder's assumption becomes the prospect's admission.

   So this module guesses at nothing. It does not read the words. It does not
   ask a model. It does not assume the first person to speak on a call is the
   founder — on a real call the prospect answers first. ONE explicit
   calibration utterance, spoken by the founder before dialling, establishes
   which diarized speaker is the founder. Everything else follows from that
   or is left unknown.

   UNKNOWN IS A REAL ANSWER HERE. A third speaker, a diarizer that changes its
   mind, a session with no calibration — each of those produces `unknown`
   rather than a best guess, because a wrong attribution is worse for the
   founder than a missing one.
   ══════════════════════════════════════════════════════════════════════ */

export const SEGMENT_EVENT = 'conversation.item.input_audio_transcription.segment';

export function createDiarization() {
  return {
    /* speakerId -> { firstSeen, segments } in first-seen order. */
    speakers: new Map(),
    segments: [],
    founderSpeakerId: null,
    prospectSpeakerId: null,
    calibrated: false,
    /* Set when the diarizer produces more distinct speakers than a two-party
       call can explain. Every later role becomes unknown. */
    overflow: false,
    /* Set when the calibration utterances -- which VISION KNOWS came from one
       mouth -- come back under different speaker labels. See below. */
    calibrationConflict: false,
    calibrationLabels: [],
  };
}

const str = (v) => (typeof v === 'string' ? v : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* Accepts a realtime `segment` event. Returns { accepted, speakerId }. */
export function applySegment(store, event) {
  if (!store || !event || typeof event !== 'object') return { accepted: false };
  if (event.type !== SEGMENT_EVENT) return { accepted: false };
  const itemId = str(event.item_id);
  const speakerId = str(event.speaker);
  const text = str(event.text);
  if (!itemId || !speakerId) return { accepted: false };

  /* A PROVIDER SAYING "UNKNOWN" IS NOT A THIRD PERSON.
     AssemblyAI returns the literal string UNKNOWN when a turn is under a
     second of audio — too little voice to identify. Registering that as a
     speaker would trip the overflow guard and collapse a perfectly good
     two-party call into unknown roles, which is the opposite of what the
     guard is for. It stays an unattributed segment instead. */
  /* Defence in depth: the provider adapter normalises placeholders, but this
     module must also refuse to treat one as a person if a future provider
     invents another name for "not sure yet". */
  if (['UNKNOWN', 'PENDING', 'UNDEFINED', 'NONE'].includes(speakerId.toUpperCase())) {
    store.segments.push({
      itemId, speakerId, text: text.trim(),
      start: num(event.start), end: num(event.end), index: store.segments.length,
    });
    return { accepted: true, speakerId, unattributed: true };
  }

  if (!store.speakers.has(speakerId)) {
    store.speakers.set(speakerId, { firstSeen: store.segments.length, segments: 0 });
    /* Two parties is the whole model of a sales call. A third distinct label
       means the diarizer is not telling us what we think it is, and the safe
       response is to stop asserting roles rather than to pick one. */
    if (store.speakers.size > 2) store.overflow = true;
  }
  store.speakers.get(speakerId).segments += 1;

  store.segments.push({
    itemId, speakerId, text: text.trim(),
    start: num(event.start), end: num(event.end),
    index: store.segments.length,
  });
  return { accepted: true, speakerId };
}

/* THE ONLY WAY A FOUNDER IS ESTABLISHED.
   Called with the item_id of the calibration utterance — the line the founder
   speaks alone, before the call. Whoever the diarizer says spoke it is the
   founder, and nothing else may set this. */
export function calibrateFounder(store, calibrationItemId) {
  if (!store) return { ok: false, reason: 'no_store' };
  const seg = store.segments.find((s) => s.itemId === calibrationItemId);
  if (!seg) return { ok: false, reason: 'calibration_utterance_not_found' };

  /* THE FIRST UTTERANCE IS WHERE DIARIZATION IS WEAKEST, and calibration is
     the first utterance -- which is the worst possible combination and exactly
     what the live run hit: AssemblyAI returned UNKNOWN for it, having no
     earlier voice to compare against, and the founder was pinned to the label
     "UNKNOWN".

     An unlabelled calibration is a FAILED calibration. It is not consumed, so
     the founder can simply say the line again; and roles stay unknown until
     one succeeds, which is the safe direction. Silently borrowing the next
     turn's label instead would have named the PROSPECT as the founder, since
     on a real call they answer first. */
  if (!seg.speakerId || seg.speakerId === 'UNKNOWN') {
    return { ok: false, reason: 'calibration_speaker_unknown', retryable: true };
  }

  store.calibrationLabels.push(seg.speakerId);

  /* ── THE ONE PIECE OF GROUND TRUTH ON THE WHOLE CALL ──────────────────
     VISION asked the founder to speak BOTH calibration lines, alone, before
     dialling. It therefore KNOWS the two utterances came from one mouth. If
     the diarizer returns two different labels for them, it is not mistaken
     about a detail -- it is demonstrably unable to track this voice, and
     every role it offers afterwards is worthless.

     This is not a heuristic and it reads no words. It is the only check on
     this path that can catch a diarizer which has drifted while still
     sounding confident, and it was built because a degraded capture produced
     exactly that: label A for the first calibration line and B for the
     second, after which the founder's own questions read as the prospect's
     answers. Refusing is the only correct response. */
  if (store.calibrated) {
    if (seg.speakerId !== store.founderSpeakerId) {
      store.calibrationConflict = true;
      return { ok: false, reason: 'calibration_speakers_disagree', conflict: true };
    }
    return { ok: true, founderSpeakerId: store.founderSpeakerId, confirmed: true };
  }

  store.founderSpeakerId = seg.speakerId;
  store.calibrated = true;
  return { ok: true, founderSpeakerId: seg.speakerId };
}

/* The other stable speaker is the prospect — but only once there is exactly
   one other, and only after calibration. Before that, nobody is the prospect:
   a call has not started. */
/* RECOMPUTED, NEVER CACHED. The first version latched the prospect the
   moment exactly one other speaker existed — which during a live call is
   true after the very first reply, before anyone else has spoken. In the live
   run that pinned the prospect to B while the founder's own label A was still
   to appear, and A then read as unknown for the rest of the call. A view of a
   conversation in progress must be recomputed from everything seen so far,
   not frozen at the first moment it looked unambiguous. */
export function resolveProspect(store) {
  if (!store || !store.calibrated || store.overflow || store.calibrationConflict) return null;
  const others = [...store.speakers.keys()].filter((id) => id !== store.founderSpeakerId);
  store.prospectSpeakerId = others.length === 1 ? others[0] : null;
  return store.prospectSpeakerId;
}

export function roleOf(store, speakerId) {
  if (!store || !store.calibrated || store.overflow || store.calibrationConflict) return 'unknown';
  if (speakerId && speakerId === store.founderSpeakerId) return 'founder';
  const prospect = resolveProspect(store);
  if (prospect && speakerId === prospect) return 'prospect';
  return 'unknown';
}

/* The shape a later step will hand to call_assist. NOT sent anywhere yet. */
export function diarizedTranscript(store) {
  if (!store) return [];
  resolveProspect(store);
  return store.segments.map((s) => ({
    itemId: s.itemId,
    speakerId: s.speakerId,
    role: roleOf(store, s.speakerId),
    text: s.text,
    start: s.start,
    end: s.end,
  }));
}

/* Did each voice keep one identity across the whole call? This is the
   question the live test exists to answer, so it is computed here rather
   than eyeballed from a log. */
export function stability(store) {
  const bySpeaker = new Map();
  for (const s of (store ? store.segments : [])) {
    if (!bySpeaker.has(s.speakerId)) bySpeaker.set(s.speakerId, []);
    bySpeaker.get(s.speakerId).push(s.index);
  }
  return {
    distinctSpeakers: bySpeaker.size,
    overflow: !!(store && store.overflow),
    calibrationConflict: !!(store && store.calibrationConflict),
    calibrationLabels: store ? store.calibrationLabels.slice() : [],
    perSpeaker: [...bySpeaker.entries()].map(([id, idx]) => ({
      speakerId: id, segments: idx.length, indexes: idx,
    })),
  };
}
