/**
 * Onboarding collector — Founder Venture State V2, task spec section 4/A.
 *
 * Accepts partial onboarding input and produces only the facts genuinely
 * supplied (never a long form, never a fabricated default for a field the
 * user skipped). `ventureType`/`ventureName`/`businessModel`/`description`
 * are venture-row identity fields (see founder_ventures), not ledger facts
 * — they are returned separately so the caller (service-v2.js) can apply
 * them to the venture row, not the fact ledger.
 */

import { buildFact } from '../fact-ledger.js';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => isNonEmptyString(item));
}

/**
 * @param {object} params
 * @param {string} params.ventureId
 * @param {string} params.userId
 * @param {object} params.input Partial onboarding answers — every field optional.
 * @param {string|null} [params.input.idea] Venture idea or existing business, in the user's own words.
 * @param {string[]|null} [params.input.completedWork]
 * @param {string[]|null} [params.input.unfinishedWork]
 * @param {string|null} [params.input.requestedHelp]
 * @param {string|null} [params.input.immediateGoal] Primary goal.
 * @param {string|null} [params.input.futureGoal] Optional secondary goal.
 * @param {string|null} [params.input.currentStage] Only when the user explicitly named it.
 * @param {string|null} [params.input.ventureType] Known venture type — applied to the venture row, not a fact.
 * @param {string} params.sessionReference A stable, non-secret reference to this onboarding session (e.g. `onboarding_session:<id>`).
 * @param {string} params.occurredAt ISO timestamp of when onboarding was actually completed.
 * @returns {{ventureRowUpdates: {ventureType: string|null}, facts: object[]}}
 */
export function mapOnboardingToFacts({
  ventureId, userId, input, sessionReference, occurredAt,
}) {
  const facts = [];
  const recordedAt = occurredAt;
  let seq = 0;
  const nextFactId = () => `${sessionReference}:${seq++}`;

  const scalarField = (factKey, value) => {
    if (isNonEmptyString(value)) {
      facts.push(buildFact({
        factId: nextFactId(), ventureId, userId, factKey, value, sourceType: 'onboarding',
        sourceReference: sessionReference, occurredAt, recordedAt,
      }));
    }
  };
  const listField = (factKey, value) => {
    if (isNonEmptyStringArray(value)) {
      facts.push(buildFact({
        factId: nextFactId(), ventureId, userId, factKey, value, sourceType: 'onboarding',
        sourceReference: sessionReference, occurredAt, recordedAt,
      }));
    }
  };

  scalarField('idea', input?.idea);
  listField('completedWork', input?.completedWork);
  listField('unfinishedWork', input?.unfinishedWork);
  scalarField('requestedHelp', input?.requestedHelp);
  scalarField('immediateGoal', input?.immediateGoal);
  scalarField('futureGoal', input?.futureGoal);
  if (isNonEmptyString(input?.currentStage)) {
    facts.push(buildFact({
      factId: nextFactId(), ventureId, userId, factKey: 'currentStage', value: input.currentStage,
      sourceType: 'onboarding', sourceReference: sessionReference, occurredAt, recordedAt,
    }));
  }

  return {
    ventureRowUpdates: { ventureType: isNonEmptyString(input?.ventureType) ? input.ventureType : null },
    facts,
  };
}
