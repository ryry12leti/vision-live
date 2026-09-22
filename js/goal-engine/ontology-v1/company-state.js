import crypto from 'node:crypto';
import { assertNoStrategySmuggling } from './contracts.js';

export const COMPANY_STATE_MANIFEST_SCHEMA_VERSION = 'company-state-manifest/v1';

export const COMPANY_STATE_COMPONENT_REGISTRY = Object.freeze([
  Object.freeze({ componentType: 'FOUNDER_STATE', ownerSystem: 'FOUNDER_STATE' }),
  Object.freeze({ componentType: 'FOUNDER_ENTITIES_FACTS', ownerSystem: 'FOUNDER_STATE' }),
  Object.freeze({ componentType: 'FOUNDER_WORK', ownerSystem: 'FOUNDER_WORK' }),
  Object.freeze({ componentType: 'ACTIVE_OUTCOME', ownerSystem: 'ACTIVE_OUTCOME' }),
  Object.freeze({ componentType: 'OPPORTUNITY_INTELLIGENCE', ownerSystem: 'OPPORTUNITY_INTELLIGENCE' }),
  Object.freeze({ componentType: 'ACTIVE_DEMIGOD_DECISION', ownerSystem: 'DEMIGOD' }),
  Object.freeze({ componentType: 'TRENDS_EXTERNAL_WORLD', ownerSystem: 'TRENDS' }),
  Object.freeze({ componentType: 'TERRA_ECONOMIC_STATE', ownerSystem: 'TERRA' }),
  Object.freeze({ componentType: 'PI_PRODUCT_STATE', ownerSystem: 'PI' }),
  Object.freeze({ componentType: 'OUTCOME_LEARNING', ownerSystem: 'OUTCOME_LEARNING' }),
]);

export const COMPANY_STATE_CONSULTATION_STATUSES = Object.freeze(['CONSULTED', 'NOT_CONSULTED']);
export const COMPANY_STATE_READ_STATUSES = Object.freeze(['PRESENT', 'UNKNOWN', 'NOT_CONSULTED', 'UNAVAILABLE', 'READ_FAILED']);
export const COMPANY_STATE_HISTORY_COMPLETENESS = Object.freeze(['COMPLETE', 'INCOMPLETE']);

const COMPONENT_FIELDS = Object.freeze([
  'componentType', 'ownerSystem', 'nativeStateId', 'nativeVersionId', 'watermark',
  'schemaVersion', 'contentHash', 'asOf', 'consultationStatus', 'readStatus',
  'historyCompleteness', 'reasonCode',
]);
const MANIFEST_FIELDS = Object.freeze([
  'companyStateVersionId', 'ventureId', 'createdAt', 'asOf',
  'manifestSchemaVersion', 'components', 'manifestHash',
]);
const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ID_RE = /^csv:v1:[0-9a-f]{64}$/;
const SAFE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/;

function fail(message) { throw new TypeError(message); }

function exactObject(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const allowed = new Set(fields);
  for (const field of fields) if (!Object.hasOwn(value, field)) fail(`${label}.${field} is required`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) fail(`${label}.${field} is not allowed`);
}

export function normalizeCompanyStateTimestamp(value, label = 'timestamp') {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${label} must be an ISO timestamp`);
  const normalized = new Date(value).toISOString();
  if (value !== normalized) fail(`${label} must be UTC ISO-8601 with millisecond precision`);
  return normalized;
}

export function normalizeCompanyStateWatermark(value) {
  if (value === null) return null;
  if (typeof value === 'string') {
    if (!SAFE_TOKEN_RE.test(value)) fail('watermark string is invalid');
    return value;
  }
  if (!Array.isArray(value) || value.length > 256 || value.some((item) => typeof item !== 'string' || !SAFE_TOKEN_RE.test(item))) {
    fail('watermark must be null, a safe token, or a bounded safe-token array');
  }
  return Object.freeze([...new Set(value)].sort());
}

// RFC 8785 JSON Canonicalization Scheme. Phase 3 deliberately accepts only
// JSON-safe integers, strings, booleans, null, arrays, and plain objects.
export function jcsCanonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail('JCS numbers must be finite safe integers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalize).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('JCS value is invalid');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcsCanonicalize(value[key])}`).join(',')}}`;
}

function nullableToken(value, label) {
  if (value !== null && (typeof value !== 'string' || !SAFE_TOKEN_RE.test(value))) fail(`${label} is invalid`);
}

export function validateCompanyStateComponent(component, expectedIndex) {
  exactObject(component, COMPONENT_FIELDS, 'CompanyStateComponentV1');
  const expected = COMPANY_STATE_COMPONENT_REGISTRY[expectedIndex];
  if (!expected || component.componentType !== expected.componentType || component.ownerSystem !== expected.ownerSystem) {
    fail('component registry order, type, or owner is invalid');
  }
  nullableToken(component.nativeStateId, 'nativeStateId');
  nullableToken(component.nativeVersionId, 'nativeVersionId');
  nullableToken(component.schemaVersion, 'schemaVersion');
  if (component.contentHash !== null && !HASH_RE.test(component.contentHash)) fail('contentHash is invalid');
  normalizeCompanyStateWatermark(component.watermark);
  normalizeCompanyStateTimestamp(component.asOf, 'component.asOf');
  if (!COMPANY_STATE_CONSULTATION_STATUSES.includes(component.consultationStatus)) fail('consultationStatus is invalid');
  if (!COMPANY_STATE_READ_STATUSES.includes(component.readStatus)) fail('readStatus is invalid');
  if (!COMPANY_STATE_HISTORY_COMPLETENESS.includes(component.historyCompleteness)) fail('historyCompleteness is invalid');
  nullableToken(component.reasonCode, 'reasonCode');

  const refs = [component.nativeStateId, component.nativeVersionId, component.schemaVersion, component.contentHash];
  if (component.readStatus === 'PRESENT') {
    if (component.consultationStatus !== 'CONSULTED' || component.historyCompleteness !== 'COMPLETE' || refs.some((value) => value === null)) {
      fail('PRESENT requires consulted, complete, exact native references and content hash');
    }
    if (component.reasonCode !== null) fail('PRESENT cannot carry a reasonCode');
  } else if (component.readStatus === 'NOT_CONSULTED') {
    if (component.consultationStatus !== 'NOT_CONSULTED' || refs.some((value) => value !== null) || component.watermark !== null) {
      fail('NOT_CONSULTED must have null owner references');
    }
  } else {
    if (component.consultationStatus !== 'CONSULTED') fail(`${component.readStatus} requires CONSULTED`);
    if (component.readStatus === 'UNKNOWN' && component.reasonCode !== null) fail('UNKNOWN is an owner result, not an error reason');
    if (['UNAVAILABLE', 'READ_FAILED'].includes(component.readStatus) && component.reasonCode === null) fail(`${component.readStatus} requires reasonCode`);
    if (component.readStatus !== 'UNKNOWN' && refs.some((value) => value !== null)) fail('failed/unavailable reads cannot claim exact owner references');
  }
  assertNoStrategySmuggling(component, `CompanyStateComponentV1.${component.componentType}`);
  return Object.freeze({ ...structuredClone(component), watermark: normalizeCompanyStateWatermark(component.watermark) });
}

export function companyStateHashPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('manifest input is invalid');
  if (typeof input.ventureId !== 'string' || !SAFE_TOKEN_RE.test(input.ventureId)) fail('ventureId is invalid');
  const asOf = normalizeCompanyStateTimestamp(input.asOf, 'asOf');
  if (input.manifestSchemaVersion !== COMPANY_STATE_MANIFEST_SCHEMA_VERSION) fail('manifestSchemaVersion is invalid');
  if (!Array.isArray(input.components) || input.components.length !== COMPANY_STATE_COMPONENT_REGISTRY.length) fail('manifest requires exactly ten components');
  const components = input.components.map((component, index) => validateCompanyStateComponent(component, index));
  if (components.some((component) => component.asOf !== asOf)) fail('all component cutoffs must equal the logical manifest cutoff');
  return { asOf, components, manifestSchemaVersion: COMPANY_STATE_MANIFEST_SCHEMA_VERSION, ventureId: input.ventureId };
}

export function hashCompanyStateManifest(input) {
  const canonical = jcsCanonicalize(companyStateHashPayload(input));
  return `sha256:${crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

export function createCompanyStateManifest(input) {
  const payload = companyStateHashPayload(input);
  const createdAt = normalizeCompanyStateTimestamp(input.createdAt, 'createdAt');
  const manifestHash = hashCompanyStateManifest(payload);
  return Object.freeze({
    companyStateVersionId: `csv:v1:${manifestHash.slice('sha256:'.length)}`,
    ventureId: payload.ventureId,
    createdAt,
    asOf: payload.asOf,
    manifestSchemaVersion: payload.manifestSchemaVersion,
    components: Object.freeze(payload.components),
    manifestHash,
  });
}

export function validateCompanyStateManifest(manifest) {
  exactObject(manifest, MANIFEST_FIELDS, 'CompanyStateVersionV1');
  const expected = createCompanyStateManifest(manifest);
  if (!ID_RE.test(manifest.companyStateVersionId) || manifest.companyStateVersionId !== expected.companyStateVersionId) fail('companyStateVersionId does not match manifest content');
  if (manifest.manifestHash !== expected.manifestHash) fail('manifestHash does not match canonical manifest content');
  return expected;
}
