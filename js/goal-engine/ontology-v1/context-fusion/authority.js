import { assertNoStrategySmuggling } from '../contracts.js';

export const CONTEXT_FUSION_AUTHORITY = 'CONTEXT_ONLY_NO_STRATEGY';

export function assertContextFusionHasNoStrategyAuthority(value) {
  assertNoStrategySmuggling(value, 'OntologyContextFusionV1');
  return value;
}
