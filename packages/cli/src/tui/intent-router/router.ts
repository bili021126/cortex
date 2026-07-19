/**
 * tui/intent-router/router.ts — 意图路由器主入口
 *
 * 提供向后兼容的 classifyIntent API，内部使用分类管道。
 *
 * @module tui/intent-router/router
 * @since v6
 */

import { ClassificationPipeline } from "./pipeline.js";
import { ExplicitClassifier } from "./classifiers/explicit.js";
import { PatternClassifier } from "./classifiers/pattern.js";
import { ContextClassifier } from "./classifiers/context.js";
import type { IntentResult, RouterContext } from "./types.js";

// ─── 全局管道实例 ─────────────────────────

let globalPipeline: ClassificationPipeline | null = null;

/**
 * 获取或创建全局分类管道
 */
function getPipeline(): ClassificationPipeline {
  if (!globalPipeline) {
    globalPipeline = new ClassificationPipeline()
      .addClassifier(new ExplicitClassifier())
      .addClassifier(new PatternClassifier())
      .addClassifier(new ContextClassifier());
  }
  return globalPipeline;
}

/**
 * 分类用户输入（向后兼容接口）
 *
 * @param input 用户输入
 * @param context 路由上下文（可选）
 */
export function classifyIntent(input: string, context?: Partial<RouterContext>): IntentResult {
  const fullContext: RouterContext = {
    currentMode: context?.currentMode ?? "chat",
    currentAgent: context?.currentAgent ?? "butler",
    focusZone: context?.focusZone ?? "input",
    history: context?.history ?? [],
  };

  return getPipeline().classify(input, fullContext);
}

/**
 * 异步分类（向后兼容——实际为同步操作的 Promise 包装）
 */
export async function classifyIntentAsync(
  input: string,
  context?: Partial<RouterContext>,
): Promise<IntentResult> {
  const fullContext: RouterContext = {
    currentMode: context?.currentMode ?? "chat",
    currentAgent: context?.currentAgent ?? "butler",
    focusZone: context?.focusZone ?? "input",
    history: context?.history ?? [],
  };

  return getPipeline().classify(input, fullContext);
}

/**
 * 重置管道（用于测试）
 */
export function resetPipeline(): void {
  globalPipeline = null;
}

// 重新导出类型
export type { IntentResult, RouterContext, IntentType, ClassificationTrace } from "./types.js";
export type { Classifier, ClassificationResult } from "./types.js";
export { ClassificationPipeline } from "./pipeline.js";
export { ExplicitClassifier } from "./classifiers/explicit.js";
export { PatternClassifier } from "./classifiers/pattern.js";
export { ContextClassifier } from "./classifiers/context.js";
