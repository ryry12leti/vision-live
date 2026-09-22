/**
 * Confidence is derived from trusted evidence quality and evaluator agreement.
 */

const REQUIRED_EVIDENCE_CATEGORIES = Object.freeze([
  'goal',
  'milestone',
  'route',
  'bottleneck',
  'programme',
  'capability',
  'progress',
  'proof_capability',
  'constraints',
  'availability',
  'recovery',
]);

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function contextCompleteness(context) {
  const values = [
    context.goal.description,
    context.goal.category,
    context.activeMilestone.id,
    context.activeMilestone.category,
    context.routeNode.id,
    context.activeBottleneck.category,
    context.programme.id,
    context.programme.stage,
    context.capability.supportedMethodIds.length,
    context.availability.availableMinutes > 0,
    context.recovery.status,
    Object.keys(context.domainFacts.facts).length,
  ];
  return values.filter(Boolean).length / values.length;
}

export function calculateMissionConfidence(context, proposal, pack, domainRuleResults, evidence) {
  const evidenceCoverage = REQUIRED_EVIDENCE_CATEGORIES.filter(
    (category) => evidence.idsForContext(category).length > 0,
  ).length / REQUIRED_EVIDENCE_CATEGORIES.length;
  const recencyAndRelevance = evidence.recency();
  const completeness = contextCompleteness(context);
  const domainRuleCertainty = domainRuleResults.length
    ? domainRuleResults.reduce((sum, rule) => sum + (1 - rule.uncertainty), 0) / domainRuleResults.length
    : 0;
  const compatibleProof = evidence.proofCapabilityAssessment(pack).passed ? 1 : 0;
  const independentAgreement = evidence.independentAgreement();

  const factors = Object.freeze({
    verifiedEvidenceCoverage: round(evidenceCoverage),
    recencyAndRelevance: round(recencyAndRelevance),
    contextCompleteness: round(completeness),
    domainRuleCertainty: round(domainRuleCertainty),
    proofCompatibility: compatibleProof,
    independentEvidenceAgreement: round(independentAgreement),
  });

  return Object.freeze({
    confidence: round(
      (evidenceCoverage * 0.20)
      + (recencyAndRelevance * 0.25)
      + (completeness * 0.15)
      + (domainRuleCertainty * 0.15)
      + (compatibleProof * 0.10)
      + (independentAgreement * 0.15),
    ),
    factors,
  });
}
