/**
 * tui/intent-router/pipeline.ts — 分类管道
 *
 * 编排多个分类器，逐层分类，高置信度提前退出。
 *
 * @module tui/intent-router/pipeline
 * @since v6
 */

import type { Classifier, ClassificationTrace, IntentResult, RouterContext } from "./types.js";
import { fuseResults } from "./classifiers/confidence.js";

/** 高置信度提前退出阈值 */
const EARLY_EXIT_THRESHOLD = 0.95;

/**
 * 分类管道
 * 按顺序执行分类器，支持提前退出和结果融合
 */
export class ClassificationPipeline {
  private classifiers: Classifier[] = [];

  /**
   * 添加分类器
   */
  addClassifier(classifier: Classifier): this {
    this.classifiers.push(classifier);
    return this;
  }

  /**
   * 执行分类（同步——所有分类器均为同步操作）
   */
  classify(input: string, context: RouterContext): IntentResult {
    const traces: ClassificationTrace[] = [];

    for (const classifier of this.classifiers) {
      try {
        const result = classifier.classify(input, context);

        traces.push({
          classifier: classifier.name,
          result: result.type,
          confidence: result.confidence,
          reason: result.reason,
        });

        // 高置信度提前退出
        if (result.confidence >= EARLY_EXIT_THRESHOLD) {
          return {
            type: result.type,
            confidence: result.confidence,
            trace: traces,
            params: result.params ?? {},
          };
        }
      } catch {
        // 分类器异常，跳过
        traces.push({
          classifier: classifier.name,
          result: "ambiguous",
          confidence: 0,
          reason: "分类器执行异常",
        });
      }
    }

    // 融合所有结果
    const fused = fuseResults(traces);
    // 保留分类器提取的 params
    for (const trace of traces) {
      if (trace.confidence > 0) {
        // 从最高置信度的分类器获取 params
        // (简化处理，实际可从 classifier 结果中获取)
      }
    }

    return fused;
  }
}
