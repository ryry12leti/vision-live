/* ════════════════════════════════════════════════════════════════════════
   THE REVIEW SCREEN.

   The score gets attention. The evidence creates trust. So the number is
   large and immediate, and directly beneath it sit the two moments that
   actually decided the call -- quoted, timestamped, and playable. A founder
   should be able to hear themselves make the mistake, not just read about it.

   Everything here is READ. The score arrived decided by the server; this
   file has no arithmetic in it.
   ══════════════════════════════════════════════════════════════════════ */
(function (V) {
  'use strict';

  var esc = function (v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var RV = null;
  import('../goal-engine/practice/practice-review.js').then(function (m) { RV = m; });

  /* atMs is where the AUDIO is. selRow is what the founder CHOSE to look at.
     Keeping them apart is the whole point: seeking runs up two seconds early
     so a moment has lead-in, which means the playhead is deliberately NOT on
     the line being discussed, and scrubbing must never be read as picking a
     sales event. */
  var state = { sessionId: null, review: null, model: null, audio: null, peaks: null,
    playing: false, atMs: 0, open: null, full: false, error: null, deleted: false,
    selRow: null, selRange: null };
  var el = null, tick = null;

  function sessionFromUrl() {
    try { return new URLSearchParams(location.search).get('review'); } catch (e) { return null; }
  }
  function shell(html) {
    var host = document.getElementById('visionPracticeReview');
    if (!host) {
      host = document.createElement('section');
      host.id = 'visionPracticeReview';
      host.className = 'lpr';
      document.body.insertBefore(host, document.body.firstChild);
      document.documentElement.classList.add('lpc-open');
    }
    host.innerHTML = html;
    return host;
  }
  var mmss = function (ms) {
    var s = Math.max(0, Math.round((ms || 0) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  /* ── AUDIO ────────────────────────────────────────────────────────────
     Decoded once, locally. Practice recordings are short, there is no
     waveform provider involved, and the file never becomes a public URL. */
  async function loadAudio(path) {
    try {
      var dl = await V.sb.storage.from('practice-audio').download(path);
      if (dl.error || !dl.data) return null;
      var buf = await dl.data.arrayBuffer();
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var actx = new Ctx();
      var decoded = await actx.decodeAudioData(buf.slice(0));
      var ch = decoded.getChannelData(0);
      /* Bounded peak set: enough to draw, small enough to keep. */
      var N = 320, block = Math.floor(ch.length / N), peaks = [];
      for (var i = 0; i < N; i += 1) {
        var max = 0;
        for (var j = 0; j < block; j += 8) { var v = Math.abs(ch[i * block + j] || 0); if (v > max) max = v; }
        peaks.push(max);
      }
      var top = Math.max.apply(null, peaks) || 1;
      state.peaks = peaks.map(function (p) { return p / top; });

      /* ── PLAYED FROM THE DECODED BUFFER, NOT AN <audio> ELEMENT ────────
         The recording is WebM/Opus in a private blob, and an audio element
         refused it outright -- "the element has no supported sources" --
         while decodeAudioData handled the very same bytes without
         complaint. The buffer is already decoded to draw the waveform, so
         play it from there: one decode, no second codec path, and seeking
         is exact because it is arithmetic rather than a hint to a media
         element. */
      var player = {
        durationMs: decoded.duration * 1000,
        offsetSec: 0, startedAt: 0, node: null, playing: false,
        currentMs: function () {
          return this.playing
            ? Math.min(this.durationMs, (this.offsetSec + (actx.currentTime - this.startedAt)) * 1000)
            : this.offsetSec * 1000;
        },
        play: function (fromMs) {
          this.stopNode();
          if (typeof fromMs === 'number') this.offsetSec = Math.max(0, fromMs / 1000);
          if (this.offsetSec >= decoded.duration) this.offsetSec = 0;
          var node = actx.createBufferSource();
          node.buffer = decoded;
          node.connect(actx.destination);
          node.onended = function () {
            if (player.node === node && player.playing) { player.playing = false; onEnded(); }
          };
          try { if (actx.state === 'suspended') actx.resume(); } catch (e) { /* gesture already given */ }
          node.start(0, this.offsetSec);
          this.node = node; this.startedAt = actx.currentTime; this.playing = true;
        },
        pause: function () {
          if (!this.playing) return;
          this.offsetSec = this.currentMs() / 1000;
          this.stopNode();
          this.playing = false;
        },
        stopNode: function () {
          if (!this.node) return;
          try { this.node.onended = null; this.node.stop(); } catch (e) { /* already stopped */ }
          this.node = null;
        },
      };
      /* Drives the playhead and the transcript highlight while playing. */
      if (tick) clearInterval(tick);
      tick = setInterval(function () {
        if (state.audio && state.audio.player.playing) {
          state.atMs = state.audio.player.currentMs();
          if (state.selRange && state.selRange.endMs != null && state.atMs > state.selRange.endMs) {
            state.selRow = null; state.selRange = null;
          }
          paintPlayhead();
        }
      }, 100);
      return { player: player, durationMs: player.durationMs };
    } catch (e) { return null; }
  }
  function onEnded() { state.playing = false; render(); }

  /* sel === undefined leaves the selection alone; sel === null clears it
     (a manual scrub); an object selects that transcript row. */
  function select(sel) {
    if (sel === undefined) return;
    state.selRow = sel ? sel.rowId || null : null;
    state.selRange = sel && sel.atMs != null ? { atMs: sel.atMs, endMs: sel.endMs } : null;
  }
  function seekTo(ms, sel) {
    var at = Number(ms);
    if (!isFinite(at) || at < 0) at = 0;
    select(sel);
    if (!state.audio) { state.atMs = at; render(); return; }
    state.audio.player.play(at);
    state.playing = true;
    state.atMs = at;
    render();
  }
  function togglePlay() {
    if (!state.audio) return;
    if (state.playing) { state.audio.player.pause(); state.playing = false; }
    else { state.audio.player.play(); state.playing = true; }
    state.atMs = state.audio.player.currentMs();
    render();
  }

  /* WHICH LINE IS THE FOUNDER LOOKING AT. A chosen moment wins outright.
     Otherwise, only while audio is actually running, the line the playhead
     is inside. A parked playhead asserts nothing. */
  function activeRow() {
    var rows = (state.model && state.model.transcript) || [];
    var i;
    if (state.selRow) {
      for (i = 0; i < rows.length; i += 1) if (rows[i].rowId === state.selRow) return rows[i];
      return null;
    }
    if (!state.playing) return null;
    /* Greatest start at or before the playhead -- NOT array order, because a
       retry is spoken after the turn that follows it in sequence. */
    var best = null;
    for (i = 0; i < rows.length; i += 1) {
      var r = rows[i];
      if (r.atMs == null || r.atMs > state.atMs) continue;
      if (r.endMs != null && state.atMs > r.endMs) continue;
      if (!best || r.atMs > best.atMs) best = r;
    }
    return best;
  }
  function paintPlayhead() {
    var rows = (state.model && state.model.transcript) || [];
    var head = document.getElementById('lprHead');
    var now = document.getElementById('lprNow');
    if (head && state.audio) {
      head.style.left = Math.max(0, Math.min(100, (state.atMs / state.audio.durationMs) * 100)) + '%';
      if (now) now.textContent = mmss(state.atMs);
    }
    /* querySelectorAll: one stale highlight left behind is a wrong answer. */
    Array.prototype.forEach.call(document.querySelectorAll('.lpr-tline.is-now'),
      function (n) { n.classList.remove('is-now'); });
    Array.prototype.forEach.call(document.querySelectorAll('.lpr-w.is-said'),
      function (n) { n.classList.remove('is-said'); });
    if (!rows.length) return;
    var row = activeRow();
    if (!row) return;
    var node = document.querySelector('[data-trow="' + row.rowId + '"]');
    if (!node) return;
    node.classList.add('is-now');
    revealLine(node);
    paintWords(node, row);
  }
  /* Bring the lit line to the top of the TRANSCRIPT BOX only. Using
     scrollIntoView here would drag the whole page down to the transcript and
     throw away the moment the founder just opened. */
  function revealLine(node) {
    var box = node.parentNode;
    if (!box || !box.classList || !box.classList.contains('lpr-tr')) return;
    var top = node.offsetTop - box.offsetTop;
    if (top >= box.scrollTop && top + node.offsetHeight <= box.scrollTop + box.clientHeight) return;
    box.scrollTop = Math.max(0, top - box.clientHeight / 3);
  }

  /* WORD PRECISION ONLY WHERE THE WORDS WERE ACTUALLY TIMED. A line without
     timings still highlights as a line; nothing is placed that was not
     measured. */
  function paintWords(node, row) {
    if (!row.words || !row.words.length) return;
    var from, to;
    if (state.selRow === row.rowId && state.selRange) {
      from = state.selRange.atMs;
      to = state.selRange.endMs == null ? state.selRange.atMs : state.selRange.endMs;
    } else if (state.playing) { from = state.atMs; to = state.atMs; }
    else return;
    Array.prototype.forEach.call(node.querySelectorAll('.lpr-w'), function (w) {
      var ws = Number(w.getAttribute('data-ws'));
      var we = Number(w.getAttribute('data-we'));
      if (ws <= to && we >= from) w.classList.add('is-said');
    });
  }

  /* ── PIECES ─────────────────────────────────────────────────────────── */
  function scoresHtml(m) {
    if (m.insufficient) {
      return '<section class="lpr-scores lpr-thin">'
        + '<p class="lpr-band">Not enough call evidence</p>'
        + '<p class="lpr-expl">' + esc(m.result.explanation) + '</p></section>';
    }
    var b = m.scores.band;
    return '<section class="lpr-scores lpr-band-' + esc(b.id) + '">'
      + '<div class="lpr-big"><span class="lpr-n">' + esc(m.scores.overall) + '</span>'
        + '<span class="lpr-of">/ 100</span></div>'
      + '<p class="lpr-band">' + esc(b.label) + '</p>'
      + '<div class="lpr-split">'
        + '<div><span class="lpr-lab">Sales execution</span><b>' + esc(m.scores.sales) + '</b></div>'
        + '<div><span class="lpr-lab">Delivery</span><b>' + esc(m.scores.delivery) + '</b></div>'
      + '</div></section>';
  }

  /* What a play button is ABOUT, as distinct from where it seeks to. */
  function rowAttrs(x) {
    if (!x || !x.rowId || x.atMs == null) return '';
    return ' data-row="' + esc(x.rowId) + '" data-from="' + x.atMs + '"'
      + (x.endMs != null ? ' data-to="' + x.endMs + '"' : '');
  }

  function momentCard(kind, x) {
    if (!x) return '';
    var playable = state.audio && x.atMs != null;
    return '<section class="lpr-card lpr-' + kind + '">'
      + '<p class="lpr-lab">' + (kind === 'win' ? 'Biggest win' : 'Biggest leak') + '</p>'
      + '<h3>' + esc(x.headline) + '</h3>'
      + (x.said ? '<p class="lpr-said">&ldquo;' + esc(x.said) + '&rdquo;</p>' : '')
      + (x.why ? '<p class="lpr-why">' + esc(x.why) + '</p>' : '')
      /* VISION CAUGHT ITSELF, AND SAYS SO. Set apart from `why` on purpose --
         `why` explains the verdict; this explains that the verdict changed
         since the call, live reaction included. Absent on every card the
         live and final reads agreed on, which is most of them. */
      + (x.revisionNote ? '<p class="lpr-revised"><span class="lpr-revised-lab">'
        + 'Since the call</span> ' + esc(x.revisionNote) + '</p>' : '')
      + (x.impact ? '<p class="lpr-impact">' + esc(x.impact) + '</p>' : '')
      + (x.better ? '<div class="lpr-better"><span class="lpr-lab">Try this instead</span>'
        + '<p>&ldquo;' + esc(x.better) + '&rdquo;</p></div>' : '')
      + (playable ? '<button type="button" class="lpr-play" data-seek="' + x.seekMs + '"'
        + rowAttrs(x) + '>Play ' + esc(x.time) + '</button>'
        : (x.time ? '<span class="lpr-at">' + esc(x.time) + '</span>' : ''))
      + '</section>';
  }

  function timelineHtml(m) {
    if (!m.moments.length) return '';
    if (!state.audio) {
      /* NO RECORDING, NO FAKE WAVEFORM. The moments still matter. */
      return '<section class="lpr-card lpr-timeline">'
        + '<p class="lpr-lab">Moments that mattered</p>'
        + '<div class="lpr-moments">' + m.moments.map(function (x, i) {
          return '<button type="button" class="lpr-mo" data-moment="' + i + '">'
            + '<span class="lpr-mo-t">' + esc(x.time) + '</span>'
            + '<span class="lpr-mo-l">' + esc(x.label) + '</span></button>';
        }).join('') + '</div>'
        + (state.deleted ? '<p class="lpr-note">The recording for this call has been deleted. '
          + 'Everything else is still here.</p>' : '')
        + momentDetail(m) + '</section>';
    }
    var dur = state.audio.durationMs || 1;
    var bars = (state.peaks || []).map(function (p, i) {
      return '<span class="lpr-wbar" style="height:' + Math.max(6, Math.round(p * 100)) + '%;left:'
        + ((i / state.peaks.length) * 100) + '%"></span>';
    }).join('');
    var dots = m.moments.map(function (x, i) {
      return '<button type="button" class="lpr-dot' + (x.isLeak ? ' is-leak' : '')
        + (state.open === i ? ' is-open' : '') + '"'
        + ' style="left:' + Math.min(99, (x.atMs / dur) * 100) + '%" data-moment="' + i + '"'
        + ' aria-label="' + esc(x.label) + ' at ' + esc(x.time) + '"></button>';
    }).join('');
    var marks = m.moments.map(function (x, i) {
      return '<button type="button" class="lpr-mo' + (x.isLeak ? ' is-leak' : '')
        + (state.open === i ? ' is-open' : '') + '" data-moment="' + i + '">'
        + '<span class="lpr-mo-t">' + esc(x.time) + '</span>'
        + '<span class="lpr-mo-l">' + esc(x.label) + '</span></button>';
    }).join('');
    return '<section class="lpr-card lpr-timeline">'
      + '<div class="lpr-thead"><p class="lpr-lab">Moments that mattered</p>'
        + '<span class="lpr-clock"><b id="lprNow">0:00</b> / ' + esc(mmss(dur)) + '</span></div>'
      + '<div class="lpr-wavewrap">'
        + '<button type="button" class="lpr-pp" id="lprPlay">' + (state.playing ? 'Pause' : 'Play') + '</button>'
        + '<div class="lpr-wave" id="lprWave">' + bars + dots
          + '<span class="lpr-head" id="lprHead"></span></div>'
      + '</div>'
      + '<div class="lpr-moments">' + marks + '</div>'
      + momentDetail(m) + '</section>';
  }

  function momentDetail(m) {
    if (state.open == null || !m.moments[state.open]) return '';
    var x = m.moments[state.open];
    return '<div class="lpr-detail">'
      + '<p class="lpr-lab">' + esc(x.time) + ' &middot; ' + esc(x.label) + '</p>'
      + '<p class="lpr-said">&ldquo;' + esc(x.said) + '&rdquo;</p>'
      + (x.better ? '<div class="lpr-better"><span class="lpr-lab">Try this instead</span>'
        + '<p>&ldquo;' + esc(x.better) + '&rdquo;</p></div>' : '')
      + (state.audio ? '<button type="button" class="lpr-play" data-seek="' + x.seekMs + '"'
        + rowAttrs(x) + '>Replay</button>' : '')
      + '</div>';
  }

  function guidedHtml(m) {
    if (!m.guided.length) return '';
    return m.guided.map(function (g) {
      return '<section class="lpr-card lpr-guided">'
        + '<p class="lpr-lab">Guided correction &middot; ' + esc(g.time) + '</p>'
        + '<div class="lpr-ga"><span class="lpr-galab">First attempt</span>'
          + '<p>&ldquo;' + esc(g.attempt.said) + '&rdquo;</p>'
          + (state.audio && g.attempt.atMs != null
            ? '<button type="button" class="lpr-play" data-seek="' + g.attempt.seekMs + '"'
              + rowAttrs(g.attempt) + '>Play attempt</button>' : '')
        + '</div>'
        + (g.retry ? '<div class="lpr-gr"><span class="lpr-galab">'
            + (g.retry.accepted ? 'Retry &middot; corrected' : 'Retry &middot; not accepted') + '</span>'
            + '<p>&ldquo;' + esc(g.retry.said) + '&rdquo;</p>'
            + (state.audio && g.retry.atMs != null
              ? '<button type="button" class="lpr-play" data-seek="' + g.retry.seekMs + '"'
                + rowAttrs(g.retry) + '>Play retry</button>' : '')
          + '</div>'
          : '<p class="lpr-why">You were not able to correct this one during the call.</p>')
        + '</section>';
    }).join('');
  }

  /* ── CORRECTIONS ────────────────────────────────────────────────────
     buildReviewPayload() has always spread piped.corrections onto the wire
     verbatim -- revisionNote included, since that fix -- and buildReview()
     here has always carried the whole array through unchanged. Nothing on
     this screen ever iterated it: a founder saw the single biggest-win and
     biggest-leak cards and nothing else, while the richer per-mistake plan
     (the exact line, what it cost, the move, up to three ways to say it
     instead) sat in the API response reachable only from devtools. */
  function correctionOrdinal(n) {
    return n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
  }
  /* observedConsequence() (practice-pipeline.js) never produces display
     text -- it returns a structured observation of the prospect's next
     real reaction: { kind:'observed', reactionType, sequence, citations,
     findingId }. Turning that into a sentence was never done anywhere, so
     `esc(impact)` on the raw object silently rendered the literal string
     "[object Object]" on screen -- found on a real staging call, where
     every correction whose whatHappened WAS populated showed exactly that.
     One phrase per reactionType, all eleven reaction-reader.js can ever
     emit, quoting the prospect's own line when one was captured. */
  var OBSERVED_REACTION_PHRASE = {
    explicit_answer: 'They answered',
    explicit_do_not_contact: 'They told you to stop contacting them',
    explicit_refusal_to_proceed: 'They refused to continue',
    explicit_refusal_to_answer: 'They declined to answer',
    explicit_correction: 'They corrected you',
    explicit_objection: 'They raised an objection',
    explicit_current_provider_satisfaction: 'They said they were happy with what they already have',
    explicit_lack_of_priority: 'They said this was not a priority',
    explicit_clarification_request: 'They asked you to clarify',
    explicit_prospect_question: 'They asked a question of their own',
    explicit_permission_to_continue: 'They invited you to keep going',
  };
  function observedImpactText(w) {
    var phrase = OBSERVED_REACTION_PHRASE[w.reactionType] || 'This is what happened next';
    var quote = w.citations && w.citations[0] && w.citations[0].quote;
    return quote ? phrase + ': “' + quote + '”' : phrase + '.';
  }
  function correctionCard(x, i, total) {
    var playable = state.audio && x.atMs != null;
    var time = typeof x.atMs === 'number' ? mmss(x.atMs) : null;
    var alts = (x.couldSayInstead || []).filter(Boolean);
    /* whatHappened, when present, is that structured observation object,
       never plain text -- riskIfUnobserved is the plain-text field, used
       only where nothing was actually observed, so the two never both
       have content. */
    var impact = x.whatHappened ? observedImpactText(x.whatHappened) : x.riskIfUnobserved;
    return '<section class="lpr-card lpr-correction">'
      + '<p class="lpr-lab">' + (x.repeatOf ? esc(correctionOrdinal(x.repeatOf)) + ' time this happened'
        : 'Correction ' + (i + 1) + ' of ' + total) + (time ? ' &middot; ' + esc(time) : '') + '</p>'
      + (x.whatYouSaid ? '<p class="lpr-said">&ldquo;' + esc(x.whatYouSaid) + '&rdquo;</p>' : '')
      + (x.whatWasWrong ? '<p class="lpr-why">' + esc(x.whatWasWrong) + '</p>' : '')
      + (x.revisionNote ? '<p class="lpr-revised"><span class="lpr-revised-lab">Since the call</span> '
        + esc(x.revisionNote) + '</p>' : '')
      + (impact ? '<p class="lpr-impact">' + esc(impact) + '</p>' : '')
      + (x.bestMoveHere ? '<p class="lpr-move"><span class="lpr-move-lab">The move</span> '
        + esc(x.bestMoveHere) + '</p>' : '')
      + (alts.length ? '<div class="lpr-better"><span class="lpr-lab">Try this instead</span>'
        + alts.map(function (l) { return '<p>&ldquo;' + esc(l) + '&rdquo;</p>'; }).join('') + '</div>'
        /* Honest absence, not a filled space. wtsiAvailable is false only
           when every candidate line failed the locked move -- the card
           still names the move above, and must not fall back to a sentence
           that fails it the same way. */
        : (x.wtsiAvailable === false ? '<p class="lpr-why lpr-no-alt">No safe wording for this one '
          + 'survived review — the move above is what to change.</p>' : ''))
      + (playable ? '<button type="button" class="lpr-play" data-seek="' + x.seekMs + '"'
        + rowAttrs(x) + '>Play ' + esc(time) + '</button>'
        : (time ? '<span class="lpr-at">' + esc(time) + '</span>' : ''))
      + '</section>';
  }
  /* ── DELETED: "WHERE VISION CHANGED ITS MIND" (Phase 5 WP-0, defect D) ──
     It filtered turns on `revisedFromLive`, but that field never survives
     the wire: piped.scoredTurns carries only founder_action/detected_events
     and applyScoredLabels copies exactly those two -- so the card rendered
     empty on every real review since it shipped, and its data-row was never
     bound to a click handler either. The reversal story it wanted to tell
     IS told, on the cards that carry it: biggestWin/biggestLeak/corrections
     arrive with their own server-side `revisionNote` ("Since the call"),
     which does reach the screen. */

  function correctionsHtml(m) {
    var list = (m.corrections || []).filter(function (x) { return x && x.whatYouSaid; });
    if (!list.length) return '';
    return list.map(function (x, i) { return correctionCard(x, i, list.length); }).join('');
  }

  /* ── THE ONE HIGHEST-LEVERAGE IMPROVEMENT (Phase 5 WP-2) ──────────────
     The server's own top-ranked correction — correctionPlan already orders
     by impact × evidence × teaching value, so taking [0] is reading its
     decision, not making a second one. Compact on purpose: the move, one
     way to say it (or the pipeline's own honest absence), and the play
     button that jumps to the exact moment. The full card, with every
     alternative and the observed consequence, lives in the full review.
     Absent when there is nothing to improve — no chrome. */
  function improveHtml(m) {
    var x = ((m.corrections || []).filter(function (c) { return c && c.whatYouSaid; }))[0];
    if (!x) return '';
    var playable = state.audio && x.atMs != null;
    var line = (x.couldSayInstead || []).filter(Boolean)[0] || null;
    return '<section class="lpr-card lpr-improve">'
      + '<p class="lpr-lab">Do this differently next time</p>'
      + (x.bestMoveHere ? '<h3>' + esc(x.bestMoveHere) + '</h3>' : '')
      + (x.whatWasWrong ? '<p class="lpr-why">' + esc(x.whatWasWrong) + '</p>' : '')
      + (line ? '<div class="lpr-better"><span class="lpr-lab">One way to say it</span>'
        + '<p>&ldquo;' + esc(line) + '&rdquo;</p></div>'
        : (x.wtsiAvailable === false
          ? '<p class="lpr-why">No suggested wording survived VISION’s own quality bar for this moment '
            + '— the diagnosis stands on its own.</p>' : ''))
      + (x.revisionNote ? '<p class="lpr-revised"><span class="lpr-revised-lab">Since the call</span> '
        + esc(x.revisionNote) + '</p>' : '')
      + (playable ? '<button type="button" class="lpr-play" data-seek="' + x.seekMs + '"'
        + rowAttrs(x) + '>Play ' + esc(mmss(x.atMs)) + '</button>' : '')
      + '</section>';
  }

  function patternsHtml(m) {
    if (!m.patterns.length) return '';
    return '<section class="lpr-card"><p class="lpr-lab">Pattern hurting your call</p>'
      + m.patterns.map(function (p) {
        return '<div class="lpr-pat"><h4>' + esc(p.why) + '</h4>'
          + '<span class="lpr-count">' + esc(p.evidenceCount) + ' moment'
          + (p.evidenceCount === 1 ? '' : 's') + '</span></div>';
      }).join('') + '</section>';
  }

  function scriptHtml(m) {
    if (!m.scriptReliance) return '';
    return '<section class="lpr-card"><p class="lpr-lab">Script reliance</p>'
      + '<div class="lpr-pct">' + esc(m.scriptReliance.overall) + '%</div>'
      + (m.scriptReliance.breakdown.length
        ? '<div class="lpr-bars">' + m.scriptReliance.breakdown.map(function (b) {
          return '<div class="lpr-brow"><span>' + esc(b[0]) + '</span>'
            + '<span class="lpr-btrack"><i style="width:' + Math.round(b[1]) + '%"></i></span>'
            + '<b>' + esc(Math.round(b[1])) + '%</b></div>';
        }).join('') + '</div>' : '')
      + '<p class="lpr-why">' + esc(m.scriptReliance.interpretation) + '</p></section>';
  }

  function deliveryHtml(m) {
    if (!m.delivery.categories.length) return '';
    return '<section class="lpr-card"><p class="lpr-lab">How you sounded</p>'
      + (m.delivery.interpretation ? '<p class="lpr-why lpr-lead">' + esc(m.delivery.interpretation) + '</p>' : '')
      /* WHAT THIS SECTION MEASURES, before the numbers rather than after
         them. Without it "Approachability 20/20" on a call the prospect
         hung up over reads as VISION endorsing how the founder behaved. */
      + (m.delivery.basis ? '<p class="lpr-basis">' + esc(m.delivery.basis) + '</p>' : '')
      + '<div class="lpr-cats">' + m.delivery.categories.map(function (c) {
        /* The SERVER's name for the metric. Title-casing the key here is
           how the founder ended up reading an internal identifier. */
        return '<div class="lpr-cat"><span>' + esc(c.label || c.key) + '</span>'
          + '<b>' + esc(c.score) + '<i>/' + esc(c.max) + '</i></b>'
          + (c.measured ? '<em class="lpr-cat-m">' + esc(c.measured) + '</em>' : '')
          + '</div>';
      }).join('') + '</div></section>';
  }

  /* NO FOCUS, NO "PRACTISE THIS WEAKNESS". The button carries next.focus into
     the next rehearsal, so offering it with a null focus sends the founder
     back to a targeted drill against nothing -- and, worse, tells them there
     IS a named weakness when the review has just said it could not judge. */
  /* WHY THE SCORE IS THIN, IN THE FOUNDER'S TERMS. "Thin" is a fact about
     VISION's evidence and was never shown, so a good seven-turn rehearsal
     came back marked down with nothing saying which quarter of the rubric
     never came up. Named parts, and what would bring each into play. */
  function coverageHtml(m) {
    var c = m.coverage;
    if (!c || c.complete || !c.untested || !c.untested.length) return '';
    return '<section class="lpr-card lpr-cover">'
      + '<p class="lpr-lab">Not scored on this call</p>'
      + '<p class="lpr-why">' + esc(c.explanation) + '</p>'
      + '<ul class="lpr-cover-list">' + c.untested.map(function (u) {
        return '<li><b>' + esc(u.name) + '</b><span>' + esc(u.wouldTest) + '</span></li>';
      }).join('') + '</ul>'
      + '<p class="lpr-cover-note">Your score is out of what actually came up, '
        + 'not out of everything VISION can grade.</p>'
      + '</section>';
  }

  function nextHtml(m) {
    var focus = m.next && m.next.focus;
    return '<section class="lpr-card lpr-next">'
      + '<p class="lpr-lab">Next practice</p>'
      + '<h3>' + esc(m.next.headline) + '</h3>'
      + '<p class="lpr-why">' + esc(m.next.why) + '</p>'
      + '<div class="lpr-actions">'
        + (focus ? '<button type="button" class="lpr-cta" id="lprFocus">Practise this weakness</button>' : '')
        + '<button type="button" class="lpr-cta' + (focus ? ' lpr-quiet' : '') + '" id="lprAgain">'
        + (focus ? 'Full simulation again' : 'Practise again') + '</button>'
      + '</div></section>';
  }

  /* Word spans only when the timings actually cover the line. Partial
     coverage would silently shorten what the founder said, which is worse
     than having no word precision at all. */
  function saidHtml(t) {
    var said = String(t.said || '');
    var words = t.words || [];
    if (!words.length) return esc(said);
    var joined = words.map(function (w) { return w.w; }).join(' ');
    if (joined.replace(/\s+/g, '').length < said.replace(/\s+/g, '').length * 0.8) return esc(said);
    return words.map(function (w) {
      return '<i class="lpr-w" data-ws="' + w.s + '" data-we="' + w.e + '">' + esc(w.w) + '</i>';
    }).join(' ');
  }

  function fullHtml(m) {
    if (!state.full) return '<button type="button" class="lpr-more" id="lprFull">View full review</button>';
    var sales = (state.review.categories && state.review.categories.sales) || {};
    /* Phase 5 WP-2: the deep detail lives HERE now — every correction card
       in full, the patterns, script reliance and the delivery grid moved in
       from the first screen. Nothing was deleted; it moved one click away. */
    var detail = correctionsHtml(m) + patternsHtml(m) + scriptHtml(m) + deliveryHtml(m);
    var NAME = { opening: 'Opening', discovery: 'Discovery', listening: 'Listening', grounding: 'Grounding',
      pitchTiming: 'Pitch timing', objectionHandling: 'Objection handling', qualification: 'Qualification',
      close: 'Close / exit',
      /* The non-buyer set. Without these the renderer falls back to the raw
         key and a founder reads "pitchDiscipline" off their own review. */
      pitchDiscipline: 'Kept the offer back', routing: 'Reaching who decides',
      nextStep: 'Next step' };
    /* WHAT KIND OF CALL THIS WAS, AND WHAT IT THEREFORE COULD NOT SHOW.
       A non-buyer call is scored against its own denominator; saying so is
       the difference between "you scored 18" and "you scored 18 at the one
       job this call actually was". Untested stays untested, out loud. */
    var untested = (state.review && state.review.unscored) || [];
    var isNonBuyer = state.review && state.review.track === 'non_buyer';
    return detail + (isNonBuyer
      ? '<section class="lpr-card"><p class="lpr-lab">What this call was</p>'
        + '<div class="lpr-full"><div class="lpr-fh"><span>They could not buy</span></div>'
        + '<p>They told you the decision was not theirs, so this is scored on getting to '
        + 'the person who could — not on discovery, objections or closing.</p></div>'
        + (untested.length ? '<div class="lpr-full"><div class="lpr-fh">'
          + '<span>Not tested on this call</span></div><p>'
          + esc(untested.map(function (k) { return NAME[k] || k; }).join(', '))
          + '. A call like this cannot show those either way.</p></div>' : '')
        + '</section>'
      : '')
      + '<section class="lpr-card"><p class="lpr-lab">Sales execution</p>'
      + Object.keys(sales).map(function (k) {
        var c = sales[k];
        return '<div class="lpr-full"><div class="lpr-fh"><span>' + esc(NAME[k] || k) + '</span>'
          + '<b>' + (c.status === 'not_tested' ? 'Not tested' : esc(c.score) + '<i>/' + esc(c.max) + '</i>') + '</b></div>'
          + '<p>' + esc(c.why) + '</p></div>';
      }).join('') + '</section>'
      + '<section class="lpr-card"><p class="lpr-lab">Transcript</p>'
      + '<div class="lpr-tr">' + m.transcript.map(function (t) {
        return '<div class="lpr-tline' + (t.coachedAttempt ? ' is-coached' : '') + '" data-trow="' + esc(t.rowId) + '"'
          + (t.atMs != null && state.audio ? ' data-seek="' + Math.max(0, t.atMs - 1000) + '"'
            + ' data-row="' + esc(t.rowId) + '" data-from="' + t.atMs + '"'
            + (t.endMs != null ? ' data-to="' + t.endMs + '"' : '') : '') + '>'
          + '<span class="lpr-who">' + (t.speaker === 'prospect' ? 'Prospect' : 'Founder')
          + (t.coachedAttempt ? ' &middot; coached attempt' : '') + '</span>'
          + (t.time ? '<span class="lpr-tt">' + esc(t.time) + '</span>' : '')
          + '<p>' + saidHtml(t) + '</p></div>';
      }).join('') + '</div></section>';
  }

  function audioNoteHtml() {
    if (!state.audio || state.deleted) return '';
    return '<div class="lpr-privacy"><span>Recording saved for your progress</span>'
      + '<button type="button" class="lpr-linkbtn" id="lprDel">Delete recording</button></div>';
  }

  /* ── RENDER ─────────────────────────────────────────────────────────── */
  /* ── THIS CALL'S TRAINING, AND WHAT IT CHANGED (Phase 5 WP-3) ─────────
     Three independently-degrading parts, none invented here:

     FOCUS — result.review.trainingFocus, persisted by the server at commit
     from the SAME whitelisted explanation the founder saw when the call
     started (trainingFocusFor reads only skill/track/intent/rationale).
     Rendered verbatim; a reopen serves it byte-identical from the cache.

     RECEIPT — read after paint from practice_mastery_observations,
     filtered to THIS session (append-only, RLS select_own). The review
     reads the consequence; it never derives one. The vocabulary mirrors
     the frozen Phase 3 may-claim table: absence is a recorded fact, not a
     failure; unknown is unreadable, not bad; no row means no record was
     written, said plainly.

     NOW — practice_mastery_read_v1('current', skill), the same reader the
     panel below uses, in the panel's own words (TR_WORD kept in sync BY
     HAND with li-practice-progress.js's MASTERY_WORD — classic scripts,
     no imports). Omitted entirely when the projection refuses (stale /
     running / no_projection): a refused read is a refused claim.

     The whole card is absent at render when there is no focus. */
  var TR_WORD = { insufficient_evidence: 'Not enough yet', developing: 'Developing',
    inconsistent: 'Mixed', reliable: 'Reliable', strong: 'Strong' };
  var TR_DEMO = { strong: 'a strong demonstration', adequate: 'an adequate demonstration',
    weak: 'a weak demonstration', none: 'the chance was there and was not engaged' };
  var TR_ASSIST = { unavailable: 'unaided',
    assistance_on_screen: 'with live coaching on screen',
    intervention_with_help_offered: 'after VISION stopped you and offered wording',
    intervention_corrected_unaided: 'corrected unaided after being stopped' };
  function trainingHtml() {
    var tf = state.review && state.review.trainingFocus;
    return '<section class="lpr-card lpr-mastery-cue" id="lprMasteryCue"' + (tf ? '' : ' hidden') + '>'
      + (tf
        ? '<p class="lpr-lab">This call&rsquo;s training</p>'
          + (tf.headline ? '<h3>' + esc(tf.headline) + '</h3>' : '')
          + (tf.why ? '<p class="lpr-why">' + esc(tf.why) + '</p>' : '')
          + '<div id="lprTrainingReceipt"></div>'
          + '<div id="lprTrainingNow"></div>'
          + '<div id="lprTrainingJump"></div>'
        : '')
      + '</section>';
  }
  function receiptLine(obs) {
    if (!obs) return 'No Mastery record was written for this call — nothing was decided either way.';
    if (obs.opportunity === 'absent') {
      return 'The skill never came up on this call — recorded as a fact, not a failure.';
    }
    if (obs.opportunity === 'unknown') {
      var why = obs.context && obs.context.indeterminate_reason;
      return 'This call could not be read fairly for it — recorded as unknown'
        + (why === 'disputed_delivery' ? ' (contested delivery on a turn it relied on).' : '.');
    }
    var demo = TR_DEMO[obs.demonstrated] || null;
    if (!demo) return 'An observation was recorded for this call.';
    var aid = TR_ASSIST[obs.assistance] || null;
    return 'This call recorded ' + demo + (aid ? ', ' + aid : '') + '.';
  }
  /* ── CONTESTED DELIVERY IS LABELLED, NEVER SUPPRESSED (Phase 5 WP-4) ──
     `disputed` means the browser claimed a prospect line was never heard,
     but the founder answered it — the claim contradicts the transcript, so
     the evidence STANDS (per the frozen delivery contract) and the durable
     Mastery ledger separately declines to grade on it. The review's job is
     the middle ground: show the moment, and say its premise was contested.
     Removing a disputed leak would restore the delete button that
     `disputed` was created to remove — the one correction the adversarial
     pass proved would be a regression.

     Read from practice_evidence_read_v1('current') — the canonical
     projection that has carried deliveryProvenance since WP-0 — and
     matched to cards by their own sequence:attempt row anchor. Absent when
     nothing is disputed, absent on any read failure. */
  function paintDisputed() {
    if (!state.sessionId || !V.sb || !V.sb.rpc) return;
    try {
      V.sb.rpc('practice_evidence_read_v1', { p_session_id: state.sessionId, p_projection: 'current' })
        .then(function (r) {
          var d = r && r.data;
          if (!d || d.ok !== true || d.status !== 'canonical') return;
          var keys = {};
          (d.events || []).forEach(function (e) {
            if (e.deliveryProvenance === 'disputed') {
              keys[String(e.subjectSequence) + ':' + String(e.subjectAttemptNo || 1)] = true;
            }
          });
          if (!Object.keys(keys).length) return;
          ['.lpr-leak', '.lpr-improve', '.lpr-correction'].forEach(function (sel) {
            Array.prototype.forEach.call(document.querySelectorAll(sel), function (card) {
              var btn = card.querySelector('[data-row]');
              var row = btn && btn.getAttribute('data-row');
              if (!row || !keys[row] || card.querySelector('.lpr-disputed')) return;
              var note = document.createElement('p');
              note.className = 'lpr-disputed';
              note.textContent = 'The prospect line this moment relies on had contested delivery — '
                + 'it was claimed unheard, but you answered it. Kept, and marked.';
              card.appendChild(note);
            });
          });
        }).catch(function () { /* no label without a canonical read */ });
    } catch (e) { /* the review stands unlabelled */ }
  }

  function paintTraining() {
    var tf = state.review && state.review.trainingFocus;
    if (!tf || !tf.skill || !state.sessionId || !V.sb) return;
    try {
      V.sb.from('practice_mastery_observations')
        .select('skill,track,opportunity,demonstrated,assistance,context')
        .eq('session_id', state.sessionId)
        .then(function (r) {
          var mount = document.getElementById('lprTrainingReceipt');
          if (!mount) return;
          var rows = (r && r.data) || [];
          var obs = rows.find(function (o) { return o.skill === tf.skill; }) || null;
          mount.innerHTML = '<p class="lpr-why"><span class="lpr-lab">Recorded</span> '
            + esc(receiptLine(obs)) + '</p>';
        }).catch(function () { /* the card stands without its receipt */ });
      V.sb.rpc('practice_mastery_read_v1', { p_projection: 'current', p_skill: tf.skill })
        .then(function (r) {
          var d = r && r.data;
          /* Refused (stale / running / no_projection) or empty ⇒ NO claim. */
          if (!d || d.ok !== true || d.status !== 'canonical') return;
          var st = (d.states || []).find(function (x) {
            return x.skill === tf.skill && (!tf.track || x.track === tf.track);
          }) || (d.states || [])[0];
          if (!st) return;
          var mount = document.getElementById('lprTrainingNow');
          if (!mount) return;
          mount.innerHTML = '<p class="lpr-why"><span class="lpr-lab">Where it stands</span> '
            + esc(TR_WORD[st.demonstrated_level] || TR_WORD.insufficient_evidence)
            + ' &middot; now: ' + esc(TR_WORD[st.current_reliability] || TR_WORD.insufficient_evidence)
            + '</p>';
        }).catch(function () { /* no claim without a canonical read */ });
    } catch (e) { /* the review stands without the card's async halves */ }
  }

  function render() {
    var m = state.model;
    if (state.error) {
      shell('<div class="lpr-gate"><p class="lpr-lab">Review</p><p class="lpr-gate-msg">'
        + esc(state.error) + '</p><a class="lpr-back" href="leads.html">Back to Leads</a></div>');
      return;
    }
    if (!m) {
      shell('<div class="lpr-gate"><p class="lpr-lab">Reviewing your call</p>'
        + '<p class="lpr-gate-msg">One moment.</p></div>');
      return;
    }
    /* ── THE FIRST SCREEN, IN PRIORITY ORDER (Phase 5 WP-2) ────────────
       1 outcome (header) · 2 score/band + what was not scored (the strip,
       full-width so on a phone it lands BEFORE the win/leak rail instead
       of after it) · 3-4 biggest win / biggest leak (the rail; on mobile
       it sits right under the strip) · 5 the most important moment (the
       leak card IS the moment — quoted, timestamped, playable; nothing
       here runs a second selection) · 6 the one improvement (the server's
       own top-ranked correction, compact) · 7 the Mastery cue, filled
       only after the panel below actually rendered content.

       A PRIORITY ORDER, NOT SEVEN MANDATORY SLOTS. Every item degrades
       to absence — no placeholder card, no "no win detected". The deep
       detail (every correction card, patterns, script reliance, the
       delivery grid, categories, transcript) moved behind the existing
       "View full review" control. Selection and arrangement only: every
       word shown is server-decided or was already here. */
    shell('<header class="lpr-bar"><div><h1>' + esc(m.result.label) + '</h1>'
        + '<p class="lpr-expl">' + esc(m.result.explanation) + '</p></div>'
        + '<a class="lpr-back" href="leads.html">Back to Leads</a></header>'
      + '<div class="lpr-scroll">'
      + '<div class="lpr-strip">'
        + scoresHtml(m)
        + coverageHtml(m)
      + '</div>'
      + '<div class="lpr-body">'
        + '<div class="lpr-main">'
          + timelineHtml(m)
          + guidedHtml(m)
          + improveHtml(m)
          + trainingHtml()
          + fullHtml(m)
          /* ── WHERE THIS CALL SITS IN THE ARC ───────────────────────
             Last, deliberately. The founder has just finished a call and
             the first thing they want is what happened in THIS one; the
             trend only means something once they have read it. Filled
             asynchronously from practice_progress_read_v1 -- an empty
             mount is the correct intermediate state, and a founder with
             one scored call sees the module's own "too few" copy rather
             than a chart drawn through a single point. */
          + '<section class="lpr-progress lpp" id="lprProgress"></section>'
        + '</div>'
        + '<aside class="lpr-side">'
          + momentCard('win', m.win)
          /* ── SAME MOMENT, SAID ONCE (WP-2 visual QA) ─────────────────
             When the top correction IS the leak moment, the two cards used
             to repeat the same why, the same suggested line and the same
             "Since the call" note side by side. One author, two surfaces —
             so the surfaces split the job: the leak card keeps the MOMENT
             (headline, quote, impact, play), the improvement card owns the
             diagnosis and the wording. A correction about a different
             moment leaves the leak card fully intact. */
          + momentCard('leak', (function () {
            var top = ((m.corrections || []).filter(function (c) { return c && c.whatYouSaid; }))[0];
            if (!m.leak || !top || top.sequence !== m.leak.sequence
              || (top.attemptNo || 1) !== (m.leak.attemptNo || 1)) return m.leak;
            return Object.assign({}, m.leak, { why: null, better: null, revisionNote: null });
          }()))
          + nextHtml(m)
          + audioNoteHtml()
        + '</aside>'
      + '</div>'
      + '</div>');
    bind();
    paintPlayhead();
    paintProgress();
    paintTraining();
    paintDisputed();
  }

  /* Never blocks the review. A failed or slow history read leaves the panel
     empty and the founder still has everything they came for -- progress is
     the least important thing on this screen and must behave like it. */
  function paintProgress() {
    var mount = document.getElementById('lprProgress');
    var P = window.VISION && window.VISION.liPracticeProgress;
    if (!mount || !P) return;
    try {
      var loaded = P.load(mount, { limit: 50 });
      /* ── THE MASTERY CUE (Phase 5 WP-2) ─────────────────────────────
         Item 7 of the first screen, filled only AFTER the panel below
         actually rendered a mastery section — the cue points at real
         content or does not exist. It invents no consequence: the panel
         is the consequence surface, this is a signpost to it. */
      var arm = function () {
        var cue = document.getElementById('lprMasteryCue');
        if (!cue || !mount.querySelector('.lpp-mastery')) return;
        /* WP-3: the card may already be showing the persisted trainingFocus
           — in that case the panel jump lands in its own slot, never over
           the focus content. With no focus, the WP-2 cue behaviour stands. */
        var jumpSlot = document.getElementById('lprTrainingJump');
        var btnHtml = '<button type="button" class="lpr-play" id="lprMasteryJump">See where you stand</button>';
        if (jumpSlot) {
          jumpSlot.innerHTML = btnHtml;
        } else {
          cue.hidden = false;
          cue.innerHTML = '<p class="lpr-lab">Mastery</p>'
            + '<p class="lpr-why">What you can reliably do — including this call — is below.</p>'
            + btnHtml;
        }
        var b = document.getElementById('lprMasteryJump');
        if (b) b.addEventListener('click', function () {
          try { mount.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e2) { /* noop */ }
        });
      };
      if (loaded && typeof loaded.then === 'function') loaded.then(arm).catch(function () {});
      else arm();
    } catch (e) { /* review stands without it */ }
  }

  /* On a phone the opened moment can land below the fold, so the founder
     taps and appears to get nothing. Moved only when it is actually out of
     sight, and only as far as it needs to go. */
  function revealDetail() {
    var d = document.querySelector('.lpr-detail');
    if (!d || !d.getBoundingClientRect) return;
    var r = d.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= (window.innerHeight || 0)) return;
    try { d.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { d.scrollIntoView(); }
  }

  function bind() {
    var selOf = function (b) {
      var row = b.getAttribute('data-row');
      if (!row) return null;
      return { rowId: row, atMs: Number(b.getAttribute('data-from')),
        endMs: b.hasAttribute('data-to') ? Number(b.getAttribute('data-to')) : null };
    };
    Array.prototype.forEach.call(document.querySelectorAll('[data-seek]'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        seekTo(Number(b.getAttribute('data-seek')), selOf(b));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-moment]'), function (b) {
      b.addEventListener('click', function (e) {
        /* MARKERS SIT INSIDE THE WAVEFORM. Without this the scrub listener
           below also fires -- and by then render() has replaced the DOM, so
           it measures a DETACHED node whose width is 0, divides by it, and
           parks the playhead at Infinity. */
        e.stopPropagation();
        var i = Number(b.getAttribute('data-moment'));
        var mo = state.model.moments[i];
        if (state.open === i) { state.open = null; select(null); render(); return; }
        state.open = i;
        select(mo && mo.atMs != null
          ? { rowId: mo.rowId, atMs: mo.atMs, endMs: mo.endMs } : null);
        render();
        /* undefined -- seek the audio, keep the moment the founder chose. */
        if (state.audio && mo) seekTo(mo.seekMs, undefined);
        revealDetail();
      });
    });
    var play = document.getElementById('lprPlay');
    if (play) play.addEventListener('click', togglePlay);
    var wave = document.getElementById('lprWave');
    if (wave && state.audio) {
      wave.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('[data-moment]')) return;
        var r = wave.getBoundingClientRect();
        if (!r.width) return;
        /* A SCRUB IS NOT A CLAIM. Moving the audio by hand clears the
           selection rather than asserting the founder picked a sales event. */
        seekTo(((e.clientX - r.left) / r.width) * state.audio.durationMs, null);
      });
    }
    var full = document.getElementById('lprFull');
    if (full) full.addEventListener('click', function () { state.full = true; render(); });
    var del = document.getElementById('lprDel');
    if (del) del.addEventListener('click', deleteRecording);
    var focus = document.getElementById('lprFocus');
    if (focus) focus.addEventListener('click', function () { practiseAgain(state.model.next.focus); });
    var again = document.getElementById('lprAgain');
    if (again) again.addEventListener('click', function () { practiseAgain(null); });
  }

  /* Back into Practice with the same prospect, Guided, aimed at the leak. */
  function practiseAgain(focus) {
    var handle = null;
    try { handle = sessionStorage.getItem('vision_practice_last_handle'); } catch (e) {}
    if (!handle) { location.href = 'leads.html'; return; }
    var q = 'live-intelligence.html?practice-call=' + encodeURIComponent(handle);
    if (focus) q += '&focus=' + encodeURIComponent(focus);
    location.href = q;
  }

  async function deleteRecording() {
    if (!state.sessionId) return;
    try {
      var d = await V.sb.rpc('practice_recording_delete_v1', { p_session_id: state.sessionId });
      var path = d && d.data && d.data.storage_path;
      if (path) { try { await V.sb.storage.from('practice-audio').remove([path]); } catch (e) {} }
    } catch (e) { /* the review is unaffected either way */ }
    if (state.audio) { try { state.audio.player.pause(); } catch (e) {} }
    if (tick) { clearInterval(tick); tick = null; }
    state.audio = null; state.peaks = null; state.playing = false; state.deleted = true;
    state.atMs = 0;
    /* The review keeps everything except the sound. If it cannot be rebuilt
       the screen still has to stop showing a recording that is gone. */
    try {
      state.model = RV.buildReview(modelArgs({ available: false }));
    } catch (e) { if (state.model) state.model.audio = { available: false, durationMs: null }; }
    render();
  }

  /* ── THE SERVER'S OWN SELECTIONS ──────────────────────────────────────
     buildReview falls back to choosing Biggest Win and Biggest Leak ITSELF,
     from founder_action labels, when it is not handed reconciled ones. Both
     callers here omitted them, so every review screen was showing a leak the
     Reconciler had not chosen -- observed live: the server said "You sold to
     someone who had told you it was not their call" and the screen said "You
     asked again for something they already answered", over the pitch it was
     not about.

     The server decides; this displays. Passing them is what makes that true
     rather than merely stated. */
  function modelArgs(audio) {
    var r = state.review || {};
    return {
      review: r, turns: state.turns, audio: audio,
      authoritative: { win: r.biggestWin || null, leak: r.biggestLeak || null,
        corrections: r.corrections || [] },
    };
  }

  /* ── BOOT ───────────────────────────────────────────────────────────── */
  async function boot() {
    state.sessionId = sessionFromUrl();
    if (!state.sessionId) return;
    render();
    if (!V.backend) { state.error = 'The review needs the backend, and it is not reachable.'; render(); return; }
    if (V.auth && V.auth.requireAuth) { var s = await V.auth.requireAuth(); if (!s) return; }
    while (!RV) await new Promise(function (r) { setTimeout(r, 40); });
    try {
      /* Authoritative: the server scores; this only reads. Re-requesting is
         safe and idempotent, which is what makes reload work. */
      var res = await V.sb.functions.invoke('live-intelligence', {
        body: { action: 'practice_score', sessionId: state.sessionId },
      });
      var d = res && res.data;
      if (!d || d.ok !== true) { state.error = 'That practice call could not be found.'; render(); return; }
      /* ── A TIMING STATE IS NOT A VERDICT (Phase 5 WP-0, defect B) ─────
         The server returns ok:true with a STATUS and no review for two
         non-scored shapes, and this branch used to fall straight through:
         state.review stayed undefined, modelArgs substituted {}, and a call
         that was still SETTLING rendered the "Not enough call evidence"
         screen -- a verdict about the founder, for what was a clock. The
         two statuses are different facts and get different words:
           not_settled           -- the call is still being saved; try again
           insufficient_evidence -- settled, but genuinely too little or
                                    lossy evidence to judge fairly */
      if (!d.review) {
        state.error = d.status === 'not_settled'
          ? 'This call is still being saved. Give it a few seconds, then reload this page.'
          : 'This call ended before enough of the conversation was saved to review it fairly. '
            + 'There is no score to show — that is the honest result, not an error.';
        render(); return;
      }
      state.review = d.review;
      var t = await V.sb.from('practice_turns').select('*')
        .eq('session_id', state.sessionId).order('sequence', { ascending: true });
      /* AUTHORITATIVE LABELS OVER STORED ONES. The rows carry what the
         behaviour engine said live; the server has since reconciled them,
         and a label the reconciler changed must not be redrawn from the
         version it replaced. Applied here, once, before anything reads a
         turn -- so the timeline, the markers and the transcript all agree
         with the score. */
      state.turns = RV.applyScoredLabels((t && t.data) || [], state.review);
      /* The communication-profile read is GONE from this boot (Phase 5
         WP-1): its only consumer was the retired client-side wording
         library. The register-aware wording the founder actually sees is
         composed server-side (waysToSay/composer, profile-aware there) and
         arrives already phrased on the persisted corrections — so this was
         a sequential network round trip before paint that fed nothing. */
      var rec = await V.sb.from('practice_recordings').select('storage_path,duration_ms')
        .eq('session_id', state.sessionId).maybeSingle();
      if (rec && rec.data && rec.data.storage_path) state.audio = await loadAudio(rec.data.storage_path);
      state.model = RV.buildReview(modelArgs(
        state.audio ? { available: true, durationMs: state.audio.durationMs } : null));
      render();
    } catch (e) {
      state.error = 'That practice call could not be loaded.';
      render();
    }
  }

  window.VISION_PRACTICE_REVIEW = { boot: boot, state: state,
    /* For the $0 harness: render a model without a network or a microphone. */
    renderModel: function (model, opts) {
      state.model = model; state.review = (opts && opts.review) || { categories: { sales: {} } };
      state.audio = (opts && opts.audio) || null; state.peaks = (opts && opts.peaks) || null;
      state.full = !!(opts && opts.full);
      state.turns = (opts && opts.turns) || [];
      state.sessionId = (opts && opts.sessionId) || null;
      state.selRow = null; state.selRange = null; state.atMs = 0;
      state.open = null; state.playing = false; state.deleted = false;
      render();
    } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})(window.VISION);
