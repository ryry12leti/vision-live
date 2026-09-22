/* Package 6 — Reflection panel (extracted byte-exact from tasks-page.js).
   Owns the end-of-day reflection: word-count gate (reflectionWordCount), lock/unlock state
   (updateReflectionPanel, gated on server progression ready_for_reflection), and the
   save→AI-evaluate→bonus wiring. Loaded before tasks-page.js; SIGNED_IN / D / VISION.api and
   renderScoreStrip resolve at call time (after dom-helpers). updateReflectionPanel is invoked
   at runtime by renderTasks. No XP computed client-side — the bonus is server-awarded. */
/* ================================================================
   REFLECTION PANEL
   ================================================================ */
function reflectionWordCount(text) {
  try {
    var t = (text || '').trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  } catch(e) { return 0; }
}

function updateReflectionPanel(tasks) {
  try {
    const locked   = $('reflectionLocked');
    const unlocked = $('reflectionUnlocked');
    const panel    = $('reflectionPanel');
    if (!locked || !unlocked) return;
    if (!SIGNED_IN || !tasks || !tasks.length) {
      locked.style.display   = '';
      unlocked.style.display = 'none';
      return;
    }
    // unlock when server progression says ready, or all proofs are accepted (legacy fallback)
    const progressionReady = D.progression && D.progression.status === 'ready_for_reflection';
    const allAccepted = tasks.every(t => t.proofDecision === 'accepted' || t.done);
    const ready = progressionReady;
    locked.style.display   = ready ? 'none' : '';
    unlocked.style.display = ready ? '' : 'none';
    if (panel) panel.style.borderColor = ready ? 'rgba(230,196,106,.3)' : '';
  } catch(e) {}
}

try {
  if ($('reflectionText')) $('reflectionText').addEventListener('input', function() {
    try {
      const wc  = reflectionWordCount(this.value);
      const el  = $('reflectionWc');
      const btn = $('reflectionSubmit');
      if (el) {
        el.textContent = wc + ' / 80 words';
        el.classList.toggle('ok', wc >= 80);
      }
      if (btn) btn.disabled = wc < 80;
    } catch(e) {}
  });
  if ($('reflectionSubmit')) {
    $('reflectionSubmit').disabled = true;
    $('reflectionSubmit').addEventListener('click', async function() {
      if (!SIGNED_IN || !(VISION.api && VISION.api.submitReflection)) {
        try { VISION.ui.toast('<b>Sign in</b> to submit a reflection'); } catch(e){} return;
      }
      const text = (($('reflectionText') || {}).value || '').trim();
      if (reflectionWordCount(text) < 80) {
        const st = $('reflectionStatus');
        if (st) { st.textContent = 'Write at least 80 words to submit.'; st.className = 'rfl-status err'; }
        return;
      }
      const btn = $('reflectionSubmit');
      const st  = $('reflectionStatus');
      const fb  = $('reflectionFeedback');

      // helper: reset to re-submittable state
      const resetBtn = (label) => {
        if (btn) { btn.disabled = false; btn.innerHTML = (label || 'Submit Reflection') + ' <span class="arr">→</span>'; }
      };

      // Step 1: save reflection text
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      if (st)  { st.textContent = ''; st.className = 'rfl-status'; }
      if (fb)  { fb.textContent = ''; fb.classList.remove('show'); }
      let saved;
      try { saved = await VISION.api.submitReflection(text); }
      catch(e) { saved = { ok: false, reason: 'error' }; }

      if (!saved || !saved.ok) {
        const reason = (saved && saved.reason) || 'error';
        if (st) {
          st.textContent = reason === 'too_short'
            ? 'Too short — write at least 80 words.'
            : reason === 'tasks_incomplete'
            ? 'All tasks must be verified before submitting a reflection.'
            : 'Could not save reflection — try again.';
          st.className = 'rfl-status err';
        }
        resetBtn();
        return;
      }

      const reflectionId = saved.reflection_id;
      if (!reflectionId) {
        // saved but no ID — edge case, show success without AI eval
        if (st) { st.textContent = 'Reflection saved.'; st.className = 'rfl-status ok'; }
        resetBtn('Resubmit Reflection');
        return;
      }

      // Step 2: AI evaluation
      if (btn) { btn.disabled = true; btn.textContent = 'Reviewing reflection…'; }
      if (st)  { st.textContent = 'Checking your reflection…'; st.className = 'rfl-status muted'; }

      let ev;
      try { ev = await VISION.api.evaluateReflection(reflectionId); }
      catch(e) { ev = { status: 'retry' }; }

      const status = (ev && ev.status) || 'retry';

      if (status === 'bonus_earned') {
        const awarded = ev.bonus_awarded !== false;
        if (st) {
          st.textContent = awarded
            ? 'Reflection bonus earned: +10 bonus points.'
            : 'Reflection bonus already earned today.';
          st.className = 'rfl-status ok';
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Submitted ✓'; }
        if (fb && ev.feedback) { fb.textContent = ev.feedback; fb.classList.add('show'); }
        try { await VISION.api.hydrateLocal(); renderScoreStrip(); } catch(e) {}
        try { VISION.analytics.track('reflection_submitted', { bonus_awarded: awarded }); } catch(e) {}
        return;
      }

      if (status === 'needs_more_detail') {
        if (st) { st.textContent = 'Needs more detail — revise and resubmit.'; st.className = 'rfl-status err'; }
        if (fb && ev.feedback) { fb.textContent = ev.feedback; fb.classList.add('show'); }
        resetBtn('Resubmit Reflection');
        return;
      }

      if (status === 'locked') {
        if (st) { st.textContent = 'All tasks must be verified first.'; st.className = 'rfl-status err'; }
        resetBtn();
        return;
      }

      // retry / unknown
      if (st) { st.textContent = 'Could not evaluate yet — tap to retry.'; st.className = 'rfl-status muted'; }
      resetBtn('Retry Evaluation');
    });
  }
} catch(e) {}
