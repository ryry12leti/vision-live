function normalize(value) {
  return String(value || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').replace(/[^a-z0-9]/g, '');
}

function keys(candidate) {
  return [
    candidate.externalProviderId && `provider:${candidate.provider}:${candidate.externalProviderId}`,
    candidate.officialWebsite && `domain:${normalize(candidate.officialWebsite)}`,
    candidate.name && candidate.address && `name-address:${normalize(candidate.name)}:${normalize(candidate.address)}`,
  ].filter(Boolean);
}

function stableCandidateKey(candidate) {
  return [candidate?.officialWebsite, candidate?.name, candidate?.address, candidate?.provider, candidate?.externalProviderId]
    .map(normalize).join('|');
}

/** The durable identity a business is upserted on across searches/reruns --
 * the highest-priority key from the same provider/domain/name+address
 * priority order deduplicateCandidates() already uses within one run, so a
 * business keeps the same database row whether it is rediscovered by the
 * same provider, a different provider, or the same provider on a later
 * date. Returns null only when a candidate has none of the three signals,
 * which should never happen for a provider-sourced or validated candidate. */
export function stableEntityIdentityKey(candidate) {
  return keys(candidate)[0] || null;
}

export function deduplicateCandidates(candidates) {
  const seen = new Map();
  const output = [];
  const ordered = [...(candidates || [])].sort((left, right) => stableCandidateKey(left).localeCompare(stableCandidateKey(right)));
  for (const candidate of ordered) {
    const candidateKeys = keys(candidate);
    const duplicateIndex = candidateKeys.map((key) => seen.get(key)).find((index) => index !== undefined);
    if (duplicateIndex !== undefined) {
      const existing = output[duplicateIndex];
      existing.sources = [...new Map([...(existing.sources || []), ...(candidate.sources || [])].map((source) => [source.url, source])).values()].sort((left, right) => String(left.url).localeCompare(String(right.url)));
      existing.providerAliases = [...new Set([...(existing.providerAliases || [existing.provider]), candidate.provider])].filter(Boolean).sort();
      for (const field of ['officialWebsite', 'publicPhone', 'publicEmail', 'contactFormUrl', 'publicSocialUrl', 'bookingUrl', 'mapUrl']) {
        if (!existing[field] && candidate[field]) existing[field] = candidate[field];
      }
      existing.deduplication = {
        status: 'merged_duplicate',
        mergedCandidateCount: (existing.deduplication?.mergedCandidateCount || 1) + 1,
        providerAliases: existing.providerAliases,
      };
      // Retain every alias key so a later record that matches only this duplicate
      // still joins the same canonical business instead of being scored again.
      [...candidateKeys, ...keys(existing)].forEach((key) => seen.set(key, duplicateIndex));
      continue;
    }
    const index = output.length;
    output.push({
      ...candidate,
      sources: [...(candidate.sources || [])],
      providerAliases: [...new Set(candidate.providerAliases || [candidate.provider].filter(Boolean))],
      deduplication: { status: 'unique', mergedCandidateCount: 1, providerAliases: [...new Set(candidate.providerAliases || [candidate.provider].filter(Boolean))] },
    });
    candidateKeys.forEach((key) => seen.set(key, index));
  }
  return output;
}
