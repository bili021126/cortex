import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";

// TelemetryController — 统一遥测控制器
// 收集所有遥测点，提供查询和导出接口

/**
 * 遥测等级
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
export enum TelemetryLevel {
  TRACE = "trace",     // 纯统计，不告警
  NOTICE = "notice",   // 值得关注
  ALERT = "alert",     // 需要响应
}

interface TelemetryPoint {
  metric: string;
  value: number;
  level: TelemetryLevel;
  tags: Record<string, string | number>;
  timestamp: number;
}

interface TrendReport {
  metric: string;
  windowMs: number;
  sampleCount: number;
  avg: number;
  min: number;
  max: number;
  stdDev: number;
  rateOfChange: number;  // 每秒变化率
  trend: "rising" | "falling" | "stable";
  alertLevel: TelemetryLevel;
}

/**
 * TelemetryController —— 统一遥测控制器。
 * @since Core-2 — 接口固化，后续新增字段需向下兼容
 */
class TelemetryController {
  private _points: TelemetryPoint[] = [];
  private _persistPath: string;

  constructor(persistPath?: string) {
    this._persistPath = persistPath ?? resolve(process.cwd(), ".cortex/telemetry.json");
    this._load();
  }

  record(point: Omit<TelemetryPoint, "timestamp" | "level"> & { level?: TelemetryLevel }): void {
    this._points.push({ ...point, level: point.level ?? TelemetryLevel.TRACE, timestamp: Date.now() });
    // 每 100 个点自动落盘
    if (this._points.length % 100 === 0) this._flush();
    // 遥测自监控：每 500 条记录输出一次内存占用
    if (this._points.length % 500 === 0 && typeof process !== "undefined") {
      const mem = process.memoryUsage?.();
      if (mem) {
        console.log(`[telemetry] telemetry.self_monitor points=${this._points.length} heapMB=${Math.round(mem.heapUsed / 1024 / 1024)}`);
      }
    }
  }

  query(metric: string, windowMs?: number): TelemetryPoint[] {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    return this._points.filter(p => p.metric === metric && p.timestamp > cutoff);
  }

  getAlerts(windowMs?: number): TelemetryPoint[] {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    return this._points.filter(p => p.level === TelemetryLevel.ALERT && p.timestamp > cutoff);
  }

  getNotices(windowMs?: number): TelemetryPoint[] {
    const cutoff = windowMs ? Date.now() - windowMs : 0;
    return this._points.filter(p => p.level === TelemetryLevel.NOTICE && p.timestamp > cutoff);
  }

  getStats(): { total: number; metrics: string[] } {
    const metrics = [...new Set(this._points.map(p => p.metric))];
    return { total: this._points.length, metrics };
  }

  clear(): void { this._points = []; }

  listMetrics(): string[] {
    return [...new Set(this._points.map(p => p.metric))];
  }

  analyzeTrend(metric: string, windowMs: number = 300000): TrendReport | null {
    const points = this.query(metric, windowMs);
    if (points.length < 3) return null;

    const values = points.map(p => p.value);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    // 标准差
    const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // 变化率（首尾差 / 时间跨度）
    const timeSpan = (points[points.length - 1]!.timestamp - points[0]!.timestamp) / 1000 || 1;
    const rateOfChange = (values[values.length - 1]! - values[0]!) / timeSpan;

    let trend: "rising" | "falling" | "stable" = "stable";
    if (rateOfChange > avg * 0.1) trend = "rising";
    else if (rateOfChange < -avg * 0.1) trend = "falling";

    let alertLevel = TelemetryLevel.TRACE;
    if (trend === "rising" && rateOfChange > avg * 0.5) alertLevel = TelemetryLevel.ALERT;
    else if (trend !== "stable") alertLevel = TelemetryLevel.NOTICE;

    return { metric, windowMs, sampleCount: points.length, avg, min, max, stdDev, rateOfChange, trend, alertLevel };
  }

  // 批量分析——返回所有已知 metric 的趋势
  analyzeAll(windowMs: number = 300000): TrendReport[] {
    const metrics = this.listMetrics();
    return metrics.map(m => this.analyzeTrend(m, windowMs)).filter(Boolean) as TrendReport[];
  }

  private _flush(): void {
    try {
      writeFileSync(this._persistPath, JSON.stringify(this._points.slice(-1000))); // 只保留最近 1000 条
    } catch {
      // 落盘失败不影响运行时
    }
  }

  private _load(): void {
    try {
      if (existsSync(this._persistPath)) {
        const raw = JSON.parse(readFileSync(this._persistPath, "utf-8"));
        if (Array.isArray(raw)) this._points = raw.slice(-500);
      }
    } catch (e) {
      console.warn(`JSON解析失败: ${e}`);
      // 文件损坏，从零开始
      this._points = [];
    }
  }

  // 程序退出时刷盘
  shutdown(): void {
    this._flush();
  }
}

export const telemetryController = new TelemetryController(
  resolve(process.cwd(), ".cortex/telemetry.json")
);
export type { TelemetryPoint, TrendReport };
export { TelemetryController };

