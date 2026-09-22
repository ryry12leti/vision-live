/* Search scope interpretation.
 *
 * WHAT THIS REPLACED. The previous implementation carried a hardcoded
 * KNOWN_LOCALITIES map with exactly ONE entry ('dubbo, nsw') plus a special
 * case naming two towns by regex. Every other place on earth fell through to
 * `requiresClarification: true` with a reason the user could never satisfy,
 * because there was no branch that could ever accept their answer. Lead
 * Intelligence was, literally, a one-town product.
 *
 * WHAT THIS DOES INSTEAD. A location resolves when the FOUNDER has made the
 * scope explicit, judged structurally:
 *
 *   locality / radius / regional -- the text must carry an explicit region or
 *     country qualifier (an Australian state/territory in any accepted form,
 *     or a recognised country name). "Wagga Wagga, NSW", "Bendigo, Victoria"
 *     and "Dubbo, New South Wales, Australia" all resolve. Bare "Dubbo" does
 *     not -- not because Dubbo is special, but because one bare place name is
 *     genuinely ambiguous anywhere.
 *   multiple -- two or more entries, each individually explicit.
 *   nationwide -- a country, from an explicit parameter or from saved venture
 *     context. Never guessed.
 *   online -- no place at all; must not be turned into a local search.
 *
 * THE INFERENCE RULE (spec: never infer a user location without saved context
 * or explicit approval). Nothing here ever supplies a region the founder did
 * not. When a scope is ambiguous we return requiresClarification with the
 * candidate interpretations we could offer, and the caller must come back with
 * either a qualified string or an explicit `approvedInterpretation`. The
 * suggestions are shown, never silently applied.
 */

export const SEARCH_SCOPES = Object.freeze(['locality', 'radius', 'regional', 'multiple', 'nationwide', 'online']);
export const SCOPES_REQUIRING_PLACE = Object.freeze(['locality', 'radius', 'regional', 'multiple']);

export const AUSTRALIAN_REGIONS = Object.freeze([
  { code: 'NSW', names: ['nsw', 'new south wales'] },
  { code: 'VIC', names: ['vic', 'victoria'] },
  { code: 'QLD', names: ['qld', 'queensland'] },
  { code: 'SA', names: ['sa', 'south australia'] },
  { code: 'WA', names: ['wa', 'western australia'] },
  { code: 'TAS', names: ['tas', 'tasmania'] },
  { code: 'NT', names: ['nt', 'northern territory'] },
  { code: 'ACT', names: ['act', 'australian capital territory'] },
]);

const COUNTRIES = Object.freeze([
  { code: 'AU', names: ['australia', 'aus'] },
  { code: 'NZ', names: ['new zealand', 'nz'] },
  { code: 'GB', names: ['united kingdom', 'uk', 'great britain'] },
  { code: 'US', names: ['united states', 'usa', 'us', 'united states of america'] },
  { code: 'CA', names: ['canada'] },
  { code: 'IE', names: ['ireland'] },
]);

const MAX_LOCATION_LENGTH = 200;
const MAX_MULTIPLE_LOCATIONS = 10;

function clean(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, MAX_LOCATION_LENGTH) : '';
}

function parts(raw) {
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

function matchRegion(text) {
  const needle = text.toLowerCase().replace(/\./g, '');
  return AUSTRALIAN_REGIONS.find((region) => region.names.includes(needle)) || null;
}

function matchCountry(text) {
  const needle = text.toLowerCase().replace(/\./g, '');
  return COUNTRIES.find((country) => country.names.includes(needle)) || null;
}

export function resolveCountry(value) {
  const text = clean(value);
  if (!text) return null;
  const byName = matchCountry(text);
  if (byName) return byName.code;
  const upper = text.toUpperCase();
  return COUNTRIES.some((country) => country.code === upper) ? upper : null;
}

/** Structurally decides whether ONE place string is explicit enough to search.
 * Explicit means: at least one component after the first is a recognised
 * region or country. Exported for the `multiple` scope and for tests. */
export function resolvePlace(rawInput) {
  const raw = clean(rawInput);
  if (!raw) return { resolved: false, reason: 'place_required', raw };
  const segments = parts(raw);
  if (segments.length < 2) {
    return {
      resolved: false,
      reason: 'region_required',
      raw,
      locality: segments[0] || raw,
      // Offered, never applied: the caller must choose.
      suggestions: AUSTRALIAN_REGIONS.map((region) => `${segments[0] || raw}, ${region.code}`),
    };
  }
  let regionCode = null;
  let countryCode = null;
  for (const segment of segments.slice(1)) {
    const region = matchRegion(segment);
    if (region && !regionCode) regionCode = region.code;
    const country = matchCountry(segment);
    if (country && !countryCode) countryCode = country.code;
  }
  if (!regionCode && !countryCode) {
    return {
      resolved: false, reason: 'region_not_recognised', raw, locality: segments[0],
      suggestions: AUSTRALIAN_REGIONS.map((region) => `${segments[0]}, ${region.code}`),
    };
  }
  // An Australian state implies Australia; a country alone stands on its own.
  if (regionCode && !countryCode) countryCode = 'AU';
  const label = [segments[0], regionCode, countryCode === 'AU' ? 'Australia' : countryCode]
    .filter(Boolean).join(', ');
  return { resolved: true, raw, locality: segments[0], regionCode, countryCode, label };
}

/**
 * @param {string} input          the founder's own location text
 * @param {object} options
 * @param {string} options.mode   one of SEARCH_SCOPES
 * @param {number} [options.radiusKm]
 * @param {string} [options.country]              explicit country for nationwide
 * @param {object} [options.savedContext]         { countryCode } already stored for this venture
 * @param {object} [options.approvedInterpretation] { locality, regionCode, countryCode, approved: true }
 */
export function interpretLocation(input, {
  mode = 'locality', radiusKm = null, country = null, savedContext = null, approvedInterpretation = null,
} = {}) {
  if (!SEARCH_SCOPES.includes(mode)) {
    return { mode: 'locality', label: '', requiresClarification: true, reason: 'Choose a search scope.', needs: 'scope' };
  }

  if (mode === 'online') {
    return { mode, label: 'Online or anywhere', scope: 'online', requiresClarification: false, countryCode: null };
  }

  if (mode === 'nationwide') {
    const explicit = resolveCountry(country) || resolveCountry(input) || resolveCountry(savedContext?.countryCode);
    if (!explicit) {
      return {
        mode, label: '', scope: 'nationwide', requiresClarification: true, needs: 'country',
        reason: 'Choose the country to search nationwide. VISION will not assume one.',
        suggestions: COUNTRIES.map((entry) => entry.code),
      };
    }
    return { mode, scope: 'nationwide', countryCode: explicit, label: explicit === 'AU' ? 'Australia' : explicit, requiresClarification: false };
  }

  // An interpretation the founder explicitly approved is authoritative and
  // bypasses the text parser entirely -- this is the "explicit approval" arm
  // of the never-infer rule.
  if (approvedInterpretation && approvedInterpretation.approved === true) {
    const locality = clean(approvedInterpretation.locality);
    const regionCode = clean(approvedInterpretation.regionCode).toUpperCase() || null;
    const countryCode = resolveCountry(approvedInterpretation.countryCode) || (regionCode ? 'AU' : null);
    if (locality && countryCode) {
      return {
        mode: radiusKm ? 'radius' : mode, scope: radiusKm ? 'radius' : mode,
        locality, regionCode, countryCode,
        label: [locality, regionCode, countryCode === 'AU' ? 'Australia' : countryCode].filter(Boolean).join(', '),
        radiusKm: radiusKm || null, requiresClarification: false, approvedByUser: true,
      };
    }
  }

  if (mode === 'multiple') {
    const entries = clean(input).split(';').map((entry) => entry.trim()).filter(Boolean).slice(0, MAX_MULTIPLE_LOCATIONS);
    if (entries.length < 2) {
      return { mode, scope: 'multiple', label: clean(input), requiresClarification: true, needs: 'places', reason: 'Enter at least two locations separated by semicolons.' };
    }
    const resolvedEntries = entries.map(resolvePlace);
    const unresolved = resolvedEntries.filter((entry) => !entry.resolved);
    if (unresolved.length > 0) {
      return {
        mode, scope: 'multiple', label: clean(input), requiresClarification: true, needs: 'region',
        reason: `Add a state or country to: ${unresolved.map((entry) => entry.raw).join('; ')}.`,
        unresolved: unresolved.map((entry) => entry.raw),
        suggestions: unresolved[0]?.suggestions || [],
      };
    }
    return {
      mode, scope: 'multiple', requiresClarification: false,
      locations: resolvedEntries.map((entry) => ({ locality: entry.locality, regionCode: entry.regionCode, countryCode: entry.countryCode, label: entry.label })),
      countryCode: resolvedEntries[0].countryCode,
      label: resolvedEntries.map((entry) => entry.label).join('; '),
    };
  }

  // locality | radius | regional
  if (mode === 'radius') {
    const km = Number(radiusKm);
    if (!Number.isFinite(km) || km <= 0 || km > 500) {
      return { mode, scope: 'radius', label: clean(input), requiresClarification: true, needs: 'radius', reason: 'Enter a search radius between 1 and 500 km.' };
    }
  }
  const place = resolvePlace(input);
  if (!place.resolved) {
    return {
      mode, scope: mode, label: place.raw, requiresClarification: true,
      needs: place.reason === 'place_required' ? 'place' : 'region',
      reason: place.reason === 'place_required'
        ? 'Enter a city, suburb or regional area to search.'
        : `Add a state or country so VISION searches the correct ${place.locality || 'location'}.`,
      suggestions: place.suggestions || [],
    };
  }
  return {
    mode, scope: mode, locality: place.locality, regionCode: place.regionCode, countryCode: place.countryCode,
    label: place.label, radiusKm: mode === 'radius' ? Number(radiusKm) : null, requiresClarification: false,
  };
}

/** The exact text handed to a discovery provider for a given scope. Keeps
 * "online" and "nationwide" from being silently turned into a local search. */
export function providerQueryScope(location) {
  if (!location || location.requiresClarification) return null;
  if (location.mode === 'online') return { kind: 'online', queryQualifier: '', label: 'Online or anywhere' };
  if (location.mode === 'nationwide') {
    return { kind: 'nationwide', queryQualifier: `in ${location.label}`, countryCode: location.countryCode, label: location.label };
  }
  if (location.mode === 'multiple') {
    return { kind: 'multiple', queryQualifier: `in ${location.locations[0].label}`, labels: location.locations.map((entry) => entry.label), label: location.label };
  }
  return {
    kind: location.mode, queryQualifier: `in ${location.label}`, label: location.label,
    radiusKm: location.radiusKm || null, countryCode: location.countryCode,
  };
}
