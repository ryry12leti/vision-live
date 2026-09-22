/**
 * Founder Calendar — the frontend's ONE reading of authoritative Calendar state.
 *
 * No DOM, no network, no storage. Everything here is a function of the
 * snapshot the server returned, which is what makes the invariants below
 * testable without a browser.
 *
 * ONE CLOCK, DECLARED. `planLock` reads the wall clock to answer "has this
 * lock elapsed?", and it takes that instant as an injected argument so the
 * dependence is visible at the call site. Nothing else in this module reads a
 * clock, and the founder's calendar DAY never does -- see below.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT. Current Work is whatever
 * `current_work.work_item_id` says it is, and nothing else. Not calendar[0],
 * not the highest priority, not the first thing scheduled today, not the active
 * daily_tasks row, not the last thing the founder tapped. The browser resolves
 * that id to an item and renders it; if the id is null it renders an empty
 * state and says so.
 *
 * That is not pedantry. The server already decides Current Work through a
 * locked, versioned resolver that knows about pinning, dependencies, plan
 * locks, terminal states and the founder's own standing choice. A client that
 * "helpfully" picks the top card whenever the pointer looks empty is a second
 * authority, and the two will disagree on exactly the days it matters.
 *
 * TODAY IS THE SERVER'S. `snapshot.today` is derived from the founder's saved
 * IANA timezone. No day, week bucket or date comparison in this file consults
 * the browser clock -- for roughly ten hours a day a UTC-derived date sits on
 * a different calendar day than the founder does, and we have already been
 * bitten by exactly that. A wall-clock instant (planLock) and a calendar day
 * are different questions; only the first may touch the clock.
 */

/** Work item statuses the Calendar read can contain. Terminal work is absent. */
const LIVE_STATUSES = ['planned', 'in_progress'];

/** Mirrors founder_ventures_current_work_selected_by_ck: these two, or NULL. */
const SELECTED_BY = ['founder', 'vision'];

export const CURRENT_WORK_STATE = Object.freeze({
  /** The pointer names an item present in the Calendar. */
  RESOLVED: 'resolved',
  /** The pointer is null -- a real, deliberate "nothing is current" state. */
  NONE: 'none',
  /** The pointer names an item the Calendar does not contain. */
  DANGLING: 'dangling',
});

export class CalendarContractError extends Error {
  constructor(reason, detail) {
    super(reason);
    this.name = 'CalendarContractError';
    this.reason = reason;
    this.detail = detail ?? null;
  }
}

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/* Own-property presence, not truthiness: a key that is absent and a key whose
   value is null are different facts, and only the second is an answer. */
const hasKey = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const PROPOSAL_STATE = Object.freeze({
  /** A proposed week is waiting for the founder to approve or edit it. */
  OPEN: 'open',
  /** There is no proposed week. A real answer, not an error -- it is what a
   *  founder who has already approved their plan looks like, forever after. */
  NONE: 'none',
});

/**
 * Validates the `{action:'read_proposal'}` body into a proposed week.
 *
 * Same discipline as parseCalendarSnapshot and for the same reason, with one
 * extra stake: this drives a screen whose only purpose is informed consent. A
 * proposal that half-renders would show a founder five items and get their
 * approval for six. Throwing is the only safe failure.
 *
 * @param {unknown} body
 * @returns {{state: string, proposalId: string|null, revision: number|null,
 *   weekStart: string|null, basedOnVersion: number|null, stale: boolean,
 *   stateVersion: number|null, plan: object|null, rationale: object|null}}
 */
export function parseProposal(body) {
  if (!isObj(body)) throw new CalendarContractError('malformed_response', 'not an object');
  if (body.ok !== true) throw new CalendarContractError('not_ok', body.error ?? null);
  const p = body.proposal;
  if (!isObj(p)) throw new CalendarContractError('malformed_response', 'proposal missing');

  if (p.status === 'none') {
    if (!Number.isInteger(p.state_version)) {
      throw new CalendarContractError('malformed_response', 'state_version missing');
    }
    return {
      state: PROPOSAL_STATE.NONE, proposalId: null, revision: null, weekStart: null,
      basedOnVersion: null, stale: false, stateVersion: p.state_version,
      plan: null, rationale: null,
    };
  }
  if (p.status !== 'open') {
    throw new CalendarContractError('malformed_response', `unknown proposal status: ${p.status}`);
  }

  if (typeof p.proposal_id !== 'string' || !p.proposal_id) {
    throw new CalendarContractError('malformed_response', 'proposal_id missing');
  }
  /* Editing sends this back as expected_revision. Without a usable one the
     client would have to omit it, which the API reads as "do not check" --
     turning a concurrent-edit conflict into a silent overwrite. */
  if (!Number.isInteger(p.revision) || p.revision < 1) {
    throw new CalendarContractError('malformed_response', 'revision missing');
  }
  if (!isDate(p.week_start)) {
    throw new CalendarContractError('malformed_response', 'week_start missing');
  }
  if (!Number.isInteger(p.state_version) || p.state_version < 1) {
    throw new CalendarContractError('malformed_response', 'state_version missing');
  }
  if (!Number.isInteger(p.based_on_version) || p.based_on_version < 1) {
    throw new CalendarContractError('malformed_response', 'based_on_version missing');
  }
  /* Staleness is the SERVER's verdict, and the key must be present. If a
     missing key read as "fresh", a client bug would offer Use This Week on a
     plan acceptance is guaranteed to refuse. */
  if (!hasKey(p, 'stale') || typeof p.stale !== 'boolean') {
    throw new CalendarContractError('malformed_response', 'stale missing');
  }

  const plan = p.proposal;
  if (!isObj(plan)) throw new CalendarContractError('malformed_response', 'plan missing');
  if (plan.weekStart !== p.week_start) {
    throw new CalendarContractError('malformed_response', 'plan week disagrees with proposal week');
  }
  /* Explicit null is how a founder rejects VISION's recommendation; an absent
     key is a bug. Reading them the same way would silently show a rejection
     the founder never made -- the same trap hasKey() exists for elsewhere. */
  if (!hasKey(plan, 'recommendation')) {
    throw new CalendarContractError('malformed_response', 'plan.recommendation is missing');
  }
  if (!Array.isArray(plan.items)) {
    throw new CalendarContractError('malformed_response', 'plan.items is not an array');
  }
  if (!isObj(plan.currentWork)) {
    throw new CalendarContractError('malformed_response', 'plan.currentWork missing');
  }

  return {
    state: PROPOSAL_STATE.OPEN,
    proposalId: p.proposal_id,
    revision: p.revision,
    weekStart: p.week_start,
    basedOnVersion: p.based_on_version,
    stale: p.stale,
    stateVersion: p.state_version,
    plan,
    /* May legitimately be empty. The UI renders what is there and says nothing
       about what is not -- it never fills a gap with plausible strategy prose. */
    rationale: isObj(p.rationale) ? p.rationale : {},
  };
}

/**
 * Validates and normalises the `{action:'read'}` body into one snapshot.
 *
 * Throws rather than returning a half-built object. A malformed snapshot that
 * renders anyway is worse than an error screen: the founder cannot tell the
 * difference between "you have no work" and "we could not read your work".
 *
 * @param {unknown} body
 * @returns {{ventureId: string, stateVersion: number, today: string,
 *   items: object[], currentWork: {state: string, workItemId: string|null,
 *   selectedBy: string|null, projectionDailyTaskId: string|null},
 *   planLockedUntil: string|null, planLockReason: string|null,
 *   recovery: object|null}}
 */
export function parseCalendarSnapshot(body) {
  if (!isObj(body)) throw new CalendarContractError('malformed_response', 'not an object');
  if (body.ok !== true) throw new CalendarContractError('not_ok', body.error ?? null);

  const venture = body.venture;
  if (!isObj(venture) || typeof venture.venture_id !== 'string' || !venture.venture_id) {
    throw new CalendarContractError('malformed_response', 'venture missing');
  }
  if (!Number.isInteger(venture.state_version) || venture.state_version < 1) {
    /* Without a usable version every mutation would have to either invent one
       or omit it, and omitting it is read by the commands as "do not check". */
    throw new CalendarContractError('malformed_response', 'state_version missing');
  }

  /* PLAN LOCK FAILS CLOSED. The API always emits both keys, so a missing one
     is malformed -- and an unreadable `plan_locked_until` is the dangerous
     case: Date.parse returns NaN, every comparison against it is false, and
     the badge quietly renders UNLOCKED. A lock that silently disappears is
     exactly the wrong direction to fail in. */
  for (const key of ['plan_locked_until', 'plan_lock_reason']) {
    if (!hasKey(venture, key)) {
      throw new CalendarContractError('malformed_response', `venture.${key} is missing`);
    }
  }
  if (venture.plan_locked_until !== null
    && !(typeof venture.plan_locked_until === 'string'
      && Number.isFinite(Date.parse(venture.plan_locked_until)))) {
    throw new CalendarContractError('malformed_response',
      `venture.plan_locked_until is malformed (${JSON.stringify(venture.plan_locked_until)})`);
  }
  if (venture.plan_lock_reason !== null && typeof venture.plan_lock_reason !== 'string') {
    throw new CalendarContractError('malformed_response',
      `venture.plan_lock_reason is malformed (${JSON.stringify(venture.plan_lock_reason)})`);
  }
  if (!isDate(body.today)) {
    throw new CalendarContractError('malformed_response', 'today missing or malformed');
  }
  if (!Array.isArray(body.calendar)) {
    throw new CalendarContractError('malformed_response', 'calendar missing');
  }

  /* EVERY live item is validated, and one bad row fails the WHOLE snapshot.
     Filtering a malformed row out would hand the founder a Calendar that looks
     complete and is not -- work silently missing from the week they are about
     to plan around. Coercing one would be worse: an unreadable status becoming
     'planned', or an unparseable date becoming "unscheduled", turns corrupt
     server state into a confident, wrong answer. Neither is recoverable by
     looking at the screen, which is exactly why this refuses instead. */
  const items = body.calendar.map((raw, index) => parseItem(raw, index));

  /* CURRENT WORK FAILS CLOSED TOO.
     Coercing a malformed pointer to null would render "Nothing is set as your
     current work" -- a confident, specific, wrong product statement made out
     of corrupt state, and indistinguishable on screen from the legitimate
     empty case. A NULL pointer is a real answer and stays valid; anything
     unreadable is a refusal. */
  if (!isObj(body.current_work)) {
    throw new CalendarContractError('malformed_response', 'current_work missing or not an object');
  }
  const cw = body.current_work;
  /* THE KEYS ARE REQUIRED, NOT MERELY THE VALUES. The API always emits all
     three (`value ?? null`), so a MISSING key is malformed API state -- and
     treating missing as null is how `{selected_by: null}` with no
     work_item_id at all would have rendered the legitimate, reassuring
     "Nothing is set as your current work". Absence and an explicit null are
     different facts and only one of them is an answer. */
  for (const key of ['work_item_id', 'selected_by', 'projection_daily_task_id']) {
    if (!hasKey(cw, key)) {
      throw new CalendarContractError('malformed_current_work', `current_work.${key} is missing`);
    }
  }
  if (cw.work_item_id !== null && !nonEmptyString(cw.work_item_id)) {
    throw new CalendarContractError('malformed_current_work',
      `current_work.work_item_id is malformed (${JSON.stringify(cw.work_item_id)})`);
  }
  /* founder_ventures_current_work_selected_by_ck constrains this to exactly
     these two values or NULL, so anything else means the contract moved. */
  if (cw.selected_by !== null && !SELECTED_BY.includes(cw.selected_by)) {
    throw new CalendarContractError('malformed_current_work',
      `current_work.selected_by is malformed (${JSON.stringify(cw.selected_by)})`);
  }
  if (cw.projection_daily_task_id !== null && !nonEmptyString(cw.projection_daily_task_id)) {
    throw new CalendarContractError('malformed_current_work',
      `current_work.projection_daily_task_id is malformed (${JSON.stringify(cw.projection_daily_task_id)})`);
  }

  const pointer = cw.work_item_id;
  /* The pointer is resolved against the Calendar, never replaced by a guess. */
  const present = pointer ? items.some((i) => i.workItemId === pointer) : false;

  return {
    ventureId: venture.venture_id,
    stateVersion: venture.state_version,
    today: body.today,
    items,
    currentWork: {
      state: pointer === null
        ? CURRENT_WORK_STATE.NONE
        : (present ? CURRENT_WORK_STATE.RESOLVED : CURRENT_WORK_STATE.DANGLING),
      workItemId: pointer,
      selectedBy: cw.selected_by,
      projectionDailyTaskId: cw.projection_daily_task_id,
    },
    planLockedUntil: venture.plan_locked_until,
    planLockReason: venture.plan_lock_reason,
    recovery: isObj(body.recovery) ? body.recovery : null,
  };
}

/** PostgREST returns `time` as HH:MM:SS; HH:MM is accepted too. */
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v);
/** Absent means absent. `null` and `undefined` are the only ways to say it. */
const absent = (v) => v === null || v === undefined;
const nonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Validates ONE authoritative work item, or throws.
 *
 * Nothing here substitutes a value. A field that is present must be readable;
 * a field that is absent stays absent. The error names the row and the field
 * so a real contract change is diagnosable instead of merely fatal.
 */
function parseItem(raw, index) {
  const bad = (field, got) => {
    throw new CalendarContractError('malformed_work_item',
      `calendar[${index}].${field} is malformed (${JSON.stringify(got)})`);
  };
  if (!isObj(raw)) bad('<row>', raw);

  if (!nonEmptyString(raw.work_item_id)) bad('work_item_id', raw.work_item_id);
  if (!nonEmptyString(raw.title)) bad('title', raw.title);
  /* The Calendar read returns live work only. A status outside that set means
     the contract moved, and guessing 'planned' would hide it. */
  if (!LIVE_STATUSES.includes(raw.status)) bad('status', raw.status);
  if (typeof raw.pinned !== 'boolean') bad('pinned', raw.pinned);

  if (!absent(raw.priority_rank)
    && !(Number.isInteger(raw.priority_rank) && raw.priority_rank > 0)) {
    bad('priority_rank', raw.priority_rank);
  }
  if (!absent(raw.scheduled_date) && !isDate(raw.scheduled_date)) bad('scheduled_date', raw.scheduled_date);
  if (!absent(raw.scheduled_time) && !isTime(raw.scheduled_time)) bad('scheduled_time', raw.scheduled_time);
  if (!absent(raw.deadline) && !isDate(raw.deadline)) bad('deadline', raw.deadline);
  if (!absent(raw.depends_on) && !nonEmptyString(raw.depends_on)) bad('depends_on', raw.depends_on);
  if (!absent(raw.source) && !nonEmptyString(raw.source)) bad('source', raw.source);
  if (!absent(raw.outcome_id) && !nonEmptyString(raw.outcome_id)) bad('outcome_id', raw.outcome_id);
  if (!absent(raw.context) && typeof raw.context !== 'string') bad('context', raw.context);

  /* A time scheduled without a day is not a placement the week can render. */
  if (!absent(raw.scheduled_time) && absent(raw.scheduled_date)) {
    bad('scheduled_time', 'a time with no scheduled_date');
  }

  return {
    workItemId: raw.work_item_id,
    title: raw.title,
    context: absent(raw.context) ? '' : raw.context,
    status: raw.status,
    priorityRank: absent(raw.priority_rank) ? null : raw.priority_rank,
    scheduledDate: absent(raw.scheduled_date) ? null : raw.scheduled_date,
    /* Trimming a VALIDATED HH:MM:SS to HH:MM for display is presentation, not
       substitution: the value was already readable and means the same thing. */
    scheduledTime: absent(raw.scheduled_time) ? null : raw.scheduled_time.slice(0, 5),
    deadline: absent(raw.deadline) ? null : raw.deadline,
    pinned: raw.pinned,
    dependsOn: absent(raw.depends_on) ? null : raw.depends_on,
    outcomeId: absent(raw.outcome_id) ? null : raw.outcome_id,
    source: absent(raw.source) ? null : raw.source,
  };
}

/** @returns {object|null} The item the pointer names, or null. Never a guess. */
export function currentWorkItem(snapshot) {
  const id = snapshot?.currentWork?.workItemId;
  if (!id) return null;
  return snapshot.items.find((i) => i.workItemId === id) ?? null;
}

/**
 * Whether an item is blocked by work that is still unfinished.
 *
 * Only claimed when the dependency is ITSELF in the Calendar, because the
 * Calendar contains exactly the live work: a depends_on pointing at something
 * absent means that dependency is already terminal, and calling it "blocked"
 * would be inventing a blocker the server does not report. The read does not
 * expose blocked_reason/blocked_until, so this is the only dependency signal
 * the frontend can honestly render.
 */
export function isBlockedByDependency(item, snapshot) {
  if (!item?.dependsOn) return false;
  return snapshot.items.some((i) => i.workItemId === item.dependsOn);
}

/** True when the item could be worked now -- used for AFFORDANCE ONLY. */
export function isSelectable(item, snapshot) {
  if (!item) return false;
  if (isBlockedByDependency(item, snapshot)) return false;
  /* Work scheduled for a future day is not today's work. Compared as strings
     because both sides are the founder's own local ISO day. */
  if (item.scheduledDate && item.scheduledDate > snapshot.today) return false;
  return true;
}

/**
 * The founder's declared plan order: rank 1, 2, 3.
 *
 * DELIBERATELY INDEPENDENT OF CURRENT WORK. Priority is what the founder said
 * matters most; Current Work is what the server resolved as workable now. They
 * often differ -- #1 can be blocked by a dependency while #2 is actionable --
 * and the UI is required to be able to show exactly that. Nothing here reads
 * or writes the Current Work pointer.
 */
export function topPriorities(snapshot, limit = 3) {
  return snapshot.items
    .filter((i) => Number.isInteger(i.priorityRank))
    .sort((a, b) => a.priorityRank - b.priorityRank)
    .slice(0, limit);
}

/** Items with no scheduled day: the backlog. */
export function backlog(snapshot) {
  return snapshot.items.filter((i) => !i.scheduledDate);
}

/** Adds `days` to an ISO day without ever consulting the browser clock. */
export function addDays(isoDay, days) {
  const [y, m, d] = isoDay.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/** Monday-based weekday index of an ISO day (0 = Monday). */
export function weekdayIndex(isoDay) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * Seven day buckets, Monday-first, anchored on the SERVER's today.
 *
 * @param {object} snapshot
 * @param {number} [weekOffset] 0 = the week containing today.
 */
export function weekDays(snapshot, weekOffset = 0) {
  const monday = addDays(snapshot.today, -weekdayIndex(snapshot.today) + weekOffset * 7);
  const scheduled = snapshot.items.filter((i) => i.scheduledDate);
  return Array.from({ length: 7 }, (_, n) => {
    const date = addDays(monday, n);
    return {
      date,
      isToday: date === snapshot.today,
      isPast: date < snapshot.today,
      items: scheduled
        .filter((i) => i.scheduledDate === date)
        .sort(byTimeThenRank),
    };
  });
}

function byTimeThenRank(a, b) {
  if (a.scheduledTime && b.scheduledTime && a.scheduledTime !== b.scheduledTime) {
    return a.scheduledTime < b.scheduledTime ? -1 : 1;
  }
  if (a.scheduledTime && !b.scheduledTime) return -1;
  if (!a.scheduledTime && b.scheduledTime) return 1;
  const ar = Number.isInteger(a.priorityRank) ? a.priorityRank : Number.MAX_SAFE_INTEGER;
  const br = Number.isInteger(b.priorityRank) ? b.priorityRank : Number.MAX_SAFE_INTEGER;
  return ar - br;
}

/**
 * Is the plan lock still in force?
 *
 * THE ONE PLACE IN THIS FILE THAT READS A CLOCK, and it is injected so the
 * dependence is visible at the call site and testable without freezing time.
 *
 * This is a WALL-CLOCK question ("has this instant passed?"), not a calendar-
 * day question, and the two must not be confused. The founder's day comes only
 * from `snapshot.today`, which the server derives from their saved IANA zone --
 * nothing here, and nothing anywhere else in this module, may compute it.
 * Enforcement of the lock remains the backend's: this decides presentation
 * only, so a skewed browser clock can mislabel a badge but can never let a
 * command through that the server would refuse.
 *
 * @param {object} snapshot
 * @param {number} [nowMs] Defaults to the browser clock.
 */
export function planLock(snapshot, nowMs = Date.now()) {
  if (!snapshot.planLockedUntil) return { locked: false, until: null, reason: null };
  return {
    locked: Date.parse(snapshot.planLockedUntil) > nowMs,
    until: snapshot.planLockedUntil,
    reason: snapshot.planLockReason,
  };
}
