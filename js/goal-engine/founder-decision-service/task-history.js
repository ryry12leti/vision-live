/**
 * Founder task history — what this venture has already been asked to do, and
 * how those attempts ended.
 *
 * WHY THIS EXISTS. Every Founder task was generated as if it were day one. The
 * engine could not tell that it had already asked for the same thing, or that
 * the last three attempts on a route went nowhere, so tasks never got sharper
 * with use. Two consequences were live in production:
 *
 *   1. `gateDuplicateRecentWork` (founder-mission-comparison/candidate-evaluation.js)
 *      is a HARD gate against regenerating an identical title -- and every live
 *      caller passed `recentTasks: []`, so it never once fired. The same task
 *      could regenerate indefinitely.
 *   2. `decideRightNextMove` refuses to replace the active move without a
 *      meaningful event (deliberately -- it must never drift silently). The
 *      only runtime producer of one is a single textarea on the lead card, so
 *      FINISHING A TASK was not an event and could not move the founder on.
 *
 * The history itself was never missing. Every version of the `activeOutcomeThread`
 * fact is retained in `founder_venture_facts` (supersede sets active=false, it
 * does not delete), and founder-engine-bridge loads the ledger with NO active
 * filter -- so the full sequence of past tasks is already in memory on every
 * generation. Nothing read it. This module reads it.
 *
 * Nothing here invents an outcome. A thread version records what the task was
 * and the state it was left in; where the founder never reported anything, that
 * is reported as unknown rather than guessed as failure.
 */

import { isProspectListMissionTitle } from '../founder-mission-policy/prerequisite-missions.js';

const THREAD_FACT_KEY = 'activeOutcomeThread';

/* An attempt is "resolved" only when the recorded state actually says so.
   Anything else -- including the common case of a founder who simply never
   came back -- is left unresolved rather than counted as a failure, because
   "you tried and it did not work" and "we never heard" call for different
   next moves. */
const RESOLVED_EXECUTION_STATES = new Set(['completed_outcome_closed', 'completed_step_outcome_open']);
const ABANDONED_EXECUTION_STATES = new Set(['abandoned']);

function isThreadFact(fact) {
  return fact
    && fact.factKey === THREAD_FACT_KEY
    && fact.value
    && typeof fact.value === 'object';
}

function timeOf(fact) {
  const stamp = Date.parse(fact.occurredAt || fact.recordedAt || '');
  return Number.isFinite(stamp) ? stamp : 0;
}

/**
 * Every task this venture has been given, oldest first.
 *
 * @param {object[]} factLedger Rows in mapFactRowToLedgerShape form, INCLUDING inactive ones.
 * @returns {{title: string, routeId: string|null, bottleneckCategory: string|null,
 *   taskVersion: number, executionState: string|null, outcomeCompletionState: string|null,
 *   eventSummary: string|null, occurredAt: string|null, resolution: 'completed'|'abandoned'|'unresolved'}[]}
 */
export function deriveFounderTaskHistory(factLedger) {
  const threads = (Array.isArray(factLedger) ? factLedger : []).filter(isThreadFact);
  const byVersion = new Map();
  for (const fact of threads.slice().sort((a, b) => timeOf(a) - timeOf(b))) {
    const value = fact.value;
    const title = typeof value.currentTaskTitle === 'string' ? value.currentTaskTitle.trim() : '';
    if (!title) continue;
    const taskVersion = Number.isInteger(value.taskVersion) ? value.taskVersion : 0;
    const executionState = typeof value.executionState === 'string' ? value.executionState : null;
    const entry = {
      title,
      routeId: typeof value.currentRouteId === 'string' ? value.currentRouteId : null,
      bottleneckCategory: typeof value.currentBottleneckCategory === 'string' ? value.currentBottleneckCategory : null,
      taskVersion,
      executionState,
      outcomeCompletionState: typeof value.outcomeCompletionState === 'string' ? value.outcomeCompletionState : null,
      eventSummary: typeof value.latestEventSummary === 'string' ? value.latestEventSummary : null,
      occurredAt: fact.occurredAt || fact.recordedAt || null,
      resolution: RESOLVED_EXECUTION_STATES.has(executionState) ? 'completed'
        : ABANDONED_EXECUTION_STATES.has(executionState) ? 'abandoned'
          : 'unresolved',
    };
    /* One thread version can be rewritten several times (an event updates it in
       place before the next task replaces it). Keyed by taskVersion so a task
       counts ONCE however many times its row was touched -- otherwise a founder
       who reported two updates on one task would look like two failed attempts. */
    const existing = byVersion.get(taskVersion);
    if (!existing || timeOf(fact) >= existing._at) byVersion.set(taskVersion, { ...entry, _at: timeOf(fact) });
  }
  return [...byVersion.values()]
    .sort((a, b) => (a.taskVersion - b.taskVersion) || (a._at - b._at))
    .map(({ _at, ...entry }) => entry);
}

/**
 * What the history means for the task about to be generated.
 *
 * @param {object[]} history Output of deriveFounderTaskHistory.
 * @param {{routeId?: string|null, bottleneckCategory?: string|null}} [pending] The route/category now being considered.
 * @returns {{attemptCount: number, recentTasks: {title: string}[], lastAttempt: object|null,
 *   repeatedRoute: {routeId: string, attempts: number, resolved: number}|null,
 *   unresolvedRunOnRoute: number, hasCompletedAnything: boolean}}
 */
export function summariseFounderAttempts(history, pending = {}) {
  const entries = Array.isArray(history) ? history : [];
  const lastAttempt = entries.length > 0 ? entries[entries.length - 1] : null;

  /* Only the CURRENT route's run matters for escalation: a founder who moved
     from interviews to outreach has not failed at outreach three times. */
  const routeId = pending.routeId ?? null;
  let unresolvedRunOnRoute = 0;
  if (routeId) {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].routeId !== routeId) break;
      if (entries[i].resolution === 'completed') break;
      unresolvedRunOnRoute += 1;
    }
  }

  const onRoute = routeId ? entries.filter((entry) => entry.routeId === routeId) : [];
  return {
    attemptCount: entries.length,
    /* Shape gateDuplicateRecentWork expects: [{title}]. */
    recentTasks: entries.map((entry) => ({ title: entry.title })),
    lastAttempt,
    repeatedRoute: onRoute.length > 1
      ? {
        routeId,
        attempts: onRoute.length,
        resolved: onRoute.filter((entry) => entry.resolution === 'completed').length,
      }
      : null,
    unresolvedRunOnRoute,
    hasCompletedAnything: entries.some((entry) => entry.resolution === 'completed'),
  };
}

/* The six founder-facing report options all describe something the founder
   TYPED. Completion is different: it is server-owned, proof-verified state
   (finalize_proof_decision sets daily_tasks.status = 'done'), so it is the one
   outcome VISION can assert on the founder's behalf without asking. */
const COMPLETION_SUMMARY_PREFIX = 'completed';

/**
 * Turns "the founder finished and evidenced the task we last gave them" into a
 * meaningful event, so the engine may legitimately move them on.
 *
 * decideRightNextMove will not replace the active move without an event -- by
 * design, so the task never drifts for a reason no human can read. But the only
 * runtime producer of an event is one textarea on the lead card, so a founder
 * who did the work and passed proof was still held on the same task. This is
 * the missing producer, and it reports a fact the server already owns rather
 * than an inference about what the founder meant.
 *
 * @param {object} params
 * @param {object|null} params.activeThread The venture's current activeOutcomeThread value, or null.
 * @param {string[]} params.completedTaskTitles Titles of founder tasks the proof system has marked done.
 * @returns {{summary: string, interpretation: string, relatedEntityIds: string[]}|null}
 */
export function deriveFounderCompletionEvent({ activeThread, completedTaskTitles }) {
  if (!activeThread || typeof activeThread !== 'object') return null;
  const title = typeof activeThread.currentTaskTitle === 'string' ? activeThread.currentTaskTitle.trim() : '';
  if (!title) return null;

  /* Already recorded as finished -- re-firing would rewrite the thread on every
     poll and inflate the history with one task counted many times. */
  if (RESOLVED_EXECUTION_STATES.has(activeThread.executionState)) return null;
  if (typeof activeThread.latestEventSummary === 'string'
    && activeThread.latestEventSummary.startsWith(COMPLETION_SUMMARY_PREFIX)) return null;

  const completed = new Set((Array.isArray(completedTaskTitles) ? completedTaskTitles : [])
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
  if (!completed.has(title.toLowerCase())) return null;

  return {
    summary: `${COMPLETION_SUMMARY_PREFIX}: ${title}`,
    interpretation: 'the founder finished this task and it passed proof verification, so the next move can build on it rather than repeat it',
    /* Completion says the TASK is done; it says nothing about any particular
       business on the list, so no entity is implicated. */
    relatedEntityIds: [],
  };
}

/* Same idea as COMPLETION_SUMMARY_PREFIX: a stable marker on the thread so a
   later generation call can tell "this was already surfaced" from "this is
   new", without a second persisted flag. */
const PROSPECTS_APPROVED_SUMMARY_PREFIX = 'prospects_approved';
/* Partial progress on the same batch. A separate marker from the one above
   because the two mean genuinely different things to decideRightNextMove:
   'approved' says the batch is DONE and the mission may move to a different
   route ('replace'), while this says the same mission should be re-worded
   around real progress ('refine'). Collapsing them would let a founder with
   three of eight prospects be moved on to outreach. */
const PROSPECTS_PROGRESS_SUMMARY_PREFIX = 'prospects_progress';

/* Mirrors EXACTLY the filter founder-mission-policy/index.js already uses to
   decide whether the venture has usable prospects
   (`entity.verificationStatus !== 'provisional'`). Deliberately not the
   stricter isUsableEntity() from founder-venture-state/entity-snapshot.js --
   that also excludes archived/inactive entities, and using a stricter bar
   here than the one that actually gates the route would mean the route can
   already be eligible while this never fires. The two checks must agree,
   because the whole point is detecting the moment mission-policy's own gate
   flips. */
function isUsableProspect(entity) {
  return entity && entity.verificationStatus !== 'provisional';
}

/**
 * Turns "the founder approved enough real prospects" into a meaningful event,
 * so the engine may legitimately move the mission from finding customers to
 * reaching them.
 *
 * WHY THIS EXISTS. Approving a lead in Lead Intelligence already writes a real
 * customerEntity fact (js/goal-engine/opportunity-intelligence/founder-bridge.js's
 * approvedOpportunityFacts, called from the lead-intelligence `decision`
 * action). Founder-mission-policy already reads customerEntities to decide
 * whether the prospect-discovery prerequisite is still needed. Both ends were
 * real and correct on their own -- what was missing is what deriveFounderCompletionEvent
 * already had to solve once today: decideRightNextMove will not replace the
 * active move without a meaningful event, and nothing produced one for "the
 * world just changed because real prospects now exist." Without this, a
 * founder could approve ten real, qualified businesses and stay on "build a
 * qualified list" forever.
 *
 * Deliberately narrow, matching the same discipline as completion: this does
 * NOT decide whether outreach is now the right move -- that is
 * runFounderDecisionService's job, re-run with the fact ledger the caller
 * already has. It only asserts the one fact this function can actually see:
 * enough real, non-provisional prospects now exist for the mission that asked
 * for them.
 *
 * @param {object} params
 * @param {object|null} params.activeThread The venture's current activeOutcomeThread value, or null.
 * @param {object|null} params.entityBundle Trusted buildFounderExecutionEntities(...) output, with `.customerEntities`.
 * @param {number} params.requiredProspectCount How many the active mission asked for. Supplied by the caller from resolveProspectMissionQuantities(...) — this module never keeps its own copy, because a second constant would drift out of sync with what the founder was actually told to approve.
 * @returns {{summary: string, interpretation: string, relatedEntityIds: string[]}|null}
 */
export function deriveFounderProspectsApprovedEvent({ activeThread, entityBundle, requiredProspectCount }) {
  if (!activeThread || typeof activeThread !== 'object') return null;
  const title = typeof activeThread.currentTaskTitle === 'string' ? activeThread.currentTaskTitle.trim() : '';
  if (!title) return null;

  /* Only relevant when the venture is actually ON the prospect-discovery
     prerequisite. currentRouteId cannot answer this -- the mission is
     stamped with the TARGET route's id, the same one it carries once
     genuinely unlocked -- so the title prefix is the only durable signal.
     Matches BOTH the starting and the continuing title: a founder part-way
     through the list is on "Finish your qualified list of ...", and testing
     only the start prefix would silently refuse to ever advance them. */
  if (!isProspectListMissionTitle(title)) return null;

  const required = Number.isInteger(requiredProspectCount) && requiredProspectCount > 0 ? requiredProspectCount : null;
  if (required === null) return null;

  /* Already recorded -- re-firing on every generation call would rewrite the
     thread repeatedly for the same real-world change. */
  if (typeof activeThread.latestEventSummary === 'string'
    && activeThread.latestEventSummary.startsWith(PROSPECTS_APPROVED_SUMMARY_PREFIX)) return null;

  const qualifying = (entityBundle?.customerEntities || []).filter(isUsableProspect);
  if (qualifying.length < required) return null;

  return {
    summary: `${PROSPECTS_APPROVED_SUMMARY_PREFIX}: ${qualifying.length} of ${required} required`,
    interpretation: 'the founder approved enough real, qualified prospects for this venture to move from finding customers to reaching them',
    /* Unlike completion, this genuinely implicates specific businesses -- the
       ones that made the threshold real -- so they are named rather than
       left empty. */
    relatedEntityIds: qualifying.map((entity) => entity.entityId).filter(Boolean),
  };
}

/**
 * Turns "the founder added real prospects but is not finished yet" into a
 * meaningful event, so the active mission can be re-worded around the
 * progress they have actually made.
 *
 * WHY A SECOND EVENT. decideRightNextMove deliberately refuses to change the
 * active move without an attributable event, so that re-running the pipeline
 * can never silently drift someone's task. That guard is right, but it also
 * meant a founder who approved three of the eight prospects their mission
 * asked for kept seeing the day-one wording -- "Find 8 tradies" -- with no
 * acknowledgement of the three already done and no indication of how many
 * were left. The mission was frozen precisely while they were doing the work.
 *
 * Approving real, qualified businesses is exactly the kind of attributable
 * real-world change that guard was written to require. So this reports it,
 * and the count is embedded in the summary so the event fires once per real
 * change rather than on every generation call: at the same count the marker
 * already on the thread matches, and nothing is reported.
 *
 * Strictly bounded to the middle of the batch. At zero there is no progress
 * to report, and at or past the requirement deriveFounderProspectsApprovedEvent
 * owns the transition -- returning an event here too would let a finished
 * batch be re-worded instead of advanced.
 *
 * @param {object} params
 * @param {object|null} params.activeThread The venture's current activeOutcomeThread value, or null.
 * @param {object|null} params.entityBundle Trusted buildFounderExecutionEntities(...) output, with `.customerEntities`.
 * @param {number} params.requiredProspectCount How many the active mission asked for, from resolveProspectMissionQuantities(...).
 * @returns {{summary: string, interpretation: string, relatedEntityIds: string[]}|null}
 */
export function deriveFounderProspectsProgressEvent({ activeThread, entityBundle, requiredProspectCount }) {
  if (!activeThread || typeof activeThread !== 'object') return null;
  const title = typeof activeThread.currentTaskTitle === 'string' ? activeThread.currentTaskTitle.trim() : '';
  if (!title || !isProspectListMissionTitle(title)) return null;

  const required = Number.isInteger(requiredProspectCount) && requiredProspectCount > 0 ? requiredProspectCount : null;
  if (required === null) return null;

  const qualifying = (entityBundle?.customerEntities || []).filter(isUsableProspect);
  const collected = qualifying.length;
  /* Only the middle. Zero is not progress, and a met requirement belongs to
     the advance trigger, not to this one. */
  if (collected === 0 || collected >= required) return null;

  const summary = `${PROSPECTS_PROGRESS_SUMMARY_PREFIX}: ${collected} of ${required} qualified`;
  /* The count is IN the marker, so re-running at the same count is a no-op
     while genuinely adding one more is reported. */
  if (activeThread.latestEventSummary === summary) return null;

  return {
    summary,
    interpretation: `the founder has qualified ${collected} of the ${required} prospects this mission asked for, so the mission should now ask for the ${required - collected} still outstanding rather than repeating the original target`,
    relatedEntityIds: qualifying.map((entity) => entity.entityId).filter(Boolean),
  };
}
