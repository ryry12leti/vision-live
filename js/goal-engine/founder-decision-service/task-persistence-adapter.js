/**
 * Founder Decision Service — legacy task-persistence adapter (spec Phase 4).
 *
 * The real user task table/RPC (persist_generated_daily_plan_v1, see
 * supabase/functions/generate-tasks/index.ts's normalize()) predates the
 * Founder engine and expects one fixed, fitness-shaped `tasks[]` contract
 * (title/steps/proof_prompt/proof_must_show/proof_reject_if/
 * context_anchors{10 fields}/mission_intent{5 fields}/etc). Rather than
 * adding a second, Founder-only persistence table, this module maps a
 * validated FounderDecisionResult onto that EXACT existing contract so it
 * flows through the real, unmodified task table, RLS, versioning, and proof
 * pipeline -- "reuse existing task persistence", never a parallel one.
 *
 * Every field below is derived from a real FounderDecisionResult value --
 * never fabricated. Two honest, documented limits:
 *   - the legacy `steps` field is plain strings (no per-step guidance
 *     slot), so per-step beginner guidance is folded into
 *     `why_personalised`/`mistake_to_avoid` instead of lost silently;
 *   - `recommended_proof_type` only supports photo/voice/live; Founder
 *     evidence (a file, link, or sent-message record) maps to 'photo' as
 *     the closest fit -- true modality parity would need a distinct
 *     Founder/document proof type, which does not exist in this schema.
 */

const EFFORT_TO_DIFFICULTY = Object.freeze({ light: 'easy', moderate: 'medium', heavy: 'hard' });
const EFFORT_TO_LEGACY_EFFORT = Object.freeze({ light: 'low', moderate: 'medium', heavy: 'high' });
const DECISION_TO_PROGRESSION_MODE = Object.freeze({
  start: 'new_output', keep: 'maintain', refine: 'progress_success', replace: 'unblock',
});

export function byteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).length;
}
/* Truncate to a BYTE budget, measured the way persistence measures it.
 *
 * public.validate_founder_generated_task_v1 bounds every text field with
 * octet_length -- BYTES. This layer previously truncated with String.slice,
 * which counts UTF-16 code units -- CHARACTERS. For ASCII the two agree, so the
 * mismatch was invisible in short fixtures; for any multibyte character they
 * diverge, and the DB rejects the task.
 *
 * Proven live on canonical staging with realistic detailed Founder intake:
 * clean(step, 200) produced a step of 200 characters / 202 BYTES (the founder's
 * text contained typographic punctuation), and persistence returned
 * 'invalid_step'. The same drift was present on proof_prompt (220 chars ->
 * 222 bytes); it only escaped notice because that field's DB limit is 320, so
 * the accidental headroom hid it. This is a contract mismatch across the whole
 * bounded-text surface, not a steps-only bug.
 *
 * Iterating with `for...of` walks CODE POINTS, so a multibyte character or a
 * surrogate pair is never split -- a byte-wise cut could emit an invalid UTF-8
 * sequence, which is worse than being too long. Where the text must be cut we
 * prefer the last word boundary and mark the cut with an ellipsis, so the
 * action stays readable instead of ending mid-word. */
export function clampBytes(value, maxBytes) {
  const text = String(value ?? '');
  if (maxBytes <= 0) return '';
  if (byteLength(text) <= maxBytes) return text;

  const ELLIPSIS = '…';
  const ellipsisBytes = byteLength(ELLIPSIS);
  const takeUpTo = (budget) => {
    let out = '';
    let used = 0;
    for (const ch of text) {
      const size = byteLength(ch);
      if (used + size > budget) break;
      out += ch;
      used += size;
    }
    return out;
  };

  /* Reserve room for the ellipsis when the budget can afford it. */
  if (maxBytes > ellipsisBytes) {
    let body = takeUpTo(maxBytes - ellipsisBytes);
    /* Prefer a word boundary, but never throw away most of the content to get
       one -- a step that keeps only two words is worse than one cut mid-word. */
    const lastSpace = body.lastIndexOf(' ');
    if (lastSpace > 0 && lastSpace >= Math.floor(body.length * 0.6)) {
      body = body.slice(0, lastSpace);
    }
    body = body.replace(/[\s,;:.!?-]+$/, '').trimEnd();
    if (body) return `${body}${ELLIPSIS}`;
  }
  /* Budget too small for an ellipsis, or the word-boundary pass emptied it:
     fall back to a plain code-point-safe cut, which still cannot be empty for
     non-empty input because at least one character fits. */
  return takeUpTo(maxBytes);
}

/* `max` is now a BYTE budget for every caller. Callers already passed the DB's
   own octet limits, so this makes those numbers mean what they always claimed. */
function clean(value, max) {
  const normalised = String(value ?? '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clampBytes(normalised, max);
}
function trunc(value, max) {
  return clean(value, max);
}
function sentence(value) {
  const text = clean(value, 240);
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}
function slug(value) {
  return clean(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'task';
}
function hash(value) {
  let h = 5381;
  for (const char of value) h = ((h << 5) + h) ^ char.charCodeAt(0);
  return (h >>> 0).toString(36).slice(0, 7);
}

/* `good_proof_examples` must hold 1-3 entries (validate_founder_generated_task_v1
   rejects an empty array), so it cannot simply be dropped -- but it was built as
   `requiredEvidence.map(...)`, i.e. the exact strings already in
   `proof_must_show`. A founder therefore read the same sentence twice under two
   different headings, and "example" taught them nothing about what an acceptable
   submission actually looks like.
   The example is now the same requirement made CONCRETE with the real subjects
   already on the task: the named entities this move is about, and the recorded
   outreach channel. Both are trusted values from the decision result -- nothing
   is invented, and when neither is available it degrades to the plain
   requirement, which is exactly the old behaviour. */
function buildProofExamples(requiredEvidence, relatedEntities, channelLabel) {
  const requirement = clean(requiredEvidence[0] || '', 220);
  const names = (relatedEntities || []).map((entry) => clean(entry, 60)).filter(Boolean).slice(0, 3);
  const examples = [];
  if (names.length > 0) {
    const subject = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const how = channelLabel ? ` after you ${clean(channelLabel, 40).toLowerCase()}` : '';
    examples.push(clean(`A dated note recording, for ${subject}${how}, exactly what each said and the outcome.`, 220));
  }
  for (const entry of requiredEvidence) {
    if (examples.length >= 3) break;
    const value = clean(entry, 220);
    if (value && !examples.includes(value)) examples.push(value);
  }
  return examples.slice(0, 3);
}

/* ── "Why you got this" ────────────────────────────────────────────────
   A founder opening a task should be able to see, in ordinary English, why
   this task and why these exact businesses. Both halves are translations of
   decisions the engine has ALREADY made from facts the founder gave -- nothing
   here re-decides anything, and nothing is invented.

   Deliberately written without our vocabulary: no "bottleneck", no "route", no
   "validate the core hypothesis". A founder should not have to learn our terms
   to understand why they are being asked to do something. Each line is one
   assessed constraint said out loud. */
const WHY_THIS_TASK = Object.freeze({
  insufficient_customer_evidence:
    'You do not have proof yet that people will pay for this. Until you do, every other decision is a guess, so today is about getting that proof.',
  weak_demand:
    'People are hearing about your offer but not taking it up. Today is about finding out whether the offer itself needs to change.',
  /* Covers BOTH shapes this category legitimately holds: a founder with
     prospects who are not converting, and an established one whose offer
     already sells but who has no repeatable way to reach more. The old
     wording asserted the first ("none of them have said yes yet"), which is
     flatly untrue for an agency with paying retainer clients. */
  sales_conversion:
    'Getting new customers is the thing holding you back right now. You do not yet have a repeatable way to turn attention into paid work, so today is about building one.',
  delivery_throughput:
    'Work you have already committed to is still unfinished. More customers only add pressure until that work is done.',
  retention_failure:
    'Customers are leaving faster than you can replace them. Winning new ones will not help until you know why they go.',
  operational_constraint:
    'Something in how you run day to day keeps failing, and it is slowing everything else down.',
  strategic_ambiguity:
    'An open decision is blocking progress. Today closes it so you can move again.',
});

/** Joins names the way a person writes them: "A", "A and B", "A, B and C". */
function joinPlain(items) {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Plain-English reason this task and these businesses were chosen.
 *
 * Which prospects get explained is decided by searching the task's OWN
 * finished text for each recorded name, rather than re-deriving the batch.
 * That makes it impossible for this explanation to name a business the task
 * itself does not.
 *
 * @param {object} result A validated FounderDecisionResult.
 * @param {{name: string, segment: string|null, routes: string[]}[]} prospects
 * @param {string} taskText The composed title and steps.
 * @returns {string} '' when nothing honest can be said.
 */
function buildSelectionRationale(result, prospects, taskText) {
  const parts = [];
  const whyTask = WHY_THIS_TASK[result?.currentBottleneck?.category];
  if (whyTask) parts.push(whyTask);

  const named = (prospects || []).filter((entry) => entry.name && taskText.includes(entry.name));
  if (named.length > 0) {
    const names = joinPlain(named.map((entry) => entry.name));
    const one = named.length === 1;
    const reasons = [];
    /* Claim a shared customer type only when they genuinely share one. */
    const segments = [...new Set(named.map((entry) => entry.segment).filter(Boolean))];
    if (segments.length === 1) reasons.push(`${one ? 'it matches' : 'they match'} the kind of customer you said you sell to (${segments[0]})`);
    else if (segments.length > 1) reasons.push(`${one ? 'it matches' : 'they match'} the kinds of customer you said you sell to`);
    /* Claim a contact route only when EVERY named business has one, so
       "for each" is never an overstatement. */
    if (named.every((entry) => entry.routes.length > 0)) {
      const routes = [...new Set(named.flatMap((entry) => entry.routes))];
      reasons.push(`you have ${joinPlain(routes)} on record for ${one ? 'it' : 'each'}`);
    }
    const tail = reasons.length ? `, and ${joinPlain(reasons)}` : '';
    parts.push(`${names} ${one ? 'is' : 'are'} on this list because you approved ${one ? 'it' : 'them'} yourself from your prospect search${tail}.`);
  }
  return parts.join(' ');
}

/**
 * @param {object} result A validated FounderDecisionResult with status === 'selected' (see contract.js).
 * @param {string} generatedReason The original request's `reason` (e.g. "auto", "manual_refresh") -- never fabricated.
 * @param {{offerText: string|null, channelLabel: string|null}} [contentFacts] From task-quality-gate.js's resolveFounderTaskContentFacts -- real, already-trusted venture facts, never invented here.
 * @returns {object} One entry in the exact shape supabase/functions/generate-tasks/index.ts's normalize()/persist_generated_daily_plan_v1 expects.
 */
export function founderDecisionResultToLegacyTask(result, generatedReason = 'auto', contentFacts = {}) {
  if (result.status !== 'selected') {
    throw new Error('founderDecisionResultToLegacyTask requires a FounderDecisionResult with status "selected"');
  }
  const { todaysMove } = result;
  const { offerText = null, channelLabel = null, prospects = [] } = contentFacts;
  /* The task's own finished words, so the rationale and the proof example can
     only ever reference a business this task actually names. */
  const composedText = [todaysMove.title, ...todaysMove.steps.map((step) => step.label)].join(' ');
  const namedProspects = (prospects || []).filter((entry) => entry.name && composedText.includes(entry.name));
  const title = clean(todaysMove.title, 120);
  const firstStepGuidance = todaysMove.steps.find((step) => step.guidance)?.guidance || null;
  const relatedEntity = result.relatedEntities[0] || null;
  /* Two SHORT appended steps, never one long one: the authoritative DB
     validator (validate_founder_generated_task_v1) caps each step at 200
     bytes and allows at most 5 steps total. A single combined
     action+next-state line overflowed 200 bytes and was rejected with
     invalid_step -- verified live on staging. Splitting keeps each line
     independently within the cap instead of silently truncating content.
     The offer is quoted only if it still fits after the channel prefix. */
  const actionStep = channelLabel
    ? clean(
      offerText
        ? `${channelLabel} about your offer: "${trunc(offerText, 110)}"`
        : `${channelLabel} about the current offer`,
      200,
    )
    : null;
  const nextStateStep = channelLabel
    ? clean('If they reply interested, book a specific next step immediately. If no reply in 2 days, follow up once, then move on.', 200)
    : null;

  const compiledTask = {
    key: `${slug(title)}-${hash(`${title}:${result.taskVersion}:${generatedReason}`)}`.slice(0, 60),
    title,
    difficulty: EFFORT_TO_DIFFICULTY[todaysMove.effortLevel] || 'medium',
    role: 'founder',
    est_minutes: Math.max(1, Math.min(240, Math.round(todaysMove.timeEstimateMinutes))),
    why: clean(todaysMove.missionStatement, 500),
    helps: clean(result.expectedOutcome, 500),
    /* The mission compiler now composes the channel/offer/target into the
       steps themselves (see mission-compiler.js), so the adapter no longer
       appends a duplicate "contact them" line -- that produced two steps
       saying the same thing. Only the generic reply/no-reply rule is still
       appended, because it is a universal procedural rule rather than a
       route-specific instruction, and only when a channel is actually known.
       Capped at the DB's real 5-step maximum. */
    steps: [
      ...todaysMove.steps.map((step) => clean(step.label, 200)),
      ...(nextStateStep ? [nextStateStep] : []),
    ].slice(0, 5),
    proof_prompt: clean(result.completionDefinition, 220),
    proof_must_show: clean(result.requiredEvidence.join('; '), 320),
    proof_reject_if: clean(`Missing or incomplete: ${result.requiredEvidence.join('; ')}`, 320),
    /* Verified live: result.relatedEntities is EMPTY on real runs (it carries
       thread entity ids, not names), so this enrichment never actually fired.
       The named prospects resolved from the fact ledger are the real source. */
    good_proof_examples: buildProofExamples(
      result.requiredEvidence,
      namedProspects.map((entry) => entry.name),
      channelLabel,
    ),
    /* userSafeExplanation, never reasonForDecision, for every user-facing
       field below: reasonForDecision is an internal audit string (service.js
       documents it as paired with userSafeExplanation for exactly this
       reason) and on the common first-ever-task case reads literally as
       "no active outcome thread exists yet for this venture" -- true
       internally, meaningless to a founder. */
    /* Previously this restated the title and appended a coaching tip, which
       told a founder nothing about WHY they were given this task. It now
       leads with the plain-English reason -- the constraint that selected it,
       and why these exact businesses -- and keeps the step guidance after it,
       trimmed to whatever fits under the 500-BYTE database cap so the reason
       is never the part that gets cut. */
    why_personalised: (() => {
      const rationale = buildSelectionRationale(result, prospects, composedText);
      const lead = rationale || result.userSafeExplanation;
      if (!firstStepGuidance) return clean(lead, 500);
      /* Measured BEFORE truncating: clean(x, 500) already caps at 500, so
         checking its length afterwards always passed and the guidance was
         being chopped mid-sentence. If the pair does not fit whole, the
         guidance is dropped entirely rather than half-shown. */
      const combined = clean(`${lead} ${firstStepGuidance}`, 4000);
      return byteLength(combined) <= 500 ? combined : clean(lead, 500);
    })(),
    /* The professionalStandard array has no attached persona in this system
       (no fabricated expert name) -- the venture's own already-computed
       bottleneck label is the one real, task-relevant "which discipline
       does this standard belong to" signal available, so it is used as
       that label instead of inventing one. */
    /* 320 is the authoritative cap in validate_founder_generated_task_v1 --
       exceeding it is rejected outright, not truncated. */
    /* The `[<bottleneck label> standard]` prefix that used to open this string
       leaked internal taxonomy straight into the UI -- a founder read
       "[acquisition/sales standard] Do not skip this: ...". The label is a
       routing category, not a discipline name a person would recognise, and it
       is already carried structurally in `personalisation_tags` and
       `mission_intent.family_hint` for anything that needs it. The guidance
       itself is unchanged. */
    /* Deliberately does NOT repeat result.standardGuidance. That is its own
       contract field, rendered as the Professional Standard, and once it
       carried the practitioner framing ("How Rob Fitzpatrick would hold this
       task...") duplicating it here consumed the whole 320-byte column and
       truncated the actual mistake mid-word. This field says the one thing
       that goes wrong; the standard says how a professional holds it. */
    mistake_to_avoid: clean(
      `Do not skip this: ${sentence(result.professionalStandard[0])}${offerText ? ` Offer: "${trunc(offerText, 90)}".` : ''}`,
      320,
    ),
    fallback_task: null,
    upgrade_task: null,
    personalisation_tags: [result.currentBottleneck.category, result.decisionType, result.guidanceLevel].map((tag) => clean(tag, 50)),
    task_source: 'founder_engine_v1',
    generated_reason: clean(generatedReason, 60) || 'server_generation',
    effort_level: EFFORT_TO_LEGACY_EFFORT[todaysMove.effortLevel] || 'medium',
    task_type: 'direct_execution',
    should_continue_today: result.decisionType !== 'start',
    recommended_proof_type: 'photo',
    context_anchors: {
      goal_detail: clean(result.activeOutcome, 240),
      skill_gap_detail: clean(`${result.guidanceLevel} level for this specific task`, 200),
      blocker_detail: clean(result.currentBottleneck.reason, 200),
      why_today: clean(result.userSafeExplanation, 300),
      progression_logic: clean(result.userSafeExplanation, 300),
      failure_repair: clean(
        result.decisionType === 'replace' || result.decisionType === 'refine'
          ? result.userSafeExplanation
          : 'No blocking event reported; continuing the current approach.',
        300,
      ),
      success_pattern: clean(
        result.decisionType === 'start'
          ? 'This is the first attempt at this specific action.'
          : 'Continue this approach while it keeps producing real evidence toward the outcome.',
        300,
      ),
      constraint_fit: clean(`Fits within ${Math.round(todaysMove.timeEstimateMinutes)} minutes today.`, 220),
      distinctive_detail: clean(relatedEntity || 'the venture\'s current highest-leverage action', 180),
      evidence_logic: clean(result.requiredEvidence.join('; '), 320),
    },
    mission_intent: {
      outcome: clean(result.expectedOutcome, 260),
      family_hint: clean(result.currentBottleneck.category, 70),
      progression_mode: DECISION_TO_PROGRESSION_MODE[result.decisionType] || 'new_output',
      user_state_basis: clean(result.userSafeExplanation, 320),
      avoid_pattern: clean(result.professionalStandard[0], 260),
      /* Carried here because the task column allowlist
         (validate_founder_generated_task_v1) has no standard_guidance field
         and mission_intent is the one free-form object it permits. Without
         this the practitioner standard the engine chose never reaches the
         page, and the Tasks UI falls back to a hardcoded celebrity keyed off a
         goal category founders never set -- which is how a prospect-list task
         came to be attributed to a deep-work author. */
      professional_standard: clean(result.standardGuidance, 320),
      standard_principles: (result.professionalStandard || []).slice(0, 4).map((p) => clean(p, 200)),
      /* The durable pointer to the stored batch this mission is about, in
         snake_case to match validate_founder_evidence_reference_v1's key
         checks. Omitted entirely rather than sent as null when there is no
         batch: the DB validator treats an absent reference as fine and a
         present-but-malformed one as an error, so a null would be the one
         shape that is neither. */
      ...(result.evidenceBatchReference
        ? {
          evidence_reference: {
            kind: result.evidenceBatchReference.kind,
            batch_id: result.evidenceBatchReference.batchId,
            source: result.evidenceBatchReference.source,
            collected: result.evidenceBatchReference.collected,
            required: result.evidenceBatchReference.required,
            remaining: result.evidenceBatchReference.remaining,
            state: result.evidenceBatchReference.state,
          },
        }
        : {}),
    },
  };
  return assertFounderTaskContract(compiledTask);
}

/* The authoritative persistence contract, mirrored here so a violation is a
 * typed compiler error rather than an opaque persistence explosion.
 *
 * These limits are octet_length bounds copied from
 * public.validate_founder_generated_task_v1. The DB remains authoritative --
 * this does not replace it and does not relax it. It exists so that if this
 * layer ever fails to satisfy the contract, the caller learns WHICH field and
 * by how much, instead of the founder receiving a generic 503 while the real
 * reason survives only as an error_code deep in task_generation_runs.
 */
const FOUNDER_TASK_BYTE_LIMITS = Object.freeze({
  title: [3, 120],
  why: [1, 500],
  helps: [1, 500],
  proof_prompt: [1, 320],
  proof_must_show: [1, 320],
  proof_reject_if: [1, 320],
  why_personalised: [1, 500],
  mistake_to_avoid: [1, 320],
  task_type: [1, 50],
});

export class FounderTaskContractError extends Error {
  constructor(field, detail) {
    super(`founder_task_contract_violation:${field}`);
    this.name = 'FounderTaskContractError';
    this.code = 'founder_task_contract_violation';
    this.field = field;
    this.detail = detail;
  }
}

export function assertFounderTaskContract(task) {
  for (const [field, [min, max]] of Object.entries(FOUNDER_TASK_BYTE_LIMITS)) {
    const size = byteLength(task[field]);
    if (size < min || size > max) {
      throw new FounderTaskContractError(field, `${size} bytes, allowed ${min}-${max}`);
    }
  }
  if (!Array.isArray(task.steps) || task.steps.length < 2 || task.steps.length > 5) {
    throw new FounderTaskContractError('steps', `${Array.isArray(task.steps) ? task.steps.length : 'not-an-array'} entries, allowed 2-5`);
  }
  task.steps.forEach((step, index) => {
    if (typeof step !== 'string') {
      throw new FounderTaskContractError(`steps[${index}]`, `type ${typeof step}, expected string`);
    }
    const size = byteLength(step);
    if (size < 1 || size > 200) {
      throw new FounderTaskContractError(`steps[${index}]`, `${size} bytes, allowed 1-200`);
    }
  });
  if (!Array.isArray(task.good_proof_examples)
      || task.good_proof_examples.length < 1 || task.good_proof_examples.length > 3) {
    throw new FounderTaskContractError('good_proof_examples', 'allowed 1-3 entries');
  }
  task.good_proof_examples.forEach((example, index) => {
    const size = byteLength(example);
    if (typeof example !== 'string' || size < 1 || size > 220) {
      throw new FounderTaskContractError(`good_proof_examples[${index}]`, `${size} bytes, allowed 1-220`);
    }
  });
  if (!Array.isArray(task.personalisation_tags) || task.personalisation_tags.length > 8) {
    throw new FounderTaskContractError('personalisation_tags', 'allowed at most 8 entries');
  }
  task.personalisation_tags.forEach((tag, index) => {
    const size = byteLength(tag);
    if (typeof tag !== 'string' || size < 1 || size > 50) {
      throw new FounderTaskContractError(`personalisation_tags[${index}]`, `${size} bytes, allowed 1-50`);
    }
  });
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(String(task.key ?? ''))) {
    throw new FounderTaskContractError('key', `"${task.key}" fails ^[a-z0-9][a-z0-9-]{2,59}$`);
  }
  return task;
}
