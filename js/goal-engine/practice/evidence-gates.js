/* ════════════════════════════════════════════════════════════════════════
   THE GATES EVERY DETERMINISTIC PRODUCER MUST PASS THROUGH.

   One file, because a gate that lives in two places is a gate one producer
   forgets. Every function here answers a narrow question about a SPAN OF
   TEXT and returns { pass, reason } -- never a score, never a probability.

   Each gate exists because a measured line in the real corpus defeated the
   naive version of a rule:

     negationScope   "I'm not saying no."          -- the negator scopes over
                                                      a FOLLOWING complement
     polarityCount   "We're not unhappy with them" -- two negations is where
                                                      deterministic reading stops
     attribution     "My receptionist keeps saying
                      'we need a new system'"      -- not the prospect's claim
     speechAct       "Understood. When someone..." -- a discourse marker is not
                                                      a leave-taking act
     hedgeFloor      "Possibly, but I'd need to
                      understand what you mean"    -- read as an admission, and
                                                      it moved a real call's
                                                      qualification a whole level
     termProvenance  the word "gap" was the
                      FOUNDER's                    -- the prospect echoing your
                                                      jargon is not disclosure
     stickyDenial    "I didn't say there was a
                      gap to investigate"          -- a denial outranks a later
                                                      inferred agreement
     audioProvenance levelMean === 0               -- complete does not mean
                                                      intelligible

   WITHHOLDING IS ALWAYS AVAILABLE. None of these gates guesses; each one
   declines. The Nuance Judge exists for what declines here.
   ══════════════════════════════════════════════════════════════════════ */

export const GATES_VERSION = 'practice_evidence_gates_v1';

const PASS = (reason) => ({ pass: true, reason: reason || 'ok' });
const FAIL = (reason) => ({ pass: false, reason });

/* The model writes typographic punctuation. Normalised once, centrally, for
   the same reason Pass 2 does it: matching only straight quotes silently
   switched off half the detection on every real prospect line. */
export function normalise(v) {
  return String(v == null ? '' : v)
    .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').trim();
}

const NEGATOR = /\b(not|never|no|nothing|none|isn't|aren't|wasn't|weren't|don't|doesn't|didn't|won't|wouldn't|can't|cannot|couldn't|shouldn't|hardly|barely)\b/gi;
/* Verbs that put what follows into someone else's mouth, or into a
   hypothetical. A proposition under one of these is not asserted. */
const REPORTING = /\b(say|says|said|saying|tell|tells|told|telling|ask|asks|asked|asking|mean|means|meant|suggest|suggests|suggested|claim|claims|claimed|think|thinks|thought|hear|heard|hearing|reckon|reckons)\b/i;
const HEDGE = /\b(suppose|supposing|possibly|perhaps|maybe|may|might|could|probably|i guess|i imagine|i'd say|i would say|sort of|kind of|arguably|potentially|conceivably)\b/i;
const INTERJECTION = /^(oh|wow|great|brilliant|fantastic|lovely|perfect|marvellous|marvelous)\b/i;
/* Openers a founder uses to acknowledge, which mean nothing about the act
   that follows them. Stripped before any speech-act classification. */
const DISCOURSE_HEAD = /^((understood|right|okay|ok|sure|fair enough|no problem|got it|of course|absolutely|thanks|thank you|appreciate it|yeah|yes|well|so|and|but)[,.!]?\s+)+/i;

/* CLAUSES ARE NOT SENTENCES. Splitting only on .!?; meant "if it's not worth
   acting on" sat in the same clause as the time box that preceded it, so a
   founder's risk-reversal cancelled his own close -- and "We're not
   interested, so please remove us from your call list" fell out of the one
   protection that matters. Commas and colons separate clauses too, and a
   leading acknowledgment ("No, ...", "Right, ...") is a discourse marker
   rather than a negation of what follows. */
const CLAUSE_SPLIT = /[.!?;,:]|\b(?:but|so|although|though|however|whereas)\b/;
const clauseBefore = (text, index) => {
  const head = normalise(text).slice(0, index);
  const last = head.split(CLAUSE_SPLIT).pop();
  return stripDiscourseHead(last || '');
};

/* ── NEGATION ──────────────────────────────────────────────────────────
   Two questions, deliberately separate: is the proposition negated, and is
   it negated so many times that no deterministic reading is safe? */
export function negationScope(text, match) {
  const t = normalise(text);
  const idx = typeof match === 'number' ? match
    : (match instanceof RegExp ? (t.search(match)) : t.indexOf(String(match || '')));
  if (idx < 0) return FAIL('no_match');
  const before = clauseBefore(t, idx);
  NEGATOR.lastIndex = 0;
  const negs = before.match(NEGATOR) || [];
  if (negs.length === 0) return PASS('affirmed');
  if (negs.length >= 2) return FAIL('double_negation_withheld');
  return FAIL('negated');
}

/* A negator anywhere in the matrix clause, including one that scopes over a
   complement to its right: "I'm not saying no" negates the "no". */
export function polarityIsAffirmed(text, match) {
  const t = normalise(text);
  const idx = typeof match === 'number' ? match
    : (match instanceof RegExp ? t.search(match) : t.indexOf(String(match || '')));
  if (idx < 0) return FAIL('no_match');
  /* Only the clause the match actually sits in, and only the part of it
     before the match -- a negator AFTER the phrase belongs to the next idea. */
  const clause = clauseBefore(t, idx);
  NEGATOR.lastIndex = 0;
  const negs = clause.match(NEGATOR) || [];
  if (negs.length >= 2) return FAIL('double_negation_withheld');
  if (negs.length === 1) return FAIL('negated_matrix_clause');
  return PASS('affirmed');
}

/* SOME PHRASES ARE NEGATIVE BY CONSTRUCTION. "Please don't call again" and
   "we're not looking" carry their negator inside the matched span -- the
   negation IS the content. Asking whether such a phrase is "affirmed" always
   answers no. What actually matters for those is whether a SEPARATE negator
   sits in front of the phrase, turning it into a report of something not
   being asked: "I'm not asking you to stop calling". */
export function negatedBeforeMatch(text, re) {
  const t = normalise(text);
  const idx = t.search(re);
  if (idx < 0) return FAIL('no_match');
  const before = clauseBefore(t, idx);
  NEGATOR.lastIndex = 0;
  return (before.match(NEGATOR) || []).length > 0 ? FAIL('negated_before_phrase') : PASS('phrase_stands');
}

/* ── ATTRIBUTION ───────────────────────────────────────────────────────
   Is the proposition the speaker's own, or someone else's in their mouth? */
export function attribution(text, match) {
  const t = normalise(text);
  const idx = typeof match === 'number' ? match
    : (match instanceof RegExp ? t.search(match) : t.indexOf(String(match || '')));
  if (idx < 0) return FAIL('no_match');
  /* Inside quotation marks: someone else said it. */
  /* APOSTROPHES ARE NOT QUOTATION MARKS. Treating them as delimiters made
     "we're not interested. Please don't call again" look like quoted speech
     -- the span ran from the apostrophe in "we're" to the one in "don't" --
     which silently suppressed the single most consequential event in the
     product. A single quote only opens a quotation when a word boundary
     precedes it and a non-space follows; only then does its partner close. */
  const quoted = [];
  const dq = /"([^"]*)"/g;
  let m;
  while ((m = dq.exec(t))) quoted.push([m.index, m.index + m[0].length]);
  const sq = /(^|[\s(\[])'(\S[^']*\S)'(?=[\s.,;:!?)\]]|$)/g;
  while ((m = sq.exec(t))) quoted.push([m.index, m.index + m[0].length]);
  if (quoted.some(([a, b]) => idx >= a && idx <= b)) return FAIL('inside_quotation');
  const before = clauseBefore(t, idx);
  if (REPORTING.test(before)) return FAIL('reported_speech');
  return PASS('speaker_owns_it');
}

/* ── SPEECH ACT ────────────────────────────────────────────────────────
   A keyword is not an act. Strips acknowledgment openers first, then asks
   whether the matrix clause really performs the act. */
export function stripDiscourseHead(text) {
  return String(text == null ? '' : text).replace(DISCOURSE_HEAD, '').trim();
}
export function isMatrixImperativeTo(text, re) {
  const body = stripDiscourseHead(text);
  const first = body.split(/[.!?;]/).map((c) => c.trim()).filter(Boolean);
  /* Only clauses NOT governed by a reporting verb can perform the act. */
  const ok = first.some((c) => re.test(c) && !REPORTING.test(c.slice(0, c.search(re))));
  return ok ? PASS('matrix_act') : FAIL('not_a_matrix_act');
}

/* ── HEDGE ─────────────────────────────────────────────────────────────
   One hedged line is never a fact. */
export function hedgeFloor(text) {
  return HEDGE.test(stripDiscourseHead(text)) ? FAIL('hedged') : PASS('unhedged');
}

/* ── SARCASM ───────────────────────────────────────────────────────────
   Not a classifier: an abstention. Positive words plus an interjection or
   "just what" and both readings are withheld. */
export function sarcasmAbstain(text) {
  const t = normalise(text);
  const showy = INTERJECTION.test(t) || /\bjust what\b|\bexactly what\b/i.test(t) || /!\s*$/.test(t);
  const positive = /\b(brilliant|great|wonderful|fantastic|lovely|perfect|marvellous|marvelous|excellent)\b/i.test(t);
  return (showy && positive) ? FAIL('ambiguous_polarity') : PASS('literal');
}

/* ── TERM PROVENANCE ───────────────────────────────────────────────────
   A content word the FOUNDER introduced is not evidence the prospect
   disclosed anything. The corpus case: the founder said "gap" first, the
   prospect asked what he meant by it, and a naive ladder read that as an
   admission that a gap existed. */
const STOPW = new Set(('a an the and or but so if then than that this these those of to in on at for with by from as is are was were be been being am do does did have has had it its'
  + ' we you they i he she our your their my me us them not no yes will would can could should may might must about into over under between there here what which who how why when where more most some any all each every other same such only just very much many few own').split(' '));
export function contentWords(text) {
  return normalise(text).toLowerCase().replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/).filter((w) => w.length > 3 && !STOPW.has(w));
}
export function termProvenance(term, founderTextsBefore = [], prospectTextsBefore = []) {
  const t = String(term || '').toLowerCase();
  if (!t) return FAIL('no_term');
  const inProspect = prospectTextsBefore.some((x) => contentWords(x).includes(t));
  if (inProspect) return PASS('prospect_introduced');
  const inFounder = founderTextsBefore.some((x) => contentWords(x).includes(t));
  if (inFounder) return FAIL('founder_introduced');
  return PASS('novel_term');
}

/* ── STICKY DENIAL ─────────────────────────────────────────────────────
   Once the prospect explicitly denies a proposition, a later hedged or
   echoed line may not be read as agreeing to it. */
const DENIAL = /\b(i (didn't|did not|never) say|that's not what i said|i wouldn't say|i wouldn't assume|i didn't say)\b/i;
export function isExplicitDenial(text) { return DENIAL.test(normalise(text)); }
export function stickyDenial(term, priorProspectTexts = []) {
  const t = String(term || '').toLowerCase();
  const denied = priorProspectTexts.some((x) => isExplicitDenial(x) && contentWords(x).includes(t));
  return denied ? FAIL('previously_denied') : PASS('not_denied');
}

/* ── AUDIO PROVENANCE ──────────────────────────────────────────────────
   Pass 1 says whether the sentence was finished. It does not say whether it
   was audible. A turn assembled from a part with no measured audio may be
   shown and may be recorded -- it may not earn a positive event. */
export function audioProvenance(turn) {
  if (!turn) return FAIL('no_turn');
  if (turn.complete === false) return FAIL('incomplete_turn');
  if (turn.creditEligible === false) return FAIL('not_credit_eligible');
  const levels = [];
  if (turn.delivery && typeof turn.delivery.levelMean === 'number') levels.push(turn.delivery.levelMean);
  if (typeof turn.levelMean === 'number') levels.push(turn.levelMean);
  if (Array.isArray(turn.partLevels)) turn.partLevels.forEach((l) => levels.push(l));
  if (levels.length && levels.some((l) => l === 0)) return FAIL('no_measured_audio');
  return PASS('audible_and_complete');
}

/* Overlap of CONTENT words only, on word boundaries -- never String.includes.
   The measured failure this replaces: a three-word microphone fragment
   scored the highest-value event in the taxonomy because it shared the word
   "through" with the prospect's previous line. */
export function contentOverlap(a, b) {
  const A = new Set(contentWords(a));
  const B = new Set(contentWords(b));
  /* DIVIDING BY THE SMALLER SIDE MAKES ANY FRAGMENT SCORE 1.0. "New
     patients?" shares its only content word with a long earlier question and
     was being called a verbatim repeat of it. Both sides need enough content
     to compare, and the denominator is the larger side. */
  if (A.size < 2 || B.size < 2) return 0;
  let hit = 0;
  A.forEach((w) => { if (B.has(w)) hit += 1; });
  return hit / Math.max(A.size, B.size);
}

/* ── DOES THIS SENTENCE CLAIM ANYTHING AT ALL? ────────────────────────
   The question the unsupported-assumption admission never asked. It required
   the judge to quote the founder's turn and to quote a prospect line against
   it — both good rules, both untouched — but nothing checked that the quoted
   turn SAID anything. "So how is business?" asserts no fact whatever and was
   admissible as an unsupported assumption in three of four behaviour modes.

   I first tried to detect a claim ABOUT THEM, anchored on you/your. The
   corpus refused it: "So the website isn't pulling its weight" is exactly
   the fault this exists to catch and contains no second person at all. WHO
   the claim is about is already settled by the citations — the judge must
   quote the founder's turn and a contradicting prospect line. What was
   missing is only whether a claim was made.

   So the test is a claim's SHAPE, and everything it excludes is a shape that
   asserts nothing:

     A QUESTION      is not a claim, however pointed. Ordinary questions,
                     open discovery, and requests for clarification are all
                     questions, which is why none of them can reach this.
     A HEDGE         "I imagine", "it might be", "if ... would". A founder
                     thinking out loud is not stating a fact.
     THEIR OWN SIDE  "We help accountancy firms..." is a claim about the
                     FOUNDER, not about the prospect.
     COURTESY        "It is good to talk to you", "I know you are busy".
     TOO SHORT       "That makes sense." carries no proposition worth
                     convicting anyone over.

   A FACTIVE subordinate clause still counts even inside a question, because
   "when it does spill over, who picks it up?" takes the spill-over as given.
   `if` and `whether` are deliberately absent — those are the hypotheticals.

   This ADDS a requirement and weakens none: the founder's own words and a
   contradicting prospect line are still both required, and are checked
   either side of it. */
const ASSERT_FINITE = /\b(?:is|are|was|were|has|have|had|does|do|did|isn't|aren't|wasn't|weren't|hasn't|haven't|doesn't|don't|didn't|[a-z]+(?:s|ed|ing))\b/i;
const ASSERT_FACTIVE = /\b(?:when|since|now that|given that|because|seeing as)\s+(?:[^,?.!]{0,60}?\b(?:is|are|was|were|does|do|did|has|have|had)\b|(?:you|your)\b)/i;
const ASSERT_HEDGE = /\b(?:i (?:imagine|suspect|guess|assume|wonder|expect)|might|maybe|perhaps|possibly|presumably|i think|sounds like|seems like|do not know|don't know|correct me|if\b|would\b|could\b)\b/i;
/* A claim whose subject is the founder's own side is not a claim about the
   call's other party, whatever else it asserts. */
const ASSERT_OWN_SIDE = /^(?:so\s+|and\s+|but\s+)?(?:i|we|my|our)\b/i;
const ASSERT_SOCIAL = new RegExp([
  "\\byou(?:'re|\\s+are|\\s+must be|\\s+look|\\s+sound)?\\s*(?:busy|free|around|available|tied up|in the middle of|swamped)\\b",
  "\\b(?:good|nice|great|a pleasure) to (?:talk|speak|meet|chat)\\b",
  "\\bthanks?(?: you)? for (?:your|the) (?:time|help|patience)\\b",
  "\\bmy name is\\b",
].join('|'), 'i');
const MIN_CLAIM_WORDS = 5;

export function assertsSomething(text) {
  const whole = String(text == null ? '' : text).trim();
  if (!whole) return FAIL('nothing_said');
  for (const raw of whole.split(/(?<=[.?!])\s+/)) {
    const t = raw.trim();
    if (!t) continue;
    if (ASSERT_HEDGE.test(t) || ASSERT_SOCIAL.test(t)) continue;
    /* A factive frame asserts inside a question, so it is tested first. */
    if (ASSERT_FACTIVE.test(t)) return PASS('presupposed');
    if (/\?\s*$/.test(t)) continue;
    if (ASSERT_OWN_SIDE.test(t)) continue;
    if (t.split(/\s+/).filter(Boolean).length < MIN_CLAIM_WORDS) continue;
    if (ASSERT_FINITE.test(t)) return PASS('stated');
  }
  return FAIL('no_claim_made');
}

/* ── ASKING FOR A NEXT STEP ───────────────────────────────────────────
   ONE definition, shared by both producers. They used to keep their own:
   the behaviour classifier called "Would fifteen minutes on Tuesday work to
   go through it properly?" a close_request while the rule engine's shapes
   did not recognise it, so no authoritative `unearned_close` was ever raised
   and a founder who asked twice on nothing qualified received no card at all.
   Two producers disagreeing about whether something happened is worse than
   either of them being wrong, because nothing downstream can tell.

   DETECTING A CLOSE IS NEUTRAL. This answers "did they ask for a next
   step?" and nothing else. Whether the ask was EARNED is decided later from
   qualification, and this file has no opinion about it — a well-qualified
   close is a good move and must still be detected as a close.

   Three shapes, any one of which is an ask:

     PROPOSED   the founder puts the next step forward themselves —
                "could we book", "shall we set up", "let us get something in
                the diary". Either word order, because English allows both.
     TIME+ASK   a specific day or duration inside an offer frame —
                "would Thursday work", "does that work for you". A duration
                alone is a fact ("do many patients wait thirty minutes?");
                an offer frame alone is not a next step.
     MEET+ASK   a meeting noun inside an offer frame — "would you be open to
                a quick call". The noun alone is not enough: "what would you
                need to see before taking another meeting?" is a question
                about their criteria, not a request for the meeting.

   And four things that stop it being an ask at all: the prospect said it,
   it is negated, it is hypothetical, or it is reported speech. */
const CLOSE_VERB = '(?:book|set ?up|arrange|schedule|meet|pencil|suggest|propose|recommend|put (?:some )?time|get (?:something|some time|a time|it) in)';
/* ── A CLOSE THAT IS EXPLICITLY BEING DEFERRED ────────────────────────
   "Before I suggest anything, what happens to one that lands overnight?"
   is the OPPOSITE of a close. It is a founder announcing he is not asking
   for time yet -- which is the single most natural way to recover from
   having asked too early, and the phrasing a good rep reaches for first.

   It was scored as a close because CLOSE_VERB contains `suggest` and the
   proposal pattern only needs "i suggest". So the retry judge told a
   founder who had just corrected himself properly that he had
   `asked_for_time_again`. Observed in a real staging session: the one
   recovery the product exists to teach was the one it marked as a repeat.

   The deferral clause is REMOVED and the rest of the sentence judged on
   its own, rather than the whole line being excused -- so "before I
   suggest anything, shall we book Tuesday?" is still a close, because the
   close is in the half that survives the strip. */
const CLOSE_DEFERRED = new RegExp(
  `\\b(?:before|rather than|instead of|without)\\s+(?:i|we)?\\s*`
  + `(?:could|can|should|shall|might|will|would)?\\s*${CLOSE_VERB}(?:ing)?\\b[^,;:.!?-]*[,;:-]?`,
  'gi');
const CLOSE_PROPOSED = new RegExp([
  `\\b(?:we|i)\\s+(?:could|can|should|shall|might|will|would)?\\s*${CLOSE_VERB}\\b`,
  /* "here is what I would suggest: fifteen minutes where ..." */
  `\\bwhat (?:i|we) would ${CLOSE_VERB}\\b`,
  `\\b(?:could|can|should|shall|shall|might|why don'?t)\\s+(?:we|i)\\s+${CLOSE_VERB}\\b`,
  `\\blet(?:'s| us)\\s+${CLOSE_VERB}\\b`,
  `\\b(?:get|put) (?:something|some time|a time|it) in the (?:diary|calendar)\\b`,
].join('|'), 'i');
/* ── AN OFFER, NOT A QUESTION ABOUT ONE ───────────────────────────────
   A yes/no clause opening on would/could/shall is offering something:
   "Would fifteen minutes next week change your mind?" — which my first
   version missed because it insisted on the word "work", and which the
   corpus caught. A WH-question is asking about criteria instead: "What
   would you need to see before taking another meeting?" contains both
   `would` and `meeting` and requests nothing. The wh-word is the tell, so
   it is tested per clause rather than per sentence — "I could do Wednesday
   morning — does that work for you?" carries its offer in the second half. */
const CLOSE_MODAL_OFFER = /^(?:so\s+|and\s+|but\s+|ok(?:ay)?,?\s+|well,?\s+|then\s+)?(?:would|could|shall|can)\b/i;
/* "WORTH A" NEEDS ITS NOUN RIGHT NEXT TO IT. "Is that worth a look/chat/call?"
   is the sales idiom this exists to catch. "What would need to be true for
   it to be worth a SECOND look?" is a different, unrelated idiom --
   reconsidering, not scheduling -- and used to pass anyway: this bare
   `worth (?:a|an|it|...)\b` matched on "worth a" alone, and CLOSE_MEETING's
   separate bare "look" (used elsewhere in the same clause, or not) supplied
   the rest. A real staging call under Guided Live Reaction ended on a
   founder asking exactly that question. Standalone numbers ("worth
   fifteen?") and "worth it" stay loose -- neither is ambiguous the way a
   bare noun is -- but "a/an" now has to be followed immediately (with at
   most one short adjective between) by an actual close-noun. */
const CLOSE_NAMED_FRAME = /\b(?:does (?:that|this|either) work|are you (?:free|available|around|open)|how about|would you be open|worth (?:a|an)(?:\s+(?:quick|brief|short))?\s+(?:look|chat|call|conversation|minutes?)\b|worth it\b|worth (?:15|fifteen|20|twenty|30|thirty)\b|suits? you|let me know)\b/i;
const clausesOf = (t) => String(t).split(/[.?!;]+|\s+[—–-]\s+|,\s+(?=(?:so|and|but|then)\b)/i)
  .map((c) => c.trim()).filter(Boolean);
const closeAskFrame = (t) => clausesOf(t)
  .some((c) => CLOSE_MODAL_OFFER.test(c) || CLOSE_NAMED_FRAME.test(c));
const CLOSE_TIME = /\b(?:monday|tuesday|wednesday|thursday|friday|next week|this week|tomorrow|later this|\d{1,3}|ten|fifteen|twenty|thirty|half an hour)\b[^.?!]{0,20}?\b(?:minutes?|mins?|hour|morning|afternoon|week|day)?\b/i;
const CLOSE_DURATION = /\b(?:\d{1,3}|ten|fifteen|twenty|thirty|half an hour)\s*(?:minutes?|mins?|hour)\b/i;
const CLOSE_DAY = /\b(?:monday|tuesday|wednesday|thursday|friday|next week|this week|tomorrow)\b/i;
const CLOSE_MEETING = /\b(?:meeting|call|demo|chat|catch[- ]?up|follow[- ]?up|conversation|look)\b/i;
/* BARE `if` IS NOT A HYPOTHETICAL CLOSE. "Fifteen minutes where I show you
   where those enquiries are going, and if it is not worth acting on you tell
   me and we stop" is a real ask with a reassurance attached — the corpus
   case my first version rejected outright. Only framings that make the
   MEETING itself imaginary count. */
const CLOSE_HYPOTHETICAL = /\b(?:whenever|were we to|hypothetically|one day|some day|ever (?:spoke|speak|talk|met|meet))/i;
const CLOSE_REPORTED = /\b(?:they|he|she|you|people|someone)\s+(?:said|says|told|mentioned|suggested|reckons?)\b/i;

/* ── "IT'S NOT YOUR CALL" IS ABOUT AUTHORITY, NOT ABOUT A MEETING ──────
   CLOSE_MEETING lists `call` as a meeting noun, and that noun also sits
   inside the commonest authority idiom in English sales. Measured on Call D
   sequence 9: a turn that refused to pitch, acknowledged the prospect's
   authority and asked to be routed passed as `offered_a_meeting`, failed the
   earned test, and was reported as "You asked for time you had not earned".
   The single word that flipped it was the founder ACKNOWLEDGING authority --
   the best thing in the turn. `decision` and `remit` in the identical
   sentence correctly did not fire, so the classifier disagreed with itself.

   AUTHORITY_DISCLAIM already encodes this idiom for the prospect side. This
   is the same knowledge applied where the noun is read, and it is a MASK
   rather than a veto: only the idiom's own span is removed, so a turn that
   acknowledges authority AND genuinely proposes a time is still a close.
   Second person is included because the founder is the one saying it back. */
const AUTHORITY_NOUN_IDIOM = new RegExp([
  "\\b(?:that|it|this)(?:'s| is| was|s)?\\s*(?:is\\s+)?(?:not|n'?t)\\s+(?:really\\s+)?"
    + "(?:my|your|his|her|their|our|the)\\s+(?:call|decision|area|department|remit|shout)\\b",
  "\\b(?:not|n'?t)\\s+(?:my|your|his|her|their|our)\\s+(?:call|decision|shout)\\b",
  "\\b(?:my|your|his|her|their|our)\\s+(?:call|decision|shout)\\s+to\\s+make\\b",
  "\\bwhose\\s+(?:call|decision)\\s+(?:it\\s+)?is\\b",
  /* A THIRD SENSE OF THE SAME WORD. "a call that rings out", "calls that
     come in", "when the call ends up in voicemail" -- an INBOUND enquiry the
     prospect receives, not a meeting the founder is proposing. Measured on
     the strongest organic call: a discovery question about missed enquiries,
     wrapped in courtesy ("Can I check one thing before I let you go"), was
     convicted as an unearned close because `call` appeared as a noun. */
  "\\b(?:a|the|that|those|any|their|your)\\s+calls?\\s+(?:that|which)\\s+\\w+",
  "\\bcalls?\\s+(?:ring|rings|ringing|come|comes|coming|go|goes|going|end|ends|ending)\\s+(?:out|in|up|through)\\b",
  "\\bmissed\\s+calls?\\b", "\\binbound\\s+calls?\\b",
].join('|'), 'gi');

export function isCloseAttempt(text, { speaker = 'founder' } = {}) {
  const t = normalise(String(text == null ? '' : text));
  if (!t) return FAIL('nothing_said');
  /* A close is a FOUNDER move. The prospect proposing a time is them
     qualifying themselves, and recording it as the founder's close would
     credit or convict the wrong person. */
  if (speaker && speaker !== 'founder') return FAIL('not_the_founder');
  if (CLOSE_REPORTED.test(t)) return FAIL('reported_speech');
  if (CLOSE_HYPOTHETICAL.test(t)) return FAIL('hypothetical');

  /* Judged on what is left once any deferred proposal is taken out. If the
     whole line was the deferral, there is nothing here to call a close. */
  const t2raw = t.replace(CLOSE_DEFERRED, ' ').replace(/\s+/g, ' ').trim();
  if (!t2raw) return FAIL('deferred_the_next_step');
  /* The idiom's span carries no close content, so removing it cannot hide
     one. What it removes is a meeting noun that was never a meeting. */
  const t2 = t2raw.replace(AUTHORITY_NOUN_IDIOM, ' ').replace(/\s+/g, ' ').trim();
  if (!t2) return FAIL('authority_disclaim_only');

  const proposed = CLOSE_PROPOSED.test(t2);
  const asking = closeAskFrame(t2);
  const timed = CLOSE_DURATION.test(t2) || CLOSE_DAY.test(t2);
  const meeting = CLOSE_MEETING.test(t2);
  if (!proposed && !(asking && (timed || meeting))) return FAIL('no_next_step_requested');

  /* "I am not asking you to book anything." */
  const anchor = proposed ? CLOSE_PROPOSED
    : (CLOSE_NAMED_FRAME.test(t2) ? CLOSE_NAMED_FRAME : /\b(?:would|could|shall|can)\b/i);
  const affirmed = polarityIsAffirmed(t2, anchor);
  if (!affirmed.pass) return FAIL(`negated:${affirmed.reason}`);
  if (!attribution(t2, anchor).pass) return FAIL('not_the_speakers_own');
  return PASS(proposed ? 'proposed_a_next_step' : (timed ? 'offered_a_time' : 'offered_a_meeting'));
}

/* ── A QUESTION THAT ADVANCES NOTHING ─────────────────────────────────
   Weak discovery had no word in the fault vocabulary, so a founder who
   asked "So how is everything going?" twice got a review with nothing in it.

   WEAK IS NOT THE SAME AS BROAD. "How is reconciliation work being covered
   at the moment?" is wide open and is the best question on the call, because
   it asks for something specific about them. What makes a question weak is
   that it engages with NOTHING the call has established and asks for nothing
   in particular — the prospect has to invent the agenda.

   Three ways out, and each protects a founder doing something reasonable:
   a clarification is not discovery; a question carrying any term from the
   conversation is engaging with it; and after a refusal a broad question is
   the sensible move rather than a fault. */
/* Asking someone to repeat themselves is a clarification, not a discovery
   failure — and asking a prospect to restate an objection is not mishandling
   it. Repeat-requests carry no subject of their own, so without naming them
   here they fall straight through to "no subject" and get convicted. */
const WEAK_CLARIFY = /\b(?:sorry|pardon|just to check|can i (?:just )?check|do you mean|did you mean|what do you mean|to be clear|if i (?:have|understand)|say (?:that|it) again|come again|repeat that|run that by me)\b/i;
/* Words that carry no subject. A question built only from these is asking
   the prospect to decide what the call is about. */
const WEAK_STEMS = new Set(['what', 'how', 'when', 'where', 'which', 'who', 'why', 'that', 'this',
  'thing', 'things', 'stuff', 'going', 'good', 'well', 'okay', 'fine', 'business', 'everything',
  'anything', 'something', 'guys', 'yourself', 'much', 'many', 'like', 'been', 'doing', 'about',
  'there', 'here', 'they', 'them', 'your', 'yours', 'with', 'from', 'have', 'does', 'right',
  'now', 'today', 'lately', 'recently', 'these', 'those', 'else', 'over']);

export function isWeakDiscovery(text, { vocabulary = null, refused = false } = {}) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return FAIL('nothing_said');
  if (!/\?\s*$/.test(raw)) return FAIL('not_a_question');
  if (WEAK_CLARIFY.test(raw)) return FAIL('a_clarification');
  /* THE PROSPECT'S SILENCE IS NOT THE FOUNDER'S FAULT. After a refusal a
     broad question is the reasonable move, not a weak one. */
  if (refused) return FAIL('reasonable_after_a_refusal');
  const t = normalise(raw);
  const words = t.split(' ').filter((w) => w.length > 3).map((w) => w.replace(/[^a-z]/g, ''));
  const content = words.filter((w) => w && !WEAK_STEMS.has(w));
  /* Anything the call already contains means the question is engaging with
     it, however short. */
  if (vocabulary && vocabulary.size) {
    const engages = content.some((w) => vocabulary.has(w)
      || [...vocabulary].some((v) => v.length > 4 && (v.startsWith(w.slice(0, 5)) || w.startsWith(v.slice(0, 5)))));
    if (engages) return FAIL('engages_with_the_conversation');
  }
  /* Two substantive words of its own is enough to be asking something. */
  if (content.length >= 2) return FAIL('asks_for_something_specific');
  return PASS('no_subject_and_nothing_from_the_call');
}

/* ── AN OBJECTION THAT WAS NOT HANDLED ────────────────────────────────
   The six-industry proof planted a mishandled objection and the review
   never mentioned it: there was no fault type for it, so the founder was
   coached about assumptions while the actual headline mistake went unnamed.

   HANDLING AN OBJECTION MEANS ENGAGING WITH IT. Exploring it, asking what
   it covers, clarifying it, or leaving well are all correct and none of them
   is a fault. What is a fault is doing something ELSE while it stands:
   pitching over it, closing over it, or arguing past it.

   The objection must already be open — read from the state BEFORE this turn,
   so a fault can never be raised for a turn that preceded it. */
const OBJ_ARGUING = /\b(?:but honestly|but most (?:firms|people|clients|practices)|most (?:firms|people|clients|practices) (?:say|think|tell)|i understand,? but|that said,? but|everyone else|you would be surprised)\b/i;
const OBJ_EXPLORING = /\b(?:what (?:made|led|prompted)|what does .{0,30}(?:look like|cover|involve)|how (?:long|come)|what would have to|in what way|tell me (?:more|about)|why (?:did|do) you)\b/i;
const OBJ_EXIT = /\b(?:leave it there|nothing here for you|not the right (?:fit|time)|thanks for being straight|take you off)\b/i;

export function objectionMishandled(text, { objection = null, isPitch = false, isClose = false } = {}) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return FAIL('nothing_said');
  if (!objection) return FAIL('no_objection_open');
  /* Leaving well is the correct move, not a mishandle. */
  if (OBJ_EXIT.test(raw)) return FAIL('left_the_call_professionally');
  /* Engaging with it in any of the ways that count as handling it. */
  if (OBJ_EXPLORING.test(raw)) return FAIL('explored_the_objection');
  /* A clarification does NOT outrank a pitch or a close. "Say that again —
     is it worth a look next week?" asks them to repeat themselves and then
     presses the close anyway: the prefix engages with nothing. Exploring
     stays above these because a real question about the objection IS
     handling it, even when a next step is floated in the same breath. */
  if (isPitch) return PASS('pitched_over_an_open_objection');
  if (isClose) return PASS('closed_over_an_open_objection');
  if (WEAK_CLARIFY.test(raw)) return FAIL('clarified_the_objection');
  if (OBJ_ARGUING.test(raw) && polarityIsAffirmed(raw, OBJ_ARGUING).pass) {
    return PASS('argued_past_an_open_objection');
  }
  return FAIL('engaged_or_neutral');
}

/* ── WHAT COUNTS AS THE FOUNDER PUTTING SOMETHING FORWARD ─────────────────
   Lifted here UNCHANGED from the rule engine, which still imports them, so
   there is one answer to "was that a pitch?" rather than two that drift.
   Close detection was split like this once already and it cost a phase. */
/* ── ONE LIST OF WHO A PITCH CAN BE AIMED AT ────────────────────────────
   OFFER_VALUE, PITCH_LEGACY and PITCH_INTENT each carried their own copy of
   this alternation, and they had already drifted: three slightly different
   orderings of the same nine words. A founder describing the OFFER in terms
   of the FUNCTION it serves rather than the business type or a pronoun --
   "we run overflow cover for front desks", never naming "you" or a business
   noun at all -- matched none of the three copies and fell through to
   `generic_question`. A real staging call under Guided Live Reaction Pressure
   found it: an earned pitch registered as nothing, so Interest never got the
   chance to fire on the one turn it existed to describe.

   `firms?/practices?/clinics?/teams?/clients?/businesses/companies` name the
   BUSINESS; `front desks?/receptions?/offices?/surgeries?` name the
   FUNCTIONAL UNIT within one -- the same synecdoche, one level down, and
   just as common in real sales speech ("we cover front desks", "we support
   receptions"). One list now, spliced into all three patterns, so a fourth
   copy cannot quietly diverge from the other three again. */
const BENEFICIARY_NOUNS = '(?:you|your|them|their|firms?|practices?|clinics?|teams?|clients?|'
  + 'businesses|companies|front desks?|receptions?|offices?|surgeries?)';

export const OFFER_COMMERCIAL = /(\b(costs?|pricing|it's about|we charge)\b)|([£$€]\s?\d)|(\b\d[\d,.]*\s*(k\b|hundred|thousand)?\s*(a|per)\s+(month|week|year))|(\bwe (run|manage|handle|build|set up|deliver|provide) (your|the|all)\b)|(\bour (service|package|programme|program) (is|includes|covers)\b)/i;
/* "pick up" added torture-testing the classifier a second time: "we pick up
   that overflow so those calls still get answered live" is a plain,
   commonly-said pitch for exactly the phone-overflow product this corpus
   is full of, and it missed 4/4 real paid staging calls, every one of them
   scored generic_question -- a pitch reaching the review as if it never
   happened. Same semantic cluster as the already-listed "take"/"handle",
   not a new category, so it does not widen what counts as an offer. */
export const OFFER_VALUE = new RegExp('\\b(?:we|i)\\s+(?:can|could|will|would|do|also)?\\s*(?:help|work with|save|cut|reduce|shorten|halve|take|run|handle|manage|pick up|free up|speed up)\\b[^.?!]{0,60}?\\b' + BENEFICIARY_NOUNS + '\\b', 'i');
/* ── WHAT THEY SAY THEY DO FOR YOU ───────────────────────────────────
   OFFER_COMMERCIAL wants a price or a named package; OFFER_VALUE wants a
   help-verb aimed at a noun for the buyer. Between them they caught four of
   thirteen pitches a rep actually makes -- "what we do is plug into your
   website", "our platform answers the phone", "we can get you 30% more
   bookings" were all invisible, so premature pitch almost never paused.

   This is the third shape and the commonest one: a first-person subject, or
   the product itself, DOING something. Bounded deliberately -- each
   alternative needs the capability to point at the buyer, at a named
   product, or at a `that` clause, because "I run a small studio in Sydney"
   is a founder describing himself and must stay clean. Measured against a
   labelled set built before this existed. */
const OFFER_CAPABILITY = new RegExp([
  /* "what we do is …" / "so what we would do is …" */
  '\\bwhat (?:we|i) (?:would |can |could )?do is\\b',
  /* "we offer you …" / "we can get you …" / "I give you …" */
  '\\b(?:we|i) (?:can |could |will |would |also )?(?:offer|provide|give|get) (?:you|your|them|their|a|an|the)\\b',
  /* the product itself acting: "our platform answers", "the tool sends" */
  '\\b(?:our|the) (?:platform|tool|system|software|service|product|setup|bot|assistant)\\b[^.?!]{0,40}?\\b\\w+s\\b',
  /* "I build systems that …" — the `that` clause is what makes it an offer */
  '\\b(?:we|i) (?:build|make|set up|run|operate)\\b[^.?!]{0,40}?\\bthat\\b',
  /* "we sit on top of your …" / "we plug into your …" */
  '\\b(?:we|i) (?:sit|plug|hook|integrate|connect)\\b[^.?!]{0,30}?\\byour\\b',
].join('|'), 'i');

export const OFFER_CONTENT = new RegExp(
  `(${OFFER_COMMERCIAL.source})|(${OFFER_VALUE.source})|(${OFFER_CAPABILITY.source})`, 'i');

/* ── LIFTED UNCHANGED FROM THE FOUNDER'S OWN CLASSIFIER ────────────────
   `prospect-behaviour.js`'s own `RE.pitch` -- already tuned against three
   separate real staging failures (a rebuttal misread as a pitch, a loss-
   framing question misread as pricing, "book" matching a literal
   appointment book). Copied verbatim rather than narrowed to the pieces
   OFFER_VALUE/OFFER_CAPABILITY also cover, because THIS regex is the one
   with the numeric-proximity guard on `costs?` -- OFFER_COMMERCIAL above
   has a bare, unguarded `costs?` and would reintroduce a bug already fixed
   once in this exact file if it were relied on alone. */
const PITCH_LEGACY = new RegExp('\\b(we (offer|provide|do|help|run|handle|manage|cover|look after|specialise|specialize|work with)\\b[^.?!]{0,40}?\\b' + BENEFICIARY_NOUNS + '\\b|our (service|package|system|programme|program)|costs?\\b(?=[^.?!]{0,25}(?:£|\\$|\\d|hundred|thousand|month|year))|(?:£|\\$|\\d|hundred|thousand)[^.?!]{0,18}?\\b(?:per|a|each) (?:month|year)\\b|per month|pricing|package|sign up|get started|i can (get|bring|deliver))\\b', 'i');

/* ── THE ONE SHAPE NONE OF THE ABOVE COVERS ────────────────────────────
   OFFER_COMMERCIAL, OFFER_VALUE, OFFER_CAPABILITY and PITCH_LEGACY all read
   the founder DESCRIBING THE PRODUCT ("we run...", "our platform...", "we
   offer..."). A founder narrating their own INTENT -- "I'm trying to get
   you...", "I'd like to offer you...", "we're here to give you..." -- is a
   different, equally ordinary grammatical shape, and it was invisible
   everywhere: PITCH_LEGACY's own first-person branch matched only "I can
   get/bring/deliver", three verbs behind one modal. "I'm trying to get you
   guys an AI receptionist" (a real staging call) fell all the way through
   to `generic_question`, which silently emptied Pitch Timing AND Objection
   Handling downstream -- the objection-raise condition in
   prospect-behaviour.js reads this same classification.

   Bounded exactly like OFFER_VALUE and OFFER_CAPABILITY already are: an
   intent marker, a delivery verb, aimed at the buyer within a short span.
   "I'm trying to help" with nothing named is not yet a pitch, and never
   will be under this pattern.

   TWO SHAPES, not one, because "set you up with" already NAMES the
   beneficiary inside the verb phrase -- "we're here to set you up with
   call overflow cover" has nothing left to require afterwards, and a
   single shared trailing requirement made this branch unreachable.

   ONE NAMED EXCLUSION, found by stress-testing this exact pattern against
   ordinary discovery language before it shipped: "get" alone is excluded
   when it means UNDERSTANDING rather than DELIVERING -- "I'd like to get
   an idea of what's slowing you down" is discovery, not a pitch, and
   reads identically to "I'd like to get you set up" until this guard. */
export const PITCH_INTENT = new RegExp("\\b(?:i|we)\\s*(?:'m|'re| am| are)?\\s*(?:can|could|want(?:s)? to|would like to|'d like to|'d love to|would love to|trying to|here to|calling to|hoping to|looking to|about to)\\s+(?:set (?:you|your \\w+) up with\\b|(?:offer|give|get(?!\\s+(?:a\\s+(?:sense|feel|picture)|an\\s+(?:idea|understanding))\\s+(?:of|for))|bring|provide|deliver)\\b[^.?!]{0,40}?\\b" + BENEFICIARY_NOUNS + ")", 'i');

/* A verb aimed at the buyer that turns out to be scheduling a CALLBACK, not
   naming a product, is not an offer -- "I could give you a call back
   tomorrow to go through the numbers" is logistics. Checked separately,
   against the whole line, so it applies whichever pattern above happened
   to match: OFFER_CAPABILITY's own "give you a/an" branch is exactly as
   exposed to this as PITCH_INTENT is. */
const PITCH_CALLBACK = /\b(?:give|get|bring)\s+(?:you|your)\s+(?:a\s+)?(?:call|ring|shout)\s*(?:back)?\b/i;

/* ── ONE ANSWER TO "WAS THAT A PITCH?" ──────────────────────────────────
   The same discipline as isCloseAttempt below: negation, attribution and
   speaker are checked, not just a keyword match. Checked in this order
   because it is the order a real sentence is most likely to satisfy one
   of them, not a priority ranking -- whichever pattern matches supplies
   the anchor that polarity and attribution are checked against. */
const PITCH_PATTERNS = [OFFER_COMMERCIAL, OFFER_VALUE, OFFER_CAPABILITY, PITCH_LEGACY, PITCH_INTENT];

/* ── `cost` IS A VERB BEFORE IT IS A PRICE ────────────────────────────
   REGRESSION GUARD, and it has been earned twice. The behaviour engine's
   own pitch pattern used to require a cost word to LOOK like pricing -- a
   number, a currency or a period in the same clause -- precisely because
   "does that ever cost you a registration?" is a loss-framing discovery
   question and was, on the acceptance run, the single best question asked.

   Folding pitch detection into this one gate re-imported the flaw: the
   commercial pattern lifted from the rule engine matches a BARE `costs?`,
   so the guard was silently dropped and the best question in the corpus
   was convicted as a premature pitch again. Under Brutal pressure that
   conviction is terminal, so a founder asking the right question got hung
   up on -- which is how this was caught.

   Applied ONLY when the cost word is the whole of what matched. A sentence
   that also matches an offer shape ("we run overflow, it costs two
   hundred") is a pitch on the strength of that other shape and never
   reaches here. OFFER_COMMERCIAL itself is deliberately untouched:
   founderAdvancedSomething() and the rule engine read it for a different
   question -- whether the founder advanced ANYTHING an objection could push
   back on -- and a loss-framing question genuinely does advance something. */
/* ── A NEGATION THE MATCH SWALLOWED ──────────────────────────────────
   `negatedBeforeMatch` looks at the text BEFORE the anchor, which is the
   right question for a tight pattern. The legacy pitch shape is not tight:
   `we (offer|provide|do|...)...(you|your)` spans "we DO not offer YOU", so
   the negation lands inside the match and the guard never sees it. Checked
   within the span as well, and deliberately only for AUXILIARY negation
   directly on the verb -- "never" is excluded on purpose, because "we handle
   the overflow so you never have to worry about it" is an ordinary pitch and
   refusing it would trade one false positive for another. */
const NEGATED_WITHIN = /\b(?:do|does|did|are|is|am|was|were|will|would|can|could|have|has)\s*n(?:o|')t\b/i;
const COST_WORD_ONLY = /^costs?$/i;
const COST_IS_PRICING = /\bcosts?\b(?=[^.?!]{0,25}(?:£|\$|\d|hundred|thousand|month|year))/i;

export function isPitchAttempt(text, { speaker = 'founder' } = {}) {
  const t = normalise(String(text == null ? '' : text));
  if (!t) return FAIL('nothing_said');
  /* A pitch is a FOUNDER move. The prospect describing what a competitor
     offers is not the founder pitching, and scoring it as one would
     credit or convict the wrong person. */
  if (speaker && speaker !== 'founder') return FAIL('not_the_founder');

  const anchor = PITCH_PATTERNS.find((re) => re.test(t));
  if (!anchor) return FAIL('no_offer_content');
  if (PITCH_CALLBACK.test(t)) return FAIL('scheduling_a_callback');

  const matched = (t.match(anchor) || [''])[0];
  if (COST_WORD_ONLY.test(matched.trim()) && !COST_IS_PRICING.test(t)) {
    return FAIL('cost_as_loss_framing');
  }
  if (NEGATED_WITHIN.test(matched)) return FAIL('negated:within_match');

  const affirmed = polarityIsAffirmed(t, anchor);
  if (!affirmed.pass) return FAIL(`negated:${affirmed.reason}`);
  if (!attribution(t, anchor).pass) return FAIL('not_the_speakers_own');

  return PASS('made_an_offer');
}

/* A denial can only push back on something. This is that something: a claim
   about their business, an offer, a proposal or promise, or an ask for time.

   Deliberately WIDER than `assertsSomething`, which answers a different and
   narrower question -- did the founder state a fact about the prospect --
   and which correctly says no to "we handle the whole intake process", a
   pitch about the founder's own side. A prospect can absolutely push back
   on a pitch, so the pitch has to count here while still not counting as
   an assumption about them. */
const ADVANCE_PROMISE = /\b(?:you'?ll|you will|it'?ll|it will|that'?ll|we'?ll)\b[^.?!]{0,60}?\b(?:see|get|save|notice|find|be able|difference)\b|\bonce we\b/i;

/* WHY THIS EXISTS RATHER THAN LEANING ON `assertsSomething`:
   "Every missed call is costing you around two thousand pounds a month" is
   not read as a claim, because ASSERT_SOCIAL's "you ... around" branch --
   written for "are you around?" -- matches "costing you around". That is a
   real hole, and it suppresses this shape of claim in the diagnosis layer
   too, but fixing it there would change what counts as an unsupported
   assumption, which is not what this step is allowed to touch. Recorded as
   a defect; routed around here so objection recognition is not held hostage
   to it. */
const ADVANCE_IMPACT = /\b(?:costing|losing|costs?) (?:you|your)\b|\b(?:you|your)\b[^.?!]{0,40}?\b(?:losing|missing out|leaving money)\b/i;

export function founderAdvancedSomething(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return FAIL('nothing_said');
  if (assertsSomething(raw).pass) return PASS('claimed_something_about_them');
  if (OFFER_CONTENT.test(raw) && polarityIsAffirmed(raw, OFFER_CONTENT).pass) return PASS('made_an_offer');
  if (ADVANCE_PROMISE.test(raw)) return PASS('promised_an_outcome');
  if (ADVANCE_IMPACT.test(raw)) return PASS('claimed_it_costs_them');
  if (isCloseAttempt(raw).pass) return PASS('asked_for_their_time');
  return FAIL('advanced_nothing_to_push_back_on');
}

/* ── COERCION ──────────────────────────────────────────────────────────
   The phrase list, moved here unchanged from the rule engine so both the
   producer and the admission layer read pressure through one definition.
   Splitting this in two is how the close predicate drifted for a phase. */
/* FEAR APPEALS are a second shape of coercion, and the trap is that they
   share every noun with ordinary competitive conversation. "Your
   competitors are dealing with the same bottleneck" is an observation;
   "your competitors are already ahead of you" is a threat. What separates
   them is a second-person claim that THEY are losing -- so the subject is
   part of the pattern, not just the vocabulary. "A lot of work ahead of
   you" is not coercion either, which is why the rival phrasing has to say
   ALREADY ahead of you. */
/* THE THREAT IS USUALLY IN THE FUTURE TENSE. This caught "you are falling
   behind" but not "you ARE GOING TO fall behind if you do not act now" --
   measured on staging in the integrated acceptance run, where that line
   reached the prospect classified `generic_question`, raised no overreach
   and triggered no pause. It is the same coercive move one tense later, and
   the commoner phrasing of the two: a threat about now is a claim, a threat
   about later is the push. */
const FEAR_APPEAL = /\b(you(?:'re| are)? (?:falling|getting left|being left) behind|you(?:'ll| will|'re going to| are going to) (?:fall|get left|be left) behind|you(?:'ll| will) miss out|falling behind if you|already ahead of you)\b/i;

/* AN ADVERB IS NOT A DEFENCE. "You really need to sort this out" is the
   same move as "you need to sort this out", and it is the more common
   phrasing of the two -- but the adjacency requirement meant any word
   between `you` and `need to` made the pressure invisible. Measured on
   seven lines a rep would actually say, four were missed. The list is
   bounded rather than `\w+` so that "you seem to need to" -- an
   observation, not a push -- still does not match. */
const PRESSURE_ADVERB = '(?:really|just|probably|definitely|honestly|simply|absolutely|genuinely|actually)';
export const PRESSURE = new RegExp(
  new RegExp(`\\b(you ${PRESSURE_ADVERB}? ?(?:need|have) to|trust me|no[- ]brainer|come on|just give me|i'll be honest with you,? you)\\b`, 'i').source
  + '|' + FEAR_APPEAL.source, 'i');

/* IS THIS COERCION, ON THE EVIDENCE ALONE?

   The behaviour engine calls a turn "pressure" on phrase adjacency alone,
   which is why "what would you need to see before you'd change anything?"
   -- a genuinely good discovery question -- reads as pressure to it. That
   looseness is real and this gate does not forgive it: a question is not
   coercion, and neither is a sentence that DECLINES to coerce.

   These are the same two gates the rule engine applies to its own pressure
   rule. Nothing here makes pressure easier to detect; it makes an already
   detected claim prove it is not one of the two known impostors. */
export function coercionAdmissible(text) {
  const raw = normalise(text);
  if (!raw) return FAIL('nothing_said');
  if (!PRESSURE.test(raw)) return FAIL('no_coercive_phrase');
  if (/\?\s*$/.test(raw.trim())) return FAIL('a_question');
  if (!polarityIsAffirmed(raw, PRESSURE).pass) return FAIL('negated');
  return PASS('coercive_phrase_affirmed_and_not_a_question');
}

/* ── DISCLAIMED AUTHORITY ─────────────────────────────────────────────
   THE ONE FAULT THAT CAN PUNISH GOOD SELLING.

   "Pitched a non-buyer" is the only CRITICAL fault Practice issues, and the
   only one whose ground truth VISION privately holds: Controlled Uncertainty
   picks the hidden role before the call starts. Judged against that hidden
   role, a founder who read a genuinely ambiguous prospect the way a competent
   rep would could be convicted of a mistake the transcript never contained.
   That is the exact complaint levelled at scripted roleplay trainers -- being
   marked down for a good call because the words did not match the expected
   path -- and it is fatal to a product whose whole claim is proof.

   So: the hidden role decides who ANSWERS. It never decides who was WRONG.
   The fault is admissible only on what a person listening to the recording
   could point at, in this order:

     1. The prospect DISCLAIMED authority, or offered to route the call, in
        their own words -- affirmed, not a question, not hedged, not somebody
        else's words repeated.
     2. The founder pitched AFTER that turn. Order is the entire fault. A
        pitch BEFORE the disclaimer is ordinary selling into the unknown; the
        fault is ignoring what you were told, never guessing wrong.

   AMBIGUITY ACQUITS. "I handle some of that" disclaims nothing, so a founder
   who pitches a plausible influencer has made a judgement call, not a
   critical mistake. When no line clears the bar the gate FAILs and the
   Nuance Judge may still comment -- it just may not call it critical. */

/* Two shapes, and both are the PROSPECT volunteering it. Nothing here fires
   on the founder inferring it, on a job title, or on tone.
     DISCLAIM  -- "that's not my call", "I don't decide that"
     ROUTE     -- "I'll put you through", "you'd need to speak to Dr Chen"
   `speak to` requires a following person-word for a reason: without it the
   pattern matched "good to speak to you", which is a pleasantry. */
const AUTHORITY_DISCLAIM = new RegExp([
  "(?:that|it|this)(?:'s| is) not (?:my|really my) (?:call|decision|area|department|remit)\\b",
  "\\bi (?:do ?n'?t|cannot|can'?t) (?:make (?:that|the) (?:call|decision)|decide(?:\\s+(?:that|this|on that))?)\\b",
  /* GENERALIZED, not special-cased: "one" was the only accepted noun --
     "person" (and "right person", already separate) describes exactly the
     same intent and belongs in the same admission, not a phrase added for
     one sentence. */
  "\\b(?:i'?m|i am) not the (?:right person|(?:one|person) who decides|decision[- ]maker)\\b",
  /* THIRD-PARTY FRAMING, the same intent stated about someone else instead
     of the self. Bounded to the explicit deciding verb -- naming a role
     alone is not evidence, exactly the discipline the semantic constraint
     admission already holds itself to. */
  "\\b(?:someone|somebody) else decides\\b",
  "\\b(?:my |our |the )?(?:manager|owner|director|partner|boss|principal|practice manager) (?:makes|decides on) (?:that|this|those|these|vendor)\\b",
  "\\bi (?:just|only) (?:answer the phones?|work (?:on |at )?(?:reception|the front desk))\\b",
  "\\b(?:you'?d|you would|you'?ll|you will) (?:need|want|have) to (?:speak|talk) to (?:the|our|my|dr|mr|mrs|ms|whoever|someone|somebody)\\b",
  "\\b(?:i'?ll|i will|let me|shall i) (?:put you through|transfer you|pass you (?:over|on))\\b",
  "\\bthat(?:'s| is| would be) (?:the |our |a )?(?:owner|director|manager|partner|principal|practice manager|boss)(?:'s)? (?:call|decision|area)\\b",
  /* SIGN-OFF FRAMING. The same fact stated about the DECISION rather than
     about the speaker -- "anything like that needs signing off elsewhere"
     says exactly what "that's not my call" says, and volunteering it that
     way is the commonest natural phrasing of all. Two parts are BOTH
     required, which is what keeps it as conservative as the rest of the
     ladder: an approval verb AND an explicit somewhere-or-someone that is
     not the speaker. Either alone is ambiguous -- "I'd have to get it
     approved" never says by whom, and naming the partners is not a
     disclaimer. Both word orders, because "signed off by the principal"
     and "the principal would sign that off" are one intent, and admitting
     only the first would be a phrase added for one sentence rather than a
     reading of the family. */
  "\\b(?:sign(?:s|ed|ing)?(?:\\s+\\w+){0,2}\\s+off|approv(?:e|es|ed|al))\\b[^.!?]{0,24}?"
    + "\\b(?:elsewhere|higher up|further up|upstairs|head office"
    + "|above my (?:pay grade|level)|(?:by|from) (?:someone|somebody) else"
    + "|(?:by|from) (?:the|our|my) (?:owner|director|partners?|principal|practice manager|boss|manager))\\b",
  "\\b(?:(?:someone|somebody) else|head office"
    + "|(?:the|our|my) (?:owner|director|partners?|principal|practice manager|boss|manager))\\b"
    + "[^.!?]{0,24}?\\b(?:sign(?:s|ed|ing)?(?:\\s+\\w+){0,2}\\s+off|approv(?:e|es|ed|al))\\b",
].join('|'), 'i');

/* ── THE TRANSFER SPENDS THE DISCLAIMER ───────────────────────────────
   A disclaimer is about the person who said it. Once the call has been
   handed to somebody else, it says nothing about whoever is now on the line.

   Without this, the gate convicts the founder for doing the RIGHT thing: a
   receptionist says "that's not my call, I'll put you through", the call is
   transferred, the founder pitches the owner -- and the gate, which reads
   every prospect turn before the pitch, finds the receptionist's disclaimer
   and calls it a critical fault. Pitching the decision-maker is the entire
   objective. It was written before transfers existed.

   THE BOUNDARY IS IN THE TRANSCRIPT, NEVER IN THE SIMULATOR. The server
   knows when it swapped roles, and may not say so here: a boundary taken
   from hidden state is hidden state deciding a score. What counts is a new
   person audibly arriving -- self-identifying, or being announced -- after a
   routing offer was made.

   NARROW, AND BIASED TOWARD ACQUITTAL. A transfer this misses convicts a
   founder who did the right thing; a transfer it imagines merely lets one
   go. Those errors are not equal, so the pattern accepts a plain greeting
   after a routing offer, which a continuing speaker has no reason to
   produce. */
/* WP4: exported so Boundary A (prospect-dialogue.js) can check the MODEL's
   own reply against the identical phrasing post-call already trusts for
   "offered a transfer" -- one definition, never two that could disagree. */
export const ROUTING_OFFER = new RegExp([
  "\\b(?:i'?ll|i will|let me|shall i) (?:put you through|transfer you|pass you (?:over|on)|get (?:him|her|them))\\b",
  "\\bputting you through\\b",
  "\\b(?:one|just a) (?:moment|second|sec|minute)\\b",
  "\\bbear with me\\b",
  "\\bhold on\\b",
].join('|'), 'i');

/* WP4: not every ROUTING_OFFER alternative commits to a transfer ON ITS
   OWN. "Bear with me one second" / "hold on" / "one moment" are ordinary
   pause requests a continuing speaker uses constantly, with no transfer
   ever following -- transferBoundaries already builds this caution in:
   ANY match sets its own local flag, but only a LATER NEW_SPEAKER turn
   makes it a real, confirmed boundary. B's standalone 'offered' state (a
   live coaching signal that must exist BEFORE any confirmation could
   arrive -- asOfSequence forbids using future turns to answer the
   present) borrows the same asymmetry: only the two unambiguous
   commitments below are trusted unconfirmed. A generic pause phrase can
   still resolve to 'completed' once a new speaker actually follows it
   (see readAuthorityEvidence) -- it simply never stands alone as
   'offered'. Reuses ROUTING_OFFER's own literal alternatives; no new
   phrase detection. */
const ROUTING_OFFER_COMMITTED = new RegExp([
  "\\b(?:i'?ll|i will|let me|shall i) (?:put you through|transfer you|pass you (?:over|on)|get (?:him|her|them))\\b",
  "\\bputting you through\\b",
].join('|'), 'i');

/* Somebody NEW saying so. A continuing speaker does not re-introduce
   themselves mid-call, which is what makes this usable as a boundary. */
const NEW_SPEAKER = new RegExp([
  "^(?:hello|hi|hey)\\b[^.!?]{0,24}\\b(?:this is|it'?s|speaking)\\b",
  "^(?:you'?re through to|putting you through to)\\b",
  "\\b[a-z]+ speaking\\b",
  "^(?:hello|hi|hey)[,.!]?\\s*(?:dr|mr|mrs|ms|miss)\\.?\\s+[a-z]+\\b",
  "^(?:dr|mr|mrs|ms|miss)\\.?\\s+[a-z]+ here\\b",
  /* "Hi, Sam here." -- the greeting is the commonest way a new voice opens,
     so anchoring "<name> here" to the start of the line missed it. */
  "(?:^|[,.!]\\s*)[a-z]+ here\\b",
].join('|'), 'i');

/**
 * THE SEQUENCES AT WHICH THE CALL PASSED TO SOMEBODY ELSE.
 *
 * A boundary needs both halves: an offer to route, and a new person
 * arriving after it. Either alone is ordinary conversation -- "one moment"
 * while they check a diary is not a transfer, and "Sarah speaking" as an
 * opening line is not one either.
 *
 * @param {object[]} turns ordered {speaker,text,sequence}
 * @returns {number[]} boundary sequences, ascending
 */
export function transferBoundaries(turns = []) {
  if (!Array.isArray(turns)) return [];
  const prospect = turns
    .filter((t) => t && t.speaker === 'prospect' && Number.isFinite(t.sequence))
    .sort((a, b) => a.sequence - b.sequence);
  const out = [];
  let offered = false;
  for (const turn of prospect) {
    const raw = normalise(turn.text);
    if (!raw) continue;
    if (offered && NEW_SPEAKER.test(raw)) { out.push(turn.sequence); offered = false; continue; }
    if (ROUTING_OFFER.test(raw)) offered = true;
  }
  return out;
}

/* A QUESTION DISCLAIMS NOTHING. "You'd need to speak to the owner about
   that, wouldn't you?" reads as a disclaimer to a keyword and as a probe to a
   person, and a founder qualifying correctly must never manufacture the
   evidence that convicts them. coercionAdmissible refuses a question outright; the same
   refusal is applied here, but scoped to the SENTENCE the phrase sits in --
   whole-line scoping acquitted "That's not my call. Who did you want?", which
   is an assertion followed by a question. The cost is that "I'll put you
   through, is that ok?" is also acquitted. On the only fault that can punish
   good selling, losing a conviction is the cheaper error. */
function sentenceContaining(text, re) {
  const idx = text.search(re);
  if (idx < 0) return '';
  const start = Math.max(text.lastIndexOf('.', idx), text.lastIndexOf('!', idx), text.lastIndexOf('?', idx)) + 1;
  const rest = text.slice(idx);
  const endRel = rest.search(/[.!?]/);
  return text.slice(start, endRel < 0 ? text.length : idx + endRel + 1).trim();
}

/* Only these count as the pitch. Passed in by the caller, which has already
   classified the turn -- this file stays a leaf and does not re-classify.
   Exported because the reconciler filters on it too, and a second copy of
   this set is a second definition of the fault. */
export const PITCH_ACTIONS = new Set(['pitch', 'premature_pitch']);

/**
 * MAY A CRITICAL "PITCHED A NON-BUYER" FAULT BE RAISED ON THIS TRANSCRIPT?
 *
 * @param {object}   input
 * @param {object[]} input.turns  ordered {speaker:'prospect'|'founder', text, sequence}
 * @param {object}   input.pitch  the founder turn under judgement, {sequence, action}
 * @returns {{pass:boolean, reason:string}}
 */
export function pitchedDisclaimedNonBuyerAdmissible({ turns = [], pitch = null } = {}) {
  if (!Array.isArray(turns) || turns.length === 0) return FAIL('no_turns');
  if (!pitch || !Number.isFinite(pitch.sequence)) return FAIL('no_pitch_turn');
  /* Not a pitch, not this fault. Naming a price when ASKED for one is the
     caller's classification to make, and it does not reach here. */
  if (!PITCH_ACTIONS.has(String(pitch.action || ''))) return FAIL('turn_was_not_a_pitch');

  /* ONLY THIS LEG OF THE CALL. Everything said before the last transfer was
     said by somebody who is no longer on the phone. */
  const boundary = transferBoundaries(turns)
    .filter((seq) => seq < pitch.sequence)
    .reduce((a, b) => (b > a ? b : a), -Infinity);

  const before = turns.filter((t) => t && t.speaker === 'prospect'
    && Number.isFinite(t.sequence) && t.sequence < pitch.sequence
    && t.sequence > boundary);
  if (!before.length) {
    return FAIL(Number.isFinite(boundary)
      ? 'no_disclaimer_since_the_call_was_transferred'
      : 'prospect_said_nothing_before_the_pitch');
  }

  /* WHY IT WAS DECLINED IS PART OF THE EVIDENCE. A line that looked like a
     disclaimer and did not clear the bar is not the same as a call where
     nothing of the kind was ever said, and the reconciler records the two
     differently: the first is a fault considered and refused, the second is
     no fault at all. Refusing without saying why is how a gate becomes the
     judgement call it was written to replace. */
  let refused = null;
  const decline = (turn, reason) => {
    if (!refused) refused = { reason, at: turn.sequence };
  };

  for (const turn of before) {
    const raw = normalise(turn.text);
    if (!raw || !AUTHORITY_DISCLAIM.test(raw)) continue;
    if (/\?$/.test(sentenceContaining(raw, AUTHORITY_DISCLAIM))) { decline(turn, 'a_question'); continue; }
    /* Several of these phrases carry their own negator ("not my call"), so
       the question is whether a SEPARATE negator sits in front of them:
       "it's not that it isn't my call" withholds the disclaimer. */
    if (!negatedBeforeMatch(raw, AUTHORITY_DISCLAIM).pass) { decline(turn, 'negated'); continue; }
    /* "She said it's not her call" tells you about her, not about the person
       on the phone. */
    if (!attribution(raw, AUTHORITY_DISCLAIM).pass) { decline(turn, 'not_self_asserted'); continue; }
    /* "I probably can't decide that" is not a disclaimer a founder can be
       expected to treat as final. */
    if (!hedgeFloor(raw).pass) { decline(turn, 'hedged'); continue; }
    return { pass: true, reason: `authority_disclaimed_at_${turn.sequence}_then_pitched_at_${pitch.sequence}`,
      disclaimedAt: turn.sequence, refusedBecause: null };
  }
  return refused
    ? { pass: false, reason: `disclaimer_considered_and_refused:${refused.reason}`,
      disclaimedAt: null, refusedBecause: refused.reason, consideredAt: refused.at }
    : FAIL('no_disclaimer_of_authority_before_the_pitch');
}

/* ── IS THIS A NON-BUYER CALL AT ALL? ─────────────────────────────────
   Decided from the transcript, never from the simulator. The rule is the
   one the locked design fixes: a call is a non-buyer call when an affirmed,
   self-asserted disclaimer STANDS UNSPENT at the end of it -- the same
   evidence the critical fault requires, spent by the same transfer boundary.

   If the call transferred, the leg after the transfer is a buyer call, and
   it does not matter that a receptionist answered first. That is the whole
   point of the boundary: what happened before the handover is about somebody
   who is no longer on the phone.

   A call with no disclaimer is a buyer call. There is no third answer, and
   the hidden role does not get a vote -- a founder scored against a
   denominator chosen by something they cannot see is being judged on
   evidence they cannot check. */
export function unspentDisclaimer(turns = []) {
  if (!Array.isArray(turns) || !turns.length) return { present: false, atSequence: null, reason: 'no_turns' };
  const last = turns.reduce((a, t) => (t && Number.isFinite(t.sequence) && t.sequence > a ? t.sequence : a), -Infinity);
  if (!Number.isFinite(last)) return { present: false, atSequence: null, reason: 'no_sequences' };
  /* Asked as "was there a disclaimer standing when the call ended", which is
     exactly the question the fault asks at the moment of a pitch -- so it is
     answered by the same code rather than by a second reading of the same
     words that could disagree with it. */
  const g = pitchedDisclaimedNonBuyerAdmissible({
    turns, pitch: { sequence: last + 1, action: 'pitch' },
  });
  return g.pass
    ? { present: true, atSequence: g.disclaimedAt, reason: 'disclaimer_standing_at_the_end_of_the_call' }
    : { present: false, atSequence: null, reason: g.reason };
}

/* ════════════════════════════════════════════════════════════════════════
   WP4 BOUNDARY B — OBSERVABLE AUTHORITY/ROUTING EVIDENCE.

   Reuses AUTHORITY_DISCLAIM, ROUTING_OFFER, NEW_SPEAKER, negatedBeforeMatch,
   attribution and hedgeFloor -- the exact machinery pitchedDisclaimedNonBuyerAdmissible
   already applies -- so live and post-call cannot drift into disagreeing
   about what a sentence means. No new vocabulary for admission; the routing
   dimension gets the SAME sentence/question/negation/attribution/hedge
   rigor authority already had, which transferBoundaries's bare ROUTING_OFFER
   scan does not apply (that function answers a different, narrower question:
   where a transfer happened, not whether this evidence is admissible).

   TAKES A TRANSCRIPT. NEVER THE SCENARIO. Leakage is structurally
   impossible here, not merely forbidden by convention.

   routing.state is `unknown|offered|completed` -- NOT `refused`. authority.state
   is `unknown|disclaimed` -- NOT `claimed`. Both omissions have the same
   cause: the frozen contract's enum names a value ("refused", "claimed")
   that only a NEW regex could detect, and "zero new regex vocabulary" is
   the frozen constraint on this function. "Claims authority" is Boundary
   A's detector (prospect-dialogue.js, model output only) -- it cannot be
   reused here without breaking the transcript-only invariant, since A's
   detector exists to be run against text the SIMULATOR wrote, and giving
   B a copy of it would be a second, driftable definition of the same
   claim, not a reuse. Named here as a deliberate, narrower shipped
   surface, not a silent omission -- the same honest treatment given to
   "send it to purchasing" two rounds earlier in this design's history. */

/* A later statement supersedes an earlier one ONLY when it is explicitly
   marked as a correction -- an opposite claim alone is unresolved
   contradiction, not a retraction. Deliberately small and new: no existing
   pattern in this file answers "is this speaker correcting themselves". */
const CORRECTION_MARKER = /\b(?:actually|to (?:clarify|be clear)|i (?:misspoke|should clarify|need to correct that)|correction[:,]|let me correct that|what i meant (?:to say )?was)\b/i;

/* Failure reasons that mean "not admissible evidence at all" collapse to
   unknown. Only `hedged` means real-but-uncertain evidence, which is what
   `possible` strength exists for -- a question, a negated match, or a
   third party's claim is not weak evidence of THIS speaker's authority,
   it is no evidence of it. */
function admitAuthorityLike(raw, pattern) {
  if (!pattern.test(raw)) return null;
  const sentence = sentenceContaining(raw, pattern);
  if (/\?$/.test(sentence)) return null;
  if (!negatedBeforeMatch(raw, pattern).pass) return null;
  if (!attribution(raw, pattern).pass) return null;
  const quote = sentence || raw;
  return hedgeFloor(raw).pass ? { strength: 'explicit', quote } : { strength: 'possible', quote };
}

/* A phrase negated exactly once before the match is simply not evidence
   (admitAuthorityLike already withholds it via negatedBeforeMatch). A
   phrase negated TWICE is a different thing: negationScope's own
   double_negation_withheld reading means no deterministic direction is
   safe -- not "no evidence", but "self-contradictory evidence", which is
   exactly what `conflicted` exists to surface. Reuses negationScope, which
   this file already exports; no new regex. */
function isSelfContradictory(raw, pattern) {
  if (!pattern.test(raw)) return false;
  return negationScope(raw, pattern).reason === 'double_negation_withheld';
}

/* AUTHORITY_DISCLAIM bundles two shapes by original design (its own
   comment: "DISCLAIM -- that's not my call... ROUTE -- I'll put you
   through"), because pitchedDisclaimedNonBuyerAdmissible only ever needed
   ONE question -- was this pitched at a non-buyer -- and either shape
   answers it. B needs a second, orthogonal question, so a matched SPAN
   that is itself route-shaped ("I'll put you through") is routing
   evidence, not decision-authority evidence -- ROUTING_OFFER already IS
   the routing dimension's own detector for it, reused rather than
   duplicated. Scoped to the matched span, not the whole turn or sentence:
   "That's not my call, but I'll put you through" must keep BOTH facts,
   which per-turn or per-sentence exclusion would erase. */
/* Exported so a second producer (WP7's semantic-item admission) can refuse
   to label authority-shaped language as a commercial constraint, by asking
   the SAME question this file already answers rather than re-deriving a
   cruder one. No change to what this function decides or how -- widening
   who may call it is not reopening the decision itself. */
export function admitAuthorityDisclaim(raw) {
  const m = raw.match(AUTHORITY_DISCLAIM);
  if (!m || ROUTING_OFFER.test(m[0])) return null;
  return admitAuthorityLike(raw, AUTHORITY_DISCLAIM);
}

function emptyDimension() { return { state: 'unknown', strength: null, atSequence: null, quote: null }; }

/**
 * THE VALIDATED AUTHORITY/ROUTING TIMELINE, AS OF ONE SEQUENCE.
 *
 * Never reads anything but the transcript. `asOfSequence` is required: the
 * last QUALIFYING event at or before it wins, so a caller processing turn N
 * can never be answered with something only turn N+3 revealed.
 *
 * @param {object[]} turns ordered {speaker, text, sequence}
 * @param {object}   opts
 * @param {number}   opts.asOfSequence REQUIRED -- evaluate as of this sequence
 * @returns {object} { version, authority, routing, spentByTransfer, conflicted, sufficientForCritical }
 */
export function readAuthorityEvidence(turns, { asOfSequence } = {}) {
  const version = 'practice_authority_evidence_v1';
  if (!Number.isFinite(asOfSequence)) {
    return { version, authority: emptyDimension(), routing: emptyDimension(),
      spentByTransfer: false, conflicted: false, sufficientForCritical: false };
  }
  const prospect = (Array.isArray(turns) ? turns : [])
    .filter((t) => t && t.speaker === 'prospect' && Number.isFinite(t.sequence) && t.sequence <= asOfSequence)
    .sort((a, b) => a.sequence - b.sequence);

  let authority = emptyDimension();
  let routing = emptyDimension();
  let conflicted = false;
  let newSpeakerAfterOffer = false;

  for (const turn of prospect) {
    const raw = normalise(turn.text);
    if (!raw) continue;

    /* ── AUTHORITY ─────────────────────────────────────────────────── */
    const marked = CORRECTION_MARKER.test(raw);
    if (isSelfContradictory(raw, AUTHORITY_DISCLAIM)) conflicted = true;
    const claim = admitAuthorityDisclaim(raw);
    if (claim) {
      if (authority.state === 'unknown' || marked) {
        /* First admissible evidence, or an explicitly marked correction --
           either way this turn becomes the new standing evidence. */
        authority = { state: 'disclaimed', strength: claim.strength, atSequence: turn.sequence, quote: claim.quote };
      } else if (authority.state === 'disclaimed') {
        /* Repeated, unmarked disclaim: reinforces, never downgrades. */
        authority = { ...authority, atSequence: turn.sequence };
      }
    }

    /* ── ROUTING ───────────────────────────────────────────────────── */
    if (isSelfContradictory(raw, ROUTING_OFFER)) conflicted = true;
    if (newSpeakerAfterOffer && NEW_SPEAKER.test(raw)) {
      routing = { state: 'completed', strength: 'explicit', atSequence: turn.sequence, quote: raw.slice(0, 120) };
      newSpeakerAfterOffer = false;
      continue;
    }
    if (routing.state !== 'completed' && ROUTING_OFFER.test(raw)) newSpeakerAfterOffer = true;
    const offer = admitAuthorityLike(raw, ROUTING_OFFER_COMMITTED);
    if (offer && routing.state !== 'completed') {
      routing = { state: 'offered', strength: offer.strength, atSequence: turn.sequence, quote: offer.quote };
    }
  }

  /* Spent, not erased: a disclaimer said before a transfer completed is
     about the person who said it and no longer about who is on the line
     now -- the exact rule pitchedDisclaimedNonBuyerAdmissible already
     applies, restated here as a flag rather than a second gate. */
  const spentByTransfer = routing.state === 'completed'
    && authority.state === 'disclaimed' && authority.atSequence < routing.atSequence;

  /* NOT RE-DERIVED. The existing, already-proven gate decides criticality;
     this file only asks it the same question at the same moment a pitch
     would ask it, so the two can never disagree. */
  const admissible = pitchedDisclaimedNonBuyerAdmissible({
    turns: prospect, pitch: { sequence: asOfSequence + 1, action: 'pitch' },
  });

  return {
    version, authority, routing,
    spentByTransfer, conflicted,
    sufficientForCritical: admissible.pass === true,
  };
}
