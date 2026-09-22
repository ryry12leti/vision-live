/* ════════════════════════════════════════════════════════════════════════
   IF SOMEONE WHO CANNOT BUY ANSWERS THE PHONE

   The workspace prepares one conversation: the one with the decision-maker.
   On a cold call to a clinic, a practice or any business with a front desk,
   that is usually not who picks up. So the founder arrives prepared for the
   second half of a call they have not reached yet, and improvises the part
   that decides whether they reach it at all.

   THIS IS PREPARATION, NOT A PREDICTION. It says nothing about who will
   actually answer — in Practice or in life — and must never be rendered as
   though it did. Showing BOTH plans is what preserves the uncertainty: a
   founder who is handed only the buyer script has been told, implicitly,
   that the buyer will answer. A real rep prepares for both and finds out on
   the call.

   DETERMINISTIC ON PURPOSE. A gatekeeper approach is close to identical for
   every B2B cold call — ask for the right person, say why in one honest
   line, do not pitch, leave with a name or a time. Generating it per
   prospect would add model latency, model cost and model variance to
   sentences that barely differ, and would put the one conversation where
   over-talking is fatal at the mercy of a model that likes to elaborate.
   Only the substitutions come from context.

   WHAT IT WILL NOT DO. It never invents a person's name, never asserts who
   owns the decision, and never borrows the pitch. `contact.authorityKnown`
   is hard-coded false upstream because contact-intelligence refuses to infer
   authority from a title; this layer must not quietly re-infer it either.
   ══════════════════════════════════════════════════════════════════════ */

export const GATEKEEPER_PLAN_VERSION = 'gatekeeper_plan_v1';

const text = (value, max = 160) => (typeof value === 'string' && value.trim().length > 0
  ? value.trim().slice(0, max) : null);

/* THE OFFER IS NOT THE ROUTING PHRASE, and conflating them produced a
   sentence nobody would say out loud: "could you put me through to whoever
   looks after front-desk call overflow handling for veterinary and dental
   practices at Ardley Veterinary?". Asking for "whoever looks after <what I
   sell>" names the SELLER's category, when a receptionist routes on the
   BUYER's function. Caught by reading the live output rather than the test,
   which only checked that the phrase appeared.

   So there are two different asks, and no attempt to invent a third:
     - a role WAS observed  -> ask for it, verbatim
     - no role observed     -> ask WHO, rather than asking FOR someone
   The second is what a caller actually says when they do not know the title,
   and it fabricates nothing. Deriving a function noun ("reception", "the
   phones") from the offer sentence would be regex-on-prose inference, which
   this engine removed once already. */
/* TWO BUDGETS, BECAUSE THEY ARE TWO DIFFERENT SENTENCES. The opening ASK has
   to be sayable in one breath before anyone has agreed to listen, so it takes
   only a very short subject. The EXPLANATION, given when the front desk asks
   what it is about, is the moment they are actually waiting for an answer and
   can carry more. Collapsing both to one cap made a usable explanation fall
   back to "I have one question for the person who handles that" — true, but
   vaguer than it needed to be. */
const MAX_ASK_SUBJECT = 44;
const MAX_EXPLAIN_SUBJECT = 90;

function routingSubject(offer, max) {
  const o = text(offer, 300);
  if (!o) return null;
  /* First clause only. An offer sentence is written to persuade a buyer; the
     front desk needs the noun, not the argument. Long clauses are dropped
     rather than truncated mid-phrase — a half-sentence read down a phone is
     worse than no subject at all. */
  const head = o.split(/[—–,.:;]/)[0].trim();
  if (head.length < 3 || head.length > max) return null;
  return head.toLowerCase();
}

function askedFor(contactRole) {
  const role = text(contactRole, 120);
  return role ? `the ${role.replace(/^the\s+/i, '')}` : null;
}

/**
 * A compact plan for the call that has not reached the buyer yet.
 *
 * @param {object}  input
 * @param {string?} input.prospectName   the business, for the greeting
 * @param {string?} input.contactRole    an OBSERVED role, or null
 * @param {string?} input.offer          the founder's confirmed offer, verbatim
 * @returns {{version:string, aim:string, applies:string, open:string,
 *            ifAsked:string, ifRefused:string, leaveWith:string, dontSay:string[]}}
 */
export function buildGatekeeperPlan({ prospectName = null, contactRole = null, offer = null } = {}) {
  const name = text(prospectName, 120);
  const askSubject = routingSubject(offer, MAX_ASK_SUBJECT);
  const explainSubject = routingSubject(offer, MAX_EXPLAIN_SUBJECT);
  const who = askedFor(contactRole);
  const at = name ? ` at ${name}` : '';

  return {
    version: GATEKEEPER_PLAN_VERSION,

    /* One line, because this is the whole objective and it is not the sale. */
    aim: who
      ? `Reach ${who}, or leave with a name and a better time. Do not pitch.`
      : 'Find out who owns this and reach them, or leave with a name and a better time. Do not pitch.',

    /* Said plainly so the founder knows this is a branch, not a forecast. */
    applies: 'Use this only if the person who answers cannot decide. You will not know until they speak.',

    /* Ask FOR a named role when one is known; otherwise ask WHO. The second
       form is how a caller opens when they do not have a title, and it puts
       the routing question to the one person who can actually answer it. */
    open: who
      ? `Hi — could you put me through to ${who}${at}?`
      : (askSubject
        ? `Hi — who would be the best person to speak to about ${askSubject}?`
        : 'Hi — who would be the best person to speak to about this?'),

    /* The honest one-liner. A gatekeeper asking "what is it regarding?" is
       doing their job, and the answer that gets a transfer is short, true and
       unsalesy. */
    ifAsked: explainSubject
      ? `It is about ${explainSubject}. I am not selling anything on this call — I just need the right person to ask one question.`
      : 'I have one question for the person who handles that. I am not selling anything on this call.',

    /* The realistic failure, which is not refusal but deferral. */
    ifRefused: 'That is fair. Who would be the right person, and when is a better time to catch them?',

    leaveWith: 'A name, a role, or a time. Any of the three is a successful call.',

    dontSay: [
      'Do not pitch, quote a price, or explain the offer in detail — they cannot buy it.',
      'Do not claim you were asked to call, or that someone is expecting you.',
      'Do not ask discovery questions. They are not the person who knows.',
    ],
  };
}
