import { assertRankingShape, LEAD_QUALIFICATION_THRESHOLD } from './ranking.js';
import { SALES_PRACTICE_UNLOCK_THRESHOLD } from './sales-practice.js';

export const OPPORTUNITY_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

function latestEvidenceTime(opportunity) {
  const values = [
    opportunity.lastCheckedAt,
    ...(opportunity.observations || []).map((item) => item.checkedAt),
  ].map((value) => Date.parse(value)).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

export function evaluateOpportunityEligibility(opportunity, {
  salesPracticeScore = null,
  ventureId,
  userId,
  now = new Date().toISOString(),
} = {}) {
  if (typeof ventureId !== 'string' || ventureId.length === 0) throw new Error('eligibility_requires_ventureId');
  if (typeof userId !== 'string' || userId.length === 0) throw new Error('eligibility_requires_userId');

  const reasons = [];
  const observedEvidenceCount = (opportunity?.observations || []).filter((item) => item.evidenceStatus === 'OBSERVED').length;
  const latestCheckedAtMs = latestEvidenceTime(opportunity || {});
  const nowMs = Date.parse(now);
  const fresh = latestCheckedAtMs !== null && Number.isFinite(nowMs) && nowMs - latestCheckedAtMs <= OPPORTUNITY_STALE_AFTER_MS && nowMs >= latestCheckedAtMs;
  const opportunityScore = opportunity?.ranking?.dimensions?.opportunityScore;
  const rankingValid = assertRankingShape(opportunity?.ranking);
  const observedOpportunityEvidenceCount = rankingValid ? opportunity.ranking.qualification.observedOpportunityEvidenceCount : 0;
  const scoreQualified = rankingValid && Number.isFinite(opportunityScore) && opportunityScore >= LEAD_QUALIFICATION_THRESHOLD && opportunityScore <= 100;
  const qualified = rankingValid && opportunity?.ranking?.qualified === true && scoreQualified;
  const approved = opportunity?.state === 'approved';
  const rejected = ['rejected', 'replaced'].includes(opportunity?.state);
  const duplicate = Boolean(opportunity?.duplicateOf) || opportunity?.deduplication?.status === 'duplicate_rejected';
  const rightVenture = opportunity?.ventureId === ventureId;
  const rightUser = opportunity?.userId === userId;
  const activePrimaryVenture = opportunity?.ventureLifecycleStatus === 'active' && opportunity?.ventureRole === 'primary';
  const salesPracticePassed = Number.isFinite(salesPracticeScore) && salesPracticeScore >= SALES_PRACTICE_UNLOCK_THRESHOLD && salesPracticeScore <= 100;

  if (!approved) reasons.push(rejected ? 'lead_rejected' : 'approval_required');
  if (!rankingValid) reasons.push('invalid_opportunity_ranking');
  if (!scoreQualified) reasons.push('opportunity_score_below_30');
  if (!qualified) reasons.push('qualification_required');
  if (observedEvidenceCount === 0) reasons.push('observed_evidence_required');
  if (observedOpportunityEvidenceCount === 0) reasons.push('observed_opportunity_evidence_required');
  if (!fresh) reasons.push(latestCheckedAtMs === null ? 'freshness_unknown' : 'stale_evidence');
  if (duplicate) reasons.push('duplicate_opportunity');
  if (!rightUser) reasons.push('wrong_user_owner');
  if (!rightVenture) reasons.push('wrong_venture_owner');
  if (!activePrimaryVenture) {
    if (opportunity?.ventureRole === 'secondary') reasons.push('secondary_venture_blocked');
    else if (['paused', 'archived'].includes(opportunity?.ventureLifecycleStatus)) reasons.push(`${opportunity.ventureLifecycleStatus}_venture_blocked`);
    else reasons.push('active_primary_venture_required');
  }

  const trustedBase = approved && !rejected && qualified && observedEvidenceCount > 0 && observedOpportunityEvidenceCount > 0 && fresh && !duplicate && rightUser && rightVenture && activePrimaryVenture;
  const hasPublicContactChannel = (opportunity?.contactChannels || []).length > 0;
  const campaignEligible = trustedBase && hasPublicContactChannel;
  const contactEligible = campaignEligible && salesPracticePassed;
  const campaignReasons = [...reasons, ...(!hasPublicContactChannel ? ['public_contact_channel_required'] : [])];
  const outreachReasons = [...campaignReasons, ...(!salesPracticePassed ? ['sales_practice_below_40'] : [])];

  return {
    approved,
    qualified,
    opportunityScore: Number.isFinite(opportunityScore) ? opportunityScore : null,
    leadQualificationThreshold: LEAD_QUALIFICATION_THRESHOLD,
    fresh,
    observedEvidenceCount,
    observedOpportunityEvidenceCount,
    memoryEligible: trustedBase,
    founderEligible: trustedBase,
    campaignEligible,
    contactEligible,
    salesPracticePassed,
    reasons: [...new Set(reasons)],
    campaignReasons: [...new Set(campaignReasons)],
    outreachReasons: [...new Set(outreachReasons)],
  };
}
