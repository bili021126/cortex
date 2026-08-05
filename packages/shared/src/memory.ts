// ============================================================
// @cortex/shared — 记忆系统类型域 v3
//
// v3 重构：字段四层切割（身份/认知/生命周期/工程）
//       + HCA/CSA 检索模式分离
//       + content_hash 正式化（不再走 as any 走私）
//       + summary 仅展示，semantic_gist 专供 embedding
//       + kind 替代 memoryType/subType
//       + agentType+taskId 合并为 source
// ============================================================

import type { AgentType } from "./agent.js";

// ─── v3 核心类型 ──────────────────────────────────────────

/** 记忆认知类别
 *
 * | 类别       | 语义                     | isFact 默认 |
 * |-----------|--------------------------|-------------|
 * | TaskLog   | 任务执行记录（事实）       | true        |
 * | Insight   | 洞察/分析结论（事实）      | true        |
 * | Skill     | 技能提取/结晶（事实）      | true        |
 * | Governance| 治理决策/审议记录（事实）  | true        |
 * | Intent    | 意图/计划/待办（非事实）   | false       |
 *
 * Intent 与其余四类的核心区别：
 * - Fact 类记忆描述"已经发生的事"——可验证、可对账、不可回滚
 * - Intent 类记忆描述"想做的事"——尚未发生、可能变更、可取消
 *
 * @remarks
 * CSA 执行检索时自动过滤 Intent，防止"想做的事"污染 Agent 决策。
 * HCA 规划扫描不过滤——MetaAgent 需要全局视图（含半成品意图）。
 */
export type MemoryKind = "TaskLog" | "Insight" | "Skill" | "Governance" | "Intent";

/** 语义生命周期 */
export type SemanticState = "Pending" | "Active" | "Archived" | "Obliterated";

/**
 * 合法状态转换表——单一事实来源（Single Source of Truth）。
 * memory-store 和 memory 两包的 cas() 统一引用此表。
 */
export const MEMORY_VALID_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  Pending: new Set(["Active", "Obliterated"]),
  Active: new Set(["Archived", "Obliterated", "Active"]),
  Archived: new Set(["Obliterated", "Archived", "Active"]),
  Obliterated: new Set(),
};

/** 检索模式：HCA=广度浅读（MetaAgent 规划），CSA=深度窄读（Agent 执行） */
export type ReadMode = "HCA" | "CSA";

/** 记忆来源锚点 */
export interface MemorySource {
  agentType: AgentType;
  taskId: string;
}

// ─── MemoryEntry v3 ─────────────────────────────────────

export interface MemoryEntry {
  // §1 身份层（写入后永不变）
  id: string;
  source: MemorySource;
  /** 记忆域——用于 DomainGate 门控过滤。默认 'general'。空串或 undefined 等效于 'general' */
  domain?: string;
  /** 运行会话标识——每次 executeAll() 生成唯一 runId。正常完成时融入认知共享层，任务终结时按 sessionId 批量清理。undefined 为向后兼容（v2.5.41 前无此字段） */
  sessionId?: string;

  // §2 认知层（自迭代策略操作的对象）
  kind: MemoryKind;
  /** 是否为事实记忆。Intent 类记忆默认 false，其余默认 true。
   *  CSA 检索时 isFact===false 的条目被自动排除。 */
  isFact?: boolean;
  summary: string;
  /** LLM 萃取的语义精华，专供 embedding 生成。<=200 字 */
  semantic_gist: string;
  /** 原始完整 JSON 输出，不截断 */
  content_blob: Record<string, unknown>;

  // §3 生命周期层
  semantic_state: SemanticState;
  weight: number;
  accessCount: number;
  lastAccessedAt: number;
  /** R13-C1：上次 aging 时间——aging 锚点用独立字段（不刷新 lastAccessedAt——防 TTL/湮灭被续命失效） */
  lastAgedAt?: number;
  createdAt: number;

  // §4 工程层（不参与检索语义）
  embedding?: number[];
  content_hash: string;
  /** Unix 毫秒时间戳，之后可湮灭。0 或 undefined = 永不过期 */
  expires_at?: number;
  /** @internal 两阶段提交的 Pending 标记。仅 MemoryStore 内部使用，不参与序列化 */
  _pending?: boolean;
}

// ─── MemoryWriteInput v3 ────────────────────────────────

export interface MemoryWriteInput {
  // §1 身份
  source: MemorySource;
  /** 记忆域——用于 DomainGate 门控过滤。默认 'general'。空串或 undefined 等效于 'general' */
  domain?: string;
  /** 运行会话标识。MemoryStore 内部自动从当前 session 注入，外部可选提供。 */
  sessionId?: string;

  // §2 认知
  kind: MemoryKind;
  /** 是否事实记忆。未显式指定时由 IntentFactWall 按 kind 自动推断 */
  isFact?: boolean;
  summary: string;
  semantic_gist: string;
  content_blob: Record<string, unknown>;

  // §3 生命周期（可选，MemoryStore 填默认值）
  weight?: number;
  createdAt?: number;
  /** R12-C3 配套：最近访问时间——显式提供时被尊重（TTL 基于它）；默认写入时设 now */
  lastAccessedAt?: number;

  // §4 工程
  embedding?: number[];
  /** SHA256 内容哈希，store 内部自动计算，外部可选提供 */
  content_hash?: string;
  expires_at?: number;
}

// ─── ReadMode ──────────────────────────────────────────

// ─── LinkType ────────────────────────────────────────────
// link_type 精简：移除非实践验证的值。ProducedBy/DerivedFrom
// 是主力，ConfirmedUseful/ConfirmedNoise 是 FSA 反馈闭环所需。
// 其他值在 Core-1 未产生实际链路，后续按需恢复。

export enum LinkType {
  ProducedBy = "PRODUCED_BY",
  DerivedFrom = "DERIVED_FROM",
  ConfirmedUseful = "CONFIRMED_USEFUL",
  ConfirmedNoise = "CONFIRMED_NOISE",
}

export interface MemoryLink {
  id: string;
  sourceId: string;
  targetId: string;
  linkType: LinkType;
  weight: number;
  targetState: SemanticState;
  lastAccessedAt: number;
}

// ─── MemoryQuery v3 ─────────────────────────────────────
// 检索策略（"找什么"）与检索模式（"怎么读"）分离。
// queryMode / trackAccess / subTypes 已移除，
// HCA/CSA 由 read(query, mode) 的 mode 参数控制。

export interface MemoryQuery {
  /** 按认知类别过滤。不指定则返回全部 */
  kind?: MemoryKind;
  /** 关键词匹配（中文 bigram + 拉丁词） */
  keywords?: string[];
  /** 语义向量粗召（384d） */
  queryEmbedding?: number[];
  /** 向量粗召 Top-K */
  vectorTopK?: number;
  /** 时间范围过滤 */
  timeRange?: { start: number; end: number };
  /** 按 source.agentType 过滤 */
  agentTypes?: AgentType[];
  /** 结果数量限制 */
  limit?: number;
  /** BFS 图检索深度。0 = 仅关键词，不展开。默认 2 */
  bfsDepth?: number;
  /** BFS 最大展开节点数 */
  bfsMaxNodes?: number;
  /** BFS 遍历方向 */
  bfsDirection?: "both" | "outbound";
  /** BFS 遍历时过滤边类型 */
  linkTypes?: LinkType[];
  /** 按 metadata（content_blob 内字段）精确过滤 */
  metadataFilter?: Record<string, unknown>;
  /** DomainGate 门控参数——只返回 allow 内 / 排除 block 内的 domain 条目 */
  domainGate?: { allow?: string[]; block?: string[] };
}

// ─── IMemoryStore ──────────────────────────────────────

/**
 * IMemoryStore —— 记忆存储接口。
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export interface IMemoryStore {
  readonly isPersisted: boolean;
  readonly size: number;
  /** 当前运行会话标识。undefined 为未初始化或向后兼容 */
  readonly sessionId?: string;
  init(dbPath: string): Promise<void>;
  /** 开始新会话——生成或接受 sessionId，后续 write() 自动注入。@param externalId 可选——外部传入的 sessionId */
  beginSession(externalId?: string): string;
  /** 终结当前会话——按 sessionId 批量归档 Active 记忆、湮灭 Pending 记忆 */
  endSession(): Promise<number>;
  write(input: MemoryWriteInput): Promise<string>;
  /** @param mode HCA=广度浅读不追踪热度，CSA=深度窄读追踪热度 */
  read(query: MemoryQuery, mode?: ReadMode): Promise<MemoryEntry[]>;
  link(sourceId: string, targetId: string, linkType: LinkType): MemoryLink | null;
  getLinks(sourceId: string): MemoryLink[];
  has(memoryId: string): boolean;
  cas(memoryId: string, expected: SemanticState, newState: SemanticState): boolean;
  archive(memoryId: string): boolean;
  /** 冻结记忆——语义等同于 archive（映射到 Archived 状态），幂等。Core-2 将引入独立 Frozen 态 */
  freeze(memoryId: string): boolean;
  obliterate(memoryId: string): boolean;
  writePending(input: MemoryWriteInput): string;
  commitMemory(memoryId: string): boolean;
  /** 显式回滚——将指定 Pending 记忆湮灭（不经过 Active 态）。两阶段提交的终止路径 */
  rollback(memoryId: string): Promise<boolean>;
  /** 统一取消——自动判断状态：Pending→rollback，Active→archive。幂等 */
  cancel(memoryId: string): boolean;
  getPending(): MemoryEntry[];
  hasPending(): boolean;
  /** 按 sessionId 查询指定会话的所有记忆 */
  getBySession(sessionId: string): MemoryEntry[];
  peek(memoryId: string): Readonly<MemoryEntry> | undefined;
  flush(): Promise<void>;
  close(): Promise<void>;
  maintain(): MaintainReport;
  setPreWriteHook(hook: (input: MemoryWriteInput) => MemoryWriteInput): void;
}

export interface MaintainReport {
  archived: number;
  obliterated: number;
  orphanedLinks: number;
  skipped?: string;
}
