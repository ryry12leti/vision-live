/**
 * Owner-only shadow-run Founder Venture Snapshot + Execution Entities +
 * Execution Context bridge.
 *
 * Turns an already-validated primary Founder Venture State V2 snapshot
 * (founder-venture-probe.js's evaluateFounderVentureRow output, which now
 * also carries the trusted Founder Execution Entities bundle re-derived
 * from the SAME cached state) into a real `external_programme` sourceRecord
 * the trusted-context assembler can select -- the exact gap
 * founder-venture-probe.js's header comment (and the shadow-run edge
 * function's original "Known limitation" note) flagged as out of scope for
 * the prior collection/maintenance work. This is the smallest possible
 * bridge: it builds one sourceRecord and hands it back for the caller to
 * push into the existing sourceRecords array before runOwnerShadowGoalEngine
 * runs -- it never calls the pipeline itself, and it never merges primary
 * and secondary.
 *
 * Attachment order matters and is fixed: snapshot -> entities -> execution
 * context, each cross-checked against the exact same ventureId/ventureRole/
 * stateVersion, each failing closed independently. The execution context is
 * built AFTER entities attach because founder_customer_interview_set/
 * founder_sales_outreach_block/founder_operating_process/
 * founder_strategy_decision route eligibility (see founder-execution-context/
 * route-eligibility.js) depends on real entities existing, not merely the
 * venture snapshot. The same sourceRecord also carries `domainFacts`
 * (derived structurally from the snapshot + entities, never a bottleneck/
 * ranking decision -- see builder.js), reaching the trusted-context
 * assembler through the accepted `external_programme` alternate source
 * trusted-context/contract.js's SOURCE_AUTHORITY_MATRIX.domain_facts already
 * lists -- no second sourceRecord, no new source type.
 *
 * Fails closed (returns attached:false, never a partially-built record) at
 * any stage: invalid/tampered snapshot, a secondary venture, a paused/
 * archived venture, missing critical context, an invalid/mismatched entity
 * bundle, or an invalid/mismatched execution context. In every failure case
 * the caller gets a machine-readable `reason` and (for insufficient_context)
 * the snapshot's own capped unresolvedQuestions, so the shadow-run response
 * can report `clarification_required` honestly instead of generating
 * candidates from a thin or disallowed context.
 */

import { TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION } from '../trusted-context/index.js';
import {
  attachFounderVentureSnapshotToRequiredAttributes,
  attachFounderExecutionEntitiesToRequiredAttributes,
} from '../founder-venture-state/index.js';
import {
  buildFounderExecutionContext,
  attachFounderExecutionContextToRequiredAttributes,
} from '../founder-execution-context/index.js';

const FOUNDER_VENTURE_PROGRAMME_VERSION = 1;

/**
 * @typedef {object} FounderVentureBridgeResult
 * @property {boolean} attached
 * @property {object|null} sourceRecord Present only when attached === true.
 * @property {string|null} reason Machine-readable reason when attached === false.
 * @property {string[]} unresolvedQuestions Never more than 3; populated only for reason === 'insufficient_context'.
 * @property {object|null} executionContext The full rich diagnostic (route eligibility, resource bindings, clarification, domainFacts) for the owner-shadow response -- never sent to the planner itself. Present only when attached === true.
 * @property {object|null} entityBundle The trusted, validated Founder Execution Entities bundle (buildFounderExecutionEntities' output) for the owner-shadow response -- present only when attached === true.
 */

/**
 * @param {object} params
 * @param {import('./founder-venture-probe.js').FounderVentureRowEvaluation} params.evaluation The PRIMARY venture's probe evaluation only -- never pass a secondary evaluation here.
 * @param {'active'|'paused'|'archived'|null} params.ventureLifecycleStatus The venture's founder_ventures.status.
 * @param {string} params.goalId The synthetic shadow-run goalId this sourceRecord will be scoped to.
 * @param {string} params.evaluationTime ISO timestamp for "now".
 * @param {string[]} [params.availableResourceIds] Trusted resource ids (the same list the request's own available_resources source supplies) -- resourceBindings can only ever be resolved from this list, never invented.
 * @param {object} [params.baseRequiredAttributes] Any requiredAttributes another real source already contributes -- merged in, never overwritten.
 * @returns {FounderVentureBridgeResult}
 */
export function buildFounderVentureProgrammeSourceRecord({
  evaluation, ventureLifecycleStatus, goalId, evaluationTime, availableResourceIds = [], baseRequiredAttributes = {},
}) {
  if (evaluation.status !== 'valid') {
    return {
      attached: false,
      sourceRecord: null,
      reason: evaluation.status === 'not_found' ? 'no_primary_venture' : 'invalid_stored_state',
      unresolvedQuestions: [],
      executionContext: null,
      entityBundle: null,
    };
  }

  const attach = attachFounderVentureSnapshotToRequiredAttributes(baseRequiredAttributes, evaluation.snapshot, ventureLifecycleStatus);
  if (!attach.valid) {
    return {
      attached: false,
      sourceRecord: null,
      reason: attach.reason,
      unresolvedQuestions: attach.unresolvedQuestions || [],
      executionContext: null,
      entityBundle: null,
    };
  }

  const { ventureId } = evaluation;
  const { snapshot, entityBundle } = evaluation;

  const attachEntities = attachFounderExecutionEntitiesToRequiredAttributes(
    attach.requiredAttributes,
    entityBundle,
    { ventureId, ventureRole: 'primary', stateVersion: snapshot.stateVersion },
  );
  if (!attachEntities.valid) {
    return {
      attached: false,
      sourceRecord: null,
      reason: `execution_entities_${attachEntities.reason}`,
      unresolvedQuestions: [],
      executionContext: null,
      entityBundle: null,
    };
  }

  const built = buildFounderExecutionContext({ snapshot, availableResourceIds, entityBundle });
  const attachExecution = attachFounderExecutionContextToRequiredAttributes(
    attachEntities.requiredAttributes,
    built,
    { ventureId, ventureRole: 'primary', stateVersion: snapshot.stateVersion },
  );
  if (!attachExecution.valid) {
    return {
      attached: false,
      sourceRecord: null,
      reason: `execution_context_${attachExecution.reason}`,
      unresolvedQuestions: [],
      executionContext: null,
      entityBundle: null,
    };
  }

  const sourceRecord = {
    contractVersion: TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION,
    sourceRecordId: `founder_venture_programme:${ventureId}`,
    eventId: `founder_venture_programme:${ventureId}:${snapshot.stateVersion}`,
    sourceType: 'external_programme',
    goalId,
    verificationStatus: 'verified',
    sourceSequence: 0,
    occurredAt: evaluationTime,
    ingestedAt: evaluationTime,
    eventVersion: 1,
    capturedFacts: {
      programmeId: ventureId,
      programmeVersion: FOUNDER_VENTURE_PROGRAMME_VERSION,
      programmeStage: snapshot.stage.status === 'known' ? snapshot.stage.value : 'unspecified',
      programmeExternal: true,
      programmeRequiredAttributes: attachExecution.requiredAttributes,
      planStatus: 'active',
      visionAdditions: { label: 'founder_venture_state', attributes: {} },
      // Satisfies trusted-context/assembler.js's domain_facts selectLatest
      // call (['domainId','domainFacts']) via the accepted 'external_programme'
      // alternate source -- see this file's header comment.
      domainId: 'founder',
      domainFacts: built.domainFacts,
    },
    provenanceReference: `founder_venture_state:${ventureId}`,
    provenance: {
      authority: 'professional',
      actorType: 'professional',
      referenceId: `founder_venture_state:${ventureId}`,
      streamId: `founder_venture_programme:${ventureId}`,
    },
    confidence: snapshot.confidence,
  };

  return {
    attached: true,
    sourceRecord,
    reason: null,
    unresolvedQuestions: [],
    executionContext: built,
    entityBundle,
  };
}
