/* ════════════════════════════════════════════════════════════════════════
   BUSINESS TRUTH — WHAT THE PERSON WHO ANSWERS ACTUALLY KNOWS.

   Practice has a good behaviour engine and an empty factual one. The
   prospect model is told the business NAME and nothing else true, while the
   scorer reads 1,007 grounded fact-instances it can never see. This compiles
   the second into something the first can say.

   IT PROJECTS FROM `value`, NEVER FROM `detail`. The stored detail strings
   are qualification rationale written for the founder's board, in VISION's
   voice, about VISION's search:

     "The listed address falls inside the requested search area."
     "The listed address matches 1 of 2 requested location terms."
     "Ardley Veterinary Clinic is a public listing with an official website."

   No receptionist has ever said any of those things about their own
   workplace. Handing them to the prospect would trade a generic simulation
   for an uncanny one. So every sentence below is composed HERE from the
   signal's structured `value`, by code, per kind -- the same discipline
   signals.js already imposes on its own builders: no free-text input, no
   model paraphrase, no LLM anywhere in this file.

   WHAT IT REFUSES. OBSERVED facts may be spoken. INFERRED may shape
   behaviour and is never stated as confirmed. An unhandled value shape is
   dropped rather than guessed at. Fixture and seed rows are excluded before
   anything else, because a prospect saying "SEEDED_TEST_FIXTURE" out loud is
   the worst outcome available here. Absent is unknown, and unknown is a
   thing the person simply does not know -- not a thing they refuse to say.

   WHAT IT DOES NOT DO. It does not read the database, choose what to
   disclose, or talk to the model. It is a pure projection: rows in, truth
   out. Wiring it to the disclosure ladder and the prompt is deliberately a
   later step, so the output can be proved correct on its own first.
   ══════════════════════════════════════════════════════════════════════ */

export const BUSINESS_TRUTH_VERSION = 'practice_business_truth_v1';

/* Depth reuses the disclosure ladder's own vocabulary rather than inventing
   a parallel one -- these values are what admissibleDisclosures() already
   gates on, so a compiled fact drops into the existing ladder unchanged. */
export const DEPTH = Object.freeze({ SURFACE: 'surface', OPERATIONAL: 'operational', SENSITIVE: 'sensitive' });

/* ── WHAT A FACT IS ABOUT, NOT WHAT WORDS IT CONTAINS ─────────────────
   The first integration suppressed an invented fact whenever a grounded one
   shared a topic KEYWORD, and the live corpus showed exactly why that is
   wrong: `contactability` and `conversion_path` both carry 'call', 'calls'
   and 'phone', so they silenced the invented facts about how MANY calls come
   in and WHO answers them -- and the prospect met the two commonest discovery
   questions in the corpus with "what is this regarding?".

   A channel fact proves HOW people make contact. It proves nothing about
   volume, staffing, whether calls are missed, or what that costs. So
   suppression now keys on the CLAIM a fact makes, declared explicitly here
   and never inferred from wording. Truth still outranks simulation; unrelated
   truth no longer erases it. */
export const DIMENSION = Object.freeze({
  CONTACT_CHANNEL: 'contact_channel',       // how people get in touch
  BOOKING_CHANNEL: 'booking_channel',       // whether an online route exists
  TEAM_SIZE: 'team_size',                   // how many of them there are
  CALL_VOLUME: 'call_volume',               // how much contact arrives
  CALL_HANDLER: 'call_handler',             // who picks it up
  MISSED_CONTACT: 'missed_contact',         // whether contact is lost
  OPERATIONAL_IMPACT: 'operational_impact', // what that costs them
  PREVIOUS_ATTEMPTS: 'previous_attempts',   // what they have already tried
  DECISION_AUTHORITY: 'decision_authority', // who signs it off
  WEB_PRESENCE: 'web_presence',             // whether they have a site
  LOCATION: 'location',
  OPERATING_STATUS: 'operating_status',
  SERVICES: 'services',                     // what they actually do
});

/* Ordered weakest to strongest. A fact's roleFloor is the LEAST senior person
   who would plausibly know it, so the ceiling test is "is this speaker at
   least that senior". */
export const ROLES = Object.freeze(['gatekeeper', 'employee', 'influencer', 'manager', 'decision_maker']);
const rank = (role) => {
  const i = ROLES.indexOf(String(role || '').trim());
  /* An unrecognised role is treated as the WEAKEST, not the strongest. A
     typo must not hand someone the commercial layer. */
  return i < 0 ? 0 : i;
};

/* ── THE FIXTURE GATE, FIRST AND WIDEST ───────────────────────────────
   Staging carries rows whose `value` names its own provenance --
   provider "seeded_test_fixture", externalProviderId "SEEDED_TEST_FIXTURE"
   or "qa-exa-why-now-fixture" -- and three OBSERVED observations whose text
   literally begins "SEEDED_TEST_FIXTURE:". The baseline pass caught only the
   text form; the marker is more often in the structured value, which is why
   this checks both and why it runs before any projection. */
const TRUSTED_PROVIDERS = Object.freeze(['google_places', 'official_website', 'public_web', 'first_party']);
const FIXTURE_RE = /fixture|seeded|^qa[-_]|sample_data|dummy/i;
const SEED_METHODS = Object.freeze(['manual_seed', 'fixture', 'seed']);

export function isFixtureRow(row = {}) {
  const v = row.value && typeof row.value === 'object' ? row.value : {};
  if (SEED_METHODS.includes(String(row.researchMethod || row.research_method || '').trim())) return true;
  if (FIXTURE_RE.test(String(v.provider || ''))) return true;
  if (FIXTURE_RE.test(String(v.externalProviderId || ''))) return true;
  if (FIXTURE_RE.test(String(row.detail || ''))) return true;
  if (FIXTURE_RE.test(String(row.exactObservation || row.exact_observation || ''))) return true;
  /* A provider we do not recognise is not automatically a fixture -- new real
     providers will appear -- but a provider that IS named and is not trusted
     is refused, so a future "test_provider" cannot arrive silently. */
  const p = String(v.provider || '').trim();
  if (p && !TRUSTED_PROVIDERS.includes(p)) return true;
  return false;
}

/* ── THE LEAK GUARD ───────────────────────────────────────────────────
   Belt and braces over the projection. Every sentence this file emits is
   composed from structured values, so seller-facing phrasing should be
   impossible by construction -- but "should be impossible by construction"
   is exactly the claim that has been wrong before in this codebase, and the
   cost of being wrong here is a prospect who sounds like a CRM. Any emitted
   text matching these is dropped and recorded, not shipped. */
const SELLER_VOICE = Object.freeze([
  /requested (search area|location terms?)/i,
  /matches? \d+ of \d+/i,
  /public listing/i,
  /established way to open a conversation/i,
  /\bthe listing\b/i,
  /\blisted as\b/i,
  /\bprospect\b|\bqualif/i,
  /search (area|scope|term)/i,
  /SEEDED|FIXTURE/i,
]);
const leaksSellerVoice = (text) => SELLER_VOICE.some((re) => re.test(String(text || '')));

/* ── PER-KIND PROJECTION ──────────────────────────────────────────────
   `read` pulls the structured facts and returns null when the shape is not
   one this file understands. Returning null is the whole safety property:
   the same kind arrives in several shapes (contactability as {phone,channel}
   and as {channel,present}; reputation as {rating,reviewCount} and as
   {rating,userRatingCount}), and an unrecognised shape must be DROPPED
   rather than guessed at, because a guess here is an invented fact.

   `say` composes first person from those facts and nothing else. It never
   sees `detail`.

   `topic` is what the ladder already matches on: whole words a founder
   actually used in the frozen corpus, not words I imagine they might use.
   The corpus vocabulary was collected in the baseline pass for exactly this.

   `roleFloor` is the least senior person who would know it. All six supported
   kinds are public surface facts a receptionist genuinely knows -- which is
   an honest limit of V1, not an oversight: nothing currently collected
   reaches operational or commercial depth.

   `speakable:false` means it may move behaviour and may never be stated. */
const KIND_SPEC = Object.freeze({

  conversion_path: {
    depth: DEPTH.SURFACE,
    roleFloor: 'gatekeeper',
    speakable: true,
    topic: ['enquiry', 'enquiries', 'inquiry', 'inquiries', 'form', 'website', 'site', 'online',
      'book', 'booking', 'get in touch', 'contact', 'come through', 'reach you', 'find you'],
    read(v) {
      if (Array.isArray(v.routes)) {
        const routes = v.routes.filter((r) => typeof r === 'string' && r.trim());
        /* An OBSERVED ABSENCE, and the most useful fact in the whole set: the
           site was actually read and carries no route. signals.js earns this
           deliberately ("we fetched and parsed the site and it contains no
           enquiry, booking, quote, order or contact route"), and it is the
           one fact that says something a founder can act on. */
        if (!routes.length) return v.inspected === true ? { none: true } : null;
        return { routes };
      }
      if (typeof v.route === 'string' && v.route.trim()) return { routes: [v.route.trim()] };
      return null;
    },
    /* A booking or enquiry route is a claim about the ONLINE channel; a bare
       phone route is a claim about how people make contact. An observed
       ABSENCE of routes is still a booking_channel claim -- it establishes
       there is no online route, which is the strongest thing this kind says. */
    dimension(f) {
      if (f.none) return [DIMENSION.BOOKING_CHANNEL];
      const online = ['enquiry', 'contact_form', 'form', 'booking', 'ordering', 'quote'];
      const dims = [];
      if (f.routes.some((r) => online.includes(r))) dims.push(DIMENSION.BOOKING_CHANNEL);
      if (f.routes.some((r) => ['phone', 'call', 'email'].includes(r))) dims.push(DIMENSION.CONTACT_CHANNEL);
      return dims.length ? dims : [DIMENSION.CONTACT_CHANNEL];
    },
    say(f) {
      if (f.none) return 'there is nothing on our website for getting in touch, so people ring us';
      const words = f.routes.map((r) => ({
        enquiry: 'the enquiry form', contact_form: 'the contact form', form: 'the form',
        booking: 'online booking', ordering: 'online ordering', quote: 'the quote form',
        email: 'email', phone: 'the phone', call: 'the phone',
      }[r] || null)).filter(Boolean);
      if (!words.length) return null;
      const list = words.length === 1 ? words[0]
        : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
      return `people reach us through ${list}`;
    },
  },

  /* ── WHAT THEY ACTUALLY DO ───────────────────────────────────────
     The gap this closes is the most obvious one in the product: ask a real
     receptionist what the practice offers and they answer instantly, from
     memory, without thinking of it as information. Before this, the compiler
     had no home for a service at all, so a perfectly researched list was
     dropped on the floor and the prospect sounded like a stranger.

     SURFACE and gatekeeper-floor on purpose. Services are on the front page
     of the website; knowing them is not privileged, and gating them behind
     trust would make the prospect coyer about public information than a real
     person is.

     The list is capped at three in the projection because a person names a
     couple and stops -- "implants, Invisalign, that sort of thing" -- and
     because the disclosure ladder's own per-turn cap should decide how much
     is said, not the length of whatever the website happened to list. */
  service_offering: {
    depth: DEPTH.SURFACE,
    roleFloor: 'gatekeeper',
    speakable: true,
    topic: ['do you do', 'do you offer', 'offer', 'services', 'service', 'treatments',
      'provide', 'specialise', 'specialize', 'what do you', 'work do you', 'kind of work'],
    read(v) {
      /* Two shapes, because the reader emits one claim per service but a
         provider batch may arrive as a list. Anything else returns null and
         is excluded as an unhandled shape rather than guessed at. */
      const raw = Array.isArray(v.services) ? v.services
        : (v.service ? [v.service] : (v.claim ? [v.claim] : null));
      if (!raw) return null;
      const services = raw
        .map((x) => String(x || '').trim().toLowerCase())
        .filter((x) => x.length > 1 && x.length <= 60);
      if (!services.length) return null;
      return { services: services.slice(0, 3) };
    },
    dimension: () => [DIMENSION.SERVICES],
    say: (f) => {
      const s = f.services;
      if (s.length === 1) return `we do ${s[0]}`;
      if (s.length === 2) return `we do ${s[0]} and ${s[1]}`;
      return `we do ${s[0]}, ${s[1]}, ${s[2]}, that sort of thing`;
    },
  },

  contactability: {
    depth: DEPTH.SURFACE,
    roleFloor: 'gatekeeper',
    speakable: true,
    topic: ['phone', 'call', 'calls', 'number', 'ring', 'reach you', 'get through', 'contact'],
    read(v) {
      const ch = String(v.channel || '').trim().toLowerCase();
      if (!ch) return null;
      /* The published phone NUMBER is deliberately not carried through. It is
         real and it is public, but a person does not recite their own
         switchboard number at a cold caller, and putting a live number in a
         model prompt is a privacy edge nobody needs. Channel only. */
      if (ch === 'call' || ch === 'phone') return { channel: 'phone' };
      if (ch === 'email') return { channel: 'email' };
      return null;
    },
    dimension: () => [DIMENSION.CONTACT_CHANNEL],
    say: (f) => (f.channel === 'phone'
      ? 'our phone line is the main way people get hold of us'
      : 'people mostly email us'),
  },

  listing: {
    depth: DEPTH.SURFACE,
    roleFloor: 'gatekeeper',
    speakable: true,
    topic: ['website', 'site', 'online', 'web', 'find you',
      /* staffCount answers a different question, and the ladder matches on
         these words, so they belong on the same kind rather than in a kind
         this vocabulary does not have. */
      'team', 'staff', 'people', 'many', 'size', 'who', 'how many'],
    read(v) {
      /* `listing` is an overloaded kind: it carries the directory record, the
         website flag, a staff count and, at UNKNOWN status, open questions.
         Each shape is read separately and anything else is dropped. */
      const staff = Number(v.staffCount);
      /* A real count from a real team page -- "The team page lists 34 staff".
         Worth having: it is the only currently collected fact that answers
         "how many of you are there", which the corpus shows founders asking. */
      if (Number.isFinite(staff) && staff > 0 && staff < 10000) return { staff };
      /* Only the website half of the directory record is prospect-usable. The
         {name, address, provider, externalProviderId} shape is VISION's own
         index entry -- a person does not describe themselves as a listing. */
      if (typeof v.website === 'string' && /^https?:\/\//i.test(v.website)) return { site: true };
      if (v.hasOfficialWebsite === true) return { site: true };
      return null;
    },
    /* staffCount is a headcount claim; the website flag is not. One kind,
       two different claims, so the dimension follows the value. */
    dimension: (f) => (f.staff ? [DIMENSION.TEAM_SIZE] : [DIMENSION.WEB_PRESENCE]),
    say: (f) => (f.staff
      ? `there are about ${f.staff} of us here`
      : 'we have got our own website'),
  },

  location_fit: {
    depth: DEPTH.SURFACE,
    roleFloor: 'gatekeeper',
    speakable: true,
    topic: ['where', 'based', 'located', 'area', 'address', 'town', 'city', 'local'],
    read(v) {
      /* The match arithmetic is VISION's, not the business's. The ADDRESS is
         the business's. Only the address crosses. */
      const raw = typeof v.address === 'string' ? v.address
        : (typeof v.matched === 'string' ? v.matched : '');
      const place = raw.trim();
      if (!place || place.length > 120) return null;
      return { place };
    },
    dimension: () => [DIMENSION.LOCATION],
    say: (f) => `we are based in ${f.place}`,
  },

  operating_status: {
    depth: DEPTH.SURFACE,
    roleFloor: 'gatekeeper',
    speakable: true,
    topic: ['open', 'trading', 'still', 'operating', 'running'],
    read(v) {
      if (v.operational === true || String(v.status || '').toLowerCase() === 'open') return { open: true };
      /* Closed/unknown is not projected. "We are not operating" is not a
         thing a person answering the phone would be saying. */
      return null;
    },
    dimension: () => [DIMENSION.OPERATING_STATUS],
    say: () => 'we are open and trading as normal',
  },

  reputation: {
    depth: DEPTH.SURFACE,
    roleFloor: 'gatekeeper',
    /* NOT SPEAKABLE, and this is a judgement worth defending. The rating is
       real, sourced and public -- but nobody answering a cold call recites
       their own Google score, and a prospect that does reads as a brochure.
       It earns its place by moving how they receive the call: a practice with
       500 five-star reviews is not anxious about new patients. Shaping only. */
    speakable: false,
    topic: [],
    read(v) {
      const rating = Number(v.rating);
      const count = Number(v.reviewCount != null ? v.reviewCount : v.userRatingCount);
      if (!Number.isFinite(rating) || rating <= 0) return null;
      return { rating, count: Number.isFinite(count) ? count : null };
    },
    /* Shaping only, so it claims nothing the simulation could contradict. */
    dimension: () => [],
    say: () => null,
  },

});

export const SUPPORTED_KINDS = Object.freeze(Object.keys(KIND_SPEC));

/* ── THE COMPILER ─────────────────────────────────────────────────────
   Pure. Same rows in, same truth out, in the same order -- no clock, no
   randomness, no I/O. Everything refused is recorded in `excluded` with a
   reason, because a fact that silently vanishes is indistinguishable from a
   fact that was never collected, and those need different fixes. */
export function compileBusinessTruth({
  signals = [], observations = [], contact = null, prospect = {},
} = {}) {
  const facts = [];
  const shaping = [];
  const constrains = [];
  const excluded = [];
  const drop = (row, reason) => excluded.push({
    id: row && (row.signalId || row.signal_id || row.id) || null,
    kind: (row && row.kind) || null, reason,
  });

  for (const row of Array.isArray(signals) ? signals : []) {
    if (!row || typeof row !== 'object') { drop(row, 'not_a_row'); continue; }
    const kind = String(row.kind || '').trim();
    const status = String(row.evidenceStatus || row.evidence_status || '').trim().toUpperCase();

    if (isFixtureRow(row)) { drop(row, 'fixture_or_seed'); continue; }
    const spec = KIND_SPEC[kind];
    /* Fail closed on vocabulary. An unsupported kind is not a smaller fact,
       it is a fact nobody has decided how to say. */
    if (!spec) { drop(row, 'unsupported_kind'); continue; }

    if (status !== 'OBSERVED' && status !== 'INFERRED') { drop(row, 'status_not_usable'); continue; }

    const v = row.value && typeof row.value === 'object' ? row.value : {};
    const read = spec.read(v);
    if (!read) { drop(row, 'unhandled_value_shape'); continue; }

    const source = row.sourceUrl || row.source_url || row.sourceReference || row.source_reference || null;
    /* The database already refuses an OBSERVED row with no source. Checking
       again costs nothing and means this file is safe to run over rows from
       anywhere, including a future importer that has not learned the rule. */
    if (status === 'OBSERVED' && !source) { drop(row, 'observed_without_source'); continue; }

    const base = {
      id: String(row.signalId || row.signal_id || `${kind}:${facts.length}`),
      kind,
      status,
      confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : null,
      sourceUrl: row.sourceUrl || row.source_url || null,
      sourceReference: row.sourceReference || row.source_reference || null,
      checkedAt: row.checkedAt || row.checked_at || null,
      depth: spec.depth,
      roleFloor: spec.roleFloor,
      topic: spec.topic.slice(),
      /* The claim this fact makes. Suppression keys on this, never on topic. */
      dimension: (spec.dimension ? spec.dimension(read) : []).slice(),
    };

    if (!spec.speakable) { shaping.push({ ...base, value: read }); continue; }

    /* INFERRED never becomes something the person asserts. It is kept, with
       its status, so a later layer can let it suppress an accusation or tilt
       behaviour -- which is exactly what the scorer already does with it. */
    if (status === 'INFERRED') { constrains.push({ ...base, value: read }); continue; }

    const text = spec.say(read);
    if (!text) { drop(row, 'no_projection_for_value'); continue; }
    if (leaksSellerVoice(text)) { drop(row, 'seller_voice_guard'); continue; }

    facts.push({ ...base, text });
  }

  /* Observations are carried for provenance only in V1. They share the
     signals' seller voice and have no per-kind structure to project from, so
     compiling them into speech would be exactly the mistake this file exists
     to avoid. */
  const observedCount = (Array.isArray(observations) ? observations : [])
    .filter((o) => o && !isFixtureRow(o)
      && String(o.evidenceStatus || o.evidence_status || '').toUpperCase() === 'OBSERVED').length;

  /* Stable order: kind, then id. Two identical inputs must produce byte
     identical output, because a compiler that reorders is a compiler whose
     diffs cannot be read. */
  const byKind = (a, b) => (a.kind === b.kind ? String(a.id).localeCompare(String(b.id))
    : a.kind.localeCompare(b.kind));
  facts.sort(byKind); shaping.sort(byKind); constrains.sort(byKind);

  /* TWO ROWS CAN SAY THE SAME THING. Staging really does hold contactability
     as both {phone,channel} and {channel,present} for one business: two
     genuine rows, two genuine sources, one identical sentence. Left alone the
     prospect holds the same fact twice and the ladder can offer it twice,
     which is exactly the repetition this work exists to remove.

     Deduplicated AFTER the sort, deliberately. Doing it during the read loop
     would make the surviving row depend on input order, so the same database
     rows arriving in a different order would compile to a different set of
     ids -- a compiler whose output depends on row order is one whose diffs
     cannot be trusted. */
  const deduped = [];
  const kept = new Set();
  for (const f of facts) {
    if (kept.has(f.text)) { excluded.push({ id: f.id, kind: f.kind, reason: 'duplicate_of_earlier_fact' }); continue; }
    kept.add(f.text);
    deduped.push(f);
  }
  facts.length = 0; facts.push(...deduped);

  return Object.freeze({
    version: BUSINESS_TRUTH_VERSION,
    identity: Object.freeze({
      name: typeof prospect.name === 'string' ? prospect.name : null,
      category: typeof prospect.industry === 'string' ? prospect.industry
        : (typeof prospect.businessType === 'string' ? prospect.businessType : null),
    }),
    personTruth: Object.freeze(contact ? {
      name: contact.personName || contact.name || null,
      publishedRole: contact.personRole || contact.role || null,
      /* Left exactly as the lead recorded it. The leads pipeline deliberately
         never claims authority from a job title, and this must not become the
         place that quietly does. */
      authorityKnown: contact.roleAuthorityKnown === true || contact.authorityKnown === true,
      sourceUrl: contact.sourceUrl || null,
    } : { name: null, publishedRole: null, authorityKnown: false, sourceUrl: null }),
    facts: Object.freeze(facts),
    shaping: Object.freeze(shaping),
    constrains: Object.freeze(constrains),
    excluded: Object.freeze(excluded),
    counts: Object.freeze({
      signalsIn: (signals || []).length,
      facts: facts.length,
      shaping: shaping.length,
      constrains: constrains.length,
      excluded: excluded.length,
      observationsObserved: observedCount,
    }),
  });
}

/* What this speaker is senior enough to know. Applied BEFORE the disclosure
   ladder's trust and attention gates, never merged with them: a receptionist
   who likes the caller still does not know the commercial layer, and folding
   role into trust is what produces the classic tell of rapport unlocking
   information the speaker would never hold. */
export function factsForRole(truth, role) {
  const r = rank(role);
  return ((truth && truth.facts) || []).filter((f) => rank(f.roleFloor) <= r);
}
