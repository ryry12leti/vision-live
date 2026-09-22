import crypto from 'node:crypto';
import { validateOntologyReadPacket } from '../read-packet.js';
import { assertContextFusionHasNoStrategyAuthority, CONTEXT_FUSION_AUTHORITY } from './authority.js';

export const CONTEXT_FUSION_CONTRACT_VERSION = 'ontology-context-fusion/v1';
const TOP_FIELDS = Object.freeze([
  'contractVersion', 'authority', 'contextId', 'status', 'ventureId', 'companyStateVersionId',
  'manifestHash', 'asOf', 'componentStatuses', 'sourceReferences', 'contextRelations',
  'contradictions', 'uncertainty', 'provenance', 'limits',
]);

function fail(message) { throw new TypeError(message); }
function stableStringify(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('context numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!value || typeof value !== 'object') fail('context contains a non-JSON value');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  for (const field of fields) if (!Object.hasOwn(value, field)) fail(`${label}.${field} is required`);
  for (const field of Object.keys(value)) if (!fields.includes(field)) fail(`${label}.${field} is not allowed`);
}

export function contextIdFor(context) {
  const { contextId, ...content } = context;
  return `ocf:v1:${crypto.createHash('sha256').update(stableStringify(content), 'utf8').digest('hex')}`;
}

export function validateOntologyFusedContext(context) {
  exact(context, TOP_FIELDS, 'OntologyFusedContextV1');
  if (context.contractVersion !== CONTEXT_FUSION_CONTRACT_VERSION || context.authority !== CONTEXT_FUSION_AUTHORITY) fail('context contract or authority is invalid');
  if (!['COMPLETE', 'INCOMPLETE'].includes(context.status)) fail('context status is invalid');
  if (!/^ocf:v1:[0-9a-f]{64}$/.test(context.contextId) || context.contextId !== contextIdFor(context)) fail('contextId does not match context content');
  for (const field of ['componentStatuses', 'sourceReferences', 'contextRelations', 'contradictions', 'uncertainty', 'provenance']) {
    if (!Array.isArray(context[field])) fail(`${field} must be an array`);
  }
  if (context.componentStatuses.length !== 10 || context.contextRelations.length > 100 || context.sourceReferences.length > 200 || context.provenance.length > 100) fail('context bounds are invalid');
  exact(context.limits, ['maxEntities', 'maxClaims', 'maxEvidenceRefs', 'maxRelationships', 'maxDepth'], 'context limits');
  if (context.limits.maxDepth !== 1) fail('context resolution depth must be one hop');
  assertContextFusionHasNoStrategyAuthority(context);
  return Object.freeze(structuredClone(context));
}

export function assertPacketForContextFusion(packet) {
  return validateOntologyReadPacket(packet);
}
