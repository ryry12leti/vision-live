/* ════════════════════════════════════════════════════════════════════════
   THE CANDIDATE EVENT CONTRACT.

   Both deterministic producers -- the Rule Engine and the Reaction Reader --
   emit through this file and nowhere else, so a producer cannot invent a
   shape, skip a citation, or quietly award itself authority.

   THREE RULES, ENFORCED HERE RATHER THAN REMEMBERED:

   1. NO CITATION, NO EVENT. Every event names the turns that caused it, by
      the only address that survives a replay: (sequence, attempt_no).
      practice_turn_append_v1 is ON CONFLICT DO NOTHING RETURNING id, so on a
      replay the uuid comes back null -- it cannot be the anchor.

   2. NO SCORES, AND NO NUMBER THAT WILL BECOME ONE. There is no confidence
      field. A confidence invites a threshold and a threshold is a score.
      Authority is one of three words and a stated basis.

   3. THE READER CORROBORATES, IT DOES NOT ORIGINATE. A reaction_reader event
      either belongs to the enumerated reaction family -- an observation about
      what the prospect said -- or it points at the rule_engine event it
      supports. It may never be the sole source of a founder-performance
      finding.

   The event id is DERIVED from the session, the rule and the sorted citation
   anchors. Replaying a call therefore produces the same ids, and "the same
   evidence read by the same rule" is the same logical event by construction
   rather than by a de-duplication pass.
   ══════════════════════════════════════════════════════════════════════ */

export const EVENT_CONTRACT_VERSION = 'practice_candidate_events_v1';

export const PRODUCER = Object.freeze({ RULE: 'rule_engine', READER: 'reaction_reader' });

/* The brief's vocabulary. SUPPORTED means the evidence stands on its own;
   WITHHELD means a gate declined and the judge should decide; INELIGIBLE
   means the turn itself was never fit to be interpreted. */
export const AUTHORITY = Object.freeze({
  SUPPORTED: 'supported', WITHHELD: 'withheld', INELIGIBLE: 'ineligible',
});

/* The enumerated reaction family. A reader event whose type is NOT in here
   must cite the rule event it corroborates. */
export const REACTION_TYPES = Object.freeze([
  'explicit_answer',
  'explicit_refusal_to_answer',
  'explicit_refusal_to_proceed',
  'explicit_do_not_contact',
  'explicit_objection',
  'explicit_correction',
  'explicit_clarification_request',
  'explicit_prospect_question',
  'explicit_permission_to_continue',
  'explicit_lack_of_priority',
  'explicit_current_provider_satisfaction',
  /* P5R-1. Phase 2's architecture proposed this type and never shipped it, so
     "did they ever reach someone who could decide" was computable live and
     thrown away. Without it `authority_and_routing` had no opportunity marker
     of its own and borrowed `close_attempted` -- which is how a misclassified
     routing request became the only thing creating that skill's opportunity. */
  'explicit_authority_disclaimed',
]);

/* Canonical founder-side vocabulary, reused from detected_events so the
   review and the rubric keep switching on the strings they already know.
   Only ONE identifier is new, and only because nothing existing expressed
   it: continuing to sell after an explicit do-not-contact. */
export const RULE_TYPES = Object.freeze([
  'close_attempted',
  'unearned_close',
  'pressure_applied',
  'sold_after_do_not_contact',     /* new — see above */
  'question_repeated',
  'pitched_without_permission',
  'unsupported_assumption',
  /* Two mistakes that had no word here, so nothing downstream could name
     them: a question that advances nothing, and an objection left standing
     while the founder does something else. */
  'weak_discovery',
  'objection_not_handled',
  'objection_raised',
  'repair_of',
  /* The offer spent on someone who had already said the decision was not
     theirs. It existed only as a browser-written string in `detected_events`
     -- so the heaviest non-buyer axis was graded on the seller's own label. */
  'pitched_a_non_buyer',
  /* P5R-7. Two facts the rubric had no canonical word for, so it read client
     columns instead: whether an offer was actually asserted at a turn, and
     whether a close had established basis. Both are transcript-derived. */
  'offer_asserted',
  'offer_invited',
  'close_earned',
  'repair_after_cut',
  'repair_candidate_unresolved',
  'turn_not_interpretable',
  /* P5R-3. A founder who says "I'm not going to pitch you, it's not your
     call" made a JUDGEMENT. Without a word for it, that turn was
     indistinguishable from never noticing the moment -- and on the sharpest
     call in the corpus it was recorded as failing to engage. Emitted only
     when no offer follows it; see rule-engine's invalidation pass. */
  'pitch_declined',
  /* ── P5R-6: THE POSITIVE HALF ──────────────────────────────────────
     Of roughly two dozen event types the server could emit, ALL BUT ONE
     described a mistake. A longer, better, more engaged call therefore
     generated more evidence and every extra piece could only cost points --
     measured on four organic calls, where the best-sold call produced nine
     events and scored LOWEST of the four.

     Three mastery skills also read `no_quality_source` forever, because
     their only positive signal was a rubric axis reading a column the
     browser writes. These four give each of them a server-derived positive
     of its own, so good selling finally leaves a trace. */
  'built_on_their_answer',
  'objection_addressed',
  'grounded_claim',
  'routing_obtained',
]);

/* Events that say something GOOD about the founder's performance. These are
   the ones an unheard or unfinished turn may never produce. */
export const POSITIVE_TYPES = Object.freeze(['repair_of', 'repair_after_cut',
  'built_on_their_answer', 'objection_addressed', 'grounded_claim', 'routing_obtained']);

/* Events that say something went WRONG on that turn. A turn cannot be both
   repaired and damaging at the same time and have both claims stand. */
export const NEGATIVE_TYPES = Object.freeze([
  'unearned_close', 'pressure_applied', 'sold_after_do_not_contact',
  'pitched_without_permission', 'question_repeated', 'unsupported_assumption',
  'weak_discovery', 'objection_not_handled', 'pitched_a_non_buyer',
]);

/* A small, stable, dependency-free hash. Deterministic across runs and
   processes, which is the entire requirement -- this is an identity, not a
   security primitive. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
/* WHICH DERIVATION THIS IS, when nobody says. Every event written before
   Phase 2 was produced live by the browser, so that is what an unstated
   extractor version means -- and because it is part of the basis below, a
   legacy id and a Phase 2 id for the same finding can never be the same
   string, which is the whole point. */
export const LEGACY_EXTRACTOR_VERSION = 'legacy_client_v0';

export function deriveEventId({ sessionId, sourceFingerprint, extractorVersion, ruleId, ruleVersion, citations }) {
  const anchors = (citations || [])
    .map((c) => `${c.sequence}:${c.attemptNo}:${c.speaker}`)
    .sort()
    .join(',');
  /* ── THE EXTRACTOR VERSION IS PART OF THE IDENTITY ──────────────────
     It was not, and that made safe reprocessing impossible: a v2 extractor
     re-derived a byte-identical id for the same finding, and the append's
     `on conflict (event_id) do nothing` then SILENTLY DISCARDED it. The
     upgrade appeared to succeed and changed nothing. With the version in
     the basis, v2 writes new rows beside v1's instead of colliding with
     them, and which of the two is current is a question for the run table
     rather than for a hash. */
  /* ── AND THE SOURCE STATE IT WAS DERIVED FROM ───────────────────────
     A run is identified by (session, source fingerprint, extractor
     version), so an event that wants to belong to exactly one run has to
     carry all three. Carrying only two looked harmless and was not: when a
     call's settled state changed and the SAME extractor re-ran, every
     finding drawn from the turns that had not changed re-derived a
     byte-identical id, collided with the older run's row, and was dropped
     by `on conflict do nothing` -- so the new run silently owned fewer
     events than it had actually derived, and the current projection could
     not see them. Same call, same settled state, same extractor still
     yields the same ids, so replay stays idempotent; only a genuinely
     different source state produces a genuinely different derivation. */
  const basis = `${sessionId}|${sourceFingerprint || ''}`
    + `|${extractorVersion || LEGACY_EXTRACTOR_VERSION}`
    + `|${ruleId}|${ruleVersion}|${anchors}`;
  /* Two halves of a different length keep collisions vanishingly unlikely
     while staying readable in a database row. */
  return `ce_${fnv1a(basis)}${fnv1a(`${basis}|salt`)}`;
}

const anchorOf = (t) => ({
  sequence: typeof t.sequence === 'number' ? t.sequence : null,
  attemptNo: typeof t.attemptNo === 'number' ? t.attemptNo
    : (typeof t.attempt_no === 'number' ? t.attempt_no : 1),
  speaker: t.speaker === 'prospect' ? 'prospect' : 'founder',
});

/* A citation is a real, addressable turn and the exact words relied on. */
/* Typographic punctuation is normalised before matching, and the same
   normalisation is applied to BOTH sides. Comparing a normalised quote
   against a raw source made every line containing a curly apostrophe fail
   to contain itself -- which silently voided the citation, and with it the
   event, on almost every real prospect line. */
const flatten = (v) => String(v == null ? '' : v)
  .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ').trim();

export function citation(turn, quote) {
  if (!turn || typeof turn.sequence !== 'number') return null;
  const a = anchorOf(turn);
  const text = String(quote == null ? (turn.text || '') : quote).trim();
  if (!text) return null;
  /* The quote must actually appear in the turn it cites. A citation that
     does not support its own claim is the failure mode this exists for. */
  const source = flatten(turn.text);
  const needle = flatten(text);
  if (source && needle && !source.includes(needle)) return null;
  return { ...a, quote: text.slice(0, 300) };
}

export class CitationError extends Error {}

/* The only constructor. Refuses rather than repairs. */
export function makeEvent({
  sessionId, sourceFingerprint = null, extractorVersion = LEGACY_EXTRACTOR_VERSION,
  producer, producerVersion, ruleId, ruleVersion, eventType,
  subject, citations, authority, authorityBasis, corroborates = null, sequence = null,
}) {
  if (!sessionId) throw new CitationError('candidate_event_without_session');
  if (producer !== PRODUCER.RULE && producer !== PRODUCER.READER) {
    throw new CitationError(`unknown_producer:${producer}`);
  }
  const cites = (citations || []).filter(Boolean);
  if (!cites.length) throw new CitationError(`no_citation:${ruleId}`);
  if (!eventType) throw new CitationError(`no_event_type:${ruleId}`);

  /* RULE 3, as code. A reader event outside the enumerated family has to
     name the rule event it supports; it can never stand alone. */
  if (producer === PRODUCER.READER
    && !REACTION_TYPES.includes(eventType) && !corroborates) {
    throw new CitationError(`reaction_reader_originating:${eventType}`);
  }
  if (!Object.values(AUTHORITY).includes(authority)) {
    throw new CitationError(`unknown_authority:${authority}`);
  }
  if (!authorityBasis) throw new CitationError(`authority_without_basis:${ruleId}`);

  const subj = subject ? anchorOf(subject) : anchorOf(cites[0]);
  return Object.freeze({
    eventId: deriveEventId({ sessionId, sourceFingerprint, extractorVersion, ruleId, ruleVersion, citations: cites }),
    sessionId,
    sourceFingerprint,
    extractorVersion,
    producer,
    producerVersion,
    ruleId,
    ruleVersion,
    eventType,
    subjectSequence: subj.sequence,
    subjectAttemptNo: subj.attemptNo,
    subjectTurnComplete: subject && typeof subject.complete === 'boolean' ? subject.complete : null,
    subjectCreditEligible: subject && typeof subject.creditEligible === 'boolean'
      ? subject.creditEligible : null,
    citations: cites,
    authority,
    authorityBasis,
    corroboratesEventId: corroborates || null,
    observedSequence: sequence == null ? subj.sequence : sequence,
    contractVersion: EVENT_CONTRACT_VERSION,
  });
}

/* A positive finding about the founder may not come from a turn VISION did
   not properly hear. Applied centrally so no rule can forget it. */
export function applyEligibility(event, gate) {
  if (!event) return event;
  if (gate && gate.pass === false && POSITIVE_TYPES.includes(event.eventType)) {
    return Object.freeze({ ...event, authority: AUTHORITY.INELIGIBLE,
      authorityBasis: `turn_${gate.reason}` });
  }
  return event;
}

/* Replay safety: the same evidence read by the same rule collapses to one
   logical event. Later readings never displace an earlier one. */
export function dedupe(events) {
  const seen = new Map();
  (events || []).filter(Boolean).forEach((e) => { if (!seen.has(e.eventId)) seen.set(e.eventId, e); });
  return Array.from(seen.values());
}

/* Everything a consumer needs to answer the five questions the brief asks of
   every event, without opening the producer's source. */
export function explain(event) {
  if (!event) return null;
  return {
    causedBy: `seq ${event.subjectSequence} / attempt ${event.subjectAttemptNo}`,
    supportedBy: event.citations.map((c) => `"${c.quote}"`).join(' + '),
    turnComplete: event.subjectTurnComplete,
    creditEligible: event.subjectCreditEligible,
    emittedBy: `${event.ruleId}@${event.ruleVersion} (${event.producer})`,
    authority: `${event.authority} — ${event.authorityBasis}`,
  };
}
