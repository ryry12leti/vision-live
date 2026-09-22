import { getDomainPack } from '../domain-packs/registry.js';
import { validateTrustedEvaluationContext } from '../mission-evaluator/candidate-contract.js';
import {
  assertValidTrustedContextAssemblyInput,
  deepFreeze,
  isAuthoritativeSourceType,
  isGoalRole,
  SOURCE_AUTHORITY_MATRIX,
  validateTrustedContextAssemblyInput,
} from './contract.js';
import {
  compareCanonicalRecords,
  comparableCapabilityProof,
  deriveBottleneck,
  deriveCapability,
  derivePreferences,
  isStaleRecord,
  newestFirst,
  normalizedEventTime,
  recomputeDerivedCapabilityState,
  staleRecords,
} from './derivations.js';

export const SOURCE_PRECEDENCE_RULES = Object.freeze({
  priority: Object.freeze([
    'explicit_user_decision',
    'active_qualified_external_plan',
    'recent_verified_proof_or_state',
    'older_verified_proof_or_state',
    'inferred_pattern',
    'unverified_or_ai_never',
  ]),
  goalAndChosenLevel: 'latest verified user decision for the exact goal',
  activeState: 'latest normalized event time; same-stream source sequence breaks exact-time ties',
  equalPriorityConflict: 'equal-priority disagreement returns exact fields and records with no context',
  externalProgramme: 'a replacement requires a separate exact-goal/exact-version user approval record',
  proofAndHistory: 'recent independent verified events outweigh older verified events',
  workingLevel: 'only capability authority can establish a baseline; 3-5 comparable results may raise it; never auto-lower',
  preference: 'explicit confirmation outranks at least three independent inferred events; tie-break only',
  crossGoal: 'records for another goal are rejected before any derivation',
});

const NON_AUTHORITATIVE_REASONS = Object.freeze({
  candidate_claim: 'Candidate-authored claims are not trusted context',
  ai_generated_prose: 'AI-generated prose is not verified fact',
  profile_text: 'Unverified profile text is not authoritative evidence',
});

function unique(values) {
  return [...new Set(values)];
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function sameFacts(left, right, fields) {
  const project = (record) => Object.fromEntries(
    fields.map((field) => [field, record.capturedFacts[field]]),
  );
  return JSON.stringify(stable(project(left))) === JSON.stringify(stable(project(right)));
}

function recordId(record) {
  return record.sourceRecordId;
}

function selectLatest(records, sourceTypes, requiredFields, conflicts, conflictLabel) {
  const candidates = newestFirst(records.filter((record) => (
    sourceTypes.includes(record.sourceType)
    && requiredFields.every((field) => Object.hasOwn(record.capturedFacts, field))
  )));
  if (candidates.length === 0) return null;
  const selected = candidates[0];
  const equalOrderDisagreement = candidates.find((record) => (
    recordId(record) !== recordId(selected)
    && normalizedEventTime(record).milliseconds === normalizedEventTime(selected).milliseconds
    && (
      record.provenance.streamId !== selected.provenance.streamId
      || record.sourceSequence === selected.sourceSequence
    )
    && !sameFacts(record, selected, requiredFields)
  ));
  if (equalOrderDisagreement) {
    const disagreeingFields = requiredFields.filter((field) => (
      JSON.stringify(stable(selected.capturedFacts[field]))
      !== JSON.stringify(stable(equalOrderDisagreement.capturedFacts[field]))
    ));
    conflicts.push({
      type: conflictLabel,
      fields: disagreeingFields,
      sourceRecordIds: [recordId(selected), recordId(equalOrderDisagreement)].sort(),
      eventIds: [selected.eventId, equalOrderDisagreement.eventId].sort(),
      explanation: `Equal-priority verified ${conflictLabel} records disagree`,
    });
    return null;
  }
  return selected;
}

function evidenceId(goalId, category) {
  return `trusted_context:${goalId}:${category}`;
}

function makeEvidence(goalId, category, facts, sources, currentSequence, attribution) {
  if (!sources.length) return null;
  const sourceIds = new Set(sources.map(recordId));
  const sourceFactPaths = new Map(sources.map((record) => [recordId(record), []]));
  for (const key of Object.keys(facts)) {
    const path = `capturedFacts.${key}`;
    const attributedRecords = attribution[key];
    if (!Array.isArray(attributedRecords) || attributedRecords.length === 0) {
      throw new Error(`Evidence fact ${category}.${key} has no explicit source attribution`);
    }
    for (const record of attributedRecords) {
      if (!sourceIds.has(recordId(record))) {
        throw new Error(`Evidence fact ${category}.${key} attributes a source outside the evidence source set`);
      }
      sourceFactPaths.get(recordId(record)).push(path);
    }
  }
  for (const record of sources) {
    sourceFactPaths.get(recordId(record)).push('capturedFacts.sourceRecordIds');
  }
  return {
    id: evidenceId(goalId, category),
    sourceType: 'trusted_context_assembler',
    verificationStatus: 'verified',
    capturedFacts: {
      ...facts,
      sourceRecordIds: unique(sources.map(recordId)).sort(),
    },
    sequence: Math.min(
      currentSequence,
      Math.max(...sources.map((record) => (
        Number.isInteger(record.sourceSequence) ? record.sourceSequence : currentSequence
      ))),
    ),
    relevanceCategory: category,
    metadata: {
      version: 2,
      sources: newestFirst(sources).map((record) => ({
        eventId: record.eventId,
        eventVersion: record.eventVersion,
        sourceRecordId: record.sourceRecordId,
        sourceType: record.sourceType,
        occurredAt: record.occurredAt,
        ingestedAt: record.occurredAt === null ? record.ingestedAt : null,
        provenanceAuthority: record.provenance.authority,
        provenanceReference: record.provenanceReference,
        independentSourceKey: [
          record.goalId,
          record.eventId,
          record.eventVersion,
          record.provenanceReference,
        ].join(':'),
        supportedFactPaths: unique(sourceFactPaths.get(recordId(record))).sort(),
      })),
    },
  };
}

function emptyResult(state, {
  evidenceRegistry = [],
  used = [],
  rejected = [],
  deduplicated = [],
  stale = [],
  conflicts = [],
  bottleneck = null,
  capability = null,
  decisions = [],
  questions = [],
  warnings = [],
} = {}) {
  return deepFreeze({
    assemblyState: state,
    trustedEvaluationContext: null,
    evidenceRegistry,
    sourceRecordsUsed: used,
    sourceRecordsRejected: rejected,
    deduplicatedRecords: deduplicated,
    staleEvidence: stale,
    conflicts,
    derivedBottleneck: bottleneck,
    derivedCapability: capability,
    personalisationDecisions: decisions,
    clarificationQuestions: unique(questions).slice(0, 5),
    warnings: unique(warnings),
  });
}

function rejectedRecord(record, reason) {
  return { sourceRecord: record, reason };
}

function classifyRejected(rejected, eligible, usedIds) {
  return [
    ...rejected,
    ...eligible
      .filter((record) => !usedIds.has(recordId(record)))
      .map((record) => rejectedRecord(
        record,
        'Authoritative record was superseded or was not selected for this assembly',
      )),
  ].sort((left, right) => (
    recordId(left.sourceRecord).localeCompare(recordId(right.sourceRecord))
    || left.reason.localeCompare(right.reason)
  ));
}

function sourceAuthorityRank(record) {
  if (record.sourceType === 'user_confirmed_goal' || record.sourceType === 'external_plan_approval') return 5;
  if (record.sourceType === 'external_programme') return 4;
  if (['verified_proof_result', 'professional_standard_evaluation',
    'verified_capability_assessment', 'completed_mission_history',
    'system_capability_state'].includes(record.sourceType)) return 3;
  if (isAuthoritativeSourceType(record.sourceType)) return 2;
  return 0;
}

const DUPLICATE_EVENT_FIELDS = Object.freeze([
  'sourceType',
  'capturedFacts',
  'normalizedEventTime.timestamp',
  'normalizedEventTime.basis',
  'eventVersion',
  'provenance.authority',
  'provenance.actorType',
  'provenance.referenceId',
  'provenance.streamId',
  'provenanceReference',
]);

function duplicateProjection(record) {
  const normalizedTime = normalizedEventTime(record);
  return {
    sourceType: record.sourceType,
    capturedFacts: stable(record.capturedFacts),
    normalizedEventTime: {
      timestamp: normalizedTime.timestamp,
      basis: normalizedTime.basis,
    },
    eventVersion: record.eventVersion,
    provenance: {
      authority: record.provenance.authority,
      actorType: record.provenance.actorType,
      referenceId: record.provenance.referenceId,
      streamId: record.provenance.streamId,
    },
    provenanceReference: record.provenanceReference,
  };
}

function duplicateConflictFields(left, right) {
  const leftProjection = duplicateProjection(left);
  const rightProjection = duplicateProjection(right);
  const read = (value, path) => path.split('.').reduce((current, key) => current?.[key], value);
  const fields = DUPLICATE_EVENT_FIELDS.filter((field) => (
    JSON.stringify(read(leftProjection, field)) !== JSON.stringify(read(rightProjection, field))
  ));
  if (left.provenance.streamId === right.provenance.streamId
    && left.sourceSequence !== right.sourceSequence) {
    fields.push('sourceSequence');
  }
  return fields;
}

function deduplicateEvents(records) {
  const byEvent = new Map();
  for (const record of records) {
    const key = `${record.goalId}\u0000${record.eventId}\u0000${record.eventVersion}`;
    if (!byEvent.has(key)) byEvent.set(key, []);
    byEvent.get(key).push(record);
  }
  const retained = [];
  const duplicates = [];
  const conflicts = [];
  for (const group of byEvent.values()) {
    const ordered = [...group].sort((left, right) => (
      sourceAuthorityRank(right) - sourceAuthorityRank(left)
      || compareCanonicalRecords(left, right)
    ));
    const selected = ordered[0];
    retained.push(selected);
    for (const duplicate of ordered.slice(1)) {
      const fields = duplicateConflictFields(selected, duplicate);
      if (fields.length > 0) {
        conflicts.push({
          type: 'duplicate event conflict',
          fields,
          sourceRecordIds: [recordId(selected), recordId(duplicate)].sort(),
          eventIds: [selected.eventId],
          eventVersion: selected.eventVersion,
          explanation: 'Records with the same event identity contain conflicting authoritative content',
        });
      } else {
        duplicates.push({
          sourceRecord: duplicate,
          retainedSourceRecordId: recordId(selected),
          eventId: selected.eventId,
          reason: 'Canonically equivalent representation of the same goalId/eventId/eventVersion; counted once',
        });
      }
    }
  }
  return {
    retained: newestFirst(retained),
    duplicates: duplicates.sort((left, right) => (
      left.eventId.localeCompare(right.eventId)
      || recordId(left.sourceRecord).localeCompare(recordId(right.sourceRecord))
    )),
    conflicts: conflicts.sort((left, right) => (
      left.eventIds[0].localeCompare(right.eventIds[0])
      || left.sourceRecordIds[0].localeCompare(right.sourceRecordIds[0])
    )),
  };
}

const DERIVATION_EVIDENCE_TYPES = new Set([
  'verified_proof_result',
  'verified_capability_assessment',
  'professional_standard_evaluation',
  'completed_mission_history',
]);

function invalidBaseline(reason, extra = {}) {
  return {
    valid: false,
    reason,
    sources: [],
    baseline: null,
    mismatchedFields: [],
    ...extra,
  };
}

function validateCapabilityBaseline(record, eligible, evaluationTime) {
  if (!record) return invalidBaseline('No authorized capability baseline exists');
  const facts = record.capturedFacts;
  if (!Array.isArray(facts.supportedMethodIds) || facts.supportedMethodIds.length === 0) {
    return invalidBaseline('Capability baseline must identify supported methods');
  }
  if (record.sourceType === 'verified_capability_assessment') {
    if (record.confidence === null || record.confidence < 0 || record.confidence > 1) {
      return invalidBaseline('Direct professional capability assessment requires bounded confidence');
    }
    if (!Number.isFinite(facts.workingLevel) || facts.workingLevel < 1 || facts.workingLevel > 100
      || !Number.isFinite(facts.maxEffortUnits) || facts.maxEffortUnits < facts.workingLevel
      || facts.maxEffortUnits > 100) {
      return invalidBaseline('Direct professional capability values violate strict contract bounds');
    }
    if (Array.isArray(facts.derivedFromEventIds) && facts.derivedFromEventIds.length > 0) {
      return invalidBaseline('Direct professional assessment cannot claim unrelated derivation events');
    }
    return {
      valid: true,
      reason: null,
      sources: [record],
      mode: 'direct_professional_assessment',
      baseline: {
        workingLevel: facts.workingLevel,
        maxEffortUnits: facts.maxEffortUnits,
        supportedMethodIds: [...facts.supportedMethodIds].sort(),
        confidence: record.confidence,
        evidenceCount: 1,
      },
      mismatchedFields: [],
    };
  }

  if (!Array.isArray(facts.derivedFromEventIds) || facts.derivedFromEventIds.length === 0) {
    return invalidBaseline('Derived capability baseline must reference real source events');
  }
  if (new Set(facts.derivedFromEventIds).size !== facts.derivedFromEventIds.length) {
    return invalidBaseline('Derived capability baseline repeats a derivation event');
  }
  if (facts.derivedFromEventIds.includes(record.eventId)) {
    return invalidBaseline('Capability baseline cannot derive from itself');
  }
  const sources = [];
  for (const eventId of facts.derivedFromEventIds) {
    const matches = eligible.filter((candidate) => (
      candidate.eventId === eventId
      && DERIVATION_EVIDENCE_TYPES.has(candidate.sourceType)
      && comparableCapabilityProof(candidate)
      && !isStaleRecord(candidate, evaluationTime)
    ));
    if (matches.length !== 1) {
      return invalidBaseline(
        `Capability derivation event ${eventId} is missing, ineligible, stale, unverified, cross-goal, or ambiguous`,
      );
    }
    sources.push(matches[0]);
  }
  const recomputed = recomputeDerivedCapabilityState(sources, evaluationTime);
  const assertedFields = ['workingLevel', 'maxEffortUnits', 'supportedMethodIds', 'confidence', 'evidenceCount'];
  const mismatchedFields = assertedFields.filter((field) => (
    JSON.stringify(stable(facts[field])) !== JSON.stringify(stable(recomputed[field]))
  ));
  if (!recomputed.justified) {
    return invalidBaseline(
      'Derived capability evidence does not meet the three-event comparable success threshold',
      { recomputed },
    );
  }
  if (mismatchedFields.length > 0) {
    return invalidBaseline(
      `Derived capability integrity assertions mismatch recomputed fields: ${mismatchedFields.join(', ')}`,
      { recomputed, mismatchedFields },
    );
  }
  return {
    valid: true,
    reason: null,
    sources,
    mode: 'derived_capability_state',
    baseline: recomputed,
    mismatchedFields: [],
  };
}

function collectFacts(records, field) {
  return unique(records.flatMap((record) => (
    Array.isArray(record.capturedFacts[field]) ? record.capturedFacts[field] : []
  )));
}

function buildRequiredQuestion(label) {
  return `What is the verified ${label} for this goal?`;
}

function contextContractWarning(errors) {
  return `Assembler output failed the evaluator contract: ${errors.join('; ')}`;
}

/**
 * Assemble the exact trusted context accepted by Checkpoint 2.6.
 */
export function assembleTrustedContext(input) {
  const contract = validateTrustedContextAssemblyInput(input);
  if (!contract.valid) {
    return emptyResult('clarification_required', {
      questions: contract.errors.map((error) => `Can you provide valid ${error}?`),
      warnings: contract.errors,
    });
  }
  assertValidTrustedContextAssemblyInput(input);

  const rejected = [];
  const goalScoped = [];
  for (const record of input.sourceRecords) {
    if (record.goalId !== input.goalId) {
      rejected.push(rejectedRecord(record, 'Record belongs to a different goal'));
    } else {
      goalScoped.push(record);
    }
  }
  const trustedGoalScoped = [];
  for (const record of goalScoped) {
    if (record.verificationStatus !== 'verified') {
      rejected.push(rejectedRecord(record, 'Record is not verified'));
    } else if (!isAuthoritativeSourceType(record.sourceType)) {
      rejected.push(rejectedRecord(
        record,
        NON_AUTHORITATIVE_REASONS[record.sourceType] || 'Source is not authoritative',
      ));
    } else {
      trustedGoalScoped.push(record);
    }
  }

  const {
    retained: deduplicatedGoalRecords,
    duplicates: deduplicated,
    conflicts: duplicateConflicts,
  } = deduplicateEvents(trustedGoalScoped);
  if (duplicateConflicts.length > 0) {
    return emptyResult('conflicting_evidence', {
      rejected,
      deduplicated,
      conflicts: duplicateConflicts,
      questions: ['Which authoritative record correctly represents the conflicting source event?'],
      warnings: ['Conflicting copies of one event identity cannot be silently deduplicated'],
    });
  }

  const eligible = newestFirst(deduplicatedGoalRecords);
  const stale = staleRecords(eligible, input.evaluationTime);
  const conflicts = [];
  const questions = [];
  const warnings = eligible
    .filter((record) => record.occurredAt === null)
    .map((record) => (
      `${recordId(record)} uses ingestedAt fallback because occurredAt is unavailable`
    ))
    .sort();
  const decisions = [];
  const usedIds = new Set();
  const markUsed = (...records) => records.filter(Boolean).forEach((record) => usedIds.add(recordId(record)));

  const goalRecord = selectLatest(
    eligible,
    ['user_confirmed_goal'],
    [
      'goalDescription',
      'goalCategory',
      'goalRole',
      'domainId',
      'chosenLevel',
      'pushLevel',
    ],
    conflicts,
    'goal decision',
  );
  if (!goalRecord) questions.push(buildRequiredQuestion('exact goal, role, and user-controlled levels'));

  const domainId = goalRecord?.capturedFacts.domainId;
  const pack = getDomainPack(domainId);
  if (domainId && !pack) {
    markUsed(goalRecord);
    return emptyResult('domain_not_ready', {
      used: eligible.filter((record) => usedIds.has(recordId(record))),
      rejected: classifyRejected(rejected, eligible, usedIds),
      deduplicated,
      stale,
      conflicts,
      questions: [`Which supported domain model should be used for ${domainId}?`],
      warnings: [`No canonical domain pack exists for ${domainId}`],
    });
  }

  const milestoneRecord = selectLatest(
    eligible,
    SOURCE_AUTHORITY_MATRIX.active_milestone,
    ['milestoneId', 'milestoneDescription', 'milestoneCategory'],
    conflicts,
    'active milestone',
  );
  if (!milestoneRecord) questions.push(buildRequiredQuestion('single active milestone'));

  const routeRecord = selectLatest(
    eligible,
    SOURCE_AUTHORITY_MATRIX.route_and_prerequisites,
    ['routeNodeId', 'allowedWorkUnitTypeIds'],
    conflicts,
    'active route',
  );
  if (!routeRecord) questions.push(buildRequiredQuestion('active route node'));

  const prerequisiteRecord = selectLatest(
    eligible,
    SOURCE_AUTHORITY_MATRIX.route_and_prerequisites,
    ['prerequisiteStatus', 'missingPrerequisiteIds'],
    conflicts,
    'prerequisite state',
  );
  if (!prerequisiteRecord) questions.push(buildRequiredQuestion('prerequisite state'));

  const externalProgrammes = newestFirst(eligible.filter((record) => (
    record.sourceType === 'external_programme'
    && [
      'programmeId',
      'programmeVersion',
      'programmeStage',
      'programmeExternal',
      'programmeRequiredAttributes',
      'planStatus',
      'visionAdditions',
    ].every((field) => Object.hasOwn(record.capturedFacts, field))
  )));
  const activeExternal = externalProgrammes.filter(
    (record) => record.capturedFacts.planStatus === 'active',
  );
  const proposedExternal = externalProgrammes.filter(
    (record) => record.capturedFacts.planStatus === 'proposed',
  );
  let programmeRecord = activeExternal[0] || selectLatest(
    eligible,
    ['professional_standard'],
    [
      'programmeId',
      'programmeVersion',
      'programmeStage',
      'programmeExternal',
      'programmeRequiredAttributes',
      'planStatus',
      'visionAdditions',
    ],
    conflicts,
    'programme',
  );
  if (activeExternal.length > 1) {
    const alternate = activeExternal.find((record) => !sameFacts(record, programmeRecord, [
      'programmeId', 'programmeVersion',
    ]));
    if (alternate) {
      conflicts.push({
        type: 'external programme',
        fields: ['programmeId', 'programmeVersion'],
        sourceRecordIds: [recordId(programmeRecord), recordId(alternate)].sort(),
        eventIds: [programmeRecord.eventId, alternate.eventId].sort(),
        explanation: 'Multiple active qualified external plans disagree',
      });
    }
  }
  if (programmeRecord && proposedExternal.length > 0) {
    const replacement = proposedExternal[0];
    const approvals = newestFirst(eligible.filter((record) => (
      SOURCE_AUTHORITY_MATRIX.external_plan_approval.includes(record.sourceType)
      && [
        'approvalId',
        'originalPlanId',
        'originalPlanVersion',
        'replacementPlanId',
        'replacementPlanVersion',
        'approvalScope',
        'approvalTime',
        'evidenceReference',
      ].every((field) => Object.hasOwn(record.capturedFacts, field))
    )));
    const matchingApproval = approvals.find((record) => (
      record.goalId === input.goalId
      && record.capturedFacts.originalPlanId === programmeRecord.capturedFacts.programmeId
      && record.capturedFacts.originalPlanVersion === programmeRecord.capturedFacts.programmeVersion
      && record.capturedFacts.replacementPlanId === replacement.capturedFacts.programmeId
      && record.capturedFacts.replacementPlanVersion === replacement.capturedFacts.programmeVersion
      && record.capturedFacts.approvalScope === 'replace_external_plan'
      && Date.parse(record.capturedFacts.approvalTime) <= Date.parse(input.evaluationTime)
    ));
    if (matchingApproval) {
      programmeRecord = replacement;
      markUsed(matchingApproval);
      decisions.push({
        type: 'external_plan_approval',
        decision: {
          approvalId: matchingApproval.capturedFacts.approvalId,
          originalPlanId: matchingApproval.capturedFacts.originalPlanId,
          replacementPlanId: matchingApproval.capturedFacts.replacementPlanId,
        },
        evidenceIds: [],
        explanation: 'Separate exact-goal and exact-version user approval authorizes replacement',
      });
    } else {
      conflicts.push({
        type: 'external programme approval',
        fields: ['goalId', 'originalPlanId', 'originalPlanVersion', 'replacementPlanId', 'replacementPlanVersion'],
        sourceRecordIds: [recordId(programmeRecord), recordId(replacement)].sort(),
        eventIds: [programmeRecord.eventId, replacement.eventId].sort(),
        preservedSourceRecordId: recordId(programmeRecord),
        explanation: 'Existing external plan preserved; proposed replacement lacks a matching separate approval',
      });
    }
  }
  if (!programmeRecord) questions.push(buildRequiredQuestion('current programme or qualified external plan'));

  const constraintRecord = selectLatest(
    eligible,
    SOURCE_AUTHORITY_MATRIX.safety_and_legality,
    [
      'forbiddenMethodIds',
      'forbiddenActionTypes',
      'illegalActionTypes',
      'medicalClearanceRequired',
      'medicalClearancePresent',
    ],
    conflicts,
    'safety constraints',
  );
  if (!constraintRecord) questions.push(buildRequiredQuestion('safety and legal constraints'));

  const scheduleRecord = selectLatest(
    eligible.filter((record) => (
      record.sourceType !== 'schedule'
      || record.capturedFacts.userLocalDate === input.userLocalDate
    )),
    SOURCE_AUTHORITY_MATRIX.time,
    ['availableMinutes', 'userLocalDate'],
    conflicts,
    'available time',
  );
  if (!scheduleRecord) questions.push(buildRequiredQuestion('available time today'));

  const resourceRecord = selectLatest(
    eligible,
    SOURCE_AUTHORITY_MATRIX.resources,
    ['resourceIds'],
    conflicts,
    'available resources',
  );
  if (!resourceRecord) questions.push(buildRequiredQuestion('available equipment and resources'));

  const recoveryRecord = selectLatest(
    eligible.filter((record) => (
      record.sourceType !== 'recovery_history'
      || record.capturedFacts.userLocalDate === input.userLocalDate
    )),
    SOURCE_AUTHORITY_MATRIX.recovery,
    ['recoveryStatus', 'recoveryMaxEffortUnits', 'userLocalDate'],
    conflicts,
    'recovery and readiness state',
  );
  if (!recoveryRecord) questions.push(buildRequiredQuestion('recovery and readiness state'));

  const domainRecord = selectLatest(
    eligible,
    SOURCE_AUTHORITY_MATRIX.domain_facts,
    ['domainId', 'domainFacts'],
    conflicts,
    'domain facts',
  );
  if (!domainRecord) questions.push(buildRequiredQuestion('domain-specific facts'));

  const progressRecords = newestFirst(eligible.filter((record) => (
    ['verified_proof_result', 'progress_history'].includes(record.sourceType)
    && Array.isArray(record.capturedFacts.signalIds)
  ))).slice(0, 5);
  if (progressRecords.length === 0) questions.push(buildRequiredQuestion('verified progress history'));

  const baselineCapabilityRecord = selectLatest(
    eligible,
    SOURCE_AUTHORITY_MATRIX.working_level_baseline,
    ['workingLevel', 'maxEffortUnits', 'supportedMethodIds'],
    conflicts,
    'capability baseline',
  );
  if (!baselineCapabilityRecord) questions.push(buildRequiredQuestion('capability baseline'));
  const baselineValidation = validateCapabilityBaseline(
    baselineCapabilityRecord,
    eligible,
    input.evaluationTime,
  );
  if (baselineCapabilityRecord && !baselineValidation.valid) {
    questions.push(`Which verified capability evidence replaces this baseline? ${baselineValidation.reason}`);
    warnings.push(baselineValidation.reason);
  }

  const proofAndCapabilityRecords = eligible.filter((record) => (
    [
      'verified_proof_result',
      'professional_standard_evaluation',
      'completed_mission_history',
    ].includes(record.sourceType)
  ));
  const baselineFacts = baselineValidation.valid ? baselineValidation.baseline : null;
  const capability = baselineFacts ? deriveCapability(proofAndCapabilityRecords, {
    sourceRecordId: recordId(baselineCapabilityRecord),
    chosenLevel: goalRecord?.capturedFacts.chosenLevel,
    pushLevel: goalRecord?.capturedFacts.pushLevel,
    workingLevel: baselineFacts.workingLevel,
    maxEffortUnits: baselineFacts.maxEffortUnits,
    supportedMethodIds: baselineFacts.supportedMethodIds,
  }, {
    chosenLevel: goalRecord?.capturedFacts.chosenLevel,
    pushLevel: goalRecord?.capturedFacts.pushLevel,
  }, input.evaluationTime) : null;
  if (capability && capability.supportedMethodIds.length === 0) {
    questions.push(buildRequiredQuestion('supported methods'));
  }

  const bottleneck = pack
    ? deriveBottleneck(eligible, pack.bottleneckCategories, input.evaluationTime)
    : null;
  if (bottleneck?.conflicting) {
    conflicts.push({
      type: 'active bottleneck',
      fields: ['bottleneckSignals'],
      sourceRecordIds: bottleneck.evidenceUsed,
      eventIds: bottleneck.eventIds,
      explanation: bottleneck.explanation,
    });
    questions.push('Which repeated weakness is the current active bottleneck?');
  } else if (bottleneck?.clarificationRequired) {
    questions.push('What repeated verified evidence identifies the current bottleneck?');
  }

  const preferences = derivePreferences(eligible, input.evaluationTime);

  const proofCapabilityRecord = selectLatest(
    eligible,
    SOURCE_AUTHORITY_MATRIX.proof_capability,
    [
      'supportedEvidenceTypeIds',
      'supportedProofModes',
      'supportedClaimCategories',
      'supportedOutputCategories',
      'availableCaptureCapabilities',
      'privacyRequirements',
      'redactionSupported',
      'rightsClearanceRequired',
      'permissionsConfirmed',
      'compatibleDomainIds',
      'technicalLimitations',
    ],
    conflicts,
    'proof capability',
  );
  if (!proofCapabilityRecord) questions.push(buildRequiredQuestion('proof capability state'));

  let semanticBlocking = false;
  if (goalRecord && !isGoalRole(goalRecord.capturedFacts.goalRole)) {
    questions.push('Is this goal Primary or Secondary?');
    warnings.push('Goal role must be primary or secondary');
    semanticBlocking = true;
  }
  if (goalRecord && pack && !pack.supportedGoalCategories.includes(goalRecord.capturedFacts.goalCategory)) {
    questions.push(`Which ${pack.domainId} goal category matches the exact goal?`);
    warnings.push('Goal category is not supported by the selected domain pack');
    semanticBlocking = true;
  }
  if (milestoneRecord && pack
    && !pack.milestoneCategories.includes(milestoneRecord.capturedFacts.milestoneCategory)) {
    questions.push(`Which ${pack.domainId} milestone category is active?`);
    warnings.push('Milestone category is not supported by the selected domain pack');
    semanticBlocking = true;
  }

  markUsed(
    goalRecord,
    milestoneRecord,
    routeRecord,
    prerequisiteRecord,
    programmeRecord,
    constraintRecord,
    scheduleRecord,
    resourceRecord,
    recoveryRecord,
    domainRecord,
    baselineCapabilityRecord,
    proofCapabilityRecord,
    ...baselineValidation.sources,
    ...progressRecords,
    ...eligible.filter((record) => bottleneck?.evidenceUsed.includes(recordId(record))),
    ...eligible.filter((record) => capability?.evidenceIds.includes(recordId(record))),
    ...eligible.filter((record) => preferences.evidenceIds.includes(recordId(record))),
  );
  const classifiedRejected = classifyRejected(rejected, eligible, usedIds);

  if (conflicts.length > 0) {
    return emptyResult('conflicting_evidence', {
      used: eligible.filter((record) => usedIds.has(recordId(record))),
      rejected: classifiedRejected,
      deduplicated,
      stale,
      conflicts,
      bottleneck,
      capability,
      decisions,
      questions,
      warnings,
    });
  }

  const required = [
    goalRecord,
    milestoneRecord,
    routeRecord,
    prerequisiteRecord,
    programmeRecord,
    constraintRecord,
    scheduleRecord,
    resourceRecord,
    recoveryRecord,
    domainRecord,
    baselineCapabilityRecord,
    baselineValidation.valid ? true : null,
    proofCapabilityRecord,
    progressRecords[0],
    bottleneck?.category ? true : null,
    capability?.supportedMethodIds.length ? true : null,
  ];
  if (required.some((value) => !value) || semanticBlocking) {
    const state = !bottleneck?.category ? 'insufficient_evidence' : 'clarification_required';
    return emptyResult(state, {
      used: eligible.filter((record) => usedIds.has(recordId(record))),
      rejected: classifiedRejected,
      deduplicated,
      stale,
      conflicts,
      bottleneck,
      capability,
      decisions,
      questions,
      warnings,
    });
  }

  const evidenceRegistry = [];
  const addEvidence = (category, facts, sources, attribution) => {
    const evidence = makeEvidence(input.goalId, category, facts, sources, input.currentSequence, attribution);
    if (evidence) evidenceRegistry.push(evidence);
    return evidence ? [evidence.id] : [];
  };
  const attributeAll = (facts, sources) => Object.fromEntries(
    Object.keys(facts).map((key) => [key, sources]),
  );

  const goalEvidenceIds = addEvidence('goal', {
    goalCategory: goalRecord.capturedFacts.goalCategory,
    goalDescription: goalRecord.capturedFacts.goalDescription,
    goalRole: goalRecord.capturedFacts.goalRole,
  }, [goalRecord], {
    goalCategory: [goalRecord],
    goalDescription: [goalRecord],
    goalRole: [goalRecord],
  });
  const milestoneEvidenceIds = addEvidence('milestone', {
    milestoneId: milestoneRecord.capturedFacts.milestoneId,
    milestoneCategory: milestoneRecord.capturedFacts.milestoneCategory,
    milestoneDescription: milestoneRecord.capturedFacts.milestoneDescription,
  }, [milestoneRecord], {
    milestoneId: [milestoneRecord],
    milestoneCategory: [milestoneRecord],
    milestoneDescription: [milestoneRecord],
  });
  const routeEvidenceIds = addEvidence('route', {
    routeNodeId: routeRecord.capturedFacts.routeNodeId,
    allowedWorkUnitTypeIds: routeRecord.capturedFacts.allowedWorkUnitTypeIds,
    prerequisiteStatus: prerequisiteRecord.capturedFacts.prerequisiteStatus,
    missingPrerequisiteIds: prerequisiteRecord.capturedFacts.missingPrerequisiteIds,
  }, unique([routeRecord, prerequisiteRecord]), {
    routeNodeId: [routeRecord],
    allowedWorkUnitTypeIds: [routeRecord],
    prerequisiteStatus: [prerequisiteRecord],
    missingPrerequisiteIds: [prerequisiteRecord],
  });
  // bottleneckCategory/bottleneckConfidence are computed by aggregating signals
  // across every bottleneckSources record; none of them is the "one" source,
  // so every evidence-used record is attributed to both derived facts.
  const bottleneckSources = eligible.filter((record) => bottleneck.evidenceUsed.includes(recordId(record)));
  const bottleneckEvidenceIds = addEvidence('bottleneck', {
    bottleneckCategory: bottleneck.category,
    bottleneckConfidence: bottleneck.confidence,
  }, bottleneckSources, attributeAll({ bottleneckCategory: 1, bottleneckConfidence: 1 }, bottleneckSources));
  const programmeEvidenceIds = addEvidence('programme', {
    programmeId: programmeRecord.capturedFacts.programmeId,
    programmeStage: programmeRecord.capturedFacts.programmeStage,
    programmeExternal: programmeRecord.capturedFacts.programmeExternal,
    requiredAttributes: programmeRecord.capturedFacts.programmeRequiredAttributes,
  }, [programmeRecord], {
    programmeId: [programmeRecord],
    programmeStage: [programmeRecord],
    programmeExternal: [programmeRecord],
    requiredAttributes: [programmeRecord],
  });
  // workingLevel/maxEffortUnits/supportedMethodIds are recomputed from the full
  // capability baseline + derivation evidence set; chosenLevel/pushLevel pass
  // through unchanged from the goal decision and are not capability-derived.
  const capabilityDerivedSources = unique([
    baselineCapabilityRecord,
    ...baselineValidation.sources,
    ...eligible.filter((record) => capability.evidenceIds.includes(recordId(record))),
  ]);
  const capabilitySources = unique([goalRecord, ...capabilityDerivedSources]);
  const capabilityEvidenceIds = addEvidence('capability', {
    supportedMethodIds: capability.supportedMethodIds,
    maxEffortUnits: capability.maxEffortUnits,
    workingLevel: capability.workingLevel,
    chosenLevel: capability.chosenLevel,
    pushLevel: capability.pushLevel,
  }, capabilitySources, {
    supportedMethodIds: capabilityDerivedSources,
    maxEffortUnits: capabilityDerivedSources,
    workingLevel: capabilityDerivedSources,
    chosenLevel: [goalRecord],
    pushLevel: [goalRecord],
  });
  const signalIds = collectFacts(progressRecords, 'signalIds');
  const completedClaimIds = collectFacts(progressRecords, 'supportedClaimIds');
  const completedOutputIds = collectFacts(progressRecords, 'outputIds');
  const claimSources = progressRecords.filter((record) => Object.hasOwn(record.capturedFacts, 'supportedClaimIds'));
  const outputSources = progressRecords.filter((record) => Object.hasOwn(record.capturedFacts, 'outputIds'));
  const progressEvidenceIds = addEvidence('progress', {
    signalIds,
    completedClaimIds,
    completedOutputIds,
  }, progressRecords, {
    signalIds: progressRecords,
    completedClaimIds: claimSources.length > 0 ? claimSources : progressRecords,
    completedOutputIds: outputSources.length > 0 ? outputSources : progressRecords,
  });
  const constraintEvidenceIds = addEvidence('constraints', {
    forbiddenMethodIds: constraintRecord.capturedFacts.forbiddenMethodIds,
    forbiddenActionTypes: constraintRecord.capturedFacts.forbiddenActionTypes,
    illegalActionTypes: constraintRecord.capturedFacts.illegalActionTypes,
    medicalClearanceRequired: constraintRecord.capturedFacts.medicalClearanceRequired,
    medicalClearancePresent: constraintRecord.capturedFacts.medicalClearancePresent,
  }, [constraintRecord], attributeAll({
    forbiddenMethodIds: 1,
    forbiddenActionTypes: 1,
    illegalActionTypes: 1,
    medicalClearanceRequired: 1,
    medicalClearancePresent: 1,
  }, [constraintRecord]));
  const availabilityEvidenceIds = addEvidence('availability', {
    availableMinutes: scheduleRecord.capturedFacts.availableMinutes,
    resourceIds: resourceRecord.capturedFacts.resourceIds,
  }, [scheduleRecord, resourceRecord], {
    availableMinutes: [scheduleRecord],
    resourceIds: [resourceRecord],
  });
  const recoveryEvidenceIds = addEvidence('recovery', {
    recoveryStatus: recoveryRecord.capturedFacts.recoveryStatus,
    maxEffortUnits: recoveryRecord.capturedFacts.recoveryMaxEffortUnits,
  }, [recoveryRecord], attributeAll({ recoveryStatus: 1, maxEffortUnits: 1 }, [recoveryRecord]));
  // preferredWorkUnitTypeIds/preferredMethodIds are learned from repeated
  // independent events (or one explicit confirmation); reference the whole
  // preference evidence set rather than any single record.
  const preferenceSources = eligible.filter((record) => preferences.evidenceIds.includes(recordId(record)));
  const preferenceEvidenceIds = addEvidence('preference', {
    preferredWorkUnitTypeIds: preferences.preferredWorkUnitTypeIds,
    preferredMethodIds: preferences.preferredMethodIds,
  }, preferenceSources, attributeAll({ preferredWorkUnitTypeIds: 1, preferredMethodIds: 1 }, preferenceSources));
  const proofCapabilityFacts = { ...proofCapabilityRecord.capturedFacts };
  const proofCapabilityEvidenceIds = addEvidence(
    'proof_capability',
    proofCapabilityFacts,
    [proofCapabilityRecord],
    attributeAll(proofCapabilityFacts, [proofCapabilityRecord]),
  );
  const domainFacts = {
    domainId,
    ...domainRecord.capturedFacts.domainFacts,
  };
  const domainEvidenceIds = addEvidence(
    'domain',
    domainFacts,
    [domainRecord],
    attributeAll(domainFacts, [domainRecord]),
  );

  const trustedEvaluationContext = {
    contextId: input.contextId,
    currentSequence: input.currentSequence,
    evaluationTime: input.evaluationTime,
    goal: {
      description: goalRecord.capturedFacts.goalDescription,
      category: goalRecord.capturedFacts.goalCategory,
      evidenceIds: goalEvidenceIds,
    },
    activeMilestone: {
      id: milestoneRecord.capturedFacts.milestoneId,
      description: milestoneRecord.capturedFacts.milestoneDescription,
      category: milestoneRecord.capturedFacts.milestoneCategory,
      evidenceIds: milestoneEvidenceIds,
    },
    routeNode: {
      id: routeRecord.capturedFacts.routeNodeId,
      allowedWorkUnitTypeIds: routeRecord.capturedFacts.allowedWorkUnitTypeIds,
      evidenceIds: routeEvidenceIds,
    },
    activeBottleneck: {
      description: bottleneck.explanation,
      category: bottleneck.category,
      evidenceIds: bottleneckEvidenceIds,
    },
    prerequisites: {
      status: prerequisiteRecord.capturedFacts.prerequisiteStatus,
      missingIds: prerequisiteRecord.capturedFacts.missingPrerequisiteIds,
      evidenceIds: routeEvidenceIds,
    },
    programme: {
      id: programmeRecord.capturedFacts.programmeId,
      stage: programmeRecord.capturedFacts.programmeStage,
      external: programmeRecord.capturedFacts.programmeExternal,
      requiredAttributes: programmeRecord.capturedFacts.programmeRequiredAttributes,
      evidenceIds: programmeEvidenceIds,
    },
    capability: {
      maxEffortUnits: capability.maxEffortUnits,
      supportedMethodIds: capability.supportedMethodIds,
      evidenceIds: capabilityEvidenceIds,
    },
    progress: {
      signalIds,
      evidenceIds: progressEvidenceIds,
    },
    proofCapability: {
      supportedEvidenceTypeIds: proofCapabilityRecord.capturedFacts.supportedEvidenceTypeIds,
      supportedProofModes: proofCapabilityRecord.capturedFacts.supportedProofModes,
      supportedClaimCategories: proofCapabilityRecord.capturedFacts.supportedClaimCategories,
      supportedOutputCategories: proofCapabilityRecord.capturedFacts.supportedOutputCategories,
      availableCaptureCapabilities: proofCapabilityRecord.capturedFacts.availableCaptureCapabilities,
      privacyRequirements: proofCapabilityRecord.capturedFacts.privacyRequirements,
      redactionSupported: proofCapabilityRecord.capturedFacts.redactionSupported,
      rightsClearanceRequired: proofCapabilityRecord.capturedFacts.rightsClearanceRequired,
      permissionsConfirmed: proofCapabilityRecord.capturedFacts.permissionsConfirmed,
      compatibleDomainIds: proofCapabilityRecord.capturedFacts.compatibleDomainIds,
      technicalLimitations: proofCapabilityRecord.capturedFacts.technicalLimitations,
      evidenceIds: proofCapabilityEvidenceIds,
    },
    constraints: {
      forbiddenMethodIds: constraintRecord.capturedFacts.forbiddenMethodIds,
      forbiddenActionTypes: constraintRecord.capturedFacts.forbiddenActionTypes,
      illegalActionTypes: constraintRecord.capturedFacts.illegalActionTypes,
      medicalClearanceRequired: constraintRecord.capturedFacts.medicalClearanceRequired,
      medicalClearancePresent: constraintRecord.capturedFacts.medicalClearancePresent,
      evidenceIds: constraintEvidenceIds,
    },
    availability: {
      availableMinutes: scheduleRecord.capturedFacts.availableMinutes,
      resourceIds: resourceRecord.capturedFacts.resourceIds,
      evidenceIds: availabilityEvidenceIds,
    },
    recovery: {
      status: recoveryRecord.capturedFacts.recoveryStatus,
      maxEffortUnits: recoveryRecord.capturedFacts.recoveryMaxEffortUnits,
      evidenceIds: recoveryEvidenceIds,
    },
    verifiedPreferences: {
      preferredWorkUnitTypeIds: preferences.preferredWorkUnitTypeIds,
      preferredMethodIds: preferences.preferredMethodIds,
      evidenceIds: preferenceEvidenceIds,
    },
    domainFacts: {
      domainId,
      facts: domainRecord.capturedFacts.domainFacts,
      evidenceIds: domainEvidenceIds,
    },
    evidenceRegistry,
  };

  decisions.push(
    {
      type: 'goal_ownership',
      decision: goalRecord.capturedFacts.goalRole,
      evidenceIds: goalEvidenceIds,
      explanation: `Context is isolated to the ${goalRecord.capturedFacts.goalRole} goal ${input.goalId}`,
    },
    {
      type: 'levels',
      decision: {
        chosenLevel: capability.chosenLevel,
        workingLevel: capability.workingLevel,
        pushLevel: capability.pushLevel,
      },
      evidenceIds: capabilityEvidenceIds,
      explanation: capability.explanation,
    },
    {
      type: 'execution_adaptation',
      decision: {
        maxEffortUnits: capability.maxEffortUnits,
        availableMinutes: scheduleRecord.capturedFacts.availableMinutes,
        resourceIds: resourceRecord.capturedFacts.resourceIds,
        recoveryStatus: recoveryRecord.capturedFacts.recoveryStatus,
      },
      evidenceIds: unique([
        ...capabilityEvidenceIds,
        ...availabilityEvidenceIds,
        ...recoveryEvidenceIds,
      ]),
      explanation: 'Execution depth and difficulty adapt to evidence; professional quality does not',
    },
    {
      type: 'preferences',
      decision: {
        preferredWorkUnitTypeIds: preferences.preferredWorkUnitTypeIds,
        preferredMethodIds: preferences.preferredMethodIds,
        strategicPriority: preferences.strategicPriority,
      },
      evidenceIds: preferenceEvidenceIds,
      explanation: preferences.explanation,
    },
    {
      type: 'external_plan',
      decision: {
        preserved: programmeRecord.capturedFacts.programmeExternal,
        programmeId: programmeRecord.capturedFacts.programmeId,
        stage: programmeRecord.capturedFacts.programmeStage,
        visionAdditions: programmeRecord.capturedFacts.visionAdditions,
      },
      evidenceIds: programmeEvidenceIds,
      explanation: programmeRecord.capturedFacts.programmeExternal
        ? 'Qualified external plan preserved; any VISION additions remain separately labelled'
        : 'Current VISION programme retained',
    },
  );

  const evaluatorContract = validateTrustedEvaluationContext(trustedEvaluationContext);
  if (!evaluatorContract.valid) {
    return emptyResult('clarification_required', {
      evidenceRegistry,
      used: eligible.filter((record) => usedIds.has(recordId(record))),
      rejected: classifiedRejected,
      deduplicated,
      stale,
      conflicts,
      bottleneck,
      capability,
      decisions,
      questions: evaluatorContract.errors.map((error) => `Can you clarify ${error}?`),
      warnings: [...warnings, contextContractWarning(evaluatorContract.errors)],
    });
  }

  const assemblyState = trustedEvaluationContext.recovery.status === 'recovery_required'
    ? 'recovery_required'
    : 'ready';
  if (stale.length > 0) warnings.push('Stale verified evidence was retained for audit but newer evidence took precedence');
  if (!preferences.learned) warnings.push('No preference is trusted without explicit confirmation or repeated evidence');

  return deepFreeze({
    assemblyState,
    trustedEvaluationContext,
    evidenceRegistry,
    sourceRecordsUsed: eligible.filter((record) => usedIds.has(recordId(record))),
    sourceRecordsRejected: classifiedRejected,
    deduplicatedRecords: deduplicated,
    staleEvidence: stale,
    conflicts,
    derivedBottleneck: bottleneck,
    derivedCapability: capability,
    personalisationDecisions: decisions,
    clarificationQuestions: [],
    warnings: unique(warnings),
  });
}
