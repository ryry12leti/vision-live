/**
 * Integration collectors — Founder Venture State V2, task spec section
 * 4/E. These are INTERFACES, not full OAuth/API implementations: each
 * function accepts an already-observed, narrow summary object (what a real
 * GitHub/Supabase/Vercel/website/file integration would have fetched) and
 * maps it into facts + one connection-status fact for that provider. No
 * live network call, OAuth flow, or file parsing happens here.
 *
 * Every provider function ALSO returns a connection-status fact even when
 * nothing is connected (`connected: false`, `referenceId: null`) — this is
 * the "do not pretend an integration is connected when it is not"
 * requirement: absence of a summary is itself a genuine, honestly-reported
 * fact, not silence.
 */

import { buildFact } from '../fact-ledger.js';

function connectionFact({
  ventureId, userId, provider, connected, referenceId, occurredAt, sourceType,
}) {
  const factKey = `integration${provider[0].toUpperCase()}${provider.slice(1)}`;
  return buildFact({
    factId: `${sourceType}:${provider}:${occurredAt}`,
    ventureId,
    userId,
    factKey,
    value: { connected, lastSyncAt: connected ? occurredAt : null, referenceId: connected ? referenceId : null },
    sourceType,
    sourceReference: connected ? referenceId : `${provider}:not_connected`,
    occurredAt,
    recordedAt: occurredAt,
  });
}

/**
 * @param {object} params
 * @param {string} params.ventureId
 * @param {string} params.userId
 * @param {{defaultBranch: string, lastCommitAt: string, isPrivate: boolean, repoReference: string}|null} params.repoSummary Null when GitHub is not connected.
 * @param {string} params.occurredAt ISO timestamp of this observation.
 * @returns {object[]}
 */
export function buildGithubIntegrationFacts({
  ventureId, userId, repoSummary, occurredAt,
}) {
  const facts = [connectionFact({
    ventureId, userId, provider: 'github', connected: Boolean(repoSummary), referenceId: repoSummary?.repoReference ?? null, occurredAt, sourceType: 'github',
  })];
  if (repoSummary?.lastCommitAt) {
    facts.push(buildFact({
      factId: `github:${repoSummary.repoReference}:progress:${occurredAt}`,
      ventureId,
      userId,
      factKey: 'recentProgress',
      value: [`Repository activity observed as of ${repoSummary.lastCommitAt}`],
      sourceType: 'github',
      sourceReference: repoSummary.repoReference,
      occurredAt,
      recordedAt: occurredAt,
    }));
  }
  return facts;
}

/**
 * @param {{projectRef: string, tablesObserved: string[]}|null} params.projectSummary Null when not connected.
 */
export function buildSupabaseIntegrationFacts({
  ventureId, userId, projectSummary, occurredAt,
}) {
  return [connectionFact({
    ventureId, userId, provider: 'supabase', connected: Boolean(projectSummary), referenceId: projectSummary?.projectRef ?? null, occurredAt, sourceType: 'supabase',
  })];
}

/**
 * @param {{projectName: string, lastDeployAt: string}|null} params.deploySummary Null when not connected.
 */
export function buildVercelIntegrationFacts({
  ventureId, userId, deploySummary, occurredAt,
}) {
  const facts = [connectionFact({
    ventureId, userId, provider: 'vercel', connected: Boolean(deploySummary), referenceId: deploySummary?.projectName ?? null, occurredAt, sourceType: 'vercel',
  })];
  if (deploySummary?.lastDeployAt) {
    facts.push(buildFact({
      factId: `vercel:${deploySummary.projectName}:product_status:${occurredAt}`,
      ventureId,
      userId,
      factKey: 'productOrService',
      value: { status: 'live', description: `Deployed and last shipped ${deploySummary.lastDeployAt}` },
      sourceType: 'vercel',
      sourceReference: deploySummary.projectName,
      occurredAt,
      recordedAt: occurredAt,
    }));
  }
  return facts;
}

/**
 * @param {{url: string, checkedAt: string, hasPricingPage: boolean}|null} params.websiteSummary Null when no URL was ever provided.
 */
export function buildWebsiteIntegrationFacts({
  ventureId, userId, websiteSummary, occurredAt,
}) {
  const facts = [connectionFact({
    ventureId, userId, provider: 'website', connected: Boolean(websiteSummary), referenceId: websiteSummary?.url ?? null, occurredAt, sourceType: 'website',
  })];
  if (websiteSummary?.hasPricingPage) {
    // A pricing page existing is evidence of an OFFER PRICE being
    // published, never evidence about actual revenue earned -- no
    // hasRevenue/amount is fabricated here.
    facts.push(buildFact({
      factId: `website:${websiteSummary.url}:pricing_signal:${occurredAt}`,
      ventureId,
      userId,
      factKey: 'offerPricing',
      value: { pricingStatus: 'published', notes: 'observed on website (exact price unconfirmed)' },
      sourceType: 'website',
      sourceReference: websiteSummary.url,
      occurredAt,
      recordedAt: occurredAt,
      verificationStatus: 'provisional',
    }));
  }
  return facts;
}

/**
 * @param {{fileName: string, extractedText: string|null}|null} params.fileSummary Null when no file was uploaded.
 */
export function buildFileUploadIntegrationFacts({
  ventureId, userId, fileSummary, occurredAt,
}) {
  if (!fileSummary) return [];
  const facts = [];
  if (fileSummary.extractedText) {
    facts.push(buildFact({
      factId: `uploaded_file:${fileSummary.fileName}:${occurredAt}`,
      ventureId,
      userId,
      factKey: 'requestedHelp',
      value: fileSummary.extractedText.slice(0, 500),
      sourceType: 'uploaded_file',
      sourceReference: fileSummary.fileName,
      occurredAt,
      recordedAt: occurredAt,
      verificationStatus: 'provisional',
      metadata: { note: 'raw file contents are never stored beyond the safe, truncated extracted text' },
    }));
  }
  return facts;
}
