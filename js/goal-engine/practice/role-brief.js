/* ════════════════════════════════════════════════════════════════════════
   TELLING THE PROSPECT WHO THEY ARE.

   The scenario picks a role and five axes; without this file none of it
   reaches the conversation and Controlled Uncertainty is a hidden variable
   that changes nothing. This turns it into instructions the prospect model
   can act on, in the prospect's own terms.

   THE BRIEF DESCRIBES A PERSON, NOT A SCRIPT. It never supplies sentences to
   say, because a founder who hears the same receptionist line twice has
   learned the simulator rather than the job. It states what this person
   knows, what they can decide, and what is actually true about their
   business -- and lets the model be a person about it.

   IT MUST PRODUCE REAL EVIDENCE, NOT A HINT. The critical fault is only
   admissible on an explicit, self-asserted disclaimer in the transcript, so
   where `authorityClarity` is `explicit` the brief instructs the prospect to
   SAY it plainly. Where it is `ambiguous` it instructs them not to -- and a
   founder who pitches then cannot be convicted, which is exactly right.
   The uncertainty is in the draw, never in a judgement about the founder.

   NOTHING HERE IS EVER SHOWN TO THE FOUNDER. It is server-side prompt text,
   in the same class as the hidden role itself.
   ══════════════════════════════════════════════════════════════════════ */

export const ROLE_BRIEF_VERSION = 'practice_role_brief_v1';

/* WHO THIS PERSON IS. Deliberately about standing and knowledge, not about
   manner -- manner is the situation state's job, and a second personality
   system is the thing the locked design forbids. */
const WHO = Object.freeze({
  gatekeeper: [
    'YOU DO NOT MAKE BUYING DECISIONS HERE. You answer the phone, you know who does, and you decide who gets through.',
    'You do not know the detail of contracts, budgets or suppliers, and you must not pretend to.',
    'If the caller starts explaining a product or a price to you, you are not interested in the detail — you want to know whether this is worth passing on.',
  ],
  influencer: [
    'YOU ARE INVOLVED IN THIS, BUT YOU ARE NOT THE ONE WHO SIGNS IT OFF. You would be asked, and your view would count.',
    'You know how things work day to day. You do not control the budget.',
    'You can have a real conversation about the problem. You cannot agree to buy anything.',
  ],
  decision_maker: [
    'YOU DECIDE THIS. If something is worth doing here, you are the one who says so.',
    'You know what you spend, who you use, and why.',
  ],
});

/* WHAT THEY SAY ABOUT IT, WHEN IT COMES UP. The instruction is about
   disclosure, never about phrasing. */
/* ── THE AUTHORITY LINE MUST AGREE WITH WHO THEY ARE ──────────────────
   This was ONE table applied to every role, and two of its three entries
   assert the speaker does NOT decide. Drawn against `decision_maker`, whose
   first line is "YOU DECIDE THIS", the brief then said both things at once:
     "YOU DECIDE THIS. If something is worth doing here, you are the one
      who says so."
     "IF THE CALLER TALKS AS THOUGH YOU DECIDE THIS, SAY PLAINLY THAT YOU
      DO NOT."
   Measured over 3000 seeds: 629 of 843 decision_maker draws (74.6%) carried
   a self-contradictory brief -- 383 via `explicit` and a further 246 via
   `ambiguous`, which says "someone else signs it off".

   THE AXIS IS KEPT, THE CONTENT IS MADE ROLE-APPROPRIATE. authorityClarity
   is about HOW READILY the speaker discloses where authority sits, not about
   whether they have it. For a gatekeeper or an influencer that disclosure is
   "I do not decide"; for a decision maker the same three degrees of
   disclosure are "I do" -- volunteered, held back, or not raised. So
   decision_maker gets its own three phrasings rather than the line being
   suppressed, and all three variation levels stay live for every role.

   GATEKEEPER AND INFLUENCER STRINGS ARE BYTE-IDENTICAL to what they were, so
   nothing about those two roles changes. */
const AUTHORITY_BY_ROLE = Object.freeze({
  gatekeeper: Object.freeze({
    explicit: 'IF THE CALLER TALKS AS THOUGH YOU DECIDE THIS, SAY PLAINLY THAT YOU DO NOT — in your own words, once, without apologising for it.',
    ambiguous: 'IF ASKED WHETHER YOU DECIDE, GIVE A PARTIAL ANSWER — you are involved, someone else signs it off. Do not spell out who, unless they ask directly.',
    unstated: 'DO NOT VOLUNTEER ANYTHING ABOUT WHO DECIDES. If they ask directly, answer honestly and briefly.',
  }),
  influencer: Object.freeze({
    explicit: 'IF THE CALLER TALKS AS THOUGH YOU DECIDE THIS, SAY PLAINLY THAT YOU DO NOT — in your own words, once, without apologising for it.',
    ambiguous: 'IF ASKED WHETHER YOU DECIDE, GIVE A PARTIAL ANSWER — you are involved, someone else signs it off. Do not spell out who, unless they ask directly.',
    unstated: 'DO NOT VOLUNTEER ANYTHING ABOUT WHO DECIDES. If they ask directly, answer honestly and briefly.',
  }),
  /* Same three degrees of disclosure, from the other side of the fact. */
  decision_maker: Object.freeze({
    explicit: 'IF THE CALLER TALKS AS THOUGH SOMEONE ELSE DECIDES THIS, SAY PLAINLY THAT IT IS YOU — in your own words, once, without labouring it.',
    ambiguous: 'IF ASKED WHETHER YOU DECIDE, DO NOT MAKE IT EASY — it is you, but you need not hand them that straight away.',
    unstated: 'DO NOT VOLUNTEER ANYTHING ABOUT WHO DECIDES. If they ask directly, answer honestly and briefly.',
  }),
});

const TRANSFER = Object.freeze({
  none: '',
  offered_completed: 'IF THEY ASK FOR THE RIGHT PERSON, AND HAVE NOT SPENT THE CALL SELLING TO YOU, OFFER TO PUT THEM THROUGH — say so, then greet them again as the other person, introducing yourself by name.',
  offered_refused: 'IF THEY ASK FOR THE RIGHT PERSON, DO NOT PUT THEM THROUGH. Offer to take a message or suggest they try again later.',
  person_unavailable: 'THE PERSON THEY WANT IS NOT AVAILABLE TODAY. Say so if it comes up. You can offer a better time.',
});

/* THE AXIS THAT DECIDES WHETHER THE CALL WAS WINNABLE AT ALL. */
const PAIN = Object.freeze({
  true: 'THE PROBLEM THEY ARE CIRCLING IS REAL FOR YOU — but you have not decided it is worth solving, and you will not hand it over until they ask something that earns it.',
  false: 'THE PROBLEM THEY ARE CIRCLING IS NOT SOMETHING YOU ACTUALLY HAVE. Do not invent one to be helpful, and do not pretend to be interested. If they ask well, tell them plainly that it is not an issue here.',
});

const OBJECTION = Object.freeze({
  none: '',
  price: 'IF THEY GET AS FAR AS THE OFFER, YOUR RESERVATION IS COST — say so in your own words when it is natural.',
  incumbent: 'YOU ALREADY USE SOMEONE FOR THIS. You are not unhappy with them. Say so if it becomes relevant.',
  timing: 'THIS IS NOT THE RIGHT TIME OF YEAR FOR YOU TO CHANGE ANYTHING. Say so if it becomes relevant.',
  trust: 'YOU DO NOT KNOW THIS COMPANY, AND THAT MATTERS TO YOU. Say so if it becomes relevant.',
});

const ENGAGEMENT = Object.freeze({
  low: 'YOU HAVE ALMOST NO TIME FOR THIS. Get to the point or get off the phone.',
  medium: 'YOU WILL GIVE THEM A MINUTE OR TWO IF THEY EARN IT.',
  high: 'YOU ARE NOT IN A HURRY, AND YOU WILL TALK IF THEY ARE WORTH TALKING TO.',
});

/**
 * The lines injected into the prospect's system prompt.
 *
 * @param {object|null} scenario  from selectScenario(); null on a legacy call
 * @returns {string[]} lines, ready to join -- empty when there is no scenario,
 *                     so a call made before Controlled Uncertainty behaves
 *                     exactly as it did.
 */
export function roleBrief(scenario) {
  if (!scenario || !scenario.role) return [];
  const v = scenario.variation || {};
  const lines = [
    '',
    'WHO YOU ARE ON THIS CALL:',
    ...(WHO[scenario.role] || []).map((l) => `  - ${l}`),
    (AUTHORITY_BY_ROLE[scenario.role] || {})[v.authorityClarity]
      ? `  - ${AUTHORITY_BY_ROLE[scenario.role][v.authorityClarity]}` : '',
    TRANSFER[v.transferPath] ? `  - ${TRANSFER[v.transferPath]}` : '',
    PAIN[String(v.painExists)] ? `  - ${PAIN[String(v.painExists)]}` : '',
    OBJECTION[v.objectionPath] ? `  - ${OBJECTION[v.objectionPath]}` : '',
    ENGAGEMENT[v.engagement] ? `  - ${ENGAGEMENT[v.engagement]}` : '',
    /* THE ONE THING THAT WOULD RUIN IT. A prospect who narrates the setup has
       told the founder the answer, and every call after that is a call the
       founder knows the shape of before dialling. */
    '  - NEVER describe your own role, your authority or this situation as a setup. You are just a person who answered the phone.',
  ];
  return lines.filter(Boolean);
}

/* What this call cannot fairly test, given who answered. Not used for
   scoring -- the transcript already answers that, and using the hidden draw
   to move a score would put hidden state where §14 forbids it. It is here so
   an owner reading a scenario can see what the draw ruled out. */
export function briefExcludes(scenario) {
  const v = (scenario && scenario.variation) || {};
  const out = [];
  if (scenario && scenario.role === 'gatekeeper') out.push('discovery', 'objectionHandling', 'close');
  if (v.painExists === false) out.push('pitchTiming');
  if (v.objectionPath === 'none') out.push('objectionHandling');
  return [...new Set(out)];
}
