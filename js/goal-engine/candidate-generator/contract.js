/**
 * Candidate Generation contract: shared identifiers, generation config, the
 * provider shape, and defense-in-depth limits. Identity binding lives in
 * `envelope.js`; this module never accepts a caller-authored goalId,
 * goalRole, or workingLevel.
 */

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

export const CANDIDATE_GENERATION_CONTRACT_VERSION = 1;
// v2: provider responses must also carry instructionsHash, correlating the
// response to the exact instruction batch generateMissionCandidates
// compiled from the planned candidate briefs (see PROVIDER_RESPONSE_FIELDS).
export const CANDIDATE_GENERATION_RESPONSE_CONTRACT_VERSION = 2;

// Defense-in-depth limits, independent of what a single request asked for.
export const MAX_CANDIDATES_HARD_LIMIT = 20;
export const MAX_RESPONSE_BYTES = 262144; // 256 KiB

export const GENERATION_CONFIG_FIELDS = Object.freeze([
  'requestId',
  'candidateCount',
  'generatedAt',
]);

export const PROVIDER_RESPONSE_FIELDS = Object.freeze([
  'contractVersion',
  'requestId',
  'contextId',
  'goalId',
  'requestHash',
  'instructionsHash',
  'candidates',
]);

export class CandidateGenerationValidationError extends Error {
  constructor(errors) {
    super(`Invalid candidate-generation input: ${errors.join('; ')}`);
    this.name = 'CandidateGenerationValidationError';
    this.errors = Object.freeze([...errors]);
  }
}

/**
 * Raised for caller misuse (mismatched domain pack, malformed config) rather
 * than untrusted provider output. Never raised by provider-authored content.
 */
export class CandidateGenerationConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CandidateGenerationConfigError';
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function exactFields(value, required, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be a plain object`);
    return false;
  }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) errors.push(`missing required field: ${path}.${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!required.includes(field)) errors.push(`unknown ${path} field: ${field}`);
  }
  return true;
}

export function validateIdentifier(value, path, errors) {
  if (!isNonEmptyString(value) || !IDENTIFIER_PATTERN.test(value)) {
    errors.push(`${path} must be a snake_case identifier`);
  }
}

/**
 * @param {unknown} config
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateGenerationConfig(config) {
  const errors = [];
  if (!exactFields(config, GENERATION_CONFIG_FIELDS, 'generationConfig', errors)) {
    return { valid: false, errors };
  }
  validateIdentifier(config.requestId, 'generationConfig.requestId', errors);
  if (!Number.isInteger(config.candidateCount) || config.candidateCount < 1 || config.candidateCount > 5) {
    errors.push('generationConfig.candidateCount must be a whole number from 1 to 5');
  }
  if (!isNonEmptyString(config.generatedAt) || !Number.isFinite(Date.parse(config.generatedAt))) {
    errors.push('generationConfig.generatedAt must be a valid timestamp');
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidGenerationConfig(config) {
  const result = validateGenerationConfig(config);
  if (!result.valid) throw new CandidateGenerationValidationError(result.errors);
}

/**
 * A provider is any injected object exposing `generate(request)`, returning
 * the raw structured output synchronously or as a Promise. The real
 * implementation (a live model call) is never imported here; this module
 * only defines and validates the shape of what it accepts back.
 *
 * @typedef {object} CandidateGenerationProvider
 * @property {string} name Stable provider identifier for generation metadata.
 * @property {(request: object) => unknown | Promise<unknown>} generate
 */

export function isValidProvider(provider) {
  return isPlainObject(provider)
    && isNonEmptyString(provider.name)
    && typeof provider.generate === 'function';
}
