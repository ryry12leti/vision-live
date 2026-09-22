/* Structured opportunity signals.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Qualification used to depend on prose. ranking.js matched a regex
 * (/booking|ordering|order|action|mobile|.../) against the free text of an
 * observation, so a candidate only ever scored if some upstream code had
 * written a sentence containing one of those words. The fixture provider
 * did exactly that ("...does not show a clear booking or ordering
 * action."); the real Google Places provider emitted no observations at
 * all. The consequence, measured on staging 2026-08-04, was
 * `{discovered: 20, deeplyResearched: 19, qualified: 0}` -- structurally, on
 * every real search, forever.
 *
 * A signal here is a typed, machine-checkable statement about a candidate,
 * carrying its own provenance. Scoring reads the STRUCTURE (kind, value,
 * evidenceStatus, confidence), never the wording. `detail` is generated FROM
 * the structure for humans to read, so no code can ever again make a
 * candidate qualify by choosing different words.
 *
 * THE HONESTY RULES, enforced by buildSignal():
 *   1. A signal is OBSERVED only when its claim was directly seen in a named
 *      public source (a Places field we actually received, an element we
 *      actually parsed out of a page we actually fetched).
 *   2. A signal is INFERRED only when it is derived from OBSERVED facts by a
 *      stated deterministic rule. It carries reduced confidence.
 *   3. Absence is UNKNOWN unless absence was genuinely established. "We could
 *      not fetch the site" is UNKNOWN. "We fetched and parsed the site and it
 *      contains no enquiry, booking, quote, order or contact route" is an
 *      OBSERVED absence. UNKNOWN never scores.
 *   4. No signal may be constructed to satisfy the scorer. There is no
 *      free-text input to any builder below -- every `detail` string is
 *      composed here from the structured value.
 */

export const OPPORTUNITY_SIGNAL_VERSION = 1;

export const SIGNAL_KINDS = Object.freeze([
  'listing',          // the business exists as a public listing
  'operating_status', // open / closed
  'category_fit',     // provider category vs the founder's target customer
  'location_fit',     // provider address vs the requested search scope
  'contactability',   // a public route to reach a human
  'conversion_path',  // how (or whether) the business can be transacted with
  'reputation',       // rating / review volume
  /* WHAT THEY ACTUALLY DO. Added for Practice: a receptionist at a dental
     practice who cannot say "we do implants and Invisalign" still sounds
     like a stranger to their own business, however good the research was.
     Additive only -- ranking.js reads kinds through signalsOfKind() and
     never enumerates this list, so no existing score can move. */
  'service_offering',
  /* ── First-party inbound kinds (B2C) ────────────────────────────────
     PURELY ADDITIVE, and deliberately so. ranking.js reads specific kinds
     through signalsOfKind() and never enumerates this list, so adding to it
     cannot move a single existing score — verified by the Opportunity
     Intelligence suite before and after.

     These describe things that happened on the founder's OWN property, which
     is why they can be OBSERVED at full confidence: the source is the
     founder's own record of the event rather than a third-party page. A
     B2C prospect scores through the same ranking and qualifies at the same
     30-point threshold as a business; only the evidence differs. */
  'inbound_activity', // an ad click, a return visit, a page view
  'inbound_intent',   // a quote view, a pricing view, a form submission
  'consent',          // an identified permission to make contact, and its scope
  /* WHO this is, when anyone established it. The lead hierarchy turns on
     exactly one question — did a person identify themselves — and that is a
     fact about an event, so it belongs in evidence rather than in a column
     somebody can set. Its `value` carries {entityType, identified}. */
  'identity',
]);

export const SIGNAL_EVIDENCE_STATUSES = Object.freeze(['OBSERVED', 'INFERRED', 'UNKNOWN']);

/* Conversion routes we can recognise structurally. Order is significance
   order, not preference: a booking engine is a stronger commercial signal
   than a bare contact page. These are ROUTE IDENTIFIERS, not search words --
   website-inspection.js maps real DOM/href evidence onto them, and nothing
   downstream ever re-reads them as text. */
export const CONVERSION_ROUTES = Object.freeze([
  'booking', 'ordering', 'quote', 'enquiry', 'contact_form', 'email', 'phone',
]);

export const CONTACT_CHANNELS = Object.freeze(['call', 'email', 'website_form', 'public_social', 'in_person']);

function iso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function clampConfidence(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0;
}

/** The single constructor. Every signal in the system is built here, so the
 * honesty rules above are structurally enforced rather than reviewed. */
/* Kinds whose evidence lives in the founder's OWN records rather than on a
   public page. The honesty rule is unchanged in substance — an OBSERVED claim
   must still name where it was seen — but for a form submission or a consent
   grant the place it was seen is an internal record, not a URL. Gated on the
   kind so the public kinds keep the public-URL requirement exactly.

   Anything first-party still has to produce a `sourceReference`; there is no
   path here to an OBSERVED signal that names no source at all. */
export const FIRST_PARTY_SIGNAL_KINDS = Object.freeze(['inbound_activity', 'inbound_intent', 'consent', 'identity']);

export function buildSignal({
  signalId, kind, evidenceStatus, confidence, sourceUrl = null, sourceReference = null, sourceType,
  researchMethod, checkedAt, value = {}, detail,
}) {
  if (!SIGNAL_KINDS.includes(kind)) throw new Error(`invalid_signal_kind:${kind}`);
  if (!SIGNAL_EVIDENCE_STATUSES.includes(evidenceStatus)) throw new Error(`invalid_signal_evidence_status:${evidenceStatus}`);
  if (typeof signalId !== 'string' || !signalId) throw new Error('invalid_signal_id');
  if (typeof detail !== 'string' || !detail) throw new Error('invalid_signal_detail');
  if (typeof sourceType !== 'string' || !sourceType) throw new Error('invalid_signal_source_type');
  if (typeof researchMethod !== 'string' || !researchMethod) throw new Error('invalid_signal_research_method');
  const when = iso(checkedAt);
  if (!when) throw new Error('invalid_signal_checked_at');
  // An OBSERVED signal must name the source it was observed in.
  // INFERRED/UNKNOWN may be sourceless because they are derivations, not
  // sightings.
  const firstParty = FIRST_PARTY_SIGNAL_KINDS.includes(kind);
  const publicSource = typeof sourceUrl === 'string' && /^https?:\/\//i.test(sourceUrl);
  const internalSource = typeof sourceReference === 'string' && sourceReference.trim().length > 0;
  if (evidenceStatus === 'OBSERVED') {
    if (firstParty && !publicSource && !internalSource) {
      throw new Error(`observed_first_party_signal_requires_source_reference:${signalId}`);
    }
    if (!firstParty && !publicSource) {
      throw new Error(`observed_signal_requires_public_source:${signalId}`);
    }
  }
  return Object.freeze({
    signalId,
    kind,
    evidenceStatus,
    confidence: evidenceStatus === 'UNKNOWN' ? 0 : clampConfidence(confidence),
    sourceUrl: publicSource ? sourceUrl : null,
    sourceReference: internalSource ? sourceReference.trim() : null,
    sourceType,
    researchMethod,
    checkedAt: when,
    value: value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {},
    detail,
  });
}

export function signalsOfKind(signals, kind) {
  return (signals || []).filter((signal) => signal && signal.kind === kind);
}

/** Weight a signal contributes: OBSERVED at full confidence, INFERRED at a
 * discount, UNKNOWN at nothing. Identical shape to the old
 * observationContribution() so the scoring scale is unchanged. */
export function signalWeight(signal) {
  if (!signal) return 0;
  const status = signal.evidenceStatus === 'OBSERVED' ? 1 : signal.evidenceStatus === 'INFERRED' ? 0.35 : 0;
  return status * clampConfidence(signal.confidence);
}

export function strongestWeight(signals) {
  const weights = (signals || []).map(signalWeight);
  return weights.length ? Math.max(...weights) : 0;
}

/* ── Token helpers ─────────────────────────────────────────────────────
   Shared by the structured category/location comparisons. These normalise
   real provider fields against real request fields; they are NOT a text
   search for magic words. */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'anywhere', 'australia', 'business', 'businesses', 'customer', 'customers',
  'for', 'in', 'local', 'of', 'online', 'or', 'prospect', 'prospects', 'the', 'to', 'with', 'that',
  'have', 'need', 'small', 'between', 'staff', 'my', 'your',
]);

function singular(word) {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

export function tokens(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map(singular)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/** Google Places `types` are snake_case enums (real_estate_agency,
 * doctor, gym, cafe). Expanding them into their component words lets a
 * founder's plain-English target ("real estate offices") match the enum
 * without any hand-maintained synonym table. */
export function typeTokens(types) {
  return [...new Set((Array.isArray(types) ? types : []).flatMap((type) => tokens(String(type).replace(/_/g, ' '))))];
}

export function tokenOverlap(left, right) {
  const wanted = new Set(Array.isArray(left) ? left : tokens(left));
  return [...new Set((Array.isArray(right) ? right : tokens(right)).filter((word) => wanted.has(word)))];
}
