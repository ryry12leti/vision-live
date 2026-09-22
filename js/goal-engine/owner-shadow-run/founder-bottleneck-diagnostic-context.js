/**
 * Separate read-only diagnostic path for Founder bottleneck intelligence.
 * It never creates a programme source record and therefore cannot weaken or
 * bypass the generic Founder bridge's sparse-context protection.
 */
import { validateFounderGoalEngineSnapshot, validateFounderExecutionEntities } from '../founder-venture-state/index.js';
import { buildFounderExecutionContext, validateFounderExecutionContext } from '../founder-execution-context/index.js';

/**
 * @param {{evaluation: object, ventureLifecycleStatus: string|null, availableResourceIds?: string[]}} params
 */
export function buildFounderBottleneckDiagnosticContext({ evaluation, ventureLifecycleStatus, availableResourceIds = [] }) {
  if (evaluation?.status !== 'valid') return { available: false, reason: 'invalid_stored_state', snapshot: null, entityBundle: null, executionContext: null };
  if (ventureLifecycleStatus !== 'active') return { available: false, reason: 'inactive_primary_venture', snapshot: null, entityBundle: null, executionContext: null };
  const { snapshot, entityBundle } = evaluation;
  if (!validateFounderGoalEngineSnapshot(snapshot).valid || snapshot.ventureRole !== 'primary') {
    return { available: false, reason: 'invalid_founder_snapshot', snapshot: null, entityBundle: null, executionContext: null };
  }
  if (!validateFounderExecutionEntities(entityBundle, snapshot.ventureId, 'primary', snapshot.stateVersion).valid) {
    return { available: false, reason: 'invalid_execution_entities', snapshot: null, entityBundle: null, executionContext: null };
  }
  const executionContext = buildFounderExecutionContext({ snapshot, entityBundle, availableResourceIds });
  if (!validateFounderExecutionContext(executionContext, {
    ventureId: snapshot.ventureId, ventureRole: 'primary', stateVersion: snapshot.stateVersion,
  }).valid) return { available: false, reason: 'invalid_execution_context', snapshot: null, entityBundle: null, executionContext: null };
  return { available: true, reason: null, snapshot, entityBundle, executionContext };
}
