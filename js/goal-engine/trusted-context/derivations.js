/**
 * Deterministic evidence-only derivations. Records passed here have already
 * been goal-filtered, authority-checked, time-normalized, and event-deduped.
 */

const STALE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const COMPARABLE_WINDOW = 5;
const MIN_REPEATED_EVIDENCE = 3;

function unique(values) {
  return [...new Set(values)];
}

function recordId(record) {
  return record.sourceRecordId;
}

export function normalizedEventTime(record) {
  const value = record.occurredAt || record.ingestedAt;
  return {
    timestamp: value,
    milliseconds: Date.parse(value),
    basis: record.occurredAt ? 'occurredAt' : 'ingestedAt_fallback',
  };
}

export function compareCanonicalRecords(left, right) {
  const leftTime = normalizedEventTime(left).milliseconds;
  const rightTime = normalizedEventTime(right).milliseconds;
  const sameStream = left.provenance.streamId === right.provenance.streamId;
  return (
    rightTime - leftTime
    || (sameStream
      ? (right.sourceSequence ?? -1) - (left.sourceSequence ?? -1)
      : 0)
    || left.provenance.streamId.localeCompare(right.provenance.streamId)
    || left.eventId.localeCompare(right.eventId)
    || right.eventVersion - left.eventVersion
    || left.sourceRecordId.localeCompare(right.sourceRecordId)
  );
}

export function newestFirst(records) {
  return [...records].sort(compareCanonicalRecords);
}

export function staleRecords(records, evaluationTime) {
  const evaluationMs = Date.parse(evaluationTime);
  return newestFirst(records.filter((record) => (
    evaluationMs - normalizedEventTime(record).milliseconds > STALE_AGE_MS
  )));
}

export function isStaleRecord(record, evaluationTime) {
  return Date.parse(evaluationTime) - normalizedEventTime(record).milliseconds > STALE_AGE_MS;
}

export function comparableCapabilityProof(record) {
  const facts = record.capturedFacts;
  return typeof facts.comparisonGroup === 'string'
    && typeof facts.methodId === 'string'
    && Number.isFinite(facts.effortUnits)
    && Number.isFinite(facts.executionQuality)
    && Number.isFinite(facts.proofConfidence)
    && Number.isFinite(facts.professionalStandardScore)
    && typeof facts.assistanceRequired === 'boolean'
    && typeof facts.successful === 'boolean';
}

export function capabilityProofQuality(record) {
  const facts = record.capturedFacts;
  return (
    (facts.executionQuality * 0.35)
    + (facts.proofConfidence * 0.25)
    + (facts.professionalStandardScore * 0.30)
    + (facts.assistanceRequired ? 0 : 0.10)
  );
}

function weightedAverage(records, selector) {
  if (records.length === 0) return 0;
  let total = 0;
  let weights = 0;
  records.forEach((record, index) => {
    const weight = records.length - index;
    total += selector(record) * weight;
    weights += weight;
  });
  return total / weights;
}

export function deriveCapability(records, baseline, chosenLevels, evaluationTime) {
  const comparable = newestFirst(records.filter((record) => (
    comparableCapabilityProof(record) && !isStaleRecord(record, evaluationTime)
  ))).slice(0, COMPARABLE_WINDOW);
  const byGroup = new Map();
  for (const record of comparable) {
    const group = record.capturedFacts.comparisonGroup;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(record);
  }

  let bestRepeatedGroup = [];
  for (const groupRecords of byGroup.values()) {
    if (groupRecords.length > bestRepeatedGroup.length) bestRepeatedGroup = groupRecords;
  }
  const successful = bestRepeatedGroup.filter((record) => (
    record.capturedFacts.successful && capabilityProofQuality(record) >= 0.7
  ));
  const repeatedComparable = bestRepeatedGroup.length >= MIN_REPEATED_EVIDENCE;
  const repeatedSuccess = successful.length >= MIN_REPEATED_EVIDENCE;
  const demonstratedEffort = repeatedSuccess
    ? Math.floor(weightedAverage(successful, (record) => record.capturedFacts.effortUnits))
    : baseline.workingLevel;
  const workingLevel = Math.max(baseline.workingLevel, demonstratedEffort);
  const methods = unique([
    ...baseline.supportedMethodIds,
    ...bestRepeatedGroup
      .filter((record) => record.capturedFacts.successful && capabilityProofQuality(record) >= 0.65)
      .map((record) => record.capturedFacts.methodId),
  ]);
  const confidence = repeatedSuccess
    ? Math.min(0.95, weightedAverage(successful, capabilityProofQuality))
    : comparable.length >= 2 ? 0.6 : 0.4;

  return {
    workingLevel,
    previousWorkingLevel: baseline.workingLevel,
    chosenLevel: chosenLevels.chosenLevel,
    pushLevel: chosenLevels.pushLevel,
    maxEffortUnits: Math.max(baseline.maxEffortUnits, workingLevel),
    supportedMethodIds: methods,
    evidenceIds: bestRepeatedGroup.map(recordId),
    baselineEvidenceId: baseline.sourceRecordId,
    comparableEvidenceCount: bestRepeatedGroup.length,
    repeatedComparable,
    increased: workingLevel > baseline.workingLevel,
    decreased: false,
    confidence: Math.round(confidence * 100) / 100,
    explanation: workingLevel > baseline.workingLevel
      ? `Working Level increased from ${baseline.workingLevel} to ${workingLevel} after ${successful.length} independent comparable verified results`
      : `Working Level remains ${baseline.workingLevel}; chosen settings, recovery, and isolated results cannot set or reduce it`,
  };
}

/**
 * Independently recompute the integrity assertions in a system-derived
 * capability state. The derived record contributes no floor of its own.
 */
export function recomputeDerivedCapabilityState(records, evaluationTime) {
  const comparable = newestFirst(records.filter((record) => (
    comparableCapabilityProof(record) && !isStaleRecord(record, evaluationTime)
  )));
  const byGroup = new Map();
  for (const record of comparable) {
    const group = record.capturedFacts.comparisonGroup;
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(record);
  }
  const rankedGroups = [...byGroup.values()].sort((left, right) => (
    right.length - left.length
    || left[0].capturedFacts.comparisonGroup.localeCompare(right[0].capturedFacts.comparisonGroup)
  ));
  const group = rankedGroups[0] || [];
  const successful = group.filter((record) => (
    record.capturedFacts.successful
    && capabilityProofQuality(record) >= 0.7
  ));
  const justified = successful.length >= MIN_REPEATED_EVIDENCE;
  const workingLevel = justified
    ? Math.floor(weightedAverage(successful, (record) => record.capturedFacts.effortUnits))
    : 1;
  const supportedMethodIds = justified
    ? unique(successful.map((record) => record.capturedFacts.methodId)).sort()
    : [];
  const confidence = justified
    ? Math.round(Math.min(0.95, weightedAverage(successful, capabilityProofQuality)) * 100) / 100
    : 0;
  return {
    workingLevel,
    maxEffortUnits: workingLevel,
    supportedMethodIds,
    confidence,
    evidenceCount: group.length,
    evidenceIds: group.map((record) => record.eventId).sort(),
    justified,
  };
}

const BOTTLENECK_SOURCE_TYPES = new Set([
  'verified_proof_result',
  'progress_history',
  'missed_task_history',
  'professional_standard_evaluation',
  'completed_mission_history',
]);

export function deriveBottleneck(records, supportedCategories, evaluationTime) {
  const evaluationMs = Date.parse(evaluationTime);
  const eligible = newestFirst(records.filter((record) => (
    BOTTLENECK_SOURCE_TYPES.has(record.sourceType)
    && !isStaleRecord(record, evaluationTime)
  )));
  const aggregates = new Map();
  for (const record of eligible) {
    const signals = Array.isArray(record.capturedFacts.bottleneckSignals)
      ? record.capturedFacts.bottleneckSignals.filter((value) => supportedCategories.includes(value))
      : [];
    for (const category of signals) {
      if (!aggregates.has(category)) {
        aggregates.set(category, {
          category, count: 0, weight: 0, evidenceIds: [], eventIds: [], sourceTypes: new Set(),
        });
      }
      const aggregate = aggregates.get(category);
      const ageMs = Math.max(0, evaluationMs - normalizedEventTime(record).milliseconds);
      const recency = Math.max(0.2, 1 - (ageMs / STALE_AGE_MS));
      aggregate.count += 1;
      aggregate.weight += recency * (record.confidence ?? 0.7);
      aggregate.evidenceIds.push(recordId(record));
      aggregate.eventIds.push(record.eventId);
      aggregate.sourceTypes.add(record.sourceType);
    }
  }

  const ranked = [...aggregates.values()].sort((left, right) => (
    right.weight - left.weight || right.count - left.count || left.category.localeCompare(right.category)
  ));
  const strongest = ranked[0] || null;
  if (!strongest || strongest.count < 2) {
    return {
      category: null,
      explanation: 'No bottleneck has repeated independent verified-event support',
      evidenceUsed: [],
      eventIds: [],
      confidence: strongest ? 0.4 : 0,
      clarificationRequired: true,
      conflicting: false,
    };
  }
  const runnerUp = ranked[1];
  const conflicting = Boolean(
    runnerUp && runnerUp.count >= 2 && Math.abs(strongest.weight - runnerUp.weight) < 0.15
  );
  return {
    category: conflicting ? null : strongest.category,
    explanation: conflicting
      ? `Repeated evidence supports both ${strongest.category} and ${runnerUp.category} nearly equally`
      : `${strongest.category} is supported by ${strongest.count} independent verified events`,
    evidenceUsed: conflicting
      ? unique([...strongest.evidenceIds, ...runnerUp.evidenceIds])
      : unique(strongest.evidenceIds),
    eventIds: conflicting
      ? unique([...strongest.eventIds, ...runnerUp.eventIds])
      : unique(strongest.eventIds),
    confidence: conflicting ? 0.45 : strongest.count >= 3 ? 0.9 : 0.72,
    clarificationRequired: conflicting,
    conflicting,
  };
}

export function derivePreferences(records, evaluationTime) {
  const eligible = newestFirst(records.filter((record) => record.sourceType === 'verified_preference'));
  const explicit = eligible.filter((record) => record.capturedFacts.explicitlyConfirmed === true);
  const considered = explicit.length > 0
    ? explicit.slice(0, 1)
    : eligible.filter((record) => !isStaleRecord(record, evaluationTime));
  const threshold = explicit.length > 0 ? 1 : MIN_REPEATED_EVIDENCE;
  const workUnitCounts = new Map();
  const methodCounts = new Map();

  for (const record of considered) {
    for (const id of record.capturedFacts.preferredWorkUnitTypeIds || []) {
      workUnitCounts.set(id, (workUnitCounts.get(id) || 0) + 1);
    }
    for (const id of record.capturedFacts.preferredMethodIds || []) {
      methodCounts.set(id, (methodCounts.get(id) || 0) + 1);
    }
  }
  const selectedWorkUnits = [...workUnitCounts]
    .filter(([, count]) => count >= threshold).map(([id]) => id).sort();
  const selectedMethods = [...methodCounts]
    .filter(([, count]) => count >= threshold).map(([id]) => id).sort();
  const used = considered.filter((record) => (
    (record.capturedFacts.preferredWorkUnitTypeIds || []).some((id) => selectedWorkUnits.includes(id))
    || (record.capturedFacts.preferredMethodIds || []).some((id) => selectedMethods.includes(id))
  ));

  return {
    preferredWorkUnitTypeIds: selectedWorkUnits,
    preferredMethodIds: selectedMethods,
    evidenceIds: used.map(recordId),
    eventIds: used.map((record) => record.eventId),
    explicit: explicit.length > 0,
    learned: selectedWorkUnits.length > 0 || selectedMethods.length > 0,
    explanation: selectedWorkUnits.length || selectedMethods.length
      ? explicit.length
        ? 'Explicit user-confirmed preferences retained'
        : 'Preferences learned from at least three independent verified events'
      : 'No preference met the explicit-confirmation or independent-event threshold',
    strategicPriority: 'tie_break_only',
  };
}
