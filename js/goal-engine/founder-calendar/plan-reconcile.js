/**
 * Founder Calendar — plan reconciliation over a 7-day active horizon.
 *
 * PHASE 3, AND STILL SHADOW. This decides what the Calendar *should* become
 * and returns it. It executes nothing, reads no database, and has no
 * authority: the caller may persist the actions or throw them away, and in
 * Phase 3 nothing product-facing consumes them.
 *
 * WHAT THIS EXISTS TO PREVENT. The legacy behaviour generates today's task
 * from scratch every run. Pointed at a Calendar that would silently double
 * it: the same work proposed again tomorrow as a second row, unfinished work
 * abandoned rather than carried, and a plan that grows without ever being
 * looked at. So the order here is deliberate and load-bearing --
 * RECONCILE WHAT EXISTS BEFORE PROPOSING ANYTHING NEW.
 *
 * WHAT IT DELIBERATELY IS NOT. It is not a second strategy engine. It does
 * not decide what matters most; the Goal Engine already did that when it
 * accepted a TodaysMove, and that decision arrives here as `acceptedWork`.
 * Ranking below is stable bookkeeping around that one strategic input, not a
 * rival opinion about the business. No model is called, and every output is
 * a pure function of the inputs.
 *
 * PRIORITY IS NOT A DATE. `priorityRank` is venture-global strategic order;
 * `scheduledDate` is when execution happens. A blocked rank-1 item stays
 * rank 1 while something else is worked on today -- which is why
 * `currentWorkCandidate` below is chosen by ACTIONABILITY, not by rank
 * alone, and why it is only ever a recommendation.
 */

export const PLANNING_HORIZON_DAYS = 7;

/* Roughly this many meaningful items per scheduled day. Not a database
   limit and not enforced anywhere else: the point is to refuse to pad a
   Calendar with small generated work so it looks busy. */
export const MAX_ITEMS_PER_DAY = 2;

export const RECONCILE_ACTIONS = Object.freeze([
  'create', 'carry_forward', 'reprioritise', 'reschedule', 'supersede',
]);

const LIVE_STATUSES = Object.freeze(['planned', 'in_progress']);

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isLive(item) {
  return LIVE_STATUSES.includes(item.status);
}

/**
 * Can this item be executed right now?
 *
 * Deliberately the smallest rule that covers the real cases -- one
 * dependency edge, no graph, no cycle solver. Anything more elaborate would
 * be a scheduling engine, which is not what V1 needs.
 */
export function isActionable(item, today, byId) {
  if (!isLive(item)) return false;
  if (item.blockedReason) return false;
  if (item.blockedUntil && item.blockedUntil > today) return false;
  if (item.dependsOn) {
    const dependency = byId.get(item.dependsOn);
    if (!dependency || dependency.status !== 'done') return false;
  }
  if (item.scheduledDate && item.scheduledDate > today) return false;
  return true;
}

/**
 * Stable, deterministic order for live work.
 *
 * A pinned item holds its position -- the founder said so, and a
 * reprioritisation that quietly demoted it would be exactly the silent
 * override this architecture forbids. Everything else follows the one
 * strategic signal the engine already produced (the accepted work leads),
 * then existing rank, then age. No new judgement about the business.
 */
function orderLiveWork(liveItems, acceptedKey) {
  return [...liveItems].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;

    const aAccepted = acceptedKey && a.proposalKey === acceptedKey;
    const bAccepted = acceptedKey && b.proposalKey === acceptedKey;
    if (aAccepted !== bAccepted) return aAccepted ? -1 : 1;

    const aRank = Number.isInteger(a.priorityRank) ? a.priorityRank : Number.MAX_SAFE_INTEGER;
    const bRank = Number.isInteger(b.priorityRank) ? b.priorityRank : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;

    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });
}

/**
 * Reconcile the existing plan, then decide what (if anything) is missing.
 *
 * @param {object} params
 * @param {object[]} params.workItems Existing work items for ONE venture (camelCase view of founder_work_items).
 * @param {{proposalKey: string, title: string, outcomeId: string|null, routeId: string, originReason: string}|null} params.acceptedWork
 *   The work the Goal Engine just accepted, or null when this run produced no mission.
 * @param {string} params.today ISO date (YYYY-MM-DD).
 * @param {string|null} [params.planLockedUntil] ISO timestamp; while in the future the plan is locked.
 * @param {string} params.now ISO timestamp for evaluating the lock.
 * @returns {{
 *   locked: boolean,
 *   horizon: {start: string, end: string},
 *   actions: object[],
 *   recommendations: object[],
 *   currentWorkCandidate: {proposalKey: string|null, workItemId: string|null, reason: string}|null,
 * }}
 */
export function reconcileFounderPlan({
  workItems, acceptedWork = null, today, planLockedUntil = null, now,
}) {
  const items = Array.isArray(workItems) ? workItems : [];
  const byId = new Map(items.map((item) => [item.workItemId, item]));
  const horizon = { start: today, end: addDays(today, PLANNING_HORIZON_DAYS - 1) };
  const locked = Boolean(planLockedUntil && now && planLockedUntil > now);

  const actions = [];
  const live = items.filter(isLive);

  /* ── 1. CARRY FORWARD ────────────────────────────────────────────────
     Unfinished work scheduled before today moves to today, keeping its
     work_item_id. It is emphatically NOT completed and NOT recreated: the
     founder did not finish it, and inventing a fresh row would erase that
     it has been outstanding since it was first planned. */
  for (const item of live) {
    if (item.scheduledDate && item.scheduledDate < today) {
      actions.push({
        type: 'carry_forward',
        workItemId: item.workItemId,
        fields: { scheduledDate: today },
        event: {
          eventType: 'vision_carried_work_forward',
          actor: 'vision',
          changeClass: 'normal_adaptation',
          reason: `unfinished work from ${item.scheduledDate} carried to ${today}`,
        },
      });
    }
  }

  /* ── 2. RECONCILE BEFORE GENERATING ──────────────────────────────────
     The single most important step. If the accepted work already exists as
     live work, this run proposes NOTHING -- it merely confirms the plan
     already covers it. Skipping this check is how a Calendar accumulates
     five copies of "contact prospects", one per day the engine ran. */
  let acceptedKey = null;
  if (acceptedWork && acceptedWork.proposalKey) {
    acceptedKey = acceptedWork.proposalKey;
    const existing = items.find((item) => item.proposalKey === acceptedKey);

    if (!existing) {
      actions.push({
        type: 'create',
        proposalKey: acceptedKey,
        fields: {
          title: acceptedWork.title,
          outcomeId: acceptedWork.outcomeId ?? null,
          source: 'vision',
          originReason: acceptedWork.originReason,
          status: 'planned',
          /* Scheduled for today because this is the work the engine
             accepted for now. Future dates are never invented. */
          scheduledDate: today,
        },
        event: {
          eventType: 'vision_created_work',
          actor: 'vision',
          changeClass: 'normal_adaptation',
          reason: acceptedWork.originReason,
        },
      });
    } else if (isLive(existing) && existing.scheduledDate !== today
      && !actions.some((a) => a.workItemId === existing.workItemId)) {
      /* Already planned, just not for today. Move it rather than duplicate
         it -- same identity, attributable reason. */
      actions.push({
        type: 'reschedule',
        workItemId: existing.workItemId,
        fields: { scheduledDate: today },
        event: {
          eventType: 'vision_rescheduled_work',
          actor: 'vision',
          changeClass: 'normal_adaptation',
          reason: 'this is the work the engine accepted for today',
        },
      });
    }
  }

  /* ── 3. RANK ─────────────────────────────────────────────────────────
     Venture-global strategic order, renumbered densely from 1. Emitted only
     where it actually changes, so a settled plan produces no noise. */
  const projected = live.map((item) => ({
    ...item,
    proposalKey: item.proposalKey,
  }));
  if (acceptedKey && !projected.some((item) => item.proposalKey === acceptedKey)) {
    /* The about-to-be-created item participates in ranking so the accepted
       work does not land at the bottom of its own plan. */
    projected.push({
      workItemId: null, proposalKey: acceptedKey, pinned: false,
      priorityRank: null, createdAt: `${today}T00:00:00.000Z`, status: 'planned',
    });
  }

  orderLiveWork(projected, acceptedKey).forEach((item, index) => {
    const rank = index + 1;
    if (item.workItemId && item.priorityRank !== rank) {
      actions.push({
        type: 'reprioritise',
        workItemId: item.workItemId,
        fields: { priorityRank: rank },
        event: {
          eventType: 'vision_reprioritised_work',
          actor: 'vision',
          changeClass: 'normal_adaptation',
          reason: `strategic order updated to #${rank}`,
        },
      });
    }
    if (!item.workItemId) {
      const create = actions.find((a) => a.type === 'create' && a.proposalKey === item.proposalKey);
      if (create) create.fields.priorityRank = rank;
    }
  });

  /* ── 4. SHAPE ────────────────────────────────────────────────────────
     Roughly 1-2 meaningful items per day. Nothing is invented to fill a
     day; this only pushes back overflow so a single day is not stacked with
     more work than a founder can genuinely do. */
  const scheduledToday = [
    ...live.filter((item) => item.scheduledDate === today),
    ...actions.filter((a) => a.fields?.scheduledDate === today),
  ];
  if (scheduledToday.length > MAX_ITEMS_PER_DAY) {
    const overflow = scheduledToday.slice(MAX_ITEMS_PER_DAY);
    for (const item of overflow) {
      const workItemId = item.workItemId || null;
      if (!workItemId) continue;
      const already = actions.find((a) => a.workItemId === workItemId && a.type !== 'reprioritise');
      const target = addDays(today, 1);
      if (already) { already.fields.scheduledDate = target; continue; }
      actions.push({
        type: 'reschedule',
        workItemId,
        fields: { scheduledDate: target },
        event: {
          eventType: 'vision_rescheduled_work',
          actor: 'vision',
          changeClass: 'normal_adaptation',
          reason: `today already holds ${MAX_ITEMS_PER_DAY} items; moved to ${target}`,
        },
      });
    }
  }

  /* ── 5. CURRENT WORK — A RECOMMENDATION, NOT A DECISION ──────────────
     The highest-priority ACTIONABLE item. A blocked rank-1 does not lose
     its rank; something else is simply executable today. Phase 3 never
     writes current_work_item_id -- that authority arrives in Phase 4. */
  const actionable = orderLiveWork(live.filter((item) => isActionable(item, today, byId)), acceptedKey);
  const currentWorkCandidate = actionable.length > 0
    ? {
      workItemId: actionable[0].workItemId,
      proposalKey: actionable[0].proposalKey ?? null,
      reason: actionable[0].pinned
        ? 'the founder pinned this work'
        : 'highest-priority work that is actionable today',
    }
    : null;

  /* ── 6. PLAN LOCK ────────────────────────────────────────────────────
     While locked VISION changes nothing automatically. It still reports
     what it would have done, because staying silent about a real problem
     is not respecting the lock -- it is hiding from it. */
  if (locked) {
    return {
      locked: true,
      horizon,
      actions: [],
      recommendations: actions.map((action) => ({
        ...action,
        event: { ...action.event, changeClass: 'major_change_requires_approval' },
      })),
      currentWorkCandidate,
    };
  }

  return { locked: false, horizon, actions, recommendations: [], currentWorkCandidate };
}
