/* ════════════════════════════════════════════════════════════════════════
   HOW THE PHONE GETS ANSWERED

   Until this file existed, a Practice call began with the founder talking
   into silence: the prospect never spoke first, so the founder's opener
   landed on somebody who had already, impossibly, understood they were
   being sold to. Every real cold call starts the other way round -- a
   person picks up, says who they are, and assumes you might be a customer.
   That first second is where most cold calls are actually lost, and it was
   the one moment Practice could not rehearse.

   ── WHAT DECIDES THE GREETING ────────────────────────────────────────
   Only things a caller could genuinely infer before anyone speaks:

     BUSINESS SHAPE   a twelve-person clinic answers differently from a
                      sole trader's mobile. Derived from public prospect
                      data (headcount, category, description) by
                      scenario-selection.js's businessShape() -- NOT from
                      the hidden role.
     SITUATION        how stretched they are right now, expressed the way
                      a person expresses it: fewer words, a "bear with
                      me", no invitation to talk. This is behaviour, not
                      disclosure -- the founder reads it, exactly as they
                      would on a real call.
     THE DAY          morning/afternoon/evening, because a person who has
                      been answering that phone all day says so.
     THE SEED         so two calls to the same business are not identical
                      and one call is reproducible.

   ── WHAT MUST NOT DECIDE IT ──────────────────────────────────────────
   The hidden role (gatekeeper / influencer / decision_maker) is NEVER
   read here. A front-desk business gets a front-desk greeting whether the
   owner or the receptionist happened to pick up, which is exactly what
   happens in life -- and it keeps Controlled Uncertainty intact, because
   the greeting cannot be decoded into who this person turns out to be.

   ── THEY THINK YOU MIGHT BE A CUSTOMER ───────────────────────────────
   Every line here is the greeting of somebody expecting an enquiry. None
   of them acknowledges a salesperson, because the person answering has no
   way of knowing yet. What they think this call is only changes once the
   founder tells them.
   ══════════════════════════════════════════════════════════════════════ */

export const PROSPECT_GREETING_VERSION = 'practice_prospect_greeting_v1';

/* Deterministic, self-contained: this module imports nothing so any
   surface can build a greeting without pulling the engine in behind it.
   Same FNV-1a shape scenario-selection.js uses, restated for that reason. */
function seededUnit(seed) {
  const s = String(seed == null ? 'x' : seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
const pick = (list, seed) => list[Math.floor(seededUnit(seed) * list.length) % list.length];

/* A first name only. Nobody answering a phone gives a surname, and a
   surname would also invent a person the founder could later "verify". */
const NAMES = Object.freeze(['Sarah', 'Danny', 'Priya', 'Mark', 'Aisha', 'Tom', 'Rosa', 'Kemi',
  'Jen', 'Omar', 'Claire', 'Nina', 'Dev', 'Sam', 'Leah', 'Marco']);

/* ── THE BUSINESS NAME, AS IT WOULD BE SAID ───────────────────────────
   Nobody answers the phone with their legal entity. "Ardley Veterinary
   Clinic Pty Ltd" is "Ardley Veterinary" out loud, and a founder hearing
   the full registered name would know instantly they were talking to a
   machine. Trailing company-form words go; the rest is left exactly as
   the lead recorded it, because guessing further would start inventing. */
const LEGAL_TAIL = /\s+(?:pty\.?\s*ltd\.?|p\/l|ltd\.?|limited|llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|plc|gmbh|s\.?a\.?r\.?l\.?|b\.?v\.?)\.?$/i;
export function spokenBusinessName(name) {
  let out = String(name == null ? '' : name).trim();
  /* Twice: "Ardley Veterinary Clinic Pty Ltd" ends in two of them. */
  out = out.replace(LEGAL_TAIL, '').replace(LEGAL_TAIL, '').trim();
  return out;
}

/* Morning before noon, afternoon to six, evening after. A person says
   this without thinking; getting it wrong is instantly wrong. */
function partOfDay(hour) {
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/* ── HOW STRETCHED THEY ARE, IN WORDS NOT NUMBERS ─────────────────────
   attention is the same 0..1 the rest of the engine already moves. Three
   bands, because a greeting has nowhere near the room for more: someone
   with time offers help, someone busy states the name and stops, someone
   genuinely mid-something asks you to wait. */
function band(attention) {
  const a = typeof attention === 'number' && Number.isFinite(attention) ? attention : 0.7;
  if (a < 0.42) return 'stretched';
  if (a < 0.68) return 'brisk';
  return 'open';
}

/* Shape × band. Every line is somebody expecting an enquiry, and no line
   mentions sales, calls, or the fact that a stranger is on the phone.
   `{b}` business, `{n}` name, `{d}` part of day. A line without `{n}`
   is deliberate: plenty of people never give their name. */
const SMALL_TEAM = Object.freeze({
  open: Object.freeze([
    '{d}, {b}, {n} speaking.',
    'Hello, {b}. This is {n}.',
    '{b}, {n} here. What can I do for you?',
    '{d}, {b}, this is {n}. What can I do for you?',
    'Hello, {b}, {n} speaking. How can I help?',
  ]),
  brisk: Object.freeze([
    '{b}, {n} speaking.',
    '{b} — hi, {n} here.',
    '{d}, {b}, {n} speaking.',
    'Hello, {b}, this is {n}.',
    '{b}, {n}. What can I do for you?',
  ]),
  /* BUSY, NEVER ON HOLD. Every line here still sounds stretched -- but it
     hands the turn back. See HOLD_WITHOUT_INVITATION below for why. */
  stretched: Object.freeze([
    '{b}, {n} speaking, sorry, I have only got a minute. What is it?',
    'Hello, {b}. Sorry, bit in the middle of something. What can I do for you?',
    '{b} — {n} here, it is a bit hectic. What is this regarding?',
    '{b}, sorry, {n} speaking. I am mid-something, but go ahead.',
    'Hello, {b}, {n} speaking. Sorry, it is a bit hectic. What is this about?',
  ]),
});
const FORMS = Object.freeze({
  front_desk: Object.freeze({
    open: Object.freeze([
      '{d}, {b}, {n} speaking. How can I help?',
      '{b}, this is {n}. What can I do for you?',
      '{d}, {b}, {n} speaking. How can I help you today?',
      '{b}, {n} speaking. What can I do for you?',
      'Hello, {b}, this is {n}. How can I help?',
    ]),
    brisk: Object.freeze([
      '{b}, {n} speaking.',
      '{d}, {b}, {n} speaking.',
      '{b}, {n}. How can I help?',
      'Hello, {b}, {n} here.',
      '{b}, this is {n}.',
    ]),
    stretched: Object.freeze([
      '{b}, {n} speaking, I have only got a second. What is it?',
      '{b} — {n} here, sorry, we are slammed. What is this regarding?',
      '{b}, {n} speaking, sorry, it is chaos here. What can I do for you?',
      '{b}, sorry, {n} speaking. Quick as you can, what is this about?',
      'Hello, {b}, {n}. Sorry, bit of a morning. What did you need?',
    ]),
  }),
  small_team: SMALL_TEAM,
  /* An unknown shape is answered the way an unremarkable small business
     answers, rather than being given a fourth voice of its own. */
  unknown: SMALL_TEAM,
  solo: Object.freeze({
    open: Object.freeze([
      'Hello, {n} speaking.',
      '{d}, this is {n}.',
      'Hello, {n} here.',
      '{d}, {n} speaking.',
      'Hello, this is {n}.',
    ]),
    brisk: Object.freeze([
      'Hello, {n} speaking.',
      '{n} speaking.',
      'Hello, {n} here.',
      'Yes, hello, {n} speaking.',
      '{d}, {n} speaking.',
    ]),
    stretched: Object.freeze([
      'Hello, {n} speaking — sorry, I am short on time. What is it?',
      '{n} speaking. Sorry, I am driving, so make it quick.',
      'Hello, {n}. Sorry, you have caught me mid-something. What is this about?',
      'Yes? {n} speaking, sorry, I have not got long. Go ahead.',
      'Hello, {n} here, sorry, I am rushing. What did you need?',
    ]),
  }),
});

/**
 * The first thing the founder hears.
 *
 * @param {object} input
 * @param {string} input.businessName   the prospect's business, as recorded
 * @param {string?} input.personName    a REAL contact name where one is known
 * @param {string?} input.shape         businessShape(): solo|small_team|front_desk|unknown
 * @param {object?} input.situation     the live situation state; only `attention` is read
 * @param {string?} input.seed          session id, so a call is reproducible
 * @param {number?} input.hour          local hour 0-23; omitted means no time-of-day greeting
 * @returns {{text: string, name: string|null, version: string}}
 */
/* ── A HOLD IS A PROMISE THE RUNTIME CANNOT KEEP ──────────────────────
   Human call #1 opened with "The Affordable Dentist Sydney, sorry, Sam
   speaking, give me one second." -- and then nothing, because there is no
   autonomous continuation: no timer wakes the prospect back up, and the
   next prospect turn only exists in reply to a founder turn. The founder
   had to say "Okay, I'm waiting for you to be free" to restart a
   conversation the prospect had suspended. A busy person is brief and
   abrupt; they do not put you on hold and then vanish.

   The rule is not "never say hang on" -- it is that a hold may not be the
   WHOLE turn. Hold language is fine when the same breath hands the turn
   back ("hang on, what's this about?"), because then the founder has
   something to answer. It is forbidden when it is terminal, because that
   is a request for a continuation the runtime will never produce.

   Matched semantically rather than on one sentence: any of the hold
   family, with no invitation anywhere in the line. */
const HOLD_RE = /\b(?:give me (?:a|one) (?:sec(?:ond)?|minute|moment)|bear with (?:me|us)|hang on|hold on|hold the line|can you hold|just a (?:sec(?:ond)?|minute|moment)|one (?:sec(?:ond)?|moment)|two (?:secs|seconds|minutes)|won'?t be a (?:sec|minute|moment))\b/i;
/* An invitation is anything that returns the turn: a direct question, or
   an explicit go-ahead. The question mark alone is not enough -- "can you
   hold a moment?" is a question that takes the turn AWAY. */
/* The question form is kept OUT of the trailing \b group: a word boundary
   cannot match after "?", so folding it in silently made every
   question-shaped invitation invisible and flagged "hang on -- what is this
   about?" as a terminal hold. */
const INVITE_RE = /what(?:'?s| is| did| can)\b[^.?!]*\?|\b(?:how can i help|what can i do|go ahead|make it quick|quick as you can|i'?m listening|fire away)\b/i;

export function holdWithoutInvitation(text) {
  const t = String(text == null ? '' : text);
  if (!HOLD_RE.test(t)) return false;
  return !INVITE_RE.test(t);
}

export function buildProspectGreeting({ businessName = '', personName = null, shape = 'unknown',
  situation = null, seed = null, hour = null } = {}) {
  const key = String(seed == null ? 'no-seed' : seed);
  const spoken = spokenBusinessName(businessName);
  /* A REAL name always wins. Inventing one over the top of a contact the
     founder can actually see in their own lead record would put VISION and
     the Leads page in direct contradiction on the first word of the call. */
  const real = String(personName == null ? '' : personName).trim().split(/\s+/)[0] || '';
  const name = real || pick(NAMES, `${key}::name`);

  const forms = FORMS[shape] || FORMS.unknown;
  const all = forms[band(situation && situation.attention)];
  /* A KNOWN CONTACT MUST ACTUALLY BE NAMED. When the founder's own lead
     record shows who they are calling, a greeting that omits the name
     throws away the one detail they can check -- and the first draft did
     exactly that, because the seeded pick landed on a name-less form.
     Where a real name is known the pool narrows to forms that use it. */
  const chosen = real ? all.filter((f) => f.includes('{n}')) : all;
  const day = partOfDay(hour);
  let text = pick(chosen.length ? chosen : all, `${key}::greeting`);

  /* No clock, no time-of-day. Falling back to "Good morning" on an unknown
     hour would be wrong half the time, and wrong in a way a founder
     notices immediately. */
  if (!day) text = text.replace(/\{d\}, /g, '').replace(/\{d\}/g, 'Hello');
  text = text.replace(/\{d\}/g, day).replace(/\{b\}/g, spoken).replace(/\{n\}/g, name);

  /* A business with no recorded name cannot announce one. Strip the
     fragment rather than saying ", , this is Sarah". */
  if (!spoken) text = text.replace(/^,\s*/, '').replace(/\s*,\s*,/g, ',').replace(/^\s*—\s*/, '').trim();
  text = text.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
  if (text && !/[.?!]$/.test(text)) text += '.';

  /* FAIL SAFE, NOT FAIL SILENT. The tables above are written to satisfy
     this, and a gate proves it -- but a future edit that reintroduces a
     terminal hold must not reach a founder. The fallback keeps the band's
     pressure and hands the turn back. */
  if (holdWithoutInvitation(text)) {
    text = spoken
      ? `${spoken}${name ? `, ${name} speaking` : ''}, sorry, I have only got a minute. What is this about?`
      : `${name ? `${name} speaking, s` : 'S'}orry, I have only got a minute. What is this about?`;
  }

  return Object.freeze({
    text,
    /* So the rest of the call knows who it is being. Threaded into the
       prompt as an already-said fact, never re-drawn per turn. */
    name: name || null,
    version: PROSPECT_GREETING_VERSION,
  });
}
