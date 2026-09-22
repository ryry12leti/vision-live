/* ════════════════════════════════════════════════════════════════════════
   PROGRESS — WHAT A FOUNDER SEES ABOUT THEMSELVES

   Renders practice-progress.js and adds no judgement of its own. Every
   claim on this screen is one the pure module already gated on evidence:
   if it says `unknown`, this draws no arrow; if it says `insufficient`,
   this says so in the founder's own words rather than drawing a confident
   line through two points.

   The bar chart is deliberately not a line chart. A line implies the
   points between the calls mean something, and they do not -- there is no
   founder between two rehearsals, only the two rehearsals.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  var V = window.VISION || (window.VISION = {});

  /* Same idiom as the runner uses for coaching-rail and call-state: a
     classic script pulling an ES module in dynamically, so nothing else has
     to know this file needs it. Null until it lands; load() waits. */
  var MOD = null;
  import('../goal-engine/practice/practice-progress.js')
    .then(function (m) { MOD = m; })
    .catch(function () { MOD = null; });

  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  };

  /* Direction is the pure module's word, never re-derived here. */
  var ARROW = { improving: '▲', slipping: '▼', flat: '—', unknown: '' };
  var TONE = { improving: 'up', slipping: 'down', flat: 'flat', unknown: 'none' };

  function deltaLabel(d) {
    if (d == null) return '';
    var s = d > 0 ? '+' : '';
    return s + (Math.round(d * 10) / 10);
  }

  /* ── THE HEADLINE ────────────────────────────────────────────────────
     Below the confidence threshold this shows the latest score and the
     count and NOTHING ELSE. No arrow, no delta, no encouragement -- the
     founder is told plainly that there is not enough yet. */
  function headlineHtml(p) {
    var dir = p.direction;
    var showTrend = dir !== 'unknown';
    return '<section class="lpp-head">'
      + '<div class="lpp-head-main">'
        + '<p class="lpp-lab">Your rehearsals</p>'
        + '<p class="lpp-score">' + (p.latest == null ? '—' : esc(p.latest))
          + '<span class="lpp-score-of">/100 last call</span></p>'
        + '<p class="lpp-headline">' + esc(p.headline) + '</p>'
        /* Only when something was actually dropped. A founder whose calls
           all scored must never see a warning about calls that do not
           exist. */
        + (p.unscoredNote && p.calls
          ? '<p class="lpp-unscored">' + esc(p.unscoredNote) + '</p>' : '')
      + '</div>'
      + '<div class="lpp-head-stats">'
        + stat('Calls', p.calls)
        + stat('Average', p.average == null ? '—' : p.average)
        + stat('Best', p.best == null ? '—' : p.best)
        + (showTrend
          ? '<div class="lpp-stat lpp-' + TONE[dir] + '"><span class="lpp-stat-k">Trend</span>'
            + '<span class="lpp-stat-v">' + ARROW[dir] + ' ' + esc(deltaLabel(p.overallDelta)) + '</span></div>'
          : '<div class="lpp-stat lpp-none"><span class="lpp-stat-k">Trend</span>'
            + '<span class="lpp-stat-v">not yet</span></div>')
      + '</div>'
      + '</section>';
  }

  function stat(k, v) {
    return '<div class="lpp-stat"><span class="lpp-stat-k">' + esc(k) + '</span>'
      + '<span class="lpp-stat-v">' + esc(v) + '</span></div>';
  }

  /* One bar per scored call, oldest left. Height is the score; nothing is
     interpolated. */
  function chartHtml(p) {
    if (!p.series.length) return '';
    var max = 100;
    var bars = p.series.map(function (v, i) {
      var h = Math.max(2, Math.round((v / max) * 100));
      var isLast = i === p.series.length - 1;
      return '<div class="lpp-bar' + (isLast ? ' is-last' : '') + '" style="height:' + h + '%" '
        + 'title="Call ' + (i + 1) + ': ' + v + '/100"><span class="lpp-bar-v">' + v + '</span></div>';
    }).join('');
    return '<section class="lpp-chart-wrap">'
      + '<div class="lpp-chart">' + bars + '</div>'
      + '<div class="lpp-chart-axis"><span>first</span><span>most recent</span></div>'
      + '</section>';
  }

  /* ── THE EIGHT DIMENSIONS ────────────────────────────────────────────
     Sorted weakest-first, because the useful question is never "what am I
     good at". A dimension without enough samples shows its value and no
     direction at all. */
  function dimensionsHtml(p) {
    var rows = p.dimensions.slice().sort(function (a, b) {
      if (a.average == null) return 1;
      if (b.average == null) return -1;
      return a.average - b.average;
    }).map(function (d) {
      var pct = d.latest == null ? 0 : d.latest;
      var dir = d.direction;
      return '<li class="lpp-dim">'
        + '<span class="lpp-dim-name">' + esc(d.label) + '</span>'
        + '<span class="lpp-dim-track"><span class="lpp-dim-fill" style="width:' + pct + '%"></span></span>'
        + '<span class="lpp-dim-val">' + (d.latest == null ? '—' : esc(d.latest)) + '</span>'
        + '<span class="lpp-dim-dir lpp-' + TONE[dir] + '">'
          + (dir === 'unknown' ? '<i class="lpp-dim-thin">needs ' + p.thresholds.direction + '</i>'
            : ARROW[dir] + ' ' + esc(deltaLabel(d.delta)))
        + '</span></li>';
    }).join('');
    return '<section class="lpp-block"><p class="lpp-block-k">Where you stand</p>'
      + '<ul class="lpp-dims">' + rows + '</ul></section>';
  }

  /* ── WHAT TO DO NEXT ─────────────────────────────────────────────────
     Only rendered when the module actually named something. An empty
     state here is correct and is not filled with encouragement. */
  function focusHtml(p) {
    var out = '';
    if (p.improved && p.improved.length) {
      out += '<div class="lpp-note lpp-up"><span class="lpp-note-k">Getting better</span><p>'
        + esc(p.improved.slice(0, 2).map(function (d) {
          return d.label + ' (' + deltaLabel(d.delta) + ')';
        }).join(', ')) + '</p></div>';
    }
    if (p.focus) {
      out += '<div class="lpp-note lpp-focus"><span class="lpp-note-k">Work on this next</span><p>'
        + esc(p.focus.label) + ' — averaging ' + esc(p.focus.average)
        + '/100 and not moving.</p></div>';
    }
    if (p.recurringLeak) {
      out += '<div class="lpp-note lpp-leak"><span class="lpp-note-k">Keeps happening</span><p>'
        + esc(String(p.recurringLeak.fault).replace(/_/g, ' '))
        + ' — in ' + esc(p.recurringLeak.calls) + ' of your calls.</p></div>';
    }
    return out ? '<section class="lpp-notes">' + out + '</section>' : '';
  }

  function emptyHtml(p) {
    /* A founder who HAS practised but whose calls were all too short must be
       told that, not shown the same blank slate as someone who has never
       practised at all. */
    var dropped = p && p.unscored ? p.unscoredNote : null;
    return '<section class="lpp-empty">'
      + '<p class="lpp-lab">Your rehearsals</p>'
      + '<p class="lpp-empty-msg">' + (dropped
        ? esc(dropped) + ' A longer call gives the review enough to work with.'
        : 'No scored rehearsals yet. Finish a practice call and its score will appear here.')
      + '</p></section>';
  }

  function html(progress) {
    if (!progress || !progress.calls) return emptyHtml(progress);
    return headlineHtml(progress)
      + chartHtml(progress)
      + dimensionsHtml(progress)
      + focusHtml(progress);
  }

  /* ── TWO TRACKS, NEVER AVERAGED ──────────────────────────────────────
     A non-buyer `overall` is computed over different categories against a
     different total, so it is not comparable with a buyer one. Averaged
     together, a founder's improvement becomes partly a record of WHICH ROLE
     THEY DREW -- noise they can neither see nor control, presented as
     progress.

     So the buyer track is the page, exactly as it was, and the non-buyer
     track is a second panel underneath with its own count, its own average
     and its own threshold. There is deliberately no combined number
     anywhere: the pure module returns `combined: null` and this draws
     nothing in its place.

     THE SECOND PANEL ONLY APPEARS ONCE THERE IS SOMETHING IN IT. A founder
     who has never met a gatekeeper should not be shown an empty box asking
     why. */
  /* ── REAL CALLS ─────────────────────────────────────────────────────
     A third denominator and a third panel. The coverage line is not
     decoration: a call scored over 71% of its turns and one scored over 98%
     are both above the floor and are not the same claim, and a founder who
     is not told that reads the two averages as equivalent. */
  function liveHtml(byTrack) {
    var lv = byTrack && byTrack.live;
    if (!lv || !lv.calls) return '';
    return '<section class="lpp-track lpp-track-live">'
      + '<p class="lpp-lab">Real calls</p>'
      + '<p class="lpp-track-note">Scored from calls you actually made. Delivery is never '
      + 'judged on a phone line, and anything VISION could not attribute to a speaker is '
      + 'left out. Kept separate from your rehearsals because they are not the same number.</p>'
      + '<div class="lpp-head-stats">'
        + stat('Calls', lv.calls)
        + stat('Average', lv.average == null ? '—' : lv.average)
        + stat('Best', lv.best == null ? '—' : lv.best)
        + (lv.direction !== 'unknown'
          ? '<div class="lpp-stat lpp-' + TONE[lv.direction] + '"><span class="lpp-stat-k">Trend</span>'
            + '<span class="lpp-stat-v">' + ARROW[lv.direction] + ' ' + esc(deltaLabel(lv.overallDelta)) + '</span></div>'
          : '<div class="lpp-stat lpp-none"><span class="lpp-stat-k">Trend</span>'
            + '<span class="lpp-stat-v">not yet</span></div>')
      + '</div>'
      + '<p class="lpp-track-head">' + esc(lv.headline) + '</p>'
      + '</section>';
  }

  function trackHtml(byTrack) {
    var nb = byTrack && byTrack.non_buyer;
    if (!nb || !nb.calls) return '';
    return '<section class="lpp-track">'
      + '<p class="lpp-lab">Calls that never reached a buyer</p>'
      + '<p class="lpp-track-note">Scored on getting to the person who could decide — '
      + 'not on discovery, objections or closing. Kept separate because the two '
      + 'are not the same number.</p>'
      + '<div class="lpp-head-stats">'
        + stat('Calls', nb.calls)
        + stat('Average', nb.average == null ? '—' : nb.average)
        + stat('Best', nb.best == null ? '—' : nb.best)
        + (nb.direction !== 'unknown'
          ? '<div class="lpp-stat lpp-' + TONE[nb.direction] + '"><span class="lpp-stat-k">Trend</span>'
            + '<span class="lpp-stat-v">' + ARROW[nb.direction] + ' ' + esc(deltaLabel(nb.overallDelta)) + '</span></div>'
          : '<div class="lpp-stat lpp-none"><span class="lpp-stat-k">Trend</span>'
            + '<span class="lpp-stat-v">not yet</span></div>')
      + '</div>'
      + '<p class="lpp-track-head">' + esc(nb.headline) + '</p>'
      + '</section>';
  }

  /* ── MASTERY ────────────────────────────────────────────────────────
     A word, never a chip, a bar or a number. This panel has deliberately
     never had a confidence-badge vocabulary -- it expresses certainty as
     prose and by WITHHOLDING claims (no arrow below threshold, "not yet",
     "needs 3"), and mastery extends that habit rather than importing a
     rating system. A bar would imply a scale, and there isn't one.

     Two words are shown together, always: what the seller has demonstrated
     and how dependable they are now. Either alone lies -- the first lets a
     stale claim stand, the second lets a bad week erase a career.

     NOTE FOR ANYONE EDITING: the class prefix here is `lpp-mastery`, and it
     must never contain the substring `lpp-track`. Three seam assertions
     check for the ABSENCE of `lpp-track` on fixtures where this section
     still renders, so a class like `lpp-mastery-track` would fail them. */
  var MASTERY_LABEL = {
    discovery: 'Discovery',
    listening_and_building: 'Listening and building',
    grounding_claims: 'Grounding what you claim',
    objection_handling: 'Handling objections',
    pitch_discipline: 'Pitch discipline',
    authority_and_routing: 'Reaching a decision-maker'
  };
  var MASTERY_WORD = {
    insufficient_evidence: 'Not enough yet',
    developing: 'Developing',
    inconsistent: 'Mixed',
    reliable: 'Reliable',
    strong: 'Strong'
  };

  function masteryRow(st) {
    if (!st) return '';
    var demonstrated = MASTERY_WORD[st.demonstrated_level] || MASTERY_WORD.insufficient_evidence;
    var current = MASTERY_WORD[st.current_reliability] || MASTERY_WORD.insufficient_evidence;
    var basis = st.basis || {};
    var seen = Number(basis.eligible || 0);
    var nothingYet = st.demonstrated_level === 'insufficient_evidence'
      && st.current_reliability === 'insufficient_evidence' && !seen;
    /* "Hasn't come up yet" is a DIFFERENT thing from doing it badly, and it
       must never render as a zero or a dash -- both read as failure. */
    var evidence = nothingYet
      ? 'Hasn&#39;t come up yet'
      : esc(seen) + ' of ' + esc(Number(basis.eligible || 0) + Number(basis.opportunityAbsent || 0)
        + Number(basis.unknown || 0)) + ' calls';
    var unaided = (!nothingYet && Number(basis.unassisted || 0) > 0)
      ? '<span class="lpp-mastery-aid">' + esc(basis.unassisted) + ' unaided</span>' : '';
    var seenAt = (!nothingYet && basis.lastSeen)
      ? '<span class="lpp-mastery-seen">last seen ' + esc(String(basis.lastSeen).slice(0, 10)) + '</span>'
      : '';
    return '<div class="lpp-mastery-row' + (nothingYet ? ' lpp-mastery-none' : '') + '">'
      + '<span class="lpp-mastery-name">' + esc(MASTERY_LABEL[st.skill] || st.skill) + '</span>'
      + '<span class="lpp-mastery-state">'
      + '<b>' + esc(nothingYet ? MASTERY_WORD.insufficient_evidence : demonstrated) + '</b>'
      + (nothingYet ? '' : '<i>now: ' + esc(current) + '</i>')
      + '</span>'
      + '<span class="lpp-mastery-evi">' + evidence + unaided + seenAt + '</span>'
      + (st.why ? '<p class="lpp-mastery-why">' + esc(st.why) + '</p>' : '')
      + '</div>';
  }

  /* Buyer rows first, then the ones that never reached a buyer -- the same
     split and the same shipped wording the track panel already uses. */
  function masteryHtml(mastery) {
    if (!mastery || !mastery.states || !mastery.states.length) return '';
    var buyer = [];
    var other = [];
    for (var i = 0; i < mastery.states.length; i += 1) {
      var st = mastery.states[i];
      if (st.track === 'buyer') buyer.push(st); else other.push(st);
    }
    var out = '<section class="lpp-mastery">'
      + '<p class="lpp-lab">What you can do</p>';
    var j;
    for (j = 0; j < buyer.length; j += 1) out += masteryRow(buyer[j]);
    if (other.length) {
      out += '<p class="lpp-mastery-sub">Calls that never reached a buyer</p>';
      for (j = 0; j < other.length; j += 1) out += masteryRow(other[j]);
    }
    return out + '</section>';
  }

  /* The whole page: the buyer track, then the non-buyer one if it exists.
     `byTrack.buyer` is what the page has always shown -- a founder with no
     gatekeeper calls sees exactly what they saw before. */
  function htmlByTrack(byTrack, mastery) {
    if (!byTrack) return emptyHtml(null) + masteryHtml(mastery);
    var buyer = byTrack.buyer;
    var others = trackHtml(byTrack) + liveHtml(byTrack);
    if ((!buyer || !buyer.calls) && others) {
      /* No rehearsals yet, but something to show. The empty state under a
         panel that plainly has calls in it would read as a bug. */
      return others + masteryHtml(mastery);
    }
    return html(buyer) + others + masteryHtml(mastery);
  }

  /* Fetches, builds and renders. The pure module is the only thing that
     decides what any of it means. */
  /* The module arrives asynchronously and the review page may render before
     it does. Waits briefly rather than rendering an empty panel that never
     fills, and gives up quietly rather than leaving a spinner forever. */
  async function moduleReady() {
    if (MOD) return MOD;
    for (var i = 0; i < 40 && !MOD; i += 1) {
      await new Promise(function (r) { setTimeout(r, 25); });
    }
    return MOD;
  }

  async function load(mountEl, opts) {
    var o = opts || {};
    var mod = V.practiceProgressModule || await moduleReady();
    if (!mod || !mountEl) return null;
    var rows = [];
    var mastery = o.mastery || null;
    if (o.rows) { rows = o.rows; }
    else if (V.sb) {
      /* TWO READS, ONE LIST, THREE TRACKS. Rehearsals and real calls live in
         different tables because they are different denominators; they are
         concatenated here only so the pure module can partition them, and
         the partition is what keeps them apart. A failure on either side
         costs that track and not the page -- a founder whose real calls
         cannot be read should still see their rehearsals. */
      try {
        var res = await V.sb.rpc('practice_progress_read_v1', { p_limit: o.limit || 50 });
        var d = res && res.data;
        if (d && d.ok && Array.isArray(d.rows)) rows = rows.concat(d.rows);
      } catch (e) { /* the practice track is the casualty, not the screen */ }
      try {
        var lres = await V.sb.rpc('live_progress_read_v1', { p_limit: o.limit || 50 });
        var ld = lres && lres.data;
        if (ld && ld.ok && Array.isArray(ld.rows)) rows = rows.concat(ld.rows);
      } catch (e) { /* the live track is the casualty, not the screen */ }
      try {
        var mres = await V.sb.rpc('practice_mastery_read_v1', { p_projection: 'current' });
        var md = mres && mres.data;
        if (md && md.ok && md.status === 'canonical') mastery = md;
      } catch (e) { /* mastery is the casualty, not the screen */ }
    }
    /* SPLIT BEFORE ANYTHING IS COMPUTED, not after. buildProgress is the
       per-track calculation and its minimums apply per track: a track with
       two calls says "not enough yet" rather than borrowing the other
       track's calls to reach a number. */
    var byTrack = mod.buildProgressByTrack({ rows: rows });
    mountEl.innerHTML = htmlByTrack(byTrack, mastery);
    return byTrack;
  }

  V.liPracticeProgress = { html: html, htmlByTrack: htmlByTrack, load: load };
}());
