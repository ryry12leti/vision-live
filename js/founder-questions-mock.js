/* ════════════════════════════════════════════════════════════════════════
   VISION — FOUNDER ANALYST · goal-understanding flow (FRONTEND MOCK)

   Simulates an adaptive interview: each follow-up is chosen from the previous
   answer, so the question count varies rather than being fixed.

   Mock only. No network, no storage, no proof, no XP/Standing/reward writes.
   Every "understanding" here is local string matching, not real inference.
   ════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────── mock admission data ─────────────── */

  const ADMISSION_GOAL = 'Build a business that replaces my full-time income.';

  /* ─────────────── understanding slots ─────────────── */

  const SLOTS = [
    { key: 'venture',  label: 'The venture',        empty: 'What you are actually building.' },
    { key: 'stage',    label: 'Where you are',      empty: 'What exists today.' },
    { key: 'outcome',  label: 'What winning means', empty: 'The number that settles it.' },
    { key: 'timeline', label: 'Your horizon',       empty: 'The date you work against.' },
    { key: 'obstacle', label: 'The real bottleneck',empty: 'What is actually in the way.' }
  ];

  /* ─────────────── adaptive question bank ───────────────
     Variants are matched against the previous answer. First match wins;
     the last entry of each list is the fallback. */

  const OPENER = {
    slot: 'venture',
    q: 'Tell me more about your goal.',
    sub: 'You told admissions what you want. Now tell me what it actually is — in your own words, as if I know nothing about it.',
    chips: []
  };

  const BANK = {
    stage: [
      { match: ['idea', 'thinking', 'planning', 'want to', 'haven\'t', 'have not', 'not started', 'someday', 'concept'],
        q: 'So it is still mostly on paper. What is the furthest you have actually taken it — a conversation, a sketch, a signup form, anything real?',
        chips: ['Nothing exists yet', 'I have notes and a rough plan', 'I talked to a few people'] },
      { match: ['built', 'launched', 'live', 'shipped', 'app', 'site', 'website', 'product', 'prototype', 'mvp'],
        q: 'You have already built something. Is anyone using it yet, and how did they find it?',
        chips: ['Nobody is using it', 'A handful of people, all friends', 'Some strangers found it'] },
      { match: ['customer', 'client', 'revenue', 'sales', 'paying', 'users', 'subscribers', 'orders'],
        q: 'You already have people paying or using it. Roughly how many, and how did the last few actually arrive?',
        chips: ['Under 10, all word of mouth', 'Enough to see a pattern', 'I honestly am not sure'] },
      { match: [],
        q: 'Where does this stand today — what exists right now that somebody else could see, open, or buy?',
        chips: ['Nothing yet', 'Something half-built', 'Something live'] }
    ],
    outcome: [
      { match: ['revenue', 'money', 'income', 'profit', 'salary', 'paid', '$', 'earn'],
        q: 'You keep coming back to money. What is the specific number that would tell you this worked — and over what period?',
        chips: ['Enough to quit my job', 'A set amount per month', 'I have not put a number on it'] },
      { match: ['customer', 'client', 'user', 'audience', 'follower', 'subscriber', 'people'],
        q: 'What number of customers would make this feel real rather than hopeful?',
        chips: ['My first 10', 'Around 100', 'Enough to be consistent'] },
      { match: ['freedom', 'quit', 'leave', 'job', 'escape', 'independent', 'own time'],
        q: 'Freedom is the reason, but it is not a measurement. What has to be true — in numbers — before you would actually walk away from the job?',
        chips: ['A monthly figure I can live on', 'Several months of runway saved', 'I do not know yet'] },
      { match: [],
        q: 'If this goes right, what is the one measurable thing that changes? Give me a number if you can.',
        chips: ['A revenue figure', 'A customer count', 'Something finished and shipped'] }
    ],
    timeline: [
      { match: ['fast', 'quick', 'asap', 'urgent', 'soon', 'immediately', 'now', 'running out'],
        q: 'You want this fast. What is the actual deadline pressing on you — and what happens if you miss it?',
        chips: ['Savings run out', 'A contract ends', 'No hard deadline, just impatience'] },
      { match: ['slow', 'eventually', 'no rush', 'long term', 'someday', 'patient'],
        q: 'You are not in a hurry, which is fine — but open-ended goals drift. What is the furthest out you would still call this a success?',
        chips: ['Within a year', 'Within two years', 'I would rather not set one'] },
      { match: [],
        q: 'By when? Give me the date or the window you are genuinely working against, not the one that sounds impressive.',
        chips: ['3 months', '6 months', '12 months'] }
    ],
    obstacle: [
      { match: ['time', 'busy', 'job', 'work', 'hours', 'schedule', 'kids', 'family'],
        q: 'Time is the constraint. When you do get a free hour, what do you actually spend it on — and is that the thing that moves the business?',
        chips: ['Usually admin and tinkering', 'Learning, not building', 'I mostly do not use it'] },
      { match: ['money', 'funding', 'capital', 'cash', 'budget', 'afford', 'broke', 'invest'],
        q: 'Capital is tight. What is the cheapest possible version of this that would still prove the idea works?',
        chips: ['I could test it manually', 'I would still need to buy tools', 'I am not sure it can be done cheap'] },
      { match: ['know', 'unsure', 'confused', 'figure', 'clarity', 'lost', 'where to start', 'overwhelm'],
        q: 'So it is clarity, not effort. Which single unknown, if it were answered by tomorrow morning, would unblock the most?',
        chips: ['Who exactly to sell to', 'What to charge', 'What to build first'] },
      { match: ['market', 'find', 'reach', 'audience', 'leads', 'traffic', 'attention', 'nobody'],
        q: 'Getting in front of people is the bottleneck. Where have you already tried to find them, and what happened?',
        chips: ['Social posts, no traction', 'Cold outreach, few replies', 'I have not really tried yet'] },
      { match: ['fear', 'scared', 'confidence', 'imposter', 'doubt', 'afraid', 'judge', 'procrastinat'],
        q: 'That is a real blocker, not an excuse. What specifically are you avoiding — the building, or the part where you put it in front of someone?',
        chips: ['Putting it in front of people', 'Charging money for it', 'Committing publicly'] },
      { match: [],
        q: 'What is actually stopping this from moving faster right now?',
        chips: ['Time', 'Money', 'Not knowing what to do next'] }
    ]
  };

  /* Probes deepen the SAME slot when an answer is too thin to work with. */
  const PROBES = {
    venture: {
      q: 'That is the headline, not the substance. Who pays you, what do they get, and why would they pick you over doing nothing?',
      chips: [] },
    stage: {
      q: 'Give me something concrete. What is the last thing you actually did on this, and when?',
      chips: [] },
    outcome: {
      q: 'Put a number on it. Vague targets cannot be measured, and I cannot hold you to them.',
      chips: [] },
    timeline: {
      q: 'A rough window is fine, but I need one. Weeks, months, or a specific date?',
      chips: [] },
    obstacle: {
      q: 'Go one level deeper. That is the symptom — what is underneath it?',
      chips: [] }
  };

  const CORRECTION_PROMPT = {
    q: 'Then tell me what I got wrong.',
    sub: 'Name the part that is off and give me the correct version. I will rewrite my understanding from what you say.',
    chips: []
  };

  /* Keyword → slot, used to route a correction back to the right field. */
  const CORRECTION_ROUTES = [
    { slot: 'timeline', words: ['month', 'week', 'year', 'deadline', 'timeline', 'by ', 'date', 'when', 'horizon'] },
    { slot: 'outcome',  words: ['revenue', 'money', 'number', 'target', 'goal', 'customer', 'winning', 'success', '$'] },
    { slot: 'obstacle', words: ['stopping', 'blocker', 'bottleneck', 'stuck', 'problem', 'in the way', 'hard'] },
    { slot: 'stage',    words: ['already', 'built', 'live', 'launched', 'have not', 'haven\'t', 'stage', 'right now', 'currently'] },
    { slot: 'venture',  words: ['building', 'business', 'company', 'product', 'service', 'idea', 'actually'] }
  ];

  const PUSH_LABELS = {
    supportive: 'Supportive', balanced: 'Balanced',
    demanding: 'Demanding', relentless: 'Relentless'
  };

  /* Ordered low → high. Index drives the slider; `key` is what state stores. */
  const CAP_LEVELS = [
    { key: 'beginner', name: 'Beginner',
      desc: 'You are starting from the ground up. I will explain the reasoning behind every move, not just the move.' },
    { key: 'developing', name: 'Developing',
      desc: 'You know some of it. I will fill the gaps and keep each step small enough to finish.' },
    { key: 'intermediate', name: 'Intermediate',
      desc: 'You can execute most of this alone. I will aim at the parts you keep avoiding.' },
    { key: 'advanced', name: 'Advanced',
      desc: 'You already know what to do. I will hold you to the standard and stay out of your way.' }
  ];
  const RESOURCE_PROMPT = {
    q: 'Do you have anything that would help me understand your goal better?',
    sub: 'You can attach plans, screenshots, research, links, analytics, existing work or anything else that gives useful context.'
  };

  const TIMELINE_RX = /\b(?:\d+\s*(?:day|week|month|year)s?|by\s+(?:the\s+)?(?:end\s+of\s+)?\w+|end\s+of\s+(?:the\s+)?(?:year|month|quarter)|q[1-4]|next\s+(?:year|month|summer|spring))\b/i;

  /* ─────────────── state ─────────────── */

  let state;

  function freshState() {
    return {
      slots: {},          // key -> { text, inferred }
      probed: {},         // key -> true
      corrections: [],    // free-text corrections the user supplied
      current: null,      // the question awaiting an answer
      mode: 'interview',  // 'interview' | 'correcting'
      push: null,
      capability: null,
      /* Mock-only: file NAMES and sizes are kept for display. File contents are
         never read, stored, or uploaded. */
      resources: { note: '', link: '', files: [] },
      busy: false
    };
  }

  /* ─────────────── dom refs ─────────────── */

  const $ = (id) => document.getElementById(id);
  const dom = {
    orb: $('orb'), goalText: $('goalText'), stepper: $('stepper'),
    thread: $('thread'), chips: $('chips'), input: $('answerInput'),
    send: $('sendBtn'), composer: $('composer'),
    slots: $('slots'), panelFoot: $('panelFoot'),
    summaryBody: $('summaryBody'), confirmBtn: $('confirmBtn'), rejectBtn: $('rejectBtn'),
    pushOpts: $('pushOpts'),
    capRail: $('capRail'), capTrack: $('capTrack'), capFill: $('capFill'),
    capNotches: $('capNotches'), capThumb: $('capThumb'), capLabels: $('capLabels'),
    capName: $('capName'), capDesc: $('capDesc'), capContinue: $('capContinue'),
    resComposer: $('resComposer'), resNote: $('resNote'), resLink: $('resLink'),
    resAttachBtn: $('resAttachBtn'), resFileInput: $('resFileInput'), resFiles: $('resFiles'),
    resSend: $('resSend'), resSkipBtn: $('resSkipBtn'),
    recap: $('recap'), restartBtn: $('restartBtn'),
    enterBtn: $('enterBtn'), mockNote: $('mockNote'),
    stages: {
      convo: $('stageConvo'), summary: $('stageSummary'), push: $('stagePush'),
      capability: $('stageCapability'), done: $('stageDone')
    }
  };

  /* ─────────────── small helpers ─────────────── */

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function norm(s) { return (s || '').toLowerCase(); }

  function words(s) { return (s || '').trim().split(/\s+/).filter(Boolean); }

  /* An answer is "thin" when there is not enough in it to build on. */
  function isThin(answer) {
    const w = words(answer);
    return w.length < 5 || answer.trim().length < 24;
  }

  /* Strip trailing punctuation and filler lead-ins. Keeps the user's own words. */
  function asClause(text) {
    let t = (text || '').trim().replace(/\s+/g, ' ').replace(/[.!?,;]+$/, '');
    t = t.replace(/^(?:i think |i guess |basically |well,? |so,? |um,? )/i, '');
    return t;
  }

  function sentences(text) {
    return (text || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  }

  /* The venture line is the only one glued into a sentence frame ("You are
     building X"), so it needs the first-person opener and gerund removed. */
  function ventureClause(text) {
    let t = sentences(text)[0] || text || '';
    t = t.trim().replace(/[.!?,;]+$/, '');
    t = t.replace(/^(?:i'?m|i am|i'?ve|i have|we'?re|we are|we'?ve|we have)\s+/i, '');
    t = t.replace(/^(?:currently|right now|already|just|basically)\s+/i, '');
    t = t.replace(/^(?:trying to|planning to|hoping to|want to|going to)\s+/i, '');
    t = t.replace(/^(?:building|creating|making|starting|launching|developing|running|selling)\s+/i, '');
    /* This clause continues "You are building …", so a leading determiner must
       not stay capitalised. Restricted to determiners so a proper noun
       ("Acme Foods") keeps its capital. */
    t = t.replace(/^(A|An|The|My|Our|Their|This|That|Some|Several|One|Two|Three)\b/,
      (w) => w.toLowerCase());
    return t;
  }

  /* Quote a short fragment around the keyword, without crossing a sentence end. */
  function echoOf(answer, keyword) {
    const pool = sentences(answer);
    let target = pool[0] || answer || '';
    if (keyword) {
      const head = norm(keyword).trim().split(' ')[0];
      const hit = pool.find((s) => norm(s).includes(head));
      if (hit) target = hit;
    }
    const w = words(target);
    let start = 0;
    if (keyword) {
      const head = norm(keyword).trim().split(' ')[0];
      const i = w.findIndex((x) => norm(x).includes(head));
      if (i >= 0) start = Math.max(0, i - 2);
    }
    return w.slice(start, start + 6).join(' ').replace(/[.!?,;]+$/, '');
  }

  function pickVariant(slot, lastAnswer) {
    const list = BANK[slot] || [];
    const hay = norm(lastAnswer);
    for (const v of list) {
      for (const m of v.match) {
        if (hay.includes(norm(m))) return { variant: v, keyword: m };
      }
    }
    return { variant: list[list.length - 1], keyword: null };
  }

  /* ─────────────── understanding state ───────────────
     The interview is COUNT-INDEPENDENT. Every question in the bank above is
     demonstration data only — its size is illustrative and carries no meaning
     for control flow. The interview ends when, and only when,
     evaluateUnderstanding() explicitly reports UNDERSTANDING_COMPLETE. There
     is deliberately no question counter anywhere in this flow. */

  const UNDERSTANDING_COMPLETE = 'understanding_complete';
  const UNDERSTANDING_INCOMPLETE = 'understanding_incomplete';

  function evaluateUnderstanding() {
    const missing = SLOTS.filter((s) => !state.slots[s.key]).map((s) => s.key);
    return {
      status: missing.length ? UNDERSTANDING_INCOMPLETE : UNDERSTANDING_COMPLETE,
      missing: missing,
      nextSlot: missing.length ? missing[0] : null
    };
  }

  /* ─────────────── rendering: thread ─────────────── */

  function addAnalystMessage(text, opts) {
    opts = opts || {};
    const msg = el('div', 'msg analyst');
    msg.appendChild(el('span', 'msg-av', '◆'));
    const body = el('div', 'msg-body');
    if (opts.because) body.appendChild(el('p', 'msg-because', 'Because you said “' + opts.because + '”'));
    body.appendChild(el('p', 'msg-text', text));
    if (opts.sub) body.appendChild(el('p', 'msg-sub', opts.sub));
    msg.appendChild(body);
    dom.thread.appendChild(msg);
    scrollToEnd(msg);
  }

  function addUserMessage(text) {
    const msg = el('div', 'msg user');
    const body = el('div', 'msg-body');
    body.appendChild(el('p', 'msg-text', text));
    msg.appendChild(body);
    dom.thread.appendChild(msg);
    scrollToEnd(msg);
  }

  function showTyping() {
    const msg = el('div', 'msg analyst');
    msg.id = 'typingMsg';
    msg.appendChild(el('span', 'msg-av', '◆'));
    const body = el('div', 'msg-body');
    const dots = el('span', 'dots');
    dots.appendChild(el('i')); dots.appendChild(el('i')); dots.appendChild(el('i'));
    body.appendChild(dots);
    msg.appendChild(body);
    dom.thread.appendChild(msg);
    dom.orb.classList.add('think');
    scrollToEnd(msg);
  }

  function hideTyping() {
    const t = $('typingMsg');
    if (t) t.remove();
    dom.orb.classList.remove('think');
  }

  function scrollToEnd(node) {
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function renderChips(list) {
    dom.chips.textContent = '';
    if (!list || !list.length) { dom.chips.hidden = true; return; }
    list.forEach((c) => {
      const b = el('button', 'chip', c);
      b.type = 'button';
      b.addEventListener('click', () => {
        dom.input.value = c;
        autosize();
        dom.input.focus();
        syncSend();
      });
      dom.chips.appendChild(b);
    });
    dom.chips.hidden = false;
  }

  /* ─────────────── rendering: rail ─────────────── */

  function renderSlots() {
    dom.slots.textContent = '';
    SLOTS.forEach((s) => {
      const filled = state.slots[s.key];
      const li = el('li', 'slot' + (filled ? ' filled' : ''));
      li.appendChild(el('span', 'slot-dot'));
      const body = el('div', 'slot-body');
      body.appendChild(el('p', 'slot-k', s.label + (filled && filled.inferred ? ' · inferred' : '')));
      body.appendChild(el('p', 'slot-v', filled ? filled.text : s.empty));
      li.appendChild(body);
      dom.slots.appendChild(li);
    });
    const n = SLOTS.filter((s) => state.slots[s.key]).length;
    dom.panelFoot.textContent = n === 0 ? 'Listening.' : n + ' of ' + SLOTS.length + ' understood.';
  }

  /* ─────────────── stage control ─────────────── */

  const STEP_OF = {
    convo: 'understand', summary: 'confirm', push: 'push',
    capability: 'capability', done: 'done'
  };
  const STEP_ORDER = ['understand', 'confirm', 'push', 'capability', 'resources', 'done'];

  /* stepOverride lets the resources phase reuse the conversation stage while
     still advancing the stepper. */
  function showStage(name, stepOverride) {
    Object.keys(dom.stages).forEach((k) => dom.stages[k].classList.toggle('active', k === name));

    /* The conversation can be long, so a new stage would otherwise open with
       the viewport still parked at the bottom of the old thread. */
    if (name !== 'convo') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    const step = stepOverride || STEP_OF[name];
    const idx = STEP_ORDER.indexOf(step);
    Array.prototype.forEach.call(dom.stepper.children, (li) => {
      const i = STEP_ORDER.indexOf(li.dataset.step);
      li.classList.toggle('on', i === idx);
      li.classList.toggle('past', i < idx);
    });
  }

  /* ─────────────── interview engine ─────────────── */

  /* THE question renderer. Every question — opener, adaptive follow-up, probe
     or fallback — is presented through this one function. A question is a
     plain object: { slot, text, sub, chips, because }. */
  function renderQuestion(q) {
    state.busy = true;
    syncSend();
    showTyping();
    const delay = Math.min(1500, 550 + q.text.length * 7);
    window.setTimeout(() => {
      hideTyping();
      addAnalystMessage(q.text, { because: q.because, sub: q.sub });
      renderChips(q.chips);
      state.current = q;
      state.busy = false;
      syncSend();
      dom.input.focus();
    }, delay);
  }

  /* ── question builders: all return the same shape for renderQuestion ── */

  function openerQuestion() {
    return { slot: OPENER.slot, text: OPENER.q, sub: OPENER.sub, chips: OPENER.chips };
  }

  function probeQuestion(slot, lastAnswer) {
    const p = PROBES[slot];
    if (!p) return null;
    return { slot: slot, text: p.q, chips: p.chips, because: echoOf(lastAnswer, null) };
  }

  /* Demonstration data can never end the interview: if the bank has no entry
     for a slot, fall back to a generic prompt rather than completing early. */
  function slotQuestion(slot, lastAnswer) {
    const picked = pickVariant(slot, lastAnswer);
    const meta = SLOTS.find((s) => s.key === slot);
    if (!picked.variant) {
      return {
        slot: slot,
        text: 'Tell me more about ' + (meta ? meta.label.toLowerCase() : 'that') + '.',
        chips: [],
        because: echoOf(lastAnswer, null)
      };
    }
    return {
      slot: slot,
      text: picked.variant.q,
      chips: picked.variant.chips,
      because: echoOf(lastAnswer, picked.keyword)
    };
  }

  /* Called after every captured answer. Completion is decided ONLY by the
     explicit understanding status — never by how many questions have run. */
  function advanceInterview(lastAnswer) {
    const verdict = evaluateUnderstanding();
    if (verdict.status === UNDERSTANDING_COMPLETE) {
      window.setTimeout(synthesize, 620);
      return;
    }
    renderQuestion(slotQuestion(verdict.nextSlot, lastAnswer));
  }

  function start() {
    state = freshState();
    dom.thread.textContent = '';
    dom.input.value = '';
    autosize();
    dom.goalText.textContent = ADMISSION_GOAL;
    renderSlots();
    resetChoiceUI();

    dom.composer.hidden = false;
    dom.resComposer.hidden = true;
    dom.resNote.value = '';
    dom.resLink.value = '';
    dom.resFileInput.value = '';
    renderResourceFiles();

    showStage('convo');
    renderQuestion(openerQuestion());
  }

  function submitAnswer() {
    if (state.busy) return;
    const raw = dom.input.value.trim();
    if (!raw || !state.current) return;

    addUserMessage(raw);
    dom.input.value = '';
    autosize();
    renderChips([]);
    syncSend();

    if (state.mode === 'correcting') {
      applyCorrection(raw);
      return;
    }

    const slot = state.current.slot;
    state.slots[slot] = { text: asClause(raw), inferred: false };

    /* Opportunistic pickup: a date mentioned anywhere fills the horizon. */
    if (!state.slots.timeline && slot !== 'timeline') {
      const m = raw.match(TIMELINE_RX);
      if (m) state.slots.timeline = { text: asClause(m[0]), inferred: true };
    }

    renderSlots();

    /* Thin answers get one probe on the same slot before moving on. */
    if (isThin(raw) && !state.probed[slot]) {
      const probe = probeQuestion(slot, raw);
      if (probe) {
        state.probed[slot] = true;
        renderQuestion(probe);
        return;
      }
    }

    advanceInterview(raw);
  }

  /* ─────────────── correction loop ─────────────── */

  function reopenForCorrection() {
    state.mode = 'correcting';
    showStage('convo');
    addAnalystMessage(CORRECTION_PROMPT.q, { sub: CORRECTION_PROMPT.sub });
    state.current = { slot: null, chips: [] };
    renderChips([]);
    dom.input.focus();
  }

  function routeCorrection(text) {
    const hay = norm(text);
    for (const r of CORRECTION_ROUTES) {
      for (const w of r.words) {
        if (hay.includes(w)) return r.slot;
      }
    }
    return null;
  }

  /* "The deadline is wrong, I need 3 months" → "I need 3 months". Drops the
     corrective preamble so the rewritten slot reads as a plain statement. */
  function correctionClause(text) {
    let t = asClause(text);
    const comma = t.indexOf(',');
    if (comma > 0 && comma < 80) {
      const head = t.slice(0, comma);
      if (/\b(wrong|not right|incorrect|isn'?t|is not|are not|aren'?t|mistake|off)\b/i.test(head)) {
        t = t.slice(comma + 1).trim();
      }
    }
    return t.replace(/^(?:actually|really|basically)\s+/i, '');
  }

  function applyCorrection(raw) {
    const target = routeCorrection(raw);
    if (target) {
      state.slots[target] = { text: correctionClause(raw), inferred: false };
    } else {
      state.corrections.push(correctionClause(raw));
    }
    renderSlots();

    state.busy = true;
    syncSend();
    showTyping();
    window.setTimeout(() => {
      hideTyping();
      const slotLabel = target ? (SLOTS.find((s) => s.key === target) || {}).label : null;
      addAnalystMessage(
        slotLabel
          ? 'Understood. I have rewritten “' + slotLabel.toLowerCase() + '” and rebuilt the summary.'
          : 'Understood. I have folded that into the summary.'
      );
      state.busy = false;
      state.mode = 'interview';
      /* Same gate as the interview: only an explicit complete status may
         return to the summary. If a correction ever left understanding
         incomplete, resume questioning instead of summarising. */
      window.setTimeout(() => {
        const verdict = evaluateUnderstanding();
        if (verdict.status === UNDERSTANDING_COMPLETE) synthesize();
        else renderQuestion(slotQuestion(verdict.nextSlot, raw));
      }, 700);
    }, 900);
  }

  /* ─────────────── understanding summary ─────────────── */

  function sentence(parts) {
    /* parts: array of strings and {b:'bold text'} */
    const p = el('p');
    parts.forEach((seg) => {
      if (typeof seg === 'string') p.appendChild(document.createTextNode(seg));
      else p.appendChild(el('strong', null, seg.b));
    });
    return p;
  }

  function val(key) {
    const s = state.slots[key];
    return s ? s.text : null;
  }

  /* Answers are free text, so only the venture line is glued into a sentence
     frame. The rest lead with a bolded label and quote the user verbatim,
     which stays grammatical no matter how they phrased it. */
  function synthesize() {
    dom.summaryBody.textContent = '';

    const venture = val('venture');
    const stage = val('stage');
    const outcome = val('outcome');
    const timeline = val('timeline');
    const obstacle = val('obstacle');

    if (venture) {
      dom.summaryBody.appendChild(sentence(['You are building ', { b: ventureClause(venture) }, '.']));
    }
    if (stage) {
      dom.summaryBody.appendChild(sentence([{ b: 'Where it stands' }, ' — ', stage, '.']));
    }
    if (outcome) {
      dom.summaryBody.appendChild(sentence([{ b: 'Winning means' }, ' — ', outcome, '.']));
    }
    if (timeline) {
      dom.summaryBody.appendChild(sentence([{ b: 'Your horizon' }, ' — ', timeline, '.']));
    }
    if (obstacle) {
      dom.summaryBody.appendChild(sentence([{ b: 'The real bottleneck' }, ' — ', obstacle, '.']));
    }

    state.corrections.forEach((c) => {
      dom.summaryBody.appendChild(el('p', 'corr', 'You also corrected me: ' + c + '.'));
    });

    if (state.slots.timeline && state.slots.timeline.inferred) {
      dom.summaryBody.appendChild(el('p', 'corr',
        'I took your horizon from something you said rather than asking outright. Tell me if I read that wrong.'));
    }

    showStage('summary');
  }

  /* ─────────────── choice stages ─────────────── */

  function resetChoiceUI() {
    Array.prototype.forEach.call(dom.pushOpts.children, (b) => {
      b.classList.remove('sel'); b.setAttribute('aria-checked', 'false');
    });
    setCapability(0);
  }

  /* ─────────────── capability slider ───────────────
     Four snap points, no numbers shown. The index is internal; state stores
     the level key and the readout shows the name. */

  function capRatio(i) { return i / (CAP_LEVELS.length - 1); }

  function setCapability(index) {
    const i = Math.max(0, Math.min(CAP_LEVELS.length - 1, index));
    const level = CAP_LEVELS[i];
    state.capability = level.key;

    const pct = capRatio(i) * 100;
    dom.capFill.style.width = pct + '%';
    dom.capThumb.style.left = pct + '%';

    dom.capTrack.setAttribute('aria-valuenow', String(i + 1));
    dom.capTrack.setAttribute('aria-valuetext', level.name);

    Array.prototype.forEach.call(dom.capNotches.children, (n, ni) => {
      n.classList.toggle('on', ni <= i);
    });
    Array.prototype.forEach.call(dom.capLabels.children, (b, bi) => {
      b.classList.toggle('on', bi === i);
      b.classList.toggle('done', bi < i);
      b.setAttribute('aria-pressed', bi === i ? 'true' : 'false');
    });

    dom.capName.textContent = level.name;
    dom.capDesc.textContent = level.desc;
  }

  function capIndex() {
    const k = state.capability;
    const i = CAP_LEVELS.findIndex((l) => l.key === k);
    return i < 0 ? 0 : i;
  }

  /* Nearest snap point to a pointer position on the track. */
  function indexFromClientX(clientX) {
    const r = dom.capTrack.getBoundingClientRect();
    if (!r.width) return capIndex();
    const ratio = (clientX - r.left) / r.width;
    return Math.round(Math.max(0, Math.min(1, ratio)) * (CAP_LEVELS.length - 1));
  }

  function buildCapabilityUI() {
    dom.capNotches.textContent = '';
    dom.capLabels.textContent = '';

    CAP_LEVELS.forEach((level, i) => {
      const notch = el('span', 'capsl-notch');
      notch.style.left = capRatio(i) * 100 + '%';
      dom.capNotches.appendChild(notch);

      const label = el('button', 'capsl-label', level.name);
      label.type = 'button';
      label.setAttribute('aria-pressed', 'false');
      label.addEventListener('click', () => { setCapability(i); dom.capTrack.focus(); });
      dom.capLabels.appendChild(label);
    });

    let dragging = false;
    const wrap = dom.capRail.parentNode;

    const onDown = (e) => {
      dragging = true;
      wrap.classList.add('dragging');
      dom.capTrack.focus();
      setCapability(indexFromClientX(e.clientX));
      if (dom.capRail.setPointerCapture && e.pointerId != null) {
        dom.capRail.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      setCapability(indexFromClientX(e.clientX));
      e.preventDefault();
    };
    const onUp = () => { dragging = false; wrap.classList.remove('dragging'); };

    dom.capRail.addEventListener('pointerdown', onDown);
    dom.capRail.addEventListener('pointermove', onMove);
    dom.capRail.addEventListener('pointerup', onUp);
    dom.capRail.addEventListener('pointercancel', onUp);

    dom.capTrack.addEventListener('keydown', (e) => {
      const k = e.key;
      let next = null;
      if (k === 'ArrowLeft' || k === 'ArrowDown') next = capIndex() - 1;
      else if (k === 'ArrowRight' || k === 'ArrowUp') next = capIndex() + 1;
      else if (k === 'Home') next = 0;
      else if (k === 'End') next = CAP_LEVELS.length - 1;
      if (next === null) return;
      e.preventDefault();
      setCapability(next);
    });

    dom.capContinue.addEventListener('click', enterResources);
  }

  function wireChoiceStages() {
    Array.prototype.forEach.call(dom.pushOpts.children, (btn) => {
      btn.addEventListener('click', () => {
        Array.prototype.forEach.call(dom.pushOpts.children, (b) => {
          b.classList.remove('sel'); b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('sel'); btn.setAttribute('aria-checked', 'true');
        state.push = btn.dataset.value;
        window.setTimeout(() => showStage('capability'), 420);
      });
    });

  }

  /* ─────────────── resources (asked in the timeline) ─────────────── */

  function enterResources() {
    state.mode = 'resources';
    showStage('convo', 'resources');
    dom.composer.hidden = true;
    dom.resComposer.hidden = false;

    showTyping();
    window.setTimeout(() => {
      hideTyping();
      addAnalystMessage(RESOURCE_PROMPT.q, { sub: RESOURCE_PROMPT.sub });
      scrollToEnd(dom.resComposer);
      dom.resNote.focus();
    }, 850);
  }

  function humanSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderResourceFiles() {
    dom.resFiles.textContent = '';
    state.resources.files.forEach((f, i) => {
      const li = el('li', 'rescomp-file');
      li.appendChild(el('span', 'rescomp-fname', f.name));
      li.appendChild(el('span', 'rescomp-fsize', f.size));
      const rm = el('button', 'rescomp-frm', '✕');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove ' + f.name);
      rm.addEventListener('click', () => {
        state.resources.files.splice(i, 1);
        renderResourceFiles();
      });
      li.appendChild(rm);
      dom.resFiles.appendChild(li);
    });
  }

  /* Summary line for the activation recap. */
  function resourceSummary() {
    const r = state.resources;
    const parts = [];
    if (r.files.length) parts.push(r.files.length + (r.files.length === 1 ? ' file' : ' files'));
    if (r.link) parts.push('1 link');
    if (r.note) parts.push('a note');
    return parts.length ? parts.join(' · ') : 'Nothing added';
  }

  function wireResources() {
    dom.resAttachBtn.addEventListener('click', () => dom.resFileInput.click());

    dom.resFileInput.addEventListener('change', () => {
      Array.prototype.forEach.call(dom.resFileInput.files || [], (f) => {
        state.resources.files.push({ name: f.name, size: humanSize(f.size) });
      });
      /* Clear so picking the same file again still fires a change event. */
      dom.resFileInput.value = '';
      renderResourceFiles();
    });

    dom.resSend.addEventListener('click', () => {
      state.resources.note = dom.resNote.value.trim();
      state.resources.link = dom.resLink.value.trim();
      finishResources(true);
    });

    dom.resSkipBtn.addEventListener('click', () => {
      state.resources = { note: '', link: '', files: [] };
      finishResources(false);
    });
  }

  function finishResources(sent) {
    dom.resComposer.hidden = true;
    const r = state.resources;

    if (sent && (r.note || r.link || r.files.length)) {
      const bits = [];
      if (r.note) bits.push(r.note);
      if (r.link) bits.push(r.link);
      if (r.files.length) bits.push(r.files.map((f) => f.name).join(', '));
      addUserMessage(bits.join('\n'));
    } else {
      addUserMessage(sent ? 'Nothing to add.' : 'Skip for now.');
    }

    showTyping();
    window.setTimeout(() => {
      hideTyping();
      addAnalystMessage('Understood. That is everything I need.');
      window.setTimeout(complete, 800);
    }, 800);
  }

  /* ─────────────── completion ─────────────── */

  function recapRow(k, v) {
    const row = el('div', 'recap-row');
    row.appendChild(el('span', 'recap-k', k));
    row.appendChild(el('span', 'recap-v', v));
    return row;
  }

  function complete() {
    dom.recap.textContent = '';

    const capLevel = CAP_LEVELS.find((l) => l.key === state.capability);
    dom.recap.appendChild(recapRow('Goal', val('venture') || ADMISSION_GOAL));
    dom.recap.appendChild(recapRow('Current position', val('stage') || 'Not captured'));
    dom.recap.appendChild(recapRow('Main bottleneck', val('obstacle') || 'Not captured'));
    dom.recap.appendChild(recapRow('Push intensity', PUSH_LABELS[state.push] || 'Not set'));
    dom.recap.appendChild(recapRow('Capability level', capLevel ? capLevel.name : 'Not set'));
    dom.recap.appendChild(recapRow('Resources added', resourceSummary()));

    if (dom.mockNote) {
      dom.mockNote.textContent =
        'This is a frontend mock. Nothing was saved, sent, or scored — no backend is connected.';
    }
    showStage('done');
  }

  /* ─────────────── composer wiring ─────────────── */

  function autosize() {
    dom.input.style.height = 'auto';
    dom.input.style.height = Math.min(190, dom.input.scrollHeight) + 'px';
  }

  function syncSend() {
    dom.send.disabled = state.busy || !dom.input.value.trim();
    dom.input.disabled = state.busy;
  }

  function wireComposer() {
    dom.input.addEventListener('input', () => { autosize(); syncSend(); });
    dom.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAnswer(); }
    });
    dom.send.addEventListener('click', submitAnswer);
  }

  /* ─────────────── boot ─────────────── */

  function init() {
    wireComposer();
    buildCapabilityUI();   /* must precede start(), which resets the slider */
    wireChoiceStages();
    wireResources();
    dom.confirmBtn.addEventListener('click', () => showStage('push'));
    dom.rejectBtn.addEventListener('click', reopenForCorrection);
    dom.restartBtn.addEventListener('click', start);

    /* No destination exists in a frontend mock — say so rather than pretending. */
    dom.enterBtn.addEventListener('click', () => {
      dom.mockNote.textContent =
        'This is where the Founder Analyst workspace would open. Nothing is wired up in this mock.';
    });
    start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
