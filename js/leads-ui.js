/* ══════════════════════════════════════════════════════════════════════════
   VISION LEADS — THE RENDERER
   ──────────────────────────────────────────────────────────────────────────
   The ONE renderer. It draws the locked Leads design from a canonical frontend
   view model and knows nothing whatsoever about where that model came from.

   NOT IN THIS FILE, and the absence is the point:
     no fetch, no Supabase, no JWT, no Edge Function, no opportunity_* rows,
     no ranking objects, no signals, no provider objects, no model adapter.

   It is driven by two sources that must agree:
     js/leads-runtime.js   real authenticated data from the server
     js/leads-mock.js      authored fixtures, for design QA only

   One renderer serving both is how we prove the wiring did not quietly
   redesign the product.

   IT ALSO NO LONGER DECIDES ANYTHING. Band, the Next Move, which prospects are
   qualified, pipeline membership and stage grouping were all re-derived in the
   browser and are now supplied. That mattered: `bandOf` used to demote a saved
   lead out of `now`, silently changing what the row meant.
   ══════════════════════════════════════════════════════════════════════════ */
window.VISION = window.VISION || {};

(function (V) {
  'use strict';


  /* ════════════════ 1 · helpers ════════════════ */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function list(items, fn) { return (items || []).map(fn).join(''); }
  function pct(n) { return Math.round(n * 100) + '%'; }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  /* ════════════════ 2 · shared vocabulary ════════════════ */

  /* The B2C lead hierarchy, weakest to strongest. `isLead` is the line the
     product refuses to blur: everything below it is traffic. */
  var HIERARCHY = [
    { key: 'anonymous', label: 'Anonymous visitor', isLead: false, note: 'Seen. Not identified. Not a lead.' },
    { key: 'engaged',   label: 'Engaged visitor',   isLead: false, note: 'Returned or went deep. Still not identified.' },
    { key: 'lead',      label: 'Lead',              isLead: true,  note: 'Identified themselves and gave consent.' },
    { key: 'qualified', label: 'Qualified lead',    isLead: true,  note: 'Identified, and fits who we can actually help.' },
    { key: 'hot',       label: 'Hot lead',          isLead: true,  note: 'Qualified, and acting right now.' },
    { key: 'customer',  label: 'Customer',          isLead: true,  note: 'Bought.' }
  ];
  var HIER = {};
  HIERARCHY.forEach(function (h) { HIER[h.key] = h; });

  var BANDS = [
    { key: 'now',    label: 'Priority now',        note: 'Time-sensitive. Something is happening today.' },
    { key: 'strong', label: 'Strong opportunities', note: 'Worth real effort this week.' },
    { key: 'watch',  label: 'Watch',                note: 'Real, but nothing has changed yet.' },
    { key: 'no',     label: 'Not worth time',       note: 'VISION recommends leaving these alone, and why.' }
  ];

  var STAGES = [
    { key: 'new',          label: 'New' },
    { key: 'contacted',    label: 'Contacted' },
    { key: 'conversation', label: 'In conversation' },
    { key: 'proposal',     label: 'Proposal out' },
    { key: 'won',          label: 'Won' },
    { key: 'lost',         label: 'Lost' }
  ];

  var CHANNELS = [
    { key: 'call',  label: 'Call' },
    { key: 'email', label: 'Email' },
    { key: 'sms',   label: 'SMS' },
    { key: 'dm',    label: 'DM' }
  ];

  /* ════════════════ UI STATE ════════════════
     Presentation only. Everything the server owns — saved, dismissed, stage,
     band, qualification — lives on the row it came from. */
  var ui = {
    mode: 'runtime',        // 'runtime' | 'fixture'
    board: emptyBoard(),
    workspace: null,        // the open prospect's full view model
    tab: 'qualified',
    query: '',              // Qualified filter text
    searchQuery: '',        // Discover search box text (never written to data)
    campaignFilter: null,
    open: null,             // open prospect id; also the close idempotency latch
    wsOpener: null,
    practiceOpener: null,
    channel: 'call',
    outreachEdits: {},
    contactBusy: false,
    whyNowBusy: false,
    practice: null,
    handlers: {},
  };

  function emptyBoard() {
    return {
      venture: '', ventureSub: '', headline: '', sub: '',
      funnel: [], funnelNote: '', nextMove: null, leads: [],
      tabs: { discover: [], qualified: [], pipeline: [] },
      discovery: { providerConnected: false }, campaigns: [],
      interpreted: null, searchPlaceholder: '', lastQuery: '', mode: 'outbound',
    };
  }

  /* Returns whether a handler was actually registered, so a caller can tell
     "nobody is listening" from "it ran" — the practice seam needs that
     distinction to avoid a button that appears to work and does nothing. */
  function emit(name) {
    var fn = ui.handlers[name];
    if (typeof fn !== 'function') return false;
    try { fn.apply(null, [].slice.call(arguments, 1)); return true; }
    catch (error) { showToast('Something went wrong. Try again.'); return true; }
  }

  /* ── ROW LOOKUPS. The board is the index; there is no second store. ── */
  function rowById(id) {
    var rows = ui.board.leads || [];
    for (var i = 0; i < rows.length; i += 1) if (rows[i].id === id) return rows[i];
    return null;
  }
  function rowsFor(surface) {
    var ids = (ui.board.tabs && ui.board.tabs[surface]) || [];
    return ids.map(rowById).filter(Boolean);
  }
  /* Client-side narrowing of already-loaded rows is fine; deciding which rows
     exist is not. */
  function filterRows(rows) {
    return rows.filter(function (row) {
      if (ui.campaignFilter && (!row.source || row.source.campaign !== ui.campaignFilter)) return false;
      if (!ui.query) return true;
      var hay = [row.name, row.sub, row.thesis, row.industry].filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(ui.query.toLowerCase()) !== -1;
    });
  }


  /* ════════════════ 5 · shared render pieces ════════════════ */

  function tempChip(lead) {
    var h = HIER[lead.temp];
    if (!h) return '';
    return '<span class="chip t-' + esc(lead.temp) + '">' + esc(h.label) + '</span>';
  }
  function gradeChip(lead) {
    if (!lead.grade) return '';
    var cls = lead.grade === 'A+' ? 'g-ap' : lead.grade === 'A' ? 'g-a' : 'g-b';
    return '<span class="grade ' + cls + '">' + esc(lead.grade) + '</span>';
  }
  function confidenceBar(lead) {
    return '<div class="conf">' +
      '<div class="conf-top"><span class="eyebrow">Confidence</span><b>' + pct(lead.confidence) + '</b></div>' +
      '<div class="conf-track"><i style="width:' + pct(lead.confidence) + '"></i></div>' +
      '<p class="conf-note">' + esc(lead.confidenceNote) + '</p>' +
      '</div>';
  }

  function evidenceBlock(ev, opts) {
    if (!ev) return '';
    var compact = opts && opts.compact;
    var shown = compact ? (ev.observed || []).slice(0, 3) : (ev.observed || []);
    /* A TIER WITH NOTHING IN IT PRINTS NOTHING. "UNKNOWN" was rendering as a
       bare heading over empty space whenever importantUnknowns was empty,
       which reads as a broken panel rather than as "nothing to report" — and
       on this prospect the real unknowns live in weaknesses, so the heading
       was not merely empty, it was misleading about what VISION knows. */
    var tier = function (cls, label, items) {
      var rows = items || [];
      if (!rows.length) return '';
      return '<div class="ev-tier ' + cls + '"><span class="eyebrow">' + label + '</span><ul>' +
        list(rows, function (line) { return '<li>' + esc(line) + '</li>'; }) + '</ul></div>';
    };
    var html = '<div class="ev">' + tier('ev-observed', 'Observed', shown);
    if (!compact) {
      html += tier('ev-inferred', 'Inferred', ev.inferred);
      html += tier('ev-unknown', 'Unknown', ev.unknown);
    }
    html += '</div>';
    return html;
  }

  /* ════════════════ 6 · board — header, funnel, priority ════════════════ */

  function renderHead() {
    var f = ui.board;
    el('ventureName').textContent = f.venture || '';
    el('ventureSub').textContent = f.ventureSub || '';
    el('lhTitle').textContent = f.headline || '';
    el('lhSub').textContent = f.sub || '';

    var funnelEl = el('funnel');
    if (!f.funnel || !f.funnel.length) { funnelEl.innerHTML = ''; return; }
    /* THE LEAD LINE IS DERIVED, NOT AUTHORED. The fixtures carried a
       `leadLineAfter` index; the server marks `isLead` per band instead. The
       edge is drawn after the last non-lead band, so both sources agree
       without the adapter having to synthesise an index. */
    var lastBelow = -1;
    f.funnel.forEach(function (s, i) { if (!s.isLead) lastBelow = i; });
    var cells = f.funnel.map(function (s, i) {
      var afterLine = i === lastBelow;
      return '<div class="fn-cell' + (s.isLead ? ' is-lead' : ' not-lead') + (afterLine ? ' fn-edge' : '') + '">' +
        '<b>' + esc(num(s.value)) + '</b><span>' + esc(s.label) + '</span></div>';
    }).join('');
    funnelEl.innerHTML = '<div class="fn-row">' + cells + '</div>' +
      (f.funnelNote ? '<p class="fn-note">' + esc(f.funnelNote) + '</p>' : '');
  }

  function renderPriority() {
    var host = el('priority');
    /* SERVER-CHOSEN. `priorityLead()` re-derived this in the browser from
       band + dismissed state; the board now names it. */
    var lead = ui.board.nextMove ? rowById(ui.board.nextMove.leadId) : null;
    if (!lead) { host.innerHTML = ''; host.hidden = true; return; }
    host.hidden = false;
    /* WHO, WHY, WHAT and WHAT TO SAY must all land in the first couple of
       seconds. The first three were here; the opening line was only in the
       workspace, one click away, which left the board answering three of the
       four questions the page exists to answer. */
    /* THE BOARD SHIPS NO WORKSPACE. leads-board.js deletes `ws` from every row
       ("would triple the payload"), so reading lead.ws.say.opening here
       evaluated to '' against real data and silently removed the one line that
       makes the board answer WHAT TO SAY. `openerPreview` is the field the
       server supplies for exactly this; the fixture path still works because
       the adapter fills it too. */
    var opener = lead.openerPreview || (lead.ws && lead.ws.say ? lead.ws.say.opening : '');
    host.innerHTML =
      '<div class="pri">' +
        '<div class="pri-main">' +
          '<p class="eyebrow">Next move · ' + esc(lead.next.urgency) + '</p>' +
          '<h2 class="pri-action">' + esc(lead.next.action) + '</h2>' +
          '<p class="pri-why">' + esc(lead.next.why) + '</p>' +
          (opener ? '<p class="pri-say"><span class="eyebrow">Open with</span>' + esc(opener) + '</p>' : '') +
        '</div>' +
        '<div class="pri-side">' +
          '<div class="pri-who">' + gradeChip(lead) + tempChip(lead) +
            '<b>' + esc(lead.name) + '</b><span>' + esc(lead.sub || '') + '</span>' +
            '<span class="pri-age">' + esc(lead.age) + '</span></div>' +
          '<button class="btn btn-primary" type="button" data-open="' + esc(lead.id) + '">Open prospect</button>' +
        '</div>' +
      '</div>';
  }

  /* ════════════════ 7 · board — DISCOVER ════════════════ */

  function renderDiscover() {
    var f = ui.board;
    var host = el('panelDiscover');

    if (f.mode === 'inbound') { host.innerHTML = renderInbound(f); return; }

    if (!f.leads.length) {
      host.innerHTML = searchBar(f) +
        emptyState('No sweep has been run',
          'Describe the kind of business you want to find and VISION will show you what it understood before it goes looking. Nothing is searched until you can see the filters.');
      return;
    }

    var results = rowsFor('discover');
    var html = searchBar(f);
    html += f.interpreted ? interpretedBlock(f.interpreted) : '';
    html += '<div class="sec-head"><p class="eyebrow">Opportunities · ' + results.length + ' open</p>' +
      '<p class="sec-note">Saved results move to Qualified. Dismissed ones stop being surfaced.</p></div>';
    if (!results.length) {
      html += emptyState('Everything from this sweep has been handled',
        'Every result has been saved or dismissed. Run another sweep when you want more.');
    } else {
      html += '<div class="cards">' + results.map(discoverCard).join('') + '</div>';
    }
    host.innerHTML = html;
  }

  function searchBar(f) {
    return '<form class="search" id="searchForm" role="search">' +
      '<label class="sr-only" for="searchInput">Describe the businesses to find</label>' +
      '<input id="searchInput" class="search-in" type="search" autocomplete="off" ' +
        'placeholder="' + esc(f.searchPlaceholder) + '" value="' + esc(f.lastQuery) + '">' +
      '<button class="btn btn-sec btn-sm" type="submit">Search</button>' +
      '</form>';
  }

  function interpretedBlock(i) {
    return '<div class="interp">' +
      '<p class="eyebrow">What VISION understood</p>' +
      '<div class="interp-grid">' +
        '<div><span>Industry</span><b>' + esc(i.industry) + '</b></div>' +
        '<div><span>Location</span><b>' + esc(i.location) + '</b></div>' +
      '</div>' +
      '<ul class="interp-sig">' + list(i.signals, function (s) {
        return '<li><span>' + esc(s.label) + '</span> ' + esc(s.op) + ' <b>' + esc(s.value) + '</b></li>';
      }) + '</ul>' +
      list(i.excluded, function (x) { return '<p class="interp-x">' + esc(x) + '</p>'; }) +
      '<p class="interp-note">' + esc(i.note) + '</p>' +
      '</div>';
  }

  function discoverCard(lead) {
    return '<article class="card" data-lead="' + esc(lead.id) + '">' +
      '<header class="card-top">' +
        '<div class="card-id"><h3>' + esc(lead.name) + '</h3><p>' + esc(lead.sub) + '</p></div>' +
        gradeChip(lead) +
      '</header>' +
      '<p class="card-thesis">' + esc(lead.thesis) + '</p>' +
      /* COMPACT AND FULL ARE ALTERNATIVES, NOT LAYERS. Rendering the compact
         block above the expanded one printed the first three OBSERVED lines
         twice — measured on a real staging prospect card, all three repeated
         verbatim a few pixels apart. Expanding swaps them. */
      '<div class="card-compact" data-compact="' + esc(lead.id) + '">' +
        evidenceBlock(lead.evidence, { compact: true }) +
      '</div>' +
      '<button class="expand" type="button" data-expand="' + esc(lead.id) + '" aria-expanded="false">' +
        '<span>Expand evidence</span>' +
        '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="card-full" data-full="' + esc(lead.id) + '" hidden>' +
        evidenceBlock(lead.evidence) + confidenceBar(lead) +
      '</div>' +
      '<footer class="card-acts">' +
        '<button class="btn btn-sec btn-sm" type="button" data-open="' + esc(lead.id) + '">Review prospect</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-save="' + esc(lead.id) + '">Save</button>' +
        '<button class="btn btn-quiet btn-sm" type="button" data-dismiss="' + esc(lead.id) + '">Dismiss</button>' +
      '</footer>' +
    '</article>';
  }

  /* Inbound has no search — leads arrive. The campaign is the source. */
  function renderInbound(f) {
    var html = '<div class="sec-head"><p class="eyebrow">Where these leads came from</p>' +
      '<p class="sec-note">Inbound is not searched. This is the campaign that produced the pipeline.</p></div>';
    html += f.campaigns.map(campaignCard).join('');
    html += '<div class="future">' +
      '<p class="eyebrow">Not built here</p>' +
      '<p>' + esc(f.campaigns[0] ? f.campaigns[0].futureNote : '') + '</p>' +
      '<div class="chain"><span>VISION Maker</span><i>→</i><span>Ads Manager</span><i>→</i><span class="on">Leads</span><i>→</i><span class="on">Prospect Workspace</span></div>' +
      '</div>';
    return html;
  }

  function campaignCard(c) {
    return '<article class="camp">' +
      '<header class="camp-top">' +
        '<div><p class="eyebrow">' + esc(c.platform) + ' campaign</p><h3>' + esc(c.name) + '</h3></div>' +
        '<span class="camp-status">' + esc(c.status) + '</span>' +
      '</header>' +
      '<div class="camp-stats">' + list(c.stats, function (s) {
        return '<div><b>' + esc(s.value) + '</b><span>' + esc(s.label) + '</span></div>';
      }) + '</div>' +
      '<div class="noticed">' +
        '<p class="eyebrow">VISION noticed</p>' +
        '<p class="noticed-line">' + esc(c.noticed) + '</p>' +
        '<p class="noticed-detail">' + esc(c.noticedDetail) + '</p>' +
      '</div>' +
      evidenceBlock(c.evidence) +
      '<footer class="card-acts">' +
        /* Deliberately not "See the 67 enquiries". The fixture carries four
           named people, and a button that promises 67 rows and delivers four
           is the kind of small lie this page exists to argue against. */
        '<button class="btn btn-sec btn-sm" type="button" data-campaign="' + esc(c.id) + '">Open the leads this campaign produced</button>' +
      '</footer>' +
    '</article>';
  }

  /* ════════════════ 8 · board — QUALIFIED ════════════════ */

  function renderQualified() {
    var host = el('panelQualified');
    var f = ui.board;

    if (!f.leads.length) {
      host.innerHTML = emptyState('No leads yet',
        'When a sweep saves a prospect, or a campaign produces an enquiry, it lands here — sorted by what deserves your time today rather than by when it arrived.');
      return;
    }

    var leads = filterRows(rowsFor('qualified'));
    var html = '';

    html += '<div class="filters">' +
      '<label class="sr-only" for="qFilter">Filter leads</label>' +
      '<input id="qFilter" class="search-in" type="search" autocomplete="off" placeholder="Filter by name, thesis or industry" value="' + esc(ui.query) + '">';
    if (ui.campaignFilter) {
      var camp = (f.campaigns || []).filter(function (c) { return c.id === ui.campaignFilter; })[0];
      html += '<button class="filter-chip" type="button" data-clear-campaign="1">' +
        esc(camp ? camp.name : 'Campaign') + ' <i aria-hidden="true">×</i>' +
        '<span class="sr-only">Clear campaign filter</span></button>';
    }
    html += '</div>';

    if (!leads.length) {
      html += emptyState('Nothing matches that', 'Clear the filter to see the full set.');
      host.innerHTML = html;
      return;
    }

    BANDS.forEach(function (band) {
      /* `band` comes from the server. bandOf() re-derived it and, worse,
         demoted a saved lead out of `now` — changing what the row meant. */
      var inBand = leads.filter(function (l) { return l.band === band.key; });
      if (!inBand.length) return;
      html += '<section class="band band-' + band.key + '">' +
        '<div class="band-head"><p class="eyebrow">' + esc(band.label) + ' · ' + inBand.length + '</p>' +
        '<p class="band-note">' + esc(band.note) + '</p></div>' +
        '<div class="rows">' + inBand.map(leadRow).join('') + '</div>' +
        '</section>';
    });

    host.innerHTML = html;
  }

  function leadRow(lead) {
    var actionable = lead.next && lead.next.channel !== 'none';
    /* `data-open` on the row makes the whole row a mouse target — clicking a
       lead is what people try first. The row stays a plain <article> rather
       than becoming a button or getting a tabindex: the Open button inside it
       is already the keyboard path, and promoting the row too would add a
       second tab stop to every lead that does exactly the same thing. */
    return '<article class="row row-' + esc(lead.band || 'watch') + '" data-lead="' + esc(lead.id) + '"' +
      ' data-open="' + esc(lead.id) + '">' +
      '<div class="row-id">' +
        '<div class="row-name">' + gradeChip(lead) + '<h3>' + esc(lead.name) + '</h3></div>' +
        '<p class="row-sub">' + esc(lead.sub || '') + '</p>' +
        '<div class="row-chips">' + tempChip(lead) +
          (lead.saved ? '<span class="chip c-saved">Saved</span>' : '') +
          '<span class="chip c-age">' + esc(lead.age) + '</span></div>' +
      '</div>' +
      '<div class="row-why">' +
        '<p class="eyebrow">Why VISION likes it</p>' +
        '<p class="row-thesis">' + esc(lead.thesis) + '</p>' +
        '<p class="row-src">' + esc(lead.source ? lead.source.label : '') + '</p>' +
      '</div>' +
      '<div class="row-next">' +
        '<p class="eyebrow">What to do next</p>' +
        '<p class="row-action' + (actionable ? '' : ' is-off') + '">' + esc(lead.next.action) + '</p>' +
        '<p class="row-urg">' + esc(lead.next.urgency) + '</p>' +
        '<button class="btn btn-sec btn-sm" type="button" data-open="' + esc(lead.id) + '">Open</button>' +
      '</div>' +
    '</article>';
  }

  /* ════════════════ 9 · board — PIPELINE ════════════════ */

  function renderPipeline() {
    var host = el('panelPipeline');
    var f = ui.board;
    if (!f.leads.length) {
      host.innerHTML = emptyState('Nothing in the pipeline',
        'A prospect enters the pipeline the moment you contact them. Until then there is nothing to track.');
      return;
    }
    var live = rowsFor('pipeline');
    var html = '<div class="pipe">' + STAGES.map(function (s) {
      var inStage = live.filter(function (l) { return (l.stage || 'new') === s.key; });
      return '<section class="pipe-col" data-stage="' + esc(s.key) + '">' +
        '<header class="pipe-head"><span class="eyebrow">' + esc(s.label) + '</span><b>' + inStage.length + '</b></header>' +
        (inStage.length
          ? inStage.map(pipeCard).join('')
          : '<p class="pipe-empty">—</p>') +
        '</section>';
    }).join('') + '</div>';
    html += '<p class="pipe-note">Stage is set from inside a prospect, not dragged around here. The stage a prospect is in should be a consequence of what happened, not of where a card was dropped.</p>';
    host.innerHTML = html;
  }

  function pipeCard(lead) {
    return '<button class="pipe-card" type="button" data-open="' + esc(lead.id) + '">' +
      '<span class="pipe-name">' + esc(lead.name) + '</span>' +
      '<span class="pipe-sub">' + esc(lead.next.action) + '</span>' +
      '<span class="pipe-chips">' + gradeChip(lead) + tempChip(lead) + '</span>' +
      '</button>';
  }

  function emptyState(title, body) {
    return '<div class="empty"><h3>' + esc(title) + '</h3><p>' + esc(body) + '</p></div>';
  }

  /* ════════════════ 10 · PROSPECT WORKSPACE ════════════════ */

  /* FOUR SECTIONS, IN THE ORDER A FOUNDER WORKS. The old ten ran research
     first and buried the script in the middle, with the opening line printed
     twice — once under Next best action and again under What to say. */
  var WS_SECTIONS = [
    { id: 'ws-say', label: 'What to say' },
    { id: 'ws-biz', label: 'Business information' },
    { id: 'ws-assess', label: 'Pitch assessment' },
    { id: 'ws-prep', label: 'Prepare & practice' }
  ];

  /* ── PITCH ASSESSMENT ────────────────────────────────────────────────
     "Strengths and weaknesses" was the wrong frame: every "weakness" VISION
     had was really an UNKNOWN, and printing it as a weakness turned "we have
     not established whether they want to grow" into "they do not want to
     grow". Nothing here is derived or inferred — both lists are existing
     view-model fields, relabelled and separated, and the unknown column stays
     explicitly unknown. */
  function pitchAssessment(lead) {
    var w = lead.ws || {};
    var ev = lead.evidence || {};
    var could = [];
    var might = [];
    var seen = {};
    var add = function (arr, t, k) {
      var key = String(t || '').trim().toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = 1; arr.push({ t: t, k: k });
    };

    /* THE INTELLIGENCE'S OWN SELECTION, not the raw evidence log. Listing
       every OBSERVED fact buried the two that matter — 411 reviews at five
       stars, and a Sydney dental match — under "is listed as currently
       operating" and "the listed address matches 1 of 2 location terms".
       Those establish that the prospect is real and reachable; they are not
       reasons a pitch lands. `strengths` is the already-selected list. */
    (w.strengths || []).forEach(function (x) { add(could, x, 'observed'); });
    if (lead.bestContact && lead.bestContact.value) {
      add(could, 'There is a usable contact route'
        + (lead.bestContact.role ? ' (' + lead.bestContact.role + ')' : '') + '.', 'contact');
    }
    if (lead.whyNow && lead.whyNow.eventDriven && lead.whyNow.what) {
      add(could, lead.whyNow.what, 'timing');
    }
    /* `fit` is a paragraph and it already has its own subsection under
       Business information. Repeating it here was the duplication this
       restructure exists to remove. */

    /* UNKNOWNS, SAID AS UNKNOWNS. Never "they have no budget" — only "budget
       is not established". A founder who cannot tell the difference will
       assert one on a call.

       `weaknesses` is read FIRST and is the real source: on live data it holds
       the four that matter — which channels bring patients, whether there is
       capacity, whether a provider already has it, who decides — every one
       already phrased as "it is not yet known". They were being dropped on the
       floor while this column showed only the two lines synthesised below. */
    (w.weaknesses || []).forEach(function (x) { add(might, x, 'unknown'); });
    (ev.unknown || []).forEach(function (u) { add(might, u, 'unknown'); });
    if (!lead.whyNow || lead.whyNow.eventDriven !== true) {
      add(might, 'No verified timing event — nothing establishes that now is better than next month.', 'unknown');
    }
    if (!lead.bestContact || !lead.bestContact.value) {
      add(might, 'No contact route has been found yet, so who you reach is not established.', 'unknown');
    }
    return { could: could, might: might };
  }

  /* ── THE PRACTICE SEAM ───────────────────────────────────────────────
     Live Intelligence is NOT built. What exists here is the handoff it will
     need, assembled from the workspace the founder is looking at, so the
     button is wired to a real payload rather than to a placeholder that would
     have to be rebuilt. Nothing is sent anywhere. */
  function practiceHandoff(lead) {
    var w = lead.ws || {};
    var say = w.say || {};
    var phase = function (re) {
      var hit = (w.callStructure || []).filter(function (c) { return re.test(c.phase || ''); })[0];
      return hit ? hit.note : null;
    };
    return {
      prospectId: lead.id,
      prospect: { name: lead.name, sub: lead.sub, industry: lead.industry, location: lead.location },
      /* WHAT THE FOUNDER IS SELLING, AND FOR HOW MUCH. The handoff described
         the prospect in full and the offer not at all, so the single most
         common real question -- "how much is it?" -- was unrehearsable: the
         founder had no answer on screen and the practice partner had no price
         to push back on. Verbatim and trusted-only, exactly as the workspace
         received it; null when the founder has not established it, never
         substituted. */
      offer: w.offer
        ? { what: w.offer.what || null, pricing: w.offer.pricing || null }
        : null,
      /* CARRIED, NOT PREDICTED. The practice partner decides who answers;
         this is only the founder's preparation for the branch where it is
         not the buyer, and it travels with the buyer script rather than
         instead of it. Nothing here tells Practice which role to play. */
      gatekeeper: w.gatekeeper || null,
      script: {
        opening: say.opening || null,
        firstQuestion: say.firstQuestion || null,
        discovery: (say.discovery || []).slice(),
        pitchBridge: phase(/bridge/i),
        close: phase(/close/i),
        dontSay: (say.dontSay || []).slice(),
        /* The founder's OWN edits when they have made any — practising the
           VISION script when they have rewritten it would be practising the
           wrong call. */
        edited: outreachText(lead, ui.channel) || null,
      },
      evidence: lead.evidence || null,
      contactRole: lead.bestContact
        ? { role: lead.bestContact.role || null, kind: lead.bestContact.kind || null,
            authorityKnown: lead.bestContact.roleAuthorityKnown === true }
        : null,
      whyNow: lead.whyNow || null,
      /* THE SAME UNKNOWNS THE PITCH ASSESSMENT SHOWS. This read only
         evidence.unknown, which is empty on live data — the real open
         questions ("it is not yet known whether the clinic has capacity")
         live in `weaknesses`. So the practice panel's single most useful
         guardrail, the list of things the founder must NOT assert, arrived
         empty on exactly the prospects that have them. Derived through
         pitchAssessment so the Workspace and the practice partner can never
         disagree about what is still unknown. */
      unknowns: pitchAssessment(lead).might
        .filter(function (x) { return x.k === 'unknown'; })
        .map(function (x) { return x.t; }),
      objections: (w.objections || []).map(function (x) { return { q: x.q, why: x.why, response: x.response }; }),
      desiredClose: { action: lead.next && lead.next.action, note: phase(/close/i) },
    };
  }

  function openWorkspace(id, fromHistory) {
    var row = rowById(id);
    /* Remembered only on the first open, so switching prospects inside the
       workspace still returns to the row the founder originally came from. */
    if (!ui.open && !fromHistory) ui.wsOpener = document.activeElement;
    ui.open = id;
    ui.channel = 'call';
    ui.workspace = null;
    document.body.setAttribute('data-view', 'workspace');
    el('ws').hidden = false;
    window.scrollTo(0, 0);
    /* THE RENDERER DOES NOT FETCH. It shows the shell immediately — nobody
       should sit on the board wondering whether their click registered — and
       asks the host for the file. The host answers with renderWorkspace(),
       renderWorkspaceRefused() or renderWorkspaceError(). */
    API.renderWorkspaceLoading(row);
    emit('onOpenLead', id, row);
    if (!fromHistory) {
      /* EXACTLY ONE workspace entry ever sits above the board entry, so Back —
         the device one and the one in the bar — always means "back to the
         leads" rather than "back to the prospect I looked at before".

         THE DECISION READS `history.state`, NOT `ui.open`. Keying it on the
         app's own open flag was measured wrong: closing calls history.back(),
         which resolves on a later task, so a prospect opened before that
         popstate landed saw `ui.open === null`, pushed a second entry, and
         the stack grew one entry per open/close pair. Asking the history stack
         what is actually on top is true whether or not a close is in flight —
         if the top entry is already ours we replace it, and we push only when
         the top entry is the board. */
      try {
        var entry = { vlead: id };
        var url = '#prospect-' + id;
        if (history.state && history.state.vlead) history.replaceState(entry, '', url);
        else history.pushState(entry, '', url);
      } catch (e) {}
    }
  }

  function closeWorkspace(fromHistory) {
    /* A SECOND CLOSE WHILE THE FIRST IS STILL RESOLVING MUST DO NOTHING.
       history.back() completes on a later task, so a double-click on the back
       control — ordinary impatience, and very easy on a phone — used to run
       this twice while `history.state` still held the prospect entry both
       times. Two back() calls popped past the board and left the Leads page
       entirely, landing the founder on the site root. Reproduced by
       double-clicking the control: the document title changed out from under
       the app. The first close clears `ui.open`, so this guard is what
       makes the second one a no-op. */
    if (!ui.open) return;
    ui.open = null;
    ui.workspace = null;
    ui.practice = null;
    el('ws').hidden = true;
    el('practice').hidden = true;
    document.body.setAttribute('data-view', 'board');
    if (!fromHistory) {
      try {
        if (history.state && history.state.vlead) history.back();
        else history.replaceState(null, '', location.pathname);
      } catch (e) {}
    }
    renderBoard();
    /* renderBoard() replaces the rows, so the remembered element is usually
       detached by now — fall back to the equivalent control on the rebuilt
       board rather than dropping focus to the top of the document. */
    var back = ui.wsOpener;
    ui.wsOpener = null;
    var target = back && document.contains(back) ? back : null;
    if (!target && back) {
      var openerId = back.getAttribute && back.getAttribute('data-open');
      /* The lead's own row first, then anything else pointing at that lead.
         Separate queries, not a selector list: a list resolves in document
         order, which put focus on the Next Move block's button instead of the
         row the founder actually came from. */
      if (openerId) {
        target = document.querySelector('.row[data-open="' + openerId + '"] .btn')
          || document.querySelector('[data-open="' + openerId + '"]');
      }
    }
    if (target && target.focus) target.focus();
  }

  function renderWorkspace() {
    var lead = ui.workspace;
    if (!lead) return;
    var w = lead.ws;

    var head =
      '<div class="ws-bar">' +
        '<button class="ws-back" id="wsBack" type="button">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>' +
          '<span>Leads</span>' +
        '</button>' +
        '<div class="ws-bar-right">' +
          '<label class="sr-only" for="stageSel">Lead status</label>' +
          '<select id="stageSel" class="stage-sel">' + STAGES.map(function (s) {
            return '<option value="' + esc(s.key) + '"' + ((lead.stage || 'new') === s.key ? ' selected' : '') + '>' + esc(s.label) + '</option>';
          }).join('') + '</select>' +
        '</div>' +
      '</div>';

    var command =
      '<header class="ws-head">' +
        '<div class="ws-idline">' + gradeChip(lead) + tempChip(lead) +
          '<span class="chip c-age">' + esc(lead.age) + '</span></div>' +
        '<h1 class="ws-name">' + esc(lead.name) + '</h1>' +
        '<p class="ws-sub">' + esc(lead.sub || '') + '</p>' +
        '<p class="ws-thesis">' + esc(lead.thesis) + '</p>' +
      '</header>';

    /* TOP SUMMARY — who, how urgent, what next, who to call, and the two
       one-line reasons. The opening line USED to be repeated here and again
       in What to say; it is now only in What to say, and this offers a jump
       to it instead. */
    var summary =
      '<section class="nba' + (lead.next.channel === 'none' ? ' nba-off' : '') + '">' +
        '<p class="eyebrow">Next best action' + (lead.next.channel === 'none' ? '' : ' · ' + esc(lead.next.urgency)) + '</p>' +
        '<h2 class="nba-action">' + esc(lead.next.action) + '</h2>' +
        '<p class="nba-why">' + esc(lead.next.why) + '</p>' +
        (w ? '<div class="nba-acts">' +
          '<button class="btn btn-primary" type="button" data-jump="ws-say">What to say</button>' +
          '<button class="btn btn-sec" type="button" data-jump="ws-prep">Prepare &amp; practice</button>' +
        '</div>' : '') +
      '</section>' +
      /* Contact and Why Now live HERE now rather than in the rail. Both keep
         their data-rail hooks, so redrawContact() and redrawWhyNow() repaint
         them in place exactly as before — those functions query by attribute,
         not by position. */
      '<div class="ws-sum-cards">' + contactBlock(lead) + whyNowBlock(lead) + '</div>';

    var body;
    if (!w) {
      body = '<div class="ws-cols"><div class="ws-main">' +
        '<section class="ws-sec"><p class="eyebrow">No prospect file</p>' +
        '<p class="ws-p">' + esc(lead.wsNote || '') + '</p></section>' +
        '<section class="ws-sec" id="ws-ev"><p class="eyebrow">What is known</p>' + evidenceBlock(lead.evidence) + '</section>' +
        '</div>' + wsRail(lead, true) + '</div>';
    } else {
      var assess = pitchAssessment(lead);
      var phaseNote = function (re) {
        var hit = (w.callStructure || []).filter(function (c) { return re.test(c.phase || ''); })[0];
        return hit ? hit.note : null;
      };
      var bridge = phaseNote(/bridge/i);
      var close = phaseNote(/close/i);

      body = '<div class="ws-cols"><div class="ws-main">' +
        '<nav class="ws-jump ws-jump-sticky" aria-label="Workspace sections">' + WS_SECTIONS.map(function (sec, i) {
          return '<button type="button" class="ws-jump-b' + (i === 0 ? ' on' : '') + '" ' +
            'data-jump="' + esc(sec.id) + '" data-spy="' + esc(sec.id) + '">' + esc(sec.label) + '</button>';
        }).join('') + '</nav>' +

        /* ── 1 · WHAT TO SAY — the execution section, and the ONLY place any
           of the call lives. ─────────────────────────────────────────── */
        '<section class="ws-sec ws-sec-primary" id="ws-say">' +
          '<p class="eyebrow">What to say</p>' +
          '<div class="say">' +
            '<div class="say-b"><span class="eyebrow">Opening</span><p>' + esc(w.say.opening) + '</p></div>' +
            '<div class="say-b say-q"><span class="eyebrow">First question</span><p>' + esc(w.say.firstQuestion) + '</p></div>' +
          '</div>' +
          '<div class="say-list"><span class="eyebrow">Then ask</span><ol>' +
            list(w.say.discovery.filter(function (q) { return q !== w.say.firstQuestion; }),
              function (q) { return '<li>' + esc(q) + '</li>'; }) + '</ol></div>' +
          (bridge ? '<div class="say-b say-bridge"><span class="eyebrow">Pitch bridge &mdash; only once they say it is a problem</span>' +
            '<p>' + esc(bridge) + '</p></div>' : '') +
          '<details class="say-objs ws-d"><summary>If they push back' +
            '<span class="d-count">' + w.objections.length + '</span></summary>' +
            '<div class="objs">' + w.objections.map(function (ob, i) {
              return '<div class="obj" data-obj="' + i + '">' +
                '<button class="obj-h" type="button" data-obj-toggle="' + i + '" aria-expanded="false">' +
                  '<span class="obj-q">' + esc(ob.q) + '</span>' +
                  '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
                '</button>' +
                '<div class="obj-b" hidden>' +
                  '<p class="obj-why"><span class="eyebrow">Why they say it</span>' + esc(ob.why) + '</p>' +
                  '<p class="obj-r"><span class="eyebrow">Best response</span>' + esc(ob.response) + '</p>' +
                '</div></div>';
            }).join('') + '</div></details>' +
          (close ? '<div class="say-b say-close"><span class="eyebrow">Close &mdash; what you are asking for</span>' +
            '<p>' + esc(close) + '</p></div>' : '') +
          '<details class="dont ws-d"><summary>Do not say' +
            '<span class="d-count">' + (w.say.dontSay || []).length + '</span></summary><ul>' +
            list(w.say.dontSay, function (d) { return '<li>' + esc(d) + '</li>'; }) + '</ul></details>' +
          /* ── THE OTHER CONVERSATION ────────────────────────────────────
             Everything above prepares the call with the buyer. This prepares
             the one where somebody else picks up, and it is COLLAPSED and
             SECONDARY on purpose: it is a branch the founder may not need,
             not a forecast that they will. Rendered whenever a plan exists,
             never conditionally on who is about to answer -- the workspace
             does not know, and showing it only sometimes would leak exactly
             the thing Practice keeps hidden. */
          (w.gatekeeper ? '<details class="gk ws-d"><summary>If someone who cannot decide answers' +
            '<span class="d-count">alt</span></summary>' +
            '<p class="gk-applies">' + esc(w.gatekeeper.applies) + '</p>' +
            '<div class="say-b"><span class="eyebrow">Aim</span><p>' + esc(w.gatekeeper.aim) + '</p></div>' +
            '<div class="say-b"><span class="eyebrow">Open with</span><p>' + esc(w.gatekeeper.open) + '</p></div>' +
            '<div class="say-b"><span class="eyebrow">If they ask what it is about</span><p>'
              + esc(w.gatekeeper.ifAsked) + '</p></div>' +
            '<div class="say-b"><span class="eyebrow">If they will not put you through</span><p>'
              + esc(w.gatekeeper.ifRefused) + '</p></div>' +
            '<div class="say-b"><span class="eyebrow">Leave with</span><p>' + esc(w.gatekeeper.leaveWith) + '</p></div>' +
            '<ul class="gk-dont">' + list(w.gatekeeper.dontSay, function (d) { return '<li>' + esc(d) + '</li>'; })
            + '</ul></details>' : '') +
        '</section>' +

        /* ── 2 · BUSINESS INFORMATION — the research, collapsed by default
           so it is available without being in the way. ────────────────── */
        '<section class="ws-sec" id="ws-biz">' +
          '<p class="eyebrow">Business information</p>' +
          '<p class="ws-p ws-lead-p">' + esc(w.why) + '</p>' +
          '<div class="biz-mod">' +
          '<details class="ws-d" open><summary>Observed evidence</summary>' + evidenceBlock(lead.evidence) + '</details>' +
          '<details class="ws-d"><summary>How the offer fits</summary><p class="ws-p">' + esc(w.fit) + '</p></details>' +
          '<details class="ws-d"><summary>Signal timeline</summary>' +
            '<ol class="tl">' + list(w.timeline, function (t) {
              return '<li class="tl-i tl-' + esc(t.weight) + '"><span class="tl-t">' + esc(t.t) + '</span>' +
                '<b>' + esc(t.label) + '</b><span class="tl-d">' + esc(t.detail) + '</span></li>';
            }) + '</ol></details>' +
          '<details class="ws-d"><summary>Source &amp; confidence</summary>' +
            '<div class="ws-prov">' + confidenceBar(lead) +
              '<p class="ws-p"><span class="eyebrow">Source</span>' + esc(lead.source ? lead.source.label : '—') + '</p>' +
              (lead.consent ? '<p class="ws-p">' + esc(lead.consent) + '</p>' : '') +
            '</div></details>' +
          '</div>' +
        '</section>' +

        /* ── 3 · PITCH ASSESSMENT ─────────────────────────────────────── */
        '<section class="ws-sec" id="ws-assess">' +
          '<p class="eyebrow">Pitch assessment</p>' +
          '<div class="sw">' +
            '<div class="sw-col sw-s"><p class="eyebrow">Reasons this pitch could work' +
              '<span class="sw-n">' + assess.could.length + '</span></p><ul>' +
              list(assess.could, function (x) { return '<li>' + esc(x.t) + '</li>'; }) + '</ul></div>' +
            '<div class="sw-col sw-w"><p class="eyebrow">Reasons it might not work' +
              '<span class="sw-n">' + assess.might.length + '</span></p><ul>' +
              list(assess.might, function (x) {
                return '<li' + (x.k === 'unknown' ? ' class="is-unknown"' : '') + '>' + esc(x.t) + '</li>';
              }) + '</ul>' +
              '<p class="sw-note">These are open questions, not findings. VISION has not established them either way &mdash; do not assert any of them on the call.</p>' +
            '</div>' +
          '</div>' +
        '</section>' +

        /* ── 4 · PREPARE & PRACTICE ───────────────────────────────────── */
        '<section class="ws-sec" id="ws-prep">' +
          '<p class="eyebrow">Prepare &amp; practice</p>' +
          outreachBlock(lead) +
          '<div class="prac-cta">' +
            '<button class="btn btn-primary btn-practice" type="button" data-practice-live="1">' +
              'Practice with Live Intelligence</button>' +
            '<p class="ws-p prac-note">Takes this prospect, your current script, the evidence, the contact role, Why Now, the open unknowns, the objections and the close you are aiming for.</p>' +
            '<button class="btn btn-quiet btn-call" type="button" data-call-live="1">' +
              'I am on the call now</button>' +
            '<p class="ws-p prac-note">VISION stays silent and reads the real conversation, telling you what they just revealed and what to do next. It never speaks to the prospect.</p>' +
          '</div>' +
        '</section>' +

        '</div>' + wsRail(lead, false) + '</div>';
    }

    el('ws').innerHTML = head + '<div class="ws-shell">' + command + summary + body + '</div>';
    spySections();
  }

  /* Which section the founder is actually looking at. IntersectionObserver
     rather than a scroll handler: the workspace is long, a scroll listener
     fires on every frame, and this only has to change four buttons. */
  var wsSpy = null;
  function spySections() {
    if (wsSpy) { wsSpy.disconnect(); wsSpy = null; }
    if (typeof IntersectionObserver !== 'function') return;
    var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-spy]'));
    if (!buttons.length) return;
    var mark = function (id) {
      buttons.forEach(function (b) {
        var on = b.getAttribute('data-spy') === id;
        b.classList.toggle('on', on);
        if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
      });
    };
    wsSpy = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (e) { return e.isIntersecting; })
        .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; })[0];
      if (visible) mark(visible.target.id);
    }, { rootMargin: '-140px 0px -55% 0px', threshold: 0 });
    buttons.forEach(function (b) {
      var sec = el(b.getAttribute('data-spy'));
      if (sec) wsSpy.observe(sec);
    });
  }

  /* L5B — the one contact block. Deliberately in the rail: the rail is a
     flat list of .rail-b, nothing re-renders it (the outreach section
     rewrites its own innerHTML on every channel switch and would wipe
     anything placed there), and .rail-p already wraps long strings.
     Absent contact renders NOTHING — an empty contact card would read as
     "nobody works here", which is not what "we have not looked" means. */
  /* Relative age for a contact. Deliberately coarse — the founder needs
     "is this current", not a timestamp. */
  function relAge(iso) {
    var then = Date.parse(iso); if (!isFinite(then)) return '';
    var days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    var months = Math.round(days / 30);
    return months === 1 ? 'a month ago' : months + ' months ago';
  }

  function contactBlock(lead) {
    var c = lead.bestContact;
    var state = (lead.contact && lead.contact.state) || (c ? 'has_contact' : null);
    /* Nothing known and nothing offerable renders NOTHING. An empty contact
       card reads as "nobody works here", which is not what "we have not
       looked" means. */
    if (!c && !state) return '';

    if (c) {
      var who = c.name
        ? esc(c.name) + (c.role ? ' <span class="rail-role">' + esc(c.role) + '</span>' : '')
        : 'Shared business address';
      /* HOW MUCH TO TRUST THIS, ON SCREEN. The verification label, the graded
         confidence and the date were all computed, serialised to the browser
         and never rendered — so an accept-all address checked seven months
         ago looked exactly like one confirmed this morning. */
      var age = c.lastCheckedAt ? relAge(c.lastCheckedAt) : '';
      var stale = lead.contact && lead.contact.canRequest;
      return '<div class="rail-b" data-rail="contact">' +
        '<p class="eyebrow">Best contact</p>' +
        '<p class="rail-p rail-who">' + who + '</p>' +
        '<p class="rail-p rail-contact-value">' + esc(c.value) + '</p>' +
        '<p class="rail-verify' + (c.confidence ? ' rail-verify-' + esc(c.confidence) : '') + '">' +
          esc(c.verification) + '</p>' +
        (age ? '<p class="rail-p rail-contact-age' + (stale ? ' is-stale' : '') + '">Checked ' + esc(age) + '</p>' : '') +
        (c.role && c.roleAuthorityKnown === false
          ? '<p class="rail-p rail-role-note">Title as published. Whether they can approve this is not established.</p>' : '') +
        '<button class="btn btn-sec btn-sm" type="button" data-copy-contact="' + esc(c.value) + '">Copy</button>' +
        (stale ? '<button class="btn btn-ghost btn-sm" type="button" data-find-contact="1">Re-check</button>' : '') +
        (c.alternativeCount ? '<p class="rail-alt">' + c.alternativeCount + ' other route' +
          (c.alternativeCount === 1 ? '' : 's') + ' known</p>' : '') +
        '</div>';
    }

    /* No contact yet. What the founder sees depends on what the SERVER
       decided — the client renders a verdict, it does not compute one. */
    var body;
    if (ui.contactBusy) {
      body = '<p class="rail-p rail-contact-busy">Looking for a contact…</p>';
    } else if (state === 'available' && lead.contact.canRequest) {
      body = '<button class="btn btn-sec btn-sm" type="button" data-find-contact="1">Find contact</button>';
    } else {
      /* none_found / not_eligible / unsupported all end here: the server's
         own sentence, shown rather than paraphrased. */
      body = '<p class="rail-p rail-contact-none">' + esc(lead.contact.reason || 'No contact is available.') + '</p>';
    }
    return '<div class="rail-b" data-rail="contact">' +
      '<p class="eyebrow">Best contact</p>' + body + '</div>';
  }


  /* ── WHY NOW ────────────────────────────────────────────────────────
     WHAT HAPPENED, WHEN, WHY IT MAY MATTER, HOW SURE, and — the field that
     stops this becoming urgency theatre — whether it is an EVENT at all or
     simply the standing need restated. Every value is the server's; the
     browser picks no tier and writes no sentence.

     The research control is rendered ONLY when the server said canResearch.
     The client does not re-derive that: the contact path already paid for a
     button whose rule disagreed with the server's, and it spent a credit
     reaching someone VISION had said not to approach. */
  function whyNowBlock(lead) {
    var w = lead.whyNow;
    if (!w) return '';
    var cls = 'rail-b rail-whynow' + (w.eventDriven ? ' is-event' : '') + (w.caution ? ' is-caution' : '');
    var body = '';
    if (w.what) {
      body += '<p class="rail-p rail-whynow-what">' + esc(w.what) + '</p>';
      if (w.when) body += '<p class="rail-whynow-when">' + esc(w.when) + '</p>';
    }
    if (w.whyItMatters) body += '<p class="rail-p rail-whynow-why">' + esc(w.whyItMatters) + '</p>';
    /* A takeover or a closure is a reason to be careful. Saying so beats
       hoping the founder reads the category correctly. */
    if (w.caution) {
      body += '<p class="rail-whynow-caution">This kind of change can mean decisions are paused. Ask whether now is a sensible time before pitching.</p>';
    }
    if (w.caveat) body += '<p class="rail-p rail-whynow-caveat">' + esc(w.caveat) + '</p>';
    if (w.sourceUrl) {
      body += '<a class="rail-whynow-src" href="' + esc(w.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Source</a>';
    }
    if (ui.whyNowBusy) {
      body += '<p class="rail-p rail-whynow-busy">Checking for current signals…</p>';
    } else if (w.canResearch) {
      body += '<button class="btn btn-ghost btn-sm" type="button" data-research-whynow="1">Research current signals</button>';
    }
    return '<div class="' + cls + '" data-rail="whynow">' +
      '<p class="eyebrow">Why now</p>' +
      '<p class="rail-whynow-label' + (w.confidence ? ' rail-verify-' + esc(w.confidence) : '') + '">' +
        esc(w.label) + '</p>' + body + '</div>';
  }

  /* Repaints ONLY the Why Now block, for the same reason redrawContact
     exists: a wholesale rail re-render loses scroll position. */
  function redrawWhyNow() {
    var host = document.querySelector('[data-rail="whynow"]');
    if (!host || !ui.workspace) return;
    var next = whyNowBlock(ui.workspace);
    if (!next) { host.remove(); return; }
    host.outerHTML = next;
  }

  /* Repaints ONLY the contact block. The rail is deliberately not
     re-rendered wholesale — the workspace would lose scroll position and
     any open objection — and the outreach section rewrites its own
     innerHTML on channel switch, which is exactly why the contact lives
     here and not there. */
  function redrawContact() {
    var host = document.querySelector('[data-rail="contact"]');
    if (!host || !ui.workspace) return;
    var next = contactBlock(ui.workspace);
    if (!next) { host.remove(); return; }
    host.outerHTML = next;
  }

  function wsRail(lead, thin) {
    var w = lead.ws;
    /* CONTACT, WHY NOW, CONFIDENCE AND SOURCE HAVE MOVED. Contact and Why
       Now are action-bearing and now sit in the top summary where the founder
       decides; confidence and source are provenance and sit inside Business
       information. Rendering them here as well would be the duplication this
       restructure exists to remove. */
    return '<aside class="ws-rail">' +
      '<div class="rail-b"><p class="eyebrow">Stage</p><p class="rail-p">' +
        esc((STAGES.filter(function (s) { return s.key === (lead.stage || 'new'); })[0] || {}).label || '—') + '</p></div>' +
      (w && w.history
        ? '<div class="rail-b"><p class="eyebrow">History</p><ul class="hist">' + list(w.history, function (h) {
            return '<li><span>' + esc(h.t) + '</span>' + esc(h.label) + '</li>';
          }) + '</ul></div>'
        : '') +
      (thin ? '' : '') +
      '</aside>';
  }

  function outreachBlock(lead) {
    var o = lead.ws.outreach;
    var current = ui.channel;
    var text = outreachText(lead, current);
    return '<div class="out">' +
      '<div class="out-tabs" role="tablist">' + CHANNELS.map(function (c) {
        var has = !!o[c.key];
        return '<button class="out-tab' + (current === c.key ? ' on' : '') + '" type="button" role="tab" ' +
          'aria-selected="' + (current === c.key ? 'true' : 'false') + '" ' +
          (has ? '' : 'disabled ') + 'data-channel="' + esc(c.key) + '">' + esc(c.label) + '</button>';
      }).join('') + '</div>' +
      (current === 'email' && o.email
        ? '<div class="out-subj"><span class="eyebrow">Subject</span><b>' + esc(o.email.subject) + '</b></div>' : '') +
      '<label class="sr-only" for="outText">Outreach message</label>' +
      '<textarea id="outText" class="out-text" rows="14" spellcheck="false">' + esc(text) + '</textarea>' +
      '<div class="out-acts">' +
        '<button class="btn btn-sec btn-sm" type="button" data-copy="1">Copy</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-reset-out="1">Reset to VISION\'s version</button>' +
        '<span class="out-note">Edits are yours and stay on this page.</span>' +
      '</div>' +
    '</div>';
  }

  function outreachText(lead, channel) {
    var key = lead.id + ':' + channel;
    if (ui.outreachEdits[key] != null) return ui.outreachEdits[key];
    var o = lead.ws.outreach[channel];
    if (!o) return '';
    return channel === 'email' ? o.body : o;
  }
  /* ════════════════ 11 · PRACTICE CALL ════════════════ */

  function startPractice() {
    /* FIXTURE ONLY. There is no runtime practice engine, and serving an
       authored persona's branches against a real prospect would be inventing
       a conversation that never happened. renderWorkspace already hides every
       entry point when `ws.practice` is absent, which is always true of a
       server view model — this is the second lock. */
    if (ui.mode !== 'fixture') return;
    var lead = ui.workspace;
    if (!lead || !lead.ws || !lead.ws.practice) return;
    /* `line` holds what the prospect says on the CURRENT turn. It starts as the
       authored opener and is then overwritten by the branch reply the founder's
       choice produced. It lives on the run rather than on the fixture: writing
       the reply back into `practice.turns` mutated the authored script, so
       "Run it again" replayed whatever happened last time and the original
       line was gone for the rest of the session. */
    ui.practice = { difficulty: null, turn: 0, log: [], picks: [], line: null };
    /* Where focus goes back to when the dialog closes. Without this, closing
       dropped focus to the top of the document and a keyboard user had to tab
       back through the whole workspace to reach where they were. */
    ui.practiceOpener = document.activeElement;
    renderPractice();
    el('practice').hidden = false;
    /* Tried in order, because querySelector with a list returns the first
       match in DOCUMENT order, not the first selector that matches — and the
       close button sits above the choices, so a combined selector always
       landed on "close" rather than on the first thing to decide. */
    var p = el('practice');
    var first = p.querySelector('.diff') || p.querySelector('.prac-opt') || p.querySelector('.prac-x');
    if (first) first.focus();
  }

  function closePractice() {
    ui.practice = null;
    el('practice').hidden = true;
    var back = ui.practiceOpener;
    ui.practiceOpener = null;
    if (back && document.contains(back)) back.focus();
    else { var b = el('wsBack'); if (b) b.focus(); }
  }

  function renderPractice() {
    var lead = ui.workspace;
    var p = ui.practice;
    if (!lead || !p) return;
    var script = lead.ws.practice;
    var html = '<div class="prac" role="dialog" aria-modal="true" aria-labelledby="pracTitle">' +
      '<header class="prac-top">' +
        '<div><p class="eyebrow">Practice call</p><h2 id="pracTitle">' + esc(lead.name) + '</h2></div>' +
        '<button class="prac-x" type="button" data-prac-close="1" aria-label="Close practice">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '</header>';

    if (!p.difficulty) {
      html += '<div class="prac-body">' +
        '<p class="prac-persona">' + esc(script.persona) + '</p>' +
        '<p class="eyebrow">Choose how hard they push back</p>' +
        '<div class="diffs">' +
          diffBtn('easy', 'Easy', 'Receptive. Answers your questions and gives you room.') +
          diffBtn('realistic', 'Realistic', 'How this call usually goes. Polite, busy, mildly sceptical.') +
          diffBtn('difficult', 'Difficult', 'Short of time, guarded, and unimpressed by anything that sounds rehearsed.') +
        '</div>' +
        '<p class="prac-note">No model is involved. VISION replies from written branches, so the same choice always gives the same answer.</p>' +
        '</div>';
    } else if (p.turn < script.turns.length) {
      var turn = script.turns[p.turn];
      var line = p.line == null ? turn.prospect : p.line;
      html += '<div class="prac-body">' +
        '<div class="prac-log">' + p.log.map(function (l) {
          return '<div class="pl pl-' + esc(l.who) + '"><span class="eyebrow">' + esc(l.who === 'them' ? lead.name : 'You') + '</span><p>' + esc(l.text) + '</p></div>';
        }).join('') +
        '<div class="pl pl-them pl-now"><span class="eyebrow">' + esc(lead.name) + '</span><p>' + esc(line) + '</p></div>' +
        '</div>' +
        '<p class="prac-hint">' + esc(turn.hint) + '</p>' +
        '<div class="prac-opts">' + turn.options.map(function (o, i) {
          return '<button class="prac-opt" type="button" data-pick="' + i + '">' + esc(o.text) + '</button>';
        }).join('') + '</div>' +
        '<p class="prac-diff">Difficulty: <b>' + esc(p.difficulty) + '</b> · turn ' + (p.turn + 1) + ' of ' + script.turns.length + '</p>' +
        '</div>';
    } else {
      html += renderFeedback(lead, script, p);
    }

    html += '</div>';
    el('practice').innerHTML = html;
  }

  function diffBtn(key, label, note) {
    return '<button class="diff" type="button" data-diff="' + esc(key) + '">' +
      '<b>' + esc(label) + '</b><span>' + esc(note) + '</span></button>';
  }

  function renderFeedback(lead, script, p) {
    var good = p.picks.filter(function (x) { return x.quality === 'good'; });
    var miss = p.picks.filter(function (x) { return x.quality === 'miss'; });
    var ok = p.picks.filter(function (x) { return x.quality === 'ok'; });
    var verdict = miss.length === 0
      ? 'That call would have kept you in the running.'
      : miss.length === 1
        ? 'One choice cost you ground you did not need to lose.'
        : 'This call went to whoever calls them next.';

    return '<div class="prac-body">' +
      '<div class="fb-top"><p class="eyebrow">How that went</p><h3>' + esc(verdict) + '</h3></div>' +
      '<div class="fb-score">' +
        '<div class="fbs fbs-g"><b>' + good.length + '</b><span>Good</span></div>' +
        '<div class="fbs fbs-o"><b>' + ok.length + '</b><span>Passable</span></div>' +
        '<div class="fbs fbs-m"><b>' + miss.length + '</b><span>Missed</span></div>' +
      '</div>' +
      (good.length ? '<div class="fb-b fb-good"><span class="eyebrow">Good</span><ul>' +
        list(good, function (x) { return '<li>' + esc(x.note) + '</li>'; }) + '</ul></div>' : '') +
      (ok.length ? '<div class="fb-b fb-ok"><span class="eyebrow">Passable</span><ul>' +
        list(ok, function (x) { return '<li>' + esc(x.note) + '</li>'; }) + '</ul></div>' : '') +
      (miss.length ? '<div class="fb-b fb-miss"><span class="eyebrow">Missed</span><ul>' +
        list(miss, function (x) { return '<li>' + esc(x.note) + '</li>'; }) + '</ul></div>' : '') +
      '<div class="fb-acts">' +
        '<button class="btn btn-sec btn-sm" type="button" data-prac-restart="1">Run it again</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" data-prac-close="1">Back to the prospect</button>' +
      '</div>' +
      '<p class="prac-note">Scoring is fixed to the written branches. Nothing here is judged by a model.</p>' +
      '</div>';
  }

  function pickOption(index) {
    var lead = ui.workspace;
    var p = ui.practice;
    if (!lead || !p) return;
    var script = lead.ws.practice;
    var turn = script.turns[p.turn];
    var opt = turn.options[index];
    if (!opt) return;
    p.log.push({ who: 'them', text: p.line == null ? turn.prospect : p.line });
    p.log.push({ who: 'you', text: opt.text });
    p.picks.push({ quality: opt.quality, note: opt.note });
    var reply = opt.reply[p.difficulty] || opt.reply.realistic;
    p.turn += 1;
    if (p.turn < script.turns.length) {
      /* The chosen branch's reply becomes the next thing she says, so the line
         the founder hears is a consequence of what they just said. Held on the
         run, never written back into the authored script. */
      p.line = reply;
    } else {
      p.line = null;
      p.log.push({ who: 'them', text: reply });
    }
    renderPractice();
  }
  /* ════════════════ 12 · toast ════════════════ */

  var toastTimer = null;
  function showToast(msg, actionLabel, actionFn) {
    var t = el('toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' +
      (actionLabel ? ' <button type="button" data-toast-action="1">' + esc(actionLabel) + '</button>' : '');
    t.hidden = false;
    t._action = actionFn || null;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; t._action = null; }, 6000);
  }
  /* ════════════════ 13 · board render + tabs ════════════════ */

  function renderTabs() {
    var f = ui.board;
    var tabs = [
      { key: 'discover', label: f.mode === 'inbound' ? 'Inbound' : 'Discover' },
      { key: 'qualified', label: 'Qualified' },
      { key: 'pipeline', label: 'Pipeline' }
    ];
    /* Roving tabindex: only the selected tab is in the tab order, and Left /
       Right / Home / End move between them (see onKey). Without it all three
       tabs were separate tab stops and the arrow keys did nothing, which is
       not how a tablist is expected to behave. */
    el('tabs').innerHTML = tabs.map(function (t) {
      var on = ui.tab === t.key;
      var panelId = 'panel' + t.key.charAt(0).toUpperCase() + t.key.slice(1);
      return '<button class="tab' + (on ? ' on' : '') + '" type="button" role="tab" ' +
        'id="tab-' + esc(t.key) + '" ' +
        'aria-selected="' + (on ? 'true' : 'false') + '" ' +
        'tabindex="' + (on ? '0' : '-1') + '" ' +
        'aria-controls="' + panelId + '" ' +
        'data-tab="' + esc(t.key) + '">' + esc(t.label) + '</button>';
    }).join('');
    ['discover', 'qualified', 'pipeline'].forEach(function (k) {
      var panel = el('panel' + k.charAt(0).toUpperCase() + k.slice(1));
      panel.hidden = ui.tab !== k;
      /* Named by its own tab rather than by a duplicated aria-label. */
      panel.setAttribute('aria-labelledby', 'tab-' + k);
      panel.removeAttribute('aria-label');
    });
  }

  function renderBoard() {
    renderHead();
    renderPriority();
    renderTabs();
    renderDiscover();
    renderQualified();
    renderPipeline();
  }


  /* ════════════════ 14 · events ════════════════ */

  function onClick(e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var hit;

    hit = t.closest('[data-tab]');
    if (hit) { ui.tab = hit.getAttribute('data-tab'); renderTabs(); return; }

    hit = t.closest('[data-open]');
    if (hit) {
      /* A REFUSAL OPENS TOO, and that is the whole point of the refusal shell.
         This used to short-circuit on workspaceAvailable===false and fire a
         toast instead, to stop the browser asking the server to write a sales
         script for a prospect VISION had just said not to contact.

         That guard outlived its reason and then actively broke the product.
         The server now refuses to synthesise for a refused decision at all
         (prospect-intelligence.js gates on isRefusalAction), so opening one
         costs nothing — the cost argument that justified the guard is gone.
         Meanwhile the guard made renderWorkspaceRefused UNREACHABLE from a
         click, and with it the Contact block that is the only way out of the
         research_contact_route dead end. The founder clicked the one prospect
         that needed a contact found, got a toast that vanished, and had
         nowhere to ask.

         Measured against real staging, not reasoned about: the click produced
         an empty #ws and no prospect_intelligence request at all. */
      openWorkspace(hit.getAttribute('data-open'));
      return;
    }

    hit = t.closest('[data-expand]');
    if (hit) {
      var eid = hit.getAttribute('data-expand');
      var full = document.querySelector('[data-full="' + eid + '"]');
      var compact = document.querySelector('[data-compact="' + eid + '"]');
      var isOpen = hit.getAttribute('aria-expanded') === 'true';
      hit.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      hit.querySelector('span').textContent = isOpen ? 'Expand evidence' : 'Hide evidence';
      if (full) full.hidden = isOpen;
      if (compact) compact.hidden = !isOpen;
      return;
    }

    hit = t.closest('[data-save]');
    if (hit) { emit('onSaveLead', hit.getAttribute('data-save')); return; }

    hit = t.closest('[data-dismiss]');
    if (hit) { emit('onDismissLead', hit.getAttribute('data-dismiss')); return; }

    hit = t.closest('[data-campaign]');
    if (hit) {
      ui.campaignFilter = hit.getAttribute('data-campaign');
      ui.tab = 'qualified';
      renderTabs();
      renderQualified();
      el('tabs').scrollIntoView({ block: 'start' });
      return;
    }

    hit = t.closest('[data-clear-campaign]');
    if (hit) { ui.campaignFilter = null; renderQualified(); return; }

    hit = t.closest('[data-jump]');
    if (hit) {
      var target = el(hit.getAttribute('data-jump'));
      if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }

    hit = t.closest('[data-obj-toggle]');
    if (hit) {
      var body = hit.parentNode.querySelector('.obj-b');
      var open = hit.getAttribute('aria-expanded') === 'true';
      hit.setAttribute('aria-expanded', open ? 'false' : 'true');
      hit.parentNode.classList.toggle('open', !open);
      if (body) body.hidden = open;
      return;
    }

    hit = t.closest('[data-channel]');
    if (hit && !hit.disabled) {
      ui.channel = hit.getAttribute('data-channel');
      var sec = el('ws-out');
      if (sec) sec.innerHTML = '<p class="eyebrow">Outreach</p>' + outreachBlock(ui.workspace);
      return;
    }

    hit = t.closest('[data-find-contact]');
    if (hit) {
      /* The button is a suggestion, never an authorisation: the server
         re-runs every eligibility gate on the way in. */
      ui.contactBusy = true;
      redrawContact();
      emit('onFindContact', ui.open);
      return;
    }

    hit = t.closest('[data-research-whynow]');
    if (hit) {
      /* Same contract as Find contact: a suggestion, not an authorisation.
         The server re-runs whyNowEligibility on the way in, so a stale page
         that still shows this button is refused rather than obeyed. */
      ui.whyNowBusy = true;
      redrawWhyNow();
      emit('onResearchWhyNow', ui.open);
      return;
    }

    hit = t.closest('[data-copy-contact]');
    if (hit) {
      var contactValue = hit.getAttribute('data-copy-contact');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(contactValue).then(
          function () { showToast('Contact copied.'); },
          function () { showToast('Could not copy — select the address and copy manually.'); });
      } else {
        showToast('Could not copy — select the address and copy manually.');
      }
      return;
    }

    hit = t.closest('[data-copy]');
    if (hit) {
      var ta = el('outText');
      if (!ta) return;
      ta.select();
      var done = false;
      try { done = document.execCommand('copy'); } catch (err) { done = false; }
      if (!done && navigator.clipboard) {
        navigator.clipboard.writeText(ta.value).then(function () { showToast('Copied.'); },
          function () { showToast('Could not copy — select the text and copy manually.'); });
        return;
      }
      showToast(done ? 'Copied.' : 'Could not copy — select the text and copy manually.');
      return;
    }

    hit = t.closest('[data-reset-out]');
    if (hit) {
      delete ui.outreachEdits[ui.open + ':' + ui.channel];
      var sec2 = el('ws-out');
      if (sec2) sec2.innerHTML = '<p class="eyebrow">Outreach</p>' + outreachBlock(ui.workspace);
      showToast('Reset to VISION\'s version.');
      return;
    }

    /* THE SEAM, AND ONLY THE SEAM. Live Intelligence does not exist yet.
       This assembles the real handoff from the workspace on screen and emits
       it, so whoever builds the practice system receives a payload that has
       already been shaped against real data rather than a TODO. If no host
       has registered a handler the founder is told plainly, rather than
       clicking a button that silently does nothing. */
    hit = t.closest('[data-practice-live]');
    if (hit) {
      var handoff = practiceHandoff(ui.workspace);
      if (!emit('onPracticeLive', ui.open, handoff)) {
        showToast('Live Intelligence practice is not connected yet.');
      }
      return;
    }

    /* ON A CALL NOW — the same handoff, a different mode. Practice rehearses
       against a simulated prospect; this one watches a real conversation and
       stays silent. */
    hit = t.closest('[data-call-live]');
    if (hit) {
      var callHandoff = practiceHandoff(ui.workspace);
      if (!emit('onCallLive', ui.open, callHandoff)) {
        showToast('Call Intelligence is not connected yet.');
      }
      return;
    }

    hit = t.closest('[data-practice]');
    if (hit) { startPractice(); return; }

    hit = t.closest('[data-diff]');
    if (hit) { ui.practice.difficulty = hit.getAttribute('data-diff'); renderPractice(); return; }

    hit = t.closest('[data-pick]');
    if (hit) { pickOption(parseInt(hit.getAttribute('data-pick'), 10)); return; }

    hit = t.closest('[data-prac-restart]');
    if (hit) { startPractice(); return; }

    hit = t.closest('[data-prac-close]');
    if (hit) { closePractice(); return; }

    hit = t.closest('#wsBack');
    if (hit) { closeWorkspace(); return; }

    hit = t.closest('[data-retry-board]');
    if (hit) { emit('onRetryBoard'); return; }

    hit = t.closest('[data-retry-workspace]');
    if (hit) { emit('onRetryWorkspace', ui.open); return; }

    hit = t.closest('[data-toast-action]');
    if (hit) {
      var tEl = el('toast');
      if (tEl && tEl._action) tEl._action();
      tEl.hidden = true;
      tEl._action = null;
      return;
    }
  }

  function onInput(e) {
    if (e.target.id === 'qFilter') { ui.query = e.target.value; renderQualified(); return; }
    if (e.target.id === 'outText') {
      ui.outreachEdits[ui.open + ':' + ui.channel] = e.target.value;
      return;
    }
  }

  function onChange(e) {
    if (e.target.id === 'fixtureSel') { emit('onScenarioChange', e.target.value); return; }
    if (e.target.id === 'stageSel') {
      var lead = ui.workspace;
      if (!lead) return;
      emit('onStageChange', lead.id, e.target.value);
      var label = (STAGES.filter(function (s) { return s.key === e.target.value; })[0] || {}).label || '';
      /* BY NAME, NOT BY POSITION. This was `querySelectorAll('.rail-b')[2]`,
         which is correct only while the History block stays last — any rail
         reorder would have silently rewritten the wrong section. */
      var railStage = document.querySelector('[data-rail="stage"] .rail-p');
      if (railStage) railStage.textContent = label;
      showToast(lead.name + ' moved to ' + label + '.');
      return;
    }
  }

  function onSubmit(e) {
    if (e.target.id !== 'searchForm') return;
    e.preventDefault();
    var value = el('searchInput').value.trim();
    var f = ui.board;
    if (!value) { showToast('Describe what you are looking for and VISION will show you the filters first.'); return; }
    /* UI state, not a write into the data source. This assigned straight into
       the FIXTURES object so the next render re-read it as a value. */
    ui.searchQuery = value;
    /* No provider is called. The mock re-states the structured filters so the
       contract is visible: a prose query becomes named filters the founder can
       check BEFORE anything is searched. */
    showToast('Mock: no search runs here. The filters VISION would use are shown above.');
    renderDiscover();
  }

  function onKey(e) {
    /* Arrow-key movement within the tablist. */
    var onTab = e.target && e.target.closest ? e.target.closest('.tab') : null;
    if (onTab && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) {
      var all = [].slice.call(document.querySelectorAll('.tab'));
      var i = all.indexOf(onTab);
      var next = e.key === 'Home' ? 0
        : e.key === 'End' ? all.length - 1
        : e.key === 'ArrowLeft' ? (i - 1 + all.length) % all.length
        : (i + 1) % all.length;
      e.preventDefault();
      ui.tab = all[next].getAttribute('data-tab');
      renderTabs();
      var moved = document.querySelector('.tab[data-tab="' + ui.tab + '"]');
      if (moved) moved.focus();
      return;
    }
    if (e.key !== 'Escape') return;
    if (ui.practice) { closePractice(); return; }
    if (ui.open) closeWorkspace();
  }

  function onPop(e) {
    var id = e.state && e.state.vlead;
    if (id) openWorkspace(id, true);
    else if (ui.open) closeWorkspace(true);
  }

  /* ════════════════ PUBLIC API ════════════════ */

  function setChrome() {
    /* The fixture scenario selector and its disclosure badge are design-QA
       affordances. In runtime they are removed, not hidden — a real founder
       must never find a control that swaps their prospects for fiction. */
    var fixtureChrome = document.querySelector('.lh-fix');
    if (!fixtureChrome) return;
    if (ui.mode === 'fixture') { fixtureChrome.hidden = false; return; }
    fixtureChrome.remove();
  }

  function shell(message, detail, retryAttribute) {
    return '<div class="lead-state">'
      + '<p class="lead-state-msg">' + esc(message) + '</p>'
      + (detail ? '<p class="lead-state-detail">' + esc(detail) + '</p>' : '')
      + (retryAttribute ? '<button class="btn btn-sec btn-sm" type="button" ' + retryAttribute + '>Try again</button>' : '')
      + '</div>';
  }

  var API = {
    init: function (options) {
      var opts = options || {};
      ui.mode = opts.mode === 'fixture' ? 'fixture' : 'runtime';
      ui.handlers = opts.handlers || {};
      setChrome();
      document.addEventListener('click', onClick);
      document.addEventListener('input', onInput);
      document.addEventListener('change', onChange);
      document.addEventListener('submit', onSubmit);
      document.addEventListener('keydown', onKey);
      window.addEventListener('popstate', onPop);
    },

    renderBoardLoading: function () {
      el('priority').hidden = true;
      el('tabs').innerHTML = '';
      el('panelQualified').hidden = false;
      el('panelQualified').innerHTML = shell('Loading your prospects…', 'Reading what VISION already knows.');
      el('panelDiscover').hidden = true;
      el('panelPipeline').hidden = true;
    },

    renderBoard: function (board) {
      ui.board = board || emptyBoard();
      if (!ui.board.leads.length) ui.tab = 'discover';
      renderBoard();
    },

    renderBoardEmpty: function (board) {
      ui.board = board || emptyBoard();
      renderHead();
      el('priority').hidden = true;
      renderTabs();
      var connected = ui.board.discovery && ui.board.discovery.providerConnected;
      el('panelDiscover').innerHTML = emptyState(
        'No prospects yet',
        connected
          ? 'Nothing has been saved to this venture yet.'
          : 'Nothing has been saved to this venture yet, and prospect discovery is not connected, so VISION has not gone looking. Prospects you save will appear here.');
      el('panelQualified').innerHTML = emptyState('No qualified leads yet', 'A prospect appears here once VISION has enough evidence to qualify it.');
      el('panelPipeline').innerHTML = emptyState('Nothing in the pipeline', 'A prospect enters the pipeline the moment you contact them.');
    },

    /* NEVER FIXTURES. A broken backend is a broken backend; inventing
       customers to fill the screen would be the worst possible failure mode
       for this particular product. */
    renderBoardError: function (detail) {
      el('priority').hidden = true;
      el('tabs').innerHTML = '';
      el('panelQualified').hidden = false;
      el('panelDiscover').hidden = true;
      el('panelPipeline').hidden = true;
      el('panelQualified').innerHTML = shell(
        'VISION could not load your prospects.',
        detail || 'The connection to your workspace failed.', 'data-retry-board="1"');
    },

    openWorkspaceShell: function (row) {
      ui.wsOpener = document.activeElement;
      ui.open = row && row.id ? row.id : null;
      ui.workspace = null;
      ui.channel = 'call';
      document.body.setAttribute('data-view', 'workspace');
      el('ws').hidden = false;
      window.scrollTo(0, 0);
      try {
        var entry = { vlead: ui.open };
        var url = '#prospect-' + ui.open;
        if (history.state && history.state.vlead) history.replaceState(entry, '', url);
        else history.pushState(entry, '', url);
      } catch (error) { /* history is a nicety, never a requirement */ }
    },

    renderWorkspaceLoading: function (row) {
      var name = row && row.name ? row.name : 'this prospect';
      el('ws').innerHTML = wsBar(row)
        + '<div class="ws-shell"><div class="ws-loading">'
        + '<p class="eyebrow">Building prospect intelligence</p>'
        + '<h1 class="ws-loading-title">' + esc(name) + '</h1>'
        + '<p class="ws-loading-note">Reviewing verified evidence and preparing your approach.</p>'
        + '<div class="ws-loading-bar"><i></i></div></div></div>';
      var back = el('wsBack');
      if (back) back.focus();
    },

    renderWorkspace: function (viewModel) {
      ui.workspace = viewModel;
      renderWorkspace();
    },

    /* A REFUSED PROSPECT STILL GETS THE CONTACT AREA, and that is the whole
       point of it being here. `research_contact_route` means "no way in has
       been observed" — the prospect that most needs a contact was the one
       surface that could not offer to find one, because a refusal renders no
       rail. The block is appended to the refusal shell instead.

       It is not offered indiscriminately: contactWorkspaceState withholds
       the request for do_not_contact and observe_only, so a prospect VISION
       said not to approach shows its reason and no button. */
    renderWorkspaceRefused: function (row) {
      ui.workspace = row || null;
      var contact = row ? contactBlock(row) : '';
      el('ws').innerHTML = wsBar(row)
        + '<div class="ws-shell">' + shell(
          row && row.next ? row.next.action : 'VISION recommends not contacting this prospect.',
          row && row.next ? row.next.why : '', '')
        + (contact ? '<aside class="ws-rail ws-rail-refused">' + contact + '</aside>' : '')
        + '</div>';
      var back = el('wsBack');
      if (back) back.focus();
    },

    renderWorkspaceError: function (row, detail) {
      el('ws').innerHTML = wsBar(row)
        + '<div class="ws-shell">' + shell(
          'VISION could not prepare this prospect.',
          detail || 'The request failed before the file was ready.',
          'data-retry-workspace="1"') + '</div>';
      var back = el('wsBack');
      if (back) back.focus();
    },

    /* L5B — applies an enrichment outcome to the open prospect. Repaints
       only the contact block; the rest of the workspace is untouched
       because nothing else changed. */
    applyContact: function (id, contactState, bestContact) {
      ui.contactBusy = false;
      if (!ui.workspace || ui.open !== id) return;   // founder moved on
      ui.workspace.contact = contactState || ui.workspace.contact || null;
      ui.workspace.bestContact = bestContact || null;
      redrawContact();
    },
    /* The research outcome. `whyNow` is the SERVER's projection — the same
       one the Workspace shipped — so a founder who researches sees exactly
       the fields they would have seen had the event been there all along.
       Passing null would silently blank a Why Now that is still true. */
    applyWhyNow: function (id, whyNow) {
      ui.whyNowBusy = false;
      if (!ui.workspace || ui.open !== id) return;   // founder moved on
      if (whyNow) ui.workspace.whyNow = whyNow;
      redrawWhyNow();
    },
    /* A FAILED LOOK IS NOT "NO NEWS". Reporting a timeout as "no event
       verified" would be VISION asserting something about the world from its
       own inability to check, which is the exact failure this layer exists
       not to commit. The previous answer stays on screen, the button comes
       back only when retrying could actually help, and the founder is told. */
    whyNowFailed: function (id, message, retryable) {
      ui.whyNowBusy = false;
      if (ui.workspace && ui.open === id) {
        if (retryable === false && ui.workspace.whyNow) {
          ui.workspace.whyNow = Object.assign({}, ui.workspace.whyNow, { canResearch: false });
        }
        redrawWhyNow();
      }
      showToast(message || 'Could not check for current signals right now.');
    },
    /* A PERMANENT REFUSAL MUST NOT HAND THE BUTTON BACK. This used to
       redraw the unchanged server verdict, so a 451 legal refusal and a
       network blip presented identically: the button returned instantly and
       the founder could click it again, and again. On a searchable domain
       every one of those clicks is a paid request. The server already
       computes `retryable`; it was parsed and thrown away. */
    contactFailed: function (id, message, retryable) {
      ui.contactBusy = false;
      if (ui.workspace && ui.open === id) {
        if (retryable === false) {
          ui.workspace.contact = { state: 'restricted', canRequest: false,
            reason: message || 'VISION cannot look for a contact here.' };
        }
        redrawContact();
      }
      showToast(message || 'Could not look for a contact right now.');
    },

    closeWorkspace: function () { closeWorkspace(); },
    showToast: showToast,
    /* Read-only, for tests and the runtime's race checks. */
    currentLeadId: function () { return ui.open; },
    mode: function () { return ui.mode; },
  };

  function wsBar(row) {
    return '<div class="ws-bar">'
      + '<button class="ws-back" id="wsBack" type="button">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Leads</span></button>'
      + '</div>';
  }

  V.leadsUI = API;
})(window.VISION);
