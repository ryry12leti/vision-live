/**
 * Domain classification for the owner-only shadow run.
 *
 * classifyLegacyDomain() mirrors the live supabase/functions/generate-tasks
 * domain() heuristic (verified against the deployed generate-tasks v75
 * source, 2026-07-31) so the shadow run infers a domain along the same
 * lines the live SQL Goal Engine already does for this profile -- not a new
 * guess invented for this diagnostic. One deliberate divergence: generate-
 * tasks' domain() checks `goal_category` before `domain_type`/`path_type`,
 * because its only job is picking one flat display category. This adapter
 * separately maps profiles.goal_category into the JS contract's distinct
 * `goalCategory` fact (see real-data-adapter.js), so reusing it as the
 * domain-identity signal too would conflate two different concepts -- here
 * `domain_type`/`path_type` are checked first, and `goal_category` is only
 * a fallback when both are absent.
 *
 * classifyDomainId() then maps that legacy vocabulary onto the six
 * canonical js/goal-engine/domain-packs ids. 'career' and 'general' have no
 * canonical Goal Engine domain pack counterpart today, and an explicit
 * value that matches neither the legacy vocabulary nor a canonical id
 * (e.g. a stored value like 'sales' that is really a goalCategory, not a
 * domain) also resolves to null -- reported by the caller as an unmapped
 * domain rather than being guessed onto the nearest pack.
 */

function clean(value, max = 240) {
  return String(value ?? '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function classifyLegacyDomain(profile) {
  const explicit = clean(profile?.domain_type || profile?.path_type || profile?.goal_category, 40).toLowerCase();
  const goalText = clean(profile?.main_goal || profile?.goal_domain, 240).toLowerCase();
  if (explicit) return explicit;
  if (/business|founder|startup|client|revenue|sales|agency/.test(goalText)) return 'business';
  if (/money|income|save|invest|debt|finance/.test(goalText)) return 'money';
  if (/fitness|gym|muscle|strength|weight|bodybuild/.test(goalText)) return 'fitness';
  if (/soccer|football|basketball|tennis|athlete|sport/.test(goalText)) return 'sport';
  if (/study|school|exam|university|course|learn|essay|assignment/.test(goalText)) return 'study';
  if (/content|creator|youtube|tiktok|music|artist/.test(goalText)) return 'content';
  if (/career|job|resume|interview|application/.test(goalText)) return 'career';
  return 'general';
}

export const LEGACY_TO_CANONICAL_DOMAIN = Object.freeze({
  business: 'founder',
  money: 'money',
  fitness: 'fitness',
  sport: 'athlete',
  study: 'learning',
  content: 'creator',
});

/**
 * @param {object} profile A public.profiles row (or a fixture with the same field names).
 * @returns {string|null} One of CANONICAL_DOMAIN_IDS, or null when unmapped.
 */
export function classifyDomainId(profile) {
  const legacy = classifyLegacyDomain(profile);
  return LEGACY_TO_CANONICAL_DOMAIN[legacy] || null;
}
