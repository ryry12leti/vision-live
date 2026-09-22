/* ════════════════════════════════════════════════════════════════════════
   ONE FOUNDER THOUGHT IS ONE TURN.

   The transcriber finalises a turn on its own clock. On this corpus it never
   held one longer than 9063 ms, and three separate sentences in a single call
   came back at exactly 8998 ms -- a fixed capture window, not natural speech.
   Everything after the cut arrived as a SECOND turn: "appointment.",
   "the right problem?", "Through the door?". Each of those was answered by the
   prospect, scored as a founder turn, and in one case credited as a strong
   follow-up.

   So the transcriber's turn is treated here as a FRAGMENT, and a founder turn
   is something this file assembles out of fragments. Two independent signals
   say a fragment is a continuation rather than a new thought:

     GAP   -- on the measured corpus every continuation landed 66-376 ms after
              the previous fragment ended, while every genuine new turn was
              20.5-24.7 s later. Fifty times' separation. A sub-second gap
              between two founder fragments is a cut.

     SHAPE -- a thought that ends on "so can", "how are", "for an", "Does that"
              is not finished, whatever the clock says. Only closed-class words
              count: conjunctions, articles, prepositions, auxiliaries. A
              fragment ending on a noun is not called incomplete on shape alone.

   Nothing here judges selling. It decides where a sentence ends.
   ══════════════════════════════════════════════════════════════════════ */

export const ASSEMBLY_VERSION = 'practice_turn_assembly_v1';

/* A sub-second gap is a cut, whatever the words look like. */
export const CUT_GAP_MS = 1000;
/* With the shape of an unfinished thought, wait longer -- a founder pausing
   mid-sentence to think is still mid-sentence. */
export const DANGLE_GAP_MS = 3000;
/* How long a finalised fragment is held before the prospect may answer it.
   Sized off the measured continuation gaps (worst 376 ms) with margin. */
export const SETTLE_MS = 600;
/* An unfinished-looking fragment is given longer before we accept that the
   founder simply stopped there. */
export const DANGLE_SETTLE_MS = 2200;
/* ── THE TWO CLOCKS ──────────────────────────────────────────────────────
   SETTLE_MS above is a WALL-CLOCK window sized from AUDIO-CLOCK measurements,
   and those two only agree once the founder has stopped talking. Measured
   live on canonical staging, 2026-08-22: the provider cut a 13.0 s thought at
   8.901 s and a 21.0 s thought at 8.917 s. The audio-clock gaps to the
   continuations were 146 ms and 33 ms — both far inside CUT_GAP_MS, so
   shouldMerge() would have joined them. But the continuation did not ARRIVE
   for another ~3.2 s, because the founder was still saying it. 2200 ms of
   dangle settle expired first, the half-sentence was released, the prospect
   answered it, and the microphone muted mid-sentence — which then ate the
   rest of the turn ("...who ends up carrying it when" → the next 8 seconds
   never reached VISION at all).

   No wall-clock window can fix that, because the thing being waited for is
   not late: it has not been spoken yet. So the release also waits on a
   DIFFERENT signal — is the founder audibly still going — and the wall-clock
   windows become what they always were: how long to wait once they HAVE
   stopped. */
export const MAX_HOLD_MS = 30000;
/* ── THE CEILING ─────────────────────────────────────────────────────────
   A fragment this long was ended by the PROVIDER'S duration clock, not by
   the person talking. Measured on canonical staging with AssemblyAI
   u3-rt-pro (2026-08-22): every cut fragment came back at 8.901, 8.917,
   8.998 or 9.079 s, while the longest fragment a founder actually finished
   was 8.352 s. The threshold sits in that gap. */
export const CEILING_MS = 8600;
/* HOW LONG A CUT FRAGMENT WAITS FOR ITS OWN SECOND HALF.

   This is not a stylistic pause — it is the provider's delivery latency, and
   it was measured rather than guessed: finalised transcripts reached the
   browser 3.06-6.55 s after the audio they describe had ended (median 4.63,
   n=12, same run). DANGLE_SETTLE_MS was 2200 ms, so a cut fragment was
   ALWAYS released before its continuation could physically arrive, however
   obviously unfinished it looked. That is the whole defect: not a window
   sized too tight for speech, but one sized shorter than the network.

   Paid in full only when there is genuinely nothing more to come. The moment
   a continuation lands, pump() re-runs, shouldMerge() joins them on the
   sub-second audio gap, and the joined turn releases on the normal window.

   MEASURED FROM THE MOMENT THE FOUNDER GOES QUIET, not from when the
   fragment arrived — because those differ by however long they kept talking.
   A 21.0 s thought comes back as two ceiling-length fragments, and the
   second one cannot arrive until it has been spoken (9 s) AND delivered
   (up to 6.5 s). Timed from the first fragment's arrival, 8 s expired 1 s
   too early and the thought still broke in half. Timed from silence, the
   wait is only ever the delivery tail. */
export const CUT_SETTLE_MS = 8000;
/* Below this, a turn may be recorded but must never earn positive credit. */
export const MIN_CREDIT_CONFIDENCE = 0.55;

/* Closed-class words only. Every one of these leaves a sentence unfinished;
   none of them is a plausible last word. Content words are deliberately
   absent -- "getting new patients" is a complete question, and the gap test
   is what catches that case. */
const DANGLING_WORDS = [
  /* conjunctions and subordinators */
  'and', 'but', 'so', 'or', 'nor', 'yet', 'because', 'if', 'when', 'while',
  'since', 'although', 'though', 'unless', 'until', 'whether', 'that', 'as',
  /* determiners */
  'the', 'a', 'an', 'my', 'your', 'our', 'their', 'its', 'this', 'these',
  'those', 'some', 'any', 'every', 'no',
  /* prepositions */
  'to', 'of', 'for', 'with', 'at', 'on', 'in', 'from', 'by', 'into', 'onto',
  'about', 'over', 'under', 'between', 'through', 'during', 'without',
  'within', 'upon', 'toward', 'towards', 'than', 'like', 'against', 'around',
  /* auxiliaries and modals */
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does',
  'did', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might',
  'must', 'have', 'has', 'had',
  /* wh-words left hanging */
  'how', 'what', 'why', 'who', 'which', 'where',
];
const DANGLING = new Set(DANGLING_WORDS);

const clean = (t) => String(t == null ? '' : t).trim();
const lastWord = (t) => {
  const m = clean(t).toLowerCase().match(/([a-z']+)[^a-z']*$/i);
  return m ? m[1] : '';
};

/* Does this fragment read as an unfinished thought? */
export function isDangling(text) {
  const t = clean(text);
  if (!t) return true;
  /* An em dash or trailing ellipsis is the transcriber saying it cut. */
  if (/[-–—]\s*$/.test(t) || /\.\.\.$/.test(t)) return true;
  /* A CLOSED SENTENCE IS CLOSED, whatever its last word is. Plenty of finished
     questions end on a preposition -- "where are they coming from?", "what are
     you looking for?" -- and reading those as unfinished would hold every one
     of them for the full timeout while the founder waited. The sub-second gap
     test remains the backstop for the rare cut the formatter punctuated. */
  if (/[.?!]["')\]]?$/.test(t)) return false;
  return DANGLING.has(lastWord(t));
}

/* Does this fragment read as the back half of the previous one? A capitalised
   "I" is not evidence of anything, so it is excluded. */
export function looksContinuation(text) {
  const t = clean(text);
  if (!t) return false;
  const first = t.match(/^([A-Za-z']+)/);
  if (!first) return false;
  const w = first[1];
  if (w === 'I') return false;
  return w[0] === w[0].toLowerCase();
}

/* Two adjacent founder fragments, and whether they are one thought.
   `gapMs` is null when the provider gave no timings; shape alone then has to
   carry it, which it may only do for a clearly unfinished head. */
export function shouldMerge(head, tail, opts = {}) {
  if (!head || !tail) return { merge: false, reason: 'missing' };
  if (head.role !== 'founder' || tail.role !== 'founder') {
    return { merge: false, reason: 'not_founder' };
  }
  const cutGap = opts.cutGapMs ?? CUT_GAP_MS;
  const dangleGap = opts.dangleGapMs ?? DANGLE_GAP_MS;
  const gapMs = (typeof head.end === 'number' && typeof tail.start === 'number')
    ? Math.round((tail.start - head.end) * 1000) : null;
  if (gapMs != null && gapMs < 0) return { merge: false, reason: 'out_of_order' };

  /* A REPLY INSIDE A SUB-SECOND GAP IS THE BUG, NOT A BOUNDARY. Going
     forward the prospect can never answer an unfinished turn, so a reply
     between two founder fragments genuinely separates them. A corpus recorded
     BEFORE that guarantee is different: nobody speaks, is heard, and is
     answered inside 81 ms. Reading those replies as boundaries would leave
     every historical fragment permanently unrepairable, so `retro` lets the
     audio clock overrule them -- and only for gaps too short to be real. */
  const fragmentReply = tail.prospectBetween && opts.retro === true
    && gapMs != null && gapMs <= cutGap;
  if (tail.prospectBetween && !fragmentReply) {
    return { merge: false, reason: 'prospect_spoke_between', gapMs };
  }
  if (gapMs != null && gapMs <= cutGap) {
    return { merge: true, reason: fragmentReply ? 'answered_a_fragment' : 'sub_second_gap', gapMs };
  }
  const dangles = isDangling(head.text);
  const continues = looksContinuation(tail.text);
  if ((dangles || continues) && (gapMs == null || gapMs <= dangleGap)) {
    return { merge: true, reason: dangles ? 'unfinished_head' : 'lowercase_tail', gapMs };
  }
  return { merge: false, reason: 'separate_thought', gapMs };
}

/* Join fragment text without inventing punctuation. */
function joinText(a, b) {
  const left = clean(a).replace(/[-–—]\s*$/, '').replace(/\.\.\.$/, '');
  const right = clean(b);
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`.replace(/\s+/g, ' ').trim();
}

/* How much this assembled turn can be trusted as a faithful record of one
   spoken thought. Not a sales judgement -- an evidence-quality number. */
export function confidenceOf(turn) {
  let c = typeof turn.providerConfidence === 'number' ? turn.providerConfidence : 0.9;
  /* Released only because we stopped waiting, still looking unfinished. */
  if (turn.danglingAtRelease) c -= 0.45;
  /* No measured audio at all is what every fragment in the corpus looked like. */
  if (turn.levelMean === 0) c -= 0.4;
  if (turn.parts > 1) c -= 0.05 * (turn.parts - 1);
  const words = turn.text ? clean(turn.text).split(/\s+/).filter(Boolean).length : 0;
  if (words <= 2) c -= 0.25;
  return Math.max(0, Math.min(1, Math.round(c * 100) / 100));
}

/* ── OFFLINE ─────────────────────────────────────────────────────────────
   Assemble a whole call's fragments. Used by the tests, and to re-read a
   corpus that was recorded before any of this existed. Exact audio spans and
   word timings are preserved: the first fragment's start and the last one's
   end become the turn's, and nothing is resampled. */
export function assembleTurns(rows, opts = {}) {
  const out = [];
  let lastFounder = -1;             /* index in `out` of the open founder turn */
  let prospectSince = false;        /* did the prospect speak since it opened?  */
  let answeredFragments = 0;

  (rows || []).forEach((row) => {
    if (row.role !== 'founder') {
      out.push({ ...row, parts: 1, partIds: [row.itemId], merged: false });
      if (lastFounder >= 0) prospectSince = true;
      return;
    }
    const prev = lastFounder >= 0 ? out[lastFounder] : null;
    const decision = prev
      ? shouldMerge({ ...prev, role: 'founder' }, { ...row, prospectBetween: prospectSince }, opts)
      : { merge: false, reason: 'first_founder_fragment' };

    if (decision.merge) {
      prev.text = joinText(prev.text, row.text);
      if (typeof row.end === 'number') prev.end = row.end;
      prev.parts += 1;
      prev.partIds.push(row.itemId);
      prev.merged = true;
      prev.mergeReasons = (prev.mergeReasons || []).concat(decision.reason);
      prev.words = (prev.words || []).concat(row.words || []);
      if (decision.reason === 'answered_a_fragment') {
        answeredFragments += 1;
        prev.answeredWhileUnfinished = (prev.answeredWhileUnfinished || 0) + 1;
      }
      prospectSince = false;
      return;
    }
    out.push({ ...row, parts: 1, partIds: [row.itemId], merged: false });
    lastFounder = out.length - 1;
    prospectSince = false;
  });

  const assembled = out.map((t) => {
    if (t.role !== 'founder') return t;
    const danglingAtRelease = isDangling(t.text);
    const complete = !danglingAtRelease;
    const confidence = confidenceOf({ ...t, danglingAtRelease });
    return {
      ...t, complete, danglingAtRelease, confidence,
      creditEligible: complete && confidence >= (opts.minCredit ?? MIN_CREDIT_CONFIDENCE),
      assemblyVersion: ASSEMBLY_VERSION,
    };
  });
  Object.defineProperty(assembled, 'answeredFragments', { value: answeredFragments, enumerable: false });
  return assembled;
}

/* ── LIVE ────────────────────────────────────────────────────────────────
   The prospect may not answer a fragment. A finalised fragment is held for a
   settle window; anything that lands inside it belongs to the same thought.
   A fragment that still looks unfinished waits longer before we accept that
   the founder really did stop there. */
export function decideRelease({ pending, nowMs, stillSpeaking = false, opts = {} }) {
  if (!pending || !pending.text) return { action: 'wait', reason: 'nothing_pending' };
  const settle = opts.settleMs ?? SETTLE_MS;
  const dangleSettle = opts.dangleSettleMs ?? DANGLE_SETTLE_MS;
  const maxHold = opts.maxHoldMs ?? MAX_HOLD_MS;
  const ceiling = opts.ceilingMs ?? CEILING_MS;
  const cutSettle = opts.cutSettleMs ?? CUT_SETTLE_MS;
  const dangles = isDangling(pending.text);
  const waited = nowMs - pending.finalisedAt;
  /* The LAST fragment's own duration, not the assembled turn's span: a long
     thought is several fragments and only the newest one can have been cut. */
  /* ── DURATION IS EVIDENCE, NOT AUTHORITY ──────────────────────────────
     A fragment at the provider's duration ceiling MIGHT have been cut. It
     might equally be a founder who speaks longer sentences than the corpus
     that sized CEILING_MS -- measured there at 8.352 s, while human call #2
     produced finished ~10 s questions routinely. Treating length ALONE as
     proof of a cut sent every one of those into an 8 s wait for a second
     half that was never coming; 8000 + 2500 ms of carry behind it is the
     10.5 s stall observed on the long turns of that call.

     So the ceiling now only ASKS the question. What ANSWERS it is whether
     the provider still holds unfinalised speech for this founder: a real cut
     leaves its second half open on the wire, and a finished thought leaves
     nothing behind. Both must hold, so this is strictly NARROWER than the
     duration test it replaces -- it can only remove waits, never add one. */
  const atCeiling = typeof pending.lastPartMs === 'number' && pending.lastPartMs >= ceiling;
  /* Undefined means the caller cannot see the provider's open state. Fail
     toward the OLD behaviour there rather than silently dropping the
     protection that genuine fragmentation depends on. */
  const continuationPending = pending.continuationPending === undefined
    ? atCeiling : pending.continuationPending === true;
  const cut = atCeiling && continuationPending;
  const cutEvidence = { atCeiling, continuationPending, ceilingMs: ceiling };

  /* THE PROSPECT MAY NOT ANSWER SOMEONE WHO IS STILL TALKING. Whatever the
     fragment looks like and however long it has been held, a founder mid-
     sentence has not finished their turn. Bounded, so a provider that never
     closes an utterance cannot freeze the rehearsal — at the ceiling the
     turn is released and MARKED INCOMPLETE, never quietly passed off as a
     finished thought. */
  if (stillSpeaking && waited < maxHold) {
    return { action: 'hold', reason: 'founder_still_speaking',
      waitMs: 250, dangling: dangles, speaking: true };
  }
  if (stillSpeaking) {
    return { action: 'release', reason: 'max_hold_while_speaking',
      dangling: dangles, complete: false, speaking: true };
  }

  /* A CUT IS NOT A THOUGHT THAT ENDED, whatever shape it has. The formatter
     punctuates what it was given, so a fragment sliced mid-sentence can come
     back with a full stop on it -- observed: a 9.079 s fragment ending "…is
     where the bottleneck", continued by "sits in all of this". Shape alone
     would have called that finished. Length ASKS the question; the
     provider's own unfinalised remainder answers it. */
  const quietFor = typeof pending.quietSince === 'number'
    ? Math.min(waited, nowMs - pending.quietSince) : waited;
  if (cut && quietFor < cutSettle) {
    return { action: 'hold', reason: 'cut_at_provider_ceiling',
      waitMs: Math.min(400, cutSettle - quietFor), dangling: dangles, cut: true,
      cutEvidence };
  }
  if (cut) {
    /* Nothing followed it. Recorded, but never as a finished thought.

       UNCERTAINTY GETS ONE WINDOW, NOT TWO. This path has already spent
       CUT_SETTLE_MS waiting for a continuation and established there is
       none. The carry mechanism downstream exists to wait for exactly the
       same thing, so letting an exhausted cut fall into it charges the
       founder a second full window for one missing second half. */
    return { action: 'release', reason: 'cut_no_continuation',
      dangling: dangles, complete: false, cut: true,
      recoveryExhausted: true, cutEvidence };
  }

  const need = dangles ? dangleSettle : settle;
  if (waited < need) {
    return { action: 'hold', reason: dangles ? 'unfinished_thought' : 'settling',
      waitMs: need - waited, dangling: dangles, cutEvidence };
  }
  return { action: 'release', reason: dangles ? 'timeout_still_unfinished' : 'settled',
    dangling: dangles, complete: !dangles, cutEvidence };
}
