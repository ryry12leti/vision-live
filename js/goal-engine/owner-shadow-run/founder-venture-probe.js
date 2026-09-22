/**
 * Re-export only. `evaluateFounderVentureRow` moved to
 * founder-venture-state/venture-row-probe.js so the canonical live Founder
 * Decision Service path (supabase/functions/_shared/founder-engine-bridge.mjs)
 * can use the exact same function without depending on anything under
 * owner-shadow-run/ (spec: the canonical engine must not depend on
 * preview-only modules). Every existing import of this file keeps working
 * unchanged.
 *
 * @typedef {import('../founder-venture-state/venture-row-probe.js').FounderVentureRowEvaluation} FounderVentureRowEvaluation
 */
export { evaluateFounderVentureRow } from '../founder-venture-state/venture-row-probe.js';
