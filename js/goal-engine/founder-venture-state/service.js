/**
 * The one public Founder Venture State entry point: creates/updates state
 * from trusted source records, persists it, reloads it, and exposes the
 * correct primary/secondary venture for Goal Engine request construction.
 * This is the only place assembly (assembler.js), persistence
 * (persistence.js), and portfolio enforcement (contract.js's
 * validateVenturePortfolio/addVentureToPortfolio) are combined — nothing
 * else in this module should reproduce that orchestration.
 *
 * `founderId` here is a persistence/ownership concern (which rows belong
 * to which user), deliberately kept out of the pure contract (contract.js
 * validates venture-scoped facts, never ownership) — see contract.js's
 * addVentureToPortfolio docstring, which already documents that the
 * caller owns fetching/scoping the portfolio.
 */

import {
  FOUNDER_VENTURE_STATE_CONTRACT_VERSION,
  addVentureToPortfolio,
} from './contract.js';
import { assembleFounderVentureState } from './assembler.js';

/**
 * @param {import('./persistence.js').FounderVentureStatePersistenceAdapter} persistenceAdapter
 */
export function createFounderVentureStateService(persistenceAdapter) {
  /**
   * Loads whatever is currently persisted for this exact venture, merges
   * the given trusted source records against it (assembleFounderVentureState
   * already re-validates the loaded row before trusting it), and — only
   * when the result is genuinely 'ready' AND persisting it would not
   * violate the one-primary/one-secondary/max-two portfolio rule — persists
   * the new state. A 'ready' assembly that WOULD violate the portfolio
   * (e.g. this is a second primary venture) is downgraded to
   * `invalid_input` and never persisted; an 'insufficient_context' or
   * already-'invalid_input' result is returned as-is and never persisted,
   * since there is nothing safely re-persistable yet.
   *
   * @param {{founderId: string, ventureId: string, ventureRole: string, evaluationTime: string, sourceRecords: object[]}} input
   * @returns {Promise<object>} The exact assembleFounderVentureState result shape.
   */
  async function recordUpdate({
    founderId, ventureId, ventureRole, evaluationTime, sourceRecords,
  }) {
    const previousState = await persistenceAdapter.load(founderId, ventureId);
    const result = assembleFounderVentureState({
      contractVersion: FOUNDER_VENTURE_STATE_CONTRACT_VERSION,
      ventureId,
      ventureRole,
      evaluationTime,
      previousState,
      sourceRecords,
    });
    if (result.status !== 'ready') return result;

    const otherVentures = (await persistenceAdapter.listVenturesByFounder(founderId))
      .filter((venture) => venture.ventureId !== ventureId);
    const portfolioCheck = addVentureToPortfolio(otherVentures, ventureId, ventureRole);
    if (!portfolioCheck.valid) {
      return Object.freeze({ status: 'invalid_input', errors: portfolioCheck.errors });
    }

    await persistenceAdapter.save(founderId, ventureId, result.ventureState);
    return result;
  }

  /**
   * @returns {Promise<object|null>} The persisted ventureState for this
   *   exact venture, or null if none exists. Does not re-run assembly.
   */
  async function loadVenture(founderId, ventureId) {
    return persistenceAdapter.load(founderId, ventureId);
  }

  async function loadByRole(founderId, ventureRole) {
    const ventures = await persistenceAdapter.listVenturesByFounder(founderId);
    const match = ventures.find((venture) => venture.ventureRole === ventureRole);
    if (!match) return null;
    return persistenceAdapter.load(founderId, match.ventureId);
  }

  /**
   * The venture that must be passed as the Founder Goal Engine request's
   * primary venture state — never the secondary, never a merge of both.
   */
  async function loadPrimaryVenture(founderId) {
    return loadByRole(founderId, 'primary');
  }

  /**
   * The optional secondary venture, kept available separately — never
   * folded into the primary and never sent as the request's primary
   * venture state.
   */
  async function loadSecondaryVenture(founderId) {
    return loadByRole(founderId, 'secondary');
  }

  return {
    recordUpdate,
    loadVenture,
    loadPrimaryVenture,
    loadSecondaryVenture,
  };
}
