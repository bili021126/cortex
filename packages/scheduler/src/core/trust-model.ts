// ============================================================
// @cortex/scheduler/core/trust-model —— 信任模型
//
// 按 (AgentType, RiskDomain) 二维聚合接受率。
// 冷启动从 L1 起。连续接受晋升，拒绝重置。7天无活动衰减。
//
// 晋升规则：
//   L1 → L2：连续 5 次接受
//   L2 → L3：连续 15 次接受
//
// 衰减规则（每次查询时检查）：
//   7 天无确认活动 → 降一级，不低于 L1
//
// 拒绝规则：
//   任一拒绝 → 立即重置为 L1
//
// 模型变更：
//   resetAll() → 全部回到 L1
// ============================================================

import { TrustLevel, type AgentType, type ITrustModel, type RiskDomain, type TrustEntry, type TrustScore, toolNameToRiskDomain } from "@cortex/shared";
import * as path from "node:path";
import * as fs from "node:fs/promises";

// ─── 内部常量 ──────────────────────────────────────────

/** L1 → L2 所需连续接受次数 */
const ESCALATE_TO_L2 = 5;
/** L2 → L3 所需连续接受次数 */
const ESCALATE_TO_L3 = 15;
/** 衰减阈值：7 天无确认活动（毫秒） */
const DECAY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// ─── TrustModel 实现 ──────────────────────────────────

export class TrustModel implements ITrustModel {
  /** 二维聚合表：key = `${agentType}:${domain}` */
  private readonly _entries = new Map<string, TrustEntry>();
  private readonly _statePath: string | undefined;

  constructor(statePath?: string) {
    this._statePath = statePath;
  }

  // ── 查询 ──────────────────────────────────────────

  getTrustLevel(agentType: AgentType, domain: RiskDomain): TrustLevel {
    const key = this._key(agentType, domain);
    const entry = this._entries.get(key);

    if (!entry) {
      // 冷启动：首次访问，初始化 L1
      this._entries.set(key, this._freshEntry(agentType, domain));
      return TrustLevel.L1;
    }

    // 检查衰减
    this._applyDecay(entry);

    return entry.level;
  }

  getTrustLevelForTool(agentType: AgentType, toolName: string): TrustLevel {
    const domain = toolNameToRiskDomain(toolName);
    if (!domain) return TrustLevel.L1; // 未知工具，冷启动
    return this.getTrustLevel(agentType, domain);
  }

  // ── 决策记录 ──────────────────────────────────────

  recordDecision(agentType: AgentType, toolName: string, approved: boolean): void {
    const domain = toolNameToRiskDomain(toolName);
    if (!domain) return; // 只记录已知风险域

    const key = this._key(agentType, domain);
    let entry = this._entries.get(key);

    if (!entry) {
      entry = this._freshEntry(agentType, domain);
    } else {
      this._applyDecay(entry);
    }

    const now = Date.now();

    if (approved) {
      entry.consecutiveAccepts += 1;
      entry.totalConfirmations += 1;
      entry.lastAcceptedAt = now;

      // 晋升判定
      if (entry.level === TrustLevel.L1 && entry.consecutiveAccepts >= ESCALATE_TO_L2) {
        entry.level = TrustLevel.L2;
      }
      if (entry.level === TrustLevel.L2 && entry.consecutiveAccepts >= ESCALATE_TO_L3) {
        entry.level = TrustLevel.L3;
      }
    } else {
      // 拒绝：重置
      entry.level = TrustLevel.L1;
      entry.consecutiveAccepts = 0;
      entry.totalConfirmations += 1;
    }

    entry.updatedAt = now;
    this._entries.set(key, entry);

    // 持久化——不阻塞决策逻辑
    this.save().catch(() => { /* 持久化失败不抛出 */ });
  }

  // ── 全局操作 ──────────────────────────────────────

  // ── 持久化 ──────────────────────────────────────

  /** 持久化路径，undefined 表示不持久化 */
  get statePath(): string | undefined {
    return this._statePath;
  }

  /**
   * 将信任状态写入 JSON 文件。
   * 仅当构造时传入了 statePath 时才执行写入。
   */
  async save(): Promise<void> {
    if (!this._statePath) return;
    const data = JSON.stringify([...this._entries.entries()]);
    await fs.mkdir(path.dirname(this._statePath), { recursive: true });
    await fs.writeFile(this._statePath, data, "utf-8");
  }

  /**
   * 从 JSON 文件加载信任状态。
   * 首次启动无文件时不报错（静默回退）。
   */
  async load(): Promise<void> {
    if (!this._statePath) return;
    try {
      const data = await fs.readFile(this._statePath, "utf-8");
      const parsed: [string, TrustEntry][] = JSON.parse(data);
      this._entries.clear();
      for (const [key, entry] of parsed) {
        this._entries.set(key, entry);
      }
    } catch {
      console.error(`[scheduler] trust_model.load_failed_first_start`);
      // 首次启动无文件，静默忽略
    }
  }

  resetAll(): void {
    this._entries.clear();
  }

  snapshot(): ReadonlyMap<string, TrustEntry> {
    return new Map(this._entries);
  }

  // ── 置信度评分 ──────────────────────────────────

  /**
   * 计算 (agentType, domain) 的置信度评分 (0..1)。
   *
   * 评分公式：
   *   baseScore = level / 3  （L0=0, L1≈0.33, L2≈0.67, L3=1.0）
   *   decayFactor = 1 - min(1, elapsedDays / 7) * 0.3  （7天无活动扣30%）
   *   historyBonus = min(0.2, totalConfirmations * 0.01)  （最多加0.2）
   *   score = clamp(baseScore * decayFactor + historyBonus, 0, 1)
   *
   * 设计意图：
   * - 信任不是二值的——即使 L3 也可能因长期无活动而衰减
   * - 历史确认数提供平滑的置信度基底，避免少量样本过度拟合
   * - score 可用于排序、仪表盘展示、自动决策阈值判断
   */
  computeConfidence(agentType: AgentType, domain: RiskDomain): TrustScore {
    const key = this._key(agentType, domain);
    const entry = this._entries.get(key);

    if (!entry) {
      return { agentType, domain, score: 0.1, historyCount: 0 };
    }

    // 先应用衰减（同步状态）
    this._applyDecay(entry);

    const baseScore = entry.level / 3; // L0=0, L1=0.333, L2=0.667, L3=1.0

    // 时间衰减：距上次接受的天数
    const elapsedDays = entry.lastAcceptedAt > 0
      ? (Date.now() - entry.lastAcceptedAt) / (24 * 60 * 60 * 1000)
      : 0;
    const decayFactor = 1 - Math.min(1, elapsedDays / 7) * 0.3;

    // 历史确认奖励
    const historyBonus = Math.min(0.2, entry.totalConfirmations * 0.01);

    const score = Math.max(0, Math.min(1, baseScore * decayFactor + historyBonus));

    return {
      agentType,
      domain,
      score,
      historyCount: entry.totalConfirmations,
    };
  }

  /**
   * 按工具名计算置信度（便捷方法）。
   */
  computeConfidenceForTool(agentType: AgentType, toolName: string): TrustScore {
    const domain = toolNameToRiskDomain(toolName);
    if (!domain) {
      return { agentType, domain: "file_write", score: 0.1, historyCount: 0 };
    }
    return this.computeConfidence(agentType, domain);
  }

  /**
   * 获取所有 (agentType, domain) 的置信度评分列表。
   * 用于仪表盘展示和自动决策审计。
   */
  allConfidences(): TrustScore[] {
    const results: TrustScore[] = [];
    for (const [, entry] of this._entries) {
      results.push(
        this.computeConfidence(entry.agentType, entry.domain)
      );
    }
    return results.sort((a, b) => b.score - a.score);
  }

  // ── 内部 ──────────────────────────────────────────

  private _key(agentType: AgentType, domain: RiskDomain): string {
    return `${agentType}:${domain}`;
  }

  private _freshEntry(agentType: AgentType, domain: RiskDomain): TrustEntry {
    const now = Date.now();
    return {
      agentType,
      domain,
      level: TrustLevel.L1,
      consecutiveAccepts: 0,
      totalConfirmations: 0,
      lastAcceptedAt: 0,
      updatedAt: now,
    };
  }

  /**
   * 衰减检查——距离上次接受超过 7 天则降级。
   * 不低于 L1（冷启动基准）。
   */
  private _applyDecay(entry: TrustEntry): void {
    if (entry.lastAcceptedAt === 0) return; // 从未被接受过，不衰减
    if (entry.level <= TrustLevel.L1) return; // 已是最低

    const elapsed = Date.now() - entry.lastAcceptedAt;
    if (elapsed > DECAY_THRESHOLD_MS) {
      // 降级：逐级回落
      const steps = Math.floor(elapsed / DECAY_THRESHOLD_MS);
      const newLevel = Math.max(TrustLevel.L1, entry.level - steps);
      if (newLevel !== entry.level) {
        entry.level = newLevel;
        entry.consecutiveAccepts = 0; // 衰减打断连续接受链
        entry.updatedAt = Date.now();
      }
    }
  }
}
