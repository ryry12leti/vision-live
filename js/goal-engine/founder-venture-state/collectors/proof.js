/**
 * Verified-proof collector — Founder Venture State V2, task spec section
 * 4/D. Maps a narrow, explicit set of proof-evidence fields into
 * `verified_proof` / `proof_verified` facts. Only fields genuinely present
 * on `evidence` are mapped — proof must not automatically prove facts
 * outside what the evidence actually supports, so there is no fallback or
 * inference for an absent field.
 */

import { buildFact } from '../fact-ledger.js';

// The exact, narrow set of fields verified proof may update (task spec:
// completed work, progress, product state, customer evidence, revenue
// evidence, acquisition evidence, delivery evidence, current stage,
// unfinished work) — mapped onto fact-ledger keys.
const EVIDENCE_FIELD_TO_FACT_KEY = Object.freeze({
  completedWork: 'completedWork',
  unfinishedWork: 'unfinishedWork',
  progressNote: 'recentProgress',
  productStatus: 'productOrService',
  customerEvidence: 'customerEvidence',
  // Revenue evidence never touches offerPricing -- proof of money actually
  // earned is a distinct fact from what the founder charges.
  revenueEvidence: 'revenue',
  acquisitionEvidence: 'acquisition',
  deliveryEvidence: 'delivery',
  currentStage: 'currentStage',
});

/**
 * @param {object} params
 * @param {string} params.ventureId
 * @param {string} params.userId
 * @param {object} params.evidence Only the fields the actual proof genuinely supports; any absent field is simply never mapped.
 * @param {string} params.proofReference A stable reference to the verified proof record (e.g. `proof:<proofId>`).
 * @param {string|null} [params.proofEventId] The proof system's own event id, when one exists.
 * @param {string} params.occurredAt ISO timestamp of when the proof was captured/verified.
 * @param {number} [params.confidence] The proof system's own confidence, 0-1, when it reports one.
 * @returns {object[]}
 */
export function mapVerifiedProofToFacts({
  ventureId, userId, evidence, proofReference, proofEventId = null, occurredAt, confidence = null,
}) {
  const facts = [];
  let seq = 0;
  for (const [evidenceField, factKey] of Object.entries(EVIDENCE_FIELD_TO_FACT_KEY)) {
    if (!Object.hasOwn(evidence || {}, evidenceField)) continue;
    const value = evidence[evidenceField];
    if (value === null || value === undefined) continue;
    facts.push(buildFact({
      factId: `${proofReference}:${seq++}`,
      ventureId,
      userId,
      factKey,
      value: factKey === 'recentProgress' ? [value] : value,
      sourceType: 'verified_proof',
      sourceReference: proofReference,
      sourceEventId: proofEventId,
      occurredAt,
      recordedAt: occurredAt,
      confidence,
    }));
  }
  return facts;
}
