/* ════════════════════════════════════════════════════════════════════════
   PROSPECT IDENTITY LOCK — IS THE RESEARCH ABOUT THE BUSINESS ON SCREEN?

   `practice_sessions.prospect_ref` is plain text with no foreign key, no
   CHECK and no trigger, and the Practice path never reads
   opportunity_entities at all. So today the server proves the SESSION
   belongs to the caller and then speaks whatever facts that id happens to
   point at — without ever comparing them to the business whose name is
   about to come out of the prospect's mouth.

   That is not an exploit. A stale board row, a bug in the sessionStorage
   handoff, or two prospects open in two tabs produces it, and both rows
   pass RLS because both belong to the same founder. The founder then hears
   Business B's opening hours under Business A's name and has no way to know.

   Research makes this worse, not better: the richer the evidence, the more
   convincing the wrong business becomes. So the lock lands BEFORE the
   Gemini work, not after.

   PURE. No I/O. The caller supplies the entity row it read; this file only
   decides whether the three identities agree.

   FAILS CLOSED. Only MATCHED may carry research into a call. Every other
   verdict yields no facts — the prospect falls back to knowing nothing,
   which is the honest state we already shipped, rather than to knowing
   somebody else's business.
   ══════════════════════════════════════════════════════════════════════ */

export const IDENTITY = Object.freeze({
  MATCHED: 'MATCHED',
  AMBIGUOUS: 'AMBIGUOUS',
  MISMATCH: 'MISMATCH',
  INSUFFICIENT: 'INSUFFICIENT_IDENTITY',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Normalise a trading name for comparison. Deliberately aggressive on
   punctuation and legal suffixes, because "Quay Dental" and "Quay Dental
   Pty Ltd." are the same business, and deliberately NOT aggressive on
   words, because "City Dental" and "City Dental Market Street" are not. */
const LEGAL_SUFFIX = /\b(pty|ltd|limited|llc|inc|incorporated|plc|gmbh|bv|srl|co|company|group|holdings)\b/g;
export function normaliseName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(LEGAL_SUFFIX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* The registrable domain, not the URL. The existing dedup key is a full
   normalised URL including its path, which splits one business across two
   rows the moment a trailing path changes — so a URL comparison here would
   inherit that bug. Host only, `www.` stripped. */
export function registrableDomain(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  let host = '';
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch { return ''; }
  return host.toLowerCase().replace(/^www\./, '');
}

/* Locality comparison is intentionally weak evidence: a formatted address
   is free text and reformats constantly. It can CORROBORATE a name match
   and it can raise ambiguity, but it may never be the only thing that
   matches, and a difference alone never condemns. */
function localityTokens(address) {
  return new Set(String(address ?? '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2));
}
function localityOverlap(a, b) {
  const A = localityTokens(a); const B = localityTokens(b);
  if (!A.size || !B.size) return null;
  let hit = 0; for (const t of A) if (B.has(t)) hit += 1;
  return hit / Math.min(A.size, B.size);
}

/**
 * Reconcile the three identities that must agree before research may speak.
 *
 * @param {object} args
 * @param {string} args.prospectRef   practice_sessions.prospect_ref
 * @param {string} args.sessionName   practice_sessions.prospect_name (what the founder sees)
 * @param {object} args.entity        the opportunity_entities row actually read for prospectRef
 * @param {object} [args.handoff]     the client's claimed prospect {name, website, address}
 * @returns {{status, confidence, basis: string[], matchedOn: string[], conflicts: string[]}}
 */
export function reconcileProspectIdentity({ prospectRef, sessionName, entity, handoff = null, siblingNames = null } = {}) {
  const basis = []; const matchedOn = []; const conflicts = [];
  const verdict = (status, confidence) => Object.freeze({
    status, confidence, basis: Object.freeze(basis.slice()),
    matchedOn: Object.freeze(matchedOn.slice()), conflicts: Object.freeze(conflicts.slice()),
  });

  const ref = String(prospectRef ?? '').trim();
  if (!ref) { basis.push('no prospect_ref on the session'); return verdict(IDENTITY.INSUFFICIENT, 'high'); }
  if (!UUID_RE.test(ref)) { basis.push('prospect_ref is not a uuid'); return verdict(IDENTITY.INSUFFICIENT, 'high'); }

  /* THE ROW MUST EXIST AND MUST BE THE ONE ASKED FOR. A caller that reads
     by id and then does not check the id it got back has proved nothing;
     this is the check the Practice path is missing entirely today. */
  if (!entity || typeof entity !== 'object') {
    basis.push('no opportunity entity resolved for prospect_ref');
    return verdict(IDENTITY.INSUFFICIENT, 'high');
  }
  const entityId = String(entity.id ?? entity.entity_id ?? '').trim();
  if (!entityId) { basis.push('entity row carries no id'); return verdict(IDENTITY.INSUFFICIENT, 'high'); }
  if (entityId.toLowerCase() !== ref.toLowerCase()) {
    basis.push('entity row id does not equal the prospect_ref it was read for');
    conflicts.push('entity_id');
    return verdict(IDENTITY.MISMATCH, 'high');
  }
  matchedOn.push('entity_id');

  /* ── NAME. The session name is what the founder is looking at, so a
        disagreement here is exactly the wrong-business case. */
  const sName = normaliseName(sessionName);
  const eName = normaliseName(entity.name ?? entity.business_name);
  const hName = normaliseName(handoff?.name);

  if (!sName && !hName) {
    basis.push('session carries no prospect name to compare');
    return verdict(IDENTITY.INSUFFICIENT, 'medium');
  }
  const claimed = sName || hName;
  if (!eName) {
    basis.push('entity row has no name to compare against');
    return verdict(IDENTITY.INSUFFICIENT, 'medium');
  }

  const nameExact = claimed === eName;
  /* Containment is NOT a match. "City Dental" is contained in "City Dental
     Market Street" and they are different rows in this very database. It is
     recorded as ambiguity so a second signal has to settle it. */
  const nameContained = !nameExact && (claimed.includes(eName) || eName.includes(claimed));

  /* ── DOMAIN. The strongest corroborator available, and the one a founder
        can least plausibly have wrong by accident. */
  const eDomain = registrableDomain(entity.official_website ?? entity.website ?? entity.websiteUri);
  const hDomain = registrableDomain(handoff?.website ?? handoff?.websiteUri);
  const domainAgrees = !!eDomain && !!hDomain && eDomain === hDomain;
  const domainConflicts = !!eDomain && !!hDomain && eDomain !== hDomain;

  if (domainConflicts) {
    basis.push(`official website domain differs: entity ${eDomain} vs handoff ${hDomain}`);
    conflicts.push('domain');
    return verdict(IDENTITY.MISMATCH, 'high');
  }

  /* ── SESSION NAME vs ENTITY NAME is the decisive pair. A name that is
        neither equal nor a containment of the entity's name means the
        session is showing one business and the row describes another. */
  if (!nameExact && !nameContained) {
    basis.push(`session name "${claimed}" does not correspond to entity name "${eName}"`);
    conflicts.push('name');
    return verdict(IDENTITY.MISMATCH, 'high');
  }

  if (domainAgrees) matchedOn.push('domain');

  const overlap = localityOverlap(
    handoff?.address ?? handoff?.location?.label,
    entity.location?.label ?? entity.address,
  );
  if (overlap !== null && overlap >= 0.5) matchedOn.push('locality');
  else if (overlap !== null && overlap < 0.2) {
    basis.push('address tokens barely overlap');
    conflicts.push('locality');
  }

  /* ── THE RULE: NEVER NAME ALONE — CORRECTLY SCOPED ────────────────
     An earlier version demanded a second anchor from the HANDOFF, and that
     was wrong in a way only real data showed: production handoffs carry
     `{name}` and nothing else, so every genuine session resolved AMBIGUOUS
     and research would have switched OFF everywhere. Every gate missed it
     because they all supplied a website the real client never sends.

     What actually guards the wrong-business case is that the session name
     and the entity name are TWO INDEPENDENT RECORDS -- practice_sessions
     and opportunity_entities are written by different paths at different
     times -- and they are compared here for the first time. The genuinely
     dangerous case is not "only a name matched"; it is "this name matches
     more than one business". That is a uniqueness question, so the caller
     may supply the other entity names in the venture and a collision
     downgrades to AMBIGUOUS. Absent that list we say so in the basis
     rather than pretending the check happened. */
  const corroborators = matchedOn.filter((m) => m !== 'entity_id').length;
  const collides = Array.isArray(siblingNames)
    && siblingNames.map(normaliseName).filter((n) => n && n === eName).length > 1;

  if (collides) {
    basis.push('another entity in this venture normalises to the same name');
    conflicts.push('name_collision');
    return verdict(IDENTITY.AMBIGUOUS, 'high');
  }

  if (nameExact && conflicts.length === 0) {
    basis.push(corroborators >= 1
      ? 'exact name agreement plus an independent anchor'
      : 'exact name agreement between the session and the entity row');
    if (!Array.isArray(siblingNames)) basis.push('name uniqueness within the venture was not checked');
    return verdict(IDENTITY.MATCHED, corroborators >= 1 ? 'high' : 'medium');
  }
  if (nameExact) {
    basis.push('exact name but corroborating evidence conflicts');
    return verdict(IDENTITY.AMBIGUOUS, 'medium');
  }

  /* Containment: same family of names, different specificity. Only a
     domain match can rescue it. */
  if (nameContained && domainAgrees) {
    basis.push('name is a containment but the official domain agrees exactly');
    return verdict(IDENTITY.MATCHED, 'medium');
  }
  basis.push(`name "${claimed}" only partially corresponds to "${eName}" and no domain confirms it`);
  return verdict(IDENTITY.AMBIGUOUS, 'medium');
}

/** The single gate every research consumer must pass through. */
export function researchMayBeUsed(identity) {
  return !!identity && identity.status === IDENTITY.MATCHED;
}
