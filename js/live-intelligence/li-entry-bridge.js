/* One seam between the pure entry resolver and the classic-script surface,
   mirroring li-vad-bridge.js. The module the $0 suite tests is the module
   that ships. */
import { resolveEntry, callReadiness, DEFAULT_CAPABILITIES } from '../goal-engine/live-intelligence/entry-context.js';
window.VISION_ENTRY = { resolveEntry, callReadiness, DEFAULT_CAPABILITIES };
