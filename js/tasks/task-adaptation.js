/* Package 6 — Task adaptation handlers (extracted byte-exact from tasks-page.js).
   Delegated click handling for the adapt-chip → proposeAdaptation → apply/reject flow.
   Registers on document at load; D.task / SIGNED_IN / VISION.api / BACKEND_TASKS and the
   render/sheet helpers resolve at call time via shared global scope. Server-gated task swap;
   no XP logic here. */
/* ================================================================
   ADAPTATION HANDLERS
   ================================================================ */
try {
  document.addEventListener('click', async function(e) {
    // adapt-chip click → propose an adaptation
    const chip = e.target.closest('.adapt-chip');
    if (chip && !chip.disabled && D.task && D.task.id && SIGNED_IN && VISION.api && VISION.api.proposeAdaptation) {
      const reasonType = chip.dataset.reason;
      $$('.adapt-chip').forEach(c => { c.classList.remove('selected'); c.disabled = true; });
      chip.classList.add('selected');
      const adaptStat = $('adaptStatus');
      const adaptProp = $('adaptProposal');
      if (adaptStat) { adaptStat.textContent = 'Generating adaptation…'; adaptStat.className = 'adapt-status'; }
      if (adaptProp) adaptProp.style.display = 'none';

      var r;
      try { r = await VISION.api.proposeAdaptation(D.task.id, reasonType, ''); }
      catch(err) { r = { ok: false, error: 'network_error' }; }

      if (!r || !r.ok || !r.proposed_task) {
        if (adaptStat) { adaptStat.textContent = 'Could not generate an alternative — try again.'; adaptStat.className = 'adapt-status err'; }
        $$('.adapt-chip').forEach(c => c.disabled = false);
        return;
      }

      D.adaptation = { id: r.adaptation_id, task: r.proposed_task };
      if (adaptStat) { adaptStat.textContent = ''; adaptStat.className = 'adapt-status'; }
      setText('apTitle', r.proposed_task.title || '');
      setText('apWhy',   r.proposed_task.why_personalised || r.proposed_task.proof_prompt || '');
      if (adaptProp) adaptProp.style.display = '';
      try { dispatchEvent(new CustomEvent('vision:task-personalisation-invalidated', { detail: { rank: false } })); } catch(err) {}
    }

    // accept adaptation
    if (e.target.id === 'apAcceptBtn' || e.target.closest('#apAcceptBtn')) {
      if (!D.adaptation || !D.adaptation.id || !(VISION.api && VISION.api.applyAdaptation)) return;
      const originalTaskId = D.task && D.task.id;
      const btn = $('apAcceptBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }
      var r2;
      try { r2 = await VISION.api.applyAdaptation(D.adaptation.id); }
      catch(err) { r2 = { ok: false }; }

      if (!r2 || !r2.ok) {
        if (btn) { btn.disabled = false; btn.innerHTML = 'Accept this task <span class="arr">→</span>'; }
        const adaptStat = $('adaptStatus');
        if (adaptStat) { adaptStat.textContent = 'Could not apply — try again.'; adaptStat.className = 'adapt-status err'; }
        return;
      }
      // reload tasks to show the new active task
      closeTaskDetail();
      try { BACKEND_TASKS = await VISION.api.getTasks(); } catch(err) {}
      try { D.progression = await VISION.api.getDailyProgression(); } catch(err) {}
      try { renderScoreStrip(); } catch(err) {}
      renderTasks(getMissions(BACKEND_TASKS));
      D.adaptation = null;
      try { dispatchEvent(new CustomEvent('vision:task-adaptation-accepted', { detail: { taskId: originalTaskId } })); } catch(err) {}
      try { dispatchEvent(new CustomEvent('vision:task-personalisation-invalidated', { detail: { rank: false } })); } catch(err) {}
      try { VISION.ui.toast('<b>Task adapted</b> — your new task is ready.'); } catch(err) {}
    }

    // reject adaptation (keep original) — persist the decision server-side so
    // learning does not leave an abandoned proposal incorrectly marked proposed.
    if (e.target.id === 'apRejectBtn' || e.target.closest('#apRejectBtn')) {
      const adaptProp = $('adaptProposal');
      const adaptStat = $('adaptStatus');
      const rejectBtn = $('apRejectBtn');
      const adaptationId = D.adaptation && D.adaptation.id;
      const originalTaskId = D.task && D.task.id;
      if (rejectBtn) rejectBtn.disabled = true;
      if (adaptStat) { adaptStat.textContent = adaptationId ? 'Keeping original task…' : ''; adaptStat.className = 'adapt-status'; }

      if (adaptationId && SIGNED_IN && VISION.sb && VISION.sb.rpc) {
        try {
          const rejected = await VISION.sb.rpc('reject_task_adaptation_v1', { p_adaptation_id: adaptationId });
          if (rejected.error || !rejected.data || rejected.data.ok !== true) {
            if (rejectBtn) rejectBtn.disabled = false;
            if (adaptStat) { adaptStat.textContent = 'Could not save your decision — try again.'; adaptStat.className = 'adapt-status err'; }
            return;
          }
        } catch(err) {
          if (rejectBtn) rejectBtn.disabled = false;
          if (adaptStat) { adaptStat.textContent = 'Could not save your decision — try again.'; adaptStat.className = 'adapt-status err'; }
          return;
        }
      }

      if (adaptProp) adaptProp.style.display = 'none';
      if (adaptStat) { adaptStat.textContent = ''; adaptStat.className = 'adapt-status'; }
      $$('.adapt-chip').forEach(c => { c.classList.remove('selected'); c.disabled = false; });
      if (rejectBtn) rejectBtn.disabled = false;
      D.adaptation = null;
      try { dispatchEvent(new CustomEvent('vision:task-adaptation-rejected', { detail: { taskId: originalTaskId } })); } catch(err) {}
      try { dispatchEvent(new CustomEvent('vision:task-personalisation-invalidated', { detail: { rank: false } })); } catch(err) {}
    }
  });
} catch(e) {}
