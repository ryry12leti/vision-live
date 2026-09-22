/**
 * Founder Calendar — the ONE way the browser talks to the Calendar API.
 *
 * WHY THIS IS NOT A THREE-LINE WRAPPER. supabase-js resolves
 * `functions.invoke()` with `{data, error}`, and for any non-2xx response it
 * puts the parsed body **on `error.context`, not on `data`**. The Calendar API
 * answers every meaningful refusal with a non-2xx typed body:
 *
 *   409 { ok:false, error:'version_conflict',            state_version: 42 }
 *   409 { ok:false, error:'command_fingerprint_conflict' }
 *   404 { ok:false, error:'founder_venture_unavailable' }
 *   500 { ok:false, error:'calendar_read_failed' }
 *
 * A wrapper that only reads `res.data` throws all of that away and reports a
 * generic failure -- so a founder whose plan moved in another tab would be told
 * "something went wrong" instead of being refreshed. Preserving the typed code
 * is the entire point of this file.
 *
 * Injectable `invoke` so the contract can be tested without a browser or a
 * network.
 */

/** Refusals the UI must react to specifically rather than generically. */
export const CALENDAR_ERROR = Object.freeze({
  UNAUTHORIZED: 'unauthorized',
  NO_VENTURE: 'founder_venture_unavailable',
  READ_FAILED: 'calendar_read_failed',
  DAY_UNRESOLVABLE: 'local_day_unresolvable',
  VERSION_CONFLICT: 'version_conflict',
  FINGERPRINT_CONFLICT: 'command_fingerprint_conflict',
  PLAN_LOCKED: 'plan_locked',
  NOT_FOUND: 'not_found',
  WORK_ITEM_NOT_FOUND: 'work_item_not_found',
  TRANSPORT: 'calendar_unreachable',
});

/** A refusal the founder can fix by letting us refresh and re-applying. */
export function isStaleStateError(code) {
  return code === CALENDAR_ERROR.VERSION_CONFLICT
    || code === CALENDAR_ERROR.FINGERPRINT_CONFLICT;
}

async function readErrorBody(error) {
  /* supabase-js FunctionsHttpError carries the raw Response here. It can only
     be consumed once, and it may not be JSON at all (a gateway 502 is HTML),
     so both failures degrade to "no typed body" rather than throwing. */
  const ctx = error && error.context;
  if (!ctx || typeof ctx.json !== 'function') return null;
  try { return await ctx.json(); } catch { return null; }
}

/**
 * @param {(name: string, opts: object) => Promise<{data: any, error: any}>} invoke
 * @param {string} action
 * @param {object} [payload]
 * @returns {Promise<{ok: boolean, body: any, error: string|null,
 *   outcome: string|null, stateVersion: number|null, httpStatus: number|null}>}
 */
export async function callCalendar(invoke, action, payload = {}) {
  let res;
  try {
    res = await invoke('founder-calendar', { body: { action, ...payload } });
  } catch (thrown) {
    /* The function was never reached: offline, DNS, CORS, aborted. Distinct
       from a refusal, because retrying is the right advice here and is not
       the right advice for a conflict. */
    return fail(CALENDAR_ERROR.TRANSPORT, null, null, thrown?.message ?? null);
  }

  if (res && res.error) {
    const body = await readErrorBody(res.error);
    const status = res.error.context?.status ?? null;
    if (body && typeof body === 'object') {
      return {
        ok: false,
        body,
        error: typeof body.error === 'string' ? body.error : CALENDAR_ERROR.TRANSPORT,
        outcome: typeof body.outcome === 'string' ? body.outcome : null,
        stateVersion: Number.isInteger(body.state_version) ? body.state_version : null,
        httpStatus: status,
      };
    }
    return fail(CALENDAR_ERROR.TRANSPORT, status, null, res.error?.message ?? null);
  }

  const body = res?.data;
  if (!body || typeof body !== 'object') {
    return fail(CALENDAR_ERROR.TRANSPORT, 200, null, 'empty body');
  }
  if (body.ok !== true) {
    /* A 2xx that still says ok:false. Rare, but treating it as success is how
       an error screen turns into an empty Calendar. */
    return {
      ok: false,
      body,
      error: typeof body.error === 'string' ? body.error : CALENDAR_ERROR.TRANSPORT,
      outcome: typeof body.outcome === 'string' ? body.outcome : null,
      stateVersion: Number.isInteger(body.state_version) ? body.state_version : null,
      httpStatus: 200,
    };
  }
  return { ok: true, body, error: null, outcome: null, stateVersion: null, httpStatus: 200 };
}

function fail(error, httpStatus, stateVersion, detail) {
  return { ok: false, body: null, error, outcome: null, stateVersion, httpStatus, detail };
}

export const readCalendar = (invoke) => callCalendar(invoke, 'read');

/**
 * Ask the SERVER to move Current Work. The browser never sets it locally.
 *
 * expectedVersion is the version the founder was actually looking at: if the
 * plan moved underneath them the command is refused rather than applied to a
 * state they never saw.
 */
export const selectCurrentWork = (invoke, { workItemId, expectedVersion, commandId }) =>
  callCalendar(invoke, 'select_current_work', {
    command_id: commandId,
    expected_version: expectedVersion,
    params: { work_item_id: workItemId },
  });

/* ── the proposal lifecycle ───────────────────────────────────────────────
   None of these three carry expected_version, and that is deliberate rather
   than an omission. A proposal is not authority: reading, editing or
   discarding one moves no venture state. Asserting a venture version against
   them would fail a founder's edit because something unrelated changed. */

/** The founder's one open proposed week, or a clean "none". */
export const readProposal = (invoke) => callCalendar(invoke, 'read_proposal');

/**
 * Edit First. Carries the PROPOSAL's own revision, so two tabs editing the
 * same week conflict instead of silently overwriting each other.
 */
export const reviseProposal = (invoke, { proposalId, expectedRevision, proposal }) =>
  callCalendar(invoke, 'revise_proposal', {
    params: { proposal_id: proposalId, expected_revision: expectedRevision, proposal },
  });

export const discardProposal = (invoke, { proposalId }) =>
  callCalendar(invoke, 'discard_proposal', {
    params: { proposal_id: proposalId },
  });

/**
 * Use This Week. THE authoritative transition, and the only proposal action
 * that is a real Calendar command -- so it carries command_id and
 * expected_version like every other one.
 *
 * expectedVersion is the version the founder was looking at while they
 * reviewed. If the venture moved underneath them the week they approved is
 * not the week that would be created, and it is refused.
 */
export const acceptPlan = (invoke, { proposalId, expectedVersion, commandId }) =>
  callCalendar(invoke, 'accept_plan', {
    command_id: commandId,
    expected_version: expectedVersion,
    params: { proposal_id: proposalId },
  });

/** Crypto-strength id so a retry is a replay, never a second command. */
export function newCommandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('crypto.randomUUID unavailable');
}
