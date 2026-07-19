/**
 * tui/intent-router/classifiers/confidence.ts — L4 置信度融合器
 *
 * 融合多个分类器的结果，做出最终决策。
 *
 * @module tui/intent-router/classifiers/confidence
 * @since v6
 */

import type { IntentType, IntentResult, ClassificationTrace } from "../types.js";

/** 低置信度阈值（需要确认） */
const LOW_CONFIDENCE = 0.4;

/**
 * 融合多个分类结果
 */
export function fuseResults(traces: ClassificationTrace[]): IntentResult {
  // 过滤掉无结果的分类器
  const validTraces = traces.filter((t) => t.confidence > 0);

  if (validTraces.length === 0) {
    return {
      type: "chat",
      confidence: 0.3,
      trace: traces,
      params: {},
      uiHint: { showConfirmation: true, suggestedLabel: "我将作为对话处理" },
    };
  }

  // 按类型分组，计算加权总分
  const scores = new Map<IntentType, { total: number; count: number }>();
  for (const trace of validTraces) {
    const existing = scores.get(trace.result);
    if (existing) {
      existing.total += trace.confidence;
      existing.count++;
    } else {
      scores.set(trace.result, {
        total: trace.confidence,
        count: 1,
      });
    }
  }

  // 找到最高分的类型
  let bestType: IntentType = "chat";
  let bestScore = 0;

  for (const [type, data] of scores) {
    // 多分类器一致时加权
    const consensusBonus = data.count > 1 ? 0.1 * (data.count - 1) : 0;
    const adjustedScore = data.total + consensusBonus;

    if (adjustedScore > bestScore) {
      bestScore = adjustedScore;
      bestType = type;
    }
  }

  // 归一化置信度
  const confidence = Math.min(1, bestScore / validTraces.length * validTraces.length);

  // 构建 UI 提示
  let uiHint: IntentResult["uiHint"];
  if (confidence < LOW_CONFIDENCE) {
    uiHint = {
      showConfirmation: true,
      suggestedLabel: `我不太确定你的意图，将作为${typeToLabel(bestType)}处理`,
    };
  }

  return {
    type: bestType,
    confidence,
    trace: traces,
    params: {},
    uiHint,
  };
}

function typeToLabel(type: IntentType): string {
  switch (type) {
    case "task": return "任务";
    case "command": return "命令";
    case "chat": return "对话";
    case "mode-switch": return "模式切换";
    case "agent-invoke": return "Agent 调用";
    case "confirmation": return "确认";
    case "navigation": return "导航";
    default: return "未知";
  }
}
