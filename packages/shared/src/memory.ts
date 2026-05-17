// ============================================================
// @cortex/shared — 记忆系统类型域
// ============================================================

import type { AgentType } from "./agent.js";

// ─── 记忆系统（兼容议题四 Schema） ────────────────────────

export enum MemoryType {
  Episodic = "EPISODIC",
  Conceptual = "CONCEPTUAL",
  Knowledge = "KNOWLEDGE",
  Skill = "SKILL",
}

export enum MemoryState {
  Active = "ACTIVE",
  Pending = "PENDING",
  Archived = "ARCHIVED",
  Frozen = "FROZEN",
  Obliterated = "OBLITERATED",
}

/**
 * MemorySubType —— 记忆子类型，区分意图（规划阶段的思考）与事实（执行后的产出）。
 *
 * P0-六层防御：意图/事实分离是记忆-现实一致性的第一道防线。
 * 意图记忆在规划阶段写入，事实记忆在执行完成后写入，
 * 二者在检索中可独立过滤，避免"想做的事"和"做成的事"混淆。
 */
export enum MemorySubType {
  Intent = "INTENT",
  Fact = "FACT",
}

export interface MemoryEntry {
  id: string;
  memoryType: MemoryType;
  state: MemoryState;
  /** P0-六层防御：意图/事实子类型分离 */
  subType?: MemorySubType;
  content: Record<string, unknown>;
  summary: string;
  agentType: AgentType; // v2.0：替代 orientation_source
  creatorId: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  weight: number;
  projectFingerprint?: string;
  metadata?: Record<string, unknown>;
  isPrivate: boolean;
  /** 语义嵌入向量（384d Float32，异步生成，NULL 时跳过向量粗召） */
  embedding?: number[];
}

/**
 * MemoryWriteInput —— 记忆写入构造参数（id/createdAt/lastAccessedAt 由 MemoryStore 自动生成）。
 *
 * @migrated-from engine/src/memory-store.ts (P0 — 艾尔海森类型迁移计划)
 * @usedBy  engine/src/memory-store.ts, engine/src/memory/storage.ts, engine/src/memory/pipeline.ts
 * @since   v2.1 迁移至 shared，所有需要写入记忆的包共用此类型
 */
export interface MemoryWriteInput {
  memoryType: MemoryType;
  /** P0-六层防御：意图/事实子类型分离 */
  subType?: MemorySubType;
  content: Record<string, unknown>;
  summary: string;
  agentType: AgentType;
  creatorId: string;
  weight?: number;
  createdAt?: number;
  projectFingerprint?: string;
  metadata?: Record<string, unknown>;
  isPrivate?: boolean;
  /** 语义嵌入向量（384d number[]），异步生成后传入 */
  embedding?: number[];
}

export enum LinkType {
  AccessedDuring = "ACCESSED_DURING",
  ProducedBy = "PRODUCED_BY",
  DerivedFrom = "DERIVED_FROM",
  DependsOn = "DEPENDS_ON",
  RefactoredFrom = "REFACTORED_FROM",
  CitedInCommittee = "CITED_IN_COMMITTEE",
  CascadeTo = "CASCADE_TO",
  /** FSA 反馈：检索到的记忆在决策中被实际引用 */
  ConfirmedUseful = "CONFIRMED_USEFUL",
  /** FSA 反馈：检索到的记忆在决策中未被引用，标记为噪音候选 */
  ConfirmedNoise = "CONFIRMED_NOISE",
}

export interface MemoryLink {
  id: string;
  sourceId: string;
  targetId: string;
  linkType: LinkType;
  weight: number;
  targetState: MemoryState;
  lastAccessedAt: number;
}

export interface MemoryQuery {
  keywords?: string[];
  memoryTypes?: MemoryType[];
  states?: MemoryState[];
  /** P0-六层防御：按子类型过滤（INTENT / FACT） */
  subTypes?: MemorySubType[];
  timeRange?: { start: number; end: number };
  agentTypes?: AgentType[];
  includePrivate?: boolean;
  limit?: number;
  /** 稀疏注意力模式：hca=广度浅读（MetaAgent 规划），csa=深度窄读（Agent 执行）。默认 csa。 */
  queryMode?: 'hca' | 'csa';
  /** HCA 模式（MetaAgent 规划扫描）：false 时不累加 accessCount/不刷新 lastAccessedAt。默认 true（CSA 模式）。 */
  trackAccess?: boolean;
  /** BFS 图检索深度（沿关联边遍历）。0 = 仅关键词匹配，不展开。默认 2。 */
  bfsDepth?: number;
  /** BFS 最大展开节点数，防止图爆炸。默认 20。 */
  bfsMaxNodes?: number;
  /** BFS 遍历方向：'both' = 出边+入边双向（默认，兼容旧行为），'outbound' = 仅出边（抗噪音）。 */
  bfsDirection?: 'both' | 'outbound';
  /** BFS 遍历时过滤关联边类型。未指定时遍历所有边。 */
  linkTypes?: LinkType[];
  /** 按 metadata 字段精确过滤记忆条目。多个键值间为 AND 关系。 */
  metadataFilter?: Record<string, unknown>;
  /** 向量粗召模式：提供 query embedding 以启用语义召回。384d number[]。 */
  queryEmbedding?: number[];
  /** 向量粗召 Top-K 数量（默认 50） */
  vectorTopK?: number;
}
