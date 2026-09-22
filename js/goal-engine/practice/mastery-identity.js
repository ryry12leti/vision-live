/* ════════════════════════════════════════════════════════════════════════
   PHASE 3 WP-A — WHAT MAKES ONE OBSERVATION THAT ONE OBSERVATION

   Mastery observations are immutable and append-only, so re-deriving a call
   must produce the SAME id or the ledger silently doubles every time
   anything reprocesses. Phase 2 learned this the expensive way: an id that
   omitted the extractor version made a v2 extractor re-derive a byte
   identical id, and `on conflict do nothing` then discarded the upgrade
   while reporting success. Nothing here is allowed to repeat that, so every
   input that could change what an observation MEANS is in the basis.

   Six identities. Five were frozen in the Phase 3 architecture; `track`
   joined them in logic v2, because Phase 5's WP-0 proved the original omission
   was exactly this file's own opening warning come true: every observation in
   production was stamped `buyer` (a silently-null score read defaulted it),
   and because track was NOT in the basis, re-deriving with the CORRECT track
   computed the same id -- `on conflict do nothing` then discarded the
   correction while reporting success. Track changes which window an
   observation enters, which is meaning, which is the basis test.

     session_id                 which call
     skill                      which of the six
     opportunity                whether the skill was even available
     track                      which denominator it enters (v2+)
     taxonomy_version           what "the six" meant when this was derived
     observation_logic_version  how present/absent/strong/weak were decided
     source_fingerprint         which settled state of the transcript

   `extractor_version` WAS deliberately left out of the basis, on the stated
   ground that it is "already bound into source_fingerprint upstream by Phase
   2's run identity". THAT WAS WRONG, and it is corrected in logic v4.
   `source_fingerprint` is settlement-owned -- md5 over session state,
   dispositions and turn row ids -- and says nothing about which extractor
   read them. So an extractor upgrade left the fingerprint identical and the
   ledger unsafe in both directions on the same call:

     semantics unchanged   same id, conflict-do-nothing -> correct
     opportunity changed   different id -> TWO rows, both projected
     grade changed only    SAME id -> the correction silently discarded

   Measured on staging: `discovery` held 5 rows across 4 sessions at one
   logic version, one call carrying both `absent` and `present/none`.

   The version is now in the basis, which fixes the third case and
   UNIVERSALISES the second by design: every extractor version keeps its own
   row so history stays separable and auditable. Which of those rows is
   CURRENT is a reader's question, not a hash's -- the projection joins each
   observation to its session's current complete evidence run. Neither half
   works alone: the basis alone duplicates, the reader alone still swallows
   corrections.

   This file is pure. No I/O, no clock, no randomness -- the same inputs
   give the same string in the browser, in Deno and in a test, forever.
   ══════════════════════════════════════════════════════════════════════ */

export const TAXONOMY_VERSION = 'practice_mastery_taxonomy_v1';
/* v2: track joined the id basis, and the derivation stopped defaulting an
   unknown track to `buyer` (Phase 5 WP-0). v1 observations remain on disk,
   immutable and historical; every reader's default moved to v2 in the same
   migration, so the polluted v1 window is excluded from every read rather
   than corrected in place. */
/* v3 (P5R-0): the two remaining client-authorable quality sources were
   WITHDRAWN, completeness-suppressed evidence became indeterminate, and a
   skill whose opportunity is only evidenced by its own negatives now returns
   `unknown` rather than asserting `absent`. Same call, same fingerprint,
   different verdict -- so it is a new logic version, not an edit. v2 rows
   stay on disk, immutable and historical; every reader's default moves to v3
   only AFTER v3 has been re-derived from canonical evidence, so no panel is
   ever blanked. */
/* v4 (L2-2): `extractor_version` joined the id basis. The VERDICT logic is
   unchanged -- the same call and the same evidence still grade identically --
   but the identity is not, so v3 rows and v4 rows are different rows for the
   same logical observation. Bumping is what keeps that honest: v3 stays whole
   and readable as history instead of becoming orphaned siblings of v4 rows at
   the same version. */
/* v5 (P5R-2): NOT a logic change -- a superseding one. The mastery
   derivation selected its evidence by (session, source_fingerprint) without
   extractor_version, and the fingerprint is settlement-owned, so it is
   identical across extractor versions. Every version's events were therefore
   fed into one derivation at once. Measured: after P5R-2 stopped the greeting
   counting as an answer, Calls A and C held NO explicit_answer at extractor
   v3 and still graded `discovery: present/strong`, because v1's greeting
   event was still arriving from a superseded run. A grade its own evidence
   cannot produce is the plainest statement of the defect.

   The filter is fixed. But the v4 rows that defective derivation wrote are
   immutable and, where only `demonstrated` changed, re-derivation recomputes
   the SAME id and `on conflict do nothing` keeps the wrong grade -- the exact
   stale-collision case L2-2 documented. So v4 is superseded rather than
   rewritten: v4 rows stay on disk and readable as history, v5 rows are
   derived from correctly-scoped evidence, and the read defaults move only
   after v5 exists. */
/* v6 (P5R-3): the opportunity vocabulary went from three values to six.
   `declined` and `prevented` were previously indistinguishable from `none`
   and from each other, so correct restraint and a stonewalling prospect both
   read as the founder failing to act. */
export const OBSERVATION_LOGIC_VERSION = 'practice_mastery_observation_logic_v7';

/* THE SIX. Frozen in the Phase 3 architecture: `opening_and_framing` was
   dropped because its only source was a scored axis with no distinct
   factual backing, and the failure it caught really is grounding. */
export const SKILLS = Object.freeze([
  'discovery',
  'listening_and_building',
  'grounding_claims',
  'objection_handling',
  'pitch_discipline',
  'authority_and_routing',
]);

/* Absence is never negative. `absent` means the skill provably never came
   up; `unknown` means we cannot tell. Both contribute nothing in either
   direction, and both are COUNTED so silence is visible. */
/* ── FIVE OUTCOMES, NOT TWO ────────────────────────────────────────────
   `present | absent | unknown` could not tell four different things apart,
   and collapsed every one of them into the same answer:

     the chance never arose
     the chance arose and the founder deliberately did not take it
     the chance arose and the COUNTERPARTY closed it
     the chance arose and the founder engaged it badly

   Measured consequences, all four on real calls: a founder who refused to
   pitch a gatekeeper -- correct selling -- was recorded identically to one
   who never noticed the moment; a founder whose questions were refused three
   times was recorded as though they had asked nothing.

   `attempted_success` and `attempted_failure` are the only two that enter a
   band. `declined` and `prevented` are COUNTED and VISIBLE and move nothing
   in either direction: not failing is not the same as succeeding, and a
   product that paid out for saying "I won't pitch you" would be teaching the
   sentence rather than the judgement. */
export const OPPORTUNITY = Object.freeze({
  ABSENT: 'absent',
  PREVENTED: 'prevented',
  DECLINED: 'declined',
  ATTEMPTED_SUCCESS: 'attempted_success',
  ATTEMPTED_FAILURE: 'attempted_failure',
  UNKNOWN: 'unknown',
});

/* The two that carry a grade and enter the window. */
export const ATTEMPTED = Object.freeze([
  OPPORTUNITY.ATTEMPTED_SUCCESS, OPPORTUNITY.ATTEMPTED_FAILURE,
]);
export const isAttempted = (o) => ATTEMPTED.includes(o);

/* Only meaningful when opportunity is `present`. `none` is not a failure --
   it is "the chance existed and the founder did not engage it", which is a
   different fact from doing it badly. */
export const DEMONSTRATED = Object.freeze({
  STRONG: 'strong', ADEQUATE: 'adequate', WEAK: 'weak', NONE: 'none',
});

/* Five, not seven. The trace killed the other two: "guidance available but
   not used" has no signal of any kind behind it (the rail renders with no
   click, dwell, focus or scroll event), and "they used the supplied
   wording" is structurally unprovable because the offered lines are never
   persisted, so there is nothing to diff a retry against. */
export const ASSISTANCE = Object.freeze({
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
  ON_SCREEN: 'assistance_on_screen',
  HELP_OFFERED: 'intervention_with_help_offered',
  CORRECTED_UNAIDED: 'intervention_corrected_unaided',
});

/* Transcript-derived, never the hidden role. `buildProgressByTrack` already
   refuses to combine these denominators and mastery inherits that refusal. */
export const TRACK = Object.freeze({
  BUYER: 'buyer', NON_BUYER: 'non_buyer', LIVE: 'live',
});

export const SOURCE_TYPE = Object.freeze({
  SIMULATED: 'simulated_practice', REAL: 'real_call',
});

/* Why an observation could not be graded, when that is the reason. Recorded
   in `context` rather than as a fourth opportunity state, so the band
   machinery stays exactly as frozen. */
export const INDETERMINATE = Object.freeze({
  DISPUTED_DELIVERY: 'disputed_delivery',
  LEGACY_PROVENANCE: 'legacy_provenance',
  NO_CANONICAL_EVIDENCE: 'no_canonical_evidence',
  /* Three of the six skills have NO "a good thing happened" event, because
     inventing one from the absence of a bad thing would break the
     absence-is-not-evidence rule in the one place it is most tempting. Their
     positive signal comes from a validated transcript-derived source
     instead. When that source is unavailable for a call we cannot say the
     founder scored zero positives -- only that we could not measure. Weak
     would be a verdict; this is the honest alternative. */
  NO_QUALITY_SOURCE: 'no_quality_source',
  /* The founder's own client stamped `turn_complete = false`, which makes
     that turn's evidence `ineligible`. Not overruled -- nothing the server
     owns can tell a truncated sentence from a hidden one -- but no longer
     silently read as "the chance never arose" either. */
  SUPPRESSED_COMPLETENESS: 'suppressed_completeness',
  /* The chance arose, nothing happened, and there is no evidence of a
     CHOICE either way. Not `declined` -- that requires the founder to have
     said so -- and certainly not a failure. Counted, visible, moves nothing.
     Keeping it distinct from the measurement failures above is the point:
     "they did not engage it" and "we could not read it" are different facts
     about the seller. */
  NOT_ENGAGED_NO_INTENT_EVIDENCE: 'not_engaged_no_intent_evidence',
});

/* The same small, stable, dependency-free hash Phase 2 uses for event
   identity. This is an identity, not a security primitive: it has to be
   deterministic across runs and processes, and nothing more. */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/* Widened by folding four offset passes, so the id is long enough that two
   different calls colliding is not something a reader has to think about.
   Same construction as Phase 2's event id -- one hash family, one habit. */
export function deriveObservationId({
  sessionId, skill, opportunity, track, sourceFingerprint,
  /* WHICH EVIDENCE DERIVATION THIS VERDICT CAME FROM.
     It was absent, and that made an extractor upgrade unsafe in BOTH
     directions on the same call:

       semantics unchanged   same id, `on conflict do nothing` -> correct
       opportunity changed   different id -> TWO rows, both projected
       grade changed only    SAME id -> the correction silently discarded

     Adding it here fixes the third case and ONLY the third: it does not
     stop the second, it universalises it, because now every extractor
     version writes its own row for every call. That is deliberate and it is
     why this is half a repair. History has to be separable to stay
     auditable; deciding WHICH row is current is a reader's job, not a
     hash's, and the reader now joins each observation to its session's
     current complete evidence run. Same reasoning the candidate-event id
     already uses for extractor_version, applied one layer up. */
  extractorVersion = null,
  taxonomyVersion = TAXONOMY_VERSION,
  observationLogicVersion = OBSERVATION_LOGIC_VERSION,
} = {}) {
  if (!sessionId) throw new Error('observation_id_without_session');
  if (!skill) throw new Error('observation_id_without_skill');
  if (!opportunity) throw new Error('observation_id_without_opportunity');
  /* Required, not defaulted. A defaulted track is how the v1 pollution
     happened; an id that guesses the denominator is worse than no id. */
  if (!track) throw new Error('observation_id_without_track');
  /* A missing fingerprint is NOT interchangeable with a real one: it would
     let two different settled states of the same call share an id. It is
     spelled out rather than coalesced to '' so the basis stays readable. */
  const basis = `${sessionId}|${skill}|${opportunity}|${track}`
    + `|${taxonomyVersion}|${observationLogicVersion}`
    + `|${sourceFingerprint || 'no_fingerprint'}`
    + `|${extractorVersion || 'no_extractor'}`;
  return `mo_${fnv1a(basis)}${fnv1a(`1${basis}`)}${fnv1a(`2${basis}`)}${fnv1a(`3${basis}`)}`;
}
