/* ══════════════════════════════════════════════════════════════════════════
   VISION LEADS — RUNTIME
   ──────────────────────────────────────────────────────────────────────────
   Auth, the Edge Function, request state and race protection. It owns no
   rendering; it hands view models to js/leads-ui.js and nothing else.

   IT ALSO OWNS NO BUSINESS LOGIC. Qualification, band, the Next Move, pipeline
   membership, consent and the next action all arrive decided. The browser
   renders what the server concluded — anything else is a second engine in
   JavaScript that will eventually disagree with the first one.

   THERE IS NO FIXTURE FALLBACK HERE, deliberately. If auth, the backend or the
   request fails, the founder sees an honest error with a retry. Showing
   invented customers to somebody whose backend is down is not resilience.
   ══════════════════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';

  function vision() { return window.V || window.VISION; }

  /* ── REQUEST TOKENS ───────────────────────────────────────────────────
     One monotonic counter per surface. Every response checks that its token
     is still current before it is allowed to render, which is what stops the
     classic failure: open prospect A, hit Back, open prospect B, and A's
     slower response lands last and overwrites B. Cheap, and it also covers
     double-clicks and rapid switching. */
  var tokens = { board: 0, workspace: 0 };
  var currentRow = null;
  /* Which prospects rendered as a refusal, so a later contact find knows the
     advice on screen has been invalidated and re-reads it. */
  var refusedWorkspaces = {};

  /* ── EDGE TRANSPORT ───────────────────────────────────────────────────
     supabase-js attaches Authorization and apikey itself; setting them by hand
     is how a token ends up somewhere it should not be. */
  function callLeadIntelligence(action, body) {
    var app = vision();
    if (!app || !app.backend || !app.sb) {
      return Promise.resolve({ data: null, error: { message: 'backend_unavailable' } });
    }
    var payload = { action: action };
    for (var key in (body || {})) if (Object.prototype.hasOwnProperty.call(body, key)) payload[key] = body[key];
    return app.sb.functions.invoke('lead-intelligence', { body: payload });
  }

  /* On a non-2xx, supabase-js puts the parsed body on error.context, NOT on
     data. Reading only `data` discards every typed refusal the function went to
     the trouble of naming. Copied from js/plan.js, which documents the same. */
  function readRefusal(error) {
    var ctx = error && error.context;
    if (!ctx || typeof ctx.json !== 'function') return null;
    try { return ctx.json(); } catch (e) { return null; }
  }

  async function describeFailure(error) {
    var refusal = await readRefusal(error);
    if (refusal && refusal.error) {
      if (refusal.error === 'no_active_primary_venture') return 'You do not have an active venture yet.';
      if (refusal.error === 'opportunity_not_found') return 'That prospect is no longer available.';
      return 'The workspace refused the request.';
    }
    if (error && error.message === 'backend_unavailable') return 'This deployment is not connected to a VISION backend.';
    return 'The connection to your workspace failed.';
  }

  /* ── BOARD ────────────────────────────────────────────────────────────
     One request. No model call, no provider call — leads_board is entirely
     deterministic server-side, which is what makes opening Leads free. */
  async function loadBoard() {
    var token = ++tokens.board;
    V.leadsUI.renderBoardLoading();

    var result = await callLeadIntelligence('leads_board', {});
    if (token !== tokens.board) return;          // superseded

    if (result.error || !result.data || result.data.ok !== true) {
      V.leadsUI.renderBoardError(await describeFailure(result.error));
      return;
    }
    var board = result.data.board;
    if (!board.leads || !board.leads.length) V.leadsUI.renderBoardEmpty(shapeBoard(board));
    else V.leadsUI.renderBoard(shapeBoard(board));
    if (window.VISION_BOOT && typeof window.VISION_BOOT.ok === 'function') window.VISION_BOOT.ok();
  }

  /* The server board carries facts; the page header wants a sentence. Derived
     from what is actually there — never a claim the counts do not support. */
  function shapeBoard(board) {
    var total = (board.leads || []).length;
    var next = board.nextMove;
    return {
      venture: board.venture && board.venture.name ? board.venture.name : 'Your venture',
      ventureSub: board.venture && board.venture.targetCustomer ? board.venture.targetCustomer : '',
      headline: next
        ? next.name + ' is your next move.'
        : (total ? total + (total === 1 ? ' prospect saved.' : ' prospects saved.') : 'No prospects yet.'),
      sub: next
        ? next.why
        : (total ? 'Nothing is time-sensitive right now.' : ''),
      funnel: board.funnel || [],
      funnelNote: 'A click alone is not a lead. Everything left of the line is audience: seen, but not identified and not consented.',
      mode: 'outbound',
      nextMove: next,
      leads: board.leads || [],
      tabs: board.tabs || { discover: [], qualified: [], pipeline: [] },
      counts: board.counts || {},
      /* Discovery is not connected, and the renderer is told so rather than
         being given an empty campaign list it would draw as a real surface. */
      discovery: board.discovery || { providerConnected: false },
      campaigns: [], interpreted: null,
      searchPlaceholder: 'Prospect discovery is not connected yet',
      lastQuery: '',
    };
  }

  /* ── WORKSPACE ────────────────────────────────────────────────────────
     The only call that may reach a model, and only on a cache miss. */
  async function loadWorkspace(id, row) {
    var token = ++tokens.workspace;
    currentRow = row || null;

    var result = await callLeadIntelligence('prospect_intelligence', { opportunityId: id });
    /* SUPERSEDED. The founder has already moved on; rendering now would
       replace the prospect they are actually looking at. */
    if (token !== tokens.workspace) return;
    if (V.leadsUI.currentLeadId() !== id) return;

    if (result.error || !result.data || result.data.ok !== true) {
      V.leadsUI.renderWorkspaceError(row, await describeFailure(result.error));
      return;
    }
    var workspace = result.data.workspace;
    if (!workspace || !workspace.ws) {
      refusedWorkspaces[id] = true;
      V.leadsUI.renderWorkspaceRefused(workspace || row);
      return;
    }
    delete refusedWorkspaces[id];
    V.leadsUI.renderWorkspace(workspace);
  }

  /* ── PRACTICE SEAM ────────────────────────────────────────────────────
     Live Intelligence is NOT built, and this does not build it. It is the
     boundary the practice system will attach to: the workspace assembles the
     handoff, this dispatches it as a DOM event and tells the founder plainly
     that nothing is listening yet.

     A CustomEvent rather than a direct call on purpose — whoever builds
     practice can subscribe without leads-runtime having to import it, which
     keeps Leads free of a dependency on a system that does not exist. */
  /* ── HANDOFF TRANSPORT ────────────────────────────────────────────────
     sessionStorage, keyed by a random handle that is the ONLY thing in the
     URL. The payload carries the prospect, the founder's script, the evidence
     and the open unknowns; none of that belongs in a URL, where it would land
     in history, in the Referer header of any later request, and in server
     logs at both ends.

     sessionStorage rather than localStorage because a practice handoff is
     scoped to this tab and this sitting — it should not outlive the browser
     or leak into another tab the founder opens for a different prospect.

     The handle is a nonce, not a secret: the server re-validates the handoff
     and re-derives the owner from the JWT, so possessing it grants nothing. */
  /* THE SPOKEN PRACTICE CALL READS `vision_li_call_`. This used to write
     `vision_practice_handoff_` and send the founder to `?practice=`, which
     is the older TYPED panel -- a text box. The spoken rehearsal was two
     clicks away behind "I am on the call now", a button that reads as being
     on a real call, so the primary CTA quietly led somewhere else.

     Same transport as before: a nonce into session storage, never the
     prospect context in the URL. Only the key and the destination move. */
  var PRACTICE_KEY_PREFIX = 'vision_li_call_';

  function practiceLive(id, handoff) {
    try {
      document.dispatchEvent(new CustomEvent('vision:practice-live', {
        detail: { opportunityId: id, handoff: handoff },
      }));
    } catch (error) { /* older engines: navigation below still happens */ }

    var handle;
    try {
      handle = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
      window.sessionStorage.setItem(PRACTICE_KEY_PREFIX + handle, JSON.stringify({
        handoff: handoff,
        opportunityId: id,
        createdAt: new Date().toISOString(),
        /* Filled in by the practice panel after the first turn, so a reload or
           a Back-and-reopen rejoins the SAME workspace instead of starting a
           second conversation about the same prospect. */
        workspaceId: null,
      }));
    } catch (error) {
      /* Private browsing, or storage full. Say so rather than navigating to a
         page that will find nothing and blame itself. */
      V.leadsUI.showToast('This browser will not let VISION carry the script across. Practice needs session storage.');
      return;
    }
    window.location.href = 'live-intelligence.html?practice-call=' + encodeURIComponent(handle);
  }

  /* ── ON A REAL CALL ───────────────────────────────────────────────────
     Same transport as Practice and deliberately so: the prospect context
     never goes in the URL, only a handle into session storage. What differs
     is the destination and therefore the mode — VISION rehearses in one and
     stays silent in the other. */
  function callLive(id, handoff) {
    var handle;
    try {
      handle = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
      window.sessionStorage.setItem('vision_li_call_' + handle, JSON.stringify({
        handoff: handoff,
        opportunityId: id,
        createdAt: new Date().toISOString(),
        workspaceId: null,
      }));
    } catch (error) {
      V.leadsUI.showToast('This browser will not let VISION carry the context across. Call Intelligence needs session storage.');
      return;
    }
    window.location.href = 'live-intelligence.html?call=' + encodeURIComponent(handle);
  }

  /* ── WHY NOW RESEARCH ─────────────────────────────────────────────────
     OPTIONAL AND EXPLICIT, ALWAYS. Nothing on this page calls it on load, on
     open, or on refresh — the founder asks, once, per prospect. `explicit:
     true` is not the client granting permission: the server re-runs
     whyNowEligibility, which refuses NOT_WORTH_TIME, a refused consent, a
     do-not-contact action, a prospect whose timing is already established,
     and a repeat inside the lookup cooldown. A stale page that still shows
     the button gets a refusal, not a purchase. */
  async function researchWhyNow(id) {
    var result = await callLeadIntelligence('research_prospect_why_now', {
      opportunityId: id, explicit: true,
    });
    if (result.error || !result.data || result.data.ok !== true) {
      var refusal = await readRefusal(result.error);
      /* "We could not look" is never reported as "there is no news". The
         previous Why Now stays on screen and the founder is told the check
         failed — inferring an empty world from a failed request is the one
         thing this layer must not do. */
      V.leadsUI.whyNowFailed(id, whyNowFailureMessage(refusal),
        refusal ? refusal.retryable !== false : true);
      return;
    }
    V.leadsUI.applyWhyNow(id, result.data.whyNow || null);

    /* A FOUND EVENT CHANGES THE SCRIPT, so the workspace is re-read — the
       same thing findContact already does after a successful find, and for
       the same reason: leaving the pre-event opening on screen beside a Why
       Now that now names an acquisition is the worst of both. The server
       re-applies the event overlay to whatever prose it serves, so this
       re-read is a cache HIT and costs nothing. */
    if (result.data.whyNow && result.data.whyNow.eventDriven === true) {
      loadWorkspace(id, currentRow);
    }
  }

  /* The server's typed reason, turned into something a founder can act on.
     `not_requested`, `recently_looked` and the rest are accurate and mean
     nothing to a person selling. */
  function whyNowFailureMessage(refusal) {
    var reason = refusal && refusal.reason;
    if (reason === 'recently_looked') {
      return 'VISION checked this recently and is reusing that answer rather than buying it twice.';
    }
    if (reason === 'timing_already_established') {
      return 'There is already a current timing signal on file for this prospect.';
    }
    if (reason === 'not_worth_pursuing') {
      return 'VISION does not recommend spending time on this prospect, so it will not research it.';
    }
    if (reason === 'contact_forbidden') {
      return 'VISION does not recommend approaching this prospect, so a reason to act now would not help.';
    }
    if (reason === 'restricted') {
      return 'That research source has refused on legal grounds. VISION will not ask again.';
    }
    if (reason === 'no_searchable_identity') {
      return 'This prospect has no distinctive company name to research.';
    }
    if (refusal && refusal.details) return String(refusal.details);
    return 'Could not check for current signals right now.';
  }

  /* ── CONTACT INTELLIGENCE ─────────────────────────────────────────────
     The ONLY call in this file that can cost money, and the server decides
     whether it does: every eligibility gate is re-run there, so a client
     that fabricates the request is refused rather than obeyed. */
  async function findContact(id) {
    var result = await callLeadIntelligence('enrich_prospect_contact', {
      opportunityId: id, explicit: true,
    });
    if (result.error || !result.data || result.data.ok !== true) {
      var refusal = await readRefusal(result.error);
      V.leadsUI.contactFailed(id, contactFailureMessage(refusal),
        refusal ? refusal.retryable !== false : true);
      return;
    }
    /* THE SERVER ALREADY BUILT THIS. The client used to re-derive its own
       projection here from `selection` — a hand-copy of
       workspace-view-model.js contactProjection that had already drifted
       twice, most recently dropping lastCheckedAt and roleAuthorityKnown, so
       a freshly-enriched card rendered with no age and no authority caveat
       until the page was reloaded. Two mirrored projections is how that keeps
       happening, so there is now one, and it is the server's. */
    V.leadsUI.applyContact(id, result.data.contact || null, result.data.bestContact || null);

    /* A FOUND CONTACT CHANGES THE ADVICE, so the workspace is re-read.
       Until now this prospect was refused with "no contact route has been
       observed, so there is nothing to write a script for yet" — a sentence
       that is simply false the moment a route exists. Leaving it on screen
       next to the contact we just found would be the worst of both.

       This is the one place in the runtime that can cost a model
       generation: contactChannels and the decided action are BOTH in the
       language-cache fingerprint (prospect-language-cache.js), so the prose
       written for `research_contact_route` correctly no longer matches.
       That is not waste — a prospect that had no workspace at all now has
       one, and it has to be written once. It caches afterwards.

       Only on a genuine find: a none_found result changes no advice, so it
       re-reads nothing. */
    if (result.data.bestContact && refusedWorkspaces[id]) {
      delete refusedWorkspaces[id];
      loadWorkspace(id, currentRow);
    }
  }

  /* `details` IS A DIAGNOSTIC CODE, NOT A SENTENCE. This used to be handed
     straight to the founder, so a refused lookup produced a toast reading
     "internal_host" — measured in the real staging browser. The typed error
     is what the client should switch on; the sentence is the client's job.

     Every branch says what happened AND whether it is worth trying again,
     because "could not look right now" next to a button that still works is
     an invitation to spend another credit on the same refusal. */
  var CONTACT_FAILURE_TEXT = {
    no_searchable_domain: 'VISION looks contacts up from a business\u2019s own website domain, and this one has no usable website. There is nothing to search.',
    contact_enrichment_not_available_for_people: 'Contact lookup is for businesses. This is a person who came to you directly.',
    enrichment_not_recommended: 'VISION does not recommend spending a lookup on this prospect yet.',
    contact_research_unavailable: 'VISION could not reach its contact source. Nothing was found and nothing was spent.',
    opportunity_not_found: 'That prospect is no longer available.',
    opportunity_id_required: 'That prospect could not be identified.',
    /* Both of these used to fall through to "could not look right now".
       For the consent refusal that hid the actual reason; for a persistence
       failure it was the opposite of what happened — VISION DID look, and
       did find someone. */
    contact_enrichment_forbidden: 'This prospect declined or withdrew consent, so VISION will not go looking for a way to reach them.',
    contact_persistence_failed: 'VISION found a contact but could not save it. Nothing was lost but the contact — try again shortly.',
  };
  function contactFailureMessage(refusal) {
    if (!refusal || !refusal.error) return 'VISION could not look for a contact right now.';
    if (refusal.error === 'contact_research_unavailable'
      && refusal.providerReason === 'provider_legally_restricted') {
      /* A legal refusal is permanent. Saying "right now" would be a lie that
         costs a credit every time the founder believes it. */
      return 'This domain cannot be searched for contacts for legal reasons. VISION will not ask again.';
    }
    return CONTACT_FAILURE_TEXT[refusal.error] || 'VISION could not look for a contact right now.';
  }

  /* There is deliberately NO projectContact() here any more. The Workspace and
     the enrich response are both projected by workspace-view-model.js on the
     server; a second copy in the browser is what drifted. */

  /* ── DECISIONS ────────────────────────────────────────────────────────
     Save and Dismiss go through the existing `decision` action and then
     refetch, so the board is always the server's answer rather than a local
     guess about what the write did. */
  async function decide(id, decision, reason) {
    var result = await callLeadIntelligence('decision', {
      opportunityId: id, decision: decision, reason: reason || null,
    });
    if (result.error || !result.data || result.data.ok !== true) {
      V.leadsUI.showToast('That did not save. Nothing has changed.');
      return false;
    }
    await loadBoard();
    return true;
  }

  async function boot() {
    if (window.VISION_BOOT && typeof window.VISION_BOOT.watch === 'function') window.VISION_BOOT.watch(15000);
    var app = vision();

    /* The environment guard in js/supabase.js paints its own blocking overlay
       and leaves sb null. Gate on `backend`, never on `sb` alone. */
    if (!app || !app.backend) {
      V.leadsUI.init({ mode: 'runtime', handlers: {} });
      V.leadsUI.renderBoardError('This deployment is not connected to a VISION backend.');
      return;
    }

    /* requireAuth redirects to login itself; the page contract is to stop. */
    var session = await app.auth.requireAuth();
    if (!session) return;

    V.leadsUI.init({
      mode: 'runtime',
      handlers: {
        onOpenLead: loadWorkspace,
        onRetryBoard: loadBoard,
        onRetryWorkspace: function (id) { loadWorkspace(id, currentRow); },
        onFindContact: findContact,
        onResearchWhyNow: researchWhyNow,
        onPracticeLive: practiceLive,
        onCallLive: callLive,
        onSaveLead: function (id) { decide(id, 'approve'); },
        onDismissLead: function (id) {
          /* `reject` requires a reason from a fixed enum and the locked button
             has no picker. 'other' is the honest encoding of "dismissed, no
             reason given" — 'poor_match' would assert a judgement the founder
             never made. */
          decide(id, 'reject', 'other').then(function (okay) {
            if (!okay) return;
            V.leadsUI.showToast('Dismissed.', 'Undo', function () {
              decide(id, 'approve').then(function (restored) {
                if (!restored) V.leadsUI.showToast('That could not be undone.');
              });
            });
          });
        },
      },
    });

    await loadBoard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  V.leadsRuntime = { loadBoard: loadBoard, loadWorkspace: loadWorkspace, callLeadIntelligence: callLeadIntelligence };
})(window.VISION);
