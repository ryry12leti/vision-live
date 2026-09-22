/* ════════════════════════════════════════════════════════════════════════
   THE NUANCE JUDGE — ONE RUN, END TO END.

   The seam between the two halves, and the only place they meet. It exists
   so the Edge Function and the benchmark harness cannot drift into two
   different judges: eligibility comes from judgeableUnits, the question from
   judgeBatchInput, the answer from an INJECTED provider, and the decision
   from admitBatch. Every one of those is somebody else's, and this file
   overrides none of them.

   IT ADMITS NOTHING ITSELF. Not one verdict in this file is decided, changed
   or rescued. What it does own is the LEDGER: a run reports what it asked,
   what came back, what survived and why the rest did not — because a judge
   whose failures are invisible reads as a judge that never fails.
   ══════════════════════════════════════════════════════════════════════ */
import { judgeableUnits, buildJudgeInput, admitBatch } from './judge-contract.js';
import {
  judgeBatchInput, normaliseJudgeBatch, planJudgeBatches,
  JUDGE_BATCH_SCHEMA, NUANCE_JUDGE_PROMPT_VERSION, MAX_UNITS_PER_REQUEST,
} from './nuance-judge-model.js';

export { JUDGE_BATCH_SCHEMA, NUANCE_JUDGE_PROMPT_VERSION };

const addUsage = (a, b) => ({
  input_tokens: (a.input_tokens || 0) + (b?.input_tokens || 0),
  output_tokens: (a.output_tokens || 0) + (b?.output_tokens || 0),
  reasoning_tokens: (a.reasoning_tokens || 0)
    + (b?.output_tokens_details?.reasoning_tokens || 0),
});

/**
 * @param {object}   call              assembled call: { callId, turns }
 * @param {object}   context           the grounded view — objective, callState,
 *                                     candidateEvents, reactions, answerKey,
 *                                     verifiedFacts, retryContext. Screened by
 *                                     buildJudgeInput before it is rendered.
 * @param {function} callModel         async ({input, schema}) => {ok, parsed, usage, ms}
 * @param {function} discoverabilityOf (unit) => true|false|null
 */
/* How many judge requests may be in flight at once. Three is chosen to keep
   a long call's fan-out well inside provider limits while still collapsing
   the common two-batch case into a single round trip. */
const MAX_CONCURRENT_BATCHES = 3;

export async function runNuanceJudge({
  call, context = {}, callModel, discoverabilityOf = null,
  maxUnits = MAX_UNITS_PER_REQUEST,
} = {}) {
  const retryContext = context.retryContext || null;
  const units = judgeableUnits(call, { retryContext });
  const judgeInput = buildJudgeInput({ ...context, callId: call.callId, turns: call.turns });

  const batches = planJudgeBatches(units, { maxUnits });
  const raw = [];
  const shapeProblems = [];
  const failures = [];
  let usage = { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 };
  let ms = 0;
  let model = null;

  /* ── BATCHES RUN CONCURRENTLY ─────────────────────────────────────────
     This loop used to await each batch in turn, and the comment justifying
     it said the sequencing bought "a latency win nobody is waiting on after
     the call has ended". That premise turned out to be false: this is the
     post-call scoring wait, and a founder sits in front of it. Profiled on
     canonical staging, the judge was 36.7s of a 44.6s total -- 82% of the
     wait, and essentially all of it the model call itself.

     Batches are independent by construction: each is handed the SAME
     `judgeInput` (the whole call) and differs only in which questions it
     carries, and nothing is combined until `admitBatch` below. So running
     them together changes no verdict -- only when they arrive.

     Order is preserved. Promise.all resolves positionally, so `raw` is
     assembled in exactly the sequence the serial loop produced, and a
     reader downstream cannot tell which path built it.

     Concurrency is BOUNDED rather than unlimited. The original comment's
     real concern was peak spend, and it was not wrong about the shape of
     the risk: this provider rate-limited us earlier in this project, and an
     unbounded fan-out on a long call would be the way to meet it again. */
  const settled = [];
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_BATCHES) {
    const window = batches.slice(i, i + MAX_CONCURRENT_BATCHES);
    /* eslint-disable no-await-in-loop -- the await is per WINDOW, not per
       batch; inside a window every request is already in flight. */
    const answers = await Promise.all(window.map((batch) => {
      const { input, questions } = judgeBatchInput({ judgeInput, units: batch });
      return Promise.resolve(callModel({ input, schema: JUDGE_BATCH_SCHEMA }))
        .then((answer) => ({ answer, questions, batch }))
        /* A thrown call is the same outcome as a refused one: unanswered
           units, coverage down, and the ledger says so. It must not take
           the whole review with it. */
        .catch(() => ({ answer: null, questions, batch }));
    }));
    settled.push(...answers);
  }

  for (const { answer, questions, batch } of settled) {
    /* `ms` stays the SUM of model time, not wall time -- it is a cost and
       coverage signal that existing readers already interpret that way, and
       silently redefining it as wall time would make the two incomparable
       across the change. */
    ms += answer?.ms || 0;
    if (answer?.usage) usage = addUsage(usage, answer.usage);
    if (answer?.model) model = answer.model;
    if (!answer || !answer.ok) {
      /* A failed batch is NOT a batch of UNCERTAIN. Its units stay
         unanswered, so coverage falls and the ledger says why. */
      failures.push({ units: batch.length, reason: (answer && answer.reason) || 'model_failed' });
      continue;
    }
    const shaped = normaliseJudgeBatch(answer.parsed, { questions });
    shapeProblems.push(...shaped.problems);
    raw.push(...shaped.judgements);
  }

  const ledger = admitBatch(raw, { units, call, discoverabilityOf });
  return {
    promptVersion: NUANCE_JUDGE_PROMPT_VERSION,
    model,
    requests: batches.length,
    returned: raw.length,
    shapeProblems,
    failures,
    usage,
    ms,
    ...ledger,
  };
}
