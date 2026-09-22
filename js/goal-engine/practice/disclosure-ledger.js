/* ════════════════════════════════════════════════════════════════════════
   WHAT THIS PROSPECT COULD TELL YOU, AND WHAT IT COSTS TO GET IT.

   MEASURED, NOT ASSUMED. A 40-turn corpus through the shipped prompt put a
   5-gram from one turn into another turn 50% of the time, and the worst
   offender was a refusal: "we're not looking to change anything this time of
   year" and its near-twins, six times over. The prompt already TOLD the
   model not to do that -- SPEECH_TEXTURE says "never refuse twice in the
   same words" -- and it did it anyway.

   That is the finding this file exists for. A model with nothing specific to
   say will reach for the same sentence however firmly you ask it not to.
   Repetition is not a wording problem to be instructed away; it is what
   happens when there is no CONTENT to spend. So the prospect gets facts.

   NOT AN UNLOCK LADDER. The tempting design is a number: trust > 0.6 reveals
   fact 3. That teaches a founder to grind trust rather than to ask well, and
   it is exactly the gameable shape this product exists to avoid. Nothing is
   released unless the founder ASKED ABOUT IT -- relevance is necessary in
   every case, and no amount of rapport substitutes for it. Depth is then
   gated on whether the last answer was actually used, on trust, and on
   whether the prospect has the attention to elaborate.

   REUSES WHAT EXISTS. Facts are drawn from the Controlled Uncertainty
   variation already chosen for the call; attention comes from Situation
   State; trust and "did they build on the answer" come from the behaviour
   engine. No personality model, no second mood system, no new state.
   ══════════════════════════════════════════════════════════════════════ */

import { disclosureDepthGateOf, resolveIntensity } from './practice-intensity.js';

export const DISCLOSURE_LEDGER_VERSION = 'practice_disclosure_ledger_v1';

/* Depth is about how much it costs the prospect to say a thing out loud, not
   about how interesting it is. Surface is what anyone would tell a stranger;
   sensitive is what you tell someone who has earned a straight answer. */
export const DEPTH = Object.freeze({ SURFACE: 'surface', OPERATIONAL: 'operational', SENSITIVE: 'sensitive' });

const seeded = (seed) => {
  const s = String(seed == null ? 'x' : seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
};

/* ── THE FACTS, AS NOTES ──────────────────────────────────────────────
   MEASURED THE HARD WAY. The first version wrote these as finished
   sentences -- "The phones are busiest late morning and around five." -- and
   the after-corpus came back with that exact clause in four separate turns
   and total 5-gram repetition WORSE than before the ledger existed. Giving a
   model a quotable line gets the line quoted, however firmly the prompt says
   "in your own words". The canned refusal had simply been traded for a
   canned fact.

   So they are notes now, not utterances: lower case, no full stops, phrased
   as something jotted down rather than something said. A note has to be
   turned into speech before it can be spoken, and that turning is where the
   variation comes from.

   ── THE ORIGINAL RATIONALE ───────────────────────────────────────────
   Two sets, chosen by the axis that already decides whether this call is
   winnable. A no-pain prospect is not a silent prospect: they have plenty to
   say, and what they say is why it is not a problem. That is the specific
   thing missing when the model falls back on a canned refusal.

   `topic` is what a founder has to have asked about. Deliberately a small
   list of plain words -- if it needed a taxonomy it would be a taxonomy the
   founder has to guess. */
/* ── TWO AXES OF VARIATION, BOTH MEASURED INTO EXISTENCE ──────────────
   A 40-turn corpus after the first ledger build showed 28 repeated phrases,
   ALL 28 of them recurring across different sessions and NONE within a
   single call. The ledger had fixed within-call repetition completely and
   changed cross-call repetition not at all, because every business drew from
   one shared pool of five sentences: a vet clinic, a dental practice and a
   garage all said "two people on the desk all day".

   So the pool varies on the two things that were fixed.

   BY BUSINESS, through the words the trade actually uses. A garage has
   customers and jobs; a clinic has patients and appointments. One
   substitution map rather than a pool per industry, because the FACTS are
   the same shape everywhere -- somebody answers the phone or nobody does --
   and only the nouns differ. A pool per industry would be four copies of the
   same five facts, drifting apart.

   BY CALL, through three phrasings of each note. A founder rehearsing one
   prospect thirty times SHOULD hear the same facts every time: Ardley
   Veterinary really does have the same two people on the desk. What they
   must not hear is the same sentence. Facts are constant, wording is not,
   which is how a real person retelling the same thing sounds. */
const DOMAIN_WORDS = Object.freeze({
  clinical: { people: 'patients', booking: 'appointments', one: 'appointment', desk: 'reception' },
  trades: { people: 'customers', booking: 'jobs', one: 'job', desk: 'the office' },
  professional: { people: 'clients', booking: 'meetings', one: 'meeting', desk: 'the front desk' },
  personal: { people: 'clients', booking: 'appointments', one: 'appointment', desk: 'the front desk' },
  generic: { people: 'customers', booking: 'bookings', one: 'booking', desk: 'the front desk' },
});

const DOMAIN_MATCH = Object.freeze([
  [/\b(vet|veterinar|dental|dentist|doctor|surgery|physio|chiroprac|clinic|optician|pharmac|medical)/i, 'clinical'],
  [/\b(plumb|garage|electric|builder|roofing|heating|mechanic|joiner|landscap)/i, 'trades'],
  [/\b(account|solicitor|law|consult|marketing|agency|advis|architect|survey)/i, 'professional'],
  [/\b(salon|spa|barber|hair|beauty|nail|gym|studio)/i, 'personal'],
]);

export function domainOf(prospect = {}) {
  const text = [prospect.businessType, prospect.category, prospect.industry, prospect.name]
    .filter((v) => typeof v === 'string').join(' ');
  const hit = DOMAIN_MATCH.find(([re]) => re.test(text));
  return hit ? hit[1] : 'generic';
}

/* `{one}` is the singular. Without it "one missed {booking}" produced "one
   missed appointments", which is the kind of seam that tells a founder they
   are talking to a template far faster than any repetition does. */
const fill = (note, w) => String(note)
  .replace(/\{people\}/g, w.people).replace(/\{booking\}/g, w.booking)
  .replace(/\{one\}/g, w.one).replace(/\{desk\}/g, w.desk);

/* Three notes per fact. Not synonyms of one sentence -- different ways a
   person brings the same thing up, which is what stops the third rehearsal
   sounding like the first. */
const PAIN_FACTS = Object.freeze([
  { id: 'volume', dims: ['call_volume'], depth: DEPTH.SURFACE, topic: ['call', 'calls', 'phone', 'reception', 'front desk', 'busy', 'day',
      /* P1-4: how a founder actually asks about the call channel.
         'enquiry'/'enquiries' were absent entirely, so "How do enquiries
         reach you at the moment?" -- the plainest possible question about
         this fact -- matched nothing. Nouns and fixed phrases only: each
         one NAMES the channel, so a vague question still cannot reach it. */
      'enquiry', 'enquiries', 'inquiry', 'inquiries', 'get through',
      'come through', 'pick up', 'picking up', 'answering the phone'],
    notes: ['busiest on the phone late morning, and again about five',
      'phone barely stops between eleven and two',
      'it comes in waves, quiet then all at once'] },
  { id: 'who', dims: ['call_handler'], depth: DEPTH.SURFACE, topic: ['who', 'team', 'staff', 'handles', 'covers', 'people'],
    notes: ['nobody owns the phone, whoever is nearest answers it',
      'one person covering {desk}, and she is not always there',
      'everyone answers it, which means no one really does'] },
  { id: 'missed', dims: ['missed_contact'], depth: DEPTH.OPERATIONAL, topic: ['miss', 'missed', 'ring out', 'voicemail', 'happens', 'cost', 'lose',
      /* P1-4: the words people use for the same thing. */
      'message', 'answerphone', 'call back', 'callback', 'unanswered'],
    notes: ['calls ring out while the team are with {people}, nobody counts how often',
      'goes to voicemail more than it should, and hardly anyone leaves one',
      'we find out we missed someone when they ring the place down the road'] },
  { id: 'tried', dims: ['previous_attempts'], depth: DEPTH.OPERATIONAL, topic: ['tried', 'before', 'change', 'fixed', 'system', 'service',
      /* P1-4: asking whether they already use someone/something. */
      'using anyone', 'using someone', 'last time', 'previously', 'provider'],
    notes: ['tried an answering service two years ago, it did not stick',
      'had a virtual receptionist for a bit, {people} hated it',
      'looked at something like this before and never got round to it'] },
  { id: 'cost', dims: ['operational_impact'], depth: DEPTH.SENSITIVE, topic: ['cost', 'worth', 'lose', 'revenue', 'bookings', 'value'],
    notes: ['a lost new client is worth a few hundred a year, never been added up',
      'one missed {one} is not much, a month of them would be',
      'no idea what it costs us, and I would rather not know'] },
]);

const NO_PAIN_FACTS = Object.freeze([
  { id: 'covered', dims: ['call_handler', 'team_size'], depth: DEPTH.SURFACE, topic: ['call', 'calls', 'phone', 'reception', 'front desk', 'busy', 'day',
      /* P1-4: how a founder actually asks about the call channel.
         'enquiry'/'enquiries' were absent entirely, so "How do enquiries
         reach you at the moment?" -- the plainest possible question about
         this fact -- matched nothing. Nouns and fixed phrases only: each
         one NAMES the channel, so a vague question still cannot reach it. */
      'enquiry', 'enquiries', 'inquiry', 'inquiries', 'get through',
      'come through', 'pick up', 'picking up', 'answering the phone'],
    notes: ['two people covering {desk} all day, phone always gets answered',
      'someone is always sat there, it never rings out',
      'we are small enough that the phone is never a problem'] },
  { id: 'quiet', dims: ['call_volume'], depth: DEPTH.SURFACE, topic: ['who', 'team', 'staff', 'handles', 'covers', 'volume', 'many'],
    notes: ['low call volume, most {booking} arrive online now',
      'hardly anyone rings any more, it is all through the website',
      'maybe a dozen calls a day, if that'] },
  { id: 'system', dims: ['missed_contact', 'booking_channel'], depth: DEPTH.OPERATIONAL, topic: ['system', 'software', 'tried', 'before', 'how', 'works', 'process'],
    notes: ['{booking} system already texts back on a missed call',
      'the software chases them for us, we do not have to',
      'it is all automated already, that side of it'] },
  { id: 'priority', dims: ['operational_impact'], depth: DEPTH.OPERATIONAL, topic: ['priority', 'worry', 'problem', 'issue', 'change', 'improve'],
    notes: ['if anything needed fixing it would be staffing, not phones',
      'the phones are the one thing that does work',
      'there are bigger things on the list than this'] },
  { id: 'decider', dims: ['decision_authority'], depth: DEPTH.SENSITIVE, topic: ['decide', 'decision', 'budget', 'sign', 'owner', 'who'],
    notes: ['anything with a monthly cost goes to the owner, and not this year',
      'I could not sign that off, and he would say no anyway',
      'budget is set until April, nothing new goes on it'] },
]);

/**
 * THE HIDDEN FACT SET FOR ONE CALL. Server-side, like the scenario itself.
 * Three to five, so two calls to the same business do not offer the same
 * ground -- drawn from the same seed, so one call replays identically.
 */
export function drawLedger({ variation = {}, seed = null, prospect = {}, truthFacts = [] } = {}) {
  /* ── GROUNDED TRUTH FIRST, AND IT OUTRANKS THE INVENTED POOL ────────
     `truthFacts` are compiled by business-truth.js from persisted research:
     already {id, depth, topic, text}, already first-person, already filtered
     to what this speaker's role would know. They are simply true, so they are
     always in the ledger -- a person does not forget where their own business
     is because a coin came up differently.

     WHERE TRUTH SPEAKS, SIMULATION IS SILENT. An invented fact that talks
     about a topic real research already covers is dropped, because the two
     would contradict each other in front of the founder: the hardcoded
     `covered` note says "two people covering reception, phone always gets
     answered" while a grounded conversion_path fact may say the site carries
     no contact route at all. Suppressing by TOPIC rather than by id is what
     makes that collision impossible rather than unlikely.

     WHERE TRUTH IS SILENT, SIMULATION STAYS FREE. Nothing collected today
     reaches missed calls, what they tried before, or what it costs them, so
     those invented facts survive untouched -- which is the point: this
     replaces what research can support and invents no replacement for what
     it cannot. */
  const truth = (Array.isArray(truthFacts) ? truthFacts : [])
    .filter((f) => f && typeof f.text === 'string' && f.text.trim() && Array.isArray(f.topic))
    .map((f) => Object.freeze({
      id: String(f.id), depth: f.depth || DEPTH.SURFACE, topic: f.topic.slice(),
      text: f.text, grounded: true,
      /* Carried, not rebuilt. The first version of this map dropped
         `dimension`, so the claim set inside the ledger was always empty and
         suppression silently never fired -- the compiler computed the claims
         correctly and the ledger threw them away. */
      dims: Array.isArray(f.dimension) ? f.dimension.slice() : [],
    }));
  /* ── SUPPRESSION KEYS ON THE CLAIM, NOT ON SHARED WORDS ────────────
     The first version compared TOPIC keywords, and the live corpus showed
     what that costs: `contactability` and `conversion_path` carry 'call',
     'calls' and 'phone', so a grounded channel fact silenced the invented
     facts about how MANY calls arrive and WHO answers them. Across six real
     calls the prospect then met the two commonest discovery questions in the
     corpus with "what is this regarding?" -- grounding had displaced more
     than it replaced.

     A fact is suppressed only when grounded research makes the SAME claim.
     Knowing the phone is published says nothing about volume, staffing,
     missed calls or what they cost, so those stay available to the
     simulation. Nothing currently collected reaches them at all, which is
     precisely why inventing them is still the honest thing to do. */
  const claimed = new Set(truth.flatMap((f) => f.dims || []));
  const basePool = variation.painExists === false ? NO_PAIN_FACTS : PAIN_FACTS;
  const pool = claimed.size
    ? basePool.filter((f) => !(f.dims || []).some((d) => claimed.has(d)))
    : basePool;
  const w = DOMAIN_WORDS[domainOf(prospect)] || DOMAIN_WORDS.generic;
  /* One phrasing per fact, chosen per CALL. The same rehearsal replays
     identically; the next one tells you the same thing differently. */
  /* The BUSINESS is in the phrasing seed as well as the call. Without it two
     different businesses in the same corpus slot chose the same variant and
     said the same sentence -- which is the cross-session repetition this
     whole change exists to remove. */
  const who = `${prospect.name || ''}|${prospect.businessType || ''}`;
  const phrase = (f) => fill(
    f.notes[Math.floor(seeded(`${seed}::${who}::${f.id}::note`) * f.notes.length) % f.notes.length], w);
  /* Always keep at least one surface fact: a prospect with nothing safe to
     say is a prospect who can only refuse, which is the failure this file
     is here to remove. */
  const surface = pool.filter((f) => f.depth === DEPTH.SURFACE);
  const rest = pool.filter((f) => f.depth !== DEPTH.SURFACE);
  const keepRest = 2 + Math.floor(seeded(`${seed}::ledger`) * (rest.length - 1));
  const ordered = rest.slice().sort((a, b) => seeded(`${seed}::${a.id}`) - seeded(`${seed}::${b.id}`));
  return Object.freeze({
    version: DISCLOSURE_LEDGER_VERSION,
    domain: domainOf(prospect),
    /* Grounded facts lead. The ladder caps how many are offered per turn by
       attention, so order decides which survives that cap -- and a true fact
       should always beat an invented one for the same breath. */
    facts: Object.freeze([
      ...truth,
      ...[...surface, ...ordered.slice(0, keepRest)]
        .map((f) => Object.freeze({ id: f.id, depth: f.depth, topic: f.topic, text: phrase(f) })),
    ]),
    grounded: truth.length,
    suppressed: basePool.length - pool.length,
  });
}

const norm = (v) => String(v == null ? '' : v).toLowerCase();

/* Did the founder ask about this? Whole words from the topic list --
   deliberately not stemming or embedding, because a founder cannot guess at
   a similarity threshold and a rule they cannot predict is a rule they
   cannot learn from.

   WORD BOUNDARIES, NOT SUBSTRINGS. This was `t.includes(k)`, so the topic
   word "day" matched inside "to-day" and "nice weather today" released a
   fact about call volume at full depth -- with `reason:
   'relevant_and_earned'`, which is the gate reporting that the founder had
   asked. "Monday", "daily" and "birthday" did the same. That breaks the one
   rule this file is built on ("nothing is released unless the founder ASKED
   ABOUT IT") and it breaks it silently, in the direction of leaking.

   Multi-word topics ("front desk", "ring out") still work: the boundary is
   applied to the whole phrase, not to each word in it. */
/* P1-4: AND ITS PLURAL. `phone` did not match "the phones are busy", because
   the trailing `s` is a word character and the boundary refused it -- so the
   single most obvious way to ask about call volume missed a SURFACE fact.
   An optional trailing `s` is the smallest addition that fixes it and stays
   predictable: it is still a whole-word rule a founder can hold in their
   head ("the word, or the word plural"), not a similarity score they cannot
   guess at. Irregular plurals are handled by listing them, exactly as
   `call`/`calls` already are -- nothing here stems or fuzzy-matches. */
const boundaried = (phrase) => new RegExp(
  `(?:^|\\W)${String(phrase).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?(?:\\W|$)`, 'i');

export function askedAbout(fact, founderText) {
  const t = norm(founderText);
  if (!t) return false;
  return (fact.topic || []).some((k) => {
    const key = norm(k);
    return key ? boundaried(key).test(t) : false;
  });
}

/**
 * WHAT MAY BE SAID THIS TURN.
 *
 * Relevance is necessary in every case. Depth is earned on top of it:
 *   OPERATIONAL  needs the founder to have used the last answer, or trust.
 *   SENSITIVE    needs BOTH, and enough attention to elaborate.
 *
 * Attention caps the number rather than the depth, because a distracted
 * person gives you less, not shallower.
 *
 * @param {object}  input
 * @param {object}  input.ledger      from drawLedger()
 * @param {string}  input.founderText what they just asked
 * @param {string[]} input.alreadySaid fact ids already spent
 * @param {number}  input.trust        0..1, from the behaviour engine
 * @param {boolean} input.builtOnAnswer did this turn use the last answer
 * @param {number}  input.attention    0..1, from Situation State
 */
export function admissibleDisclosures({ ledger = null, founderText = '', alreadySaid = [],
  trust = 0.5, builtOnAnswer = false, attention = 1, intensity = null } = {}) {
  const facts = (ledger && ledger.facts) || [];
  const spent = new Set(alreadySaid || []);
  const relevant = facts.filter((f) => !spent.has(f.id) && askedAbout(f, founderText));
  if (!relevant.length) {
    return { offer: [], withheld: facts.filter((f) => !spent.has(f.id)).map((f) => f.id),
      reason: 'nothing_they_asked_about' };
  }

  /* DIFFICULTY RAISES WHAT A DEEPER FACT COSTS, and nothing else. Relevance
     stays necessary at every level -- `relevant` above is computed before
     this and no dial can bypass it, so a harder call is never one where
     rapport substitutes for asking the right question. Zero when no dials
     are set, which is every caller that predates them. */
  const gate = disclosureDepthGateOf(resolveIntensity(intensity));
  const earnedOperational = builtOnAnswer || trust >= (0.55 + gate);
  const earnedSensitive = builtOnAnswer && trust >= (0.6 + gate) && attention >= (0.45 + gate);
  const allowed = relevant.filter((f) => {
    if (f.depth === DEPTH.SURFACE) return true;
    if (f.depth === DEPTH.OPERATIONAL) return earnedOperational;
    return earnedSensitive;
  });

  /* A person with half an ear gives you one thing, not three. */
  const cap = attention < 0.4 ? 1 : (attention < 0.7 ? 2 : 3);
  return {
    offer: allowed.slice(0, cap),
    withheld: relevant.filter((f) => !allowed.includes(f)).map((f) => f.id),
    reason: allowed.length ? 'relevant_and_earned'
      : (earnedOperational ? 'relevant_but_not_earned_at_this_depth' : 'relevant_but_not_earned'),
  };
}

/* The prompt lines. Held facts are named as things the prospect KNOWS and is
   not saying, so the model does not invent a contradictory answer in the gap
   -- it is the difference between a prospect who is holding back and one
   who has nothing there. */
export function disclosureLines(admissible) {
  const a = admissible || {};
  const out = [];
  if ((a.offer || []).length) {
    out.push('', 'NOTES ON YOUR OWN BUSINESS, and they have just earned one. Work the SUBSTANCE of'
      + ' exactly ONE of these into your reply. These are notes, not lines: do not use this wording,'
      + ' do not read them out, and do not mention more than one.');
    a.offer.forEach((f) => out.push(`  - ${f.text}`));
  }
  if ((a.withheld || []).length) {
    out.push('', 'YOU ALSO KNOW THINGS THEY HAVE NOT EARNED YET. Do not say them, do not hint that'
      + ' you are holding something back, and do not invent something else in their place.');
  }
  return out;
}
