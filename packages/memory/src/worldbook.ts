// ============================================================
// @cortex/memory — DMAE Worldbook → 世界知识图谱
//
// 层进化：世界模型仿真层（v2）→ 世界知识图谱（v3）。
// 原 Worldbook 仅管理条目的激活/休眠/归档——是被动仿真。
// 知识图谱在此基础上引入：
//   - 实体（Entity）：带类型的知识节点，不只是 persona 片段
//   - 关系（Relation）：实体间有向边，支持图遍历
//   - 图查询：通过 MemoryStore BFS 在图谱中推理关联
//
// DMAE 状态机保留——管理实体在 Prompt 中的可见性。
// 图结构由 MemoryStore 的 link/bfs 能力承载。
// ============================================================

// ─── 世界书条目 ──────────────────────────────────────

export interface WorldbookEntry {
  id: string;
  keywords: string[];
  content: string;
  priority: number;
  intrinsicValue: number;
  linkTriggers: string[];
  permanent: boolean;
}

// ─── 世界知识图谱 v3 ────────────────────────────

/** 知识实体类型——图谱中的节点分类 */
export type KnowledgeEntityType =
  | "persona"         // 角色/人格片段
  | "concept"         // 抽象概念
  | "event"           // 事件节点
  | "location"        // 地点
  | "artifact"         // 人造物/项目/代码库
  | "rule"             // 规则/约束
  | "memory"           // 记忆条目（关联 MemoryEntry）
  | "agent";           // Agent 实例

/** 知识图谱节点——Worldbook 的实体化扩展 */
export interface KnowledgeEntity {
  id: string;
  type: KnowledgeEntityType;
  labels: string[];          // 多标签
  properties: Record<string, unknown>; // 自由属性
  entry?: WorldbookEntry;    // 向后兼容——原 Worldbook 条目
  memoryId?: string;         // 关联的 MemoryEntry.id
}

/** 关系类型——实体间的有向边 */
export type RelationType =
  | "contains"        // A 包含 B
  | "references"      // A 引用 B
  | "depends_on"      // A 依赖 B
  | "causes"          // A 导致 B
  | "contradicts"     // A 与 B 矛盾
  | "evolves_from"    // A 从 B 演化
  | "same_as"         // A 等价于 B（owl:sameAs）
  | "instance_of";    // A 是 B 的实例

/** 知识图谱边 */
export interface KnowledgeRelation {
  id: string;
  type: RelationType;
  sourceId: string;          // 源实体 ID
  targetId: string;          // 目标实体 ID
  weight: number;            // 0..1 关系强度
  confidence: number;        // 0..1 置信度
  provenance?: string;       // 来源（LLM推断/人工/代码分析）
  createdAt: number;
}

// ─── 条目激活状态 ────────────────────────────────────

export interface EntryState {
  activation: number;     // 0..100
  userSilence: number;
  modelSilence: number;
}

// ─── DMAE 状态机 ─────────────────────────────────────

export type DmaeState = "Active" | "Dormant" | "Archived";

// ─── DMAE 参数 ───────────────────────────────────────

export interface DmaeParams {
  maxScore: number;            // 100
  promptThreshold: number;     // ≥ 此值进 Prompt
  userRewardBase: number;      // Bu = 20
  wakeGamma: number;           // γ = 0.5
  modelRewardBase: number;     // Bm = 8
  wakeLambda: number;          // λ = 0.3
  decayAlpha: number;          // α = 1.5
  decayBeta: number;           // β = 0.3
}

export const DEFAULT_DMAE_PARAMS: DmaeParams = {
  maxScore: 100,
  promptThreshold: 30,
  userRewardBase: 20,
  wakeGamma: 0.5,
  modelRewardBase: 8,
  wakeLambda: 0.3,
  decayAlpha: 1.5,
  decayBeta: 0.3,
};

// ─── WorldbookEngine ──────────────────────────────────

export class WorldbookEngine {
  // @deprecated 2026-07 — 全量图景审计确认：WorldbookManager 从未实例化，
  // initRAG 传入 worldbookDir="none"，所有 accessor 零调用。
  // 知识图谱类型（KnowledgeEntity/KnowledgeRelation）保留供未来集成。
  private entries = new Map<string, WorldbookEntry>();
  private states = new Map<string, EntryState>();
  private params: DmaeParams;

  constructor(params?: Partial<DmaeParams>) {
    this.params = { ...DEFAULT_DMAE_PARAMS, ...params };
  }

  /** 注册一条世界书条目 */
  register(entry: WorldbookEntry): void {
    this.entries.set(entry.id, entry);
    this.states.set(entry.id, {
      activation: 0,
      userSilence: 0,
      modelSilence: 0,
    });
  }

  /** 注销一条世界书条目 */
  unregister(id: string): void {
    this.entries.delete(id);
    this.states.delete(id);
  }

  /** 用户命中关键词时调用 */
  onUserHit(id: string): void {
    const state = this.states.get(id);
    const entry = this.entries.get(id);
    if (!state || !entry) return;

    // Ru = Bu × (1 + γ · ln(1 + U_old))
    const { userRewardBase: Bu, wakeGamma: γ } = this.params;
    const reward = Bu * (1 + γ * Math.log(1 + state.userSilence));
    state.activation = Math.min(this.params.maxScore, state.activation + reward);
    state.userSilence = 0;
    state.modelSilence = 0;
  }

  /** 模型命中关键词时调用 */
  onModelHit(id: string): void {
    const state = this.states.get(id);
    const entry = this.entries.get(id);
    if (!state || !entry) return;

    // Rm = Bm × (1 + λ · ln(1 + M_old))
    const { modelRewardBase: Bm, wakeLambda: λ } = this.params;
    const reward = Bm * (1 + λ * Math.log(1 + state.modelSilence));
    state.activation = Math.min(this.params.maxScore, state.activation + reward);
    state.userSilence = 0;
    state.modelSilence = 0;
  }

  /** 用户无关键词命中时调用——衰减 */
  onUserMiss(): void {
    for (const [id, state] of this.states) {
      state.userSilence++;
      state.modelSilence++;

      // D = α · ln(1 + β · misses)
      // 使用 userSilence 作为失配计数
      const { decayAlpha: α, decayBeta: β } = this.params;
      const decay = α * Math.log(1 + β * state.userSilence);
      state.activation = Math.max(0, state.activation - decay);
    }
  }

  /** 模型无关键词命中时调用——衰减 */
  onModelMiss(): void {
    for (const [id, state] of this.states) {
      state.modelSilence++;
    }
  }

  /** 获取活跃条目（activation ≥ promptThreshold），按 activation 降序 */
  getActiveEntries(): WorldbookEntry[] {
    const active: Array<{ entry: WorldbookEntry; activation: number }> = [];
    for (const [id, state] of this.states) {
      if (state.activation >= this.params.promptThreshold) {
        const entry = this.entries.get(id);
        if (entry) {
          active.push({ entry, activation: state.activation });
        }
      }
    }
    return active
      .sort((a, b) => b.activation - a.activation)
      .map(a => a.entry);
  }

  /** 获取全部条目的状态快照（诊断用） */
  getStateSnapshot(): Map<string, EntryState> {
    return new Map(this.states);
  }

  /** 获取指定条目的 DMAE 状态机状态 */
  getDmaeState(id: string): DmaeState {
    const state = this.states.get(id);
    if (!state) return "Archived";
    if (state.activation >= this.params.promptThreshold) return "Active";
    if (state.activation > 0) return "Dormant";
    return "Archived";
  }

  /** 获取当前参数 */
  getParams(): Readonly<DmaeParams> {
    return this.params;
  }

  // ─── 知识图谱桥接（v3 新增）──────────────────

  /** 将全部已注册条目转为知识实体集合 */
  toKnowledgeEntities(): KnowledgeEntity[] {
    const entities: KnowledgeEntity[] = [];
    for (const [id, entry] of this.entries) {
      const state = this.states.get(id);
      entities.push({
        id,
        type: entry.permanent ? "persona" : "concept",
        labels: entry.keywords,
        properties: {
          activation: state?.activation ?? 0,
          dmaeState: this.getDmaeState(id),
          priority: entry.priority,
          permanent: entry.permanent,
        },
        entry,
      });
    }
    return entities;
  }

  /** 为两个已注册实体建立关系 */
  createRelation(
    sourceId: string,
    targetId: string,
    type: RelationType,
    options?: { weight?: number; confidence?: number; provenance?: string },
  ): KnowledgeRelation | null {
    if (!this.entries.has(sourceId) || !this.entries.has(targetId)) return null;
    return {
      id: `rel-${sourceId}-${targetId}-${type}`,
      type,
      sourceId,
      targetId,
      weight: options?.weight ?? 0.5,
      confidence: options?.confidence ?? 0.5,
      provenance: options?.provenance,
      createdAt: Date.now(),
    };
  }
}
