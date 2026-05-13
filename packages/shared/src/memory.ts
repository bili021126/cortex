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
  Archived = "ARCHIVED",
  Frozen = "FROZEN",
  Obliterated = "OBLITERATED",
}

export interface MemoryEntry {
  id: string;
  memoryType: MemoryType;
  state: MemoryState;
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
