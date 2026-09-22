import { jcsCanonicalize } from '../company-state.js';
import { compileOntologyFusedContext } from './compile.js';

export const ONTOLOGY_CONTEXT_FUSION_SHADOW_DEFAULT = false;

export async function runOntologyContextFusionShadow({
  enabled = ONTOLOGY_CONTEXT_FUSION_SHADOW_DEFAULT,
  liveDecision,
  request,
  readService,
}) {
  const baselineBytes = jcsCanonicalize(liveDecision);
  if (!enabled) return Object.freeze({ status: 'DISABLED', liveDecision, liveUnchanged: true, fusedContext: null });
  const readResult = await readService.read(request);
  let fusedContext = null;
  let status = readResult.status;
  if (readResult.status === 'PRESENT') {
    try { fusedContext = compileOntologyFusedContext(readResult.packet); status = 'SHADOW_COMPILED'; }
    catch { status = 'SHADOW_REJECTED'; }
  }
  const liveUnchanged = baselineBytes === jcsCanonicalize(liveDecision);
  if (!liveUnchanged) throw new Error('SHADOW_PATH_MUTATED_LIVE_DECISION');
  return Object.freeze({ status, liveDecision, liveUnchanged, fusedContext });
}
