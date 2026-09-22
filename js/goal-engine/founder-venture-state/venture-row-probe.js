/**
 * Founder Venture State — stored-row probe.
 *
 * Answers exactly one question: "if a founder_venture_state row exists for
 * this user/venture, is it safe to consume?" Shared by BOTH the canonical
 * Founder Decision Service live path (supabase/functions/_shared/
 * founder-engine-bridge.mjs) and the owner shadow preview
 * (js/goal-engine/owner-shadow-run/) -- moved here from owner-shadow-run so
 * the live path never depends on an owner/shadow-namespaced module (spec:
 * "the canonical engine must not depend on preview-only dependencies").
 * owner-shadow-run/founder-venture-probe.js now re-exports this exact
 * function so every existing caller/import path keeps working unchanged.
 *
 * `founder_venture_state.state` now stores the full V2 materialised-state
 * shape (buildMaterialisedVentureState's output — see snapshot.js and the
 * migration). A raw jsonb `state` column is NEVER trusted directly: every
 * row is first structurally re-validated with validateMaterialisedVentureState
 * (fails closed on any missing/unknown/mismatched field), and only THEN
 * rebuilt into the actual trusted Goal Engine snapshot via
 * buildFounderGoalEngineSnapshot + validateFounderGoalEngineSnapshot — this
 * is "read the trusted snapshot, not raw table JSON" in practice.
 *
 * `state.entities` (added to the materialised state by snapshot.js's
 * buildMaterialisedVentureState) is re-derived into the trusted Founder
 * Execution Entities bundle the same way — buildFounderExecutionEntities +
 * validateFounderExecutionEntities, never trusting state.entities directly.
 * This is still ONE cached jsonb blob, not a second table or a second read.
 */

import {
  buildFounderGoalEngineSnapshot,
  validateFounderGoalEngineSnapshot,
  validateMaterialisedVentureState,
} from './snapshot.js';
import { buildFounderExecutionEntities, validateFounderExecutionEntities } from './entity-snapshot.js';

/**
 * @typedef {object} FounderVentureRowEvaluation
 * @property {'not_found'|'valid'|'invalid_stored_state'} status
 * @property {string|null} ventureId
 * @property {string|null} ventureRole
 * @property {string[]} errors
 * @property {object|null} snapshot The trusted, re-derived Goal Engine snapshot — present only when status === 'valid'. Never the raw row.
 * @property {object|null} entityBundle The trusted, re-derived Founder Execution Entities bundle — present only when status === 'valid'. Never the raw row.
 */

/**
 * @param {{venture_id: string, venture_role: string, state: unknown}|null} row A raw founder_venture_state row, or null if none exists.
 * @param {string} evaluationTime ISO timestamp for freshness/staleness.
 * @returns {FounderVentureRowEvaluation}
 */
export function evaluateFounderVentureRow(row, evaluationTime) {
  if (!row) {
    return {
      status: 'not_found', ventureId: null, ventureRole: null, errors: [], snapshot: null, entityBundle: null,
    };
  }
  const ventureId = typeof row.venture_id === 'string' ? row.venture_id : null;
  const ventureRole = typeof row.venture_role === 'string' ? row.venture_role : null;
  if (!ventureId || !ventureRole) {
    return {
      status: 'invalid_stored_state', ventureId, ventureRole, errors: ['row is missing venture_id/venture_role'], snapshot: null, entityBundle: null,
    };
  }
  const structuralCheck = validateMaterialisedVentureState(row.state, ventureId, ventureRole);
  if (!structuralCheck.valid) {
    return {
      status: 'invalid_stored_state', ventureId, ventureRole, errors: structuralCheck.errors, snapshot: null, entityBundle: null,
    };
  }

  let snapshot;
  try {
    snapshot = buildFounderGoalEngineSnapshot(row.state, evaluationTime);
  } catch (error) {
    return {
      status: 'invalid_stored_state', ventureId, ventureRole, errors: [`snapshot rebuild failed: ${error.message}`], snapshot: null, entityBundle: null,
    };
  }
  const snapshotCheck = validateFounderGoalEngineSnapshot(snapshot);
  if (!snapshotCheck.valid) {
    return {
      status: 'invalid_stored_state', ventureId, ventureRole, errors: snapshotCheck.errors, snapshot: null, entityBundle: null,
    };
  }

  let entityBundle;
  try {
    entityBundle = buildFounderExecutionEntities(row.state, evaluationTime);
  } catch (error) {
    return {
      status: 'invalid_stored_state', ventureId, ventureRole, errors: [`entity bundle rebuild failed: ${error.message}`], snapshot: null, entityBundle: null,
    };
  }
  const entityCheck = validateFounderExecutionEntities(entityBundle, ventureId, ventureRole, row.state.stateVersion);
  if (!entityCheck.valid) {
    return {
      status: 'invalid_stored_state', ventureId, ventureRole, errors: entityCheck.errors, snapshot: null, entityBundle: null,
    };
  }

  return {
    status: 'valid', ventureId, ventureRole, errors: [], snapshot, entityBundle,
  };
}
