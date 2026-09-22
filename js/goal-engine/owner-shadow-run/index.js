export { classifyDomainId, classifyLegacyDomain, LEGACY_TO_CANONICAL_DOMAIN } from './domain-classifier.js';
export {
  buildRealSourceRecords,
  shadowGoalId,
  STRUCTURALLY_UNAVAILABLE_SOURCE_TYPES,
} from './real-data-adapter.js';
export { runOwnerShadowGoalEngine } from './orchestrator.js';
export { evaluateFounderVentureRow } from './founder-venture-probe.js';
export { buildFounderVentureProgrammeSourceRecord } from './founder-venture-bridge.js';
export { runFounderBottleneckAndTodaysMove } from './founder-bottleneck-and-move.js';
export { buildFounderBottleneckDiagnosticContext } from './founder-bottleneck-diagnostic-context.js';
