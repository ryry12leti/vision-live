import { validateOntologyFusedContext } from '../ontology-v1/context-fusion/contract.js';

const REQUIRED_COMPONENTS = Object.freeze([
  'FOUNDER_STATE',
  'FOUNDER_ENTITIES_FACTS',
  'FOUNDER_WORK',
  'ACTIVE_OUTCOME',
  'ACTIVE_DEMIGOD_DECISION',
  'OUTCOME_LEARNING',
]);
const SAFE_RESOLUTION = new Set(['VERIFIED', 'UNKNOWN', 'NOT_CONSULTED']);

export class FounderOntologyContextError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'FounderOntologyContextError';
    this.code = code;
  }
}

/**
 * The Demigod consumes Ontology as context, never as a strategist. This gate
 * validates the exact frozen context and returns provenance only; it exposes
 * no candidate, score, priority, strategy, or Today’s Move field to the
 * decision algorithm.
 */
export function consumeOntologyContextForDecision(contextInput, ventureId) {
  let context;
  try { context = validateOntologyFusedContext(contextInput); }
  catch (error) {
    throw new FounderOntologyContextError('CONTEXT_FUSION_VALIDATION_FAILED', error.message);
  }
  if (context.ventureId !== ventureId) {
    throw new FounderOntologyContextError('CONTEXT_VENTURE_MISMATCH');
  }
  const byType = new Map(context.componentStatuses.map((component) => [component.componentType, component]));
  for (const componentType of REQUIRED_COMPONENTS) {
    const component = byType.get(componentType);
    if (!component) throw new FounderOntologyContextError('CONTEXT_COMPONENT_MISSING', componentType);
    if (!SAFE_RESOLUTION.has(component.sourceResolutionStatus)) {
      throw new FounderOntologyContextError(
        component.sourceResolutionStatus === 'SOURCE_VERSION_MISMATCH'
          ? 'SOURCE_VERSION_MISMATCH'
          : 'CONTEXT_HISTORY_UNAVAILABLE',
        `${componentType}:${component.sourceResolutionStatus}`,
      );
    }
    if (component.readStatus === 'PRESENT'
      && (component.sourceResolutionStatus !== 'VERIFIED' || component.historyCompleteness !== 'COMPLETE')) {
      throw new FounderOntologyContextError('CONTEXT_HISTORY_UNAVAILABLE', componentType);
    }
  }
  return Object.freeze({
    companyStateVersionId: context.companyStateVersionId,
    contextId: context.contextId,
    manifestHash: context.manifestHash,
    reliedClaimRefs: Object.freeze(context.sourceReferences
      .filter((entry) => entry.kind === 'CLAIM')
      .map((entry) => entry.ref)
      .sort()),
    reliedEvidenceRefs: Object.freeze(context.sourceReferences
      .filter((entry) => entry.kind === 'EVIDENCE')
      .map((entry) => entry.ref)
      .sort()),
  });
}
