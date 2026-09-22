/* ════════════════════════════════════════════════════════════════════════
   WHAT A REHEARSAL LEAVES BEHIND.

   The behaviour engine already decides everything worth keeping — which turn
   lost pitch permission, which line invented a fact, when the objection
   surfaced. This turns those decisions into the rows the practice tables
   store, and does nothing else: it makes no judgement, assigns no score and
   invents no signal. Scoring is not built, and a module that quietly started
   grading turns would be building it by accident.

   PURE. No network, no clock beyond what it is handed, no storage. That is
   what makes the persisted shape testable without a database.
   ══════════════════════════════════════════════════════════════════════ */

const WORD = /[a-z0-9']+/g;
/* Words that carry no meaning for "did they follow the suggested wording".
   Kept small deliberately — an aggressive list flatters similarity. */
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at',
  'for', 'is', 'are', 'was', 'be', 'it', 'that', 'this', 'i', 'you', 'we', 'they', 'my', 'your',
  'our', 'have', 'has', 'do', 'does', 'not', 'with', 'about', 'would', 'will', 'can', 'if',
  'there', 'what', 'when', 'where', 'how', 'from', 'me', 'us', 'them', 'at', 'as', 'by']);

const bag = (t) => new Set(String(t || '').toLowerCase().match(WORD)?.filter((w) => !STOP.has(w) && w.length > 1) || []);

/* Jaccard over content words: bounded 0..1, symmetric, and unable to exceed 1
   however long either side is. */
export function similarity(a, b) {
  const A = bag(a); const B = bag(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  A.forEach((w) => { if (B.has(w)) hit += 1; });
  const union = new Set([...A, ...B]).size;
  return union ? Math.round((hit / union) * 100) / 100 : 0;
}

/* Which piece of the suggested approach this line most resembles, if any.
   A COACHING SIGNAL, NOT A VERDICT: high similarity is recorded, never
   penalised, because reading the suggested opening aloud is a legitimate
   thing for a founder to do on their first attempt. */
export function scriptSimilarity(text, script = {}) {
  const parts = [
    ['opening', script.opening], ['first_question', script.firstQuestion],
    ['pitch_bridge', script.pitchBridge], ['close', script.close],
  ].filter(([, v]) => typeof v === 'string' && v.trim());
  (Array.isArray(script.discovery) ? script.discovery : []).forEach((d, i) => {
    if (typeof d === 'string' && d.trim()) parts.push([`discovery_${i + 1}`, d]);
  });
  let best = { value: 0, against: null };
  parts.forEach(([key, value]) => {
    const s = similarity(text, value);
    if (s > best.value) best = { value: s, against: key };
  });
  return best;
}

/* ── WHOSE TURN ENDED IT ──────────────────────────────────────────────
   `founder_lost_the_conversation` is the OUTCOME, and it covers three
   different causes -- only two of which any single sentence is answerable
   for. Hostility and pressure are things the founder did on the turn the
   call ended on. Patience that simply ran out over a long call is nobody's
   one line, and naming a turn for it would accuse the founder of the one
   thing they did not do.

   Read from the state the turn produced, never re-derived from the words:
   the behaviour engine decides an ending in code, and this records which
   ending it decided. */
export const ENDED_BY_FOUNDER = Object.freeze(['hostility_from_founder', 'pushed_too_hard']);

/* The reverse of the tag written below, and it lives here because this is
   where the tag's FORMAT is decided. Three consumers read it -- the leak
   headline, the score ceiling and the result sentence -- and a parse copied
   into each of them is three places to forget when the format changes. */
export function endingReasonOf(turn) {
  const tag = ((turn && turn.detected_events) || [])
    .map(String).find((e) => e.indexOf('ended_because:') === 0);
  return tag ? tag.slice('ended_because:'.length) : null;
}

/* The turn a call ended on, if any turn ended it. */
export function endedByFounderTurn(turns = []) {
  return turns.find((t) => t && t.speaker === 'founder'
    && (t.detected_events || []).includes('conversation_ended_by_founder')) || null;
}

/* Founder-facing names for things the engine decided. No debug vocabulary:
   these are meant to be readable by whatever presents them later. */
export function detectedEvents(turn = {}, previous = {}) {
  const events = [];
  const before = previous.pitchPermission === true;
  const after = turn.closePermission === true;
  if (!before && after) events.push('pitch_permission_earned');
  if (before && !after) events.push('pitch_permission_lost');
  if (turn.activeObjection && !previous.activeObjection) events.push('objection_raised');
  if (!turn.activeObjection && previous.activeObjection) events.push('objection_cleared');
  if (turn.founderAction === 'unsupported_assumption') events.push('unsupported_assumption');
  if (turn.founderAction === 'high_value_follow_up') events.push('high_value_follow_up');
  if (turn.founderAction === 'premature_pitch') events.push('pitched_without_permission');
  if (turn.founderAction === 'repetition') events.push('question_repeated');
  if (turn.founderAction === 'pressure') events.push('pressure_applied');
  /* SEVERE HOSTILITY, RECORDED WHETHER OR NOT IT LANDED. The 30 ceiling used
     to depend on `conversation_ended_by_founder`, which only exists when the
     prospect actually terminated. Abuse on the final turn, or abuse a
     simulation survives, therefore escaped the ceiling entirely and scored
     as an ordinary call. This is the fact itself -- the founder spoke to
     them this way -- and it is true independently of what the prospect
     managed to do about it. */
  if (turn.founderAction === 'hostile') events.push('founder_hostility');
  if (turn.founderAction === 'close_request') events.push('close_attempted');
  if (turn.outcome === 'founder_lost_the_conversation') events.push('conversation_lost');
  /* THE TURN THE CALL ENDED ON, and only when this turn is what ended it.
     `conversation_lost` above is the outcome and stays exactly as it was;
     this is the accusation, and it is separate because only one of the two
     may be ranked as the thing that cost the call. */
  const endedReason = (turn.stateAfter && turn.stateAfter.endedReason) || null;
  if (turn.outcome === 'founder_lost_the_conversation' && ENDED_BY_FOUNDER.includes(endedReason)) {
    events.push('conversation_ended_by_founder');
    /* Not a claim -- the reason behind the one above, so the review can say
       which of the two it was without re-reading the transcript. */
    events.push(`ended_because:${endedReason}`);
  }
  return events;
}

/* WP1 OBSERVABILITY ONLY. Built from timing this file's caller already
   computes in memory (turn.timing, turn.serverTimings) -- nothing here
   measures anything itself, and nothing downstream reads what it returns.
   Missing on any exchange that predates this shape, or on any boundary that
   simply did not occur this turn (a hangup turn has no founderNextReadyAt),
   which is why every field is `?? null` rather than defaulted to a number
   that would read as a real measurement. */
function timingDetailFor(speaker, turn) {
  const t = turn && turn.timing;
  if (!t) return null;
  if (speaker === 'founder') {
    return {
      version: 'practice_turn_timing_v1',
      founderAudioEndAt: t.founderAudioEndAt ?? null,
      /* The app's own decideRelease() authority boundary, not the ASR
         provider's own end-of-turn signal -- transcriptSeenAt is stamped
         at the moment this file's release decision actually released the
         turn (see pump() around TA.decideRelease()). */
      releaseAt: t.transcriptSeenAt ?? null,
      requestSentAt: t.turnStart ?? null,
    };
  }
  const st = turn.serverTimings || null;
  return {
    version: 'practice_turn_timing_v1',
    modelMs: t.terraMs ?? null,
    ttsMs: t.ttsMs ?? null,
    /* ── WP10: THE SEMANTIC READ IS NO LONGER A SERVER TIMING ──────────
       These two used to come from turn.serverTimings, because the read ran
       inside the prospect response. WP8 moved it beside playback, and the
       response stopped carrying either -- so `semanticAttempted` had
       silently become a permanent `false`, asserting that no interpretation
       was attempted on turns where one ran and was applied. A field that
       always says no is worse than an absent one: it reads as evidence.

       Replaced by the two moments the client can actually witness.
       DISPATCHED says a read was asked for; APPLIED says it arrived in time
       to reach the rail before the founder could speak, which is the only
       version of "the founder was enriched" that is true. Both are null
       when the thing did not happen, never defaulted, so absence stays
       UNKNOWN rather than becoming a negative claim. */
    semanticDispatchedAt: t.semanticDispatchedAt ?? null,
    semanticAppliedAt: t.semanticAppliedAt ?? null,
    /* WP3, kept apart on purpose: prepMs runs BEFORE the prospect model and
       is latency the founder actually waits through, completeMs runs after
       the reply already exists and is not. Averaging them into one number
       would hide the only half that affects responsiveness. Null on a
       legacy-pinned session, which never calls either. */
    prepMs: (st && st.prepMs) ?? null,
    completeMs: (st && st.completeMs) ?? null,
    replyReadyAt: t.replyReady ?? null,
    firstAudioAt: t.firstAudio ?? null,
    audioCompleteAt: t.audioEnd ?? null,
    /* PHASE 1 FINALIZATION: audioCompleteAt alone cannot tell a line that
       finished playing from one cut off mid-way -- both get a timestamp.
       audioDeliveryOutcome is the missing fact: 'completed' | 'cut_short' |
       'never_started', set at the same point audioEnd is, from why finish()
       actually fired. Scoring reads this to refuse presenting an unheard or
       partially-heard generated prospect line as founder-heard context. */
    audioDeliveryOutcome: t.audioDeliveryOutcome ?? null,
    coachingRenderedAt: t.coachingRenderedAt ?? null,
    founderNextReadyAt: t.founderReady ?? null,
  };
}

/* The two rows one exchange produces. Provider internals stay out: no prompt,
   no token counts, no model name — only whether the wording was the model's
   and how long it took, which is what a founder-facing review can justify
   showing. */
export function turnRecords({ turn = {}, sequence = 0, script = {}, previous = {}, speechMs = null }) {
  const sim = scriptSimilarity(turn.founder, script);
  return [
    {
      sequence,
      speaker: 'founder',
      content: String(turn.founder || ''),
      founder_action: turn.founderAction || null,
      state_before: previous.state || null,
      state_after: turn.stateAfter || null,
      pitch_permission_before: previous.pitchPermission === true,
      pitch_permission_after: turn.closePermission === true,
      active_objection: turn.objection || null,
      detected_events: detectedEvents(turn, previous),
      script_similarity: sim.value || null,
      script_similarity_against: sim.against,
      simulated_facts: [],
      reply_source: null,
      model_latency_ms: null,
      speech_ms: null,
      timing_detail: timingDetailFor('founder', turn),
      model_reason: null,
    },
    {
      sequence: sequence + 1,
      speaker: 'prospect',
      content: String(turn.reply || ''),
      founder_action: null,
      state_before: previous.state || null,
      state_after: turn.stateAfter || null,
      pitch_permission_before: previous.pitchPermission === true,
      pitch_permission_after: turn.closePermission === true,
      active_objection: turn.objection || null,
      detected_events: [],
      script_similarity: null,
      script_similarity_against: null,
      /* MARKED FICTION, AND ONLY EVER ON THE PROSPECT'S OWN TURN. */
      simulated_facts: (turn.simulatedFacts || []).map((f) => ({
        text: typeof f === 'string' ? f : String(f && f.text || ''), simulated: true,
      })),
      reply_source: turn.source || null,
      model_latency_ms: (turn.timing && turn.timing.terraMs) || null,
      speech_ms: speechMs,
      timing_detail: timingDetailFor('prospect', turn),
      /* WP2: WHY, not just THAT, this reply fell back -- "disabled",
         "rejected:<codes>", or the provider failure reason, computed
         server-side (index.ts) and carried on the turn object since before
         this field existed, but never previously read here. Null on a real
         model-sourced reply: there is nothing to explain. */
      model_reason: turn.modelReason || null,
    },
  ];
}

/* ════════════════════════════════════════════════════════════════════════
   WORD-LEVEL EVIDENCE — facts, and nothing that sounds like a personality.

   Everything below is arithmetic on timings the transcriber already
   produced. It yields how fast, how long, how much silence — never how
   confident, how dominant or how trustworthy. Those are interpretations of
   evidence and they are not built.
   ══════════════════════════════════════════════════════════════════════ */

/* Compact on purpose: one row per word, four short keys. A ten-minute call
   is thousands of words and the long-form shape triples the payload. */
export function wordRows(words = []) {
  return words
    .filter((w) => w && typeof w.start === 'number' && typeof w.end === 'number')
    .map((w) => ({
      w: String(w.text || '').trim(),
      s: Math.round(w.start), e: Math.round(w.end),
      c: typeof w.confidence === 'number' ? Math.round(w.confidence * 100) / 100 : null,
    }))
    .filter((w) => w.w);
}

/* ONLY UNAMBIGUOUS DISFLUENCIES. "like", "you know" and "actually" are
   ordinary words far more often than they are fillers, and counting them
   would hand a future review a number that is wrong most of the time. */
const FILLER = /^(um|uh|erm|er|ah|mm|hmm|uhh|umm)$/i;
/* A gap this long inside one utterance is a pause a listener would notice. */
export const PAUSE_MS = 350;

export function deliveryFacts(words = [], { levels = [] } = {}) {
  const rows = wordRows(words);
  if (!rows.length) return null;
  const first = rows[0].s;
  const last = rows[rows.length - 1].e;
  const spokenMs = Math.max(0, last - first);

  const pauses = [];
  for (let i = 1; i < rows.length; i += 1) {
    const gap = rows[i].s - rows[i - 1].e;
    if (gap >= PAUSE_MS) pauses.push({ afterWord: i - 1, ms: gap });
  }
  const fillers = rows.filter((r) => FILLER.test(r.w.replace(/[^a-z]/gi, '')));
  const inWindow = levels.filter((l) => l && typeof l.rms === 'number');
  const rms = inWindow.map((l) => l.rms);
  const mean = rms.length ? rms.reduce((a, b) => a + b, 0) / rms.length : null;
  const sd = (rms.length && mean != null)
    ? Math.sqrt(rms.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rms.length) : null;

  return {
    wordCount: rows.length,
    spokenMs,
    /* Words per minute over the words actually spoken, not over the turn:
       a long silence before answering is a pause, not slow speech. */
    wpm: spokenMs > 0 ? Math.round((rows.length / (spokenMs / 60000)) * 10) / 10 : null,
    pauseCount: pauses.length,
    longestPauseMs: pauses.length ? Math.max(...pauses.map((p) => p.ms)) : 0,
    totalPauseMs: pauses.reduce((a, p) => a + p.ms, 0),
    fillerCount: fillers.length,
    fillers: fillers.map((f) => f.w.toLowerCase()),
    meanConfidence: (() => {
      const c = rows.map((r) => r.c).filter((x) => typeof x === 'number');
      return c.length ? Math.round((c.reduce((a, b) => a + b, 0) / c.length) * 100) / 100 : null;
    })(),
    /* Level, not "volume confidence". */
    levelMean: mean == null ? null : Math.round(mean * 10000) / 10000,
    levelVariation: sd == null ? null : Math.round(sd * 10000) / 10000,
    levelSamples: rms.length,
  };
}

/* ── THE TIMELINE ─────────────────────────────────────────────────────
   The one question a future review has to answer instantly: the founder
   clicked 02:13, what were they saying and where is that in the audio?

   Audio offsets and word timings share an origin — the moment the stream
   opened — so this is a lookup, not an estimate. */
export function resolveAtMs(turns = [], ms) {
  const t = Number(ms);
  if (!Number.isFinite(t)) return null;
  const inRange = turns.find((x) => x && typeof x.audio_start_ms === 'number'
    && typeof x.audio_end_ms === 'number' && t >= x.audio_start_ms && t <= x.audio_end_ms);
  if (!inRange) {
    /* Between turns is a real answer: it is the silence before somebody
       spoke, and a review that pretended otherwise would mislabel a pause. */
    const next = turns.filter((x) => x && typeof x.audio_start_ms === 'number' && x.audio_start_ms > t)
      .sort((a, b) => a.audio_start_ms - b.audio_start_ms)[0] || null;
    return { turn: null, word: null, audioOffsetMs: t, between: true,
      nextTurnSequence: next ? next.sequence : null };
  }
  const words = Array.isArray(inRange.words) ? inRange.words : [];
  const word = words.find((w) => t >= w.s && t <= w.e)
    || words.filter((w) => w.s <= t).slice(-1)[0] || null;
  return {
    turn: inRange,
    sequence: inRange.sequence,
    speaker: inRange.speaker,
    word: word ? word.w : null,
    wordIndex: word ? words.indexOf(word) : null,
    /* Where to seek. Identical to the transcript clock by construction. */
    audioOffsetMs: t,
    turnAudioStartMs: inRange.audio_start_ms,
    founderAction: inRange.founder_action || null,
    detectedEvents: inRange.detected_events || [],
    attemptNo: inRange.attempt_no,
    branch: inRange.branch,
    between: false,
  };
}
