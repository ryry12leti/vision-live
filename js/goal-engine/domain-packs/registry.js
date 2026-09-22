import {
  DomainPackValidationError,
  assertValidDomainPack,
  validateDomainPack,
} from './contract.js';
import { fitnessDomainPack } from './fitness.js';
import { founderDomainPack } from './founder.js';
import { learningDomainPack } from './learning.js';
import { moneyDomainPack } from './money.js';
import { creatorDomainPack } from './creator.js';
import { athleteDomainPack } from './athlete.js';

export const CANONICAL_DOMAIN_IDS = Object.freeze([
  'fitness',
  'founder',
  'learning',
  'money',
  'creator',
  'athlete',
]);

export const DOMAIN_PACKS = Object.freeze([
  fitnessDomainPack,
  founderDomainPack,
  learningDomainPack,
  moneyDomainPack,
  creatorDomainPack,
  athleteDomainPack,
]);

export class DomainPackRegistryValidationError extends Error {
  constructor(errors) {
    super(`Invalid domain-pack registry: ${errors.join('; ')}`);
    this.name = 'DomainPackRegistryValidationError';
    this.errors = Object.freeze([...errors]);
  }
}

/**
 * Validate registry-level uniqueness and distinctness.
 *
 * @param {unknown} packs
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateDomainPackRegistry(packs) {
  const errors = [];
  if (!Array.isArray(packs) || packs.length === 0) {
    return { valid: false, errors: ['registry must contain at least one domain pack'] };
  }

  const domainIds = new Set();
  const workUnitOwners = new Map();
  const workUnitSignatures = new Map();

  for (const [index, pack] of packs.entries()) {
    const result = validateDomainPack(pack);
    if (!result.valid) {
      for (const error of result.errors) errors.push(`packs[${index}]: ${error}`);
      continue;
    }

    if (domainIds.has(pack.domainId)) {
      errors.push(`duplicate domainId: ${pack.domainId}`);
    }
    domainIds.add(pack.domainId);

    for (const workUnit of pack.professionalWorkUnitTypes) {
      const owner = workUnitOwners.get(workUnit.id);
      if (owner) errors.push(`duplicate professional work-unit id ${workUnit.id} in ${owner} and ${pack.domainId}`);
      workUnitOwners.set(workUnit.id, pack.domainId);
    }

    const signature = pack.professionalWorkUnitTypes
      .map((workUnit) => workUnit.description.trim().toLowerCase())
      .sort()
      .join('|');
    const signatureOwner = workUnitSignatures.get(signature);
    if (signatureOwner) {
      errors.push(`professional work-unit definitions are identical for ${signatureOwner} and ${pack.domainId}`);
    }
    workUnitSignatures.set(signature, pack.domainId);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Create an immutable domain-id keyed registry.
 *
 * @param {import('./contract.js').DomainPack[]} packs
 * @returns {Readonly<Record<string, Readonly<import('./contract.js').DomainPack>>>}
 */
export function createDomainPackRegistry(packs) {
  const result = validateDomainPackRegistry(packs);
  if (!result.valid) throw new DomainPackRegistryValidationError(result.errors);
  for (const pack of packs) assertValidDomainPack(pack);
  return Object.freeze(Object.fromEntries(packs.map((pack) => [pack.domainId, pack])));
}

export const domainPackRegistry = createDomainPackRegistry(DOMAIN_PACKS);

/**
 * @param {string} domainId
 * @returns {Readonly<import('./contract.js').DomainPack>|null}
 */
export function getDomainPack(domainId) {
  return domainPackRegistry[domainId] || null;
}

/**
 * @returns {Readonly<import('./contract.js').DomainPack>[]}
 */
export function listDomainPacks() {
  return CANONICAL_DOMAIN_IDS.map((domainId) => domainPackRegistry[domainId]);
}

// Preserve a direct contract assertion export for later server integration
// without making the registry an evaluator or generator.
export { DomainPackValidationError };
