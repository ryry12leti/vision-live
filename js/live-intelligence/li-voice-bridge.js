/* One seam between the pure voice-choice module and the classic-script
   runner, mirroring the other bridges. The module the $0 suite tests is the
   module that ships. */
import { pickBrowserVoice, utteranceSettingsFor, VOICE_PROVIDERS,
  DEFAULT_VOICE_PROVIDER } from '../goal-engine/practice/prospect-voice.js';
window.VISION_VOICE = { pickBrowserVoice, utteranceSettingsFor, VOICE_PROVIDERS, DEFAULT_VOICE_PROVIDER };
