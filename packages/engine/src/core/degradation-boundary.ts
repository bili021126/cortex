// ============================================================
// @cortex/engine/src/core/degradation-boundary —— 降级边界工具类
//
// 替代空 catch 的标准化降级处理：
// - silent:  完全静默（不输出任何日志）
// - trace:   observer.emit(InfraComponentDegraded, HIGH)（默认）
// - escalate: observer.emit(InfraComponentDegraded, CRITICAL)
//
// @see docs/core/telemetry-infrastructure-deepening.md §2.4
// @fix G1-1 — 裸 console → PipelineObserver.emit
// ============================================================

import type { HealthCollector } from "@cortex/telemetry";
import { PipelineEventType, PipelinePriority, type IPipelineObserver } from "@cortex/shared";

/** 降级等级 */
export type DegradationLevel = 'silent' | 'trace' | 'escalate';

/**
 * 降级边界静态工具类。
 * 统一处理非致命异常，通过 PipelineObserver 纳入可观测管道。
 */
export class DegradationBoundary {
  /**
   * 健康聚合采集器引用——由 bootstrap 注入。
   * 所有非 silent 路径的降级事件会自动记录至此。
   */
  static collector?: HealthCollector;

  /**
   * PipelineObserver 引用——由 bootstrap 在 observer 就绪后注入。
   * @fix G1-1 — 替代裸 console.error/warn
   */
  static _observer?: IPipelineObserver;

  /**
   * 处理降级事件。
   *
   * @param error  原始异常
   * @param source 降级来源标识（如 'memory-pipeline-cleanup'）
   * @param level  降级等级——'silent' 什么都不做，'trace' 走 observer HIGH，'escalate' 走 observer CRITICAL
   */
  static handle(
    error: unknown,
    source: string,
    level: DegradationLevel = 'trace'
  ): void {
    if (level === 'silent') return;

    // 记录到健康聚合器
    DegradationBoundary.collector?.record(source, level);

    const msg = `[DEGRADED:${source}] ${error instanceof Error ? error.message : String(error)}`;

    // 通过 PipelineObserver 发射（G1-1：替代裸 console.error/warn）
    if (DegradationBoundary._observer) {
      DegradationBoundary._observer.emit({
        type: PipelineEventType.InfraComponentDegraded,
        priority: level === 'escalate' ? PipelinePriority.CRITICAL : PipelinePriority.HIGH,
        payload: { source, message: msg, level },
        timestamp: Date.now(),
        notificationType: level === 'escalate' ? "WARNING" : "FYI",
      });
    }
  }
}
