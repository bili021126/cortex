// ============================================================
// @cortex/memory — DMAE Worldbook 激活引擎
//
// Cortex 没有世界书概念——此为新建。以 prompts/ 下的 persona 文件
// 作为 worldbook entries，通过 DMAE 状态机管理激活周期。
//
// DMAE 状态:
//   Active   — activation >= promptThreshold，进 Prompt
//   Dormant  — activation < promptThreshold，休眠
//   Archived — 用户/模型沉默过长，进入归档
//
// 激活公式（用户命中关键词时触发）:
//   Ru = Bu × (1 + γ · ln(1 + U_old))
//   其中 Bu=20, γ=0.5, U_old=userSilence 回合数
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
}
