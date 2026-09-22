/**
 * Founder Venture State V2 — the persistence boundary for the fact ledger.
 * Mirrors persistence.js's V1 pattern: a plain adapter interface plus a
 * deterministic, network-free in-memory reference implementation (this
 * repo's established no-live-credentials QA convention). A real Supabase-
 * backed adapter (reading/writing founder_ventures/founder_venture_facts/
 * founder_venture_state_events — see the migration) can satisfy this exact
 * interface without service-v2.js knowing or caring which store is in use.
 *
 * @typedef {object} FounderVentureFactsPersistenceAdapter
 * @property {(row: object) => Promise<void>} createVenture
 * @property {(userId: string) => Promise<object[]>} listVenturesByUser
 * @property {(ventureId: string) => Promise<object|null>} getVenture
 * @property {(ventureId: string, updates: object) => Promise<void>} updateVenture
 * @property {(ventureId: string) => Promise<object[]>} listFactsByVenture
 * @property {(fact: object) => Promise<void>} appendFact
 * @property {(factId: string, updates: object) => Promise<void>} updateFactFlags
 * @property {(event: object) => Promise<void>} appendEvent
 * @property {(ventureId: string) => Promise<object[]>} listEventsByVenture
 */

/**
 * @returns {FounderVentureFactsPersistenceAdapter}
 */
export function createInMemoryFounderVentureFactsPersistence() {
  const ventures = new Map(); // ventureId -> venture row
  const facts = new Map(); // factId -> fact row
  const events = []; // append-only

  return {
    async createVenture(row) {
      ventures.set(row.ventureId, { ...row });
    },
    async listVenturesByUser(userId) {
      return [...ventures.values()].filter((row) => row.userId === userId).map((row) => ({ ...row }));
    },
    async getVenture(ventureId) {
      const row = ventures.get(ventureId);
      return row ? { ...row } : null;
    },
    async updateVenture(ventureId, updates) {
      const row = ventures.get(ventureId);
      if (!row) throw new Error(`updateVenture: unknown ventureId ${ventureId}`);
      ventures.set(ventureId, { ...row, ...updates });
    },
    async listFactsByVenture(ventureId) {
      return [...facts.values()].filter((fact) => fact.ventureId === ventureId).map((fact) => ({ ...fact }));
    },
    async appendFact(fact) {
      if (facts.has(fact.factId)) throw new Error(`appendFact: duplicate factId ${fact.factId}`);
      facts.set(fact.factId, { ...fact });
    },
    async updateFactFlags(factId, updates) {
      const fact = facts.get(factId);
      if (!fact) throw new Error(`updateFactFlags: unknown factId ${factId}`);
      facts.set(factId, { ...fact, ...updates });
    },
    async appendEvent(event) {
      events.push({ ...event });
    },
    async listEventsByVenture(ventureId) {
      return events.filter((event) => event.ventureId === ventureId).map((event) => ({ ...event }));
    },
  };
}
