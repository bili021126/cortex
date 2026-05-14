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
 * @fix D4 — stop() 使用 off(priority, handler) 精确移除，防止误删其他组件的 handler。
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
    const handler = this._onEvent.bind(this);

    this.observer.on(PipelinePriority.CRITICAL, handler);
    this._boundHandlers.set(PipelinePriority.CRITICAL, handler);

    const handlerHigh = this._onEvent.bind(this);
    this.observer.on(PipelinePriority.HIGH, handlerHigh);
    this._boundHandlers.set(PipelinePriority.HIGH, handlerHigh);

    const handlerNormal = this._onEvent.bind(this);
    this.observer.on(PipelinePriority.NORMAL, handlerNormal);
    this._boundHandlers.set(PipelinePriority.NORMAL, handlerNormal);
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

    // 阈值检测
    if (this._windowEvents.length > this._threshold) {
      this._alert(`MemoryStore 高频异常: ${this._windowEvents.length} 事件/${this._windowMs / 1000}s`, event);
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
