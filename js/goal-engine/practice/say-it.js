/* ════════════════════════════════════════════════════════════════════════
   WAYS TO SAY THE MOVE — the wording layer, and nothing more.

   It is handed a Best Move that is already decided and produces two or
   three genuinely different ways to execute THAT move. It has no opinion
   about whether the move is right, cannot see a score, and cannot reach a
   fault: given the same move and the same state it always returns the same
   lines, and given a different move it returns different lines.

   WHAT MAKES A LINE SPECIFIC IS THE STATE, NOT THE TEMPLATE. Every
   alternative is built around a real string the call already contains — the
   objection in the prospect's own words, the fact they disclosed, the
   unknown VISION itself wrote down. The old layer offered whichever
   prepared script questions came first, which is how a chartered-accountancy
   call about month-end reconciliation was advised "Are you actually looking
   to bring in more of that right now?".

   IT INVENTS NO PAIN AND NO INTENT. Nothing here asserts that a problem
   exists, that they want it fixed, or that anything is urgent. Every line
   is a question, an admission, or a repetition of something already said.
   ══════════════════════════════════════════════════════════════════════ */

export const SAY_IT_VERSION = 'practice_say_it_v1';

/* Register comes from the founder's own recorded traits and touches PHRASING
   ONLY. Three ways to make the same move; the move is identical in each. */
export function registerFor(profile) {
  const t = (profile && profile.traits) || {};
  const len = t.sentenceLength && t.sentenceLength.value;
  const formal = t.formality && t.formality.value;
  const direct = t.directness && t.directness.value;
  if (direct === 'direct' && len === 'short') return 'terse';
  if (formal === 'formal' || len === 'long') return 'warm';
  return 'plain';
}

/* Nothing a correction produces may contain these, whatever the profile says. */
const UNSAFE = /\b(you need to|you have to|trust me|no[- ]brainer|obviously|clearly you|everyone else is|losing money)\b/i;

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const unquote = (v) => clean(v).replace(/^["'“‘]|["'”’]$/g, '');
const trimEnd = (v) => unquote(v).replace(/[.?!,;:]+$/, '');
const lower1 = (v) => (v ? v.charAt(0).toLowerCase() + v.slice(1) : v);

/* ── VISION'S OWN UNKNOWN, TURNED INTO A QUESTION ─────────────────────
   The unknowns are sentences VISION authored — "It is not yet known whether
   an incumbent reconciliation contract is still live" — so inverting one is
   a transform on our own prose, never on the founder's freeform speech. If
   the inversion does not fit, the fragment is used inside a frame that is
   grammatical whatever it contains. Never a guess dressed as a question. */
const AUX = /^(.*?)\s+(is|are|was|were|has|have|had|does|do|did|can|could|will|would)\s+(.*)$/i;
export function askAbout(unknownText) {
  const frag = trimEnd(lower1(clean(unknownText)
    .replace(/^it is not yet known (whether|which|who|what|if)\s+/i, '')));
  if (!frag) return null;
  const m = AUX.exec(frag);
  const inverted = m ? `${m[2]} ${m[1]} ${m[3]}` : null;
  return { frag, question: inverted ? `${inverted.charAt(0).toUpperCase()}${inverted.slice(1)}?` : null };
}

/* ── THE PHRASINGS ────────────────────────────────────────────────────
   Three approaches per move, not three rewordings of one sentence:
   ASK IT STRAIGHT, ADMIT WHAT YOU DO NOT KNOW, and USE WHAT THEY GAVE YOU.
   A founder who dislikes one has a real alternative rather than a synonym. */
function linesFor(move, register) {
  const s = move.subject || {};
  const asked = s.kind === 'unknown' && s.text ? askAbout(s.text) : null;
  const q = asked && asked.question;
  /* The inverted question, lower-cased so it can sit inside a frame. A
     fragment that would NOT inverted is never dropped into a frame that
     needs a question — "so tell me — an incumbent contract is still live?"
     is a statement wearing a question mark. */
  const inner = q ? lower1(q.replace(/\?$/, '')) : null;
  const objection = s.kind === 'objection' ? trimEnd(s.text) : null;
  const told = s.disclosed ? trimEnd(s.disclosed) : null;
  const answer = s.kind === 'answer' ? trimEnd(s.text) : null;
  const problem = s.kind === 'problem' ? trimEnd(s.text) : null;
  const theirPain = s.kind === 'their_pain' && s.text ? trimEnd(s.text) : null;
  const soften = register === 'warm';
  const terse = register === 'terse';

  switch (move.moveId) {
    case 'end_professionally':
      return ['Understood — I will take you off the list. Thanks for telling me.',
        'That is fair enough. I will not call again. Thanks for your time.',
        'Noted, and sorry to have bothered you.'];
    case 'accept_the_no':
      /* Not "thanks for being straight" as the default. A blind judge
         caught it flattering a soft brush-off -- a hedge and a time excuse
         -- as candour, which is the panel narrating a call that did not
         happen. This is true however the no arrived. */
      return ['Understood — thanks for your time.',
        'That is fair. Would it be worth me checking back in a few months, or is it a no for good?',
        'Fine by me — I will leave it there.',
        'No problem at all. Thanks for hearing me out.'];
    case 'explore_the_objection':
      return [objection ? `Before I say anything to that — what does "${objection}" look like day to day?`
        : 'Before I say anything to that — what does that look like day to day?',
      objection ? `That is fair. What made you go that way?` : 'That is fair. What made you go that way?',
      'What would have to be different for it to be worth another look?',
      'How long has that been the arrangement?'];
    case 'verify_the_assumption':
      return [q || 'Can I ask whether that is actually the case?',
        inner ? `I am guessing there, so tell me — ${inner}?`
          : 'I am guessing there, so tell me — is that actually how it works?',
        told ? `You said "${told}" — does that cover it, or is there more to it?`
          /* Was "I should not assume that. How does it actually work?",
             which establishes the situation rather than testing the claim
             -- the wrong move, in the library for the right one. */
          : 'I should not assume that — is that actually the case?',
        'Correct me if I have that wrong — what is the reality?',
        'I have jumped ahead there. What is actually the case?',
        'Rather than assume — how would you describe it?'];
    case 'build_on_their_answer':
      return [answer ? `You mentioned "${answer}" — what sits behind that?`
        : 'You mentioned that a moment ago — what sits behind it?',
      answer ? `Coming back to that: when it happens, what does it cost you?`
        : 'Coming back to that: when it happens, what does it cost you?',
      'I think you answered that already — can I take it one step further?',
      'Rather than ask again — what changed since you told me that?'];
    case 'establish_situation':
      return [q || 'How is that handled at the moment?',
        inner ? `Can I ask — ${inner}?` : 'How does that work today, roughly?',
        'Walk me through how it runs at the moment.',
        'What does a normal month look like for that?',
        'Who actually touches that, day to day?',
        'What happens first when it comes round?'];
    case 'find_the_problem':
      return ['When that does not go to plan, what actually happens?',
        'How often does that cause you a problem, if at all?',
        'Is any of that a headache, or is it fine as it is?',
        'What does that cost you when it goes wrong?',
        'Who feels it most when that happens?',
        'Is it an irritation, or does it actually hold something up?'];
    case 'establish_intent':
      return ['Is that something you would want to change, or does it work well enough?',
        'If you could change one thing about it, would you?',
        'Is it worth doing something about, in your view?',
        'Has anyone there tried to change it before?'];
    case 'qualify_timing':
      return ['If you did change it, when would that realistically be?',
        'Who else would need to be part of that decision?',
        'What would it be worth to you to get that time back?',
        'What would need to be true for it to happen this year?'];
    case 'earn_permission':
      return [problem ? `Given "${problem}" — would it help if I explained how we handle that?`
        : 'Would it help if I explained how we handle that?',
      'Is it worth me telling you what we do about that, or not really?',
      'Do you want the thirty-second version of how that gets solved?',
      'Would it be useful if I told you how others handle that?'];
    case 'make_the_offer':
      return [problem ? `On "${problem}" — here is what we do about it.`
        : 'Here is what we do about that.',
      'The short version is this, and tell me if it is not relevant.',
      'What we would actually do is this — stop me if it does not fit.',
      'In practice it works like this, and tell me where it breaks for you.'];
    /* THE ONE MOVE THAT IS NOT ABOUT THEM. Every line asks WHO, or asks to
       be taken to them; none asks how their process works, because more
       discovery with someone who cannot decide is the same mistake going on
       longer. `told` is their own disclaimer, quoted back, so the founder
       hears themselves acknowledging it rather than talking over it. */
    case 'reach_the_decision_maker':
      return [told ? `That is fair — who would be the best person for me to talk to about it?`
        : 'Who would be the best person for me to talk to about it?',
      'Understood — who owns that side of things there?',
      'That makes sense. Should I be speaking to someone else about it?',
      'No problem — who would decide on something like that?',
      'Is it worth me talking to whoever handles that instead?',
      'Could you point me to the right person for it?'];
    case 'ask_for_next_step':
      return ['Shall we put some time in to look at it properly?',
        'Would a short call next week be worth it, or is this enough for now?',
        'What would you want to see before deciding either way?',
        'Is the next step a proper look, or is it not for you?'];

    /* ── THE MOVES THAT ARE NOT QUESTIONS ────────────────────────────
       Two of them deliberately have no wording at all. `let_them_finish`
       is the move where saying ANYTHING is the mistake, and
       `answer_their_question` can only be answered by the one person who
       knows the answer. Offering a sentence for either would be this layer
       overruling the decision — the exact thing it is built not to do — so
       both fall through to `[]` and the goal stands alone on screen. */
    case 'respect_the_boundary':
      return ['Understood — I will do that.',
        'That is fair enough. I will go through the proper channel.',
        'No problem at all — thanks for telling me.',
        'Of course. I will not push it.'];
    /* EVERY LINE HAS TO DO BOTH HALVES OF ITS GOAL. "I will be quick, then.
       One question and I will let you go." acknowledged nothing and offered
       no better time -- half the move simply was not in the wording, and a
       blind judge marked the turn wrong for it. */
    case 'acknowledge_the_pressure':
      return ['I have caught you at a bad moment — is there a better time?',
        'That is fair — I will be quick. One question, then I will let you go.',
        'Sounds like a bad time. Shall I call you back another day instead?',
        'Understood, you are busy — thirty seconds and I am gone.'];
    /* OPENERS, not the whole move -- the founder supplies who he is. They
       also stopped short of blaming him for a lack of clarity the call may
       not show; "let me start again" concedes nothing that is not true. */
    case 'clear_up_the_confusion':
      return ['Sorry — let me start again, properly.',
        'Let me put that a different way.',
        'Fair question. Let me back up a step.',
        'Let me start from the top — quickly.'];
    /* Short, and asked as a courtesy rather than a challenge -- somebody
       who has not said who they are has usually not been asked. */
    case 'identify_the_person':
      return ['Sorry, who am I speaking with?',
        'Before I go on — who have I got?',
        'Can I ask who I am talking to?',
        'Sorry, I did not catch your name — who am I speaking with?'];
    /* ── BUILT ON THEIR WORDS, AND IT NEVER MENTIONS THE OFFER ───────
       The whole value of this move is that the subject came from them, so
       every line quotes or points at it. None of them connect it to what
       the founder sells: whether that has been earned is the ladder's
       decision, and a line that reached for it here would be a pitch
       wearing a question. */
    case 'explore_their_pain':
      return [theirPain ? `You mentioned ${theirPain} — what does that actually cost you?`
        : 'What does that actually cost you?',
      theirPain ? `Say more about ${theirPain} — how does that show up day to day?`
        : 'Say more about that — how does it show up day to day?',
      'How long has that been going on?',
      'Who feels that most?',
      theirPain ? `Is ${theirPain} the thing you would fix first, if you could?`
        : 'Is that the thing you would fix first, if you could?'];
    /* Short, warm, and it holds the door without asking for anything. A
       line that reaches for a callback time here is still a founder
       keeping somebody who has said they need to go. */
    case 'let_them_go':
      return ['Of course — thanks for your time.',
        /* Not "no problem at all" -- the cost gate that stops this move
           asking what something costs on the way out forbids the word
           'problem', and a courtesy is not worth losing the guard for. */
        'Not at all — I will let you get on.',
        'Understood. If it ever changes, we are easy to find.',
        'That is fine — thanks for taking the call.'];
    case 'leave_it_there':
      return ['I will leave it there — thanks for your time.',
        'I do not think this is one for you, and that is fine. Thanks for hearing me out.',
        'That is useful to know either way. I will let you get on.',
        'Sounds like it is not a problem worth solving right now. Thanks for being straight with me.'];
    default:
      return [];
  }
}

/* ── THE ORDER, AND THE CUT ───────────────────────────────────────────
   Register decides which phrasing leads, never which lines exist. */
/* ── A DIFFERENT WINDOW PER CARD ──────────────────────────────────────
   Three corrections of the SAME fault in the SAME state produce the same
   Best Move — correctly, because it is the same move. Handing the founder
   the identical three sentences three times is still useless, so each card
   takes a different window over the move's phrasings. Every line still
   executes the same move; only which of them are shown moves on. */
export function waysToSay({ move = null, profile = null, max = 3, offset = 0 } = {}) {
  if (!move || !move.moveId) return [];
  const register = registerFor(profile);
  const lines = linesFor(move, register).map(clean).filter(Boolean);
  const rotated = lines.length
    ? lines.slice(offset % lines.length).concat(lines.slice(0, offset % lines.length))
    : lines;
  const ordered = register === 'terse' ? rotated.slice().reverse() : rotated;
  const out = [];
  for (const line of ordered) {
    if (UNSAFE.test(line)) continue;
    if (out.some((x) => x.toLowerCase() === line.toLowerCase())) continue;
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/* A founder must never be handed back the sentence they got wrong. */
export function notTheirOwnWords(lines, saidText) {
  const said = clean(saidText).toLowerCase().replace(/[^a-z0-9 ]/g, '');
  if (!said) return lines;
  const words = new Set(said.split(' ').filter((w) => w.length > 3));
  return lines.filter((l) => {
    const mine = clean(l).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter((w) => w.length > 3);
    if (!mine.length) return true;
    const shared = mine.filter((w) => words.has(w)).length / mine.length;
    return shared < 0.7;
  });
}
