/**
 * Founder Calendar — rendering and interaction.
 *
 * Holds exactly ONE piece of state: the last snapshot the server returned.
 * There is no local task list, no cached Current Work, no optimistic copy that
 * "will be reconciled later". Every render is a function of that snapshot, and
 * the only way the snapshot changes is by reading it again from the server.
 *
 * That is why a mutation here always re-reads instead of patching what is on
 * screen. Patching would mean the browser briefly holds an opinion about
 * Current Work that the server never confirmed -- and the one time those
 * disagree is the one time the founder is looking at the wrong work.
 */

import {
  parseCalendarSnapshot, currentWorkItem, topPriorities, backlog, weekDays,
  isBlockedByDependency, isSelectable, planLock, addDays,
  CURRENT_WORK_STATE, CalendarContractError, parseProposal, PROPOSAL_STATE,
} from './state.js';
import {
  readCalendar, selectCurrentWork, isStaleStateError, newCommandId, CALENDAR_ERROR,
  readProposal, reviseProposal, acceptPlan,
} from './api.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Founder-facing copy. No database vocabulary reaches the screen. */
const MESSAGE = {
  [CALENDAR_ERROR.UNAUTHORIZED]: 'Sign in to see your week.',
  [CALENDAR_ERROR.NO_VENTURE]: 'VISION does not have a venture for you yet. Finish setting up your company and your week will appear here.',
  [CALENDAR_ERROR.READ_FAILED]: 'VISION could not read your week just now.',
  [CALENDAR_ERROR.DAY_UNRESOLVABLE]: 'VISION could not work out what today is for you. Check your timezone in settings.',
  [CALENDAR_ERROR.TRANSPORT]: 'VISION could not reach your plan. Check your connection.',
  [CALENDAR_ERROR.PLAN_LOCKED]: 'Your plan is locked for now, so that change was not applied.',
  [CALENDAR_ERROR.WORK_ITEM_NOT_FOUND]: 'That work is no longer in your plan. VISION refreshed your week.',
  [CALENDAR_ERROR.NOT_FOUND]: 'That work is no longer in your plan. VISION refreshed your week.',
};
const STALE_MESSAGE = 'Your plan changed while this view was open. VISION refreshed it before applying anything.';

export function createFounderCalendar({ root, invoke, drawer }) {
  let snapshot = null;
  let weekOffset = 0;
  /* Guards a mutation in flight. A double-click or a fast A -> B must not put
     two commands on the wire against the same expected_version: the second
     would be refused as a conflict and read to the founder as an error when
     nothing was actually wrong. */
  let busy = false;
  let notice = null;
  /* The SAME component in two modes, never two calendars. `proposal` non-null
     means the founder is looking at a week that is not real yet; null means
     they are looking at their live adaptive plan. Nothing else about this file
     forks -- accepting swaps the mode in place and re-renders. */
  let proposal = null;

  const setNotice = (text, kind) => { notice = text ? { text, kind } : null; };

  /**
   * Reads the proposed week FIRST.
   *
   * If one is open the founder has not approved their plan yet, and the
   * authoritative Calendar is genuinely empty -- rendering that empty week
   * would tell them they have nothing when they are one button from a plan.
   *
   * This is self-limiting rather than a recurring ritual: acceptance closes
   * the proposal, and propose mode refuses (409) once work is live, so after
   * the first approval this always falls through to the live Calendar.
   */
  /**
   * THREE states, never two.
   *
   *   OPEN  -- a proposed week exists; show it.
   *   NONE  -- there is definitively no proposed week; carry on to the live plan.
   *   ERROR -- we do not know.
   *
   * Collapsing ERROR into NONE is the whole bug this replaces. "I could not
   * read your proposed week" would have become "you have no proposed week",
   * and the founder would then be shown an EMPTY live Calendar while a plan
   * they were reviewing sat on the server -- or worse, a fresh one would be
   * generated over the top of it.
   */
  async function loadProposal() {
    const res = await readProposal(invoke);
    if (!res.ok) { proposal = null; return { state: 'error', error: res.error }; }
    try {
      const parsed = parseProposal(res.body);
      proposal = parsed.state === PROPOSAL_STATE.OPEN ? parsed : null;
      return { state: proposal ? 'open' : 'none' };
    } catch (err) {
      /* A malformed proposal is ERROR, not NONE, for the same reason: a
         half-rendered week would collect approval for something the founder
         never saw in full. */
      proposal = null;
      return {
        state: 'error',
        error: err instanceof CalendarContractError ? 'malformed' : CALENDAR_ERROR.TRANSPORT,
      };
    }
  }

  async function load({ showLoading = true } = {}) {
    if (showLoading && !snapshot && !proposal) renderLoading();
    const prop = await loadProposal();
    if (prop.state === 'open') { render(); return { ok: true, proposal }; }
    if (prop.state === 'error') {
      /* STOP. Do not fall through to the live Calendar: rendering an empty
         week here tells a founder they have nothing when the truth is that we
         could not find out. The error is retryable and says so. */
      snapshot = null;
      renderError(prop.error);
      return { ok: false, error: prop.error, proposalReadFailed: true };
    }
    const res = await readCalendar(invoke);
    if (!res.ok) {
      snapshot = null;
      renderError(res.error);
      return { ok: false, error: res.error };
    }
    try {
      snapshot = parseCalendarSnapshot(res.body);
    } catch (err) {
      /* A malformed snapshot is an error screen, never a partial render: the
         founder must be able to tell "no work" from "we could not read it". */
      snapshot = null;
      renderError(err instanceof CalendarContractError ? 'malformed' : CALENDAR_ERROR.TRANSPORT);
      return { ok: false, error: 'malformed' };
    }
    render();
    return { ok: true, snapshot };
  }

  /**
   * Move Current Work. The server decides; this reads the result back.
   * Never marks success from the response alone.
   */
  async function chooseCurrentWork(workItemId) {
    if (busy || !snapshot) return { ok: false, error: 'busy' };
    busy = true;
    render();
    try {
      const res = await selectCurrentWork(invoke, {
        workItemId,
        expectedVersion: snapshot.stateVersion,
        commandId: newCommandId(),
      });

      if (!res.ok && isStaleStateError(res.error)) {
        /* Someone (another tab, another device, VISION itself) moved the plan.
           Nothing is overwritten: re-read and show what is actually true. */
        setNotice(STALE_MESSAGE, 'info');
        busy = false;
        await load({ showLoading: false });
        return { ok: false, error: res.error, refreshed: true };
      }
      if (!res.ok) {
        setNotice(MESSAGE[res.error] || 'VISION could not apply that change.', 'error');
        busy = false;
        /* Still re-read: the refusal may itself have been caused by state the
           founder cannot see, and a stale screen invites a second failed try. */
        await load({ showLoading: false });
        return { ok: false, error: res.error };
      }

      setNotice(null, null);
      busy = false;
      /* THE AUTHORITATIVE STEP. The command returned 200, but what is rendered
         comes from a fresh read, not from the command's own echo. */
      const after = await load({ showLoading: false });
      if (!after.ok) {
        /* The change IS applied server-side; only the confirmation failed.
           Reporting plain success would leave a screen that cannot show it,
           and reporting plain failure would invite the founder to redo work
           that already happened. Both halves are stated. */
        return { ok: false, applied: true, error: 'reread_failed', detail: after.error };
      }
      return { ok: true, applied: true, currentWorkId: after.snapshot.currentWork.workItemId ?? null };
    } catch (err) {
      busy = false;
      setNotice('VISION could not apply that change.', 'error');
      render();
      return { ok: false, error: 'exception', detail: String(err && err.message) };
    }
  }

  // ── rendering ────────────────────────────────────────────────────────────
  function renderLoading() {
    root.innerHTML = `
      <div class="fc-skeleton tall" aria-hidden="true"></div>
      <div class="fc-skeleton short" aria-hidden="true"></div>
      <p class="fc-eyebrow" role="status">Loading your week…</p>`;
  }

  function renderError(code) {
    const retryable = code !== CALENDAR_ERROR.UNAUTHORIZED && code !== CALENDAR_ERROR.NO_VENTURE;
    const text = code === 'malformed'
      ? 'VISION received an unexpected answer and did not want to guess at your week.'
      : (MESSAGE[code] || 'VISION could not load your week.');
    root.innerHTML = `
      <section class="fc-state is-error" role="alert">
        <h3>${esc(code === CALENDAR_ERROR.NO_VENTURE ? 'No venture yet' : 'Your week is unavailable')}</h3>
        <p>${esc(text)}</p>
        ${retryable ? '<button class="fc-btn primary" data-fc="retry">Try again</button>' : ''}
      </section>`;
  }

  function render() {
    if (proposal) { renderProposal(); return; }
    if (!snapshot) return;
    const cw = currentWorkItem(snapshot);
    const lock = planLock(snapshot);
    const prios = topPriorities(snapshot);
    const week = weekDays(snapshot, weekOffset);
    const shelf = backlog(snapshot);

    root.innerHTML = `
      ${notice ? `<div class="fc-notice ${notice.kind === 'error' ? 'is-error' : ''}" role="status">${esc(notice.text)}</div>` : ''}

      <div class="fc-context">
        <span class="fc-eyebrow">This week</span>
        ${renderObjective()}
        <button class="fc-why" data-fc="why" type="button">Why this plan?</button>
      </div>

      ${renderCurrentWork(cw)}
      ${prios.length ? renderPriorities(prios) : ''}

      <section class="fc-week" aria-label="Your week">
        <div class="fc-weekhead">
          <span class="fc-eyebrow">Your week</span>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            ${lock.locked ? `<span class="fc-plan-lock">Plan locked${lock.reason ? ` — ${esc(lock.reason)}` : ''}</span>` : ''}
            <nav class="weeknav" aria-label="Change week">
              <button class="icon" data-fc="week-prev" aria-label="Previous week">‹</button>
              <button data-fc="week-now">${weekOffset === 0 ? 'This week' : 'Back to this week'}</button>
              <button class="icon" data-fc="week-next" aria-label="Next week">›</button>
            </nav>
          </div>
        </div>
        <div class="weekgrid">${week.map(renderDay).join('')}</div>
      </section>

      ${shelf.length ? renderBacklog(shelf) : ''}`;
  }

  function renderObjective() {
    /* The read exposes no Weekly Objective field. Rather than invent one from
       the browser, this states only what the snapshot actually supports. The
       dedicated objective is Phase 6B backend work. */
    const scheduled = snapshot.items.filter((i) => i.scheduledDate).length;
    return `<p class="fc-objective">${
      snapshot.items.length === 0
        ? 'Nothing is planned yet.'
        : `${esc(String(snapshot.items.length))} piece${snapshot.items.length === 1 ? '' : 's'} of live work, ${esc(String(scheduled))} scheduled this period.`
    }</p>`;
  }

  function renderCurrentWork(item) {
    const state = snapshot.currentWork.state;

    if (state === CURRENT_WORK_STATE.NONE) {
      return `
        <article class="fc-current is-empty">
          <div class="fc-current-rail" aria-hidden="true"></div>
          <div class="fc-current-body">
            <div class="eyebrow"><span class="fc-label">Current work</span></div>
            <h2 class="fc-current-title">Nothing is set as your current work.</h2>
            <p class="fc-current-context">Choose a piece of work below and VISION will make it current.</p>
          </div>
        </article>`;
    }

    if (state === CURRENT_WORK_STATE.DANGLING || !item) {
      /* The pointer names work the Calendar does not contain. Substituting
         something plausible here is exactly the inference this UI must not
         make, so it says what it knows and offers a refresh. */
      return `
        <article class="fc-current is-empty">
          <div class="fc-current-rail" aria-hidden="true"></div>
          <div class="fc-current-body">
            <div class="eyebrow"><span class="fc-label">Current work</span></div>
            <h2 class="fc-current-title">Your current work is no longer in this week.</h2>
            <p class="fc-current-context">It may have been completed or replaced. Refresh to see the up-to-date plan.</p>
            <button class="fc-btn" data-fc="retry">Refresh</button>
          </div>
        </article>`;
    }

    const blocked = isBlockedByDependency(item, snapshot);
    return `
      <article class="fc-current">
        <div class="fc-current-rail" aria-hidden="true"></div>
        <div class="fc-current-body">
          <div class="eyebrow">
            <span class="fc-label">Current work</span>
            ${badges(item, blocked)}
            ${snapshot.currentWork.selectedBy === 'founder' ? '<span class="badge">You chose this</span>' : ''}
          </div>
          <h2 class="fc-current-title">${esc(item.title)}</h2>
          ${item.context ? `<p class="fc-current-context">${esc(item.context)}</p>` : ''}
          <p class="fc-current-meta">
            ${item.scheduledDate ? `<span>${esc(prettyDay(item.scheduledDate))}${item.scheduledTime ? ` · ${esc(item.scheduledTime)}` : ''}</span>` : '<span>Not scheduled</span>'}
            ${Number.isInteger(item.priorityRank) ? `<span>Priority #${esc(String(item.priorityRank))}</span>` : ''}
            ${snapshot.currentWork.projectionDailyTaskId ? '<span>Ready to prove</span>' : ''}
          </p>
        </div>
      </article>`;
  }

  function renderPriorities(items) {
    const currentId = snapshot.currentWork.workItemId;
    return `
      <section class="fc-priorities" aria-label="Top priorities">
        <span class="fc-eyebrow">Top priorities</span>
        <div class="fc-prio-grid">
          ${items.map((i) => {
    const blocked = isBlockedByDependency(i, snapshot);
    const isCurrent = i.workItemId === currentId;
    return `
              <article class="fc-prio ${isCurrent ? 'is-current' : ''}">
                <span class="fc-prio-rank">${String(i.priorityRank).padStart(2, '0')}</span>
                <h3 class="fc-prio-title">${esc(i.title)}</h3>
                <p class="fc-prio-meta">${
  isCurrent ? 'This is your current work'
    : blocked ? 'Waiting on other work'
      : i.scheduledDate ? esc(prettyDay(i.scheduledDate)) : 'Not scheduled'
}</p>
                ${isCurrent || blocked ? '' : `<button class="fc-btn" data-fc="choose" data-id="${esc(i.workItemId)}" ${busy ? 'disabled' : ''}>Make this current</button>`}
              </article>`;
  }).join('')}
        </div>
      </section>`;
  }

  function renderDay(day) {
    const [, m, d] = day.date.split('-');
    return `
      <div class="daycol ${day.isToday ? 'is-today' : ''} ${day.isPast ? 'is-past' : ''}" data-date="${esc(day.date)}">
        <div class="daycol-head">
          <span class="dow">${DOW[(new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7]}</span>
          <span class="dnum">${esc(String(Number(d)))}/${esc(String(Number(m)))}</span>
          ${day.items.length ? `<span class="daycol-count">${day.items.length}</span>` : ''}
        </div>
        <div class="wcol">
          ${day.items.length
    ? day.items.map(workCard).join('')
    : '<p class="daycol-empty">—</p>'}
        </div>
      </div>`;
  }

  function workCard(item) {
    const isCurrent = item.workItemId === snapshot.currentWork.workItemId;
    const blocked = isBlockedByDependency(item, snapshot);
    return `
      <button class="wcard ${isCurrent ? 'is-current' : ''} ${blocked ? 'is-blocked' : ''} ${item.pinned ? 'is-pinned' : ''}"
        data-fc="open" data-id="${esc(item.workItemId)}" type="button">
        <p class="wcard-title">${esc(item.title)}</p>
        <p class="wcard-meta">
          ${item.scheduledTime ? `<span>${esc(item.scheduledTime)}</span>` : ''}
          ${Number.isInteger(item.priorityRank) ? `<span class="badge rank">#${esc(String(item.priorityRank))}</span>` : ''}
          ${item.pinned ? '<span class="badge pin">Pinned</span>' : ''}
          ${blocked ? '<span class="badge blocked">Waiting</span>' : ''}
          ${isCurrent ? '<span class="badge vision"><span class="dot"></span>Current</span>' : ''}
        </p>
      </button>`;
  }

  function renderBacklog(items) {
    return `
      <section class="fc-backlog" aria-label="Unscheduled work">
        <span class="fc-eyebrow">Not scheduled</span>
        <div class="fc-backlog-grid">${items.map(workCard).join('')}</div>
      </section>`;
  }

  function badges(item, blocked) {
    return [
      item.source === 'vision' ? '<span class="badge vision"><span class="dot"></span>VISION</span>' : '',
      item.pinned ? '<span class="badge pin">Pinned</span>' : '',
      blocked ? '<span class="badge blocked">Waiting on other work</span>' : '',
    ].join('');
  }

  function prettyDay(iso) {
    if (!snapshot) return iso;
    if (iso === snapshot.today) return 'Today';
    if (iso === addDays(snapshot.today, 1)) return 'Tomorrow';
    if (iso === addDays(snapshot.today, -1)) return 'Yesterday';
    const [, m, d] = iso.split('-');
    return `${Number(d)}/${Number(m)}`;
  }

  // ── detail drawer ────────────────────────────────────────────────────────
  function openItem(id) {
    const item = snapshot?.items.find((i) => i.workItemId === id);
    if (!item || !drawer) return;
    const blocked = isBlockedByDependency(item, snapshot);
    const isCurrent = item.workItemId === snapshot.currentWork.workItemId;
    const canChoose = !isCurrent && isSelectable(item, snapshot);
    drawer.innerHTML = `
      <div class="fc-drawer-body">
        <div class="fc-drawer-meta">${badges(item, blocked)}${isCurrent ? '<span class="badge vision"><span class="dot"></span>Current work</span>' : ''}</div>
        <h3>${esc(item.title)}</h3>
        ${item.context ? `<p class="fc-drawer-context">${esc(item.context)}</p>` : ''}
        <p class="fc-drawer-context">
          ${item.scheduledDate ? `${esc(prettyDay(item.scheduledDate))}${item.scheduledTime ? ` at ${esc(item.scheduledTime)}` : ''}` : 'Not scheduled'}
          ${Number.isInteger(item.priorityRank) ? ` · Priority #${esc(String(item.priorityRank))}` : ''}
        </p>
        ${blocked ? '<p class="fc-drawer-context">This is waiting on other work in your plan.</p>' : ''}
        <div class="fc-drawer-actions">
          ${canChoose ? `<button class="fc-btn primary" data-fc="choose" data-id="${esc(item.workItemId)}" ${busy ? 'disabled' : ''}>Make this current work</button>` : ''}
          <button class="fc-btn" data-fc="close-drawer" type="button">Close</button>
        </div>
      </div>`;
    if (typeof drawer.showModal === 'function') drawer.showModal();
  }

  /* ── proposal mode ────────────────────────────────────────────────────
     The founder is looking at their actual proposed week while deciding
     whether to accept it. Nothing here is authoritative and the copy says so
     plainly -- a screen that looked live would make Use This Week meaningless. */
  function renderProposal() {
    const plan = proposal.plan;
    const rec = plan.recommendation;
    const items = Array.isArray(plan.items) ? plan.items : [];
    const cw = plan.currentWork || {};
    const cwLabel = cw.kind === 'recommendation'
      ? (rec ? rec.title : null)
      : (items.find((i) => i.clientId === cw.clientId) || {}).title;

    const card = (title, when, sub, chosen, remove) => `
      <article class="fc-card${chosen ? ' is-current' : ''}">
        <h4>${esc(title)}</h4>
        ${sub ? `<p class="fc-sub">${esc(sub)}</p>` : ''}
        <p class="fc-meta">${esc(when || 'Unscheduled')}${chosen ? ' · starts here' : ''}</p>
        ${remove ? `<button class="fc-btn" data-fc="prop-remove" data-id="${esc(remove)}" type="button">Remove</button>` : ''}
      </article>`;

    root.innerHTML = `
      ${notice ? `<div class="fc-notice ${notice.kind === 'error' ? 'is-error' : ''}" role="status">${esc(notice.text)}</div>` : ''}

      <div class="fc-context">
        <span class="fc-eyebrow">Your first week — not live yet</span>
        <p class="fc-objective">${
          rec
            ? 'VISION has drafted where to start. Nothing below is real until you approve it.'
            : 'You removed VISION&rsquo;s recommendation. Only your own work is in this week.'
        }</p>
        <button class="fc-why" data-fc="why" type="button">Why this plan?</button>
      </div>

      ${proposal.stale ? `<div class="fc-notice is-error" role="alert">${esc(STALE_MESSAGE)} Regenerate before approving.</div>` : ''}

      <section class="fc-week" aria-label="Your proposed week">
        <div class="fc-weekhead"><span class="fc-eyebrow">Proposed week of ${esc(proposal.weekStart)}</span></div>
        ${rec ? card(rec.title, rec.scheduledDate, 'Recommended by VISION', cw.kind === 'recommendation', '@recommendation') : ''}
        ${items.map((i) => card(i.title, i.scheduledDate, i.definitionOfDone,
          cw.kind === 'item' && cw.clientId === i.clientId, i.clientId)).join('')}
        ${!rec && !items.length ? '<p class="fc-objective">This week is empty. Add work before approving it.</p>' : ''}
      </section>

      <section class="fc-current" aria-label="Where you start">
        <span class="fc-eyebrow">You start with</span>
        <p class="fc-objective">${cwLabel ? esc(cwLabel) : 'Nothing chosen yet.'}</p>
      </section>

      <div class="fc-drawer-actions">
        <button class="fc-btn primary" data-fc="accept-plan" type="button"
          ${(proposal.stale || busy || (!rec && !items.length)) ? 'disabled' : ''}>Use This Week</button>
        <button class="fc-btn" data-fc="edit-first" type="button" ${busy ? 'disabled' : ''}>Edit First</button>
      </div>`;
  }

  /** Edit First. Every edit goes back through the server validator, so a
   *  founder cannot edit past a rule the engine had to satisfy. */
  function openEdit() {
    if (!drawer) return;
    const plan = proposal.plan;
    const items = Array.isArray(plan.items) ? plan.items : [];
    const choices = [
      ...(plan.recommendation ? [{ v: 'recommendation', t: plan.recommendation.title }] : []),
      ...items.map((i) => ({ v: `item:${i.clientId}`, t: i.title })),
    ];
    const cw = plan.currentWork || {};
    const cwVal = cw.kind === 'recommendation' ? 'recommendation' : `item:${cw.clientId}`;
    drawer.innerHTML = `
      <div class="fc-drawer-body">
        <span class="fc-eyebrow">Edit first</span>
        <h3>Add your own work to this week</h3>
        <p class="fc-drawer-context">VISION proposes where to start. What else this week needs is yours to say.</p>
        <label class="fc-field"><span>What is the work?</span>
          <input id="fc-add-title" type="text" maxlength="120" placeholder="Draft the pricing page"></label>
        <label class="fc-field"><span>Done when&hellip;</span>
          <input id="fc-add-dod" type="text" maxlength="500" placeholder="A pricing page exists with three tiers and real numbers"></label>
        <label class="fc-field"><span>Which day?</span>
          <input id="fc-add-date" type="date" value="${esc(proposal.weekStart)}"
            min="${esc(proposal.weekStart)}" max="${esc(addDays(proposal.weekStart, 6))}"></label>
        <div class="fc-drawer-actions">
          <button class="fc-btn primary" data-fc="prop-add" type="button">Add to week</button>
        </div>
        ${choices.length > 1 ? `
        <label class="fc-field"><span>Start the week with</span>
          <select id="fc-start-with">${choices.map((c) => `
            <option value="${esc(c.v)}"${c.v === cwVal ? ' selected' : ''}>${esc(c.t)}</option>`).join('')}
          </select></label>
        <div class="fc-drawer-actions">
          <button class="fc-btn" data-fc="prop-start" type="button">Start here instead</button>
        </div>` : ''}
        <div class="fc-drawer-actions">
          <button class="fc-btn" data-fc="close-drawer" type="button">Close</button>
        </div>
      </div>`;
    if (typeof drawer.showModal === 'function') drawer.showModal();
  }

  /** One path for every proposal edit: mutate a copy, send it, re-read. */
  async function saveProposal(mutate) {
    if (busy) return { ok: false };
    busy = true;
    const next = JSON.parse(JSON.stringify(proposal.plan));
    mutate(next);
    const res = await reviseProposal(invoke, {
      proposalId: proposal.proposalId, expectedRevision: proposal.revision, proposal: next,
    });
    busy = false;
    if (!res.ok) {
      /* The server names WHICH rule the edit broke. Showing that beats
         "something went wrong" when the fix is one field away. */
      setNotice(res.body?.reason ? `VISION could not accept that edit: ${res.body.reason}` : MESSAGE[res.error]
        || 'VISION could not save that edit.', 'error');
      render();
      return { ok: false, error: res.error };
    }
    if (drawer?.open) drawer.close();
    setNotice(null);
    await load({ showLoading: false });
    return { ok: true };
  }

  /**
   * Use This Week. The one authoritative transition.
   *
   * Converts in place: no navigation, no second Calendar. Acceptance closes
   * the proposal, the next read finds none, and this same component re-renders
   * as the live adaptive plan with Current Work already resolved.
   */
  async function accept() {
    if (busy || !proposal) return { ok: false };
    busy = true;
    const res = await acceptPlan(invoke, {
      proposalId: proposal.proposalId,
      /* The version the founder was actually looking at while reviewing. If
         the venture moved underneath them, the week they approved is not the
         week that would be created, and the server refuses. */
      expectedVersion: proposal.stateVersion,
      commandId: newCommandId(),
    });
    busy = false;
    if (!res.ok) {
      /* isStaleStateError takes the CODE. Passing the result object made this
         always false, so a genuine version_conflict on acceptance -- the exact
         case where the founder must be told their plan moved -- fell through
         to the generic message. */
      setNotice(isStaleStateError(res.error) ? STALE_MESSAGE
        : (MESSAGE[res.error] || 'VISION could not put this week live.'), 'error');
      /* Re-read either way: a refusal means what is on screen is out of date. */
      await load({ showLoading: false });
      return { ok: false, error: res.error };
    }
    /* Never trusts the response. The plan is live only if reading authoritative
       state back says so. */
    proposal = null;
    setNotice('This week is live. VISION will keep it up to date from here.', 'ok');
    return load({ showLoading: false });
  }

  function openWhy() {
    if (!drawer) return;
    if (proposal) {
      /* The real thing, at last. Every field below was computed by the engine
         and stored with the proposal; the browser formats it and adds nothing.
         A field the engine did not answer is omitted, never filled in. */
      const r = proposal.rationale || {};
      /* Several of these are ARRAYS (professional standard, required evidence).
         Interpolating one straight into the template stringifies it, so two
         separate rules ran together with a bare comma between them and read as
         one broken sentence. Seen in the browser, not in any unit test. */
      const row = (label, value) => {
        if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
        const body = Array.isArray(value)
          ? `<ul>${value.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>`
          : `${esc(value)}`;
        return `<p class="fc-drawer-context"><strong>${esc(label)}</strong></p>${
          Array.isArray(value) ? body : `<p class="fc-drawer-context">${body}</p>`}`;
      };
      /* The engine's bottleneck category is an enum. Showing `weak_demand` to a
         founder is database vocabulary on screen, which this product does not
         do. Unmapped values are dropped rather than guessed at -- a category
         nobody has written words for is not something to paraphrase. */
      const BOTTLENECK = {
        weak_demand: 'Nobody is reliably asking to buy yet.',
        no_demand_evidence: 'There is no first-party evidence that people want this.',
        weak_offer: 'What is being sold is not yet sharp enough to say yes to.',
        no_repeatable_channel: 'There is no channel that reliably produces conversations.',
        delivery_capacity: 'Delivering what has been sold is the constraint.',
        pricing: 'Pricing is what is holding the business back.',
        retention: 'Customers are not staying.',
      };
      const body = [
        row('What this is for', r.activeOutcome),
        row('What is in the way', BOTTLENECK[r.bottleneckCategory] || null),
        row('Why this work', r.whyThisWork),
        row('Done when', r.completionDefinition),
        row('The standard', r.professionalStandard),
        row('What counts as proof', r.requiredEvidence),
        row('What should change', r.expectedOutcome),
      ].filter(Boolean).join('');
      drawer.innerHTML = `
        <div class="fc-drawer-body">
          <span class="fc-eyebrow">Why this plan?</span>
          <h3>${esc(proposal.plan.recommendation ? 'Where VISION says to start' : 'This week is yours')}</h3>
          ${body || `<p class="fc-drawer-context">VISION did not record reasoning for this week.
             Rather than write an explanation it did not compute, this is left blank.</p>`}
          <div class="fc-drawer-actions">
            <button class="fc-btn" data-fc="close-drawer" type="button">Close</button>
          </div>
        </div>`;
      if (typeof drawer.showModal === 'function') drawer.showModal();
      return;
    }
    /* THE BOUNDARY, NOT AN EXPLANATION. The Calendar read carries no reasoning
       payload, and writing plausible strategy prose in the browser would be
       inventing a rationale VISION never computed -- the one kind of lie this
       product cannot afford. Phase 6B supplies the real thing. */
    drawer.innerHTML = `
      <div class="fc-drawer-body">
        <span class="fc-eyebrow">Why this plan?</span>
        <h3>VISION cannot explain this week yet.</h3>
        <p class="fc-drawer-context">
          Your plan is real and authoritative, but the reasoning behind it is not something
          this screen can retrieve yet. Rather than write an explanation that VISION did not
          actually compute, it is left blank until the engine can answer it properly.
        </p>
        <div class="fc-drawer-actions">
          <button class="fc-btn" data-fc="close-drawer" type="button">Close</button>
        </div>
      </div>`;
    if (typeof drawer.showModal === 'function') drawer.showModal();
  }

  // ── events ───────────────────────────────────────────────────────────────
  async function onClick(ev) {
    const el = ev.target.closest('[data-fc]');
    if (!el) return;
    const act = el.getAttribute('data-fc');
    if (act === 'retry') { setNotice(null); await load(); return; }
    if (act === 'week-prev') { weekOffset -= 1; render(); return; }
    if (act === 'week-next') { weekOffset += 1; render(); return; }
    if (act === 'week-now') { weekOffset = 0; render(); return; }
    if (act === 'open') { openItem(el.getAttribute('data-id')); return; }
    if (act === 'why') { openWhy(); return; }
    if (act === 'edit-first') { openEdit(); return; }
    if (act === 'accept-plan') {
      if (busy) return;
      el.setAttribute('disabled', 'disabled');
      await accept();
      return;
    }
    if (act === 'prop-add') {
      const q = (id) => drawer.querySelector(id);
      const title = (q('#fc-add-title')?.value || '').trim();
      const dod = (q('#fc-add-dod')?.value || '').trim();
      const date = q('#fc-add-date')?.value || proposal.weekStart;
      /* Client-side only to keep the founder from a pointless round trip. The
         server validator is still the authority and still runs. */
      if (title.length < 3 || dod.length < 8) {
        setNotice('Give the work a name and a real "done when" before adding it.', 'error');
        render(); return;
      }
      await saveProposal((plan) => {
        const used = new Set([
          ...(plan.recommendation ? [plan.recommendation.priority] : []),
          ...plan.items.map((i) => i.priority),
        ]);
        let priority = 1;
        while (used.has(priority)) priority += 1;
        const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        let clientId = base.length >= 3 ? base : `work-${priority}`;
        const taken = new Set(plan.items.map((i) => i.clientId));
        while (taken.has(clientId)) clientId = `${clientId}-${priority}`;
        plan.items.push({
          clientId, title, definitionOfDone: dod, scheduledDate: date,
          priority, dependsOnClientId: null,
        });
      });
      return;
    }
    if (act === 'prop-remove') {
      const id = el.getAttribute('data-id');
      await saveProposal((plan) => {
        if (id === '@recommendation') {
          /* EXPLICIT null, never a deleted key. Null is how a founder rejects
             the recommendation; an absent key is a malformed plan the server
             refuses -- deliberately, so a bug cannot reject it for them. */
          plan.recommendation = null;
        } else {
          plan.items = plan.items.filter((i) => i.clientId !== id);
        }
        const cw = plan.currentWork || {};
        const gone = (id === '@recommendation' && cw.kind === 'recommendation')
          || (cw.kind === 'item' && cw.clientId === id);
        if (gone) {
          /* Whatever they start with must still exist. */
          plan.currentWork = plan.recommendation
            ? { kind: 'recommendation' }
            : (function pickByPriority() {
              /* By PRIORITY, never by array position. Choosing work
                 positionally is the habit the Calendar contract test forbids
                 outright, and the founder's own ordering is the right answer. */
              const next = plan.items.reduce(
                (best, i) => (!best || i.priority < best.priority ? i : best), null);
              return next ? { kind: 'item', clientId: next.clientId } : {};
            }());
        }
      });
      return;
    }
    if (act === 'prop-start') {
      const v = drawer.querySelector('#fc-start-with')?.value || '';
      await saveProposal((plan) => {
        plan.currentWork = v === 'recommendation'
          ? { kind: 'recommendation' }
          : { kind: 'item', clientId: v.slice(5) };
      });
      return;
    }
    if (act === 'close-drawer') { if (drawer?.open) drawer.close(); return; }
    if (act === 'choose') {
      if (busy) return;
      el.setAttribute('disabled', 'disabled');
      if (drawer?.open) drawer.close();
      await chooseCurrentWork(el.getAttribute('data-id'));
    }
  }

  root.addEventListener('click', onClick);
  if (drawer) drawer.addEventListener('click', onClick);

  return {
    load,
    chooseCurrentWork,
    acceptProposal: accept,
    getProposal: () => proposal,
    getSnapshot: () => snapshot,
    isBusy: () => busy,
    setWeekOffset: (n) => { weekOffset = n; render(); },
    destroy() {
      root.removeEventListener('click', onClick);
      if (drawer) drawer.removeEventListener('click', onClick);
    },
  };
}
