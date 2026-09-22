/* Package 6 — Report-bad-task modal (extracted byte-exact from tasks-page.js).
   Owns the "report this task" feedback modal: reason selection + submit via
   VISION.api.reportBadTask. Loaded before tasks-page.js (after dom-helpers); openReportModal
   is invoked at runtime by the task-detail sheet, closeReportModal by the Escape handler. */
/* ── Report bad task modal ── */
let REPORT_TASK = null, REPORT_REASON = '';
function openReportModal(mission) {
  REPORT_TASK = mission; REPORT_REASON = '';
  const m = document.getElementById('reportTaskModal');
  const tEl = document.getElementById('rtmTaskTitle');
  if (tEl) tEl.textContent = '"' + (mission.title || 'Task').slice(0, 80) + '"';
  document.querySelectorAll('.rtm-reason').forEach(el => el.classList.remove('on'));
  if (m) m.classList.add('show');
}
function closeReportModal() {
  const m = document.getElementById('reportTaskModal'); if (m) m.classList.remove('show');
}

function showReportedTaskAdaptation(proposal) {
  if (!proposal || !proposal.adaptation_id || !proposal.proposed_task) return false;
  try {
    D.adaptation = { id: proposal.adaptation_id, task: proposal.proposed_task };
    setText('apTitle', proposal.proposed_task.title || '');
    setText('apWhy', proposal.proposed_task.why_personalised || proposal.proposed_task.proof_prompt || '');
    const section = document.getElementById('tdAdaptSection');
    const box = document.getElementById('adaptProposal');
    const status = document.getElementById('adaptStatus');
    if (section) section.style.display = '';
    if (box) box.style.display = '';
    if (status) { status.textContent = 'Replacement built from your feedback.'; status.className = 'adapt-status ok'; }
    document.querySelectorAll('.adapt-chip').forEach(function(chip) { chip.disabled = false; chip.classList.remove('selected'); });
    if (box && box.scrollIntoView) setTimeout(function() { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 80);
    return true;
  } catch(e) { return false; }
}

try {
  document.querySelectorAll('.rtm-reason').forEach(el => {
    el.addEventListener('click', function() {
      document.querySelectorAll('.rtm-reason').forEach(r => r.classList.remove('on'));
      this.classList.add('on');
      REPORT_REASON = this.dataset.reason || 'other';
    });
  });
  const rtmCancel = document.getElementById('rtmCancel');
  const rtmScrim  = document.getElementById('rtmScrim');
  const rtmSubmit = document.getElementById('rtmSubmit');
  if (rtmCancel) rtmCancel.addEventListener('click', closeReportModal);
  if (rtmScrim)  rtmScrim.addEventListener('click',  closeReportModal);
  if (rtmSubmit) rtmSubmit.addEventListener('click', async () => {
    if (!REPORT_REASON) { try { VISION.ui.toast('Pick a reason first'); } catch(e){} return; }
    if (!SIGNED_IN || !VISION.api || !VISION.api.reportBadTask) { closeReportModal(); return; }
    rtmSubmit.disabled = true; rtmSubmit.textContent = 'Sending…';
    let reportResult = null;
    try {
      // Privacy-safe report: no profile/goal is sent. We forward only the task's
      // proof-contract compiler version so a fix can target the exact generator.
      const cv = REPORT_TASK && (REPORT_TASK.proofContractVersion || REPORT_TASK.proof_contract_version);
      reportResult = await VISION.api.reportBadTask(
        REPORT_TASK && REPORT_TASK.id,
        REPORT_TASK && REPORT_TASK.title,
        REPORT_REASON,
        '',
        { compilerVersion: (cv === 0 || cv) ? cv : null }
      );
    } catch(e) { reportResult = { error: 'network_error' }; }

    if (!reportResult || reportResult.error) {
      rtmSubmit.disabled = false; rtmSubmit.innerHTML = 'Send Report →';
      try { VISION.ui.toast('<b>Couldn\'t save feedback</b> · try again'); } catch(e) {}
      return;
    }

    // The aggregate cache must not survive a newly stored task-fit outcome.
    try { dispatchEvent(new CustomEvent('vision:task-personalisation-invalidated', { detail: { rank: false } })); } catch(e) {}

    // Feedback must improve the current experience, not only fill a future report table.
    // For fit/level/generic failures, immediately build a same-goal replacement and let
    // the user review it before applying. Unsafe reports remain report-only and fail closed.
    const replaceReasons = ['wrong_goal', 'too_easy', 'too_hard', 'generic'];
    let replacementReady = false;
    if (replaceReasons.indexOf(REPORT_REASON) > -1 && REPORT_TASK && REPORT_TASK.id && VISION.api.proposeAdaptation) {
      rtmSubmit.textContent = 'Building replacement…';
      try {
        const proposal = await VISION.api.proposeAdaptation(
          REPORT_TASK.id,
          REPORT_REASON,
          'Generated from the user\'s task-fit feedback.'
        );
        replacementReady = !!(proposal && proposal.ok && showReportedTaskAdaptation(proposal));
      } catch(e) { replacementReady = false; }
    }

    rtmSubmit.disabled = false; rtmSubmit.innerHTML = 'Send Report →';
    closeReportModal();
    try {
      VISION.ui.toast(replacementReady
        ? '<b>Feedback learned</b> · a better-fit replacement is ready'
        : '<b>Thanks</b> · feedback logged for personalisation');
    } catch(e) {}
  });
} catch(e) {}
