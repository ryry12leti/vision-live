/**
 * Binds candidate-generation identity to the real assembler result.
 *
 * Checkpoint 1 accepted a caller-authored `{ goalId, goalRole, workingLevel }`
 * alongside a trusted context, which let any caller pair the wrong identity
 * with the wrong context. This module removes that gap: the only way to
 * obtain a `GenerationEnvelope` is `createGenerationEnvelope(assemblerResult)`,
 * which derives goalId, goalRole, and workingLevel exclusively from the real
 * `assembleTrustedContext()` output — never from a separate caller-supplied
 * argument — and seals the result with a SHA-256 integrity hash so that any
 * later field swap (an envelope's goalId reassigned to a different goal, a
 * stale trustedContext paired with a new goalId, and so on) is detectable
 * before generation proceeds.
 *
 * Honest limit: this hash is tamper-EVIDENT, not tamper-PROOF. It has no
 * secret key, so it only catches accidental or structural mismatch (mutating
 * a field after creation, mixing fields from two different envelopes, reusing
 * a stale envelope) — not a fully adversarial caller who fabricates a
 * self-consistent envelope from scratch. Real non-repudiation requires a
 * server-side signing key from the future authenticated database adapter,
 * which does not exist in this isolated checkpoint.
 *
 * Hashing uses the standard Web Crypto SubtleCrypto API (see canonical.js),
 * not `node:crypto`, so this module is portable to a future Deno/Supabase
 * Edge runtime without contract changes. That makes envelope creation and
 * verification asynchronous.
 */

import { validateTrustedEvaluationContext } from '../mission-evaluator/candidate-contract.js';
import { sha256Hex } from './canonical.js';

const GOAL_ROLES = new Set(['primary', 'secondary']);
const ENVELOPE_READY_STATES = new Set(['ready', 'recovery_required']);

export const GENERATION_ENVELOPE_CONTRACT_VERSION = 1;

export const GENERATION_ENVELOPE_FIELDS = Object.freeze([
  'contractVersion',
  'goalId',
  'goalRole',
  'workingLevel',
  'contextId',
  'trustedContext',
  'integrityHash',
]);

export class GenerationEnvelopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GenerationEnvelopeError';
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function computeIntegrityHash({ contractVersion, goalId, goalRole, workingLevel, contextId, trustedContext }) {
  return sha256Hex({ contractVersion, goalId, goalRole, workingLevel, contextId, trustedContext });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

/**
 * The only supported way to obtain a `GenerationEnvelope`. Derives identity
 * exclusively from a real, verified `assembleTrustedContext()` result.
 *
 * @param {object} assemblerResult The exact return value of assembleTrustedContext().
 * @returns {Promise<Readonly<object>>} A deep-frozen, hash-sealed GenerationEnvelope.
 * @throws {GenerationEnvelopeError} If the assembler result is not envelope-ready.
 */
export async function createGenerationEnvelope(assemblerResult) {
  if (!isPlainObject(assemblerResult)) {
    throw new GenerationEnvelopeError('assemblerResult must be a plain object');
  }
  if (!ENVELOPE_READY_STATES.has(assemblerResult.assemblyState)) {
    throw new GenerationEnvelopeError(
      `assemblerResult.assemblyState must be ready or recovery_required, received ${assemblerResult.assemblyState}`,
    );
  }
  const trustedContext = assemblerResult.trustedEvaluationContext;
  const trusted = validateTrustedEvaluationContext(trustedContext);
  if (!trusted.valid) {
    throw new GenerationEnvelopeError(`assemblerResult.trustedEvaluationContext is invalid: ${trusted.errors.join('; ')}`);
  }

  if (!Array.isArray(assemblerResult.sourceRecordsUsed) || assemblerResult.sourceRecordsUsed.length === 0) {
    throw new GenerationEnvelopeError('assemblerResult.sourceRecordsUsed must be a non-empty array to derive goalId');
  }
  const usedGoalIds = new Set(assemblerResult.sourceRecordsUsed.map((record) => record?.goalId));
  if (usedGoalIds.size !== 1 || !isNonEmptyString([...usedGoalIds][0])) {
    throw new GenerationEnvelopeError('assemblerResult.sourceRecordsUsed must share exactly one non-empty goalId');
  }
  const goalId = [...usedGoalIds][0];

  const ownershipDecision = Array.isArray(assemblerResult.personalisationDecisions)
    ? assemblerResult.personalisationDecisions.find((decision) => decision?.type === 'goal_ownership')
    : null;
  if (!ownershipDecision || !GOAL_ROLES.has(ownershipDecision.decision)) {
    throw new GenerationEnvelopeError('assemblerResult.personalisationDecisions must include a valid goal_ownership decision');
  }
  const goalRole = ownershipDecision.decision;

  const workingLevel = assemblerResult.derivedCapability?.workingLevel;
  if (!Number.isFinite(workingLevel) || workingLevel < 1 || workingLevel > 100) {
    throw new GenerationEnvelopeError('assemblerResult.derivedCapability.workingLevel must be a number from 1 to 100');
  }

  const contextId = trustedContext.contextId;

  const identity = {
    contractVersion: GENERATION_ENVELOPE_CONTRACT_VERSION,
    goalId,
    goalRole,
    workingLevel,
    contextId,
    trustedContext,
  };
  const envelope = { ...identity, integrityHash: await computeIntegrityHash(identity) };
  return deepFreeze(envelope);
}

/**
 * Re-verifies an envelope's structural shape and integrity hash. Detects
 * field-level tampering after creation (see module-level limits above).
 *
 * @param {unknown} envelope
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
export async function verifyGenerationEnvelope(envelope) {
  const errors = [];
  if (!isPlainObject(envelope)) {
    return { valid: false, errors: ['generationEnvelope must be a plain object'] };
  }
  for (const field of GENERATION_ENVELOPE_FIELDS) {
    if (!Object.hasOwn(envelope, field)) errors.push(`missing required field: generationEnvelope.${field}`);
  }
  for (const field of Object.keys(envelope)) {
    if (!GENERATION_ENVELOPE_FIELDS.includes(field)) errors.push(`unknown generationEnvelope field: ${field}`);
  }
  if (errors.length > 0) return { valid: false, errors };

  if (envelope.contractVersion !== GENERATION_ENVELOPE_CONTRACT_VERSION) {
    errors.push(`generationEnvelope.contractVersion must be ${GENERATION_ENVELOPE_CONTRACT_VERSION}`);
  }
  if (!isNonEmptyString(envelope.goalId)) errors.push('generationEnvelope.goalId must be a non-empty string');
  if (!GOAL_ROLES.has(envelope.goalRole)) errors.push('generationEnvelope.goalRole must be primary or secondary');
  if (!Number.isFinite(envelope.workingLevel) || envelope.workingLevel < 1 || envelope.workingLevel > 100) {
    errors.push('generationEnvelope.workingLevel must be a number from 1 to 100');
  }
  if (!isNonEmptyString(envelope.contextId)) errors.push('generationEnvelope.contextId must be a non-empty string');

  const trusted = validateTrustedEvaluationContext(envelope.trustedContext);
  if (!trusted.valid) errors.push(...trusted.errors.map((error) => `trustedContext: ${error}`));
  if (envelope.trustedContext && envelope.trustedContext.contextId !== envelope.contextId) {
    errors.push('generationEnvelope.contextId must match generationEnvelope.trustedContext.contextId');
  }

  if (errors.length === 0) {
    const expectedHash = await computeIntegrityHash(envelope);
    if (envelope.integrityHash !== expectedHash) {
      errors.push('generationEnvelope.integrityHash does not match its identity and trustedContext fields (tampered or corrupted envelope)');
    }
  }

  return { valid: errors.length === 0, errors };
}

export async function assertValidGenerationEnvelope(envelope) {
  const result = await verifyGenerationEnvelope(envelope);
  if (!result.valid) throw new GenerationEnvelopeError(result.errors.join('; '));
}
