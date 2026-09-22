/* ===============================================================
   vision-fixes.js — production page-load safety patch
   ---------------------------------------------------------------
   Signed-in hydration reads authoritative backend state. Founder plan
   clarification compatibility below only translates the deployed canonical
   Founder 409 payload into the existing daily-plan question contract; it does
   not generate a second task path or persist task rows client-side.
=============================================================== */
window.VISION = window.VISION || {};
(function (V) {
  'use strict';

  function mapRow(t, proofDecision) {
    return {
      id: t.id, title: t.title, meta: t.description,
      difficulty: t.difficulty, proof: true, goalType: t.goal_type,
      baseXp: t.base_xp, status: t.status,
      done: t.activation_status === 'accepted' || t.status === 'done',
      proofDecision: proofDecision || null, kind: t.role, role: t.role,
      why: t.why, helps: t.helps, steps: t.steps || [],
      estMinutes: t.est_minutes, proofPrompt: t.proof_prompt,
      proofMustShow: t.proof_must_show, proofRejectIf: t.proof_reject_if,
      goodProofExamples: t.good_proof_examples || [],
      whyPersonalised: t.why_personalised,
      mistakeToAvoid: t.mistake_to_avoid,
      fallback: t.fallback_task, upgrade: t.upgrade_task,
      tags: t.personalisation_tags || [], taskSource: t.task_source,
      profileGoalSnapshot: t.profile_goal_snapshot || '',
      profilePathTypeSnapshot: t.profile_path_type_snapshot || '',
      generatedReason: t.generated_reason,
      activationStatus: t.activation_status || 'queued',
      effortLevel: t.effort_level || 'medium', taskType: t.task_type || '',
      sequencePosition: t.sequence_position || null,
      adaptedFromTaskId: t.adapted_from_task_id || null
    };
  }

  function installApiFix() {
    var sb = V.sb, C = V.core, A = V.auth, api = V.api;
    if (!sb || !C || !A || !api || api.__readOnlyTaskLoaderInstalled) return false;
    api.__readOnlyTaskLoaderInstalled = true;

    function today() { return C.today(); }
    async function uid() { var u = await A.getUser(); return u ? u.id : null; }

    api.getTasks = async function () {
      var id = await uid();
      if (!id) return [];

      var taskResult = await sb.from('daily_tasks').select('*')
        .eq('user_id', id).eq('date', today())
        .order('sequence_position', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (taskResult.error) throw taskResult.error;

      var proofResult = await sb.from('proofs').select('task_id,decision')
        .eq('user_id', id).eq('date', today());
      if (proofResult.error) throw proofResult.error;

      var proofByTask = {};
      (proofResult.data || []).forEach(function (proof) {
        proofByTask[proof.task_id] = proof.decision;
      });
      return (taskResult.data || []).map(function (task) {
        return mapRow(task, proofByTask[task.id]);
      });
    };

    api.readTodayTasks = api.getTasks;
    return true;
  }

  (function waitApi(remaining) {
    if (installApiFix()) return;
    if (remaining > 0) setTimeout(function () { waitApi(remaining - 1); }, 0);
  })(150);

  function signedInLikely() {
    try {
      if (V.auth && (V.auth.user || V.auth.currentUser)) return true;
      return Object.keys(localStorage).some(function (key) {
        return key.indexOf('-auth-token') !== -1 && !!localStorage.getItem(key);
      });
    } catch (e) { return false; }
  }

  function installFallbackGuard() {
    if (typeof window.getMissions !== 'function' || window.getMissions.__productionFallbackGuard) return false;
    var original = window.getMissions;
    function guarded(backendTasks) {
      if (Array.isArray(backendTasks)) {
        // NO GENERIC TASKS EVER: never render a generic fallback row as a task (keep a
        // proven one so a proof-locked legacy day still shows its earned task). getTasks()
        // already filters at the data layer — this is defence-in-depth for any raw set.
        var usable = backendTasks.filter(function (t) {
          return String(t.taskSource || '') !== 'fallback_path_specific' || t.done || t.proofDecision === 'accepted';
        });
        if (usable.length) {
          // delegate to the page's real mapper so EVERY Task Engine V2 field
          // (recommendedProofType, allowedProofTypes, proofContract,
          // proofMustShow, estMinutes…) survives — the reduced re-map that
          // used to live here silently stripped the proof-modality/contract
          // fields, breaking live-proof routing for signed-in tasks
          return original(usable.slice(0, 7));
        }
        if (signedInLikely()) return [];
      }
      if (signedInLikely()) return [];
      return original(backendTasks);
    }
    guarded.__productionFallbackGuard = true;
    window.getMissions = guarded;
    return true;
  }

  (function waitMissions(remaining) {
    if (installFallbackGuard()) return;
    if (remaining > 0) setTimeout(function () { waitMissions(remaining - 1); }, 0);
  })(150);

  /* ── Founder clarification compatibility ─────────────────────────────
     The canonical Founder engine returns:
       409 { needs_clarification:true, clarification_questions:[text] }
     while the existing daily-plan client can render a structured diagnostic.
     Translate only the fixed canonical question vocabulary. The same existing
     Founder answer route then writes the matching real venture fact and retries
     the same generate-tasks pipeline. */
  var FOUNDER_QUESTION_FACT_KEY = {
    'What exactly are you building or selling?': 'idea',
    'Who is it for?': 'targetCustomer',
    'What have you completed so far?': 'completedWork',
    'What is currently unfinished?': 'unfinishedWork',
    'What outcome are you trying to achieve next?': 'immediateGoal',
    'What evidence of customers, users, or revenue exists?': 'customerEvidence',
    'What resources or constraints affect execution?': 'constraints',
    'What is your core offer (what do you charge for, or plan to)?': 'offerPricing',
    'Who are your current or target customers, and what evidence do you have of demand?': 'customerEvidence',
    'What work is still unfinished on your product or service right now?': 'unfinishedWork',
    'What is the single most important thing you are trying to achieve right now?': 'immediateGoal'
  };

  function founderDiagnosticPayload(payload) {
    if (!payload || payload.needs_clarification !== true) return null;
    var questions = payload.clarification_questions;
    if (!Array.isArray(questions) || !questions.length) return null;
    var text = String(questions[0] || '').trim();
    var factKey = FOUNDER_QUESTION_FACT_KEY[text];
    if (!factKey) return null;
    return Object.assign({}, payload, {
      blocked: true,
      error: 'clarification_required',
      diagnostic: {
        question: {
          question_id: factKey,
          question_text: text,
          question_reason: 'Your Founder venture needs this before a task can be generated.',
          information_key: 'founder'
        }
      }
    });
  }

  function markFounderQuestion(plan) {
    if (plan && plan.status === 'clarification_required' && plan.question && plan.question.informationKey === 'founder') {
      plan.question.founder = true;
    }
    return plan;
  }

  function wrapPlanMethod(plan, name) {
    var original = plan && plan[name];
    if (typeof original !== 'function' || original.__founderCompatWrapped) return;
    var wrapped = async function () {
      return markFounderQuestion(await original.apply(plan, arguments));
    };
    wrapped.__founderCompatWrapped = true;
    plan[name] = wrapped;
  }

  function installFounderPlanCompat() {
    var sb = V.sb, plan = V.dailyPlan;
    if (!sb || !sb.functions || typeof sb.functions.invoke !== 'function' || !plan) return false;
    if (plan.__founderClarificationCompatInstalled) return true;

    var originalInvoke = sb.functions.invoke.bind(sb.functions);
    sb.functions.invoke = async function (slug, options) {
      var result = await originalInvoke(slug, options);
      if (slug !== 'generate-tasks' || !result || !result.error || !result.error.context) return result;

      var context = result.error.context;
      var status = Number(context.status || 0);
      if (status !== 409 || typeof context.json !== 'function') return result;

      try {
        var source = typeof context.clone === 'function' ? context.clone() : context;
        var payload = await source.json();
        var translated = founderDiagnosticPayload(payload);
        if (!translated) return result;
        result.error.context = {
          status: status,
          json: async function () { return translated; }
        };
      } catch (e) { /* preserve the original response */ }
      return result;
    };

    wrapPlanMethod(plan, 'load');
    wrapPlanMethod(plan, 'refresh');
    wrapPlanMethod(plan, 'reload');
    wrapPlanMethod(plan, 'generateFirstPlan');
    wrapPlanMethod(plan, 'answerQuestion');
    plan.__founderClarificationCompatInstalled = true;

    // The first page boot may have completed before this late safety file loaded.
    // Retry only when it ended in the exact Founder clarification failure state.
    try {
      var current = plan.state && plan.state();
      if (current && current.status === 'error' && current.error &&
          (current.error.code === 'more_information_required' || current.error.code === 'generation_failed')) {
        setTimeout(function () { plan.load({ force: false }); }, 0);
      }
    } catch (e2) {}
    return true;
  }

  (function waitFounderPlan(remaining) {
    if (installFounderPlanCompat()) return;
    if (remaining > 0) setTimeout(function () { waitFounderPlan(remaining - 1); }, 10);
  })(200);

  /* The dashboard Today’s Move card is itself navigable to Tasks. Without
     stopping propagation, its inner Try Again button runs the retry and then
     the card click navigates away before the question can render. Handle that
     one control in capture phase and keep the user on Home. */
  document.addEventListener('click', function (event) {
    var target = event.target && event.target.closest ? event.target.closest('#nmPlanRetry') : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    if (!V.dailyPlan || typeof V.dailyPlan.load !== 'function' || target.disabled) return;
    target.disabled = true;
    Promise.resolve(V.dailyPlan.load({ force: false })).finally(function () {
      target.disabled = false;
    });
  }, true);
})(window.VISION);
