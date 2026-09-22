/* ════════════════════════════════════════════════════════════════════════
   SALES STRATEGY — decided BEFORE any words are written.

   The deterministic script used to be assembled inline: an opening built from
   whichever signal weighed most, one question, three questions that would fit
   any business in the country ("What is the main thing getting in the way?"),
   ZERO objections, and a call structure that stopped after "ask, then stop
   talking" — no bridge to the offer and no close at all. A founder holding
   that had the first ninety seconds of a call and nothing else.

   THIS MODULE DECIDES SIX THINGS FIRST, and the words are generated from
   them. Deriving strategy separately is what stops the script being a pile of
   sentences that each look reasonable and together contradict each other —
   pitching before discovery, closing for a meeting with somebody who cannot
   agree to one, or asking a question VISION already knows the answer to.

   IT INVENTS NOTHING. Every input is already computed elsewhere: the evidence
   from prospect-context, the unknowns and Why Chosen from the selection
   rationale, the tiered Why Now from why-now-intelligence, the action from
   the decision engine, the role from contact-intelligence. This is a reader
   of that intelligence, not a second copy of it.
   ══════════════════════════════════════════════════════════════════════ */

/** What this conversation is FOR. Not what to say — what it has to achieve. */
export const CONVERSATION_OBJECTIVES = Object.freeze([
  'establish_need',        // we believe there is a gap; they have not said so
  'confirm_fit',           // need is evidenced; check the offer actually matches
  'reach_decision_maker',  // we are talking to the wrong person, politely
  're_engage',             // prior contact exists
]);

/** The commitment to ask for. Deliberately NOT always a sale. */
export const COMMITMENTS = Object.freeze([
  'book_meeting', 'send_audit', 'schedule_follow_up',
  'introduce_decision_maker', 'review_proposal', 'close_sale',
]);

/* A gap is a thing VISION OBSERVED to be absent. The question that follows
   asks how they handle it TODAY — which is genuinely unknown — rather than
   asking whether the gap exists, which VISION already established and which
   would tell the prospect we have not looked. */
export const GAP_DISCOVERY = Object.freeze({
  no_online_booking: 'Are most new customers booking through the website now, or are calls still doing most of the work?',
  no_conversion_route: 'When somebody lands on the site and decides they want to go ahead, what are they meant to do next?',
  no_website: 'Where do most people find you at the moment — word of mouth, the map listing, somewhere else?',
  thin_reputation: 'How do most new customers hear about you at the moment?',
});

/* THE SAME FACT, SAID OUT LOUD. The gap `detail` strings are written for the
   founder's evidence panel — "The website was read and offers no self-serve
   booking or ordering route" is accurate, auditable, and not a sentence any
   human has ever spoken down a phone. Reading evidence prose aloud is what
   makes a script sound like software. These are the spoken forms; they assert
   exactly the same thing and nothing more. */
export const GAP_SPOKEN = Object.freeze({
  no_online_booking: "I had a look at your website and could not see a way to book online",
  no_conversion_route: "I had a look at your website and could not find a way to actually get started",
  no_website: "I could not find a website for you anywhere",
  thin_reputation: "there is not much public feedback out there for you yet",
});

/* Questions that use evidence VISION actually holds, so the founder sounds
   like somebody who looked rather than somebody working from a list. */
export const EVIDENCE_DISCOVERY = Object.freeze({
  phone_only: 'When someone rings while you are with a customer, what happens to that call?',
  reputation: 'Are most of your new customers finding you locally, or coming through word of mouth?',
});

/* What a gap means for the founder's offer, phrased as a CONDITIONAL. The
   bridge may only be spoken once the prospect has said the problem is real,
   so the sentence is written to be useless until then. */
const GAP_BRIDGE = Object.freeze({
  no_online_booking: 'if the calls are the bottleneck rather than the demand',
  no_conversion_route: 'if people are landing and then going quiet',
  no_website: 'if being findable is the thing holding it back',
  thin_reputation: 'if being visible to people who have not heard of you is the gap',
});

export const EVENT_DISCOVERY = Object.freeze({
  expansion: 'What changed operationally when the new site came on?',
  ownership_change: 'Is the change altering who decides on things like marketing?',
  funding: 'Is customer acquisition part of what that is meant to fund?',
  hiring: 'Is the extra capacity ahead of demand, or catching up with it?',
  launch: 'Who is the new service aimed at?',
  leadership_change: 'Is that changing how you are approaching marketing?',
  contraction: null,
  campaign: 'Who is looking after that at the moment?',
  other: null,
});

/** The one commitment worth asking this prospect for. */
function chooseCommitment({ stage, contact, whyNow, offerGap, hasEvidence }) {
  /* Talking to somebody who cannot agree to anything is not a reason to push
     harder; it is a reason to ask for the right person. Role AUTHORITY is
     never known (contact-intelligence refuses to claim it), so this keys on
     what IS observable: whether the contact is a named person at all. */
  if (contact && contact.kind === 'generic') return 'introduce_decision_maker';
  /* A business mid-takeover cannot commit to anything; asking for a meeting
     reads as not listening. */
  if (whyNow && whyNow.caution === true) return 'schedule_follow_up';
  if (['contacted', 'interested', 'follow_up_needed'].includes(stage)) return 'review_proposal';
  /* THE DEFAULT IS THE SMALL ONE. A first conversation with a business that
     has not said it has a problem should not end in a pitch meeting; an audit
     of something VISION has already looked at costs the prospect nothing and
     is the honest next step when the evidence is real but unconfirmed. */
  if (offerGap && hasEvidence) return 'send_audit';
  return 'schedule_follow_up';
}

const COMMITMENT_ASK = Object.freeze({
  book_meeting: 'Would it be worth twenty minutes later this week to go through it properly?',
  send_audit: 'Can I put what I found in writing and send it over — no charge, and you can do nothing with it if it is not useful?',
  schedule_follow_up: 'Would it be better if I came back to you in a few weeks, when things have settled?',
  introduce_decision_maker: 'Who would be the right person to talk to about this?',
  review_proposal: 'Shall I put that together properly and send it for you to look at?',
  close_sale: 'Do you want to go ahead?',
});

/**
 * Derive the strategy. Pure; reads existing intelligence only.
 */
export function deriveScriptStrategy({
  context = null, selection = null, decision = null,
  whyNow = null, contact = null, offerGap = null, stage = null,
} = {}) {
  const observed = (context?.evidence?.observed || []);
  const unknowns = (selection?.importantUnknowns || []);
  const offer = context?.founder?.offer || null;
  const eventDriven = whyNow?.tier === 'verified_event';

  /* ── the hook: the strongest GROUNDED reason to keep listening ────── */
  let hook = null;
  if (eventDriven && whyNow.headline) {
    hook = {
      basis: 'verified_event', text: whyNow.headline, spoken: null,
      evidenceStatus: 'OBSERVED', sourceUrl: whyNow.sourceUrl || null,
    };
  } else if (offerGap?.detail && offerGap.evidenceStatus === 'OBSERVED') {
    hook = {
      basis: 'offer_gap', text: offerGap.detail,
      /* `spoken` is what goes in the founder's mouth; `text` stays the
         auditable evidence sentence. Both say the same thing. */
      spoken: GAP_SPOKEN[offerGap.gap] || null,
      evidenceStatus: 'OBSERVED', sourceUrl: offerGap.sourceUrl || null,
    };
  } else if (observed.length > 0) {
    hook = {
      basis: 'observed_signal', text: observed[0].detail, spoken: null,
      evidenceStatus: 'OBSERVED', sourceUrl: observed[0].sourceReference || null,
    };
  }

  /* ── the first unknown worth resolving ────────────────────────────── */
  const firstUnknown = unknowns[0] || null;

  /* ── the concern they are most likely to raise ────────────────────── */
  const likelyConcern = contact && contact.kind === 'generic'
    ? 'already_have_someone'
    : (eventDriven ? 'no_time' : 'happy_with_current_setup');

  const hasEvidence = observed.length > 0;
  const commitment = chooseCommitment({ stage, contact, whyNow, offerGap, hasEvidence });

  const objective = contact && contact.kind === 'generic' ? 'reach_decision_maker'
    : (['contacted', 'interested', 'follow_up_needed'].includes(stage) ? 're_engage'
      : (offerGap ? 'establish_need' : 'confirm_fit'));

  /* ── the offer-to-problem connection, as a CONDITION ───────────────── */
  const bridge = offer && offerGap
    ? { condition: GAP_BRIDGE[offerGap.gap] || 'if that turns out to be the constraint', offer }
    : (offer ? { condition: 'if that turns out to be the constraint', offer } : null);

  return {
    objective, hook, firstUnknown, likelyConcern, bridge,
    commitment: { kind: commitment, ask: COMMITMENT_ASK[commitment] },
    /* Carried so the script generator never has to re-derive them, and so a
       test can assert the words match the strategy that produced them. */
    role: contact ? { kind: contact.kind || null, role: contact.role || null, authorityKnown: false } : null,
    eventDriven,
    gap: offerGap ? offerGap.gap : null,
  };
}

/* ── OBJECTIONS ────────────────────────────────────────────────────────
   Six a founder actually hears. Every response does the same three things:
   accept the objection as reasonable, say something true, and ask rather than
   push. None of them argues, none flatters, and none uses a reframe trick —
   a founder who runs a manipulative line on a local business owner has lost
   the account and the referral. */
export function buildObjections({ hook, commitment, likelyConcern } = {}) {
  const observedThing = hook?.spoken || (hook?.text ? hook.text.replace(/\.$/, '').replace(/^The /, 'the ') : null);
  const list = [
    {
      objection: 'We already have someone doing that.',
      likelyMeaning: 'Often true, and sometimes it means "I do not want a second conversation about it".',
      response: 'That is fair enough — most places I speak to do. I am not asking you to move anything. Can I ask what they are focused on at the moment?',
    },
    {
      objection: 'Not interested.',
      likelyMeaning: 'Usually a reflex to an unexpected call rather than a judgement about the offer.',
      response: 'No problem at all. Before I let you go — was there something specific that made it a no, or is it just a bad moment?',
    },
    {
      objection: 'That sounds expensive.',
      likelyMeaning: 'They are guessing at a number because none has been named.',
      response: 'I have not quoted you anything yet, and I am not going to on a first call. It would only be worth pricing if we agree there is something worth fixing.',
    },
    {
      objection: 'Send me an email.',
      likelyMeaning: 'A polite exit, or a genuine preference. Both deserve the same answer.',
      response: 'Happy to. So it is not a generic email — what is the one thing worth me putting in it?',
    },
    {
      objection: 'I have not got time right now.',
      likelyMeaning: 'Literally true more often than founders assume.',
      response: 'Understood, I will not keep you. Is there a better time this week, or would you rather I put it in writing?',
    },
    {
      objection: 'We are happy with how things are.',
      likelyMeaning: 'They may well be. It is not an invitation to argue.',
      /* The SPOKEN form, not the evidence sentence — this is a line the
         founder reads aloud under pressure. */
      response: observedThing
        ? `Good — that is worth knowing. The only reason I rang is ${observedThing}, and I wanted to check whether that was deliberate rather than assume anything.`
        : 'Good — that is worth knowing, and it is a fine place to leave it. If that changes, I am easy to find.',
    },
  ];
  /* A prospect being asked for an introduction will raise a seventh, and it
     is the most important one to answer well. */
  if (commitment?.kind === 'introduce_decision_maker') {
    list.push({
      objection: 'I am the right person.',
      likelyMeaning: 'They may be. VISION has no evidence either way and must not imply otherwise.',
      response: 'Then I am talking to exactly the right person — I asked because I genuinely did not know.',
    });
  }
  /* THE CONTRACT ALLOWS FIVE, and a founder scanning a rail before a call
     reads the first two. So they are ORDERED by what this prospect is most
     likely to actually say — the concern the strategy predicted leads —
     rather than truncated in whatever order they were written. */
  const key = (o) => (
    /already have someone/i.test(o.objection) ? 'already_have_someone'
      : /not interested/i.test(o.objection) ? 'not_interested'
        : /expensive/i.test(o.objection) ? 'too_expensive'
          : /send me an email/i.test(o.objection) ? 'send_email'
            : /not got time/i.test(o.objection) ? 'no_time'
              : /happy with how things are/i.test(o.objection) ? 'happy_with_current_setup'
                : 'right_person');
  const lead = likelyConcern || null;
  return [...list]
    .sort((a, b) => (key(b) === lead ? 1 : 0) - (key(a) === lead ? 1 : 0)
      || (key(b) === 'right_person' ? 1 : 0) - (key(a) === 'right_person' ? 1 : 0))
    .slice(0, 5);
}
