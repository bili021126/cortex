// ============================================================
// @cortex/engine/memory/weight-ager —— 权重老化服务
//
// @since v3.1.0
// @layer 引擎层 — 纯计算，不操作存储
//
// 职责：
//   1. decayWeights() — 按时间衰减记忆权重（每7天未访问衰减5%）
//   2. freezeStale()  — 识别可归档的低权重过期记忆
//   3. obliterateFrozen() — 识别可湮灭的长期归档记忆
//
// 从 memory-store.ts 拆分，遵循单一职责原则。
// ============================================================

import type { MemoryEntry } from "@cortex/shared";
import {
  WEIGHT_AGING_FACTOR,
  MAINTENANCE_WEIGHT_THRESHOLD,
  STALE_FREEZE_DAYS,
  FROZEN_OBLITERATE_DAYS,
} from "./schema.js";

/** 可归档条目（低权重 + 过期未访问） */
export interface FreezeCandidate {
  id: string;
  weight: number;
  lastAccessedAt: number;
}

/** 可湮灭条目（长期归档） */
export interface ObliterateCandidate {
  id: string;
  lastAccessedAt: number;
  expiresAt: number;
}

/**
 * WeightAger —— 权重老化纯计算服务。
 *
 * 不持有状态，不操作存储层，仅对传入的条目执行权重衰减计算。
 */
export class WeightAger {
  private readonly agingFactor: number;
  private readonly freezeDays: number;
  private readonly obliterateDays: number;
  private readonly weightThreshold: number;

  constructor(
    agingFactor: number = WEIGHT_AGING_FACTOR,
    freezeDays: number = STALE_FREEZE_DAYS,
    obliterateDays: number = FROZEN_OBLITERATE_DAYS,
    weightThreshold: number = MAINTENANCE_WEIGHT_THRESHOLD,
  ) {
    this.agingFactor = agingFactor;
    this.freezeDays = freezeDays;
    this.obliterateDays = obliterateDays;
    this.weightThreshold = weightThreshold;
  }

  /**
   * 对记忆条目执行权重自然老化。
   * 每 7 天未访问衰减 agingFactor 倍（默认 0.95）。
   *
   * @param entries 待老化的记忆条目
   * @param now 当前时间戳（便于测试注入）
   * @returns 权重已衰减的条目副本（原始条目不变）
   */
  decayWeights(entries: MemoryEntry[], now: number = Date.now()): MemoryEntry[] {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    return entries.map((m) => {
      const daysSinceAccess = (now - m.lastAccessedAt) / MS_PER_DAY;
      if (daysSinceAccess <= 0) return m;
      const aged = m.weight * Math.pow(this.agingFactor, daysSinceAccess / 7);
      if (Math.abs(aged - m.weight) > 0.0001) {
        return { ...m, weight: aged };
      }
      return m;
    });
  }

  /**
   * 识别可归档的过期低权重 Active 记忆。
   *
   * @param entries 全量条目
   * @param now 当前时间戳
   * @returns 可归档候选列表
   */
  freezeStale(entries: MemoryEntry[], now: number = Date.now()): FreezeCandidate[] {
    const freezeThreshold = now - this.freezeDays * 24 * 60 * 60 * 1000;
    const candidates: FreezeCandidate[] = [];
    for (const m of entries) {
      if (m.semantic_state !== "Active") continue;
      if (m.lastAccessedAt > freezeThreshold) continue;
      if (m.weight >= this.weightThreshold) continue;
      candidates.push({
        id: m.id,
        weight: m.weight,
        lastAccessedAt: m.lastAccessedAt,
      });
    }
    return candidates;
  }

  /**
   * 识别可湮灭的长期 Archived 记忆。
   *
   * @param entries 全量条目
   * @param now 当前时间戳
   * @returns 可湮灭候选列表
   */
  obliterateFrozen(entries: MemoryEntry[], now: number = Date.now()): ObliterateCandidate[] {
    const obliterateThreshold = now - this.obliterateDays * 24 * 60 * 60 * 1000;
    const candidates: ObliterateCandidate[] = [];
    for (const m of entries) {
      if (m.semantic_state !== "Archived") continue;
      // R12-C2：过期语义修正——最近访问过（未超湮灭阈值）保留；设置了未来 expires_at 的未到期条目保留
      // （此前条件反了：expires_at ≠ 0 即进湮灭候选——"保留 90 天"的未来过期记忆被立即湮灭）
      if (m.lastAccessedAt > obliterateThreshold) continue;
      if (m.expires_at && m.expires_at > now) continue;
      candidates.push({
        id: m.id,
        lastAccessedAt: m.lastAccessedAt,
        expiresAt: m.expires_at ?? 0,
      });
    }
    return candidates;
  }
}
