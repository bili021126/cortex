/**
 * tui/intent-router/index.ts — 意图路由器统一导出
 *
 * @module tui/intent-router
 * @since v6
 */

export {
  classifyIntent,
  classifyIntentAsync,
  resetPipeline,
  ClassificationPipeline,
  ExplicitClassifier,
  PatternClassifier,
  ContextClassifier,
} from "./router.js";

export type {
  IntentResult,
  RouterContext,
  IntentType,
  ClassificationTrace,
  Classifier,
  ClassificationResult,
} from "./router.js";
