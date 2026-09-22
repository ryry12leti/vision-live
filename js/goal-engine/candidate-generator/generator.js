/**
 * Orchestrates candidate generation: verify the assembler-bound envelope,
 * build the strict request, plan candidate briefs and compile the
 * provider-neutral instructions for them (once, here — never left to the
 * provider to derive or self-verify), call the injected provider with those
 * instructions attached, and validate its output — including that it
 * answers this exact instruction batch — before anything reaches the
 * evaluator. Never evaluates, scores, or selects a candidate, and never
 * calls a live model API itself.
 */

import {
  CandidateGenerationConfigError,
  assertValidGenerationConfig,
  isValidProvider,
  validateGenerationConfig,
} from './contract.js';
import { verifyGenerationEnvelope } from './envelope.js';
import { buildGenerationRequest } from './request-builder.js';
import { validateProviderResponse } from './response-validator.js';
import { NoExecutableRouteError, planCandidateBriefs } from './domain-intelligence/planner.js';
import { compileProviderInstructions } from './domain-intelligence/instruction-compiler.js';

export const GENERATION_STATES = Object.freeze([
  'generated',
  'no_valid_candidates',
  'generation_blocked',
  'no_executable_route',
  'provider_output_malformed',
  'provider_error',
  'invalid_envelope',
  'invalid_config',
  'invalid_provider',
  'invalid_domain_pack',
]);

function frozenResult(state, overrides = {}) {
  return Object.freeze({
    state,
    request: null,
    validCandidates: Object.freeze([]),
    rejectedProposals: Object.freeze([]),
    generationMetadata: Object.freeze({}),
    errors: Object.freeze([]),
    ...overrides,
  });
}

/**
 * @param {object} params
 * @param {object} params.envelope Verified GenerationEnvelope (see envelope.js).
 * @param {object} params.domainPack Canonical domain pack matching the envelope's domain.
 * @param {object} params.config GenerationConfig (requestId, candidateCount, generatedAt).
 * @param {import('./contract.js').CandidateGenerationProvider} params.provider Injected provider.
 * @returns {Promise<Readonly<object>>}
 */
export async function generateMissionCandidates({ envelope, domainPack, config, provider }) {
  const envelopeResult = await verifyGenerationEnvelope(envelope);
  if (!envelopeResult.valid) {
    return frozenResult('invalid_envelope', { errors: Object.freeze(envelopeResult.errors) });
  }

  const configResult = validateGenerationConfig(config);
  if (!configResult.valid) {
    return frozenResult('invalid_config', { errors: Object.freeze(configResult.errors) });
  }
  assertValidGenerationConfig(config);

  if (!isValidProvider(provider)) {
    return frozenResult('invalid_provider', {
      errors: Object.freeze(['provider must be a plain object exposing a string name and a generate() function']),
    });
  }

  let request;
  try {
    request = await buildGenerationRequest(envelope, domainPack, config);
  } catch (error) {
    if (error instanceof CandidateGenerationConfigError) {
      return frozenResult('invalid_domain_pack', { errors: Object.freeze([error.message]) });
    }
    throw error;
  }

  const baseMetadata = {
    requestId: request.requestId,
    contextId: request.contextId,
    requestHash: request.requestHash,
    goalId: envelope.goalId,
    goalRole: envelope.goalRole,
    domainId: request.domainId,
    providerName: provider.name,
    generatedAt: config.generatedAt,
    candidateCountRequested: config.candidateCount,
  };

  if (request.blocked) {
    return frozenResult('generation_blocked', {
      request,
      generationMetadata: Object.freeze({
        ...baseMetadata,
        candidateCountReturned: 0,
        candidateCountRejected: 0,
        blockedReasons: Object.freeze([...request.blockedReasons]),
      }),
      errors: Object.freeze([...request.blockedReasons]),
    });
  }

  // Briefs are planned and instructions compiled here, in the trusted
  // orchestrator, exactly once — never inside the provider. A provider that
  // fabricates its own "briefs" or skips this step entirely gains nothing:
  // response-validator.js below verifies every candidate against this exact
  // batch regardless of what the provider claims to have done.
  let instructions;
  try {
    const briefs = planCandidateBriefs(request);
    instructions = await compileProviderInstructions(briefs, request);
  } catch (error) {
    if (error instanceof NoExecutableRouteError) {
      return frozenResult('no_executable_route', {
        request,
        generationMetadata: Object.freeze({ ...baseMetadata, candidateCountReturned: 0, candidateCountRejected: 0 }),
        errors: Object.freeze([error.message]),
      });
    }
    if (error instanceof CandidateGenerationConfigError) {
      return frozenResult('invalid_domain_pack', { errors: Object.freeze([error.message]) });
    }
    throw error;
  }

  // instructionsHash is included in what the provider receives — never
  // computed or verified only after the fact from data the provider itself
  // supplied.
  const requestForProvider = Object.freeze({ ...request, providerInstructions: instructions });

  let rawOutput;
  try {
    rawOutput = await provider.generate(requestForProvider);
  } catch (error) {
    return frozenResult('provider_error', {
      request,
      generationMetadata: Object.freeze({ ...baseMetadata, candidateCountReturned: 0, candidateCountRejected: 0 }),
      errors: Object.freeze([`Provider threw during generation: ${error?.message || String(error)}`]),
    });
  }

  const { validCandidates, rejected, malformed, malformedReason } = validateProviderResponse(
    rawOutput,
    request,
    domainPack,
    instructions,
  );

  if (malformed) {
    return frozenResult('provider_output_malformed', {
      request,
      generationMetadata: Object.freeze({ ...baseMetadata, candidateCountReturned: 0, candidateCountRejected: 0 }),
      errors: Object.freeze([malformedReason]),
    });
  }

  const generationMetadata = Object.freeze({
    ...baseMetadata,
    candidateCountReturned: validCandidates.length,
    candidateCountRejected: rejected.length,
  });

  if (validCandidates.length === 0) {
    return frozenResult('no_valid_candidates', {
      request,
      rejectedProposals: Object.freeze(rejected),
      generationMetadata,
      errors: Object.freeze(['No provider-returned candidate passed structural or semantic validation']),
    });
  }

  return frozenResult('generated', {
    request,
    validCandidates: Object.freeze(validCandidates),
    rejectedProposals: Object.freeze(rejected),
    generationMetadata,
  });
}
