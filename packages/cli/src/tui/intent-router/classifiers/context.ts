/**
 * tui/intent-router/classifiers/context.ts — L3 上下文推断分类器
 *
 * 根据当前模式、历史、焦点状态推断意图。
 *
 * @module tui/intent-router/classifiers/context
 * @since v6
 */

import type { Classifier, ClassificationResult, RouterContext } from "../types.js";

/**
 * 上下文推断分类器
 * 利用运行时上下文增强分类准确性
 */
export class ContextClassifier implements Classifier {
  name = "context";

  /** 计划审批关键词 */
  private readonly planApprovalWords = [
    "好的", "执行", "确认", "开始", "可以",
    "ok", "yes", "go", "start", "approve",
  ];

  classify(input: string, context: RouterContext): ClassificationResult {
    const trimmed = input.trim().toLowerCase();

    // 在 plan reviewing 模式下，匹配审批词
    if (context.currentMode === "plan" || context.currentMode === "reviewing") {
      if (this.planApprovalWords.some((w) => trimmed === w || trimmed.startsWith(w + " "))) {
        return {
          type: "confirmation",
          confidence: 0.85,
          reason: `当前处于 plan 模式，匹配审批词: "${trimmed}"`,
          params: { modeId: "plan-execute" },
        };
      }
    }

    // 在群聊模式下，@提及倾向 agent-invoke
    if (context.currentMode === "group") {
      if (input.includes("@")) {
        return {
          type: "agent-invoke",
          confidence: 0.7,
          reason: "群聊模式下的 @提及",
        };
      }
    }

    // 历史上下文：如果最近都是任务，新输入也倾向任务
    if (context.history.length >= 3) {
      const recentTaskCount = context.history.slice(-3).filter((h) => h === "task").length;
      if (recentTaskCount >= 2) {
        return {
          type: "task",
          confidence: 0.55,
          reason: "近期历史多为任务，上下文推断为任务",
        };
      }
    }

    return {
      type: "ambiguous",
      confidence: 0.2,
      reason: "上下文无特殊信号",
    };
  }
}
