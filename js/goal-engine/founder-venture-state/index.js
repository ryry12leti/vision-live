export {
  BUSINESS_MODEL_FAMILIES,
  DEFAULT_FOUNDER_MODE,
  FACT_SOURCE_STATUSES,
  FOUNDER_MODES,
  FOUNDER_STAGES,
  FOUNDER_VENTURE_STATE_CONTRACT_VERSION,
  FounderVentureStateValidationError,
  MAX_VENTURES_PER_ROLE,
  NEXT_ACTIONS,
  PUSH_LEVELS,
  REQUIRED_USABLE_FIELDS,
  RESERVED_UNIMPLEMENTED_STAGE_SOURCES,
  STAGE_SOURCES,
  STRUCTURED_FIELD_NAMES,
  TRUSTED_FIELD_NAMES,
  VENTURE_FACT_FIELDS,
  VENTURE_ROLES,
  VENTURE_SOURCE_PROVENANCE_MATRIX,
  VENTURE_SOURCE_TYPES,
  WHAT_FIELDS_ANY_OF,
  addVentureToPortfolio,
  assertValidAssemblyInput,
  isBusinessModelFamily,
  isFounderStage,
  validateAssemblyInput,
  validatePreviousVentureState,
  validateVenturePortfolio,
  validateVentureSourceRecord,
} from './contract.js';

export { assembleFounderVentureState } from './assembler.js';

export { createInMemoryFounderVentureStatePersistence } from './persistence.js';

export { createFounderVentureStateService } from './service.js';

export {
  INTEGRATION_TYPES,
  buildVerifiedVentureSourceRecord,
  buildVerifiedVentureSourceRecordBatch,
} from './integration-adapter.js';

export {
  FOUNDER_VENTURE_STATE_REQUEST_FIELD,
  attachFounderVentureStateToRequiredAttributes,
  readFounderVentureStateFromRequest,
} from './request-integration.js';

export {
  FOUNDER_VENTURE_SNAPSHOT_REQUEST_FIELD,
  attachFounderVentureSnapshotToRequiredAttributes,
  readFounderVentureSnapshotFromRequest,
} from './request-integration-v2.js';

// ── V2: fact ledger, sections, snapshot, clarification, collectors, service ──
export {
  FOUNDER_VENTURE_FACT_LEDGER_VERSION,
  FACT_SOURCE_TYPES,
  VERIFICATION_STATES,
  INCOMING_VERIFICATION_STATES,
  ALL_FACT_KEYS,
  FACT_TYPES,
  factTypeFor,
  authorityRank,
  defaultVerificationStatusFor,
  validateFactKeyValue,
  validateVentureFact,
  validateVentureFacts,
  rebuildStateFromFacts,
  buildFact,
  isVentureRole,
} from './fact-ledger.js';

export {
  V2_LIST_FACT_FIELDS,
  V2_SECTION_FACT_FIELDS,
  V2_FIELD_NAMES,
  SECTION_FIELD_KEYS,
  INTEGRATION_PROVIDERS,
  INTEGRATION_SECTION_FIELDS,
  LEGACY_REVENUE_STATE_FIELD,
  ACTIVE_OUTCOME_EXECUTION_STATES,
  ACTIVE_OUTCOME_COMPLETION_STATES,
  validateV2FactValue,
  validateLegacyRevenueStateValue,
  tryNormalizeLegacyRevenueStateToOfferPricing,
} from './sections.js';

export { MAX_CLARIFICATION_QUESTIONS, computeClarificationQuestions } from './clarification.js';

export {
  FOUNDER_VENTURE_SNAPSHOT_VERSION,
  buildMaterialisedVentureState,
  buildFounderGoalEngineSnapshot,
  validateFounderGoalEngineSnapshot,
  validateMaterialisedVentureState,
} from './snapshot.js';

export { createInMemoryFounderVentureFactsPersistence } from './persistence-v2.js';
export { createFounderVentureStateServiceV2 } from './service-v2.js';

export { mapOnboardingToFacts } from './collectors/onboarding.js';
export { extractCandidateFactsFromChatMessage } from './collectors/chat.js';
export {
  buildManualUpdateFact, buildConfirmFactRequest, buildDisputeFactRequest, buildLifecycleTransitionRequest,
} from './collectors/manual.js';
export { mapVerifiedProofToFacts } from './collectors/proof.js';
export {
  buildGithubIntegrationFacts,
  buildSupabaseIntegrationFacts,
  buildVercelIntegrationFacts,
  buildWebsiteIntegrationFacts,
  buildFileUploadIntegrationFacts,
} from './collectors/integrations.js';

// ── Founder Execution Entities ──────────────────────────────────────────
export {
  ENTITY_ID_PATTERN,
  ENTITY_TYPES,
  isEntityFactKey,
  parseEntityFactKey,
  buildEntityFactKey,
  validateEntityFactValue,
  containsPiiValue,
} from './entities.js';

export {
  FOUNDER_EXECUTION_ENTITIES_CONTRACT_VERSION,
  isUsableEntity,
  buildEntityCollections,
  buildFounderExecutionEntities,
  validateFounderExecutionEntities,
} from './entity-snapshot.js';

export {
  FOUNDER_EXECUTION_ENTITIES_REQUEST_FIELD,
  attachFounderExecutionEntitiesToRequiredAttributes,
  readFounderExecutionEntitiesFromRequest,
} from './entity-request-integration.js';

export {
  buildCustomerEntityFact,
  buildProcessEntityFact,
  buildStrategyDecisionEntityFact,
  extractCandidateEntityFactsFromChatMessage,
} from './collectors/entities.js';

export { evaluateFounderVentureRow } from './venture-row-probe.js';
