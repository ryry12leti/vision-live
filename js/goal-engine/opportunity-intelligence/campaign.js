import { evaluateOpportunityEligibility } from './eligibility.js';
import { SALES_PRACTICE_UNLOCK_THRESHOLD } from './sales-practice.js';

export function selectOutreachBatch({ opportunities, founderLevel = 'beginner', salesPracticeScore, availableMinutes = 30, personalisationRequired = true, ventureId, userId, now = new Date().toISOString() }) {
  if (!Number.isFinite(salesPracticeScore) || salesPracticeScore < SALES_PRACTICE_UNLOCK_THRESHOLD) {
    return { locked: true, assigned: [], reason: 'sales_practice_below_40', scoreType: 'sales_practice' };
  }
  const contactEligible = opportunities.filter((item) => evaluateOpportunityEligibility(item, { salesPracticeScore, ventureId, userId, now }).contactEligible).slice(0, 20);
  const levelCap = founderLevel === 'experienced' ? 8 : founderLevel === 'developing' ? 5 : 3;
  const timeCap = Math.max(1, Math.floor(availableMinutes / (personalisationRequired ? 8 : 5)));
  const size = Math.min(contactEligible.length, levelCap, timeCap);
  return { locked: false, assigned: contactEligible.slice(0, size), campaignLimit: 20, scoreType: 'sales_practice', completionDefinition: 'Contact every business in the assigned batch using the approved approach and record the outcome of each attempt.' };
}
