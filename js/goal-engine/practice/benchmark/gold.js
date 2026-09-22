/* ════════════════════════════════════════════════════════════════════════
   HOW A SET OF ANNOTATIONS BECOMES GOLD.

   This lived inside the runner, and the integrity suite tested a REIMPLEMEN-
   TATION of it that had already drifted. Deleting adjudicator precedence from
   the runner left every check green. One definition, imported by both, so a
   regression cannot pass against a copy of the logic it is meant to protect.
   ══════════════════════════════════════════════════════════════════════ */
import { VERDICTS, SOURCES, SELECTION_ABSTAINED, validateSelection } from './schema.js';

/* The abstention is an IDENTITY, never a string in the same field the
   annotator writes their answer into -- see SELECTION_ABSTAINED in schema.js
   for the judge-side exploit that made this necessary. */
const pickSelection = (r) =>
  (r.verdict === 'UNCERTAIN' || r.selection == null ? SELECTION_ABSTAINED : r.selection);

/* One unit's rows -> { state, verdict } where state is
   gold | pending | removed | none. Adjudication decides; row order never does. */
export function resolveGold(list) {
  const ruling = (list || []).filter((a) => a.source === 'adjudicator');
  if (ruling.length) {
    if (ruling.some((a) => a.adjudication === 'removed_ambiguous')) return { state: 'removed' };
    if (new Set(ruling.map((a) => a.verdict)).size > 1) return { state: 'pending' };
    return { state: 'gold', verdict: ruling[0].verdict };
  }
  const experts = (list || []).filter((a) => a.source !== 'adjudicator');
  if (!experts.length) return { state: 'none' };
  return new Set(experts.map((a) => a.verdict)).size === 1
    ? { state: 'gold', verdict: experts[0].verdict } : { state: 'pending' };
}

/* The same rule for WHICH TURN was named -- the answer for a call-level
   dimension. Two adjudicators naming different turns used to be settled by
   whichever row came first, and `removed_ambiguous` was honoured on the
   verdict path while the selection path went on charging the judge. */
export function resolveSelection(list) {
  const ruling = (list || []).filter((a) => a.source === 'adjudicator');
  if (ruling.length) {
    if (ruling.some((a) => a.adjudication === 'removed_ambiguous')) return { state: 'removed' };
    const picks = new Set(ruling.map((a) => JSON.stringify(pickSelection(a))));
    if (picks.size > 1) return { state: 'pending' };
    return { state: 'gold', selection: pickSelection(ruling[0]) };
  }
  const experts = (list || []).filter((a) => a.source !== 'adjudicator');
  if (!experts.length) return { state: 'none' };
  const picks = new Set(experts.map((a) => JSON.stringify(pickSelection(a))));
  return picks.size === 1
    ? { state: 'gold', selection: pickSelection(experts[0]) } : { state: 'pending' };
}

/* Gold arrives as raw JSON and never passed through the annotation schema, so
   a row citing a turn nobody said, with no reasoning, was scored. */
export function validateGoldRows(rows, { unitById, callById, validateCitation, callDims }) {
  const problems = [];
  (rows || []).forEach((a, i) => {
    const where = `row ${i} (${a.unitId})`;
    if (!VERDICTS.includes(a.verdict)) problems.push(`${where}: unknown verdict ${JSON.stringify(a.verdict)}`);
    if (!SOURCES.includes(a.source)) problems.push(`${where}: unknown source ${JSON.stringify(a.source)}`);
    const u = unitById.get(a.unitId);
    if (!u) { problems.push(`${where}: no such unit`); return; }
    if (!String(a.rationale || '').trim()) problems.push(`${where}: no rationale`);
    if (!(a.citations || []).length) problems.push(`${where}: no citation`);
    (a.citations || []).forEach((c) => {
      const bad = validateCitation(c, callById.get(u.callId) || { turns: [] });
      if (bad) problems.push(`${where}: ${bad}`);
    });
    if (callDims.has(u.dimension) && a.verdict !== 'UNCERTAIN' && a.selection == null) {
      problems.push(`${where}: call-level row names no turn`);
    }
    /* ── P1: THE SELECTION IS AN ADDRESS AND WAS NEVER RESOLVED ────────
       The citation was checked against the transcript and the SELECTION was
       not, so a gold row could nominate a turn nobody said. Every judge is
       then graded against an address none of them could have named, and the
       benchmark reports the judge as wrong. A selection that does not
       resolve is a broken label, not a hard question. */
    if (a.selection != null) {
      const badSel = validateSelection(a.selection, callById.get(u.callId) || { turns: [] });
      if (badSel) problems.push(`${where}: ${badSel}`);
    }
  });
  return problems;
}
