/* ════════════════════════════════════════════════════════════════════════
   THE NUANCE JUDGE — THE HALF THAT IS A MODEL.

   judge-contract.js already owns eligibility, citation enforcement, the
   accusation threshold, discoverability fairness and the retry downgrade.
   NONE of that is repeated here, and nothing here may be trusted: this file
   turns a call into a question and a model's answer into the raw shape
   `admitBatch` will interrogate. It calls no provider and decides nothing.

   Three properties are structural.

   ONE REQUEST PER CALL, NOT ONE PER TURN. A judgement about turn 6 that
   cannot see turn 2 cannot tell a repair from a rewording, and asking
   thirty times costs thirty times as much to get a worse answer. The whole
   call goes in once and every eligible unit comes back together.

   THE MODEL NEVER SEES THE ANSWER. The prompt is assembled only from what
   `buildJudgeInput` let through, and `assertNoLeak` then walks that object
   to EVERY depth -- because the leak that actually happens is a corpus turn
   carrying `_events` inside a field that is allowed, not a caller passing
   `expectedVerdict` at the top. A leak here is a benchmark agreeing with the
   system it is supposed to audit.

   THERE IS NO CONFIDENCE FIELD. Not in the schema, not in the prompt. A
   percentage invites a threshold, a threshold is a score, and this judge
   does not score anything -- it says one of four words and shows its
   working, or it says UNCERTAIN and costs nothing.
   ══════════════════════════════════════════════════════════════════════ */
import {
  DIMENSIONS, CALL_DIMENSIONS, VERDICTS,
} from './benchmark/schema.js';
import { DIMENSION_SEMANTICS } from './benchmark/metrics.js';
import { JUDGE_INPUT_FORBIDDEN } from './judge-contract.js';

export const NUANCE_JUDGE_PROMPT_VERSION = 'practice_nuance_judge_prompt_v1';

/* One request per call while a call fits. Past this the batch is split on
   unit boundaries -- never on turn boundaries, because every request still
   carries the WHOLE transcript. Splitting the evidence is what one-call-per-
   turn does wrong, and a split batch must not quietly reintroduce it. */
/* SPLIT SO THE HALVES CAN RUN TOGETHER. At 48 a normal rehearsal never
   split at all -- a 5-turn call produces 32 units across 7 turn dimensions,
   so every call was one request carrying every question, and the founder
   waited for all of it serially. Profiled on staging: judgeRequests was
   [1,1,1] and the single call was 82% of the entire post-call wait.

   16 splits that same call into two requests which runNuanceJudge now issues
   concurrently, roughly halving the output tokens on the critical path. The
   cost is that the call context rides in both requests, so input tokens
   roughly double -- input is the cheap half, and the trade is deliberate.

   It changes no verdict: each unit carries its own question and the whole
   call is in every request, so a unit is judged on identical evidence
   whichever request it lands in. */
export const MAX_UNITS_PER_REQUEST = 16;

/* ── THE SHAPE ────────────────────────────────────────────────────────
   Strict structured output. Every optional value is a NULLABLE SCALAR, not
   a nullable object: a nested `anyOf` branch is the part of strict mode
   providers disagree about, and an address is two integers and a string
   whether it is nested or not. The normaliser reassembles them. */
const CITATION = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['sequence', 'attemptNo', 'speaker', 'quote'],
  properties: {
    sequence: { type: 'integer', description: 'The sequence number printed on the turn.' },
    attemptNo: { type: 'integer', description: 'The attempt number printed on the turn. 1 unless it is a retry.' },
    speaker: { type: 'string', enum: ['founder', 'prospect'] },
    quote: { type: 'string', description: 'An EXACT substring of that turn. Copy it; do not paraphrase, tidy or shorten mid-word.' },
  },
});

export const JUDGE_BATCH_SCHEMA = Object.freeze({
  name: 'practice_nuance_judgements',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['judgements'],
    properties: {
      judgements: {
        type: 'array',
        description: 'Exactly one entry per question asked, in the order the questions were asked.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'questionNo', 'dimension', 'sequence', 'attemptNo', 'verdict',
            'citations', 'rationale',
            'selectionSequence', 'selectionAttemptNo',
            'newFaultSequence', 'newFaultAttemptNo', 'newFaultQuote',
          ],
          properties: {
            questionNo: { type: 'integer', description: 'The number of the question this answers.' },
            dimension: { type: 'string', enum: Object.keys(DIMENSIONS) },
            sequence: { type: ['integer', 'null'], description: 'The sequence of the turn the question is about. null for a whole-call question.' },
            attemptNo: { type: ['integer', 'null'], description: 'The attempt of that turn. null for a whole-call question.' },
            verdict: { type: 'string', enum: VERDICTS },
            citations: { type: 'array', items: CITATION },
            rationale: { type: 'string', description: 'Two sentences at most, about what was said. No advice, no score, no percentage.' },
            selectionSequence: { type: ['integer', 'null'], description: 'Whole-call questions only: the sequence of the single turn you are naming. null otherwise.' },
            selectionAttemptNo: { type: ['integer', 'null'], description: 'Whole-call questions only: the attempt of that turn. null otherwise.' },
            newFaultSequence: { type: ['integer', 'null'], description: 'retry_repaired only: if the retry fixed the named fault but introduced a NEW one, the sequence it is visible on. null otherwise.' },
            newFaultAttemptNo: { type: ['integer', 'null'], description: 'retry_repaired only: the attempt of that turn. null otherwise.' },
            newFaultQuote: { type: ['string', 'null'], description: 'retry_repaired only: an exact substring showing the new fault. null otherwise.' },
          },
        },
      },
    },
  },
});

/* ── THE QUESTIONS ────────────────────────────────────────────────────
   The unit list is code's (judgeableUnits). This numbers it for the prompt
   so a judgement can be traced back to the question it answers even when
   the model misaddresses the turn -- which is itself a finding, not
   something to silently repair. */
export function enumerateQuestions(units = []) {
  return units.map((u, i) => ({
    questionNo: i + 1,
    dimension: u.dimension,
    sequence: CALL_DIMENSIONS.includes(u.dimension) ? null : u.sequence,
    attemptNo: CALL_DIMENSIONS.includes(u.dimension) ? null : (u.attemptNo == null ? 1 : u.attemptNo),
    question: DIMENSIONS[u.dimension],
    unit: u,
  }));
}

export function planJudgeBatches(units = [], { maxUnits = MAX_UNITS_PER_REQUEST } = {}) {
  const size = Math.max(1, Number(maxUnits) || MAX_UNITS_PER_REQUEST);
  if (units.length <= size) return [units.slice()];
  const out = [];
  for (let i = 0; i < units.length; i += size) out.push(units.slice(i, i + size));
  return out;
}

/* ── THE STANDARD ─────────────────────────────────────────────────────
   Written once, here, because a standard that lives in two prompt strings
   is two standards. It is the judgement standard the founder is owed, not
   a rubric: it names what is NOT a fault as carefully as what is. */
const STANDARD = [
  'JUDGE THE SALES MOVE, NOT THE WORDING. A blunt, plain, or awkward sentence that does the right',
  'thing is a good move. A smooth sentence that does the wrong thing is not.',
  '',
  'THERE IS MORE THAN ONE GOOD CALL. Do not assume a good call pitches, answers every objection, or',
  'ends in a meeting. Establishing there is no fit and leaving politely can be an excellent call, and',
  'so can a call that only ever asks questions.',
  '',
  'THE PROSPECT IS NOT THE FOUNDER\'S FAULT. If a strong question is met with a refusal or an honest',
  '"I don\'t know", the founder does not lose credit for information that was never available. The',
  'reverse also holds: if a vague or lazy question happens to be met with a generous answer, the',
  'prospect rescued it and the founder is not owed full credit for the move.',
  '',
  'AN ACCUSATION COSTS MORE THAN PRAISE. Before you say a turn was a fault, you must be able to quote',
  'the turn itself AND a second, different turn that shows why it was a fault -- what was already said,',
  'already refused, or already established that the founder ignored. If you cannot quote that second',
  'turn, you do not have a case: answer UNCERTAIN.',
  '',
  'WHEN IT IS GENUINELY ARGUABLE, ANSWER UNCERTAIN. UNCERTAIN is a correct answer and it costs nothing.',
  'A confident wrong answer is the expensive one.',
  '',
  'RETRY REPAIR IS NARROW. The only question is whether the retry removed the SPECIFIC fault it was',
  'coached on. Saying the same thing in nicer words is NOT a repair. If the fault is gone but the retry',
  'introduced a new one, say YES and fill in the newFault fields; something else decides what that means.',
].join('\n');

const CITATION_RULES = [
  'EVERY citation must be an EXACT substring of the turn you cite, copied character for character from',
  'the transcript below. If you cannot copy an exact phrase, do not make the claim.',
  'Every judgement except UNCERTAIN must cite the turn it is about. Whole-call questions must name the',
  'single turn in selectionSequence / selectionAttemptNo AND cite it.',
  'Never cite a turn that is not printed below. Never cite a sequence you have not seen.',
  'Do not give a confidence, a percentage, a score, a rating or a recommendation. Verdict, quotes, and',
  'at most two sentences of reasoning about what was said.',
].join('\n');

/* ── THE GROUNDED VIEW ────────────────────────────────────────────────
   Only what buildJudgeInput let through, rendered plainly. A field the
   caller did not supply prints as an honest absence -- never as an
   invented default, because "no objection was raised" and "objections were
   not tracked" are different facts and the judge must not confuse them. */
const line = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

function renderTranscript(turns = []) {
  return turns.map((t) => {
    const att = t.attemptNo == null ? 1 : t.attemptNo;
    const flags = [];
    if (t.complete === false) flags.push('VISION DID NOT HEAR THE END OF THIS TURN');
    if (t.branch === 'superseded') flags.push('SUPERSEDED BY A LATER ATTEMPT AT THE SAME SEQUENCE');
    return `[seq ${t.sequence} · attempt ${att}] ${t.speaker}: ${line(t.text)}`
      + (flags.length ? `\n    (${flags.join('; ')})` : '');
  }).join('\n');
}

function renderCallState(s) {
  if (!s) return 'CALL STATE: not recorded.';
  const perm = s.pitchPermission && typeof s.pitchPermission === 'object'
    ? s.pitchPermission.granted : s.pitchPermission;
  const refusal = s.refusal && typeof s.refusal === 'object' ? s.refusal.state : s.refusal;
  const qual = s.qualification && typeof s.qualification === 'object'
    ? `${s.qualification.level} (${s.qualification.label})` : String(s.qualification);
  const obj = s.activeObjection && typeof s.activeObjection === 'object'
    ? `${s.activeObjection.kind} — "${line(s.activeObjection.said)}"` : (s.activeObjection || 'none');
  return [
    'CALL STATE AT THE END OF THE CALL (VISION recorded this; it is not an opinion):',
    `  permission to pitch: ${perm ? 'granted' : 'never granted'}`,
    `  strongest refusal reached: ${refusal || 'none'}`,
    `  objection left open: ${obj}`,
    `  qualification reached: ${qual}`,
    `  founder turns the prospect ignored: ${s.turnsIgnored == null ? 'not counted' : s.turnsIgnored}`,
  ].join('\n');
}

function renderEvents(events = []) {
  const supported = events.filter((e) => e && e.authority === 'supported');
  if (!supported.length) {
    return 'DETERMINISTIC FINDINGS VISION IS WILLING TO STAND BEHIND: none.\n'
      + '  (This means VISION detected nothing it could support, NOT that the call was clean.)';
  }
  return ['DETERMINISTIC FINDINGS VISION IS WILLING TO STAND BEHIND (facts, already established):',
    ...supported.map((e) => `  [seq ${e.subjectSequence} · attempt ${e.subjectAttemptNo}] ${e.eventType}`
      + ` — ${(e.citations || []).map((c) => `"${line(c.quote)}"`).join(' + ')}`)].join('\n');
}

function renderReactions(reactions = []) {
  if (!reactions.length) return 'WHAT THE PROSPECT EXPLICITLY DID: nothing enumerable was read.';
  return ['WHAT THE PROSPECT EXPLICITLY DID (read from their own words, one of a fixed list):',
    ...reactions.map((r) => `  [seq ${r.subjectSequence}] ${r.eventType}`
      + (r.authority === 'supported' ? '' : ` (VISION withheld this reading: ${r.authorityBasis})`))].join('\n');
}

function renderAnswerKey(key) {
  const entries = (key && key.entries) || [];
  if (!entries.length) return 'WHAT WAS ASKED AND WHETHER IT COULD BE ANSWERED: not tracked.';
  return ['WHAT WAS ASKED AND WHETHER IT COULD BE ANSWERED.',
    'Where the state is "refused" or "explicitly_unknown", THE INFORMATION WAS NOT AVAILABLE TO THE',
    'FOUNDER. Do not fault them for not having it; judge only the move they made.',
    ...entries.map((e) => `  ${e.askedAtSeq == null ? '[not asked]' : `[asked at seq ${e.askedAtSeq}]`}`
      + ` ${e.state} — "${line(e.topic).slice(0, 160)}"`)].join('\n');
}

function renderFacts(facts = []) {
  if (!facts.length) return 'INDEPENDENTLY VERIFIED FACTS ABOUT THE PROSPECT: none were held.';
  return ['INDEPENDENTLY VERIFIED FACTS ABOUT THE PROSPECT (VISION observed these before the call):',
    ...facts.map((f) => `  - ${line(typeof f === 'string' ? f : (f.value || f.text || JSON.stringify(f)))}`)].join('\n');
}

function renderRetry(retryContext) {
  const coached = (retryContext && retryContext.coached) || [];
  if (!coached.length) return 'GUIDED RETRIES: none were coached in this call.';
  return ['GUIDED RETRIES. VISION stopped the founder and named ONE fault, and they said it again.',
    'For a retry_repaired question, the ONLY thing being asked is whether THAT named fault is gone.',
    ...coached.map((c) => `  seq ${c.sequence}: attempt ${c.fromAttempt == null ? 1 : c.fromAttempt}`
      + ` was faulted as "${line(c.reason)}"; attempt ${c.toAttempt} is the retry.`
      + (c.coachingSaid ? ` VISION said: "${line(c.coachingSaid)}"` : ''))].join('\n');
}

function renderQuestions(questions = []) {
  return questions.map((q) => {
    const where = q.sequence == null
      ? 'about the WHOLE CALL — name one turn'
      : `about [seq ${q.sequence} · attempt ${q.attemptNo}]`;
    const sem = DIMENSION_SEMANTICS[q.dimension] || {};
    const scale = [sem.yes ? `YES = ${sem.yes}` : null, sem.partial ? `PARTIAL = ${sem.partial}` : null,
      sem.no ? `NO = ${sem.no}` : null].filter(Boolean).join('; ');
    return `Q${q.questionNo}. [${q.dimension}] ${where}\n    ${q.question}`
      + (scale ? `\n    ${scale}` : '');
  }).join('\n');
}

/* ── THE LEAK GUARD ───────────────────────────────────────────────────
   buildJudgeInput screens the TOP LEVEL of the object. This screens every
   level of it, because the leak that matters is not a caller passing
   `expectedVerdict` -- it is a corpus turn quietly carrying `_events` or a
   call carrying `fixture_intent` inside a field that IS allowed, with the
   top-level guard still green and the answer printed under the transcript.

   It screens KEYS, never prose. A guard that searched the finished prompt
   for the word "score" would fire on the sentence telling the judge not to
   produce one, and a guard that cries wolf gets deleted. */
export const LEAK_KEYS = Object.freeze([
  'score', 'vision_score', 'visionScore', 'points', 'rubric', 'weights',
  'review', 'reviewText', 'reviewOutput', 'review_output', 'previousReview',
  'verdict', 'expected_verdict', 'expectedVerdict', 'gold',
  'fixture', 'fixture_intent', 'fixtureIntent', 'privateObjective',
  'split', 'family', 'familyKey', 'discoverable', 'answer_key_state',
  'judge_output', 'judgeOutput', 'detected_events', 'detectedEvents',
  'founder_action', 'founderAction', 'unitId', '_events', '_branch',
]);
const LEAK_KEY_SET = new Set(LEAK_KEYS);

/* Compound tokens that cannot occur in the standard's own English. Cheap,
   and it catches a renderer that stringified something the key walk could
   not reach -- a pre-formatted string carrying the answer, for instance. */
const LEAK_TOKENS = Object.freeze(['expected_verdict', 'vision_score', 'fixture_intent',
  'judge_output', 'answer_key_state', 'detected_events', 'founder_action', 'review_output']);

export function assertNoLeak(value, path = 'input') {
  const seen = new Set();
  const walk = (v, at) => {
    if (v == null) return;
    if (typeof v === 'string') {
      const low = v.toLowerCase();
      const hit = LEAK_TOKENS.filter((t) => low.includes(t));
      if (hit.length) throw new Error(`judge_prompt_leaks:${at}:${hit.join(',')}`);
      return;
    }
    if (typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    Object.keys(v).forEach((k) => {
      if (LEAK_KEY_SET.has(k)) throw new Error(`judge_input_leaks:${at}.${k}`);
      walk(v[k], `${at}.${k}`);
    });
  };
  walk(value, path);
  return true;
}

/* ── THE REQUEST ──────────────────────────────────────────────────────
   `input` is the Responses API's message list. `judgeInput` MUST already
   have been through buildJudgeInput; this asserts it rather than trusting
   it, because the one caller that forgets is the one that matters. */
export function judgeBatchInput({ judgeInput, units }) {
  const raw = judgeInput || {};
  const leaked = JUDGE_INPUT_FORBIDDEN.filter((k) => raw[k] !== undefined);
  if (leaked.length) throw new Error(`judge_input_leaks:${leaked.join(',')}`);
  assertNoLeak(raw, 'judgeInput');
  const questions = enumerateQuestions(units || []);

  const system = [
    'You are judging one recorded cold sales call for a founder who is practising. You are not coaching',
    'them, not scoring them, and not talking to them. You answer specific questions about specific turns,',
    'and you show the words you based each answer on.',
    '',
    STANDARD,
    '',
    CITATION_RULES,
    '',
    'Answer EVERY question below, exactly once, in order. If you cannot answer one honestly, answer',
    'UNCERTAIN with no citations rather than guessing.',
  ].join('\n');

  const user = [
    `WHAT THE FOUNDER WAS TRYING TO DO ON THIS CALL: ${line(raw.objective) || 'not recorded'}`,
    '',
    renderFacts(raw.verifiedFacts),
    '',
    'THE CALL, AS VISION ASSEMBLED IT. Sequence and attempt are the only addresses that exist.',
    'Where one sequence has more than one attempt, the founder was stopped and said it again.',
    '',
    renderTranscript(raw.turns),
    '',
    renderCallState(raw.callState),
    '',
    renderEvents(raw.candidateEvents),
    '',
    renderReactions(raw.reactions),
    '',
    renderAnswerKey(raw.answerKey),
    '',
    renderRetry(raw.retryContext),
    '',
    '════════ THE QUESTIONS ════════',
    renderQuestions(questions),
  ].join('\n');

  assertNoLeak(system, 'system');
  assertNoLeak(user, 'user');
  return { input: [{ role: 'system', content: system }, { role: 'user', content: user }], questions };
}

/* ── THE ANSWER ───────────────────────────────────────────────────────
   Reassembles the flat scalars into the shape admitJudgement interrogates,
   and NOTHING else. It repairs no address, drops no verdict and invents no
   citation: an answer the model addressed to the wrong turn stays addressed
   to the wrong turn, so admission discards it and the discard is counted.
   Quietly correcting it here would hide a judge that reads the wrong line. */
export function normaliseJudgeBatch(parsed, { questions = [] } = {}) {
  const rows = Array.isArray(parsed && parsed.judgements) ? parsed.judgements : [];
  const byNo = new Map(questions.map((q) => [q.questionNo, q]));
  const unanswered = new Set(questions.map((q) => q.questionNo));
  const problems = [];
  const seen = new Set();

  const out = rows.map((r) => {
    const q = byNo.get(r && r.questionNo);
    if (!q) problems.push(`answer_for_no_question:${r && r.questionNo}`);
    else if (seen.has(r.questionNo)) problems.push(`question_answered_twice:${r.questionNo}`);
    else { seen.add(r.questionNo); unanswered.delete(r.questionNo); }

    const isCall = CALL_DIMENSIONS.includes(r && r.dimension);
    const cites = Array.isArray(r && r.citations) ? r.citations.map((c) => ({
      sequence: c && c.sequence, attemptNo: c && c.attemptNo == null ? 1 : c.attemptNo,
      speaker: c && c.speaker, quote: c && c.quote,
    })) : [];

    /* The model's own address is kept. Only where it declined to give one at
       all does the question's address stand in -- an absent answer is not the
       same mistake as a wrong one, and only the wrong one is a finding. */
    const seq = r && r.sequence != null ? r.sequence : (q ? q.sequence : null);
    const att = r && r.attemptNo != null ? r.attemptNo : (q ? q.attemptNo : 1);

    const judgement = {
      dimension: r && r.dimension,
      verdict: r && r.verdict,
      citations: cites,
      rationale: r && r.rationale,
      ...(isCall ? {} : { sequence: seq, attemptNo: att == null ? 1 : att }),
    };
    if (isCall) {
      judgement.selection = (r && r.selectionSequence != null)
        ? { sequence: r.selectionSequence, attemptNo: r.selectionAttemptNo == null ? 1 : r.selectionAttemptNo }
        : null;
    }
    if (r && r.dimension === 'retry_repaired' && r.newFaultSequence != null && r.newFaultQuote) {
      judgement.newFault = { sequence: r.newFaultSequence,
        attemptNo: r.newFaultAttemptNo == null ? 1 : r.newFaultAttemptNo, quote: r.newFaultQuote };
    }
    return { judgement, questionNo: r && r.questionNo, addressedAs: { sequence: seq, attemptNo: att } };
  });

  unanswered.forEach((n) => problems.push(`question_unanswered:${n}`));
  return { judgements: out.map((o) => o.judgement), rows: out, problems };
}
