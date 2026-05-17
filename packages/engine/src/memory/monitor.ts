// @ci: unit
/**
 * MemoryStoreMonitor —— MemoryStore 事件消费者。
 *
 * 职责：
 * 1. 订阅 ALL 级别事件（CRITICAL/HIGH/NORMAL）
 * 2. 关键事件（persist_failed / sql_degraded / deserialize_failed）自动落盘归档
 * 3. 超出阈值时告警通知
 *
 * v2.1 新增：补足消费端，之前 MemoryStore 只 emit 不消费。
 *
 * @fix D3 — 告警洪泛修复：增加 _alerted 标记，仅在跨过阈值时触发一次告警，
 *   窗口事件数回落至阈值以下后重置标记，允许下次跨阈值时再次告警。
 * @fix D4 — stop() 使用 off(priority, handler) 精确移除，防止误删其他组件的 handler。
 * @fix M15 — 简化 start() 中的三次 .bind(this)，使用循环统一绑定。
 */
import type { ObservableEvent } from "@cortex/shared";
import { PipelinePriority, PipelineEventType } from "@cortex/shared";
import type { PipelineObserver } from "../pipeline-observer.js";

export class MemoryStoreMonitor {
  /** 最近 N 秒内事件计数（用于阈值检测） */
  private _windowEvents: number[] = [];
  private readonly _windowMs: number;
  /** 告警阈值：窗口内最多允许的事件数 */
  private readonly _threshold: number;
  /** 是否启用 stdout 日志 */
  private readonly _logToStdout: boolean;

  /**
   * 告警标记——防止阈值跨过时重复触发告警。
   * true: 当前窗口已超过阈值，已触发过告警，不再重复触发。
   * false: 窗口事件数在阈值以下（或刚回落），允许下次跨阈值时触发告警。
   */
  private _alerted = false;

  /** 保存绑定的 handler 引用，供 stop() 精确移除 */
  private readonly _boundHandlers: Map<PipelinePriority, (event: ObservableEvent) => void> = new Map();

  constructor(
    private readonly observer: PipelineObserver,
    options: {
      windowMs?: number;
      threshold?: number;
      logToStdout?: boolean;
    } = {},
  ) {
    this._windowMs = options.windowMs ?? 60_000;
    this._threshold = options.threshold ?? 10;
    this._logToStdout = options.logToStdout ?? false;
  }

  /** 启动监听 */
  start(): void {
    const boundHandler = this._onEvent.bind(this);

    for (const priority of [PipelinePriority.CRITICAL, PipelinePriority.HIGH, PipelinePriority.NORMAL]) {
      this.observer.on(priority, boundHandler);
      this._boundHandlers.set(priority, boundHandler);
    }
  }

  /** 停止监听（按 handler 引用精确移除，不影响其他组件） */
  stop(): void {
    for (const [priority, handler] of this._boundHandlers) {
      this.observer.off(priority, handler);
    }
    this._boundHandlers.clear();
  }

  private _onEvent(event: ObservableEvent): void {
    const typeStr = String(event.type);

    // 仅处理 memory.* 事件
    if (!typeStr.startsWith("memory.")) return;

    const now = Date.now();
    this._windowEvents.push(now);

    // 清理过期事件
    const cutoff = now - this._windowMs;
    this._windowEvents = this._windowEvents.filter((t) => t > cutoff);

    // 阈值检测：仅在跨过阈值时触发一次告警，防止告警洪泛
    const overThreshold = this._windowEvents.length > this._threshold;
    if (overThreshold && !this._alerted) {
      this._alerted = true;
      this._alert(`MemoryStore 高频异常: ${this._windowEvents.length} 事件/${this._windowMs / 1000}s`, event);
    } else if (!overThreshold) {
      this._alerted = false;
    }

    // 关键事件落盘
    const criticalTypes = [
      PipelineEventType.MemoryPersistFailed,
      PipelineEventType.MemorySqlDegraded,
      PipelineEventType.MemoryDeserializeFailed,
    ];
    if (criticalTypes.includes(event.type as PipelineEventType)) {
      this._persistAlert(event);
    }

    // 日志输出
    if (this._logToStdout) {
      console.warn(
        `[MemoryStoreMonitor] ${event.type} severity=${event.priority} ` +
        `window=${this._windowEvents.length}/${this._threshold}`,
      );
    }
  }

  private _alert(msg: string, event: ObservableEvent): void {
    console.error(`[MemoryStoreMonitor] ALERT: ${msg}`);
    console.error(
      `  最新事件: type=${event.type} priority=${event.priority} ` +
      `timestamp=${new Date(event.timestamp).toISOString()}`,
    );
  }

  private _persistAlert(event: ObservableEvent): void {
    // 落盘归档：使用 stderr 确保不被 stdout 吞掉
    process.stderr.write(
      `[MemoryStoreMonitor ARCHIVE] type=${event.type} ` +
      `timestamp=${new Date(event.timestamp).toISOString()} ` +
      `payload=${JSON.stringify(event.payload).slice(0, 200)}\n`,
    );
  }
}
