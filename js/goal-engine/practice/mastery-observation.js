/* ════════════════════════════════════════════════════════════════════════
   PHASE 3 WP-B — WHAT ONE CALL SHOWED ABOUT ONE SKILL

   THE FOUR BLOCKED SOURCES ARE NOT PARAMETERS OF THIS FILE.
   `sales.pitchTiming`, `sales.qualification`, `sales.close` and
   `sales.listening` are excluded BY CONSTRUCTION rather than by a filter a
   later edit could quietly remove: there is no argument to pass one in. 30
   of the 100 buyer-track sales points are judged on things the seller could
   not observe --

     qualification  state_after.needDiscovered + session.outcome
     close          pitch_permission_before -- the simulator's private
                    warmth, not anything the prospect said
     pitchTiming    premature_pitch, assigned from hidden state.pitchPermission
     listening      folds situationalAdaptationSignal, which reads
                    state_after.situation.attention (a hidden numeric
                    attention level) into the RAW score before banding, so
                    up to 2.5 of 15 points is mathematically inseparable
                    from the stored number

   -- and a blocked source may not move mastery in EITHER direction. Pushing
   a seller down on evidence they were never shown is exactly as unjust as
   pushing them up, and worse in practice, because they cannot appeal it.

   TWO DIFFERENT THINGS ARE CALLED pitchPermission, and only one is fair.
   call-state grants it when the prospect LITERALLY SAYS "what are you
   offering", storing the quote; prospect-behaviour sets it from
   needDiscovered/trust/resistance. rule-engine reads the first, the scored
   axis reads the second. So pitch discipline is available to mastery as a
   FACT even though the scored axis is blocked.

   THREE SKILLS HAVE NO "GOOD THING HAPPENED" EVENT, and one is not invented
   for them. Phase 2's vocabulary is almost entirely prospect speech acts and
   founder mistakes; deriving a positive from the ABSENCE of a negative is
   the absence-is-not-evidence rule broken in the one place it is most
   tempting. Their positive comes from a validated transcript-derived source
   the caller supplies, and when that source is unavailable the observation
   is INDETERMINATE rather than weak -- we could not measure, which is not
   the same as measuring zero.
   ══════════════════════════════════════════════════════════════════════ */
import {
  SKILLS, OPPORTUNITY, DEMONSTRATED, ASSISTANCE, TRACK, SOURCE_TYPE,
  INDETERMINATE, TAXONOMY_VERSION, OBSERVATION_LOGIC_VERSION,
  deriveObservationId, isAttempted,
} from './mastery-identity.js';

/* ── WHO CLOSED THE CHANCE ─────────────────────────────────────────────
   The counterparty. All server-authored: prospect speech has been the
   server's since ec3ab3b7, so a founder cannot manufacture being refused
   and cannot suppress it either. */
const PREVENT_EVENTS = Object.freeze({
  discovery: ['explicit_refusal_to_answer', 'explicit_refusal_to_proceed', 'explicit_do_not_contact'],
  listening_and_building: ['explicit_refusal_to_answer', 'explicit_refusal_to_proceed', 'explicit_do_not_contact'],
  grounding_claims: ['explicit_refusal_to_proceed', 'explicit_do_not_contact'],
  objection_handling: ['explicit_refusal_to_proceed', 'explicit_do_not_contact'],
  pitch_discipline: ['explicit_refusal_to_proceed', 'explicit_do_not_contact'],
  authority_and_routing: ['explicit_refusal_to_proceed', 'explicit_do_not_contact'],
});

/* ── WHO DECLINED IT ───────────────────────────────────────────────────
   The founder, in their own transcribed words, and only where a canonical
   event says so. `pitch_declined` is withheld by the rule engine if they
   went on to pitch anyway, and withheld evidence is filtered out below, so
   a promise followed by a pitch cannot reach here as restraint. */
const DECLINE_EVENTS = Object.freeze({
  discovery: [],
  listening_and_building: [],
  grounding_claims: [],
  objection_handling: [],
  pitch_discipline: ['pitch_declined'],
  authority_and_routing: ['pitch_declined'],
});

export { SKILLS, OPPORTUNITY, DEMONSTRATED, ASSISTANCE, TRACK, INDETERMINATE, isAttempted };

/* ── THE GRADING FUNCTION, FROZEN AS OBSERVATION_LOGIC_V1 ──────────────
   One rule for all six: did you do the thing, and did you slip?

     strong    >=1 positive, 0 negative
     adequate  >=1 positive, >=1 negative
     weak       0 positive, >=1 negative
     none      the chance existed and neither was seen

   `none` is deliberately not `weak`. "The chance was there and they did not
   engage it" is a different fact from engaging it badly, and collapsing them
   punishes a founder for a moment they may never have recognised.

   Versioned, not calibrated. No data supports a specific rule today and this
   does not pretend otherwise; bumping OBSERVATION_LOGIC_VERSION and
   re-deriving costs nothing, because observations are immutable and fully
   re-derivable from the evidence. */
export function gradeFrom(positiveCount, negativeCount) {
  if (positiveCount > 0 && negativeCount === 0) return DEMONSTRATED.STRONG;
  if (positiveCount > 0 && negativeCount > 0) return DEMONSTRATED.ADEQUATE;
  if (positiveCount === 0 && negativeCount > 0) return DEMONSTRATED.WEAK;
  return DEMONSTRATED.NONE;
}

/* ── THE REAL PHASE 2 VOCABULARY ───────────────────────────────────────
   Checked against candidate-events.js rather than assumed. Notably
   `authority_disclaimed` is NOT an event type -- Phase 2's architecture
   proposed adding it and never did; it exists only as a reason STRING
   inside evidence-gates. Nothing here may depend on it. */
const PROSPECT_SPEECH_ACTS = Object.freeze([
  'explicit_answer', 'explicit_refusal_to_answer', 'explicit_refusal_to_proceed',
  'explicit_do_not_contact', 'explicit_objection', 'explicit_correction',
  'explicit_clarification_request', 'explicit_prospect_question',
  'explicit_permission_to_continue', 'explicit_lack_of_priority',
  'explicit_current_provider_satisfaction',
]);

/* Negative evidence is entirely event-based, which is the safe half: every
   one of these is a deterministic rule over the transcript. */
const NEGATIVE_EVENTS = Object.freeze({
  discovery: ['question_repeated'],
  listening_and_building: ['question_repeated'],
  grounding_claims: ['unsupported_assumption', 'explicit_correction'],
  objection_handling: ['objection_not_handled'],
  pitch_discipline: ['pitched_without_permission'],
  authority_and_routing: ['sold_after_do_not_contact'],
});

/* Positive evidence that IS an event. The other three skills' positives are
   supplied by the caller as validated quality signals -- see POSITIVE_SOURCE. */
const POSITIVE_EVENTS = Object.freeze({
  discovery: ['explicit_answer'],
  /* P5R-6. These four were EMPTY, which is why three of the six skills read
     `no_quality_source` forever and the fourth leaned on a rubric axis that
     read a column the browser writes. Each now has a server-derived positive
     of its own. */
  listening_and_building: ['built_on_their_answer'],
  grounding_claims: ['grounded_claim'],
  objection_handling: ['objection_addressed'],
  /* `pitch_declined` is deliberately NOT here. P5R-3 froze the rule that
     declining EARNS NOTHING -- it removes a false negative, it does not
     create a positive. Adding it made R read `attempted_success/strong` for
     a call where the founder declined to pitch rather than pitching well,
     which is exactly the payout that rule exists to prevent. It stays an
     opportunity marker and resolves to `declined`. */
  pitch_discipline: ['explicit_permission_to_continue'],
  authority_and_routing: ['routing_obtained'],
});

/* Which non-event source, if any, supplies a skill's positive signal.
   Every one of these was individually verified transcript-derived:

     followUps        WITHDRAWN. `high_value_follow_up` is fair on the
                      classifier's own terms -- buildsOnTheirAnswer reads
                      only state.lastProspectLine -- but the whole
                      `founder_action` column is CLIENT-AUTHORED, and mastery
                      is a reward. A founder could label their own turn
                      high_value_follow_up and lift listening_and_building to
                      strong. There is no canonical Phase 2 event for "built
                      on their answer", so this skill has no trustworthy
                      positive source today and is honestly indeterminate
                      rather than gradable on a label the seller can write.
     grounding        sales.grounding at full credit. unsupported_assumption
                      is assigned from the founder's own text against
                      state.prospectSaid. SAFE.
     objectionHandling sales.objectionHandling at full credit. It reads
                      active_objection (call-state) and founder_action in
                      PITCH_ACTIONS -- and because PITCH_ACTIONS contains
                      BOTH 'pitch' and 'premature_pitch', the hidden-permission
                      distinction is collapsed and cannot change its answer.
     routing          readAuthorityEvidence().routing.state, a pure function
                      of the persisted transcript with a quote attached. */
/* ── THE NON-EVENT SOURCES ARE GONE ────────────────────────────────────
   P5R-6. Every entry here was a rubric axis reading a client-authored
   column, and each one was either withdrawn for that reason (leaving the
   skill permanently indeterminate) or was a forge path. With canonical
   positive events above, none is needed: a skill's positive is now an event
   the server derived from the transcript, exactly like its negative.

   Kept as an explicit all-null map rather than deleted, so the shape of the
   old bridge stays visible and re-introducing one is a deliberate edit. */
const POSITIVE_SOURCE = Object.freeze({
  discovery: null,
  listening_and_building: null,
  grounding_claims: null,
  objection_handling: null,
  pitch_discipline: null,
  authority_and_routing: null,
});

/* What has to be TRUE for the skill to have been available at all. Absence
   is never negative: a gatekeeper call cannot weaken buyer discovery,
   because buyer discovery never became available. */
const OPPORTUNITY_EVENTS = Object.freeze({
  discovery: ['explicit_answer', 'explicit_refusal_to_answer',
    'turn_not_interpretable', 'question_repeated', 'weak_discovery'],
  listening_and_building: PROSPECT_SPEECH_ACTS.concat(['built_on_their_answer']),
  grounding_claims: ['unsupported_assumption', 'explicit_correction', 'grounded_claim'],
  objection_handling: ['explicit_objection', 'objection_not_handled', 'objection_addressed'],
  pitch_discipline: ['explicit_permission_to_continue', 'pitched_without_permission',
    'close_attempted', 'unearned_close', 'pitch_declined'],
  authority_and_routing: ['close_attempted', 'unearned_close',
    'explicit_do_not_contact', 'sold_after_do_not_contact',
    /* P5R-1 created this event and P5R-3 is what finally consumes it. Until
       now this skill's ONLY opportunity markers were close events, which is
       how a misclassified routing request became the sole thing that made
       `authority_and_routing` gradeable at all. */
    'explicit_authority_disclaimed', 'pitch_declined', 'routing_obtained'],
});

/* ── ONLY EVIDENCE THE PRODUCER STANDS BEHIND ──────────────────────────
   Phase 2's own contract: `withheld` means the producer DECLINED to stand
   behind the event, and `ineligible` means the turn was seen and refused.
   Neither is canonical. Filtering on eventType alone counted all three
   identically, so an event its own producer disowned could have moved a
   seller's mastery. Caught by the fairness sweep, not by a test. */
const isSupported = (e) => {
  const a = e && (e.authority ?? null);
  /* Legacy rows carry no authority at all. Treated as supported because the
     whole legacy corpus is already excluded upstream -- it has no canonical
     run and therefore never reaches mastery -- and defaulting to refused
     here would silently empty a fixture that omits the field. */
  return a === null || a === undefined || a === 'supported';
};

const typeOf = (e) => (e && (e.eventType || e.event_type)) || null;
const idOf = (e) => (e && (e.eventId || e.event_id)) || null;
const deliveryOf = (e) => (e && (e.deliveryProvenance || e.delivery_provenance)) || null;
const basisOf = (e) => String((e && (e.authorityBasis ?? e.authority_basis)) || '');

/* ── A SUPPRESSED TURN IS NOT AN ABSENT ONE ────────────────────────────
   `turn_complete` is client-authored through practice_turn_append_v1, and a
   founder turn stamped `false` is refused by rule-engine's incomplete_turn
   gate -- the event is still produced and still persisted, but with
   authority `ineligible`, and isSupported() then dropped it in silence. So
   one boolean turned a founder's own fault into `absent`, and `absent` reads
   as "the chance never arose".

   The claim is not adjudicable from the record (see evidence-extraction), so
   it is not overruled -- it is DECLARED. The frozen disputed-delivery
   amendment already settles what to do with evidence we cannot stand behind:
   indeterminate, moving mastery in neither direction, and COUNTED so the
   seller can see we could not tell. Suppression stops paying without ever
   convicting anyone on a half-spoken sentence. */
const isCompletenessSuppressed = (e) => (e && (e.authority ?? null) === 'ineligible')
  && /incomplete_turn/.test(basisOf(e));

/* ── DOES ABSENCE PROVE THERE WAS NO CHANCE, OR ONLY THAT NOTHING LOOKS? ──
   For five skills the opportunity events ARE the chance: no objection raised
   means there was no objection to handle, and `absent` is simply true.

   `grounding_claims` is the exception and it is not a judgement call -- both
   of its opportunity events are its own NEGATIVES (`unsupported_assumption`,
   `explicit_correction`), so their absence proves nothing whatever about
   whether the founder made claims. While a quality source existed, that
   source alone created the opportunity AND passed it. With the source
   withdrawn there is no detector left, and returning `absent` would assert
   "they never claimed anything about the prospect" -- exactly as false as the
   `strong` it replaces, and a NEW false assertion rather than a removed one.
   Measured on the four frozen calls: without this, all four flip
   present/strong -> absent.

   Declared per skill rather than inferred, because "my events are all
   negatives" is a fact about the vocabulary that a future event type could
   silently change. */
const ABSENCE_PROVES_NO_OPPORTUNITY = Object.freeze({
  discovery: true,
  listening_and_building: true,
  /* P5R-6: it now HAS a positive event, so absence of all three of its
     opportunity events really does mean no claim was made and none was
     supported -- which is a genuine `absent`, not a blind spot. */
  grounding_claims: true,
  objection_handling: true,
  pitch_discipline: true,
  authority_and_routing: true,
});

/* ── ASSISTANCE: FIVE STATES, AND ONLY WHAT IS PROVABLE ────────────────
   The trace killed two of the seven the brief asked for.

   "Guidance available but not used" is unprovable, not even approximable:
   the rail renders unconditionally with no click, dwell, focus or scroll
   signal of any kind. "They used the supplied wording" is structurally
   unprovable: the offered lines are never persisted, so there is nothing to
   diff a retry against, and adheres() checks MOVE adherence rather than
   verbatim matching, deliberately.

   `help_used` is a LOWER BOUND on assistance OFFERED and nothing more. It is
   stamped when the wording is fetched, before the founder says anything, so
   a founder who reads the card and walks away leaves it true. Never equate
   offered with used. */
export function resolveAssistance({ format, guidedEvents = [], assistedTurns = false } = {}) {
  const outcomes = guidedEvents.map((g) => g && (g.outcome ?? null)).filter(Boolean);
  if (outcomes.includes('corrected_unaided')) return ASSISTANCE.CORRECTED_UNAIDED;
  const offered = guidedEvents.some((g) => g
    && ((g.help_used ?? g.helpUsed) === true || (g.wtsi_shown ?? g.wtsiShown) === true));
  if (offered) return ASSISTANCE.HELP_OFFERED;
  if (assistedTurns) return ASSISTANCE.ON_SCREEN;
  /* `full_simulation` is trustworthy only on sessions created after the
     format-provenance fix. The caller decides that and passes null if not,
     because 157 older sessions read full_simulation by defaulting rather
     than by anybody choosing it. */
  if (format === 'full_simulation') return ASSISTANCE.UNAVAILABLE;
  return ASSISTANCE.UNKNOWN;
}

/* Only `unavailable` execution and `intervention_corrected_unaided` can lift
   a skill to reliable or strong. `assistance_on_screen` can lift developing
   and always counts as history. `unknown` never moves a band either way.
   Semantic, never a multiplier: a seller who only ever succeeds with the
   rail up is `developing`, and is told exactly that. */
export function isUnaidedAssistance(assistance) {
  return assistance === ASSISTANCE.UNAVAILABLE
    || assistance === ASSISTANCE.CORRECTED_UNAIDED;
}

/* ── ONE OBSERVATION FOR ONE SKILL ─────────────────────────────────────
   `events` are canonical Phase 2 events for this call, already filtered to
   the current run by the caller. `quality` carries ONLY the four verified
   safe signals above; there is no way to pass a blocked axis. */
export function observeSkill({
  skill, sessionId, sourceFingerprint, events = [], quality = {},
  /* Same rule as observeCall: no default track, ever again. */
  assistance = ASSISTANCE.UNKNOWN, track = null, context = {},
  sourceType = SOURCE_TYPE.SIMULATED, extractorVersion = null,
  taxonomyVersion = TAXONOMY_VERSION,
  observationLogicVersion = OBSERVATION_LOGIC_VERSION,
  provenanceComplete = true, callAnchors = [], excludedContext = null,
} = {}) {
  if (!SKILLS.includes(skill)) throw new Error(`unknown_skill:${skill}`);
  if (!track || !Object.values(TRACK).includes(track)) {
    throw new Error(`observe_skill_without_track:${track || 'missing'}`);
  }

  const supported = events.filter(isSupported);
  const opportunityHits = supported.filter((e) => OPPORTUNITY_EVENTS[skill].includes(typeOf(e)));
  const positiveHits = supported.filter((e) => POSITIVE_EVENTS[skill].includes(typeOf(e)));
  const negativeHits = supported.filter((e) => NEGATIVE_EVENTS[skill].includes(typeOf(e)));

  const sourceKey = POSITIVE_SOURCE[skill];
  const sourceValue = sourceKey ? quality[sourceKey] : undefined;
  /* `null`/`undefined` means the signal could not be measured for this call.
     `false` means it was measured and was not positive -- a real zero. */
  const sourceUnavailable = Boolean(sourceKey) && (sourceValue === null || sourceValue === undefined);
  const sourcePositive = Boolean(sourceKey) && sourceValue === true;

  /* EVERY OBSERVATION CITES SOMETHING, including `absent` ones. "This skill
     never came up" is a claim about a specific settled call, and the store
     enforces it: evidence_refs is NOT NULL with a non-empty CHECK, so an
     uncited observation is refused outright. Skill-specific citations first;
     failing that the caller's call-level anchors; failing that whatever
     canonical evidence the call has. */
  const cited = Array.from(new Set(
    opportunityHits.concat(positiveHits, negativeHits).map(idOf).filter(Boolean)));
  const fallback = callAnchors.length
    ? callAnchors
    : events.map(idOf).filter(Boolean).slice(0, 8);
  const anchors = cited.length ? cited : fallback;

  /* ── THE BLOCKED SOURCES, CARRIED BUT NEVER CONSULTED ───────────────
     The frozen rule permits a blocked source to remain attached as
     HISTORICAL PROVENANCE and to be reported as excluded. It exists here
     for one reason: without an injection point, "the blocked axes cannot
     move mastery" is unfalsifiable -- the gate could only assert absence by
     reading the code, and a later edit that started consulting them would
     not fail anything.

     So they arrive, they are recorded under a namespaced key, and nothing
     above reads `excludedContext`. T27 injects each of the four at extreme
     values and asserts the observation is byte-identical apart from this
     field. Delete the exclusion and that gate goes red. */
  const build = (opportunity, demonstrated, extra, refs) => ({
    observationId: deriveObservationId({
      sessionId, skill, opportunity, track, sourceFingerprint, extractorVersion,
      taxonomyVersion, observationLogicVersion,
    }),
    skill, opportunity, demonstrated, assistance, track,
    context: {
      ...context,
      ...extra,
      ...(excludedContext ? { excluded_unfair_sources: excludedContext } : {}),
    },
    sourceType, evidenceRefs: refs, extractorVersion,
    taxonomyVersion, observationLogicVersion,
  });

  /* ── DISPUTED DELIVERY IS INDETERMINATE ─────────────────────────────
     Frozen amendment. If ANY contributing event leans on a prospect turn
     whose undelivered claim contradicted the transcript, the OPPORTUNITY
     itself is what is in doubt -- an objection whose delivery is disputed
     makes "was there a chance to handle an objection" contested, not merely
     one datum. Partial credit off a contested premise is precisely the
     unfairness the blocked-input rule exists to prevent.

     It resolves to `unknown`, which by the frozen machinery never enters the
     window and moves nothing in either direction, and is COUNTED so a seller
     can see that we could not tell. `indeterminate_reason` keeps it
     distinguishable from legacy-unknown for anyone who needs the difference. */
  /* Checked against the RAW events, not `supported`: the whole point is that
     isSupported() has already dropped these, which is how the suppression
     went unseen. */
  const suppressed = events.filter((e) => isCompletenessSuppressed(e)
    && OPPORTUNITY_EVENTS[skill].includes(typeOf(e)));
  if (suppressed.length) {
    return build(OPPORTUNITY.UNKNOWN, null, {
      indeterminate_reason: INDETERMINATE.SUPPRESSED_COMPLETENESS,
      suppressed_event_ids: Array.from(new Set(suppressed.map(idOf).filter(Boolean))),
    }, anchors);
  }

  const disputed = opportunityHits.concat(positiveHits, negativeHits)
    .filter((e) => deliveryOf(e) === 'disputed');
  if (disputed.length) {
    return build(OPPORTUNITY.UNKNOWN, null, {
      indeterminate_reason: INDETERMINATE.DISPUTED_DELIVERY,
      disputed_event_ids: Array.from(new Set(disputed.map(idOf).filter(Boolean))),
    }, anchors);
  }

  /* Provenance we could not establish is unknown too -- counted, never weak.
     A legacy call is not a bad call; it is an unreadable one. */
  if (!provenanceComplete) {
    return build(OPPORTUNITY.UNKNOWN, null,
      { indeterminate_reason: INDETERMINATE.LEGACY_PROVENANCE }, anchors);
  }

  if (!opportunityHits.length && !sourcePositive) {
    if (ABSENCE_PROVES_NO_OPPORTUNITY[skill]) {
      return build(OPPORTUNITY.ABSENT, null, {}, anchors);
    }
    /* See ABSENCE_PROVES_NO_OPPORTUNITY: for this skill nothing looks, so
       `absent` would be a fresh false claim rather than a removed one.
       `missing_source` is stamped only when the source was genuinely
       unmeasurable -- naming it on a source we DID measure would be a second,
       quieter false claim about why we cannot tell. */
    return build(OPPORTUNITY.UNKNOWN, null, {
      indeterminate_reason: INDETERMINATE.NO_QUALITY_SOURCE,
      ...(sourceUnavailable ? { missing_source: sourceKey } : {}),
    }, anchors);
  }

  /* The chance existed but its positive signal is unmeasurable, so we cannot
     claim zero positives -- and zero positives with a negative present is
     exactly what `weak` means. Refusing to grade is the honest move. */
  if (sourceUnavailable) {
    return build(OPPORTUNITY.UNKNOWN, null, {
      indeterminate_reason: INDETERMINATE.NO_QUALITY_SOURCE,
      missing_source: sourceKey,
    }, anchors);
  }

  /* ── WHICH OF THE FIVE OUTCOMES THIS WAS ────────────────────────────
     Order is the argument. Engagement is checked FIRST, because a founder
     who got an answer succeeded even if three other questions were refused.
     Only when nothing was engaged do we ask who closed the chance -- and we
     ask about the founder's own decision before the counterparty's, because
     `pitch_declined` is a statement about the founder and a refusal is not. */
  const positives = positiveHits.length + (sourcePositive ? 1 : 0);
  const negatives = negativeHits.length;
  const detail = { positives, negatives };

  if (positives > 0 || negatives > 0) {
    const grade = gradeFrom(positives, negatives);
    const outcome = grade === DEMONSTRATED.WEAK
      ? OPPORTUNITY.ATTEMPTED_FAILURE : OPPORTUNITY.ATTEMPTED_SUCCESS;
    return build(outcome, grade, detail, anchors);
  }

  const declined = supported.filter((e) => DECLINE_EVENTS[skill].includes(typeOf(e)));
  if (declined.length) {
    return build(OPPORTUNITY.DECLINED, null, {
      ...detail, declined_event_ids: Array.from(new Set(declined.map(idOf).filter(Boolean))),
    }, anchors);
  }

  const prevented = supported.filter((e) => PREVENT_EVENTS[skill].includes(typeOf(e)));
  if (prevented.length) {
    return build(OPPORTUNITY.PREVENTED, null, {
      ...detail, prevented_event_ids: Array.from(new Set(prevented.map(idOf).filter(Boolean))),
    }, anchors);
  }

  /* The chance arose, nothing was engaged, and nothing says why. Not a
     decision, not an obstruction, and emphatically not a failure. */
  return build(OPPORTUNITY.UNKNOWN, null, {
    ...detail, indeterminate_reason: INDETERMINATE.NOT_ENGAGED_NO_INTENT_EVIDENCE,
  }, anchors);
}

/* Every skill, for one call. A skill with no anchoring evidence is returned
   as `absent` rather than omitted, so "it never came up" is a recorded fact
   instead of a gap a later reader has to interpret. */
export function observeCall({
  sessionId, sourceFingerprint, events = [], guidedEvents = [], quality = {},
  /* NO DEFAULT TRACK. The v1 default (`buyer`) is how every observation in
     production got mis-stamped when a broken score read went silently null:
     the caller "worked", the default filled in, and gatekeeper calls aged
     the buyer window. A caller that does not know the track must refuse to
     observe, not guess the denominator. */
  format = null, track = null, context = {}, assistedTurns = false,
  provenanceComplete = true, extractorVersion = null, excludedContext = null,
  sourceType = SOURCE_TYPE.SIMULATED,
  taxonomyVersion = TAXONOMY_VERSION,
  observationLogicVersion = OBSERVATION_LOGIC_VERSION,
} = {}) {
  if (!sessionId) throw new Error('observe_without_session');
  if (!track || !Object.values(TRACK).includes(track)) {
    throw new Error(`observe_without_track:${track || 'missing'}`);
  }
  /* An observation must cite something. With no canonical evidence at all
     there is nothing to attribute, so the call yields nothing rather than
     six empty verdicts about a call nobody can point at. */
  if (!events.length) return [];
  const assistance = resolveAssistance({ format, guidedEvents, assistedTurns });
  const callAnchors = events.map(idOf).filter(Boolean).slice(0, 8);
  return SKILLS.map((skill) => observeSkill({
    skill, sessionId, sourceFingerprint, events, quality, assistance, track,
    context, sourceType, extractorVersion, taxonomyVersion,
    observationLogicVersion, provenanceComplete, callAnchors, excludedContext,
  }));
}
