/* One seam between the pure practice engines and the classic-script surface,
   mirroring li-entry-bridge.js. The setup screen must show the SAME mode
   descriptions the behaviour engine runs on, and must reword the script
   through the SAME adapter the Communication Profile work already proved —
   so it imports them rather than restating them. */
import { BEHAVIOUR_MODES, MODE_IDS, DEFAULT_MODE } from '../goal-engine/practice/prospect-behaviour.js';
import {
  INTENSITY_LEVELS, DEFAULT_DIFFICULTY, DEFAULT_PRESSURE,
  DIFFICULTY_LABELS, PRESSURE_LABELS, DIFFICULTY_DESCRIBES, PRESSURE_DESCRIBES,
} from '../goal-engine/practice/practice-intensity.js';
import {
  SITUATION_IDS, SITUATION_LABELS, SITUATION_DESCRIBES, VISION_ADAPTIVE,
  resolveSituation, situationPosturePhrase,
} from '../goal-engine/practice/situation-state.js';
import { resolveFocus, FOCUS_VALUES } from '../goal-engine/practice/guided-coaching.js';
import { adaptScript, verifyAdaptation } from '../goal-engine/founder/script-adaptation.js';
import * as turnAssembly from '../goal-engine/practice/turn-assembly.js';
import * as ruleEngine from '../goal-engine/practice/rule-engine.js';
import * as reactionReader from '../goal-engine/practice/reaction-reader.js';
import * as answerKey from '../goal-engine/practice/answer-key.js';
import * as candidateEvents from '../goal-engine/practice/candidate-events.js';

window.VISION_PRACTICE_KIT = {
  BEHAVIOUR_MODES, MODE_IDS, DEFAULT_MODE, adaptScript, verifyAdaptation,
  /* The two dials the founder sets. Labels and copy only -- none of the
     POLICY (weights, scales, thresholds, role tilt) is exposed to the
     browser, because the browser is not allowed to know what a level does
     to the prospect, only what it is called. */
  INTENSITY_LEVELS, DEFAULT_DIFFICULTY, DEFAULT_PRESSURE,
  DIFFICULTY_LABELS, PRESSURE_LABELS, DIFFICULTY_DESCRIBES, PRESSURE_DESCRIBES,
  resolveFocus, FOCUS_VALUES,
  /* Situation is resolved client-side, once, before the call starts --
     the same resolution the server will reach independently from the same
     handoff, seed and clock, so the pre-call card matches what the call
     actually runs on without the client having to trust its own guess. */
  SITUATION_IDS, SITUATION_LABELS, SITUATION_DESCRIBES, VISION_ADAPTIVE,
  resolveSituation, situationPosturePhrase,
  /* Exposed so a harness can prove the live gate on the deployed bundle. */
  turnAssembly, ruleEngine, reactionReader, answerKey, candidateEvents,
};
