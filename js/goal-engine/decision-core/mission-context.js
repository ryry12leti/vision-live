/**
 * Goal Engine decision core — MissionContext.
 *
 * The domain-neutral contract for "the real, already-trusted facts that make
 * a selected mission concrete instead of generic".
 *
 * A Goal Engine's selection logic answers WHICH mission to do. It does not,
 * and should not, answer how that mission should READ. But a mission worded
 * without the user's own facts degrades to template text -- "Contact 1
 * reachable prospect with the current offer" -- which names no action, no
 * subject and no target, leaving the user to decide what to actually do.
 *
 * MissionContext carries exactly three things, all of which every domain
 * has some version of:
 *
 *   action  -- HOW the work is performed (Founder: the recorded outreach
 *              channel. Fitness: the training modality. Learning: the
 *              practice format.)
 *   subject -- WHAT is being presented/applied/delivered (Founder: the
 *              venture's real offer. Fitness: the prescribed session.
 *              Learning: the specific concept.)
 *   target  -- WHO or WHAT the work is aimed at (Founder: the target
 *              customer. Fitness: the muscle group/goal. Learning: the
 *              skill being built.)
 *
 * Every field is nullable on purpose. A domain that has no trustworthy value
 * for one passes null, and the compiler consuming it degrades to its
 * previous generic wording rather than inventing a value. Nothing here
 * fabricates, and nothing here influences WHICH mission is selected -- a
 * MissionContext can only change wording.
 *
 * Founder is the first consumer (see founder-mission-comparison/
 * mission-compiler.js). A second Goal Engine adopts this by building a
 * MissionContext from its own facts and passing it down its own compiler --
 * never by editing this file, and never by editing Founder's compiler.
 */

/**
 * @typedef {object} MissionContext
 * @property {string|null} actionVerb Imperative verb for the action, e.g. 'Call', 'Email', 'Row', 'Drill'. Used where a sentence needs a leading verb.
 * @property {string|null} actionLabel Human phrase for the same action, e.g. 'Call them'. Used where a sentence needs a noun-ish phrase.
 * @property {string|null} subjectText The real thing being presented/applied, in the user's own words. May be long; consumers truncate.
 * @property {string|null} targetLabel Who/what the work is aimed at, in the user's own words. May be long; consumers truncate.
 * @property {string|null} domain Owning Goal Engine domain, for provenance only. Never branched on by shared code.
 */

/**
 * Builds a MissionContext, normalising empty strings to null so consumers
 * only ever have to check for null.
 *
 * @returns {MissionContext}
 */
export function buildMissionContext({
  actionVerb = null, actionLabel = null, subjectText = null, targetLabel = null, domain = null,
} = {}) {
  const clean = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length > 0 ? text : null;
  };
  return {
    actionVerb: clean(actionVerb),
    actionLabel: clean(actionLabel),
    subjectText: clean(subjectText),
    targetLabel: clean(targetLabel),
    domain: clean(domain),
  };
}

/** Shortens to `max` characters on a word boundary, never mid-fabrication.
 *
 * The doc comment always claimed "word-ish boundary" but the implementation
 * was a hard character slice, so a real founder's target customer became
 * "...weekend regulars in Ne…" -- cut mid-word, mid-place-name, in text shown
 * to them. Cutting back to the last space keeps every surviving word whole.
 * The half-budget guard stops a single very long token (a URL, a run-on
 * string with no spaces) from collapsing the phrase to almost nothing: in
 * that case the original hard cut is still the better of two bad options. */
export function missionPhrase(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (!Number.isFinite(max) || text.length <= max) return text;
  const cut = text.slice(0, Math.max(1, max - 1));
  const lastSpace = cut.lastIndexOf(' ');
  const trimmed = lastSpace > Math.floor(max / 2) ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
}

/**
 * The first clause of a free-text value -- how a domain turns "Local
 * business owners in my city -- trades, cafes and small retail." into
 * "Local business owners in my city" without inventing a shorter phrase.
 */
export function missionFirstClause(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const clause = text.split(/[,–—;(]/)[0].trim().replace(/\.$/, '');
  return clause ? missionPhrase(clause, max) : null;
}
