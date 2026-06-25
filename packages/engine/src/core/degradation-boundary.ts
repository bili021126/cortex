// ============================================================
// @cortex/engine/src/core/degradation-boundary —— 降级边界工具类
//
// 替代空 catch 的标准化降级处理：
// - silent:  完全静默（不输出任何日志）
// - trace:   console.warn + 降级来源标记（默认）
// - escalate: console.error（Phase 5 基础版，后续接 MetricCounter）
//
// @see docs/core/telemetry-infrastructure-deepening.md §2.4
// ============================================================

/** 降级等级 */
export type DegradationLevel = 'silent' | 'trace' | 'escalate';

/**
 * 降级边界静态工具类。
 * 统一处理非致命异常，为遥测留插桩点。
 */
export class DegradationBoundary {
  /**
   * 处理降级事件。
   *
   * @param error  原始异常
   * @param source 降级来源标识（如 'memory-pipeline-cleanup'）
   * @param level  降级等级——'silent' 什么都不做，'trace' 写 warn，'escalate' 写 error
   */
  static handle(
    error: unknown,
    source: string,
    level: DegradationLevel = 'trace'
  ): void {
    if (level === 'silent') return;

    const msg = `[DEGRADED:${source}] ${error instanceof Error ? error.message : String(error)}`;

    if (level === 'escalate') {
      // Phase 5 基础版，后续接 MetricCounter.incrementDegradation()
      console.error(msg);
    } else {
      console.warn(msg);
    }
  }
}
