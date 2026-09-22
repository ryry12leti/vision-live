/**
 * Deterministic Founder venture-state assembly: merges venture source
 * records (chat extraction, user confirmation, verified integration
 * evidence) into a trust-tracked venture state, or reports exactly what
 * is missing before one can exist. Pure function of its inputs — the same
 * previousState + sourceRecords always produces the same result.
 *
 * There is no separate internal "replay" bag: a `ventureState` result IS
 * the complete persistable record. Every field this module needs to
 * resume a merge from (value/sourceStatus/sourceRecordId/recordedAt for
 * scalar and list facts; the richer currentStage/founderMode views) is
 * already present in the public shape, so `reconstructMergeState` below
 * derives everything it needs directly from a `previousState` that
 * contract.js's validatePreviousVentureState has already fully
 * re-validated — a caller may `JSON.stringify`/`JSON.parse` a
 * `ventureState` and pass it straight back in as `previousState` with
 * nothing lost and nothing to strip.
 */

import {
  DEFAULT_FOUNDER_MODE,
  FOUNDER_VENTURE_STATE_CONTRACT_VERSION,
  NEXT_ACTIONS,
  REQUIRED_USABLE_FIELDS,
  SOURCE_TYPE_STATUS,
  TRUSTED_FIELD_NAMES,
  WHAT_FIELDS_ANY_OF,
  deepFreeze,
  isPlainObject,
  statusRank,
  validateAssemblyInput,
} from './contract.js';

function byOccurredThenId(left, right) {
  const leftMs = Date.parse(left.occurredAt);
  const rightMs = Date.parse(right.occurredAt);
  if (leftMs !== rightMs) return leftMs - rightMs;
  return left.sourceRecordId.localeCompare(right.sourceRecordId);
}

/**
 * Attempts to apply one incoming fact to one field's current state.
 * Returns `{ field, history, rejected }` — exactly one of `history`
 * (the superseded field, when the update is accepted and something
 * existed before) or `rejected` (the attempted update, when a lower- or
 * equal-and-older trust tier tried to overwrite a higher one) is set.
 *
 * A same-rank update is accepted (last-write-within-tier-wins, since
 * records are always processed oldest-first) — e.g. the user correcting
 * themselves in a later confirmed message. A strictly lower-rank update
 * (e.g. a provisional chat guess arriving after the fact was already
 * user_reported or verified) is rejected outright: never silently
 * overwrite a higher-trust fact with a lower-trust one, whether that
 * higher-trust fact was set earlier in this same call or carried forward
 * from a previous, persisted assembly.
 */
function mergeField(current, incomingValue, incomingStatus, record) {
  const incoming = {
    value: incomingValue,
    sourceStatus: incomingStatus,
    sourceRecordId: record.sourceRecordId,
    recordedAt: record.occurredAt,
  };
  if (!current) return { field: incoming };
  if (statusRank(incomingStatus) < statusRank(current.sourceStatus)) {
    return {
      field: current,
      rejected: {
        attemptedValue: incomingValue,
        attemptedStatus: incomingStatus,
        attemptedSourceRecordId: record.sourceRecordId,
        existingStatus: current.sourceStatus,
        reason: 'a lower-trust update cannot overwrite an existing higher-trust fact',
      },
    };
  }
  return { field: incoming, history: current };
}

function buildStage(currentRaw, incomingValue, incomingStatus, record) {
  const merged = mergeField(currentRaw, incomingValue, incomingStatus, record);
  return {
    raw: merged.field,
    history: merged.history,
    rejected: merged.rejected,
    view: {
      value: merged.field.value,
      source: 'explicit',
      confidence: 1,
      sourceStatus: merged.field.sourceStatus,
      supportingFactIds: [merged.field.sourceRecordId],
      updatedAt: merged.field.recordedAt,
    },
  };
}

const UNKNOWN_STAGE_VIEW = Object.freeze({
  value: null, source: 'unknown', confidence: null, sourceStatus: null, supportingFactIds: [], updatedAt: null,
});

/**
 * Reconstructs the exact internal merge state (`fields`, stage's raw
 * TrustedField, founderMode's raw TrustedField, `history`,
 * `rejectedUpdates`) purely from an already-validated `previousState` —
 * the public shape and the merge-resumption shape are the same data,
 * never a second hidden copy that a caller could accidentally drop.
 */
function reconstructMergeState(previousState) {
  if (!previousState) {
    return { fields: {}, stageRaw: null, founderModeRaw: null, history: [], rejectedUpdates: [] };
  }
  const fields = {};
  for (const field of TRUSTED_FIELD_NAMES) {
    if (Object.hasOwn(previousState, field)) fields[field] = previousState[field];
  }
  const stageView = previousState.currentStage;
  const stageRaw = stageView.value === null ? null : {
    value: stageView.value,
    sourceStatus: stageView.sourceStatus,
    sourceRecordId: stageView.supportingFactIds[0],
    recordedAt: stageView.updatedAt,
  };
  const founderModeView = previousState.founderMode;
  const founderModeRaw = founderModeView.defaulted ? null : {
    value: founderModeView.value,
    sourceStatus: founderModeView.sourceStatus,
    sourceRecordId: founderModeView.sourceRecordId,
    recordedAt: founderModeView.updatedAt,
  };
  return {
    fields,
    stageRaw,
    founderModeRaw,
    history: [...previousState.history],
    rejectedUpdates: [...previousState.rejectedUpdates],
  };
}

function pickClarificationQuestion(missingFields) {
  if (missingFields.includes('businessModelFamily')) {
    return 'What kind of business is this — an app/software product, an agency or freelance service, ecommerce, a creator-led business, a local/physical business, or coaching/consulting?';
  }
  if (missingFields.includes('what_you_are_building')) {
    return 'In one or two sentences, what are you actually building or offering, and who is it for?';
  }
  if (missingFields.includes('completedWork')) {
    return "What have you already done on this venture so far, even if it's small or incomplete?";
  }
  if (missingFields.includes('unfinishedWork')) {
    return "What's still unfinished or blocking you right now?";
  }
  return 'What do you want help with on this venture right now?';
}

function computeStateConfidence(fields) {
  const weights = { verified: 1, user_reported: 0.6, provisional: 0.3 };
  const present = fields.filter(Boolean);
  if (present.length === 0) return 0;
  const total = present.reduce((sum, field) => sum + weights[field.sourceStatus], 0);
  return Math.round((total / present.length) * 100) / 100;
}

/**
 * @param {object} input See contract.js validateAssemblyInput for the
 *   exact shape: { contractVersion, ventureId, ventureRole, evaluationTime,
 *   previousState, sourceRecords }. `previousState` must be null or a
 *   previously returned `ventureState` — contract.js fully re-validates
 *   every field of it before this function ever runs.
 * @returns {object} `{ status: 'invalid_input', errors }`,
 *   `{ status: 'insufficient_context', ventureId, ventureRole,
 *   missingFields, clarificationQuestion, allowedNextActions }`, or
 *   `{ status: 'ready', ventureState }`.
 */
export function assembleFounderVentureState(input) {
  const validation = validateAssemblyInput(input);
  if (!validation.valid) {
    return deepFreeze({ status: 'invalid_input', errors: validation.errors });
  }

  const previous = isPlainObject(input.previousState) ? input.previousState : null;
  const eligible = input.sourceRecords
    .filter((record) => record.ventureId === input.ventureId)
    .slice()
    .sort(byOccurredThenId);

  const {
    fields, stageRaw, founderModeRaw, history, rejectedUpdates,
  } = reconstructMergeState(previous);
  let stage = stageRaw ? { raw: stageRaw, view: null } : { raw: null, view: UNKNOWN_STAGE_VIEW };
  let founderModeField = founderModeRaw;

  for (const record of eligible) {
    const incomingStatus = SOURCE_TYPE_STATUS[record.sourceType];
    for (const [field, value] of Object.entries(record.capturedFacts)) {
      if (field === 'currentStage') {
        const result = buildStage(stage.raw, value, incomingStatus, record);
        stage = { raw: result.raw, view: result.view };
        if (result.history) history.push({ field, previous: result.history, replacedAt: record.occurredAt, replacedBySourceRecordId: record.sourceRecordId });
        if (result.rejected) rejectedUpdates.push({ field, ...result.rejected });
        continue;
      }
      if (field === 'founderMode') {
        const result = mergeField(founderModeField, value, incomingStatus, record);
        founderModeField = result.field;
        if (result.history) history.push({ field, previous: result.history, replacedAt: record.occurredAt, replacedBySourceRecordId: record.sourceRecordId });
        if (result.rejected) rejectedUpdates.push({ field, ...result.rejected });
        continue;
      }
      const result = mergeField(fields[field], value, incomingStatus, record);
      fields[field] = result.field;
      if (result.history) history.push({ field, previous: result.history, replacedAt: record.occurredAt, replacedBySourceRecordId: record.sourceRecordId });
      if (result.rejected) rejectedUpdates.push({ field, ...result.rejected });
    }
  }
  // stage.view is only ever null here when a previously-explicit stage was
  // carried forward untouched this call (no new currentStage fact
  // arrived) — rebuild its view from the still-current raw field.
  if (!stage.view) {
    stage = {
      raw: stage.raw,
      view: {
        value: stage.raw.value,
        source: 'explicit',
        confidence: 1,
        sourceStatus: stage.raw.sourceStatus,
        supportingFactIds: [stage.raw.sourceRecordId],
        updatedAt: stage.raw.recordedAt,
      },
    };
  }

  const missingFields = [];
  for (const field of REQUIRED_USABLE_FIELDS) {
    if (!fields[field]) missingFields.push(field);
  }
  if (!WHAT_FIELDS_ANY_OF.some((field) => fields[field])) missingFields.push('what_you_are_building');

  if (missingFields.length > 0) {
    return deepFreeze({
      status: 'insufficient_context',
      contractVersion: FOUNDER_VENTURE_STATE_CONTRACT_VERSION,
      ventureId: input.ventureId,
      ventureRole: input.ventureRole,
      missingFields,
      clarificationQuestion: pickClarificationQuestion(missingFields),
      allowedNextActions: [...NEXT_ACTIONS],
    });
  }

  const founderMode = founderModeField
    ? { value: founderModeField.value, sourceStatus: founderModeField.sourceStatus, defaulted: false, sourceRecordId: founderModeField.sourceRecordId, updatedAt: founderModeField.recordedAt }
    : { value: DEFAULT_FOUNDER_MODE, sourceStatus: 'provisional', defaulted: true, sourceRecordId: null, updatedAt: null };

  const ventureState = {
    contractVersion: FOUNDER_VENTURE_STATE_CONTRACT_VERSION,
    ventureId: input.ventureId,
    ventureRole: input.ventureRole,
    ...(fields.ventureName ? { ventureName: fields.ventureName } : {}),
    ...(fields.idea ? { idea: fields.idea } : {}),
    ...(fields.niche ? { niche: fields.niche } : {}),
    businessModelFamily: fields.businessModelFamily,
    ...(fields.targetCustomer ? { targetCustomer: fields.targetCustomer } : {}),
    ...(fields.offer ? { offer: fields.offer } : {}),
    currentStage: stage.view,
    ...(fields.currentLevel ? { currentLevel: fields.currentLevel } : {}),
    ...(fields.immediateGoal ? { immediateGoal: fields.immediateGoal } : {}),
    ...(fields.futureGoal ? { futureGoal: fields.futureGoal } : {}),
    completedWork: fields.completedWork,
    unfinishedWork: fields.unfinishedWork,
    requestedHelp: fields.requestedHelp,
    ...(fields.currentBottleneck ? { currentBottleneck: fields.currentBottleneck } : {}),
    ...(fields.availableResourceIds ? { availableResourceIds: fields.availableResourceIds } : {}),
    ...(fields.pushLevel ? { pushLevel: fields.pushLevel } : {}),
    founderMode,
    stateConfidence: computeStateConfidence([
      fields.businessModelFamily, fields.idea, fields.niche, fields.offer, fields.targetCustomer,
      fields.completedWork, fields.unfinishedWork, fields.requestedHelp, fields.currentBottleneck,
      stage.raw, founderModeField,
    ]),
    updatedAt: input.evaluationTime,
    history,
    rejectedUpdates,
  };

  return deepFreeze({ status: 'ready', ventureState });
}
