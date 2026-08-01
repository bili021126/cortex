// @layer 规划-执行层
// @cortex/engine/core/meta-agent-parsers —— MetaAgent JSON/节点解析纯函数
// 从 MetaAgent 类剥离出的内聚解析模块（W5/M5 god-object 拆分）

import { extractJsonBlock, type Tag, type TaskNode } from "@cortex/shared";
import { DegradationBoundary } from "./degradation-boundary.js";

// ─── 类型 ───────────────────────────────────────

interface PlanItem {
  task: string;
  type?: string;
  tags?: string[];
  needsMultiPerspective?: boolean;
  reasoningEffort?: "high" | "max";
  recommendedTier?: "fast" | "standard" | "thinking";
  children?: PlanItem[];
  /** Phase 3 上下文场景 */
  contextScene?: string;
  /** Phase 3 上下文人物 */
  contextPersona?: string;
}

export type { PlanItem };

// ─── 解析函数 ────────────────────────────────────

/** 从 LLM 输出提取 JSON（委托 @cortex/shared 统一实现，失败时回退原始字符串）。 */
export function extractJson(raw: string): string {
  return extractJsonBlock(raw) ?? raw;
}

/** 构造兜底 TaskNode（JSON 解析失败时） */
export function fallbackNode(raw: string, parentId?: string): TaskNode {
  return {
    id: `task-${Date.now()}-0`,
    parentId,
    type: "analysis",
    tags: ["analysis"] as Tag[],
    needsMultiPerspective: false,
    status: "pending",
    claimedBy: [],
    payload: raw,
    results: [],
    createdAt: Date.now(),
    contextPolicyId: "diagnose",
  };
}

/** 尝试解析 JSON 为 PlanItem[]，自动修复常见 LLM 格式问题 */
export function tryParseItems(jsonStr: string): PlanItem[] | null {
  if (!jsonStr || jsonStr.length < 2) return null;

  // 策略 1: 直接解析
  try { return JSON.parse(jsonStr); } catch (err) { DegradationBoundary.handle(err, 'meta-agent', 'trace'); }

  // 策略 2: 去除尾部多余逗号（LLM 经典错误）
  try { return JSON.parse(jsonStr.replace(/,\s*([\]}])/g, "$1")); } catch (err) { DegradationBoundary.handle(err, 'meta-agent', 'trace'); }

  // 策略 3: 截取首 [ 到末 ]，再做一次字符串感知提取（双保险）
  const firstBracket = jsonStr.indexOf("[");
  const lastBracket = jsonStr.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const trimmed = jsonStr.slice(firstBracket, lastBracket + 1);
    try { return JSON.parse(trimmed); } catch (err) { DegradationBoundary.handle(err, 'meta-agent', 'trace'); }
    try { return JSON.parse(trimmed.replace(/,\s*([\]}])/g, "$1")); } catch (err) { DegradationBoundary.handle(err, 'meta-agent', 'trace'); }
  }

  return null;
}
