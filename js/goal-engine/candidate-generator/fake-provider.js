/**
 * Deterministic injected provider tooling for tests and local development.
 * Nothing here performs network I/O or calls a live model; a real provider
 * implementation lives entirely outside this module and is injected by the
 * caller through the same `{ name, generate(request) }` shape.
 */

import { CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION } from './contract.js';
import { planCandidateBriefs } from './domain-intelligence/planner.js';
import { compileProviderInstructions } from './domain-intelligence/instruction-compiler.js';
import { compileCandidateProposal } from './domain-intelligence/qa-deterministic-provider.js';

/**
 * Wrap a synchronous or asynchronous handler as a candidate-generation
 * provider. The handler receives the exact frozen request (including
 * `request.providerInstructions`, attached by generateMissionCandidates)
 * and returns raw provider output (or throws, to simulate a provider
 * failure).
 *
 * @param {(request: object) => unknown | Promise<unknown>} handler
 * @param {{name?: string}} [options]
 */
export function createFakeProvider(handler, { name = 'fake-provider' } = {}) {
  return {
    name,
    async generate(request) {
      return handler(request);
    },
  };
}

/**
 * A provider that returns pre-scripted responses in call order. Throws if
 * called more times than responses were supplied, so tests fail loudly
 * instead of silently reusing a stale response.
 *
 * @param {unknown[]} responses
 * @param {{name?: string}} [options]
 */
export function createQueuedFakeProvider(responses, { name = 'queued-fake-provider' } = {}) {
  let index = 0;
  return createFakeProvider((request) => {
    if (index >= responses.length) {
      throw new Error('createQueuedFakeProvider called more times than responses were queued');
    }
    const response = responses[index];
    index += 1;
    return typeof response === 'function' ? response(request) : response;
  }, { name });
}

/**
 * Wrap a set of candidate proposals in the exact correlation envelope a
 * compliant provider must return: contractVersion, requestId, contextId,
 * goalId, requestHash, instructionsHash, and candidates, all matching the
 * exact request and instruction batch they answer. `instructionsHash` is
 * read from `request.providerInstructions` when the caller already has it
 * (the normal case, inside a real generateMissionCandidates call); a bare
 * `request` without `providerInstructions` (e.g. one built directly via
 * buildGenerationRequest for a standalone test) gets a freshly derived one.
 *
 * @param {object} request
 * @param {object[]} candidates
 * @returns {Promise<object>}
 */
export async function buildValidProviderResponse(request, candidates) {
  const instructions = request.providerInstructions
    || await compileProviderInstructions(planCandidateBriefs(request), request);
  return {
    contractVersion: CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION,
    requestId: request.requestId,
    contextId: request.contextId,
    goalId: request.goalId,
    requestHash: request.requestHash,
    instructionsHash: instructions.instructionsHash,
    candidates,
  };
}

/**
 * Build one structurally and semantically valid candidate proposal for a
 * generation request, using the request's own first planned candidate
 * brief (the same deterministic domain-intelligence planning
 * generateMissionCandidates itself uses — see
 * domain-intelligence/planner.js and domain-intelligence/
 * qa-deterministic-provider.js). Intended for test fixtures: a real
 * provider elaborates its own wording within a brief's fixed route, but
 * every structural field this helper fills in is exactly what a compliant
 * provider must supply for that same route.
 *
 * @param {object} request Frozen generation request from buildGenerationRequest.
 * @param {object} [overrides] Deep-shallow overrides merged onto the built proposal.
 */
export function buildValidCandidateProposal(request, overrides = {}) {
  const [brief] = planCandidateBriefs(request);
  if (!brief) {
    throw new Error('buildValidCandidateProposal requires a request with at least one executable route');
  }
  const base = compileCandidateProposal(brief, request);

  return {
    ...base,
    ...overrides,
    method: { ...base.method, ...(overrides.method || {}) },
    intendedOutcome: { ...base.intendedOutcome, ...(overrides.intendedOutcome || {}) },
    proofPlan: { ...base.proofPlan, ...(overrides.proofPlan || {}) },
    missionStructure: { ...base.missionStructure, ...(overrides.missionStructure || {}) },
    domainDetails: { ...base.domainDetails, ...(overrides.domainDetails || {}) },
  };
}
