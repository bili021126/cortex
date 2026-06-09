// ============================================================
// @cortex/engine/core/trust-model —— 信任模型
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
//
// @since Core-2 — 信任模型落地
// ============================================================

import { TrustLevel, type AgentType, type ITrustModel, type RiskDomain, type TrustEntry, toolNameToRiskDomain } from "@cortex/shared";

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
  }

  // ── 全局操作 ──────────────────────────────────────

  resetAll(): void {
    this._entries.clear();
  }

  snapshot(): ReadonlyMap<string, TrustEntry> {
    return new Map(this._entries);
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
