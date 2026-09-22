export {
  CANDIDATE_GENERATION_CONTRACT_VERSION,
  CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION,
  MAX_CANDIDATES_HARD_LIMIT,
  MAX_RESPONSE_BYTES,
  GENERATION_CONFIG_FIELDS,
  PROVIDER_RESPONSE_FIELDS,
  CandidateGenerationValidationError,
  CandidateGenerationConfigError,
  assertValidGenerationConfig,
  validateGenerationConfig,
  isValidProvider,
} from './contract.js';

export {
  GENERATION_ENVELOPE_CONTRACT_VERSION,
  GENERATION_ENVELOPE_FIELDS,
  GenerationEnvelopeError,
  createGenerationEnvelope,
  verifyGenerationEnvelope,
  assertValidGenerationEnvelope,
} from './envelope.js';

export { stableStringify, byteLength, sha256Hex } from './canonical.js';
export { buildGenerationRequest } from './request-builder.js';
export { validateProviderResponse } from './response-validator.js';
export { GENERATION_STATES, generateMissionCandidates } from './generator.js';

// Checkpoint 2: deterministic domain intelligence. planCandidateBriefs plans
// a strategic route per candidate without ever assigning a score,
// confidence, acceptance, or authority. compileProviderInstructions is the
// provider-neutral instruction compiler: it turns one planned batch into a
// strict, injection-safe payload for a future model provider, with a
// deterministic instructionsHash correlating the payload to that exact
// batch. verifyCandidatesAnswerInstructions rejects any response whose
// candidates do not match the routes that batch actually asked for.
export {
  CANDIDATE_BRIEF_FIELDS,
  validateCandidateBrief,
  assertValidCandidateBrief,
  briefRouteSignature,
} from './domain-intelligence/contract.js';
export { NoExecutableRouteError, planCandidateBriefs } from './domain-intelligence/planner.js';
export { hasRequiredResources, trustedMethodIdFor } from './domain-intelligence/shared.js';
export {
  PROVIDER_INSTRUCTION_CONTRACT_VERSION,
  compileProviderInstructions,
  deriveExpectedProviderInstructions,
  verifyCandidatesAnswerInstructions,
} from './domain-intelligence/instruction-compiler.js';

// QA/test-only: a deterministic provider that answers its own compiled
// instructions directly, with no live model call. A real model integration
// must depend on the provider-neutral instruction compiler above, never on
// this file (see qa-deterministic-provider.js's module-level warning).
export {
  compileCandidateProposal,
  compileCandidateProposals,
  createQaDomainIntelligenceProvider,
} from './domain-intelligence/qa-deterministic-provider.js';

// Test/development tooling only. A real provider is injected by the caller
// and never imported here.
export {
  createFakeProvider,
  createQueuedFakeProvider,
  buildValidProviderResponse,
  buildValidCandidateProposal,
} from './fake-provider.js';
