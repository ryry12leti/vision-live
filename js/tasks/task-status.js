/* Package 6 — the ONE canonical proof/task status mapper.
 *
 * Every user-facing status string in the tasks + proof UI must resolve through
 * VISION.taskStatus.label(). Internal engine statuses (pending, pending_review,
 * suspicious, insufficient, tracking_failed, verifier_ids, contract versions…) are
 * NEVER shown to the user — they map to exactly one of nine plain-language states.
 *
 * Vanilla, no-bundler: attaches to the VISION namespace like every other module.
 */
(function (global) {
  var VISION = global.VISION = global.VISION || {};

  // The nine — and only nine — user-facing states, in lifecycle order.
  var STATES = [
    'Not started', 'Preparing', 'In progress', 'Uploading',
    'Checking', 'Accepted', 'Needs another try', 'Under review', 'Cancelled'
  ];

  // Internal engine/DB status → user-facing state. Anything unknown falls back to
  // 'Checking' when a proof is in flight, else 'Not started' — never a raw code.
  var MAP = {
    // not started
    '': 'Not started', 'idle': 'Not started', 'not_started': 'Not started', 'ready': 'Not started',
    // preparing (permission / camera / mic / model load / calibration / countdown)
    'preparing': 'Preparing', 'requesting': 'Preparing', 'permission': 'Preparing',
    'camera_ready': 'Preparing', 'mic_ready': 'Preparing', 'model_loading': 'Preparing',
    'calibrating': 'Preparing', 'countdown': 'Preparing', 'setup': 'Preparing',
    // in progress (recording / live coaching / active session)
    'recording': 'In progress', 'active': 'In progress', 'coaching': 'In progress',
    'started': 'In progress', 'in_progress': 'In progress',
    // uploading
    'uploading': 'Uploading', 'upload': 'Uploading',
    // checking (server validating)
    'pending': 'Checking', 'checking': 'Checking', 'validating': 'Checking',
    'submitted': 'Checking', 'evaluating': 'Checking', 'ready_for_server_review': 'Checking',
    // accepted
    'accepted': 'Accepted', 'approved': 'Accepted', 'passed': 'Accepted', 'done': 'Accepted',
    // needs another try (rejected / insufficient / tracking failure / suspicious)
    'rejected': 'Needs another try', 'insufficient': 'Needs another try',
    'tracking_failed': 'Needs another try', 'suspicious': 'Needs another try',
    'failed': 'Needs another try', 'stopped_before_target': 'Needs another try',
    // under review (human review required — NOT a rejection)
    'pending_review': 'Under review', 'review_required': 'Under review',
    'uncertain': 'Under review', 'flagged': 'Under review',
    // cancelled
    'cancelled': 'Cancelled', 'canceled': 'Cancelled', 'stopped': 'Cancelled',
    'expired': 'Cancelled', 'aborted': 'Cancelled'
  };

  function label(internalStatus, opts) {
    var key = String(internalStatus == null ? '' : internalStatus).trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(MAP, key)) return MAP[key];
    // Unknown status: if a proof is in flight, "Checking" is the safe truth; else nothing started.
    return (opts && opts.inFlight) ? 'Checking' : 'Not started';
  }

  // True when a status is terminal (no further user action drives it forward here).
  function isTerminal(internalStatus) {
    var l = label(internalStatus);
    return l === 'Accepted' || l === 'Needs another try' || l === 'Under review' || l === 'Cancelled';
  }

  VISION.taskStatus = { STATES: STATES.slice(), label: label, isTerminal: isTerminal };
})(typeof window !== 'undefined' ? window : globalThis);
