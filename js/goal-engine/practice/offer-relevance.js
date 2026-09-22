/* ════════════════════════════════════════════════════════════════════════
   WHAT DID THAT MEAN, GIVEN WHAT THE FOUNDER SELLS?

   Every reader in Practice until now has answered a question about the
   SENTENCE: is it a refusal, a boundary, a question, a brush-off. None of
   them could answer the question a salesperson actually asks, which is
   about the BUSINESS: does what they just said have anything to do with
   what I sell?

   The two come apart badly. On a real staging call a practice manager said
   "if anything needed attention it would be staffing, not the phones" to a
   founder selling front-desk call cover. Read as a sentence that is a
   brush-off, and the rail treated it as one. Read against the offer it is
   the best thing said on the call: front-desk cover IS a staffing answer,
   and she had just volunteered the pain, unprompted, while declining the
   thing she thought was being sold. A blind judge called it "the only real
   path this call had" and noted the panel never saw it.

   No list of phrases can close that gap. "Staffing" shares not one content
   word with "call overflow", and the next call will say "cover", or "the
   rota", or "we are two people short since June". The relation is semantic
   and it depends on an offer that changes per founder, so it is read by a
   model.

   ── WHAT THE MODEL IS AND IS NOT TRUSTED WITH ─────────────────────────
   The same division `judge-contract.js` draws, for the same reasons. A
   model may establish SEMANTIC evidence: whether the thing they named is
   the kind of problem this offer addresses. It may not decide the move, may
   not decide whether the offer has been earned, and may not decide anything
   about refusals, boundaries or authority -- all of which are read by code
   that can be replayed and pointed at its evidence.

   So it returns one pinned relation and a quote, and nothing else it says
   is read. `decideBestMove` remains a pure function of recorded state plus
   this one piece of evidence.

   ── ONLY THE POSITIVE SIGNAL IS ACTED ON ──────────────────────────────
   Deliberately asymmetric, the same way accusation costs more than praise
   in the judge. `pain_we_address` changes the move, because being wrong
   costs one question about something they did raise. Every other relation
   is recorded and falls through to the ladder, because acting on a wrong
   `need_dismissed` or `pain_we_do_not_address` would talk a founder out of
   a live call. The cheap error is taking an interest in the wrong thing.

   ── WP7: FOUR MORE CONCEPTS, ONE READ, NOT A SECOND MODEL CALL ─────────
   The gap this closes is narrower than "prospect meaning in general":
   conditional/qualified interest, a soft objection outside the five fixed
   patterns call-state.js already extracts, and a commercial constraint
   (money, procurement, timing) that had no representation anywhere. Two
   things this is NOT: a rewrite (pain_we_address and the four original
   neutrals are untouched, same strings, same asymmetry) or a second
   interpreter (one eligible turn still costs one model call -- the schema
   grew, the call did not double).

   CONSTRAINT WAS WRONG, AND IS NOW ENFORCED, NOT JUST RENAMED. Its own
   comment used to read "money, timing OR AUTHORITY" -- exactly the
   boundary this file must never cross, and inert only because ACTED_ON
   never included it. Fixed two ways at once: the definition below is
   commercial-only, and admitSemanticItems cross-checks every admitted
   quote against evidence-gates.js's own AUTHORITY_DISCLAIM/ROUTING_OFFER
   detectors -- so a model that mislabels "I'd need my manager to approve
   it" as a constraint anyway still cannot make it through. Code decides
   admissibility; the prompt is not the safety mechanism. */
/* WP4's own span-level detectors, reused for every concept below. The
   sentence-level readAuthorityEvidence overlap that briefly lived here was
   removed deliberately: the positive commercial requirement subsumes it
   (a circumlocution about who decides carries no commercial evidence and
   now fails on its own), and a sentence-scoped veto would have discarded
   the genuinely commercial half of a mixed sentence. A safeguard that can
   never fire is not defense in depth, it is dead code claiming to be one. */
import { admitAuthorityDisclaim, ROUTING_OFFER } from './evidence-gates.js';

export const OFFER_RELEVANCE_VERSION = 'practice_offer_relevance_v2';

/* What a prospect's statement can be, relative to what the founder sells.
   Pinned: the model chooses from these and cannot invent one that is not
   listed. The original seven are unchanged; the four WP7 additions sit
   alongside them, not in place of them. */
export const RELATION = Object.freeze({
  /* They named a problem this offer exists to solve -- whether or not they
     realise that is what it does. The one relation that changes the move. */
  PAIN_WE_ADDRESS: 'pain_we_address',
  /* A real problem, genuinely outside what this founder sells. */
  PAIN_WE_DO_NOT_ADDRESS: 'pain_we_do_not_address',
  /* They already solve it another way. */
  ALTERNATIVE_IN_PLACE: 'alternative_in_place',
  /* They say the problem does not exist for them. */
  NEED_DISMISSED: 'need_dismissed',
  /* Money, procurement or timing -- COMMERCIAL only. Never authority,
     never a gatekeeper/routing fact: those are WP4's, and a candidate that
     reads as either is discarded regardless of this label (see
     admitSemanticItems). */
  CONSTRAINT: 'constraint',
  /* Logistics, courtesy, small talk. */
  UNRELATED: 'unrelated',
  /* The model could not tell. Never acted on. */
  UNCLEAR: 'unclear',
  /* A doubt or pushback that is not one of call-state.js's five fixed
     objection patterns -- "I'm just not sure this would actually save us
     much" matches none of them today. */
  OBJECTION_OR_CONCERN: 'objection_or_concern',
  /* Interest gated on a stated condition -- "if the numbers make sense".
     Kept distinct from plain interest on purpose: a founder who reads a
     conditional as confirmed skips the very thing that was named. */
  CONDITIONAL_INTEREST: 'conditional_interest',
  /* Clear, unconditional positive interest. */
  INTEREST_CONFIRMED: 'interest_confirmed',
  /* A clear, unconditional no -- distinct from a soft objection, because a
     rejection is not a concern that can be explored further. */
  EXPLICIT_REJECTION: 'explicit_rejection',
});
const ALL = Object.freeze(Object.keys(RELATION).map((k) => RELATION[k]));

/* The only relation that may change the decision. Exported so the test that
   guards the asymmetry reads the same list the code does. Unchanged by
   WP7: none of the four additions are wired into any decideBestMove
   branch -- they are recorded, evidence-grounded, and available for a
   future consumer to act on, not acted on here. */
export const ACTED_ON = Object.freeze([RELATION.PAIN_WE_ADDRESS]);

/* ── WHAT THE MODEL IS ALLOWED TO SEE ─────────────────────────────────
   The founder's own offer, the prospect's own words, and the pains the
   prep sheet already lists. Not the move, not the score, not the hidden
   scenario role, not the rest of the transcript -- a relation is a property
   of one statement against one offer, and widening the input is how a
   semantic reader quietly becomes a second strategist. */
export const RELEVANCE_INPUT_ALLOWED = Object.freeze([
  'said', 'offerWhat', 'offerPricing', 'knownObjections', 'businessType',
]);
export const RELEVANCE_INPUT_FORBIDDEN = Object.freeze([
  'move', 'bestMove', 'goal', 'sayNext', 'score', 'points', 'rubric',
  'scenario', 'role', 'variation', 'trust', 'patience', 'resistance',
  'exitIntent', 'qualification', 'refusal', 'verdict', 'expected',
]);

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/* ── WHAT A COMMERCIAL CONSTRAINT *IS* ─────────────────────────────────
   The positive requirement, and the only thing that DEFINES this concept.

   Every earlier attempt at this boundary was a denylist: enumerate the
   authority shapes and admit whatever is left. That is unbounded by
   construction -- English has endless ways to say who decides ("the people
   who run the place would have the final say" defeated both the span check
   AND WP4's own detector), so each miss demanded another pattern, and the
   list could only ever chase.

   Inverted, the question is bounded and answerable: does this quote
   actually name money, a purchasing process, or purchase timing? A
   circumlocution about who decides names none of them, so it fails without
   anyone having to anticipate its phrasing. That is why this replaces the
   exclusions as the criterion rather than joining them.

   A COMMERCIAL NOUN IS NOT A COMMERCIAL CONSTRAINT. The first version of
   this gate asked only whether a money word was present, and "the budget
   holder decides that" walked straight through it -- a who-decides
   statement wearing the word `budget`. The noun says what the sentence is
   ABOUT; only the predicate says whether a purchase is actually
   restricted. So each alternative below pairs commercial subject matter
   with a restriction: an absence, an inability, a cap, a date the purchase
   cannot precede, a process it must pass through, or a commitment already
   in place. "Budget" alone matches nothing here.

   Deliberately NOT here: `sign off`, `approve`, `decide`, and bare
   department names. Those describe a person's permission, not a commercial
   fact, and admitting them is exactly the contamination this closes. */
const COMMERCIAL_RESTRICTION = new RegExp([
  /* 1. No / insufficient / fixed / already-committed budget. */
  '\\b(?:no|not|never|without|little|zero|nil|insufficient|limited|tight|'
    + 'fixed|frozen|capped|gone|spent|exhausted)\\b[^.!?]{0,30}?'
    + '\\b(?:budget|budgets|funds|funding|money|cash|spend|spending)\\b',
  '\\b(?:budget|budgets|funds|funding|money|cash)\\b[^.!?]{0,30}?'
    + '\\b(?:tight|fixed|frozen|limited|capped|gone|spent|zero|nil|'
    + 'exhausted|committed|allocated|used up)\\b',
  '\\b(?:have ?n\'?t|has ?n\'?t|do ?n\'?t have|does ?n\'?t have|did ?n\'?t have|'
    + 'not got|no longer have)\\b[^.!?]{0,30}?\\b(?:budget|funds|funding|money|cash)\\b',
  /* 2. Cannot afford / cannot spend / a stated cap. */
  '\\b(?:can\'?t|cannot|could ?n\'?t|unable to|won\'?t|would ?n\'?t|not able to)'
    + '\\b[^.!?]{0,30}?\\b(?:afford|spend|justify|pay|stretch)\\b',
  '\\b(?:too expensive|too dear|too much money|out of (?:our|the|their) '
    + '(?:price range|budget)|beyond (?:our|the|their) budget|priced out|'
    + 'more than we (?:can|could) (?:pay|spend|afford))\\b',
  '\\b(?:cap|capped|ceiling|maximum|max|no more than|up to|limited to)'
    + '\\b[^.!?]{0,25}?[£$€]?\\s?\\d',
  /* 3. The purchase cannot happen before a date. */
  '\\b(?:until|before)\\b[^.!?]{0,30}?\\b(?:financial year|fiscal year|'
    + 'next quarter|this quarter|new quarter|next year|new year|next month|'
    + 'renewal|Q[1-4]|january|february|march|april|june|july|august|'
    + 'september|october|november|december)\\b',
  /* 4. A purchasing PROCESS the spend must pass through -- not a person. */
  '\\b(?:through|out to|via|into|submitted to)\\b[^.!?]{0,20}?'
    + '\\b(?:procurement|tender|purchasing|purchase order)\\b',
  '\\b(?:procurement|tender|purchasing|purchase order) '
    + '(?:process|team|route|rules?|policy|approval|cycle|sign[- ]?off)\\b',
  '\\b(?:needs?|need|requires?|have to|has to|must)\\b[^.!?]{0,25}?'
    + '\\b(?:procurement|tender|purchase order)\\b',
  /* 5. A commitment already in place that blocks buying. */
  '\\b(?:locked|tied|committed|contracted|signed) (?:in|into|up|to)\\b',
  '\\b(?:contract|agreement|deal|term)\\b[^.!?]{0,25}?\\b(?:until|runs|'
    + 'expires|ends|renews|renewal|notice period|in place|for another)\\b',
  '\\b(?:in|under) contract\\b',
  '\\bnotice period\\b',
].join('|'), 'i');

/* THE NAMED-DECIDER DENYLIST THAT USED TO LIVE HERE IS GONE, and its
   removal was measured rather than assumed. Once the gate above began
   requiring a RESTRICTION rather than a keyword, every quote the denylist
   usefully caught -- "my manager approves the budget", "the owner decides
   what we spend", "the practice manager signs off the invoices" -- was
   already refused by the gate on its own.

   The one quote where it still fired uniquely was "the owner decides, and
   we have no budget until April", which asserts a real restriction; there,
   rejecting was over-rejection of exactly the kind the mixed-sentence rule
   forbids. A rule that is redundant everywhere it helps and wrong in the
   only place it is unique is not defense in depth, and keeping it would
   have quietly re-broken a case this package is required to preserve. */

/* ── IS THERE ANYTHING TO READ ────────────────────────────────────────
   A relation needs two things to exist: something they said, and an offer
   to relate it to. Without the offer there is no question to ask -- and the
   handoff carries `offer: null` until the founder has actually established
   what they sell, which is exactly when nothing should be inferred. */
export function relevanceEligible({ said = '', offer = null } = {}) {
  const text = clean(said);
  const what = clean(offer && offer.what);
  if (!text || text.split(' ').length < 4) return { eligible: false, why: 'nothing_substantive_said' };
  if (!what) return { eligible: false, why: 'founder_has_not_established_the_offer' };
  return { eligible: true, why: null };
}

/* What the model is handed. Built here so the allowed list above is the
   only thing that can reach it. */
export function relevanceInput({ said = '', offer = null, handoff = {} } = {}) {
  return {
    said: clean(said).slice(0, 400),
    offerWhat: clean(offer && offer.what).slice(0, 300),
    offerPricing: clean(offer && offer.pricing).slice(0, 120) || null,
    businessType: clean(((handoff || {}).prospect || {}).businessType).slice(0, 80) || null,
    knownObjections: ((handoff || {}).objections || [])
      .map((o) => clean(o && o.q)).filter(Boolean).slice(0, 5),
  };
}

/* ── ADMISSION, THE ONE RULESET ─────────────────────────────────────────
   Nothing the model returns is trusted until it survives this. Three rules,
   and each exists because the failure it prevents would be invisible
   downstream:

   1. The relation must be one of the pinned values. One this file does not
      know is discarded, never coerced.
   2. An ACTED_ON relation -- the only kind that changes a move -- must
      quote the prospect, and the quote must actually appear in what they
      said. A model that paraphrases has not shown its evidence, and the
      founder would be pointed at words nobody spoke.
   3. (Confidence is checked by each caller below, not here, because
      admitRelevance checks it once for a single verdict and
      admitSemanticItems checks it once per item -- the SHAPE differs, the
      rule does not.)

   Shared by both entry points below, so there is exactly one ruleset, not
   two that could quietly drift apart. */
function admitOne(relation, quote, { said = '' } = {}) {
  if (!ALL.includes(relation)) return { ok: false, why: 'unknown_relation' };
  if (relation === RELATION.UNCLEAR) return { ok: false, why: 'model_unsure' };
  if (ACTED_ON.includes(relation)) {
    const q = clean(quote);
    if (!q) return { ok: false, why: 'acted_on_relation_without_a_quote' };
    const hay = clean(said).toLowerCase();
    if (!hay.includes(q.toLowerCase())) return { ok: false, why: 'quote_is_not_in_what_they_said' };
    return { ok: true, relation, quote: q };
  }
  return { ok: true, relation, quote: clean(quote) || null };
}

/* LEGACY ENTRY POINT. Unchanged behaviour, still exported and still what
   the pre-WP7 test fixtures call directly with a single hand-built
   {relation, quote, confidence} -- kept working via admitOne rather than a
   frozen duplicate ruleset. */
export function admitRelevance(raw, { said = '' } = {}) {
  const none = (why) => ({ relation: RELATION.UNCLEAR, quote: null, admitted: false, why,
    version: OFFER_RELEVANCE_VERSION });
  if (!raw || typeof raw !== 'object') return none('no_verdict');
  const relation = clean(raw.relation);
  const confident = raw.confidence === 'high' || raw.confidence === 'medium';
  if (ALL.includes(relation) && relation !== RELATION.UNCLEAR && !confident) return none('low_confidence');
  const result = admitOne(relation, raw.quote, { said });
  if (!result.ok) return none(result.why);
  return { relation: result.relation, quote: result.quote, admitted: true, why: null,
    version: OFFER_RELEVANCE_VERSION };
}

/* WP7 ENTRY POINT. Up to 2 items, each admitted independently through the
   SAME admitOne rules, then two turn-level checks that only make sense
   once every item is known. */
export function admitSemanticItems(raw, { said = '' } = {}) {
  const empty = (why) => ({ items: [], version: OFFER_RELEVANCE_VERSION, why: why || null });
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return empty('no_verdict');

  /* The 2-item cap is enforced once, at the end, on what actually survived
     admission -- not here on the raw input. Capping the input first would
     let a 3rd raw item silently steal a slot from one that would have
     passed every rule, for no reason but arrival order. */
  const admitted = [];
  for (const it of raw.items) {
    if (!it || typeof it !== 'object') continue;
    const confident = it.confidence === 'high' || it.confidence === 'medium';
    if (!confident) continue;
    const result = admitOne(clean(it.concept), it.quote, { said });
    if (!result.ok) continue;
    /* WP4 BOUNDARY, ENFORCED NOT PROMPTED. A quote that reads as an
       authority disclaim or a routing offer is discarded here regardless
       of which concept the model attached to it -- reusing WP4's own
       detectors (evidence-gates.js) rather than re-deriving a cruder
       check, exactly the discipline this file already applies to
       quote-containment above. */
    if (admitAuthorityDisclaim(result.quote || '') || ROUTING_OFFER.test(result.quote || '')) continue;
    /* AND THE ONE WP4'S DETECTOR DOES NOT CATCH. Measured on canonical
       staging before this change shipped: a real prospect turn --
       "The practice manager would be the one to look at it" -- came back
       from the live model labelled `constraint`, which the old definition
       ("money, timing OR AUTHORITY") permitted outright. WP4's own
       AUTHORITY_DISCLAIM does not match that phrasing, and widening it
       would be reopening WP4's decision about what authority evidence IS.

       So the exclusion lives here instead, and is deliberately BROADER
       than WP4's detector, because the two answer different questions.
       WP4 asks "has this prospect disclaimed authority?" -- a conclusion,
       where a false positive would wrongly convict a founder of pitching a
       non-buyer. This asks only "may these words be filed as a COMMERCIAL
       constraint?" -- where the cheap error is the other way round: a
       wrongly-excluded item costs one unrecorded signal nothing yet reads,
       and a wrongly-included one is the contamination this package exists
       to fix. Nothing here decides anything about authority; it only
       declines to call a decider a budget. */
    if (result.relation === RELATION.CONSTRAINT) {
      /* THE DEFINITION. A constraint must show its commercial evidence in
         the prospect's own quoted words -- the same discipline this file
         already applies to pain_we_address, which must prove itself with a
         verbatim quote rather than be taken on trust.

         This is also what preserves the commercial half of a MIXED
         sentence. "That's not my call, but there's no budget until April"
         carries both facts; scoping the test to the quoted span admits the
         budget and refuses the disclaim, where any sentence-level
         authority veto would have thrown the real constraint away with it. */
      if (!COMMERCIAL_RESTRICTION.test(result.quote || '')) continue;
    }
    admitted.push({ concept: result.relation, quote: result.quote });
  }
  if (!admitted.length) return empty(null);

  /* DUPLICATE COLLAPSE. The same concept quoting overlapping words is one
     signal said once, not two. */
  const deduped = [];
  for (const item of admitted) {
    const dupe = deduped.find((d) => d.concept === item.concept && d.quote && item.quote
      && (d.quote.toLowerCase().includes(item.quote.toLowerCase())
        || item.quote.toLowerCase().includes(d.quote.toLowerCase())));
    if (!dupe) deduped.push(item);
  }

  /* CONTRADICTION REJECTION. A model that reports both halves of a genuine
     opposite in one turn has not found two facts, it has found its own
     confusion -- and acting on either half of a self-contradiction is
     worse than acting on neither. */
  const both = (a, b) => deduped.some((d) => d.concept === a) && deduped.some((d) => d.concept === b);
  if (both(RELATION.EXPLICIT_REJECTION, RELATION.INTEREST_CONFIRMED)
    || both(RELATION.EXPLICIT_REJECTION, RELATION.CONDITIONAL_INTEREST)
    || both(RELATION.NEED_DISMISSED, RELATION.PAIN_WE_ADDRESS)) {
    return empty('contradictory_items');
  }

  return { items: deduped.slice(0, 2), version: OFFER_RELEVANCE_VERSION, why: null };
}

/* WHAT THE SERVER PERSISTS UNDER THE ORIGINAL SINGLE-VERDICT KEY.
   admitSemanticItems can admit up to 2 items; cached_result's `relevance`
   key has only ever held one. Rather than widen that key's own shape (and
   leave every already-cached row ambiguous about which shape it holds),
   this reduces down to exactly what admitRelevance used to return -- the
   ACTED_ON item if one was admitted (decideBestMove's only real interest),
   else the first recorded item, else the same 'no_verdict' shape a null
   read has always produced. The richer array is ADDITIONALLY cached under
   its own new key (see wp3CacheableResult) -- nothing here is lost, only
   the single legacy slot is filled the same way it always was. */
export function legacyRelevanceShape(admitted) {
  const none = (why) => ({ relation: RELATION.UNCLEAR, quote: null, admitted: false, why,
    version: OFFER_RELEVANCE_VERSION });
  if (!admitted || !Array.isArray(admitted.items) || !admitted.items.length) {
    return none(admitted && admitted.why ? admitted.why : 'no_verdict');
  }
  const winner = admitted.items.find((it) => ACTED_ON.includes(it.concept)) || admitted.items[0];
  return { relation: winner.concept, quote: winner.quote || null, admitted: true, why: null,
    version: OFFER_RELEVANCE_VERSION };
}

/* What the decision is allowed to do with it. Kept here rather than in
   `best-move.js` so the asymmetry is stated once, next to the reasoning for
   it, and so a test can assert that exactly one relation is actionable.

   DETERMINISTIC COMPATIBILITY REDUCTION. decideBestMove's one existing
   consumer never changes: given either shape below, it gets back exactly
   the same {relation, quote} it always did, or null. The legacy branch is
   what several existing fixtures construct by hand (an already-admitted
   verdict, bypassing admitRelevance entirely) and must keep returning
   exactly what it always has; the array branch is what the real runtime
   now produces. Neither branch is told about the other. */
export function actionableRelevance(verdict) {
  if (!verdict) return null;
  if (verdict.relation !== undefined) {
    if (verdict.admitted !== true) return null;
    if (!ACTED_ON.includes(verdict.relation)) return null;
    return { relation: verdict.relation, quote: verdict.quote || null };
  }
  if (Array.isArray(verdict.items)) {
    const found = verdict.items.find((it) => ACTED_ON.includes(it.concept));
    if (!found) return null;
    return { relation: found.concept, quote: found.quote || null };
  }
  return null;
}
