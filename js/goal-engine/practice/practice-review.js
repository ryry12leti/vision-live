/* ════════════════════════════════════════════════════════════════════════
   THE REVIEW — what a founder reads after the call.

   READS the frozen systems and improves none of them. The score arrives
   already decided by the server rubric (practice_sales_v1_2); this chooses what to
   show, in what order, and how to say it. It never recomputes a number and
   never contradicts one.

   THE SCORE GETS ATTENTION. THE EVIDENCE CREATES TRUST. Every claim below
   points at a turn the founder can play back, because "you assumed instead
   of asking" is an accusation until they hear themselves do it.
   ══════════════════════════════════════════════════════════════════════ */
import { endingReasonOf, endedByFounderTurn } from './practice-evidence.js';

/* v2 (Phase 5 WP-2): the first-screen hierarchy — outcome, score, win,
   leak, the one improvement, mastery cue — with the deep detail behind the
   existing disclosure. A READ-TIME presentation version, deliberately not
   part of any cache key: buildReview runs on both the persisted and
   computed paths, so every legacy review gains the first screen for free,
   with zero recompute and zero spend. */
export const REVIEW_VERSION = 'practice_review_v2';

/* ── the bands, exactly as Phase 2B defined them ────────────────────── */
export const BANDS = Object.freeze([
  { min: 95, id: 'exceptional', label: 'Exceptional' },
  { min: 90, id: 'professional', label: 'Professional' },
  { min: 80, id: 'strong', label: 'Strong' },
  { min: 70, id: 'competent', label: 'Competent' },
  { min: 60, id: 'workable', label: 'Workable but weak' },
  { min: 40, id: 'poor', label: 'Poor' },
  { min: 0, id: 'not_ready', label: 'Not ready' },
]);
export function bandFor(score) {
  if (score == null) return null;
  return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];
}

/* ── what the prospect actually decided ─────────────────────────────── */
const OUTCOMES = Object.freeze({
  meeting_earned: { label: 'Meeting earned', tone: 'good' },
  follow_up_earned: { label: 'Follow-up earned', tone: 'good' },
  permission_to_continue_earned: { label: 'Permission to continue earned', tone: 'neutral' },
  qualified_opportunity: { label: 'Qualified opportunity', tone: 'good' },
  need_uncovered: { label: 'Need uncovered', tone: 'neutral' },
  prospect_declined: { label: 'Prospect declined', tone: 'bad' },
  not_a_fit: { label: 'Not a fit', tone: 'neutral' },
  founder_lost_the_conversation: { label: 'Conversation lost', tone: 'bad' },
});
/* ── WHEN A TURN ENDED IT, SAY SO ─────────────────────────────────────
   `founder_lost_the_conversation` is one label over three different
   endings, and "Conversation lost" is passive about every one of them. Where
   the behaviour engine attributed the ending to a turn IN CODE, that is a
   stronger fact than the outcome bucket and it replaces the label. Where it
   did not -- patience running out over a long call -- the bucket is still
   the most that is known and nothing here changes. */
const ENDED_LABEL = Object.freeze({
  hostility_from_founder: { label: 'They ended the call', tone: 'bad' },
  pushed_too_hard: { label: 'They ended the call', tone: 'bad' },
});
export function outcomeOf(code, endedReason = null) {
  return ENDED_LABEL[endedReason] || OUTCOMES[code] || { label: 'Practice ended', tone: 'neutral' };
}

/* ONE sentence, grounded in what actually happened. Outcome and execution
   stay separate: a simulated yes never rewrites poor execution as good. */
/* Deliberately NOT the sentence under the leak card. That one is about the
   turn -- what stopped being possible after it. This is about the CALL --
   what it was lost to. Saying the same thing in both places is the
   duplication this file has now fixed twice. */
const ENDED_BECAUSE = Object.freeze({
  hostility_from_founder: 'You lost this call to how you spoke to them, not to anything about the offer.',
  pushed_too_hard: 'You lost this call by pushing after they had already made their position clear.',
});
function explainResult(code, sales, patterns, endedReason = null) {
  const worst = (sales && Object.entries(sales)
    .filter(([, c]) => c && c.max && c.status !== 'not_tested')
    .sort((a, b) => (a[1].score / a[1].max) - (b[1].score / b[1].max))[0]) || null;
  const assumed = patterns.some((p) => p.type === 'assumes_instead_of_asking');
  const pressured = patterns.some((p) => p.type === 'pressure_after_no');

  if (code === 'not_a_fit') {
    return 'You established that there was no need here and stopped without forcing it. '
      + 'That is the right call when it is true.';
  }
  if (code === 'founder_lost_the_conversation') {
    /* FIRST, AND AHEAD OF THE PATTERN READS BELOW. `pressured` and `assumed`
       are counts over the whole call; this is the engine's own attribution
       of the ending. Behind them, a call ended by hostility was explained as
       a call that "ran out of road before you had established anything worth
       meeting about" -- which is true of the first four turns and silent
       about the one that ended it. */
    if (ENDED_BECAUSE[endedReason]) return ENDED_BECAUSE[endedReason];
    if (pressured) return 'You kept pushing after they had made their position clear, and lost the room.';
    if (assumed) return 'You lost ground by telling them things about their business they had not told you, '
      + 'and never rebuilt enough reason for them to continue.';
    return 'The conversation ran out of road before you had established anything worth meeting about.';
  }
  if (code === 'prospect_declined') {
    if (assumed) return 'You uncovered some useful ground, but lost permission after making assumptions '
      + 'they had not confirmed, and never rebuilt enough need to justify the meeting.';
    if (worst && worst[0] === 'close') return 'You asked for their time before establishing there was '
      + 'anything worth meeting about.';
    return 'You did not establish enough of a reason for them to give you more time.';
  }
  if (code === 'meeting_earned') {
    if (assumed || pressured) return 'They agreed to a meeting, but you got there on claims they never '
      + 'confirmed. That is a result you will struggle to repeat.';
    return 'You earned the next step by finding a real reason for it first.';
  }
  /* ── THE "EARNED" OUTCOMES NEED THEIR OWN SENTENCE ──────────────────
     These three fell through to the generic line below, which says the
     call ended without a clear next step -- directly contradicting the
     headline sitting immediately above it. Seen on a real staging call:
     "Follow-up earned" over "The call ended without a clear next step
     either way."

     Each sentence describes what the engine actually decided, which is
     WILLINGNESS, not a commitment captured: follow_up_earned is
     nextStepWillingness >= 0.4, qualified_opportunity is a real need plus
     permission to explain. So none of them claims the founder walked away
     with something booked -- that is `meeting_earned` above, and saying it
     here would be the same flattery in the opposite direction. */
  if (code === 'follow_up_earned') {
    if (assumed || pressured) return 'They were open to taking this further, but you got there on claims '
      + 'they never confirmed — and it was never pinned to a time or a name.';
    return 'They were open to a next step. You left without pinning it to a time or a name.';
  }
  if (code === 'qualified_opportunity') {
    if (assumed || pressured) return 'You established a real need and the right to explain it, but partly '
      + 'on claims they never confirmed, and nothing was settled about what happens next.';
    return 'You established a real need and earned the right to explain it. What you did not do is turn '
      + 'that into a next step.';
  }
  if (code === 'permission_to_continue_earned') {
    return 'They were willing to keep listening, but nothing was established yet about whether there is '
      + 'a problem here worth solving.';
  }
  return 'The call ended without a clear next step either way.';
}

/* ── WHAT THE DELIVERY METRICS ARE CALLED ─────────────────────────────
   Founder-facing names, decided here. `approachability` is the one that had
   to change: it reads as a judgement about whether the founder was someone a
   stranger would want to keep talking to, and it measures nothing of the
   kind -- it is average and longest turn length, and nothing else. On a real
   staging call it returned 20/20 for "Just shut up.", which is the correct
   answer to the question it asks and the wrong answer to the question its
   name asks. */
const DELIVERY_LABEL = Object.freeze({
  clarity: 'Clarity',
  approachability: 'Room to reply',
  pacing: 'Pacing',
  concision: 'Concision',
  composure: 'Composure',
  rhythm: 'Rhythm',
});

/* ── the moments worth showing ──────────────────────────────────────── */
const EVENT_LABELS = Object.freeze({
  high_value_follow_up: 'Strong follow-up',
  unsupported_assumption: 'Unsupported assumption',
  premature_pitch: 'Premature pitch',
  non_buyer_pitch: 'Pitched someone who cannot buy',
  pitch: 'Offer made',
  objection_exploration: 'Objection explored',
  close_request: 'Close attempted',
  professional_exit: 'Professional exit',
  pressure: 'Pressure applied',
  repetition: 'Question repeated',
  relevant_opening: 'Relevant opening',
});
/* What a founder-facing marker is allowed to be. Everything else is noise. */
const WIN_EVENTS = ['high_value_follow_up', 'objection_exploration', 'professional_exit', 'pitch', 'relevant_opening'];
const LEAK_EVENTS = ['pressure', 'non_buyer_pitch', 'unsupported_assumption', 'premature_pitch', 'repetition', 'close_request'];
/* Ranked by how much damage each does to the sale, worst first. */
/* `non_buyer_pitch` sits above everything except pressure: it is the one
   mistake that cannot be recovered later in the same call. */
const LEAK_RANK = ['pressure', 'non_buyer_pitch', 'unsupported_assumption', 'premature_pitch', 'close_request', 'repetition'];
const WIN_RANK = ['high_value_follow_up', 'objection_exploration', 'professional_exit', 'pitch', 'relevant_opening'];

/* A Guided attempt and the retry that replaced it occupy the SAME sequence,
   so a sequence cannot address one line. This can. */
const rowKey = (t) => `${t.sequence}:${Number(t.attempt_no) || 1}`;
const founderRows = (turns) => turns.filter((t) => t.speaker === 'founder' && t.branch !== 'superseded');
const mmss = (ms) => {
  const s = Math.max(0, Math.round((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* ── corrections that sound like the founder ────────────────────────── */
/* ── DELETED: THE SECOND COACHING AUTHOR (Phase 5 WP-1) ─────────────────
   A six-row generic wording library (`BETTER`) and its register picker
   lived here and stamped a "Try this instead" line onto every moment,
   client-side, from a fixed table — while the server's correctionPlan was
   independently deciding the state at that exact turn, the locked Best
   Move, and gated, composed wording for the same mistake. Two authors of
   "what you should have said", and the client one could contradict the
   server's move with generic advice in the most prominent slot.

   One author now: the wording a founder is shown comes from the matched
   server correction (same sequence+attempt matcher humanWhy already uses)
   or is ABSENT. Absence is honest; generic advice in the leading slot is
   not — the same rule the pipeline itself already applies when every
   candidate line fails the move gate (`wtsiAvailable: false`). */
function serverWording(sequence, attemptNo, corrections) {
  const c = (corrections || []).find((x) => x && x.sequence === sequence
    && (x.attemptNo || 1) === (attemptNo || 1));
  return (c && Array.isArray(c.couldSayInstead) && c.couldSayInstead[0]) || null;
}


/* A reconciled selection carries the decision -- which turn, on what
   authority, supported by which quote. This attaches the presentation the
   review already knows how to draw, and DECIDES NOTHING: if the Reconciler
   said there is no leak, this returns null rather than finding one. */
/* THE FOUNDER READS THIS. `reason` on a reconciled selection is a machine
   string -- `authority_disclaimed_at_4_then_pitched_at_5`,
   `admitted_by_judge_contract` -- written so a replay can be diffed, not so a
   person can be told what they did. Rendering it verbatim under their own
   quote is what the screen did the first time the authoritative selections
   were actually passed in, and it reads like a stack trace.

   So the explanation comes from the correction plan, which is the layer whose
   job is saying it in English, matched on the same turn. Where there is no
   card, there is no line -- a blank is better than a symbol. */
function humanWhy(selection, corrections) {
  const c = (corrections || []).find((x) => x && x.sequence === selection.sequence
    && (x.attemptNo || 1) === (selection.attemptNo || 1));
  return (c && (c.whatWasWrong || c.riskIfUnobserved)) || null;
}

/* `kind` decides what a card may borrow from the correction plan. The
   plan is FAULTS by construction, so only the LEAK card may take its
   explanation and wording — a WIN that happens to share a sequence with a
   correction (the judge may honestly select the same turn as both the most
   helpful and the most costly on a short call) must not wear a fault's
   diagnosis or its "Try this instead" (Phase 5 WP-4, seen on the organic
   certification call). A win keeps its headline, quote and revision note;
   its judge rationale stays machineReason, never rendered. */
function withMoment(selection, moments, corrections, kind) {
  if (!selection) return null;
  const m = moments.find((x) => x.rowId === selection.rowId)
    || moments.find((x) => x.sequence === selection.sequence);
  return {
    ...(m || {}),
    sequence: selection.sequence,
    rowId: selection.rowId || (m && m.rowId) || null,
    said: selection.said != null ? selection.said : (m ? m.said : null),
    atMs: selection.atMs != null ? selection.atMs : (m ? m.atMs : null),
    endMs: selection.endMs != null ? selection.endMs : (m ? m.endMs : null),
    seekMs: selection.seekMs != null ? selection.seekMs : (m ? m.seekMs : null),
    time: typeof selection.atMs === 'number' ? mmss(selection.atMs) : (m ? m.time : null),
    eventType: selection.eventType,
    authority: selection.authority,
    findingId: selection.findingId,
    citations: selection.citations || [],
    headline: selection.headline,
    why: kind === 'leak' ? humanWhy(selection, corrections) : null,
    /* Kept for owner diagnostics and replay diffs. Never rendered. */
    machineReason: selection.reason || null,
    /* WHEN THE FINAL READ DISAGREES WITH THE LIVE ONE. Computed once, in
       practice-pipeline.js's moment(), the moment revisedFromLive exists --
       this is a straight carry-through, not a second copy of the sentence
       table. `selection` (piped.win/piped.leak) already has it; `m` is the
       fallback for a card built from something other than selectWinLeak.
       Founder-safe, and null on every card the live and final reads agreed
       on, which is most of them. */
    revisionNote: selection.revisionNote != null ? selection.revisionNote
      : (m ? m.revisionNote : null),
    /* ONE AUTHOR. The matched server correction's own first gated line, or
       nothing — and only on the LEAK card; a correction can never be about
       a win. Never a client-side library, never profile-adapted here. */
    better: kind === 'leak' ? serverWording(selection.sequence, selection.attemptNo, corrections) : null,
  };
}

/* ── the build ──────────────────────────────────────────────────────── */
/* PHASE 7 SEAM — `authoritative`. Biggest Win and Biggest Leak used to be
   chosen here, from `founder_action` labels that had never been through the
   Reconciler, and a call with nothing wrong with it fell through to
   weakestGap() -- which manufactures a criticism out of the lowest-scoring
   category because the layout has a box for one. When the caller supplies
   reconciled selections they are used verbatim, and a `leak` of null stays
   null. Omit it and the legacy behaviour is unchanged. */
/* ── THE LABELS THE SERVER DECIDED ────────────────────────────────────
   The browser reads `practice_turns` directly, because it also needs the
   audio and the transcript, and those rows carry the labels the behaviour
   engine wrote LIVE. Reconciliation happens afterwards and on the server, so
   a row whose label the Reconciler replaced was redrawn here from the
   version it replaced -- a pitch convicted of the one CRITICAL fault in the
   system rendered as "Offer made", and not as a leak.

   The server owns the decision, so the server sends it and this applies it,
   once, before anything reads a turn. Missing or partial `scoredTurns`
   leaves the stored rows untouched: a score persisted before this existed
   still renders, with the labels it was written with.

   It lives here rather than in the screen because the screen is not the only
   caller, and two callers with two copies of this is the seam again. */
export function applyScoredLabels(rows = [], review = null) {
  const scored = (review && review.scoredTurns) || null;
  if (!Array.isArray(rows) || !Array.isArray(scored) || !scored.length) return rows || [];
  const by = new Map(scored.map((s) => [`${s.sequence}:${s.attempt_no || 1}`, s]));
  return rows.map((r) => {
    const s = by.get(`${r.sequence}:${r.attempt_no || 1}`);
    if (!s) return r;
    return { ...r, founder_action: s.founder_action,
      detected_events: s.detected_events || r.detected_events };
  });
}

export function buildReview({ review = {}, turns = [], audio = null,
  authoritative = null } = {}) {
  const sales = (review.categories && review.categories.sales) || {};
  const delivery = (review.categories && review.categories.delivery) || {};
  const patterns = review.majorPatterns || [];
  const rows = founderRows(turns);
  const insufficient = review.evidenceSufficiency === 'insufficient' || review.overall == null;
  /* Hoisted above the moments so their `better` can match against it. */
  const corrections = (authoritative && Array.isArray(authoritative.corrections))
    ? authoritative.corrections : [];

  /* MOMENTS. Only turns whose event is worth a founder's attention, and only
     where we can place them on the clock. */
  const moments = rows
    .filter((t) => EVENT_LABELS[t.founder_action] && typeof t.audio_start_ms === 'number')
    .map((t) => ({
      sequence: t.sequence,
      rowId: rowKey(t),
      action: t.founder_action,
      label: EVENT_LABELS[t.founder_action],
      atMs: t.audio_start_ms,
      endMs: t.audio_end_ms ?? null,
      /* Seek slightly early so the moment has run-up, never so early that a
         six-second mistake costs forty-five seconds of listening. */
      seekMs: Math.max(0, t.audio_start_ms - 2000),
      time: mmss(t.audio_start_ms),
      said: String(t.content || ''),
      isWin: WIN_EVENTS.includes(t.founder_action),
      isLeak: LEAK_EVENTS.includes(t.founder_action),
      /* ONE AUTHOR: the matched server correction's wording, or nothing.
         The client-side generic library that used to fill this slot for
         every labelled moment is gone (Phase 5 WP-1). */
      better: serverWording(t.sequence, t.attempt_no || 1, corrections),
      words: Array.isArray(t.words) ? t.words : [],
    }));

  /* BIGGEST WIN — the most call-changing good thing, not the highest number. */
  const wins = moments.filter((m) => m.isWin)
    .sort((a, b) => WIN_RANK.indexOf(a.action) - WIN_RANK.indexOf(b.action));
  const reconciledWin = authoritative && 'win' in authoritative;
  const reconciledLeak = authoritative && 'leak' in authoritative;
  const win = reconciledWin ? withMoment(authoritative.win, moments, corrections, 'win') : wins[0] ? {
    ...wins[0],
    headline: wins[0].action === 'high_value_follow_up' ? 'You followed the prospect instead of the script.'
      : wins[0].action === 'objection_exploration' ? 'You went at the objection instead of around it.'
        : wins[0].action === 'professional_exit' ? 'You left well rather than pushing a dead call.'
          : wins[0].action === 'pitch' ? 'You made the offer only once you had earned it.'
            : 'You opened with a reason they could act on.',
    why: (sales[wins[0].action === 'high_value_follow_up' ? 'listening'
      : wins[0].action === 'objection_exploration' ? 'objectionHandling'
        : wins[0].action === 'pitch' ? 'pitchTiming' : 'opening'] || {}).why || null,
  } : null;

  /* BIGGEST LEAK — sales damage outranks delivery imperfection, always. */
  const leaks = moments.filter((m) => m.isLeak)
    .filter((m) => m.action !== 'close_request'
      || (sales.close && sales.close.max && sales.close.score <= sales.close.max * 0.3))
    .sort((a, b) => LEAK_RANK.indexOf(a.action) - LEAK_RANK.indexOf(b.action));
  const leak = leaks[0] ? {
    ...leaks[0],
    headline: leaks[0].action === 'pressure' ? 'You pushed after they had said no.'
      : leaks[0].action === 'unsupported_assumption' ? 'You assumed instead of confirming.'
        : leaks[0].action === 'premature_pitch' ? 'You sold before they gave you a reason to.'
          : leaks[0].action === 'close_request' ? 'You asked for time you had not earned.'
            : 'You asked again for something they had already answered.',
    why: leaks[0].action === 'unsupported_assumption' ? 'They never told you that.'
      : leaks[0].action === 'premature_pitch' ? 'Nothing had been established that the offer answered.'
        : leaks[0].action === 'close_request' ? 'Nothing had been qualified that justified the meeting.'
          : leaks[0].action === 'pressure' ? 'They had already made their position clear.'
            : 'They had already given you that answer.',
    impact: impactOf(leaks[0], turns),
  } : (insufficient ? null : weakestGap(sales));
  const finalLeak = reconciledLeak ? withMoment(authoritative.leak, moments, corrections, 'leak') : leak;

  /* GUIDED — the attempt and the retry, each with its OWN audio range. */
  const guided = turns
    .filter((t) => t.speaker === 'founder' && t.branch === 'superseded')
    .map((first) => {
      const retry = turns.find((t) => t.speaker === 'founder' && t.sequence === first.sequence
        && Number(t.attempt_no) > 1);
      const reason = ((first.detected_events || [])
        .find((e) => /^coached:/.test(e)) || '').replace('coached:', '') || first.founder_action;
      return {
        sequence: first.sequence, time: mmss(first.audio_start_ms ?? 0), reason,
        label: EVENT_LABELS[first.founder_action] || 'Coached moment',
        attempt: { said: String(first.content || ''), atMs: first.audio_start_ms ?? null,
          endMs: first.audio_end_ms ?? null, seekMs: Math.max(0, (first.audio_start_ms ?? 0) - 1000),
          rowId: rowKey(first) },
        retry: retry ? { said: String(retry.content || ''), atMs: retry.audio_start_ms ?? null,
          endMs: retry.audio_end_ms ?? null, seekMs: Math.max(0, (retry.audio_start_ms ?? 0) - 1000),
          rowId: rowKey(retry),
          accepted: (retry.detected_events || []).some((e) => /^retry_accepted/.test(e)) } : null,
      };
    });

  /* SCRIPT RELIANCE — described, never re-scored. */
  const sr = review.scriptReliance || {};
  const listening = sales.listening || {};
  const scriptReliance = sr.overall == null ? null : {
    overall: sr.overall,
    breakdown: [['Opening', sr.opening], ['Discovery', sr.discovery], ['Pitch', sr.pitch], ['Close', sr.close]]
      .filter(([, v]) => typeof v === 'number'),
    interpretation: (listening.max && listening.score <= listening.max * 0.35)
      ? 'You stayed close to the suggested wording after the prospect introduced something new. '
        + 'That is a listening problem, not a scripting one.'
      : (sr.overall >= 60
        ? 'You leaned on VISION’s wording, and adapted once they started answering. That is fine.'
        : 'You mostly used your own words.'),
  };

  /* DELIVERY READ — plain English over the metrics Phase 2B supports. */
  const stats = review.deliveryStats || null;
  const deliveryRead = {
    categories: Object.entries(delivery).map(([k, v]) => ({
      key: k, ...v,
      /* THE SERVER NAMES ITS OWN METRICS. The browser was title-casing the
         key, so the founder read the internal name of every one of these. */
      label: DELIVERY_LABEL[k] || (k.charAt(0).toUpperCase() + k.slice(1)),
      /* Already computed by the rubric as `why`, already sent, and never
         rendered. Each of these says what was actually measured. */
      measured: v && v.why ? v.why : null,
    })),
    interpretation: deliveryLine(delivery, patterns),
    /* WHAT THIS SECTION IS, said once, where it cannot be missed.
       Approachability is turn LENGTH -- it asks whether the founder left
       room for a reply -- so a curt insult scores full marks on it, and on
       a real call one did: 20/20 on the turn the prospect hung up over.
       The number is not wrong; it was measuring something the founder had
       no way to know it was measuring. Naming it fixes that. Zeroing it on
       the wording would not: it would make one metric secretly stand for
       two things and leave the rest of the section just as unexplained. */
    basis: 'Measured from your voice and the shape of your turns — speed, pauses, '
      + 'filler words and how long you spoke for. Not from what you said; that is scored above.',
    /* Named so nothing downstream invents them. */
    unscored: review.unscored || [],
  };

  /* ── HOW MUCH OF THE RUBRIC THE CALL ACTUALLY REACHED ────────────────
     `thin` is a statement about VISION'S EVIDENCE, not about the founder —
     but it was never shown to them, so a perfectly good seven-turn rehearsal
     came back marked thin with nothing saying why. It reads as "your call
     was weak" when it means "a quarter of what I grade never came up".

     Those are opposite messages, and the honest one is cheap: name the parts
     that never happened, and say what would have brought them into play. The
     threshold itself is untouched — moving it to make the number look better
     would be the one thing this engine must never do. */
  const COVER = {
    opening: { name: 'Your opening', how: 'Give them a reason you called that they can act on.' },
    discovery: { name: 'Discovery', how: 'Ask something specific about how they work.' },
    listening: { name: 'Listening', how: 'Build your next question on what they just said.' },
    grounding: { name: 'Staying grounded', how: 'Only state things they have actually told you.' },
    pitchTiming: { name: 'Pitch timing', how: 'Reach the point where explaining the offer is earned.' },
    objectionHandling: { name: 'Objection handling', how: 'Stay in long enough for them to push back.' },
    qualification: { name: 'Qualification', how: 'Establish there is a problem worth solving.' },
    close: { name: 'The close', how: 'Ask for a next step, or leave the call cleanly.' },
  };
  const untested = Object.entries(sales)
    .filter(([k, c]) => COVER[k] && c && c.status === 'not_tested')
    .map(([k]) => ({ key: k, name: COVER[k].name, wouldTest: COVER[k].how }));
  const coverage = {
    complete: untested.length === 0,
    testedWeight: typeof review.testedWeight === 'number' ? review.testedWeight : null,
    untested,
    explanation: untested.length
      ? (untested.length === 1
        ? `${untested[0].name} never came up on this call, so it is not part of the score.`
        : `${untested.length} parts of the call never came up, so they are not part of the score.`)
      : null,
  };

  /* WHICH ENDING, READ FROM THE TURNS THE FOUNDER CAN SEE. Not from the
     outcome bucket, which cannot tell the three apart, and not from the
     simulator, which the browser does not have. */
  const endedReason = endingReasonOf(endedByFounderTurn(turns));

  /* NEXT TRAINING MOVE — one focus, drawn from the leak. */
  const next = nextMove(finalLeak, patterns, sales, insufficient);

  return {
    reviewVersion: REVIEW_VERSION,
    rubricVersion: review.rubricVersion || null,
    insufficient,
    result: { code: review.outcome || null, ...outcomeOf(review.outcome, endedReason),
      endedReason,
      explanation: insufficient
        ? 'This practice ended before VISION had enough conversation to judge execution fairly.'
        : explainResult(review.outcome, sales, patterns, endedReason) },
    scores: insufficient ? null : {
      overall: review.overall, sales: review.sales, delivery: review.delivery,
      band: bandFor(review.overall),
    },
    win, leak: finalLeak, corrections, moments, guided, patterns, scriptReliance,
    delivery: deliveryRead, next, coverage,
    /* ── WHERE THE FINAL READ DISAGREES WITH THE LIVE ONE ─────────────
       Guided reports a turn the instant it happens, off the deterministic
       engine alone. The Reconciler runs afterwards with the whole call and
       a model behind it, and is allowed to overrule it in either
       direction. Both are legitimate; the silence between them was not.

       Seen on a blind call: mid-call the founder was told "Trust up: you
       opened up their objection instead of talking past it", and the
       review then scored Objection handling 0/15 -- "the objection was
       talked past rather than understood." Same turn, opposite verdicts,
       nothing acknowledging that VISION had changed its mind. A founder
       who notices that stops believing both numbers.

       DELETED in Phase 5 WP-0 (defect D): `revisedFromLive` never survives
       the wire -- piped.scoredTurns carries only founder_action and
       detected_events, and applyScoredLabels copies exactly those two -- so
       this list was empty on every real review since it shipped. The story
       it wanted to tell reaches the screen through the win/leak/correction
       cards' own server-side `revisionNote` ("Since the call"), which does
       arrive. */
    liveReversals: [],
    audio: { available: !!(audio && audio.available), durationMs: (audio && audio.durationMs) || null },
    transcript: turns.map((t) => ({
      sequence: t.sequence, rowId: rowKey(t), speaker: t.speaker, said: String(t.content || ''),
      atMs: typeof t.audio_start_ms === 'number' ? t.audio_start_ms : null,
      endMs: typeof t.audio_end_ms === 'number' ? t.audio_end_ms : null,
      time: typeof t.audio_start_ms === 'number' ? mmss(t.audio_start_ms) : null,
      event: EVENT_LABELS[t.founder_action] || null,
      coachedAttempt: t.branch === 'superseded',
      /* Only what the transcriber actually returned. A turn with no word
         timings gets none here -- the line still highlights, the words
         simply are not claimed to be placed. */
      words: Array.isArray(t.words)
        ? t.words.filter((w) => w && typeof w.s === 'number')
          .map((w) => ({ w: String(w.w == null ? '' : w.w), s: w.s, e: typeof w.e === 'number' ? w.e : w.s }))
        : [],
    })),
  };
}

/* A CLEAN CALL STILL HAS A WEAKEST POINT. When nothing went materially
   wrong there is no moment to play, so the founder gets the category they
   lost most ground in -- stated as a gap, with no quote and no timestamp,
   because inventing a damning moment that did not happen is worse than
   saying "nothing broke, here is where you were thinnest".

   A CLEAN CALL AND AN EMPTY ONE ARE NOT THE SAME THING, which is why the
   caller gates this on `insufficient`. A category scored 0/12 because the
   founder never got to it reads here as the weakest category, and the review
   accused a founder of losing ground on discovery in the same breath as
   admitting it had not heard enough of the call to judge. Two claims that
   cannot both be true, in one screen. */
function weakestGap(sales) {
  const entries = Object.entries(sales)
    .filter(([, c]) => c && c.max && c.status !== 'not_tested');
  if (!entries.length) return null;
  const [key, c] = entries.sort((a, b) => (a[1].score / a[1].max) - (b[1].score / b[1].max))[0];
  if (c.score / c.max >= 0.9) {
    return { kind: 'none', headline: 'Nothing went materially wrong here.',
      why: 'No single moment cost you the call.', action: null, atMs: null, said: null, better: null };
  }
  const NAME = { opening: 'your opening', discovery: 'your discovery', listening: 'your listening',
    grounding: 'staying grounded', pitchTiming: 'pitch timing', objectionHandling: 'objection handling',
    qualification: 'qualification', close: 'the close' };
  return {
    kind: 'gap', action: null, atMs: null, said: null, time: null, better: null,
    headline: `You lost most ground on ${NAME[key] || key}.`,
    why: c.why || null,
    impact: null,
  };
}

/* Only claimed where the evidence actually shows it. */
function impactOf(leakMoment, turns) {
  const after = turns.filter((t) => t.speaker === 'founder' && t.sequence > leakMoment.sequence);
  const lost = after.some((t) => (t.detected_events || []).includes('pitch_permission_lost'))
    || (turns.find((t) => t.sequence === leakMoment.sequence
      && t.pitch_permission_before === true && t.pitch_permission_after === false));
  return lost ? 'Pitch permission was lost from this point in the conversation.' : null;
}

function deliveryLine(delivery, patterns) {
  if (patterns.some((p) => p.type === 'rushes_the_pitch')) {
    const p = patterns.find((x) => x.type === 'rushes_the_pitch');
    return p.why;
  }
  const weakest = Object.entries(delivery)
    .filter(([, v]) => v && v.max)
    .sort((a, b) => (a[1].score / a[1].max) - (b[1].score / b[1].max))[0];
  if (!weakest) return null;
  const [key, v] = weakest;
  if (v.score / v.max >= 0.8) return 'Your delivery held up across the call.';
  const say = {
    clarity: 'Some of what you said was harder to follow than it needed to be.',
    approachability: 'Your answers ran long enough to make it harder for them to get a word in.',
    pacing: 'Your speed moved around enough to be noticeable.',
    concision: 'You said more than the question needed in places.',
    composure: 'Your level and pace shifted noticeably during the call.',
    rhythm: 'You left less room than usual for them to answer.',
  };
  return say[key] || null;
}

function nextMove(leak, patterns, sales, insufficient = false) {
  const FOCUS = {
    unsupported_assumption: { focus: 'unsupported_assumption', headline: 'Stop assuming. Start confirming.',
      why: 'Your largest leak came from turning unknowns into statements.' },
    premature_pitch: { focus: 'premature_pitch', headline: 'Earn the pitch before you make it.',
      why: 'You went to the offer before they had given you a reason for it.' },
    non_buyer_pitch: { focus: 'non_buyer_pitch', headline: 'Find out who decides before you sell.',
      why: 'They told you the decision was not theirs, and you made the case to them anyway.' },
    close_request: { focus: 'unearned_close', headline: 'Qualify before you ask for time.',
      why: 'You asked for a meeting before establishing there was anything to meet about.' },
    pressure: { focus: 'pressure_after_no', headline: 'Take the no, and leave the door open.',
      why: 'You kept pushing after they had made their position clear.' },
    repetition: { focus: 'dead_question', headline: 'Use what they already told you.',
      why: 'You asked again for answers you had already been given.' },
  };
  /* A REAL MOMENT SPEAKS FOR ITSELF, however short the call was. `leak.action`
     is only set when there is an actual quoted, timestamped turn behind it,
     so a founder who pitched too early in a three-turn rehearsal is still
     told to earn the pitch — that is evidence, not a fallback. */
  if (leak && FOCUS[leak.action]) return FOCUS[leak.action];

  /* NOT ENOUGH CALL TO DIAGNOSE IS NOT A DIAGNOSIS. Everything below this
     line INFERS a weakness rather than pointing at one, and the last branch
     names discovery unconditionally -- so a rehearsal that produced no
     conversation at all came back telling the founder their discovery was
     thin. That said nothing about them and everything about the fallback.
     With no moment to point at and no evidence to read, the honest
     instruction is to go again. */
  if (insufficient) {
    return { focus: null, headline: 'Run the call again, and let it go longer.',
      why: 'There was not enough conversation here for VISION to tell you anything true about how you sell.' };
  }
  const pat = patterns[0];
  if (pat && FOCUS[pat.type === 'assumes_instead_of_asking' ? 'unsupported_assumption' : '']) {
    return FOCUS.unsupported_assumption;
  }
  const weakest = Object.entries(sales)
    .filter(([, c]) => c && c.max && c.status !== 'not_tested')
    .sort((a, b) => (a[1].score / a[1].max) - (b[1].score / b[1].max))[0];
  if (weakest && weakest[0] === 'listening') {
    return { focus: 'dead_question', headline: 'Listen, then ask.',
      why: 'Your weakest area was building on what the prospect actually said.' };
  }
  /* THE TERMINAL FALLBACK IS A DEFAULT DRILL, NOT A DIAGNOSIS. This branch
     is only reached when no leak carries a drillable action — and it used
     to say "Your discovery stopped short of anything you could sell
     against", a diagnosis-shaped sentence about a call that showed no such
     thing (Phase 5 WP-1). The drill target stays (deeper discovery pays on
     every call); the copy stops pretending it was observed.

     LEAK-AWARE (WP-2 visual QA): a leak with no timeline moment — every
     recording-deleted review — also lands here, and "nothing stood out to
     fix" directly under a leak card was a screen contradicting itself. The
     no-leak sentence is only said when there is no leak. */
  const quiet = !leak;
  return { focus: 'discovery', headline: 'Go deeper before you go wider.',
    why: quiet
      ? 'Nothing on this call stood out to fix. Deeper discovery is the practice that pays on every call, so it is the default drill.'
      : 'Deeper discovery is the practice that pays on every call, so it is the default drill.' };
}
