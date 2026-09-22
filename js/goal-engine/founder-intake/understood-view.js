/**
 * Founder Intake — "VISION Understood" display view.
 *
 * Turns fact-ledger.js's rebuilt perKey map (+ the entity collections) into
 * the exact labelled Known/Inferred/Unknown rows the UI shows -- never a
 * fourth state, never an inference disguised as a verified fact (task
 * rule). `status` is derived purely from the live fact's verificationStatus
 * (see fact-ledger.js's AUTHORITY_RANK): 'provisional' is always Inferred,
 * everything at user_confirmed or above is Known, absent is Unknown.
 */

const DISPLAY_FIELDS = Object.freeze([
  { label: 'Founder goal', key: 'immediateGoal' },
  { label: 'Venture type', key: 'businessModelFamily' },
  { label: 'Service or product', key: 'idea' },
  { label: 'Target customer & market', key: 'targetCustomer' },
  { label: 'Current business stage', key: 'currentStage' },
  { label: 'Current offer', key: 'offer' },
  { label: 'Offer pricing', key: 'offerPricing' },
  { label: 'Completed work', key: 'completedWork' },
  { label: 'Unfinished work', key: 'unfinishedWork' },
  { label: 'Current bottleneck', key: 'currentBottleneck' },
  { label: 'Customer evidence', key: 'customerEvidence' },
  { label: 'Resources available', key: 'availableResourceIds' },
  { label: 'Constraints', key: 'constraints' },
]);

function sourceLabel(sourceReference) {
  if (!sourceReference) return 'Provided by you';
  if (sourceReference === 'intake_goal_statement') return 'Your goal statement';
  if (sourceReference === 'intake_progress_statement') return "What you said you've already done";
  if (sourceReference.startsWith('intake_clarification:')) return 'Your answer to a clarification question';
  if (sourceReference.startsWith('intake_confirm')) return 'Confirmed by you';
  if (sourceReference.startsWith('intake_correction')) return 'Corrected by you';
  return 'Provided by you';
}

function statusFor(verificationStatus) {
  if (verificationStatus === 'provisional' || verificationStatus === 'disputed') return 'inferred';
  return 'known';
}

/**
 * @param {Record<string, object>} perKey rebuildStateFromFacts(...).perKey
 * @param {{customerEntities: object[]}} [entityCollections] buildEntityCollections(...)'s result, for the reachable-prospects row.
 * @returns {{label: string, key: string, status: 'known'|'inferred'|'unknown', value: unknown, source: string|null}[]}
 */
export function buildUnderstoodView(perKey, entityCollections = { customerEntities: [] }) {
  const rows = DISPLAY_FIELDS.map(({ label, key }) => {
    const fact = perKey[key];
    if (!fact) return {
      label, key, status: 'unknown', value: null, source: null,
    };
    return {
      label, key, status: statusFor(fact.verificationStatus), value: fact.value, source: sourceLabel(fact.sourceReference),
    };
  });

  const prospects = entityCollections.customerEntities || [];
  rows.push({
    label: 'Reachable prospects',
    key: 'customerEntities',
    status: prospects.length > 0 ? (prospects.every((p) => p.verificationStatus === 'provisional') ? 'inferred' : 'known') : 'unknown',
    value: prospects.length > 0 ? prospects.map((p) => p.value.safeDisplayLabel) : null,
    source: prospects.length > 0 ? sourceLabel(prospects[0].provenance) : null,
    /* The display row above is labels only, which left the client unable to
       confirm ONE specific prospect: `confirm: ['customerEntities']` fans out
       to every prospect (founder-intake-shared.mjs applyConfirmation), and
       inventing an id from the `intake_prospect_N` pattern would be fabricating
       data. This carries the real, already-recorded identity of each prospect
       alongside its label so the caller can confirm exactly the one the user
       actually vouched for. Still-provisional entries are marked because those
       are the only ones a confirmation can change. */
    entities: prospects.map((p) => ({
      entityId: p.entityId,
      factKey: `customerEntity:${p.entityId}`,
      label: p.value.safeDisplayLabel,
      contactability: p.value.contactability,
      verificationStatus: p.verificationStatus,
      confirmable: p.verificationStatus === 'provisional' && p.value.contactability === 'reachable',
    })),
  });

  return rows;
}
