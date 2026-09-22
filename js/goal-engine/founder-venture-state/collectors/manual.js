/**
 * Manual user-update collector — Founder Venture State V2, task spec
 * section 4/C. Thin request builders only; the actual confirm/dispute/
 * supersede/lifecycle state transitions are enforced by service-v2.js
 * (which owns concurrency, portfolio, and audit-event concerns) — this
 * module just shapes a caller's plain-language intent into the exact
 * request each service operation expects, with no trust logic of its own.
 */

import { buildFact } from '../fact-ledger.js';

/**
 * A user directly stating/correcting a fact. Always `user_manual_update` /
 * `user_confirmed` — the highest tier a human, not a proof integration, can
 * reach directly.
 *
 * `supersedesFactId` names the fact this one REPLACES. It is what separates a
 * correction from an independent second opinion: two equal-trust facts that
 * merely disagree are a conflict the ledger deliberately refuses to resolve
 * (fact-ledger.js), and a correction that did not declare what it superseded
 * was indistinguishable from one — so the founder's newer answer lost to their
 * older one, forever. Caller supplies it; this builder adds no trust logic.
 */
export function buildManualUpdateFact({
  ventureId, userId, factKey, value, factId, occurredAt, reference, supersedesFactId = null,
}) {
  return buildFact({
    factId,
    ventureId,
    userId,
    factKey,
    value,
    sourceType: 'user_manual_update',
    sourceReference: reference,
    occurredAt,
    recordedAt: occurredAt,
    supersedesFactId,
  });
}

/** @returns {{factId: string, expectedVersion: number}} */
export function buildConfirmFactRequest({ factId, expectedVersion }) {
  return { factId, expectedVersion };
}

/** @returns {{factId: string, expectedVersion: number, reason: string}} */
export function buildDisputeFactRequest({ factId, expectedVersion, reason }) {
  return { factId, expectedVersion, reason };
}

/** @returns {{ventureId: string, expectedVersion: number, transition: 'pause'|'resume'|'archive'}} */
export function buildLifecycleTransitionRequest({ ventureId, expectedVersion, transition }) {
  return { ventureId, expectedVersion, transition };
}
