/**
 * Outcome Resolution — the deterministic half of the hybrid rule.
 *
 * A model may READ the Active Outcome's completion criteria alongside trusted
 * Founder State and return a structured, criterion-by-criterion judgment with
 * evidence references. It proposes. It never writes state and never decides
 * authority. Everything below is the part that decides.
 *
 * The threat model is explicit: the proposal arrives over the wire and is
 * therefore untrusted input, whether it was authored by the model, by a
 * well-meaning client, or by an attacker who noticed that "my outcome is
 * achieved" is a free business result. So nothing in the proposal is taken
 * on faith -- not the evidence, not the trust level, not even the criteria
 * text it claims to have evaluated:
 *
 *   - every referenced factId must resolve in the venture's OWN server-loaded
 *     fact ledger. A fact belonging to another venture is not evidence here,
 *     and an id that resolves to nothing is a fabrication.
 *   - trust comes from the ledger row, NEVER from the request. A caller
 *     cannot label its own chat message 'proof_verified'.
 *   - superseded facts are stale by definition: a claim resting on a row that
 *     has already been replaced is resting on something no longer true.
 *   - evidence recorded BEFORE the outcome existed cannot show that outcome
 *     was reached. It is history, not proof.
 *   - the proposal must echo the stored completion criteria verbatim, which
 *     is how deterministic code confirms the criteria actually evaluated were
 *     the venture's real ones rather than a convenient rewrite.
 *   - the proposal must name the outcome it judged, so a proposal built
 *     against one outcome can never be applied to whatever happens to be
 *     open by the time it lands.
 *
 * Pure: no database, no clock, no network, no model. The caller supplies the
 * already-loaded ledger; this module decides.
 */

import { resolveOutcomeClosure } from './outcome-closure.js';

export const OUTCOME_RESOLUTION_VERSION = 1;

/* The same ladder isUsableEntity applies to entities. Provisional evidence is
   visible but never load-bearing -- it cannot make a route eligible and it
   cannot award a completed business outcome. */
const TRUSTED_EVIDENCE_STATES = Object.freeze(['proof_verified', 'system_verified', 'user_confirmed']);

export const CRITERION_VERDICTS = Object.freeze(['met', 'not_met', 'contradicted']);

/* What a proposal may ask for. 'abandoned' is deliberately absent: abandoning
   is the founder's own decision and needs no criterion evaluation, so it does
   not travel this path at all. 'superseded' is engine-only. */
export const PROPOSABLE_STATES = Object.freeze(['achieved', 'disproven']);

export class OutcomeResolutionError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'OutcomeResolutionError';
    this.code = code;
  }
}

function reject(code, explanation) {
  return { valid: false, code, explanation, corroboration: null, evidence: [] };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Verifies a model-authored resolution proposal against server-owned state.
 *
 * @param {object} params
 * @param {object} params.proposal The untrusted structured proposal (see PROPOSAL SHAPE below).
 * @param {object} params.activeThread The venture's current activeOutcomeThread value.
 * @param {object[]} params.factLedger The venture's server-loaded fact ledger.
 * @param {string} params.ventureId The venture the request is scoped to (server-owned).
 * @returns {{valid: boolean, code: string, explanation: string, corroboration: object|null, evidence: object[]}}
 *
 * PROPOSAL SHAPE
 *   {
 *     outcomeId: string,               // must name the outcome actually open
 *     criteriaSourceText: string,      // must byte-match the stored criteria
 *     proposedState: 'achieved'|'disproven',
 *     judgments: [{
 *       criterion: string,
 *       verdict: 'met'|'not_met'|'contradicted',
 *       evidenceFactIds: string[],
 *       rationale: string,
 *     }],
 *   }
 */
export function verifyOutcomeResolutionProposal({
  proposal, activeThread, factLedger, ventureId,
}) {
  if (!activeThread || typeof activeThread !== 'object') {
    return reject('no_active_outcome', 'this venture has no active outcome to resolve');
  }
  if (activeThread.outcomeCompletionState !== 'open') {
    /* Replay guard #1. A resolution that lands twice must not re-apply. */
    return reject('already_closed', `this outcome is already "${activeThread.outcomeCompletionState}"`);
  }
  if (!proposal || typeof proposal !== 'object') {
    return reject('missing_proposal', 'an outcome is never resolved without a structured proposal');
  }
  if (!PROPOSABLE_STATES.includes(proposal.proposedState)) {
    return reject('unsupported_proposed_state', `proposedState must be one of ${PROPOSABLE_STATES.join(', ')}`);
  }

  /* Replay guard #2 and confused-deputy guard. A proposal built against one
     outcome must never be applied to a different one that happens to be open
     now -- which is exactly what a replayed or retargeted request looks like. */
  if (!isNonEmptyString(proposal.outcomeId) || proposal.outcomeId !== activeThread.outcomeId) {
    return reject('outcome_mismatch', 'the proposal does not name the outcome that is currently open');
  }

  /* The criteria the model claims to have evaluated must be the stored ones,
     byte for byte. Otherwise a proposal can silently judge easier criteria
     than the outcome actually committed to. */
  if (!isNonEmptyString(activeThread.outcomeCompletionCriteria)) {
    return reject('outcome_has_no_criteria', 'this outcome carries no completion criteria to evaluate');
  }
  if (proposal.criteriaSourceText !== activeThread.outcomeCompletionCriteria) {
    return reject('criteria_mismatch', 'the proposal evaluated criteria that are not the ones on record for this outcome');
  }

  if (!Array.isArray(proposal.judgments) || proposal.judgments.length === 0) {
    return reject('no_judgments', 'a proposal must judge the completion criteria, not merely assert an outcome');
  }
  for (const judgment of proposal.judgments) {
    if (!judgment || !isNonEmptyString(judgment.criterion) || !CRITERION_VERDICTS.includes(judgment.verdict)) {
      return reject('malformed_judgment', 'every judgment needs a criterion and a supported verdict');
    }
  }

  /* Resolve every evidence reference against the venture's OWN ledger. */
  const byFactId = new Map();
  for (const fact of Array.isArray(factLedger) ? factLedger : []) {
    if (fact && isNonEmptyString(fact.factId)) byFactId.set(fact.factId, fact);
  }

  const accepted = [];
  for (const judgment of proposal.judgments) {
    const referenced = Array.isArray(judgment.evidenceFactIds) ? judgment.evidenceFactIds : [];
    for (const factId of referenced) {
      const fact = byFactId.get(factId);
      if (!fact) {
        return reject('evidence_not_found', `referenced evidence "${factId}" does not exist in this venture's ledger`);
      }
      /* ventureId is the server-owned scope of the request, never a value the
         proposal supplies -- so cross-venture evidence cannot be smuggled in
         by naming someone else's fact. */
      if (fact.ventureId !== ventureId) {
        return reject('evidence_wrong_venture', `referenced evidence "${factId}" belongs to a different venture`);
      }
      if (fact.active !== true) {
        return reject('evidence_stale', `referenced evidence "${factId}" has been superseded and no longer reflects current state`);
      }
      if (!TRUSTED_EVIDENCE_STATES.includes(fact.verificationStatus)) {
        return reject('evidence_not_trusted', `referenced evidence "${factId}" is "${fact.verificationStatus}" and cannot close an outcome`);
      }
      /* Evidence that predates the outcome cannot demonstrate the outcome was
         reached; at best it is the context the outcome was created against. */
      const recordedAt = fact.recordedAt || fact.occurredAt;
      if (isNonEmptyString(activeThread.outcomeCreatedAt) && isNonEmptyString(recordedAt)
        && Date.parse(recordedAt) < Date.parse(activeThread.outcomeCreatedAt)) {
        return reject('evidence_predates_outcome', `referenced evidence "${factId}" was recorded before this outcome existed`);
      }
      accepted.push(fact);
    }
  }

  const met = proposal.judgments.filter((judgment) => judgment.verdict === 'met');
  const notMet = proposal.judgments.filter((judgment) => judgment.verdict === 'not_met');
  const contradicted = proposal.judgments.filter((judgment) => judgment.verdict === 'contradicted');

  if (contradicted.length > 0) {
    /* Contradictory evidence resolves to neither terminal state. The honest
       answer is that the outcome stays open and a human looks at it. */
    return reject('contradictory_evidence', 'at least one criterion has contradictory evidence; the outcome stays open');
  }

  if (proposal.proposedState === 'achieved') {
    if (notMet.length > 0) {
      return reject('criteria_not_covered', `${notMet.length} of ${proposal.judgments.length} criteria are not met; the outcome is not achieved`);
    }
    /* Every criterion must be carried by its own trusted evidence. A judgment
       that says "met" while pointing at nothing is an assertion. */
    for (const judgment of met) {
      const referenced = Array.isArray(judgment.evidenceFactIds) ? judgment.evidenceFactIds : [];
      if (referenced.length === 0) {
        return reject('criterion_unevidenced', `criterion "${judgment.criterion}" is claimed met with no evidence`);
      }
    }
  }

  if (proposal.proposedState === 'disproven') {
    /* Disproving is a positive claim too: something must actually show the
       assumption is false. */
    const disproving = notMet.filter((judgment) => (judgment.evidenceFactIds || []).length > 0);
    if (disproving.length === 0) {
      return reject('disproof_unevidenced', 'recording an outcome as disproven requires trusted evidence that a criterion cannot be met');
    }
  }

  /* Trust reported here is the WEAKEST accepted link, derived from the ledger
     -- never a level the caller asked for. */
  const weakest = accepted.reduce((lowest, fact) => {
    const rank = TRUSTED_EVIDENCE_STATES.indexOf(fact.verificationStatus);
    const lowestRank = TRUSTED_EVIDENCE_STATES.indexOf(lowest);
    return rank > lowestRank ? fact.verificationStatus : lowest;
  }, TRUSTED_EVIDENCE_STATES[0]);

  return {
    valid: true,
    code: 'proposal_verified',
    explanation: `${met.length} criteria met, ${notMet.length} not met, carried by ${accepted.length} trusted evidence facts`,
    corroboration: {
      trustLevel: weakest,
      summary: `${accepted.length} trusted fact(s) covering ${proposal.judgments.length} criterion judgment(s)`,
    },
    evidence: accepted,
  };
}

/**
 * Verifies a proposal and, if it holds, produces the committed closure.
 *
 * This is the single entry point a request handler should call: it cannot be
 * used to close an outcome without passing verification first, because the
 * corroboration handed to resolveOutcomeClosure is built here from the ledger
 * rather than accepted from the caller.
 *
 * @returns {{committed: boolean, code: string, explanation: string, closure: object|null, evidence: object[]}}
 */
export function resolveOutcomeFromProposal({
  proposal, activeThread, factLedger, ventureId, reason, meaningfulEvent = null,
}) {
  const verification = verifyOutcomeResolutionProposal({
    proposal, activeThread, factLedger, ventureId,
  });
  if (!verification.valid) {
    return {
      committed: false,
      code: verification.code,
      explanation: verification.explanation,
      closure: null,
      evidence: [],
    };
  }

  const closure = resolveOutcomeClosure({
    activeThread,
    requestedState: proposal.proposedState,
    reason: isNonEmptyString(reason) ? reason : verification.explanation,
    /* A disproof needs an attributable event; the verified judgment IS one. */
    meaningfulEvent: meaningfulEvent || {
      summary: `outcome_resolution: ${proposal.proposedState}`,
      interpretation: verification.explanation,
      relatedEntityIds: [],
    },
    corroboration: verification.corroboration,
  });

  return {
    committed: closure.closed,
    code: closure.closed ? 'closure_committed' : closure.reasonCode,
    explanation: closure.explanation,
    closure,
    evidence: verification.evidence,
  };
}
