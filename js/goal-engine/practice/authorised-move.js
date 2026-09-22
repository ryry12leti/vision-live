/* ════════════════════════════════════════════════════════════════════════
   THE AUTHORISED MOVE — decided by code, verbalised by the model

   The naive way to make a spoken prospect faster is to stream the model and
   validate afterwards. That inverts VISION's whole authority model: by the
   time a clause has been spoken, validating it is an audit, not a control.
   A fact the ledger never granted would already be in the founder's ear.

   So the order is preserved and only the WORK is reordered. Everything that
   decides WHAT may be said -- BusinessTruth, the role ceiling, the
   disclosure ladder, the situation, the behaviour engine's resistance -- runs
   first, deterministically, exactly as it does today. Their combined verdict
   is frozen into an authorised move. The model's only remaining job is to
   put that move into words.

   THE CONSEQUENCE THAT MATTERS: because the move names the exact facts that
   may be spoken, a streamed clause can be checked against a decision that
   already exists, rather than against a decision still being made. Nothing
   here relaxes an authority; it records one so speech can be gated on it.

   This module is pure. It reads no database, calls no model, and cannot
   widen what its inputs allow -- every field is copied from a decision made
   upstream, and the fact list is the ledger's own offer, never a superset.
   ══════════════════════════════════════════════════════════════════════ */

export const AUTHORISED_MOVE_VERSION = 'practice_authorised_move_v1';

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Freeze the deterministic verdict a model is allowed to verbalise.
 *
 * @param {object} input
 * @param {object?} input.disclosure  admissibleDisclosures() result -- its
 *   `offer` is the ONLY source of speakable facts. Not the ledger, not the
 *   compiled truth: the offer is what survived relevance, depth and the cap.
 * @param {object?} input.turn        the behaviour engine's turn
 * @param {object?} input.situation   situation state (id/attention only)
 * @param {string?} input.role        the drawn role, for the ceiling record
 */
export function authoriseMove({ disclosure = null, turn = null, situation = null, role = null } = {}) {
  const offered = (disclosure && Array.isArray(disclosure.offer)) ? disclosure.offer : [];
  /* THE WHOLE PERMITTED VOCABULARY OF FACTS, and nothing beyond it. Ids and
     text only -- depth, topic and provenance stay server-side, because the
     model needs to say the sentence, not audit it. */
  const allowedFacts = Object.freeze(offered.map((f) => Object.freeze({
    id: String(f && f.id != null ? f.id : ''),
    text: String(f && f.text != null ? f.text : ''),
  })).filter((f) => f.id && f.text));

  return Object.freeze({
    version: AUTHORISED_MOVE_VERSION,
    /* What the founder may learn this turn. Empty is a real answer: it means
       nothing was earned, and the move must be verbalised without facts. */
    allowedFacts,
    allowedFactIds: Object.freeze(allowedFacts.map((f) => f.id)),
    /* The ladder's own verdict, carried verbatim for the record. */
    disclosureLevel: str(disclosure && disclosure.reason) || 'none',
    /* How the prospect resists, straight from the behaviour engine -- this
       module never decides mood. */
    resistanceMove: str(turn && turn.responseInstruction),
    answerConstraint: str(turn && turn.informationAllowed),
    posture: str(turn && turn.allowedResponsePosture),
    activeObjection: str(turn && turn.activeObjection),
    /* Pace and attention only. The situation id is hidden state and is NOT
       carried: publicScenario()'s rule applies here too. */
    situationConstraint: Object.freeze({
      attention: (situation && typeof situation.attention === 'number') ? situation.attention : null,
      signalDue: !!(situation && situation.signalDue),
    }),
    /* Recorded so a later reader can prove which ceiling applied. Never sent
       to the model as a role NAME -- the prompt already speaks as the role. */
    roleCeiling: str(role),
    ended: !!(turn && turn.prospectStateAfter && turn.prospectStateAfter.ended),
  });
}

/* ── THE GATE A STREAMED CLAUSE MUST PASS ──────────────────────────────
   A clause is admissible when it introduces no fact outside the move. This
   is deliberately a check on GROUNDED SUBSTANCE, not a general-purpose
   truth detector: the prospect is free to say "I'm not sure", "what's this
   about?", or anything conversational. What it may not do is state a
   grounded business fact the ledger did not grant this turn.

   Detection is by the fact vocabulary the move carries: if a clause echoes
   the distinctive content of a WITHHELD fact, it is refused. Withheld ids
   travel with the disclosure precisely so this check has something to
   compare against. */
const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'we', 'us', 'our', 'you', 'your',
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'to', 'of', 'in', 'on', 'at', 'for', 'it',
  'that', 'this', 'with', 'about', 'most', 'some', 'through', 'here', 'there', 'they', 'i']);

export function distinctiveWords(text) {
  return (String(text || '').toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
    .filter((w) => !STOP.has(w));
}

/**
 * @returns {{admissible: boolean, reason: string, offending: string[]}}
 */
export function clauseAdmissible(clause, move, withheldFacts = []) {
  const text = String(clause == null ? '' : clause).trim();
  if (!text) return { admissible: false, reason: 'empty_clause', offending: [] };
  if (!move || move.version !== AUTHORISED_MOVE_VERSION) {
    return { admissible: false, reason: 'no_authorised_move', offending: [] };
  }
  const said = new Set(distinctiveWords(text));
  const allowedWords = new Set();
  for (const f of move.allowedFacts) for (const w of distinctiveWords(f.text)) allowedWords.add(w);

  const offending = [];
  for (const f of (Array.isArray(withheldFacts) ? withheldFacts : [])) {
    const words = distinctiveWords(f && f.text);
    if (!words.length) continue;
    /* Only substance the move did NOT authorise can convict: a word shared
       with an allowed fact is not evidence of leaking a withheld one. */
    const unique = words.filter((w) => !allowedWords.has(w));
    if (!unique.length) continue;
    const hits = unique.filter((w) => said.has(w));
    if (hits.length >= 2) offending.push(String(f.id || 'unknown'));
  }
  if (offending.length) return { admissible: false, reason: 'withheld_fact_in_clause', offending };
  return { admissible: true, reason: 'within_authority', offending: [] };
}
