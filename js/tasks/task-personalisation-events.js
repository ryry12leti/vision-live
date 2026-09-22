/* Privacy-safe task funnel hooks.
   Emits only task IDs, allowlisted event names and one of photo/voice/live.
   It does not inspect media, notes, proof evidence, validator output or XP. */
(function () {
  if (window.__VISION_TASK_PERSONALISATION_EVENTS__) return;
  window.__VISION_TASK_PERSONALISATION_EVENTS__ = true;

  function emit(name, taskId, proofType) {
    if (!taskId) return;
    try {
      dispatchEvent(new CustomEvent(name, {
        detail: {
          taskId: String(taskId),
          proofType: ['photo', 'voice', 'live'].includes(String(proofType || '')) ? String(proofType) : null
        }
      }));
    } catch (_) {}
  }

  function currentTask() {
    try { return typeof D !== 'undefined' && D.task ? D.task : null; }
    catch (_) { return null; }
  }

  function currentProofType() {
    try {
      const p = String((typeof D !== 'undefined' && D.proofType) || 'photo').toLowerCase();
      return p === 'voice' || p === 'live' ? p : 'photo';
    } catch (_) { return 'photo'; }
  }

  function hasProofMedia() {
    try { return typeof D !== 'undefined' && !!D.fileObj; }
    catch (_) { return false; }
  }

  function installFunctionHooks() {
    try {
      if (typeof window.openTaskDetail === 'function' && !window.openTaskDetail.__personalisationWrapped) {
        const originalOpen = window.openTaskDetail;
        const wrappedOpen = function (mission) {
          const result = originalOpen.apply(this, arguments);
          if (mission && mission.id) emit('vision:task-opened', mission.id, null);
          return result;
        };
        wrappedOpen.__personalisationWrapped = true;
        window.openTaskDetail = wrappedOpen;
      }
    } catch (_) {}

    try {
      if (typeof window.doSubmitProof === 'function' && !window.doSubmitProof.__personalisationWrapped) {
        const originalSubmit = window.doSubmitProof;
        const wrappedSubmit = async function () {
          const task = currentTask();
          // Only count a submission attempt once the existing proof flow has media.
          // The original server-authoritative function still performs every real check.
          if (task && task.id && hasProofMedia()) {
            emit('vision:task-proof-submitted', task.id, currentProofType());
          }
          return originalSubmit.apply(this, arguments);
        };
        wrappedSubmit.__personalisationWrapped = true;
        window.doSubmitProof = wrappedSubmit;
      }
    } catch (_) {}
  }

  function installDomHooks() {
    if (document.documentElement.dataset.taskPersonalisationEvents === '1') return;
    document.documentElement.dataset.taskPersonalisationEvents = '1';

    document.addEventListener('change', function (event) {
      const target = event && event.target;
      if (!target || target.id !== 'tdFile') return;
      const task = currentTask();
      try {
        const file = target.files && target.files[0];
        if (task && task.id && file && /^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type || '') && file.size <= 10 * 1024 * 1024) {
          emit('vision:task-proof-started', task.id, 'photo');
        }
      } catch (_) {}
    });

    document.addEventListener('click', function (event) {
      const target = event && event.target && event.target.closest ? event.target : null;
      if (!target) return;
      const task = currentTask();
      if (!task || !task.id) return;

      if (target.closest('#tdVoiceRec')) emit('vision:task-proof-started', task.id, 'voice');
      else if (target.closest('#tdLiveRec')) emit('vision:task-proof-started', task.id, 'live');
      else if (target.closest('.adapt-chip')) emit('vision:task-adaptation-requested', task.id, null);
    });
  }

  function install() {
    installFunctionHooks();
    installDomHooks();
    // Function declarations are already present before task-store loads, but keep
    // a bounded retry for slow script execution and test harnesses.
    let attempts = 0;
    const timer = setInterval(function () {
      attempts++;
      installFunctionHooks();
      if (attempts >= 20 || (
        typeof window.openTaskDetail === 'function' && window.openTaskDetail.__personalisationWrapped &&
        typeof window.doSubmitProof === 'function' && window.doSubmitProof.__personalisationWrapped
      )) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
