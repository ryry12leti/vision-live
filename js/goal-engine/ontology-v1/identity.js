import { assertNoStrategySmuggling } from './contracts.js';

export const ONTOLOGY_ENTITY_TYPES = Object.freeze([
  'VENTURE',
  'ORGANIZATION',
  'PERSON',
  'CUSTOMER_ACCOUNT',
  'CUSTOMER_SEGMENT',
  'OFFER',
  'PRODUCT',
  'SERVICE',
  'OPERATING_PROCESS',
  'SUPPLIER',
  'CHANNEL',
  'REPOSITORY',
  'SOCIAL_ACCOUNT',
]);

export const ONTOLOGY_ENTITY_STATUSES = Object.freeze(['ACTIVE', 'RETIRED']);
export const ONTOLOGY_ALIAS_STATUSES = Object.freeze([
  'CANDIDATE', 'CONFIRMED', 'DISPUTED', 'REVOKED', 'SUPERSEDED',
]);
export const ONTOLOGY_ALIAS_VERIFICATION_STATUSES = Object.freeze([
  'UNVERIFIED', 'EVIDENCE_BACKED', 'OWNER_CONFIRMED', 'SYSTEM_VERIFIED',
]);
export const ONTOLOGY_OWNER_SYSTEMS = Object.freeze([
  'FOUNDER_STATE', 'FOUNDER_WORK', 'ACTIVE_OUTCOME', 'OPPORTUNITY_INTELLIGENCE',
]);

const ENTITY_ID_RE = /^oe:v1:[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HMAC_RE = /^[0-9a-f]{64}$/;
const OPAQUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/;
const NATURAL_IDENTIFIER_RE = /(?:@|\s|\+?\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d|(?:^|[/:._-])[a-z0-9-]+\.[a-z]{2,}(?:$|[/:._-])|(?:bearer|password|secret|token|api[_-]?key|private[_-]?message))/i;

function fail(message) {
  throw new TypeError(message);
}

function exactObject(value, required, optional, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label}.${key} is not allowed`);
}

function nonEmpty(value, label, max = 255) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value !== value.trim()) {
    fail(`${label} must be a bounded non-empty string`);
  }
}

export function validateOntologyEntityId(value) {
  if (typeof value !== 'string' || !ENTITY_ID_RE.test(value)) fail('entityId must be oe:v1:<lowercase-uuidv7>');
  return value;
}

export function validateOntologyEntityType(value) {
  if (!ONTOLOGY_ENTITY_TYPES.includes(value)) fail('entityType is not in the closed Ontology V1 registry');
  return value;
}

function random16(randomBytes) {
  if (randomBytes !== undefined) {
    if (!(randomBytes instanceof Uint8Array) || randomBytes.length !== 16) fail('randomBytes must contain exactly 16 bytes');
    return Uint8Array.from(randomBytes);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function generateOntologyEntityId({ now = Date.now(), randomBytes } = {}) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) fail('now is outside the UUIDv7 timestamp range');
  const bytes = random16(randomBytes);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return validateOntologyEntityId(`oe:v1:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
}

export function validateAliasLocalId({ localId, localIdKind, keyVersion = null }) {
  nonEmpty(localId, 'alias.localId');
  if (localIdKind === 'HMAC_SHA256') {
    if (!HMAC_RE.test(localId)) fail('HMAC aliases must contain only a lowercase SHA-256 digest');
    if (!Number.isInteger(keyVersion) || keyVersion < 1) fail('HMAC aliases require a positive keyVersion');
  } else if (localIdKind === 'OPAQUE') {
    if (!OPAQUE_RE.test(localId) || NATURAL_IDENTIFIER_RE.test(localId)) fail('raw or malformed natural identifiers are forbidden');
    if (!UUID_RE.test(localId) && !/[0-9]/.test(localId)) fail('opaque IDs must be UUIDs or contain provider-assigned digits');
    if (keyVersion !== null) fail('opaque aliases cannot carry a keyVersion');
  } else {
    fail('localIdKind must be OPAQUE or HMAC_SHA256 for cross-system aliases');
  }
  assertNoStrategySmuggling(localId, 'alias.localId');
  return localId;
}

export function validateAliasProposal(input) {
  exactObject(input, [
    'ventureId', 'entityId', 'expectedEntityVersion', 'aliasId', 'system', 'namespace',
    'localId', 'localIdKind', 'keyVersion', 'privacyClass', 'nativeVersion',
    'confidence', 'evidenceRefs', 'requestId',
  ], [], 'AliasProposalV1');
  nonEmpty(input.ventureId, 'AliasProposalV1.ventureId');
  validateOntologyEntityId(input.entityId);
  if (!Number.isInteger(input.expectedEntityVersion) || input.expectedEntityVersion < 1) fail('expectedEntityVersion is invalid');
  if (typeof input.aliasId !== 'string' || !UUID_RE.test(input.aliasId)) fail('aliasId must be a lowercase UUID');
  if (!ONTOLOGY_OWNER_SYSTEMS.includes(input.system)) fail('system is not a canonical V1 owner system');
  if (typeof input.namespace !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(input.namespace)) fail('namespace is invalid');
  validateAliasLocalId(input);
  if (!['VENTURE_PRIVATE', 'PII_RESTRICTED'].includes(input.privacyClass)) fail('privacyClass is invalid');
  if (input.localIdKind === 'HMAC_SHA256' && input.privacyClass !== 'PII_RESTRICTED') fail('HMAC aliases must retain PII_RESTRICTED classification');
  if (input.nativeVersion !== null) {
    nonEmpty(input.nativeVersion, 'AliasProposalV1.nativeVersion', 128);
    if (!/^[A-Za-z0-9._:-]+$/.test(input.nativeVersion) || NATURAL_IDENTIFIER_RE.test(input.nativeVersion)) fail('nativeVersion must be an opaque non-PII version');
  }
  if (input.confidence !== null && (typeof input.confidence !== 'number' || input.confidence < 0 || input.confidence > 1)) fail('confidence is invalid');
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.some((ref) => typeof ref !== 'string' || !/^ev:v1:[A-Z][A-Z0-9_]*:[A-Za-z0-9._:-]{3,180}$/.test(ref))) {
    fail('evidenceRefs must contain bounded opaque evidence references');
  }
  if (typeof input.requestId !== 'string' || !UUID_RE.test(input.requestId)) fail('requestId must be a lowercase UUID');
  assertNoStrategySmuggling(input);
  return Object.freeze(structuredClone(input));
}

export function assertAliasConfirmationResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('alias confirmation returned an invalid response');
  const status = result.status;
  if (status === 'ALIAS_COLLISION') {
    const error = new Error('ALIAS_COLLISION');
    error.code = 'ALIAS_COLLISION';
    throw error;
  }
  if (!['CONFIRMED', 'IDEMPOTENT_REPLAY'].includes(status)) fail(`alias confirmation failed closed: ${String(status)}`);
  return result;
}
