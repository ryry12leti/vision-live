export const SALES_PRACTICE_UNLOCK_THRESHOLD = 40;

export function evaluateSalesPractice(score, failedCategories = []) {
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('sales_practice_score_must_be_0_to_100');
  return score >= SALES_PRACTICE_UNLOCK_THRESHOLD
    ? { score, locked: false, outreachActionsAvailable: true, lesson: null, failedCategories: [], scoreType: 'sales_practice' }
    : { score, locked: true, outreachActionsAvailable: false, lesson: `Focus on ${failedCategories[0] || 'offer clarity'} and try one more practice attempt.`, failedCategories, scoreType: 'sales_practice' };
}

export function buildPracticeContracts(opportunity) {
  return {
    learning: { skillRequired: 'relevant outreach', commonMistakes: ['generic pitch', 'unsupported claims'], opportunityContext: opportunity.name, likelyObjections: [], practiceNeeds: ['explain the offer simply'] },
    professionalStandard: { selectedApproach: 'manual personalised outreach', researchExpectations: 'Use only the recorded public evidence', pitchStructure: ['relevant observation', 'clear offer', 'one next step'], discoveryQuestions: ['How do you handle this today?'], evidenceRequirements: ['record each outcome'], qualityBenchmark: 'Specific, respectful and evidence-backed' },
    liveIntelligence: {
      practiceScenario: `Contact ${opportunity.name}`,
      opportunityContext: opportunity.name,
      supportedModes: ['voice', 'text'],
      scoreLabel: 'Sales-Practice Score',
      outreachUnlockThreshold: SALES_PRACTICE_UNLOCK_THRESHOLD,
      readinessCategories: ['idea_quality', 'opportunity_understanding', 'offer_clarity', 'pitch_relevance', 'interpretation', 'speaking_clarity', 'tone', 'confidence', 'natural_delivery', 'discovery_questions', 'objection_handling', 'next_step'],
      prohibitedScoringFactors: ['accent', 'speech_difference', 'disability'],
    },
  };
}
