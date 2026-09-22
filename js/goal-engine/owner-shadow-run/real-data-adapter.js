/**
 * Owner-only shadow-run real-data adapter.
 *
 * Maps the exact real columns generate-tasks reads from public.profiles
 * into the JS trusted-context sourceRecords contract
 * (js/goal-engine/trusted-context/contract.js). A source record is only
 * emitted when every field selectLatest() will require for that source type
 * is already a genuine, non-empty value on the profile row -- there is no
 * synthetic milestone, route, prerequisite, programme, safety-constraint,
 * recovery, domain-fact, progress, capability-baseline, proof-capability, or
 * preference record. public.profiles has no columns for any of those (goals,
 * goal_routes, goal_milestones, etc. exist only in the STAGING canonical
 * schema, not production -- see docs/goal-engine/inventory), and inventing
 * one would violate the "never fabricate" requirement. Their absence is
 * surfaced by assembleTrustedContext itself as a missing/clarification-
 * required question, never silently patched here.
 *
 * `goalId` is a synthetic scoping key (`shadow_goal:<userId>`), not a
 * persisted Goal Engine goal id -- production has no `public.goals` table.
 * It exists only so the one flat goal a profile row represents can be
 * threaded through the goalId-scoped assembler contract; it is surfaced
 * back to the caller so nobody mistakes it for a real row id.
 */

import { TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION } from '../trusted-context/contract.js';
import { classifyDomainId } from './domain-classifier.js';

export function shadowGoalId(targetUserId) {
  return `shadow_goal:${targetUserId}`;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null;
}

function isoTimestamp(value, fallback) {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function baseRecord({
  sourceType, goalId, sourceRecordId, eventId, occurredAt, ingestedAt,
  capturedFacts, referenceId, streamId, authority, actorType,
}) {
  return {
    contractVersion: TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION,
    sourceRecordId,
    eventId,
    sourceType,
    goalId,
    verificationStatus: 'verified',
    sourceSequence: 0,
    occurredAt,
    ingestedAt,
    eventVersion: 1,
    capturedFacts,
    provenanceReference: referenceId,
    provenance: { authority, actorType, referenceId, streamId },
    confidence: null,
  };
}

// Source types the JS trusted-context contract can require that have no
// corresponding real column/table in production today. Listed explicitly
// (rather than silently omitted) so the shadow-run response can name every
// one of them as "structurally unavailable, not fabricated".
export const STRUCTURALLY_UNAVAILABLE_SOURCE_TYPES = Object.freeze([
  'active_milestone',
  'route_state',
  'prerequisite_state',
  'external_programme',
  'safety_constraints',
  'recovery_history',
  'domain_facts',
  'progress_history',
  'verified_capability_assessment',
  'proof_capability_state',
  'verified_preference',
]);

/**
 * @param {object} params
 * @typedef {object} ShadowSourceRecord
 * @property {number} contractVersion
 * @property {string} sourceRecordId
 * @property {string} eventId
 * @property {string} sourceType
 * @property {string} goalId
 * @property {string} verificationStatus
 * @property {number} sourceSequence
 * @property {string} occurredAt
 * @property {string} ingestedAt
 * @property {number} eventVersion
 * @property {Record<string, unknown>} capturedFacts
 * @property {string} provenanceReference
 * @property {{authority: string, actorType: string, referenceId: string, streamId: string}} provenance
 * @property {number|null} confidence
 *
 * @param {object} params
 * @param {object} params.profile A public.profiles row for the target user.
 * @param {string} params.targetUserId
 * @param {string} params.goalId Synthetic scoping id from shadowGoalId().
 * @param {string} params.evaluationTime ISO timestamp for "now".
 * @param {string} params.userLocalDate YYYY-MM-DD.
 * @returns {{
 *   sourceRecords: ShadowSourceRecord[],
 *   recordsSkipped: {sourceType: string, reason: string}[],
 *   warnings: string[],
 *   domainId: string|null,
 * }}
 */
export function buildRealSourceRecords({
  profile, targetUserId, goalId, evaluationTime, userLocalDate,
}) {
  const sourceRecords = [];
  const recordsSkipped = [];
  const warnings = [];
  const referenceId = `profiles:${targetUserId}`;
  const profileOccurredAt = isoTimestamp(profile?.updated_at, evaluationTime);
  const domainId = classifyDomainId(profile || {});

  // user_confirmed_goal
  const goalDescription = nonEmptyString(profile?.main_goal) || nonEmptyString(profile?.goal_domain);
  const goalCategory = nonEmptyString(profile?.goal_category);
  const goalRole = nonEmptyString(profile?.goal_role);
  const chosenLevel = nonEmptyString(profile?.current_level);
  const pushLevel = nonEmptyString(profile?.target_level);
  const missingGoalFields = [
    !goalDescription && 'main_goal/goal_domain',
    !goalCategory && 'goal_category',
    !goalRole && 'goal_role',
    !domainId && 'domain classification (goal_category/domain_type/path_type/main_goal did not map to a canonical Goal Engine domain)',
    !chosenLevel && 'current_level',
    !pushLevel && 'target_level',
  ].filter(Boolean);
  if (missingGoalFields.length === 0) {
    sourceRecords.push(baseRecord({
      sourceType: 'user_confirmed_goal',
      goalId,
      sourceRecordId: `profile_goal:${targetUserId}:v1`,
      eventId: `profile_goal:${targetUserId}`,
      occurredAt: profileOccurredAt,
      ingestedAt: evaluationTime,
      capturedFacts: {
        goalDescription, goalCategory, goalRole, domainId, chosenLevel, pushLevel,
      },
      referenceId,
      streamId: `profile_goal:${targetUserId}`,
      authority: 'user_confirmed',
      actorType: 'user',
    }));
  } else {
    recordsSkipped.push({ sourceType: 'user_confirmed_goal', reason: `missing real fields: ${missingGoalFields.join(', ')}` });
  }

  // schedule
  const availableMinutes = positiveInt(profile?.preferred_task_minutes);
  if (availableMinutes) {
    sourceRecords.push(baseRecord({
      sourceType: 'schedule',
      goalId,
      sourceRecordId: `profile_schedule:${targetUserId}:${userLocalDate}`,
      eventId: `profile_schedule:${targetUserId}:${userLocalDate}`,
      occurredAt: profileOccurredAt,
      ingestedAt: evaluationTime,
      capturedFacts: { availableMinutes, userLocalDate },
      referenceId,
      streamId: `profile_schedule:${targetUserId}`,
      authority: 'vision_server',
      actorType: 'vision',
    }));
    warnings.push('schedule.occurredAt approximated from profiles.updated_at; VISION has no dedicated schedule-decision event');
  } else {
    recordsSkipped.push({ sourceType: 'schedule', reason: 'missing real field: preferred_task_minutes' });
  }

  // available_resources -- only when profiles.resources is genuinely an array of strings.
  const resourcesRaw = profile?.resources;
  const resourceIds = Array.isArray(resourcesRaw)
    ? resourcesRaw.filter((value) => typeof value === 'string' && value.trim().length > 0)
    : null;
  if (resourceIds && resourceIds.length > 0) {
    sourceRecords.push(baseRecord({
      sourceType: 'available_resources',
      goalId,
      sourceRecordId: `profile_resources:${targetUserId}:v1`,
      eventId: `profile_resources:${targetUserId}`,
      occurredAt: profileOccurredAt,
      ingestedAt: evaluationTime,
      capturedFacts: { resourceIds },
      referenceId,
      streamId: `profile_resources:${targetUserId}`,
      authority: 'vision_server',
      actorType: 'vision',
    }));
  } else {
    recordsSkipped.push({
      sourceType: 'available_resources',
      reason: Array.isArray(resourcesRaw)
        ? 'profiles.resources array is empty'
        : 'profiles.resources is not a genuine array of resource identifiers (unrecognised shape, not guessed)',
    });
  }

  for (const sourceType of STRUCTURALLY_UNAVAILABLE_SOURCE_TYPES) {
    recordsSkipped.push({ sourceType, reason: 'no corresponding column or table exists in production; not fabricated' });
  }

  return {
    sourceRecords, recordsSkipped, warnings, domainId,
  };
}
