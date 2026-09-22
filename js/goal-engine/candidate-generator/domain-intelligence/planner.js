/**
 * Shared planner: dispatches to the correct domain intelligence module,
 * validates every brief it returns, deduplicates any that turn out to plan
 * the exact same route, and caps the result at the requested candidateCount
 * (never padding with fake variety to reach it).
 */

import { CandidateGenerationConfigError } from '../contract.js';
import { assertValidCandidateBrief, briefRouteSignature } from './contract.js';
import { planAthleteBriefs } from './athlete.js';
import { planCreatorBriefs } from './creator.js';
import { planFitnessBriefs } from './fitness.js';
import { planFounderBriefs } from './founder.js';
import { planLearningBriefs } from './learning.js';
import { planMoneyBriefs } from './money.js';

const DOMAIN_PLANNERS = Object.freeze({
  fitness: planFitnessBriefs,
  founder: planFounderBriefs,
  learning: planLearningBriefs,
  money: planMoneyBriefs,
  creator: planCreatorBriefs,
  athlete: planAthleteBriefs,
});

/**
 * Raised specifically when a domain module could not plan even one
 * executable route for an otherwise-unblocked request — every canonical
 * work unit was excluded (missing genuinely required resources, no
 * unambiguously trusted method, or no valid brief could be built) rather
 * than the caller misconfiguring the domain pack itself. Distinguished from
 * the generic CandidateGenerationConfigError (e.g. an unregistered domain
 * id) so the public generator can fail closed with a distinct, honest
 * `no_executable_route` state instead of the caller-misuse
 * `invalid_domain_pack` state.
 */
export class NoExecutableRouteError extends CandidateGenerationConfigError {
  constructor(message) {
    super(message);
    this.name = 'NoExecutableRouteError';
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

/**
 * @param {object} request A built, unblocked generation request (request.blocked === false).
 * @returns {Readonly<object[]>} 1-5 validated, deep-frozen, route-distinct candidate briefs.
 */
export function planCandidateBriefs(request) {
  const planner = DOMAIN_PLANNERS[request.domainId];
  if (!planner) {
    throw new CandidateGenerationConfigError(`No domain intelligence planner is registered for domain ${request.domainId}`);
  }

  const rawBriefs = planner(request);
  if (!Array.isArray(rawBriefs)) {
    throw new CandidateGenerationConfigError(`Domain intelligence for ${request.domainId} did not return an array of briefs`);
  }

  const seenRoutes = new Set();
  const briefs = [];
  for (const brief of rawBriefs) {
    assertValidCandidateBrief(brief, request);
    const signature = briefRouteSignature(brief);
    if (seenRoutes.has(signature)) continue; // never manufacture fake variety
    seenRoutes.add(signature);
    briefs.push(brief);
    if (briefs.length >= Math.min(5, request.candidateCount)) break;
  }

  if (briefs.length === 0) {
    throw new NoExecutableRouteError(
      `Domain intelligence for ${request.domainId} found zero executable routes for this exact request `
      + '(every canonical work unit was excluded by resource availability, trusted method matching, or proof pairing)',
    );
  }

  return deepFreeze(briefs);
}
