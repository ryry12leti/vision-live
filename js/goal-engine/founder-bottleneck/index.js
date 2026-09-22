/**
 * Founder Bottleneck Intelligence — public entry point.
 * See assembler.js and contract.js for the full contract.
 */

export {
  FOUNDER_BOTTLENECK_ASSESSMENT_VERSION,
  FOUNDER_ROUTE_IDS,
  FOUNDER_WORK_UNIT_BUSINESS_FUNCTION,
  FOUNDER_BOTTLENECK_CATEGORIES,
  BOTTLENECK_CATEGORY_ROUTES,
  CATEGORY_LABEL,
  CATEGORY_PRIORITY_TAG,
  PRIORITY_HIERARCHY,
  validateFounderBottleneckAssessment,
} from './contract.js';
export { assessRoutes } from './route-assessment.js';
export { detectBottleneck } from './bottleneck-rules.js';
export { computeBottleneckConfidence } from './confidence.js';
export { assessFounderBottleneck, FounderBottleneckInputError } from './assembler.js';
