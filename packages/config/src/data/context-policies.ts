// ============================================================
// @cortex/config/data/context-policies —— 预设上下文策略库
//
// 从 @cortex/shared 迁入的运行时数据。
// 类型定义 ContextPolicy / ConversationMode / RetrievalPolicy 等
// 仍保留在 @cortex/shared 中。
// ============================================================

import type { ContextPolicy } from "@cortex/shared";
import type { LinkType } from "@cortex/shared";

/**
 * 内置预设策略 ID 列表。
 * MetaAgent 规划时根据 TaskNode.type/tags 自动匹配。
 */
export const PRESET_CONTEXT_POLICIES: Record<string, ContextPolicy> = {
  /**
   * chat: 自由闲聊——滑动窗口 20 轮，不检索事实。
   */
  chat: {
    id: "chat",
    description: "自由闲聊：滑动窗口 20 轮，不检索事实",
    conversation: { mode: "sliding-window", maxTurns: 20 },
    retrieval: { readMode: "CSA", bfsDepth: 0 },
    pipeline: {
      sort: { mode: "recency" },
      deduplicate: false,
      assemble: { tierBudget: { critical: 0.5, support: 0.3, reference: 0.2 } },
      tokenBudget: { bfs: 0, vector: 0, keywords: 0, conversation: 1, total: 8000 },
    },
  },

  /**
   * single-step: 单步任务——零历史，只看 payload。
   */
  "single-step": {
    id: "single-step",
    description: "单步任务：零历史，只看 payload",
    conversation: { mode: "sliding-window", maxTurns: 0 },
    retrieval: { readMode: "CSA", bfsDepth: 0 },
    pipeline: {
      sort: { mode: "relevance" },
      deduplicate: false,
      assemble: { tierBudget: { critical: 1, support: 0, reference: 0 } },
      tokenBudget: { bfs: 0, vector: 0, keywords: 0, conversation: 1, total: 4000 },
    },
  },

  /**
   * code-refactor: 代码重构——全轮对话 + CSA 精准检索 + 关键词为主。
   */
  "code-refactor": {
    id: "code-refactor",
    description: "代码重构：全轮对话 + CSA + 关键词为主",
    conversation: { mode: "full" },
    retrieval: { readMode: "CSA", bfsDepth: 2, linkTypes: ["PRODUCED_BY" as LinkType, "DERIVED_FROM" as LinkType] },
    pipeline: {
      sort: { mode: "weighted", confidenceWeight: 0.7, halfLifeMs: 3_600_000 },
      deduplicate: true,
      assemble: { tierBudget: { critical: 0.4, support: 0.4, reference: 0.2 } },
      tokenBudget: { bfs: 0.2, vector: 0.1, keywords: 0.6, conversation: 0.1, total: 32000 },
    },
  },

  /**
   * architecture-review: 架构审计——不保留对话，BFS 为主。
   */
  "architecture-review": {
    id: "architecture-review",
    description: "架构审计：不保留对话，BFS 图遍历为主",
    conversation: { mode: "full", maxTurns: 0 },
    retrieval: { readMode: "HCA", bfsDepth: 4, bfsMaxNodes: 200 },
    pipeline: {
      sort: { mode: "weighted", confidenceWeight: 0.5, halfLifeMs: 86_400_000 },
      deduplicate: true,
      assemble: { tierBudget: { critical: 0.3, support: 0.5, reference: 0.2 } },
      tokenBudget: { bfs: 0.6, vector: 0.25, keywords: 0.1, conversation: 0.05, total: 64000 },
    },
  },

  /**
   * diagnose: 故障诊断——全轮对话 + 关键词精确匹配。
   */
  diagnose: {
    id: "diagnose",
    description: "故障诊断：全轮对话 + 关键词精确匹配",
    conversation: { mode: "full" },
    retrieval: { readMode: "CSA", bfsDepth: 1, linkTypes: ["PRODUCED_BY" as LinkType] },
    pipeline: {
      sort: { mode: "recency" },
      deduplicate: false,
      assemble: { tierBudget: { critical: 0.5, support: 0.3, reference: 0.2 } },
      tokenBudget: { bfs: 0.1, vector: 0.1, keywords: 0.5, conversation: 0.3, total: 48000 },
    },
  },

  /**
   * solo-flight: 冷启动建包——全轮对话 + HCA 全局扫描。
   */
  "solo-flight": {
    id: "solo-flight",
    description: "冷启动建包：全轮对话 + HCA 全局扫描",
    conversation: { mode: "full" },
    retrieval: { readMode: "HCA", bfsDepth: 2, bfsMaxNodes: 100 },
    pipeline: {
      sort: { mode: "weighted", confidenceWeight: 0.5, halfLifeMs: 7_200_000 },
      deduplicate: true,
      assemble: { tierBudget: { critical: 0.35, support: 0.45, reference: 0.2 } },
      tokenBudget: { bfs: 0.4, vector: 0.3, keywords: 0.2, conversation: 0.1, total: 48000 },
    },
  },

  /**
   * planning: MetaAgent 规划——HCA 全局扫描 + 含 Intent 类记忆。
   *
   * 与 code-refactor/architecture-review 的关键区别：
   * - HCA 模式不过滤 Intent（MetaAgent 需要看到"想做什么"来规划）
   * - BFS 深度大（4），token 预算高（96K），确保全局视野
   * - 排序为 cognitive 模式：贝叶斯相关性 + 傅里叶时间衰减 + 联想激活
   */
  planning: {
    id: "planning",
    description: "MetaAgent 规划：HCA 全局扫描含 Intent 类记忆",
    conversation: { mode: "full" },
    retrieval: { readMode: "HCA", bfsDepth: 4, bfsMaxNodes: 300 },
    pipeline: {
      sort: { mode: "cognitive" },
      deduplicate: true,
      assemble: { tierBudget: { critical: 0.3, support: 0.4, reference: 0.3 } },
      tokenBudget: { bfs: 0.5, vector: 0.25, keywords: 0.15, conversation: 0.1, total: 96000 },
      bayesianPrior: 0.25,
      linkActivationDepth: 4,
    },
  },
};
