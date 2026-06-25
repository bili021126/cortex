// ============================================================
// @cortex/telemetry/src/health-collector —— 降级健康聚合采集器
//
// 提供统一的健康聚合——统计各模块降级频率、降级等级分布、
// 系统整体健康状态。
//
// @see DegradationBoundary（engine）—— 上游插桩点
// ============================================================

/** 健康快照——降级聚合的瞬时视图 */
export interface HealthSnapshot {
  /** 快照生成时间戳（Unix 毫秒） */
  readonly timestamp: number;
  /** 累计降级总数 */
  readonly totalDegradations: number;
  /** 按模块（source）统计降级次数 */
  readonly bySource: Record<string, number>;
  /** 按等级（silent/trace/escalate）统计分布 */
  readonly byLevel: Record<string, number>;
  /** 最近 10 个降级源（去重） */
  readonly recentSources: string[];
  /** 首次降级时间戳，未发生降级时为 null */
  readonly degradedSince: number | null;
}

/**
 * HealthCollector —— 降级健康聚合采集器。
 *
 * 收集所有通过 DegradationBoundary.handle() 记录的降级事件，
 * 提供按模块、按等级的统计快照。
 *
 * @remarks 内部维护一个定长环形队列（maxEntries=1000），
 *          快照仅统计最近 100 条降级事件以反映近期健康状态。
 */
export class HealthCollector {
  private degradations: Array<{ source: string; level: string; timestamp: number }> = [];
  private maxEntries = 1000;

  /**
   * 记录一条降级事件。
   * @param source 降级来源标识（如 'memory-pipeline-cleanup'）
   * @param level  降级等级
   */
  record(source: string, level: string): void {
    this.degradations.push({ source, level, timestamp: Date.now() });
    if (this.degradations.length > this.maxEntries) {
      this.degradations = this.degradations.slice(-this.maxEntries);
    }
  }

  /**
   * 生成当前健康快照。
   * @returns 包含统计数据的 HealthSnapshot
   */
  snapshot(): HealthSnapshot {
    const recent = this.degradations.slice(-100);
    const bySource: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    for (const d of recent) {
      bySource[d.source] = (bySource[d.source] || 0) + 1;
      byLevel[d.level] = (byLevel[d.level] || 0) + 1;
    }
    return {
      timestamp: Date.now(),
      totalDegradations: this.degradations.length,
      bySource,
      byLevel,
      recentSources: [...new Set(recent.map(d => d.source))].slice(0, 10),
      degradedSince: this.degradations[0]?.timestamp ?? null,
    };
  }

  /** 重置所有降级记录 */
  reset(): void {
    this.degradations = [];
  }
}
