// ============================================================
// @cortex/shared —— 上下文策略域
//
// ContextPolicy 控制 Agent 如何构建其执行上下文：
//   1. 对话保留策略（全轮 / 滑动窗口 / 摘要）
//   2. 事实检索策略（HCA/CSA + 检索组合）
//   3. 筛选组合管道（排序 → 去重 → 分层组装 → token 适配）
//
// MetaAgent 规划时根据任务类型自动选策略；
// Agent 执行中可以调用 updateContextPolicy 动态切换。
//
// @since Cortex Core-2 — 上下文生命周期管理协议
// ============================================================

import { LinkType, type ReadMode } from "./memory.js";

// ─── 对话保留策略 ────────────────────────────────────────

/**
 * 对话历史保留模式。
 *
 * - full:           保留全部消息历史（探索性任务/多轮修正）
 * - sliding-window: 只保留最近 k 轮（事务性/短流程任务）
 * - summary:        定期生成摘要替代原文（长会话/成本敏感）
 */
export type ConversationMode = "full" | "sliding-window" | "summary";

/**
 * 对话保留策略配置。
 */
export interface ConversationPolicy {
  /** 保留模式 */
  readonly mode: ConversationMode;
  /** 滑动窗口/摘要模式下的轮数上限 */
  readonly maxTurns?: number;
}

// ─── 事实检索策略 ────────────────────────────────────────

/**
 * 事实检索策略——控制 MemoryStore 如何查询上下文事实。
 *
 * readMode:
 *   HCA = 广度浅读，返回全部（含 Pending），适合 MetaAgent 全局规划
 *   CSA = 深度窄读，只返回语义态 Active，适合功能 Agent 精准执行
 */
export interface RetrievalPolicy {
  /** 读模式（HCA 全局 / CSA 精准） */
  readonly readMode: ReadMode;
  /** BFS 图遍历深度，0 = 仅关键词不展开。默认 2 */
  readonly bfsDepth?: number;
  /** BFS 最大展开节点数 */
  readonly bfsMaxNodes?: number;
  /** BFS 遍历时过滤边类型 */
  readonly linkTypes?: LinkType[];
  /** 按 metadata 字段精确过滤 */
  readonly metadataFilter?: Record<string, unknown>;
}

// ─── 筛选组合管道 ────────────────────────────────────────

/**
 * 排序策略——多源检索结果如何统一排序。
 *
 * - confidence:   按记忆置信度降序
 * - recency:      按访问时间降序
 * - relevance:    按向量相似度降序
 * - weighted:     加权组合（confidence × 时效衰减 × 命中率）
 */
export type SortMode = "confidence" | "recency" | "relevance" | "weighted";

export interface SortPolicy {
  /** 排序模式 */
  readonly mode: SortMode;
  /** weighted 模式下的置信度权重 (0-1) */
  readonly confidenceWeight?: number;
  /** weighted 模式下的时效衰减半衰期（毫秒） */
  readonly halfLifeMs?: number;
}

/**
 * 分层组装——检索结果如何分优先级装入上下文。
 *
 * critical:  关键事实，强制前置，不参与 token 截断
 * support:   支撑材料，中段放置，token 不足时按权重截断
 * reference: 参考附录，末段放置，token 不足时首先被裁
 */
export type AssembleTier = "critical" | "support" | "reference";

export interface AssemblePolicy {
  /** 三层分组的 token 占比（必须加起来 ≤ 1.0） */
  readonly tierBudget: Record<AssembleTier, number>;
  /** 单条记忆最大 token 估算值 */
  readonly maxTokensPerEntry?: number;
}

/**
 * Token 预算——检索源之间的 token 分配权重。
 * 不同任务类型倒置比例：代码修复 keyword 为主，架构审计 BFS 为主。
 */
export interface TokenBudget {
  /** BFS 图遍历结果占比 */
  readonly bfs: number;
  /** 向量语义检索结果占比 */
  readonly vector: number;
  /** 关键词匹配结果占比 */
  readonly keywords: number;
  /** 对话历史占比 */
  readonly conversation: number;
  /** 上下文总 token 上限 */
  readonly total: number;
}

/**
 * 筛选组合管道——检索结果的加工流水线。
 */
export interface PipelinePolicy {
  /** 排序策略 */
  readonly sort: SortPolicy;
  /** 是否启用去重合并（多源同一事实合为一条，保留最高置信度版本） */
  readonly deduplicate: boolean;
  /** 分层组装策略 */
  readonly assemble: AssemblePolicy;
  /** 检索源 token 预算分配 */
  readonly tokenBudget: TokenBudget;
}

// ─── ContextPolicy ────────────────────────────────────────

/**
 * 上下文管理策略——控制 Agent 如何构建其执行上下文。
 *
 * 每个策略包含三部分：
 * 1. conversation — 对话历史保留方式
 * 2. retrieval     — MemoryStore 事实检索策略
 * 3. pipeline      — 检索结果筛选组合管道
 *
 * @example
 * ```typescript
 * // 代码重构任务：全轮对话 + CSA 精准检索 + 关键词为主
 * const codeRefactorPolicy: ContextPolicy = {
 *   id: "code-refactor-v1",
 *   conversation: { mode: "full" },
 *   retrieval: { readMode: "CSA", bfsDepth: 2, linkTypes: ["ProducedBy"] },
 *   pipeline: {
 *     sort: { mode: "weighted", confidenceWeight: 0.7, halfLifeMs: 3_600_000 },
 *     deduplicate: true,
 *     assemble: { tierBudget: { critical: 0.4, support: 0.4, reference: 0.2 } },
 *     tokenBudget: { bfs: 0.2, vector: 0.1, keywords: 0.6, conversation: 0.1, total: 32000 },
 *   },
 * };
 * ```
 */
export interface ContextPolicy {
  /** 策略唯一标识，TaskNode.contextPolicyId 引用此值 */
  readonly id: string;
  /** 策略描述（用于诊断日志） */
  readonly description?: string;
  /** 对话保留策略 */
  readonly conversation: ConversationPolicy;
  /** 事实检索策略 */
  readonly retrieval: RetrievalPolicy;
  /** 筛选组合管道 */
  readonly pipeline: PipelinePolicy;
  /** 是否允许 Agent 运行时动态切换策略。默认 true。 */
  readonly dynamicSwitch?: boolean;
  /** 是否从父任务继承检索结果快照（子任务跳过重复查询）。默认 false。 */
  readonly inheritFromParent?: boolean;
}

// ─── 预设策略库 ───────────────────────────────────────────

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
    conversation: { mode: "full", maxTurns: 0 },
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
    retrieval: { readMode: "CSA", bfsDepth: 2, linkTypes: [LinkType.ProducedBy, LinkType.DerivedFrom] },
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
    retrieval: { readMode: "CSA", bfsDepth: 1, linkTypes: [LinkType.ProducedBy] },
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
};
