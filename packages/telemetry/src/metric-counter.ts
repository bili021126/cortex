// ============================================================
// @cortex/telemetry — MetricCounter 内存遥测计数器
//
// 纯内存计数，不写磁盘。
// 定期 flush 回调触发阈值检查与事件发射。
// ============================================================

/** Tele:DegradationThresholdBreached 的默认阈值 */
export const SILENT_THRESHOLD = 100;

export class MetricCounter {
  private counters = new Map<string, number>();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private _stopped = false;

  // ── 计数 ──────────────────────────────────

  /**
   * silent 降级 +1。
   */
  incrementDegradation(source: string): void {
    const current = this.counters.get(source) ?? 0;
    this.counters.set(source, current + 1);
  }

  /**
   * 查询指定 source 的降级计数。
   */
  getDegradationCount(source: string): number {
    return this.counters.get(source) ?? 0;
  }

  /**
   * 获取当前所有计数器的快照。
   */
  getAllCounters(): ReadonlyMap<string, number> {
    return new Map(this.counters);
  }

  // ── 周期 flush ────────────────────────────

  /**
   * 启动定期 flush。
   * @param intervalMs 间隔毫秒
   * @param onFlush 每次 flush 触发时的回调。接收 source 与 count 的快照数组。
   *                回调内部应判断是否超阈值并 emit Tele:DegradationThresholdBreached。
   */
  startPeriodicFlush(
    intervalMs: number,
    onFlush: (snapshots: Array<{ source: string; count: number }>) => void,
  ): void {
    if (this.intervalId !== null) return;

    this.intervalId = setInterval(() => {
      if (this._stopped) return;
      const snapshots: Array<{ source: string; count: number }> = [];
      for (const [source, count] of this.counters) {
        snapshots.push({ source, count });
      }
      if (snapshots.length > 0) {
        onFlush(snapshots);
      }
    }, intervalMs);

    // 允许进程退出时不需要手动 clear
    if (this.intervalId && typeof this.intervalId === "object" && "unref" in this.intervalId) {
      this.intervalId.unref();
    }
  }

  /**
   * 停止定期 flush。
   */
  stop(): void {
    this._stopped = true;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * 重置指定 source 的计数器。
   */
  reset(source: string): void {
    this.counters.delete(source);
  }

  /**
   * 重置所有计数器。
   */
  resetAll(): void {
    this.counters.clear();
  }
}
