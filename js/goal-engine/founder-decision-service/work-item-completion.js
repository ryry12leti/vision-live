/**
 * Founder work-item completion — the state change that lets a build task
 * actually finish.
 *
 * THE DEFECT. Completing a delivery task changed nothing the engine reads.
 * The founder fixed the webhook and passed proof; `unfinishedWork` still said
 * "webhook processing fails so missed calls are dropped"; the mission
 * recomputed identically, and decideRightNextMove correctly returned 'keep'.
 * What eventually moved them was gateDuplicateRecentWork eliminating the
 * correct candidate as a duplicate title -- so on day two they were advanced
 * onto an unrelated prospect list while the real item stayed open, and by day
 * three the venture fell into a clarification dead end. Measured end to end on
 * the missed-call SaaS fixture.
 *
 * Every other route already had a producer for "the state genuinely moved":
 * prospect batches have approved/progress events, entity reports supersede the
 * entity fact. Delivery had none, because the thing that changes when build
 * work is done is the work item itself, and nothing wrote it.
 *
 * WHAT THIS DOES. Records the completed item as completed work. It does NOT
 * rewrite the founder's own `unfinishedWork` list -- their words stay exactly
 * as they typed them -- and `unfinishedWorkItems` (founder-bottleneck/
 * signals.js) filters anything that now appears under completed work. So the
 * next generation naturally picks the next real item, the duplicate gate never
 * has to fire, and taskVersion advances for the true reason.
 *
 * Appending is also the only shape the fact contract allows: `completedWork`
 * and `unfinishedWork` must both be NON-EMPTY string arrays, so retiring the
 * last outstanding item by rewriting `unfinishedWork` would produce an invalid
 * fact. Appending to completed work is always valid, and is the honest record
 * either way -- it says what the founder finished, not what they have left.
 *
 * Pure: no database, no clock, no HTTP. The caller turns the returned value
 * into a superseding fact.
 */

import { unfinishedWorkItems, completedWorkItems, workItemKey } from '../founder-bottleneck/signals.js';

/** The one route whose missions are built from an unfinished work item. */
export const WORK_ITEM_ROUTE_ID = 'founder_product_delivery_slice';

/* Already finished, so the thread's own state says this was handled. */
const RESOLVED_EXECUTION_STATES = new Set(['completed_outcome_closed', 'completed_step_outcome_open']);

/* How much of the item the task title must corroborate. Both mission
   compilers title the task after the item but truncate it -- to 90 bytes for
   the route candidate, to a byte budget for the prerequisite -- and the
   prerequisite's lead varies with the item's own phrasing ("Finish and
   deliver: X" vs an imperative the founder wrote). Matching a bounded prefix
   is therefore stronger than parsing a lead we would have to keep in sync. */
const CORROBORATION_CHARS = 40;

function corroborates(title, item) {
  const normalisedTitle = workItemKey(title);
  const normalisedItem = workItemKey(item);
  if (!normalisedTitle || !normalisedItem) return false;
  const probe = normalisedItem.slice(0, Math.min(CORROBORATION_CHARS, normalisedItem.length));
  /* Long items: the title carries a truncated prefix of the item.
     Short items: the title carries the whole item. Either direction confirms
     the task was about this item; neither is a fuzzy match. */
  return normalisedTitle.includes(probe);
}

/**
 * Decides whether the just-completed task finished a specific work item, and
 * what the venture's completed-work list should become.
 *
 * Refuses -- returns null -- whenever it cannot attribute the completion to
 * exactly one recorded item. Recording the wrong item would delete real
 * outstanding work from the founder's plan, which is worse than repeating a
 * task, so every check below fails closed.
 *
 * @param {object} params
 * @param {object|null} params.activeThread The venture's activeOutcomeThread value.
 * @param {string[]} params.completedTaskTitles Titles the proof system has marked done (server-owned; daily_tasks.status).
 * @param {object} params.snapshot Trusted buildFounderGoalEngineSnapshot(...) output.
 * @returns {{item: string, completedWork: string[]}|null}
 */
export function deriveCompletedWorkItemRecord({ activeThread, completedTaskTitles, snapshot }) {
  if (!activeThread || typeof activeThread !== 'object' || !snapshot) return null;
  if (activeThread.outcomeCompletionState !== 'open') return null;
  if (RESOLVED_EXECUTION_STATES.has(activeThread.executionState)) return null;
  /* Only the delivery route builds its mission from a work item. Titling this
     off any other route would attribute a prospect list to a build task. */
  if (activeThread.currentRouteId !== WORK_ITEM_ROUTE_ID) return null;

  const title = typeof activeThread.currentTaskTitle === 'string' ? activeThread.currentTaskTitle.trim() : '';
  if (!title) return null;

  const done = new Set((Array.isArray(completedTaskTitles) ? completedTaskTitles : [])
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean));
  if (!done.has(title.toLowerCase())) return null;

  /* Both compilers build the mission from the FIRST outstanding item, so that
     is the item this task was about -- and the corroboration check below
     proves it rather than assuming it. */
  const outstanding = unfinishedWorkItems(snapshot);
  const item = outstanding[0];
  if (typeof item !== 'string' || !item.trim()) return null;
  if (!corroborates(title, item)) return null;

  const existing = completedWorkItems(snapshot).filter((entry) => typeof entry === 'string' && entry.trim());
  /* Already recorded: re-appending would grow the list on every poll and, via
     the unfinishedWorkItems filter, is already a no-op. */
  if (existing.some((entry) => workItemKey(entry) === workItemKey(item))) return null;

  return { item, completedWork: [...existing, item] };
}

/**
 * The meaningful event for a work item that was finished and evidenced.
 *
 * decideRightNextMove will not move the founder without an attributable event,
 * by design. This one is attributable to server-owned proof state, not to an
 * inference about what the founder meant.
 *
 * @param {string} item The completed work item.
 * @returns {{summary: string, interpretation: string, relatedEntityIds: string[]}}
 */
export function completedWorkItemEvent(item) {
  return {
    summary: `work_item_completed: ${item}`,
    interpretation: `the founder finished and evidenced "${item}", so it is recorded as completed work and the next move addresses what is actually left`,
    /* A work item is not a customer, so no entity is implicated. */
    relatedEntityIds: [],
  };
}
