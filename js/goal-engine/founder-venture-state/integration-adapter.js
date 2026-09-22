/**
 * Maps verified integration facts (GitHub, Supabase, Vercel, website
 * inspection, uploaded files) into genuine `verified_venture_evidence`
 * source records — the ONLY path by which anything may be trusted as
 * `verified` (see contract.js's SOURCE_TYPE_STATUS). This module does not
 * duplicate contract.js/assembler.js's trust logic: it produces exactly
 * the same source-record shape validateVentureSourceRecord already
 * validates, then hands off to the existing assembler unchanged.
 *
 * A caller cannot make an arbitrary fact "verified" merely by labelling it
 * so — buildVerifiedVentureSourceRecord requires a real `integrationType`
 * from a small fixed vocabulary, and independently derives the resulting
 * `provenance.authority`/`actorType` from that type (never accepts them as
 * free-form input), so a caller cannot claim GitHub-verified provenance
 * for text that was never actually observed from GitHub. No live
 * integration (real GitHub/Supabase/Vercel API calls, file parsing, or
 * website scraping) is built here — this is the trusted mapping boundary
 * those integrations would call once they exist.
 */

import { VENTURE_FACT_FIELDS, isPlainObject } from './contract.js';

export const INTEGRATION_TYPES = Object.freeze(['github', 'supabase', 'vercel', 'website_inspection', 'file_upload']);

// Every integration type maps to exactly one verification authority — the
// caller never supplies this directly, closing off "I'll just say it's
// verified" as an attack/bug surface.
const INTEGRATION_VERIFICATION_AUTHORITY = Object.freeze({
  github: 'github_verified',
  supabase: 'supabase_verified',
  vercel: 'vercel_verified',
  website_inspection: 'website_verified',
  file_upload: 'file_verified',
});

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTimestamp(value) {
  return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

/**
 * Builds one trusted `verified_venture_evidence` source record from a
 * single observed integration fact, or returns `{ valid: false, errors }`
 * when the input cannot be trusted. Only VENTURE_FACT_FIELDS names are
 * accepted for `factField` — an integration observing something outside
 * that fixed field set has nothing to write, by construction, since the
 * fact would otherwise have no validated place in Founder Venture State.
 *
 * @param {{integrationType: string, sourceId: string, ventureId: string, factField: string, factValue: unknown, observedAt: string, evidenceReference: string}} input
 * @returns {{valid: true, record: object}|{valid: false, errors: string[]}}
 */
export function buildVerifiedVentureSourceRecord(input) {
  const errors = [];
  if (!isPlainObject(input)) return { valid: false, errors: ['input must be a plain object'] };
  const {
    integrationType, sourceId, ventureId, factField, factValue, observedAt, evidenceReference,
  } = input;

  if (!INTEGRATION_TYPES.includes(integrationType)) errors.push(`integrationType "${integrationType}" is not a supported integration`);
  if (!isNonEmptyString(sourceId)) errors.push('sourceId must be a non-empty string');
  if (!isNonEmptyString(ventureId)) errors.push('ventureId must be a non-empty string');
  if (!VENTURE_FACT_FIELDS.includes(factField)) errors.push(`factField "${factField}" is not a recognised, mapped Founder Venture State field`);
  if (!validTimestamp(observedAt)) errors.push('observedAt must be a valid timestamp');
  if (!isNonEmptyString(evidenceReference)) errors.push('evidenceReference is required and must be a non-empty string');

  if (errors.length > 0) return { valid: false, errors };

  const authority = INTEGRATION_VERIFICATION_AUTHORITY[integrationType];
  return {
    valid: true,
    record: {
      contractVersion: 1,
      sourceRecordId: sourceId,
      ventureId,
      sourceType: 'verified_venture_evidence',
      occurredAt: observedAt,
      capturedFacts: { [factField]: factValue },
      provenance: { authority: 'integration_verified', actorType: 'integration', referenceId: `${authority}:${evidenceReference}` },
    },
  };
}

/**
 * Validates and builds a whole batch of integration facts at once — every
 * fact must genuinely belong to the same venture (a caller mixing facts
 * for two different ventures in one integration sync is rejected outright,
 * never silently split or merged), and every sourceId in the batch must be
 * unique (a duplicate observation is rejected rather than silently
 * deduplicated, since two different facts sharing one sourceId is either a
 * caller bug or a replay attempt, not a legitimate update).
 *
 * @param {string} ventureId
 * @param {object[]} facts Each shaped like buildVerifiedVentureSourceRecord's input, minus `ventureId`.
 * @returns {{valid: true, records: object[]}|{valid: false, errors: string[]}}
 */
export function buildVerifiedVentureSourceRecordBatch(ventureId, facts) {
  const errors = [];
  if (!isNonEmptyString(ventureId)) errors.push('ventureId must be a non-empty string');
  if (!Array.isArray(facts) || facts.length === 0) {
    errors.push('facts must be a non-empty array');
    return { valid: false, errors };
  }

  const sourceIds = facts.map((fact) => fact?.sourceId).filter(isNonEmptyString);
  if (new Set(sourceIds).size !== sourceIds.length) errors.push('duplicate sourceId within one integration fact batch');
  if (facts.some((fact) => isNonEmptyString(fact?.ventureId) && fact.ventureId !== ventureId)) {
    errors.push('every fact in a batch must belong to the same declared ventureId — cross-venture integration facts are rejected');
  }
  if (errors.length > 0) return { valid: false, errors };

  const records = [];
  for (const fact of facts) {
    const result = buildVerifiedVentureSourceRecord({ ...fact, ventureId });
    if (!result.valid) return { valid: false, errors: result.errors };
    records.push(result.record);
  }
  return { valid: true, records };
}
