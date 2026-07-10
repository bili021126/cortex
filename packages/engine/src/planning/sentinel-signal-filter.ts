// ============================================================
// @cortex/engine/planning/sentinel-signal-filter —— 哨兵信号分层过滤器
//
// @layer 治理层
// @role 观察者——过滤+分层，不执行业务操作
//
// 职责：
//   将 PipelineObserver 的事件流按严重程度分层（L1/L2/L3），
//   供哨兵/监控系统按需订阅，避免信息过载。
//
// 信号层级：
//   L1 (Critical) — 立即行动：系统崩溃、安全违规、数据损坏
//   L2 (Warning)  — 需要关注：性能降级、重试风暴、配额耗尽
//   L3 (Info)     — 仅记录：正常事件、遥测数据、状态变更
//
// 设计原则：
//   1. 过滤而非丢弃——L1/L2 必须处理，L3 可采样/聚合
//   2. 去噪——同类事件在时间窗口内聚合，避免告警风暴
//   3. 可配置——层级阈值、去噪窗口、采样率均可调
// ============================================================

import { PipelineEventType, type ObservableEvent, type PipelineHandler } from "@cortex/shared";
import { ZeroTokenValidator } from "../execution/zero-token-validator.js";

/**
 * 信号层级——事件的严重程度分类。
 */
export type SignalLevel = "L1" | "L2" | "L3";

/**
 * 过滤后的信号——附带层级标注和处理建议。
 */
export interface FilteredSignal {
  /** 原始事件 */
  event: ObservableEvent;
  /** 信号层级 */
  level: SignalLevel;
  /** 是否需要立即处理 */
  requiresImmediateAction: boolean;
  /** 聚合键——用于去噪（同类事件合并） */
  aggregationKey: string;
  /** 建议的处理动作 */
  suggestedAction: "alert" | "log" | "sample" | "ignore";
  /** 信号来源——规则验证通过后为 "rule"，否则为 "llm-inference" */
  source: "rule" | "llm-inference";
}

/**
 * 哨兵信号过滤器配置。
 */
export interface SignalFilterOptions {
  /** L1 事件类型列表——匹配这些类型的事件视为 L1 */
  l1EventTypes?: PipelineEventType[];
  /** L2 事件类型列表——匹配这些类型的事件视为 L2 */
  l2EventTypes?: PipelineEventType[];
  /** 去噪时间窗口 (ms)——同类事件在此窗口内聚合，默认 5000 */
  deduplicationWindowMs?: number;
  /** L3 采样率 (0-1)——L3 事件按比例记录，默认 0.1 (10%) */
  l3SampleRate?: number;
  /** 告警风暴阈值——同 aggregationKey 在窗口内超过此数量触发风暴告警，默认 10 */
  alertStormThreshold?: number;
}

/**
 * 哨兵信号分层过滤器——将事件流按 L1/L2/L3 分层，供哨兵订阅。
 *
 * 典型用法：
 *   ```typescript
 *   const filter = new SentinelSignalFilter({
 *     l1EventTypes: [PipelineEventType.SchedulerCrashed, PipelineEventType.SecurityViolation],
 *     l2EventTypes: [PipelineEventType.ErrorReported, PipelineEventType.PoolQuotaExhausted],
 *   });
 *
 *   observer.on(PipelinePriority.CRITICAL, (event) => {
 *     const signal = filter.filter(event);
 *     if (signal.level === "L1") {
 *       alertPagerDuty(signal);
 *     }
 *   });
 *   ```
 */
export class SentinelSignalFilter {
  private readonly config: Required<SignalFilterOptions>;
  private readonly validator: ZeroTokenValidator;

  /** 去噪缓存：aggregationKey → { count, firstSeenAt, lastSeenAt } */
  private readonly dedupCache = new Map<string, { count: number; firstSeenAt: number; lastSeenAt: number }>();

  constructor(options: SignalFilterOptions = {}) {
    this.validator = new ZeroTokenValidator();
    this.config = {
      l1EventTypes: options.l1EventTypes ?? [
        PipelineEventType.SchedulerLoopCrashed,
        PipelineEventType.ErrorReported, // severity=fatal
      ],
      l2EventTypes: options.l2EventTypes ?? [
        PipelineEventType.ErrorSilentUpgraded,
        PipelineEventType.AgentPoolInvariantViolation,
        PipelineEventType.TaskBoardInvariantViolation,
      ],
      deduplicationWindowMs: 5000,
      l3SampleRate: 0.1,
      alertStormThreshold: 10,
      ...options,
    };
  }

  /**
   * 过滤事件——产出分层信号。
   *
   * 逻辑：
   *   1. 匹配 l1EventTypes → L1 (requiresImmediateAction=true)
   *   2. 匹配 l2EventTypes → L2 (requiresImmediateAction=false)
   *   3. 其他 → L3 (采样/聚合)
   *
   * 去噪：同类事件在时间窗口内聚合，返回聚合后的信号。
   * 采样：L3 事件按 l3SampleRate 比例返回，其余返回 null。
   */
  filter(event: ObservableEvent): FilteredSignal | null {
    const now = Date.now();
    this._cleanupExpiredEntries(now);

    // 1. 确定层级
    let level: SignalLevel;
    if (this.config.l1EventTypes.includes(event.type)) {
      level = "L1";
    } else if (this.config.l2EventTypes.includes(event.type)) {
      level = "L2";
    } else {
      level = "L3";
    }

    // 2. 生成聚合键
    const aggregationKey = this._generateAggregationKey(event);

    // 3. 去噪检查
    const dedupEntry = this.dedupCache.get(aggregationKey);
    if (dedupEntry && (now - dedupEntry.lastSeenAt) < this.config.deduplicationWindowMs) {
      dedupEntry.count++;
      dedupEntry.lastSeenAt = now;

      // 告警风暴检测
      if (dedupEntry.count === this.config.alertStormThreshold) {
        return {
          event,
          level: "L1",
          requiresImmediateAction: true,
          aggregationKey,
          suggestedAction: "alert",
          source: this._resolveSource(event),
        };
      }

      // 窗口内重复事件——抑制（除非是 L1）
      if (level !== "L1") {
        return null;
      }
    } else {
      // 新事件或窗口过期——记录
      this.dedupCache.set(aggregationKey, { count: 1, firstSeenAt: now, lastSeenAt: now });
    }

    // 4. L3 采样
    if (level === "L3" && Math.random() > this.config.l3SampleRate) {
      return null;
    }

    // 5. 构建信号
    return {
      event,
      level,
      requiresImmediateAction: level === "L1",
      aggregationKey,
      suggestedAction: level === "L1" ? "alert" : (level === "L2" ? "log" : "sample"),
      source: this._resolveSource(event),
    };
  }

  /**
   * 创建 PipelineHandler——可直接注册到 observer。
   * 过滤后的信号通过回调传出。
   */
  createHandler(onSignal: (signal: FilteredSignal) => void): PipelineHandler {
    return (event: ObservableEvent) => {
      const signal = this.filter(event);
      if (signal) {
        onSignal(signal);
      }
    };
  }

  /**
   * 获取去噪统计——用于可观测性。
   */
  getStats(): { cacheSize: number; topKeys: Array<{ key: string; count: number }> } {
    const entries = [...this.dedupCache.entries()]
      .map(([key, val]) => ({ key, count: val.count }))
      .sort((a, b) => b.count - a.count);
    return {
      cacheSize: this.dedupCache.size,
      topKeys: entries.slice(0, 10),
    };
  }

  /**
   * 清理过期缓存条目。
   */
  private _cleanupExpiredEntries(now: number): void {
    for (const [key, entry] of this.dedupCache.entries()) {
      if ((now - entry.lastSeenAt) > this.config.deduplicationWindowMs * 2) {
        this.dedupCache.delete(key);
      }
    }
  }

  /**
   * 生成聚合键——用于去噪。
   * 同类事件（相同 type + 关键 payload 字段）共享聚合键。
   */
  private _generateAggregationKey(event: ObservableEvent): string {
    const payload = event.payload as Record<string, unknown> | undefined;
    const source = payload?.source ?? "unknown";
    const errorType = payload?.error ?? "";
    return `${event.type}:${source}:${String(errorType).slice(0, 50)}`;
  }

  /** 治理事件走零 token 规则验证，其余事件默认 rule */
  private _resolveSource(event: ObservableEvent): "rule" | "llm-inference" {
    const govTypes = [
      PipelineEventType.ConstitutionViolation,
      PipelineEventType.GovernanceAmendmentProposed,
      PipelineEventType.GovernanceAuditReport,
      PipelineEventType.GovernanceComplianceViolation,
      PipelineEventType.GovernanceRoundtableConsensus,
    ];
    if (govTypes.includes(event.type)) {
      const result = this.validator.validate(event, { workspaceRoot: process.cwd() });
      return result.source;
    }
    return "rule";
  }
}