/* ════════════════════════════════════════════════════════════════════════
   BUSINESS ACTIVITY STATE — WHAT IS PLAUSIBLY HAPPENING THERE RIGHT NOW

   situation-state.js reads `when.getHours()`. In the edge function that is
   UTC, so a Sydney dental practice at 11am local was being simulated with
   `hour: 0, bucket: 'early'` — measured, not theorised, in the Practice
   corpus. Every busyness weight in that table was therefore being applied
   to the wrong time of day for every business outside the server's zone.

   This file computes the same idea from the BUSINESS's local clock, and
   keeps three things structurally apart:

     BUSINESS TRUTH        what is actually known about the company
     BUSINESS ACTIVITY     a simulation-context estimate about right now
     PROSPECT HIDDEN STATE mood, resistance, role — untouched by this file

   NOTHING HERE IS A FACT THE PROSPECT MAY SPEAK. `BUSY_LIKELY` is an
   inference about a category at a time of day; it is not evidence that the
   phone is ringing, and it never becomes a sentence. Only `direct`
   observation_type may ever claim the business is actually busy, and no
   source available to us today produces one — Gemini Maps grounding is
   quota-blocked, and Places does not return live popularity in our call.
   So LIVE_BUSY_CONFIRMED is unreachable by construction here, and that is
   deliberate rather than a gap: a fabricated "we're slammed" is exactly the
   kind of confident falsehood this codebase keeps refusing to ship.

   PURE. No I/O, no clock of its own — `now` is injected so the gates can
   drive real local times instead of whatever the test machine is set to.
   ══════════════════════════════════════════════════════════════════════ */

export const ACTIVITY = Object.freeze({
  CLOSED: 'CLOSED',
  QUIET_LIKELY: 'QUIET_LIKELY',
  NORMAL: 'NORMAL',
  BUSY_LIKELY: 'BUSY_LIKELY',
  LIVE_BUSY_CONFIRMED: 'LIVE_BUSY_CONFIRMED',
});

export const CONFIDENCE = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' });
export const OBSERVATION = Object.freeze({ DIRECT: 'direct', INFERRED: 'inferred' });

export const ACTIVITY_VERSION = 'practice_business_activity_v1';
/* Activity is a runtime estimate about the next few minutes, not a stored
   fact. Short by design so a call that starts before lunch and runs past it
   does not keep asserting a stale reading. */
export const ACTIVITY_TTL_MS = 10 * 60 * 1000;

/* Category busyness shapes, business-local. Each entry maps an hour to a
   coarse pressure band. These are ESTIMATES and are labelled as such in
   every output; they are not derived from any measurement we hold, which is
   why they can only ever produce `inferred`. */
const CATEGORY_SHAPES = Object.freeze({
  /* Front desks peak when the day opens and again after lunch. */
  reception: { busy: [[9, 12], [14, 16]], quiet: [[12, 14], [16, 18]] },
  dental: { busy: [[9, 12], [14, 16]], quiet: [[12, 14], [16, 18]] },
  medical: { busy: [[8, 11], [14, 17]], quiet: [[11, 14]] },
  veterinary: { busy: [[9, 12], [15, 18]], quiet: [[12, 15]] },
  salon: { busy: [[10, 13], [16, 19]], quiet: [[13, 16]] },
  restaurant: { busy: [[12, 14], [18, 21]], quiet: [[14, 17]] },
  trades: { busy: [[7, 9], [16, 18]], quiet: [[9, 16]] },
  /* Professional services rarely have a reception rush at all. */
  agency: { busy: [], quiet: [[12, 14]] },
  professional: { busy: [], quiet: [[12, 14]] },
});

/* Map a free-text category onto a shape. Unknown categories get no shape,
   which yields NORMAL at low confidence rather than an invented rush. */
export function shapeForCategory(category) {
  const c = String(category ?? '').toLowerCase();
  if (!c) return null;
  /* WORD-ANCHORED. An unanchored /trade/ matched "fair trade coffee shop"
     and gave a cafe a tradesman's busy curve -- caught by the gate below,
     which is why the gate uses a category that merely CONTAINS a keyword
     rather than one that is obviously unrelated. */
  if (/\bdent(al|ist|istry)?\b/.test(c)) return { key: 'dental', ...CATEGORY_SHAPES.dental };
  if (/\bvet(erinary)?\b/.test(c)) return { key: 'veterinary', ...CATEGORY_SHAPES.veterinary };
  if (/\b(doctor|medical|clinic|physio|gp)\b/.test(c)) return { key: 'medical', ...CATEGORY_SHAPES.medical };
  if (/\b(salon|barber|hairdresser|beauty|spa)\b/.test(c)) return { key: 'salon', ...CATEGORY_SHAPES.salon };
  if (/\b(restaurant|cafe|café|bar|takeaway|bistro|pub)\b/.test(c)) return { key: 'restaurant', ...CATEGORY_SHAPES.restaurant };
  if (/\b(plumber|plumbing|electrician|builder|roofing|tradesman|garage|mechanic)\b/.test(c)) return { key: 'trades', ...CATEGORY_SHAPES.trades };
  if (/\b(agency|consultancy|consultant|solicitor|lawyer|accountant|accounting|software)\b/.test(c)) return { key: 'agency', ...CATEGORY_SHAPES.agency };
  return null;
}

const inAny = (hour, ranges) => (ranges || []).some(([a, b]) => hour >= a && hour < b);

/**
 * The business's local wall clock, from a UTC offset in minutes.
 * `utcOffsetMinutes` is what Google Places returns; an IANA zone would be
 * better but Places does not give one in our configured call, and inventing
 * a zone from an address would be a guess dressed as data.
 */
export function businessLocalTime(nowUtc, utcOffsetMinutes) {
  const base = nowUtc instanceof Date ? nowUtc : new Date(nowUtc);
  if (Number.isNaN(base.getTime())) return null;
  if (!Number.isFinite(utcOffsetMinutes)) return null;
  const shifted = new Date(base.getTime() + utcOffsetMinutes * 60000);
  return {
    /* UTC getters on a shifted instant give the LOCAL wall clock, without
       depending on the host machine's own zone in any way. */
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayOfWeek: shifted.getUTCDay(),
    iso: shifted.toISOString(),
  };
}

/**
 * Is the business open, per its published regular hours?
 * @returns {true|false|null} null when hours are unknown — never guessed.
 */
export function isOpenAt(local, regularOpeningHours) {
  if (!local || !regularOpeningHours) return null;
  const periods = regularOpeningHours.periods;
  if (!Array.isArray(periods) || !periods.length) return null;
  const mins = local.hour * 60 + local.minute;
  for (const p of periods) {
    const o = p?.open; const c = p?.close;
    if (!o || typeof o.day !== 'number' || typeof o.hour !== 'number') continue;
    /* A period with no close is a 24-hour opening. */
    if (!c) { if (o.day === local.dayOfWeek) return true; continue; }
    const openMin = o.hour * 60 + (o.minute || 0);
    const closeMin = c.hour * 60 + (c.minute || 0);
    if (o.day === c.day) {
      if (o.day === local.dayOfWeek && mins >= openMin && mins < closeMin) return true;
    } else {
      /* Overnight period, e.g. open Fri 20:00 close Sat 02:00. */
      if (o.day === local.dayOfWeek && mins >= openMin) return true;
      if (c.day === local.dayOfWeek && mins < closeMin) return true;
    }
  }
  return false;
}

/**
 * Derive the activity state.
 *
 * @param {object} args
 * @param {Date|string} args.now                 current instant (UTC)
 * @param {number}  [args.utcOffsetMinutes]      from Google Places
 * @param {object}  [args.regularOpeningHours]   from Google Places
 * @param {boolean} [args.openNow]               ONLY if the API genuinely returned it
 * @param {string}  [args.category]              business category
 * @param {object}  [args.liveSignal]            a real current busyness source, if one ever exists
 * @returns {object} frozen BusinessActivityState
 */
/* ── THE CANONICAL LOCAL CONTEXT, CHOSEN BY IDENTITY NOT BY ROW ORDER ──
   The runtime used to take `.find(r => r.kind === "listing" && r.value)`
   over a select with no ORDER BY. Measured: a researched business carries
   THREE listing rows -- the Places local context, a Gemini one, and a
   public-record one -- and only the Places row holds `utcOffsetMinutes`
   and `regularOpeningHours`. So which context the simulation used was
   decided by whatever order Postgres happened to return, and Gemini
   research made it worse by adding a competing row. Picking the wrong one
   yields "no verified business timezone" and silently degrades to
   NORMAL/low.

   Selection is therefore by SHAPE AND PROVENANCE: a row is eligible only
   if it actually carries a usable offset, which is the whole reason this
   context is read at all. Among eligible rows the trusted Places context
   wins; ties break on recency and then on id, so the result is total and
   repeatable regardless of input order. No eligible row returns null, and
   the caller degrades honestly rather than borrowing an unrelated row. */
export const LOCAL_CONTEXT_METHOD = 'google_places_context';
export const LOCAL_CONTEXT_PROVIDER = 'google_places';

export function selectLocalContext(signals = []) {
  const eligible = (Array.isArray(signals) ? signals : []).filter((r) => {
    const v = r && r.value;
    return !!v && r.kind === 'listing' && Number.isFinite(v.utcOffsetMinutes);
  });
  if (!eligible.length) return null;
  const trustRank = (r) => {
    const v = r.value || {};
    if (r.research_method === LOCAL_CONTEXT_METHOD) return 0;
    if (v.provider === LOCAL_CONTEXT_PROVIDER) return 1;
    return 2;
  };
  const ms = (r) => {
    const t = r && r.checked_at ? Date.parse(r.checked_at) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  const id = (r) => String((r && (r.signal_id ?? r.id)) || '');
  return eligible.slice().sort((a, b) => (
    trustRank(a) - trustRank(b)
    || ms(b) - ms(a)
    || (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0)
  ))[0];
}

export function deriveBusinessActivityState({
  now, utcOffsetMinutes = null, regularOpeningHours = null,
  openNow = null, openNowAt = null, category = null, liveSignal = null,
} = {}) {
  const basis = [];
  let localForOutput = null;
  const calculatedAt = (now instanceof Date ? now : new Date(now || 0));
  const stamp = Number.isNaN(calculatedAt.getTime()) ? null : calculatedAt.toISOString();
  const build = (state, confidence, observationType) => Object.freeze({
    version: ACTIVITY_VERSION,
    state,
    confidence,
    observation_type: observationType,
    /* The business's own wall clock, exported so the situation engine can
       replace the server hour it reads today. null when unknown -- and the
       consumer must then keep its existing behaviour rather than treat a
       missing offset as UTC, which is the bug being removed. */
    local_hour: localForOutput ? localForOutput.hour : null,
    local_day: localForOutput ? localForOutput.dayOfWeek : null,
    basis: Object.freeze(basis.slice()),
    calculated_at: stamp,
    expires_at: stamp ? new Date(calculatedAt.getTime() + ACTIVITY_TTL_MS).toISOString() : null,
  });

  /* ── A LIVE CLAIM NEEDS A LIVE SOURCE. Nothing we can call today produces
        one. The branch exists so that when a real signal arrives it has a
        defined home, and so the gates can prove it is unreachable without. */
  if (liveSignal && liveSignal.directlyObserved === true && liveSignal.source) {
    basis.push(`live busyness reported by ${liveSignal.source}`);
    return build(ACTIVITY.LIVE_BUSY_CONFIRMED, CONFIDENCE.HIGH, OBSERVATION.DIRECT);
  }

  /* ── NO LOCAL CLOCK, NO CLAIM. Without an offset we cannot know the
        business's time of day, and the old UTC reading is exactly the bug
        being fixed — so we return neutral rather than substituting it. */
  const local = businessLocalTime(calculatedAt, utcOffsetMinutes);
  localForOutput = local;
  if (!local) {
    basis.push('no verified business timezone; refusing to infer from server time');
    return build(ACTIVITY.NORMAL, CONFIDENCE.LOW, OBSERVATION.INFERRED);
  }
  basis.push(`business-local time ${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}, day ${local.dayOfWeek}`);

  /* ── CLOSED is the one inference we can make with real confidence,
        because published hours are structured evidence rather than a
        category habit.

        `openNow` IS A SNAPSHOT, NOT A STANDING FACT. It was true of the
        moment Places was called and of nothing else. Measured: the context
        for a 07:00-21:00 practice was fetched at 21:33 local, just after
        it shut, so `openNow:false` was stored -- and because this branch
        preferred it unconditionally, the business then read CLOSED at
        every hour of every following day, which made BUSY_LIKELY
        unreachable without a paid Places refresh the research path never
        performs. A snapshot may therefore only speak for a call that
        happens close enough to when it was taken; the freshness window
        reuses ACTIVITY_TTL_MS rather than inventing a second number.

        With no timestamp there is no way to prove freshness, so the
        snapshot is DECLINED rather than trusted -- the live clock against
        the published periods is the honest reading, and it is the same
        evidence Places itself used. */
  let open = null;
  const snapAt = openNowAt == null ? null
    : (openNowAt instanceof Date ? openNowAt : new Date(openNowAt));
  const snapMs = snapAt && !Number.isNaN(snapAt.getTime()) ? snapAt.getTime() : null;
  const snapAgeMs = snapMs === null ? null : Math.abs(calculatedAt.getTime() - snapMs);
  const snapFresh = snapAgeMs !== null && snapAgeMs <= ACTIVITY_TTL_MS;

  if (typeof openNow === 'boolean' && snapFresh) {
    open = openNow;
    basis.push(`provider reported open_now=${open} ${Math.round(snapAgeMs / 1000)}s ago`);
  } else {
    if (typeof openNow === 'boolean') {
      basis.push(snapAgeMs === null
        ? 'declined a provider open_now snapshot of unknown age'
        : `declined a provider open_now snapshot ${Math.round(snapAgeMs / 60000)}m old`);
    }
    open = isOpenAt(local, regularOpeningHours);
    if (open !== null) basis.push(`evaluated against published opening hours: ${open ? 'open' : 'closed'}`);
  }

  if (open === false) {
    basis.push('outside published opening hours');
    return build(ACTIVITY.CLOSED, CONFIDENCE.HIGH, OBSERVATION.INFERRED);
  }

  const shape = shapeForCategory(category);
  if (!shape) {
    basis.push(category ? `no busyness shape for category "${category}"` : 'no business category available');
    /* Open with an unknown category is genuinely just NORMAL. */
    return build(ACTIVITY.NORMAL, open === true ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW, OBSERVATION.INFERRED);
  }
  basis.push(`category shape "${shape.key}"`);

  const weekend = local.dayOfWeek === 0 || local.dayOfWeek === 6;
  if (weekend) basis.push('weekend');

  /* CONFIDENCE POLICY. Hours known AND category known is the only
     combination that earns high confidence, because only then do we know
     both that they are open and what open usually looks like for them.
     Everything thinner stays near the NORMAL baseline. */
  const hoursKnown = open !== null;
  const confidence = hoursKnown && !weekend ? CONFIDENCE.HIGH
    : (hoursKnown || !weekend ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW);

  if (inAny(local.hour, shape.busy) && !weekend) {
    basis.push('inside a typical busy window for this category');
    return build(ACTIVITY.BUSY_LIKELY, confidence, OBSERVATION.INFERRED);
  }
  if (inAny(local.hour, shape.quiet) || weekend) {
    basis.push(weekend ? 'weekend traffic assumed lighter' : 'inside a typical quiet window');
    return build(ACTIVITY.QUIET_LIKELY, confidence === CONFIDENCE.HIGH ? CONFIDENCE.MEDIUM : confidence, OBSERVATION.INFERRED);
  }
  basis.push('open, outside both busy and quiet windows');
  return build(ACTIVITY.NORMAL, confidence, OBSERVATION.INFERRED);
}

/* ── ACTIVITY → SIMULATION PRESSURE ───────────────────────────────────
   Returns MULTIPLIERS AND DELTAS ONLY, for the situation layer to apply.
   It deliberately cannot express mood: there is no field here for
   hostility, warmth, resistance or willingness, so a busy business cannot
   become a rude one no matter what a later caller does with the result.
   Confidence scales the size of the adjustment exactly as specified —
   a low-confidence guess barely moves the baseline. */
const STRENGTH = Object.freeze({ low: 0.35, medium: 0.7, high: 1 });

export function activityPressure(activity) {
  const none = Object.freeze({
    attentionDelta: 0, timePressureDelta: 0, wordBudgetScale: 1,
    triageUrgencyDelta: 0, reason: 'no activity state',
  });
  if (!activity || !activity.state) return none;
  const k = STRENGTH[activity.confidence] ?? STRENGTH.low;
  const scaled = (v) => Math.round(v * k * 100) / 100;

  switch (activity.state) {
    case ACTIVITY.LIVE_BUSY_CONFIRMED:
    case ACTIVITY.BUSY_LIKELY:
      return Object.freeze({
        attentionDelta: scaled(-0.18),
        timePressureDelta: scaled(0.25),
        wordBudgetScale: 1 - scaled(0.25),
        triageUrgencyDelta: scaled(0.3),
        reason: `${activity.state} at ${activity.confidence} confidence`,
      });
    case ACTIVITY.QUIET_LIKELY:
      return Object.freeze({
        attentionDelta: scaled(0.12),
        timePressureDelta: scaled(-0.15),
        wordBudgetScale: 1 + scaled(0.2),
        triageUrgencyDelta: scaled(-0.1),
        reason: `quiet at ${activity.confidence} confidence`,
      });
    case ACTIVITY.CLOSED:
      /* Closed is not busy and not relaxed. Whoever picked up is not at a
         front desk mid-rush, so there is no rush to simulate. */
      return Object.freeze({
        attentionDelta: 0, timePressureDelta: 0, wordBudgetScale: 1,
        triageUrgencyDelta: scaled(0.1),
        reason: 'closed: no reception rush to simulate',
      });
    default:
      return none;
  }
}
