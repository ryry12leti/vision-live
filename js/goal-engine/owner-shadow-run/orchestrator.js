/**
 * Owner-only shadow-run orchestrator.
 *
 * Runs the real, disconnected js/goal-engine/ pipeline stage by stage --
 * assembleTrustedContext -> createGenerationEnvelope -> buildGenerationRequest
 * -> planCandidateBriefs -- over whatever sourceRecords the caller supplies,
 * and reports exactly which stage it reached before stopping. Pure and
 * read-only: it never persists anything, never calls a live Supabase RPC,
 * and never calls a model provider. Comparison/display only.
 */

import { assembleTrustedContext, TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION } from '../trusted-context/index.js';
import {
  buildGenerationRequest,
  createGenerationEnvelope,
  planCandidateBriefs,
  NoExecutableRouteError,
} from '../candidate-generator/index.js';
import { getDomainPack } from '../domain-packs/index.js';

const READY_STATES = new Set(['ready', 'recovery_required']);

/**
 * @typedef {object} ShadowRunTrustedContextSummary
 * @property {string} assemblyState
 * @property {string[]} clarificationQuestions
 * @property {string[]} warnings
 * @property {object[]} conflicts
 * @property {string[]} sourceRecordsUsed
 * @property {{sourceRecordId: string|null, sourceType: string|null, reason: string}[]} sourceRecordsRejected
 *
 * @typedef {object} ShadowRunEnvelopeSummary
 * @property {string} goalId
 * @property {string} goalRole
 * @property {number} workingLevel
 * @property {string} contextId
 *
 * @typedef {object} ShadowRunGenerationRequestSummary
 * @property {string} requestId
 * @property {string} domainId
 * @property {number} candidateCount
 * @property {boolean} blocked
 * @property {string[]} blockedReasons
 *
 * @typedef {object} ShadowRunCandidateBriefSummary
 * @property {string} briefId
 * @property {string} strategyLens
 * @property {string} workUnitTypeId
 * @property {string} evidenceTypeId
 * @property {string} claimCategoryId
 * @property {string} outputCategoryId
 * @property {string} measurableOutcome
 * @property {string} strategicReason
 *
 * @typedef {object} ShadowRunReport
 * @property {ShadowRunTrustedContextSummary} trustedContext
 * @property {ShadowRunEnvelopeSummary|null} envelope
 * @property {ShadowRunGenerationRequestSummary|null} generationRequest
 * @property {ShadowRunCandidateBriefSummary[]|null} candidateBriefs
 * @property {string|null} stoppedAt
 * @property {string|null} stopReason
 */

function summariseRejected(rejected) {
  return rejected.map((entry) => ({
    sourceRecordId: entry.sourceRecord?.sourceRecordId ?? null,
    sourceType: entry.sourceRecord?.sourceType ?? null,
    reason: entry.reason,
  }));
}

function summariseBrief(brief) {
  return {
    briefId: brief.briefId,
    strategyLens: brief.strategyLens,
    workUnitTypeId: brief.workUnitTypeId,
    evidenceTypeId: brief.evidenceTypeId,
    claimCategoryId: brief.claimCategoryId,
    outputCategoryId: brief.outputCategoryId,
    measurableOutcome: brief.measurableOutcome,
    strategicReason: brief.strategicReason,
  };
}

/**
 * @param {object} params
 * @param {string} params.contextId Snake_case identifier.
 * @param {string} params.goalId
 * @param {number} params.currentSequence
 * @param {string} params.evaluationTime ISO timestamp.
 * @param {string} params.userLocalDate YYYY-MM-DD.
 * @param {object[]} params.sourceRecords
 * @param {number} [params.candidateCount]
 * @param {string} params.requestId
 * @param {string} params.generatedAt ISO timestamp.
 * @returns {Promise<ShadowRunReport>} A stage-by-stage report; never throws for expected stop states.
 */
export async function runOwnerShadowGoalEngine({
  contextId,
  goalId,
  currentSequence,
  evaluationTime,
  userLocalDate,
  sourceRecords,
  candidateCount = 3,
  requestId,
  generatedAt,
}) {
  const assemblyInput = {
    contractVersion: TRUSTED_CONTEXT_SOURCE_CONTRACT_VERSION,
    contextId,
    goalId,
    currentSequence,
    evaluationTime,
    userLocalDate,
    sourceRecords,
  };

  const assemblerResult = assembleTrustedContext(assemblyInput);

  /** @type {ShadowRunReport} */
  const report = {
    trustedContext: {
      assemblyState: assemblerResult.assemblyState,
      clarificationQuestions: assemblerResult.clarificationQuestions,
      warnings: assemblerResult.warnings,
      conflicts: assemblerResult.conflicts,
      sourceRecordsUsed: assemblerResult.sourceRecordsUsed.map((record) => record.sourceRecordId),
      sourceRecordsRejected: summariseRejected(assemblerResult.sourceRecordsRejected),
    },
    envelope: null,
    generationRequest: null,
    candidateBriefs: null,
    stoppedAt: null,
    stopReason: null,
  };

  if (!READY_STATES.has(assemblerResult.assemblyState)) {
    report.stoppedAt = 'trusted_context';
    report.stopReason = `assemblyState is "${assemblerResult.assemblyState}", not ready or recovery_required`;
    return report;
  }

  let envelope;
  try {
    envelope = await createGenerationEnvelope(assemblerResult);
  } catch (error) {
    report.stoppedAt = 'generation_envelope';
    report.stopReason = error.message;
    return report;
  }
  report.envelope = {
    goalId: envelope.goalId,
    goalRole: envelope.goalRole,
    workingLevel: envelope.workingLevel,
    contextId: envelope.contextId,
  };

  const domainId = envelope.trustedContext.domainFacts.domainId;
  const domainPack = getDomainPack(domainId);
  if (!domainPack) {
    report.stoppedAt = 'domain_pack';
    report.stopReason = `no domain pack is registered for domainId "${domainId}"`;
    return report;
  }

  const config = { requestId, candidateCount, generatedAt };
  let request;
  try {
    request = await buildGenerationRequest(envelope, domainPack, config);
  } catch (error) {
    report.stoppedAt = 'generation_request';
    report.stopReason = error.message;
    return report;
  }
  report.generationRequest = {
    requestId: request.requestId,
    domainId: request.domainId,
    candidateCount: request.candidateCount,
    blocked: request.blocked,
    blockedReasons: request.blockedReasons,
  };

  if (request.blocked) {
    report.stoppedAt = 'generation_request';
    report.stopReason = 'request.blocked === true';
    return report;
  }

  try {
    const briefs = planCandidateBriefs(request);
    report.candidateBriefs = briefs.map(summariseBrief);
  } catch (error) {
    report.stoppedAt = 'candidate_briefs';
    report.stopReason = error instanceof NoExecutableRouteError
      ? error.message
      : `unexpected planner error: ${error.message}`;
    return report;
  }

  return report;
}
