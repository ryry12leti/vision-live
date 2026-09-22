/* ════════════════════════════════════════════════════════════════════════
   REALTIME TRANSCRIPTION — event reconciliation. Pure, and the whole reason
   this step is separable from call_assist.

   The realtime API emits two kinds of transcript event against the same
   item_id: many `delta`s while someone is still speaking, then one
   `completed` carrying the settled text. Neither the deltas nor the
   completions are guaranteed to arrive in the order the words were spoken —
   a short utterance can finish after a long one that started earlier. So
   ordering cannot come from arrival order, and text cannot come from
   accumulating deltas once a completion exists.

   THE RULES THIS ENCODES:
     · item_id is the identity. Everything about one utterance collapses onto
       it, so a repeated event is not a repeated turn.
     · A completion REPLACES the accumulated deltas for its item. It does not
       append to them — the model revises as it hears more, and concatenating
       both is how "we already have" becomes "we already we already have".
     · Ordering is by first-seen sequence, assigned when an item_id is first
       encountered, so a late completion lands where the speech actually was.
     · Only completed items are committable. Partials are for the eye only,
       and this module refuses to hand them out as turns.

   NO SPEAKER IS INVENTED. One microphone cannot tell the founder from the
   prospect, so every captured item is labelled `captured_audio` and the
   question of who spoke is left to a later step that can actually answer it.
   ══════════════════════════════════════════════════════════════════════ */

export const TRANSCRIBE_SPEAKER = 'captured_audio';

export const TRANSCRIBE_STATES = Object.freeze([
  'idle', 'requesting_mic', 'connecting', 'listening', 'stopped', 'failed',
]);

/* The two server events that carry transcript text. Named here so a rename
   upstream fails loudly in one place rather than silently producing an empty
   transcript. */
export const DELTA_EVENT = 'conversation.item.input_audio_transcription.delta';
export const COMPLETED_EVENT = 'conversation.item.input_audio_transcription.completed';

export function createTranscriptStore() {
  return { items: new Map(), order: 0 };
}

const text = (v) => (typeof v === 'string' ? v : '');

/* Returns { changed, itemId, status } so a caller can re-render only when
   something actually moved. */
export function applyTranscriptEvent(store, event) {
  if (!store || !event || typeof event !== 'object') return { changed: false };
  const type = event.type;
  const itemId = event.item_id;
  if (typeof itemId !== 'string' || !itemId) return { changed: false };

  if (type !== DELTA_EVENT && type !== COMPLETED_EVENT) return { changed: false };

  let item = store.items.get(itemId);
  if (!item) {
    store.order += 1;
    item = { itemId, sequence: store.order, partial: '', final: null, status: 'partial' };
    store.items.set(itemId, item);
  }

  if (type === DELTA_EVENT) {
    /* A delta arriving after completion is stale — the settled text already
       supersedes it, and appending would corrupt a finished turn. */
    if (item.status === 'final') return { changed: false, itemId, status: 'final' };
    item.partial += text(event.delta);
    return { changed: true, itemId, status: 'partial' };
  }

  /* COMPLETED. Idempotent: the same completion twice is one turn. */
  if (item.status === 'final') return { changed: false, itemId, status: 'final' };
  item.final = text(event.transcript);
  item.status = 'final';
  return { changed: true, itemId, status: 'final' };
}

/* Everything, in the order the speech happened, for display. */
export function transcriptView(store) {
  if (!store) return [];
  return [...store.items.values()]
    .sort((a, b) => a.sequence - b.sequence)
    .map((i) => ({
      itemId: i.itemId,
      sequence: i.sequence,
      status: i.status,
      text: i.status === 'final' ? i.final : i.partial,
    }));
}

/* ONLY SETTLED TEXT LEAVES THIS MODULE AS A TURN.
   A later step will hand these to call_assist; partials must never get there,
   because analysis built on half a sentence is analysis of something nobody
   said. Empty completions are dropped: silence is not a turn. */
export function committableTurns(store) {
  return transcriptView(store)
    .filter((i) => i.status === 'final' && i.text.trim().length > 0)
    .map((i, index) => ({
      speaker: TRANSCRIBE_SPEAKER,
      text: i.text.trim(),
      sequence: index + 1,
      itemId: i.itemId,
    }));
}

export function livePartial(store) {
  const open = transcriptView(store).filter((i) => i.status === 'partial' && i.text.trim());
  return open.length ? open[open.length - 1].text.trim() : '';
}

/* ── the connection state machine ─────────────────────────────────────────
   Reconnect is never automatic. A dropped realtime connection means audio
   was lost, and silently re-establishing it would leave the founder believing
   a call was captured when part of it was not. */
const ALLOWED = Object.freeze({
  idle: ['requesting_mic', 'failed'],
  requesting_mic: ['connecting', 'failed', 'stopped'],
  connecting: ['listening', 'failed', 'stopped'],
  listening: ['stopped', 'failed'],
  stopped: ['requesting_mic'],
  failed: ['requesting_mic'],
});

export function canTransition(from, to) {
  return Array.isArray(ALLOWED[from]) && ALLOWED[from].includes(to);
}
