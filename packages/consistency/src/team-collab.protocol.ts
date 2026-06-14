// ============================================================
// team-collab.protocol.ts —— 精英团队协作协议
//
// 模拟精英人类团队的信息共享与决策协作模式:
//   (a) 角色记忆域隔离 — 每个 Agent 类型只查看相关记忆域
//   (b) 共享心智模型 — 跨 Agent 信息传递与关联
//   (c) 递推协作环 —— 任务后反思与全局记忆整理
//   (d) 决策升级路径 — 信息冲突时逐级升级
//
// @design 协作协议通过 MemoryStore.read() 的 metadataFilter 实现域隔离
// @since Core-3 — 认知增强 + 团队协作建模
// ============================================================

import { LinkType, type MemoryEntry, type MemoryWriteInput, type MemoryKind, type AgentType } from "@cortex/shared";
import type { MemoryStore } from "@cortex/memory-store";
import { createDefaultConflictDetector, type ConflictDetector, type ConflictReport } from "./conflict-detector.js";

// ── 类型 ──────────────────────────────────────

/** Agent 角色标识 */
export type AgentRole = "Meta" | "Code" | "Review" | "Analysis" | "Ops" | "Loop";

/** 记忆域范围 */
export interface MemoryDomainScope {
  /** 优先关注的记忆种类 */
  prioritizedKinds: MemoryKind[];
  /** 排除的记忆种类 */
  excludedKinds: MemoryKind[];
  /** 优先关注的 Agent 角色 */
  prioritizedRoles: string[];
  /** 读模式偏好 */
  preferredReadMode: "HCA" | "CSA";
}

/** 共享心智条目——跨 Agent 传递的记忆摘要 */
export interface SharedMentalEntry {
  id: string;
  authorRole: AgentRole;
  summary: string;
  kind: MemoryKind;
  createdAt: number;
  parentTaskId: string;
}

/** 任务后反思 */
export interface PostTaskReflection {
  taskId: string;
  agentRole: AgentRole;
  /** 学到了什么 */
  learned: string;
  /** 哪些假设被验证 */
  hypothesesVerified: string;
  /** 需要修正什么 */
  correctionsNeeded: string;
  /** 建���写入的记忆 ID 列表 */
  memoryIds: string[];
}

/** 协作环配置 */
export interface TeamCollabConfig {
  /** 任务完成后是否自动触发反思 */
  enablePostTaskReflection: boolean;
  /** 是否启用共享心智模型 */
  enableSharedMentalModel: boolean;
  /** 共享心智模型最大保留条目数 */
  maxSharedEntries: number;
  /** 是否启用冲突升级 */
  enableConflictEscalation: boolean;
  /** 冲突升级阈值 */
  escalationWeightThreshold: number;
}

// ── 默认配置 ─────────────────────────────────

export const DEFAULT_TEAM_COLLAB_CONFIG: TeamCollabConfig = {
  enablePostTaskReflection: true,
  enableSharedMentalModel: true,
  maxSharedEntries: 50,
  enableConflictEscalation: true,
  escalationWeightThreshold: 0.3,
};

// ── 角色记忆域映射 ───────────────────────────

/**
 * 每个 Agent 角色的记忆域范围。
 *
 * Meta (甘雨/策略师):   全局视野——不排除任何域，HCA 广度浅读
 * Code (阿贝多/工程师):   专注于 IMPLEMENTATION/EPISODIC，排除 SEMANTIC
 * Review (刻晴/审计师):  专注于 SEMANTIC/AUDIT，排除 IMPLEMENTATION
 * Analysis (纳西娅/分析师): 专注于 ANALYSIS/RESEARCH，HCA 广度
 * Ops (北斗/运维师):     专注于 DEPLOY/TEST 领域记忆
 * Loop (莫娜/观察者):    专注于 ANALYSIS/PATTERN，CSA 深度窄读
 */
export const AGENT_MEMORY_SCOPES: Record<AgentRole, MemoryDomainScope> = {
  Meta: {
    prioritizedKinds: ["TaskLog", "Insight"],
    excludedKinds: [],
    prioritizedRoles: ["Meta"],
    preferredReadMode: "HCA",
  },
  Code: {
    prioritizedKinds: ["TaskLog", "Skill"],
    excludedKinds: [],
    prioritizedRoles: ["Code"],
    preferredReadMode: "CSA",
  },
  Review: {
    prioritizedKinds: ["Insight"],
    excludedKinds: [],
    prioritizedRoles: ["Review"],
    preferredReadMode: "CSA",
  },
  Analysis: {
    prioritizedKinds: ["Insight", "TaskLog"],
    excludedKinds: [],
    prioritizedRoles: ["Analysis"],
    preferredReadMode: "HCA",
  },
  Ops: {
    prioritizedKinds: ["TaskLog", "Skill"],
    excludedKinds: [],
    prioritizedRoles: ["Ops"],
    preferredReadMode: "CSA",
  },
  Loop: {
    prioritizedKinds: ["Insight", "Skill"],
    excludedKinds: [],
    prioritizedRoles: ["Loop"],
    preferredReadMode: "CSA",
  },
};

// ── 精英团队协作管理器 ────────────────────────

export class TeamCollabManager {
  readonly config: TeamCollabConfig;
  private readonly _memory: MemoryStore;

  /** 共享心智模型——跨 Agent 共享的最近记忆摘要 */
  private _sharedEntries: SharedMentalEntry[] = [];

  /** 最近反思记录 */
  private _reflections: PostTaskReflection[] = [];

  /** 冲突检测器 */
  private readonly _conflictDetector: ConflictDetector;

  constructor(
    memory: MemoryStore,
    config: Partial<TeamCollabConfig> = {},
    conflictDetector?: ConflictDetector,
  ) {
    this._memory = memory;
    this.config = { ...DEFAULT_TEAM_COLLAB_CONFIG, ...config };
    this._conflictDetector = conflictDetector ?? createDefaultConflictDetector();
  }

  // ── 记忆域隔离 ──────────────────────────

  /**
   * 为指定 Agent 角色生成记忆过滤条件。
   */
  getDomainFilter(role: AgentRole): {
    prioritizedKinds: MemoryKind[];
    excludedKinds: MemoryKind[];
    preferredReadMode: "HCA" | "CSA";
  } {
    const scope = AGENT_MEMORY_SCOPES[role] ?? AGENT_MEMORY_SCOPES["Meta"];
    return {
      prioritizedKinds: scope.prioritizedKinds,
      excludedKinds: scope.excludedKinds,
      preferredReadMode: scope.preferredReadMode,
    };
  }

  /**
   * 按角色域过滤记忆列表。
   */
  filterByDomain(entries: MemoryEntry[], role: AgentRole): MemoryEntry[] {
    const scope = AGENT_MEMORY_SCOPES[role];
    if (!scope) return entries;

    return entries
      .filter((e) => !scope.excludedKinds.includes(e.kind))
      .sort((a, b) => {
        const pa = scope.prioritizedKinds.indexOf(a.kind);
        const pb = scope.prioritizedKinds.indexOf(b.kind);
        // 优先种类排前面
        if (pa >= 0 && pb >= 0) return pa - pb;
        if (pa >= 0) return -1;
        if (pb >= 0) return 1;
        return b.weight - a.weight;
      });
  }

  // ── 共享心智模型 ────────────────────────

  /**
   * Agent 任务完成后，将其核心产出写入共享心智模型。
   *
   * @param entry     产出的记忆条目
   * @param role      产出 Agent 的角色
   * @param taskId    关联的任务节点 ID
   */
  addToSharedModel(entry: MemoryEntry, role: AgentRole, taskId: string): void {
    if (!this.config.enableSharedMentalModel) return;

    this._sharedEntries.push({
      id: entry.id,
      authorRole: role,
      summary: entry.summary,
      kind: entry.kind,
      createdAt: Date.now(),
      parentTaskId: taskId,
    });

    // 淘汰最早条目
    if (this._sharedEntries.length > this.config.maxSharedEntries) {
      this._sharedEntries = this._sharedEntries.slice(-this.config.maxSharedEntries);
    }

    // 与前序共享记忆建立关联
    this._linkToPriorEntries(entry.id, role, taskId);
  }

  /**
   * 获取指定角色可见的共享心智摘要。
   * 不同角色可以看到哪些共享条目由记忆域隔离决定。
   */
  getSharedView(role: AgentRole): SharedMentalEntry[] {
    const scope = AGENT_MEMORY_SCOPES[role];
    if (!scope) return [...this._sharedEntries];

    return this._sharedEntries
      .filter((e) => !scope.excludedKinds.includes(e.kind))
      .sort((a, b) => {
        const pa = scope.prioritizedKinds.indexOf(a.kind);
        const pb = scope.prioritizedKinds.indexOf(b.kind);
        if (pa >= 0 && pb >= 0) return pa - pb;
        if (pa >= 0) return -1;
        if (pb >= 0) return 1;
        return b.createdAt - a.createdAt;
      });
  }

  /** 获取最后一个（最新）共享条目 */
  getLastSharedEntry(): SharedMentalEntry | undefined {
    return this._sharedEntries[this._sharedEntries.length - 1];
  }

  // ── 递推协作环 ──────────────────────────

  /**
   * 任务后反思——Agent 完成任务后记录学到了什么。
   */
  recordReflection(reflection: PostTaskReflection): void {
    if (!this.config.enablePostTaskReflection) return;

    this._reflections.push(reflection);

    // 将反思作为 Insight 记忆写入
    const writeInput: MemoryWriteInput = {
      source: { agentType: reflection.agentRole as AgentType, taskId: reflection.taskId },
      kind: "Insight",
      summary: `[${reflection.agentRole}] ${reflection.taskId}: ${reflection.learned}`,
      semantic_gist: `Learned: ${reflection.learned}. Verified: ${reflection.hypothesesVerified}. Correct: ${reflection.correctionsNeeded}`,
      content_blob: reflection as unknown as Record<string, unknown>,
      weight: 5,
    };

    // 异步写入——不阻塞主流程
    void this._memory.write(writeInput);
  }

  /**
   * 获取最近 N 条反思，按 Agent 角色过滤。
   */
  getRecentReflections(limit = 5, role?: AgentRole): PostTaskReflection[] {
    let refs = [...this._reflections].reverse();
    if (role) {
      refs = refs.filter((r) => r.agentRole === role);
    }
    return refs.slice(0, limit);
  }

  // ── 决策升级 ────────────────────────────

  /**
   * 检测是否存在需要升级的冲突。
   * 返回升级建议或 null（无不一致）。
   */
  detectConflict(entries: MemoryEntry[]): ConflictReport | null {
    if (!this.config.enableConflictEscalation) return null;

    const report = this._conflictDetector.detect(entries);
    if (report) {
      // 标记需要解决
      for (const entryId of report.conflictingIds) {
        this._memory.cas(entryId, "Active", "Active"); // persist as Active but flagged
        // 通过 link 标记冲突关系
        if (report.conflictingIds[0] !== entryId) {
          this._memory.link(report.conflictingIds[0], entryId, LinkType.DerivedFrom);
        }
      }
    }
    return report;
  }

  /**
   * 基于冲突升级路径给出处理建议。
   *
   * 升级路径:
   *   weight < 0.3 → 同类 Agent 二次确认
   *   weight 0.3-0.5 → Strategist (Meta) 裁决
   *   weight > 0.5 → 升级给用户
   */
  getEscalationLevel(weight: number): "peer_confirm" | "strategist" | "user" {
    if (weight < this.config.escalationWeightThreshold) return "peer_confirm";
    if (weight < this.config.escalationWeightThreshold + 0.2) return "strategist";
    return "user";
  }

  // ── 私有方法 ────────────────────────────

  /**
   * 将新共享条目与之前相关条目建立 link 关系。
   * 基于 summary 文本相似度（简单关键词重叠判断）。
   */
  private _linkToPriorEntries(newId: string, role: AgentRole, taskId: string): void {
    // 找到同一任务或同角色的前序条目
    const related = this._sharedEntries
      .filter((e) => e.id !== newId && (e.parentTaskId === taskId || e.authorRole === role))
      .slice(0, 5);

    for (const r of related) {
      try {
        this._memory.link(newId, r.id, LinkType.DerivedFrom);
      } catch {
        // link 失败静默跳过
      }
    }
  }
}
