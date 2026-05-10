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
}

export enum LinkType {
  AccessedDuring = "ACCESSED_DURING",
  ProducedBy = "PRODUCED_BY",
  DerivedFrom = "DERIVED_FROM",
  DependsOn = "DEPENDS_ON",
  RefactoredFrom = "REFACTORED_FROM",
  CitedInCommittee = "CITED_IN_COMMITTEE",
  CascadeTo = "CASCADE_TO",
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
  /** HCA 模式（MetaAgent 规划扫描）：false 时不累加 accessCount/不刷新 lastAccessedAt。默认 true（CSA 模式）。 */
  trackAccess?: boolean;
  /** BFS 图检索深度（沿关联边遍历）。0 = 仅关键词匹配，不展开。默认 2。 */
  bfsDepth?: number;
  /** BFS 最大展开节点数，防止图爆炸。默认 20。 */
  bfsMaxNodes?: number;
  /** BFS 遍历时过滤关联边类型。未指定时遍历所有边。 */
  linkTypes?: LinkType[];
  /** 按 metadata 字段精确过滤记忆条目。多个键值间为 AND 关系。 */
  metadataFilter?: Record<string, unknown>;
}
